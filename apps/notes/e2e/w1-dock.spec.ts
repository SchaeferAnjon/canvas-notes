/**
 * 工作区方向 A「拖到哪就在哪」（task-9okg5，原型 design/workspace/proto-a.html、a-clicks.json）：
 * 右栏里网页、笔记、AI 是标签；只开 AI 占满整栏；拖标签到下半、到中间浮起来（挪、拉角、停靠）、到中间左边成一栏；
 * 拖栏头空处、拖中间标签条空处整栏换左右；⋯ 菜单往左往右挪、恢复默认；挪过底栏说「布局记住了」；重开软件布局还在。
 * 都是真拖（鼠标按下、挪、松开），窗口不上屏。
 */
import { _electron as electron, expect, test, type Locator, type Page } from '@playwright/test'
import { rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import electronPath from 'electron'
import { launch, openAi, rail, tabOn } from './app'
import { LECTURE } from './fixtures/pdf'

const PDF = '课程/线代/第3讲.pdf'
const files = { [PDF]: LECTURE, '周记/2026-W47.md': '# 2026-W47\n\n这周读线代。\n' }

type Box = { x: number; y: number; width: number; height: number }
const box = async (l: Locator): Promise<Box> => (await l.boundingBox())!
const mid = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 })
const tab = (page: Page, v: string) => page.getByTestId(`dtab-${v}`)
const view = (page: Page, v: string) => page.getByTestId(`dview-${v}`)
const groups = (page: Page) => page.locator('.dgrp')
/** 每一组头上的标签名（从左到右的栏、从上到下的组） */
const tabsOf = (page: Page) => page.locator('.dgrp, .dfloat').evaluateAll((gs) => gs.map((g) => [...g.querySelectorAll('.dtab')].map((t) => t.getAttribute('data-view'))))
/** 中间和右边几栏从左到右：center 或这一栏里的标签 */
const colOrder = (page: Page) =>
  page.evaluate(() => {
    const cols = [...document.querySelectorAll<HTMLElement>('.win > main.center, .win .dcol')].map((el) => ({ x: el.getBoundingClientRect().left, name: el.matches('main.center') ? 'center' : [...el.querySelectorAll('.dtab')].map((t) => t.getAttribute('data-view')).join('+') }))
    return cols.sort((a, b) => a.x - b.x).map((c) => c.name)
  })

/** 真拖：按下、分几步挪过去、（看一眼落点）、松开 */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, peek?: (page: Page) => Promise<void>) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 8, from.y + 3, { steps: 2 })
  await page.mouse.move(to.x, to.y, { steps: 12 })
  await page.waitForTimeout(80)
  if (peek) await peek(page)
  await page.mouse.up()
  await page.waitForTimeout(120)
}
/**
 * 中间标签条最后一个标签右边的空处，按在空处正中。
 * 中间被挤到最窄 420 时（左栏 + 右边两栏，1440 宽）读 PDF 的标签条右端有页码、缩放「52%」（task-2onrm 加的，54 宽）、问这一页、⋯，
 * 两个标签后面只剩 24 来宽的空处：够按住，不再要 40
 */
async function tabsBlank(page: Page) {
  const list = await box(page.getByTestId('tab-list'))
  const last = await box(page.getByTestId('tab-list').locator('.tab').last())
  const blank = list.x + list.width - (last.x + last.width)
  expect(blank).toBeGreaterThan(16)
  return { x: last.x + last.width + blank / 2, y: list.y + list.height / 2 }
}
const markSays = (text: string) => async (page: Page) => {
  await expect(page.getByTestId('drop-mark')).toBeVisible()
  await expect(page.getByTestId('drop-mark')).toHaveText(text)
}

