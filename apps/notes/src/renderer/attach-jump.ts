/**
 * 「属性」弹层的附件里单击一张图：跳到文中用它的那一处（2026-11-23 用户「属性里点这张图 我希望能跳到文档里对应的位置」）。
 * 文档看法：滚过去、画成图的那张外圈亮一下（同白板跳到卡）；滚到弹层下面空着的那块里（弹层盖着中间栏上半，滚到正中常被它挡住）。
 * 配对笔记里 [!ai] 块里的图画成原文、没有图可亮：那一行左边闪一道竖线（insert-flash.ts 那道）。
 * 白板看法：平移到装着那一处的那张卡、外圈闪一下（同大纲点一张卡，flyToCard）。
 */
import { EditorView } from '@codemirror/view'
import { flashRange } from './insert-flash'
import { flyToCard } from './shell/OutlineView'

/** 文档看法：at 是图在原文里的位置；avoid 是盖在中间栏上的弹层 */
export function jumpInDoc(view: EditorView, at: number, avoid: Element | null) {
  const pos = Math.min(at, view.state.doc.length)
  const line = view.state.doc.lineAt(pos)
  view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) })
  view.focus()
  // 等滚完画好再量：那一行被弹层挡着就往下挪到弹层下沿和窗口下沿中间
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const img = imageAt(view, line.from)
      const r = img?.getBoundingClientRect() ?? lineRect(view, line.from, line.to)
      if (!r) return
      const sc = scrollParent(view.scrollDOM)
      const box = avoid?.getBoundingClientRect()
      if (sc && box) {
        const port = sc.getBoundingClientRect()
        const top = Math.max(port.top, box.bottom + 16)
        const room = port.bottom - top
        // 左右不重（弹层在中间栏另一边）、上沿已经在弹层下面的不挪；放不下（图比空着的那块高）就让图顶贴着弹层下沿
        if (r.right > box.left && r.left < box.right && r.top < box.bottom + 8) sc.scrollTop -= top + Math.max(0, (room - r.height) / 2) - r.top
      }
      if (img) {
        img.classList.remove('flown')
        void img.offsetWidth
        img.classList.add('flown')
      } else flashRange(view, { from: line.from, to: line.to })
    }),
  )
}

/** 白板看法：装着 at 的那张卡（卡上写着它在原文里从哪起，data-from），平移过去、外圈闪一下；找不到返回 false */
export function jumpInBoard(host: Element, notePath: string, at: number): boolean {
  let best: HTMLElement | null = null
  for (const el of host.querySelectorAll<HTMLElement>('.db-card[data-from][data-id]')) {
    const from = Number(el.dataset.from)
    if (from <= at && (!best || from >= Number(best.dataset.from))) best = el
  }
  if (!best?.dataset.id) return false
  flyToCard(notePath, best.dataset.id, { select: false })
  return true
}

/** 这一行画成的图（.cm-image 里的 img）；不是画成图的（提示块里的原文）是 null */
function imageAt(view: EditorView, from: number): HTMLImageElement | null {
  for (const img of view.contentDOM.querySelectorAll<HTMLImageElement>('.cm-image img')) {
    const fig = img.closest('.cm-image')!
    if (view.posAtDOM(fig) === from) return img
  }
  return null
}

function lineRect(view: EditorView, from: number, to: number): { top: number; bottom: number; left: number; right: number; height: number } | null {
  const a = view.coordsAtPos(from)
  const b = view.coordsAtPos(to)
  if (!a || !b) return null
  const c = view.contentDOM.getBoundingClientRect()
  return { top: a.top, bottom: b.bottom, left: c.left, right: c.right, height: b.bottom - a.top }
}

/** 真在滚的那一层（文档外面还套着一层版心时，滚的是外层） */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let e: HTMLElement | null = el; e; e = e.parentElement) {
    const oy = getComputedStyle(e).overflowY
    if ((oy === 'auto' || oy === 'scroll') && e.scrollHeight > e.clientHeight) return e
  }
  return null
}
