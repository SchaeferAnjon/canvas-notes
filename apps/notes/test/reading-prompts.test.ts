import type { PdfBlock } from '@cn/format'
import { describe, expect, it } from 'vitest'
import { askPrompt, fullTextOf, noteDigest, parseSummary, summarizePrompt, versionsOf } from '../src/main/reading/prompts'
import { type ReadingMsg, type ReadingThread, readLine } from '../src/shared/reading'

const thread: ReadingThread = { id: '.canvas-notes/对话/L3-p5-1.md', page: 5, rect: [0.1, 0.2, 0.3, 0.4], crop: '附件/L3/p5-1.png', createdAt: 0 }
let n = 0
const u = (text: string): ReadingMsg => ({ id: n++, role: 'user', thread: thread.id, text, time: 0 })
const a = (text: string): ReadingMsg => ({ id: n++, role: 'ai', thread: thread.id, text, time: 0 })
const blocks: PdfBlock[] = [
  { id: 'p5-b1', page: 5, kind: 'heading', text: 'Example 3.4 Rotation', x: 0, y: 0, w: 1, h: 1 },
  { id: 'p5-b2', page: 5, kind: 'image', text: '', x: 0, y: 0, w: 1, h: 1 },
  { id: 'p5-b3', page: 5, kind: 'text', text: 'Rotate the plane.', x: 0, y: 0, w: 1, h: 1 },
]

describe('哪几版讲法没讲通', () => {
  it('回答后面紧跟「还是不懂」「换个方式讲」的那版算没讲通；别的追问不算', () => {
    const msgs = [u('给我讲解一下'), a('第一版'), u('还是不懂'), a('第二版'), u('那 −sin θ 呢？'), a('第三版'), u('换个方式讲'), a('第四版')]
    const v = versionsOf(msgs)
    expect(v.answers.map((m) => m.text)).toEqual(['第一版', '第二版', '第三版', '第四版'])
    expect(v.failed).toEqual([1, 3])
  })
  it('出错的回答不算一版', () => {
    const v = versionsOf([u('给我讲解一下'), { ...a(''), error: '停下了' }, u('给我讲解一下'), a('好的')])
    expect(v.answers.length).toBe(1)
  })
})

describe('问 AI 的话', () => {
  it('第一次带全文、笔记里懂了的、这一页的字和框的说明', () => {
    const p = askPrompt({ pdfName: '第3讲', page: 5, pages: 10, pageText: 'Rotate', question: '给我讲解一下', thread, fullText: '--- 第 1 页 ---\nHi\n', digest: '- 第 4 页「列」：…', hasImage: true })
    expect(p).toContain('<pdf>\n--- 第 1 页 ---\nHi\n\n</pdf>')
    expect(p).toContain('他笔记里已经弄懂的：\n- 第 4 页「列」：…')
    expect(p).toContain('他现在在看第 5 页（共 10 页）')
    expect(p).toContain('他在这一页上框了一块，就是附上的图。\n他说：给我讲解一下')
  })
  it('全文还在读：说一声；整页问、选字问、追问说法不一样', () => {
    expect(askPrompt({ pdfName: 'x', page: 1, pages: 2, pageText: '', question: 'q', thread: { ...thread, rect: undefined }, fullPending: true, digest: '', hasImage: true })).toMatch(
      /还在读[\s\S]*没有能选的字[\s\S]*附上的图是整页/,
    )
    expect(askPrompt({ pdfName: 'x', page: 1, pages: 2, pageText: 't', question: 'q', thread: { ...thread, quote: '一段字' }, digest: '', hasImage: false })).toContain('他选中了这段字：「一段字」')
    expect(askPrompt({ pdfName: 'x', page: 1, pages: 2, pageText: 't', question: 'q', thread, digest: '', hasImage: false })).toContain('接着刚才那处在追问')
  })
  it('全文按页写，太长截断', () => {
    const pages = [[blocks[0]!], [{ ...blocks[2]!, page: 6 }]]
    expect(fullTextOf(pages)).toBe('--- 第 5 页 ---\n# Example 3.4 Rotation\n--- 第 6 页 ---\nRotate the plane.\n')
    expect(fullTextOf(pages, 40)).toContain('后面的页太长')
  })
  it('笔记摘要一段一行', () => {
    expect(noteDigest([{ id: 'x', file: 'a.pdf', page: 4, title: '列', good: '列就是\n基向量去哪', figures: [], doubts: [], points: [], failed: [], rounds: 1, links: [] }])).toBe('- 第 4 页「列」：列就是 基向量去哪')
  })
})

describe('收笔记段', () => {
  const msgs = [u('给我讲解一下'), a('用公式推……'), u('还是不懂'), a('看图：……')]
  const failed = versionsOf(msgs).failed
  it('提示里有对话（标了第几版）、没讲通的版本、能挑的图和双链', () => {
    const p = summarizePrompt({ pdfName: '第3讲', thread, msgs, blocks, failed, titles: ['第4讲 特征值'] })
    expect(p).toContain('【AI 第 1 版】用公式推……')
    expect(p).toContain('其中第 1 版之后他说没懂')
    expect(p).toContain('从 p5-b2 里挑一个')
    expect(p).toContain('第4讲 特征值')
  })
  it('读回 JSON：图和双链只认存在的，前后有废话也行', () => {
    const raw = '好的：\n{"title":"旋转矩阵","doubts":["四个数怎么来的"],"good":"看图","points":["一","二"],"failed":[{"version":1,"line":"用公式推"},{"version":9,"line":"乱写"}],"figure":"p5-b2","figureCaption":"单位圆","links":["第4讲 特征值","没有这篇"]}'
    const r = parseSummary(raw, { thread, msgs, failed, titles: ['第4讲 特征值'], blocks })
    expect(r).toEqual({ title: '旋转矩阵', doubts: ['四个数怎么来的'], good: '看图', points: ['一', '二'], failedLines: { 1: '用公式推' }, figure: 'p5-b2', figureCaption: '单位圆', links: ['第4讲 特征值'] })
  })
  it('AI 没给出 JSON：用对话兜一段（问的话当疑惑，最后一版当讲通的）', () => {
    const r = parseSummary('出错了', { thread, msgs, failed, titles: [], blocks })
    expect(r.title).toBe('还是不懂')
    expect(r.doubts).toEqual(['给我讲解一下', '还是不懂'])
    expect(r.good).toBe('看图：……')
    expect(r.failedLines).toEqual({ 1: '用公式推……' })
    expect(r.figure).toBeUndefined()
  })
  it('挑了不是图的块不算', () => {
    expect(parseSummary('{"figure":"p5-b3"}', { thread, msgs, failed, titles: [], blocks }).figure).toBeUndefined()
  })
})

describe('回答上面那一行', () => {
  it('提到的别的页笔记里弄懂过，就说用到了；没弄懂过的、这一页自己不算', () => {
    const sec = (page: number) => ({ id: String(page), file: 'a.pdf', page, title: '', good: '', figures: [], doubts: [], points: [], failed: [], rounds: 1, links: [] })
    expect(readLine(5, '用你在 [第 4 页](#page=4) 弄懂的，再看 [第 7 页](#page=7) 和 [第 5 页](#page=5)', [sec(4), sec(5)])).toBe('读了第 5 页 · 用到第 4 页你弄懂的那条')
    expect(readLine(5, '没提别的页', [sec(4)])).toBe('读了第 5 页')
  })
})
