/**
 * RSSHub：社交平台（B 站、微博、X、即刻、小红书…）没有 RSS，要经用户自己的 RSSHub 实例转。
 * 订阅地址存成 `rsshub://<路由>`，抓的时候拼到用户填的地址上，换实例不用重订。
 * 永远不默认用公共实例 rsshub.app（2026-11-24 起回 403 人机验证）；从别处导进来的 rsshub.app 地址认回路由，走用户自己的实例。
 * RSSHub 是 AGPL-3.0：这里只按它公开文档里的路由写法拼地址，不带它的代码。
 */
import type { FeedKind } from './types'

export class NeedsRsshubError extends Error {
  constructor() {
    super('这个源要经 RSSHub 转：先在设置里填你自己的 RSSHub 地址')
  }
}

export const isRoute = (url: string) => /^rsshub:\/\//i.test(url)

/** 公共实例：导进来的地址是它们的，改成路由 */
const PUBLIC_HOSTS = ['rsshub.app', 'rsshub.rssforever.com', 'hub.slarker.me', 'rsshub.pseudoyu.com', 'rsshub.ktachibana.party', 'rsshub.woodland.cafe']

/** 用户填的地址规整：补 https://、去掉末尾斜杠；不像地址时返回 ''（空着） */
export function normalizeBase(raw: string): string {
  let s = raw.trim()
  if (!s) return ''
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s
  try {
    const u = new URL(s)
    if (!u.hostname) return ''
    return (u.origin + u.pathname).replace(/\/+$/, '')
  } catch {
    return ''
  }
}

/** rsshub://路由 → 能抓的地址；accessKey 是 RSSHub 的 ACCESS_KEY（有的实例要），拼成 ?key= */
export function resolveRoute(url: string, base: string, accessKey?: string): string {
  if (!isRoute(url)) return url
  const b = normalizeBase(base)
  if (!b) throw new NeedsRsshubError()
  const route = url.slice(9).replace(/^\/+/, '')
  const full = `${b}/${route}`
  if (!accessKey) return full
  return full + (full.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(accessKey)
}

/** 地址是用户的实例或公共实例上的路由：换成 rsshub://路由；不是返回 null */
export function toRoute(url: string, base: string): string | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  const b = normalizeBase(base)
  const path = (u.pathname + u.search).replace(/^\/+/, '')
  if (!path) return null
  if (b && (url === b || url.startsWith(b + '/'))) return 'rsshub://' + url.slice(b.length + 1).replace(/[?&]key=[^&]*/, '').replace(/\?$/, '')
  if (PUBLIC_HOSTS.includes(u.hostname)) return 'rsshub://' + path
  return null
}

interface Rule {
  re: RegExp
  routes: (m: RegExpExecArray) => { route: string; kind: FeedKind; title: string; hint?: string }[]
}

/** 要实例配了这个站的登录才抓得到的路由：订阅时说一句（RSSHub 文档里这几条的 requireConfig） */
const X_LOGIN = '要你的 RSSHub 配了 X 的登录（TWITTER_AUTH_TOKEN 等），没配会抓不到'
const XHS_LOGIN = '小红书常要你的 RSSHub 配了 XIAOHONGSHU_COOKIE，没配多半抓不到'

/**
 * 网页地址 → RSSHub 路由。2026-11-25 逐条对过 RSSHub 官方仓库 lib/routes/<站>/ 里每条路由的 path、example 和 radar 的 source
 * （文档站 docs.rsshub.app 就是从这些定义生成的）：
 *   bilibili/user/video/:uid、bilibili/user/dynamic/:uid（source space.bilibili.com/:uid）；weibo/user/:uid（source weibo.com/u、m.weibo.cn/u、m.weibo.cn/profile）；
 *   twitter/user/:id（source x.com/:id，要实例配登录）；jike/user/:id（source web.okjike.com/u、m.okjike.com/users）；xiaohongshu/user/:id/notes；
 *   douyin/user/:uid；zhihu/people/activities/:id；zhihu/zhuanlan/:id（source zhuanlan.zhihu.com/:id）；instagram/user/:name；
 *   telegram/channel/:name（source t.me/s/:name）；xiaoyuzhou/podcast/:id。
 * weibo.com/<数字>（不带 u/）、zhihu.com/column/<id> 不在 radar 的 source 里，是同一个人 / 专栏页的另一种网址，路由照上面拼。
 */
