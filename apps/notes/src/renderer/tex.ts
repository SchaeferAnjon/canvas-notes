/**
 * 公式（LaTeX）排版：文档编辑器、白板卡片、文档切成的白板、AI 回答、读 PDF 笔记共用这一份 KaTeX 和同一套选项（task-o48fa）。
 * 哪段字算公式由 @cn/format 的 findMath / inlineMath 认。
 * KaTeX 的输出只有它自己生成的标签（trust: false，不认 \href 这类）。写错的不抛出去：交回一句中文的错在哪，界面把原文标红色波浪、悬停说这一句。
 */
import katex from 'katex'
import 'katex/dist/katex.min.css'
import './math.css'
import { t } from '../shared/i18n'

export type Tex = { html: string; error: null } | { html: null; error: string }

const OPTIONS = { throwOnError: true, trust: false, strict: 'ignore', output: 'htmlAndMathml' } as const

/** KaTeX 的英文错误换成一句中文；不认得的照原话 */
export function texError(raw: string, position: number | undefined): string {
  const rules: [RegExp, (...m: string[]) => string][] = [
    [/^Undefined control sequence: (.+)$/, (c) => t('不认识的命令 {c}', { c })],
    [/^Expected '(.+)', got 'EOF'/, (c) => t('少了一个 {c}', { c })],
    [/^Expected '(.+)', got '(.+)'/, (c, g) => t('这里该是 {c}，写的是 {g}', { c, g })],
    [/^Expected group (?:as argument to|after) '(.+)'/, (c) => t('{c} 后面少了 {…}', { c })],
    [/^Extra (.+)$/, (c) => t('多了一个 {c}', { c })],
    [/^Unexpected end of input in a macro argument/, () => t('少了一个 }')],
    [/^Can't use function '(.+)' in (math|text) mode/, (c, m) => (m === 'math' ? t('{c} 不能用在公式里', { c }) : t('{c} 不能用在文字里', { c }))],
    [/^Missing \\right/, () => t('少了配对的 \\right')],
    [/^Double (superscript|subscript)/, (k) => (k === 'superscript' ? t('连着两个上标 ^，要加 {} 分开') : t('连着两个下标 _，要加 {} 分开'))],
  ]
  let say = raw
  for (const [re, f] of rules) {
    const m = re.exec(raw)
    if (m) {
      say = f(...m.slice(1))
      break
    }
  }
  return position !== undefined ? t('公式写错了：{say}（第 {n} 个字）', { say, n: position + 1 }) : t('公式写错了：{say}', { say })
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

// ---------------------------------------------------------------- 拷贝排好的公式（task-busas）

const texSrc = (k: Element) => k.querySelector('annotation[encoding="application/x-tex"]')?.textContent ?? null
const wrapTex = (src: string, display: boolean) => (display ? `$$${src}$$` : `$${src}$`)

/**
 * 选中的这一段拷成纯文字：里面有 KaTeX 排好的公式时公式写回 `$原文$`（单独成行的 `$$原文$$`），别的字照屏上的样子；没有公式给 null（照浏览器自己的拷法）。
 * KaTeX 排出来的有两份字（给读屏的 MathML 和看的那一份），浏览器拷纯文字两份都拷、中间还断行：AI 回答里「就说 𝐱 是」拷进评价成了「就说 / x / x 是」
 */
export function mathCopyText(range: Range): string | null {
  const at = range.commonAncestorContainer
  const host = (at.nodeType === 1 ? (at as Element) : at.parentElement)?.closest('.katex')
  if (host) {
    const src = texSrc(host)
    return src === null ? null : wrapTex(src, !!host.closest('.katex-display'))
  }
  const frag = range.cloneContents()
  const ks = [...frag.querySelectorAll('.katex')]
  if (!ks.length) return null
  for (const k of ks) {
    const src = texSrc(k)
    const display = !!k.parentElement?.classList.contains('katex-display')
    // 只选了公式的一半：照看得见的那一份
    const text = src === null ? (k.querySelector('.katex-html')?.textContent ?? '') : wrapTex(src, display)
    ;(display ? k.parentElement! : k).replaceWith(document.createTextNode(text))
  }
  // 放进页面里一个看不见的盒子，innerText 照屏上的样子分段、分行
  const box = document.createElement('div')
  box.style.cssText = 'position:fixed;left:-100000px;top:0;width:800px;pointer-events:none'
  box.append(frag)
  document.body.append(box)
  const text = box.innerText
  box.remove()
  return text
}

/** 软件里不能改字的地方（AI 回答、白板卡、读 PDF 的笔记）拷带公式的字：纯文字里公式是 `$原文$`，富文本照旧 */
function onCopy(e: ClipboardEvent) {
  if (e.defaultPrevented || !e.clipboardData) return
  const sel = document.getSelection()
  if (!sel || sel.isCollapsed || !sel.rangeCount) return
  const range = sel.getRangeAt(0)
  const at = range.commonAncestorContainer
  const el = at.nodeType === 1 ? (at as Element) : at.parentElement
  // 编辑器、输入框自己拷（拷的是文件里的原文）
  if (!el || el.closest('.cm-editor, input, textarea, [contenteditable="true"]')) return
  const text = mathCopyText(range)
  if (text === null) return
  const html = document.createElement('div')
  html.append(range.cloneContents())
  e.clipboardData.setData('text/plain', text)
  e.clipboardData.setData('text/html', html.innerHTML)
  e.preventDefault()
}

if (typeof document !== 'undefined') document.addEventListener('copy', onCopy)
