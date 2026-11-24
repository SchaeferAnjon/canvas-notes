import { app, autoUpdater as nativeUpdater, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeTheme, session, shell } from 'electron'
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import * as git from '@cn/git'
import { attachmentDir } from '@cn/format'
import type { Activity, AiAskOpts, AiChange, AiCommitFailed, BackupState, GitState, StrandedNote, VaultInfo } from '../shared/api'
import { activeSkin, type AppSettings, skinOf } from '../shared/appearance'
import { themeCss, themeInfo, type ThemeFile } from '../shared/vscode-theme'
import { isExtUrl } from '../shared/bookmarkkeeper'
import { BRAND } from '../shared/brand'
import { commitErrorText, syncErrorText } from '../shared/git-errors'
import { kindOf, titleOf } from '../shared/layout'
import { dayKey, logActivity, readActivity } from './activity'
import { agentExternal, agentOwnWrite, attachWeb, markedClips, moveChatPlace, ownPick, registerAgent, unmarkClips } from './agent'
import { ask } from './ai'
import { registerAiCmds, vaultImages } from './ai-cmds'
import { registerAttachments, registerFileScheme } from './attachments'
import { setupPasted } from './pasted'
import { registerSlides } from './slides'
import { importCookies, listProfiles } from './chrome-import'
import { setupDream } from './dream-main'
import { setupGrowth, stopGrowth } from './growth'
import { setupMindmap } from './mindmap'
import { setupVoice } from './voice'
import { setupFeynman } from './feynman'
import { setupFeynmanAfter } from './feynman-after'
import { setupMapExport } from './mindmap/export'
import { readAll } from './duplicates'
import { duplicatesWithProgress, stopSimilar } from './similar'
import { registerHome } from './home'
import { organizeCategories } from './categories'
import { type Tidied, tidyNotes, undoTidy } from './tidy-notes'
import { registerFolderHome } from './folder-home'
import { menuKey, registerCommands } from './commands'
import { accelOf } from '../shared/cmd-keys'
import { registerRestore } from './restore'
import { registerTrash } from './trash-recent'
import { registerBoard } from './board'
import { registerRelated } from './related-main'
import { registerBaseWrite } from './base-write'
import { registerAiColumn } from './ai-column'
import { setupAutomation } from './automation'
import { setupSources } from './sources'
import { followMoves, registerReadAlong } from './read-along'
import { registerNoteAttach } from './note-attach'
import { registerOrphans } from './orphan-attach'
import { readPins, repin } from './pins'
import { setupQuick } from './quick'
import { E2E, guardScreen } from './test-mode'
import { RollingLog, shareLog } from './crash-log'
import { revealLogs, setupCrashLog, watchWindow } from './crash-watch'
import { Updater } from './updater'
import { menuLabel, releaseUrl, updateError } from '../shared/update'
import { SettingsFile } from './settings'
import { ThemeStore } from './themes'
import { Vault } from './vault'
import { macIdentity } from './git-identity'
import { setupPlugins } from './plugins'
import { moveReadingState, setupReading } from './reading'
import { reopenSearch, searchMeaning, searchPassages, searchRelated, searchStatus, searchVault, setupSearch } from './search'
import { setupMcpExt } from './mcp-ext'
import { registerFiles } from './files'
import { registerTodo } from './todo'
import { registerWhen } from './when-ai'
import { registerFamily } from './family'
import { registerCalendar } from './calendar'
import { registerMobileAi } from './mobile-ai'
import { planCarry, testTrash, trashFiles } from './folder-ops'
import { setupImport } from './import'
import { attachEditMenu, closeAllMenus, followOpen, forwardWebContext, popup, setupCtxMenu } from './ctx-menu'
import { attachWebview, setupWeb } from './web'
import { noteMediaHold } from './web/media-hold'
import { attachVideo, flushVideo, setupVideo } from './video'
import { menuIn, settleVaultLang, setupLang, startLang } from './lang'
import { t } from '../shared/i18n'
import { RECYCLE_DIR, atomicCopySync, atomicWriteSync, sweepTemps } from '@cn/atomic'

/** 内置浏览器的登录分区：和软件自己的界面分开，导入的 Chrome 登录放这里 */
const WEB_PARTITION = 'persist:web'
const webviewPreload = () => join(__dirname, '../preload/webview.js')

// 设置目录固定叫 canvas-notes（工作名时代就是它）：显示名换了，用户的设置、AI 对话、网页登录不搬家。测试和多开时用自己的
app.setPath('userData', process.env.CN_USER_DATA || join(app.getPath('appData'), 'canvas-notes'))
registerFileScheme()
// 界面语言：交给浏览器内核要在 app ready 之前（main/lang.ts）
startLang()
// 端到端测试用 Chromium 的假摄像头：不碰真的摄像头、不弹系统的授权框
if (E2E) {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream')
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream')
  // 语音输入的测试：假麦克风循环放这段 wav，不用 Chromium 自带的嘀嘀声
  if (process.env.CN_FAKE_AUDIO) {
    app.commandLine.appendSwitch('use-file-for-fake-audio-capture', process.env.CN_FAKE_AUDIO)
    app.commandLine.appendSwitch('disable-features', 'AudioServiceOutOfProcess')
  }
}

let win: BrowserWindow | null = null
let vault: Vault | null = null
/** 设置 › 软件家族（main/family.ts）：换库时看新库里的联动开关 */
let family: ReturnType<typeof registerFamily> | null = null
/** 上次同步成功的时间 */
let lastSync: number | null = null
/** 最近一次同步没成功的原因（中文）；成功一次就清掉 */
let syncError: { at: number; text: string } | null = null
/** 最近一次自动提交没成功的原因（中文）；随便哪次提交成功就清掉（第 5 轮：以前只在主进程 console.error，底栏弹层只列文件、不说为什么） */
let autoCommitError: { at: number; text: string } | null = null

/** 自动提交间隔在设置里（默认每 10 分钟）；测试用 CN_MINUTE_MS 把「一分钟」缩短 */
const MINUTE_MS = Number(process.env.CN_MINUTE_MS) || 60_000
let autoTimer: NodeJS.Timeout | null = null

/** 按设置里的间隔重新排自动提交；0 = 不自动提交 */
function scheduleAutoCommit() {
  if (autoTimer) clearInterval(autoTimer)
  autoTimer = null
  const min = settings.app().autoCommitMinutes
  if (!vault || min === 0) return
  autoTimer = setInterval(
    () =>
      void commitPending().catch((e) => {
        console.error('自动提交失败', e)
        if (!(e instanceof git.GitError)) return
        autoCommitError = { at: Date.now(), text: commitErrorText(e.message) }
        win?.webContents.send('files:changed')
      }),
    min * MINUTE_MS,
  )
}

async function commitPending(): Promise<string | null> {
  if (!vault) return null
  const st = await git.status(vault.root)
  if (!st.length) return null
  const hash = await git.commitAll(vault.root, git.describeChanges(st))
  autoCommitError = null
  win?.webContents.send('files:changed')
  return hash
}

// ---------- 设置 › Git和同步：自动同步、打开库时先拉、每天备份（2026-11-21 方向 A 第一批新加） ----------

/** 主进程要在底栏说的话：界面还没听上时先排着，界面一听上就取走（app:notices） */
const pendingNotices: string[] = []
let noticeReady = false
function notify(text: string) {
  if (noticeReady && win && !win.isDestroyed()) win.webContents.send('app:notice', text)
  else pendingNotices.push(text)
}

/** 同步一次（底栏「同步」、设置里「现在同步」、自动同步都走这里）：记下上次同步的时间或没成的原因 */
async function runSync(root: string): Promise<git.SyncResult> {
  try {
    const r = await git.sync(root)
    if (r.kind === 'ok') {
      lastSync = Date.now()
      syncError = null
    } else if (r.kind === 'conflict') syncError = { at: Date.now(), text: '远程和本机改了同一处，已经退回同步前，本机的字都在。需要手动合并一次' }
    return r
  } catch (e) {
    // git 的英文原话换成一句中文，记下来（设置 › Git 和同步的状态行一直写着，直到下次同步成功）
    if (!(e instanceof git.GitError)) throw e
    console.error('同步失败', e.message)
    syncError = { at: Date.now(), text: syncErrorText(e.message) }
    throw new Error(syncError.text)
  }
}

let syncTimer: NodeJS.Timeout | null = null
/** 下次自动同步的时间（设置 › Git和同步、底栏「同步」旁写着） */
let nextSyncAt: number | null = null
/** 按设置里的间隔排下一次自动同步；只在我点时（0）不排 */
function scheduleAutoSync() {
  if (syncTimer) clearTimeout(syncTimer)
  syncTimer = null
  nextSyncAt = null
  const min = settings.app().sync.autoMinutes
  if (!vault || min === 0) return
  const root = vault.root
  nextSyncAt = Date.now() + min * MINUTE_MS
  syncTimer = setTimeout(() => {
    void (async () => {
      if (vault?.root !== root || !(await git.hasRemote(root))) return
      try {
        const r = await runSync(root)
        if (r.kind === 'conflict') notify('自动同步没成功：远程和本机改了同一处，已经退回同步前，本机的字都在')
        else if (r.kind === 'ok' && r.pulled) notify(`自动同步：拉下${r.pulled}次提交${r.pushed ? '，推上去了' : ''}`)
      } catch (e) {
        notify(`自动同步没成功：${String((e as Error).message ?? e)}`)
      }
      win?.webContents.send('files:changed')
    })().finally(scheduleAutoSync)
  }, min * MINUTE_MS)
}

