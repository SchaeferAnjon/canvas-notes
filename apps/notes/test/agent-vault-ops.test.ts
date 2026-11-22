// AI 在库里动手（2026-11-19，全能模式关着也能做）：新建、改名、挪动、删除、建文件夹，全走软件自己的库操作。
// 每样不自己提交，返回碰过的路径（这一轮结束一起提交）；名字冲突、出了库、目标不存在都报一句说得清的话。
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: () => undefined }, shell: {} }))

const ops = await import('../src/main/agent/vault-ops')
const { Vault } = await import('../src/main/vault')

const bases: string[] = []
afterEach(() => {
  for (const b of bases.splice(0)) rmSync(b, { recursive: true, force: true })
})

const g = (root: string, ...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' })

function vaultWith(files: Record<string, string | Buffer>) {
  const base = mkdtempSync(join(tmpdir(), 'cn-aiops-'))
  bases.push(base)
  const root = join(base, '库')
  const trash = join(base, 'trash')
  const stage = join(base, 'stage')
  mkdirSync(trash)
  execFileSync('git', ['init', '-q', '-b', 'main', root])
  g(root, 'config', 'user.name', 'T')
  g(root, 'config', 'user.email', 't@example.com')
  for (const [p, t] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true })
    writeFileSync(join(root, p), t)
  }
  g(root, 'add', '-A')
  g(root, 'commit', '-q', '-m', '样本')
  const v = new Vault(root)
  const moved: [string, string][] = []
  const deps = { put: async (abs: string) => rename(abs, join(trash, `${Date.now()}-${abs.split('/').pop()}`)), stage, moved: (a: string, b: string) => void moved.push([a, b]) }
  return { root, trash, v, deps, moved }
}

const read = (root: string, p: string) => readFileSync(join(root, p), 'utf8')
const status = (root: string) => g(root, 'status', '--porcelain', '--untracked-files=all').trim()
const commits = (root: string) => Number(g(root, 'rev-list', '--count', 'HEAD').trim())

describe('新建笔记、新建文件夹', () => {
  it('新建：放进指定文件夹，开头补「# 标题」，不自己提交，返回要提交的路径', async () => {
    const { root, v } = vaultWith({ '课程/.gitkeep': '' })
    const r = await ops.createNote(v, '课程', '周报', '这周读了 ECP。')
    expect(r.path).toBe('课程/周报.md')
    expect(read(root, '课程/周报.md')).toBe('# 周报\n\n这周读了 ECP。\n')
    expect(r.touched).toEqual(['课程/周报.md'])
    expect(commits(root)).toBe(1)
    // 自己写了标题、frontmatter 的照原样
    await ops.createNote(v, '', '计划', '# 计划\n\n- 一\n')
    expect(read(root, '计划.md')).toBe('# 计划\n\n- 一\n')
    // 库的绝对路径、./ 开头、末尾的 / 都认
    expect((await ops.createNote(v, `${root}/课程/`, '空的', '')).path).toBe('课程/空的.md')
    expect(read(root, '课程/空的.md')).toBe('# 空的\n\n')
  })

  it('新建：重名、文件夹不在、出了库、标题里带 / 都说清楚，什么都不建', async () => {
    const { root, v } = vaultWith({ '课程/周报.md': '# 周报\n' })
    await expect(ops.createNote(v, '课程', '周报', 'x')).rejects.toThrow('「课程」里已经有一篇叫「周报」了（课程/周报.md）')
    await expect(ops.createNote(v, '项目/新', '计划', 'x')).rejects.toThrow('没有「项目/新」这个文件夹')
    await expect(ops.createNote(v, '../外面', '计划', 'x')).rejects.toThrow('在库外')
    await expect(ops.createNote(v, '/Users', '计划', 'x')).rejects.toThrow('在库外')
    await expect(ops.createNote(v, '', '课程/计划', 'x')).rejects.toThrow('标题里不能有 /')
    expect(status(root)).toBe('')
  })

  it('新建文件夹：放 .gitkeep（Git 记得住空文件夹）；重名、名字不对报错', async () => {
    const { root, v } = vaultWith({ '课程/a.md': '# a\n' })
    const r = await ops.makeFolder(v, '课程', 'ecp')
    expect(r).toEqual({ path: '课程/ecp', touched: ['课程/ecp/.gitkeep'] })
    expect(existsSync(join(root, '课程/ecp/.gitkeep'))).toBe(true)
    await expect(ops.makeFolder(v, '课程', 'ecp')).rejects.toThrow('「课程」里已经有「ecp」了')
    await expect(ops.makeFolder(v, '没有', 'x')).rejects.toThrow('没有「没有」这个文件夹')
    await expect(ops.makeFolder(v, '', 'a/b')).rejects.toThrow('名字里不能有 /')
  })
})

