/**
 * 数据库第三批第 5 块（task-i921u）：关联、汇总、公式三种列，和状态列的格子（照设计页方向 A 的原型 proto-a.html）。
 * - 格子怎么画：关联是一排能点的小块（点了开那一篇，点格子别处出选择）、汇总是小进度条和「1/2」、公式是算出来的字（写错了格子里一句「算不出」，悬停看哪里错）、
 *   状态是带组颜色圆点的小块；日期写「11月10日」。
 * - 加一列的菜单分三组（基本、连起来、算出来）：关联选连到哪个数据库、两边都写（方角开关，默认开）；汇总先按第一个关联列建好、在列菜单里改；公式开公式框。
 * - 列菜单里：关联列说连到哪、两边都写；汇总列三个下拉（顺着、那边的、算）；公式列「改公式…」。
 * - 关联的选择：能搜，勾上 / 去掉两边都写（packages/format 的 toggleRelation 算两篇，主进程 base:write 一次写、一次提交，底部能撤回）；
 *   两边对不上时块底说一句、点「补上」（relationIssues、fixRelationIssue）。
 * - 公式框：写法同筛选，列名、函数、常用例子点一下插进去（formulaScope、formulaExamples），边打边算前 4 条（previewFormula），
 *   写错一句中文、指到哪个字（checkFormula 的 error / at），写错时「完成」灰着，⌘↵ 完成。
 * 算什么、写什么都调 packages/format，这里只画和接线。
 */
import { Codicon, type CodiconName } from '@cn/design'
import {
  ADD_COLUMN,
  type BaseCtx,
  type BaseRec,
  type Cell,
  cellOf,
  checkFormula,
  colTypeOf,
  type ColType,
  exprRef,
  type FieldType,
  type FileWrite,
  fixRelationIssue,
  isDateV,
  formulaExamples,
  formulaScope,
  FUNCS,
  linkedFrom,
  type PropDef,
  previewFormula,
  relationChoices,
  relationIssues,
  relationLinks,
  type RelationIssue,
  type RelLink,
  ROLLUP_CALCS,
  type RollupCalc,
  statusGroups,
  statusTone,
  toggleRelation,
  undoWrites,
} from '@cn/format'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { BoardBase } from '../../shared/api'
import { t, tv } from '../../shared/i18n'
import { fmt } from './words'
import { titleOf } from '../../shared/layout'
import { dateText } from '../../shared/when'
import { app } from '../ctx/actions'
import { composing } from '../ime'
import { keyFor } from '../keys'
import { anchorOf, FloatPop, type PopAnchor } from '../pop-place'
import { linkedSrc, openRecord, type PeekEditorProps, registerPeekEditor } from './record-open'
import './cols.css'

/** 每种列在表头、菜单里的图标（照原型） */
export const FIELD_ICON: Record<FieldType, CodiconName> = {
  title: 'symbol-string',
  text: 'symbol-string',
  number: 'symbol-numeric',
  select: 'arrow-circle-down',
  multi: 'list-unordered',
  status: 'issues',
  date: 'calendar',
  check: 'check',
  url: 'link',
  relation: 'references',
  rollup: 'symbol-operator',
  formula: 'symbol-method',
  button: 'play',
}

/** 这几种列的格子归这个文件画 */
export const OWN_CELLS = new Set<FieldType>(['relation', 'rollup', 'formula', 'status'])

/** 数据库的名字：数据源文件夹最后一段 */
export const dbNameOf = (folder: string) => folder.split('/').pop() ?? folder

/** 关联小块上的字：名字以那边数据库的名字开头的去掉它（「练习 3.1」在「练习」里写「3.1」），悬停看全名 */
export const shortLink = (name: string, to: string) => {
  const db = dbNameOf(to)
  return name.startsWith(db + ' ') && name.length > db.length + 1 ? name.slice(db.length + 1) : name
}

/** 「也在第1讲、第2讲」：名字有空格的取第一段 */
const brief = (name: string) => (name.includes(' ') ? name.split(' ')[0]! : name)

/** 日期格子：今年「11月10日」，往年带年；写的不是日期的照写 */
export function dayText(v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v.trim())
  if (!m) return v
  return dateText(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime())
}

