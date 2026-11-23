/**
 * 文档里选好几块（task-5ryf9，设计稿 17-白板框选 方向 A 的文档部分，照 Notion 的官方说明；块结构照 task-ys1rr 的 6.4b）：
 * - 从字外面（左右留白、加号把手那一槽、块和块之间的缝、一行字后面的空处）按住拖 4px 以上：出一个淡色的框，框经过的块整块选上
 *   （每块铺一层强调色 24%，和点把手选中一块一个样子）；从字上开始拖还是选字；在字外面按下不拖照旧（光标放到那里，block-flow.ts）；
 * - ⇧ 点把手从上次选的那块连到这块，⌘ 点把手加减这一块（block-handles.tsx）；在字里按 Esc 选中这一块，再按 Esc 取消；
 *   ⇧↑↓ 往上往下扩；⌫ 删掉；Tab、⇧Tab 缩进（只有列表、待办）；⌘C、⌘X、⌘D；⌘A 照旧全选字；
 * - 选了两块起浮出和白板同一条操作条：已选N块 · 转成 ▾ · 移到 ▾ · 问AI · AI整理 · 出卡 ｜ 复制 · 删除 · ⋯（费曼先不放）。
 * 选中的几块记在 blockSel（一组范围，改字时跟着挪）；每一样改动是一次 dispatch，⌘Z 一下回来。
 */
import { type CodiconName } from '@cn/design'
import { convertMdBlocks, duplicateMdBlocks, indentMdBlocks, type MdBlock, removeMdBlocks, selectedMarkdown } from '@cn/format'
import { undo } from '@codemirror/commands'
import { EditorState, Prec, StateEffect, StateField } from '@codemirror/state'
import { EditorView, keymap, layer, RectangleMarker, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { titleOf } from '../shared/layout'
import { t } from '../shared/i18n'
import { pickCards } from './ai-cards'
import { cardMarker } from './atomic-blocks'
import { app } from './ctx/actions'
import { InfoCard, NotePick } from './multi-select/SelPopups'
import { drawnBlocks, editorHost } from './editor-host'
import { vaultFiles } from './files/store'
import { useT } from './i18n'
import { keyFor } from './keys'
import { anchorOf, type PopAnchor } from './pop-place'
import { type BarItem, SelBar } from './multi-select/SelBar'
import { type MenuRow, SelMenu } from './multi-select/SelMenu'
import { applyBlockEdit } from './block-handles'
import { noteDocRef } from './note-doc-ref'

type R = { from: number; to: number }
interface Sel {
  ranges: R[]
  /** ⇧ 连选、⇧↑↓ 从哪一块算起 */
  anchor: number | null
}
const EMPTY: Sel = { ranges: [], anchor: null }

export const setBlockSel = StateEffect.define<Sel | null>()

export const blockSel = StateField.define<Sel>({
  create: () => EMPTY,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setBlockSel)) return e.value ?? EMPTY
    if (!v.ranges.length) return v
    // 打字、删字、点别处、挪光标：不再选着（自己改块的那几下会再设一次）
    if (tr.isUserEvent('input') || tr.isUserEvent('delete') || tr.isUserEvent('select') || tr.isUserEvent('undo') || tr.isUserEvent('redo')) return EMPTY
    if (!tr.docChanged) return v
    const ranges = v.ranges.map((r) => ({ from: tr.changes.mapPos(r.from, 1), to: tr.changes.mapPos(r.to, -1) })).filter((r) => r.to > r.from)
    return { ranges, anchor: v.anchor === null ? null : tr.changes.mapPos(v.anchor, 1) }
  },
})

/** 选中的几块在现在的块里是第几块（按先后） */
export function selIndices(view: EditorView, sel: Sel = view.state.field(blockSel)): number[] {
  const bs = drawnBlocks(view)
  return sel.ranges
    .map((r) => bs.findIndex((b) => b.from <= r.from && r.to <= b.to + 1 && r.from <= b.to))
    .filter((i) => i >= 0)
    .filter((i, k, a) => a.indexOf(i) === k)
    .sort((a, b) => a - b)
}

/** 设成这几块 */
export function selectBlocks(view: EditorView, list: readonly MdBlock[], anchor: number | null = list[0]?.from ?? null) {
  view.dispatch({ effects: setBlockSel.of(list.length ? { ranges: list.map((b) => ({ from: b.from, to: b.to })), anchor } : null) })
}

