/**
 * 数据库的看板 / 日历 / 画廊三种看法（数据库第三批第 2 块，task-i921u；样子照 14-数据库第三批 方向 A 原型）。
 * 表格以外的看法由这里分派：BaseTable 画块头和表底那一句，中间这一块换成 BaseKanban / BaseCalendar / BaseGallery。
 *
 * 算行、取一格的字、改一条全用 packages/format：queryView（筛选排序、看板分列、日历按天）、cellOf、cardColumns、
 * writeCell（拖卡换组只换「状态:」那一行）、moveToDay（拖日期只换「日期:」那一行，拖回「没排日子的」拿掉这一行）。
 * 只看不写：打开、切月份、点开一条都不碰文件；翻到哪个月记在本机（localStorage）。
 *
 * 拖动用画布今日抽出来的共用日历组件 @cn/calendar 的 useDragDrop（按住挪过 5 才算拖、名字小牌跟着鼠标、落点亮一圈）：
 * 看板卡、日历条都是 data-drag，看板一列、日历一格、「没排日子的」都是 data-drop。页面上可能有好几个数据库，
 * 拖的名字、看板列的名字前面带这一块自己的编号，别的块的不认。
 */
import { Codicon } from '@cn/design'
import { useDragDrop } from '@cn/calendar'
import {
  type BaseCtx,
  type BaseRec,
  cellOf,
  colTypeOf,
  columnInfo,
  defaultGroupProp,
  type FileWrite,
  listOf,
  moveToDay,
  queryView,
  statusGroups,
  statusTone,
  undoWrites,
  type ViewResult,
  writeCell,
} from '@cn/format'
import { useMemo, useRef } from 'react'
import { t } from '../../shared/i18n'
import { app } from '../ctx/actions'
import { BaseCalendar } from './BaseCalendar'
import { BaseGallery } from './BaseGallery'
import { BaseKanban } from './BaseKanban'
import type { BaseCellWrite } from './BaseTable'
import { writeFiles } from './layout-ctx'
import { openRecord } from './record-open'
import './base-layouts.css'

/** 文档里每个视图最多铺 50 条、看板每列 20 张，多了整页打开看全部（设计页「量大时怎么收」） */
export const INLINE_CARDS = 50
export const INLINE_COLUMN = 20

/** 几块的 data-part（e2e、对照截图找它用的名字）；不翻：不给人看 */
export const PART = { kb: '看板', col: '看板一列', cal: '日历', tray: '没排日子的', gal: '画廊' }

/** 这一块是不是要画成看板 / 日历 / 画廊（表格照旧由 BaseTable 画） */
export const isLayoutView = (kind: string) => kind === 'kanban' || kind === 'calendar' || kind === 'cards'

/** 点一条：打开那一篇（第 4 块把这里换成在右栏开一个标签） */

/** 状态在哪一组的颜色（原型 .g0 .g1 .g2）：第一组灰、最后一组绿、中间黄；不是状态的灰 */
export function toneColor(ctx: BaseCtx, prop: string | null, value: string): string {
  if (!prop || colTypeOf(ctx, prop) !== 'status') return 'var(--t3)'
  const tone = statusTone(ctx, prop, value)
  const n = statusGroups(ctx, prop).length
  return tone <= 0 ? 'var(--t3)' : tone === n - 1 ? 'var(--green)' : 'var(--yellow)'
}

/** 2026-11-17 → 「11月17日」（规范里的日期写法）；不是今年的带年；带钟点的跟在后面 */
export function dayText(text: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}:\d{2}))?/.exec(text.trim())
  if (!m) return text
  const [, y, mo, d, time] = m
  const p = { y: Number(y), m: Number(mo), d: Number(d) }
  const md = p.y === new Date().getFullYear() ? t('{m}月{d}日', p) : t('{y}年{m}月{d}日', p)
  return md + (time ? ` ${time}` : '')
}

