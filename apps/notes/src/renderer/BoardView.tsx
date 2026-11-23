import { composing } from './ime'
import { accelFor, isKey, keyFor } from './keys'
import {
  appendBlock,
  attr,
  type BoardDoc,
  content,
  type Link,
  newBlock,
  newId,
  num,
  parseBoard,
  parseLinks,
  serializeBoard,
  withAttrs,
  withContent,
  withLinks,
  isMindmap,
} from '@cn/format'
import { onFlyToCard } from './shell/OutlineView'
import { Codicon, type CodiconName } from '@cn/design'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { NoteFile } from '../shared/api'
import { CLIPS, previewOf, titleOf } from '../shared/layout'
import {
  addCard,
  addColumn,
  CARD_W,
  columnAt as columnIn,
  COL_W,
  dropOrigin,
  GRAB,
  movedEnough,
  PAL_SIZE,
  type PalKind,
  type Place,
  type Pt,
  putInColumn,
  type Rect,
  slotInColumn,
  TODO_BODY,
} from './board-drop'
import { CardBody, classify, domainOf, TODO } from './CardBody'
import { sayCardBack, sayMerged, saySameSpot } from './conflict-say'
import { cardSave, keepEditing } from './board-edit'
import { openVideo } from './video/actions'
import { boardMomentStats } from './video/board'
import { momentsTitle, videoKeyOfCard, videoUrlOfCard } from './video/BoardCards'
import { useBoardImageDrop } from './web/useImageDrop'
import { openCapture, setBoardCapture } from './mindmap/capture-store'
import { settlePlaced } from './mindmap/place'
import { MindmapLayer } from './mindmap/MindmapLayer'
import { BoardFind } from './find/BoardFind'
import { app } from './ctx/actions'
import { align, duplicateCard, intoNewColumn, takeOut, tidyGrid } from './ctx/board-ops'
import { type MenuEntry, showMenu } from './ctx/menu'
import { clampZoom, fitZoom, stepZoom, wheelZoom } from './board-zoom'
import { AiActLayer } from './ai-act'
import { inboxOf, InboxPop, useInboxOpen } from './doc-board/inbox'
import type { EditorView } from '@codemirror/view'
import { UnitEditor } from './doc-board/unit-editor'
import { typingIn } from './typing'
import { useT } from './i18n'
import { t as tNow } from '../shared/i18n'

type Drag =
  | { type: 'block'; id: string; start: Pt; origin: Pt; moved: boolean; delta: Pt }
  | { type: 'link'; from: string; to: Pt }
  | { type: 'loose'; key: string; text: string; inboxPath?: string; at: Pt; client: Pt }
  /** 从工具板按住拖出来的新东西；over：现在松手会落在画布上（不在工具板、浮层上，也不在画布外） */
  | { type: 'pal'; kind: PalKind; start: Pt; client: Pt; moved: boolean; over: boolean; map?: boolean }

/** 左边竖着的工具板（左 16、宽 64）占的地方：画布整体往右让这么多，从 x=0 摆起的列、卡不被它盖住（第 2 轮写作区存疑） */
const PAL_ROOM = 96
/** 上边让出的高：右上「N未整理」（上 16、高 32）下面再空 16，从 y=0 摆起的卡不贴标签条、不被它压住（第 3 轮美学） */
const TOP_ROOM = 64

// 不翻：键，画的地方翻（label 是工具板上的字，带「工具板」；title 进悬停提示，带「工具板提示」）
const PAL: { kind: PalKind; label: string; title: string; icon: CodiconName }[] = [
  { kind: 'card', label: '卡片', title: '新卡片', icon: 'note' }, // 不翻
  { kind: 'todo', label: '待办', title: '待办', icon: 'checklist' }, // 不翻
  { kind: 'column', label: '列', title: '新的列', icon: 'split-horizontal' }, // 不翻
  { kind: 'board', label: '子白板', title: '子白板', icon: 'layout' }, // 不翻
]

export interface BoardViewProps {
  text: string
  /** 这块白板的文件：拖进来的图片按它算相对路径 */
  notePath: string
  notes: NoteFile[]
  /** 画布上真正的比例 = zoom × 让位系数（AI 浮窗或右栏开着时 0.8） */
  scale: number
  /** 用户自己选的比例（board-zoom.ts），改了交给 onZoom（NoteTab 记在本机） */
  zoom: number
  onZoom(z: number): void
  /** 这个标签在前面：⌘+ / ⌘− / ⌘0 / ⇧⌘1 才归它 */
  active: boolean
  /** 右上角「80% ▾」菜单用：放大、缩小、100%、适合窗口 */
  zoomApi?: React.MutableRefObject<BoardZoomApi | null>
  /** 右上角浮着的缩放和「收件箱 N」（doc-board/corner.tsx，task-wz7gb） */
  corner?: React.ReactNode
  readOnly: boolean
  onChange(text: string): void
  onUndo(): void
  onRedo(): void
  onOpen(path: string): void
  onCreateSubBoard(): Promise<string | null>
  onNotice(t: string): void
  /** 卡片正在改字时登记「把框里的字存回去」（关标签、关窗口、退出时叫，和点别处一样）；改完登记 null */
  onDraft?(flush: (() => void) | null): void
}

