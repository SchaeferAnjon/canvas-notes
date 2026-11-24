/**
 * 梦游对照里用到的两样（对比本身是历史那一套 diff/DiffTab.tsx 的 TextDiff）：
 * - chunksOf：两版按行比出来的改动（文件条「打开「x」」滚到第一处改动那一行）；
 * - markExt：可能重复那两篇里说同一件事的段，左边一道强调色竖线、淡底。
 */
import { Chunk } from '@codemirror/merge'
import { type Extension, type Range, Text } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { LINE_DIFF } from '../diff/line-diff'

/** 两版按行比出来的改动（和对照里的 MergeView 用同一个比法） */
export function chunksOf(before: string, after: string): readonly Chunk[] {
  return Chunk.build(Text.of(before.split('\n')), Text.of(after.split('\n')), LINE_DIFF)
}

/** 这几段左边一道强调色竖线、淡底；整块画成部件的（图、表格、嵌着的可视化）也一样 */
export function markExt(ranges: { from: number; to: number }[]): Extension {
  const lines = (doc: Text): Range<Decoration>[] => {
    const out: Range<Decoration>[] = []
    for (const r of ranges) {
      const last = doc.lineAt(Math.max(r.from, Math.min(r.to, doc.length))).number
      for (let n = doc.lineAt(r.from).number; n <= last; n++) out.push(Decoration.line({ class: 'dv-mark' }).range(doc.line(n).from))
    }
    return out
  }
  const blocks = ViewPlugin.fromClass(
    class {
      constructor(view: EditorView) {
        this.mark(view)
      }
      update(u: ViewUpdate) {
        this.mark(u.view)
      }
      mark(view: EditorView) {
        view.requestMeasure({
          key: this,
          read: () => null,
          write: () => {
            for (const el of view.contentDOM.children) {
              if (!(el instanceof HTMLElement) || el.classList.contains('cm-line')) continue
              const b = view.lineBlockAt(view.posAtDOM(el))
              el.classList.toggle('dv-mark', ranges.some((r) => r.from < b.to + 1 && r.to > b.from))
            }
          },
        })
      }
    },
  )
  return [EditorView.decorations.of((v) => Decoration.set(lines(v.state.doc), true)), blocks]
}
