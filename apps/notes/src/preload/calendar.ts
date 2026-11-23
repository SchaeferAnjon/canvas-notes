import { ipcRenderer } from 'electron'
import type { CalLinkState, CnCalApi } from '../shared/calendar'

/** 「日历」格（task-kzr3n）：实现在 main/calendar.ts */
export const calApi: CnCalApi = {
  state: () => ipcRenderer.invoke('cal:state'),
  connect: () => ipcRenderer.invoke('cal:connect'),
  events: (from, to) => ipcRenderer.invoke('cal:events', from, to),
  openPrivacy: () => ipcRenderer.invoke('cal:openPrivacy'),
  aiInfo: () => ipcRenderer.invoke('cal:aiInfo'),
  aiSchedule: (id) => ipcRenderer.invoke('cal:aiSchedule', id),
  aiCancel: (id) => ipcRenderer.invoke('cal:aiCancel', id),
  onChanged: (f) => {
    const h = () => f()
    ipcRenderer.on('cal:changed', h)
    return () => void ipcRenderer.removeListener('cal:changed', h)
  },
  onState: (f) => {
    const h = (_e: unknown, s: CalLinkState) => f(s)
    ipcRenderer.on('cal:state', h)
    return () => void ipcRenderer.removeListener('cal:state', h)
  },
}