async function openPdf(page: Page) {
  await page.keyboard.press('Meta+o')
  await page.keyboard.type('第3讲')
  await page.waitForTimeout(200)
  await page.keyboard.press('Enter')
  await expect(tabOn(page)).toHaveText('第3讲.pdf')
  await expect(page.locator('.pdfpane:not([hidden]) .pdfpage[data-page="1"] canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
}

test('只开 AI 占满整栏；网页和 AI 是同一组两个标签；拖网页到下半成上下两块；拖 AI 到中间浮起来、挪、拉角、停靠；挪过底栏说「布局记住了」', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await openPdf(page)
    await openAi(page)
    // 只开 AI：一组一个标签，占满整栏的高（和中间一样高）
    await expect(groups(page)).toHaveCount(1)
    expect(await tabsOf(page)).toEqual([['ai']])
    const center = await box(page.locator('main.center'))
    const g0 = await box(groups(page).first())
    expect(Math.abs(g0.height - center.height)).toBeLessThan(2)
    expect(Math.abs(g0.y - center.y)).toBeLessThan(2)
    await expect(view(page, 'ai')).toBeVisible()
    // AI 标签画正在用的那家的标志
    await expect(tab(page, 'ai').locator('.engine-logo, svg, img').first()).toBeVisible()

    // 开网页：同一组里的第二个标签，不硬切两截；网页在前面
    await rail(page).getByRole('button', { name: '网页' }).click()
    await expect.poll(() => tabsOf(page)).toEqual([['ai', 'web']])
    await expect(view(page, 'web')).toBeVisible()
    await expect(view(page, 'ai')).toBeHidden()
    expect(Math.abs((await box(groups(page).first())).height - center.height)).toBeLessThan(2)
    // 第一次有两个标签：旁边一张小卡教怎么拖，× 关掉
    const hint = page.getByTestId('dock-hint')
    await expect(hint).toBeVisible()
    await expect(hint.locator('b')).toHaveText('想两样一起看？拖标签')
    await expect(hint).toContainText('AI、网页现在是两个标签，只开一样时占满整栏。把标签拖到下半、拖到旁边成一栏，或拖到中间就浮起来。按住「⋯」左边的六点拖，整栏换左右。')
    await hint.getByRole('button', { name: '关掉' }).click()
    await expect(hint).toHaveCount(0)
    // 点标签换着看
    await tab(page, 'ai').click()
    await expect(view(page, 'ai')).toBeVisible()
    await expect(view(page, 'web')).toBeHidden()

    // 拖网页到下半：落点写「放到下半」，放下是上下两块，AI 在上、网页在下，各一半
    const g = await box(groups(page).first())
    await drag(page, mid(await box(tab(page, 'web'))), { x: g.x + g.width / 2, y: g.y + g.height * 0.88 }, markSays('放到下半'))
    await expect.poll(() => tabsOf(page)).toEqual([['ai'], ['web']])
    const [top, bottom] = [await box(groups(page).nth(0)), await box(groups(page).nth(1))]
    expect(top.y).toBeLessThan(bottom.y)
    expect(Math.abs(top.height - bottom.height)).toBeLessThan(3)
    await expect(view(page, 'ai')).toBeVisible()
    await expect(view(page, 'web')).toBeVisible()
    // 内容摆在自己那一组头的下面
    const aiV = await box(view(page, 'ai'))
    expect(aiV.y).toBeGreaterThan(top.y + 30)
    expect(aiV.y + aiV.height).toBeLessThanOrEqual(top.y + top.height + 1)
    // 挪过底栏说一句，带「恢复默认」
    await expect(page.getByTestId('toast')).toContainText('布局记住了：下次打开还是这样')
    await expect(page.getByTestId('toast').getByRole('button', { name: '恢复默认' })).toBeVisible()

    // 拖 AI 到中间的内容上：「浮在这里」，放下是浮窗 380 × 500
    const c = await box(page.locator('main.center'))
    await drag(page, mid(await box(tab(page, 'ai'))), mid(c), markSays('浮在这里'))
    const float = page.locator('.dfloat')
    await expect(float).toHaveCount(1)
    let fb = await box(float)
    expect([Math.round(fb.width), Math.round(fb.height)]).toEqual([380, 500])
    await expect(view(page, 'ai')).toBeVisible()
    const fv = await box(view(page, 'ai'))
    expect(fv.x).toBeGreaterThanOrEqual(fb.x)
    expect(fv.y).toBeGreaterThan(fb.y + 30)
    expect(await tabsOf(page)).toEqual([['web'], ['ai']])
    // 挪浮窗：按住头上的空处
    const grab = float.locator('.dgrab')
    await drag(page, mid(await box(grab)), { x: mid(await box(grab)).x - 120, y: mid(await box(grab)).y + 40 })
    const moved = await box(float)
    expect(Math.round(moved.x - fb.x)).toBe(-120)
    expect(Math.round(moved.y - fb.y)).toBe(40)
    // 拉右下角改大小
    const corner = await box(float.locator('.drz'))
    await drag(page, mid(corner), { x: mid(corner).x + 40, y: mid(corner).y + 30 })
    fb = await box(float)
    expect([Math.round(fb.width), Math.round(fb.height)]).toEqual([420, 530])
    // 停靠：回到右栏
    await float.getByRole('button', { name: '停靠' }).click()
    await expect(float).toHaveCount(0)
    await expect.poll(() => tabsOf(page)).toEqual([['web', 'ai']])
    await expect(view(page, 'ai')).toBeVisible()
  } finally {
    await run.close()
  }
})

