/**
 * 交付对照图（AI 对话记笔记开关，task-g2qg9）：同一串操作在改前（开发版）、改后两个版本上各跑一遍，整窗截下来。
 * 只在截交付图时跑：CN_SHOTS=目录，CN_SHOT_SKIN=mint|petrol（薄荷 / 深湖，B 浮岛书桌），CN_SHOT_TAG=before|after（文件名前缀）。平时跳过。
 * 在 PDF 上框一块问一句、接着问一句 → AI 那一格、配对笔记的文档看法、白板看法、右栏「笔记」；再开一篇文档看 AI 那一格。
 */
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { acts, launch, openAi, openNote, pane, tabOn, type Running } from './app'
import { LECTURE } from './fixtures/pdf'

const DIR = process.env.CN_SHOTS
const SKIN = process.env.CN_SHOT_SKIN ?? 'mint'
const TAG = process.env.CN_SHOT_TAG ?? 'after'
test.skip(!DIR, '只在截交付图时跑（CN_SHOTS=目录）')

const PDF = '课程/线性代数/第3讲 线性映射.pdf'
const NOTE = '课程/线性代数/第3讲 线性映射 笔记.md'
const files = { [PDF]: LECTURE, '写作/组会准备.md': '# 组会准备\n\n下周讲 LIF 神经元。\n' }

const look = (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: SKIN, frame: 'b' } }))
}
const ai = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })
const pdfPage = (page: Page, n: number) => page.locator(`.pdfpane:not([hidden]) .pdfpage[data-page="${n}"]`)
const askBox = (page: Page) => ai(page).getByRole('textbox', { name: '问 AI' })

async function shot(run: Running, name: string) {
  await run.page.waitForTimeout(500)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(DIR!, `${TAG}-${name}-${SKIN}.png`), Buffer.from(b64, 'base64'))
}

/** 笔记里有了这一问、提交好了 */
async function noted(run: Running, q: string) {
  await expect
    .poll(
      () => {
        let text = ''
        try {
          text = readFileSync(join(run.vault, NOTE), 'utf8')
        } catch {
          return false
        }
        const st = execFileSync('git', ['-C', run.vault, 'status', '--porcelain'], { encoding: 'utf8' })
        return text.includes(q) && !st.includes('笔记.md')
      },
      { timeout: 60_000 },
    )
    .toBe(true)
}

test('改前改后：读 PDF 问两句、笔记文档 / 白板 / 右栏、文档的 AI 那一格', async () => {
  test.setTimeout(240_000)
  mkdirSync(DIR!, { recursive: true })
  const run = await launch(files, { CN_AI_FAKE: '1', CN_FAKE_SAY_MS: '60' }, look)
  const { page } = run
  try {
    await page.keyboard.press('Meta+k')
    await page.getByRole('dialog', { name: '搜索和命令' }).getByRole('textbox').fill('第3讲')
    await page.locator('.pal-row', { hasText: '第3讲 线性映射' }).first().click()
    await expect(tabOn(page)).toHaveText('第3讲 线性映射.pdf')
    await expect(pdfPage(page, 1).locator('canvas[data-ready="1"]')).toBeAttached({ timeout: 20_000 })
    await openAi(page)
    await expect(ai(page).getByTestId('reading-sees')).toContainText('读过全文', { timeout: 20_000 })
    // 框第 1 页上半块，问一句
    const r = (await pdfPage(page, 1).boundingBox())!
    await page.mouse.move(r.x + r.width * 0.08, r.y + r.height * 0.1)
    await page.mouse.down()
    await page.mouse.move(r.x + r.width * 0.9, r.y + r.height * 0.32, { steps: 6 })
    await page.mouse.up()
    await askBox(page).fill('这一块讲的是什么？')
    await askBox(page).press('Enter')
    await noted(run, '这一块讲的是什么？')
    await askBox(page).fill('那和矩阵有什么关系？')
    await askBox(page).press('Enter')
    await noted(run, '那和矩阵有什么关系？')
    await page.waitForTimeout(1500)
    await shot(run, 'pdf-ai')
    // 配对笔记：文档看法、白板看法
    await openNote(page, '第3讲 线性映射 笔记')
    await pane(page).locator('.cm-content').evaluate((el) => el.scrollIntoView())
    await shot(run, 'note-doc')
    await acts(page).getByRole('tab', { name: '白板' }).click()
    await expect(pane(page).locator('[data-testid="doc-board"]')).toBeVisible()
    await page.waitForTimeout(800)
    await shot(run, 'note-board')
    // 一篇文档开着时的 AI 那一格（改后：记笔记那一排，默认关）
    await acts(page).getByRole('tab', { name: '文档' }).click()
    await openNote(page, '组会准备')
    await openAi(page)
    await page.waitForTimeout(800)
    await shot(run, 'doc-ai')
  } finally {
    await run.close()
  }
})
