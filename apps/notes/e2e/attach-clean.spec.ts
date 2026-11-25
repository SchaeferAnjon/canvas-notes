// 清理没用到的附件（2026-11-25，用户 Canvas Notes 0.5.12 截图：附件/ 展开、「只看没用到的 2」勾着，项目 14 › hiwi2 12 › 11.18 会前准备 12 下面只露一张「截图 4.png 没用到」；
// 「这里加一个一键清理没有用到的图片的按钮」）。全部真点：
// 筛「只看没用到的」后文件夹的数是筛出来的个数（以前写里面一共几个）→「清理 N 个」→ 确认框列的正好是没用到的、合计多大，拿不准的单列 →
// 取消勾一个 →「移到废纸篓」→ 进测试的废纸篓、一次提交、底栏「清理了 N 个附件 · 撤回」→ 撤回一个字节不差地回来 →
// 再清一次，从「最近删掉的」放回一个回到原处；附件文件夹右键「清理这里没用到的附件」。
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, leftView, type Running } from './app'
import { solidPng } from './fixtures/png'
import { armMenus, menuLabels, openedMenu, pickMenu } from './menu'

const H = '附件/项目/hiwi2/11.18 会前准备'
const S = '附件/项目/study project 2/计划与调研'
/** 一张大一点的图（确认框里写的大小看得出来）：一张真图后面补 120 KB（解码只读到图的结尾） */
const bigJpg = Buffer.concat([solidPng(200, 150, [70, 130, 110]), Buffer.alloc(120 * 1024, 0)])
const VAULT: Record<string, string | Buffer> = {
  '项目/hiwi2/11.18 会前准备.md': `# 11.18 会前准备\n\n![](../../${H}/截图 1.png)\n\n![[截图 2]]\n\n<img src="../../${encodeURI(H)}/截图%203.png">\n`,
  [`${H}/截图 1.png`]: solidPng(160, 100, [40, 120, 200]),
  [`${H}/截图 2.png`]: solidPng(160, 100, [200, 120, 40]),
  [`${H}/截图 3.png`]: solidPng(160, 100, [90, 160, 90]),
  [`${H}/截图 4.png`]: solidPng(180, 120, [210, 90, 150]),
  '项目/study project 2/计划与调研.md': '# 计划与调研\n\n还没写。\n',
  [`${S}/草图.png`]: solidPng(140, 140, [120, 100, 220]),
  // 数据库 .base 用着的：树里写「在用」
  '项目/study project 2/书单.base': 'views:\n  - type: cards\n    image: 附件/项目/study project 2/封面.png\n',
  '附件/项目/study project 2/封面.png': solidPng(100, 140, [230, 200, 80]),
  // 白板卡片里的图
  '项目/白板.md': '---\ntype: board\n---\n# 白板\n\n<!-- card id=a1 x=120 y=300 w=280 -->\n![](../附件/项目/白板/卡.png)\n',
  '附件/项目/白板/卡.png': solidPng(120, 80, [60, 60, 60]),
  '附件/旧/没主的.jpg': bigJpg,
  // 拿不准：网页里下载的
  '附件/下载/资料.zip': 'PK',
}
const UNUSED = [`${H}/截图 4.png`, `${S}/草图.png`, '附件/旧/没主的.jpg']

const side = (page: Page) => page.locator('aside.side')
const tree = (page: Page) => side(page).getByRole('tree')
const row = (page: Page, p: string) => tree(page).locator(`[data-sel="${p}"]`)
const toast = (page: Page) => page.locator('footer, .status')
const git = (root: string, args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
const SHOTS = process.env.CN_SHOTS
async function shot(run: Running, name: string) {
  if (!SHOTS) return
  await run.page.waitForTimeout(300)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(b64, 'base64'))
}

/** skin：薄荷（浅）；右键那条用墨夜（深）顺便看深色的确认框 */
async function start(skin = 'mint'): Promise<Running> {
  const run = await launch(VAULT, {}, (v) => {
    const ud = join(dirname(v), 'user-data')
    mkdirSync(ud, { recursive: true })
    writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin, frame: 'b', winBg: 'aurora' } }))
    // 放了一小时的（1 分钟内刚加的算拿不准，不清）
    const old = (Date.now() - 3600_000) / 1000
    for (const f of Object.keys(VAULT)) utimesSync(join(v, f), old, old)
  })
  await armMenus(run)
  await leftView(run.page, '文件')
  for (const p of ['附件', '附件/项目', '附件/项目/hiwi2', H, '附件/项目/study project 2', S]) {
    const r = row(run.page, p)
    if ((await r.getAttribute('aria-expanded')) !== 'true') await r.locator('.ft-tw').click()
  }
  await expect(row(run.page, `${H}/截图 4.png`)).toBeVisible()
  return run
}

const bytesOf = (vault: string) => new Map(UNUSED.map((p) => [p, readFileSync(join(vault, p))]))