/** 写在「%」前面的数：公式算出「50%」时画小进度条 */
const percentOf = (s: string) => {
  const m = /^(-?\d+(?:\.\d+)?)%$/.exec(s.trim())
  return m ? Math.max(0, Math.min(100, Number(m[1]))) : null
}

function Bar(props: { ratio: number }) {
  return (
    <span className="base-bar" aria-hidden>
      <b style={{ width: `${Math.round(props.ratio * 100)}%` }} />
    </span>
  )
}

/** 关联、汇总、公式、状态的格子（表格里点格子做什么由表格管） */
export function OwnCell(props: { ctx: BaseCtx; rec: BaseRec; col: string; type: FieldType }) {
  const { ctx, rec, col, type } = props
  const c: Cell = useMemo(() => cellOfSafe(ctx, rec, col), [ctx, rec, col])
  if (type === 'status') {
    const v = rec.props[col.replace(/^note\./, '')]?.trim() ?? ''
    if (!v) return null
    return (
      <span className="base-st">
        <i className={'g' + Math.max(0, statusTone(ctx, col.replace(/^note\./, ''), v))} />
        {v}
      </span>
    )
  }
  if (type === 'relation') {
    const def = ctx.doc.props[col.replace(/^note\./, '')]
    const to = def?.type === 'relation' ? def.to : ''
    return (
      <span className="base-rels">
        {(c.links ?? []).map((l, i) => (
          <RelChip key={l.raw + i} link={l} to={to} ctx={props.ctx} col={props.col} />
        ))}
      </span>
    )
  }
  if (c.error)
    return (
      <span className="base-err" data-tip={c.error}>
        {t('算不出')}
      </span>
    )
  if (c.progress) {
    const [a, b] = c.progress
    return (
      <>
        <Bar ratio={b ? a / b : 0} />
        <span className="base-fx">{c.text}</span>
      </>
    )
  }
  const pct = type === 'formula' ? percentOf(c.text) : null
  if (pct !== null)
    return (
      <>
        <Bar ratio={pct / 100} />
        <span className="base-fx">{c.text}</span>
      </>
    )
  return <span className="base-fx">{isDateV(c.value) ? dayText(c.text) : c.text}</span>
}

/** cellOf 不抛（公式写坏了、汇总顺着的列删了也只是这一格算不出） */
function cellOfSafe(ctx: BaseCtx, rec: BaseRec, col: string): Cell {
  try {
    return cellOf(ctx, rec, col)
  } catch (e) {
    return { value: null, text: '', error: String((e as Error).message ?? e), computed: true }
  }
}

/** 关联格子里连着的一篇：能点（在右栏「记录」开那一篇，照第 4 块）；那边没有这一篇的划掉 */
function RelChip(props: { link: RelLink; to: string; ctx: BaseCtx; col: string }) {
  const { link } = props
  const label = shortLink(link.name, props.to)
  return (
    <button
      type="button"
      className={'base-rel' + (link.path ? '' : ' gone')}
      data-peek-href={link.path ?? undefined}
      data-tip={link.path ? (label === link.name ? undefined : link.name) : t('那边没有「{name}」', { name: link.name })}
      aria-label={link.path ? t('打开「{name}」', { name: link.name }) : t('那边没有「{name}」', { name: link.name })}
      disabled={!link.path}
      onClick={(e) => {
        e.stopPropagation()
        if (link.path) openRecord({ path: link.path, src: linkedSrc(props.ctx, props.col) }, { push: true })
      }}
    >
      <Codicon name="file" size={12} />
      <span>{label}</span>
    </button>
  )
}

// ---------------------------------------------------------------- 写几篇（主进程一次提交）、撤回

/**
 * 关联两边写、补上对不上的：几篇一起交给主进程（base:write）写、一次提交；底部提示能撤回（撤回也是一次）。
 * folders：写完要重读的数据库（这一个和关联连到的那一个）
 */
