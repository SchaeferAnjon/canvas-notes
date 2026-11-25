/**
 * 假的核心：全在内存，不联网、不碰文件，照 FeedsCore 的规矩办事（列表、计数、翻页和真实现用同一套 view.ts）。
 * 给 apps/feeds 搭界面、跑界面测试用。带一份演示数据（源名是常见的公开源，文章是编的演示文字，照设计稿 data.js）。
 * 时间由 now() 给，默认固定在 2026-11-25 09:00（UTC+1），截图每次一样。
 */
import type { FeedsCore, MarkScope } from './api'
import { addHighlights, clipFileName, highlightItem, HL_HEADING, localStamp, pageClipText } from './clip'
import { articleIdOf, dedupeKey, feedIdOf, normalizeFeedUrl } from './ids'
import { parseOpml, writeOpml } from './opml'
import { suggestRoutes } from './rsshub'
import { htmlToText, summaryOf } from './text'
import type {
  ArticleDetail,
  ArticleRow,
  ChangeEvent,
  DiscoverResult,
  Feed,
  FeedKind,
  FeedsSettings,
  Folder,
  Highlight,
  OpmlImportResult,
  SaveOptions,
  SearchHit,
  SubscribeInput,
} from './types'
import { DEFAULT_DIGEST_EVERY, DEFAULT_SETTINGS, MIN_INTERVAL_MIN } from './types'
import { countRows, selectPage } from './view'

export interface FakeOptions {
  now?: () => number
  /** 带演示数据，默认 true */
  demo?: boolean
  /** 假装有库（存进画布笔记、同步时用到） */
  vault?: string | null
}

interface Art {
  row: ArticleRow
  html: string
  fullHtml?: string
}

const T0 = Date.UTC(2026, 10, 25, 8, 0, 0)

