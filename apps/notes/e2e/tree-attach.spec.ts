// 文件树附件（2026-11-24，用户：「我想画一张红框 选中下面的文件 不知道为啥现在还是选不了」「这些图片 我点一下它就在访达里面打开了 能不能改成点一下只是选中
// 双击的时候再打开」「这些附件我也不知道哪些是在使用的」「怎么能通过这个图片打开对应的文档」「按住 Command 悬停在图片上时 能不能预览」）。
// 每样都真点：一行的空处按下拖框选、⇧点 ⌘点；单击不进访达、双击看大图；「被 N 篇用」「没用到」、筛「只看没用到的」；右键「在哪用到」跳到那张图；⌘ 悬停预览。
import { expect, test, type Page } from '@playwright/test'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, leftView, pane, tabOn, type Running } from './app'
import { solidPng } from './fixtures/png'
import { armMenus, menuLabels, openedMenu, pickMenu } from './menu'

const D = '附件/剪藏/冰岛'
const filler = Array.from({ length: 60 }, (_, i) => `第 ${i + 1} 段：冰岛环岛一号公路沿途的记录。`).join('\n\n')
const VAULT: Record<string, string | Buffer> = {
  '冰岛.md': `# 冰岛\n\n![](附件/剪藏/冰岛/a.png)\n\n![](附件/剪藏/冰岛/b.png)\n`,
  '游记/行程.md': `# 行程\n\n${filler}\n\n## 地图\n\n![路线](../附件/剪藏/冰岛/a.png)\n\n结尾。\n`,
  [`${D}/a.png`]: solidPng(160, 100, [40, 120, 200]),
  [`${D}/b.png`]: solidPng(120, 90, [200, 120, 40]),
  [`${D}/c.png`]: solidPng(100, 100, [90, 160, 90]),
  [`${D}/d.zip`]: 'PK',
}

const side = (page: Page) => page.locator('aside.side')
const tree = (page: Page) => side(page).getByRole('tree')
const att = (page: Page, name: string) => tree(page).locator(`.ft-att[data-path="${D}/${name}"]`)
const screen = (run: Running) => run.app.evaluate(() => (globalThis as unknown as { cnScreen: string[] }).cnScreen.join('|'))
const selbar = (page: Page) => side(page).getByRole('toolbar', { name: '选中的' })
const SHOTS = process.env.CN_SHOTS
async function shot(run: Running, name: string) {
  if (!SHOTS) return
  await run.page.waitForTimeout(300)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(b64, 'base64'))
}

async function start(): Promise<Running> {
  const run = await launch(VAULT, {}, (v) => {
    const ud = join(dirname(v), 'user-data')
    mkdirSync(ud, { recursive: true })
    writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: 'mint', frame: 'b', winBg: 'aurora' } }))
  })
  await armMenus(run)
  await leftView(run.page, '文件')
  for (const p of ['附件', '附件/剪藏', D]) {
    const r = tree(run.page).locator(`[data-sel="${p}"]`)
    if ((await r.getAttribute('aria-expanded')) !== 'true') await r.locator('.ft-tw').click()
  }
  await expect(att(run.page, 'a.png')).toBeVisible()
  return run
}

