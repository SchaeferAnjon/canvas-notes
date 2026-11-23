/**
 * 待办首页（task-kzr3n，设计 /private/tmp/canvas-notes-visual/18-待办首页/ 方向 A「日历在上、清单在下」，用户「照着这个做就行」）：
 * 点图标栏「待办」格中间开「待办」标签（和分类格开分类首页同一个规矩）。
 * 一页从上往下：大标题、一行「今天N条（含过期N条） · 接下来七天N条 · …」、一条小的周条（贴在顶上不跟着滚走；整页日历是图标栏「日历」格，
 * 2026-11-22 用户「日历做到左边」）、加一条、按时间排的清单：今天（过期在前）/ 接下来七天（按天）/ 更晚和没定日子的（按文件夹）/ 已完成（收成一行）。
 * 点周条上一天只看那天（再点、点 ×、按 Esc 回到全部），这时加一条没写哪天就加到那天。按住一条拖到周条上某一格（或某天的小标题上）只改那一行的日子。
 * 和左栏「待办」格是同一份（store.ts）：哪边勾掉、改日子另一边跟着变；左栏点一条，这里滚到这一条、两边一起亮。
 */
import { CAL_TEXT, type CalItem, daysFrom, mdOf } from '@cn/calendar'
import '@cn/calendar/calendar.css'
import { Codicon } from '@cn/design'
import { addDays, diffDays, parseQuick, weekday } from '@cn/tasks'
import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { byFolder, byWhen, dayName, INBOX_TODO, isOpen, listed, type TodoItem, todoLabel } from '../../shared/todo'
import { app } from '../ctx/actions'
import { FolderGlyph } from '../files/look'
import { useLang, useT } from '../i18n'
import { composing } from '../ime'
import { addTodo, isoToday, nowLocal, openTodayApp, todayCount, useToday, useTodayInstalled, useTodos } from './store'
import { useWhenInput } from './when-input'
import { whenEngine } from './when-assist'
import { EngineLogo, type LogoEngine } from '../engine-logo'
import { closeWhenPick } from './when-pick'
import { ActBtn, TabActs } from '../shell/TabActs'
import { popNow, Row, TodoPop, useOwner, usePop } from './TodoList'
import './todo-home.css'

// ---------- 周条看哪一周、只看哪一天 ----------

interface CalState {
  /** 周条七格的第一天（默认今天） */
  wk: string
  /** 只看的那一天 */
  picked: string | null
}

let cal: CalState = { wk: isoToday(), picked: null }
const calSubs = new Set<() => void>()
function setCal(p: Partial<CalState>) {
  cal = { ...cal, ...p }
  for (const f of calSubs) f()
}
const useCal = () =>
  useSyncExternalStore(
    (f) => (calSubs.add(f), () => void calSubs.delete(f)),
    () => cal,
  )

/**
 * 顶上一条小的周条（2026-11-22 用户改：「日历做到左边」，整页的日历是图标栏「日历」格；这里只留七天一行）：
 * ‹ 七格 ›，每格「周一」「23」，有没做完的待办画一到三个小点（过期红点），今天强调色小方块；点一格只看那天（再点回到全部），
 * 每格是拖放目标 date:<日子>（只改日子，钟点不变）。样子借 @cn/calendar 月看法的格子（cal-sdn、cal-dots），不另画一套
 */
