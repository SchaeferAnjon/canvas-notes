/**
 * 什么时候再抓（纯函数，定时器在 node/scheduler.ts）：
 * - 成功（含 304）：间隔 = max(源的间隔, 源自己的 ttl（最多算 6 小时）, 服务器的 Retry-After)，失败次数清零。
 * - 失败：间隔 × 2^失败次数，最多 24 小时；429 / 503 带 Retry-After 时至少等那么久。
 * - 连着失败 8 次，或者 410 Gone、404 连着 3 次：标成坏了（左栏标出来），之后每天试一次，好了自己恢复。
 * - 每个源加一点固定的抖动（±10%，由源编号算，同一个源每次一样），几百个源不会挤在同一分钟。
 */
import { sha256Hex } from './hash'
import { MIN_INTERVAL_MIN } from './types'

export const MAX_BACKOFF_MS = 24 * 3600_000
export const BROKEN_AFTER = 8

export interface Outcome {
  ok: boolean
  /** HTTP 状态；网络错误、超时没有 */
  status?: number
  retryAfterMs?: number
  ttlMin?: number
}

export interface Plan {
  nextFetchAt: number
  errorCount: number
  broken: boolean
}

/** 由编号算出 0.9–1.1 之间一个固定的数 */
export function jitter(id: string, salt = 0): number {
  const h = parseInt(sha256Hex(`${id}:${salt}`).slice(0, 8), 16) / 0xffffffff
  return 0.9 + h * 0.2
}

export function plan(feed: { id: string; intervalMin: number; errorCount: number }, o: Outcome, now: number): Plan {
  const base = Math.max(MIN_INTERVAL_MIN, feed.intervalMin) * 60_000
  if (o.ok) {
    const ttl = o.ttlMin ? Math.min(o.ttlMin, 360) * 60_000 : 0
    const wait = Math.max(base, ttl, o.retryAfterMs ?? 0)
    return { nextFetchAt: now + Math.round(wait * jitter(feed.id)), errorCount: 0, broken: false }
  }
  const errorCount = feed.errorCount + 1
  const broken = errorCount >= BROKEN_AFTER || o.status === 410 || (o.status === 404 && errorCount >= 3)
  let wait = broken ? MAX_BACKOFF_MS : Math.min(MAX_BACKOFF_MS, base * 2 ** Math.min(errorCount, 12))
  if (o.retryAfterMs) wait = Math.max(wait, Math.min(o.retryAfterMs, 7 * MAX_BACKOFF_MS))
  return { nextFetchAt: now + Math.round(wait * jitter(feed.id, errorCount)), errorCount, broken }
}

/** Retry-After：秒数或 HTTP 日期 */
export function retryAfterMs(header: string | null | undefined, now: number): number | undefined {
  if (!header) return undefined
  const s = header.trim()
  if (/^\d+$/.test(s)) return Number(s) * 1000
  const t = Date.parse(s)
  return Number.isFinite(t) && t > now ? t - now : undefined
}

/** 到点了的源，最早到点的在前；从来没抓过的（nextFetchAt 空）最先 */
export function dueFeeds<T extends { id: string; nextFetchAt?: number }>(feeds: T[], now: number): T[] {
  return feeds.filter((f) => (f.nextFetchAt ?? 0) <= now).sort((a, b) => (a.nextFetchAt ?? 0) - (b.nextFetchAt ?? 0) || a.id.localeCompare(b.id))
}

/** 给人看的失败原因 */
export function failReason(o: { status?: number; error?: string }): string {
  if (o.error) return o.error
  switch (o.status) {
    case 401:
    case 403:
      return `源不让抓（HTTP ${o.status}）`
    case 404:
      return '源不在了（HTTP 404）'
    case 410:
      return '源说它已经停了（HTTP 410）'
    case 429:
      return '抓得太勤，源让等一等（HTTP 429）'
    default:
      return o.status && o.status >= 500 ? `源的服务器出错（HTTP ${o.status}）` : `抓不下来（HTTP ${o.status ?? '?'}）`
  }
}
