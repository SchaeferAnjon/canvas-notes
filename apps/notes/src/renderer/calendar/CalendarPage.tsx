/**
 * 图标栏「日历」格（task-kzr3n，用户 2026-11-22「这个日历需要做, 并且做的和demo一样就行」「日历做到左边」；
 * 照画布今日 v2 原型「画布笔记 · 日历」那一屏）：
 *   左栏（CalendarSide）：头「日历」+「画布今日」、小月历（今天实心、之后六天淡底、有事的日子一个点）、
 *        没连时「连接系统日历」卡，连上了列系统日历（带锁、只读；右键、点色块能「不在这里显示」，task-ov5bb）和系统提醒事项里「画布今日」那个列表（两边同步）
 *   中间（CalendarPage，标签种类 calendar）：大标题「日历」+「11月22日 – 11月28日 · 系统日历的日程只读，待办能拖」、
 *        ‹ 今天 › ……「帮我排进空着的时间」· 月 / 周，周看法按钟点（系统日程用它自己的颜色、带锁），月看法一个月
 * 日历的样子全是和画布今日共用的 @cn/calendar（CalBar、WeekGrid、MonthGrid、MiniMonth、useDragDrop），这里只接数据：
 * 待办就是库里的「- [ ]」（todo/store.ts），拖一条到某天某个钟点只改那一行的 📅（日子、钟点）；系统日历只读（main/calendar.ts）；
 * AI 排空档照画布今日（同一份 ai-plan），先给看（虚线框），收下才写。
 */
import { CAL_TEXT, CalBar, type CalEvent, type CalItem, type CalMode, daysFrom, hasEvents, mdOf, MiniMonth, MonthGrid, monthWeeks, parseDrop, shiftMonth, useDragDrop, WeekGrid } from '@cn/calendar'
import '@cn/calendar/calendar.css'
import { Codicon } from '@cn/design'
import { addDays } from '@cn/tasks'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { CalLinkState, SchedResult } from '../../shared/calendar'
import { t as tNow } from '../../shared/i18n'
import { isOpen, listed, type TodoItem } from '../../shared/todo'
import { app } from '../ctx/actions'
import { showMenu } from '../ctx/menu'
import { EngineLogo, type LogoEngine } from '../engine-logo'
import { useLang, useT } from '../i18n'
import { ViewHead } from '../shell/Shell'
import { aboutToday, openTodayApp, timesTodo, useToday, useTodayInstalled, useTodos, whenTodo } from '../todo/store'
import { openPopAt, popNow } from '../todo/TodoList'
import todayIcon from '../assets/today-icon.png'
import './calendar.css'

// ---------- 看周还是月（记在本机，默认周）、看哪几天、左栏小月历看哪个月、系统日历连没连 ----------

const MODE_KEY = 'cn.calMode'
const loadMode = (): CalMode => {
  try {
    return localStorage.getItem(MODE_KEY) === 'month' ? 'month' : 'week'
  } catch {
    return 'week'
  }
}

const isoNow = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface State {
  mode: CalMode
  /** 周：七格的第一天；月：那个月的第一天 */
  anchor: string
  /** 左栏小月历的月份「2026-11」 */
  month: string
  link: CalLinkState | null
  /** 日历 App 里改了：日程重读 */
  rev: number
}
let st: State = { mode: loadMode(), anchor: isoNow(), month: isoNow().slice(0, 7), link: null, rev: 0 }
const subs = new Set<() => void>()
function set(p: Partial<State>) {
  st = { ...st, ...p }
  if (p.mode) {
    try {
      localStorage.setItem(MODE_KEY, p.mode)
    } catch {
      // 记不住只影响下次打开
    }
  }
  for (const f of subs) f()
}
const useCal = () =>
  useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    () => st,
  )

let watching = false
/** 问一次系统日历连没连（打开「日历」格时；这时才起小助手） */
export function refreshLink() {
  void window.cnCal.state().then((link) => set({ link }))
  if (watching) return
  watching = true
  window.cnCal.onChanged(() => void window.cnCal.state().then((link) => set({ link, rev: st.rev + 1 })))
  window.cnCal.onState((link) => set({ link }))
}

/** 这几天的系统日程（没连是空的） */
function useEvents(from: string, to: string): CalEvent[] {
  const { link, rev } = useCal()
  const [evs, setEvs] = useState<CalEvent[]>([])
  useEffect(() => {
    if (!link?.active) return setEvs([])
    let live = true
    void window.cnCal.events(from, to).then((e) => live && setEvs(e))
    return () => void (live = false)
  }, [from, to, link?.active, rev])
  return evs
}

