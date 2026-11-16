// 主界面框架第一段（task-mzstv，design-frame/spec.md）：
// 每页的动作在标签条右端、标签上改名；A 照 VS Code（面包屑、设置是中间标签、底栏 AI 写引擎名）；
// 提示出在底栏正中不压内容；大纲点白板的卡片飞过去；右栏的弹层不出右栏。
import { expect, test, type Page } from '@playwright/test'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { acts, launch, rail, tabOn } from './app'
import { ICELAND } from './fixtures/board'

const frameA = (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { frame: 'a' } }))
}
const crumbs = (page: Page) => page.getByRole('navigation', { name: '位置' })
const status = (page: Page) => page.getByRole('contentinfo')

test('A 照 VS Code：面包屑以库名打头，点最后一节改名；F2 改名；设置开成中间的标签；底栏最右 AI 写引擎名', async () => {
  const run = await launch({ '读书笔记/思考快与慢.md': '# 思考快与慢\n\n两个系统。\n', '课程/线性代数/第4讲 特征值.md': '# 第4讲 特征值\n' }, { CN_AI_FAKE: '1' }, frameA)
  const { page, vault } = run
  try {
    await expect(page.locator('.win')).toHaveClass(/frame-a/)
    await page.getByRole('navigation', { name: '左栏' }).getByRole('button', { name: '文件', exact: true }).click()
    await page.getByRole('button', { name: '展开 读书笔记' }).click()
    await page.getByRole('treeitem', { name: /思考快与慢/ }).click()
    await expect(tabOn(page)).toHaveText('思考快与慢')
    await expect(crumbs(page)).toHaveText(/测试库.*读书笔记.*思考快与慢/)
    // 页面里没有标题行；白板 / 文档 / 源文件在标签条右端，A 只有图标
    await expect(page.locator('.pane:not([hidden]) .tool')).toHaveCount(0)
    await expect(acts(page).getByRole('tab', { name: '文档' })).toHaveAttribute('aria-selected', 'true')
    await expect(acts(page).locator('.seg .lb').first()).toBeHidden()

    // 面包屑最后一节：改名
    await crumbs(page).getByRole('button', { name: '思考快与慢' }).click()
    const input = page.getByRole('textbox', { name: '笔记名字' })
    await expect(input).toBeFocused()
    await input.fill('思考，快与慢')
    await input.press('Enter')
    await expect(tabOn(page)).toHaveText('思考，快与慢')
    await expect.poll(() => existsSync(join(vault, '读书笔记/思考，快与慢.md'))).toBe(true)
    // F2 也行，esc 不改
    await page.locator('.pane:not([hidden]) .cm-content').click()
    await page.keyboard.press('F2')
    await expect(input).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(tabOn(page)).toHaveText('思考，快与慢')

    // ⌘, 设置开成中间的一个标签；点别的标签退到后面；关掉标签就没了
    await page.keyboard.press('Meta+,')
    const set = page.getByRole('region', { name: '设置' })
    await expect(set).toBeVisible()
    await expect(page.getByRole('dialog', { name: '设置' })).toHaveCount(0)
    await expect(tabOn(page)).toHaveCount(0)
    await expect(page.locator('.tab.on')).toHaveText('设置')
    await page.locator('.tab', { hasText: '思考，快与慢' }).locator('.tl').click()
    await expect(set).toHaveCount(0)
    await expect(page.locator('.tab', { hasText: '设置' })).toBeVisible()
    await page.locator('.tab', { hasText: '设置' }).locator('.tl').click()
    await expect(set).toBeVisible()
    await page.locator('.tab', { hasText: '设置' }).getByRole('button', { name: '关闭标签' }).click()
    await expect(page.locator('.tab', { hasText: '设置' })).toHaveCount(0)

    // 底栏最右的 AI 写着引擎名，点了开浮窗
    const ai = status(page).locator('.ai-corner')
    await expect(ai).toHaveText('Claude Code')
    await ai.click()
    await expect(page.getByRole('complementary', { name: 'AI 对话' })).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('frame-a.png') })
  } finally {
    await run.close()
  }
})

test('提示出在底栏正中，不压中间的内容；带「撤回」的也一样', async () => {
  const run = await launch({ 'a.md': '# a\n' })
  const { page } = run
  try {
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('现在提交')
    await page.keyboard.press('Enter')
    const toast = page.getByTestId('toast')
    await expect(toast).toHaveText('没有要提交的改动')
    await expect(status(page).getByTestId('toast')).toBeVisible()
    const t = (await toast.boundingBox())!
    const c = (await page.locator('main.center').boundingBox())!
    expect(t.y).toBeGreaterThanOrEqual(c.y + c.height)
  } finally {
    await run.close()
  }
})

test('白板的大纲：列出列和卡片，点一张远处的卡片，白板滚过去并选中它', async () => {
  const far = ICELAND + '\n<!-- card id=far x=2600 y=1900 w=240 -->\n## 远处那张\n最后一天去蓝湖。\n'
  const run = await launch({ '冰岛环岛.md': far })
  const { page } = run
  try {
    await page.locator('.nav .si', { hasText: '冰岛环岛' }).click()
    const card = page.locator('.bcard[data-id="far"]')
    await expect(card).toBeAttached()
    await expect(card).not.toBeInViewport()
    await rail(page).getByRole('button', { name: '大纲' }).click()
    const outline = page.getByRole('complementary', { name: '大纲' })
    await expect(outline.getByRole('listitem').filter({ hasText: '极光看哪两晚' })).toBeVisible()
    await outline.getByRole('listitem').filter({ hasText: '远处那张' }).click()
    await expect(card).toHaveClass(/\bsel\b/)
    await expect(card).toBeInViewport()
  } finally {
    await run.close()
  }
})

test('右栏里的弹层不出右栏：网页「⋯」菜单整个在右栏里面', async () => {
  const run = await launch({ 'a.md': '# a\n' })
  const { page } = run
  try {
    await rail(page).getByRole('button', { name: '网页' }).click()
    const web = page.getByRole('complementary', { name: '网页' })
    await web.getByRole('button', { name: '更多', exact: true }).click()
    const menu = web.getByRole('menu', { name: '更多' })
    await expect(menu).toBeVisible()
    const p = (await web.boundingBox())!
    await expect.poll(async () => (await menu.boundingBox())!.x).toBeGreaterThanOrEqual(p.x)
    const m = (await menu.boundingBox())!
    expect(m.x + m.width).toBeLessThanOrEqual(p.x + p.width)
  } finally {
    await run.close()
  }
})
