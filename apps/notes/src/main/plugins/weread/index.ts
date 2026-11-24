/**
 * 微信读书主进程这半：右栏开着微信读书的阅读页时，网页预加载报来是哪本书；
 * 用户用微信读书自带的划线划了一段（我们拦到它「划线」的请求，或者网页里松开鼠标后过一会儿），
 * 就去微信读书网页版的接口（weread.qq.com，带着右栏网页里的登录，和 obsidian-weread-plugin 一样）取这本书的划线，和上次见过的比，新的那一段交给界面插进中间开着的文档；
 * 每本书的划线、想法、书评在后台同步进它的书摘「阅读/<书名>.md」（以前的「素材/微信读书/」里的照样认），只往里加不重写（CN-130），一本一次提交。
 * 只读微信读书，不往它那边写任何东西。界面那半在 renderer/plugins/weread/，网页里那半在 preload/plugins/weread.ts。
 * 以前问的是手机 App 的接口 i.weread.qq.com：网页里登录拿到的 cookie 它不认（回 -2012 登录超时），划线不插、设置里一直「没登录」（CN-37、CN-53）。
 * 登录：右栏 persist:web 里的 wr_vid、wr_skey；接口前先 HEAD 一次网站续 cookie（十分钟一次），说登录超时就再续一次重试。
 * 测试：CN_WEREAD_ORIGIN（假的微信读书网站，网页和接口都在它上面），CN_WEREAD_API 只换接口。
 */
