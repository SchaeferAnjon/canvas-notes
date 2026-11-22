/**
 * ⌘F / ⌘K 打字以后的行：按组排好、每组最多几条（别把上万条全铺开），界面只管画和点。
 * 组从上到下（2026-11-21 cmdk 方案 A，DESIGN.v3 3.4）：最合适（1 条）→ 笔记（名字对上的笔记和 PDF）→ 命令 →
 * 笔记和PDF里的字（正文和 PDF 页轮流）→ 意思相近（本机小模型）→ 网页 → 最后一行「让 Claude 帮我找」。
 * 没打字时的八组不在这里，在 cmd-layout.ts。
 *
 * 「最合适」同时看名字对上了多少、别名是不是打全了、最近用过没有（照 VS Code 和 Raycast）。
 * 打全了命令的名字或别名，它一定是最合适，后到的笔记结果挤不掉（回车跑命令还是开笔记不看手快手慢）。
 *
 * 回车选哪一行（2026-11-17 用户定，从根上定）：
 * - 默认选中的永远是本地结果；「在右栏网页里打开 / 搜」「让 Claude 找」永远不是默认，
 *   唯一例外是打的明明白白是网址（带 http(s):// 或 www. 开头）、库里又没有名字对得上的。
 * - 像网址的笔记名（readme.md、Node.js、Lecture06.pdf）不默认上网：要上网按 ⌘↵ 或自己点网页那一行。
 * - 字面没结果时，「意思相近」的要过门槛（sure）才默认选中；都不过就不选，回车不做事。
 * - 没把握的「意思相近」任何时候都不让键盘选中（不默认、↓ ↑ 也跳过），只能鼠标点（第 4 轮）。
 * - 打的像网址 / 域名（example.com、readme.md）：只有名字字面对得上的笔记、PDF 才默认；正文里有、意思相近的都不默认，
 *   都没有就不选，提示 ⌘↵ 去网页（第 4 轮用户定）。
 * - ↓ ↑ 只在键盘能选的本地结果里挪（canKey），网页、让 Claude 找那两行用 ⌘↵、⌥↵ 或鼠标。
 * - 选中按「第几个键盘能选的本地结果」记（Cursor），不按行号；结果没出齐时按的键先记着，出齐了再照顺序按（keyIsFinal），
 *   所以早按、晚按落在同一行（第 4 轮：结果没出来先按 ↓，等意思相近出来再回车开了没把握的那篇）。
 */
import type { SearchHit } from '../../shared/api'
import type { ClaudeFound, MeaningHit, PdfTextHit } from '../../shared/search'
import { GROUP_MORE, GROUP_SHOW } from '../../shared/search'
import { t } from '../../shared/i18n'

export interface Cmd {
  name: string
  hint?: string
  keys?: string
  /** 起的别名：打全了这一条排第一 */
  alias?: string
  /** 藏起的：打字照样搜得到，右端标「藏着的」 */
  hidden?: boolean
  /** 钉住的：最合适里稍微加一点 */
  pinned?: boolean
  /** 最近用过的第几条（0 是刚用过）；没用过不给 */
  usedRank?: number
  /** 名字、说明以外也搜得到它的词（不显示）：出卡打 anki 也找得到 */
  kw?: string
  /** 别的语言的名字（不显示）：英文界面打中文名、中文界面打英文名照样搜得到，和名字一样算分（换语言后肌肉记忆不丢） */
  names?: string[]
  /** 别的语言的说明（不显示） */
  hints?: string[]
  /** 自己一组、组名是它（「以前的「我的疑惑」」）：不当最合适、不当回车默认 */
  aside?: string
}

export type Group = 'recent' | 'best' | 'notes' | 'cmd' | 'aside' | 'text' | 'meaning' | 'web' | 'claude'

