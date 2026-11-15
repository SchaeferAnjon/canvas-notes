/**
 * 右栏网页预加载里的两件事（隔离环境，网页碰不到）：
 * 1. 整页剪藏：主进程要正文时，用 Readability（Apache-2.0）抽正文、Turndown（MIT）转成 md 发回去。
 * 2. 拖图片：开始拖网页里的图时，把图的地址、说明和网页标题告诉界面，落到白板上时写来源。
 */
import { Readability } from '@mozilla/readability'
import { ipcRenderer } from 'electron'
import TurndownService from 'turndown'
import { mdUrl } from '../shared/layout'

/** 直接转 DOM 节点，不拼 HTML 字符串（有的网站开了 Trusted Types，innerHTML 会被拦） */
function toMarkdown(node: Node): string {
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*' })
  td.remove(['script', 'style', 'noscript', 'iframe', 'form', 'button'])
  // 图片：没有地址的（懒加载占位）不要
  td.addRule('img', {
    filter: 'img',
    replacement: (_c, node) => {
      const img = node as HTMLImageElement
      const src = img.getAttribute('src') ?? ''
      if (!src || src.startsWith('data:')) return ''
      const alt = (img.getAttribute('alt') ?? '').replace(/[\[\]\n]/g, ' ').trim()
      return `![${alt}](${mdUrl(src)})`
    },
  })
  return td.turndown(node as HTMLElement)
}

/** 懒加载的图：真地址在 data-src 之类的属性里 */
function fixLazyImages(root: Document) {
  for (const img of Array.from(root.querySelectorAll('img'))) {
    const real = img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('data-lazy-src') || img.getAttribute('data-actualsrc')
    const src = img.getAttribute('src') ?? ''
    if (real && (!src || src.startsWith('data:'))) img.setAttribute('src', new URL(real, document.baseURI).href)
  }
}

export function extract(): { url: string; title: string; byline?: string; markdown: string } {
  const clone = document.cloneNode(true) as Document
  fixLazyImages(clone)
  const article = new Readability<Node>(clone, { charThreshold: 200, serializer: (n) => n }).parse()
  if (article?.content) {
    return {
      url: location.href,
      title: (article.title || document.title || '').trim(),
      ...(article.byline ? { byline: article.byline.trim() } : {}),
      markdown: toMarkdown(article.content),
    }
  }
  // 不像文章的网页：整个正文区原样转
  const body = clone.querySelector('main, article, [role=main]') ?? clone.body
  return { url: location.href, title: document.title.trim(), markdown: body ? toMarkdown(body) : '' }
}

ipcRenderer.on('cn:extract', (_e, id: number) => {
  try {
    ipcRenderer.send('cn:extracted', id, extract(), null)
  } catch (e) {
    ipcRenderer.send('cn:extracted', id, null, `网页正文抽不出来：${(e as Error).message}`)
  }
})

// 拖图片：图的地址、说明、网页标题和网址交给界面。
// 从网页拖到界面上时，界面那边有时收不到 drop（拖放会话留在 webview 里），
// 所以松手时把落点也报上去（相对网页左上角；dragend 的 screenX 在 webview 里不对，不用它），界面自己在那里放下
let dragging = false
document.addEventListener(
  'dragstart',
  (e) => {
    const t = e.target as HTMLElement | null
    const img = t instanceof HTMLImageElement ? t : (t?.querySelector?.('img') ?? null)
    dragging = false
    if (!img) return
    const src = img.currentSrc || img.src
    if (!src) return
    dragging = true
    ipcRenderer.sendToHost('cn:drag', { src, alt: (img.alt || img.title || '').trim(), url: location.href, title: document.title })
  },
  true,
)
document.addEventListener(
  'dragend',
  (e) => {
    if (!dragging) return
    dragging = false
    // 落在网页自己里面的不管
    if (e.clientX >= 0 && e.clientY >= 0 && e.clientX <= innerWidth && e.clientY <= innerHeight) return
    ipcRenderer.sendToHost('cn:dragend', { x: e.clientX, y: e.clientY })
  },
  true,
)
