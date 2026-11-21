// 视频那条路上查出来的两个小毛病（task-sta8n）：
// 1. 视频在放广告时播放器报 0 条字幕轨，视频条写「没有字幕」，广告放完也不再认；要等广告放完重新认出字幕。
// 2. 同一个网页标签里重新打开同一个视频（地址栏再回车、重新载入），不重新读它的字幕轨：第一次没读到，再开一次还是「没有字幕」。
// 视频站是本机假的（e2e/fixtures/fake-video.ts，当成 YouTube）：ad=毫秒 先放广告；flaky=1 第一次打开网站不给字幕轨。AI 是假的。
import { expect, test, type Page } from '@playwright/test'
import type { Server } from 'node:http'
import { launch, openNote, rail } from './app'
import { FAKE_VIDEO_ID, startFakeVideoSite } from './fixtures/fake-video'

let server: Server
let base: string
test.beforeAll(async () => {
  ;({ server, base } = await startFakeVideoSite())
})
test.afterAll(() => server.close())

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const strip = (page: Page) => web(page).getByRole('region', { name: '视频条' })
const env = () => ({ CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '150', CN_VIDEO_TEST_ORIGIN: base })

async function go(page: Page, url: string) {
  const addr = web(page).getByRole('textbox', { name: '网址' })
  await addr.fill(url)
  await addr.press('Enter')
}

test('放广告时播放器报 0 条字幕轨：视频条不定成「没有字幕」，广告放完认出字幕、译好', async () => {
  const run = await launch({ '看视频的笔记.md': '# 看视频的笔记\n\n' }, env())
  const { page } = run
  try {
    await openNote(page, '看视频的笔记')
    await rail(page).getByRole('button', { name: '网页', exact: true }).click()
    // 先放 4 秒广告
    await go(page, `${base}/watch?v=${FAKE_VIDEO_ID}&ad=4000`)
    await expect(strip(page)).toBeVisible({ timeout: 15_000 })
    const subs = strip(page).getByRole('button', { name: '字幕', exact: true })
    // 广告还在放：不说「没有字幕」
    await page.waitForTimeout(2500)
    await expect(subs).not.toContainText('没有字幕')
    // 广告完了：认出字幕，译好
    await expect(subs).toContainText('英→中', { timeout: 20_000 })
  } finally {
    await run.close()
  }
})

test('同一个标签里重新打开同一个视频：重新读字幕轨，第一次没读到的这次读到', async () => {
  const run = await launch({ '看视频的笔记.md': '# 看视频的笔记\n\n' }, env())
  const { page } = run
  try {
    await openNote(page, '看视频的笔记')
    await rail(page).getByRole('button', { name: '网页', exact: true }).click()
    // 第一次：网站没给字幕轨
    const url = `${base}/watch?v=${FAKE_VIDEO_ID}&flaky=1`
    await go(page, url)
    await expect(strip(page)).toBeVisible({ timeout: 15_000 })
    const subs = strip(page).getByRole('button', { name: '字幕', exact: true })
    await expect(subs).toContainText('没有字幕', { timeout: 20_000 })
    // 地址栏里再回车打开同一个视频：这次网站给了，视频条认出字幕
    await go(page, url)
    await expect(subs).toContainText('英→中', { timeout: 20_000 })
  } finally {
    await run.close()
  }
})
