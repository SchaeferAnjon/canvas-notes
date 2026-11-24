/**
 * 右栏 AI 对话最上面那一行（bug 三组 1）：对话长过这一格、跟着滚到底时，最上面那一行以前直接切在「看得到」那一行的底线上，
 * 像被头部盖住了半截。现在上面还有滚出去的时候对话那一格上沿 20 渐隐（follow.tsx 记 data-above，app.css 画），滚到顶就不隐。
 * 一律无头（CN_E2E=1）、假 AI（CN_AI_FAKE=1：问里有「分几节讲」答一段长的），真打字、真滚。
 */
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { launch, openAi, openNote } from './app'

const SHOTS = '/private/tmp/canvas-notes-visual/119-bug三组'
const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const msgs = (page: Page) => chat(page).locator('.msgs')

/** 对话那一格：滚到哪、上沿渐隐没有、最上面露着的那一行顶在哪（和「看得到」那一行底线比） */
const look = (page: Page) =>
  msgs(page).evaluate((el) => ({
    top: el.scrollTop,
    above: el.hasAttribute('data-above'),
    mask: getComputedStyle(el).maskImage,
    tall: el.scrollHeight > el.clientHeight + 40,
  }))

test('对话长过这一格、跟着到底：上沿渐隐，最上面那一行不再硬切在头部底线上；滚到顶不隐', async () => {
  const run = await launch({ '注意力机制.md': '# 注意力机制\n\n注意力就是按相关程度给每个词分权重。\n' }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    mkdirSync(SHOTS, { recursive: true })
    await openNote(page, '注意力机制')
    await openAi(page)
    const box = chat(page).getByRole('textbox', { name: '问 AI' })
    // 还没问：没有滚出去的，不隐
    expect((await look(page)).above).toBe(false)

    for (const q of ['注意力分几节讲', '多头注意力分几节讲']) {
      const n = await chat(page).getByTestId('ai-msg').count()
      await box.fill(q)
      await box.press('Enter')
      await expect(chat(page).getByTestId('ai-msg')).toHaveCount(n + 1)
      await expect(chat(page).getByTestId('ai-msg').nth(n)).toContainText('结果', { timeout: 20_000 })
      await expect(chat(page).getByRole('button', { name: '发送' })).toBeVisible()
    }
    // 跟着到底：上面滚出去了一截，上沿渐隐
    await expect.poll(async () => (await look(page)).above).toBe(true)
    const bottom = await look(page)
    expect(bottom.tall).toBe(true)
    expect(bottom.mask).toContain('linear-gradient')
    await page.screenshot({ path: join(SHOTS, '1-AI对话上沿渐隐.png') })

    // 真滚到顶（触控板往上）：不隐
    const r = (await msgs(page).boundingBox())!
    await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2)
    for (let i = 0; i < 30 && (await look(page)).top > 0; i++) await page.mouse.wheel(0, -600)
    await expect.poll(async () => (await look(page)).top).toBe(0)
    const top = await look(page)
    expect(top.above).toBe(false)
    expect(top.mask).toBe('none')
    await page.screenshot({ path: join(SHOTS, '1c-AI对话滚到顶不隐.png') })

    // 往下滚一点：又隐
    await page.mouse.wheel(0, 200)
    await expect.poll(async () => (await look(page)).above).toBe(true)
  } finally {
    await run.close()
  }
})
