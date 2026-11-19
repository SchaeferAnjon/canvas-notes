/** window.cnMenu：右键菜单（见 shared/ctx-menu.ts、main/ctx-menu.ts） */
import { ipcRenderer } from 'electron'
import type { CnMenuApi, CtxParams } from '../shared/ctx-menu'

export const menuApi: CnMenuApi = {
  popup: (items, target) => ipcRenderer.invoke('ctx:menu', items, target),
  onWebContext(cb) {
    const h = (_e: unknown, wcId: number, p: CtxParams) => cb(wcId, p)
    ipcRenderer.on('ctx:web', h)
    return () => ipcRenderer.removeListener('ctx:web', h)
  },
  copyText: (text) => ipcRenderer.invoke('ctx:copy', text),
  reveal: (path) => ipcRenderer.invoke('ctx:reveal', path),
  openExternal: (url) => ipcRenderer.invoke('ctx:open-external', url),
  moveNote: (path, folder) => ipcRenderer.invoke('ctx:move', path, folder),
  moveMany: (paths, folder) => ipcRenderer.invoke('ctx:move-many', paths, folder),
  clipboardHas: () => ipcRenderer.invoke('ctx:clipboard-has'),
  readClipboardText: () => ipcRenderer.invoke('ctx:clipboard-text'),
  pin: (path, on) => ipcRenderer.invoke('ctx:pin', path, on),
}