/** 卡片上的一项（看板卡下面那行、画廊卡名字下面那行）：日期带日历图标、汇总带图标和「1/2」、状态带小圆点；空的不画 */
export function CardField(props: { ctx: BaseCtx; rec: BaseRec; col: string; plain?: boolean }) {
  const { ctx, rec, col } = props
  const key = col.replace(/^note\./, '')
  const cell = cellOf(ctx, rec, col)
  const type = colTypeOf(ctx, key)
  if (cell.error) return null
  if (type === 'rollup' && cell.progress)
    return (
      <span className="bl-f" data-col={columnInfo(ctx, col).label}>
        {!props.plain && <Codicon name="references" size={12} />}
        {`${cell.progress[0]}/${cell.progress[1]}`}
      </span>
    )
  if (cell.value === null || cell.text === '' || (Array.isArray(cell.value) && !cell.value.length)) return null
  if (type === 'check') return cell.value === true ? <span className="bl-f">{columnInfo(ctx, col).label}</span> : null
  if (type === 'date')
    return (
      <span className="bl-f" data-col={columnInfo(ctx, col).label}>
        {!props.plain && <Codicon name="calendar" size={12} />}
        {dayText(cell.text)}
      </span>
    )
  if (type === 'status' || type === 'select')
    return (
      <span className="bl-f" data-col={columnInfo(ctx, col).label}>
        <i className="bl-dot" style={{ background: toneColor(ctx, key, cell.text) }} />
        {cell.text}
      </span>
    )
  const text = cell.links ? cell.links.map((l) => l.name).join('、') : type === 'multi' ? listOf(cell.text).join('、') : cell.text
  return (
    <span className={'bl-f' + (type === 'formula' || type === 'number' ? ' fx' : '')} data-col={columnInfo(ctx, col).label}>
      {text}
    </span>
  )
}

let seq = 0

export interface BaseLayoutProps {
  /** ```base 块里的 YAML */
  src: string
  /** 这一块的数据（BaseTable 用 useBaseData 读好交过来，表格和三种看法同一份） */
  ctx: BaseCtx | null
  /** 开它的那张表（右栏「记录」跟上这张表的写法、视图） */
  from?: string
  /** 画第几个视图 */
  view: number
  /** 整页打开（画廊五列、看板每列不收） */
  full?: boolean
  /** 白板上展开的数据库：改好一条交给白板说「写进 …」、能撤回（文档里用底栏提示） */
  onCell?(w: BaseCellWrite): void
}

/** 拖着改一条之后要说的：哪一篇、哪一列、改成什么 */
interface Said {
  rec: BaseRec
  col: string
  /** 给人看的新值（11月25日、在学）；空是清掉了 */
  shown: string
}

