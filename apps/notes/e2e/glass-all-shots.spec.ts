/**
 * 所有栏半透明（task 界面 所有栏换半透明面板）的改前改后对照图：B 浮岛书桌 + 极光背景，天青 / 深湖，每个页面一张整窗，
 * 每张量正文、次要字对身后那一块的对比度（把字藏起来再截一次，逐像素比：字色对它身后每个像素，取最差的 5%）。
 * 只在给了 CN_SHOTS 时跑：CN_SHOTS=目录 CN_SHOTS_TAG=before|after（CN_SHOT_LOOK=sky 只截一套）。
 * 真点、真打开：图标栏的格、左栏的行、⌘K、⌘J、⌘,、右图标栏。
 */
import { expect, type Page, test } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ECP_DOC, EXERCISES, LECTURES } from '../../../packages/format/test/base-samples'
import { acts, launch, leftView, openNote, pane, rail, type Running, tabOn } from './app'
import { measure } from './contrast'
import { ICELAND } from './fixtures/board'
import { DOCS } from './fixtures/ecp-views'
import { DREAM2_VAULT, prepareDream2 } from './fixtures/dream2'
import { fakeBook } from './fixtures/fake-book'
import { LECTURE } from './fixtures/pdf'

const DIR = process.env.CN_SHOTS
const TAG = process.env.CN_SHOTS_TAG ?? 'after'
test.skip(!DIR, '只在截对照图时跑（CN_SHOTS=目录）')

const SKINS = (['sky', 'petrol'] as const).filter((s) => !process.env.CN_SHOT_LOOK || process.env.CN_SHOT_LOOK === s)

const pad = (n: number) => String(n).padStart(2, '0')
const D = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const FILES: Record<string, string | Uint8Array> = {
  '课程/ecp/ecp 课程计划.md': ECP_DOC,
  ...DOCS,
  ...LECTURES,
  ...EXERCISES,
  '课程/线代/第3讲.pdf': LECTURE,
  '课程/线代/第3讲 笔记.md': '# 第3讲 笔记\n\n## 定义\n\n线性：加起来再变和变了再加一样。\n\n## 例子\n\n旋转、投影、伸缩都是线性变换；平移不是。\n',
  '旅行/冰岛.md': ICELAND,
  '写作/小论文计划.md': `# 小论文计划\n\n截稿前把实验和初稿弄完，周五交给导师。\n\n## 这周\n\n- [ ] 读完三篇相关论文 📅 ${D(0)}\n- [ ] 交论文初稿 📅 ${D(1)} 15:00 🔔 提前1小时 ⏫\n- [x] 和导师约时间\n\n## 下周\n\n先把第二章的实验图补上，再改摘要。引用的几篇放在**参考文献**那一节，格式统一成 APA。\n\n> 写作不是把想好的东西抄下来，是在写的时候想清楚。\n\n- 补实验图\n- 改摘要\n- 查重\n`,
  '收件箱/待办.md': `# 待办\n\n- [ ] 交 ecp 作业 2 📅 ${D(-1)} 23:59 🔔 准时 ⏫\n- [ ] 回导师邮件 📅 ${D(0)} 10:30\n- [ ] 取快递 📅 ${D(0)} 18:00 🔔 提前30分钟\n- [ ] 订冰岛租车 📅 ${D(1)} 20:00 🔔 准时\n- [ ] 买打印纸\n`,
  '写作/待办.md': `# 待办\n\n- [ ] 改第二章的开头 📅 ${D(2)}\n- [ ] 给编辑发邮件 📅 ${D(3)} 10:00\n- [ ] 定专栏下期题目\n`,
  '收件箱/冰洞.md': '冰洞只在冬天开放，必须跟导游进去，提前两周订。\n',
}

const look = (skin: string) => (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin, frame: 'b', winBg: 'aurora' } }))
}

async function shot(run: Running, skin: string, name: string) {
  await run.page.mouse.move(720, 880)
  await run.page.waitForTimeout(500)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(DIR!, `${name}-${skin}-${TAG}.png`), Buffer.from(b64, 'base64'))
  const m = await measure(run, process.env.CN_MEASURE_DEBUG ? join(DIR!, `${name}-${skin}-${TAG}-hidden.png`) : undefined)
  const f = join(DIR!, `contrast-${TAG}.json`)
  const all = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {}
  all[`${name}-${skin}`] = m
  writeFileSync(f, JSON.stringify(all, null, 1))
}

async function start(files: Record<string, string | Uint8Array>, skin: string, env: Record<string, string> = {}, prep?: (v: string) => void) {
  mkdirSync(DIR!, { recursive: true })
  const run = await launch(files, { CN_AI_FAKE: '1', ...env }, (v) => {
    prep?.(v)
    look(skin)(v)
  })
  await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
  await expect.poll(() => run.page.evaluate(() => innerHeight)).toBe(887)
  return run
}

const bar = (page: Page) => page.getByRole('navigation', { name: '左栏' })

