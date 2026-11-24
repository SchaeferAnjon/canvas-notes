/** 生长图里的日子怎么写：中文「2026年9月24日 周四」、今年的省掉年；英文照 Intl（Sep 24, 2026 · Thu） */
import { dayParts } from '../../shared/growth'
import { uiLang } from '../../shared/i18n'

const utc = (day: number) => new Date(day * 86_400_000)
const EN_DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const EN_FULL = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
const EN_WD = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' })
const EN_MON = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' })

/** 哪天：今年的不写年（full 一定写年） */
export function dayText(day: number, today: number, full = false): string {
  const p = dayParts(day)
  const sameYear = !full && p.y === dayParts(today).y
  if (uiLang() === 'en') return (sameYear ? EN_DAY : EN_FULL).format(utc(day))
  return sameYear ? `${p.m}月${p.d}日` : `${p.y}年${p.m}月${p.d}日` // 不翻：中文的日期写法
}

export const weekText = (day: number) => (uiLang() === 'en' ? EN_WD.format(utc(day)) : '周' + '日一二三四五六'[dayParts(day).wd]) // 不翻：中文的星期写法

/** 时间轴上的刻度：年份、月份 */
export const yearText = (y: number) => (uiLang() === 'en' ? String(y) : `${y}年`) // 不翻：中文的年份写法
export const monthText = (m: number) => (uiLang() === 'en' ? EN_MON.format(new Date(Date.UTC(2020, m - 1, 1))) : `${m}月`) // 不翻：中文的月份写法
