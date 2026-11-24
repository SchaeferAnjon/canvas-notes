import { ipcRenderer } from 'electron'
import type { CnMcApi, McJumpMsg } from '../shared/meetcaption'

/** MeetCaption 联动：实现在 main/meetcaption.ts */
export const mcApi: CnMcApi = {
  folder: (f) => ipcRenderer.invoke('mc:folder', f),
  start: (o) => ipcRenderer.invoke('mc:start', o),
  open: (s, t) => ipcRenderer.invoke('mc:open', s, t),
  autoPlace: (f) => ipcRenderer.invoke('mc:autoPlace', f),
  record: (p) => ipcRenderer.invoke('mc:record', p),
  audio: (r) => ipcRenderer.invoke('mc:audio', r),
  fetchAudio: (r) => ipcRenderer.invoke('mc:fetchAudio', r),
  find: (s, t) => ipcRenderer.invoke('mc:find', s, t),
  takePending: () => ipcRenderer.invoke('mc:takePending'),
  onJump: (f) => {
    const h = (_e: unknown, j: McJumpMsg) => f(j)
    ipcRenderer.on('mc:jump', h)
    return () => void ipcRenderer.removeListener('mc:jump', h)
  },
  onChanged: (f) => {
    const h = () => f()
    ipcRenderer.on('mc:changed', h)
    return () => void ipcRenderer.removeListener('mc:changed', h)
  },
}
