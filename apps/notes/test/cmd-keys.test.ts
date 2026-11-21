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

  it('能不能用：要带 ⌘ 或 ⌃（F 键除外）；系统和编辑器本身的键说出是谁；编辑时用的键（方向、回车、退格）不给', () => {
    expect(keyProblem('⌥⌘S')).toBeNull()
    expect(keyProblem('F5')).toBeNull()
    expect(keyProblem('S')).toBe('要带上 ⌘ 或 ⌃，不然打字时会按到')
    expect(keyProblem('⌥S')).toBe('要带上 ⌘ 或 ⌃，不然打字时会按到')
    // 软件自己的命令（关掉、搜索）都在命令表里能改，不再是保留的键：撞了说撞了谁（cmd-table 的 clashOf）
    expect(keyProblem('⌘W')).toBeNull()
    expect(keyProblem('⌘K')).toBeNull()
    expect(keyProblem('⌘Q')).toBe('⌘Q 是退出，换一个')
    expect(keyProblem('⌘C')).toBe('⌘C 是拷贝，换一个')
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
