/**
 * task-x7mk6：梦游对照里能点的东西接上和文档 ⌘点、AI 回答引用（cite.tsx）同一套点法。
 * 用户（0.5.1 截图：对照「收下后」那一栏末尾新加的「相关 [[第三方]]」点不开）：「这个能不能按住cmd 然后左键打开啊」。
 * 以前对照里的两栏（和「收下后的样子」）是只读编辑器，只装了实时预览，没装文档里接 ⌘点的那段（note-doc.ts），谁都不接点击。
 * 现在：点一下出预览卡；⌘点打开（到那一篇 / 那一页）；⇧⌘点开在后面的新标签；网页 ⌥⌘点在中间栏开；「第 N 页」点一下就翻过去。
 * 指向这次梦游新建、改名后还没收下的笔记：开梦游分支上那一份（和文件条「打开「x」· 梦游分支上的」一样）。
 * 样本库照 m552v-dream（e2e/fixtures/dream2.ts），「极光」那篇的「视频 · youtube.com」改成一个网页链接。都是真点，窗口不上屏。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { acts, launch, tabOn, type Running } from './app'
import { AURORA, AURORA_MD, DREAM2_VAULT, prepareDream2 } from './fixtures/dream2'

const VIZ_TITLE = '旋转矩阵 · 拖动角度看基向量'
const VAULT = { ...DREAM2_VAULT, [AURORA]: AURORA_MD.replace('视频 · youtube.com · 剪于', '[视频 · youtube.com](https://www.youtube.com/watch?v=aurora) · 剪于') }

async function dreamed(): Promise<{ run: Running; page: Page; panel: Locator }> {
  const run = await launch(VAULT, { CN_AI_FAKE: '1' }, prepareDream2)
  const { page } = run
  const card = page.getByTestId('dream-card')
  await card.getByRole('button', { name: '现在梦游' }).click()
  await expect(card.locator('h3')).toContainText('等你过目', { timeout: 60_000 })
  await card.getByRole('button', { name: '看报告' }).click()
  const panel = page.getByRole('complementary', { name: '梦游报告' })
  await expect(panel.getByTestId('dream-item')).toHaveCount(7)
  return { run, page, panel }
}

const item = (panel: Locator, text: string | RegExp) => panel.getByTestId('dream-item').filter({ hasText: text })
const dtab = (page: Page) => page.locator('[data-testid="dream-tab"]:not([hidden])')
const card = (page: Page) => page.getByRole('dialog', { name: '引用' })
const tabs = (page: Page) => page.getByTestId('tab-list').locator(':scope > .tab')
const after = (page: Page) => dtab(page).locator('.cm-merge-b')
const beforeCol = (page: Page) => dtab(page).locator('.cm-merge-a')

async function openItem(page: Page, panel: Locator, text: string | RegExp, file?: string) {
  await item(panel, text).click()
  if (file) await panel.getByTestId('dream-detail').getByTestId('dream-change').filter({ hasText: file }).click()
  await expect(dtab(page)).toBeVisible()
  if (file) await expect(dtab(page).getByTestId('dream-fbar')).toContainText(file)
}

/** 这时闪到第几下（还没闪过是 0）：换看法前先记下，等闪出比它新的那一下 */
const flashN = async (page: Page) => Number((await dtab(page).locator('.dv-flash').getAttribute('data-n', { timeout: 500 }).catch(() => null)) ?? 0)
/**
 * 对照（或收下后的样子）一画好就自己滚到第一处改动、闪一下：等闪出比 before 新的那一下（这一回滚完了）再点、再滚。
 * 机器忙时画好到滚过去中间隔几帧，这时点下去，点的地方被滚走了；上一回闪的那一下还留着 1.7 秒，不能只等「有闪」
 */
const scrolledToChange = (page: Page, before: number) =>
  expect.poll(async () => flashN(page), { timeout: 10_000 }).toBeGreaterThan(before)

/** 回到梦游对照那个标签 */
const backToDream = (page: Page) => tabs(page).filter({ hasText: '梦游 ·' }).first().click()