function WeekBar({ items, picked, today }: { items: readonly CalItem[]; picked: string | null; today: string }) {
  const lang = useLang()
  const T = CAL_TEXT[lang]
  const days = daysFrom(cal.wk)
  const atNow = cal.wk === today
  return (
    <div className="tdh-wk" data-part="周条">
      <button className="cal-ib" aria-label={T.prevWeek} onClick={() => setCal({ wk: addDays(cal.wk, -7) })}>
        <Codicon name="chevron-left" />
      </button>
      <div className="tdh-wdays">
        {days.map((d) => {
          const its = items.filter((x) => x.date === d)
          const late = d < today && its.length > 0
          return (
            <div
              key={d}
              className={`tdh-wc${d === today ? ' today' : ''}${picked === d ? ' sel' : ''}`}
              data-day={d}
              data-drop={`date:${d}`}
              title={T.dayTip(`${mdOf(lang, d)} ${T.wd[weekday(d)]}`) + (its.length ? T.undoneTip(its.length, late) : '')}
              onClick={() => setCal({ picked: picked === d ? null : d })}
            >
              <span className="tdh-wd">{d === today ? T.today : T.wd[weekday(d)]}</span>
              <span className="cal-sdn">{Number(d.slice(8, 10))}</span>
              <span className="cal-dots">
                {its.slice(0, 3).map((x) => (
                  <i key={x.key} className={late ? 'late' : ''} />
                ))}
              </span>
            </div>
          )
        })}
      </div>
      <button className="cal-ib" aria-label={T.nextWeek} onClick={() => setCal({ wk: addDays(cal.wk, 7) })}>
        <Codicon name="chevron-right" />
      </button>
      {!atNow && (
        <button className="cal-btn" onClick={() => setCal({ wk: today })}>
          {T.backToday}
        </button>
      )}
    </div>
  )
}

// ---------- 首页 ----------

/** 「11月25日 周三」；明天是「明天 · 11月23日 周一」（原型 dayLabel） */
function dayLabel(d: string, today: string, lang: 'zh' | 'en', t: (k: string) => string): string {
  const base = `${mdOf(lang, d)} ${CAL_TEXT[lang].wd[weekday(d)]}`
  return diffDays(d, today) === 1 ? `${t('明天')} · ${base}` : base
}

