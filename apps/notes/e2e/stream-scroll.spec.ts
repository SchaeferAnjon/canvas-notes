// 流式时能往上翻（2026-11-24 用户截图：读 PDF 右栏 AI 正在答，没答完就滑不回它开头讲的地方，一直被拽回最底）。
// 真点：答着的时候滚轮往上 300 → 2 秒后还停在那、底下出「↓ 新回答」；滚回最底又跟着往下；再往上翻，答完位置不跳；点「↓ 新回答」回到最底。
// AI 对话、读 PDF 的 AI 各走一遍（同一个 @cn/ai-chat/follow）。一律无头（CN_E2E=1）、假 AI 慢慢吐字（CN_FAKE_SAY_MS）、临时库。
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launch, openAi, openNote, tabOn } from './app'
import { LECTURE } from './fixtures/pdf'

const PDF = '课程/线代/第3讲.pdf'
const files = { '收件箱/随手.md': '# 随手\n\n问问 AI。\n', [PDF]: LECTURE }
// 每 4 个字隔 80 毫秒：一段「分几节讲」的长回答要答十来秒
const ENV = { CN_AI_FAKE: '1', CN_FAKE_SAY_MS: '80' }

const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const reading = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })
const stop = (col: Locator) => col.getByRole('button', { name: '停下' })
const pos = (list: Locator) => list.evaluate((el) => ({ top: el.scrollTop, gap: el.scrollHeight - el.scrollTop - el.clientHeight, h: el.scrollHeight }))

async function send(col: Locator, text: string) {
  const ta = col.getByRole('textbox', { name: '问 AI' })
  await ta.fill(text)
  await ta.press('Enter')
}

/** 指着对话那一格转滚轮（触控板、鼠标滚轮都是这条路） */
async function wheel(page: Page, list: Locator, dy: number) {
  const b = (await list.boundingBox())!
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
  await page.mouse.wheel(0, dy)
}

async function walk(page: Page, col: Locator) {
  const list = col.locator('.msgs')
  const below = col.getByTestId('ai-new-below')
  // 第一问答完：上面有够长的一段可以往回翻
  await send(col, '整体在做什么分几节讲')
  await expect(stop(col)).toHaveCount(0, { timeout: 40_000 })
  await expect(below).toHaveCount(0)

  // 第二问答着：往上滑 300
  await send(col, '第二遍分几节讲')
  await expect(stop(col)).toBeVisible()
  await expect.poll(async () => (await pos(list)).h, { timeout: 10_000 }).toBeGreaterThan((await pos(list)).h + 200)
  await wheel(page, list, -300)
  await expect.poll(async () => (await pos(list)).gap).toBeGreaterThan(250)
  const held = await pos(list)
  await page.waitForTimeout(2000)
  await expect(stop(col)).toBeVisible()
  const later = await pos(list)
  // 两秒里底下又长了字，人看的地方没动
  expect(later.h).toBeGreaterThan(held.h)
  expect(Math.abs(later.top - held.top)).toBeLessThanOrEqual(1)
  await expect(below).toBeVisible()
  await expect(below).toHaveText('新回答')

  // 滚回最底：又跟着往下，按钮收起
  await wheel(page, list, 5000)
  await expect.poll(async () => (await pos(list)).gap).toBeLessThanOrEqual(24)
  await expect(below).toHaveCount(0)
  const back = await pos(list)
  await page.waitForTimeout(1200)
  await expect(stop(col)).toBeVisible()
  const grown = await pos(list)
  expect(grown.h).toBeGreaterThan(back.h)
  expect(grown.gap).toBeLessThanOrEqual(24)

  // 再往上翻一点（触控板一下只挪几十像素，以前离底 48 以内照样被拽回去）：答完也不跳
  await wheel(page, list, -40)
  await expect.poll(async () => (await pos(list)).gap).toBeGreaterThan(30)
  const mid = await pos(list)
  await page.waitForTimeout(800)
  expect(Math.abs((await pos(list)).top - mid.top)).toBeLessThanOrEqual(1)
  await wheel(page, list, -300)
  await expect.poll(async () => (await pos(list)).gap).toBeGreaterThan(300)
  const before = await pos(list)
  await expect(stop(col)).toHaveCount(0, { timeout: 40_000 })
  await page.waitForTimeout(600)
  expect(Math.abs((await pos(list)).top - before.top)).toBeLessThanOrEqual(1)

  // 点「↓ 新回答」：回到最底
  await expect(below).toBeVisible()
  await below.click()
  await expect.poll(async () => (await pos(list)).gap).toBeLessThanOrEqual(24)
  await expect(below).toHaveCount(0)
}

test('AI 对话：答着的时候往上翻停得住，滚回最底接着跟，答完不跳，点「↓ 新回答」回到最底', async () => {
  test.setTimeout(150_000)
  const run = await launch(files, ENV)
  const { page } = run
  try {
    await openNote(page, '随手')
    await openAi(page)
    await walk(page, chat(page))
  } finally {
    await run.close()
  }
})

test('读 PDF 的 AI：答着的时候往上翻停得住，滚回最底接着跟，答完不跳，点「↓ 新回答」回到最底', async () => {
  test.setTimeout(150_000)
  const run = await launch(files, ENV)
  const { page } = run
  try {
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
    await page.locator('.pal-row', { hasText: '第3讲' }).first().click()
    await expect(tabOn(page)).toHaveText('第3讲.pdf')
    await openAi(page)
    await walk(page, reading(page))
  } finally {
    await run.close()
  }
})
