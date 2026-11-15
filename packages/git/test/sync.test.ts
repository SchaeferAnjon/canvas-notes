import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { commitAll, countCommitsSince, describeChanges, git, log, status, sync } from '../src'

let root: string
let a: string
let b: string
let bare: string

async function clone(to: string) {
  await git(root, ['clone', '-q', bare, to])
  await git(to, ['config', 'user.name', 'Test'])
  await git(to, ['config', 'user.email', 'test@example.com'])
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'cn-sync-'))
  bare = join(root, 'remote.git')
  await git(root, ['init', '-q', '--bare', '-b', 'main', bare])
  a = join(root, 'a')
  b = join(root, 'b')
  await clone(a)
  writeFileSync(join(a, '旅行.md'), '第一段\n\n第二段\n')
  await commitAll(a, '第一次')
  await git(a, ['push', '-q', '-u', 'origin', 'main'])
  await clone(b)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

it('没有远程时说清楚', async () => {
  const solo = join(root, 'solo')
  await git(root, ['init', '-q', '-b', 'main', solo])
  expect(await sync(solo)).toEqual({ kind: 'no-remote' })
})

it('同步：提交本地改动、拉下别处的、推上去', async () => {
  writeFileSync(join(b, '旅行.md'), '第一段（另一台电脑改的）\n\n第二段\n')
  await commitAll(b, 'b 改的')
  await git(b, ['push', '-q'])

  writeFileSync(join(a, '旅行.md'), '第一段\n\n第二段，本机改的\n')
  const r = await sync(a)
  expect(r).toMatchObject({ kind: 'ok', pulled: 1, pushed: true })
  expect(readFileSync(join(a, '旅行.md'), 'utf8')).toBe('第一段（另一台电脑改的）\n\n第二段，本机改的\n')
  expect(await status(a)).toEqual([])

  await git(b, ['pull', '-q'])
  expect(readFileSync(join(b, '旅行.md'), 'utf8')).toBe('第一段（另一台电脑改的）\n\n第二段，本机改的\n')
})

it('两边改了同一行：退回同步前，本地的字不丢', async () => {
  writeFileSync(join(b, '旅行.md'), '第一段 b\n\n第二段\n')
  await commitAll(b, 'b')
  await git(b, ['push', '-q'])
  writeFileSync(join(a, '旅行.md'), '第一段 a\n\n第二段\n')
  const r = await sync(a)
  expect(r.kind).toBe('conflict')
  expect(readFileSync(join(a, '旅行.md'), 'utf8')).toBe('第一段 a\n\n第二段\n')
  expect((await log(a))[0]!.subject).toMatch(/^更新 1 个文件：旅行/)
})

it('提交说明和本周提交数', async () => {
  expect(describeChanges([{ path: '收件箱/a.md', code: '??' }])).toBe('新增 1 个文件：收件箱/a')
  expect(
    describeChanges([
      { path: 'a.md', code: ' M' },
      { path: 'b.md', code: '??' },
      { path: 'c.md', code: ' M' },
      { path: 'd.md', code: ' M' },
    ]),
  ).toBe('更新 4 个文件：a、b、c 等')
  expect(await countCommitsSince(a, new Date(Date.now() - 3600_000))).toBe(1)
  expect(await countCommitsSince(a, new Date(Date.now() + 3600_000))).toBe(0)
})