test('用户截图那一处：补上的双链「相关：[[极光预报]]」点一下出预览卡，⌘点开那篇，⇧⌘点开在后面不切走；收下后的样子、改前那栏一样能点', async () => {
  const { run, page, panel } = await dreamed()
  try {
    await openItem(page, panel, '↔ [[极光预报]]')
    await scrolledToChange(page, 0)
    const link = after(page).locator('.cm-wikilink', { hasText: '极光预报' })
    await expect(link).toBeVisible()
    expect(await link.evaluate((e) => getComputedStyle(e).cursor)).toBe('pointer')

    // 点一下：预览卡（标题、在哪、正文开头），不开标签
    const n = await tabs(page).count()
    await link.click()
    await expect(card(page)).toBeVisible()
    await expect(card(page).locator('.top b')).toHaveText('极光预报')
    await expect(card(page).locator('.u')).toHaveText('库根目录')
    await expect(card(page).locator('.ex p').first()).toContainText('每天下午看冰岛气象局的云量图')
    await expect(card(page).locator('.acts button')).toHaveText(['打开 ⌘点', '新标签打开 ⇧⌘点', '拷贝'])
    expect(await tabs(page).count()).toBe(n)
    // 卡收在中间这一栏里
    const col = (await dtab(page).boundingBox())!
    const cb = (await card(page).boundingBox())!
    expect(cb.x).toBeGreaterThanOrEqual(col.x + 7)
    expect(cb.x + cb.width).toBeLessThanOrEqual(col.x + col.width - 7)
    await page.screenshot({ path: test.info().outputPath('card-wiki.png') })
    await page.keyboard.press('Escape')
    await expect(card(page)).toHaveCount(0)

    // ⇧⌘点：开在后面的新标签，还停在梦游对照
    await link.click({ modifiers: ['Meta', 'Shift'] })
    await expect(tabs(page)).toHaveCount(n + 1)
    await expect(tabOn(page)).toContainText('梦游 ·')
    // ⇧ 点不把对照里的字扩选上
    expect(await page.evaluate(() => window.getSelection()?.isCollapsed ?? true)).toBe(true)

    // ⌘点：中间开《极光预报》
    await link.click({ modifiers: ['Meta'] })
    await expect(tabOn(page)).toHaveText('极光预报')

    // 收下后的样子：一样能 ⌘点
    await backToDream(page)
    let shown = await flashN(page)
    await acts(page).getByRole('tab', { name: '收下后的样子' }).click()
    await scrolledToChange(page, shown)
    const one = dtab(page).locator('.dv-after .cm-wikilink', { hasText: '极光预报' })
    await one.click()
    await expect(card(page).locator('.top b')).toHaveText('极光预报')
    await page.keyboard.press('Escape')
    await backToDream(page)
    await one.click({ modifiers: ['Meta'] })
    await expect(tabOn(page)).toHaveText('极光预报')

    // 改前那一栏：附件图片点一下出卡（写图存在哪），⌘点打开那张图
    await backToDream(page)
    shown = await flashN(page)
    await acts(page).getByRole('tab', { name: '对照' }).click()
    // 换回对照时先自己滚到第一处改动（文末那一行）：等它滚完再滚回顶上，不然那一滚把这里的滚回顶上又带回去了
    await scrolledToChange(page, shown)
    await dtab(page).getByTestId('dream-scroll').evaluate((el) => (el.scrollTop = 0))
    const img = beforeCol(page).locator('.cm-image img').first()
    await img.click()
    await expect(card(page).locator('.top b')).toHaveText('封面.png')
    await expect(card(page).locator('.u')).toHaveText('附件/视频/极光')
    await page.keyboard.press('Escape')
    await img.click({ modifiers: ['Meta'] })
    await expect(tabOn(page)).toContainText('封面.png')

    // 合一：一样 ⌘点
    await backToDream(page)
    await acts(page).getByRole('tab', { name: '合一' }).click()
    const uni = dtab(page).locator('.dv-unified .cm-wikilink', { hasText: '极光预报' })
    await uni.scrollIntoViewIfNeeded()
    await uni.click({ modifiers: ['Meta'] })
    await expect(tabOn(page)).toHaveText('极光预报')
  } finally {
    await run.close()
  }
})

test('网页链接：点一下卡上写网址，⌥⌘点在中间栏开一个网页标签', async () => {
  const { run, page, panel } = await dreamed()
  try {
    await openItem(page, panel, '↔ [[极光预报]]')
    // 对照打开时滚到末尾那处改动，文首那几行编辑器还没画：先滚回去
    await dtab(page).getByTestId('dream-scroll').evaluate((el) => (el.scrollTop = 0))
    const web = after(page).locator('.cm-link', { hasText: '视频 · youtube.com' })
    await web.click()
    await expect(card(page).locator('.u')).toHaveText('youtube.com/watch?v=aurora')
    await expect(card(page).locator('.acts button')).toHaveText(['右栏打开 ⌘点', '中间栏打开 ⌥⌘点', '拷贝'])
    await page.keyboard.press('Escape')
    const n = await tabs(page).count()
    await web.click({ modifiers: ['Meta', 'Alt'] })
    await expect(tabs(page)).toHaveCount(n + 1)
    await expect(tabOn(page)).not.toContainText('梦游 ·')
  } finally {
    await run.close()
  }
})

test('读 PDF 的笔记里「第 N 页」：点一下就翻到那一页（和 AI 回答里的页码小牌一样）', async () => {
  const { run, page, panel } = await dreamed()
  try {
    await openItem(page, panel, VIZ_TITLE)
    const pg = after(page).locator('.cm-link', { hasText: /^第 3 页$/ }).first()
    await pg.scrollIntoViewIfNeeded()
    await pg.click()
    await expect(tabOn(page)).toContainText('.pdf')
    await expect(acts(page).getByTestId('pdf-pager')).toHaveText(/^3 \//, { timeout: 15_000 })
  } finally {
    await run.close()
  }
})

test('改名还没收下：「冰岛行程」里换成的 [[极光 2]] 库里还没有，卡上说在梦游分支上，⌘点开梦游分支上那一份', async () => {
  const { run, page, panel } = await dreamed()
  try {
    await openItem(page, panel, '原名「极光」', '冰岛行程')
    // 改了的「 2」另包一层，一个双链拆成两截，点哪截都一样
    const link = after(page).locator('.cm-wikilink[data-target="极光 2"]').first()
    await link.scrollIntoViewIfNeeded()
    await link.click()
    await expect(card(page).locator('.top b')).toHaveText('极光 2')
    await expect(card(page).locator('.u')).toHaveText('梦游分支上的 · 收下后才在库里')
    await expect(card(page).locator('.ex p').first()).toContainText('视频 · youtube.com')
    await expect(card(page).locator('.acts button').first()).toHaveText('打开分支上那份 ⌘点')
    await page.screenshot({ path: test.info().outputPath('card-branch.png') })
    await page.keyboard.press('Escape')
    await link.click({ modifiers: ['Meta'] })
    await expect(tabOn(page)).toContainText('极光 2 · 梦游分支上的')
    // 没开出「极光 2」空白新笔记
    expect(existsSync(join(run.vault, '极光 2.md'))).toBe(false)
  } finally {
    await run.close()
  }
})