describe('改名（链接跟着改）', () => {
  it('改一篇：库里的 [[旧名]] 都换成新名，开头「# 旧名」跟着改，附件文件夹跟过去；碰过的都在要提交的路径里', async () => {
    const { root, v, deps, moved } = vaultWith({
      '课程/冰岛.md': '# 冰岛\n\n![](../附件/课程/冰岛/图.png)\n',
      '附件/课程/冰岛/图.png': Buffer.from('png'),
      '旅行.md': '# 旅行\n\n见 [[冰岛]] 和 [[冰岛#行程]]，路线在 [这里](课程/冰岛.md#路线)。\n',
    })
    const r = await ops.renamePath(v, deps, '课程/冰岛.md', '冰岛自驾')
    expect(r).toMatchObject({ from: '课程/冰岛.md', to: '课程/冰岛自驾.md', folder: false })
    expect(read(root, '课程/冰岛自驾.md')).toBe('# 冰岛自驾\n\n![](../附件/课程/冰岛自驾/图.png)\n')
    expect(read(root, '旅行.md')).toBe('# 旅行\n\n见 [[冰岛自驾]] 和 [[冰岛自驾#行程]]，路线在 [这里](课程/冰岛自驾.md#路线)。\n')
    expect(existsSync(join(root, '附件/课程/冰岛自驾/图.png'))).toBe(true)
    expect(r.touched.sort()).toEqual(['旅行.md', '课程/冰岛.md', '课程/冰岛自驾.md', '附件/课程/冰岛/图.png', '附件/课程/冰岛自驾/图.png'].sort())
    expect(moved).toContainEqual(['课程/冰岛.md', '课程/冰岛自驾.md'])
    expect(commits(root)).toBe(1)
  })

  it('改名：用户在这几篇里没提交的字先单独提交（AI 那次提交里只有 AI 的改动）', async () => {
    const { root, v, deps } = vaultWith({ '冰岛.md': '# 冰岛\n', '旅行.md': '# 旅行\n\n[[冰岛]]\n', '别的.md': '# 别的\n' })
    writeFileSync(join(root, '旅行.md'), '# 旅行\n\n[[冰岛]]\n\n刚打的字\n')
    writeFileSync(join(root, '别的.md'), '# 别的\n\n也没提交\n')
    await ops.renamePath(v, deps, '冰岛', '冰岛自驾')
    expect(commits(root)).toBe(2)
    expect(g(root, 'show', 'HEAD:旅行.md')).toBe('# 旅行\n\n[[冰岛]]\n\n刚打的字\n')
    // 不相干的那篇不碰
    expect(status(root)).toContain(' M 别的.md')
  })

  it('改一个文件夹：里面的笔记、别处写着它路径的链接跟着改', async () => {
    const { root, v, deps } = vaultWith({ '课程/ecp/第1讲.md': '# 第1讲\n', '计划.md': '# 计划\n\n[第1讲](课程/ecp/第1讲.md)\n' })
    const r = await ops.renamePath(v, deps, '课程/ecp', '经济学')
    expect(r).toMatchObject({ from: '课程/ecp', to: '课程/经济学', folder: true })
    expect(existsSync(join(root, '课程/经济学/第1讲.md'))).toBe(true)
    expect(read(root, '计划.md')).toBe('# 计划\n\n[第1讲](课程/经济学/第1讲.md)\n')
    expect(r.touched).toEqual(expect.arrayContaining(['计划.md', '课程/ecp/第1讲.md', '课程/经济学/第1讲.md']))
  })

  it('改名：重名、没有这篇、名字没变、固定的文件夹、新名字带 / 都说清楚', async () => {
    const { root, v, deps } = vaultWith({ '冰岛.md': '# 冰岛\n', '冰岛自驾.md': '# 冰岛自驾\n', '收件箱/a.md': '# a\n' })
    await expect(ops.renamePath(v, deps, '冰岛.md', '冰岛自驾')).rejects.toThrow('「库的最外层」里已经有一篇叫「冰岛自驾」了（冰岛自驾.md）')
    await expect(ops.renamePath(v, deps, '没有的.md', '新')).rejects.toThrow('没有「没有的.md」')
    await expect(ops.renamePath(v, deps, '冰岛.md', '冰岛')).rejects.toThrow('名字没变')
    await expect(ops.renamePath(v, deps, '收件箱', '新收件箱')).rejects.toThrow('固定的文件夹')
    await expect(ops.renamePath(v, deps, '冰岛.md', '课程/冰岛')).rejects.toThrow('新名字里不能有 /')
    expect(status(root)).toBe('')
  })
})

