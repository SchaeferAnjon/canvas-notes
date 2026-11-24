import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildTree, type FileEntry, filterTree, fixedFolder, folderProgress, matchFiles, parseProgress, subtree, type TreeNode } from '../src/shared/files'

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
  it('顶层按顶级分类的先后排（收件箱、课程、阅读、剪藏、周记、写作、项目、生活）；文件夹在前；同一讲的课件、笔记挨着，讲次按数字排；术语表.md 是普通笔记（2026-11-22 术语表拿掉了，不放最上）', () => {
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
    // 「我的疑惑」不再是软件汇总的那篇（2026-11-20）、术语表拿掉了（2026-11-22）：和别的笔记一样按名字排，不放最上
    expect(la.children.map((n) => n.name)).toEqual(['第3讲 线性映射.pdf', '第3讲 线性映射 笔记.md', '向量加法.html', '第10讲 二次型.pdf', '术语表.md', '我的疑惑.md', '旋转矩阵.html'])
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

  it('一个 PDF 一篇笔记（2026-11-20）：PDF、HTML 带上旁边那篇笔记和里面问了几问（主问题 + 旁支问题）；别的笔记不带', async () => {
    const { listEntries } = await import('../src/main/files')
    root = mkdtempSync(join(tmpdir(), 'cn-files-'))
    mkdirSync(join(root, '课程/ecp'), { recursive: true })
    writeFileSync(join(root, '课程/ecp/Lecture05.pdf'), '%PDF')
    writeFileSync(join(root, '课程/ecp/Lecture06.pdf'), '%PDF')
    writeFileSync(join(root, '课程/ecp/图解.html'), '<html></html>')
    const sec = (page: number, qs: string[], side?: string) =>
      [`## 第 ${page} 页 · 小标题`, `[第 ${page} 页](Lecture05.pdf#page=${page}) · 20:21 <!-- cn:thread=Lecture05-p${page}-1 -->`, '', ...qs.flatMap((q) => [`> [!question] ${q}`, '', '回答。', '']), ...(side ? [`> [!side] ${side}`, '> > 那一句', '>', '> 旁支的回答。', ''] : []), '> [!recap] 小结', ''].join('\n')
    writeFileSync(join(root, '课程/ecp/Lecture05 笔记.md'), `---\n类型: 笔记\n进度: 7/12\n---\n# Lecture05 笔记\n\n${sec(3, ['给我讲解一下', '还是不懂'], '为什么减掉门槛？')}\n${sec(7, ['问这一页'])}`)
    writeFileSync(join(root, '课程/ecp/图解 笔记.md'), '# 图解 笔记\n')
    writeFileSync(join(root, '课程/ecp/随手记.md'), '# 随手记\n')
    const all = await listEntries(root)
    const at = (p: string) => all.find((e) => e.path === p)!
    expect(at('课程/ecp/Lecture05.pdf').note).toEqual({ path: '课程/ecp/Lecture05 笔记.md', asks: 4 })
    expect(at('课程/ecp/Lecture05.pdf').progress).toEqual({ asked: 7, pages: 12 })
    expect(at('课程/ecp/Lecture06.pdf').note).toBeUndefined()
    expect(at('课程/ecp/图解.html').note).toEqual({ path: '课程/ecp/图解 笔记.md', asks: 0 })
    expect(at('课程/ecp/随手记.md').note).toBeUndefined()
  })

  it('目录树里 PDF › 笔记 › 可视化一层挂一层（task-m552v）：笔记挂在 PDF 下面写「笔记」、带问了几问，它嵌着的可视化挂在笔记下面；没收下的可视化不算篇数；不是同一个文件夹的不挂', () => {
    const pdf: FileEntry = { path: '课程/ecp/Lecture05.pdf', kind: 'pdf', mtimeMs: 0, note: { path: '课程/ecp/Lecture05 笔记.md', asks: 4 } }
    const viz: FileEntry = { path: '课程/ecp/水桶.html', kind: 'html', mtimeMs: 0, vizOf: '课程/ecp/Lecture05 笔记.md' }
    const ghost: FileEntry = { path: '课程/ecp/新图.html', kind: 'html', mtimeMs: 0, vizOf: '课程/ecp/Lecture05 笔记.md', dream: 'x1' }
    const files = [pdf, f('课程/ecp/Lecture05 笔记.md'), viz, ghost, f('课程/ecp/随手记.md'), f('课程/别处/Lecture05 笔记.md')]
    const ecp = (t: ReturnType<typeof buildTree>) => t[0]!.children.find((n) => n.name === 'ecp')!
    const t = buildTree(files, { hang: true })
    expect(ecp(t).children.map((n) => n.name)).toEqual(['随手记.md', 'Lecture05.pdf'])
    const p = ecp(t).children[1]!
    expect(p.children.map((n) => [n.name, n.hung, n.label])).toEqual([['Lecture05 笔记.md', 'note', '笔记']])
    expect(p.children[0]!.asks).toEqual({ n: 4 })
    expect(p.children[0]!.children.map((n) => [n.name, n.hung])).toEqual([
      ['水桶.html', 'viz'],
      ['新图.html', 'viz'],
    ])
    // 篇数：PDF、它的笔记、收下的可视化合起来算一篇（和 demo 一样；以前 PDF 和笔记是一行也算一个），没收下的不算
    expect(ecp(t).count).toBe(2)
    expect(p.count).toBe(1)
    expect(t[0]!.children.find((n) => n.name === '别处')!.children.map((n) => n.name)).toEqual(['Lecture05 笔记.md'])
    // 只看文档：PDF 带着它的笔记（PDF 跟着笔记走），可视化不在；PDF 是个壳，这一组照样算一篇
    const docs = buildTree(files, { keep: (x) => x.kind === 'md', hang: true })
    expect(ecp(docs).children.map((n) => n.name)).toEqual(['随手记.md', 'Lecture05.pdf'])
    expect(ecp(docs).children[1]!.children.map((n) => n.name)).toEqual(['Lecture05 笔记.md'])
    expect(ecp(docs).children[1]!.children[0]!.children).toEqual([])
    expect(ecp(docs).count).toBe(2)
    // 什么都不留：PDF 也不在
    expect(buildTree(files, { keep: () => false, hang: true })).toEqual([])
    // 文件夹首页（不挂）照旧：PDF 和它的笔记算一个，笔记不单独列，没收下的可视化不在
    expect(ecp(buildTree(files)).children.map((n) => n.name)).toEqual(['水桶.html', '随手记.md', 'Lecture05.pdf'])
  })

  it('白板下的导图、子白板（属性 所属白板，task-wuv05）挂在白板下面，照常各算一篇；子白板的子白板一层层挂；成环、不在同一个文件夹的不挂', () => {
    const d = '课程/线代'
    const files = [f(`${d}/复习.md`), f(`${d}/导图 1.md`), f(`${d}/细节.md`), f(`${d}/细节的导图.md`), f(`${d}/甲.md`), f(`${d}/乙.md`), f('写作/别处.md')]
    const subOf = new Map([
      [`${d}/细节的导图.md`, `${d}/细节.md`],
      [`${d}/导图 1.md`, `${d}/复习.md`],
      [`${d}/细节.md`, `${d}/复习.md`],
      [`${d}/甲.md`, `${d}/乙.md`],
      [`${d}/乙.md`, `${d}/甲.md`],
      ['写作/别处.md', `${d}/复习.md`],
    ])
    const t = buildTree(files, { hang: true, subOf })
    const xd = t.find((n) => n.name === '课程')!.children[0]!
    const board = xd.children.find((n) => n.name === '复习.md')!
    expect(board.children.map((n) => [n.name, n.hung])).toEqual([
      ['导图 1.md', 'sub'],
      ['细节.md', 'sub'],
    ])
    expect(board.children[1]!.children.map((n) => [n.name, n.hung])).toEqual([['细节的导图.md', 'sub']])
    expect(board.count).toBe(4)
    expect(xd.count).toBe(6)
    // 甲乙互相所属：只挂一层，不丢
    const yi = xd.children.find((n) => n.name === '乙.md')!
    expect(yi.children.map((n) => n.name)).toEqual(['甲.md'])
    expect(t.find((n) => n.name === '写作')!.children.map((n) => n.name)).toEqual(['别处.md'])
    // 不挂的（文件夹首页）照旧平铺
    expect(buildTree(files, { subOf }).find((n) => n.name === '课程')!.children[0]!.children).toHaveLength(6)
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
    // 关掉预设的分类（task-wniqx）：不分组；收件箱在最前，原来的分类和别的文件夹一样照树的排法，空的分类不画
    const offFiles = [f('写作/a.md'), f('课程/x/c.md'), f('别的/d.md'), f('e.md'), f('读书笔记/g.md'), f('生活', 'dir')]
    expect(topGroups(buildTree(offFiles, { cats: false }), true, false).map((x) => [x.title, x.nodes.map((n) => n.name)])).toEqual([['', ['收件箱', '别的', '读书笔记', '课程', '写作', 'e.md']]])
    expect(topGroups(buildTree(offFiles, { cats: false, keep: (x) => x.kind === 'md' }), false, false).map((x) => [x.title, x.nodes.map((n) => n.name)])).toEqual([['', ['别的', '读书笔记', '课程', '写作', 'e.md']]])
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
    // 文件树「被 N 篇用」：只算文中链着的；只是放在 附件/写作/游记/ 里、文中没用到的截图不算
    expect(idx.refs).toEqual({ '附件/视频/yt-1/01-02.jpg': ['写作/游记.md'] })
  })
})

