/**
 * 网页预加载里插件共用的几样：每个插件开没开、设置是什么（主进程推过来），调插件的方法，
 * 收主进程和界面发来的话，告诉界面网页里的状态。都在隔离环境里，网页脚本碰不到。
 */
import { ipcRenderer } from 'electron'
import type { PageState } from '../../shared/plugins'

let state: PageState = {}
const subs = new Set<() => void>()
const changed = () => subs.forEach((f) => f())

void ipcRenderer.invoke('plugins:page-state').then(
  (s: PageState) => {
    state = s
    changed()
  },
  (e: Error) => console.warn('[canvas-notes] 插件状态读不到', e.message),
)
ipcRenderer.on('plugins:page-state', (_e, s: PageState) => {
  state = s
  changed()
})

export const pluginState = (id: string) => state[id]
export const pluginEnabled = (id: string) => state[id]?.enabled === true

export function onPluginState(cb: () => void): () => void {
  subs.add(cb)
  return () => subs.delete(cb)
}

export const callPlugin = <T = unknown>(id: string, method: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke('plugins:call', id, method, args)

/** 主进程里的插件发来的事件 */
export function onPageEvent(id: string, event: string, cb: (payload: unknown) => void) {
  ipcRenderer.on('plugins:page-event', (_e, pid: string, ev: string, payload: unknown) => {
    if (pid === id && ev === event) cb(payload)
  })
}

/** 界面（插件按钮、⌘F 命令）发来的命令 */
export function onHostCommand(id: string, cb: (cmd: string, arg?: unknown) => void) {
  ipcRenderer.on('plugins:page-cmd', (_e, pid: string, cmd: string, arg: unknown) => {
    if (pid === id && typeof cmd === 'string') cb(cmd, arg)
  })
}

/** 告诉界面网页里现在怎样了（插件按钮亮不亮） */
export const tellHost = (id: string, payload: unknown) => ipcRenderer.sendToHost('cn:plugin', id, payload)
