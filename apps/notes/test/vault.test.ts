import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { localStamp, safeName, Vault } from '../src/main/vault'
import { kindOf, previewOf } from '../src/shared/layout'

let root: string
let v: Vault
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cn-vault-'))
  v = new Vault(root)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

it('路径不许跑出库外', () => {
  expect(() => v.abs('../外面.md')).toThrow('库外')
  expect(() => v.abs('/etc/passwd')).toThrow('库外')
  expect(v.abs('收件箱/a.md')).toBe(join(root, '收件箱/a.md'))
})

it('新建：名字重了加序号，文件名里的怪字符换掉', async () => {
  expect(await v.create('', '未命名', '')).toBe('未命名.md')
  expect(await v.create('', '未命名', '')).toBe('未命名 2.md')
  expect(await v.create('', 'a/b:c?', 'x')).toBe('a b c.md')
  expect(safeName('  ..  ')).toBe('未命名')
})

it('改名：同一个文件夹里，重名报错', async () => {
  await v.create('', '甲', '内容\n')
  await v.create('', '乙', '')
  expect(await v.rename('甲.md', '丙')).toBe('丙.md')
  expect(readFileSync(join(root, '丙.md'), 'utf8')).toBe('内容\n')
  await expect(v.rename('丙.md', '乙')).rejects.toThrow('已经有一篇叫「乙」了')
})

it('速记进收件箱，带创建时间；列表里分出收件箱、素材、我写的', async () => {
  const p = await v.capture('周末去看一下 Raycast\n第二行', new Date(2026, 10, 15, 14, 3))
  expect(p).toBe('收件箱/周末去看一下 Raycast.md')
  expect(readFileSync(join(root, p), 'utf8')).toBe('---\ncreated: 2026-11-15 14:03\n---\n周末去看一下 Raycast\n第二行\n')
  await v.create('素材/AI 与工具', '剪的', '---\nsource: https://nav.al/rich\n---\n> 原文\n')
  writeFileSync(join(root, '所思所想.md'), '# 所思所想\n')
  const list = await v.list()
  const byPath = Object.fromEntries(list.map((n) => [n.path, n]))
  expect(byPath['收件箱/周末去看一下 Raycast.md']).toMatchObject({ kind: 'inbox', preview: '周末去看一下 Raycast 第二行' })
  expect(byPath['收件箱/周末去看一下 Raycast.md']!.createdMs).toBe(new Date(2026, 10, 15, 14, 3).getTime())
  expect(byPath['素材/AI 与工具/剪的.md']).toMatchObject({ kind: 'clip', topic: 'AI 与工具', source: 'https://nav.al/rich' })
  expect(byPath['所思所想.md']).toMatchObject({ kind: 'work' })
  await expect(v.capture('   ')).rejects.toThrow('空的')
})

it('分区和预览', () => {
  expect(kindOf('收件箱/a.md')).toEqual({ kind: 'inbox' })
  expect(kindOf('素材/a.md')).toEqual({ kind: 'clip', topic: '未分主题' })
  expect(kindOf('收件箱.md')).toEqual({ kind: 'work' })
  expect(previewOf('---\na: 1\n---\n# 标题\n<!-- card id=a -->\n> 引文 [[笔记|别名]] [链接](http://x)\n**粗**')).toBe('标题 引文 笔记 链接 粗')
  expect(localStamp(new Date(2026, 0, 2, 3, 4))).toBe('2026-01-02 03:04')
})
