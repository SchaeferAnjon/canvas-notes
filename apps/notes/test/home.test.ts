import { describe, expect, it } from 'vitest'
import { DEFAULT_HOME, greeting, hideWidget, homeJson, isCoverPath, moveWidget, normalizeHome, resizeWidget, showWidget, sizeOf } from '../src/shared/home'

describe('首页设置', () => {
  it('没有文件、坏文件都回到默认：六个组件在首页，两个收着', () => {
    expect(normalizeHome(undefined)).toEqual(DEFAULT_HOME)
    expect(normalizeHome('{坏的')).toEqual(DEFAULT_HOME)
    expect(normalizeHome({ order: 'x', cover: { kind: 'file', path: '/etc/passwd' }, coverY: 'abc' })).toEqual(DEFAULT_HOME)
  })

  it('不认识的组件丢掉、重复的去掉，文件里没写到的新组件收着；「分类」是用户点名要的（方向 C），老文件里没有就放到最前面', () => {
    const c = normalizeHome({ order: ['wall', 'clock', 'clock', 'weather'], hidden: ['inbox'] })
    expect(c.order).toEqual(['cats', 'wall', 'clock'])
    expect(normalizeHome({ order: ['wall'], hidden: ['cats'] }).order).toEqual(['wall'])
    expect(c.hidden).toEqual(['inbox', 'week', 'boards', 'dream', 'recent', 'flip'])
  })

  it('封面文件只认库里 附件/ 下的图片', () => {
    expect(isCoverPath('附件/封面/海.jpg')).toBe(true)
    expect(isCoverPath('附件/../.git/config.png')).toBe(false)
    expect(isCoverPath('附件/封面/说明.md')).toBe(false)
    expect(normalizeHome({ cover: { kind: 'file', path: '附件/封面/海.jpg' } }).cover).toEqual({ kind: 'file', path: '附件/封面/海.jpg' })
    expect(normalizeHome({ cover: { kind: 'builtin', id: 'plum' } }).cover).toEqual({ kind: 'builtin', id: 'plum' })
  })

  it('封面位置限制在 0–100', () => {
    expect(normalizeHome({ coverY: 140 }).coverY).toBe(100)
    expect(normalizeHome({ coverY: -3 }).coverY).toBe(0)
    expect(normalizeHome({ coverY: 33.6 }).coverY).toBe(34)
  })

  it('挪组件：插到另一个前面，或者挪到最后', () => {
    expect(moveWidget(DEFAULT_HOME, 'wall', 'clock').order).toEqual(['cats', 'wall', 'clock', 'week', 'inbox', 'boards', 'dream'])
    expect(moveWidget(DEFAULT_HOME, 'clock', null).order).toEqual(['cats', 'week', 'inbox', 'boards', 'dream', 'wall', 'clock'])
    expect(moveWidget(DEFAULT_HOME, 'recent', 'clock')).toBe(DEFAULT_HOME)
  })

  it('收起和放回：放回的排到最后', () => {
    const a = hideWidget(DEFAULT_HOME, 'inbox')
    expect(a.order).not.toContain('inbox')
    expect(a.hidden).toEqual(['recent', 'flip', 'inbox'])
    expect(showWidget(a, 'recent').order.at(-1)).toBe('recent')
  })

  it('换大小：窄 → 宽 → 整行 → 窄，积累墙不变；默认宽度不写进文件', () => {
    let c = resizeWidget(DEFAULT_HOME, 'clock')
    expect(sizeOf(c, 'clock')).toBe(2)
    c = resizeWidget(c, 'clock')
    expect(sizeOf(c, 'clock')).toBe(4)
    c = resizeWidget(c, 'clock')
    expect(sizeOf(c, 'clock')).toBe(1)
    expect(c.sizes).toEqual({})
    expect(resizeWidget(DEFAULT_HOME, 'wall')).toBe(DEFAULT_HOME)
  })

  it('写进文件的样子稳定：读回来再写一字不差', () => {
    const text = homeJson(moveWidget(DEFAULT_HOME, 'dream', 'clock'))
    expect(text.endsWith('}\n')).toBe(true)
    expect(homeJson(normalizeHome(JSON.parse(text)))).toBe(text)
  })

  it('问候语按钟点', () => {
    const at = (h: number) => greeting(new Date(2026, 10, 15, h, 0))
    expect([at(3), at(8), at(12), at(15), at(20), at(23)]).toEqual(['夜深了', '早上好', '中午好', '下午好', '晚上好', '夜深了'])
  })
})
