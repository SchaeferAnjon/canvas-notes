/**
 * 文档里的数据库（CN-19 A，2026-11-18 照 Notion 做全）：```base 代码块画成一张卡（样子照文档方向 A 的小样）。
 * 块头两行（第三批 task-i921u）：名字一行（database 图标 + 名字 +「N 条 · 筛掉 M 条」…… 整页打开、改写法、新一条），
 * 视图标签一行（ViewBar.tsx：切视图、加、改名、复制、删、拖排序 …… 分组、筛选、排序，改了就存进当前视图、底部能撤回）。
 * 当前看哪个视图、组收起记在本机（view-state.ts）。行由 packages/format 的 queryView 算（视图自己的筛选、排序、分组）。
 * 每一行是文件夹里的一篇 md，每一列是它 frontmatter 里的一个属性：
 * - 表头最右「+」加一列：起名字、选类型（文字、数字、选项、多选、日期、勾选、链接）；
 * - 点列头出菜单：改名（每一条的属性一起改）、类型、升序 / 降序、按这一列筛选、计算、左边插入 / 右边插入、隐藏、删除（每一条里的这一项一起删）；
 * - 拖列头右边的缝改列宽、按住列头左右拖换顺序；列宽、顺序、类型、计算都写回代码块（同 Obsidian Bases 的 columnSize、summaries）；
 * - 格子里直接改：文字、数字、链接是输入框，选项、多选是一排小色块（能新建），日期是日期框，勾选是勾选框；写回那一篇的 frontmatter；
 * - 表底「+ 新建」一行：建一篇、名字格直接起名；再下面一行是计算（点了选求和、平均……）；
 * - 「改写法」：只在这一块露出 YAML（方向 A「块上露写法」），「完成」写回，esc 收回。
 * 量大时文档里只铺前 50 条（`别把上万条全铺开`），整页打开看全部。写法同 Obsidian Bases，见 packages/format/src/base.ts。
 */
