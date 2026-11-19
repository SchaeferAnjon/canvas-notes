/**
 * 交付对照图（0.4.2 外壳这一区）：把软件摆成和方案小样同一个状态，整窗截下来，再和小样并排（S/build2/shell/compare/）。
 * 只在截交付图时跑：CN_SHOTS=目录，CN_SHOT_TONE=dark 截深色（天青 / 深湖，B 浮岛书桌，同小样）。平时跳过。
 */
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, leftView, rail, tabOn, type Running } from './app'
import { armMenus, pickMenu } from './menu'
import { LECTURE } from './fixtures/pdf'

const DIR = process.env.CN_SHOTS
const DARK = process.env.CN_SHOT_TONE === 'dark'
test.skip(!DIR, '只在截交付图时跑（CN_SHOTS=目录）')

const look = (frame: 'a' | 'b', skin: string) => (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin, frame, winBg: 'aurora' } }))
}
const sky = look('b', DARK ? 'petrol' : 'sky')
async function shot(run: Running, name: string) {
  await run.page.waitForTimeout(450)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(DIR!, `${name}-${DARK ? 'dark' : 'light'}.png`), Buffer.from(b64, 'base64'))
}
async function open(page: Page, name: string, tab = name) {
  await page.keyboard.press('Meta+o')
  await page.keyboard.type(name)
  await page.waitForTimeout(200)
  await page.keyboard.press('Enter')
  await expect(tabOn(page)).toHaveText(tab)
}
const tree = (page: Page) => page.getByRole('tree', { name: '全部文件' })
const row = (page: Page, name: string) => tree(page).getByRole('treeitem').filter({ has: page.locator('.truncate', { hasText: new RegExp(`^${name}$`) }) })
async function expand(page: Page, path: string) {
  await leftView(page, '文件')
  for (const p of path.split('/')) if ((await row(page, p).getAttribute('aria-expanded')) !== 'true') await row(page, p).locator('.ft-tw').click()
}
const git = (vault: string, ...args: string[]) => execFileSync('git', ['-C', vault, ...args], { encoding: 'utf8' })

test('CN-98：点了历史的空白处（中间标记变灰、历史标题下一道强调色）；按 ⌘W 收起历史', async () => {
  const run = await launch(
    {
      '课程/ecpc/Lecture05.pdf': LECTURE,
      '课程/ecpc/Lecture05 笔记.md': '# Lecture05 笔记\n\n## 第 1 页 · 我的疑惑：这一页左边的神经元结构图和右边三条要点是什么关系？\n\n这一页讲的是神经形态计算想模仿的生物神经元长什么样。\n',
      '收件箱/冰岛行程.md': '# 冰岛行程\n\n第一天去雷克雅未克。\n',
    },
    { CN_AI_FAKE: '1' },
    sky,
  )
  const { page } = run
  try {
    await open(page, 'Lecture05.pdf')
    await open(page, '冰岛行程')
    await expand(page, '课程/ecpc')
    await row(page, '课程').locator('.truncate').click()
    await expect(tabOn(page)).toHaveText('课程')
    await page.getByTestId('tab-list').locator('.tab', { hasText: 'Lecture05.pdf' }).locator('.tl').click()
    await rail(page).getByRole('button', { name: /^笔记/ }).click()
    await rail(page).getByRole('button', { name: '历史' }).click()
    const hb = (await page.getByRole('complementary', { name: '历史' }).boundingBox())!
    await page.mouse.click(hb.x + hb.width / 2, hb.y + hb.height - 30)
    await expect(page.locator('.win')).toHaveAttribute('data-pane', 'rt')
    await shot(run, 'cn98-history')
    await page.keyboard.press('Meta+w')
    await expect(page.getByTestId('toast')).toContainText('收起了「历史」')
    await shot(run, 'cn98-after')
  } finally {
    await run.close()
  }
})

