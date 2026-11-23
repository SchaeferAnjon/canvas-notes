/**
 * 量字：放进一个看不见的、和节点同样式的框里量（同一套 CSS，含 body 的 text-autospace 中西文间距）。
 * 以前用 canvas 的 measureText 量，它不算中西文间距，「1. 主题1」量出 45.5、画出来 47.1，节点就截成「1. 主…」。
 * 导出图片时一行行的字也从这里取（和画出来的断在同一个地方）。
 */
import type { Level, Measure } from '../../shared/mindmap-layout'

let probe: { box: HTMLDivElement; t: HTMLSpanElement } | null = null
const sized = new Map<string, { w: number; h: number }>()

function probeOf(level: Level, maxW: number, text: string) {
  if (!probe) {
    const box = document.createElement('div')
    box.setAttribute('aria-hidden', 'true')
    box.style.cssText = 'position:absolute;left:-10000px;top:0;visibility:hidden;pointer-events:none;contain:layout style;padding:0;width:auto;height:auto;display:block'
    const t = document.createElement('span')
    t.className = 't'
    t.style.display = 'inline-block'
    box.append(t)
    document.body.append(box)
    probe = { box, t }
  }
  probe.box.className = `mm-node ${level}`
  probe.t.style.maxWidth = `${maxW}px`
  probe.t.textContent = text || ' '
  return probe.t
}

export const measure: Measure = (text, level, maxW) => {
  const k = `${level}\u0000${maxW}\u0000${text}`
  const hit = sized.get(k)
  if (hit) return hit
  if (sized.size > 4000) sized.clear()
  const t = probeOf(level, maxW, text)
  const r = t.getBoundingClientRect()
  // 换了行时框是 maxW 宽：取最长那一行的宽，节点右边不空出一截（每行都放得下，断行的位置不变）
  const range = document.createRange()
  range.selectNodeContents(t)
  const lines = [...range.getClientRects()]
  const w = lines.length ? Math.max(...lines.map((l) => l.right)) - Math.min(...lines.map((l) => l.left)) : r.width
  const out = { w: Math.min(r.width, w), h: r.height }
  sized.set(k, out)
  return out
}

/** 一段字在这一层、这么宽里断成哪几行（导出时一行行写进 SVG，和画出来的断在同一个地方） */
export function lineBreaks(text: string, level: Level, maxW: number): string[] {
  if (!text) return ['']
  const t = probeOf(level, maxW, text)
  const node = t.firstChild
  if (!node) return [text]
  const range = document.createRange()
  const out: string[] = []
  let top = -Infinity
  let cur = ''
  for (let i = 0; i < text.length; i++) {
    // 代理对（emoji 之类）一起量
    const step = text.codePointAt(i)! > 0xffff ? 2 : 1
    range.setStart(node, i)
    range.setEnd(node, i + step)
    const r = range.getClientRects()[0]
    const ch = text.slice(i, i + step)
    if (r && r.top > top + 2 && cur) {
      out.push(cur.trimEnd())
      cur = ''
    }
    if (r) top = Math.max(top, r.top)
    cur += ch
    i += step - 1
  }
  if (cur) out.push(cur.trimEnd())
  return out.length ? out : [text]
}