/** 打开库时先拉一次（设置 › Git和同步）：在后台拉，拉下来了底栏说一句；拉不成照样用，说为什么 */
async function pullOnOpen(root: string) {
  if (!settings.app().sync.pullOnOpen || !(await git.hasRemote(root))) return
  try {
    const r = await git.pull(root)
    if (vault?.root !== root) return
    if (r.kind === 'conflict') {
      syncError = { at: Date.now(), text: '远程和本机改了同一处，已经退回拉之前，本机的字都在。需要手动合并一次' }
      notify('打开时先拉没成功：远程和本机改了同一处，已经退回拉之前，本机的字都在')
    } else if (r.kind === 'ok') notify(r.pulled ? `打开时先拉了一次：拉下${r.pulled}次提交` : '打开时先拉了一次：已经是最新的')
  } catch (e) {
    const text = e instanceof git.GitError ? syncErrorText(e.message) : String((e as Error).message ?? e)
    syncError = { at: Date.now(), text }
    notify(`打开时先拉没成功：${text}`)
  }
  win?.webContents.send('files:changed')
}

/** 每天备份一份放哪：iCloud 云盘里的「Canvas Notes 备份」或选的文件夹；测试用 CN_ICLOUD_DRIVE，测试模式没给时放在自己的数据目录，绝不碰真的 iCloud */
function backupFile(): string | null {
  const s = settings.app().sync
  if (s.backup === 'off' || !vault) return null
  const drive = process.env.CN_ICLOUD_DRIVE || (E2E ? join(app.getPath('userData'), 'icloud-drive-test') : join(app.getPath('home'), 'Library/Mobile Documents/com~apple~CloudDocs'))
  const dir = s.backup === 'icloud' ? join(drive, 'Canvas Notes 备份') : s.backupDir
  return dir ? join(dir, `${vault.name}.bundle`) : null
}

function backupState(): BackupState {
  const b = vault ? settings.read().backups?.[vault.root] : undefined
  return { at: b?.at ?? null, file: b?.file ?? null, error: b?.error ?? null }
}

/** 备一份（整个库的历史打成一个 git bundle，换掉上一份）；记下时间或没备成的原因 */
async function backupNow(): Promise<BackupState> {
  const file = backupFile()
  if (!file || !vault) return backupState()
  const root = vault.root
  const put = (b: { at?: number; file?: string; error: string | null }) => {
    const all = settings.read().backups ?? {}
    settings.patch({ backups: { ...all, [root]: { ...all[root], ...b } } })
  }
  try {
    mkdirSync(dirname(file), { recursive: true })
    await git.bundle(root, file)
    put({ at: Date.now(), file, error: null })
  } catch (e) {
    const msg = String((e as Error).message ?? e)
    put({ error: /empty bundle/i.test(msg) ? '库里还没有提交，先写点东西' : /ENOENT|EACCES|EPERM|No such file/i.test(msg) ? `写不进「${dirname(file)}」` : msg.slice(0, 200) })
  }
  return backupState()
}

let backupTimer: NodeJS.Timeout | null = null
/** 每天一份：开着软件时每 30 分钟看一次，离上次备份满一天就备 */
function scheduleBackup() {
  if (backupTimer) clearInterval(backupTimer)
  backupTimer = null
  if (!backupFile()) return
  const check = () => {
    const at = backupState().at
    if (!at || Date.now() - at >= 1440 * MINUTE_MS) void backupNow()
  }
  backupTimer = setInterval(check, 30 * MINUTE_MS)
  setTimeout(check, MINUTE_MS)
}

/** 导入的 VS Code 主题（设置目录 themes/） */
const themes = new ThemeStore(join(app.getPath('userData'), 'themes'))
const userSkins = () => themes.list().map(themeInfo)
/** 出错日志（task-pyb39）：~/Library/Logs/Canvas Notes/main.log；测试和多开时放在设置目录的 logs/（CN_LOG_DIR 可指定）。先于设置建好：设置坏了也要记 */
const crashLog = new RollingLog(process.env.CN_LOG_DIR || (E2E || process.env.CN_USER_DATA ? join(app.getPath('userData'), 'logs') : join(app.getPath('home'), 'Library/Logs', BRAND.name)))
shareLog(crashLog)
const settings = new SettingsFile(join(app.getPath('userData'), 'settings.json'), userSkins)
/** 现在窗口用的是哪套主题（速记小窗、窗口底色跟着它） */
const currentSkin = () => activeSkin(settings.app().appearance, nativeTheme.shouldUseDarkColors)
const winColor = () => skinOf(currentSkin(), userSkins()).win
/** 速记小卡用的主题：导入的那几套连样式一起带过去 */
function quickSkin() {
  const id = currentSkin()
  const t = themes.list().find((x) => x.id === id)
  return { info: skinOf(id, userSkins()), css: t ? themeCss(t) : undefined }
}

function vaultFromArgs(): string | null {
  const arg = process.argv.find((a) => a.startsWith('--vault='))
  return arg ? arg.slice('--vault='.length) : (process.env.CN_VAULT ?? null)
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

async function openVault(dir: string): Promise<VaultInfo> {
  const root = resolve(dir)
  const fresh = !(await git.isRepo(root))
  if (fresh) await git.init(root)
  // 这台 Mac 上 git 没有署名（全局、库里都没设）：给这个库设一个，不然所有提交都报「作者身份未知」
  const id = await git.ensureIdentity(root, await macIdentity())
  if (id) console.log('git 没有署名，给库设了', id)
  // 换库前把旧库没提交的改动提交掉，和退出前一样
  if (vault && vault.root !== root) await commitPending().catch((e) => console.error('换库前提交失败', e))
  vault?.close()
  vault = new Vault(root)
  // 上次崩溃、断电留下的临时文件（没换上去的那次保存）挪进 .canvas-notes/回收/、记一行（task-8dula）；不挡着打开
  void sweepTemps(root).then(
    (m) => m.length && console.log(`挪走 ${m.length} 个崩溃留下的临时文件，见 ${RECYCLE_DIR}/记录.txt`),
    (e) => console.error('收拾崩溃留下的临时文件没成功', e),
  )
  // 库语言：新建的库照现在的界面语言（英文库的分类文件夹用英文名），已有的照库里记的
  await settleVaultLang(root, fresh)
  // 老库：「素材/」改名「剪藏/」、「素材/微信读书/」挪到「阅读/」，一次提交（新库、整理过的什么都不做）
  let organizeError: string | undefined
  const organized = await organizeCategories(vault, (from, to) => (moveReadingState(root, from, to), moveChatPlace(root, from, to))).catch((e: Error) => {
    // 库照样打开：没挪完的留在原处，界面底部说一句为什么
    console.error('整理顶级分类没成功', e)
    organizeError = String(e.message ?? e)
    return null
  })
  // 老库整理一次「一个 PDF 一篇笔记」（2026-11-20）：没改过的「我的疑惑.md」删掉、改过的改名留下，同一份 PDF 的两篇笔记合成一篇；一次提交，能撤回
  let tidyError: string | undefined
  const tidied: Tidied | null = await tidyNotes(vault).catch((e: Error) => {
    console.error('整理「我的疑惑」和笔记没成功', e)
    tidyError = String(e.message ?? e)
    return null
  })
  scheduleAutoCommit()
  scheduleAutoSync()
  scheduleBackup()
  void pullOnOpen(root)
  // 全能模式下 AI 这一轮结束时分清库里多出来的改动谁改的：软件自己写的不算，在外面改的（AI 自己的工具）算
  // 自动化（task-i921u）：编辑器存的、外面改的、新文件都让它扫一遍（新加一条、某一列改了）
  vault.onOwnWrite = (rel, text) => {
    agentOwnWrite(rel, text)
    automation?.changed()
  }
  vault.onMoved = followMoves(vault, () => win?.webContents.send('files:changed'))
  vault.watch(
    (path, text) => {
      agentExternal(path, text)
      win?.webContents.send('note:changed', path, text)
      automation?.changed()
    },
    () => {
      win?.webContents.send('files:changed')
      automation?.changed()
    },
    (from, to) => win?.webContents.send('note:renamed', from, to),
  )
  // 开过的库记下来（对外接口的 list_vaults；新的在前，最多 20 个）
  settings.patch({ lastVault: root, knownVaults: [root, ...(settings.read().knownVaults ?? []).filter((p) => p !== root)].slice(0, 20) })
  family?.watch(root)
  searchVault(root)
  void automation?.open().catch((e) => console.error('自动化没开起来', e))
  return { path: root, name: vault.name, ...(organized ? { organized: organized.moves } : {}), ...(organizeError ? { organizeError } : {}), ...(tidied ? { tidied } : {}), ...(tidyError ? { tidyError } : {}) }
}

/** 本周一 0 点 */
function startOfWeek(d: Date): Date {
  const day = (d.getDay() + 6) % 7
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day)
}

