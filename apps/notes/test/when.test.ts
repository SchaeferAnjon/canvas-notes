import { describe, expect, it } from 'vitest'
import { when } from '../src/shared/when'

// 2026-11-17 星期二 15:00
const NOW = new Date(2026, 10, 17, 15, 0).getTime()
const at = (...a: [number, number, number, number?, number?]) => new Date(a[0], a[1], a[2], a[3] ?? 0, a[4] ?? 0).getTime()

describe('全软件同一种日期写法（第 1 轮美学）', () => {
  it('只写哪天：今天写钟点、昨天、这周写周几、今年「10月12日」、往年带年；中文和数字之间不手打空格', () => {
    expect(when(at(2026, 10, 17, 9, 5), { now: NOW })).toBe('09:05')
    expect(when(at(2026, 10, 16, 23, 0), { now: NOW })).toBe('昨天')
    expect(when(at(2026, 10, 15, 8, 0), { now: NOW })).toBe('周日')
    expect(when(at(2026, 10, 11, 8, 0), { now: NOW })).toBe('周三')
    expect(when(at(2026, 10, 10, 8, 0), { now: NOW })).toBe('11月10日')
    expect(when(at(2026, 9, 12), { now: NOW })).toBe('10月12日')
    expect(when(at(2024, 1, 1), { now: NOW })).toBe('2024年2月1日')
  })

  it('带钟点：今天 / 昨天 / 周几 / 几月几日后面跟时分', () => {
    expect(when(at(2026, 10, 17, 9, 5), { now: NOW, time: true })).toBe('今天 09:05')
    expect(when(at(2026, 10, 16, 21, 5), { now: NOW, time: true })).toBe('昨天 21:05')
    expect(when(at(2026, 10, 13, 21, 5), { now: NOW, time: true })).toBe('周五 21:05')
    expect(when(at(2026, 10, 2, 9, 30), { now: NOW, time: true })).toBe('11月2日 09:30')
    expect(when(at(2025, 10, 2, 9, 30), { now: NOW, time: true })).toBe('2025年11月2日 09:30')
  })

  it('将来的时间（时钟不准、刚改的设置）不写成「周几」', () => {
    expect(when(at(2026, 10, 19, 9, 0), { now: NOW })).toBe('11月19日')
  })
})