for (const skin of SKINS) {
  test(`各页对照图：${skin}`, async () => {
    test.setTimeout(240_000)
    const run = await start(FILES, skin)
    const { page } = run
    try {
      // 库首页
      await page.getByRole('button', { name: '首页', exact: true }).first().click()
      await page.waitForTimeout(600)
      await shot(run, skin, '01-home')

      // 文档 + 左栏文件树
      await leftView(page, '文件')
      await openNote(page, '小论文计划')
      await shot(run, skin, '02-doc')

      // 白板
      await openNote(page, '冰岛')
      await acts(page).getByRole('tab', { name: '白板' }).click()
      await expect(pane(page).locator('[data-testid="doc-board"], [data-testid="board"]').first()).toBeVisible()
      await shot(run, skin, '03-board')

      // 读 PDF + 右栏边读边问
      await page.keyboard.press('Meta+k')
      await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲.pdf')
      await page.locator('.pal-row', { hasText: '第3讲' }).first().click()
      await expect(tabOn(page)).toHaveText('第3讲.pdf')
      await page.keyboard.press('Meta+j')
      const ai = page.getByRole('complementary', { name: '边读边问 AI' })
      await acts(page).getByRole('button', { name: /问这一页/ }).click()
      await expect(ai.getByTestId('reading-msg').last().locator('.txt')).toContainText('列就是基向量去哪', { timeout: 20_000 })
      await shot(run, skin, '04-pdf-ai')
      await page.keyboard.press('Meta+j')

      // 数据库看板
      await openNote(page, 'ecp 看板')
      const db = pane(page).locator('[data-part="数据库块"]')
      await expect(db.locator('[data-part="看板一列"]')).toHaveCount(3)
      await shot(run, skin, '05-db-kanban')

      // 数据库表格 + 右栏开一条
      await openNote(page, 'ecp 课程计划')
      await pane(page).locator('[data-part="数据库块"]').getByRole('button', { name: '第3讲 生产', exact: true }).click()
      await expect(page.locator('.rpeek .rec-body .cm-content')).toContainText('短期只有劳动能变')
      await shot(run, skin, '06-db-record')

      // 数据库日历
      await openNote(page, 'ecp 日历')
      await shot(run, skin, '07-db-calendar')

      // 分类首页（课程）、收件箱首页、最近
      await leftView(page, '课程')
      await page.waitForTimeout(400)
      await shot(run, skin, '08-folder-home')
      await leftView(page, '收件箱')
      await page.waitForTimeout(400)
      await shot(run, skin, '09-inbox')
      await leftView(page, '最近')
      await page.waitForTimeout(400)
      await shot(run, skin, '10-recent')

      // 待办首页（目标样子）、日历格
      await bar(page).getByRole('button', { name: '待办', exact: true }).click()
      await expect(tabOn(page)).toHaveText('待办')
      await shot(run, skin, '11-todo')
      await bar(page).getByRole('button', { name: '日历', exact: true }).click()
      await page.waitForTimeout(500)
      await shot(run, skin, '12-calendar')

      // 设置
      await page.keyboard.press('Meta+Comma')
      await expect(page.getByRole('dialog', { name: '设置' })).toBeVisible()
      await shot(run, skin, '13-settings')
      await page.keyboard.press('Escape')
    } finally {
      await run.close()
    }
  })

  test(`网页 + 笔记、大纲：${skin}`, async () => {
    test.setTimeout(120_000)
    const book = await fakeBook()
    const NOTE = '课程/读书/学习笔记：动手学深度学习.md'
    const run = await start({ [NOTE]: `# 学习笔记：动手学深度学习\n\n## 2.1 数据操作\n\n张量就是多维数组。索引从 0 开始，-1 是最后一个。\n\n## 2.2 数据预处理\n\n缺失值用均值补，类别值单独编码。\n` }, skin)
    const { page } = run
    try {
      await openNote(page, '学习笔记：动手学深度学习')
      await rail(page).getByRole('button', { name: '网页', exact: true }).click()
      const web = page.getByRole('complementary', { name: '网页' })
      const addr = web.getByRole('textbox', { name: '网址' })
      await addr.click()
      await addr.fill(`${book.base}/chapter_preliminaries/ndarray.html`)
      await addr.press('Enter')
      await page.waitForTimeout(2500)
      await addr.blur()
      await shot(run, skin, '14-web')
      await rail(page).getByRole('button', { name: /^大纲/ }).click()
      await page.waitForTimeout(500)
      await shot(run, skin, '15-outline')
    } finally {
      await run.close()
      await book.close()
    }
  })

  test(`梦游报告：${skin}`, async () => {
    test.setTimeout(180_000)
    const run = await start(DREAM2_VAULT, skin, {}, prepareDream2)
    const { page } = run
    try {
      const card = page.getByTestId('dream-card')
      await card.getByRole('button', { name: '现在梦游' }).click()
      await expect(card.locator('h3')).toContainText('等你过目', { timeout: 60_000 })
      await card.getByRole('button', { name: '看报告' }).click()
      const panel = page.getByRole('complementary', { name: '梦游报告' })
      await panel.getByTestId('dream-item').filter({ hasText: '原名「极光」' }).click()
      await page.waitForTimeout(600)
      await shot(run, skin, '16-dream')
    } finally {
      await run.close()
    }
  })
}
