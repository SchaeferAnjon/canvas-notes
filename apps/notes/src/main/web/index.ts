/**
 * 内置浏览器在主进程这边的一切：多标签的新窗口和按键、书签、历史、Chrome 插件、整页剪藏、图片附件。
 * main/index.ts 只调这里的 setupWeb 和 attachWebview。
 */
import { app, type BrowserWindow, ipcMain, session, webContents as allWebContents, type WebContents } from 'electron'
import { join } from 'node:path'
import * as git from '@cn/git'
import type { ImageSource } from '../../shared/web-api'
import { INBOX } from '../../shared/layout'
import { listProfiles } from '../chrome-import'
import { localStamp, type Vault } from '../vault'
import { logActivity } from '../activity'
import { setActiveWeb } from '../agent/web'
import { saveImage } from './save-image'
import { readChromeBookmarks, readChromeHistory } from './chrome-data'
import { Extensions } from './extensions'
import { Bookmarks, History } from './library'
import { clipFileName, extractPage, listenForExtracts, pageClipText } from './page-clip'

interface Deps {
  partition: string
  window(): BrowserWindow | null
  vault(): Vault | null
}

let deps: Deps
let bookmarks: Bookmarks
let history: History
let extensions: Extensions | null = null
/** 界面告诉我们的当前网页 */
let activeId: number | null = null
/** 等界面开好新标签：请求号 → 拿到 webContents 后 resolve */
let reqSeq = 0
const pendingTabs = new Map<number, (wc: WebContents) => void>()
/** 我们自己在告诉插件库换标签（它会回调 selectTab）：这时的回调不是插件要切，不转给界面 */
let quiet = false
function quietly(f: () => void) {
  quiet = true
  try {
    f()
  } finally {
    quiet = false
  }
}
/** 整页剪藏的提交号，撤回用 */
const clipCommits = new Map<string, string>()

const send = (channel: string, ...args: unknown[]) => deps.window()?.webContents.send(channel, ...args)

/** 网页 webContents：必须是我们窗口里的 webview */
function ourWebview(id: number): WebContents | null {
  const wc = allWebContents.fromId(id)
  const win = deps.window()
  if (!wc || wc.isDestroyed() || !win || wc.hostWebContents?.id !== win.webContents.id) return null
  return wc
}

/** 让界面开一个网页标签；reqId 让界面开好后告诉我们是哪个 webContents */
function openTab(url: string, background: boolean): Promise<WebContents> {
  const reqId = ++reqSeq
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingTabs.delete(reqId)
      reject(new Error('新标签没开成'))
    }, 15_000)
    pendingTabs.set(reqId, (wc) => {
      clearTimeout(timer)
      resolve(wc)
    })
    send('web:open-tab', { url, reqId, background })
  })
}

function needVault(): Vault {
  const v = deps.vault()
  if (!v) throw new Error('还没有打开库')
  return v
}

async function profileName(id: string): Promise<string> {
  return (await listProfiles()).find((p) => p.id === id)?.name ?? id
}

export async function setupWeb(d: Deps): Promise<void> {
  deps = d
  const dir = join(app.getPath('userData'), 'web')
  bookmarks = new Bookmarks(join(dir, 'bookmarks.json'), () => send('web:bookmarks-changed'))
  history = new History(join(dir, 'history.json'))
  app.on('before-quit', () => history.flush())
  listenForExtracts()

  const ses = session.fromPartition(d.partition)
  extensions = new Extensions(join(dir, 'extensions'), ses, {
    openTab,
    selectTab: (wc) => !quiet && send('web:tab-command', { type: 'select', webContentsId: wc.id }),
    closeTab: (wc) => send('web:tab-command', { type: 'close', webContentsId: wc.id }),
    window: d.window,
  })
  ipcMain.handle('web:bookmarks', () => bookmarks.all())
  ipcMain.handle('web:bookmark-add', (_e, b: { title: unknown; url: unknown; folder?: unknown }) => {
    if (typeof b?.url !== 'string' || typeof b.title !== 'string') throw new Error('书签参数不对')
    return bookmarks.add({ title: b.title, url: b.url, ...(typeof b.folder === 'string' ? { folder: b.folder } : {}) })
  })
  ipcMain.handle('web:bookmark-remove', (_e, id: unknown) => {
    if (typeof id !== 'string') throw new Error('书签参数不对')
    return bookmarks.remove(id)
  })
  ipcMain.handle('web:bookmarks-import', async (_e, profileId: unknown) => {
    if (typeof profileId !== 'string') throw new Error('参数不对')
    const items = await readChromeBookmarks(profileId)
    const added = bookmarks.merge(items)
    return { added, total: items.length }
  })
  ipcMain.handle('web:history', (_e, q: unknown, limit: unknown) => history.search(typeof q === 'string' ? q : '', Number(limit) || 50))
  ipcMain.handle('web:history-import', async (_e, profileId: unknown) => {
    if (typeof profileId !== 'string') throw new Error('参数不对')
    return { added: history.merge(await readChromeHistory(profileId)) }
  })
  ipcMain.handle('web:chrome-profiles', () => listProfiles())

  ipcMain.handle('web:extensions', () => extensions!.list())
  ipcMain.handle('web:extensions-import', async (_e, profileId: unknown) => {
    if (typeof profileId !== 'string') throw new Error('参数不对')
    return extensions!.importFrom(profileId, await profileName(profileId))
  })
  ipcMain.handle('web:extension-enable', (_e, id: unknown, on: unknown) => {
    if (typeof id !== 'string' || typeof on !== 'boolean') throw new Error('参数不对')
    return extensions!.setEnabled(id, on)
  })
  ipcMain.handle('web:extension-remove', (_e, id: unknown) => {
    if (typeof id !== 'string') throw new Error('参数不对')
    return extensions!.remove(id)
  })

  ipcMain.handle('web:active', (_e, id: unknown) => {
    if (id === null) return void (activeId = null)
    if (typeof id !== 'number') throw new Error('参数不对')
    const wc = ourWebview(id)
    if (!wc) return
    activeId = id
    setActiveWeb(wc)
    quietly(() => extensions?.selectTab(wc))
  })
  ipcMain.on('web:tab-created', (_e, reqId: unknown, id: unknown) => {
    if (typeof reqId !== 'number' || typeof id !== 'number') return
    const wc = ourWebview(id)
    const done = pendingTabs.get(reqId)
    if (!wc || !done) return
    pendingTabs.delete(reqId)
    done(wc)
  })

  ipcMain.handle('web:save-image', async (_e, src: ImageSource, nameHint: unknown) => {
    if (!src || (src.kind !== 'url' && src.kind !== 'bytes')) throw new Error('图片参数不对')
    if (src.kind === 'url' && typeof src.url !== 'string') throw new Error('图片参数不对')
    return { path: await saveImage(needVault().root, ses, src, typeof nameHint === 'string' ? nameHint : undefined) }
  })

  ipcMain.handle('web:clip-page', (_e, webUrl: unknown) => clipCurrentPage(typeof webUrl === 'string' ? webUrl : null))
  ipcMain.handle('web:undo-clip', async (_e, path: unknown) => {
    const hash = typeof path === 'string' ? clipCommits.get(path) : undefined
    if (!hash) throw new Error('找不到这次剪藏的提交，撤回不了')
    await git.revert(needVault().root, hash)
    clipCommits.delete(path as string)
    send('files:changed')
  })

  await extensions.loadAll()
}

