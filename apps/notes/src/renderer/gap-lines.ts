/**
 * 块和块之间的空行怎么认（task-ys1rr）：block-flow.ts（光标不停、回车退格）、atomic-blocks.ts（删掉整块以后光标放哪）都用这一份。
 * 「块缝」：挨着有字的一行的空行，光标不停在这里；「空块」：两边都是空行的那一行，光标能停、打字就是新的一块。
 * 代码块里的空行是代码，不算空行。
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

/** 第 n 行是块缝：空着、挨着有字的一行（上面或下面） */
export function gapLine(state: EditorState, n: number): boolean {
  if (!blankLine(state, n)) return false
  return (n > 1 && !blankLine(state, n - 1)) || (n < state.doc.lines && !blankLine(state, n + 1))
}

/** pos 落在块缝上 */
export const onGap = (state: EditorState, pos: number) => gapLine(state, state.doc.lineAt(pos).number)

/** 第 n 行所在的那一串空行：头尾行号、几行、上面和下面有字的那一行（没有是 0） */
export function blankRun(state: EditorState, n: number): { first: number; last: number; k: number; prev: number; next: number } {
  let first = n
  let last = n
  while (first > 1 && blankLine(state, first - 1)) first--
  while (last < state.doc.lines && blankLine(state, last + 1)) last++
  return { first, last, k: last - first + 1, prev: first - 1, next: last < state.doc.lines ? last + 1 : 0 }
}

/** pos 在块缝上：挪到上一块末尾（to: 'up'）或下一块开头（'down'），那一边没有块就去另一边；不在块缝上原样返回 */
export function offGap(state: EditorState, pos: number, to: 'up' | 'down'): number {
  const line = state.doc.lineAt(pos)
  if (line.number === state.doc.lines || !gapLine(state, line.number)) return pos
  const run = blankRun(state, line.number)
  const up = run.prev ? state.doc.line(run.prev).to : null
  const down = run.next ? state.doc.line(run.next).from : null
  return (to === 'up' ? (up ?? down) : (down ?? up)) ?? pos
}
