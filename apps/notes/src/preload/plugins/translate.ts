/**
 * 双语翻译网页这半（webview 预加载的隔离环境，网页脚本碰不到）：
 * - 开：先问主进程有没有能用的引擎（不真的问 AI）；没有就不往段落里写字，告诉界面打开菜单说原因。
 *   有就认出正文段落（p、li、h1–h6、blockquote、td……，跳过代码、导航、按钮），只翻看得见的，滚到哪翻到哪；
 *   每段下面插一个 <cn-tr data-s="样式">（或者「只看译文」把原文藏起来），没回来之前是「翻译中…」，没翻成是一行固定 12px 的「没翻成 · 重试」。
 * - 七种样式写在一张 <style id="cn-tr-style"> 里，颜色跟着网页自己的底色（深浅两组），不跟软件主题。
 * - 再按一次：译文全拿掉，原文原样放回。
 * - 选中一段点「翻译」：选区下面弹一张小卡片显示译文（不抢焦点）。
 * - 整页剪藏、选区剪藏：按「整页剪藏带上译文」开关跳过或带上译文（webview-page.ts、webview.ts 调这里的两个函数）。
 * 段落一批批交给主进程（main/plugins/translate），翻好一段回来一段；出错时带原因（哪种、哪个引擎、原话），存在这一页，报给界面。
 */
import {
  type Display,
  detectLang,
  effectiveTarget,
  errorTitle,
  langName,
  normalizeTranslate,
  sameLang,
  type TrError,
  type TrPageState,
  type TrStyle,
} from '../../shared/plugins/translate'
import { callPlugin, onHostCommand, onPageEvent, onPluginState, pluginEnabled, pluginState, tellHost } from './state'
import { isPageKey } from '../page-keys'

const ID = 'translate'
/** 这些里面的不翻：代码、导航、按钮、输入框、我们自己插的 */
const SKIP =
  'pre,code,kbd,samp,var,script,style,noscript,template,textarea,input,select,option,button,nav,svg,math,' +
  '[role="navigation"],[role="button"],[role="menu"],[role="menubar"],[role="toolbar"],[role="tablist"],[role="search"],' +
  '[contenteditable=""],[contenteditable="true"],[aria-hidden="true"],[translate="no"],.notranslate,.mw-editsection,' +
  'cn-tr,cn-orig,#cn-clip-host,#cn-tr-card,#cn-video-host'

/** 问得太快时多久再试 */
const RATE_RETRY_MS = 30_000

type Status = 'wait' | 'queued' | 'sent' | 'done' | 'error'

interface Item {
  id: number
  el: HTMLElement
  text: string
  status: Status
  tr: HTMLElement | null
  /** 只看译文时包住原文的那一层 */
  orig: HTMLElement | null
  result?: string
  error?: TrError
}

let on = false
let starting = false
let target = 'zh-CN'
let pageLang: string | null = null
let display: Display = 'below'
let style: TrStyle = 'plain'
let blocked: TrError | undefined
let lastError: TrError | undefined
let retryAt: number | undefined
let retryTimer: ReturnType<typeof setTimeout> | undefined
let menuSeq = 0
let pdfSeq = 0
/** 段落编号从一个随机数开始：换了网页后，上一页还在路上的译文对不上这一页的段 */
let seq = Math.floor(Math.random() * 1e9)
let sentChars = 0
const items = new Map<number, Item>()
let byEl = new WeakMap<Element, Item>()
let io: IntersectionObserver | null = null
let mo: MutationObserver | null = null
let queue: Item[] = []
let flushTimer: ReturnType<typeof setTimeout> | undefined
let rescanTimer: ReturnType<typeof setTimeout> | undefined
let lastSettings = ''

const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
const htmlLang = () => document.documentElement.lang || ''
const settings = () => normalizeTranslate(pluginState(ID)?.settings)

// ---------------------------------------------------------------- 样式表（spec 第 2 节，照抄）

