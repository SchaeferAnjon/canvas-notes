import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commitAll, commitPaths, currentBranch, git, gitPath, init, isRepo, log, parseStatus, remote, revert, setRemote, status } from '../src'

let dir: string
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'cn-git-'))
  await init(dir)
  await git(dir, ['config', 'user.name', 'Test'])
  await git(dir, ['config', 'user.email', 'test@example.com'])
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

it('新库：是仓库、分支 main、没有提交', async () => {
  expect(await isRepo(dir)).toBe(true)
  expect(await currentBranch(dir)).toBe('main')
  expect(await log(dir)).toEqual([])
  expect(await isRepo(tmpdir())).toBe(false)
})

it('状态、提交、历史里有改了哪些文件（中文文件名不转义）', async () => {
  writeFileSync(join(dir, '所思所想.md'), '# 所思所想\n第一行\n')
  writeFileSync(join(dir, 'b.md'), 'b\n')
  expect((await status(dir)).map((s) => [s.code, s.path]).sort()).toEqual([
    ['??', 'b.md'],
    ['??', '所思所想.md'],
  ])
  const h1 = await commitAll(dir, '第一次')
  expect(h1).toMatch(/^[0-9a-f]{40}$/)
  expect(await commitAll(dir, '没有改动')).toBeNull()

  writeFileSync(join(dir, '所思所想.md'), '# 所思所想\n第一行改了\n第二行\n')
  expect(await status(dir)).toEqual([{ code: ' M', path: '所思所想.md' }])
  await commitAll(dir, '改了一篇')

  const commits = await log(dir)
  expect(commits.map((c) => c.subject)).toEqual(['改了一篇', '第一次'])
  expect(commits[0]!.files).toEqual([{ path: '所思所想.md', added: 2, removed: 1 }])
  expect(commits[1]!.files.map((f) => f.path).sort()).toEqual(['b.md', '所思所想.md'])
})

it('只提交 AI 改的那几个文件；撤回是一次反向提交', async () => {
  writeFileSync(join(dir, 'a.md'), 'a\n')
  writeFileSync(join(dir, 'b.md'), 'b\n')
  await commitAll(dir, '起点')
  writeFileSync(join(dir, 'a.md'), 'a\nAI 加的\n')
  writeFileSync(join(dir, 'b.md'), 'b 用户正在改\n')
  writeFileSync(join(dir, 'new.md'), '新的\n')
  const h = await commitPaths(dir, ['a.md', 'new.md'], 'AI：加一行')
  expect(h).toMatch(/^[0-9a-f]{40}$/)
  expect(await status(dir)).toEqual([{ code: ' M', path: 'b.md' }])
  expect((await log(dir, 1))[0]!.files.map((f) => f.path).sort()).toEqual(['a.md', 'new.md'])
  expect(await commitPaths(dir, ['a.md'], '没改')).toBeNull()

  const r = await revert(dir, h!)
  expect(r).not.toBe(h)
  expect(readFileSync(join(dir, 'a.md'), 'utf8')).toBe('a\n')
  expect(existsSync(join(dir, 'new.md'))).toBe(false)
  expect(readFileSync(join(dir, 'b.md'), 'utf8')).toBe('b 用户正在改\n')
  // 撤回的说明是中文「撤回」+ 原来那次的说明（以前是 git 自己的英文「Revert "…"」）
  expect((await log(dir, 1))[0]!.subject).toBe('撤回AI：加一行')
})

it('提交时别的 git 进程正占着 index.lock（终端、编辑器里的 git status 会短暂占着）：等它放开再提交，不丢下一个暂存了没提交的删除', async () => {
  mkdirSync(join(dir, '写作/冰岛'), { recursive: true })
  writeFileSync(join(dir, '写作/冰岛/.gitkeep'), '')
  writeFileSync(join(dir, 'a.md'), 'a\n')
  await commitAll(dir, '起点')
  rmSync(join(dir, '写作/冰岛'), { recursive: true })
  writeFileSync(join(dir, 'a.md'), 'a 改了\n')
  // 删文件夹那次（commitPaths）和全部提交（commitAll）各撞一次锁，锁 300ms 后放开
  for (const commit of [() => commitPaths(dir, ['写作/冰岛/.gitkeep'], '移到废纸篓：写作/冰岛'), () => commitAll(dir, '更新 1 个文件：a')]) {
    writeFileSync(join(dir, '.git/index.lock'), '')
    const t = setTimeout(() => rmSync(join(dir, '.git/index.lock')), 300)
    try {
      expect(await commit()).toMatch(/^[0-9a-f]{40}$/)
    } finally {
      clearTimeout(t)
    }
  }
  expect(await status(dir)).toEqual([])
  expect((await log(dir, 2)).map((c) => c.subject)).toEqual(['更新 1 个文件：a', '移到废纸篓：写作/冰岛'])
})

