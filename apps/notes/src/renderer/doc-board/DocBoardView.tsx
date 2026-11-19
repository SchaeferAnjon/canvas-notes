/**
 * 文档切到白板（方向 A「先按节摆、再自由」，照 proposals/doc-to-board 的小样 proto-a.html）：一篇普通文档（没有 type: board）
 * 按 packages/format/src/doc-board.ts 的规则切成列和卡，摆在点阵上。切过去只看，一个字节不写。
 * - 左边工具板（卡片、待办、列、子白板、拍导图）：点一下或拖到白板上；放进列就插进那一节，放在空白处就加在文末带一行位置；
 * - 顶上居中一条「按「##」摆成列 · 挪动了才写进文件 · 摆回原样」，右上「收件箱 N ⌄」：收件箱里的拖上来也是一张卡；
 * - 拖一张卡进别的列（或同一列里上下挪）：文档里这段也挪进那一节；拖到空白处：这段前面多一行位置，正文顺序不变；
 * - 双击看全文、就地改字，「在文档里看」切回文档；勾待办只改那一个字；视频卡、时刻卡点一下在右栏播（时刻从那一秒）；
 * - 每列先摆 6 张（超过 200 张的文档每列 4 张），第 7 节起只留列头；「摆回原样」去掉所有位置行；双击列名改名。
 * 每种卡长什么样在 cards.tsx。每个动作改的是编辑器里的文字，底部提示带「撤回」。⌘Z / ⇧⌘Z 只撤、重做这块白板自己做过的动作，
 * 不撤切白板前在文档里打的字，更不撤别的标签。AI 在这块白板上动手时外圈、顶上提示条、AI 指针由 AiActLayer 画。
 */
import { Codicon, type CodiconName } from '@cn/design'
import { composing } from '../ime'
import {
  addSection,
  appendPlaced,
  type DocBoard,
  type DocColumn,
  type DocUnit,
  insertInColumn,
  merge3,
  moveUnit,
  placeUnit,
  reconcile,
  renameColumn,
  resetLayout,
  splitDoc,
  toggleTask,
} from '@cn/format'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { NoteFile } from '../../shared/api'
import { CLIPS, previewOf, titleOf } from '../../shared/layout'
import { AiActLayer } from '../ai-act'
import type { BoardZoomApi } from '../BoardView'
import { movedEnough } from '../board-drop'
import { clampZoom, fitZoom, stepZoom, wheelZoom } from '../board-zoom'
import { app } from '../ctx/actions'
import { sayMerged, saySameSpot } from '../conflict-say'
import { useVaultFiles } from '../files/store'
import { openCapture } from '../mindmap/capture-store'
import { Markdown } from '../md-render'
import * as Reading from '../reading/store'
import { openVideo } from '../video/actions'
import { videoUrlOfCard } from '../video/BoardCards'
import { CardBody } from '../CardBody'
import { type CardActs, type CardCtx, type Face, faceClass, faceName, faceOf, type OpenTarget, UnitBody } from './cards'
import { UnitEditor } from './unit-editor'
import './doc-board.css'

/** 列宽、列间距、开头留给工具板的宽、顶上留的高（照小样：276、22，第一列离白板左边 92，离顶 64） */
const COL_W = 276
const PER_COL = 6
const PER_COL_LONG = 4
const OPEN_COLS = 6

export interface DocBoardViewProps {
  text: string
  notePath: string
  notes: NoteFile[]
  readOnly: boolean
  /** 这个标签在前面：⌘Z、⌘+ ⌘− ⌘0 才归这块白板 */
  active: boolean
  /** 画布上真正的比例（用户比例 × 右栏开着时的 0.8）；zoom 是用户比例，和真白板同一套（board-zoom.ts） */
  scale: number
  zoom: number
  onZoom(z: number): void
  /** 标签条「100% ▾」菜单调这里 */
  zoomApi: React.MutableRefObject<BoardZoomApi | null>
  onChange(text: string): void
  /** 「在文档里看」：切到文档，光标放到 pos */
  onOpenDoc(pos: number): void
  /**
   * 「改字」弹层开着时登记一个「把弹层里的字存回去」（关标签、关窗口、退出时叫，和 Esc 一样）；弹层关了登记 null
   */
  onDraft?(flush: (() => void) | null): void
  /** 底栏提示（全软件那条）：弹层是关标签、退出时存回去的，白板自己的提示条跟着标签没了，冲突的话说在这里 */
  onNotice(text: string): void
  /** 子白板：建一块新白板，在新标签打开改名，返回它的名字 */
  onCreateSubBoard?(): Promise<string | null>
}

/** 工具板上的五样（和真白板同一组；照小样的顺序和图标） */
type PalKind = 'card' | 'todo' | 'column' | 'board' | 'map'
const PAL: { kind: PalKind; label: string; tip: string; icon: CodiconName }[] = [
  { kind: 'card', label: '卡片', tip: '新卡片：点一下，或按住拖到白板上、拖进一列', icon: 'note' },
  { kind: 'todo', label: '待办', tip: '待办：点一下，或按住拖到白板上、拖进一列', icon: 'checklist' },
  { kind: 'column', label: '列', tip: '新的列：文档里新起一节；按住拖到两列之间', icon: 'split-horizontal' },
  { kind: 'board', label: '子白板', tip: '子白板：新建一块白板，这里放一张指向它的卡片', icon: 'layout' },
  { kind: 'map', label: '拍导图', tip: '拍一张导图：做好后这里放一张指向它的卡片', icon: 'device-camera' },
]

/** 新东西落在哪：一列里第几张前面（before -1 是列尾），或者空白处的坐标（画布坐标） */
type Where = { col: number; before: number } | { x: number; y: number }