const CSS = `
cn-tr{display:block;margin:.3em 0 0;white-space:normal;font-style:normal}
cn-tr[data-s="plain"]{color:color-mix(in srgb,currentColor 72%,transparent)}
cn-tr[data-s="underline"]{text-decoration:underline 1.5px var(--cn-ring);text-underline-offset:.28em;text-decoration-skip-ink:auto}
cn-tr[data-s="dashed"]{border:1px dashed var(--cn-line2);border-radius:6px;padding:.2em .5em;margin-top:.4em}
cn-tr[data-s="marker"]>span{background:linear-gradient(transparent 58%,var(--cn-mark) 58%);-webkit-box-decoration-break:clone;box-decoration-break:clone}
cn-tr[data-s="bar"]{border-left:2px solid var(--cn-bar);padding-left:.7em;margin-top:.4em}
[data-cn-fade]{color:color-mix(in srgb,var(--cn-c) 45%,transparent)!important}
[data-cn-fade] cn-tr{color:var(--cn-c)}
cn-tr[data-s="blur"]{filter:blur(5px);transition:filter .15s;user-select:none;cursor:pointer}
cn-tr[data-s="blur"]:hover{filter:blur(3px)}
cn-tr[data-s="blur"][data-shown]{filter:none;user-select:auto;cursor:auto}
cn-tr[data-st="wait"],cn-tr[data-st="err"]{font:400 12px/1.5 -apple-system,"PingFang SC",sans-serif;filter:none;border:0;padding:0;text-decoration:none}
cn-tr[data-st="wait"]{color:color-mix(in srgb,currentColor 45%,transparent);animation:cn-pulse 1.4s ease-in-out infinite}
cn-tr[data-st="err"]{color:color-mix(in srgb,currentColor 55%,transparent);display:flex;align-items:center;gap:6px}
cn-tr[data-st="err"] i{width:6px;height:6px;border-radius:50%;background:var(--cn-red);flex:none}
cn-tr[data-st="err"] u{text-decoration:underline;text-underline-offset:2px;cursor:pointer}
@keyframes cn-pulse{50%{opacity:.45}}
`

/** 浅色网页 / 深色网页上的那组颜色（DESIGN.v3.md 4.2 家族灰两列） */
const PALETTE = {
  light: '--cn-acc:#9A48AD;--cn-ring:rgba(154,72,173,.38);--cn-mark:rgba(154,72,173,.16);--cn-line2:rgba(17,17,19,.22);--cn-bar:#C7C7CC;--cn-red:#DC3545',
  dark: '--cn-acc:#C98BDB;--cn-ring:rgba(201,139,219,.55);--cn-mark:rgba(201,139,219,.24);--cn-line2:rgba(255,255,255,.24);--cn-bar:#48484E;--cn-red:#FF6369',
}

/** 「r, g, b, a」：拆不出来给 null */
function rgba(c: string): [number, number, number, number] | null {
  const m = /rgba?\(([^)]+)\)/.exec(c)
  if (!m) return null
  const p = m[1]!.split(/[\s,/]+/).filter(Boolean).map(Number)
  return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0, p[3] ?? 1]
}

/** 网页底色：body，透明就看 html，再透明当白；相对亮度 < 0.4 算深色网页 */
export function pageIsDark(doc: Document = document): boolean {
  for (const el of [doc.body, doc.documentElement]) {
    if (!el) continue
    const c = rgba((doc.defaultView ?? window).getComputedStyle(el).backgroundColor)
    if (!c || c[3] === 0) continue
    const lin = (v: number) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]) < 0.4
  }
  return false
}

/**
 * 译文的样式表：用「构造出来的样式表」（adoptedStyleSheets）挂上去，不插 <style>：
 * 开了严格 CSP 的网站（不许内联样式）会挡掉插进去的 <style>，译文就挤在原文后面、没有样式；构造的样式表不受 CSP 管。
 * shadow DOM 里外面的样式进不去，每个 shadow root 也挂一份；同源 iframe 是另一个文档，挂它自己的（底色按它自己的量）。
 */
/** 是不是一个文档（iframe 的文档是另一个窗口的对象，instanceof Document 认不出，看 nodeType） */
const isDoc = (n: Node): n is Document => n.nodeType === Node.DOCUMENT_NODE
const sheets = new WeakMap<Document | ShadowRoot, CSSStyleSheet>()
/** 挂过样式的地方（关掉翻译时摘下来） */
let styled: (Document | ShadowRoot)[] = []

function ensureStyle(where: Document | ShadowRoot = document) {
  const doc = isDoc(where) ? where : where.ownerDocument
  const win = doc.defaultView
  if (!win) return
  let sheet = sheets.get(where)
  if (!sheet) {
    sheet = new win.CSSStyleSheet()
    sheets.set(where, sheet)
  }
  sheet.replaceSync(isDoc(where) ? `html{${pageIsDark(doc) ? PALETTE.dark : PALETTE.light}}${CSS}` : CSS)
  // 网站自己后来换了一整组样式表时（少见）把我们的也换掉了：再挂上
  if (!where.adoptedStyleSheets.includes(sheet)) where.adoptedStyleSheets = [...where.adoptedStyleSheets, sheet]
  if (!styled.includes(where)) styled.push(where)
}

