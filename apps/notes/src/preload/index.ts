import './lang'
import type { CnFeedsApi } from '../shared/feeds-widget'
import { contextBridge, ipcRenderer } from 'electron'
import type { CnApi } from '../shared/api'
import { folderApi } from './folder-home'
import { importApi } from './importer'
import { mapApi } from './mindmap'
import { afterApi } from './feynman-after'
import { pluginsApi } from './plugins'
import { readingApi } from './reading'
import { searchApi } from './search'
import type { CnFilesApi } from '../shared/files'
import type { CnAttachApi } from '../shared/attach'
import { videoApi } from './video-api'
import { webApi } from './web'
import { menuApi } from './ctx-menu'
import { cmdsApi } from './commands'
import { readApi } from './read-along'
import { todoApi, whenApi } from './todo'
import { familyApi } from './family'
import { mcpApi } from './mcp'
import { calApi } from './calendar'
import { mcApi } from './meetcaption'
import { mobileAiApi } from './mobile-ai'
import { crashApi } from './crash'
import { voiceApi } from './voice'
import { feynmanApi } from './feynman'

/** 听主进程发来的一种事，交回取消的函数 */
function listen<T>(ch: string, cb: (x: T) => void): () => void {
  const h = (_e: unknown, x: T) => cb(x)
  ipcRenderer.on(ch, h)
  return () => ipcRenderer.removeListener(ch, h)
}

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
  createBoard: (folder, name, parent) => ipcRenderer.invoke('board:create', folder, name, parent),
  trashNote: (path) => ipcRenderer.invoke('note:trash', path),
  trashFiles: (paths) => ipcRenderer.invoke('files:trash', paths),
  capture: (text) => ipcRenderer.invoke('inbox:capture', text),
  clipToInbox: (clip) => ipcRenderer.invoke('web:clip', clip),
  clipImageCard: (c) => ipcRenderer.invoke('web:clip-img', c),
  webCards: (url) => ipcRenderer.invoke('web:cards', url),
  clipCurrentPage: (arg) => ipcRenderer.invoke('web:clip-page', arg?.webUrl ?? null, arg?.folder ?? undefined, arg?.into ?? undefined),
  chromeProfiles: () => ipcRenderer.invoke('chrome:profiles'),
  importChrome: (id) => ipcRenderer.invoke('chrome:import', id),
  lookReady: () => ipcRenderer.send('look:ready'),
  aiAsk: (id, system, prompt, opts) => ipcRenderer.invoke('ai:ask', id, system, prompt, opts),
  aiCmdPrep: (path, first) => ipcRenderer.invoke('aicmd:prep', path, first),
  aiCmdLocal: () => ipcRenderer.invoke('aicmd:local:get'),
  aiCmdSetLocal: (list) => ipcRenderer.invoke('aicmd:local:set', list),
  aiCmdWeek: () => ipcRenderer.invoke('aicmd:week'),
  aiCmdOcrLines: (path) => ipcRenderer.invoke('aicmd:ocr-lines', path),
  aiCmdVideo: () => ipcRenderer.invoke('aicmd:video'),
  aiCmdPage: () => ipcRenderer.invoke('aicmd:page'),
  aiStop: (id) => ipcRenderer.invoke('ai:stop', id),
  aiChange: (change) => ipcRenderer.invoke('ai:change', change),
  aiCommit: (paths, message) => ipcRenderer.invoke('ai:commit', paths, message),
  aiRevert: (hash, only) => ipcRenderer.invoke('ai:revert', hash, only),
  boardConvert: (path, force) => ipcRenderer.invoke('board:convert', path, force === true),
  boardKeepOld: (path, old, converted) => ipcRenderer.invoke('board:keepOld', path, old, converted),
  summaryConvert: (path) => ipcRenderer.invoke('board:summaryConvert', path),
  trashRecent: () => ipcRenderer.invoke('trash:recent'),
  trashPreview: (path, commit) => ipcRenderer.invoke('trash:preview', path, commit),
  trashCommitPending: (paths) => ipcRenderer.invoke('trash:commit-pending', paths),
  summaryKeepOld: (path, old, converted) => ipcRenderer.invoke('board:summaryKeepOld', path, old, converted),
  boardBases: () => ipcRenderer.invoke('board:bases'),
  backlinks: (path) => ipcRenderer.invoke('related:backlinks', path),
  related: (path) => ipcRenderer.invoke('related:get', path),
  relatedLink: (path, other, near) => ipcRenderer.invoke('related:link', path, other, near),
  relatedUnrelated: (path, other) => ipcRenderer.invoke('related:unrelated', path, other),
  relatedUnlink: (path, other, src) => ipcRenderer.invoke('related:unlink', path, other, src),
  relatedUndo: (u) => ipcRenderer.invoke('related:undo', u),
  relatedEntry: (name, from) => ipcRenderer.invoke('related:entry', name, from),
  relatedEntryNo: (name) => ipcRenderer.invoke('related:entry-no', name),
  relatedDot: (path) => ipcRenderer.invoke('related:dot', path),
  relatedSeen: (path) => ipcRenderer.invoke('related:seen', path),
  boardCommit: (paths, message) => ipcRenderer.invoke('board:commit', paths, message),
  boardRevert: (hash) => ipcRenderer.invoke('board:revert', hash),
  inkRead: (notePath) => ipcRenderer.invoke('ink:read', notePath),
  inkWrite: (notePath, text, base, message) => ipcRenderer.invoke('ink:write', notePath, text, base, message),
  decorSticker: (k, svg) => ipcRenderer.invoke('decor:sticker', k, svg),
  baseWrite: (writes, message) => ipcRenderer.invoke('base:write', writes, message),
  aiColRun: (run) => ipcRenderer.invoke('aicol:run', run),
  aiColStop: (job) => ipcRenderer.invoke('aicol:stop', job),
  aiColUndo: (writes, message) => ipcRenderer.invoke('aicol:undo', writes, message),
  onAiColProgress(cb) {
    const h = (_e: unknown, p: Parameters<typeof cb>[0]) => cb(p)
    ipcRenderer.on('aicol:progress', h)
    return () => ipcRenderer.removeListener('aicol:progress', h)
  },
  onAiColDone(cb) {
    const h = (_e: unknown, d: Parameters<typeof cb>[0]) => cb(d)
    ipcRenderer.on('aicol:done', h)
    return () => ipcRenderer.removeListener('aicol:done', h)
  },
  aiColSources: (folder, col) => ipcRenderer.invoke('aicol:sources', folder, col),
  aiColFresh: (folder, col, paths) => ipcRenderer.invoke('aicol:fresh', folder, col, paths),
  aiColNotes: (paths) => ipcRenderer.invoke('aicol:notes', paths),
  sources: {
    list: () => ipcRenderer.invoke('sources:list'),
    connect: (id, key, client) => ipcRenderer.invoke('sources:connect', id, key, client),
    firstPull: (id, pick) => ipcRenderer.invoke('sources:firstPull', id, pick),
    pull: (id) => ipcRenderer.invoke('sources:pull', id),
    settings: (id, patch) => ipcRenderer.invoke('sources:settings', id, patch),
    disconnect: (id) => ipcRenderer.invoke('sources:disconnect', id),
    onProgress: (cb) => listen('sources:progress', cb),
    onChanged: (cb) => listen('sources:changed', () => cb()),
    onDone: (cb) => listen('sources:done', cb),
  },
  auto: {
    list: (where) => ipcRenderer.invoke('auto:list', where),
    save: (req) => ipcRenderer.invoke('auto:save', req),
    toggle: (ref, on) => ipcRenderer.invoke('auto:toggle', ref, on),
    remove: (ref) => ipcRenderer.invoke('auto:remove', ref),
    run: (req) => ipcRenderer.invoke('auto:run', req),
    button: (req) => ipcRenderer.invoke('auto:button', req),
    stop: (run) => ipcRenderer.invoke('auto:stop', run),
    trial: (req) => ipcRenderer.invoke('auto:trial', req),
    log: (req) => ipcRenderer.invoke('auto:log', req),
    undo: (id) => ipcRenderer.invoke('auto:undo', id),
    fromSentence: (req) => ipcRenderer.invoke('auto:fromSentence', req),
    prefs: (patch) => ipcRenderer.invoke('auto:prefs', patch),
    system: (id, on) => ipcRenderer.invoke('auto:system', id, on),
    systemRun: (id) => ipcRenderer.invoke('auto:systemRun', id),
    onStarted: (cb) => listen('auto:started', cb),
    onDone: (cb) => listen('auto:done', cb),
    onCommand: (cb) => listen('auto:command', cb),
    onChanged: (cb) => listen('auto:changed', () => cb()),
  },
  search: (q) => ipcRenderer.invoke('search', q),
  pins: () => ipcRenderer.invoke('pins:get'),
  logActivity: (kind, path) => ipcRenderer.invoke('activity:log', kind, path),
  activity: () => ipcRenderer.invoke('activity:get'),
  gitState: () => ipcRenderer.invoke('git:state'),
  commit: () => ipcRenderer.invoke('git:commit'),
  sync: () => ipcRenderer.invoke('git:sync'),
  history: (limit, opts) => ipcRenderer.invoke('git:history', limit, opts),
  commitInfo: (hash) => ipcRenderer.invoke('git:commit-info', hash),
  lineTimes: (path) => ipcRenderer.invoke('git:line-times', path),
  restorable: (hash) => ipcRenderer.invoke('git:restorable', hash),
  restoreDeleted: (hash, only) => ipcRenderer.invoke('git:restore', hash, only),
  undoRestore: (commit) => ipcRenderer.invoke('git:restore-undo', commit),
  pickImage: (note) => ipcRenderer.invoke('attach:pickImage', note),
  settings: () => ipcRenderer.invoke('settings:get'),
  quickState: () => ipcRenderer.invoke('quick:state'),
  gitIgnore: () => ipcRenderer.invoke('git:ignore'),
  setGitIgnore: (text) => ipcRenderer.invoke('git:set-ignore', text),
  backupState: () => ipcRenderer.invoke('git:backup-state'),
  backupNow: () => ipcRenderer.invoke('git:backup-now'),
  pickBackupDir: () => ipcRenderer.invoke('git:pick-backup-dir'),
  dataDir: () => ipcRenderer.invoke('app:data-dir'),
  revealDataDir: () => ipcRenderer.invoke('app:reveal-data-dir'),
  onDownloaded(cb) {
    const h = (_e: unknown, d: Parameters<typeof cb>[0]) => cb(d)
    ipcRenderer.on('web:downloaded', h)
    return () => ipcRenderer.removeListener('web:downloaded', h)
  },
  revealDownload: (path) => ipcRenderer.invoke('web:reveal-download', path),
  onMainNotice(cb) {
    const h = (_e: unknown, t: string) => cb(t)
    ipcRenderer.on('app:notice', h)
    return () => ipcRenderer.removeListener('app:notice', h)
  },
  takeNotices: () => ipcRenderer.invoke('app:notices'),
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
  onOpenNoteAt(cb) {
    const h = (_e: unknown, a: { file: string; line?: number; folder?: boolean }) => cb(a)
    ipcRenderer.on('note:openAt', h)
    return () => ipcRenderer.removeListener('note:openAt', h)
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
  aiKeySet: (id, key) => ipcRenderer.invoke('ai:key:set', id, key),
  aiKeyRemove: (id) => ipcRenderer.invoke('ai:key:remove', id),
  aiLocal: (again) => ipcRenderer.invoke('ai:local', again === true),
  aiConnect: (pick) => ipcRenderer.invoke('ai:connect', pick),
  aiIntroSeen: (what) => ipcRenderer.invoke('ai:intro:seen', what),
  aiOpenPage: (id) => ipcRenderer.invoke('ai:open-page', id),
  aiCcInstall: (mode) => ipcRenderer.invoke('ai:cc:install', mode),
  onAiCcLine: (cb) => {
    const h = (_e: unknown, line: string) => cb(line)
    ipcRenderer.on('ai:cc:line', h)
    return () => void ipcRenderer.removeListener('ai:cc:line', h)
  },
  aiCcLogin: () => ipcRenderer.invoke('ai:cc:login'),
  aiCcLoginCancel: () => ipcRenderer.invoke('ai:cc:login:cancel'),
  aiCcStatus: () => ipcRenderer.invoke('ai:cc:status'),
  aiPickCli: (id) => ipcRenderer.invoke('ai:cli:pick', id),
  aiCliCheck: (id) => ipcRenderer.invoke('ai:cli:check', id),
  aiCliUpdate: (id) => ipcRenderer.invoke('ai:cli:update', id),
  aiCliInstall: (id, mode) => ipcRenderer.invoke('ai:cli:install', id, mode),
  onAiCliLine: (cb) => {
    const h = (_e: unknown, m: Parameters<typeof cb>[0]) => cb(m)
    ipcRenderer.on('ai:cli:line', h)
    return () => void ipcRenderer.removeListener('ai:cli:line', h)
  },
  aiSetEngine: (id) => ipcRenderer.invoke('ai:engine:set', id),
  aiSetOmni: (on) => ipcRenderer.invoke('ai:omni:set', on),
  aiParallel: () => ipcRenderer.invoke('ai:parallel'),
  aiSetParallel: (n) => ipcRenderer.invoke('ai:parallel:set', n),
  aiPrompt: () => ipcRenderer.invoke('ai:prompt'),
  aiSetPrompt: (text) => ipcRenderer.invoke('ai:prompt:set', text),
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
  aiChatNote: (place) => ipcRenderer.invoke('ai:chat:note', place),
  aiChatSetNote: (place, to) => ipcRenderer.invoke('ai:chat:note:set', place, to),
  aiChatLoad: (place) => ipcRenderer.invoke('ai:chat:load', place),
  aiChatSave: (place, label, msgs, sides) => ipcRenderer.invoke('ai:chat:save', place, label, msgs, sides),
  aiChatSides: (place) => ipcRenderer.invoke('ai:chat:sides', place),
  aiSide: (req) => ipcRenderer.invoke('ai:side', req),
  aiChatClear: (place) => ipcRenderer.invoke('ai:chat:clear', place),
  aiChats: () => ipcRenderer.invoke('ai:chats'),
  aiPages: () => ipcRenderer.invoke('ai:pages'),
  aiConvos: () => ipcRenderer.invoke('ai:convos'),
  aiChatShelve: (place) => ipcRenderer.invoke('ai:chat:shelve', place),
  aiChatOlder: (place) => ipcRenderer.invoke('ai:chat:older', place),
  aiChatSwitch: (place, id) => ipcRenderer.invoke('ai:chat:switch', place, id),
  aiChatDetach: (place, label) => ipcRenderer.invoke('ai:chat:detach', place, label),
  aiSetPage: (convo, to) => ipcRenderer.invoke('ai:page:set', convo, to),
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
  dreamRoles: (fresh) => ipcRenderer.invoke('dream:roles', fresh === true),
  dreamRolesSave: (rows) => ipcRenderer.invoke('dream:rolesSave', rows),
  dreamNow: (arg) => ipcRenderer.invoke('dream:now', arg?.pick ?? null),
  dreamTake: (id) => ipcRenderer.invoke('dream:take', id),
  dreamDrop: (id) => ipcRenderer.invoke('dream:drop', id),
  dreamTakeAll: () => ipcRenderer.invoke('dream:takeAll'),
  dreamTakeMany: (ids) => ipcRenderer.invoke('dream:takeMany', ids),
  dreamDropMany: (ids) => ipcRenderer.invoke('dream:dropMany', ids),
  dreamUndo: (u) => ipcRenderer.invoke('dream:undo', u),
  dreamRedo: (ids, feedback) => ipcRenderer.invoke('dream:redo', ids, feedback),
  dreamRetarget: (id, want) => ipcRenderer.invoke('dream:retarget', id, want),
  dreamRedoStop: () => ipcRenderer.invoke('dream:redoStop'),
  diffFiles: (src) => ipcRenderer.invoke('diff:files', src),
  onDream(cb) {
    const h = (_e: unknown, report: Parameters<typeof cb>[0], running: boolean) => cb(report, running)
    ipcRenderer.on('dream:changed', h)
    return () => ipcRenderer.removeListener('dream:changed', h)
  },
  embedStatus: () => ipcRenderer.invoke('embed:status'),
  onEmbed(cb) {
    const h = (_e: unknown, s: Parameters<typeof cb>[0]) => cb(s)
    ipcRenderer.on('embed:status', h)
    return () => ipcRenderer.removeListener('embed:status', h)
  },
  embedRetry: () => ipcRenderer.invoke('embed:retry'),
  growthData: () => ipcRenderer.invoke('growth:data'),
  onGrowth(cb) {
    const h = (_e: unknown, s: Parameters<typeof cb>[0]) => cb(s)
    ipcRenderer.on('growth:changed', h)
    return () => ipcRenderer.removeListener('growth:changed', h)
  },
}

