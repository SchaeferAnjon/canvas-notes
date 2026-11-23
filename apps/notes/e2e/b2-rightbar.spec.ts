/**
 * 右图标栏方向 A「原地变淡」（CN-117，0.4.2 施工）：「笔记」一直在最上面，用不上时和「大纲」一样变淡，悬停说为什么，
 * 点了不开右栏、旁边说一句；依次打开 PDF、文件夹页、文档、首页，五格的位置一点都不挪。真点、真悬停，窗口不上屏。
 */
import { expect, test, type Page } from '@playwright/test'
import { launch, leftView, rail, tabOn } from './app'
import { LECTURE } from './fixtures/pdf'

const PDF = '课程/ecpc/Lecture05.pdf'
const files = {
  [PDF]: LECTURE,
  '项目/冰岛旅行/住哪.md': '# 住哪\n\n## 雷克雅未克\n\n老港口边上的青旅。\n\n## 维克镇\n\n小木屋。\n',
}
const tree = (page: Page) => page.getByRole('tree', { name: '全部文件' })
const treeRow = (page: Page, name: string) => tree(page).getByRole('treeitem').filter({ has: page.locator('.truncate', { hasText: new RegExp(`^${name}$`) }) })
/** 右图标栏五格（不算右下角 AI 圆钮）：名字、变没变淡、离窗口顶多少 */
const bar = (page: Page) =>
  rail(page)
    .locator('button.ab')
    .evaluateAll((els) => els.map((e) => ({ name: e.getAttribute('aria-label')!.replace(/（.*$/, ''), dim: e.classList.contains('dim'), top: Math.round(e.getBoundingClientRect().top) })))
const notes = (page: Page) => rail(page).getByRole('button', { name: /^笔记/ })
const outline = (page: Page) => rail(page).getByRole('button', { name: /^大纲/ })

async function open(page: Page, name: string) {
  await page.keyboard.press('Meta+o')
  await page.keyboard.type(name)
  await page.waitForTimeout(200)
  await page.keyboard.press('Enter')
}

test('右图标栏：笔记一直在原位，用不上时变淡、悬停和点了都说为什么；PDF、文件夹页、文档、首页之间五格一点都不挪', async () => {
  const run = await launch(files)
  const { page } = run
  try {
    // PDF：五格都亮着（笔记能开）
    await open(page, 'Lecture05')
    await expect(tabOn(page)).toHaveText('Lecture05.pdf')
    await expect.poll(async () => (await bar(page)).map((b) => `${b.name}${b.dim ? '·淡' : ''}`)).toEqual(['笔记', '大纲', '相关·淡', '网页', '微信读书', '记录·淡', '自动化·淡', '历史'])
    const atPdf = (await bar(page)).map((b) => b.top)
    // 读 PDF 时开着「笔记」：右栏下格出来
    await notes(page).click()
    await expect(page.getByRole('complementary', { name: '笔记', exact: true })).toBeVisible()

    // 文件夹页（课程）：笔记、大纲变淡，位置不变；开着的笔记格收起
    await leftView(page, '文件')
    await treeRow(page, '课程').locator('.truncate').click()
    await expect(tabOn(page)).toHaveText('课程')
    await expect.poll(async () => (await bar(page)).map((b) => `${b.name}${b.dim ? '·淡' : ''}`)).toEqual(['笔记·淡', '大纲·淡', '相关·淡', '网页', '微信读书', '记录·淡', '自动化·淡', '历史'])
    expect((await bar(page)).map((b) => b.top)).toEqual(atPdf)
    await expect(page.getByRole('complementary', { name: '笔记', exact: true })).toHaveCount(0)
    // 悬停变淡的笔记：名字后面说为什么
    await notes(page).hover()
    await expect(page.getByTestId('tooltip')).toHaveText('笔记（打开 PDF、或右栏开着配好对的网站时才有笔记）')
    // 点它：不开右栏，旁边说一句
    await notes(page).click()
    await expect(page.getByTestId('bar-say')).toHaveText('打开 PDF、或右栏开着配好对的网站时才有笔记')
    await expect(page.getByTestId('tooltip')).toHaveCount(0)
    await expect(page.getByRole('complementary', { name: '笔记', exact: true })).toHaveCount(0)
    expect(await page.locator('.win').evaluate((w) => w.classList.contains('with-right'))).toBe(false)
    // 说的那句在笔记格左边、竖着居中
    const say = (await page.getByTestId('bar-say').boundingBox())!
    const nb = (await notes(page).boundingBox())!
    expect(say.x + say.width).toBeLessThanOrEqual(nb.x - 6)
    expect(Math.abs(say.y + say.height / 2 - (nb.y + nb.height / 2))).toBeLessThanOrEqual(1)
    // 点别处收起；点变淡的大纲说它的
    await page.mouse.click(700, 500)
    await expect(page.getByTestId('bar-say')).toHaveCount(0)
    await outline(page).click()
    await expect(page.getByTestId('bar-say')).toHaveText('这一页没有标题，没有大纲')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('bar-say')).toHaveCount(0)
    expect(await page.locator('.win').evaluate((w) => w.classList.contains('with-right'))).toBe(false)

    // 文档：大纲亮，笔记淡；位置不变
    await open(page, '住哪')
    await expect(tabOn(page)).toHaveText('住哪')
    await expect.poll(async () => (await bar(page)).map((b) => `${b.name}${b.dim ? '·淡' : ''}`)).toEqual(['笔记·淡', '大纲', '相关', '网页', '微信读书', '记录·淡', '自动化·淡', '历史'])
    expect((await bar(page)).map((b) => b.top)).toEqual(atPdf)
    await outline(page).click()
    await expect(page.getByRole('complementary', { name: '大纲' })).toBeVisible()
    await outline(page).click()

    // 首页：笔记、大纲都淡；位置不变
    await page.locator('header.titlebar').getByRole('button', { name: '首页', exact: true }).click()
    await expect(tabOn(page)).toHaveText('首页')
    await expect.poll(async () => (await bar(page)).map((b) => `${b.name}${b.dim ? '·淡' : ''}`)).toEqual(['笔记·淡', '大纲·淡', '相关·淡', '网页', '微信读书', '记录·淡', '自动化·淡', '历史'])
    expect((await bar(page)).map((b) => b.top)).toEqual(atPdf)

    // 回到 PDF：笔记又亮，上次开着的笔记格回来
    await open(page, 'Lecture05')
    await expect.poll(async () => (await bar(page)).map((b) => `${b.name}${b.dim ? '·淡' : ''}`)).toEqual(['笔记', '大纲', '相关·淡', '网页', '微信读书', '记录·淡', '自动化·淡', '历史'])
    await expect(page.getByRole('complementary', { name: '笔记', exact: true })).toBeVisible()
    expect((await bar(page)).map((b) => b.top)).toEqual(atPdf)
  } finally {
    await run.close()
  }
})
