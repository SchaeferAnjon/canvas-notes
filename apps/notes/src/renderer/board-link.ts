/**
 * 白板链接（DESIGN.v3 6.5、6.3「白板链接 · 把一块白板嵌进来」）：独占一行的 [[白板]]（指向 type: board 的那篇）
 * 画成一张卡：白板自己的颜色方块 + 名字 + 「白板 · N 张卡片 · 点开在新标签」，点了在新标签开那块白板。
 * 一整块：光标跨过去，下面一行行首退格先选中它（atomic-blocks.ts），块菜单「改写法」露出 [[…]] 原文。
 * 库里白板的颜色、卡片数由 NoteTab 按左栏的笔记列表告诉编辑器（setBoards）。只加装饰，不动文字。
 */
import { codiconEl, type CodiconName } from '@cn/design'
import { type EditorState, type Range, StateEffect, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import { app } from './ctx/actions'
import { type Hidden, hiddenSyntax, wholeBlock } from './hidden-syntax'

export interface BoardInfo {
  path: string
  color: string
  cards: number
  icon?: string
}

/** 白板的名字 → 它的颜色、卡片数（名字不分大小写） */
export const setBoards = StateEffect.define<Map<string, BoardInfo>>()

const boardsField = StateField.define<Map<string, BoardInfo>>({
  create: () => new Map(),
  update: (v, tr) => tr.effects.reduce((x, e) => (e.is(setBoards) ? e.value : x), v),
})

const LINE = /^[ \t]*\[\[([^\]|#^\n]+)(?:[#^][^\]|\n]*)?(?:\|[^\]\n]*)?\]\][ \t]*$/

class BoardCard extends WidgetType {
  constructor(
    readonly name: string,
    readonly target: string,
    readonly info: BoardInfo,
  ) {
    super()
  }
  eq(o: BoardCard) {
    return o.name === this.name && o.info.color === this.info.color && o.info.cards === this.info.cards && o.info.icon === this.info.icon
  }
  toDOM() {
    const wrap = document.createElement('div')
    wrap.className = 'cm-boardwrap'
    const card = document.createElement('div')
    card.className = 'cm-boardcard'
    card.dataset.part = '白板链接'
    card.setAttribute('role', 'link')
    card.setAttribute('aria-label', `白板 ${this.name}，点开在新标签`)
    const sq = document.createElement('span')
    sq.className = 'sq'
    sq.style.background = this.info.color
    sq.appendChild(codiconEl((this.info.icon as CodiconName) || 'layout', 18))
    const tx = document.createElement('span')
    tx.className = 'tx'
    const b = document.createElement('b')
    b.textContent = this.name
    const s = document.createElement('span')
    s.textContent = `白板 · ${this.info.cards} 张卡片 · 点开在新标签`
    tx.append(b, s)
    card.append(sq, tx)
    card.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      app().openWikilink(this.target)
    })
    wrap.appendChild(card)
    return wrap
  }
  ignoreEvent() {
    return true
  }
}

function build(state: EditorState): DecorationSet {
  const boards = state.field(boardsField)
  if (!boards.size) return Decoration.none
  const out: Range<Decoration>[] = []
  const doc = state.doc
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n)
    if (!line.text.includes('[[')) continue
    const m = LINE.exec(line.text)
    if (!m) continue
    const target = m[1]!.trim()
    const info = boards.get(target.toLowerCase())
    if (!info) continue
    out.push(Decoration.replace({ widget: new BoardCard(target, target, info), block: true }).range(line.from, line.to))
  }
  return Decoration.set(out)
}

const cards = StateField.define<DecorationSet>({
  create: build,
  update: (v, tr) => (tr.docChanged || tr.effects.some((e) => e.is(setBoards)) ? build(tr.state) : v),
  provide: (f) => [
    EditorView.decorations.from(f),
    EditorView.atomicRanges.of((view) => view.state.field(f)),
    hiddenSyntax.of((state) => {
      const out: Hidden[] = []
      state.field(f).between(0, state.doc.length, (from, to) => void out.push(wholeBlock(state.doc, from, to, true)))
      return out
    }),
  ],
})

export const boardLink = [boardsField, cards]