// 出错兜底最先挂上：后面哪个出了问题，出错页也能报日志、重新加载
contextBridge.exposeInMainWorld('cnCrash', crashApi)
contextBridge.exposeInMainWorld('cn', api)
contextBridge.exposeInMainWorld('cnWeb', webApi)
contextBridge.exposeInMainWorld('cnPlugins', pluginsApi)
contextBridge.exposeInMainWorld('cnMap', mapApi)
contextBridge.exposeInMainWorld('cnAfter', afterApi)
contextBridge.exposeInMainWorld('cnVoice', voiceApi)
contextBridge.exposeInMainWorld('cnFolder', folderApi)
contextBridge.exposeInMainWorld('cnReading', readingApi)
contextBridge.exposeInMainWorld('cnSearch', searchApi)
contextBridge.exposeInMainWorld('cnFiles', { all: () => ipcRenderer.invoke('files:all'), attachments: () => ipcRenderer.invoke('files:attachments') } satisfies CnFilesApi)
contextBridge.exposeInMainWorld('cnVideo', videoApi)
contextBridge.exposeInMainWorld('cnImport', importApi)
contextBridge.exposeInMainWorld('cnMenu', menuApi)
contextBridge.exposeInMainWorld('cnCmds', cmdsApi)
contextBridge.exposeInMainWorld('cnRead', readApi)
contextBridge.exposeInMainWorld('cnTodo', todoApi)
contextBridge.exposeInMainWorld('cnWhen', whenApi)
contextBridge.exposeInMainWorld('cnFeynman', feynmanApi)
contextBridge.exposeInMainWorld('cnFamily', familyApi)
/** 文件夹首页的「画布订阅」组件（main/feeds-widget.ts） */
contextBridge.exposeInMainWorld('cnFeeds', {
  widget: () => ipcRenderer.invoke('feeds:widget'),
  open: (id: string) => ipcRenderer.invoke('feeds:open', id),
  openApp: () => ipcRenderer.invoke('feeds:openApp'),
} satisfies CnFeedsApi)
contextBridge.exposeInMainWorld('cnMcp', mcpApi)
contextBridge.exposeInMainWorld('cnCal', calApi)
contextBridge.exposeInMainWorld('cnMc', mcApi)
contextBridge.exposeInMainWorld('cnMobileAi', mobileAiApi)
contextBridge.exposeInMainWorld('cnAttach', {
  of: (note, shared) => ipcRenderer.invoke('attach:of', note, shared),
  trashNote: (note, withImages) => ipcRenderer.invoke('attach:trash-note', note, withImages),
  undo: (id) => ipcRenderer.invoke('attach:undo', id),
  orphans: () => ipcRenderer.invoke('attach:orphans'),
  trashOrphans: (paths) => ipcRenderer.invoke('attach:trash-orphans', paths),
  clean: (paths) => ipcRenderer.invoke('attach:clean', paths),
} satisfies CnAttachApi)