export async function writeBase(ws: FileWrite[], said: string, message: string, folders: string[]): Promise<boolean> {
  if (!ws.length) return true
  const r = await window.cn.baseWrite(ws, message)
  const reload = () => folders.forEach((f) => window.dispatchEvent(new CustomEvent('cn-base-wrote', { detail: f })))
  if (!r.ok) {
    app().notice(t('《{name}》刚被别处改过，没改成，再试一次', { name: titleOf(r.path) }))
    reload()
    return false
  }
  reload()
  if (r.commitError) app().notice(r.commitError)
  else
    app().noticeUndo(said, () => {
      void (async () => {
        const back = await window.cn.baseWrite(undoWrites(ws), tv('撤回：{what}', { what: message }))
        reload()
        app().notice(back.ok ? t('撤回了，{n} 篇回到改之前', { n: ws.length }) : t('《{name}》刚被别处改过，没撤回', { name: titleOf(back.path) }))
      })()
    })
  return true
}

// ---------------------------------------------------------------- 关联的选择

/** 点关联格子：搜、勾几篇（两边都写时勾一下改两篇） */
export function RelationPick(props: { at: PopAnchor; ctx: BaseCtx; path: string; col: string }) {
  const { ctx, path, col } = props
  const rec = ctx.recs.find((r) => r.path === path)
  const def = ctx.doc.props[col]
  const [q, setQ] = useState('')
  /** 写着（还没重读回来）：这时不让再点，免得拿旧的字去算 */
  const [busy, setBusy] = useState<BaseCtx | null>(null)
  useEffect(() => {
    if (busy && busy !== ctx) setBusy(null)
  }, [ctx, busy])
  if (!rec || def?.type !== 'relation') return null
  const db = dbNameOf(def.to)
  const on = new Set(relationLinks(ctx, rec, col).map((l) => l.path))
  const all = relationChoices(ctx, col)
  const list = all.filter((r) => !q.trim() || r.name.toLowerCase().includes(q.trim().toLowerCase()))
  const toggle = async (target: BaseRec) => {
    if (busy) return
    const was = on.has(target.path)
    const ws = toggleRelation(ctx, path, col, target.name, !was)
    if (!ws.length) return
    setBusy(ctx)
    const both = ws.length > 1
    const said = was ? t('「{a}」和「{b}」不连了', { a: rec.name, b: target.name }) : t('「{a}」连上了「{b}」', { a: rec.name, b: target.name })
    const ok = await writeBase(
      ws,
      both ? t('{what} · 写进 {n} 篇', { what: said, n: ws.length }) : said,
      was ? tv('数据库：「{a}」不再连着「{b}」', { a: rec.name, b: target.name }) : tv('数据库：「{a}」连上「{b}」', { a: rec.name, b: target.name }),
      [...new Set([ctx.doc.folder ?? '', def.to].filter(Boolean))],
    )
    if (!ok) setBusy(null)
  }
  return (
    <FloatPop at={props.at} className="base-pop base-relpick" role="dialog" aria-label={`${rec.name} · ${col}`}>
      <input
        className="base-field"
        autoFocus
        placeholder={t('找一条')}
        aria-label={t('找一条')}
        value={q}
        onChange={(e) => setQ(e.currentTarget.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (composing(e)) return
          if (e.key === 'Enter' && list[0]) void toggle(list[0])
        }}
      />
      <div className="hd">{def.twoWay ? t('连到「{db}」里的哪几条 · 两边都写', { db }) : t('连到「{db}」里的哪几条', { db })}</div>
      <div className="base-relpick-list" aria-busy={!!busy}>
        {list.map((r) => {
          const also = linkedFrom(ctx, col, r.path)
            .filter((x) => x.path !== path)
            .map((x) => brief(x.name))
          const checked = on.has(r.path)
          return (
            <button key={r.path} type="button" role="menuitemcheckbox" aria-checked={checked} disabled={!!busy} onClick={() => void toggle(r)}>
              <span className={'base-cb' + (checked ? ' on' : '')}>{checked && <Codicon name="check" size={12} />}</span>
              <span className="n">{r.name}</span>
              {also.length > 0 && <span className="k">{t('也在{names}', { names: also.join('、') })}</span>}
            </button>
          )
        })}
        {!list.length && <div className="base-empty">{all.length ? t('没有找到') : t('「{db}」里还没有一条', { db })}</div>}
      </div>
      <div className="base-note">{def.twoWay ? t('勾一下改两篇：这一条的「{a}」和那一篇的「{b}」', { a: col, b: def.twoWay }) : t('勾一下改这一条的「{a}」', { a: col })}</div>
    </FloatPop>
  )
}

