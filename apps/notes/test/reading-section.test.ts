// 记笔记：一处的主对话和旁支收成笔记里的一段（新格式，CN-93–96）。问题是发出去的原话、回答原文，不让 AI 再改写
import { parseReadingNote, renderSection } from '@cn/format'
import { describe, expect, it } from 'vitest'
import { buildSection, roundText } from '../src/main/reading/section'
import type { ReadingMsg, ReadingSide, ReadingThread } from '../src/shared/reading'

const PDF = '课程/ecpc/Lecture05.pdf'
const NOTE = '课程/ecpc/Lecture05 笔记.md'
const thread: ReadingThread = { id: '.canvas-notes/对话/Lecture05-p28-1.md', page: 28, rect: [0.06, 0.3, 0.89, 0.6], crop: '附件/Lecture05/p28-1.png', cropW: 268, createdAt: new Date(2026, 10, 19, 20, 21).getTime() }
let n = 1
const t0 = thread.createdAt
const u = (text: string, extra: Partial<ReadingMsg> = {}): ReadingMsg => ({ id: n++, role: 'user', thread: thread.id, text, time: t0 + n * 1000, ...extra })
const a = (text: string, extra: Partial<ReadingMsg> = {}): ReadingMsg => ({ id: n++, role: 'ai', thread: thread.id, text, time: t0 + n * 1000, ...extra })

describe('一处收成笔记的一段', () => {
  const q1 = u('给我讲解一下', { image: thread.crop! })
  const a1 = a('## 水位怎么变\n\n一句话：LIF 是个漏水的桶。\n\n〔可以做个可视化〕\n〔配图 0.1,0.2,0.3,0.4 · 示意图〕')
  const q2 = u('还是不懂')
  const a2 = a('', { error: '停下了' })
  const q3 = u('还是不懂')
  const a3 = a('换个方式讲：先看图。')
  const side: ReadingSide = {
    id: 'b1',
    thread: thread.id,
    msg: a1.id,
    quote: '一句话：LIF 是个漏水的桶。',
    createdAt: t0 + 5000,
    msgs: [u('讲讲这句'), a('桶底有洞。'), u('①这个呢？', { mats: [{ kind: 'image', name: '0b9c7c2e-1111-4a5a-9b65-2f1b6a1d1e01.png', src: '粘贴的图' }] }), a('那是门槛。')],
  }
  const empty: ReadingSide = { id: 'b2', thread: thread.id, msg: a1.id, quote: '没问过的旁支', createdAt: t0 + 6000, msgs: [] }
  const other: ReadingSide = { id: 'b3', thread: 'x', msg: a1.id, quote: '别处的', createdAt: t0, msgs: [u('问'), a('答')] }

  it('问题原话、回答原文（去掉可视化、配图标记，标题降到 ###）；没答出来的不记；旁支挂在被问那一问后面；没问过的、别处的旁支不记', () => {
    const s = buildSection({
      pdf: PDF,
      thread,
      msgs: [q1, a1, q2, a2, q3, a3, u('另一处的', { thread: 'x' })],
      sides: [side, empty, other],
      title: 'LIF 神经元的三条公式',
      recap: 'LIF 是个漏水的桶；旁支问了为什么。',
      matPath: (name) => `附件/Lecture05/p28-1-${name.slice(0, 4)}.png`,
    })
    expect(s.qas).toEqual([
      {
        q: '给我讲解一下',
        a: '### 水位怎么变\n\n一句话：LIF 是个漏水的桶。',
        sides: [
          {
            quote: '一句话：LIF 是个漏水的桶。',
            turns: [
              { q: '讲讲这句', a: '桶底有洞。' },
              { q: '①这个呢？', a: '那是门槛。', mats: [{ kind: 'image', path: '附件/Lecture05/p28-1-0b9c.png', src: '粘贴的图' }] },
            ],
          },
        ],
      },
      { q: '还是不懂', a: '换个方式讲：先看图。', sides: [] },
    ])
    expect(s).toMatchObject({ id: thread.id, file: PDF, page: 28, rect: thread.rect, crop: thread.crop, cropW: 268, time: '20:21', title: 'LIF 神经元的三条公式', recap: 'LIF 是个漏水的桶；旁支问了为什么。' })
    // 写出来再读回来一样（笔记里的这一段就是它）
    expect(parseReadingNote(renderSection(s, NOTE), NOTE)).toEqual([s])
  })

  it('原来那段的双链、可视化、配的图留着；旧格式的那段同一处再问时整段换成新的', () => {
    const old = parseReadingNote(
      '## 第 28 页 · 旧的\n[第 28 页](Lecture05.pdf#page=28) · 20:00\n\n![第 28 页 · 示意图](../../附件/Lecture05/p28-1-fig.png)\n\n> [!question] 我的疑惑\n> 整块没看懂\n\n[完整对话 · 1 轮](../../.canvas-notes/对话/Lecture05-p28-1.md) · [可视化 · 水桶](水桶.html) · [[第4讲]]\n',
      NOTE,
    )[0]!
    const s = buildSection({ pdf: PDF, thread, msgs: [q1, a1], sides: [], title: '新的', recap: '小结', old, matPath: () => '' })
    expect(s.links).toEqual(['第4讲'])
    expect(s.viz).toEqual({ path: '课程/ecpc/水桶.html', title: '水桶' })
    expect(s.figures).toEqual([{ path: '附件/Lecture05/p28-1-fig.png', caption: '第 28 页 · 示意图' }])
    expect(s.qas).toHaveLength(1)
  })

  it('给快的模型看的这一轮：主对话【他】【AI】，旁支另起一行写被问的那句；回答太长截断', () => {
    const t = roundText([q1, a1, q3, a3], [side], 40)
    expect(t).toContain('【他】给我讲解一下\n【AI】### 水位怎么变')
    expect(t).toContain('【旁支】他在回答里选中「一句话：LIF 是个漏水的桶。」另问：\n【他·旁支】讲讲这句\n【AI·旁支】桶底有洞。')
    expect(t).not.toContain('〔可以做个可视化〕')
    expect(roundText([u('长'), a('字'.repeat(100))], [], 40)).toContain('字'.repeat(40) + '……')
  })
})
