import { describe, expect, it } from 'vitest'
import { biKind, bilingualNote, blocksText, fromMiddle, isFigureBlock, type MiddleJson, mineruFigure, type PdfBlock, blockPlain, remapBlockIds, spansText, tableToMarkdown, tableRows, tableText, translatable } from '../src'
import { MIDDLE } from './mineru-fixture'

describe('MinerU 的 middle_json 换成块', () => {
  const { pages, sizes } = fromMiddle(MIDDLE, 6)

  it('页数按整份 PDF 算，MinerU 没给的页是空的；页面大小照 width_pt / height_pt', () => {
    expect(pages).toHaveLength(6)
    expect(pages[0]).toEqual([])
    expect(sizes[2]).toEqual([612, 792])
  })

  it('页码 = page_idx + 1；坐标从 0 到 1 的比例乘页面大小；按 index 排', () => {
    const p3 = pages[2]!
    expect(p3.map((b) => b.kind)).toEqual(['heading', 'text', 'formula', 'image', 'caption'])
    expect(p3[0]).toMatchObject({ id: 'p3-b1', page: 3, kind: 'heading', text: '3. Residual Learning', by: 'mineru' })
    expect(p3[0]!.x).toBeCloseTo(0.08 * 612)
    expect(p3[0]!.y).toBeCloseTo(0.1 * 792)
    expect(p3[0]!.w).toBeCloseTo(0.22 * 612)
    expect(p3[0]!.h).toBeCloseTo(0.02 * 792)
  })

  it('行内公式写成 $…$；公式块的 text 是 LaTeX；图注跟在图后面', () => {
    const p3 = pages[2]!
    expect(p3[1]!.text).toBe('Let us consider $\\mathcal { H } ( \\mathbf { x } )$, an underlying mapping.')
    expect(p3[2]!.text).toBe('\\mathbf { y } = \\mathcal { F } ( \\mathbf { x } ) + \\mathbf { x } .\\tag{1}')
    expect(p3[3]).toMatchObject({ kind: 'image', text: '' })
    expect(p3[4]).toMatchObject({ kind: 'caption', text: 'Figure 2. A building block.' })
  })

  it('页眉页脚、页码、页边竖排字（aside_text）丢掉；脚注、链接留字', () => {
    const all = pages.flat().map((b) => b.text)
    expect(all.join(' ')).not.toMatch(/arXiv|Conference 2016/)
    expect(pages[4]!.find((b) => b.text.includes('example.org'))?.kind).toBe('text')
  })

  it('表格：text 是 HTML，表注是 caption（表注在上的保持在上）；图表（chart）是图', () => {
    const p5 = pages[4]!
    expect(p5.map((b) => b.kind)).toEqual(['table', 'caption', 'image', 'caption', 'table', 'text'])
    expect(p5[0]!.text).toMatch(/^<table>/)
  })

  it('不是 middle_json 的报错', () => {
    expect(() => fromMiddle({} as MiddleJson)).toThrow(/middle_json/)
  })
})

describe('表格', () => {
  const html = MIDDLE.pages[1]!.blocks[0]!.content as { content: string }[]
  const t = html[0]!.content
  it('拆成格子：只认 tr、td、th 和合并格，实体解码', () => {
    const rows = tableRows(t)
    expect(rows).toHaveLength(3)
    expect(rows[0]!.map((c) => c.text)).toEqual(['layer', 'size', '18-layer'])
    expect(rows[2]![2]!.text).toBe('3×3 max pool & more')
    expect(tableRows('<table><tr><th>a</th><td rowspan="2" onclick="x()">b<script>bad()</script></td></tr></table>')).toEqual([[{ text: 'a', head: true }, { text: 'bbad()', rowspan: 2 }]])
  })
  it('上下标写成行内公式（界面渲染成上下标）', () => {
    expect(tableRows('<table><tr><td>1.8×10<sup>9</sup></td><td>W<sub>s</sub></td></tr></table>')[0]!.map((c) => c.text)).toEqual(['1.8×10$^{9}$', 'W$_{s}$'])
  })
  it('给 AI 的字一行一行，格子之间「 | 」；搜的字一样', () => {
    expect(tableText(t).split('\n')[1]).toBe('conv1 | 112×112 | 7×7, 64')
    expect(blockPlain({ kind: 'table', text: t })).toBe(tableText(t))
  })
  it('没有合并格的写成 Markdown 表，有合并格的写不成', () => {
    expect(tableToMarkdown(t)).toBe('| layer | size | 18-layer |\n| --- | --- | --- |\n| conv1 | 112×112 | 7×7, 64 |\n| conv2_x | 56×56 | 3×3 max pool & more |')
    expect(tableToMarkdown('<table><tr><td colspan="2">a</td></tr></table>')).toBeNull()
  })
})

