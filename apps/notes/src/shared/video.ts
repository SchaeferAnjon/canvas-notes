/**
 * 看视频（方向 A「视频条」）用的纯函数：认 YouTube / B 站的视频页、拼带时间的链接、拆字幕、
 * 时刻和视频卡的 md 写法、字幕全文那一篇、记到哪的规矩、白板「时刻」列。主进程、界面、网页预加载、测试都用，不碰 Electron。
 */

export type Site = 'youtube' | 'bilibili'

export interface VideoRef {
  site: Site
  /** YouTube 的 v、B 站的 BV 号 */
  id: string
  /** B 站分 P（第几 P，从 1 起）；YouTube 没有 */
  p?: number
  /** site:id，存「看到哪」、找同一个视频用 */
  key: string
}

/** 端到端测试：本机假的视频页当成 YouTube（CN_VIDEO_TEST_ORIGIN=http://127.0.0.1:端口） */
let testOrigin: string | null = null
export function setVideoTestOrigin(o: string | null) {
  testOrigin = o
}

/** 这个网址是不是能拿到 <video> 的视频页（YouTube /watch /shorts /live，B 站 /video/ /list/），是哪个视频 */
export function videoOf(raw: string | null | undefined): VideoRef | null {
  if (!raw) return null
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  const host = u.hostname.replace(/^(www|m)\./, '')
  const yt = (id: string | null | undefined): VideoRef | null => (id && /^[\w-]{6,20}$/.test(id) ? { site: 'youtube', id, key: `youtube:${id}` } : null)
  if (testOrigin && u.origin === testOrigin) return u.pathname === '/watch' ? yt(u.searchParams.get('v')) : null
  if (host === 'youtube.com' || host === 'music.youtube.com') {
    if (u.pathname === '/watch') return yt(u.searchParams.get('v'))
    const m = /^\/(shorts|live)\/([\w-]+)/.exec(u.pathname)
    return m ? yt(m[2]) : null
  }
  if (host === 'youtu.be') return yt(u.pathname.slice(1))
  if (host === 'bilibili.com') {
    const m = /^\/(?:[a-z]{2}\/)?video\/(BV[0-9A-Za-z]{10})/.exec(u.pathname)
    const bv = m?.[1] ?? (/^\/list\//.test(u.pathname) ? u.searchParams.get('bvid') : null)
    if (!bv || !/^BV[0-9A-Za-z]{10}$/.test(bv)) return null
    const p = Number(u.searchParams.get('p')) || 1
    return { site: 'bilibili', id: bv, ...(p > 1 ? { p } : {}), key: `bilibili:${bv}${p > 1 ? `:${p}` : ''}` }
  }
  return null
}

/** 视频页的网址里带的时间（t=222、t=3m42s、t=222s） */
export function timeParam(raw: string): number | null {
  try {
    const t = new URL(raw).searchParams.get('t')
    if (!t) return null
    const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s?)?$/.exec(t)
    if (!m || !t.length) return null
    const s = Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
    return Number.isFinite(s) ? s : null
  } catch {
    return null
  }
}

/** 视频页的网址（不带时间） */
export function watchUrl(v: Pick<VideoRef, 'site' | 'id' | 'p'>): string {
  if (v.site === 'youtube') return testOrigin ? `${testOrigin}/watch?v=${v.id}` : `https://www.youtube.com/watch?v=${v.id}`
  return `https://www.bilibili.com/video/${v.id}${v.p && v.p > 1 ? `?p=${v.p}` : ''}`
}

/** 带时间的链接：别的软件里点了也是打开网站的那一秒 */
export function timeUrl(v: Pick<VideoRef, 'site' | 'id' | 'p'>, t: number): string {
  const s = Math.max(0, Math.floor(t))
  if (v.site === 'youtube') return `${watchUrl(v)}&t=${s}s`
  return `https://www.bilibili.com/video/${v.id}?p=${v.p ?? 1}&t=${s}`
}

