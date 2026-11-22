// 出卡送 Anki（task-tz7y3）的对照图：真软件走一遍方向 B 原型里的几个样子，1440 × 887、浮岛书桌，浅色天青 / 深色深湖（CN_SHOT_TONE=dark）。
// 平时跳过；截图：CN_SHOTS=<目录> npx playwright test e2e/r24-anki-shots.spec.ts
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { launch, leftView, rail, type Running, tabOn, widenRight } from './app'
import { ankiVault, fakeAnki, weekVault } from './fixtures/anki'

const DIR = process.env.CN_SHOTS
const DARK = process.env.CN_SHOT_TONE === 'dark'
test.skip(!DIR, '只在截对照图时跑（CN_SHOTS=目录）')

async function shot(run: Running, name: string) {
  await run.page.waitForTimeout(500)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(DIR!, `${name}-${DARK ? 'dark' : 'light'}.png`), Buffer.from(b64, 'base64'))
}
/** 「在哪」图：给这几样各画一个红色编号框（一个选择器对上几样，框住它们全部） */
async function mark(page: Page, sels: string[]) {
  await page.evaluate((sels) => {
    sels.forEach((sel, i) => {
      const rs = [...document.querySelectorAll(sel)].map((e) => e.getBoundingClientRect())
      if (!rs.length) return
      const l = Math.min(...rs.map((x) => x.left))
      const t = Math.min(...rs.map((x) => x.top))
      const r = { left: l, top: t, width: Math.max(...rs.map((x) => x.right)) - l, height: Math.max(...rs.map((x) => x.bottom)) - t }
      const b = document.createElement('div')
      b.className = 'where-mark'
      Object.assign(b.style, { position: 'fixed', left: `${r.left - 4}px`, top: `${r.top - 4}px`, width: `${r.width + 8}px`, height: `${r.height + 8}px`, border: '2px solid #e0362c', borderRadius: '6px', zIndex: '9999', pointerEvents: 'none' })
      b.innerHTML = `<b style="position:absolute;left:-12px;top:-12px;width:22px;height:22px;border-radius:50%;background:#e0362c;color:#fff;font:600 13px/22px sans-serif;text-align:center">${i + 1}</b>`
      document.body.appendChild(b)
    })
  }, sels)
}
const unmark = (page: Page) => page.evaluate(() => document.querySelectorAll('.where-mark').forEach((e) => e.remove()))
/** 浮岛书桌，浅色天青 / 深色深湖 */
const look = (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: DARK ? 'petrol' : 'sky', frame: 'b', winBg: 'aurora' } }))
}
const dlg = (page: Page) => page.getByRole('dialog', { name: '出卡' })
const notes = (page: Page) => page.getByRole('complementary', { name: '笔记', exact: true })

