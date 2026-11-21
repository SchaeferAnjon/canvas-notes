// 视频字幕翻译卡在 97%、AI 摘要一直「在写」（task-5tc8i，0.4.6 用户报的）：
// 翻译有句子没翻成、引擎一直不回话、换了「翻成」、摘要出错，进度最后都要走到「好了」或明说「N句没翻成」带原因和「再试一次」，摘要写出来或写明原因带「再试一次」。
// 视频站是本机假的（e2e/fixtures/fake-video.ts，当成 YouTube），AI 是假的（CN_AI_FAKE）：
// CN_TR_FAKE_SKIP 让一句先漏两次，CN_TR_FAKE_HANG 让整批一直不回话，CN_AI_FAKE_FAIL 让摘要先出一次错。
import { expect, test, type Page } from '@playwright/test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { join } from 'node:path'
import { launch, pane, rail, type Running } from './app'
import { FAKE_VIDEO_ID, startFakeVideoSite } from './fixtures/fake-video'

let server: Server
let base: string

test.beforeAll(async () => {
  ;({ server, base } = await startFakeVideoSite())
})
test.afterAll(() => server.close())

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const strip = (page: Page) => web(page).getByRole('region', { name: '视频条' })
const subBtn = (page: Page) => strip(page).locator('button.vsub')
const MAT = '剪藏/视频/Linear transformations and matrices.md'
const read = (vault: string) => (existsSync(join(vault, MAT)) ? readFileSync(join(vault, MAT), 'utf8') : '')
/** 字幕全文里「## AI 摘要」下面那一节 */
const summaryOf = (vault: string) => /## AI 摘要\n([\s\S]*?)\n\n## /.exec(read(vault))?.[1] ?? ''

const env = (extra: Record<string, string> = {}) => ({ CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '150', CN_VIDEO_TEST_ORIGIN: base, ...extra })

/** 交付截图（CN_SHOTS 给了才截，CN_SHOT_SKIN=sky 天青、petrol 深湖）：从主进程截整个窗口，右栏网页也在里面 */
async function skin(page: Page) {
  const s = process.env.CN_SHOT_SKIN
  if (!s) return
  await page.evaluate((x) => window.cn.setSettings({ appearance: { followSystem: false, skin: x as 'sky' } }), s)
  await page.reload()
  await page.locator('.vault b').waitFor()
}
async function shot(run: Running, name: string) {
  const dir = process.env.CN_SHOTS
  if (!dir) return
  await run.page.waitForTimeout(300)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(dir, `${name}${process.env.CN_SHOT_SKIN ? `-${process.env.CN_SHOT_SKIN}` : ''}.png`), Buffer.from(b64, 'base64'))
}

async function openVideo(page: Page) {
  await rail(page).getByRole('button', { name: '网页' }).click()
  const addr = web(page).getByRole('textbox', { name: '网址' })
  await addr.fill(`${base}/watch?v=${FAKE_VIDEO_ID}`)
  await addr.press('Enter')
  await expect(strip(page)).toBeVisible({ timeout: 15_000 })
}

test('有句子没翻成：进度不停在 88%，视频条写「字幕 · 1句没翻成」，字幕菜单里写原因，点「再试一次」补上、走到好了；摘要照样写出来', async () => {
  const run = await launch({ 'a.md': '# a\n' }, env({ CN_TR_FAKE_SKIP: 'The grid lines:2' }))
  const { page, vault } = run
  try {
    await skin(page)
    await openVideo(page)
    await page.waitForTimeout(2500)
    await shot(run, '翻译-视频条')
    await expect(subBtn(page)).toHaveText('字幕 · 1句没翻成', { timeout: 15_000 })
    await expect(subBtn(page)).toHaveClass(/warn/)
    // 字说全了（不出省略号），这一行的按钮都在视频条里
    expect(await subBtn(page).locator('.truncate').evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true)
    expect(await strip(page).locator('.vbar').evaluate((b) => [...b.children].every((c) => c.getBoundingClientRect().right <= b.getBoundingClientRect().right + 0.5))).toBe(true)
    // 摘要不等翻译：照样写出来
    await expect.poll(() => summaryOf(vault), { timeout: 15_000 }).toMatch(/^- \[00:00\]/)
    // 字幕菜单里写原因
    await subBtn(page).click()
    const menu = web(page).getByRole('dialog', { name: '字幕' })
    await expect(menu.getByTestId('tr-error')).toHaveText('有1句没翻成：AI回的格式不对再试一次看原话')
    await shot(run, '翻译-字幕菜单')
    // 字幕全文里另外 7 句的译文已经存进去了
    await expect.poll(() => read(vault)).toContain('A matrix moves every vector.\n译文：A matrix moves every vector.')
    expect(read(vault)).not.toContain('译文：The grid lines')
    // 再试一次：只翻没翻成的那一句，走到好了（没有百分比、没有「没翻成」）
    await menu.getByTestId('tr-error').getByRole('button', { name: '再试一次' }).click()
    await expect(subBtn(page)).toHaveText('字幕 英→中', { timeout: 15_000 })
    await expect(subBtn(page)).not.toHaveClass(/warn/)
    await expect(menu.getByTestId('tr-error')).toHaveCount(0)
    await expect.poll(() => read(vault)).toContain('The grid lines stay parallel.\n译文：The grid lines stay parallel.')
  } finally {
    await run.close()
  }
})

