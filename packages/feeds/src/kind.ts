/**
 * 猜一个源是哪种内容（订阅时没说的话）：先看地址（RSSHub 路由、YouTube、B 站、播客站），再看内容
 * （大多数条目带音频附件是音频，带视频附件是视频；大多数没有标题是社交；大多数只有一张图、字很少是图片）。
 * 思路同 Atrium 的 ReadKind.infer（用户自己的代码）。
 */
import type { ParsedFeed } from './parse'
import { routeKind } from './rsshub'
import { htmlToText } from './text'
import type { FeedKind } from './types'

const HOST_KIND: [RegExp, FeedKind][] = [
  [/(^|\.)youtube\.com$|(^|\.)bilibili\.com$|(^|\.)vimeo\.com$/, 'video'],
  [/(^|\.)xiaoyuzhoufm\.com$|(^|\.)ximalaya\.com$|(^|\.)podcasts\.apple\.com$|(^|\.)anchor\.fm$|(^|\.)libsyn\.com$|(^|\.)transistor\.fm$|(^|\.)simplecast\.com$/, 'audio'],
  [/(^|\.)unsplash\.com$|(^|\.)500px\.com$|(^|\.)flickr\.com$/, 'picture'],
  [/(^|\.)mastodon\.[a-z]+$|(^|\.)bsky\.app$/, 'social'],
]

export function inferKind(url: string, feed?: ParsedFeed): FeedKind {
  const byRoute = routeKind(url)
  if (byRoute) return byRoute
  let host = ''
  try {
    host = new URL(url).hostname
  } catch {
    // 不是网址就只看内容
  }
  const byHost = HOST_KIND.find(([re]) => re.test(host))?.[1]
  if (byHost) return byHost
  if (!feed || !feed.items.length) return 'article'
  const n = feed.items.length
  const share = (f: (it: ParsedFeed['items'][number]) => boolean) => feed.items.filter(f).length / n
  if (share((it) => it.enclosures.some((e) => e.type?.startsWith('audio/'))) >= 0.5) return 'audio'
  if (share((it) => it.enclosures.some((e) => e.type?.startsWith('video/'))) >= 0.5) return 'video'
  if (share((it) => !it.title) >= 0.6) return 'social'
  if (share((it) => !!it.imageUrl && htmlToText(it.contentHtml ?? '').length < 80) >= 0.7) return 'picture'
  return 'article'
}
