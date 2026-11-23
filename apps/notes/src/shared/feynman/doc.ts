/**
 * 费曼一轮的存法（notes.md「和画布笔记现有的东西怎么接」、teaching.md 4.4）：一轮是文档里的一节
 *
 *   ## 费曼 · 范数
 *   <!-- feynman {"v":1,"id":"f-20261123-a1b2",…} -->
 *
 *   范数就是……（你讲的，原话不改）
 *
 *   > [!ai] 学生 · Claude Code · Opus 5.5
 *   > 你说「……」。那……？
 *
 *   我觉得……（你答的）
 *
 *   > [!ai] 判定 · Claude Code · Opus 5.5
 *   > 没过：……
 *
 * 标题下一行的隐藏注释记 FeynmanMeta（JSON 一行；里面的 `--` 写成 `--`，注释不会提前收尾）。
 * 学生的话、说穿、确认、判定、缺口、说法提醒、完整版都是 `> [!ai]` 块，头一个词认是哪种；别的都是你说的（普通段落）。
 * 缺口不用 `- [ ]`（不然跑进待办、被画布今日当成任务）。
 *
 * 规矩：读不改字；改只动该动的那一段（注释那一行、插进去的块、换掉的判定块），打开再保存一字不变（test/feynman-doc.test.ts）。
 * 白板上注释那一行不成卡（@cn/format 的 splitDoc 跳过只有注释的块）。
 */
import { aiCallout } from '@cn/format'
import type { Entry, EntryKind, FeynmanMeta, RoundSection } from './types'

/** 写进文件的说法（跟库语言）；读的时候两种都认 */
export interface FeynmanWords {
  /** 标题「费曼 · 范数」的头一个词 */
  head: string
  /** 「记进笔记」那一块的标题头一个词 */
  gapNote: string
  labels: Record<Exclude<EntryKind, 'me'>, string>
}

export const ZH_WORDS: FeynmanWords = {
  head: '费曼',
  gapNote: '费曼缺口',
  labels: { student: '学生', reveal: '说穿', confirm: '确认', verdict: '判定', gaps: '缺口', wording: '说法提醒', full: '完整版' },
}
export const EN_WORDS: FeynmanWords = {
  head: 'Feynman',
  gapNote: 'Feynman gaps',
  labels: { student: 'Student', reveal: 'Answer given', confirm: 'Check', verdict: 'Verdict', gaps: 'Gaps', wording: 'Wording', full: 'Full version' },
}
export const wordsOf = (lang: 'zh' | 'en'): FeynmanWords => (lang === 'en' ? EN_WORDS : ZH_WORDS)

const LABEL_KIND = new Map<string, Exclude<EntryKind, 'me'>>()
for (const w of [ZH_WORDS, EN_WORDS]) for (const [k, v] of Object.entries(w.labels)) LABEL_KIND.set(v, k as Exclude<EntryKind, 'me'>)