test('筛出来的数对；「清理」（个数在悬停提示）→ 确认框只列没用到的、合计多大 → 取消勾一个 → 移到废纸篓：一次提交、底栏撤回原样回来；再清一次，从「最近删掉的」放回一个', async () => {
  test.setTimeout(180_000)
  const run = await start()
  const { page, vault } = run
  try {
    const before = bytesOf(vault)
    // 用着的：被几篇用 / 在用（.base 提到）
    await expect(row(page, `${H}/截图 2.png`).locator('.ft-use')).toHaveText('被1篇用')
    await expect(row(page, `${H}/截图 3.png`).locator('.ft-use')).toHaveText('被1篇用')
    await expect(row(page, '附件/项目/study project 2/封面.png').locator('.ft-use')).toHaveText('在用')
    await expect(row(page, `${H}/截图 4.png`).locator('.ft-use')).toHaveText('没用到')

    // 「只看没用到的 4」（3 张能清 + 1 个拿不准的下载），后面「清理」，个数在悬停提示（2026-11-25 用户看 141 定）
    const chip = tree(page).getByRole('button', { name: /只看没用到的/ })
    await expect(chip.locator('.num')).toHaveText('4')
    const clean = tree(page).getByRole('button', { name: '清理', exact: true })
    await expect(clean).toBeVisible()
    await expect(clean).toHaveAttribute('title', '清理3个没用到的附件，1个拿不准不清')
    // 默认左栏宽度下一行放得下：两颗按钮同一行
    const [chipBox, cleanBox] = [await chip.boundingBox(), await clean.boundingBox()]
    expect(Math.abs(chipBox!.y - cleanBox!.y)).toBeLessThan(2)
    // 没勾时文件夹写一共几个
    await expect(row(page, H).locator('.ft-count')).toHaveText('4')
    await chip.click()
    await expect(chip).toHaveAttribute('aria-pressed', 'true')
    // 勾上以后：文件夹写筛出来的个数，和下面露出来的对得上
    await expect(row(page, '附件').locator('.ft-count')).toHaveText('4')
    await expect(row(page, '附件/项目').locator('.ft-count')).toHaveText('2')
    await expect(row(page, '附件/项目/hiwi2').locator('.ft-count')).toHaveText('1')
    await expect(row(page, H).locator('.ft-count')).toHaveText('1')
    await expect(row(page, '附件/项目/study project 2').locator('.ft-count')).toHaveText('1')
    await expect(tree(page).locator(`.ft-att[data-path^="${H}/"]`)).toHaveCount(1)
    // 附件/旧、附件/下载 没展开：露出来的是 截图 4.png、草图.png
    await expect(tree(page).locator('.ft-att')).toHaveCount(2)
    // 筛着时每行都是没用到的：不再写「没用到」，地方让给名字
    await expect(row(page, `${H}/截图 4.png`).locator('.ft-use')).toHaveCount(0)
    // 「只看没用到的 4」「清理」放得下：左栏不横着滚（以前一排挤不下时整棵树被推出去一截）
    expect(await side(page).locator('nav.nav').evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0)
    await shot(run, '1-筛出来的数和清理按钮')

    // 清理：确认框只列 3 个没用到的，合计多大；拿不准的「资料.zip」单列、写为什么
    await clean.click()
    const dlg = page.getByRole('dialog', { name: '清理没用到的附件' })
    await expect(dlg).toBeVisible()
    const list = dlg.getByRole('list', { name: '要清理的附件' })
    // 按路径排：附件/旧/ 在 附件/项目/ 前面
    await expect(list.locator('.t1')).toHaveText(['没主的.jpg', '截图 4.png', '草图.png'])
    await expect(list.locator('img.clean-thumb')).toHaveCount(3)
    const total = UNUSED.reduce((s, p) => s + VAULT[p]!.length, 0)
    const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`)
    await expect(dlg.getByTestId('clean-total')).toHaveText(`已选3个 · ${kb(total)}`)
    await expect(list.locator('.clean-size')).toHaveCount(3)
    const unsure = dlg.getByRole('list', { name: '拿不准，不清' })
    await expect(unsure.locator('.t1')).toHaveText(['资料.zip'])
    await expect(unsure.locator('.clean-why')).toHaveText(['网页里下载的'])
    await expect(dlg.getByRole('button', { name: '移到废纸篓3个' })).toBeVisible()
    await shot(run, '2-确认框')
    // 取消勾「没主的.jpg」：合计、按钮跟着变
    await list.getByRole('checkbox', { name: '没主的.jpg' }).click()
    const two = UNUSED.slice(0, 2)
    await expect(dlg.getByTestId('clean-total')).toHaveText(`已选2个 · ${kb(two.reduce((s, p) => s + VAULT[p]!.length, 0))}`)
    await shot(run, '3-取消勾一个')
    const head = git(vault, ['rev-parse', 'HEAD'])
    await dlg.getByRole('button', { name: '移到废纸篓2个' }).click()
    await expect(dlg).toHaveCount(0)
    await expect.poll(() => existsSync(join(vault, UNUSED[0]!))).toBe(false)
    expect(existsSync(join(vault, UNUSED[1]!))).toBe(false)
    expect(existsSync(join(vault, '附件/旧/没主的.jpg'))).toBe(true)
    for (const p of [`${H}/截图 1.png`, `${H}/截图 2.png`, `${H}/截图 3.png`, '附件/项目/study project 2/封面.png', '附件/项目/白板/卡.png', '附件/下载/资料.zip']) expect(existsSync(join(vault, p)), p).toBe(true)
    // 进了测试的废纸篓；一次提交，只动这两个
    const trashDir = join(dirname(vault), 'trash')
    expect(readdirSync(trashDir, { recursive: true }).map(String).filter((f) => /截图 4\.png|草图\.png/.test(f))).toHaveLength(2)
    await expect.poll(() => git(vault, ['log', '-1', '--format=%s'])).toBe('清理没用到的附件 2 个')
    expect(git(vault, ['rev-list', '--count', `${head}..HEAD`])).toBe('1')
    expect(git(vault, ['show', '--name-only', '--format=', 'HEAD']).split('\n').sort()).toEqual([...two].sort())
    const bar = toast(page)
    await expect(bar.getByText('清理了2个附件')).toBeVisible()
    await shot(run, '4-清理了撤回')
    // 撤回：一个字节不差地回来
    await bar.getByRole('button', { name: '撤回' }).click()
    await expect.poll(() => existsSync(join(vault, UNUSED[0]!))).toBe(true)
    for (const p of two) expect(readFileSync(join(vault, p)).equals(before.get(p)!), p).toBe(true)
    await expect(bar.getByText('撤回了，2个附件放回了原处')).toBeVisible()
    await expect.poll(() => git(vault, ['log', '-1', '--format=%s'])).toBe('撤回清理没用到的附件 2 个')

    // 再清一次，3 个都清
    const again = tree(page).getByRole('button', { name: '清理', exact: true })
    await expect(again).toHaveAttribute('title', '清理3个没用到的附件，1个拿不准不清', { timeout: 10_000 })
    await again.click()
    await page.getByRole('dialog', { name: '清理没用到的附件' }).getByRole('button', { name: '移到废纸篓3个' }).click()
    await expect.poll(() => UNUSED.filter((p) => existsSync(join(vault, p))).length).toBe(0)
    await expect.poll(() => git(vault, ['log', '-1', '--format=%s'])).toBe('清理没用到的附件 3 个')
    // 没有能清的了：按钮不在
    await expect(tree(page).getByRole('button', { name: /^清理/ })).toHaveCount(0)

    // 「最近删掉的」：放回「截图 4.png」，回到原处、一个字节不差
    await page.getByRole('navigation', { name: '左栏' }).getByTestId('ab-trash').click()
    const panel = page.getByTestId('trash-panel')
    const rows = panel.getByRole('list', { name: '最近删掉的' }).getByRole('listitem')
    const r4 = rows.filter({ hasText: '截图 4' })
    await expect(r4).toHaveCount(1)
    await shot(run, '5-最近删掉的')
    await r4.hover()
    await r4.getByRole('button', { name: '放回' }).click()
    await expect.poll(() => existsSync(join(vault, `${H}/截图 4.png`))).toBe(true)
    expect(readFileSync(join(vault, `${H}/截图 4.png`)).equals(before.get(`${H}/截图 4.png`)!)).toBe(true)
    await expect.poll(() => git(vault, ['log', '-1', '--format=%s'])).toMatch(/^放回：/)
    expect(existsSync(join(vault, `${S}/草图.png`))).toBe(false)
  } finally {
    await run.close()
  }
})

test('附件文件夹右键「清理这里没用到的附件」：只列这个文件夹里的（墨夜）', async () => {
  test.setTimeout(120_000)
  const run = await start('ink')
  const { page, vault } = run
  try {
    await row(page, '附件/项目/hiwi2').click({ button: 'right' })
    const m = await openedMenu(run)
    expect(menuLabels(m)).toContain('清理这里没用到的附件')
    await pickMenu(run, '清理这里没用到的附件')
    const dlg = page.getByRole('dialog', { name: '清理「hiwi2」里没用到的附件' })
    await expect(dlg.getByRole('list', { name: '要清理的附件' }).locator('.t1')).toHaveText(['截图 4.png'])
    await expect(dlg.getByRole('list', { name: '拿不准，不清' })).toHaveCount(0)
    await shot(run, '6-右键清理这里-墨夜')
    await dlg.getByRole('button', { name: '移到废纸篓1个' }).click()
    await expect.poll(() => existsSync(join(vault, `${H}/截图 4.png`))).toBe(false)
    for (const p of [`${S}/草图.png`, '附件/旧/没主的.jpg', `${H}/截图 1.png`]) expect(existsSync(join(vault, p)), p).toBe(true)
    await expect.poll(() => git(vault, ['log', '-1', '--format=%s'])).toBe('清理没用到的附件 1 个')
    await expect(toast(page).getByText('清理了1个附件')).toBeVisible()
    // 没有能清的文件夹：这一项灰着
    await row(page, '附件/项目/白板').click({ button: 'right' })
    const m2 = await openedMenu(run)
    expect(m2.find((i) => i.label === '清理这里没用到的附件')?.enabled).toBe(false)
  } finally {
    await run.close()
  }
})
