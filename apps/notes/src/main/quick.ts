/**
 * 全局速记和菜单栏入口：任何软件里按 ⌥⌘N 弹一个小输入框，回车进收件箱并提交。
 * 有辅助功能权限时，弹出前先模拟一次 ⌘C 拿前台软件里选中的字，浏览器再用 AppleScript 取网址；
 * 没权限就只弹空框，给一个「允许后能带上选中的字」的按钮。权限只在用户点按钮时才去申请。
 * 前台就是画布笔记自己（笔记里、读 PDF、右栏网页里选了字）：不按 ⌘C，直接问自己的窗口选中了什么，不要权限
 * （收件箱「速记抓不到内容」：以前前台是自己时什么都不拿）。拿字的细节在 quick-grab.ts。
 */
import { app, BrowserWindow, clipboard, ClipboardItem, globalShortcut, ipcMain, Menu, nativeImage, screen, systemPreferences, Tray, webContents } from 'electron'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import * as git from '@cn/git'
import { BRAND } from '../shared/brand'
import { hour12, t, tv, uiLang } from '../shared/i18n'
import { quickMarkdown, type QuickContext } from '../shared/quick'
import { accelOf } from '../shared/cmd-keys'
import type { GeneralPrefs } from '../shared/prefs'
import { COPY_JXA, grabSelection, KEYS_UP_JXA } from './quick-grab'
import { E2E } from './test-mode'
import { TRAY_1X, TRAY_2X } from './tray-icon'
import type { Vault } from './vault'

const WIDTH = 600

/** 能取网址的浏览器（bundle id → AppleScript 里怎么问） */
const BROWSERS: Record<string, 'safari' | 'chromium'> = {
  'com.apple.Safari': 'safari',
  'com.google.Chrome': 'chromium',
  'com.google.Chrome.beta': 'chromium',
  'company.thebrowser.Browser': 'chromium',
  'com.microsoft.edgemac': 'chromium',
  'com.brave.Browser': 'chromium',
  'com.vivaldi.Vivaldi': 'chromium',
  'org.chromium.Chromium': 'chromium',
}

function run(cmd: string, args: string[], timeout = 1500): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(cmd, args, { timeout }, (err, stdout) => (err ? reject(err) : resolve(stdout))),
  )
}

/** 前台软件的名字和 bundle id（lsappinfo 不需要任何权限） */
async function frontApp(): Promise<{ name: string; bundle: string } | null> {
  const asn = (await run('lsappinfo', ['front'])).trim()
  if (!asn) return null
  const info = await run('lsappinfo', ['info', '-only', 'name', '-only', 'bundleid', asn])
  const name = /"LSDisplayName"="([^"]*)"/.exec(info)?.[1]
  const bundle = /"CFBundleIdentifier"="([^"]*)"/.exec(info)?.[1]
  return name && bundle ? { name, bundle } : null
}

/** 剪贴板里原来的东西（每种格式都先读成 Blob），拿完字原样放回去 */
async function saveClipboard(): Promise<ClipboardItem[]> {
  return Promise.all(
    (await clipboard.read()).map(async (item) => {
      const parts: Record<string, Blob> = {}
      for (const type of item.types) {
        const v = await item.getType(type)
        if (v instanceof Blob) parts[type] = v
      }
      return new ClipboardItem(parts)
    }),
  )
}

/** 拿前台软件里选中的字：模拟 ⌘C，读剪贴板，再还原（quick-grab.ts） */
function copySelection(): Promise<string> {
  return grabSelection<ClipboardItem[]>({
    save: saveClipboard,
    restore: async (saved) => {
      clipboard.clear()
      if (saved.length) await clipboard.write(saved)
    },
    writeText: (t) => clipboard.writeText(t),
    readText: () => clipboard.readText(),
    keysUp: async (max) => void (await run('osascript', ['-l', 'JavaScript', '-e', KEYS_UP_JXA, String(max)], max + 1500)),
    pressCopy: async () => void (await run('osascript', ['-l', 'JavaScript', '-e', COPY_JXA])),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  })
}

/** 画布笔记自己的窗口里选中的字：右栏网页（webview）里选的问那个网页，别的问界面（renderer/quick-grab.ts 的 cnQuickGrab） */
async function ownSelection(w: BrowserWindow): Promise<{ text: string; url?: string; title?: string }> {
  const r = (await w.webContents.executeJavaScript('window.cnQuickGrab ? window.cnQuickGrab() : { text: String(getSelection() ?? "") }')) as { text?: string; webview?: number }
  if (typeof r?.webview === 'number') {
    const guest = webContents.fromId(r.webview)
    if (!guest) return { text: '' }
    const text = String((await guest.executeJavaScript('String(getSelection() ?? "")')) ?? '')
    return { text, url: guest.getURL(), title: guest.getTitle() }
  }
  return { text: typeof r?.text === 'string' ? r.text : '' }
}