const RULES: Rule[] = [
  {
    re: /^https?:\/\/space\.bilibili\.com\/(\d+)/,
    routes: (m) => [
      { route: `bilibili/user/video/${m[1]}`, kind: 'video', title: 'B 站投稿' },
      { route: `bilibili/user/dynamic/${m[1]}`, kind: 'social', title: 'B 站动态' },
    ],
  },
  { re: /^https?:\/\/(?:www\.|m\.)?weibo\.(?:com|cn)\/(?:u\/|profile\/)?(\d{5,})/, routes: (m) => [{ route: `weibo/user/${m[1]}`, kind: 'social', title: '微博' }] },
  {
    re: /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/(?!home|explore|search|i\/|settings)([A-Za-z0-9_]{1,15})\/?(?:$|[?#])/,
    routes: (m) => [{ route: `twitter/user/${m[1]}`, kind: 'social', title: 'X', hint: X_LOGIN }],
  },
  { re: /^https?:\/\/(?:web\.)?okjike\.com\/u\/([\w-]+)/, routes: (m) => [{ route: `jike/user/${m[1]}`, kind: 'social', title: '即刻' }] },
  { re: /^https?:\/\/m\.okjike\.com\/users\/([\w-]+)/, routes: (m) => [{ route: `jike/user/${m[1]}`, kind: 'social', title: '即刻' }] },
  { re: /^https?:\/\/(?:www\.)?xiaohongshu\.com\/user\/profile\/(\w+)/, routes: (m) => [{ route: `xiaohongshu/user/${m[1]}/notes`, kind: 'picture', title: '小红书笔记', hint: XHS_LOGIN }] },
  { re: /^https?:\/\/(?:www\.)?douyin\.com\/user\/([\w-]+)/, routes: (m) => [{ route: `douyin/user/${m[1]}`, kind: 'video', title: '抖音' }] },
  { re: /^https?:\/\/(?:www\.)?zhihu\.com\/people\/([\w-]+)/, routes: (m) => [{ route: `zhihu/people/activities/${m[1]}`, kind: 'social', title: '知乎动态' }] },
  { re: /^https?:\/\/(?:www\.)?zhihu\.com\/column\/([\w-]+)/, routes: (m) => [{ route: `zhihu/zhuanlan/${m[1]}`, kind: 'article', title: '知乎专栏' }] },
  { re: /^https?:\/\/zhuanlan\.zhihu\.com\/(?!p\/)([\w-]+)\/?(?:$|[?#])/, routes: (m) => [{ route: `zhihu/zhuanlan/${m[1]}`, kind: 'article', title: '知乎专栏' }] },
  { re: /^https?:\/\/(?:www\.)?instagram\.com\/([\w.]+)\/?(?:$|[?#])/, routes: (m) => [{ route: `instagram/user/${m[1]}`, kind: 'picture', title: 'Instagram' }] },
  { re: /^https?:\/\/t\.me\/(?:s\/)?(\w{4,})/, routes: (m) => [{ route: `telegram/channel/${m[1]}`, kind: 'social', title: 'Telegram 频道' }] },
  { re: /^https?:\/\/(?:www\.)?xiaoyuzhoufm\.com\/podcast\/(\w+)/, routes: (m) => [{ route: `xiaoyuzhou/podcast/${m[1]}`, kind: 'audio', title: '小宇宙' }] },
]

export function suggestRoutes(pageUrl: string): { url: string; kind: FeedKind; title: string; hint?: string }[] {
  for (const r of RULES) {
    const m = r.re.exec(pageUrl.trim())
    if (m) return r.routes(m).map((x) => ({ url: 'rsshub://' + x.route, kind: x.kind, title: x.title, ...(x.hint ? { hint: x.hint } : {}) }))
  }
  return []
}

/** 路由开头 → 内容类型（订阅时没说类型就用它猜） */
const ROUTE_KIND: [RegExp, FeedKind][] = [
  [/^(bilibili\/user\/video|bilibili\/(?!user\/dynamic)|youtube|douyin|ixigua|kuaishou|vimeo|niconico)/, 'video'],
  [/^(xiaoyuzhou|ximalaya|apple\/podcast|podcast|lizhi|qingting)/, 'audio'],
  [/^(instagram|pixiv|unsplash|500px|lofter|xiaohongshu|picnob|dribbble|behance|nasa\/apod)/, 'picture'],
  [/^(weibo|twitter|x\/|jike|mastodon|telegram|bilibili\/user\/dynamic|zhihu\/people|douban\/people|threads|bluesky|bsky|tiktok)/, 'social'],
]

export function routeKind(url: string): FeedKind | undefined {
  if (!isRoute(url)) return undefined
  const route = url.slice(9)
  return ROUTE_KIND.find(([re]) => re.test(route))?.[1]
}
