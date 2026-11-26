/**
 * 块和块之间的空行怎么数（task-ys1rr 起；2026-11-23 task-axoxy 改成 Tolaria 的数法，用户定的方案 B）：
 * block-flow.ts（光标不停、回车退格）、block-gaps.ts（画多高）、atomic-blocks.ts（删掉整块以后光标放哪）、tidy-blocks.ts（改完规整）都用这一份。
 *
 * 两块之间 N 个空行 = 1 道缝 + (N − 1) 个空块：一串空行里第一行是「缝」（压矮、光标不停），后面每一行是一个「空块」
 * （一整行高，光标能停、打字就是新的一块）。没有奇偶，回车正好加一个换行，退格正好删一个。
 * - 紧挨在标题前面的那个空行（这一串有两行以上时）算标题上方的留白，不算空块（别处来的 md 习惯在标题前空两行，照旧画成一道缝）。
 * - 文件末尾的空行不算块（压成 0）；文末那一行（tail-line.ts 暂时加的、只在屏上、不写文件）里的空行是空块；
 *   文件本来以空行结尾时最后那一行是灰字画的地方，光标能停。
 * - 文件开头的空行：最后一行是缝，前面的是空块。
 * 代码块里的空行是代码，不算空行。文件就是 md，没有别的记号，同一份文件打开再保存一个字节不变；变的只是画法。
 */
import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'

type Node = ReturnType<ReturnType<typeof syntaxTree>['resolveInner']>

/** 第 n 行空着（代码块里的空行是代码，不算） */
export function blankLine(state: EditorState, n: number): boolean {
  if (n < 1 || n > state.doc.lines) return false
  const line = state.doc.line(n)
  if (line.text.trim() !== '') return false
  for (let x: Node | null = syntaxTree(state).resolveInner(line.from, 1); x; x = x.parent) if (x.name === 'FencedCode' || x.name === 'CodeBlock') return false
  return true
}

/** 第 n 行所在的那一串空行：头尾行号、几行、上面和下面有字的那一行（没有是 0） */
export function blankRun(state: EditorState, n: number): { first: number; last: number; k: number; prev: number; next: number } {
  let first = n
  let last = n
  while (first > 1 && blankLine(state, first - 1)) first--
  while (last < state.doc.lines && blankLine(state, last + 1)) last++
  return { first, last, k: last - first + 1, prev: first - 1, next: last < state.doc.lines ? last + 1 : 0 }
}

/**
 * 标题行：「#」到「######」后面跟着空格（ui-b A3，偏好「井号加空格才变标题」）。只有「#」的一行 lezer 照 CommonMark 认成空标题，
 * 编辑器不当标题画（打「#」还没按空格就变成大标题、「#」藏起来）；live-preview、wysiwyg、block-gaps 都看这一条
 */
export const HEADING = /^ {0,3}(#{1,6})[ \t]/

/** 只有「#」的一行（没跟空格）：语法树里是空标题，编辑器当普通的字 */
export const bareHashes = (text: string) => /^ {0,3}#{1,6}$/.test(text)

/** 第 n 行是标题（标题前那个空行算它上方的留白） */
export const headingLine = (state: EditorState, n: number) => n >= 1 && n <= state.doc.lines && HEADING.test(state.doc.line(n).text)

/**
 * 文末那一行暂时加的空行从第几行起（tail-line.ts 交上来；那几行是只在屏上的空块）；没有是 0。
 * gap-lines 不直接引 tail-line（它引了这里），由 tail-line 在加载时登记
 */
let screenTail: (state: EditorState) => number = () => 0
export function setScreenTail(f: (state: EditorState) => number) {
  screenTail = f
}

/** 空行在这一串里的身份：sep 缝、empty 空块、margin 标题上方的留白、pad 文件末尾不算块的空行 */
export type BlankRole = 'sep' | 'empty' | 'margin' | 'pad'

/** 第 n 行（空行）是什么；不是空行给 null */
export function blankRole(state: EditorState, n: number): BlankRole | null {
  if (!blankLine(state, n)) return null
  const run = blankRun(state, n)
  if (!run.next) {
    const t = screenTail(state)
    if (t && n >= t && n < state.doc.lines) return 'empty'
    if (n === run.first && run.prev) return 'sep'
    // 文件本来以空行结尾（文末那一行没开着）：最后那一行是灰字画的地方（tail-line.ts 的 lineSlot），光标能停
    return n === state.doc.lines && !t ? 'empty' : 'pad'
  }
  if (!run.prev) return n === run.last ? 'sep' : 'empty'
  if (n === run.first) return 'sep'
  if (n === run.last && headingLine(state, run.next)) return 'margin'
  return 'empty'
}

/** 第 n 行是空块（光标能停、打字就是新的一块） */
export const emptyBlock = (state: EditorState, n: number) => blankRole(state, n) === 'empty'

/** 第 n 行是光标不停的空行：缝、标题上方的留白、文件末尾不算块的空行 */
export function gapLine(state: EditorState, n: number): boolean {
  const r = blankRole(state, n)
  return r !== null && r !== 'empty'
}

/** pos 落在块缝上 */
export const onGap = (state: EditorState, pos: number) => gapLine(state, state.doc.lineAt(pos).number)

/** n 个空行（下面一块是不是标题）里有几个空块 */
export const emptiesIn = (k: number, beforeHeading: boolean) => (k <= 0 ? 0 : beforeHeading && k >= 2 ? k - 2 : k - 1)

/** 现在 k 个空行，要再多一个空块得加几个换行（标题前头一回要两个：缝、留白之外才是空块） */
export const oneMore = (k: number, beforeHeading: boolean) => (beforeHeading && k < 2 ? 3 - k : k === 0 ? 2 : 1)

/** pos 在块缝上：挪到上一块末尾（to: 'up'）或下一块开头（'down'），那一边没有块就去另一边；不在块缝上原样返回 */
export function offGap(state: EditorState, pos: number, to: 'up' | 'down'): number {
  const line = state.doc.lineAt(pos)
  if (line.number === state.doc.lines || !gapLine(state, line.number)) return pos
  const run = blankRun(state, line.number)
  const up = run.prev ? state.doc.line(run.prev).to : null
  const down = run.next ? state.doc.line(run.next).from : null
  return (to === 'up' ? (up ?? down) : (down ?? up)) ?? pos
}
