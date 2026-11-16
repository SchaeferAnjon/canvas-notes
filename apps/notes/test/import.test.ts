import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readProps } from '@cn/format'
import { fakeNotesFolder } from '../e2e/fixtures/apple-notes'
import { noteToMarkdown, STYLE, type AppleNote, type NoteRun } from '../src/main/import/apple-notes-md'
import { NoteStore } from '../src/main/import/apple-notes'
import { mdFolders, readMdFolder, scanMdFolder } from '../src/main/import/md-folder'
import { attRef, importedIds, writeImport, type ImportNote } from '../src/main/import/write'

const tmp: string[] = []
const mk = () => {
  const d = mkdtempSync(join(tmpdir(), 'cn-import-test-'))
  tmp.push(d)
  return d
}
afterEach(() => {
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true })
})
const git = (dir: string, ...a: string[]) => execFileSync('git', ['-C', dir, '-c', 'core.quotepath=false', ...a], { encoding: 'utf8' })
function repo() {
  const d = mk()
  git(d, 'init', '-q', '-b', 'main')
  git(d, 'config', 'user.name', 'T')
  git(d, 'config', 'user.email', 't@e.x')
  writeFileSync(join(d, '已有.md'), '# 已有\n')
  git(d, 'add', '-A')
  git(d, 'commit', '-q', '-m', '起点')
  return d
}

/** 一段段拼成备忘录的 Note：每段 [字, 样式] */
function note(paras: [string, Partial<NoteRun>?][]): AppleNote {
  let text = ''
  const runs: NoteRun[] = []
  for (const [t, s] of paras) {
    const r: NoteRun = { length: t.length + 1, style: -1, indent: 0, done: false, quote: false, weight: 0, strike: false, ...s }
    text += t + '\n'
    runs.push(r)
  }
  return { text, runs }
}
const noEmbed = () => ({ md: '', block: false })

describe('备忘录的笔记 → md', () => {
  it('标题行去掉；勾选清单按勾没勾变成 - [x] / - [ ]；编号、圆点、小标题、引用', () => {
    const md = noteToMarkdown(
      note([
        ['周末要做的', { style: STYLE.title }],
        ['买菜', { style: STYLE.checkbox, done: true }],
        ['交房租', { style: STYLE.checkbox }],
        ['给猫剪指甲', { style: STYLE.checkbox, indent: 1 }],
        ['顺序', { style: STYLE.heading }],
        ['先洗衣服', { style: STYLE.numbered }],
        ['再拖地', { style: STYLE.numbered }],
        ['一点想法', { style: STYLE.dashed }],
        ['别人说的话', { quote: true }],
        ['普通一行'],
      ]),
      noEmbed,
      { omitTitle: true },
    )
    expect(md).toBe(['- [x] 买菜', '- [ ] 交房租', '\t- [ ] 给猫剪指甲', '## 顺序', '1. 先洗衣服', '2. 再拖地', '- 一点想法', '> 别人说的话', '普通一行'].join('\n'))
  })

  it('一行里的粗体、删除线、链接包在字上，空格留在外面；等宽段落成代码块', () => {
    const r = (t: string, s: Partial<NoteRun> = {}): [string, NoteRun] => [t, { length: t.length, style: -1, indent: 0, done: false, quote: false, weight: 0, strike: false, ...s }]
    const parts = [r('标题\n', { style: 0 }), r('这是 '), r('重点 ', { weight: 1 }), r('和 '), r('作废', { strike: true }), r(' 还有'), r('链接', { link: 'https://a.b/c d' }), r('\n'), r('const a = 1\n', { style: STYLE.mono })]
    const n: AppleNote = { text: parts.map((p) => p[0]).join(''), runs: parts.map((p) => p[1]) }
    expect(noteToMarkdown(n, noEmbed, { omitTitle: true })).toBe('这是 **重点** 和 ~~作废~~ 还有[链接](https://a.b/c%20d)\n```\nconst a = 1\n```')
  })

  it('只有一行时不去掉（不然正文是空的）', () => {
    expect(noteToMarkdown(note([['只有一句话', { style: 0 }]]), noEmbed, { omitTitle: true })).toBe('# 只有一句话')
  })
})

