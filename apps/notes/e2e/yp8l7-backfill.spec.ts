// 以前问过、笔记里那一节没有图的（task-yp8l7）：打开那份 PDF 时照记下的框补一张，一次提交；记不下位置的报数；文件别的字一个不动；
// 打开那篇配对笔记也补（以前的完整对话文件里记着框的也认）；再打开不再补、不再说。
// 白板看法：一篇像用户那样长的配对笔记（十几节，每节标题、页码行、问题、翻译引用、小标题、列表、小结），每张问答卡整节都显示。一律无头。
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { acts, launch, openNote, pane, rail, tabOn, waitSaved } from './app'
import { LECTURE } from './fixtures/pdf'
import { PAIRED_MD, PAIRED_NOTE, PAIRED_PDF } from './fixtures/paired-long'

const notes = (page: Page) => page.getByRole('complementary', { name: '笔记', exact: true })
const git = (vault: string, ...a: string[]) => execFileSync('git', ['-C', vault, ...a], { encoding: 'utf8' }).trim()
const read = (vault: string) => readFileSync(join(vault, PAIRED_NOTE), 'utf8')
/** 去掉补进去的图那几行，应该和原来一字不差 */
const withoutCrops = (t: string) => t.replace(/\n\n!\[我框的\|\d+\]\(\.\.\/\.\.\/附件\/第3讲\/p\d-\d\.png\)/g, '')

async function openPdf(page: Page) {
  await page.keyboard.press('Meta+k')
  await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
  await page.locator('.pal-row', { hasText: '第3讲.pdf' }).first().click()
  await expect(tabOn(page)).toHaveText('第3讲.pdf')
}

