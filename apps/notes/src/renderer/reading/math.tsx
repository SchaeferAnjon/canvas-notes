/**
 * MinerU（PDF 精读增强）认出来的公式和表格怎么画：公式（LaTeX）用 KaTeX 渲染，正文里的行内公式 $…$ 也渲染；
 * 表格按 @cn/format 的 tableRows 拆好的格子自己画 <table>（不把 MinerU 给的 HTML 原样塞进页面）。
 * KaTeX 的输出只有它自己生成的标签（trust: false，不认 \href 这类），渲染不了的原样显示 LaTeX。
 */
import { tableRows } from '@cn/format'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { useMemo } from 'react'

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

/** 一段字：$…$ 里的渲染成行内公式，别的照原样 */
export function MathText({ text }: { text: string }) {
  const parts = useMemo(() => splitMath(text), [text])
  if (parts.length === 1 && !parts[0]!.math) return <>{text}</>
  return (
    <>
      {parts.map((p, i) => (p.math ? <span key={i} className="mi" dangerouslySetInnerHTML={{ __html: tex(p.s, false) }} /> : <span key={i}>{p.s}</span>))}
    </>
  )
}

/** $…$ 切开（$$…$$ 也认；单个 $ 没配上的照原样） */
export function splitMath(text: string): { s: string; math: boolean }[] {
  const out: { s: string; math: boolean }[] = []
  const re = /\$\$([^$]+)\$\$|\$([^$\n]+)\$/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ s: text.slice(last, m.index), math: false })
    out.push({ s: (m[1] ?? m[2]!).trim(), math: true })
    last = m.index + m[0].length
  }
  if (last < text.length || !out.length) out.push({ s: text.slice(last), math: false })
  return out
}

/** 公式块：居中、整块渲染 */
export function MathBlock({ latex }: { latex: string }) {
  return <div className="mblock" role="math" aria-label={latex} dangerouslySetInnerHTML={{ __html: tex(latex, true) }} />
}

/** 数字格（27.94、−3.5%、1.8×10$^{9}$）靠右 */
const NUM = /^[\s+\-−±]*[\d.,]+\s*(%|×\s*10\$\^\{\d+\}\$)?\s*$/

/** 表格：拆不出格子返回 null（调用的地方退回照原页裁图） */
export function TableView({ html }: { html: string }) {
  const rows = useMemo(() => tableRows(html), [html])
  if (!rows.length) return null
  return (
    <div className="mtable">
      <table>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, k) => {
                const Cell = c.head || i === 0 ? 'th' : 'td'
                return (
                  <Cell key={k} colSpan={c.colspan} rowSpan={c.rowspan} className={NUM.test(c.text) ? 'n' : undefined}>
                    <MathText text={c.text} />
                  </Cell>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
