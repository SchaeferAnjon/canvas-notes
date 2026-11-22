// 梦游报告一条条怎么排、怎么走（task-m552v）：归类和改名在最上（按去处分组），收下后往下走一条、下面都处理完了才绕回上面
import { describe, expect, it } from 'vitest'
import type { DreamItem, DreamReport } from '../src/shared/api'
import { displayOrder, indexOf, nextPending, pendingViz, progressOf, stepFrom, touchedBy } from '../src/shared/dream-order'

const it_ = (id: string, group: DreamItem['group'], over: Partial<DreamItem> = {}): DreamItem => ({ id, group, title: id, sub: '', why: '', commit: 'c' + id, files: [], state: 'pending', ...over })
const mv = (id: string, to: string) => it_(id, 'file', { move: { from: `收件箱/${id}.md`, to }, files: [`收件箱/${id}.md`, to] })

// 报告里的先后：附件、归类、可视化、补双链、可能重复
const items = [it_('a', 'attach'), mv('f1', '剪藏/旅行/f1.md'), mv('f2', '写作/f2.md'), mv('f3', '剪藏/旅行/f3.md'), it_('v', 'viz', { files: ['课程/x.html', '课程/x 笔记.md'] }), it_('l', 'link', { files: ['收件箱/f1.md'] }), it_('d', 'dup', { commit: null })]

describe('梦游报告的先后（task-m552v）', () => {
  it('归类和改名在最上：按去处分组（条数多的组在前），再是别的几组照报告的先后', () => {
    expect(displayOrder(items).map((i) => i.id)).toEqual(['f1', 'f3', 'f2', 'a', 'v', 'l', 'd'])
    expect(indexOf(items, 'v')).toBe(4)
    expect(indexOf(items, 'x')).toBe(-1)
  })

  it('J / K 换条：到头了不绕回', () => {
    expect(stepFrom(items, 'f1', 1)?.id).toBe('f3')
    expect(stepFrom(items, 'f1', -1)).toBeNull()
    expect(stepFrom(items, 'd', 1)).toBeNull()
  })

  it('收下后往下走一条没处理的；下面都处理完了才绕回上面', () => {
    expect(nextPending(items, 'v')?.id).toBe('l')
    const done = items.map((i) => (['l', 'd'].includes(i.id) ? { ...i, state: 'taken' as const } : i))
    expect(nextPending(done, 'v')?.id).toBe('f1')
    expect(nextPending(items.map((i) => ({ ...i, state: 'dropped' as const })), 'v')).toBeNull()
  })

  it('进度：看过的（打开过、处理过）、收下、丢掉', () => {
    const now = items.map((i) => (i.id === 'f1' ? { ...i, state: 'taken' as const } : i.id === 'd' ? { ...i, state: 'dropped' as const } : i))
    expect(progressOf(now, new Set(['v']))).toEqual({ total: 7, seen: 3, taken: 1, dropped: 1 })
  })

  it('目录树要的：这一条改了哪些文件（挪动两头都算）；没收下的可视化挂在哪篇笔记下面', () => {
    expect(touchedBy(items[1])).toEqual(['收件箱/f1.md', '剪藏/旅行/f1.md'])
    const r = { items, closed: false } as unknown as DreamReport
    expect(pendingViz(r)).toEqual([{ path: '课程/x.html', note: '课程/x 笔记.md', item: 'v' }])
    expect(pendingViz({ ...r, closed: true })).toEqual([])
  })
})
