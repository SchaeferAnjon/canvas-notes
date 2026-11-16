/**
 * 主进程替 AI 来问界面的事：现在看的是什么、编辑器里的字和光标、打开右栏网页、白板上卡片量出来多大。
 * 这些只有界面拿得到；主进程发 ai:call，这里做完用 aiReply 回。
 */
import { useEffect, useRef } from 'react'
import type { AgentContext, BridgeOp } from '../shared/agent'
import type { NoteFile } from '../shared/api'
import { titleOf } from '../shared/layout'
import { NoteDoc, type ViewMode } from './note-doc'
import type { Tab } from './tabs'

export interface BridgeState {
  tab: Tab | null
  mode: ViewMode
  doc: NoteDoc | null
  notes: NoteFile[]
  webOpen: boolean
  webUrl: string | null
  /** 在右栏打开网址（右栏没开就打开） */
  openWeb(url: string): void
}

export function contextOf(s: BridgeState, mentions: string[] = []): AgentContext {
  const t = s.tab
  const tab: AgentContext['tab'] =
    !t
      ? { type: 'none', title: '没有打开的标签' }
      : t.type === 'note'
        ? { type: 'note', title: titleOf(t.path), path: t.path, mode: s.mode, board: !!s.notes.find((n) => n.path === t.path)?.board }
        : t.type === 'inbox'
          ? { type: 'inbox', title: '收件箱' }
          : t.type === 'home'
            ? { type: 'home', title: '首页' }
            : t.type === 'web'
              ? { type: 'none', title: `中间栏的网页：${t.title || t.url}` }
              : t.type === 'pdf'
                ? { type: 'none', title: `PDF：${t.path}` }
              : t.type === 'doubts'
                ? { type: 'none', title: `我的疑惑：${t.folder || '库的根目录'}` }
              : t.type === 'html'
                ? { type: 'none', title: `HTML：${t.path}` }
              : t.type === 'webread'
                ? { type: 'none', title: `阅读视图：${t.title}（${t.url}）` }
              : t.type === 'all'
                ? { type: 'none', title: '全部笔记' }
                : t.type === 'archive'
                  ? { type: 'none', title: '归档' }
                  : t.type === 'folder'
                    ? { type: 'none', title: `${t.folder} 的首页` }
                    : { type: 'topic', title: `素材 / ${t.topic}` }
  const ctx: AgentContext = { tab, web: { open: s.webOpen, url: s.webUrl } }
  const d = s.doc
  if (d && t?.type === 'note' && d.path === t.path && s.mode !== 'board') {
    const sel = d.view.state.selection.main
    const text = d.view.state.sliceDoc(sel.from, sel.to).trim()
    if (text) ctx.selection = text.length > 2000 ? text.slice(0, 2000) + '…' : text
  }
  if (mentions.length) ctx.mentions = mentions
  return ctx
}

/** 当前文档的编辑器；路径对不上（用户中途换了标签）就不动 */
function docFor(s: BridgeState, path?: string): NoteDoc {
  const d = s.doc
  if (!d || s.tab?.type !== 'note' || d.path !== s.tab.path || s.mode === 'board') throw new Error('现在打开的不是文档')
  if (path && d.path !== path) throw new Error(`用户换到了别的标签（现在是 ${d.path}），这次没改`)
  if (d.readOnly) throw new Error('这篇只能只读打开，不能改')
  return d
}

/** 白板在屏幕上时，量每张卡和每一列多大（按白板上的像素，不受缩放影响） */
function measure(path: string): Record<string, { w: number; h: number }> {
  const pane = [...document.querySelectorAll<HTMLElement>('.pane:not([hidden])')].find((p) => p.dataset.path === path)
  const board = pane?.querySelector<HTMLElement>('[data-testid="board"]')
  if (!board) return {}
  const out: Record<string, { w: number; h: number }> = {}
  for (const el of board.querySelectorAll<HTMLElement>('.bcard[data-id], .bcol[data-id]')) {
    const r = el.getBoundingClientRect()
    const scale = el.offsetWidth ? r.width / el.offsetWidth : 1
    out[el.dataset.id!] = { w: Math.round(r.width / scale), h: Math.round(r.height / scale) }
  }
  return out
}

async function handle(s: BridgeState, op: BridgeOp, arg: unknown): Promise<unknown> {
  switch (op) {
    case 'saveAll':
      return NoteDoc.saveAll()
    case 'context':
      return contextOf(s)
    case 'openWeb':
      if (!s.tab) throw new Error('先打开一个标签，网页跟着标签走')
      s.openWeb(String(arg))
      return null
    case 'measure':
      return measure(String(arg))
    case 'docRead': {
      const d = docFor(s)
      const sel = d.view.state.selection.main
      return { path: d.path, text: d.text, selection: d.view.state.sliceDoc(sel.from, sel.to) }
    }
    case 'docInsert': {
      const { path, text } = arg as { path: string; text: string }
      const d = docFor(s, path)
      d.insertAtCursor(text.replace(/\n+$/, ''))
      await d.save()
      return null
    }
    case 'docReplace': {
      const { path, text } = arg as { path: string; text: string }
      const d = docFor(s, path)
      const sel = d.view.state.selection.main
      if (sel.empty) throw new Error('文档里没有选中的字。请用户先选中要换的那段。')
      d.view.dispatch({ changes: { from: sel.from, to: sel.to, insert: text }, selection: { anchor: sel.from, head: sel.from + text.length }, userEvent: 'input.ai' })
      await d.save()
      return null
    }
  }
}

export function useAiBridge(state: BridgeState) {
  const ref = useRef(state)
  ref.current = state
  useEffect(
    () =>
      window.cn.onAiCall((id, op, arg) => {
        handle(ref.current, op, arg).then(
          (v) => void window.cn.aiReply(id, true, v ?? null),
          (e: unknown) => void window.cn.aiReply(id, false, String((e as Error).message ?? e)),
        )
      }),
    [],
  )
}
