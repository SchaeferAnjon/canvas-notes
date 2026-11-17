import { mkdtempSync, rmSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { Vault } from '../src/main/vault'
import { makeBigVault } from '../e2e/fixtures/big-vault'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cn-cache-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true, maxRetries: 5 }))

it('list() 的缓存：没变的不再读；改了、新加、删掉、改名都跟得上，搜索也跟着', async () => {
  writeFileSync(join(root, '甲.md'), '# 甲\n\n苹果\n')
  writeFileSync(join(root, '乙.md'), '---\ntype: board\ncolor: #4A7FA7\n---\n<!-- card id=a x=0 y=0 w=280 -->\n香蕉\n')
  const v = new Vault(root)
  const first = await v.list()
  expect(first.map((n) => n.path).sort()).toEqual(['乙.md', '甲.md'])
  expect(first.find((n) => n.path === '乙.md')!.board!.cards).toBe(1)
  // 没变：拿到的是同一个对象（没重新读）
  const again = await v.list()
  expect(again.find((n) => n.path === '甲.md')).toBe(first.find((n) => n.path === '甲.md'))

  // 外面改了（大小变了）：重新读
  writeFileSync(join(root, '乙.md'), '---\ntype: board\ncolor: #4A7FA7\n---\n<!-- card id=a x=0 y=0 w=280 -->\n香蕉\n\n<!-- card id=b x=300 y=0 w=280 -->\n橘子\n')
  expect((await v.list()).find((n) => n.path === '乙.md')!.board!.cards).toBe(2)
  expect((await v.search('橘子')).map((h) => h.path)).toEqual(['乙.md'])

  // 大小一样、只是修改时间变了：也重新读
  writeFileSync(join(root, '甲.md'), '# 甲\n\n梨子\n')
  const t = statSync(join(root, '甲.md')).mtimeMs / 1000 + 5
  utimesSync(join(root, '甲.md'), t, t)
  await v.list()
  expect((await v.search('梨子')).map((h) => h.path)).toEqual(['甲.md'])
  expect(await v.search('苹果')).toEqual([])

  // 新加、删掉
  writeFileSync(join(root, '丙.md'), '葡萄\n')
  unlinkSync(join(root, '乙.md'))
  expect((await v.list()).map((n) => n.path).sort()).toEqual(['丙.md', '甲.md'])
  expect(await v.search('橘子')).toEqual([])

  // 改名：不用再列一次，搜索就是新名字
  await v.rename('丙.md', '丁')
  expect((await v.search('葡萄')).map((h) => h.path)).toEqual(['丁.md'])
  expect((await v.list()).map((n) => n.path).sort()).toEqual(['丁.md', '甲.md'])
})

it('没列过就搜：先列一遍再搜，读到的全文留着', async () => {
  writeFileSync(join(root, '甲.md'), '冰岛极光\n')
  const v = new Vault(root)
  expect((await v.search('极光')).map((h) => h.path)).toEqual(['甲.md'])
})

it('第 3 轮：打像网址的笔记名（readme.md、Node.js）也找得到那篇；只打「md」不算篇篇都中', async () => {
  writeFileSync(join(root, 'readme.md'), '# readme\n\n说明。\n')
  writeFileSync(join(root, 'Node.js.md'), '# Node.js\n\n事件循环。\n')
  writeFileSync(join(root, '随手记.md'), '# 随手记\n\n正文。\n')
  const v = new Vault(root)
  await v.list()
  expect((await v.search('readme.md')).map((h) => h.path)).toEqual(['readme.md'])
  expect((await v.search('Node.js')).map((h) => h.path)).toEqual(['Node.js.md'])
  expect(await v.search('md')).toEqual([])
})

it('7000 篇的库：第一次列、再列、第一次搜都在几百毫秒内（测得的数字打出来）', async () => {
  const stats = makeBigVault(root)
  const v = new Vault(root)
  let t = performance.now()
  const list = await v.list()
  const cold = performance.now() - t
  expect(list).toHaveLength(stats.total)
  t = performance.now()
  await v.list()
  const warm = performance.now() - t
  t = performance.now()
  const hits = await v.search('极光 预报')
  const search = performance.now() - t
  expect(hits.length).toBeGreaterThan(0)
  console.log(`7000 篇：第一次列 ${Math.round(cold)}ms，再列 ${Math.round(warm)}ms，第一次搜 ${Math.round(search)}ms`)
  // 很宽的上限，只防退回到「每次全读一遍」（那时再列一次约 350ms、第一次搜约 600ms）
  expect(warm).toBeLessThan(300)
  expect(search).toBeLessThan(300)
}, 120_000)
