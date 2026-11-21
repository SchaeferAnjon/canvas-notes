import { addCard, addColumn, CARD_W } from '../board-drop'
import { appendBlock, attr, type BoardDoc, content, newBlock, newId, num, parseBoard, serializeBoard, splitDoc, withAttrs } from '@cn/format'
import { parseMoment, parseVideoCard } from '../../shared/video'

/** 时刻卡的宽：比普通卡片窄一点，和原型一样 */
export const VIDEO_CARD_W = 262

/**
 * 白板开着时按 ⌥S：时刻进这个视频的「时刻」列（列的注释里记着 moments=<视频>），最新的在最上面；
 * 没有这一列就在视频卡右边新建一列；白板上还没有这个视频的卡就先放一张。不碰 React，能单独测。
 */
export function addMomentToBoard(text: string, key: string, momentBody: string, videoCardBody: string): { text: string; cardId: string } {
  let doc: BoardDoc = parseBoard(text)
  let col = doc.blocks.find((b) => b.kind === 'column' && attr(b, 'moments') === key)
  if (!col) {
    let card = doc.blocks.find((b) => b.kind === 'card' && parseVideoCard(content(b))?.ref.key === key)
    if (!card) {
      // 放在现有东西的右边（没有东西就左上角）
      const free = doc.blocks.filter((b) => !attr(b, 'in') && attr(b, 'id'))
      const x = free.length ? Math.max(...free.map((b) => num(b, 'x', 0) + num(b, 'w', CARD_W))) + 40 : 60
      const id = newId(doc)
      doc = addCard(doc, id, videoCardBody, { at: { x, y: 60 } })
      doc = { ...doc, blocks: doc.blocks.map((b) => (attr(b, 'id') === id ? withAttrs(b, { w: VIDEO_CARD_W }) : b)) }
      card = doc.blocks.find((b) => attr(b, 'id') === id)!
    }
    const colId = newId(doc)
    doc = addColumn(doc, colId, { x: num(card, 'x', 60) + num(card, 'w', CARD_W) + 24, y: num(card, 'y', 60) }, '时刻')
    doc = { ...doc, blocks: doc.blocks.map((b) => (attr(b, 'id') === colId ? withAttrs(b, { moments: key }) : b)) }
    col = doc.blocks.find((b) => attr(b, 'id') === colId)!
  }
  const colId = attr(col, 'id')!
  const cardId = newId(doc)
  // 新的放在列的最上面：文件里紧跟在列的注释后面
  const added = appendBlock(doc, newBlock('card', { id: cardId, in: colId }, momentBody))
  const blocks = [...added.blocks]
  const fresh = blocks.pop()!
  const at = blocks.findIndex((b) => attr(b, 'id') === colId) + 1
  blocks.splice(at, 0, fresh)
  // 挪到中间以后，它前面那块要以空行结尾、它自己也以空行结尾
  const prev = blocks[at - 1]!
  if (!prev.body.endsWith('\n\n') && prev.body !== '') blocks[at - 1] = { ...prev, body: prev.body.replace(/\n*$/, '\n\n') }
  if (prev.body === '' && !prev.comment.endsWith('\n')) blocks[at - 1] = { ...prev, comment: prev.comment + '\n' }
  const last = blocks[blocks.length - 1]!
  if (last !== fresh && !last.body.endsWith('\n')) blocks[blocks.length - 1] = { ...last, body: last.body + '\n' }
  return { text: serializeBoard({ ...added, blocks }), cardId }
}

/**
 * 白板就是这篇文档（2026-11-21 起）时按 ⌥S：时刻紧跟在这个视频的视频卡后面（白板上挂在视频卡下面，doc-board 的规矩），
 * 已经有时刻就排在最后一个时刻后面；白板上还没有这个视频的卡就在文末先放一张视频卡、再放这个时刻
 */
export function addMomentToDocBoard(text: string, key: string, momentBody: string, videoCardBody: string): string {
  const b = splitDoc(text)
  const all = [...b.columns.flatMap((c) => c.cards), ...b.placed]
  const v = all.find((u) => u.kind === 'video' && parseVideoCard(u.moments?.length ? text.slice(u.from, u.moments[0]!.from) : u.text)?.ref.key === key)
  const piece = momentBody.trim()
  // 视频卡前面那行 <!-- video … --> 是认出视频卡、时刻挂在它下面的记号（主进程给白板的视频卡不带它：以前写法的白板卡片有自己的注释）
  const vcard = videoCardBody.trim().startsWith('<!-- video') ? videoCardBody.trim() : `<!-- video video=${key} -->\n${videoCardBody.trim()}`
  if (!v) return text.replace(/\n*$/, '\n\n') + vcard + '\n\n' + piece + '\n'
  const at = v.to
  // 后面还有字：空一行接上；这是文末：只留一个换行
  const rest = text.slice(at).replace(/^\n*/, '')
  return text.slice(0, at) + '\n\n' + piece + (rest ? '\n\n' + rest : '\n')
}

/** 白板上这个视频有几个时刻、问过几次（视频卡底下那行） */
export function boardMomentStats(text: string, key: string): { moments: number; asked: number } {
  const doc = parseBoard(text)
  let moments = 0
  let asked = 0
  for (const b of doc.blocks) {
    if (b.kind !== 'card') continue
    const m = parseMoment(content(b))
    if (m?.key !== key) continue
    moments++
    if (m.asked) asked++
  }
  return { moments, asked }
}
