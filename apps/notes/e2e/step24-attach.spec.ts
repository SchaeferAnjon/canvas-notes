// 附件的两件事（2026-11-17，用户批准的 four-items 小样第 1、2 节）：
// 删笔记时「连同 N 张图一起移到废纸篓」（默认勾、别的笔记也在用的不删、勾不勾记住、删完底部能撤回）；
// 「属性」弹层列这篇的附件（前 5 张 + 「全部 N 张 ›」网格、搜名字、按大小、文中没用到；点一张在访达中显示、双击跳到文中）。
import { expect, test, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { acts, launch, leftView, pane, tabOn, type Running } from './app'
import { solidPng } from './fixtures/png'
import { armMenus, menuLabels, openedMenu, pickMenu } from './menu'

const NOTE = '课程/ecp/Lecture05 笔记.md'
const DIR = '附件/课程/ecp/Lecture05 笔记'
const img = (i: number) => solidPng(120 + i * 8, 90, [40 + ((i * 37) % 180), 90 + ((i * 53) % 140), 120 + ((i * 29) % 120)])
const link = (name: string) => `![](../../附件/课程/ecp/Lecture05%20笔记/${encodeURIComponent(name)})`

function vault(n: number): Record<string, string | Buffer> {
  const files: Record<string, string | Buffer> = {}
  const lines = ['# Lecture05 笔记', '', '这一讲讲比较静态。', '']
  for (let i = 1; i <= n; i++) {
    files[`${DIR}/截图 ${i}.png`] = img(i)
    if (i === 3) lines.push('## 为什么要先看符号', '')
    // 最后两张文中没用到
    if (i <= n - 2) lines.push(link(`截图 ${i}.png`), '')
  }
  files[NOTE] = lines.join('\n')
  files['复习.md'] = `# 复习\n\n![](${'附件/课程/ecp/Lecture05%20笔记/截图%202.png'})\n`
  files['别的.md'] = '# 别的\n'
  return files
}

const settings = (appearance: Record<string, unknown>) => (v: string) => {
  const ud = join(dirname(v), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, ...appearance } }))
}
const tree = (page: Page) => page.getByRole('tree', { name: '全部文件' })
const row = (page: Page, name: string) => tree(page).getByRole('treeitem').filter({ has: page.locator('.truncate', { hasText: new RegExp(`^${name}$`) }) })
const SHOTS = process.env.CN_SHOTS
async function shot(run: Running, name: string) {
  if (!SHOTS) return
  await run.page.waitForTimeout(300)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(b64, 'base64'))
}
async function openLecture(page: Page) {
  await leftView(page, '文件')
  for (const f of ['ecp']) if ((await row(page, f).getAttribute('aria-expanded')) !== 'true') await row(page, f).locator('.ft-tw').click()
  await row(page, 'Lecture05 笔记').click()
  await expect(tabOn(page)).toHaveText('Lecture05 笔记')
}

