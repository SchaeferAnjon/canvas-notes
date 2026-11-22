/**
 * 文件树里挂在别的文件下面的子文件（task-wuv05，偏好「挂着的文件缩进加弯线」；用户：「这个导图能不能相较于白板再往右缩进一点点？
 * 有一条线从白板出来连接到这个导图，类似于我们竖屏时的那种弯曲的线」）：
 * 白板下的导图 / 子白板（属性 所属白板）、PDF 下的笔记、笔记下的可视化、笔记下的数据库记录文件夹，比父文件往右缩进一级，
 * 父文件左边伸出一条细的圆角弯线连到子文件；几个子文件时竖线接着往下，最后一个拐弯。
 * CN_SHOTS_DIR=<目录> 时存 A / B 两种风格 × 天青 / 深湖 的树（对照图）。
 */
import { expect, test, type Page } from '@playwright/test'
import { join } from 'node:path'
import { launch, leftView } from './app'
import { BOARD, DB, DIR, FILES, MAP, NOTE, PDF, PLAN, settings, SUB, VIZ } from './fixtures/hang-tree'

const SHOTS = process.env.CN_SHOTS_DIR
const tree = (page: Page) => page.getByRole('tree', { name: '全部文件' })
const item = (page: Page, path: string) => tree(page).locator(`[role="treeitem"][data-path="${path}"]`)
async function openDir(page: Page, path: string) {
  const segs = path.split('/')
  for (let i = 1; i <= segs.length; i++) {
    const row = item(page, segs.slice(0, i).join('/'))
    await expect(row).toBeVisible()
    if ((await row.getAttribute('aria-expanded')) !== 'true') await row.getByRole('button', { name: `展开 ${segs[i - 1]}`, exact: true }).click()
    await expect(row).toHaveAttribute('aria-expanded', 'true')
  }
}
/** 一行里图标（或白板的色块）左边的 x */
const iconLeft = (page: Page, path: string) => item(page, path).evaluate((el) => (el.querySelector(':scope > svg.ci, :scope > .ft-sw') as HTMLElement).getBoundingClientRect().left)

for (const frame of ['a', 'b'] as const) {
  for (const skin of ['sky', 'petrol'] as const) {
    test(`文件树：挂着的子文件往右一级、父文件伸出圆角弯线连过去，最后一个拐弯（${frame.toUpperCase()} · ${skin}）`, async () => {
      const run = await launch(FILES, {}, settings({ frame, skin }))
      const { page } = run
      try {
        await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
        await leftView(page, '文件')
        await openDir(page, DIR)
        // 数据库的记录文件夹挂在学习计划下面，默认收着：点它的展开箭头
        await item(page, PLAN).getByRole('button', { name: '展开 学习计划 的数据库' }).click()
        // 白板下面挂着导图和子白板（属性 所属白板），比白板往右一级
        for (const p of [MAP, SUB, NOTE, VIZ, DB]) await expect(item(page, p)).toBeVisible()
        const level = async (p: string) => Number(await item(page, p).getAttribute('aria-level'))
        expect(await level(MAP)).toBe((await level(BOARD)) + 1)
        expect(await level(SUB)).toBe((await level(BOARD)) + 1)
        expect(await level(NOTE)).toBe((await level(PDF)) + 1)
        expect(await level(VIZ)).toBe((await level(NOTE)) + 1)
        expect(await level(DB)).toBe((await level(PLAN)) + 1)
        expect((await iconLeft(page, MAP)) - (await iconLeft(page, BOARD))).toBeGreaterThanOrEqual(14)
        // 弯线：挂着的每一行左边一条；不是最后一个的竖线接着往下（├），最后一个拐弯（└，圆角）
        const elbow = (p: string) => item(page, p).locator('.ft-guides > .gl-e')
        await expect(elbow(MAP)).toHaveAttribute('data-last', '0')
        await expect(elbow(SUB)).toHaveAttribute('data-last', '1')
        await expect(elbow(SUB)).toHaveCSS('border-bottom-left-radius', '6px')
        await expect(elbow(NOTE)).toHaveAttribute('data-last', '1')
        await expect(elbow(VIZ)).toHaveAttribute('data-last', '1')
        await expect(elbow(DB)).toHaveAttribute('data-last', '1')
        // 线从父文件的展开箭头下面伸出来，横着连到子文件的图标前面
        const box = (p: string, sel: string) => item(page, p).locator(sel).first().evaluate((el) => el.getBoundingClientRect().toJSON() as DOMRect)
        const tw = await box(BOARD, ':scope > .ft-tw')
        const e = await box(MAP, ':scope > .ft-guides > .gl-e')
        expect(Math.abs(e.left - (tw.left + tw.width / 2))).toBeLessThanOrEqual(1.5)
        expect((await iconLeft(page, MAP)) - e.right).toBeGreaterThanOrEqual(1)
        expect((await iconLeft(page, MAP)) - e.right).toBeLessThanOrEqual(5)
        // 选中的那一行：底色一整块，线画在底色上面不打断它
        await item(page, MAP).click()
        await expect(item(page, MAP)).toHaveAttribute('aria-current', 'page')
        if (SHOTS) await tree(page).screenshot({ path: join(SHOTS, `tree-${frame}-${skin}.png`) })
      } finally {
        await run.close()
      }
    })
  }
}
