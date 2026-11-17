/**
 * MinerU（PDF 精读增强）的 middle_json 换成段落块：表格、公式、图注、双栏、配图的框都比 pdf.js 拼的准。
 * 只是纯计算，不依赖 Electron；跑 MinerU 的进程在 apps/notes/src/main/mineru/。
 *
 * 来自 ParaRead（同一作者，~/Documents/Projects/scholar-reader 的 src/main/layout.ts fromMiddle），在此以 GPL-3.0-or-later 提供。
 *
 * middle_json（schema docvortex.middle 2.0）：每页 page_idx（从 0 起）和 blocks；块的 bbox 是 0 到 1 的比例 [x0, y0, x1, y1]，
 * 页面大小在 extensions.docvortex_layout.pages[].width_pt / height_pt；index 是页内阅读顺序。
 * 图、表、图表是复合块：content 里是 *_body 和 *_caption / *_footnote，各有各的 bbox 和 index。
 */
import type { PdfBlock } from './pdf-blocks'

interface MjSpan {
  type?: string
  content?: unknown
  bbox?: number[]
  index?: number
}

interface MjBlock {
  type: string
  index?: number
  bbox?: number[]
  level?: number
  content?: unknown
}

export interface MiddleJson {
  schema?: string
  extensions?: { docvortex_layout?: { pages?: { page_idx: number; width_pt: number; height_pt: number }[] } }
  pages: { page_idx: number; blocks: MjBlock[] }[]
}

/** 块的种类：哪些丢掉（页眉页脚、页码、页边的 arXiv 竖排字） */
const KIND: Record<string, PdfBlock['kind'] | null> = {
  doc_title: 'heading',
  paragraph_title: 'heading',
  title: 'heading',
  text: 'text',
  list: 'text',
  ref_text: 'text',
  page_footnote: 'text',
  code: 'text',
  algorithm: 'text',
  image_body: 'image',
  chart_body: 'image',
  image_caption: 'caption',
  chart_caption: 'caption',
  table_caption: 'caption',
  image_footnote: 'caption',
  chart_footnote: 'caption',
  table_footnote: 'caption',
  table_body: 'table',
  equation: 'formula',
  interline_equation: 'formula',
  header: null,
  footer: null,
  page_number: null,
  aside_text: null,
  discarded: null,
}

const COMPOSITE = new Set(['image', 'table', 'chart'])

/** 行内的几段拼成字：行内公式写成 $…$，链接只留字，列表一项一行 */
export function spansText(c: unknown): string {
  if (typeof c === 'string') return c
  if (!Array.isArray(c)) return ''
  let out = ''
  for (const s of c as MjSpan[]) {
    if (!s || typeof s !== 'object') continue
    const inner = spansText(s.content)
    if (s.type === 'equation_inline' || s.type === 'inline_equation') out += ` $${inner.trim()}$ `
    else if (s.type && /^(text|list_item|list|ref_text|code)$/.test(s.type) && Array.isArray(s.content) && s.bbox) out += (out ? '\n' : '') + inner
    else out += inner
  }
  return out
}

const tidy = (s: string) =>
  s
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    // 「$x$ ,」这类公式后面跟标点的空格去掉
    .replace(/\$ ([,.;:)])/g, '$$$1')

/** 公式块里的 LaTeX：去掉外面包着的 $$ 或 \[ \] */
export const latexOf = (s: string) =>
  s
    .trim()
    .replace(/^\$\$?|\$\$?$/g, '')
    .replace(/^\\\[|\\\]$/g, '')
    .trim()

export interface MineruPages {
  /** 每页的块，下标 0 是第 1 页；MinerU 没给的页是空数组 */
  pages: PdfBlock[][]
  /** 每页宽、高（页面单位，和 pdf.js scale 1 的视口一样） */
  sizes: [number, number][]
}

/**
 * middle_json → 每页的块。pageCount：整份 PDF 有几页（MinerU 只给了一部分页时其余是空的）；
 * fallbackSize：middle_json 里没写页面大小时用 pdf.js 量到的（每页 [宽, 高]）。
 */
