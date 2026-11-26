/**
 * 待办三处共用的一套样子（task-pd1d1，原型 05-任务软件/todo-demo.html 的 cb / chip / row / groups / popHtml / 拖动，和画布今日同一套）：
 * 勾选框、一行（标题、灰色出处、行尾日子小块）、按 过期 / 今天 / 明天 / 以后 / 没定日子 分组、加一条、点一条在旁边弹的详情小卡、
 * 拖一条到某一组（或某个日子小块）上改日子。左边「待办」格是窄的（只露勾选框、标题、日子小块），首页卡多露出处，任务界面大一号（big）。
 */
import { Codicon } from '@cn/design'
import { useDismiss } from '@cn/design/dismiss'
import { codiconSvg } from '@cn/design/codicon-svg'
import { trackDrag } from '@cn/design/drag-end'
import { addDays, diffDays, weekday } from '@cn/tasks'
import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { bucketOf, chipText, dayName, isTodoNote, noteName, quickHint, type TodoItem, todoGroups, type TodoWhere } from '../../shared/todo'
import { app } from '../ctx/actions'
import { goToLine } from '../goto-line'
import { useLinkOn } from '../family-store'
import { composing } from '../ime'
import { addTodo, dateTodo, deleteTodo, fieldTodo, isoToday, itemsNow, nowLocal, openInToday, tickTodo, undoJust, useTodayInstalled, useTodos, useToday } from './store'
import { pickWhenFor, useWhenInput } from './when-input'
import { whenEngine } from './when-assist'
import { EngineLogo, type LogoEngine } from '../engine-logo'
import { closeWhenPick } from './when-pick'
import { useKeyHandler } from '../keys'
import { menuAt, type MenuEntry } from '../ctx/menu'
import { dateText } from '../../shared/when'
import './todo.css'
import { useLang } from '../i18n'
import { t as tNow } from '../../shared/i18n'

const cls = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ')

// ---------- 详情小卡开着哪一条（一次只开一张；哪一处的那一行点开的就贴着那一行） ----------

/** anchor：不贴着 .td-r 那一行时（文档里的一行待办，task-kzr3n）给它那一行的框 */
let pop: { key: string; owner: string; anchor?: () => DOMRect | null } | null = null
/** 点一条的文字（不是勾选框、日子小块）时这一块自己接，不开详情小卡：文档的任务看法里是「切回文档、跳到那一行」。按 owner 登记 */
export const onTitleClick = new Map<string, (t: TodoItem) => void>()
const popSubs = new Set<() => void>()
function setPop(p: typeof pop) {
  pop = p
  for (const f of popSubs) f()
}
/** 现在开着的那张（React 外面看：待办首页按 Esc 时先收小卡、再收「只看这天」） */
export const popNow = () => pop
/** 文档里的待办点「看详情」：小卡贴着那一行（owner 是 DOC_OWNER，App 里画一个 <TodoPop owner={DOC_OWNER} />） */
export const DOC_OWNER = 'doc'
export function openPopAt(key: string, anchor: () => DOMRect | null) {
  setPop({ key, owner: DOC_OWNER, anchor })
}
export const usePop = () =>
  useSyncExternalStore(
    (f) => (popSubs.add(f), () => void popSubs.delete(f)),
    () => pop,
  )

/** 勾选框（原型 cb()）：14 方、圆角 4，重要的黄边，勾上填强调色；[/] 进行中填下半格，[-] 取消了画一道横线（点了改回没做完），和画布今日一样 */
// 这几个组件里 t 是那一条待办：界面上的字用 tNow，useLang() 让换语言时重画
export function Check({ t }: { t: TodoItem }) {
  useLang()
  const open = !t.done && !t.cancelled
  return (
    <button
      className={cls('td-cb', t.done && 'on', t.doing && open && 'half', t.cancelled && 'off', t.prio === 3 && open && 'hi')}
      role="checkbox"
      aria-checked={t.done ? true : t.doing && open ? 'mixed' : false}
      aria-label={t.done ? tNow('取消勾选「{title}」', { title: t.title }) : t.cancelled ? tNow('「{title}」已取消，改回没做完', { title: t.title }) : t.doing ? tNow('「{title}」进行中，勾掉', { title: t.title }) : tNow('勾掉「{title}」', { title: t.title })}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        void tickTodo(t)
      }}
    >
      {t.done && <Codicon name="check" size={10} />}
      {t.cancelled && <Codicon name="dash" size={10} />}
    </button>
  )
}

