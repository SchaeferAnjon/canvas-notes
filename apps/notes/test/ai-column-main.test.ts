/**
 * 数据库 AI 列撤回一批（task-i921u，main/base-write.ts 的 applyBaseWrites）：空字是「没有这个文件」——
 * 撤回时 AI 新建的那几篇删掉、那几讲开头两行拿掉，一次提交；再撤回（撤回撤回）把那几篇建回来。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { aiCellWrites, type AiColDef, baseContext, parseBaseDoc, setPropDef, undoWrites } from '@cn/format'
import { afterEach, expect, it } from 'vitest'
import { ECP_BASE, LECTURES, records } from '../../../packages/format/test/base-samples'
import { applyBaseWrites } from '../src/main/base-write'
import { Vault } from '../src/main/vault'

const roots: string[] = []
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
})
const g = (root: string, ...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' })
const DEF: AiColDef = { type: 'ai', prompt: '每一讲的练习题', output: 'note', folder: '课程/ecp/练习题', twoWay: '所属讲', reads: 'note', newRows: 'auto', ai: null }

it('撤回一批：AI 建的那篇删掉、那一讲回到原样，一次提交；再撤回把那篇建回来', async () => {
  const base = mkdtempSync(join(tmpdir(), 'cn-aicol-'))
  roots.push(base)
  const root = join(base, '库')
  execFileSync('git', ['init', '-q', '-b', 'main', root])
  g(root, 'config', 'user.name', 'T')
  g(root, 'config', 'user.email', 't@example.com')
  for (const [p, t] of Object.entries(LECTURES)) {
    mkdirSync(dirname(join(root, p)), { recursive: true })
    writeFileSync(join(root, p), t)
  }
  g(root, 'add', '-A')
  g(root, 'commit', '-q', '-m', '样本')
  const v = new Vault(root)
  const ctx = baseContext(parseBaseDoc(setPropDef(ECP_BASE, '练习题', DEF)), records(LECTURES))
  const P3 = '课程/ecp/课程计划/第3讲 生产.md'
  const N3 = '课程/ecp/练习题/第3讲 生产 练习题.md'
  const ws = aiCellWrites(ctx, { path: P3, col: '练习题', value: '1. 一题', by: 'Claude Code · Opus 5.5', read: '读了《第3讲 生产》', noteText: null })
  expect(await applyBaseWrites(v, ws, 'AI 列「练习题」', () => {})).toMatchObject({ ok: true })
  expect(readFileSync(join(root, N3), 'utf8')).toContain('> [!ai] 练习题')
  const back = await applyBaseWrites(v, undoWrites(ws), '撤回：AI 列「练习题」', () => {})
  expect(back).toMatchObject({ ok: true })
  expect(existsSync(join(root, N3))).toBe(false)
  expect(readFileSync(join(root, P3), 'utf8')).toBe(LECTURES[P3])
  expect(g(root, 'status', '--porcelain')).toBe('')
  expect(g(root, 'log', '--format=%s')).toBe('撤回：AI 列「练习题」\nAI 列「练习题」\n样本\n')
  expect(await applyBaseWrites(v, ws, '撤回：撤回：AI 列「练习题」', () => {})).toMatchObject({ ok: true })
  expect(existsSync(join(root, N3))).toBe(true)
})