/** 库里有日子的待办 → 日历上的块（取消了的不画；做完的画成划线） */
function calItems(items: readonly TodoItem[], repeatName: (r: string) => string): CalItem[] {
  // 按篇、按行排（同待办清单），「全天」那一排每次打开一个顺序
  return [...items]
    .sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line)
    .filter((x) => listed(x) && x.date && !x.cancelled)
    .map((x) => ({ key: x.key, title: x.title, date: x.date!, time: x.time, done: x.done, ...(x.repeat ? { note: repeatName(x.repeat) } : {}) }))
}

const nowMin = () => {
  const d = new Date()
  return d.getHours() * 60 + d.getMinutes()
}

// ---------- 中间 ----------

type Sched = { job: string; phase: 'think' } | { job: string; phase: 'done'; r: Extract<SchedResult, { ok: true }> } | { job: string; phase: 'error'; msg: string }

export function CalendarPage(props: { active: boolean }) {
  const t = useT()
  const lang = useLang()
  const today = useToday()
  const { items } = useTodos()
  const c = useCal()
  const [now, setNow] = useState(nowMin)
  useEffect(() => {
    const tm = setInterval(() => setNow(nowMin()), 60_000)
    return () => clearInterval(tm)
  }, [])
  useEffect(() => refreshLink(), [])
  const list = useMemo(() => calItems(items, (r) => r), [items])
  const days = daysFrom(c.anchor)
  const cells = c.mode === 'week' ? days : monthWeeks(c.anchor, 0).flat()
  const events = useEvents(cells[0]!, cells[cells.length - 1]!)
  const on = !!c.link?.active
  const [sel, setSel] = useState<string | null>(null)
  const [sched, setSched] = useState<Sched | null>(null)
  const [ai, setAi] = useState<{ engine: string; label: string } | null>(null)
  useEffect(() => void window.cnCal.aiInfo().then(setAi), [])

  // 拖一条改日子、钟点（共用的 useDragDrop：day: 那一列按指到的钟点，allday: 拿掉钟点，mday: 只改日子）；拖日程说只读；点一条弹详情小卡
  useDragDrop({
    title: (key) => items.find((x) => x.key === key)?.title ?? null,
    drop: (key, target, time) => {
      const x = items.find((y) => y.key === key)
      if (!x) return
      const d = parseDrop(target)
      if (d.kind === 'day' && time) void whenTodo(x, d.value, time)
      else if (d.kind === 'allday') void whenTodo(x, d.value, null)
      else if (d.kind === 'mday' || d.kind === 'date') void whenTodo(x, d.value)
    },
    click: (key) => {
      setSel(key)
      const el = () => document.querySelector<HTMLElement>(`.calp [data-drag="${CSS.escape(key)}"]`)?.getBoundingClientRect() ?? null
      openPopAt(key, el)
    },
    readonly: () => app().notice(t('系统日历里的日程是只读的 · 在系统「日历」App 里改')),
  })
  // 小卡收起时不再框着那一条
  useEffect(() => {
    if (!sel) return
    const tm = setInterval(() => !popNow() && setSel(null), 300)
    return () => clearInterval(tm)
  }, [sel])
  // Esc 收起 AI 那一条
  useEffect(() => {
    if (!sched || !props.active) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && closeSched()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  })
  const closeSched = () => {
    if (sched?.phase === 'think') void window.cnCal.aiCancel(sched.job)
    setSched(null)
  }
  const runSched = async () => {
    if (!days.includes(today) || !days.includes(addDays(today, 1))) set({ anchor: today })
    const job = `sched-${Date.now()}`
    setSched({ job, phase: 'think' })
    const r = await window.cnCal.aiSchedule(job)
    setSched((s) => (s?.job !== job ? s : r.ok ? { job, phase: 'done', r } : r.aborted ? null : { job, phase: 'error', msg: r.message }))
  }
  const accept = async () => {
    if (sched?.phase !== 'done') return
    const its = sched.r.slots.flatMap((s) => {
      const x = items.find((y) => y.key === s.key)
      return x ? [{ t: x, time: s.time }] : []
    })
    if (its.length && (await timesTodo(its))) setSched(null)
  }
  const label = ai?.label ?? 'Claude Code'
  const ghosts = sched?.phase === 'done' ? sched.r.slots.map((g) => ({ key: g.key, title: g.title, date: g.date, time: g.time, minutes: g.minutes, note: t('{time} · {engine} 排的', { time: g.time, engine: label }) })) : []
  const step = (n: number) => set({ anchor: c.mode === 'week' ? addDays(c.anchor, 7 * n) : shiftMonth(c.anchor, n) })
  const sub =
    c.mode === 'week'
      ? `${mdOf(lang, days[0]!)} – ${mdOf(lang, days[6]!)} · ${on ? t('系统日历的日程只读，待办能拖') : c.link?.available ? t('还没连接系统日历') : t('拖一条改日子和钟点')}`
      : `${CAL_TEXT[lang].monthTitle(Number(c.anchor.slice(0, 4)), Number(c.anchor.slice(5, 7)))} · ${on ? t('系统日历的日程只读，待办能拖着改日子') : c.link?.available ? t('还没连接系统日历') : t('拖一条改日子')}`
  return (
    <section className="pane calp" data-testid="calendar-page">
      <div className="calp-head">
        <h1>{t('日历')}</h1>
        <span className="t2" data-testid="cal-sub">
          {sub}
        </span>
      </div>
      <CalBar lang={lang} mode={c.mode} onPrev={() => step(-1)} onToday={() => set({ anchor: c.mode === 'week' ? today : `${today.slice(0, 7)}-01` })} onNext={() => step(1)} onMode={(m) => set({ mode: m, anchor: m === 'week' ? today : `${c.anchor.slice(0, 7)}-01` })}>
        {c.mode === 'week' && (
          <button className="cal-btn" data-ai="sched" disabled={sched?.phase === 'think'} onClick={() => void runSched()}>
            {ai && <EngineLogo id={ai.engine as LogoEngine} size={14} />}
            {t('帮我排进空着的时间')}
          </button>
        )}
      </CalBar>
      {c.mode === 'week' && sched && (
        <div className="calp-ai" data-part="AI 帮忙">
          {ai && <EngineLogo id={ai.engine as LogoEngine} size={14} />}
          {sched.phase === 'think' && (
            <>
              <b>{t('{engine} 在看这两天的空档', { engine: label })}</b>
              <span className="calp-thinking" />
            </>
          )}
          {sched.phase === 'done' && sched.r.slots.length > 0 && (
            <>
              <span>
                <b>{t('想把{n}条排进空着的时间', { n: sched.r.slots.length })}</b> {on ? t('· 避开了系统日历里的日程，虚线框是排好的样子') : t('· 避开了有钟点的待办，虚线框是排好的样子')}
              </span>
              <span className="sp" />
              <button className="calp-btn pri" onClick={() => void accept()}>
                {t('收下')}
              </button>
              <button className="calp-btn ghost" onClick={closeSched}>
                {t('不要')}
              </button>
            </>
          )}
          {sched.phase === 'done' && !sched.r.slots.length && (
            <>
              <span>{sched.r.candidates ? t('今天和明天空着的时间排不下了') : t('今天和明天没有还没定钟点的待办')}</span>
              <span className="sp" />
              <button className="calp-btn ghost" onClick={closeSched}>
                {t('关上')}
              </button>
            </>
          )}
          {sched.phase === 'error' && (
            <>
              <b className="err">{t('AI 没答出来：{msg}', { msg: sched.msg })}</b>
              <span className="sp" />
              <button className="calp-btn" onClick={() => void runSched()}>
                {t('再试一次')}
              </button>
              <button className="calp-btn ghost" onClick={closeSched}>
                {t('不要')}
              </button>
            </>
          )}
        </div>
      )}
      {c.mode === 'week' ? <WeekGrid lang={lang} days={days} today={today} nowMin={now} items={list} events={events} ghosts={ghosts} sel={sel} /> : <MonthGrid lang={lang} month={c.anchor} today={today} items={list} events={events} sel={sel} />}
    </section>
  )
}