export function TodoHome(props: { active: boolean }) {
  const t = useT()
  const lang = useLang()
  const { items, keep, flash } = useTodos()
  const today = useToday()
  const owner = useOwner()
  const installed = useTodayInstalled()
  const c = useCal()
  const scroller = useRef<HTMLDivElement>(null)
  const calBar = useRef<HTMLDivElement>(null)
  const below = useRef<HTMLDivElement>(null)
  const [doneOpen, setDoneOpen] = useState(false)
  /** 左栏点的那一条：滚过去以后亮一下 */
  const [focus, setFocus] = useState<string | null>(null)
  const sel = usePop()?.key ?? null
  const picked = c.picked

  // 只看一天的时候按 Esc 回到全部（开着详情小卡时先收小卡：抢在小卡自己的 Esc 前面看一眼）
  useEffect(() => {
    if (!props.active) return
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !cal.picked || popNow()) return
      const el = e.target as HTMLElement
      if (el.closest?.('input, textarea, select, [contenteditable="true"]')) return
      setCal({ picked: null })
    }
    document.addEventListener('keydown', key, true)
    return () => document.removeEventListener('keydown', key, true)
  }, [props.active])
  // 关了这一页：「只看这天」不留到下次
  useEffect(() => () => setCal({ picked: null }), [])

  // 左栏点一条：滚到这一条（只看别的一天时先回到全部）
  useEffect(() => {
    const f = (e: Event) => {
      const d = (e as CustomEvent<{ key: string; owner: string }>).detail
      if (!props.active || !d || d.owner === owner) return
      const it = items.find((x) => x.key === d.key)
      if (it && cal.picked && it.date !== cal.picked) setCal({ picked: null })
      setFocus(d.key)
    }
    window.addEventListener('cn:todo-focus', f)
    return () => window.removeEventListener('cn:todo-focus', f)
  }, [props.active, owner, items])
  // 周条贴在顶上时，它下面的「加一条」和清单从周条下沿剪掉（task-0nz63）：周条自己不铺底，透出来的就是中间岛本身（浮岛有图时是半透明面板），
  // 不再自己叠一层面板色成一整块白，滚过去的字也不会从周条底下透出来。滚动、周条或清单变高时重量一次
  useEffect(() => {
    const s = scroller.current, b = calBar.current, w = below.current
    if (!s || !b || !w) return
    const clip = () => {
      const y = Math.round(b.getBoundingClientRect().bottom - w.getBoundingClientRect().top)
      // 左右、下面放开（负的 inset）：行里伸出去的东西不被剪
      w.style.clipPath = y > 0 ? `inset(${y}px -100vmax -100vmax)` : ''
    }
    clip()
    s.addEventListener('scroll', clip, { passive: true })
    const ro = new ResizeObserver(clip)
    ro.observe(b)
    ro.observe(w)
    return () => {
      s.removeEventListener('scroll', clip)
      ro.disconnect()
    }
  }, [])
  useEffect(() => {
    if (!focus) return
    const el = scroller.current?.querySelector<HTMLElement>(`.td-r[data-key="${CSS.escape(focus)}"]`)
    // 日历贴在顶上：滚到正中，不让日历盖住
    el?.scrollIntoView({ block: 'center' })
    const tm = setTimeout(() => setFocus(null), 1600)
    return () => clearTimeout(tm)
  }, [focus])

  const live = useMemo(() => items.filter((x) => listed(x) && (isOpen(x) || (x.done && keep.has(x.key)))), [items, keep])
  const calItems = useMemo((): CalItem[] => items.filter((x) => isOpen(x) && listed(x) && x.date).map((x) => ({ key: x.key, title: x.title, date: x.date!, time: x.time })), [items])

  const n = todayCount(items, today)
  const over = items.filter((x) => isOpen(x) && listed(x) && x.date !== null && x.date < today).length
  const wkN = items.filter((x) => isOpen(x) && listed(x) && x.date !== null && diffDays(x.date, today) >= 1 && diffDays(x.date, today) <= 7).length

  const row = (x: TodoItem, o: { place?: boolean; onlyTime?: boolean } = {}) => (
    <Row key={x.key} t={x} today={today} owner={owner} place={o.place} onlyTime={o.onlyTime} sel={sel === x.key} flash={flash === x.key || focus === x.key} />
  )
  const count = (k: number) => t('{n}条', { n: k })

  let body: React.ReactNode
  if (picked) {
    const list = live.filter((x) => x.date === picked).sort(byWhen)
    body = (
      <section className="tdh-sec" data-part="这一天">
        <div className="tdh-sech" data-drop={`date:${picked}`}>
          {dayLabel(picked, today, lang, t)}
          <span className="n num">{count(list.filter((x) => !x.done).length)}</span>
          <span className="sp" />
          {/* 只看这一天（原来周条右边那一块挪到这里，周条七格不让位置；18-待办首页设计复审） */}
          <span className="cal-fchip" data-part="日期筛选">
            {t('只看这天')}
            <button aria-label={t('看全部')} title={t('看全部')} onClick={() => setCal({ picked: null })}>
              <Codicon name="close" size={12} />
            </button>
          </span>
        </div>
        {list.length ? list.map((x) => row(x, { place: true, onlyTime: true })) : <div className="tdh-none">{t('这天没有待办。上面加一条就加到这天；或者把别的拖到日历上这一格。')}</div>}
      </section>
    )
  } else {
    const todayList = live.filter((x) => x.date !== null && x.date <= today).sort(byWhen)
    const ov = todayList.filter((x) => x.date! < today)
    const td = todayList.filter((x) => x.date === today)
    const week = Array.from({ length: 7 }, (_, i) => {
      const d = addDays(today, i + 1)
      return [d, live.filter((x) => x.date === d).sort(byWhen)] as const
    })
    const rest = live.filter((x) => x.date === null || diffDays(x.date, today) > 7)
    const folders = byFolder(rest, new Set(items.map((x) => x.path)), keep).map((g) => ({ ...g, items: [...g.items].sort(byWhen) }))
    const done = items.filter((x) => listed(x) && x.done && !keep.has(x.key)).sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line)
    body = (
      <>
        <section className="tdh-sec" data-part="今天组">
          <div className="tdh-sech" data-drop={`date:${today}`}>
            {t('今天')}
            <span className="k">{`${mdOf(lang, today)} ${CAL_TEXT[lang].wd[weekday(today)]}`}</span>
            <span className="n num">{count(todayList.filter((x) => !x.done).length)}</span>
          </div>
          {ov.length > 0 && (
            <>
              <div className="td-sub red">
                {t('过期')}
                <span className="n num">{ov.length}</span>
              </div>
              {ov.map((x) => row(x, { place: true }))}
            </>
          )}
          {td.length > 0 && (
            <>
              {ov.length > 0 && (
                <div className="td-sub" data-drop={`date:${today}`}>
                  {t('今天')}
                  <span className="n num">{td.length}</span>
                </div>
              )}
              {td.map((x) => row(x, { place: true, onlyTime: true }))}
            </>
          )}
          {!todayList.length && <div className="tdh-none">{t('今天没有要做的。拖一条到「今天」上就改到今天。')}</div>}
        </section>
        <section className="tdh-sec" data-part="七天组">
          <div className="tdh-sech">
            {t('接下来七天')}
            <span className="n num">{count(week.reduce((a, [, g]) => a + g.filter((x) => !x.done).length, 0))}</span>
          </div>
          {week.map(([d, g]) =>
            g.length ? (
              <Fragment key={d}>
                <div className="td-sub" data-drop={`date:${d}`}>
                  {dayLabel(d, today, lang, t)}
                  <span className="n num">{g.length}</span>
                </div>
                {g.map((x) => row(x, { place: true }))}
              </Fragment>
            ) : null,
          )}
          {week.every(([, g]) => !g.length) && <div className="tdh-none">{t('接下来七天没有要做的。')}</div>}
        </section>
        {folders.length > 0 && (
          <section className="tdh-sec" data-part="按文件夹组">
            <div className="tdh-sech">
              {t('更晚和没定日子的')}
              <span className="k">{t('按文件夹')}</span>
              <span className="n num">{count(folders.reduce((a, g) => a + g.items.filter((x) => !x.done).length, 0))}</span>
            </div>
            {folders.map((g) => (
              <Fragment key={g.folder}>
                <div className="td-sub tdh-fsub">
                  <FolderGlyph folder={g.folder} size={12} mono />
                  {g.name}
                  <span className="n num">{g.items.length}</span>
                  {g.todo && (
                    <button className="td-link tdh-open" onClick={() => app().openFile(g.todo!)}>
                      {t('打开 {name} ›', { name: todoLabel(g.todo) })}
                    </button>
                  )}
                </div>
                {g.items.map((x) => row(x))}
              </Fragment>
            ))}
          </section>
        )}
        {done.length > 0 && (
          <>
            <button className="tdh-donefold" data-part="已完成" aria-expanded={doneOpen} onClick={() => setDoneOpen((v) => !v)}>
              <Codicon name={doneOpen ? 'chevron-down' : 'chevron-right'} size={12} />
              {t('已完成')}
              <span className="num">{done.length}</span>
              <span className="note">{t('· 勾掉的留在原来那行，写上哪天做完')}</span>
            </button>
            {doneOpen && done.map((x) => row(x, { place: true }))}
          </>
        )}
      </>
    )
  }

  return (
    <section className="pane todop">
      {/* 标签条右端（原型 acts）：装了画布今日时「在画布今日里打开」，A 只有图标、B 图标加字 */}
      {installed && (
        <TabActs active={props.active}>
          <ActBtn icon="open-in-product" label={t('在画布今日里打开')} text onClick={openTodayApp} />
        </TabActs>
      )}
    <div className="tdh-scroll" data-testid="todo-home" ref={scroller}>
      <div className="tdh big">
        <h1>{t('待办')}</h1>
        <div className="tdh-meta" data-testid="tdh-meta">
          {over ? t('今天{n}条（含过期{over}条） · 接下来七天{w}条 · 库里每篇笔记的「- [ ]」都在这里', { n, over, w: wkN }) : t('今天{n}条 · 接下来七天{w}条 · 库里每篇笔记的「- [ ]」都在这里', { n, w: wkN })}
        </div>
        <div className="tdh-cal" ref={calBar}>
          <WeekBar items={calItems} picked={picked} today={today} />
        </div>
        <div ref={below} data-part="周条下面">
          <HomeAdd picked={picked} />
          <div role="list" aria-label={t('待办')}>
            {body}
          </div>
        </div>
      </div>
      <TodoPop owner={owner} />
    </div>
    </section>
  )
}

