/**
 * 梦游补双链不再靠一个常见词乱连（task-eler2）：用户报的「中国用户怎么用上 Claude ↔ [[Geography of Iceland]]，两篇都讲到『the second』」。
 * 合成样本库（eval/dream-links/cases.ts）：真点「现在梦游」、打开报告，补上的双链只有讲同一件事的几对，理由写两篇共同的关键词；
 * 收下 Claude 那一条，文件末尾多一行；窗口不上屏，假 AI。
 */
import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gitStatus, launch } from './app'
import { P, VAULT } from '../eval/dream-links/cases'

test('标注该连的几对都补上，不连第三方、未命名；理由写 AI 说的共同点和两边原话，收下一条末尾多一行', async () => {
  const run = await launch(VAULT, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    // 间隔重复那一对靠向量那一路找得到：等搜索索引建好再梦游（以前没等，建得慢的那次就少这一对，看运气）
    await expect.poll(() => page.evaluate(() => (window as unknown as { cnSearch: { status(): Promise<{ phase: string }> } }).cnSearch.status().then((s) => s.phase)), { timeout: 30_000 }).toBe('ready')
    const card = page.getByTestId('dream-card')
    await card.getByRole('button', { name: '现在梦游' }).click()
    await expect(card.locator('h3')).toContainText('等你过目', { timeout: 60_000 })
    // task-h7oy8 起补双链要 AI 判：测试里是假 AI（按两篇共同的词判），连得准不准由真库评测（pnpm eval:dream-real）管；
    // 这里看的是软件自己的规矩：该连的都进得了候选、第三方和「未命名」不当候选、理由和两边原话写在条目上
    await expect(card.locator('.l')).toContainText(['补了双链'])
    await card.getByRole('button', { name: '看报告' }).click()
    const panel = page.getByRole('complementary', { name: '梦游报告' })
    await expect(panel.locator('.dg').filter({ hasText: '补上的双链' })).toBeVisible()

    // 「补上的双链」这一组：标注该连的 5 对都在，一条也不连到第三方、未命名
    const items = panel.getByTestId('dream-item').filter({ hasText: '↔ [[' })
    const texts = (await items.allInnerTexts()).join('\n')
    expect(texts).not.toMatch(/第三方|未命名/)
    // 中文这几对假 AI 判得出（Feynman 那对是英文专名对英文专名，假 AI 只按字比，判不出，交给真库评测）
    for (const want of ['Claude', '关税战时间线', '间隔重复', '极光预报']) expect(texts).toContain(want)

    // 点 Claude 那一条：理由是 AI 说出的共同点（task-h7oy8 起补双链要 AI 判），带两边原话，不是「两篇都讲到『the second』」
    // 两篇讲 Claude 的那一对（向量那一路还会连出别的带 Claude 的几条）
    const claude = items.filter({ hasText: 'Claude 账号被封以后' }).filter({ hasText: '中国用户怎么用上 Claude' }).first()
    await claude.click()
    const why = page.locator('[data-testid="dream-tab"]:not([hidden])').getByTestId('dream-why')
    // 写法照 Wiki 那节 A1：正文里提到那篇名字的字变成链接；没有才退回末尾「相关：」一行
    await expect(why).toContainText(/^两篇都讲「.+」那件事。(原句里「.+」变成链接，字不变|正文里没有单独讲它的字，在这篇末尾加一行「相关：」)/)
    await expect(page.locator('[data-testid="dream-tab"]:not([hidden])').getByTestId('dream-evidence')).toContainText('原话软件逐字核对过')
    await expect(why).not.toContainText('都讲到')
    await page.screenshot({ path: test.info().outputPath('eler2-claude-why.png') })

    // 收下：原句里那几个字变成 [[…]]，或末尾多一行「相关：[[…]]」；main 上干净
    const title = (await claude.innerText()).split('\n')[0]!.trim()
    const file = title === 'Claude 账号被封以后' ? P.claudeBan : P.claudeVideo
    const other = file === P.claudeBan ? '中国用户怎么用上 Claude' : 'Claude 账号被封以后'
    await panel.getByTestId('dream-detail').getByRole('button', { name: '收下' }).click()
    await expect(claude).toContainText('已收下')
    const after = readFileSync(join(vault, file), 'utf8')
    expect(after === VAULT[file] + `\n相关：[[${other}]]\n` || after.replace(new RegExp(`\\[\\[${other}\\|([^\\]]+)\\]\\]|\\[\\[${other}\\]\\]`), (_m, w) => w ?? other) === VAULT[file]).toBe(true)
    expect(gitStatus(vault)).toBe('')
  } finally {
    await run.close()
  }
})
