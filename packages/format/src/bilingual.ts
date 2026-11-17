/**
 * 双语对照读（PDF、网页阅读视图）的纯计算：哪些块要翻、哪些块（公式、图）照原页裁下来不翻，
 * 以及「存成双语笔记」写出来的 md。不依赖 Electron，也不依赖 pdf.js。
 *
 * 做法照 ParaRead（~/Documents/Projects/scholar-reader，同一个作者）：公式块和图不翻译；译文按段落指纹缓存。
 */
import { linkFrom } from './reading-note'
import { formatPdfAnchor } from './pdf-link'
import { AI_KEY, setProp } from './props'
import { courseOf, dayOf, lectureOf } from './reading-note'
import type { PdfBlock } from './pdf-blocks'

/** 数学符号：等号、运算、希腊字母、集合、箭头、上下标数字 */
const MATH = /[=+−\-×·÷∑∏∫∂√≤≥≈≠∞∈∉⊂⊆∪∩∀∃→←↦⇒⇔∘⊗⊕^_|‖⟨⟩α-ωΑ-Ω₀-₉⁰-⁹′]/g
/** 一个「词」：4 个以上的拉丁字母，或 2 个以上的汉字 */
const WORD = /[A-Za-z]{4,}|[一-鿿]{2,}/g
/** 公式里常见、但不算「词」的函数名 */
const FUNC = /^(sin|cos|tan|cot|sec|csc|log|exp|lim|sup|inf|max|min|det|rank|span|dim|ker|trace)$/i

/**
 * 这一块是不是公式（不翻译，照原页裁下来）：有数学符号，而且几乎没有成句的词。
 * 「R(θ) = cos θ −sin θ …」是公式；「Check: column 1 of R(θ) is the rotated e₁ …」是正文。
 */
export function isFormula(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  const math = t.match(MATH)?.length ?? 0
  if (!math) return false
  const words = (t.match(WORD) ?? []).filter((w) => !FUNC.test(w))
  if (words.length === 0) return true
  // 很长的块算正文（公式不会写成几行字）
  if (t.length > 160) return false
  return words.length <= 1 && math >= 2
}

/**
 * 一块怎么出现在对照里：要翻的字（标题、正文、图注）、照原页裁的公式 / 图；
 * MinerU 认出的表格画成表、公式（LaTeX）渲染出来，都不翻
 */
export type BiKind = 'heading' | 'text' | 'caption' | 'formula' | 'figure' | 'table'

export function biKind(b: Pick<PdfBlock, 'kind' | 'text' | 'stack'>): BiKind {
  if (b.kind === 'image') return 'figure'
  if (b.kind === 'heading') return 'heading'
  if (b.kind === 'table') return 'table'
  if (b.kind === 'formula') return 'formula'
  if (b.kind === 'caption') return 'caption'
  // 一格一格的标签（「Computation Stack」那种彩色表，pdf-blocks 把它的行用换行连着）：拍扁成一行字看不懂，整块照原页裁
  if (b.stack) return 'figure'
  return isFormula(b.text) ? 'formula' : 'text'
}

/**
 * 装饰图（CN-31）：不进对照、不裁成「公式和图」。
 * - 面积小于页面 4% 的图（Logo、图标、项目符号）；
 * - 同一个位置（差不到页面的 2%）、差不多大的图在 3 页以上都有（校徽、页角色块、每页一样的页眉图）。
 * 返回这些图块的 id。
 */
export function decorations(pages: Record<number, Pick<PdfBlock, 'id' | 'kind' | 'x' | 'y' | 'w' | 'h'>[]>, sizes: { w: number; h: number }[]): Set<string> {
  const out = new Set<string>()
  const imgs: { id: string; page: number; x: number; y: number; w: number; h: number }[] = []
  for (const [k, list] of Object.entries(pages)) {
    const n = Number(k)
    const sz = sizes[n - 1]
    if (!sz) continue
    for (const b of list) {
      if (b.kind !== 'image') continue
      const f = { id: b.id, page: n, x: b.x / sz.w, y: b.y / sz.h, w: b.w / sz.w, h: b.h / sz.h }
      if (f.w * f.h < 0.04) out.add(b.id)
      imgs.push(f)
    }
  }
  const near = (a: (typeof imgs)[number], b: (typeof imgs)[number]) =>
    Math.abs(a.x - b.x) < 0.02 && Math.abs(a.y - b.y) < 0.02 && Math.abs(a.w - b.w) < 0.02 && Math.abs(a.h - b.h) < 0.02
  for (const a of imgs) {
    if (out.has(a.id)) continue
    const pagesWith = new Set(imgs.filter((b) => near(a, b)).map((b) => b.page))
    if (pagesWith.size >= 3) out.add(a.id)
  }
  return out
}

