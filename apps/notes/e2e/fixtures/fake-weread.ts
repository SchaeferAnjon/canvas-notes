/**
 * 本机的假微信读书（端到端测试用，不碰用户真的账号），照网页版 weread.qq.com 的样子：
 * - 阅读页 /web/reader/<编号>：window.__INITIAL_STATE__ 里有书的编号、书名、这一章；页面上一个「划线」按钮，
 *   像微信读书自带的划线一样把选中的字 POST 到 /web/book/addBookmark（我们从这个请求知道刚划了一段）；两章（第 2 章的段落 id 是 q0、q1）；
 *   阅读区像真网站一样 overflow: hidden，右边藏着一排竖着的工具按钮（CN-120：按 Tab 焦点跳过去，阅读区被横着滚开）；
 *   最后两段各有一个「注」（一个在行首、一个在行尾），点了弹注释气泡，类名、结构、摆法照网页版（task-rbtrz：网页栏窄时气泡左边算成负的）；
 * - 书架 /web/shelf：没登录时是「微信扫码登录」页（点「模拟扫码」= 扫完码，网站种下 wr_vid、wr_skey），登录了是书架；
 * - 网页版接口：/web/book/bookmarklist、/web/review/list、/api/user/notebook、/web/user，认 cookie 里的 wr_skey，
 *   不对回 errCode -2012「登录超时」；loggedOut 时回 errcode -2010；
 * - HEAD /：登录着就换一个新的 wr_skey（续登录），记次数；
 * - 手机 App 那套接口（/book/bookmarklist 这些，以前插件问的 i.weread.qq.com）：网页的 cookie 不认，一律 -2012。
 */
import { createHash } from 'node:crypto'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { readerCode } from '../../src/shared/plugins/weread'

export const BOOK = { bookId: '900001', title: '思考，快与慢', author: '丹尼尔·卡尼曼' }
export const OTHER = { bookId: '900002', title: '刻意练习', author: '安德斯·艾利克森' }
export const PARAS = ['系统 1 的运行是无意识且快速的，不怎么费脑力，没什么感觉，完全处于自主控制状态。', '系统 2 将注意力转移到需要费脑力的大脑活动上来，例如复杂的运算。', '努力是有代价的，我们总是倾向于选择最省力的方法。']
/** 第 2 章 注意力（chapterUid 5）的两段 */
export const PARAS2 = ['注意力是有限的，分给一件事的多了，别的就少了。', '人在专心做一件事时，会对别的东西视而不见。']
/** 阅读页里「注」的注释（点了弹气泡） */
export const NOTE = '杰克逊（Andrew Jackson, 1767-1845），美国将军，第七任总统。在1812年战争期间因功勋卓著被视作民族英雄。'
export const VID = '10086'
/** 这本书的阅读页地址：和真网站一样由书的编号编出来（插件先从地址认书） */
export const READER = '/web/reader/' + readerCode(BOOK.bookId, (t) => createHash('md5').update(t).digest('hex'))

export interface FakeWeread {
  server: Server
  base: string
  /** 现在的划线：书的编号 → 划线 */
  marks: Map<string, { bookmarkId: string; chapterUid: number; range: string; markText: string; createTime: number }[]>
  /** 想法和书评：书的编号 → /web/review/list 里的 review */
  reviews: Map<string, Record<string, unknown>[]>
  loggedOut: boolean
  /** 网站现在认的 wr_skey（HEAD 续一次就换） */
  skey: string
  /** 接下来几次取划线回 500（模拟打开书那一次没取成） */
  failBookmarks: number
  /** 阅读页上不放书的编号（模拟微信读书改版） */
  hideBookId: boolean
  /** 阅读页的 __INITIAL_STATE__ 写的是另一本书（真网站上量到过：点不同的书它报同一本） */
  staleState: boolean
  heads: number
  requests: string[]
}

const cookieOf = (req: IncomingMessage, name: string) => (req.headers.cookie ?? '').split(/;\s*/).find((c) => c.startsWith(name + '='))?.slice(name.length + 1) ?? ''

