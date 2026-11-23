import { ipcRenderer } from 'electron'
import type { CnMapApi } from '../shared/mindmap-api'

function on<T>(channel: string, cb: (v: T) => void): () => void {
  const h = (_e: unknown, v: T) => cb(v)
  ipcRenderer.on(channel, h)
  return () => void ipcRenderer.removeListener(channel, h)
}

export const mapApi: CnMapApi = {
  cameraStatus: () => ipcRenderer.invoke('map:camera-status'),
  cameraAsk: () => ipcRenderer.invoke('map:camera-ask'),
  cameraSettings: () => ipcRenderer.invoke('map:camera-settings'),
  stage: (bytes, name) => ipcRenderer.invoke('map:stage', bytes, name),
  pick: () => ipcRenderer.invoke('map:pick'),
  discard: (id) => ipcRenderer.invoke('map:discard', id),
  recognize: (reqId, photoId, course) => ipcRenderer.invoke('map:recognize', reqId, photoId, course),
  stop: (reqId) => ipcRenderer.invoke('map:stop', reqId),
  place: (req) => ipcRenderer.invoke('map:place', req),
  watchAirdrop: (v) => ipcRenderer.invoke('map:airdrop', v),
  onAirdrop: (cb) => on('map:airdropped', cb),
  onAirdropError: (cb) => on('map:airdrop-error', cb),
  onOpen: (cb) => on('map:open', () => cb()),
  exportFile: (fmt, name, data) => ipcRenderer.invoke('map:export', fmt, name, data),
  exportPdf: (name, svg, paper) => ipcRenderer.invoke('map:export-pdf', name, svg, paper),
  imageData: (path) => ipcRenderer.invoke('map:image-data', path),
}
