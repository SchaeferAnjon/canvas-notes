/**
 * 右栏网页预加载（隔离环境，网页碰不到）里「读到哪」的两件事（task-kbnc0，长期一起看的网页和笔记）：
 * 1. 量读到哪：人滚了网页（滚轮、按键、按着拖）停手 0.4 秒后，告诉界面读的那一行（窗口高的 18% 处，固定的头一般比它矮）上是哪一段：
 *    那段的开头一句和前后各 32 个字、那段上面的小标题、滚到了几成（shared/read-anchor.ts）。网页载完也报一次（「land」），
 *    界面按是不是人点链接翻过来的决定记不记（软件自己开的、重开软件恢复的不记）。
 * 2. 回到那段：界面给一段的记法，先按字找（网页可能还在长，3 秒里找几次），找到就让它停在读的那一行、亮 1.6 秒；
 *    找不到（网页改了版）按上次的滚动比例停，告诉界面「没找到」，界面在网页上面浮一句。
 *    回到选中的那几句（task-6cxtc，笔记里点「↩」、右栏「笔记」里点一条）：quote 给了就在每一段里面找那几句（findQuote），只亮那几句。
 * 只在 http(s) 网页里做（新网页标签那一页不做）。
 */
import { ipcRenderer } from 'electron'
import { anchorAt, findAnchor, findQuote } from '../shared/read-anchor'
import type { PagePos } from '../shared/read-along'
import { blocks, charsOf, HEAD, mainScroller, rangeOf, scrollerOf, setLastScroller, textOf, topCover } from './webview-blocks'
import { flashRange } from './webview-marks'
import { tagMathJax } from './webview-mathjax'

/** 读的那一行在窗口高的几成处 */
const LINE = 0.18
/** 回到那段时，段落顶边停在读的那一行上面这么多 */
const ABOVE = 8

type Kind = 'scroll' | 'land' | 'now'

const isPage = /^https?:$/.test(location.protocol)

/** 读的那一行上（或刚在它下面）的那一段；几栏并排时挑最宽的 */
function readingIndex(els: HTMLElement[]): number {
  const y = innerHeight * LINE
  let at = -1
  let width = 0
  for (let i = 0; i < els.length; i++) {
    const r = els[i]!.getBoundingClientRect()
    if (r.bottom <= y || r.top >= innerHeight || r.width === 0) continue
    // 已经找到了跨着这一行的，后面整段在这一行下面的不比
    if (at >= 0 && r.top > y) break
    if (r.width > width) ((at = i), (width = r.width))
  }
  return at
}

function ratioOf(sc: Element): number {
  const max = sc.scrollHeight - sc.clientHeight
  return max > 0 ? Math.min(1, Math.max(0, sc.scrollTop / max)) : 0
}

function measure(): PagePos | null {
  const sc = mainScroller()
  const els = blocks(sc)
  const i = readingIndex(els)
  if (i < 0) return null
  const texts = els.map(textOf)
  let head: string | undefined
  for (let j = i; j >= 0; j--) if (HEAD.test(els[j]!.tagName)) ((head = texts[j]), (j = -1))
  return { url: location.href, ...anchorAt(texts, i), ratio: ratioOf(sc), ...(head ? { head } : {}), title: document.title }
}

function report(kind: Kind) {
  const pos = measure()
  if (pos) ipcRenderer.sendToHost('cn:readpos', { ...pos, kind })
}

// ---------------------------------------------------------------- 人在动网页吗

let userAt = 0
let down = false
/** 软件自己滚的（回到那段、按比例停）：这一会儿里的滚动不算人读的 */
let selfUntil = 0
let touchAt = 0
const mark = () => (userAt = Date.now())
/** 人在这个网页里按了键、按了鼠标（点链接翻页前）：告诉界面，下一页载完算人翻过来的（最多半秒报一次） */
function touched() {
  mark()
  if (Date.now() - touchAt < 500) return
  touchAt = Date.now()
  ipcRenderer.sendToHost('cn:readpos:touch')
}
const byUser = () => (down || Date.now() - userAt < 1500) && Date.now() > selfUntil

// ---------------------------------------------------------------- 回到那段

/**
 * 滚到让这一段停在读的那一行上；给了 range（回到选中的那几句，task-6cxtc）是那几句的第一行，
 * 这时还要让开网页钉着的头（d2l 那种顶上一条），那几句整个露着
 */
function bring(el: HTMLElement, range?: Range | null) {
  selfUntil = Date.now() + 700
  // 那几句的第一行比段落顶边低多少（长段落中间的一句，停在读的那一行上的是这一句）
  const first = range?.getClientRects()[0]
  const dy = first ? Math.max(0, first.top - el.getBoundingClientRect().top) : 0
  el.scrollIntoView({ block: 'start', behavior: 'instant' })
  const sc = scrollerOf(el)
  const line = range ? Math.max(innerHeight * LINE - ABOVE, topCover() + 16) : innerHeight * LINE - ABOVE
  const off = el.getBoundingClientRect().top + dy - line
  if (sc === document.scrollingElement) window.scrollBy({ top: off, behavior: 'instant' })
  else sc.scrollTop += off
  setLastScroller(sc)
}

