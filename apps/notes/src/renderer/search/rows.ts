/**
 * ⌘F / ⌘K 一个框里的行：按组排好、每组最多几条（别把上万条全铺开），界面只管画和点。
 * 组从上到下：文字（笔记和 PDF 里的字）→ 意思相近（本机小模型）→ 命令 → 网页 → 最后一行「让 Claude 帮我找」。
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
  | { kind: 'note'; group: Group; path: string; snippet?: string }
  | { kind: 'pdfName'; group: Group; path: string }
  | { kind: 'pdfPage'; group: Group; hit: PdfTextHit }
  | { kind: 'meaning'; group: Group; hit: MeaningHit }
  | { kind: 'cmd'; group: Group; cmd: C }
  | { kind: 'url'; group: Group; url: string }
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
  looksUrl: boolean
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
  if (o.looksUrl && o.url) out.push({ kind: 'url', group: 'web', url: o.url })
  // 打全了某条命令的名字：这条命令排第一。不然搜索结果晚一步回来会挤到它上面，回车跑命令还是开笔记全看手快手慢
  const exact = o.commands.filter((c) => c.name.toLowerCase() === q.toLowerCase())
  out.push(...exact.map((cmd): Row<C> => ({ kind: 'cmd', group: 'cmd', cmd })))

  // ---- 文字：名字里有的 PDF、标题命中的笔记在前，再笔记正文和 PDF 页轮流排 ----
  const names: Row<C>[] = o.pdfNames.filter((p) => titleHasAll(p, words)).map((path) => ({ kind: 'pdfName', group: 'text', path }))
  const titled = o.hits.filter((h) => titleHasAll(h.path, words))
  const body = o.hits.filter((h) => !titleHasAll(h.path, words))
  const note = (h: SearchHit): Row<C> => ({ kind: 'note', group: 'text', path: h.path, snippet: h.snippet })
  const mixed: Row<C>[] = []
  for (let i = 0; i < Math.max(body.length, o.pdfHits.length); i++) {
    if (body[i]) mixed.push(note(body[i]!))
    if (o.pdfHits[i]) mixed.push({ kind: 'pdfPage', group: 'text', hit: o.pdfHits[i]! })
  }
  out.push(...capped('text', [...names, ...titled.map(note), ...mixed], o.expanded))

  // ---- 意思相近：文字那一层已经有的（同一篇、同一页）不再列 ----
  const seen = new Set([...o.hits.map((h) => h.path), ...o.pdfHits.map((h) => `${h.path}#${h.page}`), ...names.map((r) => (r as { path: string }).path)])
  const meaning = o.meaning.filter((h) => !seen.has(h.page ? `${h.path}#${h.page}` : h.path))
  out.push(...capped('meaning', meaning.map((hit): Row<C> => ({ kind: 'meaning', group: 'meaning', hit })), o.expanded))

  // ---- 命令、网页 ----
  out.push(...capped('cmd', o.commands.filter((c) => !exact.includes(c) && c.name.toLowerCase().includes(q.toLowerCase())).map((cmd): Row<C> => ({ kind: 'cmd', group: 'cmd', cmd })), o.expanded))
  if (!o.looksUrl && o.url) out.push({ kind: 'url', group: 'web', url: o.url })

  // ---- 最后一行：让 Claude 帮我找；找完换成它找到的 ----
  if (o.claude.phase === 'done' && o.claude.found.length) out.push(...o.claude.found.map((found): Row<C> => ({ kind: 'found', group: 'claude', found })))
  else out.push({ kind: 'claude', group: 'claude' })
  return out
}

/** 组头：组名和后面淡一点的说明；Claude 那一行没找完时没有组头 */
export function groupHead(g: Group, o: { q: string; claudeDone: boolean }): { name: string; why?: string } | null {
  if (g === 'recent') return { name: '最近打开' }
  if (g === 'text') return { name: '文字', why: '· 笔记和 PDF 里的字' }
  if (g === 'meaning') return { name: '意思相近', why: '· 本机小模型，不联网' }
  if (g === 'cmd') return { name: '命令' }
  if (g === 'web') return { name: '网页' }
  if (g === 'claude' && o.claudeDone) return { name: 'Claude 找到的' }
  return null
}
