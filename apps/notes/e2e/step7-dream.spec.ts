import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gitStatus, launch, pane, tabOn } from './app'
import { DREAM_VAULT, worksHash } from './fixtures/dream'

const git = (vault: string, ...args: string[]) => execFileSync('git', ['-C', vault, '-c', 'core.quotepath=false', ...args], { encoding: 'utf8' })
const lastSubject = (vault: string) => git(vault, 'log', '-1', '--format=%s').trim()
const commits = (vault: string) => Number(git(vault, 'rev-list', '--count', 'HEAD').trim())

test('找重复：window.cn.findDuplicates 给出讲同一件事的一对和相似度，不改任何文件', async () => {
  const run = await launch(DREAM_VAULT)
  const { page, vault } = run
  try {
    const pairs = await page.evaluate(() => window.cn.findDuplicates())
    expect(pairs).toHaveLength(1)
    expect(pairs[0]).toMatchObject({ a: '剪藏/巴黎/巴黎深度漫游指南.md', b: '收件箱/巴黎自由行全景指南.md' })
    expect(pairs[0]!.score).toBeGreaterThan(0.4)
    expect(pairs[0]!.why).toMatch(/^两篇约\d+%的字句相同，都有「.+」$/)
    expect(gitStatus(vault)).toBe('')
  } finally {
    await run.close()
  }
})

