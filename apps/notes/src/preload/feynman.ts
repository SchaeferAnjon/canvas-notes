import { ipcRenderer } from 'electron'
import type { CnFeynmanApi } from '../shared/feynman/api'

/** 费曼学习（task-yvabi）：实现在 main/feynman.ts */
export const feynmanApi: CnFeynmanApi = {
  extract: (reqId, req) => ipcRenderer.invoke('feynman:extract', reqId, req),
  split: (reqId, req) => ipcRenderer.invoke('feynman:split', reqId, req),
  turn: (req) => ipcRenderer.invoke('feynman:turn', req),
  judge: (req) => ipcRenderer.invoke('feynman:judge', req),
  stop: (reqId) => ipcRenderer.invoke('feynman:stop', reqId),
  onText: (cb) => {
    const h = (_e: unknown, reqId: number, delta: string) => cb(reqId, delta)
    ipcRenderer.on('feynman:text', h)
    return () => void ipcRenderer.removeListener('feynman:text', h)
  },
  engine: () => ipcRenderer.invoke('feynman:engine'),
  course: (folder, today, exam) => ipcRenderer.invoke('feynman:course', folder, today, exam ?? null),
}
