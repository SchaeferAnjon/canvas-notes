import { Codicon, type CodiconName } from '@cn/design'
import { isKey, keyFor } from './keys'
import {
  aiBlockAt,
  type BlockEdit,
  blockIndexAt,
  convertible,
  convertMdBlock,
  duplicateMdBlock,
  type MdBlock,
  moveMdBlock,
  moveMdBlocks,
  movable,
  nearestBlock,
  plainOf,
  removeMdBlock,
  shiftMdBlock,
  textChanges,
  wrapRange,
} from '@cn/format'
import { Prec, type Range, StateEffect, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, keymap, layer, RectangleMarker, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { cardMarker } from './atomic-blocks'
import { blockSel, inSel, selectBlocks, selIndices, setBlockSel } from './block-select'
import { undo } from '@codemirror/commands'
import { openRaw } from './block-source'
import { markAi, makeMine } from './ai-mark'
import { AiIcon } from './engine-logo'
import { app } from './ctx/actions'
import { drawnBlocks, Popover } from './editor-host'
import { hiddenOk } from './hidden-syntax'
import { openPlus, slashLine } from './slash-menu'
import { openTail, tailPending } from './tail-line'
import { t as tNow } from '../shared/i18n'
import { useT } from './i18n'

/**
 * 文档里的块（DESIGN.v3 6.2、6.4）：悬停时左边 56 的槽里出现「+」和拖动把手（六个点），各带一条深色提示；
 * 点「+」弹插入菜单（文档里不写「/」，CN-107）；拖把手挪整块（原块变淡、拖影跟着鼠标、落点线），点把手出块菜单
 * 「转成标题 / 转成待办 / 转成引用 | 复制一块 ⌘D / 问 AI 这一块 / 删除 ⌫」，弹在把手右边。
 * 画成一整块的东西（图片、视频卡、时刻块、表格、数据库）菜单上面一组换成「改写法」（只在这一块露出写法，block-source.tsx）。
 * 文末那一行（tail-line.ts）也一样有「+ ⋮⋮」。⌥⇧↑↓ 上下挪光标所在的块，⌘D 复制它。
 * 挪、删、复制、转换都是 packages/format 里的纯函数算出新文字，再按最小改动写进编辑器（一次 ⌘Z 撤回）。
 */

// ---------- 正在操作的那块：淡色底；拖着时变淡 ----------

const hotEffect = StateEffect.define<{ from: number; to: number; ghost?: boolean } | null>()

const hotField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (!e.is(hotEffect)) continue
      if (!e.value) return Decoration.none
      const out: Range<Decoration>[] = []
      const doc = tr.state.doc
      const cls = 'cm-blk-hot' + (e.value.ghost ? ' cm-blk-ghosted' : '')
      for (let n = doc.lineAt(e.value.from).number; n <= doc.lineAt(e.value.to).number; n++) out.push(Decoration.line({ class: cls }).range(doc.line(n).from))
      return Decoration.set(out)
    }
    return tr.docChanged ? Decoration.none : deco
  },
  provide: (f) => EditorView.decorations.from(f),
})

/**
 * 正在开菜单、正在拖的那一块的选中底：盖在上面一层强调色 24%，和退格选中整块一个样子（task-qkx1j；以前画在字底下、--acc-soft，卡有底色看不出）。
 * 块部件（数据库、图片……）大小、圆角跟卡自己；文字块比版心左右各宽出 8、上下各 4（.cm-scroller 让出了左右 8）。拖着时字变淡、这层不淡
 */
