import { ipcRenderer } from 'electron'
import type { CnMobileAiApi, MobileAiState } from '../shared/mobile-ai'

/** 设置 › AI「iPhone 和 iPad」（task-wwqf0）：实现在 main/mobile-ai/index.ts */
export const mobileAiApi: CnMobileAiApi = {
  state: () => ipcRenderer.invoke('mobileAi:state'),
  set: (on) => ipcRenderer.invoke('mobileAi:set', on),
  newCode: () => ipcRenderer.invoke('mobileAi:code'),
  unpair: (id) => ipcRenderer.invoke('mobileAi:unpair', id),
  onChanged(cb) {
    const h = (_e: unknown, s: MobileAiState) => cb(s)
    ipcRenderer.on('mobileAi:changed', h)
    return () => ipcRenderer.removeListener('mobileAi:changed', h)
  },
}
