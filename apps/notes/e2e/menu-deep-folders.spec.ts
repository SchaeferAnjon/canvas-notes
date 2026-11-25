/**
 * r166（0.5.12 用户报）：文档顶栏「⋯」点了没反应，main.log 每点一次「Error invoking remote method 'ctx:menu': Error: 菜单参数不对」。
 * 根因：主进程收菜单前查形状（shared/ctx-menu.ts validItems）卡在 3 层、80 个；「移到」按文件夹一层套一层，用户库里有 4 层的文件夹，整个菜单被拒。
 * 这里在一个有 5 层文件夹、一层 120 个子文件夹的库里真点文档、白板、PDF 顶栏的「⋯」，都要弹出菜单。
 */
import { expect, test, type Page } from '@playwright/test'
import { acts, launch, openNote, pane, tabOn } from './app'
import { FILES, board, openBoard } from './fixtures/board-doc'
import { LECTURE } from './fixtures/pdf'
import { armMenus, dismissMenu, menuLabels, openedMenu, type MenuShot } from './menu'

const DEEP = '项目/study project 2/计划与调研/文献/2026'
const WIDE = Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`剪藏/站点 ${i}/摘录 ${i}.md`, `# 摘录 ${i}\n\n一段。\n`]))

const sub = (m: MenuShot[], path: string[]): MenuShot[] | undefined => {
  let items: MenuShot[] | undefined = m
  for (const name of path) items = items?.find((i) => i.label === name)?.submenu
  return items
}

async function more(page: Page) {
  await acts(page).getByRole('button', { name: '更多' }).click()
}

test('库里文件夹套 5 层、一层 120 个：文档、白板、PDF 顶栏「⋯」都弹出菜单，「移到」里一层层点得到最深那层', async () => {
  const run = await launch({
    ...FILES,
    ...WIDE,
    [`${DEEP}/读过.md`]: '# 读过\n\n一篇放在第 5 层的笔记。\n',
    '写作/情绪识别论文清单.md': '# 情绪识别论文清单\n\n- 一篇论文\n',
    '课程/ecp/Lecture05.pdf': LECTURE,
  })
  const { page } = run
  try {
    await armMenus(run)
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

    // 文档
    await openNote(page, '情绪识别论文清单')
    await more(page)
    const doc = await openedMenu(run)
    expect(menuLabels(doc).length).toBeGreaterThan(3)
    const moveTo = doc.find((i) => /^移到/.test(i.label))
    expect(moveTo?.submenu, '文档「⋯」里有「移到」子菜单').toBeTruthy()
    const deepest = sub(moveTo!.submenu!, ['项目', 'study project 2', '计划与调研', '文献'])
    expect(deepest?.map((i) => i.label)).toContain('2026')
    expect(sub(moveTo!.submenu!, ['剪藏'])!.filter((i) => /^站点 /.test(i.label)).length).toBe(120)
    await dismissMenu(run)

    // 白板
    await openBoard(page, '冰岛十天环岛')
    await expect(board(page)).toBeVisible()
    await more(page)
    expect(menuLabels(await openedMenu(run)).length).toBeGreaterThan(3)
    await dismissMenu(run)

    // PDF
    await page.keyboard.press('Meta+o')
    const quick = page.getByRole('dialog', { name: '按名字跳到' })
    await quick.getByRole('textbox', { name: '按名字跳到文件' }).fill('Lecture05.pdf')
    await quick.getByRole('option').filter({ hasText: 'Lecture05' }).first().click()
    await expect(tabOn(page)).toContainText('Lecture05')
    await expect(pane(page).locator('canvas, .pdf-page').first()).toBeVisible({ timeout: 30_000 })
    // PDF 的「⋯」是页面里画的菜单（PdfTab.tsx），不走 ctx:menu
    await more(page)
    const pdfMenu = page.getByRole('menu', { name: '更多' })
    await expect(pdfMenu).toBeVisible()
    expect(await pdfMenu.getByRole('menuitem').count()).toBeGreaterThan(1)
    await page.keyboard.press('Escape')

    expect(errors.filter((e) => /菜单参数不对|ctx:menu/.test(e))).toEqual([])
  } finally {
    await run.close()
  }
})
