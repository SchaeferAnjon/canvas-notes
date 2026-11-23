/**
 * 导出导图（第二批 ④⑫）：照现在的布局、配色、骨架、收起的样子单独画一遍整张图，不带选中的外圈、加号、折叠圆点。
 * - SVG：把同一份画成矢量（字用系统字体，一行行断在和画出来一样的地方）；图片、原照片嵌在里面。
 * - PNG：把这份 SVG 画到 1 / 2 / 3 倍的画布上再存。底色跟现在一样 / 白底（照浅色天青的颜色画）/ 透明。
 * - PDF：主进程拿这份 SVG 打印成 PDF，一页放下（纸跟导图一样大，或 A4 横放 / 竖放）。
 * - OPML：纯文字大纲，备注写进 _note（packages/format 的 mindmapOpml）。
 * 导出不改这篇文件。
 */
import { type MapNode, mapSegments, mapShown, nodeAt } from '@cn/format'
import { CAPTION_H, type Level, type MapLayout, type NodeBox, wireOf } from '../../shared/mindmap-layout'
import { imageSrc } from '../md-widgets'
import { lineBreaks } from './map-measure'

export interface ExportLook {
  /** 底色：跟现在一样 / 白底 / 透明（PDF 没有透明） */
  bg: 'now' | 'white' | 'clear'
  photo: boolean
}

type Colors = Record<'board' | 'card' | 'pop' | 'win' | 't1' | 't2' | 't3' | 'line2' | 'fill' | 'wire' | 'solid' | 'solidT' | 'accT' | 'font', string> & { b: string[] }

/** 读一套主题的颜色（白底时照浅色天青读：在一个 data-skin="sky" 的小块上读） */
function colorsOf(from: HTMLElement, light: boolean): Colors {
  let el = from
  let tmp: HTMLElement | null = null
  if (light) {
    tmp = document.createElement('div')
    tmp.dataset.skin = 'sky'
    tmp.style.cssText = 'position:absolute;left:-9999px;top:0'
    document.body.append(tmp)
    el = tmp
  }
  const cs = getComputedStyle(el)
  const v = (k: string) => cs.getPropertyValue(k).trim()
  const font = getComputedStyle(from).fontFamily || v('--sans')
  const out: Colors = {
    board: v('--board'),
    card: v('--card'),
    pop: v('--pop'),
    win: v('--win'),
    t1: v('--t1'),
    t2: v('--t2'),
    t3: v('--t3'),
    line2: v('--line2'),
    fill: v('--fill'),
    wire: v('--wire'),
    solid: v('--solid'),
    solidT: v('--solid-t'),
    accT: v('--acc-t'),
    font,
    b: [0, 1, 2, 3, 4, 5].map((i) => v(`--mm-b${i}`)),
  }
  tmp?.remove()
  return out
}

