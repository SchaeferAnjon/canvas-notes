/**
 * 白板上的数据库（2026-11-21 方向 A4）：
 * - 卡：卡头「database · 住宿 · 表格 …… 5条」，前 4 条的小表（名字、一列数字、一列选项画成小色块，不画表头），
 *   虚线下「还有1条 …… 展开」；
 * - 展开：卡在原地长成 660 宽的整张表，就是文档里那张数据库表（BaseTable：列类型、点格子改、选项菜单、加列、新一条、筛选、排序、整页打开），
 *   头上多一颗「收起」，Esc 也收起；改一格写的是那一条笔记的属性，文档里那张表、别处嵌着的同一个数据库都跟着变；
 * - 工具板「数据库」的小菜单：库里已有的数据库，分隔线下「新建一个空的数据库」。
 */
import { Codicon } from '@cn/design'
import { baseRows, type BaseSpec, colType, parseBase, setBaseFilters, setBaseOrder, setBaseSort } from '@cn/format'
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { BoardBase } from '../../shared/api'
// 选项色块：和文档里的数据库表同一个算法（同一个值总是同一个颜色）
import { BASE_WROTE, type BaseCellWrite, type BaseEdits, BaseTable, toneOf } from '../base/BaseTable'
import { useT } from '../i18n'


interface Rows {
  rows: { name: string; props: Record<string, string> }[]
  total: number
  /** 文件夹里出现过的属性和它们看起来是什么类型 */
  types: Record<string, string>
}

/** 读这个数据库的几条（文件夹里的笔记）；那个文件夹里改了跟着变 */
function useRows(spec: BaseSpec): Rows | null {
  const [data, setData] = useState<Rows | null>(null)
  const key = JSON.stringify(spec)
  useEffect(() => {
    let live = true
    const load = async () => {
      if (!spec.folder) return live && setData({ rows: [], total: 0, types: {} })
      const files = (await window.cn.listNotes()).filter((f) => f.path.startsWith(spec.folder + '/') && /\.md$/i.test(f.path))
      const notes = await Promise.all(files.map(async (f) => ({ path: f.path, text: (await window.cn.readNote(f.path)).text })))
      const rows = baseRows(spec, notes)
      const keys = new Set(rows.flatMap((r) => Object.keys(r.props)))
      const types = Object.fromEntries([...keys].map((k) => [k, spec.types[k] ?? colType(rows.map((r) => r.props[k] ?? ''))]))
      if (live) setData({ rows: rows.map((r) => ({ name: r.name, props: r.props })), total: rows.length, types })
    }
    void load()
    const again = () => void load()
    const off1 = window.cn.onFilesChanged(again)
    const off2 = window.cn.onNoteChanged((p) => !!spec.folder && p.startsWith(spec.folder + '/') && again())
    const wrote = (e: Event) => (e as CustomEvent<string>).detail === spec.folder && again()
    window.addEventListener(BASE_WROTE, wrote)
    return () => ((live = false), off1(), off2(), window.removeEventListener(BASE_WROTE, wrote))
  }, [key])
  return data
}

/** 小表的两列：第一列数字、选项（叫「状态」的那列优先） */
function pickCols(spec: BaseSpec, types: Record<string, string>): { num: string | null; sel: string | null } {
  const cols = [...spec.columns.filter((c) => c !== 'file.name'), ...Object.keys(types).filter((k) => !spec.columns.includes(k))]
  const typeOf = (c: string) => types[c] ?? spec.types[c] ?? 'text'
  const sel = cols.find((c) => c === '状态' /* 不翻：笔记里的属性名 */ && typeOf(c) === 'select') ?? cols.find((c) => typeOf(c) === 'select') ?? null
  const num = cols.find((c) => typeOf(c) === 'number') ?? null
  return { num, sel }
}