function readerPage(f: FakeWeread): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${BOOK.title} - 微信读书</title>
  <style>body{margin:0;font:17px/1.9 "Songti SC",serif;background:#fff;color:#222}.top{height:44px;border-bottom:1px solid #eee;display:flex;align-items:center;padding:0 16px;font:13px -apple-system,sans-serif;color:#888}
  #app{position:relative;overflow:hidden}#wide{position:relative;width:calc(100% + 72px)}article{width:calc(100% - 72px);box-sizing:border-box;padding:12px 22px}h2{font-size:20px}
  .ctl{position:absolute;top:12px;right:0;width:56px;display:flex;flex-direction:column;gap:8px}.ctl button{width:44px;height:44px;border-radius:50%;border:0;background:#f2f2f2;font:12px -apple-system,sans-serif}
  #mark{position:fixed;right:16px;bottom:16px;font:13px -apple-system,sans-serif;padding:6px 12px;border-radius:6px;border:0;background:#1b88ee;color:#fff}
  .fnp{max-width:400px;margin-left:auto;margin-right:auto}.fnp.r{text-align:right}.wr-fn{display:inline-block;width:18px;height:18px;border-radius:50%;background:#e8913a;color:#fff;font:11px/18px -apple-system,sans-serif;text-align:center;cursor:pointer}
  .reader_footerNote_mask{position:fixed;top:0;bottom:0;left:0;right:0;z-index:90}
  .reader_footerNote_container{z-index:100;position:absolute;width:92%;max-width:304px}
  .reader_footerNote_container:after{content:"";position:absolute;bottom:-8px;left:50%;margin-left:-8px;border-top:8px solid #3a3c3e;border-left:8px solid transparent;border-right:8px solid transparent}
  .reader_footerNote_container_Top:after{bottom:auto;top:-8px;border:8px solid transparent;border-top:none;border-bottom:8px solid #3a3c3e}
  .reader_footerNote_bubble{padding:16px;border-radius:16px;background:#3a3c3e;max-height:300px;overflow:auto}
  .reader_footerNote_text{margin:0;color:#fff;font-size:15px;line-height:23px}</style></head>
  <body><div class="top">微信读书 · ${BOOK.title}</div><div id="app"><div id="wide"><article><h2>第1章 两个系统</h2>${PARAS.map((p, i) => `<p id="p${i}" data-uid="3">${p}</p>`).join('')}<h2>第2章 注意力</h2>${PARAS2.map((p, i) => `<p id="q${i}" data-uid="5">${p}</p>`).join('')}
  <p class="fnp" id="fnp0"><span class="wr-fn" id="fnL" data-note="${NOTE}">注</span>说，如果把眼光再放远一些</p><p class="fnp r" id="fnp1">实际上是从安德鲁·杰克逊开始<span class="wr-fn" id="fnR" data-note="${NOTE}">注</span></p></article>
  <div class="ctl"><button>目录</button><button>笔记</button><button>字号</button></div></div></div>
  <button id="mark" tabindex="-1">划线</button>
  <script>
    window.__INITIAL_STATE__ = ${f.hideBookId ? '{ newReader: {} }' : f.staleState ? `{ reader: { bookId: '${OTHER.bookId}', bookInfo: { bookId: '${OTHER.bookId}', title: '${OTHER.title}', author: '${OTHER.author}' } } }` : `{ reader: { bookId: '${BOOK.bookId}', bookInfo: { bookId: '${BOOK.bookId}', title: '${BOOK.title}', author: '${BOOK.author}' }, currentChapter: { chapterUid: 3, title: '第1章 两个系统' } } }`}
    // 「注」：点了弹注释气泡，照网页版的算法摆（按「注」在整页里的位置，气泡正中对着它，上半屏放下面、下半屏放上面；
    // 先挂上去、下一拍才写 left、top），网页栏窄时左边会算成负的
    document.addEventListener('click', (e) => {
      const n = e.target.closest && e.target.closest('.wr-fn')
      if (!n) return
      let left = 0, top = 0
      for (let x = n; x; x = x.offsetParent) { left += x.offsetLeft; top += x.offsetTop }
      const wrap = document.createElement('div')
      wrap.innerHTML = '<div class="reader_footerNote_mask"></div><div class="reader_footerNote_container"><div class="reader_footerNote_bubble"><p class="reader_footerNote_text"></p></div></div>'
      wrap.querySelector('.reader_footerNote_text').textContent = n.dataset.note
      wrap.firstChild.addEventListener('click', () => wrap.remove())
      document.body.appendChild(wrap)
      const c = wrap.querySelector('.reader_footerNote_container')
      const b = wrap.querySelector('.reader_footerNote_bubble')
      Promise.resolve().then(() => {
        const x = left - b.offsetWidth / 2 + n.offsetWidth / 2
        if (top - scrollY < innerHeight / 2) {
          c.classList.add('reader_footerNote_container_Top')
          c.setAttribute('style', 'left:' + x + 'px;top:' + (top + n.offsetHeight + 12) + 'px;')
        } else c.setAttribute('style', 'left:' + x + 'px;top:' + (top - b.offsetHeight - 12) + 'px;')
      })
    })
    document.getElementById('mark').addEventListener('mousedown', (e) => e.preventDefault())
    document.getElementById('mark').addEventListener('click', () => {
      const sel = getSelection()
      const text = String(sel).trim()
      if (!text) return
      const p = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement).closest('p')
      const uid = p ? Number(p.dataset.uid) : 3
      // 在这一章里的位置：第几段、段里第几个字（真网站的 range 也是「开头-结尾」）
      const at = (p ? [...p.parentElement.querySelectorAll('p[data-uid="' + uid + '"]')].indexOf(p) + 1 : 1) * 1000 + sel.anchorOffset
      fetch('/web/book/addBookmark', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bookId: '${BOOK.bookId}', chapterUid: uid, markText: text, range: at + '-' + (at + text.length), type: 1 }) }).then(() => getSelection().removeAllRanges())
    })
  </script></body></html>`
}

const loginPage = () => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>微信读书</title>
  <style>body{margin:0;font:15px -apple-system,"PingFang SC",sans-serif;text-align:center;padding-top:60px;color:#222}.qr{width:160px;height:160px;margin:20px auto;background:repeating-conic-gradient(#222 0 25%,#fff 0 50%) 0 0/20px 20px;border:8px solid #fff;box-shadow:0 0 0 1px #ddd}button{font:inherit;padding:6px 14px}</style></head>
  <body><h1 style="font-size:20px">微信扫码登录</h1><div class="qr"></div><p>打开微信，扫一扫登录微信读书</p>
  <button id="scan" onclick="fetch('/web/login/scan',{method:'POST'}).then(() => location.href = '/web/shelf')">模拟扫码</button></body></html>`

const shelfPage = () => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>书架 - 微信读书</title></head>
  <body style="font:15px -apple-system,sans-serif;padding:20px"><h1 id="shelf" style="font-size:20px">我的书架</h1>
  <a id="b1" href="${READER}">${BOOK.title}</a> · <a href="/web/reader/x2">${OTHER.title}</a></body></html>`

export async function startFakeWeread(): Promise<FakeWeread> {
  const f: FakeWeread = {
    server: null as unknown as Server,
    base: '',
    marks: new Map([
      [BOOK.bookId, [{ bookmarkId: `${BOOK.bookId}_3_5-40`, chapterUid: 3, range: '5-40', markText: PARAS[0]!, createTime: 1794790000 }]],
      [OTHER.bookId, [{ bookmarkId: `${OTHER.bookId}_1_1-9`, chapterUid: 1, range: '1-9', markText: '杰出不是天生的。', createTime: 1794780000 }]],
    ]),
    reviews: new Map([[BOOK.bookId, [{ reviewId: 'r1', chapterName: '第1章 两个系统', abstract: PARAS[0], content: '系统 1 就是直觉。', createTime: 1794790100 }]]]),
    loggedOut: false,
    skey: 'skey-1',
    failBookmarks: 0,
    hideBookId: false,
    staleState: false,
    heads: 0,
    requests: [],
  }
  const json = (res: import('node:http').ServerResponse, o: unknown) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(o))
  }
  f.server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x')
    f.requests.push(`${req.method === 'HEAD' ? 'HEAD ' : ''}${u.pathname}${u.search}`)
    const vid = cookieOf(req, 'wr_vid')
    if (req.method === 'HEAD') {
      f.heads++
      if (vid) {
        f.skey = `skey-${f.heads + 1}`
        res.setHeader('set-cookie', [`wr_skey=${f.skey}; Path=/; Max-Age=86400`])
      }
      return res.end()
    }
    const html = (s: string) => {
      res.setHeader('content-type', 'text/html; charset=utf-8')
      res.end(s)
    }
    if (u.pathname.startsWith('/web/reader/')) return html(readerPage(f))
    if (u.pathname === '/web/shelf') return html(vid && cookieOf(req, 'wr_skey') ? shelfPage() : loginPage())
    if (u.pathname === '/web/login/scan') {
      res.setHeader('set-cookie', [`wr_vid=${VID}; Path=/; Max-Age=86400`, `wr_skey=${f.skey}; Path=/; Max-Age=86400`])
      return json(res, { succ: 1 })
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
    // 手机 App 的接口：网页登录的 cookie 不认
    if (['/book/bookmarklist', '/review/list', '/user/notebooks'].includes(u.pathname)) return json(res, { errcode: -2012, errmsg: '登录超时' })
    if (f.loggedOut) return json(res, { errcode: -2010, errmsg: '用户不存在' })
    if (cookieOf(req, 'wr_skey') !== f.skey || !vid) return json(res, { errCode: -2012, errMsg: '登录超时' })
    const bookId = u.searchParams.get('bookId') ?? ''
    const book = bookId === OTHER.bookId ? OTHER : BOOK
    if (u.pathname === '/web/book/bookmarklist') {
      if (f.failBookmarks > 0) {
        f.failBookmarks--
        res.statusCode = 500
        return res.end('busy')
      }
      return json(res, { synckey: 1, book, chapters: [{ chapterUid: 1, title: '第1章 开端' }, { chapterUid: 3, title: '第1章 两个系统' }, { chapterUid: 5, title: '第2章 注意力' }], updated: f.marks.get(bookId) ?? [] })
    }
    if (u.pathname === '/web/review/list') return json(res, { reviews: (f.reviews.get(bookId) ?? []).map((review) => ({ review })) })
    if (u.pathname === '/api/user/notebook')
      return json(res, { books: [BOOK, OTHER].map((b) => ({ bookId: b.bookId, book: b, noteCount: f.marks.get(b.bookId)?.length ?? 0, bookmarkCount: 0, reviewCount: b === BOOK ? 1 : 0, sort: f.marks.get(b.bookId)?.length ?? 0 })) })
    if (u.pathname === '/web/user') return json(res, { userVid: Number(vid), name: '读书的人', avatar: '' })
    res.statusCode = 404
    res.end('not found')
  })
  await new Promise<void>((r) => f.server.listen(0, '127.0.0.1', r))
  f.base = `http://127.0.0.1:${(f.server.address() as { port: number }).port}`
  return f
}
