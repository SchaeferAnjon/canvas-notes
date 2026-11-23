/**
 * 日历（原型 calHTML）：月历，周一开头，「2026年11月 ‹ 今天 ›」，右边「按「日期」排 · 拖到哪天就改成哪天」；
 * 上面一条虚线框是没排日子的 N 条（拖进格子定日子，拖回来清掉日期）；一格最多三条、多了「还有N条」。
 * 月历本身是画布今日抽出来的共用组件 @cn/calendar 的 MonthGrid（每格 data-drop="mday:日子"、每条 data-drag），
 * 这里只给它条目（CalItem，名字前一个状态颜色的小圆点）和数据库自己的样子（base-layouts.css 的 .bl-cal 下面）。
 * 翻到哪个月记在本机，不写文件。
 */
import { Codicon } from '@cn/design'
import { CAL_TEXT, type CalItem, monthStart, MonthGrid, shiftMonth } from '@cn/calendar'
import { type BaseRec, columnInfo } from '@cn/format'
import { useMemo, useState } from 'react'
import { t, uiLang } from '../../shared/i18n'
import { type LayoutPart, PART } from './BaseLayout'

const monthKey = (folder: string | null, view: string) => `cn.base.month:${folder ?? ''}:${view}`

function savedMonth(key: string): string | null {
  try {
    const v = localStorage.getItem(key)
    return v && /^\d{4}-\d{2}-01$/.test(v) ? v : null
  } catch {
    return null
  }
}

function saveMonth(key: string, m: string | null) {
  try {
    if (m) localStorage.setItem(key, m)
    else localStorage.removeItem(key)
  } catch {
    // 本机记不住（隐私模式之类）：只是下次回到这个月
  }
}

export function BaseCalendar(props: LayoutPart & { dot(rec: BaseRec): string }) {
  const { ctx, res } = props
  const lang = uiLang() === 'en' ? 'en' : 'zh'
  const T = CAL_TEXT[lang]
  const key = monthKey(ctx.doc.folder, res.view.name)
  const thisMonth = monthStart(ctx.today)
  const [month, setMonth] = useState(() => savedMonth(key) ?? thisMonth)
  const go = (m: string) => {
    setMonth(m)
    saveMonth(key, m === thisMonth ? null : m)
  }
  const items = useMemo<CalItem[]>(
    () =>
      Object.entries(res.days ?? {}).flatMap(([date, recs]) =>
        recs.map((r) => {
          const time = /[ T](\d{1,2}:\d{2})/.exec(r.props[res.dateProp ?? ''] ?? '')?.[1] ?? null
          return {
            key: props.keyOf(r.path),
            title: r.name,
            date,
            time,
            dot: props.dot(r),
          }
        }),
      ),
    [res],
  )
  if (!res.dateProp) return <div className="bl-empty">{t('这个数据库没有日期列：加一列日期，日历就按它排')}</div>
  const label = columnInfo(ctx, res.dateProp).label
  const undated = res.undated ?? []
  return (
    <div className="bl-cal" data-part={PART.cal}>
      <div className="bl-calh">
        <b>{T.monthTitle(Number(month.slice(0, 4)), Number(month.slice(5, 7)))}</b>
        <button type="button" className="bl-ib" aria-label={T.prevMonth} onClick={() => go(shiftMonth(month, -1))}>
          <Codicon name="chevron-left" size={14} />
        </button>
        <button type="button" className="bl-today" onClick={() => go(thisMonth)}>
          {T.today}
        </button>
        <button type="button" className="bl-ib" aria-label={T.nextMonth} onClick={() => go(shiftMonth(month, 1))}>
          <Codicon name="chevron-right" size={14} />
        </button>
        <span className="hint">{t('按「{col}」排 · 拖到哪天就改成哪天', { col: label })}</span>
      </div>
      <div className="bl-tray" data-drop={`${props.id}none:`} data-part={PART.tray}>
        <Codicon name="calendar" size={14} />
        <span>{t('没排日子的{n}条', { n: undated.length })}</span>
        {undated.map((r) => (
          <div key={r.path} className="cal-chip mad" data-drag={props.keyOf(r.path)} title={r.name}>
            <i className="cal-dot" style={{ background: props.dot(r) }} />
            <span className="nm">{r.name}</span>
          </div>
        ))}
        <span className="bl-tray-tip">{t('拖进格子定日子，拖回这里清掉日期')}</span>
      </div>
      <MonthGrid lang={lang} month={month} today={ctx.today} items={items} weekStart={1} />
    </div>
  )
}
