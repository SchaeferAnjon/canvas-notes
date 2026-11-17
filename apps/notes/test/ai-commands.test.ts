import { describe, expect, it } from 'vitest'
import type { DreamItem, DreamReport } from '../src/shared/api'
import { dreamSummary, dropQuote, quoteOf } from '../src/renderer/ai-commands'

const LABELS = { file: '归类和改名', link: '补上的双链', dup: '可能重复', week: '本周小结' }
const item = (group: DreamItem['group'], n: number): DreamItem => ({ id: `${group}${n}`, group, title: 't', sub: 's', why: 'w', commit: null, files: [], state: 'pending' })
const report = (items: DreamItem[], notes: string[] = []): DreamReport => ({
  branch: 'dream/11-15',
  base: 'main',
  baseCommit: 'abc',
  started: 0,
  finished: 1,
  trigger: 'manual',
  items,
  notes,
  closed: false,
})

describe('/现在梦游 跑完的一句话', () => {
  it('整理了几条、分几组、每组几条，按报告里的顺序', () => {
    const s = dreamSummary(report([item('file', 1), item('file', 2), item('link', 1), item('week', 1)]), LABELS)
    expect(s).toEqual({ text: '梦游跑完了：整理了4条，分3组（归类和改名2 · 补上的双链1 · 本周小结1）。改动在dream/11-15分支上，收下才算数。', items: 4, groups: 3 })
  })

  it('没什么要整理的；有一组没做成时把说明带上', () => {
    expect(dreamSummary(report([], ['AI 不可用，收件箱没分类']), LABELS).text).toBe('梦游跑完了，没什么要整理的。\nAI 不可用，收件箱没分类')
  })
})

describe('⌘J 的引文', () => {
  const q = quoteOf('第一段甲。\n第二段 **粗体**。\n第三段甲。')
  it('原样的引文拿掉，问题留着', () => {
    expect(dropQuote(q + '这三段怎么合', q)).toBe('这三段怎么合')
  })
  it('引文里删过几个字、末尾接着打了问题：引文那几行照样拿掉', () => {
    expect(dropQuote(q.replace(' **粗体**', '') + '这句通顺吗', q)).toBe('这句通顺吗')
  })
  it('在引文最前面打了字：留下前面打的字', () => {
    expect(dropQuote('先问：' + q, q)).toBe('先问：')
    expect(dropQuote('先问：' + q.replace('第一段', '一段') + '帮我改', q)).toBe('先问：\n\n帮我改')
  })
  it('没有引文：原样', () => {
    expect(dropQuote('帮我改得口语一点', q)).toBe('帮我改得口语一点')
  })
})
