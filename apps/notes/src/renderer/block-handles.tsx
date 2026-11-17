import { Codicon, type CodiconName } from '@cn/design'
import {
  type BlockEdit,
  type BlockTarget,
  blockIndexAt,
  convertible,
  convertMdBlock,
  duplicateMdBlock,
  insertMdBlockAfter,
  type MdBlock,
  moveMdBlock,
  movable,
  nearestBlock,
  removeMdBlock,
  shiftMdBlock,
  textChanges,
} from '@cn/format'
import { Prec, type Range, StateEffect, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, keymap, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { blocksField, Popover } from './editor-host'
import { openSlash } from './slash-menu'

/**
 * 文档里的块：悬停时左边留白出现「+」和拖动把手；拖把手挪整块，点把手出块菜单；⌥⇧↑↓ 上下挪。
 * 挪、删、复制、转换都是 packages/format 里的纯函数算出新文字，再按最小改动写进编辑器（一次 ⌘Z 撤回）。
 */

// ---------- 正在操作的那块：淡灰底 ----------

const hotEffect = StateEffect.define<{ from: number; to: number } | null>()

const hotField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (!e.is(hotEffect)) continue
      if (!e.value) return Decoration.none
      const out: Range<Decoration>[] = []
      const doc = tr.state.doc
      for (let n = doc.lineAt(e.value.from).number; n <= doc.lineAt(e.value.to).number; n++)
        out.push(Decoration.line({ class: 'cm-blk-hot' }).range(doc.line(n).from))
      return Decoration.set(out)
    }
    return tr.docChanged ? Decoration.none : deco
  },
  provide: (f) => EditorView.decorations.from(f),
})

/** 把算好的新文字写进编辑器：只改有差别的地方；光标放到改过的那块（加上 offset） */
export function applyBlockEdit(view: EditorView, edit: BlockEdit | null, offset = 0, userEvent = 'move.block'): boolean {
  if (!edit || view.state.readOnly) return false
  const old = view.state.doc.toString()
  if (edit.text === old) return false
  const anchor = Math.max(0, Math.min(edit.text.length, edit.at + offset))
  view.dispatch({ changes: textChanges(old, edit.text), selection: { anchor }, userEvent, scrollIntoView: true })
  return true
}

/** 光标所在的块往上 / 下挪 */
function shiftAtCursor(view: EditorView, dir: -1 | 1): boolean {
  if (view.state.readOnly) return false
  const blocks = view.state.field(blocksField)
  if (!blocks.length) return false
  const head = view.state.selection.main.head
  const i = nearestBlock(blocks, head)
  const b = blocks[i]!
  const offset = Math.max(0, Math.min(b.to - b.from, head - b.from))
  applyBlockEdit(view, shiftMdBlock(view.state.doc.toString(), i, dir, blocks), offset)
  // 挪不动（已经在最上 / 最下）也吃掉这个键，不让它变成「复制一行」
  return true
}

const blockKeys = Prec.high(
  keymap.of([
    { key: 'Alt-Shift-ArrowUp', run: (v) => shiftAtCursor(v, -1), preventDefault: true },
    { key: 'Alt-Shift-ArrowDown', run: (v) => shiftAtCursor(v, 1), preventDefault: true },
  ]),
)

// ---------- 块菜单 ----------

/** 块菜单「在源文件里改这一块」：NoteTab 接住，切到源文件并选中这一段 */
export const EDIT_SOURCE = 'cn-edit-source'

type MenuAction = 'up' | 'down' | 'dup' | 'del' | 'source' | BlockTarget

interface MenuItem {
  id: MenuAction
  label: string
  icon: CodiconName
  keys?: string
}

const ACTIONS: MenuItem[] = [
  { id: 'up', label: '上移', icon: 'arrow-up', keys: '⌥⇧↑' },
  { id: 'down', label: '下移', icon: 'arrow-down', keys: '⌥⇧↓' },
  { id: 'dup', label: '复制一份', icon: 'copy' },
  { id: 'del', label: '删除', icon: 'trash' },
  // 画成卡片的块（视频卡、时刻块、图片、数据库）在文档里不露原文：要改原文从这里去「源文件」（CN-86）
  { id: 'source', label: '在源文件里改这一块', icon: 'code' },
]

