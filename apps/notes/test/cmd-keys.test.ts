import { describe, expect, it } from 'vitest'
import { accelOf, comboOf, keyProblem } from '../src/shared/cmd-keys'

const ev = (code: string, key: string, mods: { meta?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean } = {}) => ({
  code,
  key,
  metaKey: !!mods.meta,
  ctrlKey: !!mods.ctrl,
  altKey: !!mods.alt,
  shiftKey: !!mods.shift,
})

describe('快捷键的写法', () => {
  it('按下去的键写成 ⌃⌥⇧⌘ + 键（认按键的位置：⌥ 按着时 key 是 ß 之类）', () => {
    expect(comboOf(ev('KeyS', 'ß', { meta: true, alt: true }))).toBe('⌥⌘S')
    expect(comboOf(ev('KeyC', 'C', { meta: true, shift: true }))).toBe('⇧⌘C')
    expect(comboOf(ev('Comma', ',', { meta: true }))).toBe('⌘,')
    expect(comboOf(ev('Digit1', '!', { meta: true, shift: true }))).toBe('⇧⌘1')
    expect(comboOf(ev('KeyK', 'k', { ctrl: true, meta: true }))).toBe('⌃⌘K')
    expect(comboOf(ev('F5', 'F5'))).toBe('F5')
    // Electron 主进程的 input 用 meta / control / alt / shift
    expect(comboOf({ code: 'KeyS', key: 'ß', meta: true, alt: true })).toBe('⌥⌘S')
    // 主进程 sendInputEvent 送来的没有按键位置：按字认
    expect(comboOf({ code: '', key: 's', meta: true, alt: true })).toBe('⌥⌘S')
    expect(comboOf({ code: '', key: ',', meta: true })).toBe('⌘,')
  })

  it('只按了修饰键、按的是 esc：不算', () => {
    expect(comboOf(ev('MetaLeft', 'Meta', { meta: true }))).toBeNull()
    expect(comboOf(ev('ShiftLeft', 'Shift', { shift: true }))).toBeNull()
    expect(comboOf(ev('Escape', 'Escape', { meta: true }))).toBeNull()
  })

  it('能不能用：要带 ⌘ 或 ⌃（F 键除外）；软件自己用的键说出是谁；编辑时用的键（方向、回车、退格）不给', () => {
    expect(keyProblem('⌥⌘S')).toBeNull()
    expect(keyProblem('F5')).toBeNull()
    expect(keyProblem('S')).toBe('要带上 ⌘ 或 ⌃，不然打字时会按到')
    expect(keyProblem('⌥S')).toBe('要带上 ⌘ 或 ⌃，不然打字时会按到')
    expect(keyProblem('⌘W')).toBe('⌘W 是关闭，换一个')
    expect(keyProblem('⌘C')).toBe('⌘C 是拷贝，换一个')
    expect(keyProblem('⌘K')).toBe('⌘K 是搜索，换一个')
    expect(keyProblem('⌥⌘H')).toBe('⌥⌘H 是隐藏其他，换一个')
    expect(keyProblem('⌘↑')).toBe('⌘↑ 编辑时要用，换一个')
  })

  it('菜单栏的写法（Electron accelerator）', () => {
    expect(accelOf('⇧⌘C')).toBe('Shift+Command+C')
    expect(accelOf('⌥⌘S')).toBe('Alt+Command+S')
    expect(accelOf('⌃⌘,')).toBe('Control+Command+,')
    expect(accelOf('F5')).toBe('F5')
  })
})