export function fromMiddle(j: MiddleJson, pageCount?: number, fallbackSize?: [number, number][]): MineruPages {
  if (!j || !Array.isArray(j.pages)) throw new Error('MinerU 的结果不是 middle_json')
  const sizesIn = j.extensions?.docvortex_layout?.pages ?? []
  const n = Math.max(pageCount ?? 0, ...j.pages.map((p) => p.page_idx + 1))
  const pages: PdfBlock[][] = Array.from({ length: n }, () => [])
  const sizes: [number, number][] = Array.from({ length: n }, (_, i) => {
    const sz = sizesIn.find((x) => x.page_idx === i)
    return sz ? [sz.width_pt, sz.height_pt] : (fallbackSize?.[i] ?? [612, 792])
  })
  for (const p of j.pages) {
    const page = p.page_idx + 1
    if (!(page >= 1 && page <= n) || !Array.isArray(p.blocks)) continue
    const [W, H] = sizes[page - 1]!
    const parts: { type: string; bbox: number[]; content: unknown; order: number; sub: number }[] = []
    for (const b of p.blocks) {
      if (!b || typeof b.type !== 'string') continue
      const order = b.index ?? parts.length
      if (COMPOSITE.has(b.type) && Array.isArray(b.content)) {
        // 图注跟着图：复合块里的几段按它自己的 index 排，整组按复合块的 index 排
        ;(b.content as MjSpan[])
          .filter((s) => s && typeof s.type === 'string')
          .sort((x, y) => (x.index ?? 0) - (y.index ?? 0))
          .forEach((s, k) => parts.push({ type: s.type!, bbox: s.bbox ?? b.bbox ?? [0, 0, 0, 0], content: s.content, order, sub: k }))
      } else parts.push({ type: b.type, bbox: b.bbox ?? [0, 0, 0, 0], content: b.content, order, sub: 0 })
    }
    parts.sort((a, b) => a.order - b.order || a.sub - b.sub)
    const out: PdfBlock[] = []
    for (const part of parts) {
      const kind = part.type in KIND ? KIND[part.type] : 'text'
      if (!kind) continue
      const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = part.bbox.map(Number)
      const text = kind === 'image' ? '' : kind === 'formula' ? latexOf(spansText(part.content)) : kind === 'table' ? spansText(part.content).trim() : tidy(spansText(part.content))
      if (kind !== 'image' && !text) continue
      out.push({ id: '', page, kind, text, x: x0 * W, y: y0 * H, w: Math.max(0, x1 - x0) * W, h: Math.max(0, y1 - y0) * H, by: 'mineru' })
    }
    pages[page - 1] = out.map((b, i) => ({ ...b, id: `p${page}-b${i + 1}` }))
  }
  return { pages, sizes }
}

// ---------------------------------------------------------------- 表格

export interface MineruCell {
  text: string
  colspan?: number
  rowspan?: number
  head?: true
}

const decode = (s: string) =>
  s
    .replace(/<br\s*\/?>/gi, '\n')
    // 上下标（10<sup>9</sup>、×<sup>2</sup>）写成行内公式，界面渲染成上下标，AI 读得懂
    .replace(/<sup>([^<$]{1,20})<\/sup>/gi, (_m, x: string) => `$^{${x.trim()}}$`)
    .replace(/<sub>([^<$]{1,20})<\/sub>/gi, (_m, x: string) => `$_{${x.trim()}}$`)
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .trim()

/**
 * MinerU 给的表格 HTML 拆成一行行格子（只认 tr、td、th 和 colspan、rowspan；别的标签和属性全丢）。
 * 界面拿它自己画 <table>，不把 HTML 原样塞进页面。认不出一行时返回空数组。
 */
export function tableRows(html: string): MineruCell[][] {
  const rows: MineruCell[][] = []
  for (const tr of html.matchAll(/<tr\b[^>]*>([\s\S]*?)(?=<tr\b|<\/tbody|<\/thead|<\/table|$)/gi)) {
    const cells: MineruCell[] = []
    for (const c of tr[1]!.matchAll(/<(td|th)\b([^>]*)>([\s\S]*?)(?:<\/\1>|(?=<t[dh]\b)|(?=<\/tr)|$)/gi)) {
      const attr = c[2] ?? ''
      const span = (name: string) => {
        const m = new RegExp(`${name}\\s*=\\s*["']?(\\d+)`, 'i').exec(attr)
        const v = m ? Math.min(50, Number(m[1])) : 1
        return v > 1 ? v : undefined
      }
      const colspan = span('colspan')
      const rowspan = span('rowspan')
      cells.push({ text: decode(c[3] ?? ''), ...(colspan ? { colspan } : {}), ...(rowspan ? { rowspan } : {}), ...(c[1]!.toLowerCase() === 'th' ? { head: true as const } : {}) })
    }
    if (cells.length) rows.push(cells)
  }
  return rows
}

/** 表格写成给 AI 看的字：一行一行，格子之间「 | 」 */
export function tableText(html: string): string {
  return tableRows(html)
    .map((r) => r.map((c) => c.text.replace(/\s*\n\s*/g, ' ')).join(' | '))
    .join('\n')
}

