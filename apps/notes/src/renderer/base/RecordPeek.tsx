/**
 * 右栏「记录」标签：数据库里点开的一条（数据库第三批第 4 块，task-i921u，设计页第 4 样，像 Notion 的侧边预览）。
 * 头上是这一条的名字（点一下改名，文件跟着改名、别处的 [[旧名]] 一起改），属性逐个能改（recordFields / writeCell，只换那一行），
 * 下面是这一篇的正文（就是文档的编辑器 NoteDoc，能直接写、待办能勾）。
 * 组头上：← 回到从关联点过来之前那一条、↑ ↓ 上一条下一条（照点开它的那个视图的顺序）、整页打开（中间开这一篇，右栏收起）、</> 看这篇 md 现在的样子。
 * 关联、公式、汇总三种列的格子编辑器是第 5 块做的：这里先只读，registerPeekEditor 留好接上的地方。
 * 打开、换一条都不写文件；改了哪个属性写哪一行，底部提示能撤回。
 */
import { Codicon, type CodiconName } from '@cn/design'
import {
  type BaseCtx,
  type Cell,
  type ColumnInfo,
  type FieldType,
  type FileWrite,
  isDateV,
  parseBaseDoc,
  queryView,
  recordFields,
  statusGroups,
  statusTone,
  writeCell,
} from '@cn/format'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { nameNotice, safeName } from '../../shared/file-name'
import { t as tNow } from '../../shared/i18n'
import { titleOf } from '../../shared/layout'
import { app } from '../ctx/actions'
import { useT } from '../i18n'
import { composing } from '../ime'
import { NoteDoc } from '../note-doc'
import { MenuItem, Popover } from '../shell/Shell'
import { nameFromTitle } from '../title-follow'
import { baseWrote, toneOf } from './BaseTable'
import { linkedSrc, openRecord, peekEditor, recordBack, recordGo, recordMoved, useRecord } from './record-open'
import { loadBaseCtx, useBaseData } from './layout-ctx'
import { PeekButton } from './button-col'
import './record-peek.css'

/** 每种列前面的图标（照原型：状态 issues、日期 calendar、数字 symbol-numeric、公式 symbol-method、关联 references、汇总 symbol-operator） */
const ICON: Record<FieldType, CodiconName> = {
  title: 'symbol-string',
  text: 'symbol-string',
  select: 'arrow-circle-down',
  multi: 'list-unordered',
  number: 'symbol-numeric',
  date: 'calendar',
  check: 'check',
  url: 'link',
  status: 'issues',
  relation: 'references',
  rollup: 'symbol-operator',
  formula: 'symbol-method',
  button: 'play',
}




/** 2026-11-17 → 11月17日（不是今年带年份）；带钟点的后面跟钟点 */
function dayText(v: { date: string; time?: string | null }): string {
  const [y, m, d] = v.date.split('-').map(Number) as [number, number, number]
  const day = y === new Date().getFullYear() ? tNow('{m}月{d}日', { m, d }) : tNow('{y}年{m}月{d}日', { y, m, d })
  return v.time ? `${day} ${v.time}` : day
}

// ---------------------------------------------------------------- 组头上的按钮（画在工作区组头里，和右栏身子是两处，用这个小仓库对上）

interface Nav {
  prev: string | null
  next: string | null
  raw: boolean
  path: string | null
}
let nav: Nav = { prev: null, next: null, raw: false, path: null }
const navSubs = new Set<() => void>()
function setNav(n: Nav) {
  if (n.prev === nav.prev && n.next === nav.next && n.raw === nav.raw && n.path === nav.path) return
  nav = n
  for (const f of [...navSubs]) f()
}
const useNav = () =>
  useSyncExternalStore(
    (f) => (navSubs.add(f), () => void navSubs.delete(f)),
    () => nav,
  )
const navActs = { raw: (_on: boolean) => {}, full: () => {} }

