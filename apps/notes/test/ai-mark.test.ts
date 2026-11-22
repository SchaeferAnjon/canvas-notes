/**
 * AI 块头上的「改过」（task-dtc34）只认用户自己动手改了块里的字。
 * 软件写进来的（视频框一块问答好以后在讲解块下面补空段落、剪藏和 AI 回答插进来、接着问补在块后面）不算：
 * 以前这些用 userEvent「input.clip」，被当成手打，讲解块一答好头上就多了「改过」。
 */
import { EditorState, type TransactionSpec } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { markEditedOnType } from '../src/renderer/ai-mark'

const HEAD = '> [!ai] AI 讲解 · Claude Code · Opus 5.5 · 看了 00:06 这一帧、00:00–00:36 的字幕'
const DOC = `# 看视频的笔记\n\n${HEAD}\n> 框里是 i 帽和 j 帽变换后的位置。\n>\n> - 矩阵的两列就是这两个落点\n`

const run = (spec: (s: EditorState) => TransactionSpec) => {
  const s = EditorState.create({ doc: DOC, extensions: markEditedOnType })
  return s.update(spec(s)).state.doc.toString()
}
const blockEnd = DOC.indexOf('落点') + 2

describe('AI 块的「改过」', () => {
  it('视频问答答好以后在块下面补空段落（换掉块后面的换行，input.clip）：不加', () => {
    const out = run(() => ({ changes: { from: blockEnd, to: blockEnd + 1, insert: '\n\n\n' }, userEvent: 'input.clip' }))
    expect(out).toContain(`${HEAD}\n`)
    expect(out).not.toContain('改过')
  })

  it('剪藏、AI 回答插进块里（input.clip）：不加', () => {
    const at = DOC.indexOf('位置。') + 3
    expect(run(() => ({ changes: { from: at, insert: '\n>\n> 剪进来的一段' }, userEvent: 'input.clip' }))).not.toContain('改过')
  })

  it('读书同步、旁支写回（input.sync、input.side）：不加', () => {
    const at = DOC.indexOf('位置。') + 3
    expect(run(() => ({ changes: { from: at, insert: '同步' }, userEvent: 'input.sync' }))).not.toContain('改过')
    expect(run(() => ({ changes: { from: at, insert: '旁支' }, userEvent: 'input.side' }))).not.toContain('改过')
  })

  it('用户在块里打字、粘贴、删字：加一次', () => {
    const at = DOC.indexOf('位置。') + 3
    expect(run(() => ({ changes: { from: at, insert: '好' }, userEvent: 'input.type' }))).toContain(`${HEAD} · 改过\n`)
    expect(run(() => ({ changes: { from: at, insert: '贴的' }, userEvent: 'input.paste' }))).toContain(`${HEAD} · 改过\n`)
    expect(run(() => ({ changes: { from: at - 1, to: at }, userEvent: 'delete.backward' }))).toContain(`${HEAD} · 改过\n`)
  })
})
