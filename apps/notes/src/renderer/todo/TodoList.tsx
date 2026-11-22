/**
 * 待办三处共用的一套样子（task-pd1d1，原型 05-任务软件/todo-demo.html 的 cb / chip / row / groups / popHtml / 拖动，和画布今日同一套）：
 * 勾选框、一行（标题、灰色出处、行尾日子小块）、按 过期 / 今天 / 明天 / 以后 / 没定日子 分组、加一条、点一条在旁边弹的详情小卡、
 * 拖一条到某一组（或某个日子小块）上改日子。左边「待办」格是窄的（只露勾选框、标题、日子小块），首页卡多露出处，任务界面大一号（big）。
 */
import { Codicon } from '@cn/design'
import { codiconSvg } from '@cn/design/codicon-svg'
import { addDays } from '@cn/tasks'
import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { bucketOf, chipText, noteName, quickHint, type TodoItem, todoGroups, type TodoWhere } from '../../shared/todo'
import { app } from '../ctx/actions'
import { goToLine } from '../goto-line'
import { composing } from '../ime'
import { addTodo, dateTodo, fieldTodo, isoToday, itemsNow, openInToday, tickTodo, useTodayInstalled, useTodos, useToday } from './store'
import './todo.css'

const cls = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ')

// ---------- 详情小卡开着哪一条（一次只开一张；哪一处的那一行点开的就贴着那一行） ----------

let pop: { key: string; owner: string } | null = null
const popSubs = new Set<() => void>()
function setPop(p: typeof pop) {
  pop = p
  for (const f of popSubs) f()
}
const usePop = () =>
  useSyncExternalStore(
    (f) => (popSubs.add(f), () => void popSubs.delete(f)),
    () => pop,
  )

/** 勾选框（原型 cb()）：14 方、圆角 4，重要的黄边，勾上填强调色 */
export function Check({ t }: { t: TodoItem }) {
  return (
    <button
      className={cls('td-cb', t.done && 'on', t.prio === 3 && !t.done && 'hi')}
      role="checkbox"
      aria-checked={t.done}
      aria-label={`${t.done ? '取消勾选' : '勾掉'}「${t.title}」`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        void tickTodo(t)
      }}
    >
      {t.done && <Codicon name="check" size={10} />}
    </button>
  )
}

/** 行尾的日子小块（原型 chip()）：有提醒画铃铛，过期的红字；拖一条到它上面就改成这一天 */
function Chip({ t, today }: { t: TodoItem; today: string }) {
  if (!t.date) return null
  return (
    <span className={cls('td-chip', t.date < today && !t.done && 'red')} data-drop={`date:${t.date}`}>
      <Codicon name={t.remind ? 'bell' : 'calendar'} size={10} />
      {chipText(t, today)}
    </span>
  )
}

/** 一行（原型 row()）：src 时标题后面多一个灰色出处「· 小论文计划」 */
function Row({ t, today, owner, src, sel, flash }: { t: TodoItem; today: string; owner: string; src?: boolean; sel: boolean; flash: boolean }) {
  return (
    <div className={cls('td-r', sel && 'sel', t.done && 'done', flash && 'flash')} data-key={t.key} data-owner={owner} role="listitem">
      <Check t={t} />
      <span className="td-tt">
        <span className="td-t">{t.title}</span>
        {src && <span className="td-src">{` · ${noteName(t.path)}`}</span>}
      </span>
      <Chip t={t} today={today} />
    </div>
  )
}

/**
 * 分组（原型 groups()）：只列没做完的，刚勾掉的划线留在原处；dropEmpty 时今天、明天、以后空着也出（一句「空着，拖一条到…」当落点）；
 * showDone 时最后「已完成 N ›」一行，点开列出来（划线）。limit：没做完的最多先列几条（首页卡），多的「还有 N 条 ›」
 */
