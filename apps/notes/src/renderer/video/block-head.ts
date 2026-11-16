import type { EditorState } from '@codemirror/state'

/** 视频块的第一行：<!-- moment … --> / <!-- moment-ask … --> / <!-- video … --> */
export const HEAD = /^<!--\s*(moment|moment-ask|video)\s+video=(\S+)/

/** 这一行图片是不是视频块里的（md-widgets 不再把它画成大图，由 video/doc-widgets 画） */
export function inVideoBlock(state: EditorState, pos: number): boolean {
  const n = state.doc.lineAt(pos).number
  for (let k = n - 1; k >= Math.max(1, n - 2); k--) {
    const t = state.doc.line(k).text
    if (HEAD.test(t)) return true
    if (!t.trim()) return false
  }
  return false
}