/** 选中的那几块：每块一层强调色 24%（同点把手、退格选中整块；块部件跟卡自己的大小、圆角） */
const selLayer = layer({
  above: true,
  class: 'cm-blkSelLayer',
  markers(view) {
    const out = []
    const sc = view.scrollDOM.getBoundingClientRect()
    const content = view.contentDOM.getBoundingClientRect()
    const baseLeft = sc.left - view.scrollDOM.scrollLeft
    const baseTop = sc.top - view.scrollDOM.scrollTop
    // 文字块：先量好上下，挨得太近的两块（紧凑列表的几项，中间没有缝）不叠色，各铺到两块中间
    const rows: { top: number; bottom: number }[] = []
    for (const r of [...view.state.field(blockSel).ranges].sort((a, b) => a.from - b.from)) {
      if (r.to > view.state.doc.length) continue
      const card = cardMarker(view, r.from, 'cm-blk-hotbg')
      if (card) {
        out.push(card)
        continue
      }
      rows.push({ top: view.documentTop + view.lineBlockAt(r.from).top - baseTop - 4, bottom: view.documentTop + view.lineBlockAt(r.to).bottom - baseTop + 4 })
    }
    rows.forEach((x, k) => {
      const next = rows[k + 1]
      if (next && next.top < x.bottom) x.bottom = next.top = (x.bottom + next.top) / 2
    })
    for (const x of rows) out.push(new RectangleMarker('cm-blk-hotbg cm-blk-sel', content.left - baseLeft - 8, x.top, content.width + 16, x.bottom - x.top))
    return out
  },
  update: (u) => u.docChanged || u.geometryChanged || u.startState.field(blockSel) !== u.state.field(blockSel),
})

/** 拖框选块的时候：CodeMirror 自己的拖选不算（从块缝、行尾空处按下时它也在选字） */
let framing = false
const holdPointer = EditorState.transactionFilter.of((tr) => (framing && tr.isUserEvent('select.pointer') && !tr.docChanged ? [] : tr))

// ---------------------------------------------------------------- 键

const run = (view: EditorView, f: (view: EditorView, idx: number[]) => void) => {
  const idx = selIndices(view)
  if (!idx.length) return false
  f(view, idx)
  return true
}

/** 改完一样：底栏提示带「撤回」（撤的就是编辑器里这一步） */
function told(view: EditorView, text: string, canUndo = true) {
  if (canUndo) app().noticeUndo(text, () => (view.focus(), undo(view)))
  else app().notice(text)
}

export function removeSel(view: EditorView, idx: number[]) {
  const n = idx.length
  if (applyBlockEdit(view, removeMdBlocks(view.state.doc.toString(), idx, drawnBlocks(view)), 0, 'delete.block')) told(view, t('删了{n}块：md 里这{n}段删了', { n }))
}
function copySel(view: EditorView, idx: number[], cut = false) {
  const md = selectedMarkdown(view.state.doc.toString(), idx, drawnBlocks(view))
  void navigator.clipboard.writeText(md).then(() => {
    if (!cut) return told(view, t('复制了{n}块：贴进文档是这{n}段原文，贴进白板是{n}张卡', { n: idx.length }), false)
    if (applyBlockEdit(view, removeMdBlocks(view.state.doc.toString(), idx, drawnBlocks(view)), 0, 'delete.cut')) told(view, t('剪了{n}块：在别处 {k} 贴回来', { n: idx.length, k: keyFor('paste') ?? '' }))
  })
}
function dupSel(view: EditorView, idx: number[]) {
  const n = idx.length
  const e = duplicateMdBlocks(view.state.doc.toString(), idx, drawnBlocks(view))
  if (!applyBlockEdit(view, e, 0, 'input.block') || !e) return
  // 选中复制出来的那几块
  const bs = drawnBlocks(view)
  const start = bs.findIndex((b) => b.from === e.at)
  if (start >= 0) selectBlocks(view, bs.slice(start, start + n))
  told(view, t('复制了一份：这{n}段下面多了一样的{n}段', { n }))
}
function indentSel(view: EditorView, idx: number[], dir: 1 | -1) {
  const r = indentMdBlocks(view.state.doc.toString(), idx, dir, drawnBlocks(view))
  if (!r.changed) return told(view, t('正文、标题不能缩进：md 里缩进的正文会变成代码块；列表、待办能缩'), false)
  const keep = view.state.field(blockSel)
  applyBlockEdit(view, r.edit, 0, 'input.indent')
  view.dispatch({ effects: setBlockSel.of(keep) })
  const what = dir > 0 ? t('缩进了{n}条：每条开头多两个空格', { n: r.changed }) : t('减少缩进了{n}条：每条开头少两个空格', { n: r.changed })
  told(view, r.skipped ? t('{what}；另外{m}块不是列表，没动', { what, m: r.skipped }) : what)
}
/** ⇧↑↓：从起点那块往上往下扩 */
function extend(view: EditorView, dir: -1 | 1): boolean {
  const s = view.state.field(blockSel)
  const idx = selIndices(view, s)
  if (!idx.length) return false
  const bs = drawnBlocks(view)
  const lo = idx[0]!
  const hi = idx[idx.length - 1]!
  const a = s.anchor === null ? lo : Math.max(0, bs.findIndex((b) => b.from <= s.anchor! && s.anchor! <= b.to))
  let to = dir > 0 ? (a === lo ? hi + 1 : lo + 1) : a === hi ? lo - 1 : hi - 1
  to = Math.max(bs[0]?.kind === 'frontmatter' ? 1 : 0, Math.min(bs.length - 1, to))
  selectBlocks(view, bs.slice(Math.min(a, to), Math.max(a, to) + 1), bs[a]!.from)
  return true
}

