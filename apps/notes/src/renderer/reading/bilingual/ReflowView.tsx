/**
 * 重排（对照）和只看译文：不要原版式，版心 720 居中；每组（PDF 的一页、网页的整篇）先一个头，
 * 每段先原文 13/1.6 --t2、紧跟译文 15/1.75 --t1；公式和图是照原页裁下来的小图，不翻译。
 * 每段悬停右上出：（只看译文时）「原文」、「重新翻译」、「问这段」。看得到的组先翻（上下各多一屏）。
 * PDF 和网页阅读视图用同一个组件（spec 2.2、2.4）。
 */
import { Codicon } from '@cn/design'
import { biKind, type BiKind, type PdfBlock, tableRows, translatable } from '@cn/format'
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { MathBlock, MathText, TableView } from '../math'
import { hashOf, request, toggleOrig, useBi } from './store'
import './bilingual.css'

export interface FlowBlock {
  id: string
  /** table（text 是表格 HTML）、formula（text 是 LaTeX）、caption 只有 PDF 精读增强（MinerU）认得出 */
  kind: PdfBlock['kind']
  text: string
  /** MinerU 认的：字里的 $…$ 是行内公式，要渲染 */
  math?: true
  /** 公式、图：给一张小图的网址（用到时才要） */
  crop?: () => Promise<string>
  /** 裁图显示多宽（CSS 像素，不超过版心） */
  w?: number
  /** 定死是公式 / 图（网页里抽出来的公式、代码、表格），不按字猜 */
  fixed?: 'formula' | 'figure'
  /** PDF：这块在原页上的上沿（页面单位），并排时右边译文对齐到这里 */
  top?: number
  /** PDF：一格一格的短标签，整块照原页裁 */
  stack?: true
}

export const kindOf = (b: FlowBlock): BiKind => b.fixed ?? biKind(b)
/** 要送去翻的块 */
export const toTranslate = (list: FlowBlock[]) => translatable(list.filter((b) => !b.fixed))

export interface FlowGroup {
  key: string
  head: ReactNode
  blocks: FlowBlock[]
  /** 这一组还没读出来（PDF 还在读全文） */
  loading?: string
}

