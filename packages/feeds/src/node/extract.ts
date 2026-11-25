/**
 * 抓全文：网页 HTML → Readability（Apache-2.0）抽正文 → 两样东西：阅读视图要的清洗过的 HTML，存进画布笔记要的 md。
 *
 * md 这半和画布笔记「剪藏这一页」是同一套做法、同一组 Turndown（MIT）规则：画布笔记的在 apps/notes/src/preload/webview-page.ts
 * （extract、toMarkdown、fixLazyImages、stripNoise、readableUrl）和 webview-md.ts（codeLang、prepareMath 里记代码语言、拿掉没显示的页签），
 * 跑在网页的预加载里（真的 Chromium DOM）；这里用 jsdom 在主进程跑。这一批不动画布笔记的文件，所以这里是照着的一份，
 * test/clip-parity.test.ts 拿同一页同时跑两边比字节。以后抽成 packages/clip 时两边都改成用它，这个文件换成一行导入。
 * 没照搬的：公式（MathJax / KaTeX 读源 TeX，prepareMath 的后半）和双语翻译插进去的译文（prepareClip）。带公式的页面存进来公式会变成纯字。
 */
import { Readability } from '@mozilla/readability'
import { JSDOM, VirtualConsole } from 'jsdom'
import TurndownService from 'turndown'
import { mdUrl } from '../clip'
import { sanitizeHtml } from '../sanitize'

export interface Extracted {
  /** 网页最后的地址 */
  url: string
  title: string
  byline?: string
  siteName?: string
  /** 清洗过的正文 HTML（阅读视图） */
  html: string
  /** 画布笔记剪藏写法的正文 md */
  markdown: string
}

/** 抽正文的接口：以后换成 packages/clip 的实现时，openFeeds 的 extractor 参数换一个就行 */
export interface PageExtractor {
  extract(html: string, url: string): Extracted
}

export const jsdomExtractor: PageExtractor = { extract: extractPage }

export function extractPage(html: string, url: string): Extracted {
  // 网页自己的脚本不跑、不加载外部资源；CSS 报错不往控制台打
  const dom = new JSDOM(html, { url, virtualConsole: new VirtualConsole() })
  try {
    const doc = dom.window.document
    const clone = doc.cloneNode(true) as Document
    prepareCode(dom.window, doc, clone)
    fixLazyImages(clone)
    stripNoise(clone)
    const article = new Readability<Node>(clone, { charThreshold: 200, serializer: (n) => n }).parse()
    if (article?.content) {
      const node = article.content as unknown as Element
      return {
        url,
        title: (article.title || doc.title || '').trim(),
        ...(article.byline ? { byline: article.byline.trim() } : {}),
        ...(article.siteName ? { siteName: article.siteName.trim() } : {}),
        html: sanitizeHtml(node.innerHTML, url),
        markdown: toMarkdown(node),
      }
    }
    // 不像文章的网页：整个正文区原样转
    const body = clone.querySelector('main, article, [role=main]') ?? clone.body
    return { url, title: doc.title.trim(), html: body ? sanitizeHtml(body.innerHTML, url) : '', markdown: body ? toMarkdown(body) : '' }
  } finally {
    dom.window.close()
  }
}

/** 源里给的正文（HTML 片段）也转成同一种 md（存进画布笔记时不抓全文用） */
export function htmlToMarkdown(fragment: string, url: string): string {
  const dom = new JSDOM(`<!doctype html><body>${fragment}</body>`, { url, virtualConsole: new VirtualConsole() })
  try {
    return toMarkdown(dom.window.document.body)
  } finally {
    dom.window.close()
  }
}

// ---------------------------------------------------------------- 下面照 apps/notes/src/preload/webview-page.ts、webview-md.ts

type Win = JSDOM['window']

