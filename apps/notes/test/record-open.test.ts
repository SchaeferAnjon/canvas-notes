// 数据库里点一条在右栏打开（数据库第三批第 4 块，task-i921u）：同一条再点不重复开、关联点过去记来路、↑ ↓ 换一条、改名跟着走
import { describe, expect, it } from 'vitest'
import { closeView, emptyDock, findView, isOpen, openView, resetDock, shownDock, VIEW_NAME, VIEW_ORDER } from '../src/shared/dock'
import { onRecord, onRecordOpen, openRecord, recordBack, recordGo, recordMoved, recordNow, syncRecord } from '../src/renderer/base/record-open'

const SRC = 'filters:\n  and:\n    - file.inFolder("课程/ecp/课程计划")'
const L3 = '课程/ecp/课程计划/第3讲 生产.md'
const L4 = '课程/ecp/课程计划/第4讲 市场结构.md'
const E32 = '课程/ecp/练习/练习 3.2.md'

describe('右栏开一条', () => {
  it('同一条再点不重复开：只叫一次「开右栏」、状态不变；换一条换成那一条', () => {
    let opens = 0
    let changes = 0
    const off1 = onRecordOpen(() => opens++)
    const off2 = onRecord(() => changes++)
    openRecord({ path: L3, src: SRC, from: 't1' })
    const first = recordNow()
    expect(first).toMatchObject({ path: L3, view: 0, back: [] })
    openRecord({ path: L3, src: SRC, from: 't1' })
    expect(recordNow()).toBe(first)
    expect(opens).toBe(2)
    expect(changes).toBe(1)
    openRecord({ path: L4, src: SRC, view: 2, from: 't1' })
    expect(recordNow()).toMatchObject({ path: L4, view: 2, back: [] })
    off1()
    off2()
  })

  it('从关联点过去记来路，「←」回去；↑ ↓ 换一条不记来路', () => {
    openRecord({ path: L3, src: SRC })
    openRecord({ path: E32, src: 'filters: x' }, { push: true })
    expect(recordNow()).toMatchObject({ path: E32, back: [{ path: L3 }] })
    recordBack()
    expect(recordNow()).toMatchObject({ path: L3, src: SRC, back: [] })
    recordGo(L4)
    expect(recordNow()).toMatchObject({ path: L4, src: SRC, back: [] })
  })

  it('改名、挪走跟到新路径；开它的那张表改了写法跟上，别的表不动', () => {
    openRecord({ path: L3, src: SRC, from: 'a' })
    recordMoved(L3, '课程/ecp/课程计划/第3讲 生产和成本.md')
    expect(recordNow()?.path).toBe('课程/ecp/课程计划/第3讲 生产和成本.md')
    recordMoved('课程/ecp', '课程/经济学')
    expect(recordNow()?.path).toBe('课程/经济学/课程计划/第3讲 生产和成本.md')
    syncRecord('b', SRC + '\n# 别的表')
    expect(recordNow()?.src).toBe(SRC)
    syncRecord('a', SRC + '\nviews: []')
    expect(recordNow()?.src).toBe(SRC + '\nviews: []')
  })
})

describe('工作区里的「记录」标签', () => {
  it('是右栏的一种标签：开、关、和别的叠成一组，恢复默认时排在最后；没开过一条时不画', () => {
    expect(VIEW_ORDER.at(-1)).toBe('record')
    expect(VIEW_NAME.record).toBe('记录')
    let d = openView(emptyDock(), 'ai')
    d = openView(d, 'record')
    expect(findView(d, 'record')?.group.views).toEqual(['ai', 'record'])
    expect(resetDock(openView(d, 'web')).cols[1]).toMatchObject({ groups: [{ views: ['web', 'ai', 'record'] }] })
    expect(isOpen(shownDock(d, (v) => v !== 'record'), 'record')).toBe(false)
    expect(isOpen(closeView(d, 'record'), 'record')).toBe(false)
  })
})
