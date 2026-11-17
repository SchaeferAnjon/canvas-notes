// 发版前第 1 轮（实用 · 读与 AI）：视频条「记下这一刻」点完焦点回到视频；问答块「接着问」追问记得进文档、标视频时刻
// 视频站是本机假的（e2e/fixtures/fake-video.ts，当成 YouTube，空格播放 / 暂停），AI 是假的（CN_AI_FAKE）
import { expect, test, type Page } from '@playwright/test'
import type { Server } from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, openNote, pane, rail, waitSaved } from './app'
import { FAKE_VIDEO_ID, startFakeVideoSite } from './fixtures/fake-video'
import { shotTone, shotWindow } from './shots'

let server: Server
let base: string
test.beforeAll(async () => {
  ;({ server, base } = await startFakeVideoSite())
})
test.afterAll(() => server.close())

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const strip = (page: Page) => web(page).getByRole('region', { name: '视频条' })
const env = () => ({ CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '150', CN_VIDEO_TEST_ORIGIN: base })
const NOTE = '看视频的笔记.md'

function guest(page: Page, code: string): Promise<unknown> {
  return page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code)
}

async function openVideo(page: Page) {
  await rail(page).getByRole('button', { name: '网页', exact: true }).click()
  const addr = web(page).getByRole('textbox', { name: '网址' })
  await addr.fill(`${base}/watch?v=${FAKE_VIDEO_ID}`)
  await addr.press('Enter')
  await expect(strip(page)).toBeVisible({ timeout: 15_000 })
  await expect(strip(page).getByRole('button', { name: '字幕', exact: true })).toContainText('英→中', { timeout: 15_000 })
}

async function seek(page: Page, sec: number, play = false) {
  await guest(page, `(() => { const v = document.querySelector('video'); v.currentTime = ${sec}; ${play ? 'v.play()' : 'v.pause()'}; return true })()`)
  await expect.poll(async () => Math.round(Number(await guest(page, 'document.querySelector("video").currentTime')))).toBe(sec)
}

test('CN-70：视频播着点「记下这一刻」，焦点回到视频（按钮上没有焦点），再按空格是暂停，不会多记一刻', async () => {
  const run = await launch({ [NOTE]: '# 看视频的笔记\n\n我先写的一句。\n' }, env())
  const { page, vault } = run
  const moments = () => (readFileSync(join(vault, NOTE), 'utf8').match(/<!-- moment /g) ?? []).length
  try {
    await openNote(page, '看视频的笔记')
    await pane(page).getByText('我先写的一句。').click()
    await page.keyboard.press('End')
    await openVideo(page)
    await seek(page, 4, true)
    await strip(page).getByRole('button', { name: '记下这一刻' }).click()
    await expect(page.locator('.vtoast')).toContainText('记进了《看视频的笔记》')
    await expect.poll(moments).toBe(1)
    // 焦点在右栏的视频网页上，不在按钮上
    expect(await page.evaluate(() => document.activeElement?.tagName.toLowerCase())).toBe('webview')
    expect(await guest(page, 'document.querySelector("video").paused')).toBe(false)
    await page.keyboard.press('Space')
    await expect.poll(() => guest(page, 'document.querySelector("video").paused')).toBe(true)
    await page.waitForTimeout(1500)
    expect(moments()).toBe(1)
  } finally {
    await run.close()
  }
})

test('CN-84：问答块上「接着问」：引文标「00:06 · 视频名」不写「第 0 页」；追问的回答记进同一篇文档，没有英文报错', async () => {
  const run = await launch({ [NOTE]: '# 看视频的笔记\n\n我先写的一句。\n' }, env())
  const { page, vault } = run
  try {
    await shotTone(page)
    await openNote(page, '看视频的笔记')
    await pane(page).locator('.cm-content').click()
    await page.keyboard.press('Meta+End')
    await openVideo(page)
    await seek(page, 6)
    await pane(page).locator('.cm-content').click()
    await page.keyboard.press('Alt+KeyD')
    await expect.poll(() => guest(page, `!!document.getElementById('cn-video-host').shadowRoot.querySelector('.box')`)).toBe(true)
    const wv = (await web(page).locator('webview.on').boundingBox())!
    await page.mouse.move(wv.x + 120, wv.y + 60)
    await page.mouse.down()
    await page.mouse.move(wv.x + 220, wv.y + 140, { steps: 6 })
    await page.mouse.up()
    const ask = web(page).getByRole('dialog', { name: '问 AI' })
    await expect(ask).toBeVisible()
    await ask.getByRole('textbox', { name: '想问什么' }).press('Enter')
    await expect(page.getByText(/AI讲完了/)).toBeVisible({ timeout: 15_000 })
    await waitSaved(page)

    // 光标放回第一句，点问答块上的「接着问」：右栏下格开 AI，引文标视频时刻和视频名
    await pane(page).getByText('我先写的一句。').click()
    const more = pane(page).locator('[data-part="问答块"]').getByRole('button', { name: '接着问' })
    await more.scrollIntoViewIfNeeded()
    await more.click()
    const reading = page.getByRole('complementary', { name: '边读边问 AI' })
    await expect(reading).toBeVisible()
    await expect(page.getByRole('complementary', { name: 'AI 对话' })).toHaveCount(0)
    const q = reading.locator('.attq')
    await expect(q.locator('.lb')).toHaveText('00:06 · Linear transformations and matrices')
    await expect(q).not.toContainText('第 0 页')
    await expect(reading.getByTestId('reading-sees')).toContainText('网页 · Linear transformations and matrices')
    await expect(reading.getByTestId('reading-sees')).not.toContainText('127.0.0.1')
    const box = reading.getByRole('textbox', { name: '问 AI' })
    await expect(box).toBeFocused()
    await shotWindow(run, 'r1-video-follow')
    await box.fill('那第三个箭头呢')
    await box.press('Enter')
    const msg = reading.getByTestId('reading-msg').last()
    await expect(msg.locator('.noted')).toContainText('已记进《看视频的笔记》', { timeout: 15_000 })
    await expect(msg.locator('.read')).toContainText('接着00:06那一问')
    await expect(reading.locator('.msgs')).not.toContainText('第 0 页')
    await expect(reading.locator('.msgs')).not.toContainText('TypeError')
    await waitSaved(page)
    const md = readFileSync(join(vault, NOTE), 'utf8')
    expect(md).toContain('那第三个箭头呢')
  } finally {
    await run.close()
  }
})