/** 行尾的日子小块（原型 chip()）：有提醒画铃铛，过期的红字；拖一条到它上面就改成这一天。onlyTime：只写钟点，没钟点不画（待办首页「今天」那组） */
function Chip({ t, today, onlyTime }: { t: TodoItem; today: string; onlyTime?: boolean }) {
  useLang()
  if (!t.date || (onlyTime && !t.time)) return null
  return (
    <span className={cls('td-chip', t.date < today && !t.done && 'red')} data-drop={`date:${t.date}`}>
      <Codicon name={t.remind ? 'bell' : 'calendar'} size={10} />
      {onlyTime ? t.time : pastText(t, today) ?? chipText(t, today)}
    </span>
  )
}

/**
 * 前天以前的日子写「11月19日」（18-待办首页原型 dayWord；写「周四」像是下周四到期），钟点照写。
 * 只在日子小块上这样写，dayName / chipText 不动（iPhone / iPad 移植的对照样例照它们）
 */
function pastText(t: Pick<TodoItem, 'date' | 'time'>, today: string): string | null {
  if (!t.date || diffDays(t.date, today) >= -1) return null
  return dateText(msOf(t.date)) + (t.time ? ' ' + t.time : '')
}

/** 一条在哪（待办首页，18-待办首页原型 row() 的 src）：「待办」那篇写文件夹，别的写笔记名 */
const placeOf = (t: TodoItem) => (isTodoNote(t.path) ? (t.path.includes('/') ? t.path.slice(0, t.path.lastIndexOf('/')).split('/').join(' › ') : tNow('最外层')) : noteName(t.path))

/**
 * 一行（原型 row()）：src 时标题后面多一个灰色出处「· 小论文计划」。
 * 待办首页（18-待办首页原型）：place 时出处单独靠右（12 --t3，最宽 150），有重复的多一个 sync；onlyTime 见 Chip
 */
export function Row({ t, today, owner, src, place, onlyTime, sel, flash }: { t: TodoItem; today: string; owner: string; src?: boolean; place?: boolean; onlyTime?: boolean; sel: boolean; flash: boolean }) {
  // 刚勾掉的（2 秒）：原处一行「已完成 · 撤回」，然后整行淡出、进「已完成」
  const just = useTodos().just.has(t.key) && t.done
  if (just)
    return (
      <div className="td-r done just" data-key={t.key} data-owner={owner} role="listitem">
        <Check t={t} />
        <span className="td-tt">
          <span className="td-t">{t.title}</span>
        </span>
        <span className="td-just" role="status">
          {tNow('已完成')}
          {' · '}
          <button
            className="td-link"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              undoJust(t.key)
            }}
          >
            {tNow('撤回')}
          </button>
        </span>
      </div>
    )
  return (
    <div className={cls('td-r', sel && 'sel', t.done && 'done', t.cancelled && 'cancel', flash && 'flash')} data-key={t.key} data-owner={owner} role="listitem">
      <Check t={t} />
      <span className="td-tt">
        <span className="td-t">{t.title}</span>
        {src && <span className="td-src">{` · ${noteName(t.path)}`}</span>}
      </span>
      {place && t.dups.length > 0 && (
        // 抄了好几遍的同一条（滴答同步进日记的）：全库只显示一份，待办首页写着一共几处（左边窄栏放不下，不写）
        <span className="td-place td-dup" title={tNow('这一条抄在{n}处（比如滴答同步进每天的日记），这里只显示一份；勾掉、改日子会把{n}处一起改', { n: t.dups.length + 1 })}>
          <Codicon name="layers" size={11} />
          {tNow('{n}处', { ctx: '抄件', n: t.dups.length + 1 })}
        </span>
      )}
      {place && <span className="td-place">{placeOf(t)}</span>}
      {place && t.repeat && (
        <span className="td-place" title={tNow('重复：{v}', { v: t.repeat })}>
          <Codicon name="sync" size={11} />
        </span>
      )}
      <Chip t={t} today={today} onlyTime={onlyTime} />
    </div>
  )
}