type Drag =
  | { type: 'unit'; unit: DocUnit; start: { x: number; y: number }; grab: { x: number; y: number }; moved: boolean; at: { x: number; y: number }; w: number }
  | { type: 'pal'; kind: PalKind; start: { x: number; y: number }; at: { x: number; y: number }; moved: boolean }
  | { type: 'inbox'; path: string; text: string; start: { x: number; y: number }; at: { x: number; y: number }; moved: boolean }

export function DocBoardView(props: DocBoardViewProps) {
  const { text } = props
  const board: DocBoard = useMemo(() => splitDoc(text), [text])
  const { files } = useVaultFiles()
  const [open, setOpen] = useState<Set<number>>(new Set())
  const [more, setMore] = useState<Set<number>>(new Set())
  const [drag, setDrag] = useState<Drag | null>(null)
  const [drop, setDrop] = useState<{ col: number; before: number } | null>(null)
  /** 双击看全文的那张卡，和打开时的全文（改字存回时拿它当三方合并的底）；edit：一打开就是改字 */
  const [full, setFull] = useState<{ unit: DocUnit; base: string; edit?: boolean } | null>(null)
  /** 工具板上新建的卡片、待办：先写字，写了字才写进文件（空的不写） */
  const [draft, setDraft] = useState<{ where: Where; body: string; kind: 'card' | 'todo' } | null>(null)
  /** 底部提示：undo 为真时带「撤回」（撤回、撤不回之后的那句不带） */
  const [toast, setToastState] = useState<{ text: string; undo: boolean } | null>(null)
  const setToast = (t: string | null, undo = true) => setToastState(t === null ? null : { text: t, undo })
  const [inboxOpen, setInboxOpen] = useState(false)
  /** 刚挪过、刚放上的那张：外圈闪一下（约 2 秒），认得出是哪张（照小样） */
  const [flash, setFlash] = useState<string | null>(null)
  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 2000)
    return () => clearTimeout(t)
  }, [flash])
  /** 正在改名的那一列（新加的列一出来就进改名） */
  const [renaming, setRenaming] = useState<number | null>(null)
  const pendingRename = useRef<string | null>(null)
  const plane = useRef<HTMLDivElement>(null)
  const outer = useRef<HTMLDivElement>(null)
  const per = board.total > 200 ? PER_COL_LONG : PER_COL
  const inbox = props.notes.filter((n) => n.kind === 'inbox' && n.path !== props.notePath).sort((a, b) => b.createdMs - a.createdMs)
  const ctx: CardCtx = { notePath: props.notePath, notes: props.notes, files, full: false }

  /** 这块白板做过的动作：改前、改后的全文。撤的时候文档已经不是「改后」（别处改过）就不撤了，免得把别的改动一起撤掉 */
  const done = useRef<{ before: string; after: string }[]>([])
  const undone = useRef<{ before: string; after: string }[]>([])
  /** 编辑器里现在的全文：连按 ⌘Z 时 props.text 可能还没跟上 */
  const cur = useRef(text)
  cur.current = text
  const apply = (next: string) => {
    props.onChange(next)
    cur.current = next
  }
  const write = (next: string, what: string) => {
    const now = cur.current
    if (props.readOnly || next === now) return
    done.current.push({ before: now, after: next })
    undone.current = []
    apply(next)
    setToast(what)
  }
  /**
   * 撤回 / 重做一步。白板以外改过这篇（文档里、外部同步）时，按现在的全文三方合并着撤：只撤这一步改的那几行，
   * 别处的改动留着；撤的那几行也被别处改过、合不了，就说清楚撤不回，不假装撤好了。返回说给人听的一句。
   */
  const step = (redo: boolean): string | null => {
    const from = redo ? undone : done
    const to = redo ? done : undone
    const s = from.current.pop()
    if (!s) return null
    const was = redo ? s.before : s.after
    const want = redo ? s.after : s.before
    const now = cur.current
    const m = now === was ? { text: want, conflict: false } : merge3(was, want, now)
    if (m.conflict) {
      done.current = []
      undone.current = []
      return '文件在外面改过，这一步撤不回了'
    }
    apply(m.text)
    to.current.push(redo ? { before: now, after: m.text } : { before: m.text, after: now })
    return redo ? '重做了这一步' : '撤回了这一步'
  }
  const stepRef = useRef(step)
  stepRef.current = step
  const setToastRef = useRef(setToast)
  setToastRef.current = setToast
  // ⌘Z / ⇧⌘Z：在这块白板上一律拦下（不交给浏览器自带的撤销，它会撤到别的标签去）；改字框里照常撤字
  useEffect(() => {
    if (!props.active) return
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.altKey || e.ctrlKey || e.key.toLowerCase() !== 'z') return
      const field = (e.target as HTMLElement | null)?.closest?.('input, textarea, [contenteditable="true"]')
      if (field?.checkVisibility()) return
      e.preventDefault()
      e.stopPropagation()
      if (props.readOnly) return
      const said = stepRef.current(e.shiftKey)
      // 撤回、重做之后底部那句跟着换，不再挂着上一个动作的「撤回」
      if (said) setToastRef.current(said, false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [props.active, props.readOnly])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(t)
  }, [toast])

  const replaceUnit = (u: DocUnit, body: string, what: string) => write(text.slice(0, u.from) + body + text.slice(u.to), what)
  /**
   * 改字框存回：卡的位置是打开框时那份全文里的，框开着时外面（同步盘、手机、AI）可能改过这篇。
   * 和文档编辑器同一套三方合并（@cn/format reconcile）：底 = 打开时的全文，我的 = 底里换掉这张卡，外面的 = 现在的全文。
   * 改的不是一处就合起来；改了同一段就留我的版本写进文件，外面那版另存成冲突副本并提示（外部改动不丢正在打的字）。
   */
  const saveCard = (f: { unit: DocUnit; base: string }, body: string, closing = false) => {
    const mine = f.base.slice(0, f.unit.from) + body + f.base.slice(f.unit.to)
    if (text === f.base) return write(mine, '改好了')
    const r = reconcile(f.base, mine, text)
    if (r.kind === 'none') return
    if (r.kind === 'update') return write(r.text, sayMerged(props.notePath))
    const theirs = text
    // 同一段留我的；外面在别的段落改的照样合进来（以前整篇写成我的，别处的外部改动只在冲突副本里）
    const others = r.text !== mine
    write(r.text, saySameSpot(props.notePath, others, null))
    // 关标签、退出时存回的：白板连着提示条一起收起，改说在底栏
    const say = (t: string, undo: boolean) => (closing ? props.onNotice(t) : setToast(t, undo))
    void window.cn.saveConflictCopy(props.notePath, theirs).then(
      (copy) => say(saySameSpot(props.notePath, others, { path: copy }), true),
      (e) => say(saySameSpot(props.notePath, others, { error: String((e as Error).message ?? e) }), false),
    )
  }
  /** 弹层里现在的字（FullCard 打字时更新） */
  const fullBody = useRef<string | null>(null)
  const saveCardRef = useRef(saveCard)
  saveCardRef.current = saveCard
  const onDraftRef = useRef(props.onDraft)
  onDraftRef.current = props.onDraft
  useEffect(() => {
    if (!full) return
    fullBody.current = full.unit.text
    onDraftRef.current?.(() => {
      const body = fullBody.current
      if (body !== null && body !== full.unit.text) saveCardRef.current(full, body, true)
      setFull(null)
    })
    return () => onDraftRef.current?.(null)
  }, [full])
  const toggle = (u: DocUnit, line: number) => {
    const lines = u.text.split('\n')
    const l = lines[line]
    if (l === undefined) return
    lines[line] = toggleTask(l)
    replaceUnit(u, lines.join('\n'), /\[[xX]\]/.test(lines[line]!) ? '勾上了：文件里只改这一行的一个字' : '取消勾选')
  }

  // ----- 新东西写进文件：放进列就插进那一节，放在空白处就加在文末带一行位置 -----
  const put = (where: Where, body: string, what: { col: string; free: string }) => {
    setFlash(body.trim())
    try {
      if ('col' in where) {
        const col = board.columns[where.col]!
        const before = where.before >= 0 ? (col.cards[where.before] ?? null) : null
        write(insertInColumn(cur.current, col, before, body), what.col.replace('%s', col.title ?? '开头'))
      } else write(appendPlaced(cur.current, body, Math.max(0, where.x), Math.max(0, where.y)), what.free)
    } catch (err) {
      setToast(String((err as Error).message), false)
    }
  }
  /** 点一下工具板：放在画面正中附近（白板坐标），一张张错开一点 */
  const freeSpot = (): { x: number; y: number } => {
    const w = wrap.current
    const p = plane.current
    if (!w || !p) return { x: 40, y: 80 }
    const wr = w.getBoundingClientRect()
    const at = planeXY(wr.left + wr.width / 2 - 120 * props.scale, wr.top + wr.height / 3)
    const n = board.placed.length % 6
    return { x: Math.round(at.x + n * 24), y: Math.round(at.y + n * 24) }
  }
  const createAt = async (kind: PalKind, where: Where) => {
    if (kind === 'card' || kind === 'todo') return setDraft({ where, body: kind === 'todo' ? '- [ ] ' : '', kind })
    if (kind === 'column') {
      const before = 'col' in where ? (board.columns[where.col] ?? null) : null
      const name = '新的列'
      pendingRename.current = name
      write(addSection(cur.current, name, before?.head ? before : null, board.level), '加了一列：文档里新起了一节「新的列」')
      return
    }
    if (kind === 'board') {
      const name = await props.onCreateSubBoard?.()
      if (!name) return
      put(where, `[[${name}]]`, { col: '子白板放进了「%s」：文档里多了一个链接', free: '子白板放在这里：文档末尾多了一个链接' })
      return
    }
    // 拍导图：拍好、做成导图白板后，落点放一张指向它的卡片
    openCapture({ onPlaced: (path) => put(where, `[[${titleOf(path)}]]`, { col: '导图放进了「%s」', free: '导图放在这里：文档末尾多了一个链接' }) })
  }
  // 新加的列一出来就进改名
  useEffect(() => {
    const name = pendingRename.current
    if (!name) return
    const i = board.columns.findIndex((c) => c.title === name && c.cards.length === 0)
    if (i >= 0) {
      pendingRename.current = null
      setRenaming(i)
    }
  }, [board])

  /** 收件箱里的一条拖上白板：短的内容放成卡片、那篇移到废纸篓；整页剪藏这类长的挪到「素材/<这篇>/」，放一张指向它的卡片 */
  const placeInbox = async (path: string, where: Where) => {
    const note = await window.cn.readNote(path)
    const body = note.text.replace(/^---\n[\s\S]*?\n---\n?/, '').trim()
    if ((/^---\n[\s\S]*?\nsource:/.test(note.text) && /^# /m.test(body)) || body.length > 800) {
      const moved = await window.cn.createNote(`${CLIPS}/${titleOf(props.notePath)}`, titleOf(path), note.text)
      await window.cn.trashNote(path)
      put(where, `[[${titleOf(moved)}]]`, { col: '收件箱里那篇放进了「%s」：挪到素材里，这里是指向它的卡片', free: '收件箱里那篇放在这里：挪到素材里，这里是指向它的卡片' })
    } else {
      // 开头那行「# 名字」是那篇的名字，放进文档就不要了（不然文档里多一个一级标题，按节摆就乱了）
      put(where, body.replace(/^#\s+[^\n]*\n+/, ''), { col: '收件箱里那条放进了「%s」', free: '收件箱里那条放在这里：文档末尾多了这一段' })
      await window.cn.trashNote(path)
    }
    app().refresh()
  }

  // ----- 缩放（和真白板一样：⌘+ ⌘− ⌘0 ⇧⌘1、捏合、按住 ⌘ 滚轮、标签条菜单；以鼠标或画面正中为中心）-----
  const wrap = useRef<HTMLDivElement>(null)
  const factor = props.zoom > 0 ? props.scale / props.zoom : 1
  const liveZoom = useRef(props.zoom)
  const pendingScroll = useRef<{ left: number; top: number } | null>(null)
  const zoomTo = (next: number, anchor?: { x: number; y: number }) => {
    const w = wrap.current
    const z = clampZoom(next)
    if (!w || z === liveZoom.current) return
    const oldS = liveZoom.current * factor
    const newS = z * factor
    const r = w.getBoundingClientRect()
    const ax = anchor ? anchor.x - r.left : w.clientWidth / 2
    const ay = anchor ? anchor.y - r.top : w.clientHeight / 2
    const from = pendingScroll.current ?? { left: w.scrollLeft, top: w.scrollTop }
    // 画布左边给工具板让出的 92 不随缩放变，换算时扣掉
    pendingScroll.current = { left: ((from.left + ax - ROOM) / oldS) * newS - ax + ROOM, top: ((from.top + ay) / oldS) * newS - ay }
    liveZoom.current = z
    props.onZoom(z)
  }
  /** 适合窗口：所有列和单独摆的卡整个放进画面 */
  const fit = () => {
    const w = wrap.current
    const p = plane.current
    if (!w || !p) return
    const base = p.getBoundingClientRect()
    const rs = [...p.querySelectorAll<HTMLElement>('.db-col, .db-card.placed')].map((el) => el.getBoundingClientRect())
    const s0 = props.scale
    const box = rs.length
      ? (() => {
          const x = Math.min(...rs.map((r) => r.left - base.left)) / s0
          const y = Math.min(...rs.map((r) => r.top - base.top)) / s0
          return { x, y, w: Math.max(...rs.map((r) => r.right - base.left)) / s0 - x, h: Math.max(...rs.map((r) => r.bottom - base.top)) / s0 - y }
        })()
      : null
    const z = fitZoom(box, { w: w.clientWidth - ROOM, h: w.clientHeight }, factor)
    const s = z * factor
    const to = box ? { left: Math.max(0, (box.x - 40) * s), top: Math.max(0, (box.y - 40) * s) } : { left: 0, top: 0 }
    if (z === liveZoom.current) return void ((w.scrollLeft = to.left), (w.scrollTop = to.top))
    pendingScroll.current = to
    liveZoom.current = z
    props.onZoom(z)
  }
  const zoomRef = useRef({ zoomTo, fit })
  zoomRef.current = { zoomTo, fit }
  props.zoomApi.current = { step: (d) => zoomTo(stepZoom(liveZoom.current, d)), set: (z) => zoomTo(z), fit }
  useLayoutEffect(() => {
    liveZoom.current = props.zoom
    const p = pendingScroll.current
    pendingScroll.current = null
    if (p && wrap.current) {
      wrap.current.scrollLeft = p.left
      wrap.current.scrollTop = p.top
    }
  }, [props.scale, props.zoom])
  useEffect(() => {
    const w = wrap.current
    if (!w) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      zoomRef.current.zoomTo(wheelZoom(liveZoom.current, e.deltaY), { x: e.clientX, y: e.clientY })
    }
    w.addEventListener('wheel', onWheel, { passive: false })
    return () => w.removeEventListener('wheel', onWheel)
  }, [])
  // ⌘+ / ⌘− / ⌘0 / ⇧⌘1：拦住，不然软件菜单把整个窗口缩放了；改字框里不管
  useEffect(() => {
    if (!props.active) return
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.altKey || e.ctrlKey) return
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, [contenteditable="true"]')) return
      const z = zoomRef.current
      if (e.key === '=' || e.key === '+') z.zoomTo(stepZoom(liveZoom.current, 1))
      else if (e.key === '-' || e.key === '_') z.zoomTo(stepZoom(liveZoom.current, -1))
      else if (e.key === '0' && !e.shiftKey) z.zoomTo(1)
      else if (e.code === 'Digit1' && e.shiftKey) z.fit()
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [props.active])

  // ----- 拖：卡片、工具板上的新东西、收件箱里的一条 -----
  const planeXY = (cx: number, cy: number) => {
    const r = plane.current!.getBoundingClientRect()
    return { x: (cx - r.left) / props.scale, y: (cy - r.top) / props.scale }
  }
  /** 鼠标下面是哪一列、插到第几张前面（问过 AI 那一列不收） */
  const slotAt = (cx: number, cy: number, except?: number): { col: number; before: number } | null => {
    const colEl = (document.elementsFromPoint(cx, cy) as HTMLElement[]).find((el) => el.classList?.contains('db-col'))
    if (!colEl || colEl.dataset.ask === '1' || colEl.classList.contains('fold')) return null
    const ci = Number(colEl.dataset.col)
    const cards = [...colEl.querySelectorAll<HTMLElement>(':scope > .db-sub-wrap > .db-card[data-i]')].filter((c) => !c.classList.contains('dragging') && Number(c.dataset.i) !== except)
    const i = cards.find((c) => cy < c.getBoundingClientRect().top + c.getBoundingClientRect().height / 2)
    return { col: ci, before: i ? Number(i.dataset.i) : -1 }
  }
  /** 鼠标在不在画布上（不在工具板、顶上那条、收件箱、弹层上） */
  const onCanvas = (cx: number, cy: number) => {
    const el = document.elementFromPoint(cx, cy)
    return !!el && !!wrap.current?.contains(el)
  }
  const onDown = (e: React.MouseEvent, u: DocUnit) => {
    if (e.button !== 0 || props.readOnly) return
    if ((e.target as HTMLElement).closest('input, button, a, .play, .db-moment, .cb-moment')) return
    const card = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setDrag({ type: 'unit', unit: u, start: { x: e.clientX, y: e.clientY }, grab: { x: e.clientX - card.left, y: e.clientY - card.top }, moved: false, at: { x: e.clientX, y: e.clientY }, w: card.width })
  }
  const palDragged = useRef(false)
  useEffect(() => {
    if (!drag) return
    const move = (e: MouseEvent) => {
      const at = { x: e.clientX, y: e.clientY }
      const moved = drag.moved || movedEnough(drag.start, at)
      setDrag({ ...drag, moved, at })
      if (!moved) return
      if (drag.type === 'pal' && drag.kind === 'column') return setDrop(null)
      if (drag.type === 'unit' || onCanvas(e.clientX, e.clientY)) setDrop(slotAt(e.clientX, e.clientY))
      else setDrop(null)
    }
    const up = (e: MouseEvent) => {
      const d = drag
      const target = drop
      setDrag(null)
      setDrop(null)
      if (!d.moved) return
      if (d.type === 'pal' || d.type === 'inbox') {
        palDragged.current = true
        setTimeout(() => (palDragged.current = false), 0)
        if (!onCanvas(e.clientX, e.clientY)) return
        const p = planeXY(e.clientX, e.clientY)
        if (d.type === 'pal' && d.kind === 'column') {
          // 列落在哪两列之间：鼠标所在那一行里，插在鼠标右边那一列前面（落在最后一行下面或右边就加在最后）
          const rows = [...(plane.current?.querySelectorAll<HTMLElement>('.db-row') ?? [])]
          const row = rows.find((r) => e.clientY <= r.getBoundingClientRect().bottom + 11)
          const cols = [...(row?.querySelectorAll<HTMLElement>('.db-col[data-head="1"]') ?? [])]
          const right = cols.find((c) => e.clientX < c.getBoundingClientRect().left + c.getBoundingClientRect().width / 2)
          void createAt('column', right ? { col: Number(right.dataset.col), before: -1 } : { x: p.x, y: p.y })
          return
        }
        const where: Where = target ?? { x: p.x - 24, y: p.y - 16 }
        if (d.type === 'pal') void createAt(d.kind, where)
        else void placeInbox(d.path, where)
        return
      }
      try {
        if (target) {
          const col = board.columns[target.col]!
          const before = target.before >= 0 ? col.cards[target.before]! : null
          if (before && before.from === d.unit.from) return
          setFlash(d.unit.text.trim())
          // 提示的字照小样：挪进别的列「挪进「路线」：文档里这段也挪到了「路线」下面」，同一列里换先后另一句
          const name = col.title ?? '开头'
          const same = col.cards.some((x) => x.from === d.unit.from)
          write(moveUnit(text, d.unit, col, before), same ? `文档里「${name}」这一节的先后也跟着换了` : `挪进「${name}」：文档里这段也挪到了「${name}」下面`)
        } else {
          const p = planeXY(e.clientX - d.grab.x, e.clientY - d.grab.y)
          setFlash(d.unit.text.trim())
          write(placeUnit(text, d.unit, Math.max(0, p.x), Math.max(0, p.y)), '只记了位置：正文顺序没变，文件里多一行')
        }
      } catch (err) {
        setToast(String((err as Error).message), false)
      }
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      palDragged.current = true
      setTimeout(() => (palDragged.current = false), 0)
      setDrag(null)
      setDrop(null)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    window.addEventListener('keydown', esc, true)
    return () => (window.removeEventListener('mousemove', move), window.removeEventListener('mouseup', up), window.removeEventListener('keydown', esc, true))
  }, [drag, drop, text])

  // 视频卡、时刻卡：点一下在右栏播（时刻从那一秒）
  const onClick = (e: React.MouseEvent, u: DocUnit) => {
    const t = e.target as HTMLElement
    const m = t.closest<HTMLElement>('.db-moment')
    if (m?.dataset.url) return void openVideo(m.dataset.url)
    if (u.kind === 'moment' || (u.kind === 'video' && t.closest('.play, .cover'))) {
      const v = videoUrlOfCard(u.kind === 'video' && u.moments ? u.text.slice(0, u.moments[0]!.from - u.from) : u.text)
      if (v) void openVideo(v.url, v.resume)
    }
  }
  const openTarget = (o: OpenTarget) => {
    if (o.kind === 'url') return app().openInWeb(o.url)
    app().openFile(o.path)
    const page = o.page
    if (page && /\.pdf$/i.test(o.path)) setTimeout(() => Reading.jumpTo(o.path, page), 300)
  }
  /** 双击：PDF 页、白板、嵌入的笔记、HTML 打开那样东西；别的看全文 */
  const onDouble = (e: React.MouseEvent, u: DocUnit, f: Face) => {
    if ((e.target as HTMLElement).closest('input, button')) return
    if (f.k === 'pdf' && f.file) return openTarget({ kind: 'file', path: f.file.path, page: f.page })
    if (f.k === 'board' || f.k === 'note') return openTarget({ kind: 'file', path: f.note.path })
    if (f.k === 'link' && f.open) return openTarget(f.open)
    if (f.k === 'cardbody' && (f.kind === 'video' || f.kind === 'moment')) return
    setFull({ unit: u, base: text })
  }

  const card = (u: DocUnit, i: number, extra?: { style?: React.CSSProperties; section?: string | null }) => {
    if (u.kind === 'gap') return <div key={'g' + u.from} className="db-gap" />
    const f = faceOf(u, ctx)
    const dragging = drag?.type === 'unit' && drag.moved && drag.unit.from === u.from
    const acts: CardActs = { onToggle: (line) => toggle(u, line), onOpen: openTarget, onFull: () => setFull({ unit: u, base: text }) }
    const cls =
      `db-card ${faceClass(f)}` + (u.kind === 'video' && u.moments ? ' group' : '') + (dragging ? ' dragging' : '') + (u.place ? ' placed' : '') + (flash && u.text.trim() === flash ? ' flash' : '')
    return (
      <div
        key={u.from}
        className={cls}
        data-i={i}
        data-kind={u.kind}
        data-face={f.k === 'cardbody' ? f.kind : f.k}
        data-id={u.place?.id}
        aria-label={faceName(f)}
        style={extra?.style}
        onMouseDown={(e) => onDown(e, u)}
        onClick={(e) => onClick(e, u)}
        onDoubleClick={(e) => onDouble(e, u, f)}
      >
        {u.kind === 'video' && u.moments ? (
          <>
            <div className="face fc-media">
              <UnitBody u={{ ...u, moments: u.moments }} f={f} ctx={ctx} acts={acts} />
            </div>
            {u.moments.map((m) => (
              <div key={m.from} className="face fc-media db-moment" data-url={videoUrlOfCard(m.text)?.url}>
                <CardBody text={m.text} info={{ kind: 'moment' }} notes={props.notes} notePath={props.notePath} small onToggle={() => undefined} />
              </div>
            ))}
          </>
        ) : (
          <UnitBody u={u} f={f} ctx={ctx} acts={acts} />
        )}
        {extra?.section !== undefined && (
          <div className="from">
            <Codicon name="location" size={13} />
            {`在文档「${extra.section ?? '开头'}」这一节里`}
          </div>
        )}
      </div>
    )
  }

  const column = (c: DocColumn, ci: number) => {
    const folded = ci >= OPEN_COLS && !open.has(ci)
    const cards = c.cards.filter((u) => u.kind !== 'gap')
    // 列头的张数照小样：挂在视频下面的时刻也是一张卡
    const count = cards.reduce((n, u) => n + 1 + (u.moments?.length ?? 0), 0)
    const showAll = more.has(ci)
    let shown = 0
    const lead = c.title === null
    return (
      <section
        key={ci}
        className={'db-col' + (lead ? ' bare' : '') + (folded ? ' fold' : '') + (drop?.col === ci ? ' drop' : '')}
        data-col={ci}
        data-ask={c.ask ? '1' : '0'}
        data-head={c.head ? '1' : '0'}
        aria-label={c.title ?? '开头'}
        onClick={() => folded && setOpen(new Set(open).add(ci))}
      >
        {!lead &&
          (renaming === ci ? (
            <input
              className="db-col-name"
              aria-label="列名"
              defaultValue={c.title ?? ''}
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
              onMouseDown={(e) => e.stopPropagation()}
              onBlur={(e) => {
                setRenaming(null)
                const t = e.currentTarget.value.trim()
                if (t && t !== c.title) write(renameColumn(cur.current, c, t), `列名改成了「${t}」：文档里这一节的标题跟着改了`)
              }}
              onKeyDown={(e) => {
                // 输入法还在组字：回车、Esc 交给输入法（CN-115）
                if (composing(e)) return
                if (e.key === 'Enter') (e.preventDefault(), e.currentTarget.blur())
                if (e.key === 'Escape') (e.preventDefault(), (e.currentTarget.value = c.title ?? ''), e.currentTarget.blur())
              }}
            />
          ) : (
            <h3 onDoubleClick={(e) => c.head && !props.readOnly && (e.stopPropagation(), setRenaming(ci))} title={c.head && !props.readOnly ? '双击改列名' : undefined}>
              {c.ask && <Codicon name="comment-discussion" size={14} />}
              <span className="truncate">{c.title}</span>
              <span className="meta num">{c.ask ? `${count}处` : `${count}张`}</span>
              {folded && <Codicon name="chevron-down" size={14} />}
            </h3>
          ))}
        {!folded &&
          c.cards.map((u, i) => {
            if (u.kind !== 'gap' && !showAll && shown >= per) return null
            if (u.kind !== 'gap') shown++
            return (
              <div key={u.from} className="db-sub-wrap">
                {u.sub && <div className="db-sub">{u.sub}</div>}
                {drop && drop.col === ci && drop.before === i && <div className="db-drop" />}
                {card(u, i)}
              </div>
            )
          })}
        {!folded && drop?.col === ci && drop.before === -1 && <div className="db-drop" />}
        {!folded && !showAll && cards.length > per && (
          <button type="button" className="db-more" onClick={() => setMore(new Set(more).add(ci))}>
            <Codicon name="chevron-down" size={14} />
            {`还有${cards.length - per}张，点开`}
          </button>
        )}
      </section>
    )
  }

  const moved = board.placed.length
  const ghost =
    drag?.type === 'unit' && drag.moved ? (
      <div className={`db-card db-drag-card ${faceClass(faceOf(drag.unit, ctx))}`} style={{ left: drag.at.x - drag.grab.x, top: drag.at.y - drag.grab.y, width: drag.w }}>
        <UnitBody u={drag.unit} f={faceOf(drag.unit, ctx)} ctx={ctx} acts={{ onToggle: () => undefined, onOpen: () => undefined, onFull: () => undefined }} />
      </div>
    ) : drag && drag.moved && (drag.type === 'pal' || drag.type === 'inbox') ? (
      <div className={'db-pal-ghost' + (onCanvas(drag.at.x, drag.at.y) ? '' : ' off')} style={{ left: drag.at.x - 24, top: drag.at.y - 16 }}>
        {drag.type === 'inbox' ? previewOf(drag.text, 60) : drag.kind === 'todo' ? '待办' : drag.kind === 'column' ? '新的列' : drag.kind === 'board' ? '子白板' : drag.kind === 'map' ? '拍一张导图' : '新卡片'}
      </div>
    ) : null

  return (
    <div className="board db-board" data-testid="doc-board" ref={outer}>
      <div className="board-wrap" ref={wrap}>
        <div className="db-stage">
          <div className="db-plane" ref={plane} style={{ zoom: props.scale }}>
            {/* 前 6 节一行；第 7 节起只留列头，6 个一行排在下面（照小样） */}
            <div className="db-cols">
              {Array.from({ length: Math.ceil(board.columns.length / OPEN_COLS) }, (_, r) => (
                <div key={r} className="db-row">
                  {board.columns.slice(r * OPEN_COLS, (r + 1) * OPEN_COLS).map((c, k) => column(c, r * OPEN_COLS + k))}
                </div>
              ))}
            </div>
            {board.placed.map((u) => card(u, -1, { style: { position: 'absolute', left: u.place!.x, top: u.place!.y, width: COL_W }, section: u.section }))}
          </div>
        </div>
      </div>
      {!props.readOnly && (
        <div className="bpal" onMouseDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          {PAL.map((it) => (
            <button
              key={it.kind}
              type="button"
              data-tip={it.tip}
              data-side="right"
              onMouseDown={(e) => e.button === 0 && setDrag({ type: 'pal', kind: it.kind, start: { x: e.clientX, y: e.clientY }, at: { x: e.clientX, y: e.clientY }, moved: false })}
              onClick={() => !palDragged.current && void createAt(it.kind, it.kind === 'column' ? { x: 0, y: 0 } : freeSpot())}
            >
              <Codicon name={it.icon} size={16} />
              <span>{it.label}</span>
            </button>
          ))}
        </div>
      )}
      <div className="db-top">
        <div className="db-hint" role="status">
          <Codicon name="info" size={14} />
          {board.total > 200 && !moved ? (
            <span className="tx">
              {`这篇有${board.total}段 · `}
              <b>{`每节先摆${per}张，第${OPEN_COLS + 1}节起只留列头`}</b>
            </span>
          ) : moved ? (
            <span className="tx">{`${moved}张卡离开了自己那一节 · 文件里多了${moved}行位置`}</span>
          ) : (
            <span className="tx">
              {'按「##」摆成列 · '}
              <b>挪动了才写进文件</b>
            </span>
          )}
          {!props.readOnly && (
            <button type="button" className="db-pill" onClick={() => (moved ? write(resetLayout(text), `摆回原样：去掉了${moved}行位置，正文没动`) : setToast('已经是按节摆的样子', false))}>
              <Codicon name="discard" size={13} />
              摆回原样
            </button>
          )}
        </div>
        <div className={'db-inbox' + (inboxOpen ? ' open' : '')}>
          <button type="button" className="h" data-testid="db-inbox" aria-expanded={inboxOpen} onClick={() => setInboxOpen(!inboxOpen)}>
            <Codicon name="inbox" size={14} />
            收件箱
            <b className="num">{inbox.length}</b>
            <Codicon name="chevron-down" size={14} />
          </button>
          {inboxOpen && (
            <div className="stack" role="list" aria-label="收件箱">
              {inbox.length === 0 && <p className="hint">收件箱是空的。</p>}
              {inbox.map((n) => (
                <div
                  key={n.path}
                  role="listitem"
                  className="mini"
                  title="拖到白板上、拖进一列"
                  onMouseDown={(e) => !props.readOnly && e.button === 0 && setDrag({ type: 'inbox', path: n.path, text: n.preview || titleOf(n.path), start: { x: e.clientX, y: e.clientY }, at: { x: e.clientX, y: e.clientY }, moved: false })}
                >
                  {previewOf(n.preview || titleOf(n.path), 80)}
                  <span>{titleOf(n.path)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {ghost}
      {toast && (
        <div className="db-toast" role="status">
          <Codicon name="pass" size={15} />
          <span title={toast.text}>{toast.text}</span>
          {toast.undo && (
            <button type="button" className="db-pill" onClick={() => setToast(step(false), false)}>
              <Codicon name="discard" size={13} />
              撤回
            </button>
          )}
        </div>
      )}
      {full && (
        <FullCard
          unit={full.unit}
          ctx={{ ...ctx, full: true }}
          section={sectionOf(board, full.unit)}
          readOnly={props.readOnly}
          bodyRef={fullBody}
          onToggle={(line) => toggle(full.unit, line)}
          onOpen={openTarget}
          onOpenDoc={props.onOpenDoc}
          onClose={() => setFull(null)}
          onSave={(body) => (saveCard(full, body), setFull(null))}
          onNotice={(t) => setToast(t, false)}
        />
      )}
      {draft && (
        <NewCard
          draft={draft}
          onClose={() => setDraft(null)}
          onSave={(body) => {
            setDraft(null)
            put(draft.where, body, { col: `${draft.kind === 'todo' ? '待办' : '新卡片'}放进了「%s」：文档里这一节多了这一段`, free: `${draft.kind === 'todo' ? '待办' : '新卡片'}放在这里：文档末尾多了这一段和一行位置` })
          }}
        />
      )}
      <AiActLayer area="board" path={props.notePath} host={outer} />
    </div>
  )
}

/** 工具板、收件箱的东西落下时，画布左边给工具板让出的宽（不随缩放变）：第一列离白板左边 92 */
const ROOM = 92

/** 这张卡在文档里哪一节 */
function sectionOf(b: DocBoard, u: DocUnit): string {
  const placed = b.placed.find((x) => x.from === u.from)
  if (placed) return placed.section ?? '开头'
  for (const c of b.columns) if (c.cards.some((x) => x.from === u.from)) return c.ask ? (/^##\s*(.+)$/m.exec(u.text)?.[1] ?? '问过 AI') : (c.title ?? '开头')
  return '开头'
}

/**
 * 双击看全文：白板正中偏上，头上「种类 · 在文档「这一节」里」「在文档里看」；点「改字」在排好的样子上直接改（unit-editor.tsx，不露写法）。
 * Esc、点外面、关掉都一样：改过的字存下（想放弃按 ⌘Z），没改就直接关
 */
function FullCard(props: {
  unit: DocUnit
  ctx: CardCtx
  section: string
  readOnly: boolean
  bodyRef: React.MutableRefObject<string | null>
  onToggle(line: number): void
  onOpen(o: OpenTarget): void
  onOpenDoc(pos: number): void
  onClose(): void
  onSave(body: string): void
  onNotice(text: string): void
}) {
  const [body, setBody] = useState(props.unit.text)
  const [editing, setEditing] = useState(false)
  const bodyNow = useRef(body)
  bodyNow.current = body
  props.bodyRef.current = body
  const close = () => (bodyNow.current !== props.unit.text ? props.onSave(bodyNow.current) : props.onClose())
  const closeRef = useRef(close)
  closeRef.current = close
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !e.isComposing && (e.preventDefault(), e.stopPropagation(), closeRef.current())
    window.addEventListener('keydown', esc, true)
    return () => window.removeEventListener('keydown', esc, true)
  }, [])
  const f = faceOf(props.unit, props.ctx)
  return (
    <div className="db-full-back" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="db-full" role="dialog" aria-label="全文">
        <div className="db-full-hd">
          <Codicon name="preview" size={14} />
          <b>{faceName(f)}</b>
          {/* 只截中间的节名，「· 在文档「」和「」里」一直露着（设计复审） */}
          <span className="where">
            <span>· 在文档「</span>
            <span className="sec">{props.section}</span>
            <span>」里</span>
          </span>
          <span className="sp" />
          {!props.readOnly && !editing && (
            <button type="button" className="db-pill" onClick={() => setEditing(true)}>
              <Codicon name="edit" size={13} />
              改字
            </button>
          )}
          <button type="button" className="db-pill" onClick={() => (close(), props.onOpenDoc(props.unit.from))}>
            <Codicon name="file-text" size={13} />
            在文档里看
          </button>
          <button type="button" className="db-ib" aria-label="关掉" onClick={close}>
            <Codicon name="close" size={15} />
          </button>
        </div>
        {editing ? (
          <>
            <UnitEditor text={body} notePath={props.ctx.notePath} onChange={setBody} onNotice={props.onNotice} />
            <div className="db-full-ft edit">
              <button type="button" className="btn" onClick={() => props.onSave(body)}>
                存好
              </button>
            </div>
          </>
        ) : (
          <div className={'db-full-body db-card full ' + faceClass(f)}>
            {props.unit.kind === 'video' || props.unit.kind === 'moment' ? (
              <Markdown text={props.unit.text} />
            ) : (
              <UnitBody u={props.unit} f={f} ctx={props.ctx} acts={{ onToggle: props.onToggle, onOpen: props.onOpen, onFull: () => undefined }} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** 工具板上点的「卡片」「待办」：先在这里写，写了字才放到白板上（写进文件）；空着关掉就什么都不写 */
function NewCard(props: { draft: { body: string; kind: 'card' | 'todo' }; onClose(): void; onSave(body: string): void }) {
  const [body, setBody] = useState(props.draft.body)
  const bodyNow = useRef(body)
  bodyNow.current = body
  const done = () => {
    const b = bodyNow.current.trim()
    if (!b || b === props.draft.body.trim()) return props.onClose()
    props.onSave(bodyNow.current)
  }
  const doneRef = useRef(done)
  doneRef.current = done
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !e.isComposing && (e.preventDefault(), e.stopPropagation(), doneRef.current())
    window.addEventListener('keydown', esc, true)
    return () => window.removeEventListener('keydown', esc, true)
  }, [])
  return (
    <div className="db-full-back" onMouseDown={(e) => e.target === e.currentTarget && done()}>
      <div className="db-full" role="dialog" aria-label={props.draft.kind === 'todo' ? '新待办' : '新卡片'}>
        <div className="db-full-hd">
          <Codicon name={props.draft.kind === 'todo' ? 'checklist' : 'note'} size={14} />
          <b>{props.draft.kind === 'todo' ? '新待办' : '新卡片'}</b>
          <span className="where">· 写了字才放到白板上</span>
          <span className="sp" />
          <button type="button" className="db-ib" aria-label="关掉" onClick={done}>
            <Codicon name="close" size={15} />
          </button>
        </div>
        <textarea
          aria-label="新卡片的字"
          value={body}
          autoFocus
          onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
          onChange={(e) => setBody(e.currentTarget.value)}
          onKeyDown={(e) => !composing(e) && e.key === 'Enter' && e.metaKey && (e.preventDefault(), done())}
        />
        <div className="db-full-ft">
          <span className="keys">⌘↵ 放好 · esc 也会放好，空着就不放</span>
          <button type="button" className="btn" onClick={done}>
            放到白板上
          </button>
        </div>
      </div>
    </div>
  )
}