function dropStyles() {
  for (const where of styled) {
    const sheet = sheets.get(where)
    if (sheet) where.adoptedStyleSheets = where.adoptedStyleSheets.filter((x) => x !== sheet)
  }
  styled = []
}

// 网站跟着系统换深浅色：重量一次
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => on && setTimeout(() => styled.forEach((w) => ensureStyle(w)), 50))

// ---------------------------------------------------------------- 认段落、排队

/**
 * 认段落不看标签，看排版：一段是「排成一块、里面只有行内的字」的那个元素（CSS 的 display 是块、列表项、表格格子、弹性布局里的一项……，
 * 里面的子元素都是行内的）。字放在 p 里、div > span 里、YouTube 的 yt-formatted-string 里、别的站自己起名的元素里都一样认，不按网站写。
 * 以前只认 p、li、h1 这类标签和「直接写着字的 div」，div > span 的正文（很多新闻站、博客、单页应用）一段都找不到。
 * 还会进 shadow DOM（开放的）和同源 iframe 里找；跨域 iframe、关闭的 shadow DOM 网页预加载碰不到。
 */
type Root = Document | ShadowRoot | Element

/** 这一次扫描里量过的排版（同一个元素不量两次） */
let displays = new Map<Element, string>()
function displayOf(el: Element): string {
  let d = displays.get(el)
  if (d === undefined) {
    d = (el.ownerDocument.defaultView ?? window).getComputedStyle(el).display
    displays.set(el, d)
  }
  return d
}
/** 自己排成一块（不和前后的字排在同一行）；inline-block 这类按行内算（按钮、标签、行内的小图标） */
const isBlock = (el: Element) => {
  const d = displayOf(el)
  return d !== 'none' && d !== 'contents' && !d.startsWith('inline') && !d.startsWith('ruby')
}

/** 一个字所在的那一段：往上找第一个排成块的元素；到了 shadow root 顶上还没有，就是 shadow root 里最外面那个元素 */
function blockOf(text: Text): HTMLElement | null {
  let el = text.parentElement
  let last: HTMLElement | null = null
  while (el) {
    if (isBlock(el)) return el
    last = el
    const up: Node | null = el.parentNode
    el = up && up.nodeType === Node.ELEMENT_NODE ? (up as HTMLElement) : null
  }
  return last
}

/** 这个元素算不算「一段」，算的话给它的字 */
function paragraphText(el: HTMLElement): string | null {
  if (el.closest(SKIP)) return null
  const text = norm(el.innerText || '')
  // 至少两个字母或汉字：「16.4万」「12:30」这种数字不翻
  if (text.length < 2 || (text.match(/\p{L}/gu)?.length ?? 0) < 2) return null
  // 全是链接的短行（菜单、目录、标签）不翻
  if (!/^H[1-6]$/.test(el.tagName) && text.length < 50) {
    const linkText = norm(Array.from(el.querySelectorAll('a'), (a) => a.innerText).join(' '))
    if (linkText && linkText.length >= text.length - 2) return null
  }
  if (sameLang(detectLang(text, htmlLang()), target)) return null
  return text
}

/** 同源 iframe 的文档（跨域的拿不到，给 null） */
function frameDoc(f: HTMLIFrameElement): Document | null {
  try {
    return f.contentDocument?.body ? f.contentDocument : null
  } catch {
    return null
  }
}

/** 进过的 shadow root、iframe 文档：挂样式、看后来的变化（新加的段落） */
let watched = new WeakSet<Node>()
function watchRoot(r: Document | ShadowRoot) {
  if (watched.has(r)) return
  watched.add(r)
  ensureStyle(r)
  mo?.observe(isDoc(r) ? r.body : r, { childList: true, subtree: true, characterData: true })
  // iframe 自己滚：量一下哪些段看得见了
  if (isDoc(r) && r !== document) r.defaultView?.addEventListener('scroll', onScroll, true)
}

/**
 * 网页里的播放器：每个看得见的 <video> 往上找，一直到比视频大一半以上之前的那个外框（播放器的壳，弹幕层、控制条都在里面）。
 * 不按网站写类名，B 站、YouTube、Vimeo、随便哪个播放器都一样认
 */