/**
 * 分组（原型 groups()）：只列没做完的，刚勾掉的 2 秒里原处一行「已完成 · 撤回」；dropEmpty 时今天、明天、以后空着也出（一句「空着，拖一条到…」当落点）；
 * showDone 时最后「已完成 N 条 ›」一行（默认收着），点开列出来（划线，完成日子倒着）。limit：没做完的最多先列几条（首页卡），多的「还有 N 条 ›」
 */
export function TodoGroups(props: { list: readonly TodoItem[]; owner: string; src?: boolean; dropEmpty?: boolean; showDone?: boolean; limit?: number }) {
  useLang()
  const { just, flash } = useTodos()
  const today = useToday()
  const p = usePop()
  const [doneOpen, setDoneOpen] = useState(false)
  const [all, setAll] = useState(false)
  const { groups, done } = todoGroups(props.list, today, { dropEmpty: props.dropEmpty, just })
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
          {g.items.some((x) => !x.done) && <span className="n num">{g.items.filter((x) => !x.done).length}</span>}
        </div>
        {shown.length ? shown.map(row) : <div className="td-more">{tNow('空着，拖一条到「{name}」上就改到这天', { name: g.name })}</div>}
      </Fragment>
    )
  })
  const hidden = props.limit && !all ? Math.max(0, total - props.limit) : 0
  return (
    <>
      {blocks}
      {hidden > 0 && (
        <button className="td-more td-btn" onClick={() => setAll(true)}>
          {tNow('还有{n}条 ›', { n: hidden })}
        </button>
      )}
      {props.showDone && done.length > 0 && (
        <>
          <button className="td-more td-btn td-donefold" aria-expanded={doneOpen} onClick={() => setDoneOpen((x) => !x)}>
            {tNow('已完成{n}条 {arrow}', { n: done.length, arrow: doneOpen ? '⌄' : '›' })}
          </button>
          {doneOpen && done.map(row)}
        </>
      )}
    </>
  )
}

/** 不分组的几行（左栏「全部」一篇笔记下面、「已完成」一天下面） */
export function TodoRows(props: { items: readonly TodoItem[]; owner: string }) {
  useLang()
  const { flash } = useTodos()
  const today = useToday()
  const p = usePop()
  return (
    <>
      {props.items.map((t) => (
        <Row key={t.key} t={t} today={today} owner={props.owner} sel={p?.key === t.key} flash={flash === t.key} />
      ))}
    </>
  )
}

