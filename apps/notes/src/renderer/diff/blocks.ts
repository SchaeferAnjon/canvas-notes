/**
 * 对比标签（历史、梦游报告、先给你看、存成命令那张表）里，图、表格这种整块（编辑器画成一整块，不是 .cm-line）
 * 碰到改动时，和改的行一样整块铺 10% 红绿、左边 3px 竖条（DESIGN.v3 2.7「改的行整行 10%」）。
 * 改的行由 @codemirror/merge 自己上色，整块它不管，这里打上 dv-blk-del / dv-blk-add（样子在 diff.css）。
 */
import { getChunks } from '@codemirror/merge'
import { type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'

const NOT_BLOCK = ['cm-line', 'cm-mergeSpacer', 'cm-collapsedLines', 'cm-deletedChunk']

function mark(view: EditorView) {
  const c = getChunks(view.state)
  if (!c) return
  // 并排的左边（改前）是删掉的；右边和合一里是加上的
  const del = c.side === 'a'
  for (const el of view.contentDOM.children) {
    if (!(el instanceof HTMLElement) || NOT_BLOCK.some((k) => el.classList.contains(k))) continue
    const b = view.lineBlockAt(view.posAtDOM(el))
    // 改动和这一块有重叠就算（表格里只改了一格也算这一块改了）
    const hit = c.chunks.some((ch) => (del ? ch.fromA < b.to && ch.toA > b.from : ch.fromB < b.to && ch.toB > b.from))
    el.classList.toggle('dv-blk-del', hit && del)
    el.classList.toggle('dv-blk-add', hit && !del)
  }
}

export const blockChanges = ViewPlugin.fromClass(
  class {
    constructor(view: EditorView) {
      this.mark(view)
    }
    update(u: ViewUpdate) {
      this.mark(u.view)
    }
    mark(view: EditorView) {
      view.requestMeasure({ key: this, read: () => null, write: () => mark(view) })
    }
  },
)