export type Row<C extends Cmd = Cmd> =
  /** nodefault：键盘能挪到，但不当默认（打的像网址时正文里有这个词的笔记） */
  | { kind: 'note'; group: Group; path: string; snippet?: string; nodefault?: true }
  | { kind: 'pdfName'; group: Group; path: string }
  | { kind: 'pdfPage'; group: Group; hit: PdfTextHit; nodefault?: true }
  | { kind: 'meaning'; group: Group; hit: MeaningHit }
  /** exact：打全了名字或别名、排在最前的那条命令（后到的结果挤不动它） */
  | { kind: 'cmd'; group: Group; cmd: C; exact?: true; nodefault?: true }
  /** search：不像网址、是拿这几个字去网上搜（回车默认不选它，只有 ⌘↵ 或自己挪过去选它才去网上） */
  | { kind: 'url'; group: Group; url: string; search?: boolean; /** 打的明明白白是网址、库里没有名字对得上的：回车默认开它 */ typed?: boolean }
  /** 「还有 N 条」：点了这一组多显示一些 */
  | { kind: 'more'; group: Group; n: number }
  | { kind: 'claude'; group: Group }
  | { kind: 'found'; group: Group; found: ClaudeFound }

export type ClaudeState = { phase: 'idle' } | { phase: 'running'; looked: number; step: string } | { phase: 'done'; found: ClaudeFound[]; error?: string }

export interface RowsInput<C extends Cmd> {
  q: string
  /** 最近打开的（最合适里稍微加一点） */
  recent: string[]
  pdfNames: string[]
  hits: SearchHit[]
  pdfHits: PdfTextHit[]
  meaning: MeaningHit[]
  commands: C[]
  /** 输进来的像网址时的那个网址，不像时也有（最后在右栏网页里打开） */
  url: string | null
  /** 像网址（readme.md、Node.js 也算）：网页那一行写「打开」不写「搜」 */
  looksUrl: boolean
  /** 明明白白是网址：带 http(s):// 或 www. 开头（只有它在库里没有名字对得上的时候默认打开网址） */
  explicitUrl?: boolean
  /** 哪几组点过「还有 N 条」 */
  expanded: Set<Group>
  claude: ClaudeState
}

const baseName = (path: string) => path.split('/').pop() ?? path
const titleHasAll = (path: string, words: string[]) => {
  const t = baseName(path).toLowerCase()
  return words.every((w) => t.includes(w))
}

/** 名字对上了多少：一样 900、开头 600、里面有（或几个词都有）400，没对上 0 */
export function nameScore(name: string, q: string): number {
  const t = name.toLowerCase()
  const k = q.toLowerCase().trim()
  if (!k) return 0
  if (t === k) return 900
  if (t.startsWith(k)) return 600
  if (t.includes(k)) return 400
  const words = k.split(/\s+/).filter(Boolean)
  return words.length > 1 && words.every((w) => t.includes(w)) ? 400 : 0
}

/** 笔记的名字（不带 .md）、PDF 的名字（带 .pdf） */
const noteName = (path: string) => baseName(path).replace(/\.md$/i, '')

/** 先放这么多，多的写「还有 N 条」 */
function capped<C extends Cmd>(group: Group, rows: Row<C>[], expanded: Set<Group>): Row<C>[] {
  const max = expanded.has(group) ? GROUP_MORE : GROUP_SHOW
  if (rows.length <= max) return rows
  return [...rows.slice(0, max), { kind: 'more', group, n: rows.length - max }]
}

/** 「最合适」够格的线：名字里有（400）；只有说明里有的不够 */
const BEST_MIN = 400

