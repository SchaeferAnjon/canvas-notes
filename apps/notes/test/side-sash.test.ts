import { describe, expect, it } from 'vitest'
import { clampSideW } from '../src/renderer/shell/SideSash'

describe('左栏拖宽', () => {
  it('夹在 200 到 400 之间', () => {
    expect(clampSideW(120, 1600, 96, 0)).toBe(200)
    expect(clampSideW(333.4, 1600, 96, 0)).toBe(333)
    expect(clampSideW(700, 1600, 96, 0)).toBe(400)
  })
  it('窗口窄、右栏开着时中间至少留 420', () => {
    // 1100 宽：两条图标栏 96、右栏 340，左栏最多 1100 - 96 - 340 - 420 = 244
    expect(clampSideW(400, 1100, 96, 340)).toBe(244)
    // 再窄也不小于 200
    expect(clampSideW(400, 900, 96, 340)).toBe(200)
  })
})
