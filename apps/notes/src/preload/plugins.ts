/** window.cnPlugins：内置插件的接口（见 shared/plugins.ts） */
import { ipcRenderer } from 'electron'
import type { CnPluginsApi, PluginInfo } from '../shared/plugins'

export const pluginsApi: CnPluginsApi = {
  list: () => ipcRenderer.invoke('plugins:list'),
  setEnabled: (id, on) => ipcRenderer.invoke('plugins:enable', id, on),
  setSettings: (id, patch) => ipcRenderer.invoke('plugins:settings', id, patch),
  call: (id, method, ...args) => ipcRenderer.invoke('plugins:call', id, method, args),
  onChanged(cb) {
    const h = (_e: unknown, list: PluginInfo[]) => cb(list)
    ipcRenderer.on('plugins:changed', h)
    return () => ipcRenderer.removeListener('plugins:changed', h)
  },
  on(id, event, cb) {
    const h = (_e: unknown, pid: string, ev: string, payload: unknown) => {
      if (pid === id && ev === event) cb(payload)
    }
    ipcRenderer.on('plugins:event', h)
    return () => ipcRenderer.removeListener('plugins:event', h)
  },
}
