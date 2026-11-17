import { decorativeImages, type PdfBlock } from '@cn/format'
import { describe, expect, it } from 'vitest'
import { summarizePrompt } from '../src/main/reading/prompts'

const PAGE = { w: 720, h: 540 }
const logo = (page: number): PdfBlock => ({ id: `p${page}-b1`, page, kind: 'image', text: '', x: 660, y: 20, w: 40, h: 40 })
const text = (page: number): PdfBlock => ({ id: `p${page}-b2`, page, kind: 'text', text: '九层结构：从物理层到应用层', x: 40, y: 100, w: 600, h: 300 })

describe('记笔记时挑配图（CN-60）', () => {
  const pages = [1, 2, 3, 4].map((p) => [logo(p), text(p)])

  it('每页右上角的 40×40 校徽：太小、又在每页同一位置，不当候选', () => {
    expect([...decorativeImages(pages[2]!, PAGE, pages)]).toEqual(['p3-b1'])
  })

  it('这一页真正的大图留着；只在一页出现的中等图也留着', () => {
    const fig: PdfBlock = { id: 'p3-b3', page: 3, kind: 'image', text: '', x: 100, y: 120, w: 480, h: 300 }
    const page3 = [logo(3), text(3), fig]
    expect(decorativeImages(page3, PAGE, [...pages.slice(0, 2), page3, pages[3]!]).has('p3-b3')).toBe(false)
  })

  it('每页同一位置的大图（页眉横幅）也不当候选', () => {
    const banner = (p: number): PdfBlock => ({ id: `p${p}-b9`, page: p, kind: 'image', text: '', x: 0, y: 0, w: 720, h: 80 })
    const all = [1, 2, 3].map((p) => [banner(p), text(p)])
    expect(decorativeImages(all[0]!, PAGE, all).has('p1-b9')).toBe(true)
  })

  it('去掉以后这一页没有图：给 AI 的提示里没有图片候选，figure 写 null', () => {
    const drop = decorativeImages(pages[2]!, PAGE, pages)
    const blocks = pages[2]!.filter((b) => !drop.has(b.id))
    const prompt = summarizePrompt({ pdfName: 'Lecture05', thread: { id: 't', page: 3, quote: '', at: 0 } as never, msgs: [], blocks, failed: [], titles: [] })
    expect(prompt).not.toContain('[图 p3-b1]')
    expect(prompt).toContain('"figure": null')
  })
})
