import { ipcRenderer } from 'electron'
import type { CnMcpApi, McpCall } from '../shared/mcp'

/** 设置 › 对外接口（task-av5t8）：实现在 main/mcp-ext.ts */
export const mcpApi: CnMcpApi = {
  get: () => ipcRenderer.invoke('mcp:get'),
  setOn: (on) => ipcRenderer.invoke('mcp:setOn', on),
  install: (id) => ipcRenderer.invoke('mcp:install', id),
  remove: (id) => ipcRenderer.invoke('mcp:remove', id),
  copyConfig: (id) => ipcRenderer.invoke('mcp:copyConfig', id),
  copyText: (text) => ipcRenderer.invoke('mcp:copyText', text),
  recheck: () => ipcRenderer.invoke('mcp:recheck'),
  calls: (q) => ipcRenderer.invoke('mcp:calls', q),
  onCalled: (f) => {
    const h = (_e: unknown, c: McpCall) => f(c)
    ipcRenderer.on('mcp:called', h)
    return () => void ipcRenderer.off('mcp:called', h)
  },
}
