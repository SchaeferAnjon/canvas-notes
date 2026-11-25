/**
 * 界面和核心之间的那一层：一切都是异步的，放在 Electron 主进程里、隔一层 IPC 交给界面也照样用。
 * 真的实现：`openFeeds()`（@cn/feeds/node，本机抓、node:sqlite 存、库里 .canvas-feeds/ 同步）；
 * 假的：`createFakeFeeds()`（@cn/feeds，全在内存，不联网，界面开发和界面测试用）。
 */
import type {
  ArticleDetail,
  ArticlePage,
  ArticleQuery,
  ChangeEvent,
  Counts,
  DiscoverResult,
  Feed,
  FeedPatch,
  FeedsSettings,
  FetchStatus,
  Folder,
  Highlight,
  HighlightAnchor,
  NoteAddition,
  NoteAppendResult,
  OpmlImportResult,
  Readable,
  RefreshSummary,
  SaveOptions,
  SavePreview,
  SaveResult,
  SearchHit,
  SubscribeInput,
  SyncStatus,
  SyncSummary,
} from './types'

/** 「整源 / 整个文件夹 / 整个视图标成已读」的范围 */
export type MarkScope = { feedId: string } | { folderId: string } | { view: 'all' | 'article' | 'social' | 'picture' | 'video' | 'audio' }

export interface FeedsCore {
  /** 这台设备在 .canvas-feeds/ 里的文件名（不带 .jsonl） */
  readonly deviceId: string

  // ------------------------------------------------ 文件夹和订阅
  listFolders(): Promise<Folder[]>
  addFolder(name: string): Promise<Folder>
  renameFolder(id: string, name: string): Promise<void>
  /** 删文件夹：里面的源挪到「没有文件夹」，不退订 */
  removeFolder(id: string): Promise<void>
  /** 排序：按给的先后重排 order */
  reorderFolders(ids: string[]): Promise<void>

  listFeeds(): Promise<Feed[]>
  getFeed(id: string): Promise<Feed | null>
  /** 粘一个网址：本身是源就是它；是网页就找页里的源、常见路径；B 站、微博、X 这类给 RSSHub 路由 */
  discover(input: string): Promise<DiscoverResult>
  /** 订一个源（订完马上抓一次；已经订过的直接返回那个） */
  subscribe(input: SubscribeInput): Promise<Feed>
  unsubscribe(feedId: string): Promise<void>
  updateFeed(feedId: string, patch: FeedPatch): Promise<Feed>

  importOpml(xml: string): Promise<OpmlImportResult>
  exportOpml(): Promise<string>

  // ------------------------------------------------ 抓取
  /** 马上抓：给了 feedIds 只抓这些，不给抓全部（不管到没到点） */
  refresh(feedIds?: string[]): Promise<RefreshSummary>
  status(): Promise<FetchStatus>
  /** 开 / 停后台定时抓（软件开着就开；Mac 睡醒时调 wake() 补抓到点的） */
  startScheduler(): void
  stopScheduler(): void
  wake(): void

  // ------------------------------------------------ 文章
  listArticles(q: ArticleQuery): Promise<ArticlePage>
  getArticle(id: string): Promise<ArticleDetail | null>
  /**
   * 阅读视图的正文。默认用源里的正文；full: true（或者源里只有几句摘要时界面自己决定）抓原网页、抽正文、存起来，下次直接用
   */
  readable(id: string, opts?: { full?: boolean }): Promise<Readable>
  counts(): Promise<Counts>
  /** 搜本机所有文章（标题、摘要、正文）；两个字以下的中文也搜得到 */
  search(query: string, opts?: { limit?: number; feedId?: string }): Promise<SearchHit[]>

  // ------------------------------------------------ 已读、星标、稍后读、划线（都会同步）
  markRead(ids: string[], read?: boolean): Promise<void>
  /** 整源 / 文件夹 / 视图标已读：只标 before（默认现在）以前发表的，后来进来的照样是未读 */
  markAllRead(scope: MarkScope, before?: number): Promise<void>
  setStarred(id: string, on: boolean): Promise<void>
  setLater(id: string, on: boolean): Promise<void>
  addHighlight(articleId: string, anchor: HighlightAnchor, opts?: { note?: string; color?: string }): Promise<Highlight>
  updateHighlight(id: string, patch: { note?: string; color?: string }): Promise<Highlight>
  removeHighlight(id: string): Promise<void>
  listHighlights(articleId?: string): Promise<Highlight[]>

  // ------------------------------------------------ 设置（这台 Mac 自己的，不同步）
  getSettings(): Promise<FeedsSettings>
  setSettings(patch: Partial<FeedsSettings>): Promise<FeedsSettings>

  // ------------------------------------------------ 同步和存进画布笔记
  /** 换库或不用库（null）。有库时订阅、已读、星标、稍后读、划线经库里的 .canvas-feeds/ 同步 */
  setVault(dir: string | null): Promise<void>
  /** 读别的设备的记录、写出自己没写的；改了状态后核心自己会调，界面在库同步完（Git 拉下来）后再调一次 */
  sync(): Promise<SyncSummary>
  /** 同步现在怎样：上次什么时候、没成的原因、还有几条没写出去、读到过哪几台设备 */
  syncStatus(): Promise<SyncStatus>
  /** 存进画布笔记之前给人看会写成什么样 */
  previewSave(articleId: string, opts?: SaveOptions): Promise<SavePreview>
  /** 写成画布笔记的剪藏格式进库（一次提交，能撤回）；没有库时报错 */
  saveToNotes(articleId: string, opts?: SaveOptions): Promise<SaveResult>
  /** 这篇存进画布笔记过、那一篇还在现在的库里：库内路径；不然 null */
  savedNote(articleId: string): Promise<string | null>
  /** 往存过的那一篇里补（存过以后再划的线、问 AI 的问答），一次提交；没存过（或那篇没了）是 null */
  appendToNote(articleId: string, add: NoteAddition): Promise<NoteAppendResult | null>

  // ------------------------------------------------
  /** 数据变了的通知；返回取消订阅的函数 */
  onChange(cb: (e: ChangeEvent) => void): () => void
  close(): Promise<void>
}
