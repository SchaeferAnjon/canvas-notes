/**
 * 数据库块头第二行（第三批 task-i921u，方向 A「改了就存」）：视图标签条 …… 分组、筛选、排序；下面一条开着的筛选、排序小标签。
 * - 点一个标签切过去（当前看哪个记在本机，view-state.ts）；点当前那个出菜单：重命名、复制这个视图、换看法、（画廊）封面、删除；
 *   双击标签直接改名；按住左右拖换顺序；最右「+」加一个视图（加完直接起名）。
 * - 块窄于 560 时标签收成一个下拉「看板 ▾」，分组、筛选、排序只留图标（悬停说名字），不挤成一字一行。
 * - 筛选、排序、分组一改就写进当前视图（setViewFilter / setViewSort / setViewGroup），每次一次写，底部提示带「撤回」（BaseTable 的 save）。
 * 写法都调 packages/format（base-doc.ts），这里不另写一份。
 */
import { Codicon, type CodiconName } from '@cn/design'
import { trackDrag } from '@cn/design/drag-end'
import {
  addView,
  type BaseCtx,
  type BaseDoc,
  type BaseFilter,
  colTypeOf,
  defaultDateProp,
  defaultGroupProp,
  duplicateView,
  effectiveFilter,
  filterCount,
  moveView,
  removeView,
  renameView,
  setViewFilter,
  setViewGroup,
  setViewSort,
  setViewDate,
  setViewImage,
  setViewType,
  uniqueViewName,
  type ViewResult,
  VIEW_TYPES,
  viewLabel,
  type ViewType,
} from '@cn/format'
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import { useT } from '../i18n'
import { colText, filterWords, fmt } from './words'
import { composing } from '../ime'
import { app } from '../ctx/actions'
import { anchorOf, FloatPop, type PopAnchor } from '../pop-place'
import { FilterPanel, SortPanel } from './FilterPanel'
import { openAiCol } from './ai-col'
import { AiAddItem } from './ai-cells'
import { setViewName } from './view-state'
import './views.css'

const ICON = Object.fromEntries(VIEW_TYPES.map((v) => [v.type, v.icon])) as Record<ViewType, CodiconName>

/** 第二行的几个浮层（挂在 BaseTable 的 pop 上，点外面、esc 收起同一套） */
export type ViewPop =
  | { kind: 'vmenu'; i: number; at: PopAnchor }
  | { kind: 'vadd'; at: PopAnchor }
  | { kind: 'vsel'; at: PopAnchor }
  | { kind: 'group'; at: PopAnchor }
  | { kind: 'vfilter'; at: PopAnchor; add?: string }
  | { kind: 'vsort'; at: PopAnchor }

/** 改块里的字：next 算新的，msg 是底部提示前半句（「改了筛选，存进了「全部」」），sub 换掉后半句 */
export type Save = (next: (src: string) => string, msg: string, sub?: string) => void

/** 能拿来分组的列：状态、选项、多选、勾选（日期按周以后加；关联一格好几篇、文字每条都不一样，不拿来分组） */
const GROUPABLE = new Set(['status', 'select', 'multi', 'check'])

