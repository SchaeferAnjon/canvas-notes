import { contextBridge, ipcRenderer } from 'electron'
import type { CnApi } from '../shared/api'
import { folderApi } from './folder-home'
import { importApi } from './importer'
import { mapApi } from './mindmap'
import { pluginsApi } from './plugins'
import { readingApi } from './reading'
import { searchApi } from './search'
import type { CnFilesApi } from '../shared/files'
import type { CnAttachApi } from '../shared/attach'
import { videoApi } from './video-api'
import { webApi } from './web'
import { menuApi } from './ctx-menu'
import { cmdsApi } from './commands'

const api: CnApi = {
  vault: () => ipcRenderer.invoke('vault:get'),
  tidyUndo: (t) => ipcRenderer.invoke('vault:tidy:undo', t),
  chooseVault: () => ipcRenderer.invoke('vault:choose'),
  listNotes: () => ipcRenderer.invoke('notes:list'),
  readNote: (path) => ipcRenderer.invoke('note:read', path),
  writeNote: (path, text, base) => ipcRenderer.invoke('note:write', path, text, base),
  rescueNote: (path, text) => ipcRenderer.invoke('note:rescue', path, text),
  stashNote: (path, text, into) => ipcRenderer.invoke('note:stash', path, text, into),
  revealStash: (file) => ipcRenderer.invoke('note:revealStash', file),
  saveConflictCopy: (path, text) => ipcRenderer.invoke('note:conflictCopy', path, text),
  createNote: (folder, name, text) => ipcRenderer.invoke('note:create', folder, name, text),
  renameNote: (path, newName, free) => ipcRenderer.invoke('note:rename', path, newName, free),
  createBoard: (folder, name) => ipcRenderer.invoke('board:create', folder, name),
  trashNote: (path) => ipcRenderer.invoke('note:trash', path),
  trashFiles: (paths) => ipcRenderer.invoke('files:trash', paths),
  capture: (text) => ipcRenderer.invoke('inbox:capture', text),
  clipToInbox: (clip) => ipcRenderer.invoke('web:clip', clip),
  clipCurrentPage: (arg) => ipcRenderer.invoke('web:clip-page', arg?.webUrl ?? null),
  chromeProfiles: () => ipcRenderer.invoke('chrome:profiles'),
  importChrome: (id) => ipcRenderer.invoke('chrome:import', id),
  aiAsk: (id, system, prompt) => ipcRenderer.invoke('ai:ask', id, system, prompt),
  aiStop: (id) => ipcRenderer.invoke('ai:stop', id),
  aiChange: (change) => ipcRenderer.invoke('ai:change', change),
  aiCommit: (paths, message) => ipcRenderer.invoke('ai:commit', paths, message),
  aiRevert: (hash, only) => ipcRenderer.invoke('ai:revert', hash, only),
  boardConvert: (path, force) => ipcRenderer.invoke('board:convert', path, force === true),
  boardKeepOld: (path, old, converted) => ipcRenderer.invoke('board:keepOld', path, old, converted),
  boardBases: () => ipcRenderer.invoke('board:bases'),
  backlinks: (path) => ipcRenderer.invoke('board:backlinks', path),
  boardCommit: (paths, message) => ipcRenderer.invoke('board:commit', paths, message),
  boardRevert: (hash) => ipcRenderer.invoke('board:revert', hash),
  search: (q) => ipcRenderer.invoke('search', q),
  pins: () => ipcRenderer.invoke('pins:get'),
  logActivity: (kind, path) => ipcRenderer.invoke('activity:log', kind, path),
  activity: () => ipcRenderer.invoke('activity:get'),
  gitState: () => ipcRenderer.invoke('git:state'),
  commit: () => ipcRenderer.invoke('git:commit'),
  sync: () => ipcRenderer.invoke('git:sync'),
  history: (limit, opts) => ipcRenderer.invoke('git:history', limit, opts),
  restorable: (hash) => ipcRenderer.invoke('git:restorable', hash),
  restoreDeleted: (hash, only) => ipcRenderer.invoke('git:restore', hash, only),
  undoRestore: (commit) => ipcRenderer.invoke('git:restore-undo', commit),
  pickImage: (note) => ipcRenderer.invoke('attach:pickImage', note),
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
  gitIdentity: () => ipcRenderer.invoke('git:identity'),
  setGitIdentity: (name, email) => ipcRenderer.invoke('git:setIdentity', name, email),
  onNoteChanged(cb) {
    const h = (_e: unknown, path: string, text: string) => cb(path, text)
    ipcRenderer.on('note:changed', h)
    return () => ipcRenderer.removeListener('note:changed', h)
  },
  onNoteRenamed(cb) {
    const h = (_e: unknown, from: string, to: string, own?: boolean) => cb(from, to, own === true)
    ipcRenderer.on('note:renamed', h)
    return () => ipcRenderer.removeListener('note:renamed', h)
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
  aiEngines: (again) => ipcRenderer.invoke('ai:engines', again === true),
  aiPickCli: (id) => ipcRenderer.invoke('ai:cli:pick', id),
  aiSetEngine: (id) => ipcRenderer.invoke('ai:engine:set', id),
  aiSetOmni: (on) => ipcRenderer.invoke('ai:omni:set', on),
  aiSetChatPick: (pick) => ipcRenderer.invoke('ai:chat:set', pick),
  aiPrefs: () => ipcRenderer.invoke('ai:prefs'),
  aiSetPrefs: (p) => ipcRenderer.invoke('ai:prefs:set', p),
  onAiPrefsChanged(cb) {
    const h = () => cb()
    ipcRenderer.on('ai:prefs:changed', h)
    return () => ipcRenderer.removeListener('ai:prefs:changed', h)
  },
  aiTurn: (req) => ipcRenderer.invoke('ai:turn', req),
  aiTurnStop: (id) => ipcRenderer.invoke('ai:turn:stop', id),
  aiPaste: (bytes, mime) => ipcRenderer.invoke('ai:paste', bytes, mime),
  aiPickImages: (room) => ipcRenderer.invoke('ai:paste:pick', room),
  aiChatPick: (place) => ipcRenderer.invoke('ai:chat:pick', place),
  aiChatSetPick: (place, pick) => ipcRenderer.invoke('ai:chat:pick:set', place, pick),
  aiChatLoad: (place) => ipcRenderer.invoke('ai:chat:load', place),
  aiChatSave: (place, label, msgs) => ipcRenderer.invoke('ai:chat:save', place, label, msgs),
  aiChatClear: (place) => ipcRenderer.invoke('ai:chat:clear', place),
  aiChats: () => ipcRenderer.invoke('ai:chats'),
  onAiEvent(cb) {
    const h = (_e: unknown, id: number, ev: Parameters<typeof cb>[1]) => cb(id, ev)
    ipcRenderer.on('ai:event', h)
    return () => ipcRenderer.removeListener('ai:event', h)
  },
  onAiAct(cb) {
    const h = (_e: unknown, a: Parameters<typeof cb>[0]) => cb(a)
    ipcRenderer.on('ai:act', h)
    return () => ipcRenderer.removeListener('ai:act', h)
  },
  onAiCall(cb) {
    const h = (_e: unknown, id: number, op: Parameters<typeof cb>[1], arg: unknown) => cb(id, op, arg)
    ipcRenderer.on('ai:call', h)
    return () => ipcRenderer.removeListener('ai:call', h)
  },
  aiReply: (id, ok, value) => ipcRenderer.invoke('ai:reply', id, ok, value),
  findDuplicates: () => ipcRenderer.invoke('notes:duplicates'),
  onDuplicatesProgress(cb) {
    const h = (_e: unknown, p: Parameters<typeof cb>[0]) => cb(p)
    ipcRenderer.on('notes:dups-progress', h)
    return () => ipcRenderer.removeListener('notes:dups-progress', h)
  },
  stopDuplicates: () => ipcRenderer.invoke('notes:duplicates-stop'),
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
  diffFiles: (src) => ipcRenderer.invoke('diff:files', src),
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
contextBridge.exposeInMainWorld('cnFiles', { all: () => ipcRenderer.invoke('files:all'), attachments: () => ipcRenderer.invoke('files:attachments') } satisfies CnFilesApi)
contextBridge.exposeInMainWorld('cnVideo', videoApi)
contextBridge.exposeInMainWorld('cnImport', importApi)
contextBridge.exposeInMainWorld('cnMenu', menuApi)
contextBridge.exposeInMainWorld('cnCmds', cmdsApi)
contextBridge.exposeInMainWorld('cnAttach', {
  of: (note, shared) => ipcRenderer.invoke('attach:of', note, shared),
  trashNote: (note, withImages) => ipcRenderer.invoke('attach:trash-note', note, withImages),
  undo: (id) => ipcRenderer.invoke('attach:undo', id),
} satisfies CnAttachApi)