function needVault(): Vault {
  if (!vault) throw new Error('还没有打开库')
  return vault
}

function registerIpc() {
  ipcMain.handle('vault:get', async () => {
    if (vault) return { path: vault.root, name: vault.name }
    const dir = vaultFromArgs() ?? settings.read().lastVault
    if (dir && isDir(dir)) return openVault(dir)
    return null
  })
  ipcMain.handle('vault:tidy:undo', async (_e, t: unknown) => {
    const o = t as Partial<Tidied> | null
    if (!o || typeof o.commit !== 'string' || !Array.isArray(o.paths) || !o.paths.every((p) => typeof p === 'string') || typeof o.back !== 'string') throw new Error('撤回的参数不对')
    const back = await undoTidy(needVault(), { commit: o.commit, paths: o.paths, back: o.back })
    win?.webContents.send('files:changed')
    return back
  })
  ipcMain.handle('vault:choose', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: '打开库',
      buttonLabel: '打开',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (r.canceled || !r.filePaths[0]) return null
    return openVault(r.filePaths[0])
  })
  ipcMain.handle('settings:get', () => settings.app())
  ipcMain.handle('settings:set', (_e, patch: Parameters<SettingsFile['setApp']>[0]) => {
    if (!patch || typeof patch !== 'object') throw new Error('设置参数不对')
    const before = settings.app()
    const next = settings.setApp(patch)
    if (next.autoCommitMinutes !== before.autoCommitMinutes) scheduleAutoCommit()
    if (next.sync.autoMinutes !== before.sync.autoMinutes) scheduleAutoSync()
    if (next.sync.backup !== before.sync.backup || next.sync.backupDir !== before.sync.backupDir) scheduleBackup()
    if (next.general.tray !== before.general.tray || next.general.quickKey !== before.general.quickKey) quick.apply()
    if (next.editor.semantic !== before.editor.semantic) reopenSearch()
    win?.setBackgroundColor(winColor())
    return next
  })
  ipcMain.handle('settings:pickWinBg', async (): Promise<AppSettings | null> => {
    const r = await dialog.showOpenDialog(win!, {
      title: '选一张窗口背景',
      buttonLabel: '用这张',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif'] }],
    })
    if (r.canceled || !r.filePaths[0]) return null
    // 拷进软件设置目录，原图挪走、删掉也不影响
    const dir = join(app.getPath('userData'), 'backgrounds')
    mkdirSync(dir, { recursive: true })
    const name = `bg-${Date.now()}${extname(r.filePaths[0]).toLowerCase()}`
    atomicCopySync(r.filePaths[0], join(dir, name))
    return settings.setApp({ appearance: { winBg: 'custom', winBgFile: name } })
  })
  ipcMain.handle('themes:list', (): ThemeFile[] => themes.list())
  ipcMain.handle('themes:import', async (): Promise<{ added: ThemeFile[]; settings: AppSettings } | null> => {
    const r = await dialog.showOpenDialog(win!, {
      title: '导入 VS Code 主题',
      buttonLabel: '导入',
      properties: ['openFile'],
      filters: [{ name: 'VS Code 主题', extensions: ['json', 'vsix'] }],
    })
    if (r.canceled || !r.filePaths[0]) return null
    const added = themes.import(r.filePaths[0])
    // 导进来就用上：跟系统时按浅深换白天或夜里那套
    const a = settings.app().appearance
    const first = themeInfo(added[0]!)
    const appearance = !a.followSystem ? { skin: first.id } : first.tone === 'light' ? { day: first.id } : { night: first.id }
    const next = settings.setApp({ appearance })
    win?.setBackgroundColor(winColor())
    return { added, settings: next }
  })
  ipcMain.handle('themes:remove', (_e, id: unknown): AppSettings => {
    if (typeof id !== 'string') throw new Error('主题 id 不对')
    themes.remove(id)
    win?.setBackgroundColor(winColor())
    return settings.app()
  })
  ipcMain.handle('git:remote', async () => (vault ? git.remote(vault.root) : null))
  ipcMain.handle('git:setRemote', async (_e, url: unknown) => {
    if (typeof url !== 'string') throw new Error('远程地址不对')
    await git.setRemote(needVault().root, url)
    return git.remote(needVault().root)
  })
  ipcMain.handle('notes:list', () => needVault().list())
  ipcMain.handle('note:read', (_e, path: string) => needVault().read(path))
  // 那篇每一行是哪次提交写的（右栏「笔记」里别处写的那几条的时间，task-6cxtc）
  ipcMain.handle('git:line-times', (_e, path: string) => {
    const v = needVault()
    return git.lineTimes(v.root, v.rel(v.abs(path)))
  })
  ipcMain.handle('note:write', (_e, path: string, text: string, base: string) => {
    if (typeof text !== 'string' || typeof base !== 'string') throw new Error('写入参数不对')
    return needVault().write(path, text, base)
  })
  ipcMain.handle('note:rescue', (_e, path: string, text: string) => {
    if (typeof path !== 'string' || typeof text !== 'string') throw new Error('写入参数不对')
    return needVault().rescue(path, text)
  })
  // 库里哪都写不进去（盘满了、没有写权限）：字备份进软件自己的设置目录，同一篇一直写同一个备份
  ipcMain.handle('note:stash', (_e, path: unknown, text: unknown, into: unknown) => {
    if (typeof path !== 'string' || typeof text !== 'string') throw new Error('写入参数不对')
    const dir = stashDir()
    const name = typeof into === 'string' && dirname(into) === dir ? into : join(dir, `${path.replace(/\.md$/i, '').replace(/\//g, '／')} ${stashStamp(new Date())}.md`)
    mkdirSync(dir, { recursive: true })
    atomicWriteSync(name, text)
    return name
  })
  ipcMain.handle('note:revealStash', (_e, file: unknown) => {
    if (typeof file !== 'string' || dirname(file) !== stashDir()) throw new Error('不是没存上的字的备份')
    shell.showItemInFolder(file)
  })
  ipcMain.handle('note:conflictCopy', (_e, path: string, text: string) => {
    if (typeof text !== 'string') throw new Error('写入参数不对')
    return needVault().saveConflictCopy(path, text)
  })
  ipcMain.handle('note:create', (_e, folder: string, name: string, text: string) => {
    if (typeof folder !== 'string' || typeof name !== 'string' || typeof text !== 'string') throw new Error('新建参数不对')
    return needVault().create(folder, name, text)
  })
  ipcMain.handle('note:rename', async (_e, path: string, newName: string, free?: unknown) => {
    if (typeof newName !== 'string') throw new Error('改名参数不对')
    const v = needVault()
    const to = await v.rename(path, newName, free === true)
    await repin(v, path, to)
    moveChatPlace(v.root, path, to)
    return to
  })
  ipcMain.handle('board:create', (_e, folder: string, name: string, parent?: unknown) => {
    if (typeof folder !== 'string' || typeof name !== 'string' || (parent !== undefined && typeof parent !== 'string')) throw new Error('新建参数不对')
    return needVault().createBoard(folder, name, parent)
  })
  ipcMain.handle('note:trash', async (_e, path: string) => {
    const v = needVault()
    const p = v.abs(path)
    agentOwnWrite(path)
    // 测试把「废纸篓」换成临时文件夹，不往用户真的废纸篓里放东西
    const testTrash = process.env.CN_TRASH_DIR
    if (testTrash) renameSync(p, join(testTrash, `${Date.now()}-${p.split('/').pop()}`))
    else await shell.trashItem(p)
    await repin(v, path, null)
  })
  // 文件树里删 PDF、HTML、图片（不是笔记）：进废纸篓，当场单独一次提交（历史里能撤回），不留给下一次别的提交顺带进去
  ipcMain.handle('files:trash', async (_e, paths: unknown) => {
    if (Array.isArray(paths)) for (const p of paths) if (typeof p === 'string') agentOwnWrite(p)
    const testTrashDir = process.env.CN_TRASH_DIR
    await trashFiles(needVault(), paths, testTrashDir ? testTrash(testTrashDir) : (abs) => shell.trashItem(abs))
  })
  ipcMain.handle('inbox:capture', (_e, text: string) => {
    if (typeof text !== 'string') throw new Error('速记参数不对')
    return needVault().capture(text)
  })
  ipcMain.handle('web:clip', async (_e, c: { text: unknown; url: unknown; title: unknown }) => {
    if (typeof c?.text !== 'string' || typeof c.url !== 'string' || typeof c.title !== 'string') throw new Error('剪藏参数不对')
    if (!/^https?:\/\//.test(c.url)) throw new Error('只剪 http(s) 网页')
    const v = needVault()
    const path = await v.clip(c.text.slice(0, 20000), c.url, c.title.slice(0, 300))
    await logActivity(v.root, { t: Date.now(), kind: 'clip', path })
    return path
  })
  ipcMain.handle('chrome:profiles', () => listProfiles())
  ipcMain.handle('chrome:import', (_e, profileId: string) => {
    if (typeof profileId !== 'string') throw new Error('参数不对')
    const ses = session.fromPartition(WEB_PARTITION)
    return importCookies(profileId, async (c) => {
      await ses.cookies.set(c)
    })
  })
  const asking = new Map<number, AbortController>()
  ipcMain.handle('ai:ask', async (_e, id: number, system: string, prompt: string, opts?: AiAskOpts) => {
    if (typeof system !== 'string' || typeof prompt !== 'string') throw new Error('AI 参数不对')
    const ac = new AbortController()
    asking.set(id, ac)
    try {
      // / 命令跟着输入框底行选的那一家、模型、想多久（task-0fhyo）；带库里的图（截图转成文字）
      const pick = opts?.pick ? ownPick(opts.pick) : undefined
      const images = opts?.images ? await vaultImages(needVault(), opts.images) : undefined
      // 边生成边给界面（和 AI 浮窗的一轮对话用同一个事件）
      return await ask(system, prompt, ac.signal, (delta) => win?.webContents.send('ai:event', id, { type: 'text', delta }), 'chat', { ...(pick ? { pick } : {}), ...(images ? { images } : {}) })
    } finally {
      asking.delete(id)
    }
  })
  ipcMain.handle('ai:stop', (_e, id: number) => asking.get(id)?.abort())
  ipcMain.handle('ai:change', async (_e, change: AiChange) => {
    const v = needVault()
    const writes = Array.isArray(change?.writes) ? change.writes : []
    const moves = Array.isArray(change?.moves) ? change.moves : []
    if (typeof change?.message !== 'string') throw new Error('AI 改动参数不对')
    const touched = [...writes.map((w) => w.path), ...moves.map((m) => m.from)]
    // 挪的那几篇下面挂着数据库的记录文件夹：跟着挪，和这次改动同一次提交（task-5yp97，和文件树里挪一样）
    const carry = await planCarry(v, moves)
    // 这几个文件里用户没提交的字先单独提交，AI 的提交里只有 AI 的改动，撤回才不会带走用户的字
    const pending = (await git.status(v.root)).filter((s) => touched.includes(s.path) || carry.touches(s.path))
    // 先提交用户的字没成（锁文件、没署名）：照样替 AI 写进文件，AI 这次也不提交（不然用户的字混进 AI 的提交），照实说提交没成功
    let preFailed: string | null = null
    if (pending.length) {
      try {
        await git.commitPaths(v.root, pending.map((s) => s.path), git.describeChanges(pending))
      } catch (e) {
        if (!(e instanceof git.GitError)) throw e
        preFailed = e.message
      }
    }
    const paths: string[] = []
    for (const w of writes) {
      if (typeof w.path !== 'string' || typeof w.text !== 'string') throw new Error('AI 改动参数不对')
      if (w.create) paths.push(await v.create(w.path.includes('/') ? w.path.slice(0, w.path.lastIndexOf('/')) : '', titleOf(w.path), w.text))
      else {
        const cur = await v.read(w.path)
        const r = await v.write(w.path, w.text, cur.text)
        if (!r.ok) throw new Error('文件刚被改过，AI 这次没改，再试一次')
        paths.push(w.path)
        // 这次写入是替 AI 写的，打开着这篇的编辑器要收到，按外部改动合并；先说是 AI 写的（新的字一点点长出来，task-6kun1）
        win?.webContents.send('ai:act', { turn: 0, kind: 'wrote', path: w.path })
        win?.webContents.send('note:changed', w.path, w.text)
      }
    }
    const follow = win ? followOpen(win.webContents) : undefined
    for (const m of moves) {
      const to = await v.move(m.from, m.toFolder)
      await repin(v, m.from, to)
      // 开着的那篇马上跟到新路径：跟着挪的记录文件夹会改它的数据库块，新内容要认得出是它
      follow?.(m.from, to)
      paths.push(m.from, to)
      // 跟着挪的附件文件夹（附件/<旧路径>/ → 附件/<新路径>/）也进这次提交，不留在工作区里
      const att = [attachmentDir(m.from) + '/', attachmentDir(to) + '/']
      for (const s of await git.status(v.root)) if (att.some((d) => s.path.startsWith(d))) paths.push(s.path)
    }
    paths.push(...(await carry.run(follow)))
    const message = change.noAi === true ? change.message : `AI：${change.message}`
    if (preFailed) {
      win?.webContents.send('files:changed')
      return { failed: commitErrorText(preFailed), paths, message } satisfies AiCommitFailed
    }
    let hash: string | null
    try {
      hash = await git.commitPaths(v.root, paths, message)
    } catch (e) {
      // 改动已经写进文件、只是没提交上（没署名、锁一直不放）：照实说，界面不当成 AI 没答出来；
      // 带上改了哪几个文件、提交说明，「再提交一次」只提交这几个（第 5 轮：以前是「现在提交」整个库，提交说明成了「更新 2 个文件」、也没了撤回）
      if (!(e instanceof git.GitError)) throw e
      console.error('AI 改完提交失败', e.message)
      win?.webContents.send('files:changed')
      return { failed: commitErrorText(e.message), paths, message } satisfies AiCommitFailed
    }
    win?.webContents.send('files:changed')
    if (!hash) return null
    // 照提交号取（不是取最新的一次）：同一会儿视频条存字幕全文、自动提交也在提交，取最新的会把别人的那次当成 AI 这次
    return (await git.log(v.root, 1, hash))[0] ?? null
  })
  ipcMain.handle('ai:commit', async (_e, paths: string[], message: string) => {
    const v = needVault()
    if (!Array.isArray(paths) || paths.some((p) => typeof p !== 'string') || typeof message !== 'string' || !message.trim()) throw new Error('AI 提交参数不对')
    let hash: string | null
    try {
      hash = await git.commitPaths(v.root, paths, message)
    } catch (e) {
      if (!(e instanceof git.GitError)) throw e
      throw new Error(commitErrorText(e.message))
    }
    win?.webContents.send('files:changed')
    if (hash) return (await git.log(v.root, 1, hash))[0] ?? null
    // 没有要提交的：自动提交（或「现在提交」）已经把这几个文件收进去了。告诉界面是哪一次，撤回时只撤这几个文件
    // （第 6 轮：以前只说「没有要提交的改动了」，没有撤回）
    const at = await git.lastCommitOf(v.root, paths)
    const taken = at ? (await git.log(v.root, 1, at))[0] : undefined
    return taken ? { taken: { ...taken, files: taken.files.filter((f) => paths.includes(f.path)) } } : null
  })
  ipcMain.handle('ai:revert', async (_e, hash: string, only?: { paths: string[]; message: string }) => {
    const v = needVault()
    // 自动提交收进去的：只撤回 AI 改的那几个文件，同一次里别处的字不动
    if (only) {
      if (!Array.isArray(only.paths) || only.paths.some((p) => typeof p !== 'string') || typeof only.message !== 'string') throw new Error('撤回参数不对')
      await git.revertPaths(v.root, hash, only.paths, `撤回${only.message}`)
    } else await git.revert(v.root, hash)
    // AI 在网页里剪的段落：剪进去的那篇撤回后不在了，网页里那一段的「✂ 剪成卡片」标记跟着去掉（DESIGN.v3 2.3）
    const gone = markedClips().filter((p) => !existsSync(v.abs(p)))
    if (gone.length) await unmarkClips(gone)
    return (await git.log(v.root, 1))[0] ?? null
  })
  ipcMain.handle('git:state', async (): Promise<GitState> => {
    const v = needVault()
    if (!(await git.isRepo(v.root))) return { isRepo: false, branch: null, changes: [], weekCommits: 0, hasRemote: false, lastSync: null, syncError: null, autoCommitMinutes: 0, autoCommitError: null, nextSync: null }
    const [branch, changes, weekCommits, hasRemote] = await Promise.all([
      git.currentBranch(v.root),
      git.status(v.root),
      git.countCommitsSince(v.root, startOfWeek(new Date())),
      git.hasRemote(v.root),
    ])
    // 没有要提交的了（别处提交上了）：自动提交的那次失败不再挂着
    if (!changes.length) autoCommitError = null
    return { isRepo: true, branch, changes, weekCommits, hasRemote, lastSync, syncError, autoCommitMinutes: settings.app().autoCommitMinutes, autoCommitError, nextSync: hasRemote ? nextSyncAt : null }
  })
  ipcMain.handle('git:commit', async () => {
    const v = needVault()
    const st = await git.status(v.root)
    if (!st.length) return null
    let hash: string | null
    try {
      hash = await git.commitAll(v.root, git.describeChanges(st))
    } catch (e) {
      // git 的原话（可能带完整路径、英文命令）换成一句中文原因
      if (!(e instanceof git.GitError)) throw e
      console.error('现在提交失败', e.message)
      throw new Error(commitErrorText(e.message))
    }
    autoCommitError = null
    if (!hash) return null
    return (await git.log(v.root, 1))[0] ?? null
  })
  ipcMain.handle('git:identity', () => git.identity(needVault().root))
  ipcMain.handle('git:setIdentity', async (_e, name: unknown, email: unknown) => {
    const v = needVault()
    if (typeof name !== 'string' || typeof email !== 'string') throw new Error('署名参数不对')
    await git.setIdentity(v.root, name, email)
    return git.identity(v.root)
  })
  ipcMain.handle('git:sync', () => runSync(needVault().root))
  // 不进Git的文件（设置 › Git和同步）：库里的 .gitignore；改了写进去、单独提交一次（删光了就把文件删掉）
  ipcMain.handle('git:ignore', () => (existsSync(join(needVault().root, '.gitignore')) ? readFileSync(join(needVault().root, '.gitignore'), 'utf8') : ''))
  ipcMain.handle('git:set-ignore', async (_e, text: unknown) => {
    if (typeof text !== 'string' || text.length > 100_000) throw new Error('.gitignore 的内容不对')
    const v = needVault()
    const file = join(v.root, '.gitignore')
    if (text.trim()) atomicWriteSync(file, text.endsWith('\n') ? text : text + '\n')
    else if (existsSync(file)) rmSync(file)
    await git.commitPaths(v.root, ['.gitignore'], '改了不进Git的文件')
    win?.webContents.send('files:changed')
  })
  ipcMain.handle('git:backup-state', () => backupState())
  ipcMain.handle('git:backup-now', () => backupNow())
  ipcMain.handle('git:pick-backup-dir', async () => {
    const r = await dialog.showOpenDialog(win!, { title: '每天备份一份到哪个文件夹', buttonLabel: '备份到这里', properties: ['openDirectory', 'createDirectory'] })
    if (r.canceled || !r.filePaths[0]) return null
    settings.setApp({ sync: { backup: 'folder', backupDir: r.filePaths[0] } })
    scheduleBackup()
    return r.filePaths[0]
  })
  // 设置 › 高级：软件设置目录
  ipcMain.handle('app:data-dir', () => app.getPath('userData'))
  ipcMain.handle('app:reveal-data-dir', () => shell.openPath(app.getPath('userData')))
  // 主进程要在底栏说的话（自动同步、打开时先拉）：界面听上以后取走排着的
  ipcMain.handle('app:notices', () => {
    noticeReady = true
    return pendingNotices.splice(0)
  })
  ipcMain.handle('search', (_e, q: string) => (typeof q === 'string' ? needVault().search(q) : []))
  ipcMain.handle('pins:get', () => readPins(needVault()))
  ipcMain.handle('activity:log', (_e, kind: string, path: string) => {
    if (kind !== 'clip' || typeof path !== 'string') throw new Error('参数不对')
    return logActivity(needVault().root, { t: Date.now(), kind: 'clip', path })
  })
  ipcMain.handle('activity:get', async (): Promise<Activity> => {
    const v = needVault()
    const now = new Date()
    const weekStart = startOfWeek(now).getTime()
    const lastWeek = weekStart - 7 * 86400_000
    const since = new Date(weekStart - 52 * 7 * 86400_000)
    const [entries, commits] = await Promise.all([readActivity(v.root), git.commitsSince(v.root, since)])
    const days: Record<string, number> = {}
    for (const e of entries) days[dayKey(e.t)] = (days[dayKey(e.t)] ?? 0) + 1
    for (const c of commits) days[dayKey(c.t)] = (days[dayKey(c.t)] ?? 0) + 1
    return {
      days,
      clipsThisWeek: entries.filter((e) => e.t >= weekStart).length,
      clipsLastWeek: entries.filter((e) => e.t >= lastWeek && e.t < weekStart).length,
      workEditsThisWeek: commits.filter((c) => c.t >= weekStart && c.files.some((f) => kindOf(f).kind === 'work')).length,
      lastSync,
    }
  })
  // ⌘K「找重复」：边算边把进度（已比几篇、新找到的几对）发给界面；「停下」结束那个进程
  let dupRun: { stop(): void } | null = null
  ipcMain.handle('notes:duplicates', async (e) => {
    const v = needVault()
    const docs = await readAll(v.root, (await v.list()).map((n) => n.path))
    dupRun?.stop()
    const run = duplicatesWithProgress(docs, (p) => !e.sender.isDestroyed() && e.sender.send('notes:dups-progress', p))
    dupRun = run
    try {
      return await run.done
    } finally {
      if (dupRun === run) dupRun = null
    }
  })
  ipcMain.handle('notes:duplicates-stop', () => {
    dupRun?.stop()
    dupRun = null
  })
  setupCtxMenu(needVault, () => win?.webContents.send('files:changed'))
  registerAttachments(needVault, () => win, app.getPath('userData'))
  // 删笔记（连图）是软件自己删的：正在答的全能模式那一轮不把它算成 AI 删的
  registerNoteAttach(needVault, app.getPath('userData'), () => win?.webContents.send('files:changed'), agentOwnWrite)
  registerOrphans(needVault, () => win?.webContents.send('files:changed'), agentOwnWrite)
  setupPasted(app.getPath('userData'))
  registerSlides(needVault, app.getPath('userData'), () => win?.webContents.send('files:changed'))
  registerHome(needVault, () => win)
  registerFolderHome(needVault, () => win, (root, from, to) => (moveReadingState(root, from, to), moveChatPlace(root, from, to)))
  registerCommands(needVault, buildMenu)
  registerAiCmds({ vault: needVault, userData: app.getPath('userData') })
  registerRestore(needVault, () => win?.webContents.send('files:changed'))
  registerTrash(needVault, () => win?.webContents.send('files:changed'))
  registerBoard(needVault, () => win?.webContents.send('files:changed'))
  registerRelated({
    vault: needVault,
    settings: () => settings.app().dream,
    noteChanged: (path, text) => win?.webContents.send('note:changed', path, text),
    filesChanged: () => win?.webContents.send('files:changed'),
  })
  registerBaseWrite(needVault, (path, text) => win?.webContents.send('note:changed', path, text), () => win?.webContents.send('files:changed'))
  registerAiColumn(needVault, app.getPath('userData'), (path, text) => win?.webContents.send('note:changed', path, text), () => win?.webContents.send('files:changed'))
  registerReadAlong(needVault)
  ipcMain.handle('git:history', async (_e, limit: number, opts?: { hideInternal?: boolean }) => {
    const root = needVault().root
    // 藏起软件自己的设置文件（CN-116，历史 ⋯ 里的开关）：git 自己跳过只动了设置的提交，「最近100次」全是用户的改动
    const commits = await git.log(root, Math.min(Math.max(1, Number(limit) || 50), 500), undefined, opts?.hideInternal ? git.HIDE_INTERNAL : undefined)
    // 每个文件现在还在不在（挪走、删了的右键「打开」灰掉，「看这一版」照样能用）
    const here = new Map<string, boolean>()
    for (const c of commits)
      for (const f of c.files) {
        if (!here.has(f.path)) here.set(f.path, await stat(join(root, f.path)).then((s) => s.isFile(), () => false))
        ;(f as { exists?: boolean }).exists = here.get(f.path)
      }
    return commits
  })
  // AI 回答里的「canvas-notes://commit/<号>」预览卡（task-3e53q）：那一次提交的说明、时间、改了哪几篇；号不对、库里没有是 null
  ipcMain.handle('git:commit-info', async (_e, hash: unknown) => {
    if (typeof hash !== 'string' || !/^[0-9a-f]{7,40}$/i.test(hash)) return null
    try {
      return (await git.log(needVault().root, 1, hash.toLowerCase()))[0] ?? null
    } catch (e) {
      if (e instanceof git.GitError && /unknown revision|bad revision|ambiguous argument/i.test(e.stderr)) return null
      throw e
    }
  })
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    // 端到端测试的窗口放到屏幕外，不挡人
    ...(E2E ? { x: -3000, y: 80 } : {}),
    title: BRAND.name,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 14 },
    backgroundColor: winColor(),
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      webviewTag: true,
      // 测试时窗口不激活，也要照常渲染；界面靠 --cn-e2e 知道是测试模式（只在这时能注入渲染错误，task-pyb39）
      ...(E2E ? { backgroundThrottling: false, additionalArguments: ['--cn-e2e'] } : {}),
    },
  })
  watchWindow(crashLog, win)
  // 右栏网页：只许用我们的预加载、我们的登录分区，网页拿不到 Node
  win.webContents.on('will-attach-webview', (_e, prefs, params) => {
    delete (prefs as { preloadURL?: string }).preloadURL
    prefs.preload = webviewPreload()
    prefs.nodeIntegration = false
    prefs.contextIsolation = true
    prefs.sandbox = true
    params.partition = WEB_PARTITION
    // 重开软件时恢复的标签：视频不自己播（web/media-hold.ts）
    noteMediaHold(prefs)
    if (!/^(https?:|about:blank)/.test(params.src ?? '') && !isExtUrl(params.src)) params.src = 'about:blank'
  })
  win.webContents.on('did-attach-webview', (_e, wc) => {
    // AI 要能操纵右栏网页
    attachWeb(wc)
    // 新窗口链接开成新网页标签、记历史、插件、网页焦点时的快捷键：都在 web/index.ts
    attachWebview(wc, win!)
    // 视频页：字幕、记下这一刻、框一块问（video/）
    attachVideo(wc)
    // 网页里的右键转给界面拼菜单
    forwardWebContext(wc, win!.webContents)
  })
  // 测试模式窗口根本不显示（Playwright 的截图、点按、打字走 CDP，不用窗口在屏幕上）
  win.once('ready-to-show', () => { if (!E2E) win?.show() })
  // 关主窗口（软件不退）：先存编辑器里没存的字再关。退出时（含装更新）字已经存过，这里不拦：拦了 Electron 会取消这次退出
  const w = win
  let notesSaved = false
  w.on('close', (e) => {
    quitLog('窗口 close')
    if (notesSaved || quitStarted) return
    e.preventDefault()
    void saveOpenNotes([w]).then(async ({ stranded }) => {
      // 有篇的字只在内存里：关了窗口编辑器就没了，先问
      if (!(await confirmStranded(stranded))) return quitLog('没关窗口：有篇写不进去，用户先不关')
      notesSaved = true
      if (!w.isDestroyed()) w.close()
    })
  })
  win.on('closed', () => (quitLog('窗口 closed'), (win = null)))
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

