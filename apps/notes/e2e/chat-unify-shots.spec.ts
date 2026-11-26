/**
 * 对照图（家族对话框样式统一，MeetCaption、ParaRead 换成和画布笔记一样的对话框）：读 PDF 的 AI 那一栏，右栏 400 宽，截三个状态：
 * 空对话、选 PDF 里一句问一次答一次（输入框里引用那一句、发出去带引用）、AI 没答出来。截的是 AI 那一栏，三个软件的图拼在一起比。
 * 只在截图时跑：CN_SHOTS=目录，CN_SHOT_TONE=dark 截深色（默认主题：白天薄荷、夜里松林）。平时跳过。
 */
import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, openAi, tabOn, widenRight } from './app'
import { LECTURE } from './fixtures/pdf'

const DIR = process.env.CN_SHOTS
const DARK = process.env.CN_SHOT_TONE === 'dark'
test.skip(!DIR, '只在截对照图时跑（CN_SHOTS=目录）')

const pdfPane = (page: Page) => page.locator('.pdfpane:not([hidden])')
const pdfPage = (page: Page, n: number) => pdfPane(page).locator(`.pdfpage[data-page="${n}"]`)

async function shot(col: Locator, name: string) {
  const page = col.page()
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
  await page.mouse.move(700, 450)
  await page.waitForTimeout(1500)
  await col.screenshot({ path: join(DIR!, `cn-${name}-${DARK ? 'dark' : 'light'}.png`) })
}

test('对照图：读 PDF 的 AI 一栏', async () => {
  test.setTimeout(240_000)
  mkdirSync(DIR!, { recursive: true })
  const run = await launch({ '课程/线代/第3讲.pdf': LECTURE }, { CN_AI_FAKE: '1', CN_FAKE_SAY_MS: '1' }, (vault) => {
    const ud = join(dirname(vault), 'user-data')
    mkdirSync(ud, { recursive: true })
    writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: DARK ? 'pine' : 'mint' } }))
  })
  const { page } = run
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 860))
    await page.evaluate(() => {
      const t0 = Date.now()
      Date.now = () => t0
    })
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
    await page.locator('.pal-row', { hasText: '第3讲' }).first().click()
    await expect(tabOn(page)).toHaveText('第3讲.pdf')
    await expect(pdfPage(page, 1).locator('canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
    await openAi(page)
    const col = page.getByRole('complementary', { name: '边读边问 AI' })
    const now = (await col.boundingBox())!.width
    await widenRight(page, 400 - now)
    await page.waitForTimeout(300)
    await shot(col, '1-empty')

    // PDF 里选一句，「讲解一下」：输入框顶上是这一句
    const span = pdfPage(page, 2).locator('.textLayer span', { hasText: 'for every scalar c' }).first()
    await span.evaluate((e) => e.scrollIntoView({ block: 'center' }))
    await page.waitForTimeout(200)
    const cap = pdfPane(page).getByRole('toolbar', { name: '框好的这块' })
    const pick = async () => {
      const sb = (await span.boundingBox())!
      await page.mouse.move(sb.x + 2, sb.y + sb.height / 2)
      await page.mouse.down()
      await page.mouse.move(sb.x + sb.width - 2, sb.y + sb.height / 2, { steps: 6 })
      await page.mouse.up()
      await expect(cap).toBeVisible()
    }
    // 选一句「引用」：输入框顶上一张（引用的那一句），打问法
    await pick()
    await cap.getByRole('button', { name: /^引用/ }).click()
    await expect(col.getByTestId('ai-mat')).toHaveCount(1)
    const ta = col.getByRole('textbox', { name: '问 AI' })
    await ta.fill('这一句什么意思？')
    await shot(col, '2-quote')
    await col.getByTestId('ai-mat').locator('.pxx').click()
    await ta.fill('')

    // 选一句直接「讲解一下」：发出去那条上面是引用的那一句（「…」），答完回答下面那排
    await pick()
    await cap.getByRole('button', { name: /讲解一下/ }).click()
    await expect(col.getByTestId('reading-msg').last()).toContainText('列就是基向量去哪', { timeout: 30_000 })
    await expect(col.getByTestId('reading-ans-acts').last()).toBeVisible({ timeout: 20_000 })
    await shot(col, '3-answer')

    // AI 没答出来
    await ta.fill('假装被拦')
    await ta.press('Enter')
    await expect(col.locator('.aierr').last()).toBeVisible({ timeout: 30_000 })
    await col.locator('.msgs').evaluate((e) => (e.scrollTop = e.scrollHeight))
    await shot(col, '4-error')
  } finally {
    await run.close()
  }
})
