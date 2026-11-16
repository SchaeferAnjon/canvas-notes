import { contextBridge, ipcRenderer } from 'electron'
import type { CnApi } from '../shared/api'
import { folderApi } from './folder-home'
import { importApi } from './importer'
import { mapApi } from './mindmap'
import { pluginsApi } from './plugins'
import { readingApi } from './reading'
import { searchApi } from './search'
import type { CnFilesApi } from '../shared/files'
import { videoApi } from './video-api'
import { webApi } from './web'

const api: CnApi = {
  vault: () => ipcRenderer.invoke('vault:get'),
  chooseVault: () => ipcRenderer.invoke('vault:choose'),
  listNotes: () => ipcRenderer.invoke('notes:list'),
  readNote: (path) => ipcRenderer.invoke('note:read', path),
  writeNote: (path, text, base) => ipcRenderer.invoke('note:write', path, text, base),
  saveConflictCopy: (path, text) => ipcRenderer.invoke('note:conflictCopy', path, text),
  createNote: (folder, name, text) => ipcRenderer.invoke('note:create', folder, name, text),
  renameNote: (path, newName) => ipcRenderer.invoke('note:rename', path, newName),
  createBoard: (folder, name) => ipcRenderer.invoke('board:create', folder, name),
  trashNote: (path) => ipcRenderer.invoke('note:trash', path),
  capture: (text) => ipcRenderer.invoke('inbox:capture', text),
  clipToInbox: (clip) => ipcRenderer.invoke('web:clip', clip),
  clipCurrentPage: (arg) => ipcRenderer.invoke('web:clip-page', arg?.webUrl ?? null),
  chromeProfiles: () => ipcRenderer.invoke('chrome:profiles'),
  importChrome: (id) => ipcRenderer.invoke('chrome:import', id),
  aiAsk: (id, system, prompt) => ipcRenderer.invoke('ai:ask', id, system, prompt),
  aiStop: (id) => ipcRenderer.invoke('ai:stop', id),
  aiChange: (change) => ipcRenderer.invoke('ai:change', change),
  aiRevert: (hash) => ipcRenderer.invoke('ai:revert', hash),
  search: (q) => ipcRenderer.invoke('search', q),
  noteMenu: (path) => ipcRenderer.invoke('note:menu', path),
  pins: () => ipcRenderer.invoke('pins:get'),
  logActivity: (kind, path) => ipcRenderer.invoke('activity:log', kind, path),
  activity: () => ipcRenderer.invoke('activity:get'),
  gitState: () => ipcRenderer.invoke('git:state'),
  commit: () => ipcRenderer.invoke('git:commit'),
  sync: () => ipcRenderer.invoke('git:sync'),
  history: (limit) => ipcRenderer.invoke('git:history', limit),
  commitFileDiff: (hash, path) => ipcRenderer.invoke('git:file-diff', hash, path),
  pickImage: () => ipcRenderer.invoke('attach:pickImage'),
  settings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  pickWinBg: () => ipcRenderer.invoke('settings:pickWinBg'),
  themes: () => ipcRenderer.invoke('themes:list'),
  importTheme: () => ipcRenderer.invoke('themes:import'),
  removeTheme: (id) => ipcRenderer.invoke('themes:remove', id),
  homeConfig: () => ipcRenderer.invoke('home:get'),
  saveHomeConfig: (cfg) => ipcRenderer.invoke('home:set', cfg),
  pickCover: () => ipcRenderer.invoke('home:pickCover'),
  dropCover: (bytes, name) => ipcRenderer.invoke('home:dropCover', bytes, name),
  gitRemote: () => ipcRenderer.invoke('git:remote'),
  setGitRemote: (url) => ipcRenderer.invoke('git:setRemote', url),
  onNoteChanged(cb) {
    const h = (_e: unknown, path: string, text: string) => cb(path, text)
    ipcRenderer.on('note:changed', h)
    return () => ipcRenderer.removeListener('note:changed', h)
  },
  updateStatus: () => ipcRenderer.invoke('update:status'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  moveToApps: () => ipcRenderer.invoke('update:moveToApps'),
  revealApp: () => ipcRenderer.invoke('update:reveal'),
  releaseUrl: () => ipcRenderer.invoke('update:releaseUrl'),
  onUpdateState(cb) {
    const h = (_e: unknown, s: Parameters<typeof cb>[0]) => cb(s)
    ipcRenderer.on('update:state', h)
    return () => ipcRenderer.removeListener('update:state', h)
  },
  onUpdateOpen(cb) {
    const h = () => cb()
    ipcRenderer.on('update:open', h)
    return () => ipcRenderer.removeListener('update:open', h)
  },
  onAppKey(cb) {
    const h = (_e: unknown, k: string) => cb(k)
    ipcRenderer.on('app:key', h)
    return () => ipcRenderer.removeListener('app:key', h)
  },
  onFilesChanged(cb) {
    const h = () => cb()
    ipcRenderer.on('files:changed', h)
    return () => ipcRenderer.removeListener('files:changed', h)
  },
  aiEngines: () => ipcRenderer.invoke('ai:engines'),
  aiSetEngine: (id) => ipcRenderer.invoke('ai:engine:set', id),
  aiTurn: (req) => ipcRenderer.invoke('ai:turn', req),
  aiTurnStop: (id) => ipcRenderer.invoke('ai:turn:stop', id),
  aiChatLoad: () => ipcRenderer.invoke('ai:chat:load'),
  aiChatSave: (msgs) => ipcRenderer.invoke('ai:chat:save', msgs),
  aiChatClear: () => ipcRenderer.invoke('ai:chat:clear'),
  onAiEvent(cb) {
    const h = (_e: unknown, id: number, ev: Parameters<typeof cb>[1]) => cb(id, ev)
    ipcRenderer.on('ai:event', h)
    return () => ipcRenderer.removeListener('ai:event', h)
  },
  onAiCall(cb) {
    const h = (_e: unknown, id: number, op: Parameters<typeof cb>[1], arg: unknown) => cb(id, op, arg)
    ipcRenderer.on('ai:call', h)
    return () => ipcRenderer.removeListener('ai:call', h)
  },
  aiReply: (id, ok, value) => ipcRenderer.invoke('ai:reply', id, ok, value),
  findDuplicates: () => ipcRenderer.invoke('notes:duplicates'),
  dreamReport: () => ipcRenderer.invoke('dream:report'),
  dreamNow: () => ipcRenderer.invoke('dream:now'),
  dreamTake: (id) => ipcRenderer.invoke('dream:take', id),
  dreamDrop: (id) => ipcRenderer.invoke('dream:drop', id),
  dreamTakeAll: () => ipcRenderer.invoke('dream:takeAll'),
  dreamTakeMany: (ids) => ipcRenderer.invoke('dream:takeMany', ids),
  dreamDropMany: (ids) => ipcRenderer.invoke('dream:dropMany', ids),
  dreamUndo: (u) => ipcRenderer.invoke('dream:undo', u),
  dreamRedo: (ids, feedback) => ipcRenderer.invoke('dream:redo', ids, feedback),
  dreamRedoStop: () => ipcRenderer.invoke('dream:redoStop'),
  dreamDiff: (id) => ipcRenderer.invoke('dream:diff', id),
  onDream(cb) {
    const h = (_e: unknown, report: Parameters<typeof cb>[0], running: boolean) => cb(report, running)
    ipcRenderer.on('dream:changed', h)
    return () => ipcRenderer.removeListener('dream:changed', h)
  },
}

contextBridge.exposeInMainWorld('cn', api)
contextBridge.exposeInMainWorld('cnWeb', webApi)
contextBridge.exposeInMainWorld('cnPlugins', pluginsApi)
contextBridge.exposeInMainWorld('cnMap', mapApi)
contextBridge.exposeInMainWorld('cnFolder', folderApi)
contextBridge.exposeInMainWorld('cnReading', readingApi)
contextBridge.exposeInMainWorld('cnSearch', searchApi)
contextBridge.exposeInMainWorld('cnFiles', { all: () => ipcRenderer.invoke('files:all') } satisfies CnFilesApi)
contextBridge.exposeInMainWorld('cnVideo', videoApi)
contextBridge.exposeInMainWorld('cnImport', importApi)