/** 在一段字里按 Esc：选中这一整块（照 Notion）。排在别的 Esc 后面（/ 菜单、评价、链接卡先收自己） */
const escSelect = Prec.low(
  keymap.of([
    {
      key: 'Escape',
      run: (view) => {
        const bs = drawnBlocks(view)
        const head = view.state.selection.main.head
        const b = bs.find((x) => x.from <= head && head <= x.to && x.kind !== 'frontmatter')
        if (!b || view.state.readOnly || view.state.field(blockSel).ranges.length) return false
        view.dispatch({ selection: { anchor: b.from }, effects: setBlockSel.of({ ranges: [{ from: b.from, to: b.to }], anchor: b.from }) })
        return true
      },
    },
  ]),
)

/** 选着几块时的键：都只在选着的时候管，不选着照旧 */
const keys = Prec.highest(
  keymap.of([
    { key: 'Escape', run: (view) => (view.state.field(blockSel).ranges.length ? (view.dispatch({ effects: setBlockSel.of(null) }), true) : false) },
    { key: 'Backspace', run: (v) => !v.state.readOnly && run(v, removeSel) },
    { key: 'Delete', run: (v) => !v.state.readOnly && run(v, removeSel) },
    { key: 'Tab', run: (v) => !v.state.readOnly && run(v, (x, i) => indentSel(x, i, 1)) },
    { key: 'Shift-Tab', run: (v) => !v.state.readOnly && run(v, (x, i) => indentSel(x, i, -1)) },
    { key: 'Shift-ArrowDown', run: (v) => extend(v, 1) },
    { key: 'Shift-ArrowUp', run: (v) => extend(v, -1) },
    { key: 'Mod-c', run: (v) => run(v, (x, i) => copySel(x, i)) },
    { key: 'Mod-x', run: (v) => !v.state.readOnly && run(v, (x, i) => copySel(x, i, true)) },
    { any: (v, e) => !!keyFor('dup-block') && v.state.field(blockSel).ranges.length > 0 && !v.state.readOnly && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd' && run(v, dupSel) },
  ]),
)

// ---------------------------------------------------------------- 从字外面拖出框

/** 按下的地方在不在字上（标题、引文的字也算）；行尾后面的空处、块缝、左右留白都不算 */
function onText(view: EditorView, x: number, y: number): boolean {
  const c = view.contentDOM.getBoundingClientRect()
  if (x < c.left || x > c.right || y < c.top || y > c.bottom) return false
  const pos = view.posAtCoords({ x, y }, false)
  const line = view.state.doc.lineAt(pos)
  if (!line.text.trim()) return false
  const end = view.coordsAtPos(line.to, -1)
  // 一行字的最后一行后面的空处：点到的高度在这一行的最后一截（换行的长段只看最后那一截）
  return !(end && y >= end.top - 2 && y <= end.bottom + 2 && x > end.right + 6)
}

class Framer {
  private host: HTMLElement
  private box: HTMLDivElement | null = null
  private root: Root
  private barEl: HTMLDivElement
  constructor(readonly view: EditorView) {
    const doc = view.dom.parentElement
    this.host = (doc?.parentElement?.classList.contains('body') ? doc.parentElement : doc) ?? view.dom
    this.host.addEventListener('mousedown', this.onDown, true)
    this.barEl = document.createElement('div')
    this.barEl.style.display = 'contents'
    document.body.appendChild(this.barEl)
    this.root = createRoot(this.barEl)
    this.paint()
  }
  update(u: ViewUpdate) {
    if (u.startState.field(blockSel) !== u.state.field(blockSel) || u.docChanged || u.geometryChanged) this.paint()
  }
  private hidden = false
  private paint() {
    const view = this.view
    const n = view.state.field(blockSel).ranges.length
    queueMicrotask(() => this.root.render(n >= 2 ? <DocBar view={view} hidden={this.hidden} n={n} /> : null))
  }
  destroy() {
    this.host.removeEventListener('mousedown', this.onDown, true)
    this.box?.remove()
    const root = this.root
    const el = this.barEl
    queueMicrotask(() => (root.unmount(), el.remove()))
  }
  private onDown = (e: MouseEvent) => {
    const view = this.view
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.altKey || view.state.readOnly) return
    const t0 = e.target as HTMLElement
    // 按钮、链接、卡片里能点的、加号把手以外的槽里的按钮自己有事；「+」上按下再拖也算从空白开始（不动松手才是点「+」）
    if (t0.closest('a, input, textarea, .cm-widgetBuffer, .blk-grip, .ed-pop, .doc-toc-wrap, .doc-embed, .db-card, .cm-tail-ph')) return
    if (t0.closest('button') && !t0.closest('.blk-add')) return
    if (onText(view, e.clientX, e.clientY)) {
      // 从字上开始拖是选字；选着几块时点字就是不再选着
      if (view.state.field(blockSel).ranges.length && !e.shiftKey) view.dispatch({ effects: setBlockSel.of(null) })
      return
    }
    const base = e.shiftKey ? view.state.field(blockSel).ranges : []
    const sx = e.clientX
    const sy = e.clientY
    const sTop = this.scroller().scrollTop
    let moved = false
    const move = (ev: MouseEvent) => {
      if (!moved) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return
        moved = true
        framing = true
        this.hidden = true
        // 光标收成一点（按下时 CodeMirror、block-flow 可能已经放了光标或开始选字）
        const at = view.state.selection.main.head
        view.dispatch({ selection: { anchor: at } })
        this.box = document.createElement('div')
        this.box.className = 'cm-blk-marquee'
        this.box.dataset.testid = 'doc-marquee'
        document.body.appendChild(this.box)
      }
      this.frame(sx, sy + (sTop - this.scroller().scrollTop), ev.clientX, ev.clientY, base)
      this.autoScroll(ev.clientY)
    }
    const up = () => {
      window.removeEventListener('mousemove', move, true)
      window.removeEventListener('mouseup', up, true)
      framing = false
      this.box?.remove()
      this.box = null
      if (!moved) return
      this.hidden = false
      this.paint()
      view.focus()
    }
    window.addEventListener('mousemove', move, true)
    window.addEventListener('mouseup', up, true)
  }
  private scroller(): HTMLElement {
    return this.host.closest<HTMLElement>('.body') ?? this.view.scrollDOM
  }
  private autoScroll(y: number) {
    const sc = this.scroller()
    const r = sc.getBoundingClientRect()
    if (y < r.top + 32) sc.scrollTop -= 14
    else if (y > r.bottom - 32) sc.scrollTop += 14
  }
  /** 框（窗口坐标）：经过的块整块选上（只看上下，照原型） */
  private frame(x0: number, y0: number, x1: number, y1: number, base: R[]) {
    const view = this.view
    const top = Math.min(y0, y1)
    const bottom = Math.max(y0, y1)
    if (this.box) Object.assign(this.box.style, { left: Math.min(x0, x1) + 'px', top: top + 'px', width: Math.abs(x1 - x0) + 'px', height: bottom - top + 'px' })
    const hits = drawnBlocks(view).filter((b) => {
      if (b.kind === 'frontmatter') return false
      const a = view.coordsAtPos(b.from, 1)
      const z = view.coordsAtPos(b.to, -1)
      const bt = a ? a.top : view.documentTop + view.lineBlockAt(b.from).top
      const bb = z ? z.bottom : view.documentTop + view.lineBlockAt(b.to).bottom
      return bt < bottom && bb > top
    })
    const ranges = [...base, ...hits.map((b) => ({ from: b.from, to: b.to }))].filter((r, k, a) => a.findIndex((x) => x.from === r.from) === k).sort((a, b) => a.from - b.from)
    const cur = view.state.field(blockSel)
    if (cur.ranges.length === ranges.length && cur.ranges.every((r, k) => r.from === ranges[k]!.from && r.to === ranges[k]!.to)) return
    view.dispatch({ effects: setBlockSel.of(ranges.length ? { ranges, anchor: ranges[0]!.from } : null) })
  }
}

