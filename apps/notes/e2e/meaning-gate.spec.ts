/**
 * ⌘K「意思相近」的门槛（task-j0249）：真的本机小模型、像用户真库的样本（fixtures/meaning-vault.ts）。
 * 不沾边的词「意思相近」一组都不出；沾边的出最该出的那篇，回车就开它；一组最多 5 条。
 * 给了 CN_MEANING_SHOTS=<目录> 时每个词截一张整窗（CN_MEANING_TAG 加在文件名前，改前改后各跑一次）；CN_SHOT_TONE=dark 换深湖。
 */
import { expect, type Page, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, type Running, tabOn } from './app'
import { skinned } from './fixtures/book-digest'
import { makeMeaningVault } from './fixtures/meaning-vault'

const DIR = process.env.CN_MEANING_SHOTS
const DARK = process.env.CN_SHOT_TONE === 'dark'
const TAG = process.env.CN_MEANING_TAG ?? 'after'

const pal = (page: Page) => page.getByRole('dialog', { name: '搜索和命令' })
const palBox = (page: Page) => pal(page).getByRole('textbox', { name: '搜索笔记、输入网址或命令' })

/** 列表从上到下：每组的名字和这组每一行的名字 */
const groups = (page: Page) =>
  pal(page).evaluate((el) => {
    const out: { g: string; rows: string[] }[] = []
    for (const n of el.querySelectorAll('.pal-g, .pal-row')) {
      if (n.classList.contains('pal-g')) out.push({ g: (n.firstChild?.textContent ?? '').trim(), rows: [] })
      else out[out.length - 1]?.rows.push((n.querySelector('.nm')?.textContent ?? n.textContent ?? '').trim())
    }
    return out
  })

async function shot(run: Running, name: string) {
  if (!DIR) return
  await run.page.waitForTimeout(300)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(DIR, `${TAG}-${name}${DARK ? '-dark' : ''}.png`), Buffer.from(b64, 'base64'))
}

test('⌘K 意思相近：不沾边的一条不出，沾边的出最该出的那篇、回车就开', async () => {
  test.setTimeout(240_000)
  if (DIR) mkdirSync(DIR, { recursive: true })
  const run = await launch({}, {}, (v) => {
    makeMeaningVault(v)
    skinned(DARK ? 'petrol' : 'sky')(v)
  })
  const { page } = run
  try {
    await expect.poll(() => page.evaluate(() => (window as unknown as { cnSearch: { status(): Promise<{ phase: string }> } }).cnSearch.status().then((s) => s.phase)), { timeout: 120_000 }).toBe('ready')

    /** 开 ⌘K 打一个词，等意思相近回来（停手 300ms 才算，再等够） */
    const type = async (word: string) => {
      await page.keyboard.press('Meta+k')
      await palBox(page).fill(word)
      await expect(pal(page).locator('.pal-g', { hasText: '网页和AI' })).toBeVisible()
      await page.waitForTimeout(1200)
      return groups(page)
    }

    // 不沾边：库里没有的话题、很短的泛词、人名地名
    for (const word of ['特斯拉股价', '天气预报', '没有这个qq', '张三', '好']) {
      const g = await type(word)
      await shot(run, word)
      expect.soft(g.map((x) => x.g), word).not.toContain('意思相近')
      await page.keyboard.press('Escape')
    }

    // 沾边：换了说法、错字。最该出的那篇在「意思相近」里排第一，一组最多 5 条，回车开它
    for (const [word, name] of [
      ['先验和后验概率', '贝叶斯公式'],
      ['怎么养成好习惯', 'Atomic Habits 摘录'],
      ['五花肉怎么炖', '红烧肉做法 字幕'],
      ['矩阵怎么变换', '3Blue1Brown 线性代数的本质 字幕'],
    ]) {
      const g = await type(word!)
      await shot(run, word!)
      const m = g.find((x) => x.g === '意思相近')
      expect.soft(m?.rows[0], word).toBe(name)
      expect.soft(m?.rows.length ?? 0, word).toBeLessThanOrEqual(5)
      await page.keyboard.press('Enter')
      await page.waitForTimeout(600)
      if (await pal(page).isVisible()) await page.keyboard.press('Escape')
      await expect.soft(tabOn(page), word).toHaveText(name!)
    }
  } finally {
    await run.close()
  }
})