export function ReflowView(props: {
  srcKey: string
  groups: FlowGroup[]
  mode: 'bi' | 'tr'
  course: string | null
  /** 「问这段」 */
  onAsk?(b: FlowBlock, groupKey: string): void
  /** 框好还没发的那段（铺 --acc-soft + 外圈） */
  staged?: string | null
  /** 让这一组滚到上面 */
  scrollTo?: { key: string; seq: number } | null
  /** 滚到哪一组了（PDF 跟着记看到哪页） */
  onTopGroup?(key: string): void
  /** 外圈亮一下的组（从笔记跳回来，重排里没有原页，闪那一页的段组） */
  flash?: { key: string; seq: number } | null
}) {
  const bi = useBi(props.srcKey)
  const box = useRef<HTMLDivElement>(null)
  const [vis, setVis] = useState<Set<string>>(new Set())

  // 看得到的组（上下各多一屏）先翻
  useEffect(() => {
    const root = box.current
    if (!root) return
    const io = new IntersectionObserver(
      (ents) =>
        setVis((old) => {
          const next = new Set(old)
          for (const e of ents) {
            const k = (e.target as HTMLElement).dataset.group!
            if (e.isIntersecting) next.add(k)
            else next.delete(k)
          }
          return next
        }),
      { root, rootMargin: '100% 0px 100% 0px' },
    )
    for (const el of root.querySelectorAll('[data-group]')) io.observe(el)
    return () => io.disconnect()
  }, [props.groups])

  useEffect(() => {
    const want = props.groups.filter((g) => vis.has(g.key)).flatMap((g) => toTranslate(g.blocks))
    if (want.length) void request(props.srcKey, want, props.course)
  }, [vis, props.groups, props.srcKey, props.course])

  useLayoutEffect(() => {
    const s = props.scrollTo
    const el = s && box.current?.querySelector<HTMLElement>(`[data-group="${CSS.escape(s.key)}"]`)
    if (el && box.current) box.current.scrollTop = el.offsetTop - 16
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.scrollTo?.seq])

  function onScroll() {
    const root = box.current
    if (!root || !props.onTopGroup) return
    const y = root.scrollTop + root.clientHeight / 3
    let top: string | null = null
    for (const el of root.querySelectorAll<HTMLElement>('[data-group]')) {
      if (el.offsetTop <= y) top = el.dataset.group!
      else break
    }
    if (top) props.onTopGroup(top)
  }

  return (
    <div className={'reflow' + (props.mode === 'tr' ? ' tronly' : '')} ref={box} onScroll={onScroll} data-testid="reflow">
      {props.groups.map((g) => (
        <section key={g.key} className={'fgrp' + (props.flash?.key === g.key ? ' flash' : '')} data-group={g.key}>
          <div className="fh">{g.head}</div>
          {g.loading && (
            <p className="fload">
              <Codicon name="loading" size={12} className="spin" />
              {g.loading}
            </p>
          )}
          {g.blocks.map((b) => {
            const kind = kindOf(b)
            // MinerU 认出的公式渲染、表格画成表（拆不出格子的退回照原页裁）
            if (kind === 'formula' && b.kind === 'formula') return <RenderedBlock key={b.id} b={b} kind="formula" />
            if (kind === 'table' && tableRows(b.text).length) return <RenderedBlock key={b.id} b={b} kind="table" />
            if (kind === 'formula' || kind === 'figure' || kind === 'table') return <CropBlock key={b.id} b={b} kind={kind} show={vis.has(g.key)} />
            const h = hashOf(b.text)
            const tr = bi.tr[h]
            const canTr = toTranslate([b]).length > 0
            const showOrig = props.mode === 'bi' || !!bi.showOrig[h] || !canTr
            return (
              <div key={b.id} className={'fb ' + kind + (props.staged === b.id ? ' staged' : '')} data-block={b.id}>
                {showOrig && <p className="o">{b.math ? <MathText text={b.text} /> : b.text}</p>}
                {canTr && <TrLine tr={tr} math={b.math} />}
                <span className="fbact" onPointerDown={(e) => e.stopPropagation()}>
                  {props.mode === 'tr' && (
                    <button type="button" className={bi.showOrig[h] ? 'on' : ''} aria-label="显示原文" title="显示原文" onClick={() => toggleOrig(props.srcKey, b.text)}>
                      <Codicon name="quote" size={12} />
                      原文
                    </button>
                  )}
                  {canTr && (
                    <button type="button" aria-label="重新翻译" title="重新翻译" disabled={tr?.state === 'wait'} onClick={() => void request(props.srcKey, [b], props.course, true)}>
                      <Codicon name="refresh" size={12} />
                    </button>
                  )}
                  {props.onAsk && (
                    <button type="button" aria-label="问这段" title="问这段" onClick={() => props.onAsk!(b, g.key)}>
                      <Codicon name="comment-discussion-sparkle" size={12} />
                      问这段
                    </button>
                  )}
                </span>
              </div>
            )
          })}
        </section>
      ))}
    </div>
  )
}

function TrLine({ tr, math }: { tr: { state: string; text?: string; error?: string } | undefined; math?: true }) {
  if (tr?.state === 'ok' || (tr?.state === 'wait' && tr.text)) return <p className={'t' + (tr.state === 'wait' ? ' re' : '')}>{math ? <MathText text={tr.text!} /> : tr.text}</p>
  if (tr?.state === 'err')
    return (
      <p className="t err" role="note">
        没翻成：{tr.error}
      </p>
    )
  return (
    <p className="t wait" aria-label="正在翻">
      <i />
      <i />
    </p>
  )
}

/** PDF 精读增强认出的公式（KaTeX 渲染）和表格（画成表），不翻译 */
function RenderedBlock({ b, kind }: { b: FlowBlock; kind: 'formula' | 'table' }) {
  return (
    <figure className={'fc ' + kind + ' rendered'} data-block={b.id}>
      <div className="fci">{kind === 'formula' ? <MathBlock latex={b.text} /> : <TableView html={b.text} />}</div>
    </figure>
  )
}

/** 公式、图：照原页裁下来的小图（看得到才裁） */
function CropBlock({ b, kind, show }: { b: FlowBlock; kind: BiKind; show: boolean }) {
  const [url, setUrl] = useState<string | null>(null)
  const [err, setErr] = useState(false)
  useEffect(() => {
    if (!show || url || !b.crop) return
    let alive = true
    b.crop().then(
      (u) => alive && setUrl(u),
      () => alive && setErr(true),
    )
    return () => {
      alive = false
    }
  }, [show, url, b])
  return (
    <figure className={'fc ' + kind} data-block={b.id}>
      <div className={'fci' + (b.crop ? '' : ' raw')}>{!b.crop ? <pre>{b.text}</pre> : url ? <img src={url} alt={kind === 'formula' ? '公式' : '图'} style={b.w ? { width: b.w } : undefined} /> : err ? <span>这块没裁出来</span> : <span className="ph" />}</div>
      <figcaption>{b.fixed ? '公式、代码和图不翻译' : '公式和图不翻译，照原页裁下来'}</figcaption>
    </figure>
  )
}