const TARGETS: MenuItem[] = [
  { id: 'paragraph', label: '正文', icon: 'whitespace' },
  { id: 'h1', label: '一级标题', icon: 'text-size' },
  { id: 'h2', label: '二级标题', icon: 'text-size' },
  { id: 'h3', label: '三级标题', icon: 'text-size' },
  { id: 'todo', label: '待办', icon: 'checklist' },
  { id: 'quote', label: '引用', icon: 'quote' },
  { id: 'code', label: '代码', icon: 'code' },
]

function BlockMenu(props: { block: MdBlock; canUp: boolean; canDown: boolean; onPick(a: MenuAction): void; onClose(): void }) {
  const items = [
    ...ACTIONS.filter((a) => (a.id === 'up' ? props.canUp : a.id === 'down' ? props.canDown : true)),
    ...(convertible(props.block) ? TARGETS : []),
  ]
  const firstTarget = items.findIndex((x) => TARGETS.includes(x))
  const [idx, setIdx] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => ref.current?.focus(), [])
  return (
    <div
      ref={ref}
      className="blk-menu"
      role="menu"
      aria-label="块菜单"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          const d = e.key === 'ArrowDown' ? 1 : -1
          setIdx((i) => (i + d + items.length) % items.length)
        } else if (e.key === 'Enter') {
          e.preventDefault()
          props.onPick(items[idx]!.id)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          props.onClose()
        }
      }}
    >
      {items.map((it, k) => (
        <div key={it.id} role="none">
          {k === firstTarget && <div className="blk-sep">转换成</div>}
          <button
            role="menuitem"
            className={k === idx ? 'on' : ''}
            onMouseEnter={() => setIdx(k)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => props.onPick(it.id)}
          >
            <Codicon name={it.icon} size={14} />
            <span className="lb">{it.label}</span>
            {it.keys && <kbd>{it.keys}</kbd>}
          </button>
        </div>
      ))}
    </div>
  )
}

// ---------- 把手 ----------

const DRAG_START_PX = 4

class Handles {
  private bar: HTMLDivElement
  private barRoot: Root
  private drop: HTMLDivElement
  private host: HTMLElement
  private menu: Popover | null = null
  /** 现在把手对着的块 */
  private index = -1
  private drag: { index: number; x: number; y: number; started: boolean; to: number } | null = null
  private leaveTimer: ReturnType<typeof setTimeout> | undefined

  constructor(readonly view: EditorView) {
    this.host = view.dom.parentElement ?? view.dom
    this.bar = document.createElement('div')
    this.bar.className = 'blk-bar'
    this.bar.hidden = true
    this.barRoot = createRoot(this.bar)
    flushSync(() =>
      this.barRoot.render(
        <>
          <button className="blk-add" tabIndex={-1} aria-label="在下面加一块" title="在下面加一块" onMouseDown={(e) => e.preventDefault()} onClick={() => this.add()}>
            <Codicon name="add" size={14} />
          </button>
          <button
            className="blk-grip"
            tabIndex={-1}
            aria-label="拖动挪块，点一下出菜单"
            title="拖动挪块，点一下出菜单"
            onMouseDown={(e) => this.gripDown(e.nativeEvent)}
          >
            <Codicon name="gripper" size={14} />
          </button>
        </>,
      ),
    )
    this.drop = document.createElement('div')
    this.drop.className = 'blk-drop'
    this.drop.hidden = true
    view.dom.append(this.bar, this.drop)
    this.host.addEventListener('mousemove', this.onHover)
    this.host.addEventListener('mouseleave', this.onLeave)
  }

  update(u: ViewUpdate) {
    // 打字时把手先藏起来，鼠标再动才出来（外部改动合并进来时不藏）
    const typed = u.transactions.some((tr) => tr.isUserEvent('input') || tr.isUserEvent('delete'))
    if (typed && !this.drag && !this.menu?.open) this.hideBar()
    else if (u.docChanged && !this.bar.hidden) {
      // 块的位置变了：量好再按新位置重摆（这块没了就藏起来）
      this.view.requestMeasure({
        key: this,
        read: () => null,
        write: () => {
          if (this.bar.hidden) return
          if (this.index >= 0 && this.index < this.blocks.length && movable(this.blocks[this.index]!)) this.showBar(this.index)
          else this.hideBar()
        },
      })
    }
  }

  destroy() {
    this.host.removeEventListener('mousemove', this.onHover)
    this.host.removeEventListener('mouseleave', this.onLeave)
    clearTimeout(this.leaveTimer)
    this.endDrag()
    this.closeMenu(false)
    const root = this.barRoot
    queueMicrotask(() => root.unmount())
    this.bar.remove()
    this.drop.remove()
  }

  private get blocks() {
    return this.view.state.field(blocksField)
  }

