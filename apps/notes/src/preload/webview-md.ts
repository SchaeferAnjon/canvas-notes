/**
 * 网页里选中的、整页的字转成 md 时公式、代码块不丢（用户：zh.d2l.ai 剪进来「行索引（ ）和列索引（ ）」括号里的 $i$、$j$ 没了；
 * 「代码块或公式是没有办法选中的 所以它剪藏的时候就会 miss 掉」）：
 * - 公式读源 TeX：MathJax 3 读 assistive MathML 里的 TeX 注解，读不到时用主世界里 MathJax.startup.document 记着的原文
 *   （tagMathJax 先写到容器的 data-cn-tex 上）；MathJax 2 读旁边的 <script type="math/tex">（「; mode=display」是块级）；
 *   KaTeX 读 .katex 里的注解；都没有时退回 MathML 的字，不留空。行内写 `$…$`，块级单独几行 `$$ … $$`。
 * - 代码块读 <pre> 的字，语言从 class（language-x、highlight-x）认，写成围栏；d2l 那种几个页签的只带看得见的那个。
 * - 选区碰到公式、代码块：整块带上（不管选区停在它中间还是旁边的字上）。
 * - Sphinx（d2l）的式号「(2.3.7)」是公式旁边单独一个 span.eqno：不单独写一行，写进那个公式的 `\tag{2.3.7}`（文档里照样画在右边）。
 * 回到那一段的链接、网页上的小标找段落仍用网页上看得到的纯文字（selectionText），md 只用来写进文件、交给 AI。
 */
const TEX = 'annotation[encoding="application/x-tex"]'
/** 公式的最外层：MathJax 3 容器、MathJax 2 的显示（真正的原文在后面的 script）、KaTeX、光秃秃的 MathML */
const MATH = 'mjx-container, .MathJax, .MathJax_Display, .MathJax_SVG, .MathJax_CHTML, .MathJax_Preview, .katex-display, .katex, math'

export interface Tex {
  tex: string
  display: boolean
}

/** 这个元素是公式（或公式的一部分）：返回公式最外层 */
export function mathRoot(el: Element | null): Element | null {
  let root: Element | null = null
  for (let p = el?.closest(MATH) ?? null; p; p = p.parentElement?.closest(MATH) ?? null) root = p
  return root
}

/** MathJax 2 显示用的那一块后面紧跟着的原文 script */
function mj2Script(el: Element): HTMLScriptElement | null {
  let n = el.nextElementSibling
  // 块级公式外面多一层 .MathJax_Display，script 在它后面
  if (!n && el.parentElement?.classList.contains('MathJax_Display')) n = el.parentElement.nextElementSibling
  return n instanceof HTMLScriptElement && /^math\/tex/i.test(n.type) ? n : null
}

/** 一个公式的源 TeX；读不到 TeX 时退回 MathML 的字 */
export function texOf(root: Element): Tex | null {
  const tagged = root.getAttribute('data-cn-tex') ?? root.getAttribute('data-latex')
  const displayAttr = root.getAttribute('display') === 'true' || root.getAttribute('data-cn-display') === '1' || root.classList.contains('katex-display') || root.classList.contains('MathJax_Display')
  if (tagged) return { tex: tagged.trim(), display: displayAttr }
  if (root instanceof HTMLScriptElement) return { tex: (root.textContent ?? '').trim(), display: /mode=display/i.test(root.type) }
  const s = mj2Script(root)
  if (s) return { tex: (s.textContent ?? '').trim(), display: /mode=display/i.test(s.type) || root.classList.contains('MathJax_Display') }
  const ann = root.querySelector(TEX)
  if (ann?.textContent?.trim()) return { tex: ann.textContent.trim(), display: displayAttr || root.querySelector('math[display="block"]') !== null }
  const mml = root.matches('math') ? root : root.querySelector('math')
  const text = (mml ?? root).textContent?.replace(/\s+/g, ' ').trim() ?? ''
  return text ? { tex: text, display: displayAttr || mml?.getAttribute('display') === 'block' } : null
}

/** Sphinx 的式号：公式外面那一层（div.math）里单独的 span.eqno，「(2.3.7)¶」读成「2.3.7」；没有是 null */
function eqnoOf(root: Element): { el: Element; no: string } | null {
  for (let p = root.parentElement, n = 0; p && n < 2; p = p.parentElement, n++) {
    const el = Array.from(p.children).find((c) => c.classList.contains('eqno'))
    if (!el) continue
    const text = Array.from(el.childNodes)
      .filter((c) => !(c instanceof Element && c.matches('a.headerlink')))
      .map((c) => c.textContent ?? '')
      .join('')
      .replace(/¶/g, '')
      .trim()
    const no = /^\((.+)\)$/.exec(text)?.[1] ?? text
    return no ? { el, no } : null
  }
  return null
}