test('一行的空处按下拖出框选中 3 张；⇧点连选、⌘点加减；单击只选中不进访达，双击图看大图、别的用系统打开；右键「在访达中显示」', async () => {
  const run = await start()
  const { page } = run
  try {
    // 单击：只选中，访达、系统打开都没调
    await att(page, 'a.png').click()
    await expect(att(page, 'a.png')).toHaveAttribute('aria-selected', 'true')
    await page.waitForTimeout(400)
    expect(await screen(run)).not.toMatch(/在访达中显示|打开 /)
    // ⇧点 c：a b c 三张
    await att(page, 'c.png').click({ modifiers: ['Shift'] })
    await expect(selbar(page).locator('b')).toHaveText('已选3个')
    // ⌘点 b：去掉
    await att(page, 'b.png').click({ modifiers: ['Meta'] })
    await expect(selbar(page).locator('b')).toHaveText('已选2个')
    await expect(att(page, 'b.png')).toHaveAttribute('aria-selected', 'false')
    // 在空白处点一下清掉，再从 a.png 那一行的缩进处（行里的空处，以前按下去是拖那一行、出不了框）按下拖到 c.png
    await page.keyboard.press('Escape')
    await expect(selbar(page)).toHaveCount(0)
    const a = (await att(page, 'a.png').boundingBox())!
    const c = (await att(page, 'c.png').boundingBox())!
    await page.mouse.move(a.x + 12, a.y + a.height / 2)
    await page.mouse.down()
    await page.mouse.move(a.x + 40, c.y + c.height / 2, { steps: 8 })
    await expect(tree(page).locator('.ft-lasso')).toBeVisible()
    await shot(run, '1-框选')
    await page.mouse.up()
    await expect(tree(page).locator('.ft-lasso')).toHaveCount(0)
    await expect(selbar(page).locator('b')).toHaveText('已选3个')
    for (const n of ['a.png', 'b.png', 'c.png']) await expect(att(page, n)).toHaveAttribute('aria-selected', 'true')
    await expect(att(page, 'd.zip')).toHaveAttribute('aria-selected', 'false')
    // 松手那一下不算点了 c.png（还是 3 个，没开标签）
    await page.waitForTimeout(300)
    await expect(selbar(page).locator('b')).toHaveText('已选3个')
    // 名字后面那段空处按下拖也一样（从 d.zip 往上拖到 c.png）
    const d = (await att(page, 'd.zip').boundingBox())!
    const fl = (await att(page, 'd.zip').locator('.ft-fl').boundingBox())!
    await page.mouse.move(fl.x + fl.width / 2, d.y + d.height / 2)
    await page.mouse.down()
    await page.mouse.move(fl.x + fl.width / 2, c.y + 4, { steps: 6 })
    await page.mouse.up()
    await expect(selbar(page).locator('b')).toHaveText('已选2个')
    await expect(att(page, 'd.zip')).toHaveAttribute('aria-selected', 'true')
    await expect(att(page, 'c.png')).toHaveAttribute('aria-selected', 'true')

    // 双击图：软件里看大图，不进访达
    await att(page, 'b.png').dblclick()
    const big = page.getByRole('dialog', { name: '看大图' })
    await expect(big.locator('img')).toBeVisible()
    await expect(big.locator('p')).toContainText('b.png')
    await expect(big.locator('p')).toContainText('被1篇用')
    await shot(run, '2-双击看大图')
    await page.keyboard.press('Escape')
    await expect(big).toHaveCount(0)
    expect(await screen(run)).not.toMatch(/在访达中显示|打开 /)
    // 双击不是图的：系统默认程序打开（测试模式只记下来）
    await att(page, 'd.zip').dblclick()
    await expect.poll(() => screen(run)).toMatch(/打开 .*\/附件\/剪藏\/冰岛\/d\.zip/)
    // 右键：在访达中显示
    await att(page, 'c.png').click({ button: 'right' })
    const m = await openedMenu(run)
    expect(menuLabels(m)).toEqual(['看大图', '在访达中显示', '拷贝路径', '在哪用到：没有笔记用它', '移到废纸篓'])
    await pickMenu(run, '在访达中显示')
    await expect.poll(() => screen(run)).toMatch(/在访达中显示 .*\/附件\/剪藏\/冰岛\/c\.png/)
  } finally {
    await run.close()
  }
})

