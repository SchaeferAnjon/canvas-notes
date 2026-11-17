/**
 * 「刚插进来」的提示（剪进文档、AI 回答插进文档、记下这一刻、微信读书划线、PDF 笔记）：
 * 在正文左边的留白里画一道 2px --acc 竖线，从插入范围的第一行顶到最后一行底，1.6 秒后 0.4 秒淡出。
 * 正文四周、每一行都不画框（CN-13、CN-79：以前按行加外圈，几行叠起来就是几道横线）。
 * 竖线挂在 .cm-editor 上（和块把手同一层），不进 .cm-scroller，留白里的部分不会被裁掉。
 */
import { StateEffect, StateField } from '@codemirror/state'
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'

export const flashEffect = StateEffect.define<{ from: number; to: number } | null>()

export const flashField = StateField.define<{ from: number; to: number } | null>({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(flashEffect)) return e.value
    if (!v || !tr.docChanged) return v
    return { from: tr.changes.mapPos(v.from, 1), to: tr.changes.mapPos(v.to, -1) }
  },
})

const SHOW_MS = 1600
const FADE_MS = 400

class FlashBar {
  private bar: HTMLDivElement
  private timers: ReturnType<typeof setTimeout>[] = []

  constructor(readonly view: EditorView) {
    this.bar = document.createElement('div')
    this.bar.className = 'cm-flashbar'
    this.bar.hidden = true
    this.bar.setAttribute('aria-hidden', 'true')
    view.dom.appendChild(this.bar)
  }

  update(u: ViewUpdate) {
    const was = u.startState.field(flashField)
    const now = u.state.field(flashField)
    if (now !== was && now && !was) this.start()
    if (!now) return this.stop()
    if (now !== was || u.geometryChanged || u.heightChanged) this.place()
  }

  private start() {
    this.clear()
    this.bar.classList.remove('out')
    this.timers.push(
      setTimeout(() => this.bar.classList.add('out'), SHOW_MS),
      setTimeout(() => this.view.dispatch({ effects: flashEffect.of(null) }), SHOW_MS + FADE_MS),
    )
    this.place()
  }

  private stop() {
    this.clear()
    this.bar.hidden = true
    this.bar.classList.remove('out')
  }

  private clear() {
    for (const t of this.timers) clearTimeout(t)
    this.timers = []
  }

  private place() {
    this.view.requestMeasure({
      key: this,
      read: (view) => {
        const r = view.state.field(flashField)
        if (!r) return null
        const dom = view.dom.getBoundingClientRect()
        const top = view.lineBlockAt(r.from).top
        const bottom = view.lineBlockAt(Math.max(r.from, r.to)).bottom
        return { top: view.documentTop - dom.top + top, height: bottom - top }
      },
      write: (m) => {
        if (!m) return
        this.bar.style.top = Math.round(m.top) + 'px'
        this.bar.style.height = Math.max(4, Math.round(m.height)) + 'px'
        this.bar.hidden = false
      },
    })
  }

  destroy() {
    this.clear()
    this.bar.remove()
  }
}

export const insertFlash = [flashField, ViewPlugin.fromClass(FlashBar)]

/** 插入范围闪一下 */
export function flashRange(view: EditorView, range: { from: number; to: number }) {
  view.dispatch({ effects: flashEffect.of(null) })
  view.dispatch({ effects: flashEffect.of(range) })
}

/**
 * 在 pos 所在这一段后面插一块 text：前面和上一段隔一个空行，后面补一个空段落放光标，再和下一段隔一个空行。
 * para: false（后台插的：AI 工具、微信读书划线、PDF 笔记）不补空段落，光标停在插入的末尾，文件里不多空行。
 * 返回改动、插入的范围和光标位置（纯函数，单元测试在 test/insert-block.test.ts）。
 */
export function insertBlockAt(doc: string, pos: number, text: string, para = true): { from: number; to: number; insert: string; range: { from: number; to: number }; cursor: number } {
  const lineEnd = doc.indexOf('\n', pos)
  const at = lineEnd === -1 ? doc.length : lineEnd
  let nl = 0
  while (nl < 2 && at - nl - 1 >= 0 && doc[at - nl - 1] === '\n') nl++
  const before = at === 0 ? '' : '\n'.repeat(Math.max(0, 2 - nl))
  let end = at
  while (doc[end] === '\n') end++
  const rest = end < doc.length
  const insert = para ? before + text + '\n\n' + (rest ? '\n\n' : '') : before + text + (rest ? '\n\n' : '\n')
  const from = at + before.length
  return { from: at, to: end, insert, range: { from, to: from + text.length }, cursor: from + text.length + (para ? 2 : 0) }
}