it('删除已经暂存了（上次 add 成功、commit 撞锁）：再提交这个路径照样提交上，不报「pathspec did not match」', async () => {
  mkdirSync(join(dir, '写作/冰岛'), { recursive: true })
  writeFileSync(join(dir, '写作/冰岛/.gitkeep'), '')
  writeFileSync(join(dir, '新.md'), '新\n')
  await commitAll(dir, '起点')
  rmSync(join(dir, '写作/冰岛'), { recursive: true })
  await git(dir, ['add', '-A', '--', '写作/冰岛/.gitkeep'])
  expect(await status(dir)).toEqual([{ code: 'D ', path: '写作/冰岛/.gitkeep' }])
  writeFileSync(join(dir, '另一篇.md'), '另\n')
  expect(await commitPaths(dir, ['写作/冰岛/.gitkeep', '另一篇.md'], '移到废纸篓：写作/冰岛')).toMatch(/^[0-9a-f]{40}$/)
  expect(await status(dir)).toEqual([])
  expect((await log(dir, 1))[0]!.files.map((f) => f.path).sort()).toEqual(['写作/冰岛/.gitkeep', '另一篇.md'])
})

it('锁一直不放（上次 git 崩了留下的）：试几次后照样报错，不一直等', async () => {
  writeFileSync(join(dir, 'a.md'), 'a\n')
  writeFileSync(join(dir, '.git/index.lock'), '')
  const t0 = Date.now()
  await expect(commitPaths(dir, ['a.md'], '加 a')).rejects.toThrow('index.lock')
  expect(Date.now() - t0).toBeLessThan(5_000)
})

it('撤回可以给自己的提交说明；同一行两边改的不是同一处时，resolve 按字合并后照样撤回，合不了就退回原样', async () => {
  writeFileSync(join(dir, 'a.md'), '一行：旧链接\n')
  await commitAll(dir, '起点')
  writeFileSync(join(dir, 'a.md'), '一行：新链接\n')
  const h = (await commitPaths(dir, ['a.md'], '梦游：改链接'))!
  // 改链接以后在同一行后面接着打了字
  writeFileSync(join(dir, 'a.md'), '一行：新链接 后来打的字\n')
  await commitAll(dir, '更新 1 个文件：a')
  // 不给 resolve：按行合不了，照旧报错、什么都不动
  await expect(revert(dir, h)).rejects.toThrow('撤回不了')
  expect(readFileSync(join(dir, 'a.md'), 'utf8')).toBe('一行：新链接 后来打的字\n')
  // 给 resolve（按字合并）：撤得回，说明是给的那句
  const fine = (base: string, ours: string, theirs: string) => (base === '一行：新链接\n' && ours === '一行：新链接 后来打的字\n' && theirs === '一行：旧链接\n' ? '一行：旧链接 后来打的字\n' : null)
  await revert(dir, h, { message: '撤回梦游：改链接', resolve: fine })
  expect(readFileSync(join(dir, 'a.md'), 'utf8')).toBe('一行：旧链接 后来打的字\n')
  expect((await log(dir, 1))[0]!.subject).toBe('撤回梦游：改链接')
  expect(await status(dir)).toEqual([])
  // resolve 也合不了：退回原样，报给的那句
  writeFileSync(join(dir, 'a.md'), '一行：又改 后来打的字\n')
  await commitAll(dir, '再改')
  await expect(revert(dir, h, { resolve: () => null, conflict: (files) => `合不了：${files.join('、')}` })).rejects.toThrow('合不了：a.md')
  expect(readFileSync(join(dir, 'a.md'), 'utf8')).toBe('一行：又改 后来打的字\n')
  expect(await status(dir)).toEqual([])
})

it('远程地址：没有时是 null，设了是 origin，再设改的是同一个', async () => {
  expect(await remote(dir)).toBeNull()
  await setRemote(dir, 'ssh://example.com/me/notes.git')
  expect(await remote(dir)).toEqual({ name: 'origin', url: 'ssh://example.com/me/notes.git' })
  await setRemote(dir, ' https://example.com/me/notes.git ')
  expect(await remote(dir)).toEqual({ name: 'origin', url: 'https://example.com/me/notes.git' })
  await expect(setRemote(dir, '--upload-pack=x')).rejects.toThrow('远程地址不对')
  await expect(setRemote(dir, 'a b')).rejects.toThrow('远程地址不对')
})

describe('gitPath', () => {
  it('从访达打开时 PATH 很短：补上 Homebrew 的目录（git-lfs 这类钩子要用），继承来的排前面、不重复', () => {
    expect(gitPath('/usr/bin:/bin:/usr/sbin:/sbin')).toBe('/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin')
    expect(gitPath('/my/bin:/opt/homebrew/bin')).toBe('/my/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin')
  })
})

describe('parseStatus', () => {
  it('认改动、新文件、改名（改名后面那段是旧路径，记在 from）', () => {
    expect(parseStatus(' M a.md\0?? 新 文件.md\0R  b.md\0old.md\0')).toEqual([
      { path: 'a.md', code: ' M' },
      { path: '新 文件.md', code: '??' },
      { path: 'b.md', code: 'R ', from: 'old.md' },
    ])
    expect(parseStatus('')).toEqual([])
  })
})
