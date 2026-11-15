import { Text } from '@codemirror/state'
import { expect, it } from 'vitest'
import { blockInsert } from '../src/renderer/web/doc-image-drop'
import { imageMarkdown } from '../src/renderer/web/image-drop'
import { activate, closeTab, EMPTY, followOwner, openTab, updateTab } from '../src/renderer/web/web-tabs'

it('网页标签：新开的排在当前后面并切过去；后台开不切；关当前切到右边那个；每个中间栏标签记住自己的网页', () => {
  let s = openTab(EMPTY, 'https://a.test/', { id: 'a', owner: 'note1' })
  s = openTab(s, 'https://b.test/', { id: 'b', owner: 'note1' })
  expect(s.tabs.map((t) => t.id)).toEqual(['a', 'b'])
  s = activate(s, 'a', 'note1')
  s = openTab(s, 'https://c.test/', { id: 'c', background: true })
  expect(s.tabs.map((t) => t.id)).toEqual(['a', 'c', 'b'])
  expect(s.active).toBe('a')
  // 另一个中间栏标签看 b
  s = activate(s, 'b', 'note2')
  expect(followOwner(s, 'note1').active).toBe('a')
  expect(followOwner(s, 'nobody').active).toBe('b')
  s = closeTab(activate(s, 'c', null), 'c')
  expect(s.active).toBe('b')
  s = closeTab(s, 'b')
  expect(s.active).toBe('a')
  expect(s.owners).toEqual({ note1: 'a' })
  expect(closeTab(s, 'a')).toEqual({ tabs: [], active: null, owners: {} })
  expect(updateTab(s, 'a', { title: '' })).toBe(s)
  expect(updateTab(s, 'a', { title: 'A' }).tabs[0]!.title).toBe('A')
})

it('拖进来的图写成 md：链接相对笔记本身；白板卡片里来源紧跟下一行，文档里另起一段', () => {
  const c = { alt: '黑[沙]滩', source: { title: '杂志 [冰岛]', url: 'https://x.test/a (b)' } }
  expect(imageMarkdown('a.md', '附件/黑沙滩.png', c)).toBe('![黑 沙 滩](附件/黑沙滩.png)\n—— [杂志  冰岛](https://x.test/a%20%28b%29)')
  expect(imageMarkdown('游记/冰岛/a.md', '附件/x.png', { alt: 'x' })).toBe('![x](../../附件/x.png)')
  expect(imageMarkdown('游记/a.md', '附件/x.png', c, '\n\n')).toBe('![黑 沙 滩](../附件/x.png)\n\n—— [杂志  冰岛](https://x.test/a%20%28b%29)')
})

it('图片插进文档：落在一段上就插在这段后面，落在空行上插在空行处，前后各空一行', () => {
  const ins = (doc: string, line: number) => {
    const t = Text.of(doc.split('\n'))
    const c = blockInsert(t, t.line(line).from, 'IMG')
    return doc.slice(0, c.from) + c.insert + doc.slice(c.from)
  }
  expect(ins('# 标题\n\n第一段。\n\n第二段。\n', 3)).toBe('# 标题\n\n第一段。\n\nIMG\n\n第二段。\n')
  expect(ins('第一段。\n第二段。', 1)).toBe('第一段。\n\nIMG\n\n第二段。')
  expect(ins('# 南岸\n\n', 2)).toBe('# 南岸\n\nIMG\n')
  expect(ins('# 南岸\n\n', 3)).toBe('# 南岸\n\nIMG\n')
  expect(ins('最后一段', 1)).toBe('最后一段\n\nIMG\n')
})
