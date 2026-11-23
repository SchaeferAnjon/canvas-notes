// 设置方向 A「分组侧栏」（2026-11-21 用户选 A，task-f7rib；原型 /private/tmp/canvas-notes-settings/proto-a.html）：
// 侧栏 5 段 17 页、每页一个头、侧栏顶上搜索（名字、说明、组名、页名、别的叫法都算，回车去第一项、那一行闪一下）、
// 改了马上存（底下提示条一句说会怎样、带撤回）、关掉重开还在、从用的地方跳过来（五处）。一律无头（CN_E2E=1）、临时库、临时设置目录。
import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import electronPath from 'electron'
import { acts, launch, leftView, pane, rail, type Running, tabOn } from './app'
import { armMenus, pickMenu } from './menu'
import { LECTURE } from './fixtures/pdf'
import { SETTINGS_PAGES } from '../src/shared/settings-index'

const files = {
  '随手记.md': '# 随手记\n\n一段字，看字号和行距。\n',
  '课程/线代/第3讲.pdf': LECTURE,
}

const dlg = (page: Page) => page.getByRole('dialog', { name: '设置' })
const nav = (page: Page) => dlg(page).getByRole('navigation', { name: '设置分页' })
const head = (page: Page) => dlg(page).getByTestId('settings-head')
const row = (page: Page, id: string) => dlg(page).locator(`[data-row="${id}"]`)
const toast = (page: Page) => dlg(page).getByTestId('settings-toast')
const settingsJson = (run: Running) => JSON.parse(readFileSync(join(run.userData, 'settings.json'), 'utf8'))

async function openSettings(page: Page) {
  await page.keyboard.press('Meta+,')
  await expect(dlg(page)).toBeVisible()
}

async function goPage(page: Page, name: string) {
  await nav(page).getByRole('button', { name, exact: true }).click()
  await expect(head(page).locator('h2')).toHaveText(name)
}

/** 那一行在闪（--acc-soft 1.6 秒）：类在、行在可见的范围里 */
async function flashed(page: Page, id: string) {
  await expect(row(page, id)).toHaveClass(/sa-flash/)
  await expect(row(page, id)).toBeInViewport()
}

/** 关上以后用同一个库、同一个设置目录再开一次 */
async function relaunch(run: Running) {
  const app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [join(__dirname, '../out/main/index.js')],
    env: { ...process.env, CN_VAULT: run.vault, CN_USER_DATA: run.userData, CN_E2E: '1', CN_NO_AX: '1', CN_QUICK_KEY: 'Alt+Command+Shift+F19', CN_TRASH_DIR: run.trash },
  })
  const page = await app.firstWindow()
  await expect(page.locator('.vault b')).toHaveText('测试库')
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0)))))
  return { app, page }
}

test('侧栏 5 段 18 页、每页一个头；窗口 960 × 740', async () => {
  const run = await launch(files)
  const { page } = run
  try {
    await openSettings(page)
    const box = (await dlg(page).boundingBox())!
    expect([Math.round(box.width), Math.round(box.height)]).toEqual([960, 740])
    await expect(nav(page).locator('.sa-sec')).toHaveText(['常用', '写和读', 'AI', '库和同步', '其他'])
    await expect(nav(page).locator('button.si')).toHaveText(SETTINGS_PAGES.map((p) => p.name))
    for (const p of SETTINGS_PAGES) {
      await goPage(page, p.name)
      await expect(head(page).locator('p')).toHaveText(p.desc)
      // 选中的那一行 500 字重，别的 400
      await expect(nav(page).getByRole('button', { name: p.name, exact: true })).toHaveCSS('font-weight', '500')
    }
    // 细线表：右边那一列 220，下拉 220 宽、右边齐（偏好「设置里下拉要对齐」）
    await goPage(page, 'Git和同步')
    const right = async (id: string) => {
      const r = (await row(page, id).boundingBox())!
      const c = (await row(page, id).locator('.sa-cc > *').last().boundingBox())!
      return { gap: Math.round(r.x + r.width - (c.x + c.width)), w: Math.round(c.width) }
    }
    // 原型量的：控件右边离这一行的右边 14（行的内边距），下拉 220
    expect(await right('autoCommit')).toEqual({ gap: 14, w: 220 })
    expect(await right('autoSync')).toEqual({ gap: 14, w: 220 })
    expect((await right('pullOpen')).gap).toBe(14)
  } finally {
    await run.close()
  }
})

