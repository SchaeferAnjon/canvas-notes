import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveLink } from '@cn/format'
import * as git from '@cn/git'
import { fixedFolder, GITKEEP, makeFolder, moveFolder, moveItem, moveMany, planCarry, renameFolder, testTrash, trashFiles, trashFolder } from '../src/main/folder-ops'
import { Vault } from '../src/main/vault'

const roots: string[] = []
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
})

const g = (root: string, ...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' })

/** 一个提交好的临时库 */
function vaultWith(files: Record<string, string>) {
  const base = mkdtempSync(join(tmpdir(), 'cn-fops-'))
  roots.push(base)
  const root = join(base, '库')
  const trash = join(base, 'trash')
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
  return { root, trash, v: new Vault(root) }
}

const commits = (root: string) => Number(g(root, 'rev-list', '--count', 'HEAD').trim())
const lastMsg = (root: string) => g(root, 'log', '-1', '--format=%s').trim()
const status = (root: string) => g(root, 'status', '--porcelain', '--untracked-files=all').trim()

/** 库里每篇 md 的每个相对链接、带路径的双链都指向真有的文件（点得开） */
function brokenLinks(root: string): string[] {
  const bad: string[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
      if (e.name === '.git') continue
      const rel = dir ? `${dir}/${e.name}` : e.name
      if (e.isDirectory()) walk(rel)
      else if (rel.endsWith('.md')) {
        const text = readFileSync(join(root, rel), 'utf8')
        for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
          const url = m[1]!.replace(/[#?].*$/, '')
          if (/^[a-z]+:/i.test(url)) continue
          const abs = resolveLink(rel, url)
          if (!abs || !existsSync(join(root, abs))) bad.push(`${rel} → ${m[1]}`)
        }
        for (const m of text.matchAll(/\[\[([^\]|#]+\/[^\]|#]*)/g)) if (!existsSync(join(root, m[1]! + '.md')) && !existsSync(join(root, m[1]!))) bad.push(`${rel} → [[${m[1]}`)
      }
    }
  }
  walk('')
  return bad
}

const SAMPLE = {
  '课程/ecp/Lecture05.pdf': '%PDF-1.4\n',
  '课程/ecp/图 1.png': 'png',
  '课程/ecp/Lecture05 笔记.md': '# Lecture05 笔记\n\n[第 5 页](Lecture05.pdf#page=5) · [完整对话](../../.canvas-notes/对话/Lecture05-p5-1.md)\n\n![图](图%201.png)\n',
  '.canvas-notes/对话/Lecture05-p5-1.md': '# 完整对话\n\n[回到第 5 页](../../课程/ecp/Lecture05.pdf#page=5)\n',
  '.canvas-notes/置顶.json': JSON.stringify(['课程/ecp/Lecture05 笔记.md', '复习.md'], null, 2) + '\n',
  '复习.md': '# 复习\n\n[[课程/ecp/Lecture05 笔记]] · [讲义](课程/ecp/Lecture05.pdf#page=2) · ![图](课程/ecp/图%201.png) · [[Lecture05 笔记]]\n',
  '写作/读后感.md': '# 读后感\n\n见 [笔记](../课程/ecp/Lecture05%20笔记.md)。\n',
  '写作/无关.md': '# 无关\n\n[网页](https://example.com/课程/ecp)\n',
}

describe('文件夹改名', () => {
  it('有文件的课程改名：库里所有链接还点得开，置顶跟着换，一次提交，git 干净', async () => {
    const { root, v } = vaultWith(SAMPLE)
    expect(brokenLinks(root)).toEqual([])
    const n0 = commits(root)
    const moved: string[] = []
    const r = await renameFolder(v, '课程/ecp', 'ECP 经济学', (from, to) => moved.push(`${from} → ${to}`))
    expect(r.to).toBe('课程/ECP 经济学')
    expect(existsSync(join(root, '课程/ecp'))).toBe(false)
    expect(existsSync(join(root, '课程/ECP 经济学/Lecture05.pdf'))).toBe(true)
    expect(brokenLinks(root)).toEqual([])
    expect(readFileSync(join(root, '复习.md'), 'utf8')).toBe('# 复习\n\n[[课程/ECP 经济学/Lecture05 笔记]] · [讲义](课程/ECP%20经济学/Lecture05.pdf#page=2) · ![图](课程/ECP%20经济学/图%201.png) · [[Lecture05 笔记]]\n')
    // 里面的笔记链接本来就是相对的：一个字不动
    expect(readFileSync(join(root, '课程/ECP 经济学/Lecture05 笔记.md'), 'utf8')).toBe(SAMPLE['课程/ecp/Lecture05 笔记.md'])
    // 没提到这个文件夹的不碰
    expect(readFileSync(join(root, '写作/无关.md'), 'utf8')).toBe(SAMPLE['写作/无关.md'])
    expect(JSON.parse(readFileSync(join(root, '.canvas-notes/置顶.json'), 'utf8'))).toEqual(['课程/ECP 经济学/Lecture05 笔记.md', '复习.md'])
    expect(r.relinked.sort()).toEqual(['.canvas-notes/对话/Lecture05-p5-1.md', '写作/读后感.md', '复习.md'])
    expect(moved).toContain('课程/ecp/Lecture05.pdf → 课程/ECP 经济学/Lecture05.pdf')
    expect(commits(root)).toBe(n0 + 1)
    expect(lastMsg(root)).toBe('文件夹改名：课程/ecp → 课程/ECP 经济学')
    expect(status(root)).toBe('')
    // 撤回这一次提交，回到原样
    g(root, 'revert', '--no-edit', 'HEAD')
    expect(readFileSync(join(root, '复习.md'), 'utf8')).toBe(SAMPLE['复习.md'])
    expect(existsSync(join(root, '课程/ecp/Lecture05.pdf'))).toBe(true)
  })

  it('用户没提交的字先单独提交：改名那次提交里只有改名', async () => {
    const { root, v } = vaultWith(SAMPLE)
    writeFileSync(join(root, '复习.md'), SAMPLE['复习.md'] + '\n刚打的字\n')
    writeFileSync(join(root, '写作/无关.md'), '# 无关\n\n别的地方在打字\n')
    const n0 = commits(root)
    await renameFolder(v, '课程/ecp', 'ecp2')
    expect(commits(root)).toBe(n0 + 2)
    const diff = g(root, 'show', 'HEAD', '--', '复习.md')
    expect(diff).not.toContain('+刚打的字')
    expect(diff).toContain('+[[课程/ecp2/Lecture05 笔记]]')
    expect(readFileSync(join(root, '复习.md'), 'utf8')).toContain('刚打的字')
    // 跟这个文件夹无关的改动不提交，留给用户
    expect(status(root)).toBe('M 写作/无关.md')
  })

  it('最外层固定的文件夹、重名、坏名字不改', async () => {
    const { v } = vaultWith({ ...SAMPLE, '课程/线代/a.md': '# a\n' })
    expect(fixedFolder('生活')).toBe(true)
    expect(fixedFolder('课程/生活')).toBe(false)
    await expect(renameFolder(v, '写作', '写字')).rejects.toThrow('固定的文件夹')
    await expect(renameFolder(v, '课程/ecp', '线代')).rejects.toThrow('已经有「线代」了')
    await expect(renameFolder(v, '课程/ecp', '../外面')).rejects.toThrow('不能有')
    await expect(renameFolder(v, '../外面', 'x')).rejects.toThrow('文件夹不对')
  })

  it('里面笔记的附件（附件/<笔记路径>/）跟着挪，指向它们的链接也换', async () => {
    const { root, v } = vaultWith({
      ...SAMPLE,
      '附件/课程/ecp/Lecture05 笔记/截图 1.png': 'png',
      '课程/ecp/Lecture05 笔记.md': '# Lecture05 笔记\n\n![截图](../../附件/课程/ecp/Lecture05%20笔记/截图%201.png)\n',
      '复习.md': '# 复习\n\n![同一张](附件/课程/ecp/Lecture05%20笔记/截图%201.png)\n',
    })
    await renameFolder(v, '课程/ecp', '经济学')
    expect(existsSync(join(root, '附件/课程/经济学/Lecture05 笔记/截图 1.png'))).toBe(true)
    expect(existsSync(join(root, '附件/课程/ecp'))).toBe(false)
    expect(brokenLinks(root)).toEqual([])
    expect(readFileSync(join(root, '课程/经济学/Lecture05 笔记.md'), 'utf8')).toContain('](../../附件/课程/经济学/Lecture05%20笔记/截图%201.png)')
    expect(status(root)).toBe('')
  })

  it('数据库的数据源文件夹改名、挪走：```base 里的 file.inFolder 跟着换，和链接同一次提交', async () => {
    const base = (f: string) => '```base\nfilters:\n  and:\n    - file.inFolder("' + f + '")\nviews:\n  - type: table\n    name: 表格\n```'
    const { root, v } = vaultWith({ '项目/表.md': `# 表\n\n${base('项目/库')}\n`, '项目/库/一号.md': '---\n状态: 进行中\n---\n', '写作/a.md': '# a\n' })
    const n0 = commits(root)
    const r1 = await moveFolder(v, '项目/库', '写作')
    expect(r1.to).toBe('写作/库')
    expect(readFileSync(join(root, '项目/表.md'), 'utf8')).toBe(`# 表\n\n${base('写作/库')}\n`)
    expect(r1.relinked).toEqual(['项目/表.md'])
    expect(commits(root)).toBe(n0 + 1)
    expect(status(root)).toBe('')
    const r2 = await renameFolder(v, '写作/库', '项目库')
    expect(r2.to).toBe('写作/项目库')
    expect(readFileSync(join(root, '项目/表.md'), 'utf8')).toBe(`# 表\n\n${base('写作/项目库')}\n`)
    expect(status(root)).toBe('')
  })

  it('只改大小写也行', async () => {
    const { root, v } = vaultWith(SAMPLE)
    const r = await renameFolder(v, '课程/ecp', 'ECP')
    expect(readdirSync(join(root, '课程'))).toEqual(['ECP'])
    expect(r.to).toBe('课程/ECP')
    expect(brokenLinks(root)).toEqual([])
  })
})

describe('新建文件夹', () => {
  it('放 .gitkeep、提交，git 干净；重名加序号', async () => {
    const { root, v } = vaultWith({ '写作/a.md': '# a\n' })
    expect(await makeFolder(v, '写作', ' 旅行 ')).toBe('写作/旅行')
    expect(readdirSync(join(root, '写作/旅行'))).toEqual([GITKEEP])
    expect(lastMsg(root)).toBe('新建文件夹：写作/旅行')
    expect(status(root)).toBe('')
    expect(await makeFolder(v, '写作', '旅行')).toBe('写作/旅行 2')
    expect(await makeFolder(v, '', '读书')).toBe('读书')
    await expect(makeFolder(v, '写作', 'a/b')).rejects.toThrow('不能有')
  })
})

describe('文件夹移到废纸篓', () => {
  it('连里面的文件挪走，置顶拿掉，一次提交，能撤回', async () => {
    const { root, trash, v } = vaultWith(SAMPLE)
    const n = await trashFolder(v, '课程/ecp', testTrash(trash))
    expect(n).toBe(3)
    expect(existsSync(join(root, '课程/ecp'))).toBe(false)
    expect(readdirSync(trash)).toHaveLength(1)
    expect(JSON.parse(readFileSync(join(root, '.canvas-notes/置顶.json'), 'utf8'))).toEqual(['复习.md'])
    expect(lastMsg(root)).toBe('移到废纸篓：课程/ecp（3 个文件）')
    expect(status(root)).toBe('')
    g(root, 'revert', '--no-edit', 'HEAD')
    expect(existsSync(join(root, '课程/ecp/Lecture05 笔记.md'))).toBe(true)
  })

  it('固定的文件夹不删', async () => {
    const { trash, v } = vaultWith(SAMPLE)
    await expect(trashFolder(v, '课程', testTrash(trash))).rejects.toThrow('固定的文件夹')
  })
})

describe('文件树里删 PDF、HTML、图片（不是笔记）：当场单独一次提交，不留在工作区等别的提交顺带进去（task-1df7j）', () => {
  it('删 2 张图：一次提交只含它们，说明照实写；用户别处没提交的字不带进去；撤回后回来。没提交过的新图先提交再删，历史里也放得回来', async () => {
    const { root, trash, v } = vaultWith({ ...SAMPLE, '附件/Lecture05/p1-1.png': 'a', '附件/老的/没人用.png': 'b', '写作/草稿.md': '# 草稿\n' })
    // 用户正在写的另一篇（没提交）：不能被这次删除顺带进去
    writeFileSync(join(root, '写作/草稿.md'), '# 草稿\n\n还没提交的字\n')
    writeFileSync(join(root, '附件/老的/刚粘的.png'), 'c')
    const before = commits(root)
    const sha = await trashFiles(v, ['附件/老的/没人用.png', '附件/老的/刚粘的.png'], testTrash(trash))
    expect(sha).toMatch(/^[0-9a-f]{40}$/)
    expect(readdirSync(join(root, '附件/老的'))).toEqual([])
    expect(readdirSync(trash)).toHaveLength(2)
    // 先提交了没进过 Git 的那张，再一次删除
    expect(commits(root)).toBe(before + 2)
    expect(lastMsg(root)).toBe('删除 2 个文件：附件/老的/刚粘的.png、附件/老的/没人用.png')
    expect(g(root, 'show', '--name-status', '--format=', 'HEAD').trim().split('\n').sort()).toEqual(['D\t附件/老的/刚粘的.png', 'D\t附件/老的/没人用.png'])
    expect(status(root)).toBe('M 写作/草稿.md')
    g(root, 'revert', '--no-edit', 'HEAD')
    expect(readFileSync(join(root, '附件/老的/没人用.png'), 'utf8')).toBe('b')
    expect(readFileSync(join(root, '附件/老的/刚粘的.png'), 'utf8')).toBe('c')
    expect(existsSync(join(root, '附件/Lecture05/p1-1.png'))).toBe(true)
  })

  it('笔记（md）、文件夹、库外的不走这里', async () => {
    const { trash, v } = vaultWith({ ...SAMPLE, '附件/a.png': 'a' })
    await expect(trashFiles(v, ['复习.md'], testTrash(trash))).rejects.toThrow('要删的不对')
    await expect(trashFiles(v, ['课程/ecp'], testTrash(trash))).rejects.toThrow('不是文件')
    await expect(trashFiles(v, ['../外面.png'], testTrash(trash))).rejects.toThrow('库外')
    await expect(trashFiles(v, [], testTrash(trash))).rejects.toThrow('要删的不对')
  })
})

describe('挪一篇笔记：挂在它下面的数据库记录文件夹跟着一起挪（task-5yp97「藏之后」）', () => {
  const B = (f: string) => '```base\nfilters:\n  and:\n    - file.inFolder("' + f + '")\nviews:\n  - type: table\n    name: 表格\n```'
  const read = (root: string, p: string) => readFileSync(join(root, p), 'utf8')

  it('挪「表」：它旁边的记录文件夹一起挪，数据库块里的路径、记录里指回去的链接、别处指向记录的链接都对，一次提交，git 干净', async () => {
    const { root, v } = vaultWith({
      '项目/表.md': `# 表\n\n${B('项目/库')}\n`,
      '项目/库/一号.md': '# 一号\n\n[回到表](../表.md)\n',
      '项目/库/二号.md': '# 二号\n',
      '附件/项目/库/一号/图.png': 'png',
      '项目/别的.md': '# 别的\n',
      '复习.md': '# 复习\n\n[一号](项目/库/一号.md)\n',
      '写作/a.md': '# a\n',
    })
    const n0 = commits(root)
    const r = await moveMany(v, ['项目/表.md'], '写作')
    expect(r.moves).toEqual([
      { from: '项目/表.md', to: '写作/表.md' },
      { from: '项目/库', to: '写作/库', with: '写作/表.md' },
    ])
    expect(commits(root)).toBe(n0 + 1)
    expect(lastMsg(root)).toBe('移动 1 个：表 → 写作（它的数据库跟着挪：库）')
    expect(status(root)).toBe('')
    expect(read(root, '写作/表.md')).toBe(`# 表\n\n${B('写作/库')}\n`)
    expect(read(root, '写作/库/一号.md')).toBe('# 一号\n\n[回到表](../表.md)\n')
    expect(read(root, '复习.md')).toBe('# 复习\n\n[一号](写作/库/一号.md)\n')
    expect(existsSync(join(root, '附件/写作/库/一号/图.png'))).toBe(true)
    expect(existsSync(join(root, '项目/库'))).toBe(false)
    expect(existsSync(join(root, '项目/别的.md'))).toBe(true)
    expect(brokenLinks(root)).toEqual([])
  })

  it('两篇都用：只跟着挂着它的那篇（同一个文件夹里名字排最前的）走，另一篇的数据库块也改好；先挪另一篇，它不动', async () => {
    const { root, v } = vaultWith({
      '项目/甲.md': `# 甲\n\n${B('项目/库')}\n`,
      '项目/乙.md': `# 乙\n\n${B('项目/库')}\n`,
      '项目/库/一号.md': '# 一号\n',
      '写作/a.md': '# a\n',
      '生活/b.md': '# b\n',
    })
    // 「乙」不是挂着它的那篇（「甲」排在前面）：挪「乙」，记录文件夹留在原处
    const r1 = await moveMany(v, ['项目/乙.md'], '生活')
    expect(r1.moves).toEqual([{ from: '项目/乙.md', to: '生活/乙.md' }])
    expect(existsSync(join(root, '项目/库/一号.md'))).toBe(true)
    // 挪「甲」：跟着走，已经在「生活」的「乙」里的路径也改好
    const r2 = await moveMany(v, ['项目/甲.md'], '写作')
    expect(r2.moves).toEqual([
      { from: '项目/甲.md', to: '写作/甲.md' },
      { from: '项目/库', to: '写作/库', with: '写作/甲.md' },
    ])
    expect(read(root, '写作/甲.md')).toBe(`# 甲\n\n${B('写作/库')}\n`)
    expect(read(root, '生活/乙.md')).toBe(`# 乙\n\n${B('写作/库')}\n`)
    expect(status(root)).toBe('')
  })

  it('那里已经有同名的文件夹：记录文件夹存成「库 2」挪过去，数据库块写新名字（不因为重名挪不了那篇）', async () => {
    const { root, v } = vaultWith({
      '项目/表.md': `# 表\n\n${B('项目/库')}\n`,
      '项目/库/一号.md': '# 一号\n',
      '写作/库/别人的.md': '# 别人的\n',
    })
    const r = await moveMany(v, ['项目/表.md'], '写作')
    expect(r.moves).toEqual([
      { from: '项目/表.md', to: '写作/表.md' },
      { from: '项目/库', to: '写作/库 2', with: '写作/表.md' },
    ])
    expect(read(root, '写作/表.md')).toBe(`# 表\n\n${B('写作/库 2')}\n`)
    expect(read(root, '写作/库/别人的.md')).toBe('# 别人的\n')
    expect(existsSync(join(root, '写作/库 2/一号.md'))).toBe(true)
    expect(status(root)).toBe('')
  })

  it('选了那篇又选了它的记录文件夹：只挪一次；挪进它自己的记录文件夹、用的是别处的文件夹、那篇已经在那里：都不带着它', async () => {
    const { root, v } = vaultWith({
      '项目/表.md': `# 表\n\n${B('项目/库')}\n`,
      '项目/库/一号.md': '# 一号\n',
      '项目/看板.md': `# 看板\n\n${B('资料/清单')}\n`,
      '资料/清单/一条.md': '# 一条\n',
      '写作/a.md': '# a\n',
    })
    const r1 = await moveMany(v, ['项目/库', '项目/表.md'], '写作')
    expect(r1.moves).toEqual([
      { from: '项目/库', to: '写作/库' },
      { from: '项目/表.md', to: '写作/表.md' },
    ])
    expect(read(root, '写作/表.md')).toBe(`# 表\n\n${B('写作/库')}\n`)
    // 挪进它自己的记录文件夹：这篇成了其中一条，文件夹不动
    const r2 = await moveMany(v, ['写作/表.md'], '写作/库')
    expect(r2.moves).toEqual([{ from: '写作/表.md', to: '写作/库/表.md' }])
    expect(existsSync(join(root, '写作/库/一号.md'))).toBe(true)
    // 用的是别的文件夹里的（不挂在它下面）：不跟着
    const r3 = await moveMany(v, ['项目/看板.md'], '写作')
    expect(r3.moves).toEqual([{ from: '项目/看板.md', to: '写作/看板.md' }])
    expect(existsSync(join(root, '资料/清单/一条.md'))).toBe(true)
    expect(status(root)).toBe('')
  })

  it('AI 整理收件箱挪的几篇（vault.move 一篇篇挪）：挂在下面的记录文件夹也跟着挪；挪之前要先提交的里面有它的每一条；两篇的记录文件夹同名时后一个存成「库 2」；和这次改动同一次提交', async () => {
    const { root, v } = vaultWith({
      '收件箱/甲.md': `# 甲\n\n${B('收件箱/库')}\n`,
      '收件箱/库/一号.md': '# 一号\n',
      '剪藏/乙.md': `# 乙\n\n${B('剪藏/库')}\n`,
      '剪藏/库/二号.md': '# 二号\n',
      '项目/a.md': '# a\n',
    })
    // 用户正改着其中一条（没提交）：挪之前先提交掉，AI 那次提交里只有挪动
    writeFileSync(join(root, '收件箱/库/一号.md'), '# 一号\n\n刚写的\n')
    const moves = [
      { from: '收件箱/甲.md', toFolder: '项目' },
      { from: '剪藏/乙.md', toFolder: '项目' },
    ]
    const carry = await planCarry(v, moves)
    expect(carry.touches('收件箱/库/一号.md')).toBe(true)
    expect(carry.touches('项目/a.md')).toBe(false)
    g(root, 'commit', '-q', '-am', '用户的字')
    const paths: string[] = []
    for (const m of moves) paths.push(m.from, await v.move(m.from, m.toFolder))
    paths.push(...(await carry.run()))
    await git.commitPaths(root, paths, 'AI：/整理收件箱 · 2条')
    expect(status(root)).toBe('')
    expect(read(root, '项目/甲.md')).toBe(`# 甲\n\n${B('项目/库')}\n`)
    expect(read(root, '项目/乙.md')).toBe(`# 乙\n\n${B('项目/库 2')}\n`)
    expect(read(root, '项目/库/一号.md')).toBe('# 一号\n\n刚写的\n')
    expect(existsSync(join(root, '项目/库 2/二号.md'))).toBe(true)
    expect(existsSync(join(root, '收件箱/库'))).toBe(false)
    expect(g(root, 'show', '--name-status', '--no-renames', '--format=', 'HEAD').trim().split('\n').sort()).toEqual([
      'A\t项目/乙.md',
      'A\t项目/库 2/二号.md',
      'A\t项目/库/一号.md',
      'A\t项目/甲.md',
      'D\t剪藏/乙.md',
      'D\t剪藏/库/二号.md',
      'D\t收件箱/库/一号.md',
      'D\t收件箱/甲.md',
    ])
  })

  it('AI 把记录文件夹里的一条单点名挪走、又挪了那篇：那一条去它该去的地方，文件夹带着剩下的跟那篇走，不报错', async () => {
    const { root, v } = vaultWith({
      '收件箱/表.md': `# 表\n\n${B('收件箱/库')}\n`,
      '收件箱/库/一号.md': '# 一号\n',
      '收件箱/库/二号.md': '# 二号\n',
      '项目/a.md': '# a\n',
      '生活/b.md': '# b\n',
    })
    const moves = [
      { from: '收件箱/表.md', toFolder: '项目' },
      { from: '收件箱/库/一号.md', toFolder: '生活' },
    ]
    const carry = await planCarry(v, moves)
    const paths: string[] = []
    for (const m of moves) paths.push(m.from, await v.move(m.from, m.toFolder))
    paths.push(...(await carry.run()))
    await git.commitPaths(root, paths, 'AI：/整理收件箱 · 2条')
    expect(status(root)).toBe('')
    expect(existsSync(join(root, '生活/一号.md'))).toBe(true)
    expect(existsSync(join(root, '项目/库/二号.md'))).toBe(true)
    expect(existsSync(join(root, '项目/库/一号.md'))).toBe(false)
    expect(read(root, '项目/表.md')).toBe(`# 表\n\n${B('项目/库')}\n`)
  })
})

describe('首页卡里拖走一份（task-r00en）：PDF 连挂着的笔记、可视化一起挪，链接改好，一次提交', () => {
  const NOTE = [
    '# Lecture05 笔记',
    '',
    '## 第 5 页 · 旋转矩阵',
    '[第 5 页](Lecture05.pdf#page=5&rect=0.1,0.2,0.3,0.4) · 10:20',
    '',
    '![我框的](../../附件/Lecture05/p5-1.png)',
    '',
    '> [!question] 我的疑惑',
    '> 旋转矩阵怎么来的',
    '',
    '![图](图%201.png)',
    '',
    '[完整对话 · 1 轮](../../.canvas-notes/对话/Lecture05-p5-1.md) · [可视化 · 旋转](旋转.html)',
    '',
  ].join('\n')
  const ITEM: Record<string, string> = {
    ...SAMPLE,
    '课程/ecp/Lecture05 笔记.md': NOTE,
    '课程/ecp/旋转.html': '<html><head><meta name="第几讲" content="5"></head><body>转</body></html>\n',
    '课程/ecp/别的.html': '<html><body>不挂</body></html>\n',
    '附件/Lecture05/p5-1.png': 'png',
    '课程/ml/.gitkeep': '',
  }

  it('拖 PDF 到「课程/ml」：PDF、它的笔记、笔记里的可视化一起过去；附件/<PDF名>/ 不动；库里链接都点得开；一次提交、git 干净；拖回去回到原样', async () => {
    const { root, v } = vaultWith(ITEM)
    expect(brokenLinks(root)).toEqual([])
    const n0 = commits(root)
    const moved: string[] = []
    const r = await moveItem(v, '课程/ecp/Lecture05.pdf', '课程/ml', (from, to) => moved.push(`${from} → ${to}`))
    expect(r.moves.map((m) => `${m.from} → ${m.to}`)).toEqual([
      '课程/ecp/Lecture05.pdf → 课程/ml/Lecture05.pdf',
      '课程/ecp/Lecture05 笔记.md → 课程/ml/Lecture05 笔记.md',
      '课程/ecp/旋转.html → 课程/ml/旋转.html',
    ])
    expect(moved).toEqual(r.moves.map((m) => `${m.from} → ${m.to}`))
    for (const p of ['课程/ml/Lecture05.pdf', '课程/ml/Lecture05 笔记.md', '课程/ml/旋转.html', '附件/Lecture05/p5-1.png', '课程/ecp/别的.html', '课程/ecp/图 1.png']) expect(existsSync(join(root, p)), p).toBe(true)
    for (const p of ['课程/ecp/Lecture05.pdf', '课程/ecp/Lecture05 笔记.md', '课程/ecp/旋转.html']) expect(existsSync(join(root, p)), p).toBe(false)
    expect(brokenLinks(root)).toEqual([])
    // 笔记里：PDF、可视化同在一处，照旧；留在原处的图换成新的相对路径；附件同深度不变
    const note = readFileSync(join(root, '课程/ml/Lecture05 笔记.md'), 'utf8')
    expect(note).toContain('[第 5 页](Lecture05.pdf#page=5&rect=0.1,0.2,0.3,0.4)')
    expect(note).toContain('[可视化 · 旋转](旋转.html)')
    expect(note).toContain('![图](../ecp/图%201.png)')
    expect(note).toContain('![我框的](../../附件/Lecture05/p5-1.png)')
    // 别处：带路径的双链、相对链接、置顶都换
    expect(readFileSync(join(root, '复习.md'), 'utf8')).toBe('# 复习\n\n[[课程/ml/Lecture05 笔记]] · [讲义](课程/ml/Lecture05.pdf#page=2) · ![图](课程/ecp/图%201.png) · [[Lecture05 笔记]]\n')
    expect(readFileSync(join(root, '.canvas-notes/对话/Lecture05-p5-1.md'), 'utf8')).toContain('(../../课程/ml/Lecture05.pdf#page=5)')
    expect(JSON.parse(readFileSync(join(root, '.canvas-notes/置顶.json'), 'utf8'))).toEqual(['课程/ml/Lecture05 笔记.md', '复习.md'])
    expect(commits(root)).toBe(n0 + 1)
    expect(lastMsg(root)).toBe('移动：Lecture05.pdf → 课程/ml（连同笔记、1 个可视化）')
    expect(r.commit).toBe(g(root, 'rev-parse', 'HEAD').trim())
    expect(status(root)).toBe('')
    // 再拖回去（界面的「撤回」）：回到原样，又一次提交
    const back = await moveItem(v, '课程/ml/Lecture05.pdf', '课程/ecp')
    expect(back.moves).toHaveLength(3)
    for (const p of Object.keys(ITEM)) expect(readFileSync(join(root, p), 'utf8'), p).toBe(ITEM[p])
    expect(status(root)).toBe('')
  })

  it('拖的是 PDF 下挂着的那篇笔记：和拖 PDF 一样整组走（笔记不和它的 PDF 分家）', async () => {
    const { root, v } = vaultWith(ITEM)
    const r = await moveItem(v, '课程/ecp/Lecture05 笔记.md', '课程/ml')
    expect(r.moves.map((m) => m.to)).toEqual(['课程/ml/Lecture05.pdf', '课程/ml/Lecture05 笔记.md', '课程/ml/旋转.html'])
    expect(brokenLinks(root)).toEqual([])
    expect(status(root)).toBe('')
  })

  it('那里已经有同名的：报错，一个都不挪；已经在那里：什么都不做；用户没提交的字先单独提交', async () => {
    const { root, v } = vaultWith({ ...ITEM, '课程/ml/Lecture05.pdf': '%PDF 别的\n' })
    writeFileSync(join(root, '复习.md'), ITEM['复习.md'] + '\n刚打的字\n')
    await expect(moveItem(v, '课程/ecp/Lecture05.pdf', '课程/ml')).rejects.toThrow('「课程/ml」里已经有「Lecture05.pdf」了')
    expect(existsSync(join(root, '课程/ecp/Lecture05 笔记.md'))).toBe(true)
    const n0 = commits(root)
    expect(await moveItem(v, '课程/ecp/Lecture05.pdf', '课程/ecp')).toEqual({ moves: [], commit: null })
    expect(commits(root)).toBe(n0)
    // 换一个没同名的地方：用户的字单独一次提交在前，挪是后一次
    const r = await moveItem(v, '课程/ecp/Lecture05.pdf', '写作')
    expect(r.moves).toHaveLength(3)
    expect(commits(root)).toBe(n0 + 2)
    expect(g(root, 'show', '--stat', '--format=', 'HEAD~1').trim()).toContain('复习.md')
    expect(readFileSync(join(root, '复习.md'), 'utf8')).toContain('刚打的字')
    expect(brokenLinks(root)).toEqual([])
    expect(status(root)).toBe('')
  })

  it('可视化单独拖走：只挪它，笔记里那条链接改好；普通笔记照「移到」那一套（同名存成「X 2」）', async () => {
    const { root, v } = vaultWith({ ...ITEM, '课程/ml/读后感.md': '# 别的读后感\n' })
    const r = await moveItem(v, '课程/ecp/旋转.html', '课程/ml')
    expect(r.moves.map((m) => m.to)).toEqual(['课程/ml/旋转.html'])
    expect(readFileSync(join(root, '课程/ecp/Lecture05 笔记.md'), 'utf8')).toContain('[可视化 · 旋转](../ml/旋转.html)')
    expect(brokenLinks(root)).toEqual([])
    const n = await moveItem(v, '写作/读后感.md', '课程/ml')
    expect(n.moves.map((m) => m.to)).toEqual(['课程/ml/读后感 2.md'])
    expect(brokenLinks(root)).toEqual([])
    expect(status(root)).toBe('')
  })
})
