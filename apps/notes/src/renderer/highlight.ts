/**
 * 高亮（CN-67 A）：选中的字在 md 里写成 `==文字==`（Obsidian 同一个写法），文档里画成主题强调色的荧光底；
 * 再按一次取消。快捷键 ⇧⌘M（⇧⌘H 已经给了「回到首页」，⌘M 是系统的最小化；⇧⌘M 是 Bear 的高亮键），右键菜单里也有。
 * 选中文字时什么都不弹（选中只有高亮），要 AI 用右键或 ⌘J。
 */
import { Prec } from '@codemirror/state'
import { type EditorView, keymap } from '@codemirror/view'

export const HIGHLIGHT_KEY = 'Shift+CommandOrControl+M'

const HL = /==(?=\S)([^=\n]|=(?!=))+?==/g

/** 一行里的高亮：[开头, 结尾)（含两边的 ==） */
export function highlightsIn(text: string): [number, number][] {
  const out: [number, number][] = []
  HL.lastIndex = 0
  for (let m = HL.exec(text); m; m = HL.exec(text)) out.push([m.index, m.index + m[0].length])
  return out
}

/** 改动：选中的字加上 / 去掉 ==；光标在一处高亮里（没选字）时去掉那一处。纯函数，单元测试在 test/highlight.test.ts */
export function toggleHighlightIn(
  doc: string,
  from: number,
  to: number,
): { changes: { from: number; to: number; insert: string }[]; anchor: number; head: number } | null {
  if (from === to) {
    const ls = doc.lastIndexOf('\n', from - 1) + 1
    const le = doc.indexOf('\n', from) === -1 ? doc.length : doc.indexOf('\n', from)
    const hit = highlightsIn(doc.slice(ls, le)).find(([a, b]) => ls + a <= from && from <= ls + b)
    if (!hit) return null
    const a = ls + hit[0]
    const b = ls + hit[1]
    return { changes: [{ from: a, to: a + 2, insert: '' }, { from: b - 2, to: b, insert: '' }], anchor: Math.max(a, from - 2), head: Math.max(a, from - 2) }
  }
  if (doc.slice(from - 2, from) === '==' && doc.slice(to, to + 2) === '==') {
    return { changes: [{ from: from - 2, to: from, insert: '' }, { from: to, to: to + 2, insert: '' }], anchor: from - 2, head: to - 2 }
  }
  const sel = doc.slice(from, to)
  if (sel.length >= 4 && sel.startsWith('==') && sel.endsWith('==')) {
    return { changes: [{ from, to: from + 2, insert: '' }, { from: to - 2, to, insert: '' }], anchor: from, head: to - 4 }
  }
  // 两头的空白不包进去（== 后面紧跟空格就不算高亮了）
  const lead = sel.length - sel.trimStart().length
  const trail = sel.length - sel.trimEnd().length
  if (lead + trail >= sel.length) return null
  const a = from + lead
  const b = to - trail
  return { changes: [{ from: a, to: a, insert: '==' }, { from: b, to: b, insert: '==' }], anchor: a + 2, head: b + 2 }
}

/** 光标或选区是不是在一处高亮里（右键菜单写「取消高亮」） */
export function inHighlight(doc: string, from: number, to: number): boolean {
  if (doc.slice(from - 2, from) === '==' && doc.slice(to, to + 2) === '==') return true
  return from === to && toggleHighlightIn(doc, from, to) !== null
}

export function toggleHighlight(view: EditorView): boolean {
  if (view.state.readOnly) return false
  const { from, to } = view.state.selection.main
  const r = toggleHighlightIn(view.state.doc.toString(), from, to)
  if (!r) return true
  view.dispatch({ changes: r.changes, selection: { anchor: r.anchor, head: r.head }, userEvent: 'input.format' })
  view.focus()
  return true
}

export const highlightKeys = Prec.high(keymap.of([{ key: 'Mod-Shift-m', run: toggleHighlight, preventDefault: true }]))
