// 第 3 轮：首页开着时关掉空的新笔记，底部冒出英文「ENOENT: no such file or directory, stat '…/未命名.md'」。
// 原因：首页、文件夹首页列文件时先 readdir 再一篇篇 stat、读；中间那篇刚被移到废纸篓（关空笔记、删除、梦游挪走）就整个报错。
// 列的时候没了的那篇跳过就是。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ dialog: {}, ipcMain: {}, shell: {} }))
/** 这几个文件名在 readdir 之后、stat / 读之前「被挪走」 */
const gone = new Set<string>()
vi.mock('node:fs/promises', async (orig) => {
  const fs = await orig<typeof import('node:fs/promises')>()
  const vanish = (p: unknown) => {
    if ([...gone].some((g) => String(p).endsWith(g))) throw Object.assign(new Error(`ENOENT: no such file or directory, stat '${String(p)}'`), { code: 'ENOENT' })
  }
  return {
    ...fs,
    stat: async (p: Parameters<typeof fs.stat>[0], ...rest: unknown[]) => (vanish(p), fs.stat(p, ...(rest as []))),
    readFile: async (p: Parameters<typeof fs.readFile>[0], ...rest: unknown[]) => (vanish(p), fs.readFile(p, ...(rest as []))),
  }
})

const { propFiles } = await import('../src/main/folder-home')
const { Vault } = await import('../src/main/vault')

const root = mkdtempSync(join(tmpdir(), 'cn-fhome-race-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('列文件时有一篇刚被挪走', () => {
  it('跳过那一篇，别的照常列出来，不报 ENOENT', async () => {
    mkdirSync(join(root, '项目'), { recursive: true })
    writeFileSync(join(root, '项目/说明.md'), '# 说明\n')
    writeFileSync(join(root, '项目/未命名.md'), '# 未命名\n\n')
    gone.add('项目/未命名.md')
    const files = await propFiles(new Vault(root), null)
    expect(files.map((f) => f.path)).toEqual(['项目/说明.md'])
  })
})
