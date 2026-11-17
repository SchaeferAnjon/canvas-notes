/**
 * 微信读书（内置插件）：右栏网页里读 weread.qq.com，用它自带的划线；划的那一段自动插进左边开着的文档（引文 + 书名章节 + 回到微信读书的链接）。
 * 每本书的划线、想法、书评在后台同步成「素材/微信读书/<书名>.md」，能搜。不另做书架页、不另做写想法的框（偏好「微信读书划线进左边文档」）。
 * 这里只放纯函数：认读书页、拆接口的回答、写 md。主进程、界面、网页预加载、测试都用。
 */
import type { PluginManifest } from '../plugins'

export const WEREAD: PluginManifest = {
  id: 'weread',
  name: '微信读书',
  description: '在右栏网页里读微信读书，用它自带的划线：划的那一段自动插进左边开着的文档（带书名、章节和回到原文的链接）；每本书的划线和想法在后台同步进「素材/微信读书」。',
  permissions: ['page', 'net', 'notes:read', 'notes:write'],
  // 右竖条「微信读书」一格（CN-36）：书架；没登录时微信读书自己显示扫码页。主进程按 CN_WEREAD_ORIGIN 换成假网站
  entry: { name: '微信读书', icon: 'book', url: 'https://weread.qq.com/web/shelf' },
}

export const WEREAD_FOLDER = '素材/微信读书'

export interface WereadSettings {
  /** 划线插进左边开着的文档 */
  insert: boolean
  /** 后台同步划线和想法进「素材/微信读书」 */
  sync: boolean
}

export const normalizeWeread = (raw: unknown): WereadSettings => {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<WereadSettings>
  return { insert: r.insert !== false, sync: r.sync !== false }
}

/** 网站地址（测试时换成本机的假网站：CN_WEREAD_ORIGIN） */
let webOrigin = 'https://weread.qq.com'
export const setWereadOrigin = (o: string | null) => (webOrigin = o || 'https://weread.qq.com')
export const wereadOrigin = () => webOrigin

/**
 * 书的编号 → 阅读页地址里的那串（/web/reader/<这串>，翻章时后面再接 k<章节>）。做法照 obsidian-weread-plugin 写的：
 * md5 的头三位 + 类型（纯数字 3，别的 4）+ 2 + md5 的末两位；再接分段（纯数字每 9 位一段转十六进制，别的每个字的编码转十六进制拼一段），
 * 每段前写两位十六进制的长度，段间一个 g；不够 20 位拿 md5 补；最后三位是前面这些的 md5 头三位。md5 由调用方给（这里不依赖 Node）。
 */
export function readerCode(bookId: string, md5: (s: string) => string): string {
  const h = md5(bookId)
  const numeric = /^\d*$/.test(bookId)
  const chunks = numeric ? (bookId.match(/\d{1,9}/g) ?? []).map((x) => parseInt(x, 10).toString(16)) : [[...bookId].map((c) => c.charCodeAt(0).toString(16)).join('')]
  let out = h.slice(0, 3) + (numeric ? '3' : '4') + '2' + h.slice(-2)
  out += chunks.map((c) => c.length.toString(16).padStart(2, '0') + c).join('g')
  if (out.length < 20) out += h.slice(0, 20 - out.length)
  return out + md5(out).slice(0, 3)
}

/**
 * 阅读页地址 → 书的编号：把那串拆回去，再编一次对得上才算（拆不出、对不上是 null）。
 * 真网站上阅读页的 __INITIAL_STATE__.reader.bookId 不可靠（2026-11-17 用真账号量：点不同的书，它报的是同一本），所以先看地址。
 */
export function bookIdOfReader(url: string | null | undefined, md5: (s: string) => string): string | null {
  if (!isReader(url)) return null
  const code = new URL(url!).pathname.slice('/web/reader/'.length).split('k')[0]!
  if (!/^[0-9a-f]{6,}[0-9a-fg]*$/.test(code) || code.length < 9) return null
  const type = code[3]
  // 前 7 位：md5 头三位、类型、2、md5 末两位
  let pos = 7
  const chunks: string[] = []
  while (pos < code.length - 3) {
    const len = parseInt(code.slice(pos, pos + 2), 16)
    if (!len) return null
    chunks.push(code.slice(pos + 2, pos + 2 + len))
    pos += 2 + len
    if (code[pos] !== 'g') break
    pos++
  }
  let id: string
  if (type === '3') id = chunks.map((c) => String(parseInt(c, 16))).join('')
  else if (type === '4') id = (chunks.join('').match(/../g) ?? []).map((x) => String.fromCharCode(parseInt(x, 16))).join('')
  else return null
  return id && readerCode(id, md5) === code ? id : null
}

/** 是不是微信读书的阅读页（/web/reader/<书的编号>） */
export function isReader(url: string | null | undefined): boolean {
  if (!url) return false
  try {
    const u = new URL(url)
    return u.origin === webOrigin && /^\/web\/reader\/[\w-]+/.test(u.pathname)
  } catch {
    return false
  }
}