const hotLayer = layer({
  above: true,
  class: 'cm-blkHotLayer',
  markers(view) {
    let from = -1
    let to = -1
    view.state.field(hotField).between(0, view.state.doc.length, (f) => {
      if (from < 0) from = f
      to = f
    })
    if (from < 0) return []
    const card = cardMarker(view, from, 'cm-blk-hotbg')
    if (card) return [card]
    const sc = view.scrollDOM.getBoundingClientRect()
    const content = view.contentDOM.getBoundingClientRect()
    const baseLeft = sc.left - view.scrollDOM.scrollLeft
    const baseTop = sc.top - view.scrollDOM.scrollTop
    const top = view.documentTop + view.lineBlockAt(from).top - baseTop - 4
    const bottom = view.documentTop + view.lineBlockAt(to).bottom - baseTop + 4
    return [new RectangleMarker('cm-blk-hotbg', content.left - baseLeft - 8, top, content.width + 16, bottom - top)]
  },
  update: (u) => u.docChanged || u.geometryChanged || u.startState.field(hotField) !== u.state.field(hotField),
})

// ---------- 松手后那一块外圈闪一次 --acc-ring ----------

const flashEffect = StateEffect.define<{ from: number; to: number } | null>()
const flashField = StateField.define<{ from: number; to: number } | null>({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(flashEffect)) return e.value
    return v && tr.docChanged ? { from: tr.changes.mapPos(v.from, 1), to: tr.changes.mapPos(v.to, -1) } : v
  },
})

/** 一整块一个外圈（不按行画，几行叠起来不会是几道横线） */
const flashLayer = layer({
  above: true,
  class: 'cm-blkFlashLayer',
  markers(view) {
    const r = view.state.field(flashField)
    if (!r || r.to > view.state.doc.length) return []
    const sc = view.scrollDOM.getBoundingClientRect()
    const content = view.contentDOM.getBoundingClientRect()
    const baseLeft = sc.left - view.scrollDOM.scrollLeft
    const baseTop = sc.top - view.scrollDOM.scrollTop
    const top = view.documentTop + view.lineBlockAt(r.from).top - baseTop
    const bottom = view.documentTop + view.lineBlockAt(r.to).bottom - baseTop
    return [new RectangleMarker('cm-blk-flash', content.left - baseLeft - 8, top, content.width + 16, bottom - top)]
  },
  update: (u) => u.docChanged || u.geometryChanged || u.transactions.some((t) => t.effects.some((e) => e.is(flashEffect))),
})

function flashBlock(view: EditorView, from: number, to: number) {
  view.dispatch({ effects: flashEffect.of({ from, to }) })
  setTimeout(() => {
    if (view.state.field(flashField, false)) view.dispatch({ effects: flashEffect.of(null) })
  }, 900)
}

/** 把算好的新文字写进编辑器：只改有差别的地方；光标放到改过的那块（加上 offset） */
export function applyBlockEdit(view: EditorView, edit: BlockEdit | null, offset = 0, userEvent = 'move.block'): boolean {
  if (!edit || view.state.readOnly) return false
  const old = view.state.doc.toString()
  if (edit.text === old) return false
  const anchor = Math.max(0, Math.min(edit.text.length, edit.at + offset))
  view.dispatch({ changes: textChanges(old, edit.text), selection: { anchor }, userEvent, scrollIntoView: true, annotations: hiddenOk.of(true) })
  return true
}

/** 光标所在的块往上 / 下挪 */
function shiftAtCursor(view: EditorView, dir: -1 | 1): boolean {
  if (view.state.readOnly) return false
  const blocks = drawnBlocks(view)
  if (!blocks.length) return false
  const head = view.state.selection.main.head
  const i = nearestBlock(blocks, head)
  const b = blocks[i]!
  const offset = Math.max(0, Math.min(b.to - b.from, head - b.from))
  applyBlockEdit(view, shiftMdBlock(view.state.doc.toString(), i, dir, blocks), offset)
  // 挪不动（已经在最上 / 最下）也吃掉这个键，不让它变成「复制一行」
  return true
}

/** ⌘D：光标所在的块复制一份放在它下面（块菜单「复制一块」的快捷键） */
function duplicateAtCursor(view: EditorView): boolean {
  if (view.state.readOnly) return false
  const blocks = drawnBlocks(view)
  if (!blocks.length) return true
  const i = nearestBlock(blocks, view.state.selection.main.head)
  applyBlockEdit(view, duplicateMdBlock(view.state.doc.toString(), i, blocks), 0, 'input.block')
  return true
}

