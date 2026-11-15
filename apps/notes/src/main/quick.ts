/**
 * 全局速记和菜单栏入口：任何软件里按 ⌥⌘N 弹一个小输入框，回车进收件箱并提交。
 * 有辅助功能权限时，弹出前先模拟一次 ⌘C 拿前台软件里选中的字，浏览器再用 AppleScript 取网址；
 * 没权限就只弹空框，给一个「允许后能带上选中的字」的按钮。权限只在用户点按钮时才去申请。
 */
import { app, BrowserWindow, clipboard, ClipboardItem, globalShortcut, ipcMain, Menu, nativeImage, screen, systemPreferences, Tray } from 'electron'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import * as git from '@cn/git'
import type { SkinId } from '../shared/appearance'
import { BRAND } from '../shared/brand'
import { quickMarkdown, type QuickContext } from '../shared/quick'
import { E2E } from './test-mode'
import { TRAY_1X, TRAY_2X } from './tray-icon'
import type { Vault } from './vault'

export const QUICK_KEY = process.env.CN_QUICK_KEY || 'Alt+Command+N'
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

/** 模拟一次 ⌘C（CGEvent，只要辅助功能权限，不用控制「系统事件」的自动化权限） */
const COPY_JXA = `ObjC.import('CoreGraphics');
const src = $.CGEventSourceCreate($.kCGEventSourceStateHIDSystemState);
for (const down of [true, false]) {
  const e = $.CGEventCreateKeyboardEvent(src, 8, down);
  $.CGEventSetFlags(e, $.kCGEventFlagMaskCommand);
  $.CGEventPost($.kCGHIDEventTap, e);
}`

/** 拿前台软件里选中的字：先存好剪贴板，放一个记号，按 ⌘C，等剪贴板变了再读，最后把剪贴板还原 */
async function copySelection(): Promise<string> {
  // 剪贴板里原来的东西（每种格式都先读成 Blob），最后原样放回去
  const saved = await Promise.all(
    (await clipboard.read()).map(async (item) => {
      const parts: Record<string, Blob> = {}
      for (const type of item.types) {
        const v = await item.getType(type)
        if (v instanceof Blob) parts[type] = v
      }
      return new ClipboardItem(parts)
    }),
  )
  const mark = `cn-quick-${Date.now()}`
  await clipboard.writeText(mark)
  try {
    await run('osascript', ['-l', 'JavaScript', '-e', COPY_JXA])
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 40))
      const t = await clipboard.readText()
      if (t !== mark) return t
    }
    return ''
  } finally {
    clipboard.clear()
    if (saved.length) await clipboard.write(saved)
  }
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
  skin(): SkinId
  /** 菜单栏图标的菜单最上面多的几项（新版本下好了时「重启并更新到 x」） */
  topItems?(): Electron.MenuItemConstructorOptions[]
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
      title: '速记',
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

  /** 弹出速记框 */
  async function show() {
    if (win?.isVisible()) {
      if (!E2E) win.focus()
      return
    }
    prev = null
    const isTrusted = trusted()
    ctx = { trusted: isTrusted, hint: !isTrusted && o.settings().quickHint !== false, skin: o.skin() }
    if (!E2E) {
      prev = await frontApp().catch(() => null)
      if (prev?.bundle === BRAND.appId || prev?.name === app.getName()) prev = null
    }
    // 只有用户已经给了辅助功能权限才去拿选中的字和来源；没权限什么都不碰，不会弹系统授权框
    if (isTrusted && prev) {
      ctx.app = prev.name
      const sel = await copySelection().catch(() => '')
      if (sel.trim()) ctx.selection = sel.slice(0, 20000)
      const page = await browserPage(prev.bundle).catch(() => null)
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
    if (!v) throw new Error(`还没有打开库，先打开 ${BRAND.name} 选一个文件夹`)
    if (typeof text !== 'string') throw new Error('速记参数不对')
    const body = quickMarkdown(text, ctx)
    if (!body) throw new Error('速记是空的')
    const path = await v.capture(body, new Date(), ctx.url)
    const first = (text.trim() || ctx.selection?.trim() || '').split('\n')[0]!.slice(0, 40)
    await git.commitPaths(v.root, [path], `速记：${first}`)
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

  const registered = globalShortcut.register(QUICK_KEY, () => void show().catch((e) => console.error('速记弹不出来', e)))
  if (!registered) console.warn(`全局快捷键 ${QUICK_KEY} 被别的软件占了，速记只能从菜单栏打开`)

  const icon = nativeImage.createFromDataURL(TRAY_1X)
  icon.addRepresentation({ scaleFactor: 2, dataURL: TRAY_2X })
  icon.setTemplateImage(true)
  const tray = new Tray(icon)
  tray.setToolTip(BRAND.name)
  const buildTrayMenu = () =>
    Menu.buildFromTemplate([
    ...(o.topItems?.() ?? []),
    { label: '速记', accelerator: registered ? QUICK_KEY : undefined, registerAccelerator: false, click: () => void show() },
    { label: `打开 ${BRAND.name}`, click: () => o.openMain() },
    { label: '现在梦游', click: () => o.dreamNow() },
    { type: 'separator' },
    { label: '退出', role: 'quit' },
  ])
  const setMenu = () => {
    const menu = buildTrayMenu()
    tray.setContextMenu(menu)
    // 端到端测试从这里弹出速记框、读菜单栏菜单（测试不按真的全局快捷键）
    if (E2E) Object.assign(globalThis, { cnQuick: { show, menu, registered } })
  }
  setMenu()

  return {
    /** 菜单栏图标的菜单重建（新版本下好了多一项） */
    refreshMenu: setMenu,
    dispose() {
      globalShortcut.unregister(QUICK_KEY)
      tray.destroy()
      win?.destroy()
    },
  }
}