function playerBoxes(root: Root): Element[] {
  const doc = isDoc(root) ? root : root.ownerDocument
  const out: Element[] = []
  for (const v of Array.from(doc.querySelectorAll('video'))) {
    const r = v.getBoundingClientRect()
    const area = r.width * r.height
    if (area < 100) continue
    let box: Element = v
    for (let up = v.parentElement; up; up = up.parentElement) {
      const u = up.getBoundingClientRect()
      if (u.width * u.height > area * 1.6) break
      box = up
    }
    out.push(box)
  }
  return out
}

function scan(root: Root = document) {
  if (!on || !io || !root) return
  displays = new Map()
  const blocks = new Set<HTMLElement>()
  const roots: Root[] = [root]
  while (roots.length) {
    const r = roots.pop()!
    const doc = isDoc(r) ? r : r.ownerDocument
    const start = isDoc(r) ? r.body : r
    if (!start) continue
    const walker = doc.createTreeWalker(start, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeType === Node.ELEMENT_NODE && (n as Element).matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    })
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeType === Node.TEXT_NODE) {
        if (!/\p{L}/u.test(n.textContent ?? '')) continue
        const b = blockOf(n as Text)
        if (b) blocks.add(b)
        continue
      }
      const el = n as Element
      if (el.shadowRoot) {
        roots.push(el.shadowRoot)
        watchRoot(el.shadowRoot)
      }
      if (el.tagName === 'IFRAME') {
        const d = frameDoc(el as HTMLIFrameElement)
        if (d) {
          roots.push(d)
          watchRoot(d)
        }
      }
    }
  }
  // 里面还有别的段的（「一段字 + 一个块」混排的外层）不当一段：翻里面那几段（以前也这样）
  const mixed = new Set<HTMLElement>()
  for (const b of blocks) {
    for (let up: Node | null = b.parentNode; up && up.nodeType === Node.ELEMENT_NODE; up = up.parentNode) {
      if (blocks.has(up as HTMLElement)) mixed.add(up as HTMLElement)
    }
  }
  const players = playerBoxes(root)
  for (const el of blocks) {
    if (mixed.has(el) || byEl.has(el)) continue
    // 播放器画面上的字（B 站的弹幕、播放器的按钮和提示）不翻：译文会糊在画面上；视频的字幕走双语字幕
    if (players.some((p) => p.contains(el))) continue
    // 现在看不见的（收起的、没展开的、display:none 里的）先不记，露出来以后新的变化会再扫到
    if (!el.checkVisibility()) continue
    const text = paragraphText(el)
    if (text === null) continue
    const it: Item = { id: ++seq, el, text, status: 'wait', tr: null, orig: null }
    items.set(it.id, it)
    byEl.set(el, it)
    io.observe(el)
  }
}

/**
 * 看得见（或快滚到）的段排进去。IntersectionObserver 在网页没在画的时候（窗口被挡住、刚载入还在忙）会晚到，
 * 所以开的时候、滚动时、新段落出来时也自己量一遍
 */
function sweep() {
  if (!on) return
  const top = -240
  for (const it of items.values()) {
    if (it.status !== 'wait') continue
    const r = it.el.getBoundingClientRect()
    // iframe 里的段按 iframe 自己的窗口量
    const bottom = (it.el.ownerDocument.defaultView?.innerHeight ?? innerHeight) + 240
    if (r.height > 0 && r.bottom >= top && r.top <= bottom) enqueue(it)
  }
}

let sweepTimer: ReturnType<typeof setTimeout> | undefined
function onScroll() {
  if (!on || sweepTimer) return
  sweepTimer = setTimeout(() => {
    sweepTimer = undefined
    sweep()
  }, 150)
}
window.addEventListener('scroll', onScroll, true)

// ---------------------------------------------------------------- 画一段

function trOf(it: Item): HTMLElement {
  if (!it.tr || !it.tr.isConnected) {
    it.tr = document.createElement('cn-tr')
    it.tr.setAttribute('translate', 'no')
    it.el.appendChild(it.tr)
  }
  return it.tr
}

/** 段落上的那行提示：「Claude Code 还没登录。点「重试」再翻这一段」 */
const errHint = (e: TrError | undefined) => `${e ? errorTitle(e) : '没翻成'}。点「重试」再翻这一段`

function setFade(it: Item, fade: boolean) {
  if (fade && !it.el.hasAttribute('data-cn-fade')) {
    // 量这段原来的字色（加淡化前），译文用它
    it.el.style.setProperty('--cn-c', getComputedStyle(it.el).color)
    it.el.setAttribute('data-cn-fade', '')
  } else if (!fade && it.el.hasAttribute('data-cn-fade')) {
    it.el.removeAttribute('data-cn-fade')
    it.el.style.removeProperty('--cn-c')
  }
}