test('删笔记：确认框里「连同 N 张图」默认勾上、别的笔记也在用的不删；删完底部「撤回」把笔记和图放回原处；勾不勾记住；没附件的不问', async () => {
  const run = await launch(vault(5))
  const { page, vault: v } = run
  try {
    await armMenus(run)
    await openLecture(page)
    await row(page, 'Lecture05 笔记').click({ button: 'right' })
    await pickMenu(run, '移到废纸篓')
    const dlg = page.getByRole('dialog', { name: '把《Lecture05 笔记》移到废纸篓？' })
    await expect(dlg).toBeVisible()
    await expect(dlg).toContainText('在废纸篓里能找回，Git里也留着这一版。')
    // 截图 2 复习.md 也在用：查完以后是 4 张，灰字说一句
    await expect(dlg.getByTestId('trash-note')).toHaveText('别的笔记也在用的1张不会一起删。勾不勾下次照这次。')
    await expect(dlg.locator('.t1')).toHaveText('连同4张图一起移到废纸篓')
    await expect(dlg.locator('.t2')).toHaveText(`${DIR}/`)
    await expect(dlg.getByRole('checkbox', { name: '连同图一起移到废纸篓' })).toBeChecked()
    await expect(dlg.locator('.trash-thumbs img')).toHaveCount(3)
    await shot(run, '1a-删除确认')
    await dlg.getByRole('button', { name: '移到废纸篓' }).click()
    await expect(dlg).toHaveCount(0)
    const toast = page.getByTestId('toast')
    await expect(toast).toContainText('已删除《Lecture05 笔记》和4张图')
    await shot(run, '1b-删完能撤回')
    expect(existsSync(join(v, NOTE))).toBe(false)
    expect(readdirSync(join(v, DIR))).toEqual(['截图 2.png'])
    expect(readdirSync(run.trash)).toHaveLength(5)
    // 撤回：笔记和图都回来，标签重新开着
    await toast.getByRole('button', { name: '撤回' }).click()
    await expect(tabOn(page)).toHaveText('Lecture05 笔记')
    expect(readdirSync(join(v, DIR)).sort()).toEqual(['截图 1.png', '截图 2.png', '截图 3.png', '截图 4.png', '截图 5.png'])
    expect(readFileSync(join(v, NOTE), 'utf8')).toBe(vault(5)[NOTE])

    // 这次不勾：只删笔记，图都留着；下次打开确认框记得是不勾
    await row(page, 'Lecture05 笔记').click({ button: 'right' })
    await pickMenu(run, '移到废纸篓')
    await dlg.getByRole('checkbox', { name: '连同图一起移到废纸篓' }).uncheck()
    await dlg.getByRole('button', { name: '移到废纸篓' }).click()
    await expect(toast).toHaveText(/已删除《Lecture05 笔记》撤回/)
    expect(readdirSync(join(v, DIR))).toHaveLength(5)
    await toast.getByRole('button', { name: '撤回' }).click()
    await expect(tabOn(page)).toHaveText('Lecture05 笔记')
    await row(page, 'Lecture05 笔记').click({ button: 'right' })
    await pickMenu(run, '移到废纸篓')
    await expect(dlg.getByRole('checkbox', { name: '连同图一起移到废纸篓' })).not.toBeChecked()
    // 取消：什么都不动
    await dlg.getByRole('button', { name: '取消' }).click()
    await expect(dlg).toHaveCount(0)
    expect(existsSync(join(v, NOTE))).toBe(true)

    // 没有附件的笔记：不问，直接删，底部照样能撤回
    await row(page, '别的').click({ button: 'right' })
    await pickMenu(run, '移到废纸篓')
    await expect(toast).toContainText('已删除《别的》')
    await expect(page.getByRole('dialog', { name: /移到废纸篓？/ })).toHaveCount(0)
    expect(existsSync(join(v, '别的.md'))).toBe(false)
    await toast.getByRole('button', { name: '撤回' }).click()
    await expect.poll(() => existsSync(join(v, '别的.md'))).toBe(true)
  } finally {
    await run.close()
  }
})

