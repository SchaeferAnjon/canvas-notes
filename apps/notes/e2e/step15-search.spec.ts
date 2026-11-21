// 第 3 段：三层搜索（用户 2026-11-15 定，设计 design/pdf/ 方向 A §1.10）。
// 一个框：文字（笔记和 PDF 里的字，命中跳到那页闪一下）→ 意思相近（本机小模型，真的模型）→ 最后一行「让 Claude 帮我找」（假引擎）。
import { expect, test, type Page } from '@playwright/test'
import { launch, pane, acts, tabOn } from './app'
import { LECTURE } from './fixtures/pdf'

const PDF = '课程/线性代数/第3讲 线性映射.pdf'
const pal = (page: Page) => page.getByRole('dialog', { name: '搜索和命令' })
const box = (page: Page) => pal(page).getByRole('textbox', { name: '搜索笔记、输入网址或命令' })
const group = (page: Page, name: string) => pal(page).locator('.pal-g', { hasText: name })
const pdfPane = (page: Page) => page.locator('.pdfpane:not([hidden])')

async function indexReady(page: Page) {
  await expect.poll(async () => (await page.evaluate(() => window.cnSearch.status())).phase, { timeout: 60_000 }).toBe('ready')
}

const files: Record<string, string | Uint8Array> = {
  [PDF]: LECTURE,
  '课程/线性代数/第3讲 线性映射 笔记.md': '# 第3讲 线性映射 笔记\n\n满足 T(u+v)=T(u)+T(v) 和 T(cv)=cT(v) 的映射叫线性映射，每个线性映射在一组基下都能写成一个矩阵。\n',
  '生活/周末.md': '# 周末\n\n周末去爬山，带上水和三明治。\n',
  '旅行/冰岛.md': '# 冰岛\n\n自驾环岛，每天晚上看极光预报网站决定去哪个山谷。\n',
}
for (let i = 1; i <= 8; i++) files[`日记/第 ${i} 天.md`] = `# 第 ${i} 天\n\n今天又记了一笔开销。\n`

test('⌘F 三层：PDF 里的字跳到那页闪一下；按意思找到写「线性映射」的笔记；每组最多 5 条；搜不到时让 Claude 帮我找，过程和结果都显示', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1', CN_FAKE_FIND_MS: '800' })
  const { page } = run
  try {
    await indexReady(page)

    // ---- 文字：PDF 里的字，带页码，命中的词标出来；点了 PDF 翻到第 3 页，那一段闪一下 ----
    await page.keyboard.press('Meta+f')
    await box(page).fill('rotated e1')
    await expect(group(page, '笔记和PDF里的字')).toBeVisible()
    const hit = pal(page).getByRole('option').filter({ hasText: '第3讲 线性映射.pdf' }).filter({ hasText: '第3页' })
    await expect(hit).toHaveCount(1)
    await expect(hit.locator('mark.sr-hit').first()).toHaveText(/rotated/i)
    await hit.click()
    await expect(pal(page)).toHaveCount(0)
    await expect(tabOn(page)).toHaveText('第3讲 线性映射.pdf')
    await expect(pdfPane(page).locator('.pdfslot').nth(2).getByTestId('pdf-flash')).toBeAttached({ timeout: 10_000 })
    await expect(acts(page).getByTestId('pdf-pager')).toHaveText('3 / 5')

    // ---- 意思相近：「矩阵怎么变换」字面上哪都没有，本机小模型找到写「线性映射」的笔记 ----
    await page.keyboard.press('Meta+f')
    await box(page).fill('矩阵怎么变换')
    await expect(group(page, '意思相近')).toContainText('本机小模型，不联网')
    const near = pal(page).getByRole('option').filter({ hasText: '第3讲 线性映射 笔记' })
    await expect(near).toBeVisible()
    // 不沾边的（爬山）不硬凑
    await expect(pal(page).getByRole('option').filter({ hasText: '周末' })).toHaveCount(0)
    // 最后一行永远是让 Claude 帮我找
    await expect(pal(page).getByRole('option').last()).toHaveText(/让Claude帮我找「矩阵怎么变换」.*几秒到十几秒/)
    await near.click()
    await expect(tabOn(page)).toHaveText('第3讲 线性映射 笔记')

    // ---- 每组最多 5 条，多的「还有 N 条」，点了多显示 ----
    await page.keyboard.press('Meta+f')
    await box(page).fill('开销')
    const textRows = pal(page).getByRole('option').filter({ hasText: '今天又记了一笔开销' })
    await expect(textRows).toHaveCount(5)
    await pal(page).getByRole('option', { name: '还有3条' }).click()
    await expect(textRows).toHaveCount(8)
    await expect(pal(page)).toBeVisible()

    // ---- 搜不到：让 Claude 帮我找（假引擎翻文件），过程一步步显示，找到的点了打开 ----
    await box(page).fill('极光在哪个网站看')
    await expect(pal(page).locator('.pal-none')).toHaveText('笔记和PDF里都没有「极光在哪个网站看」这几个字')
    const ask = pal(page).getByRole('option').filter({ hasText: '让Claude帮我找「极光在哪个网站看」' })
    await ask.click()
    await expect(pal(page).getByRole('option').filter({ hasText: 'Claude在翻文件…' })).toContainText('已看0个 · 搜「极光在哪个网站看」')
    await expect(group(page, 'Claude找到的')).toBeVisible({ timeout: 10_000 })
    // Claude 找到的每条两行：名字，下面一句为什么（意思相近那一层也可能已经列了冰岛）
    const found = pal(page).locator('.pal-row.two', { hasText: '冰岛' })
    await expect(found).toContainText('极光')
    await found.click()
    await expect(tabOn(page)).toHaveText('冰岛')
  } finally {
    await run.close()
  }
})

