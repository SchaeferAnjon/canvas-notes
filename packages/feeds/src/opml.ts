/**
 * OPML 导入导出（OPML 2.0）。导入认 Folo、NetNewsWire、Inoreader、Feedly 导出的写法：
 * 带 xmlUrl 的 outline 是源，不带的是文件夹；文件夹套文件夹时拼成「上层 / 下层」一个名字（我们的文件夹只有一层）。
 * 导出时 RSSHub 路由：填了 RSSHub 地址就写成完整网址（别的阅读器也能用），另写一个 cnRoute 属性，导回来认回路由。
 */
import { child, children, parseXml, rootElement, type XmlNode } from './xml'
import type { Feed, FeedKind, Folder } from './types'

export interface OpmlFeed {
  url: string
  title?: string
  siteUrl?: string
  /** 文件夹名；没有文件夹是 null */
  folder: string | null
  /** 我们自己导出时写的类型 */
  kind?: FeedKind
}

export interface OpmlDoc {
  title?: string
  feeds: OpmlFeed[]
}

export function parseOpml(xml: string): OpmlDoc {
  const root = rootElement(parseXml(xml))
  if (!root || root.name !== 'opml') throw new Error('不是 OPML 文件')
  const head = child(root, 'head')
  const body = child(root, 'body')
  const feeds: OpmlFeed[] = []
  const walk = (node: XmlNode, folder: string | null) => {
    for (const o of children(node, 'outline')) {
      const a = o.attrs
      const url = (a['cnroute'] ? 'rsshub://' + a['cnroute'] : (a['xmlurl'] ?? a['url'] ?? '')).trim()
      const title = (a['title'] || a['text'] || '').trim()
      if (url && (a['type'] ?? 'rss').toLowerCase() !== 'link') {
        const kind = a['cnkind'] as FeedKind | undefined
        feeds.push({ url, folder, ...(title ? { title } : {}), ...(a['htmlurl'] ? { siteUrl: a['htmlurl'].trim() } : {}), ...(kind ? { kind } : {}) })
      } else if (!url) {
        const name = title || null
        walk(o, name ? (folder ? `${folder} / ${name}` : name) : folder)
      }
    }
  }
  if (body) walk(body, null)
  const title = head ? textIn(child(head, 'title')) : ''
  return { feeds, ...(title ? { title } : {}) }
}

const textIn = (n: XmlNode | undefined) => (n ? n.children.filter((c) => typeof c === 'string').join('').trim() : '')

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!).replace(/\n/g, '&#10;')

/**
 * resolve：RSSHub 路由换成完整网址（没填 RSSHub 地址时原样写 rsshub://）。
 * created：写进 dateCreated（RFC 822），调的人给，这样同样的订阅导出两次一字不差。
 */
export function writeOpml(feeds: Feed[], folders: Folder[], opts: { title?: string; resolve?: (url: string) => string; created?: Date } = {}): string {
  const resolve = opts.resolve ?? ((u: string) => u)
  const line = (f: Feed, pad: string) => {
    const route = f.url.startsWith('rsshub://') ? f.url.slice(9) : null
    const attrs = [
      `type="rss"`,
      `text="${esc(f.title)}"`,
      `title="${esc(f.title)}"`,
      `xmlUrl="${esc(resolve(f.url))}"`,
      ...(f.siteUrl ? [`htmlUrl="${esc(f.siteUrl)}"`] : []),
      ...(route ? [`cnRoute="${esc(route)}"`] : []),
      ...(f.kind !== 'article' ? [`cnKind="${f.kind}"`] : []),
    ]
    return `${pad}<outline ${attrs.join(' ')}/>`
  }
  const byTitle = (a: Feed, b: Feed) => a.title.localeCompare(b.title, 'zh') || a.id.localeCompare(b.id)
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    '  <head>',
    `    <title>${esc(opts.title ?? '画布订阅')}</title>`,
    ...(opts.created ? [`    <dateCreated>${opts.created.toUTCString()}</dateCreated>`] : []),
    '  </head>',
    '  <body>',
  ]
  const sorted = [...folders].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'zh'))
  for (const folder of sorted) {
    const inside = feeds.filter((f) => f.folderId === folder.id).sort(byTitle)
    out.push(`    <outline text="${esc(folder.name)}" title="${esc(folder.name)}">`)
    for (const f of inside) out.push(line(f, '      '))
    out.push('    </outline>')
  }
  const known = new Set(folders.map((f) => f.id))
  for (const f of feeds.filter((f) => !f.folderId || !known.has(f.folderId)).sort(byTitle)) out.push(line(f, '    '))
  out.push('  </body>', '</opml>', '')
  return out.join('\n')
}
