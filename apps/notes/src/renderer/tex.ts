/**
 * 公式（LaTeX）排版：文档编辑器、白板卡片、文档切成的白板、AI 回答、读 PDF 笔记共用这一份 KaTeX 和同一套选项（task-o48fa）。
 * 哪段字算公式由 @cn/format 的 findMath / inlineMath 认。
 * KaTeX 的输出只有它自己生成的标签（trust: false，不认 \href 这类）。写错的不抛出去：交回一句中文的错在哪，界面把原文标红色波浪、悬停说这一句。
 */
import katex from 'katex'
import 'katex/dist/katex.min.css'
import './math.css'

export type Tex = { html: string; error: null } | { html: null; error: string }

const OPTIONS = { throwOnError: true, trust: false, strict: 'ignore', output: 'htmlAndMathml' } as const

/** KaTeX 的英文错误换成一句中文；不认得的照原话 */
export function texError(raw: string, position: number | undefined): string {
  const rules: [RegExp, (...m: string[]) => string][] = [
    [/^Undefined control sequence: (.+)$/, (c) => `不认识的命令 ${c}`],
    [/^Expected '(.+)', got 'EOF'/, (c) => `少了一个 ${c}`],
    [/^Expected '(.+)', got '(.+)'/, (c, g) => `这里该是 ${c}，写的是 ${g}`],
    [/^Expected group (?:as argument to|after) '(.+)'/, (c) => `${c} 后面少了 {…}`],
    [/^Extra (.+)$/, (c) => `多了一个 ${c}`],
    [/^Unexpected end of input in a macro argument/, () => '少了一个 }'],
    [/^Can't use function '(.+)' in (math|text) mode/, (c, m) => `${c} 不能用在${m === 'math' ? '公式' : '文字'}里`],
    [/^Missing \\right/, () => '少了配对的 \\right'],
    [/^Double (superscript|subscript)/, (k) => `连着两个${k === 'superscript' ? '上标 ^' : '下标 _'}，要加 {} 分开`],
  ]
  let say = raw
  for (const [re, f] of rules) {
    const m = re.exec(raw)
    if (m) {
      say = f(...m.slice(1))
      break
    }
  }
  return `公式写错了：${say}${position !== undefined ? `（第 ${position + 1} 个字）` : ''}`
}

const cache = new Map<string, Tex>()

/** 排一个公式：display 是单独成行的样子 */
export function renderTex(src: string, display: boolean): Tex {
  const k = `${display ? 'D' : 'I'}${src}`
  let out = cache.get(k)
  if (out === undefined) {
    try {
      out = { html: katex.renderToString(src, { ...OPTIONS, displayMode: display }), error: null }
    } catch (e) {
      if (!(e instanceof katex.ParseError)) throw e
      const pe = e as katex.ParseError & { rawMessage?: string; position?: number }
      out = { html: null, error: texError(pe.rawMessage ?? pe.message, pe.position) }
    }
    if (cache.size > 2000) cache.clear()
    cache.set(k, out)
  }
  return out
}

/** 宽了横着滚（或在卡里放不下）的公式：还能往哪边滚，那一边 32 渐隐；滚到头去掉 */
export function fadeEdges(el: HTMLElement): () => void {
  const update = () => {
    const max = el.scrollWidth - el.clientWidth
    el.classList.toggle('math-fade-r', max > 1 && el.scrollLeft < max - 1)
    el.classList.toggle('math-fade-l', max > 1 && el.scrollLeft > 1)
  }
  el.addEventListener('scroll', update, { passive: true })
  const ro = new ResizeObserver(update)
  ro.observe(el)
  // 里面的东西变宽（数据库加了一列）外框不变：也看里面
  if (el.firstElementChild) ro.observe(el.firstElementChild)
  requestAnimationFrame(update)
  return () => {
    ro.disconnect()
    el.removeEventListener('scroll', update)
  }
}
