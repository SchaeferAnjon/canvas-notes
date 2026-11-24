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

it('第一次列同时来好几个（开库时左栏、待办、目录树一起要）：合成一趟，每篇只读一次；各拿各的数组', async () => {
  for (let i = 0; i < 30; i++) writeFileSync(join(root, `n${i}.md`), `# n${i}\n\n第 ${i} 篇。\n`)
  const v = new Vault(root)
  const [a, b, texts, c] = await Promise.all([v.list(), v.list(), v.texts(), v.list()])
  expect(a).toHaveLength(30)
  expect(texts.size).toBe(30)
  // 各读各的话每趟都新建一份说明；合成一趟就是同一份
  for (const other of [b, c]) {
    expect(other).not.toBe(a)
    expect(other.every((f, i) => f === a[i])).toBe(true)
  }
  // 以后再列（只 stat）照常各列各的，没变的还是那一份
  writeFileSync(join(root, 'n0.md'), '# n0\n\n改了。\n')
  const t = statSync(join(root, 'n0.md')).mtimeMs / 1000 + 5
  utimesSync(join(root, 'n0.md'), t, t)
  const after = await v.list()
  expect(after.find((f) => f.path === 'n0.md')).not.toBe(a.find((f) => f.path === 'n0.md'))
  expect(after.find((f) => f.path === 'n1.md')).toBe(a.find((f) => f.path === 'n1.md'))
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

/**
 * 7000 篇的库：再列一次、第一次搜不能退回到「每次全读一遍」。
 * 量的是 CPU 时间（process.cpuUsage，这个测试文件自己一个进程），不是墙上的钟：机器忙（负载 100 以上，几条测试线一起跑）时
 * 墙上的钟量的多半是排队等 CPU 和线程池，同一份代码 150 到 1300 毫秒都有，挂了也说明不了代码慢了。
 * CPU 时间在负载 100 到 270 下都稳（再列 120 到 180 毫秒，见交付页 97-大库提速）；全读一遍 7000 篇光 CPU 就要 800 到 1000 毫秒，300 拦得住。
 * 再加一道不看时间的：没变的篇拿到的是上次那个对象（没重新读）。墙上的钟只打出来看。
 */
it('7000 篇的库：再列、第一次搜不全读一遍（CPU 时间各 300 毫秒以内，测得的数字打出来）', async () => {
  const stats = makeBigVault(root)
  const v = new Vault(root)
  const cpu = () => {
    const u = process.cpuUsage()
    return (u.user + u.system) / 1000
  }
  let t = performance.now()
  let c = cpu()
  const list = await v.list()
  const cold = [performance.now() - t, cpu() - c]
  expect(list).toHaveLength(stats.total)
  t = performance.now()
  c = cpu()
  const again = await v.list()
  const warm = [performance.now() - t, cpu() - c]
  t = performance.now()
  c = cpu()
  const hits = await v.search('极光 预报')
  const search = [performance.now() - t, cpu() - c]
  expect(hits.length).toBeGreaterThan(0)
  const ms = (x: number[]) => `${Math.round(x[0]!)}ms（CPU ${Math.round(x[1]!)}ms）`
  console.log(`7000 篇：第一次列 ${ms(cold)}，再列 ${ms(warm)}，第一次搜 ${ms(search)}`)
  const byPath = new Map(list.map((f) => [f.path, f]))
  expect(again.every((f) => byPath.get(f.path) === f)).toBe(true)
  expect(warm[1]).toBeLessThan(300)
  expect(search[1]).toBeLessThan(300)
}, 120_000)

// 真库副本（不进仓库）上量一遍：CN_REAL_VAULT=<库> 时跑，只打数字
it.runIf(!!process.env.CN_REAL_VAULT)('真库：第一次列、再列、第一次搜要多久', async () => {
  const v = new Vault(process.env.CN_REAL_VAULT!)
  for (const what of ['第一次列', '再列', '再列']) {
    const t = performance.now()
    const c = process.cpuUsage()
    const l = await v.list()
    const u = process.cpuUsage(c)
    console.log(`${what} ${l.length} 篇：${Math.round(performance.now() - t)}ms（CPU ${Math.round((u.user + u.system) / 1000)}ms）`)
  }
  const t = performance.now()
  const hits = await v.search('多线程')
  console.log(`第一次搜 ${hits.length} 条：${Math.round(performance.now() - t)}ms`)
}, 120_000)