test('「被 N 篇用」「没用到」，筛「只看没用到的」后框选删掉；右键「在哪用到」点一篇打开、跳到那张图亮一下；⌘ 悬停出预览', async () => {
  const run = await start()
  const { page, vault } = run
  try {
    await expect(att(page, 'a.png').locator('.ft-use')).toHaveText('被2篇用')
    await expect(att(page, 'b.png').locator('.ft-use')).toHaveText('被1篇用')
    await expect(att(page, 'c.png').locator('.ft-use')).toHaveText('没用到')
    await expect(att(page, 'c.png')).toHaveClass(/unused/)
    await expect(att(page, 'a.png')).not.toHaveClass(/unused/)
    await shot(run, '3-被几篇用')

    // ⌘ 悬停 b.png：弹出预览，里面是这张图
    await att(page, 'b.png').locator('.truncate').hover()
    await page.keyboard.down('Meta')
    await att(page, 'b.png').locator('.truncate').hover({ position: { x: 6, y: 6 } })
    const pk = page.locator('.pk').last()
    await expect(pk.locator('.pk-img img')).toBeVisible({ timeout: 5000 })
    expect(await pk.locator('.pk-img img').getAttribute('src')).toContain('b.png')
    await shot(run, '4-按住⌘悬停预览')
    await page.keyboard.up('Meta')
    await page.keyboard.press('Escape')
    await page.mouse.move(5, 5)
    await expect(page.locator('.pk')).toHaveCount(0, { timeout: 5000 })

    // 右键 a.png「在哪用到（2篇）」：两篇；点「行程」开它，滚到地图那张、外圈亮
    await att(page, 'a.png').click({ button: 'right' })
    const m = await openedMenu(run)
    const where = m.find((i) => i.label === '在哪用到（2篇）')!
    expect(where.submenu!.map((i) => i.label).sort()).toEqual(['冰岛', '行程'])
    await pickMenu(run, '在哪用到（2篇） › 行程')
    await expect(tabOn(page)).toHaveText('行程')
    const flown = pane(page).locator('.cm-image img.flown')
    await expect(flown).toHaveCount(1, { timeout: 8000 })
    expect(await flown.getAttribute('src')).toContain('a.png')
    await expect(flown).toBeInViewport()
    await shot(run, '5-在哪用到跳到图')

    // 筛「只看没用到的」：只剩 c.png、d.zip；数字 2
    const chip = tree(page).getByRole('button', { name: /只看没用到的/ })
    await expect(chip.locator('.num')).toHaveText('2')
    await chip.click()
    await expect(chip).toHaveAttribute('aria-pressed', 'true')
    await expect(tree(page).locator('.ft-att')).toHaveCount(2)
    await expect(att(page, 'c.png')).toBeVisible()
    await expect(att(page, 'd.zip')).toBeVisible()
    await shot(run, '6-只看没用到的')
    // 框选这两张，底部「删除」：进废纸篓
    const c = (await att(page, 'c.png').boundingBox())!
    const d = (await att(page, 'd.zip').boundingBox())!
    await page.mouse.move(c.x + 12, c.y + c.height / 2)
    await page.mouse.down()
    await page.mouse.move(c.x + 30, d.y + d.height / 2, { steps: 6 })
    await page.mouse.up()
    await expect(selbar(page).locator('b')).toHaveText('已选2个')
    await selbar(page).getByRole('button', { name: '删除' }).click()
    await page.getByRole('dialog', { name: '把选中的2个移到废纸篓？' }).getByRole('button', { name: '移到废纸篓' }).click()
    await expect.poll(() => existsSync(join(vault, D, 'c.png'))).toBe(false)
    expect(existsSync(join(vault, D, 'd.zip'))).toBe(false)
    expect(existsSync(join(vault, D, 'a.png'))).toBe(true)
    // 没用到的清完了：「只看没用到的」那一排整行收起、筛选跟着关掉（按推荐小改一批第 2 件），用着的两张还在
    await expect(chip).toHaveCount(0)
    await expect(tree(page).locator('.ft-att')).toHaveCount(2)
  } finally {
    await run.close()
  }
})
