/**
 * 数据库的筛选面板和排序面板（第三批 task-i921u，照方向 A 原型）：
 * - 筛选：一行一条（当 / 且 ▾ / 或），第二行起选「且 / 或」；「加一组」在里面另算且 / 或（只套一层，和 Notion 一样）；右上「留下 N 条」当场变。
 *   值填好的那几条一改就写进当前视图（onChange → setViewFilter），没填完的只留在面板上；打字停手 300 毫秒再写。
 *   套了两层以上、写了 not 的筛选面板上不改（filterEditable），说一句去「改写法」。
 * - 排序：按哪几列、升序 / 降序，加一个、× 去掉，改了就写。
 * 条件、值、小标签都用 packages/format 的 FILTER_OPS、DAY_CHOICES、opLabel、statusGroups。
 */
import { Codicon } from '@cn/design'
import {
  allColumns,
  type BaseCond,
  type BaseCtx,
  type BaseFilter,
  type BaseSort,
  type BaseView,
  colTypeOf,
  DAY_CHOICES,
  type FieldType,
  FILTER_OPS,
  filterEditable,
  type FilterItem,
  isGroup,
  isRaw,
  isRelDay,
  listOf,
  opLabel,
  statusGroups,
} from '@cn/format'
import { useEffect, useRef, useState } from 'react'
import { useT } from '../i18n'
import { NUM_INPUT, numText, stopStep } from './cell-input'
import { colText, dayWords, fmt } from './words'
import { FloatPop, type PopAnchor } from '../pop-place'

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** 这一条填好了没有：要值的条件值不能空；数字那一列的值得是个数（打了一半、打错的只留在面板上） */
function complete(c: BaseCond, type: FieldType): boolean {
  const needs = FILTER_OPS[type]?.find((o) => o.op === c.op)?.value ?? true
  if (!needs) return true
  return type === 'number' ? !!numText(c.value) : c.value.trim() !== ''
}

/** 面板上的草稿 → 写进文件的筛选：没填完的条拿掉，空了的组拿掉 */
export function cleanFilter(f: BaseFilter, typeOf: (c: string) => FieldType): BaseFilter | null {
  const items = f.items.flatMap((x): FilterItem[] => {
    if (isGroup(x)) {
      const g = cleanFilter(x, typeOf)
      return g ? [g] : []
    }
    if (isRaw(x)) return [x]
    const type = typeOf(x.prop)
    if (!complete(x, type)) return []
    return [{ ...x, value: (type === 'number' ? numText(x.value) : null) ?? x.value.trim() }]
  })
  return items.length ? { conj: f.conj, items } : null
}

/** 一列新加的一条：第一个条件，勾选默认「是」 */
function freshCond(ctx: BaseCtx, prop: string): BaseCond {
  const type = colTypeOf(ctx, prop)
  return {
    prop,
    op: FILTER_OPS[type]?.[0]?.op ?? '==',
    value: type === 'check' ? 'true' : '',
  }
}

