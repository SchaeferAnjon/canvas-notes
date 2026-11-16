import { describe, expect, it } from 'vitest'
import { toneOf } from '../src/shared/favicon'
import { ago } from '../src/shared/plugins/bookmarks'

describe('书签管家的小工具', () => {
  it('几天前', () => {
    const now = Date.UTC(2026, 10, 15, 12)
    expect(ago(0, now)).toBe('')
    expect(ago(now - 3600_000, now)).toBe('今天')
    expect(ago(now - 86400_000, now)).toBe('昨天')
    expect(ago(now - 5 * 86400_000, now)).toBe('5 天前')
  })
})

describe('网站小图标多深', () => {
  const px = (b: number, g: number, r: number, a: number, n: number) => Uint8Array.from(Array.from({ length: n }, () => [b, g, r, a]).flat())
  it('很黑的是 dark（深色主题垫白底），很白的是 light，几乎透明的是 empty，透明的像素不算', () => {
    expect(toneOf(px(20, 20, 20, 255, 256))).toBe('dark')
    expect(toneOf(px(250, 250, 250, 255, 256))).toBe('light')
    expect(toneOf(px(40, 120, 230, 255, 256))).toBe('mid')
    expect(toneOf(px(0, 0, 0, 0, 256))).toBe('empty')
    expect(toneOf(Uint8Array.from([...px(0, 0, 0, 0, 200), ...px(10, 10, 10, 255, 56)]))).toBe('dark')
    expect(toneOf(Uint8Array.from([...px(0, 0, 0, 0, 250), ...px(10, 10, 10, 255, 6)]))).toBe('empty')
  })
})
