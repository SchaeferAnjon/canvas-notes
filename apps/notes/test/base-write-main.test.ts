/**
 * 数据库一次改好几篇（task-i921u 第三批，main/base-write.ts）：关联两边写两篇一次提交、撤回一次；
 * 有一篇刚被别处改过就一篇都不写；这几篇里用户没提交的字先单独提交，这一次的提交里只有这次的改动。
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { baseContext, parseBaseDoc, toggleRelation, undoWrites } from '@cn/format'
import { afterEach, describe, expect, it } from 'vitest'
import { ECP_BASE, EXERCISES, LECTURES, records } from '../../../packages/format/test/base-samples'
import { applyBaseWrites } from '../src/main/base-write'
import { Vault } from '../src/main/vault'

const roots: string[] = []
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
})
const g = (root: string, ...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' })
function vaultWith(files: Record<string, string>) {
  const base = mkdtempSync(join(tmpdir(), 'cn-basew-'))
  roots.push(base)
  const root = join(base, '库')
  execFileSync('git', ['init', '-q', '-b', 'main', root])
  g(root, 'config', 'user.name', 'T')
  g(root, 'config', 'user.email', 't@example.com')
  for (const [p, t] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true })
    writeFileSync(join(root, p), t)
  }
  g(root, 'add', '-A')
  g(root, 'commit', '-q', '-m', '样本')
  return { root, v: new Vault(root) }
}
const read = (root: string, p: string) => readFileSync(join(root, p), 'utf8')
const LEC3 = '课程/ecp/课程计划/第3讲 生产.md'
const EX41 = '课程/ecp/练习/练习 4.1.md'
const ctx = () => baseContext(parseBaseDoc(ECP_BASE), records(LECTURES), { related: { '课程/ecp/练习': records(EXERCISES) } })

describe('base:write（关联两边写）', () => {
  it('勾一下：两篇照 toggleRelation 算的写、一次提交只有这两篇；撤回一次回到原样', async () => {
    const { root, v } = vaultWith({ ...LECTURES, ...EXERCISES })
    const ws = toggleRelation(ctx(), LEC3, '练习', '练习 4.1', true)
    expect(ws.map((w) => w.path).sort()).toEqual([EX41, LEC3])
    const told: string[] = []
    const r = await applyBaseWrites(v, ws, '数据库：「第3讲 生产」连上「练习 4.1」', (p) => told.push(p))
    expect(r).toMatchObject({ ok: true })
    for (const w of ws) expect(read(root, w.path)).toBe(w.after)
    expect(told.sort()).toEqual([EX41, LEC3])
    expect(g(root, 'log', '--format=%s')).toBe('数据库：「第3讲 生产」连上「练习 4.1」\n样本\n')
    expect(g(root, 'show', '--name-only', '--format=', 'HEAD').trim().split('\n').sort()).toEqual([EX41, LEC3])
    expect(g(root, 'status', '--porcelain')).toBe('')

    const back = await applyBaseWrites(v, undoWrites(ws), '撤回：数据库：「第3讲 生产」连上「练习 4.1」', () => undefined)
    expect(back).toMatchObject({ ok: true })
    expect(read(root, LEC3)).toBe(LECTURES[LEC3])
    expect(read(root, EX41)).toBe(EXERCISES[EX41])
    expect(g(root, 'rev-list', '--count', 'HEAD').trim()).toBe('3')
    expect(g(root, 'status', '--porcelain')).toBe('')
  })

  it('有一篇刚被别处改过：一篇都不写，交回是哪一篇', async () => {
    const { root, v } = vaultWith({ ...LECTURES, ...EXERCISES })
    const ws = toggleRelation(ctx(), LEC3, '练习', '练习 4.1', true)
    const changed = EXERCISES[EX41]!.replace('做完: false', '做完: true')
    writeFileSync(join(root, EX41), changed)
    const r = await applyBaseWrites(v, ws, '数据库：x', () => undefined)
    expect(r).toEqual({ ok: false, path: EX41 })
    expect(read(root, LEC3)).toBe(LECTURES[LEC3])
    expect(read(root, EX41)).toBe(changed)
    expect(g(root, 'rev-list', '--count', 'HEAD').trim()).toBe('1')
  })

  it('那几篇里用户没提交的字先单独提交：这一次的提交里只有关联那一行', async () => {
    const { root, v } = vaultWith({ ...LECTURES, ...EXERCISES })
    const typed = LECTURES[LEC3]!.replace('边际产量先升后降。', '边际产量先升后降。刚打的字。')
    writeFileSync(join(root, LEC3), typed)
    const c = baseContext(parseBaseDoc(ECP_BASE), records({ ...LECTURES, [LEC3]: typed }), { related: { '课程/ecp/练习': records(EXERCISES) } })
    const ws = toggleRelation(c, LEC3, '练习', '练习 4.1', true)
    const r = await applyBaseWrites(v, ws, '数据库：连上', () => undefined)
    expect(r).toMatchObject({ ok: true })
    expect(g(root, 'rev-list', '--count', 'HEAD').trim()).toBe('3')
    const diff = g(root, 'show', '--format=', 'HEAD', '--', LEC3)
    expect(diff).not.toContain('刚打的字')
    expect(diff).toContain('[[练习 4.1]]')
  })

  it('参数不对（同一篇两次、不是 md、没说明）直接报错', async () => {
    const { v } = vaultWith({ 'a.md': 'x' })
    await expect(applyBaseWrites(v, [], '说明', () => undefined)).rejects.toThrow()
    await expect(applyBaseWrites(v, [{ path: 'a.txt', before: '', after: '' }], '说明', () => undefined)).rejects.toThrow()
    await expect(applyBaseWrites(v, [{ path: 'a.md', before: 'x', after: 'y' }], ' ', () => undefined)).rejects.toThrow()
    await expect(
      applyBaseWrites(
        v,
        [
          { path: 'a.md', before: 'x', after: 'y' },
          { path: 'a.md', before: 'x', after: 'z' },
        ],
        '说明',
        () => undefined,
      ),
    ).rejects.toThrow()
  })
})