// ---------------------------------------------------------------- 状态的选择

/** 点状态格子：按组列出选项（待开始、进行中、完成），选一个就改 */
/**
 * 键盘开的选择（task-cle3x 格子焦点：选中状态格按回车）：焦点落在选着的那一项（没选过落在第一项），↑ ↓ 换一项，回车选它，Esc 收起
 */
function FocusFirst() {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const pop = ref.current?.parentElement
    const items = [...(pop?.querySelectorAll<HTMLElement>('[role=menuitemradio]') ?? [])]
    ;(items.find((b) => b.getAttribute('aria-checked') === 'true') ?? items[0])?.focus()
  }, [])
  return <span ref={ref} hidden />
}
function stepOptions(e: React.KeyboardEvent<HTMLElement>) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  e.preventDefault()
  e.stopPropagation()
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role=menuitemradio]')]
  const i = items.indexOf(document.activeElement as HTMLElement)
  items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
}

export function StatusPick(props: { at: PopAnchor; ctx: BaseCtx; path: string; col: string; onPick(v: string): void }) {
  const { ctx, col } = props
  const rec = ctx.recs.find((r) => r.path === props.path)
  if (!rec) return null
  const cur = rec.props[col]?.trim() ?? ''
  return (
    <FloatPop at={props.at} className="base-pop base-colmenu base-stpick" role="dialog" aria-label={`${rec.name} · ${col}`} onKeyDown={stepOptions}>
      <FocusFirst />
      {statusGroups(ctx, col).map((g, i) => (
        <div key={g.name} role="group" aria-label={g.name}>
          <div className="hd">{g.name}</div>
          {g.options.map((o) => (
            <button key={o} type="button" role="menuitemradio" aria-checked={cur === o} onClick={() => props.onPick(o)}>
              <span>
                <span className="base-st">
                  <i className={'g' + i} />
                  {o}
                </span>
              </span>
              {cur === o && <Codicon name="check" size={14} />}
            </button>
          ))}
        </div>
      ))}
    </FloatPop>
  )
}

// ---------------------------------------------------------------- 加一列

/** 加一列选了什么 */
export type AddChoice = { kind: 'basic'; name: string; type: ColType | 'status' } | { kind: 'relation'; name: string; to: string; twoWay: boolean } | { kind: 'rollup'; name: string } | { kind: 'formula'; name: string }

