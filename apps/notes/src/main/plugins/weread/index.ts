/**
 * 微信读书主进程这半：右栏开着微信读书的阅读页时，网页预加载报来是哪本书；
 * 用户用微信读书自带的划线划了一段（我们拦到它「划线」的请求，或者网页里松开鼠标后过一会儿），
 * 就去微信读书的接口（i.weread.qq.com，带着右栏的登录）取这本书的划线，和上次见过的比，新的那一段交给界面插进左边的文档；
 * 每本书的划线、想法、书评在后台同步成「素材/微信读书/<书名>.md」，一本一次提交。
 * 只读微信读书，不往它那边写任何东西。界面那半在 renderer/plugins/weread/，网页里那半在 preload/plugins/weread.ts。
 * 测试：CN_WEREAD_ORIGIN（假的阅读页网站）、CN_WEREAD_API（假的接口）。
 */
import { commitPathsRetry } from '../../git-retry'
import { session, type WebContents } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type BookInfo,
  bookFile,
  bookMd,
  isReader,
  type Mark,
  newMarks,
  normalizeWeread,
  parseBookmarks,
  parseNotebooks,
  parseReviews,
  setWereadOrigin,
  WEREAD,
  WEREAD_FOLDER,
  type WereadSettings,
  type WereadStatus,
} from '../../../shared/plugins/weread'
import { onTapped, tap } from '../../web/tap'
import type { MainPlugin, PluginHost } from '../host'

const API = () => process.env.CN_WEREAD_API || 'https://i.weread.qq.com'

class NotLoggedIn extends Error {
  constructor() {
    super('没登录微信读书：在右栏打开 weread.qq.com 登录，或者「⋯ › 导入 Chrome 登录」')
  }
}

/** 问微信读书的接口：带着右栏网页的登录（同一个分区的 cookie），15 秒没回就算了 */
async function api(path: string, params: Record<string, string>): Promise<unknown> {
  const u = new URL(API() + path)
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  const res = await session.fromPartition('persist:web').fetch(u.toString(), { credentials: 'include', signal: AbortSignal.timeout(15_000) })
  if (res.status === 401) throw new NotLoggedIn()
  if (!res.ok) throw new Error(`微信读书回了 ${res.status}`)
  const j = (await res.json()) as { errcode?: number; errmsg?: string }
  if (j.errcode === -2010 || j.errcode === -2012) throw new NotLoggedIn()
  if (j.errcode && j.errcode !== 0) throw new Error(j.errmsg || `微信读书出错（${j.errcode}）`)
  return j
}

