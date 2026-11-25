/**
 * @cn/feeds/node：真的核心，放在 Electron 主进程（或者普通 Node 进程）里跑。
 * 本机抓（global fetch，条件请求、超时、每个站点排队），文章存 node:sqlite，同步写库里的 .canvas-feeds/<设备>.jsonl。
 * 除了「存进画布笔记」写的那一篇（和它的图），不往库里 .canvas-feeds/ 以外写任何东西。
 */
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicAppend, atomicWrite } from '@cn/atomic'
import { aiBlock, SUMMARY_LABEL } from '@cn/format'
import { commitPaths } from '@cn/git'
import type { FeedsCore, MarkScope } from '../api'
import { addHighlights, clipFileName, highlightItem, HL_HEADING, localStamp, pageClipText, replaceImages, safeName, webImages, type ClipPage } from '../clip'
import { findFeedLinks, guessUrls, knownFeeds } from '../discover'
import { decodeBody } from '../encoding'
import { feedIdOf, normalizeFeedUrl } from '../ids'
import { inferKind } from '../kind'
import { parseOpml, writeOpml } from '../opml'
import { NotAFeedError, parseFeed, type ParsedFeed } from '../parse'
import { isRoute, NeedsRsshubError, normalizeBase, resolveRoute, suggestRoutes, toRoute } from '../rsshub'
import { dueFeeds, failReason, plan, retryAfterMs } from '../schedule'
import { formatLine, parseLine, SYNC_DIR, type SyncEvent, type SyncOp } from '../sync'
import { htmlToText } from '../text'
import type {
  ChangeEvent,
  DiscoverResult,
  Feed,
  FeedCandidate,
  FeedsSettings,
  Highlight,
  OpmlImportResult,
  Readable,
  RefreshSummary,
  SaveOptions,
  SavePreview,
  SaveResult,
  SubscribeInput,
  SyncSummary,
} from '../types'
import { DEFAULT_SETTINGS, FEED_MODES, MIN_INTERVAL_MIN } from '../types'
import { jsdomExtractor, htmlToMarkdown, type PageExtractor } from './extract'
import { Http, HttpError, type HttpOptions } from './http'
import { saveImage } from './images'
import { Store } from './store'

export { Store, MIGRATIONS } from './store'
export { Http, HttpError } from './http'
export { extractPage, htmlToMarkdown, jsdomExtractor, type Extracted, type PageExtractor } from './extract'

export interface OpenFeedsOptions {
  /** 本机数据放哪（软件的设置目录，例如 ~/Library/Application Support/canvas-feeds）；里面放 feeds.sqlite */
  dataDir: string
  /** 设备名（电脑名）；核心第一次打开时在后面加 4 位随机字，存进本机库，以后一直用它（两台同名的 Mac 也不撞文件） */
  deviceName: string
  /** 画布笔记的库；null 或不给时不同步、不能存进画布笔记 */
  vaultDir?: string | null
  /** 测试用：换掉联网（默认 global fetch） */
  fetch?: typeof fetch
  /** 测试用：联网的其他参数（超时、每个站点的间隔） */
  http?: Omit<HttpOptions, 'fetch'>
  /** 测试用：现在几点（默认 Date.now） */
  now?: () => number
  /** 测试用：不给库提交（默认存进画布笔记时用 @cn/git 提交一次） */
  commit?: false | ((dir: string, paths: string[], message: string) => Promise<string | null>)
  /** 抽正文的实现（默认 jsdom + Readability，和画布笔记剪藏同一套规则）；以后抽成 packages/clip 时换这里 */
  extractor?: PageExtractor
  /** 本机操作后多久把记录写进库（毫秒，默认 3 秒；0 是马上） */
  pushDelayMs?: number
}

const ACCEPT_HTML = 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5'