test('出卡的几个样子', async () => {
  test.setTimeout(180_000)
  const anki = await fakeAnki()
  // Anki 装好了（假的 Anki.app、插件文件夹）：Anki 没开时是「Anki没开着」那一行、带「打开Anki」
  const inst = mkdtempSync(join(tmpdir(), 'cn-anki-'))
  mkdirSync(join(inst, 'Anki.app/Contents'), { recursive: true })
  writeFileSync(join(inst, 'Anki.app/Contents/Info.plist'), '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>25.09</string></dict></plist>')
  mkdirSync(join(inst, 'addons21/2055492159'), { recursive: true })
  const run = await launch(ankiVault(), { CN_AI_FAKE: '1', CN_ANKI_URL: anki.url, CN_FAKE_CARD_MS: '400', CN_ANKI_APP: join(inst, 'Anki.app'), CN_ANKI_ADDONS: join(inst, 'addons21') }, look)
  const { page, app } = run
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('Lecture05')
    await page.locator('.pal-row', { hasText: 'Lecture05.pdf' }).first().click()
    await expect(tabOn(page)).toHaveText('Lecture05.pdf')
    await rail(page).getByRole('button', { name: '笔记' }).click()
    await notes(page).getByRole('tab', { name: '只看我问的' }).click()
    await shot(run, 'b0-asked')
    // 右栏窄到 300：筛选那一行和「出卡 · 6问」挤不挤
    await widenRight(page, -80)
    await shot(run, 'b0-narrow')
    await widenRight(page, 80)
    // 出卡：AI 在改写
    await notes(page).getByRole('button', { name: /^出卡 · / }).click()
    await expect(dlg(page).locator('.dh .sub')).toHaveText(/^AI 在改写/)
    await page.waitForTimeout(300)
    await shot(run, 'b1-drafting')
    await expect(dlg(page).locator('.dh .sub')).toHaveText(/^改好了/, { timeout: 20_000 })
    await shot(run, 'b2-review')
    // → 第 2 张不送，第 3 张按 E 改
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press(' ')
    await page.keyboard.press('e')
    await page.keyboard.press('Meta+a')
    await page.keyboard.type('LIF 里 τ 变大，神经元会怎样？（改过）')
    await shot(run, 'b3-edit')
    await page.keyboard.press('Enter')
    await dlg(page).getByRole('button', { name: /^送进Anki · / }).click()
    await expect(page.getByTestId('toast')).toContainText('已送进Anki')
    await shot(run, 'b4-sent')
    // 「在哪」图：笔记栏右上「出卡」、说明一句、送过的「已送」、提示条，各画一个编号框
    await mark(page, ['[data-testid="cards-open"]', '.reading-notes .cards-hint', '.reading-notes .qonly .st', '[data-testid="toast"]'])
    await shot(run, 'where')
    await unmark(page)
    // 再出卡：送过的虚线带绿点
    await notes(page).getByRole('button', { name: /^出卡 · / }).click()
    await expect(dlg(page).locator('.dh .sub')).toHaveText(/^改好了/, { timeout: 20_000 })
    await page.keyboard.press('ArrowRight')
    await shot(run, 'b5-again')
    await page.keyboard.press('Escape')
    // 问题条上「做成卡」
    await notes(page).getByRole('tab', { name: '全部' }).click()
    await notes(page).locator('.rnd.fold .fh', { hasText: 'LIF 神经元的三条公式' }).click()
    const bar = notes(page).locator('.rnd:not(.fold) .nside .qs').first()
    await bar.hover()
    await bar.getByRole('button', { name: '做成卡' }).click()
    await expect(page.getByRole('dialog', { name: '做成卡' }).locator('.paper')).toBeVisible({ timeout: 15_000 })
    await shot(run, 'b6-spot')
    await page.keyboard.press('Escape')
    // 课程首页
    await leftView(page, '课程')
    await page.locator('aside.side').getByRole('treeitem').filter({ has: page.locator('.truncate', { hasText: /^ecp$/ }) }).click()
    await expect(page.getByTestId('fw-doubts')).toBeVisible()
    await shot(run, 'b7-course')
    await page.getByTestId('fw-doubts').scrollIntoViewIfNeeded()
    await shot(run, 'b7-course-card')
    // ⌘K 打 anki
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('anki')
    await page.waitForTimeout(600)
    await shot(run, 'b8-cmdk')
    await page.keyboard.press('Escape')
    // 设置 › 读PDF
    await page.keyboard.press('Meta+,')
    const set = page.getByRole('dialog', { name: '设置' })
    await set.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: '读PDF', exact: true }).click()
    await set.locator('[data-row="ankiAll"]').scrollIntoViewIfNeeded()
    await shot(run, 'b9-settings')
    await page.keyboard.press('Escape')
    // Anki 没开
    anki.down = true
    await notes(page).isVisible()
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('出卡')
    await page.locator('.pal-row', { hasText: '出卡：这门课 ecp 没送的' }).click()
    await expect(dlg(page).locator('.dh .sub')).toHaveText(/^改好了/, { timeout: 20_000 })
    await dlg(page).getByRole('button', { name: /^送进Anki · / }).click()
    await expect(dlg(page).locator('.warnrow')).toBeVisible()
    await dlg(page).locator('.warnrow').getByRole('button', { name: '怎么装' }).click()
    await shot(run, 'b10-off')
  } finally {
    await run.close()
    await anki.close()
    rmSync(inst, { recursive: true, force: true })
  }
})

test('牌组跟着目录来的样子', async () => {
  test.setTimeout(120_000)
  const anki = await fakeAnki()
  const run = await launch(weekVault(), { CN_AI_FAKE: '1', CN_ANKI_URL: anki.url, CN_FAKE_CARD_MS: '0' }, look)
  const { page, app } = run
  try {
    const size = (w: number, h: number) => app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0]!.setContentSize(w!, h!), [w, h])
    await size(1440, 887)
    // 左栏「课程」：开 ecp 的课程首页，展开 ecp › Week 2 › 补充材料，看得见两份 PDF 各在哪个文件夹
    await leftView(page, '课程')
    const side = page.locator('aside.side')
    await side.getByRole('treeitem').filter({ has: page.locator('.truncate', { hasText: /^ecp$/ }) }).click()
    await expect(page.getByTestId('fw-doubts')).toBeVisible()
    for (const name of ['ecp', 'Week 2', '补充材料']) {
      const tw = side.getByRole('button', { name: `展开 ${name}` })
      if (await tw.isVisible()) await tw.click()
    }
    // 课程首页「出卡 · 没送的8问」（Week 2 的 6 问、Week 2/补充材料 的 2 问），送
    await page.getByTestId('fw-doubts').getByRole('button', { name: /^出卡 · 没送的/ }).click()
    await expect(dlg(page).locator('.dh .sub')).toHaveText(/^改好了/, { timeout: 20_000 })
    await dlg(page).getByRole('button', { name: /^送进Anki · / }).click()
    await expect(page.getByTestId('toast')).toContainText('和下面的「补充材料」')
    // 「在哪」：左栏里 Week 2 那一枝（两份 PDF 在哪个文件夹）、提示条里进了哪两个牌组
    await mark(page, ['aside.side [data-path^="课程/ecp/Week 2"]', '[data-testid="toast"]'])
    await shot(run, 'deck-where')
    await unmark(page)
    // 窗口窄到 1000：提示条的字截短带省略号，「打开Anki」「撤回」照样完整
    await size(1000, 700)
    await page.getByTestId('toast').hover()
    await shot(run, 'deck-where-narrow')
    await size(1440, 887)
    // 设置 › 读PDF「送进哪个牌组」和它上下几行
    await page.keyboard.press('Meta+,')
    const set = page.getByRole('dialog', { name: '设置' })
    await set.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: '读PDF', exact: true }).click()
    await set.locator('[data-row="ankiDeck"]').scrollIntoViewIfNeeded()
    await mark(page, ['[data-row="ankiDeck"]'])
    await shot(run, 'deck-settings')
  } finally {
    await run.close()
    await anki.close()
  }
})
