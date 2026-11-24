// 四处回答下面那排一致（0.5.5 发版前加，转话人：用户在 0.5.3 上看到网页那段对话的回答下面只有三颗快捷回复、没有「拷贝 · 插进文档 · ⋯」）。
// 真点、无头、假 AI、临时库：AI 对话、网页（框着问、再打一句）、读 PDF、视频问框四处，回答下面左边都是 拷贝 · 插进文档 · ⋯，
// 右边快捷回复照各处默认：AI 对话、网页、视频 还是不懂 · 换个方式讲；读 PDF 再加 做个可视化（AI 觉得适合画图时）。放不下的进 ⋯，排上的加 ⋯ 里的合起来对。
// CN_SHOTS=目录 时每处截一张（薄荷），交付页拼成四处并排图。
import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { dirname, join } from 'node:path'
import { launch, openAi, openNote, pane, rail, type Running, tabOn, widenRight } from './app'
import { FAKE_VIDEO_ID, startFakeVideoSite } from './fixtures/fake-video'
import { LECTURE } from './fixtures/pdf'

const SHOTS = process.env.CN_SHOTS
const mint = (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: 'mint', frame: 'b', winBg: 'aurora' } }))
}
const size = (run: Running) => run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900))

const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const reading = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })
const web = (page: Page) => page.getByRole('complementary', { name: '网页' })

/** 左边功能按钮：拷贝 · 插进文档 · ⋯（窄了收成图标，名字还在 aria-label） */
async function leftIsSame(row: Locator) {
  await expect(row).toBeVisible()
  expect(await row.locator('[data-act]').evaluateAll((els) => els.map((e) => e.getAttribute('data-act')))).toEqual(['copy', 'insert', 'more'])
  await expect(row.getByRole('button', { name: '拷贝', exact: true })).toBeVisible()
  await expect(row.getByRole('button', { name: '插进文档', exact: true })).toBeVisible()
  await expect(row.locator('[data-act="more"]')).toBeVisible()
}

/** 右边快捷回复：排上的 + 放不下进 ⋯ 的（按顺序） */
async function replies(page: Page, row: Locator): Promise<string[]> {
  const shown = (await row.locator('[data-reply]').allInnerTexts()).map((s) => s.trim())
  if (!(await row.getAttribute('data-spill'))) return shown
  await row.locator('[data-act="more"]').click()
  const spill = (await page.locator('.cn-ab-menu [data-reply]').allInnerTexts()).map((s) => s.trim())
  await page.keyboard.press('Escape')
  await expect(page.locator('.cn-ab-menu')).toHaveCount(0)
  return [...shown, ...spill]
}

async function shot(el: Locator, name: string) {
  if (!SHOTS) return
  await el.page().evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await el.page().mouse.move(2, 2)
  await el.page().waitForTimeout(500)
  await el.screenshot({ path: join(SHOTS, `${name}.png`) })
}

test('AI 对话：回答下面 拷贝 · 插进文档 · ⋯ ｜ 还是不懂 · 换个方式讲', async () => {
  const run = await launch({ '学习笔记.md': '# 学习笔记\n\n第一段。\n' }, { CN_AI_FAKE: '1' }, mint)
  const { page } = run
  try {
    await size(run)
    await openNote(page, '学习笔记')
    await openAi(page)
    const box = chat(page).getByRole('textbox', { name: '问 AI' })
    await box.fill('讲讲线性映射')
    await box.press('Enter')
    await expect(chat(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 30_000 })
    const row = chat(page).getByTestId('ai-msg').last().getByTestId('ai-ans-acts')
    await leftIsSame(row)
    expect(await replies(page, row)).toEqual(['还是不懂', '换个方式讲'])
    await shot(chat(page), '1-chat')
  } finally {
    await run.close()
  }
})

