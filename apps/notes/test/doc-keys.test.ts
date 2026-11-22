import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { backspaceOutOfQuote, enterInQuote, shiftTabKey, tabKey } from '../src/renderer/doc-keys'
import { reviewSyntax } from '../src/renderer/review'

/** 只带 state 和 dispatch 的假编辑器：命令只用到这两样 */
function fake(doc: string, at: number) {
  let state = EditorState.create({ doc, selection: { anchor: at }, extensions: [markdown({ base: markdownLanguage }), reviewSyntax] })
  ensureSyntaxTree(state, doc.length, 5000)
  const view = {
    get state() {
      return state
    },
    dispatch(spec: TransactionSpec) {
      state = state.update(spec).state
      ensureSyntaxTree(state, state.doc.length, 5000)
    },
  }
  return view as unknown as EditorView & { state: EditorState }
}

const CLIP = '> 雷克雅未克是冰岛的首都。\n—— [维基百科](https://zh.wikipedia.org/wiki/x)'

describe('引用里回车（CN-14）', () => {
  it('剪进来的引文，在出处行末尾回车：新起一段普通段落，文件里多的是一个空行', () => {
    const doc = `前一段\n\n${CLIP}\n\n后一段\n`
    const v = fake(doc, doc.indexOf('/x)') + 3)
    expect(enterInQuote(v)).toBe(true)
    const head = v.state.selection.main.head
    expect(v.state.doc.toString()).toBe(`前一段\n\n${CLIP}\n\n\n\n后一段\n`)
    expect(v.state.doc.lineAt(head).text).toBe('')
    expect(v.state.doc.lineAt(head - 1).text).toBe('')
  })

  it('引用中间回车：不管，交给 md 自己的续写', () => {
    const doc = '> 第一行\n> 第二行\n'
    expect(enterInQuote(fake(doc, 3))).toBe(false)
  })

  it('引用最后一行但光标不在末尾：不管', () => {
    const doc = '> 第一行\n> 第二行\n'
    expect(enterInQuote(fake(doc, doc.indexOf('第二') + 1))).toBe(false)
  })

  it('空的 > 行回车一次就退出', () => {
    const doc = '> 第一行\n> '
    const v = fake(doc, doc.length)
    expect(enterInQuote(v)).toBe(true)
    expect(v.state.doc.toString()).toBe('> 第一行\n\n')
    expect(v.state.selection.main.head).toBe(v.state.doc.length)
  })

  it('提示块：标题行、最后一行末尾回车在块里续一行 >，空的 > 行再回车出块', () => {
    const head = '> [!tip] 小贴士'
    const v = fake(head, head.length)
    expect(enterInQuote(v)).toBe(true)
    expect(v.state.doc.toString()).toBe(head + '\n> ')
    expect(v.state.selection.main.head).toBe(v.state.doc.length)
    const doc = '> [!question] 我的疑惑\n> 为什么？'
    const w = fake(doc, doc.length)
    expect(enterInQuote(w)).toBe(true)
    expect(w.state.doc.toString()).toBe(doc + '\n> ')
    // 空的 > 行回车：出块
    expect(enterInQuote(w)).toBe(true)
    expect(w.state.doc.toString()).toBe(doc + '\n\n')
    expect(w.state.selection.main.head).toBe(w.state.doc.length)
  })

  it('不在引用里：不管', () => {
    expect(enterInQuote(fake('普通一段', 4))).toBe(false)
  })
})

describe('提示块最后的空 > 行按退格（第 2 轮存疑）', () => {
  it('删掉 > 就出块：上面空一行，接着打的字不再按懒续行画进块里', () => {
    const doc = '> [!tip] 小贴士\n> 第三行\n> '
    const v = fake(doc, doc.length)
    expect(backspaceOutOfQuote(v)).toBe(true)
    expect(v.state.doc.toString()).toBe('> [!tip] 小贴士\n> 第三行\n\n')
    expect(v.state.selection.main.head).toBe(v.state.doc.length)
  })

  it('块中间的空 > 行、有字的 > 行、不在行尾、上面不是引用：照常退格', () => {
    const mid = '> 一\n> \n> 二'
    expect(backspaceOutOfQuote(fake(mid, mid.indexOf('\n> \n') + 3))).toBe(false)
    const full = '> 一\n> 二'
    expect(backspaceOutOfQuote(fake(full, full.length))).toBe(false)
    expect(backspaceOutOfQuote(fake('正文\n> ', 5))).toBe(false)
  })
})

