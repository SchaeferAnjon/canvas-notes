/** window.cnMineru：PDF 精读增强（见 shared/mineru.ts） */
import { ipcRenderer } from 'electron'
import type { CnMineruApi, MineruJob, MineruStatus } from '../shared/mineru'

export const mineruApi: CnMineruApi = {
  status: () => ipcRenderer.invoke('mineru:status'),
  onStatus(cb) {
    const h = (_e: unknown, s: MineruStatus) => cb(s)
    ipcRenderer.on('mineru:status', h)
    return () => ipcRenderer.removeListener('mineru:status', h)
  },
  dismiss: (on) => ipcRenderer.invoke('mineru:dismiss', on),
  refind: () => ipcRenderer.invoke('mineru:refind'),
  setPath: (path) => ipcRenderer.invoke('mineru:setPath', path),
  install: () => ipcRenderer.invoke('mineru:install'),
  stopInstall: () => ipcRenderer.invoke('mineru:install:stop'),
  enhance: (pdf, pages, fresh) => ipcRenderer.invoke('mineru:enhance', pdf, pages, fresh),
  onJob(cb) {
    const h = (_e: unknown, j: MineruJob) => cb(j)
    ipcRenderer.on('mineru:job', h)
    return () => ipcRenderer.removeListener('mineru:job', h)
  },
  onInstalled(cb) {
    const h = () => cb()
    ipcRenderer.on('mineru:installed', h)
    return () => ipcRenderer.removeListener('mineru:installed', h)
  },
}