/** 加一条（原型 .qa）：回车加上；hintWhere 给了时下面一行「认出来：…」（左边格子） */
export function QuickAdd(props: { where: TodoWhere; placeholder: string; label: string; hintWhere?: string; className?: string }) {
  useLang()
  const [v, setV] = useState('')
  useToday()
  const busy = useRef(false)
  const input = useRef<HTMLInputElement>(null)
  // 打 @、按「定日子」的键弹选择器，本地认不出的问 AI（task-pd289）
  const when = useWhenInput(v, setV, input)
  return (
    <>
      <div className={cls('td-qa', props.className)}>
        <Codicon name="add" size={12} />
        <input
          ref={input}
          aria-label={props.label}
          placeholder={props.placeholder}
          value={v}
          spellCheck={false}
          autoComplete="off"
          onChange={when.onChange}
          onKeyDown={async (e) => {
            if (when.onKeyDown(e)) return
            if (e.key === 'Escape') return e.currentTarget.blur()
            if (e.key !== 'Enter' || composing(e) || !v.trim() || busy.current) return
            busy.current = true
            closeWhenPick()
            const ok = await addTodo(v, props.where, undefined, when.ai)
            busy.current = false
            if (ok) setV('')
          }}
        />
      </div>
      {props.hintWhere !== undefined && (
        <div className="td-hint" data-testid="td-hint">
          {/* AI 认出来的：前面画那一家的标志（偏好「AI 图标用引擎标志」） */}
          {when.ai && <EngineLogo id={whenEngine() as LogoEngine} size={12} className="td-ailogo" />}
          {quickHint(v, nowLocal(), props.hintWhere, when.ai)
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
// 不翻：选项的值写进那一行（画布今日的写法），界面上的字在 Pop 里翻
const REMINDS = ['', '准时', '提前10分钟', '提前1小时']
// 不翻：同上
const REPEATS = ['', '每天', '每周日', '工作日']

/** 详情小卡（原型 popHtml()）：日期四格、钟点 / 提醒 / 重复、在哪篇第几行、那一行原文、打开笔记到这一行 */
function Pop({ t, owner }: { t: TodoItem; owner: string }) {
  useLang()
  /** 提醒、重复几个选项给人看的字（值照旧写进文件） */
  const optName: Record<string, string> = {
    准时: tNow('准时'),
    提前10分钟: tNow('提前10分钟'),
    提前1小时: tNow('提前1小时'),
    每天: tNow('每天'),
    每周日: tNow('每周日'),
    工作日: tNow('工作日'),
  }
  const ref = useRef<HTMLDivElement>(null)
  const more = useRef<HTMLButtonElement>(null)
  const today = useToday()
  // 设置 › 软件家族「待办旁边放『在画布今日里打开』」关了就不放（还没读到库里的开关时照默认：开）
  const todayApp = useTodayInstalled()
  const ctOpen = useLinkOn('ct-open')
  const installed = todayApp && ctOpen !== false
  // 详情小卡开着时按「定日子」的键：弹选择器（task-pd289）
  useKeyHandler('todo-when', () => (more.current ? (pickWhenFor(t, more.current, true), true) : false), 1)
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  // 贴着那一行：右边放得下放右边，不然放左边，再不行放下面；不出窗口（原型的摆法）
  const anchor = usePop()?.anchor
  useLayoutEffect(() => {
    const row = anchor ? null : document.querySelector<HTMLElement>(`.td-r[data-owner="${CSS.escape(owner)}"][data-key="${CSS.escape(t.key)}"]`)
    const el = ref.current
    const r = anchor ? anchor() : row?.getBoundingClientRect()
    if (!r || !el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    let left: number
    let top: number
    const side = row?.closest('aside')
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
  }, [t.key, owner, t.raw, anchor])
  // 点外面（网页里也算）、Esc 收起（公共的 useDismiss；定日子的选择器是后开的一层，Esc 先关它）；里面有原生下拉框，窗口失焦不算
  useDismiss(true, [ref], () => setPop(null), { keep: '.td-r, .cm-tdtools, .cn-whenpick', blur: false, esc: 'late' })
  const picks: [string | null, string][] = [
    [today, tNow('今天')],
    [addDays(today, 1), tNow('明天')],
    [addDays(today, 2), tNow('后天')],
    [null, tNow('不定')],
  ]
  const sel = (k: 'time' | 'remind' | 'repeat', label: string, all: string[], v: string | null, none: string) => (
    <select className="td-sel" aria-label={label} value={v ?? ''} onChange={(e) => void fieldTodo(t, k, e.target.value)}>
      {(v && !all.includes(v) ? [...all, v] : all).map((o) => (
        <option key={o} value={o}>
          {o ? (optName[o] ?? o) : none}
        </option>
      ))}
    </select>
  )
  return createPortal(
    <div ref={ref} className="td-pop" role="dialog" aria-label={tNow('详情')} style={at ?? { visibility: 'hidden' }}>
      <div className="td-pt">
        <Check t={t} />
        <span className="td-pt-t">{t.title}</span>
        <button className="td-x" aria-label={tNow('关上')} onClick={() => setPop(null)}>
          <Codicon name="close" size={12} />
        </button>
      </div>
      <div className="td-pl">
        <Codicon name="calendar" size={12} />
        {tNow('日期')}
        {picks.map(([d, l]) => (
          <button key={l} className={cls('td-pick', t.date === d && 'on')} onClick={() => void dateTodo(t, d)}>
            {l}
          </button>
        ))}
        {/* 最后一块弹定日子和时间的选择器（task-pd289）：现在的日子不在这几块里时它就写那一天、选中的样子（18-待办首页原型那一块），不然写「其他…」；
            一排放得下，不折行（设计复审） */}
        {(() => {
          const other = !!t.date && !picks.some(([d]) => d === t.date)
          return (
            <button ref={more} className={cls('td-pick', other && 'on')} aria-label={tNow('定日子和时间…')} title={tNow('定日子和时间…')} onClick={(e) => pickWhenFor(t, e.currentTarget)}>
              {other ? dateText(msOf(t.date!)) : tNow('其他…')}
            </button>
          )
        })()}
      </div>
      <div className="td-pl wrap">
        <Codicon name="watch" size={12} />
        {sel('time', tNow('钟点'), TIMES, t.time, tNow('不定时间'))}
        <Codicon name="bell" size={12} />
        {sel('remind', tNow('提醒'), REMINDS, t.remind, tNow('不提醒'))}
        <Codicon name="sync" size={12} />
        {sel('repeat', tNow('重复'), REPEATS, t.repeat, tNow('不重复'))}
      </div>
      <div className="td-where" data-testid="td-where">{tNow('{path} · 第{n}行', { path: t.path, n: t.line + 1 })}</div>
      <div className="td-mono td-rawl" data-testid="td-raw">
        {t.raw}
      </div>
      <div className="td-links">
        <button
          className="td-pbtn"
          onClick={() => {
            setPop(null)
            app().openFile(t.path)
            void goToLine(t.path, t.line + 1)
          }}
        >
          <Codicon name="go-to-file" size={14} />
          {tNow('打开笔记，到这一行')}
        </button>
        {installed && (
          <button className="td-pbtn" onClick={() => (setPop(null), void openInToday(t))}>
            {tNow('在画布今日里打开')}
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
  const clear = () => document.querySelectorAll('[data-drop].over').forEach((x) => x.classList.remove('over'))
  const down = (e: PointerEvent) => {
    if (e.button !== 0) return
    const el = e.target as HTMLElement
    const row = el.closest?.<HTMLElement>('.td-r[data-key]')
    if (!row || el.closest('.td-cb, input, select, button')) return
    d = { key: row.dataset.key!, owner: row.dataset.owner!, x: e.clientX, y: e.clientY, moved: false }
    // 松手没送到页面（窗口外松手、失焦）：当没拖过，日子不改（trackDrag，task-0nz63）
    stop = trackDrag<PointerEvent>(e, { move, end: (how, ev) => (how === 'up' ? up(ev!) : cancel()) })
  }
  let stop: (() => void) | null = null
  const cancel = () => {
    const x = d
    d = null
    if (!x?.moved) return
    x.ghost?.remove()
    clear()
    document.querySelectorAll('.td-r.dragging').forEach((r) => r.classList.remove('dragging'))
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
      // 指到哪一天写「→ 改到 明天」（18-待办首页原型 .ghost .to）
      const to = document.createElement('span')
      to.className = 'to'
      g.append(to)
      document.body.append(g)
      d.ghost = g
      setPop(null)
      document.querySelectorAll(`.td-r[data-key="${CSS.escape(d.key)}"]`).forEach((r) => r.classList.add('dragging'))
    }
    d.ghost!.style.left = `${e.clientX}px`
    d.ghost!.style.top = `${e.clientY}px`
    clear()
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-drop]') ?? null
    d.target = over && !over.closest(`.td-r[data-key="${CSS.escape(d.key)}"]`) ? over : null
    d.target?.classList.add('over')
    const v = d.target?.dataset.drop
    const day = v ? v.slice(v.indexOf(':') + 1) : null
    d.ghost!.querySelector('.to')!.textContent = v === undefined ? '' : tNow('→ 改到 {when}', { when: day ? dayName(day, isoToday()) : tNow('不定日期') })
  }
  const up = (e: PointerEvent) => {
    if (!d) return
    const x = d
    d = null
    if (!x.moved) {
      if ((e.target as HTMLElement).closest?.('button, input, select')) return
      // 点行尾的日子小块：弹定日子和时间的选择器（task-pd289），不开详情小卡
      const chip = (e.target as HTMLElement).closest?.<HTMLElement>('.td-chip')
      const it = chip ? findItem(x.key) : undefined
      if (chip && it) return pickWhenFor(it, chip)
      const title = (e.target as HTMLElement).closest?.('.td-t') ? onTitleClick.get(x.owner) : undefined
      const hit = title && findItem(x.key)
      if (title && hit) return (setPop(null), title(hit))
      const close = pop?.key === x.key && pop.owner === x.owner
      setPop(close ? null : { key: x.key, owner: x.owner })
      // 左栏点一条：待办首页开着时中间也滚到这一条、一起亮（18-待办首页「要你定 2」①）
      if (!close) window.dispatchEvent(new CustomEvent('cn:todo-focus', { detail: { key: x.key, owner: x.owner } }))
      return
    }
    x.ghost?.remove()
    clear()
    document.querySelectorAll('.td-r.dragging').forEach((r) => r.classList.remove('dragging'))
    const t = findItem(x.key)
    const drop = x.target?.dataset.drop
    if (!t || !drop) return
    const date = drop.slice(drop.indexOf(':') + 1) || null
    const today = isoToday()
    // 拖回它自己那一组、拖到同一天的小块上：不改
    if (date === t.date || (drop.startsWith('b:') && date && t.date && bucketOf({ date }, today) === bucketOf(t, today))) return
    void dateTodo(t, date)
  }
  // 右键一条（18-待办首页「两边的关系和细节」）：今天 / 明天 / 下周一 · 打开笔记，到这一行 · 删除（系统菜单）
  const ctx = (e: MouseEvent) => {
    const row = (e.target as HTMLElement).closest?.<HTMLElement>('.td-r[data-key]')
    const t = row && findItem(row.dataset.key!)
    if (!t) return
    void menuAt(e, todoMenu(t))
  }
  document.addEventListener('pointerdown', down)
  document.addEventListener('contextmenu', ctx)
  return () => {
    stop?.()
    cancel()
    document.removeEventListener('pointerdown', down)
    document.removeEventListener('contextmenu', ctx)
  }
}

/** 下周一（明天就是周一时是再下一个周一，和画布今日、原型一样） */
export function nextMonday(today: string): string {
  let d = addDays(today, ((8 - weekday(today)) % 7) || 7)
  if (d === addDays(today, 1)) d = addDays(d, 7)
  return d
}

/** 「2026-11-25」→ 那天本地零点的毫秒（给 when.ts 的 dateText 写「11月25日」） */
export const msOf = (d: string) => new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))).getTime()

/** 一条待办的右键菜单 */
function todoMenu(t: TodoItem): MenuEntry[] {
  const today = isoToday()
  const day = (label: string, d: string): MenuEntry => ({ label: `${label}（${dateText(msOf(d))}）`, enabled: t.date !== d, run: () => void dateTodo(t, d) })
  return [
    day(tNow('今天'), today),
    day(tNow('明天'), addDays(today, 1)),
    day(tNow('下周一'), nextMonday(today)),
    '-',
    {
      label: tNow('打开笔记，到这一行'),
      run: () => {
        setPop(null)
        app().openFile(t.path)
        void goToLine(t.path, t.line + 1)
      },
    },
    '-',
    { label: tNow('删除'), run: () => void deleteTodo(t) },
  ]
}

/** 拖动在 React 外面：按 key 找那一条（拿最新的一份） */
const findItem = (key: string): TodoItem | undefined => itemsNow().find((t) => t.key === key)
