/**
 * 量中文和数字、西文挨着时中间的空隙（DESIGN.md 字体：不手打空格，间距全交给 text-autospace）。
 * 照屏幕上真画出来的位置量：后一个字的左边 − 前一个字的左边 − 前一个字本来的宽（同样的字体、关掉 autospace 量出来的）。
 * 两个字不在同一个文本节点里（`{n}篇` 拆开写、`<b>3</b>张`）时，单字 Range 的框靠不住：Chromium 有时把 autospace 加的那一截
 * 算进后一个字的框（框左边往前挪 1.6px），按上面量出 0，可屏幕上字的位置和一个节点时逐像素相同（第 3 轮美学复审实测）。
 * 所以跨节点量到不足 1px 时，再把这两个字放进一个文本节点的探针里（同字体、同 text-autospace）重量，以它为准。
 * 这样量出来 autospace 加的是 1/8 字宽（11–13px 字是 1.4–1.6px），手打的空格 2.9px 以上，flex gap 撑开的 4px 以上，没开 autospace 的是 0；
 * 所以只认 1–2.5px。
 * - 同一段字里（同一个块或 flex 项）：中文和数字、中文和西文都量；
 * - 跨了 flex 项（数字单独一个 span 放进带 gap 的 flex，「本周 2 次提交」）：只量中文和数字，隔得比 16px 还远的当成两栏（名字和右边的篇数）不算。
 * 不算的：「今天 10:34」日期和钟点之间、快捷键两边（⌘⌥⇧⌃↵ 不吃 autospace；「esc 关闭」的键名也算）、skip 里列的元素（用户自己的字、键帽、代码）。
 * 函数自己带全，能 toString() 塞进右栏网页（webview）里跑。
 */
export interface Gap {
  /** 前后几个字 */
  text: string
  /** 量到的空隙 px */
  gap: number
  /** 在哪个元素里 */
  el: string
}

export function measureGaps(scope: string, skip: string, all = false): Gap[] {
  const CJK = /[一-鿿]/
  const DIGIT = /[0-9]/
  const LATIN = /[0-9A-Za-z]/
  const KEY = /[⌘⌥⇧⌃↵]/
  const out: Gap[] = []
  const probe = document.createElement('span')
  probe.style.cssText = 'position:absolute;left:-9999px;top:0;white-space:pre;text-autospace:no-autospace'
  document.body.appendChild(probe)
  const FONT = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontStretch', 'fontVariantNumeric', 'fontFeatureSettings', 'fontKerning', 'letterSpacing'] as const
  const natural = (ch: string, el: Element) => {
    const cs = getComputedStyle(el)
    for (const k of FONT) probe.style[k] = cs[k]
    probe.textContent = ch
    return probe.getBoundingClientRect().width
  }
  const pair = document.createElement('span')
  pair.style.cssText = 'position:absolute;left:-9999px;top:40px;white-space:pre'
  document.body.appendChild(pair)
  /** 两个字放进一个文本节点、同字体同 text-autospace 时中间的空隙 */
  const pairGap = (a: string, b: string, el: Element) => {
    const cs = getComputedStyle(el)
    for (const k of FONT) pair.style[k] = cs[k]
    pair.style.textAutospace = cs.textAutospace
    pair.textContent = a + b
    const t = pair.firstChild as Text
    return rectOf(t, 1)!.left - rectOf(t, 0)!.left - natural(a, el)
  }
  const rectOf = (n: Text, i: number) => {
    const r = document.createRange()
    r.setStart(n, i)
    r.setEnd(n, i + 1)
    return r.getClientRects()[0] ?? null
  }
  /** 字所在的那一段（最近的不是 inline 的祖先：块、flex 项） */
  const blockOf = (n: Text) => {
    let e = n.parentElement!
    while (e.parentElement && getComputedStyle(e).display === 'inline') e = e.parentElement
    return e
  }
  const desc = (e: Element) => e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).join('.') : '')
  for (const root of Array.from(document.querySelectorAll(scope))) {
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let prev: { n: Text; i: number; ch: string } | null = null
    let spaced = false
    /** 前面挨着的一串非中文（看是不是快捷键） */
    let run = ''
    for (let n = walk.nextNode() as Text | null; n; n = walk.nextNode() as Text | null) {
      const el = n.parentElement!
      if ((skip && el.closest(skip)) || !el.getClientRects().length || getComputedStyle(el).visibility === 'hidden') {
        prev = null
        continue
      }
      const s = n.data
      for (let i = 0; i < s.length; i++) {
        const ch = s[i]!
        if (/\s/.test(ch)) {
          if (prev) spaced = true
          continue
        }
        const pair = prev && ((CJK.test(prev.ch) && LATIN.test(ch)) || (LATIN.test(prev.ch) && CJK.test(ch)))
        if (prev && pair) {
          const same = prev.n === n || blockOf(prev.n) === blockOf(n)
          const digit = DIGIT.test(prev.ch) || DIGIT.test(ch)
          const dateTime = spaced && CJK.test(prev.ch) && /^\d{1,2}:\d\d/.test(s.slice(i, i + 5))
          const token = CJK.test(ch) ? run : (s.slice(i).match(/^[^\s一-鿿]*/)?.[0] ?? '')
          const key = KEY.test(token) || /^(esc|tab|space)$/i.test(token)
          const a = rectOf(prev.n, prev.i)
          const b = rectOf(n, i)
          if ((same || digit) && !dateTime && !key && a && b && Math.abs(a.top - b.top) < 4 && b.left > a.left) {
            let gap = b.left - a.left - natural(prev.ch, prev.n.parentElement!)
            if (prev.n !== n && same && gap < 1) gap = pairGap(prev.ch, ch, prev.n.parentElement!)
            if (gap < 16 && (all || gap < 1 || gap > 2.5)) {
              const both = (prev.n === n ? s.slice(Math.max(0, prev.i - 4), i + 4) : prev.n.data.slice(-4) + '|' + s.slice(0, i + 4)).trim()
              out.push({ text: both, gap: Math.round(gap * 10) / 10, el: desc(el) })
            }
          }
        }
        run = CJK.test(ch) ? '' : (spaced ? '' : run) + ch
        prev = { n, i, ch }
        spaced = false
      }
    }
  }
  probe.remove()
  pair.remove()
  return out
}

/** 不算的：用户自己的字（文档、白板卡片、文件名、正文摘要、搜到的那一句、提交说明）、键帽、代码 */
export const USER_TEXT = '.cm-editor, .md, .md-render, .db-card, .bcard, input, textarea, code, pre, kbd, .truncate, .subj, .ti, .fn, .tn, .pv, .sn, mark, webview, [data-user-text]'