describe('「这张图谁在用」只有一套算法：读 PDF 的完整对话（.canvas-notes/对话/）里用到的也算在用（task-1df7j）', () => {
  let root: string
  afterEach(() => rmSync(root, { recursive: true, force: true }))
  const put = (p: string, data: string) => {
    mkdirSync(join(root, p, '..'), { recursive: true })
    writeFileSync(join(root, p), data)
  }
  /** 用户真库里的样子：旧的 PDF 笔记链着完整对话，截图只有对话记录在用；另有 PDF 已经删了的对话、别人附件文件夹里没链着的、真没人用的图 */
  const build = () => {
    root = mkdtempSync(join(tmpdir(), 'cn-att-convo-'))
    put('课程/ecpc/Lecture05.pdf', '%PDF-1.4')
    put('课程/ecpc/Lecture05 笔记.md', '# Lecture05 笔记\n\n## 第 1 页 · 阈值\n[第 1 页](Lecture05.pdf#page=1) · 10:20\n\n[完整对话 · 2 轮](../../.canvas-notes/对话/Lecture05-p1-1.md)\n')
    put('.canvas-notes/对话/Lecture05-p1-1.md', '# Lecture05 · 第 1 页 · 完整对话\n\n[回到第 1 页](../../课程/ecpc/Lecture05.pdf#page=1&rect=0.1,0.2,0.3,0.4)\n\n### 我 · 10:20\n\n![我框的](../../附件/Lecture05/p1-1.png)\n\n讲讲\n')
    put('附件/Lecture05/p1-1.png', 'xx')
    // PDF 已经不在了的对话：图照样算在用
    put('.canvas-notes/对话/旧讲义-p2-1.md', '# 旧讲义 · 第 2 页 · 完整对话\n\n[回到第 2 页](../../课程/旧讲义.pdf#page=2)\n\n![我框的](../../附件/旧讲义/p2-1.png)\n')
    put('附件/旧讲义/p2-1.png', 'xxx')
    // 别的笔记自己附件文件夹里的（那篇文中没链着，也算它的）
    put('写作/游记.md', '# 游记\n')
    put('附件/写作/游记/截图 1.png', 'x')
    put('附件/老的/没人用.png', 'xxxx')
  }

  it('attachIndex：对话里用到的图不算「没有笔记的附件」；挂在那份 PDF 的笔记下面，PDF 不在了的单列「完整对话在用的附件」；对话记录本身不进文件树', async () => {
    const { listEntries, attachIndex } = await import('../src/main/files')
    build()
    const files = await listEntries(root)
    expect(files.some((f) => f.path.startsWith('.canvas-notes'))).toBe(false)
    const idx = await attachIndex(root, files)
    expect(idx.orphans).toEqual([{ path: '附件/老的/没人用.png', bytes: 4 }])
    expect(idx.notes.find((n) => n.note === '课程/ecpc/Lecture05 笔记.md')?.items).toEqual([{ path: '附件/Lecture05/p1-1.png', bytes: 2 }])
    expect(idx.convos).toEqual([{ path: '附件/旧讲义/p2-1.png', bytes: 3, convo: '.canvas-notes/对话/旧讲义-p2-1.md' }])
    expect(idx.notes.some((n) => n.note.startsWith('.canvas-notes'))).toBe(false)
  })

  it('和删笔记连图一起删（note-attach）结果一致：一篇链着全部图的笔记，删它时会一起删的（没别人在用的）正好是「没有笔记的附件」', async () => {
    const { listEntries, attachIndex } = await import('../src/main/files')
    const { noteAttachments } = await import('../src/main/note-attach')
    const { Vault } = await import('../src/main/vault')
    build()
    const atts = (await listEntries(root)).filter((f) => f.path.startsWith('附件/')).map((f) => f.path)
    const orphans = (await attachIndex(root, await listEntries(root))).orphans.map((o) => o.path)
    const rel = (p: string) => p.split('/').map(encodeURIComponent).join('/')
    put('探针.md', '# 探针\n\n' + atts.map((p) => `![](${rel(p)})`).join('\n\n') + '\n')
    const a = await noteAttachments(new Vault(root), '探针.md', true)
    expect(a.items.filter((i) => i.mine && !i.sharedWith?.length).map((i) => i.path).sort()).toEqual(orphans.sort())
    expect(a.items.find((i) => i.path === '附件/Lecture05/p1-1.png')?.sharedWith).toEqual(['.canvas-notes/对话/Lecture05-p1-1.md'])
  })
})