async function browserPage(bundle: string): Promise<{ url: string; title: string } | null> {
  const kind = BROWSERS[bundle]
  if (!kind) return null
  const script =
    kind === 'safari'
      ? `tell application id "${bundle}" to return (URL of front document) & linefeed & (name of front document)`
      : `tell application id "${bundle}" to return (URL of active tab of front window) & linefeed & (title of active tab of front window)`
  const [url = '', ...title] = (await run('osascript', ['-e', script])).trim().split('\n')
  return /^https?:\/\//.test(url) ? { url, title: title.join(' ').trim() } : null
}

export function setupQuick(o: {
  vault(): Vault | null
  /** 存好后通知主窗口刷新 */
  onSaved(path: string): void
  openMain(): void
  dreamNow(): void
  settings(): { quickHint?: boolean }
  saveSettings(patch: { quickHint?: boolean }): void
  /** 主窗口现在用的主题，速记小卡跟着它 */
  skin(): NonNullable<QuickContext['skin']>
  /** 菜单栏图标的菜单最上面多的几项（新版本下好了时「重启并更新到 x」） */
  topItems?(): Electron.MenuItemConstructorOptions[]
  /** 设置 › 一般：速记的键、菜单栏图标、带不带来源 */
  prefs(): GeneralPrefs
  /** 主窗口（前台是画布笔记自己、又说不出哪个窗口有焦点时问它） */
  mainWindow(): BrowserWindow | null
}) {
  let win: BrowserWindow | null = null
  let ctx: QuickContext = { trusted: false, hint: true }
  /** 弹出前的前台软件，关掉后把焦点还给它 */
  let prev: { name: string; bundle: string } | null = null
  let ready: Promise<void> | null = null

  const trusted = () => process.env.CN_NO_AX !== '1' && process.platform === 'darwin' && systemPreferences.isTrustedAccessibilityClient(false)

  function make(): BrowserWindow {
    const w = new BrowserWindow({
      width: WIDTH,
      height: 160,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      type: 'panel',
      title: t('速记'),
      webPreferences: { preload: join(__dirname, '../preload/quick.js'), contextIsolation: true, sandbox: true },
    })
    w.setAlwaysOnTop(true, 'floating')
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    // 点到别处就收起；端到端测试不收（别的测试窗口抢焦点会让它无故收起）
    if (!E2E) w.on('blur', () => hide(false))
    w.on('closed', () => {
      win = null
      ready = null
    })
    ready = new Promise((r) => w.webContents.once('did-finish-load', () => r()))
    if (process.env.ELECTRON_RENDERER_URL) void w.loadURL(process.env.ELECTRON_RENDERER_URL + '/quick.html')
    else void w.loadFile(join(__dirname, '../renderer/quick.html'))
    return w
  }

  function hide(restoreFocus: boolean) {
    if (!win?.isVisible()) return
    win.hide()
    if (restoreFocus && prev && !E2E) void run('open', ['-b', prev.bundle]).catch(() => undefined)
  }

  /** 正在弹的那一次（连按：后按的那下等它弹完，不再拿一遍） */
  let showing: Promise<void> | null = null
  /** 弹出速记框。t.front：端到端测试里假装前台是哪个软件（测试不碰真的前台软件） */
  function show(t?: { front?: { name: string; bundle: string } }): Promise<void> {
    showing ??= open(t).finally(() => (showing = null))
    return showing
  }
  async function open(t?: { front?: { name: string; bundle: string } }) {
    if (win?.isVisible()) {
      if (!E2E) win.focus()
      return
    }
    prev = null
    const isTrusted = trusted()
    ctx = { trusted: isTrusted, hint: !isTrusted && o.settings().quickHint !== false, skin: o.skin(), key: o.prefs().quickKey, lang: { ui: uiLang(), hour12: hour12() } }
    if (!E2E) prev = await frontApp().catch((e) => (console.error('速记：认不出前台软件', e), null))
    else prev = t?.front ?? null
    const self = !!prev && (prev.bundle === BRAND.appId || prev.name === app.getName())
    // 设置 › 一般「选中文字时带上来源」关着：只拿选中的字，不记是哪个软件、哪个网页
    const src = o.prefs().quickSrc
    if (self) {
      // 前台是自己：问自己的窗口（不要权限）；关掉后焦点本来就在这里，不用还回去
      prev = null
      const w = BrowserWindow.getAllWindows().find((x) => x.isFocused() && x !== win) ?? o.mainWindow()
      const own = w ? await ownSelection(w).catch((e) => (console.error('速记：读不出自己窗口里选中的字', e), null)) : null
      if (own?.text.trim()) {
        ctx.selection = own.text.slice(0, 20000)
        if (src) {
          if (own.url && /^https?:\/\//.test(own.url)) Object.assign(ctx, { url: own.url, title: own.title ?? '' })
          else ctx.app = BRAND.name
        }
      }
    } else if (isTrusted && prev) {
      // 只有用户已经给了辅助功能权限才去拿选中的字和来源；没权限什么都不碰，不会弹系统授权框
      if (src) ctx.app = prev.name
      const sel = await copySelection().catch((e) => (console.error('速记：拿不到选中的字', e), ''))
      if (sel.trim()) ctx.selection = sel.slice(0, 20000)
      const page = src ? await browserPage(prev.bundle).catch(() => null) : null
      if (page) Object.assign(ctx, page)
    }
    win ??= make()
    await ready
    const cursor = screen.getCursorScreenPoint()
    const area = screen.getDisplayNearestPoint(cursor).workArea
    if (E2E) win.setPosition(-3000, 80)
    else win.setPosition(Math.round(area.x + (area.width - WIDTH) / 2), Math.round(area.y + area.height * 0.22))
    win.webContents.send('quick:context', ctx)
    if (E2E) win.showInactive()
    else {
      win.show()
      win.focus()
    }
  }

  async function save(text: string): Promise<string> {
    const v = o.vault()
    if (!v) throw new Error(t('还没有打开库，先打开 {app} 选一个文件夹', { app: BRAND.name }))
    if (typeof text !== 'string') throw new Error(t('速记参数不对'))
    const body = quickMarkdown(text, ctx)
    if (!body) throw new Error(t('速记是空的'))
    const path = await v.capture(body, new Date(), ctx.url)
    const first = (text.trim() || ctx.selection?.trim() || '').split('\n')[0]!.slice(0, 40)
    await git.commitPaths(v.root, [path], tv('速记：{text}', { text: first }))
    o.onSaved(path)
    hide(true)
    return path
  }

  ipcMain.handle('quick:save', (_e, text: unknown) => save(text as string))
  ipcMain.handle('quick:close', () => hide(true))
  ipcMain.handle('quick:resize', (_e, h: unknown) => {
    if (win && typeof h === 'number' && h > 40 && h < 900) win.setContentSize(WIDTH, Math.ceil(h))
  })
  ipcMain.handle('quick:allow', () => {
    // 用户点了「去允许」：这时才让系统弹授权框，并把软件加进「辅助功能」列表
    hide(false)
    systemPreferences.isTrustedAccessibilityClient(true)
  })
  ipcMain.handle('quick:nohint', () => {
    o.saveSettings({ quickHint: false })
    ctx.hint = false
    win?.webContents.send('quick:context', ctx)
  })

  // 全局键（设置 › 一般「速记快捷键」，默认 ⌥⌘N）。测试实例用 CN_QUICK_KEY 换成没人用的键：设置里换的键只记下（cnQuick.wanted），
  // 不在用户的 Mac 上真的注册
  let key: string | null = null
  let registered = false
  let wanted = ''
  function applyKey() {
    wanted = accelOf(o.prefs().quickKey)
    const accel = process.env.CN_QUICK_KEY || wanted
    if (accel === key) return
    if (key) globalShortcut.unregister(key)
    key = accel
    registered = globalShortcut.register(accel, () => void show().catch((e) => console.error('速记弹不出来', e)))
    if (!registered) console.warn(`全局快捷键 ${accel} 被别的软件占了，速记只能从菜单栏打开`)
  }

  // 菜单栏图标（设置 › 一般「菜单栏图标」，默认开）
  let tray: Tray | null = null
  const buildTrayMenu = () =>
    Menu.buildFromTemplate([
      ...(o.topItems?.() ?? []),
      { label: t('速记', { ctx: '菜单栏' }), accelerator: registered && key ? key : undefined, registerAccelerator: false, click: () => void show() },
      { label: t('打开 {app}', { app: BRAND.name, ctx: '菜单栏' }), click: () => o.openMain() },
      { label: t('现在梦游', { ctx: '菜单栏' }), click: () => o.dreamNow() },
      { type: 'separator' },
      { label: t('退出', { ctx: '菜单栏' }), role: 'quit' },
    ])
  const setMenu = () => {
    const menu = buildTrayMenu()
    tray?.setContextMenu(menu)
    // 端到端测试从这里弹出速记框、读菜单栏菜单（测试不按真的全局快捷键）
    if (E2E) Object.assign(globalThis, { cnQuick: { show, menu, registered, wanted, tray: !!tray } })
  }
  function applyTray() {
    const on = o.prefs().tray
    if (on && !tray) {
      const icon = nativeImage.createFromDataURL(TRAY_1X)
      icon.addRepresentation({ scaleFactor: 2, dataURL: TRAY_2X })
      icon.setTemplateImage(true)
      tray = new Tray(icon)
      tray.setToolTip(BRAND.name)
    } else if (!on && tray) {
      tray.destroy()
      tray = null
    }
  }
  /** 设置里改了速记的键、菜单栏图标：当场换 */
  function apply() {
    applyKey()
    applyTray()
    setMenu()
  }
  apply()
  ipcMain.handle('quick:state', () => ({ key: o.prefs().quickKey, registered }))

  return {
    /** 菜单栏图标的菜单重建（新版本下好了多一项） */
    refreshMenu: setMenu,
    apply,
    dispose() {
      if (key) globalShortcut.unregister(key)
      tray?.destroy()
      win?.destroy()
    },
  }
}
