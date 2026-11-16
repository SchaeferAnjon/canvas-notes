import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  expect((await log(dir, 1))[0]!.subject).toBe('Revert "AI：加一行"')
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
  it('认改动、新文件、改名（改名后面那段旧路径跳过）', () => {
    expect(parseStatus(' M a.md\0?? 新 文件.md\0R  b.md\0old.md\0')).toEqual([
      { path: 'a.md', code: ' M' },
      { path: '新 文件.md', code: '??' },
      { path: 'b.md', code: 'R ' },
    ])
    expect(parseStatus('')).toEqual([])
  })
})
