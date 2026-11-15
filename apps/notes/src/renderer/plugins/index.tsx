/**
 * 界面这边的内置插件表，和网页面板、⌘F、插件面板、设置页的接头。
 * 加一个内置插件：在 PLUGINS 里加一行（主进程那半加到 main/plugins/index.ts）。
 */
import { Icon } from '@cn/design'
import { Puzzle, Settings as SettingsIcon } from 'lucide-react'
import { PERMISSION_LABEL, type PluginInfo } from '../../shared/plugins'
import type { PaletteCommand } from '../Palette'
import { Toggle } from '../Settings'
import { bookmarks } from './bookmarks'
import { errText, setPluginEnabled, setPluginSettings, usePlugins, webHost } from './host'
import { translate } from './translate'
import type { RendererPlugin, WebPage } from './types'
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

function PluginButton({ p, page, open, onPopup }: { p: RendererPlugin; page: WebPage | null; open: boolean; onPopup(id: string | null): void }) {
  const look = p.button!.useLook(page)
  return (
    <span className="imp plug-btn">
      <button
        className={'iconbtn wact' + (look.on || open ? ' on' : '') + (look.filled ? ' filled' : '')}
        aria-label={look.label}
        aria-pressed={p.button!.click ? !!look.on : open}
        title={look.title}
        onClick={() => (p.button!.click ? p.button!.click(page) : onPopup(open ? null : p.id))}
      >
        <Icon of={look.icon} size={15} />
      </button>
    </span>
  )
}

/** 网页标签条右边：开着的内置插件的按钮（和 Chrome 插件按钮同一排，排在前面） */
export function PluginButtons(props: { page: WebPage | null; popup: string | null; onPopup(id: string | null): void }) {
  return (
    <>
      {useOn()
        .filter((p) => p.button)
        .map((p) => (
          <PluginButton key={p.id} p={p} page={props.page} open={props.popup === p.id} onPopup={props.onPopup} />
        ))}
    </>
  )
}

/** 按钮下面的弹窗（书签管家） */
export function PluginPopup(props: { id: string; page: WebPage | null; onClose(): void }) {
  const p = byId(props.id)
  const on = useOn()
  if (!p?.Popup || !on.includes(p)) return null
  return (
    <div className="imp plug-pop">
      <p.Popup page={props.page} onClose={props.onClose} />
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