/** 书签和历史（书签管家插件用的是同一份） */
export function webLibrary(): { bookmarks: Bookmarks; history: History } {
  return { bookmarks, history }
}

/** 网页 webContents 是不是我们窗口里的 webview（插件只认它们发来的话） */
export function isOurWebview(wc: WebContents): boolean {
  return ourWebview(wc.id) !== null
}

/** 我们窗口里所有开着的网页 */
export function ourWebviews(): WebContents[] {
  const host = deps.window()?.webContents.id
  return allWebContents.getAllWebContents().filter((wc) => !wc.isDestroyed() && wc.hostWebContents?.id === host)
}

/** 要剪的网页：当前网页；给了网址而当前网页不是它时，找开着这个网址的标签 */
function pageToClip(webUrl: string | null): WebContents | null {
  const cur = activeId === null ? null : ourWebview(activeId)
  if (!webUrl || cur?.getURL() === webUrl) return cur
  const host = deps.window()?.webContents.id
  return allWebContents.getAllWebContents().find((wc) => !wc.isDestroyed() && wc.hostWebContents?.id === host && wc.getURL() === webUrl) ?? cur
}

/** 整页剪藏：收件箱新建一篇，单独一次提交（可撤回）；返回新文件的库内路径 */
async function clipCurrentPage(webUrl: string | null): Promise<string> {
  const v = needVault()
  const wc = pageToClip(webUrl)
  if (!wc) throw new Error('右栏没有开着的网页')
  if (!/^https?:/.test(wc.getURL())) throw new Error('只剪 http(s) 网页')
  const page = await extractPage(wc)
  if (!page.markdown.trim()) throw new Error('这个网页里没抽到正文')
  const path = await v.create(INBOX, clipFileName(page.title, page.url), pageClipText(page, localStamp(new Date())))
  const hash = await git.commitPaths(v.root, [path], `剪藏整页：${page.title.slice(0, 60) || page.url}`)
  if (hash) clipCommits.set(path, hash)
  await logActivity(v.root, { t: Date.now(), kind: 'clip', path })
  send('files:changed')
  return path
}

/** will-attach-webview 之后：新窗口开成新标签、记历史、插件把它当成标签、网页焦点时的快捷键转给界面 */
export function attachWebview(wc: WebContents, win: BrowserWindow) {
  wc.setWindowOpenHandler(({ url, disposition }) => {
    if (/^https?:/.test(url)) send('web:open-tab', { url, background: disposition === 'background-tab' })
    return { action: 'deny' }
  })
  wc.on('did-navigate', (_e, url) => history.visit(url, wc.getTitle()))
  wc.on('page-title-updated', (_e, title) => history.title(wc.getURL(), title))
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown' || !input.meta || input.alt || input.control) return
    const k = input.key.toLowerCase()
    if (k === 't' || k === 'w' || k === 'l') {
      e.preventDefault()
      send('web:key', k, wc.id)
    }
  })
  wc.once('destroyed', () => {
    if (activeId === wc.id) activeId = null
  })
  // 插件库会把新挂上的网页当成当前标签；插件眼里的当前标签要还是用户正在看的那个
  quietly(() => {
    extensions?.addTab(wc, win)
    const cur = activeId === null ? null : ourWebview(activeId)
    if (cur) extensions?.selectTab(cur)
  })
}
