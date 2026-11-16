/**
 * PDF 一页的文字项（pdf.js getTextContent 的结果）拼成段落块：AI 读全文、以后的翻译和搜索都用它。
 * 只是纯计算，不依赖 pdf.js；坐标一律是页面单位、从页面左上角量。
 *
 * 拼行、栏序、分段的办法照 ParaRead（~/Documents/Projects/scholar-reader 的 src/main/pdftext.ts，同一个作者的代码）：
 * 同一基线的字拼成行，两栏的页按「通栏标题 → 左栏 → 右栏 → 通栏结尾」排，行距明显变大或首行缩进就另起一段，
 * 字号明显大于正文的短行当标题。
 */

export interface PdfTextItem {
  str: string
  x: number
  /** 基线到页面顶部的距离 */
  y: number
  w: number
  /** 字号 */
  h: number
}

/** 页面上的一张图（pdf.js 运算符列表里画图片的那几步），页面单位、左上角量 */
export interface PdfImageBox {
  x: number
  y: number
  w: number
  h: number
}

export interface PdfPageText {
  width: number
  height: number
  items: PdfTextItem[]
  images?: PdfImageBox[]
}

export interface PdfLine {
  text: string
  x: number
  y: number
  w: number
  h: number
}

export interface PdfBlock {
  /** 「p5-b3」：第 5 页第 3 块，AI 回答里拿它指图 */
  id: string
  page: number
  kind: 'heading' | 'text' | 'image'
  text: string
  /** 外框：左、上、宽、高（页面单位，左上角量） */
  x: number
  y: number
  w: number
  h: number
}

/** 同一基线的文字项拼成行；行内按 x 排序，间距大于字宽的一小截补空格 */
export function itemsToLines(items: PdfTextItem[]): PdfLine[] {
  const sorted = items.filter((i) => i.str).sort((a, b) => a.y - b.y || a.x - b.x)
  const lines: (PdfLine & { main: number })[] = []
  for (const it of sorted) {
    const tol = Math.max(2, it.h * 0.4)
    const line = lines.find(
      (l) =>
        Math.abs(l.y - it.y) <= tol &&
        // 字号差太多的不拼（首字下沉的大写字母会把旁边的行吞掉）
        Math.abs(l.h - it.h) < Math.max(l.h, it.h) * 0.35 &&
        ((it.x >= l.x + l.w - it.h * 0.5 && it.x - (l.x + l.w) < it.h * 0.9) || (it.x + it.w <= l.x && l.x - (it.x + it.w) < it.h * 0.9)),
    )
    if (line) {
      const gap = it.x - (line.x + line.w)
      if (it.x >= line.x + line.w - 1) {
        line.text += (gap > it.h * 0.15 && !line.text.endsWith(' ') && !it.str.startsWith(' ') ? ' ' : '') + it.str
        line.w = Math.max(line.w, it.x + it.w - line.x)
      } else {
        line.text = it.str + ' ' + line.text
        line.w = line.x + line.w - it.x
        line.x = it.x
      }
      // 行高取字数最多的那一项，上下标和特殊符号不把整行撑大
      if (it.str.length > line.main) {
        line.main = it.str.length
        line.h = it.h
      }
    } else lines.push({ text: it.str, x: it.x, y: it.y, w: it.w, h: it.h, main: it.str.length })
  }
  return lines.map(({ main: _m, ...l }) => ({ ...l, text: l.text.replace(/\s+/g, ' ').trim() })).filter((l) => l.text)
}

/** 阅读顺序：通栏行（标题、摘要）在前，之后左栏、右栏；按栏内 y 排 */
export function orderedLines(p: PdfPageText): PdfLine[] {
  const lines = itemsToLines(p.items)
  const mid = p.width / 2
  const isFull = (l: PdfLine): boolean => l.x < mid - 20 && l.x + l.w > mid + 20
  const twoCol = lines.filter((l) => !isFull(l)).length > lines.length * 0.5 && lines.some((l) => !isFull(l) && l.x >= mid)
  if (!twoCol) return lines.sort((a, b) => a.y - b.y || a.x - b.x)
  const full = lines.filter(isFull)
  // 页眉页码这类短行不算栏的开始
  const colYs = lines.filter((l) => !isFull(l) && l.w > p.width * 0.25).map((l) => l.y)
  const firstColY = colYs.length ? Math.min(...colYs) : 0
  const head = full.filter((l) => l.y < firstColY)
  const tail = full.filter((l) => l.y >= firstColY)
  const left = lines.filter((l) => !isFull(l) && l.x < mid).sort((a, b) => a.y - b.y)
  const right = lines.filter((l) => !isFull(l) && l.x >= mid).sort((a, b) => a.y - b.y)
  return [...head.sort((a, b) => a.y - b.y), ...left, ...right, ...tail.sort((a, b) => a.y - b.y)]
}

