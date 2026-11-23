// 图标栏放不下时收几格进「⋯」（task-2okp6）：直接按高度算，变矮变高、每一个高度都算得一样
import { describe, expect, it } from 'vitest'
import { barHeight, barLayout, fitFold } from '../src/renderer/shell/bar-fold'

const c = (id: string, fold = false) => ({ id, fold })
// 和左图标栏同一个样子：文件 待办 最近 书桌 | 收件箱 | 课程 阅读 剪藏 | 周记 写作 项目 生活 | 梦游
const GROUPS = [
  [c('文件'), c('待办'), c('最近'), c('书桌')],
  [c('收件箱', true)],
  [c('课程', true), c('阅读', true), c('剪藏', true)],
  [c('周记', true), c('写作', true), c('项目', true), c('生活', true)],
  [c('梦游')],
]
const B = { cell: 38, sep: 9 }

describe('barLayout', () => {
  it('「日历」格（task-kzr3n）能收，但排在分类前面：分类全收完了才收它，「⋯」跟到第一段', () => {
    const g = [[c('文件'), c('待办'), c('日历', true), c('最近'), c('书桌')], ...GROUPS.slice(1)]
    expect(barLayout(g, 8).hidden.map((x) => x.id)).not.toContain('日历')
    const l = barLayout(g, 9)
    expect(l.hidden.map((x) => x.id)[0]).toBe('日历')
    expect(l.moreGroup).toBe(0)
    expect(l.shown[0]![0].map((x) => x.id)).toEqual(['文件', '待办', '最近', '书桌'])
  })
  it('从最后一个分类往前收，「待办」「书桌」不收；「⋯」跟在最先收的那一格那一段', () => {
    const l = barLayout(GROUPS, 2)
    expect(l.hidden.map((x) => x.id)).toEqual(['项目', '生活'])
    expect(l.moreGroup).toBe(3)
    expect(l.shown.map(([g]) => g.map((x) => x.id))).toEqual([['文件', '待办', '最近', '书桌'], ['收件箱'], ['课程', '阅读', '剪藏'], ['周记', '写作'], ['梦游']])
  })
  it('一段收空了不画（连分隔线），放「⋯」的那一段留着', () => {
    const l = barLayout(GROUPS, 5)
    expect(l.shown.map(([, i]) => i)).toEqual([0, 1, 2, 4])
    const l2 = barLayout(GROUPS, 4)
    expect(l2.shown.map(([, i]) => i)).toEqual([0, 1, 2, 3, 4])
    expect(l2.shown[3]![0]).toEqual([])
  })
})

describe('fitFold', () => {
  it('放得下一格不收；少一像素收两格（收一格「⋯」又占一格，腾不出地方）', () => {
    const full = barHeight(GROUPS, 0, B)
    expect(full).toBe(13 * 38 + 4 * 9)
    expect(fitFold(GROUPS, full, B)).toBe(0)
    expect(fitFold(GROUPS, full - 1, B)).toBe(2)
  })
  it('每个高度收的都是放得下的最少格数，越矮收得越多，变高按同一个高度放回来', () => {
    let last = 0
    for (let h = 600; h >= 200; h--) {
      const f = fitFold(GROUPS, h, B)
      expect(f).toBeGreaterThanOrEqual(last)
      last = f
      if (f < 8) expect(barHeight(GROUPS, f, B)).toBeLessThanOrEqual(h)
      if (f > 0) expect(barHeight(GROUPS, f - 1, B)).toBeGreaterThan(h)
    }
    expect(last).toBe(8)
  })
  it('没有能收的格子（右图标栏）一直是 0', () => {
    expect(fitFold([[c('笔记'), c('大纲')]], 10, B)).toBe(0)
  })
})
