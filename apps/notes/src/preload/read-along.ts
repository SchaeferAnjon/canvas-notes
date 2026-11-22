/** 读到哪、书桌（task-kbnc0）：界面拿 window.cnRead 读写库里的 .canvas-notes/读到哪.json、.canvas-notes/书桌/ */
import { ipcRenderer } from 'electron'
import type { CnReadApi } from '../shared/read-along'

export const readApi: CnReadApi = {
  positions: () => ipcRenderer.invoke('readpos:all'),
  setPosition: (book, pos) => ipcRenderer.invoke('readpos:set', book, pos),
  desks: () => ipcRenderer.invoke('desk:list'),
  saveDesk: (desk, file) => ipcRenderer.invoke('desk:save', desk, file),
  renameDesk: (file, name) => ipcRenderer.invoke('desk:rename', file, name),
  removeDesk: (file) => ipcRenderer.invoke('desk:remove', file),
  restoreDesk: (file, text) => ipcRenderer.invoke('desk:restore', file, text),
}
