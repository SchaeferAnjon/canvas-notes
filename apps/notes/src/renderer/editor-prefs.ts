/**
 * 设置 › 文档和白板的「文字」一组和白板点阵、拼写检查套到窗口上：<html> 上的 --doc-font、--doc-size、--doc-lh、--doc-w
 * （app.css 的 .doc 用它们），data-board-dots；开着的编辑器当场跟着变（NoteDoc.restyle、setSpell）。
 */
import { DOC_FONTS, DOC_WIDTHS, type DocFont, type EditorPrefs, LINE_HEIGHTS } from '../shared/prefs'
import { NoteDoc } from './note-doc'

export function applyEditorPrefs(e: EditorPrefs) {
  const root = document.documentElement
  root.style.setProperty('--doc-font', DOC_FONTS.find((f) => f.id === e.font)!.css)
  root.style.setProperty('--doc-size', `${e.size}px`)
  root.style.setProperty('--doc-lh', String(LINE_HEIGHTS[e.lineHeight].value))
  root.style.setProperty('--doc-w', `${DOC_WIDTHS[e.width].px}px`)
  root.dataset.boardDots = e.boardDots ? 'on' : 'off'
  NoteDoc.setSpell(e.spell)
  requestAnimationFrame(() => NoteDoc.restyle())
}

const installed = new Map<DocFont, boolean>()

/**
 * 这台 Mac 上有没有这款字体：同一串字用「它, 兜底字体」和只用兜底字体各量一次宽，不一样就是有
 * （document.fonts.check 对系统字体总说有，量不出来；中文字都是一个字宽，所以量西文和数字）
 */
export function fontInstalled(id: DocFont): boolean {
  const f = DOC_FONTS.find((x) => x.id === id)!
  if (!f.probe) return true
  const hit = installed.get(id)
  if (hit !== undefined) return hit
  const ctx = document.createElement('canvas').getContext('2d')!
  const text = 'mmmmmmmmmmlli WWWiiil 0123456789 Typography'
  const width = (family: string) => {
    ctx.font = `20px ${family}`
    return ctx.measureText(text).width
  }
  const ok = ['monospace', 'sans-serif'].some((fb) => width(`"${f.probe}", ${fb}`) !== width(fb))
  installed.set(id, ok)
  return ok
}
