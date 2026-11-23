import { describe, expect, it } from 'vitest'
import { filterItems, itemMd } from '../src/renderer/slash-menu'
import { setUiLang } from '../src/shared/i18n'

describe('斜杠菜单列哪几项', () => {
  it('文档、白板（type: board）都有「数据库」：2026-11-21 起白板上画成数据库卡', () => {
    expect(filterItems('数据').map((i) => i.id)).toContain('base')
    expect(filterItems('').map((i) => i.id)).toContain('base')
    expect(filterItems('').map((i) => i.id)).toContain('details')
  })

  it('打字筛：英文界面另认英文名的词头（打 numbered、database 能找到，打中文照样找到）；中文界面和以前一样，打 ai 第一个还是 AI 那几项', () => {
    expect(filterItems('ai')[0]!.label).toMatch(/^AI/)
    expect(filterItems('numbered')).toEqual([])
    setUiLang('en')
    try {
      expect(filterItems('numbered').map((i) => i.id)).toContain('ordered')
      expect(filterItems('Database').map((i) => i.id)).toContain('base')
      expect(filterItems('编号').map((i) => i.id)).toContain('ordered')
      expect(filterItems('ai')[0]!.label).toMatch(/^AI/)
    } finally {
      setUiLang('zh')
    }
  })

  it('白板卡片里打 /（偏好「白板卡别挂位置行」：空白卡片也能打 /）：标题、小标题插 ####、#####，不然会变成新的一列；右边的写法跟着写', () => {
    expect(itemMd('h2', true)).toBe('####')
    expect(itemMd('h3', true)).toBe('#####')
    expect(itemMd('h2', false)).toBe('##')
    expect(itemMd('todo', true)).toBe('- [ ]')
  })

  // task-r00en（「找不到的功能」第 6 件，用户定「全部列出来」）：提示块 5 种不打字就列，拼音、英文、中文都搜得到
  const CALLOUTS = ['callout-info', 'callout-warning', 'callout-question', 'callout-success', 'callout-danger']
  const callouts = (q: string) => filterItems(q).map((i) => i.id).filter((id) => id.startsWith('callout-'))

  it('不打字时 5 种提示块（说明、注意、疑惑、讲通了、出错）都列出来，挨在一起', () => {
    const ids = filterItems('').map((i) => i.id)
    expect(callouts('')).toEqual(CALLOUTS)
    const at = ids.indexOf('callout-info')
    expect(ids.slice(at, at + 5)).toEqual(CALLOUTS)
  })

  it('打 tishi、tip、callout、提示、tsk 都出 5 种（用户原话「tishi 和 tip 两种」）', () => {
    for (const q of ['tishi', 'tip', 'callout', '提示', '提示块', 'tsk']) expect(callouts(q), q).toEqual(CALLOUTS)
  })

  it('每一种按自己的拼音、英文、中文名搜得到', () => {
    const cases: [string, string][] = [
      ['shuoming', 'callout-info'], ['info', 'callout-info'], ['note', 'callout-info'], ['说明', 'callout-info'],
      ['zhuyi', 'callout-warning'], ['warning', 'callout-warning'], ['caution', 'callout-warning'], ['注意', 'callout-warning'],
      ['yihuo', 'callout-question'], ['question', 'callout-question'], ['faq', 'callout-question'], ['疑惑', 'callout-question'],
      ['jiangtongle', 'callout-success'], ['success', 'callout-success'], ['讲通了', 'callout-success'],
      ['chucuo', 'callout-danger'], ['error', 'callout-danger'], ['danger', 'callout-danger'], ['bug', 'callout-danger'], ['出错', 'callout-danger'],
    ]
    for (const [q, id] of cases) expect(callouts(q), q).toEqual([id])
  })
})
