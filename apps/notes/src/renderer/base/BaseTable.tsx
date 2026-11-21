/**
 * 文档里的数据库（CN-19 A，2026-11-18 照 Notion 做全）：```base 代码块画成一张卡（样子照文档方向 A 的小样）。
 * 头一行：database 图标 + 名字 + 「表格 · N 条」+ 排序、筛选小标签 …… 筛选、整页打开、改写法、新一条。
 * 每一行是文件夹里的一篇 md，每一列是它 frontmatter 里的一个属性：
 * - 表头最右「+」加一列：起名字、选类型（文字、数字、选项、多选、日期、勾选、链接）；
 * - 点列头出菜单：改名（每一条的属性一起改）、类型、升序 / 降序、按这一列筛选、计算、左边插入 / 右边插入、隐藏、删除（每一条里的这一项一起删）；
 * - 拖列头右边的缝改列宽、按住列头左右拖换顺序；列宽、顺序、类型、计算都写回代码块（同 Obsidian Bases 的 columnSize、summaries）；
 * - 格子里直接改：文字、数字、链接是输入框，选项、多选是一排小色块（能新建），日期是日期框，勾选是勾选框；写回那一篇的 frontmatter；
 * - 表底「+ 新建」一行：建一篇、名字格直接起名；再下面一行是计算（点了选求和、平均……）；
 * - 「改写法」：只在这一块露出 YAML（方向 A「块上露写法」），「完成」写回，esc 收回。
 * 量大时文档里只铺前 50 条（`别把上万条全铺开`），整页打开看全部。写法同 Obsidian Bases，见 packages/format/src/base.ts。
 */
import { Codicon, type CodiconName } from '@cn/design'
import {
  BASE_OPS,
  type BaseCond,
  type BaseRow,
  baseRows,
  type BaseSpec,
  clearBaseSort,
  COL_TYPES,
  colType,
  type ColType,
  condLabel,
  dropBaseProp,
  HIDDEN_KEYS,
  listOf,
  listText,
  renameBaseProp,
  renameProp,
  setBaseColSize,
  setBaseColType,
  setBaseOrder,
  setBaseSummary,
  setProp,
  SUMMARIES,
  summarize,
} from '@cn/format'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { nameNotice, safeName } from '../../shared/file-name'
import { nameFromTitle } from '../title-follow'
import { titleOf } from '../../shared/layout'
import { app } from '../ctx/actions'
import { RAW_HINT } from '../block-source'
import { composing } from '../ime'

/** 列的类型图标（照 Notion：选项是带下拉的圆圈、多选是列表，两个分得开） */
const ICON: Record<ColType, CodiconName> = { text: 'symbol-string', select: 'arrow-circle-down', multi: 'list-unordered', number: 'symbol-numeric', date: 'calendar', check: 'check', url: 'link' }
const TYPE_NAME = Object.fromEntries(COL_TYPES.map((c) => [c.type, c.label])) as Record<ColType, string>
const INLINE_ROWS = 50

const colName = (c: string) => (c === 'file.name' ? '名字' : c.replace(/^note\./, ''))

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
}

async function load(spec: BaseSpec): Promise<Loaded> {
  if (!spec.folder) return { rows: [], hidden: 0, texts: new Map(), all: [] }
  const files = (await window.cn.listNotes()).filter((f) => f.path.startsWith(spec.folder + '/') && /\.md$/i.test(f.path))
  const notes = await Promise.all(files.map(async (f) => ({ path: f.path, text: (await window.cn.readNote(f.path)).text })))
  const rows = baseRows(spec, notes)
  const all = baseRows({ ...spec, conds: [] }, notes)
  return { rows, hidden: rows.hidden ?? 0, texts: new Map(notes.map((n) => [n.path, n.text])), all }
}

/**
 * 软件自己改了数据库里的几条（这一张表里改格子、改列名）：同一个数据库别处画着的表（白板上展开的、文档里的、嵌在别处的）跟着重读。
 * 自己写的文件不会再来「外面改了」的通知，所以另发一个
 */
export const BASE_WROTE = 'cn-base-wrote'
export const baseWrote = (folder: string | null) => folder && window.dispatchEvent(new CustomEvent(BASE_WROTE, { detail: folder }))

export interface BaseEdits {
  sort(prop: string, desc: boolean): void
  filters(match: 'and' | 'or', conds: BaseCond[]): void
  order(columns: string[]): void
  /** 代码块里的 YAML 换成 next 算出来的（列的类型、列宽、计算、改名、删列、改写法） */
  src(next: (src: string) => string): void
}

/** 一条筛选的草稿：还没填值的也留在面板里，填好了才写回 */
interface Draft {
  prop: string
  op: BaseCond['op']
  value: string
}

/** 浮层的位置（position: fixed，窗口坐标）：文档短时编辑器的滚动区会把往下伸的浮层裁掉 */
interface At {
  left: number
  top: number
  right: number
}

const atOf = (el: HTMLElement): At => {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.bottom + 4, right: window.innerWidth - r.right }
}

const complete = (d: Draft, type: ColType) => !(BASE_OPS[type].find((o) => o.op === d.op)?.value ?? true) || d.value.trim() !== ''

