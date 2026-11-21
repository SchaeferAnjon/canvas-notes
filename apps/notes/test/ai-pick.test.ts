// 左栏选了好几个交给 AI（task-0tgz2，偏好「多选文件能交给 AI」）：文件夹算里面的笔记；交给 AI 的那一行写清是哪几篇
import { describe, expect, it } from 'vitest'
import { describeContext } from '../src/main/agent/context'
import { MULTI, pickAsk } from '../src/renderer/ai-greet'
import { pickedFiles, pickTip } from '../src/renderer/ai-pick'
import type { FileEntry } from '../src/shared/files'

const f = (path: string, kind: FileEntry['kind'] = 'md'): FileEntry => ({ path, kind, mtimeMs: 0 })
const files = [f('周记/2026-W47.md'), f('周记/旧/2026-W40.md'), f('周记/图.png', 'img'), f('周记/讲义.pdf', 'pdf'), f('冰岛.md'), f('菜谱.md'), f('周记/旧', 'dir')]

describe('选中的展开成文件', () => {
  it('文件照旧，文件夹换成里面的笔记、PDF、HTML（子文件夹也算，图不算），去重、按选的顺序', () => {
    const items = [
      { path: '冰岛.md', dir: false },
      { path: '周记', dir: true },
      { path: '周记/2026-W47.md', dir: false },
    ]
    expect(pickedFiles(items, files)).toEqual(['冰岛.md', '周记/2026-W47.md', '周记/旧/2026-W40.md', '周记/讲义.pdf'])
  })
  it('悬停提示一个一行，文件夹写里面几篇', () => {
    expect(pickTip([{ path: '冰岛.md', dir: false }, { path: '周记', dir: true }], files)).toBe('冰岛\n周记（3篇）')
  })
})

describe('交给 AI 的那一行', () => {
  const web = { open: false, url: null }
  it('写选了几个、一共几篇、是哪几篇', () => {
    const c = describeContext({ tab: { type: 'note', title: '随手记', path: '随手记.md', mode: 'doc' }, web, picked: { count: 2, files: ['冰岛.md', '菜谱.md'] } })
    expect(c.split('\n').pop()).toBe('用户在左栏选中了2个（文件夹算里面的笔记），一共2篇，问的「选中的这几篇」就是它们：冰岛.md、菜谱.md')
  })
  it('篇数多时只列前 200 篇，写一共几篇', () => {
    const many = Array.from({ length: 250 }, (_, i) => `a/${i}.md`)
    const line = describeContext({ tab: { type: 'none', title: '' }, web, picked: { count: 1, files: many } }).split('\n').pop()!
    expect(line.startsWith('用户在左栏选中了1个（文件夹算里面的笔记），一共250篇，问的「选中的这几篇」就是它们（只列前200篇）：a/0.md、')).toBe(true)
    expect(line.endsWith('a/199.md')).toBe(true)
  })
})

describe('选了好几个时的问候和快捷命令', () => {
  it('问候那一句写选了几个；快捷命令五条，点了发的话都说「选中的这几篇」', () => {
    expect(pickAsk(5)).toBe('要对选中的5个做点什么？')
    expect(MULTI.map((m) => m.text)).toEqual(['总结这几篇', '合成一篇', '找出重复的', '归到该去的分类', '列成表'])
    for (const m of MULTI) expect(m.ask).toContain('选中的这几篇')
  })
})
