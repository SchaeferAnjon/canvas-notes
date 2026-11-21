import { describe, expect, it } from 'vitest'
import { actDoneText, actHaltText, actScope, changedParas, noTally } from '../src/shared/ai-act'

const board = { path: '冰岛.md', mode: 'board' as const, board: false }
const doc = { path: '周报.md', mode: 'doc' as const, board: false }

describe('actScope：光在哪亮', () => {
  it('只是看不亮：读白板、读文档', () => {
    expect(actScope('board_list', {}, board)).toBeNull()
    expect(actScope('doc_read', {}, doc)).toBeNull()
  })
  it('只加一张卡只亮那一处；挪、排、改卡是整块', () => {
    expect(actScope('board_add_card', { text: 'x' }, board)).toEqual({ area: 'board', whole: false, path: '冰岛.md' })
    for (const n of ['board_arrange', 'board_move', 'board_put_in_column', 'board_update_card', 'board_link', 'board_add_column'])
      expect(actScope(n, {}, board)).toEqual({ area: 'board', whole: true, path: '冰岛.md' })
  })
  it('白板：工具里给了 path 用它；没给、当前也不是白板时不画', () => {
    expect(actScope('board_arrange', { path: '别的.md' }, doc)).toEqual({ area: 'board', whole: true, path: '别的.md' })
    expect(actScope('board_arrange', {}, doc)).toBeNull()
    expect(actScope('board_arrange', {}, { path: 'b.md', mode: 'doc', board: true })?.path).toBe('b.md')
  })
  it('文档里写一段、换掉选中的那段只亮那一处；白板看法下不算', () => {
    expect(actScope('doc_insert', { text: 'x' }, doc)).toEqual({ area: 'doc', whole: false, path: '周报.md' })
    expect(actScope('doc_replace_selection', { text: 'x' }, doc)?.whole).toBe(false)
    expect(actScope('doc_insert', { text: 'x' }, board)).toBeNull()
  })
  it('整篇改写开着的这篇：整块亮（文档看法是文档，白板看法是白板）；改别的笔记不画', () => {
    expect(actScope('note_write', { path: '周报' }, doc)).toEqual({ area: 'doc', whole: true, path: '周报.md' })
    expect(actScope('note_write', { path: '冰岛.md' }, board)).toEqual({ area: 'board', whole: true, path: '冰岛.md' })
    expect(actScope('note_write', { path: '别的.md' }, doc)).toBeNull()
    expect(actScope('note_create', { title: 'x' }, doc)).toBeNull()
  })
  it('网页的每一步都是整块', () => {
    expect(actScope('web_read', {}, doc)).toEqual({ area: 'web', whole: true, path: null })
  })
})

describe('提示条上的话', () => {
  it('做完：照原型写', () => {
    expect(actDoneText('board', { ...noTally(), moved: 4 })).toBe('整理好了 · 挪了4张卡')
    expect(actDoneText('board', { ...noTally(), moved: 2, added: 1 })).toBe('整理好了 · 挪了2张卡 · 加了1张卡')
    expect(actDoneText('board', noTally())).toBe('整理好了')
    expect(actDoneText('doc', { ...noTally(), changed: 3 })).toBe('改好了 · 改了3段')
    expect(actDoneText('web', { ...noTally(), clipped: 2 })).toBe('做好了 · 剪了2段')
  })
  it('停下：做完的几步留着', () => {
    expect(actHaltText({ ...noTally(), moved: 2 })).toBe('停下了 · 做完的2步留着')
    expect(actHaltText(noTally())).toBe('停下了 · 什么也没改')
  })
})

describe('changedParas：整篇改写改了几段', () => {
  it('只数新出现的段，一样的段不算，空行多少不算', () => {
    const a = '# 标题\n\n第一段\n\n第二段\n\n第三段\n'
    expect(changedParas(a, a)).toBe(0)
    expect(changedParas(a, '# 标题\n\n第一段\n\n\n第二段改了\n\n第三段改了\n')).toBe(2)
    expect(changedParas(a, a + '\n第四段\n')).toBe(1)
    expect(changedParas('同一段\n\n同一段\n', '同一段\n\n同一段\n\n同一段\n')).toBe(1)
  })
})
