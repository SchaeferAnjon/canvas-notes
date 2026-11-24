// 梦游先读懂这个库怎么分（task-h7oy8）：从 Obsidian 搬来的编号库（00-Inbox、30-Courses、40-Clippings）上真点一遍：
// 没确认时梦游照猜的整理、报告摘要提示一句带按钮 → 点了翻到设置 › 梦游「这个库怎么分」→ 改一个文件夹的角色、点「确认」→
// 库里多了 .canvas-notes/梦游.md 和一次提交 → 重开软件还是确认过的那份，再梦游报告不再提示。
// 归类只挑已有文件夹（30-Courses/线性代数、40-Clippings 下新开的一层），拿不准的留在 00-Inbox、报告里写为什么，README 不挪。
// CN_SHOTS=<目录> 时把设置页、报告的截图存过去（交付页用）
import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import electronPath from 'electron'
import { launch } from './app'

const git = (vault: string, ...args: string[]) => execFileSync('git', ['-C', vault, '-c', 'core.quotepath=false', ...args], { encoding: 'utf8' })

const VAULT: Record<string, string> = {
  'Vault-Home.md': '# Home\n\n| 目录 | 放什么 |\n|---|---|\n| `00-Inbox` | 新笔记先丢这里 |\n| `30-Courses` | 正式课程，一门课一个文件夹 |\n| `40-Clippings` | 别人写的、剪来的文章 |\n',
  '00-Inbox/README.md': '---\ntype: moc\n---\n# 00-Inbox\n\n不知道放哪的先丢进来。\n',
  '00-Inbox/线代作业.md': '---\n课程: 线性代数\n---\n第三次作业：证明线性映射的核是子空间。\n',
  '00-Inbox/极光.md': '---\nsource: https://safetravel.is/aurora\n---\n极光要看太阳风和云量，云量低于三成、KP 指数到 3 以上就值得出门。\n',
  '00-Inbox/想法.md': '也许可以写个小工具。\n',
  '10-Journal/2026-11-01.md': '# 2026-11-01\n\n今天读了半本书。\n',
  '10-Journal/2026-11-02.md': '# 2026-11-02\n\n下雨在家。\n',
  '30-Courses/线性代数/第1讲 向量空间.md': '# 第1讲 向量空间\n\n向量空间的八条公理。\n',
  '40-Clippings/技术/Rust 所有权.md': '---\nsource: https://doc.rust-lang.org/book/ch04-01.html\n---\n每个值只有一个所有者。\n',
  '90-杂物/旧东西.md': '# 旧东西\n\n以前的杂物。\n',
}

/** 只做归类和改名（别的几样和这条无关，关掉让报告干净） */
const SETTINGS = { dream: { auto: false, steps: { file: true, rename: true, link: false, week: false, viz: false, attach: false, dup: false, video: false } } }

const dialog = (page: Page) => page.getByRole('dialog', { name: '设置' })
const roleRow = (page: Page, folder: string) => dialog(page).getByRole('list', { name: '这个库怎么分' }).locator(`[data-folder="${folder}"]`)
const shots = process.env.CN_SHOTS
const shot = async (page: Page, name: string) => {
  await page.screenshot({ path: test.info().outputPath(name) })
  if (shots) await page.screenshot({ path: join(shots, name) })
}