import { Codicon } from '@cn/design'
import { trackDrag } from '@cn/design/drag-end'
import {
  ADD_COLUMN,
  aiColOf,
  aiRenameFilled,
  type BaseCond,
  type BaseCtx,
  type BaseRec,
  type BaseRow,
  type BaseSpec,
  COL_TYPES,
  cellOf,
  colType,
  type ColType,
  colTypeOf,
  dropBaseProp,
  type FieldType,
  HIDDEN_KEYS,
  listOf,
  listText,
  parseBase,
  parseBaseDoc,
  queryView,
  renameBaseProp,
  renameProp,
  setBaseColSize,
  setBaseColType,
  setBaseOrder,
  setBaseSummary,
  setFormula,
  setProp,
  setViewSort,
  setPropDef,
  statusGroups,
  shareOf,
  sumKind,
  type SumKind,
  summaryOf,
} from '@cn/format'
import { Fragment, type ReactNode, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { nameNotice, safeName } from '../../shared/file-name'
import { nameFromTitle } from '../title-follow'
import { titleOf } from '../../shared/layout'
import { app } from '../ctx/actions'
import { RAW_HINT } from '../block-source'
import { composing } from '../ime'
import { badNum, clearBad, dropBad, NUM_INPUT, numText } from './cell-input'
import { anchorOf, FloatPop, type PopAnchor } from '../pop-place'
import { showMenu } from '../ctx/menu'
import { fadeEdges } from '../tex'
import { t as tNow } from '../../shared/i18n'
import { useLang } from '../i18n'
import { useViewBar, type ViewPop } from './ViewBar'
import { foldedGroups, toggleGroup, useViewState, viewNameOf } from './view-state'
import { BaseLayout, isLayoutView } from './BaseLayout'
import { useBaseData } from './layout-ctx'
import { fmt, groupWords } from './words'
import { openRecord, syncRecord, useRecord } from './record-open'
import { type AddChoice, AddCol, ColExtra, dayText, dbNameOf, FIELD_ICON, FormulaBox, OWN_CELLS, OwnCell, RelationIssues, RelationPick, rollupDefault, StatusPick } from './cols'
import { aiTable, openAiCol } from './ai-col'
import { openAuto, autoOpenNow, useAuto } from './auto-state'
import { buttonOf, rulesOf, whereOf } from './auto-ipc'
import { ButtonAddItem, ButtonCell, ButtonColMenu, editButton, newButton } from './button-col'
import { AiAddItem, AiCell, AiColMenu, AiDrop, AiHead } from './ai-cells'
import { calcLabel, calcShort, ShareBar, SumMenu, sumText } from './sums'
import { editKey, type GridAct, gridKey, gridText, parseGridText, tabFrom } from '../grid-focus'
import { DatePop, dayOf } from './date-cell'

/** 列菜单「类型」那一格：加一列菜单的「基本」一组（七种存着的类型和状态） */
const TYPE_CHOICES = ADD_COLUMN[0]!.items as { type: ColType | 'status'; label: string }[]
const INLINE_ROWS = 50

const colName = (c: string) => (c === 'file.name' ? tNow('名字') : c.replace(/^(note|formula)\./, ''))

/** 单选、多选值的颜色：同一个值总是同一个颜色，颜色收着（方块配色别太艳） */
const TONES = ['green', 'yellow', 'plain', 'blue', 'red'] as const
export function toneOf(v: string): (typeof TONES)[number] {
  let h = 0
  for (const ch of v) h = (h * 31 + ch.codePointAt(0)!) >>> 0
  return TONES[h % TONES.length]!
}

interface Loaded {
  rows: BaseRow[]
  /** 筛掉了几条 */
  hidden: number
  texts: Map<string, string>
  /** 文件夹里所有笔记的属性（隐藏的列、筛选面板的列和值从这里来） */
  all: BaseRow[]
  /** 第三批的算法（packages/format base-rows）：关联、汇总、公式、状态的格子从这里算；关联连到的文件夹一起读进来 */
  ctx: BaseCtx | null
}

const rowOf = (r: BaseRec): BaseRow => ({ path: r.path, name: r.name, props: r.props })

/**
 * 软件自己改了数据库里的几条（这一张表里改格子、改列名）：同一个数据库别处画着的表（白板上展开的、文档里的、嵌在别处的）跟着重读。
 * 自己写的文件不会再来「外面改了」的通知，所以另发一个
 */
export const BASE_WROTE = 'cn-base-wrote'
export const baseWrote = (folder: string | null) => folder && window.dispatchEvent(new CustomEvent(BASE_WROTE, { detail: folder }))

/**
 * 从文档进表（task-cle3x 格子焦点）：整块选中时按回车、↓（从上面来的）、↑（从下面来的），文档那边在这一块的部件上发这个事件，
 * 表格选中第一行 / 最后一行的第一格、拿到焦点，把 ok 改成 true；表格不在（看板、日历、没有一条）不改，文档照旧挪光标
 */
export const GRID_ENTER = 'cn-grid-enter'
export interface GridEnter {
  at: 'first' | 'last'
  ok: boolean
}

/** 选中的那一格：哪张表（文档里的、整页打开的）、显示出来的第几行、哪一列；path 记着是哪一条（重排、筛掉以后按它找回来） */
interface Sel {
  full: boolean
  idx: number
  path: string
  col: string
}

export interface BaseEdits {
  sort(prop: string, desc: boolean): void
  filters(match: 'and' | 'or', conds: BaseCond[]): void
  order(columns: string[]): void
  /** 代码块里的 YAML 换成 next 算出来的（列的类型、列宽、计算、改名、删列、改写法） */
  src(next: (src: string) => string): void
}

/**
 * 浮层贴着哪个按钮（窗口坐标）。浮层挂在 body 上、用 pop-place 放（task-c22p9）：画在表里时被中栏、右栏、白板的缩放截掉
 */
type At = PopAnchor
const atOf = anchorOf

/** 找不到按钮时（不该有）：放在窗口右上 */
const NOWHERE: At = { left: 0, top: 120, bottom: 120, right: 0 }

/** 块头第一行放不下时从前往后收进「⋯」的几样：自动化、改写法、整页打开、「N 条」（筛选、排序、分组在第二行，窄了只留图标） */
const FOLD_ORDER = ['auto', 'raw', 'full', 'count'] as const
/** 块窄于这么宽时视图标签收成一个下拉、分组筛选排序只留图标（原型 .db.narrow） */
const NARROW = 560
type FoldKey = (typeof FOLD_ORDER)[number]
/** 量要多宽时名字最多算这么宽（再长的名字省略号，不为它收按钮） */
const TITLE_ROOM = 96
/** 「⋯」一颗 26 宽 */
const MORE_W = 26

/**
 * 块头一行放不下时收哪几样：每样画出来时记下它的宽，按块头的宽从 FOLD_ORDER 前面收起，直到放得下。
 * 块变宽、变窄（拖中栏、白板卡展开）都重算；收起来的那几样不在 DOM 里，用记下的宽
 */
function useFold(on: FoldKey[]) {
  const [bar, ref] = useState<HTMLDivElement | null>(null)
  const widths = useRef(new Map<FoldKey, number>())
  const [folded, setFolded] = useState<FoldKey[]>([])
  const measure = useRef(() => {})
  measure.current = () => {
    if (!bar || !bar.clientWidth) return
    const cs = getComputedStyle(bar)
    const gap = parseFloat(cs.columnGap) || 0
    const room = bar.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
    let fixed = 0
    let n = 0
    // 用 getBoundingClientRect 量（头上的 database 图标是 svg，没有 offsetWidth），再除掉白板的缩放，和 clientWidth 同一个单位：
    // 不然白板放大时收得太早、缩小时收得太晚；这样缩放变了也不用重算
    const zoom = bar.getBoundingClientRect().width / bar.offsetWidth || 1
    for (const el of bar.children as HTMLCollectionOf<HTMLElement>) {
      const k = el.dataset.fold as FoldKey | undefined
      const wide = el.getBoundingClientRect().width / zoom
      if (k) {
        widths.current.set(k, wide)
        continue
      }
      if (el.classList.contains('sp') || el.dataset.more !== undefined) continue
      const w = el.tagName === 'B' ? Math.min(el.scrollWidth, TITLE_ROOM) : wide
      if (!w) continue
      fixed += w
      n++
    }
    // 白板上展开的表里「改写法」藏着（宽 0）：不算、也不进「⋯」
    const items = FOLD_ORDER.filter((k) => on.includes(k) && (widths.current.get(k) ?? 0) > 0)
    let need = fixed + gap * Math.max(0, n - 1) + items.reduce((sum, k) => sum + widths.current.get(k)! + gap, 0)
    let f = 0
    while (f < items.length && need + (f ? MORE_W + gap : 0) > room) {
      need -= widths.current.get(items[f]!)! + gap
      f++
    }
    const next = items.slice(0, f)
    setFolded((cur) => (cur.join(',') === next.join(',') ? cur : next))
  }
  useLayoutEffect(() => measure.current())
  useLayoutEffect(() => {
    if (!bar) return
    let w = bar.clientWidth
    const ro = new ResizeObserver(() => {
      if (bar.clientWidth === w) return
      w = bar.clientWidth
      measure.current()
    })
    ro.observe(bar)
    return () => ro.disconnect()
  }, [bar])
  return { ref, folded }
}

type Pop =
  | ViewPop
  | { kind: 'col'; col: string; at: At }
  | { kind: 'hidden'; at: At }
  | { kind: 'add'; at: At; index: number }
  | { kind: 'sum'; col: string; at: At }
  | { kind: 'options'; path: string; col: string; at: At }
  | { kind: 'date'; path: string; col: string; at: At }
  | { kind: 'drop'; col: string; at: At }
  | { kind: 'rel'; path: string; col: string; at: At }
  | { kind: 'status'; path: string; col: string; at: At }
  | { kind: 'fx'; at: At; name: string; src: string; isNew: boolean; index: number }

/** 改好一格（白板上展开的数据库卡要说一句「写进 …」、能撤回） */
export interface BaseCellWrite {
  path: string
  name: string
  col: string
  value: string
  before: string
  after: string
}

/**
 * extra：块头最右边多放的（白板上展开的数据库卡放「收起」）；foot：表底那一句换成这句；onCell：改好一格以后；
 * file：这一块在哪篇里（底部提示「只改 ecp 课程计划.md 里 base 块的那几行」）。spec 是以前传进来的第一个视图，现在按当前视图自己算
 */
export function BaseTable(props: {
  spec?: BaseSpec
  src: string
  edit: BaseEdits
  anchor: HTMLElement
  extra?: React.ReactNode
  foot?: string
  file?: string
  block?: number
  onCell?(w: BaseCellWrite): void
  /** 画在文档里的（base-block.tsx）：格子焦点出表回正文（第一行 ↑、最后一行 ↓、Esc 退回选中整块） */
  nav?: { leave(dir: 'up' | 'down' | 'block'): void }
}) {
  const { edit } = props
  useViewState()
  useLang()
  const doc = useMemo(() => parseBaseDoc(props.src), [props.src])
  /** 当前看的视图：本机记着的名字，找不到（改了名、删了、没记过）看第一个 */
  const vi = Math.max(0, doc.views.findIndex((v) => v.name === viewNameOf(doc.folder)))
  const view = doc.views[vi]!
  const spec = useMemo(() => parseBase(props.src, vi), [props.src, vi])
  /** 这一块的数据（数据源和关联连到的文件夹，第三批四块共用一份；看板 / 日历 / 画廊也用这一份） */
  const { ctx, reload } = useBaseData(props.src)
  const [full, setFull] = useState(false)
  /** 正在改的那一格；typed：选中时直接打字进来的（框里先空着，打的字换掉原来的） */
  const [editing, setEditing] = useState<{ path: string; col: string; typed?: boolean } | null>(null)
  const editingRef = useRef(editing)
  editingRef.current = editing
  /** 选中的那一格（task-cle3x 格子焦点，蓝框）；按键怎么翻在 ../grid-focus.ts，和文档里的普通表格共用 */
  const [sel, setSel] = useState<Sel | null>(null)
  const selRef = useRef(sel)
  selRef.current = sel
  /** 下一次画完把焦点放到选中的那一格（键盘走格、编辑完回来、浮层收起时要；别处重画不抢焦点） */
  const wantFocus = useRef(false)
  /** 走格时自己滚到看得见的时间：紧跟着打字开的浮层不因为这一下滚动收起 */
  const selfScroll = useRef(0)
  /** 两张表各自显示出来的行（画的时候记下，键盘走格照它数） */
  const shownRef = useRef<{ inline: BaseRow[]; full: BaseRow[] }>({ inline: [], full: [] })
  const [pop, setPop] = useState<Pop | null>(null)
  /** 改写法开着：这一块露出 YAML */
  const [raw, setRaw] = useState(false)
  /** 正在拖的列宽（松手写回 columnSize） */
  const [sizing, setSizing] = useState<{ col: string; w: number } | null>(null)
  /** 正在拖着换顺序的那一列、落在第几列前面 */
  const [moving, setMoving] = useState<{ col: string; to: number } | null>(null)
  /** 右栏开着的那一条（这一行灰底）；这张表开的、块改了写法时右栏跟上（数据库第三批第 4 块） */
  const me = useId()
  const peek = useRecord()
  // 右栏开着的是这张表开的那一条：块改了写法、换了视图，右栏跟上（↑ ↓ 照当前视图的顺序）
  useEffect(() => syncRecord(me, props.src, vi), [props.src, vi])

  /** 算行：这个视图的筛选、排序、分组（只看不写） */
  const res = useMemo(() => (ctx ? queryView(ctx, vi) : null), [ctx, vi])
  /**
   * 刚写下去、还没重读回来的那几条（task-cle3x）：改完一格马上又进这一格、改同一条的别的格子时，照写下去的算
   * （以前框里还是旧的字，接着改会拿旧的那份去写）。重读回来和写的一样就不要了，最多再撑两次重读
   */
  const [fresh, setFresh] = useState(new Map<string, { text: string; props: Record<string, string>; age: number }>())
  useEffect(() => {
    if (!ctx || !fresh.size) return
    setFresh((m) => new Map([...m].filter(([p, f]) => ctx.recs.find((r) => r.path === p)?.text !== f.text && f.age < 2).map(([p, f]) => [p, { ...f, age: f.age + 1 }])))
  }, [ctx])
  const data = useMemo<Loaded | null>(() => {
    if (!ctx || !res) return null
    const all = ctx.recs.map((r) => {
      const f = fresh.get(r.path)
      return f && f.text !== r.text ? { ...rowOf(r), props: f.props } : rowOf(r)
    })
    const byPath = new Map(all.map((r) => [r.path, r]))
    const texts = new Map(ctx.recs.map((r) => [r.path, fresh.get(r.path)?.text ?? r.text]))
    return { rows: res.rows.map((r) => byPath.get(r.path) ?? rowOf(r)), hidden: res.hidden, texts, all, ctx }
  }, [ctx, res, fresh])

  /**
   * 改了就存（用户选的方向 A）：筛选、排序、分组、视图一改就写进这一块，每次一次写，底部提示说存进了哪、带「撤回」。
   * 撤回：这一块还是改完的样子才换回去（后来又改过就说一句，不盖掉后来的）
   */
  const editRef = useRef(edit)
  editRef.current = edit
  const saveSrc = (next: (src: string) => string, msg: string, sub?: string) => {
    const before = props.src
    let after: string
    try {
      after = next(before)
    } catch (e) {
      return app().notice(String((e as Error).message ?? e))
    }
    if (after === before) return
    edit.src(() => after)
    const where = sub ?? (props.file ? tNow('只改 {file} 里 base 块的那几行', { file: props.file.split('/').pop()! }) : tNow('只改 base 块的那几行'))
    app().noticeUndo(`${msg} · ${where}`, () => {
      let undone = false
      editRef.current.src((cur) => (cur === after ? ((undone = true), before) : cur))
      if (!undone) app().notice(tNow('这一块后来又改过，撤不回了'))
    })
  }
  useEffect(() => {
    if (!full && !pop) return
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || composing(e)) return
      // 整页里正改着一格、选中着一格：Esc 先归格子（退回选中、不选中），再按一下才收回文档里
      if (!pop && (editingRef.current || selRef.current?.full)) return
      e.preventDefault()
      e.stopPropagation()
      if (pop) closePop()
      else setFull(false)
    }
    window.addEventListener('keydown', esc, true)
    return () => window.removeEventListener('keydown', esc, true)
  }, [full, pop])

  /** 文件夹里出现过的属性（软件自己用的键不算） */
  const allProps = useMemo(() => {
    const s = new Set<string>()
    for (const r of data?.all ?? []) for (const k of Object.keys(r.props)) if (!HIDDEN_KEYS.has(k)) s.add(k)
    return [...s]
  }, [data])
  /** 列的类型：用户选过的优先，没选过按值猜 */
  const typeOf = (c: string): ColType => (c === 'file.name' ? 'text' : (spec.types[c] ?? colType((data?.all ?? []).map((r) => r.props[c] ?? ''))))
  const types = useMemo(() => Object.fromEntries([...new Set([...spec.columns, ...allProps])].map((c) => [c, typeOf(c)])) as Record<string, ColType>, [data, props.src, vi])
  const valuesOf = (c: string) => {
    const t = types[c]
    const vs = (data?.all ?? []).flatMap((r) => (c === 'file.name' ? [r.name] : t === 'multi' ? listOf(r.props[c] ?? '') : [r.props[c] ?? '']))
    return [...new Set(vs.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh'))
  }
  /** 隐藏的列：笔记里有、这个视图没摆出来的；设过的关联、汇总、公式列也算（它们不一定写在笔记里） */
  const hiddenCols = [...new Set([...allProps, ...Object.keys(ctx?.doc.props ?? {}), ...Object.keys(ctx?.doc.formulas ?? {}).map((f) => 'formula.' + f)])].filter((p) => !spec.columns.includes(p))
  const recOf = useMemo(() => new Map((ctx?.recs ?? []).map((r) => [r.path, r])), [ctx])
  /** AI 列（ai-cells.tsx 画格子、列头、列菜单那一段）；右栏「AI 列」照这张表登记的块、先后、ctx 画，改块走这张表的 edit.src */
  const aiOf = (c: string) => (ctx && c !== 'file.name' ? aiColOf(ctx, c) : null)
  const viewOrder = (data?.rows ?? []).map((r) => r.path)
  useEffect(() => aiTable({ id: me, src: props.src, folder: spec.folder, order: viewOrder, columns: spec.columns, view: vi, ctx, edit: edit.src, where: whereOf(props.file, props.block ?? 0) }), [props.src, ctx, vi, viewOrder.join('\n'), spec.columns.join('\n'), props.file, props.block])
  /** 关联、汇总、公式、状态列（格子归 cols.tsx 画）；别的列照第二批 */
  const ownOf = (c: string): FieldType | null => {
    if (c === 'file.name' || !ctx) return null
    const f = colTypeOf(ctx, c)
    return OWN_CELLS.has(f) ? f : null
  }
  /** 按钮列（自动化那一套动作，button-col.tsx 画格子、列菜单那一段） */
  const btnOf = (c: string) => c !== 'file.name' && !!buttonOf(ctx, c)
  const iconOf = (c: string) => (btnOf(c) ? 'play-circle' : FIELD_ICON[ownOf(c) ?? types[c] ?? 'text'])

  const name = spec.folder ? spec.folder.split('/').pop()! : tNow('数据库')

  /**
   * 同一篇的写回排队（0.5.4 已知问题）：多选格子连着加两个值，第二次在第一次写回盘之前就要写。以前第二次拿的「改之前」
   * 是这次渲染时的 data（第一次写之前的字），原子写带 fsync 后第一次落盘慢，第二次到主进程时盘上已是第一次写好的，
   * 两份对不上就被当成「别处改过」。现在同一篇一次只写一次，后一次照前一次写好的字算「改之前」；真被别处改过照旧提示。
   * wrote 是排着队这段时间里自己写下去的字，队排空就不要了（之后照重读回来的 data 算，别处后来改的不会被当成没改）
   */
  const dataRef = useRef(data)
  dataRef.current = data
  const writeQueue = useRef(new Map<string, Promise<void>>())
  const wrote = useRef(new Map<string, { text: string; props: Record<string, string> }>())
  const queued = (path: string, job: () => Promise<void>) => {
    const prev = writeQueue.current.get(path) ?? Promise.resolve()
    const mine = prev.then(job)
    writeQueue.current.set(path, mine)
    void mine.finally(() => {
      if (writeQueue.current.get(path) !== mine) return
      writeQueue.current.delete(path)
      wrote.current.delete(path)
    })
    return mine
  }

  /** 改一格：写进那一篇的 frontmatter（多选写成一行 [a, b]） */
  const save = async (r: BaseRow, col: string, value: string) => {
    setEditing(null)
    // 没排着队时 r 就是最新的：值没变不写（打开再保存文件不变）
    if (!writeQueue.current.has(r.path) && (r.props[col] ?? '') === value) return
    return queued(r.path, async () => {
      const mine = wrote.current.get(r.path)
      const old = mine?.text ?? dataRef.current?.texts.get(r.path)
      if (old === undefined) return
      const next = setProp(old, col, value === '' ? undefined : value, { raw: types[col] === 'multi' })
      if (next === old) return
      const w = await window.cn.writeNote(r.path, next, old)
      if (!w.ok) app().notice(tNow('《{name}》刚被别处改过，没改成，再试一次', { name: r.name }))
      else {
        const p = { ...(mine?.props ?? r.props), [col]: value }
        if (value === '') delete p[col]
        wrote.current.set(r.path, { text: next, props: p })
        setFresh((m) => new Map(m).set(r.path, { text: next, props: p, age: 0 }))
        props.onCell?.({ path: r.path, name: r.name, col, value, before: old, after: next })
        baseWrote(spec.folder)
      }
      reload()
    })
  }

  /** 每一条都改（改列名、删列）：一条条写回，有被别处改过的跳过并说一句 */
  const eachRow = async (change: (text: string) => string) => {
    let missed = 0
    for (const r of data?.all ?? []) {
      const old = data!.texts.get(r.path)
      if (old === undefined) continue
      const next = change(old)
      if (next === old) continue
      const w = await window.cn.writeNote(r.path, next, old)
      if (!w.ok) missed++
    }
    if (missed) app().notice(tNow('有 {n} 条刚被别处改过，没改成，再试一次', { n: missed }))
    baseWrote(spec.folder)
    reload()
  }

  /** 这次点「新一条」建的：开着筛选、它又不满足时也先留在表底（标「新 · 不在当前筛选里」），离开这篇或改到满足筛选为止 */
  const [added, setAdded] = useState<string[]>([])
  /**
   * 点「新一条」那一刻量下的列宽（文档里的表、整页打开的表各一份）：新的那条还在起名、或还留在表底时按它定住列宽，
   * 起名框、打的字、「新 · 不在当前筛选里」都不把列挤动（第 3 轮美学）
   */
  const [lock, setLock] = useState<{ cols: string; inline?: number[]; full?: number[] } | null>(null)
  /** 放表格的那一格有多宽（文档里、整页各一个）：比各列加起来宽时各列按比例撑满，「+」那一列固定 32 */
  const [room, setRoom] = useState<{ inline: number; full: number }>({ inline: 0, full: 0 })
  const roomRef = (key: 'inline' | 'full') => {
    let ro: ResizeObserver | null = null
    let unfade: (() => void) | null = null
    return (el: HTMLDivElement | null) => {
      ro?.disconnect()
      ro = null
      unfade?.()
      unfade = null
      if (!el) return
      // 表格横着滚时哪一边还有列哪一边渐隐（和公式同一套，task-c22p9）
      unfade = fadeEdges(el)
      const read = () => setRoom((r) => (r[key] === el.clientWidth ? r : { ...r, [key]: el.clientWidth }))
      ro = new ResizeObserver(read)
      ro.observe(el)
      read()
    }
  }
  const inlineRoom = useMemo(() => roomRef('inline'), [])
  const fullRoom = useMemo(() => roomRef('full'), [])
  const widthsOf = (root: HTMLElement | null) => {
    // 照 <col> 上写着的宽量（task-cle3x 起格子间有竖线：表头格子的框连着半条线，量它定宽每列会挪半像素）；「+」那一列是表宽减去别的
    const table = root?.querySelector<HTMLTableElement>(':scope .base-scroll > table')
    const cols = table ? [...table.querySelectorAll<HTMLElement>(':scope > colgroup > col')] : []
    if (!table || !cols.length) return undefined
    const ws = cols.slice(0, -1).map((c) => parseFloat(c.style.width) || 0)
    return [...ws, table.getBoundingClientRect().width - ws.reduce((a, w) => a + w, 0)]
  }
  /** 正在建（主进程还没回话）：这时再点不再建一条 */
  const creating = useRef(false)
  const add = async () => {
    if (!spec.folder || creating.current) return
    setLock({ cols: spec.columns.join('\n'), inline: widthsOf(rootRef.current), full: widthsOf(fullRef.current) })
    creating.current = true
    let p: string
    try {
      p = await window.cn.createNote(spec.folder, '未命名', '') // 不翻：新建时的默认名字（文件名）
    } finally {
      creating.current = false
    }
    setAdded((a) => [...a, p])
    reload()
    // 软件自己建的文件监听不报：告诉左栏的文件树、⌘O 重新列（记录文件夹那一行的「N条」跟着变）
    app().refresh()
    // 新的一条直接在表里起名字（不用打开那篇、也不用去文件树改名）
    setEditing({ path: p, col: 'file.name' })
  }
  /**
   * 名字格改名：文件跟着改名（重名加「 2」）。
   * 回车改完、输入框收起时还会再来一次失焦：按输入框认「这一次起名」，同一个框只改一次。
   */
  const named = useRef(new WeakSet<HTMLInputElement>())
  const rename = async (r: BaseRow, el: HTMLInputElement) => {
    setEditing(null)
    if (named.current.has(el)) return
    named.current.add(el)
    const name = el.value.trim()
    if (!name || name === r.name) return
    try {
      const file = nameFromTitle(name)
      const to = await window.cn.renameNote(r.path, file, true)
      setAdded((a) => a.map((x) => (x === r.path ? to : x)))
      setSel((s) => (s && s.path === r.path ? { ...s, path: to } : s))
      app().refresh()
      const said = nameNotice(name, titleOf(to), '条', safeName(file)) // 不翻：量词是传给 shared/file-name 选句子的参数
      if (said) app().notice(said)
    } catch (e) {
      app().notice(String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
    reload()
  }

  // ----- 格子焦点（task-cle3x，照 Notion：单击选中一格，回车、打字进编辑，Esc 退回，方向键、Tab 走格，⌘C / ⌘V 一格） -----
  /** 选中的那一条现在是第几行：原来那一行还是它就是它，重排了按 path 找，筛掉了留在原来的行号 */
  const selIdx = (s: Sel, rows: BaseRow[]) => {
    if (rows[s.idx]?.path === s.path) return s.idx
    const i = rows.findIndex((r) => r.path === s.path)
    return i >= 0 ? i : Math.min(s.idx, rows.length - 1)
  }
  const select = (full: boolean, idx: number, col: string, focus = true) => {
    const r = shownRef.current[full ? 'full' : 'inline'][idx]
    if (!r) return
    if (focus) wantFocus.current = true
    setSel({ full, idx, path: r.path, col })
  }
  const cellEl = (full: boolean, idx: number, col: string) =>
    [...((full ? fullRef : rootRef).current?.querySelectorAll<HTMLElement>(`td[data-row="${idx}"]`) ?? [])].find((td) => td.dataset.col === col) ?? null
  /** 浮层收起（选好了、Esc）：焦点回到选中的那一格 */
  const closePop = () => {
    setPop(null)
    if (selRef.current) wantFocus.current = true
  }
  /** 回车、打字进来这一格做什么：名字、文字数字链接日期是输入框，选项多选出小框，关联状态出选择，勾选就勾，按钮就按；AI、汇总、公式只看 */
  type CellKind = 'name' | 'input' | 'date' | 'options' | 'pick' | 'check' | 'button' | 'none'
  const cellKind = (c: string): CellKind => {
    if (c === 'file.name') return 'name'
    if (btnOf(c)) return 'button'
    if (aiOf(c)) return 'none'
    const own = ownOf(c)
    if (own) return own === 'relation' || own === 'status' ? 'pick' : 'none'
    const t = types[c] ?? 'text'
    return t === 'check' ? 'check' : t === 'select' || t === 'multi' ? 'options' : t === 'date' ? 'date' : 'input'
  }
  /** 进这一格（回车、已选中再点一下、双击；typed：直接打字进来的）。进不去（只看的格子）给 false */
  const startEdit = (full: boolean, idx: number, r: BaseRow, c: string, typed: boolean): boolean => {
    const td = cellEl(full, idx, c)
    switch (cellKind(c)) {
      case 'name':
      case 'input':
        // 打字进来：同一下把框画出来、焦点给它，这个键的字（输入法也是）落进框里，换掉原来的字
        flushSync(() => setEditing({ path: r.path, col: c, typed }))
        return true
      case 'options':
      case 'date':
        if (!td) return false
        flushSync(() => setPop({ kind: cellKind(c) as 'options' | 'date', path: r.path, col: c, at: atOf(td) }))
        return true
      case 'pick':
        if (!td || typed) return false
        ownClick(r, c, ownOf(c)!, td)
        return true
      case 'check':
        if (typed) return false
        void save(r, c, /^true$/i.test(r.props[c] ?? '') ? 'false' : 'true')
        return true
      case 'button':
        if (typed) return false
        td?.querySelector<HTMLButtonElement>('button')?.click()
        return true
    }
    return false
  }
  /** 退格、Delete：清空这一格（本来就空的不写） */
  const clearCell = (r: BaseRow, c: string) => {
    const k = cellKind(c)
    if (k === 'input' || k === 'options' || k === 'date') void save(r, c, '')
    else if (k === 'check' && /^true$/i.test(r.props[c] ?? '')) void save(r, c, 'false')
  }
  /** 复制出去的字：存着的值（多选写成「a, b」）；算出来的照格子里看到的 */
  const copyText = (full: boolean, idx: number, r: BaseRow, c: string) => {
    if (c === 'file.name') return r.name
    const k = cellKind(c)
    const v = r.props[c] ?? ''
    if (k === 'input' || k === 'check' || k === 'date') return v
    if (k === 'options') return types[c] === 'multi' ? listOf(v).join(', ') : v
    return cellEl(full, idx, c)?.innerText.trim() ?? v
  }
  /** 贴进这一格的字 → 要写的值；这一列不收（算出来的、不是数字、认不出日期）给 null */
  const pasteValue = (c: string, text: string): string | null => {
    const v = text.trim()
    const k = cellKind(c)
    if (k === 'name') return v || null
    if (k === 'check') return /^(true|yes|y|1|x|✓|☑|是|对)$/i.test(v) ? 'true' : /^(false|no|n|0|否|)$/i.test(v) ? 'false' : null
    if (k === 'options') {
      if (types[c] !== 'multi') return v
      const vs = [...new Set(v.replace(/^\[|\]$/g, '').split(/[,，、;；]/).map((x) => x.trim()).filter(Boolean))]
      return vs.length ? listText(vs) : ''
    }
    if (k === 'date') return v === '' ? '' : dayOf(v)
    if (k !== 'input') return null
    const t = types[c] ?? 'text'
    if (t === 'number') {
      const n = v.replace(/[,\s]/g, '')
      return n === '' || /^-?\d+(\.\d+)?$/.test(n) ? n : null
    }
    return v
  }
  /**
   * 粘贴（照 Notion）：一格的字贴进选中的这一格；从别的表格软件复制的一块（制表符隔开）从这一格往右下铺，
   * 一条笔记一次写完（同一行几格不分几次写）。铺不下的、这一列不收的跳过，说一句
   */
  const pasteCells = async (full: boolean, idx: number, col: string, grid: string[][]) => {
    const rows = shownRef.current[full ? 'full' : 'inline']
    const c0 = spec.columns.indexOf(col)
    if (grid.length === 1 && grid[0]!.length === 1) {
      const r = rows[idx]!
      const v = pasteValue(col, grid[0]![0]!)
      if (v === null) return app().notice(tNow('「{col}」这一列收不了「{text}」', { col: colName(col), text: grid[0]![0]!.trim().slice(0, 40) }))
      if (col === 'file.name') return void renameTo(r, v)
      return void save(r, col, v)
    }
    let skipped = 0
    let wrote = false
    for (let i = 0; i < grid.length; i++) {
      const r = rows[idx + i]
      const old = r && data?.texts.get(r.path)
      if (!r || old === undefined) {
        skipped += grid[i]!.length
        continue
      }
      let next = old
      for (let j = 0; j < grid[i]!.length; j++) {
        const c = spec.columns[c0 + j]
        const v = c && c !== 'file.name' ? pasteValue(c, grid[i]![j]!) : null
        if (!c || v === null) {
          skipped++
          continue
        }
        if ((r.props[c] ?? '') !== v) next = setProp(next, c, v === '' ? undefined : v, { raw: types[c] === 'multi' })
      }
      if (next === old) continue
      const w = await window.cn.writeNote(r.path, next, old)
      if (!w.ok) app().notice(tNow('《{name}》刚被别处改过，没改成，再试一次', { name: r.name }))
      else wrote = true
    }
    if (skipped) app().notice(tNow('有 {n} 格没贴上（超出表格、名字列或这一列收不了）', { n: skipped }))
    if (wrote) baseWrote(spec.folder)
    reload()
  }
  /** 粘贴进名字格：和名字格里改名一样 */
  const renameTo = (r: BaseRow, name: string) => {
    const el = document.createElement('input')
    el.value = name
    return rename(r, el)
  }
  /** 选中一格时的键（键在表格上统一收：焦点在选中的那一格上） */
  const onGridKey = (e: React.KeyboardEvent, full: boolean) => {
    const s = selRef.current
    if (!s || s.full !== full || editingRef.current || pop || e.defaultPrevented) return
    // 键落在输入框里（列菜单改名、筛选框……）不归格子；表格画在文档里，祖先 .cm-content 是 contenteditable，用 isContentEditable 认
    const t = e.target as HTMLElement
    if (t.isContentEditable || t.matches('input:not([type=checkbox]), textarea, select')) return
    const rows = shownRef.current[full ? 'full' : 'inline']
    const at = { row: selIdx(s, rows), col: spec.columns.indexOf(s.col) }
    if (at.row < 0 || at.col < 0) return
    const act = gridKey(e, at, { rows: rows.length, cols: spec.columns.length })
    if (!act) return
    e.stopPropagation()
    const r = rows[at.row]!
    if (act.kind === 'edit' && act.typed) {
      // 打的字落进编辑框：这个键不拦（startEdit 同一下把焦点给了框）；进不去的格子吞掉这个键
      if (!startEdit(full, at.row, r, s.col, true)) e.preventDefault()
      return
    }
    e.preventDefault()
    gridAct(act, full, at.row, r, s.col)
  }
  const gridAct = (act: GridAct, full: boolean, idx: number, r: BaseRow, c: string) => {
    if (act.kind === 'move') return select(full, act.to.row, spec.columns[act.to.col]!)
    if (act.kind === 'edit') return void startEdit(full, idx, r, c, false)
    if (act.kind === 'clear') return clearCell(r, c)
    // 整页打开的、白板上的表没有正文：↑↓ 停在边上，Esc 只是不选中
    if (act.kind === 'leave' && (full || !props.nav)) return
    setSel(null)
    if (full || !props.nav) return void (document.activeElement as HTMLElement | null)?.blur()
    props.nav.leave(act.kind === 'leave' ? act.dir : 'block')
  }
  /** 点一格：没选中的选中它；已经选中的再点一下进编辑（点的是格子里的按钮、链接、勾选框，归它们自己） */
  const cellClick = (e: React.MouseEvent, full: boolean, idx: number, r: BaseRow, c: string) => {
    if (e.metaKey || e.shiftKey) return
    const own = !!(e.target as HTMLElement).closest('button, a, input')
    const s = selRef.current
    const same = !!s && s.full === full && s.col === c && selIdx(s, shownRef.current[full ? 'full' : 'inline']) === idx
    if (same && !own && !editingRef.current) return void startEdit(full, idx, r, c, false)
    if (!same) select(full, idx, c, !own)
  }
  const cellDbl = (e: React.MouseEvent, full: boolean, idx: number, r: BaseRow, c: string) => {
    if ((e.target as HTMLElement).closest('button, a, input')) return
    const ed = editingRef.current
    if ((ed && ed.path === r.path && ed.col === c) || (pop && 'path' in pop && pop.path === r.path && 'col' in pop && pop.col === c)) return
    startEdit(full, idx, r, c, false)
  }
  /** 一格的公共属性：认它的 data-row / data-col、能拿焦点、选中时蓝框（类名 cn-cell-sel，和普通表格共用） */
  const cellAttrs = (full: boolean, idx: number, r: BaseRow, c: string, cls?: string) => {
    const on = !!sel && sel.full === full && sel.col === c && selIdx(sel, shownRef.current[full ? 'full' : 'inline']) === idx && !(editing && editing.path === r.path && editing.col === c)
    return {
      'data-row': idx,
      'data-col': c,
      tabIndex: -1,
      className: [cls, on ? 'cn-cell-sel' : ''].filter(Boolean).join(' ') || undefined,
      'aria-selected': on || undefined,
      onClick: (e: React.MouseEvent) => cellClick(e, full, idx, r, c),
      onDoubleClick: (e: React.MouseEvent) => cellDbl(e, full, idx, r, c),
    }
  }
  /** 改完一格回到选中（照 Notion：回车、Esc 停在原格；Tab、⇧Tab 存了走到旁边一格） */
  const backToSel = (full: boolean, idx: number, c: string, how: 'commit' | 'cancel' | 'next' | 'prev') => {
    setEditing(null)
    const rows = shownRef.current[full ? 'full' : 'inline']
    if (how === 'next' || how === 'prev') {
      const to = tabFrom({ row: idx, col: spec.columns.indexOf(c) }, { rows: rows.length, cols: spec.columns.length }, how === 'next' ? 1 : -1)
      return select(full, to.row, spec.columns[to.col]!)
    }
    select(full, idx, c)
  }
  // 画完：要的话把焦点放到选中的那一格（滚到看得见）
  useLayoutEffect(() => {
    if (!wantFocus.current || editing || pop) return
    wantFocus.current = false
    if (!sel) return
    const td = cellEl(sel.full, selIdx(sel, shownRef.current[sel.full ? 'full' : 'inline']), sel.col)
    if (!td) return
    td.focus({ preventScroll: true })
    // 看得见就不滚（滚了会收起刚打字开的浮层：浮层看到「文档滚了」就收）；看不见才滚到看得见
    const r = td.getBoundingClientRect()
    const box = td.closest('.base-scroll')?.getBoundingClientRect()
    const port = (sel.full ? fullRef.current : docBody())?.getBoundingClientRect()
    const out = (box && (r.left < box.left - 1 || r.right > box.right + 1)) || (port && (r.top < port.top + (td.closest('table')?.dataset.stuck !== undefined ? 36 : 0) || r.bottom > port.bottom))
    if (out) {
      selfScroll.current = Date.now()
      td.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  })
  // 选中着一格：点表格外面（浮层除外）不选中；⌘C / ⌘X / ⌘V 归这一格（焦点在选中的那一格上才管）
  useEffect(() => {
    if (!sel) return
    const mine = () => {
      const a = document.activeElement as HTMLElement | null
      return !!a && !editingRef.current && a.matches('td[data-row]') && !!(rootRef.current?.contains(a) || fullRef.current?.contains(a))
    }
    const down = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (t.closest?.('.base-pop')) return
      const td = t.closest?.('td[data-row]')
      if (td && (rootRef.current?.contains(td) || fullRef.current?.contains(td))) return
      setSel(null)
    }
    const clip = (e: ClipboardEvent) => {
      const s = selRef.current
      if (!s || !mine()) return
      const rows = shownRef.current[s.full ? 'full' : 'inline']
      const idx = selIdx(s, rows)
      const r = rows[idx]
      if (!r) return
      e.preventDefault()
      e.stopPropagation()
      if (e.type === 'paste') return void pasteCells(s.full, idx, s.col, parseGridText(e.clipboardData?.getData('text/plain') ?? ''))
      e.clipboardData?.setData('text/plain', gridText([[copyText(s.full, idx, r, s.col)]]))
      if (e.type === 'cut') clearCell(r, s.col)
    }
    document.addEventListener('mousedown', down, true)
    for (const t of ['copy', 'cut', 'paste'] as const) document.addEventListener(t, clip as EventListener, true)
    return () => {
      document.removeEventListener('mousedown', down, true)
      for (const t of ['copy', 'cut', 'paste'] as const) document.removeEventListener(t, clip as EventListener, true)
    }
  })
  // 从文档进表（base-block.tsx 在整块选中时按回车、↓、↑）：选中第一行 / 最后一行的第一格
  useEffect(() => {
    const el = props.anchor
    const enter = (e: Event) => {
      const d = (e as CustomEvent<GridEnter>).detail
      const rows = shownRef.current.inline
      if (isLayoutView(view.kind) || raw || full || !rows.length) return
      d.ok = true
      select(false, d.at === 'first' ? 0 : rows.length - 1, spec.columns[0]!)
    }
    el.addEventListener(GRID_ENTER, enter)
    return () => el.removeEventListener(GRID_ENTER, enter)
  })

  // ----- 表在文档里放宽、表头吸顶（task-cle3x，照 Notion） -----
  /** 文档里那张表各列本来的宽加起来 */
  const natural = useRef(0)
  /** 文档里的表最多能有多宽（栏宽左右各让 56，左边放块把手）：各列加起来比它宽时没拖过的列收窄（table 里的 squeeze） */
  const [fit, setFit] = useState(0)
  /** 文档里的表（```base 部件）：用不着它的话 null */
  const docBody = () => (props.anchor.classList.contains('cm-base') ? props.anchor.closest<HTMLElement>('.body > .doc')?.parentElement ?? null : null)
  /**
   * 放宽：各列加起来比正文宽时，部件往右伸到栏宽（栏右边留 56），还不够再往左伸（左边留 56 放块把手）；再宽就收窄没拖过的列、最后横着滚。
   * 不比正文宽（列少）、看板日历画廊、改写法开着时照正文宽
   */
  const widen = useRef(() => {})
  widen.current = () => {
    const el = props.anchor
    const body = docBody()
    const content = el.parentElement
    if (!body || !content) return
    const want = natural.current + 2
    const text = content.clientWidth
    const b = body.getBoundingClientRect()
    const left = content.getBoundingClientRect().left
    // 左边留出块把手（+ ⋮⋮，52 宽）的地方，右边一样宽（左右对称）
    const lo = b.left + 56
    const hi = b.left + body.clientWidth - 56
    const most = Math.floor(hi - lo)
    if (most !== fit) setFit(most)
    // 先往右伸到栏的右边；还不够再往左伸（照 Notion：数据库能用的是整个栏宽，列少时左边和正文对齐）
    const w = isLayoutView(view.kind) || raw || want <= text ? 0 : Math.max(text, Math.min(want, most))
    const shift = w ? Math.min(Math.max(0, w - (hi - left)), left - lo) : 0
    const v = w ? `${Math.floor(w)}px` : ''
    if (el.style.width !== v) el.style.width = v
    const m = shift > 0 ? `-${Math.ceil(shift)}px` : ''
    if (el.style.marginLeft !== m) el.style.marginLeft = m
  }
  useLayoutEffect(() => widen.current())
  /**
   * 表头吸顶：表的上沿滚出滚动框（文档的 .body、整页打开的那一层）上沿时，表头往下挪同样多（最多挪到表底前一行），
   * 写进表上的 --base-stick；挪着时 data-stuck，CSS 给表头铺底、下沿一道线
   */
  const stick = useRef(() => {})
  stick.current = () => {
    for (const [root, scroller] of [
      [rootRef.current, docBody()],
      [fullRef.current, fullRef.current],
    ] as const) {
      const table = root?.querySelector<HTMLTableElement>(':scope > .base-scroll > table')
      if (!table?.tHead || !scroller) continue
      const t = table.getBoundingClientRect()
      const head = table.tHead.getBoundingClientRect().height
      const foot = table.tFoot?.getBoundingClientRect().height ?? 0
      const max = Math.max(0, t.height - head - foot - 36)
      const shift = Math.round(Math.max(0, Math.min(scroller.getBoundingClientRect().top - t.top, max)))
      const v = shift + 'px'
      if (table.style.getPropertyValue('--base-stick') !== v) table.style.setProperty('--base-stick', v)
      if (shift > 0) table.dataset.stuck = ''
      else delete table.dataset.stuck
    }
  }
  useLayoutEffect(() => stick.current())
  useEffect(() => {
    // 文档里的部件刚画出来时还没挂进文档（找不到 .body）：滚动在 document 上抓（滚动事件不冒泡，用捕获），窗口、栏变宽变窄看部件自己
    let raf = 0
    let body: HTMLElement | null = null
    const tick = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        // 栏变宽变窄（开关左栏、拖右栏）：表跟着重算放多宽
        const b = docBody()
        if (b && b !== body) ro.observe((body = b))
        stick.current()
        widen.current()
      })
    }
    const ro = new ResizeObserver(tick)
    ro.observe(props.anchor)
    document.addEventListener('scroll', tick, { capture: true, passive: true })
    window.addEventListener('resize', tick)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      document.removeEventListener('scroll', tick, { capture: true })
      window.removeEventListener('resize', tick)
    }
  }, [props.anchor])

  // ----- 筛选、排序（面板在 ViewBar / FilterPanel，这里是列菜单进来的） -----
  /** 列菜单「按这一列筛选…」：开筛选面板、多一条这一列的（贴着第二行的「筛选」，收成图标时也一样） */
  const openFilter = (col?: string) => {
    const btn = (full ? fullRef : rootRef).current?.querySelector<HTMLElement>('.base-tools [data-tool="vfilter"]') ?? null
    setPop({ kind: 'vfilter', at: btn ? atOf(btn) : NOWHERE, add: col })
  }
  const sortBy = (prop: string, desc: boolean) =>
    saveSrc((src) => setViewSort(src, vi, [{ prop, desc }]), tNow('{what}，存进了「{name}」', { what: tNow('按「{col}」{dir}', { col: colName(prop), dir: desc ? tNow('降序') : tNow('升序') }), name: view.name }))
  /** 显示哪几列、什么顺序：只改当前视图的 order */
  const order = (cols: string[]) => edit.src((src) => setBaseOrder(src, cols, vi))

  // ----- 列 -----
  const hideCol = (c: string) => order(spec.columns.filter((x) => x !== c))
  const showCol = (c: string) => order([...spec.columns, c])
  /** 新的一列：起个不重名的名字，插在第 index 列前面，类型照选的 */
  const freshName = (base = '新的一列', used?: (n: string) => boolean) => { // 不翻：写进文件的属性名
    const taken = new Set([...spec.columns, ...allProps])
    const busy = used ?? ((n: string) => taken.has(n))
    let n = base
    for (let k = 2; busy(n); k++) n = `${base} ${k}`
    return n
  }
  /** 列 id 插在第 index 列前面（名字列一直在最前） */
  const orderWith = (id: string, index: number) => {
    const cols = [...spec.columns]
    cols.splice(Math.max(1, Math.min(index, cols.length)), 0, id)
    return cols
  }
  // 不翻：新加的一列没起名时用类型名当列名（写进文件）
  const LABEL: Record<string, string> = { text: '文字', number: '数字', select: '选项', multi: '多选', status: '状态', date: '日期', check: '勾选', url: '链接', rollup: '汇总', formula: '公式' }
  /** 加一列的菜单选好了（第三批：状态、关联、汇总、公式也在这里） */
  const addChoice = (c: AddChoice, index: number, at: At) => {
    const taken = (n: string) => spec.columns.includes(n) || allProps.includes(n) || !!ctx?.doc.props[n]
    const fresh = (base: string) => freshName(base.trim().replace(/:/g, '：'), taken)
    if (c.kind === 'basic') {
      const n = fresh(c.name || LABEL[c.type]!)
      setPop(null)
      if (c.type === 'status') {
        const groups = ctx ? statusGroups(ctx, n) : undefined
        return edit.src((src) => setPropDef(setBaseOrder(src, orderWith(n, index), vi), n, { type: 'status', groups: groups ?? [] }))
      }
      return edit.src((src) => setBaseColType(setBaseOrder(src, orderWith(n, index), vi), n, c.type as ColType))
    }
    if (c.kind === 'relation') {
      const n = fresh(c.name || dbNameOf(c.to))
      setPop(null)
      const back = c.twoWay ? dbNameOf(spec.folder ?? '') || n : null
      edit.src((src) => setPropDef(setBaseOrder(src, orderWith(n, index), vi), n, { type: 'relation', to: c.to, twoWay: back }))
      app().notice(c.twoWay ? tNow('加了关联列「{name}」：那边每一篇多一列「{back}」，连上时才写', { name: n, back: back ?? '' }) : tNow('加了关联列「{name}」', { name: n }))
      return
    }
    if (c.kind === 'rollup') {
      const def = ctx && rollupDefault(ctx)
      if (!def) return
      const n = fresh(c.name || LABEL.rollup!)
      edit.src((src) => setPropDef(setBaseOrder(src, orderWith(n, index), vi), n, def))
      // 建好了马上开它的列菜单（顺着、那边的、算）：等表头画出这一列
      setPop(null)
      openColMenuSoon(n)
      return
    }
    const formulas = ctx?.doc.formulas ?? {}
    let n = (c.name || LABEL.formula!).trim().replace(/:/g, '：')
    for (let k = 2; Object.hasOwn(formulas, n); k++) n = `${c.name || LABEL.formula} ${k}`
    setPop({ kind: 'fx', at, name: n, src: '', isNew: true, index })
  }
  /** 列菜单等表头画出这一列再开（新建的汇总列） */
  const openColMenuSoon = (col: string) => {
    let n = 0
    const tryOpen = () => {
      const th = [...((full ? fullRef : rootRef).current?.querySelectorAll<HTMLElement>('thead th.col .base-th') ?? [])].find((b) => b.dataset.col === col)
      if (th) return setPop({ kind: 'col', col, at: atOf(th) })
      if (n++ < 40) setTimeout(tryOpen, 50)
    }
    setTimeout(tryOpen, 0)
  }
  /** 公式框「完成」：新的写进 formulas、加进这个视图的列；改的照新名字（改名时视图里的 formula.旧名一起换） */
  const saveFormula = (p: Extract<Pop, { kind: 'fx' }>, name: string, expr: string) => {
    setPop(null)
    if (p.isNew) return edit.src((src) => setBaseOrder(setFormula(src, name, expr), orderWith('formula.' + name, p.index), vi))
    edit.src((src) => setFormula(name !== p.name ? renameBaseProp(src, 'formula.' + p.name, name) : src, name, expr))
  }
  /** 格子被点到：关联出选择、状态出选项；汇总、公式开这一列的菜单（照原型） */
  const ownClick = (r: BaseRow, c: string, own: FieldType, el: HTMLElement) => {
    if (own === 'relation') return setPop({ kind: 'rel', path: r.path, col: c.replace(/^note\./, ''), at: atOf(el) })
    if (own === 'status') return setPop({ kind: 'status', path: r.path, col: c.replace(/^note\./, ''), at: atOf(el) })
    const th = [...(el.closest('table')?.querySelectorAll<HTMLElement>('thead th.col .base-th') ?? [])].find((b) => b.dataset.col === c)
    setPop({ kind: 'col', col: c, at: atOf(th ?? el) })
  }
  /** 改列名：每一条的这一项改名，代码块里用到它的地方一起换 */
  const renameCol = async (from: string, toIn: string) => {
    const to = toIn.trim().replace(/:/g, '：')
    if (!to || to === colName(from) || from === 'file.name') return
    // 公式列：只改 base 块里的名字（formulas 的键、视图里的 formula.名字、别的公式里用到的）
    if (from.startsWith('formula.')) {
      if (Object.hasOwn(ctx?.doc.formulas ?? {}, to)) return app().notice(tNow('已经有一个公式叫「{name}」了', { name: to }))
      return edit.src((src) => renameBaseProp(src, from, to))
    }
    if (spec.columns.includes(to) || allProps.includes(to) || ctx?.doc.props[to]) return app().notice(tNow('已经有一列叫「{name}」了', { name: to }))
    // 汇总列的值不在笔记里：只改 base 块
    // AI 列：「AI填的」里记着的列名一起换（不然改了名就都算你写的了）
    if (aiOf(from)) await eachRow((t) => aiRenameFilled(renameProp(t, from, to), from, to))
    else if (ownOf(from) !== 'rollup') await eachRow((t) => renameProp(t, from, to))
    edit.src((src) => renameBaseProp(src, from, to))
  }
  /** 删一列：每一条里的这一项一起删（Git 里能找回），代码块里也拿掉 */
  const dropCol = async (c: string) => {
    setPop(null)
    if (!c.startsWith('formula.') && ownOf(c) !== 'rollup') await eachRow((t) => setProp(t, c, undefined))
    edit.src((src) => dropBaseProp(src, c))
  }
  const setType = (c: string, t: ColType | 'status') => {
    setPop(null)
    if (t === 'status') {
      const groups = ctx ? statusGroups(ctx, c) : []
      return edit.src((src) => setPropDef(src, c, { type: 'status', groups }))
    }
    edit.src((src) => setBaseColType(src, c, t))
  }
  /** 表底这一列按哪一种算（数字、日期、勾选、别的）：公式、汇总按算出来的值（packages/format 的 sumKind） */
  const kinds = useMemo(() => new Map<string, SumKind>(ctx ? spec.columns.map((c) => [c, sumKind(ctx, c)]) : []), [ctx, spec.columns.join('\n')])
  const kindOf = (c: string): SumKind => kinds.get(c) ?? 'other'
  /** 表底一格点开选的算法：只写当前视图的 summaries 那一行，底部提示能撤回（改了就存） */
  const setSummary = (c: string, id: string | null) => {
    setPop(null)
    if ((spec.summaries[c] ?? null) === id) return
    saveSrc((src) => setBaseSummary(src, c, id, vi), tNow('「{view}」表底「{col}」改成「{calc}」', { view: view.name, col: colName(c), calc: id ? calcLabel(id, kindOf(c)) : tNow('不算') }))
  }

  // ----- 列宽、换顺序（拖列头） -----
  const startSize = (e: React.MouseEvent, c: string) => {
    e.preventDefault()
    e.stopPropagation()
    const th = (e.currentTarget as HTMLElement).closest('th')!
    const x0 = e.clientX
    const w0 = th.getBoundingClientRect().width
    let w = w0
    const move = (ev: MouseEvent) => {
      w = Math.max(64, Math.round(w0 + ev.clientX - x0))
      setSizing({ col: c, w })
    }
    // 松手没送到页面：列宽回原样、不写文件（trackDrag，task-0nz63）
    trackDrag(e, {
      move,
      end: (how) => {
        setSizing(null)
        if (how === 'up' && Math.abs(w - w0) >= 2) edit.src((src) => setBaseColSize(src, c, w, vi))
      },
    })
  }
  const startMove = (e: React.MouseEvent, c: string) => {
    if (e.button !== 0 || c === 'file.name') return
    const x0 = e.clientX
    const table = (e.currentTarget as HTMLElement).closest('table')!
    let to = -1
    let started = false
    const move = (ev: MouseEvent) => {
      if (!started && Math.abs(ev.clientX - x0) < 6) return
      started = true
      const ths = [...table.querySelectorAll<HTMLElement>('thead th.col')]
      to = ths.findIndex((th) => ev.clientX < th.getBoundingClientRect().left + th.getBoundingClientRect().width / 2)
      if (to === -1) to = ths.length
      to = Math.max(1, to)
      setMoving({ col: c, to })
    }
    const up = () => {
      setMoving(null)
      if (!started || to === -1) return
      const cols = spec.columns.filter((x) => x !== c)
      const from = spec.columns.indexOf(c)
      cols.splice(to > from ? to - 1 : to, 0, c)
      if (cols.join('\n') !== spec.columns.join('\n')) order(cols)
      // 拖过了就不算点（不弹列菜单）
      suppressClick.current = true
      setTimeout(() => (suppressClick.current = false), 0)
    }
    // 松手没送到页面：当没拖过，列的先后不变（trackDrag，task-0nz63）
    trackDrag(e, { move, end: (how) => (how === 'up' ? up() : setMoving(null)) })
  }
  const suppressClick = useRef(false)

  // ----- 浮层 -----
  const colMenu = (c: string, at: At) => {
    const s = spec.sort.find((x) => x.prop === c)
    const own = ownOf(c)
    const t = own === 'status' ? 'status' : (types[c] ?? 'text')
    /** 关联、汇总、公式：不在这里换类型，名字框下面是它们自己的一段 */
    const ai = aiOf(c)
    const btn = btnOf(c)
    const computed = own === 'relation' || own === 'rollup' || own === 'formula' || !!ai || btn
    return (
      <FloatPop at={at} className={'base-pop base-colmenu' + (computed ? ' wide' : '')} role="menu" aria-label={tNow('{name} 这一列', { name: colName(c) })}>
        {ai && ctx && <AiColMenu ctx={ctx} col={c} table={me} folder={spec.folder} onClose={() => setPop(null)} onSrc={edit.src} />}
        {btn && ctx && <ButtonColMenu ctx={ctx} col={c} table={me} onClose={() => setPop(null)} />}
        {c !== 'file.name' && <ColRename name={colName(c)} onDone={(v) => (setPop(null), void renameCol(c, v))} />}
        {computed && !ai && !btn && ctx && (
          <ColExtra
            ctx={ctx}
            col={c}
            onDef={(def) => edit.src((src) => setPropDef(src, c.replace(/^note\./, ''), def))}
            onFormula={() => {
              const name = c.replace(/^formula\./, '')
              setPop({ kind: 'fx', at, name, src: ctx.doc.formulas[name] ?? '', isNew: false, index: spec.columns.indexOf(c) })
            }}
          />
        )}
        {c !== 'file.name' && !computed && (
          <div className="base-sub" role="group" aria-label={tNow('类型')}>
            <div className="hd">{tNow('类型')}</div>
            <div className="base-types">
              {TYPE_CHOICES.map((ct) => (
                <button key={ct.type} type="button" role="menuitemradio" aria-checked={t === ct.type} className={t === ct.type ? 'on' : ''} onClick={() => setType(c, ct.type)}>
                  <Codicon name={FIELD_ICON[ct.type]} size={14} />
                  <span>{fmt(ct.label)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {c !== 'file.name' && !computed && <div className="sep" />}
        <button type="button" role="menuitemcheckbox" aria-checked={!!s && !s.desc} onClick={() => (setPop(null), sortBy(c, false))}>
          <Codicon name="arrow-up" size={14} />
          <span>{tNow('升序')}</span>
          {s && !s.desc && <Codicon name="check" size={14} />}
        </button>
        <button type="button" role="menuitemcheckbox" aria-checked={!!s?.desc} onClick={() => (setPop(null), sortBy(c, true))}>
          <Codicon name="arrow-down" size={14} />
          <span>{tNow('降序')}</span>
          {s?.desc && <Codicon name="check" size={14} />}
        </button>
        <button type="button" role="menuitem" onClick={() => openFilter(c)}>
          <Codicon name="filter" size={14} />
          <span>{tNow('按这一列筛选…')}</span>
        </button>
        <button type="button" role="menuitem" onClick={(e) => setPop({ kind: 'sum', col: c, at: atOf(e.currentTarget) })}>
          <Codicon name="symbol-operator" size={14} />
          <span>{spec.summaries[c] ? tNow('计算：{name}', { name: calcLabel(spec.summaries[c]!, kindOf(c)) }) : tNow('计算…')}</span>
        </button>
        <div className="sep" />
        <button type="button" role="menuitem" onClick={(e) => setPop({ kind: 'add', at: atOf(e.currentTarget), index: Math.max(1, spec.columns.indexOf(c)) })}>
          <Codicon name="arrow-left" size={14} />
          <span>{tNow('左边插入一列')}</span>
        </button>
        <button type="button" role="menuitem" onClick={(e) => setPop({ kind: 'add', at: atOf(e.currentTarget), index: spec.columns.indexOf(c) + 1 })}>
          <Codicon name="arrow-right" size={14} />
          <span>{tNow('右边插入一列')}</span>
        </button>
        {c !== 'file.name' && (
          <>
            <button type="button" role="menuitem" onClick={() => (setPop(null), hideCol(c))}>
              <Codicon name="eye-closed" size={14} />
              <span>{tNow('隐藏这一列')}</span>
            </button>
            <button type="button" role="menuitem" className="danger" onClick={(e) => setPop({ kind: 'drop', col: c, at: atOf(e.currentTarget) })}>
              <Codicon name="trash" size={14} />
              <span>{tNow('删除这一列')}</span>
            </button>
          </>
        )}
      </FloatPop>
    )
  }

  const popover = (() => {
    if (!pop) return null
    if (pop.kind === 'hidden')
      return (
        <FloatPop at={pop.at} align="end" className="base-pop base-colmenu" role="menu" aria-label={tNow('隐藏的列')}>
          <div className="hd">{tNow('勾上就显示')}</div>
          {hiddenCols.map((c) => (
            <button key={c} type="button" role="menuitemcheckbox" aria-checked={false} onClick={() => (setPop(null), showCol(c))}>
              <Codicon name={iconOf(c)} size={14} />
              <span>{colName(c)}</span>
            </button>
          ))}
        </FloatPop>
      )
    if (pop.kind === 'col') return colMenu(pop.col, pop.at)
    if (pop.kind === 'add') return <AddCol at={pop.at} ctx={ctx} folder={spec.folder ?? ''} onAdd={(c) => addChoice(c, pop.index, pop.at)} extra={
            <>
              <ButtonAddItem onPick={() => (setPop(null), newButton(me, pop.index))} />
              <AiAddItem bare onPick={() => (setPop(null), openAiCol({ table: me, col: null, index: pop.index }))} />
            </>
          } />
    if (pop.kind === 'rel' && ctx) return <RelationPick at={pop.at} ctx={ctx} path={pop.path} col={pop.col} />
    if (pop.kind === 'status' && ctx) {
      const r = (data?.all ?? []).find((x) => x.path === pop.path)
      return r ? <StatusPick at={pop.at} ctx={ctx} path={pop.path} col={pop.col} onPick={(v) => (closePop(), void save(r, pop.col, v))} /> : null
    }
    if (pop.kind === 'fx' && ctx)
      return (
        <FormulaBox
          at={pop.at}
          ctx={ctx}
          name={pop.name}
          src={pop.src}
          isNew={pop.isNew}
          rows={(data?.rows ?? []).map((r) => recOf.get(r.path)).filter((r): r is NonNullable<typeof r> => !!r)}
          onDone={(n, x) => saveFormula(pop, n, x)}
          onCancel={() => setPop(null)}
        />
      )
    if (pop.kind === 'drop' && ctx && aiOf(pop.col)) return <AiDrop at={pop.at} ctx={ctx} col={pop.col} table={me} onClose={() => setPop(null)} />
    if (pop.kind === 'drop')
      return (
        <FloatPop at={pop.at} className="base-pop base-confirm" role="dialog" aria-label={tNow('删掉这一列')}>
          <b>{tNow('删掉「{name}」这一列？', { name: colName(pop.col) })}</b>
          <p>{tNow('每一条里的「{name}」都会删掉，Git 里能找回。', { name: colName(pop.col) })}</p>
          <div className="row">
            <button type="button" className="btn btn-sm" onClick={() => setPop(null)}>
              {tNow('取消')}
            </button>
            <button type="button" className="btn btn-sm btn-danger" onClick={() => void dropCol(pop.col)}>
              {tNow('删除', { ctx: '删列' })}
            </button>
          </div>
        </FloatPop>
      )
    if (pop.kind === 'sum')
      return ctx && res ? <SumMenu at={pop.at} col={pop.col} label={colName(pop.col)} kind={kindOf(pop.col)} cur={spec.summaries[pop.col] ?? null} ctx={ctx} rows={res.rows} onPick={(id) => setSummary(pop.col, id)} /> : null
    if (pop.kind === 'date') {
      const r = (data?.all ?? []).find((x) => x.path === pop.path)
      return r ? <DatePop at={pop.at} label={`${r.name} · ${colName(pop.col)}`} value={r.props[pop.col] ?? ''} onPick={(v) => (closePop(), void save(r, pop.col, v))} /> : null
    }
    if (pop.kind === 'options') {
      const r = (data?.all ?? []).find((x) => x.path === pop.path)
      if (!r) return null
      const t = types[pop.col] ?? 'select'
      return (
        <Options
          at={pop.at}
          multi={t === 'multi'}
          label={`${r.name} · ${colName(pop.col)}`}
          values={valuesOf(pop.col)}
          picked={t === 'multi' ? listOf(r.props[pop.col] ?? '') : (r.props[pop.col] ?? '') ? [r.props[pop.col]!] : []}
          onChange={(vs, close) => {
            if (close) closePop()
            void save(r, pop.col, t === 'multi' ? (vs.length ? listText(vs) : '') : (vs[0] ?? ''))
          }}
        />
      )
    }
    return null
  })()

  const cellView = (r: BaseRow, c: string, t: ColType, v: string) => {
    if (t === 'select') return v ? <span className={'base-sel ' + toneOf(v)}>{v}</span> : null
    if (t === 'multi')
      return listOf(v).map((x) => (
        <span key={x} className={'base-sel ' + toneOf(x)}>
          {x}
        </span>
      ))
    if (t === 'date') return dayText(v)
    if (t === 'url' && v)
      return (
        <a
          className="base-url"
          href={v}
          data-peek-href={v}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            app().openInWeb(v, v)
          }}
        >
          {(() => {
            try {
              return new URL(v).host
            } catch {
              return v
            }
          })()}
        </a>
      )
    return v
  }

  const table = (limit: number) => {
    const rows = data?.rows ?? []
    /** 留在表底的新条目（不满足筛选） */
    const outRows = (data?.all ?? []).filter((r) => added.includes(r.path) && !rows.some((x) => x.path === r.path))
    const outs = outRows.length
    const locked = lock?.cols === spec.columns.join('\n') && (outs > 0 || (editing && added.includes(editing.path))) ? lock[limit === Infinity ? 'full' : 'inline'] : undefined
    /**
     * 列宽（照 Notion，每一列有自己的宽）：拖过的用拖的，没拖过的名字 200、别的 140；比版心窄时按比例撑满版心，宽了就横着滚。
     * 表格一直按这些宽排（table-layout: fixed），起名框、打的字都不把列挤动
     */
    const own = (c: string, i: number) => (sizing?.col === c ? sizing.w : (locked?.[i] ?? spec.sizes[c] ?? null))
    const dflt = (c: string) => (c === 'file.name' ? 200 : aiOf(c)?.output === 'note' ? 214 : 140)
    /**
     * 文档里的表放宽到栏宽还放不下（task-cle3x：8 列不用横着滑）：没拖过宽的列先收别的列（按比例，最窄 96），
     * 还放不下再收名字列（最窄 160）；拖过的列照拖的宽。收到最窄还放不下就横着滚（设计复审：名字留宽，少折两行）
     */
    const isInline = limit !== Infinity
    const squeezed = (() => {
      const out = new Map<string, number>()
      if (!isInline || !fit) return out
      const all = spec.columns.reduce((sum, c, i) => sum + (own(c, i) ?? dflt(c)), 0) + 34
      let need = all - fit
      if (need <= 0) return out
      const flex = spec.columns.filter((c, i) => own(c, i) === null && c !== 'file.name')
      const total = flex.reduce((sum, c) => sum + dflt(c), 0)
      const cut = Math.min(need, total - 96 * flex.length)
      if (cut > 0) for (const c of flex) out.set(c, Math.max(96, Math.floor(dflt(c) * (1 - cut / total))))
      need -= Math.max(0, cut)
      const ni = spec.columns.indexOf('file.name')
      if (need > 0 && ni >= 0 && own('file.name', ni) === null) out.set('file.name', Math.max(160, Math.floor(dflt('file.name') - need)))
      return out
    })()
    const widthOf = (c: string, i: number) => own(c, i) ?? squeezed.get(c) ?? dflt(c)
    const fixed = true
    let shown = [...rows.slice(0, limit), ...outRows]
    /**
     * 分组（表格、画廊按一列分组；看板、日历还没有自己的看法时也照组画）：组头一行（收起的箭头、状态的圆点、组名、条数），点了收起（记在本机）。
     * 状态的每个选项都有一组（空的也露着），别的列只露有条目的组，「没填」有条目才露。多选、关联一条可以在几组里
     */
    const heads = new Map<number, ReactNode[]>()
    const tail: ReactNode[] = []
    const keys: string[] = []
    if (res?.groups) {
      const folded = foldedGroups(doc.folder, view.name)
      const byPath = new Map(rows.map((r) => [r.path, r]))
      const flat: BaseRow[] = []
      let left = limit
      let waiting: ReactNode[] = []
      /**
       * 组头小计（原型「按月合计」，用户定：写在组头，收起来也看得到）：表底选了算法的列，组头同一格按同一种算法算这一组；
       * 组名那一格一直横到第一个有小计的列前面。「求和，组里画占比」的列：组名后面画这组占全部几成的占比条
       */
      const summed = spec.columns.map((c, i) => i > 0 && !!ctx && !!spec.summaries[c])
      const first = summed.indexOf(true)
      const shareCol = spec.columns.find((c) => spec.summaries[c] === 'SumShare')
      for (const g of res.groups.filter((x) => x.rows.length > 0 || (x.tone >= 0 && x.key !== ''))) {
        const shut = folded.includes(g.key)
        const share = shareCol && ctx ? shareOf(ctx, g.rows, res.rows, shareCol) : null
        waiting.push(
          <tr key={'grp\n' + g.key} className="base-grp" /* 不翻：data-part 给 e2e 和样式认 */ data-part="分组">
            <td colSpan={first === -1 ? spec.columns.length + 1 : first} className="gl">
              <button type="button" className="grp" aria-expanded={!shut} onClick={() => toggleGroup(doc.folder, view.name, g.key)}>
                <Codicon name={shut ? 'chevron-right' : 'chevron-down'} size={12} />
                <span className={'base-sdot' + (g.tone >= 0 ? ' g' + g.tone : ' none')} />
                {groupWords(g, res?.groupProp && ctx ? colTypeOf(ctx, res.groupProp) : 'text')}
                <span className="c">{g.rows.length}</span>
              </button>
              {share !== null && shareCol && <ShareBar share={share} col={colName(shareCol)} />}
            </td>
            {first !== -1 &&
              spec.columns.slice(first).map((c, k) => (
                <td key={c} className="gv" data-col={c}>
                  {summed[first + k] && ctx ? sumText(summaryOf(ctx, g.rows, c, spec.summaries[c]!, kindOf(c))) : null}
                </td>
              ))}
            {first !== -1 && <td className="base-td-plus" />}
          </tr>,
        )
        if (shut) continue
        for (const x of g.rows.slice(0, Math.max(0, left))) {
          if (waiting.length) heads.set(flat.length, waiting)
          waiting = []
          keys.push(g.key)
          flat.push(byPath.get(x.path)!)
          left--
        }
      }
      tail.push(...waiting)
      shown = [...flat, ...outRows]
    }
    const sums = spec.columns.some((c) => spec.summaries[c])
    const isFull = limit === Infinity
    // 各列本来的宽加起来（连最右「+」那一列 32；不算定住的宽、收窄的比例，那两样是照已经排好的宽算的）：文档里的表比正文宽时照它伸（widen）
    if (!isFull) natural.current = spec.columns.reduce((sum, c) => sum + (sizing?.col === c ? sizing.w : (spec.sizes[c] ?? dflt(c))), 0) + 32
    // 键盘走格照这张表显示出来的行数（组头不算）
    shownRef.current[isFull ? 'full' : 'inline'] = shown
    return (
      <>
        <div className="base-scroll" ref={isFull ? fullRoom : inlineRoom}>
          <table className={fixed ? 'fixed' : undefined} onKeyDown={(e) => onGridKey(e, isFull)}>
            <colgroup>
              {/* 比版心窄时按比例撑满（「+」那一列不跟着撑，固定 32）；宽了就照各列自己的宽、横着滚。定住列宽时照量下的宽 */}
              {spec.columns.map((c, i) => {
                const w = widthOf(c, i)
                const total = spec.columns.reduce((sum, x, k) => sum + widthOf(x, k), 0)
                const avail = room[limit === Infinity ? 'full' : 'inline']
                const scale = !locked && avail > 0 && total + 32 < avail ? (avail - 32) / total : 1
                return <col key={c} style={{ width: w * scale }} />
              })}
              {/* 定住列宽时「+」那一列也用量下的宽：几列加起来正好是表宽，浏览器不再把多出来的几像素分给各列 */}
              <col className="base-col-plus" style={locked?.[spec.columns.length] ? { width: locked[spec.columns.length] } : undefined} />
            </colgroup>
            <thead>
              <tr>
                {spec.columns.map((c, i) => {
                  const s = spec.sort.find((x) => x.prop === c)
                  const open = pop?.kind === 'col' && pop.col === c
                  return (
                    <th key={c} className={'col' + (open ? ' on' : '') + (moving?.col === c ? ' moving' : '') + (moving && moving.to === i ? ' drop-before' : '') + (moving && moving.to === spec.columns.length && i === spec.columns.length - 1 ? ' drop-after' : '')}>
                      <button
                        type="button"
                        className={'base-th' + (aiOf(c) ? ' ai' : '')}
                        aria-haspopup="menu"
                        aria-expanded={open}
                        data-col={c}
                        onMouseDown={(e) => startMove(e, c)}
                        onClick={(e) => {
                          if (suppressClick.current) return
                          // 按钮列：点列头在右栏改它做什么（原型 f16）；列菜单照旧能改名、删，等右栏开好（中栏变窄、文档跟着动）再贴着列头开
                          if (!open && btnOf(c)) {
                            const th = e.currentTarget
                            editButton(me, c)
                            return void setTimeout(() => th.isConnected && setPop({ kind: 'col', col: c, at: atOf(th) }), 350)
                          }
                          setPop(open ? null : { kind: 'col', col: c, at: atOf(e.currentTarget) })
                        }}
                      >
                        {aiOf(c) && ctx ? (
                          <AiHead ctx={ctx} col={c} folder={spec.folder} name={colName(c)} />
                        ) : (
                          <>
                            <Codicon name={iconOf(c)} size={12} />
                            <span>{colName(c)}</span>
                          </>
                        )}
                        {s && <Codicon name={s.desc ? 'arrow-down' : 'arrow-up'} size={12} />}
                      </button>
                      <span className="base-size" role="separator" aria-label={tNow('拖动改「{name}」的列宽', { name: colName(c) })} onMouseDown={(e) => startSize(e, c)} />
                    </th>
                  )
                })}
                <th className="base-th-plus">
                  <button
                    type="button"
                    className="base-th base-add-col"
                    aria-label={tNow('加一列')}
                    data-tip={tNow('加一列')}
                    aria-expanded={pop?.kind === 'add'}
                    onClick={(e) => setPop(pop?.kind === 'add' ? null : { kind: 'add', at: atOf(e.currentTarget), index: spec.columns.length })}
                  >
                    <Codicon name="add" size={14} />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, k) => (
                <Fragment key={(keys[k] ?? '') + '\n' + r.path}>
                {heads.get(k)}
                <tr className={[rows.includes(r) ? '' : 'base-row-out', peek?.path === r.path ? 'base-row-peek' : ''].filter(Boolean).join(' ') || undefined}>
                  {spec.columns.map((c) => {
                    const cell = (cls?: string) => cellAttrs(isFull, k, r, c, cls)
                    if (c === 'file.name' && editing?.path === r.path && editing.col === c)
                      return (
                        <td key={c} {...cell('nm cn-cell-edit' + (rows.includes(r) ? '' : ' out'))}>
                          <input
                            className="base-in"
                            autoFocus
                            defaultValue={editing.typed ? '' : r.name}
                            // 和名字差不多宽：输入框收起时列宽不跳（点别的格子时松手落到别的格子上）
                            size={Math.max(6, Array.from(r.name).length * 2 + 2)}
                            aria-label={tNow('{name} · 名字', { name: r.name })}
                            onFocus={(e) => !editing.typed && e.currentTarget.select()}
                            onKeyDown={(e) => {
                              e.stopPropagation()
                              const how = editKey(e)
                              if (!how) return
                              e.preventDefault()
                              if (how !== 'cancel') void rename(r, e.currentTarget)
                              else named.current.add(e.currentTarget)
                              backToSel(isFull, k, c, how)
                            }}
                            onBlur={(e) => void rename(r, e.currentTarget)}
                          />
                          {!rows.includes(r) && <span className="base-out">{tNow('新 · 不在当前筛选里')}</span>}
                        </td>
                      )
                    if (c === 'file.name')
                      return (
                        <td key={c} {...cell('nm' + (rows.includes(r) ? '' : ' out'))}>
                          {/* 点名字、悬停出来的「打开」：右栏开这一条（⌘ 点在中间开整页） */}
                          <button type="button" tabIndex={-1} data-peek-href={r.path} onClick={(e) => (e.metaKey || e.ctrlKey ? app().openFile(r.path) : openRecord({ path: r.path, src: props.src, view: vi, from: me }))} title={locked ? r.name : undefined}>
                            {r.name}
                          </button>
                          <button type="button" tabIndex={-1} className="base-open" aria-label={tNow('在右栏打开「{name}」', { name: r.name })} onClick={() => openRecord({ path: r.path, src: props.src, view: vi, from: me })}>
                            <Codicon name="layout-sidebar-right" size={12} />
                            {tNow('打开')}
                          </button>
                          {!rows.includes(r) && <span className="base-out">{tNow('新 · 不在当前筛选里')}</span>}
                        </td>
                      )
                    const v = r.props[c] ?? ''
                    const t = types[c] ?? 'text'
                    const own = ownOf(c)
                    if (btnOf(c))
                      return (
                        <td key={c} {...cell('btnc')}>
                          <ButtonCell table={me} col={c} path={r.path} name={r.name} />
                        </td>
                      )
                    const aiRec = aiOf(c) ? recOf.get(r.path) : undefined
                    if (aiRec && ctx)
                      return (
                        <td key={c} {...cell('aic')}>
                          <AiCell ctx={ctx} rec={aiRec} col={c} folder={spec.folder} table={me} />
                        </td>
                      )
                    const rec = own && ctx ? recOf.get(r.path) : undefined
                    if (own && rec && ctx)
                      return (
                        <td key={c} {...cell('own ' + own + (own === 'rollup' || own === 'formula' ? ' num' : ''))}>
                          <OwnCell ctx={ctx} rec={rec} col={c} type={own} />
                        </td>
                      )
                    if (t === 'check')
                      return (
                        <td key={c} {...cell()}>
                          <input type="checkbox" tabIndex={-1} className="base-check" checked={/^true$/i.test(v)} aria-label={`${r.name} · ${colName(c)}`} onChange={(e) => void save(r, c, e.currentTarget.checked ? 'true' : 'false')} />
                        </td>
                      )
                    if (editing?.path === r.path && editing.col === c)
                      return (
                        <td key={c} {...cell('editing cn-cell-edit')}>
                          <CellInput
                            label={`${r.name} · ${colName(c)}`}
                            type={t === 'number' ? 'number' : 'text'}
                            value={editing.typed ? '' : v}
                            onDone={(raw, how, el) => {
                              if (how === 'cancel') return dropBad(), backToSel(isFull, k, c, how)
                              let next = raw
                              if (t === 'number') {
                                // 数字自己认（cell-input.ts）：不是数不收、框描红、底栏说一句，回车、Tab 时框留着改，点别处就不改了
                                const n = numText(raw)
                                if (n === null) {
                                  badNum(colName(c), el)
                                  if (how === 'blur') return void setEditing(null)
                                  return false
                                }
                                next = n
                                dropBad()
                              }
                              // 只是进来又出去（没改字）：什么都不写（打开再保存文件不变）
                              if (next !== (editing.typed ? '' : v)) void save(r, c, next)
                              else setEditing(null)
                              if (how !== 'blur') backToSel(isFull, k, c, how)
                            }}
                          />
                        </td>
                      )
                    return (
                      <td key={c} {...cell(t === 'number' ? 'num' : t === 'date' ? 'num date' : '')}>
                        {cellView(r, c, t, v)}
                      </td>
                    )
                  })}
                  <td className="base-td-plus" />
                </tr>
                </Fragment>
              ))}
              {tail}
            </tbody>
            <tfoot>
              {/* 表底「+ 新建」一行（照 Notion），再下面一行计算 */}
              {spec.folder && (
                <tr className="base-newrow-tr">
                  <td
                    colSpan={spec.columns.length + 1}
                    className="base-newrow"
                    role="button"
                    tabIndex={0}
                    onMouseDown={(e) => e.detail > 1 && e.preventDefault()}
                    onClick={(e) => e.detail <= 1 && void add()}
                    onKeyDown={(e) => e.key === 'Enter' && void add()}
                  >
                    <Codicon name="add" size={14} />
                    {tNow('新建')}
                  </td>
                </tr>
              )}
              {/* 计算行：哪一列选了「算什么」才有（小样的表底下直接是那句说明，不留一条空行）；从列头菜单「计算…」选 */}
              {sums && (
                <tr className="base-sums">
                  {spec.columns.map((c) => {
                    const id = spec.summaries[c]
                    const value = id && ctx && res ? sumText(summaryOf(ctx, res.rows, c, id, kindOf(c))) : ''
                    const open = pop?.kind === 'sum' && pop.col === c
                    return (
                      <td key={c} className={(id ? 'on-sum' : '') + (open ? ' on' : '')} data-col={c}>
                        <button type="button" className="base-sum" aria-label={tNow('{name} 算什么', { name: colName(c) })} aria-expanded={open} onClick={(e) => setPop(open ? null : { kind: 'sum', col: c, at: atOf(e.currentTarget) })}>
                          {id ? (
                            <>
                              <span className="k">{calcShort(id, kindOf(c))}</span>
                              <span className="v num">{value}</span>
                            </>
                          ) : (
                            <span className="k">
                              {tNow('计算')}
                              <Codicon name="chevron-down" size={12} />
                            </span>
                          )}
                        </button>
                      </td>
                    )
                  })}
                  <td className="base-td-plus" />
                </tr>
              )}
            </tfoot>
          </table>
        </div>
        {(limit === Infinity) === full && popover}
        {ctx && <RelationIssues ctx={ctx} />}
        <div className="base-foot">
          {data === null
            ? tNow('正在读…')
            : [outs ? tNow('另有{n}条刚建的不在筛选里', { n: outs }) : '', rows.length > limit ? tNow('这里只列前{n}条，整页打开看全部', { n: limit }) : '', props.foot ?? tNow('每条是「{folder}」里的一篇笔记', { folder: spec.folder })].filter(Boolean).join(' · ')}
        </div>
      </>
    )
  }

  /** 块窄于 560：视图标签收成下拉、分组筛选排序只留图标（量没缩放的宽，白板缩放不改） */
  const [narrow, setNarrow] = useState(false)
  const views = useViewBar({
    doc,
    vi,
    folder: doc.folder,
    ctx,
    res,
    narrow: narrow && !full,
    pop,
    setPop,
    save: saveSrc,
    table: me,
    // 「隐藏了 N 列」只对表格有意思（看板、日历、画廊不按列摆）
    lead:
      view.kind === 'table' && hiddenCols.length > 0 ? (
        <button
          type="button"
          className="base-tb"
          aria-label={tNow('隐藏了 {n} 列', { n: hiddenCols.length })}
          data-tip={tNow('隐藏的列')}
          aria-expanded={pop?.kind === 'hidden'}
          onClick={(e) => setPop(pop?.kind === 'hidden' ? null : { kind: 'hidden', at: atOf(e.currentTarget) })}
        >
          <Codicon name="eye-closed" size={14} />
          <span>{hiddenCols.length}</span>
        </button>
      ) : undefined,
  })

  /** 第一行上现在有的、能收进「⋯」的几样 */
  const foldable: FoldKey[] = ['auto', 'raw', 'full', 'count']
  /** 白板上展开的数据库卡：「自动化」一直收在「⋯」里（卡窄，块头只留要紧的） */
  const onBoard = !!props.extra
  useAuto()
  const autoOn = rulesOf(props.src).filter((r) => r.on).length
  const autoShown = autoOpenNow()?.folder === spec.folder && !!spec.folder
  const showAuto = () => spec.folder && openAuto({ table: me, folder: spec.folder })
  const foldIn = useFold(foldable)
  const foldFull = useFold(foldable)
  const countText = data ? (data.hidden ? tNow('{n} 条 · 筛掉 {m} 条', { n: data.rows.length, m: data.hidden }) : tNow('{n} 条', { n: data.rows.length })) : ''

  /** 「⋯」：第一行上放不下、收起来的几样（系统菜单，不会被栏边截掉） */
  const moreMenu = (inFull: boolean, folded: FoldKey[]) => {
    const has = (k: FoldKey) => folded.includes(k)
    void showMenu([
      has('count') && { label: countText, enabled: false, run: () => undefined },
      '-',
      (has('auto') || onBoard) && { label: autoOn ? tNow('自动化 · 开着 {n} 条', { n: autoOn }) : tNow('自动化'), run: showAuto },
      has('full') && (inFull ? { label: tNow('收回文档里'), run: () => setFull(false) } : { label: tNow('整页打开'), run: () => (setPop(null), setFull(true)) }),
      has('raw') && !inFull && { label: tNow('改写法'), checked: raw, run: () => setRaw((x) => !x) },
    ])
  }

  /**
   * 块头第一行（38 高，不折行）：database 图标、名字（放不下省略号，悬停看全名）、「N 条 · 筛掉 M 条」…… 整页打开、改写法、新一条。
   * 窄的时候放不下的从「改写法」起依次收进「⋯」，「新一条」一直露着（task-c22p9：以前挤成一字一行）
   */
  const head = (inFull: boolean) => {
    const fold = inFull ? foldFull : foldIn
    const shown = (k: FoldKey) => !fold.folded.includes(k)
    return (
      <div className="base-top" ref={fold.ref}>
        <Codicon name="database" size={15} />
        <b data-tip={name}>{name}</b>
        {shown('count') && (
          <span className="base-count" data-fold="count">
            {countText}
          </span>
        )}
        <span className="sp" />
        {shown('full') &&
          (inFull ? (
            <button type="button" className="base-btn" data-fold="full" aria-label={tNow('收回文档里')} data-tip={tNow('收回文档里 · esc')} onClick={() => setFull(false)}>
              <Codicon name="screen-normal" size={14} />
            </button>
          ) : (
            <button type="button" className="base-btn" data-fold="full" aria-label={tNow('整页打开')} data-tip={tNow('整页打开')} onClick={() => (setPop(null), setFull(true))}>
              <Codicon name="screen-full" size={14} />
            </button>
          ))}
        {shown('auto') && !(onBoard && !inFull) && (
          <button type="button" className={'base-btn base-auto' + (autoShown ? ' on' : '')} data-fold="auto" /* 不翻：data-part 给 e2e 和样式认 */ data-part="自动化入口" aria-label={tNow('自动化')} onClick={showAuto} disabled={!spec.folder}>
            <Codicon name="symbol-event" size={14} />
            <span className="lb">{tNow('自动化')}</span>
            {autoOn > 0 && <span className="cnt">{autoOn}</span>}
          </button>
        )}
        {!inFull && shown('raw') && (
          <button type="button" className={'base-raw' + (raw ? ' on' : '')} data-fold="raw" aria-pressed={raw} onClick={() => setRaw((x) => !x)}>
            <Codicon name="code" size={14} />
            {tNow('改写法')}
          </button>
        )}
        {(fold.folded.length > 0 || (onBoard && !inFull)) && (
          <button type="button" className="base-btn base-more" data-more="" aria-label={tNow('工具条上放不下的')} data-tip={tNow('更多')} onClick={() => moreMenu(inFull, fold.folded)}>
            <Codicon name="ellipsis" size={14} />
          </button>
        )}
        {/* 改写法开着时只留「完成」一颗实心按钮：「新一条」先收起来 */}
        {!(raw && !inFull) && (
          <button
            type="button"
            className="base-new"
            // 手快双击（第 4 轮：多出一条空的「未命名」，名字只给了第二条）：第二下不建、也不抢走起名框的焦点
            onMouseDown={(e) => e.detail > 1 && e.preventDefault()}
            onClick={(e) => e.detail <= 1 && void add()}
            disabled={!spec.folder}
          >
            <Codicon name="add" size={14} />
            {tNow('新一条')}
          </button>
        )}
        {!inFull && props.extra}
      </div>
    )
  }

  // 点浮层外面收起
  const rootRef = useRef<HTMLDivElement>(null)
  const fullRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!pop) return
    const down = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      // 第二行的标签、分组筛选排序、小标签自己开关浮层
      if (t.closest?.('.base-pop, .base-th, .base-vbar, .base-cbar')) return
      setPop(null)
    }
    // 浮层是贴着按钮的固定位置：文档一滚就收起，不飘在别处
    const scroll = (e: Event) => !(e.target as HTMLElement).closest?.('.base-pop') && Date.now() - selfScroll.current > 300 && setPop(null)
    document.addEventListener('mousedown', down, true)
    window.addEventListener('scroll', scroll, true)
    return () => (document.removeEventListener('mousedown', down, true), window.removeEventListener('scroll', scroll, true))
  }, [pop])
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const read = () => el.offsetWidth && setNarrow(el.offsetWidth < NARROW)
    const ro = new ResizeObserver(read)
    ro.observe(el)
    read()
    return () => ro.disconnect()
  }, [])

  const pane = props.anchor.closest('.pane')
  // 看法分派（数据库第三批第 2 块）：看板 / 日历 / 画廊由 BaseLayout 画，表格照旧；看哪个是视图标签条上的当前视图（第 3 块）
  const layout = isLayoutView(view.kind)
  const body = (limit: number) =>
    layout ? (
      <>
        <BaseLayout src={props.src} ctx={ctx} view={vi} from={me} full={limit === Infinity} onCell={props.onCell} />
        <div className="base-foot">{props.foot ?? tNow('每条是「{folder}」里的一篇笔记', { folder: spec.folder })}</div>
      </>
    ) : (
      table(limit)
    )
  return (
    <div className="base" /* 不翻：data-part 给 e2e 和样式认 */ data-part="数据库块" ref={rootRef}>
      {head(false)}
      {views.bar}
      {!raw && views.chips}
      {!full && views.popover}
      {raw && <RawYaml src={props.src} onDone={(y) => (setRaw(false), y !== props.src && edit.src(() => y))} onCancel={() => setRaw(false)} />}
      {spec.folder ? body(INLINE_ROWS) : <div className="base-foot">{tNow('这个数据库没写数据源：点「改写法」加一行 file.inFolder("文件夹")')}</div>}
      {full &&
        pane &&
        createPortal(
          <div className="base base-full" role="dialog" aria-label={tNow('数据库 {name}', { name })} ref={fullRef}>
            {head(true)}
            {views.bar}
            {views.chips}
            {views.popover}
            {body(Infinity)}
          </div>,
          pane,
        )}
    </div>
  )
}