/** 组头右边：← ↑ ↓ 整页打开 </>（「记录」标签在前面时才画） */
export function RecordTools() {
  const t = useT()
  const rec = useRecord()
  const n = useNav()
  if (!rec) return null
  return (
    <span className="rec-tools">
      {rec.back.length > 0 && (
        <button className="dbtn" aria-label={t('回到上一条')} data-tip={t('回到上一条')} data-side="below" onClick={recordBack}>
          <Codicon name="arrow-left" size={14} />
        </button>
      )}
      <button className="dbtn" aria-label={t('上一条')} data-tip={t('上一条')} data-key="↑" data-side="below" disabled={!n.prev} onClick={() => n.prev && recordGo(n.prev)}>
        <Codicon name="chevron-up" size={14} />
      </button>
      <button className="dbtn" aria-label={t('下一条')} data-tip={t('下一条')} data-key="↓" data-side="below" disabled={!n.next} onClick={() => n.next && recordGo(n.next)}>
        <Codicon name="chevron-down" size={14} />
      </button>
      <button className="dbtn" aria-label={t('整页打开这一条')} data-tip={t('整页打开这一条')} data-side="below" onClick={() => navActs.full()}>
        <Codicon name="screen-full" size={14} />
      </button>
      <button className={'dbtn' + (n.raw ? ' on' : '')} aria-label={t('看这篇的写法')} aria-pressed={n.raw} data-tip={t('看这篇的写法')} data-side="below" onClick={() => navActs.raw(!n.raw)}>
        <Codicon name="code" size={14} />
      </button>
    </span>
  )
}

// ---------------------------------------------------------------- 右栏的身子

type Pop = { kind: 'options'; col: ColumnInfo; at: HTMLElement } | { kind: 'slot'; col: ColumnInfo; cell: Cell; at: HTMLElement }

