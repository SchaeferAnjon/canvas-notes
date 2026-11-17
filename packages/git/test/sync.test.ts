import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { commitAll, commitPending, countCommitsSince, describeChanges, git, log, status, sync } from '../src'

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

it('commitPending：先暂存再写说明，在外面改了名写「挪了」（不是新增一个、删除一个）；没东西可提交给 null', async () => {
  renameSync(join(a, '旅行.md'), join(a, '旅行攻略.md'))
  expect(await commitPending(a)).toMatch(/^[0-9a-f]{40}$/)
  expect((await log(a))[0]!.subject).toBe('挪了 1 个文件：旅行 → 旅行攻略')
  expect(await status(a)).toEqual([])
  expect(await commitPending(a)).toBeNull()
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
  ).toBe('更新 3 个文件：a、c、d；新增 1 个：b')
  expect(describeChanges([{ path: 'a.md', code: ' M' }, { path: 'b.md', code: ' M' }, { path: 'c.md', code: ' M' }, { path: 'd.md', code: 'M ' }])).toBe('更新 4 个文件：a、b、c 等')
  expect(describeChanges([{ path: '写作/冰岛旅游 3.md', code: ' D' }, { path: '附件/写作/冰岛旅游 3/截图 1.png', code: 'D ' }])).toBe('删除 2 个文件：写作/冰岛旅游 3、附件/写作/冰岛旅游 3/截图 1.png')
  // 又改又删：删掉的不列进「更新」，分开写
  expect(
    describeChanges([
      { path: '写作/投稿清单.md', code: ' M' },
      { path: '写作/游记/东京-大阪 对比 2.md', code: ' D' },
      { path: '写作/折叠测试.md', code: ' M' },
      { path: '素材/冰岛物价参考.md', code: 'D ' },
    ]),
  ).toBe('更新 2 个文件：写作/投稿清单、写作/折叠测试；删除 2 个：写作/游记/东京-大阪 对比 2、素材/冰岛物价参考')
  // 新加的写「新增」，不写成「更新」
  expect(describeChanges([{ path: 'rt/rt-nbsp.md', code: ' D' }, { path: 'rt/新的.md', code: '??' }])).toBe('新增 1 个文件：rt/新的；删除 1 个：rt/rt-nbsp')
  // 只挪了一篇（这边删、那边同名新加）：写「挪了」，不写成一删一更新
  expect(describeChanges([{ path: '删测/丁.md', code: ' D' }, { path: '写作/丁.md', code: '??' }])).toBe('挪了 1 个文件：删测/丁 → 写作/丁')
  expect(describeChanges([{ path: '写作/丙.md', code: 'R ', from: '删测/丙.md' }])).toBe('挪了 1 个文件：删测/丙 → 写作/丙')
  expect(
    describeChanges([
      { path: '删测/甲.md', code: ' M' },
      { path: '删测/丙.md', code: ' D' },
      { path: '写作/丙.md', code: '??' },
      { path: '删测/新来的.md', code: '??' },
      { path: '删测/戊.md', code: ' D' },
    ]),
  ).toBe('更新 1 个文件：删测/甲；新增 1 个：删测/新来的；挪了 1 个：删测/丙 → 写作/丙；删除 1 个：删测/戊')
  expect(await countCommitsSince(a, new Date(Date.now() - 3600_000))).toBe(1)
  expect(await countCommitsSince(a, new Date(Date.now() + 3600_000))).toBe(0)
})
