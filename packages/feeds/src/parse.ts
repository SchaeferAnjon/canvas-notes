/**
 * 解析源：RSS 2.0（和 0.9x）、Atom 1.0（和 0.3）、RSS 1.0 / RDF、JSON Feed 1.0 / 1.1。
 * 思路照 NetNewsWire 的 RSParser（MIT，Copyright (c) 2002-2025 Brent Simmons）：先认格式，再按各自的元素取，
 * 取不到的留空，坏的条目跳过、不让整个源失败。代码是重写的 TypeScript，没有搬它的 Swift。
 *
 * 不规矩的源也要读：开头有垃圾、标签不闭合（xml.ts 宽容地读）、相对地址（按 xml:base 和源地址补全）、
 * guid 写成网址当链接、标题里夹 HTML、时间各种写法（dates.ts）。
 */
import { parseDate } from './dates'
import type { Enclosure, FeedFormat } from './types'
import { child, children, parseXml, rootElement, textOf, type XmlNode } from './xml'
import { htmlToText } from './text'

export interface ParsedItem {
  guid?: string
  url?: string
  title: string
  author?: string
  publishedAt?: number
  updatedAt?: number
  /** 正文 HTML（content:encoded、Atom content、JSON content_html；没有时是 description / summary） */
  contentHtml?: string
  /** 摘要 HTML（description、Atom summary、JSON summary），和正文一样时不给 */
  summaryHtml?: string
  imageUrl?: string
  enclosures: Enclosure[]
  categories: string[]
}

export interface ParsedFeed {
  format: FeedFormat
  title: string
  siteUrl?: string
  description?: string
  iconUrl?: string
  /** 源自己说的地址（atom:link rel=self、JSON feed_url） */
  selfUrl?: string
  /** RSS 的 ttl（分钟） */
  ttlMin?: number
  items: ParsedItem[]
}

export class NotAFeedError extends Error {
  constructor(public readonly looksLikeHtml: boolean) {
    super(looksLikeHtml ? '这是网页，不是订阅源' : '读不出订阅源')
  }
}

export function parseFeed(text: string, baseUrl: string): ParsedFeed {
  const t = text.replace(/^﻿/, '').trimStart()
  if (t.startsWith('{')) return parseJsonFeed(t, baseUrl)
  const doc = parseXml(t)
  const root = rootElement(doc)
  if (!root) throw new NotAFeedError(false)
  switch (root.name) {
    case 'rss':
      return parseRss(child(root, 'channel') ?? root, baseUrl, 'rss')
    case 'channel':
      return parseRss(root, baseUrl, 'rss')
    case 'feed':
    case 'atom:feed':
      return parseAtom(root, baseUrl)
    case 'rdf:rdf':
      return parseRdf(root, baseUrl)
    default:
      throw new NotAFeedError(root.name === 'html' || /<html[\s>]/i.test(t.slice(0, 2000)))
  }
}

// ---------------------------------------------------------------- 小工具

export function resolveUrl(u: string | undefined, base: string): string | undefined {
  const s = u?.trim()
  if (!s) return undefined
  try {
    const r = new URL(s, base)
    return /^(https?|mailto|magnet):$/.test(r.protocol) ? r.href : undefined
  } catch {
    return undefined
  }
}

