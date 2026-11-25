import { ipcRenderer } from 'electron'
import type { CnMobileAiApi, MobileAiState, MobileAiWaiting } from '../shared/mobile-ai'

/** 设置 › AI「iPhone 和 iPad」（task-wwqf0）：实现在 main/mobile-ai/index.ts */
export const mobileAiApi: CnMobileAiApi = {
  state: () => ipcRenderer.invoke('mobileAi:state'),
  set: (on) => ipcRenderer.invoke('mobileAi:set', on),
  newCode: () => ipcRenderer.invoke('mobileAi:code'),
  unpair: (id) => ipcRenderer.invoke('mobileAi:unpair', id),
  setFull: (id, on) => ipcRenderer.invoke('mobileAi:full', id, on),
  waiting: () => ipcRenderer.invoke('mobileAi:waiting'),
  onWaiting(cb) {
    const h = (_e: unknown, w: MobileAiWaiting[]) => cb(w)
    ipcRenderer.on('mobileAi:waiting', h)
    return () => ipcRenderer.removeListener('mobileAi:waiting', h)
  },
  onChanged(cb) {
    const h = (_e: unknown, s: MobileAiState) => cb(s)
    ipcRenderer.on('mobileAi:changed', h)
    return () => ipcRenderer.removeListener('mobileAi:changed', h)
  },
}
