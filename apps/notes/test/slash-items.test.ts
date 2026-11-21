import { describe, expect, it } from 'vitest'
import { filterItems, itemMd } from '../src/renderer/slash-menu'

describe('斜杠菜单列哪几项', () => {
  it('文档、白板（type: board）都有「数据库」：2026-11-21 起白板上画成数据库卡', () => {
    expect(filterItems('数据').map((i) => i.id)).toContain('base')
    expect(filterItems('').map((i) => i.id)).toContain('base')
    expect(filterItems('').map((i) => i.id)).toContain('details')
  })

  it('白板卡片里打 /（偏好「白板卡别挂位置行」：空白卡片也能打 /）：标题、小标题插 ####、#####，不然会变成新的一列；右边的写法跟着写', () => {
    expect(itemMd('h2', true)).toBe('####')
    expect(itemMd('h3', true)).toBe('#####')
    expect(itemMd('h2', false)).toBe('##')
    expect(itemMd('todo', true)).toBe('- [ ]')
  })
})