describe('挪动（链接跟着改）', () => {
  it('挪一篇进别的文件夹：别的笔记里指向它的相对链接、它自己的附件和链接跟着改，[[双链]] 不用动', async () => {
    const { root, v, deps } = vaultWith({
      '收件箱/冰岛.md': '# 冰岛\n\n![](../附件/收件箱/冰岛/图.png)\n',
      '附件/收件箱/冰岛/图.png': Buffer.from('png'),
      '课程/.gitkeep': '',
      '旅行.md': '# 旅行\n\n[冰岛](收件箱/冰岛.md) 和 [[冰岛]]\n',
    })
    const r = await ops.movePath(v, deps, '收件箱/冰岛.md', '课程')
    expect(r).toMatchObject({ from: '收件箱/冰岛.md', to: '课程/冰岛.md', folder: false })
    expect(read(root, '课程/冰岛.md')).toBe('# 冰岛\n\n![](../附件/课程/冰岛/图.png)\n')
    expect(read(root, '旅行.md')).toBe('# 旅行\n\n[冰岛](课程/冰岛.md) 和 [[冰岛]]\n')
    expect(existsSync(join(root, '附件/课程/冰岛/图.png'))).toBe(true)
    expect(r.touched).toEqual(expect.arrayContaining(['收件箱/冰岛.md', '课程/冰岛.md', '旅行.md', '附件/收件箱/冰岛/图.png', '附件/课程/冰岛/图.png']))
    expect(commits(root)).toBe(1)
  })

  it('挪一篇用着数据库的笔记：挂在它下面的记录文件夹跟着挪（task-5yp97），to 还是那篇，with 写着跟着挪的，要提交的路径里都有', async () => {
    const B = (f: string) => '```base\nfilters:\n  and:\n    - file.inFolder("' + f + '")\nviews:\n  - type: table\n    name: 表格\n```'
    const { root, v, deps, moved } = vaultWith({ '项目/表.md': `# 表\n\n${B('项目/库')}\n`, '项目/库/一号.md': '# 一号\n', '课程/.gitkeep': '' })
    const r = await ops.movePath(v, deps, '项目/表.md', '课程')
    expect(r).toMatchObject({ from: '项目/表.md', to: '课程/表.md', folder: false, with: [{ from: '项目/库', to: '课程/库' }] })
    expect(read(root, '课程/表.md')).toBe(`# 表\n\n${B('课程/库')}\n`)
    expect(r.touched).toEqual(expect.arrayContaining(['项目/表.md', '课程/表.md', '项目/库/一号.md', '课程/库/一号.md']))
    expect(moved).toEqual(expect.arrayContaining([['项目/表.md', '课程/表.md'], ['项目/库/一号.md', '课程/库/一号.md']]))
  })

  it('挪一个文件夹进另一个文件夹；挪到库的最外层写空字符串', async () => {
    const { root, v, deps } = vaultWith({ '项目/旧/a.md': '# a\n', '课程/.gitkeep': '', '课程/b.md': '# b\n' })
    const r = await ops.movePath(v, deps, '项目/旧', '课程')
    expect(r).toMatchObject({ from: '项目/旧', to: '课程/旧', folder: true })
    expect(existsSync(join(root, '课程/旧/a.md'))).toBe(true)
    const back = await ops.movePath(v, deps, '课程/b.md', '')
    expect(back.to).toBe('b.md')
  })

  it('挪动：目标里有同名的、目标文件夹不在、已经在那里、挪进自己里面、PDF 都说清楚', async () => {
    const { root, v, deps } = vaultWith({ '收件箱/冰岛.md': '# 冰岛\n', '课程/冰岛.md': '# 冰岛\n', '项目/x/a.md': '# a\n', '课程/讲义.pdf': 'pdf' })
    await expect(ops.movePath(v, deps, '收件箱/冰岛.md', '课程')).rejects.toThrow('「课程」里已经有「冰岛」了（课程/冰岛.md）')
    await expect(ops.movePath(v, deps, '收件箱/冰岛.md', '生活')).rejects.toThrow('没有「生活」这个文件夹')
    await expect(ops.movePath(v, deps, '课程/冰岛.md', '课程')).rejects.toThrow('已经在「课程」里了')
    await expect(ops.movePath(v, deps, '项目', '项目/x')).rejects.toThrow('挪进它自己里面')
    await expect(ops.movePath(v, deps, '课程/讲义.pdf', '项目')).rejects.toThrow('只挪笔记和文件夹')
    expect(status(root)).toBe('')
  })
})

