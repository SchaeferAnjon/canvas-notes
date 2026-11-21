// 主界面框架第一段（task-mzstv，design-frame/spec.md）：
// 每页的动作在标签条右端、标签上改名；A 照 VS Code（面包屑、设置是中间标签、底栏 AI 写引擎名）；
// 提示出在底栏正中不压内容；大纲点白板的卡片飞过去；右栏的弹层不出右栏。
import { expect, test, type Page } from '@playwright/test'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { acts, launch, openNote, rail, tabOn } from './app'
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
    // 页面里没有标题行；白板 / 文档在标签条右端，A 只有图标
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
    const card = page.locator('.db-card[data-id="far"]')
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

// 分段控件的选中格是淡底（偏好「图标别做白底突起块」，照标签条小样 proposals2/D-读书与AI入口/v2/tabs/proto-a.html 的 .act.on）：
// 标签条右端「白板 / 文档」外面不套底，选中格 --fill2 底 + --t1 字，不带阴影和描边；别处的分段（归档、翻译、对比页、视频字幕、文件夹首页弹窗、网页书签）
// 统一成左栏「全部 文档 白板 剪藏」那一排的样子：外面不套 --fill 胶囊、不画内描边，每格和左栏的格子一样高、一样圆角、选中一样淡底 500 字重
for (const [frame, skin] of [['b', 'sky'], ['b', 'petrol'], ['a', 'sky'], ['a', 'petrol']] as const)
  test(`分段选中格是淡底、不是白底突起块（${frame.toUpperCase()} · ${skin}）`, async () => {
    const run = await launch({ '思考快与慢.md': '# 思考快与慢\n\n两个系统。\n' }, { CN_AI_FAKE: '1' }, (vault) => {
      const ud = join(dirname(vault), 'user-data')
      mkdirSync(ud, { recursive: true })
      writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, frame, skin } }))
    })
    const { page } = run
    try {
      await openNote(page, '思考快与慢')
      const on = acts(page).getByRole('tab', { name: '文档' })
      await expect(on).toHaveAttribute('aria-selected', 'true')
      const look = await on.evaluate((b) => {
        const probe = document.createElement('i')
        b.parentElement!.appendChild(probe)
        probe.style.background = 'var(--fill2)'
        const fill2 = getComputedStyle(probe).backgroundColor
        probe.style.background = 'var(--t1)'
        const t1 = getComputedStyle(probe).backgroundColor
        probe.remove()
        const s = getComputedStyle(b)
        // 别处的分段：同一套 .seg 样式
        const seg = document.createElement('div')
        seg.className = 'seg'
        seg.setAttribute('role', 'radiogroup')
        seg.innerHTML = '<button role="radio" aria-checked="true" class="on">甲</button><button role="radio" aria-checked="false">乙</button>'
        document.querySelector('.win')!.appendChild(seg)
        const g = getComputedStyle(seg.querySelector('button.on')!)
        const gs = getComputedStyle(seg)
        const pick = (c: CSSStyleDeclaration) => ({ bg: c.backgroundColor, shadow: c.boxShadow, color: c.color, weight: c.fontWeight, h: c.height, radius: c.borderRadius, size: c.fontSize })
        const other = { ...pick(g), box: gs.backgroundColor, boxShadow: gs.boxShadow, pad: gs.padding }
        seg.remove()
        // 左栏那一排（TypeChips）
        const chips = document.createElement('div')
        chips.className = 'tchips'
        chips.innerHTML = '<button class="chip on">甲</button><button class="chip">乙</button>'
        document.querySelector('.win')!.appendChild(chips)
        const left = pick(getComputedStyle(chips.querySelector('.chip.on')!))
        chips.remove()
        const box = getComputedStyle(b.parentElement!)
        return { bg: s.backgroundColor, color: s.color, shadow: s.boxShadow, box: box.backgroundColor, boxShadow: box.boxShadow, fill2, t1, other, left }
      })
      expect(look.bg).toBe(look.fill2)
      expect(look.color).toBe(look.t1)
      expect(look.shadow).toBe('none')
      expect(look.box).toBe('rgba(0, 0, 0, 0)')
      // 外面也不画一圈细线（家族 ui.css 的 .seg 带一圈内描边）
      expect(look.boxShadow).toBe('none')
      expect(look.other.bg).toBe(look.fill2)
      expect(look.other.shadow).toBe('none')
      // 别处的分段和左栏那一排一个样子：外面没有底、没有描边，格子同高同圆角同字重
      expect(look.other.box).toBe('rgba(0, 0, 0, 0)')
      expect(look.other.boxShadow).toBe('none')
      expect(look.other.pad).toBe('0px')
      const { box: _b, boxShadow: _s, pad: _p, ...cell } = look.other
      expect(cell).toEqual(look.left)
      // 没选中的那一格平时透明
      expect(await acts(page).getByRole('tab', { name: '白板' }).evaluate((b) => getComputedStyle(b).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
    } finally {
      await run.close()
    }
  })
