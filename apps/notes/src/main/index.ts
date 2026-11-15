import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeTheme, session, shell } from 'electron'
import { copyFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import * as git from '@cn/git'
import type { Activity, AiChange, GitState, NoteMenuAction, VaultInfo } from '../shared/api'
import { activeSkin, type AppSettings, WIN_COLOR } from '../shared/appearance'
import { BRAND } from '../shared/brand'
import { kindOf, titleOf } from '../shared/layout'
import { dayKey, logActivity, readActivity } from './activity'
import { attachWeb, registerAgent } from './agent'
import { ask } from './ai'
import { registerAttachments, registerFileScheme } from './attachments'
import { importCookies, listProfiles } from './chrome-import'
import { setupDream } from './dream-main'
import { duplicatesOf, readAll } from './duplicates'
import { registerHome } from './home'
import { pinNote, readPins, repin } from './pins'
import { setupQuick } from './quick'
import { SettingsFile } from './settings'
import { Vault } from './vault'
import { setupPlugins } from './plugins'
import { attachWebview, setupWeb } from './web'

/** 内置浏览器的登录分区：和软件自己的界面分开，导入的 Chrome 登录放这里 */
const WEB_PARTITION = 'persist:web'
const webviewPreload = () => join(__dirname, '../preload/webview.js')

// 设置目录固定叫 canvas-notes（工作名时代就是它）：显示名换了，用户的设置、AI 对话、网页登录不搬家。测试和多开时用自己的
app.setPath('userData', process.env.CN_USER_DATA || join(app.getPath('appData'), 'canvas-notes'))
registerFileScheme()

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

const settings = new SettingsFile(join(app.getPath('userData'), 'settings.json'))
/** 现在窗口用的是哪套主题（速记小窗、窗口底色跟着它） */
const currentSkin = () => activeSkin(settings.app().appearance, nativeTheme.shouldUseDarkColors)

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
    win?.setBackgroundColor(WIN_COLOR[currentSkin()])
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
  ipcMain.handle('note:menu', async (_e, path: string) => {
    const v = needVault()
    v.abs(path)
    const pinned = (await readPins(v)).includes(path)
    return new Promise<NoteMenuAction>((resolve) => {
      let picked: NoteMenuAction = null
      const menu = Menu.buildFromTemplate([
        pinned ? { label: '取消置顶', click: () => (picked = 'unpin') } : { label: '置顶', click: () => (picked = 'pin') },
        { type: 'separator' },
        { label: '重命名', click: () => (picked = 'rename') },
        { label: '在 Finder 中显示', click: () => (picked = 'reveal') },
        { type: 'separator' },
        { label: '移到废纸篓', click: () => (picked = 'trash') },
      ])
      menu.popup({ window: win!, callback: () => resolve(picked) })
    }).then(async (a) => {
      if (a === 'reveal') shell.showItemInFolder(v.abs(path))
      if (a === 'pin' || a === 'unpin') await pinNote(v, path, a === 'pin')
      return a
    })
  })
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
  registerAttachments(needVault, () => win, app.getPath('userData'))
  registerHome(needVault, () => win)
  ipcMain.handle('git:history', (_e, limit: number) => git.log(needVault().root, Math.min(Math.max(1, Number(limit) || 50), 500)))
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    // 端到端测试的窗口放到屏幕外，不挡人
    ...(process.env.CN_E2E === '1' ? { x: -3000, y: 80 } : {}),
    title: BRAND.name,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: WIN_COLOR[currentSkin()],
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      webviewTag: true,
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
    if (!/^(https?:|about:blank)/.test(params.src ?? '')) params.src = 'about:blank'
  })
  win.webContents.on('did-attach-webview', (_e, wc) => {
    // AI 要能操纵右栏网页
    attachWeb(wc)
    // 新窗口链接开成新网页标签、记历史、插件、网页焦点时的快捷键：都在 web/index.ts
    attachWebview(wc, win!)
  })
  win.once('ready-to-show', () => win?.show())
  win.on('closed', () => (win = null))
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
  const dreams = setupDream({ root: () => vault?.root ?? null, send: (ch, ...args) => win?.webContents.send(ch, ...args) })
  setupQuick({
    vault: () => vault,
    onSaved: () => win?.webContents.send('files:changed'),
    openMain: () => {
      if (!win) createWindow()
      else win.show()
      app.focus({ steal: true })
    },
    dreamNow: () => void dreams.dreamNow().catch((e) => console.error('梦游失败', e)),
    settings: () => settings.read(),
    saveSettings: (patch) => settings.patch(patch),
    skin: currentSkin,
  })
  await setupWeb({ partition: WEB_PARTITION, window: () => win, vault: () => vault })
  setupPlugins({ window: () => win, vault: () => vault })
  // 开发时程序坞里也显示应用图标（打包后用 .icns）
  if (!app.isPackaged) app.dock?.setIcon(join(__dirname, '../../build/icon.png'))
  createWindow()
  app.on('activate', () => {
    if (!win) createWindow()
  })
})

// 退出前把没提交的改动提交掉
let quitting = false
app.on('before-quit', (e) => {
  if (quitting || !vault) return
  e.preventDefault()
  quitting = true
  void commitPending()
    .catch((err) => console.error('退出前提交失败', err))
    .finally(() => app.quit())
})

// 关掉窗口不退出：菜单栏和 ⌥⌘N 速记还要用（⌘Q 或菜单栏「退出」才退）
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    vault?.close()
    app.quit()
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  vault?.close()
})