describe('删掉（进废纸篓，能撤回）', () => {
  it('删一篇：连同只有它在用的附件进废纸篓，别的笔记也在用的图留着；Git 里撤回那次提交就回来', async () => {
    const { root, trash, v, deps } = vaultWith({
      '冰岛.md': '# 冰岛\n\n![](附件/冰岛/a.png) ![](附件/共用.png)\n',
      '附件/冰岛/a.png': Buffer.from('a'),
      '附件/共用.png': Buffer.from('s'),
      '旅行.md': '# 旅行\n\n![](附件/共用.png)\n',
    })
    const r = await ops.trashPath(v, deps, '冰岛')
    expect(r).toMatchObject({ path: '冰岛.md', folder: false, images: 1, kept: 1 })
    expect(existsSync(join(root, '冰岛.md'))).toBe(false)
    expect(existsSync(join(root, '附件/冰岛/a.png'))).toBe(false)
    expect(existsSync(join(root, '附件/共用.png'))).toBe(true)
    expect(readdirSync(trash).length).toBe(2)
    expect(r.touched.sort()).toEqual(['冰岛.md', '附件/冰岛/a.png'])
    // 这一轮结束提交、再撤回：笔记和图都回来
    g(root, 'add', '-A', '--', ...r.touched)
    g(root, 'commit', '-q', '-m', 'AI：删掉冰岛')
    g(root, 'revert', '--no-edit', 'HEAD')
    expect(read(root, '冰岛.md')).toContain('# 冰岛')
    expect(existsSync(join(root, '附件/冰岛/a.png'))).toBe(true)
  })

  it('删一个文件夹：整个进废纸篓；固定的文件夹、没有这个、不是笔记的说清楚', async () => {
    const { root, v, deps } = vaultWith({ '项目/旧/a.md': '# a\n', '项目/旧/b.md': '# b\n', '收件箱/x.md': '# x\n', '讲义.pdf': 'pdf' })
    const r = await ops.trashPath(v, deps, '项目/旧')
    expect(r).toMatchObject({ path: '项目/旧', folder: true, files: 2 })
    expect(existsSync(join(root, '项目/旧'))).toBe(false)
    expect(r.touched.sort()).toEqual(['项目/旧/a.md', '项目/旧/b.md'])
    // 查不过的不先关标签（固定的文件夹、没有这篇）
    const closed: string[] = []
    const withClose = { ...deps, beforeTrash: async (rel: string) => void closed.push(rel) }
    await expect(ops.trashPath(v, withClose, '收件箱')).rejects.toThrow('固定的文件夹')
    await expect(ops.trashPath(v, withClose, '没有.md')).rejects.toThrow('没有「没有.md」')
    expect(closed).toEqual([])
    await expect(ops.trashPath(v, deps, '收件箱')).rejects.toThrow('固定的文件夹')
    await expect(ops.trashPath(v, deps, '没有.md')).rejects.toThrow('没有「没有.md」')
    await expect(ops.trashPath(v, deps, '讲义.pdf')).rejects.toThrow('只删笔记和文件夹')
  })
})

describe('列出文件夹', () => {
  it('库里的文件夹（不进 . 开头的、附件/）', async () => {
    const { v } = vaultWith({ '课程/ecp/a.md': '# a\n', '附件/x/a.png': 'p', '.canvas-notes/置顶.json': '[]', '生活/.gitkeep': '' })
    expect(await ops.listFolders(v)).toEqual(['生活', '课程', '课程/ecp'])
  })
})