  private onHover = (e: MouseEvent) => {
    clearTimeout(this.leaveTimer)
    if (this.drag || this.menu?.open || this.view.state.readOnly) return
    if (this.bar.contains(e.target as Node)) return
    const content = this.view.contentDOM.getBoundingClientRect()
    if (e.clientY < content.top || e.clientY > content.bottom) return this.hideBar()
    const x = Math.max(content.left + 2, Math.min(content.right - 2, e.clientX))
    const pos = this.view.posAtCoords({ x, y: e.clientY }, false)
    let i = blockIndexAt(this.blocks, pos)
    // 落在块和块之间的空行上：算离得近的那块，把手不会一闪一闪
    if (i === -1) i = this.nearestByY(e.clientY - this.view.documentTop)
    const b = this.blocks[i]
    if (!b || !movable(b)) return this.hideBar()
    this.showBar(i)
  }

  /** 鼠标离开正文后过一会儿再藏，划过留白去点把手时不会先没了 */
  private onLeave = (e: MouseEvent) => {
    if (this.drag || this.menu?.open) return
    if (e.relatedTarget && this.bar.contains(e.relatedTarget as Node)) return
    clearTimeout(this.leaveTimer)
    this.leaveTimer = setTimeout(() => {
      if (!this.drag && !this.menu?.open && !this.bar.matches(':hover')) this.hideBar()
    }, 300)
  }

  /** 块第一行在 view.dom 里的上下位置 */
  private firstLineBox(b: MdBlock): { top: number; height: number } {
    const dom = this.view.dom.getBoundingClientRect()
    const c = b.kind === 'table' || b.kind === 'image' ? null : this.view.coordsAtPos(b.from, 1)
    if (c) return { top: c.top - dom.top, height: c.bottom - c.top }
    const lb = this.view.lineBlockAt(b.from)
    return { top: this.view.documentTop - dom.top + lb.top + 4, height: 24 }
  }

  private showBar(i: number) {
    const b = this.blocks[i]!
    this.index = i
    const { top, height } = this.firstLineBox(b)
    this.bar.style.top = Math.round(top + height / 2 - 12) + 'px'
    this.bar.hidden = false
    this.bar.dataset.kind = b.kind
  }

  private hideBar() {
    this.bar.hidden = true
    this.index = -1
  }

  private setHot(b: MdBlock | null) {
    this.view.dispatch({ effects: hotEffect.of(b ? { from: b.from, to: b.to } : null) })
  }

  // ----- + 号：下面加一块，打开 / 菜单 -----

  private add() {
    const i = this.index
    if (i < 0 || this.view.state.readOnly) return
    const edit = insertMdBlockAfter(this.view.state.doc.toString(), i, '/', this.blocks)
    this.hideBar()
    this.view.focus()
    applyBlockEdit(this.view, edit, 1, 'input.block')
    this.view.dispatch({ effects: openSlash.of({ from: edit.at, plus: true }) })
  }

  // ----- 拖动 -----

  private gripDown(e: MouseEvent) {
    if (e.button !== 0 || this.index < 0) return
    e.preventDefault()
    this.drag = { index: this.index, x: e.clientX, y: e.clientY, started: false, to: -1 }
    window.addEventListener('mousemove', this.onDragMove)
    window.addEventListener('mouseup', this.onDragUp)
    window.addEventListener('keydown', this.onDragKey, true)
  }