/** 模糊自测时点开过的段（这一页；换页就清空） */
const shown = new Set<number>()

function render(it: Item) {
  const tr = trOf(it)
  tr.onclick = null
  tr.removeAttribute('title')
  tr.removeAttribute('data-shown')
  if (it.status === 'done') {
    tr.removeAttribute('data-st')
    const span = document.createElement('span')
    span.textContent = it.result ?? ''
    tr.replaceChildren(span)
    if (display === 'only') {
      setFade(it, false)
      wrapOriginal(it)
      tr.removeAttribute('data-s')
      tr.style.setProperty('margin', '0', 'important')
    } else {
      unwrapOriginal(it)
      tr.style.removeProperty('margin')
      tr.setAttribute('data-s', style)
      setFade(it, style === 'fade')
      if (style === 'blur') {
        if (shown.has(it.id)) tr.setAttribute('data-shown', '')
        tr.onclick = (e) => {
          // 点一下显出来，再点糊回去；点到译文里的链接不管
          if ((e.target as HTMLElement).closest('a')) return
          e.preventDefault()
          e.stopPropagation()
          if (shown.has(it.id)) shown.delete(it.id)
          else shown.add(it.id)
          tr.toggleAttribute('data-shown', shown.has(it.id))
        }
      }
    }
    return
  }
  setFade(it, false)
  unwrapOriginal(it)
  tr.removeAttribute('data-s')
  tr.style.removeProperty('margin')
  if (it.status === 'error') {
    tr.setAttribute('data-st', 'err')
    tr.title = errHint(it.error)
    const retry = document.createElement('u')
    retry.textContent = '重试'
    retry.onclick = (e) => {
      e.preventDefault()
      e.stopPropagation()
      it.status = 'wait'
      enqueue(it)
    }
    tr.replaceChildren(document.createElement('i'), '没翻成 · ', retry)
  } else {
    tr.setAttribute('data-st', 'wait')
    tr.textContent = '翻译中…'
  }
}

function wrapOriginal(it: Item) {
  if (it.orig) return
  const wrap = document.createElement('cn-orig')
  wrap.style.setProperty('display', 'none', 'important')
  for (const n of Array.from(it.el.childNodes)) if (n !== it.tr) wrap.appendChild(n)
  it.el.insertBefore(wrap, it.tr)
  it.orig = wrap
}

function unwrapOriginal(it: Item) {
  if (!it.orig) return
  const wrap = it.orig
  it.orig = null
  while (wrap.firstChild) wrap.parentNode?.insertBefore(wrap.firstChild, wrap)
  wrap.remove()
}

function enqueue(it: Item) {
  if (!on || it.status === 'queued' || it.status === 'sent' || it.status === 'done') return
  it.status = 'queued'
  it.error = undefined
  render(it)
  queue.push(it)
  clearTimeout(flushTimer)
  flushTimer = setTimeout(flush, 60)
  report()
}

/** 排着的段按网页里的顺序分批发出去：第一批小一点，先出字 */
function flush() {
  if (!on) return
  const list = queue.filter((it) => it.status === 'queued' && it.el.isConnected)
  queue = []
  list.sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
  while (list.length) {
    const cap = sentChars === 0 ? 600 : 1200
    const batch: Item[] = []
    let chars = 0
    while (list.length && batch.length < 12 && (batch.length === 0 || chars + list[0]!.text.length <= cap)) {
      const it = list.shift()!
      chars += it.text.length
      batch.push(it)
    }
    sentChars += chars
    for (const it of batch) it.status = 'sent'
    callPlugin(ID, 'translate', { items: batch.map((it) => ({ id: it.id, text: it.text })), target }).catch((e: Error) => {
      const error: TrError = { code: 'other', raw: String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }
      for (const it of batch) {
        if (items.get(it.id) !== it || it.status !== 'sent') continue
        fail(it, error)
      }
      report()
    })
  }
}

function fail(it: Item, error: TrError) {
  it.status = 'error'
  it.error = error
  lastError = error
  render(it)
  if (error.code === 'rate-limit') scheduleRetry()
}