export function RecordPeek(props: { shown: boolean; onClose(): void; onFull(path: string): void }) {
  const t = useT()
  const rec = useRecord()
  const [raw, setRaw] = useState(false)
  /** 正在改的属性（文字、数字、日期、链接是输入框） */
  const [editing, setEditing] = useState<string | null>(null)
  const [naming, setNaming] = useState(false)
  /** esc 收起输入框时不算改完（输入框收起时还会来一次失焦） */
  const cancelled = useRef(false)
  const [adding, setAdding] = useState<{ name: string } | null>(null)
  const [pop, setPop] = useState<Pop | null>(null)
  /** 改之前这篇的字：</> 里刚改过的几行上底色 */
  const [prevText, setPrevText] = useState<{ path: string; text: string } | null>(null)
  const host = useRef<HTMLDivElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const doc = useRef<NoteDoc | null>(null)

  const src = rec?.src ?? null
  const folder = useMemo(() => (src === null ? null : parseBaseDoc(src).folder), [src])
  // 读这一块的笔记（和表格同一个 hook）：开着的这条、换了一条、块改了写法、别处改了这个数据库里的笔记，都重读
  const { ctx, reload: again } = useBaseData(src)
  // 在外面改了名、挪了地方：跟过去
  useEffect(() => window.cn.onNoteRenamed((from, to) => recordMoved(from, to)), [])

  const path = rec?.path ?? null
  const here = ctx && path ? (ctx.recs.find((r) => r.path === path) ?? null) : null
  const fields = useMemo(() => (ctx && path ? recordFields(ctx, path, rec?.view) : []), [ctx, path, rec?.view])
  const order = useMemo(() => (ctx && rec ? queryView(ctx, rec.view).rows.map((r) => r.path) : []), [ctx, rec?.view])

  // 组头上的按钮
  useEffect(() => {
    // 从关联点过来的那一条不在点开它的那个视图里：↑ ↓ 灰着（原型），← 回去
    const i = path && !rec?.back.length ? order.indexOf(path) : -1
    setNav({ prev: i > 0 ? order[i - 1]! : null, next: i >= 0 && i < order.length - 1 ? order[i + 1]! : null, raw, path })
  }, [order, path, raw, rec?.back.length])
  navActs.raw = setRaw
  navActs.full = () => {
    if (!path) return
    const p = path
    void doc.current?.save().then(() => props.onFull(p))
    if (!doc.current) props.onFull(p)
  }

  // 正文：文档的编辑器。换一条时先存好上一条再换
  useEffect(() => {
    if (!path || !host.current) return
    let cancelled = false
    let d: NoteDoc | null = null
    let off = () => {}
    void window.cn.readNote(path).then((note) => {
      if (cancelled || !host.current) return
      d = new NoteDoc(host.current, note, {
        onState: () => {},
        onNotice: (x) => app().notice(x),
        onSaved: () => baseWrote(folder),
        onOpenLink: (target) => app().openWikilink(target),
      })
      doc.current = d
      off = window.cn.onNoteChanged((p, text) => {
        if (d && p === d.path) void d.applyRemote(text)
      })
    })
    return () => {
      cancelled = true
      off()
      const x = d
      if (doc.current === x) doc.current = null
      if (x) void x.save().finally(() => x.destroy())
    }
  }, [path])

  // 换了一条：输入框、弹层都收起
  useEffect(() => {
    setEditing(null)
    setNaming(false)
    setAdding(null)
    setPop(null)
  }, [path])

  // ↑ ↓ 换一条、esc 关：焦点在右栏这一条里（不在输入框、正文里），或者在数据库表里刚点过的那一行上
  useEffect(() => {
    if (!props.shown || !rec) return
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented || composing(e) || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'Escape') return
      const el = e.target instanceof HTMLElement ? e.target : null
      const onBody = !el || el === document.body
      const inPeek = !!el && !!root.current?.contains(el)
      const inBase = !!el?.closest('.cm-base, .base-full')
      if (!onBody && !inPeek && !inBase) return
      if (!onBody && (el!.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el!.tagName))) return
      if (e.key === 'Escape') {
        if (!inPeek) return
        e.preventDefault()
        return close()
      }
      const to = e.key === 'ArrowUp' ? nav.prev : nav.next
      if (!to) return
      e.preventDefault()
      recordGo(to)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [props.shown, !!rec])

  /** esc：收起右栏的这个标签（开着的是哪一条还记着，图标栏上再点开回来） */
  const close = () => props.onClose()

  /** 写进那几篇（先存好开着的编辑器、按刚读的字算），开着这篇的编辑器合进来；底部提示能撤回 */
  const commit = async (make: (c: BaseCtx) => FileWrite[], said: string) => {
    if (!rec || src === null) return
    const p = rec.path
    await Promise.all([...NoteDoc.open].filter((d) => d.path === p).map((d) => d.save()))
    const fresh = await loadBaseCtx(src)
    const writes = make(fresh)
    if (!writes.length) return
    for (const w of writes) {
      const r = await window.cn.writeNote(w.path, w.after, w.before)
      if (!r.ok) {
        app().notice(t('《{name}》刚被别处改过，没改成，再试一次', { name: titleOf(w.path) }))
        return again()
      }
      for (const d of NoteDoc.open) if (d.path === w.path) void d.applyRemote(w.after)
    }
    setPrevText({ path: p, text: writes.find((w) => w.path === p)?.before ?? writes[0]!.before })
    baseWrote(folder)
    again()
    app().noticeUndo(t('{said}，写进 {file}', { said, file: writes.map((w) => w.path).join('、') }), () => {
      void (async () => {
        for (const w of [...writes].reverse()) {
          const r = await window.cn.writeNote(w.path, w.before, w.after)
          if (!r.ok) {
            app().notice(t('《{name}》后来又改过，没撤回', { name: titleOf(w.path) }))
            continue
          }
          for (const d of NoteDoc.open) if (d.path === w.path) void d.applyRemote(w.before)
        }
        setPrevText(null)
        baseWrote(folder)
        again()
      })()
    })
  }

  const setCell = (col: ColumnInfo, value: string | string[] | boolean | null) => {
    setEditing(null)
    if (!rec) return
    const p = rec.path
    void commit((c) => writeCell(c, p, col.id, value), t('改了「{col}」', { col: col.label }))
  }

  /** 改名：文件跟着改名（重名加「 2」），别处的 [[旧名]] 一起改；第一行是「# 旧名」也跟着换 */
  const rename = async (name: string) => {
    setNaming(false)
    if (!rec) return
    const from = rec.path
    const old = titleOf(from)
    name = name.trim()
    if (!name || name === old) return
    try {
      const d = doc.current
      if (d && d.path === from && d.text.startsWith(`# ${old}\n`)) d.setText(`# ${name}\n` + d.text.slice(old.length + 3))
      await NoteDoc.saveAll()
      const file = nameFromTitle(name)
      const to = await window.cn.renameNote(from, file, true)
      NoteDoc.follow(from, to)
      recordMoved(from, to)
      app().refresh()
      baseWrote(folder)
      const said = nameNotice(name, titleOf(to), '条', safeName(file)) // 不翻：量词是传给 shared/file-name 选句子的参数
      if (said) app().notice(said)
    } catch (e) {
      app().notice(String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }

  if (!rec) return <div className="rpeek rec-empty">{t('在数据库里点一条，在这里打开')}</div>

  const dbName = folder ? folder.split('/').pop()! : t('数据库')
  const name = titleOf(rec.path)

  const value = (col: ColumnInfo, cell: Cell) => {
    if (cell.error) return <span className="rec-err" title={cell.error}>{t('算不出')}</span>
    const v = cell.value
    const empty = v === null || v === '' || (Array.isArray(v) && !v.length)
    switch (col.type) {
      case 'status': {
        if (empty) return <span className="rec-none">{t('空着')}</span>
        const tone = statusTone(ctx!, col.id, cell.text)
        return (
          <span className="rec-st">
            <i className={'g' + Math.max(0, Math.min(2, tone))} />
            {cell.text}
          </span>
        )
      }
      case 'select':
        return empty ? <span className="rec-none">{t('空着')}</span> : <span className={'base-sel ' + toneOf(cell.text)}>{cell.text}</span>
      case 'multi':
        return empty ? (
          <span className="rec-none">{t('空着')}</span>
        ) : (
          (Array.isArray(v) ? v.map(String) : [cell.text]).map((x) => (
            <span key={x} className={'base-sel ' + toneOf(x)}>
              {x}
            </span>
          ))
        )
      case 'date':
        return v !== null && isDateV(v) ? dayText(v) : empty ? <span className="rec-none">{t('没排')}</span> : cell.text
      case 'check':
        return (
          <span className={'rec-cb' + (v === true ? ' on' : '')} role="checkbox" aria-checked={v === true} aria-label={col.label}>
            {v === true && <Codicon name="check" size={12} />}
          </span>
        )
      case 'relation':
        return (
          <>
            {(cell.links ?? []).map((l) => (
              <button
                key={l.raw}
                className="rec-rel"
                disabled={!l.path}
                title={l.path ? t('在右栏打开「{name}」', { name: l.name }) : t('库里没有「{name}」', { name: l.name })}
                onClick={(e) => {
                  e.stopPropagation()
                  if (l.path) openRecord({ path: l.path, src: linkedSrc(ctx!, col.id) }, { push: true })
                }}
              >
                <Codicon name="file" size={12} />
                {l.name}
              </button>
            ))}
            {!(cell.links ?? []).length && !peekEditor('relation') && <span className="rec-none">{t('没有')}</span>}
          </>
        )
      case 'formula':
        return (
          <>
            <span className="rec-fx">{cell.text}</span>
            <span className="rec-hint">{t('算出来的')}</span>
          </>
        )
      case 'rollup': {
        const def = ctx!.doc.props[col.id]
        return (
          <>
            <span className="rec-fx">{cell.text || <span className="rec-none">{t('没有')}</span>}</span>
            {def?.type === 'rollup' && (
              <span className="rec-hint">
                {t('顺着「{via}」数「{prop}」', { via: def.via, prop: def.prop })}
              </span>
            )}
          </>
        )
      }
      case 'button':
        // 按钮列：右栏里也能点（自动化那一套，button-col.tsx）
        return path ? <PeekButton table={rec?.from ?? null} col={col.id} path={path} name={name} /> : null
      case 'url':
        return cell.text ? (
          <a
            className="base-url"
            href={cell.text}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              app().openInWeb(cell.text, cell.text)
            }}
          >
            {cell.text}
          </a>
        ) : (
          <span className="rec-none">{t('空着')}</span>
        )
      default:
        return empty ? <span className="rec-none">{t('空着')}</span> : cell.text
    }
  }

  const row = (col: ColumnInfo, cell: Cell) => {
    const slot = peekEditor(col.type)
    const ro = ((col.computed || col.type === 'relation') && !slot) || col.type === 'button'
    const input = editing === col.id && (col.type === 'text' || col.type === 'number' || col.type === 'date' || col.type === 'url')
    const raw = here ? (here.props[col.id] ?? '') : ''
    const click = (e: React.MouseEvent<HTMLElement>) => {
      if (ro || here === null) return
      const at = e.currentTarget
      if (slot) return setPop({ kind: 'slot', col, cell, at })
      if (col.type === 'check') return setCell(col, cell.value !== true)
      if (col.type === 'status' || col.type === 'select' || col.type === 'multi') return setPop({ kind: 'options', col, at })
      setEditing(col.id)
    }
    return (
      <div className="rec-row" key={col.id} data-col={col.id}>
        <span className="k">
          <Codicon name={ICON[col.type]} size={14} />
          <span className="truncate">{col.label}</span>
        </span>
        {input ? (
          <span className="v ed">
            <input
              autoFocus
              type={col.type === 'date' ? 'date' : col.type === 'number' ? 'number' : 'text'}
              defaultValue={col.type === 'date' ? raw.slice(0, 10) : raw}
              aria-label={`${name} · ${col.label}`}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (composing(e)) return
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') ((cancelled.current = true), setEditing(null))
              }}
              onFocus={() => (cancelled.current = false)}
              onBlur={(e) => {
                if (cancelled.current) return
                const next = e.currentTarget.value.trim()
                // 日期只换日子，原来带的钟点留着
                const keep = col.type === 'date' && next && /^\d{4}-\d{2}-\d{2}[ T]\d/.test(raw) ? next + raw.slice(10) : next
                if (keep === raw) return setEditing(null)
                setCell(col, keep === '' ? null : keep)
              }}
            />
          </span>
        ) : (
          <span
            className={'v' + (ro ? ' ro' : '')}
            role={ro ? undefined : 'button'}
            tabIndex={ro ? undefined : 0}
            aria-label={ro ? undefined : t('改「{col}」', { col: col.label })}
            onClick={click}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === ' ') && !ro) {
                e.preventDefault()
                click(e as unknown as React.MouseEvent<HTMLElement>)
              }
            }}
          >
            {value(col, cell)}
          </span>
        )}
      </div>
    )
  }
  /** 从关联点过来的这一条：两边都写的那一列下面说一句它从哪来（原型「练习 3.2」那一屏） */
  const twoWayNote = (col: ColumnInfo) => {
    const def = ctx?.doc.props[col.id]
    if (!rec.back.length || def?.type !== 'relation' || !def.twoWay) return null
    return (
      <div className="rec-note" key={col.id + ':note'}>
        {t('「{other}」那一列是两边都写的：在「{db}」里连上这一条，这里的「{prop}」跟着有。', { other: def.twoWay, db: def.to.split('/').pop()!, prop: col.label })}
      </div>
    )
  }

  const lines = (here?.text ?? '').split('\n')
  const before = prevText && prevText.path === rec.path ? prevText.text.split('\n') : null

  return (
    <div className="rpeek" ref={root} /* 不翻：data-part 给 e2e 和样式认 */ data-part="右栏里的一条" tabIndex={-1} aria-label={t('数据库里的一条：{name}', { name })}>
      {raw ? (
        <div className="rec-crumbs">
          <span className="truncate">{rec.path}</span>
        </div>
      ) : (
        <div className="rec-crumbs">
          <Codicon name="database" size={12} />
          <span>{dbName}</span>
          <Codicon name="chevron-right" size={12} />
          <span className="truncate">{name}</span>
        </div>
      )}
      {ctx && !here && <p className="rec-gone">{t('「{name}」不在这个数据库里了（删了、挪走了，或者改了名）', { name })}</p>}
      {raw ? (
        <>
          <h4 className="rec-rawcap">{t('这篇 md 现在的样子（刚改过的几行上了底色）')}</h4>
          <pre className="rec-md" data-testid="record-md">
            {lines.map((l, i) => (
              <span key={i} className={before && before[i] !== l ? 'hl' : undefined}>
                {l}
                {i < lines.length - 1 ? '\n' : ''}
              </span>
            ))}
          </pre>
        </>
      ) : (
        <>
          {naming ? (
            <input
              className="rec-title-in"
              autoFocus
              defaultValue={name}
              aria-label={t('这一条的名字')}
              onFocus={(e) => ((cancelled.current = false), e.currentTarget.select())}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (composing(e)) return
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') ((cancelled.current = true), setNaming(false))
              }}
              onBlur={(e) => !cancelled.current && void rename(e.currentTarget.value)}
            />
          ) : (
            <h3 className="rec-title" role="button" tabIndex={0} title={t('点一下改名')} onClick={() => setNaming(true)} onKeyDown={(e) => e.key === 'Enter' && setNaming(true)}>
              {name}
            </h3>
          )}
          {here && (
            <div className="rec-props" role="list" aria-label={t('属性')}>
              {fields.map((f) => [row(f.col, f.cell), twoWayNote(f.col)])}
            </div>
          )}
          {here &&
            (adding ? (
              <AddProp
                taken={fields.map((f) => f.col.label)}
                onDone={(k, v) => {
                  setAdding(null)
                  if (!k) return
                  const p = rec.path
                  void commit((c) => writeCell(c, p, k, v), t('加了「{col}」', { col: k }))
                }}
              />
            ) : (
              <button className="rec-add" onClick={() => setAdding({ name: '' })}>
                <Codicon name="add" size={12} />
                {t('加一个属性')}
              </button>
            ))}
          <hr className="rec-hr" />
        </>
      )}
      <div className="doc doc rec-body" ref={host} hidden={raw} />
      {pop?.kind === 'options' && here && ctx && (
        <OptionsPop
          ctx={ctx}
          col={pop.col}
          at={pop.at}
          cur={pop.col.type === 'multi' ? (here.lists[pop.col.id] ?? (here.props[pop.col.id] ? [here.props[pop.col.id]!] : [])) : [here.props[pop.col.id] ?? '']}
          onPick={(vs, done) => {
            if (done) setPop(null)
            setCell(pop.col, pop.col.type === 'multi' ? vs : (vs[0] ?? null))
          }}
          onClose={() => setPop(null)}
        />
      )}
      {pop?.kind === 'slot' &&
        ctx &&
        peekEditor(pop.col.type)?.({
          ctx,
          path: rec.path,
          col: pop.col,
          cell: pop.cell,
          anchor: pop.at,
          close: () => setPop(null),
          changed: () => (baseWrote(folder), again()),
        })}
    </div>
  )
}