/**
 * 正在改的一格（文字、数字、链接）：回车、Tab 存，Esc 不存（都回到选中，grid-focus 的 editKey），点别处也存。
 * 同一个框只交一次（回车收起时还会再来一次失焦）
 */
function CellInput(props: { label: string; type: 'text' | 'number'; value: string; onDone(v: string, how: 'commit' | 'cancel' | 'next' | 'prev' | 'blur', el: HTMLInputElement): void | false }) {
  const done = useRef(false)
  const finish = (el: HTMLInputElement, how: 'commit' | 'cancel' | 'next' | 'prev' | 'blur') => {
    if (done.current) return
    done.current = true
    // 交回 false：这个值不收（不是数），框留着改
    if (props.onDone(el.value.trim(), how, el) === false) {
      done.current = false
      el.select()
    }
  }
  return (
    <input
      className="base-in"
      autoFocus
      // 数字不用浏览器的 type=number（↑ ↓、滚轮会悄悄加减，base-number-keys）
      {...(props.type === 'number' ? NUM_INPUT : { type: 'text' })}
      defaultValue={props.value}
      aria-label={props.label}
      onKeyDown={(e) => {
        e.stopPropagation()
        const how = editKey(e)
        if (!how) return
        e.preventDefault()
        finish(e.currentTarget, how)
      }}
      onInput={props.type === 'number' ? clearBad : undefined}
      onBlur={(e) => finish(e.currentTarget, 'blur')}
    />
  )
}