const TAB_NAMES = ['剪藏', 'Lecture05 笔记', '我的疑惑', '视频里的疑惑', '读书笔记', '写作计划', '本周复盘', '冰岛旅游2', '未命名 3', '课程', '2026-W47', '趣说明朝276年（微信读书出品）', '冰岛行程', '周记']
test('标签多了：16 个标签（首页、最近和 14 篇），左栏收起；右端「16 ⌄」打开的列表', async () => {
  const run = await launch(Object.fromEntries(TAB_NAMES.map((n) => [`收件箱/${n}.md`, `# ${n}\n\n正文。\n`])), { CN_AI_FAKE: '1' }, sky)
  const { page } = run
  try {
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('最近')
    await page.locator('.pal-row', { hasText: '按时间看全部笔记' }).first().click()
    await expect(tabOn(page)).toHaveText('最近')
    for (const n of TAB_NAMES) await open(page, n)
    await page.keyboard.press('Meta+Backslash')
    await expect(page.locator('.win')).toHaveClass(/side-hidden/)
    await page.locator('.center').click({ position: { x: 600, y: 400 } })
    await shot(run, 'tabs-16')
    await page.getByTestId('tab-more').click()
    await expect(page.getByRole('dialog', { name: '开着的标签' })).toBeVisible()
    await shot(run, 'tabs-list')
    await page.keyboard.press('Escape')
    // 点两下左箭头：两端都淡出、都有箭头，左端停在标签开头；鼠标停在左箭头上（悬停 --fill2）
    await page.getByTestId('tab-edge-left').click()
    await page.waitForTimeout(500)
    await page.getByTestId('tab-edge-left').click()
    await page.waitForTimeout(500)
    await expect(page.getByTestId('tab-edge-right')).toBeVisible()
    await page.getByTestId('tab-edge-left').hover()
    await shot(run, 'tabs-both')
  } finally {
    await run.close()
  }
})

test('标签多了 A 风格：35 高、动作只有图标，同一套淡出和「16 ⌄」', async () => {
  const run = await launch(Object.fromEntries(TAB_NAMES.map((n) => [`收件箱/${n}.md`, `# ${n}\n\n正文。\n`])), { CN_AI_FAKE: '1' }, look('a', DARK ? 'petrol' : 'sky'))
  const { page } = run
  try {
    for (const n of TAB_NAMES) await open(page, n)
    await page.keyboard.press('Meta+Backslash')
    await expect(page.locator('.win')).toHaveClass(/side-hidden/)
    await page.locator('.center').click({ position: { x: 600, y: 400 } })
    await shot(run, 'tabs-a')
  } finally {
    await run.close()
  }
})

test('右图标栏：文件夹页（笔记、大纲原地变淡）；首页点变淡的笔记，旁边说为什么', async () => {
  const run = await launch({ '课程/ecpc/Lecture05.pdf': LECTURE, '项目/冰岛旅行/住哪.md': '# 住哪\n\n## 雷克雅未克\n\n前两晚住老港口边上的青旅。\n' }, { CN_AI_FAKE: '1' }, sky)
  const { page } = run
  try {
    await open(page, 'Lecture05.pdf')
    await leftView(page, '文件')
    await row(page, '课程').locator('.truncate').click()
    await expect(tabOn(page)).toHaveText('课程')
    await open(page, '住哪')
    await page.getByTestId('tab-list').locator('.tab', { hasText: '课程' }).locator('.tl').click()
    await expect(tabOn(page)).toHaveText('课程')
    await page.mouse.move(700, 500)
    await shot(run, 'rbar-folder')
    await rail(page).getByRole('button', { name: /^笔记/ }).hover()
    await page.waitForTimeout(900)
    await shot(run, 'rbar-hover')
    await page.mouse.move(700, 500)
    await page.locator('header.titlebar').getByRole('button', { name: '首页', exact: true }).click()
    await expect(tabOn(page)).toHaveText('首页')
    await rail(page).getByRole('button', { name: /^笔记/ }).click()
    await expect(page.getByTestId('bar-say')).toBeVisible()
    await shot(run, 'rbar-say')
  } finally {
    await run.close()
  }
})