/** 03:42、1:02:03 */
export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${String(m).padStart(2, '0')}:${ss}`
}

/** 截图的文件名用：03-42 */
export const timeSlug = (sec: number) => fmtTime(sec).replace(/:/g, '-')

// ---------------------------------------------------------------- 字幕

/** 一条字幕：开始、结束（秒）、原文，翻好了有译文 */
export interface Cue {
  start: number
  end: number
  text: string
  tr?: string
}

/** 这个视频有的一条字幕 */
export interface Track {
  /** 语言代码（en、zh-Hans、ai-zh） */
  lang: string
  /** 给人看的名字 */
  name: string
  /** 自动生成（YouTube 的 asr）/ B 站 AI 字幕 */
  auto: boolean
  /** B 站的字幕文件地址；YouTube 让播放器自己取 */
  url?: string
}

interface Json3 {
  events?: { tStartMs?: number; dDurationMs?: number; aAppend?: number; segs?: { utf8?: string; tOffsetMs?: number }[] }[]
}

/**
 * YouTube 的 json3 字幕。人工字幕一个事件一条；自动生成的一个词一个时间、没有标点、两行滚动，
 * 先按词拆出来，再合成句子（停顿超过 0.7 秒或者超过 14 个词断一句）。
 */
export function parseJson3(raw: string | Json3, auto: boolean): Cue[] {
  const j: Json3 = typeof raw === 'string' ? (JSON.parse(raw) as Json3) : raw
  const events = (j.events ?? []).filter((e) => e.segs && !e.aAppend)
  if (!auto) {
    const out: Cue[] = []
    for (const e of events) {
      const text = (e.segs ?? []).map((s) => s.utf8 ?? '').join('').replace(/\s+/g, ' ').trim()
      if (!text) continue
      const start = (e.tStartMs ?? 0) / 1000
      out.push({ start, end: start + (e.dDurationMs ?? 0) / 1000, text })
    }
    return out
  }
  const words: { t: number; w: string }[] = []
  let lastEnd = 0
  for (const e of events) {
    const t0 = e.tStartMs ?? 0
    for (const s of e.segs ?? []) {
      const w = (s.utf8 ?? '').replace(/\s+/g, ' ').trim()
      if (w) words.push({ t: (t0 + (s.tOffsetMs ?? 0)) / 1000, w })
    }
    lastEnd = Math.max(lastEnd, (t0 + (e.dDurationMs ?? 0)) / 1000)
  }
  return sentences(words, lastEnd)
}

/** 播放器拿到的字幕：json3，或者老的 srv3（XML，<p t="毫秒" d="毫秒">） */
export function parseYtCaptions(body: string, auto: boolean): Cue[] {
  const s = body.trimStart()
  if (s.startsWith('{')) return parseJson3(s, auto)
  const out: Cue[] = []
  const dec = (x: string) => x.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  for (const m of s.matchAll(/<p\s+t="(\d+)"(?:\s+d="(\d+)")?[^>]*>([\s\S]*?)<\/p>/g)) {
    const text = dec(m[3]!).replace(/\s+/g, ' ').trim()
    if (!text) continue
    const start = Number(m[1]) / 1000
    out.push({ start, end: start + Number(m[2] ?? 0) / 1000, text })
  }
  return out
}

/** 自动生成字幕的词合成句子：停顿超过 gap 秒、遇到句末标点、或者满 maxWords 个词断一句 */
export function sentences(words: { t: number; w: string }[], lastEnd: number, gap = 0.7, maxWords = 14): Cue[] {
  const out: Cue[] = []
  let cur: { t: number; w: string }[] = []
  const flush = (end: number) => {
    if (!cur.length) return
    out.push({ start: cur[0]!.t, end, text: cur.map((x) => x.w).join(' ') })
    cur = []
  }
  words.forEach((w, i) => {
    const prev = cur[cur.length - 1]
    if (prev && (w.t - prev.t > gap + 0.5 || cur.length >= maxWords)) flush(w.t)
    cur.push(w)
    const next = words[i + 1]
    if (/[.?!。？！]$/.test(w.w) || (next && next.t - w.t > gap + 0.5)) flush(next ? Math.min(next.t, w.t + 3) : lastEnd)
  })
  flush(Math.max(lastEnd, (cur[cur.length - 1]?.t ?? 0) + 1))
  return out
}

/** B 站字幕文件：{ body: [{ from, to, content }] } */
export function parseBiliSubtitle(raw: string | { body?: { from?: number; to?: number; content?: string }[] }): Cue[] {
  const j = typeof raw === 'string' ? (JSON.parse(raw) as { body?: { from?: number; to?: number; content?: string }[] }) : raw
  return (j.body ?? [])
    .filter((b) => typeof b.content === 'string' && b.content.trim())
    .map((b) => ({ start: Number(b.from) || 0, end: Number(b.to) || 0, text: b.content!.replace(/\s+/g, ' ').trim() }))
}

/** B 站播放器接口里的字幕列表（data.subtitle.subtitles） */
export function biliTracks(raw: string | Record<string, unknown>): { tracks: Track[]; needLogin: boolean } {
  const j = (typeof raw === 'string' ? JSON.parse(raw) : raw) as {
    data?: { subtitle?: { subtitles?: { lan?: string; lan_doc?: string; subtitle_url?: string; ai_type?: number }[] }; need_login_subtitle?: boolean; login_mid?: number }
  }
  const list = j.data?.subtitle?.subtitles ?? []
  const tracks = list
    .filter((s) => s.lan && s.subtitle_url)
    .map((s) => ({
      lang: s.lan!,
      name: s.lan_doc ?? s.lan!,
      auto: s.lan!.startsWith('ai-'),
      url: s.subtitle_url!.startsWith('//') ? `https:${s.subtitle_url}` : s.subtitle_url!,
    }))
  // 人工字幕在前
  tracks.sort((a, b) => Number(a.auto) - Number(b.auto))
  return { tracks, needLogin: !tracks.length && (!!j.data?.need_login_subtitle || !j.data?.login_mid) }
}

/** YouTube 播放器里的字幕列表（captionTracks） */
export function ytTracks(list: { languageCode?: string; kind?: string; name?: { simpleText?: string; runs?: { text?: string }[] } }[]): Track[] {
  const out = list
    .filter((t) => t.languageCode)
    .map((t) => ({ lang: t.languageCode!, name: t.name?.simpleText ?? t.name?.runs?.map((r) => r.text ?? '').join('') ?? t.languageCode!, auto: t.kind === 'asr' }))
  out.sort((a, b) => Number(a.auto) - Number(b.auto))
  return out
}

/** 一条字幕的编号：语言代码，自动生成的后面加 #auto（YouTube 同一种语言常有人工和自动两条） */
export const trackId = (t: Pick<Track, 'lang' | 'auto'>) => `${t.lang}${t.auto ? '#auto' : ''}`

/** 选哪条：上次选的还在就用它，不然人工字幕在前（视频原来的语言优先） */
export function pickTrack(tracks: Track[], last?: string | null): Track | null {
  if (!tracks.length) return null
  const prim = (l: string) => l.replace(/^ai-/, '').toLowerCase().split(/[-_]/)[0]
  // 视频说的是什么话：自动生成的那条的语言；有这种语言的人工字幕就用它，没有就用自动生成的那条
  const spoken = tracks.find((t) => t.auto)
  const human = spoken ? tracks.find((t) => !t.auto && prim(t.lang) === prim(spoken.lang)) : undefined
  return tracks.find((t) => trackId(t) === last) ?? tracks.find((t) => t.lang === last) ?? human ?? spoken ?? tracks.find((t) => !t.auto && prim(t.lang) === 'en') ?? tracks[0]!
}

/** 正在播的那一条（没有就 -1） */
export function cueAt(cues: Cue[], t: number): number {
  let lo = 0
  let hi = cues.length - 1
  let hit = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (cues[mid]!.start <= t) {
      hit = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  if (hit === -1) return -1
  // 两条中间的空当还算上一条（最多 1.5 秒），免得字幕一闪一闪
  return t <= Math.max(cues[hit]!.end, cues[hit]!.start) + 1.5 ? hit : -1
}

/** 这一秒前后几条（时刻里存的「前后 4 行」）；当前那条不在就找最近开始的 */
export function cuesAround(cues: Cue[], t: number, before = 2, after = 2): { list: Cue[]; current: number } {
  if (!cues.length) return { list: [], current: -1 }
  let i = cueAt(cues, t)
  if (i === -1) {
    i = cues.findIndex((c) => c.start > t)
    i = i === -1 ? cues.length - 1 : Math.max(0, i - 1)
  }
  const from = Math.max(0, i - before)
  return { list: cues.slice(from, i + after + 1), current: i - from }
}

/** 前后 secs 秒的字幕（问 AI 时给它看） */
export const cuesBetween = (cues: Cue[], from: number, to: number) => cues.filter((c) => c.end >= from && c.start <= to)

// ---------------------------------------------------------------- 存进笔记

/** 视频的说明：标题、频道、时长（秒）、封面图地址 */
export interface VideoMeta {
  title: string
  channel: string
  duration: number
  cover?: string
}

export const siteName = (s: Site) => (s === 'youtube' ? 'YouTube' : 'B 站')

/** 视频标题当文件名：去掉文件名里不能有的字，最长 80 */
export function safeTitle(t: string): string {
  const s = t.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
  return s || '视频'
}

/** 笔记里指向库里另一个文件的相对链接（图片按笔记所在的文件夹算），空格和括号转义 */
export function relLink(notePath: string, target: string): string {
  const from = notePath.split('/').slice(0, -1)
  const to = target.split('/')
  let i = 0
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++
  const rel = [...from.slice(i).map(() => '..'), ...to.slice(i)].join('/')
  return rel.replace(/[()\s]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'))
}

/** 附件放哪：附件/视频/<站>-<id>[-p2]/ */
export const attachDir = (v: Pick<VideoRef, 'site' | 'id' | 'p'>) => `附件/视频/${v.site}-${v.id}${v.p && v.p > 1 ? `-p${v.p}` : ''}`

/** 视频卡：一行封面、一行标题链接、一行「频道 · 时长」；文档里前面多一行注释（白板卡片自己有注释，不加） */
export function videoCardMd(v: VideoRef, meta: VideoMeta, cover: string | null, opts: { comment: boolean }): string {
  const lines = [
    ...(opts.comment ? [`<!-- video video=${v.key} -->`] : []),
    ...(cover ? [`![${mdText(meta.title)}](${cover})`] : []),
    `[${mdText(meta.title)}](${watchUrl(v)})`,
    [meta.channel, meta.duration ? fmtTime(meta.duration) : ''].filter(Boolean).join(' · ') || siteName(v.site),
  ]
  return lines.join('\n')
}

/** md 链接文字里的 [ ] 换掉，免得把链接拆坏 */
const mdText = (s: string) => s.replace(/[[\]]/g, (c) => (c === '[' ? '［' : '］')).replace(/\n/g, ' ')

/**
 * 时刻：注释（视频和秒数）+ 截图 + 带时间的链接 + 前后几行双语字幕（当前那行加粗）。
 * 普通 md，Obsidian 也能看；链接在别的软件里打开网站的那一秒。
 */
export function momentMd(v: VideoRef, meta: Pick<VideoMeta, 'title'>, t: number, image: string | null, around: { list: Cue[]; current: number }): string {
  const tt = fmtTime(t)
  const lines = [`<!-- moment video=${v.key} t=${Math.round(t * 10) / 10} -->`, ...(image ? [`![${tt}](${image})`] : []), `[▶ ${tt} · ${mdText(meta.title)}](${timeUrl(v, t)})`]
  around.list.forEach((c, i) => {
    const s = `${fmtTime(c.start)} ${c.text}${c.tr ? ` / ${c.tr}` : ''}`.replace(/\n/g, ' ')
    lines.push(i === around.current ? `> **${s.replace(/\*/g, '＊')}**` : `> ${s}`)
  })
  return lines.join('\n')
}

export interface MomentInfo {
  key: string
  t: number
  image: string | null
  title: string
  url: string
  /** 前后几行：时间、原文、译文、是不是当前那行 */
  lines: { time: string; text: string; tr: string; current: boolean }[]
  /** 问过 AI 的（问答块） */
  asked: boolean
}

const MOMENT_HEAD = /^<!--\s*(moment|moment-ask)\s+video=(\S+)\s+t=([\d.]+)\s*-->$/

/** 认时刻块（文档里一块、白板卡片的正文）；不是就给 null */
export function parseMoment(text: string): MomentInfo | null {
  const lines = text.split('\n')
  const m = MOMENT_HEAD.exec(lines[0]?.trim() ?? '')
  if (!m) return null
  const info: MomentInfo = { key: m[2]!, t: Number(m[3]), image: null, title: '', url: '', lines: [], asked: m[1] === 'moment-ask' }
  for (const raw of lines.slice(1)) {
    const l = raw.trim()
    const img = /^!\[[^\]]*\]\(([^)\s]+)\)$/.exec(l)
    const link = /^\[▶ [\d:]+ · (.*)\]\((\S+)\)$/.exec(l)
    const q = /^>\s?(.*)$/.exec(l)
    if (img && !info.image) info.image = img[1]!
    else if (link && !info.url) {
      info.title = link[1]!
      info.url = link[2]!
    } else if (q && !info.asked) {
      let s = q[1]!.trim()
      const current = /^\*\*.*\*\*$/.test(s)
      if (current) s = s.slice(2, -2)
      const tm = /^(\d+:\d{2}(?::\d{2})?)\s+(.*)$/.exec(s)
      if (!tm) continue
      const [text, tr = ''] = tm[2]!.split(' / ')
      info.lines.push({ time: tm[1]!, text: text!, tr: tr ?? '', current })
    }
  }
  return info
}

/** 认视频卡（白板卡片正文：封面 + 标题链接 + 频道行；文档里前面多一行注释） */
export function parseVideoCard(text: string): { ref: VideoRef; url: string; title: string; cover: string | null; meta: string } | null {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^<!--\s*video\s/.test(l))
  if (lines.length < 1 || lines.length > 3) return null
  let i = 0
  const img = /^!\[[^\]]*\]\(([^)\s]+)\)$/.exec(lines[0]!)
  if (img) i++
  const link = /^\[([^\]]+)\]\((https?:\/\/\S+)\)$/.exec(lines[i] ?? '')
  if (!link) return null
  const ref = videoOf(link[2])
  if (!ref) return null
  const meta = lines[i + 1] ?? ''
  if (lines.length > i + 2 || /^[>#!-]/.test(meta)) return null
  return { ref, url: link[2]!, title: link[1]!, cover: img?.[1] ?? null, meta }
}

// ---------------------------------------------------------------- 字幕全文进素材

export const VIDEO_FOLDER = '素材/视频'

export interface Chapter {
  start: number
  title: string
}

/** 章节：有就用它的，没有按每 5 分钟一章（AI 分章以后再补） */
export function chaptersFor(cues: Cue[], given: Chapter[]): Chapter[] {
  if (given.length) return [...given].sort((a, b) => a.start - b.start)
  if (!cues.length) return [{ start: 0, title: '全文' }]
  const end = cues[cues.length - 1]!.end
  const out: Chapter[] = []
  for (let s = 0; s < Math.max(end, 1); s += 300) out.push({ start: s, title: `${fmtTime(s)} 起` })
  return out
}

export interface SubtitleDocInput {
  ref: VideoRef
  meta: VideoMeta
  track: Track
  /** 翻成什么（没翻是 null） */
  target: string | null
  cues: Cue[]
  chapters: Chapter[]
  /** AI 摘要：每条一个时间和一句话；还没写好是 null */
  summary: { t: number; text: string }[] | null
  moments: { t: number; text: string; note: string }[]
  /** 存不存译文（设置「存字幕全文时带译文」） */
  withTranslation: boolean
}

/** 字幕全文那一篇：frontmatter、AI 摘要、记下的时刻、按章节的字幕（每行一个时间链接、原文、下一行译文） */
export function subtitleDoc(d: SubtitleDocInput): string {
  const { ref } = d
  const fm = [
    '---',
    'type: video',
    `source: ${watchUrl(ref)}`,
    `site: ${ref.site}`,
    `channel: ${d.meta.channel.replace(/\n/g, ' ')}`,
    `duration: ${Math.round(d.meta.duration)}`,
    `subtitles: ${d.track.lang} · ${d.track.auto ? '自动生成' : '人工字幕'}`,
    ...(d.target && d.withTranslation ? [`translated: ${d.target}`] : []),
    '---',
  ]
  const out = [...fm, `# ${d.meta.title.replace(/\n/g, ' ')}`, '', '## AI 摘要']
  if (d.summary?.length) for (const s of d.summary) out.push(`- [${fmtTime(s.t)}](${timeUrl(ref, s.t)}) ${s.text}`)
  else out.push('AI 在写摘要…')
  out.push('', '## 记下的时刻')
  if (d.moments.length) for (const m of [...d.moments].sort((a, b) => a.t - b.t)) out.push(`- [${fmtTime(m.t)}](${timeUrl(ref, m.t)}) ${m.text}${m.note ? ` · [[${m.note}]]` : ''}`)
  else out.push('还没有。看的时候按 ⌥S 记下这一刻。')
  const chs = chaptersFor(d.cues, d.chapters)
  chs.forEach((ch, i) => {
    const next = chs[i + 1]?.start ?? Infinity
    const lines = d.cues.filter((c) => c.start >= ch.start && c.start < next)
    if (!lines.length && i > 0) return
    out.push('', `## ${fmtTime(ch.start)} ${ch.title}`)
    for (const c of lines) {
      out.push(`[${fmtTime(c.start)}](${timeUrl(ref, c.start)}) ${c.text}`)
      if (d.withTranslation && c.tr) out.push(c.tr)
      out.push('')
    }
    if (out[out.length - 1] === '') out.pop()
  })
  return out.join('\n') + '\n'
}