const blockKeys = Prec.high(
  keymap.of([
    // 键照命令表（设置 › 快捷键里能改）
    { any: (v, e) => isKey(e, 'block-up') && (shiftAtCursor(v, -1), true) },
    { any: (v, e) => isKey(e, 'block-down') && (shiftAtCursor(v, 1), true) },
    { any: (v, e) => isKey(e, 'dup-block') && duplicateAtCursor(v) },
  ]),
)

/** 这一块是不是画成一整块的东西（图片、视频卡、时刻块、表格、数据库）：它的写法藏着，菜单给「改写法」 */
function drawnWhole(view: EditorView, b: MdBlock): { from: number; to: number } | null {
  let hit: { from: number; to: number } | null = null
  for (const f of view.state.facet(EditorView.atomicRanges)) {
    f(view).between(b.from, b.to, (from, to, d) => {
      if (!hit && d.spec.block && d.spec.widget && from >= b.from && to <= b.to) hit = { from, to }
    })
    if (hit) return hit
  }
  return null
}

// ---------- 块菜单 ----------

type MenuAction = 'h2' | 'todo' | 'quote' | 'raw' | 'up' | 'down' | 'dup' | 'ai' | 'del' | 'mine' | 'markai'

interface MenuItem {
  id: MenuAction
  label: string
  icon: CodiconName
  /** 交给 AI 对话那一家跑：画它的标志 */
  ai?: true
  /** 右边写它的快捷键（命令表里的 id） */
  cmd?: string
  /** 这一行灰掉（文末那一行还没有字：复制、问 AI、删除都没东西可做） */
  off?: boolean
}

// 不翻：块菜单的字是键，画的地方翻（t(label, { ctx: '块菜单' })）
const CONVERT: MenuItem[] = [
  { id: 'h2', label: '转成标题', icon: 'symbol-keyword' }, // 不翻
  { id: 'todo', label: '转成待办', icon: 'checklist' }, // 不翻
  { id: 'quote', label: '转成引用', icon: 'quote' }, // 不翻
]
const RAW: MenuItem[] = [{ id: 'raw', label: '改写法', icon: 'code' }] // 不翻
/** AI 块（task-dtc34）：AI 块上是「变成我的字」，普通的段落、列表、引用上是「标成 AI 写的」 */
const mineItem = (): MenuItem => ({ id: 'mine', label: '变成我的字', icon: 'account' }) // 不翻：块菜单的字是键，画的地方翻
const markAiItem = (): MenuItem => ({ id: 'markai', label: '标成 AI 写的', icon: 'comment-discussion' }) // 不翻：块菜单的字是键，画的地方翻
// 上移、下移（task-xy89o）：以前只有 ⌥⇧↑↓、拖把手，菜单里翻不到
const ACTIONS: MenuItem[] = [
  { id: 'up', label: '上移', icon: 'arrow-up', cmd: 'block-up' }, // 不翻
  { id: 'down', label: '下移', icon: 'arrow-down', cmd: 'block-down' }, // 不翻
  { id: 'dup', label: '复制一块', icon: 'copy', cmd: 'dup-block' }, // 不翻
  { id: 'ai', label: '问 AI 这一块', icon: 'comment-discussion', ai: true }, // 不翻
  { id: 'del', label: '删除', icon: 'trash', cmd: 'delete' }, // 不翻
]

