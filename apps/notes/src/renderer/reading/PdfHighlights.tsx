/**
 * PDF 纸面上划的线（ParaRead 联动，设计 20-pararead联动「划线颜色带含义」）：照配对笔记里每一条的页码和原文，在 pdf.js 的文字层里找字画，
 * 颜色是含义的颜色（纸是白的，深浅主题通用，正片叠底）；看不懂画红色波浪线、不铺底。笔记里记的框只做加速（几处同样的字取离框最近的），
 * PDF 换了版本找不到字时退回画那个框（浅一点，右栏那一条标「位置可能不准」）。
 * 找字和画都只看这一页的文字层：文字层画好了（PageView 报 textSeq）才找，找到的位置记成这一页上的比例，缩放时不用重找。
 */
import { CONFUSED, type Highlight, type HlKind, hlPaper, HL_DOT, type Rect } from '@cn/format'
import { useLayoutEffect, useState } from 'react'

/** 一条线在这一页上画在哪几块（比例）；loose：没找到字，画的是笔记里记的框 */
export interface HlBox {
  rects: Rect[]
  loose: boolean
}

/** 文字层里找这段字：空白一律不算（选字时 toString 的换行、空格和文字层不一定一样），几处一样的取离 near 最近的 */
export function locateText(pageEl: HTMLElement, text: string, near?: Rect): Rect[] | null {
  const layer = pageEl.querySelector('.textLayer')
  if (!layer) return null
  const want = text.replace(/\s+/g, '')
  if (want.length < 2) return null
  let hay = ''
  const at: [Text, number][] = []
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const s = n.data
    for (let i = 0; i < s.length; i++) {
      if (/\s/.test(s[i]!)) continue
      hay += s[i]
      at.push([n, i])
    }
  }
  const box = pageEl.getBoundingClientRect()
  if (!box.width || !box.height) return null
  let best: Rect[] | null = null
  let bestD = Infinity
  for (let k = hay.indexOf(want); k >= 0; k = hay.indexOf(want, k + 1)) {
    const [sn, so] = at[k]!
    const [en, eo] = at[k + want.length - 1]!
    const range = document.createRange()
    range.setStart(sn, so)
    range.setEnd(en, eo + 1)
    const rects = [...range.getClientRects()]
      .filter((r) => r.width > 0.5 && r.height > 0.5)
      .map((r): Rect => [(r.left - box.left) / box.width, (r.top - box.top) / box.height, r.width / box.width, r.height / box.height])
    if (!rects.length) continue
    const d = near ? Math.hypot(rects[0]![0] - near[0], rects[0]![1] - near[1]) : 0
    if (d < bestD) {
      best = rects
      bestD = d
    }
    if (!near) break
  }
  return best
}

const pct = (r: Rect) => ({ left: `${r[0] * 100}%`, top: `${r[1] * 100}%`, width: `${r[2] * 100}%`, height: `${r[3] * 100}%` })

/** 一页上的线：页面的文字层画好了才找字（textSeq 变了重找），找到的记着 */
export function PageHighlights(p: { page: number; hls: Highlight[]; kinds: HlKind[]; textSeq: number; pageEl(): HTMLElement | null; onBoxes?(page: number, boxes: Record<string, HlBox>): void }) {
  const [boxes, setBoxes] = useState<Record<string, HlBox>>({})
  const sig = p.hls.map((h) => `${h.id}:${h.key}:${h.text}`).join('\n')
  useLayoutEffect(() => {
    const el = p.pageEl()
    if (!el || !el.querySelector('.textLayer span')) return
    const next: Record<string, HlBox> = {}
    for (const h of p.hls) {
      const found = locateText(el, h.text, h.rect)
      if (found) next[h.id] = { rects: found, loose: false }
      else if (h.rect) next[h.id] = { rects: [h.rect], loose: true }
    }
    setBoxes(next)
    p.onBoxes?.(p.page, next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, p.textSeq])
  const color = (key: string) => p.kinds.find((k) => k.key === key)?.color ?? 'gray'
  return (
    <>
      {p.hls.map((h) =>
        (boxes[h.id]?.rects ?? []).map((r, i) => (
          <div
            key={`${h.id}-${i}`}
            className={'hl' + (h.key === CONFUSED ? ' wavy' : '') + (boxes[h.id]!.loose ? ' loose' : '')}
            data-hl={h.id}
            data-k={h.key}
            data-testid="pdf-hl"
            style={{ ...pct(r), ['--hl' as string]: h.key === CONFUSED ? HL_DOT[color(h.key)] : hlPaper(color(h.key)) }}
          />
        )),
      )}
    </>
  )
}
