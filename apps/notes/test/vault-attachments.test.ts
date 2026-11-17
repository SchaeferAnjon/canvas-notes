import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { Vault } from '../src/main/vault'

let root: string
let v: Vault

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cn-attach-'))
  v = new Vault(root)
  mkdirSync(join(root, '附件', '未命名 3'), { recursive: true })
  writeFileSync(join(root, '附件', '未命名 3', '截图 1.png'), 'png')
  writeFileSync(join(root, '附件', 'image-1.png'), 'old')
  writeFileSync(join(root, '未命名 3.md'), '# 未命名 3\n\n![](附件/未命名%203/截图%201.png)\n\n![旧](附件/image-1.png)\n')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

it('改名（CN-40 A）：附件文件夹跟着改名，笔记里的链接跟着改，老的 附件/ 下的图不动', async () => {
  expect(await v.rename('未命名 3.md', '冰岛')).toBe('冰岛.md')
  expect(existsSync(join(root, '附件', '冰岛', '截图 1.png'))).toBe(true)
  expect(existsSync(join(root, '附件', '未命名 3'))).toBe(false)
  expect(existsSync(join(root, '附件', 'image-1.png'))).toBe(true)
  expect(readFileSync(join(root, '冰岛.md'), 'utf8')).toBe('# 未命名 3\n\n![](附件/冰岛/截图%201.png)\n\n![旧](附件/image-1.png)\n')
})

it('移到文件夹：附件文件夹跟着到 附件/<文件夹>/<名字>/，链接按新位置重算', async () => {
  expect(await v.move('未命名 3.md', '课程/ecp')).toBe('课程/ecp/未命名 3.md')
  expect(existsSync(join(root, '附件', '课程', 'ecp', '未命名 3', '截图 1.png'))).toBe(true)
  expect(readFileSync(join(root, '课程', 'ecp', '未命名 3.md'), 'utf8')).toBe('# 未命名 3\n\n![](../../附件/课程/ecp/未命名%203/截图%201.png)\n\n![旧](../../附件/image-1.png)\n')
})

it('没有附件文件夹的笔记改名：文件一个字都不变', async () => {
  writeFileSync(join(root, '甲.md'), '# 甲\n\n正文\n')
  await v.rename('甲.md', '乙')
  expect(readFileSync(join(root, '乙.md'), 'utf8')).toBe('# 甲\n\n正文\n')
})
