import { describe, expect, it } from 'vitest'
import { filterItems } from '../src/renderer/slash-menu'

describe('斜杠菜单列哪几项', () => {
  it('普通文档有「数据库」；白板（type: board）在文档里看时没有（白板上画不出表）', () => {
    expect(filterItems('数据').map((i) => i.id)).toContain('base')
    expect(filterItems('数据', true).map((i) => i.id)).not.toContain('base')
    expect(filterItems('', true).map((i) => i.id)).not.toContain('base')
    expect(filterItems('', true).map((i) => i.id)).toContain('details')
  })
})
