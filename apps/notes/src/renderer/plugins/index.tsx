/**
 * 界面这边的内置插件表，和网页面板、⌘F、插件面板、设置页的接头。
 * 加一个内置插件：在 PLUGINS 里加一行（主进程那半加到 main/plugins/index.ts）。
 */
import { Codicon, type CodiconName } from '@cn/design'
import { keyFor } from '../keys'
import { PERMISSION_LABEL, type PluginInfo } from '../../shared/plugins'
import type { CSSProperties } from 'react'
import type { PaletteCommand } from '../Palette'
import { Toggle } from '../Settings'
import { adblock } from './adblock'
import { bookmarks } from './bookmarks'
import { entryTarget, errText, setPluginEnabled, setPluginSettings, usePlugins, webHost } from './host'
import { translate } from './translate'
import { weread } from './weread'
import type { RendererPlugin, WebPage } from './types'
import type { Params } from '../../shared/i18n'
import { useT } from '../i18n'
import './plugins.css'

export const PLUGINS: RendererPlugin[] = [translate, bookmarks, weread, adblock]

const byId = (id: string) => PLUGINS.find((p) => p.id === id)

/** 开着的插件（按 PLUGINS 的顺序） */
function useOn(): RendererPlugin[] {
  const list = usePlugins()
  return PLUGINS.filter((p) => list.find((i) => i.id === p.id)?.enabled)
}

/** ⌘F 面板里开着的插件的命令 */
export function usePluginCommands(): PaletteCommand[] {
  const on = useOn()
  const page = webHost()?.page() ?? null
  return on.flatMap((p) => p.commands?.(page) ?? [])
}

function PluginButton({ p, page, open, onPopup, small }: { p: RendererPlugin; page: WebPage | null; open: boolean; onPopup(id: string | null): void; small: boolean }) {
  const look = p.button!.useLook(page)
  const btn = (
    <button
      type="button"
      className={(small ? 'abtn' : 'iconbtn wact') + (look.on || open ? ' on' : '') + (look.filled ? ' filled' : '')}
      aria-label={look.label}
      aria-pressed={p.button!.click ? !!look.on : open}
      title={look.title}
      onClick={() => (p.button!.click ? p.button!.click(page) : onPopup(open ? null : p.id))}
    >
      <Codicon name={look.icon} size={small ? 13 : 15} />
    </button>
  )
  return small ? btn : <span className="imp plug-btn">{btn}</span>
}

/**
 * 右边竖条上插件的格子（「网页」下面，比如微信读书，CN-36）：开着的插件里声明了 entry 的才有。
 * 点了右栏打开它的网址，已经开着这个网站就切过去；它亮着（右栏网页正在看这个网站）时再点 = 收起右栏，和竖条别的格一样。
 */
export function usePluginEntries(cur: { webOpen: boolean; url: string | null }, act: { open(url: string, reuse: string): void; close(): void }) {
  const list = usePlugins()
  return list.flatMap((i) => {
    if (!i.enabled || !i.entry) return []
    const t = entryTarget(i.entry)
    const on = cur.webOpen && !!cur.url?.startsWith(t.reuse)
    return [{ id: `plugin-${i.id}`, label: i.entry.name, icon: i.entry.icon as CodiconName, on, onClick: () => (on ? act.close() : act.open(t.url, t.reuse)) }]
  })
}

/** 某个内置插件开着没有 */
export function usePluginOn(id: string): boolean {
  return useOn().some((p) => p.id === id)
}

/** 开着的内置插件的按钮：slot 是 address 的画在地址栏里（小圆按钮），toolbar 的画在地址栏右边 */
export function PluginButtons(props: { slot: 'address' | 'toolbar'; page: WebPage | null; popup: string | null; onPopup(id: string | null): void }) {
  return (
    <>
      {useOn()
        .filter((p) => p.button && (p.button.slot ?? 'toolbar') === props.slot)
        .map((p) => {
          const Control = p.button!.Control
          return Control ? (
            <Control key={p.id} page={props.page} open={props.popup === p.id} onPopup={props.onPopup} />
          ) : (
            <PluginButton key={p.id} p={p} page={props.page} open={props.popup === p.id} onPopup={props.onPopup} small={props.slot === 'address'} />
          )
        })}
    </>
  )
}

/** 「⋯」菜单里插件的项（声明了 button.menu 的）：名字、快捷键、点了做什么 */
export function usePluginMenu(page: WebPage | null): { id: string; label: string; keys?: string; icon: RendererPlugin['icon']; run(): void }[] {
  return useOn().flatMap((p) => (p.button?.menu && p.button.click ? [{ id: p.id, label: p.button.menu.label, keys: p.button.menu.keys ? (keyFor(p.button.menu.keys) ?? undefined) : undefined, icon: p.icon, run: () => p.button!.click!(page) }] : []))
}