// ---------------------------------------------------------------- 操作条

const TURN: [string, CodiconName][] = [
  ['paragraph', 'text-size'],
  ['h2', 'text-size'],
  ['h3', 'text-size'],
  ['bullet', 'list-unordered'],
  ['ordered', 'list-ordered'],
  ['todo', 'checklist'],
  ['quote', 'quote'],
  ['callout', 'info'],
]
/** 「转成」菜单里每一样的名字（同字不同义：标题是 Heading 不是属性里的 Title，带上「转成」） */
function turnName(v: string): string {
  switch (v) {
    case 'paragraph':
      return t('正文', { ctx: '转成' })
    case 'h2':
      return t('标题', { ctx: '转成' })
    case 'h3':
      return t('小标题', { ctx: '转成' })
    case 'bullet':
      return t('列表', { ctx: '转成' })
    case 'ordered':
      return t('编号列表', { ctx: '转成' })
    case 'todo':
      return t('待办', { ctx: '转成' })
    case 'quote':
      return t('引用', { ctx: '转成' })
    default:
      return t('提示块', { ctx: '转成' })
  }
}
/** 转成以后提示里说改了什么记号 */
function howOf(v: string): string {
  switch (v) {
    case 'paragraph':
      return t('去掉了开头的记号')
    case 'h2':
      return t('每段开头加了「## 」')
    case 'h3':
      return t('每段开头加了「### 」')
    case 'bullet':
      return t('每段开头加了「- 」')
    case 'ordered':
      return t('每段开头加了「1. 」')
    case 'todo':
      return t('每段开头加了「- [ ] 」')
    case 'quote':
      return t('每段开头加了「> 」')
    default:
      return t('包成了一个「> [!note]」提示块')
  }
}