/** 往上找 xml:base，补全相对地址用 */
function baseOf(node: XmlNode | null, fallback: string): string {
  const chain: string[] = []
  for (let n: XmlNode | null = node; n; n = n.parent) if (n.attrs['xml:base']) chain.unshift(n.attrs['xml:base'])
  let base = fallback
  for (const b of chain) {
    try {
      base = new URL(b, base).href
    } catch {
      // 写坏的 xml:base 不管
    }
  }
  return base
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim()

/** 标题：夹着标签的去掉标签，空白压成一个 */
function titleText(raw: string): string {
  const s = /<[a-z!/][^>]*>/i.test(raw) ? htmlToText(raw) : raw
  return clean(s)
}

const textAt = (n: XmlNode | undefined, ...names: string[]) => {
  const c = child(n, ...names)
  return c ? textOf(c).trim() : ''
}

/** 把 xhtml 内容（Atom type="xhtml"）写回 HTML */
function serialize(nodes: (XmlNode | string)[]): string {
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
  return nodes
    .map((n) => {
      if (typeof n === 'string') return esc(n)
      const name = n.name.replace(/^xhtml:/, '')
      const attrs = Object.entries(n.attrs)
        .filter(([k]) => !k.startsWith('xmlns'))
        .map(([k, v]) => ` ${k}="${esc(v).replace(/"/g, '&quot;')}"`)
        .join('')
      return /^(br|hr|img|source|wbr)$/.test(name) ? `<${name}${attrs}>` : `<${name}${attrs}>${serialize(n.children)}</${name}>`
    })
    .join('')
}

function firstImgInHtml(html: string | undefined, base: string): string | undefined {
  if (!html) return undefined
  const m = /<img\b[^>]*?\ssrc\s*=\s*["']([^"']+)["']/i.exec(html)
  const src = m?.[1]?.replace(/&amp;/g, '&')
  return src && !src.startsWith('data:') ? resolveUrl(src, base) : undefined
}

/** media:thumbnail / media:content / media:group（YouTube 把它们套在 media:group 里） */
function media(item: XmlNode, base: string): { image?: string; enclosures: Enclosure[]; description?: string } {
  const out: { image?: string; enclosures: Enclosure[]; description?: string } = { enclosures: [] }
  const scan = (n: XmlNode) => {
    for (const c of n.children) {
      if (typeof c === 'string') continue
      if (c.name === 'media:group') scan(c)
      else if (c.name === 'media:thumbnail') out.image ??= resolveUrl(c.attrs['url'], base)
      else if (c.name === 'media:content') {
        const url = resolveUrl(c.attrs['url'], base)
        if (!url) continue
        const type = c.attrs['type']
        const medium = c.attrs['medium']
        if (medium === 'image' || type?.startsWith('image/')) out.image ??= url
        else out.enclosures.push(enclosure(url, type, c.attrs['filesize'], c.attrs['duration']))
        const thumb = child(c, 'media:thumbnail')
        if (thumb) out.image ??= resolveUrl(thumb.attrs['url'], base)
      } else if (c.name === 'media:description') out.description ??= textOf(c).trim()
    }
  }
  scan(item)
  return out
}

function enclosure(url: string, type?: string, length?: string, duration?: string): Enclosure {
  const e: Enclosure = { url }
  if (type) e.type = type.trim()
  const len = Number(length)
  if (length && Number.isFinite(len) && len > 0) e.length = len
  const dur = durationSec(duration)
  if (dur) e.duration = dur
  return e
}

/** 「3600」「1:02:03」「62:03」 → 秒 */
function durationSec(s: string | undefined): number | undefined {
  if (!s?.trim()) return undefined
  const parts = s.trim().split(':').map(Number)
  if (parts.some((p) => !Number.isFinite(p))) return undefined
  return parts.reduce((acc, p) => acc * 60 + p, 0) || undefined
}

function finishItem(it: ParsedItem, base: string): ParsedItem | null {
  if (!it.title && !it.contentHtml && !it.summaryHtml && !it.url && !it.enclosures.length) return null
  if (it.summaryHtml && it.summaryHtml === it.contentHtml) delete it.summaryHtml
  if (!it.imageUrl) {
    // 正文里的相对地址相对文章本身
    const img = firstImgInHtml(it.contentHtml ?? it.summaryHtml, it.url ?? base) ?? it.enclosures.find((e) => e.type?.startsWith('image/'))?.url
    if (img) it.imageUrl = img
  }
  it.enclosures = it.enclosures.filter((e) => !e.type?.startsWith('image/') || e.url !== it.imageUrl)
  return it
}

const set = <T extends object, K extends keyof T>(o: T, k: K, v: T[K] | undefined | '') => {
  if (v !== undefined && v !== '') o[k] = v as T[K]
}

// ---------------------------------------------------------------- RSS 2.0

function parseRss(channel: XmlNode, feedUrl: string, format: FeedFormat): ParsedFeed {
  const base = baseOf(channel, feedUrl)
  const feed: ParsedFeed = { format, title: titleText(textAt(channel, 'title')), items: [] }
  set(feed, 'siteUrl', resolveUrl(textAt(channel, 'link') || alternate(channel), base))
  set(feed, 'description', clean(textAt(channel, 'description')))
  const self = children(channel, 'atom:link').find((l) => l.attrs['rel'] === 'self')
  set(feed, 'selfUrl', resolveUrl(self?.attrs['href'], base))
  const image = child(channel, 'image')
  set(feed, 'iconUrl', resolveUrl(textAt(image, 'url') || child(channel, 'itunes:image')?.attrs['href'], base))
  const ttl = Number(textAt(channel, 'ttl'))
  if (ttl > 0) feed.ttlMin = ttl
  // 不闭合的标签会把后面的 item 吞进前一个 item 里：所有层的 item 都算，按出现的先后
  const items: XmlNode[] = []
  const collect = (n: XmlNode) => {
    for (const c of n.children) {
      if (typeof c === 'string') continue
      if (c.name === 'item') items.push(c)
      collect(c)
    }
  }
  collect(channel)
  for (const node of items) {
    const it = rssItem(node, baseOf(node, base))
    if (it) feed.items.push(it)
  }
  return feed
}

function alternate(n: XmlNode): string | undefined {
  const links = [...children(n, 'atom:link'), ...children(n, 'link')].filter((l) => l.attrs['href'])
  return (links.find((l) => (l.attrs['rel'] ?? 'alternate') === 'alternate') ?? undefined)?.attrs['href']
}

/** RSS 条目里的元素名：标签没闭合时它们会被吞进前一个元素里，找的时候往里找、取字的时候碰到它们停下 */
const RSS_FIELDS = new Set(['title', 'link', 'guid', 'description', 'content:encoded', 'pubdate', 'dc:date', 'dc:creator', 'author', 'category', 'enclosure', 'comments', 'source', 'itunes:duration', 'itunes:image', 'itunes:author', 'media:thumbnail', 'media:content', 'media:group', 'atom:link', 'atom:updated', 'atom:published', 'updated', 'published', 'dcterms:modified'])
const RSS_STOP = new Set(['item', 'entry', 'rdf:li', ...RSS_FIELDS])

/** 条目里的元素按名字归好（不进下一个 item） */
function rssFields(node: XmlNode): Map<string, XmlNode[]> {
  const out = new Map<string, XmlNode[]>()
  const walk = (n: XmlNode) => {
    for (const c of n.children) {
      if (typeof c === 'string' || c.name === 'item' || c.name === 'entry') continue
      if (RSS_FIELDS.has(c.name)) {
        const list = out.get(c.name) ?? []
        list.push(c)
        out.set(c.name, list)
        // 没闭合的元素里还套着别的字段：接着往里找（media:group 里本来就套着 media:*）
        walk(c)
      }
    }
  }
  walk(node)
  return out
}

function rssItem(node: XmlNode, base: string): ParsedItem | null {
  const fields = rssFields(node)
  const first = (...names: string[]) => names.map((n) => fields.get(n)?.[0]).find(Boolean)
  const textAt = (...names: string[]) => {
    const n = first(...names)
    return n ? textOf(n, RSS_STOP).trim() : ''
  }
  const children = (name: string) => fields.get(name) ?? []
  const alternate = () => {
    const links = [...children('atom:link'), ...children('link')].filter((l) => l.attrs['href'])
    return links.find((l) => (l.attrs['rel'] ?? 'alternate') === 'alternate')?.attrs['href']
  }
  const it: ParsedItem = { title: titleText(textAt('title')), enclosures: [], categories: [] }
  const guidNode = first('guid')
  const guid = textAt('guid')
  set(it, 'guid', guid)
  let link = textAt('link') || alternate() || ''
  if (!link && guid && guidNode?.attrs['ispermalink'] !== 'false' && /^https?:\/\//i.test(guid)) link = guid
  set(it, 'url', resolveUrl(link, base))
  set(it, 'author', clean(textAt('dc:creator', 'author', 'itunes:author')))
  set(it, 'publishedAt', parseDate(textAt('pubdate', 'dc:date', 'atom:published', 'published')))
  set(it, 'updatedAt', parseDate(textAt('atom:updated', 'updated', 'dcterms:modified')))
  const encoded = textAt('content:encoded')
  const description = textAt('description')
  const m = media(node, base)
  set(it, 'contentHtml', encoded || description || m.description)
  set(it, 'summaryHtml', encoded ? description : '')
  for (const e of children('enclosure')) {
    const url = resolveUrl(e.attrs['url'], base)
    if (url) it.enclosures.push(enclosure(url, e.attrs['type'], e.attrs['length'], textAt('itunes:duration')))
  }
  it.enclosures.push(...m.enclosures)
  set(it, 'imageUrl', m.image ?? resolveUrl(first('itunes:image')?.attrs['href'], base))
  it.categories = children('category').map((c) => clean(textOf(c, RSS_STOP))).filter(Boolean)
  return finishItem(it, base)
}

// ---------------------------------------------------------------- Atom

/** Atom 的文字元素：type="html" 是转义过的 HTML，"xhtml" 是一段 div，"text"（默认）是纯文字 */
function atomText(n: XmlNode | undefined): { html: string; text: string } | null {
  if (!n) return null
  const type = (n.attrs['type'] ?? 'text').toLowerCase()
  if (type === 'xhtml' || type === 'application/xhtml+xml') {
    const div = n.children.find((c): c is XmlNode => typeof c !== 'string' && /(^|:)div$/.test(c.name))
    const html = serialize(div ? div.children : n.children).trim()
    return { html, text: htmlToText(html) }
  }
  const raw = textOf(n).trim()
  if (type === 'html' || type === 'text/html') return { html: raw, text: htmlToText(raw) }
  const esc = raw.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
  return { html: esc ? `<p>${esc.replace(/\n{2,}/g, '</p><p>')}</p>` : '', text: raw }
}

function atomLinks(n: XmlNode, base: string) {
  return children(n, 'link').map((l) => ({ rel: (l.attrs['rel'] ?? 'alternate').toLowerCase(), href: resolveUrl(l.attrs['href'], base), type: l.attrs['type'], length: l.attrs['length'] }))
}

function parseAtom(root: XmlNode, feedUrl: string): ParsedFeed {
  const base = baseOf(root, feedUrl)
  const t = (n: XmlNode, name: string) => child(n, name, 'atom:' + name)
  const links = atomLinks(root, base)
  const feed: ParsedFeed = { format: 'atom', title: clean(atomText(t(root, 'title'))?.text ?? ''), items: [] }
  set(feed, 'siteUrl', links.find((l) => l.rel === 'alternate' && (!l.type || /html/.test(l.type)))?.href)
  set(feed, 'selfUrl', links.find((l) => l.rel === 'self')?.href)
  set(feed, 'description', clean(atomText(child(root, 'subtitle', 'tagline'))?.text ?? ''))
  set(feed, 'iconUrl', resolveUrl(textAt(root, 'icon') || textAt(root, 'logo'), base))
  const feedAuthor = clean(textAt(child(root, 'author'), 'name'))
  const entries: XmlNode[] = []
  const collect = (n: XmlNode) => {
    for (const c of n.children) {
      if (typeof c === 'string') continue
      if (c.name === 'entry' || c.name === 'atom:entry') entries.push(c)
      collect(c)
    }
  }
  collect(root)
  for (const e of entries) {
    const eb = baseOf(e, base)
    const el = atomLinks(e, eb)
    const it: ParsedItem = { title: clean(atomText(t(e, 'title'))?.text ?? ''), enclosures: [], categories: [] }
    set(it, 'guid', textAt(e, 'id', 'atom:id'))
    set(it, 'url', (el.find((l) => l.rel === 'alternate') ?? el.find((l) => l.rel !== 'self' && l.rel !== 'enclosure' && l.rel !== 'replies'))?.href)
    set(it, 'author', clean(textAt(child(e, 'author'), 'name')) || clean(textAt(e, 'dc:creator')) || feedAuthor)
    set(it, 'publishedAt', parseDate(textAt(e, 'published', 'issued', 'created')) ?? parseDate(textAt(e, 'updated', 'modified')))
    set(it, 'updatedAt', parseDate(textAt(e, 'updated', 'modified')))
    const content = atomText(child(e, 'content'))
    const summary = atomText(child(e, 'summary'))
    const m = media(e, eb)
    const mediaHtml = m.description ? `<p>${m.description.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!).replace(/\n+/g, '<br>')}</p>` : ''
    set(it, 'contentHtml', content?.html || summary?.html || mediaHtml)
    set(it, 'summaryHtml', content?.html ? summary?.html : '')
    for (const l of el) if (l.rel === 'enclosure' && l.href) it.enclosures.push(enclosure(l.href, l.type, l.length))
    it.enclosures.push(...m.enclosures)
    set(it, 'imageUrl', m.image)
    it.categories = children(e, 'category')
      .map((c) => clean(c.attrs['label'] ?? c.attrs['term'] ?? ''))
      .filter(Boolean)
    const done = finishItem(it, eb)
    if (done) feed.items.push(done)
  }
  return feed
}

// ---------------------------------------------------------------- RSS 1.0 / RDF

function parseRdf(root: XmlNode, feedUrl: string): ParsedFeed {
  const channel = child(root, 'channel')
  const feed = parseRss(channel ?? root, feedUrl, 'rdf')
  // RDF 里 item 和 channel 是兄弟：channel 里收不到
  if (!feed.items.length || channel) {
    const base = baseOf(root, feedUrl)
    const items = children(root, 'item')
      .map((n) => {
        const it = rssItem(n, base)
        if (it && !it.guid && n.attrs['rdf:about']) it.guid = n.attrs['rdf:about']
        return it
      })
      .filter((x): x is ParsedItem => !!x)
    if (items.length) feed.items = [...feed.items, ...items]
  }
  return feed
}

// ---------------------------------------------------------------- JSON Feed

function parseJsonFeed(text: string, feedUrl: string): ParsedFeed {
  let j: Record<string, unknown>
  try {
    j = JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new NotAFeedError(false)
  }
  if (typeof j !== 'object' || !j || !Array.isArray(j['items']) || (typeof j['version'] === 'string' && !/jsonfeed\.org/.test(j['version']))) throw new NotAFeedError(false)
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const feed: ParsedFeed = { format: 'json', title: clean(str(j['title'])), items: [] }
  set(feed, 'siteUrl', resolveUrl(str(j['home_page_url']), feedUrl))
  set(feed, 'selfUrl', resolveUrl(str(j['feed_url']), feedUrl))
  set(feed, 'description', clean(str(j['description'])))
  set(feed, 'iconUrl', resolveUrl(str(j['icon']) || str(j['favicon']), feedUrl))
  const authorOf = (o: Record<string, unknown>) => {
    const list = Array.isArray(o['authors']) ? (o['authors'] as Record<string, unknown>[]) : o['author'] ? [o['author'] as Record<string, unknown>] : []
    return list
      .map((a) => str(a?.['name']))
      .filter(Boolean)
      .join(', ')
  }
  const feedAuthor = authorOf(j)
  for (const raw of j['items'] as unknown[]) {
    if (!raw || typeof raw !== 'object') continue
    const o = raw as Record<string, unknown>
    const it: ParsedItem = { title: titleText(str(o['title'])), enclosures: [], categories: [] }
    const id = typeof o['id'] === 'number' ? String(o['id']) : str(o['id'])
    set(it, 'guid', id)
    set(it, 'url', resolveUrl(str(o['url']) || str(o['external_url']), feedUrl))
    set(it, 'author', authorOf(o) || feedAuthor)
    set(it, 'publishedAt', parseDate(str(o['date_published'])) ?? parseDate(str(o['date_modified'])))
    set(it, 'updatedAt', parseDate(str(o['date_modified'])))
    const textHtml = str(o['content_text']) ? `<p>${str(o['content_text']).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!).replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>')}</p>` : ''
    set(it, 'contentHtml', str(o['content_html']) || textHtml)
    set(it, 'summaryHtml', str(o['summary']) ? str(o['summary']).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!) : '')
    set(it, 'imageUrl', resolveUrl(str(o['image']) || str(o['banner_image']), feedUrl))
    if (Array.isArray(o['attachments'])) {
      for (const a of o['attachments'] as Record<string, unknown>[]) {
        const url = resolveUrl(str(a?.['url']), feedUrl)
        if (url) it.enclosures.push(enclosure(url, str(a['mime_type']) || undefined, a['size_in_bytes'] !== undefined ? String(a['size_in_bytes']) : undefined, a['duration_in_seconds'] !== undefined ? String(a['duration_in_seconds']) : undefined))
      }
    }
    if (Array.isArray(o['tags'])) it.categories = (o['tags'] as unknown[]).map(str).filter(Boolean)
    const done = finishItem(it, feedUrl)
    if (done) feed.items.push(done)
  }
  return feed
}