let server: Server
let base: string
test.beforeAll(async () => {
  server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end('<!doctype html><html lang="en"><head><title>Rotation matrix</title></head><body style="font:18px/1.6 Georgia,serif;padding:24px;max-width:640px;background:#fff;color:#1b1b1b"><h1>Rotation matrix</h1><p id="p1">In linear algebra, a rotation matrix is a transformation matrix that is used to perform a rotation in Euclidean space.</p></body></html>')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
test.afterAll(() => server.close())

test('网页：框着问和直接打一句，回答下面都是 拷贝 · 插进文档 · ⋯ ｜ 还是不懂 · 换个方式讲（没有第三颗）', async () => {
  const run = await launch({ 'plain.md': `---\nread-along: ${base}/\n---\n# 随手\n` }, { CN_AI_FAKE: '1', CN_FAKE_NOTE_MS: '50' }, mint)
  const { page } = run
  const guest = (code: string) => page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code)
  try {
    await size(run)
    await rail(page).getByRole('button', { name: '网页' }).click()
    if (Math.round((await web(page).boundingBox())!.width) < 420) await widenRight(page, 80)
    const addr = web(page).getByRole('textbox', { name: '网址' })
    const u = `${base}/wiki/Rotation_matrix`
    await addr.fill(u)
    await addr.press('Enter')
    await expect.poll(() => guest('document.readyState + "|" + location.href')).toBe(`complete|${u}`)
    const w = (await web(page).locator('webview.on').boundingBox())!
    const r = JSON.parse(String(await guest(`JSON.stringify(document.getElementById('p1').getBoundingClientRect())`))) as { x: number; y: number; width: number; height: number }
    await page.keyboard.down('Meta')
    await page.mouse.move(w.x + r.x - 4, w.y + r.y - 4)
    await page.mouse.down()
    await page.mouse.move(w.x + r.x + r.width / 2, w.y + r.y + r.height / 2, { steps: 5 })
    await page.mouse.move(w.x + r.x + r.width + 4, w.y + r.y + r.height + 4, { steps: 5 })
    await page.mouse.up()
    await page.keyboard.up('Meta')
    const ai = reading(page)
    await ai.getByRole('textbox').press('Enter')
    await expect(ai.getByTestId('reading-msg')).toHaveCount(1)
    await expect(ai.getByRole('button', { name: '发送' })).toBeVisible({ timeout: 15_000 })
    const row1 = ai.getByTestId('reading-msg').last().getByTestId('reading-ans-acts')
    await leftIsSame(row1)
    expect(await replies(page, row1)).toEqual(['还是不懂', '换个方式讲'])
    // 再直接打一句（不框）：照样同一排
    const box = ai.getByRole('textbox', { name: '问 AI' })
    await box.fill('这一段在说什么')
    await box.press('Enter')
    await expect(ai.getByTestId('reading-msg')).toHaveCount(2)
    await expect(ai.getByRole('button', { name: '发送' })).toBeVisible({ timeout: 15_000 })
    const row2 = ai.getByTestId('reading-msg').last().getByTestId('reading-ans-acts')
    await leftIsSame(row2)
    expect(await replies(page, row2)).toEqual(['还是不懂', '换个方式讲'])
    await shot(ai, '2-web')
  } finally {
    await run.close()
  }
})

test('读 PDF：回答下面 拷贝 · 插进文档 · ⋯ ｜ 还是不懂 · 换个方式讲 · 做个可视化', async () => {
  const PDF = '课程/线性代数/第3讲 线性映射.pdf'
  const run = await launch({ [PDF]: LECTURE }, { CN_AI_FAKE: '1' }, mint)
  const { page } = run
  try {
    await size(run)
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
    await page.locator('.pal-row', { hasText: '第3讲 线性映射' }).first().click()
    await expect(tabOn(page)).toHaveText('第3讲 线性映射.pdf')
    await expect(page.locator('.pdfpane:not([hidden]) .pdfpage[data-page="1"] canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
    await openAi(page)
    const ai = reading(page)
    await expect(ai.getByTestId('reading-sees')).toContainText('读过全文5页')
    const box = ai.getByRole('textbox', { name: '问 AI' })
    await box.fill('给我讲解一下这一页')
    await box.press('Enter')
    await expect(ai.getByTestId('reading-msg')).toHaveCount(1)
    await expect(ai.getByRole('button', { name: '发送' })).toBeVisible({ timeout: 15_000 })
    const row = ai.getByTestId('reading-msg').last().getByTestId('reading-ans-acts')
    await leftIsSame(row)
    expect(await replies(page, row)).toEqual(['还是不懂', '换个方式讲', '做个可视化'])
    await shot(ai, '3-pdf')
  } finally {
    await run.close()
  }
})

test.describe('视频', () => {
  let vserver: Server
  let vbase: string
  test.beforeAll(async () => {
    ;({ server: vserver, base: vbase } = await startFakeVideoSite())
  })
  test.afterAll(() => vserver.close())

  test('视频问框：回答下面 拷贝 · 插进文档 · ⋯ ｜ 还是不懂 · 换个方式讲', async () => {
    test.setTimeout(120_000)
    const NOTE = '看视频的笔记.md'
    const run = await launch({ [NOTE]: '# 看视频的笔记\n\n我先写的一句。\n' }, { CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '150', CN_AI_FAKE_ASK_MS: '800', CN_VIDEO_TEST_ORIGIN: vbase }, mint)
    const { page } = run
    const vguest = (code: string) => page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code)
    try {
      await size(run)
      await openNote(page, '看视频的笔记')
      await rail(page).getByRole('button', { name: '网页', exact: true }).click()
      const addr = web(page).getByRole('textbox', { name: '网址' })
      await addr.fill(`${vbase}/watch?v=${FAKE_VIDEO_ID}`)
      await addr.press('Enter')
      await expect(web(page).getByRole('region', { name: '视频条' })).toBeVisible({ timeout: 15_000 })
      await vguest(`(() => { const v = document.querySelector('video'); v.currentTime = 6; v.pause(); return true })()`)
      await page.waitForTimeout(400)
      await pane(page).getByText('我先写的一句。').click()
      await page.keyboard.press('Alt+KeyD')
      await expect.poll(() => vguest(`!!document.getElementById('cn-video-host').shadowRoot.querySelector('.box')`)).toBe(true)
      const wv = (await web(page).locator('webview.on').boundingBox())!
      await page.mouse.move(wv.x + 40, wv.y + 30)
      await page.mouse.down()
      await page.mouse.move(wv.x + 200, wv.y + 120, { steps: 6 })
      await page.mouse.up()
      const ask = web(page).getByRole('dialog', { name: '问 AI' })
      await expect(ask).toBeVisible()
      await ask.getByRole('textbox', { name: '想问什么' }).press('Enter')
      await expect(ask.getByTestId('ak-answer').first()).not.toBeEmpty({ timeout: 15_000 })
      const row = ask.getByTestId('ak-ans-acts')
      await leftIsSame(row)
      expect(await replies(page, row)).toEqual(['还是不懂', '换个方式讲'])
      await shot(ask, '4-video')
    } finally {
      await run.close()
    }
  })
})