/**
 * 首页顶上加一条（原型 qaCenter / hintFor）：回车进 收件箱/待办.md；只看某一天时没写哪天就加到那天。
 * 下面一行：没打字时说加到哪、能怎么写；打了字是「认出来：明天 15:00 · 「交论文」 · 回车加进收件箱」（认出来的日子是一块强调色小块）
 */
function HomeAdd({ picked }: { picked: string | null }) {
  const t = useT()
  const lang = useLang()
  const today = useToday()
  const [v, setV] = useState('')
  const busy = useRef(false)
  const input = useRef<HTMLInputElement>(null)
  // 打 @、按「定日子」的键弹选择器，本地认不出的问 AI（task-pd289）
  const when = useWhenInput(v, setV, input)
  const pickedName = picked ? `${mdOf(lang, picked)} ${CAL_TEXT[lang].wd[weekday(picked)]}` : ''
  const q = v.trim() ? parseQuick(v.trim(), nowLocal()) : null
  if (q && when.ai) Object.assign(q, { title: when.ai.title, date: when.ai.date, time: when.ai.time, repeat: when.ai.repeat, remind: when.ai.date ? when.ai.remind : null })
  const date = q ? (q.date ?? picked) : null
  return (
    <div className="tdh-add" data-part="加一条">
      <div className="td-qa big">
        <Codicon name="add" size={14} />
        <input
          ref={input}
          aria-label={t('待办首页加一条')}
          placeholder={picked ? t('加一条到 {day}，回车', { day: pickedName }) : t('加一条，「明天下午三点交论文」')}
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
            const ok = await addTodo(v, { inbox: true }, picked, when.ai)
            busy.current = false
            if (ok) setV('')
          }}
        />
      </div>
      <div className="td-hint tdh-hint" data-testid="td-hint">
        {!q ? (
          picked ? (
            t('没写哪天就加到 {day}；进 {path}', { day: mdOf(lang, picked), path: INBOX_TODO })
          ) : (
            t('回车加进 {path}；能写「明天下午三点」「周五」「12月2日」', { path: INBOX_TODO })
          )
        ) : (
          <>
            {when.ai && <EngineLogo id={whenEngine() as LogoEngine} size={12} className="td-ailogo" />}
            {when.ai ? t('AI 认出来：') : t('认出来：')}
            {date ? <span className="k num">{dayName(date, today) + (q.time ? ' ' + q.time : '')}</span> : <span>{t('没定日子')}</span>}
            {q.repeat && <span>{` · ${q.repeat}`}</span>}
            {q.remind && <span>{` · ${t('提醒：{v}', { v: q.remind })}`}</span>}
            <span>
              {' · '}
              {t('「{title}」', { title: q.title || '…' })}
            </span>
            <span>
              {' · '}
              {q.list ? t('回车加进「#{list}」那篇', { list: q.list }) : t('回车加进{where}', { where: '收件箱' /* 不翻：磁盘上的文件夹名 */ })}
            </span>
          </>
        )}
      </div>
    </div>
  )
}
