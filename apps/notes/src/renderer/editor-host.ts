import { findBlocks, type MdBlock } from '@cn/format'
import { Facet, StateField } from '@codemirror/state'
import type { ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'

/** 文档模式的块编辑要从外面拿的东西（NoteDoc 给） */
export interface EditorHost {
  /** 这篇笔记的路径（相对库根目录；改名后会变） */
  path(): string
  notice(text: string): void
}

export const editorHost = Facet.define<EditorHost, EditorHost>({
  combine: (v) => v[0] ?? { path: () => '', notice: () => {} },
})

/** 整篇的顶层块，文字一变就重找（笔记不大，整篇扫一遍很快） */
export const blocksField = StateField.define<MdBlock[]>({
  create: (s) => findBlocks(s.doc.toString()),
  update: (v, tr) => (tr.docChanged ? findBlocks(tr.state.doc.toString()) : v),
})

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
    this.root = createRoot(this.el)
  }

  get open() {
    return !this.el.hidden
  }

  /** anchor：贴着它下面（放不下翻到上面） */
  show(node: ReactNode, anchor: { left: number; top: number; bottom: number }) {
    // 先显示再渲染：里面的输入框、菜单在挂上时要能拿到焦点
    this.el.hidden = false
    flushSync(() => this.root.render(node))
    const w = this.el.offsetWidth
    const h = this.el.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight
    const left = Math.max(8, Math.min(anchor.left, vw - w - 8))
    let top = anchor.bottom + 6
    if (top + h > vh - 8 && anchor.top - 6 - h > 8) top = anchor.top - 6 - h
    this.el.style.left = left + 'px'
    this.el.style.top = Math.max(8, top) + 'px'
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
