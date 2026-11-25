/**
 * 画布订阅（Canvas Feeds）核心的公开类型。界面（apps/feeds）只认这些类型和 api.ts 的 FeedsCore，
 * 真的实现（@cn/feeds/node 的 openFeeds）和假的（fake.ts 的 createFakeFeeds）都照它们交数据。
 * 时间一律是毫秒（Date.getTime()）。
 */

/** 一个源的内容类型，决定它在哪个视图、列表一行长什么样（Folo 的视图划分思路，代码没借） */
export type FeedKind = 'article' | 'social' | 'picture' | 'video' | 'audio'
export const FEED_KINDS: readonly FeedKind[] = ['article', 'social', 'picture', 'video', 'audio']

/** 左图标栏的视图：全部、五种内容类型、稍后读、星标、划线 */
export type ViewId = 'all' | FeedKind | 'later' | 'starred' | 'highlights'

export interface Folder {
  id: string
  name: string
  /** 左栏里的先后，小的在上 */
  order: number
}

export interface Feed {
  /** 稳定的编号：由第一次订阅时的地址算出来（feedIdOf），每台设备算得一样 */
  id: string
  /** 订阅地址：http(s) 网址，或者 RSSHub 路由 `rsshub://bilibili/user/video/2267573`（抓的时候拼到用户填的 RSSHub 地址上） */
  url: string
  title: string
  /** 源的网站首页 */
  siteUrl?: string
  iconUrl?: string
  description?: string
  kind: FeedKind
  folderId: string | null
  /** 多久抓一次（分钟），最少 15 */
  intervalMin: number
  /**
   * 进不进「全部」和类型视图：normal 每篇都进；muted 静音（只在点开这个源时看得到）；
   * digest 汇总（高产源：不逐篇进列表，每 digestEvery 篇由界面合成一条 AI 汇总）。会同步
   */
  mode: FeedMode
  /** 汇总模式时每几篇合成一条 */
  digestEvery: number
  addedAt: number
  /** 下面是这台 Mac 自己的抓取状态，不同步 */
  lastFetchedAt?: number
  nextFetchAt?: number
  /** 连着失败几次（成功一次清零） */
  errorCount: number
  /** 最后一次失败的原因，给人看的中文 */
  lastError?: string
  /** 连着失败太多次或源说没了（410）：左栏标出来，照样每天试一次 */
  broken: boolean
  unread: number
}

export interface Enclosure {
  url: string
  type?: string
  length?: number
  /** 秒，播客、视频有时有 */
  duration?: number
}

/** 列表里的一行（不带正文，正文走 getArticle / readable） */
export interface ArticleRow {
  /** 稳定编号：源编号 + guid（没有 guid 用链接，再没有用内容哈希）算出来，每台设备算得一样 */
  id: string
  feedId: string
  url?: string
  title: string
  author?: string
  /** 发表时间；源里没写的用第一次抓到的时间 */
  publishedAt: number
  fetchedAt: number
  /** 两行摘要用的纯文字（源自带的描述，不花 AI），最多 300 字 */
  summary: string
  /** 缩略图：源里的图、媒体缩略图或正文第一张图 */
  imageUrl?: string
  enclosures: Enclosure[]
  read: boolean
  starred: boolean
  later: boolean
  highlightCount: number
}

export interface ArticleDetail extends ArticleRow {
  /** 源里给的正文 HTML，已经清洗过（去脚本、事件属性，地址补全），可以直接放进阅读视图 */
  contentHtml: string
  /** 抓过全文时有：从原网页抽出来、清洗过的正文 */
  fullHtml?: string
  fullFetchedAt?: number
}

/** 阅读视图要的东西 */
export interface Readable {
  articleId: string
  title: string
  url?: string
  byline?: string
  siteName?: string
  /** 清洗过的 HTML */
  html: string
  /** 来自源里的正文，还是抓了原网页 */
  source: 'feed' | 'full'
  /** 纯文字字数（判断「源里只给了摘要，要不要抓全文」） */
  textLength: number
}