test('打开 PDF：有框的位置的 12 节各补一张图（在第一问上面、照框截），没位置的 1 节报数，别的字不动、一次提交；右栏笔记顶上说一句；白板看法每张卡整节都在', async () => {
  test.setTimeout(120_000)
  const run = await launch({ [PAIRED_PDF]: LECTURE, [PAIRED_NOTE]: PAIRED_MD })
  const { page, vault } = run
  try {
    const before = Number(git(vault, 'rev-list', '--count', 'HEAD'))
    await openPdf(page)
    await expect.poll(() => read(vault).split('![我框的|').length - 1, { timeout: 20_000 }).toBe(12)
    const after = read(vault)
    expect(withoutCrops(after)).toBe(PAIRED_MD)
    // 图在那一节第二行（页码行）下面、第一问上面
    expect(after).toMatch(/<!-- cn:thread=第3讲-p1-1 -->\n\n!\[我框的\|\d+\]\(\.\.\/\.\.\/附件\/第3讲\/p1-1\.png\)\n\n> \[!question\] 先把这块翻译成中文，再讲一讲\n/)
    // 第 2 节没记下框的位置：不补
    expect(after).toMatch(/\[第 2 页\]\(第3讲\.pdf#page=2\) · 22:11 <!-- cn:thread=第3讲-p2-1 -->\n\n> \[!question\]/)
    // 一次提交、图和笔记一起，工作区干净
    await expect.poll(() => Number(git(vault, 'rev-list', '--count', 'HEAD'))).toBe(before + 1)
    expect(git(vault, 'log', '-1', '--format=%s')).toBe('笔记：第3讲 补上 12 张截图')
    expect(git(vault, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort()).toEqual([PAIRED_NOTE, ...readdirSync(join(vault, '附件/第3讲')).map((f) => `附件/第3讲/${f}`)].sort())
    expect(readdirSync(join(vault, '附件/第3讲'))).toHaveLength(12)
    expect(git(vault, 'status', '--porcelain')).toBe('')
    // 截图照框截：宽是框在 PDF 上 100% 时的宽（612 宽的页 × 框的比例），按 2 倍截
    const w = Number(/!\[我框的\|(\d+)\]\(\.\.\/\.\.\/附件\/第3讲\/p3-1\.png\)/.exec(after)![1])
    expect(Math.abs(w - 612 * 0.43)).toBeLessThanOrEqual(1)
    const png = readFileSync(join(vault, '附件/第3讲/p3-1.png'))
    expect(Math.abs(png.readUInt32BE(16) - w * 2)).toBeLessThanOrEqual(2)

    // 右栏笔记：顶上说一句，展开第一节有图
    await expect(page.getByTestId('toast')).toContainText('补上了 12 张截图；1 条当时没记下框的位置，补不了')
    if (!(await notes(page).isVisible())) await rail(page).getByRole('button', { name: '笔记', exact: true }).click()
    await expect(notes(page).getByTestId('crop-filled')).toHaveText('补上了 12 张截图；1 条当时没记下框的位置，补不了')
    await notes(page).getByTestId('note-round').first().locator('.fh').click()
    await expect(notes(page).locator('.crop img').first()).toBeVisible()

    // 打开配对笔记：不再补、不再提交；打开再保存一字不变
    await openNote(page, '第3讲 笔记')
    await expect(pane(page).locator('.cm-image img.jump').first()).toBeVisible()
    await waitSaved(page)
    expect(read(vault)).toBe(after)
    expect(Number(git(vault, 'rev-list', '--count', 'HEAD'))).toBe(before + 1)

    // 白板看法：「问过 AI」一列 13 处（白板只画看得到的卡），第一张整节都在（翻译引用、小标题、列表、最后一句、小结）、带图
    await acts(page).getByRole('tab', { name: '白板' }).click()
    const board = pane(page).getByTestId('doc-board')
    await expect(board.locator('.db-col', { hasText: '问过 AI' }).first()).toContainText('13处')
    const first = board.locator('.db-card', { hasText: '驾驶压力：行为与视觉线索的局限' })
    await expect(first.locator('a.db-ask-crop img')).toBeVisible()
    for (const s of ['先把这块翻译成中文，再讲一讲', '第 1 节的原文到这里', '前情：现有系统靠什么判断压力', 'CAN 总线', '视觉线索 → 会"看不见"', '第 1 节到此为止', '第 1 节小结'])
      await expect(first).toContainText(s)
    // 一列先摆 6 张，「还有7张，点开」以后最后一张（第 13 节）也整节都在
    await board.getByRole('button', { name: '还有7张，点开' }).click()
    const last = board.locator('.db-card', { hasText: '局限和以后' })
    await expect(last).toContainText('第 13 节到此为止')
    await expect(last).toContainText('第 13 节小结')
    await expect(board.locator('a.db-ask-crop img')).toHaveCount(12)
    // 不再写「完整对话 · 1轮」（新格式没有完整对话）
    await expect(board.getByText('完整对话')).toHaveCount(0)
  } finally {
    await run.close()
  }
})

test('打开配对笔记也补：笔记里没写框的、以前的完整对话文件里记着的也认；补完再开不再补', async () => {
  const note = PAIRED_MD.split('\n## ').slice(0, 3).join('\n## ') + '\n'
  const convo = '# 第3讲 · 第 2 页 · 完整对话\n\n[回到第 2 页](../../课程/线代/第3讲.pdf#page=2&rect=0.1,0.08,0.5,0.1)\n\n他问：给我讲解一下\n'
  const run = await launch({ [PAIRED_PDF]: LECTURE, [PAIRED_NOTE]: note, '.canvas-notes/对话/第3讲-p2-1.md': convo })
  const { page, vault } = run
  try {
    await openNote(page, '第3讲 笔记')
    await expect.poll(() => read(vault).split('![我框的|').length - 1, { timeout: 20_000 }).toBe(2)
    expect(withoutCrops(read(vault))).toBe(note)
    expect(read(vault)).toMatch(/<!-- cn:thread=第3讲-p2-1 -->\n\n!\[我框的\|306\]\(\.\.\/\.\.\/附件\/第3讲\/p2-1\.png\)\n/)
    await expect(page.getByTestId('toast')).toContainText('补上了 2 张截图')
    await expect(pane(page).locator('.cm-image img.jump').first()).toBeVisible()
    expect(git(vault, 'log', '-1', '--format=%s')).toBe('笔记：第3讲 补上 2 张截图')
    // 再打开 PDF：这次打开软件已经补过，不再补
    const n = git(vault, 'rev-list', '--count', 'HEAD')
    await openPdf(page)
    await page.waitForTimeout(1500)
    expect(git(vault, 'rev-list', '--count', 'HEAD')).toBe(n)
  } finally {
    await run.close()
  }
})