/** 问得太快：30 秒后自动把这类没翻成的再翻一遍，不用点 */
function scheduleRetry() {
  if (retryTimer) return
  retryAt = Date.now() + RATE_RETRY_MS
  retryTimer = setTimeout(() => {
    retryTimer = undefined
    retryAt = undefined
    for (const it of items.values()) if (it.status === 'error' && it.error?.code === 'rate-limit') (it.status = 'wait'), enqueue(it)
    report()
  }, RATE_RETRY_MS)
}

onPageEvent(ID, 'result', (p) => {
  const { id, text, error } = (p ?? {}) as { id?: number; text?: string | null; error?: TrError }
  const it = typeof id === 'number' ? items.get(id) : undefined
  if (!on || !it || it.status === 'done') return
  if (typeof text === 'string' && text.trim()) {
    it.status = 'done'
    // 和原文一样（本来就是目标语言）：不插
    if (norm(text) === it.text) {
      it.tr?.remove()
      it.tr = null
    } else {
      it.result = text.trim()
      render(it)
    }
  } else fail(it, error ?? { code: 'other', raw: '没翻成' })
  report()
})

let reportTimer: ReturnType<typeof setTimeout> | undefined
function report() {
  clearTimeout(reportTimer)
  reportTimer = setTimeout(() => {
    let done = 0
    let busy = 0
    let failed = 0
    for (const it of items.values()) {
      if (it.status === 'done') done++
      else if (it.status === 'queued' || it.status === 'sent') busy++
      else if (it.status === 'error') failed++
    }
    // 没翻成的段都重试好了：原因也收起来
    if (!failed) lastError = undefined
    const st: TrPageState = {
      on,
      target,
      pageLang,
      done,
      busy,
      failed,
      menuSeq,
      pdfSeq,
      ...(isPdf() ? { pdf: true } : {}),
      ...(lastError ? { error: lastError } : {}),
      ...(blocked ? { blocked } : {}),
      ...(retryAt ? { retryAt } : {}),
    }
    tellHost(ID, st)
  }, 80)
}

// ---------------------------------------------------------------- 开、关

/** 浏览器自己的 PDF 查看器：网页翻译翻不了，叫人去 PDF 阅读器 */
const isPdf = () => document.contentType === 'application/pdf' || !!document.querySelector('body > embed[type="application/pdf"]:only-child')

/** 刚载入的网页：插件开关和设置还在从主进程来的路上，等它到 */
function stateReady(): Promise<void> {
  if (pluginState(ID)) return Promise.resolve()
  return new Promise((r) => {
    const off = onPluginState(() => {
      off()
      r()
    })
  })
}

async function start() {
  if (on || starting || !document.body) return
  starting = true
  await stateReady()
  starting = false
  if (on || !pluginEnabled(ID)) return
  if (isPdf()) {
    pdfSeq++
    return report()
  }
  starting = true
  try {
    // 先查有没有能用的：没有就不往段落里写任何字，界面打开菜单说原因
    const pre = await callPlugin<{ ok: true } | { ok: false; error: TrError }>(ID, 'preflight').catch((e: Error) => ({ ok: false as const, error: { code: 'other' as const, raw: String(e.message) } }))
    const s = settings()
    lastSettings = JSON.stringify(s)
    pageLang = detectLang(norm(document.body.innerText.slice(0, 6000)), htmlLang())
    target = effectiveTarget(s.target, pageLang)
    display = s.display
    style = s.style
    on = true
    lastError = undefined
    if (!pre.ok) {
      blocked = pre.error
      menuSeq++
      return report()
    }
    blocked = undefined
    sentChars = 0
    ensureStyle(document)
    io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          io?.unobserve(e.target)
          const it = byEl.get(e.target)
          if (it && it.status === 'wait') enqueue(it)
        }
      },
      { rootMargin: '240px 0px' },
    )
    // 后来才出来的段落（无限滚动、点开的折叠、单页应用后画的、换路由），shadow DOM 和 iframe 里的也看（watchRoot 加进来）
    mo = new MutationObserver((muts) => {
      const ours = (m: MutationRecord) =>
        m.type === 'characterData'
          ? !!m.target.parentElement?.closest('cn-tr, cn-orig')
          : !!(m.target as Element).closest?.('cn-tr, cn-orig') || Array.from(m.addedNodes).every((n) => n.nodeName === 'CN-TR' || n.nodeName === 'CN-ORIG' || (n.nodeType !== Node.ELEMENT_NODE && n.nodeType !== Node.TEXT_NODE))
      if (muts.every(ours)) return
      clearTimeout(rescanTimer)
      rescanTimer = setTimeout(() => (scan(), sweep()), 500)
    })
    mo.observe(document.body, { childList: true, subtree: true, characterData: true })
    watched = new WeakSet([document])
    scan()
    sweep()
    report()
  } finally {
    starting = false
  }
}

