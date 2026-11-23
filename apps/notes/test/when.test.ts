import { describe, expect, it } from 'vitest'
import { dueText, when } from '../src/shared/when'

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

describe('往后的一天（自动化加待办的提醒，task-i921u）', () => {
  // 2026-11-23 星期一（这周是 11月23日到29日）
  const MON = new Date(2026, 10, 23, 1, 0).getTime()
  it('今天、明天、这周还没到的写周几、下周写「下周一」，再往后写几月几日，往年带年；带钟点跟在后面', () => {
    expect(dueText('2026-11-23', '21:00', MON, 'zh')).toBe('今天 21:00')
    expect(dueText('2026-11-24', '09:00', MON, 'zh')).toBe('明天 09:00')
    expect(dueText('2026-11-27', null, MON, 'zh')).toBe('周五')
    expect(dueText('2026-11-29', '09:00', MON, 'zh')).toBe('周日 09:00')
    expect(dueText('2026-11-30', '09:00', MON, 'zh')).toBe('下周一 09:00')
    expect(dueText('2026-12-06', '09:00', MON, 'zh')).toBe('下周日 09:00')
    expect(dueText('2026-12-07', '09:00', MON, 'zh')).toBe('12月7日 09:00')
    expect(dueText('2027-01-04', null, MON, 'zh')).toBe('2027年1月4日')
  })
  it('周日看：明天是下周一（照周一开头算这一周）', () => {
    const SUN = new Date(2026, 10, 29, 20, 0).getTime()
    expect(dueText('2026-11-30', '09:00', SUN, 'zh')).toBe('明天 09:00')
    expect(dueText('2026-12-01', '09:00', SUN, 'zh')).toBe('下周二 09:00')
  })
  it('英文界面', () => {
    expect(dueText('2026-11-24', '09:00', MON, 'en')).toBe('Tomorrow 09:00')
    expect(dueText('2026-11-30', null, MON, 'en')).toBe('Next week Mon')
  })
})
