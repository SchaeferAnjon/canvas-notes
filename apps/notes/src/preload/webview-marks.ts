/**
 * 右栏网页预加载：网页上问过、剪过的那几段做记号（task-6cxtc，设计稿「建议：写进正在剪进去的那篇」图上 4、5）：
 * 段落左边一个小标（对话图标 + 这一段几条），那几句底下点线；点小标告诉界面（右栏「笔记」翻到那几条，中间那篇滚过去）。
 * 回到选中的那几句时只亮那几句（flashRange，1.6 秒后 0.4 秒淡掉）。
 * 都画在一个 shadow DOM 里，不改网页自己的字和样式；跟着网页滚动、改大小重摆，网页的字变了（后加载的正文）重新找。
 * 要标哪几段由界面按「这个网页正在剪进去的那篇」里来自这一页的几条发来（cn:marks）。
 */
import { codiconSvg } from '@cn/design/codicon-svg'
import { ipcRenderer } from 'electron'
import { findQuote } from '../shared/read-anchor'
import { blocks, charsOf, rangeOf, topCover } from './webview-blocks'
import { tagMathJax } from './webview-mathjax'
import { mathRoot } from './webview-md'
import { figCaption } from './webview-img'
import { normText } from '../shared/read-anchor'

/** 界面发来的一条：编号（点小标时报回去）、笔记里引着的全文、链接里那段开头 */
interface MarkReq {
  id: string
  quote: string
  text: string
  /** 剪的是一张图：照图注（或 alt）认回那张图，图上画框和小标 */
  img?: boolean
}
interface Found {
  ids: string[]
  el: HTMLElement
  ranges: Range[]
}

let marks: MarkReq[] = []
let color = '#0a7ea4'
let found: Found[] = []
/** 剪过的图（网页图拖进对话）：图左上角一个小标，图外一圈点线 */
let imgs: { ids: string[]; el: HTMLImageElement }[] = []
/** 小标和段首的字隔多少、离网页左边至少多少 */
const GAP = 6
const EDGE = 2
/** 左边空白放不下小标、给小标让了位的段落：原来写在它身上的左内边距（拿掉小标、又放得下时放回去）和原来算出来的左内边距 */
const yielded = new Map<HTMLElement, { inline: string; base: number }>()
let flashes: { range: Range; color: string; at: number }[] = []
let host: HTMLDivElement | null = null
let layer: HTMLDivElement | null = null
const COMMENT = codiconSvg('comment')
const isPage = /^https?:$/.test(location.protocol)

function ensure() {
  if (host) return
  host = document.createElement('div')
  host.id = 'cn-mark-host'
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483645;pointer-events:none'
  const root = host.attachShadow({ mode: 'open' })
  root.innerHTML = `<style>
    .u{position:absolute;height:0;border-bottom:1.5px dotted var(--c)}
    .mk{position:absolute;display:flex;align-items:center;gap:3px;height:20px;padding:0 6px;border:0;border-radius:6px;cursor:pointer;pointer-events:auto;
      background:color-mix(in srgb, var(--c) 12%, #fff);color:var(--c);font:600 11px/1 -apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 0 0 1px color-mix(in srgb, var(--c) 22%, transparent)}
    .mk:hover{background:color-mix(in srgb, var(--c) 20%, #fff)}
    .mk svg{width:12px;height:12px;flex:none}
    .flash{position:absolute;border-radius:3px;transition:opacity .4s}
    .ib{position:absolute;border:1.5px dotted var(--c);border-radius:4px}
    .flash.out{opacity:0}
  </style><div class="layer"></div>`
  layer = root.querySelector('.layer')
  layer!.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('.mk')
    if (b) ipcRenderer.sendToHost('cn:mark', (b.dataset.ids ?? '').split('\n').filter(Boolean))
  })
  document.documentElement.appendChild(host)
}

