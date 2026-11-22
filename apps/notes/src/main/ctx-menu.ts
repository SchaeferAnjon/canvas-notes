/**
 * 右键菜单的唯一出口（DESIGN.v3 第 9 节）。
 * - 所有系统菜单都从 popup() 弹：开着的记在 openMenus 里，退出时 closeAllMenus() 从里往外收起。
 *   菜单开着时主线程在 macOS 的菜单循环里，不收起来进程退不出去（wiki：Electron 退出卡在 NSMenu）。
 * - 界面交来要哪几项（shared/ctx-menu.ts 的 CtxItem），点了哪项回给界面；编辑项、拼写建议在这里直接对网页做。
 * - 界面没接管的右键（输入框、选了字）这里兜底给标准编辑菜单；右栏网页里的右键转给界面，由界面拼菜单。
 */
import { hungFolders, moveMany } from './folder-ops'
import { BrowserWindow, clipboard, ClipboardItem, ipcMain, Menu, type MenuItemConstructorOptions, nativeImage, shell, webContents as allWebContents, type WebContents } from 'electron'
import { EDIT_ACCEL, EDIT_LABEL, type CtxIcon, type CtxItem, type CtxParams, fallbackItems, tidy, validItems } from '../shared/ctx-menu'
import { pinNote, repin } from './pins'
import type { Vault } from './vault'

const openMenus = new Set<{ menu: Menu; win: BrowserWindow }>()

/** 弹一个系统菜单，收起时 resolve。所有右键菜单、「更多」菜单都走这里 */
export function popup(win: BrowserWindow, template: MenuItemConstructorOptions[]): Promise<void> {
  const menu = Menu.buildFromTemplate(template)
  const open = { menu, win }
  openMenus.add(open)
  return new Promise((resolve) =>
    menu.popup({
      window: win,
      callback: () => {
        openMenus.delete(open)
        resolve()
      },
    }),
  )
}

/** 退出时：开着的菜单全收起（可能好几个套着：从最里面、最后弹出的往外收）；返回收了几个 */
export function closeAllMenus(): number {
  const n = openMenus.size
  for (const m of [...openMenus].reverse()) if (!m.win.isDestroyed()) m.menu.closePopup(m.win)
  openMenus.clear()
  return n
}

/** 界面画好的 32 像素 PNG → 菜单里 16 点的图（2 倍图）；单色的做成模板图，深色菜单里系统画成白的 */
function iconOf(i: CtxIcon): Electron.NativeImage {
  const img = nativeImage.createFromBuffer(Buffer.from(i.png.slice(i.png.indexOf(',') + 1), 'base64'), { scaleFactor: 2 })
  if (i.template) img.setTemplateImage(true)
  return img
}

/** 界面交来的项 → Electron 的菜单模板；编辑项对 target 做，普通项点了记下 id */
export function toTemplate(items: CtxItem[], target: WebContents, pick: (id: string) => void): MenuItemConstructorOptions[] {
  return tidy(items).map((it): MenuItemConstructorOptions => {
    if ('type' in it) return { type: 'separator' }
    if ('edit' in it) {
      const cmd = it.edit
      return { label: EDIT_LABEL[cmd], accelerator: EDIT_ACCEL[cmd], registerAccelerator: false, enabled: it.enabled !== false, click: () => !target.isDestroyed() && target[cmd]() }
    }
    if ('spell' in it) return { label: it.spell, click: () => !target.isDestroyed() && target.replaceMisspelling(it.spell) }
    if ('copyImageAt' in it) return { label: '拷贝图片', click: () => !target.isDestroyed() && target.copyImageAt(it.copyImageAt.x, it.copyImageAt.y) }
    if (it.submenu) return { label: it.label, enabled: it.enabled !== false, submenu: toTemplate(it.submenu, target, pick) }
    return {
      label: it.label,
      enabled: it.enabled !== false,
      ...(it.checked !== undefined ? { type: 'checkbox' as const, checked: it.checked } : {}),
      ...(it.accel ? { accelerator: it.accel, registerAccelerator: false } : {}),
      ...(it.icon ? { icon: iconOf(it.icon) } : {}),
      click: () => pick(it.id),
    }
  })
}

/** Electron 的右键参数里取我们用的那几样（转给界面时只带这些） */
export function ctxParams(p: Electron.ContextMenuParams): CtxParams {
  return {
    x: p.x,
    y: p.y,
    linkURL: p.linkURL,
    linkText: p.linkText,
    srcURL: p.srcURL,
    mediaType: p.mediaType,
    hasImageContents: p.hasImageContents,
    selectionText: p.selectionText,
    isEditable: p.isEditable,
    misspelledWord: p.misspelledWord,
    dictionarySuggestions: p.dictionarySuggestions,
    editFlags: {
      canUndo: p.editFlags.canUndo,
      canRedo: p.editFlags.canRedo,
      canCut: p.editFlags.canCut,
      canCopy: p.editFlags.canCopy,
      canPaste: p.editFlags.canPaste,
      canSelectAll: p.editFlags.canSelectAll,
    },
  }
}

