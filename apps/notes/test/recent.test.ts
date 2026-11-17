import { describe, expect, it } from 'vitest'
import type { NoteFile } from '../src/shared/api'
import { recentOf } from '../src/shared/recent'
import { when } from '../src/shared/when'

const NOW = new Date(2026, 10, 17, 15, 0).getTime() // 2026-11-17 周二 15:00
const DAY = 86400_000
const n = (path: string, mtimeMs: number, extra: Partial<NoteFile> = {}): NoteFile => ({ path, mtimeMs, createdMs: mtimeMs, kind: 'work', ...extra })

describe('最近：按时间分组', () => {
  const notes = [
    n('收件箱/冰岛旅游 2.md', NOW - 3600_000, { kind: 'inbox' }),
    n('课程/ecp/Lecture05 笔记.md', NOW - 6 * 3600_000),
    n('我的疑惑.md', NOW - 2 * DAY),
    n('预算.md', NOW - 5 * DAY, { board: { color: '#b8743a', cards: 6, thumb: [] } }),
    n('十月的.md', new Date(2026, 9, 3).getTime()),
    n('九月的.md', new Date(2026, 8, 20).getTime()),
    n('去年十二月.md', new Date(2025, 11, 5).getTime()),
    n('很久以前.md', new Date(2024, 1, 1).getTime()),
    n('冰岛十天环岛.md', new Date(2026, 5, 1).getTime()),
  ]
  it('置顶 → 今天 → 这周 → 每月一组 → 一年以前并成「更早」；置顶的不在别的组里重复', () => {
    const m = recentOf(notes, { pins: ['冰岛十天环岛.md'], now: NOW, archiveDays: 0 })
    expect(m.pinned.map((x) => x.path)).toEqual(['冰岛十天环岛.md'])
    expect(m.groups.map((g) => [g.label, g.items.map((x) => x.path)])).toEqual([
      ['今天', ['收件箱/冰岛旅游 2.md', '课程/ecp/Lecture05 笔记.md']],
      ['这周', ['我的疑惑.md', '预算.md']],
      ['十月', ['十月的.md']],
      ['九月', ['九月的.md']],
      ['2025年十二月', ['去年十二月.md']],
      ['更早', ['很久以前.md']],
    ])
    expect(m.total).toBe(9)
  })

  it('左栏不列归档了的（底下数一个数）；中间的「最近」页全列；类型筛选只留那一类', () => {
    const left = recentOf(notes, { pins: [], now: NOW, archiveDays: 90 })
    expect(left.archived).toBe(3)
    expect(left.groups.map((g) => g.label)).toEqual(['今天', '这周', '十月', '九月'])
    const center = recentOf(notes, { pins: [], now: NOW, archiveDays: 90, withArchived: true })
    expect(center.groups.map((g) => g.label)).toEqual(['今天', '这周', '十月', '九月', '六月', '2025年十二月', '更早'])
    const boards = recentOf(notes, { pins: [], now: NOW, archiveDays: 0, keep: (x) => !!x.board })
    expect(boards.groups.map((g) => g.items.map((x) => x.path))).toEqual([['预算.md']])
    expect(boards.total).toBe(1)
  })

  it('7000 篇也只分一次组、很快', () => {
    const many = Array.from({ length: 7000 }, (_, i) => n(`日记/${i}.md`, NOW - i * 3600_000 * 4))
    const t = performance.now()
    const m = recentOf(many, { pins: [], now: NOW, archiveDays: 90 })
    expect(performance.now() - t).toBeLessThan(200)
    expect(m.groups.reduce((s, g) => s + g.items.length, 0) + m.archived).toBe(7000)
  })

  it('右边的时间：今天写钟点，这周写周几，今年写几月几日，往年带年份', () => {
    // 写法统一在 shared/when.ts（test/when.test.ts 细测）
    expect(when(NOW - 3600_000, { now: NOW })).toBe('14:00')
    expect(when(NOW - 2 * DAY, { now: NOW })).toBe('周日')
    expect(when(new Date(2026, 9, 12).getTime(), { now: NOW })).toBe('10月12日')
    expect(when(new Date(2024, 1, 1).getTime(), { now: NOW })).toBe('2024年2月1日')
  })
})
