/**
 * 右栏网页预加载（隔离环境）里给「读」用的两件事：
 * 1. 阅读视图：界面要正文时，用 Readability 抽正文，拆成一块块（标题、段落、列表项、公式、图），交给中间栏的对照读（spec 2.4）。
 * 2. 框一块问：按住 ⌘ 在网页上拖一个框（和 PDF 一样），松手后框下面出黑色工具条，把框的位置、框里的字和网址交给界面（spec 3「网页上问」）。
 *    框和工具条画在一个关着的 shadow DOM 里，网页的样式碰不到，网页自己的脚本也看不到。
 */
import { codiconSvg } from '@cn/design/codicon-svg'
import { Readability } from '@mozilla/readability'
import { ipcRenderer } from 'electron'
import type { ReaderBlock, ReaderPage, WebBox } from '../shared/web-reader'
import { fixLazyImages, stripNoise } from './webview-page'

// ---------------------------------------------------------------- 阅读视图

const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

/** 公式：MathML、KaTeX、MathJax，维基百科的 <math> 后备图 */
function formulaOf(el: Element): ReaderBlock | null {
  const img = el.querySelector('img.mwe-math-fallback-image-display, img.mwe-math-fallback-image-inline, img')
  const alt = el.querySelector('annotation[encoding="application/x-tex"]')?.textContent ?? img?.getAttribute('alt') ?? el.textContent ?? ''
  const src = img?.getAttribute('src')
  return { kind: 'formula', text: norm(alt), ...(src ? { src: new URL(src, document.baseURI).href } : {}) }
}

const MATH = '.mwe-math-element, math, .katex-display, .MathJax_Display, mjx-container[display="true"]'

/**
 * Readability 会把只有公式的小容器（维基百科的 <dl><dd>）当杂物删掉：先把块级公式换成一段
 * 一段「⟦公式 图片网址⟧ 公式的字」（Readability 会去掉属性，只好写在字里），它当正文留着，拆块时再认回公式
 */
function keepMath(doc: Document) {
  for (const el of Array.from(doc.querySelectorAll(MATH))) {
    const block = el.querySelector('.mwe-math-fallback-image-display') || el.matches('.katex-display, .MathJax_Display, mjx-container[display="true"]') || (el.tagName === 'MATH' && el.getAttribute('display') === 'block')
    if (!block || !el.isConnected) continue
    const f = formulaOf(el)
    if (!f) continue
    const p = doc.createElement('p')
    p.textContent = `⟦公式 ${f.src ?? ''}⟧ ${f.text || '公式'}`
    el.replaceWith(p)
  }
}

function walk(node: Element, out: ReaderBlock[]) {
  for (const el of Array.from(node.children)) {
    const tag = el.tagName
    const math = /^(P|DD|DIV|LI|DL)$/.test(tag) ? /^\s*⟦公式 ([^⟧]*)⟧\s*([\s\S]*)$/.exec(el.textContent ?? '') : null
    if (math) {
      out.push({ kind: 'formula', text: norm(math[2]!), ...(math[1] ? { src: math[1] } : {}) })
    } else if (el.matches(MATH) && (tag !== 'MATH' || el.getAttribute('display') === 'block' || !el.parentElement?.closest('p, li'))) {
      const f = formulaOf(el)
      if (f) out.push(f)
    } else if (/^H[1-6]$/.test(tag)) {
      const t = norm(el.textContent ?? '')
      if (t) out.push({ kind: 'heading', text: t })
    } else if (tag === 'P' || tag === 'LI' || tag === 'BLOCKQUOTE' || tag === 'DD' || tag === 'DT' || tag === 'FIGCAPTION') {
      // 段落里夹着的块级公式单独拿出来
      const display = el.querySelector('.mwe-math-element:has(.mwe-math-fallback-image-display), .katex-display, mjx-container[display="true"]')
      const t = norm(el.textContent ?? '')
      if (display && t.length < 2 + norm(display.textContent ?? '').length) {
        const f = formulaOf(display)
        if (f) out.push(f)
      } else if (t) out.push({ kind: 'text', text: t })
      if (tag === 'LI' && el.querySelector('ul, ol')) walk(el.querySelector('ul, ol')!, out)
    } else if (tag === 'IMG') {
      const src = el.getAttribute('src')
      if (src && !src.startsWith('data:')) out.push({ kind: 'figure', text: norm(el.getAttribute('alt') ?? ''), src: new URL(src, document.baseURI).href })
    } else if (tag === 'PRE' || tag === 'TABLE') {
      // 代码和表格不翻译，原样当一段字放着（不送去翻）
      const t = (el.textContent ?? '').trim()
      if (t) out.push({ kind: 'formula', text: t.slice(0, 2000) })
    } else walk(el, out)
  }
}

