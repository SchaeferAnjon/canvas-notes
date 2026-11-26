/**
 * 看视频（方向 A「视频条」）主进程这半：右栏网页开到 YouTube / B 站的视频页时，
 * 读播放器自己取到的字幕（tap.ts）、交给双语翻译插件的翻译服务翻（同一个引擎、同一份缓存），推给网页预加载画在画面上；
 * 记下这一刻（截帧、存图、给回 md）、框一块问 AI、字幕全文存进「素材/视频」并让 AI 写摘要。
 * 界面那半在 renderer/video/，网页里那半在 preload/video.ts。
 */
import { commitPaths } from '@cn/git'
import { revertRetry } from '../git-retry'
import { app, type BrowserWindow, ipcMain, type IpcMainInvokeEvent, nativeImage, type Session, type WebContents } from 'electron'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { errorTitle, langName, type TrError, videoTarget } from '../../shared/plugins/translate'
import {
  askCalloutEnd,
  askHead,
  attachDir,
  biliTracks,
  type Chapter,
  type Cue,
  cuesAround,
  cuesBetween,
  followMd,
  partialAnswer,
  type Dest,
  fmtTime,
  momentMd,
  parseBiliSubtitle,
  parseSummary,
  parseYtCaptions,
  pickTrack,
  readCues,
  readTranslations,
  replaceSummary,
  relLink,
  safeTitle,
  setVideoTestOrigin,
  subtitleDoc,
  SUMMARY_FAILED,
  SUMMARY_WRITING,
  timeSlug,
  timeUrl,
  type Track,
  trackId,
  VIDEO_FOLDER,
  videoCardMd,
  type VideoMeta,
  videoOf,
  type VideoRef,
  watchUrl,
  webVideoRef,
  ytTracks,
} from '../../shared/video'
import { type AskRequest, type AskResult, type Box, FIXED_KEYS, keyLabel, type MomentMark, type MomentResult, type PeekResult, type VideoSettings, type VideoState } from '../../shared/video-api'
import { CLAUDE_DEFAULT, pickLabel } from '@cn/ai-engines/shared'
import { answerLangName, answerRule } from '../../shared/answer-lang'
import { CITE_RULE } from '../../shared/cite-rule'
import { askFast } from '../ai'
import { comboOf } from '../../shared/cmd-keys'
import { pageKeysNow } from '../commands'
import { findCli, INSTALL_HINT } from '@cn/ai-engines'
import { FAST_MODEL, fastEngine, modelOpt, visionModel } from '../agent'
import { classify } from '../plugins/translate/errors'
import { isCli } from '@cn/ai-engines/shared'

/** 翻译那张表认得的家（命令行四家、DeepSeek）：出错时写它的名字，别的写「AI」 */
const trEngine = (id: string) => (isCli(id) || id === 'deepseek' ? id : undefined)
import { aiCallout, calloutWords } from '@cn/format'
import { askWithImage } from '../mindmap/vision'
import { translateService } from '../plugins/translate/service'
import type { Vault } from '../vault'
import { biliInfo, currentTime, grabFrame, videoRect, ytInfo, ytLoadTrack } from './page'
import { VideoStore } from './store'
import { dbg } from './log'
import { onTapped, tap } from '../web/tap'
import { readSttCues, savedSttTrack, setSttKey, setupStt, startStt, sttKeyStatus, sttState, stopStt } from './stt'
import { parseVtt } from './transcribe'
import { atomicWrite } from '@cn/atomic'
import { INBOX } from '../../shared/layout'

interface Sess {
  wc: WebContents
  ref: VideoRef
  meta: VideoMeta
  tracks: Track[]
  track: Track | null
  needLogin: boolean
  subs: VideoState['subs']
  error?: string
  cues: Cue[]
  chapters: Chapter[]
  target: string | null
  translated: number
  /** 这一轮翻完了还没翻成的句数（重试前一直报着） */
  trFailed: number
  /** 没翻成的原因（第一种） */
  trError?: string
  /** 引擎的原话 */
  trRaw?: string
  /** 正在翻（翻完、停了都是 false） */
  translating: boolean
  /** 用户在视频条上关了字幕（只这一个视频） */
  off: boolean
  ac: AbortController
  material: string | null
  summary: { t: number; text: string }[] | null
  summaryNote?: string
  /** 这个视频是 B 站的哪个 cid（播放器接口按它对） */
  cid?: number
  /** YouTube 播放器自己取字幕的地址（带 pot），换语言时照它取 */
  ytTemplate?: string
  /** 这个网页又整页打开了一次同一个视频（重新载入、地址栏回车）：认网址时重新读字幕轨 */
  reopen?: boolean
}

interface Deps {
  window(): BrowserWindow | null
  vault(): Vault | null
  ses: Session
  userData: string
}

let deps: Deps
let store: VideoStore
const sessions = new Map<number, Sess>()
/** 每个网页最近拿到的 B 站字幕列表：cid → 列表 */
const biliLists = new Map<number, Map<number, ReturnType<typeof biliTracks>>>()
const waiters = new Map<number, () => void>()

const send = (ch: string, ...args: unknown[]) => deps.window()?.webContents.send(ch, ...args)
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((r, j) => {
    const t = setTimeout(r, ms)
    signal?.addEventListener('abort', () => (clearTimeout(t), j(Object.assign(new Error('停下了'), { name: 'AbortError' }))))
  })

function needVault(): Vault {
  const v = deps.vault()
  if (!v) throw new Error('还没有打开库')
  return v
}

// ---------------------------------------------------------------- 状态推给界面和网页

function stateOf(s: Sess): VideoState {
  const rec = store.get(s.ref.key)
  return {
    wcId: s.wc.id,
    key: s.ref.key,
    site: s.ref.site,
    id: s.ref.id,
    ...(s.ref.p ? { p: s.ref.p } : {}),
    ...(s.ref.url ? { url: s.ref.url } : {}),
    title: s.meta.title,
    channel: s.meta.channel,
    duration: s.meta.duration,
    tracks: s.tracks,
    track: s.track ? trackId(s.track) : null,
    subs: s.subs,
    ...(s.error ? { error: s.error } : {}),
    target: s.target,
    translated: s.translated,
    total: s.cues.length,
    translating: s.translating,
    trFailed: s.trFailed,
    ...(s.trError ? { trError: s.trError } : {}),
    ...(s.trRaw ? { trRaw: s.trRaw } : {}),
    summary: s.summary ? 'done' : s.summaryNote ? 'error' : s.cues.length ? 'writing' : 'none',
    moments: rec?.moments ?? [],
    material: s.material,
    chapters: s.chapters,
    off: s.off,
    stt: sttState(s.ref.key),
    sttKey: sttKeyStatus().has,
  }
}

let stateTimer: ReturnType<typeof setTimeout> | null = null
const dirty = new Set<number>()
/** 推状态：翻译时一秒好多次，攒 300 毫秒推一次 */
function pushState(s: Sess, now = false) {
  dirty.add(s.wc.id)
  if (now) return flushState()
  if (!stateTimer) stateTimer = setTimeout(flushState, 300)
}
function flushState() {
  if (stateTimer) clearTimeout(stateTimer)
  stateTimer = null
  for (const id of dirty) {
    const s = sessions.get(id)
    send('video:state', id, s ? stateOf(s) : null)
  }
  dirty.clear()
}

/** 网页预加载画字幕要的：每条 [开始, 结束, 原文, 译文]、怎么显示、放哪、译文样式 */
function pushSubs(s: Sess) {
  if (s.wc.isDestroyed()) return
  const set = store.settings()
  const style = translateService()?.style() ?? 'plain'
  s.wc.send('video:subs', {
    key: s.ref.key,
    cues: s.cues.map((c) => [c.start, c.end, c.text, c.tr ?? '']),
    mode: s.off ? 'off' : set.mode,
    place: set.place,
    style,
    site: s.ref.site,
  })
}

let trTimer: ReturnType<typeof setTimeout> | null = null
const trPending = new Map<number, [number, string][]>()
function pushTr(s: Sess, i: number, tr: string) {
  const list = trPending.get(s.wc.id) ?? []
  list.push([i, tr])
  trPending.set(s.wc.id, list)
  if (!trTimer)
    trTimer = setTimeout(() => {
      trTimer = null
      for (const [id, l] of trPending) {
        const x = sessions.get(id)
        if (x && !x.wc.isDestroyed()) x.wc.send('video:tr', { key: x.ref.key, list: l })
      }
      trPending.clear()
    }, 250)
}

// ---------------------------------------------------------------- 打开一个视频

function onUrl(wc: WebContents, url: string) {
  const ref = videoOf(url)
  const cur = sessions.get(wc.id)
  // 别的网站的视频：只改了 # 后面的（网页里跳到某一段），还是这个视频
  if (!ref && cur?.ref.site === 'web' && /^https?:/.test(url) && webVideoRef(url).key === cur.ref.key) return
  if (cur && ref && cur.ref.key === ref.key) {
    // 同一个视频又打开了一次：整页重新打开的（重新载入、地址栏回车），或者上次没读到字幕轨（网站当时没给、在放广告）、网站里又点开它，
    // 重新读一遍字幕轨（以前一律当没换，第一次没读到就一直「没有字幕」）。正在读的不打断
    const failed = cur.subs === 'none' || cur.subs === 'error' || cur.subs === 'login'
    if (cur.reopen || failed) reloadTracks(cur)
    return
  }
  if (cur) {
    cur.ac.abort()
    sessions.delete(wc.id)
  }
  dbg('onUrl', wc.id, ref?.key ?? null, cur ? `换掉 ${cur.ref.key}` : '')
  if (!ref) {
    if (cur) {
      send('video:state', wc.id, null)
      if (!wc.isDestroyed()) wc.send('video:subs', null)
    }
    return
  }
  startSess(wc, ref)
}

