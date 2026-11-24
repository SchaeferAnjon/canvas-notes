// 一页 PDF 的第一行大字（记进配对笔记时一页一节的二级标题）
import { describe, expect, it } from 'vitest'
import { pageTitle } from '../src/shared/pdf-page-title'

const it_ = (str: string, y: number, h: number, x = 40) => ({ str, x, y, w: str.length * h * 0.5, h })

describe('一页的第一行大字', () => {
  it('字号最大的那一行；一样大取最上面那行', () => {
    const items = [it_('LIF Neuron', 60, 28), it_('The membrane leaks toward rest', 120, 11), it_('while input current charges it.', 136, 11), it_('Figure 5.3', 300, 11)]
    expect(pageTitle({ width: 600, height: 800, items })).toBe('LIF Neuron')
    expect(pageTitle({ width: 600, height: 800, items: [...items, it_('Second big', 200, 28)] })).toBe('LIF Neuron')
  })
  it('全是正文（最大的比正文大不出两成）、空页、页码：没有', () => {
    expect(pageTitle({ width: 600, height: 800, items: [it_('正文一行', 100, 11), it_('正文二行', 120, 12)] })).toBe('')
    expect(pageTitle({ width: 600, height: 800, items: [] })).toBe('')
    expect(pageTitle(null)).toBe('')
    expect(pageTitle({ width: 600, height: 800, items: [it_('12', 20, 30), it_('正文一行', 100, 11), it_('正文二行', 120, 11)] })).toBe('')
  })
  it('太长截到 40 个字', () => {
    const long = '很长的标题'.repeat(12)
    expect([...pageTitle({ width: 600, height: 800, items: [it_(long, 40, 30), it_('正文', 100, 11), it_('正文二', 120, 11)] })]).toHaveLength(40)
  })
})