/** 表格写成 Markdown 表（双语笔记里用）；有合并格的写不成，返回 null（那就照原页裁图） */
export function tableToMarkdown(html: string): string | null {
  const rows = tableRows(html)
  if (!rows.length || rows.some((r) => r.some((c) => c.colspan || c.rowspan))) return null
  const cols = Math.max(...rows.map((r) => r.length))
  const cell = (s: string | undefined) => (s ?? '').replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|')
  const line = (r: MineruCell[]) => `| ${Array.from({ length: cols }, (_, i) => cell(r[i]?.text)).join(' | ')} |`
  return [line(rows[0]!), `|${' --- |'.repeat(cols)}`, ...rows.slice(1).map(line)].join('\n')
}

// ---------------------------------------------------------------- 换版面时，旧块编号对到新块

const overlap = (a: Pick<PdfBlock, 'x' | 'y' | 'w' | 'h'>, b: Pick<PdfBlock, 'x' | 'y' | 'w' | 'h'>) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

/**
 * pdf.js 拼的块换成 MinerU 的块时，旧编号（AI 已经在回答、会话里提过的 p5-b3）对到新块：
 * 同一页里和旧块重叠面积占旧块（或新块）比例最大的那块；图优先对图、表（AI 叫它「图」的东西）。重叠不到 20% 的不对。
 * 返回 旧编号 → 新编号（编号没变的不列）。
 */
export function remapBlockIds(oldPages: Record<number, PdfBlock[]> | PdfBlock[][], newPages: Record<number, PdfBlock[]> | PdfBlock[][]): Record<string, string> {
  const out: Record<string, string> = {}
  const get = (src: Record<number, PdfBlock[]> | PdfBlock[][], page: number) => (Array.isArray(src) ? src[page - 1] : src[page]) ?? []
  const pagesOf = (src: Record<number, PdfBlock[]> | PdfBlock[][]) => (Array.isArray(src) ? src.map((_, i) => i + 1) : Object.keys(src).map(Number))
  for (const page of pagesOf(oldPages)) {
    const news = get(newPages, page)
    for (const o of get(oldPages, page)) {
      const pool = o.kind === 'image' ? news.filter((n) => n.kind === 'image' || n.kind === 'table') : news
      let best: PdfBlock | null = null
      let score = 0
      for (const n of pool.length ? pool : news) {
        const a = overlap(o, n)
        if (!a) continue
        const s = Math.max(a / Math.max(1, o.w * o.h), a / Math.max(1, n.w * n.h))
        if (s > score) [best, score] = [n, s]
      }
      if (best && score >= 0.2 && best.id !== o.id) out[o.id] = best.id
    }
  }
  return out
}

// ---------------------------------------------------------------- 配图：用 MinerU 的图框

/**
 * 装了 MinerU 时笔记配图的框（figure-box 的取框层排在最前面）：这一页 MinerU 认出的图、表里，
 * 和 AI 回答给的框（整页比例）重叠最多的那一个；AI 没给框时用记笔记时 AI 挑的块；都没有就 null。
 * 框四周多留 pad 个页面单位；图注取紧跟着它的那块。
 */
export function mineruFigure(
  blocks: PdfBlock[],
  size: { w: number; h: number },
  hint: { rect?: [number, number, number, number] | null; block?: string | null },
  pad = 4,
): { rect: [number, number, number, number]; caption: string; block: string } | null {
  const figs = blocks.filter((b) => b.by === 'mineru' && (b.kind === 'image' || b.kind === 'table'))
  if (!figs.length) return null
  let pick: PdfBlock | null = null
  if (hint.rect) {
    const [x, y, w, h] = hint.rect
    const r = { x: x * size.w, y: y * size.h, w: w * size.w, h: h * size.h }
    let score = 0
    for (const f of figs) {
      const a = overlap(r, f)
      const s = Math.max(a / Math.max(1, r.w * r.h), a / Math.max(1, f.w * f.h))
      if (s > score) [pick, score] = [f, s]
    }
    if (score < 0.3) pick = null
  }
  if (!hint.rect && hint.block) pick = figs.find((f) => f.id === hint.block) ?? null
  if (!pick) return null
  const i = blocks.indexOf(pick)
  const cap = [blocks[i + 1], blocks[i - 1]].find((b) => b?.kind === 'caption')
  const x = Math.max(0, pick.x - pad)
  const y = Math.max(0, pick.y - pad)
  return {
    rect: [x / size.w, y / size.h, Math.min(size.w - x, pick.w + pad * 2) / size.w, Math.min(size.h - y, pick.h + pad * 2) / size.h],
    caption: cap ? cap.text.replace(/\s+/g, ' ').slice(0, 40) : '',
    block: pick.id,
  }
}