test('第 2 轮：「接着问」带上那一帧和上一问的回答、前后字幕；视频跳回那一秒停住；记进文档的来源是「▶ 00:06 · 视频名」不是网页', async () => {
  const run = await launch({ [NOTE]: '# 看视频的笔记\n\n我先写的一句。\n' }, env())
  const { page, vault } = run
  try {
    await shotTone(page)
    await openNote(page, '看视频的笔记')
    await pane(page).locator('.cm-content').click()
    await page.keyboard.press('Meta+End')
    await openVideo(page)
    await seek(page, 6)
    await pane(page).locator('.cm-content').click()
    await page.keyboard.press('Alt+KeyD')
    await expect.poll(() => guest(page, `!!document.getElementById('cn-video-host').shadowRoot.querySelector('.box')`)).toBe(true)
    const wv = (await web(page).locator('webview.on').boundingBox())!
    await page.mouse.move(wv.x + 120, wv.y + 60)
    await page.mouse.down()
    await page.mouse.move(wv.x + 220, wv.y + 140, { steps: 6 })
    await page.mouse.up()
    const ask = web(page).getByRole('dialog', { name: '问 AI' })
    await ask.getByRole('textbox', { name: '想问什么' }).press('Enter')
    await expect(page.getByText(/AI讲完了/)).toBeVisible({ timeout: 15_000 })
    await waitSaved(page)

    // 视频接着播到 00:20 停下，再点「接着问」：跳回 00:06 停住
    await seek(page, 20)
    await pane(page).getByText('我先写的一句。').click()
    const more = pane(page).locator('[data-part="问答块"]').getByRole('button', { name: '接着问' })
    await more.scrollIntoViewIfNeeded()
    await more.click()
    await expect.poll(async () => Math.round(Number(await guest(page, 'document.querySelector("video").currentTime')))).toBe(6)
    await page.waitForTimeout(400)
    expect(await guest(page, 'document.querySelector("video").paused')).toBe(true)
    expect(Math.round(Number(await guest(page, 'document.querySelector("video").currentTime')))).toBe(6)

    // 待问区里有那一帧
    const reading = page.getByRole('complementary', { name: '边读边问 AI' })
    await expect(reading.locator('.attq img')).toHaveAttribute('alt', '00:06 这一帧')
    await shotWindow(run, 'r2-video-follow')
    const box = reading.getByRole('textbox', { name: '问 AI' })
    await box.fill('那第三个箭头呢')
    await box.press('Enter')
    const msg = reading.getByTestId('reading-msg').last()
    // 假 AI 回显它拿到了什么：那一帧（图 1 张）、上一问的回答、前后字幕
    await expect(msg.locator('.txt')).toContainText('图 1 张', { timeout: 15_000 })
    await expect(msg.locator('.txt')).toContainText('带了上一问的回答')
    await expect(msg.locator('.txt')).toContainText('带了字幕')
    await expect(msg.locator('.noted')).toContainText('已记进《看视频的笔记》', { timeout: 15_000 })
    await waitSaved(page)
    await shotWindow(run, 'r2-video-follow-noted')
    const md = readFileSync(join(vault, NOTE), 'utf8')
    const follow = md.slice(md.indexOf('那第三个箭头呢') - 400)
    expect(follow).toMatch(/\[▶ 00:06 · Linear transformations and matrices\]\(http[^)]*t=6s?\) · \d\d:\d\d/)
    expect(follow).toContain('看了 00:06 这一帧')
    expect(md).not.toContain('看了网页这一段')
    expect(md).not.toMatch(/\[127\.0\.0\.1\]/)
    const convo = /\[完整对话 · 1 轮\]\(([^)]+)\)/.exec(follow)![1]!
    expect(decodeURIComponent(convo)).toMatch(/^\.canvas-notes\/对话\/视频-youtube-/)
    const convoMd = readFileSync(join(vault, decodeURIComponent(convo)), 'utf8')
    expect(convoMd).toContain('# ▶ 00:06 · Linear transformations and matrices · ')
    expect(convoMd).toContain('![00:06 这一帧](')
  } finally {
    await run.close()
  }
})
