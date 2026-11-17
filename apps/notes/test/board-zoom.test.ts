import { describe, expect, it } from 'vitest'
import { clampZoom, fitZoom, stepZoom, wheelZoom } from '../src/renderer/board-zoom'

describe('白板缩放', () => {
  it('⌘+ / ⌘− 按档位走，两头停住', () => {
    expect(stepZoom(1, 1)).toBe(1.1)
    expect(stepZoom(stepZoom(1, 1), 1)).toBe(1.25)
    expect(stepZoom(1, -1)).toBe(0.9)
    expect(stepZoom(1.17, 1)).toBe(1.25)
    expect(stepZoom(1.17, -1)).toBe(1.1)
    expect(stepZoom(2, 1)).toBe(2)
    expect(stepZoom(0.25, -1)).toBe(0.25)
  })
  it('捏合连续变，夹在 25% 到 200%', () => {
    expect(wheelZoom(1, -10)).toBeGreaterThan(1)
    expect(wheelZoom(1, 10)).toBeLessThan(1)
    expect(wheelZoom(1.9, -500)).toBe(2)
    // 实体鼠标滚一格（deltaY 100）：变 10% 左右，不是一下到 37%
    expect(wheelZoom(1, 100)).toBeCloseTo(0.905, 2)
    expect(wheelZoom(1, -100)).toBeCloseTo(1.105, 2)
    expect(clampZoom(0.01)).toBe(0.25)
  })
  it('适合窗口：整块内容放得下；右栏开着时按让位系数折回用户比例', () => {
    expect(fitZoom({ x: 0, y: 0, w: 1920, h: 520 }, { w: 1000, h: 800 }, 1)).toBe(0.5)
    expect(fitZoom({ x: 0, y: 0, w: 1920, h: 520 }, { w: 1000, h: 800 }, 0.8)).toBe(0.625)
    expect(fitZoom({ x: 0, y: 0, w: 100, h: 100 }, { w: 1000, h: 800 }, 1)).toBe(2)
    expect(fitZoom(null, { w: 1000, h: 800 }, 1)).toBe(1)
  })
})