/** 要送去翻的块（公式和图不送）；页码、页眉这类只有数字的短行也不送 */
export function translatable<T extends Pick<PdfBlock, 'kind' | 'text'>>(blocks: T[]): T[] {
  return blocks.filter((b) => {
    const k = biKind(b)
    if (k === 'formula' || k === 'figure' || k === 'table') return false
    return /[A-Za-zÀ-ɏЀ-ӿ぀-ヿ一-鿿가-힯]{2,}/.test(b.text)
  })
}

// ---------------------------------------------------------------- 存成双语笔记

/** 双语笔记里的一块：字（原文 + 译文，译文没有时只写原文）或一张裁图 */
export type BiNoteBlock =
  | { kind: 'heading' | 'text'; text: string; tr: string | null }
  | { kind: 'formula' | 'figure'; path: string; caption?: string }
  /** MinerU 认出的：公式写 $$LaTeX$$，表格写 Markdown 表（有合并格的照原页裁成图） */
  | { kind: 'math'; tex: string }
  | { kind: 'table'; md: string }

export interface BiNotePage {
  /** PDF 的第几页；网页没有页 */
  page?: number
  blocks: BiNoteBlock[]
}

export interface BiNoteInput {
  /** 笔记自己在库里的路径（链接相对它） */
  note: string
  /** PDF：库里的路径；网页：网址 */
  source: { pdf: string } | { url: string; title: string }
  pages: BiNotePage[]
  /** 「英文 → 中文」 */
  langs?: string
  now?: Date
}

const stem = (p: string) => (p.split('/').pop() ?? p).replace(/\.[^.]+$/, '')
const oneLine = (s: string) => s.replace(/\s*\n+\s*/g, ' ').trim()
const quote = (s: string) => `> ${oneLine(s)}`

/** 「第3讲 线性映射.pdf」→ 同一个文件夹里「第3讲 线性映射 双语.md」 */
export function biNotePathFor(pdf: string): string {
  const d = pdf.includes('/') ? pdf.slice(0, pdf.lastIndexOf('/') + 1) : ''
  return `${d}${stem(pdf)} 双语.md`
}

/** 网页的双语笔记：收件箱里「<标题> 双语.md」（文件名里不能有的字换掉） */
export function webBiNotePath(title: string): string {
  const safe = title.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || '网页'
  return `收件箱/${safe} 双语.md`
}

/**
 * 双语笔记：属性（类型 双语、课程、第几讲、来源、日期）+ 一级标题 + 每页一节（节头是回到 PDF 那页的链接）。
 * 每段原文写成引用、紧跟译文；标题写译文、下一行引用原文；公式和图是裁图。
 */
export function bilingualNote(input: BiNoteInput): string {
  const { note, source } = input
  const now = input.now ?? new Date()
  let t = setProp('', '类型', '双语')
  let title: string
  if ('pdf' in source) {
    const course = courseOf(source.pdf)
    const lec = lectureOf(source.pdf)
    if (course) t = setProp(t, '课程', course)
    if (lec !== undefined) t = setProp(t, '第几讲', String(lec))
    t = setProp(t, '来源', `[[${source.pdf.split('/').pop()}]]`)
    t = setProp(t, '日期', dayOf(now))
    const ai = [...(course ? ['课程'] : []), ...(lec !== undefined ? ['第几讲'] : [])]
    if (ai.length) t = setProp(t, AI_KEY, ai.join(', '))
    title = `${stem(source.pdf)} 双语`
  } else {
    t = setProp(t, '来源', source.url)
    t = setProp(t, '日期', dayOf(now))
    title = `${oneLine(source.title) || '网页'} 双语`
  }
  const out: string[] = [`${t}\n# ${title}`]
  if (input.langs) out.push('', `${input.langs} · 原文是引用，下面跟着译文；公式和图不翻译，照原页裁下来。`)
  for (const pg of input.pages) {
    if ('pdf' in source && pg.page) out.push('', `## [第 ${pg.page} 页](${anchor(note, source.pdf, pg.page)})`)
    else if (!('pdf' in source)) out.push('', `[回到网页](${source.url})`)
    for (const b of pg.blocks) {
      out.push('')
      if ('path' in b) {
        out.push(`![${(b.caption ?? (b.kind === 'formula' ? '公式' : '图')).replace(/[[\]]/g, '')}](${/^https?:/i.test(b.path) ? b.path : linkFrom(note, b.path)})`)
      } else if (b.kind === 'math') {
        out.push(`$$\n${b.tex.trim()}\n$$`)
      } else if (b.kind === 'table') {
        out.push(b.md.trim())
      } else if (b.kind === 'heading') {
        out.push(`### ${oneLine(b.tr ?? b.text)}`)
        if (b.tr) out.push('', quote(b.text))
      } else {
        out.push(quote(b.text))
        if (b.tr) out.push('', oneLine(b.tr))
      }
    }
  }
  return out.join('\n') + '\n'
}

function anchor(note: string, pdf: string, page: number): string {
  const href = formatPdfAnchor({ file: pdf, page })
  return linkFrom(note, pdf) + href.slice(href.indexOf('#'))
}