export async function openFeeds(o: OpenFeedsOptions): Promise<FeedsCore> {
  await mkdir(o.dataDir, { recursive: true })
  const store = new Store(join(o.dataDir, 'feeds.sqlite'))
  const now = o.now ?? Date.now
  const http = new Http({ ...o.http, ...(o.fetch ? { fetch: o.fetch } : {}) })
  const extractor = o.extractor ?? jsdomExtractor
  const commit = o.commit === false ? null : (o.commit ?? commitPaths)
  const pushDelay = o.pushDelayMs ?? 3000

  let device = store.meta('device')
  if (!device) {
    const slug = o.deviceName.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 40) || 'mac'
    device = `${slug}-${randomBytes(3).toString('hex').slice(0, 4)}`
    store.setMeta('device', device)
  }
  const deviceId = device
  let vault: string | null = o.vaultDir ?? null
  if (vault !== (store.meta('vault') ?? null)) {
    store.resetSyncOffsets()
    if (vault) store.setMeta('vault', vault)
  }

  const listeners = new Set<(e: ChangeEvent) => void>()
  const emit = (e: ChangeEvent) => {
    for (const cb of [...listeners]) cb(e)
  }
  const bg = new Set<Promise<unknown>>()
  const track = <T>(p: Promise<T>): Promise<T> => {
    bg.add(p)
    const done = () => bg.delete(p)
    p.then(done, done)
    return p
  }

  // ------------------------------------------------------------ 设置
  const settings = (): FeedsSettings => ({ ...DEFAULT_SETTINGS, ...(JSON.parse(store.meta('settings') ?? '{}') as Partial<FeedsSettings>) })

  // ------------------------------------------------------------ 本机操作 → 一条记录
  let pushTimer: NodeJS.Timeout | null = null
  const act = (op: SyncOp) => {
    const ev = store.local(deviceId, op, now())
    if (vault && !closed) {
      if (pushTimer) clearTimeout(pushTimer)
      pushTimer = setTimeout(() => {
        pushTimer = null
        void track(syncNow().catch(() => undefined))
      }, pushDelay)
    }
    return ev
  }

  // ------------------------------------------------------------ 抓
  const inflight = new Map<string, Promise<{ ok: boolean; notModified: boolean; added: number }>>()

  async function fetchOne(id: string): Promise<{ ok: boolean; notModified: boolean; added: number }> {
    const running = inflight.get(id)
    if (running) return running
    const p = (async () => {
      const row = store.feedFetch(id)
      if (!row) return { ok: false, notModified: false, added: 0 }
      const s = settings()
      const fail = (status: number | undefined, error: string, retry?: number) => {
        const cur = store.feedFetch(id)
        if (!cur) return
        const pl = plan({ id, intervalMin: cur.interval_min, errorCount: cur.error_count }, { ok: false, ...(status ? { status } : {}), ...(retry ? { retryAfterMs: retry } : {}) }, now())
        store.setFetched(id, { last_fetched_at: now(), next_fetch_at: pl.nextFetchAt, error_count: pl.errorCount, last_error: error, broken: pl.broken ? 1 : 0 })
        return { ok: false, notModified: false, added: 0 }
      }
      let url: string
      try {
        url = resolveRoute(row.fetch_url ?? row.url, s.rsshubBase, s.rsshubAccessKey || undefined)
      } catch (e) {
        if (e instanceof NeedsRsshubError) return fail(undefined, e.message)!
        throw e
      }
      try {
        const res = await http.get(url, { etag: row.etag, lastModified: row.last_modified })
        const cur = store.feedFetch(id)
        if (!cur) return { ok: false, notModified: false, added: 0 }
        const moved = res.movedTo && !isRoute(row.url) ? { fetch_url: res.movedTo } : {}
        if (res.notModified) {
          const pl = plan({ id, intervalMin: cur.interval_min, errorCount: cur.error_count }, { ok: true }, now())
          store.setFetched(id, { ...moved, last_fetched_at: now(), next_fetch_at: pl.nextFetchAt, error_count: 0, last_error: null, broken: 0 })
          return { ok: true, notModified: true, added: 0 }
        }
        const parsed = parseFeed(decodeBody(res.body, res.headers.get('content-type')).text, res.url)
        const added = store.ingest(id, parsed, now(), s.retentionDays)
        const pl = plan({ id, intervalMin: cur.interval_min, errorCount: cur.error_count }, { ok: true, ...(parsed.ttlMin ? { ttlMin: parsed.ttlMin } : {}) }, now())
        store.setFetched(id, {
          ...moved,
          etag: res.headers.get('etag'),
          last_modified: res.headers.get('last-modified'),
          last_fetched_at: now(),
          next_fetch_at: pl.nextFetchAt,
          error_count: 0,
          last_error: null,
          broken: 0,
          ...(parsed.title ? { feed_title: parsed.title } : {}),
          ...(parsed.siteUrl ? { site_url: parsed.siteUrl } : {}),
          ...(parsed.iconUrl ? { icon_url: parsed.iconUrl } : {}),
          ...(parsed.description ? { description: parsed.description.slice(0, 500) } : {}),
        })
        if (added.length) emit({ what: 'articles', feedIds: [id], articleIds: added })
        return { ok: true, notModified: false, added: added.length }
      } catch (e) {
        if (e instanceof HttpError) return fail(e.status, e.status ? failReason({ status: e.status }) : e.message, retryAfterMs(e.headers?.get('retry-after'), now()))!
        if (e instanceof NotAFeedError) return fail(undefined, e.message)!
        return fail(undefined, `读不出这个源：${(e as Error).message}`)!
      }
    })()
    inflight.set(id, p)
    try {
      return await p
    } finally {
      inflight.delete(id)
    }
  }

  async function refreshIds(ids: string[]): Promise<RefreshSummary> {
    emit({ what: 'status' })
    const results = await Promise.all(ids.map((id) => fetchOne(id)))
    const s = settings()
    store.prune(now(), s.retentionDays, s.maxPerFeed)
    emit({ what: 'feeds', feedIds: ids })
    emit({ what: 'status' })
    return {
      fetched: results.filter((r) => r.ok).length,
      notModified: results.filter((r) => r.notModified).length,
      failed: results.filter((r) => !r.ok).length,
      newArticles: results.reduce((n, r) => n + r.added, 0),
    }
  }

  // 定时抓：到点的源一批抓完，再定下一个最早到点的时间（最多隔 5 分钟醒一次，睡醒补抓由 wake 叫）
  let timer: NodeJS.Timeout | null = null
  let schedulerOn = false
  let ticking: Promise<unknown> | null = null
  const tick = () => {
    if (!schedulerOn || ticking) return
    if (timer) clearTimeout(timer)
    timer = null
    const due = dueFeeds(
      store.allFetch().map((r) => ({ id: r.id, ...(r.next_fetch_at !== null ? { nextFetchAt: Number(r.next_fetch_at) } : {}) })),
      now(),
    ).map((f) => f.id)
    ticking = track<unknown>((due.length ? refreshIds(due) : Promise.resolve()).catch(() => undefined)).finally(() => {
      ticking = null
      if (!schedulerOn || closed) return
      const next = store.stats().nextRunAt
      const wait = next === undefined ? 300_000 : Math.min(300_000, Math.max(1000, next - now()))
      timer = setTimeout(tick, wait)
    })
  }

  // ------------------------------------------------------------ 找源
  async function tryFeed(url: string): Promise<{ parsed: ParsedFeed; finalUrl: string; headers: Headers } | { html: string; finalUrl: string } | null> {
    try {
      const res = await http.get(url, {})
      const text = decodeBody(res.body, res.headers.get('content-type')).text
      try {
        return { parsed: parseFeed(text, res.url), finalUrl: res.url, headers: res.headers }
      } catch (e) {
        if (e instanceof NotAFeedError) return { html: text, finalUrl: res.url }
        throw e
      }
    } catch {
      return null
    }
  }

  const subscribedId = (url: string) => {
    const id = feedIdOf(url)
    return store.getFeed(id) ? id : undefined
  }

  const candidateOf = (url: string, parsed: ParsedFeed | null, via: FeedCandidate['via'], title?: string): FeedCandidate => {
    const sub = subscribedId(url)
    const t = parsed?.title || title
    return { url, ...(t ? { title: t } : {}), ...(parsed ? { format: parsed.format } : {}), kind: inferKind(url, parsed ?? undefined), via, ...(sub ? { subscribedAs: sub } : {}) }
  }

  async function discover(input: string): Promise<DiscoverResult> {
    let s = input.trim()
    const base = settings().rsshubBase
    if (!s) return { input, candidates: [], error: '先粘一个网址' }
    if (isRoute(s)) {
      const url = normalizeFeedUrl(s)
      return { input, candidates: [{ ...candidateOf(url, null, 'rsshub'), ...(base ? {} : { needsRsshub: true }) }] }
    }
    if (!/^https?:\/\//i.test(s)) {
      if (!/^[\w-]+(\.[\w-]+)+/.test(s)) return { input, candidates: [], error: '这不像一个网址' }
      s = 'https://' + s
    }
    const route = toRoute(s, base)
    if (route) return { input, candidates: [{ ...candidateOf(normalizeFeedUrl(route), null, 'rsshub'), ...(base ? {} : { needsRsshub: true }) }] }
    const out: FeedCandidate[] = []
    const seen = new Set<string>()
    const add = (c: FeedCandidate) => {
      if (seen.has(c.url)) return
      seen.add(c.url)
      out.push(c)
    }
    for (const r of suggestRoutes(s)) add({ ...candidateOf(r.url, null, 'rsshub', r.title), kind: r.kind, ...(r.hint ? { hint: r.hint } : {}), ...(base ? {} : { needsRsshub: true }) })
    if (out.length) return { input, candidates: out }
    for (const k of knownFeeds(s)) {
      const got = await tryFeed(k.url)
      if (got && 'parsed' in got) add(candidateOf(k.url, got.parsed, 'guess', k.title))
    }
    if (out.length) return { input, candidates: out }
    const page = await tryFeed(s)
    if (!page) return { input, candidates: [], error: '这个网址打不开' }
    if ('parsed' in page) return { input, candidates: [candidateOf(normalizeFeedUrl(s), page.parsed, 'direct')] }
    const links = findFeedLinks(page.html, page.finalUrl).slice(0, 6)
    for (const l of links) {
      const got = await tryFeed(l.url)
      if (got && 'parsed' in got) add(candidateOf(l.url, got.parsed, l.via, l.title))
    }
    if (!out.length) {
      for (const g of guessUrls(page.finalUrl).slice(0, 8)) {
        const got = await tryFeed(g)
        if (got && 'parsed' in got) add(candidateOf(g, got.parsed, 'guess'))
        if (out.length >= 2) break
      }
    }
    return out.length ? { input, candidates: out } : { input, candidates: [], error: '这个网页里没找到订阅源' }
  }

  // ------------------------------------------------------------ 存进画布笔记
  async function fullOf(id: string): Promise<NonNullable<ReturnType<Store['full']>>> {
    const cached = store.full(id)
    if (cached) return cached
    const art = store.article(id)
    if (!art?.url) throw new Error('这篇没有原网页的地址')
    const res = await http.get(art.url, { accept: ACCEPT_HTML })
    const page = extractor.extract(decodeBody(res.body, res.headers.get('content-type')).text, res.url)
    const full = { html: page.html, markdown: page.markdown, url: page.url, title: page.title, ...(page.byline ? { byline: page.byline } : {}), ...(page.siteName ? { siteName: page.siteName } : {}) }
    store.setFull(id, full, now())
    emit({ what: 'articles', articleIds: [id] })
    return full
  }

  function inboxOf(dir: string): string {
    if (!existsSync(join(dir, '收件箱')) && existsSync(join(dir, 'Inbox'))) return 'Inbox'
    return '收件箱'
  }

  async function buildNote(id: string, opts: SaveOptions = {}): Promise<{ page: ClipPage; text: string; folder: string }> {
    const art = store.article(id)
    if (!art) throw new Error('没有这篇文章')
    const feed = store.getFeed(art.feedId)
    let page: ClipPage
    if (opts.fullText !== false && art.url) {
      const full = await fullOf(id)
      page = { url: full.url || art.url, title: full.title || art.title, markdown: full.markdown, ...(full.byline ? { byline: full.byline } : {}) }
    } else {
      const url = art.url ?? feed?.siteUrl ?? ''
      page = { url, title: art.title || art.summary.slice(0, 40), markdown: htmlToMarkdown(art.contentHtml, url || 'https://localhost/'), ...(art.author ? { byline: art.author } : {}) }
    }
    let text = pageClipText(page, localStamp(new Date(now())))
    if (opts.summary?.text.trim()) {
      // AI 摘要放在来源行下面一段
      const block = aiBlock(opts.summary.text.trim(), { label: SUMMARY_LABEL, ...(opts.summary.by ? { by: opts.summary.by } : {}) })
      const i = text.indexOf('\n\n', text.indexOf('\n—— ['))
      text = i < 0 ? text + '\n' + block + '\n' : text.slice(0, i + 2) + block + '\n\n' + text.slice(i + 2)
    }
    const hls = opts.highlights === false ? [] : store.highlights(id)
    if (hls.length) text += `\n${HL_HEADING}\n\n` + hls.map(highlightItem).join('\n') + '\n'
    if (opts.extra?.trim()) text = text.replace(/\s*$/, '') + '\n\n' + opts.extra.trim() + '\n'
    const folder = (opts.folder ?? (vault ? inboxOf(vault) : '收件箱')).replace(/^\/+|\/+$/g, '')
    return { page, text, folder }
  }

  /** 存过的那一篇：本机库里记着「哪个库、库内路径」（不同步：别的设备的库在别处） */
  const savedPath = (id: string): string | null => {
    const raw = store.meta(`saved:${id}`)
    if (!raw || !vault) return null
    const s = JSON.parse(raw) as { vault: string; path: string }
    return s.vault === vault && existsSync(join(vault, s.path)) ? s.path : null
  }

  const notePath = (folder: string, name: string, n: number) => `${folder ? folder + '/' : ''}${safeName(name)}${n > 1 ? ` ${n}` : ''}.md`

  // ------------------------------------------------------------ 同步
  let syncing: Promise<SyncSummary> | null = null
  /** 上一次同步：什么时候、没成的原因（底栏的同步状态） */
  let lastSync: { at: number; error?: string } | null = null
  function syncNow(): Promise<SyncSummary> {
    if (syncing) return syncing.then(() => syncNow())
    syncing = (async (): Promise<SyncSummary> => {
      if (!vault) return { dir: null, pulled: 0, pushed: 0, devices: [] }
      const dir = join(vault, SYNC_DIR)
      await mkdir(dir, { recursive: true })
      const own = join(dir, `${deviceId}.jsonl`)
      // 写出去：自己那份里最大的序号之后的本机记录
      const cur = await readFile(own, 'utf8').catch((e: NodeJS.ErrnoException) => {
        if (e.code === 'ENOENT') return ''
        throw e
      })
      let maxSeq = 0
      for (const line of cur.split('\n')) {
        const ev = parseLine(line)
        if (ev && ev.d === deviceId && ev.s > maxSeq) maxSeq = ev.s
      }
      const out = store.ownEvents(deviceId, maxSeq)
      if (out.length) await atomicAppend(own, (cur && !cur.endsWith('\n') ? '\n' : '') + out.map(formatLine).join(''))
      store.setMeta(`pushed:${vault}`, String(out.length ? out[out.length - 1]!.s : maxSeq))
      // 读进来：别的设备的文件，从上次读到的地方往后（文件变短了从头读）
      let pulled = 0
      const devices: string[] = []
      const changed = new Set<ChangeEvent['what']>()
      for (const name of (await readdir(dir)).sort()) {
        if (!name.endsWith('.jsonl')) continue
        const dev = name.slice(0, -6)
        devices.push(dev)
        if (dev === deviceId) continue
        const file = join(dir, name)
        const size = (await stat(file)).size
        let offset = store.syncOffset(dev)
        if (size < offset) offset = 0
        if (size === offset) continue
        const buf = await readFile(file)
        const chunk = buf.subarray(offset)
        const end = chunk.lastIndexOf(0x0a)
        if (end < 0) continue
        const lines = chunk.subarray(0, end + 1).toString('utf8').split('\n')
        store.tx(() => {
          for (const line of lines) {
            const ev = parseLine(line)
            if (!ev) continue
            if (store.apply(ev)) {
              pulled++
              changed.add(whatOf(ev))
            }
          }
          store.setSyncOffset(dev, offset + end + 1)
        })
      }
      for (const what of changed) emit({ what })
      if (changed.has('feeds') && schedulerOn) tick()
      return { dir, pulled, pushed: out.length, devices }
    })()
    const p = syncing.then(
      (r) => ((lastSync = { at: now() }), r),
      (e: unknown) => {
        lastSync = { at: now(), error: String((e as Error)?.message ?? e) }
        throw e
      },
    )
    syncing = p
    return p.finally(() => {
      if (syncing === p) syncing = null
      emit({ what: 'status' })
    })
  }

  let closed = false

  const core: FeedsCore = {
    deviceId,

    async listFolders() {
      return store.listFolders()
    },
    async addFolder(name) {
      const folders = store.listFolders()
      const id = 'd_' + randomBytes(6).toString('hex')
      act({ op: 'folder', id, name: name.trim() || '新文件夹', order: folders.length ? Math.max(...folders.map((f) => f.order)) + 1 : 0 })
      emit({ what: 'folders' })
      return store.listFolders().find((f) => f.id === id)!
    },
    async renameFolder(id, name) {
      if (!store.folderExists(id)) throw new Error('没有这个文件夹')
      if (name.trim()) act({ op: 'folder', id, name: name.trim() })
      emit({ what: 'folders' })
    },
    async removeFolder(id) {
      act({ op: 'unfolder', id })
      emit({ what: 'folders' })
      emit({ what: 'feeds' })
    },
    async reorderFolders(ids) {
      store.tx(() => ids.forEach((id, order) => store.folderExists(id) && act({ op: 'folder', id, order })))
      emit({ what: 'folders' })
    },

    async listFeeds() {
      return store.listFeeds()
    },
    async getFeed(id) {
      return store.getFeed(id)
    },
    discover,
    async subscribe(input: SubscribeInput): Promise<Feed> {
      const s = settings()
      let url = input.url.trim()
      if (!isRoute(url) && !/^https?:\/\//i.test(url)) url = 'https://' + url
      url = normalizeFeedUrl(toRoute(url, s.rsshubBase) ?? url)
      const existing = store.getFeed(feedIdOf(url))
      if (existing) return existing
      let parsed: ParsedFeed | null = null
      let fetchedFrom: string | null = null
      let headers: Headers | null = null
      const target = isRoute(url) ? resolveRoute(url, s.rsshubBase, s.rsshubAccessKey || undefined) : url
      const got = await tryFeed(target)
      if (!got) throw new Error(isRoute(url) ? '你的 RSSHub 没有回这个路由（地址填对了吗？实例开着吗？）' : '这个地址打不开')
      if ('parsed' in got) {
        parsed = got.parsed
        fetchedFrom = got.finalUrl
        headers = got.headers
      } else {
        // 给的是网页：找页里的第一个源
        const found = await discover(url)
        const first = found.candidates.find((c) => !c.needsRsshub)
        if (!first) throw new Error(found.error ?? '这个网页里没找到订阅源')
        if (first.subscribedAs) return store.getFeed(first.subscribedAs)!
        return core.subscribe({ ...input, url: first.url, ...(input.title || !first.title ? {} : { title: first.title }) })
      }
      const id = feedIdOf(url)
      act({
        op: 'sub',
        feed: {
          id,
          url,
          title: (input.title ?? parsed.title ?? '').trim() || (parsed.siteUrl ? new URL(parsed.siteUrl).hostname : url),
          kind: input.kind ?? inferKind(url, parsed),
          folderId: input.folderId ?? null,
          intervalMin: Math.max(MIN_INTERVAL_MIN, Math.round(input.intervalMin ?? s.defaultIntervalMin)),
          ...(parsed.siteUrl ? { siteUrl: parsed.siteUrl } : {}),
        },
      })
      // 刚抓的这一份直接进库，不再抓第二次
      const added = store.ingest(id, parsed, now(), s.retentionDays)
      const pl = plan({ id, intervalMin: input.intervalMin ?? s.defaultIntervalMin, errorCount: 0 }, { ok: true }, now())
      store.setFetched(id, {
        last_fetched_at: now(),
        next_fetch_at: pl.nextFetchAt,
        etag: headers?.get('etag') ?? null,
        last_modified: headers?.get('last-modified') ?? null,
        ...(fetchedFrom && fetchedFrom !== target && !isRoute(url) ? { fetch_url: fetchedFrom } : {}),
        ...(parsed.title ? { feed_title: parsed.title } : {}),
        ...(parsed.iconUrl ? { icon_url: parsed.iconUrl } : {}),
        ...(parsed.description ? { description: parsed.description.slice(0, 500) } : {}),
      })
      emit({ what: 'feeds', feedIds: [id] })
      if (added.length) emit({ what: 'articles', feedIds: [id], articleIds: added })
      return store.getFeed(id)!
    },
    async unsubscribe(feedId) {
      act({ op: 'unsub', feedId })
      emit({ what: 'feeds', feedIds: [feedId] })
      emit({ what: 'articles', feedIds: [feedId] })
    },
    async updateFeed(feedId, patch) {
      if (!store.getFeed(feedId)) throw new Error('没有这个源')
      const op: SyncOp = { op: 'feed', feedId }
      if (patch.title !== undefined && patch.title.trim()) op.title = patch.title.trim()
      if (patch.folderId !== undefined) op.folderId = patch.folderId
      if (patch.kind) op.kind = patch.kind
      if (patch.intervalMin !== undefined) op.intervalMin = Math.max(MIN_INTERVAL_MIN, Math.round(patch.intervalMin))
      if (patch.mode && FEED_MODES.includes(patch.mode)) op.mode = patch.mode
      if (patch.digestEvery !== undefined) op.digestEvery = Math.max(2, Math.min(200, Math.round(patch.digestEvery)))
      act(op)
      if (patch.intervalMin !== undefined) {
        const f = store.feedFetch(feedId)!
        store.setFetched(feedId, { next_fetch_at: Math.min(f.next_fetch_at ?? Infinity, now() + Math.max(MIN_INTERVAL_MIN, patch.intervalMin) * 60_000) })
      }
      emit({ what: 'feeds', feedIds: [feedId] })
      // 换了进不进列表：列表要重读
      if (patch.mode !== undefined) emit({ what: 'articles', feedIds: [feedId] })
      return store.getFeed(feedId)!
    },

    async importOpml(xml) {
      const doc = parseOpml(xml)
      const s = settings()
      const out: OpmlImportResult = { added: [], existing: [], failed: [], folders: [] }
      const folders = new Map(store.listFolders().map((f) => [f.name, f.id]))
      store.tx(() => {
        for (const f of doc.feeds) {
          let url: string
          if (isRoute(f.url)) url = normalizeFeedUrl(f.url)
          else {
            try {
              const u = new URL(f.url)
              if (!/^https?:$/.test(u.protocol)) throw new Error()
              url = normalizeFeedUrl(toRoute(u.href, s.rsshubBase) ?? u.href)
            } catch {
              out.failed.push({ url: f.url, reason: '地址不对' })
              continue
            }
          }
          const id = feedIdOf(url)
          if (store.getFeed(id) || out.added.some((a) => a.id === id)) {
            out.existing.push(url)
            continue
          }
          let folderId: string | null = null
          if (f.folder) {
            folderId = folders.get(f.folder) ?? null
            if (!folderId) {
              folderId = 'd_' + randomBytes(6).toString('hex')
              act({ op: 'folder', id: folderId, name: f.folder, order: folders.size })
              folders.set(f.folder, folderId)
              out.folders.push(store.listFolders().find((x) => x.id === folderId)!)
            }
          }
          act({ op: 'sub', feed: { id, url, title: f.title || url, kind: f.kind ?? inferKind(url), folderId, intervalMin: s.defaultIntervalMin, ...(f.siteUrl ? { siteUrl: f.siteUrl } : {}) } })
          out.added.push(store.getFeed(id)!)
        }
      })
      emit({ what: 'folders' })
      emit({ what: 'feeds' })
      // 新订的从来没抓过，定时器一转就到点
      if (schedulerOn && out.added.length) tick()
      return out
    },
    async exportOpml() {
      const s = settings()
      return writeOpml(store.listFeeds(), store.listFolders(), { resolve: (u) => (isRoute(u) && normalizeBase(s.rsshubBase) ? resolveRoute(u, s.rsshubBase) : u) })
    },

    async refresh(feedIds) {
      return refreshIds(feedIds ?? store.allFetch().map((r) => r.id))
    },
    async status() {
      const st = store.stats()
      return { running: inflight.size > 0, feeds: st.feeds, brokenFeeds: st.broken, ...(st.lastRunAt !== undefined ? { lastRunAt: st.lastRunAt } : {}), ...(st.nextRunAt !== undefined ? { nextRunAt: st.nextRunAt } : {}) }
    },
    startScheduler() {
      if (schedulerOn || closed) return
      schedulerOn = true
      tick()
    },
    stopScheduler() {
      schedulerOn = false
      if (timer) clearTimeout(timer)
      timer = null
    },
    wake() {
      tick()
    },

    async listArticles(q) {
      return store.listArticles(q)
    },
    async getArticle(id) {
      return store.article(id)
    },
    async readable(id, opts): Promise<Readable> {
      const art = store.article(id)
      if (!art) throw new Error('没有这篇文章')
      const base = { articleId: id, title: art.title, ...(art.url ? { url: art.url } : {}), ...(art.author ? { byline: art.author } : {}) }
      if (!opts?.full) return { ...base, html: art.contentHtml, source: 'feed', textLength: htmlToText(art.contentHtml).length }
      const full = await fullOf(id)
      return { ...base, ...(full.byline ? { byline: full.byline } : {}), ...(full.siteName ? { siteName: full.siteName } : {}), html: full.html, source: 'full', textLength: htmlToText(full.html).length }
    },
    async counts() {
      return store.counts()
    },
    async search(query, opts) {
      return store.search(query, opts?.limit, opts?.feedId)
    },

    async markRead(ids, read = true) {
      const all = store.withDuplicates(ids)
      if (!all.length) return
      act({ op: 'read', ids: all, on: read })
      emit({ what: 'state', articleIds: all })
    },
    async markAllRead(scope: MarkScope, before = now()) {
      const feedIds = store.feedsIn(scope)
      if (!feedIds.length) return
      act({ op: 'readAll', feedIds, before })
      emit({ what: 'state', feedIds })
    },
    async setStarred(id, on) {
      const art = store.snapOf(id)
      act({ op: 'star', id, on, ...(art ? { art } : {}) })
      emit({ what: 'state', articleIds: [id] })
    },
    async setLater(id, on) {
      const art = store.snapOf(id)
      act({ op: 'later', id, on, ...(art ? { art } : {}) })
      emit({ what: 'state', articleIds: [id] })
    },
    async addHighlight(articleId, anchor, opts) {
      const art = store.snapOf(articleId)
      if (!art) throw new Error('没有这篇文章')
      const t = now()
      const h: Highlight = { id: 'h_' + randomBytes(8).toString('hex'), articleId, anchor, ...(opts?.note ? { note: opts.note } : {}), ...(opts?.color ? { color: opts.color } : {}), createdAt: t, updatedAt: t }
      act({ op: 'hl', h, art })
      emit({ what: 'highlights', articleIds: [articleId] })
      return h
    },
    async updateHighlight(id, patch) {
      const old = store.highlights().find((h) => h.id === id)
      if (!old) throw new Error('没有这条划线')
      const h: Highlight = { ...old, updatedAt: now() }
      if (patch.note !== undefined) {
        if (patch.note) h.note = patch.note
        else delete h.note
      }
      if (patch.color !== undefined) h.color = patch.color
      act({ op: 'hl', h })
      emit({ what: 'highlights', articleIds: [h.articleId] })
      return h
    },
    async removeHighlight(id) {
      const old = store.highlights().find((h) => h.id === id)
      if (!old) return
      act({ op: 'unhl', id, articleId: old.articleId })
      emit({ what: 'highlights', articleIds: [old.articleId] })
    },
    async listHighlights(articleId) {
      return store.highlights(articleId)
    },

    async getSettings() {
      return settings()
    },
    async setSettings(patch) {
      const next: FeedsSettings = { ...settings(), ...patch }
      next.rsshubBase = normalizeBase(next.rsshubBase)
      next.defaultIntervalMin = Math.max(MIN_INTERVAL_MIN, Math.round(next.defaultIntervalMin))
      next.retentionDays = Math.max(7, Math.round(next.retentionDays))
      next.maxPerFeed = Math.max(50, Math.round(next.maxPerFeed))
      store.setMeta('settings', JSON.stringify(next))
      emit({ what: 'settings' })
      return next
    },

    async setVault(dir) {
      if (dir === vault) return
      vault = dir
      store.resetSyncOffsets()
      if (dir) store.setMeta('vault', dir)
      if (dir) await syncNow()
    },
    sync: () => syncNow(),
    async syncStatus() {
      const pushed = vault ? Number(store.meta(`pushed:${vault}`) ?? 0) : 0
      return {
        dir: vault ? join(vault, SYNC_DIR) : null,
        device: deviceId,
        syncing: !!syncing,
        ...(lastSync ? { lastAt: lastSync.at, ...(lastSync.error ? { lastError: lastSync.error } : {}) } : {}),
        pending: vault ? Math.max(0, store.ownSeq(deviceId) - pushed) : 0,
        devices: store.deviceStats(),
      }
    },
    async previewSave(articleId, opts): Promise<SavePreview> {
      const { page, text, folder } = await buildNote(articleId, opts)
      const name = clipFileName(page.title, page.url)
      let n = 1
      while (vault && existsSync(join(vault, notePath(folder, name, n)))) n++
      return { path: notePath(folder, name, n), markdown: text }
    },
    async saveToNotes(articleId, opts): Promise<SaveResult> {
      if (!vault) throw new Error('还没有选画布笔记的库')
      const root = vault
      const { page, text, folder } = await buildNote(articleId, opts)
      const name = clipFileName(page.title, page.url)
      await mkdir(join(root, folder), { recursive: true })
      let path = ''
      for (let n = 1; ; n++) {
        path = notePath(folder, name, n)
        try {
          await atomicWrite(join(root, path), text, { exclusive: true })
          break
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
        }
      }
      const files: string[] = []
      if (opts?.images !== false) {
        const urls = webImages(text)
        const saved = new Map<string, string>()
        const deadline = now() + 25_000
        let next = 0
        const worker = async () => {
          while (next < urls.length && now() < deadline) {
            const url = urls[next++]!
            try {
              saved.set(url, await saveImage(http, root, path, url))
            } catch {
              // 下不到的留网址，文档里照样显示网上的图
            }
          }
        }
        await Promise.all(Array.from({ length: Math.min(4, urls.length) }, worker))
        if (saved.size) {
          await atomicWrite(join(root, path), replaceImages(text, path, saved))
          files.push(...new Set(saved.values()))
        }
      }
      const hash = commit ? await commit(root, [path, ...files], `存进画布笔记：${page.title.slice(0, 60) || page.url}`) : null
      store.setMeta(`saved:${articleId}`, JSON.stringify({ vault: root, path }))
      return { path, files, commit: hash }
    },
    async savedNote(articleId) {
      return savedPath(articleId)
    },
    async appendToNote(articleId, add) {
      const path = savedPath(articleId)
      if (!path || !vault) return null
      const root = vault
      const abs = join(root, path)
      let text = await readFile(abs, 'utf8')
      let added = 0
      if (add.highlights) {
        const r = addHighlights(text, store.highlights(articleId))
        text = r.text
        added += r.added
      }
      if (add.text?.trim()) {
        text = text.replace(/\s*$/, '') + '\n\n' + add.text.trim() + '\n'
        added++
      }
      if (!added) return { path, added, commit: null }
      await atomicWrite(abs, text)
      const title = store.article(articleId)?.title ?? path
      const hash = commit ? await commit(root, [path], add.message ?? `补进画布笔记：${title.slice(0, 60)}`) : null
      return { path, added, commit: hash }
    },

    onChange(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    async close() {
      if (closed) return
      core.stopScheduler()
      closed = true
      if (pushTimer) clearTimeout(pushTimer)
      pushTimer = null
      while (bg.size) await Promise.allSettled([...bg])
      if (vault) await syncNow().catch(() => undefined)
      listeners.clear()
      store.close()
    },
  }
  return core
}

function whatOf(ev: SyncEvent): ChangeEvent['what'] {
  switch (ev.op) {
    case 'sub':
    case 'unsub':
    case 'feed':
      return 'feeds'
    case 'folder':
    case 'unfolder':
      return 'folders'
    case 'hl':
    case 'unhl':
      return 'highlights'
    default:
      return 'state'
  }
}

