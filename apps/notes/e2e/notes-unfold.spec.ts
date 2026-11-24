// 读 PDF 时右栏「笔记」每一问默认展开（2026-11-23 用户：「我看不到我问的内容 还有问的这个内容的时候的图片 能不能 默认展开 一键收起」）：
// 打开就看得到问的原话、我框的截图和回答；筛选那一行右边一颗「全部收起 / 全部展开」；单节还能自己点开收起，切走再回来照旧；只是看法，文件一字节不变。
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { gitStatus, launch, openNote, rail, tabOn, type Running } from './app'
import { LECTURE } from './fixtures/pdf'
import { solidPng } from './fixtures/png'

const PDF = '课程/线代/第3讲.pdf'
const NOTE = '课程/线代/第3讲 笔记.md'
const ASKS = ['这一块讲的是什么？', '为什么旋转矩阵的列是基向量去哪？', '行列式为负说明什么？']

const round = (n: number) =>
  [
    `## 第 ${n} 页 · 第 ${n} 问的标题`,
    `[第 ${n} 页](第3讲.pdf#page=${n}&rect=0.1,0.1,0.6,0.3) · 20:2${n} <!-- cn:thread=第3讲-p${n}-1 -->`,
    '',
    `![我框的|240](../../附件/第3讲/p${n}-1.png)`,
    '',
    `> [!question] ${ASKS[n - 1]}`,
    '',
    `第 ${n} 问的回答：先看图，再看公式。列就是基向量去哪，行列式是面积缩放的倍数。`,
    '',
    `> [!recap] 第 ${n} 问的小结。`,
    '',
  ].join('\n')

const TEXT = ['---', '类型: 笔记', '来源: "[[第3讲.pdf]]"', '---', '', '# 第3讲 笔记', '', round(1), round(2), round(3)].join('\n')

const notes = (page: Page) => page.getByRole('complementary', { name: '笔记', exact: true })
const SHOTS = '/private/tmp/canvas-notes-visual/83-附件点图跳文中'
async function shot(run: Running, name: string) {
  if (!process.env.CN_SHOTS) return
  await run.page.waitForTimeout(300)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(b64, 'base64'))
}

async function openPdf(page: Page) {
  await page.keyboard.press('Meta+k')
  await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
  await page.locator('.pal-row', { hasText: '第3讲.pdf' }).first().click()
  await expect(tabOn(page)).toHaveText('第3讲.pdf')
  await expect(page.locator('.pdfpane:not([hidden]) .pdfpage[data-page="1"] canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
}

test('右栏笔记：三问默认都展开（原话、我框的截图、回答都看得见）；全部收起都收、全部展开都开；单节收起后切走再回来照旧；文件一字节不变', async () => {
  const run = await launch(
    {
      [PDF]: LECTURE,
      [NOTE]: TEXT,
      ...Object.fromEntries([1, 2, 3].map((n) => [`附件/第3讲/p${n}-1.png`, solidPng(240, 90, [60 + n * 40, 140, 200])])),
    },
    {},
    (v) => {
      const ud = join(dirname(v), 'user-data')
      mkdirSync(ud, { recursive: true })
      writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: 'mint', frame: 'b' } }))
    },
  )
  const { page, vault } = run
  try {
    await openPdf(page)
    if (!(await notes(page).isVisible())) await rail(page).getByRole('button', { name: '笔记', exact: true }).click()
    const n = notes(page)
    const rounds = n.getByTestId('note-round')
    await expect(rounds).toHaveCount(3)
    // 三问都展开：标题、问的原话、我框的截图（真画出来了）、回答
    await expect(rounds.locator('.rh h3')).toHaveText(['第1页 · 第 1 问的标题', '第2页 · 第 2 问的标题', '第3页 · 第 3 问的标题'])
    await expect(rounds.locator('.fh')).toHaveCount(0)
    await expect(rounds.locator('.qs')).toHaveText(ASKS)
    await expect(rounds.locator('.crop img')).toHaveCount(3)
    await expect.poll(() => rounds.locator('.crop img').first().evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBe(240)
    await expect(rounds.locator('.crop img').first()).toBeVisible()
    await expect(rounds.first()).toContainText('第 1 问的回答：先看图，再看公式。')
    const all = n.getByTestId('notes-fold-all')
    await expect(all).toHaveAttribute('aria-label', '全部收起')
    await expect(all).toHaveAttribute('data-tip', '全部收起')
    await shot(run, '4-右栏笔记默认展开')

    // 全部收起：三问都收成一行，按钮换成全部展开
    await all.click()
    await expect(rounds.locator('.fh')).toHaveCount(3)
    await expect(rounds.locator('.crop img')).toHaveCount(0)
    await expect(all).toHaveAttribute('aria-label', '全部展开')
    await shot(run, '5-全部收起')
    // 全部展开：都开
    await all.click()
    await expect(rounds.locator('.fh')).toHaveCount(0)
    await expect(rounds.locator('.qs')).toHaveText(ASKS)
    await expect(all).toHaveAttribute('aria-label', '全部收起')

    // 单节收起（点标题那一行），切到别的标签再回来照旧收着
    await rounds.nth(1).locator('.rh').click()
    await expect(rounds.nth(1).locator('.fh')).toHaveCount(1)
    await expect(rounds.locator('.qs')).toHaveText([ASKS[0]!, ASKS[2]!])
    await openNote(page, '第3讲 笔记')
    await openPdf(page)
    if (!(await notes(page).isVisible())) await rail(page).getByRole('button', { name: '笔记', exact: true }).click()
    await expect(rounds).toHaveCount(3)
    await expect(rounds.nth(1).locator('.fh')).toHaveCount(1)
    await expect(rounds.locator('.qs')).toHaveText([ASKS[0]!, ASKS[2]!])
    // 还有一节开着：按钮仍是全部收起；单节点开
    await expect(all).toHaveAttribute('aria-label', '全部收起')
    await rounds.nth(1).locator('.fh').click()
    await expect(rounds.locator('.qs')).toHaveText(ASKS)

    // 只是看法：文件一字节不变，Git 干净
    expect(readFileSync(join(vault, NOTE), 'utf8')).toBe(TEXT)
    expect(gitStatus(vault)).toBe('')
  } finally {
    await run.close()
  }
})
