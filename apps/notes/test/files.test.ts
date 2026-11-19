import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildTree, type FileEntry, fixedFolder, folderProgress, matchFiles, parseProgress, subtree } from '../src/shared/files'

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
  it('顶层按顶级分类的先后排（收件箱、课程、阅读、剪藏、周记、写作、项目、生活）；文件夹在前；我的疑惑、术语表放最上；同一讲的课件、笔记挨着，讲次按数字排', () => {
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
    expect(tree.map((n) => n.name)).toEqual(['课程', '写作', '项目', '生活', '别的', 'README.md'])
    const la = tree[0]!.children[0]!
    expect(la.path).toBe('课程/线性代数')
    expect(la.children.map((n) => n.name)).toEqual(['我的疑惑.md', '术语表.md', '第3讲 线性映射.pdf', '第3讲 线性映射 笔记.md', '向量加法.html', '第10讲 二次型.pdf', '旋转矩阵.html'])
    // 空文件夹也在
    expect(tree[2]!.children.map((n) => [n.name, n.kind])).toEqual([['canvas', 'dir']])
  })

  it('六种排法：修改时间、创建时间、名字各有正反；文件夹排在前面（按时间排时算里面最新的那个）', () => {
    const files: FileEntry[] = [
      { path: '写作/旧.md', kind: 'md', mtimeMs: 100, ctimeMs: 10 },
      { path: '写作/新.md', kind: 'md', mtimeMs: 300, ctimeMs: 5 },
      { path: '写作/中.md', kind: 'md', mtimeMs: 200, ctimeMs: 30 },
      { path: '写作/旅行', kind: 'dir', mtimeMs: 0 },
      { path: '写作/书评/a.md', kind: 'md', mtimeMs: 250, ctimeMs: 1 },
    ]
    const names = (o: Parameters<typeof buildTree>[1]) => buildTree(files, o)[0]!.children.map((n) => n.name)
    expect(names({ sort: 'name-asc' })).toEqual(['旅行', '书评', '旧.md', '新.md', '中.md'])
    expect(names({ sort: 'name-desc' })).toEqual(['书评', '旅行', '中.md', '新.md', '旧.md'])
    expect(names({ sort: 'mtime-desc' })).toEqual(['书评', '旅行', '新.md', '中.md', '旧.md'])
    expect(names({ sort: 'mtime-asc' })).toEqual(['旅行', '书评', '旧.md', '中.md', '新.md'])
    expect(names({ sort: 'ctime-desc' })).toEqual(['书评', '旅行', '中.md', '旧.md', '新.md'])
    expect(names({ sort: 'ctime-asc' })).toEqual(['旅行', '书评', '新.md', '旧.md', '中.md'])
    // 文件夹不排在前面：和文件一起按时间排
    expect(names({ sort: 'mtime-desc', foldersFirst: false })).toEqual(['新.md', '书评', '中.md', '旧.md', '旅行'])
    expect(fixedFolder('写作')).toBe(true)
    expect(fixedFolder('写作/旅行')).toBe(false)
  })

  it('篇数：每个文件夹里（含子文件夹）有几个文件；置顶的排在最前（文件夹写成「写作/」），关了就照常排', () => {
    const files = [f('写作/a.md'), f('写作/b/c.md'), f('写作/b/d.pdf', 'pdf'), f('课程/x.md'), f('收件箱/y.md'), f('空的', 'dir')]
    const t = buildTree(files, { pins: new Set(['收件箱/', '写作/b.md']) })
    const p = buildTree(files, { pins: new Set(['写作/', '写作/b.md']) })
    expect(p.map((n) => [n.name, n.count, !!n.pinned])).toEqual([['写作', 3, true], ['收件箱', 1, false], ['课程', 1, false], ['空的', 0, false]])
    expect(t.map((n) => n.name)).toEqual(['收件箱', '课程', '写作', '空的'])
    expect(t[2]!.children.map((n) => [n.name, n.count])).toEqual([['b', 2], ['a.md', 1]])
    expect(buildTree(files, { pins: new Set(['写作/']), pinsFirst: false }).map((n) => n.name)).toEqual(['收件箱', '课程', '写作', '空的'])
  })

  it('类型筛选：只留这类文件，里面没有这类文件的文件夹（含空文件夹）不画；篇数跟着变', () => {
    const files = [f('写作/a.md'), f('写作/b/c.md'), f('写作/b/d.pdf', 'pdf'), f('课程/x.md'), f('空的', 'dir'), f('写作/b', 'dir')]
    const t = buildTree(files, { keep: (x) => x.kind === 'pdf' })
    expect(t.map((n) => [n.name, n.count])).toEqual([['写作', 1]])
    expect(t[0]!.children[0]!.entry?.kind).toBe('dir')
    expect(subtree(buildTree(files), '写作/b').map((n) => n.name)).toEqual(['c.md', 'd.pdf'])
    expect(subtree(buildTree(files), '没有')).toEqual([])
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
  it('md、PDF、HTML、文件夹和 附件/ 里的图（带大小）；PDF 带旁边笔记里的进度；隐藏的、库里别处的图不列', async () => {
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
      [
        'dir:课程',
        'dir:课程/线性代数',
        'pdf:课程/线性代数/第3讲 线性映射.pdf',
        'md:课程/线性代数/第3讲 线性映射 笔记.md',
        'pdf:课程/线性代数/第4讲.pdf',
        'html:课程/线性代数/旋转矩阵.html',
        'dir:附件',
        'dir:附件/第3讲',
        'img:附件/第3讲/p5-1.png',
      ].sort(),
    )
    expect(all.find((e) => e.path === '附件/第3讲/p5-1.png')!.bytes).toBe(1)
    expect(all.find((e) => e.path.endsWith('第3讲 线性映射.pdf'))!.progress).toEqual({ asked: 5, pages: 10 })
    expect(all.find((e) => e.path.endsWith('第4讲.pdf'))!.progress).toBeUndefined()
    expect(all.find((e) => e.path.endsWith('旋转矩阵.html'))!.lecture).toBe(3)
  })

  it('软件汇总的「我的疑惑」：标成自动汇总、数条数；同一文件夹每篇读 PDF 笔记记上几条疑惑、在哪一段（CN-56）', async () => {
    const { listEntries } = await import('../src/main/files')
    const { doubtsNote } = await import('@cn/format')
    root = mkdtempSync(join(tmpdir(), 'cn-files-'))
    mkdirSync(join(root, '课程/ecp'), { recursive: true })
    for (const n of ['Lecture05', 'Lecture06']) {
      writeFileSync(join(root, `课程/ecp/${n}.pdf`), '%PDF')
      writeFileSync(join(root, `课程/ecp/${n} 笔记.md`), '# 笔记\n')
    }
    const sec = (page: number) => ({ id: `s${page}`, page, title: '小标题', doubts: [`问题 ${page}`], good: '', time: '20:50' }) as never
    const items = [
      { id: 'a', pdf: '课程/ecp/Lecture05.pdf', lecture: 5, section: sec(5) },
      { id: 'b', pdf: '课程/ecp/Lecture05.pdf', lecture: 5, section: sec(10) },
      { id: 'c', pdf: '课程/ecp/Lecture06.pdf', lecture: 6, section: sec(2) },
    ]
    writeFileSync(join(root, '课程/ecp/我的疑惑.md'), doubtsNote('课程/ecp', 'ecp', items, new Set()))
    // 自己起名叫「我的疑惑」、不是软件写的：不算
    mkdirSync(join(root, '写作'))
    writeFileSync(join(root, '写作/我的疑惑.md'), '# 我自己的疑惑\n')
    const all = await listEntries(root)
    const at = (p: string) => all.find((e) => e.path === p)!
    expect(at('课程/ecp/我的疑惑.md').auto).toEqual({ count: 3 })
    expect(at('写作/我的疑惑.md').auto).toBeUndefined()
    expect(at('课程/ecp/Lecture05 笔记.md').doubts).toEqual({ n: 2, summary: '课程/ecp/我的疑惑.md', heading: '第 5 讲 · Lecture05' })
    expect(at('课程/ecp/Lecture06 笔记.md').doubts).toEqual({ n: 1, summary: '课程/ecp/我的疑惑.md', heading: '第 6 讲 · Lecture06' })
    // 树里：我的疑惑排课程第一行
    expect(buildTree(all)[0]!.children[0]!.children.map((n) => n.name)[0]).toBe('我的疑惑.md')
  })
})