guardScreen()

app.whenReady().then(async () => {
  // 网站看到的是普通 Chrome，不带 Electron 字样（有的网站会拦）
  const web = session.fromPartition(WEB_PARTITION)
  web.setUserAgent(web.getUserAgent().replace(/\s(Electron|canvas-notes|CanvasNotes|@cn\/notes)\/\S+/g, ''))
  app.setAboutPanelOptions({
    applicationName: BRAND.name,
    applicationVersion: app.getVersion(),
    version: '',
    copyright: `© ${BRAND.year} ${BRAND.author} · ${BRAND.license}`,
    website: BRAND.site,
  })
  registerIpc()
  setupCrashLog(crashLog, () => win)
  registerAgent({ win: () => win, vault: () => vault, moved: (root, from, to) => moveReadingState(root, from, to) })
  setupMindmap({ win: () => win, vault: () => vault })
  setupVoice({ win: () => win })
  setupFeynman({ win: () => win, vault: () => vault })
  setupFeynmanAfter()
  setupMapExport(() => win, () => vault)
  const dreams = setupDream({
    root: () => vault?.root ?? null,
    // 补双链找候选的向量那一路：搜索索引里每篇切段的向量（意思索引没开、没建好时没有这一路）
    related: async (paths, k) => {
      const r = await searchRelated(paths, k)
      return r ? { model: r.model, map: r } : null
    },
    // Wiki 化找候选的向量那一路：每句在全库最像的几段
    passages: (qs, k) => searchPassages(qs, k),
    // 周记那条自动化开着：梦游的「写本周小结」并进周记，不另写（用户定的 ⑥，task-i921u）
    settings: () => {
      const s = settings.app().dream
      return automation?.weekOn() ? { ...s, steps: { ...s.steps, week: false } } : s
    },
    send: (ch, ...args) => win?.webContents.send(ch, ...args),
    // 收下、撤回时 git 挪文件、改字：和写笔记排同一个队，挪完开着的那篇跟到新路径、拿新内容重载（单条、一组、全部收下都走这里）
    exclusive: (f) => (vault ? vault.exclusive(f) : f()),
    async followMoves(moves) {
      const v = vault
      if (!v) return
      for (const m of moves) {
        const text = await v.followOwnMove(m.from, m.to)
        win?.webContents.send('note:renamed', m.from, m.to, true)
        if (text !== null) win?.webContents.send('note:changed', m.to, text)
      }
    },
  })
  setupGrowth({ vault: () => vault, report: () => dreams.report(), send: (ch, ...args) => win?.webContents.send(ch, ...args) })
  automation = setupAutomation({
    vault: () => vault,
    win: () => win,
    userData: app.getPath('userData'),
    dream: {
      on: () => settings.app().dream.auto,
      setOn: (on) => void settings.setApp({ dream: { auto: on } }),
      now: () => dreams.dreamNow(),
      tidyInbox: () => dreams.tidyInbox(),
      weekItems: (from) => dreams.weekItems(from),
    },
    sources: () => sources,
  })
  // 同步来源（设计页 61）：和自动化共用一个钟、记录和撤回
  sources = setupSources({ vault: () => vault, win: () => win, userData: app.getPath('userData'), engine: automation.engine, prefs: () => automation!.prefs() })
  // 库在这之前就开了（窗口先问了 vault:get）：现在开始
  if (vault) void automation.open().catch((e) => console.error('自动化没开起来', e))
  quick = setupQuick({
    vault: () => vault,
    onSaved: () => win?.webContents.send('files:changed'),
    openMain: () => {
      if (!win) createWindow()
      else if (!E2E) win.show()
      if (!E2E) app.focus({ steal: true })
    },
    dreamNow: () => void dreams.dreamNow().catch((e) => console.error('梦游失败', e)),
    settings: () => settings.read(),
    saveSettings: (patch) => settings.patch(patch),
    skin: quickSkin,
    prefs: () => settings.app().general,
    topItems: readyItems,
  })
  await setupWeb({ partition: WEB_PARTITION, window: () => win, vault: () => vault, downloads: () => settings.app().web.downloads })
  setupPlugins({ window: () => win, vault: () => vault })
  setupReading({ win: () => win, vault: () => vault, recap: () => settings.app().pdf.recap })
  setupSearch({ win: () => win, vault: () => vault, semantic: () => settings.app().editor.semantic })
  registerFiles(() => vault)
  family = registerFamily({
    vault: () => vault,
    send: (ch, ...a) => win?.webContents.send(ch, ...a),
    fetchOn: () => settings.app().familyFetch,
    // 测试模式：装了哪些读 CN_FAMILY_INSTALLED_FILE；CN_TODAY_INSTALLED=1（以前的测试）也算装了画布今日；名单只从 CN_FAMILY_URL 读
    test: E2E
      ? {
          installedFile: process.env.CN_FAMILY_INSTALLED_FILE,
          url: process.env.CN_FAMILY_URL,
          extra: process.env.CN_TODAY_INSTALLED === '1' ? { 'canvas-today': { version: '0.3.0', path: '/Applications/Canvas Today.app' } } : {},
        }
      : null,
  })
  family.watch(vault?.root ?? null)
  const todo = registerTodo({ vault: () => vault, win: () => win, family })
  // 「日历」格：系统日历只读、AI 排进空着的时间（task-kzr3n）
  registerCalendar({ win: () => win, todos: todo.list, root: () => vault?.root ?? null })
  // 待办写时间：本地认不出的那一行问 AI（task-pd289）
  registerWhen()
  registerMobileAi({ vault: () => vault, win: () => win })
  // 设置 › 对外接口（task-av5t8）：别的 AI 经小程序 canvas-notes-mcp 连进来读笔记、在这里打开某篇
  const mcpExt = setupMcpExt({
    userData: app.getPath('userData'),
    vault: () => vault,
    ready: () => !!vault && noticeReady,
    win: () => win,
    knownVaults: () => settings.read().knownVaults ?? [],
    semantic: () => settings.app().editor.semantic,
    meaning: searchMeaning,
    meaningStatus: searchStatus,
    familyInstalled: () => family!.installed(),
  })
  void mcpExt.open().catch((e: unknown) => console.error('对外接口没起来', e))
  setupVideo({ window: () => win, vault: () => vault, ses: web, userData: app.getPath('userData') })
  // 退出时最后存一次：窗口都关了以后（before-quit 时网页还在，之后还会改它，留下的定时器会在 Node 收尾时才跑）
  app.on('will-quit', flushVideo)
  setupImport({ win: () => win, vault: () => vault, filesChanged: () => win?.webContents.send('files:changed') })
  // 开发时程序坞里也显示应用图标（打包后用 .icns）
  if (E2E) app.dock?.hide()
  else if (!app.isPackaged) app.dock?.setIcon(join(__dirname, '../../build/icon.png'))
  createWindow()
  buildMenu()
  setupLang({ settings, rebuildMenus: () => (buildMenu(), quick.refreshMenu()) })
  void setupUpdater()
  app.on('activate', () => {
    if (!win) createWindow()
  })
})

