/**
 * 数据库的记录文件夹藏到用它的那篇下面（task-5yp97，用户看图定「藏之后」）：markBases 记上几条、用它的那篇（同一个文件夹里的），
 * buildTree 把它挂到那篇下面（篇数照算）；那篇不在同一个文件夹、或者不在了，它照普通文件夹画。
 */
import { baseFoldersIn } from '@cn/format'
import { describe, expect, it } from 'vitest'
import { buildTree, type FileEntry, isBaseFolder, markBases, type TreeNode } from '../src/shared/files'

const md = (path: string): FileEntry => ({ path, kind: 'md', mtimeMs: 1 })
const dir = (path: string): FileEntry => ({ path, kind: 'dir', mtimeMs: 0 })
const base = (folder: string) => '# 笔记\n\n```base\nfilters:\n  and:\n    - file.inFolder("' + folder + '")\nviews:\n  - type: table\n    name: 表格\n```\n'
const find = (nodes: TreeNode[], path: string): TreeNode | undefined => {
  for (const n of nodes) {
    if (n.path === path) return n
    const hit = find(n.children, path)
    if (hit) return hit
  }
  return undefined
}

const FILES: FileEntry[] = [
  dir('课程'),
  dir('课程/sp'),
  md('课程/sp/学习笔记.md'),
  md('课程/sp/小论文.md'),
  dir('课程/sp/未命名数据库'),
  md('课程/sp/未命名数据库/第一条.md'),
  md('课程/sp/未命名数据库/第二条.md'),
  md('课程/sp/未命名数据库/第三条.md'),
  dir('写作'),
  md('写作/别处用它的.md'),
  dir('剪藏'),
  dir('剪藏/没人用的库'),
  md('剪藏/没人用的库/一条.md'),
]

describe('数据库的记录文件夹', () => {
  it('记上几条、用它的那篇（同一个文件夹里的）；别的文件夹里也有一篇用它，不算 owner；没人用的不是记录文件夹', () => {
    const texts = new Map([
      ['课程/sp/学习笔记.md', base('课程/sp/未命名数据库')],
      ['写作/别处用它的.md', base('课程/sp/未命名数据库')],
      ['课程/sp/小论文.md', '# 小论文\n'],
    ])
    const out = markBases(FILES, texts, baseFoldersIn)
    expect(out.find((f) => f.path === '课程/sp/未命名数据库')!.base).toEqual({ records: 3, owner: '课程/sp/学习笔记.md' })
    expect(out.find((f) => f.path === '剪藏/没人用的库')!.base).toBeUndefined()
    expect(out.filter(isBaseFolder).map((f) => f.path)).toEqual(['课程/sp/未命名数据库'])
  })

  it('目录树里挂到那篇下面：sp 里不再有这个文件夹，那篇的 children 是它；篇数照算（sp 还是 5）', () => {
    const texts = new Map([['课程/sp/学习笔记.md', base('课程/sp/未命名数据库')]])
    const tree = buildTree(markBases(FILES, texts, baseFoldersIn))
    const sp = find(tree, '课程/sp')!
    expect(sp.children.map((c) => c.path)).toEqual(['课程/sp/小论文.md', '课程/sp/学习笔记.md'])
    const note = find(tree, '课程/sp/学习笔记.md')!
    expect(note.children.map((c) => c.path)).toEqual(['课程/sp/未命名数据库'])
    expect(note.count).toBe(4)
    expect(sp.count).toBe(5)
  })

  it('那篇不在同一个文件夹（挪走了）、或者删了：照普通文件夹画，「移到」照旧不列它（还是记录文件夹）', () => {
    const moved = FILES.filter((f) => f.path !== '课程/sp/学习笔记.md').concat(md('写作/学习笔记.md'))
    const texts = new Map([['写作/学习笔记.md', base('课程/sp/未命名数据库')]])
    const out = markBases(moved, texts, baseFoldersIn)
    expect(out.find((f) => f.path === '课程/sp/未命名数据库')!.base).toEqual({ records: 3 })
    const tree = buildTree(out)
    expect(find(tree, '课程/sp')!.children.map((c) => c.path)).toContain('课程/sp/未命名数据库')
    expect(out.filter(isBaseFolder).map((f) => f.path)).toEqual(['课程/sp/未命名数据库'])
  })

  it('最外层固定的分类（课程、收件箱……）被最外层的一篇当数据源：照旧是分类，不挂到那篇下面，「移到」照样列', () => {
    const files: FileEntry[] = [...FILES, md('总览.md')]
    const texts = new Map([['总览.md', base('课程')]])
    const out = markBases(files, texts, baseFoldersIn)
    expect(out.find((f) => f.path === '课程')!.base).toBeUndefined()
    expect(out.filter(isBaseFolder)).toEqual([])
    const tree = buildTree(out)
    expect(tree.map((n) => n.path)).toContain('课程')
    expect(find(tree, '总览.md')!.children).toEqual([])
  })
})