/** 选项、状态、多选：点一个就改（多选能勾几个、能打一个新的） */
function OptionsPop(p: { ctx: BaseCtx; col: ColumnInfo; at: HTMLElement; cur: string[]; onPick(vs: string[], done: boolean): void; onClose(): void }) {
  const t = useT()
  const [q, setQ] = useState('')
  const multi = p.col.type === 'multi'
  const groups = useMemo(() => {
    if (p.col.type === 'status') return statusGroups(p.ctx, p.col.id).map((g) => ({ name: g.name, options: g.options }))
    const seen = new Set<string>()
    for (const r of p.ctx.recs) {
      const list = r.lists[p.col.id] ?? (r.props[p.col.id] ? [r.props[p.col.id]!] : [])
      for (const v of list) if (v.trim()) seen.add(v.trim())
    }
    return [{ name: '', options: [...seen].sort((a, b) => a.localeCompare(b, 'zh')) }]
  }, [p.ctx, p.col.id])
  const all = groups.flatMap((g) => g.options)
  const pick = (v: string) => {
    if (!multi) return p.onPick(p.cur[0] === v ? [] : [v], true)
    p.onPick(p.cur.includes(v) ? p.cur.filter((x) => x !== v) : [...p.cur, v], false)
  }
  const match = (v: string) => !q.trim() || v.toLowerCase().includes(q.trim().toLowerCase())
  return (
    <Popover anchor={p.at} label={`${p.col.label}`} className="rec-pop" onClose={p.onClose}>
      {p.col.type !== 'status' && (
        <input
          className="rec-q"
          autoFocus
          value={q}
          placeholder={t('找一个，或者打一个新的')}
          aria-label={t('找一个，或者打一个新的')}
          onChange={(e) => setQ(e.currentTarget.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (composing(e)) return
            if (e.key === 'Escape') return p.onClose()
            if (e.key !== 'Enter' || !q.trim()) return
            const v = all.find((x) => x === q.trim()) ?? q.trim()
            setQ('')
            pick(v)
          }}
        />
      )}
      <div role="menu" aria-label={p.col.label}>
        {groups.map((g) => {
          const opts = g.options.filter(match)
          if (!opts.length) return null
          return (
            <div key={g.name || '-'} className="rec-grp">
              {g.name && <div className="rec-gname">{g.name}</div>}
              {opts.map((v) => (
                <MenuItem
                  key={v}
                  className={p.cur.includes(v) ? 'on' : undefined}
                  glyph={
                    p.col.type === 'status' ? (
                      <i className={'rec-dot g' + Math.max(0, Math.min(2, statusTone(p.ctx, p.col.id, v)))} />
                    ) : (
                      <span className={'base-sel ' + toneOf(v)} aria-hidden>
                        {' '}
                      </span>
                    )
                  }
                  label={v}
                  right={p.cur.includes(v) ? <Codicon name="check" size={14} /> : undefined}
                  onClick={() => pick(v)}
                />
              ))}
            </div>
          )
        })}
        {q.trim() && !all.includes(q.trim()) && <MenuItem icon="add" label={t('新建「{v}」', { v: q.trim() })} onClick={() => (setQ(''), pick(q.trim()))} />}
        {!multi && p.cur[0] && <MenuItem icon="close" label={t('清空')} onClick={() => p.onPick([], true)} />}
      </div>
    </Popover>
  )
}

