/**
 * 本机的假微信读书（端到端测试用，不碰用户真的账号）：
 * - 阅读页 /web/reader/<编号>：window.__INITIAL_STATE__ 里有书的编号、书名、这一章；页面上一个「划线」按钮，
 *   像微信读书自带的划线一样把选中的字 POST 到 /web/book/addBookmark（我们从这个请求知道刚划了一段）；
 * - 接口（当成 i.weread.qq.com）：/book/bookmarklist、/review/list、/user/notebooks；loggedOut 时回 errcode -2010。
 */
import { createServer, type Server } from 'node:http'

export const BOOK = { bookId: '900001', title: '思考，快与慢', author: '丹尼尔·卡尼曼' }
export const OTHER = { bookId: '900002', title: '刻意练习', author: '安德斯·艾利克森' }
export const PARAS = ['系统 1 的运行是无意识且快速的，不怎么费脑力，没什么感觉，完全处于自主控制状态。', '系统 2 将注意力转移到需要费脑力的大脑活动上来，例如复杂的运算。', '努力是有代价的，我们总是倾向于选择最省力的方法。']

export interface FakeWeread {
  server: Server
  base: string
  /** 现在的划线：书的编号 → 划线 */
  marks: Map<string, { bookmarkId: string; chapterUid: number; range: string; markText: string; createTime: number }[]>
  loggedOut: boolean
  requests: string[]
}

function readerPage(): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${BOOK.title} - 微信读书</title>
  <style>body{margin:0;font:17px/1.9 "Songti SC",serif;background:#fff;color:#222}.top{height:44px;border-bottom:1px solid #eee;display:flex;align-items:center;padding:0 16px;font:13px -apple-system,sans-serif;color:#888}
  article{padding:12px 22px}h2{font-size:20px}#mark{position:fixed;right:16px;bottom:16px;font:13px -apple-system,sans-serif;padding:6px 12px;border-radius:6px;border:0;background:#1b88ee;color:#fff}</style></head>
  <body><div class="top">微信读书 · ${BOOK.title}</div><article><h2>第1章 两个系统</h2>${PARAS.map((p, i) => `<p id="p${i}">${p}</p>`).join('')}</article>
  <button id="mark">划线</button>
  <script>
    window.__INITIAL_STATE__ = { reader: { bookId: '${BOOK.bookId}', bookInfo: { bookId: '${BOOK.bookId}', title: '${BOOK.title}', author: '${BOOK.author}' }, currentChapter: { chapterUid: 3, title: '第1章 两个系统' } } }
    document.getElementById('mark').addEventListener('mousedown', (e) => e.preventDefault())
    document.getElementById('mark').addEventListener('click', () => {
      const text = String(getSelection()).trim()
      if (!text) return
      fetch('/web/book/addBookmark', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bookId: '${BOOK.bookId}', chapterUid: 3, markText: text, range: String(Math.floor(Math.random() * 1000)) + '-1100', type: 1 }) }).then(() => getSelection().removeAllRanges())
    })
  </script></body></html>`
}

export async function startFakeWeread(): Promise<FakeWeread> {
  const f: FakeWeread = {
    server: null as unknown as Server,
    base: '',
    marks: new Map([
      [BOOK.bookId, [{ bookmarkId: `${BOOK.bookId}_3_5-40`, chapterUid: 3, range: '5-40', markText: PARAS[0]!, createTime: 1794790000 }]],
      [OTHER.bookId, [{ bookmarkId: `${OTHER.bookId}_1_1-9`, chapterUid: 1, range: '1-9', markText: '杰出不是天生的。', createTime: 1794780000 }]],
    ]),
    loggedOut: false,
    requests: [],
  }
  const json = (res: import('node:http').ServerResponse, o: unknown) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(o))
  }
  f.server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x')
    f.requests.push(u.pathname + u.search)
    if (u.pathname.startsWith('/web/reader/')) {
      res.setHeader('content-type', 'text/html; charset=utf-8')
      return res.end(readerPage())
    }
    if (u.pathname === '/web/book/addBookmark') {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        const b = JSON.parse(body) as { bookId: string; chapterUid: number; markText: string; range: string }
        const list = f.marks.get(b.bookId) ?? []
        const id = `${b.bookId}_${b.chapterUid}_${b.range}`
        list.push({ bookmarkId: id, chapterUid: b.chapterUid, range: b.range, markText: b.markText, createTime: Math.floor(Date.now() / 1000) })
        f.marks.set(b.bookId, list)
        json(res, { bookmarkId: id, synckey: Date.now() })
      })
      return
    }
    if (f.loggedOut) return json(res, { errcode: -2010, errmsg: '用户不存在' })
    const bookId = u.searchParams.get('bookId') ?? ''
    const book = bookId === OTHER.bookId ? OTHER : BOOK
    if (u.pathname === '/book/bookmarklist')
      return json(res, { synckey: 1, book, chapters: [{ chapterUid: 1, title: '第1章 开端' }, { chapterUid: 3, title: '第1章 两个系统' }], updated: f.marks.get(bookId) ?? [] })
    if (u.pathname === '/review/list')
      return json(res, { reviews: bookId === BOOK.bookId ? [{ review: { reviewId: 'r1', chapterName: '第1章 两个系统', abstract: PARAS[0], content: '系统 1 就是直觉。', createTime: 1794790100 } }] : [] })
    if (u.pathname === '/user/notebooks')
      return json(res, { books: [BOOK, OTHER].map((b) => ({ bookId: b.bookId, book: b, bookmarkCount: f.marks.get(b.bookId)?.length ?? 0, reviewCount: b === BOOK ? 1 : 0, sort: (f.marks.get(b.bookId)?.length ?? 0) })) })
    res.statusCode = 404
    res.end('not found')
  })
  await new Promise<void>((r) => f.server.listen(0, '127.0.0.1', r))
  f.base = `http://127.0.0.1:${(f.server.address() as { port: number }).port}`
  return f
}
