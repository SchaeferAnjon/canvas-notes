// 发版前第 1 轮（实用 · 读与 AI）：视频条「记下这一刻」点完焦点回到视频；问答块「接着问」追问记得进文档、标视频时刻
// 视频站是本机假的（e2e/fixtures/fake-video.ts，当成 YouTube，空格播放 / 暂停），AI 是假的（CN_AI_FAKE）
import { expect, test, type Page } from '@playwright/test'
import type { Server } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, openNote, pane, rail, waitSaved } from './app'
import { FAKE_VIDEO_ID, startFakeVideoSite } from './fixtures/fake-video'
import { OLD_ASK_FRAME, oldAskBlock, oldAskFrame } from './fixtures/old-ask-block'
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

// 2026-11-24 起问答写进那篇本身（小标题 + AI 回答框），不再插老的问答块；老文档里的问答块「接着问」照样能用：先把那一块写进文档
test('CN-84：问答块上「接着问」：引文标「00:06 · 视频名」不写「第 0 页」；追问的回答写进那篇本身，没有英文报错', async () => {
  const run = await launch({ [NOTE]: `# 看视频的笔记\n\n我先写的一句。\n\n${oldAskBlock(base)}\n`, [OLD_ASK_FRAME]: oldAskFrame() }, env())
  const { page, vault } = run
  try {
    await shotTone(page)
    await openNote(page, '看视频的笔记')
    await openVideo(page)
    await seek(page, 6)

    // 光标放回第一句，点问答块上的「接着问」：右栏下格开 AI，引文标视频时刻和视频名
    await pane(page).getByText('我先写的一句。').click()
    const more = pane(page).locator('[data-part="问答块"]').getByRole('button', { name: '接着问' })
    await more.scrollIntoViewIfNeeded()
    await more.click()
    const reading = page.getByRole('complementary', { name: '边读边问 AI' })
    await expect(reading).toBeVisible()
    await expect(page.getByRole('complementary', { name: 'AI 对话' })).toHaveCount(0)
    const q = reading.getByTestId('reading-att')
    await expect(q.locator('.cs')).toHaveText('00:06 · Linear transformations and matrices')
    await expect(q).not.toContainText('第 0 页')
    await expect(reading.getByTestId('reading-sees')).toContainText('网页 · Linear transformations and matrices')
    await expect(reading.getByTestId('reading-sees')).not.toContainText('127.0.0.1')
    const box = reading.getByRole('textbox', { name: '问 AI' })
    await expect(box).toBeFocused()
    await shotWindow(run, 'r1-video-follow')
    await box.fill('那第三个箭头呢')
    await box.press('Enter')
    const msg = reading.getByTestId('reading-msg').last()
    await expect(msg.getByTestId('ai-noted')).toContainText('已记进《看视频的笔记》', { timeout: 15_000 })
    await expect(msg.locator('.read')).toContainText('接着00:06那一问')
    await expect(reading.locator('.msgs')).not.toContainText('第 0 页')
    await expect(reading.locator('.msgs')).not.toContainText('TypeError')
    await waitSaved(page)
    const md = readFileSync(join(vault, NOTE), 'utf8')
    expect(md).toContain('### 那第三个箭头呢')
    expect(md).toContain(oldAskBlock(base))
    expect(md).not.toContain('AI 笔记')
  } finally {
    await run.close()
  }
})

test('第 2 轮：「接着问」带上那一帧和上一问的回答、前后字幕；视频跳回那一秒停住；写进那篇的来源是「▶ 00:06 · 视频名」不是网页', async () => {
  const run = await launch({ [NOTE]: `# 看视频的笔记\n\n我先写的一句。\n\n${oldAskBlock(base)}\n`, [OLD_ASK_FRAME]: oldAskFrame() }, env())
  const { page, vault } = run
  try {
    await shotTone(page)
    await openNote(page, '看视频的笔记')
    await openVideo(page)
    await seek(page, 6)

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
    await expect(reading.getByTestId('reading-att').locator('img')).toHaveAttribute('alt', '00:06 这一帧')
    await shotWindow(run, 'r2-video-follow')
    const box = reading.getByRole('textbox', { name: '问 AI' })
    await box.fill('那第三个箭头呢')
    await box.press('Enter')
    const msg = reading.getByTestId('reading-msg').last()
    // 假 AI 回显它拿到了什么：那一帧（图 1 张）、上一问的回答、前后字幕
    await expect(msg.locator('.txt')).toContainText('图 1 张', { timeout: 15_000 })
    await expect(msg.locator('.txt')).toContainText('带了上一问的回答')
    await expect(msg.locator('.txt')).toContainText('带了字幕')
    await expect(msg.getByTestId('ai-noted')).toContainText('已记进《看视频的笔记》', { timeout: 15_000 })
    await waitSaved(page)
    await shotWindow(run, 'r2-video-follow-noted')
    // 写进那篇本身：一问一个小标题（不另起一节视频名），来源行回到那一秒（不是网页的域名）；那一帧文档里那块问答已经有了，不再放一遍
    const all = readFileSync(join(vault, NOTE), 'utf8')
    expect(all).toContain(oldAskBlock(base))
    // 光标在「我先写的一句。」那行，新的一问插在那里（旧那块问答在它后面）：只看插进去的这一问
    const md = all.slice(all.indexOf('### 那第三个箭头呢'), all.indexOf(oldAskBlock(base)))
    expect(all.indexOf('### 那第三个箭头呢')).toBeGreaterThan(all.indexOf('我先写的一句。'))
    expect(all.indexOf(oldAskBlock(base))).toBeGreaterThan(all.indexOf('### 那第三个箭头呢'))
    expect(md).toMatch(/^### 那第三个箭头呢\n\n—— \[▶ 00:06 · Linear transformations and matrices\]\(http[^)]*t=6s?\)\n\n> \[!ai\] AI 回答 · /)
    expect(all).not.toContain('## Linear transformations and matrices')
    expect(md).not.toContain('![')
    expect(md).not.toMatch(/\[127\.0\.0\.1\]|看了网页这一段|cn:thread|\[!question\]/)
    expect(existsSync(join(vault, '.canvas-notes/对话'))).toBe(false)
  } finally {
    await run.close()
  }
})
