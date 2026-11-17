import { describe, expect, it } from 'vitest'
import { fitPanels } from '../src/renderer/shell/SideSash'

// 窗口变窄时左右栏让位：中间至少 420，先收右栏到 300，再收左栏到 200，还不够右栏接着让
describe('fitPanels', () => {
  it('够宽时照记住的宽', () => {
    expect(fitPanels(1440, 96, 252, 600)).toEqual({ side: 252, right: 600 })
  })
  it('先收右栏', () => {
    // 1100 - 96 - 252 - 420 = 332
    expect(fitPanels(1100, 96, 252, 700)).toEqual({ side: 252, right: 332 })
  })
  it('右栏到 300 后收左栏，再不够右栏接着让', () => {
    // 1000 - 96 - 420 = 484 = 左 200 + 右 284
    expect(fitPanels(1000, 96, 252, 700)).toEqual({ side: 200, right: 284 })
    expect(fitPanels(960, 96, 252, 700)).toEqual({ side: 200, right: 244 })
  })
  it('右栏关着只收左栏', () => {
    expect(fitPanels(700, 96, 300, 0)).toEqual({ side: 200, right: 0 })
  })
})
