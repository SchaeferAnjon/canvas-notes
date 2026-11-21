/**
 * 右栏网页预加载里的两件事（隔离环境，网页碰不到）：
 * 1. 整页剪藏：主进程要正文时，用 Readability（Apache-2.0）抽正文、Turndown（MIT）转成 md 发回去。
 * 2. 拖图片：开始拖网页里的图时，把图的地址、说明和网页标题告诉界面，落到白板上时写来源。
 */
import { Readability } from '@mozilla/readability'
import { ipcRenderer } from 'electron'
import TurndownService from 'turndown'
import { mdUrl } from '../shared/layout'
import { prepareClip } from './plugins/translate'

/** 直接转 DOM 节点，不拼 HTML 字符串（有的网站开了 Trusted Types，innerHTML 会被拦） */
function toMarkdown(node: Node): string {
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*' })
  td.remove(['script', 'style', 'noscript', 'iframe', 'form', 'button'])
  // 链接：不带 title（「"珍珠楼"」这种重复的字），网址里的 %E7%8F%8D 还原成能读的字
  td.addRule('link', {
    filter: (n) => n.nodeName === 'A' && !!(n as HTMLAnchorElement).getAttribute('href'),
    replacement: (content, node) => {
      const text = content.trim()
      const href = (node as HTMLAnchorElement).href
      if (!text) return ''
      // 只套着一张图的链接（维基百科的图都链到「File:」页）：只留图，文档里才画得成图（第 8 轮）
      if (/^!\[[^\]\n]*\]\([^)\s]*\)$/.test(text)) return text
      if (!/^https?:/.test(href)) return text
      return `[${text}](${mdUrl(readableUrl(href))})`
    },
  })
  // 表格：只有字的数据表一行一行写成「a · b · c」；套着图、套着表的排版用表（维基百科的信息框）整个不要
  td.addRule('table', {
    filter: 'table',
    replacement: (_c, node) => {
      const t = node as HTMLTableElement
      if (t.querySelector('table, img')) return ''
      const rows = Array.from(t.rows)
        .map((r) =>
          Array.from(r.cells)
            .map((c) => (c.textContent ?? '').replace(/\s+/g, ' ').trim())
            .filter(Boolean)
            .join(' · '),
        )
        .filter(Boolean)
      return rows.length ? '\n\n' + rows.join('\n\n') + '\n\n' : ''
    },
  })
  // 带图注的一张图（维基百科的 <figure><a><img></a><figcaption>）：图注写成这张图的说明，文档里显示在图下面（第 8 轮设计复审：以前图注成了图下面一段正文）
  td.addRule('figure', {
    filter: (n) => n.nodeName === 'FIGURE' && (n as Element).querySelectorAll('img').length === 1 && !!(n as Element).querySelector('figcaption'),
    replacement: (_c, node) => {
      const f = node as HTMLElement
      const img = f.querySelector('img')!
      const src = img.getAttribute('src') ? img.src : ''
      let cap = (f.querySelector('figcaption')!.textContent ?? '').replace(/[[\]|\n]/g, ' ').replace(/\s+/g, ' ').trim()
      if (!src || src.startsWith('data:')) return cap ? `\n\n${cap}\n\n` : ''
      if (cap.length > 120) cap = cap.slice(0, 120) + '…'
      return `\n\n![${cap}](${mdUrl(src)})\n\n`
    },
  })
  // 图片：没有地址的（懒加载占位）不要
  td.addRule('img', {
    filter: 'img',
    replacement: (_c, node) => {
      const img = node as HTMLImageElement
      // 写成完整网址（「//upload.wikimedia.org/…」「/pic.png」这种在笔记里打不开）
      const src = img.getAttribute('src') ? img.src : ''
      if (!src || src.startsWith('data:')) return ''
      // 说明只留短的：维基百科的图说明常是一整段，和下面的图注重复
      let alt = (img.getAttribute('alt') ?? '').replace(/[\[\]\n]/g, ' ').trim()
      if (alt.length > 40) alt = alt.slice(0, 40) + '…'
      return `![${alt}](${mdUrl(src)})`
    },
  })
  return td.turndown(node as HTMLElement)
}

/** 懒加载的图：真地址在 data-src 之类的属性里 */
export function fixLazyImages(root: Document) {
  for (const img of Array.from(root.querySelectorAll('img'))) {
    const real = img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('data-lazy-src') || img.getAttribute('data-actualsrc')
    const src = img.getAttribute('src') ?? ''
    if (real && (!src || src.startsWith('data:'))) img.setAttribute('src', new URL(real, document.baseURI).href)
  }
}

/** 网址里的 %xx 还原成字（维基百科的中文链接整串都是 %E7%8F%8D…）；还原不了就原样 */
function readableUrl(href: string): string {
  try {
    return decodeURI(href)
  } catch {
    return href
  }
}

/**
 * 剪之前先去掉正文里的杂物：信息框、导航框、目录、「[编辑]」、脚注角标 [1]、参考文献、分类、
 * 隐藏的和只给读屏的元素。各网站常见的类名，没有的就什么也不做。
 */
const NOISE = [
  '.infobox', '.navbox', '.vertical-navbox', '.sidebar', '.metadata', '.ambox', '.hatnote', '.noprint', '.mw-editsection',
  '.mw-jump-link', '#toc', '.toc', 'sup.reference', '.reference', '.references', '.reflist', '.refbegin', '.catlinks',
  '.printfooter', '.mw-cite-backlink', '.navigation-not-searchable', '.shortdescription', '[role=navigation]', '[aria-hidden=true]',
  '[hidden]', '.sr-only', '.visually-hidden', 'nav', 'aside', 'footer',
].join(',')

export function stripNoise(root: Document) {
  for (const el of Array.from(root.querySelectorAll(NOISE))) el.remove()
}

export function extract(): { url: string; title: string; byline?: string; markdown: string } {
  const clone = document.cloneNode(true) as Document
  // 双语翻译插进去的译文：按「整页剪藏带上译文」开关拿掉或写成引用
  prepareClip(clone)
  fixLazyImages(clone)
  stripNoise(clone)
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