function restore() {
  if (!on) return
  on = false
  blocked = undefined
  lastError = undefined
  retryAt = undefined
  clearTimeout(retryTimer)
  retryTimer = undefined
  clearTimeout(flushTimer)
  clearTimeout(rescanTimer)
  io?.disconnect()
  mo?.disconnect()
  io = mo = null
  dropStyles()
  queue = []
  for (const it of items.values()) {
    setFade(it, false)
    unwrapOriginal(it)
    it.tr?.remove()
  }
  items.clear()
  byEl = new WeakMap()
  shown.clear()
  void callPlugin(ID, 'cancel').catch(() => undefined)
  report()
}

const toggle = () => (on ? restore() : void start())

/** 全部重试：一开就不能用的从头再开；没翻成的段再翻 */
function retryAll() {
  if (!on) return void start()
  if (blocked) {
    restore()
    return void start()
  }
  for (const it of items.values()) if (it.status === 'error') (it.status = 'wait'), enqueue(it)
  report()
}

onHostCommand(ID, (cmd) => {
  if (cmd === 'toggle') toggle()
  else if (cmd === 'on') void start()
  else if (cmd === 'off') restore()
  else if (cmd === 'retryAll') retryAll()
  else if (cmd === 'retryIfBlocked') {
    // 设置里刚填好 Key、换了引擎：一开就不能用的这一页再查一次
    if (on && blocked) retryAll()
  }
  else if (cmd === 'revealAll') {
    for (const it of items.values()) {
      if (it.status !== 'done' || !it.tr) continue
      shown.add(it.id)
      it.tr.setAttribute('data-shown', '')
    }
  } else if (cmd === 'report') report()
})

// 设置变了：关掉插件就恢复原文；换了目标语言重翻；换了显示方式、样式重画；换了引擎、改了 Key 后一开就不能用的再查一次
onPluginState(() => {
  if (!on) return
  if (!pluginEnabled(ID)) return restore()
  const s = settings()
  const key = JSON.stringify(s)
  if (key === lastSettings) return
  const prev = JSON.parse(lastSettings) as typeof s
  lastSettings = key
  if (s.target !== prev.target || (blocked && (s.engineMode !== prev.engineMode || s.pick !== prev.pick || s.engineOrder.join() !== prev.engineOrder.join()))) {
    restore()
    void start()
  } else {
    display = s.display
    style = s.style
    for (const it of items.values()) if (it.status === 'done' && it.tr) render(it)
  }
})

function editable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
}

// 双语翻译的键（命令表，默认 ⌥A，设置里能改）：开 / 关双语（在输入框里不管，那里 ⌥A 是打字）
window.addEventListener(
  'keydown',
  (e) => {
    // 插件状态还没到（网页刚载入）时先接着，start() 会等它到了再看开没开
    if (!isPageKey(e, 'translate') || (pluginState(ID) && !pluginEnabled(ID)) || editable(e.target)) return
    e.preventDefault()
    e.stopImmediatePropagation()
    toggle()
  },
  true,
)

document.addEventListener('DOMContentLoaded', report)

// ---------------------------------------------------------------- 剪藏带不带译文

/**
 * 整页剪藏前改剪下来的那份（clone，不动网页）：「只看译文」时藏起来的原文放回来（原文是出处，不丢）；
 * 开关关着：译文都拿掉；开着：翻好的段原文后面跟一段引用（列表项里的跟在项里，表格里的不带），没翻好的只留原文。
 */
export function prepareClip(doc: Document) {
  for (const o of Array.from(doc.querySelectorAll('cn-orig'))) o.replaceWith(...Array.from(o.childNodes))
  const withTr = pluginEnabled(ID) && settings().clipWithTranslation
  for (const t of Array.from(doc.querySelectorAll('cn-tr'))) {
    const text = norm(t.textContent ?? '')
    const host = t.parentElement
    t.remove()
    if (!withTr || t.hasAttribute('data-st') || !text || !host) continue
    if (/^(TD|TH|CAPTION)$/.test(host.tagName)) continue
    const q = doc.createElement('blockquote')
    q.textContent = text
    if (host.tagName === 'LI' || host.tagName === 'DD' || host.tagName === 'DT') host.appendChild(q)
    else host.after(q)
  }
  for (const el of Array.from(doc.querySelectorAll('[data-cn-fade]'))) el.removeAttribute('data-cn-fade')
}

