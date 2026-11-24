import { describe, expect, it } from 'vitest'
import { afterClose, clampRatio, moveTab, paneIds, paneOf, parseSplit, settle, splitCopy, splitOut, type Split } from '../src/shared/center-split'

const ids = ['a', 'b', 'c', 'd']

describe('拖到边上分出一格', () => {
  it('拖到右边：它自己成第二格、成了当前标签，另一格前面还是原来的', () => {
    const r = splitOut(ids, 'a', 'c', 'right')!
    expect(r.active).toBe('c')
    expect(r.split).toEqual({ dir: 'row', ratio: 0.5, second: ['c'], other: 'a' })
    expect(paneIds(ids, r.split, 0)).toEqual(['a', 'b', 'd'])
  })
  it('拖到左边、上面：别的都去第二格，它留在第一格', () => {
    const r = splitOut(ids, 'a', 'b', 'top')!
    expect(r.split.dir).toBe('col')
    expect(r.split.second).toEqual(['a', 'c', 'd'])
    expect(paneOf(r.split, 'b')).toBe(0)
  })
  it('拖的就是前面那个：另一格前面换成挨着它的', () => {
    expect(splitOut(ids, 'b', 'b', 'right')!.split.other).toBe('c')
    expect(splitOut(ids, 'd', 'd', 'left')!.split.other).toBe('c')
  })
  it('只有一个标签：分不出来', () => {
    expect(splitOut(['a'], 'a', 'a', 'right')).toBeNull()
  })
  it('快捷键：复制一份到右边，焦点到复制的那格', () => {
    expect(splitCopy('a', 'a2', 'row')).toEqual({ split: { dir: 'row', ratio: 0.5, second: ['a2'], other: 'a' }, active: 'a2' })
  })
})

describe('对上：开、关、换格', () => {
  const s: Split = { dir: 'row', ratio: 0.5, second: ['c', 'd'], other: 'a' }
  const prev = { ids, active: 'c', focus: 1 as const }
  it('没变：还是原来那个对象', () => {
    expect(settle(s, ids, 'c', prev)).toBe(s)
  })
  it('当前格是第二格时新开的标签落在第二格', () => {
    const next = settle(s, [...ids, 'e'], 'e', prev)!
    expect(next.second).toEqual(['c', 'd', 'e'])
    expect(next.other).toBe('a')
  })
  it('当前格是第一格时新开的标签落在第一格', () => {
    const next = settle(s, [...ids, 'e'], 'e', { ids, active: 'a', focus: 0 })!
    expect(next.second).toEqual(['c', 'd'])
  })
  it('点另一格的标签：换当前格，刚才的当前标签成了那一格前面的', () => {
    const next = settle(s, ids, 'b', prev)!
    expect(paneOf(next, 'b')).toBe(0)
    expect(next.other).toBe('c')
  })
  it('一格的标签都关了：合回一格', () => {
    expect(settle(s, ['a', 'b'], 'a', prev)).toBeNull()
    expect(settle(s, ['c', 'd'], 'c', prev)).toBeNull()
  })
  it('另一格前面那个关了：换成挨着的', () => {
    const next = settle(s, ['b', 'c', 'd'], 'c', prev)!
    expect(next.other).toBe('b')
  })
  it('关掉当前格前面那个：同一格里挨着的接上，不跳到另一格', () => {
    expect(afterClose(ids, s, 'c', 'c')).toBe('d')
    expect(afterClose(ids, s, 'd', 'd')).toBe('c')
    // 这一格只剩它：接上另一格前面那个（这一格空了合回）
    const one: Split = { ...s, second: ['d'] }
    expect(afterClose(ids, one, 'd', 'd')).toBe('a')
    // 没分屏：照原来，挨着的
    expect(afterClose(ids, null, 'b', 'b')).toBe('c')
    expect(afterClose(ids, null, 'd', 'd')).toBe('c')
    expect(afterClose(ids, s, 'a', 'c')).toBe('a')
  })
})

describe('拖到标签条、另一格', () => {
  const s: Split = { dir: 'row', ratio: 0.5, second: ['c', 'd'], other: 'a' }
  it('拖到另一格的标签条某个标签前面', () => {
    const r = moveTab(ids, s, 'a', 1, 'd')
    expect(r.ids).toEqual(['b', 'c', 'a', 'd'])
    expect(r.split!.second).toEqual(['c', 'd', 'a'])
    expect(paneIds(r.ids, r.split, 1)).toEqual(['c', 'a', 'd'])
  })
  it('拖到另一格的内容上：排在那一格最后', () => {
    const r = moveTab(ids, s, 'b', 1, null)
    expect(paneIds(r.ids, r.split, 1)).toEqual(['c', 'd', 'b'])
  })
  it('同一格里拖着换顺序', () => {
    const r = moveTab(ids, null, 'd', 0, 'a')
    expect(r.ids).toEqual(['d', 'a', 'b', 'c'])
    expect(r.split).toBeNull()
  })
  it('拖走一格的最后一个：那一格空了，对上以后合回', () => {
    const one: Split = { ...s, second: ['d'] }
    const r = moveTab(ids, one, 'd', 0, null)
    expect(settle(r.split, r.ids, 'd', { ids, active: 'd', focus: 1 })).toBeNull()
  })
})

describe('存着的', () => {
  it('读回来；坏的当没分屏；比例夹在 0.2 到 0.8', () => {
    expect(parseSplit(JSON.stringify({ dir: 'col', ratio: 0.95, second: ['x'], other: 'y' }))).toEqual({ dir: 'col', ratio: 0.8, second: ['x'], other: 'y' })
    expect(parseSplit('{')).toBeNull()
    expect(parseSplit(JSON.stringify({ dir: 'row', ratio: 0.5, second: [], other: 'y' }))).toBeNull()
    expect(parseSplit(null)).toBeNull()
    expect(clampRatio(Number.NaN)).toBe(0.5)
  })
})