let findSeq = 0
/** 每一条在网页里是哪一段、哪几句；同一段的几条合成一个小标。先把 MathJax 3 公式的原文记到容器上（公式按原文对） */
async function find() {
  const seq = ++findSeq
  if (!marks.length) {
    found = []
    imgs = []
    return draw()
  }
  await tagMathJax()
  if (seq !== findSeq) return
  const els = blocks(document.scrollingElement ?? document.documentElement)
  const chars = els.map(charsOf)
  const texts = chars.map((c) => c.text)
  const byEl = new Map<HTMLElement, Found>()
  const byImg = new Map<HTMLImageElement, string[]>()
  const pics = marks.some((m) => m.img) ? Array.from(document.images).map((el) => ({ el, key: normText(figCaption(el) || el.alt || el.title || '') })) : []
  for (const m of marks) {
    if (m.img) {
      const text = normText(m.text)
      const quote = normText(m.quote).replace(/…$/, '')
      const pic = pics.find((p) => p.key && ((text && p.key.startsWith(text)) || (quote && p.key.startsWith(quote))))
      if (pic) {
        byImg.set(pic.el, [...(byImg.get(pic.el) ?? []), m.id])
        continue
      }
      // 认不回那张图（图换了地方、图注改了）：照图注的字标那段图注
    }
    let hit: ReturnType<typeof findQuote> = null
    for (const q of [m.quote, m.text]) if (q.trim() && (hit = findQuote(texts, q))) break
    if (!hit) continue
    const el = els[hit.index]!
    const r = rangeOf(chars[hit.index]!, hit.start, hit.end)
    const f = byEl.get(el) ?? { ids: [], el, ranges: [] }
    f.ids.push(m.id)
    if (r) f.ranges.push(r)
    byEl.set(el, f)
  }
  found = [...byEl.values()]
  imgs = [...byImg].map(([el, ids]) => ({ el, ids }))
  unyield(new Set(found.map((f) => f.el)))
  draw()
}

/** 不再有小标的段落：左内边距放回原样 */
function unyield(keep: Set<HTMLElement>) {
  for (const [el, was] of yielded)
    if (!keep.has(el)) {
      el.style.paddingLeft = was.inline
      yielded.delete(el)
    }
}

/**
 * 小标放在段落左边的空白里，离段首的字 6、不盖字（task-6cxtc 复审：网页占满时小标压住了段首第一个字）。
 * 左边的空白放不下（窄网页、正文贴着网页左边）：这一段加一点左内边距让出位置，只加差的那么多，拿掉小标时放回去。
 * 返回 true：刚让了位，字挪了，下一帧照新的位置再画一遍
 */
function place(b: HTMLElement, f: Found, first: DOMRect): boolean {
  const w = b.offsetWidth
  const h = b.offsetHeight
  // 单独一行的公式：不让位（加了左内边距公式右头会被切掉），小标放在公式左上角上面的空里（公式上下本来留着一行的空）
  if (mathRoot(f.el) === f.el) {
    b.style.left = `${Math.max(EDGE, first.left)}px`
    b.style.top = `${first.top - h - 2}px`
    return false
  }
  const cs = getComputedStyle(f.el)
  const er = f.el.getBoundingClientRect()
  const was = yielded.get(f.el)
  // 这一段的字本来从哪儿起（盒子左边 + 边框 + 网页自己的左内边距）
  const pad = was ? was.base : parseFloat(cs.paddingLeft || '0')
  const textLeft = er.left + parseFloat(cs.borderLeftWidth || '0') + pad
  const need = EDGE + w + GAP
  // 要让多少（网页变宽、左边空白够了就不让）
  const want = textLeft < need ? `${Math.ceil(pad + need - textLeft)}px` : null
  const now = was ? f.el.style.paddingLeft : null
  let moved = false
  if (want !== now) {
    if (want) {
      if (!was) yielded.set(f.el, { inline: f.el.style.paddingLeft, base: pad })
      f.el.style.paddingLeft = want
    } else if (was) {
      f.el.style.paddingLeft = was.inline
      yielded.delete(f.el)
    }
    moved = true
  }
  b.style.left = `${Math.max(EDGE, Math.max(textLeft, want ? need : 0) - GAP - w)}px`
  b.style.top = `${first.top + (first.height - h) / 2}px`
  return moved
}

const box = (cls: string) => {
  const d = document.createElement('div')
  d.className = cls
  return d
}

let frame = 0
/** 照现在滚到的地方重摆（下一帧画，滚动时一帧只画一次） */
function draw() {
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    paint()
  })
}

/** 这一行字现在露在外面（没滚到窗口外、没被网页钉着的头这类盖住）：只给露着的画点线和小标 */
function shown(el: HTMLElement, r: DOMRect): boolean {
  if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) return false
  const hit = document.elementFromPoint(Math.min(innerWidth - 1, Math.max(0, r.left + Math.min(r.width / 2, 12))), Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2)))
  return !hit || hit === el || el.contains(hit) || hit.contains(el) || !!host?.contains(hit)
}

