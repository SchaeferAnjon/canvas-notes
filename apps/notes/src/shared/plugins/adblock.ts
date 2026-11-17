/**
 * 拦广告（内置插件，CN-51）：内置浏览器（persist:web，右栏和中间的宽网页）里拦广告和跟踪，像 Chrome 里装的 AdBlock。
 * Chrome 的 AdBlock 是 Manifest V3，靠 declarativeNetRequest，Electron 没有这个接口，导进来也拦不了；
 * 所以用 Ghostery 的拦截引擎（@ghostery/adblocker-electron，MPL-2.0），规则是 EasyList + EasyPrivacy：网络请求和页面元素都管。
 * 某个网站被拦坏了：「⋯ › 在 <网站> 不拦广告」，只对这个网站。这里只放纯函数和类型。
 */
import type { PluginManifest } from '../plugins'

export const ADBLOCK: PluginManifest = {
  id: 'adblock',
  name: '拦广告',
  description: '内置浏览器里拦广告和跟踪（EasyList、EasyPrivacy的规则，开软件时取一次、每周更新）：网络请求和页面上的广告位都拦。某个网站被拦坏了，在「⋯」里点「在这个网站不拦广告」。',
  permissions: ['page', 'net'],
}

/** 默认的规则 */
export const DEFAULT_LISTS = ['https://easylist.to/easylist/easylist.txt', 'https://easylist.to/easylist/easyprivacy.txt']
/** 规则多久更新一次 */
export const REFRESH_MS = 7 * 24 * 3600_000

export interface AdblockSettings {
  /** 不拦的网站（hostname，去掉 www.） */
  allow: string[]
}

export const siteOf = (url: string | null | undefined): string => {
  if (!url) return ''
  try {
    const u = new URL(url)
    return /^https?:$/.test(u.protocol) ? u.hostname.replace(/^www\./, '').toLowerCase() : ''
  } catch {
    return ''
  }
}

export function normalizeAdblock(raw: unknown): AdblockSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { allow?: unknown }
  const allow = Array.isArray(r.allow) ? r.allow.filter((h): h is string => typeof h === 'string' && /^[a-z0-9.-]{1,253}$/i.test(h)).map((h) => h.toLowerCase().replace(/^www\./, '')) : []
  return { allow: [...new Set(allow)].slice(0, 500) }
}

/** 这个网页在不拦的名单里吗（子域名也算：不拦 example.com 时 news.example.com 也不拦） */
export function allowed(allow: readonly string[], pageUrl: string | null | undefined): boolean {
  const h = siteOf(pageUrl)
  return !!h && allow.some((a) => h === a || h.endsWith('.' + a))
}

/** 「⋯」里点一下：在名单里就拿掉，不在就加上 */
export function toggleAllow(allow: readonly string[], site: string): string[] {
  return allow.includes(site) ? allow.filter((a) => a !== site) : [...allow, site]
}

/** 设置页里显示的状态 */
export interface AdblockStatus {
  /** idle：还没取过规则，等用户第一次去网站时再取（开软件不联网） */
  state: 'idle' | 'loading' | 'ok' | 'error' | 'off'
  /** 规则条数（网络 + 页面元素） */
  rules: number
  /** 规则上次取回来的时间（毫秒） */
  updated: number
  /** 这次打开软件以来拦了多少个请求 */
  blocked: number
  error?: string
}
