/**
 * md-render 里的公式（LaTeX）：哪段字算公式由 @cn/format 的 inlineMath / mathBlockAt 认，排版是 tex.ts（和文档编辑器同一份 KaTeX、同一套选项）。
 * 写错的照原文显示，红色波浪线，悬停说哪里错。
 */
import { useEffect, useRef } from 'react'
import { fadeEdges, renderTex } from '../tex'

/** 行内公式：跟着字走；gap 是「 gl」「 gr」：左边、右边紧挨着汉字，留 1/8 字宽（md-render 判断）；raw 是原文（写错时照它显示） */
export function MathInline({ latex, gap = '', raw = `$${latex}$` }: { latex: string; gap?: string; raw?: string }) {
  const t = renderTex(latex, false)
  if (t.error !== null)
    return (
      <span className="math-err" title={t.error}>
        {raw}
      </span>
    )
  return <span className={`mi${gap}`} dangerouslySetInnerHTML={{ __html: t.html }} />
}

/** 公式块：居中、整块渲染，太宽横着滚 */
export function MathBlock({ latex, raw = `$$\n${latex}\n$$` }: { latex: string; raw?: string }) {
  const t = renderTex(latex, true)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => (ref.current ? fadeEdges(ref.current) : undefined), [t.html])
  if (t.error !== null)
    return (
      <div className="mblock">
        <span className="math-err" title={t.error} style={{ whiteSpace: 'pre-wrap' }}>
          {raw}
        </span>
      </div>
    )
  return <div ref={ref} className="mblock" role="math" aria-label={latex} dangerouslySetInnerHTML={{ __html: t.html }} />
}
