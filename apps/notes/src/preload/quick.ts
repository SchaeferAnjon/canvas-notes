import { contextBridge, ipcRenderer } from 'electron'
import type { QuickApi, QuickContext } from '../shared/quick'

const api: QuickApi = {
  onContext(cb) {
    const h = (_e: unknown, ctx: QuickContext) => cb(ctx)
    ipcRenderer.on('quick:context', h)
    return () => ipcRenderer.removeListener('quick:context', h)
  },
  save: (text) => ipcRenderer.invoke('quick:save', text),
  close: () => ipcRenderer.invoke('quick:close'),
  resize: (h) => ipcRenderer.invoke('quick:resize', h),
  allow: () => ipcRenderer.invoke('quick:allow'),
  noHint: () => ipcRenderer.invoke('quick:nohint'),
}

contextBridge.exposeInMainWorld('quick', api)
