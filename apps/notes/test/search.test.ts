import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PdfBlock } from '@cn/format'
import { markParts, snippetAt } from '../src/shared/search'
import { hitSnippet, mdChunks, mdPlain, pdfChunks, pdfTextHits } from '../src/main/search/chunks'
import { fakeEmbedder } from '../src/main/search/embedder'
import { Indexer } from '../src/main/search/indexer'
import { readPdfText } from '../src/main/search/pdf-read'
import { VectorIndex } from '../src/main/search/vector-index'
import { LECTURE } from '../e2e/fixtures/pdf'

const block = (page: number, i: number, text: string, kind: PdfBlock['kind'] = 'text'): PdfBlock => ({ id: `p${page}-b${i}`, page, kind, text, x: 50, y: 100 * i, w: 400, h: 40 })

describe('切段和找字', () => {
  it('md 变纯文字：去掉 frontmatter、注释、图片网址、双链记号', () => {
    const md = '---\n类型: 笔记\n---\n# 标题\n\n![我框的](附件/a.png) 看 [[第4讲 特征值#旋转|旋转]] 和 [链接](http://x.y)\n<!-- card id=a -->\n> [!question] 我的疑惑\n> 为什么\n'
    const t = mdPlain(md)
    expect(t).not.toContain('类型')
    expect(t).not.toContain('附件/a.png')
    expect(t).not.toContain('card id')
    expect(t).toContain('我框的 看 旋转 和 链接')
    expect(t).toContain('为什么')
    expect(t).not.toContain('[!question]')
  })

  it('搜索结果的片段不露 md 原文：属性、双链括号、图片文件名、注释、列表记号都不见，只留命中词前后一小段', () => {
    const md = '---\n第几讲: 3\n来源: "[[第 3 讲 线性映射.pdf]]"\n日期: 2026-11-16\n---\n# 导图\n\n![原照片](../附件/导图/2026-11-16-1349.jpg)\n\n- 线性映射 <!-- box=0.1,0.2,0.3,0.1 -->\n  - 定义 <!-- box=0.2,0.3,0.1,0.1 -->\n    - [ ] 核与像\n'
    const s = hitSnippet(md, ['线性映射'])
    expect(s).toContain('线性映射')
    for (const bad of ['第几讲', '[[', '.jpg', '<!--', 'box=', '- ', '#', '[ ]']) expect(s).not.toContain(bad)
    expect(s).toBe('导图 线性映射 定义 核与像')
    const long = '前面的话。'.repeat(20) + '线性映射是保持加法和数乘的映射。' + '后面的话。'.repeat(20)
    const t = hitSnippet(long, ['线性映射'])
    expect(t.startsWith('…') && t.endsWith('…')).toBe(true)
    expect(t.length).toBeLessThanOrEqual(2 + 48 + 4)
  })

  it('md 切成不超过 360 字的几段，每段带标题；空篇只有标题', () => {
    const long = Array.from({ length: 30 }, (_, i) => `第 ${i} 段，讲线性映射的一个性质。`.repeat(2)).join('\n\n')
    const cs = mdChunks('课程/线性代数/第3讲 笔记.md', long)
    expect(cs.length).toBeGreaterThan(2)
    for (const c of cs) {
      expect(c.text.startsWith('第3讲 笔记\n')).toBe(true)
      expect(c.text.length).toBeLessThanOrEqual('第3讲 笔记\n'.length + 360)
      expect(c.snippet.length).toBeLessThanOrEqual(81)
    }
    expect(mdChunks('收件箱/空.md', '')).toEqual([{ text: '空', snippet: '' }])
  })

  it('「意思相近」的摘要不露数据库块的 YAML（和左栏摘要同一个 dropDataBlocks）', () => {
    const md = '# 读书\n\n只列在读的。\n\n```base\nfilters:\n  and:\n    - file.inFolder("写作/书单")\n    - 状态 == "在读"\nviews:\n  - type: table\n    name: 表格\n```\n'
    const cs = mdChunks('写作/读书.md', md)
    expect(cs.map((c) => c.snippet)).toEqual(['只列在读的。'])
    expect(hitSnippet(md, ['在读'])).toBe('读书 只列在读的。')
  })

  it('PDF 每页一段，图不算，带页码', () => {
    const cs = pdfChunks('课程/第3讲.pdf', [[block(1, 1, 'Linear maps', 'heading'), block(1, 2, 'A map T')], [block(2, 1, '', 'image')], [block(3, 1, 'Rotation')]])
    expect(cs.map((c) => [c.page, c.text])).toEqual([
      [1, '第3讲\nLinear maps\nA map T'],
      [3, '第3讲\nRotation'],
    ])
  })

  it('PDF 里找字：词都在这一页才算，rect 是命中那一段在页上的比例', () => {
    const pages = [[block(1, 1, 'Linear maps keep sums')], [block(2, 1, 'Rotation by theta'), block(2, 2, 'The matrix R of a rotation')]]
    const hits = pdfTextHits('a.pdf', pages, [[500, 1000], [500, 1000]], ['matrix', 'rotation'])
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ path: 'a.pdf', page: 2 })
    expect(hits[0]!.snippet).toContain('Rotation')
    expect(hits[0]!.rect).toEqual([0.1, 0.1, 0.8, 0.04])
    // 没有页面大小（早先的缓存）：不给 rect
    expect(pdfTextHits('a.pdf', pages, undefined, ['sums'])[0]!.rect).toBeUndefined()
  })

  it('命中的词标出来，不分大小写', () => {
    expect(markParts('The Matrix and a matrix.', ['matrix'])).toEqual([
      { t: 'The ', hit: false },
      { t: 'Matrix', hit: true },
      { t: ' and a ', hit: false },
      { t: 'matrix', hit: true },
      { t: '.', hit: false },
    ])
    expect(snippetAt('x'.repeat(100) + '矩阵' + 'y'.repeat(100), ['矩阵']).startsWith('…')).toBe(true)
  })
})