/** 读回字幕全文里的译文：下次打开同一个视频先用这篇里的，不再翻（时间对上、原文对上才算） */
export function readTranslations(doc: string): Map<string, string> {
  const out = new Map<string, string>()
  const lines = doc.split('\n')
  for (let i = 0; i < lines.length - 1; i++) {
    const m = /^\[(\d+:\d{2}(?::\d{2})?)\]\(\S+\) (.+)$/.exec(lines[i]!)
    const next = lines[i + 1]!
    if (m && next.trim() && !/^\[|^#|^- /.test(next)) out.set(`${m[1]} ${m[2]}`, next)
  }
  return out
}

/** AI 摘要的回答：每行「mm:ss 一句话」；认不出的行不要 */
export function parseSummary(text: string): { t: number; text: string }[] {
  const out: { t: number; text: string }[] = []
  for (const line of text.split('\n')) {
    const m = /^[-*\s]*\[?(\d{1,2}):(\d{2})(?::(\d{2}))?\]?(?:\([^)]*\))?\s*[-—:：·]?\s*(.+)$/.exec(line.trim())
    if (!m) continue
    const t = m[3] ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : Number(m[1]) * 60 + Number(m[2])
    out.push({ t, text: m[4]!.trim() })
  }
  return out.slice(0, 12)
}

// ---------------------------------------------------------------- 记到哪

/** 中间栏现在开着什么 */
export type CenterKind = { kind: 'doc'; path: string; title: string } | { kind: 'board'; path: string; title: string } | { kind: 'material'; path: string; title: string } | { kind: 'none' }

/** 记下的东西落在哪 */
export type Dest = { kind: 'doc'; path: string; title: string } | { kind: 'board'; path: string; title: string } | { kind: 'inbox'; path: string; title: string }

export const inboxPathFor = (title: string) => `收件箱/${safeTitle(title)}.md`

/**
 * 记到哪（spec 第 2 节）：开着文档插到光标处；开着白板进这个视频的「时刻」列；
 * 开着的是这个视频自己的字幕全文就记进上一篇开着的文档；什么都没开进「收件箱/<视频标题>.md」。
 */
export function destFor(center: CenterKind, lastDoc: { path: string; title: string } | null, videoTitle: string): Dest {
  if (center.kind === 'doc') return { kind: 'doc', path: center.path, title: center.title }
  if (center.kind === 'board') return { kind: 'board', path: center.path, title: center.title }
  if (center.kind === 'material' && lastDoc) return { kind: 'doc', ...lastDoc }
  const path = inboxPathFor(videoTitle)
  return { kind: 'inbox', path, title: safeTitle(videoTitle) }
}
