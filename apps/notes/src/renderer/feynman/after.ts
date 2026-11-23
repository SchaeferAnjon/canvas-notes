/**
 * 判定卡上「补进导图 / 拍成导图」「出卡 · N 张」「记进笔记」：这里只是接口，事情在 ③ feynman-after（renderer/feynman-after/after.ts）。
 */
import type { RoundSection } from '../../shared/feynman/types'
import { feynmanCards, feynmanMakeMap, feynmanMergeMap, feynmanToNote } from '../feynman-after/after'
import { NoteDoc } from '../note-doc'

export interface AfterCtx {
  /** 这一轮在哪篇 */
  path: string
  round: RoundSection
  /** 白板底部提示（带撤回） */
  say(text: string, undo?: () => void): void
}

/** 刚判完、刚勾过出卡：编辑器里的字可能还没存下，③ 那边读盘上的文件，先存 */
const saved = () => NoteDoc.saveAll()

const req = (c: AfterCtx) => ({ notePath: c.path, roundId: c.round.meta.id, say: c.say })

/** 材料是导图的一支：先列出要改哪几处给你核对（贴着点的按钮弹），点了才放 */
export function toMap(c: AfterCtx): void {
  void saved().then(() => feynmanMergeMap(req(c)))
}

/** 材料是卡片：走拍导图的核对、放上白板，生成在这块白板的子白板里 */
export function snapMap(c: AfterCtx): void {
  void saved().then(() => feynmanMakeMap(req(c)))
}

/** 打开现有的出卡弹窗（来源「费曼缺口」）：勾上的缺口一张张过，送进 Anki */
export function makeCards(c: AfterCtx): void {
  void saved().then(() => feynmanCards(req(c)))
}

/** 材料来自的那篇末尾一块「费曼缺口 · X」：判定一行和缺口 */
export function toNote(c: AfterCtx): void {
  void saved().then(() => feynmanToNote(req(c)))
}
