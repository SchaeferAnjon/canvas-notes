// 交付截图（task-2onrm）：PDF 页边问过的标记放进纸面（B 纸面内一列）。真软件、临时库、假 AI；改前改后同一个脚本。
// CN_SHOTS=<目录> CN_PAPER=<两栏论文.pdf> CN_TAG=前|后 npx playwright test e2e/2onrm-shots.spec.ts
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, rail, type Running } from './app'

const DIR = process.env.CN_SHOTS
const TAG = process.env.CN_TAG ?? '后'
test.skip(!DIR || !process.env.CN_PAPER, '交付截图：CN_SHOTS、CN_PAPER 才跑')
test.setTimeout(300_000)

const PDF = '论文/driver-stress.pdf'
const pdfPane = (page: Page) => page.locator('.pdfpane:not([hidden])')
const pdfPage = (page: Page, n: number) => pdfPane(page).locator(`.pdfpage[data-page="${n}"]`)
const ai = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })

async function shot(run: Running, name: string) {
  await run.page.waitForTimeout(400)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(DIR!, `${name}.png`), Buffer.from(b64, 'base64'))
}

async function ask(page: Page, a: [number, number], b: [number, number]) {
  const before = await ai(page).locator('.um-wrap').count()
  const box = (await pdfPage(page, 1).boundingBox())!
  await page.keyboard.down('Meta')
  await page.mouse.move(box.x + box.width * a[0], box.y + box.height * a[1])
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * b[0], box.y + box.height * b[1], { steps: 6 })
  await page.mouse.up()
  await page.keyboard.up('Meta')
  const input = ai(page).getByRole('textbox', { name: '问 AI' })
  await expect(input).toBeFocused()
  await input.press('Enter')
  await expect(ai(page).locator('.um-wrap')).toHaveCount(before + 1)
  await expect(ai(page).getByTestId('reading-msg').last().locator('.noted')).toContainText('已记进笔记', { timeout: 20_000 })
}

/** 改后：悬停竖条上第 2 处（右栏中间挨着的第一块）；改前：点「+N」 */
async function openList(page: Page) {
  const col = pdfPane(page).locator('.mkcol').first()
  if (await col.count()) {
    const tick = col.locator('.tick').nth(1)
    const b = (await tick.boundingBox())!
    await page.mouse.move(b.x + b.width / 2, b.y + Math.min(6, b.height / 2))
    await expect(pdfPane(page).getByRole('menu', { name: /问过/ })).toBeVisible()
    // 列表和指着的那处框：交付页写数（列表上沿离框下沿多远）
    const r = await pdfPane(page).evaluate((el) => {
      const m = el.querySelector('.mkcard')!.getBoundingClientRect()
      const f = el.querySelector('.fr.asked.show')!.getBoundingClientRect()
      return { cardTop: Math.round(m.top), frameTop: Math.round(f.top), frameBottom: Math.round(f.bottom), gap: Math.round(m.top - f.bottom) }
    })
    writeFileSync(join(DIR!, `${TAG}-列表位置-${Date.now()}.json`), JSON.stringify(r))
  } else {
    await pdfPane(page).getByRole('button', { name: /第 1 页还有 \d 处问过/ }).click()
  }
}

const LOOKS = [
  ['sky', '天青'],
  ['petrol', '深湖'],
] as const

for (const [skin, name] of LOOKS) {
  test(`页边标记交付图：${name}`, async () => {
    mkdirSync(DIR!, { recursive: true })
    const run = await launch({ [PDF]: readFileSync(process.env.CN_PAPER!) }, { CN_AI_FAKE: '1' }, (vault) => {
      const ud = join(dirname(vault), 'user-data')
      mkdirSync(ud, { recursive: true })
      writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin, frame: 'b', winBg: 'aurora' } }))
    })
    const { page } = run
    try {
      await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
      await page.keyboard.press('Meta+k')
      await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('driver-stress')
      await page.locator('.pal-row', { hasText: 'driver-stress' }).first().click()
      await expect(pdfPage(page, 1).locator('canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
      await rail(page).getByRole('button', { name: '打开 AI' }).click()
      await expect(ai(page)).toBeVisible()
      await page.waitForTimeout(600)
      // 五处：左栏摘要一块、右栏挨着的三块、右栏下面一块（同 27-PDF页边标记 设计页）
      await ask(page, [0.09, 0.2], [0.49, 0.3])
      await ask(page, [0.51, 0.36], [0.91, 0.42])
      await ask(page, [0.51, 0.385], [0.91, 0.45])
      await ask(page, [0.51, 0.405], [0.91, 0.5])
      await ask(page, [0.51, 0.68], [0.91, 0.76])
      await pdfPane(page).locator('.pdfv').evaluate((el) => (el.scrollTop = 0))
      await page.mouse.move(10, 400)
      await shot(run, `${TAG}-1默认-${skin}`)
      // 纸左右留白（这一栏看得见的那块里）记下来，交付页写数
      const g = await pdfPane(page).locator('.pdfv').evaluate((el: HTMLElement) => {
        const v = el.getBoundingClientRect()
        const s = el.querySelector('.pdfslot')!.getBoundingClientRect()
        return { left: Math.round(s.left - v.left), right: Math.round(v.right - s.right), scrollbar: el.offsetWidth - el.clientWidth }
      })
      writeFileSync(join(DIR!, `${TAG}-留白-${skin}.json`), JSON.stringify(g))
      await openList(page)
      await shot(run, `${TAG}-2展开-${skin}`)
      await page.mouse.move(10, 400)
      await page.keyboard.press('Escape')
      // 放大三档（⌘=）：纸比栏宽
      await pdfPane(page).locator('.pdfv').focus()
      for (let i = 0; i < 3; i++) await page.keyboard.press('Meta+Equal')
      await page.waitForTimeout(900)
      await pdfPane(page).locator('.pdfv').evaluate((el) => (el.scrollTop = 0))
      await page.mouse.move(10, 400)
      await shot(run, `${TAG}-3放大-${skin}`)
      await openList(page)
      await shot(run, `${TAG}-4放大展开-${skin}`)
      await page.mouse.move(10, 400)
    } finally {
      await run.close()
    }
  })
}