export function createFakeFeeds(opts: FakeOptions = {}): FeedsCore & { readonly saved: Map<string, string> } {
  const now = opts.now ?? (() => T0)
  const folders = new Map<string, Folder>()
  const feeds = new Map<string, Feed>()
  const arts = new Map<string, Art>()
  const highlights = new Map<string, Highlight>()
  const listeners = new Set<(e: ChangeEvent) => void>()
  const saved = new Map<string, string>()
  /** 文章编号 → 存到的那一篇 */
  const savedBy = new Map<string, string>()
  let settings: FeedsSettings = { ...DEFAULT_SETTINGS }
  let vault: string | null = opts.vault ?? null
  let seq = 0
  let running = false
  let lastRunAt: number | undefined
  let lastSyncAt: number | undefined = opts.vault ? now() - 3 * 60_000 : undefined

  const emit = (e: ChangeEvent) => {
    for (const cb of listeners) cb(e)
  }
  const rows = () => [...arts.values()].map((a) => a.row)
  const recount = () => {
    const counts = countRows(rows(), feeds)
    for (const f of feeds.values()) f.unread = counts.feeds[f.id] ?? 0
  }
  const needArt = (id: string) => {
    const a = arts.get(id)
    if (!a) throw new Error('没有这篇文章')
    return a
  }
  const needFeed = (id: string) => {
    const f = feeds.get(id)
    if (!f) throw new Error('没有这个源')
    return f
  }

  function addFolderNow(name: string): Folder {
    const existing = [...folders.values()].find((f) => f.name === name)
    if (existing) return existing
    const f: Folder = { id: `d_${++seq}`, name, order: folders.size }
    folders.set(f.id, f)
    return f
  }

  function addFeedNow(input: SubscribeInput & { title: string; kind: FeedKind }): Feed {
    const url = normalizeFeedUrl(input.url)
    const id = feedIdOf(url)
    const old = feeds.get(id)
    if (old) return old
    const f: Feed = {
      id,
      url,
      title: input.title,
      kind: input.kind,
      folderId: input.folderId ?? null,
      intervalMin: Math.max(MIN_INTERVAL_MIN, input.intervalMin ?? settings.defaultIntervalMin),
      mode: 'normal',
      digestEvery: DEFAULT_DIGEST_EVERY,
      addedAt: now(),
      lastFetchedAt: now(),
      nextFetchAt: now() + (input.intervalMin ?? settings.defaultIntervalMin) * 60_000,
      errorCount: 0,
      broken: false,
      unread: 0,
    }
    if (/^https?:/.test(url)) f.siteUrl = new URL(url).origin + '/'
    feeds.set(id, f)
    return f
  }

  function addArticleNow(feed: Feed, a: { title: string; html: string; url?: string; minutesAgo: number; image?: string; read?: boolean }): ArticleRow {
    const url = a.url ?? (feed.siteUrl ? `${feed.siteUrl}p/${++seq}` : undefined)
    const id = articleIdOf(feed.id, dedupeKey({ ...(url ? { url } : {}), title: a.title, contentHtml: a.html }))
    const row: ArticleRow = {
      id,
      feedId: feed.id,
      ...(url ? { url } : {}),
      title: a.title,
      publishedAt: now() - a.minutesAgo * 60_000,
      fetchedAt: now(),
      summary: summaryOf(a.html),
      ...(a.image ? { imageUrl: a.image } : {}),
      enclosures: [],
      read: a.read ?? false,
      starred: false,
      later: false,
      highlightCount: 0,
    }
    if (!arts.has(id)) arts.set(id, { row, html: a.html })
    return row
  }

  if (opts.demo !== false) seedDemo()

  function seedDemo() {
    const groups = ['中文博客', '科技', '社交', '图片', '视频', '播客'].map(addFolderNow)
    const g = (name: string) => groups.find((x) => x.name === name)!.id
    for (const d of DEMO) {
      const feed = addFeedNow({ url: d.url, title: d.title, kind: d.kind, folderId: g(d.folder) })
      d.items.forEach((it, i) => addArticleNow(feed, { title: it[0], html: it[1], minutesAgo: d.ago + i * 95, read: i >= 2 && i % 2 === 0, ...(it[2]?.image ? { image: it[2].image } : {}), ...(it[2]?.url ? { url: it[2].url } : {}) }))
    }
    recount()
  }

  const core: FeedsCore & { readonly saved: Map<string, string> } = {
    deviceId: 'fake',
    saved,

    async listFolders() {
      return [...folders.values()].sort((a, b) => a.order - b.order).map((f) => ({ ...f }))
    },
    async addFolder(name) {
      const f = addFolderNow(name.trim() || '新文件夹')
      emit({ what: 'folders' })
      return { ...f }
    },
    async renameFolder(id, name) {
      const f = folders.get(id)
      if (!f) throw new Error('没有这个文件夹')
      f.name = name.trim() || f.name
      emit({ what: 'folders' })
    },
    async removeFolder(id) {
      folders.delete(id)
      for (const f of feeds.values()) if (f.folderId === id) f.folderId = null
      emit({ what: 'folders' })
      emit({ what: 'feeds' })
    },
    async reorderFolders(ids) {
      ids.forEach((id, i) => {
        const f = folders.get(id)
        if (f) f.order = i
      })
      emit({ what: 'folders' })
    },

    async listFeeds() {
      recount()
      return [...feeds.values()].map((f) => ({ ...f }))
    },
    async getFeed(id) {
      recount()
      const f = feeds.get(id)
      return f ? { ...f } : null
    },
    async discover(input): Promise<DiscoverResult> {
      const s = input.trim()
      const routes = suggestRoutes(s)
      if (routes.length)
        return { input, candidates: routes.map((r) => ({ url: r.url, title: r.title, kind: r.kind, via: 'rsshub' as const, ...(r.hint ? { hint: r.hint } : {}), ...(settings.rsshubBase ? {} : { needsRsshub: true }) })) }
      if (!/^https?:\/\/[^/]+/.test(s)) return { input, candidates: [], error: '这不像一个网址' }
      const url = s.replace(/\/+$/, '') + '/feed'
      const id = feedIdOf(url)
      return { input, candidates: [{ url, title: new URL(s).hostname.replace(/^www\./, ''), format: 'rss', kind: 'article', via: 'link', ...(feeds.has(id) ? { subscribedAs: id } : {}) }] }
    },
    async subscribe(input) {
      if (input.url.startsWith('rsshub://') && !settings.rsshubBase) throw new Error('要先在设置里填 RSSHub 地址')
      const title = input.title ?? (input.url.startsWith('rsshub://') ? input.url.slice(9) : new URL(input.url).hostname.replace(/^www\./, ''))
      const feed = addFeedNow({ ...input, title, kind: input.kind ?? 'article' })
      if (!rows().some((r) => r.feedId === feed.id)) {
        for (let i = 0; i < 3; i++) addArticleNow(feed, { title: `${title} 的第 ${i + 1} 篇`, html: `<p>${title} 的演示文章，第 ${i + 1} 篇。</p>`, minutesAgo: 30 + i * 60 })
      }
      recount()
      emit({ what: 'feeds', feedIds: [feed.id] })
      emit({ what: 'articles', feedIds: [feed.id] })
      return { ...feed }
    },
    async unsubscribe(feedId) {
      feeds.delete(feedId)
      for (const [id, a] of arts) if (a.row.feedId === feedId && !a.row.starred && !a.row.later && !a.row.highlightCount) arts.delete(id)
      emit({ what: 'feeds', feedIds: [feedId] })
    },
    async updateFeed(feedId, patch) {
      const f = needFeed(feedId)
      if (patch.title !== undefined) f.title = patch.title.trim() || f.title
      if (patch.folderId !== undefined) f.folderId = patch.folderId
      if (patch.kind) f.kind = patch.kind
      if (patch.intervalMin !== undefined) f.intervalMin = Math.max(MIN_INTERVAL_MIN, Math.round(patch.intervalMin))
      if (patch.mode) f.mode = patch.mode
      if (patch.digestEvery !== undefined) f.digestEvery = Math.max(2, Math.round(patch.digestEvery))
      emit({ what: 'feeds', feedIds: [feedId] })
      if (patch.mode) emit({ what: 'articles', feedIds: [feedId] })
      return { ...f }
    },

    async importOpml(xml) {
      const doc = parseOpml(xml)
      const out: OpmlImportResult = { added: [], existing: [], failed: [], folders: [] }
      for (const o of doc.feeds) {
        let url: string
        try {
          url = o.url.startsWith('rsshub://') ? normalizeFeedUrl(o.url) : new URL(o.url).href
        } catch {
          out.failed.push({ url: o.url, reason: '地址不对' })
          continue
        }
        if (feeds.has(feedIdOf(url))) {
          out.existing.push(url)
          continue
        }
        let folderId: string | null = null
        if (o.folder) {
          const before = folders.size
          const f = addFolderNow(o.folder)
          if (folders.size > before) out.folders.push({ ...f })
          folderId = f.id
        }
        out.added.push({ ...addFeedNow({ url, title: o.title ?? url, kind: o.kind ?? 'article', folderId }) })
      }
      emit({ what: 'feeds' })
      emit({ what: 'folders' })
      return out
    },
    async exportOpml() {
      return writeOpml([...feeds.values()], [...folders.values()], { resolve: (u) => (u.startsWith('rsshub://') && settings.rsshubBase ? settings.rsshubBase.replace(/\/+$/, '') + '/' + u.slice(9) : u) })
    },

    async refresh(feedIds) {
      running = true
      emit({ what: 'status' })
      const list = feedIds ? feedIds.map(needFeed) : [...feeds.values()]
      let n = 0
      for (const f of list) {
        f.lastFetchedAt = now()
        f.nextFetchAt = now() + f.intervalMin * 60_000
        const k = rows().filter((r) => r.feedId === f.id).length
        addArticleNow(f, { title: `${f.title}：刚抓到的第 ${k + 1} 篇`, html: `<p>点「刷新」时假实现给每个源加一篇。</p>`, minutesAgo: 0 })
        n++
      }
      running = false
      lastRunAt = now()
      recount()
      emit({ what: 'articles', feedIds: list.map((f) => f.id) })
      emit({ what: 'status' })
      return { fetched: n, notModified: 0, failed: 0, newArticles: n }
    },
    async status() {
      const next = Math.min(...[...feeds.values()].map((f) => f.nextFetchAt ?? Infinity))
      return {
        running,
        feeds: feeds.size,
        brokenFeeds: [...feeds.values()].filter((f) => f.broken).length,
        ...(lastRunAt ? { lastRunAt } : {}),
        ...(Number.isFinite(next) ? { nextRunAt: next } : {}),
      }
    },
    startScheduler() {},
    stopScheduler() {},
    wake() {},

    async listArticles(q) {
      const page = selectPage(rows(), q, feeds)
      return { rows: page.rows.map((r) => ({ ...r })), ...(page.next ? { next: page.next } : {}) }
    },
    async getArticle(id) {
      const a = arts.get(id)
      if (!a) return null
      const d: ArticleDetail = { ...a.row, contentHtml: a.html }
      if (a.fullHtml) Object.assign(d, { fullHtml: a.fullHtml, fullFetchedAt: now() })
      return d
    },
    async readable(id, o) {
      const a = needArt(id)
      if (o?.full && !a.fullHtml) a.fullHtml = a.html + '<p>（假实现：这是「抓全文」以后的正文。）</p>'
      const html = o?.full ? a.fullHtml! : a.html
      return { articleId: id, title: a.row.title, ...(a.row.url ? { url: a.row.url } : {}), html, source: o?.full ? 'full' : 'feed', textLength: htmlToText(html).length }
    },
    async counts() {
      return countRows(rows(), feeds)
    },
    async search(query, o) {
      const q = query.trim().toLowerCase()
      if (!q) return []
      const hits: SearchHit[] = []
      for (const a of arts.values()) {
        if (o?.feedId && a.row.feedId !== o.feedId) continue
        const text = `${a.row.title}\n${htmlToText(a.html)}`
        const i = text.toLowerCase().indexOf(q)
        if (i < 0) continue
        const from = Math.max(0, i - 30)
        hits.push({ row: { ...a.row }, snippet: `${from ? '…' : ''}${text.slice(from, i)}⟪${text.slice(i, i + q.length)}⟫${text.slice(i + q.length, i + q.length + 60)}`.replace(/\n/g, ' ') })
      }
      return hits.sort((x, y) => y.row.publishedAt - x.row.publishedAt).slice(0, o?.limit ?? 50)
    },

    async markRead(ids, read = true) {
      for (const id of ids) {
        const a = arts.get(id)
        if (a) a.row.read = read
      }
      recount()
      emit({ what: 'state', articleIds: ids })
    },
    async markAllRead(scope: MarkScope, before = now()) {
      for (const a of arts.values()) {
        const f = feeds.get(a.row.feedId)
        if (!f || a.row.publishedAt > before) continue
        const hit = 'feedId' in scope ? f.id === scope.feedId : 'folderId' in scope ? f.folderId === scope.folderId : scope.view === 'all' || f.kind === scope.view
        if (hit) a.row.read = true
      }
      recount()
      emit({ what: 'state' })
    },
    async setStarred(id, on) {
      needArt(id).row.starred = on
      emit({ what: 'state', articleIds: [id] })
    },
    async setLater(id, on) {
      needArt(id).row.later = on
      emit({ what: 'state', articleIds: [id] })
    },
    async addHighlight(articleId, anchor, o) {
      const a = needArt(articleId)
      const h: Highlight = { id: `h_${++seq}`, articleId, anchor, ...(o?.note ? { note: o.note } : {}), ...(o?.color ? { color: o.color } : {}), createdAt: now(), updatedAt: now() }
      highlights.set(h.id, h)
      a.row.highlightCount++
      emit({ what: 'highlights', articleIds: [articleId] })
      return { ...h }
    },
    async updateHighlight(id, patch) {
      const h = highlights.get(id)
      if (!h) throw new Error('没有这条划线')
      if (patch.note !== undefined) {
        if (patch.note) h.note = patch.note
        else delete h.note
      }
      if (patch.color !== undefined) h.color = patch.color
      h.updatedAt = now()
      emit({ what: 'highlights', articleIds: [h.articleId] })
      return { ...h }
    },
    async removeHighlight(id) {
      const h = highlights.get(id)
      if (!h) return
      highlights.delete(id)
      const a = arts.get(h.articleId)
      if (a) a.row.highlightCount--
      emit({ what: 'highlights', articleIds: [h.articleId] })
    },
    async listHighlights(articleId) {
      return [...highlights.values()].filter((h) => !articleId || h.articleId === articleId).sort((a, b) => a.createdAt - b.createdAt).map((h) => ({ ...h }))
    },

    async getSettings() {
      return { ...settings }
    },
    async setSettings(patch) {
      settings = { ...settings, ...patch, defaultIntervalMin: Math.max(MIN_INTERVAL_MIN, patch.defaultIntervalMin ?? settings.defaultIntervalMin) }
      emit({ what: 'settings' })
      return { ...settings }
    },

    async setVault(dir) {
      vault = dir
    },
    async sync() {
      if (vault) lastSyncAt = now()
      return { dir: vault ? `${vault}/.canvas-feeds` : null, pulled: 0, pushed: 0, devices: vault ? ['fake'] : [] }
    },
    async syncStatus() {
      return {
        dir: vault ? `${vault}/.canvas-feeds` : null,
        device: 'fake',
        syncing: false,
        ...(vault && lastSyncAt ? { lastAt: lastSyncAt } : {}),
        pending: 0,
        devices: vault ? [{ id: 'fake', events: 12, lastAt: now() - 60_000 }, { id: 'iPad-3f2a', events: 40, lastAt: now() - 3 * 3600_000 }] : [],
      }
    },
    async previewSave(articleId, o?: SaveOptions) {
      const a = needArt(articleId)
      const markdown = pageClipText({ url: a.row.url ?? '', title: a.row.title, markdown: htmlToText(a.html).split('\n').join('\n\n') }, localStamp(new Date(now())))
      return { path: `${o?.folder ?? '收件箱'}/${clipFileName(a.row.title, a.row.url ?? '')}.md`, markdown }
    },
    async saveToNotes(articleId, o) {
      if (!vault) throw new Error('还没有选画布笔记的库')
      const p = await core.previewSave(articleId, o)
      const hls = o?.highlights === false ? [] : [...highlights.values()].filter((h) => h.articleId === articleId)
      let md = p.markdown + (hls.length ? `\n${HL_HEADING}\n\n${hls.map(highlightItem).join('\n')}\n` : '')
      if (o?.extra?.trim()) md = md.replace(/\s*$/, '') + '\n\n' + o.extra.trim() + '\n'
      saved.set(p.path, md)
      savedBy.set(articleId, p.path)
      return { path: p.path, files: [], commit: null }
    },
    async savedNote(articleId) {
      const p = savedBy.get(articleId)
      return p && saved.has(p) ? p : null
    },
    async appendToNote(articleId, add) {
      const path = savedBy.get(articleId)
      let text = path ? saved.get(path) : undefined
      if (!path || text === undefined) return null
      let added = 0
      if (add.highlights) {
        const r = addHighlights(text, [...highlights.values()].filter((h) => h.articleId === articleId))
        text = r.text
        added += r.added
      }
      if (add.text?.trim()) {
        text = text.replace(/\s*$/, '') + '\n\n' + add.text.trim() + '\n'
        added++
      }
      saved.set(path, text)
      return { path, added, commit: null }
    },

    onChange(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    async close() {
      listeners.clear()
    },
  }
  return core
}

type DemoFeed = { url: string; title: string; folder: string; kind: FeedKind; ago: number; items: [string, string, { image?: string; url?: string }?][] }

/** 演示用的图：两色渐变（不联网，截图每次一样）；h 是高（瀑布流里高矮不一） */
const grad = (a: string, b: string, h = 300) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="400" height="${h}" fill="url(#g)"/></svg>`)

const p = (...xs: string[]) => xs.map((x) => `<p>${x}</p>`).join('')

const DEMO: DemoFeed[] = [
  {
    url: 'https://www.ruanyifeng.com/blog/atom.xml',
    title: '阮一峰的网络日志',
    folder: '中文博客',
    kind: 'article',
    ago: 60,
    items: [
      ['科技爱好者周刊（第 374 期）：本地优先软件的第二春', p('这里记录每周值得分享的科技内容，周五发布。', '本期的封面故事是本地优先软件：数据首先存在你自己的电脑上，云端只是用来在设备之间同步。', '阅读器是最适合本地优先的一类软件：订阅源是公开的，抓取可以在自己电脑上做。')],
      ['科技爱好者周刊（第 373 期）：为什么大家又开始写博客', p('写博客的人又多了起来。', '原因之一是算法推荐让人疲惫，RSS 让读者自己决定看什么。')],
      ['科技爱好者周刊（第 372 期）：缓存的价格', p('这一期讲提示词缓存为什么能省钱。')],
    ],
  },
  {
    url: 'https://sspai.com/feed',
    title: '少数派',
    folder: '中文博客',
    kind: 'article',
    ago: 120,
    items: [
      ['我用 RSS 重新拿回了信息的主动权', p('算法推荐最大的问题，是你不知道它为什么给你看这个。', '半年前我把常看的网站、博主、播客全部换成了 RSS，一共 180 个源。', '微博、B站、X 上的账号，我用 RSSHub 转成 RSS。')],
      ['一周 App 派：五款本地优先的笔记软件', p('这周介绍五款数据存在本机的笔记软件。')],
      ['Mac 上的三栏阅读器，哪款最顺手', p('三栏布局是 Mac 阅读器的老传统：源、列表、正文。')],
    ],
  },
  {
    url: 'https://simonwillison.net/atom/everything/',
    title: 'Simon Willison',
    folder: '科技',
    kind: 'article',
    ago: 12,
    items: [
      ['Prompt caching 省下的钱，比你以为的多', p('上个月我把自己所有调用 API 的脚本都改成了带缓存的写法，然后认真地看了一遍账单。', '缓存只认「从开头起完全一样」的那一段，所以要把会变的内容放到最后。', '最后的数字：一个月花费从 412 美元降到 47 美元。')],
      ['Notes on running models locally', p('A few notes on what works on a laptop today.')],
      ['SQLite full-text search with trigrams', p('The trigram tokenizer makes substring search easy, including for Chinese text.')],
    ],
  },
  {
    url: 'https://hnrss.org/newest?points=100',
    title: 'Hacker News 100+',
    folder: '科技',
    kind: 'article',
    ago: 5,
    items: [
      ['Show HN: I read 800 feeds in 40 seconds with conditional GET', p('Most feeds answer 304 Not Modified, so a full round is cheap.')],
      ['The case for local-first software, revisited', p('Five years later, what held up.')],
      ['Why RSS never died', p('It just stopped being fashionable.')],
    ],
  },
  {
    url: 'rsshub://twitter/user/karpathy',
    title: 'X · Andrej Karpathy',
    folder: '社交',
    kind: 'social',
    ago: 30,
    items: [
      ['', p('Reading feeds with a local model summarising each one is surprisingly pleasant.')],
      ['', p('New lecture is up: building a tokenizer from scratch.')],
    ],
  },
  {
    url: 'rsshub://weibo/user/1195230310',
    title: '微博 · 宝玉',
    folder: '社交',
    kind: 'social',
    ago: 45,
    items: [
      ['', p('分享一个读论文的小技巧：先看图，再看结论，最后才看方法。')],
      ['', p('今天试了一个本地跑的阅读器，订阅数没有上限。')],
    ],
  },
  {
    url: 'rsshub://bilibili/user/video/946974',
    title: 'B站 · 影视飓风',
    folder: '视频',
    kind: 'video',
    ago: 180,
    items: [
      ['我们拍了一部 8K 的纪录片', p('这期视频讲我们怎么在冰岛拍了一部 8K 纪录片。', '00:00 开场', '02:15 为什么选冰岛', '09:40 冰川上的无人机', '16:05 后期和调色'), { image: grad('#c2417a', '#7a1f3d', 225), url: 'https://www.bilibili.com/video/BV1xx411c7mD' }],
      ['相机传感器为什么越做越大', p('从手机到全画幅，传感器尺寸这十年是怎么变的。'), { image: grad('#b04fd6', '#e0559c', 225), url: 'https://www.bilibili.com/video/BV1yy411c7mE' }],
    ],
  },
  {
    url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCHnyfMqiRRG1u-2MsSQLbXA',
    title: 'YouTube · Veritasium',
    folder: '视频',
    kind: 'video',
    ago: 300,
    items: [['The Surprising Physics of Ice', p('Why is ice slippery? The answer took 150 years.', '0:00 Intro', '3:12 The pressure theory', '8:45 What we know now'), { image: grad('#d0603f', '#c0902f', 225), url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }]],
  },
  {
    url: 'https://unsplash.com/feed',
    title: 'Unsplash 每日',
    folder: '图片',
    kind: 'picture',
    ago: 200,
    items: [
      ['黑沙滩', p('冰岛南岸的黑沙滩。'), { image: grad('#4b6cd6', '#6a3fc0', 420) }],
      ['雾中的山', p('清晨的雾。'), { image: grad('#46c08a', '#2aa7b0', 260) }],
      ['京都，秋天的岚山', p('岚山的红叶。'), { image: grad('#c98a4a', '#9aae2f', 380) }],
      ['船底座星云的一角', p('韦布望远镜拍的。'), { image: grad('#8d4fd0', '#c43aa8', 340) }],
      ['挪威，罗弗敦群岛的清晨', p('渔村和雪山。'), { image: grad('#3f8fd0', '#46c0b0', 280) }],
    ],
  },
  {
    url: 'https://feed.xyzfm.space/hzyy',
    title: '小宇宙 · 忽左忽右',
    folder: '播客',
    kind: 'audio',
    ago: 600,
    items: [['第 400 期：报纸编辑部是怎么挑头条的', p('这一期请到一位做了二十年报纸的编辑。')]],
  },
]
