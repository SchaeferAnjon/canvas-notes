/**
 * 文档里的数据库表格（CN-19 A）：```base 代码块画成这张表。
 * 工具条：图标 + 名字 + 视图「表格」+ 排序 + 筛选小标签（点 × 去掉这一条）……「筛选 N」「整页打开」「新一条」。
 * 「筛选」弹一个面板：满足 全部 / 任一 条件的才显示，每条一行 列 · 条件 · 值 · 删除；改完马上写回代码块的 filters。
 * 开着筛选点「新一条」：新的那条不满足筛选也先留在表底，标「新 · 不在当前筛选里」，离开这篇或改到满足为止。
 * 点列头出菜单：升序、降序、按这一列筛选…、隐藏这一列（从 order 里拿掉）；隐藏了列时表头最右边 eye-closed N，点开勾回来。
 * 第一列是笔记名，点了在新标签打开；别的格子点了就地改，回车写进那一篇的 frontmatter；
 * 底下一行「2 条（筛掉 4 条）· 每条是「书单/」文件夹里的一篇 md，属性写在开头」。
 * 量大时文档里只铺前 50 条（`别把上万条全铺开`），整页打开看全部。写法同 Obsidian Bases，见 packages/format/src/base.ts。
 */
import { Codicon, type CodiconName } from '@cn/design'
import { BASE_OPS, type BaseCond, type BaseRow, baseRows, type BaseSpec, colType, type ColType, condLabel, HIDDEN_KEYS, setProp } from '@cn/format'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { nameNotice, safeName } from '../../shared/file-name'
import { nameFromTitle } from '../title-follow'
import { titleOf } from '../../shared/layout'
import { app } from '../ctx/actions'

const ICON: Record<ColType, CodiconName> = { text: 'symbol-string', select: 'list-flat', number: 'symbol-numeric', date: 'calendar', check: 'check' }
const INLINE_ROWS = 50

const colName = (c: string) => (c === 'file.name' ? '名字' : c.replace(/^note\./, ''))

/** 单选值的颜色：同一个值总是同一个颜色，颜色收着（方块配色别太艳） */
const TONES = ['green', 'yellow', 'plain'] as const
function toneOf(v: string): (typeof TONES)[number] {
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

export interface BaseEdits {
  sort(prop: string, desc: boolean): void
  filters(match: 'and' | 'or', conds: BaseCond[]): void
  order(columns: string[]): void
}

/** 一条筛选的草稿：还没填值的也留在面板里，填好了才写回 */
interface Draft {
  prop: string
  op: BaseCond['op']
  value: string
}

/** 列头浮层的位置：相对表格外框（表格本身能横着滚，浮层不能放在里面，不然被裁掉） */
interface At {
  left: number
  top: number
  right: number
}

/** 浮层贴着按钮、用窗口坐标（position: fixed）：文档短时编辑器的滚动区会把往下伸的浮层裁掉 */
const atOf = (el: HTMLElement): At => {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.bottom + 4, right: window.innerWidth - r.right }
}

const complete = (d: Draft, type: ColType) => !(BASE_OPS[type].find((o) => o.op === d.op)?.value ?? true) || d.value.trim() !== ''