/** 代码块的语言（同 webview-md.ts codeLang；那边停在网页的 body，克隆里碰不到它，等于一直往上找） */
function codeLang(pre: Element): string {
  for (let p: Element | null = pre; p; p = p.parentElement) {
    const m = /(?:^|\s)(?:language|lang|highlight)-([\w+#-]+)/.exec(p.className && typeof p.className === 'string' ? p.className : '')
    if (m && m[1] !== 'default' && m[1] !== 'none') return m[1]!
    if (p.tagName === 'PRE' || p.tagName === 'CODE' || p === pre) {
      const c = p.querySelector?.('code[class*="language-"]')
      const mc = c && /language-([\w+#-]+)/.exec(c.className)
      if (mc) return mc[1]!
    }
  }
  return ''
}

/** 同 webview-md.ts prepareMath 的前半：没显示的页签拿掉、代码语言先记在 <pre> 上（Readability 会去掉外面 div 的 class） */
function prepareCode(win: Win, live: Document, clone: Document) {
  const hide: string[] = []
  live.querySelectorAll('pre, .mdl-tabs__panel, [role=tabpanel]').forEach((el, i) => {
    if (win.getComputedStyle(el).display === 'none') hide.push(String(i))
  })
  clone.querySelectorAll('pre, .mdl-tabs__panel, [role=tabpanel]').forEach((el, i) => {
    if (hide.includes(String(i))) el.remove()
  })
  clone.querySelectorAll('pre').forEach((pre) => {
    const lang = codeLang(pre)
    if (lang) pre.setAttribute('data-cn-lang', lang)
  })
}

/** 懒加载的图：真地址在 data-src 之类的属性里（同 fixLazyImages） */
function fixLazyImages(root: Document) {
  for (const img of Array.from(root.querySelectorAll('img'))) {
    const real = img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('data-lazy-src') || img.getAttribute('data-actualsrc')
    const src = img.getAttribute('src') ?? ''
    if (real && (!src || src.startsWith('data:'))) img.setAttribute('src', new URL(real, root.baseURI).href)
  }
}

const NOISE = [
  '.infobox', '.navbox', '.vertical-navbox', '.sidebar', '.metadata', '.ambox', '.hatnote', '.noprint', '.mw-editsection',
  '.mw-jump-link', '#toc', '.toc', 'sup.reference', '.reference', '.references', '.reflist', '.refbegin', '.catlinks',
  '.printfooter', '.mw-cite-backlink', '.navigation-not-searchable', '.shortdescription', '[role=navigation]', '[aria-hidden=true]',
  '[hidden]', '.sr-only', '.visually-hidden', 'nav', 'aside', 'footer',
].join(',')

/** 剪之前先去掉正文里的杂物（同 stripNoise） */
function stripNoise(root: Document) {
  for (const el of Array.from(root.querySelectorAll(NOISE))) el.remove()
}

/** 网址里的 %xx 还原成字；还原不了就原样（同 readableUrl） */
function readableUrl(href: string): string {
  try {
    return decodeURI(href)
  } catch {
    return href
  }
}

/** 同 webview-page.ts toMarkdown（规则、顺序、字一样） */
function toMarkdown(node: Node): string {
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*' })
  td.remove(['script', 'style', 'noscript', 'iframe', 'form', 'button'])
  td.addRule('cnTex', {
    filter: (n) => n.nodeType === 1 && (n as Element).hasAttribute('data-cn-tex'),
    replacement: (_c, n) => {
      const tex = ((n as Element).getAttribute('data-cn-tex') ?? '').trim()
      if (!tex) return ''
      return (n as Element).hasAttribute('data-cn-display') ? `\n\n$$\n${tex}\n$$\n\n` : `$${tex}$`
    },
  })
  td.addRule('cnPre', {
    filter: (n) => n.nodeName === 'PRE' && !(n.firstChild && n.firstChild.nodeName === 'CODE'),
    replacement: (_c, n) => `\n\n\`\`\`${(n as Element).getAttribute('data-cn-lang') || codeLang(n as Element)}\n${(n.textContent ?? '').replace(/\n+$/, '')}\n\`\`\`\n\n`,
  })
  td.addRule('link', {
    filter: (n) => n.nodeName === 'A' && !!(n as HTMLAnchorElement).getAttribute('href'),
    replacement: (content, n) => {
      const text = content.trim()
      const href = (n as HTMLAnchorElement).href
      if (!text) return ''
      if (/^!\[[^\]\n]*\]\([^)\s]*\)$/.test(text)) return text
      if (!/^https?:/.test(href)) return text
      return `[${text}](${mdUrl(readableUrl(href))})`
    },
  })
  td.addRule('table', {
    filter: 'table',
    replacement: (_c, n) => {
      const t = n as HTMLTableElement
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
  td.addRule('figure', {
    filter: (n) => n.nodeName === 'FIGURE' && (n as Element).querySelectorAll('img').length === 1 && !!(n as Element).querySelector('figcaption'),
    replacement: (_c, n) => {
      const f = n as HTMLElement
      const img = f.querySelector('img')!
      const src = img.getAttribute('src') ? img.src : ''
      let cap = (f.querySelector('figcaption')!.textContent ?? '').replace(/[[\]|\n]/g, ' ').replace(/\s+/g, ' ').trim()
      if (!src || src.startsWith('data:')) return cap ? `\n\n${cap}\n\n` : ''
      if (cap.length > 120) cap = cap.slice(0, 120) + '…'
      return `\n\n![${cap}](${mdUrl(src)})\n\n`
    },
  })
  td.addRule('img', {
    filter: 'img',
    replacement: (_c, n) => {
      const img = n as HTMLImageElement
      const src = img.getAttribute('src') ? img.src : ''
      if (!src || src.startsWith('data:')) return ''
      let alt = (img.getAttribute('alt') ?? '').replace(/[\[\]\n]/g, ' ').trim()
      if (alt.length > 40) alt = alt.slice(0, 40) + '…'
      return `![${alt}](${mdUrl(src)})`
    },
  })
  return td.turndown(node as HTMLElement)
}
