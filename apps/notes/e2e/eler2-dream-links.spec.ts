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

test('补上的双链只有真相关的几对，不再有 Iceland、第三方、未命名；理由写共同的关键词，收下一条末尾多一行', async () => {
  const run = await launch(VAULT, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    const card = page.getByTestId('dream-card')
    await card.getByRole('button', { name: '现在梦游' }).click()
    await expect(card.locator('h3')).toContainText('等你过目', { timeout: 60_000 })
    await expect(card.locator('.l')).toContainText(['5处补了双链'])
    await card.getByRole('button', { name: '看报告' }).click()
    const panel = page.getByRole('complementary', { name: '梦游报告' })
    await expect(panel.locator('.dg')).toContainText(['补上的双链5条'])

    // 「补上的双链」这一组：5 条，一条也不连到 Iceland、第三方、未命名
    const items = panel.getByTestId('dream-item').filter({ hasText: '↔ [[' })
    await expect(items).toHaveCount(5)
    const texts = (await items.allInnerTexts()).join('\n')
    expect(texts).not.toMatch(/Geography of Iceland|第三方|未命名|Sourdough|ttravel|健身计划/)
    for (const want of ['Claude', '关税战时间线', '间隔重复', '极光预报', 'Feynman technique']) expect(texts).toContain(want)

    // 点 Claude 那一条：理由是两篇共同的关键词，不是「两篇都讲到『the second』」
    const claude = items.filter({ hasText: 'Claude' })
    await claude.click()
    const why = page.locator('[data-testid="dream-tab"]:not([hidden])').getByTestId('dream-why')
    await expect(why).toContainText(/^两篇共同的关键词：.*(海外手机号|虚拟信用卡|海外信用卡).*只在这篇末尾加一行/)
    await expect(why).not.toContainText('都讲到')
    await page.screenshot({ path: test.info().outputPath('eler2-claude-why.png') })

    // 收下：那篇末尾多一行「相关：[[…]]」，main 上干净
    const title = (await claude.innerText()).split('\n')[0]!.trim()
    const file = title === 'Claude 账号被封以后' ? P.claudeBan : P.claudeVideo
    const other = file === P.claudeBan ? '中国用户怎么用上 Claude' : 'Claude 账号被封以后'
    await panel.getByTestId('dream-detail').getByRole('button', { name: '收下' }).click()
    await expect(claude).toContainText('已收下')
    expect(readFileSync(join(vault, file), 'utf8')).toBe(VAULT[file] + `\n相关：[[${other}]]\n`)
    expect(gitStatus(vault)).toBe('')
  } finally {
    await run.close()
  }
})
