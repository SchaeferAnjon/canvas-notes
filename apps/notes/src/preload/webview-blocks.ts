/**
 * 右栏网页预加载里：网页正文一块块的字（段落、列表项、代码、引文、小标题）和它们在哪一块里滚。
 * 「读到哪」（webview-readpos.ts）、网页上做记号和回到选中的那几句（webview-marks.ts，task-6cxtc）共用。
 */
import { normText } from '../shared/read-anchor'
import { cleanHead } from '../shared/read-along'
import { mathMd, mathRoot, mj2Script } from './webview-md'

const BLOCKS = 'p, li, pre, blockquote, dd, dt, figcaption, h1, h2, h3, h4, h5, h6'
/** 单独一行的公式：MathJax 3、MathJax 2、KaTeX */
const DISPLAY_MATH = 'mjx-container[display="true"], .MathJax_Display, .katex-display'
export const HEAD = /^H[1-6]$/

export const textOf = (el: Element) => (HEAD.test(el.tagName) ? cleanHead(el.textContent ?? '') : normText(el.textContent ?? ''))

/** 能滚的那一块：自己是不是（overflow 能滚、内容比框高） */
function scrolls(el: Element): boolean {
  if (el === document.scrollingElement) return el.scrollHeight > el.clientHeight + 4
  const oy = getComputedStyle(el).overflowY
  return (oy === 'auto' || oy === 'scroll' || oy === 'overlay') && el.scrollHeight > el.clientHeight + 4
}

/** 这一段在哪一块里滚：最近的能滚的祖先，没有就是整页 */
export function scrollerOf(el: Element): Element {
  for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) if (scrolls(p)) return p
  return document.scrollingElement ?? document.documentElement
}

/** 人上次滚的那一块（读到哪记下的） */
let lastScroller: Element | null = null
export const setLastScroller = (el: Element | null) => void (lastScroller = el)

/** 正文滚的那一块：人上次滚的那一块；没滚过时挑看得见的面积最大的能滚的那一块（zh.d2l.ai 是正文区，不是整页） */
export function mainScroller(): Element {
  if (lastScroller?.isConnected && scrolls(lastScroller)) return lastScroller
  const root = document.scrollingElement ?? document.documentElement
  let best: Element = root
  let area = scrolls(root) ? innerWidth * innerHeight : 0
  for (const el of document.querySelectorAll('main, article, section, div')) {
    if (el.clientHeight < innerHeight * 0.5 || el.clientWidth < innerWidth * 0.4 || !scrolls(el)) continue
    const r = el.getBoundingClientRect()
    const a = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0))
    if (a > area) ((best = el), (area = a))
  }
  return best
}

/** 钉在窗口上的（固定的头、侧栏目录）：它们里面的段落不算读到的地方 */
function pinned(el: Element, memo: Map<Element, boolean>): boolean {
  const seen: Element[] = []
  let p: Element | null = el
  let hit = false
  while (p && p !== document.body) {
    const m = memo.get(p)
    if (m !== undefined) {
      hit = m
      break
    }
    seen.push(p)
    const pos = getComputedStyle(p).position
    if (pos === 'fixed' || pos === 'sticky') {
      hit = true
      break
    }
    p = p.parentElement
  }
  for (const s of seen) memo.set(s, hit)
  return hit
}

/** 软件自己画在网页上的几层（小条、框、小标）：量网页的时候跳过 */
const OURS = '#cn-clip-host, #cn-box-host, #cn-mark-host'

/**
 * 窗口顶上被网页钉着的头（fixed、sticky，d2l 那条蓝头）盖住多高：沿中间那一列从上往下看，到不是钉着的东西为止（最多看到窗口高的一半）。
 * 回到选中的那几句时让开它（task-6cxtc），小标、点线、亮一下也只画在它下面
 */
