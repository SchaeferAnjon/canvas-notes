/**
 * 编号：源和文章的编号只由内容算，每台设备各抓各的，算出来也一样，同步记录里写编号就对得上。
 *   源：  f_ + sha256(规整后的订阅地址) 前 16 位（第一次订阅时的地址；以后跟着永久跳转换了地址，编号不变）
 *   文章：a_ + sha256(源编号 + "\n" + 去重键) 前 20 位
 * 去重键（同一个源里认同一篇）：有 guid 用 guid；没有用链接；都没有用标题加正文的哈希。
 */
import { sha256Hex } from './hash'

/** 地址规整：协议和域名小写、去掉默认端口和 #后面；RSSHub 路由去掉首尾的斜杠 */
export function normalizeFeedUrl(raw: string): string {
  const s = raw.trim()
  if (/^rsshub:\/\//i.test(s)) return 'rsshub://' + s.slice(9).replace(/^\/+|\/+$/g, '')
  try {
    const u = new URL(s)
    u.hash = ''
    return u.href
  } catch {
    return s
  }
}

export const feedIdOf = (url: string): string => 'f_' + sha256Hex(normalizeFeedUrl(url)).slice(0, 16)

export interface KeySource {
  guid?: string
  url?: string
  title?: string
  contentHtml?: string
  summary?: string
}

export function dedupeKey(item: KeySource): string {
  const guid = item.guid?.trim()
  if (guid) return 'g:' + guid
  const link = item.url?.trim()
  if (link) return 'l:' + normalizeFeedUrl(link)
  return 'h:' + contentHash(item)
}

/** 标题加正文（没有正文用摘要）的哈希，也用来看「同一个 guid 内容改没改」 */
export const contentHash = (item: KeySource): string => sha256Hex(`${item.title ?? ''}\n${item.contentHtml || item.summary || ''}`).slice(0, 24)

export const articleIdOf = (feedId: string, key: string): string => 'a_' + sha256Hex(`${feedId}\n${key}`).slice(0, 20)