// 检查更新：正式发布的包（打包时带了 app-update.yml）才查；开发版、本机自己打的包、端到端测试不查。
// CN_UPDATE_URL：测试时指向本机的更新服务器
let updater: Updater | null = null
/** 自动化（task-i921u）：whenReady 里建，打开库时开始 */
let automation: ReturnType<typeof setupAutomation> | null = null
let sources: ReturnType<typeof setupSources> | null = null
let quick: ReturnType<typeof setupQuick>
async function setupUpdater() {
  const feedUrl = process.env.CN_UPDATE_URL ?? ''
  const supported = app.isPackaged && existsSync(join(process.resourcesPath, 'app-update.yml')) && (!E2E || !!feedUrl)
  // electron-updater 是 CommonJS，autoUpdater 是取值时才建的属性：从 ESM 里 import 时它在 default 上
  type Engine = ConstructorParameters<typeof Updater>[0]['engine']
  const mod = supported ? ((await import('electron-updater')) as unknown as { autoUpdater?: Engine; default?: { autoUpdater: Engine } }) : null
  const engine = mod ? (mod.default?.autoUpdater ?? mod.autoUpdater) : undefined
  updater = new Updater({
    supported,
    enabled: () => settings.app().autoUpdate,
    feedUrl,
    engine,
    native: process.platform === 'darwin' ? nativeUpdater : null,
    inApps: !app.isPackaged || app.isInApplicationsFolder(),
    version: app.getVersion(),
    checkedAt: Number(settings.read().updateCheckedAt) || 0,
  })
  let phase = ''
  updater.on('state', (st) => {
    win?.webContents.send('update:state', st)
    if (st.phase === phase) return // 下载进度一秒好几次，菜单只在阶段变了时重建
    phase = st.phase
    if (st.phase === 'latest') settings.patch({ updateCheckedAt: st.checkedAt })
    buildMenu()
    quick.refreshMenu()
  })
  updater.on('quitting', () => (quitting = true))
  nativeUpdater.on('before-quit-for-update', () => (quitting = true))
  ipcMain.handle('update:status', () => updater!.status())
  ipcMain.handle('update:check', async () => {
    try {
      const state = await updater!.check()
      return state.phase === 'error' ? { ok: false, error: updateError(state.error, state.version).text, state } : { ok: true, state }
    } catch (e) {
      const st = updater!.status()
      return { ok: false, error: updateError(String((e as Error)?.message ?? e), st.version).text, state: st }
    }
  })
  ipcMain.handle('update:install', () => installUpdate())
  // 不在「应用程序」文件夹：挪过去并重开（「应用程序」里有旧的、没在跑时旧的进废纸篓）；用户在授权框点取消返回 false
  ipcMain.handle('update:moveToApps', () => app.moveToApplicationsFolder())
  ipcMain.handle('update:reveal', () => shell.showItemInFolder(app.getPath('exe').replace(/\/Contents\/MacOS\/[^/]+$/, '')))
  ipcMain.handle('update:releaseUrl', () => releaseUrl(BRAND.repo, updater!.status().version || app.getVersion()))
  updater.start()
}

