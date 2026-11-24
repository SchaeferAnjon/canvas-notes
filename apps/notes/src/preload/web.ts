/** window.cnWeb：内置浏览器的接口（见 shared/web-api.ts） */
import { ipcRenderer } from 'electron'
import type { ActionState, CnWebApi } from '../shared/web-api'

const PARTITION = 'persist:web'

/** electron-chrome-extensions 给界面用的通道（它自带的 <browser-action-list> 也走这个） */
const crx = (name: string, ...args: unknown[]) => ipcRenderer.invoke('crx-msg-remote', PARTITION, name, ...args)

function on<T extends unknown[]>(channel: string, cb: (...args: T) => void): () => void {
  const h = (_e: unknown, ...args: unknown[]) => cb(...(args as T))
  ipcRenderer.on(channel, h)
  return () => ipcRenderer.removeListener(channel, h)
}

let observing = 0

export const webApi: CnWebApi = {
  bookmarks: () => ipcRenderer.invoke('web:bookmarks'),
  addBookmark: (b) => ipcRenderer.invoke('web:bookmark-add', b),
  removeBookmark: (id) => ipcRenderer.invoke('web:bookmark-remove', id),
  onBookmarksChanged: (cb) => on('web:bookmarks-changed', cb),
  importBookmarks: (id) => ipcRenderer.invoke('web:bookmarks-import', id),
  history: (q, limit) => ipcRenderer.invoke('web:history', q, limit),
  importHistory: (id) => ipcRenderer.invoke('web:history-import', id),
  chromeProfiles: () => ipcRenderer.invoke('web:chrome-profiles'),
  extensions: () => ipcRenderer.invoke('web:extensions'),
  importExtensions: (id) => ipcRenderer.invoke('web:extensions-import', id),
  setExtensionEnabled: (id, on) => ipcRenderer.invoke('web:extension-enable', id, on),
  removeExtension: (id) => ipcRenderer.invoke('web:extension-remove', id),
  async actions() {
    const state = (await crx('browserAction.getState')) as {
      activeTabId?: number
      actions: { id: string; title?: string; text?: string; color?: string; popup?: string; iconModified?: number; tabs?: Record<string, { title?: string; text?: string; color?: string; popup?: string; iconModified?: number }> }[]
    }
    const tab = state.activeTabId
    const actions: ActionState[] = state.actions.map((a) => {
      const t = (tab !== undefined && a.tabs?.[tab]) || {}
      const q = new URLSearchParams({ tabId: String(tab ?? -1), partition: PARTITION })
      const mod = t.iconModified ?? a.iconModified
      if (mod) q.set('t', String(mod))
      return {
        id: a.id,
        title: t.title ?? a.title ?? '',
        ...((t.text ?? a.text) ? { text: t.text ?? a.text } : {}),
        ...((t.color ?? a.color) ? { color: t.color ?? a.color } : {}),
        ...((t.popup ?? a.popup) ? { popup: t.popup ?? a.popup } : {}),
        icon: `crx://extension-icon/${a.id}/32/2?${q}`,
      }
    })
    return { ...(tab !== undefined ? { activeTabId: tab } : {}), actions }
  },
  activateAction: (id, rect, tabId) => crx('browserAction.activate', { eventType: 'click', extensionId: id, tabId, alignment: '', anchorRect: rect }),
  onActionsChanged(cb) {
    if (observing++ === 0) void crx('browserAction.addObserver')
    const off = on('browserAction.update', cb)
    return () => {
      off()
      if (--observing === 0) void crx('browserAction.removeObserver')
    }
  },
  setActiveTab: (id) => ipcRenderer.invoke('web:active', id),
  onOpenTab: (cb) => on('web:open-tab', cb),
  tabCreated: (reqId, id) => ipcRenderer.send('web:tab-created', reqId, id),
  onTabCommand: (cb) => on('web:tab-command', cb),
  setTabs: (list) => ipcRenderer.send('web:tabs', list),
  newtab: () => ipcRenderer.invoke('web:newtab'),
  extTheme: (t) => ipcRenderer.send('web:ext-theme', t),
  onKey: (cb) => on('web:key', cb),
  saveImage: (src, nameHint, opts) => ipcRenderer.invoke('web:save-image', src, nameHint, opts),
  fetchImage: (url) => ipcRenderer.invoke('web:fetch-image', url),
  undoClip: (path) => ipcRenderer.invoke('web:undo-clip', path),
  faviconTone: (url) => ipcRenderer.invoke('web:favicon-tone', url),
}
