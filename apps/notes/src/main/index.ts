import { app, autoUpdater as nativeUpdater, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeTheme, session, shell } from 'electron'
import { execFileSync } from 'node:child_process'
import { appendFileSync, copyFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import * as git from '@cn/git'
import type { Activity, AiChange, GitState, VaultInfo } from '../shared/api'
import { activeSkin, type AppSettings, skinOf } from '../shared/appearance'
import { themeCss, themeInfo, type ThemeFile } from '../shared/vscode-theme'
import { isExtUrl } from '../shared/bookmarkkeeper'
import { BRAND } from '../shared/brand'
import { kindOf, titleOf } from '../shared/layout'
import { dayKey, logActivity, readActivity } from './activity'
import { attachWeb, registerAgent } from './agent'
import { ask } from './ai'
import { registerAttachments, registerFileScheme } from './attachments'
import { importCookies, listProfiles } from './chrome-import'
import { parseDiff } from './dream'
import { setupDream } from './dream-main'
import { setupMindmap } from './mindmap'
import { duplicatesOf, readAll } from './duplicates'
import { registerHome } from './home'
import { registerFolderHome } from './folder-home'
import { readPins, repin } from './pins'
import { setupQuick } from './quick'
import { E2E } from './test-mode'
import { Updater } from './updater'
import { menuLabel, releaseUrl, updateError } from '../shared/update'
import { SettingsFile } from './settings'
import { ThemeStore } from './themes'
import { Vault } from './vault'
import { setupPlugins } from './plugins'
import { setupReading } from './reading'
import { searchVault, setupSearch } from './search'
import { registerFiles } from './files'
import { setupImport } from './import'
import { attachEditMenu, closeAllMenus, forwardWebContext, popup, setupCtxMenu } from './ctx-menu'
import { attachWebview, setupWeb } from './web'
import { attachVideo, flushVideo, setupVideo } from './video'

/** 内置浏览器的登录分区：和软件自己的界面分开，导入的 Chrome 登录放这里 */
const WEB_PARTITION = 'persist:web'
const webviewPreload = () => join(__dirname, '../preload/webview.js')

// 设置目录固定叫 canvas-notes（工作名时代就是它）：显示名换了，用户的设置、AI 对话、网页登录不搬家。测试和多开时用自己的
app.setPath('userData', process.env.CN_USER_DATA || join(app.getPath('appData'), 'canvas-notes'))
registerFileScheme()
// 端到端测试用 Chromium 的假摄像头：不碰真的摄像头、不弹系统的授权框
if (E2E) {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream')
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream')
}

let win: BrowserWindow | null = null
let vault: Vault | null = null
/** 上次同步成功的时间 */
let lastSync: number | null = null

/** 自动提交间隔在设置里（默认每 10 分钟）；测试用 CN_MINUTE_MS 把「一分钟」缩短 */
const MINUTE_MS = Number(process.env.CN_MINUTE_MS) || 60_000
let autoTimer: NodeJS.Timeout | null = null

/** 按设置里的间隔重新排自动提交；0 = 不自动提交 */
function scheduleAutoCommit() {
  if (autoTimer) clearInterval(autoTimer)
  autoTimer = null
  const min = settings.app().autoCommitMinutes
  if (!vault || min === 0) return
  autoTimer = setInterval(() => void commitPending().catch((e) => console.error('自动提交失败', e)), min * MINUTE_MS)
}

async function commitPending(): Promise<string | null> {
  if (!vault) return null
  const st = await git.status(vault.root)
  if (!st.length) return null
  const hash = await git.commitAll(vault.root, git.describeChanges(st))
  win?.webContents.send('files:changed')
  return hash
}

/** 导入的 VS Code 主题（设置目录 themes/） */
const themes = new ThemeStore(join(app.getPath('userData'), 'themes'))
const userSkins = () => themes.list().map(themeInfo)
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
  if (!(await git.isRepo(root))) await git.init(root)
  // 换库前把旧库没提交的改动提交掉，和退出前一样
  if (vault && vault.root !== root) await commitPending().catch((e) => console.error('换库前提交失败', e))
  vault?.close()
  vault = new Vault(root)
  scheduleAutoCommit()
  vault.watch(
    (path, text) => win?.webContents.send('note:changed', path, text),
    () => win?.webContents.send('files:changed'),
  )
  settings.patch({ lastVault: root })
  searchVault(root)
  return { path: root, name: vault.name }
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
    copyFileSync(r.filePaths[0], join(dir, name))
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
  ipcMain.handle('note:write', (_e, path: string, text: string, base: string) => {
    if (typeof text !== 'string' || typeof base !== 'string') throw new Error('写入参数不对')
    return needVault().write(path, text, base)
  })
  ipcMain.handle('note:conflictCopy', (_e, path: string, text: string) => {
    if (typeof text !== 'string') throw new Error('写入参数不对')
    return needVault().saveConflictCopy(path, text)
  })
  ipcMain.handle('note:create', (_e, folder: string, name: string, text: string) => {
    if (typeof folder !== 'string' || typeof name !== 'string' || typeof text !== 'string') throw new Error('新建参数不对')
    return needVault().create(folder, name, text)
  })
  ipcMain.handle('note:rename', async (_e, path: string, newName: string) => {
    if (typeof newName !== 'string') throw new Error('改名参数不对')
    const v = needVault()
    const to = await v.rename(path, newName)
    await repin(v, path, to)
    return to
  })
  ipcMain.handle('board:create', (_e, folder: string, name: string) => {
    if (typeof folder !== 'string' || typeof name !== 'string') throw new Error('新建参数不对')
    return needVault().createBoard(folder, name)
  })
  ipcMain.handle('note:trash', async (_e, path: string) => {
    const v = needVault()
    const p = v.abs(path)
    // 测试把「废纸篓」换成临时文件夹，不往用户真的废纸篓里放东西
    const testTrash = process.env.CN_TRASH_DIR
    if (testTrash) renameSync(p, join(testTrash, `${Date.now()}-${p.split('/').pop()}`))
    else await shell.trashItem(p)
    await repin(v, path, null)
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
  ipcMain.handle('ai:ask', async (_e, id: number, system: string, prompt: string) => {
    if (typeof system !== 'string' || typeof prompt !== 'string') throw new Error('AI 参数不对')
    const ac = new AbortController()
    asking.set(id, ac)
    try {
      // 边生成边给界面（和 AI 浮窗的一轮对话用同一个事件）
      return await ask(system, prompt, ac.signal, (delta) => win?.webContents.send('ai:event', id, { type: 'text', delta }))
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
    // 这几个文件里用户没提交的字先单独提交，AI 的提交里只有 AI 的改动，撤回才不会带走用户的字
    const pending = (await git.status(v.root)).filter((s) => touched.includes(s.path))
    if (pending.length) await git.commitPaths(v.root, pending.map((s) => s.path), git.describeChanges(pending))
    const paths: string[] = []
    for (const w of writes) {
      if (typeof w.path !== 'string' || typeof w.text !== 'string') throw new Error('AI 改动参数不对')
      if (w.create) paths.push(await v.create(w.path.includes('/') ? w.path.slice(0, w.path.lastIndexOf('/')) : '', titleOf(w.path), w.text))
      else {
        const cur = await v.read(w.path)
        const r = await v.write(w.path, w.text, cur.text)
        if (!r.ok) throw new Error('文件刚被改过，AI 这次没改，再试一次')
        paths.push(w.path)
        // 这次写入是替 AI 写的，打开着这篇的编辑器要收到，按外部改动合并
        win?.webContents.send('note:changed', w.path, w.text)
      }
    }
    for (const m of moves) {
      const to = await v.move(m.from, m.toFolder)
      await repin(v, m.from, to)
      paths.push(m.from, to)
    }
    const hash = await git.commitPaths(v.root, paths, `AI：${change.message}`)
    win?.webContents.send('files:changed')
    if (!hash) return null
    return (await git.log(v.root, 1))[0] ?? null
  })
  ipcMain.handle('ai:revert', async (_e, hash: string) => {
    const v = needVault()
    await git.revert(v.root, hash)
    return (await git.log(v.root, 1))[0] ?? null
  })
  ipcMain.handle('git:state', async (): Promise<GitState> => {
    const v = needVault()
    if (!(await git.isRepo(v.root))) return { isRepo: false, branch: null, changes: [], weekCommits: 0, hasRemote: false, lastSync: null, autoCommitMinutes: 0 }
    const [branch, changes, weekCommits, hasRemote] = await Promise.all([
      git.currentBranch(v.root),
      git.status(v.root),
      git.countCommitsSince(v.root, startOfWeek(new Date())),
      git.hasRemote(v.root),
    ])
    return { isRepo: true, branch, changes, weekCommits, hasRemote, lastSync, autoCommitMinutes: settings.app().autoCommitMinutes }
  })
  ipcMain.handle('git:commit', async () => {
    const v = needVault()
    const st = await git.status(v.root)
    if (!st.length) return null
    const hash = await git.commitAll(v.root, git.describeChanges(st))
    if (!hash) return null
    return (await git.log(v.root, 1))[0] ?? null
  })
  ipcMain.handle('git:sync', async () => {
    const r = await git.sync(needVault().root)
    if (r.kind === 'ok') lastSync = Date.now()
    return r
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
  ipcMain.handle('notes:duplicates', async () => {
    const v = needVault()
    return duplicatesOf(await readAll(v.root, (await v.list()).map((n) => n.path)))
  })
  setupCtxMenu(needVault, () => win?.webContents.send('files:changed'))
  registerAttachments(needVault, () => win, app.getPath('userData'))
  registerHome(needVault, () => win)
  registerFolderHome(needVault, () => win)
  ipcMain.handle('git:history', (_e, limit: number) => git.log(needVault().root, Math.min(Math.max(1, Number(limit) || 50), 500)))
  ipcMain.handle('git:file-diff', async (_e, hash: unknown, path: unknown) => {
    if (typeof hash !== 'string' || !/^[0-9a-f]{7,40}$/.test(hash) || typeof path !== 'string' || path.startsWith('/') || path.split('/').includes('..')) throw new Error('参数不对')
    const v = needVault()
    const out = await git.git(v.root, ['show', '--format=', '-M', '--no-color', '--no-ext-diff', '-U3', hash, '--', path])
    const exists = await stat(join(v.root, path)).then(
      (s) => s.isFile(),
      () => false,
    )
    return { diff: parseDiff(out)[0] ?? null, exists }
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
      // 测试时窗口不激活，也要照常渲染
      ...(E2E ? { backgroundThrottling: false } : {}),
    },
  })
  // 右栏网页：只许用我们的预加载、我们的登录分区，网页拿不到 Node
  win.webContents.on('will-attach-webview', (_e, prefs, params) => {
    delete (prefs as { preloadURL?: string }).preloadURL
    prefs.preload = webviewPreload()
    prefs.nodeIntegration = false
    prefs.contextIsolation = true
    prefs.sandbox = true
    params.partition = WEB_PARTITION
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
  // 测试模式只 showInactive：不激活软件、不抢用户正在用的窗口的焦点
  win.once('ready-to-show', () => (E2E ? win?.showInactive() : win?.show()))
  // 关主窗口（软件不退）：先存编辑器里没存的字再关。退出时（含装更新）字已经存过，这里不拦：拦了 Electron 会取消这次退出
  const w = win
  let notesSaved = false
  w.on('close', (e) => {
    quitLog('窗口 close')
    if (notesSaved || quitStarted) return
    e.preventDefault()
    void saveOpenNotes([w]).then(() => {
      notesSaved = true
      if (!w.isDestroyed()) w.close()
    })
  })
  win.on('closed', () => (quitLog('窗口 closed'), (win = null)))
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

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
  registerAgent({ win: () => win, vault: () => vault })
  setupMindmap({ win: () => win, vault: () => vault })
  const dreams = setupDream({ root: () => vault?.root ?? null, send: (ch, ...args) => win?.webContents.send(ch, ...args) })
  quick = setupQuick({
    vault: () => vault,
    onSaved: () => win?.webContents.send('files:changed'),
    openMain: () => {
      if (!win) createWindow()
      else if (E2E) win.showInactive()
      else win.show()
      if (!E2E) app.focus({ steal: true })
    },
    dreamNow: () => void dreams.dreamNow().catch((e) => console.error('梦游失败', e)),
    settings: () => settings.read(),
    saveSettings: (patch) => settings.patch(patch),
    skin: quickSkin,
    topItems: readyItems,
  })
  await setupWeb({ partition: WEB_PARTITION, window: () => win, vault: () => vault })
  setupPlugins({ window: () => win, vault: () => vault })
  setupReading({ win: () => win, vault: () => vault })
  setupSearch({ win: () => win, vault: () => vault })
  registerFiles(() => vault)
  setupVideo({ window: () => win, vault: () => vault, ses: web, userData: app.getPath('userData') })
  // 退出时最后存一次：窗口都关了以后（before-quit 时网页还在，之后还会改它，留下的定时器会在 Node 收尾时才跑）
  app.on('will-quit', flushVideo)
  setupImport({ win: () => win, vault: () => vault, filesChanged: () => win?.webContents.send('files:changed') })
  // 开发时程序坞里也显示应用图标（打包后用 .icns）
  if (E2E) app.dock?.hide()
  else if (!app.isPackaged) app.dock?.setIcon(join(__dirname, '../../build/icon.png'))
  createWindow()
  buildMenu()
  void setupUpdater()
  app.on('activate', () => {
    if (!win) createWindow()
  })
})

// 检查更新：正式发布的包（打包时带了 app-update.yml）才查；开发版、本机自己打的包、端到端测试不查。
// CN_UPDATE_URL：测试时指向本机的更新服务器
let updater: Updater | null = null
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
  return st?.phase === 'ready' ? [{ label: `重启并更新到 ${st.version}`, click: () => void installUpdate() }, { type: 'separator' }] : []
}

/** 菜单栏：标准的几个菜单，应用菜单里多「检查更新…」（下好了就是「重启并更新到 x」）和「设置…」 */
function buildMenu() {
  const st = updater?.status()
  const updateItem: Electron.MenuItemConstructorOptions =
    st?.phase === 'ready'
      ? { label: `重启并更新到 ${st.version}`, click: () => void installUpdate() }
      : { label: st ? menuLabel(st) : '检查更新…', enabled: !!st && ['idle', 'latest', 'error'].includes(st.phase), click: checkFromMenu }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          updateItem,
          { type: 'separator' },
          // ⌘, 由界面自己处理（网页有焦点时主线转过去），这里只显示快捷键、不注册
          { label: '设置…', accelerator: 'CommandOrControl+,', registerAccelerator: false, click: () => win?.webContents.send('app:key', ',') },
          { type: 'separator' },
          { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }],
      },
      {
        label: '文件',
        submenu: [
          { label: '拍一张导图', accelerator: 'Shift+CommandOrControl+C', click: () => win?.webContents.send('map:open') },
          { label: '导入旧笔记…', click: () => win?.webContents.send('import:open') },
          { type: 'separator' },
          { role: 'close' },
        ],
      },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]),
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

/** 编辑器里还没自动保存的字（停手 0.8 秒才存）先写到磁盘；网页卡住时最多等 5 秒 */
async function saveOpenNotes(wins = BrowserWindow.getAllWindows()): Promise<void> {
  let timer: NodeJS.Timeout | undefined
  await Promise.race([
    Promise.all(
      wins
        .filter((w) => !w.isDestroyed())
        .map((w) => w.webContents.executeJavaScript('window.cnSaveAll && window.cnSaveAll()').catch((e) => console.error('退出前保存失败', e))),
    ),
    new Promise<void>((r) => (timer = setTimeout(() => (console.error('退出前保存 5 秒没完，接着退出'), r()), 5000))),
  ])
  clearTimeout(timer)
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
  if (quitting || !vault) return
  // 先拦下这次退出：存字要等界面回话
  e.preventDefault()
  if (savingForQuit) return
  savingForQuit = true
  void saveOpenNotes().then(() => {
    quitLog('存完')
    quitting = true
    try {
      if (vault) commitPendingSync(vault.root)
    } catch (err) {
      console.error('退出前提交失败', err)
    }
    quitLog('提交完')
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