test('梦游一整次：现在梦游 → 报告分组 → 收下一条（main 上文件变了、一次提交）→ 丢掉一条 → 全部收下；作品一个字节不变', async () => {
  const run = await launch(DREAM_VAULT, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  const now = new Date()
  const branch = `dream/${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  try {
    const works = worksHash(vault)
    const card = page.getByTestId('dream-card')
    await expect(card).toContainText('第一晚还没到')
    await card.getByRole('button', { name: '现在梦游' }).click()
    await expect(card.locator('h3')).toHaveText('整理了6处，等你过目', { timeout: 30_000 })
    await expect(card.locator('.l')).toHaveText(['3处归类和改名', '1处补了双链', '1对可能重复', '1篇本周小结'])
    await expect(card.locator('.dk')).toContainText('梦游 · ')
    await expect(page.getByTestId('dream-dot')).toBeVisible()
    // 梦游只在分支上改：main 的工作目录没变，多了分支
    expect(gitStatus(vault)).toBe('')
    expect(git(vault, 'branch', '--list', '--format=%(refname:short)', 'dream/*').trim()).toBe(branch)
    expect(existsSync(join(vault, '周记'))).toBe(false)
    await page.screenshot({ path: test.info().outputPath('home-dream-card.png') })

    await card.getByRole('button', { name: '看报告' }).click()
    const panel = page.getByRole('complementary', { name: '梦游报告' })
    await expect(panel.getByTestId('dream-summary')).toContainText(`整理了6处。都在${branch}分支上，点「预览」看改好后的样子，收下才合进main。动了正文的只有：补了1处双链（在正文末尾加了一行）。`)
    // 不再一律说「你写的正文一个字没动」（补双链在正文末尾加了一行）
    await expect(panel.getByTestId('dream-summary')).not.toContainText('一个字没动')
    await expect(panel.locator('.dg')).toHaveText(['归类和改名3条预览', '补上的双链1条', '可能重复1条', '本周小结1条'])
    await expect(panel.getByTestId('dream-left')).toHaveText(`还剩6条 · 改动在${branch}分支`)
    await page.screenshot({ path: test.info().outputPath('dream-panel.png') })

    // 1. 收下「补上的双链」：看为什么、改了什么，收下后 main 上多一次提交，文件末尾多一行
    const before = commits(vault)
    const link = panel.getByTestId('dream-item').filter({ hasText: '↔ [[极光预报]]' })
    await link.click()
    const detail = panel.getByTestId('dream-detail')
    await expect(detail).toContainText('两篇都讲到「')
    // 侧栏只写一句人话，点了中间开对比标签（CN-63）
    await expect(detail.getByTestId('dream-change')).toHaveText('极光：末尾加了一行 相关：[[极光预报]]')
    await page.screenshot({ path: test.info().outputPath('dream-detail.png') })
    await detail.getByRole('button', { name: '收下' }).click()
    await expect(link).toContainText('已收下')
    expect(readFileSync(join(vault, '收件箱/极光.md'), 'utf8')).toBe(DREAM_VAULT['收件箱/极光.md'] + '\n相关：[[极光预报]]\n')
    expect(commits(vault)).toBe(before + 1)
    expect(lastSubject(vault)).toBe('梦游：「极光」补上 [[极光预报]]')
    expect(gitStatus(vault)).toBe('')

    // 2. 丢掉「冰洞」那条挪动：文件留在收件箱，不多提交
    const ice = panel.getByTestId('dream-item').filter({ hasText: '原名「冰洞」' })
    await ice.click()
    await expect(detail.locator('.pv-move')).toHaveText('挪到剪藏/旅行/')
    await detail.getByRole('button', { name: '丢掉' }).click()
    await expect(ice).toContainText('已丢掉')
    expect(commits(vault)).toBe(before + 1)
    expect(existsSync(join(vault, '收件箱/冰洞.md'))).toBe(true)
    await expect(panel.getByTestId('dream-left')).toHaveText(`还剩4条 · 改动在${branch}分支`)

    // 可能重复：只提醒，能打开两篇
    await panel.getByTestId('dream-item').filter({ hasText: '相似度' }).click()
    await expect(detail).toContainText('不删也不改任何一篇')
    await expect(detail.getByRole('button', { name: '丢掉' })).toHaveCount(0)
    await detail.getByRole('button', { name: '巴黎深度漫游指南' }).click()
    await expect(tabOn(page)).toHaveText('巴黎深度漫游指南')

    // 3. 全部收下：剩下的挪动、小结合成一次提交；删掉分支和临时检出
    await panel.getByRole('button', { name: '全部收下' }).click()
    await expect(page.locator('.toast-cn')).toContainText(`剩下的都收下了，${branch}已合进main`)
    await expect(panel.getByTestId('dream-left')).toHaveText('都看完了，收下的已合进main')
    await expect(panel.getByTestId('dream-item').filter({ hasText: '已收下' })).toHaveCount(4)
    await expect(panel.getByTestId('dream-item').filter({ hasText: '相似度' })).toContainText('看过了')
    expect(commits(vault)).toBe(before + 2)
    expect(lastSubject(vault)).toBe('收下梦游的整理：3 处')
    expect(readFileSync(join(vault, '剪藏/旅行/极光.md'), 'utf8')).toContain('相关：[[极光预报]]')
    expect(existsSync(join(vault, '剪藏/旅行/巴黎自由行全景指南.md'))).toBe(true)
    expect(existsSync(join(vault, '收件箱/冰洞.md'))).toBe(true)
    const week = readdirSync(join(vault, '周记'))
    expect(week).toHaveLength(1)
    expect(readFileSync(join(vault, '周记', week[0]!), 'utf8')).toContain('这周主要在准备冰岛自驾')
    expect(git(vault, 'branch', '--list', 'dream/*').trim()).toBe('')
    expect(git(vault, 'worktree', 'list').trim().split('\n')).toHaveLength(1)
    expect(readdirSync(join(run.userData, 'dream', 'checkouts'))).toEqual([])
    expect(gitStatus(vault)).toBe('')
    await expect(page.getByTestId('dream-dot')).toHaveCount(0)
    // 用户自己写的作品一个字节没变
    expect(worksHash(vault)).toEqual(works)
    await page.screenshot({ path: test.info().outputPath('dream-done.png') })
  } finally {
    await run.close()
  }
})

test('闲时梦游：Mac 没人动、距上次够久，就自己跑一次，左栏出现条数', async () => {
  const run = await launch(DREAM_VAULT, { CN_AI_FAKE: '1', CN_DREAM_IDLE_SEC: '0', CN_DREAM_GAP_MS: '0', CN_DREAM_CHECK_MS: '500' })
  const { page, vault } = run
  try {
    await expect(page.getByTestId('dream-dot')).toBeVisible({ timeout: 30_000 })
    const report = await page.evaluate(() => window.cn.dreamReport())
    expect(report?.trigger).toBe('idle')
    // 上一份还没看完，不会再跑第二次
    await page.waitForTimeout(1500)
    expect(git(vault, 'branch', '--list', 'dream/*').trim().split('\n')).toHaveLength(1)
  } finally {
    await run.close()
  }
})
