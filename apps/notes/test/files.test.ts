import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildTree, type FileEntry, folderProgress, matchFiles, parseProgress } from '../src/shared/files'

vi.mock('electron', () => ({ ipcMain: { handle: () => undefined } }))

const f = (path: string, kind: FileEntry['kind'] = 'md', mtimeMs = 0, progress?: FileEntry['progress']): FileEntry => ({ path, kind, mtimeMs, ...(progress ? { progress } : {}) })

describe('⌘O 按名字筛', () => {
  const files = [f('课程/线性代数/第3讲 线性映射.pdf', 'pdf', 1), f('课程/线性代数/第3讲 线性映射 笔记.md', 'md', 2), f('生活/映射表.md', 'md', 3), f('写作/线性代数学习心得.md', 'md', 4), f('课程/线性代数', 'dir')]
  it('连着有的在前（开头就是的更前），按顺序都出现的次之，字都出现的最后；名字短的、新改的在前', () => {
    expect(matchFiles(files, '线性').items.map((x) => x.path)).toEqual(['课程/线性代数', '写作/线性代数学习心得.md', '课程/线性代数/第3讲 线性映射.pdf', '课程/线性代数/第3讲 线性映射 笔记.md'])
    // 「3映射」：字按顺序出现
    expect(matchFiles(files, '3映射').items.map((x) => x.path)).toEqual(['课程/线性代数/第3讲 线性映射.pdf', '课程/线性代数/第3讲 线性映射 笔记.md'])
    // 空格分开的几段都要有
    expect(matchFiles(files, '第3讲 笔记').items.map((x) => x.path)).toEqual(['课程/线性代数/第3讲 线性映射 笔记.md'])
    expect(matchFiles(files, '没有这个').items).toEqual([])
  })
  it('多了只给前几个，告诉还有几个', () => {
    const many = Array.from({ length: 120 }, (_, i) => f(`日记/第 ${i} 天.md`))
    const r = matchFiles(many, '天', 50)
    expect(r.items).toHaveLength(50)
    expect(r.more).toBe(70)
  })
})

describe('目录树', () => {
  it('顶层按 课程 / 项目 / 生活 / 写作 排；文件夹在前；我的疑惑、术语表放最上；同一讲的课件、笔记挨着，讲次按数字排', () => {
    const tree = buildTree([
      f('写作/a.md'),
      f('生活/b.md'),
      f('别的/c.md'),
      f('课程/线性代数/第10讲 二次型.pdf', 'pdf'),
      f('课程/线性代数/第3讲 线性映射 笔记.md'),
      f('课程/线性代数/第3讲 线性映射.pdf', 'pdf'),
      f('课程/线性代数/旋转矩阵.html', 'html'),
      { path: '课程/线性代数/向量加法.html', kind: 'html', mtimeMs: 0, lecture: 3 },
      f('课程/线性代数/我的疑惑.md'),
      f('课程/线性代数/术语表.md'),
      f('项目/canvas', 'dir'),
      f('README.md'),
    ])
    expect(tree.map((n) => n.name)).toEqual(['课程', '项目', '生活', '写作', '别的', 'README.md'])
    const la = tree[0]!.children[0]!
    expect(la.path).toBe('课程/线性代数')
    expect(la.children.map((n) => n.name)).toEqual(['我的疑惑.md', '术语表.md', '第3讲 线性映射.pdf', '第3讲 线性映射 笔记.md', '向量加法.html', '第10讲 二次型.pdf', '旋转矩阵.html'])
    // 空文件夹也在
    expect(tree[1]!.children.map((n) => [n.name, n.kind])).toEqual([['canvas', 'dir']])
  })

  it('课程文件夹：课件问完了几份 / 一共几份', () => {
    const [course] = buildTree([f('课/第1讲.pdf', 'pdf', 0, { asked: 10, pages: 10 }), f('课/第2讲.pdf', 'pdf', 0, { asked: 3, pages: 12 }), f('课/第3讲.pdf', 'pdf'), f('课/笔记.md')])
    expect(folderProgress(course!)).toEqual({ done: 1, total: 3 })
    expect(folderProgress(buildTree([f('空/a.md')])[0]!)).toBeNull()
    expect(parseProgress('5 / 10')).toEqual({ asked: 5, pages: 10 })
    expect(parseProgress('五')).toBeUndefined()
  })
})

describe('列出库里的文件（主进程）', () => {
  let root: string
  afterEach(() => rmSync(root, { recursive: true, force: true }))
  it('md、PDF、HTML 和文件夹；PDF 带旁边笔记里的进度；隐藏的、附件不列', async () => {
    const { listEntries } = await import('../src/main/files')
    root = mkdtempSync(join(tmpdir(), 'cn-files-'))
    for (const d of ['课程/线性代数', '.git', '.canvas-notes', '附件/第3讲']) mkdirSync(join(root, d), { recursive: true })
    writeFileSync(join(root, '课程/线性代数/第3讲 线性映射.pdf'), '%PDF')
    writeFileSync(join(root, '课程/线性代数/第3讲 线性映射 笔记.md'), '---\n类型: 笔记\n进度: 5/10\n---\n## 第 5 页\n')
    writeFileSync(join(root, '课程/线性代数/第4讲.pdf'), '%PDF')
    writeFileSync(join(root, '课程/线性代数/旋转矩阵.html'), '<html><head>\n<meta name="类型" content="可视化">\n<meta name="第几讲" content="3">\n<title>x</title>')
    writeFileSync(join(root, '课程/线性代数/图.png'), 'x')
    writeFileSync(join(root, '附件/第3讲/p5-1.png'), 'x')
    writeFileSync(join(root, '.canvas-notes/置顶.json'), '[]')
    const all = await listEntries(root)
    expect(all.map((e) => `${e.kind}:${e.path}`).sort()).toEqual(
      ['dir:课程', 'dir:课程/线性代数', 'pdf:课程/线性代数/第3讲 线性映射.pdf', 'md:课程/线性代数/第3讲 线性映射 笔记.md', 'pdf:课程/线性代数/第4讲.pdf', 'html:课程/线性代数/旋转矩阵.html'].sort(),
    )
    expect(all.find((e) => e.path.endsWith('第3讲 线性映射.pdf'))!.progress).toEqual({ asked: 5, pages: 10 })
    expect(all.find((e) => e.path.endsWith('第4讲.pdf'))!.progress).toBeUndefined()
    expect(all.find((e) => e.path.endsWith('旋转矩阵.html'))!.lecture).toBe(3)
  })
})
