/**
 * 「最近删掉的」挪到左边图标栏底部一格（task-iq2ow，用户截图 r46/img1：「这个"最近删除"，可以放到左栏的左下方」）：
 * 库、设置上面一格，废纸篓图标，30 天里删掉的篇数是角标（A 右下、B 右上，同别的格子；0 篇不出）；文件树最底下不再有那一行。
 * 点它左栏换成「最近删掉的」列表，这一格亮着；点一条中间开「最近删掉的」看它删掉前的样子；放回、撤回照旧；点别的格回去、再点它收起左栏。
 * ⌘K 搜得到「左栏：最近删掉的」。矮窗口时这一格算底部固定的那几格（2okp6-bar-fold.spec.ts 一步步量）。
 * 一律无头（CN_E2E=1），临时库、临时设置目录。
 */
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, tabOn, type Running } from './app'
import { PLAN, trashHistory, TRASH_VAULT } from './fixtures/trash-vault'
import { armMenus, pickMenu } from './menu'

const bar = (page: Page) => page.getByRole('navigation', { name: '左栏' })
const cell = (page: Page) => bar(page).getByTestId('ab-trash')
const badge = (page: Page) => cell(page).getByTestId('trash-count')
const panel = (page: Page) => page.getByTestId('trash-panel')
const rows = (page: Page) => panel(page).getByRole('list', { name: '最近删掉的' }).getByRole('listitem')
const tree = (page: Page) => page.getByRole('tree', { name: '全部文件' })
const toast = (page: Page) => page.locator('footer, .status')
const git = (vault: string, args: string[]) => execFileSync('git', ['-C', vault, ...args], { encoding: 'utf8' }).trim()

function look(frame: 'a' | 'b', history = true) {
  return (vault: string) => {
    const ud = join(dirname(vault), 'user-data')
    mkdirSync(ud, { recursive: true })
    writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: 'sky', frame, winBg: 'aurora' } }))
    if (history) trashHistory(vault)
  }
}

/** 角标在格子的哪个角：右下（A）还是右上（B）；和「收件箱」格子上的数字比，同一个角、离边一样远 */
async function corner(page: Page, testid: string) {
  return bar(page)
    .getByTestId(testid)
    .evaluate((b) => {
      const r = b.getBoundingClientRect()
      const c = b.closest('button')!.getBoundingClientRect()
      return { right: Math.round(c.right - r.right), top: Math.round(r.top - c.top), bottom: Math.round(c.bottom - r.bottom), h: Math.round(r.height) }
    })
}