describe('读备忘录的数据库', () => {
  function sample() {
    const dir = join(mk(), 'group.com.apple.notes')
    fakeNotesFolder(
      dir,
      [{ name: '学习' }, { name: '线性代数', parent: '学习' }, { name: '生活' }, { name: '最近删除', type: 1 }],
      [
        {
          folder: '线性代数',
          ident: 'A1B2C3D4-0000-4000-8000-00000000000A',
          created: new Date('2023-03-01T09:30:00'),
          modified: new Date('2023-03-02T21:15:00'),
          paras: [
            { text: '第3讲 线性映射', style: 0 },
            { text: '核与像', style: 103, done: true },
            { text: '秩-零化度定理', style: 103 },
            { image: 'IMG_0001.jpeg', bytes: Buffer.from('fake-jpeg') },
            { table: [['名词', '意思'], ['核', 'T(v)=0 的 v']] },
            { hashtag: '#复习' },
          ],
        },
        { folder: '生活', created: new Date('2022-01-01T08:00:00'), modified: new Date('2022-01-05T08:00:00'), paras: [{ text: '买菜清单' }, { linkTo: 'A1B2C3D4-0000-4000-8000-00000000000A' }, { text: '见那条', parts: [{ text: '见' }, { text: '那条', link: 'applenotes:note/A1B2C3D4-0000-4000-8000-00000000000A?ownerIdentifier=x' }] }] },
        { folder: '生活', locked: true, created: new Date('2022-01-01'), modified: new Date('2022-01-01'), paras: [{ text: '密码' }] },
        { folder: '最近删除', created: new Date('2022-01-01'), modified: new Date('2022-01-01'), paras: [{ text: '删掉的' }] },
      ],
    )
    return dir
  }

  it('文件夹带层级和篇数，不列最近删除；上锁的单独数', () => {
    const store = new NoteStore(sample())
    try {
      expect(store.folders().map((f) => [f.path, f.depth, f.notes, f.locked, f.attachments])).toEqual([
        ['生活', 0, 2, 1, 0],
        ['学习', 0, 0, 0, 0],
        ['学习/线性代数', 1, 1, 0, 2],
      ])
    } finally {
      store.close()
    }
  })

  it('一条笔记：勾选清单、图片、表格、标签、原来的时间；笔记链接变 [[标题]]', () => {
    const store = new NoteStore(sample())
    try {
      const f = store.folders()
      const rows = store.noteRows(f.map((x) => x.id))
      expect(rows.filter((r) => r.locked)).toHaveLength(1)
      const la = store.read(rows.find((r) => r.title === '第3讲 线性映射')!, '学习/线性代数', '备忘录')
      expect(la.title).toBe('第3讲 线性映射')
      expect(la.text).toBe(`- [x] 核与像\n- [ ] 秩-零化度定理\n\n![](${attRef(0)})\n\n| 名词 | 意思 |\n| --- | --- |\n| 核 | T(v)=0 的 v |\n\n#复习\n`)
      expect(la.attachments).toEqual([{ src: expect.stringMatching(/Media\/MEDIA-\d+\/gen1\/IMG_0001\.jpeg$/), name: '第3讲 线性映射.jpeg' }])
      expect(new Date(la.created).toISOString()).toBe(new Date('2023-03-01T09:30:00').toISOString())
      expect(new Date(la.updated).toISOString()).toBe(new Date('2023-03-02T21:15:00').toISOString())
      expect(la.props).toEqual([
        ['来源', '备忘录'],
        ['原文件夹', '学习/线性代数'],
      ])
      const shop = store.read(rows.find((r) => r.title === '买菜清单')!, '生活', '备忘录')
      expect(shop.text).toBe('[[第3讲 线性映射]]\n见[[第3讲 线性映射|那条]]\n')
    } finally {
      store.close()
    }
  })
})