/** 改字框开着时向 NoteDoc 登记：关标签、退出前先把框里的字存回去 */
function useDraft(onDraft: BoardViewProps['onDraft'], flush: () => void) {
  const f = useRef(flush)
  f.current = flush
  useEffect(() => {
    onDraft?.(() => f.current())
    return () => onDraft?.(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

export interface BoardZoomApi {
  step(dir: 1 | -1): void
  set(z: number): void
  fit(): void
}

export function BoardView(props: BoardViewProps) {
  const t = useT()
  const { text, notes, scale } = props
  const [editing, setEditing] = useState<string | null>(null)
  /**
   * 改卡的框开着时外面（同步盘、另一台机器、AI）改了这块白板：存下时三方合并（board-edit.ts 的 cardSave）。
   * 记开框时的全文；正在改的卡被外面删了，照它画回去，框不卸掉，打的字留着（keepEditing）
   */
  const editBase = useRef<{ id: string; text: string } | null>(null)
  const doc = useMemo(() => keepEditing(parseBoard(text), editBase.current?.id === editing ? editBase.current.text : null, editing), [text, editing])
  const links = useMemo(() => parseLinks(doc), [doc])
  /** 导图白板：正文里的列表画成导图（mindmap/MindmapLayer） */
  const mindmap = isMindmap(text)
  const [mapSize, setMapSize] = useState({ w: 0, h: 0 })
  // 收件箱里的白板（刚拍的导图）不把自己算进自己的收件箱
  const inbox = inboxOf(notes, props.notePath)

  const wrap = useRef<HTMLDivElement>(null)
  const outer = useRef<HTMLDivElement>(null)
  const plane = useRef<HTMLDivElement>(null)
  const els = useRef(new Map<string, HTMLElement>())
  const [rects, setRects] = useState<Record<string, Rect>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selLink, setSelLink] = useState<string | null>(null)
  /** 双击的是待办里第几行（文件里的行号） */
  const editRow = useRef<number | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [dropCol, setDropCol] = useState<string | null>(null)
  const inboxOpen = useInboxOpen()
  const [flash, setFlash] = useState<string | null>(null)
  /** 右键「改名」的那一列（seq 变了就进改名） */
  const [renameCol, setRenameCol] = useState<{ id: string; seq: number } | null>(null)
  /** 展开了的「时刻」列 */
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const commit = useCallback(
    (next: BoardDoc) => {
      if (props.readOnly) return
      const out = serializeBoard(next)
      if (out !== text) props.onChange(out)
    },
    [props, text],
  )

  // ---------- 缩放（CN-20）：以鼠标（键盘、菜单是画面正中）为中心，缩完把那一点留在原处 ----------
  const factor = props.zoom > 0 ? scale / props.zoom : 1
  /** 画布左边给工具板让出的宽（只读时没有工具板，不让） */
  const room = props.readOnly ? 0 : PAL_ROOM
  const roomTop = TOP_ROOM
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
    // 画布左边让出了 room（不随缩放变），换算时扣掉
    pendingScroll.current = { left: ((from.left + ax - room) / oldS) * newS - ax + room, top: ((from.top + ay - roomTop) / oldS) * newS - ay + roomTop }
    liveZoom.current = z
    props.onZoom(z)
  }
  const fit = () => {
    const w = wrap.current
    if (!w) return
    const all = Object.values(rects)
    const box = all.length
      ? (() => {
          const x = Math.min(...all.map((r) => r.x))
          const y = Math.min(...all.map((r) => r.y))
          return { x, y, w: Math.max(...all.map((r) => r.x + r.w)) - x, h: Math.max(...all.map((r) => r.y + r.h)) - y }
        })()
      : null
    const z = fitZoom(box, { w: w.clientWidth - room, h: w.clientHeight - roomTop }, factor)
    const s = z * factor
    const to = box ? { left: Math.max(0, (box.x - 40) * s), top: Math.max(0, (box.y - 40) * s) } : { left: 0, top: 0 }
    if (z === liveZoom.current) return void ((w.scrollLeft = to.left), (w.scrollTop = to.top))
    pendingScroll.current = to
    liveZoom.current = z
    props.onZoom(z)
  }
  /** 导图换了布局放不下（鱼骨、时间线、向下常常更宽更高）：缩到整张放得下（只缩不放，最小 50%），滚到整张的左上（designer 复审提的） */
  const fitMap = () => {
    const w = wrap.current
    if (!w || !mapSize.w) return
    const z = Math.min(liveZoom.current, Math.max(0.5, fitZoom({ x: 0, y: 0, w: mapSize.w, h: mapSize.h }, { w: w.clientWidth - room, h: w.clientHeight - roomTop }, factor)))
    const to = { left: 0, top: 0 }
    if (z === liveZoom.current) return void ((w.scrollLeft = to.left), (w.scrollTop = to.top))
    pendingScroll.current = to
    liveZoom.current = z
    props.onZoom(z)
  }
  const zoomRef = useRef({ zoomTo, fit })
  zoomRef.current = { zoomTo, fit }
  if (props.zoomApi) props.zoomApi.current = { step: (d) => zoomTo(stepZoom(liveZoom.current, d)), set: (z) => zoomTo(z), fit }
  useLayoutEffect(() => {
    liveZoom.current = props.zoom
    const p = pendingScroll.current
    pendingScroll.current = null
    if (p && wrap.current) {
      wrap.current.scrollLeft = p.left
      wrap.current.scrollTop = p.top
    }
  }, [scale, props.zoom])
  // 触控板捏合（Chromium 当成按着 ctrl 的滚轮）、按住 ⌘ 滚轮
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
  // ⌘+ / ⌘− / ⌘0 / ⇧⌘1：拦住，不然软件菜单把整个窗口缩放了
  useEffect(() => {
    if (!props.active) return
    const onKey = (e: KeyboardEvent) => {
      if (typingIn(e.target)) return
      // 键照命令表（放大、缩小、原大、适合窗口，设置 › 快捷键里能改）
      const z = zoomRef.current
      if (isKey(e, 'zoom-in')) z.zoomTo(stepZoom(liveZoom.current, 1))
      else if (isKey(e, 'zoom-out')) z.zoomTo(stepZoom(liveZoom.current, -1))
      else if (isKey(e, 'zoom-reset')) z.zoomTo(1)
      else if (isKey(e, 'zoom-fit')) z.fit()
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [props.active])

  // 量每张卡和列在画布上的位置，连线和落点都靠它
  useLayoutEffect(() => {
    const p = plane.current
    if (!p) return
    const base = p.getBoundingClientRect()
    const next: Record<string, Rect> = {}
    for (const [id, el] of els.current) {
      if (!el.isConnected) continue
      const r = el.getBoundingClientRect()
      next[id] = { x: (r.left - base.left) / scale, y: (r.top - base.top) / scale, w: r.width / scale, h: r.height / scale }
    }
    if (JSON.stringify(next) !== JSON.stringify(rects)) setRects(next)
  })

  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 2000)
    return () => clearTimeout(t)
  }, [flash])

  const toPlane = (clientX: number, clientY: number): Pt => {
    const r = plane.current!.getBoundingClientRect()
    return { x: (clientX - r.left) / scale, y: (clientY - r.top) / scale }
  }

  const idx = (id: string) => doc.blocks.findIndex((b) => attr(b, 'id') === id)
  const block = (id: string) => doc.blocks[idx(id)]

  /** 画布上看得到的左上角附近，给新东西找个位置 */
  const freeSpot = (): Pt => {
    const w = wrap.current!
    const n = doc.blocks.length
    return { x: Math.round(w.scrollLeft / scale + 60 + (n % 5) * 24), y: Math.round(w.scrollTop / scale + 60 + (n % 5) * 24) }
  }
  const freeSpotRef = useRef(freeSpot)
  freeSpotRef.current = freeSpot

  function addBlock(kind: 'card' | 'column', at: Pt, body: string) {
    const id = newId(doc)
    commit(kind === 'card' ? addCard(doc, id, body, { at }) : addColumn(doc, id, at))
    return id
  }

  // 拖进来 / 粘贴的图片：存好要等一会儿，那时候白板可能又改过，用最新的
  const latest = useRef(doc)
  latest.current = doc
  const imageDrop = useBoardImageDrop({
    notePath: props.notePath,
    readOnly: props.readOnly,
    toPlane,
    freeSpot,
    onNotice: props.onNotice,
    addCards(texts, at) {
      let next = latest.current
      let last = ''
      texts.forEach((t, i) => {
        last = newId(next)
        next = appendBlock(next, newBlock('card', { id: last, x: Math.round(at.x + i * 24), y: Math.round(at.y + i * 24), w: CARD_W }, t))
      })
      commit(next)
      setFlash(last)
    },
  })

  function removeBlocks(ids: Set<string>) {
    let next: BoardDoc = { ...doc, blocks: doc.blocks.filter((b) => !ids.has(attr(b, 'id') ?? '')) }
    // 列删了，列里的卡放回画布原处
    next = {
      ...next,
      blocks: next.blocks.map((b) => {
        const col = attr(b, 'in')
        if (!col || !ids.has(col)) return b
        const r = rects[attr(b, 'id') ?? '']
        return withAttrs(b, { in: undefined, x: Math.round(r?.x ?? 0), y: Math.round(r?.y ?? 0), w: CARD_W })
      }),
    }
    next = withLinks(next, parseLinks(next).filter((l) => !ids.has(l.from) && !ids.has(l.to)))
    commit(next)
  }

  function setContent(id: string, body: string) {
    const i = idx(id)
    if (i === -1) return
    if (body.trim() === '' && doc.blocks[i]!.kind === 'card') return removeBlocks(new Set([id]))
    commit({ ...doc, blocks: doc.blocks.map((b, j) => (j === i ? withContent(b, body) : b)) })
  }

  /**
   * 改卡的框存下：开框以后外面改过这块白板就合并（第 5 轮：以前拿框里的字直接写进现在的白板，外面改的同一张卡整段没了）。
   * 外面只挪了这张卡、改的是别的卡：两边都留，不出副本；外面也改了这张卡的字、删了这张卡：留我的，外面那版存成冲突副本并在底栏说
   */
  useEffect(() => {
    if (!editing) editBase.current = null
    // 新建的卡：写进文件后才轮到这里，等这张卡出现在白板里再记
    else if (editBase.current?.id !== editing && parseBoard(text).blocks.some((b) => attr(b, 'id') === editing)) editBase.current = { id: editing, text }
  }, [editing, text])
  function saveEdited(id: string, body: string) {
    const base = editBase.current?.id === id ? editBase.current.text : null
    editBase.current = null
    if (base === null || base === text || !parseBoard(base).blocks.some((b) => attr(b, 'id') === id)) return setContent(id, body)
    if (props.readOnly) return
    const r = cardSave(base, text, id, body)
    if (r.kind === 'none') return
    if (r.kind === 'update') {
      props.onChange(r.text)
      if (r.merged) props.onNotice(sayMerged(props.notePath))
      return
    }
    props.onChange(r.text)
    const say = (copy: { path: string } | { error: string }) => (r.deleted ? sayCardBack(copy) : saySameSpot(props.notePath, r.others, copy))
    void window.cn.saveConflictCopy(props.notePath, r.theirs).then(
      (copy) => props.onNotice(say({ path: copy })),
      (e) => props.onNotice(say({ error: String((e as Error).message ?? e) })),
    )
  }

  function setBlockAttrs(id: string, changes: Record<string, string | number | undefined>) {
    commit({ ...doc, blocks: doc.blocks.map((b) => (attr(b, 'id') === id ? withAttrs(b, changes) : b)) })
  }

  /** 工具板上的一样新东西：点一下放在 freeSpot，拖出来放在落点或某一列里（dropped：刚落下的加约 2 秒外圈） */
  async function createFromPal(kind: PalKind, where: Place, dropped: boolean) {
    if (kind === 'column') {
      addBlock('column', 'at' in where ? where.at : freeSpot(), '')
      return
    }
    if (kind === 'board') {
      const name = await props.onCreateSubBoard()
      if (!name) return
      // 起名的新标签已经开了，这中间白板可能又改过，用最新的
      const now = latest.current
      const id = newId(now)
      commit(addCard(now, id, `[[${name}]]`, where))
      if (dropped) setFlash(id)
      return
    }
    const id = newId(doc)
    commit(addCard(doc, id, kind === 'todo' ? TODO_BODY : '', where))
    if (kind === 'card' || kind === 'todo') {
      editRow.current = null
      setEditing(id)
    } else if (dropped) setFlash(id)
  }

  /** 拍导图（task-wuv05）：做好后是这块白板的子白板（和它同一个文件夹），落点一张子白板卡；这篇、导图、照片一次提交，底栏能撤回 */
  function captureMap(where: Place) {
    openCapture({
      into: { path: props.notePath, as: 'board' },
      onPlaced: (r) => {
        const now = latest.current
        const id = newId(now)
        commit(addCard(now, id, `[[${titleOf(r.path)}]]`, where))
        setFlash(id)
        return settlePlaced(props.notePath, r, tNow('导图放在这里：是这块白板的子白板，文件在它旁边'))
      },
    })
  }
  const captureRef = useRef(captureMap)
  captureRef.current = captureMap
  // ⌘K、⇧⌘C、菜单在这块白板前面时拍：同点工具板「拍导图」
  useEffect(() => {
    if (!props.active || props.readOnly) return
    const mine = { path: props.notePath, capture: () => captureRef.current({ at: freeSpotRef.current() }) }
    setBoardCapture(mine)
    return () => setBoardCapture(null, mine)
  }, [props.active, props.readOnly, props.notePath])

  // ---------- 拖动 ----------

  function onBlockDown(e: React.PointerEvent, id: string) {
    if (e.button !== 0 || editing === id || props.readOnly) return
    e.stopPropagation()
    outer.current?.focus({ preventScroll: true })
    setSelLink(null)
    if (e.shiftKey) {
      setSelected((s) => {
        const n = new Set(s)
        if (n.has(id)) n.delete(id)
        else n.add(id)
        return n
      })
      return
    }
    if (!selected.has(id)) setSelected(new Set([id]))
    const r = rects[id]
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    setDrag({ type: 'block', id, start: toPlane(e.clientX, e.clientY), origin: { x: r?.x ?? 0, y: r?.y ?? 0 }, moved: false, delta: { x: 0, y: 0 } })
  }

  const columnAt = (p: Pt, except?: string) => columnIn(doc, rects, p, except)

  /** 这一点是不是画布本身（不是工具板、未整理、AI 浮窗，也不在画布外） */
  function onCanvas(c: Pt): boolean {
    const el = document.elementFromPoint(c.x, c.y)
    return !!el && wrap.current!.contains(el)
  }

  /** 工具板按钮按下：移过 DRAG_SLOP 才算拖；没移就是点一下，照旧交给 onClick */
  const palDragged = useRef(false)
  function startPal(e: React.PointerEvent, kind: PalKind, map = false) {
    palDragged.current = false
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const c = { x: e.clientX, y: e.clientY }
    setDrag({ type: 'pal', kind, start: c, client: c, moved: false, over: false, map })
  }

  /** 拖完松手，浏览器还会在按钮上补一个 click，那一下不算点 */
  function swallowClick() {
    palDragged.current = true
    setTimeout(() => (palDragged.current = false), 0)
  }

  function cardAt(p: Pt): string | null {
    for (const b of [...doc.blocks].reverse()) {
      if (b.kind !== 'card') continue
      const id = attr(b, 'id')!
      const r = rects[id]
      if (r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return id
    }
    return null
  }

  function onMove(e: React.PointerEvent) {
    if (!drag) return
    if (drag.type === 'block') {
      const p = toPlane(e.clientX, e.clientY)
      const delta = { x: p.x - drag.start.x, y: p.y - drag.start.y }
      const moved = drag.moved || Math.abs(delta.x) + Math.abs(delta.y) > 3
      setDrag({ ...drag, delta, moved })
      const b = block(drag.id)
      setDropCol(moved && b?.kind === 'card' ? columnAt(p, drag.id) : null)
    } else if (drag.type === 'link') {
      setDrag({ ...drag, to: toPlane(e.clientX, e.clientY) })
    } else if (drag.type === 'pal') {
      const client = { x: e.clientX, y: e.clientY }
      const moved = drag.moved || movedEnough(drag.start, client)
      const over = moved && onCanvas(client)
      setDrag({ ...drag, client, moved, over })
      setDropCol(over && drag.kind !== 'column' ? columnAt(toPlane(client.x, client.y)) : null)
    } else {
      setDrag({ ...drag, at: toPlane(e.clientX, e.clientY), client: { x: e.clientX, y: e.clientY } })
    }
  }

  function onUp(e: React.PointerEvent) {
    if (!drag) return
    const p = toPlane(e.clientX, e.clientY)
    setDrag(null)
    setDropCol(null)
    if (drag.type === 'link') {
      const to = cardAt(p)
      if (to && to !== drag.from && !links.some((l) => l.from === drag.from && l.to === to)) commit(withLinks(doc, [...links, { from: drag.from, to }]))
      return
    }
    if (drag.type === 'pal') {
      if (!drag.moved) return
      swallowClick()
      if (!onCanvas({ x: e.clientX, y: e.clientY })) return
      // 列只放在画布上；卡片、待办、子白板落在列上就进那一列
      const col = drag.kind === 'column' ? null : columnAt(p)
      if (drag.map) {
        // 拍导图拖到白板上：拍好、做成导图白板后，它是这块白板的子白板，落点放一张子白板卡
        captureMap(col ? { column: col, slot: slotInColumn(doc, rects, col, p.y) } : { at: dropOrigin(p) })
        return
      }
      void createFromPal(drag.kind, col ? { column: col, slot: slotInColumn(doc, rects, col, p.y) } : { at: dropOrigin(p) }, true)
      return
    }
    if (drag.type === 'loose') {
      const r = wrap.current!.getBoundingClientRect()
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return
      void placeUnsorted(drag, p)
      return
    }
    if (!drag.moved) return
    const i = idx(drag.id)
    const b = doc.blocks[i]
    if (!b) return
    const x = Math.round(drag.origin.x + drag.delta.x)
    const y = Math.round(drag.origin.y + drag.delta.y)
    if (b.kind === 'column') return setBlockAttrs(drag.id, { x, y })
    const col = columnAt(p, drag.id)
    // 放进列：按落点的高低排在列里，文件里也挪到那个位置
    if (col) return commit(putInColumn(doc, i, col, slotInColumn(doc, rects, col, p.y, drag.id)))
    setBlockAttrs(drag.id, { in: undefined, x, y, w: attr(b, 'in') ? CARD_W : attr(b, 'w') })
  }

  async function placeUnsorted(d: Extract<Drag, { type: 'loose' }>, at: Pt) {
    const pos = { x: Math.round(at.x - 40), y: Math.round(at.y - 20) }
    if (!d.inboxPath) return
    const note = await window.cn.readNote(d.inboxPath)
    const body = note.text.replace(/^---\n[\s\S]*?\n---\n?/, '').trim()
    if (isWholeDoc(note.text, body)) {
      // 整页剪藏这类长的：那篇挪到「素材/<这块白板>/」，白板上放一张指向它的卡片（标题、来源、几行摘要），双击看全文
      // 挪过去（不是新建一篇再删）：附件文件夹跟着挪、图片的相对链接跟着改（剪藏时存下的图）
      const moved = (await window.cnMenu.moveNote(d.inboxPath, `${CLIPS}/${titleOf(props.notePath)}`)).to
      const id = addBlock('card', pos, `[[${titleOf(moved)}]]`)
      setFlash(id)
      return
    }
    // 收件箱里短的一条：内容放成卡片，收件箱那篇移到废纸篓
    const id = addBlock('card', pos, body)
    setFlash(id)
    await window.cn.trashNote(d.inboxPath)
  }

  // ---------- 键盘 ----------

  function onKey(e: React.KeyboardEvent) {
    if (drag?.type === 'pal' && e.key === 'Escape') {
      // 拖到一半按 esc：不放了，松手后的 click 也不算点
      palDragged.current = true
      setDrag(null)
      setDropCol(null)
      e.preventDefault()
      return
    }
    if (editing) return
    // 焦点在输入框里（改列名、待办标题、卡片改字……）：⌫、Delete、⌘Z、Esc 都是改字，不删选中的列和卡片（第 8 轮：改新列的名字按 ⌫ 整列被删）
    if (typingIn(e.target)) return
    if ((e.key === 'Backspace' || e.key === 'Delete') && !props.readOnly) {
      if (selLink) {
        commit(withLinks(doc, links.filter((l) => `${l.from}>${l.to}` !== selLink)))
        setSelLink(null)
      } else if (selected.size) {
        removeBlocks(selected)
        setSelected(new Set())
      }
      e.preventDefault()
    } else if (e.metaKey && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      if (e.shiftKey) props.onRedo()
      else props.onUndo()
    } else if (e.key === 'Escape') {
      setSelected(new Set())
      setSelLink(null)
    }
  }

  // ---------- 右键（DESIGN.v3 9.2）：卡片、选了几张、空白处、连线、列 ----------

  /** 卡片转成文档：开头一行当名字，新建在这块白板旁边，卡片换成指向它的双链 */
  async function cardToDoc(id: string, body: string) {
    const first = body.split('\n').find((l) => l.trim())?.replace(/^[#>*\-\s\[\]x]+/i, '').replace(/[*_`[\]]/g, '').trim() ?? ''
    const name = first.slice(0, 40) || '卡片' // 不翻：新建文档的文件名，写进库里
    const dir = props.notePath.includes('/') ? props.notePath.slice(0, props.notePath.lastIndexOf('/')) : ''
    const text = /^#\s/.test(body.trimStart()) ? body.trim() + '\n' : `# ${name}\n\n${body.trim()}\n`
    const path = await window.cn.createNote(dir, name, text)
    const now = latest.current
    commit({ ...now, blocks: now.blocks.map((b) => (attr(b, 'id') === id ? withContent(b, `[[${titleOf(path)}]]`) : b)) })
    app().refresh()
    props.onNotice(t('转成了文档「{name}」，卡片指向它', { name: titleOf(path) }))
  }

  function cardMenu(id: string): MenuEntry[] {
    const b = block(id)
    if (!b) return []
    const body = content(b)
    const info = classify(body, notes)
    const target = info.kind === 'board' ? info.boardPath : info.kind === 'doc' ? info.docPath : undefined
    const col = attr(b, 'in')
    return [
      target
        ? { label: t('打开'), run: () => props.onOpen(target) }
        : !videoUrlOfCard(body) && { label: t('编辑'), run: () => ((editRow.current = null), setEditing(id)) },
      { label: t('复制一份'), run: () => {
          const r = duplicateCard(doc, id)
          commit(r.doc)
          setFlash(r.id)
        } },
      col && { label: t('从列里拿出来'), run: () => commit(takeOut(doc, id, rects[id])) },
      '-',
      body.trim() && { label: t('问 AI 这张'), ai: 'chat', run: () => app().askAi(body) },
      // 「问 AI 这张」带引擎标志，自成一组
      '-',
      !target && body.trim() && { label: t('转成文档'), run: () => cardToDoc(id, body) },
      '-',
      { label: t('删除', { ctx: '白板菜单' }), accel: accelFor('delete'), run: () => (removeBlocks(new Set([id])), setSelected(new Set())) },
    ]
  }

  function manyMenu(ids: Set<string>): MenuEntry[] {
    return [
      { label: t('左对齐'), run: () => commit(align(doc, ids, 'left')) },
      { label: t('顶对齐'), run: () => commit(align(doc, ids, 'top')) },
      { label: t('排整齐'), run: () => commit(tidyGrid(doc, ids, rects)) },
      '-',
      { label: t('放进新列'), run: () => commit(intoNewColumn(doc, ids, rects)) },
      '-',
      { label: t('删除 {n} 张', { n: ids.size }), accel: accelFor('delete'), run: () => (removeBlocks(ids), setSelected(new Set())) },
    ]
  }

  async function emptyMenu(at: Pt): Promise<MenuEntry[]> {
    const clip = await window.cnMenu.clipboardHas()
    return [
      { label: t('新卡片'), run: () => setEditing(addBlock('card', at, '')) },
      { label: t('新待办'), run: () => createFromPal('todo', { at }, false) },
      { label: t('新列'), run: () => createFromPal('column', { at }, false) },
      { label: t('新子白板'), run: () => createFromPal('board', { at }, true) },
      '-',
      {
        label: t('拍导图'),
        accel: accelFor('capture'),
        run: () => captureMap({ at }),
      },
      '-',
      // 剪贴板里是图：交给白板接粘贴的那条路（存进附件、放图片卡）；是字：在点的地方放一张卡
      clip.image
        ? { edit: 'paste' }
        : { label: t('粘贴'), accel: accelFor('paste'), enabled: clip.text, run: async () => {
            const t = (await window.cnMenu.readClipboardText()).trim()
            if (!t) return
            const now = latest.current
            const id = newId(now)
            commit(addCard(now, id, t, { at }))
            setFlash(id)
          } },
    ]
  }

  async function onContext(e: React.MouseEvent) {
    const t = e.target as HTMLElement
    // 正在编辑的卡片、工具板、未整理、导图：交给输入框的标准菜单或不弹
    if (props.readOnly || t.closest('input, textarea, [contenteditable="true"], .bpal, .db-inbox-pop, .mm-layer')) return
    e.preventDefault()
    e.stopPropagation()
    outer.current?.focus({ preventScroll: true })
    const wireEl = t.closest<SVGElement>('[data-link]')
    const cardEl = t.closest<HTMLElement>('.bcard')
    const colEl = t.closest<HTMLElement>('.bcol')
    let items: MenuEntry[]
    if (wireEl) {
      const key = wireEl.dataset.link!
      setSelLink(key)
      setSelected(new Set())
      items = [{ label: tNow('删除连线'), accel: accelFor('delete'), run: () => (commit(withLinks(doc, links.filter((l) => `${l.from}>${l.to}` !== key))), setSelLink(null)) }]
    } else if (cardEl?.dataset.id) {
      const id = cardEl.dataset.id
      setSelLink(null)
      if (selected.has(id) && selected.size > 1) items = manyMenu(selected)
      else {
        setSelected(new Set([id]))
        items = cardMenu(id)
      }
    } else if (colEl?.dataset.id) {
      const id = colEl.dataset.id
      setSelected(new Set([id]))
      items = [
        { label: tNow('改名'), run: () => setRenameCol((r) => ({ id, seq: (r?.seq ?? 0) + 1 })) },
        '-',
        { label: tNow('删除列（卡片留下）'), run: () => (removeBlocks(new Set([id])), setSelected(new Set())) },
      ]
    } else items = await emptyMenu(toPlane(e.clientX, e.clientY))
    await showMenu(items)
  }

  // ---------- 画 ----------

  const free = doc.blocks.filter((b) => !attr(b, 'in') && attr(b, 'id'))
  const extent = free.reduce(
    (m, b) => ({ w: Math.max(m.w, num(b, 'x', 0) + num(b, 'w', CARD_W) + 600), h: Math.max(m.h, num(b, 'y', 0) + 900) }),
    { w: Math.max(2400, mapSize.w + 600), h: Math.max(1600, mapSize.h + 600) },
  )

  const dragOffset = (id: string) =>
    drag?.type === 'block' && drag.moved && drag.id === id
      ? { transform: `translate(${drag.delta.x}px, ${drag.delta.y}px)`, zIndex: 50 }
      : undefined

  const renderCard = (b: (typeof doc.blocks)[number], inColumn: boolean, small = false) => {
    const id = attr(b, 'id')!
    const body = content(b)
    const info = classify(body, notes)
    const isSel = selected.has(id)
    const style: React.CSSProperties = inColumn
      ? { ...dragOffset(id) }
      : { left: num(b, 'x', 0), top: num(b, 'y', 0), width: num(b, 'w', CARD_W), ...dragOffset(id) }
    return (
      <div
        key={id}
        ref={(el) => {
          if (el) els.current.set(id, el)
          else els.current.delete(id)
        }}
        className={`bcard k-${info.kind}${inColumn ? ' incol' : ''}${small ? ' small' : ''}${isSel ? ' sel' : ''}${flash === id ? ' flash' : ''}`}
        style={style}
        data-id={id}
        onPointerDown={(e) => onBlockDown(e, id)}
        onDoubleClick={(e) => {
          e.stopPropagation()
          if (info.kind === 'board' && info.boardPath) props.onOpen(info.boardPath)
          else if (info.kind === 'doc' && info.docPath) props.onOpen(info.docPath)
          else if ((info.kind === 'video' || info.kind === 'moment') && videoUrlOfCard(body)) {
            // 视频卡：右栏打开，从上次看到的地方接着播；时刻卡：跳回那一秒
            const v = videoUrlOfCard(body)!
            void openVideo(v.url, v.resume)
          }
          else if (!props.readOnly) {
            // 双击待办的某一行：编辑器打开后光标落在那一行
            const row = (e.target as HTMLElement).closest('[data-row]')
            editRow.current = row ? Number(row.getAttribute('data-row')) : null
            setEditing(id)
          }
        }}
      >
        {editing === id && info.kind === 'todo' ? (
          <TodoEditor
            initial={body}
            onDraft={props.onDraft}
            focusLine={editRow.current}
            onDone={(v) => {
              setEditing(null)
              if (v !== null) saveEdited(id, v)
            }}
          />
        ) : editing === id ? (
          <CardEditor
            initial={body}
            notePath={props.notePath}
            onNotice={props.onNotice}
            onDraft={props.onDraft}
            onDone={(v) => {
              setEditing(null)
              if (v !== null) saveEdited(id, v)
              else if (body.trim() === '') removeBlocks(new Set([id]))
            }}
          />
        ) : (
          <CardBody
            text={body}
            info={info}
            notes={notes}
            notePath={props.notePath}
            small={small}
            videoStats={info.kind === 'video' ? boardMomentStats(text, videoKeyOfCard(body) ?? '') : undefined}
            onToggle={(line) => {
              const ls = body.split('\n')
              ls[line] = ls[line]!.replace(/\[( |x|X)\]/, (m) => (m === '[ ]' ? '[x]' : '[ ]'))
              setContent(id, ls.join('\n'))
            }}
          />
        )}
        {attr(b, 'ai') && editing !== id && <div className="aifoot">{t('AI总结的 · {engine}', { engine: attr(b, 'ai') })}</div>}
        {!props.readOnly && editing !== id && (
          <span
            className="handle"
            title={t('拖到另一张卡上连线')}
            onPointerDown={(e) => {
              e.stopPropagation()
              ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
              setDrag({ type: 'link', from: id, to: toPlane(e.clientX, e.clientY) })
            }}
          />
        )}
      </div>
    )
  }

  // 右栏大纲点了一张卡片或一列：滚到正中、选中，闪一下
  useEffect(
    () =>
      onFlyToCard(props.notePath, (id) => {
        const w = wrap.current
        const el = w?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`)
        if (!w || !el) return
        const wr = w.getBoundingClientRect()
        const r = el.getBoundingClientRect()
        w.scrollTo({ left: w.scrollLeft + r.left - wr.left - (wr.width - r.width) / 2, top: w.scrollTop + r.top - wr.top - (wr.height - r.height) / 2, behavior: 'smooth' })
        setSelected(new Set([id]))
        el.classList.remove('flown')
        void el.offsetWidth
        el.classList.add('flown')
      }),
    [props.notePath],
  )

  return (
    <div
      className={'board' + (imageDrop.dropping ? ' dropping' : '')}
      // 卡里的 [字](链接) 相对这块白板认（cite.tsx）
      data-cite-base={props.notePath}
      ref={outer}
      tabIndex={0}
      onKeyDown={onKey}
      onPointerMove={onMove}
      onPointerUp={onUp}
      {...imageDrop.handlers}
      onContextMenu={(e) => void onContext(e)}
      data-testid="board"
    >
    <div
      className="board-wrap"
      ref={wrap}
      onPointerDown={(e) => {
        // 右键不清选中：选了几张再右键是对这几张做
        if (e.button === 2) return
        setSelected(new Set())
        setSelLink(null)
        outer.current?.focus({ preventScroll: true })
      }}
      onDoubleClick={(e) => {
        if (props.readOnly || e.target !== plane.current) return
        const id = addBlock('card', toPlane(e.clientX, e.clientY), '')
        setEditing(id)
      }}
    >
      <div className="plane" ref={plane} style={{ width: extent.w, height: extent.h, marginLeft: room, marginTop: roomTop, transform: `scale(${scale})` }}>
        <svg className="wires" width={extent.w} height={extent.h}>
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
              <path d="M0,1 L9,5 L0,9" fill="none" stroke="var(--wire)" strokeWidth="1.4" />
            </marker>
            <marker id="arrow-sel" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
              <path d="M0,1 L9,5 L0,9" fill="none" stroke="var(--acc)" strokeWidth="1.4" />
            </marker>
          </defs>
          {links.map((l) => {
            const seg = wire(rects[l.from], rects[l.to])
            if (!seg) return null
            const key = `${l.from}>${l.to}`
            const on = selLink === key
            return (
              <g key={key} className={'wire' + (on ? ' on' : '')} data-link={key}>
                <line x1={seg[0].x} y1={seg[0].y} x2={seg[1].x} y2={seg[1].y} className="hit" onPointerDown={(e) => (e.stopPropagation(), setSelLink(key), setSelected(new Set()), outer.current?.focus())} />
                <line x1={seg[0].x} y1={seg[0].y} x2={seg[1].x} y2={seg[1].y} className="vis" markerEnd={on ? 'url(#arrow-sel)' : 'url(#arrow)'} />
              </g>
            )
          })}
          {drag?.type === 'link' && rects[drag.from] && (
            <line
              x1={rects[drag.from]!.x + rects[drag.from]!.w}
              y1={rects[drag.from]!.y + rects[drag.from]!.h / 2}
              x2={drag.to.x}
              y2={drag.to.y}
              className="vis pending"
            />
          )}
        </svg>

        {/* 在这块白板里找（⇧⌘F）：卡片里的字；导图白板由导图自己找 */}
        <BoardFind root={() => outer.current} cards=".bcard" on={!mindmap} owner={props.notePath} />
        {mindmap && (
          <MindmapLayer
            text={text}
            notePath={props.notePath}
            scale={scale}
            readOnly={props.readOnly}
            overlay={outer.current}
            onChange={props.onChange}
            onUndo={props.onUndo}
            onRedo={props.onRedo}
            onSize={(w, h) => setMapSize((m) => (m.w === w && m.h === h ? m : { w, h }))}
            onFit={fitMap}
            onNotice={props.onNotice}
          />
        )}

        {doc.blocks.map((b) => {
          const id = attr(b, 'id')
          if (!id || attr(b, 'in')) return null
          if (b.kind === 'card') return renderCard(b, false)
          const members = doc.blocks.filter((x) => attr(x, 'in') === id && x.kind === 'card')
          // 视频的「时刻」列：最新的在上面放大，最多摆 3 张，多的收成一行（偏好「别把上万条全铺开」）
          const moments = attr(b, 'moments')
          const open = expanded.has(id)
          const shown = moments && !open ? members.slice(0, 3) : members
          const videoTitle = moments ? momentsTitle(doc, moments) : ''
          return (
            <div
              key={id}
              ref={(el) => {
                if (el) els.current.set(id, el)
                else els.current.delete(id)
              }}
              className={'bcol' + (selected.has(id) ? ' sel' : '') + (dropCol === id ? ' drop' : '')}
              style={{ left: num(b, 'x', 0), top: num(b, 'y', 0), width: num(b, 'w', COL_W), ...dragOffset(id) }}
              data-id={id}
            >
              <ColumnTitle
                title={attr(b, 'title') ?? t('新的列')}
                count={members.length}
                sub={videoTitle}
                moments={!!moments}
                onDown={(e) => onBlockDown(e, id)}
                onRename={(t) => setBlockAttrs(id, { title: t })}
                editSeq={renameCol?.id === id ? renameCol.seq : 0}
              />
              {shown.map((m, i) => renderCard(m, true, !!moments && i > 0))}
              {moments && members.length > 3 && (
                <button
                  type="button"
                  className="col-more"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() =>
                    setExpanded((x) => {
                      const n = new Set(x)
                      if (n.has(id)) n.delete(id)
                      else n.add(id)
                      return n
                    })
                  }
                >
                  {open ? t('收起，只摆最近3个') : t('还有{n}个，按时间排', { n: members.length - 3 })}
                </button>
              )}
              {members.length === 0 && <div className="col-empty">{t('把卡片拖进来')}</div>}
            </div>
          )
        })}
      </div>
    </div>

      {!props.readOnly && (
        <div className="bpal" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          {PAL.map((it) => (
            <button
              key={it.kind}
              data-tip={t('{name}：点一下，或按住拖到白板上', { name: t(it.title, { ctx: '工具板提示' }) })}
              data-side="right"
              onPointerDown={(e) => startPal(e, it.kind)}
              onClick={() => {
                if (palDragged.current) return
                void createFromPal(it.kind, { at: freeSpot() }, false)
              }}
            >
              <Codicon name={it.icon} size={16} />
              <span>{t(it.label, { ctx: '工具板' })}</span>
            </button>
          ))}
          <hr />
          <button
            data-tip={t('拍一张导图：点一下，或按住拖到白板上（做好后是这块白板的子白板）')}
            data-key={keyFor('capture') ?? undefined}
            data-side="right"
            onPointerDown={(e) => startPal(e, 'board', true)}
            onClick={() => {
              if (palDragged.current) return
              captureMap({ at: freeSpot() })
            }}
          >
            <Codicon name="device-camera" size={16} />
            <span>{t('拍导图', { ctx: '工具板' })}</span>
          </button>
        </div>
      )}
      {drag?.type === 'pal' && drag.moved && outer.current && (
        <PalGhost kind={drag.kind} client={drag.client} over={drag.over} scale={scale} board={outer.current} />
      )}

      {props.corner}
      {/* 收件箱：弹窗（和别的白板一样，doc-board/inbox.tsx），右上角「收件箱 N」或 ⇧⌘I 打开 */}
      {inboxOpen && props.active && (
        <InboxPop
          items={inbox}
          readOnly={props.readOnly}
          onItemDown={(e, n) => !props.readOnly && setDrag({ type: 'loose', key: n.path, text: n.excerpt || n.preview || titleOf(n.path), inboxPath: n.path, at: toPlane(e.clientX, e.clientY), client: { x: e.clientX, y: e.clientY } })}
        />
      )}
      {drag?.type === 'loose' && (
        <div className="board-ghost" style={{ left: drag.client.x, top: drag.client.y }}>
          {previewOf(drag.text, 60)}
        </div>
      )}
      {/* AI 在这块白板上动手：外圈、顶上「AI 正在整理这块白板 · 停下 esc」、AI 指针、正在挪的那张外圈（DESIGN.v3 2.3） */}
      <AiActLayer area="board" path={props.notePath} host={outer} />
    </div>
  )

  function startLoose(e: React.PointerEvent, d: { key: string; text: string; inboxPath?: string }) {
    if (props.readOnly) return
    e.stopPropagation()
    outer.current!.setPointerCapture(e.pointerId)
    setDrag({ type: 'loose', ...d, at: toPlane(e.clientX, e.clientY), client: { x: e.clientX, y: e.clientY } })
  }
}

/** 从工具板拖出来时跟着鼠标的半透明预览：样子和大小跟落下后差不多，跟着白板缩放；不在画布上（松手会取消）时更淡 */
function PalGhost(props: { kind: PalKind; client: Pt; over: boolean; scale: number; board: HTMLElement }) {
  const t = useT()
  const { kind, scale } = props
  const base = props.board.getBoundingClientRect()
  const size = PAL_SIZE[kind]
  const style: React.CSSProperties = {
    left: props.client.x - base.left - GRAB.x * scale,
    top: props.client.y - base.top - GRAB.y * scale,
    width: size.w,
    minHeight: size.h,
    transform: `scale(${scale})`,
  }
  const cls = 'pal-ghost' + (props.over ? '' : ' off')
  if (kind === 'column')
    return (
      <div className={cls + ' bcol'} style={style} data-testid="pal-ghost" data-kind={kind}>
        <h3>
          {t('新的列')}
          <span className="meta num">{t('{n}张卡片', { n: 0 })}</span>
        </h3>
        <div className="col-empty">{t('把卡片拖进来')}</div>
      </div>
    )
  return (
    <div className={`${cls} bcard k-${kind === 'card' ? 'note' : kind}`} style={style} data-testid="pal-ghost" data-kind={kind}>
      {kind === 'card' && (
        <div className="cb-note">
          <p className="ph">{t('新卡片')}</p>
        </div>
      )}
      {kind === 'todo' && <CardBody text={TODO_BODY} info={{ kind: 'todo' }} notes={[]} onToggle={() => {}} />}
      {kind === 'board' && (
        <div className="cb-board">
          <span className="sq" />
          <span>
            <b>{t('子白板')}</b>
            <span className="meta num">{t('{n}张卡片', { n: 0 })}</span>
          </span>
        </div>
      )}
    </div>
  )
}

/** 速记这类没标题的：文件名就是正文开头几个字，卡上不再重复一遍 */
export const sameStart = (n: NoteFile) => !!n.excerpt && n.excerpt.startsWith(titleOf(n.path))

function ColumnTitle(props: { title: string; count: number; sub?: string; /** 视频列：数的是时刻（「N个」） */ moments?: boolean; onDown(e: React.PointerEvent): void; onRename(t: string): void; editSeq: number }) {
  const t = useT()
  const [edit, setEdit] = useState(false)
  // 右键「改名」
  useEffect(() => {
    if (props.editSeq) setEdit(true)
  }, [props.editSeq])
  if (edit)
    return (
      <input
        className="col-title-input"
        aria-label={t('列名')}
        defaultValue={props.title}
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        onPointerDown={(e) => e.stopPropagation()}
        onBlur={(e) => {
          setEdit(false)
          const v = e.currentTarget.value.trim()
          if (v && v !== props.title) props.onRename(v)
        }}
        onKeyDown={(e) => {
          if (composing(e)) return
          if (e.key === 'Enter') (e.preventDefault(), e.currentTarget.blur())
          if (e.key === 'Escape') (e.preventDefault(), (e.currentTarget.value = props.title), e.currentTarget.blur())
        }}
      />
    )
  return (
    <h3 onPointerDown={props.onDown} onDoubleClick={(e) => (e.stopPropagation(), setEdit(true))}>
      {props.title}
      {props.sub && <span className="col-sub">{props.sub}</span>}
      {/* 数和单位写成一个文本节点（DESIGN.md 字体那条，统一写法） */}
      <span className="meta num">{props.moments ? t('{n}个', { ctx: '视频时刻', n: props.count }) : t('{n}张卡片', { n: props.count })}</span>
    </h3>
  )
}

/** 整页剪藏（frontmatter 里有 source、正文有标题）或很长的一篇：不拆成卡片，放一张指向它的卡片 */
function isWholeDoc(text: string, body: string): boolean {
  return (/^---\n[\s\S]*?\nsource:/.test(text) && /^# /m.test(body)) || body.length > 800
}

/** 待办卡片的编辑：标题一行，下面每条一行勾选框加输入框；回车加一条，空着按退格删这条，esc 不改，点别处存 */
function TodoEditor(props: { initial: string; focusLine: number | null; onDraft: BoardViewProps['onDraft']; onDone(v: string | null): void }) {
  const t = useT()
  const lines = props.initial.split('\n')
  const head = lines[0] && !TODO.test(lines[0]) ? lines[0].replace(/^#+\s*|\*\*/g, '').trim() : ''
  const [title, setTitle] = useState(head)
  const [rows, setRows] = useState(() => {
    const r = lines
      .map((l, i) => ({ m: TODO.exec(l), i }))
      .filter((x) => x.m)
      .map((x) => ({ key: x.i, done: x.m![1] !== ' ', text: x.m![2] ?? '' }))
    return r.length ? r : [{ key: 0, done: false, text: '' }]
  })
  const box = useRef<HTMLDivElement>(null)
  const focusAt = useRef<number | null>(null)
  const done = useRef(false)
  const nextKey = useRef(1000)
  const state = useRef({ title, rows })
  state.current = { title, rows }

  const finish = (save: boolean) => {
    if (done.current) return
    done.current = true
    if (!save) return props.onDone(null)
    const { title: tt, rows: rs } = state.current
    const kept = rs.filter((r) => r.text.trim())
    const out = [tt.trim() ? `**${tt.trim()}**` : null, ...(kept.length ? kept : [{ done: false, text: '' }]).map((r) => `- [${r.done ? 'x' : ' '}] ${r.text.trim()}`)]
    props.onDone(out.filter((l) => l !== null).join('\n'))
  }
  useDraft(props.onDraft, () => finish(true))

  useLayoutEffect(() => {
    const inputs = box.current!.querySelectorAll<HTMLInputElement>('input[type=text]')
    const at = props.focusLine === null ? -1 : rows.findIndex((r) => r.key === props.focusLine)
    const el = props.focusLine === 0 && head ? inputs[0] : inputs[at >= 0 ? at + 1 : inputs.length - 1]
    el?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useLayoutEffect(() => {
    if (focusAt.current === null) return
    box.current!.querySelectorAll<HTMLInputElement>('input[type=text]')[focusAt.current + 1]?.focus()
    focusAt.current = null
  })

  const update = (i: number, p: Partial<{ done: boolean; text: string }>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)))

  return (
    <div
      ref={box}
      className="cb-todo todo-edit"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={(e) => {
        if (!box.current!.contains(e.relatedTarget as Node | null)) finish(true)
      }}
      onKeyDown={(e) => {
        if (closesTab(e)) return
        e.stopPropagation()
        if (composing(e)) return
        // Esc 收起并存下，和文字卡一样（第 4 轮）
        if (e.key === 'Escape' || (e.key === 'Enter' && e.metaKey)) (e.preventDefault(), finish(true), backToBoard(e.currentTarget))
      }}
    >
      <input
        type="text"
        className="todo-title"
        aria-label={t('待办标题')}
        placeholder={t('标题（可不写）')}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.metaKey && !e.nativeEvent.isComposing) (e.preventDefault(), (focusAt.current = 0), setRows((r) => [...r]))
        }}
      />
      {rows.map((r, i) => (
        <div key={r.key} className={'td' + (r.done ? ' done' : '')}>
          <input type="checkbox" aria-label={t('做完了')} checked={r.done} onChange={() => update(i, { done: !r.done })} />
          <input
            type="text"
            aria-label={t('待办事项')}
            placeholder={t('写一条，回车加下一条')}
            value={r.text}
            onChange={(e) => update(i, { text: e.target.value })}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.metaKey) return
              if (e.key === 'Enter') {
                e.preventDefault()
                focusAt.current = i + 1
                setRows((rs) => [...rs.slice(0, i + 1), { key: nextKey.current++, done: false, text: '' }, ...rs.slice(i + 1)])
              } else if (e.key === 'Backspace' && r.text === '' && rows.length > 1) {
                e.preventDefault()
                focusAt.current = Math.max(0, i - 1)
                setRows((rs) => rs.filter((_, j) => j !== i))
              } else if (e.key === 'ArrowDown' && i < rows.length - 1) (e.preventDefault(), (focusAt.current = i + 1), setRows((rs) => [...rs]))
              else if (e.key === 'ArrowUp') (e.preventDefault(), (focusAt.current = i - 1), setRows((rs) => [...rs]))
            }}
          />
        </div>
      ))}
      <div className="todo-hint">{t('回车加一条 · 空着按退格删掉 · {key} 或点别处存', { key: String(keyFor('submit')) })}</div>
    </div>
  )
}

/** 用键盘收起改卡（Esc、⌘↵）后焦点回到白板：接着按 ⌘Z 撤回、退格删卡都在白板上 */
function backToBoard(from: HTMLElement) {
  from.closest<HTMLElement>('.board')?.focus({ preventScroll: true })
}

/** ⌘W：改卡的框开着也照样关标签（以前框把所有键都拦下，⌘W 没反应，标签不关、字也不存） */
const closesTab = (e: React.KeyboardEvent) => e.metaKey && !e.altKey && !e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'w'

/**
 * 双击卡片改字：在排好的样子上就地改（和文档、文档切成的白板同一套所见即所得，doc-board/unit-editor.tsx），
 * 剪藏卡的出处链接、加粗、双链都不露写法（偏好：剪藏卡片别露原文、只文档白板不露源码）。
 * 点别处、Esc、⌘↵ 都存下；⌘W 交给软件关标签（关之前先把框里的字存回去）
 */
function CardEditor(props: { initial: string; notePath: string; onNotice(t: string): void; onDraft: BoardViewProps['onDraft']; onDone(v: string | null): void }) {
  const t = useT()
  const box = useRef<HTMLDivElement>(null)
  const value = useRef(props.initial)
  const done = useRef(false)
  const finish = (v: string | null) => {
    if (done.current) return
    done.current = true
    props.onDone(v)
  }
  useDraft(props.onDraft, () => finish(value.current))
  // Esc 收起并存下（第 4 轮：以前直接丢掉打的字；文档白板的「改字」弹层 Esc 是存下，两处一样；改错了 ⌘Z 撤回）。
  // 新建的空卡一个字没打就按 Esc：照旧当没建（null，卡拿掉）。
  // 编辑器只在打开时建一次，键里调的是这一次渲染的 finish（onDone 里要用白板现在的字，外面改过时才按三方合并）
  const live = useRef({ finish, initial: props.initial })
  live.current = { finish, initial: props.initial }
  const keys = useRef([
    {
      key: 'Escape',
      run: (v0: EditorView) => {
        if (v0.composing) return false
        const v = value.current
        const el = box.current!
        live.current.finish(v.trim() === '' && live.current.initial.trim() === '' ? null : v)
        backToBoard(el)
        return true
      },
    },
    {
      key: 'Mod-Enter',
      run: (v0: EditorView) => {
        if (v0.composing) return false
        const el = box.current!
        live.current.finish(value.current)
        backToBoard(el)
        return true
      },
    },
  ]).current
  return (
    <div
      ref={box}
      className="card-edit"
      onPointerDown={(e) => e.stopPropagation()}
      // 焦点离开这张卡（点了白板、别的卡、别的地方）才收起；焦点进了卡里表格的格子不算
      onBlur={(e) => !box.current!.contains(e.relatedTarget as Node | null) && finish(value.current)}
      onKeyDown={(e) => {
        // ⌘W 交给软件关标签；别的键都留在卡里（白板的退格删卡、⌘D 复制这些不接）
        if (closesTab(e)) return
        e.stopPropagation()
      }}
    >
      <UnitEditor text={props.initial} notePath={props.notePath} label={t('卡片内容')} keys={keys} className="card-ed" onChange={(v) => (value.current = v)} onNotice={props.onNotice} />
    </div>
  )
}

/** 两张卡之间的线：从中心连中心，切掉卡片里面那段 */
function wire(a?: Rect, b?: Rect): [Pt, Pt] | null {
  if (!a || !b) return null
  const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 }
  const cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 }
  return [edge(a, ca, cb, 2), edge(b, cb, ca, 4)]
}

function edge(r: Rect, c: Pt, toward: Pt, gap: number): Pt {
  const dx = toward.x - c.x
  const dy = toward.y - c.y
  if (dx === 0 && dy === 0) return c
  const tx = dx === 0 ? Infinity : (r.w / 2 + gap) / Math.abs(dx)
  const ty = dy === 0 ? Infinity : (r.h / 2 + gap) / Math.abs(dy)
  const t = Math.min(tx, ty)
  return { x: c.x + dx * t, y: c.y + dy * t }
}

export type { Link }
