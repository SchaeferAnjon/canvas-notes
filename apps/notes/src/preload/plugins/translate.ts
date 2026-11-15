/**
 * 双语翻译网页这半（webview 预加载的隔离环境，网页脚本碰不到）：
 * - 开：认出正文段落（p、li、h1–h6、blockquote、td……，跳过代码、导航、按钮），只翻看得见的，滚到哪翻到哪；
 *   每段下面插一行淡一点的译文（或者「只看译文」把原文藏起来），没回来之前是「翻译中…」。
 * - 再按一次：译文全拿掉，原文原样放回。
 * - 选中一段点「翻译」：选区下面弹一张小卡片显示译文（不抢焦点）。
 * 段落一批批交给主进程（main/plugins/translate），翻好一段回来一段。
 */
import { type Display, detectLang, effectiveTarget, langName, normalizeTranslate, sameLang } from '../../shared/plugins/translate'
import { callPlugin, onHostCommand, onPageEvent, onPluginState, pluginEnabled, pluginState, tellHost } from './state'

const ID = 'translate'
/** 当一段来翻的元素 */
const BLOCKS = 'p,li,h1,h2,h3,h4,h5,h6,blockquote,td,th,dd,dt,figcaption,summary,caption'
/** 里面有这些的不算「一段」（翻它里面那几段） */
const INNER = BLOCKS + ',div,ul,ol,table,section,article,aside,header,footer,main,form,figure,details,pre'
/** 这些里面的不翻：代码、导航、按钮、输入框、我们自己插的 */
const SKIP =
  'pre,code,kbd,samp,var,script,style,noscript,template,textarea,input,select,option,button,nav,svg,math,' +
  '[role="navigation"],[role="button"],[role="menu"],[role="menubar"],[role="toolbar"],[role="tablist"],[role="search"],' +
  '[contenteditable=""],[contenteditable="true"],[aria-hidden="true"],[translate="no"],.notranslate,.mw-editsection,' +
  'cn-tr,cn-orig,#cn-clip-host,#cn-tr-card'

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
  anim?: Animation
}

let on = false
let target = 'zh-CN'
let display: Display = 'below'
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

/** 这个元素算不算「一段」，算的话给它的字 */
function paragraphText(el: HTMLElement): string | null {
  if (el.closest(SKIP)) return null
  if (el.tagName === 'DIV') {
    // 没用 p 的网站：div 里直接是一段字，里面没有别的块
    const direct = Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && norm(n.textContent ?? '').length >= 10)
    if (!direct || el.querySelector(INNER)) return null
  } else if (el.querySelector(BLOCKS)) return null
  const text = norm(el.innerText || '')
  if (text.length < 2 || !/\p{L}/u.test(text)) return null
  // 全是链接的短行（菜单、目录、标签）不翻
  if (!/^H[1-6]$/.test(el.tagName) && text.length < 50) {
    const linkText = norm(Array.from(el.querySelectorAll('a'), (a) => a.innerText).join(' '))
    if (linkText && linkText.length >= text.length - 2) return null
  }
  if (sameLang(detectLang(text, htmlLang()), target)) return null
  return text
}

function scan(root: ParentNode = document.body) {
  if (!on || !io || !root) return
  const els = root.querySelectorAll<HTMLElement>(BLOCKS + ',div')
  for (const el of Array.from(els)) {
    if (byEl.has(el)) continue
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
  const bottom = innerHeight + 240
  for (const it of items.values()) {
    if (it.status !== 'wait') continue
    const r = it.el.getBoundingClientRect()
    if (r.height > 0 && r.bottom >= top && r.top <= bottom) enqueue(it)
  }
}

let sweepTimer: ReturnType<typeof setTimeout> | undefined
window.addEventListener(
  'scroll',
  () => {
    if (!on || sweepTimer) return
    sweepTimer = setTimeout(() => {
      sweepTimer = undefined
      sweep()
    }, 150)
  },
  true,
)

function css(el: HTMLElement, props: Record<string, string>) {
  for (const [k, v] of Object.entries(props)) el.style.setProperty(k, v, 'important')
}

function trOf(it: Item): HTMLElement {
  if (!it.tr || !it.tr.isConnected) {
    it.tr = document.createElement('cn-tr')
    it.tr.setAttribute('translate', 'no')
    it.el.appendChild(it.tr)
  }
  return it.tr
}

const BASE = { display: 'block', margin: '0.3em 0 0', padding: '0', 'white-space': 'normal', 'font-style': 'normal', 'text-decoration': 'none', cursor: 'auto' }

function render(it: Item) {
  it.anim?.cancel()
  it.anim = undefined
  const tr = trOf(it)
  tr.onclick = null
  if (it.status === 'done') {
    tr.textContent = it.result ?? ''
    if (display === 'only') {
      wrapOriginal(it)
      css(tr, { ...BASE, margin: '0', opacity: '1', 'font-size': 'inherit' })
    } else {
      unwrapOriginal(it)
      css(tr, { ...BASE, opacity: '0.72', 'font-size': 'inherit' })
    }
  } else if (it.status === 'error') {
    unwrapOriginal(it)
    tr.textContent = '没翻成 · 点这里重试'
    css(tr, { ...BASE, opacity: '0.5', 'font-size': '0.85em', cursor: 'pointer' })
    tr.onclick = (e) => {
      e.preventDefault()
      e.stopPropagation()
      enqueue(it)
    }
  } else {
    tr.textContent = '翻译中…'
    css(tr, { ...BASE, opacity: '0.45', 'font-size': '0.85em' })
    it.anim = tr.animate([{ opacity: 0.25 }, { opacity: 0.55 }], { duration: 800, iterations: Infinity, direction: 'alternate' })
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
      for (const it of batch) {
        if (items.get(it.id) !== it || it.status !== 'sent') continue
        it.status = 'error'
        render(it)
      }
      console.warn('[canvas-notes] 翻译失败', e.message)
      report()
    })
  }
}