/** 白板上的数据库卡（看全文时 full：整张表铺开，没有「展开」） */
export function BaseCard(props: { src: string; full: boolean; onExpand(): void }) {
  const t = useT()
  const spec = parseBase(props.src)
  const data = useRows(spec)
  const name = spec.folder ? spec.folder.split('/').pop()! : t('数据库')
  const rows = data ? (props.full ? data.rows : data.rows.slice(0, 4)) : []
  const { num, sel } = pickCols(spec, data?.types ?? {})
  const more = data ? data.total - rows.length : 0
  return (
    <>
      <div className="kh">
        <Codicon name="database" size={14} />
        <span>{`${name} · ${spec.view || t('表格')}`}</span>
        <span className="r num">{data ? t('{n}条', { n: data.total }) : ''}</span>
      </div>
      <table className="mt db-mini">
        <colgroup>
          <col />
          {num && <col style={{ width: 30 }} />}
          {sel && <col style={{ width: 58 }} />}
        </colgroup>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td>{r.name}</td>
              {num && <td className="num">{r.props[num] ?? ''}</td>}
              {sel && <td>{r.props[sel] ? <span className={'db-tag ' + toneOf(r.props[sel]!)}>{r.props[sel]}</span> : null}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="dbfoot">
        <span>{more > 0 ? t('还有{n}条', { n: more }) : spec.folder ? `${spec.folder}/` : t('还没写数据源')}</span>
        {!props.full && (
          <button type="button" className="db-expand" data-testid="db-expand" onMouseDown={(e) => e.stopPropagation()} onClick={props.onExpand}>
            <Codicon name="screen-full" size={13} />
            {t('展开')}
          </button>
        )}
      </div>
    </>
  )
}

/**
 * 展开：原地长成整张表。write(next)：把这一块 ```base 里的 YAML 换成 next 算出来的（写回这篇文档）；
 * onCell：改好一格（提示条说写进了哪篇、能撤回）
 */
export function BaseExpand(props: { src: string; file?: string; block?: number; write(next: (src: string) => string): void; onClose(): void; onCell(w: BaseCellWrite): void }) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => setAnchor(ref.current), [])
  const spec = parseBase(props.src)
  const close = useRef(props.onClose)
  close.current = props.onClose
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing || e.defaultPrevented) return
      // 表里的小菜单、整页打开、正在改的格子先收它们
      if (document.querySelector('.base-pop, .base-full') || (e.target as HTMLElement | null)?.closest?.('input, textarea')) return
      e.preventDefault()
      close.current()
    }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [])
  const edit: BaseEdits = {
    sort: (prop, desc) => props.write((src) => setBaseSort(src, prop, desc)),
    filters: (match, conds) => props.write((src) => setBaseFilters(src, match, conds)),
    order: (columns) => props.write((src) => setBaseOrder(src, columns)),
    src: (next) => props.write(next),
  }
  const extra: ReactNode = (
    <button type="button" className="base-btn wt" aria-label={t('收起', { ctx: '数据库卡' })} data-testid="db-collapse" onClick={props.onClose}>
      <Codicon name="screen-normal" size={14} />
      <span>{t('收起', { ctx: '数据库卡' })}</span>
    </button>
  )
  return (
    // 不翻：data-part 是 e2e 认的
    <div className="dbx" ref={ref} data-part="展开的数据库" onMouseDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      {anchor && (
        <BaseTable
          spec={spec}
          src={props.src}
          edit={edit}
          anchor={anchor}
          extra={extra}
          file={props.file}
          block={props.block}
          foot={spec.folder ? t('每一条是「{folder}/」里的一篇笔记；在这里改，文档里这张表一起变', { folder: spec.folder }) : undefined}
          onCell={props.onCell}
        />
      )}
    </div>
  )
}

/** 工具板「数据库」点一下 / 拖到地方：弹一个小菜单挑放哪个 */
export function BaseMenu(props: { at: { x: number; y: number }; onPick(b: BoardBase | 'new'): void; onClose(): void }) {
  const t = useT()
  const [list, setList] = useState<BoardBase[] | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let live = true
    void window.cn.boardBases().then((l) => live && setList(l))
    return () => void (live = false)
  }, [])
  useEffect(() => {
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && props.onClose()
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && (e.preventDefault(), props.onClose())
    document.addEventListener('mousedown', down, true)
    window.addEventListener('keydown', esc, true)
    return () => (document.removeEventListener('mousedown', down, true), window.removeEventListener('keydown', esc, true))
  })
  // 放不下就往上、往左挪进窗口
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    el.style.left = Math.max(8, Math.min(props.at.x, window.innerWidth - r.width - 8)) + 'px'
    el.style.top = Math.max(8, Math.min(props.at.y, window.innerHeight - r.height - 8)) + 'px'
  })
  return (
    <div className="db-menu" ref={ref} role="menu" aria-label={t('放一张数据库卡')} style={{ left: props.at.x, top: props.at.y }}>
      <div className="mh">{t('放一张数据库卡')}</div>
      {list === null && <div className="mi dim">{t('正在找库里的数据库…')}</div>}
      {list?.map((b) => (
        <button key={b.folder} type="button" role="menuitem" className="mi" onClick={() => props.onPick(b)}>
          <Codicon name="database" size={14} />
          <span className="truncate">{b.name}</span>
          <span className="r">{t('{folder} · {n}条', { folder: b.folder, n: b.count })}</span>
        </button>
      ))}
      {list !== null && list.length > 0 && <hr />}
      <button type="button" role="menuitem" className="mi" onClick={() => props.onPick('new')}>
        <Codicon name="add" size={14} />
        <span>{t('新建一个空的数据库')}</span>
      </button>
    </div>
  )
}