/** 加一个属性：起名字、填值，回车写进这一篇开头 */
function AddProp(p: { taken: string[]; onDone(name: string | null, value: string): void }) {
  const t = useT()
  const [k, setK] = useState('')
  const [v, setV] = useState('')
  const val = useRef<HTMLInputElement>(null)
  const bad = !!k.trim() && p.taken.includes(k.trim())
  const done = () => (k.trim() && v.trim() && !bad ? p.onDone(k.trim(), v.trim()) : p.onDone(null, ''))
  const keys = (e: React.KeyboardEvent<HTMLInputElement>, last: boolean) => {
    e.stopPropagation()
    if (composing(e)) return
    if (e.key === 'Escape') return p.onDone(null, '')
    if (e.key !== 'Enter') return
    if (!last) return val.current?.focus()
    done()
  }
  return (
    <div className="rec-row rec-adding">
      <span className="k">
        <input autoFocus value={k} placeholder={t('属性名')} aria-label={t('属性名')} onChange={(e) => setK(e.currentTarget.value)} onKeyDown={(e) => keys(e, false)} />
      </span>
      <span className="v ed">
        <input ref={val} value={v} placeholder={t('值')} aria-label={t('值')} onChange={(e) => setV(e.currentTarget.value)} onKeyDown={(e) => keys(e, true)} />
      </span>
      {bad && <span className="rec-err">{t('已经有一列叫「{name}」了', { name: k.trim() })}</span>}
    </div>
  )
}

