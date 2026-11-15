/**
 * 界面这边的内置插件表，和网页面板、⌘F、插件面板、设置页的接头。
 * 加一个内置插件：在 PLUGINS 里加一行（主进程那半加到 main/plugins/index.ts）。
 */
import { Icon } from '@cn/design'
import { Puzzle, Settings as SettingsIcon } from 'lucide-react'
import { PERMISSION_LABEL, type PluginInfo } from '../../shared/plugins'
import type { CSSProperties, ReactNode } from 'react'
import type { PaletteCommand } from '../Palette'
import { Toggle } from '../Settings'
import { bookmarks } from './bookmarks'
import { errText, setPluginEnabled, setPluginSettings, usePlugins, webHost } from './host'
import { translate } from './translate'
import type { NewTabProps, RendererPlugin, WebPage } from './types'
import './plugins.css'

export const PLUGINS: RendererPlugin[] = [translate, bookmarks]

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
      <Icon of={look.icon} size={small ? 13 : 15} />
    </button>
  )
  return small ? btn : <span className="imp plug-btn">{btn}</span>
}

/** 某个内置插件开着没有 */
export function usePluginOn(id: string): boolean {
  return useOn().some((p) => p.id === id)
}

/** 新开的网页标签那一页：开着的插件里第一个有 NewTab 的；都没有就用 fallback */
export function PluginNewTab(props: NewTabProps & { fallback: ReactNode }) {
  const p = useOn().find((x) => x.NewTab)
  if (!p?.NewTab) return <>{props.fallback}</>
  const { fallback: _, ...rest } = props
  return <p.NewTab {...rest} />
}

/** 开着的内置插件的按钮：slot 是 address 的画在地址栏里（小圆按钮），toolbar 的画在地址栏右边 */
export function PluginButtons(props: { slot: 'address' | 'toolbar'; page: WebPage | null; popup: string | null; onPopup(id: string | null): void }) {
  return (
    <>
      {useOn()
        .filter((p) => p.button && (p.button.slot ?? 'toolbar') === props.slot)
        .map((p) => (
          <PluginButton key={p.id} p={p} page={props.page} open={props.popup === p.id} onPopup={props.onPopup} small={props.slot === 'address'} />
        ))}
    </>
  )
}

/** 「⋯」菜单里插件的项（声明了 button.menu 的）：名字、快捷键、点了做什么 */
export function usePluginMenu(page: WebPage | null): { id: string; label: string; keys?: string; icon: RendererPlugin['icon']; run(): void }[] {
  return useOn().flatMap((p) => (p.button?.menu && p.button.click ? [{ id: p.id, label: p.button.menu.label, keys: p.button.menu.keys, icon: p.icon, run: () => p.button!.click!(page) }] : []))
}

/** 「⋯」菜单「这一页」组里各插件自己的项 */
export function PluginPageMenu(props: { page: WebPage | null; onDone(): void; onNotice(t: string): void }) {
  return (
    <>
      {useOn().map((p) => (p.PageMenu ? <p.PageMenu key={p.id} {...props} /> : null))}
    </>
  )
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

const perms = (i: PluginInfo) => i.permissions.map((x) => PERMISSION_LABEL[x]).join(' · ')

/** 插件面板里的「内置」一组：名字、说明、要的权限、开关、去设置 */
export function BuiltinPlugins(props: { onNotice(t: string): void; onSettings(): void }) {
  const list = usePlugins()
  return (
    <div className="wlist plug-list" role="list" aria-label="内置插件">
      {list.map((i) => {
        const p = byId(i.id)
        return (
          <div key={i.id} className="wrow plug-row" role="listitem" aria-label={i.name}>
            <span className="plug-ic">
              <Icon of={p?.icon ?? Puzzle} size={15} />
            </span>
            <div className="wmain">
              <b className="truncate">{i.name}</b>
              <span className="plug-desc">{i.description}</span>
              <span className="plug-perm">要用：{perms(i)}</span>
            </div>
            {p?.Settings && (
              <button className="iconbtn" aria-label={`${i.name} 设置`} title="设置" onClick={props.onSettings}>
                <Icon of={SettingsIcon} size={13} />
              </button>
            )}
            <Toggle on={i.enabled} label={`启用 ${i.name}`} onChange={(v) => void setPluginEnabled(i.id, v).catch((e) => props.onNotice(errText(e)))} />
          </div>
        )
      })}
    </div>
  )
}

/** 设置 · 插件：每个内置插件一块（开关 + 它自己的设置） */
export function PluginsSettings(props: { onNotice(t: string): void }) {
  const list = usePlugins()
  return (
    <>
      {list.map((i) => {
        const p = byId(i.id)
        return (
          <section key={i.id} className="plug-set" aria-label={i.name}>
            <h4>
              {i.name} <span>要用：{perms(i)}</span>
            </h4>
            <p className="note plug-about">{i.description}</p>
            <div className="pair">
              <span>启用</span>
              <Toggle on={i.enabled} label={`启用 ${i.name}`} onChange={(v) => void setPluginEnabled(i.id, v).catch((e) => props.onNotice(errText(e)))} />
            </div>
            {p?.Settings && i.enabled && <p.Settings info={i} onNotice={props.onNotice} onChange={(patch) => void setPluginSettings(i.id, patch).catch((e) => props.onNotice(errText(e)))} />}
          </section>
        )
      })}
      <p className="note">内置插件是软件自己的功能，按插件的方式写：各自声明要用的权限，关掉就不再碰网页和库。</p>
    </>
  )
}
