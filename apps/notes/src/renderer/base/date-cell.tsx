/**
 * 数据库的日期格（task-cle3x，照 Notion：以前是浏览器自带的「年/月/日」框，要点小图标才出系统的选择器）：
 * 一个浮层，顶上能打字的框（现在的日子全选着，直接打就换：2026-04-20、2026/4/20、4/20、明天、下周一……），
 * 下面一行说认成了哪天，再下面是小月历（和画布今日、日历页同一个 MiniMonth），点一天就改；底下「清掉」。
 * 回车改成打的那天，Esc 不改。写回时原来带的钟点（2026-04-20T10:00 的 T10:00）留着。
 */
import { MiniMonth } from '@cn/calendar'
import '@cn/calendar/calendar.css'
import { Codicon } from '@cn/design'
import { parseWhen } from '@cn/tasks'
import { useState } from 'react'
import { t as tNow } from '../../shared/i18n'
import { useLang } from '../i18n'
import { FloatPop, type PopAnchor } from '../pop-place'
import { isoToday, nowLocal } from '../todo/store'
import { dayText } from './cols'

const pad = (n: number | string) => String(n).padStart(2, '0')

/** 打的字 → 「2026-04-20」；认不出给 null。先认几种写法（年月日、月日），别的交给待办认时间的那一套（明天、下周一、4月20日） */
export function dayOf(text: string, now = nowLocal()): string | null {
  const s = text.trim()
  if (!s) return null
  let m = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/.exec(s)
  if (m) return valid(Number(m[1]), Number(m[2]), Number(m[3]))
  m = /^(\d{4})-(\d{2})-(\d{2})T/.exec(s)
  if (m) return valid(Number(m[1]), Number(m[2]), Number(m[3]))
  m = /^(\d{1,2})[/.月](\d{1,2})日?$/.exec(s)
  if (m) return valid(Number(now.slice(0, 4)), Number(m[1]), Number(m[2]))
  const w = parseWhen(s, now)
  return w?.date && !w.title.trim() ? w.date : null
}

function valid(y: number, mo: number, d: number): string | null {
  const dt = new Date(y, mo - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? `${y}-${pad(mo)}-${pad(d)}` : null
}

/** 换日子、留着原来的钟点（「2026-11-20 09:30」「2026-11-20T09:30」的后半截） */
const withDay = (old: string, day: string) => (day ? day + (/^\d{4}-\d{2}-\d{2}([ T].*)$/.exec(old)?.[1] ?? '') : '')

export function DatePop(props: { at: PopAnchor; label: string; value: string; onPick(v: string): void }) {
  const lang = useLang()
  const today = isoToday()
  const cur = /^\d{4}-\d{2}-\d{2}/.exec(props.value)?.[0] ?? ''
  const [q, setQ] = useState(cur)
  const typed = q.trim()
  const day = typed ? dayOf(typed) : ''
  const [month, setMonth] = useState((cur || today).slice(0, 7))
  const shown = day || cur || null
  const pick = (d: string) => {
    if (d === cur) return props.onPick(props.value)
    props.onPick(withDay(props.value, d))
  }
  return (
    <FloatPop at={props.at} className="base-pop base-date" role="dialog" aria-label={props.label}>
      <input
        className="base-date-in"
        autoFocus
        aria-label={props.label}
        placeholder={tNow('打一个日子，比如 4/20、明天')}
        value={q}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          setQ(e.currentTarget.value)
          const d = dayOf(e.currentTarget.value)
          if (d) setMonth(d.slice(0, 7))
        }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.nativeEvent.isComposing || e.key !== 'Enter') return
          e.preventDefault()
          if (day !== null) pick(day)
        }}
      />
      <div className={'base-date-hint' + (day === null ? ' bad' : '')} aria-live="polite">
        {day === null ? tNow('认不出这个日子') : day ? dayText(day) : tNow('空着')}
      </div>
      <MiniMonth lang={lang === 'en' ? 'en' : 'zh'} month={month} today={today} marks={new Set()} week={false} onMonth={setMonth} onPick={pick} sel={shown} focus={null} />
      <div className="base-date-foot">
        <button type="button" disabled={!cur} onMouseDown={(e) => e.preventDefault()} onClick={() => props.onPick('')}>
          <Codicon name="close" size={12} />
          {tNow('清掉')}
        </button>
      </div>
    </FloatPop>
  )
}