/** 颜色读成 [r, g, b, a]（借 canvas 认颜色的写法） */
let ctx2d: CanvasRenderingContext2D | null = null
function rgba(c: string): [number, number, number, number] {
  ctx2d ??= document.createElement('canvas').getContext('2d')!
  ctx2d.fillStyle = '#000'
  ctx2d.fillStyle = c
  const s = ctx2d.fillStyle
  if (s.startsWith('#')) return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16), 1]
  const m = /rgba?\(([^)]+)\)/.exec(s)
  const n = m ? m[1]!.split(',').map((x) => parseFloat(x)) : [0, 0, 0, 1]
  return [n[0]!, n[1]!, n[2]!, n[3] ?? 1]
}
/** a 占 k、b 占 1-k 混在一起（color-mix 在 SVG 属性里不保险，自己算） */
function mix(a: string, k: number, b: string): string {
  const x = rgba(a)
  const y = rgba(b)
  const c = [0, 1, 2].map((i) => Math.round(x[i]! * k + y[i]! * (1 - k)))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** 图读成 data: 网址（SVG 当图片画时不去别处拿图）：库里的图主进程读，网上的照样 fetch */
async function dataUrl(src: string): Promise<string | null> {
  if (src.startsWith('data:')) return src
  const local = /^cn-file:\/\/vault\/(.+)$/.exec(src)
  if (local) return window.cnMap.imageData(local[1]!.split('/').map(decodeURIComponent).join('/'))
  try {
    const r = await fetch(src)
    if (!r.ok) return null
    const b = await r.blob()
    return await new Promise((ok) => {
      const f = new FileReader()
      f.onload = () => ok(String(f.result))
      f.onerror = () => ok(null)
      f.readAsDataURL(b)
    })
  } catch {
    // 网上的图拿不到（没网、对方不让）：导出时这张不画
    return null
  }
}

const FONT: Record<Level, { size: number; weight: number }> = { c: { size: 15, weight: 600 }, l1: { size: 13, weight: 500 }, l2: { size: 13, weight: 400 } }

/** 字左边离框多远（mindmap.css 里的内边距） */
const padLeft = (b: NodeBox) => (b.level === 'c' ? 18 : b.level === 'l1' && !b.ul ? 14 : b.boxed ? 8 : 2)

/**
 * 画成一份 SVG。L 是要导出的那份排版（只导出一枝时是只看那一枝的排版），palette、photo 照现在的；
 * rels 是这份排版里画得出来的联系线（和 L.rels 一一对应的字）
 */
export async function mapSvg(opts: {
  L: MapLayout
  roots: MapNode[]
  notePath: string
  palette: 'theme' | 'rainbow' | 'ink'
  look: ExportLook
  photo: { src: string; caption: string } | null
  relLabels: (string | undefined)[]
  host: HTMLElement
}): Promise<{ svg: string; w: number; h: number }> {
  const { L, look } = opts
  const C = colorsOf(opts.host, look.bg === 'white')
  const pal = opts.palette
  const bc = (b: NodeBox) => (b.branch !== undefined ? C.b[b.branch]! : C.wire)
  const parts: string[] = []
  const box = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity }
  const grow = (x1: number, y1: number, x2: number, y2: number) => {
    box.x1 = Math.min(box.x1, x1)
    box.y1 = Math.min(box.y1, y1)
    box.x2 = Math.max(box.x2, x2)
    box.y2 = Math.max(box.y2, y2)
  }
  const text = (x: number, y: number, s: string, size: number, weight: number, fill: string, anchor = 'start') =>
    `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" font-family="${esc(C.font)}" dominant-baseline="middle" text-anchor="${anchor}">${esc(s)}</text>`

  // 外框（最底下）
  for (const f of L.frames) {
    parts.push(`<rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="12" fill="${mix(C.t1, 0.05, look.bg === 'clear' ? C.board : look.bg === 'white' ? '#ffffff' : C.board)}" stroke="${C.line2}"/>`)
    grow(f.x, f.y, f.x + f.w, f.y + f.h)
    if (f.title) {
      const w = Math.ceil(f.title.length * 12 + 16)
      parts.push(`<rect x="${f.x + 12}" y="${f.y - 10}" width="${w}" height="20" rx="6" fill="${C.pop}" stroke="${C.line2}"/>`)
      parts.push(text(f.x + 20, f.y, f.title, 12, 400, C.t2))
      grow(f.x, f.y - 10, f.x + 12 + w, f.y + 10)
    }
  }

  // 连线、脊骨、时间线
  const lineW = pal === 'rainbow' ? 2 : pal === 'ink' ? 1.2 : 1.2
  for (const w of L.wires) {
    const a = L.byKey[w.from]
    const b = L.byKey[w.to]
    if (!a || !b) continue
    const d = wireOf(L.kind, a, b)
    if (!d) continue
    const stroke = pal === 'rainbow' ? bc(b) : pal === 'ink' ? C.t2 : C.wire
    parts.push(`<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${lineW}"/>`)
  }
  for (const l of L.lines) {
    parts.push(`<path d="M${l.x1} ${l.y1}L${l.x2} ${l.y2}" fill="none" stroke="${pal === 'ink' ? C.t2 : C.wire}" stroke-width="2.5"/>`)
    if (l.arrow) parts.push(`<path d="M${l.x2 - 8} ${l.y2 - 5}L${l.x2} ${l.y2}L${l.x2 - 8} ${l.y2 + 5}" fill="none" stroke="${pal === 'ink' ? C.t2 : C.wire}" stroke-width="2"/>`)
    grow(Math.min(l.x1, l.x2), l.y1 - 5, Math.max(l.x1, l.x2), l.y2 + 5)
  }

  // 概要：括号 + 一句话
  for (const s of L.sums) {
    parts.push(`<path d="${s.bracket}" fill="none" stroke="${C.t3}" stroke-width="1.5"/>`)
    const lines = lineBreaks(s.text, 'l2', s.w)
    const lh = 13 * 1.4
    const top = s.y + (s.h - lines.length * lh) / 2
    lines.forEach((ln, i) => parts.push(text(s.x + 2, top + lh * (i + 0.5), ln, 13, 500, C.t1)))
    parts.push(`<path d="M${s.x} ${s.y + s.h}H${s.x + s.w}" stroke="${C.wire}" stroke-width="1.2"/>`)
    grow(s.x - 40, s.y, s.x + s.w, s.y + s.h)
  }

  // 原照片卡
  if (look.photo && L.photo && opts.photo) {
    const p = L.photo
    const img = await dataUrl(opts.photo.src)
    parts.push(`<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="10" fill="${C.card}" stroke="${C.line2}"/>`)
    if (img) parts.push(`<image href="${img}" x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h - CAPTION_H}" preserveAspectRatio="xMidYMid slice"/>`)
    parts.push(text(p.x + 12, p.y + p.h - CAPTION_H / 2, opts.photo.caption, 12, 400, C.t2))
    grow(p.x, p.y, p.x + p.w, p.y + p.h)
  }

  // 主题
  for (const b of L.nodes) {
    const n = nodeAt(opts.roots, b.key.split('.').map(Number))
    if (!n) continue
    grow(b.x, b.y, b.x + b.w, b.y + b.h)
    const card = b.level === 'c' || (b.level === 'l1' && !b.ul)
    let fg = C.t1
    if (card || b.boxed) {
      let fill = C.card
      let stroke = C.line2
      let sw = 1
      if (pal === 'rainbow' && b.level === 'c') ((fill = C.solid), (stroke = 'none'), (fg = C.solidT))
      else if (pal === 'rainbow' && b.branch !== undefined) ((fill = mix(bc(b), b.boxed ? 0.08 : 0.16, C.card)), (stroke = mix(bc(b), b.boxed ? 0.55 : 0.5, C.card)))
      else if (pal === 'ink') ((fill = C.win), (stroke = C.t1), (sw = 1.5))
      parts.push(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${b.boxed ? 6 : 10}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`)
    } else {
      // 下划线主题：一道线在下面
      const stroke = pal === 'rainbow' && b.branch !== undefined ? bc(b) : pal === 'ink' ? C.t1 : C.wire
      parts.push(`<path d="M${b.x} ${b.y + b.h}H${b.x + b.w}" stroke="${stroke}" stroke-width="${b.ul ? 1.5 : 1.2}"/>`)
    }
    const f = FONT[b.level]
    const lh = f.size * 1.4
    const shown = mapShown(n.text)
    const lines = shown ? lineBreaks(shown, b.level, b.w - (b.level === 'c' ? 36 : b.level === 'l1' && !b.ul ? 28 : b.boxed ? 18 : 8)) : []
    const th = lines.length * lh
    const imgH = b.img ? b.img.h + 10 : 0
    // 有图的主题：图在字上面；下划线主题字贴着线，别的上下居中
    const under = b.level === 'l2' && !b.boxed
    const top0 = under && b.img ? b.y + b.h - imgH - th - 1 : b.y + (b.h - imgH - th) / 2
    if (b.img && n.img) {
      const img = await dataUrl(imageSrc(opts.notePath, n.img.src))
      if (img) parts.push(`<image href="${img}" x="${b.x + padLeft(b)}" y="${top0 + 4}" width="${b.img.w}" height="${b.img.h}" preserveAspectRatio="xMidYMid slice"/>`)
    }
    const linked = mapSegments(n.text).some((s) => s.wiki !== undefined || s.url !== undefined)
    const x = b.boxed ? b.x + b.w / 2 : b.x + padLeft(b)
    lines.forEach((ln, i) => parts.push(text(x, top0 + imgH + lh * (i + 0.5), ln, f.size, f.weight, linked && pal !== 'ink' && fg === C.t1 ? C.accT : fg, b.boxed ? 'middle' : 'start')))
  }

  // 联系线（在主题上面）
  L.rels.forEach((g, i) => {
    if (!g) return
    parts.push(`<path d="${g.d}" fill="none" stroke="${C.t3}" stroke-width="1.5" stroke-dasharray="5 4"/>`)
    parts.push(`<path d="${g.ah}" fill="${C.t3}"/>`)
    const label = opts.relLabels[i]
    if (label) {
      const w = Math.ceil(label.length * 12 + 12)
      parts.push(`<rect x="${g.mx - w / 2}" y="${g.my - 10}" width="${w}" height="20" rx="4" fill="${look.bg === 'white' ? '#ffffff' : C.board}"/>`)
      parts.push(text(g.mx, g.my, label, 12, 400, C.t2, 'middle'))
    }
    grow(g.mx - 60, g.my - 20, g.right - 90, g.bottom - 20)
  })

  const m = 24
  const x0 = Math.floor(box.x1 - m)
  const y0 = Math.floor(box.y1 - m)
  const w = Math.ceil(box.x2 + m) - x0
  const h = Math.ceil(box.y2 + m) - y0
  const bg = look.bg === 'clear' ? '' : `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="${look.bg === 'white' ? '#ffffff' : C.board}"/>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${x0} ${y0} ${w} ${h}">${bg}${parts.join('')}</svg>`
  return { svg, w, h }
}

/** SVG 画到 scale 倍的画布上，存成 PNG 的字节 */
export async function svgToPng(svg: string, w: number, h: number, scale: number): Promise<Uint8Array> {
  const img = new Image()
  img.decoding = 'sync'
  await new Promise<void>((ok, bad) => {
    img.onload = () => ok()
    img.onerror = () => bad(new Error('画不出这张图'))
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  })
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(w * scale)
  canvas.height = Math.round(h * scale)
  const g = canvas.getContext('2d')!
  g.scale(scale, scale)
  g.drawImage(img, 0, 0, w, h)
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/png'))
  if (!blob) throw new Error('存不成 PNG')
  return new Uint8Array(await blob.arrayBuffer())
}

/** 只导出一枝时的那一枝（选着一个主题、或者正在只看这一枝） */
export const branchLabel = (roots: MapNode[], key: string | null) => (key ? mapShown(nodeAt(roots, key.split('.').map(Number))?.text ?? '') : '')