test('搜索：谷歌、备份、字号、gitignore 回车去那一行并闪一下；没找到给三个能点的词；esc 先清空', async () => {
  const run = await launch(files)
  const { page } = run
  try {
    await openSettings(page)
    const box = dlg(page).getByRole('textbox', { name: '搜设置' })
    const results = dlg(page).getByRole('list', { name: '搜到的设置' })
    for (const [q, label, where, pageName, id] of [
      ['谷歌', '地址栏搜索用', '网页和视频 › 网页', '网页和视频', 'engine'],
      ['备份', '每天备份一份到', 'Git和同步 › 备份', 'Git和同步', 'backup'],
      ['字号', '字号', '文档和白板 › 文字', '文档和白板', 'size'],
      ['gitignore', '不进Git的文件', 'Git和同步 › 不进Git的', 'Git和同步', 'ignore'],
    ] as const) {
      await box.fill(q)
      const first = results.locator('.sa-rrow').first()
      await expect(first.locator('b')).toHaveText(label)
      await expect(first.locator('small')).toHaveText(where)
      await box.press('Enter')
      await expect(head(page).locator('h2')).toHaveText(pageName)
      await flashed(page, id)
    }
    // 名字里打中的字染色
    await box.fill('字号')
    await expect(results.locator('.sa-rrow').first().locator('mark')).toHaveText('字号')
    await box.fill('xyz')
    await expect(results).toContainText('没找到「xyz」。试试 字号、同步、下载')
    await results.getByRole('button', { name: '同步' }).click()
    await expect(box).toHaveValue('同步')
    await expect(results.locator('.sa-rrow').first().locator('b')).toContainText('同步')
    // esc 先清空搜索、侧栏回来；再按一次才关设置
    await box.press('Escape')
    await expect(box).toHaveValue('')
    await expect(nav(page).locator('.sa-sec').first()).toHaveText('常用')
    await expect(dlg(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dlg(page)).toHaveCount(0)
  } finally {
    await run.close()
  }
})

test('改了马上存：提示条一句说会怎样、能撤回；字号当场改到开着的文档；关掉重开设置、重开软件都还在', async () => {
  const run = await launch(files)
  const { page } = run
  try {
    // 先开一篇文档，改字号时它当场跟着变
    await page.keyboard.press('Meta+o')
    await page.keyboard.type('随手记')
    await page.keyboard.press('Enter')
    await expect(tabOn(page)).toHaveText('随手记')
    const editor = pane(page).locator('.cm-editor')
    await expect(editor).toHaveCSS('font-size', '15px')
    await openSettings(page)
    await goPage(page, '文档和白板')
    await row(page, 'lineh').getByRole('combobox').selectOption('loose')
    await expect(toast(page)).toContainText('已存 · 打开着的文档行距换成「松」')
    await expect.poll(() => settingsJson(run).editor.lineHeight).toBe('loose')
    await toast(page).getByRole('button', { name: '撤回' }).click()
    await expect(row(page, 'lineh').getByRole('combobox')).toHaveValue('normal')
    await expect.poll(() => settingsJson(run).editor.lineHeight).toBe('normal')
    await row(page, 'size').getByRole('combobox').selectOption('18')
    await expect(toast(page)).toContainText('已存 · 打开着的文档马上换成 18px')
    await expect(editor).toHaveCSS('font-size', '18px')
    // 提示条 4 秒后自己收起（偏好「提示条要能消失」；鼠标停在上面时不计时，先挪开）
    await page.mouse.move(5, 5)
    await expect(toast(page)).not.toHaveClass(/show/, { timeout: 6000 })
    await page.keyboard.press('Escape')
    // 再开：回到上次那一页，值还在
    await openSettings(page)
    await expect(head(page).locator('h2')).toHaveText('文档和白板')
    await expect(row(page, 'size').getByRole('combobox')).toHaveValue('18')
    await page.keyboard.press('Escape')
    await run.close({ keep: true })
    const again = await relaunch(run)
    try {
      await again.page.keyboard.press('Meta+,')
      await goPage(again.page, '文档和白板')
      await expect(row(again.page, 'size').getByRole('combobox')).toHaveValue('18')
      await expect(again.page.locator('.pane:not([hidden]) .cm-editor')).toHaveCSS('font-size', '18px')
    } finally {
      await again.app.close()
    }
  } finally {
    await run.close().catch(() => undefined)
  }
})

test('从用的地方跳过来：PDF「⋯」、网页「⋯」、底栏「同步」、文件树「排序」、文档「⋯」最下面一项翻到那一行、闪一下', async () => {
  const run = await launch(files)
  const { page } = run
  try {
    // 1. PDF：「⋯」最下面写清现在的值
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
    await page.locator('.pal-row', { hasText: '第3讲' }).first().click()
    await expect(tabOn(page)).toHaveText('第3讲.pdf')
    await acts(page).getByRole('button', { name: '更多' }).click()
    await acts(page).getByRole('menuitem', { name: '新打开的PDF默认用「适合宽度」' }).click()
    await expect(head(page).locator('h2')).toHaveText('读PDF')
    await flashed(page, 'pdfZoom')
    await page.keyboard.press('Escape')

    // 2. 网页「⋯」最下面「网页设置…」
    await rail(page).getByRole('button', { name: '网页' }).click()
    const web = page.getByRole('complementary', { name: '网页' })
    await web.getByRole('button', { name: '更多', exact: true }).click()
    await web.getByRole('menu', { name: '更多', exact: true }).getByRole('menuitem', { name: '网页设置…' }).click()
    await expect(head(page).locator('h2')).toHaveText('网页和视频')
    await flashed(page, 'engine')
    await page.keyboard.press('Escape')

    // 3. 底栏（B）：「N处没提交 / 都提交了」弹层最下面「同步设置…」
    await page.getByTestId('git-changed').click()
    const pop = page.getByRole('dialog', { name: '没提交的改动' })
    await expect(pop.getByTestId('sync-line')).toHaveText('还没有远程仓库')
    await pop.getByRole('menuitem', { name: '同步设置…' }).click()
    await expect(head(page).locator('h2')).toHaveText('Git和同步')
    await flashed(page, 'autoSync')
    await page.keyboard.press('Escape')

    // 4. 文件树头上的「排序」菜单最下面
    await leftView(page, '文件')
    await page.getByRole('button', { name: '排序' }).click()
    await page.getByRole('dialog', { name: '排序' }).getByRole('menuitem', { name: '新笔记放哪、附件、删除…' }).click()
    await expect(head(page).locator('h2')).toHaveText('文件和附件')
    await flashed(page, 'newWhere')
    await page.keyboard.press('Escape')

    // 5. 文档「⋯」（系统菜单）最下面「字体、字号、版心…」
    await armMenus(run)
    await page.keyboard.press('Meta+o')
    await page.keyboard.type('随手记')
    await page.keyboard.press('Enter')
    await expect(tabOn(page)).toHaveText('随手记')
    await acts(page).getByRole('button', { name: '更多' }).click()
    await pickMenu(run, '字体、字号、版心…')
    await expect(head(page).locator('h2')).toHaveText('文档和白板')
    await flashed(page, 'size')
  } finally {
    await run.close()
  }
})

test('A 照VS Code：设置是中间一个标签；底栏「同步」点开小菜单（一行状态、现在同步、同步设置…）', async () => {
  const run = await launch(files)
  const { page } = run
  try {
    await page.evaluate(() => window.cn.setSettings({ appearance: { frame: 'a' } }))
    await page.reload()
    await expect(page.locator('.vault b')).toHaveText('测试库')
    await page.getByTestId('sync-btn').click()
    const pop = page.getByRole('dialog', { name: '同步' })
    await expect(pop.getByTestId('sync-line')).toHaveText('还没有远程仓库')
    await expect(pop.getByRole('menuitem', { name: '现在同步' })).toBeVisible()
    await pop.getByRole('menuitem', { name: '同步设置…' }).click()
    const tab = page.getByRole('region', { name: '设置' })
    await expect(tab.getByTestId('settings-head').locator('h2')).toHaveText('Git和同步')
    await expect(tab.locator('[data-row="autoSync"]')).toHaveClass(/sa-flash/)
  } finally {
    await run.close()
  }
})