export function TodoGroups(props: { list: readonly TodoItem[]; owner: string; src?: boolean; dropEmpty?: boolean; showDone?: boolean; limit?: number }) {
  const { keep, flash } = useTodos()
  const today = useToday()
  const p = usePop()
  const [doneOpen, setDoneOpen] = useState(false)
  const [all, setAll] = useState(false)
  const { groups, done } = todoGroups(props.list, today, { dropEmpty: props.dropEmpty, keep })
  const total = groups.reduce((n, g) => n + g.items.length, 0)
  let left = props.limit && !all ? props.limit : Infinity
  const row = (t: TodoItem) => <Row key={t.key} t={t} today={today} owner={props.owner} src={props.src} sel={p?.key === t.key} flash={flash === t.key} />
  const blocks = groups.map((g) => {
    const shown = g.items.slice(0, left)
    left -= shown.length
    if (!shown.length && g.items.length) return null
    return (
      <Fragment key={g.bucket}>
        <div className={cls('td-sub', g.red && 'red')} {...(g.drop !== null ? { 'data-drop': `b:${g.drop}` } : {})}>
          {g.name}
          {g.items.length > 0 && <span className="n num">{g.items.length}</span>}
        </div>
        {shown.length ? shown.map(row) : <div className="td-more">{`空着，拖一条到「${g.name}」上就改到这天`}</div>}
      </Fragment>
    )
  })
  const hidden = props.limit && !all ? Math.max(0, total - props.limit) : 0
  return (
    <>
      {blocks}
      {hidden > 0 && (
        <button className="td-more td-btn" onClick={() => setAll(true)}>
          {`还有${hidden}条 ›`}
        </button>
      )}
      {props.showDone && done.length > 0 && (
        <>
          <button className="td-more td-btn" aria-expanded={doneOpen} onClick={() => setDoneOpen((x) => !x)}>
            {`已完成${done.length} ${doneOpen ? '⌄' : '›'}`}
          </button>
          {doneOpen && done.map(row)}
        </>
      )}
    </>
  )
}

/** 加一条（原型 .qa）：回车加上；hintWhere 给了时下面一行「认出来：…」（左边格子） */
export function QuickAdd(props: { where: TodoWhere; placeholder: string; label: string; hintWhere?: string; className?: string }) {
  const [v, setV] = useState('')
  const today = useToday()
  const busy = useRef(false)
  return (
    <>
      <div className={cls('td-qa', props.className)}>
        <Codicon name="add" size={12} />
        <input
          aria-label={props.label}
          placeholder={props.placeholder}
          value={v}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setV(e.target.value)}
          onKeyDown={async (e) => {
            if (e.key === 'Escape') return e.currentTarget.blur()
            if (e.key !== 'Enter' || composing(e) || !v.trim() || busy.current) return
            busy.current = true
            const ok = await addTodo(v, props.where)
            busy.current = false
            if (ok) setV('')
          }}
        />
      </div>
      {props.hintWhere !== undefined && (
        <div className="td-hint" data-testid="td-hint">
          {quickHint(v, today, props.hintWhere)
            .split(' · ')
            .map((seg, i) => (
              <span key={i} className="td-hseg">
                {i > 0 ? ` · ${seg}` : seg}
              </span>
            ))}
        </div>
      )}
    </>
  )
}

/** 一处待办（左边格子、首页卡、任务界面各一个 owner）：详情小卡由点开它的那一处画，贴着那一行 */
export function useOwner(): string {
  const id = useId()
  useDragging()
  // 这一处收起来了（换了左栏、关了标签）：它开着的小卡一起收
  useEffect(() => () => void (pop?.owner === id && setPop(null)), [id])
  return id
}

/** 这一处开着的那张详情小卡 */
export function TodoPop({ owner }: { owner: string }) {
  const p = usePop()
  const { items } = useTodos()
  if (!p || p.owner !== owner) return null
  const t = items.find((x) => x.key === p.key)
  if (!t) return null
  return <Pop t={t} owner={owner} />
}