/** 窄了按这个先后收进「⋯」（原型：复制 → 出卡 → 费曼 → 移到 → 对齐 → 放进列 / 转成） */
const FOLD = ['copy', 'anki', 'move', 'tidy', 'turn']

function DocBar(props: { view: EditorView; hidden: boolean; n: number }) {
  const t = useT()
  const view = props.view
  const [menu, setMenu] = useState<{ k: string; at: PopAnchor; folded: string[] } | null>(null)
  const [info, setInfo] = useState<PopAnchor | null>(null)
  const n = props.n
  const path = view.state.facet(editorHost)?.path() ?? ''
  const items: BarItem[] = [
    { k: 'turn', label: t('转成'), icon: 'arrow-swap', menu: true, tip: t('转成标题、列表、待办、引用…') },
    { k: 'move', label: t('移到'), icon: 'go-to-file', menu: true, tip: t('移到别的笔记') },
    { k: 'ai', label: t('问AI'), ai: true, keep: true, tip: t('把这几块一起交给 AI'), keys: keyFor('ask-ai') },
    { k: 'tidy', label: t('AI整理'), ai: true, tip: t('AI 把这几段理顺顺序、加小标题、去掉重复的：先给你看改前改后，收下才写') },
    { k: 'anki', label: t('出卡'), icon: 'symbol-event', tip: t('出卡：AI 先把这几块改成问答卡，一张张过，再送进 Anki') },
    { k: 'copy', icon: 'copy', tip: t('复制'), keys: keyFor('copy'), sep: true },
    { k: 'delete', icon: 'trash', tip: t('删除'), keys: keyFor('delete'), red: true },
    { k: 'more', icon: 'ellipsis', tip: t('更多') },
  ]
  const done = () => (setMenu(null), setInfo(null), view.focus())
  const withIdx = (f: (idx: number[]) => void) => {
    const idx = selIndices(view)
    if (idx.length) f(idx)
  }
  const pick = () =>
    withIdx((idx) => {
      const bs = drawnBlocks(view)
      const text = view.state.doc.toString()
      pickCards({ path, where: 'doc', base: text, items: idx.map((i) => ({ key: String(i), from: bs[i]!.from, to: bs[i]!.to, text: text.slice(bs[i]!.from, bs[i]!.to) })) })
    })
  const turn = (target: string) =>
    withIdx((idx) => {
      const keep = view.state.field(blockSel)
      const e = convertMdBlocks(view.state.doc.toString(), idx, target as Parameters<typeof convertMdBlocks>[2], drawnBlocks(view))
      if (!applyBlockEdit(view, e, 0, 'input.convert')) return told(view, t('这几块转不了：表格、分隔线、卡片这些没有能换的记号'), false)
      if (target !== 'callout') view.dispatch({ effects: setBlockSel.of(keep) })
      told(view, t('{what}转成了{name}：{how}，字不变', { what: idx.length > 1 ? t('这{n}块', { n: idx.length }) : t('这一块'), name: turnName(target), how: howOf(target) }))
    })
  const moveTo = async (target: string) => {
    const idx = selIndices(view)
    if (!idx.length) return
    const bs = drawnBlocks(view)
    const text = view.state.doc.toString()
    const md = selectedMarkdown(text, idx, bs)
    // 编辑器那一层（note-doc）从 noteDocRef 拿，不 import：见 note-doc-ref.ts
    const NoteDoc = noteDocRef.cls
    try {
      if (!NoteDoc) throw new Error(t('编辑器还没载入'))
      const other = [...NoteDoc.open].find((d) => d.path === target && !d.readOnly)
      if (other) {
        const v = other.view
        const t2 = v.state.doc.toString()
        const end = t2.replace(/\n+$/, '').length
        v.dispatch({ changes: { from: end, to: t2.length, insert: (end ? '\n\n' : '') + md + '\n' }, userEvent: 'input.drop' })
      } else {
        const now = (await window.cn.readNote(target)).text
        const r = await window.cn.writeNote(target, now.replace(/\n+$/, '') + (now.trim() ? '\n\n' : '') + md + '\n', now)
        if (!r.ok) throw new Error(t('《{name}》刚被别处改过，这次没挪', { name: titleOf(target) }))
      }
      applyBlockEdit(view, removeMdBlocks(text, idx, bs), 0, 'delete.move')
      await NoteDoc.saveAll()
      const msg = t('挪了{n}块到《{name}》末尾：两篇一次提交，撤回两篇一起回去', { n: idx.length, name: titleOf(target) })
      const hash = await window.cn.boardCommit([path, target], msg)
      app().refresh()
      app().noticeUndo(msg, () => {
        if (!hash) return
        void NoteDoc.saveAll().then(() => window.cn.boardRevert(hash).then(() => (app().refresh(), app().notice(t('撤回了：那几块回到了这篇')))))
      })
    } catch (e) {
      app().notice(String((e as Error).message ?? e))
    }
  }
  const act = (k: string, el?: HTMLElement, folded: string[] = []) => {
    const at = el ? anchorOf(el) : null
    if (k !== menu?.k) setMenu(null)
    setInfo(null)
    switch (k) {
      case 'turn':
      case 'move':
      case 'more':
        if (menu?.k === k) return setMenu(null)
        if (at) setMenu({ k, at, folded })
        return
      case 'ai':
        pick()
        return app().runAi()
      case 'tidy':
        pick()
        // 不翻：/ 命令的名字（AiPanel 按名字认）
        return app().runAi('/整理这几段')
      case 'anki':
        if (at) setInfo(at)
        return
      case 'copy':
        return withIdx((idx) => copySel(view, idx))
      case 'cut':
        return withIdx((idx) => copySel(view, idx, true))
      case 'delete':
        return withIdx((idx) => removeSel(view, idx))
      case 'dup':
        return withIdx((idx) => dupSel(view, idx))
      case 'indent':
        return withIdx((idx) => indentSel(view, idx, 1))
      case 'outdent':
        return withIdx((idx) => indentSel(view, idx, -1))
      case 'wrap':
        return turn('callout')
      case 'none':
        return view.dispatch({ effects: setBlockSel.of(null) })
    }
  }
  const rowsOf = (k: string, folded: string[]): MenuRow[] => {
    if (k === 'turn') return [{ head: t('转成') }, ...TURN.map(([v, icon]) => ({ v, label: turnName(v), icon }))]
    const lead: MenuRow[] = folded.flatMap((f) => {
      const it = items.find((x) => x.k === f)
      return it ? [{ v: 'fold:' + f, label: it.label ?? it.tip, ...(it.ai ? { ai: true as const } : it.icon ? { icon: it.icon } : {}), keys: it.keys }] : []
    })
    return [
      ...lead,
      ...(lead.length ? ['sep' as const] : []),
      { v: 'cut', label: t('剪切'), icon: 'screen-cut', keys: keyFor('cut') },
      { v: 'dup', label: t('复制一份'), icon: 'copy', keys: keyFor('dup-block') },
      'sep',
      { v: 'indent', label: t('缩进'), icon: 'indent', keys: 'tab' },
      { v: 'outdent', label: t('减少缩进'), icon: 'indent', keys: '⇧tab' },
      { v: 'wrap', label: t('包进提示块'), icon: 'surround-with' },
      'sep',
      { v: 'none', label: t('取消选择'), icon: 'close', keys: 'esc' },
    ]
  }
  const onPick = (v: string) => {
    const m = menu
    setMenu(null)
    view.focus()
    if (!m) return
    if (v.startsWith('fold:')) {
      const k = v.slice(5)
      return k === 'turn' || k === 'move' ? setMenu({ k, at: m.at, folded: [] }) : act(k)
    }
    if (m.k === 'turn') return turn(v)
    act(v)
  }
  const pane = view.dom.closest<HTMLElement>('.pane') ?? view.dom
  const scroller = view.dom.closest<HTMLElement>('.body') ?? view.scrollDOM
  return (
    <>
      <SelBar
        count={t('已选{n}块', { n })}
        items={view.state.readOnly ? items.filter((it) => ['ai', 'copy'].includes(it.k)) : items}
        foldOrder={FOLD}
        label={t('选中的几块')}
        testid="doc-selbar"
        hidden={props.hidden}
        open={menu?.k ?? (info ? 'anki' : null)}
        scrollers={[scroller]}
        measure={() => {
          const s = view.state.field(blockSel).ranges
          if (!s.length || !view.dom.checkVisibility()) return null
          if (s[s.length - 1]!.to > view.state.doc.length) return null
          // 和那一层选中底同一个量法（块的行框上下各宽 4）
          const top = view.documentTop + view.lineBlockAt(s[0]!.from).top - 4
          const bottom = view.documentTop + view.lineBlockAt(s[s.length - 1]!.to).bottom + 4
          const c = view.contentDOM.getBoundingClientRect()
          const p = (scroller.getBoundingClientRect().height ? scroller : pane).getBoundingClientRect()
          return { sel: { left: c.left - 8, right: c.right + 8, top, bottom }, area: { left: p.left, top: p.top, right: p.right, bottom: p.bottom } }
        }}
        onAct={(k, el, folded) => act(k, el, folded)}
      />
      {menu && menu.k !== 'move' && <SelMenu at={menu.at} label={menu.k === 'turn' ? t('转成') : t('更多')} testid={'doc-menu-' + menu.k} rows={rowsOf(menu.k, menu.folded)} onPick={onPick} onClose={done} />}
      {menu?.k === 'move' && <NotePick at={menu.at} notes={vaultFiles().filter((f) => f.kind === 'md').map((f) => ({ path: f.path, mtimeMs: f.mtimeMs }))} self={path} onPick={(p) => (done(), void moveTo(p))} onClose={done} />}
      {info && (
        <InfoCard at={info} title={t('出卡 · 这{n}块', { n })} onClose={done}>
          {t('和白板上那颗一样：AI 先把这{n}块改成问答卡，一张张过，再送进 Anki。文档里的字不改。', { n })}
        </InfoCard>
      )}
    </>
  )
}

/** 这一块被选着的几块里有没有它（把手那边用：⇧、⌘ 点把手、拖几块） */
export const inSel = (view: EditorView, b: MdBlock) => view.state.field(blockSel).ranges.some((r) => r.from >= b.from && r.from <= b.to)

const framer = ViewPlugin.fromClass(Framer)

export const blockSelect = [blockSel, selLayer, holdPointer, keys, escSelect, framer]