  private onDragMove = (e: MouseEvent) => {
    const d = this.drag
    if (!d) return
    if (!d.started) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_START_PX) return
      d.started = true
      this.view.dom.classList.add('blk-dragging')
      this.setHot(this.blocks[d.index]!)
    }
    this.autoScroll(e.clientY)
    d.to = this.dropIndex(e.clientY)
    const valid = d.to !== -1 && d.to !== d.index && d.to !== d.index + 1
    this.drop.hidden = !valid
    if (valid) this.drop.style.top = Math.round(this.gapY(d.to) + this.view.documentTop - this.view.dom.getBoundingClientRect().top - 1) + 'px'
  }

  private onDragUp = () => {
    const d = this.drag
    this.endDrag()
    if (!d) return
    if (!d.started) {
      this.openMenu(d.index)
      return
    }
    this.setHot(null)
    applyBlockEdit(this.view, moveMdBlock(this.view.state.doc.toString(), d.index, d.to, this.blocks))
    this.view.focus()
  }

  private onDragKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    this.endDrag()
    this.setHot(null)
  }

  private endDrag() {
    window.removeEventListener('mousemove', this.onDragMove)
    window.removeEventListener('mouseup', this.onDragUp)
    window.removeEventListener('keydown', this.onDragKey, true)
    this.view.dom.classList.remove('blk-dragging')
    this.drop.hidden = true
    this.drag = null
  }

  /** 上下离 y（文档坐标）最近的块 */
  private nearestByY(y: number): number {
    let best = -1
    let dist = Infinity
    this.blocks.forEach((b, k) => {
      const top = this.view.lineBlockAt(b.from).top
      const bottom = this.view.lineBlockAt(b.to).bottom
      const d = y < top ? top - y : y > bottom ? y - bottom : 0
      if (d < dist) {
        dist = d
        best = k
      }
    })
    return best
  }

  /** 第 k 块前面那道缝的高度（文档坐标） */
  private gapY(k: number): number {
    const bs = this.blocks
    const top = (b: MdBlock) => this.view.lineBlockAt(b.from).top
    const bottom = (b: MdBlock) => this.view.lineBlockAt(b.to).bottom
    if (k <= 0) return top(bs[0]!)
    if (k >= bs.length) return bottom(bs[bs.length - 1]!) + 4
    return (bottom(bs[k - 1]!) + top(bs[k]!)) / 2
  }

  /** 松手会落在第几块前面 */
  private dropIndex(clientY: number): number {
    const bs = this.blocks
    const y = clientY - this.view.documentTop
    let best = -1
    let dist = Infinity
    for (let k = bs[0]?.kind === 'frontmatter' ? 1 : 0; k <= bs.length; k++) {
      const dd = Math.abs(this.gapY(k) - y)
      if (dd < dist) {
        dist = dd
        best = k
      }
    }
    return best
  }

  private autoScroll(clientY: number) {
    const sc = this.host.closest<HTMLElement>('.body') ?? this.view.scrollDOM
    const r = sc.getBoundingClientRect()
    if (clientY < r.top + 40) sc.scrollTop -= 14
    else if (clientY > r.bottom - 40) sc.scrollTop += 14
  }

  // ----- 块菜单 -----

  private onOutside = (e: MouseEvent) => {
    if (this.menu?.el.contains(e.target as Node) || this.bar.contains(e.target as Node)) return
    this.closeMenu(false)
  }

  /** 菜单开着时 Esc 一定关菜单（焦点不在菜单上也一样），别的地方收不到这个键 */
  private onEscape = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    this.closeMenu(true)
  }

  private openMenu(i: number) {
    const b = this.blocks[i]
    if (!b) return
    this.menu ??= new Popover('blk-pop')
    this.setHot(b)
    const first = this.blocks[0]?.kind === 'frontmatter' ? 1 : 0
    const r = this.bar.getBoundingClientRect()
    this.menu.show(
      <BlockMenu
        key={Date.now()}
        block={b}
        canUp={i > first}
        canDown={i < this.blocks.length - 1}
        onPick={(a) => this.run(i, a)}
        onClose={() => this.closeMenu(true)}
      />,
      { left: r.left, top: r.top, bottom: r.bottom },
    )
    document.addEventListener('mousedown', this.onOutside, true)
    window.addEventListener('keydown', this.onEscape, true)
  }

  private closeMenu(focus: boolean) {
    document.removeEventListener('mousedown', this.onOutside, true)
    window.removeEventListener('keydown', this.onEscape, true)
    if (!this.menu?.open) return
    this.menu.hide()
    this.hideBar()
    this.setHot(null)
    if (focus) this.view.focus()
  }

  private run(i: number, a: MenuAction) {
    const text = this.view.state.doc.toString()
    const bs = this.blocks
    this.closeMenu(true)
    if (a === 'source') {
      const b = bs[i]
      if (b) this.view.dom.dispatchEvent(new CustomEvent(EDIT_SOURCE, { bubbles: true, detail: { from: b.from, to: b.to } }))
      return
    }
    const edit =
      a === 'up'
        ? shiftMdBlock(text, i, -1, bs)
        : a === 'down'
          ? shiftMdBlock(text, i, 1, bs)
          : a === 'dup'
            ? duplicateMdBlock(text, i, bs)
            : a === 'del'
              ? removeMdBlock(text, i, bs)
              : convertMdBlock(text, i, a, bs)
    applyBlockEdit(this.view, edit, 0, a === 'del' ? 'delete.block' : 'move.block')
  }
}

const handles = ViewPlugin.fromClass(Handles)

export const blockHandles = [hotField, blockKeys, handles]