export function BaseLayout(props: BaseLayoutProps) {
  const { ctx } = props
  /** 点一条：在右栏「记录」标签开（第 4 块），↑ ↓ 照这个视图的顺序 */
  const open = (path: string) => openRecord({ path, src: props.src, view: props.view, ...(props.from ? { from: props.from } : {}) })
  const res = useMemo<ViewResult | null>(() => (ctx ? queryView(ctx, props.view) : null), [ctx, props.view])
  /** 这一块自己的编号：拖的名字、看板列的名字前面带它 */
  const id = useRef(`bl${++seq}`).current
  const keyOf = (path: string) => `${id}|${path}`
  const pathOf = (key: string) => (key.startsWith(id + '|') ? key.slice(id.length + 1) : null)
  const recOf = (key: string) => {
    const p = pathOf(key)
    return p === null ? null : (ctx?.recs.find((r) => r.path === p) ?? null)
  }
  /** 拖完正在写（写完重读之前不再接着拖同一条） */
  const busy = useRef(false)

  const commit = async (ws: FileWrite[], said: Said) => {
    if (!ws.length || !ctx) return
    busy.current = true
    try {
      const folder = ctx.doc.folder
      const ok = await writeFiles(ws, folder)
      if (!ok)
        return app().notice(
          t('《{name}》刚被别处改过，没改成，再试一次', {
            name: said.rec.name,
          }),
        )
      const col = columnInfo(ctx, said.col).label
      const text = said.shown
        ? t('「{name}」的{col}改成了「{value}」', {
            name: said.rec.name,
            col,
            value: said.shown,
          })
        : t('「{name}」的{col}清掉了', { name: said.rec.name, col })
      const w = ws[0]!
      if (props.onCell && ws.length === 1)
        props.onCell({
          path: w.path,
          name: said.rec.name,
          col,
          value: said.shown,
          before: w.before,
          after: w.after,
        })
      else app().noticeUndo(`${text} · ${t('写进 {path}', { path: w.path })}`, () => void writeFiles(undoWrites(ws), folder).then((back) => !back && app().notice(t('那一条刚被别处改过，撤不回了'))))
    } finally {
      busy.current = false
    }
  }

  /** 看板：拖到第 g 列（分组那一列的值换成这一列的） */
  const toGroup = (rec: BaseRec, g: number) => {
    if (!ctx || !res?.groups || !res.groupProp) return
    const group = res.groups[g]
    const prop = res.groupProp
    if (!group || group.rows.includes(rec)) return
    const type = colTypeOf(ctx, prop)
    if (type === 'relation') return app().notice(t('按关联分的组不能拖：去格子里勾'))
    let value: string | string[] | boolean | null = group.key === '' ? null : group.key
    if (type === 'check') value = group.key === 'true'
    if (type === 'multi') {
      const from = res.groups.find((x) => x.rows.includes(rec))
      const now = rec.lists[prop] ?? listOf(rec.props[prop] ?? '')
      value = group.key === '' ? [] : [...now.filter((x) => x !== from?.key), group.key]
    }
    void commit(writeCell(ctx, rec.path, prop, value), {
      rec,
      col: prop,
      shown: type === 'check' ? group.label : group.key,
    })
  }

  /** 日历：拖到哪天（null：拖回「没排日子的」） */
  const toDay = (rec: BaseRec, day: string | null) => {
    if (!ctx || !res?.dateProp) return
    void commit(moveToDay(ctx, rec.path, res.dateProp, day), {
      rec,
      col: res.dateProp,
      shown: day ? dayText(day) : '',
    })
  }

  useDragDrop({
    title: (key) => (busy.current ? null : (recOf(key)?.name ?? null)),
    drop: (key, target) => {
      const rec = recOf(key)
      if (!rec) return
      const i = target.indexOf(':')
      const kind = target.slice(0, i)
      const value = target.slice(i + 1)
      if (kind === `${id}k`) toGroup(rec, Number(value))
      else if (kind === 'mday') toDay(rec, value)
      else if (kind === `${id}none`) toDay(rec, null)
    },
    click: (key) => {
      const p = pathOf(key)
      if (p !== null) open(p)
    },
  })

  if (!ctx || !res) return <div className="bl-wait">{t('正在读…')}</div>
  const kind = res.view.kind
  const shared = { ctx, res, id, keyOf, view: props.view, full: !!props.full, open }
  if (kind === 'kanban') return <BaseKanban {...shared} />
  if (kind === 'calendar') return <BaseCalendar {...shared} dot={(rec) => toneColor(ctx, defaultGroupProp(ctx), rec.props[defaultGroupProp(ctx) ?? ''] ?? '')} />
  return <BaseGallery {...shared} />
}

/** 三种看法共用的入参 */
export interface LayoutPart {
  ctx: BaseCtx
  res: ViewResult
  /** 这一块的编号（看板列 data-drop 的名字前缀） */
  id: string
  /** 一条的拖动名字（data-drag） */
  keyOf(path: string): string
  view: number
  full: boolean
  /** 点一条：在右栏开 */
  open(path: string): void
}