export function buildRows<C extends Cmd>(o: RowsInput<C>): Row<C>[] {
  const q = o.q.trim()
  if (!q) return []
  const k = q.toLowerCase()
  const words = k.split(/\s+/).filter(Boolean)
  const out: Row<C>[] = []
  // 打的像网址 / 域名：只有名字对得上的才能当默认（正文里有、意思相近的都不行）
  const nd = o.looksUrl ? ({ nodefault: true } as const) : {}

  // ---- 命令：名字、别名、说明；打全了名字或别名的一定最合适 ----
  type Cand = { s: number; row: Row<C> }
  const cmds: Cand[] = []
  const asides: Row<C>[] = []
  for (const cmd of o.commands) {
    const byAlias = !!cmd.alias && cmd.alias.toLowerCase() === k
    let s = byAlias ? 3000 : Math.max(...[cmd.name, ...(cmd.names ?? [])].map((n) => nameScore(n, q)))
    if (s === 900) s = 2000
    if (!s && cmd.kw?.toLowerCase().includes(k)) s = 400
    if (!s && [cmd.hint, ...(cmd.hints ?? [])].some((h) => h?.toLowerCase().includes(k))) s = 150
    if (!s) continue
    if (cmd.aside) {
      asides.push({ kind: 'cmd', group: 'aside', cmd, nodefault: true })
      continue
    }
    if (cmd.usedRank !== undefined && cmd.usedRank < 4) s += 120 - cmd.usedRank * 30
    if (cmd.pinned) s += 50
    const exact = s >= 2000
    cmds.push({ s, row: { kind: 'cmd', group: 'cmd', cmd, ...(exact ? { exact: true as const } : o.looksUrl ? nd : {}) } })
  }

  // ---- 名字对上的 PDF、笔记 ----
  const names: Cand[] = o.pdfNames.filter((p) => titleHasAll(p, words)).map((path) => ({ s: Math.max(nameScore(baseName(path), q), nameScore(baseName(path).replace(/\.pdf$/i, ''), q), 400) + (o.recent.includes(path) ? 60 : 0), row: { kind: 'pdfName', group: 'notes', path } }))
  const titled = o.hits.filter((h) => titleHasAll(h.path, words))
  const body = o.hits.filter((h) => !titleHasAll(h.path, words))
  const note = (h: SearchHit, x: { nodefault?: true } = {}): Row<C> => ({ kind: 'note', group: 'text', path: h.path, snippet: h.snippet, ...x })
  const notes: Cand[] = [...names, ...titled.map((h) => ({ s: Math.max(nameScore(noteName(h.path), q), 400) + (o.recent.includes(h.path) ? 60 : 0), row: { ...note(h), group: 'notes' as Group } }))]

  // ---- 最合适：命令和名字对上的笔记里分数最高的一条（一样高时命令先，照小样） ----
  const all = [...cmds, ...notes].sort((a, b) => b.s - a.s)
  const top = all[0] && all[0].s >= BEST_MIN ? all[0] : null
  if (top) out.push({ ...top.row, group: 'best' } as Row<C>)

  out.push(...capped('notes', notes.filter((c) => c !== top).sort((a, b) => b.s - a.s).map((c) => c.row), o.expanded))
  out.push(...capped('cmd', cmds.filter((c) => c !== top).sort((a, b) => b.s - a.s).map((c) => c.row), o.expanded))
  out.push(...asides)

  // ---- 笔记和PDF里的字：正文和 PDF 页轮流 ----
  const mixed: Row<C>[] = []
  for (let i = 0; i < Math.max(body.length, o.pdfHits.length); i++) {
    if (body[i]) mixed.push(note(body[i]!, nd))
    if (o.pdfHits[i]) mixed.push({ kind: 'pdfPage', group: 'text', hit: o.pdfHits[i]!, ...nd })
  }
  out.push(...capped('text', mixed, o.expanded))
  // 明明白白的网址、库里没有名字对得上的：网址那一行放最前（它就是默认）；名字对得上的，笔记在前，网址放到网页那一组
  const urlFirst = !!(o.explicitUrl && o.url && !names.length && !titled.length)
  if (urlFirst) out.unshift({ kind: 'url', group: 'web', url: o.url!, typed: true })

  // ---- 意思相近：文字那一层已经有的（同一篇、同一页）不再列 ----
  const seen = new Set([...o.hits.map((h) => h.path), ...o.pdfHits.map((h) => `${h.path}#${h.page}`), ...o.pdfNames.filter((p) => titleHasAll(p, words))])
  // 打的像网址：意思相近的一律算没把握（不默认、键盘选不到，只能鼠标点）
  const meaning = o.meaning.filter((h) => !seen.has(h.page ? `${h.path}#${h.page}` : h.path)).map((h) => (o.looksUrl && h.sure ? { ...h, sure: false } : h))
  out.push(...capped('meaning', meaning.map((hit): Row<C> => ({ kind: 'meaning', group: 'meaning', hit })), o.expanded))

  // ---- 网页 ----
  if (o.url && !urlFirst) out.push({ kind: 'url', group: 'web', url: o.url, ...(o.looksUrl ? {} : { search: true }) })

  // ---- 最后一行：让 Claude 帮我找；找完换成它找到的 ----
  if (o.claude.phase === 'done' && o.claude.found.length) out.push(...o.claude.found.map((found): Row<C> => ({ kind: 'found', group: 'claude', found })))
  else out.push({ kind: 'claude', group: 'claude' })
  return out
}

