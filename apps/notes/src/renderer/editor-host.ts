import { findBlocks, type MdBlock } from '@cn/format'
import { type EditorState, Facet, StateField } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { ReactNode } from 'react'
import { flushSync } from 'react-dom'
import type { Root } from 'react-dom/client'
import { guardedRoot } from './crash/root'
import { placePop } from './pop-place'

/** 文档模式的块编辑要从外面拿的东西（NoteDoc 给） */
export interface EditorHost {
  /** 这篇笔记的路径（相对库根目录；改名后会变） */
  path(): string
  notice(text: string): void
}

export const editorHost = Facet.define<EditorHost, EditorHost>({
  combine: (v) => v[0] ?? { path: () => '', notice: () => {} },
})

/**
 * 这是白板上的一张卡在改（cardEditing），不是整篇文档：卡里打 / 插的标题是 ####（slash-menu），
 * 引文末尾回车续在引文里、不新起一段（doc-keys：新起的一段存回去就成了另一张卡）
 */
export const inCard = Facet.define<boolean, boolean>({ combine: (v) => v.some(Boolean) })

/** 整篇的顶层块，文字一变就重找（笔记不大，整篇扫一遍很快） */
export const blocksField = StateField.define<MdBlock[]>({
  create: (s) => findBlocks(s.doc.toString()),
  update: (v, tr) => (tr.docChanged ? findBlocks(tr.state.doc.toString()) : v),
})

const drawnCache = new WeakMap<EditorState, MdBlock[]>()

/**
 * 把手、加号、⌘D、⌥⇧↑↓ 看到的块：md 的顶层块，只是画成一整张卡的东西（时刻块、问答块、视频卡、收着的折叠块）
 * 在 md 里是好几块（注释、图、链接、引文），这里并成一块：一个把手，复制、删除、拖动、改写法都是整张卡。
 * 整张卡 = 各自通过 EditorView.atomicRanges 交上来的块部件（spec.block 且有部件），和 atomic-blocks.ts 同一个认法。
 */
export function drawnBlocks(view: EditorView): MdBlock[] {
  const state = view.state
  const seen = drawnCache.get(state)
  if (seen) return seen
  const md = state.field(blocksField)
  const cards: { from: number; to: number }[] = []
  for (const f of state.facet(EditorView.atomicRanges)) {
    f(view).between(0, state.doc.length, (from, to, d) => {
      if (d.spec.block && d.spec.widget) cards.push({ from, to })
    })
  }
  let out = md
  if (cards.length) {
    out = []
    for (const b of md) {
      const card = cards.find((c) => b.from < c.to && b.to > c.from)
      const last = out[out.length - 1]
      if (card && last && last.from < card.to && last.to > card.from) out[out.length - 1] = { ...last, to: Math.max(last.to, b.to, card.to) }
      else out.push(card ? { ...b, from: Math.min(b.from, card.from), to: Math.max(b.to, card.to) } : b)
    }
  }
  drawnCache.set(state, out)
  return out
}

/**
 * 编辑器里弹出来的小浮层（块菜单、/ 菜单）：一个挂在 body 上的 React 根，
 * 位置用屏幕坐标，下面放不下就翻到上面。
 */
export class Popover {
  readonly el: HTMLDivElement
  private root: Root

  constructor(className: string) {
    this.el = document.createElement('div')
    this.el.className = 'ed-pop ' + className
    this.el.hidden = true
    document.body.appendChild(this.el)
    this.root = guardedRoot(this.el, 'popover')
  }

  get open() {
    return !this.el.hidden
  }

  /** anchor：贴着它下面（放不下翻到上面）；给了 right，右边放不下往左翻 */
  show(node: ReactNode, anchor: { left: number; top: number; bottom: number; right?: number }) {
    // 先显示再渲染：里面的输入框、菜单在挂上时要能拿到焦点
    this.el.hidden = false
    flushSync(() => this.root.render(node))
    // 和数据库、白板上的浮层同一个放法（pop-place）
    placePop(this.el, anchor, { gap: 6 })
  }

  hide() {
    if (this.el.hidden) return
    this.el.hidden = true
    flushSync(() => this.root.render(null))
  }

  destroy() {
    const root = this.root
    // React 不许在渲染途中卸载，放到下一轮
    queueMicrotask(() => root.unmount())
    this.el.remove()
  }
}
