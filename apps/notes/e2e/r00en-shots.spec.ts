/**
 * 交付对照图（task-r00en）：只在截交付图时跑：CN_SHOTS=目录，CN_SHOT_TONE=dark 截深湖（不给是天青），CN_SHOT_STAGE=before|after（文件名前缀）。平时跳过。
 * 1 slash：文档里打 /，不打字时的斜杠菜单（基本一组）
 * 2 ans-more：AI 回答下面那排，⋯ 打开（before 没有 ⋯，截同一处）
 * 3 drag-tree：课件封面拖着停在左栏「ml」上
 * 4 drag-tab：「笔记和导图」里一篇拖着停在「ml」首页的标签上
 * 5 move-picker：缩略图右键「移到…」弹的小弹层（只有 after）
 */
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, openAi, openNote, pane, type Running } from './app'
import { lecturePdf } from './fixtures/pdf'
import { armMenus, pickMenu } from './menu'

const DIR = process.env.CN_SHOTS
const DARK = process.env.CN_SHOT_TONE === 'dark'
const STAGE = process.env.CN_SHOT_STAGE ?? 'after'
test.skip(!DIR, '只在截交付图时跑（CN_SHOTS=目录）')

const tone = DARK ? 'dark' : 'light'
const look = (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: DARK ? 'petrol' : 'sky', frame: 'b', winBg: 'aurora' } }))
}
type Rect = { x: number; y: number; width: number; height: number }

async function shot(run: Running, name: string, clip?: Rect) {
  await run.page.waitForTimeout(clip ? 300 : 700)
  const r = clip && { x: Math.max(0, Math.round(clip.x)), y: Math.max(0, Math.round(clip.y)), width: Math.round(clip.width), height: Math.round(clip.height) }
  const b64 = await run.app.evaluate(async ({ BrowserWindow }, c) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage(c ?? undefined)).toPNG().toString('base64'), r)
  writeFileSync(join(DIR!, `${STAGE}-${name}-${tone}.png`), Buffer.from(b64, 'base64'))
}
async function size(run: Running) {
  await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
  await expect.poll(() => run.page.evaluate(() => innerHeight)).toBe(887)
}

test('对照图 1、2：斜杠菜单不打字；AI 回答下面那排的 ⋯', async () => {
  const run = await launch({ '贴士.md': '# 贴士\n\n开头。\n' }, { CN_AI_FAKE: '1' }, look)
  const { page } = run
  try {
    await size(run)
    await openNote(page, '贴士')
    await pane(page).locator('.cm-line', { hasText: '开头。' }).click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.type('/')
    const menu = page.locator('.slash-menu')
    await expect(menu).toBeVisible()
    // 滚到提示块那几行（改前只有「说明」一行，改后 5 种挨着）
    await menu.getByRole('option', { name: /提示块 · 说明/ }).evaluate((el) => el.scrollIntoView({ block: 'start' }))
    const m = (await menu.boundingBox())!
    await shot(run, 'slash', { x: m.x - 24, y: m.y - 60, width: m.width + 48, height: m.height + 84 })
    await page.keyboard.press('Escape')
    await page.keyboard.press('Backspace')

    await openAi(page)
    const chat = page.getByRole('complementary', { name: 'AI 对话' })
    const box = chat.getByRole('textbox', { name: '问 AI' })
    await box.fill('把这周总结成三句话')
    await box.press('Enter')
    await expect(chat.getByRole('button', { name: '发送' })).toBeVisible({ timeout: 30_000 })
    const msg = chat.getByTestId('ai-msg').last()
    await expect(msg).not.toHaveAttribute('aria-busy')
    const row = msg.getByTestId('ai-ans-acts')
    const more = row.getByRole('button', { name: '这条回答还能做什么' })
    if (await more.count()) {
      await more.click()
      await expect(page.getByRole('menu', { name: '这条回答还能做什么' })).toBeVisible()
      await page.getByRole('menu', { name: '这条回答还能做什么' }).getByRole('menuitem').hover()
    } else await msg.hover()
    const p = (await chat.boundingBox())!
    const mb = (await msg.boundingBox())!
    await shot(run, 'ans-more', { x: p.x, y: mb.y - 16, width: p.width, height: 250 })
  } finally {
    await run.close()
  }
})

