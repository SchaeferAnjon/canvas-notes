import { describe, expect, it } from 'vitest'
import { retargetTabs, type Tab, tabsOutside } from '../src/renderer/tabs'

const tabs: Tab[] = [
  { id: '1', type: 'note', path: '课程/ecp/笔记.md' },
  { id: '2', type: 'pdf', path: '课程/ecp/Lecture05.pdf' },
  { id: '3', type: 'folder', folder: '课程/ecp' },
  { id: '5', type: 'note', path: '课程/ecpx/a.md' },
  { id: '6', type: 'home' },
]

describe('文件夹改名、删掉时的标签', () => {
  it('改名：里面的文件、首页都换路径，别的不动', () => {
    expect(retargetTabs(tabs, '课程/ecp', '课程/ECP')).toEqual([
      { id: '1', type: 'note', path: '课程/ECP/笔记.md' },
      { id: '2', type: 'pdf', path: '课程/ECP/Lecture05.pdf' },
      { id: '3', type: 'folder', folder: '课程/ECP' },
      { id: '5', type: 'note', path: '课程/ecpx/a.md' },
      { id: '6', type: 'home' },
    ])
  })
  it('删掉：里面的标签关掉', () => {
    expect(tabsOutside(tabs, '课程/ecp').map((t) => t.id)).toEqual(['5', '6'])
  })
})