/** 是不是微信读书网站上的页（书架、阅读页都算） */
export function isWeread(url: string | null | undefined): boolean {
  if (!url) return false
  try {
    return new URL(url).origin === webOrigin
  } catch {
    return false
  }
}

export interface Mark {
  id: string
  bookId: string
  chapterUid: number
  chapter: string
  text: string
  /** 秒 */
  created: number
  /** 阅读页上的位置（「12-80」这种），排序用 */
  range: string
}

export interface Thought {
  id: string
  chapter: string
  /** 想法对着的那段原文 */
  abstract: string
  content: string
  created: number
  /** 书评（不对着某一段） */
  isReview: boolean
}

export interface BookInfo {
  bookId: string
  title: string
  author: string
}

type Raw = Record<string, unknown>
const str = (x: unknown) => (typeof x === 'string' ? x : typeof x === 'number' ? String(x) : '')
const num = (x: unknown) => (typeof x === 'number' ? x : Number(x) || 0)

/** /web/book/bookmarklist 的回答：updated 里每条划线；章节名在条目里或者 chapters 里 */
export function parseBookmarks(raw: unknown, bookId: string): { marks: Mark[]; book: BookInfo | null } {
  const j = (raw ?? {}) as { updated?: Raw[]; chapters?: Raw[]; book?: Raw }
  const chapters = new Map((j.chapters ?? []).map((c) => [num(c.chapterUid), str(c.title)]))
  const marks = (j.updated ?? [])
    .filter((m) => str(m.markText).trim())
    .map((m) => ({
      id: str(m.bookmarkId) || `${bookId}_${str(m.chapterUid)}_${str(m.range)}`,
      bookId: str(m.bookId) || bookId,
      chapterUid: num(m.chapterUid),
      chapter: str(m.chapterName) || chapters.get(num(m.chapterUid)) || '',
      text: str(m.markText).trim(),
      created: num(m.createTime),
      range: str(m.range),
    }))
  const b = j.book
  return { marks, book: b && str(b.title) ? { bookId: str(b.bookId) || bookId, title: str(b.title), author: str(b.author) } : null }
}

/** /web/review/list?mine=1 的回答：想法（对着一段原文）和书评 */
export function parseReviews(raw: unknown): Thought[] {
  const j = (raw ?? {}) as { reviews?: { review?: Raw }[] }
  return (j.reviews ?? [])
    .map((r) => r.review ?? {})
    .filter((r) => str(r.content).trim() || str(r.abstract).trim())
    .map((r) => ({
      id: str(r.reviewId),
      chapter: str(r.chapterName),
      abstract: str(r.abstract).trim(),
      content: str(r.content).trim(),
      created: num(r.createTime),
      isReview: !str(r.abstract).trim() || num(r.type) === 4,
    }))
}

/** /api/user/notebook 的回答：有划线或想法的书 */
export function parseNotebooks(raw: unknown): (BookInfo & { marks: number; reviews: number; updated: number })[] {
  const j = (raw ?? {}) as { books?: Raw[] }
  return (j.books ?? [])
    .map((b) => {
      const book = (b.book ?? {}) as Raw
      return {
        bookId: str(b.bookId) || str(book.bookId),
        title: str(book.title),
        author: str(book.author),
        // 网页「笔记」页上的划线数是 noteCount；bookmarkCount 是另一种计数（真账号上划了 2 条时它是 0）
        marks: num(b.noteCount ?? b.bookmarkCount),
        reviews: num(b.reviewCount),
        updated: num(b.sort ?? b.updateTime),
      }
    })
    .filter((b) => b.bookId && b.title)
}

/** 新划的：上次见过的编号里没有的 */
export const newMarks = (marks: Mark[], seen: ReadonlySet<string>) => marks.filter((m) => !seen.has(m.id))

/** 书名当文件名 */
export const bookFile = (title: string) => `${WEREAD_FOLDER}/${title.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || '未命名的书'}.md`

const oneLine = (s: string) => s.replace(/\s*\n\s*/g, ' ')

/**
 * 插进左边文档的那一段：引文，下一行来源（书名 · 章节，链接回微信读书），和剪进文档的引文同一个写法（白板上认得出是素材卡）。
 */
export function quoteMd(m: Pick<Mark, 'text' | 'chapter'>, book: Pick<BookInfo, 'title'>, url: string): string {
  const quote = m.text
    .split(/\n+/)
    .map((l) => `> ${l.trim()}`)
    .join('\n')
  const src = `《${book.title}》${m.chapter ? ` · ${oneLine(m.chapter)}` : ''}`.replace(/[[\]]/g, ' ')
  return `${quote}\n—— [${src}](${url.replace(/[()\s]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())})`
}

