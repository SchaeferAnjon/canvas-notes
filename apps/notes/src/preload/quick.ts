import { contextBridge, ipcRenderer } from 'electron'
import type { QuickApi, QuickContext } from '../shared/quick'

// 最近送来的那一次留着：小窗第一次开时主进程等页面读完就送，界面（React）可能还没订上（机器忙、刚启动），
// 晚订的马上交给它，选中的字不丢（收件箱「速记抓不到内容」）
let last: QuickContext | null = null
const subs = new Set<(ctx: QuickContext) => void>()
ipcRenderer.on('quick:context', (_e, ctx: QuickContext) => {
  last = ctx
  for (const cb of subs) cb(ctx)
})

const api: QuickApi = {
  onContext(cb) {
    subs.add(cb)
    if (last) cb(last)
    return () => void subs.delete(cb)
  },
  save: (text) => ipcRenderer.invoke('quick:save', text),
  close: () => ipcRenderer.invoke('quick:close'),
  resize: (h) => ipcRenderer.invoke('quick:resize', h),
  allow: () => ipcRenderer.invoke('quick:allow'),
  noHint: () => ipcRenderer.invoke('quick:nohint'),
}

contextBridge.exposeInMainWorld('quick', api)