/** 软件自己的窗口（主窗口、速记小窗）：界面没接管的右键给标准编辑菜单 */
export function attachEditMenu(wc: WebContents) {
  wc.on('context-menu', (_e, p) => {
    const win = BrowserWindow.fromWebContents(wc)
    const items = fallbackItems(ctxParams(p))
    if (win && items.length) void popup(win, toTemplate(items, wc, () => undefined))
  })
}

/** 右栏网页（webview）里的右键：转给界面，界面按点着的东西拼菜单（链接、图、选的字、输入框） */
export function forwardWebContext(guest: WebContents, host: WebContents) {
  guest.on('context-menu', (_e, p) => {
    if (!host.isDestroyed()) host.send('ctx:web', guest.id, ctxParams(p))
  })
}

/** 编辑项要对哪个网页做：给了 id 必须是这个界面里的 webview，不然就是界面自己 */
function targetOf(sender: WebContents, id: unknown): WebContents {
  if (typeof id !== 'number') return sender
  const wc = allWebContents.fromId(id)
  return wc && !wc.isDestroyed() && wc.hostWebContents?.id === sender.id ? wc : sender
}

/**
 * 软件自己挪了一篇（或挪、改名的文件夹里的一篇）：开着它的编辑器马上跟到新路径（own，不说「在外面挪了」），不等这一步做完、标签重画。
 * 挪的同时改了它的字（数据库块里的路径、相对链接）时，紧接着到的新内容才认得出是它、合进编辑器；
 * 等界面拿到结果再换路径的话，新内容先到、对不上路径被丢掉，开着的表一直是旧路径、0 条（task-5yp97）
 */
export const followOpen = (wc: WebContents) => (from: string, to: string) => {
  if (/\.md$/i.test(from) && !wc.isDestroyed()) wc.send('note:renamed', from, to, true)
}

export function setupCtxMenu(needVault: () => Vault, onMoved: () => void) {
  ipcMain.handle('ctx:menu', (e, items: unknown, target: unknown) => {
    if (!validItems(items)) throw new Error('菜单参数不对')
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return null
    let picked: string | null = null
    return popup(win, toTemplate(items, targetOf(e.sender, target), (id) => (picked = id))).then(() => picked)
  })
  ipcMain.handle('ctx:copy', (_e, text: unknown) => {
    if (typeof text !== 'string') throw new Error('参数不对')
    return clipboard.writeText(text)
  })
  ipcMain.handle('ctx:copy-image', (_e, png: unknown) => {
    if (!(png instanceof Uint8Array) || png.length > 40_000_000) throw new Error('参数不对')
    if (nativeImage.createFromBuffer(Buffer.from(png)).isEmpty()) throw new Error('这块图拷不了')
    return clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })])
  })
  ipcMain.handle('ctx:clipboard-has', async () => {
    const types = (await clipboard.read()).flatMap((i) => i.types)
    return { text: (await clipboard.readText()).trim() !== '', image: types.some((t) => t.startsWith('image/')) }
  })
  ipcMain.handle('ctx:clipboard-text', () => clipboard.readText())
  ipcMain.handle('ctx:reveal', (_e, path: unknown) => {
    if (typeof path !== 'string') throw new Error('参数不对')
    // abs() 拦住 .. 和绝对路径
    const v = needVault()
    shell.showItemInFolder(path === '' ? v.root : v.abs(path))
  })
  ipcMain.handle('ctx:open-external', (_e, url: unknown) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) throw new Error('只打开 http(s) 网址')
    return shell.openExternal(url)
  })
  ipcMain.handle('ctx:pin', async (_e, path: unknown, on: unknown) => {
    if (typeof path !== 'string' || typeof on !== 'boolean') throw new Error('参数不对')
    const v = needVault()
    v.abs(path)
    await pinNote(v, path, on)
  })
  // 文件树里选了好几个一起挪（CN-105）：一次提交，链接跟着改
  ipcMain.handle('ctx:move-many', async (e, paths: unknown, folder: unknown) => {
    try {
      return await moveMany(needVault(), paths, folder, followOpen(e.sender))
    } finally {
      onMoved()
    }
  })
  // 挪一篇（拖、右键「移到」、标题旁的文件夹）。它下面挂着数据库的记录文件夹时（task-5yp97）：一起挪、链接和数据库块里的路径改好，一次提交；
  // with 是跟着挪的那几个
  ipcMain.handle('ctx:move', async (e, path: unknown, folder: unknown) => {
    if (typeof path !== 'string' || typeof folder !== 'string' || !/\.md$/i.test(path)) throw new Error('参数不对')
    const v = needVault()
    if (folder !== '') v.abs(folder)
    try {
      if ((await hungFolders(v, path)).length) {
        const r = await moveMany(v, [path], folder, followOpen(e.sender))
        return { to: r.moves.find((m) => m.from === path)?.to ?? path, with: r.moves.filter((m) => m.with).map((m) => ({ from: m.from, to: m.to })) }
      }
      const to = await v.move(path, folder)
      followOpen(e.sender)(path, to)
      await repin(v, path, to)
      return { to, with: [] }
    } finally {
      onMoved()
    }
  })
}