import { prop } from '@cn/format'
import { commitPaths, describeChanges, status as gitStatus } from '@cn/git'
import { type Cookie, session, type WebContents } from 'electron'
import { mkdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import {
  apiError,
  type BookInfo,
  bookIdOfReader,
  bookFile,
  type BookMerge,
  type BookSync,
  isReader,
  loginOf,
  type Mark,
  marksToInsert,
  mergeBook,
  normalizeWeread,
  oldBookFile,
  parseBookmarks,
  parseNotebooks,
  parseReviews,
  setWereadOrigin,
  WEREAD,
  WEREAD_FOLDER,
  type WereadLogin,
  wereadOrigin,
  type WereadSettings,
  type WereadStatus,
} from '../../../shared/plugins/weread'
import { onTapped, tap } from '../../web/tap'
import type { Vault } from '../../vault'
import type { MainPlugin, PluginHost } from '../host'
import { atomicWriteSync } from '@cn/atomic'

const API = () => process.env.CN_WEREAD_API || wereadOrigin()
const md5 = (t: string) => createHash('md5').update(t).digest('hex')
const web = () => session.fromPartition('persist:web')

class NotLoggedIn extends Error {
  constructor() {
    super('没登录微信读书：在右栏打开微信读书扫码登录')
  }
}

/** 右栏网页里微信读书的 cookie */
const wereadCookies = () => web().cookies.get({ url: wereadOrigin() })

/** HEAD 一次网站：微信读书在回答里换新的 wr_skey，存进右栏的分区（隔几天不用重新扫码） */
let refreshedAt = 0
async function refreshCookie(force = false): Promise<void> {
  if (!force && Date.now() - refreshedAt < 10 * 60_000) return
  refreshedAt = Date.now()
  try {
    await web().fetch(wereadOrigin() + '/', { method: 'HEAD', credentials: 'include', signal: AbortSignal.timeout(10_000) })
  } catch (e) {
    console.warn('[weread] 续登录没成', (e as Error).message)
  }
}

/** 问微信读书网页版的接口：带着右栏网页的登录（同一个分区的 cookie），15 秒没回就算了；说登录超时就续一次 cookie 再问一次 */
async function api(path: string, params: Record<string, string>, retried = false): Promise<unknown> {
  if (!loginOf(await wereadCookies())) throw new NotLoggedIn()
  await refreshCookie()
  const u = new URL(API() + path)
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  const res = await web().fetch(u.toString(), { credentials: 'include', signal: AbortSignal.timeout(15_000) })
  const j = (await res.json().catch(() => null)) as unknown
  const err = apiError(j)
  if (res.status === 401 || err?.login) {
    if (retried) throw new NotLoggedIn()
    await refreshCookie(true)
    return api(path, params, true)
  }
  if (!res.ok) throw new Error(`微信读书回了 ${res.status}`)
  if (err) throw new Error(err.message)
  return j
}

interface Saved {
  /** 每本书见过的划线编号 */
  seen: Record<string, string[]>
  /** 每本书上次同步的时候它在笔记本里的更新时间 */
  synced: Record<string, number>
  /** 每本书写进过书摘的划线、想法编号：书摘里没有了就是用户删的，不再加回来（CN-130） */
  written: Record<string, string[]>
  /** 每本书的书摘写在哪（用户挪了、改了名，下次先看这里） */
  files: Record<string, string>
  lastSync: number
  books: number
  marks: number
  state: WereadStatus['state']
  error?: string
}

/** 网页报来的：这个网页在读哪本书 */
interface PageBook extends BookInfo {
  url: string
  chapter: string
}

/** 编辑器合并完回的话（和 mergeBook 的结果一样） */
type EditorMerge = BookMerge

export const wereadPlugin: MainPlugin<WereadSettings> = {
  manifest: WEREAD,
  normalizeSettings: normalizeWeread,
  setup(host: PluginHost<WereadSettings>) {
    setWereadOrigin(process.env.CN_WEREAD_ORIGIN || null)
    WEREAD.entry = { ...WEREAD.entry!, url: wereadOrigin() + '/web/shelf' }
    const file = join(host.dir, 'state.json')
    let saved: Saved = { seen: {}, synced: {}, written: {}, files: {}, lastSync: 0, books: 0, marks: 0, state: 'never' }
    try {
      saved = { ...saved, ...(JSON.parse(readFileSync(file, 'utf8')) as Partial<Saved>) }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('[weread] 本机记录读不出来，重新记', (e as Error).message)
    }
    const save = () => {
      mkdirSync(host.dir, { recursive: true })
      atomicWriteSync(file, JSON.stringify(saved))
    }
    let syncing = false
    /** 登录：看右栏的 cookie；昵称和头像问一次 /web/user，记住 */
    let login: WereadLogin = { state: 'out' }
    let who: { vid: string; name?: string; avatar?: string } | null = null
    const status = (): WereadStatus => ({ state: saved.state, login, lastSync: saved.lastSync, books: saved.books, marks: saved.marks, syncing, ...(saved.error ? { error: saved.error } : {}) })
    const withWho = (state: WereadLogin['state']): WereadLogin => ({ state, ...(who?.name ? { name: who.name } : {}), ...(who?.avatar ? { avatar: who.avatar } : {}) })
    async function readLogin(): Promise<WereadLogin> {
      const me = loginOf(await wereadCookies())
      if (!me) {
        who = null
        return (login = { state: 'out' })
      }
      // 刚登录（cookie 变了）：上次「没登录」那句不再算数
      if (login.state !== 'in' && saved.state === 'login') {
        saved.state = saved.lastSync ? 'ok' : 'never'
        delete saved.error
        save()
      }
      if (who?.vid !== me.vid) {
        who = { vid: me.vid }
        void api('/web/user', { userVid: me.vid }).then(
          (u) => {
            const j = (u ?? {}) as { name?: unknown; avatar?: unknown }
            if (who?.vid !== me.vid) return
            who = { vid: me.vid, ...(typeof j.name === 'string' && j.name ? { name: j.name.slice(0, 40) } : {}), ...(typeof j.avatar === 'string' && /^https:\/\//.test(j.avatar) ? { avatar: j.avatar } : {}) }
            if (login.state === 'in') login = withWho('in')
            host.emit('status', status())
          },
          () => undefined,
        )
      }
      return (login = withWho(saved.state === 'login' ? 'expired' : 'in'))
    }
    const failed = (e: unknown) => {
      saved.state = e instanceof NotLoggedIn ? 'login' : 'error'
      saved.error = (e as Error).message
      if (e instanceof NotLoggedIn && login.state === 'in') login = { ...login, state: 'expired' }
      save()
      host.emit('status', status())
    }
    // 右栏网页里登录、退出（wr_ 开头的 cookie 变了）：马上重查，设置页不用点「现在同步」就变
    let cookieTimer: ReturnType<typeof setTimeout> | undefined
    const siteHost = new URL(wereadOrigin()).hostname
    web().cookies.on('changed', (_e, c: Cookie) => {
      if (!c.name.startsWith('wr_') || !siteHost.endsWith((c.domain ?? '').replace(/^\./, ''))) return
      clearTimeout(cookieTimer)
      cookieTimer = setTimeout(() => void readLogin().then(() => host.emit('status', status())), 300)
    })
    // 打开软件时：登录过的话续一次 cookie（没登录过不联网）
    void readLogin().then((l) => {
      if (l.state !== 'out') void refreshCookie()
    })

    const pages = new Map<number, PageBook>()
    const vault = () => {
      try {
        return host.vault()
      } catch {
        return null
      }
    }

    // ------------------------------------------------------------ 一本书：取划线和想法、合并进书摘

    async function fetchBook(bookId: string) {
      const list = parseBookmarks(await api('/web/book/bookmarklist', { bookId }), bookId)
      return list
    }

    /**
     * 这本书的书摘在哪：上次写的那篇、「阅读/<书名>.md」、以前的「素材/微信读书/<书名>.md」，开头的书的编号对得上才算；
     * 都不是（用户挪走了、改了名）就在库里按书的编号找。text 是现在的字，还没有书摘是 null（path 是要新建的位置）
     */
    async function findBook(v: Vault, book: BookInfo): Promise<{ path: string; text: string | null }> {
      const idOf = (t: string) => prop(t, 'bookId')?.trim()
      const read = (p: string) => v.read(p).then((n) => n.text, () => null)
      const tried = new Set<string>()
      for (const p of [saved.files[book.bookId], bookFile(book.title), oldBookFile(book.title)]) {
        if (!p || tried.has(p)) continue
        tried.add(p)
        const t = await read(p)
        if (t !== null && idOf(t) === book.bookId) return { path: p, text: t }
      }
      for (const hit of await v.search(book.bookId, 20)) {
        if (tried.has(hit.path)) continue
        const t = await read(hit.path)
        if (t !== null && idOf(t) === book.bookId) return { path: hit.path, text: t }
      }
      return { path: bookFile(book.title), text: null }
    }

    /** 等界面回话的合并：编号 → 收到回话 */
    const asking = new Map<number, (r: EditorMerge | null) => void>()
    let askSeq = 0
    /**
     * 书摘开着（哪个标签都算）：交给那个编辑器合并、存盘（和剪进文档同一条路，正在打的字不丢、不出冲突副本）。
     * 没开着、5 秒没回话（窗口关着）是 null，在这里写文件
     */
    function askEditor(path: string, input: BookSync): Promise<EditorMerge | null> {
      const id = ++askSeq
      return new Promise((resolve) => {
        const timer = setTimeout(() => (asking.delete(id), resolve(null)), 5000)
        asking.set(id, (r) => {
          clearTimeout(timer)
          asking.delete(id)
          resolve(r)
        })
        host.emit('merge', { id, path, input })
      })
    }
    host.handle('merged', (_ctx, arg) => {
      const a = (arg ?? {}) as { id?: unknown; handled?: unknown; text?: unknown; written?: unknown; added?: unknown }
      const done = asking.get(Number(a.id))
      if (!done) return
      if (a.handled !== true || typeof a.text !== 'string' || !Array.isArray(a.written) || !Array.isArray(a.added)) return done(null)
      done({ text: a.text, written: a.written.filter((x): x is string => typeof x === 'string'), added: a.added as Mark[] })
    })

    let writing: Promise<unknown> = Promise.resolve()
    /**
     * 同步一本书进它的书摘（CN-130）：只往里加新划线、新想法（mergeBook），用户写的不动；内容没变不写不提交。
     * 开着的书摘交给编辑器合并；用户在这篇里还没提交的字先单独提交，同步的提交里只有同步加的。
     * 有新加的划线就告诉界面（提示「已同步到《书名》· 章节」）
     */
    function writeBook(book: BookInfo, marks: Mark[], url: string, why: string): Promise<boolean> {
      const run = async () => {
        const v = vault()
        if (!v || !host.settings().sync) return false
        const thoughts = parseReviews(await api('/web/review/list', { bookId: book.bookId, listType: '11', mine: '1', synckey: '0' }).catch((e) => (e instanceof NotLoggedIn ? Promise.reject(e) : { reviews: [] })))
        const found = await findBook(v, book)
        let path = found.path
        const input: BookSync = { book, marks, thoughts, url, written: saved.written[book.bookId] ?? [], now: Date.now() }
        if (found.text !== null) {
          const pending = (await gitStatus(v.root)).filter((s) => s.path === path)
          if (pending.length) await commitPaths(v.root, [path], describeChanges(pending))
        }
        const viaEditor = found.text === null ? null : await askEditor(path, input)
        let r: EditorMerge
        let changed: boolean
        if (viaEditor) {
          r = viaEditor
          changed = r.text !== found.text
        } else {
          r = mergeBook(found.text, input)
          changed = r.text !== found.text
          // 新书：「阅读」里新建（同名的已经有了、又不是这本书的书摘，加「 2」）
          if (found.text === null) path = await v.create(WEREAD_FOLDER, path.slice(WEREAD_FOLDER.length + 1, -3), r.text)
          else if (changed) {
            const w = await v.write(path, r.text, found.text)
            // 读和写之间文件又变了：照新的再合一次
            if (!w.ok) {
              r = mergeBook(w.diskText, input)
              changed = r.text !== w.diskText
              if (changed && !(await v.write(path, r.text, w.diskText)).ok) throw new Error(`《${book.title}》的书摘正被改着，这次没同步上，下次再同步`)
            }
          }
        }
        saved.written[book.bookId] = r.written
        saved.files[book.bookId] = path
        save()
        if (!changed) return false
        await commitPaths(v.root, [path], `微信读书：同步《${book.title.slice(0, 40)}》${marks.length} 条划线`)
        host.filesChanged()
        saved.lastSync = Date.now()
        save()
        host.emit('status', status())
        if (r.added.length) host.emit('synced', { path, bookId: book.bookId, title: book.title, added: r.added.map((m) => ({ text: m.text, chapter: m.chapter })), why })
        return true
      }
      const p = writing.then(run, run)
      writing = p.catch(() => undefined)
      return p
    }

    /**
     * 这本书现在的划线：没见过的交给界面插进左边文档。打开书那一次（why = open）只记下来，不插；
     * 打开那次没取成时不记「见过的」，下一次划线时 2 分钟内新建的当成新的（marksToInsert）。
     * 划线触发的（不是打开书）没成：右下角说原因。
     */
    async function check(wcId: number, why: string) {
      const page = pages.get(wcId)
      if (!page) return
      try {
        const { marks, book } = await fetchBook(page.bookId)
        // 划线接口没带书名、网页报的又不可靠时，问一次书的信息
        const meta = book?.title || page.title ? null : ((await api('/web/book/info', { bookId: page.bookId }).catch(() => null)) as { title?: unknown; author?: unknown } | null)
        const info: BookInfo = {
          bookId: page.bookId,
          title: book?.title || page.title || (typeof meta?.title === 'string' ? meta.title.slice(0, 200) : '') || page.bookId,
          author: book?.author || page.author || (typeof meta?.author === 'string' ? meta.author.slice(0, 100) : ''),
        }
        const seenList = saved.seen[page.bookId]
        const fresh = marksToInsert(marks, seenList, why, Math.floor(Date.now() / 1000))
        saved.seen[page.bookId] = marks.map((m) => m.id)
        saved.state = 'ok'
        delete saved.error
        save()
        // 插不插进中间的文档由界面看（中间开的是不是普通文档、设置里开没开）；插不了的等同步完说「已同步到《书名》· 章节」
        if (fresh.length) host.emit('highlight', { book: info, url: page.url, marks: fresh, why, insert: host.settings().insert, sync: host.settings().sync })
        if (fresh.length || !seenList) void writeBook(info, marks, page.url, why).catch(failed)
      } catch (e) {
        failed(e)
        if (why !== 'open') host.emit('problem', { kind: e instanceof NotLoggedIn ? 'login' : 'error', message: (e as Error).message })
      }
    }

    /** 阅读页上读不到书的编号（微信读书改版了）：划线时说一声 */
    const unknown = new Set<number>()

    // 阅读页「划线」的请求：划完马上去取
    onTapped((t) => {
      if (!/\/web\/book\/addBookmark|\/web\/review\/add/.test(t.url)) return
      if (pages.has(t.wc.id)) void check(t.wc.id, 'tap')
      else if (unknown.has(t.wc.id)) host.emit('problem', { kind: 'book' })
    })

    // ------------------------------------------------------------ 网页里调的

    host.handle(
      'page',
      async ({ sender }, arg) => {
        const a = (arg ?? {}) as Partial<PageBook>
        const url = sender.getURL()
        // 书的编号先从阅读页的地址拆（真网站上 __INITIAL_STATE__ 里的编号会是别的书），拆不出再用网页报的
        const fromUrl = bookIdOfReader(url, md5)
        const reported = typeof a.bookId === 'string' && /^\w{1,40}$/.test(a.bookId) ? a.bookId : null
        const bookId = fromUrl ?? reported
        if (!isReader(url) || !bookId) {
          pages.delete(sender.id)
          // 阅读页却读不到书的编号：记下来，划线时好告诉用户
          if (isReader(url) && !unknown.has(sender.id)) {
            unknown.add(sender.id)
            sender.once('destroyed', () => unknown.delete(sender.id))
            void tap(sender as WebContents)
          }
          return
        }
        unknown.delete(sender.id)
        const was = pages.get(sender.id)
        // 网页报的书名、作者是它那本的：和地址上的不是同一本就不用
        const sameBook = bookId === reported
        pages.set(sender.id, {
          bookId,
          title: sameBook ? String(a.title ?? '').slice(0, 200) : '',
          author: sameBook ? String(a.author ?? '').slice(0, 100) : '',
          chapter: sameBook ? String(a.chapter ?? '').slice(0, 200) : '',
          url,
        })
        if (was?.bookId === bookId) return
        sender.once('destroyed', () => pages.delete(sender.id))
        void tap(sender as WebContents)
        await check(sender.id, 'open')
      },
      { page: true },
    )
    // 网页里松开鼠标（可能刚划完一段）：过一会儿去看有没有新的
    host.handle('check', ({ sender }) => check(sender.id, 'mouseup'), { page: true })

    // ------------------------------------------------------------ 界面调的

    host.handle('status', async () => (await readLogin(), status()))

    // 只给测试实例：把这本书「见过的」里最新的一条忘掉，下一次检查就当它是新划的、插进左边文档。
    // 真账号验证（e2e/real-weread.spec.ts）靠它走一遍插入，不用在用户的微信读书里新划线
    if (process.env.CN_E2E === '1')
      host.handle('forgetNewest', async (_ctx, arg) => {
        const bookId = String((arg as { bookId?: unknown } | undefined)?.bookId ?? '')
        const { marks } = await fetchBook(bookId)
        const newest = [...marks].sort((a, b) => b.created - a.created)[0]
        if (!newest || !saved.seen[bookId]) return null
        saved.seen[bookId] = saved.seen[bookId]!.filter((id) => id !== newest.id)
        return { text: newest.text }
      })

    /** 现在同步：有笔记的书里，上次同步以后动过的一本本写进素材 */
    host.handle('syncAll', async () => {
      if (syncing) return status()
      syncing = true
      host.emit('status', status())
      try {
        const books = parseNotebooks(await api('/api/user/notebook', {}))
        let marks = 0
        for (const b of books) {
          marks += b.marks
          if (saved.synced[b.bookId] === b.updated && saved.seen[b.bookId]) continue
          const list = await fetchBook(b.bookId)
          saved.seen[b.bookId] = list.marks.map((m) => m.id)
          await writeBook({ bookId: b.bookId, title: list.book?.title || b.title, author: list.book?.author || b.author }, list.marks, `${wereadOrigin()}/web/bookDetail/${b.bookId}`, 'sync')
          saved.synced[b.bookId] = b.updated
        }
        saved.books = books.length
        saved.marks = marks
        saved.lastSync = Date.now()
        saved.state = 'ok'
        delete saved.error
        save()
      } catch (e) {
        failed(e)
      } finally {
        syncing = false
        host.emit('status', status())
      }
      return status()
    })
  },
}
