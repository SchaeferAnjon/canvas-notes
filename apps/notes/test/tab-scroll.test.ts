import { describe, expect, it } from 'vitest'
import { revealLeft, snapLeft, TAB_FADE, tabEdges, tabStops, tabTail } from '../src/renderer/shell/tab-scroll'

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

// 8 个 150 宽、间隔 0 的标签 = 1200，可见 600
const tabs = Array.from({ length: 8 }, (_, i) => ({ left: i * 150, width: 150 }))

describe('停在标签边上（方向 A）', () => {
  it('停靠点：左端停在某个标签开头、离左沿 24；第一个停在 0', () => {
    expect(tabStops(tabs)).toEqual([0, 150 - TAB_FADE, 300 - TAB_FADE, 450 - TAB_FADE, 600 - TAB_FADE, 750 - TAB_FADE, 900 - TAB_FADE, 1050 - TAB_FADE])
  })
  it('滚到最右左端也要停在标签开头：差的那段空补在后面', () => {
    // 能滚的最远是 600，下一个停靠点 726：补 126
    expect(tabTail(tabs, 600)).toBe(126)
    // 正好停得齐：不补
    expect(tabTail(tabs, 624)).toBe(0)
    // 放得下：不补
    expect(tabTail(tabs, 1200)).toBe(0)
  })
})

describe('当前标签滚进来', () => {
  it('整个露着、停在停靠点上就不动', () => {
    expect(revealLeft(0, 600, tabs, 1)).toBe(0)
    expect(revealLeft(126, 600, tabs, 3)).toBe(126)
  })
  it('右边那一半被挤出去：往右滚到最近的停靠点，左端停在标签开头，右边让出渐隐', () => {
    // 第 4 个（450–600）要整个露出、右边让 24：至少滚 24，最近的停靠点 126（第 2 个开头离左沿 24）
    expect(revealLeft(0, 600, tabs, 3)).toBe(126)
  })
  it('最后一个标签：右边贴着尽头，左端照样停在标签开头（靠后面补的空）', () => {
    expect(revealLeft(0, 600, tabs, 7)).toBe(726)
  })
  it('在左边藏着就往左滚，留出渐隐', () => {
    expect(revealLeft(726, 600, tabs, 2)).toBe(300 - TAB_FADE)
  })
  it('第一个标签滚到 0', () => {
    expect(revealLeft(600, 600, tabs, 0)).toBe(0)
  })
  it('不在停靠点上（关了一个标签，左端露出半个）：挪到最近的停靠点', () => {
    expect(revealLeft(140, 600, tabs, 3)).toBe(126)
  })
  it('可见区比标签还窄时保住标签开头', () => {
    expect(revealLeft(0, 100, tabs, 3)).toBe(450 - TAB_FADE)
  })
  it('标签放得下、加上渐隐放不下（标签条被动作区挤得很窄）：标签整个露着，少让一点渐隐', () => {
    // 9 个 96 宽、间隔 2，最后一个 163 宽，可见 185：右边贴齐尽头
    const narrow = [...Array.from({ length: 9 }, (_, i) => ({ left: i * 98, width: 96 })), { left: 882, width: 163 }]
    expect(revealLeft(0, 185, narrow, 9)).toBe(882 + 163 - 185)
  })
})

describe('滚一下挪一整个标签，停在标签边上（方向 A）', () => {
  it('往右：右边第一个没露全的整个滚进来，左端停在标签开头', () => {
    // 第 4 个（450–600）没露全：停在 126（第 2 个开头离左沿 24），第 4 个右边还让出 24 的渐隐
    expect(snapLeft(0, 600, tabs, 1)).toBe(150 - TAB_FADE)
    // 再往右一个
    expect(snapLeft(126, 600, tabs, 1)).toBe(300 - TAB_FADE)
  })
  it('最后一个滚进来：左端照样停在标签开头；到头了不再动', () => {
    expect(snapLeft(576, 600, tabs, 1)).toBe(750 - TAB_FADE)
    expect(snapLeft(726, 600, tabs, 1)).toBe(726)
  })
  it('只被渐隐压住几像素的不算藏着，一下至少挪一整个标签', () => {
    // 14 个 96 宽、间隔 2 的标签，可见 727：滚在 564 时「冰岛行程」只被压住 5px，往右一下直接到最后一个
    const narrow = Array.from({ length: 14 }, (_, i) => ({ left: i * 98, width: 96 }))
    expect(snapLeft(564, 727, narrow, 1)).toBe(7 * 98 - TAB_FADE)
  })
  it('往左：左边被箭头和渐隐盖住的那个整个滚进来（留出渐隐），再往左一次一个；第一个回到 0', () => {
    expect(snapLeft(726, 600, tabs, -1)).toBe(600 - TAB_FADE)
    expect(snapLeft(576, 600, tabs, -1)).toBe(450 - TAB_FADE)
    expect(snapLeft(126, 600, tabs, -1)).toBe(0)
  })
})
