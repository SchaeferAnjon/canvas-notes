/**
 * 字幕全文那一篇（frontmatter 里 type: video）里「AI 摘要没写成：原因」那一行：行首一个红色 error 图标，行末一个「再试一次」，
 * 和 AI 出错那一行（.aierr）一个样子。点了主进程重写摘要（视频开着按它的字幕，没开着按这一篇里存的字幕），那一行先变回「AI 在写摘要…」。
 * 只加装饰不改文字。
 */
import { codiconSvg } from '@cn/design/codicon-svg'
import { type EditorState, type Range } from '@codemirror/state'
import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view'
import { SUMMARY_FAILED } from '../../shared/video'

const isVideoDoc = (state: EditorState) => /^---\n(?:[\s\S]*?\n)?type: video\n/.test(state.doc.sliceString(0, Math.min(state.doc.length, 600)))

class ErrorIcon extends WidgetType {
  eq() {
    return true
  }
  toDOM() {
    const i = document.createElement('span')
    i.className = 'cm-verr'
    i.setAttribute('aria-hidden', 'true')
    i.innerHTML = codiconSvg('error', { size: 12 })
    return i
  }
}

class RetryWidget extends WidgetType {
  constructor(readonly run: () => Promise<void>) {
    super()
  }
  eq() {
    return true
  }
  toDOM() {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'cm-vretry'
    b.innerHTML = codiconSvg('refresh', { size: 12 })
    b.append('再试一次')
    b.addEventListener('mousedown', (e) => {
      e.preventDefault()
      b.disabled = true
      void this.run().finally(() => (b.disabled = false))
    })
    return b
  }
  ignoreEvent() {
    return true
  }
}

function build(state: EditorState, run: () => Promise<void>): DecorationSet {
  if (!isVideoDoc(state)) return Decoration.none
  const out: Range<Decoration>[] = []
  let inSummary = false
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n)
    if (/^## /.test(line.text)) {
      if (inSummary) break
      inSummary = line.text === '## AI 摘要'
      continue
    }
    if (inSummary && line.text.startsWith(SUMMARY_FAILED)) {
      out.push(Decoration.widget({ widget: new ErrorIcon(), side: -1 }).range(line.from))
      out.push(Decoration.widget({ widget: new RetryWidget(run), side: 1 }).range(line.to))
    }
  }
  return Decoration.set(out)
}

export function summaryRetry(path: () => string, notice: (text: string) => void) {
  const run = () =>
    window.cnVideo.retrySummary(path()).catch((e: unknown) => notice(String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = build(view.state, run)
      }
      update(u: ViewUpdate) {
        if (u.docChanged) this.decorations = build(u.state, run)
      }
    },
    { decorations: (v) => v.decorations },
  )
}