/** 本地结果：网页那一行、「让 Claude 找」那一行以外的（笔记、PDF、意思相近、命令、Claude 找到的、「还有 N 条」） */
export const isLocal = (r: Row<Cmd>) => r.kind !== 'url' && r.kind !== 'claude'

/** 键盘（↓ ↑、默认）能选中的行：本地结果里有把握的。没把握的「意思相近」只能鼠标点 */
export const canKey = (r: Row<Cmd>) => isLocal(r) && !(r.kind === 'meaning' && !r.hit.sure)

/**
 * 选中的是哪一行，按身份记：第几个键盘能选的本地结果，或者网页那一行、让 Claude 找那一行。
 * 结果一批批晚到、行号一直在变，按身份记才不会因为晚到的结果把选中挤到网页那一行上
 */
export type Cursor = { local: number } | { web: true } | { claude: true }

/** 第 i 行是哪个 Cursor；没把握的「意思相近」是 null（键盘选不中它，鼠标悬停也不当选中） */
export function cursorAt(rows: Row<Cmd>[], i: number): Cursor | null {
  const r = rows[i]
  if (!r) return null
  if (r.kind === 'url') return { web: true }
  if (r.kind === 'claude') return { claude: true }
  if (!canKey(r)) return null
  return { local: rows.slice(0, i).filter(canKey).length }
}

const keyRows = (rows: Row<Cmd>[]) => rows.flatMap((r, i) => (canKey(r) ? [i] : []))

/** Cursor 现在在第几行；第 n 个还没那么多时落在最后一个上，一个都没有是 -1 */
export function rowOf(rows: Row<Cmd>[], c: Cursor): number {
  if ('web' in c) return rows.findIndex((r) => r.kind === 'url')
  if ('claude' in c) return rows.findIndex((r) => r.kind === 'claude')
  const keys = keyRows(rows)
  if (!keys.length) return -1
  return keys[Math.min(c.local, keys.length - 1)]!
}

/**
 * 没挪过选择时回车选哪一行：打的是明明白白的网址、库里没有名字对得上的，开这个网址；
 * 不然是第一条能当默认的本地结果（笔记名、PDF、命令、过了门槛的意思相近；打的像网址时只有名字对得上的）。
 * 一条都没有给 -1，回车不做事；去网上搜要用户自己选（⌘↵ 或鼠标），笔记名不会因为手快、像网址被发到网上
 */
export function defaultIndex(rows: Row<Cmd>[]): number {
  const typed = rows.findIndex((r) => r.kind === 'url' && r.typed)
  if (typed !== -1) return typed
  return rows.findIndex((r) => canKey(r) && r.kind !== 'more' && !('nodefault' in r && r.nodefault))
}

