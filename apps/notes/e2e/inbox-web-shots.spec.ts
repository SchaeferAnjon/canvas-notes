// 交付截图（CN_SHOTS 给了才跑）：r172 这一批改到的几处界面。设置 › AI 的翻译那一行（默认 Claude Code · Opus 5.5 · High）和
// 它的菜单（自动换家那一项的人话）、中文视频的双语字幕（本机假视频站）。
import { expect, test, type Page } from '@playwright/test'
import type { Server } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, rail, type Running } from './app'
import { FAKE_ZH_ID, startFakeVideoSite } from './fixtures/fake-video'

test.skip(!process.env.CN_SHOTS, '交付截图：CN_SHOTS=<文件夹> 才跑')

let server: Server
let base: string
test.beforeAll(async () => {
  ;({ server, base } = await startFakeVideoSite())
})
test.afterAll(() => server.close())

async function shot(run: Running, name: string) {
  const dir = process.env.CN_SHOTS!
  mkdirSync(dir, { recursive: true })
  await run.page.waitForTimeout(400)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(dir, `${name}.png`), Buffer.from(b64, 'base64'))
}
const web = (page: Page) => page.getByRole('complementary', { name: '网页' })

test('设置 › AI：翻译那一行和它的菜单', async () => {
  const run = await launch({ 'a.md': '# a\n' }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await page.keyboard.press('Meta+,')
    await page.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: 'AI', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '设置' })
    await expect(dialog.getByTestId('ai-pick-translate-model')).toHaveText('Opus 5.5')
    await shot(run, 'after-settings-translate')
    await dialog.getByTestId('ai-pick-translate').click()
    await expect(page.getByRole('menu', { name: '翻译用哪一家' })).toBeVisible()
    await shot(run, 'after-settings-translate-menu')
    // 选了「自动换家」：选择器只剩一段（和「跟默认」那几行同一个样子）
    await page.getByRole('menu', { name: '翻译用哪一家' }).getByRole('menuitemradio').first().click()
    await expect(dialog.getByTestId('ai-pick-translate')).toContainText('自动换家')
    await page.waitForTimeout(600)
    await shot(run, 'after-settings-translate-auto')
  } finally {
    await run.close()
  }
})

test('中文视频：默认翻成英文，画面上双语两行', async () => {
  const run = await launch({ 'a.md': '# a\n' }, { CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '50', CN_VIDEO_TEST_ORIGIN: base })
  const { page } = run
  try {
    await rail(page).getByRole('button', { name: '网页' }).click()
    const addr = web(page).getByRole('textbox', { name: '网址' })
    await addr.fill(`${base}/watch?v=${FAKE_ZH_ID}`)
    await addr.press('Enter')
    await expect(web(page).getByRole('region', { name: '视频条' }).getByRole('button', { name: '字幕' })).toContainText('中→英', { timeout: 15_000 })
    await page.evaluate(() => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(`(() => { const v = document.querySelector('video'); v.currentTime = 4; v.pause(); return true })()`))
    await page.waitForTimeout(1500)
    await shot(run, 'after-zh-video-bilingual')
  } finally {
    await run.close()
  }
})
