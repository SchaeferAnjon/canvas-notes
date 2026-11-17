/** window.cnVideo：看视频的接口（见 shared/video-api.ts） */
import { ipcRenderer } from 'electron'
import type { CnVideoApi } from '../shared/video-api'

function on<T extends unknown[]>(channel: string, cb: (...args: T) => void): () => void {
  const h = (_e: unknown, ...args: unknown[]) => cb(...(args as T))
  ipcRenderer.on(channel, h)
  return () => ipcRenderer.removeListener(channel, h)
}

export const videoApi: CnVideoApi = {
  state: (wcId) => ipcRenderer.invoke('video:state', wcId),
  onState: (cb) => on('video:state', cb),
  settings: () => ipcRenderer.invoke('video:settings'),
  setSettings: (patch) => ipcRenderer.invoke('video:set-settings', patch),
  onSettings: (cb) => on('video:settings', cb),
  useTrack: (wcId, lang) => ipcRenderer.invoke('video:use-track', wcId, lang),
  setTarget: (target) => ipcRenderer.invoke('video:set-target', target),
  moment: (r) => ipcRenderer.invoke('video:moment', r),
  ask: (r) => ipcRenderer.invoke('video:ask', r),
  askStop: (wcId) => ipcRenderer.invoke('video:ask:stop', wcId),
  commit: (paths, message, mark) => ipcRenderer.invoke('video:commit', paths, message, mark),
  undo: (hash, mark) => ipcRenderer.invoke('video:undo', hash, mark),
  onKey: (cb) => on('video:key', cb),
  meta: (url) => ipcRenderer.invoke('video:meta', url),
  lastPos: (key) => ipcRenderer.invoke('video:last-pos', key),
  transcribe: (r) => ipcRenderer.invoke('video:transcribe', r),
  stopTranscribe: (wcId) => ipcRenderer.invoke('video:transcribe-stop', wcId),
  sttKey: () => ipcRenderer.invoke('video:stt-key'),
  setSttKey: (key) => ipcRenderer.invoke('video:set-stt-key', key),
  onNotice: (cb) => on('video:notice', cb),
  testOrigin: ipcRenderer.sendSync('video:test-origin') as string | null,
}
