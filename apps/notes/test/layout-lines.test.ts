import { EditorState, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { hiddenGuard } from '../src/renderer/hidden-syntax'
import { backspaceOverLayout, layoutLines } from '../src/renderer/layout-lines'

/** 只带 state 和 dispatch 的假编辑器：命令只用到这两样 */
function fake(doc: string, at: number) {
  let state = EditorState.create({ doc, selection: { anchor: at } })
  const view = {
    get state() {
      return state
    },
    dispatch(spec: TransactionSpec) {
      state = state.update(spec).state
    },
  }
  return view as unknown as EditorView & { state: EditorState }
}

describe('文档里藏着的位置行（文档白板拖到空白处写的）', () => {
  const doc = '# 外改\n\n第一段。\n\n<!-- card id=d1 x=914 y=398 -->\n开头一段。\n\n收尾一段。\n'

  it('在那段开头按退格：删掉位置行上面的空行，位置行留着，光标还在那段开头', () => {
    const v = fake(doc, doc.indexOf('开头一段'))
    expect(backspaceOverLayout(v)).toBe(true)
    expect(v.state.doc.toString()).toBe('# 外改\n\n第一段。\n<!-- card id=d1 x=914 y=398 -->\n开头一段。\n\n收尾一段。\n')
    expect(v.state.doc.sliceString(v.state.selection.main.head).startsWith('开头一段')).toBe(true)
  })

  it('第二下（上面已经不是空行）：像普通退格一样把这段并到上一行末尾，看得见变化；位置行挪到并好的那段前面，卡还摆在原处', () => {
    const v = fake(doc, doc.indexOf('开头一段'))
    backspaceOverLayout(v)
    expect(backspaceOverLayout(v)).toBe(true)
    expect(v.state.doc.toString()).toBe('# 外改\n\n<!-- card id=d1 x=914 y=398 -->\n第一段。开头一段。\n\n收尾一段。\n')
    expect(v.state.doc.sliceString(v.state.selection.main.head).startsWith('开头一段')).toBe(true)
    // 上面那段有好几行：位置行放在那段第一行前面
    const multi = '# 外改\n\n第一行\n第二行\n<!-- card id=d1 x=1 y=2 -->\n开头一段。\n'
    const m = fake(multi, multi.indexOf('开头一段'))
    expect(backspaceOverLayout(m)).toBe(true)
    expect(m.state.doc.toString()).toBe('# 外改\n\n<!-- card id=d1 x=1 y=2 -->\n第一行\n第二行开头一段。\n')
    // 上面是标题：并进标题，位置行不往标题前面放（标题不当单独摆的卡），跟着删
    const head = '# 外改\n\n## 第一节\n<!-- card id=d1 x=1 y=2 -->\n开头一段。\n'
    const h = fake(head, head.indexOf('开头一段'))
    expect(backspaceOverLayout(h)).toBe(true)
    expect(h.state.doc.toString()).toBe('# 外改\n\n## 第一节开头一段。\n')
  })

  it('不在段首、前一行不是位置行、白板（type: board）：不管，照常退格', () => {
    expect(backspaceOverLayout(fake(doc, doc.indexOf('开头一段') + 1))).toBe(false)
    expect(backspaceOverLayout(fake(doc, doc.indexOf('收尾一段')))).toBe(false)
    const board = '---\ntype: board\n---\n\n<!-- card id=c1 x=0 y=0 -->\n卡片\n'
    expect(backspaceOverLayout(fake(board, board.indexOf('卡片')))).toBe(false)
  })
})

describe('光标进不去藏着的位置行（第 4 轮：←、Home 两下、Ctrl+A、点行首再 Home 都把字打进了注释前面）', () => {
  const doc = '# 合并测试\n\n第二段卡片。\n\n<!-- card id=d2 x=900 y=200 -->\n收尾一段。\n'
  const card = doc.indexOf('<!--')
  const end = doc.indexOf('-->') + 3
  const at = (s: string, pos: number) => s.slice(0, pos) + '|' + s.slice(pos)

  it('位置行上的每个位置（行首到行尾）都挪到上一行（空行）末尾；别处不动', () => {
    for (let p = card; p <= end; p++) {
      const s = EditorState.create({ doc, extensions: [layoutLines, hiddenGuard] }).update({ selection: { anchor: p }, userEvent: 'select' }).state
      expect(at(doc, s.selection.main.head)).toBe(at(doc, card - 1))
    }
    const s = EditorState.create({ doc, extensions: [layoutLines, hiddenGuard] })
    expect(s.update({ selection: { anchor: end + 1 }, userEvent: 'select' }).state.selection.main.head).toBe(end + 1)
    expect(s.update({ selection: { anchor: card - 1 }, userEvent: 'select' }).state.selection.main.head).toBe(card - 1)
  })

  it('编辑器里：选区落到位置行上（Home、←、点）就挪出来；打字落在空行里，注释原样', () => {
    let s = EditorState.create({ doc, extensions: [layoutLines, hiddenGuard] })
    s = s.update({ selection: { anchor: card }, userEvent: 'select' }).state
    expect(s.selection.main.head).toBe(card - 1)
    s = s.update({ selection: { anchor: end }, userEvent: 'select' }).state
    expect(s.selection.main.head).toBe(card - 1)
    s = s.update({ ...s.replaceSelection('Y'), userEvent: 'input.type' }).state
    expect(s.doc.toString()).toBe('# 合并测试\n\n第二段卡片。\nY\n<!-- card id=d2 x=900 y=200 -->\n收尾一段。\n')
    // 选区一头在位置行上：那一头挪出来
    s = EditorState.create({ doc, extensions: [layoutLines, hiddenGuard] })
    s = s.update({ selection: { anchor: doc.indexOf('收尾一段') + 2, head: card + 3 }, userEvent: 'select' }).state
    expect([s.selection.main.anchor, s.selection.main.head]).toEqual([doc.indexOf('收尾一段') + 2, card - 1])
  })

  it('位置行在第一行：挪到下一行行首；白板（type: board）不藏、不挪', () => {
    const first = '<!-- card id=c1 x=0 y=0 -->\n开头。\n'
    const f = EditorState.create({ doc: first, extensions: [layoutLines, hiddenGuard] }).update({ selection: { anchor: 3 }, userEvent: 'select' }).state
    expect(f.selection.main.head).toBe(first.indexOf('开头'))
    const board = '---\ntype: board\n---\n\n<!-- card id=c1 x=0 y=0 -->\n卡片\n'
    const b = EditorState.create({ doc: board, extensions: [layoutLines, hiddenGuard] }).update({ selection: { anchor: board.indexOf('<!--') }, userEvent: 'select' }).state
    expect(b.selection.main.head).toBe(board.indexOf('<!--'))
  })
})