/** 下好的新版：先存编辑器里没存的字、提交没提交的改动，再退出、装上、重新打开 */
async function installUpdate(): Promise<boolean> {
  if (updater?.status().phase !== 'ready') return false
  await saveOpenNotes()
  await commitPending().catch((err) => console.error('更新前提交失败', err))
  quitting = true
  return updater.install()
}

/** 「检查更新…」：显示主窗口、打开设置的「更新」页、立刻查一次 */
function checkFromMenu() {
  if (!win) createWindow()
  else if (!E2E) win.show()
  win?.webContents.send('update:open')
  void updater?.check().catch(() => undefined)
}

/** 下好了时菜单栏图标的菜单最上面多这一项 */
function readyItems(): Electron.MenuItemConstructorOptions[] {
  const st = updater?.status()
  return st?.phase === 'ready' ? [{ label: t('重启并更新到 {v}', { v: st.version, ctx: '菜单栏' }), click: () => void installUpdate() }, { type: 'separator' }] : []
}

/**
 * 菜单栏：应用菜单里多「检查更新…」和「设置…」，文件、显示、前往三个菜单是软件的命令。每项的键都照命令表（shared/cmd-table.ts），
 * 界面里改了键这里跟着换（commands.ts 的 menuKey）；键由界面自己接（网页有焦点时主进程转过去），菜单上只显示、不注册，点了交给界面跑那条命令。
 * 放大、缩小、原大是系统的整个窗口缩放：白板、PDF 上界面先接住缩它们，别处才轮到菜单缩整个窗口。
 * 不放「重新载入」「强制重新载入」：⌘R、⇧⌘R 会把整个软件重新载入（0.4.6 里 ⇧⌘R 写在「最近」上，按了是这个），⌘R 现在是重新载入右栏网页
 */
