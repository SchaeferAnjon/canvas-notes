/**
 * 读 PDF 的页边标记（task-2onrm，设计页 27-PDF页边标记 选 B「纸面内一列」）：
 * 纸的右边内侧一条 18 宽的浅灰竖条，每处问过的是一段竖线（上下 = 框的上下沿），挨着的错开成两三道（最多 3 道，再多叠在第 3 道）。
 * 悬停或点这一列出这一页问过的全部列表（几轮、问了什么、几点），点一条右栏切到笔记那一节、框闪一下；直接点一段竖线也一样。
 * 竖条 sticky 贴在这一栏看得到的右边：放大到纸比栏宽时贴着看得到的那块纸，不跟着滚出去；竖线按比例画，放大缩小自己跟着走。
 */
import type { ReadingThread } from '../../shared/reading'
import { t as tNow } from '../../shared/i18n'
import { when } from '../../shared/when'
import { useEffect, useRef, useState } from 'react'
import { useDismiss } from '../use-dismiss'

/** 竖线最短（框很矮时也点得中、看得见） */
const MIN_TICK = 8
/** 上一道的下沿离这一道的上沿不到这么多就换一道 */
const LANE_GAP = 4
const MAX_LANES = 3
/** 悬停多久出列表（鼠标划过去不闪） / 离开多久收（从竖条挪到列表中间那一点空不收） */
const OPEN_MS = 120
const CLOSE_MS = 220
/** 列表一行、头一行、上下留白：算放哪（靠页底往上收）用 */
const ROW_H = 30
const HEAD_H = 26
const MAX_ROWS = 8
/** 列表离指着的那处框上下沿 */
const CARD_GAP = 8

interface Tick {
  t: ReadingThread
  top: number
  h: number
  lane: number
}

/** 照上沿排，挨着的错开成几道（像素算：竖线最短 MIN_TICK） */
export function lanesOf(threads: ReadingThread[], pageH: number): Tick[] {
  const sorted = threads.map((t) => ({ t, top: t.rect ? t.rect[1] : 0, h: t.rect ? t.rect[3] : 1 })).sort((a, b) => a.top - b.top || b.h - a.h)
  const bottoms: number[] = []
  return sorted.map((x) => {
    const top = x.top * pageH
    let lane = bottoms.findIndex((b) => b <= top - LANE_GAP)
    if (lane === -1) lane = Math.min(bottoms.length, MAX_LANES - 1)
    bottoms[lane] = Math.max(bottoms[lane] ?? 0, top + Math.max(MIN_TICK, x.h * pageH))
    return { ...x, lane }
  })
}