describe('左栏找文件的框（task-4891y）：把树筛到名字命中的几行和它们的上一层', () => {
  const files = [
    f('课程/study project/学习笔记.md', 'md', 1),
    f('课程/study project 2/YitingWei_Notes.pdf', 'pdf', 2),
    f('课程/ecp/第5讲.md', 'md', 3),
    f('项目/冰岛自驾/行程.md', 'md', 4),
    f('生活/菜谱.md', 'md', 5),
  ]
  const paths = (ns: TreeNode[]): string[] => ns.flatMap((n) => [n.path, ...paths(n.children)])
  it('文件命中：留它和一路上去的文件夹，别的拿掉；篇数是命中的几篇', () => {
    const t = filterTree(buildTree(files), 'yiting')
    expect(paths(t)).toEqual(['课程', '课程/study project 2', '课程/study project 2/YitingWei_Notes.pdf'])
    expect(t[0]!.count).toBe(1)
  })
  it('文件夹名字命中：文件夹留着（里面不命中的不列），大小写不分；比的是去掉 .md、.pdf 的名字', () => {
    expect(paths(filterTree(buildTree(files), 'STU'))).toEqual(['课程', '课程/study project', '课程/study project 2'])
    expect(paths(filterTree(buildTree(files), 'pdf'))).toEqual([])
    expect(paths(filterTree(buildTree(files), '行程'))).toEqual(['项目', '项目/冰岛自驾', '项目/冰岛自驾/行程.md'])
  })
  it('空的（只有空格）不筛', () => {
    const t = buildTree(files)
    expect(filterTree(t, '  ')).toBe(t)
  })
})