const NOTE = '# Lecture03 笔记\n\n## 第 2 页 · 近似计算\n[第 2 页](Lecture03.pdf#page=2) · 10:20\n\n> [!question] 我的疑惑\n> 为什么省电\n\n[完整对话 · 1 轮](../../.canvas-notes/对话/Lecture03-p2-1.md)\n'
const slidePdf = (title: string) => lecturePdf([{ title, lines: ['Approximate computing trades accuracy for energy.'], image: { x: 320, y: 300, w: 220, h: 160 } }, { title: `${title} (2)`, lines: ['More.'] }])
const VAULT = {
  '课程/ecp/Lecture03.pdf': slidePdf('Approximate Computing'),
  '课程/ecp/Lecture04.pdf': slidePdf('Analog Computing'),
  '课程/ecp/Lecture03 笔记.md': NOTE,
  '课程/ecp/讲义.md': '---\n类型: 笔记\n---\n# 讲义\n\n第一段。\n',
  '课程/ml/作业/.gitkeep': '',
}
const tree = (page: Page) => page.locator('aside.side').getByRole('tree', { name: '全部文件' })
const row = (page: Page, path: string) => tree(page).locator(`[role="treeitem"][data-path="${path}"]`)
const home = (page: Page) => page.getByTestId('folder-home')
const center = async (l: ReturnType<Page['locator']>) => {
  const b = (await l.boundingBox())!
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}
async function hold(page: Page, at: ReturnType<Page['locator']>, ms: number) {
  const p = await center(at)
  await page.mouse.move(p.x, p.y, { steps: 5 })
  for (let t = 0; t < ms; t += 60) {
    await page.waitForTimeout(60)
    await page.mouse.move(p.x + ((t / 60) % 2 ? 1 : 0), p.y)
  }
}

test('对照图 3、4、5：课件封面拖到左栏文件夹上；笔记拖到别的课程首页标签上；缩略图右键「移到…」', async () => {
  const run = await launch(VAULT, {}, look)
  const { page } = run
  try {
    await size(run)
    await page.getByRole('navigation', { name: '左栏' }).getByRole('button', { name: '文件', exact: true }).click()
    const c = row(page, '课程')
    if ((await c.getAttribute('aria-expanded')) !== 'true') await c.getByRole('button', { name: '展开 课程', exact: true }).click()
    await row(page, '课程/ml').click()
    await expect(home(page)).toHaveAttribute('data-folder', '课程/ml')
    await row(page, '课程/ecp').click()
    await expect(home(page)).toHaveAttribute('data-folder', '课程/ecp')
    const cover = home(page).getByTestId('slide-cover').first()
    await expect(cover.locator('img')).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(500)

    // 3：封面拖着停在「ml」上（停 0.3 秒，还没展开）
    let s = await center(cover)
    await page.mouse.move(s.x, s.y)
    await page.mouse.down()
    await page.mouse.move(s.x + 12, s.y + 12, { steps: 4 })
    await hold(page, row(page, '课程/ml'), 300)
    await shot(run, 'drag-tree')
    await page.keyboard.press('Escape')
    await page.mouse.up()
    await page.waitForTimeout(400)

    // 4：「笔记和导图」里的「讲义」拖着停在「ml」首页的标签上
    const note = home(page).locator('[data-testid^="fw-"] .fw-row', { hasText: '讲义' }).first()
    await note.scrollIntoViewIfNeeded()
    s = await center(note)
    await page.mouse.move(s.x, s.y)
    await page.mouse.down()
    await page.mouse.move(s.x + 10, s.y + 10, { steps: 4 })
    await hold(page, page.getByTestId('tab-list').getByRole('tab').filter({ hasText: /^ml$/ }), 300)
    await shot(run, 'drag-tab')
    await page.keyboard.press('Escape')
    await page.mouse.up()
    await page.waitForTimeout(400)

    // 5：缩略图右键「移到…」
    if (STAGE === 'after') {
      await cover.scrollIntoViewIfNeeded()
      await armMenus(run)
      await cover.click({ button: 'right' })
      await pickMenu(run, '移到…')
      await expect(page.getByRole('dialog', { name: '移到' })).toBeVisible()
      await shot(run, 'move-picker')
    }
  } finally {
    await run.close()
  }
})
