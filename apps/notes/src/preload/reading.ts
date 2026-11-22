/** window.cnReading：读 PDF 边读边问（见 shared/reading.ts） */
import { ipcRenderer } from 'electron'
import type { AskEvent, CardEvent, CnReadingApi } from '../shared/reading'

export const readingApi: CnReadingApi = {
  listPdfs: () => ipcRenderer.invoke('reading:listPdfs'),
  pdfData: (path) => ipcRenderer.invoke('reading:pdf', path),
  state: (pdf) => ipcRenderer.invoke('reading:state', pdf),
  saveState: (state) => ipcRenderer.invoke('reading:state:save', state),
  saveCrop: (pdf, page, png) => ipcRenderer.invoke('reading:crop', pdf, page, png),
  newThread: (pdf, page) => ipcRenderer.invoke('reading:thread', pdf, page),
  setText: (hash, pdf, pages, sizes) => ipcRenderer.invoke('reading:text:set', hash, pdf, pages, sizes),
  getText: (hash) => ipcRenderer.invoke('reading:text:get', hash),
  ask: (req) => ipcRenderer.invoke('reading:ask', req),
  stop: (id) => ipcRenderer.invoke('reading:stop', id),
  onAsk(cb) {
    const h = (_e: unknown, id: number, ev: AskEvent) => cb(id, ev)
    ipcRenderer.on('reading:event', h)
    return () => ipcRenderer.removeListener('reading:event', h)
  },
  summarize: (req) => ipcRenderer.invoke('reading:summarize', req),
  writeSection: (req) => ipcRenderer.invoke('reading:section', req),
  readNote: (pdf) => ipcRenderer.invoke('reading:note', pdf),
  reveal: (pdf) => ipcRenderer.invoke('reading:reveal', pdf),
  htmlMeta: (path) => ipcRenderer.invoke('reading:htmlMeta', path),
  onOpenAt(cb) {
    const h = (_e: unknown, a: Parameters<typeof cb>[0]) => cb(a)
    ipcRenderer.on('reading:openAt', h)
    return () => ipcRenderer.removeListener('reading:openAt', h)
  },
  cards: (scope) => ipcRenderer.invoke('reading:cards', scope),
  draftCards: (job, scope, ids) => ipcRenderer.invoke('reading:cards:draft', job, scope, ids),
  stopCards: (job) => ipcRenderer.invoke('reading:cards:stop', job),
  onCards(cb) {
    const h = (_e: unknown, ev: CardEvent) => cb(ev)
    ipcRenderer.on('reading:cards:event', h)
    return () => ipcRenderer.removeListener('reading:cards:event', h)
  },
  keepCard: (id, patch) => ipcRenderer.invoke('reading:cards:keep', id, patch),
  sendCards: (scope, cards) => ipcRenderer.invoke('reading:cards:send', scope, cards),
  undoCards: (scope, ids) => ipcRenderer.invoke('reading:cards:undo', scope, ids),
  ankiStatus: () => ipcRenderer.invoke('reading:anki:status'),
  openAnki: (browse) => ipcRenderer.invoke('reading:anki:open', browse),
  ankiReview: (folder) => ipcRenderer.invoke('reading:anki:review', folder),
  ankiDownload: () => ipcRenderer.invoke('reading:anki:download'),
  viz: (req) => ipcRenderer.invoke('reading:viz', req),
  forget: (pdf) => ipcRenderer.invoke('reading:forget', pdf),
  saveBilingual: (req) => ipcRenderer.invoke('reading:bilingual:save', req),
  capture: (wcId, rect) => ipcRenderer.invoke('reading:capture', wcId, rect),
  commit: (paths, message) => ipcRenderer.invoke('reading:commit', paths, message),
}