/** 选项、状态能选的值 */
function valuesOf(ctx: BaseCtx, prop: string): string[] {
  const type = colTypeOf(ctx, prop)
  if (type === 'status') return statusGroups(ctx, prop).flatMap((g) => g.options)
  const vs = ctx.recs.flatMap((r) => (type === 'multi' ? (r.lists[prop] ?? listOf(r.props[prop] ?? '')) : [r.props[prop] ?? '']))
  return [...new Set(vs.map((v) => v.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh'))
}

type Path = number[]
const at = (f: BaseFilter, p: Path): FilterItem => p.reduce<FilterItem>((x, i) => (x as BaseFilter).items[i]!, f)

export function FilterPanel(props: { at: PopAnchor; ctx: BaseCtx; view: BaseView; filter: BaseFilter | null; left: number; add?: string; onChange(f: BaseFilter | null): void }) {
  const t = useT()
  const { ctx } = props
  const typeOf = (c: string) => colTypeOf(ctx, c)
  const cols = allColumns(ctx)
  const firstCol = props.view.columns.find((c) => c !== 'file.name') ?? cols.find((c) => c.id !== 'file.name')?.id ?? 'file.name'
  const [draft, setDraft] = useState<BaseFilter>(() => {
    const f: BaseFilter = props.filter ? structuredClone(props.filter) : { conj: 'and', items: [] }
    if (props.add) f.items.push(freshCond(ctx, props.add))
    return f
  })
  const editable = filterEditable(props.filter)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  /** 草稿变了：填好的那几条写回（打字时停手 300 毫秒再写） */
  const change = (next: BaseFilter, wait = 0) => {
    setDraft(next)
    clearTimeout(timer.current)
    const run = () => props.onChange(cleanFilter(next, typeOf))
    if (wait) timer.current = setTimeout(run, wait)
    else run()
  }
  const edit = (fn: (f: BaseFilter) => void, wait = 0) => {
    const f = structuredClone(draft)
    fn(f)
    change(f, wait)
  }
  const drop = (p: Path) =>
    edit((f) => {
      const ps = [...p]
      const last = ps.pop()!
      const parent = (ps.length ? at(f, ps) : f) as BaseFilter
      parent.items.splice(last, 1)
      // 组里最后一条也去掉了：整组拿掉
      if (ps.length && !parent.items.length) {
        const gi = ps.pop()!
        ;((ps.length ? at(f, ps) : f) as BaseFilter).items.splice(gi, 1)
      }
    })

  const conjOf = (g: BaseFilter, p: Path, i: number, top: boolean) => {
    if (i === 0) return <span className="conj">{top ? t('当') : ''}</span>
    if (i === 1)
      return (
        <span className="conj">
          <select
            className="field"
            aria-label={t('且还是或')}
            value={g.conj === 'or' ? 'or' : 'and'}
            onChange={(e) => edit((f) => void (((p.length ? at(f, p) : f) as BaseFilter).conj = e.currentTarget.value as 'and' | 'or'))}
          >
            <option value="and">{t('且')}</option>
            <option value="or">{t('或')}</option>
          </select>
        </span>
      )
    return <span className="conj">{g.conj === 'or' ? t('或') : t('且')}</span>
  }

  const valueField = (c: BaseCond, p: Path) => {
    const type = typeOf(c.prop)
    const needs = FILTER_OPS[type]?.find((o) => o.op === c.op)?.value ?? true
    const set = (value: string, wait = 0) => edit((f) => void ((at(f, p) as BaseCond).value = value), wait)
    if (!needs) return <span className="val" />
    if (type === 'check')
      return (
        <select className="field op" aria-label={t('值')} value={c.value === 'false' ? 'false' : 'true'} onChange={(e) => set(e.currentTarget.value)}>
          <option value="true">{t('是')}</option>
          <option value="false">{t('否')}</option>
        </select>
      )
    if ((type === 'status' || type === 'select' || type === 'multi') && c.op !== 'contains' && c.op !== 'notcontains')
      return (
        <select className={'field val' + (c.value ? '' : ' empty')} aria-label={t('值')} value={c.value} onChange={(e) => set(e.currentTarget.value)}>
          <option value="">{t('选一个…')}</option>
          {[...new Set([...valuesOf(ctx, c.prop), ...(c.value ? [c.value] : [])])].map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      )
    if (type === 'date' && !DAY.test(c.value))
      return (
        <select
          className={'field val' + (c.value ? '' : ' empty')}
          aria-label={t('值')}
          value={c.value}
          onChange={(e) => {
            const v = e.currentTarget.value
            if (v !== 'pick') return set(v)
            const d = new Date()
            set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
          }}
        >
          <option value="">{t('选一天…')}</option>
          {DAY_CHOICES.map((d) => (
            <option key={d.value} value={d.value}>
              {fmt(d.label)}
            </option>
          ))}
          {isRelDay(c.value) && !DAY_CHOICES.some((d) => d.value === c.value) && <option value={c.value}>{dayWords(c.value)}</option>}
          <option value="pick">{t('挑一天…')}</option>
        </select>
      )
    return (
      <input
        className="field val"
        aria-label={t('值')}
        {...(type === 'number' ? NUM_INPUT : { type: type === 'date' ? 'date' : 'text' })}
        value={c.value}
        placeholder={t('值')}
        onChange={(e) => set(e.currentTarget.value, type === 'date' ? 0 : 300)}
        onKeyDown={(e) => {
          e.stopPropagation()
          stopStep(e)
        }}
      />
    )
  }

  const rows = (g: BaseFilter, p: Path) =>
    g.items.map((x, i) => {
      const q = [...p, i]
      if (isGroup(x))
        return (
          <div className="frow top" key={q.join('.')}>
            {conjOf(g, p, i, !p.length)}
            <div className="fgroup" role="group" aria-label={t('一组条件')}>
              <div className="gt">
                <span>{x.conj === 'or' ? t('这一组：满足任一条') : t('这一组：全部满足')}</span>
                <button type="button" className="ib" aria-label={t('去掉这一组')} onClick={() => drop(q)}>
                  <Codicon name="trash" size={14} />
                </button>
              </div>
              {rows(x, q)}
              <div className="frow">
                <span className="conj" />
                <button type="button" className="gbtn" onClick={() => edit((f) => void (at(f, q) as BaseFilter).items.push(freshCond(ctx, firstCol)))}>
                  <Codicon name="add" size={12} />
                  {t('在这组加一条')}
                </button>
              </div>
            </div>
          </div>
        )
      if (isRaw(x))
        return (
          <div className="frow" key={q.join('.')}>
            {conjOf(g, p, i, !p.length)}
            <code className="raw" data-tip={t('面板上改不了这一句：点「改写法」直接改')}>
              {x.raw}
            </code>
            <button type="button" className="ib" aria-label={t('去掉这一条')} onClick={() => drop(q)}>
              <Codicon name="close" size={14} />
            </button>
          </div>
        )
      const type = typeOf(x.prop)
      const ops = FILTER_OPS[type] ?? FILTER_OPS.text
      return (
        <div className="frow" key={q.join('.')}>
          {conjOf(g, p, i, !p.length)}
          <select
            className="field col"
            aria-label={t('列')}
            value={x.prop}
            onChange={(e) => {
              const c = freshCond(ctx, e.currentTarget.value)
              edit((f) => void Object.assign(at(f, q), c))
            }}
          >
            {[...cols.map((c) => c.id), ...(cols.some((c) => c.id === x.prop) ? [] : [x.prop])].map((id) => (
              <option key={id} value={id}>
                {colText(id)}
              </option>
            ))}
          </select>
          {type === 'check' ? (
            valueField(x, q)
          ) : (
            <select className="field op" aria-label={t('条件')} value={x.op} onChange={(e) => edit((f) => void ((at(f, q) as BaseCond).op = e.currentTarget.value as BaseCond['op']))}>
              {[...ops.map((o) => o.op), ...(ops.some((o) => o.op === x.op) ? [] : [x.op])].map((op) => (
                <option key={op} value={op}>
                  {fmt(ops.find((o) => o.op === op)?.label ?? opLabel(op, type))}
                </option>
              ))}
            </select>
          )}
          {type === 'check' ? <span className="val" /> : valueField(x, q)}
          <button type="button" className="ib" aria-label={t('去掉这一条')} onClick={() => drop(q)}>
            <Codicon name="close" size={14} />
          </button>
        </div>
      )
    })

  return (
    <FloatPop at={props.at} align="end" className="base-pop base-fpanel" role="dialog" aria-label={t('筛选')}>
      <div className="fhd">
        <b>{t('筛选「{name}」', { name: props.view.name })}</b>
        <span className="sub">{t('改了就存进这个视图')}</span>
        <span className="left">{t('留下 {n} 条', { n: props.left })}</span>
      </div>
      {editable ? (
        <>
          <div className="fbody">{draft.items.length ? rows(draft, []) : <div className="none">{t('还没有条件')}</div>}</div>
          <div className="ffoot">
            <button type="button" className="gbtn" onClick={() => edit((f) => void f.items.push(freshCond(ctx, firstCol)))}>
              <Codicon name="add" size={12} />
              {t('加一条')}
            </button>
            <button
              type="button"
              className="gbtn"
              onClick={() =>
                edit(
                  (f) =>
                    void f.items.push({
                      conj: 'or',
                      items: [freshCond(ctx, firstCol)],
                    }),
                )
              }
            >
              <Codicon name="add" size={12} />
              {t('加一组（组里另算且 / 或）')}
            </button>
            {draft.items.length > 0 && (
              <button type="button" className="gbtn end" onClick={() => change({ conj: 'and', items: [] })}>
                {t('全部去掉')}
              </button>
            )}
          </div>
        </>
      ) : (
        <div className="fbody">
          <div className="none">{t('这个视图的筛选套了两层以上：点「改写法」直接改')}</div>
          <div className="ffoot">
            <button type="button" className="gbtn end" onClick={() => change({ conj: 'and', items: [] })}>
              {t('全部去掉')}
            </button>
          </div>
        </div>
      )}
    </FloatPop>
  )
}

/** 排序面板：按哪几列、升序 / 降序；改了就写（onChange 带一句「按「日期」升序」） */
export function SortPanel(props: { at: PopAnchor; ctx: BaseCtx; view: BaseView; onChange(sort: BaseSort[], what: string): void }) {
  const t = useT()
  const { view } = props
  const cols = allColumns(props.ctx).map((c) => c.id)
  const say = (s: BaseSort) =>
    t('按「{col}」{dir}', {
      col: colText(s.prop),
      dir: s.desc ? t('降序') : t('升序'),
    })
  const set = (next: BaseSort[], what: string) => props.onChange(next, what)
  return (
    <FloatPop at={props.at} align="end" className="base-pop base-spanel" role="dialog" aria-label={t('排序')}>
      <div className="mlab">{t('排序「{name}」', { name: view.name })}</div>
      {view.sort.length ? (
        view.sort.map((s, i) => (
          <div className="frow" key={i}>
            <select
              className="field col"
              aria-label={t('排序的列')}
              value={s.prop}
              onChange={(e) => {
                const n = { prop: e.currentTarget.value, desc: s.desc }
                set(
                  view.sort.map((x, k) => (k === i ? n : x)).filter((x, k, a) => a.findIndex((y) => y.prop === x.prop) === k),
                  say(n),
                )
              }}
            >
              {[...new Set([...cols, s.prop])].map((c) => (
                <option key={c} value={c}>
                  {colText(c)}
                </option>
              ))}
            </select>
            <select
              className="field dir"
              aria-label={t('升序还是降序')}
              value={s.desc ? 'desc' : 'asc'}
              onChange={(e) => {
                const n = {
                  prop: s.prop,
                  desc: e.currentTarget.value === 'desc',
                }
                set(
                  view.sort.map((x, k) => (k === i ? n : x)),
                  say(n),
                )
              }}
            >
              <option value="asc">{t('升序')}</option>
              <option value="desc">{t('降序')}</option>
            </select>
            <button
              type="button"
              className="ib"
              aria-label={t('去掉这个排序')}
              onClick={() =>
                set(
                  view.sort.filter((_, k) => k !== i),
                  view.sort.length > 1 ? t('去掉了一个排序') : t('不排序了'),
                )
              }
            >
              <Codicon name="close" size={14} />
            </button>
          </div>
        ))
      ) : (
        <div className="none">{t('没排序：照文件名')}</div>
      )}
      <div className="sadd">
        <button
          type="button"
          className="gbtn"
          disabled={cols.every((c) => view.sort.some((s) => s.prop === c))}
          onClick={() => {
            const prop = [...view.columns.filter((c) => c !== 'file.name'), ...cols].find((c) => !view.sort.some((s) => s.prop === c))!
            const n = { prop, desc: false }
            set([...view.sort, n], say(n))
          }}
        >
          <Codicon name="add" size={12} />
          {t('加一个排序')}
        </button>
      </div>
    </FloatPop>
  )
}