describe('写进库', () => {
  const sampleNotes = (src: string): ImportNote[] => [
    { folder: '学习/线性代数', title: '第3讲: 线性映射', text: `- [ ] 核\n\n![](${attRef(0)})\n`, props: [['来源', '备忘录'], ['原文件夹', '学习/线性代数']], created: Date.parse('2023-03-01T09:30:00'), updated: Date.parse('2023-03-02T21:15:00'), attachments: [{ src, name: '第3讲 线性映射.jpeg' }], id: 'apple-notes:A' },
    { folder: '学习/线性代数', title: '第3讲: 线性映射', text: '同名的另一条\n', props: [['来源', '备忘录']], created: 0, updated: Date.parse('2023-01-01T00:00:00'), attachments: [{ src, name: '第3讲 线性映射.jpeg' }], id: 'apple-notes:B' },
  ]

  it('笔记进 收件箱/导入/<来源>/<原文件夹>/，附件进 附件/导入/<来源>/，属性和修改时间是原来的，一次提交，撤回就没了', async () => {
    const root = repo()
    const img = join(mk(), 'a.jpeg')
    writeFileSync(img, 'jpeg')
    writeFileSync(join(root, '没提交的.md'), '用户正在写的\n')
    const seen: number[] = []
    const r = await writeImport({ root, source: '备忘录', notes: sampleNotes(img), message: '导入旧笔记：从备忘录导入 2 条', onProgress: (d) => seen.push(d) })
    expect(seen).toEqual([1, 2])
    expect(r.attachments).toBe(1)
    expect(r.paths.sort()).toEqual(['收件箱/导入/备忘录/学习/线性代数/第3讲 线性映射 2.md', '收件箱/导入/备忘录/学习/线性代数/第3讲 线性映射.md', '附件/导入/备忘录/第3讲 线性映射.jpeg'])
    const text = readFileSync(join(root, '收件箱/导入/备忘录/学习/线性代数/第3讲 线性映射.md'), 'utf8')
    expect(text).toBe('---\ncreated: 2023-03-01 09:30\nupdated: 2023-03-02 21:15\n来源: 备忘录\n原文件夹: 学习/线性代数\nimport-id: apple-notes:A\n---\n- [ ] 核\n\n![](../../../../../附件/导入/备忘录/第3讲%20线性映射.jpeg)\n')
    expect(readProps(text).find((p) => p.key === '原文件夹')?.value).toBe('学习/线性代数')
    expect(statSync(join(root, '收件箱/导入/备忘录/学习/线性代数/第3讲 线性映射.md')).mtime.toISOString()).toBe(new Date('2023-03-02T21:15:00').toISOString())
    // 一次提交，只带这次写的文件；用户没提交的不带
    expect(git(root, 'log', '--format=%s', '-1')).toBe('导入旧笔记：从备忘录导入 2 条\n')
    expect(git(root, 'show', '--name-only', '--format=', 'HEAD').trim().split('\n').sort()).toEqual(r.paths.sort())
    expect(git(root, 'status', '--porcelain')).toBe('?? 没提交的.md\n')
    expect([...(await importedIds(root))].sort()).toEqual(['apple-notes:A', 'apple-notes:B'])
    // 撤回
    git(root, 'revert', '--no-edit', r.commit!)
    expect(existsSync(join(root, '收件箱/导入'))).toBe(false)
    expect(existsSync(join(root, '附件/导入/备忘录/第3讲 线性映射.jpeg'))).toBe(false)
  })

  it('停下：这次写的都删掉，库回到原样', async () => {
    const root = repo()
    const img = join(mk(), 'a.jpeg')
    writeFileSync(img, 'jpeg')
    const ac = new AbortController()
    await expect(writeImport({ root, source: '备忘录', notes: sampleNotes(img), message: 'x', signal: ac.signal, onProgress: () => ac.abort() })).rejects.toThrow()
    expect(git(root, 'status', '--porcelain', '--untracked-files=all')).toBe('')
    expect(git(root, 'log', '--format=%s')).toBe('起点\n')
  })
})

