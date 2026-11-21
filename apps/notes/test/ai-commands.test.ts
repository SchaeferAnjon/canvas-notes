import { describe, expect, it } from 'vitest'
import type { DreamItem, DreamReport } from '../src/shared/api'
import { draftPath, dreamSummary } from '../src/renderer/ai-commands'

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

describe('/写成文章 的草稿放在哪', () => {
  it('白板在哪个文件夹，草稿就在哪个文件夹，名字是「白板名：文章草稿」', () => {
    expect(draftPath('课程/机器学习/冰岛自驾.md')).toBe('课程/机器学习/冰岛自驾：文章草稿.md')
    expect(draftPath('周记/2026-W47.md')).toBe('周记/2026-W47：文章草稿.md')
  })
  it('白板在库最外层或收件箱里：进收件箱', () => {
    expect(draftPath('计划.md')).toBe('收件箱/计划：文章草稿.md')
    expect(draftPath('收件箱/草图.md')).toBe('收件箱/草图：文章草稿.md')
  })
})
