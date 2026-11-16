import { describe, expect, it } from 'vitest'
import { linkAt } from '../src/renderer/ctx/editor-menu'

describe('右键点着的链接', () => {
  const line = '看 [[另一篇|别名]] 和 [官网](https://example.com/x "t") 还有 ![图](附件/a.png) <https://a.cn/b> 以及 https://b.cn/c。'
  const at = (s: string) => line.indexOf(s) + 1
  it('双链：取名字，不带别名', () => expect(linkAt(line, at('另一篇'))).toEqual({ kind: 'wiki', target: '另一篇' }))
  it('[文字](网址)', () => expect(linkAt(line, at('官网'))).toEqual({ kind: 'url', url: 'https://example.com/x', text: '官网' }))
  it('图', () => expect(linkAt(line, at('图]'))).toEqual({ kind: 'image', url: '附件/a.png' }))
  it('<网址>', () => expect(linkAt(line, at('a.cn'))).toEqual({ kind: 'url', url: 'https://a.cn/b', text: 'https://a.cn/b' }))
  it('光秃秃的网址，句号不算', () => expect(linkAt(line, at('b.cn'))).toEqual({ kind: 'url', url: 'https://b.cn/c', text: 'https://b.cn/c' }))
  it('不在链接上', () => expect(linkAt(line, 0)).toBeNull())
})
