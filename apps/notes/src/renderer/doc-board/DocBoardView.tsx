/**
 * 白板 = 这篇文档的另一种看法（2026-11-21 方向 A「一份文字两种看法」，小样 board-doc 的 proto-a.html；DESIGN.v3 6.6）：
 * 一篇文档（type: board 的也是）按 packages/format/src/doc-board.ts 的规则切成列和卡，摆在点阵上。切过去只看，一个字节不写。
 * - 左边工具板（卡片、待办、列、数据库、子白板｜拍导图）：点一下放进屏幕正中那一列的最后，拖到哪放哪；卡片、待办当场出一张空卡就地写，
 *   打 / 出和文档同一个插入菜单（InlineCard）；数据库弹小菜单挑一个，放一张小表卡，「展开」原地长成整张表（base-card.tsx）；
 * - 收件箱弹窗（inbox.tsx，白板右上角「收件箱 N」或 ⇧⌘I 打开，盖在白板上不占宽）：拖进一列就插进那一节，拖到空白处加在文末带一行位置；
 * - 拖一张卡进别的列（或同一列里上下挪）：文档里这段也挪进那一节；拖到空白处：这段前面多一行位置，正文顺序不变；
 *   拖着停在另一篇文档的标签上半秒就切过去，松手插进那一篇（cross-doc.ts，两篇一次提交）；
 * - 双击文字卡就地改，别的卡看全文；勾待办只改那一个字；视频卡、时刻卡点一下在右栏播；
 * - 选中、⇧ 多选、⌫ 删；右键菜单；卡右边的小圆点拖到另一张卡上连线（frontmatter 的 links）；列头拖到空白处摆在那里；
 * - 从访达拖图、⌘V 贴图存进附件；从左栏文件树拖一篇笔记上来放 ![[它]]；
 * - 卡底不写「在文档「某某」这一节里」（偏好「白板卡别挂位置行」）；别处嵌了这一节时列名下面一行「X 引用了这一节」。
 * 每种卡长什么样在 cards.tsx。每个动作改的是编辑器里的文字，底部提示带「撤回」。⌘Z / ⇧⌘Z 只撤、重做这块白板自己做过的动作。
 * AI 在这块白板上动手时外圈、顶上提示条、AI 指针由 AiActLayer 画（卡的 data-id 是 unitKeys 的名字，AI 工具用的同一个）。
 */
import { jumpToChat } from '@cn/ai-chat/chat-jump'
import { Codicon, type CodiconName } from '@cn/design'
import { trackDrag } from '@cn/design/drag-end'
import { accelFor, isKey, keyFor } from '../keys'
import {
  addSection,
  docAiBlocks,
  isSummaryHead,
  appendPlaced,
  type DocBoard,
  type DocColumn,
  type DocUnit,
  duplicateUnit,
  findUnitAgain,
  insertInColumn,
  linksOf,
  linkUnits,
  merge3,
  mergeUnits,
  parseChatLink,
  moveColumn,
  moveUnit,
  moveUnits,
  placeColumn,
  placeUnit,
  placeUnits,
  reconcile,
  relinkMovedNote,
  removeColumn,
  removeUnit,
  removeUnits,
  renameColumn,
  replaceUnits,
  resetLayout,
  splitDoc,
  splitMerged,
  toggleTask,
  unitKeys,
  unlink,
  unplaceUnit,
  baseBlocks as autoBlocks,
} from '@cn/format'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Backlink, BoardBase, NoteFile } from '../../shared/api'
import { CLIPS, INBOX, previewOf, titleOf } from '../../shared/layout'
import { AiActLayer } from '../ai-act'
import type { BaseCellWrite } from '../base/BaseTable'
import { createBase } from '../base/base-block'
import { type BoardZoomApi } from '../BoardView'
import { movedEnough } from '../board-drop'
import { clampZoom, fitZoom, stepZoom, wheelZoom } from '../board-zoom'
import { app } from '../ctx/actions'
import { aiBlockSig, findAiBlock } from '../side/side-core'
import { type Spot } from '../side/file-side'
import { type MenuEntry, showMenu } from '../ctx/menu'
import { sayCardBack, sayMerged, saySameSpot } from '../conflict-say'
import { useVaultFiles } from '../files/store'
import { composing } from '../ime'
import { type CaptureRequest, openCapture, setBoardCapture } from '../mindmap/capture-store'
import { settlePlaced } from '../mindmap/place'
import type { Placed } from '../../shared/mindmap'
import { Markdown } from '../md-render'
import { NoteDoc } from '../note-doc'
import * as Reading from '../reading/store'
import { clickPage } from '../cite'
import { openPageLink } from '../page-link'
import { onFlyToCard } from '../shell/OutlineView'
import { typingIn } from '../typing'
import { openVideo } from '../video/actions'
import { videoUrlOfCard } from '../video/BoardCards'
import { useBoardImageDrop } from '../web/useImageDrop'
import { CardBody } from '../CardBody'
import { BaseExpand, BaseMenu } from './base-card'
import { type CardActs, type CardCtx, type Face, faceClass, faceName, faceOf, type OpenTarget, UnitBody } from './cards'
import { type DocSpot, docSpotAt, insertInto, tabAt } from './cross-doc'
import { inboxOf, InboxPop, useInboxOpen } from './inbox'
import { EMPTY_HINT, InlineCard } from './inline-card'
import { TopHint } from './top-hint'
import { UnitEditor } from './unit-editor'
import { setBoardSelection } from './selection'
import { type Box, boxOf, hitKeys } from './board-select'
import { useBoardBar } from './board-bar'
import { useT } from '../i18n'
import { t as tNow, uiLang } from '../../shared/i18n'
import './doc-board.css'
import { BoardFind } from '../find/BoardFind'
import { findRounds } from '../../shared/feynman/doc'
import { FeynmanColumn, PeekChip, PendingColumn, useCovered } from '../feynman/Column'
import { StartPop, type PickItem } from '../feynman/StartPop'
import * as Fy from '../feynman/store'
import { useBoardSlack } from '../board-slack'
import { headOf, unitIdOf } from '../../shared/feynman/material'

/** 列宽、列间距、开头留给工具板的宽、顶上留的高（照小样：276、22，第一列离白板左边 92，离顶 64） */
const COL_W = 276
const PER_COL = 6
const PER_COL_LONG = 4
const OPEN_COLS = 6
/** 工具板、收件箱的东西落下时，画布左边给工具板让出的宽（不随缩放变）：第一列离白板左边 92 */
const ROOM = 92
/** 左栏文件树拖笔记的格式（files/FileTree.tsx 的 DRAG_MIME；选了好几篇一起拖是 DRAG_MANY，一串路径） */
const NOTE_MIME = 'application/x-cn-note'
const NOTES_MIME = 'application/x-cn-many'

export interface DocBoardViewProps {
  text: string
  notePath: string
  notes: NoteFile[]
  readOnly: boolean
  /** 这个标签在前面：⌘Z、⌘+ ⌘− ⌘0 才归这块白板 */
  active: boolean
  /** 画布上真正的比例（用户比例 × 右栏开着时的 0.8）；zoom 是用户比例，和别的白板同一套（board-zoom.ts） */
  scale: number
  zoom: number
  onZoom(z: number): void
  /** 右上角「100% ▾」菜单调这里 */
  zoomApi: React.MutableRefObject<BoardZoomApi | null>
  /** 右上角浮着的缩放和「收件箱 N」（corner.tsx，task-wz7gb）：放在顶上那一行的右端，和胶囊同一行 */
  corner?: React.ReactNode
  onChange(text: string): void
  /** 「在文档里看」：切到文档，光标放到 pos */
  onOpenDoc(pos: number): void
  /** 改字的框开着时登记一个「把框里的字存回去」（关标签、关窗口、退出时叫）；关了登记 null */
  onDraft?(flush: (() => void) | null): void
  /** 底栏提示（全软件那条）：关标签、退出时存回去的冲突说在这里 */
  onNotice(text: string): void
  /** 子白板：建一块新白板，在新标签打开改名，返回它的名字 */
  onCreateSubBoard?(): Promise<string | null>
}

/** 工具板上的几样（照小样的顺序和图标；拍导图在分隔线下面） */
type PalKind = 'card' | 'todo' | 'column' | 'base' | 'board' | 'map'
// 不翻：键，画的地方翻（label 是工具板上的字，带「工具板」；tip 是悬停提示）
const PAL: { kind: PalKind; label: string; tip: string; icon: CodiconName }[] = [
  { kind: 'card', label: '卡片', tip: '新卡片：点一下放进正中那一列，或按住拖到白板上、拖进一列；卡里打 / 插入块', icon: 'note' }, // 不翻
  { kind: 'todo', label: '待办', tip: '待办：点一下，或按住拖到白板上、拖进一列', icon: 'checklist' }, // 不翻
  { kind: 'column', label: '列', tip: '新的列：文档里新起一节；按住拖到两列之间', icon: 'split-horizontal' }, // 不翻
  { kind: 'base', label: '数据库', tip: '数据库：放一张小表卡，「展开」就地改；每一条是一篇笔记', icon: 'database' }, // 不翻
  { kind: 'board', label: '子白板', tip: '子白板：新建一块白板，这里放一张指向它的卡片', icon: 'layout' }, // 不翻
]

/** 新东西落在哪：一列里第几张前面（before -1 是列尾），或者空白处的坐标（白板坐标） */
type Where = { col: number; before: number } | { x: number; y: number }

type Pt = { x: number; y: number }
/**
 * 拖卡：key 是按着的那张；group：按着的是选中的好几张里的一张时，几张一起走（task-5ryf9），
 * 记下每张起拖时在窗口里的位置（拖影照这个摆，几张一起跟着鼠标）
 */
type Drag =
  | { type: 'unit'; key: string; unit: DocUnit; start: Pt; grab: Pt; moved: boolean; at: Pt; w: number; group?: { key: string; unit: DocUnit; r: { left: number; top: number; width: number } }[] }
  | { type: 'pal'; kind: PalKind; start: Pt; at: Pt; moved: boolean }
  | { type: 'inbox'; path: string; text: string; start: Pt; at: Pt; moved: boolean }
  | { type: 'col'; ci: number; start: Pt; at: Pt; grab: Pt; moved: boolean; w: number }
  | { type: 'wire'; from: string; at: Pt }

/** 就地改一张卡：已有的那张（key），或者刚放下的空卡（where） */
type Edit = { kind: 'unit'; key: string; unit: DocUnit; base: string } | { kind: 'new'; where: Where; body: string; n: number }

/** 底部提示：undo 是点「撤回」要做的（白板自己的一步，或者跨了别的文件的那几样） */
interface Toast {
  text: string
  path?: string
  undo?: () => void
}

/** 量到的每张卡、每列在白板上的位置（白板坐标） */
type Rect = { x: number; y: number; w: number; h: number }

/**
 * 「讲完再看 · 按住看一眼」那一颗：摆在盖住的那几张左上（白板坐标），但夹进白板看得见的那一块里。
 * 开讲后白板会平移去露出费曼那一列（摆在盖住的卡下面），盖住的卡顶滚出画面时这一颗贴着可见区的边收住，不跟着出去；
 * 上边让开顶上的提示条和缩放、收件箱，左边让开工具板。滚动、平移、窗口变大小都重算
 */
function CoverChip(props: { id: string; at: Pt; scale: number; wrap: React.RefObject<HTMLDivElement | null>; plane: React.RefObject<HTMLDivElement | null> }) {
  const chip = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState(props.at)
  const { x, y } = props.at
  useLayoutEffect(() => {
    const w = props.wrap.current
    if (!w) return
    const place = () => {
      const pl = props.plane.current
      const el = chip.current
      if (!pl || !el) return
      const s = props.scale
      const wr = w.getBoundingClientRect()
      const pr = pl.getBoundingClientRect()
      const cr = el.getBoundingClientRect()
      const pal = w.parentElement?.querySelector<HTMLElement>(':scope > .bpal')?.getBoundingClientRect()
      // 可见区（屏幕坐标）减去边距，再换成白板坐标
      const l = Math.max(wr.left + 8, pal && pal.width ? pal.right + 8 : 0)
      const t = wr.top + 56
      const r = Math.min(wr.right, w.clientWidth ? wr.left + w.clientWidth : wr.right) - 8 - cr.width
      const b = Math.min(wr.bottom, w.clientHeight ? wr.top + w.clientHeight : wr.bottom) - 8 - cr.height
      const sx = Math.max(l, Math.min(r, pr.left + x * s))
      const sy = Math.max(t, Math.min(b, pr.top + y * s))
      const next = { x: (sx - pr.left) / s, y: (sy - pr.top) / s }
      setPos((p) => (Math.abs(p.x - next.x) < 0.5 && Math.abs(p.y - next.y) < 0.5 ? p : next))
    }
    place()
    w.addEventListener('scroll', place, { passive: true })
    const ro = new ResizeObserver(place)
    ro.observe(w)
    window.addEventListener('resize', place)
    return () => {
      w.removeEventListener('scroll', place)
      ro.disconnect()
      window.removeEventListener('resize', place)
    }
  }, [x, y, props.scale, props.wrap, props.plane])
  return <PeekChip id={props.id} chipRef={chip} style={{ left: pos.x, top: pos.y }} />
}