test('CN-108：删了课程/ecp 又放回来（历史最上面「放回」、目录树里亮一下、提示条）', async () => {
  const run = await launch(
    {
      '课程/ecp/Lecture05 笔记.md': '# Lecture05 笔记\n\n第 27 页。\n',
      '课程/ecp/Lecture05.pdf': LECTURE,
      '课程/ecp/加速器为何又快又省.html': '<!doctype html><title>加速器</title><p>为什么快</p>\n',
      '课程/ecp/我的疑惑.md': '# 我的疑惑\n\n为什么用脉冲？\n',
      '课程/ecpc/Lecture05 笔记.md': '# Lecture05 笔记\n\n第 1 页。\n',
      '课程/线性代数/第1讲.md': '# 第1讲\n',
      '收件箱/冰岛行程.md': '# 冰岛行程\n',
      '收件箱/冰岛旅游 3.md': '# 冰岛旅游 3\n',
    },
    { CN_AI_FAKE: '1' },
    sky,
  )
  const { page } = run
  try {
    await armMenus(run)
    await expand(page, '课程')
    await row(page, '课程').locator('.truncate').click()
    await expect(tabOn(page)).toHaveText('课程')
    await row(page, 'ecp').click({ button: 'right' })
    await pickMenu(run, '移到废纸篓')
    await expect(row(page, 'ecp')).toHaveCount(0)
    await rail(page).getByRole('button', { name: '历史' }).click()
    const del = page.getByRole('complementary', { name: '历史' }).getByTestId('history-commit').filter({ hasText: '移到废纸篓：课程/ecp' })
    await del.locator('.ch').click({ button: 'right' })
    await page.mouse.move(700, 600)
    await pickMenu(run, '把删掉的 4 个文件放回来')
    await expect(page.getByTestId('toast')).toContainText('放回了「课程/ecp」里的4个文件')
    await expect(page.locator('.ftree .ft-row.ring').first()).toBeVisible()
    await shot(run, 'cn108-restored')
  } finally {
    await run.close()
  }
})

test('CN-108：放回单篇（删掉的那次里右键「我的疑惑」→ 放回这一篇），提示条前面一个绿色对勾', async () => {
  const run = await launch(
    {
      '课程/ecp/Lecture05 笔记.md': '# Lecture05 笔记\n\n第 27 页。\n',
      '课程/ecp/Lecture05.pdf': LECTURE,
      '课程/ecp/加速器为何又快又省.html': '<!doctype html><title>加速器</title><p>为什么快</p>\n',
      '课程/ecp/我的疑惑.md': '# 我的疑惑\n\n为什么用脉冲？\n',
      '课程/ecpc/Lecture05 笔记.md': '# Lecture05 笔记\n\n第 1 页。\n',
      '课程/线性代数/第1讲.md': '# 第1讲\n',
      '收件箱/冰岛行程.md': '# 冰岛行程\n',
      '收件箱/冰岛旅游 3.md': '# 冰岛旅游 3\n',
    },
    { CN_AI_FAKE: '1' },
    sky,
  )
  const { page } = run
  try {
    await armMenus(run)
    await expand(page, '课程')
    await row(page, 'ecp').click({ button: 'right' })
    await pickMenu(run, '移到废纸篓')
    await expect(row(page, 'ecp')).toHaveCount(0)
    // 中间开着「课程」的首页（同小样），放回后 ecp 那张卡写「刚放回」
    await row(page, '课程').locator('.truncate').click()
    await expect(tabOn(page)).toHaveText('课程')
    await rail(page).getByRole('button', { name: '历史' }).click()
    const del = page.getByRole('complementary', { name: '历史' }).getByTestId('history-commit').filter({ hasText: '移到废纸篓：课程/ecp' })
    await expect(del).toBeVisible()
    await page.waitForTimeout(600)
    if (!/\bopen\b/.test((await del.getAttribute('class')) ?? '')) await del.locator('.ch').click()
    await expect(del).toHaveClass(/\bopen\b/)
    await del.getByRole('listitem').filter({ hasText: '我的疑惑' }).click({ button: 'right' })
    await page.mouse.move(700, 600)
    await pickMenu(run, '放回这一篇')
    await expect(page.getByTestId('toast')).toContainText('放回了「我的疑惑」')
    await shot(run, 'cn108-one')
  } finally {
    await run.close()
  }
})