/** 剪的时候带不带夹着的译文（「整页剪藏带上译文」）：关着时选区里的译文去掉，只留原文（webview-md 的 rangeToMd 跳过 cn-tr） */
export const clipKeepsTranslation = () => pluginEnabled(ID) && settings().clipWithTranslation

// ---------------------------------------------------------------- 选中一段翻译

let card: { host: HTMLDivElement; body: HTMLDivElement; head: HTMLSpanElement; copy: HTMLButtonElement } | null = null
let cardSeq = 0

function ensureCard() {
  if (card) return card
  const host = document.createElement('div')
  host.id = 'cn-tr-card'
  host.style.cssText = 'position:absolute;z-index:2147483647;left:0;top:0;display:none'
  const root = host.attachShadow({ mode: 'open' })
  root.innerHTML = `<style>
    .card{box-sizing:border-box;width:min(360px,calc(100vw - 16px));padding:12px 14px 10px;border-radius:12px;background:#fff;color:#111113;
      font:400 14px/1.65 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;text-align:left;
      box-shadow:0 0 0 1px rgba(17,17,19,.08),0 2px 6px rgba(17,17,19,.06),0 24px 56px -12px rgba(17,17,19,.22)}
    .head{display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:12px;line-height:1.5;color:#a1a1a6}
    .head span{flex:1}
    button{border:0;background:none;color:#6e6e73;font:500 12px/1 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;cursor:pointer;border-radius:999px;height:24px;padding:0 9px}
    button:hover{background:rgba(17,17,19,.06);color:#111113}
    .x{width:24px;padding:0;font-size:15px;font-weight:400}
    .body{white-space:pre-wrap;word-break:break-word;max-height:260px;overflow:auto}
    .body.wait{color:#a1a1a6}
    .foot{display:flex;justify-content:flex-end;margin-top:6px}
  </style><div class="card" role="dialog" aria-label="译文"><div class="head"><span></span><button class="x" aria-label="关上">×</button></div><div class="body"></div><div class="foot"><button class="copy">拷贝译文</button></div></div>`
  const head = root.querySelector('.head span') as HTMLSpanElement
  const body = root.querySelector('.body') as HTMLDivElement
  const copy = root.querySelector('.copy') as HTMLButtonElement
  for (const b of Array.from(root.querySelectorAll('button'))) b.addEventListener('mousedown', (e) => e.preventDefault())
  root.querySelector('.x')!.addEventListener('click', hideCard)
  copy.addEventListener('click', () => {
    void navigator.clipboard.writeText(body.textContent ?? '').then(() => (copy.textContent = '已拷贝'))
  })
  document.documentElement.appendChild(host)
  card = { host, body, head, copy }
  return card
}

function hideCard() {
  cardSeq++
  if (card) card.host.style.display = 'none'
}

document.addEventListener(
  'mousedown',
  (e) => {
    if (card && card.host.style.display !== 'none' && !e.composedPath().includes(card.host)) hideCard()
  },
  true,
)
window.addEventListener('keydown', (e) => e.key === 'Escape' && hideCard(), true)

/** 选区小条「⋯ › 只看译文」：选区下面弹译文小卡片（放不下就放上面），不问 AI 讲 */
export function translateSelection(text: string, rect: DOMRect) {
  const c = ensureCard()
  const to = effectiveTarget(settings().target, detectLang(text, htmlLang()))
  const my = ++cardSeq
  c.head.textContent = `译文 · ${langName(to)}`
  c.body.textContent = '翻译中…'
  c.body.className = 'body wait'
  c.copy.textContent = '拷贝译文'
  c.copy.style.display = 'none'
  c.host.style.display = 'block'
  const w = Math.min(360, innerWidth - 16)
  const left = Math.max(8, Math.min(rect.left, innerWidth - w - 8)) + scrollX
  const below = rect.bottom + 8
  const top = (below + 140 > innerHeight && rect.top > 160 ? rect.top - 8 - c.host.getBoundingClientRect().height : below) + scrollY
  c.host.style.transform = `translate(${left}px, ${Math.max(scrollY + 4, top)}px)`
  callPlugin<string>(ID, 'selection', { text, target: to }).then(
    (out) => {
      if (my !== cardSeq) return
      c.body.textContent = out
      c.body.className = 'body'
      c.copy.style.display = ''
    },
    (e: Error) => {
      if (my !== cardSeq) return
      c.body.textContent = `没翻成：${String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`
      c.body.className = 'body wait'
    },
  )
}
