import { describe, expect, it } from 'vitest'
import { enterAfterTitle, followsTitle, headingOf, nameFromTitle, titleRename } from '../src/renderer/title-follow'

describe('第一行标题就是文件名', () => {
  it('找开头的一级标题，跳过 frontmatter', () => {
    expect(headingOf('# 冰岛旅游 3\n\n正文')).toEqual({ line: 1, title: '冰岛旅游 3' })
    expect(headingOf('---\ntags: 旅行\n---\n# 冰岛\n')).toEqual({ line: 4, title: '冰岛' })
    expect(headingOf('正文\n# 后面的标题')).toBeNull()
    expect(headingOf('## 二级\n')).toBeNull()
  })

  it('新建的（标题和文件名一样）跟；标题本来就不一样的旧笔记不跟', () => {
    expect(followsTitle('# 未命名\n\n', '未命名.md')).toBe(true)
    expect(followsTitle('# 未命名\n\n', '写作/未命名 2.md')).toBe(false)
    expect(followsTitle('# 读书笔记：卡拉马佐夫\n', '卡拉马佐夫.md')).toBe(false)
  })

  it('新建的笔记在标题末尾回车：光标到标题下空一行的正文处；别的情况照常换行', () => {
    const t = '# 冰岛旅游 3\n\n'
    expect(enterAfterTitle(t, '# 冰岛旅游 3'.length)).toBe(t.length)
    expect(enterAfterTitle(t, 3)).toBeNull()
    expect(enterAfterTitle('# 标题\n\n正文\n', '# 标题'.length)).toBeNull()
    expect(enterAfterTitle('---\na: 1\n---\n# 标题\n\n', '---\na: 1\n---\n# 标题'.length)).toBe('---\na: 1\n---\n# 标题\n\n'.length)
  })

  it('标题改了才改名；/ \\ : 换成「-」', () => {
    expect(titleRename('# 冰岛旅游 3\n\n', '未命名.md', '未命名')).toBe('冰岛旅游 3')
    expect(titleRename('# 未命名\n\n', '未命名.md', '未命名')).toBeNull()
    expect(titleRename('# 2026/11 计划: 冰岛\n', '未命名.md', '未命名')).toBe('2026-11 计划- 冰岛')
    expect(nameFromTitle('  a\\b  ')).toBe('a-b')
    // 同名加了「 2」：标题没再动就不再改
    expect(titleRename('# 冰岛\n', '冰岛 2.md', '冰岛')).toBeNull()
    // 空标题不改
    expect(titleRename('# \n', '未命名.md', '未命名')).toBeNull()
  })
})