test('CN-116：历史 ⋯ 的开关（默认藏起设置文件）；关掉以后设置提交回来、设置文件带齿轮', async () => {
  const LEFT = (left: string[]) => JSON.stringify({ 左边: left, 图标: {} }, null, 2) + '\n'
  const run = await launch(
    {
      '课程/ecpc/Lecture05 笔记.md': '# Lecture05 笔记\n\n第 27 页：生物神经元由树突、胞体、轴突组成。\n',
      '课程/ecpc/Lecture05.pdf': LECTURE,
      '课程/ecpc/我的疑惑.md': '# 我的疑惑\n',
      '课程/ecp/Lecture05 笔记.md': '# Lecture05 笔记\n\n第 1 页。\n',
      '课程/ecp/加速器为何又快又省.md': '# 加速器为何又快又省\n',
      '课程/ecp/我的疑惑.md': '# 我的疑惑\n\n为什么？\n',
      '课程/ecp/.首页.json': '{ "style": "a" }\n',
      '收件箱/冰岛行程.md': '# 冰岛行程\n',
      '.canvas-notes/左栏.json': LEFT(['课程', '收件箱', '课程/ecp']),
    },
    { CN_AI_FAKE: '1' },
    sky,
  )
  const { page, vault } = run
  try {
    await armMenus(run)
    // 改了一次左栏设置（单独一次提交）
    writeFileSync(join(vault, '.canvas-notes/左栏.json'), LEFT(['课程', '课程/ecp', '收件箱']))
    git(vault, 'commit', '-qam', '改了左栏设置')
    await expand(page, '课程')
    await row(page, 'ecp').click({ button: 'right' })
    await pickMenu(run, '移到废纸篓')
    await expect(row(page, 'ecp')).toHaveCount(0)
    await expand(page, '课程/ecpc')
    await row(page, 'Lecture05 笔记').click()
    await expect(tabOn(page)).toHaveText('Lecture05 笔记')
    writeFileSync(join(vault, '.canvas-notes/左栏.json'), LEFT(['收件箱', '课程']))
    git(vault, 'commit', '-qam', '改了左栏设置')
    await rail(page).getByRole('button', { name: '历史' }).click()
    const hist = page.getByRole('complementary', { name: '历史' })
    await expect(hist.getByTestId('history-commit').first()).toBeVisible()
    await hist.getByRole('button', { name: '更多' }).click()
    await expect(page.getByRole('dialog', { name: '历史的设置' })).toBeVisible()
    await shot(run, 'cn116-more')
    await page.getByRole('dialog', { name: '历史的设置' }).getByRole('menuitemcheckbox').click()
    await expect(hist.getByTestId('history-commit').filter({ hasText: '改了左栏设置' })).toHaveCount(2)
    const del = hist.getByTestId('history-commit').filter({ hasText: '移到废纸篓：课程/ecp' })
    if (!(await del.getByRole('list').count())) await del.locator('.ch').click()
    await page.mouse.move(700, 500)
    await shot(run, 'cn116-shown')
  } finally {
    await run.close()
  }
})

test('A 底栏右端（薄荷 / 松林，同设计稿）', async () => {
  const run = await launch({ '冰岛自驾.md': '# 冰岛自驾\n\n正文。\n' }, { CN_AI_FAKE: '1' }, look('a', DARK ? 'pine' : 'mint'))
  const { page } = run
  try {
    await expect(page.getByTestId('translate-engine')).toHaveText(/^译 · /)
    await shot(run, 'status-a')
  } finally {
    await run.close()
  }
})