test('别人的分类法：没确认时照猜的整理、报告提示；改角色、确认写进库里；重开照它', async () => {
  if (shots) mkdirSync(shots, { recursive: true })
  const run = await launch(VAULT, { CN_AI_FAKE: '1' }, (vault) => {
    mkdirSync(join(dirname(vault), 'user-data'), { recursive: true })
    writeFileSync(join(dirname(vault), 'user-data', 'settings.json'), JSON.stringify(SETTINGS))
  })
  const { page, vault, userData } = run
  let again: Awaited<ReturnType<typeof electron.launch>> | null = null
  try {
    // 1. 设置 › 梦游：每个文件夹一行，猜的角色和为什么
    await page.keyboard.press('Meta+,')
    await page.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: '梦游', exact: true }).click()
    const dlg = dialog(page)
    await expect(dlg.getByTestId('dream-roles-status')).toContainText('还没确认：5个文件夹是梦游猜的')
    const rows = dlg.getByRole('list', { name: '这个库怎么分' }).getByRole('listitem')
    await expect(rows).toHaveCount(5)
    await expect(rows.locator('.nm b')).toHaveText(['00-Inbox', '10-Journal', '30-Courses', '40-Clippings', '90-杂物'])
    await expect(roleRow(page, '00-Inbox').getByRole('combobox')).toHaveValue('inbox')
    await expect(roleRow(page, '10-Journal').getByRole('combobox')).toHaveValue('journal')
    await expect(roleRow(page, '30-Courses').getByRole('combobox')).toHaveValue('course')
    await expect(roleRow(page, '40-Clippings').getByRole('combobox')).toHaveValue('clip')
    await expect(roleRow(page, '90-杂物').getByRole('combobox')).toHaveValue('unsure')
    await expect(roleRow(page, '00-Inbox')).toContainText('名字是「Inbox」；说明里写着「新笔记先丢这里」')
    await expect(roleRow(page, '10-Journal')).toContainText('名字是「Journal」')
    await expect(roleRow(page, '90-杂物').locator('.low')).toHaveText('没把握')
    await expect(roleRow(page, '30-Courses').locator('.low')).toHaveCount(0)
    await roleRow(page, '00-Inbox').scrollIntoViewIfNeeded()
    await shot(page, 'roles-guess.png')
    // 「能动哪些文件夹」里写出这个库对应的文件夹
    await expect(dlg.getByRole('group', { name: '梦游能动哪些文件夹' })).toContainText('00-Inbox · 归类、改名、补双链')
    await expect(dlg).not.toContainText('库里别的文件夹')
    // 别人的库：只列这个库里有对应文件夹的分类（没有「阅读」「周记」文件夹就不出），说一句别的角色梦游只往里放
    await expect(dlg.getByRole('group', { name: '梦游能动哪些文件夹' }).locator('label b')).toHaveText(['收件箱', '课程', '剪藏'])
    await expect(dlg.getByTestId('dream-folders-foreign')).toBeVisible()

    // 2. 没确认就梦游：照猜的整理
    await dlg.getByTestId('dream-set-now').getByRole('button', { name: '现在梦游' }).click()
    await expect(dlg.getByTestId('dream-set-now')).toContainText('上次梦游', { timeout: 60_000 })
    await dlg.getByTestId('dream-set-now').getByRole('button', { name: '看报告' }).click()
    await expect(dialog(page)).toHaveCount(0)
    const panel = page.getByRole('complementary', { name: '梦游报告' })
    const hint = panel.getByTestId('dream-roles-hint')
    await expect(hint).toContainText('这次照猜的分法整理：5个文件夹的角色还没确认。')
    const report = (await page.evaluate(() => window.cn.dreamReport()))!
    const moves = report.items.filter((i) => i.group === 'file').map((i) => i.move)
    // 线代作业进已有的那门课；极光是剪来的，进剪藏下面新开的一层（标出来）；README 不挪；想法拿不准留着、写了为什么
    expect(moves).toEqual(expect.arrayContaining([{ from: '00-Inbox/线代作业.md', to: '30-Courses/线性代数/线代作业.md' }, { from: '00-Inbox/极光.md', to: '40-Clippings/旅行/极光.md' }]))
    expect(moves).toHaveLength(2)
    expect(report.items.find((i) => i.move?.to === '40-Clippings/旅行/极光.md')!.sub).toContain('新建文件夹')
    expect(report.stay).toBe(1)
    expect(report.stayWhy).toEqual([{ path: '00-Inbox/想法.md', why: '看不出是哪一类' }])
    await expect(panel.getByTestId('dream-stay-why')).toContainText('想法看不出是哪一类')
    await shot(page, 'report-hint.png')

    // 3. 点提示里的按钮：翻到设置 › 梦游「这个库怎么分」；把 90-杂物 改成归档、确认
    await hint.getByRole('button', { name: '确认这个库怎么分' }).click()
    await expect(roleRow(page, '90-杂物')).toBeVisible()
    await roleRow(page, '90-杂物').getByRole('combobox').selectOption('archive')
    await expect(dlg.getByTestId('dream-roles-status')).toContainText('改了还没存')
    await expect(roleRow(page, '90-杂物')).toContainText('你改的')
    await shot(page, 'roles-edit.png')
    await dlg.getByRole('button', { name: '确认', exact: true }).click()
    await expect(dlg.getByTestId('dream-roles-status')).toContainText(/确认过：\d+月\d+日 · 存在库里的 \.canvas-notes\/梦游\.md/)
    // 确认过又没改：「确认」不占位置，只留「重新认一遍」
    await expect(dlg.getByRole('button', { name: '确认', exact: true })).toHaveCount(0)
    const file = readFileSync(join(vault, '.canvas-notes/梦游.md'), 'utf8')
    expect(file).toMatch(/^# 梦游怎么认这个库\n/)
    expect(file).toMatch(/\n确认过：\d{4}-\d{2}-\d{2}\n/)
    expect(file).toContain('- 00-Inbox：收件箱（名字是「Inbox」；说明里写着「新笔记先丢这里」）\n')
    expect(file).toContain('- 90-杂物：归档（你改的）\n')
    expect(git(vault, 'log', '-1', '--format=%s', '--name-only').trim().split('\n')).toEqual(['梦游：确认这个库怎么分（5 个文件夹）', '', '.canvas-notes/梦游.md'])
    await shot(page, 'roles-confirmed.png')

    // 4. 「重新认一遍」：照现在的文件夹再猜，没存（90-杂物 回到不确定、确认按钮又能点）
    await dlg.getByRole('button', { name: '重新认一遍' }).click()
    await expect(roleRow(page, '90-杂物').getByRole('combobox')).toHaveValue('unsure')
    await expect(dlg.getByTestId('dream-roles-status')).toContainText('改了还没存')
    expect(readFileSync(join(vault, '.canvas-notes/梦游.md'), 'utf8')).toBe(file)
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toHaveCount(0)

    // 5. 重开软件（同一个库、同一个设置目录）：还是确认过的那份；再梦游，报告不再提示
    await run.close({ keep: true })
    again = await electron.launch({
      executablePath: electronPath as unknown as string,
      args: [join(__dirname, '../out/main/index.js')],
      env: { ...process.env, CN_VAULT: vault, CN_USER_DATA: userData, CN_E2E: '1', CN_NO_AX: '1', CN_AI_FAKE: '1', CN_QUICK_KEY: 'Alt+Command+Shift+F19', CN_TRASH_DIR: join(dirname(vault), 'trash'), CN_ICLOUD_CONTAINER: join(dirname(vault), 'icloud') },
    })
    const p2 = await again.firstWindow()
    await expect(p2.locator('.vault b')).toHaveText('测试库')
    await p2.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0)))))
    await p2.keyboard.press('Meta+,')
    await p2.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: '梦游', exact: true }).click()
    await expect(dialog(p2).getByTestId('dream-roles-status')).toContainText('确认过：')
    await expect(roleRow(p2, '90-杂物').getByRole('combobox')).toHaveValue('archive')
    const r2 = await p2.evaluate(() => window.cn.dreamNow())
    expect(r2.roles).toEqual({ guess: false, guessed: [] })
    // 归档、日记不当去处：上一份报告的条目没收下，还是同样两条；想法照旧留着
    expect(r2.items.filter((i) => i.group === 'file').map((i) => i.move!.to).sort()).toEqual(['30-Courses/线性代数/线代作业.md', '40-Clippings/旅行/极光.md'])
  } finally {
    if (again) await again.close()
    else await run.close({ keep: true })
    rmSync(dirname(vault), { recursive: true, force: true })
  }
})