/** first、last：这一块已经在最上、最下（上移、下移灰掉） */
function BlockMenu(props: { top: MenuItem[]; tail: boolean; first?: boolean; last?: boolean; onPick(a: MenuAction): void; onClose(): void }) {
  const t = useT()
  const items = [...props.top, ...ACTIONS.map((a) => (props.tail || (a.id === 'up' && props.first) || (a.id === 'down' && props.last) ? { ...a, off: true } : a))]
  const live = items.filter((x) => !x.off)
  // 照小样：刚弹出来哪一行都不亮，鼠标移上去、按 ↑↓ 才亮
  const [idx, setIdx] = useState(-1)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => ref.current?.focus(), [])
  const cur = live[idx]
  return (
    <div
      ref={ref}
      className="blk-menu"
      role="menu"
      aria-label={t('块菜单')}
      tabIndex={-1}
      onMouseLeave={() => setIdx(-1)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          const d = e.key === 'ArrowDown' ? 1 : -1
          setIdx((i) => (i < 0 ? (d > 0 ? 0 : live.length - 1) : (i + d + live.length) % live.length))
        } else if (e.key === 'Enter') {
          e.preventDefault()
          if (cur) props.onPick(cur.id)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          props.onClose()
        } else if ((e.key === 'Backspace' || e.key === 'Delete') && !props.tail) {
          // 菜单开着按 ⌫：删掉这一块（菜单上写着的快捷键）
          e.preventDefault()
          props.onPick('del')
        } else if (isKey(e, 'dup-block') && !props.tail) {
          e.preventDefault()
          props.onPick('dup')
        } else if (isKey(e, 'block-up') && !props.tail && !props.first) {
          e.preventDefault()
          props.onPick('up')
        } else if (isKey(e, 'block-down') && !props.tail && !props.last) {
          e.preventDefault()
          props.onPick('down')
        }
      }}
    >
      {items.map((it, k) => (
        <div key={it.id} role="none">
          {k === props.top.length && <div className="blk-sep" role="separator" />}
          <button
            role="menuitem"
            aria-disabled={it.off || undefined}
            className={(cur === it ? 'on' : '') + (it.off ? ' off' : '')}
            onMouseEnter={() => !it.off && setIdx(live.indexOf(it))}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => !it.off && props.onPick(it.id)}
          >
            {it.ai ? <AiIcon job="chat" size={14} /> : <Codicon name={it.icon} size={14} />}
            <span className="lb">{t(it.label, { ctx: '块菜单' })}</span>
            {it.cmd && keyFor(it.cmd) && <kbd>{keyFor(it.cmd)}</kbd>}
          </button>
        </div>
      ))}
    </div>
  )
}

// ---------- 加号和把手的深色提示条（DESIGN.v3 6.2：悬停 0.4 秒，贴在按钮下面 6） ----------

class DarkTip {
  readonly el: HTMLDivElement
  private timer: ReturnType<typeof setTimeout> | undefined
  constructor() {
    this.el = document.createElement('div')
    this.el.className = 'blk-tip'
    this.el.setAttribute('role', 'tooltip')
    this.el.dataset.testid = 'blk-tip'
    this.el.hidden = true
    document.body.appendChild(this.el)
  }
  show(btn: HTMLElement, text: string) {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      if (!btn.isConnected || !btn.matches(':hover')) return
      const r = btn.getBoundingClientRect()
      this.el.textContent = text
      this.el.style.left = Math.round(r.left - 4) + 'px'
      this.el.style.top = Math.round(r.bottom + 6) + 'px'
      this.el.hidden = false
    }, 400)
  }
  hide() {
    clearTimeout(this.timer)
    this.el.hidden = true
  }
  destroy() {
    this.hide()
    this.el.remove()
  }
}

// ---------- 把手 ----------

const DRAG_START_PX = 4
/** 文末那一行（不在文件里）：把手对着它时的「块号」 */
const TAIL = -2

