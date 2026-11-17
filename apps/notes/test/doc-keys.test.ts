import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { backspaceOutOfQuote, enterInQuote } from '../src/renderer/doc-keys'

/** 只带 state 和 dispatch 的假编辑器：命令只用到这两样 */
function fake(doc: string, at: number) {
  let state = EditorState.create({ doc, selection: { anchor: at }, extensions: [markdown({ base: markdownLanguage })] })
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