/** 列菜单最上面：就地改列名（回车、离开就改，esc 不改） */
function ColRename(props: { name: string; onDone(v: string): void }) {
  const done = useRef(false)
  const finish = (v: string) => {
    if (done.current) return
    done.current = true
    if (v.trim() && v.trim() !== props.name) props.onDone(v)
  }
  return (
    <input
      className="base-colname"
      aria-label={tNow('列名')}
      defaultValue={props.name}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (composing(e)) return
        if (e.key === 'Enter') finish(e.currentTarget.value)
        if (e.key === 'Escape') (done.current = true), e.currentTarget.blur()
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
  )
}

/** 选项、多选的格子：一排已有的值（小色块）+ 搜索框，打一个新的回车就建；多选能勾几个 */
function Options(props: { at: At; multi: boolean; label: string; values: string[]; picked: string[]; onChange(vs: string[], close: boolean): void }) {
  useLang()
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState(props.picked)
  const list = props.values.filter((v) => !q.trim() || v.toLowerCase().includes(q.trim().toLowerCase()))
  const fresh = q.trim() && !props.values.some((v) => v === q.trim()) ? q.trim().replace(/[,[\]]/g, ' ').trim() : ''
  /** 能用 ↑ ↓ 挑的几项（task-cle3x，照 Notion）：列出来的值，最后是「建一个」；回车选亮着的那一项，没挪过时亮着的是「建一个」或第一项 */
  const items = [...list, ...(fresh ? [fresh] : [])]
  const [hi, setHi] = useState(-1)
  const on = hi >= 0 && hi < items.length ? hi : fresh ? items.length - 1 : items.length ? 0 : -1
  const pick = (v: string) => {
    if (!props.multi) return props.onChange([v], true)
    const next = picked.includes(v) ? picked.filter((x) => x !== v) : [...picked, v]
    setPicked(next)
    props.onChange(next, false)
  }
  return (
    <FloatPop at={props.at} className="base-pop base-options" role="dialog" aria-label={props.label}>
      <div className="base-picked">
        {picked.map((v) => (
          <span key={v} className={'base-sel ' + toneOf(v)}>
            {v}
            <button type="button" aria-label={tNow('去掉 {name}', { name: v })} onClick={() => (props.multi ? pick(v) : props.onChange([], true))}>
              <Codicon name="close" size={10} />
            </button>
          </span>
        ))}
        <input
          autoFocus
          aria-label={tNow('找一个，或者打一个新的')}
          placeholder={picked.length ? '' : tNow('找一个，或者打一个新的')}
          value={q}
          onChange={(e) => (setQ(e.currentTarget.value), setHi(-1))}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (composing(e)) return
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              if (items.length) setHi((on + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length)
            }
            if (e.key === 'Enter') {
              const v = items[on]
              if (v) (pick(v), setQ(''), setHi(-1))
            }
          }}
        />
      </div>
      <div className="hd">{props.multi ? tNow('选几个，或者建一个') : tNow('选一个，或者建一个')}</div>
      {list.map((v, i) => (
        <button key={v} type="button" role={props.multi ? 'menuitemcheckbox' : 'menuitemradio'} aria-checked={picked.includes(v)} className={i === on ? 'kb' : undefined} onMouseEnter={() => setHi(i)} onClick={() => pick(v)}>
          <span className={'base-sel ' + toneOf(v)}>{v}</span>
          {picked.includes(v) && <Codicon name="check" size={14} />}
        </button>
      ))}
      {fresh && (
        <button type="button" role="menuitem" className={on === items.length - 1 ? 'kb' : undefined} onMouseEnter={() => setHi(items.length - 1)} onClick={() => (pick(fresh), setQ(''))}>
          <span className="new">{tNow('建一个')}</span>
          <span className={'base-sel ' + toneOf(fresh)}>{fresh}</span>
        </button>
      )}
    </FloatPop>
  )
}

