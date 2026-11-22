/**
 * 交付对照图（task-j2vv8 笔记里「第 3 页」链接）：整窗 1440×887 截，改之前、改之后同一串操作各截一组。
 * 只在截交付图时跑：CN_SHOTS=目录，CN_SHOT_TONE=dark 截深湖（不给是天青），CN_SHOT_TAG 加在文件名里（old / new）。平时跳过。
 */
import { expect, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { acts, launch, openNote, pane, type Running } from './app'
import { LECTURE } from './fixtures/pdf'

const DIR = process.env.CN_SHOTS
const DARK = process.env.CN_SHOT_TONE === 'dark'
test.skip(!DIR, '只在截交付图时跑（CN_SHOTS=目录）')

const tag = `${process.env.CN_SHOT_TAG ?? 'new'}-${DARK ? 'dark' : 'light'}`
const look = (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: DARK ? 'petrol' : 'sky', frame: 'b', winBg: 'aurora' } }))
}
const PDF = '课程/study project 2/YitingWei_2026_BST-GATNet.pdf'
const NOTE = '课程/study project 2/YitingWei_2026_BST-GATNet 笔记.md'
const MD =
  '---\n类型: 笔记\n课程: study project 2\n来源: "[[YitingWei_2026_BST-GATNet.pdf]]"\n---\n# YitingWei_2026_BST-GATNet 笔记\n\n还是那个信号速度差异的道理：快信号看波形，慢信号看统计量，一种处理方式顾不全，就分两路。细节都在[第 3 页](#page=3)。\n\n' +
  '固定的邻接矩阵做不到这种「看情况换参考对象」，可学习的注意力能。[第 4 页](YitingWei_2026_BST-GATNet.pdf#page=4&rect=0.1,0.2,0.6,0.25) 的图就是把这些权重画出来。\n\n' +
  '## 第 2 页 · 图注意力\n[第 2 页](YitingWei_2026_BST-GATNet.pdf#page=2&rect=0.05,0.3,0.5,0.3) · 10:20 <!-- cn:thread=YitingWei-p2-1 -->\n\n> [!question] 这是啥意思？\n\n每个节点都看得到所有节点，权重由**多头自注意力**算出来，公式在[第 5 页](#page=5)。\n' +
  '\n## 第 3 页 · 两路怎么合\n[第 3 页](YitingWei_2026_BST-GATNet.pdf#page=3&rect=0.1,0.4,0.8,0.3) · 10:31 <!-- cn:thread=YitingWei-p3-1 -->\n\n> [!question] 两路最后怎么合在一起？\n\n' +
  '快的那一路用卷积和图注意力看波形，慢的那一路只看统计量，最后两路的特征**拼起来再过一层全连接**，输出压力不压力；拼之前各自先做归一化，不然统计量那一路的数大，会把波形那一路压下去；具体的维度表在[第 4 页](YitingWei_2026_BST-GATNet.pdf#page=4&rect=0.1,0.2,0.6,0.25)，消融实验在[第 5 页](#page=5)，去掉任何一路准确率都掉三到五个点。\n'

async function shot(run: Running, name: string) {
  await run.page.waitForTimeout(700)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(DIR!, `${name}-${tag}.png`), Buffer.from(b64, 'base64'))
}

test('第 3 页链接：文档 ⌘点、白板里点', async () => {
  test.setTimeout(120_000)
  mkdirSync(DIR!, { recursive: true })
  const run = await launch({ [PDF]: LECTURE, [NOTE]: MD }, {}, look)
  const { page } = run
  /** 改好的代码：等 PDF 翻到第 n 页、那一页画好再截（改之前的开出的是空白标签，不等） */
  const settled = async (n: number) => {
    if (process.env.CN_SHOT_TAG === 'old') return
    await expect(acts(page).getByTestId('pdf-pager')).toHaveText(`${n} / 5`, { timeout: 10_000 })
    await expect(page.locator(`.pdfpane:not([hidden]) .pdfpage[data-page="${n}"] canvas[data-ready="1"]`)).toBeAttached({ timeout: 15_000 })
    await page.waitForTimeout(800)
  }
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    await expect.poll(() => page.evaluate(() => innerHeight)).toBe(887)
    await openNote(page, 'YitingWei_2026_BST-GATNet 笔记')
    const link = pane(page).locator('.cm-link', { hasText: '第 3 页' }).first()
    await link.hover()
    await expect(page.getByRole('dialog', { name: '链接' })).toBeVisible()
    await shot(run, '1-card')
    await link.click({ modifiers: ['Meta'] })
    await page.mouse.move(700, 870)
    await settled(3)
    await shot(run, '2-cmd-click')
    await page.getByTestId('tab-list').locator(':scope > .tab', { hasText: 'YitingWei_2026_BST-GATNet 笔记' }).click()
    await acts(page).getByRole('tab', { name: '白板' }).click()
    await expect(pane(page).getByTestId('doc-board')).toBeVisible()
    await page.mouse.move(700, 870)
    await shot(run, '3-board')
    // 指着文字卡里的「第 3 页」（改之后是浅强调色底）
    await pane(page).getByTestId('doc-board').locator('.db-card[data-kind="text"]').first().locator('a.pg').hover()
    await shot(run, '5-board-hover')
    // 改之前问答卡里露着「[第 5 页](#page=5)」写法、没有能点的页码，点那一行
    const ask = pane(page).getByTestId('doc-board').locator('.db-card[data-kind="ask"]')
    await (process.env.CN_SHOT_TAG === 'old' ? ask.locator('.row.g') : ask.locator('a.pg', { hasText: '第 5 页' })).first().click()
    await page.mouse.move(700, 870)
    await settled(5)
    await shot(run, '4-board-click')
  } finally {
    await run.close()
  }
})