/** 块级公式带上式号（已经写了 \tag 的不再加） */
function withTag(t: Tex, root: Element): Tex {
  if (!t.display || /\\tag\b/.test(t.tex)) return t
  const e = eqnoOf(root)
  return e ? { ...t, tex: `${t.tex} \\tag{${e.no}}` } : t
}

export const texMd = (t: Tex) => (t.display ? `\n\n$$\n${t.tex}\n$$\n\n` : `$${t.tex}$`)

/** 代码块的语言：class 里的 language-x、lang-x、highlight-x（Sphinx） */
export function codeLang(pre: Element): string {
  for (let p: Element | null = pre; p && p !== document.body; p = p.parentElement) {
    const m = /(?:^|\s)(?:language|lang|highlight)-([\w+#-]+)/.exec(p.className && typeof p.className === 'string' ? p.className : '')
    if (m && m[1] !== 'default' && m[1] !== 'none') return m[1]!
    if (p.tagName === 'PRE' || p.tagName === 'CODE' || p === pre) {
      const c = p.querySelector?.('code[class*="language-"]')
      const mc = c && /language-([\w+#-]+)/.exec(c.className)
      if (mc) return mc[1]!
    }
  }
  return ''
}

export const codeMd = (pre: Element) => {
  const text = (pre.textContent ?? '').replace(/\n+$/, '')
  return `\n\n\`\`\`${codeLang(pre)}\n${text}\n\`\`\`\n\n`
}

const BLOCK = /^(P|DIV|LI|UL|OL|H[1-6]|BLOCKQUOTE|TABLE|TR|SECTION|ARTICLE|DD|DT|FIGURE|FIGCAPTION|HEADER|MAIN)$/

/** 看不见的（页签里没显示的那个、藏起来的）不带 */
function hidden(el: Element): boolean {
  if (el.closest('#cn-clip-host, #cn-box-host, #cn-mark-host')) return true
  const cs = getComputedStyle(el)
  return cs.display === 'none' || cs.visibility === 'hidden'
}

/**
 * 选区按网页里的先后转成 md：碰到的公式、代码块整块带上；skipTr：夹着的译文（cn-tr）不要
 */
export function rangeToMd(range: Range, skipTr: boolean): string {
  let out = ''
  const seen = new Set<Element>()
  const push = (s: string) => (out += s)
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) {
      if (!range.intersectsNode(n)) return
      const t = n as Text
      const a = t === range.startContainer ? range.startOffset : 0
      const b = t === range.endContainer ? range.endOffset : t.data.length
      push(t.data.slice(a, b).replace(/\s+/g, ' '))
      return
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return
    const el = n as Element
    if (!range.intersectsNode(el)) return
    if (el.tagName === 'SCRIPT') {
      // MathJax 2 的原文跟着前面显示的那块一起写过了；单独碰到它（只选中了 script 附近）照样写
      if (/^math\/tex/i.test((el as HTMLScriptElement).type) && !seen.has(el)) {
        const t = texOf(el)
        if (t) push(texMd(t))
      }
      return
    }
    if (el.tagName === 'STYLE' || el.tagName === 'NOSCRIPT' || el.tagName === 'TEMPLATE') return
    if (hidden(el) || (skipTr && el.tagName === 'CN-TR')) return
    // 式号写进公式的 \tag（withTag），这里不再单独写
    if (el.classList.contains('eqno')) return
    const root = mathRoot(el)
    if (root) {
      if (seen.has(root)) return
      seen.add(root)
      const s = mj2Script(root)
      if (s) seen.add(s)
      // MathJax 2 预览那一小块（.MathJax_Preview）后面还跟着显示块：交给显示块写
      if (root.classList.contains('MathJax_Preview')) return
      const t = texOf(root)
      if (t) push(texMd(withTag(t, root)))
      return
    }
    if (el.tagName === 'PRE') return void push(codeMd(el))
    if (el.tagName === 'BR') return void push('\n')
    const block = BLOCK.test(el.tagName)
    if (block) push('\n\n')
    for (const c of Array.from(el.childNodes)) walk(c)
    if (block) push('\n\n')
  }
  walk(range.commonAncestorContainer.nodeType === Node.TEXT_NODE ? range.commonAncestorContainer.parentNode! : range.commonAncestorContainer)
  return out
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 整页剪藏的克隆里：公式换成写好 TeX 的小块（Turndown 的 cnTex 规则写成 $…$），看不见的页签拿掉 */
export function prepareMath(live: Document, clone: Document) {
  // 页签里没显示的那个：克隆里量不出样式，先在原网页上量好记下
  const hide: string[] = []
  live.querySelectorAll('pre, .mdl-tabs__panel, [role=tabpanel]').forEach((el, i) => {
    if (getComputedStyle(el).display === 'none') hide.push(String(i))
  })
  clone.querySelectorAll('pre, .mdl-tabs__panel, [role=tabpanel]').forEach((el, i) => {
    if (hide.includes(String(i))) el.remove()
  })
  // 代码块的语言先记在 <pre> 上：Readability 抽正文时会去掉外面 div 的 class（highlight-python）
  clone.querySelectorAll('pre').forEach((pre) => {
    const lang = codeLang(pre)
    if (lang) pre.setAttribute('data-cn-lang', lang)
  })
  const done = new Set<Element>()
  for (const el of Array.from(clone.querySelectorAll(`${MATH}, script[type^="math/tex"]`))) {
    if (!el.isConnected || done.has(el)) continue
    const root = el instanceof HTMLScriptElement ? el : mathRoot(el)
    if (!root || done.has(root)) continue
    done.add(root)
    if (root.classList?.contains('MathJax_Preview')) {
      root.remove()
      continue
    }
    const raw = texOf(root)
    const t = raw && withTag(raw, root)
    eqnoOf(root)?.el.remove()
    const s = root instanceof HTMLScriptElement ? null : mj2Script(root)
    if (s) {
      done.add(s)
      s.remove()
    }
    if (!t) {
      root.remove()
      continue
    }
    // 都用 span（Readability 抽正文时会把只有字的 div 拆掉、属性跟着丢）；块级的外面套一个 p，自成一段
    const box = clone.createElement('span')
    box.setAttribute('data-cn-tex', t.tex)
    if (t.display) box.setAttribute('data-cn-display', '1')
    box.textContent = t.tex
    if (t.display) {
      const p = clone.createElement('p')
      p.appendChild(box)
      root.replaceWith(p)
    } else root.replaceWith(box)
  }
}

/**
 * 选区碰到的公式、代码块整块铺选中色（会被整块带上，用户看得到）；null 是选区没了，全拿掉。
 * 底色就是系统选区色（Highlight，和旁边选中的字一个蓝），块里原生的选区透明（不叠出第二种蓝）；
 * 行内公式只铺底、圆角 2，不加外圈（不压到上下行的字）；块级公式、代码块圆角 3、外圈 2
 */
let marked: Element[] = []
export function markSelBlocks(range: Range | null) {
  for (const el of marked) el.classList.remove('cn-selblock', 'cn-selblock-b', 'cn-selblock-in')
  marked = []
  if (!range) return
  if (!document.getElementById('cn-selblock-style')) {
    const st = document.createElement('style')
    st.id = 'cn-selblock-style'
    st.textContent =
      '.cn-selblock{background-color:Highlight!important;border-radius:2px}' +
      '.cn-selblock.cn-selblock-b{border-radius:3px;box-shadow:0 0 0 2px Highlight}' +
      '.cn-selblock::selection,.cn-selblock ::selection,.cn-selblock-in::selection,.cn-selblock-in ::selection{background:transparent!important}'
    document.documentElement.appendChild(st)
  }
  for (const el of Array.from(document.querySelectorAll(`${MATH}, pre`))) {
    if (el.tagName !== 'PRE' && mathRoot(el) !== el) continue
    if (!range.intersectsNode(el)) continue
    el.classList.add('cn-selblock')
    if (el.tagName === 'PRE' || getComputedStyle(el).display === 'block') el.classList.add('cn-selblock-b')
    marked.push(el)
    // Sphinx 的式号画在公式那一块上（跟着写进 \tag）：它的原生选区也透明，不叠出深一块
    const eq = eqnoOf(el)
    if (eq) {
      eq.el.classList.add('cn-selblock-in')
      marked.push(eq.el)
    }
  }
}

/** 选区（或光标）在一个标题上：这个标题到下一个同级或更高一级标题之前的全部（含公式、代码、图）；不在标题上是 null */
export function sectionRange(sel: Selection): Range | null {
  if (!sel.rangeCount) return null
  const start = sel.getRangeAt(0).startContainer
  const h = (start.nodeType === Node.ELEMENT_NODE ? (start as Element) : start.parentElement)?.closest('h1, h2, h3, h4, h5, h6')
  if (!h) return null
  const level = Number(h.tagName[1])
  const all = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'))
  const next = all.slice(all.indexOf(h) + 1).find((x) => Number(x.tagName[1]) <= level)
  const r = document.createRange()
  r.setStartBefore(h)
  if (next) r.setEndBefore(next)
  else r.setEndAfter(h.parentElement?.lastChild ?? h)
  return r
}

/** 停在哪个公式、代码块上（整块） */
export function blockAt(t: EventTarget | null): Element | null {
  const el = t instanceof Element ? t : null
  if (!el || el.closest('#cn-clip-host, #cn-box-host, #cn-mark-host, #cn-block-host')) return null
  return mathRoot(el) ?? el.closest('pre')
}

/** 选中整块（点一下公式、代码块；角上「引用」「剪藏」也是先选中整块再交给小条那一套） */
export function selectBlock(el: Element) {
  const s = mj2Script(el)
  const r = document.createRange()
  r.setStartBefore(el)
  if (s) r.setEndAfter(s)
  else r.setEndAfter(el)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(r)
}