export function PdfMarks(p: {
  page: number
  /** 这一页的高（像素，跟着比例） */
  height: number
  threads: ReadingThread[]
  rounds(id: string): number
  title(id: string): string
  /** 右栏笔记里正对着的那一处 */
  current: string | null
  /** 刚问的那一处：竖线长出来 */
  fresh: string | null
  /** 指着的那一处（页上显出问过的虚线框） */
  hover: string | null
  setHover(id: string | null): void
  onGo(t: ReadingThread): void
}) {
  const ticks = lanesOf(p.threads, p.height)
  const colRef = useRef<HTMLDivElement>(null)
  /** 列表开着：hover 悬停出来的，pin 点出来的（点外面、esc 才收） */
  const [open, setOpen] = useState<null | 'hover' | 'pin'>(null)
  /** 列表躲开的那一段（这一页上的比例，开的那一刻定，放大缩小跟着走）：指着的那处框的上下沿，没指着框时是指针那一点 */
  const [anchor, setAnchor] = useState({ y0: 0, y1: 0 })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clear = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => clear, [])
  useDismiss(open !== null, [colRef], (why) => {
    if (why !== 'blur') close()
  })

  function close() {
    clear()
    setOpen(null)
    p.setHover(null)
  }

  /** 指着哪一段竖线：在它上下沿里（各放宽 3），几段重叠取最短的 */
  function hit(clientY: number, target: EventTarget | null): Tick | null {
    const id = (target as Element | null)?.closest<HTMLElement>('.tick')?.dataset.id
    if (id) return ticks.find((k) => k.t.id === id) ?? null
    const col = colRef.current
    if (!col || (target as Element | null)?.closest('.mkcard')) return null
    const y = clientY - col.getBoundingClientRect().top
    let best: Tick | null = null
    for (const k of ticks) {
      const h = Math.max(MIN_TICK, k.h * p.height)
      if (y >= k.top * p.height - 3 && y <= k.top * p.height + h + 3 && (!best || h < Math.max(MIN_TICK, best.h * p.height))) best = k
    }
    return best
  }

  function openAt(clientY: number, k: Tick | null, how: 'hover' | 'pin') {
    const col = colRef.current
    if (!col) return
    const y = (clientY - col.getBoundingClientRect().top) / p.height
    setAnchor(k ? { y0: k.top, y1: k.top + Math.max(MIN_TICK / p.height, k.h) } : { y0: y, y1: y })
    setOpen(how)
  }

  const rows = [...ticks].sort((a, b) => a.top - b.top)
  const cardH = HEAD_H + Math.min(rows.length, MAX_ROWS) * ROW_H + 8
  // 列表不盖住指着的那处：放在它下沿往下 8，下面放不下放到上沿往上 8，都放不下贴着页底
  const below = anchor.y1 * p.height + CARD_GAP
  const above = anchor.y0 * p.height - CARD_GAP - cardH
  const cardTop = below + cardH <= p.height - 4 ? below : above >= 4 ? above : Math.max(4, p.height - cardH - 4)

  return (
    <div className="mkwrap">
      <div
        ref={colRef}
        className={'mkcol' + (open ? ' open' : '')}
        role="group"
        aria-label={tNow('第 {n} 页问过的地方', { n: p.page })}
        data-testid="pdf-marks"
        onPointerEnter={(e) => {
          clear()
          if (open) return
          const y = e.clientY
          const target = e.target
          timer.current = setTimeout(() => openAt(y, hit(y, target), 'hover'), OPEN_MS)
        }}
        onPointerMove={(e) => {
          if ((e.target as Element).closest('.mkcard')) return
          const k = hit(e.clientY, e.target)
          p.setHover(k?.t.id ?? null)
        }}
        onPointerLeave={() => {
          clear()
          if (open !== 'pin') timer.current = setTimeout(close, open ? CLOSE_MS : 0)
          if (!open) p.setHover(null)
        }}
        // 不让按下落到 PDF 上（框一块、取消选中）
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          if ((e.target as Element).closest('.mkcard')) return
          const k = hit(e.clientY, e.target)
          if (k) return void (close(), p.onGo(k.t))
          clear()
          if (open === 'pin') close()
          else openAt(e.clientY, null, 'pin')
        }}
      >
        {ticks.map((k) => (
          <button
            key={k.t.id}
            type="button"
            data-id={k.t.id}
            className={'tick' + (p.hover === k.t.id || p.current === k.t.id ? ' on' : '') + (p.current === k.t.id ? ' cur' : '') + (p.fresh === k.t.id ? ' new' : '')}
            style={{ top: `${k.top * 100}%`, height: `max(${MIN_TICK}px, ${k.h * 100}%)`, left: 2 + k.lane * 5 }}
            aria-label={tNow('第 {n} 页这里问过 {k} 轮', { n: p.page, k: p.rounds(k.t.id) })}
          />
        ))}
        {open && (
          <div className="mkcard" role="menu" aria-label={tNow('第 {n} 页问过 {k} 处', { n: p.page, k: rows.length })} style={{ top: cardTop }}>
            <div className="h">{tNow('第{n}页问过{k}处', { n: p.page, k: rows.length })}</div>
            <div className="rows">
              {rows.map((k) => (
                <button
                  key={k.t.id}
                  type="button"
                  role="menuitem"
                  className={p.hover === k.t.id ? 'hi' : undefined}
                  onPointerEnter={() => p.setHover(k.t.id)}
                  onClick={() => (close(), p.onGo(k.t))}
                >
                  <span className="n num" aria-label={tNow('问过 {k} 轮', { k: p.rounds(k.t.id) })}>
                    {p.rounds(k.t.id)}
                  </span>
                  <b className="truncate">{p.title(k.t.id)}</b>
                  <i className="num">{when(k.t.createdAt)}</i>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
