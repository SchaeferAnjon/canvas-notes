/**
 * 白板上的卡拖进另一个标签里的文档（DESIGN.v3 6.6）：拖着卡停在标签条上另一篇文档的标签上半秒就切过去，
 * 松手的那两块之间插进去（落点一条 2px --acc 横线，同文档里拖块），白板那篇少了这一段；两篇一次提交，提示能撤回。
 * 这里只管认「鼠标下面是哪颗标签、哪篇文档的哪两块之间」和在那篇里插字，挪、提交由白板做。
 */
import { findBlocks } from '@cn/format'
import { hiddenOk } from '../hidden-syntax'
import { NoteDoc } from '../note-doc'

/** 鼠标下面另一篇 md 的标签 */
export function tabAt(x: number, y: number, self: string): { path: string; el: HTMLElement } | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('.tab[data-path]')
  const path = el?.dataset.path
  if (!el || !path || path === self || !/\.md$/i.test(path)) return null
  return { path, el }
}

/** 落在哪：那篇文档、插入的位置、横线画在哪（屏幕坐标） */
export interface DocSpot {
  doc: NoteDoc
  at: number
  line: { left: number; top: number; width: number }
}

/** 鼠标下面开着的文档（文档看法里看得见的那一篇）：落在哪两块之间 */
export function docSpotAt(x: number, y: number): DocSpot | null {
  const content = document.elementFromPoint(x, y)?.closest<HTMLElement>('.cm-editor')
  if (!content || !content.checkVisibility()) return null
  const doc = [...NoteDoc.open].find((d) => d.view.dom === content || d.view.dom.contains(content))
  if (!doc || doc.readOnly) return null
  const view = doc.view
  const text = view.state.doc.toString()
  const blocks = findBlocks(text).filter((b) => b.kind !== 'frontmatter')
  const box = view.contentDOM.getBoundingClientRect()
  if (!blocks.length) return { doc, at: text.length, line: { left: box.left, top: box.top + 4, width: box.width } }
  // 鼠标在一块的上半截：插在它前面；下半截：插在它后面
  for (const b of blocks) {
    const top = view.coordsAtPos(b.from)
    const bottom = view.coordsAtPos(b.to)
    if (!top || !bottom) continue
    if (y < (top.top + bottom.bottom) / 2) return { doc, at: b.from, line: { left: box.left, top: top.top - 4, width: box.width } }
  }
  const last = blocks[blocks.length - 1]!
  const end = view.coordsAtPos(last.to)
  return { doc, at: last.to, line: { left: box.left, top: (end?.bottom ?? box.bottom) + 4, width: box.width } }
}

/** 在那一篇的 at 插一整段：前后各隔一个空行 */
export function insertInto(spot: DocSpot, body: string) {
  const view = spot.doc.view
  const text = view.state.doc.toString()
  const at = Math.max(0, Math.min(text.length, spot.at))
  const before = text.slice(0, at)
  const after = text.slice(at)
  const lead = before === '' ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
  const trail = after === '' ? '\n' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n'
  const insert = lead + body.trim() + trail
  // 插在标题、图这些藏着写法的块前面：不让「光标不进藏着的写法」把插入点挪进标题里（hiddenOk）
  view.dispatch({ changes: { from: at, insert }, selection: { anchor: at + lead.length + body.trim().length }, userEvent: 'input.drop', annotations: hiddenOk.of(true), scrollIntoView: true })
}