export function topCover(): number {
  const memo = new Map<Element, boolean>()
  const x = innerWidth / 2
  // 正文在自己滚的一个框里、头是框外面不跟着滚的一行（不是钉着的）：框的上沿以上看不到正文
  const sc = mainScroller()
  let y = sc === document.scrollingElement ? 0 : Math.min(innerHeight / 2, Math.max(0, sc.getBoundingClientRect().top))
  for (let k = 0; k < 20 && y < innerHeight / 2; k++) {
    const hit = document.elementsFromPoint(x, y + 1).find((e) => !e.closest(OURS))
    if (!hit || hit === document.documentElement || hit === document.body || !pinned(hit, memo)) break
    // 钉着的那一层：一路往上找到钉着的那个元素，量它的下沿
    let p: Element = hit
    while (p.parentElement && p.parentElement !== document.body && memo.get(p.parentElement)) p = p.parentElement
    y = Math.max(y + 1, p.getBoundingClientRect().bottom)
  }
  return Math.round(y)
}

/** 正文里一块块的字（按先后）：段落、列表项、代码、引文、小标题；套着里层段落的、藏着的、钉在窗口上的、软件自己画的不算 */
export function blocks(sc: Element): HTMLElement[] {
  const memo = new Map<Element, boolean>()
  const root = sc === document.scrollingElement ? document.body : sc
  if (!root) return []
  return [...root.querySelectorAll<HTMLElement>(`${BLOCKS}, ${DISPLAY_MATH}`)].filter((el) => {
    if (el.closest('#cn-clip-host, #cn-box-host, #cn-mark-host')) return false
    // 单独一行的公式（d2l 的 div.math 里那个）自成一块；套在段落、列表项里的算那一段的
    if (el.matches(DISPLAY_MATH)) return mathRoot(el) === el && !el.parentElement?.closest(BLOCKS) && el.getClientRects().length > 0 && !pinned(el, memo)
    if (el.tagName !== 'PRE' && !HEAD.test(el.tagName) && el.querySelector('p, li, pre')) return false
    if (el.tagName !== 'PRE' && el.closest('pre')) return false
    if (!el.getClientRects().length) return false
    if (textOf(el).length < 2) return false
    return !pinned(el, memo)
  })
}

/**
 * 一块里的字（空白并成一个，软件夹进去的译文 cn-tr 不算）和每个字在哪：文字节点的第几个字，或者是哪个公式。
 * 公式整个写成和文件里一样的 `$…$` / `$$ … $$`（webview-md 的 mathMd），和小条交给软件的「这段字」、文件里引着的原文对得上；
 * 公式里藏着的 MathML、MathJax 2 的原文 script、Sphinx 的式号（写进了 \tag）不再单算
 */
export interface Chars {
  text: string
  at: [Text | Element, number][]
}

export function charsOf(el: Element): Chars {
  const at: [Text | Element, number][] = []
  let text = ''
  let space = true
  const feed = (t: string, where: (i: number) => [Text | Element, number]) => {
    for (let i = 0; i < t.length; i++) {
      let ch = t[i]!
      if (/\s/.test(ch)) {
        if (space) continue
        space = true
        ch = ' '
      } else space = false
      text += ch
      at.push(where(i))
    }
  }
  const done = new Set<Element>()
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) return feed((n as Text).data, (i) => [n as Text, i])
    if (n.nodeType !== Node.ELEMENT_NODE) return
    const e = n as Element
    if (done.has(e) || e.tagName === 'CN-TR' || e.tagName === 'STYLE' || e.classList.contains('eqno')) return
    const root = e.tagName === 'SCRIPT' ? (/^math\/tex/i.test((e as HTMLScriptElement).type) ? e : null) : mathRoot(e)
    if (root) {
      const s = mj2Script(root)
      if (s) done.add(s)
      return feed(mathMd(root), () => [root, 0])
    }
    if (e.tagName === 'SCRIPT') return
    for (const c of Array.from(e.childNodes)) walk(c)
  }
  walk(el)
  return { text, at }
}

/** 这一块的第 start 到 end 个字在网页里是哪一段（Range）；两头落在公式上时整个公式算进去 */
export function rangeOf(c: Chars, start: number, end: number): Range | null {
  const a = c.at[start]
  const b = c.at[Math.min(end, c.at.length) - 1]
  if (!a || !b) return null
  const r = document.createRange()
  if (a[0] instanceof Text) r.setStart(a[0], a[1])
  else r.setStartBefore(a[0])
  if (b[0] instanceof Text) r.setEnd(b[0], b[1] + 1)
  else r.setEndAfter(b[0])
  return r
}