interface Saved {
  /** 每本书见过的划线编号 */
  seen: Record<string, string[]>
  /** 每本书上次同步的时候它在笔记本里的更新时间 */
  synced: Record<string, number>
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

export const wereadPlugin: MainPlugin<WereadSettings> = {
  manifest: WEREAD,
  normalizeSettings: normalizeWeread,
  setup(host: PluginHost<WereadSettings>) {
    setWereadOrigin(process.env.CN_WEREAD_ORIGIN || null)
    const file = join(host.dir, 'state.json')
    let saved: Saved = { seen: {}, synced: {}, lastSync: 0, books: 0, marks: 0, state: 'never' }
    try {
      saved = { ...saved, ...(JSON.parse(readFileSync(file, 'utf8')) as Partial<Saved>) }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('[weread] 本机记录读不出来，重新记', (e as Error).message)
    }
    const save = () => {
      mkdirSync(host.dir, { recursive: true })
      writeFileSync(file + '.tmp', JSON.stringify(saved))
      renameSync(file + '.tmp', file)
    }
    let syncing = false
    const status = (): WereadStatus => ({ state: saved.state, lastSync: saved.lastSync, books: saved.books, marks: saved.marks, syncing, ...(saved.error ? { error: saved.error } : {}) })
    const failed = (e: unknown) => {
      saved.state = e instanceof NotLoggedIn ? 'login' : 'error'
      saved.error = (e as Error).message
      save()
      host.emit('status', status())
    }

    const pages = new Map<number, PageBook>()
    const vault = () => {
      try {
        return host.vault()
      } catch {
        return null
      }
    }

    // ------------------------------------------------------------ 一本书：取划线和想法、写进素材

    async function fetchBook(bookId: string) {
      const list = parseBookmarks(await api('/book/bookmarklist', { bookId }), bookId)
      return list
    }

    let writing: Promise<unknown> = Promise.resolve()
    /** 写「素材/微信读书/<书名>.md」：内容没变不写不提交 */
    function writeBook(book: BookInfo, marks: Mark[], url: string): Promise<boolean> {
      const run = async () => {
        const v = vault()
        if (!v || !host.settings().sync) return false
        const thoughts = parseReviews(await api('/review/list', { bookId: book.bookId, listType: '11', mine: '1', synckey: '0' }).catch((e) => (e instanceof NotLoggedIn ? Promise.reject(e) : { reviews: [] })))
        const path = bookFile(book.title)
        const text = bookMd(book, marks, thoughts, url)
        const cur = await v.read(path).catch(() => null)
        if (cur?.text === text) return false
        mkdirSync(v.abs(WEREAD_FOLDER), { recursive: true })
        const r = await v.write(path, text, cur?.text ?? '')
        if (!r.ok) return false
        await commitPathsRetry(v.root, [path], `微信读书：同步《${book.title.slice(0, 40)}》${marks.length} 条划线`)
        host.filesChanged()
        saved.lastSync = Date.now()
        save()
        host.emit('status', status())
        return true
      }
      const p = writing.then(run, run)
      writing = p.catch(() => undefined)
      return p
    }

    /** 这本书现在的划线：没见过的交给界面插进左边文档（first 是第一次打开这本书：只记下来，不插） */
    async function check(wcId: number, why: string) {
      const page = pages.get(wcId)
      if (!page) return
      try {
        const { marks, book } = await fetchBook(page.bookId)
        const info: BookInfo = { bookId: page.bookId, title: book?.title || page.title, author: book?.author || page.author }
        const seenList = saved.seen[page.bookId]
        const fresh = seenList ? newMarks(marks, new Set(seenList)) : []
        saved.seen[page.bookId] = marks.map((m) => m.id)
        saved.state = 'ok'
        delete saved.error
        save()
        if (fresh.length && host.settings().insert) host.emit('highlight', { book: info, url: page.url, marks: fresh, why })
        if (fresh.length || !seenList) void writeBook(info, marks, page.url).catch(failed)
      } catch (e) {
        failed(e)
      }
    }

    // 阅读页「划线」的请求：划完马上去取
    onTapped((t) => {
      if (!/\/web\/book\/addBookmark|\/web\/review\/add/.test(t.url) || !pages.has(t.wc.id)) return
      void check(t.wc.id, 'tap')
    })

    // ------------------------------------------------------------ 网页里调的

    host.handle(
      'page',
      async ({ sender }, arg) => {
        const a = (arg ?? {}) as Partial<PageBook>
        const url = sender.getURL()
        if (!isReader(url) || typeof a.bookId !== 'string' || !/^\w{1,40}$/.test(a.bookId)) {
          pages.delete(sender.id)
          return
        }
        const was = pages.get(sender.id)
        pages.set(sender.id, { bookId: a.bookId, title: String(a.title ?? '').slice(0, 200), author: String(a.author ?? '').slice(0, 100), chapter: String(a.chapter ?? '').slice(0, 200), url })
        if (was?.bookId === a.bookId) return
        sender.once('destroyed', () => pages.delete(sender.id))
        void tap(sender as WebContents)
        await check(sender.id, 'open')
      },
      { page: true },
    )
    // 网页里松开鼠标（可能刚划完一段）：过一会儿去看有没有新的
    host.handle('check', ({ sender }) => check(sender.id, 'mouseup'), { page: true })

    // ------------------------------------------------------------ 界面调的

    host.handle('status', () => status())

    /** 现在同步：有笔记的书里，上次同步以后动过的一本本写进素材 */
    host.handle('syncAll', async () => {
      if (syncing) return status()
      syncing = true
      host.emit('status', status())
      try {
        const books = parseNotebooks(await api('/user/notebooks', {}))
        let marks = 0
        for (const b of books) {
          marks += b.marks
          if (saved.synced[b.bookId] === b.updated && saved.seen[b.bookId]) continue
          const list = await fetchBook(b.bookId)
          saved.seen[b.bookId] = list.marks.map((m) => m.id)
          await writeBook({ bookId: b.bookId, title: list.book?.title || b.title, author: list.book?.author || b.author }, list.marks, `${process.env.CN_WEREAD_ORIGIN || 'https://weread.qq.com'}/web/bookDetail/${b.bookId}`)
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