export interface ArticleQuery {
  view?: ViewId
  feedId?: string
  folderId?: string
  unreadOnly?: boolean
  /** 一页几条，默认 50，最多 200 */
  limit?: number
  /** 上一页返回的 next */
  cursor?: string
}

export interface ArticlePage {
  rows: ArticleRow[]
  /** 还有下一页时给，原样传回 cursor */
  next?: string
}

export interface Counts {
  /** 每个源的未读数 */
  feeds: Record<string, number>
  /** 每个文件夹的未读数 */
  folders: Record<string, number>
  /** 每个视图：all 和五种类型是未读数，later / starred / highlights 是总数 */
  views: Record<ViewId, number>
}

export interface SearchHit {
  row: ArticleRow
  /** 命中的那一小段，命中的字用「⟪ ⟫」括起来（界面换成高亮） */
  snippet: string
}

/** 划线定位：照 W3C 的 TextQuoteSelector，划到的原文加前后各几十个字 */
export interface HighlightAnchor {
  quote: string
  prefix?: string
  suffix?: string
}

export interface Highlight {
  id: string
  articleId: string
  anchor: HighlightAnchor
  /** 写的想法 */
  note?: string
  /** 划线颜色的键（和 @cn/format highlights.ts 的 HlColor 同一套名字） */
  color?: string
  createdAt: number
  updatedAt: number
}

export interface SubscribeInput {
  /** 网址、源地址、`rsshub://路由`；网页地址先走 discover 选一个源再订 */
  url: string
  title?: string
  folderId?: string | null
  kind?: FeedKind
  intervalMin?: number
}

export interface FeedPatch {
  title?: string
  folderId?: string | null
  kind?: FeedKind
  intervalMin?: number
  mode?: FeedMode
  digestEvery?: number
}

export type FeedMode = 'normal' | 'muted' | 'digest'
export const FEED_MODES: readonly FeedMode[] = ['normal', 'muted', 'digest']
/** 汇总模式每几篇合成一条能选的（同 Atrium 的 5 / 10 / 20 / 30 / 50） */
export const DIGEST_CHOICES = [5, 10, 20, 30, 50] as const
export const DEFAULT_DIGEST_EVERY = 20

/** 找到的一个源 */
export interface FeedCandidate {
  /** 订阅时交给 subscribe 的地址（RSSHub 的是 `rsshub://…`） */
  url: string
  title?: string
  /** rss / atom / json / rdf；按网址猜的（RSSHub 路由、常见路径）是 undefined */
  format?: FeedFormat
  kind: FeedKind
  /** 从哪来的：输入本身就是源、网页里 <link rel=alternate>、网页里的链接、常见路径、RSSHub 规则 */
  via: 'direct' | 'link' | 'anchor' | 'guess' | 'rsshub'
  /** 已经订过 */
  subscribedAs?: string
  /** 走 RSSHub 而用户还没填 RSSHub 地址 */
  needsRsshub?: boolean
  /** 订之前要知道的一句（这条 RSSHub 路由要实例配了登录才抓得到） */
  hint?: string
}

export interface DiscoverResult {
  input: string
  candidates: FeedCandidate[]
  /** 一个都没找到时给人看的原因 */
  error?: string
}

export type FeedFormat = 'rss' | 'atom' | 'json' | 'rdf'

export interface OpmlImportResult {
  added: Feed[]
  /** 已经订过的地址 */
  existing: string[]
  /** 地址不对、读不出来的 */
  failed: { url: string; reason: string }[]
  /** 新建的文件夹 */
  folders: Folder[]
}

export interface RefreshSummary {
  /** 这次抓了几个源 */
  fetched: number
  /** 304 没变的 */
  notModified: number
  failed: number
  newArticles: number
}