const TIMES = ['', '09:00', '10:30', '11:00', '15:00', '18:00', '20:00', '23:59']
const REMINDS = ['', '准时', '提前10分钟', '提前1小时']
const REPEATS = ['', '每天', '每周日', '工作日']

/** 详情小卡（原型 popHtml()）：日期四格、钟点 / 提醒 / 重复、在哪篇第几行、那一行原文、打开笔记到这一行 */
function Pop({ t, owner }: { t: TodoItem; owner: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const today = useToday()
  const installed = useTodayInstalled()
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  // 贴着那一行：右边放得下放右边，不然放左边，再不行放下面；不出窗口（原型的摆法）
  useLayoutEffect(() => {
    const row = document.querySelector<HTMLElement>(`.td-r[data-owner="${CSS.escape(owner)}"][data-key="${CSS.escape(t.key)}"]`)
    const el = ref.current
    if (!row || !el) return
    const r = row.getBoundingClientRect()
    const w = el.offsetWidth
    const h = el.offsetHeight
    let left: number
    let top: number
    const side = row.closest('aside')
    if (side) {
      // 左栏里的一行：放在左栏右边（不压栏边和滚动条），和这一行齐着往上一点（原型的摆法）
      left = Math.max(r.right + 10, side.getBoundingClientRect().right + 8)
      top = r.top - 20
    } else if (r.width >= w) {
      // 首页卡、任务界面里宽过小卡的一行：放在这一行下面、右边对齐（翻到左边会盖住左栏、跨在两块浮岛中间）；下面放不下放上面
      left = r.right - w
      top = r.bottom + 6
      if (top + h + 10 > innerHeight) top = r.top - h - 6
    } else {
      left = r.right + 10
      top = r.top - 20
      if (left + w + 10 > innerWidth) left = r.left - w - 10
    }
    if (top + h + 10 > innerHeight) top = innerHeight - h - 10
    setAt({ left: Math.max(10, Math.min(left, innerWidth - w - 10)), top: Math.max(10, top) })
  }, [t.key, owner, t.raw])
  useEffect(() => {
    const down = (e: MouseEvent) => {
      const el = e.target as HTMLElement
      if (!ref.current?.contains(el) && !el.closest?.('.td-r')) setPop(null)
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setPop(null)
    document.addEventListener('mousedown', down, true)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', down, true)
      document.removeEventListener('keydown', key)
    }
  }, [])
  const picks: [string | null, string][] = [
    [today, '今天'],
    [addDays(today, 1), '明天'],
    [addDays(today, 2), '后天'],
    [null, '不定'],
  ]
  const sel = (k: 'time' | 'remind' | 'repeat', label: string, all: string[], v: string | null, none: string) => (
    <select className="td-sel" aria-label={label} value={v ?? ''} onChange={(e) => void fieldTodo(t, k, e.target.value)}>
      {(v && !all.includes(v) ? [...all, v] : all).map((o) => (
        <option key={o} value={o}>
          {o || none}
        </option>
      ))}
    </select>
  )
  return createPortal(
    <div ref={ref} className="td-pop" role="dialog" aria-label="详情" style={at ?? { visibility: 'hidden' }}>
      <div className="td-pt">
        <Check t={t} />
        <span className="td-pt-t">{t.title}</span>
        <button className="td-x" aria-label="关上" onClick={() => setPop(null)}>
          <Codicon name="close" size={12} />
        </button>
      </div>
      <div className="td-pl">
        <Codicon name="calendar" size={12} />
        日期
        {picks.map(([d, l]) => (
          <button key={l} className={cls('td-pick', t.date === d && 'on')} onClick={() => void dateTodo(t, d)}>
            {l}
          </button>
        ))}
      </div>
      <div className="td-pl wrap">
        <Codicon name="watch" size={12} />
        {sel('time', '钟点', TIMES, t.time, '不定时间')}
        <Codicon name="bell" size={12} />
        {sel('remind', '提醒', REMINDS, t.remind, '不提醒')}
        <Codicon name="sync" size={12} />
        {sel('repeat', '重复', REPEATS, t.repeat, '不重复')}
      </div>
      <div className="td-mono" data-testid="td-where">{`${t.path} · 第${t.line + 1}行`}</div>
      <div className="td-mono td-rawl" data-testid="td-raw">
        {t.raw}
      </div>
      <div className="td-links">
        <button
          className="td-link"
          onClick={() => {
            setPop(null)
            app().openFile(t.path)
            void goToLine(t.path, t.line + 1)
          }}
        >
          打开笔记，到这一行
        </button>
        {installed && (
          <button className="td-link" onClick={() => (setPop(null), void openInToday(t))}>
            在画布今日里打开
          </button>
        )}
      </div>
    </div>,
    document.body,
  )
}

// ---------- 点一条开详情；按住拖一条到某一组（某个日子小块）上改日子（原型 pointerdown / move / up） ----------

let dragUsers = 0
let offDrag: (() => void) | null = null

/** 整个窗口一套拖动（三处都挂着时只挂一次）：挪过 5 才算拖，跟着一张小卡，落点亮起来 */
function useDragging() {
  useEffect(() => {
    if (dragUsers++ === 0) offDrag = installDrag()
    return () => {
      if (--dragUsers === 0) (offDrag?.(), (offDrag = null))
    }
  }, [])
}

function installDrag(): () => void {
  let d: { key: string; owner: string; x: number; y: number; moved: boolean; ghost?: HTMLElement; target?: HTMLElement | null } | null = null
  const clear = () => document.querySelectorAll('.td-sub.over, .td-chip.over').forEach((x) => x.classList.remove('over'))
  const down = (e: PointerEvent) => {
    if (e.button !== 0) return
    const el = e.target as HTMLElement
    const row = el.closest?.<HTMLElement>('.td-r[data-key]')
    if (!row || el.closest('.td-cb, input, select, button')) return
    d = { key: row.dataset.key!, owner: row.dataset.owner!, x: e.clientX, y: e.clientY, moved: false }
  }
  const move = (e: PointerEvent) => {
    if (!d) return
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) return
    if (!d.moved) {
      d.moved = true
      const t = findItem(d.key)
      const g = document.createElement('div')
      g.className = 'td-ghost'
      g.innerHTML = codiconSvg('gripper', { size: 12 })
      g.append(document.createTextNode(t?.title ?? ''))
      document.body.append(g)
      d.ghost = g
      setPop(null)
    }
    d.ghost!.style.left = `${e.clientX}px`
    d.ghost!.style.top = `${e.clientY}px`
    clear()
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-drop]') ?? null
    d.target = over && !over.closest(`.td-r[data-key="${CSS.escape(d.key)}"]`) ? over : null
    d.target?.classList.add('over')
  }
  const up = (e: PointerEvent) => {
    if (!d) return
    const x = d
    d = null
    if (!x.moved) {
      if ((e.target as HTMLElement).closest?.('button, input, select')) return
      setPop(pop?.key === x.key && pop.owner === x.owner ? null : { key: x.key, owner: x.owner })
      return
    }
    x.ghost?.remove()
    clear()
    const t = findItem(x.key)
    const drop = x.target?.dataset.drop
    if (!t || !drop) return
    const date = drop.slice(drop.indexOf(':') + 1) || null
    const today = isoToday()
    // 拖回它自己那一组、拖到同一天的小块上：不改
    if (date === t.date || (drop.startsWith('b:') && date && t.date && bucketOf({ date }, today) === bucketOf(t, today))) return
    void dateTodo(t, date)
  }
  document.addEventListener('pointerdown', down)
  document.addEventListener('pointermove', move)
  document.addEventListener('pointerup', up)
  return () => {
    document.removeEventListener('pointerdown', down)
    document.removeEventListener('pointermove', move)
    document.removeEventListener('pointerup', up)
  }
}

/** 拖动在 React 外面：按 key 找那一条（拿最新的一份） */
const findItem = (key: string): TodoItem | undefined => itemsNow().find((t) => t.key === key)