test('属性弹层列附件：前 5 张（缩略图、名字、在哪一节、大小），「全部 N 张 ›」换成网格：搜名字、按大小、文中没用到；点一张在访达中显示、双击跳到文中、右键没用到的能删', async () => {
  const run = await launch(vault(9))
  const { page, vault: v } = run
  try {
    await armMenus(run)
    await openLecture(page)
    await acts(page).getByRole('button', { name: '属性' }).click()
    const pop = page.getByRole('dialog', { name: '属性' })
    const sec = pop.getByRole('region', { name: '附件' })
    await expect(sec.locator('.pa-hd')).toContainText('9 张')
    await expect(sec.locator('.pa-row')).toHaveCount(5)
    await expect(sec.locator('.pa-row .n')).toHaveText(['截图 1.png', '截图 2.png', '截图 3.png', '截图 4.png', '截图 5.png'])
    await expect(sec.locator('.pa-row .w').first()).toHaveText('第 2 段')
    await expect(sec.locator('.pa-row .w').nth(2)).toHaveText('为什么要先看符号')
    await expect(sec.locator('.pa-row .sz').first()).toHaveText(/^\d+ (B|KB)$/)
    await expect(sec.locator('.pa-more')).toContainText('还有 4 张 · 2 张文中没用到')
    await expect.poll(() => sec.locator('.pa-row img').first().evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBeGreaterThan(100)
    await shot(run, '2a-属性里的附件')
    // 点一行：在访达中显示
    await sec.locator('.pa-row').first().click()
    await expect.poll(() => run.app.evaluate(() => (globalThis as unknown as { cnScreen: string[] }).cnScreen)).toContain(`在访达中显示 ${join(v, DIR, '截图 1.png')}`)
    // 文件夹图标：在访达里打开整个附件文件夹
    await sec.getByRole('button', { name: '在访达里打开附件文件夹' }).click()
    await expect.poll(() => run.app.evaluate(() => (globalThis as unknown as { cnScreen: string[] }).cnScreen)).toContain(`在访达中显示 ${join(v, DIR)}`)

    // 全部 9 张：同一个弹层换成网格
    await sec.getByRole('button', { name: /全部 9 张/ }).click()
    const grid = page.getByRole('dialog', { name: '附件' })
    await expect(grid.getByRole('list', { name: '全部附件' }).getByRole('listitem')).toHaveCount(9)
    expect(await grid.evaluate((el) => el.getBoundingClientRect().width)).toBe(410)
    await expect(grid.locator('.pa-cell.unused .n')).toHaveText(['没用到 · 截图 8.png', '没用到 · 截图 9.png'])
    await shot(run, '2b-全部附件')
    await grid.getByRole('tab', { name: '按大小' }).click()
    await expect(grid.locator('.pa-cell .n').first()).toContainText('截图 9.png')
    await grid.getByRole('tab', { name: '文中没用到 2' }).click()
    await expect(grid.locator('.pa-cell')).toHaveCount(2)
    await grid.getByRole('tab', { name: '按文中先后' }).click()
    await grid.getByRole('textbox', { name: '找名字' }).fill('截图 4')
    await expect(grid.locator('.pa-cell')).toHaveCount(1)
    await grid.getByRole('textbox', { name: '找名字' }).fill('')
    // 右键：文中用到的不能在这里删，没用到的能
    await grid.locator('.pa-cell').first().click({ button: 'right' })
    const m = await openedMenu(run)
    expect(menuLabels(m)).toEqual(['在访达中显示', '拷贝图片', '拷贝路径', '移到废纸篓'])
    expect(m.find((i) => i.label === '移到废纸篓')!.enabled).toBe(false)
    await pickMenu(run, '拷贝路径')
    await grid.locator('.pa-cell.unused').last().click({ button: 'right' })
    await pickMenu(run, '移到废纸篓')
    await expect(grid.locator('.pa-cell')).toHaveCount(8)
    expect(existsSync(join(v, DIR, '截图 9.png'))).toBe(false)
    // 双击一张：跳到文中那一处（光标在那张图上）
    await grid.locator('.pa-cell').nth(5).dblclick()
    await expect(pane(page).locator('.cm-content')).toBeFocused()
    // 滚到了第 6 张图那里（文档里的图画成图，看得见它）
    await expect(pane(page).locator('.cm-content img[src$="%206.png"]')).toBeInViewport()
    // 网格还开着：返回箭头回到属性，「全部 8 张」（刚删了一张）
    await grid.getByRole('button', { name: '回到属性' }).click()
    await expect(pop.getByRole('region', { name: '附件' }).getByRole('button', { name: /全部 8 张/ })).toBeVisible()
    await expect(pop.getByRole('region', { name: '附件' })).toBeVisible()
  } finally {
    await run.close()
  }
})

// 交付截图：A / B × 浅 / 深（只在给了 CN_SHOTS 时跑）
for (const frame of ['b', 'a'] as const)
  for (const tone of ['light', 'dark'] as const)
    test(`附件截图 ${frame.toUpperCase()} ${tone === 'light' ? '浅色' : '深色'}`, async () => {
      test.skip(!SHOTS, '只在截交付图时跑')
      const tag = `${frame.toUpperCase()}-${tone === 'light' ? '浅' : '深'}`
      const run = await launch(vault(9), {}, settings({ skin: tone === 'light' ? 'sky' : 'petrol', frame }))
      const { page } = run
      try {
        await armMenus(run)
        await openLecture(page)
        await acts(page).getByRole('button', { name: '属性' }).click()
        await expect.poll(() => page.getByRole('dialog', { name: '属性' }).locator('.pa-row img').first().evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBeGreaterThan(100)
        await shot(run, `2a-属性里的附件-${tag}`)
        await page.getByRole('dialog', { name: '属性' }).getByRole('button', { name: /全部 9 张/ }).click()
        await shot(run, `2b-全部附件-${tag}`)
        await page.keyboard.press('Escape')
        await row(page, 'Lecture05 笔记').click({ button: 'right' })
        await pickMenu(run, '移到废纸篓')
        await expect(page.getByRole('dialog', { name: /移到废纸篓？/ }).getByTestId('trash-note')).toContainText('1 张不会一起删')
        await shot(run, `1a-删除确认-${tag}`)
        await page.getByRole('dialog', { name: /移到废纸篓？/ }).getByRole('button', { name: '移到废纸篓' }).click()
        await shot(run, `1b-删完能撤回-${tag}`)
      } finally {
        await run.close()
      }
    })
