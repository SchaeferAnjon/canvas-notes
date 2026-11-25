/**
 * 正文清洗：源里的 HTML 和抽出来的全文都过一遍，阅读视图直接放（React 的 dangerouslySetInnerHTML 也安全）。
 * 白名单：只留排版用的标签和几个属性；脚本、样式、表单、事件属性、javascript: 地址都去掉；相对地址补全；
 * 懒加载的图（data-src）换成真地址；iframe 只留常见视频站的嵌入（YouTube、B 站、Vimeo），带 sandbox。
 */
import { parseDocument } from 'htmlparser2'
import type { ChildNode, Element, Text } from 'domhandler'

const KEEP = new Set([
  'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'code', 'kbd', 'samp', 'var',
  'em', 'strong', 'b', 'i', 'u', 's', 'del', 'ins', 'mark', 'sub', 'sup', 'small', 'abbr', 'cite', 'q', 'time',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'a', 'img', 'figure', 'figcaption', 'picture', 'source',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  'span', 'div', 'section', 'article', 'aside', 'header', 'footer', 'details', 'summary', 'video', 'audio', 'iframe', 'ruby', 'rt', 'rp', 'wbr',
])
/** 整段不要（连里面的字） */
const DROP = new Set(['script', 'style', 'noscript', 'template', 'form', 'input', 'button', 'select', 'textarea', 'object', 'embed', 'applet', 'link', 'meta', 'base', 'head', 'title', 'svg', 'math', 'canvas', 'frame', 'frameset', 'dialog'])
const VOID = new Set(['br', 'hr', 'img', 'source', 'col', 'wbr'])
const ATTRS: Record<string, string[]> = {
  a: ['href', 'title'],
  img: ['src', 'alt', 'title', 'width', 'height', 'srcset'],
  source: ['src', 'srcset', 'type', 'media'],
  video: ['src', 'poster', 'controls', 'width', 'height'],
  audio: ['src', 'controls'],
  iframe: ['src', 'width', 'height', 'allowfullscreen'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan', 'scope'],
  col: ['span'],
  ol: ['start', 'reversed'],
  time: ['datetime'],
  abbr: ['title'],
  code: ['class'],
  pre: ['class'],
}
const URL_ATTRS = new Set(['href', 'src', 'poster'])
const EMBED_HOSTS = /^(www\.)?(youtube\.com|youtube-nocookie\.com|player\.bilibili\.com|player\.vimeo\.com)$/

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
const escAttr = (s: string) => esc(s).replace(/"/g, '&quot;')

function safeUrl(raw: string, base: string, tag: string): string | null {
  const s = raw.trim()
  if (!s) return null
  if (tag === 'img' && /^data:image\/(png|jpe?g|gif|webp|avif);/i.test(s)) return s
  try {
    const u = new URL(s, base)
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.href
    if (tag === 'a' && (u.protocol === 'mailto:' || u.protocol === 'magnet:')) return u.href
    return null
  } catch {
    return null
  }
}

function srcset(raw: string, base: string): string {
  return raw
    .split(',')
    .map((part) => {
      const [u, ...rest] = part.trim().split(/\s+/)
      const ok = u ? safeUrl(u, base, 'img') : null
      return ok ? [ok, ...rest].join(' ') : ''
    })
    .filter(Boolean)
    .join(', ')
}

export function sanitizeHtml(html: string, baseUrl: string): string {
  return walk(parseDocument(html, { decodeEntities: true }).children, baseUrl)
}

function walk(nodes: ChildNode[], base: string): string {
  let out = ''
  for (const n of nodes) {
    if (n.type === 'text') out += esc((n as Text).data)
    else if (n.type === 'tag' || n.type === 'script' || n.type === 'style') out += element(n as Element, base)
  }
  return out
}

function element(el: Element, base: string): string {
  const name = el.name.toLowerCase()
  if (DROP.has(name)) return ''
  if (!KEEP.has(name)) return walk(el.children, base)
  const a = el.attribs
  const attrs: string[] = []
  const real = name === 'img' || name === 'source' ? a['data-src'] || a['data-original'] || a['data-lazy-src'] || a['data-actualsrc'] : undefined
  for (const k of ATTRS[name] ?? []) {
    let v = k === 'src' && real && (!a['src'] || a['src'].startsWith('data:')) ? real : a[k]
    if (k === 'srcset' && !v && a['data-srcset']) v = a['data-srcset']
    if (v === undefined) continue
    if (URL_ATTRS.has(k)) {
      const u = safeUrl(v, base, name)
      if (!u) continue
      v = u
    } else if (k === 'srcset') {
      v = srcset(v, base)
      if (!v) continue
    } else if (k === 'class') {
      // 只留代码语言（language-js、lang-py）
      v = v.split(/\s+/).filter((c) => /^(language|lang)-[\w+#-]+$/.test(c)).join(' ')
      if (!v) continue
    }
    attrs.push(v === '' ? ` ${k}` : ` ${k}="${escAttr(v)}"`)
  }
  if (name === 'img' && !attrs.some((x) => x.startsWith(' src='))) return ''
  if (name === 'iframe') {
    let host = ''
    try {
      host = a['src'] ? new URL(a['src'], base).hostname : ''
    } catch {
      // 地址坏了
    }
    if (!EMBED_HOSTS.test(host) || !attrs.some((x) => x.startsWith(' src='))) return ''
    attrs.push(' sandbox="allow-scripts allow-same-origin allow-presentation"')
  }
  if (name === 'a') attrs.push(' rel="noopener noreferrer"')
  if (VOID.has(name)) return `<${name}${attrs.join('')}>`
  return `<${name}${attrs.join('')}>${name === 'iframe' ? '' : walk(el.children, base)}</${name}>`
}
