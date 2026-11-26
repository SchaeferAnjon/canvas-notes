/**
 * 收件箱「费曼学习需要检测到白板的内容」：在白板上开费曼时，材料要来自这块白板（卡上的字、图片卡、PDF 页卡、哪一列、连线、手写）。
 * 以前：在白板上直接写一个词只搜库，还把这块白板排除了；什么都没选时只能挑有标题的一列；连线、列名、手写都不进材料。
 */
import { describe, expect, it } from 'vitest'
import type { ExtractResult } from '../src/shared/feynman/api'
import { addRound } from '../src/shared/feynman/doc'
import { type AskQ, extract, type FlowDeps } from '../src/shared/feynman/flow'
import type { GatherDeps } from '../src/shared/feynman/material'
import { newMeta } from '../src/shared/feynman/round'

const BOARD = '课程/优化/梯度下降白板.md'
const PDF = '课程/优化/第3讲 优化.pdf'
const OLD_ROUND = addRound(
  '',
  newMeta(
    { topic: '旧的一轮', scope: 'point', points: [{ id: 'c1', kind: 'core', text: '旧要点', answer: '旧答案', basis: 'AI 判断' }], myths: [], from: [], cover: [], basisLine: '', by: 'Claude Code' },
    { today: '2026-11-20', nth: 1 },
  ),
)
const TEXT = `---
links:
  - g1 -> g2
  - g2 -> g9
---
# 梯度下降白板

## 想法

<!-- card id=g1 -->
梯度下降每一步沿负梯度走一小步。

<!-- card id=g2 -->
学习率太大会来回跳，太小走得慢。

![[第3讲 优化.pdf#page=2]]

## 图

![损失曲线](附件/梯度下降白板/曲线.png)

<!-- card id=g9 -->
动量：带着上一步的速度。

<!-- card id=f1 x=900 y=40 -->
拖到空白处的一张：凸函数的局部最小就是全局最小。

${OLD_ROUND}`

const FILES: Record<string, string> = {
  [BOARD]: TEXT,
  '笔记/优化.md': '# 优化\n\n梯度下降从一个初始猜测出发。\n',
}

function deps(log: AskQ[]): FlowDeps {
  const g: GatherDeps = {
    read: async (p) => FILES[p] ?? null,
    notes: async () => Object.keys(FILES),
    search: async (w) => Object.keys(FILES).filter((p) => FILES[p]!.includes(w)),
    pdf: async (p) => (p === PDF ? [{ page: 1, text: '封面' }, { page: 2, text: '第 2 页：步长 α 决定一步走多远' }] : null),
    hasFile: async (p) => p === '课程/优化/附件/梯度下降白板/曲线.png',
    findFile: async (name) => (name.endsWith('.pdf') ? PDF : null),
  }
  return { gather: g, ask: async (q) => (log.push(q), q.fake()), by: (img) => (img ? '看图那家' : '对话那家') }
}

const draftOf = (r: ExtractResult) => {
  if (r.kind === 'draft') return r.draft
  return r.items[0]!.draft ?? (() => { throw new Error('没抽好') })()
}

describe('在白板上开费曼：材料是这块白板', () => {
  it('在白板上直接写一个词：这块白板上说到它的卡当材料（带列名），再加库里的笔记；列头说出这几张卡', async () => {
    const log: AskQ[] = []
    const d = draftOf(await extract({ refs: [{ kind: 'word', word: '梯度' }], board: BOARD }, deps(log)))
    const prompt = log.find((q) => q.kind === 'extract')!.prompt
    expect(prompt).toContain('卡 1（「想法」那一列）')
    expect(prompt).toContain('梯度下降每一步沿负梯度走一小步')
    expect(prompt).toContain('笔记「优化」')
    // 以前的费曼轮不是材料
    expect(prompt).not.toContain('旧要点')
    expect(d.basisLine).toBe('照白板上说到「梯度」的 1 张卡、库里的 1 篇笔记核对')
    expect(d.cover).toContainEqual(expect.objectContaining({ kind: 'card', id: 'g1', why: 'picked' }))
  })

  it('整块白板：每张卡都读（PDF 页卡读那一页的字、图片卡的图交看图那家、拖到空白处的也算），哪一列、连线一起给；以前的费曼轮不算', async () => {
    const log: AskQ[] = []
    const d = draftOf(await extract({ refs: [{ kind: 'board', path: BOARD }], board: BOARD }, deps(log)))
    const q = log.find((x) => x.kind === 'extract')!
    expect(q.prompt).toContain('卡 2（「想法」那一列）')
    expect(q.prompt).toContain('第 2 页：步长 α 决定一步走多远')
    expect(q.prompt).toContain('凸函数的局部最小就是全局最小')
    expect(q.prompt).toContain('卡 4（「图」那一列）')
    expect(q.prompt).toContain('白板上这几张卡之间的连线\n- 卡 1 → 卡 2\n- 卡 2 → 卡 5')
    expect(q.prompt).not.toContain('旧要点')
    expect(q.images).toEqual([{ path: '课程/优化/附件/梯度下降白板/曲线.png' }])
    expect(d.basisLine).toBe('照这块白板上的 6 张卡核对')
    expect(d.from).toEqual([{ kind: 'board', path: BOARD }])
  })

  it('选中的几张卡：它们之间的连线一起给，连到没选的那张写它开头几个字', async () => {
    const log: AskQ[] = []
    await extract({ refs: [{ kind: 'card', path: BOARD, id: 'g1', head: '' }, { kind: 'card', path: BOARD, id: 'g2', head: '' }], board: BOARD }, deps(log))
    const prompt = log.find((q) => q.kind === 'extract')!.prompt
    expect(prompt).toContain('- 卡 1 → 卡 2\n- 卡 2 → 另一张「动量：带着上一步的速度。」')
  })

  it('白板上的手写拍成一张图：跟在材料后面交看图那家；只有手写也不算没材料', async () => {
    const log: AskQ[] = []
    const ink = { mime: 'image/png' as const, base64: 'iVBORw0KGgo=' }
    const d = draftOf(await extract({ refs: [{ kind: 'card', path: BOARD, id: 'g1', head: '' }], board: BOARD, ink }, deps(log)))
    const q = log.find((x) => x.kind === 'extract')!
    expect(q.images).toEqual([ink])
    expect(q.prompt).toContain('## 白板上的手写\n[图 1]')
    expect(d.basisLine).toBe('照选中的 1 张卡和白板上的手写核对')
    expect(d.by).toBe('看图那家')
    const only: AskQ[] = []
    const n = draftOf(await extract({ refs: [{ kind: 'word', word: '傅里叶' }], board: BOARD, ink }, deps(only)))
    expect(n.noMaterial).toBeUndefined()
    expect(n.basisLine).toBe('照白板上的手写核对')
  })
})