describe('意思索引', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cn-search-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const v = (...xs: number[]) => {
    const a = new Float32Array(xs)
    const n = Math.hypot(...xs)
    return a.map((x) => x / n)
  }

  it('同一篇只留最像的一段，PDF 每页一条；够像才留；存了能读回来，模型换了就是空的', () => {
    const ix = new VectorIndex('m', 3)
    ix.set('a.md', '1:1', [{ snippet: 'a1' }, { snippet: 'a2' }], [v(1, 0, 0), v(0.9, 0.1, 0)])
    ix.set('b.pdf', '1:1', [{ snippet: 'p1', page: 1 }, { snippet: 'p2', page: 2 }], [v(0.95, 0.05, 0), v(0, 1, 0)])
    ix.set('c.md', '1:1', [{ snippet: 'c' }], [v(0, 0, 1)])
    const hits = ix.search(v(1, 0, 0), { limit: 10, min: 0.5, near: 0.2 })
    expect(hits.map((h) => [h.path, h.page, h.snippet])).toEqual([
      ['a.md', undefined, 'a1'],
      ['b.pdf', 1, 'p1'],
    ])
    ix.save(dir)
    const back = VectorIndex.load(dir, 'm', 3)
    expect(back.fresh('a.md', '1:1')).toBe(true)
    expect(back.fresh('a.md', '2:1')).toBe(false)
    expect(back.search(v(0, 0, 1), { limit: 10, min: 0.5, near: 0.2 }).map((h) => h.path)).toEqual(['c.md'])
    expect(VectorIndex.load(dir, 'other', 3).size).toBe(0)
  })

  it('换掉、删掉一篇后行号复用，存盘时排紧', () => {
    const ix = new VectorIndex('m', 2)
    ix.set('a.md', '1', [{ snippet: 'a' }], [v(1, 0)])
    ix.set('b.md', '1', [{ snippet: 'b' }], [v(0, 1)])
    ix.remove('a.md')
    ix.set('c.md', '1', [{ snippet: 'c' }], [v(1, 0)])
    expect(ix.search(v(1, 0), { limit: 5, min: 0.9, near: 1 }).map((h) => h.path)).toEqual(['c.md'])
    ix.save(dir)
    expect(VectorIndex.load(dir, 'm', 2).search(v(0, 1), { limit: 5, min: 0.9, near: 1 }).map((h) => h.path)).toEqual(['b.md'])
  })
})

describe('索引进程的活（假模型、真的 pdf.js）', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cn-indexer-'))
    mkdirSync(join(root, '库', '课程', '线性代数'), { recursive: true })
    writeFileSync(join(root, '库', '课程', '线性代数', '第3讲 线性映射.pdf'), LECTURE)
    writeFileSync(join(root, '库', '课程', '线性代数', '第3讲 线性映射 笔记.md'), '# 笔记\n\n线性映射保持加法和数乘。\n')
    writeFileSync(join(root, '库', '周末.md'), '去爬山，带上水。\n')
    mkdirSync(join(root, '库', '.git'))
    writeFileSync(join(root, '库', '.git', 'x.md'), '不该进索引')
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  const make = (statuses: string[] = []) =>
    new Indexer({
      root: join(root, '库'),
      userData: join(root, 'ud'),
      indexDir: join(root, 'ud', 'search', 'k'),
      embedder: fakeEmbedder(),
      readPdf: readPdfText,
      meaning: { limit: 10, min: 0.1, near: 1 },
      onStatus: (s) => statuses.push(s.phase),
    })

  it('读出 PDF 的字能搜到页码，按意思找得到，第二次打开不重算', async () => {
    const statuses: string[] = []
    const ix = make(statuses)
    await ix.scan()
    expect(ix.state).toMatchObject({ phase: 'ready', files: 3 })
    expect(statuses).toContain('text')
    expect(statuses).toContain('embed')
    const hits = ix.pdfSearch('rotated e1')
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ path: '课程/线性代数/第3讲 线性映射.pdf', page: 3 })
    expect(hits[0]!.rect![0]).toBeGreaterThan(0)
    expect(hits[0]!.rect![1]).toBeLessThan(1)
    // PDF 的字也写进了 PDF 标签用的全文缓存
    expect(readdirSync(join(root, 'ud', 'reading', 'text'))).toHaveLength(1)

    // 假模型把「变换」「map」都当「映射」：笔记和 PDF 都找得到，爬山那篇找不到
    const m = (await ix.meaning('矩阵怎么变换')).map((h) => h.path)
    expect(m).toContain('课程/线性代数/第3讲 线性映射 笔记.md')
    expect(m).toContain('课程/线性代数/第3讲 线性映射.pdf')
    expect(m[0]).not.toBe('周末.md')

    // 重开：索引从盘上读回来，什么都不用算
    const again: string[] = []
    const ix2 = make(again)
    await ix2.scan()
    expect(again).not.toContain('embed')
    expect(ix2.state.phase).toBe('ready')
    expect((await ix2.meaning('爬山')).map((h) => h.path)[0]).toBe('周末.md')
  })

  it('改了的重算、删了的去掉', async () => {
    const ix = make()
    await ix.scan()
    writeFileSync(join(root, '库', '周末.md'), '去海边游泳。\n')
    rmSync(join(root, '库', '课程', '线性代数', '第3讲 线性映射.pdf'))
    await ix.scan()
    expect(ix.state.files).toBe(2)
    expect(ix.pdfSearch('rotation')).toEqual([])
    expect((await ix.meaning('游泳'))[0]!.snippet).toContain('海边')
  })
})