export interface FetchStatus {
  /** 正在抓 */
  running: boolean
  feeds: number
  brokenFeeds: number
  lastRunAt?: number
  /** 下一个到点的源什么时候抓 */
  nextRunAt?: number
}

export interface SyncSummary {
  /** 库里的 .canvas-feeds/ 在哪；没有库时是 null，什么都不做 */
  dir: string | null
  /** 这次从别的设备读进来几条 */
  pulled: number
  /** 这次写出去几条 */
  pushed: number
  devices: string[]
}

/** 同步现在怎样（底栏那一格、点开的小框） */
export interface SyncStatus {
  /** 库里的 .canvas-feeds/；没有库是 null */
  dir: string | null
  /** 这台设备的名字（文件名） */
  device: string
  /** 正在读写 */
  syncing: boolean
  /** 上一次读写完的时间 */
  lastAt?: number
  /** 上一次没成的原因 */
  lastError?: string
  /** 这台设备做了、还没写进库里的几条 */
  pending: number
  /** 读到过的每台设备（这台也在里面）：几条记录、最后一条的时间 */
  devices: { id: string; events: number; lastAt?: number }[]
}

export interface FeedsSettings {
  /** 用户自己的 RSSHub 地址（比如 NAS 上那台）；空着时社交源订不了。永远没有默认值（公共的 rsshub.app 回 403） */
  rsshubBase: string
  /** RSSHub 实例的 ACCESS_KEY（有的实例要），抓的时候拼成 ?key=；只存在本机，不同步、不导出 */
  rsshubAccessKey: string
  /** 新订的源默认多久抓一次（分钟），最少 15 */
  defaultIntervalMin: number
  /** 没读、没星标、没稍后读、没划线的文章多少天后清掉 */
  retentionDays: number
  /** 每个源最多留多少篇（超出的清掉最旧的，规矩同上） */
  maxPerFeed: number
}

export const DEFAULT_SETTINGS: FeedsSettings = { rsshubBase: '', rsshubAccessKey: '', defaultIntervalMin: 30, retentionDays: 90, maxPerFeed: 2000 }
export const MIN_INTERVAL_MIN = 15

export interface SaveOptions {
  /** 存进库里哪个文件夹（库内路径），默认收件箱（和画布笔记剪藏一样） */
  folder?: string
  /** 带全文（抓原网页抽正文）；false 时用源里给的正文。默认 true */
  fullText?: boolean
  /** 图片下到这篇的附件文件夹。默认 true */
  images?: boolean
  /** AI 摘要（界面生成好交进来），写成 `[!ai]` AI 总结块，放在来源行下面 */
  summary?: { text: string; by?: string }
  /** 带划线和想法，写在文末「## 划线」一节。默认 true */
  highlights?: boolean
  /** 接在文末的几段 md（「问答记进这篇的笔记」开着时，这篇已有的 AI 问答），和这一篇一起提交 */
  extra?: string
}

/** 往存过的那一篇里补东西 */
export interface NoteAddition {
  /** 补上还没写进去的划线（接在「## 划线」一节末尾，没有这一节就新起） */
  highlights?: boolean
  /** 接在文末的 md（一问 AI 的问答） */
  text?: string
  /** 提交说明 */
  message?: string
}

export interface NoteAppendResult {
  path: string
  /** 补进去几样（划线几条；text 算一样）；0 时没写、没提交 */
  added: number
  commit: string | null
}

export interface SavePreview {
  /** 会写到的库内路径（撞名时加「 2」） */
  path: string
  markdown: string
}

export interface SaveResult {
  path: string
  /** 一起写进库的附件（库内路径） */
  files: string[]
  /** 提交号；没有 Git 或没提交时是 null */
  commit: string | null
}

/** 数据变了，界面照这个刷新 */
export interface ChangeEvent {
  what: 'feeds' | 'folders' | 'articles' | 'state' | 'highlights' | 'status' | 'settings'
  feedIds?: string[]
  articleIds?: string[]
}
