import { describe, expect, it } from 'vitest'
import {
  activateView,
  addBehind,
  closeView,
  COL_DEFAULT,
  dockFloat,
  dropView,
  emptyDock,
  findView,
  fitCols,
  floatView,
  hideAll,
  isOpen,
  isShown,
  loadDock,
  moveCol,
  moveColBefore,
  moveFloat,
  openView,
  resetDock,
  resetSplit,
  resizeFloat,
  setColWidth,
  setPairWidths,
  setSplit,
  shownDock,
  sideCols,
  toggleView,
  type Dock,
  type SideCol,
} from '../src/shared/dock'

const ids = (d: Dock) => d.cols.map((c) => (c.id === 'center' ? 'center' : (c as SideCol).groups.map((g) => g.views.join('+')).join('/')))

describe('工作区布局（方向 A 拖到哪就在哪）', () => {
  it('空的：只有中间；开 AI 在中间右边新开一栏 380，只开一样时它占满整栏', () => {
    const d = openView(emptyDock(), 'ai')
    expect(ids(d)).toEqual(['center', 'ai'])
    const col = sideCols(d)[0]!
    expect(col.w).toBe(COL_DEFAULT)
    expect(col.groups).toHaveLength(1)
    expect(col.groups[0]!.f).toBe(1)
    expect(isShown(d, 'ai')).toBe(true)
  })

  it('网页和 AI 一起开：同一组的两个标签（不硬切上下两截），后开的排在后面、换成它', () => {
    let d = openView(emptyDock(), 'ai')
    d = openView(d, 'web')
    expect(ids(d)).toEqual(['center', 'ai+web'])
    expect(isShown(d, 'web')).toBe(true)
    expect(isShown(d, 'ai')).toBe(false)
    expect(isOpen(d, 'ai')).toBe(true)
    // 开着但在后面：再开就是换到它
    d = openView(d, 'ai')
    expect(isShown(d, 'ai')).toBe(true)
    expect(ids(d)).toEqual(['center', 'ai+web'])
  })

  it('AI 开网页：网页开在 AI 那一组的后面，AI 还在前面；AI 在浮窗里也一样；已经开着、AI 没开时不动或照常开', () => {
    let d = addBehind(openView(emptyDock(), 'ai'), 'web', 'ai')
    expect(ids(d)).toEqual(['center', 'ai+web'])
    expect(isShown(d, 'ai')).toBe(true)
    expect(isOpen(d, 'web')).toBe(true)
    expect(isShown(d, 'web')).toBe(false)
    // 已经开着：不动
    expect(addBehind(d, 'web', 'ai')).toBe(d)
    // AI 在浮窗里：网页叠在浮窗的后面
    const f = floatView(openView(emptyDock(), 'ai'), 'ai', { x: 300, y: 200 }, { w: 1440, h: 900 })
    const g = addBehind(f, 'web', 'ai')
    expect(g.floats[0]!.views).toEqual(['ai', 'web'])
    expect(g.floats[0]!.active).toBe('ai')
    // AI 没开：照常开（在前面）
    expect(isShown(addBehind(emptyDock(), 'web', 'ai'), 'web')).toBe(true)
  })

  it('toggle：看得见再点是收起；在后面时换到它；收完最后一个整栏没了', () => {
    let d = openView(openView(emptyDock(), 'ai'), 'web')
    d = toggleView(d, 'ai')
    expect(isShown(d, 'ai')).toBe(true)
    d = toggleView(d, 'ai')
    expect(isOpen(d, 'ai')).toBe(false)
    expect(isShown(d, 'web')).toBe(true)
    d = closeView(d, 'web')
    expect(ids(d)).toEqual(['center'])
  })

  it('拖网页到下半：右栏上下两块，AI 在上、网页在下，各一半', () => {
    let d = openView(openView(openView(emptyDock(), 'web'), 'note'), 'ai')
    const g = sideCols(d)[0]!.groups[0]!
    d = dropView(d, 'web', { kind: 'group', group: g.id, zone: 'bottom' })
    const col = sideCols(d)[0]!
    expect(col.groups.map((x) => x.views)).toEqual([['note', 'ai'], ['web']])
    expect(col.groups.map((x) => x.f)).toEqual([0.5, 0.5])
    expect(isShown(d, 'ai')).toBe(true)
    expect(isShown(d, 'web')).toBe(true)
  })

  it('拖到上半、左右并排一栏（320 宽）、叠回成标签', () => {
    let d = openView(openView(emptyDock(), 'web'), 'ai')
    const g = sideCols(d)[0]!.groups[0]!
    d = dropView(d, 'web', { kind: 'group', group: g.id, zone: 'top' })
    expect(sideCols(d)[0]!.groups.map((x) => x.views)).toEqual([['web'], ['ai']])
    const ai = findView(d, 'ai')!
    d = dropView(d, 'web', { kind: 'group', group: ai.group.id, zone: 'right' })
    expect(ids(d)).toEqual(['center', 'ai', 'web'])
    expect(sideCols(d)[1]!.w).toBe(320)
    d = dropView(d, 'web', { kind: 'group', group: findView(d, 'ai')!.group.id, zone: 'left' })
    expect(ids(d)).toEqual(['center', 'web', 'ai'])
    d = dropView(d, 'web', { kind: 'group', group: findView(d, 'ai')!.group.id, zone: 'center' })
    expect(ids(d)).toEqual(['center', 'ai+web'])
    expect(isShown(d, 'web')).toBe(true)
  })

  it('拖到自己独占的那一组：不变', () => {
    let d = openView(emptyDock(), 'ai')
    const g = findView(d, 'ai')!.group.id
    for (const zone of ['center', 'top', 'bottom', 'left', 'right'] as const) expect(dropView(d, 'ai', { kind: 'group', group: g, zone })).toBe(d)
  })

  it('拖到中间左边成一栏（340 宽），中间右边也行', () => {
    let d = openView(openView(openView(emptyDock(), 'web'), 'note'), 'ai')
    d = dropView(d, 'note', { kind: 'center', side: 'left' })
    expect(ids(d)).toEqual(['note', 'center', 'web+ai'])
    expect(sideCols(d)[0]!.w).toBe(340)
    d = dropView(d, 'web', { kind: 'center', side: 'right' })
    expect(ids(d)).toEqual(['note', 'center', 'web', 'ai'])
  })

  it('拖到中间浮起来：浮窗 380 × 500，挪、改大小（最小 300 × 260），「停靠」放回右栏', () => {
    let d = openView(openView(emptyDock(), 'web'), 'ai')
    d = dropView(d, 'ai', { kind: 'float', x: 400, y: 200 }, { w: 1440, h: 900 })
    expect(d.floats).toHaveLength(1)
    const f = d.floats[0]!
    expect([f.x, f.y, f.w, f.h]).toEqual([400, 200, 380, 500])
    expect(isShown(d, 'ai')).toBe(true)
    expect(ids(d)).toEqual(['center', 'web'])
    d = moveFloat(d, f.id, 380, 230, { w: 1440, h: 900 })
    expect([d.floats[0]!.x, d.floats[0]!.y]).toEqual([380, 230])
    d = resizeFloat(d, f.id, 100, 100)
    expect([d.floats[0]!.w, d.floats[0]!.h]).toEqual([300, 260])
    d = dockFloat(d, f.id)
    expect(d.floats).toHaveLength(0)
    expect(ids(d)).toEqual(['center', 'web+ai'])
    expect(isShown(d, 'ai')).toBe(true)
  })

  it('浮窗挪出窗口时留至少 60 在里面', () => {
    let d = openView(emptyDock(), 'ai')
    d = floatView(d, 'ai', { x: 100, y: 100 }, { w: 1000, h: 700 })
    const id = d.floats[0]!.id
    d = moveFloat(d, id, 5000, -400, { w: 1000, h: 700 })
    expect(d.floats[0]!.x).toBe(940)
    expect(d.floats[0]!.y).toBe(0)
    d = moveFloat(d, id, -5000, 5000, { w: 1000, h: 700 })
    expect(d.floats[0]!.x).toBe(60 - 380)
    expect(d.floats[0]!.y).toBe(640)
  })

  it('拖到浮窗上叠成标签；浮窗里最后一个拖走浮窗就没了', () => {
    let d = openView(openView(emptyDock(), 'web'), 'ai')
    d = floatView(d, 'ai', { x: 100, y: 100 }, { w: 1440, h: 900 })
    const fid = d.floats[0]!.id
    d = dropView(d, 'web', { kind: 'group', group: fid, zone: 'center' })
    expect(d.floats[0]!.views).toEqual(['ai', 'web'])
    expect(ids(d)).toEqual(['center'])
    d = dropView(d, 'web', { kind: 'center', side: 'right' })
    d = dropView(d, 'ai', { kind: 'center', side: 'right' })
    expect(d.floats).toHaveLength(0)
    expect(ids(d)).toEqual(['center', 'ai', 'web'])
  })

  it('整栏挪：中间和右栏换位置、再换回来；挪到最左', () => {
    let d = openView(emptyDock(), 'ai')
    d = moveCol(d, 0, 2)
    expect(ids(d)).toEqual(['ai', 'center'])
    d = moveCol(d, 0, 2)
    expect(ids(d)).toEqual(['center', 'ai'])
    d = dropView(openView(d, 'note'), 'note', { kind: 'center', side: 'left' })
    expect(ids(d)).toEqual(['note', 'center', 'ai'])
    d = moveCol(d, 2, 0)
    expect(ids(d)).toEqual(['ai', 'note', 'center'])
    // 挪到原处：不变
    expect(moveCol(d, 1, 1)).toBe(d)
    expect(moveCol(d, 1, 2)).toBe(d)
    // 按 id 挪：AI 那栏挪到最后、挪到中间前面
    const ai = findView(d, 'ai')!.col!.id
    d = moveColBefore(d, ai, null)
    expect(ids(d)).toEqual(['note', 'center', 'ai'])
    d = moveColBefore(d, ai, 'center')
    expect(ids(d)).toEqual(['note', 'ai', 'center'])
  })

  it('拖宽了的一栏收完、再开：还是这个宽（存着，重开软件也在）；恢复默认回到 380', () => {
    let d = openView(emptyDock(), 'history')
    d = setColWidth(d, sideCols(d)[0]!.id, 500)
    d = closeView(d, 'history')
    expect(sideCols(d)).toHaveLength(0)
    d = openView(d, 'history')
    expect(sideCols(d)[0]!.w).toBe(500)
    // 存下来、读回来（重开软件）：再开一样也是这个宽
    const back = loadDock(JSON.stringify(closeView(d, 'history')), {})
    expect(sideCols(openView(back, 'ai'))[0]!.w).toBe(500)
    expect(sideCols(resetDock(d))[0]!.w).toBe(COL_DEFAULT)
  })

  it('宽度最窄 300、不设上限（中间至少 420 由界面量着管），存下来读回来还是那么宽；上下分的比例最小 18%，双击回一半', () => {
    let d = openView(openView(emptyDock(), 'web'), 'ai')
    const col = sideCols(d)[0]!
    expect(sideCols(setColWidth(d, col.id, 100))[0]!.w).toBe(300)
    expect(sideCols(setColWidth(d, col.id, 1100))[0]!.w).toBe(1100)
    expect(sideCols(loadDock(JSON.stringify(setColWidth(d, col.id, 1100)), {}))[0]!.w).toBe(1100)
    d = dropView(d, 'web', { kind: 'group', group: col.groups[0]!.id, zone: 'bottom' })
    const [a, b] = sideCols(d)[0]!.groups.map((g) => g.id)
    d = setSplit(d, a!, b!, 0.05)
    expect(sideCols(d)[0]!.groups.map((g) => g.f)).toEqual([0.18, 0.82])
    d = setSplit(d, a!, b!, 0.7)
    expect(sideCols(d)[0]!.groups.map((g) => Math.round(g.f * 100))).toEqual([70, 30])
    d = resetSplit(d, a!, b!)
    expect(sideCols(d)[0]!.groups.map((g) => g.f)).toEqual([0.5, 0.5])
  })

  it('恢复默认：右栏一栏，开着的几样叠成一组，浮窗停回来；看得见的那个还在前面', () => {
    let d = openView(openView(openView(emptyDock(), 'web'), 'note'), 'ai')
    d = dropView(d, 'note', { kind: 'center', side: 'left' })
    d = dropView(d, 'web', { kind: 'group', group: findView(d, 'ai')!.group.id, zone: 'bottom' })
    d = floatView(d, 'ai', { x: 300, y: 200 }, { w: 1440, h: 900 })
    d = moveCol(d, 0, 3)
    d = resetDock(d)
    expect(ids(d)).toEqual(['center', 'web+note+ai'])
    expect(d.floats).toHaveLength(0)
    expect(isShown(d, 'ai')).toBe(true)
    expect(sideCols(d)[0]!.w).toBe(COL_DEFAULT)
  })

  it('收起整个右边（⌥⌘\\）再开回来；收着时开一样先开回来', () => {
    let d = openView(openView(emptyDock(), 'web'), 'ai')
    d = floatView(d, 'ai', { x: 300, y: 200 }, { w: 1440, h: 900 })
    d = hideAll(d)
    expect(ids(d)).toEqual(['center'])
    expect(d.floats).toHaveLength(0)
    expect(isOpen(d, 'web')).toBe(false)
    d = hideAll(d)
    expect(ids(d)).toEqual(['center', 'web'])
    expect(d.floats).toHaveLength(1)
    d = openView(hideAll(d), 'history')
    expect(ids(d)).toEqual(['center', 'web+history'])
    expect(d.floats).toHaveLength(1)
  })

  it('笔记只在读 PDF 时画：用不上时藏起来（它独占的那栏一起藏），布局里照旧记着', () => {
    let d = openView(openView(emptyDock(), 'note'), 'ai')
    d = dropView(d, 'note', { kind: 'center', side: 'left' })
    const shown = shownDock(d, (v) => v !== 'note')
    expect(ids(shown)).toEqual(['center', 'ai'])
    expect(ids(d)).toEqual(['note', 'center', 'ai'])
    // 和别的标签叠着时：去掉这个标签，前面换成别的
    let e = openView(openView(emptyDock(), 'ai'), 'note')
    expect(isShown(e, 'note')).toBe(true)
    e = shownDock(e, (v) => v !== 'note')
    expect(ids(e)).toEqual(['center', 'ai'])
    expect(isShown(e, 'ai')).toBe(true)
  })

  it('窗口窄：先收最外面那栏到 300，再一栏一栏收；还不够接着收到 0', () => {
    let d = openView(emptyDock(), 'ai')
    d = dropView(openView(d, 'web'), 'web', { kind: 'group', group: findView(d, 'ai')!.group.id, zone: 'right' })
    d = setColWidth(d, sideCols(d)[0]!.id, 500)
    d = setColWidth(d, sideCols(d)[1]!.id, 500)
    const [a, b] = sideCols(d)
    expect(fitCols(d, 1000)).toEqual({ [a!.id]: 500, [b!.id]: 500 })
    expect(fitCols(d, 900)).toEqual({ [a!.id]: 500, [b!.id]: 400 })
    expect(fitCols(d, 700)).toEqual({ [a!.id]: 400, [b!.id]: 300 })
    expect(fitCols(d, 500)).toEqual({ [a!.id]: 300, [b!.id]: 200 })
    expect(fitCols(d, 200)).toEqual({ [a!.id]: 200, [b!.id]: 0 })
  })

  it('读回来：坏的、旧版本的、看不懂的视图名都不要；以前的 cn.aiOpen、cn.rightW 换成布局', () => {
    expect(loadDock(null, { aiOpen: '1', rightW: '420' }).cols.map((c) => c.id === 'center' || (c as SideCol).w)).toEqual([true, 420])
    expect(isShown(loadDock(null, { aiOpen: '1' }), 'ai')).toBe(true)
    expect(isShown(loadDock(null, { aiOpen: 'notes' }), 'note')).toBe(true)
    expect(ids(loadDock(null, { aiOpen: '0' }))).toEqual(['center'])
    expect(ids(loadDock('{坏的', {}))).toEqual(['center'])
    expect(ids(loadDock(JSON.stringify({ v: 9, cols: [] }), {}))).toEqual(['center'])
    const ok = openView(openView(emptyDock(), 'web'), 'ai')
    expect(loadDock(JSON.stringify(ok), {})).toEqual(ok)
    const bad = JSON.parse(JSON.stringify(ok))
    bad.cols[1].groups[0].views.push('游戏', 'ai')
    expect(ids(loadDock(JSON.stringify(bad), {}))).toEqual(['center', 'web+ai'])
    // 没有中间那栏的：补上
    const noCenter = { v: 1, cols: [{ id: 'c1', w: 380, groups: [{ id: 'g1', views: ['ai'], active: 'ai', f: 1 }] }], floats: [] }
    expect(ids(loadDock(JSON.stringify(noCenter), {}))).toEqual(['center', 'ai'])
  })

  it('一个标签只在一个地方：开、拖、浮起来都不会出现两份', () => {
    let d = openView(openView(openView(emptyDock(), 'web'), 'note'), 'ai')
    d = floatView(d, 'note', { x: 1, y: 1 }, { w: 1440, h: 900 })
    d = openView(d, 'note')
    d = dropView(d, 'web', { kind: 'center', side: 'left' })
    d = dropView(d, 'web', { kind: 'group', group: findView(d, 'ai')!.group.id, zone: 'top' })
    const all = [...sideCols(d).flatMap((c) => c.groups.flatMap((g) => g.views)), ...d.floats.flatMap((f) => f.views)]
    expect(all.sort()).toEqual(['ai', 'note', 'web'])
    const e = openView(openView(emptyDock(), 'web'), 'ai')
    expect(isShown(activateView(e, 'web'), 'web')).toBe(true)
    expect(activateView(e, 'ai')).toBe(e)
  })

  it('并排两栏之间的缝（task-rbtrz）：两栏合起来的宽不变，一宽一窄，每栏最窄 300、不设上限；合起来不够 600 时不动；存下来读回来还在', () => {
    let d = openView(openView(emptyDock(), 'web'), 'ai')
    d = dropView(d, 'ai', { kind: 'group', group: sideCols(d)[0]!.groups[0]!.id, zone: 'right' })
    expect(ids(d)).toEqual(['center', 'web', 'ai'])
    const [web, ai] = sideCols(d).map((c) => c.id) as [string, string]
    const total = 380 + 320
    const w = (x: Dock) => sideCols(x).map((c) => c.w)
    expect(w(setPairWidths(d, web, ai, 280, total))).toEqual([300, 400])
    expect(w(setPairWidths(d, web, ai, 650, total))).toEqual([400, 300])
    expect(w(setPairWidths(d, web, ai, 350, total))).toEqual([350, 350])
    // 网页那栏不设上限
    expect(w(setPairWidths(d, web, ai, 1400, 1800))).toEqual([1400, 400])
    // 合起来不够两个 300：不动
    expect(setPairWidths(d, web, ai, 300, 590)).toBe(d)
    // 没变：还是原来那个
    expect(setPairWidths(d, web, ai, 380, total)).toBe(d)
    expect(w(loadDock(JSON.stringify(setPairWidths(d, web, ai, 360, total)), {}))).toEqual([360, 340])
  })
})