/**
 * 这几句一行一个框（点线、亮的那块照它画）。range.getClientRects 会把公式里每个藏着的 MathML 字也算一个框，
 * 带行内公式的那一行叠出好几层点线（下标那截低 6px、贴到下一行）：这里字只算公式外面的，公式整个算一个框
 * （单独一行的公式只算画出来的那块，不算整栏宽），同一行的并成一个，底边取这一行字（按宽度最多的那个底边）
 */
function lineRects(range: Range): DOMRect[] {
  const rects: { r: DOMRect; text: boolean }[] = []
  const root = range.commonAncestorContainer
  const top = root.nodeType === Node.ELEMENT_NODE ? (root as Element) : root.parentElement
  const outer = top ? mathRoot(top) : null
  if (outer) {
    const shown = outer.querySelector(':scope > mjx-math') ?? outer
    for (const r of Array.from(shown.getClientRects())) rects.push({ r, text: false })
  } else if (top) {
    const done = new Set<Element>()
    const walker = document.createTreeWalker(top, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
      if (!range.intersectsNode(n)) continue
      const m = n.parentElement ? mathRoot(n.parentElement) : null
      if (m) {
        if (done.has(m)) continue
        done.add(m)
        const shown = m.querySelector(':scope > mjx-math') ?? m
        for (const r of Array.from(shown.getClientRects())) rects.push({ r, text: false })
        continue
      }
      const sub = document.createRange()
      sub.setStart(n, n === range.startContainer ? range.startOffset : 0)
      sub.setEnd(n, n === range.endContainer ? range.endOffset : n.data.length)
      for (const r of Array.from(sub.getClientRects())) rects.push({ r, text: true })
    }
    // MathJax 3 的公式里没有能看见的字（画在 ::before 里）：上面按字走碰不到，按元素再找一遍
    for (const m of Array.from(top.querySelectorAll('mjx-container'))) {
      if (done.has(m) || mathRoot(m) !== m || !range.intersectsNode(m)) continue
      done.add(m)
      const shown = m.querySelector(':scope > mjx-math') ?? m
      for (const r of Array.from(shown.getClientRects())) rects.push({ r, text: false })
    }
  }
  const lines: { l: number; r: number; t: number; b: number; bottoms: Map<number, number> }[] = []
  for (const { r, text } of rects.sort((a, b) => a.r.top - b.r.top)) {
    if (r.width < 1 || r.height < 1) continue
    // 竖着和这一行重叠过半（下标、上标也算这一行）
    const line = lines.find((x) => Math.min(x.b, r.bottom) - Math.max(x.t, r.top) >= Math.min(r.height, x.b - x.t) / 2)
    const key = Math.round(r.bottom)
    if (!line) {
      lines.push({ l: r.left, r: r.right, t: r.top, b: r.bottom, bottoms: new Map(text ? [[key, r.width]] : []) })
      continue
    }
    line.l = Math.min(line.l, r.left)
    line.r = Math.max(line.r, r.right)
    line.t = Math.min(line.t, r.top)
    line.b = Math.max(line.b, r.bottom)
    if (text) line.bottoms.set(key, (line.bottoms.get(key) ?? 0) + r.width)
  }
  return lines.map((x) => {
    const base = [...x.bottoms].sort((a, b) => b[1] - a[1])[0]?.[0] ?? x.b
    return new DOMRect(x.l, x.t, x.r - x.l, base - x.t)
  })
}

