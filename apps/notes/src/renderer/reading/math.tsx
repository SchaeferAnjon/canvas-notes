/**
 * AI 回答里的公式（LaTeX）用 KaTeX 渲染（CN-89）：哪段字算公式由 md-render.tsx 认（行内 $…$、单独一行的 $$…$$）。
 * KaTeX 的输出只有它自己生成的标签（trust: false，不认 \href 这类），渲染不了的原样显示 LaTeX（红字）。
 */
import katex from 'katex'
import 'katex/dist/katex.min.css'

const cache = new Map<string, string>()
function tex(src: string, display: boolean): string {
  const k = `${display ? 'D' : 'I'}${src}`
  let html = cache.get(k)
  if (html === undefined) {
    html = katex.renderToString(src, { displayMode: display, throwOnError: false, trust: false, strict: 'ignore', output: 'htmlAndMathml' })
    if (cache.size > 2000) cache.clear()
    cache.set(k, html)
  }
  return html
}

/** 行内公式：跟着字走；gap 是「 gl」「 gr」：左边、右边紧挨着汉字，留 1/8 字宽（md-render 判断） */
export function MathInline({ latex, gap = '' }: { latex: string; gap?: string }) {
  return <span className={`mi${gap}`} dangerouslySetInnerHTML={{ __html: tex(latex, false) }} />
}

/** 公式块：居中、整块渲染，太宽横着滚 */
export function MathBlock({ latex }: { latex: string }) {
  return <div className="mblock" role="math" aria-label={latex} dangerouslySetInnerHTML={{ __html: tex(latex, true) }} />
}