// ---------- 左栏 ----------

/** 藏起 / 显示一个系统日历（task-ov5bb，和画布今日共用一份）：日程重读 */
async function hideCal(id: string, hide: boolean) {
  set({ link: await window.cnCal.hide(id, hide), rev: st.rev + 1 })
}

/** 左栏一个系统日历的右键：不在这里显示 / 在这里显示；有藏起的时再给「全部显示」 */
function calMenu(x: CalLinkState['calendars'][number], link: CalLinkState) {
  return showMenu([
    x.hidden ? { label: tNow('在这里显示'), run: () => hideCal(x.id, false) } : { label: tNow('不在这里显示'), run: () => hideCal(x.id, true) },
    link.calendars.some((c) => c.hidden) && '-',
    link.calendars.some((c) => c.hidden) && { label: tNow('全部显示'), run: async () => set({ link: await window.cnCal.showAll(), rev: st.rev + 1 }) },
  ])
}

export function CalendarSide() {
  const t = useT()
  const lang = useLang()
  const today = useToday()
  const { items } = useTodos()
  const installed = useTodayInstalled()
  const c = useCal()
  useEffect(() => refreshLink(), [])
  const first = `${c.month}-01`
  const end = shiftMonth(first, 1)
  const events = useEvents(first, addDays(end, -1))
  const marks = useMemo(() => {
    const m = new Set(items.filter((x) => isOpen(x) && listed(x) && x.date).map((x) => x.date!))
    for (let d = first; d < end; d = addDays(d, 1)) if (hasEvents(events, d)) m.add(d)
    return m
  }, [items, events, first, end])
  const link = c.link
  return (
    <aside className="side calside" aria-label={t('日历')}>
      <ViewHead title={t('日历')}>
        {installed ? (
          <button className="td-today" aria-label={t('在画布今日里打开')} data-tip={t('在画布今日里打开')} data-side="below" onClick={openTodayApp}>
            <img src={todayIcon} width={14} height={14} alt="" />
            {t('画布今日')}
          </button>
        ) : (
          <button className="td-link td-about" onClick={aboutToday}>
            {t('了解画布今日')}
          </button>
        )}
      </ViewHead>
      <div className="calside-body">
        <MiniMonth lang={lang} month={c.month} today={today} marks={marks} week={c.mode === 'week'} onMonth={(m) => set({ month: m })} onPick={(d) => set({ anchor: c.mode === 'week' ? d : `${d.slice(0, 7)}-01`, month: d.slice(0, 7) })} />
        {link?.available && !link.active && (
          <div className="calside-conn" data-part="连接系统日历">
            <b>{t('连接系统日历')}</b>
            <p>{t('系统「日历」里的日程只读显示在这里，排时间时会避开。')}</p>
            {link.auth === 'denied' || link.auth === 'restricted' ? (
              <p>
                {t('没给画布笔记访问日历，日程画不出来。')}{' '}
                <button className="td-link" onClick={() => void window.cnCal.openPrivacy()}>
                  {t('打开系统设置')}
                </button>
              </p>
            ) : (
              <ol>
                <li>{t('系统问能不能访问日历：点「允许完全访问」')}</li>
              </ol>
            )}
            <button className="calp-btn pri" disabled={link.asking} onClick={() => void window.cnCal.connect().then((l) => (set({ link: l, rev: st.rev + 1 }), l.active ? app().notice(t('连上了系统日历 · {n}个日历的日程只读显示在日历里', { n: l.calendars.length })) : app().notice(t('没连上：没给访问日历的权限 · 在「系统设置 › 隐私与安全性 › 日历」里能打开'))))}>
              {link.asking ? t('系统在问能不能访问日历…') : t('连接系统日历')}
            </button>
          </div>
        )}
        {link?.active && (
          <div data-part="系统日历">
            <div className="calside-sec">
              {t('系统日历')}
              <span className="sp" />
              {new Set(link.calendars.map((x) => x.source)).size === 1 && <span className="src">{link.calendars[0]!.source}</span>}
            </div>
            {link.calendars.map((x) => {
              const tip = x.hidden ? t('在这里显示「{name}」', { name: x.title }) : t('不在这里显示「{name}」，画布今日里也跟着 · 右键也行', { name: x.title })
              return (
                <div className={`calside-row${x.hidden ? ' off' : ''}`} key={x.id} data-cal={x.id} style={{ '--c': x.color } as React.CSSProperties} onContextMenu={(e) => (e.preventDefault(), void calMenu(x, link))}>
                  <button className="calsw" aria-pressed={!x.hidden} aria-label={tip} data-tip={tip} onClick={() => void hideCal(x.id, !x.hidden)} />
                  <span className="nm">{x.title}</span>
                  <span className="sp" />
                  <Codicon name="lock" size={12} />
                </div>
              )
            })}
            {link.reminders && (
              <>
                <div className="calside-sec">{t('系统提醒事项')}</div>
                <div className="calside-row" style={{ '--c': link.reminders.color } as React.CSSProperties}>
                  <i />
                  <span className="nm">{link.reminders.title}</span>
                  <span className="sp" />
                  <span className="two">{t('两边同步')}</span>
                </div>
              </>
            )}
            <div className="calside-hint">{link.reminders ? t('别的提醒事项列表不收进来。日历里的日程在系统「日历」里改。') : t('日历里的日程在系统「日历」里改。')}</div>
          </div>
        )}
      </div>
    </aside>
  )
}
