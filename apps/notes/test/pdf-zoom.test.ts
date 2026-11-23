import { beforeEach, describe, expect, it } from 'vitest'
import { clampScale, fitScale, loadZoom, saveZoom, stepScale, wheelScale } from '../src/renderer/reading/pdf-zoom'

describe('PDF 缩放（r82）', () => {
  it('⌘+ / ⌘− 照档位走，不在档位上先到最近那一档，两头停住', () => {
    expect(stepScale(1, 1)).toBe(1.1)
    expect(stepScale(1, -1)).toBe(0.9)
    expect(stepScale(1.13, 1)).toBe(1.25)
    expect(stepScale(1.13, -1)).toBe(1.1)
    expect(stepScale(5, 1)).toBe(5)
    expect(stepScale(0.25, -1)).toBe(0.25)
  })

  it('捏合：往上是放大，一下最多变 10% 左右，限在 25% 到 500%', () => {
    expect(wheelScale(1, -4)).toBeGreaterThan(1)
    expect(wheelScale(1, 4)).toBeLessThan(1)
    expect(wheelScale(1, -120)).toBeCloseTo(1.105, 3)
    expect(wheelScale(4.9, -100)).toBe(5)
    expect(wheelScale(0.26, 100)).toBe(0.25)
    expect(clampScale(0.1)).toBe(0.25)
  })

  it('适合宽度看最宽那页，适合整页让整页放得下', () => {
    expect(fitScale('width', { w: 600, h: 400 }, 600, { w: 600, h: 800 })).toBe(1)
    expect(fitScale('page', { w: 600, h: 400 }, 600, { w: 600, h: 800 })).toBe(0.5)
    expect(fitScale('page', { w: 300, h: 4000 }, 600, { w: 600, h: 800 })).toBe(0.5)
  })

  describe('每份记自己的', () => {
    let store: Map<string, string>
    beforeEach(() => {
      store = new Map()
      Object.assign(globalThis, {
        localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
      })
    })

    it('没记过照设置；记过的照记下的', () => {
      expect(loadZoom('a.pdf', 'width')).toEqual({ zoom: 'width' })
      expect(loadZoom('a.pdf', 'page')).toEqual({ zoom: 'page' })
      expect(loadZoom('a.pdf', 'actual')).toEqual({ zoom: 1 })
      saveZoom('a.pdf', 1.5)
      saveZoom('b.pdf', 'page')
      expect(loadZoom('a.pdf', 'width')).toEqual({ zoom: 1.5 })
      expect(loadZoom('b.pdf', 'width')).toEqual({ zoom: 'page' })
    })

    it('旧写法（适合宽度的几倍）：1 是适合宽度，别的交给量好栏宽后换算；存一次就换成新写法', () => {
      store.set('cn.pdfZoom:a.pdf', '1')
      store.set('cn.pdfZoom:b.pdf', '1.3225')
      expect(loadZoom('a.pdf', 'page')).toEqual({ zoom: 'width' })
      expect(loadZoom('b.pdf', 'page')).toEqual({ zoom: 'width', rel: 1.3225 })
      saveZoom('b.pdf', 1.4)
      expect(store.has('cn.pdfZoom:b.pdf')).toBe(false)
      expect(loadZoom('b.pdf', 'page')).toEqual({ zoom: 1.4 })
    })
  })
})