/** 表头「+」、列菜单「左边 / 右边插入一列」：名字框 + 三组（基本、连起来、算出来）；关联再选连到哪个数据库 */
export function AddCol(props: { at: PopAnchor; ctx: BaseCtx | null; folder: string; onAdd(c: AddChoice): void; extra?: React.ReactNode }) {
  const [name, setName] = useState('')
  const [rel, setRel] = useState(false)
  const [twoWay, setTwoWay] = useState(true)
  const [bases, setBases] = useState<BoardBase[] | null>(null)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!rel || bases) return
    let live = true
    void window.cn.boardBases().then((b) => live && setBases(b))
    return () => void (live = false)
  }, [rel, bases])
  const hasRelation = !!props.ctx && Object.values(props.ctx.doc.props).some((d) => d.type === 'relation')
  const pick = (type: FieldType) => {
    const n = name.trim()
    if (type === 'relation') return setRel(true)
    if (type === 'formula') return props.onAdd({ kind: 'formula', name: n })
    if (type === 'rollup') {
      if (!hasRelation) return app().notice(t('先加一列关联：汇总是顺着关联去数那边的'))
      return props.onAdd({ kind: 'rollup', name: n })
    }
    props.onAdd({ kind: 'basic', name: n, type: type as ColType | 'status' })
  }
  if (rel)
    return (
      <FloatPop at={props.at} className="base-pop base-colmenu base-addcol" role="dialog" aria-label={t('新的关联列')}>
        <div className="hd">{t('关联到哪个数据库')}</div>
        {bases === null && <div className="base-empty">{t('正在读…')}</div>}
        {bases?.map((b) => (
          <button key={b.folder} type="button" role="menuitem" onClick={() => props.onAdd({ kind: 'relation', name: name.trim(), to: b.folder, twoWay })}>
            <Codicon name="database" size={14} />
            <span>{b.name}</span>
            <span className="k">{t('{folder} · {n}条', { folder: b.folder, n: b.count })}</span>
          </button>
        ))}
        {bases?.length === 0 && <div className="base-empty">{t('库里还没有数据库')}</div>}
        <div className="sep" />
        <label className="base-swrow">
          <span>{t('两边都写')}</span>
          <button type="button" className={'sw-toggle' + (twoWay ? ' on' : '')} role="switch" aria-checked={twoWay} aria-label={t('两边都写')} onClick={() => setTwoWay((x) => !x)} />
        </label>
        <div className="base-note">{twoWay ? t('那边每一篇也多一列「{db}」，改一边另一边跟着改。', { db: dbNameOf(props.folder) }) : t('只写这一边：那边的笔记不动。')}</div>
      </FloatPop>
    )
  return (
    <FloatPop at={props.at} className="base-pop base-colmenu base-addcol" role="dialog" aria-label={t('加一列')}>
      <input
        ref={ref}
        className="base-field"
        autoFocus
        placeholder={t('新的一列叫什么')}
        aria-label={t('新的一列叫什么')}
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (composing(e)) return
          if (e.key === 'Enter' && name.trim()) pick('text')
        }}
      />
      {ADD_COLUMN.map((g) => (
        <div key={g.group} role="group" aria-label={fmt(g.group)}>
          <div className="hd">{fmt(g.group)}</div>
          <div className="base-types">
            {g.items.map((it) => (
              <button key={it.type} type="button" role="menuitem" onClick={() => pick(it.type)}>
                <Codicon name={FIELD_ICON[it.type]} size={14} />
                <span>{fmt(it.label)}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      {/* 最下面一组：「AI 生成一列」（数据库 AI 列，ai-cells.tsx） */}
      {props.extra}
    </FloatPop>
  )
}

/** 汇总新建时先填什么：第一个关联列、那边第一个勾选列（没有就名字）、勾选列算「勾了几个 / 共几个」，别的算「几个」 */
export function rollupDefault(ctx: BaseCtx): Extract<PropDef, { type: 'rollup' }> | null {
  const via = Object.entries(ctx.doc.props).find(([, d]) => d.type === 'relation')
  if (!via) return null
  const to = (via[1] as Extract<PropDef, { type: 'relation' }>).to
  const check = otherCols(ctx, to).find((c) => c.check)
  return { type: 'rollup', via: via[0], prop: check?.id ?? 'file.name', calc: check ? 'checked/all' : 'count' }
}

/** 那边数据库的列：名字、开头出现过的属性（看起来是不是勾选） */
function otherCols(ctx: BaseCtx, to: string): { id: string; label: string; check: boolean }[] {
  const recs = ctx.related.get(to) ?? []
  const keys: string[] = []
  for (const r of recs) for (const k of [...Object.keys(r.props), ...Object.keys(r.lists)]) if (!keys.includes(k)) keys.push(k)
  return [{ id: 'file.name', label: t('名字'), check: false }, ...keys.map((k) => ({ id: k, label: k, check: recs.every((r) => r.props[k] === undefined || /^(true|false)$/i.test(r.props[k]!.trim())) && recs.some((r) => r.props[k] !== undefined) }))]
}

// ---------------------------------------------------------------- 列菜单里这三种多出来的一段

/** 列菜单里关联、汇总、公式那一段（名字框下面）：改了就写 base 块 */
export function ColExtra(props: { ctx: BaseCtx; col: string; onDef(def: PropDef): void; onFormula(): void }) {
  const { ctx, col } = props
  const key = col.replace(/^note\./, '')
  const type = colTypeOf(ctx, col)
  const def = ctx.doc.props[key]
  if (type === 'formula') {
    const name = col.replace(/^formula\./, '')
    return (
      <>
        <button type="button" role="menuitem" onClick={props.onFormula}>
          <Codicon name="symbol-method" size={14} />
          <span>{t('改公式…')}</span>
        </button>
        <div className="base-code">{ctx.doc.formulas[name] ?? ''}</div>
        <div className="sep" />
      </>
    )
  }
  if (def?.type === 'relation') {
    const n = ctx.related.get(def.to)?.length ?? 0
    return (
      <div role="group" aria-label={t('关联')}>
        <div className="hd">{t('关联')}</div>
        <div className="base-info">
          <Codicon name="database" size={14} />
          <span>{t('连到「{db}」', { db: dbNameOf(def.to) })}</span>
          <span className="k">{t('{folder} · {n}条', { folder: def.to, n })}</span>
        </div>
        <label className="base-swrow">
          <span>{t('两边都写')}</span>
          <button
            type="button"
            className={'sw-toggle' + (def.twoWay ? ' on' : '')}
            role="switch"
            aria-checked={!!def.twoWay}
            aria-label={t('两边都写')}
            onClick={() => props.onDef({ ...def, twoWay: def.twoWay ? null : dbNameOf(ctx.doc.folder ?? '') || key })}
          />
        </label>
        <div className="base-note">
          {def.twoWay ? t('开着：那边每一篇也有一列「{b}」，改一边另一边跟着改（写两篇）。', { b: def.twoWay }) : t('关着：只写这一边，那边的笔记不动。')}
        </div>
        <div className="sep" />
      </div>
    )
  }
  if (def?.type === 'rollup') {
    const rels = Object.entries(ctx.doc.props).filter(([, d]) => d.type === 'relation')
    const via = ctx.doc.props[def.via]
    const others = via?.type === 'relation' ? otherCols(ctx, via.to) : []
    if (def.prop && !others.some((o) => o.id === def.prop)) others.push({ id: def.prop, label: def.prop, check: false })
    return (
      <div role="group" aria-label={t('汇总')}>
        <div className="hd">{t('汇总：顺着关联去数')}</div>
        <div className="base-frow">
          <span>{t('顺着')}</span>
          <select aria-label={t('顺着哪一列关联')} value={def.via} onChange={(e) => props.onDef({ ...def, via: e.currentTarget.value })}>
            {!rels.some(([k]) => k === def.via) && <option value={def.via}>{def.via}</option>}
            {rels.map(([k]) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
        <div className="base-frow">
          <span>{t('那边的')}</span>
          <select aria-label={t('那边的哪一列')} value={def.prop} onChange={(e) => props.onDef({ ...def, prop: e.currentTarget.value })}>
            {others.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="base-frow">
          <span>{t('算')}</span>
          <select aria-label={t('算什么')} value={def.calc} onChange={(e) => props.onDef({ ...def, calc: e.currentTarget.value as RollupCalc })}>
            {ROLLUP_CALCS.map((c) => (
              <option key={c.calc} value={c.calc}>
                {fmt(c.label)}
              </option>
            ))}
          </select>
        </div>
        <div className="base-note">{t('算出来的不写进笔记，只在 base 块里记怎么算。')}</div>
        <div className="sep" />
      </div>
    )
  }
  return null
}

// ---------------------------------------------------------------- 公式框

/** 函数一排（照原型）：点一下插进去，光标落在第一个括号里 */
const FX_FUNCS = ['if(, , )', 'round()', 'min(, )', 'max(, )', 'today()', '.isEmpty()']

/** 一个字到哪儿算一个词（出错时标出来的那一段） */
function tokenEnd(src: string, at: number): number {
  if (at >= src.length) return src.length
  let e = at
  while (e < src.length && /[\p{L}\p{N}_$.]/u.test(src[e]!)) e++
  return Math.max(e, at + 1)
}

/**
 * 写公式（加一列选「公式」、公式列「改公式…」）：名字、公式、列 / 函数 / 常用一键插入、前 4 条当场算、写错说哪里错。
 * rows：表里现在的前几条（预览用）
 */
export function FormulaBox(props: { at: PopAnchor; ctx: BaseCtx; name: string; src: string; isNew: boolean; rows: BaseRec[]; onDone(name: string, src: string): void; onCancel(): void }) {
  const { ctx } = props
  const [name, setName] = useState(props.name)
  const [src, setSrc] = useState(props.src)
  const box = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const b = box.current
    if (!b) return
    b.focus()
    b.setSelectionRange(b.value.length, b.value.length)
  }, [])
  const scope = useMemo(() => formulaScope(ctx), [ctx])
  const examples = useMemo(() => formulaExamples(ctx), [ctx])
  const n = name.trim() || t('公式')
  const check = src.trim() ? checkFormula(src, scope, n) : null
  const preview = useMemo(() => (src.trim() && check?.ok ? previewFormula(ctx, src, props.rows.slice(0, 4)) : props.rows.slice(0, 4).map((rec) => ({ rec, cell: null }))), [ctx, src, check?.ok, props.rows])
  const taken = props.isNew ? Object.hasOwn(ctx.doc.formulas, n) : n !== props.name && Object.hasOwn(ctx.doc.formulas, n)
  const ok = !!check?.ok && !taken
  const done = () => ok && props.onDone(n, src.trim())
  /** 插在光标处：前面紧挨着字时先空一格；带括号的光标落进第一个括号里 */
  const insert = (ins: string) => {
    const b = box.current!
    const s = b.selectionStart
    const pre = /^[\p{L}]/u.test(ins) && s > 0 && /[\p{L}\p{N}]/u.test(src[s - 1] ?? '') ? ' ' : ''
    const next = src.slice(0, s) + pre + ins + src.slice(b.selectionEnd)
    const paren = ins.indexOf('(')
    const caret = s + pre.length + (paren >= 0 && !ins.startsWith('.') && ins !== 'today()' ? paren + 1 : ins.length)
    setSrc(next)
    requestAnimationFrame(() => {
      b.focus()
      b.setSelectionRange(caret, caret)
    })
  }
  const showAt = (at: number) => {
    const b = box.current!
    b.focus()
    b.setSelectionRange(at, tokenEnd(src, at))
  }
  const err = check && !check.ok ? check : null
  return (
    <FloatPop at={props.at} className="base-pop base-fxbox" role="dialog" aria-label={t('写公式')}>
      <div className="base-fx-top">
        <input className="base-field" aria-label={t('列名')} value={name} onChange={(e) => setName(e.currentTarget.value)} onKeyDown={(e) => e.stopPropagation()} />
        <span className="base-note">{t('写列名就行，和筛选一种写法')}</span>
      </div>
      <textarea
        ref={box}
        className={'base-fx-src' + (err ? ' bad' : '')}
        spellCheck={false}
        aria-label={t('公式')}
        aria-invalid={!!err}
        value={src}
        onChange={(e) => setSrc(e.currentTarget.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (composing(e)) return
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            done()
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            props.onCancel()
          }
        }}
      />
      <div className="base-pills" role="group" aria-label={t('列', { ctx: '公式框' })}>
        <span className="lab">{t('列', { ctx: '公式框' })}</span>
        {scope.columns.map((c) => (
          <button key={c} type="button" className="base-pill" onClick={() => insert(exprRef(c))}>
            {c}
          </button>
        ))}
        {Object.keys(ctx.doc.formulas)
          .filter((f) => f !== props.name)
          .map((f) => (
            <button key={'f.' + f} type="button" className="base-pill" data-tip={t('公式')} onClick={() => insert(exprRef(f))}>
              {f}
            </button>
          ))}
      </div>
      <div className="base-pills" role="group" aria-label={t('函数')}>
        <span className="lab">{t('函数')}</span>
        {FX_FUNCS.map((f) => {
          const k = f.replace(/^\./, '').replace(/\(.*$/, '')
          return (
            <button key={f} type="button" className="base-pill code" data-tip={FUNCS[k]?.tip ?? (k === 'isEmpty' ? t('是不是空的') : undefined)} onClick={() => insert(f)}>
              {f}
            </button>
          )
        })}
      </div>
      {examples.length > 0 && (
        <div className="base-pills" role="group" aria-label={t('常用')}>
          <span className="lab">{t('常用')}</span>
          {examples.map((x) => (
            <button
              key={x.label}
              type="button"
              className="base-pill"
              data-tip={x.expr}
              onClick={() => {
                setSrc(x.expr)
                if (props.isNew || !name.trim()) setName(x.label)
                box.current?.focus()
              }}
            >
              {x.label}
            </button>
          ))}
        </div>
      )}
      <div className="base-fx-pv">
        <div className="base-note">{t('前 {n} 条算出来', { n: Math.min(4, props.rows.length) })}</div>
        <table aria-label={t('前几条算出来')}>
          <tbody>
            {preview.map(({ rec, cell }) => (
              <tr key={rec.path}>
                <td>{rec.name}</td>
                <td>{cell ? cell.error ? <span className="base-err" data-tip={cell.error}>{t('算不出')}</span> : cell.text : <span className="t3">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="base-fx-err" role="status">
          {!src.trim() ? (
            <span className="hint">{t('写一个公式，或点上面「常用」里的一个')}</span>
          ) : err ? (
            <>
              <span>{err.error}</span>
              <button type="button" className="base-fx-at" aria-label={t('指到写错的地方')} onClick={() => showAt(err.at)}>
                {src.slice(Math.max(0, err.at - 12), err.at)}
                <mark>{src.slice(err.at, tokenEnd(src, err.at)) || ' '}</mark>
                {src.slice(tokenEnd(src, err.at), tokenEnd(src, err.at) + 12)}
              </button>
            </>
          ) : taken ? (
            <span>{t('已经有一个公式叫「{name}」了', { name: n })}</span>
          ) : null}
        </div>
      </div>
      <div className="base-fx-foot">
        <span className="base-code one">{`formulas: ${n}: ${src.trim()}`}</span>
        <button type="button" className="btn btn-sm btn-ghost" onClick={props.onCancel}>
          {t('取消')}
        </button>
        <button type="button" className="btn btn-sm btn-primary" disabled={!ok} onClick={done}>
          {t('完成')} {keyFor('submit')}
        </button>
      </div>
    </FloatPop>
  )
}

// ---------------------------------------------------------------- 两边对不上

/** 关联两边对不上（外面改了一边）：块底一句一句说，点「补上」 */
export function RelationIssues(props: { ctx: BaseCtx }) {
  const { ctx } = props
  const issues = useMemo(() => relationIssues(ctx), [ctx])
  const [busy, setBusy] = useState<BaseCtx | null>(null)
  useEffect(() => {
    if (busy && busy !== ctx) setBusy(null)
  }, [ctx, busy])
  if (!issues.length) return null
  const fix = async (i: RelationIssue) => {
    const ws = fixRelationIssue(ctx, i)
    if (!ws.length) return
    setBusy(ctx)
    const def = ctx.doc.props[i.prop]
    const to = def?.type === 'relation' ? def.to : ''
    const ok = await writeBase(ws, t('补上了：{what}', { what: i.message }), tv('数据库：补上关联（{what}）', { what: i.message }), [...new Set([ctx.doc.folder ?? '', to].filter(Boolean))])
    if (!ok) setBusy(null)
  }
  const shown = issues.slice(0, 3)
  return (
    <div className="base-issues" role="group" aria-label={t('关联两边对不上')}>
      {shown.map((i, k) => (
        <div key={k} className="base-issue">
          <Codicon name="warning" size={13} />
          <span>{i.message}</span>
          <button type="button" className="base-fix" disabled={!!busy} onClick={() => void fix(i)}>
            {i.kind === 'dangling' ? t('拿掉') : t('补上')}
          </button>
        </div>
      ))}
      {issues.length > shown.length && <div className="base-issue more">{t('还有 {n} 处对不上，补上这几处再看', { n: issues.length - shown.length })}</div>}
    </div>
  )
}

/** 右栏「记录」里的关联选择：点外面、esc 收起（esc 只收这一层，不关右栏那一条） */
function PeekRelation(p: PeekEditorProps) {
  const close = useRef(p.close)
  close.current = p.close
  useEffect(() => {
    const down = (e: MouseEvent) => !(e.target as Element | null)?.closest?.('.base-relpick') && close.current()
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || composing(e)) return
      e.preventDefault()
      e.stopPropagation()
      close.current()
    }
    document.addEventListener('mousedown', down, true)
    window.addEventListener('keydown', esc, true)
    return () => (document.removeEventListener('mousedown', down, true), window.removeEventListener('keydown', esc, true))
  }, [])
  return <RelationPick at={anchorOf(p.anchor)} ctx={p.ctx} path={p.path} col={p.col.id} />
}

// 右栏「记录」里的「关联」那一行点了开同一个关联选择（第 4 块留的口子；公式、汇总在右栏写「算出来的」，不在那里改）
registerPeekEditor('relation', (p) => <PeekRelation {...p} />)