/** 开一个视频的会话：读说明、字幕轨，翻字幕（YouTube、B 站按网址认出来；别的网站由网页预加载报来，见 onFound） */
function startSess(wc: WebContents, ref: VideoRef, found?: Found) {
  const rec = store.get(ref.key)
  const s: Sess = {
    wc,
    ref,
    meta: found ? { title: found.title, channel: found.host, duration: found.duration } : { title: rec?.title ?? '', channel: rec?.channel ?? '', duration: rec?.duration ?? 0 },
    tracks: found ? found.tracks : [],
    track: null,
    needLogin: false,
    subs: 'loading',
    cues: [],
    chapters: [],
    target: null,
    translated: 0,
    trFailed: 0,
    translating: false,
    off: !store.settings().autoSubs,
    ac: new AbortController(),
    material: rec?.material && existsSync(join(deps.vault()?.root ?? '/nonexistent', rec.material)) ? rec.material : null,
    summary: null,
  }
  sessions.set(wc.id, s)
  pushState(s, true)
  pushSubs(s)
  void tap(wc)
  void load(s).catch((e) => {
    if ((e as Error).name === 'AbortError') return
    s.subs = 'error'
    s.error = (e as Error).message
    pushState(s)
  })
}

/** 同一个视频重新读字幕轨（重新打开了一次）：停下正在做的，从播放器读起；摘要、字幕全文那一篇留着 */
function reloadTracks(s: Sess) {
  dbg('reload', s.wc.id, s.ref.key, s.reopen ? '整页重新打开' : `上次 ${s.subs}`)
  s.reopen = false
  s.ac.abort()
  s.ac = new AbortController()
  s.tracks = []
  s.track = null
  s.cues = []
  s.subs = 'loading'
  s.error = undefined
  s.needLogin = false
  s.ytTemplate = undefined
  s.translated = 0
  s.trFailed = 0
  s.trError = undefined
  s.trRaw = undefined
  s.translating = false
  pushState(s, true)
  pushSubs(s)
  void load(s).catch((e) => {
    if ((e as Error).name === 'AbortError') return
    s.subs = 'error'
    s.error = (e as Error).message
    pushState(s)
  })
}

/** 放广告时最多等多久（广告放完才有字幕轨） */
const AD_WAIT_MS = 10 * 60_000