for (const frame of ['b', 'a'] as const) {
  test(`${frame.toUpperCase()} 风格：图标栏底部「最近删掉的」带数；删一篇 +1；点开左栏是列表、这一格亮着；点一条中间看它；放回 -1；点别的格回去`, async () => {
    test.setTimeout(150_000)
    const run: Running = await launch(TRASH_VAULT, {}, look(frame))
    const { page, vault } = run
    try {
      await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900))
      // 在「库」「设置和外观」上面，三格挨着、是栏里最后三格
      const names = await bar(page).locator('button.ab').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label')))
      expect(names.slice(-3)).toEqual(['最近删掉的', '库', '设置和外观'])
      await expect(cell(page)).toHaveAttribute('data-tip', '最近删掉的')
      await expect(cell(page).locator('svg, .codicon').first()).toBeVisible()
      await expect(badge(page)).toHaveText('3')
      // 角标的样子、位置同「收件箱」那一格的数字：A 右下、B 右上
      const mine = await corner(page, 'trash-count')
      const inbox = await corner(page, 'inbox-count')
      expect(mine).toEqual(inbox)
      if (frame === 'a') expect(mine.bottom).toBeLessThan(mine.top)
      else expect(mine.top).toBeLessThan(mine.bottom)
      const css = (id: string) => bar(page).getByTestId(id).evaluate((e) => { const s = getComputedStyle(e); return [s.backgroundColor, s.color, s.fontSize, s.borderRadius, s.height].join(' ') })
      expect(await css('trash-count')).toBe(await css('inbox-count'))

      // 文件树里没有「最近删掉的」那一行
      await bar(page).getByRole('button', { name: '文件', exact: true }).click()
      await expect(tree(page)).toBeVisible()
      await expect(page.getByRole('complementary', { name: '文件' }).getByText('最近删掉的')).toHaveCount(0)

      // 在树里删一篇（右键「移到废纸篓」）：角标 +1
      await armMenus(run)
      const victim = tree(page).getByRole('treeitem', { name: /^投稿清单/ })
      if (!(await victim.isVisible())) await tree(page).getByRole('button', { name: '展开 写作' }).click()
      await victim.click({ button: 'right' })
      await pickMenu(run, '移到废纸篓')
      await expect.poll(() => existsSync(join(vault, '写作/投稿清单.md'))).toBe(false)
      await expect(badge(page)).toHaveText('4')

      // 点这一格：左栏换成列表，这一格亮着（同别的格子：class on、aria-pressed），「文件」不亮
      await cell(page).click()
      await expect(panel(page)).toBeVisible()
      await expect(cell(page)).toHaveClass(/\bon\b/)
      await expect(cell(page)).toHaveAttribute('aria-pressed', 'true')
      await expect(bar(page).getByRole('button', { name: '文件', exact: true })).toHaveAttribute('aria-pressed', 'false')
      await expect(panel(page).locator('.vh h2')).toHaveText('最近删掉的')
      await expect(panel(page).locator('.del-sub')).toHaveText('30天里删掉的4篇。放回去还在原来的文件夹；更早删掉的去「历史」里找。')
      await expect(rows(page).locator('.nm')).toHaveText(['投稿清单', '随手记 11月18日', '旧的读书计划', '冰岛行程 第一版'])
      await expect(rows(page).locator('.where')).toHaveText(['原来在「写作」', '原来在「收件箱」', '原来在「写作」', '原来在「项目 / 冰岛旅行」'])
      await expect(rows(page).first().locator('.when')).toHaveText('刚才')
      await expect(rows(page).nth(3).locator('.sw')).toHaveCSS('background-color', 'rgb(201, 133, 58)')
      await expect(panel(page).locator('.del-foot')).toHaveText('到了30天自己从这里拿掉，文件还在Git历史里。')
      // 一行 48 高，左栏里放得下，不横滚
      expect(await rows(page).first().evaluate((e) => Math.round(e.getBoundingClientRect().height))).toBe(48)
      expect(await panel(page).evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true)

      // 指着一行出「看一看」「放回」；看一看：中间开「最近删掉的」，删掉前的样子，只能看
      const plan = rows(page).nth(2)
      await expect(plan.getByRole('button', { name: '看一看' })).toBeHidden()
      await plan.hover()
      await expect(plan.getByRole('button', { name: '看一看' })).toBeVisible()
      await expect(plan.getByRole('button', { name: '放回' })).toBeVisible()
      // 指着时名字往左让，按钮不出左栏
      expect(await plan.evaluate((e) => { const r = e.getBoundingClientRect(); const b = e.querySelector('.acts')!.getBoundingClientRect(); return b.right <= r.right + 0.5 && b.left >= r.left })).toBe(true)
      // 指着时第二行只截括号里的文件夹名（前面几层先省略），「」」和「· 时间」都还在、不出这一行；「」」和「·」之间不另加空
      const ice = rows(page).nth(3)
      await ice.hover()
      const line2 = await ice.evaluate((e) => {
        const where = e.querySelector('.where') as HTMLElement
        const when = e.querySelector('.when')!.getBoundingClientRect()
        const row = e.getBoundingClientRect()
        const acts = e.querySelector('.acts')!.getBoundingClientRect()
        return { sw: where.scrollWidth, cw: where.clientWidth, fits: where.scrollWidth <= where.clientWidth + 1, whenIn: when.right <= acts.left + 0.5 && when.left >= row.left, text: where.textContent }
      })
      expect(line2.fits, JSON.stringify(line2)).toBe(true)
      expect(line2.whenIn).toBe(true)
      expect(line2.text).toBe('原来在「项目 / 冰岛旅行」')
      await plan.hover()
      await plan.getByRole('button', { name: '看一看' }).click()
      await expect(tabOn(page)).toHaveText('最近删掉的')
      const prev = page.getByTestId('trash-page').getByRole('region', { name: '删掉前的样子' })
      await expect(prev.locator('.tr-bar .t')).toContainText('「旧的读书计划」删掉前的样子 ·')
      await expect(prev.getByRole('heading', { name: '旧的读书计划' })).toBeVisible()
      await expect(prev).toContainText('《巴菲特传》，每周两章，周日写一段读后感。')
      await expect(prev.locator('[contenteditable="true"], textarea, input')).toHaveCount(0)
      await expect(plan).toHaveClass(/\bon\b/)
      // 正在看的那一条不铺底，只有左边一道 2px 强调色竖线（偏好「正在看和选中分开」，同文件树）
      await page.mouse.move(900, 600)
      const look = await plan.evaluate((e) => {
        const b = getComputedStyle(e, '::before')
        return { bg: getComputedStyle(e).backgroundColor, w: b.width, line: b.backgroundColor }
      })
      expect(look.bg).toBe('rgba(0, 0, 0, 0)')
      expect(look.w).toBe('2px')
      expect(look.line).not.toBe('rgba(0, 0, 0, 0)')
      // 点一条（不用按钮）也一样
      await rows(page).nth(3).click()
      await expect(prev.locator('.tr-bar .t')).toContainText('「冰岛行程 第一版」删掉前的样子')
      await rows(page).nth(2).click()

      // 中间「放回「写作」」：文件回来、一字不差，一次提交；列表少一行，角标 -1；中间回到一句话
      const before = Number(git(vault, ['rev-list', '--count', 'HEAD']))
      await prev.getByRole('button', { name: '放回「写作」' }).click()
      await expect.poll(() => existsSync(join(vault, '写作/旧的读书计划.md'))).toBe(true)
      expect(readFileSync(join(vault, '写作/旧的读书计划.md'), 'utf8')).toBe(PLAN)
      await expect.poll(() => git(vault, ['log', '-1', '--format=%s'])).toBe('放回：写作/旧的读书计划.md')
      expect(Number(git(vault, ['rev-list', '--count', 'HEAD']))).toBe(before + 1)
      await expect(toast(page).getByText('「旧的读书计划」放回了「写作」')).toBeVisible()
      await expect(rows(page).locator('.nm')).toHaveText(['投稿清单', '随手记 11月18日', '冰岛行程 第一版'])
      await expect(badge(page)).toHaveText('3')
      await expect(page.getByTestId('trash-page').locator('.tr-none')).toHaveText('在左栏「最近删掉的」里点一条，看它删掉前的样子')
      // 底栏撤回：又删掉（撤回是新的一次删除，排到前面），这一行回来，角标 +1
      await toast(page).getByRole('button', { name: '撤回' }).click()
      await expect.poll(() => existsSync(join(vault, '写作/旧的读书计划.md'))).toBe(false)
      await expect(rows(page).locator('.nm')).toHaveText(['投稿清单', '旧的读书计划', '随手记 11月18日', '冰岛行程 第一版'])
      await expect(badge(page)).toHaveText('4')

      // 左栏列表里直接「放回」刚删的那篇（还没提交）：先记下删除再放回
      const first = rows(page).first()
      await first.hover()
      await first.getByRole('button', { name: '放回' }).click()
      await expect.poll(() => existsSync(join(vault, '写作/投稿清单.md'))).toBe(true)
      await expect.poll(() => git(vault, ['log', '-2', '--format=%s'])).toMatch(/^放回：写作\/投稿清单\.md\n.*投稿清单/)
      await expect(rows(page).locator('.nm')).toHaveText(['旧的读书计划', '随手记 11月18日', '冰岛行程 第一版'])
      await expect(badge(page)).toHaveText('3')

      // 点别的格回去；再点它回到列表；亮着时再点一下收起左栏（同别的格子）
      await bar(page).getByRole('button', { name: '最近', exact: true }).click()
      await expect(panel(page)).toHaveCount(0)
      await expect(cell(page)).toHaveAttribute('aria-pressed', 'false')
      await expect(cell(page)).not.toHaveClass(/\bon\b/)
      await cell(page).click()
      await expect(panel(page)).toBeVisible()
      await cell(page).click()
      await expect(panel(page)).toHaveCount(0)
      await expect(cell(page)).toHaveAttribute('aria-pressed', 'false')

      // ⌘K 搜得到，跑了左栏换成列表
      await bar(page).getByRole('button', { name: '文件', exact: true }).click()
      await page.keyboard.press('Meta+k')
      const pal = page.getByRole('dialog', { name: '搜索和命令' })
      await pal.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('最近删掉')
      const opt = pal.getByRole('option').filter({ hasText: '左栏：最近删掉的' })
      await expect(opt).toBeVisible()
      await opt.click()
      await expect(panel(page)).toBeVisible()
      await expect(cell(page)).toHaveAttribute('aria-pressed', 'true')
    } finally {
      await run.close()
    }
  })
}

test('30 天里没删过：这一格照样在，没有角标；点开写「30天里没有删掉的」', async () => {
  const run = await launch({ '写作/日记.md': '# 日记\n\n今天。\n' }, {}, look('b', false))
  const { page } = run
  try {
    await expect(cell(page)).toBeVisible()
    await page.waitForTimeout(600)
    await expect(badge(page)).toHaveCount(0)
    await cell(page).click()
    await expect(panel(page).locator('.del-sub')).toHaveText('30天里没有删掉的。更早删掉的去「历史」里找。')
    await expect(rows(page)).toHaveCount(0)
    await expect(panel(page).locator('.del-foot')).toHaveCount(0)
  } finally {
    await run.close()
  }
})