describe('Tab / ⇧Tab（task-busas）', () => {
  // 剪进来以后：引文、出处行、一个空行，光标停在下面那个空行上（insertBlockAt）
  const clipped = `前一段\n\n${CLIP}\n\n`
  const atEnd = (doc: string) => fake(doc, doc.length)

  it('剪进来的一段后面按 Tab：开一段「我的评价」，光标在标签后面；打字进评价', () => {
    const v = atEnd(clipped)
    expect(tabKey(v)).toBe(true)
    expect(v.state.doc.toString()).toBe(`前一段\n\n${CLIP}\n\n我的评价：\n\n`)
    expect(v.state.selection.main.head).toBe(v.state.doc.toString().indexOf('我的评价：') + 5)
    v.dispatch({ changes: { from: v.state.selection.main.head, insert: '说得对' } })
    expect(v.state.doc.toString()).toBe(`前一段\n\n${CLIP}\n\n我的评价：说得对\n\n`)
  })

  it('光标在出处行末尾、引文里、紧挨着的下一行（没隔空行）：一样开评价', () => {
    const end = fake(`${CLIP}\n\n后一段\n`, CLIP.length)
    tabKey(end)
    expect(end.state.doc.toString()).toBe(`${CLIP}\n\n我的评价：\n\n后一段\n`)
    const mid = fake(`${CLIP}\n`, 4)
    tabKey(mid)
    expect(mid.state.doc.toString()).toBe(`${CLIP}\n\n我的评价：\n`)
    const next = fake(`${CLIP}\n`, CLIP.length + 1)
    tabKey(next)
    expect(next.state.doc.toString()).toBe(`${CLIP}\n\n我的评价：\n`)
  })

  it('已经有评价：光标到评价末尾，字不变', () => {
    const doc = `${CLIP}\n\n我的评价：写过了\n\n`
    const v = atEnd(doc)
    tabKey(v)
    expect(v.state.doc.toString()).toBe(doc)
    expect(v.state.selection.main.head).toBe(doc.indexOf('写过了') + 3)
  })

  it('回车换了新行（隔了两个空行）、打了字的行、普通段落、标题、评价里：Tab 什么都不做', () => {
    for (const [doc, at] of [
      [`${clipped}\n`, clipped.length + 1],
      [`${clipped}写了字`, clipped.length + 3],
      ['普通一段\n', 2],
      ['# 标题\n', 4],
      [`${CLIP}\n\n我的评价：写过了\n`, CLIP.length + 6],
    ] as const) {
      const v = fake(doc, at)
      expect(tabKey(v)).toBe(true)
      expect(v.state.doc.toString()).toBe(doc)
      expect(shiftTabKey(v)).toBe(true)
      expect(v.state.doc.toString()).toBe(doc)
    }
  })

  it('空着的评价里 ⇧Tab：撤掉，文件回到原样，光标回到剪进来时停的那一行；写了字的不撤', () => {
    const v = atEnd(clipped)
    tabKey(v)
    expect(shiftTabKey(v)).toBe(true)
    expect(v.state.doc.toString()).toBe(clipped)
    expect(v.state.selection.main.head).toBe(clipped.length)
    // 下面隔一个空行就是下一块：撤掉以后光标回到出处行末尾
    const w = fake(`${CLIP}\n\n# 下一节\n`, CLIP.length)
    tabKey(w)
    expect(w.state.doc.toString()).toBe(`${CLIP}\n\n我的评价：\n\n# 下一节\n`)
    shiftTabKey(w)
    expect(w.state.doc.toString()).toBe(`${CLIP}\n\n# 下一节\n`)
    expect(w.state.selection.main.head).toBe(CLIP.length)
    const full = `${CLIP}\n\n我的评价：有字\n`
    const x = fake(full, full.length - 1)
    shiftTabKey(x)
    expect(x.state.doc.toString()).toBe(full)
  })

  it('提示块里的「> 正文」、紧跟在上一行后面的「> 原文」（时刻块里那种）不算摘录：Tab 不开评价', () => {
    for (const [doc, at] of [
      ['# 块\n\n> [!tip] 标题\n> 正文。\n\n', '# 块\n\n> [!tip] 标题\n> 正文。'.length],
      ['# 块\n\n> [!tip] 标题\n> 正文。\n\n', '# 块\n\n> [!tip] 标题\n> 正文。\n\n'.length],
      ['[▶ 00:01 · 视频](https://x.y)\n> **00:01 原文**\n\n', '[▶ 00:01 · 视频](https://x.y)\n> **00:01 原文**'.length],
    ] as const) {
      const v = fake(doc, at)
      tabKey(v)
      expect(v.state.doc.toString()).toBe(doc)
    }
  })

  it('列表里 Tab 进一级、⇧Tab 退回', () => {
    const doc = '- 一\n- 二\n'
    const v = fake(doc, doc.indexOf('二'))
    tabKey(v)
    expect(v.state.doc.toString()).toBe('- 一\n  - 二\n')
    shiftTabKey(v)
    expect(v.state.doc.toString()).toBe(doc)
  })

  it('代码块里 Tab 插两个空格，⇧Tab 退回；围栏行不算代码', () => {
    const doc = '```py\nx = 1\n```\n'
    const v = fake(doc, doc.indexOf('x'))
    tabKey(v)
    expect(v.state.doc.toString()).toBe('```py\n  x = 1\n```\n')
    shiftTabKey(v)
    expect(v.state.doc.toString()).toBe(doc)
  })
})
