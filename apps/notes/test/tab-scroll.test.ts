import { describe, expect, it } from 'vitest'
import { revealLeft, TAB_FADE, tabEdges } from '../src/renderer/shell/tab-scroll'

describe('标签条渐隐', () => {
  it('放得下时两头都不画', () => {
    expect(tabEdges(0, 600, 600)).toEqual({ left: false, right: false })
  })
  it('在开头只画右边，在中间两边都画，滚到底只画左边', () => {
    expect(tabEdges(0, 1200, 600)).toEqual({ left: false, right: true })
    expect(tabEdges(300, 1200, 600)).toEqual({ left: true, right: true })
    expect(tabEdges(600, 1200, 600)).toEqual({ left: true, right: false })
  })
  it('差半个像素也算到头', () => {
    expect(tabEdges(599.5, 1200, 600)).toEqual({ left: true, right: false })
  })
})

describe('当前标签滚进来', () => {
  // 8 个 150 宽的标签 = 1200，可见 600
  it('整个露着就不动', () => {
    expect(revealLeft(0, 600, 1200, 150, 150)).toBe(0)
  })
  it('右边那一半被挤出去（页面说明挤窄了标签条）就往右滚，并让出渐隐', () => {
    expect(revealLeft(0, 600, 1200, 525, 150)).toBe(525 + 150 + TAB_FADE - 600)
  })
  it('最后一个标签滚到底，不多留渐隐', () => {
    expect(revealLeft(0, 600, 1200, 1050, 150)).toBe(600)
  })
  it('在左边藏着就往左滚，留出渐隐', () => {
    expect(revealLeft(600, 600, 1200, 300, 150)).toBe(300 - TAB_FADE)
  })
  it('第一个标签滚到 0', () => {
    expect(revealLeft(600, 600, 1200, 0, 150)).toBe(0)
  })
  it('可见区比标签还窄时保住标签开头', () => {
    expect(revealLeft(0, 100, 1200, 450, 150)).toBe(450 - TAB_FADE)
  })
})