/** 改写法：只在这一块露出 YAML（文本框 +「只在这一块里露出写法 · esc 收回」+「完成」） */
/** filters 里最后一条不是数据源（file.inFolder）的条件：「改写法」打开时选中它 */
function lastCondition(src: string): { from: number; to: number } | null {
  const f = /^filters:\n((?:[ \t]+.*(?:\n|$))*)/m.exec(src)
  if (!f) return null
  const start = f.index + 'filters:\n'.length
  let hit: { from: number; to: number } | null = null
  for (const m of f[1]!.matchAll(/^([ \t]*- )(.+)$/gm)) {
    const v = m[2]!.trim()
    if (/^file\.inFolder\(/.test(v) || /^(and|or|not):$/.test(v)) continue
    const from = start + m.index! + m[1]!.length
    hit = { from, to: from + m[2]!.length }
  }
  return hit
}

function RawYaml(props: { src: string; onDone(y: string): void; onCancel(): void }) {
  useLang()
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const t = ref.current
    if (!t) return
    t.focus()
    // 照小样：光标落在最后一条筛选条件上（选中它，直接打字就改），没有条件就在最前面
    const sel = lastCondition(props.src)
    t.setSelectionRange(sel?.from ?? 0, sel?.to ?? 0)
  }, [])
  return (
    <div className="cm-raw base-rawbox" /* 不翻：data-part 给 e2e 和样式认 */ data-part="改写法">
      <textarea
        ref={ref}
        className="cm-raw-text"
        spellCheck={false}
        aria-label={tNow('这一块的写法')}
        defaultValue={props.src}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (composing(e)) return
          if (e.key === 'Escape') (e.preventDefault(), props.onCancel())
          else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.preventDefault(), props.onDone(e.currentTarget.value))
        }}
      />
      <div className="cm-raw-foot">
        <span>{RAW_HINT}</span>
        <button type="button" className="cm-raw-done" onMouseDown={(e) => e.preventDefault()} onClick={() => props.onDone(ref.current?.value ?? props.src)}>
          {tNow('完成')}
        </button>
      </div>
    </div>
  )
}