function buildMenu() {
  const accel = (id: string) => {
    const k = menuKey(id)
    return k ? accelOf(k) : undefined
  }
  // 按键触发的（macOS 上菜单栏那一项的键总是注册着）发 cmd:，界面和同一下按键的 keydown 算一对、只跑一次；鼠标点的发 pick:，每点一下都跑
  const via = (e: Electron.KeyboardEvent | undefined) => (e?.triggeredByAccelerator ? 'cmd' : 'pick')
  const cmd = (id: string, label: string): Electron.MenuItemConstructorOptions => ({ label, accelerator: accel(id), registerAccelerator: false, click: (_i, _w, e) => win?.webContents.send('app:key', `${via(e)}:${id}`) })
  const st = updater?.status()
  const updateItem: Electron.MenuItemConstructorOptions =
    st?.phase === 'ready'
      ? { label: t('重启并更新到 {v}', { v: st.version, ctx: '菜单栏' }), click: () => void installUpdate() }
      : { label: st ? menuLabel(st) : t('检查更新…', { ctx: '菜单栏' }), enabled: !!st && ['idle', 'latest', 'error'].includes(st.phase), click: checkFromMenu }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(menuIn([
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          updateItem,
          { type: 'separator' },
          cmd('settings', '设置…'),
          { type: 'separator' },
          { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }],
      },
      {
        label: '文件',
        submenu: [
          cmd('new-note', '新建笔记'),
          cmd('new-board', '新建白板'),
          cmd('new-course', '新建一门课'),
          cmd('new-folder', '新建文件夹'),
          cmd('capture', '拍一张导图'),
          cmd('import', '导入旧笔记…'),
          cmd('save-desk', '存成书桌…'),
          { type: 'separator' },
          // 关闭走界面那条路（CN-98）：主窗口里关当前栏里的东西（标签、网页标签、收起历史这一格……），不关整个窗口；别的窗口照旧关掉，所以这一项注册键
          {
            label: '关闭',
            accelerator: accel('close'),
            click: (_i, _w, e) => {
              const w = BrowserWindow.getFocusedWindow()
              if (!w || w === win) win?.webContents.send('app:key', `${via(e)}:close`)
              else w.close()
            },
          },
        ],
      },
      // 编辑：系统那几项照旧，多一项「在这一页里找」（⇧⌘F，键照命令表；⌘F 是搜索，在「前往」里）
      {
        label: '编辑',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'pasteAndMatchStyle' },
          { role: 'delete' },
          { role: 'selectAll' },
          { type: 'separator' },
          cmd('find-in-page', '在这一页里找'),
          { type: 'separator' },
          { label: '朗读', submenu: [{ role: 'startSpeaking' }, { role: 'stopSpeaking' }] },
        ],
      },
      {
        label: '显示',
        submenu: [
          cmd('toggle-left', '收起 / 展开左栏'),
          cmd('toggle-right', '收起 / 展开右栏'),
          cmd('fold-center', '当前这栏占满 / 还原'),
          cmd('split-center', '分屏 / 合成一格'),
          { type: 'separator' },
          cmd('left-files', '左栏：文件'),
          cmd('left-recent', '左栏：最近'),
          cmd('left-desks', '左栏：书桌'),
          cmd('left-trash', '左栏：最近删掉的'),
          cmd('dream-report', '梦游报告'),
          cmd('outline', '大纲'),
          cmd('related', '相关'),
          cmd('open-web', '网页'),
          cmd('history', '历史'),
          cmd('ask-ai', 'AI'),
          { type: 'separator' },
          cmd('toggle-view', '白板 / 文档切换'),
          { type: 'separator' },
          { role: 'zoomIn', label: '放大', accelerator: accel('zoom-in') },
          { role: 'zoomOut', label: '缩小', accelerator: accel('zoom-out') },
          { role: 'resetZoom', label: '原大', accelerator: accel('zoom-reset') },
          { type: 'separator' },
          { role: 'togglefullscreen' },
          { role: 'toggleDevTools' },
        ],
      },
      {
        label: '前往',
        submenu: [cmd('back', '后退'), cmd('forward', '前进'), cmd('home', '回到首页'), { type: 'separator' }, cmd('goto', '按名字跳到…'), cmd('search', '搜索…')],
      },
      { role: 'windowMenu' },
      // 白屏这类问题让用户把日志发过来（task-pyb39）
      { role: 'help', label: '帮助', submenu: [{ label: '打开日志文件夹', click: () => void revealLogs(crashLog) }] },
    ])),
  )
}

// 测试模式：退出的每一步记进设置目录的 quit.log（端到端测试关软件卡住时看卡在哪一步）
const quitLog = (what: string) => E2E && appendFileSync(join(app.getPath('userData'), 'quit.log'), `${Date.now()} ${what}\n`)

