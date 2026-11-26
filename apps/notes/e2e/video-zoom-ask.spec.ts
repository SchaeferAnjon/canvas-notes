// 收件箱「视频 ai 放大之后消失」：视频问框右上那颗「重框」（图标和「占满」一样，像放大）一点就把问框收了，esc 也回不来；
// 它和视频那一行的「框一块问」是同一件事（r172 A14），2026-11-25 拿掉，头上只剩「×」。
// 另外几种放大（网页全屏、网页这一组占满）以后问框和 AI 都还在、退出照原样。视频站是本机假的（fixtures/fake-video.ts），AI 是假的。
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
const askCard = (page: Page) => web(page).getByRole('dialog', { name: '问 AI' })
const env = () => ({ CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '50', CN_VIDEO_TEST_ORIGIN: base })

function guest(page: Page, code: string, gesture = false): Promise<unknown> {
  return page.evaluate(([c, g]) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string, g: boolean): Promise<unknown> }).executeJavaScript(c as string, g as boolean), [code, gesture] as const)
}
const boxes = (page: Page) => guest(page, `[...document.getElementById('cn-video-host').shadowRoot.querySelectorAll('.box')].map((b) => b.className).join('|')`)

async function openVideo(page: Page) {
  await rail(page).getByRole('button', { name: '网页' }).click()
  const addr = web(page).getByRole('textbox', { name: '网址' })
  await addr.fill(`${base}/watch?v=${FAKE_VIDEO_ID}`)
  await addr.press('Enter')
  await expect(strip(page).getByRole('button', { name: '字幕' })).toContainText('英→中', { timeout: 15_000 })
  await guest(page, `(() => { const v = document.querySelector('video'); v.currentTime = 6; v.pause(); return true })()`)
}

/** 在画面上拖一个框（拖框已经开始了） */
async function drag(page: Page, from: [number, number], to: [number, number]) {
  await expect.poll(() => boxes(page)).toMatch(/(^|\|)box( dim)?($|\|)/)
  const wv = (await web(page).locator('webview.on').boundingBox())!
  await page.mouse.move(wv.x + from[0], wv.y + from[1])
  await page.mouse.down()
  await page.mouse.move(wv.x + to[0], wv.y + to[1], { steps: 6 })
  await page.mouse.up()
}

/** 框一块、问一句，等答完 */
async function askOnce(page: Page) {
  await strip(page).getByRole('button', { name: '框一块问' }).click()
  await drag(page, [40, 30], [200, 150])
  await expect(askCard(page)).toBeVisible()
  await askCard(page).getByRole('textbox', { name: '想问什么' }).fill('这一块在讲什么？')
  await askCard(page).getByRole('textbox', { name: '想问什么' }).press('Enter')
  await expect(askCard(page).locator('.ak-t')).toHaveText('你问：这一块在讲什么？', { timeout: 15_000 })
  await expect(askCard(page).getByRole('button', { name: /已记进/ })).toBeVisible({ timeout: 15_000 })
}

test('问框头上只有「×」：像放大的那颗「重框」拿掉了；要重框用视频那一行的「框一块问」', async () => {
  const run = await launch({ '看视频的笔记.md': '# 看视频的笔记\n\n跟着视频记。\n' }, env())
  const { page } = run
  try {
    await openNote(page, '看视频的笔记')
    await openVideo(page)
    await askOnce(page)
    const head = askCard(page).locator('.ak-x button')
    await expect(head).toHaveCount(1)
    await expect(head).toHaveAccessibleName('关掉')
    await expect(askCard(page).getByRole('button', { name: '重框' })).toHaveCount(0)
    // 问框开着时点「框一块问」：拖一块新的，换成新框的问框
    await strip(page).getByRole('button', { name: '框一块问' }).click()
    await drag(page, [60, 50], [160, 120])
    await expect(askCard(page).locator('.ak-t')).toHaveText('问框住的这一块')
    expect(await boxes(page)).toBe('box done')
  } finally {
    await run.close()
  }
})

test('网页全屏、网页这一组占满：放大时问框跟着视频，退出以后问框（问过的）和 AI 照原样', async () => {
  const run = await launch({ '看视频的笔记.md': '# 看视频的笔记\n\n跟着视频记。\n' }, env())
  const { page } = run
  try {
    // 网页一栏、AI 一栏（用户截图里的摆法）
    await page.evaluate(() =>
      localStorage.setItem(
        'cn.dock',
        JSON.stringify({ v: 1, cols: [{ id: 'center' }, { id: 'c1', w: 460, groups: [{ id: 'g1', views: ['web'], active: 'web', f: 0.6 }, { id: 'g2', views: ['ai'], active: 'ai', f: 0.4 }] }], floats: [], hidden: null }),
      ),
    )
    await page.reload()
    await expect(page.locator('.vault b')).toHaveText('测试库')
    await openNote(page, '看视频的笔记')
    const addr = web(page).getByRole('textbox', { name: '网址' })
    await addr.fill(`${base}/watch?v=${FAKE_VIDEO_ID}`)
    await addr.press('Enter')
    await expect(strip(page).getByRole('button', { name: '字幕' })).toContainText('英→中', { timeout: 15_000 })
    const ai = page.locator('.win > .dview[data-view="ai"]')
    await expect(ai).toBeVisible()
    await askOnce(page)
    // 问框离视频下沿多远（右栏上沿会挪几像素、退出全屏网页会滚回顶上，量相对视频的）
    const offset = async () => Math.round((await askCard(page).boundingBox())!.y - (await web(page).locator('webview.on').boundingBox())!.y - Number(await guest(page, `document.getElementById('movie_player').getBoundingClientRect().bottom`)))
    const before = await offset()

    // 网页全屏（播放器的全屏键）再退出
    await guest(page, `document.getElementById('movie_player').requestFullscreen().then(() => true)`, true)
    await expect.poll(() => page.evaluate(() => document.fullscreenElement?.tagName ?? '')).toBe('WEBVIEW')
    await guest(page, `document.exitFullscreen().then(() => true)`, true)
    await expect.poll(() => page.evaluate(() => document.fullscreenElement?.tagName ?? '')).toBe('')
    await expect(askCard(page)).toBeVisible()
    await expect(askCard(page).locator('.ak-t')).toHaveText('你问：这一块在讲什么？')
    await expect.poll(offset).toBe(before)
    await expect(ai).toBeVisible()

    // 网页这一组占满：问框跟着视频；Esc 回去，AI 那一组回来
    await page.getByRole('button', { name: '占满：网页' }).click()
    await expect(page.getByTestId('max-hint')).toBeVisible()
    await expect(askCard(page)).toBeVisible()
    await page.getByTestId('max-hint').click()

    await expect(page.getByTestId('max-hint')).toBeHidden()
    await expect(ai).toBeVisible()
    await expect(askCard(page)).toBeVisible()
    await expect.poll(offset).toBe(before)
  } finally {
    await run.close()
  }
})