const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/
const META = /^<!--\s*feynman\s+(\{.*\})\s*-->[ \t]*$/
const FENCE = /^ {0,3}(`{3,}|~{3,})/
/** 白板的位置行、卡片块：`<!-- card id=… x=… -->`、`<!-- column id=… -->` */
const PLACE = /^<!--\s*(card|column)\b[^\n]*-->[ \t]*$/
const AI_HEAD = /^>\s*\[!ai\][+-]?[ \t]*(.*)$/i

/** 注释里的 JSON：`--` 换成 `--`（JSON 里只有字符串里会有连着两个减号） */
export function metaLine(meta: FeynmanMeta): string {
  return `<!-- feynman ${JSON.stringify(meta).replace(/--/g, '-\\u002d')} -->`
}

/** 读注释里的 JSON；不是一轮的写法返回 null */
export function parseMetaLine(line: string): FeynmanMeta | null {
  const m = META.exec(line)
  if (!m) return null
  try {
    const o = JSON.parse(m[1]!) as FeynmanMeta
    return o && typeof o === 'object' && o.v === 1 && typeof o.id === 'string' && typeof o.topic === 'string' ? o : null
  } catch {
    return null
  }
}

/** 标题的字：「费曼 · 范数」 */
export const roundTitle = (topic: string, w: FeynmanWords = ZH_WORDS) => `${w.head} · ${topic.replace(/\s*\n\s*/g, ' ').trim()}`

interface Line {
  text: string
  from: number
  to: number
}

function linesOf(text: string): Line[] {
  const out: Line[] = []
  let pos = 0
  for (const t of text.split('\n')) {
    out.push({ text: t, from: pos, to: pos + t.length })
    pos += t.length + 1
  }
  return out
}

/** 一节的正文切成一段段：`> [!ai]` 块一块一段，别的连着的（中间空行也算）并成你说的一段 */
function entriesOf(text: string, lines: Line[], start: number, end: number): Entry[] {
  const out: Entry[] = []
  let me: { from: number; to: number } | null = null
  const flushMe = () => {
    if (me) out.push({ kind: 'me', text: text.slice(me.from, me.to), from: me.from, to: me.to })
    me = null
  }
  let fence: string | null = null
  for (let i = start; i < end; i++) {
    const l = lines[i]!
    if (!fence) {
      const h = AI_HEAD.exec(l.text)
      if (h) {
        const parts = h[1]!.split(' · ').map((s) => s.trim())
        const kind = LABEL_KIND.get(parts[0] ?? '')
        if (kind) {
          flushMe()
          let j = i + 1
          while (j < end && /^>/.test(lines[j]!.text)) j++
          const body = lines
            .slice(i + 1, j)
            .map((x) => x.text.replace(/^>[ ]?/, ''))
            .join('\n')
          const by = parts
            .slice(1)
            .filter((p) => !/^(改过|edited)$/.test(p))
            .join(' · ')
          out.push({ kind, text: body, ...(by ? { by } : {}), from: l.from, to: lines[j - 1]!.to })
          i = j - 1
          continue
        }
      }
    }
    const f = FENCE.exec(l.text)
    if (f) fence = fence ? (f[1]![0] === fence[0] && f[1]!.length >= fence.length ? null : fence) : f[1]!
    if (l.text.trim() === '' && !fence) continue
    me = me ? { from: me.from, to: l.to } : { from: l.from, to: l.to }
  }
  flushMe()
  return out
}

/** 认出文档里所有的费曼轮（标题下一行就是 feynman 注释的那几节），按文档里的先后 */
export function findRounds(text: string): RoundSection[] {
  const lines = linesOf(text)
  const heads: { i: number; level: number; title: string }[] = []
  let fence: string | null = null
  lines.forEach((l, i) => {
    const f = FENCE.exec(l.text)
    if (f) {
      fence = fence ? (f[1]![0] === fence[0] && f[1]!.length >= fence.length ? null : fence) : f[1]!
      return
    }
    if (fence) return
    const h = HEADING.exec(l.text)
    if (h) heads.push({ i, level: h[1]!.length, title: h[2]! })
  })
  const out: RoundSection[] = []
  heads.forEach((h, k) => {
    const ml = lines[h.i + 1]
    const meta = ml ? parseMetaLine(ml.text) : null
    if (!meta) return
    const next = heads.slice(k + 1).find((x) => x.level <= h.level)
    // 白板的位置行（下一列、拖到空白处的卡、旧白板和导图白板的卡片块）是后面那一样的，这一节到它为止
    let stop = h.i + 2
    const lastLine = next ? next.i : lines.length
    while (stop < lastLine && !PLACE.test(lines[stop]!.text)) stop++
    const endLine = stop
    const end = endLine < lines.length ? lines[endLine]!.from : text.length
    const head = lines[h.i]!
    out.push({
      meta,
      head: { from: head.from, to: head.to, level: h.level, title: h.title },
      metaLine: { from: ml!.from, to: ml!.to },
      end,
      entries: entriesOf(text, lines, h.i + 2, endLine),
    })
  })
  return out
}

/** 按编号找一轮 */
export const roundById = (text: string, id: string): RoundSection | null => findRounds(text).find((r) => r.meta.id === id) ?? null

function need(text: string, id: string): RoundSection {
  const r = roundById(text, id)
  if (!r) throw new Error(`文档里找不到这一轮（${id}）`)
  return r
}

/** 新的一节（标题 + 注释，结尾一个换行）；level 是几级标题（白板的列是几级就用几级，一般 2） */
export function roundSection(meta: FeynmanMeta, w: FeynmanWords = ZH_WORDS, level = 2): string {
  return `${'#'.repeat(level)} ${roundTitle(meta.topic, w)}\n${metaLine(meta)}\n`
}

/**
 * 把新的一节加进文档：at 给了插在那里（一行的开头，比如下一节的标题前面），不给接在文末；前后各隔一个空行，别处一字不动
 */
export function addRound(text: string, meta: FeynmanMeta, o: { words?: FeynmanWords; level?: number; at?: number } = {}): string {
  const sec = roundSection(meta, o.words, o.level)
  const at = o.at ?? text.length
  const before = text.slice(0, at)
  const after = text.slice(at)
  const lead = before === '' ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
  const tail = after === '' ? '' : '\n'
  return before + lead + sec + tail + after
}

/** 换掉这一轮的注释（只动那一行；一样就原样返回） */
export function setMeta(text: string, meta: FeynmanMeta): string {
  const r = need(text, meta.id)
  const line = metaLine(meta)
  if (text.slice(r.metaLine.from, r.metaLine.to) === line) return text
  return text.slice(0, r.metaLine.from) + line + text.slice(r.metaLine.to)
}

/** 一段写成文档里的样子：你说的原样（去掉首尾空行）；AI 的写成 `> [!ai] 学生 · Claude Code · Opus 5.5` 块 */
export function entryText(kind: EntryKind, body: string, by?: string, w: FeynmanWords = ZH_WORDS): string {
  if (kind === 'me') return body.replace(/^\s*\n/, '').replace(/\s+$/, '')
  return aiCallout({ label: w.labels[kind], ...(by ? { by } : {}), text: body.trim() || '…' })
}

/** 在这一节末尾（最后一段字后面）加一段；和前面隔一个空行。返回新的全文 */
export function appendEntry(text: string, id: string, kind: EntryKind, body: string, by?: string, w: FeynmanWords = ZH_WORDS): string {
  const r = need(text, id)
  const add = entryText(kind, body, by, w)
  if (!add) return text
  let at = r.end
  while (at > r.metaLine.to && /\s/.test(text[at - 1]!)) at--
  const after = text.slice(at)
  // 后面还有别的节：保证插进去的块和下一个标题之间还隔着空行
  const tail = after === '' ? '\n' : /^\n\n/.test(after) ? '' : /^\n/.test(after) ? '\n' : '\n\n'
  return text.slice(0, at) + '\n\n' + add + tail + after
}

/** 换掉这一节里某一种 AI 块（判定、缺口、说法提醒、完整版各只有一块）：有就原地换，没有就加在末尾；body 空串是删掉 */
export function putBlock(text: string, id: string, kind: Exclude<EntryKind, 'me'>, body: string, by?: string, w: FeynmanWords = ZH_WORDS): string {
  const r = need(text, id)
  const old = [...r.entries].reverse().find((e) => e.kind === kind)
  if (!old) return body.trim() ? appendEntry(text, id, kind, body, by, w) : text
  if (!body.trim()) {
    // 连同和后一段之间的空行一起删；后面没有了（文末、下一节）就删和前一段之间的
    if (text.startsWith('\n\n', old.to) && text.slice(old.to + 2, r.end).trim()) return text.slice(0, old.from) + text.slice(old.to + 2)
    const from = text.slice(0, old.from).endsWith('\n\n') ? old.from - 2 : old.from
    return text.slice(0, from) + text.slice(old.to)
  }
  const add = entryText(kind, body, by ?? old.by, w)
  return text.slice(0, old.from) + add + text.slice(old.to)
}

/** 这一节里你说的（me）全部原话，按先后；给判定、补进导图用 */
export const myWords = (r: RoundSection): string[] => r.entries.filter((e) => e.kind === 'me').map((e) => e.text)
