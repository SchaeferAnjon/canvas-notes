import { describe, expect, it } from 'vitest'
import { mdLinkAt, prettyUrl } from '../src/renderer/md-link'

/** 一篇只有这一行的「文档」 */
const doc = (text: string) => ({ lineAt: () => ({ from: 10, text }) })

describe('链接卡要的那一段 [字](网址)', () => {
  const line = '看 [Arctic Circle](https://en.wikipedia.org/wiki/Arctic_Circle "t") 和 ![图](附件/a.png) 还有 [讲义](课程/ecp/讲义.md)'
  it('字和网址各在哪：改链接只换网址，去掉链接换整段', () => {
    const l = mdLinkAt(doc(line), 10 + line.indexOf('Arctic'))!
    expect(l).toMatchObject({ text: 'Arctic Circle', url: 'https://en.wikipedia.org/wiki/Arctic_Circle' })
    expect(line.slice(l.from - 10, l.to - 10)).toBe('[Arctic Circle](https://en.wikipedia.org/wiki/Arctic_Circle "t")')
    expect(line.slice(l.urlFrom - 10, l.urlTo - 10)).toBe('https://en.wikipedia.org/wiki/Arctic_Circle')
  })
  it('图不算链接；不在链接上给 null', () => {
    expect(mdLinkAt(doc(line), 10 + line.indexOf('图'))).toBeNull()
    expect(mdLinkAt(doc(line), 10)).toBeNull()
    expect(mdLinkAt(doc(line), 10 + line.indexOf('讲义]'))).toMatchObject({ url: '课程/ecp/讲义.md' })
  })
  it('卡上那一行网址：不写 https:// 和 www.，中文解码；微信读书的书写「微信读书」', () => {
    expect(prettyUrl('https://en.wikipedia.org/wiki/Arctic_Circle')).toBe('en.wikipedia.org/wiki/Arctic_Circle')
    expect(prettyUrl('https://www.example.com/')).toBe('example.com')
    expect(prettyUrl('https://zh.wikipedia.org/wiki/%E9%9B%B7%E5%85%8B%E9%9B%85%E6%9C%AA%E5%85%8B')).toBe('zh.wikipedia.org/wiki/雷克雅未克')
    expect(prettyUrl('weread://book/123')).toBe('微信读书')
  })
})