/** 正文字号：所有字出现最多的那个字号 */
export function bodySize(pages: PdfPageText[]): number {
  const c = new Map<number, number>()
  for (const p of pages)
    for (const i of p.items) {
      if (!i.str.trim()) continue
      const k = Math.round(i.h * 2) / 2
      c.set(k, (c.get(k) ?? 0) + i.str.length)
    }
  let best = 10
  let n = 0
  for (const [k, v] of c) if (v > n) [best, n] = [k, v]
  return best
}

function joinLines(lines: string[]): string {
  let s = ''
  for (const l of lines) {
    if (!s) s = l
    else if (/[A-Za-z]-$/.test(s)) s = s.slice(0, -1) + l
    // 中文和中文之间换行不补空格
    else if (/[　-鿿＀-￯]$/.test(s) && /^[　-鿿＀-￯]/.test(l)) s += l
    else s += ' ' + l
  }
  return s
}

/** 一页拼成段落块；body 是整份 PDF 的正文字号（不给就按这一页算） */
export function pageBlocks(p: PdfPageText, page: number, body = bodySize([p])): PdfBlock[] {
  const out: PdfBlock[] = []
  const lines = orderedLines(p)
  let para: PdfLine[] = []
  let kind: 'heading' | 'text' = 'text'
  const flush = () => {
    if (!para.length) return
    const x = Math.min(...para.map((l) => l.x))
    const top = Math.min(...para.map((l) => l.y - l.h))
    const right = Math.max(...para.map((l) => l.x + l.w))
    const bottom = Math.max(...para.map((l) => l.y + l.h * 0.25))
    out.push({ id: '', page, kind, text: joinLines(para.map((l) => l.text)), x, y: top, w: right - x, h: bottom - top })
    para = []
    kind = 'text'
  }
  let prev: PdfLine | null = null
  for (const l of lines) {
    const startsUpper = /^[A-Z0-9一-鿿第]/.test(l.text)
    const continues = /[a-z,，、-]$/.test(l.text)
    const numbered = /^([IVX]+\.|\d+(\.\d+)*\.?)\s+\S/.test(l.text) && l.text.length < 70 && l.h >= body * 0.95
    const isHeading = startsUpper && l.text.length < 90 && ((l.h > body * 1.18 && (l.text.length < 60 || !continues)) || numbered)
    if (isHeading) {
      // 连着几行一样大的字（多行标题）拼成一个标题
      const sameHeading = kind === 'heading' && prev && Math.abs(prev.h - l.h) < 0.5 && l.y - prev.y < l.h * 2
      if (!sameHeading) flush()
      kind = 'heading'
      para.push(l)
      prev = l
      continue
    }
    if (kind === 'heading') flush()
    if (prev && para.length) {
      const gap = l.y - prev.y
      const newCol = gap < 0 || Math.abs(l.x - prev.x) > p.width * 0.3
      const bigGap = gap > Math.max(prev.h, l.h) * 1.7
      const indent = l.x - prev.x > l.h * 0.8 && l.x - prev.x < l.h * 3
      if (bigGap || newCol || indent) flush()
    }
    para.push(l)
    prev = l
  }
  flush()
  // 太小的图（项目符号、logo、装饰线）不算
  for (const im of p.images ?? []) {
    if (im.w < p.width * 0.08 || im.h < p.height * 0.05) continue
    out.push({ id: '', page, kind: 'image', text: '', x: im.x, y: im.y, w: im.w, h: im.h })
  }
  // 图按上下位置插回文字中间
  const sorted = out.filter((b) => b.kind !== 'image')
  for (const im of out.filter((b) => b.kind === 'image')) {
    const at = sorted.findIndex((b) => b.y > im.y)
    sorted.splice(at === -1 ? sorted.length : at, 0, im)
  }
  return sorted.map((b, i) => ({ ...b, id: `p${page}-b${i + 1}` }))
}

/** 整份 PDF：每页的块，正文字号按整份算 */
export function documentBlocks(pages: PdfPageText[]): PdfBlock[][] {
  const body = bodySize(pages)
  return pages.map((p, i) => pageBlocks(p, i + 1, body))
}

/** 一页的块写成给 AI 看的文字：标题前加 #，图写成「[图 p5-b3]」 */
export function blocksText(blocks: PdfBlock[]): string {
  return blocks.map((b) => (b.kind === 'heading' ? `# ${b.text}` : b.kind === 'image' ? `[图 ${b.id}]` : b.text)).join('\n')
}

/** 段落的指纹（翻译缓存按它对上）：去掉空白后的 FNV-1a */
export function blockHash(text: string): string {
  let h = 0x811c9dc5
  for (const ch of text.replace(/\s+/g, '')) {
    h ^= ch.codePointAt(0)!
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}