onPageEvent(ID, 'result', (p) => {
  const { id, text } = (p ?? {}) as { id?: number; text?: string | null }
  const it = typeof id === 'number' ? items.get(id) : undefined
  if (!on || !it || it.status === 'done') return
  if (typeof text === 'string' && text.trim()) {
    // 和原文一样（本来就是目标语言）：不插
    if (norm(text) === it.text) {
      it.status = 'done'
      it.anim?.cancel()
      it.tr?.remove()
      it.tr = null
    } else {
      it.status = 'done'
      it.result = text.trim()
      render(it)
    }
  } else {
    it.status = 'error'
    render(it)
  }
  report()
})

let reportTimer: ReturnType<typeof setTimeout> | undefined
function report() {
  clearTimeout(reportTimer)
  reportTimer = setTimeout(() => {
    let done = 0
    let busy = 0
    for (const it of items.values()) {
      if (it.status === 'done') done++
      else if (it.status === 'queued' || it.status === 'sent') busy++
    }
    tellHost(ID, { on, target, done, busy })
  }, 80)
}

function start() {
  if (on || !pluginEnabled(ID) || !document.body) return
  const s = normalizeTranslate(pluginState(ID)?.settings)
  lastSettings = JSON.stringify(s)
  target = effectiveTarget(s.target, detectLang(norm(document.body.innerText.slice(0, 6000)), htmlLang()))
  display = s.display
  on = true
  sentChars = 0
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
  scan()
  sweep()
  // 后来才出来的段落（无限滚动、点开的折叠）
  mo = new MutationObserver((muts) => {
    if (muts.every((m) => Array.from(m.addedNodes).every((n) => n.nodeName === 'CN-TR' || n.nodeName === 'CN-ORIG' || n.nodeType !== Node.ELEMENT_NODE))) return
    clearTimeout(rescanTimer)
    rescanTimer = setTimeout(() => (scan(), sweep()), 500)
  })
  mo.observe(document.body, { childList: true, subtree: true })
  report()
}

function restore() {
  if (!on) return
  on = false
  clearTimeout(flushTimer)
  clearTimeout(rescanTimer)
  io?.disconnect()
  mo?.disconnect()
  io = mo = null
  queue = []
  for (const it of items.values()) {
    it.anim?.cancel()
    unwrapOriginal(it)
    it.tr?.remove()
  }
  items.clear()
  byEl = new WeakMap()
  void callPlugin(ID, 'cancel').catch(() => undefined)
  report()
}

const toggle = () => (on ? restore() : start())

onHostCommand(ID, (cmd) => {
  if (cmd === 'toggle') toggle()
  else if (cmd === 'on') start()
  else if (cmd === 'off') restore()
})

// 设置变了：关掉插件就恢复原文；换了目标语言重翻；换了显示方式重排
onPluginState(() => {
  if (!on) return
  if (!pluginEnabled(ID)) return restore()
  const s = normalizeTranslate(pluginState(ID)?.settings)
  const key = JSON.stringify(s)
  if (key === lastSettings) return
  const prev = JSON.parse(lastSettings) as { target: string }
  lastSettings = key
  if (s.target !== prev.target) {
    restore()
    start()
  } else {
    display = s.display
    for (const it of items.values()) if (it.status === 'done') render(it)
  }
})

function editable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
}

// ⌥A：开 / 关双语（在输入框里不管，那里 ⌥A 是打字）
window.addEventListener(
  'keydown',
  (e) => {
    if (!e.altKey || e.metaKey || e.ctrlKey || e.shiftKey || e.code !== 'KeyA' || !pluginEnabled(ID) || editable(e.target)) return
    e.preventDefault()
    e.stopImmediatePropagation()
    toggle()
  },
  true,
)

document.addEventListener('DOMContentLoaded', report)

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
  </style><div class="card" role="dialog" aria-label="译文"><div class="head"><span></span><button class="x" aria-label="关上">×</button></div><div class="body"></div><div class="foot"><button class="copy">复制译文</button></div></div>`
  const head = root.querySelector('.head span') as HTMLSpanElement
  const body = root.querySelector('.body') as HTMLDivElement
  const copy = root.querySelector('.copy') as HTMLButtonElement
  for (const b of Array.from(root.querySelectorAll('button'))) b.addEventListener('mousedown', (e) => e.preventDefault())
  root.querySelector('.x')!.addEventListener('click', hideCard)
  copy.addEventListener('click', () => {
    void navigator.clipboard.writeText(body.textContent ?? '').then(() => (copy.textContent = '复制好了'))
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

/** 选区工具条上点了「翻译」：选区下面弹小卡片（放不下就放上面） */
export function translateSelection(text: string, rect: DOMRect) {
  const c = ensureCard()
  const s = normalizeTranslate(pluginState(ID)?.settings)
  const to = effectiveTarget(s.target, detectLang(text, htmlLang()))
  const my = ++cardSeq
  c.head.textContent = `译文 · ${langName(to)}`
  c.body.textContent = '翻译中…'
  c.body.className = 'body wait'
  c.copy.textContent = '复制译文'
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