/** 那一段亮 1.6 秒（界面给的颜色：主题强调色的淡底），然后 0.4 秒淡掉；网页自己的样式原样放回 */
function flash(el: HTMLElement, color: string) {
  const s = el.style
  const was = { bg: s.backgroundColor, tr: s.transition, radius: s.borderRadius }
  s.transition = 'none'
  s.backgroundColor = color
  if (!was.radius) s.borderRadius = '3px'
  el.setAttribute('data-cn-flash', '')
  setTimeout(() => {
    s.transition = 'background-color .4s'
    s.backgroundColor = was.bg
    el.removeAttribute('data-cn-flash')
    setTimeout(() => {
      s.transition = was.tr
      s.borderRadius = was.radius
    }, 450)
  }, 1600)
}

interface GotoReq {
  id: number
  pos: PagePos
  /** 亮一下用的颜色；null 是不亮（重开软件时恢复的标签） */
  flash: string | null
  /** 从头读：滚到最上面 */
  top?: boolean
  /** 回到选中的那几句（笔记里的「↩」）：在每一段里面找，只亮那几句；pos.text 是链接里那段开头，quote 是笔记里引着的全文 */
  quote?: string
}

/** 那几句在哪：先按笔记里引着的全文找，再按链接里那段开头找 */
function findSpan(els: HTMLElement[], req: GotoReq): { el: HTMLElement; range: Range | null; how: 'exact' | 'fuzzy' } | null {
  const chars = els.map(charsOf)
  const texts = chars.map((c) => c.text)
  for (const q of [req.quote ?? '', req.pos.text]) {
    if (!q.trim()) continue
    const hit = findQuote(texts, q)
    if (hit) return { el: els[hit.index]!, range: rangeOf(chars[hit.index]!, hit.start, hit.end), how: hit.how }
  }
  return null
}

function goto(req: GotoReq, tries = 0) {
  const sc = mainScroller()
  if (req.top) {
    selfUntil = Date.now() + 700
    if (sc === document.scrollingElement) window.scrollTo({ top: 0, behavior: 'instant' })
    else sc.scrollTop = 0
    return ipcRenderer.sendToHost('cn:readpos:went', { id: req.id, how: 'top' })
  }
  // 引着的原文里的公式是 `$…$`：先把 MathJax 3 公式的原文记到容器上再找
  if (req.quote !== undefined && tries === 0) return void tagMathJax().then(() => goto(req, 1))
  if (req.quote !== undefined) {
    // 选中的那几句可能在正文以外的一块（侧栏、页脚）：整页找
    const span = findSpan(blocks(document.scrollingElement ?? document.documentElement), req)
    if (span) {
      bring(span.el, span.range)
      if (req.flash) {
        if (span.range) flashRange(span.range, req.flash)
        else flash(span.el, req.flash)
      }
      return ipcRenderer.sendToHost('cn:readpos:went', { id: req.id, how: span.how })
    }
  } else {
    const els = blocks(sc)
    const hit = findAnchor(els.map(textOf), req.pos)
    if (hit) {
      const el = els[hit.index]!
      bring(el)
      if (req.flash) flash(el, req.flash)
      return ipcRenderer.sendToHost('cn:readpos:went', { id: req.id, how: hit.how })
    }
  }
  // 网页还在长（脚本后加载的正文）：3 秒里再找几次
  if (tries < 12) return void setTimeout(() => goto(req, tries + 1), 250)
  // 找不到：按上次滚到的几成停在差不多的地方
  selfUntil = Date.now() + 700
  const max = sc.scrollHeight - sc.clientHeight
  if (sc === document.scrollingElement) window.scrollTo({ top: req.pos.ratio * max, behavior: 'instant' })
  else sc.scrollTop = req.pos.ratio * max
  ipcRenderer.sendToHost('cn:readpos:went', { id: req.id, how: 'ratio' })
}

if (isPage) {
  window.addEventListener('wheel', mark, { capture: true, passive: true })
  window.addEventListener('touchstart', mark, { capture: true, passive: true })
  window.addEventListener('keydown', touched, true)
  window.addEventListener(
    'pointerdown',
    () => {
      down = true
      touched()
    },
    true,
  )
  window.addEventListener(
    'pointerup',
    () => {
      down = false
      mark()
    },
    true,
  )
  let timer: ReturnType<typeof setTimeout> | undefined
  window.addEventListener(
    'scroll',
    (e) => {
      if (!byUser()) return
      const t = e.target
      if (t === document) setLastScroller(document.scrollingElement ?? document.documentElement)
      else if (t instanceof Element) setLastScroller(t)
      clearTimeout(timer)
      timer = setTimeout(() => report('scroll'), 400)
    },
    { capture: true, passive: true },
  )
  const land = () => setTimeout(() => report('land'), 300)
  if (document.readyState === 'complete') land()
  else window.addEventListener('load', land, { once: true })
  ipcRenderer.on('cn:readpos:goto', (_e, req: GotoReq) => {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => goto(req), { once: true })
    else goto(req)
  })
  ipcRenderer.on('cn:readpos:now', () => report('now'))
}
