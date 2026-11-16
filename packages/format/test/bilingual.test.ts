import { describe, expect, it } from 'vitest'
import { type AskSection, biKind, biNotePathFor, bilingualNote, isFormula, parseReadingNote, prop, renderSection, translatable, upsertSection, webBiNotePath } from '../src'

describe('公式和图不翻译', () => {
  it('认得出公式', () => {
    expect(isFormula('R(θ) = cos θ −sin θ sin θ cos θ')).toBe(true)
    expect(isFormula('θ = 90°: R = 0 −1 1 0')).toBe(true)
    expect(isFormula('T(x) = A x, A = [ T(e₁) T(e₂) ]')).toBe(true)
    expect(isFormula('x′ = x cos θ − y sin θ')).toBe(true)
  })
  it('正文、标题不算公式', () => {
    expect(isFormula('Check: column 1 of R(θ) is the rotated e₁, column 2 the rotated e₂.')).toBe(false)
    expect(isFormula('Rotate the plane counter-clockwise by an angle θ about the origin:')).toBe(false)
    expect(isFormula('Linear maps and matrices')).toBe(false)
    expect(isFormula('把平面绕原点逆时针旋转 θ 角')).toBe(false)
    expect(isFormula('')).toBe(false)
  })
  it('图、公式不送去翻；只有页码的短行也不送', () => {
    const blocks = [
      { kind: 'heading' as const, text: 'Example 3.4 Rotation' },
      { kind: 'text' as const, text: 'Rotate the plane by θ:' },
      { kind: 'text' as const, text: 'R(θ) = cos θ −sin θ' },
      { kind: 'image' as const, text: '' },
      { kind: 'text' as const, text: '5 / 10' },
    ]
    expect(blocks.map(biKind)).toEqual(['heading', 'text', 'formula', 'figure', 'text'])
    expect(translatable(blocks).map((b) => b.text)).toEqual(['Example 3.4 Rotation', 'Rotate the plane by θ:'])
  })
})

describe('存成双语笔记', () => {
  const pdf = '课程/线性代数/第3讲 线性映射.pdf'
  const note = biNotePathFor(pdf)
  it('写在 PDF 同一个文件夹', () => {
    expect(note).toBe('课程/线性代数/第3讲 线性映射 双语.md')
    expect(webBiNotePath('Rotation matrix - Wikipedia: a/b')).toBe('收件箱/Rotation matrix - Wikipedia a b 双语.md')
  })
  it('属性、每页一节（节头回到 PDF 那页）、原文引用跟译文、公式是裁图', () => {
    const md = bilingualNote({
      note,
      source: { pdf },
      langs: '英文 → 中文',
      now: new Date(2026, 10, 16),
      pages: [
        {
          page: 5,
          blocks: [
            { kind: 'heading', text: 'Example 3.4 Rotation', tr: '例 3.4 旋转' },
            { kind: 'text', text: 'Rotate the plane\nby θ:', tr: '把平面旋转 θ：' },
            { kind: 'formula', path: '附件/第3讲 线性映射/双语/p5-b3.png' },
            { kind: 'text', text: 'Not yet', tr: null },
          ],
        },
      ],
    })
    const props = (k: string) => prop(md, k)
    expect(props('类型')).toBe('双语')
    expect(props('课程')).toBe('线性代数')
    expect(props('第几讲')).toBe('3')
    expect(props('日期')).toBe('2026-11-16')
    expect(md).toContain('# 第3讲 线性映射 双语')
    expect(md).toContain('## [第 5 页](第3讲%20线性映射.pdf#page=5)')
    expect(md).toContain('### 例 3.4 旋转\n\n> Example 3.4 Rotation')
    expect(md).toContain('> Rotate the plane by θ:\n\n把平面旋转 θ：')
    expect(md).toContain('![公式](../../附件/第3讲%20线性映射/双语/p5-b3.png)')
    expect(md).toContain('> Not yet\n')
  })
  it('网页：来源是网址，头上回到网页', () => {
    const md = bilingualNote({
      note: '收件箱/Rotation matrix 双语.md',
      source: { url: 'https://en.wikipedia.org/wiki/Rotation_matrix', title: 'Rotation matrix' },
      pages: [{ blocks: [{ kind: 'text', text: 'In linear algebra', tr: '在线性代数里' }] }],
    })
    expect(prop(md, '来源')).toBe('https://en.wikipedia.org/wiki/Rotation_matrix')
    expect(md).toContain('[回到网页](https://en.wikipedia.org/wiki/Rotation_matrix)')
    expect(md).toContain('# Rotation matrix 双语')
  })
})

describe('在网页、HTML 上问的那段', () => {
  const base: AskSection = {
    id: '.canvas-notes/对话/网页-1.md',
    file: '',
    page: 5,
    title: '旋转公式和课件是一回事',
    time: '10:20',
    figures: [],
    doubts: ['这段和课件第 5 页什么关系'],
    good: '同一件事，写法不同。',
    points: [],
    failed: [],
    rounds: 1,
    links: [],
    web: { url: 'https://en.wikipedia.org/wiki/Rotation_matrix_(math)', label: 'en.wikipedia.org' },
  }
  it('链接那行写域名和网址，读回来一样（括号不破坏 md 链接）', () => {
    const note = '课程/线性代数/第3讲 线性映射 笔记.md'
    const md = renderSection(base, note)
    expect(md).toContain('## 第 5 页 · 旋转公式和课件是一回事')
    expect(md).toContain('[en.wikipedia.org](https://en.wikipedia.org/wiki/Rotation_matrix_%28math%29) · 10:20')
    const back = parseReadingNote(md, note)[0]!
    expect(back.web).toEqual(base.web)
    expect(back.page).toBe(5)
    expect(back.time).toBe('10:20')
    expect(back.good).toBe('同一件事，写法不同。')
  })
  it('没有 PDF 时标题不写页码；库里的 HTML 写相对链接', () => {
    const note = '收件箱/网页笔记.md'
    const s: AskSection = { ...base, page: 0, web: { url: '课程/线性代数/旋转矩阵.html', label: '旋转矩阵.html' } }
    const md = upsertSection('# 网页笔记\n', s, note)
    expect(md).toContain('## 旋转公式和课件是一回事\n[旋转矩阵.html](../课程/线性代数/旋转矩阵.html) · 10:20')
    const back = parseReadingNote(md, note)[0]!
    expect(back.page).toBe(0)
    expect(back.web).toEqual(s.web)
  })
})
