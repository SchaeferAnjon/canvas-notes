// 画布订阅的 .canvas-feeds/（多设备同步的记录）是软件自己的文件（2026-11-25 按推荐小改，界面规范「软件自己的文件」）：
// 目录树不列、清理没用到的附件不数、提交说明和历史当软件自己的（@cn/format 的 isAppFile，@cn/git 的 isInternalPath 同一份）
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { isAppFile } from '@cn/format'
import { isInternalPath } from '@cn/git'

vi.mock('electron', () => ({ ipcMain: { handle: () => undefined }, shell: {} }))

const { listEntries } = await import('../src/main/files')
const { attachUsage } = await import('../src/main/attach-usage')

let root: string
const HOUR_AGO = (Date.now() - 3600_000) / 1000
const put = (f: string, data: string) => {
  mkdirSync(dirname(join(root, f)), { recursive: true })
  writeFileSync(join(root, f), data)
  utimesSync(join(root, f), HOUR_AGO, HOUR_AGO)
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cn-feeds-files-'))
  put('收件箱/冰岛.md', '# 冰岛\n')
  put('附件/收件箱/冰岛/没人用.png', 'png')
  // 画布订阅同步写的：每台设备一个 .jsonl，还有一份订阅源
  put('.canvas-feeds/MacBook-Pro-1a2b.jsonl', '{"op":"read"}\n')
  put('.canvas-feeds/订阅源.json', '[]\n')
  // 万一放进了附件文件夹里（老版本写错地方）：也不当附件
  put('附件/.canvas-feeds/图.png', 'png')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

it('.canvas-feeds/ 下面的都算软件自己的', () => {
  for (const p of ['.canvas-feeds', '.canvas-feeds/MacBook-Pro-1a2b.jsonl', '.canvas-feeds/订阅源.json', '附件/.canvas-feeds/图.png']) {
    expect(isAppFile(p), p).toBe(true)
    expect(isInternalPath(p), p).toBe(true)
  }
})

it('目录树不列 .canvas-feeds/', async () => {
  const paths = (await listEntries(root)).map((e) => e.path)
  expect(paths).toContain('收件箱/冰岛.md')
  expect(paths).toContain('附件/收件箱/冰岛/没人用.png')
  expect(paths.filter((p) => p.includes('.canvas-feeds'))).toEqual([])
})

it('清理没用到的附件不数 .canvas-feeds/ 里的', async () => {
  const use = await attachUsage(root)
  expect(Object.keys(use)).toEqual(['附件/收件箱/冰岛/没人用.png'])
})
