/**
 * 界面语言（task-zojmg）：一打开就同步要一次（第一帧就是对的语言，不先闪一下中文），之后主进程换了再推过来。
 * 主窗口、速记小窗的预加载都 import 它，挂成 window.cnLang
 */
import { contextBridge, ipcRenderer } from 'electron'
import type { LangApi, LangInfo } from '../shared/i18n/api'

let info = ipcRenderer.sendSync('lang:get') as LangInfo
const subs = new Set<(i: LangInfo) => void>()
ipcRenderer.on('lang:changed', (_e, i: LangInfo) => {
  info = i
  for (const f of [...subs]) f(i)
})

const api: LangApi = {
  info: () => info,
  set: (setting) => ipcRenderer.invoke('lang:set', setting),
  onChange(cb) {
    subs.add(cb)
    return () => void subs.delete(cb)
  },
}

contextBridge.exposeInMainWorld('cnLang', api)