describe('别处认得这三种新块', () => {
  const { pages } = fromMiddle(MIDDLE)
  it('AI 读页：表写成「[表 id]」加格子，公式 $$LaTeX$$，图注照写', () => {
    const t3 = blocksText(pages[2]!)
    expect(t3).toContain('$$\\mathbf { y } = ')
    expect(t3).toContain('[图 p3-b4]\nFigure 2. A building block.')
    expect(blocksText(pages[4]!)).toMatch(/^\[表 p5-b1\]\nlayer \| size \| 18-layer/)
  })
  it('对照读：表、公式不翻，图注翻', () => {
    const p5 = pages[4]!
    expect(p5.map(biKind)).toEqual(['table', 'caption', 'figure', 'caption', 'table', 'text'])
    expect(translatable(p5).map((b) => b.kind)).toEqual(['caption', 'caption', 'text'])
    expect(biKind(pages[2]![2]!)).toBe('formula')
  })
  it('表能当配图', () => {
    expect(pages[4]!.filter(isFigureBlock).map((b) => b.id)).toEqual(['p5-b1', 'p5-b3', 'p5-b5'])
  })
  it('双语笔记里公式写 $$，表写 Markdown 表', () => {
    const md = bilingualNote({ note: 'a 双语.md', source: { pdf: 'a.pdf' }, pages: [{ page: 1, blocks: [{ kind: 'math', tex: 'x^2' }, { kind: 'table', md: '| a |\n| --- |' }] }], now: new Date(2026, 10, 17) })
    expect(md).toContain('$$\nx^2\n$$')
    expect(md).toContain('| a |\n| --- |')
  })
})

describe('行内', () => {
  it('列表里一项一行', () => {
    expect(
      spansText([
        { type: 'text', bbox: [0, 0, 1, 1], content: [{ type: 'text', content: 'first' }] },
        { type: 'text', bbox: [0, 0, 1, 1], content: [{ type: 'text', content: 'second' }] },
      ]),
    ).toBe('first\nsecond')
  })
})

describe('换成 MinerU 的块时，旧编号对到新块', () => {
  const b = (id: string, kind: PdfBlock['kind'], x: number, y: number, w: number, h: number): PdfBlock => ({ id, page: 5, kind, text: kind === 'image' ? '' : 'x', x, y, w, h })
  it('按框的重叠对：图对图（或表），字对字；对不上的不列，编号没变的不列', () => {
    const old = { 5: [b('p5-b1', 'text', 50, 60, 500, 40), b('p5-b2', 'image', 100, 250, 200, 140), b('p5-b3', 'text', 50, 700, 30, 10)] }
    const neu = { 5: [b('p5-b1', 'text', 48, 58, 505, 44), b('p5-b2', 'table', 120, 70, 350, 150), b('p5-b3', 'caption', 50, 400, 500, 20), b('p5-b4', 'image', 95, 245, 210, 150)] }
    expect(remapBlockIds(old, neu)).toEqual({ 'p5-b2': 'p5-b4' })
  })
  it('数组形式（每页一项）也行', () => {
    expect(remapBlockIds([[{ ...b('p1-b1', 'image', 0, 0, 100, 100), page: 1 }]], [[{ ...b('p1-b2', 'image', 0, 0, 100, 100), page: 1 }]])).toEqual({ 'p1-b1': 'p1-b2' })
  })
})

describe('配图用 MinerU 的图框', () => {
  const { pages } = fromMiddle(MIDDLE)
  const size = { w: 612, h: 792 }
  it('和 AI 给的框重叠最多的那个图或表，框四周留一点，图注取紧挨着的', () => {
    const f = mineruFigure(pages[4]!, size, { rect: [0.12, 0.3, 0.37, 0.2] })!
    expect(f.block).toBe('p5-b3')
    expect(f.rect[0]).toBeCloseTo((0.14 * 612 - 4) / 612)
    const t = mineruFigure(pages[4]!, size, { rect: [0.2, 0.08, 0.6, 0.22] })!
    expect(t.block).toBe('p5-b1')
    expect(t.caption).toBe('Table 1. Architectures.')
  })
  it('AI 没给框用记笔记挑的块；都没有、或不是 MinerU 的块就 null', () => {
    expect(mineruFigure(pages[2]!, size, { block: 'p3-b4' })?.caption).toBe('Figure 2. A building block.')
    expect(mineruFigure(pages[2]!, size, {})).toBeNull()
    expect(mineruFigure([{ ...pages[2]![3]!, by: undefined }], size, { block: 'p3-b4' })).toBeNull()
    expect(mineruFigure(pages[2]!, size, { rect: [0, 0.9, 0.1, 0.05] })).toBeNull()
  })
})
