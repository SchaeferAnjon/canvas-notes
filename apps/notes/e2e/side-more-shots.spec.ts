/**
 * 交付对照图（task-p90ra 旁支接上白板 AI 讲解卡和问框回答）：软件摆成和原型 /private/tmp/canvas-notes-build4/side-more/proto.html 同一个状态，
 * 整窗截下来（1440×887，B 浮岛书桌）。只在截交付图时跑：CN_SHOTS=目录，CN_SHOT_TONE=dark 截深湖（不给是天青）。平时跳过。
 */
import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { dirname, join } from 'node:path'
import { acts, launch, openNote, pane, rail, type Running } from './app'
import { col } from './fixtures/board-doc'
import { FAKE_VIDEO_ID, startFakeVideoSite } from './fixtures/fake-video'

const DIR = process.env.CN_SHOTS
const DARK = process.env.CN_SHOT_TONE === 'dark'
test.skip(!DIR, '只在截交付图时跑（CN_SHOTS=目录）')

const look = (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: DARK ? 'petrol' : 'sky', frame: 'b', winBg: 'aurora' } }))
}
const askbox = (page: Page) => page.getByRole('toolbar', { name: '选中的这句' })
const sideIn = (scope: Locator) => scope.getByRole('region', { name: '旁支' })

async function shot(run: Running, name: string) {
  await run.page.mouse.move(5, 300)
  await run.page.waitForTimeout(700)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(DIR!, `app-${name}-${DARK ? 'dark' : 'light'}.png`), Buffer.from(b64, 'base64'))
}

async function size(run: Running) {
  await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
  await expect.poll(() => run.page.evaluate(() => innerHeight)).toBe(887)
}

async function selectText(page: Page, scope: Locator, from: string, to: string) {
  const pts = await scope.evaluate(
    (root, [a, b]) => {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let s: [Node, number] | null = null
      let e: [Node, number] | null = null
      while (w.nextNode()) {
        const n = w.currentNode as Text
        if (!s && n.data.includes(a!)) s = [n, n.data.indexOf(a!)]
        if (s && n.data.includes(b!, s[0] === n ? s[1] : 0)) {
          e = [n, n.data.indexOf(b!, s[0] === n ? s[1] : 0) + b!.length]
          break
        }
      }
      const r = document.createRange()
      r.setStart(s![0], s![1])
      r.setEnd(e![0], e![1])
      const rs = r.getClientRects()
      const f = rs[0]!
      const l = rs[rs.length - 1]!
      return [f.left + 1, f.top + f.height / 2, l.right - 1, l.top + l.height / 2]
    },
    [from, to],
  )
  await page.mouse.move(pts[0]!, pts[1]!)
  await page.mouse.down()
  await page.mouse.move(pts[2]!, pts[3]!, { steps: 8 })
  await page.mouse.up()
}

const DOC = '课程/ecp/第5讲 注意力机制.md'
const DOC_TEXT = [
  '# 第5讲 注意力机制',
  '',
  '## 讲解',
  '',
  '这一讲从「一句话里每个词该看谁」讲起，引出 Q、K、V 三样东西。',
  '',
  '> [!ai] AI 讲解 · Claude Code · Opus 5.5 · 看了 00:06 这一帧',
  '> 这一帧在讲缩放点积注意力：先拿 Q 和每个 K 做点积。分数要先除以 √d，再过 softmax 变成权重。',
  '>',
  '> 最后用这些权重把 V 加起来，就是这个位置的输出。',
  '',
  '我的理解：缩放是为了让分数别太极端。',
  '',
  '## 还没想通',
  '',
  '为什么偏偏是根号 d？',
  '',
  '多头注意力里每个头的 d 是不是更小？',
  '',
].join('\n')