test('A 底栏右端在彩色底栏上（天青 / 深湖）；「译」的菜单；铃的小点和列表', async () => {
  const run = await launch({ '冰岛自驾.md': '# 冰岛自驾\n\n正文。\n' }, { CN_AI_FAKE: '1', CN_TR_FAKE_CLI: 'codex=login' }, look('a', DARK ? 'petrol' : 'sky'))
  const { page } = run
  try {
    await expect(page.getByTestId('translate-engine')).toHaveText(/^译 · /)
    await shot(run, 'status-a-color')
    await page.getByTestId('translate-engine').click()
    await expect(page.getByRole('dialog', { name: '翻译用哪个AI' })).toBeVisible()
    await shot(run, 'status-a-tr')
    await page.keyboard.press('Escape')
    // 底栏说一句（关一个标签），铃上出小点；点开列出来
    await open(page, '冰岛自驾')
    await page.keyboard.press('Meta+w')
    await expect(page.getByTestId('toast')).toContainText('关掉了「冰岛自驾」')
    await expect(page.getByTestId('bell-dot')).toBeVisible()
    await shot(run, 'status-a-dot')
    await page.getByTestId('bell').click()
    await expect(page.getByRole('dialog', { name: '通知' })).toBeVisible()
    await shot(run, 'status-a-bell')
  } finally {
    await run.close()
  }
})

// 梦游预览（同 step14-dream-preview 的库）：A 风格整条底栏变成预览条（--acc-bg），左栏换到「文件」页、有改动的文件夹展开
const MAP = '---\ntype: board\n白板样式: 导图\n类型: 导图\n课程: 线性代数\n第几讲: 3\n来源: iPhone 拍的\n日期: 2026-11-15\nAI填的: 课程, 第几讲\n---\n# 导图 11-15 21∶40\n\n![原照片 · 11 月 15 日 21:40 · iPhone](../附件/导图/2026-11-15-2140.jpg)\n\n- 线性映射\n  - 定义\n  - 核与像\n'
test('梦游预览 A 风格：整条底栏变成预览条，左栏换到文件页、有改动的文件夹展开', async () => {
  const run = await launch(
    {
      '课程/线性代数/第3讲 线性映射.md': '# 第3讲 线性映射\n\n课上讲了线性映射的定义。\n',
      '课程/概率论/第1讲.md': '# 第1讲\n',
      '复习.md': '---\ntype: board\n---\n# 复习\n\n<!-- card id=a1 x=40 y=40 w=280 -->\n[[导图 11-15 21∶40]]\n',
      '收件箱/导图 11-15 21∶40.md': MAP,
      '附件/导图/2026-11-15-2140.jpg': readFileSync(join(__dirname, 'fixtures/handwritten-map.jpg')),
      '收件箱/一条速记.md': '---\ncreated: 2026-11-15 20:10\n---\n周末去花市买绣球，顺便看看多肉。\n',
      '收件箱/说不好的.md': '---\ncreated: 2026-11-15 20:30\n---\n一句说不好放哪的话。\n',
    },
    { CN_AI_FAKE: '1' },
    look('a', DARK ? 'petrol' : 'sky'),
  )
  const { page } = run
  try {
    await leftView(page, '梦游报告')
    const panel = page.getByRole('complementary', { name: '梦游报告' })
    await panel.getByRole('button', { name: '现在梦游' }).click()
    await expect(panel.getByTestId('dream-summary')).toContainText('点「预览」看改好后的样子', { timeout: 30_000 })
    await panel.getByRole('region', { name: '归类和改名' }).getByRole('button', { name: '预览' }).click()
    await expect(page.getByTestId('preview-bar')).toBeVisible()
    await expect(page.getByRole('complementary', { name: '文件' }).locator('.pv-ghost').first()).toBeVisible()
    await page.mouse.move(700, 500)
    await shot(run, 'dream-a')
  } finally {
    await run.close()
  }
})