test('翻译引擎一直不回话也不报错：等不到新译文就收尾，写「有8句没翻成：3秒没有新译文，停下了」；摘要不被它挡着', async () => {
  const run = await launch({ 'a.md': '# a\n' }, env({ CN_TR_FAKE_HANG: 'Welcome to linear', CN_VIDEO_TR_STALL_MS: '3000' }))
  const { page, vault } = run
  try {
    await openVideo(page)
    // 以前：摘要排在翻译后面，翻译不收尾摘要就一直「AI 在写摘要…」
    await expect.poll(() => summaryOf(vault), { timeout: 15_000 }).toMatch(/^- \[00:00\]/)
    await expect(subBtn(page)).toHaveText('字幕 · 8句没翻成', { timeout: 15_000 })
    await subBtn(page).click()
    await expect(web(page).getByRole('dialog', { name: '字幕' }).getByTestId('tr-error')).toContainText('有8句没翻成：3秒没有新译文，停下了')
    await expect(web(page).getByRole('dialog', { name: '字幕' }).getByTestId('tr-error').getByRole('button', { name: '再试一次' })).toBeVisible()
  } finally {
    await run.close()
  }
})

test('换「翻成」以后：摘要按新的语言重写，不会一直「AI 在写摘要…」；译文全翻好', async () => {
  const run = await launch({ 'a.md': '# a\n' }, env())
  const { page, vault } = run
  try {
    await openVideo(page)
    await expect(subBtn(page)).toHaveText('字幕 英→中', { timeout: 15_000 })
    await expect.poll(() => summaryOf(vault), { timeout: 15_000 }).toMatch(/^- \[00:00\]/)
    await subBtn(page).click()
    await web(page).getByRole('dialog', { name: '字幕' }).getByRole('radiogroup', { name: '翻成' }).getByRole('radio', { name: '日本語' }).click()
    await expect(subBtn(page)).toHaveText('字幕 英→日', { timeout: 15_000 })
    // 换了以后那一篇写的是 translated: ja，摘要重写好了
    await expect.poll(() => read(vault), { timeout: 15_000 }).toContain('translated: ja')
    await expect.poll(() => summaryOf(vault), { timeout: 15_000 }).toMatch(/^- \[00:00\]/)
    await page.waitForTimeout(1500)
    expect(summaryOf(vault)).not.toContain('在写摘要')
  } finally {
    await run.close()
  }
})

test('摘要出错：字幕全文里写「AI 摘要没写成：原因」，那一行有红色图标和「再试一次」，点了重写出来', async () => {
  const run = await launch({ 'a.md': '# a\n' }, env({ CN_AI_FAKE_FAIL: '视频摘要:1' }))
  const { page, vault } = run
  try {
    await skin(page)
    await openVideo(page)
    await expect.poll(() => summaryOf(vault), { timeout: 15_000 }).toBe('AI 摘要没写成：Claude Code中途退出了')
    // 从左栏打开那一篇
    await page.locator('.nav .si').filter({ hasText: 'Linear transformations and matrices' }).first().click()
    await expect(pane(page).locator('.cm-content')).toContainText('AI 摘要没写成')
    await shot(run, '摘要-没写成')
    const retry = pane(page).locator('.cm-vretry')
    await expect(retry).toHaveText('再试一次')
    await expect(retry.locator('xpath=..')).toContainText('AI 摘要没写成：Claude Code中途退出了')
    await retry.click()
    await expect.poll(() => summaryOf(vault), { timeout: 15_000 }).toMatch(/^- \[00:00\]/)
    await expect(pane(page).locator('.cm-content')).toContainText('开场：这一集讲线性变换')
    await expect(retry).toHaveCount(0)
  } finally {
    await run.close()
  }
})

test('字幕全文那一篇开在中间时：摘要、译文写好后编辑器跟着变，不停在「AI 在写摘要…」', async () => {
  const run = await launch({ 'a.md': '# a\n' }, env({ CN_AI_FAKE_DELAY_MS: '2500' }))
  const { page, vault } = run
  try {
    await openVideo(page)
    await expect.poll(() => read(vault), { timeout: 15_000 }).toContain('AI 在写摘要…')
    await page.locator('.nav .si').filter({ hasText: 'Linear transformations and matrices' }).first().click()
    const doc = pane(page).locator('.cm-content')
    await expect(doc).toContainText('AI 在写摘要…')
    // 磁盘上写好以后，开着的编辑器也是新的（以前软件自己写的不报给编辑器，开着的那一篇一直是旧的）
    await expect.poll(() => summaryOf(vault), { timeout: 15_000 }).toMatch(/^- \[00:00\]/)
    await expect(doc).toContainText('开场：这一集讲线性变换')
    await expect(doc).not.toContainText('AI 在写摘要…')
    await expect(doc).toContainText('译文：A matrix moves every vector.')
    await expect(subBtn(page)).toHaveText('字幕 英→中')
  } finally {
    await run.close()
  }
})
