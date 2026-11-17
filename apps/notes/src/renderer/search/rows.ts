/**
 * ⌘F / ⌘K 一个框里的行：按组排好、每组最多几条（别把上万条全铺开），界面只管画和点。
 * 组从上到下：文字（笔记和 PDF 里的字）→ 意思相近（本机小模型）→ 命令 → 网页 → 最后一行「让 Claude 帮我找」。
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

export interface Cmd {
  name: string
  hint?: string
  keys?: string
}

export type Group = 'recent' | 'text' | 'meaning' | 'cmd' | 'web' | 'claude'

export type Row<C extends Cmd = Cmd> =
  /** nodefault：键盘能挪到，但不当默认（打的像网址时正文里有这个词的笔记） */
  | { kind: 'note'; group: Group; path: string; snippet?: string; nodefault?: true }
  | { kind: 'pdfName'; group: Group; path: string }
  | { kind: 'pdfPage'; group: Group; hit: PdfTextHit; nodefault?: true }
  | { kind: 'meaning'; group: Group; hit: MeaningHit }
  /** exact：打全了名字、排在最前的那条命令（后到的结果挤不动它） */
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
  /** 空着时的「最近打开」 */
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

const titleHasAll = (path: string, words: string[]) => {
  const t = (path.split('/').pop() ?? path).toLowerCase()
  return words.every((w) => t.includes(w))
}

/** 先放这么多，多的写「还有 N 条」 */
function capped<C extends Cmd>(group: Group, rows: Row<C>[], expanded: Set<Group>): Row<C>[] {
  const max = expanded.has(group) ? GROUP_MORE : GROUP_SHOW
  if (rows.length <= max) return rows
  return [...rows.slice(0, max), { kind: 'more', group, n: rows.length - max }]
}

export function buildRows<C extends Cmd>(o: RowsInput<C>): Row<C>[] {
  const q = o.q.trim()
  if (!q) return [...o.recent.slice(0, 5).map((path): Row<C> => ({ kind: 'note', group: 'recent', path })), ...o.commands.map((cmd): Row<C> => ({ kind: 'cmd', group: 'cmd', cmd }))]
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const out: Row<C>[] = []
  // 打全了某条命令的名字：这条命令排第一。不然搜索结果晚一步回来会挤到它上面，回车跑命令还是开笔记全看手快手慢
  const exact = o.commands.filter((c) => c.name.toLowerCase() === q.toLowerCase())
  out.push(...exact.map((cmd): Row<C> => ({ kind: 'cmd', group: 'cmd', cmd, exact: true })))
  // 打的像网址 / 域名：只有名字对得上的才能当默认（正文里有、意思相近的都不行）
  const nd = o.looksUrl ? ({ nodefault: true } as const) : {}

  // ---- 文字：名字里有的 PDF、标题命中的笔记在前，再笔记正文和 PDF 页轮流排 ----
  const names: Row<C>[] = o.pdfNames.filter((p) => titleHasAll(p, words)).map((path) => ({ kind: 'pdfName', group: 'text', path }))
  const titled = o.hits.filter((h) => titleHasAll(h.path, words))
  const body = o.hits.filter((h) => !titleHasAll(h.path, words))
  const note = (h: SearchHit, x: { nodefault?: true } = {}): Row<C> => ({ kind: 'note', group: 'text', path: h.path, snippet: h.snippet, ...x })
  const mixed: Row<C>[] = []
  for (let i = 0; i < Math.max(body.length, o.pdfHits.length); i++) {
    if (body[i]) mixed.push(note(body[i]!, nd))
    if (o.pdfHits[i]) mixed.push({ kind: 'pdfPage', group: 'text', hit: o.pdfHits[i]!, ...nd })
  }
  out.push(...capped('text', [...names, ...titled.map((h) => note(h)), ...mixed], o.expanded))
  // 明明白白的网址、库里没有名字对得上的：网址那一行放最前（它就是默认）；名字对得上的，笔记在前，网址放到网页那一组
  const urlFirst = !!(o.explicitUrl && o.url && !names.length && !titled.length)
  if (urlFirst) out.unshift({ kind: 'url', group: 'web', url: o.url!, typed: true })

  // ---- 意思相近：文字那一层已经有的（同一篇、同一页）不再列 ----
  const seen = new Set([...o.hits.map((h) => h.path), ...o.pdfHits.map((h) => `${h.path}#${h.page}`), ...names.map((r) => (r as { path: string }).path)])
  // 打的像网址：意思相近的一律算没把握（不默认、键盘选不到，只能鼠标点）
  const meaning = o.meaning.filter((h) => !seen.has(h.page ? `${h.path}#${h.page}` : h.path)).map((h) => (o.looksUrl && h.sure ? { ...h, sure: false } : h))
  out.push(...capped('meaning', meaning.map((hit): Row<C> => ({ kind: 'meaning', group: 'meaning', hit })), o.expanded))

  // ---- 命令、网页 ----
  out.push(...capped('cmd', o.commands.filter((c) => !exact.includes(c) && c.name.toLowerCase().includes(q.toLowerCase())).map((cmd): Row<C> => ({ kind: 'cmd', group: 'cmd', cmd, ...nd })), o.expanded))
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

/** 后到的结果（意思相近、只是名字里有的命令）插不到它前面的行：最前那条打全了名字的命令、放最前的网址、文字那一组 */
const fixedRow = (r: Row<Cmd> | undefined) => !!r && (r.group === 'text' || (r.kind === 'url' && !!r.typed) || (r.kind === 'cmd' && !!r.exact))

/**
 * 这个键现在按下去，和结果都出齐以后再按，落在同一行吗。不一样就先记着，等出齐了再按（Palette 里的 queue）。
 * text：文字结果（笔记、PDF 里的字）回来了；all：意思相近也回来了。
 * 文字回来以后，起点和落点都在文字那一组（或打全名字的命令、明明白白的网址）就不用等：意思相近只会排在它们后面
 */
export function keyIsFinal(rows: Row<Cmd>[], cur: Cursor | null, key: Key, ready: { text: boolean; all: boolean }): boolean {
  if (ready.all) return true
  // 自己用鼠标挪到网页、Claude 那一行的：回车马上走
  if (cur && !('local' in cur)) return key === 'enter'
  if (!ready.text) return false
  const at = cur ? rowOf(rows, cur) : defaultIndex(rows)
  if (!fixedRow(rows[at])) return false
  if (key === 'enter') return true
  const next = step(rows, cur, key)
  const to = next ? rowOf(rows, next) : -1
  // 已经在最后一个上再按 ↓：后到的结果会排在下面，现在停住、出齐了却会往下挪，得等
  return fixedRow(rows[to]) && !(key === 1 && to === at)
}

/** 组头：组名和后面淡一点的说明；Claude 那一行没找完时没有组头 */
export function groupHead(g: Group, o: { q: string; claudeDone: boolean }): { name: string; why?: string } | null {
  if (g === 'recent') return { name: '最近打开' }
  if (g === 'text') return { name: '文字', why: '· 笔记和PDF里的字' }
  if (g === 'meaning') return { name: '意思相近', why: '· 本机小模型，不联网' }
  if (g === 'cmd') return { name: '命令' }
  if (g === 'web') return { name: '网页' }
  if (g === 'claude' && o.claudeDone) return { name: 'Claude找到的' }
  return null
}
