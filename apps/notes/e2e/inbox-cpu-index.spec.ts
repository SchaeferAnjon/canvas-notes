// 第一次打开一个有一批 PDF 的库，搜索进程读 PDF、算向量要一阵子（2026-11-25 收件箱「打开软件 CPU 直接占满」：以前看不出在忙什么）：
// 底栏「后台在做的事」里写着「正在建搜索索引 N%」（A 写在底栏，B 收进「后台 N 件」），建完就没了。
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch } from './app'
import { lecturePdf } from './fixtures/pdf'
import { shotWindow } from './shots'

const WORDS = 'emotion recognition wearable signal arousal valence dataset transformer graph network stress driver physiological feature model'.split(' ')
const page_ = (i: number, p: number) => ({ title: `Paper ${i} - ${p + 1}`, lines: Array.from({ length: 24 }, (_, k) => Array.from({ length: 10 }, (_, j) => WORDS[(i * 7 + p * 5 + k * 3 + j) % WORDS.length]).join(' ')) })
/** 一批论文：40 份，每份 6 页字（建索引要十几秒，底栏那一件看得到） */
const VAULT: Record<string, Uint8Array | string> = { '收件箱/读.md': '# 读\n\n这一批论文先放着。\n' }
for (let i = 0; i < 40; i++) VAULT[`项目/论文/paper-${String(i).padStart(2, '0')}.pdf`] = lecturePdf(Array.from({ length: 6 }, (_, p) => page_(i, p)))

const footer = (page: Page) => page.locator('footer.status')
function frame(f: 'a' | 'b') {
  return (vault: string) => {
    const ud = join(dirname(vault), 'user-data')
    mkdirSync(ud, { recursive: true })
    writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: 'mint', frame: f, winBg: 'aurora' }, editor: { semantic: true } }))
  }
}

test('第一次打开有一批 PDF 的库：底栏写「正在建搜索索引 N%」，数往上走，建完就没了', async () => {
  test.setTimeout(360_000)
  const run = await launch(VAULT, {}, frame('a'))
  const { page } = run
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    const job = footer(page).locator('.bi.job', { hasText: '正在建搜索索引' })
    await expect(job).toBeVisible({ timeout: 30_000 })
    await expect(job).toHaveText(/正在建搜索索引 \d+%/, { timeout: 60_000 })
    const pct = async () => Number((await job.innerText()).match(/(\d+)%/)?.[1] ?? -1)
    const first = await pct()
    expect(first).toBeGreaterThanOrEqual(0)
    await shotWindow(run, 'inbox-cpu-index-a')
    await expect.poll(pct, { timeout: 60_000 }).toBeGreaterThan(first)
    // 点了到设置「按意思找」那一行
    await job.click()
    await expect(page.locator('[data-row="semantic"]')).toBeVisible()
    await page.keyboard.press('Escape')
    // 建完：这一件没了，搜索进程闲下来
    // 建完以前这一件一直在（不一会儿没一会儿有），建完就没了
    const state = () => page.evaluate(() => Promise.all([window.cnSearch.status(), window.cn.embedStatus()]).then(([s, e]) => `${s.phase} ${e.phase}`))
    const until = Date.now() + 240_000
    let gaps = 0
    while ((await state()) !== 'ready ready') {
      expect(Date.now()).toBeLessThan(until)
      if (!(await job.count())) gaps++
      await page.waitForTimeout(1000)
    }
    expect(gaps).toBeLessThanOrEqual(1)
    await expect(job).toHaveCount(0)
  } finally {
    await run.close()
  }
})

test('B 浮岛书桌：建索引收进「后台 1 件」，点开写「正在建搜索索引 N%」', async () => {
  test.setTimeout(360_000)
  const run = await launch(VAULT, {}, frame('b'))
  const { page } = run
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    const jobs = footer(page).locator('.bi.job')
    await expect(jobs).toContainText('后台1件', { timeout: 30_000 })
    await jobs.click()
    await expect(page.getByRole('menuitem', { name: /正在建搜索索引/ })).toBeVisible()
    await shotWindow(run, 'inbox-cpu-index-b')
    await page.keyboard.press('Escape')
    await expect(jobs).toHaveCount(0, { timeout: 240_000 })
  } finally {
    await run.close()
  }
})
