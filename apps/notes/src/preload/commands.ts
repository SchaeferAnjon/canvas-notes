import { ipcRenderer } from 'electron'
import type { CnCmdsApi } from '../shared/commands'

/** ⌘K 的自定义（.canvas-notes/命令.json）和自己设的快捷键 */
export const cmdsApi: CnCmdsApi = {
  get: () => ipcRenderer.invoke('cmds:get'),
  set: (c) => ipcRenderer.invoke('cmds:set', c),
  keys: (k) => ipcRenderer.invoke('cmds:keys', k),
}