/**
 * 退出途中主进程里再抛出来的错（包括没人接的 Promise 失败）只记下来，不弹 Electron 默认的「A JavaScript error occurred in the main process」框。
 * 那个框是模态的：退出途中弹出来，软件就停在框上退不出去（端到端测试里窗口在屏幕外，没人点，一直挂着），
 * Node 的事件循环也跟着停，正在跑的 git 退出了没人收（ps 里的 <defunct>）。平时出错还是照常弹框（不加这个监听，Electron 的默认处理才在）。
 */
let quietErrors = false
function quietErrorsWhileQuitting() {
  if (quietErrors) return
  quietErrors = true
  process.on('uncaughtException', (err, origin) => {
    console.error('退出途中出错（不弹框）', origin, err)
    quitLog(`出错（不弹框）：${String((err as Error)?.stack ?? err).replace(/\n/g, ' | ')}`)
  })
}

/** 存的结果：problems 没存好的（写不进去只在内存里的篇、保存出错、5 秒没完）；stranded 哪都写不进去、字只在内存里的篇；rescued 原文件写不进去、字在另存那篇的 */
interface SavedNotes {
  problems: string[]
  stranded: StrandedNote[]
  rescued: string[]
}

/**
 * 编辑器里还没自动保存的字（停手 0.8 秒才存）先写到磁盘；网页卡住时最多等 5 秒。
 * 写不进去的篇另存了的照实记另存到哪；哪都写不进去的（字只在内存里）单独回给调的人，退出、关窗口前要用户确认
 */
async function saveOpenNotes(wins = BrowserWindow.getAllWindows()): Promise<SavedNotes> {
  let timer: NodeJS.Timeout | undefined
  const each = await Promise.race([
    Promise.all(
      wins
        .filter((w) => !w.isDestroyed())
        .map((w) =>
          w.webContents.executeJavaScript('window.cnSaveAll && window.cnSaveAll()').then(
            (r: unknown): SavedNotes => {
              const s = (r ?? {}) as Partial<SavedNotes>
              const stranded = Array.isArray(s.stranded) ? s.stranded : []
              return { problems: stranded.map((x) => `${x.path} 写不进去，字只在内存里`), stranded, rescued: Array.isArray(s.rescued) ? s.rescued : [] }
            },
            (e): SavedNotes => (console.error('退出前保存失败', e), { problems: [`保存出错：${String((e as Error)?.message ?? e)}`], stranded: [], rescued: [] }),
          ),
        ),
    ),
    new Promise<SavedNotes[]>((r) => (timer = setTimeout(() => (console.error('退出前保存 5 秒没完，接着退出'), r([{ problems: ['5 秒没存完'], stranded: [], rescued: [] }])), 5000))),
  ])
  clearTimeout(timer)
  return { problems: each.flatMap((x) => x.problems), stranded: each.flatMap((x) => x.stranded), rescued: each.flatMap((x) => x.rescued) }
}

/**
 * 有篇哪都写不进去、字只在内存里（盘满了、没有写权限）：退出、关窗口前问一句，用户点「仍然退出」才走（测试模式下记进 cnScreen）。
 * 返回要不要接着退
 */
async function confirmStranded(stranded: StrandedNote[]): Promise<boolean> {
  if (!stranded.length) return true
  const home = app.getPath('home')
  const where = stranded.map((s) => `《${titleOf(s.path)}》：${s.stash ? s.stash.replace(home, '~') : '备份也没写进去'}`)
  const opts: Electron.MessageBoxOptions = {
    type: 'warning',
    message: `有 ${stranded.length} 篇写不进去，字只在内存里`,
    detail: `原文件和它旁边都写不进去（磁盘满了，或者没有写权限）。字备了一份在：\n${where.join('\n')}\n\n先腾出空间或改好权限，回到那篇再打一个字就会存上。现在退出，编辑器里的字只剩这份备份。`,
    buttons: ['先不退出', '仍然退出'],
    defaultId: 0,
    cancelId: 0,
  }
  const r = win && !win.isDestroyed() ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
  return r.response === 1
}

/** 没存上的字的备份放这里（软件自己的设置目录，不在库里，不进 Git） */
const stashDir = () => join(app.getPath('userData'), '没存上的字')
/** 2026-11-17 18.25 */
function stashStamp(d: Date): string {
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}`
}


// 退出：先存编辑器里没存的字，再把没提交的改动提交掉，再退
let quitting = false
let savingForQuit = false
/** 开始退出了：关窗口时不再拦（见 createWindow） */
let quitStarted = false
app.on('before-quit', (e) => {
  quitLog('before-quit')
  quietErrorsWhileQuitting()
  quitStarted = true
  // 开着的系统菜单（右键、「更多」）先收起：不收，进程出不了菜单循环（ctx-menu.ts）
  const menus = closeAllMenus()
  if (menus) quitLog(`收起菜单 ${menus} 个`)
  // 梦游、找重复正在算的（大库要几分钟）直接停掉，下次再算
  const jobs = stopSimilar()
  if (jobs) quitLog(`停下找像的笔记 ${jobs} 个`)
  if (stopGrowth()) quitLog('停下生长图')
  if (quitting || !vault) return
  // 先拦下这次退出：存字要等界面回话
  e.preventDefault()
  if (savingForQuit) return
  savingForQuit = true
  void saveOpenNotes().then(async ({ problems, stranded, rescued }) => {
    // 有篇的字只在内存里：先问，用户说先不退出就停下（字还在编辑器里，腾出空间后接着存）
    if (!(await confirmStranded(stranded))) {
      quitLog(`没退出：${stranded.map((s) => s.path).join('、')} 写不进去，用户先不退出`)
      savingForQuit = false
      quitStarted = false
      return
    }
    quitLog(problems.length ? `没存好：${problems.join('；')}` : `存完${rescued.length ? `（原文件写不进去，字在另存的那篇：${rescued.join('；')}）` : ''}`)
    quitting = true
    try {
      if (vault) commitPendingSync(vault.root)
      quitLog('提交完')
      // 设置 › Git和同步「退出前推一次」：最多等 8 秒，没网、远程比本机新都照常退出
      if (vault && settings.app().sync.pushOnQuit) quitLog(pushSync(vault.root))
    } catch (err) {
      console.error('退出前提交失败', err)
      // 锁一直不放（上次 git 崩了留下的）等情况：字在文件里，没提交；照实记，不写「提交完」
      quitLog(`没提交上：${commitErrorText(String((err as { stderr?: string }).stderr || (err as Error).message))}`)
    }
    // 窗口直接销毁，不走网页的卸载：右栏网页（视频页、框着问过的页）偶尔卸载不完，窗口就一直关不掉。字都存过、提交过了，销毁不丢东西
    for (const w of BrowserWindow.getAllWindows()) w.destroy()
    app.quit()
  })
})

/**
 * 退出前的提交用同步的 git：不靠事件循环，正常一两百毫秒，每步最多 10 秒；失败了照样退出（改动还在文件里，下次自动提交时带上）。
 * 刚好撞上后台正在提交（视频、微信读书这些自己会提交），index.lock 被占着：等它一会儿再试，最多约 3 秒
 */
function commitPendingSync(root: string) {
  const run = (args: string[]) =>
    execFileSync('git', ['-c', 'core.quotepath=false', ...args], { cwd: root, timeout: 10_000, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, PATH: git.gitPath(), GIT_TERMINAL_PROMPT: '0' } })
  for (let i = 0; ; i++) {
    try {
      const st = git.parseStatus(run(git.STATUS_ARGS))
      if (!st.length) return
      run(['add', '-A'])
      run(['commit', '-q', '-m', git.describeChanges(st)])
      return
    } catch (err) {
      if (i >= 20 || !/index\.lock/.test(String((err as Error).message))) throw err
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150)
    }
  }
}
/** 退出前推一次：同步的 git（不靠事件循环），推不上不重试、不拉，照常退出；返回记进 quit.log 的那句 */
function pushSync(root: string): string {
  const run = (args: string[], timeout = 10_000) =>
    execFileSync('git', ['-c', 'core.quotepath=false', ...args], { cwd: root, timeout, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, PATH: git.gitPath(), GIT_TERMINAL_PROMPT: '0' } })
  try {
    const remote = run(['remote']).trim().split('\n')[0]
    if (!remote) return '退出前推：没有远程'
    const branch = run(['rev-parse', '--abbrev-ref', 'HEAD']).trim()
    run(['push', remote, `HEAD:${branch}`], 8000)
    return '退出前推完'
  } catch (err) {
    return `退出前没推上：${String((err as { stderr?: string }).stderr || (err as Error).message).trim().split('\n')[0]}`
  }
}
app.on('quit', () => quitLog('quit'))
// 软件自己的窗口（主窗口、速记小窗）里界面没接管的右键（输入框、选了字）：标准编辑菜单
app.on('browser-window-created', (_e, w) => attachEditMenu(w.webContents))

// 关掉窗口不退出：菜单栏和 ⌥⌘N 速记还要用（⌘Q 或菜单栏「退出」才退）
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    vault?.close()
    app.quit()
  }
})

app.on('will-quit', () => {
  quitLog('will-quit')
  globalShortcut.unregisterAll()
  vault?.close()
})