test('笔记是独立的标签：拖到中间左边成一栏；拖栏头空处、拖中间标签条空处整栏换左右；⋯ 往右挪、恢复默认；重开软件布局还在', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  const root = dirname(vault)
  try {
    await openPdf(page)
    await rail(page).getByRole('button', { name: '笔记' }).click()
    await expect(view(page, 'note')).toBeVisible()
    await openAi(page)
    await expect.poll(() => tabsOf(page)).toEqual([['note', 'ai']])
    // 笔记拖到中间左边：「放到中间左边」，放下是 PDF 左边一栏（340）
    const c = await box(page.locator('main.center'))
    await drag(page, mid(await box(tab(page, 'note'))), { x: c.x + c.width * 0.08, y: c.y + c.height / 2 }, markSays('放到中间左边'))
    await expect.poll(() => colOrder(page)).toEqual(['note', 'center', 'ai'])
    expect(Math.round((await box(page.locator('.dcol').filter({ has: tab(page, 'note') }))).width)).toBe(340)
    await expect(view(page, 'note')).toBeVisible()
    await expect(view(page, 'ai')).toBeVisible()

    // 按住 AI 那一栏头上的空处拖到最左：亮一条竖线，放下 AI 那栏到最左
    const aiCol = page.locator('.dcol').filter({ has: tab(page, 'ai') })
    const noteCol = await box(page.locator('.dcol').filter({ has: tab(page, 'note') }))
    await drag(page, mid(await box(aiCol.locator('.dgrab'))), { x: noteCol.x + 10, y: noteCol.y + 300 }, async (p) => {
      await expect(p.getByTestId('drop-bar')).toBeVisible()
      await expect(p.getByTestId('drag-ghost')).toHaveText('挪这一栏')
    })
    await expect.poll(() => colOrder(page)).toEqual(['ai', 'note', 'center'])

    // 按住中间标签条右边的空处拖到最左：中间和右边几栏换位置
    const first = await box(aiCol)
    await drag(page, await tabsBlank(page), { x: first.x + 10, y: first.y + 300 })
    await expect.poll(() => colOrder(page)).toEqual(['center', 'ai', 'note'])

    // ⋯：这一栏往右挪
    await aiCol.getByRole('button', { name: '这一栏的布局' }).click()
    const menu = page.getByRole('dialog', { name: '这一栏的布局' })
    await expect(menu.locator('.mi')).toHaveText(['把「AI」浮起来', '这一栏往左挪', '这一栏往右挪', '恢复默认布局'])
    await menu.getByRole('menuitem', { name: '这一栏往右挪' }).click()
    await expect.poll(() => colOrder(page)).toEqual(['center', 'note', 'ai'])
    await page.waitForTimeout(400)

    // 重开软件：布局还在（同一台机器、同一个库）
    await run.app.close()
    const app2 = await electron.launch({
      executablePath: electronPath as unknown as string,
      args: [join(__dirname, '../out/main/index.js')],
      env: { ...process.env, CN_VAULT: vault, CN_USER_DATA: join(root, 'user-data'), CN_AI_FAKE: '1', CN_E2E: '1', CN_NO_AX: '1', CN_QUICK_KEY: 'Alt+Command+Shift+F19', CN_TRASH_DIR: join(root, 'trash'), CN_ICLOUD_CONTAINER: join(root, 'icloud') },
    })
    try {
      const p2 = await app2.firstWindow()
      await expect(tabOn(p2)).toHaveText('第3讲.pdf')
      await expect.poll(() => colOrder(p2)).toEqual(['center', 'note', 'ai'])
      // 恢复默认：右栏一栏，开着的几样叠成一组
      await p2.locator('.dcol').filter({ has: tab(p2, 'ai') }).getByRole('button', { name: '这一栏的布局' }).click()
      // AI 那栏已经在最右：「这一栏往右挪」用不了，淡下去（原型 .45）
      const right = p2.getByRole('dialog', { name: '这一栏的布局' }).getByRole('menuitem', { name: '这一栏往右挪' })
      await expect(right).toBeDisabled()
      expect(await right.evaluate((e) => getComputedStyle(e).opacity)).toBe('0.45')
      await p2.getByRole('dialog', { name: '这一栏的布局' }).getByRole('menuitem', { name: '恢复默认布局' }).click()
      await expect.poll(() => colOrder(p2)).toEqual(['center', 'note+ai'])
      await expect(p2.getByTestId('toast')).toHaveText('回到默认：右栏一栏，笔记、AI是两个标签')
    } finally {
      await app2.close()
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('不读 PDF 时笔记标签藏起来（它独占的那栏一起藏），回到 PDF 又在原处；⌘W 收起当前那组的标签、能撤回', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await openPdf(page)
    await rail(page).getByRole('button', { name: '笔记' }).click()
    await openAi(page)
    const c = await box(page.locator('main.center'))
    await drag(page, mid(await box(tab(page, 'note'))), { x: c.x + c.width * 0.08, y: c.y + c.height / 2 })
    await expect.poll(() => colOrder(page)).toEqual(['note', 'center', 'ai'])
    // 换到周记：笔记那一栏不画了，图标栏上「笔记」变淡
    await page.keyboard.press('Meta+o')
    await page.keyboard.type('2026-W47')
    await page.waitForTimeout(200)
    await page.keyboard.press('Enter')
    await expect(tabOn(page)).toHaveText('2026-W47')
    await expect.poll(() => colOrder(page)).toEqual(['center', 'ai'])
    await expect(rail(page).getByRole('button', { name: /^笔记/ })).toHaveClass(/dim/)
    // 回到 PDF：又在原处
    await page.getByTestId('tab-list').getByRole('tab', { name: /第3讲\.pdf/ }).click()
    await expect.poll(() => colOrder(page)).toEqual(['note', 'center', 'ai'])
    // 点 AI 那一组，⌘W：收起 AI 标签，底栏能撤回
    await view(page, 'ai').click({ position: { x: 40, y: 200 } })
    await page.keyboard.press('Meta+w')
    await expect.poll(() => colOrder(page)).toEqual(['note', 'center'])
    await expect(page.getByTestId('toast')).toContainText('收起了「AI」')
    await page.getByTestId('toast').getByRole('button', { name: '撤回' }).click()
    await expect.poll(() => colOrder(page)).toEqual(['note', 'center', 'ai'])
  } finally {
    await run.close()
  }
})