async function load(s: Sess) {
  const { ref } = s
  // 视频的说明：播放器里读（单页应用，换视频后要等它换好）；别的网站的说明和字幕轨网页预加载报来时就有了
  for (let i = 0; i < 30 && ref.site !== 'web'; i++) {
    if (ref.site === 'youtube') {
      let info = await ytInfo(s.wc)
      dbg('ytInfo', info && { id: info.videoId, tracks: info.tracks.length, ad: info.ad })
      if (info && info.videoId === ref.id) {
        // 在放广告：播放器这时报的字幕轨是 0 条，等广告放完再读（以前这时就定成「没有字幕」，广告完了也不再认）；
        // 广告刚完播放器还没换好的那一下，多读几次
        if (info.ad && !info.tracks.length) {
          const until = Date.now() + AD_WAIT_MS
          let after = 0
          while (info && info.videoId === ref.id && !info.tracks.length && (info.ad || after++ < 5) && Date.now() < until) {
            await sleep(info.ad ? 1000 : 700, s.ac.signal)
            info = await ytInfo(s.wc)
          }
          dbg('ytInfo 广告完了', info && { id: info.videoId, tracks: info.tracks.length, ad: info.ad })
          if (!info || info.videoId !== ref.id) continue
        }
        s.meta = { title: info.title, channel: info.author, duration: info.length }
        s.tracks = ytTracks(info.tracks)
        s.chapters = info.chapters
        break
      }
    } else {
      const info = await biliInfo(s.wc, ref.p ?? 1)
      if (info && info.bvid === ref.id) {
        s.meta = { title: info.title, channel: info.owner, duration: info.duration, cover: info.pic.replace(/^\/\//, 'https://').replace(/^http:/, 'https:') }
        s.cid = info.cid
        break
      }
    }
    await sleep(700, s.ac.signal)
  }
  if (!s.meta.title) s.meta.title = s.wc.getTitle().replace(/ - YouTube$|_哔哩哔哩_bilibili$|_Bilibili$/, '') || ref.id
  store.update(ref.key, { title: s.meta.title, channel: s.meta.channel, duration: s.meta.duration })
  if (ref.site === 'bilibili') {
    // 字幕列表在播放器接口里（要签名），等播放器自己请求，最多等 10 秒
    for (let i = 0; i < 20 && !biliLists.get(s.wc.id)?.get(s.cid ?? -1); i++) await sleep(500, s.ac.signal)
    const got = biliLists.get(s.wc.id)?.get(s.cid ?? -1)
    s.tracks = got?.tracks ?? []
    s.needLogin = got ? got.needLogin : false
    dbg('biliTracks', ref.key, s.cid, got ? got.tracks.map((t) => t.lang) : '播放器没请求字幕列表', got?.needLogin)
  }
  // 以前生成过字幕（库里有那份 vtt）：多一条「听写 · Soniox」
  const stt = await savedSttTrack(ref)
  if (stt) s.tracks = [...s.tracks, stt]
  pushState(s)
  await useTrack(s, store.get(ref.key)?.track ?? null)
  // 没字幕：时刻块里点过「生成字幕」的，或者开了「以后没字幕的视频打开就自动生成」：直接生成
  const wanted = sttWanted.delete(ref.key)
  if ((s.subs === 'none' || (wanted && s.subs === 'login')) && (wanted || (store.settings().autoStt && sttKeyStatus().has))) void startStt(ref, s.meta.title, bundledYtDlp()).catch((e) => send('video:notice', (e as Error).message))
}

async function useTrack(s: Sess, lang: string | null) {
  const track = pickTrack(s.tracks, lang)
  s.track = track
  s.cues = []
  s.translated = 0
  s.trFailed = 0
  s.trError = undefined
  s.trRaw = undefined
  s.translating = false
  s.summaryNote = undefined
  s.error = undefined
  if (!track) {
    s.subs = s.needLogin ? 'login' : 'none'
    pushState(s)
    pushSubs(s)
    return
  }
  store.update(s.ref.key, { track: trackId(track) })
  s.subs = 'loading'
  pushState(s)
  if (track.stt) return gotCues(s, await readSttCues(s.ref))
  if (s.ref.site === 'web') {
    // 别的网站：<video> 自己的字幕轨（<track> 挂的 VTT、播放器用脚本加的），网页预加载读出来交回来
    const cues = await webCues(s, track)
    if (s.track !== track) return
    if (!cues.length) {
      s.subs = 'error'
      s.error = '这条字幕读不出来'
      pushState(s)
      return
    }
    await gotCues(s, cues)
    return
  }
  if (s.ref.site === 'bilibili') {
    const res = await deps.ses.fetch(track.url!, { signal: AbortSignal.any([s.ac.signal, AbortSignal.timeout(15_000)]) })
    if (!res.ok) throw new Error(`B 站字幕取不到（${res.status}）`)
    await gotCues(s, parseBiliSubtitle(await res.text()))
    return
  }
  // YouTube：字幕请求要带播放器算出来的校验（pot），我们拼不出。先等播放器自己取一次（它取的时候带着 pot），
  // 借它的地址换成我们要的那条在网页里取；播放器一直没取就让它取（setOption），放广告时等着，最多等两分钟
  const want = track
  for (let i = 0; i < 60 && !s.cues.length && s.track === want; i++) {
    if (s.ytTemplate) await fetchYtTrack(s, want)
    else if (i >= 3) dbg('loadTrack', want, await ytLoadTrack(s.wc, want.lang, want.auto))
    if (s.cues.length) break
    await Promise.race([sleep(2000, s.ac.signal), new Promise<void>((r) => waiters.set(s.wc.id, r))])
  }
  if (!s.cues.length && s.track === want) {
    s.subs = 'error'
    s.error = 'YouTube 暂时不给字幕，过一会儿再试'
    pushState(s)
  }
}

/** 照播放器带 pot 的字幕地址，换成要的语言，在网页里取（带着网页的登录和校验） */
async function fetchYtTrack(s: Sess, t: Track) {
  const u = new URL(s.ytTemplate!)
  u.searchParams.set('lang', t.lang)
  if (t.auto) u.searchParams.set('kind', 'asr')
  else u.searchParams.delete('kind')
  u.searchParams.delete('tlang')
  u.searchParams.set('fmt', 'json3')
  const body = (await s.wc.executeJavaScript(`fetch(${JSON.stringify(u.toString())}, { credentials: 'include' }).then((r) => r.ok ? r.text() : '').catch(() => '')`).catch(() => '')) as string
  dbg('fetchTrack', t, body.length)
  if (!body || s.cues.length || s.track !== t) return
  const cues = parseYtCaptions(body, t.auto)
  if (cues.length) await gotCues(s, cues)
}

function onBody(wc: WebContents, url: string, body: string) {
  const u = new URL(url)
  dbg('body', url, body.length, body.slice(0, 120))
  if (/\/api\/timedtext/.test(u.pathname)) {
    const s = sessions.get(wc.id)
    const v = u.searchParams.get('v')
    const lang = u.searchParams.get('lang')
    const auto = u.searchParams.get('kind') === 'asr'
    if (!s || s.ref.site !== 'youtube' || v !== s.ref.id) return
    // 带 pot 的地址记下来当样子（换语言时照它取）
    if (u.searchParams.get('pot') && body) s.ytTemplate = url
    if (!s.track || s.cues.length) return waiters.get(wc.id)?.()
    if (lang === s.track.lang && auto === s.track.auto && !u.searchParams.has('tlang')) {
      const cues = parseYtCaptions(body, auto)
      if (cues.length) void gotCues(s, cues)
    }
    waiters.get(wc.id)?.()
    return
  }
  if (/\/x\/player\/(wbi\/)?v2/.test(u.pathname)) {
    const cid = Number(u.searchParams.get('cid'))
    const parsed = biliTracks(body)
    const m = biliLists.get(wc.id) ?? new Map()
    m.set(cid, parsed)
    biliLists.set(wc.id, m)
  }
}

async function gotCues(s: Sess, cues: Cue[]) {
  s.cues = cues
  s.subs = 'ready'
  // 这个视频存过字幕全文：先用那篇里的译文，不再翻
  const saved = await savedTranslations(s)
  const svc = translateService()
  const target = svc?.target() ?? null
  // 原文语言按字幕的字认，和翻成的同一种就换一种（videoTarget）：双语总有第二行
  s.target = target ? videoTarget(target, s.track?.lang ?? '', cues.map((c) => c.text)) : null
  if (saved.size)
    for (const c of cues) {
      const tr = saved.get(`${fmtTime(c.start)} ${c.text}`)
      if (tr) c.tr = tr
    }
  s.translated = cues.filter((c) => c.tr).length
  pushState(s)
  pushSubs(s)
  void writeMaterial(s).catch((e) => console.warn('[video] 字幕全文没存成', (e as Error).message))
  // 摘要只看原文，和翻译各走各的：翻译慢、卡住、出错都不挡着摘要（以前排在翻译后面，翻译不收尾摘要就永远「在写」）
  void summarize(s)
  if (s.target) await translateCues(s)
}

async function savedTranslations(s: Sess): Promise<Map<string, string>> {
  const v = deps.vault()
  if (!v || !s.material) return new Map()
  try {
    return readTranslations((await v.read(s.material)).text)
  } catch {
    return new Map()
  }
}

/** 「4分钟」「3秒」 */
const waited = (ms: number) => (ms >= 60_000 ? `${Math.round(ms / 60_000)}分钟` : `${Math.round(ms / 1000)}秒`)

/** 多久一句新译文都没来算卡住（真的命令行一批最慢一分多钟；测试里用 CN_VIDEO_TR_STALL_MS 缩短） */
const trStallMs = () => Number(process.env.CN_VIDEO_TR_STALL_MS) || 4 * 60_000

/**
 * 先翻正在播的前后 2 分钟，再往两头补；翻好一条推一条。
 * 没翻成的句子（报错的、AI 回了空的）记数、记原因（视频条上「N句没翻成」，字幕菜单里写原因和「重试」），不再悄悄丢掉；
 * 一直没有新译文（引擎不回话也不报错）到 trStallMs 就收尾，剩下的算没翻成。最后不管怎样都把字幕全文写一遍。
 */
async function translateCues(s: Sess) {
  const svc = translateService()
  if (!svc || !s.target) return
  const cues = s.cues
  const outer = s.ac
  const ac = new AbortController()
  const stopInner = () => ac.abort()
  outer.signal.addEventListener('abort', stopInner)
  const t = (await currentTime(s.wc)) ?? 0
  const todo = cues.map((c, i) => ({ c, i })).filter(({ c }) => !c.tr)
  todo.sort((a, b) => {
    const da = Math.abs(a.c.start - t)
    const db = Math.abs(b.c.start - t)
    const na = da <= 120 ? 0 : 1
    const nb = db <= 120 ? 0 : 1
    return na - nb || a.c.start - b.c.start
  })
  const live = () => s.cues === cues && s.ac === outer && !outer.signal.aborted
  s.translating = true
  s.trFailed = 0
  s.trError = undefined
  s.trRaw = undefined
  pushState(s)
  const answered = new Set<number>()
  let firstError: TrError | null = null
  let stall: ReturnType<typeof setTimeout> | undefined
  let stalled = false
  let onStall = () => {}
  const stalledP = new Promise<void>((r) => (onStall = r))
  /** 有回音就重新计时 */
  const rearm = () => {
    clearTimeout(stall)
    stall = setTimeout(() => ((stalled = true), onStall()), trStallMs())
  }
  rearm()
  dbg('translate', s.ref.key, s.target, `${todo.length} 句`)
  const work = svc
    .translateBlocks(
      todo.map(({ c, i }) => ({ id: String(i), text: c.text })),
      { target: s.target },
      (r) => {
        if (!live() || ac.signal.aborted) return
        const i = Number(r.id)
        answered.add(i)
        rearm()
        if (r.text === null || !r.text.trim()) {
          firstError ??= r.error ?? { code: 'other', raw: 'AI回的译文是空的' }
          return
        }
        if (!cues[i]!.tr) s.translated++
        cues[i]!.tr = r.text
        pushTr(s, i, r.text)
        pushState(s)
      },
      ac.signal,
    )
    .catch((e: Error) => {
      if (e.name !== 'AbortError') firstError ??= { code: 'other', raw: e.message }
    })
  await Promise.race([work, stalledP])
  clearTimeout(stall)
  outer.signal.removeEventListener('abort', stopInner)
  if (stalled) ac.abort()
  if (!live()) return
  const missed = todo.filter(({ i }) => !cues[i]!.tr)
  const left = missed.length
  s.translating = false
  s.trFailed = left
  // 「AI回的格式不对」后面不再带「，漏了 N 段」：前面已经说了几句没翻成
  // 回调里赋的值 TS 看不到
  const fe = firstError as TrError | null
  s.trError = left ? (stalled && !fe ? `${waited(trStallMs())}没有新译文，停下了` : fe ? errorTitle(fe.code === 'bad-output' ? { ...fe, raw: '' } : fe) : '没翻成') : undefined
  s.trRaw = left && fe && fe.raw !== s.trError ? fe.raw : undefined
  dbg('translated', s.ref.key, `${s.translated}/${cues.length}`, left ? `没翻成 ${left} 句（${answered.size} 句有回音）：${s.trError}；${missed.slice(0, 5).map(({ c }) => JSON.stringify(c.text)).join(' ')}` : '全翻好了')
  if (left) console.warn(`[video] 字幕有 ${left} 句没翻成：${s.trError}`)
  pushState(s, true)
  await writeMaterial(s).catch((e) => send('video:notice', `字幕全文没存成：${(e as Error).message}`))
}

// ---------------------------------------------------------------- 字幕全文进素材

let materialChain: Promise<unknown> = Promise.resolve()
/** 视频这边的提交排队做：提交完再读 HEAD 当这次的提交号，中间不能插进别的提交（撤回才撤得对） */
function serial<T>(f: () => Promise<T>): Promise<T> {
  const p = materialChain.then(f, f)
  materialChain = p.catch(() => undefined)
  return p
}

function materialText(s: Sess): string {
  const rec = store.get(s.ref.key)
  const moments = (rec?.moments ?? []).map((m) => ({ t: m.t, text: m.text ?? '', note: m.note }))
  return subtitleDoc({
    ref: s.ref,
    meta: s.meta,
    track: s.track!,
    target: s.target,
    cues: s.cues,
    chapters: s.chapters,
    summary: s.summary,
    moments,
    withTranslation: store.settings().withTranslation,
    momentKey: keyLabel(store.settings().keys.moment),
  }).replace(SUMMARY_WRITING, s.summaryNote ?? SUMMARY_WRITING)
}

/** 写字幕全文那一篇（没有就建），commit 为 true 时单独一次提交 */
function writeMaterial(s: Sess, commit = true): Promise<string | null> {
  const run = async () => {
    const v = deps.vault()
    if (!v || !s.track || !s.cues.length) return null
    const text = materialText(s)
    if (!s.material) {
      s.material = await v.create(VIDEO_FOLDER, safeTitle(s.meta.title), text)
      store.update(s.ref.key, { material: s.material })
    } else {
      const cur = await v.read(s.material).catch(() => null)
      if (!cur) {
        s.material = await v.create(VIDEO_FOLDER, safeTitle(s.meta.title), text)
        store.update(s.ref.key, { material: s.material })
      } else if (cur.text !== text) {
        const r = await v.write(s.material, text, cur.text)
        if (!r.ok) throw new Error('那一篇刚被改了，下次更新再写')
        // 中间开着这一篇的编辑器跟着换（软件自己写的，监听不报；以前不报，开着的那一篇一直停在「AI 在写摘要…」、没有译文）
        send('note:changed', s.material, text)
      }
    }
    if (commit) await commitPaths(v.root, [s.material], `视频字幕全文：${s.meta.title.slice(0, 50)}`)
    dbg('material', s.material)
    send('files:changed')
    pushState(s)
    return s.material
  }
  const p = materialChain.then(run, run)
  materialChain = p.catch(() => undefined)
  return p
}

/** 摘要最多等多久（测试里用 CN_VIDEO_SUMMARY_MS 缩短） */
const summaryMs = () => Number(process.env.CN_VIDEO_SUMMARY_MS) || 3 * 60_000

/** 问一次摘要：成了给条目，不成抛出一句能写进那一篇的原因（停下了照样抛 AbortError） */
async function askSummary(cues: Cue[], title: string, channel: string, target: string | null, signal: AbortSignal): Promise<{ t: number; text: string }[]> {
  const lines: string[] = []
  let size = 0
  const step = Math.max(1, Math.ceil(cues.reduce((n, c) => n + c.text.length, 0) / 14000))
  for (let i = 0; i < cues.length; i += step) {
    const c = cues[i]!
    const l = `${fmtTime(c.start)} ${c.text}`
    size += l.length
    lines.push(l)
    if (size > 16000) break
  }
  const prompt = [
    '命令：视频摘要',
    `视频：${title}${channel ? `（${channel}）` : ''}`,
    `用${langName(target ?? 'zh-CN')}写 4 到 8 条要点，按时间先后，每条一行：「mm:ss 一句话」，时间写这一点开始讲的地方。不要别的话。`,
    '字幕：',
    lines.join('\n'),
  ].join('\n')
  const timeout = AbortSignal.timeout(summaryMs())
  try {
    const out = await askFast('你给视频写摘要。只按要求的格式输出。', prompt, AbortSignal.any([signal, timeout]))
    const items = parseSummary(out)
    if (!items.length) throw new Error(`AI 回的格式不对：${out.trim().slice(0, 40) || '什么都没回'}`)
    return items
  } catch (e) {
    if (timeout.aborted && !signal.aborted) throw new Error(`等了${waited(summaryMs())}没写完`)
    throw e
  }
}

/** 写进那一篇的一句中文原因：引擎的原话（「Claude Code 退出了（1）：…」）认成「Claude Code中途退出了」这类，我们自己说的照写 */
function failedNote(e: unknown): string {
  const msg = String((e as Error)?.message ?? e).replace(/\s+/g, ' ')
  const own = /^(等了|AI 回的格式不对)/.test(msg)
  return `${SUMMARY_FAILED}${(own ? msg : errorTitle(classify(msg, trEngine(fastEngine().id)))).slice(0, 80)}`
}

/**
 * AI 摘要：按原文写，每条带时间；写好了改那一篇。和翻译各走各的。
 * 写不成（出错、等太久）在那一篇「AI 摘要」下面写原因，那一行旁边有「重试」（renderer/video/summary-retry.ts）；不会一直「在写」。
 * 换了翻成什么、重试：旧的那一问作废，结果不写。
 */
async function summarize(s: Sess) {
  if (s.summary || !s.cues.length) return
  const cues = s.cues
  const ac = s.ac
  s.summaryNote = undefined
  const live = () => s.cues === cues && s.ac === ac && !ac.signal.aborted
  dbg('summary', s.ref.key, '开始')
  try {
    const items = await askSummary(cues, s.meta.title, s.meta.channel, s.target, ac.signal)
    if (!live()) return
    s.summary = items
  } catch (e) {
    if (!live()) return
    s.summaryNote = failedNote(e)
    console.warn('[video] 摘要没写成', (e as Error).message)
  }
  dbg('summary', s.ref.key, s.summary ? `${s.summary.length} 条` : s.summaryNote)
  pushState(s, true)
  await writeMaterial(s).catch((e) => send('video:notice', `字幕全文没存成：${(e as Error).message}`))
}

/** 「AI 摘要没写成 · 重试」：视频开着按它重写；没开着按那一篇里存的字幕写，只换「AI 摘要」这一节 */
async function retrySummary(path: string): Promise<void> {
  const s = [...sessions.values()].find((x) => x.material === path && x.cues.length)
  if (s) {
    s.summary = null
    s.summaryNote = undefined
    pushState(s, true)
    await writeMaterial(s)
    return summarize(s)
  }
  const v = needVault()
  const cur = await v.read(path)
  const ref = videoOf(/\nsource: (\S+)/.exec(cur.text)?.[1] ?? '')
  const cues = readCues(cur.text)
  if (!ref || !cues.length) throw new Error('这一篇里没有字幕，写不了摘要')
  const title = /^# (.+)$/m.exec(cur.text)?.[1] ?? ''
  const channel = /\nchannel: (.*)/.exec(cur.text)?.[1]?.trim() ?? ''
  const target = /\ntranslated: (\S+)/.exec(cur.text)?.[1] ?? null
  const save = async (body: { t: number; text: string }[] | string) => {
    const now = await v.read(path)
    const next = replaceSummary(now.text, ref, body)
    if (next === now.text) return
    const r = await v.write(path, next, now.text)
    if (!r.ok) throw new Error('那一篇刚被改了，再点一次重试')
    send('note:changed', path, next)
  }
  await save(SUMMARY_WRITING)
  let body: { t: number; text: string }[] | string
  try {
    body = await askSummary(cues, title, channel, target, AbortSignal.timeout(summaryMs() + 5000))
  } catch (e) {
    body = failedNote(e)
  }
  await save(body)
  await serial(() => commitPaths(v.root, [path], `视频摘要：${title.slice(0, 50)}`))
  send('files:changed')
}

// ---------------------------------------------------------------- 记下这一刻

async function saveJpeg(v: Vault, rel: string, data: Buffer): Promise<string> {
  await mkdir(v.abs(rel.split('/').slice(0, -1).join('/')), { recursive: true })
  let target = rel
  for (let n = 2; existsSync(v.abs(target)); n++) target = rel.replace(/\.jpg$/, `-${n}.jpg`)
  await atomicWrite(v.abs(target), data)
  return target
}

/** 截一帧：先在网页里画到画布上（视频原始分辨率、不带我们的字幕层）；画布被污染就截屏幕上那一块 */
async function frame(s: Sess, box: Box | null): Promise<{ jpeg: Buffer; t: number }> {
  const g = await grabFrame(s.wc, box)
  if (g && 'data' in g) return { jpeg: Buffer.from(g.data.split(',')[1]!, 'base64'), t: g.t }
  if (g && g.error !== 'tainted') throw new Error(g.error)
  const r = await videoRect(s.wc)
  if (!r) throw new Error('网页里没有正在放的视频')
  s.wc.send('video:hide-subs', true)
  await sleep(80)
  const img = await s.wc.capturePage({ x: r.x, y: r.y, width: r.width, height: r.height })
  s.wc.send('video:hide-subs', false)
  return { jpeg: img.toJPEG(82), t: r.t }
}

/** 封面：存一次 附件/视频/<站>-<id>/cover.jpg */
async function cover(s: Sess, v: Vault): Promise<string | null> {
  const rel = `${attachDir(s.ref)}/cover.jpg`
  if (existsSync(v.abs(rel))) return rel
  const url = s.ref.site === 'youtube' ? (testOrigin ? `${testOrigin}/cover.jpg` : `https://i.ytimg.com/vi/${s.ref.id}/mqdefault.jpg`) : s.meta.cover
  if (!url) return null
  try {
    const res = await deps.ses.fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return null
    let buf = Buffer.from(await res.arrayBuffer())
    // B 站的封面可能是 png / webp：统一转成 jpg，长边 640
    const img = nativeImage.createFromBuffer(buf)
    if (!img.isEmpty()) {
      const { width, height } = img.getSize()
      const k = Math.min(1, 640 / Math.max(width, height))
      buf = Buffer.from(img.resize({ width: Math.round(width * k), height: Math.round(height * k) }).toJPEG(80))
    }
    await mkdir(v.abs(attachDir(s.ref)), { recursive: true })
    await atomicWrite(v.abs(rel), buf)
    return rel
  } catch {
    return null
  }
}

function sess(wcId: unknown): Sess {
  const s = typeof wcId === 'number' ? sessions.get(wcId) : undefined
  if (!s) throw new Error('右栏没有在放的视频')
  return s
}

function checkDest(d: unknown): Dest {
  const x = (d ?? {}) as Partial<Dest>
  if ((x.kind !== 'doc' && x.kind !== 'board' && x.kind !== 'inbox') || typeof x.path !== 'string' || !x.path.endsWith('.md') || x.path.includes('..') || typeof x.title !== 'string') throw new Error('记到哪的参数不对')
  return x as Dest
}

/**
 * 收件箱/<视频标题>.md：同一个视频的都进同一篇；第一次先放视频卡。剪藏去处规则（2026-11-25）也走这里：
 * 选的文件夹里这个视频那篇、这个网站配对的那篇（接在末尾，这个视频第一次进它也先放视频卡）
 */
async function appendInbox(v: Vault, s: Sess, dest: Dest, block: string, coverRel: string | null): Promise<string> {
  const abs = v.abs(dest.path)
  if (!existsSync(abs)) {
    await mkdir(v.abs(dirname(dest.path)), { recursive: true })
    const card = videoCardMd(s.ref, s.meta, coverRel ? relLink(dest.path, coverRel) : null, { comment: true })
    const r = await v.write(dest.path, `# ${safeTitle(s.meta.title)}\n\n${card}\n\n${block}\n`, '')
    if (!r.ok) throw new Error('收件箱里那篇刚被改了，再按一次')
    return dest.path
  }
  const cur = await v.read(dest.path)
  const card = cur.text.includes(`video=${s.ref.key}`) ? '' : videoCardMd(s.ref, s.meta, coverRel ? relLink(dest.path, coverRel) : null, { comment: true }) + '\n\n'
  const r = await v.write(dest.path, cur.text.replace(/\n*$/, '\n\n') + card + block + '\n', cur.text)
  if (!r.ok) throw new Error(`《${dest.title}》刚被改了，再按一次`)
  return dest.path
}

async function moment(raw: { wcId?: unknown; dest?: unknown }): Promise<MomentResult> {
  const s = sess(raw?.wcId)
  const dest = checkDest(raw?.dest)
  const v = needVault()
  const { jpeg, t } = await frame(s, null)
  const image = await saveJpeg(v, `${attachDir(s.ref)}/${timeSlug(t)}.jpg`, jpeg)
  const coverRel = await cover(s, v)
  const around = cuesAround(s.cues, t, 2, 2)
  const md = momentMd(s.ref, s.meta, t, relLink(dest.path, image), around)
  const card = videoCardMd(s.ref, s.meta, coverRel ? relLink(dest.path, coverRel) : null, { comment: dest.kind !== 'board' })
  const files = [image, ...(coverRel ? [coverRel] : [])]
  const cur = around.list[around.current]
  const text = cur ? (cur.tr || cur.text) : ''
  const result: MomentResult = { t, time: fmtTime(t), moment: md, card, files, key: s.ref.key }
  if (dest.kind === 'inbox') {
    const path = await appendInbox(v, s, dest, md, coverRel)
    const hash = await commitWith(s, [path, ...files], `视频：记下 ${fmtTime(t)}《${s.meta.title.slice(0, 40)}》→ ${path.startsWith(`${INBOX}/`) ? '收件箱' : dest.title}`, { t, note: dest.title, text, image })
    if (hash) result.commit = hash
  }
  return result
}

/** 一次提交（附件图 + 文档改动）；记进本机的时刻表。字幕全文里的「记下的时刻」随后单独一次提交（撤回这一刻时不和它打架） */
async function commitWith(s: Sess, paths: string[], message: string, mark: MomentMark): Promise<string | null> {
  const v = needVault()
  const hash = await serial(() => commitPaths(v.root, paths, message))
  store.addMoment(s.ref.key, mark)
  send('files:changed')
  pushState(s, true)
  if (s.material && s.cues.length) void writeMaterial(s).catch((e) => console.warn('[video] 字幕全文的时刻没更新', (e as Error).message))
  return hash
}

// ---------------------------------------------------------------- 框一块问

// 回答里提到库里的笔记（他正在写的那篇、别的）也写成链接（task-3e53q）
const ASK_SYSTEM = `你是一位耐心的老师，帮一个人看懂视频里的一段。只按要求输出 JSON。\n${CITE_RULE}`

/**
 * 视频问答的那段话。subs 是 null：问框里没勾「带上前后字幕」，字幕那一段整个不给；
 * prior：接着问，前面在这一帧问过的几问和回答（第一问时没有）
 */
export function askPrompt(a: { title: string; channel: string; time: string; box: Box; question: string; subs: string | null; note: string; prior?: { q: string; a: string }[] }): string {
  const pct = (x: number) => Math.round(x * 100)
  return [
    '命令：视频问答',
    `视频：${a.title}${a.channel ? `（${a.channel}）` : ''}`,
    `图是视频 ${a.time} 这一帧，紫色框是用户框住、想问的那块（左 ${pct(a.box.x)}%、上 ${pct(a.box.y)}%、宽 ${pct(a.box.w)}%、高 ${pct(a.box.h)}%）。`,
    ...(a.prior?.length ? ['他之前在这一帧问过：', ...a.prior.flatMap((x) => [`问：${x.q}`, `你答：${x.a}`]), `接着问：${a.question}`] : [`用户问：${a.question}`]),
    ...(a.subs === null ? [] : ['前后 30 秒的字幕：', a.subs || '（没有字幕）']),
    '用户正在写的笔记（节选）：',
    a.note || '（空）',
    `${answerRule(a.question)}，只输出一个 JSON：{"doubt":"用用户自己的口气写他卡在哪（一句，不要写「给我讲解一下」）","answer":"讲通的讲法，2 到 5 句，结合框里的东西","points":["要点一","要点二"],"pre":false}；这一问要讲的主要不是视频里这一段本身，而是看懂它要的、视频外面的基础知识（某个数学工具、领域常识）时 pre 写 true`,
  ].join('\n')
}

/** 问框开着时框的那一帧（画好紫框的 JPEG）：问、接着问、想建议都用这一张；image 是第一问记进笔记时存进库的路径 */
interface CardFrame {
  wcId: number
  jpeg: Buffer
  t: number
  box: Box
  image?: string
}
const cardFrames = new Map<number, CardFrame>()
let cardSeq = 0

const checkBox = (b: unknown): Box => {
  const x = b as Box | null
  if (!x || ![x.x, x.y, x.w, x.h].every((n) => typeof n === 'number' && n >= 0 && n <= 1)) throw new Error('框的参数不对')
  return { x: x.x, y: x.y, w: x.w, h: x.h }
}

/** 框住那块的小图：从画了紫框的那一帧里切出框里面（让开紫线），长边缩到 192（问框头上 96 × 54 的两倍） */
function thumbOf(jpeg: Buffer, box: Box): string {
  const img = nativeImage.createFromBuffer(jpeg)
  const { width: W, height: H } = img.getSize()
  const pad = Math.ceil(Math.max(3, W / 320)) + 1
  const x = Math.min(W - 1, Math.round(box.x * W) + pad)
  const y = Math.min(H - 1, Math.round(box.y * H) + pad)
  const w = Math.min(W - x, Math.round(box.w * W) - 2 * pad)
  const h = Math.min(H - y, Math.round(box.h * H) - 2 * pad)
  const part = w > 8 && h > 8 ? img.crop({ x, y, width: w, height: h }) : img
  const size = part.getSize()
  const k = Math.min(1, 192 / Math.max(size.width, size.height * (192 / 108)))
  return (k < 1 ? part.resize({ width: Math.max(1, Math.round(size.width * k)), quality: 'good' }) : part).toDataURL()
}

async function peek(raw: { wcId?: unknown; box?: unknown }): Promise<PeekResult> {
  const s = sess(raw?.wcId)
  const box = checkBox(raw?.box)
  const { jpeg, t } = await frame(s, box)
  const card = ++cardSeq
  cardFrames.set(card, { wcId: s.wc.id, jpeg, t, box })
  // 只留最近几个问框的
  for (const k of cardFrames.keys()) if (cardFrames.size > 6) cardFrames.delete(k)
  return { card, t, thumb: thumbOf(jpeg, box) }
}

/** 问框里两颗固定的建议（另两颗 suggest 现想，不能和它们重） */
const FIXED_SUGGEST = ['讲解这一块', '换个说法讲']

/** 想建议时回的那串（JSON 数组，或者一行一个）认出两个短问题 */
export function parseSuggest(out: string): string[] {
  let list: unknown[] = []
  try {
    const arr = /\[[\s\S]*\]/.exec(out)?.[0]
    list = arr ? (JSON.parse(arr) as unknown[]) : out.split('\n')
  } catch {
    list = out.split('\n')
  }
  const seen = new Set(FIXED_SUGGEST)
  const got: string[] = []
  for (const x of list) {
    if (typeof x !== 'string') continue
    const q = x.replace(/^[\s\-*\d.、"「]+|[\s"」]+$/g, '').trim()
    if (!q || q.length > 20 || seen.has(q)) continue
    seen.add(q)
    got.push(q)
    if (got.length === 2) break
  }
  return got
}

/**
 * 问框里另外两颗建议（DESIGN 方向 A）：小活那一家看这一帧（Claude Code 能看图）和字幕现想两个短问题；
 * 小活那家看不了图就只给字幕。想不出、出错、超过 25 秒：给空的，问框里只留两颗固定的（原样说过的退路，不是吞掉错误）
 */
async function suggest(card: unknown): Promise<string[]> {
  const f = typeof card === 'number' ? cardFrames.get(card) : undefined
  const s = f ? sessions.get(f.wcId) : undefined
  if (!f || !s) return []
  if (process.env.CN_AI_FAKE === '1') {
    await sleep(300)
    return ['i 帽落到哪里了？', '这个矩阵怎么读？']
  }
  const subs = cuesBetween(s.cues, f.t - 20, f.t + 10).map((c) => `${fmtTime(c.start)} ${c.text}`).join('\n')
  const prompt = [
    '命令：替他想问题',
    `视频：${s.meta.title}`,
    `图是视频 ${fmtTime(f.t)} 这一帧，紫色框是他框住的那块。`,
    '这一帧前后的字幕：',
    subs || '（没有字幕）',
    `他看到框住的这块，最可能想问的两个问题。每个不超过 14 个字（英文不超过 8 个词），口语，用${answerLangName()}，不要「讲解一下」「换个说法」这种。只输出 JSON 数组，比如 ["这个式子怎么来的？","为什么要除以根号 d？"]`,
  ].join('\n')
  const system = '你替看视频的人想问题。只按要求输出。'
  const signal = AbortSignal.timeout(25_000)
  try {
    const quick = fastEngine()
    const exe = quick.id === 'claude' ? findCli('claude') : null
    const out = exe
      ? await askWithImage({ exe, cwd: needVault().root, model: modelOpt('quick', 'claude').model ?? FAST_MODEL, system, prompt, image: { mime: 'image/jpeg', base64: f.jpeg.toString('base64') }, signal, timeoutMs: 25_000 })
      : await askFast(system, prompt, signal, () => undefined)
    return parseSuggest(out)
  } catch (e) {
    dbg('suggest', '没想出来', (e as Error).message)
    return []
  }
}

export function parseAnswer(out: string): { doubt: string; answer: string; points: string[]; pre?: true } {
  const body = /\{[\s\S]*\}/.exec(out)?.[0]
  if (body) {
    try {
      const o = JSON.parse(body) as { doubt?: unknown; answer?: unknown; points?: unknown; pre?: unknown }
      if (typeof o.answer === 'string' && o.answer.trim())
        return {
          doubt: typeof o.doubt === 'string' ? o.doubt.trim() : '',
          answer: o.answer.trim(),
          points: Array.isArray(o.points) ? o.points.filter((p): p is string => typeof p === 'string' && !!p.trim()).slice(0, 5) : [],
          // 讲的是视频外的前置知识（前置知识标签）：记进笔记那一问的小标题带 #前置知识
          ...(o.pre === true ? { pre: true as const } : {}),
        }
    } catch {
      // 不是 JSON：整段当回答
    }
  }
  return { doubt: '', answer: out.trim(), points: [] }
}

const FAKE_ANSWER = JSON.stringify({ doubt: '框里这两个箭头为什么能决定整个网格怎么动？', answer: '框里是 i 帽和 j 帽变换后的位置。任何向量都是它俩的组合，所以它俩落到哪，整个网格就跟着落到哪。', points: ['只要知道两个基向量落在哪', '矩阵的两列就是这两个落点'] })
/** 问的是视频外的基础知识（测试问「什么是向量」）：假 AI 标 pre */
const FAKE_PRE_ANSWER = JSON.stringify({ doubt: '向量到底是什么？', answer: '这是视频外的前置知识：向量就是一个有方向、有长短的箭头，也能写成一列数。', points: ['箭头和一列数是同一个东西'], pre: true })

/** 框一块问：每一问自己能停（文档里占位上的「停下 esc」，CN-84） */
const asking = new Map<number, AbortController>()

async function ask(raw: AskRequest): Promise<AskResult> {
  const s = sess(raw?.wcId)
  const stop = new AbortController()
  asking.get(s.wc.id)?.abort()
  asking.set(s.wc.id, stop)
  try {
    return await askOnce(s, raw, AbortSignal.any([s.ac.signal, stop.signal]))
  } finally {
    if (asking.get(s.wc.id) === stop) asking.delete(s.wc.id)
  }
}

const MODEL_ID = /^[\w.:\-[\]/]{1,200}$/

/** 假 AI（CN_AI_FAKE）答一问：回答分几截在 CN_AI_FAKE_ASK_MS 里慢慢来（问框里看得到长出来） */
async function fakeAnswer(signal: AbortSignal, onText: (d: string) => void, question: string): Promise<string> {
  const total = Number(process.env.CN_AI_FAKE_ASK_MS ?? process.env.CN_AI_FAKE_DELAY_MS) || 400
  const full = question.includes('什么是向量') ? FAKE_PRE_ANSWER : FAKE_ANSWER
  const cut = full.indexOf('"answer":"') + 10
  const parts = [full.slice(0, cut + 4), full.slice(cut + 4, cut + 20), full.slice(cut + 20)]
  await sleep(total * 0.4, signal)
  for (const p of parts) {
    onText(p)
    await sleep((total * 0.6) / parts.length, signal)
  }
  return full
}

async function askOnce(s: Sess, raw: AskRequest, signal: AbortSignal): Promise<AskResult> {
  // 只问不记：不存图、不写笔记、不提交
  const dest = raw?.dest === null ? null : checkDest(raw?.dest)
  const box = checkBox(raw?.box)
  const question = String(raw.question ?? '').trim().slice(0, 500) || '讲解这一块'
  const prior = Array.isArray(raw.prior) ? raw.prior.filter((x) => x && typeof x.q === 'string' && typeof x.a === 'string').slice(-6).map((x) => ({ q: x.q.slice(0, 500), a: x.a.slice(0, 3000) })) : []
  if (raw.model !== undefined && (typeof raw.model !== 'string' || !MODEL_ID.test(raw.model))) throw new Error('AI 参数不对')
  if (raw.effort !== undefined && (typeof raw.effort !== 'string' || !/^[a-z]{1,20}$/.test(raw.effort))) throw new Error('AI 参数不对')
  const v = needVault()
  // 问框打开时截好的那一帧（接着问也是这一张）；没有就现截
  const card = typeof raw.card === 'number' ? cardFrames.get(raw.card) : undefined
  const f: CardFrame = card && card.wcId === s.wc.id ? card : { wcId: s.wc.id, ...(await frame(s, box)), box }
  const { jpeg, t } = f
  let image = f.image
  if (!image && (dest || raw.keep === true)) {
    image = await saveJpeg(v, `${attachDir(s.ref)}/${timeSlug(t)}-问.jpg`, jpeg)
    f.image = image
  }
  const withSubs = raw.subs !== false
  const subs = withSubs ? cuesBetween(s.cues, t - 30, t + 30).map((c) => `${fmtTime(c.start)} ${c.text}${c.tr ? ` / ${c.tr}` : ''}`).join('\n') : null
  const prompt = askPrompt({ title: s.meta.title, channel: s.meta.channel, time: fmtTime(t), box, question, subs, note: String(raw.noteText ?? '').slice(0, 4000), prior })
  // 谁答：看图问只有 Claude Code；模型、effort 是问框底下选的，没选用设置 › AI「看图问」那一行（CN_AI_MODEL 能换默认的 Opus，测试用便宜的）
  const want = raw.model ?? visionModel() ?? CLAUDE_DEFAULT
  const model = want === CLAUDE_DEFAULT && process.env.CN_AI_MODEL ? process.env.CN_AI_MODEL : want
  const effort = raw.effort
  const by = pickLabel({ engine: 'claude', model, ...(effort ? { effort } : {}) })
  // 边答边推：问框里就地长出来
  let acc = ''
  let pushed = ''
  let last = 0
  const onText = (d: string) => {
    acc += d
    const part = partialAnswer(acc)
    if (part === pushed || (Date.now() - last < 80 && part.length - pushed.length < 40)) return
    pushed = part
    last = Date.now()
    if (typeof raw.card === 'number') send('video:ask:text', raw.card, part)
  }
  let out: string
  if (process.env.CN_AI_FAKE === '1') out = await fakeAnswer(signal, onText, question)
  else {
    const exe = findCli('claude')
    if (!exe) throw new Error(`看画面问要用 Claude Code（要能看图）。${INSTALL_HINT.claude}`)
    out = await askWithImage({ exe, cwd: v.root, model, ...(effort ? { effort } : {}), system: ASK_SYSTEM, prompt, image: { mime: 'image/jpeg', base64: jpeg.toString('base64') }, signal, timeoutMs: 120_000, onText })
  }
  const a = parseAnswer(out)
  const time = fmtTime(t)
  const from = fmtTime(Math.max(0, t - 30))
  const to = fmtTime(t + 30)
  const seen = withSubs ? `看了 ${time} 这一帧、${from}–${to} 的字幕` : `看了 ${time} 这一帧`
  // 写进笔记的 AI 讲解头跟库语言（task-zojmg）；上面那句是回答上面那一行，跟着视频这一批再翻
  const seenFile = calloutWords().seenFrame(time, withSubs ? { from, to } : undefined)
  const answer = a.answer + (a.points.length ? '\n\n' + a.points.map((p) => `- ${p}`).join('\n') : '')
  const res: AskResult = { answer, read: `${seen}${raw.noteText ? '、这篇笔记' : ''}`, block: '', files: image ? [image] : [], t, by, ...(image ? { image } : {}), ...(a.pre ? { pre: true as const } : {}) }
  if (!dest) return res
  if (prior.length) {
    // 接着问：接在第一问那块讲解里面、最后（同一块）
    res.follow = followMd(question, a.answer, a.points)
    if (dest.kind === 'inbox') {
      const cur = await v.read(dest.path)
      const at = askCalloutEnd(cur.text, s.ref.key, t)
      if (at < 0) throw new Error('收件箱那篇里找不到这一问的讲解了，没记进去')
      const w = await v.write(dest.path, cur.text.slice(0, at) + '\n' + res.follow + cur.text.slice(at), cur.text)
      if (!w.ok) throw new Error('收件箱里那篇刚被改了，再问一次')
      const hash = await commitWith(s, [dest.path], `视频：接着问 ${time}《${s.meta.title.slice(0, 40)}》→ 收件箱`, { t, note: dest.title, asked: true, text: prior[0]!.q, image: image! })
      if (hash) res.commit = hash
    }
    return res
  }
  res.block = [
    askHead(s.ref.key, t),
    `![${time} 框住的地方](${relLink(dest.path, image!)})`,
    `[▶ ${time} · ${s.meta.title.replace(/[[\]]/g, ' ')}](${timeUrl(s.ref, t)})`,
    `> **我的疑惑**：${(a.doubt || question).replace(/\n/g, ' ')}`,
    '',
    // AI 的回答放进 [!ai] 提示块，和自己写的分得开（CN-76）；头上写谁答的「Claude Code · 模型」（原型：文档里不带档，问框里带）
    aiCallout({ by: pickLabel({ engine: 'claude', model }), seen: seenFile, text: a.answer, points: a.points }),
  ].join('\n')
  // 一门课的「我的疑惑」直接读文档里的这一块（main/reading/doubts.ts 的 collectVideoDoubts），2026-11-20 起不再另写「视频里的疑惑.md」
  if (dest.kind === 'inbox') {
    const path = await appendInbox(v, s, dest, res.block, await cover(s, v))
    const hash = await commitWith(s, [path, ...res.files], `视频：问 AI ${time}《${s.meta.title.slice(0, 40)}》→ 收件箱`, { t, note: dest.title, asked: true, text: a.doubt || question, image: image! })
    if (hash) res.commit = hash
  }
  return res
}

// ---------------------------------------------------------------- 视频卡要的说明（白板上的 YouTube 链接卡）

const metaCache = new Map<string, Promise<{ title: string; channel: string; duration: number; cover: string | null } | null>>()

async function fetchMeta(url: string) {
  const ref = videoOf(url)
  if (!ref) return null
  const rec = store.get(ref.key)
  const json = async (u: string) => {
    const res = await deps.ses.fetch(u, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) throw new Error(String(res.status))
    return res.json() as Promise<Record<string, unknown>>
  }
  try {
    if (ref.site === 'youtube') {
      if (testOrigin) return rec?.title ? { title: rec.title, channel: rec.channel, duration: rec.duration, cover: null } : null
      const o = (await json(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${ref.id}`)}`)) as { title?: string; author_name?: string }
      return { title: o.title ?? rec?.title ?? '', channel: o.author_name ?? rec?.channel ?? '', duration: rec?.duration ?? 0, cover: `https://i.ytimg.com/vi/${ref.id}/mqdefault.jpg` }
    }
    const o = (await json(`https://api.bilibili.com/x/web-interface/view?bvid=${ref.id}`)) as { data?: { title?: string; owner?: { name?: string }; duration?: number; pic?: string } }
    if (!o.data?.title) return null
    return { title: o.data.title, channel: o.data.owner?.name ?? '', duration: o.data.duration ?? 0, cover: o.data.pic ? o.data.pic.replace(/^http:/, 'https:') : null }
  } catch {
    return rec?.title ? { title: rec.title, channel: rec.channel, duration: rec.duration, cover: null } : null
  }
}

// ---------------------------------------------------------------- 接上

let testOrigin: string | null = null
/** 时刻块里点了「生成字幕」、视频还没开好的：开好后开始 */
const sttWanted = new Set<string>()
/** 包里带的 yt-dlp（打包时 extraResources 放进 Resources/bin/；开发时 resources/bin/，由 scripts/fetch-ytdlp.mjs 下好） */
const bundledYtDlp = () => (app.isPackaged ? join(process.resourcesPath, 'bin', 'yt-dlp') : join(__dirname, '../../resources/bin/yt-dlp'))

/** 网页预加载报来的：这一页有一个正在放的 <video>（不是 YouTube、B 站） */
interface Found {
  url: string
  title: string
  host: string
  duration: number
  tracks: Track[]
}

function checkFound(raw: unknown): Found | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  if (typeof r.url !== 'string' || !/^https?:/.test(r.url) || r.url.length > 4000) return null
  const tracks = (Array.isArray(r.tracks) ? r.tracks : [])
    .slice(0, 40)
    .map((t) => (t && typeof t === 'object' ? (t as Record<string, unknown>) : {}))
    .filter((t) => typeof t.lang === 'string' || typeof t.label === 'string')
    .map((t) => {
      const lang = String(t.lang || t.label || 'und').slice(0, 30)
      return { lang, name: String(t.label || t.lang || lang).slice(0, 80), auto: false }
    })
  let host = ''
  try {
    host = new URL(r.url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
  return { url: r.url, title: typeof r.title === 'string' ? r.title.slice(0, 300) : '', host, duration: Number(r.duration) > 0 ? Number(r.duration) : 0, tracks }
}

/** 别的网站上有视频：开这个视频的会话（同一个视频又报一次时，字幕轨多了就重新读） */
function onFound(wc: WebContents, raw: unknown) {
  if (!webviews.has(wc)) return
  const f = checkFound(raw)
  if (!f || videoOf(f.url)) return
  const ref = webVideoRef(f.url)
  const cur = sessions.get(wc.id)
  if (cur && cur.ref.key === ref.key) {
    if (!cur.meta.duration && f.duration) cur.meta.duration = f.duration
    // 播放器后来才加上字幕轨（Vimeo 这类）：之前没有，现在有了，重新读
    if (f.tracks.length && (cur.subs === 'none' || cur.subs === 'error') && !cur.tracks.some((t) => !t.stt)) {
      cur.tracks = [...f.tracks, ...cur.tracks.filter((t) => t.stt)]
      void useTrack(cur, store.get(ref.key)?.track ?? null).catch(() => undefined)
    }
    return
  }
  if (cur) {
    cur.ac.abort()
    sessions.delete(wc.id)
  }
  dbg('found', wc.id, ref.key, f.url, f.tracks.map((t) => t.lang))
  startSess(wc, ref, f)
}

let cueSeq = 0
const cueWaits = new Map<number, (cues: Cue[]) => void>()
/** 让网页预加载读出这条字幕轨的句子（最多等 15 秒） */
function webCues(s: Sess, t: Track): Promise<Cue[]> {
  const n = ++cueSeq
  return new Promise<Cue[]>((resolve) => {
    const done = (cues: Cue[]) => {
      clearTimeout(timer)
      cueWaits.delete(n)
      resolve(cues)
    }
    const timer = setTimeout(() => done([]), 15_000)
    cueWaits.set(n, done)
    if (s.wc.isDestroyed()) return done([])
    s.wc.send('video:read-track', n, t.lang, t.name)
  })
}

export function setupVideo(d: Deps) {
  deps = d
  store = new VideoStore(join(d.userData, 'video', 'state.json'))
  testOrigin = process.env.CN_VIDEO_TEST_ORIGIN || null
  onTapped((t) => {
    if (/\/api\/timedtext|\/x\/player\//.test(t.url)) onBody(t.wc, t.url, t.body)
  })
  setVideoTestOrigin(testOrigin)
  setupStt({
    vault: () => deps.vault(),
    ses: d.ses,
    userData: d.userData,
    changed: (key) => {
      for (const s of sessions.values()) if (s.ref.key === key) pushState(s, true)
    },
    // 生成好的字幕：加进轨道、选上、翻完；返回带译文的句子（补时刻块用）
    ready: async (key, track) => {
      const s = [...sessions.values()].find((x) => x.ref.key === key)
      if (!s) return null
      s.tracks = [...s.tracks.filter((t) => !t.stt), track]
      await useTrack(s, trackId(track))
      return s.cues
    },
    serial,
    notice: (text) => send('video:notice', text),
    noteChanged: (path, text) => send('note:changed', path, text),
  })

  const appOnly = (e: IpcMainInvokeEvent) => {
    if (e.sender.id !== deps.window()?.webContents.id) throw new Error('只有软件界面能调')
  }
  ipcMain.handle('video:state', (e, wcId: unknown) => {
    appOnly(e)
    const s = typeof wcId === 'number' ? sessions.get(wcId) : undefined
    return s ? stateOf(s) : null
  })
  ipcMain.handle('video:settings', (e) => (appOnly(e), store.settings()))
  ipcMain.handle('video:set-settings', (e, patch: unknown) => {
    appOnly(e)
    if (!patch || typeof patch !== 'object') throw new Error('参数不对')
    const next = store.setSettings(patch as Partial<VideoSettings>)
    send('video:settings', next)
    for (const s of sessions.values()) pushSubs(s)
    return next
  })
  ipcMain.handle('video:use-track', async (e, wcId: unknown, lang: unknown) => {
    appOnly(e)
    const s = sess(wcId)
    if (typeof lang !== 'string') throw new Error('参数不对')
    if (lang === '__on') {
      s.off = false
      pushState(s, true)
      return pushSubs(s)
    }
    if (lang === '__off') {
      s.off = true
      pushState(s, true)
      return pushSubs(s)
    }
    s.ac.abort()
    s.ac = new AbortController()
    await useTrack(s, lang)
  })
  ipcMain.handle('video:set-target', async (e, target: unknown) => {
    appOnly(e)
    if (typeof target !== 'string' || !target.trim() || target.length > 40) throw new Error('目标语言不对')
    // 和网页翻译同一个设置：界面先改了双语翻译插件的设置，这里按新的重翻
    for (const s of sessions.values()) {
      if (!s.cues.length) continue
      s.ac.abort()
      s.ac = new AbortController()
      for (const c of s.cues) delete c.tr
      s.translated = 0
      s.trFailed = 0
      s.trError = undefined
      s.trRaw = undefined
      s.translating = false
      // 摘要用翻成的那种语言写：旧的作废，按新的重写（以前这里清掉了摘要却不重写，那一篇一直「AI 在写摘要…」）
      s.summary = null
      s.summaryNote = undefined
      s.target = videoTarget(target.trim(), s.track?.lang ?? '', s.cues.map((c) => c.text))
      pushSubs(s)
      pushState(s)
      void summarize(s)
      if (s.target) void translateCues(s)
    }
  })
  // 字幕菜单里「有N句没翻成 · 重试」：只翻还没翻成的那几句
  ipcMain.handle('video:retry-translate', (e, wcId: unknown) => {
    appOnly(e)
    const s = sess(wcId)
    if (!s.target || s.translating) return
    void translateCues(s)
  })
  // 字幕全文里「AI 摘要没写成：… 重试」：这个视频在右栏开着就按它的字幕重写，没开着按那一篇里存的字幕
  ipcMain.handle('video:retry-summary', (e, path: unknown) => {
    appOnly(e)
    if (typeof path !== 'string' || !path.endsWith('.md') || path.includes('..')) throw new Error('参数不对')
    return retrySummary(path)
  })
  ipcMain.handle('video:moment', (e, r: unknown) => (appOnly(e), moment(r as { wcId?: unknown; dest?: unknown })))
  ipcMain.handle('video:peek', (e, r: unknown) => (appOnly(e), peek(r as { wcId?: unknown; box?: unknown })))
  ipcMain.handle('video:suggest', (e, card: unknown) => (appOnly(e), suggest(card)))
  ipcMain.handle('video:ask', (e, r: unknown) => (appOnly(e), ask(r as AskRequest)))
  ipcMain.handle('video:ask:stop', (e, wcId: unknown) => (appOnly(e), typeof wcId === 'number' && asking.get(wcId)?.abort()))
  ipcMain.handle('video:commit', async (e, paths: unknown, message: unknown, mark: unknown) => {
    appOnly(e)
    if (!Array.isArray(paths) || !paths.every((p) => typeof p === 'string' && !p.includes('..')) || typeof message !== 'string') throw new Error('参数不对')
    const m = (mark ?? {}) as MomentMark & { wcId?: unknown }
    const s = sess(m.wcId)
    if (typeof m.t !== 'number' || typeof m.note !== 'string') throw new Error('参数不对')
    return commitWith(s, paths as string[], message.slice(0, 200), { t: m.t, note: m.note, ...(m.asked ? { asked: true } : {}), ...(typeof m.text === 'string' ? { text: m.text.slice(0, 200) } : {}), ...(typeof m.image === 'string' ? { image: m.image } : {}) })
  })
  ipcMain.handle('video:undo', async (e, hash: unknown, mark: unknown) => {
    appOnly(e)
    if (typeof hash !== 'string') throw new Error('参数不对')
    const root = needVault().root
    await serial(() => revertRetry(root, hash))
    const m = (mark ?? {}) as { wcId?: unknown; t?: unknown }
    const s = typeof m.wcId === 'number' ? sessions.get(m.wcId) : undefined
    if (s && typeof m.t === 'number') {
      store.removeMoment(s.ref.key, m.t)
      pushState(s, true)
      if (s.material && s.cues.length) void writeMaterial(s).catch((e) => console.warn('[video] 字幕全文的时刻没更新', (e as Error).message))
    }
    send('files:changed')
  })
  ipcMain.handle('video:meta', (e, url: unknown) => {
    appOnly(e)
    if (typeof url !== 'string') return null
    const ref = videoOf(url)
    if (!ref) return null
    let p = metaCache.get(ref.key)
    if (!p) {
      p = fetchMeta(url)
      metaCache.set(ref.key, p)
      void p.then((m) => !m && metaCache.delete(ref.key))
    }
    return p
  })
  // 端到端测试：本机假视频站当成 YouTube，界面也要知道
  ipcMain.on('video:test-origin', (e) => (e.returnValue = testOrigin))
  ipcMain.handle('video:transcribe', async (e, r: unknown) => {
    appOnly(e)
    const x = (r ?? {}) as { wcId?: unknown; key?: unknown }
    const s = typeof x.wcId === 'number' ? sessions.get(x.wcId) : typeof x.key === 'string' ? [...sessions.values()].find((y) => y.ref.key === x.key) : undefined
    if (s) return startStt(s.ref, s.meta.title, bundledYtDlp())
    // 时刻块里点的、视频还没在右栏开好：开好后自动开始
    if (typeof x.key === 'string') return void sttWanted.add(x.key)
    throw new Error('这个视频没开着')
  })
  ipcMain.handle('video:transcribe-stop', (e, wcId: unknown) => (appOnly(e), stopStt(sess(wcId).ref.key)))
  ipcMain.handle('video:stt-key', (e) => (appOnly(e), sttKeyStatus()))
  ipcMain.handle('video:set-stt-key', (e, key: unknown) => {
    appOnly(e)
    const r = setSttKey(key)
    for (const s of sessions.values()) pushState(s, true)
    return r
  })
  ipcMain.handle('video:last-pos', (e, key: unknown) => (appOnly(e), typeof key === 'string' ? (store.get(key)?.pos ?? 0) : 0))
  // 网页预加载每秒报一次播到哪：记「看到哪」
  ipcMain.on('video:tick', (e, key: unknown, t: unknown) => {
    const s = sessions.get(e.sender.id)
    if (!s || s.ref.key !== key || typeof t !== 'number' || !Number.isFinite(t)) return
    store.update(s.ref.key, { pos: t })
  })
  // 网页（重新）载好：把字幕再推一遍
  ipcMain.on('video:found', (e, raw: unknown) => onFound(e.sender, raw))
  ipcMain.on('video:track-cues', (e, n: unknown, raw: unknown, src: unknown) => {
    if (!webviews.has(e.sender) || typeof n !== 'number') return
    // 浏览器没读进来（字幕在别的域名、视频没开跨域，Vimeo 就这样）：照 <track> 上的地址自己取（地址自带签名，不用登录）
    if ((!Array.isArray(raw) || !raw.length) && typeof src === 'string' && /^https?:/.test(src)) {
      void deps.ses
        .fetch(src, { signal: AbortSignal.timeout(15_000) })
        .then((r) => (r.ok ? r.text() : ''))
        .then((text) => cueWaits.get(n)?.(text ? parseVtt(text).cues.map((c) => ({ ...c, text: c.text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() })).filter((c) => c.text) : []))
        .catch(() => cueWaits.get(n)?.([]))
      return
    }
    const cues = (Array.isArray(raw) ? raw : [])
      .slice(0, 20_000)
      .filter((c): c is [number, number, string] => Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number' && typeof c[2] === 'string')
      .map(([start, end, text]) => ({ start, end, text: text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() }))
      .filter((c) => c.text)
    cueWaits.get(n)?.(cues)
  })
  ipcMain.on('video:ready', (e) => {
    const s = sessions.get(e.sender.id)
    if (s) pushSubs(s)
  })
}

export function flushVideo() {
  store?.flush()
}

/** 网页挂上时：跟着网址认视频；视频页上按 ⌥S、⌥D 等转给界面（网站收不到） */
/** 右栏的网页（别的网站报视频、交字幕只认它们） */
const webviews = new WeakSet<WebContents>()

export function attachVideo(wc: WebContents) {
  webviews.add(wc)
  const check = (url: string) => {
    const ref = videoOf(url)
    // 视频页一开始就挂上（B 站的字幕列表在一打开时就请求）
    if (ref) void tap(wc)
    onUrl(wc, url)
  }
  wc.on('did-start-navigation', (_e, url, inPlace, isMain) => {
    const ref = isMain && !inPlace ? videoOf(url) : null
    if (!ref) return
    void tap(wc)
    // 整页重新打开正开着的同一个视频：载好以后重新读字幕轨（onUrl）
    const s = sessions.get(wc.id)
    if (s && s.ref.key === ref.key) s.reopen = true
  })
  wc.on('did-navigate', (_e, url) => check(url))
  wc.on('did-navigate-in-page', (_e, url, isMain) => isMain && check(url))
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown' || !sessions.has(wc.id)) return
    // 双语翻译的键（默认 ⌥A，设置 › 快捷键能改）在视频页上转给界面：网页和字幕一起翻（renderer/video/keys.ts 的 toggleVideoTranslate）
    const subs = comboOf(input) === pageKeysNow().translate
    if (!subs && (!input.alt || input.meta || input.control || input.shift)) return
    const keys = store.settings().keys
    const code = `Alt+${input.code}`
    const action = subs ? 'subs' : code === keys.moment ? 'moment' : code === keys.ask ? 'ask' : FIXED_KEYS[input.code]
    if (!action) return
    e.preventDefault()
    send('video:key', action, wc.id)
  })
  wc.once('destroyed', () => {
    const s = sessions.get(wc.id)
    s?.ac.abort()
    sessions.delete(wc.id)
    biliLists.delete(wc.id)
    send('video:state', wc.id, null)
  })
  const url = wc.getURL()
  if (url) check(url)
}

/** 我们窗口里的网页（给测试和别处用） */
export const videoSessions = () => [...sessions.values()].map((s) => ({ wcId: s.wc.id, key: s.ref.key }))

/** 右栏开着这个视频、有字幕时：第 t 秒前后 30 秒的字幕（视频问答块「接着问」给 AI 看，和框一块问时一样多） */
export function subsAround(url: string, t: number): string {
  const key = videoOf(url)?.key
  const s = key ? [...sessions.values()].find((x) => x.ref.key === key && x.cues.length) : undefined
  if (!s) return ''
  return cuesBetween(s.cues, t - 30, t + 30)
    .map((c) => `${fmtTime(c.start)} ${c.text}${c.tr ? ` / ${c.tr}` : ''}`)
    .join('\n')
}

/**
 * 这个网页上正在看的视频和它的全部字幕（AI 命令「视频要点带时间」「字幕整理成一篇」，task-9womr）：
 * 名字、网址、时长，每条 [开始, 结束, 原文, 译文]；不是视频页是 null，还没拿到字幕时 cues 是空的
 */
export function videoCues(wcId: number): { title: string; url: string; site: VideoRef['site']; id: string; p?: number; duration: number; cues: [number, number, string, string][] } | null {
  const s = sessions.get(wcId)
  if (!s) return null
  return {
    title: s.meta.title,
    url: watchUrl(s.ref),
    site: s.ref.site,
    id: s.ref.id,
    ...(s.ref.p ? { p: s.ref.p } : {}),
    duration: s.meta.duration,
    cues: s.cues.map((c) => [c.start, c.end, c.text, c.tr ?? '']),
  }
}
