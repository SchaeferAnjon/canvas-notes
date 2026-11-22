/**
 * 测试用的 PDF：几页英文讲义（标题、正文、有一页带一张图），手写 PDF 结构，不依赖别的库。
 * 字用 PDF 自带的 Helvetica / Times，图是一张渐变的 RGB 图片（FlateDecode）。
 */
import { deflateSync } from 'node:zlib'

export interface FakePage {
  title: string
  lines: string[]
  /** 这一页画一张图（页面坐标，左下角量） */
  image?: { x: number; y: number; w: number; h: number }
  /** 行距（默认 20，正文连成一段；30 以上每行自成一段） */
  lineGap?: number
  /** 页面底下再画这么多个小色块（画起来慢的「重」页，像图多的课件） */
  heavy?: number
}

const esc = (s: string) => s.replace(/[\\()]/g, (c) => '\\' + c)

/** outline：带书签（PDF 自己的目录），每页一条，标题就是这一页的大标题 */
export function lecturePdf(pages: FakePage[], o: { outline?: boolean } = {}): Buffer {
  const W = 612
  const H = 792
  const objs: (string | Buffer)[] = []
  const add = (o: string | Buffer) => (objs.push(o), objs.length)
  const catalog = add('')
  const pagesObj = add('')
  const helv = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
  const times = add('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>')
  // 64×48 的渐变图
  const iw = 64
  const ih = 48
  const px = Buffer.alloc(iw * ih * 3)
  for (let y = 0; y < ih; y++)
    for (let x = 0; x < iw; x++) {
      const i = (y * iw + x) * 3
      px[i] = 40 + x * 3
      px[i + 1] = 90 + y * 2
      px[i + 2] = 200
    }
  const imgData = deflateSync(px)
  const img = add(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${iw} /Height ${ih} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${imgData.length} >>\nstream\n`), imgData, Buffer.from('\nendstream')]))
  const kids: number[] = []
  pages.forEach((p, i) => {
    let s = `BT /F1 26 Tf 72 ${H - 96} Td (${esc(p.title)}) Tj ET\n`
    p.lines.forEach((l, k) => {
      s += `BT /F2 13 Tf 72 ${H - 150 - k * (p.lineGap ?? 20)} Td (${esc(l)}) Tj ET\n`
    })
    for (let k = 0; k < (p.heavy ?? 0); k++) s += `${(k % 7) / 7} ${(k % 5) / 5} 0.8 rg ${(k * 37) % 560 + 20} ${(k * 53) % 300 + 60} 6 6 re f\n`
    if (p.image) s += `q ${p.image.w} 0 0 ${p.image.h} ${p.image.x} ${p.image.y} cm /Im1 Do Q\n`
    s += `BT /F2 10 Tf 72 40 Td (Linear Algebra - Lecture 3) Tj ET\nBT /F2 10 Tf ${W - 110} 40 Td (${i + 1} / ${pages.length}) Tj ET\n`
    const content = add(`<< /Length ${Buffer.byteLength(s, 'latin1')} >>\nstream\n${s}endstream`)
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${helv} 0 R /F2 ${times} 0 R >> /XObject << /Im1 ${img} 0 R >> >> /Contents ${content} 0 R >>`))
  })
  let outlines = 0
  if (o.outline) {
    outlines = add('')
    const items = kids.map(() => add(''))
    items.forEach((it, i) => {
      const prev = i > 0 ? ` /Prev ${items[i - 1]} 0 R` : ''
      const next = i < items.length - 1 ? ` /Next ${items[i + 1]} 0 R` : ''
      objs[it - 1] = `<< /Title (${esc(pages[i]!.title)}) /Parent ${outlines} 0 R${prev}${next} /Dest [${kids[i]} 0 R /XYZ 0 ${H} 0] >>`
    })
    objs[outlines - 1] = `<< /Type /Outlines /First ${items[0]} 0 R /Last ${items[items.length - 1]} 0 R /Count ${items.length} >>`
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R${outlines ? ` /Outlines ${outlines} 0 R` : ''} >>`
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')]
  const offsets: number[] = []
  let pos = parts[0]!.length
  objs.forEach((o, i) => {
    offsets.push(pos)
    const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), typeof o === 'string' ? Buffer.from(o, 'latin1') : o, Buffer.from('\nendobj\n')])
    parts.push(b)
    pos += b.length
  })
  const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${pos}\n%%EOF\n`
  parts.push(Buffer.from(xref, 'latin1'))
  return Buffer.concat(parts)
}

/** 第 3 讲：5 页，第 3 页带一张图 */
export const LECTURE = lecturePdf([
  { title: 'Lecture 3 Linear Maps', lines: ['A linear map sends sums to sums and scalings to scalings.', 'We write T: V -> W for a map between vector spaces.'] },
  { title: '3.2 Definition', lines: ['T(u + v) = T(u) + T(v) for all u and v.', 'T(c u) = c T(u) for every scalar c.', 'Both rules together keep linear combinations.'] },
  { title: 'Example 3.4 Rotation', lines: ['Rotate the plane counter-clockwise by an angle theta.', 'Column 1 of R is the rotated e1, column 2 the rotated e2.'], image: { x: 300, y: 380, w: 240, h: 180 } },
  { title: '3.5 Kernel and image', lines: ['The kernel is the set of vectors sent to zero.', 'The image is everything T can reach.'] },
  { title: '3.6 Summary', lines: ['A matrix is a linear map written in a basis.', 'Its columns say where the basis vectors go.'] },
])

/** 正文、公式（单独一段）、图 */
export const ROTATION = lecturePdf([
  { title: 'Lecture 3 Linear Maps', lines: ['A linear map sends sums to sums and scalings to scalings.', 'We write T for a map between vector spaces.'] },
  {
    title: 'Example 3.4 Rotation',
    lines: ['Rotate the plane counter-clockwise by an angle t.', "x' = x cos t - y sin t", 'Column 1 of R is the rotated e1, column 2 the rotated e2.'],
    lineGap: 40,
    image: { x: 300, y: 300, w: 240, h: 180 },
  },
  { title: '3.5 Kernel and image', lines: ['The kernel is the set of vectors sent to zero.', 'The image is everything T can reach.'] },
])