type Pop =
  | { kind: 'filter'; at: At }
  | { kind: 'sort'; at: At }
  | { kind: 'col'; col: string; at: At }
  | { kind: 'hidden'; at: At }
  | { kind: 'add'; at: At; index: number }
  | { kind: 'sum'; col: string; at: At }
  | { kind: 'options'; path: string; col: string; at: At }
  | { kind: 'drop'; col: string; at: At }

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
 * extra：块头最右边多放的（白板上展开的数据库卡放「收起」）；foot：表底那一句换成这句；onCell：改好一格以后
 */
export function BaseTable(props: { spec: BaseSpec; src: string; edit: BaseEdits; anchor: HTMLElement; extra?: React.ReactNode; foot?: string; onCell?(w: BaseCellWrite): void }) {
  const { spec, edit } = props
  const [data, setData] = useState<Loaded | null>(null)
  const [full, setFull] = useState(false)
  const [editing, setEditing] = useState<{ path: string; col: string } | null>(null)
  const [tick, setTick] = useState(0)
  const [pop, setPop] = useState<Pop | null>(null)
  const [drafts, setDrafts] = useState<Draft[]>([])
  /** 改写法开着：这一块露出 YAML */
  const [raw, setRaw] = useState(false)
  /** 正在拖的列宽（松手写回 columnSize） */
  const [sizing, setSizing] = useState<{ col: string; w: number } | null>(null)
  /** 正在拖着换顺序的那一列、落在第几列前面 */
  const [moving, setMoving] = useState<{ col: string; to: number } | null>(null)
  const key = JSON.stringify(spec)

  useEffect(() => {
    let live = true
    void load(spec).then((d) => live && setData(d))
    return () => void (live = false)
  }, [key, tick])
  useEffect(() => {
    const again = () => setTick((t) => t + 1)
    const off1 = window.cn.onFilesChanged(again)
    const off2 = window.cn.onNoteChanged((p) => spec.folder && p.startsWith(spec.folder + '/') && again())
    const wrote = (e: Event) => (e as CustomEvent<string>).detail === spec.folder && again()
    window.addEventListener(BASE_WROTE, wrote)
    return () => (off1(), off2(), window.removeEventListener(BASE_WROTE, wrote))
  }, [key])
  useEffect(() => {
    if (!full && !pop) return
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || composing(e)) return
      e.preventDefault()
      e.stopPropagation()
      if (pop) setPop(null)
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
  const types = useMemo(() => Object.fromEntries([...new Set([...spec.columns, ...allProps])].map((c) => [c, typeOf(c)])) as Record<string, ColType>, [data, key])
  const valuesOf = (c: string) => {
    const t = types[c]
    const vs = (data?.all ?? []).flatMap((r) => (c === 'file.name' ? [r.name] : t === 'multi' ? listOf(r.props[c] ?? '') : [r.props[c] ?? '']))
    return [...new Set(vs.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh'))
  }
  const hiddenCols = allProps.filter((p) => !spec.columns.includes(p))

  const name = spec.folder ? spec.folder.split('/').pop()! : '数据库'

  /** 改一格：写进那一篇的 frontmatter（多选写成一行 [a, b]） */
  const save = async (r: BaseRow, col: string, value: string) => {
    setEditing(null)
    const old = data?.texts.get(r.path)
    if (old === undefined || (r.props[col] ?? '') === value) return
    const next = setProp(old, col, value === '' ? undefined : value, { raw: types[col] === 'multi' })
    const w = await window.cn.writeNote(r.path, next, old)
    if (!w.ok) app().notice(`《${r.name}》刚被别处改过，没改成，再试一次`)
    else {
      props.onCell?.({ path: r.path, name: r.name, col, value, before: old, after: next })
      baseWrote(spec.folder)
    }
    setTick((t) => t + 1)
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
    if (missed) app().notice(`有 ${missed} 条刚被别处改过，没改成，再试一次`)
    baseWrote(spec.folder)
    setTick((t) => t + 1)
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
    return (el: HTMLDivElement | null) => {
      ro?.disconnect()
      ro = null
      if (!el) return
      const read = () => setRoom((r) => (r[key] === el.clientWidth ? r : { ...r, [key]: el.clientWidth }))
      ro = new ResizeObserver(read)
      ro.observe(el)
      read()
    }
  }
  const inlineRoom = useMemo(() => roomRef('inline'), [])
  const fullRoom = useMemo(() => roomRef('full'), [])
  const widthsOf = (root: HTMLElement | null) => {
    const ths = root?.querySelectorAll<HTMLElement>(':scope .base-scroll > table > thead th')
    return ths?.length ? [...ths].map((th) => th.getBoundingClientRect().width) : undefined
  }
  /** 正在建（主进程还没回话）：这时再点不再建一条 */
  const creating = useRef(false)
  const add = async () => {
    if (!spec.folder || creating.current) return
    setLock({ cols: spec.columns.join('\n'), inline: widthsOf(rootRef.current), full: widthsOf(fullRef.current) })
    creating.current = true
    let p: string
    try {
      p = await window.cn.createNote(spec.folder, '未命名', '')
    } finally {
      creating.current = false
    }
    setAdded((a) => [...a, p])
    setTick((t) => t + 1)
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
      const said = nameNotice(name, titleOf(to), '条', safeName(file))
      if (said) app().notice(said)
    } catch (e) {
      app().notice(String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
    setTick((t) => t + 1)
  }

  // ----- 筛选 -----
  const openFilter = (col?: string) => {
    const ds: Draft[] = spec.conds.map((c) => ({ ...c }))
    if (col) ds.push({ prop: col, op: BASE_OPS[types[col] ?? 'text'][0]!.op, value: types[col] === 'check' ? 'true' : '' })
    if (!ds.length) ds.push({ prop: spec.columns.find((c) => c !== 'file.name') ?? allProps[0] ?? 'file.name', op: '==', value: '' })
    setDrafts(ds)
    const btn = (full ? fullRef : rootRef).current?.querySelector<HTMLElement>('.base-filter-wrap button') ?? null
    setPop({ kind: 'filter', at: btn ? atOf(btn) : { left: 0, top: 120, right: 24 } })
  }
  const openSort = () => {
    const btn = (full ? fullRef : rootRef).current?.querySelector<HTMLElement>('.base-sort-btn') ?? null
    setPop({ kind: 'sort', at: btn ? atOf(btn) : { left: 0, top: 120, right: 24 } })
  }
  const writeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  /** 草稿变了：填好的那几条写回代码块（打字时停手 300 毫秒再写） */
  const changeDrafts = (ds: Draft[], match = spec.match, wait = 0) => {
    setDrafts(ds)
    clearTimeout(writeTimer.current)
    const conds = ds.filter((d) => complete(d, types[d.prop] ?? 'text')).map((d) => ({ prop: d.prop, op: d.op, value: d.value.trim() }))
    const run = () => {
      if (JSON.stringify(conds) !== JSON.stringify(spec.conds) || match !== spec.match) edit.filters(match, conds)
    }
    if (wait) writeTimer.current = setTimeout(run, wait)
    else run()
  }
  useEffect(() => () => clearTimeout(writeTimer.current), [])
  const removeCond = (i: number) => edit.filters(spec.match, spec.conds.filter((_, k) => k !== i))

  // ----- 列 -----
  const hideCol = (c: string) => edit.order(spec.columns.filter((x) => x !== c))
  const showCol = (c: string) => edit.order([...spec.columns, c])
  /** 新的一列：起个不重名的名字，插在第 index 列前面，类型照选的 */
  const freshName = (base = '新的一列') => {
    const taken = new Set([...spec.columns, ...allProps])
    let n = base
    for (let k = 2; taken.has(n); k++) n = `${base} ${k}`
    return n
  }
  const addCol = (colNameIn: string, type: ColType, index: number) => {
    const n = colNameIn.trim().replace(/:/g, '：')
    if (!n || n === 'file.name') return
    if (spec.columns.includes(n)) return app().notice(`已经有一列叫「${n}」了`)
    const cols = [...spec.columns]
    cols.splice(Math.max(1, Math.min(index, cols.length)), 0, n)
    edit.src((src) => setBaseColType(setBaseOrder(src, cols), n, type))
    setPop(null)
  }
  /** 改列名：每一条的这一项改名，代码块里用到它的地方一起换 */
  const renameCol = async (from: string, toIn: string) => {
    const to = toIn.trim().replace(/:/g, '：')
    if (!to || to === from || from === 'file.name') return
    if (spec.columns.includes(to) || allProps.includes(to)) return app().notice(`已经有一列叫「${to}」了`)
    await eachRow((t) => renameProp(t, from, to))
    edit.src((src) => renameBaseProp(src, from, to))
  }
  /** 删一列：每一条里的这一项一起删（Git 里能找回），代码块里也拿掉 */
  const dropCol = async (c: string) => {
    setPop(null)
    await eachRow((t) => setProp(t, c, undefined))
    edit.src((src) => dropBaseProp(src, c))
  }
  const setType = (c: string, t: ColType) => {
    setPop(null)
    edit.src((src) => setBaseColType(src, c, t))
  }
  const setSummary = (c: string, id: string | null) => {
    setPop(null)
    edit.src((src) => setBaseSummary(src, c, id))
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
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      setSizing(null)
      if (Math.abs(w - w0) >= 2) edit.src((src) => setBaseColSize(src, c, w))
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
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
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      setMoving(null)
      if (!started || to === -1) return
      const cols = spec.columns.filter((x) => x !== c)
      const from = spec.columns.indexOf(c)
      cols.splice(to > from ? to - 1 : to, 0, c)
      if (cols.join('\n') !== spec.columns.join('\n')) edit.order(cols)
      // 拖过了就不算点（不弹列菜单）
      suppressClick.current = true
      setTimeout(() => (suppressClick.current = false), 0)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  const suppressClick = useRef(false)

  // ----- 浮层 -----
  const colMenu = (c: string, at: At) => {
    const s = spec.sort.find((x) => x.prop === c)
    const t = types[c] ?? 'text'
    return (
      <div className="base-pop base-colmenu" style={{ top: at.top, left: at.left }} role="menu" aria-label={`${colName(c)} 这一列`}>
        {c !== 'file.name' && <ColRename name={c} onDone={(v) => (setPop(null), void renameCol(c, v))} />}
        {c !== 'file.name' && (
          <div className="base-sub" role="group" aria-label="类型">
            <div className="hd">类型</div>
            <div className="base-types">
              {COL_TYPES.map((ct) => (
                <button key={ct.type} type="button" role="menuitemradio" aria-checked={t === ct.type} className={t === ct.type ? 'on' : ''} onClick={() => setType(c, ct.type)}>
                  <Codicon name={ICON[ct.type]} size={14} />
                  <span>{ct.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {c !== 'file.name' && <div className="sep" />}
        <button type="button" role="menuitemcheckbox" aria-checked={!!s && !s.desc} onClick={() => (setPop(null), edit.sort(c, false))}>
          <Codicon name="arrow-up" size={14} />
          <span>升序</span>
          {s && !s.desc && <Codicon name="check" size={14} />}
        </button>
        <button type="button" role="menuitemcheckbox" aria-checked={!!s?.desc} onClick={() => (setPop(null), edit.sort(c, true))}>
          <Codicon name="arrow-down" size={14} />
          <span>降序</span>
          {s?.desc && <Codicon name="check" size={14} />}
        </button>
        {!spec.filtersLocked && (
          <button type="button" role="menuitem" onClick={() => openFilter(c)}>
            <Codicon name="filter" size={14} />
            <span>按这一列筛选…</span>
          </button>
        )}
        <button type="button" role="menuitem" onClick={(e) => setPop({ kind: 'sum', col: c, at: atOf(e.currentTarget) })}>
          <Codicon name="symbol-operator" size={14} />
          <span>{spec.summaries[c] ? '计算：' + (SUMMARIES[t].find((x) => x.id === spec.summaries[c])?.label ?? spec.summaries[c]) : '计算…'}</span>
        </button>
        <div className="sep" />
        <button type="button" role="menuitem" onClick={(e) => setPop({ kind: 'add', at: atOf(e.currentTarget), index: Math.max(1, spec.columns.indexOf(c)) })}>
          <Codicon name="arrow-left" size={14} />
          <span>左边插入一列</span>
        </button>
        <button type="button" role="menuitem" onClick={(e) => setPop({ kind: 'add', at: atOf(e.currentTarget), index: spec.columns.indexOf(c) + 1 })}>
          <Codicon name="arrow-right" size={14} />
          <span>右边插入一列</span>
        </button>
        {c !== 'file.name' && (
          <>
            <button type="button" role="menuitem" onClick={() => (setPop(null), hideCol(c))}>
              <Codicon name="eye-closed" size={14} />
              <span>隐藏这一列</span>
            </button>
            <button type="button" role="menuitem" className="danger" onClick={(e) => setPop({ kind: 'drop', col: c, at: atOf(e.currentTarget) })}>
              <Codicon name="trash" size={14} />
              <span>删除这一列</span>
            </button>
          </>
        )}
      </div>
    )
  }

  const popover = (() => {
    if (!pop) return null
    if (pop.kind === 'hidden')
      return (
        <div className="base-pop base-colmenu" style={{ top: pop.at.top, right: pop.at.right, left: 'auto' }} role="menu" aria-label="隐藏的列">
          <div className="hd">勾上就显示</div>
          {hiddenCols.map((c) => (
            <button key={c} type="button" role="menuitemcheckbox" aria-checked={false} onClick={() => (setPop(null), showCol(c))}>
              <Codicon name={ICON[types[c] ?? 'text']} size={14} />
              <span>{colName(c)}</span>
            </button>
          ))}
        </div>
      )
    if (pop.kind === 'col') return colMenu(pop.col, pop.at)
    if (pop.kind === 'add') return <AddCol at={pop.at} name={freshName()} onAdd={(n, t) => addCol(n, t, pop.index)} />
    if (pop.kind === 'drop')
      return (
        <div className="base-pop base-confirm" style={{ top: pop.at.top, left: pop.at.left }} role="dialog" aria-label="删掉这一列">
          <b>{`删掉「${colName(pop.col)}」这一列？`}</b>
          <p>{`每一条里的「${colName(pop.col)}」都会删掉，Git 里能找回。`}</p>
          <div className="row">
            <button type="button" className="btn btn-sm" onClick={() => setPop(null)}>
              取消
            </button>
            <button type="button" className="btn btn-sm btn-danger" onClick={() => void dropCol(pop.col)}>
              删除
            </button>
          </div>
        </div>
      )
    if (pop.kind === 'sum') {
      const t = types[pop.col] ?? 'text'
      const cur = spec.summaries[pop.col]
      return (
        <div className="base-pop base-colmenu" style={{ top: pop.at.top, left: pop.at.left }} role="menu" aria-label={`${colName(pop.col)} 算什么`}>
          <button type="button" role="menuitemradio" aria-checked={!cur} onClick={() => setSummary(pop.col, null)}>
            <span>不算</span>
            {!cur && <Codicon name="check" size={14} />}
          </button>
          {SUMMARIES[t].map((s) => (
            <button key={s.id} type="button" role="menuitemradio" aria-checked={cur === s.id} onClick={() => setSummary(pop.col, s.id)}>
              <span>{s.label}</span>
              {cur === s.id && <Codicon name="check" size={14} />}
            </button>
          ))}
        </div>
      )
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
            if (close) setPop(null)
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
    if (t === 'date') return v.slice(0, 10)
    if (t === 'url' && v)
      return (
        <a
          className="base-url"
          href={v}
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
    const widthOf = (c: string, i: number) => (sizing?.col === c ? sizing.w : (locked?.[i] ?? spec.sizes[c] ?? (c === 'file.name' ? 200 : 140)))
    const fixed = true
    const shown = [...rows.slice(0, limit), ...outRows]
    const sums = spec.columns.some((c) => spec.summaries[c])
    return (
      <>
        <div className="base-scroll" ref={limit === Infinity ? fullRoom : inlineRoom}>
          <table className={fixed ? 'fixed' : undefined}>
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
                  const t = types[c] ?? 'text'
                  return (
                    <th key={c} className={'col' + (open ? ' on' : '') + (moving?.col === c ? ' moving' : '') + (moving && moving.to === i ? ' drop-before' : '') + (moving && moving.to === spec.columns.length && i === spec.columns.length - 1 ? ' drop-after' : '')}>
                      <button
                        type="button"
                        className="base-th"
                        aria-haspopup="menu"
                        aria-expanded={open}
                        onMouseDown={(e) => startMove(e, c)}
                        onClick={(e) => !suppressClick.current && setPop(open ? null : { kind: 'col', col: c, at: atOf(e.currentTarget) })}
                      >
                        <Codicon name={ICON[t]} size={12} />
                        <span>{colName(c)}</span>
                        {s && <Codicon name={s.desc ? 'arrow-down' : 'arrow-up'} size={12} />}
                      </button>
                      <span className="base-size" role="separator" aria-label={`拖动改「${colName(c)}」的列宽`} onMouseDown={(e) => startSize(e, c)} />
                    </th>
                  )
                })}
                <th className="base-th-plus">
                  <button
                    type="button"
                    className="base-th base-add-col"
                    aria-label="加一列"
                    data-tip="加一列"
                    aria-expanded={pop?.kind === 'add'}
                    onClick={(e) => setPop(pop?.kind === 'add' ? null : { kind: 'add', at: atOf(e.currentTarget), index: spec.columns.length })}
                  >
                    <Codicon name="add" size={14} />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.path} className={rows.includes(r) ? undefined : 'base-row-out'}>
                  {spec.columns.map((c) => {
                    if (c === 'file.name' && editing?.path === r.path && editing.col === c)
                      return (
                        <td key={c} className={'nm' + (rows.includes(r) ? '' : ' out')}>
                          <input
                            className="base-in"
                            autoFocus
                            defaultValue={r.name}
                            // 和名字差不多宽：输入框收起时列宽不跳（点别的格子时松手落到别的格子上）
                            size={Math.max(6, Array.from(r.name).length * 2 + 2)}
                            aria-label={`${r.name} · 名字`}
                            onFocus={(e) => e.currentTarget.select()}
                            onKeyDown={(e) => {
                              e.stopPropagation()
                              if (composing(e)) return
                              if (e.key === 'Enter') void rename(r, e.currentTarget)
                              if (e.key === 'Escape') setEditing(null)
                            }}
                            onBlur={(e) => void rename(r, e.currentTarget)}
                          />
                          {!rows.includes(r) && <span className="base-out">新 · 不在当前筛选里</span>}
                        </td>
                      )
                    if (c === 'file.name')
                      return (
                        <td key={c} className={'nm' + (rows.includes(r) ? '' : ' out')}>
                          <button type="button" onClick={() => app().openFile(r.path)} title={locked ? r.name : undefined}>
                            {r.name}
                          </button>
                          {!rows.includes(r) && <span className="base-out">新 · 不在当前筛选里</span>}
                        </td>
                      )
                    const v = r.props[c] ?? ''
                    const t = types[c] ?? 'text'
                    if (t === 'check')
                      return (
                        <td key={c}>
                          <input type="checkbox" className="base-check" checked={/^true$/i.test(v)} aria-label={`${r.name} · ${colName(c)}`} onChange={(e) => void save(r, c, e.currentTarget.checked ? 'true' : 'false')} />
                        </td>
                      )
                    if (editing?.path === r.path && editing.col === c)
                      return (
                        <td key={c} className="editing">
                          <input
                            className="base-in"
                            autoFocus
                            type={t === 'date' ? 'date' : t === 'number' ? 'number' : 'text'}
                            defaultValue={t === 'date' ? v.slice(0, 10) : v}
                            aria-label={`${r.name} · ${colName(c)}`}
                            onKeyDown={(e) => {
                              e.stopPropagation()
                              if (composing(e)) return
                              if (e.key === 'Enter') void save(r, c, e.currentTarget.value.trim())
                              if (e.key === 'Escape') setEditing(null)
                            }}
                            onBlur={(e) => void save(r, c, e.currentTarget.value.trim())}
                          />
                        </td>
                      )
                    return (
                      <td
                        key={c}
                        className={t === 'number' ? 'num' : t === 'date' ? 'num date' : ''}
                        onClick={(e) => (t === 'select' || t === 'multi' ? setPop({ kind: 'options', path: r.path, col: c, at: atOf(e.currentTarget) }) : setEditing({ path: r.path, col: c }))}
                      >
                        {cellView(r, c, t, v)}
                      </td>
                    )
                  })}
                  <td className="base-td-plus" />
                </tr>
              ))}
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
                    新建
                  </td>
                </tr>
              )}
              {/* 计算行：哪一列选了「算什么」才有（小样的表底下直接是那句说明，不留一条空行）；从列头菜单「计算…」选 */}
              {sums && (
                <tr className="base-sums">
                  {spec.columns.map((c) => {
                    const id = spec.summaries[c]
                    const t = types[c] ?? 'text'
                    const label = id ? (SUMMARIES[t].find((s) => s.id === id)?.label ?? id) : ''
                    const value = id ? summarize(id, t, rows.map((r) => (c === 'file.name' ? r.name : (r.props[c] ?? '')))) : ''
                    return (
                      <td key={c} className={id ? 'set' : ''}>
                        <button type="button" className="base-sum" aria-label={`${colName(c)} 算什么`} onClick={(e) => setPop({ kind: 'sum', col: c, at: atOf(e.currentTarget) })}>
                          {id ? (
                            <>
                              <span className="k">{label}</span>
                              <span className="v num">{value}</span>
                            </>
                          ) : (
                            <span className="k">计算</span>
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
        <div className="base-foot">
          {data === null
            ? '正在读…'
            : [outs ? `另有${outs}条刚建的不在筛选里` : '', rows.length > limit ? `这里只列前${limit}条，整页打开看全部` : '', props.foot ?? `每条是「${spec.folder}」里的一篇笔记`].filter(Boolean).join(' · ')}
        </div>
      </>
    )
  }

  /** 排序面板（照 Notion 的「排序」）：按哪一列、升序还是降序，改了就写回；「不排序」拿掉 sort */
  const cur = spec.sort[0]
  const sortCols = ['file.name', ...new Set([...spec.columns, ...allProps])].filter((c, k, a) => a.indexOf(c) === k)
  const sortPanel = (
    <div className="base-pop base-filter base-sort" role="dialog" aria-label="排序" style={pop?.kind === 'sort' ? { top: pop.at.top + 2, right: pop.at.right } : undefined}>
      <div className="base-filter-hd">
        <Codicon name="arrow-swap" size={14} />
        <span>{cur ? '按这一列排' : '还没排序：选一列'}</span>
      </div>
      <div className="base-filter-row">
        <span className="lead">按</span>
        <select aria-label="排序的列" value={cur?.prop ?? ''} onChange={(e) => e.currentTarget.value && edit.sort(e.currentTarget.value, cur?.desc ?? false)}>
          {!cur && <option value="">选一列…</option>}
          {sortCols.map((c) => (
            <option key={c} value={c}>
              {colName(c)}
            </option>
          ))}
        </select>
        <select aria-label="升序还是降序" value={cur?.desc ? 'desc' : 'asc'} disabled={!cur} onChange={(e) => cur && edit.sort(cur.prop, e.currentTarget.value === 'desc')}>
          <option value="asc">升序</option>
          <option value="desc">降序</option>
        </select>
        {cur && (
          <button type="button" className="base-x" aria-label="不排序" onClick={() => (setPop(null), edit.src(clearBaseSort))}>
            <Codicon name="close" size={14} />
          </button>
        )}
      </div>
    </div>
  )

  const filterPanel = (
    <div className="base-pop base-filter" role="dialog" aria-label="筛选" style={pop?.kind === 'filter' ? { top: pop.at.top + 2, right: pop.at.right } : undefined}>
      <div className="base-filter-hd">
        <Codicon name="filter" size={14} />
        <span>满足</span>
        <select aria-label="全部还是任一" value={spec.match} onChange={(e) => changeDrafts(drafts, e.currentTarget.value as 'and' | 'or')}>
          <option value="and">全部</option>
          <option value="or">任一</option>
        </select>
        <span>条件的才显示</span>
      </div>
      {drafts.map((d, i) => {
        const t = types[d.prop] ?? 'text'
        const ops = BASE_OPS[t]
        const needs = ops.find((o) => o.op === d.op)?.value ?? true
        const set = (patch: Partial<Draft>, wait = 0) => changeDrafts(drafts.map((x, k) => (k === i ? { ...x, ...patch } : x)), spec.match, wait)
        return (
          <div className="base-filter-row" key={i}>
            <span className="lead">{i === 0 ? '当' : spec.match === 'or' ? '或者' : '并且'}</span>
            <select
              aria-label="列"
              value={d.prop}
              onChange={(e) => {
                const p = e.currentTarget.value
                const nt = types[p] ?? 'text'
                set({ prop: p, op: BASE_OPS[nt][0]!.op, value: nt === 'check' ? 'true' : '' })
              }}
            >
              {['file.name', ...new Set([...spec.columns, ...allProps])].filter((c, k, a) => a.indexOf(c) === k).map((c) => (
                <option key={c} value={c}>
                  {colName(c)}
                </option>
              ))}
            </select>
            {t === 'check' ? (
              <select aria-label="条件" value={d.value} onChange={(e) => set({ op: '==', value: e.currentTarget.value })}>
                <option value="true">是</option>
                <option value="false">否</option>
              </select>
            ) : (
              <select aria-label="条件" value={d.op} onChange={(e) => set({ op: e.currentTarget.value as Draft['op'], value: e.currentTarget.value === 'days' ? '7' : d.value })}>
                {ops.map((o) => (
                  <option key={o.op} value={o.op}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
            {t === 'check' || !needs ? (
              <span className="val-none" />
            ) : (t === 'select' || t === 'multi') && d.op !== 'contains' ? (
              <select aria-label="值" value={d.value} onChange={(e) => set({ value: e.currentTarget.value })}>
                <option value="">选一个…</option>
                {valuesOf(d.prop).map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            ) : (
              <input
                aria-label="值"
                type={d.op === 'days' || t === 'number' ? 'number' : t === 'date' ? 'date' : 'text'}
                value={d.value}
                placeholder={d.op === 'days' ? '天数' : '值'}
                onChange={(e) => set({ value: e.currentTarget.value }, 300)}
                onKeyDown={(e) => e.stopPropagation()}
              />
            )}
            <button type="button" className="base-x" aria-label="去掉这一条" onClick={() => changeDrafts(drafts.filter((_, k) => k !== i))}>
              <Codicon name="close" size={14} />
            </button>
          </div>
        )
      })}
      <button type="button" className="base-filter-add" onClick={() => setDrafts([...drafts, { prop: spec.columns.find((c) => c !== 'file.name') ?? 'file.name', op: '==', value: '' }])}>
        <Codicon name="add" size={14} />
        加一条
      </button>
      <div className="base-filter-foot">
        <Codicon name="check" size={12} />
        改完马上生效，不用点保存
      </div>
    </div>
  )

  const head = (inFull: boolean) => (
    <div className="base-top">
      <Codicon name="database" size={15} />
      <b>{name}</b>
      <span className="base-count">{`${spec.view} · ${data?.rows.length ?? 0} 条`}</span>
      {spec.sort.map((s) => (
        <button key={s.prop} type="button" className="base-chip" aria-label={`按「${colName(s.prop)}」${s.desc ? '降序' : '升序'}，点了改排序`} onClick={() => openSort()}>
          <Codicon name={s.desc ? 'arrow-down' : 'arrow-up'} size={12} />
          {colName(s.prop)}
        </button>
      ))}
      {spec.conds.map((c, i) => (
        <span key={i} className="base-tag" data-part="筛选小标签">
          {/* 点条件的字：开筛选面板改它；点 ×：去掉这一条 */}
          <button type="button" className="t" disabled={spec.filtersLocked} onClick={() => openFilter()}>
            {(spec.match === 'or' && i > 0 ? '或' : '') + condLabel(c, types[c.prop] ?? 'text')}
          </button>
          {!spec.filtersLocked && (
            <button type="button" aria-label={`去掉「${condLabel(c, types[c.prop] ?? 'text')}」`} onClick={() => removeCond(i)}>
              <Codicon name="close" size={12} />
            </button>
          )}
        </span>
      ))}
      <span className="sp" />
      {/* 隐藏的列：块头一颗纯字按钮（表头最右只留一个 32 宽的「+」） */}
      {hiddenCols.length > 0 && (
        <button
          type="button"
          className="base-btn wt"
          aria-label={`隐藏了 ${hiddenCols.length} 列`}
          data-tip="隐藏的列"
          aria-expanded={pop?.kind === 'hidden'}
          onClick={(e) => setPop(pop?.kind === 'hidden' ? null : { kind: 'hidden', at: atOf(e.currentTarget) })}
        >
          <Codicon name="eye-closed" size={14} />
          <span>{hiddenCols.length}</span>
        </button>
      )}
      <span className="base-filter-wrap">
        {/* 「筛选」「排序」是纯字按钮（12 --t2，不加底色）：开着的条件、排序已经写在左边的小标签上，这里不再重复 */}
        <button
          type="button"
          className="base-btn wt"
          aria-label="筛选"
          aria-expanded={pop?.kind === 'filter'}
          data-tip={spec.filtersLocked ? '这个数据库的筛选是嵌套的组合条件：点「改写法」直接改' : undefined}
          disabled={spec.filtersLocked}
          onClick={() => (pop?.kind === 'filter' ? setPop(null) : openFilter())}
        >
          <Codicon name="filter" size={14} />
          <span>筛选</span>
        </button>
        {pop?.kind === 'filter' && !inFull === !full && filterPanel}
      </span>
      <span className="base-filter-wrap">
        <button type="button" className="base-btn wt base-sort-btn" aria-label="排序" aria-expanded={pop?.kind === 'sort'} onClick={() => (pop?.kind === 'sort' ? setPop(null) : openSort())}>
          <Codicon name="arrow-swap" size={14} />
          <span>排序</span>
        </button>
        {pop?.kind === 'sort' && !inFull === !full && sortPanel}
      </span>
      {inFull ? (
        <button type="button" className="base-btn" aria-label="收回文档里" data-tip="收回文档里 · esc" onClick={() => setFull(false)}>
          <Codicon name="screen-normal" size={14} />
        </button>
      ) : (
        <button type="button" className="base-btn" aria-label="整页打开" data-tip="整页打开" onClick={() => (setPop(null), setFull(true))}>
          <Codicon name="screen-full" size={14} />
        </button>
      )}
      {!inFull && (
        <button type="button" className={'base-raw' + (raw ? ' on' : '')} aria-pressed={raw} onClick={() => setRaw((x) => !x)}>
          <Codicon name="code" size={13} />
          改写法
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
          <Codicon name="add" size={12} />
          新一条
        </button>
      )}
      {!inFull && props.extra}
    </div>
  )

  // 点浮层外面收起
  const rootRef = useRef<HTMLDivElement>(null)
  const fullRef = useRef<HTMLDivElement>(null)
  // 浮层下面放不下（贴着窗口底的列、菜单里的「右边插入一列」）：往上挪到窗口里
  useLayoutEffect(() => {
    for (const root of [rootRef.current, fullRef.current])
      for (const el of root?.querySelectorAll<HTMLElement>('.base-pop') ?? []) {
        const r = el.getBoundingClientRect()
        if (r.bottom > window.innerHeight - 44) el.style.top = Math.max(8, window.innerHeight - 44 - r.height) + 'px'
      }
  })
  useEffect(() => {
    if (!pop) return
    const down = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (t.closest?.('.base-pop, .base-th, .base-filter-wrap')) return
      setPop(null)
    }
    // 浮层是贴着按钮的固定位置：文档一滚就收起，不飘在别处
    const scroll = (e: Event) => !(e.target as HTMLElement).closest?.('.base-pop') && setPop(null)
    document.addEventListener('mousedown', down, true)
    window.addEventListener('scroll', scroll, true)
    return () => (document.removeEventListener('mousedown', down, true), window.removeEventListener('scroll', scroll, true))
  }, [pop])

  const pane = props.anchor.closest('.pane')
  return (
    <div className="base" data-part="数据库块" ref={rootRef}>
      {head(false)}
      {raw && <RawYaml src={props.src} onDone={(y) => (setRaw(false), y !== props.src && edit.src(() => y))} onCancel={() => setRaw(false)} />}
      {spec.folder ? table(INLINE_ROWS) : <div className="base-foot">这个数据库没写数据源：点「改写法」加一行 file.inFolder("文件夹")</div>}
      {full &&
        pane &&
        createPortal(
          <div className="base base-full" role="dialog" aria-label={`数据库 ${name}`} ref={fullRef}>
            {head(true)}
            {table(Infinity)}
          </div>,
          pane,
        )}
    </div>
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
      aria-label="列名"
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

/** 加一列：起名字 + 选类型（照 Notion：名字框在上，下面一排类型） */
function AddCol(props: { at: At; name: string; onAdd(name: string, type: ColType): void }) {
  const [name, setName] = useState(props.name)
  const [type, setType] = useState<ColType>('text')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.select(), [])
  return (
    <div className="base-pop base-colmenu base-addcol" style={{ top: props.at.top, left: Math.min(props.at.left, window.innerWidth - 232) }} role="dialog" aria-label="加一列">
      <input
        ref={ref}
        className="base-colname"
        aria-label="新的一列叫什么"
        value={name}
        autoFocus
        onChange={(e) => setName(e.currentTarget.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (composing(e)) return
          if (e.key === 'Enter') props.onAdd(name, type)
        }}
      />
      <div className="hd">类型</div>
      <div className="base-types">
        {COL_TYPES.map((ct) => (
          <button key={ct.type} type="button" role="radio" aria-checked={type === ct.type} className={type === ct.type ? 'on' : ''} onClick={() => setType(ct.type)}>
            <Codicon name={ICON[ct.type]} size={14} />
            <span>{ct.label}</span>
          </button>
        ))}
      </div>
      <div className="base-addcol-foot">
        <button type="button" className="btn btn-sm btn-primary" onClick={() => props.onAdd(name, type)}>
          <Codicon name="add" size={12} />
          {`加「${TYPE_NAME[type]}」列`}
        </button>
      </div>
    </div>
  )
}

/** 选项、多选的格子：一排已有的值（小色块）+ 搜索框，打一个新的回车就建；多选能勾几个 */
function Options(props: { at: At; multi: boolean; label: string; values: string[]; picked: string[]; onChange(vs: string[], close: boolean): void }) {
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState(props.picked)
  const list = props.values.filter((v) => !q.trim() || v.toLowerCase().includes(q.trim().toLowerCase()))
  const fresh = q.trim() && !props.values.some((v) => v === q.trim()) ? q.trim().replace(/[,[\]]/g, ' ').trim() : ''
  const pick = (v: string) => {
    if (!props.multi) return props.onChange([v], true)
    const next = picked.includes(v) ? picked.filter((x) => x !== v) : [...picked, v]
    setPicked(next)
    props.onChange(next, false)
  }
  return (
    <div className="base-pop base-options" style={{ top: props.at.top, left: props.at.left }} role="dialog" aria-label={props.label}>
      <div className="base-picked">
        {picked.map((v) => (
          <span key={v} className={'base-sel ' + toneOf(v)}>
            {v}
            <button type="button" aria-label={`去掉 ${v}`} onClick={() => (props.multi ? pick(v) : props.onChange([], true))}>
              <Codicon name="close" size={10} />
            </button>
          </span>
        ))}
        <input
          autoFocus
          aria-label="找一个，或者打一个新的"
          placeholder={picked.length ? '' : '找一个，或者打一个新的'}
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (composing(e)) return
            if (e.key === 'Enter') {
              const v = fresh || list[0]
              if (v) (pick(v), setQ(''))
            }
          }}
        />
      </div>
      <div className="hd">{props.multi ? '选几个，或者建一个' : '选一个，或者建一个'}</div>
      {list.map((v) => (
        <button key={v} type="button" role={props.multi ? 'menuitemcheckbox' : 'menuitemradio'} aria-checked={picked.includes(v)} onClick={() => pick(v)}>
          <span className={'base-sel ' + toneOf(v)}>{v}</span>
          {picked.includes(v) && <Codicon name="check" size={14} />}
        </button>
      ))}
      {fresh && (
        <button type="button" role="menuitem" onClick={() => (pick(fresh), setQ(''))}>
          <span className="new">建一个</span>
          <span className={'base-sel ' + toneOf(fresh)}>{fresh}</span>
        </button>
      )}
    </div>
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
    <div className="cm-raw base-rawbox" data-part="改写法">
      <textarea
        ref={ref}
        className="cm-raw-text"
        spellCheck={false}
        aria-label="这一块的写法"
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
          完成
        </button>
      </div>
    </div>
  )
}