describe('文件树最外层按顶级分类分组（方案 3「分两组」）', () => {
  it('收件箱（没有组名）| 读进来的 课程 阅读 剪藏 | 自己写的 周记 写作 项目 生活 | 不在分类里的；库里还没有的分类画空的一行，筛类型时不画', async () => {
    const { topGroups } = await import('../src/shared/files')
    const tree = buildTree([f('写作/a.md'), f('收件箱/b.md'), f('课程/x/c.md'), f('别的/d.md'), f('e.md'), f('附件/e/1.png', 'img')])
    const g = topGroups(tree, true)
    expect(g.map((x) => [x.title, x.nodes.map((n) => [n.name, n.count])])).toEqual([
      ['', [['收件箱', 1]]],
      ['读进来的', [['课程', 1], ['阅读', 0], ['剪藏', 0]]],
      ['自己写的', [['周记', 0], ['写作', 1], ['项目', 0], ['生活', 0]]],
      ['不在分类里的', [['别的', 1], ['附件', 1], ['e.md', 1]]],
    ])
    // 筛了类型（只要 md）：没有这一类的分类不画，空的组也不出现
    const md = buildTree([f('写作/a.md'), f('e.md')], { keep: (x) => x.kind === 'md' })
    expect(topGroups(md, false).map((x) => [x.title, x.nodes.map((n) => n.name)])).toEqual([
      ['自己写的', ['写作']],
      ['不在分类里的', ['e.md']],
    ])
  })
})

describe('「附件」筛选（CN-104）：每篇笔记用到的附件、没有哪篇在用的', () => {
  let root: string
  afterEach(() => rmSync(root, { recursive: true, force: true }))
  it('自己附件文件夹里的、文中用到的 附件/ 别处的都挂在那篇下面；谁都没用的另列', async () => {
    const { listEntries, attachIndex } = await import('../src/main/files')
    root = mkdtempSync(join(tmpdir(), 'cn-att-'))
    for (const d of ['写作', '附件/写作/游记', '附件/视频/yt-1', '附件/老的']) mkdirSync(join(root, d), { recursive: true })
    writeFileSync(join(root, '写作/游记.md'), '# 游记\n\n![](../附件/视频/yt-1/01-02.jpg)\n')
    writeFileSync(join(root, '附件/写作/游记/截图 1.png'), 'xx')
    writeFileSync(join(root, '附件/视频/yt-1/01-02.jpg'), 'xxx')
    writeFileSync(join(root, '附件/老的/没人用.png'), 'x')
    const idx = await attachIndex(root, await listEntries(root))
    expect(idx.notes).toEqual([{ note: '写作/游记.md', items: [{ path: '附件/写作/游记/截图 1.png', bytes: 2 }, { path: '附件/视频/yt-1/01-02.jpg', bytes: 3 }] }])
    expect(idx.orphans).toEqual([{ path: '附件/老的/没人用.png', bytes: 1 }])
  })
})

