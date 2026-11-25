/**
 * @cn/feeds：画布订阅（Canvas Feeds）的核心。
 *
 * 这个入口只有纯函数和类型（不碰 Electron、Node 的模块，界面进程、以后 iPad 版照着移植都能用）：
 * 公开接口 FeedsCore（api.ts）、假实现 createFakeFeeds（fake.ts）、源的解析、OPML、找源、RSSHub 路由、
 * 抓取间隔和退避、同步记录的写法和合并、正文清洗、存进画布笔记的剪藏写法。
 * 真的实现（本机抓、node:sqlite、读写库里的 .canvas-feeds/）在 `@cn/feeds/node` 的 openFeeds。
 */
export * from './types'
export * from './api'
export * from './fake'
export * from './ids'
export * from './hash'
export * from './opml'
export * from './text'
export * from './view'
export * from './clip'
export * from './dates'
export * from './encoding'
export * from './parse'
export * from './kind'
export * from './rsshub'
export * from './discover'
export * from './schedule'
export * from './sanitize'
export * from './sync'
export * from './later'
