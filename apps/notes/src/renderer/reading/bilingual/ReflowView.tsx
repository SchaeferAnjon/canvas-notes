/**
 * 网页阅读视图的对照读和只看译文：不要原版式，版心 720 居中；整篇先一个头，
 * 每段先原文 13/1.6 --t2、紧跟译文 15/1.75 --t1；公式、代码和图不翻译。
 * 每段悬停右上出：（只看译文时）「原文」、「重新翻译」。看得到的段先翻（上下各多一屏）（spec 2.4）。
 */
import { Codicon } from '@cn/design'
import { biKind, type BiKind, type PdfBlock, translatable } from '@cn/format'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { hashOf, request, toggleOrig, useBi } from './store'
import './bilingual.css'

export interface FlowBlock {
  id: string
  kind: PdfBlock['kind']
  text: string
  /** 图：给一张图的网址（用到时才要） */
  crop?: () => Promise<string>
  /** 定死是公式 / 图（网页里抽出来的公式、代码、表格），不按字猜 */
  fixed?: 'formula' | 'figure'
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

  return (
    <div className={'reflow' + (props.mode === 'tr' ? ' tronly' : '')} ref={box} data-testid="reflow">
      {props.groups.map((g) => (
        <section key={g.key} className="fgrp" data-group={g.key}>
          <div className="fh">{g.head}</div>
          {g.loading && (
            <p className="fload">
              <Codicon name="loading" size={12} className="spin" />
              {g.loading}
            </p>
          )}
          {g.blocks.map((b) => {
            const kind = kindOf(b)
            if (kind === 'formula' || kind === 'figure') return <CropBlock key={b.id} b={b} kind={kind} show={vis.has(g.key)} />
            const h = hashOf(b.text)
            const tr = bi.tr[h]
            const canTr = toTranslate([b]).length > 0
            const showOrig = props.mode === 'bi' || !!bi.showOrig[h] || !canTr
            return (
              <div key={b.id} className={'fb ' + kind} data-block={b.id}>
                {showOrig && <p className="o">{b.text}</p>}
                {canTr && <TrLine tr={tr} />}
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
                </span>
              </div>
            )
          })}
        </section>
      ))}
    </div>
  )
}

function TrLine({ tr }: { tr: { state: string; text?: string; error?: string } | undefined }) {
  if (tr?.state === 'ok' || (tr?.state === 'wait' && tr.text)) return <p className={'t' + (tr.state === 'wait' ? ' re' : '')}>{tr.text}</p>
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

/** 公式、图：网页上的原图（看得到才取） */
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
      <div className={'fci' + (b.crop ? '' : ' raw')}>{!b.crop ? <pre>{b.text}</pre> : url ? <img src={url} alt={kind === 'formula' ? '公式' : '图'} /> : err ? <span>这块没裁出来</span> : <span className="ph" />}</div>
      <figcaption>{b.fixed ? '公式、代码和图不翻译' : '公式和图不翻译，照原页裁下来'}</figcaption>
    </figure>
  )
}
