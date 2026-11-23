/**
 * 别处要一篇笔记换成某种看法（AI 回答里 ⌘点「白板.md#^卡号」要白板看法，task-3e53q）：
 * 标签可能还没开出来，先记着；NoteTab 开出来、或者已经开着的收到叫一声时拿走。
 */
import type { NoteView } from '../shared/prefs'

const want = new Map<string, NoteView>()
const bus = new EventTarget()

export function wantView(path: string, mode: NoteView) {
  want.set(path, mode)
  bus.dispatchEvent(new CustomEvent('want', { detail: path }))
}

/** 有人要这一篇换成哪种看法（拿走就没了） */
export function takeView(path: string): NoteView | undefined {
  const m = want.get(path)
  want.delete(path)
  return m
}

export function onWantView(path: string, f: () => void): () => void {
  const h = (e: Event) => (e as CustomEvent<string>).detail === path && f()
  bus.addEventListener('want', h)
  return () => bus.removeEventListener('want', h)
}