export function useViewBar(o: {
  doc: BaseDoc
  vi: number
  folder: string | null
  ctx: BaseCtx | null
  res: ViewResult | null
  narrow: boolean
  pop: { kind: string } | null
  setPop(p: ViewPop | null): void
  save: Save
  /** 视图标签条右边、分组前面多放的（隐藏了几列） */
  lead?: ReactNode
  /** 这张表的编号（AI 生成一列开右栏时认是哪张表） */
  table: string
}) {
  const t = useT()
  const { doc, vi, folder, save, setPop } = o
  const view = doc.views[vi]!
  /** 正在改名的视图（第几个）：双击标签、菜单「重命名」、加完一个 */
  const [renaming, setRenaming] = useState<number | null>(null)
  /** 正在拖着换顺序：拖的第几个、落在第几个前面 */
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null)
  const suppress = useRef(false)
  /**
   * 标签放不下（块不窄、但视图多、名字长，右栏开着时常见），不切掉半截标签：先让分组、筛选、排序只留图标（悬停说名字），
   * 还放不下再和窄于 560 一样收成一个下拉。摆得开时量下标签和右边几颗要多宽，收着时按量下的宽判断能不能摆回去；
   * 视图变了（加、删、改名）重新量一次（画出来之前，不闪）
   */
  const barRef = useRef<HTMLDivElement>(null)
  /** 标签一共多宽、右边几颗带字时多宽 */
  const size = useRef({ tabs: 0, tools: 0 })
  const sig = useRef('')
  /** 0 摆得开，1 右边只留图标，2 标签收成下拉 */
  const [squeeze, setSqueeze] = useState<0 | 1 | 2>(0)
  const narrow = o.narrow || squeeze === 2
  const iconsOnly = narrow || squeeze === 1
  const names = doc.views.map((v) => v.name).join('\n')
  useLayoutEffect(() => {
    const el = barRef.current
    if (!el) return
    if (sig.current !== names) {
      sig.current = names
      if (squeeze) return setSqueeze(0)
    }
    const fit = () => {
      const tabs = el.querySelector<HTMLElement>('.base-vtabs')
      const tools = el.querySelector<HTMLElement>('.base-tools')
      if (tabs) size.current.tabs = tabs.scrollWidth
      if (tools && !iconsOnly) size.current.tools = tools.offsetWidth
      const n = tools?.children.length ?? 0
      const room = el.clientWidth - 22
      const { tabs: tw, tools: lw } = size.current
      const next = !tw || o.narrow ? 0 : tw + lw <= room ? 0 : tw + n * 30 <= room ? 1 : 2
      setSqueeze((cur) => (cur === next ? cur : next))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  })
  const pop = o.pop as ViewPop | null
  const filter = effectiveFilter(doc, vi)
  const fN = filterCount(filter)
  const typeOf = (c: string) => (o.ctx ? colTypeOf(o.ctx, c) : 'text')
  const inView = (s: string) => t('{what}，存进了「{name}」', { what: s, name: view.name })

  const pick = (i: number) => setViewName(folder, doc.views[i]!.name)
  /** 改过名的输入框：回车改完、框收起时还会再来一次失焦，同一个框只改一次 */
  const named = useRef(new WeakSet<HTMLInputElement>())
  const commitRename = (i: number, el: HTMLInputElement) => {
    setRenaming(null)
    if (named.current.has(el)) return
    named.current.add(el)
    const name = el.value.trim()
    const v = doc.views[i]
    if (!v || !name || name === v.name) return
    if (doc.views.some((x, k) => k !== i && x.name === name)) return app().notice(t('已经有一个视图叫「{name}」了', { name }))
    if (i === vi) setViewName(folder, name)
    save((s) => renameView(s, i, name), t('视图改名成了「{name}」', { name }))
  }
  const add = (type: ViewType) => {
    setPop(null)
    const name = uniqueViewName(doc, viewLabel(type))
    const ctx = o.ctx
    setViewName(folder, name)
    setRenaming(doc.views.length)
    save(
      (s) =>
        addView(s, {
          type,
          name,
          columns: type === 'table' || type === 'cards' ? view.columns : undefined,
          groupBy: type === 'kanban' && ctx ? defaultGroupProp(ctx) : undefined,
          date: type === 'calendar' && ctx ? defaultDateProp(ctx) : undefined,
        }),
      t('加了视图「{name}」', { name }),
    )
  }
  const duplicate = (i: number) => {
    setPop(null)
    const v = doc.views[i]!
    const name = uniqueViewName(doc, v.name + ' 2')
    setViewName(folder, name)
    setRenaming(i + 1)
    save((s) => duplicateView(s, i, name), t('复制了「{name}」', { name: v.name }))
  }
  const remove = (i: number) => {
    setPop(null)
    if (doc.views.length < 2) return
    const v = doc.views[i]!
    // 删的是正在看的：看它左边那个（删的是第一个就看下一个）
    if (i === vi) setViewName(folder, doc.views[i > 0 ? i - 1 : 1]!.name)
    save((s) => removeView(s, i), t('删掉了视图「{name}」', { name: v.name }), t('数据没动，只拿掉 base 块里这个视图'))
  }
  const retype = (i: number, type: ViewType) => {
    setPop(null)
    const v = doc.views[i]!
    if (v.kind === type) return
    const ctx = o.ctx
    save(
      (s) =>
        setViewType(s, i, type, {
          groupBy: ctx ? (defaultGroupProp(ctx) ?? undefined) : undefined,
          date: ctx ? (defaultDateProp(ctx) ?? undefined) : undefined,
        }),
      t('「{name}」换成了{type}', { name: v.name, type: fmt(viewLabel(type)) }),
    )
  }
  const setFilter = (f: BaseFilter | null) => save((s) => setViewFilter(s, vi, f), inView(f ? t('改了筛选') : t('去掉了筛选')))

  /** 标签：点切换 / 出菜单，双击改名，按住拖换顺序 */
  const startDrag = (e: React.MouseEvent, i: number) => {
    if (e.button !== 0 || renaming !== null) return
    const x0 = e.clientX
    const bar = (e.currentTarget as HTMLElement).closest('.base-vtabs')!
    let to = -1
    let started = false
    const move = (ev: MouseEvent) => {
      if (!started && Math.abs(ev.clientX - x0) < 6) return
      started = true
      const tabs = [...bar.querySelectorAll<HTMLElement>('.base-vtab')]
      to = tabs.findIndex((el) => ev.clientX < el.getBoundingClientRect().left + el.getBoundingClientRect().width / 2)
      if (to === -1) to = tabs.length
      setDrag({ from: i, to })
    }
    const up = () => {
      setDrag(null)
      if (!started || to === -1) return
      suppress.current = true
      setTimeout(() => (suppress.current = false), 0)
      const dest = to > i ? to - 1 : to
      if (dest !== i) save((s) => moveView(s, i, dest), t('挪了视图「{name}」的位置', { name: doc.views[i]!.name }))
    }
    // 松手没送到页面：当没拖过，视图的先后不变（trackDrag，task-0nz63）
    trackDrag(e, { move, end: (how) => (how === 'up' ? up() : setDrag(null)) })
  }

  const tab = (v: BaseDoc['views'][number], i: number) => {
    const on = i === vi
    if (renaming === i)
      return (
        <span key={i} className="base-vtab on">
          <Codicon name={ICON[v.kind]} size={14} />
          <input
            autoFocus
            aria-label={t('视图名')}
            defaultValue={v.name}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (composing(e)) return
              if (e.key === 'Enter') commitRename(i, e.currentTarget)
              if (e.key === 'Escape') (e.preventDefault(), named.current.add(e.currentTarget), setRenaming(null))
            }}
            onBlur={(e) => commitRename(i, e.currentTarget)}
          />
        </span>
      )
    return (
      <button
        key={i}
        type="button"
        role="tab"
        aria-selected={on}
        className={
          'base-vtab' +
          (on ? ' on' : '') +
          (drag?.from === i ? ' moving' : '') +
          (drag && drag.to === i && drag.from !== i ? ' drop-before' : '') +
          (drag && drag.to === doc.views.length && i === doc.views.length - 1 ? ' drop-after' : '')
        }
        data-tip={on ? t('再点一下：重命名、复制、换看法') : undefined}
        aria-haspopup={on ? 'menu' : undefined}
        aria-expanded={on ? pop?.kind === 'vmenu' : undefined}
        onMouseDown={(e) => startDrag(e, i)}
        onClick={(e) => {
          if (suppress.current) return
          if (!on) return void (setPop(null), pick(i))
          setPop(pop?.kind === 'vmenu' ? null : { kind: 'vmenu', i, at: anchorOf(e.currentTarget) })
        }}
        onDoubleClick={() => (setPop(null), setRenaming(i))}
      >
        <Codicon name={ICON[v.kind]} size={14} />
        <span>{v.name}</span>
        {on && <Codicon name="chevron-down" size={12} className="chev" />}
      </button>
    )
  }

  const groupLabel = () => {
    const g = o.res?.groupProp ?? view.groupBy?.prop ?? null
    if (view.kind === 'kanban') return g ? t('按「{col}」分列', { col: colText(g) }) : t('分列')
    if (view.kind === 'calendar') {
      const d = o.res?.dateProp ?? view.date
      return d ? t('按「{col}」排', { col: colText(d) }) : t('按哪一列排')
    }
    if (view.groupBy?.by) return view.groupBy.by === 'month' ? t('按月分组') : t('按周分组')
    return view.groupBy ? t('按「{col}」分组', { col: colText(view.groupBy.prop) }) : t('分组')
  }
  const tool = (kind: 'group' | 'vfilter' | 'vsort', icon: CodiconName, label: string, name: string, on: boolean) => (
    <button
      type="button"
      className={'base-tb' + (on ? ' on' : '')}
      data-tool={kind}
      aria-label={name}
      data-tip={iconsOnly ? label : undefined}
      aria-expanded={pop?.kind === kind}
      onClick={(e) => setPop(pop?.kind === kind ? null : ({ kind, at: anchorOf(e.currentTarget) } as ViewPop))}
    >
      <Codicon name={icon} size={14} />
      {!iconsOnly && <span className="lb">{label}</span>}
    </button>
  )

  /** 第二行：标签条（窄了收成下拉）…… 隐藏的列、分组、筛选、排序 */
  const bar = (
    <div className={'base-vbar' + (narrow ? ' narrow' : '')} /* 不翻：data-part 给 e2e 和样式认 */ data-part="视图标签条" ref={barRef}>
      {narrow ? (
        <button
          type="button"
          className="base-vtab on vsel"
          aria-label={t('切换视图：{name}', { name: view.name })}
          aria-haspopup="menu"
          aria-expanded={pop?.kind === 'vsel'}
          onClick={(e) => setPop(pop?.kind === 'vsel' ? null : { kind: 'vsel', at: anchorOf(e.currentTarget) })}
          onDoubleClick={() => (setPop(null), setRenaming(vi))}
        >
          <Codicon name={ICON[view.kind]} size={14} />
          {renaming === vi ? null : <span>{view.name}</span>}
          <Codicon name="chevron-down" size={12} className="chev" />
        </button>
      ) : (
        <span className="base-vtabs" role="tablist" aria-label={t('视图')}>
          {doc.views.map(tab)}
          <button
            type="button"
            className="base-vadd"
            aria-label={t('加一个视图')}
            data-tip={t('加一个视图')}
            aria-expanded={pop?.kind === 'vadd'}
            onClick={(e) => setPop(pop?.kind === 'vadd' ? null : { kind: 'vadd', at: anchorOf(e.currentTarget) })}
          >
            <Codicon name="add" size={14} />
          </button>
        </span>
      )}
      {narrow && renaming === vi && tab(view, vi)}
      <span className="sp" />
      <span className="base-tools">
        {o.lead}
        {tool('group', view.kind === 'calendar' ? 'calendar' : 'group-by-ref-type', groupLabel(), t('分组'), view.kind === 'table' || view.kind === 'cards' ? !!view.groupBy : false)}
        {tool('vfilter', 'filter', fN ? t('筛选 {n}', { n: fN }) : t('筛选'), t('筛选'), fN > 0)}
        {tool('vsort', 'arrow-swap', t('排序'), t('排序'), view.sort.length > 0)}
      </span>
    </div>
  )

  /** 第三行：开着的筛选、排序（点字开面板，× 去掉） */
  const chips =
    fN > 0 || view.sort.length > 0 ? (
      <div className="base-cbar" /* 不翻：data-part 给 e2e 和样式认 */ data-part="筛选排序小标签">
        {filter && fN > 0 && (
          <span className="base-fchip">
            <button
              type="button"
              className="t"
              onClick={(e) =>
                setPop({
                  kind: 'vfilter',
                  at: anchorOf(e.currentTarget.parentElement!),
                })
              }
            >
              <Codicon name="filter" size={12} />
              <span>{filterWords(filter, typeOf)}</span>
            </button>
            <button type="button" className="x" aria-label={t('去掉筛选')} onClick={() => (setPop(null), setFilter(null))}>
              <Codicon name="close" size={12} />
            </button>
          </span>
        )}
        {view.sort.map((s, k) => (
          <span key={s.prop} className="base-fchip">
            <button
              type="button"
              className="t"
              onClick={(e) =>
                setPop({
                  kind: 'vsort',
                  at: anchorOf(e.currentTarget.parentElement!),
                })
              }
            >
              <Codicon name={s.desc ? 'arrow-down' : 'arrow-up'} size={12} />
              <span>{colText(s.prop)}</span>
            </button>
            <button
              type="button"
              className="x"
              aria-label={t('不按「{col}」排', { col: colText(s.prop) })}
              onClick={() => (
                setPop(null),
                save(
                  (src) =>
                    setViewSort(
                      src,
                      vi,
                      view.sort.filter((_, j) => j !== k),
                    ),
                  inView(view.sort.length > 1 ? t('去掉了一个排序') : t('不排序了')),
                )
              )}
            >
              <Codicon name="close" size={12} />
            </button>
          </span>
        ))}
      </div>
    ) : null

  const item = (
    icon: CodiconName | null,
    label: string,
    run: () => void,
    opts: {
      checked?: boolean
      hint?: string
      disabled?: boolean
      danger?: boolean
      role?: string
    } = {},
  ) => (
    <button
      key={label}
      type="button"
      role={opts.role ?? (opts.checked !== undefined ? 'menuitemradio' : 'menuitem')}
      aria-checked={opts.checked}
      className={'mi' + (opts.danger ? ' danger' : '')}
      disabled={opts.disabled}
      onClick={run}
    >
      {icon && <Codicon name={icon} size={14} />}
      <span>{label}</span>
      {opts.checked ? <Codicon name="check" size={14} className="k" /> : opts.hint ? <span className="k">{opts.hint}</span> : null}
    </button>
  )

  /** 一个视图的菜单：重命名、复制、换看法、（画廊）封面、删除 */
  const viewItems = (i: number) => {
    const v = doc.views[i]!
    return (
      <>
        {item('edit', t('重命名'), () => (setPop(null), setRenaming(i)), { hint: t('双击标签') })}
        {item('copy', t('复制这个视图'), () => duplicate(i))}
        <div className="msep" />
        <div className="mlab">{t('看法')}</div>
        {VIEW_TYPES.map((x) => item(ICON[x.type], fmt(x.label), () => retype(i, x.type), { checked: v.kind === x.type }))}
        {v.kind === 'cards' && (
          <>
            <div className="msep" />
            <div className="mlab">{t('卡片上方')}</div>
            {item('file-media', t('正文第一张图（没图露前几行）'), () => (setPop(null), save((s) => setViewImage(s, i, null), t('画廊封面用正文第一张图'))), { checked: v.image !== 'none' })}
            {item('close', t('不要封面'), () => (setPop(null), save((s) => setViewImage(s, i, 'none'), t('画廊不要封面了'))), { checked: v.image === 'none' })}
          </>
        )}
        <div className="msep" />
        {item('trash', t('删除这个视图'), () => remove(i), { disabled: doc.views.length < 2, danger: true })}
      </>
    )
  }

  const popover = (() => {
    if (!pop) return null
    if (pop.kind === 'vmenu') {
      const v = doc.views[pop.i]
      if (!v) return null
      return (
        <FloatPop at={pop.at} className="base-pop base-vmenu" role="menu" aria-label={t('视图「{name}」', { name: v.name })} style={{ width: 248 }}>
          {viewItems(pop.i)}
        </FloatPop>
      )
    }
    if (pop.kind === 'vadd')
      return (
        <FloatPop at={pop.at} className="base-pop base-vmenu" role="menu" aria-label={t('加一个视图')} style={{ width: 240 }}>
          <div className="mlab">{t('加一个视图')}</div>
          {VIEW_TYPES.map((x) => item(ICON[x.type], fmt(x.label), () => add(x.type)))}
          <AiAddItem onPick={() => (setPop(null), openAiCol({ table: o.table, col: null }))} />
        </FloatPop>
      )
    // 标签收成下拉时（窄、或视图多放不下）：上面挑视图，下面是当前视图的菜单（和点当前标签出来的一样），最后加一个视图
    if (pop.kind === 'vsel')
      return (
        <FloatPop at={pop.at} className="base-pop base-vmenu" role="menu" aria-label={t('视图')} style={{ width: 248 }}>
          <div role="group" aria-label={t('视图')}>
            {doc.views.map((v, i) =>
              item(ICON[v.kind], v.name, () => (setPop(null), pick(i)), {
                checked: i === vi,
              }),
            )}
          </div>
          <div className="msep" />
          <div className="mlab">{t('「{name}」', { name: view.name })}</div>
          {viewItems(vi)}
          <div className="msep" />
          {item('add', t('加一个视图'), () => setPop({ kind: 'vadd', at: pop.at }))}
        </FloatPop>
      )
    if (pop.kind === 'group') {
      const cols = o.ctx ? o.ctx : null
      const all = cols ? Object.keys(cols.types).filter((k) => k !== 'file.name' && !k.startsWith('formula.')) : []
      for (const k of Object.keys(doc.props)) if (!all.includes(k)) all.push(k)
      if (view.kind === 'calendar') {
        const dates = all.filter((k) => typeOf(k) === 'date')
        const cur = o.res?.dateProp ?? view.date
        return (
          <FloatPop at={pop.at} className="base-pop base-vmenu" role="menu" aria-label={t('日历按哪一列排')} style={{ width: 240 }}>
            <div className="mlab">{t('日历按哪一列排')}</div>
            {dates.map((c) => item('calendar', colText(c), () => (setPop(null), save((s) => setViewDate(s, vi, c), inView(t('按「{col}」排', { col: colText(c) })))), { checked: cur === c }))}
            {!dates.length && <div className="mnone">{t('还没有日期列')}</div>}
          </FloatPop>
        )
      }
      const choices = all.filter((k) => GROUPABLE.has(typeOf(k)))
      const cur = o.res?.groupProp ?? view.groupBy?.prop ?? null
      const kanban = view.kind === 'kanban'
      return (
        <FloatPop at={pop.at} className="base-pop base-vmenu" role="menu" aria-label={t('分组')} style={{ width: 240 }}>
          <div className="mlab">{kanban ? t('看板按哪一列分列') : t('按哪一列分组')}</div>
          {!kanban && item('close', t('不分组'), () => (setPop(null), view.groupBy && save((s) => setViewGroup(s, vi, null), inView(t('不分组了')))), { checked: !view.groupBy })}
          {choices.map((c) =>
            item(
              typeOf(c) === 'status' ? 'issues' : 'group-by-ref-type',
              colText(c),
              () => (
                setPop(null),
                cur !== c || !view.groupBy
                  ? save((s) => setViewGroup(s, vi, { prop: c, desc: false }), inView(kanban ? t('按「{col}」分列', { col: colText(c) }) : t('按「{col}」分组', { col: colText(c) })))
                  : undefined
              ),
              {
                checked: kanban ? cur === c : view.groupBy?.prop === c,
              },
            ),
          )}
          {/* 日期列按月、按周分（task-i921u「通用合计」：每月小计写在组头）；看板拖卡会把「2026-11」写进格子，看板不给 */}
          {!kanban &&
            all
              .filter((k) => typeOf(k) === 'date')
              .flatMap((c) =>
                (['month', 'week'] as const).map((by) => {
                  const on = view.groupBy?.prop === c && view.groupBy.by === by
                  const what = by === 'month' ? t('按月分组') : t('按周分组')
                  // 按月、按周默认新的在前（原型 direction: DESC）
                  return item('calendar', by === 'month' ? t('{col} · 按月', { col: colText(c) }) : t('{col} · 按周', { col: colText(c) }), () => (setPop(null), on ? undefined : save((s) => setViewGroup(s, vi, { prop: c, by, desc: true }), inView(what))), { checked: on })
                }),
              )}
        </FloatPop>
      )
    }
    if (pop.kind === 'vfilter' && o.ctx) return <FilterPanel at={pop.at} ctx={o.ctx} view={view} filter={filter} left={o.res?.rows.length ?? 0} add={pop.add} onChange={setFilter} />
    if (pop.kind === 'vsort' && o.ctx) return <SortPanel at={pop.at} ctx={o.ctx} view={view} onChange={(sort, what) => save((s) => setViewSort(s, vi, sort), inView(what))} />
    return null
  })()

  return { bar, chips, popover, renaming }
}