test('新加的 PDF 不用重开就搜得到它里面的字（搜索进程自己盯着库）', async () => {
  const run = await launch({ '说明.md': '# 说明\n' }, {})
  const { page, vault } = run
  try {
    await indexReady(page)
    const { writeFileSync, mkdirSync } = await import('node:fs')
    mkdirSync(`${vault}/课程`, { recursive: true })
    writeFileSync(`${vault}/课程/新课件.pdf`, LECTURE)
    // 搜索进程看到新文件（停 1.5 秒没动静再扫）
    await expect.poll(async () => (await page.evaluate(() => window.cnSearch.pdfText('kernel'))).length, { timeout: 20_000 }).toBe(1)
    await page.keyboard.press('Meta+f')
    await box(page).fill('kernel')
    await expect(pal(page).getByRole('option').filter({ hasText: '新课件.pdf' }).filter({ hasText: '第4页' })).toHaveCount(1)
  } finally {
    await run.close()
  }
})

test('⌘O 按名字跳：空着列最近打开的，字都出现就算，PDF 右边是问到哪；md、PDF、HTML 都能开', async () => {
  const run = await launch({
    [PDF]: LECTURE,
    '课程/线性代数/第3讲 线性映射 笔记.md': '---\n类型: 笔记\n进度: 5/10\n---\n## 第 5 页\n',
    '课程/线性代数/旋转矩阵.html': '<!doctype html><title>旋转矩阵</title><p>拖动角度</p>',
    '生活/周末.md': '# 周末\n',
  })
  const { page } = run
  const quick = page.getByRole('dialog', { name: '按名字跳到' })
  const input = quick.getByRole('textbox', { name: '按名字跳到文件' })
  const rows = quick.getByRole('option')
  try {
    await page.keyboard.press('Meta+o')
    await expect(input).toBeFocused()
    await expect(quick.locator('.pal-g')).toHaveText('最近打开')
    // 字按顺序都出现就算：「3映射」找到第3讲的课件和笔记，课件右边写问到 5/10
    await input.fill('3映射')
    await expect(rows).toHaveCount(2)
    await expect(rows.first()).toContainText('第3讲 线性映射.pdf')
    await expect(rows.first()).toContainText('课程/线性代数')
    await expect(rows.first().locator('.rt')).toHaveText('5/10')
    await input.press('Enter')
    await expect(quick).toHaveCount(0)
    await expect(tabOn(page)).toHaveText('第3讲 线性映射.pdf')

    // HTML 也在里面，开成 HTML 标签
    await page.keyboard.press('Meta+o')
    await input.fill('旋转')
    await rows.filter({ hasText: '旋转矩阵.html' }).click()
    await expect(tabOn(page)).toHaveText('旋转矩阵')

    // 再按 ⌘O：最近打开的在最前
    await page.keyboard.press('Meta+o')
    await expect(rows.nth(0)).toContainText('旋转矩阵.html')
    await expect(rows.nth(1)).toContainText('第3讲 线性映射.pdf')
    await input.fill('没有这个')
    await expect(quick.locator('.pal-none')).toHaveText('没有叫「没有这个」的文件')
    await input.press('Escape')
    await expect(quick).toHaveCount(0)
    // ⌘K 里也有这一条
    await page.keyboard.press('Meta+k')
    await box(page).fill('按名字')
    await pal(page).getByRole('option').filter({ hasText: '按名字跳到…' }).click()
    await expect(input).toBeFocused()
  } finally {
    await run.close()
  }
})