function readerPage(): ReaderPage {
  const clone = document.cloneNode(true) as Document
  for (const o of Array.from(clone.querySelectorAll('cn-orig'))) o.replaceWith(...Array.from(o.childNodes))
  for (const t of Array.from(clone.querySelectorAll('cn-tr'))) t.remove()
  fixLazyImages(clone)
  stripNoise(clone)
  keepMath(clone)
  const article = new Readability<Node>(clone, { charThreshold: 200, serializer: (n) => n }).parse()
  const root = (article?.content as Element | null | undefined) ?? clone.querySelector('main, article, [role=main]') ?? clone.body
  const blocks: ReaderBlock[] = []
  if (root) walk(root, blocks)
  return {
    url: location.href,
    title: norm(article?.title || document.title || location.hostname),
    site: location.hostname.replace(/^www\./, ''),
    blocks: blocks.slice(0, 3000),
  }
}

ipcRenderer.on('cn:reader', (_e, id: number) => {
  try {
    ipcRenderer.sendToHost('cn:read:page', id, readerPage(), null)
  } catch (e) {
    ipcRenderer.sendToHost('cn:read:page', id, null, `网页正文抽不出来：${(e as Error).message}`)
  }
})

// ---------------------------------------------------------------- 框一块问

let host: HTMLDivElement | null = null
let frame: HTMLDivElement | null = null
let bar: HTMLDivElement | null = null
let start: { x: number; y: number } | null = null
let boxed: WebBox | null = null

const LANG = codiconSvg('whole-word')
const PEN = codiconSvg('edit')
const X = codiconSvg('close')

function ensure() {
  if (host) return
  host = document.createElement('div')
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none'
  const root = host.attachShadow({ mode: 'closed' })
  root.innerHTML = `<style>
    .fr{position:fixed;display:none;border:1.5px solid #9a48ad;background:rgba(154,72,173,.12);border-radius:3px}
    .cap{position:fixed;display:none;align-items:center;gap:2px;height:32px;padding:0 4px;border-radius:999px;background:#111113;color:#fff;
      font:500 12px/1 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;white-space:nowrap;box-shadow:0 8px 24px rgba(0,0,0,.18);pointer-events:auto}
    button{height:24px;border:0;border-radius:999px;padding:0 10px;display:flex;align-items:center;gap:6px;background:none;color:inherit;font:inherit;cursor:pointer}
    button:hover{background:rgba(127,127,127,.25)}
    .k{opacity:.6;font-size:11px}
    .sep{width:1px;height:14px;background:currentColor;opacity:.2}
    svg{width:14px;height:14px;flex:none}
  </style><div class="fr"></div><div class="cap" role="toolbar" aria-label="框好的这块">
    <button data-k="explain">讲解一下 <span class="k">↵</span></button><button data-k="translate">${LANG}翻译 + 讲一讲</button><button data-k="rephrase">${PEN}改问法</button><span class="sep"></span><button data-k="cancel" aria-label="取消">${X}</button></div>`
  frame = root.querySelector('.fr')
  bar = root.querySelector('.cap')
  for (const b of Array.from(root.querySelectorAll('button'))) {
    b.addEventListener('mousedown', (e) => e.preventDefault())
    b.addEventListener('click', (e) => {
      e.preventDefault()
      const k = (b as HTMLElement).dataset.k
      if (k === 'cancel') return clear(true)
      if (boxed) ipcRenderer.sendToHost('cn:read:box', { ...boxed, action: k })
      clear(false)
    })
  }
  document.documentElement.appendChild(host)
}

