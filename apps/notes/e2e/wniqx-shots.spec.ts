/**
 * 交付对照图（task-wniqx 导入后左栏）：软件摆成原型 /private/tmp/canvas-notes-visual/09-导入后左栏/proto-pin-folder.html 的同一个状态，整窗 1440×887 截。
 * 只在截交付图时跑：CN_SHOTS=目录，CN_SHOT_TONE=dark 截深湖（不给是天青），CN_SHOT_FRAME=a 截 A（不给是 B）。平时跳过。
 */
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, leftView, type Running } from './app'
import { armMenus, pickMenu } from './menu'

const DIR = process.env.CN_SHOTS
const DARK = process.env.CN_SHOT_TONE === 'dark'
const FRAME = process.env.CN_SHOT_FRAME === 'a' ? 'a' : 'b'
test.skip(!DIR, '只在截交付图时跑（CN_SHOTS=目录）')

const tag = `${FRAME}-${DARK ? 'dark' : 'light'}`
/** 原型里的样本：八个分类 + 从 Obsidian 导进来的四个文件夹 */
const FILES: Record<string, string> = {
  '收件箱/周三组会要问的.md': '# 周三组会要问的\n',
  '收件箱/一个 App 的点子.md': '# 一个 App 的点子\n',
  '课程/ecp/课程大纲.md': '# 课程大纲\n',
  '课程/study project/学习笔记：动手学深度学习.md': '# 学习笔记\n',
  '阅读/巴菲特传（纪念版）.md': '# 巴菲特传\n',
  '阅读/杀死一只知更鸟.md': '# 杀死一只知更鸟\n',
  '剪藏/冰岛旅行/一、最佳旅游季节.md': '# 一、最佳旅游季节\n',
  '周记/2026 第46周.md': '# 2026 第46周\n',
  '项目/冰岛自驾/行程.md': '# 行程\n',
  '读书笔记/《思考，快与慢》.md': '# 思考，快与慢\n',
  '读书笔记/系统1和系统2.md': '# 系统1和系统2\n',
  '读书笔记/《置身事内》.md': '# 置身事内\n',
  '工作/周会/2026-11-17 周会.md': '# 周会\n',
  '工作/项目A 需求.md': '# 项目A 需求\n',
  '灵感/一句话想法.md': '# 一句话想法\n',
  '日记/2026-11-18.md': '# 2026-11-18\n',
  '日记/2026-11-19.md': '# 2026-11-19\n',
  '日记/2026-11-20.md': '# 2026-11-20\n',
}
const look = (vault: string) => {
  for (const d of ['写作', '生活']) mkdirSync(join(vault, d), { recursive: true })
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: DARK ? 'petrol' : 'sky', frame: FRAME, winBg: 'aurora' } }))
}

async function shot(run: Running, name: string, mouse = true) {
  if (mouse) await run.page.mouse.move(700, 870)
  await run.page.waitForTimeout(500)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(DIR!, `${name}-${tag}.png`), Buffer.from(b64, 'base64'))
}

const bar = (page: Page) => page.getByRole('navigation', { name: '左栏' })
const cell = (page: Page, name: string) => bar(page).getByRole('button', { name, exact: true })

test('导入后左栏：放到左边、拖到图标栏、换顺序、换图标、拿下来、设置开关、关掉以后', async () => {
  test.setTimeout(120_000)
  mkdirSync(DIR!, { recursive: true })
  const run = await launch(FILES, {}, look)
  const { page } = run
  const item = (path: string) => page.locator('aside.side [role="tree"]').locator(`[role="treeitem"][data-path="${path}"]`)
  /** 按住拖到一点，停着（Playwright 停着不发 dragover，微微动两下） */
  const hold = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(from.x + 8, from.y + 8, { steps: 3 })
    await page.mouse.move(to.x, to.y, { steps: 8 })
    await page.mouse.move(to.x + 1, to.y)
    await page.mouse.move(to.x, to.y)
  }
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    await expect.poll(() => page.evaluate(() => innerHeight)).toBe(887)
    await armMenus(run)
    await leftView(page, '文件')
    await shot(run, '0-start')

    // 右键「读书笔记」放到左边（原型同一步）
    await item('读书笔记').click({ button: 'right' })
    await pickMenu(run, '放到左边')
    await expect(cell(page, '读书笔记')).toHaveCount(1)
    await shot(run, '1-pinned')

    // 拖「工作」到图标栏「读书笔记」下面
    await leftView(page, '文件')
    const r = (await item('工作').boundingBox())!
    const d = (await cell(page, '读书笔记').boundingBox())!
    await hold({ x: r.x + 40, y: r.y + r.height / 2 }, { x: d.x + d.width / 2, y: d.y + d.height + 4 })
    await expect(page.getByTestId('bar-drop-say')).toHaveText('松手：放到左边')
    await shot(run, '2-drag', false)
    await page.mouse.up()
    await expect(cell(page, '工作')).toHaveCount(1)
    await shot(run, '3-dropped')

    // 换顺序：「工作」拖到「读书笔记」上半
    const w = (await cell(page, '工作').boundingBox())!
    const d2 = (await cell(page, '读书笔记').boundingBox())!
    await hold({ x: w.x + w.width / 2, y: w.y + w.height / 2 }, { x: d2.x + d2.width / 2, y: d2.y + 4 })
    await expect(page.getByTestId('bar-drop-say')).toHaveText('松手：挪到这里')
    await shot(run, '4-reorder', false)
    await page.mouse.up()

    // 右键那一格「换图标和颜色…」：弹层
    await cell(page, '读书笔记').click({ button: 'right' })
    await pickMenu(run, '换图标和颜色…')
    await expect(page.getByRole('dialog', { name: '换图标和颜色' })).toBeVisible()
    await shot(run, '5-look', false)
    await page.keyboard.press('Escape')

    // 从左边拿下：底部一句带撤回
    await cell(page, '工作').click({ button: 'right' })
    await pickMenu(run, '从左边拿下')
    await expect(page.getByTestId('toast')).toContainText('从左边拿下了')
    await shot(run, '6-takeoff')
    await page.getByTestId('toast').getByRole('button', { name: '撤回' }).click()

    // 设置 › 文件和附件：左栏一组
    await page.keyboard.press('Meta+,')
    const set = page.locator('.set')
    await set.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: '文件和附件', exact: true }).click()
    await expect(set.locator('[data-row="leftPresets"]')).toBeVisible()
    await shot(run, '7-settings')
    await set.getByRole('switch', { name: '用预设的分类' }).click()
    await shot(run, '8-settings-off')
    await page.keyboard.press('Escape')

    // 关掉以后：点开「课程」
    await leftView(page, '文件')
    await item('课程').locator('.truncate').click()
    await shot(run, '9-off')
  } finally {
    await run.close()
  }
})
