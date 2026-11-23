// 格子焦点（task-cle3x）：选中一格时每个键翻成什么，数据库表格和普通表格共用
import { describe, expect, it } from 'vitest'
import { editKey, gridKey, type GridPos, gridText, type KeyLike, parseGridText, tabFrom } from '../src/renderer/grid-focus'

const k = (key: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, ...mods })
const size = { rows: 3, cols: 4 }
const mid: GridPos = { row: 1, col: 1 }

describe('gridKey', () => {
  it('方向键一格一格走，碰到左右边停住', () => {
    expect(gridKey(k('ArrowRight'), mid, size)).toEqual({ kind: 'move', to: { row: 1, col: 2 } })
    expect(gridKey(k('ArrowLeft'), { row: 1, col: 0 }, size)).toEqual({ kind: 'move', to: { row: 1, col: 0 } })
    expect(gridKey(k('ArrowDown'), mid, size)).toEqual({ kind: 'move', to: { row: 2, col: 1 } })
  })
  it('第一行 ↑、最后一行 ↓ 出表', () => {
    expect(gridKey(k('ArrowUp'), { row: 0, col: 2 }, size)).toEqual({ kind: 'leave', dir: 'up' })
    expect(gridKey(k('ArrowDown'), { row: 2, col: 2 }, size)).toEqual({ kind: 'leave', dir: 'down' })
  })
  it('⌘ 加方向键到头', () => {
    expect(gridKey(k('ArrowRight', { metaKey: true }), mid, size)).toEqual({ kind: 'move', to: { row: 1, col: 3 } })
    expect(gridKey(k('ArrowUp', { metaKey: true }), mid, size)).toEqual({ kind: 'move', to: { row: 0, col: 1 } })
  })
  it('Tab 横走、行尾接下一行，⇧Tab 反过来', () => {
    expect(gridKey(k('Tab'), { row: 0, col: 3 }, size)).toEqual({ kind: 'move', to: { row: 1, col: 0 } })
    expect(gridKey(k('Tab', { shiftKey: true }), { row: 1, col: 0 }, size)).toEqual({ kind: 'move', to: { row: 0, col: 3 } })
    expect(tabFrom({ row: 2, col: 3 }, size, 1)).toEqual({ row: 2, col: 3 })
    expect(tabFrom({ row: 0, col: 0 }, size, -1)).toEqual({ row: 0, col: 0 })
  })
  it('回车、打字进编辑；Esc；退格清空', () => {
    expect(gridKey(k('Enter'), mid, size)).toEqual({ kind: 'edit', typed: false })
    expect(gridKey(k('a'), mid, size)).toEqual({ kind: 'edit', typed: true })
    expect(gridKey(k('中'), mid, size)).toEqual({ kind: 'edit', typed: true })
    expect(gridKey({ ...k('Process'), keyCode: 229 }, mid, size)).toEqual({ kind: 'edit', typed: true })
    expect(gridKey(k('Escape'), mid, size)).toEqual({ kind: 'escape' })
    expect(gridKey(k('Backspace'), mid, size)).toEqual({ kind: 'clear' })
  })
  it('⌘ 组合键、输入法选字中不归表格', () => {
    expect(gridKey(k('c', { metaKey: true }), mid, size)).toBeNull()
    expect(gridKey(k('s', { metaKey: true }), mid, size)).toBeNull()
    expect(gridKey({ ...k('ArrowDown'), isComposing: true }, mid, size)).toBeNull()
    expect(gridKey(k('Shift', { shiftKey: true }), mid, size)).toBeNull()
  })
})

describe('editKey', () => {
  it('回车存、Esc 不存、Tab 存了走', () => {
    expect(editKey(k('Enter'))).toBe('commit')
    expect(editKey(k('Escape'))).toBe('cancel')
    expect(editKey(k('Tab'))).toBe('next')
    expect(editKey(k('Tab', { shiftKey: true }))).toBe('prev')
    expect(editKey(k('a'))).toBeNull()
    expect(editKey({ ...k('Enter'), keyCode: 229 })).toBeNull()
  })
})

describe('复制粘贴的字', () => {
  it('一格、一列、一块', () => {
    expect(parseGridText('2011')).toEqual([['2011']])
    expect(parseGridText('a\nb\n')).toEqual([['a'], ['b']])
    expect(parseGridText('a\tb\r\nc\td\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
    expect(gridText([['x\ty', 'z']])).toBe('x y\tz')
  })
})
