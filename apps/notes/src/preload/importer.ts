import { ipcRenderer } from 'electron'
import type { CnImportApi, ImportProgress } from '../shared/import'

export const importApi: CnImportApi = {
  pick: (kind) => ipcRenderer.invoke('import:pick', kind),
  start: (kind, folders) => ipcRenderer.invoke('import:start', kind, folders),
  stop: () => ipcRenderer.invoke('import:stop'),
  current: () => ipcRenderer.invoke('import:current'),
  undo: (commit) => ipcRenderer.invoke('import:undo', commit),
  onProgress(cb) {
    const h = (_e: unknown, p: ImportProgress) => cb(p)
    ipcRenderer.on('import:progress', h)
    return () => ipcRenderer.removeListener('import:progress', h)
  },
  onOpen(cb) {
    const h = () => cb()
    ipcRenderer.on('import:open', h)
    return () => ipcRenderer.removeListener('import:open', h)
  },
}