class Handles {
  private bar: HTMLDivElement
  private barRoot: Root
  private drop: HTMLDivElement
  private host: HTMLElement
  private menu: Popover | null = null
  private tip = new DarkTip()
  /** 拖着的时候跟着鼠标的拖影 */
  private ghost: HTMLDivElement | null = null
  /** 现在把手对着的块（TAIL：文末那一行） */
  private index = -1
  /** group：拖的是选着的几块里的一块，几块一起挪（task-5ryf9）；shift、meta：按下把手时按着 ⇧、⌘（不动松手是连选、加减） */
  private drag: { index: number; x: number; y: number; started: boolean; to: number; faded: HTMLElement[]; group?: number[]; shift?: boolean; meta?: boolean } | null = null
  /** 上一次点把手打开菜单的那一块（⇧ 点另一块的把手从它连过去） */
  private lastClicked: number | null = null
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
          <button
            className="blk-add"
            tabIndex={-1}
            aria-label={tNow('插入块')}
            onMouseEnter={(e) => this.tip.show(e.currentTarget, tNow('点一下插入块 · 也可以打 /'))}
            onMouseLeave={() => this.tip.hide()}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => this.add()}
          >
            <Codicon name="add" size={16} />
          </button>
          <button
            className="blk-grip"
            tabIndex={-1}
            aria-label={tNow('拖动挪位置，点一下打开菜单')}
            onMouseEnter={(e) => this.tip.show(e.currentTarget, tNow('拖动挪位置 · 点一下打开菜单'))}
            onMouseLeave={() => this.tip.hide()}
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
    // 打 / 那一行、点「+」开着菜单的那一块：左边照样出「+ ⋮⋮」（DESIGN.v3 6.3）
    const sl = slashLine(u.state)
    if (sl && !this.drag) {
      const at = this.slashIndex(sl)
      if (at !== null) {
        // 量位置要在 read 里（更新途中不许读排版），摆放在 write 里
        this.view.requestMeasure({ key: this, read: () => this.barTop(at), write: (top) => (top === null ? this.hideBar() : this.placeBar(at, top)) })
        return
      }
    }
    // 打字时把手先藏起来，鼠标再动才出来（外部改动合并进来时不藏）
    const typed = u.transactions.some((tr) => tr.isUserEvent('input') || tr.isUserEvent('delete'))
    if (typed && !this.drag && !this.menu?.open) this.hideBar()
    else if ((u.docChanged || u.geometryChanged) && !this.bar.hidden) {
      // 块的位置变了：量好再按新位置重摆（这块没了就藏起来）
      const at = this.index
      this.view.requestMeasure({
        key: this,
        read: () => (at === TAIL || (at >= 0 && at < this.blocks.length && movable(this.blocks[at]!)) ? this.barTop(at) : null),
        write: (top) => {
          if (this.bar.hidden) return
          if (top === null) this.hideBar()
          else this.placeBar(at, top)
        },
      })
    }
  }

  /** 打 / 的那一行、「+」开着菜单的那一块是第几块 */
  private slashIndex(sl: NonNullable<ReturnType<typeof slashLine>>): number | null {
    if (sl.plus) return 'tail' in sl.plus ? (this.tailEl() ? TAIL : null) : sl.plus.block
    const p = this.view.state.field(tailPending)
    const line = this.view.state.doc.lineAt(sl.from)
    if (p && line.from === this.view.state.doc.lineAt(Math.min(p.at, this.view.state.doc.length)).from) return null
    const i = blockIndexAt(this.blocks, sl.from)
    return i === -1 ? null : i
  }

  destroy() {
    this.host.removeEventListener('mousemove', this.onHover)
    this.host.removeEventListener('mouseleave', this.onLeave)
    clearTimeout(this.leaveTimer)
    this.endDrag()
    this.closeMenu(false)
    this.tip.destroy()
    const root = this.barRoot
    queueMicrotask(() => root.unmount())
    this.bar.remove()
    this.drop.remove()
  }

  private get blocks() {
    return drawnBlocks(this.view)
  }

  private tailEl(): HTMLElement | null {
    return this.view.dom.querySelector<HTMLElement>('.cm-tailline')
  }

  private onHover = (e: MouseEvent) => {
    clearTimeout(this.leaveTimer)
    if (this.drag || this.menu?.open || this.view.state.readOnly || slashLine(this.view.state)) return
    if (this.bar.contains(e.target as Node)) return
    // 文末那一行（和它左边的槽）
    const tail = this.tailEl()
    if (tail) {
      const r = tail.getBoundingClientRect()
      const line = tail.closest('.cm-line') ?? tail
      const lr = line.getBoundingClientRect()
      if (e.clientY >= Math.min(r.top, lr.top) && e.clientY <= Math.max(r.bottom, lr.bottom)) return this.showBar(TAIL)
    }
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
      if (!this.drag && !this.menu?.open && !this.bar.matches(':hover') && !slashLine(this.view.state)) this.hideBar()
    }, 300)
  }

  /** 块第一行在 view.dom 里的上下位置 */
  private firstLineBox(b: MdBlock): { top: number; height: number } {
    const dom = this.view.dom.getBoundingClientRect()
    const c = b.kind === 'table' || b.kind === 'image' ? null : this.view.coordsAtPos(b.from, 1)
    // 画成一整张卡的块（数据库、时刻块…）：coordsAtPos 给的是整张卡；对齐卡头那一行（38 高），不对齐整张卡的正中（改写法打开时会掉到卡中间）
    if (c) return { top: c.top - dom.top, height: Math.min(c.bottom - c.top, 38) }
    const lb = this.view.lineBlockAt(b.from)
    return { top: this.view.documentTop - dom.top + lb.top + 4, height: 24 }
  }

  /** 把手该摆多高（相对 view.dom）；只读排版 */
  private barTop(i: number): number | null {
    const dom = this.view.dom.getBoundingClientRect()
    if (i === TAIL) {
      const t = this.tailEl()
      if (!t) return null
      const ph = (t.querySelector('.cm-tail-ph') ?? t).getBoundingClientRect()
      return Math.round(ph.top - dom.top + ph.height / 2 - 12)
    }
    const b = this.blocks[i]
    if (!b) return null
    const { top, height } = this.firstLineBox(b)
    return Math.round(top + height / 2 - 12)
  }

  /** 摆把手；只写 DOM */
  private placeBar(i: number, top: number) {
    this.index = i
    this.bar.style.top = top + 'px'
    this.bar.hidden = false
    this.bar.dataset.kind = i === TAIL ? 'tail' : (this.blocks[i]?.kind ?? '')
  }

  private showBar(i: number) {
    const top = this.barTop(i)
    if (top === null) return this.hideBar()
    this.placeBar(i, top)
  }

  private hideBar() {
    this.bar.hidden = true
    this.index = -1
    this.tip.hide()
  }

  private setHot(b: { from: number; to: number } | null, ghost = false) {
    this.view.dispatch({ effects: hotEffect.of(b ? { from: b.from, to: b.to, ghost } : null) })
  }

  // ----- + 号：弹插入菜单（文档里不写「/」，选了才新起一块） -----

  private add() {
    const i = this.index
    if (i === -1 || this.view.state.readOnly) return
    this.tip.hide()
    this.view.focus()
    openPlus(this.view, i === TAIL ? { tail: true } : { block: i })
  }

  // ----- 拖动 -----

  private gripDown(e: MouseEvent) {
    if (e.button !== 0 || this.index === -1) return
    e.preventDefault()
    this.tip.hide()
    this.drag = { index: this.index, x: e.clientX, y: e.clientY, started: false, to: -1, faded: [], shift: e.shiftKey, meta: e.metaKey || e.ctrlKey }
    window.addEventListener('mousemove', this.onDragMove)
    window.addEventListener('mouseup', this.onDragUp)
    window.addEventListener('keydown', this.onDragKey, true)
  }

  /** 选着两块起、点的是其中一块的把手：选中不变（不出块菜单） */
  private keepsGroup(i: number): boolean {
    const b = this.blocks[i]
    return !!b && this.view.state.field(blockSel).ranges.length >= 2 && inSel(this.view, b)
  }

  /** ⇧ 点把手：从上次选的那块连到这块；⌘ 点把手：加减这一块（task-5ryf9，照 Notion、访达） */
  private pickWith(i: number, shift: boolean, meta: boolean) {
    const bs = this.blocks
    const b = bs[i]
    if (!b) return
    const sel = this.view.state.field(blockSel)
    if (!shift && !meta) return
    if (shift) {
      const from = sel.anchor ?? this.lastClicked ?? bs[nearestBlock(bs, this.view.state.selection.main.head)]?.from ?? b.from
      const a = Math.max(0, bs.findIndex((x) => x.from <= from && from <= x.to))
      selectBlocks(this.view, bs.slice(Math.min(a, i), Math.max(a, i) + 1).filter(movable), bs[a]!.from)
    } else {
      const have = sel.ranges.length ? sel.ranges : this.lastClicked !== null ? bs.filter((x) => x.from === this.lastClicked).map((x) => ({ from: x.from, to: x.to })) : []
      const on = have.some((r) => r.from >= b.from && r.from <= b.to)
      const next = on ? have.filter((r) => !(r.from >= b.from && r.from <= b.to)) : [...have, { from: b.from, to: b.to }].sort((x, y) => x.from - y.from)
      this.view.dispatch({ effects: setBlockSel.of(next.length ? { ranges: next, anchor: b.from } : null) })
    }
    this.lastClicked = b.from
    this.view.focus()
  }

  /** 这一块在正文里的那几个元素（行、块部件），拖着时变淡 */
  private blockEls(b: MdBlock): HTMLElement[] {
    const out: HTMLElement[] = []
    for (const el of Array.from(this.view.contentDOM.children) as HTMLElement[]) {
      let pos: number
      try {
        pos = this.view.posAtDOM(el, 0)
      } catch {
        continue
      }
      if (pos >= b.from && pos <= b.to) out.push(el)
    }
    return out
  }

  private onDragMove = (e: MouseEvent) => {
    const d = this.drag
    if (!d) return
    if (!d.started) {
      if (d.index === TAIL) return
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_START_PX) return
      d.started = true
      this.view.dom.classList.add('blk-dragging')
      const b = this.blocks[d.index]!
      // 拖的是选着的几块里的一块：几块一起走（task-5ryf9），拖影写「N块」
      const idx = selIndices(this.view)
      if (idx.length >= 2 && idx.includes(d.index)) d.group = idx
      if (!d.group) this.setHot(b, true)
      // 原来那块变淡（保持选中底）；块部件（图片、表格）没有行装饰，直接给它加
      d.faded = d.group ? d.group.flatMap((i) => this.blockEls(this.blocks[i]!)) : this.blockEls(b)
      for (const el of d.faded) el.classList.add('blk-faded')
      // 拖影：--pop 底、略歪、最多一行字，在鼠标右边
      const g = document.createElement('div')
      g.className = 'blk-ghost'
      g.dataset.testid = 'blk-ghost'
      g.textContent = d.group ? tNow('{n}块', { n: d.group.length }) : plainOf(this.view.state.doc.toString(), b).split('\n').find((l) => l.trim())?.trim() || tNow('（一块）')
      document.body.appendChild(g)
      this.ghost = g
    }
    if (this.ghost) {
      this.ghost.style.left = e.clientX + 14 + 'px'
      this.ghost.style.top = e.clientY - 14 + 'px'
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
      if (d.index !== TAIL && (d.shift || d.meta || this.keepsGroup(d.index))) return this.pickWith(d.index, !!d.shift, !!d.meta)
      if (this.view.state.field(blockSel).ranges.length) this.view.dispatch({ effects: setBlockSel.of(null) })
      this.lastClicked = this.blocks[d.index]?.from ?? null
      this.openMenu(d.index)
      return
    }
    if (d.group) {
      // 几块一起挪：按原来的先后挨着放到落点（task-5ryf9）
      const n = d.group.length
      const edit = moveMdBlocks(this.view.state.doc.toString(), d.group, d.to, this.blocks)
      if (applyBlockEdit(this.view, edit) && edit) {
        const bs = this.blocks
        const start = bs.findIndex((b) => b.from === edit.at)
        if (start >= 0) selectBlocks(this.view, bs.slice(start, start + n))
        app().noticeUndo(tNow('挪了{n}块：md 里这{n}段整段挪过去，字不变', { n }), () => (this.view.focus(), undo(this.view)))
      }
      this.view.focus()
      return
    }
    this.setHot(null)
    const edit = moveMdBlock(this.view.state.doc.toString(), d.index, d.to, this.blocks)
    if (applyBlockEdit(this.view, edit) && edit) {
      const moved = this.blocks[blockIndexAt(this.blocks, edit.at)]
      if (moved) flashBlock(this.view, moved.from, moved.to)
    }
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
    for (const el of this.drag?.faded ?? []) el.classList.remove('blk-faded')
    this.ghost?.remove()
    this.ghost = null
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
    const tail = i === TAIL
    const b = tail ? null : this.blocks[i]
    if (!tail && !b) return
    this.menu ??= new Popover('blk-pop')
    const whole = b ? drawnWhole(this.view, b) : null
    const conv = tail || (b && convertible(b) && !whole) ? CONVERT : whole ? RAW : []
    const doc = this.view.state.doc.toString()
    const aiB = b && !this.view.state.readOnly ? aiBlockAt(doc, b.from) : null
    const mark = b && !aiB && !this.view.state.readOnly && wrapRange(doc, b.from, b.from).wrapped > 0
    const top = aiB ? [...conv, mineItem()] : mark ? [...conv, markAiItem()] : conv
    if (b) this.setHot(b)
    this.bar.classList.add('menu-on')
    // 弹在把手右边 6，和把手顶对齐（DESIGN.v3 6.4）
    const g = (this.bar.querySelector('.blk-grip') ?? this.bar).getBoundingClientRect()
    this.menu.show(<BlockMenu key={Date.now()} top={top} tail={tail} first={i === 0} last={!tail && i === this.blocks.length - 1} onPick={(a) => this.run(i, a, whole)} onClose={() => this.closeMenu(true)} />, { left: g.right + 6, top: g.top, bottom: g.top - 6 })
    document.addEventListener('mousedown', this.onOutside, true)
    window.addEventListener('keydown', this.onEscape, true)
  }

  private closeMenu(focus: boolean) {
    document.removeEventListener('mousedown', this.onOutside, true)
    window.removeEventListener('keydown', this.onEscape, true)
    this.bar.classList.remove('menu-on')
    if (!this.menu?.open) return
    this.menu.hide()
    this.hideBar()
    this.setHot(null)
    if (focus) this.view.focus()
  }

  private run(i: number, a: MenuAction, whole: { from: number; to: number } | null) {
    this.closeMenu(true)
    if (i === TAIL) {
      // 文末那一行：新起一段，转成标题 / 待办 / 引用，光标在里面接着写
      const at = openTail(this.view, true)
      if (at === null) return
      const pre = a === 'h2' ? '## ' : a === 'todo' ? '- [ ] ' : a === 'quote' ? '> ' : ''
      if (pre) this.view.dispatch({ changes: { from: at, insert: pre }, selection: { anchor: at + pre.length }, userEvent: 'input.block', annotations: hiddenOk.of(true) })
      return
    }
    const text = this.view.state.doc.toString()
    const bs = this.blocks
    const b = bs[i]
    if (!b) return
    if (a === 'raw') return openRaw(this.view, whole?.from ?? b.from, whole?.to ?? b.to)
    if (a === 'ai') return app().askAi(plainOf(text, b) || text.slice(b.from, b.to))
    if (a === 'mine') return void makeMine(this.view, b.from)
    if (a === 'markai') return void markAi(this.view, b.from, b.from)
    if (a === 'up' || a === 'down') return applyBlockEdit(this.view, shiftMdBlock(text, i, a === 'up' ? -1 : 1, bs), 0)
    const edit = a === 'dup' ? duplicateMdBlock(text, i, bs) : a === 'del' ? removeMdBlock(text, i, bs) : convertMdBlock(text, i, a, bs)
    applyBlockEdit(this.view, edit, 0, a === 'del' ? 'delete.block' : 'move.block')
  }
}

const handles = ViewPlugin.fromClass(Handles)

export const blockHandles = [hotField, hotLayer, flashField, flashLayer, blockKeys, handles]
