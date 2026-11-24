/**
 * 右栏网页预加载：网页里一张图的说明（拖进 AI 输入框、剪进文档时带的来源，网页上标「剪过」时认回这张图）。
 * 图注优先：<figure> 的 <figcaption>、Sphinx（d2l）的 .figure > .caption，往上最多三层、那一层里只有这一张图；
 * 没有图注用 alt、title。head 是图上面最近的小标题。
 */
import { normText } from '../shared/read-anchor'
import { headAbove } from './webview-head'

const CAPTION = 'figcaption, .caption, .wp-caption-text, .figure-caption, [class*="caption"]'

/** 图注的字（公式的 <script> 原文、Sphinx 的 ¶ 不要） */
function captionText(el: Element): string {
  const c = el.cloneNode(true) as Element
  for (const x of Array.from(c.querySelectorAll('script, style, .headerlink'))) x.remove()
  return normText(c.textContent ?? '').replace(/¶/g, '').trim()
}

/** 这张图的图注；没有是空字 */
export function figCaption(img: HTMLImageElement): string {
  let el: Element | null = img.parentElement
  for (let i = 0; el && i < 4 && el !== document.body; i++, el = el.parentElement) {
    // 这一层套着好几张图（图库、并排的几张）：图注说的不一定是这张
    if (el.querySelectorAll('img').length > 1) return ''
    const cap = Array.from(el.querySelectorAll(CAPTION)).find((c) => !c.contains(img) && !c.querySelector('img'))
    if (cap) {
      const t = captionText(cap)
      if (t) return t
    }
  }
  return ''
}

export interface ImgInfo {
  src: string
  alt: string
  /** 图注（没有图注是空字） */
  caption: string
  /** 图上面最近的小标题 */
  head?: string
  url: string
  srcs?: string[]
  title: string
}

export function imgInfo(img: HTMLImageElement): ImgInfo | null {
  const src = img.currentSrc || img.src
  if (!src) return null
  const head = headAbove(img)
  // 维基百科这类带 srcset 的：currentSrc 是高清那档，拖出去的数据里是 src 属性那档
  const srcs = [img.src, ...(img.getAttribute('srcset') ?? '').split(',').map((c) => c.trim().split(/\s+/)[0])]
    .map((u) => {
      try {
        return u ? new URL(u, document.baseURI).href : ''
      } catch {
        return ''
      }
    })
    .filter((u, i, a) => u && u !== src && a.indexOf(u) === i)
  return { src, alt: (img.alt || img.title || '').trim(), caption: figCaption(img).slice(0, 400), ...(head ? { head } : {}), url: location.href, title: document.title, ...(srcs.length ? { srcs } : {}) }
}

/** 点着的、拖着的那个元素里的图（链接套着的图也算） */
export function imgOf(t: EventTarget | null): HTMLImageElement | null {
  const el = t as HTMLElement | null
  if (el instanceof HTMLImageElement) return el
  return el?.querySelector?.('img') ?? null
}
