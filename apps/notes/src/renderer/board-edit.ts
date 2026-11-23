/**
 * 真白板上改卡的框开着时，外面（同步盘、另一台机器、AI）改了这块白板（BoardView）。
 * - 存下时怎么合（cardSave）：外面那张卡的字没动（只挪了位置、改了颜色，或者改的是别的卡）：就在外面那版上换这张卡的字，
 *   位置跟外面走，不算冲突（第 6 轮：外面只挪了位置也存一份冲突副本，卡跳回原处）；
 *   外面也改了这张卡的字、或者把卡删了：三方合并，同一处留我的，外面那版存成冲突副本。
 * - 开着框时卡被外面删了（keepEditing）：框和卡照样画着、打的字照样留着，存下时按上面放回去（第 6 轮：框当场消失，字哪儿都没有）。
 * 纯函数，单元测试在 test/board-edit.test.ts。
 */
import { attr, type BoardDoc, content, parseBoard, reconcile, serializeBoard, withContent } from '@cn/format'

export type CardSave =
  | { kind: 'none' }
  | { kind: 'update'; text: string; merged: boolean }
  /** 合不了：text 是留了我的那版，theirs 存成冲突副本；deleted：外面把这张卡删了 */
  | { kind: 'conflict'; text: string; theirs: string; others: boolean; deleted: boolean }

const indexOf = (doc: BoardDoc, id: string) => doc.blocks.findIndex((b) => attr(b, 'id') === id)

/** 在 doc 里把卡 i 的字换成 body（空的卡删掉，和 setContent 一样） */
function put(doc: BoardDoc, i: number, body: string): BoardDoc {
  if (body.trim() === '' && doc.blocks[i]!.kind === 'card') return { ...doc, blocks: doc.blocks.filter((_, j) => j !== i) }
  return { ...doc, blocks: doc.blocks.map((b, j) => (j === i ? withContent(b, body) : b)) }
}

/**
 * base：开框时的全文；theirs：现在的全文（外面改过）；body：框里的字。
 * base 里没有这张卡（新建的卡还没进文件）由调的人直接写
 */
export function cardSave(base: string, theirs: string, id: string, body: string): CardSave {
  const baseDoc = parseBoard(base)
  const i = indexOf(baseDoc, id)
  if (i === -1) throw new Error(`开框时的白板里没有卡 ${id}`) // 不翻：程序内部的断言，不上界面
  const theirDoc = parseBoard(theirs)
  const j = indexOf(theirDoc, id)
  if (j !== -1 && content(theirDoc.blocks[j]!) === content(baseDoc.blocks[i]!)) {
    const text = serializeBoard(put(theirDoc, j, body))
    return text === theirs ? { kind: 'none' } : { kind: 'update', text, merged: theirs !== base }
  }
  const mine = serializeBoard(put(baseDoc, i, body))
  const r = reconcile(base, mine, theirs)
  if (r.kind === 'none') return r
  if (r.kind === 'update') return r
  return { kind: 'conflict', text: r.text, theirs, others: r.text !== mine, deleted: j === -1 }
}

/** 正在改的卡被外面删了：照开框时的样子先画回原来的位置，框不卸掉 */
export function keepEditing(doc: BoardDoc, base: string | null, id: string | null): BoardDoc {
  if (!id || base === null || indexOf(doc, id) !== -1) return doc
  const baseDoc = parseBoard(base)
  const i = indexOf(baseDoc, id)
  if (i === -1) return doc
  const blocks = [...doc.blocks]
  blocks.splice(Math.min(i, blocks.length), 0, baseDoc.blocks[i]!)
  return { ...doc, blocks }
}