export function DocBoardView(props: DocBoardViewProps) {
  const t = useT()
  const { text } = props
  const board: DocBoard = useMemo(() => splitDoc(text), [text])
  const keys = useMemo(() => unitKeys(board), [board])
  const byKey = useMemo(() => new Map([...keys].map(([u, k]) => [k, u])), [keys])
  /** 混排一节里问答那一组（doc-board.ts 7b）：组里每张的名字 → 整组的名字。选、删、拖、连线、复制都是整组，就地改是那一张 */
  const groupKeyOf = useMemo(() => {
    const m = new Map<string, string>()
    for (const [u, k] of keys) for (const g of u.group ?? []) m.set(keys.get(g) ?? '', k)
    return (k: string) => m.get(k) ?? k
  }, [keys])
  const links = useMemo(() => linksOf(text), [text])
  const { files } = useVaultFiles()
  const inboxOpen = useInboxOpen()
  const [open, setOpen] = useState<Set<number>>(new Set())
  const [more, setMore] = useState<Set<number>>(new Set())
  const [drag, setDrag] = useState<Drag | null>(null)
  const [drop, setDrop] = useState<{ col: number; before: number } | null>(null)
  /** 双击看全文的那张卡，和打开时的全文（改字存回时拿它当三方合并的底）；edit：一打开就是改字 */
  const [full, setFull] = useState<{ unit: DocUnit; base: string; edit?: boolean } | null>(null)
  const [edit, setEdit] = useState<Edit | null>(null)
  const [toast, setToastState] = useState<Toast | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // 选中的那一张记下来：AI 命令「计划拆成待办」拆它（task-9womr）
  useEffect(() => setBoardSelection(props.notePath, selected), [props.notePath, selected])
  /** 空白处按住拖出来的框（.db-area 里的坐标，task-5ryf9）；拖着时操作条先藏起来 */
  const [marq, setMarq] = useState<Box | null>(null)
  /** 按住空格（光标变小手，拖白板平移）、正在平移 */
  const [space, setSpace] = useState(false)
  const spaceRef = useRef(false)
  const [panning, setPanning] = useState(false)
  const [selWire, setSelWire] = useState<string | null>(null)
  /** 展开了的数据库卡 */
  const [expanded, setExpanded] = useState<string | null>(null)
  /** 工具板「数据库」的小菜单：开在哪、放到哪 */
  const [baseMenu, setBaseMenu] = useState<{ at: Pt; where: Where } | null>(null)
  /** 拖着卡停在另一篇文档上：横线画在哪 */
  const [docSpot, setDocSpot] = useState<DocSpot | null>(null)
  /** 文件树拖笔记进来：落在哪一列 */
  const [noteDrop, setNoteDrop] = useState<boolean>(false)
  const [refs, setRefs] = useState<Backlink[]>([])
  /** 什么都没选时点「费曼学习」：讲哪个点的小框（feynman/StartPop.tsx） */
  const [fyPop, setFyPop] = useState<Pt | null>(null)
  const [rects, setRects] = useState<Record<string, Rect>>({})
  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 2000)
    return () => clearTimeout(t)
  }, [flash])
  /** 正在改名的那一列（新加的列一出来就进改名） */
  const [renaming, setRenaming] = useState<number | null>(null)
  /** 新加的列（name）一出来就进改名；filled：「放进新列」那一列里已经有卡，取最后一个叫这个名字的 */
  const pendingRename = useRef<{ name: string; filled?: boolean } | null>(null)
  const plane = useRef<HTMLDivElement>(null)
  const outer = useRef<HTMLDivElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  /** 白板四周多出来的空白（board-slack.ts）：滚动位置都按「slack + 原来的值」算 */
  const slack = useBoardSlack(wrap)
  const slackRef = useRef(slack)
  slackRef.current = slack
  /**
   * 读 PDF 的配对笔记（「X 笔记.md」，里面有问过 AI 的节）：所有列都完整显示、排成一行往右延伸（2026-11-24 用户「收起来看不到我问的内容」，
   * 偏好「配对笔记默认展开」）；白板四周能拖（board-slack.ts），不靠收成列头省地方。普通文档照旧：一排 6 列、第 7 列起只留列头、每列先摆 6 张
   */
  // 混排的文档里有问答成组（7b）：和配对笔记一样全部展开，不收成只剩列头、不收进「还有N张」（偏好「配对笔记默认展开」）
  const mixed = board.columns.some((c) => c.cards.some((u) => u.group)) || board.placed.some((u) => u.group)
  const paired = (/ 笔记\.md$/.test(props.notePath) && board.columns.some((c) => c.ask)) || mixed
  const rowSize = paired ? Math.max(1, board.columns.length) : OPEN_COLS
  const per = paired ? Infinity : board.total > 200 ? PER_COL_LONG : PER_COL
  const inbox = inboxOf(props.notes, props.notePath)
  const ctx: CardCtx = { notePath: props.notePath, notes: props.notes, files, full: false }
  /**
   * AI 讲解卡上的旁支（task-p90ra）：每块 `> [!ai]` 讲解在全文里的起点和认它的那两行。
   * 旁支写进去以后卡的编号（按字算的）会变，这一处的编号、React 的 key 用认讲解的那两行（同样的几块按先后加序号），开着的旁支不丢
   */
  const aiSpots = useMemo(() => {
    const starts = [0]
    for (let i = 0; i < props.text.length; i++) if (props.text[i] === '\n') starts.push(i + 1)
    const seen = new Map<string, number>()
    return docAiBlocks(props.text).map((b) => {
      const sig = aiBlockSig(props.text, b)
      const id = `${sig.head}\n${sig.first}`
      const n = (seen.get(id) ?? 0) + 1
      seen.set(id, n)
      return { at: starts[b.head]!, sig, host: `board:${props.notePath}#${id}#${n}` }
    })
  }, [props.text, props.notePath])
  const aiHostOf = (u: DocUnit) => (u.kind === 'callout' ? aiSpots.find((x) => x.at >= u.from && x.at < u.to)?.host : undefined)
  const sideSpot = (u: DocUnit): Spot | undefined => {
    const hit = props.readOnly ? undefined : aiSpots.find((x) => x.at >= u.from && x.at < u.to)
    if (!hit) return undefined
    const title = titleOf(props.notePath)
    // 「AI 总结的」卡（task-5yp97）：说「总结」不说「讲解」
    const noun = isSummaryHead(hit.sig.head) ? '总结' : '讲解' // 不翻：file-side 认的种类（类型就是这两个字），也进给 AI 的话
    return {
      host: hit.host,
      path: props.notePath,
      title,
      text: props.text,
      find: (t) => findAiBlock(t, hit.sig),
      where: `白板《${title}》上 AI 写的${noun}卡`, // 不翻：给 AI 的话
      record: { icon: 'file', text: noun === '总结' ? tNow('写在这篇文档里，挂在这段总结下面') : tNow('写在这篇文档里，挂在这段讲解下面') },
      noun,
      onQuote: (q) => app().askAi(q),
      place: `file:${props.notePath}`,
    }
  }
  const setToast = (t: Toast | null) => setToastState(t)

  // ----- 写回：每个动作一步，撤回只撤这块白板自己做过的 -----
  const done = useRef<{ before: string; after: string }[]>([])
  const undone = useRef<{ before: string; after: string }[]>([])
  /** 编辑器里现在的全文：连按 ⌘Z 时 props.text 可能还没跟上 */
  const cur = useRef(text)
  cur.current = text
  const apply = (next: string) => {
    props.onChange(next)
    cur.current = next
  }
  /** 写进文件，提示条一句话带「撤回」；extra：撤回时还要做的（收件箱那篇放回去） */
  const write = (next: string, what: string, extra?: { path?: string; undo?: () => void }) => {
    const now = cur.current
    if (props.readOnly || next === now) return false
    done.current.push({ before: now, after: next })
    undone.current = []
    apply(next)
    setToast({ text: what, path: extra?.path, undo: () => (say(step(false)), extra?.undo?.()) })
    return true
  }
  const say = (t: string | null) => t && setToast({ text: t })
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
      return tNow('文件在外面改过，这一步撤不回了')
    }
    apply(m.text)
    to.current.push(redo ? { before: now, after: m.text } : { before: m.text, after: now })
    return redo ? tNow('重做了这一步') : tNow('撤回了这一步')
  }
  const stepRef = useRef(step)
  stepRef.current = step
  // ⌘Z / ⇧⌘Z：在这块白板上一律拦下（不交给浏览器自带的撤销，它会撤到别的标签去）；改字框里照常撤字
  useEffect(() => {
    if (!props.active) return
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.altKey || e.ctrlKey || e.key.toLowerCase() !== 'z') return
      const field = (e.target as HTMLElement | null)?.closest?.('input, textarea, [contenteditable="true"]')
      if (field?.checkVisibility()) return
      if (!outer.current?.checkVisibility()) return
      e.preventDefault()
      e.stopPropagation()
      if (props.readOnly) return
      const said = stepRef.current(e.shiftKey)
      if (said) setToast({ text: said })
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [props.active, props.readOnly])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), toast.undo ? 8000 : 5000)
    return () => clearTimeout(t)
  }, [toast])

  /**
   * 改字存回：卡的位置是打开时那份全文里的，改的时候外面（同步盘、手机、AI）可能改过这篇。
   * 和文档编辑器同一套三方合并（reconcile）：底 = 打开时的全文，我的 = 底里换掉这张卡，外面的 = 现在的全文。
   * 改的不是一处就合起来；改了同一段就留我的版本写进文件，外面那版另存成冲突副本并提示（外部改动不丢正在打的字）。
   */
  const saveCard = (f: { unit: DocUnit; base: string }, body: string, closing = false) => {
    const mine = f.base.slice(0, f.unit.from) + body + f.base.slice(f.unit.to)
    if (cur.current === f.base) return void write(mine, tNow('改好了：文档里就是这一段'))
    // 外面改的是别处（或者只挪了这张卡的位置行），这一段的字没动：就在现在的全文里换掉这一段，外面改的都留着
    const now = splitDoc(cur.current)
    const again = findUnitAgain(f.unit, f.base, cur.current, now)
    if ('same' in again && again.same) return void write(cur.current.slice(0, again.unit.from) + body + cur.current.slice(again.unit.to), sayMerged(props.notePath))
    const gone = 'gone' in again
    const r = reconcile(f.base, mine, cur.current)
    if (r.kind === 'none') return
    if (r.kind === 'update') return void write(r.text, sayMerged(props.notePath))
    const theirs = cur.current
    const others = r.text !== mine
    // 外面把正在改的这一段删了：这段连同打的字放回去，外面那版存成冲突副本（和以前的自由白板一个说法）
    const said = (copy: { path: string } | { error: string } | null) =>
      !gone ? saySameSpot(props.notePath, others, copy) : copy ? sayCardBack(copy) : tNow('外面删了你正在改的卡：已放回')
    write(r.text, said(null))
    const tell = (t: string) => (closing ? props.onNotice(t) : setToast({ text: t }))
    void window.cn.saveConflictCopy(props.notePath, theirs).then(
      (copy) => tell(said({ path: copy })),
      (e) => tell(said({ error: String((e as Error).message ?? e) })),
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
    write(cur.current.slice(0, u.from) + lines.join('\n') + cur.current.slice(u.to), /\[[xX]\]/.test(lines[line]!) ? tNow('勾上了：文件里只改了这一行的一个字') : tNow('取消勾选：文件里只改了这一行的一个字'))
  }

  // ----- 新东西写进文件：放进列就插进那一节，放在空白处就加在文末带一行位置 -----
  const put = (where: Where, body: string, what: { col: string; free: string }, extra?: { undo?: () => void }) => {
    setFlash(body.trim())
    try {
      if ('col' in where) {
        const col = board.columns[where.col]!
        const before = where.before >= 0 ? (col.cards[where.before] ?? null) : null
        return write(insertInColumn(cur.current, col, before, body), what.col.replace('%s', col.title ?? tNow('开头')), extra)
      }
      return write(appendPlaced(cur.current, body, Math.max(0, where.x), Math.max(0, where.y)), what.free, extra)
    } catch (err) {
      setToast({ text: String((err as Error).message) })
      return false
    }
  }
  /**
   * 拍好的导图挂上来（task-wuv05）：它是这块白板的子白板，落点一张子白板卡（同「子白板」的写法 [[名字]]）；
   * 这篇、导图、照片一次提交，撤回走底栏那一条（一次全回去），不进白板自己的 ⌘Z
   */
  const hangMap = (where: Where, r: Placed) => {
    if (props.readOnly) return
    const body = `[[${titleOf(r.path)}]]`
    const col = 'col' in where ? board.columns[where.col] : undefined
    const next =
      'col' in where && col
        ? insertInColumn(cur.current, col, where.before >= 0 ? (col.cards[where.before] ?? null) : null, body)
        : 'x' in where
          ? appendPlaced(cur.current, body, Math.max(0, where.x), Math.max(0, where.y))
          : null
    if (next === null) throw new Error(tNow('那一列不在了，导图没放上去'))
    setFlash(body)
    apply(next)
    return settlePlaced(props.notePath, r, col ? tNow('导图放进了「{col}」：是这块白板的子白板，文件在它旁边', { col: col.title ?? tNow('开头') }) : tNow('导图放在这里：是这块白板的子白板，文件在它旁边'))
  }
  const hangMapRef = useRef(hangMap)
  hangMapRef.current = hangMap
  const planeXY = (cx: number, cy: number) => {
    const r = plane.current!.getBoundingClientRect()
    return { x: (cx - r.left) / props.scale, y: (cy - r.top) / props.scale }
  }
  const seedWhereRef = useRef<(near?: string) => Where>(() => ({ x: 40, y: 80 }))
  /** 画面正中偏上的空白处（不进列） */
  const freeWhere = (): Where => {
    const w = wrap.current
    if (!w || !plane.current) return { x: 40, y: 80 }
    // 摆在所有列（含费曼那一列）右边的空白处，和列顶对齐；一列都没有就在画面正中偏上
    const cols = [...plane.current.querySelectorAll<HTMLElement>('.db-col, [data-testid="fy-col"]')].map((c) => c.getBoundingClientRect())
    const n = board.placed.length % 6
    if (cols.length) {
      const at = planeXY(Math.max(...cols.map((r) => r.right)) + 32 * props.scale, Math.min(...cols.map((r) => r.top)))
      return { x: Math.round(at.x), y: Math.round(at.y + n * 24) }
    }
    const wr = w.getBoundingClientRect()
    const at = planeXY(wr.left + wr.width / 2 - 120 * props.scale, wr.top + wr.height / 3)
    return { x: Math.round(at.x + n * 24), y: Math.round(at.y + n * 24) }
  }
  /** 屏幕正中那一列（点一下工具板放进它的最后）；一列都没有就在画面正中偏上的空白处 */
  const centerWhere = (): Where => {
    const w = wrap.current
    if (!w) return { x: 40, y: 80 }
    const wr = w.getBoundingClientRect()
    const cx = wr.left + wr.width / 2
    const cols = [...(plane.current?.querySelectorAll<HTMLElement>('.db-col[data-head="1"][data-ask="0"]:not(.fold)') ?? [])]
    const hit =
      cols.find((c) => {
        const r = c.getBoundingClientRect()
        return cx >= r.left - 11 && cx <= r.right + 11 && r.right > wr.left && r.left < wr.right
      }) ??
      cols
        .filter((c) => c.getBoundingClientRect().right > wr.left && c.getBoundingClientRect().left < wr.right)
        .sort((a, b) => Math.abs(a.getBoundingClientRect().left - cx) - Math.abs(b.getBoundingClientRect().left - cx))[0]
    if (hit) return { col: Number(hit.dataset.col), before: -1 }
    const at = planeXY(cx - 120 * props.scale, wr.top + wr.height / 3)
    const n = board.placed.length % 6
    return { x: Math.round(at.x + n * 24), y: Math.round(at.y + n * 24) }
  }
  /** 当场出一张空卡就地写（写了字才写进文件） */
  const draftAt = (where: Where, body = '') => {
    setSelected(new Set())
    setEdit({ kind: 'new', where, body, n: Date.now() })
  }
  const createAt = async (kind: PalKind, where: Where, at?: Pt) => {
    if (kind === 'card') return draftAt(where)
    if (kind === 'todo') return draftAt(where, '- [ ] ')
    if (kind === 'base') return setBaseMenu({ at: at ?? { x: 120, y: 200 }, where })
    if (kind === 'column') {
      const before = 'col' in where ? (board.columns[where.col] ?? null) : null
      const name = '新的列' // 不翻：写进文件的默认节名，下面还拿它认出新加的那一列
      pendingRename.current = { name }
      write(addSection(cur.current, name, before?.head ? before : null, board.level), tNow('加了一列：文档里新起了一节「## 新的列」'))
      return
    }
    if (kind === 'board') {
      const name = await props.onCreateSubBoard?.()
      if (!name) return
      put(where, `[[${name}]]`, { col: tNow('子白板放进了「%s」：文档里多了一个链接'), free: tNow('子白板放在这里：文档末尾多了一个链接') })
      return
    }
    // 拍导图：拍好、做成导图白板后，它是这块白板的子白板，落点放一张子白板卡（task-wuv05）
    openCapture({ into: { path: props.notePath, as: 'board' }, onPlaced: (r) => hangMapRef.current(where, r) })
  }
  // ⌘K、⇧⌘C、菜单在这块白板前面时拍：同点工具板「拍导图」，放进屏幕正中那一列（mindmap/place.ts captureHere）
  const mapHere = useRef(() => undefined as void)
  mapHere.current = () => void createAt('map', centerWhere())
  useEffect(() => {
    if (!props.active || props.readOnly) return
    const mine = {
      path: props.notePath,
      capture: () => mapHere.current(),
      // 费曼「拍成导图」：拿这一轮整理成的树进 ② 核对；导图卡放在画面正中的空白处（不放进列：屏幕正中那一列多半就是费曼那一节）
      seeded: (seed: NonNullable<CaptureRequest['seed']>, near?: string) => openCapture({ into: { path: props.notePath, as: 'board' }, seed, onPlaced: (r) => hangMapRef.current(seedWhereRef.current(near), r) }),
    }
    setBoardCapture(mine)
    return () => setBoardCapture(null, mine)
  }, [props.active, props.readOnly, props.notePath])
  /** 工具板「数据库」挑好了：放一张数据库卡（已有的照它的列；新建一个空的在这篇旁边建文件夹） */
  const placeBase = async (b: BoardBase | 'new', where: Where) => {
    setBaseMenu(null)
    try {
      const md = b === 'new' ? await createBase(props.notePath) : '```base\n' + b.src + '\n```'
      put(
        where,
        md,
        b === 'new'
          ? { col: tNow('放了一张「新数据库」数据库卡：文档「%s」这一节多了一个数据库块'), free: tNow('放了一张「新数据库」数据库卡：文档末尾多了一个数据库块，带一行位置') }
          : { col: tNow('放了一张「{name}」数据库卡：文档「%s」这一节多了一个数据库块', { name: b.name }), free: tNow('放了一张「{name}」数据库卡：文档末尾多了一个数据库块，带一行位置', { name: b.name }) },
      )
      if (b === 'new') app().refresh()
    } catch (e) {
      setToast({ text: String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
    }
  }
  // 新加的列一出来就进改名
  useEffect(() => {
    const want = pendingRename.current
    if (!want) return
    const hits = board.columns.map((c, i) => ({ c, i })).filter(({ c }) => c.title === want.name && (want.filled || c.cards.length === 0))
    const hit = hits[hits.length - 1]
    if (hit) {
      pendingRename.current = null
      setRenaming(hit.i)
    }
  }, [board])

  /**
   * 收件箱里的一条拖上白板：短的内容放成卡片、那篇移到废纸篓（里面的图按这篇改相对链接）；
   * 整页剪藏这类长的那篇挪到「剪藏/<这篇>/」（附件跟着挪），放一张 ![[它]] 的剪藏卡。撤回：白板这一步撤掉，那篇放回收件箱
   */
  const placeInbox = async (path: string, where: Where) => {
    const note = await window.cn.readNote(path)
    const body = note.text.replace(/^---\n[\s\S]*?\n---\n?/, '').trim()
    if ((/^---\n[\s\S]*?\nsource:/.test(note.text) && /^# /m.test(body)) || body.length > 800) {
      const moved = (await window.cnMenu.moveNote(path, `${CLIPS}/${titleOf(props.notePath)}`)).to
      put(where, `![[${titleOf(moved)}]]`, { col: tNow('收件箱里那篇放进了「%s」：那篇挪进了「{path}/」，这里是指向它的卡片', { path: `${CLIPS}/${titleOf(props.notePath)}` }), free: tNow('收件箱里那篇放在这里：挪进了「{path}/」，这里是指向它的卡片', { path: `${CLIPS}/${titleOf(props.notePath)}` }) }, { undo: () => void window.cnMenu.moveNote(moved, INBOX).then(() => app().refresh()) })
    } else {
      // 开头那行「# 名字」是那篇的名字，放进文档就不要了（不然文档里多一个一级标题，按节摆就乱了）；图的相对链接按这篇改
      const piece = relinkMovedNote(body.replace(/^#\s+[^\n]*\n+/, ''), path, props.notePath)
      const image = /^!\[[^\]]*\]\([^)]*\)\s*$/.test(piece.trim())
      const ok = put(where, piece, { col: image ? tNow('收件箱里那条放进了「%s」：图还在原来的附件里，这里是它') : tNow('收件箱里那条放进了「%s」：收件箱里那篇移到了废纸篓'), free: tNow('收件箱里那条放在这里：文档末尾多了这一段，带一行位置') }, { undo: () => void window.cn.createNote(INBOX, titleOf(path), note.text).then(() => app().refresh()) })
      if (ok) await window.cn.trashNote(path)
    }
    app().refresh()
  }

  // ----- 缩放（和别的白板一样：⌘+ ⌘− ⌘0 ⇧⌘1、捏合、按住 ⌘ 滚轮、标签条菜单；以鼠标或画面正中为中心）-----
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
    // 画布左边给工具板让出的 92、四周多出的空白不随缩放变，换算时扣掉
    const ox = ROOM + slackRef.current.x
    const oy = slackRef.current.y
    pendingScroll.current = { left: ((from.left + ax - ox) / oldS) * newS - ax + ox, top: ((from.top + ay - oy) / oldS) * newS - ay + oy }
    liveZoom.current = z
    props.onZoom(z)
  }
  /** 适合窗口：所有列和单独摆的卡整个放进画面 */
  const fit = () => {
    const w = wrap.current
    const p = plane.current
    if (!w || !p) return
    const base = p.getBoundingClientRect()
    // 费曼那一列（摆在自己位置上的）也算：适合窗口以后它也在画面里
    const rs = [...p.querySelectorAll<HTMLElement>('.db-col, .db-card.placed, .fy-col')].map((el) => el.getBoundingClientRect())
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
    // 最左那一列贴着工具板右边（左边让出的 92 不算进缩放），不被工具板盖住
    const { x: sx, y: sy } = slackRef.current
    const to = box ? { left: sx + Math.max(0, (box.x - 40) * s), top: sy + Math.max(0, (box.y - 40) * s) } : { left: sx, top: sy }
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

  // ----- 量位置：连线、展开的数据库、右键「从列里拿出来」都靠它 -----
  useLayoutEffect(() => {
    const p = plane.current
    if (!p) return
    const base = p.getBoundingClientRect()
    const s = props.scale || 1
    const next: Record<string, Rect> = {}
    for (const el of p.querySelectorAll<HTMLElement>('.db-card[data-id], .db-askgroup[data-id], .db-col[data-cid]')) {
      const r = el.getBoundingClientRect()
      next[el.dataset.id ?? 'col:' + el.dataset.cid] = { x: (r.left - base.left) / s, y: (r.top - base.top) / s, w: r.width / s, h: r.height / s }
    }
    if (JSON.stringify(next) !== JSON.stringify(rects)) setRects(next)
  })

  // ----- 反向链接：别处嵌了这一节、链接了这一篇 -----
  const noteCount = props.notes.length
  const noteStamp = props.notes.reduce((m, n) => Math.max(m, n.mtimeMs), 0)
  useEffect(() => {
    let live = true
    void window.cn.backlinks(props.notePath).then(
      (r) => live && setRefs(r),
      () => live && setRefs([]),
    )
    return () => void (live = false)
  }, [props.notePath, noteCount, noteStamp])

  // ----- 拖：卡片、工具板上的新东西、收件箱里的一条、列头、连线 -----
  /** 鼠标下面是哪一列、插到第几张前面（问过 AI 那一列不收） */
  const slotAt = (cx: number, cy: number, except?: number): { col: number; before: number } | null => {
    const colEl = (document.elementsFromPoint(cx, cy) as HTMLElement[]).find((el) => el.classList?.contains('db-col'))
    if (!colEl || colEl.dataset.ask === '1' || colEl.classList.contains('fold') || !plane.current?.contains(colEl)) return null
    const ci = Number(colEl.dataset.col)
    const cards = [...colEl.querySelectorAll<HTMLElement>(':scope > .db-sub-wrap > .db-card[data-i], :scope > .db-sub-wrap > .db-askgroup[data-i]')].filter((c) => !c.classList.contains('dragging') && Number(c.dataset.i) !== except)
    const i = cards.find((c) => cy < c.getBoundingClientRect().top + c.getBoundingClientRect().height / 2)
    return { col: ci, before: i ? Number(i.dataset.i) : -1 }
  }
  /** 鼠标在不在画布上（不在工具板、顶上那条、收件箱、弹层上） */
  const onCanvas = (cx: number, cy: number) => {
    const el = document.elementFromPoint(cx, cy)
    return !!el && !!wrap.current?.contains(el)
  }
  /** 卡上按下：拖、点一下选中 */
  const onDown = (e: React.MouseEvent, u: DocUnit, key: string, askGroup?: DocUnit) => {
    if (e.button !== 0) return
    // 问答那一组里的一张：选中、拖的都是整组（位置行写在问的标题前面），字上按下照旧选字开旁支
    if (askGroup) {
      const group = askGroup
      if ((e.target as HTMLElement).closest('input, button, a, .db-handle, .card-edit')) return
      outer.current?.focus({ preventScroll: true })
      setSelWire(null)
      const gk = keys.get(group) ?? ''
      if (e.shiftKey || e.metaKey) {
        setSelected((s) => {
          const n = new Set(s)
          if (n.has(gk)) n.delete(gk)
          else n.add(gk)
          return n
        })
        return
      }
      if (!selected.has(gk)) setSelected(new Set([gk]))
      if (props.readOnly || (e.target as HTMLElement).closest('.side-text')) return
      const box = ((e.currentTarget as HTMLElement).closest('.db-askgroup') ?? e.currentTarget).getBoundingClientRect()
      setDrag({ type: 'unit', key: gk, unit: group, start: { x: e.clientX, y: e.clientY }, grab: { x: e.clientX - box.left, y: e.clientY - box.top }, moved: false, at: { x: e.clientX, y: e.clientY }, w: box.width })
      return
    }
    if ((e.target as HTMLElement).closest('input, button, a, .play, .db-moment, .cb-moment, .db-handle, .card-edit')) return
    outer.current?.focus({ preventScroll: true })
    setSelWire(null)
    // ⇧ 点、⌘ 点都是加减一张（⌘ 点和导图里一样，费曼学习「框选或 ⌘ 点的几张卡」）
    if (e.shiftKey || e.metaKey) {
      setSelected((s) => {
        const n = new Set(s)
        if (n.has(key)) n.delete(key)
        else n.add(key)
        return n
      })
      return
    }
    if (!selected.has(key)) setSelected(new Set([key]))
    // 问过 AI 那一列里的卡（一处一列）：按住拖的是整列（列的位置行写在标题前面），不把一问一答从那一节里拆出来
    if (u.ask && !props.readOnly) {
      const colEl = (e.currentTarget as HTMLElement).closest<HTMLElement>('.db-col')
      if (!colEl) return
      const r = colEl.getBoundingClientRect()
      setDrag({ type: 'col', ci: Number(colEl.dataset.col), start: { x: e.clientX, y: e.clientY }, at: { x: e.clientX, y: e.clientY }, grab: { x: e.clientX - r.left, y: e.clientY - r.top }, moved: false, w: r.width })
      return
    }
    // AI 讲解卡的字上按下是选字（选一句开旁支，task-p90ra），不拖卡；拖卡按卡头、卡边
    if (props.readOnly || (e.target as HTMLElement).closest('.side-text')) return
    const card = (e.currentTarget as HTMLElement).getBoundingClientRect()
    // 按着的是选中的好几张里的一张：几张一起拖（task-5ryf9）
    const group =
      selected.has(key) && selected.size > 1
        ? [...selected].flatMap((k) => {
            const unit = byKey.get(k)
            const el = plane.current?.querySelector<HTMLElement>(`.db-card[data-id="${CSS.escape(k)}"], .db-askgroup[data-id="${CSS.escape(k)}"]`)
            if (!unit || !el) return []
            const r = el.getBoundingClientRect()
            return [{ key: k, unit, r: { left: r.left, top: r.top, width: r.width } }]
          })
        : undefined
    setDrag({ type: 'unit', key, unit: u, start: { x: e.clientX, y: e.clientY }, grab: { x: e.clientX - card.left, y: e.clientY - card.top }, moved: false, at: { x: e.clientX, y: e.clientY }, w: card.width, ...(group && group.length > 1 ? { group } : {}) })
  }
  const palDragged = useRef(false)
  const swallow = () => {
    palDragged.current = true
    setTimeout(() => (palDragged.current = false), 0)
  }
  /** 拖着卡停在另一篇文档的标签上：半秒后切过去 */
  const tabHover = useRef<{ path: string; t: ReturnType<typeof setTimeout> } | null>(null)
  const clearTabHover = () => {
    if (tabHover.current) clearTimeout(tabHover.current.t)
    tabHover.current = null
  }
  useEffect(() => {
    if (!drag) return
    const move = (e: MouseEvent) => {
      const at = { x: e.clientX, y: e.clientY }
      if (drag.type === 'wire') return setDrag({ ...drag, at: planeXY(e.clientX, e.clientY) })
      const moved = drag.moved || movedEnough(drag.start, at)
      setDrag({ ...drag, moved, at })
      if (!moved) return
      if (drag.type === 'unit') {
        // 标签条上另一篇文档：停半秒切过去；切过去以后在那篇里找落点
        const tab = tabAt(e.clientX, e.clientY, props.notePath)
        if (tab && tabHover.current?.path !== tab.path) {
          clearTabHover()
          tabHover.current = { path: tab.path, t: setTimeout(() => tab.el.querySelector<HTMLElement>('.tl')?.click(), 500) }
        } else if (!tab) clearTabHover()
        if (!outer.current?.checkVisibility()) {
          setDrop(null)
          return setDocSpot(docSpotAt(e.clientX, e.clientY))
        }
        setDocSpot(null)
      }
      if ((drag.type === 'pal' && drag.kind === 'column') || drag.type === 'col') return setDrop(null)
      if (drag.type === 'unit' || onCanvas(e.clientX, e.clientY)) setDrop(slotAt(e.clientX, e.clientY))
      else setDrop(null)
    }
    const up = (e: MouseEvent) => {
      const d = drag
      const target = drop
      const spot = docSpot
      setDrag(null)
      setDrop(null)
      setDocSpot(null)
      clearTabHover()
      if (d.type === 'wire') {
        const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('.db-card[data-id]')
        const to = el?.dataset.id && byKey.get(groupKeyOf(el.dataset.id))
        const from = byKey.get(d.from)
        if (!to || !from || to === from) return
        const r = linkUnits(cur.current, from, to)
        write(r.text, tNow('连好了一条线：文件开头的 links 里多了一条'))
        return
      }
      if (!d.moved) {
        // 点一下卡：只选中（按下时已经选了）
        return
      }
      if (d.type === 'pal' || d.type === 'inbox') {
        swallow()
        if (!onCanvas(e.clientX, e.clientY)) return
        const p = planeXY(e.clientX, e.clientY)
        if (d.type === 'pal' && d.kind === 'column') {
          // 列落在哪两列之间：鼠标所在那一行里，插在鼠标右边那一列前面（落在最后一行下面或右边就加在最后）
          const right = rowColumnAt(e.clientX, e.clientY)
          void createAt('column', right !== null ? { col: right, before: -1 } : { x: p.x, y: p.y })
          return
        }
        const where: Where = target ?? { x: p.x - 24, y: p.y - 16 }
        if (d.type === 'pal') void createAt(d.kind, where, { x: e.clientX + 8, y: e.clientY - 10 })
        else void placeInbox(d.path, where)
        return
      }
      if (d.type === 'col') {
        swallow()
        const col = board.columns[d.ci]
        if (!col?.head) return
        const right = rowColumnAt(e.clientX, e.clientY)
        try {
          if (right !== null && right !== d.ci) write(moveColumn(cur.current, col, board.columns[right]!), tNow('「{name}」这一节挪到了「{before}」前面：文档里整节跟着挪', { name: col.title, before: board.columns[right]!.title }))
          else if (onCanvas(e.clientX, e.clientY)) {
            const p = planeXY(e.clientX - d.grab.x, e.clientY - d.grab.y)
            write(placeColumn(cur.current, col, Math.max(0, p.x), Math.max(0, p.y)), tNow('「{name}」摆在了这里：标题前面多了一行位置，正文没动', { name: col.title }))
          }
        } catch (err) {
          setToast({ text: String((err as Error).message) })
        }
        return
      }
      // 拖进了另一篇文档（切过去了的那个标签）
      if (!outer.current?.checkVisibility()) {
        if (spot) void moveAcross(d.group ? d.group.map((g) => g.unit) : [d.unit], spot)
        return
      }
      // 选中的几张一起拖（task-5ryf9）：落进一列就按原来的先后挪进那一节；落在空白处各自停在新位置（只改位置行）
      if (d.group) {
        const units = d.group.map((g) => g.unit)
        const n = units.length
        try {
          if (target) {
            const col = board.columns[target.col]!
            const before = target.before >= 0 ? col.cards[target.before]! : null
            const name = col.title ?? t('开头')
            write(moveUnits(cur.current, units, col, before), t('挪进了「{name}」：文档里这{n}段也挪进了这一节，位置行去掉了', { name, n }))
          } else {
            const dx = e.clientX - d.start.x
            const dy = e.clientY - d.start.y
            const moves = d.group.map((g) => {
              const p = planeXY(g.r.left + dx, g.r.top + dy)
              return { unit: g.unit, x: Math.round(p.x), y: Math.round(p.y) }
            })
            const pulled = units.filter((u) => !u.place).length
            write(
              placeUnits(cur.current, moves),
              pulled ? t('挪了{n}张：只改了这{n}张的位置行（从列里拿出来的{m}张多了一行位置），正文顺序不变', { n, m: pulled }) : t('挪了{n}张：只改了这{n}张的位置行，正文顺序不变', { n }),
            )
          }
        } catch (err) {
          setToast({ text: String((err as Error).message) })
        }
        return
      }
      try {
        if (target) {
          const col = board.columns[target.col]!
          const before = target.before >= 0 ? col.cards[target.before]! : null
          if (before && before.from === d.unit.from) return
          setFlash(d.unit.text.trim())
          const name = col.title ?? tNow('开头')
          const same = col.cards.some((x) => x.from === d.unit.from)
          write(moveUnit(cur.current, d.unit, col, before), same ? tNow('换了位置：文档里「{name}」这一节的先后跟着换', { name }) : tNow('挪进了「{name}」：文档里这段也挪进了这一节', { name }))
        } else {
          const p = planeXY(e.clientX - d.grab.x, e.clientY - d.grab.y)
          setFlash(d.unit.text.trim())
          write(placeUnit(cur.current, d.unit, Math.max(0, p.x), Math.max(0, p.y)), tNow('放在了这里：文档里这段前面多了一行位置，正文顺序不变'))
        }
      } catch (err) {
        setToast({ text: String((err as Error).message) })
      }
    }
    const cancel = () => {
      swallow()
      clearTabHover()
      setDrag(null)
      setDrop(null)
      setDocSpot(null)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      cancel()
    }
    // 松手没送到页面（窗口外松手、失焦）：当没拖过，像按了 Esc（trackDrag，task-0nz63）
    const stop = trackDrag<MouseEvent>({ type: 'mousedown', button: 0 }, { move, end: (how, e) => (how === 'up' ? up(e!) : cancel()) })
    window.addEventListener('keydown', esc, true)
    return () => (stop(), window.removeEventListener('keydown', esc, true))
  }, [drag, drop, docSpot, text])

  /** 一排里的列：鼠标在哪一列的左半边，就是插在它前面那一列（列落在两列之间、列头拖回一排里用） */
  const rowColumnAt = (cx: number, cy: number): number | null => {
    const rows = [...(plane.current?.querySelectorAll<HTMLElement>('.db-row') ?? [])]
    const row = rows.find((r) => cy <= r.getBoundingClientRect().bottom + 11 && cy >= r.getBoundingClientRect().top - 40)
    const cols = [...(row?.querySelectorAll<HTMLElement>('.db-col[data-head="1"]') ?? [])]
    const right = cols.find((c) => cx < c.getBoundingClientRect().left + c.getBoundingClientRect().width / 2)
    return right ? Number(right.dataset.col) : null
  }

  /** 卡拖进另一个标签里的文档：那篇插进去、这篇删掉这段，两篇存好一次提交，提示能撤回；选中的几张一起拖的，几段一起挪（按原来的先后） */
  const moveAcross = async (us: DocUnit[], spot: DocSpot) => {
    const order = [...us].sort((a, b) => a.from - b.from)
    const body = order.map((u) => cur.current.slice(u.from, u.to)).join('\n\n')
    const target = spot.doc.path
    insertInto(spot, body)
    apply(order.length > 1 ? removeUnits(cur.current, order) : removeUnit(cur.current, order[0]!))
    try {
      await NoteDoc.saveAll()
      // 不翻：提交说明（写进 Git）
      const msg = order.length > 1 ? `挪了${order.length}段：《${titleOf(props.notePath)}》→《${titleOf(target)}》` : `挪了一段：《${titleOf(props.notePath)}》→《${titleOf(target)}》`
      const hash = await window.cn.boardCommit([props.notePath, target], msg)
      app().noticeUndo(tNow('挪了一段：《{from}》→《{to}》，两篇一起提交了', { from: titleOf(props.notePath), to: titleOf(target) }), () => {
        if (!hash) return
        void NoteDoc.saveAll().then(() => window.cn.boardRevert(hash).then(() => app().notice(tNow('撤回了：那一段回到了白板上'))))
      })
    } catch (e) {
      app().notice(String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }

  // 视频卡、时刻卡：点一下在右栏播（时刻从那一秒）；卡里的「第 3 页」：和 AI 回答里的引用一样点一下出卡（那页缩略图）、⌘点翻过去（cite.tsx）
  const onClick = (e: React.MouseEvent, u: DocUnit) => {
    const t = e.target as HTMLElement
    const m = t.closest<HTMLElement>('.db-moment')
    if (m?.dataset.url) return void openVideo(m.dataset.url)
    const f = faceOf(u, ctx)
    // 问答卡里框的那块截图（task-yp8l7）：点一下直接回 PDF 那一页、那块闪一下，不出引用预览卡（页码小牌才先出卡）
    const crop = f.k === 'ask' || f.k === 'askpart' ? t.closest<HTMLElement>('a.db-ask-crop[data-href], a.db-ask-page[data-href]') : null
    if (crop) return void openPageLink(props.notePath, crop.dataset.href!, cur.current, u.from, crop.dataset.label ?? '')
    // AI 块卡头的「回到 AI 对话」：右栏 AI 换到那段对话、滚到那条回答（和文档里那条链接一样）
    const chatA = t.closest<HTMLElement>('a.db-chat[data-chat]')
    const chat = chatA ? parseChatLink(chatA.dataset.chat!) : null
    if (chat) return void jumpToChat(chat.key, chat.msg)
    // 问答组里问的那张：「—— 6.1.2 … ↩」点一下右栏网页回到那一段（和文档里的来源行一样）
    const back = f.k === 'askpart' ? t.closest<HTMLElement>('a.db-ask-src[data-href]') : null
    if (back) return void (/^https?:/i.test(back.dataset.href!) ? app().openWebAt(back.dataset.href!) : openPageLink(props.notePath, back.dataset.href!, cur.current, u.from, ''))
    // 嵌进来的别的笔记里的链接相对那一篇，不归这块白板认
    const pg = f.k === 'note' || f.k === 'clipnote' || f.k === 'board' ? null : t.closest<HTMLElement>('a.pg[data-page], a.pg[data-href]')
    if (pg) return void clickPage(e.nativeEvent, pg, props.notePath, pg.dataset.href ?? `#page=${pg.dataset.page}`, cur.current, u.from)
    const video = u.kind === 'video' || (f.k === 'cardbody' && f.kind === 'video')
    if (u.kind === 'moment' || (video && t.closest('.play, .cb-cover'))) playUnit(u)
  }
  /** 视频卡（连光秃秃一行视频网址）、时刻卡：在右栏播，时刻从那一秒 */
  const playUnit = (u: DocUnit) => {
    const v = videoUrlOfCard(u.kind === 'video' && u.moments ? u.text.slice(0, u.moments[0]!.from - u.from) : u.text)
    if (v) void openVideo(v.url, v.resume)
  }
  const openTarget = (o: OpenTarget) => {
    if (o.kind === 'url') return app().openInWeb(o.url)
    app().openFile(o.path)
    const page = o.page
    if (page && /\.pdf$/i.test(o.path)) setTimeout(() => Reading.jumpTo(o.path, page), 300)
  }
  /** 就地改的卡（字为主的几种）；别的双击看全文 */
  const inlineKinds = new Set(['text', 'list', 'todo', 'quote', 'callout', 'html'])
  /** 双击：PDF 页、白板、嵌入的笔记、HTML 打开那样东西；文字卡就地改；别的看全文 */
  const onDouble = (e: React.MouseEvent, u: DocUnit, f: Face, key: string) => {
    if ((e.target as HTMLElement).closest('input, button, .card-edit')) return
    e.stopPropagation()
    if (f.k === 'pdf' && f.file) return openTarget({ kind: 'file', path: f.file.path, page: f.page })
    if (f.k === 'board' || f.k === 'note' || f.k === 'clipnote') return openTarget({ kind: 'file', path: f.note.path })
    if (f.k === 'link' && f.open) return openTarget(f.open)
    // 视频卡、时刻卡双击也是播（时刻卡点在挂着的时刻上从那一秒）
    if (f.k === 'cardbody' && (f.kind === 'video' || f.kind === 'moment')) {
      const m = (e.target as HTMLElement).closest<HTMLElement>('.db-moment')
      return m?.dataset.url ? void openVideo(m.dataset.url) : playUnit(u)
    }
    // 合成的一张（几段）不就地改：看全文（「拆开」在右键菜单里）
    if (!props.readOnly && inlineKinds.has(u.kind) && !u.parts) return setEdit({ kind: 'unit', key, unit: u, base: cur.current })
    setFull({ unit: u, base: cur.current })
  }
  /** 就地改完一张已有的卡：字空了就是删掉这一段 */
  const doneUnit = (e: Extract<Edit, { kind: 'unit' }>, v: string | null, closing = false) => {
    setEdit(null)
    if (v === null) {
      // 字删光了就是删掉这一段；外面也改了这一段时不删（留着外面那版）
      const now = splitDoc(cur.current)
      const again = findUnitAgain(e.unit, e.base, cur.current, now)
      if ('same' in again && again.same) write(removeUnit(cur.current, again.unit), tNow('字删光了，这张卡也删了：文档里这一段没了'))
      return
    }
    if (v !== e.unit.text) saveCard({ unit: e.unit, base: e.base }, v, closing)
  }
  /** 空卡写完：写了字才放进去 */
  const doneNew = (e: Extract<Edit, { kind: 'new' }>, v: string | null) => {
    setEdit(null)
    if (v === null) return
    const todo = /^\s*[-*] \[[ xX]\]/.test(v)
    put(
      e.where,
      v,
      todo
        ? { col: tNow('待办放进了「%s」：文档这一节多了这一段'), free: tNow('待办放在这里：文档末尾多了这一段和一行位置') }
        : { col: tNow('新卡片放进了「%s」：文档这一节多了这一段'), free: tNow('新卡片放在这里：文档末尾多了这一段和一行位置') },
    )
  }

  // ----- 选中的卡：⌫ 删、Esc 取消 -----
  const removeKeys = (ks: Iterable<string>) => {
    // 按名字在现在的全文里找回这几张（连按 ⌫ 时 props.text 可能还没跟上），一次删掉（连着它们的线一起去掉）
    const now = [...unitKeys(splitDoc(cur.current))]
    const units = [...ks].flatMap((k) => now.filter(([, x]) => x === k).map(([u]) => u))
    const n = units.length
    if (n) write(removeUnits(cur.current, units), n === 1 ? tNow('删了{n}张卡：文档里这一段一起删了', { n }) : tNow('删了{n}张卡：文档里这{n}段一起删了', { n }))
    setSelected(new Set())
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (typingIn(e.target) || edit) return
    // ⌘A 全选（白板上的卡，task-5ryf9）、⌘C 复制选中的几张的 md 原文、⌘D 复制一份
    if (isKey(e.nativeEvent, 'select-all')) {
      e.preventDefault()
      setSelWire(null)
      setSelected(new Set([...keys.values()].filter((k) => groupKeyOf(k) === k)))
      return
    }
    if (selected.size && isKey(e.nativeEvent, 'copy')) {
      e.preventDefault()
      return bar.act('copy')
    }
    if (selected.size && isKey(e.nativeEvent, 'dup-block') && !props.readOnly) {
      e.preventDefault()
      return bar.act('dup')
    }
    if ((e.key === 'Backspace' || e.key === 'Delete') && !props.readOnly) {
      if (selWire) {
        const [from, to] = selWire.split('>')
        write(unlink(cur.current, from!, to!), tNow('删了这条线'))
        setSelWire(null)
      } else if (selected.size) removeKeys(selected)
      else return
      e.preventDefault()
    } else if (e.key === 'Escape') {
      setSelected(new Set())
      setSelWire(null)
      setExpanded(null)
    }
  }

  // 选了两张起的那一条（board-bar.tsx）
  const bar = useBoardBar({
    notePath: props.notePath,
    readOnly: props.readOnly,
    board,
    keys,
    byKey,
    selected,
    setSelected,
    rects,
    colW: COL_W,
    cur,
    write: (next, what, extra) => write(next, what, extra),
    apply: (next) => apply(next),
    toast: (text, undo) => setToast(undo ? { text, undo } : { text }),
    pendingRename,
    removeKeys,
    notes: props.notes,
    plane,
    wrap,
    hidden: !!marq || (drag?.type === 'unit' && drag.moved),
    off: !!edit || !!full || !!expanded,
    focus: () => outer.current?.focus({ preventScroll: true }),
    active: props.active,
    feynman: (ks) => feynmanCards(ks),
  })

  // ----- 费曼学习（task-yvabi 方向 B）：这块白板上讲的一轮是文档里的一节，画成「费曼 · X」一列（feynman/Column.tsx） -----
  /** 文档里的每一轮，和它在白板上是哪一列（标题行对上） */
  const rounds = useMemo(() => findRounds(text), [text])
  const roundOfCol = (c: DocColumn) => (c.head ? rounds.find((r) => r.head.from === c.head!.from) : undefined)
  // 费曼「拍成导图」的导图卡：放进材料那张卡所在那一列的末尾（不是费曼那一节）；找不到那张卡就摆在列右边的空白处
  seedWhereRef.current = (near?: string): Where => {
    const head = near?.trim().slice(0, 20)
    const i = head ? board.columns.findIndex((c) => !c.ask && !roundOfCol(c) && c.cards.some((u) => u.text.trim().startsWith(head))) : -1
    return i >= 0 ? { col: i, before: -1 } : freeWhere()
  }
  /** 正在讲的那一轮要盖住的卡 */
  const covered = useCovered(props.notePath, text)
  /** 选中的几张交给费曼：材料就是这几张，摆在它们右边 */
  const feynmanCards = (ks: Iterable<string>) => {
    const us = [...ks].map((k) => ({ k, u: byKey.get(k) })).filter((x): x is { k: string; u: DocUnit } => !!x.u)
    if (!us.length) return false
    const rs = us.map((x) => rects[x.k]).filter((r): r is Rect => !!r)
    const box = rs.length ? { x: Math.min(...rs.map((r) => r.x)), y: Math.min(...rs.map((r) => r.y)), w: 0, h: 0 } : null
    if (box) (box.w = Math.max(...rs.map((r) => r.x + r.w)) - box.x), (box.h = Math.max(...rs.map((r) => r.y + r.h)) - box.y)
    const at = box ? besideFree(box) : undefined
    // 一张嵌着一整份 PDF 的卡（![[x.pdf]]，没指定哪一页）：当一整份 PDF，先出这一讲的知识点单子挑一个
    const whole = us.length === 1 ? /^!\[\[([^\]|#]+\.pdf)\]\]$/i.exec(us[0]!.u.text.trim()) : null
    const pdf = whole ? (files.find((f) => f.path === whole[1] || f.path.endsWith('/' + whole[1]))?.path ?? null) : null
    void Fy.start({
      path: props.notePath,
      from: pdf ? [{ kind: 'pdf', path: pdf }] : us.map((x) => ({ kind: 'card' as const, path: props.notePath, ...(unitIdOf(x.u) ? { id: unitIdOf(x.u) } : {}), head: headOf(x.u.text) })),
      ...(at ? { at } : {}),
    })
    setSelected(new Set())
    return true
  }
  /**
   * 选中的东西旁边一处空地（330 宽、520 高放得下，不压着别的列和卡）：先看右边，再看下面、左边，挑离选中的最近的一处；
   * 都不空就往右挪到放得下为止
   */
  /** 白板上占着地方的：一排里的列、摆开的列和卡、别的费曼列（白板坐标） */
  const takenRects = (): Rect[] => {
    const p = plane.current
    const base = p?.getBoundingClientRect()
    const sc = props.scale || 1
    return p && base
      ? [...p.querySelectorAll<HTMLElement>('.db-col, .db-card.placed, .fy-col')].map((el) => {
          const r = el.getBoundingClientRect()
          return { x: (r.left - base.left) / sc, y: (r.top - base.top) / sc, w: r.width / sc, h: r.height / sc }
        })
      : Object.values(rects)
  }
  const FY_W = 330
  const FY_H = 520
  const besideFree = (sel: Rect) => {
    const all = takenRects()
    const W = FY_W
    const H = FY_H
    const free = (x: number, y: number) => x >= 0 && y >= 0 && !all.some((r) => r.x < x + W && r.x + r.w > x && r.y < y + H && r.y + r.h > y)
    const tries = [
      { x: sel.x + sel.w + 28, y: sel.y },
      { x: sel.x, y: sel.y + sel.h + 28 },
      { x: sel.x - W - 28, y: sel.y },
    ]
    const hit = tries.find((p) => free(p.x, p.y))
    if (hit) return hit
    let x = sel.x + sel.w + 28
    for (let k = 0; k < 40 && !free(x, sel.y); k++) x = Math.max(x + 28, ...all.filter((r) => r.x < x + W && r.x + r.w > x && r.y < sel.y + H && r.y + r.h > sel.y).map((r) => r.x + r.w + 28))
    return { x, y: sel.y }
  }
  /** 工具板「费曼学习」：先选了东西就直接开始；什么都没选出讲哪个点的小框 */
  const feynmanPal = (at: Pt) => {
    if (props.readOnly) return
    if (selected.size && feynmanCards(selected)) return
    setFyPop(at)
  }
  /**
   * 画面正中附近一处空地（费曼那一列 330 × 520 放得下、不压着列和卡）：以前写一个词开的一轮放在正中那一列的末尾、
   * 或者左上角对着画面正中（小窗口里就挂到右下角去了）；现在这一列的中心尽量落在画面正中，压着东西就就近挪开
   */
  const viewFree = (): Pt => {
    const w = wrap.current
    const sc = props.scale || 1
    if (!w) return { x: 40, y: 80 }
    const wr = w.getBoundingClientRect()
    // 左边让出工具板，上边让出顶上那条
    const c = planeXY(wr.left + ROOM + (wr.width - ROOM) / 2, wr.top + 56 + (wr.height - 56) / 2)
    const want = { x: Math.round(c.x - FY_W / 2), y: Math.round(Math.max(c.y - FY_H / 2, planeXY(0, wr.top + 64).y)) }
    const all = takenRects()
    const free = (x: number, y: number) => x >= 0 && y >= 0 && !all.some((r) => r.x < x + FY_W && r.x + r.w > x && r.y < y + FY_H && r.y + r.h > y)
    // 由近到远一圈圈找（一步 40，最远两屏）
    const step = 40
    const far = Math.ceil(Math.max(wr.width, wr.height) / sc / step) * 2
    for (let k = 0; k <= far; k++)
      for (let dx = -k; dx <= k; dx++)
        for (const dy of k === 0 ? [0] : Math.abs(dx) === k ? Array.from({ length: 2 * k + 1 }, (_, i) => i - k) : [-k, k]) {
          const x = Math.max(0, want.x + dx * step)
          const y = Math.max(0, want.y + dy * step)
          if (free(x, y)) return { x, y }
        }
    return { x: Math.max(0, want.x), y: Math.max(0, want.y) }
  }
  const feynmanWord = (word: string) => {
    void Fy.start({ path: props.notePath, from: [{ kind: 'word', word }], at: viewFree() })
  }
  /** 小框里「从这块白板上挑」：一列（这一节的卡）、一张 PDF 卡 */
  const feynmanItems = (): PickItem[] =>
    board.columns
      .filter((c) => c.title && !c.ask && !roundOfCol(c) && c.cards.some((u) => u.kind !== 'gap'))
      .slice(0, 12)
      .map((c) => ({ key: 'c:' + c.title, label: c.title!, icon: 'split-horizontal' as const, start: () => void feynmanCards(c.cards.filter((u) => u.kind !== 'gap').map((u) => keys.get(u)!).slice(0, 12)) }))
  // 新的一轮写进文档以后：摆到选中的那几张右边（列的位置行，和拖列头一样）
  useEffect(() => {
    if (props.readOnly) return
    for (const r of rounds) {
      const want = Fy.placeOf(r.meta.id)
      if (!want) continue
      const col = board.columns.find((c) => c.head?.from === r.head.from)
      Fy.takePlace(r.meta.id)
      if (col && !col.place) apply(placeColumn(cur.current, col, Math.round(want.x), Math.round(want.y)))
    }
  }, [rounds])

  // ----- 框选、平移（task-5ryf9，17-白板框选 方向 A；用户定：空白处拖 = 框选、碰到就选） -----
  /** 空白处按住拖出一个框：碰到的卡都选上（按住 ⇧ 是加在已经选着的上面）；不动松手是取消选中。框只选卡，不选列、不选线 */
  const startMarquee = (e: React.MouseEvent) => {
    const w = wrap.current
    const area = w?.parentElement
    if (!w || !area) return
    if (!(e.target as HTMLElement).closest('button, input, a, textarea')) e.preventDefault()
    const base = e.shiftKey ? new Set(selected) : new Set<string>()
    if (!e.shiftKey) setSelected(new Set())
    const wr0 = w.getBoundingClientRect()
    const sx0 = w.scrollLeft
    const sy0 = w.scrollTop
    // 卡在白板内容里的位置（按下时量一次；拖到边上自己滚的时候照样对得上）
    const cards = [...(plane.current?.querySelectorAll<HTMLElement>('.db-card[data-id]') ?? [])].flatMap((el) => {
      const k = el.dataset.id
      if (!k || !byKey.has(k)) return []
      const r = el.getBoundingClientRect()
      return [{ key: k, r: { left: r.left - wr0.left + sx0, top: r.top - wr0.top + sy0, right: r.right - wr0.left + sx0, bottom: r.bottom - wr0.top + sy0 } }]
    })
    const inContent = (cx: number, cy: number) => {
      const r = w.getBoundingClientRect()
      return { x: cx - r.left + w.scrollLeft, y: cy - r.top + w.scrollTop }
    }
    const start = inContent(e.clientX, e.clientY)
    let moved = false
    let last = { x: e.clientX, y: e.clientY }
    let shown = ''
    let raf = 0
    const update = () => {
      const cur = inContent(last.x, last.y)
      const hits = hitKeys(boxOf(start, cur), cards).map(groupKeyOf)
      const next = [...new Set([...base, ...hits])]
      const id = next.join('\n')
      if (id !== shown) {
        shown = id
        setSelected(new Set(next))
      }
      // 画框：.db-area 里的坐标，夹在这一块里
      const ar = area.getBoundingClientRect()
      const wr = w.getBoundingClientRect()
      const toArea = (p: Pt) => ({ x: p.x - w.scrollLeft + wr.left - ar.left, y: p.y - w.scrollTop + wr.top - ar.top })
      const b = boxOf(toArea(start), toArea(cur))
      setMarq({ left: Math.max(0, b.left), top: Math.max(0, b.top), right: Math.min(ar.width, b.right), bottom: Math.min(ar.height, b.bottom) })
    }
    // 拖到白板边上：往那边滚（越靠边越快），框跟着长
    const edge = () => {
      raf = 0
      if (!moved) return
      const r = w.getBoundingClientRect()
      const dx = last.x < r.left + 32 ? -1 : last.x > r.right - 32 ? 1 : 0
      const dy = last.y < r.top + 32 ? -1 : last.y > r.bottom - 32 ? 1 : 0
      if (!dx && !dy) return
      w.scrollLeft += dx * 14
      w.scrollTop += dy * 14
      update()
      raf = requestAnimationFrame(edge)
    }
    const move = (ev: MouseEvent) => {
      last = { x: ev.clientX, y: ev.clientY }
      if (!moved) {
        if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 4) return
        moved = true
      }
      update()
      if (!raf) raf = requestAnimationFrame(edge)
    }
    // 松手没送到页面也收：框碰到的卡照样选着（trackDrag，task-0nz63）
    trackDrag(e, {
      move,
      end: () => {
        cancelAnimationFrame(raf)
        setMarq(null)
        if (!moved) setSelected(new Set())
      },
    })
  }
  /** 按住空格拖、中键拖：白板跟着手走（两指滑照旧） */
  const startPan = (e: React.MouseEvent) => {
    const w = wrap.current
    if (!w) return
    e.preventDefault()
    e.stopPropagation()
    const x0 = e.clientX
    const y0 = e.clientY
    const l0 = w.scrollLeft
    const t0 = w.scrollTop
    setPanning(true)
    const move = (ev: MouseEvent) => {
      w.scrollLeft = l0 - (ev.clientX - x0)
      w.scrollTop = t0 - (ev.clientY - y0)
    }
    // 中键拖也一样：松手没送到页面，停在最后的位置（trackDrag，task-0nz63）
    trackDrag(e, { move, end: () => setPanning(false) })
  }
  // 按住空格：光标变成小手，这时按住拖是平移（焦点在打字的地方、白板外面时不管）
  useEffect(() => {
    if (!props.active) return
    const set = (on: boolean) => {
      if (spaceRef.current === on) return
      spaceRef.current = on
      setSpace(on)
    }
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.metaKey || e.ctrlKey || e.altKey || e.isComposing || typingIn(e.target)) return
      const o = outer.current
      if (!o?.checkVisibility()) return
      const a = document.activeElement
      if (a && a !== document.body && !o.contains(a)) return
      e.preventDefault()
      set(true)
    }
    const up = (e: KeyboardEvent) => e.code === 'Space' && set(false)
    const blur = () => set(false)
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
      window.removeEventListener('blur', blur)
      set(false)
    }
  }, [props.active])

  // ----- 从访达拖图、⌘V 贴图：存进附件，落在哪放在哪 -----
  const lastDrop = useRef<Pt | null>(null)
  const imageDrop = useBoardImageDrop({
    notePath: props.notePath,
    readOnly: props.readOnly,
    toPlane: planeXY,
    freeSpot: () => {
      const w = centerWhere()
      return 'x' in w ? w : { x: 40, y: 80 }
    },
    onNotice: (t) => setToast({ text: t }),
    addCards(mds, at) {
      const slot = lastDrop.current ? slotAt(lastDrop.current.x, lastDrop.current.y) : null
      lastDrop.current = null
      let t = cur.current
      mds.forEach((md, i) => {
        if (slot) {
          const b = splitDoc(t)
          const col = b.columns[slot.col]
          if (col) t = insertInColumn(t, col, slot.before >= 0 ? (col.cards[slot.before] ?? null) : null, md)
        } else t = appendPlaced(t, md, at.x + i * 24, at.y + i * 24)
      })
      setFlash(mds[mds.length - 1]!.trim())
      write(t, slot ? tNow('放了{n}张图：存进了这篇的附件，文档那一节多了一段', { n: mds.length }) : tNow('放了{n}张图：存进了这篇的附件，文档末尾多了一段，带一行位置', { n: mds.length }))
    },
  })

  // ----- 从左栏文件树拖一篇笔记上来：放一张 ![[它]]（白板放 [[它]]） -----
  const noteDragOver = (e: React.DragEvent) => {
    const types = e.dataTransfer.types
    if (props.readOnly || !(types.includes(NOTE_MIME) || types.includes(NOTES_MIME))) return false
    e.preventDefault()
    // 文件树拖出来是「挪」（effectAllowed move）：照它的说法，不然松手不算
    e.dataTransfer.dropEffect = e.dataTransfer.effectAllowed === 'copy' ? 'copy' : 'move'
    setNoteDrop(true)
    setDrop(slotAt(e.clientX, e.clientY))
    return true
  }
  const noteDropped = (e: React.DragEvent) => {
    const one = e.dataTransfer.getData(NOTE_MIME)
    const many = e.dataTransfer.getData(NOTES_MIME)
    setNoteDrop(false)
    let paths: string[] = one ? [one] : []
    if (many) {
      try {
        paths = (JSON.parse(many) as unknown[]).filter((x): x is string => typeof x === 'string')
      } catch {
        paths = []
      }
    }
    paths = paths.filter((p) => /\.md$/i.test(p) && p !== props.notePath)
    if (!paths.length || props.readOnly) return false
    e.preventDefault()
    const slot = slotAt(e.clientX, e.clientY)
    setDrop(null)
    const p = planeXY(e.clientX, e.clientY)
    // 白板放 [[白板]]（画成白板卡），别的放 ![[笔记]]（嵌入的笔记卡、整页剪藏卡）
    const md = paths.map((path) => (props.notes.find((n) => n.path === path)?.board ? `[[${titleOf(path)}]]` : `![[${titleOf(path)}]]`))
    let t = cur.current
    md.forEach((m, i) => {
      if (slot) {
        const col = splitDoc(t).columns[slot.col]
        if (col) t = insertInColumn(t, col, slot.before >= 0 ? (col.cards[slot.before] ?? null) : null, m)
      } else t = appendPlaced(t, m, Math.max(0, p.x - 24 + i * 24), Math.max(0, p.y - 16 + i * 24))
    })
    setFlash(md[md.length - 1]!)
    const single = paths.length === 1 ? titleOf(paths[0]!) : null
    const n = paths.length
    const col = slot ? (board.columns[slot.col]?.title ?? tNow('开头')) : ''
    write(
      t,
      slot
        ? single !== null
          ? tNow('《{name}》放进了「{col}」：文档里多了一行嵌入', { name: single, col })
          : tNow('{n}篇放进了「{col}」：文档里多了{n}行嵌入', { n, col })
        : single !== null
          ? tNow('《{name}》放在这里：文档末尾多了嵌入，带位置', { name: single })
          : tNow('{n}篇放在这里：文档末尾多了嵌入，带位置', { n }),
    )
    return true
  }

  // ----- 右键（DESIGN.v3 9.2）：卡片、选了几张、空白处、连线、列 -----
  /** 卡片转成文档：开头一行当名字，新建在这块白板旁边，这段换成指向它的双链 */
  const cardToDoc = async (u: DocUnit) => {
    const body = u.text
    const first = body.split('\n').find((l) => l.trim())?.replace(/^[#>*\-\s[\]x]+/i, '').replace(/[*_`[\]]/g, '').trim() ?? ''
    const name = first.slice(0, 40) || '卡片' // 不翻：新建文档的文件名，写进库里
    const dir = props.notePath.includes('/') ? props.notePath.slice(0, props.notePath.lastIndexOf('/')) : ''
    const doc = /^#\s/.test(body.trimStart()) ? body.trim() + '\n' : `# ${name}\n\n${body.trim()}\n`
    const path = await window.cn.createNote(dir, name, doc)
    write(cur.current.slice(0, u.from) + `[[${titleOf(path)}]]` + cur.current.slice(u.to), tNow('转成了文档「{name}」：这里换成指向它的链接', { name: titleOf(path) }))
    app().refresh()
  }
  const cardMenu = (u: DocUnit, key: string, one?: { unit: DocUnit; key: string }): MenuEntry[] => {
    const f = faceOf(u, ctx)
    const ed = one ?? { unit: u, key }
    const target = f.k === 'board' || f.k === 'note' || f.k === 'clipnote' ? f.note.path : f.k === 'link' && f.open?.kind === 'file' ? f.open.path : null
    const inCol = !u.place
    const colOf = board.columns.find((c) => c.cards.includes(u))
    return [
      target ? { label: tNow('打开'), run: () => app().openFile(target) } : !videoUrlOfCard(u.text) && { label: tNow('编辑'), run: () => (inlineKinds.has(ed.unit.kind) && !ed.unit.parts ? setEdit({ kind: 'unit', key: ed.key, unit: ed.unit, base: cur.current }) : setFull({ unit: ed.unit, base: cur.current, edit: true })) },
      // 合成的一张（task-5ryf9）：拆开就是去掉前面那一行注释
      u.parts && { label: tNow('拆开'), run: () => write(splitMerged(cur.current, u), tNow('拆开了：去掉了前面那一行注释，{n}段各是各的卡', { n: u.parts!.length })) },
      { label: tNow('复制一份'), run: () => (setFlash(u.text.trim()), write(duplicateUnit(cur.current, u), tNow('复制了一份：文档里紧跟着多了这一段'))) },
      inCol && colOf?.head
        ? {
            label: tNow('从列里拿出来'),
            run: () => {
              const r = rects[key]
              const c = rects['col:' + board.columns.indexOf(colOf)]
              write(placeUnit(cur.current, u, Math.round((c ? c.x + c.w : (r?.x ?? 0) + (r?.w ?? 0)) + 24), Math.round(r?.y ?? 0)), tNow('拿出来了：放在列的右边，文档里这段前面多了一行位置'))
            },
          }
        : u.place && { label: tNow('放回那一节'), run: () => write(unplaceUnit(cur.current, u), tNow('放回了那一节：位置行去掉了，正文没动')) },
      '-',
      u.text.trim() && { label: tNow('问 AI 这张'), ai: 'chat', run: () => app().askAi(u.text) },
      '-',
      !target && u.text.trim() && { label: tNow('转成文档'), run: () => cardToDoc(u) },
      '-',
      { label: tNow('删除', { ctx: '白板菜单' }), accel: accelFor('delete'), run: () => removeKeys([key]) },
    ]
  }
  const manyMenu = (ks: Set<string>): MenuEntry[] => {
    const placed = [...ks].map((k) => byKey.get(k)).filter((u): u is DocUnit => !!u?.place)
    const alignTo = (edgeKey: 'x' | 'y') => {
      const v = Math.min(...placed.map((u) => u.place![edgeKey]))
      let t = cur.current
      for (const k of ks) {
        const u = [...unitKeys(splitDoc(t))].find(([, x]) => x === k)?.[0]
        if (u?.place) t = placeUnit(t, u, edgeKey === 'x' ? v : u.place.x, edgeKey === 'y' ? v : u.place.y)
      }
      write(t, edgeKey === 'x' ? tNow('左对齐了：只改了这几行位置') : tNow('顶对齐了：只改了这几行位置'))
    }
    const tidy = () => {
      const order = [...placed].sort((a, b) => a.place!.y - b.place!.y || a.place!.x - b.place!.x)
      const perRow = Math.ceil(Math.sqrt(order.length))
      const x0 = Math.min(...order.map((u) => u.place!.x))
      let y = Math.min(...order.map((u) => u.place!.y))
      const spots = new Map<string, Pt>()
      for (let r = 0; r * perRow < order.length; r++) {
        const row = order.slice(r * perRow, r * perRow + perRow)
        row.forEach((u, c) => spots.set(keys.get(u)!, { x: x0 + c * (COL_W + 24), y }))
        y += Math.max(...row.map((u) => rects[keys.get(u)!]?.h ?? 120)) + 24
      }
      let t = cur.current
      for (const [k, p] of spots) {
        const u = [...unitKeys(splitDoc(t))].find(([, x]) => x === k)?.[0]
        if (u) t = placeUnit(t, u, p.x, p.y)
      }
      write(t, tNow('排整齐了：只改了这几行位置'))
    }
    const intoColumn = () => {
      let t = addSection(cur.current, '新的列', null, board.level) // 不翻：写进文件的默认节名
      const order = [...ks].map((k) => byKey.get(k)).filter((u): u is DocUnit => !!u).sort((a, b) => a.from - b.from)
      for (const u0 of order) {
        const b = splitDoc(t)
        const k = keys.get(u0)!
        const u = [...unitKeys(b)].find(([, x]) => x === k)?.[0]
        const col = b.columns[b.columns.length - 1]!
        if (u) t = moveUnit(t, u, col, null)
      }
      pendingRename.current = { name: '新的列', filled: true } // 不翻：拿它认出上面新加的那一节
      write(t, tNow('放进了新的一列：文档末尾新起一节，这{n}段挪了进去', { n: order.length }))
      setSelected(new Set())
    }
    return [
      { label: tNow('左对齐'), enabled: placed.length > 1, run: () => alignTo('x') },
      { label: tNow('顶对齐'), enabled: placed.length > 1, run: () => alignTo('y') },
      { label: tNow('排整齐'), enabled: placed.length > 1, run: tidy },
      '-',
      { label: tNow('放进新列'), run: intoColumn },
      '-',
      { label: tNow('删除 {n} 张', { n: ks.size }), accel: accelFor('delete'), run: () => removeKeys(ks) },
    ]
  }
  const emptyMenu = async (at: Pt, slot: Where | null): Promise<MenuEntry[]> => {
    const clip = await window.cnMenu.clipboardHas()
    const where: Where = slot ?? at
    return [
      { label: tNow('新卡片'), run: () => draftAt(where) },
      { label: tNow('新待办'), run: () => draftAt(where, '- [ ] ') },
      { label: tNow('新列'), run: () => createAt('column', slot && 'col' in slot ? slot : at) },
      { label: tNow('新子白板'), run: () => createAt('board', where) },
      '-',
      { label: tNow('拍导图'), accel: accelFor('capture'), run: () => createAt('map', where) },
      '-',
      clip.image
        ? { edit: 'paste' }
        : {
            label: tNow('粘贴'),
            accel: accelFor('paste'),
            enabled: clip.text,
            run: async () => {
              const t = (await window.cnMenu.readClipboardText()).trim()
              if (t) put(where, t, { col: tNow('贴进了「%s」：文档这一节多了这一段'), free: tNow('贴在了这里：文档末尾多了这一段，带一行位置') })
            },
          },
    ]
  }
  const onContext = async (e: React.MouseEvent) => {
    const t = e.target as HTMLElement
    if (props.readOnly || t.closest('input, textarea, [contenteditable="true"], .bpal, .db-inbox-pop, .dbx, .base-pop, .db-full-back, .card-edit')) return
    e.preventDefault()
    e.stopPropagation()
    outer.current?.focus({ preventScroll: true })
    const wireEl = t.closest<SVGElement>('[data-wire]')
    const cardEl = t.closest<HTMLElement>('.db-card[data-id]')
    const headEl = t.closest<HTMLElement>('.db-col h3')
    let items: MenuEntry[]
    if (wireEl) {
      const key = wireEl.dataset.wire!
      setSelWire(key)
      setSelected(new Set())
      const [from, to] = key.split('>')
      items = [{ label: tNow('删除连线'), accel: accelFor('delete'), run: () => (write(unlink(cur.current, from!, to!), tNow('删了这条线')), setSelWire(null)) }]
    } else if (cardEl?.dataset.id && byKey.get(cardEl.dataset.id)) {
      const key = groupKeyOf(cardEl.dataset.id)
      setSelWire(null)
      if (selected.has(key) && selected.size > 1) items = manyMenu(selected)
      else {
        setSelected(new Set([key]))
        // 问答那一组里的一张：「编辑」改这一张，别的（复制、拿出来、删）是整组
        items = cardMenu(byKey.get(key)!, key, key !== cardEl.dataset.id ? { unit: byKey.get(cardEl.dataset.id)!, key: cardEl.dataset.id } : undefined)
      }
    } else if (headEl) {
      const ci = Number(headEl.closest<HTMLElement>('.db-col')!.dataset.col)
      const col = board.columns[ci]
      // 问过 AI 的一处：标题是软件写的（「第 N 页 · …」认这一节靠它），不改名、不删
      if (!col?.head || col.ask) return
      items = [
        { label: tNow('改名'), run: () => setRenaming(ci) },
        '-',
        { label: tNow('删除列（卡片留下）'), run: () => write(removeColumn(cur.current, col), tNow('删了「{name}」这一列：只删了标题那一行，卡并进了上一节', { name: col.title })) },
      ]
    } else {
      const p = planeXY(e.clientX, e.clientY)
      items = await emptyMenu({ x: p.x - 24, y: p.y - 16 }, slotAt(e.clientX, e.clientY))
    }
    await showMenu(items)
  }

  // 右栏大纲点了一张卡片或一列：滚到正中、选中，闪一下
  useEffect(
    () =>
      onFlyToCard(props.notePath, (id, select) => {
        const w = wrap.current
        // 大纲里的列是「col:列名」
        const el = id.startsWith('col:') ? w?.querySelector<HTMLElement>(`.db-col[aria-label="${CSS.escape(id.slice(4))}"]`) : w?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"], [data-cid="${CSS.escape(id)}"]`)
        if (!w || !el) return
        const wr = w.getBoundingClientRect()
        const r = el.getBoundingClientRect()
        w.scrollTo({ left: w.scrollLeft + r.left - wr.left - (wr.width - r.width) / 2, top: w.scrollTop + r.top - wr.top - (wr.height - r.height) / 2, behavior: 'smooth' })
        if (select && el.dataset.id) setSelected(new Set([el.dataset.id]))
        el.classList.remove('flown')
        void el.offsetWidth
        el.classList.add('flown')
      }),
    [props.notePath],
  )

  // ----- 就地改的框 -----
  /**
   * 就地改的框（双击改的卡、刚放下的空卡）画在自己的一个节点里（portal），再把这个节点挂进卡的位置：
   * 外面改了这篇（同步盘、手机、AI）时卡的名字、在文档里的位置、哪一列都可能变，白板重画好几回，框里打的字和光标都不丢
   * （外部改动不丢正在打的字）。外面把这一段删了：框留在原来那一列的那个位置，存下时这段放回去、外面那版存成冲突副本。
   */
  const hostRef = useRef<{ edit: Edit; el: HTMLDivElement } | null>(null)
  if (edit && hostRef.current?.edit !== edit) {
    const el = document.createElement('div')
    el.className = 'db-edit-host'
    el.style.display = 'contents'
    hostRef.current = { edit, el }
  }
  const editHost = edit ? hostRef.current!.el : null
  const hostAt = useMemo(
    () => (slot: HTMLDivElement | null) => {
      if (!slot || !editHost || editHost.parentElement === slot) return
      slot.appendChild(editHost)
      // 挪了地方焦点会掉（节点离开过页面）：放回框里
      const a = document.activeElement
      if (!a || a === document.body) editHost.querySelector<HTMLElement>('.cm-content')?.focus({ preventScroll: true })
    },
    [editHost],
  )
  /** 正在改的那张卡现在是哪一段；外面删掉了时 ghost 是框留在哪 */
  const editAt = useMemo((): { unit: DocUnit } | { ghost: Where } | null => {
    if (edit?.kind !== 'unit') return null
    const again = findUnitAgain(edit.unit, edit.base, text, board)
    if ('unit' in again) return { unit: again.unit }
    if (edit.unit.place) return { ghost: { x: edit.unit.place.x, y: edit.unit.place.y } }
    // 删掉了：放在原来位置后面那一段前面（同一列），后面没有了就放最后一列的末尾
    const at = again.gone
    for (let ci = 0; ci < board.columns.length; ci++) {
      const i = board.columns[ci]!.cards.findIndex((u) => u.from >= at)
      if (i >= 0) return { ghost: { col: ci, before: i } }
    }
    return { ghost: { col: Math.max(0, board.columns.length - 1), before: -1 } }
  }, [edit, text, board])
  const editUnit = editAt && 'unit' in editAt ? editAt.unit : null
  /** 空卡（或者被外面删掉的那张卡的框）画在哪；列的序号超出了（外面删了几节）就放最后一列 */
  const slotWhere: Where | null = (() => {
    const w = edit?.kind === 'new' ? edit.where : editAt && 'ghost' in editAt ? editAt.ghost : null
    if (!w || !('col' in w) || w.col < board.columns.length) return w
    return { col: Math.max(0, board.columns.length - 1), before: -1 }
  })()

  // ----- 画 -----
  /** 别处嵌了这一节：列名下面一行 */
  const refsOf = (title: string | null) => (title ? refs.filter((r) => r.sections.includes(title)) : [])

  const draftCard = (n: number) =>
    slotWhere ? (
      <div key={'draft' + n} className="db-card editing draft" data-testid={edit?.kind === 'new' ? 'db-draft' : 'db-editing'}>
        <div className="db-edit-slot" ref={hostAt} style={{ display: 'contents' }} />
      </div>
    ) : null

  const card = (u: DocUnit, i: number, extra?: { style?: React.CSSProperties }, group?: DocUnit) => {
    if (u.kind === 'gap') return <div key={'g' + u.from} className="db-gap" />
    const key = keys.get(u) ?? ''
    // 混排一节里的一问一答（7b）：问的那张、浅底的回答、挂在下面的旁支排成一组，左边一道细线（选中时变强调色）
    if (u.group) {
      const draggingG = drag?.type === 'unit' && drag.moved && drag.key === key
      return (
        <div
          key={key || u.from}
          className={'db-askgroup' + (u.place ? ' placed' : '') + (draggingG ? ' dragging' : '') + (selected.has(key) ? ' sel' : '') + (flash && u.text.trim() === flash ? ' flash' : '')}
          data-i={i}
          data-id={key}
          data-from={u.from}
          style={extra?.style}
        >
          {u.group.map((g, k) =>
            // 旁支（问的那张 + 浅底回答）往里缩一格，外面一道虚线
            g.ask?.part === 'sideq' ? (
              <div key={'s' + g.from} className="db-askside">
                {card(g, i, undefined, u)}
                {u.group![k + 1] && card(u.group![k + 1]!, i, undefined, u)}
              </div>
            ) : u.group![k - 1]?.ask?.part === 'sideq' ? null : (
              card(g, i, undefined, u)
            ),
          )}
        </div>
      )
    }
    const f = faceOf(u, ctx)
    const dragging = drag?.type === 'unit' && drag.moved && (drag.key === key || !!drag.group?.some((g) => g.key === key))
    const editing = editUnit === u
    const side = f.k === 'callout' && f.kind === 'ai' ? sideSpot(u) : undefined
    const acts: CardActs = { onToggle: (line) => toggle(u, line), onOpen: openTarget, onFull: () => setFull({ unit: u, base: cur.current }), onExpand: () => (setSelected(new Set()), setExpanded(key)), ...(side ? { side } : {}) }
    const cls =
      `db-card ${u.parts ? 'merged' : faceClass(f)}` +
      (u.kind === 'video' && u.moments && !u.parts ? ' group' : '') +
      (dragging ? ' dragging' : '') +
      (u.place ? ' placed' : '') +
      (flash && u.text.trim() === flash ? ' flash' : '') +
      (selected.has(key) ? ' sel' : '') +
      (editing ? ' editing' : '') +
      (Fy.cardCovered(covered, unitIdOf(u), u.text) ? ' fy-covered' : '')
    return (
      <div
        key={aiHostOf(u) ?? (key || u.from)}
        className={cls}
        data-i={i}
        data-id={key}
        data-from={u.from}
        data-kind={u.kind}
        data-part={u.ask?.part}
        data-face={f.k === 'cardbody' ? f.kind : f.k}
        aria-label={faceName(f)}
        style={extra?.style}
        onMouseDown={(e) => onDown(e, u, key, group)}
        onClick={(e) => onClick(e, u)}
        onDoubleClick={(e) => onDouble(e, u, f, key)}
      >
        {editing ? (
          <div className="db-edit-slot" ref={hostAt} style={{ display: 'contents' }} />
        ) : u.parts ? (
          // 合成的一张（task-5ryf9）：几段各照自己的样子画，中间一道细线
          u.parts.map((p) => (
            <div key={p.from} className="db-part" data-face={faceClass(faceOf(p, ctx))}>
              <UnitBody u={p} f={faceOf(p, ctx)} ctx={ctx} acts={{ ...acts, onToggle: (line) => toggle(p, line) }} />
            </div>
          ))
        ) : u.kind === 'video' && u.moments ? (
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
        {u.attrs?.ai && !editing && <div className="aifoot">{t('AI 总结的 · {engine}', { engine: u.attrs.ai })}</div>}
        {!props.readOnly && !editing && !group && (
          <span
            className="db-handle"
            title={t('拖到另一张卡上连线')}
            onMouseDown={(e) => {
              if (e.button !== 0) return
              e.stopPropagation()
              e.preventDefault()
              setDrag({ type: 'wire', from: key, at: planeXY(e.clientX, e.clientY) })
            }}
          />
        )}
      </div>
    )
  }

  /** 一排里第几列开始只留列头（第 7 节起） */
  const rowCols = board.columns.map((c, ci) => ({ c, ci })).filter((x) => !x.c.place)
  const column = (c: DocColumn, ci: number, rowIndex: number, style?: React.CSSProperties) => {
    const folded = rowIndex >= rowSize && !open.has(ci)
    const cards = c.cards.filter((u) => u.kind !== 'gap')
    // 列头的张数照小样：挂在视频下面的时刻也是一张卡
    const count = cards.reduce((n, u) => n + (u.group?.length ?? 1) + (u.moments?.length ?? 0), 0)
    // 问过 AI 的一处：主对话问了几问、开了几条旁支
    const asks = c.ask ? cards.filter((u) => u.ask?.part === 'qa' || u.ask?.part === 'side' || u.ask?.part === 'old').length : 0
    const showAll = more.has(ci)
    let shown = 0
    const lead = c.title === null
    const cited = refsOf(c.title)
    const draftHere = slotWhere && 'col' in slotWhere && slotWhere.col === ci ? slotWhere.before : null
    const draggingMe = drag?.type === 'col' && drag.moved && drag.ci === ci
    return (
      <section
        key={'c' + ci}
        className={'db-col' + (lead ? ' bare' : '') + (folded ? ' fold' : '') + (drop?.col === ci ? ' drop' : '') + (c.place ? ' placed' : '') + (draggingMe ? ' dragging' : '')}
        data-col={ci}
        data-cid={c.place?.id ?? undefined}
        // AI 的 board_* 工具里列的 id 就是列名：AI 指针去拿这一列时按它找
        data-id={c.head && c.title ? c.title : undefined}
        data-ask={c.ask ? '1' : '0'}
        data-head={c.head ? '1' : '0'}
        data-slice={c.slice ? (c.slice.first ? 'first' : '1') : undefined}
        aria-label={c.title ?? t('开头')}
        style={style}
        onClick={() => folded && setOpen(new Set(open).add(ci))}
      >
        {/* 按剪藏来源分的小列：上面一行小字是它在哪一节 */}
        {c.slice && c.slice.section && c.title !== c.slice.section && <div className="db-col-sec">{c.slice.section}</div>}
        {!lead &&
          (renaming === ci ? (
            <input
              className="db-col-name"
              aria-label={t('列名')}
              defaultValue={c.title ?? ''}
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
              onMouseDown={(e) => e.stopPropagation()}
              onBlur={(e) => {
                setRenaming(null)
                const t = e.currentTarget.value.trim()
                if (t && t !== c.title) write(renameColumn(cur.current, c, t), tNow('列名改成了「{name}」：文档里这一节的标题跟着改了', { name: t }))
              }}
              onKeyDown={(e) => {
                // 输入法还在组字：回车、Esc 交给输入法（CN-115）
                if (composing(e)) return
                if (e.key === 'Enter') (e.preventDefault(), e.currentTarget.blur())
                if (e.key === 'Escape') (e.preventDefault(), (e.currentTarget.value = c.title ?? ''), e.currentTarget.blur())
              }}
            />
          ) : (
            <h3
              onMouseDown={(e) => {
                // 按剪藏来源分的小列（7c）只是看法：不整列拖
                if (e.button !== 0 || props.readOnly || !c.head || c.slice || e.detail > 1) return
                const r = (e.currentTarget.closest('.db-col') as HTMLElement).getBoundingClientRect()
                setDrag({ type: 'col', ci, start: { x: e.clientX, y: e.clientY }, at: { x: e.clientX, y: e.clientY }, grab: { x: e.clientX - r.left, y: e.clientY - r.top }, moved: false, w: r.width })
              }}
              onDoubleClick={(e) => c.head && !c.ask && !c.slice && !props.readOnly && (e.stopPropagation(), setRenaming(ci))}
              title={c.head && !c.slice && !props.readOnly ? (c.ask ? t('按住拖到空白处摆在那里') : t('双击改列名；按住列名拖到空白处摆在那里')) : undefined}
            >
              {c.ask && <Codicon name="comment-discussion" size={14} />}
              {/* 问过 AI 的一处：文件里写「第 3 页」，画成「第3页」（中文和数字之间不手打空格，只改画法；标题是文件里的字，不翻） */}
              <span className="truncate">
                {c.ask ? c.title?.replace(/^(第)\s*(\d+)\s*(页)/, '$1$2$3') : c.title}
                {/* 那一问标了前置知识（小标题末尾 #前置知识）：标签紧跟标题文字 */}
                {c.pre && (
                  <span className="db-pre-tag" data-testid="board-pre-tag">
                    {t('前置知识')}
                  </span>
                )}
              </span>
              {/* 新写法一问一列（列头就是那一问，没有标题行）：不写「1问」 */}
              {(!c.ask || c.head) && <span className="meta num">{c.ask ? t('{n}问', { n: asks }) : t('{n}张', { n: count })}</span>}
              {folded && <Codicon name="chevron-down" size={14} />}
            </h3>
          ))}
        {!folded && cited.length > 0 && (
          <div className="backref">
            <Codicon name="references" size={13} />
            {cited.map((r, k) => (
              <button key={r.path} type="button" onMouseDown={(e) => e.stopPropagation()} onClick={() => app().openFile(r.path)}>
                {(k ? (uiLang() === 'en' ? ', ' : '、') : '') + titleOf(r.path)}
              </button>
            ))}
            <span>{t('引用了这一节')}</span>
          </div>
        )}
        {!folded &&
          c.cards.map((u, i) => {
            // 正在改的那张总画出来（外面在前面加了几段，它被挤到「还有N张」里了也不收起）
            // 问过 AI 的一处（一问一列）整列都摆出来：小结、旁支、划线不收进「还有N张」
            if (u.kind !== 'gap' && !c.ask && !showAll && shown >= per && u !== editUnit) return null
            if (u.kind !== 'gap') shown++
            return (
              // AI 讲解卡用认讲解的那两行做 key：旁支写进去以后卡的字变了也不重画（开着的旁支、打了一半的字不丢）
              <div key={aiHostOf(u) ?? (keys.get(u) ?? '') + u.from} className="db-sub-wrap">
                {u.sub && <div className="db-sub">{u.sub}</div>}
                {drop && drop.col === ci && drop.before === i && <div className="db-drop" />}
                {draftHere === i && draftCard(i)}
                {card(u, i)}
              </div>
            )
          })}
        {!folded && drop?.col === ci && drop.before === -1 && <div className="db-drop" />}
        {!folded && draftHere === -1 && draftCard(-1)}
        {!folded && !lead && c.cards.length === 0 && draftHere === null && <div className="db-empty">{t('把卡片拖进来')}</div>}
        {!folded && !showAll && !c.ask && cards.length > per && (
          <button type="button" className="db-more" onClick={() => setMore(new Set(more).add(ci))}>
            <Codicon name="chevron-down" size={14} />
            {t('还有{n}张，点开', { n: cards.length - per })}
          </button>
        )}
      </section>
    )
  }

  /** 一轮画成的那一列 */
  const fyColumn = (c: DocColumn, style: React.CSSProperties) => {
    const r = roundOfCol(c)!
    return (
      <FeynmanColumn
        key={'fy' + r.meta.id}
        path={props.notePath}
        id={r.meta.id}
        text={text}
        readOnly={props.readOnly}
        fromMap={false}
        active={props.active}
        style={style}
        onSay={(t, undo) => setToast(undo ? { text: t, undo } : { text: t })}
      />
    )
  }
  /** 盖住的卡上面浮一颗「讲完再看 · 按住看一眼」：摆在盖住的那几张的左上 */
  const coverChip = () => {
    // 按住看一眼时也照着算（露出来的那几张），这一颗不卸掉，松手才盖回去
    const c = covered && { ...covered, peeking: false }
    const ks = [...keys].filter(([u]) => Fy.cardCovered(c, unitIdOf(u), u.text)).map(([, k]) => rects[k]).filter((r): r is Rect => !!r)
    if (!ks.length || !covered) return null
    const x = Math.min(...ks.map((r) => r.x))
    const y = Math.min(...ks.map((r) => r.y))
    return <CoverChip id={covered.id} at={{ x, y: y - 40 }} scale={props.scale} wrap={wrap} plane={plane} />
  }

  const moved = board.placed.length
  // 费曼那一列是软件摆的，不算「不在原来的地方」
  const placedCols = board.columns.filter((c) => c.place && !roundOfCol(c)).length
  const placedIds = [...board.placed.map((u) => 'u:' + u.place!.id), ...board.columns.flatMap((c) => (c.place && !roundOfCol(c) ? ['c:' + c.place.id] : []))]
  // 白板撑多大：摆在空白处的卡、列都要滚得到
  const extent = [...board.placed.map((u) => ({ x: u.place!.x + COL_W + 120, y: u.place!.y + 600 })), ...board.columns.filter((c) => c.place).map((c) => ({ x: c.place!.x + COL_W + 120, y: c.place!.y + 800 }))].reduce(
    (m, p) => ({ x: Math.max(m.x, p.x), y: Math.max(m.y, p.y) }),
    { x: 0, y: 0 },
  )
  const exp = expanded ? byKey.get(expanded) : undefined
  const expRect = expanded ? rects[expanded] : undefined
  const ghost =
    drag?.type === 'unit' && drag.moved && drag.group ? (
      // 选中的几张一起拖（task-5ryf9）：几张一起跟着鼠标走，鼠标右下一个「N张」
      <>
        {drag.group.slice(0, 12).map((g) => (
          <div key={g.key} className={`db-card db-drag-card ${g.unit.parts ? 'merged' : faceClass(faceOf(g.unit, ctx))}`} style={{ left: g.r.left + drag.at.x - drag.start.x, top: g.r.top + drag.at.y - drag.start.y, width: g.r.width }}>
            <UnitBody u={g.unit} f={faceOf(g.unit, ctx)} ctx={ctx} acts={{ onToggle: () => undefined, onOpen: () => undefined, onFull: () => undefined }} />
          </div>
        ))}
        <div className="db-drag-count num" data-testid="db-drag-count" style={{ left: drag.at.x + 14, top: drag.at.y + 14 }}>
          {t('{n}张', { n: drag.group.length })}
        </div>
      </>
    ) : drag?.type === 'unit' && drag.moved ? (
      // 问答那一组：跟着鼠标走的是问的那张
      <div className={`db-card db-drag-card ${faceClass(faceOf(drag.unit.group?.[0] ?? drag.unit, ctx))}`} style={{ left: drag.at.x - drag.grab.x, top: drag.at.y - drag.grab.y, width: drag.w }}>
        <UnitBody u={drag.unit.group?.[0] ?? drag.unit} f={faceOf(drag.unit.group?.[0] ?? drag.unit, ctx)} ctx={ctx} acts={{ onToggle: () => undefined, onOpen: () => undefined, onFull: () => undefined }} />
      </div>
    ) : drag?.type === 'col' && drag.moved ? (
      <div className="db-pal-ghost col" style={{ left: drag.at.x - drag.grab.x, top: drag.at.y - drag.grab.y, width: drag.w }}>
        {board.columns[drag.ci]?.title}
      </div>
    ) : drag && (drag.type === 'pal' || drag.type === 'inbox') && drag.moved ? (
      <div className={'db-pal-ghost' + (onCanvas(drag.at.x, drag.at.y) ? '' : ' off')} style={{ left: drag.at.x - 24, top: drag.at.y - 16 }}>
        {drag.type === 'inbox' ? previewOf(drag.text, 60) : drag.kind === 'todo' ? t('待办') : drag.kind === 'column' ? t('新的列') : drag.kind === 'base' ? t('数据库') : drag.kind === 'board' ? t('子白板') : drag.kind === 'map' ? t('拍一张导图') : t('新卡片')}
      </div>
    ) : null

  return (
    <div
      className={'board db-board' + (imageDrop.dropping || noteDrop ? ' dropping' : '')}
      data-testid="doc-board"
      // 卡里的 [字](链接) 相对这篇认（cite.tsx）
      data-cite-base={props.notePath}
      ref={outer}
      tabIndex={0}
      onKeyDown={onKey}
      onContextMenu={(e) => void onContext(e)}
      onDragOver={(e) => noteDragOver(e) || imageDrop.handlers.onDragOver(e)}
      onDragLeave={(e) => (setNoteDrop(false), imageDrop.handlers.onDragLeave(e))}
      onDrop={(e) => {
        if (noteDropped(e)) return
        lastDrop.current = { x: e.clientX, y: e.clientY }
        imageDrop.handlers.onDrop(e)
      }}
      onPaste={imageDrop.handlers.onPaste}
    >
      {/* 在这块白板里找（⇧⌘F）：卡片里的字，跳到那张卡闪一下 */}
      <BoardFind root={() => outer.current} cards=".db-card" on={props.active} owner={props.notePath} />
      <div className="db-area">
        <div
          className={'board-wrap' + (space || panning ? ' grab' : '') + (panning ? ' grabbing' : '')}
          ref={wrap}
          // 回到起点（打开时的样子）滚到哪：四周多出的空白（测试用）
          data-home={`${slack.x},${slack.y}`}
          // 按住空格拖、中键拖：平移（task-5ryf9；按在卡上也是平移，不拖卡）
          onMouseDownCapture={(e) => {
            if (e.button === 1 || (e.button === 0 && spaceRef.current)) startPan(e)
          }}
          onAuxClick={(e) => e.button === 1 && e.preventDefault()}
          onMouseDown={(e) => {
            if (e.button !== 0) return
            if ((e.target as HTMLElement).closest('.db-card, .db-col h3, .dbx, .db-col-name')) return
            setSelWire(null)
            outer.current?.focus({ preventScroll: true })
            // 空白处（列里的空处也算）按住拖：框选，碰到的卡都选上；按住 ⇧ 是在已经选着的上面再加
            startMarquee(e)
          }}
          onDoubleClick={(e) => {
            if (props.readOnly || (e.target as HTMLElement).closest('.db-card, .db-col, .dbx')) return
            const p = planeXY(e.clientX, e.clientY)
            draftAt({ x: Math.max(0, p.x - 24), y: Math.max(0, p.y - 16) })
          }}
        >
          <div className="db-stage" style={{ padding: `${slack.y}px ${slack.x}px ${slack.y}px ${slack.x + ROOM}px` }}>
            <div className="db-plane" ref={plane} style={{ zoom: props.scale, minWidth: extent.x || undefined, minHeight: extent.y || undefined }}>
              {/* 一排的列：前 6 节一行；第 7 节起只留列头，6 个一行排在下面（照小样） */}
              <div className="db-cols">
                {Array.from({ length: Math.ceil(rowCols.length / rowSize) }, (_, r) => (
                  <div key={r} className="db-row">
                    {rowCols.slice(r * rowSize, (r + 1) * rowSize).map((x, k) => (roundOfCol(x.c) ? fyColumn(x.c, { position: 'relative' }) : column(x.c, x.ci, r * rowSize + k)))}
                  </div>
                ))}
              </div>
              {/* 摆在自己位置上的列（旧白板转过来的、列头拖到空白处的） */}
              {board.columns.map((c, ci) => (c.place ? (roundOfCol(c) ? fyColumn(c, { left: c.place.x, top: c.place.y }) : column(c, ci, 0, { position: 'absolute', left: c.place.x, top: c.place.y })) : null))}
              {Fy.pendingOf(props.notePath).map((p) => {
                const c = p.at ?? ('x' in centerWhere() ? (centerWhere() as Pt) : { x: 0, y: 0 })
                return <PendingColumn key={p.key} p={p} style={{ left: c.x, top: c.y }} />
              })}
              {covered && coverChip()}
              {board.placed.map((u) => card(u, -1, { style: { position: 'absolute', left: u.place!.x, top: u.place!.y, width: COL_W } }))}
              {slotWhere && !('col' in slotWhere) && (
                <div style={{ position: 'absolute', left: slotWhere.x, top: slotWhere.y, width: COL_W }}>{draftCard(0)}</div>
              )}
              {edit &&
                editHost &&
                createPortal(
                  edit.kind === 'unit' ? (
                    <InlineCard text={edit.unit.text} notePath={props.notePath} onDone={(v, closing) => doneUnit(edit, v, closing)} onNotice={(t) => setToast({ text: t })} onDraft={props.onDraft} />
                  ) : (
                    <InlineCard text={edit.body} notePath={props.notePath} label={t('新卡片的字')} onDone={(v) => doneNew(edit, v)} onNotice={(t) => setToast({ text: t })} onDraft={props.onDraft} />
                  ),
                  editHost,
                )}
              <Wires links={links} rects={rects} sel={selWire} drag={drag?.type === 'wire' ? { from: rects[drag.from], to: drag.at } : null} onPick={(k) => (setSelWire(k), setSelected(new Set()), outer.current?.focus({ preventScroll: true }))} />
              {exp && expRect && exp.kind === 'base' && (
                <div className="dbx-at" style={{ left: expRect.x - 8, top: expRect.y - 8 }}>
                  <BaseExpand
                    src={exp.text.replace(/^(```|~~~)base[^\n]*\n/, '').replace(/\n(```|~~~)\s*$/, '')}
                    file={props.notePath}
                    block={Math.max(0, autoBlocks(props.text).findIndex((b) => exp.text.includes(b.src)))}
                    write={(next) => {
                      const u = byKey.get(expanded!)
                      if (!u) return
                      const m = /^((?:```|~~~)base[^\n]*\n)([\s\S]*?)(\n(?:```|~~~)\s*)$/.exec(u.text)
                      if (!m) return
                      let src: string
                      try {
                        src = next(m[2]!)
                      } catch (e) {
                        return setToast({ text: String((e as Error).message) })
                      }
                      if (src !== m[2]) write(cur.current.slice(0, u.from) + m[1] + src + m[3] + cur.current.slice(u.to), tNow('改了这张表的写法：文档里这个数据库块跟着变'))
                    }}
                    onClose={() => setExpanded(null)}
                    onCell={(w: BaseCellWrite) =>
                      setToast({
                        text: tNow('「{name}」的{col}改成了「{value}」', { name: w.name, col: w.col.replace(/^note\./, ''), value: w.value }),
                        path: tNow('写进 {path}', { path: w.path }),
                        undo: () => void window.cn.writeNote(w.path, w.before, w.after).then((r) => setToast({ text: r.ok ? tNow('撤回了：那一条改回去了') : tNow('那一条刚被别处改过，撤不回了') })),
                      })
                    }
                  />
                </div>
              )}
            </div>
          </div>
        </div>
        {!props.readOnly && (
          <div className="bpal" onMouseDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
            {PAL.map((it) => (
              <button
                key={it.kind}
                type="button"
                data-tip={t(it.tip)}
                data-side="right"
                data-kind={it.kind}
                onMouseDown={(e) => e.button === 0 && setDrag({ type: 'pal', kind: it.kind, start: { x: e.clientX, y: e.clientY }, at: { x: e.clientX, y: e.clientY }, moved: false })}
                onClick={(e) => {
                  if (palDragged.current) return
                  const r = e.currentTarget.getBoundingClientRect()
                  void createAt(it.kind, it.kind === 'column' ? { x: 0, y: 0 } : centerWhere(), { x: r.right + 8, y: r.top - 10 })
                }}
              >
                <Codicon name={it.icon} size={16} />
                <span>{t(it.label, { ctx: '工具板' })}</span>
              </button>
            ))}
            <hr />
            <button
              type="button"
              data-tip={t('拍一张导图：点一下放进正中那一列，或按住拖到白板上（做好后是这块白板的子白板）')}
              data-key={keyFor('capture') ?? undefined}
              data-side="right"
              data-kind="map"
              onMouseDown={(e) => e.button === 0 && setDrag({ type: 'pal', kind: 'map', start: { x: e.clientX, y: e.clientY }, at: { x: e.clientX, y: e.clientY }, moved: false })}
              onClick={() => !palDragged.current && void createAt('map', centerWhere())}
            >
              <Codicon name="device-camera" size={16} />
              <span>{t('拍导图', { ctx: '工具板' })}</span>
            </button>
            <button
              type="button"
              data-tip={t('费曼学习：先选几张卡再点，就讲这几张；什么都没选，写一个词或从白板上挑')}
              data-side="right"
              data-kind="feynman"
              data-testid="pal-feynman"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                feynmanPal({ x: r.right + 10, y: r.top - 10 })
              }}
            >
              <Codicon name="mortar-board" size={16} />
              <span>{t('费曼学习', { ctx: '工具板' })}</span>
            </button>
          </div>
        )}
        {fyPop && <StartPop at={fyPop} items={feynmanItems()} onWord={feynmanWord} onClose={() => setFyPop(null)} />}
        {/* 顶上那条提示：说明只说一次、真有卡挪离才说挪了几张，都能收起（top-hint.tsx，task-wn3x5） */}
        <div className="db-top">
          <TopHint
            path={props.notePath}
            placedIds={placedIds}
            moved={moved}
            placedCols={placedCols}
            total={board.total}
            per={per}
            openCols={paired ? 0 : OPEN_COLS}
            readOnly={props.readOnly}
            active={props.active}
            away={!!expanded}
            area={outer}
            onReset={() => write(resetLayout(cur.current), tNow('摆回原样：去掉了{n}行位置，正文一个字没动', { n: moved + placedCols }))}
          />
          {props.corner}
        </div>
        {toast && (
          <div className="db-toast" role="status">
            <Codicon name="pass" size={15} />
            <span title={toast.text}>{toast.text}</span>
            {toast.path && <span className="path">{toast.path}</span>}
            {toast.undo && (
              <button type="button" className="db-pill" onClick={() => (setToast(null), toast.undo!(), outer.current?.focus({ preventScroll: true }))}>
                <Codicon name="discard" size={13} />
                {t('撤回')}
              </button>
            )}
          </div>
        )}
        {/* 空白处按住拖出来的框（task-5ryf9）：1px 强调色边、淡强调色底 */}
        {marq && <div className="db-marquee" data-testid="db-marquee" style={{ left: marq.left, top: marq.top, width: marq.right - marq.left, height: marq.bottom - marq.top }} />}
        {bar.node}
        {/* AI 在这块白板上动手（DESIGN.v3 2.3）：盖白板这一格 */}
        <AiActLayer area="board" path={props.notePath} host={outer} />
      </div>
      {inboxOpen && props.active && (
        <InboxPop
          items={inbox}
          readOnly={props.readOnly}
          onItemDown={(e, n) => setDrag({ type: 'inbox', path: n.path, text: n.excerpt || n.preview || titleOf(n.path), start: { x: e.clientX, y: e.clientY }, at: { x: e.clientX, y: e.clientY }, moved: false })}
        />
      )}
      {ghost && createPortal(ghost, document.body)}
      {docSpot && createPortal(<div className="db-doc-drop" style={{ left: docSpot.line.left, top: docSpot.line.top, width: docSpot.line.width }} />, document.body)}
      {baseMenu && <BaseMenu at={baseMenu.at} onPick={(b) => void placeBase(b, baseMenu.where)} onClose={() => setBaseMenu(null)} />}
      {full && (
        <FullCard
          unit={full.unit}
          ctx={{ ...ctx, full: true }}
          section={sectionOf(board, full.unit)}
          readOnly={props.readOnly}
          startEditing={!!full.edit}
          bodyRef={fullBody}
          onToggle={(line) => toggle(full.unit, line)}
          onOpen={openTarget}
          onOpenDoc={props.onOpenDoc}
          onClose={() => setFull(null)}
          onSave={(body) => (saveCard(full, body), setFull(null))}
          onNotice={(t) => setToast({ text: t })}
        />
      )}
    </div>
  )
}

/** 卡和卡之间的线（frontmatter 的 links，两头是卡的编号）：从中心连中心，切掉卡片里面那段；点线选中 */
function Wires(props: { links: { from: string; to: string }[]; rects: Record<string, Rect>; sel: string | null; drag: { from?: Rect; to: Pt } | null; onPick(key: string): void }) {
  const { links, rects } = props
  if (!links.length && !props.drag) return null
  return (
    <svg className="db-wires" aria-hidden>
      <defs>
        <marker id="db-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M0,1 L9,5 L0,9" fill="none" stroke="var(--wire)" strokeWidth="1.4" />
        </marker>
        <marker id="db-arrow-sel" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M0,1 L9,5 L0,9" fill="none" stroke="var(--acc)" strokeWidth="1.4" />
        </marker>
      </defs>
      {links.map((l) => {
        const seg = wire(rects[l.from], rects[l.to])
        if (!seg) return null
        const key = `${l.from}>${l.to}`
        const on = props.sel === key
        return (
          <g key={key} className={'wire' + (on ? ' on' : '')} data-wire={key}>
            <line x1={seg[0].x} y1={seg[0].y} x2={seg[1].x} y2={seg[1].y} className="hit" onMouseDown={(e) => (e.stopPropagation(), props.onPick(key))} />
            <line x1={seg[0].x} y1={seg[0].y} x2={seg[1].x} y2={seg[1].y} className="vis" markerEnd={on ? 'url(#db-arrow-sel)' : 'url(#db-arrow)'} />
          </g>
        )
      })}
      {props.drag?.from && <line x1={props.drag.from.x + props.drag.from.w} y1={props.drag.from.y + props.drag.from.h / 2} x2={props.drag.to.x} y2={props.drag.to.y} className="vis pending" />}
    </svg>
  )
}

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

/** 这张卡在文档里哪一节 */
function sectionOf(b: DocBoard, u: DocUnit): string {
  const placed = b.placed.find((x) => x.from === u.from)
  if (placed) return placed.section ?? tNow('开头')
  for (const c of b.columns) if (c.cards.some((x) => x.from === u.from)) return c.title ?? tNow('开头')
  return tNow('开头')
}

/** 插入菜单（/）开着：Esc 先关它，不关弹层 */
const slashOpen = () => !!document.querySelector('.ed-pop:not([hidden])')

/**
 * 双击看全文：白板正中偏上，头上「种类 · 在文档「这一节」里」「在文档里看」；点「改字」在排好的样子上直接改（unit-editor.tsx，不露写法，能打 /）。
 * Esc、点外面、关掉都一样：改过的字存下（想放弃按 ⌘Z），没改就直接关
 */
function FullCard(props: {
  unit: DocUnit
  ctx: CardCtx
  section: string
  readOnly: boolean
  startEditing: boolean
  bodyRef: React.MutableRefObject<string | null>
  onToggle(line: number): void
  onOpen(o: OpenTarget): void
  onOpenDoc(pos: number): void
  onClose(): void
  onSave(body: string): void
  onNotice(text: string): void
}) {
  const t = useT()
  const [body, setBody] = useState(props.unit.text)
  const [editing, setEditing] = useState(props.startEditing && !props.readOnly)
  const bodyNow = useRef(body)
  bodyNow.current = body
  props.bodyRef.current = body
  const close = () => (bodyNow.current !== props.unit.text ? props.onSave(bodyNow.current) : props.onClose())
  const closeRef = useRef(close)
  closeRef.current = close
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !e.isComposing && !slashOpen() && (e.preventDefault(), e.stopPropagation(), closeRef.current())
    window.addEventListener('keydown', esc, true)
    return () => window.removeEventListener('keydown', esc, true)
  }, [])
  const f = faceOf(props.unit, props.ctx)
  // 节名夹在一句话中间：整句一个模板，按 {sec} 切成前后两段（中间的节名单独截断）
  const where = t('· 在文档「{sec}」里').split('{sec}')
  return (
    <div className="db-full-back" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="db-full" role="dialog" aria-label={t('全文')}>
        <div className="db-full-hd">
          <Codicon name="preview" size={14} />
          <b>{faceName(f)}</b>
          {/* 只截中间的节名，「· 在文档「」和「」里」一直露着（设计复审） */}
          <span className="where">
            <span>{where[0]}</span>
            <span className="sec">{props.section}</span>
            <span>{where[1]}</span>
          </span>
          <span className="sp" />
          {!props.readOnly && !editing && (
            <button type="button" className="db-pill" onClick={() => setEditing(true)}>
              <Codicon name="edit" size={13} />
              {t('改字')}
            </button>
          )}
          <button type="button" className="db-pill" onClick={() => (close(), props.onOpenDoc(props.unit.from))}>
            <Codicon name="file-text" size={13} />
            {t('在文档里看')}
          </button>
          <button type="button" className="db-ib" aria-label={t('关掉')} onClick={close}>
            <Codicon name="close" size={15} />
          </button>
        </div>
        {editing ? (
          <>
            <UnitEditor text={body} notePath={props.ctx.notePath} onChange={setBody} onNotice={props.onNotice} placeholder={t(EMPTY_HINT)} />
            <div className="db-full-ft edit">
              <button type="button" className="btn" onClick={() => props.onSave(body)}>
                {t('存好')}
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