function paint() {
  if (!found.length && !flashes.length && !imgs.length) {
    layer?.replaceChildren()
    unyield(new Set())
    return
  }
  ensure()
  host!.style.setProperty('--c', color)
  // 网页钉着的头（d2l 那条蓝头）下面才画：被它盖住半截的那一行，点线、小标、亮的那块都只露出头下面那部分
  const cover = topCover()
  host!.style.clipPath = cover > 0 ? `inset(${cover}px 0 0 0)` : ''
  const out: HTMLElement[] = []
  /** 小标放好位置要先画出来量宽高：画完再摆 */
  const badges: [HTMLElement, Found, DOMRect][] = []
  for (const f of found) {
    const er = f.el.getBoundingClientRect()
    if (er.bottom < 0 || er.top > innerHeight || !er.width) continue
    for (const r of f.ranges)
      for (const line of lineRects(r)) {
        if (line.width < 1 || !shown(f.el, line)) continue
        const u = box('u')
        u.style.cssText = `left:${line.left}px;top:${line.bottom - 1}px;width:${line.width}px`
        out.push(u)
      }
    const first = (f.ranges[0] && lineRects(f.ranges[0])[0]) || er
    // 小标跟着那几句的第一行；第一行被盖住（滚到网页钉着的头下面）就不画
    if (!shown(f.el, first)) continue
    const b = document.createElement('button')
    b.className = 'mk'
    b.type = 'button'
    b.dataset.ids = f.ids.join('\n')
    b.setAttribute('aria-label', `这一段问过、剪过 ${f.ids.length} 条，点了在笔记里看`)
    b.title = '这一段问过、剪过，点了在笔记里看'
    b.innerHTML = `${COMMENT}<span>${f.ids.length}</span>`
    badges.push([b, f, first])
    out.push(b)
  }
  // 剪过的图：图外一圈点线，小标挂在点线框外面的右上角（不盖图）；右边放不下才放进图的左上角
  const pinned: [HTMLElement, DOMRect][] = []
  for (const g of imgs) {
    const r = g.el.getBoundingClientRect()
    if (r.width < 8 || r.height < 8 || !shown(g.el, r)) continue
    const o = box('ib')
    o.style.cssText = `left:${r.left - 3}px;top:${r.top - 3}px;width:${r.width + 6}px;height:${r.height + 6}px`
    const b = document.createElement('button')
    b.className = 'mk'
    b.type = 'button'
    b.dataset.ids = g.ids.join('\n')
    b.dataset.img = ''
    b.setAttribute('aria-label', `这张图剪过 ${g.ids.length} 次，点了在笔记里看`)
    b.title = '这张图剪过，点了在笔记里看'
    b.innerHTML = `${COMMENT}<span>${g.ids.length}</span>`
    out.push(o, b)
    pinned.push([b, r])
  }
  const now = Date.now()
  flashes = flashes.filter((f) => now - f.at < 2100)
  for (const f of flashes)
    for (const line of lineRects(f.range)) {
      const d = box('flash' + (now - f.at > 1600 ? ' out' : ''))
      d.style.cssText = `left:${line.left - 2}px;top:${line.top}px;width:${line.width + 4}px;height:${line.height}px;background:${f.color}`
      out.push(d)
    }
  layer!.replaceChildren(...out)
  for (const [b, r] of pinned) {
    const outside = r.right + 9 + b.offsetWidth <= innerWidth - EDGE
    b.style.left = `${outside ? r.right + 9 : r.left + 6}px`
    b.style.top = `${outside ? r.top - 3 : r.top + 6}px`
  }
  let moved = false
  for (const [b, f, first] of badges) moved = place(b, f, first) || moved
  // 有一段刚让了位：点线、小标照挪过以后的字再画一遍
  if (moved) draw()
}

/** 那几句亮 1.6 秒，再 0.4 秒淡掉（回到选中的那几句时） */
export function flashRange(range: Range, c: string) {
  ensure()
  flashes.push({ range, color: c, at: Date.now() })
  paint()
  setTimeout(paint, 1610)
  setTimeout(paint, 2110)
}

if (isPage) {
  ipcRenderer.on('cn:marks', (_e, m: { marks?: unknown; color?: unknown }) => {
    marks = Array.isArray(m?.marks) ? (m.marks as MarkReq[]).filter((x) => x && typeof x.id === 'string' && typeof x.quote === 'string' && typeof x.text === 'string').map((x) => ({ id: x.id, quote: x.quote, text: x.text, ...(x.img === true ? { img: true } : {}) })) : []
    if (typeof m?.color === 'string') color = m.color
    void find()
  })
  window.addEventListener('scroll', () => (found.length || flashes.length || imgs.length) && draw(), { capture: true, passive: true })
  window.addEventListener('resize', () => (found.length || flashes.length || imgs.length) && draw())
  // 网页的字变了（后加载的正文、展开收起）：重新找（半秒里攒着一次找）
  let again: ReturnType<typeof setTimeout> | undefined
  const watch = () =>
    new MutationObserver(() => {
      if (!marks.length) return
      clearTimeout(again)
      again = setTimeout(find, 500)
    }).observe(document.body, { childList: true, subtree: true, characterData: true })
  if (document.body) watch()
  else document.addEventListener('DOMContentLoaded', watch, { once: true })
}