/** 「⋯」菜单「这一页」组里各插件自己的项 */
export function PluginPageMenu(props: { page: WebPage | null; onDone(): void; onNotice(t: string): void }) {
  return (
    <>
      {useOn().map((p) => (p.PageMenu ? <p.PageMenu key={p.id} {...props} /> : null))}
    </>
  )
}

/** 开着的插件在「⋯」里的项：一项一个身份、放哪一组（这一页 / 这个网站），「调整这个菜单…」按它们藏起、换顺序 */
export function usePageMenus(): { id: string; group: 'page' | 'site'; label: string; icon: CodiconName; Item: NonNullable<RendererPlugin['PageMenu']> }[] {
  return useOn().flatMap((p) => (p.PageMenu && p.pageMenu ? [{ id: p.pageMenu.id, group: p.pageMenu.group ?? 'page', label: p.pageMenu.label, icon: p.pageMenu.icon, Item: p.PageMenu }] : []))
}

/** 插件的弹窗（书签管家）；mode 见 RendererPlugin.Popup */
export function PluginPopup(props: { id: string; page: WebPage | null; mode?: 'this-page' | 'all'; style?: CSSProperties; onClose(): void }) {
  const p = byId(props.id)
  const on = useOn()
  if (!p?.Popup || !on.includes(p)) return null
  return (
    <div className="imp plug-pop" style={props.style}>
      <p.Popup page={props.page} mode={props.mode} onClose={props.onClose} />
    </div>
  )
}

const perms = (t: (k: string, p?: Params) => string, i: PluginInfo) => i.permissions.map((x) => t(PERMISSION_LABEL[x])).join(' · ')

/** 插件面板里的「内置」一组：名字、说明、要的权限、开关、去设置 */
export function BuiltinPlugins(props: { onNotice(t: string): void; onSettings(): void }) {
  const t = useT()
  const list = usePlugins()
  return (
    <div className="wlist plug-list" role="list" aria-label={t('内置插件')}>
      {list.map((i) => {
        const p = byId(i.id)
        const name = t(i.name)
        return (
          <div key={i.id} className="wrow plug-row" role="listitem" aria-label={name}>
            <span className="plug-ic">
              <Codicon name={p?.icon ?? 'extensions'} size={15} />
            </span>
            <div className="wmain">
              <b className="truncate">{name}</b>
              <span className="plug-desc">{t(i.description)}</span>
              <span className="plug-perm">{t('要用：{perms}', { perms: perms(t, i) })}</span>
            </div>
            {p?.Settings && (
              <button className="iconbtn" aria-label={t('{name} 设置', { name })} title={t('设置')} onClick={props.onSettings}>
                <Codicon name="settings-gear" size={13} />
              </button>
            )}
            <Toggle on={i.enabled} label={t('启用 {name}', { name })} onChange={(v) => void setPluginEnabled(i.id, v).catch((e) => props.onNotice(errText(e)))} />
          </div>
        )
      })}
    </div>
  )
}

/** 设置搜索、「排顺序 ›」跳到哪个插件那一块（shared/settings-index.ts 的 id） */
const PLUGIN_ROW: Record<string, string> = { translate: 'plTranslate', bookmarks: 'plBook', weread: 'plWeread', adblock: 'plAd' }

/** 设置 · 插件：每个内置插件一块（开关 + 它自己的设置） */
export function PluginsSettings(props: { onNotice(t: string): void }) {
  const t = useT()
  const list = usePlugins()
  return (
    <>
      {list.map((i) => {
        const p = byId(i.id)
        const name = t(i.name)
        return (
          <section key={i.id} className="plug-set" aria-label={name} data-row={PLUGIN_ROW[i.id]}>
            <h4>
              {name} <span>{t('要用：{perms}', { perms: perms(t, i) })}</span>
            </h4>
            <p className="note plug-about">{t(i.description)}</p>
            <div className="pair">
              <span>{t('启用')}</span>
              <Toggle on={i.enabled} label={t('启用 {name}', { name })} onChange={(v) => void setPluginEnabled(i.id, v).catch((e) => props.onNotice(errText(e)))} />
            </div>
            {p?.Settings && i.enabled && <p.Settings info={i} onNotice={props.onNotice} onChange={(patch) => void setPluginSettings(i.id, patch).catch((e) => props.onNotice(errText(e)))} />}
          </section>
        )
      })}
      <p className="note">{t('内置插件是软件自己的功能，按插件的方式写：各自声明要用的权限，关掉就不再碰网页和库。')}</p>
    </>
  )
}
