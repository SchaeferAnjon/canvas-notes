import { describe, expect, it } from 'vitest'
import { quickMarkdown } from '../src/shared/quick'

describe('速记的 md', () => {
  it('只有自己打的字', () => {
    expect(quickMarkdown('  明天订车  ', {})).toBe('明天订车')
  })
  it('浏览器里选中的一段：引文加来源标题和网址', () => {
    expect(quickMarkdown('这段好', { selection: '冰洞只在冬天开放。', url: 'https://safetravel.is/ice', title: 'Ice caves', app: 'Safari' })).toBe(
      '这段好\n\n> 冰洞只在冬天开放。\n—— [Ice caves](https://safetravel.is/ice)',
    )
  })
  it('别的软件里选中的：引文加「来自 软件名」，没打字也行', () => {
    expect(quickMarkdown('', { selection: '第一行\n\n第二行', app: '备忘录' })).toBe('> 第一行\n> 第二行\n—— 来自 备忘录')
  })
})