const day = (sec: number) => {
  if (!sec) return ''
  const d = new Date(sec * 1000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * 一本书的素材：frontmatter（书名、作者、书的编号、多少条）、按章节的划线（每条一段引文，后面跟这一段的想法）、书评。
 * 能搜就行，按章节分开；量大时章节标题就是收起的地方。
 */
export function bookMd(book: BookInfo, marks: Mark[], thoughts: Thought[], readerUrl: string): string {
  const out = [
    '---',
    'type: weread',
    `title: ${oneLine(book.title)}`,
    ...(book.author ? [`author: ${oneLine(book.author)}`] : []),
    `bookId: ${book.bookId}`,
    `source: ${readerUrl}`,
    `marks: ${marks.length}`,
    `thoughts: ${thoughts.filter((t) => !t.isReview).length}`,
    '---',
    `# ${oneLine(book.title)}`,
    '',
    `${book.author ? `${oneLine(book.author)} · ` : ''}微信读书里的划线和想法，软件自动同步，改这里不会改回微信读书。`,
  ]
  const byChapter = new Map<string, { marks: Mark[]; uid: number }>()
  for (const m of [...marks].sort((a, b) => a.chapterUid - b.chapterUid || rangeStart(a.range) - rangeStart(b.range) || a.created - b.created)) {
    const k = m.chapter || '（没有章节）'
    if (!byChapter.has(k)) byChapter.set(k, { marks: [], uid: m.chapterUid })
    byChapter.get(k)!.marks.push(m)
  }
  const thoughtsOf = (text: string) => thoughts.filter((t) => !t.isReview && t.abstract && (text.includes(t.abstract) || t.abstract.includes(text)))
  const used = new Set<string>()
  for (const [chapter, g] of byChapter) {
    out.push('', `## ${oneLine(chapter)}`)
    for (const m of g.marks) {
      out.push('', ...m.text.split(/\n+/).map((l) => `> ${l.trim()}`))
      for (const t of thoughtsOf(m.text)) {
        used.add(t.id)
        out.push('', `想法：${oneLine(t.content)}`)
      }
    }
  }
  const rest = thoughts.filter((t) => !t.isReview && !used.has(t.id))
  if (rest.length) {
    out.push('', '## 想法')
    for (const t of rest) out.push('', ...(t.abstract ? [`> ${oneLine(t.abstract)}`] : []), `${t.chapter ? `（${oneLine(t.chapter)}）` : ''}${oneLine(t.content)}`)
  }
  const reviews = thoughts.filter((t) => t.isReview)
  if (reviews.length) {
    out.push('', '## 书评')
    for (const t of reviews) out.push('', t.content, ...(t.created ? [`— ${day(t.created)}`] : []))
  }
  return out.join('\n') + '\n'
}

const rangeStart = (r: string) => Number(r.split('-')[0]) || 0

/** 右栏网页里微信读书登录了没有：in 有登录（右栏 persist:web 里有 wr_vid、wr_skey）；expired 有但微信读书说过期了；out 没有 */
export interface WereadLogin {
  state: 'in' | 'expired' | 'out'
  /** 微信读书的昵称、头像（取得到才有） */
  name?: string
  avatar?: string
}

/** 设置页里显示的同步状态 */
export interface WereadStatus {
  /** ok / 没登录 / 出错 / 还没同步过 */
  state: 'ok' | 'login' | 'error' | 'never'
  login: WereadLogin
  /** 上次同步完的时间（毫秒） */
  lastSync: number
  books: number
  marks: number
  error?: string
  syncing: boolean
}

/** 网页版接口（weread.qq.com，和 obsidian-weread-plugin 一样用网页登录的 cookie）：errCode / errcode 两种写法；-2010 用户不存在、-2012 登录超时 */
export function apiError(raw: unknown): { login: boolean; message: string } | null {
  const j = (raw ?? {}) as { errcode?: unknown; errCode?: unknown; errmsg?: unknown; errMsg?: unknown }
  const code = Number(j.errCode ?? j.errcode ?? 0)
  if (!code) return null
  return { login: code === -2010 || code === -2012, message: String(j.errMsg ?? j.errmsg ?? '') || `微信读书出错（${code}）` }
}

/** 右栏 cookie 里认登录：wr_vid（用户编号）和 wr_skey（登录凭据）都在 */
export function loginOf(cookies: readonly { name: string; value: string }[]): { vid: string } | null {
  const get = (n: string) => cookies.find((c) => c.name === n)?.value ?? ''
  const vid = get('wr_vid')
  return vid && get('wr_skey') ? { vid } : null
}

/**
 * 这次该插进文档的划线：见过这本书就是没见过的那些；
 * 没见过这本书（打开书那一次没取成）而这次是划线触发的：2 分钟内新建的当成新的，别把刚划的第一条吞掉。
 */
export function marksToInsert(marks: Mark[], seen: readonly string[] | undefined, why: string, nowSec: number): Mark[] {
  if (seen) return newMarks(marks, new Set(seen))
  if (why === 'open') return []
  return marks.filter((m) => m.created && nowSec - m.created <= 120)
}