/** ↓ ↑ 挪一格：只在键盘能选的本地结果里挪，到头停住。没挪过时从默认那一行起（没有默认时 ↓ 落到第一个） */
export function step(rows: Row<Cmd>[], cur: Cursor | null, dir: 1 | -1): Cursor | null {
  const keys = keyRows(rows)
  if (!keys.length) return cur
  let pos: number
  if (!cur) pos = keys.indexOf(defaultIndex(rows))
  else if ('local' in cur) pos = Math.min(cur.local, keys.length - 1)
  else pos = dir === 1 ? -1 : keys.length
  return { local: Math.max(0, Math.min(keys.length - 1, pos + dir)) }
}

export type Key = 1 | -1 | 'enter'

/**
 * 文字结果回来以后，后到的（意思相近）插不到它前面的行：最合适、笔记、命令、笔记和PDF里的字，放最前的网址。
 * 「笔记和PDF里的字」那一组里正文和 PDF 页轮流排：PDF 里的字还没回来时这一组还会变，要等它（pdf 为 false）
 */
const fixedRow = (r: Row<Cmd> | undefined, pdf = true) =>
  !!r && (r.group === 'best' || r.group === 'notes' || r.group === 'cmd' || r.group === 'aside' || (r.group === 'text' && pdf) || (r.kind === 'url' && !!r.typed))

/**
 * 这个键现在按下去，和结果都出齐以后再按，落在同一行吗。不一样就先记着，等出齐了再按（Palette 里的 queue）。
 * text：文字结果（笔记、PDF 里的字）回来了；all：意思相近也回来了。
 * 文字回来以后，起点和落点都在文字那一组（或打全名字的命令、明明白白的网址）就不用等：意思相近只会排在它们后面
 */
export function keyIsFinal(rows: Row<Cmd>[], cur: Cursor | null, key: Key, ready: { text: boolean; pdf?: boolean; all: boolean }): boolean {
  if (ready.all) return true
  // 自己用鼠标挪到网页、Claude 那一行的：回车马上走
  if (cur && !('local' in cur)) return key === 'enter'
  if (!ready.text) return false
  const at = cur ? rowOf(rows, cur) : defaultIndex(rows)
  const pdf = ready.pdf !== false
  if (!fixedRow(rows[at], pdf)) return false
  if (key === 'enter') return true
  const next = step(rows, cur, key)
  const to = next ? rowOf(rows, next) : -1
  // 已经在最后一个上再按 ↓：后到的结果会排在下面，现在停住、出齐了却会往下挪，得等
  return fixedRow(rows[to], pdf) && !(key === 1 && to === at)
}

/** 组头：组名和后面淡一点的说明；why：最合适后面的「最近用过」；Claude 那一行没找完时没有组头（它跟在网页那一行下面） */
export function groupHead(g: Group, o: { q: string; claudeDone: boolean; why?: string }): { name: string; why?: string } | null {
  if (g === 'recent') return { name: t('最近打开') }
  if (g === 'best') return o.why ? { name: t('最合适'), why: `· ${o.why}` } : { name: t('最合适') }
  if (g === 'notes') return { name: t('笔记') }
  if (g === 'text') return { name: t('笔记和PDF里的字') }
  if (g === 'meaning') return { name: t('意思相近'), why: t('· 本机小模型，不联网') }
  if (g === 'cmd') return { name: t('命令') }
  if (g === 'web') return { name: t('网页和AI') }
  if (g === 'claude' && o.claudeDone) return { name: t('Claude找到的') }
  return null
}

/** 正文那一小段开头就是这篇的标题（摘要从「# 标题」那一行起）：行里已经写了名字，不再重复 */
export function withoutTitle(snippet: string, title: string): string {
  const head = title.trim()
  if (!head || !snippet.startsWith(head)) return snippet
  const rest = snippet.slice(head.length).trimStart()
  return rest || snippet
}