describe('Markdown 文件夹（旧的 Obsidian 库）', () => {
  function oldVault() {
    const d = join(mk(), 'Obsidian 旧库')
    const put = (p: string, s: string | Buffer) => {
      mkdirSync(join(d, p, '..'), { recursive: true })
      writeFileSync(join(d, p), s)
    }
    put('.obsidian/app.json', '{}')
    put('assets/图 1.png', 'png')
    put('课程/线代/第一讲.md', '---\ntags:\n  - 线代\ncreated: 2021-09-01 08:00\n---\n# 第一讲\n\n![[图 1.png|300]]\n看 [[课程/线代/第二讲|下一讲]] 和 [[讲义.pdf]]。\n![示意](../../assets/图%201.png)\n[官网](https://example.com)\n')
    put('课程/线代/第二讲.md', '第二讲\n')
    put('课程/线代/讲义.pdf', 'pdf')
    put('课程/线代/散放的.pdf', 'pdf2')
    put('随手记.md', '一句话')
    return d
  }

  it('列出有 md 的文件夹（不进 .obsidian），带篇数和附件数', async () => {
    const scan = await scanMdFolder(oldVault())
    expect(mdFolders(scan, 'Obsidian 旧库').map((f) => [f.path, f.name, f.depth, f.notes, f.attachments])).toEqual([
      ['', 'Obsidian 旧库', 0, 1, 0],
      ['课程', '课程', 1, 0, 0],
      ['课程/线代', '线代', 2, 2, 2],
      ['assets', 'assets', 1, 0, 1],
    ])
  })

  it('图片和附件拷进来、链接指到新位置；[[子文件夹/笔记|别名]] 只留名字；原来的属性留着，加来源和原文件夹', async () => {
    const scan = await scanMdFolder(oldVault())
    const { notes, extra } = await readMdFolder(scan, ['', '课程/线代', 'assets'], 'Obsidian 旧库')
    expect(extra.map((e) => e.name)).toEqual(['课程/线代/散放的.pdf'])
    const root = repo()
    const r = await writeImport({ root, source: 'Obsidian 旧库', notes, extra, message: '导入' })
    const one = readFileSync(join(root, '收件箱/导入/Obsidian 旧库/课程/线代/第一讲.md'), 'utf8')
    expect(one).toBe(
      '---\ntags:\n  - 线代\ncreated: 2021-09-01 08:00\nupdated: ' +
        one.match(/updated: (.+)/)![1] +
        '\n来源: Obsidian 旧库\n原文件夹: 课程/线代\nimport-id: md:Obsidian 旧库/课程/线代/第一讲.md\n---\n# 第一讲\n\n' +
        '![](../../../../../附件/导入/Obsidian%20旧库/assets/图%201.png)\n' +
        '看 [[第二讲|下一讲]] 和 [讲义.pdf](../../../../../附件/导入/Obsidian%20旧库/课程/线代/讲义.pdf)。\n' +
        '![示意](../../../../../附件/导入/Obsidian%20旧库/assets/图%201.png)\n[官网](https://example.com)\n',
    )
    expect(readFileSync(join(root, '收件箱/导入/Obsidian 旧库/随手记.md'), 'utf8')).toMatch(/^---\ncreated: .+\nupdated: .+\n来源: Obsidian 旧库\nimport-id: md:Obsidian 旧库\/随手记.md\n---\n一句话\n$/)
    expect(r.paths.filter((p) => p.startsWith('附件/')).sort()).toEqual(['附件/导入/Obsidian 旧库/assets/图 1.png', '附件/导入/Obsidian 旧库/课程/线代/散放的.pdf', '附件/导入/Obsidian 旧库/课程/线代/讲义.pdf'])
    expect(existsSync(join(root, '收件箱/导入/Obsidian 旧库/.obsidian'))).toBe(false)
  })
})
