/** window.cnSearch：三层搜索（见 shared/search.ts） */
import { ipcRenderer } from 'electron'
import type { ClaudeFindEvent, CnSearchApi, SearchStatus } from '../shared/search'

export const searchApi: CnSearchApi = {
  pdfText: (q) => ipcRenderer.invoke('search:pdfText', q),
  meaning: (q) => ipcRenderer.invoke('search:meaning', q),
  status: () => ipcRenderer.invoke('search:status'),
  onStatus(cb) {
    const h = (_e: unknown, s: SearchStatus) => cb(s)
    ipcRenderer.on('search:status', h)
    return () => ipcRenderer.removeListener('search:status', h)
  },
  claudeFind: (id, q) => ipcRenderer.invoke('search:claude', id, q),
  claudeStop: (id) => ipcRenderer.invoke('search:claude:stop', id),
  onClaude(cb) {
    const h = (_e: unknown, id: number, ev: ClaudeFindEvent) => cb(id, ev)
    ipcRenderer.on('search:claude:event', h)
    return () => ipcRenderer.removeListener('search:claude:event', h)
  },
}