function place(x0: number, y0: number, x1: number, y1: number) {
  if (!frame) return
  frame.style.display = 'block'
  frame.style.left = `${Math.min(x0, x1)}px`
  frame.style.top = `${Math.min(y0, y1)}px`
  frame.style.width = `${Math.abs(x1 - x0)}px`
  frame.style.height = `${Math.abs(y1 - y0)}px`
}

/** 框里的字：和框相交的文字节点 */
function textIn(r: { x: number; y: number; w: number; h: number }): string {
  const out: string[] = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  for (let n = walker.nextNode(); n && out.join(' ').length < 4000; n = walker.nextNode()) {
    const t = n.textContent ?? ''
    if (!t.trim()) continue
    range.selectNodeContents(n)
    const b = range.getBoundingClientRect()
    if (b.right < r.x || b.left > r.x + r.w || b.bottom < r.y || b.top > r.y + r.h || !b.width) continue
    out.push(t.trim())
  }
  return norm(out.join(' '))
}

function clear(tell: boolean) {
  boxed = null
  start = null
  if (frame) frame.style.display = 'none'
  if (bar) bar.style.display = 'none'
  if (tell) ipcRenderer.sendToHost('cn:read:box', { action: 'cancel' })
}

if (location.protocol === 'http:' || location.protocol === 'https:' || location.protocol === 'file:') {
  // 按住 ⌘ 拖：框；不按 ⌘ 是网页自己的（选字、点链接）。⌘ 点一下不拖还是网页自己的（⌘ 点链接开新标签）
  let down: { x: number; y: number } | null = null
  let saved = ''
  window.addEventListener(
    'pointerdown',
    (e) => {
      down = e.metaKey && e.button === 0 ? { x: e.clientX, y: e.clientY } : null
    },
    true,
  )
  window.addEventListener(
    'pointermove',
    (e) => {
      if (down && !start && e.metaKey && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) {
        ensure()
        clear(false)
        start = down
        saved = document.documentElement.style.userSelect
        document.documentElement.style.userSelect = 'none'
      }
      if (!start) return
      e.preventDefault()
      window.getSelection()?.removeAllRanges()
      place(start.x, start.y, e.clientX, e.clientY)
    },
    true,
  )
  window.addEventListener(
    'pointerup',
    (e) => {
      down = null
      if (!start) return
      e.preventDefault()
      e.stopPropagation()
      document.documentElement.style.userSelect = saved
      const s = start
      start = null
      const w = Math.abs(e.clientX - s.x)
      const h = Math.abs(e.clientY - s.y)
      if (w < 14 || h < 14) return clear(false)
      const r = { x: Math.min(s.x, e.clientX), y: Math.min(s.y, e.clientY), w, h }
      boxed = { rect: r, text: textIn(r), url: location.href, title: document.title, vw: window.innerWidth, vh: window.innerHeight }
      if (bar) {
        bar.style.display = 'flex'
        const below = r.y + h + 8
        bar.style.left = `${Math.max(4, Math.min(r.x, window.innerWidth - 360))}px`
        bar.style.top = `${below + 32 > window.innerHeight ? Math.max(4, r.y - 40) : below}px`
      }
      // 框好就把图交给界面：右栏 AI 输入框里先放好截图
      ipcRenderer.sendToHost('cn:read:box', { ...boxed, action: 'stage' })
    },
    true,
  )
  // ⌘ 拖完松手时网页会收到一次 click，别让它点到链接
  window.addEventListener(
    'click',
    (e) => {
      if (e.metaKey && boxed) {
        e.preventDefault()
        e.stopPropagation()
      }
    },
    true,
  )
  window.addEventListener('keydown', (e) => e.key === 'Escape' && boxed && clear(true), true)
  // 右栏下格开了 AI，网页变矮：工具条放回看得见的地方（框下面放不下就放上面，再不行贴底）
  window.addEventListener('resize', () => {
    if (!boxed || !bar) return
    const r = boxed.rect
    const below = r.y + r.h + 8
    const top = below + 32 <= window.innerHeight ? below : r.y - 40 >= 4 ? r.y - 40 : Math.max(4, window.innerHeight - 40)
    bar.style.top = `${top}px`
  })
  window.addEventListener('scroll', () => boxed && clear(false), true)
  // 界面那边发出去了、或取消了：收起框和工具条
  ipcRenderer.on('cn:read:clear', () => clear(false))
}