test('白板上的 AI 讲解卡：小框、开着旁支、收起只留小标', async () => {
  test.setTimeout(120_000)
  const run = await launch({ [DOC]: DOC_TEXT }, { CN_AI_FAKE: '1' }, look)
  const { page } = run
  try {
    await size(run)
    await openNote(page, '第5讲 注意力机制')
    await acts(page).getByRole('tab', { name: '白板' }).click()
    const card = col(page, '讲解').locator('.db-card[aria-label="AI 讲解"]')
    const body = card.locator('.side-text')
    await selectText(page, body, '分数要先', '变成权重。')
    await expect(askbox(page)).toBeVisible()
    await shot(run, 'board-askbox')
    await askbox(page).getByRole('button', { name: '问这句' }).click()
    await page.keyboard.insertText('V 在这里是什么？')
    await page.keyboard.press('Enter')
    const s = sideIn(card)
    await expect(s.locator('.acts')).toBeVisible({ timeout: 15_000 })
    await s.getByRole('textbox').fill('为什么偏偏除以根号 d？')
    await s.getByRole('textbox').press('Enter')
    await expect(s.locator('.sq')).toHaveCount(2)
    await expect(s.locator('.acts')).toBeVisible({ timeout: 15_000 })
    await shot(run, 'board-open')
    await s.getByRole('button', { name: '收起旁支' }).first().click()
    await expect(s).toHaveCount(0)
    await page.waitForTimeout(1600)
    await shot(run, 'board-closed')
  } finally {
    await run.close()
  }
})

let server: Server
let base: string
test.beforeAll(async () => {
  ;({ server, base } = await startFakeVideoSite())
})
test.afterAll(() => server?.close())

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const guest = (page: Page, code: string): Promise<unknown> =>
  page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code)

test('问框的回答：开着旁支（旁支的输入框钉在问框底部）、收起只留小标', async () => {
  test.setTimeout(150_000)
  const NOTE = '看视频的笔记.md'
  const run = await launch({ [NOTE]: '# 看视频的笔记\n\n我先写的一句。\n' }, { CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '150', CN_AI_FAKE_ASK_MS: '600', CN_VIDEO_TEST_ORIGIN: base }, look)
  const { page } = run
  try {
    await size(run)
    await openNote(page, '看视频的笔记')
    await pane(page).getByText('我先写的一句。').click()
    await page.keyboard.press('End')
    await rail(page).getByRole('button', { name: '网页', exact: true }).click()
    const addr = web(page).getByRole('textbox', { name: '网址' })
    await addr.fill(`${base}/watch?v=${FAKE_VIDEO_ID}`)
    await addr.press('Enter')
    await expect(web(page).getByRole('region', { name: '视频条' })).toBeVisible({ timeout: 15_000 })
    await guest(page, `(() => { const v = document.querySelector('video'); v.currentTime = 6; v.pause(); return true })()`)
    await page.waitForTimeout(400)
    await pane(page).getByText('我先写的一句。').click()
    await page.keyboard.press('Alt+KeyD')
    await expect.poll(() => guest(page, `!!document.getElementById('cn-video-host').shadowRoot.querySelector('.box')`)).toBe(true)
    const wv = (await web(page).locator('webview.on').boundingBox())!
    await page.mouse.move(wv.x + 40, wv.y + 30)
    await page.mouse.down()
    await page.mouse.move(wv.x + 200, wv.y + 120, { steps: 6 })
    await page.mouse.up()
    const ask = web(page).getByRole('dialog', { name: '问 AI' })
    await ask.getByRole('textbox', { name: '想问什么' }).press('Enter')
    const ans = ask.getByTestId('ak-answer').first()
    await expect(ask.getByRole('button', { name: /已记进/ })).toBeVisible({ timeout: 15_000 })
    await selectText(page, ans, '任何向量', '的组合，')
    await expect(askbox(page)).toBeVisible()
    await shot(run, 'ask-askbox')
    await askbox(page).getByRole('button', { name: '问这句' }).click()
    await page.keyboard.insertText('为什么是组合？')
    await page.keyboard.press('Enter')
    const s = sideIn(ask)
    await expect(s.locator('.acts')).toBeVisible({ timeout: 15_000 })
    await shot(run, 'ask-open')
    await s.getByRole('button', { name: '收起旁支' }).first().click()
    await expect(s).toHaveCount(0)
    await page.waitForTimeout(1600)
    await shot(run, 'ask-closed')
  } finally {
    await run.close()
  }
})