export function BaseTable(props: { spec: BaseSpec; edit: BaseEdits; anchor: HTMLElement }) {
  const { spec, edit } = props
  const [data, setData] = useState<Loaded | null>(null)
  const [full, setFull] = useState(false)
  const [editing, setEditing] = useState<{ path: string; col: string } | null>(null)
  const [tick, setTick] = useState(0)
  /** 开着的浮层：筛选面板、某一列的菜单、隐藏的列 */
  const [pop, setPop] = useState<{ kind: 'filter'; at: At } | { kind: 'col'; col: string; at: At } | { kind: 'hidden'; at: At } | null>(null)
  const [drafts, setDrafts] = useState<Draft[]>([])
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
    return () => (off1(), off2())
  }, [key])
  useEffect(() => {
    if (!full && !pop) return
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
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
  const typeOf = (c: string): ColType => (c === 'file.name' ? 'text' : colType((data?.all ?? []).map((r) => r.props[c] ?? '')))
  const types = useMemo(() => Object.fromEntries([...new Set([...spec.columns, ...allProps])].map((c) => [c, typeOf(c)])) as Record<string, ColType>, [data, key])
  const valuesOf = (c: string) => [...new Set((data?.all ?? []).map((r) => (c === 'file.name' ? r.name : (r.props[c] ?? ''))).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh'))
  const hiddenCols = allProps.filter((p) => !spec.columns.includes(p))

  const name = spec.folder ? spec.folder.split('/').pop()! : '数据库'
  const save = async (r: BaseRow, col: string, value: string) => {
    setEditing(null)
    const old = data?.texts.get(r.path)
    if (old === undefined || (r.props[col] ?? '') === value) return
    const next = setProp(old, col, value === '' ? undefined : value)
    const w = await window.cn.writeNote(r.path, next, old)
    if (!w.ok) app().notice(`《${r.name}》刚被别处改过，没改成，再试一次`)
    setTick((t) => t + 1)
  }
  /** 这次点「新一条」建的：开着筛选、它又不满足时也先留在表底（标「新 · 不在当前筛选里」），离开这篇或改到满足筛选为止 */
  const [added, setAdded] = useState<string[]>([])
  /**
   * 点「新一条」那一刻量下的列宽（文档里的表、整页打开的表各一份）：新的那条还在起名、或还留在表底时按它定住列宽，
   * 起名框、打的字、「新 · 不在当前筛选里」都不把列挤动（第 3 轮美学）
   */
  const [lock, setLock] = useState<{ cols: string; inline?: number[]; full?: number[] } | null>(null)
  const widthsOf = (root: HTMLElement | null) => {
    const ths = root?.querySelectorAll<HTMLElement>(':scope > .base-scroll > table > thead th')
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
   * （以前按路径认：上一条刚把「未命名 6」改走，下一条新建出来又叫「未命名 6」，就被当成改过的那条，名字丢掉，隔一条丢一条）
   */
  const named = useRef(new WeakSet<HTMLInputElement>())
  const rename = async (r: BaseRow, el: HTMLInputElement) => {
    setEditing(null)
    if (named.current.has(el)) return
    named.current.add(el)
    const name = el.value.trim()
    if (!name || name === r.name) return
    try {
      // / \ : 和标题跟着改名一样换成「-」（别的不能用的字主进程换成空格）
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

  const colMenus = (() => {
    if (pop?.kind === 'hidden')
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
    if (pop?.kind !== 'col') return null
    const c = pop.col
    const s = spec.sort.find((x) => x.prop === c)
    return (
      <div className="base-pop base-colmenu" style={{ top: pop.at.top, left: pop.at.left }} role="menu" aria-label={`${colName(c)} 这一列`}>
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
        {(!spec.filtersLocked || c !== 'file.name') && <div className="sep" />}
        {!spec.filtersLocked && (
          <button type="button" role="menuitem" onClick={() => openFilter(c)}>
            <Codicon name="filter" size={14} />
            <span>按这一列筛选…</span>
          </button>
        )}
        {c !== 'file.name' && (
          <button type="button" role="menuitem" onClick={() => (setPop(null), hideCol(c))}>
            <Codicon name="eye-closed" size={14} />
            <span>隐藏这一列</span>
          </button>
        )}
      </div>
    )
  })()

  const table = (limit: number) => {
    const rows = data?.rows ?? []
    /** 留在表底的新条目（不满足筛选） */
    const outs = (data?.all ?? []).filter((r) => added.includes(r.path) && !rows.some((x) => x.path === r.path)).length
    const widths = lock?.cols === spec.columns.join('\n') && (outs > 0 || (editing && added.includes(editing.path))) ? lock[limit === Infinity ? 'full' : 'inline'] : undefined
    return (
      <>
        <div className="base-scroll">
          <table className={widths ? 'fixed' : undefined}>
            {widths && (
              <colgroup>
                {widths.map((w, i) => (
                  <col key={i} style={{ width: w }} />
                ))}
              </colgroup>
            )}
            <thead>
              <tr>
                {spec.columns.map((c) => {
                  const s = spec.sort.find((x) => x.prop === c)
                  const open = pop?.kind === 'col' && pop.col === c
                  return (
                    <th key={c} className={open ? 'on' : ''}>
                      <button type="button" className="base-th" aria-haspopup="menu" aria-expanded={open} onClick={(e) => setPop(open ? null : { kind: 'col', col: c, at: atOf(e.currentTarget) })}>
                        <Codicon name={ICON[types[c] ?? 'text']} size={12} />
                        <span>{colName(c)}</span>
                        {s && <Codicon name={s.desc ? 'arrow-down' : 'arrow-up'} size={12} />}
                      </button>
                    </th>
                  )
                })}
                <th className="base-th-hidden">
                  {hiddenCols.length > 0 && (
                    <button
                      type="button"
                      className="base-th"
                      aria-label={`隐藏了 ${hiddenCols.length} 列`}
                      data-tip="隐藏的列"
                      aria-expanded={pop?.kind === 'hidden'}
                      onClick={(e) => setPop(pop?.kind === 'hidden' ? null : { kind: 'hidden', at: atOf(e.currentTarget) })}
                    >
                      <Codicon name="eye-closed" size={14} />
                      <span>{hiddenCols.length}</span>
                    </button>
                  )}
                </th>
              </tr>
            </thead>
            <tbody>
              {[...rows.slice(0, limit), ...(data?.all ?? []).filter((r) => added.includes(r.path) && !rows.some((x) => x.path === r.path))].map((r) => (
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
                              if (e.key === 'Enter' && !e.nativeEvent.isComposing) void rename(r, e.currentTarget)
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
                          <button type="button" onClick={() => app().openFile(r.path)} title={widths ? r.name : undefined}>
                            {r.name}
                          </button>
                          {!rows.includes(r) && <span className="base-out">新 · 不在当前筛选里</span>}
                        </td>
                      )
                    const v = r.props[c] ?? ''
                    const t = types[c]
                    if (t === 'check')
                      return (
                        <td key={c}>
                          <input type="checkbox" className="base-check" checked={/^true$/i.test(v)} aria-label={`${r.name} · ${colName(c)}`} onChange={(e) => void save(r, c, e.currentTarget.checked ? 'true' : 'false')} />
                        </td>
                      )
                    if (editing?.path === r.path && editing.col === c)
                      return (
                        <td key={c}>
                          <input
                            className="base-in"
                            autoFocus
                            defaultValue={v}
                            aria-label={`${r.name} · ${colName(c)}`}
                            onKeyDown={(e) => {
                              e.stopPropagation()
                              if (e.key === 'Enter' && !e.nativeEvent.isComposing) void save(r, c, e.currentTarget.value.trim())
                              if (e.key === 'Escape') setEditing(null)
                            }}
                            onBlur={(e) => void save(r, c, e.currentTarget.value.trim())}
                          />
                        </td>
                      )
                    return (
                      <td key={c} className={t === 'number' || t === 'date' ? 'num' : ''} onClick={() => setEditing({ path: r.path, col: c })}>
                        {v && t === 'select' ? <span className={'base-sel ' + toneOf(v)}>{v}</span> : t === 'date' ? v.slice(5, 10) : v}
                      </td>
                    )
                  })}
                  <td className="base-td-hidden" />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(limit === Infinity) === full && colMenus}
        <div className="base-foot">
          {data === null
            ? '正在读…'
            : `${rows.length}条${outs ? `，另有${outs}条刚建的不在筛选里` : ''}${data.hidden - outs > 0 ? `（筛掉${data.hidden - outs}条）` : ''}${rows.length > limit ? `，这里只列前${limit}条，整页打开看全部` : ''} · 每条是「${name}/」文件夹里的一篇md，属性写在开头`}
        </div>
      </>
    )
  }

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
            ) : t === 'select' && d.op !== 'contains' ? (
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
      <Codicon name="database" size={16} />
      <b>{name}</b>
      <span className="base-view">
        <Codicon name="table" size={12} />
        {spec.view}
      </span>
      {spec.sort.map((s) => (
        <span key={s.prop} className="base-chip">
          <Codicon name={s.desc ? 'arrow-down' : 'arrow-up'} size={12} />
          {colName(s.prop)}
        </span>
      ))}
      {spec.conds.map((c, i) => (
        <span key={i} className="base-tag" data-part="筛选小标签">
          {(spec.match === 'or' && i > 0 ? '或' : '') + condLabel(c, types[c.prop] ?? 'text')}
          {!spec.filtersLocked && (
            <button type="button" aria-label={`去掉「${condLabel(c, types[c.prop] ?? 'text')}」`} onClick={() => removeCond(i)}>
              <Codicon name="close" size={12} />
            </button>
          )}
        </span>
      ))}
      <span className="sp" />
      <span className="base-filter-wrap">
        <button
          type="button"
          className={'base-btn wt' + (spec.conds.length ? ' on' : '')}
          aria-label="筛选"
          aria-expanded={pop?.kind === 'filter'}
          data-tip={spec.filtersLocked ? '这个数据库的筛选是嵌套的组合条件，去源文件里改' : undefined}
          disabled={spec.filtersLocked}
          onClick={() => (pop?.kind === 'filter' ? setPop(null) : openFilter())}
        >
          <Codicon name="filter" size={14} />
          <span>{`筛选${spec.conds.length ? spec.conds.length : ''}`}</span>
        </button>
        {pop?.kind === 'filter' && !inFull === !full && filterPanel}
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
    </div>
  )

  // 点浮层外面收起
  const rootRef = useRef<HTMLDivElement>(null)
  const fullRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!pop) return
    const down = (e: MouseEvent) => {
      const t = e.target as Node
      const inside = [rootRef.current, fullRef.current].some((el) => el?.contains(t))
      if (!inside || !(t as HTMLElement).closest?.('.base-pop, .base-th, .base-filter-wrap')) setPop(null)
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
      {spec.folder ? table(INLINE_ROWS) : <div className="base-foot">这个数据库没写数据源：在源文件里加一行file.inFolder("文件夹")</div>}
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
