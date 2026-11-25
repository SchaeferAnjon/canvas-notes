/**
 * 找源（纯函数部分）：网页里的 `<link rel="alternate" type="application/rss+xml">`、页面里指向源的链接、
 * 常见站点的固定写法（YouTube 频道、GitHub 仓库、Reddit、Medium），还有试一试的常见路径。
 * 真去抓、挨个验证是 node/discover.ts。
 */
import { Parser } from 'htmlparser2'
import { resolveUrl } from './parse'
import type { FeedFormat, FeedKind } from './types'

export interface FoundLink {
  url: string
  title?: string
  format?: FeedFormat
  via: 'link' | 'anchor' | 'guess'
  kind?: FeedKind
}

const TYPE_FORMAT: Record<string, FeedFormat> = {
  'application/rss+xml': 'rss',
  'application/atom+xml': 'atom',
  'application/feed+json': 'json',
  'application/json': 'json',
  'application/rdf+xml': 'rdf',
  'application/xml': 'rss',
  'text/xml': 'rss',
}

const ANCHOR = /(?:\/feed\/?|\/rss\/?|\.rss|\/atom\.xml|\/rss\.xml|\/feed\.xml|\/index\.xml|\/feed\.json|[?&]feed=(?:rss2?|atom))$/i

/** 网页里写着的源（先 <link>，再 <a>），去重，按出现的先后 */
export function findFeedLinks(html: string, pageUrl: string): FoundLink[] {
  const out: FoundLink[] = []
  const seen = new Set<string>()
  let base = pageUrl
  let anchorText: { url: string; text: string } | null = null
  const push = (l: FoundLink) => {
    if (seen.has(l.url)) return
    seen.add(l.url)
    out.push(l)
  }
  const anchors: FoundLink[] = []
  const p = new Parser(
    {
      onopentag(name, a) {
        if (name === 'base' && a['href']) base = resolveUrl(a['href'], pageUrl) ?? base
        if (name === 'link') {
          const rel = (a['rel'] ?? '').toLowerCase().split(/\s+/)
          const type = (a['type'] ?? '').toLowerCase().split(';')[0]!.trim()
          const format = TYPE_FORMAT[type]
          const url = resolveUrl(a['href'], base)
          if (!url) return
          if ((rel.includes('alternate') && format && (type !== 'application/json' || /feed/i.test(url))) || rel.includes('feed')) {
            if (/\/comments\/feed\/?$/.test(url) && out.length) return
            push({ url, via: 'link', ...(a['title']?.trim() ? { title: a['title'].trim() } : {}), ...(format ? { format } : {}) })
          }
        } else if (name === 'a' && a['href']) {
          const url = resolveUrl(a['href'], base)
          // 比的时候去掉 #… 和查询串（WordPress 的 ?feed=rss2 留着）
          if (url && ANCHOR.test(url.replace(/#.*$/, '').replace(/\?(?!feed=).*$/, ''))) anchorText = { url, text: '' }
        }
      },
      ontext(t) {
        if (anchorText) anchorText.text += t
      },
      onclosetag(name) {
        if (name === 'a' && anchorText) {
          const text = anchorText.text.replace(/\s+/g, ' ').trim()
          anchors.push({ url: anchorText.url, via: 'anchor', ...(text && text.length < 60 ? { title: text } : {}) })
          anchorText = null
        }
      },
    },
    { decodeEntities: true },
  )
  p.parseComplete(html)
  // 评论源排到最后（WordPress 两个都写）
  out.sort((x, y) => Number(/comments/i.test(x.url)) - Number(/comments/i.test(y.url)))
  for (const a of anchors) push(a)
  return out
}

/** 常见站点不用看网页就知道源在哪 */
export function knownFeeds(pageUrl: string): FoundLink[] {
  let u: URL
  try {
    u = new URL(pageUrl)
  } catch {
    return []
  }
  const host = u.hostname.replace(/^(www|m)\./, '')
  const parts = u.pathname.split('/').filter(Boolean)
  if (host === 'youtube.com' && parts[0] === 'channel' && parts[1]) return [{ url: `https://www.youtube.com/feeds/videos.xml?channel_id=${parts[1]}`, via: 'guess', format: 'atom', kind: 'video' }]
  if (host === 'youtube.com' && u.searchParams.get('list')) return [{ url: `https://www.youtube.com/feeds/videos.xml?playlist_id=${u.searchParams.get('list')}`, via: 'guess', format: 'atom', kind: 'video' }]
  if (host === 'github.com' && parts.length >= 2 && !['orgs', 'settings', 'topics'].includes(parts[0]!))
    return [
      { url: `https://github.com/${parts[0]}/${parts[1]}/releases.atom`, title: '发布', via: 'guess', format: 'atom' },
      { url: `https://github.com/${parts[0]}/${parts[1]}/commits.atom`, title: '提交', via: 'guess', format: 'atom' },
    ]
  if (host === 'github.com' && parts.length === 1) return [{ url: `https://github.com/${parts[0]}.atom`, title: '动态', via: 'guess', format: 'atom', kind: 'social' }]
  if (host === 'reddit.com' && parts[0] === 'r' && parts[1]) return [{ url: `https://www.reddit.com/r/${parts[1]}/.rss`, via: 'guess', format: 'atom' }]
  if (host === 'medium.com' && parts[0]?.startsWith('@')) return [{ url: `https://medium.com/feed/${parts[0]}`, via: 'guess', format: 'rss' }]
  return []
}

/** 网页里没写时试的路径（按常见程度） */
export const GUESS_PATHS = ['/feed', '/rss', '/atom.xml', '/feed.xml', '/rss.xml', '/index.xml', '/feed.json', '/?feed=rss2']

export function guessUrls(pageUrl: string): string[] {
  try {
    const u = new URL(pageUrl)
    const dir = u.pathname.replace(/[^/]*$/, '')
    const bases = new Set([u.origin, ...(dir !== '/' ? [u.origin + dir.replace(/\/$/, '')] : [])])
    return [...bases].flatMap((b) => GUESS_PATHS.map((p) => b + p))
  } catch {
    return []
  }
}
