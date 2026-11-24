/**
 * 白板卡宽和表格（设计页 128，方向 A，2026-11-24 用户改成「400 左右、表格换行不剪裁、表格展示全部」）：
 * 列 400；表格卡整张画出来、长格子换行不截、#、年份一行；双击浮层按表宽开 + 「铺满」；图卡按比例不裁；
 * 软件自己缩放、适合窗口时第一列不钻到工具板底下、列名不压在右上角「125%」底下；原来按 276 摆的列加宽后推开、不写文件。
 * CN_SHOTS=目录 时顺手截设计页「改后」那几张（薄荷）。
 */
import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { acts, launch, openNote, pane, pickFromNoteMenu, type Running } from './app'

const SHOTS = process.env.CN_SHOTS
const mint = (vault: string) => {
  const ud = join(vault, '..', 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: 'mint', frame: 'b' } }))
}

const PAPERS: [string, string, string][] = [
  ['Wearable-Based Affect Recognition—A Review', 'Sensors', '2019'],
  ['K-EmoCon, a Multimodal Sensor Dataset for Continuous Emotion Recognition in Naturalistic Conversations', 'Scientific Data', '2020'],
  ['EmoWear: Wearable Physiological and Motion Dataset for Emotion Recognition', 'Scientific Data', '2024'],
  ['FEEL: Quantifying Heterogeneity in Physiological Signals for Generalizable Emotion Recognition', 'NeurIPS (Datasets and Benchmarks)', '2025'],
  ['Transformer-Based Self-Supervised Learning for Emotion Recognition', 'IEEE Transactions on Affective Computing', '2024'],
  ['Cross-Subject Emotion Recognition with Wearable Sensors', 'arXiv 预印本', '2022'],
  ['From Stress to Affect: Wearable Signals in the Wild', 'arXiv 预印本', '2026'],
  ['Long-Term Variability of Physiological Emotion Responses', 'ACII', '2025'],
  ['Personality-Aware Personalized Emotion Recognition from Physiological Signals', 'IJCAI', '2018'],
  ['Introducing WESAD, a Multimodal Dataset for Wearable Stress and Affect Detection', 'ICMI', '2018'],
  ['Biosignal-Based Multimodal Emotion Recognition in a Valence-Arousal Affective Framework', 'IEEE EMBC', '2019'],
  ['Arousal and Valence Recognition of Affective Sounds Based on Electrodermal Activity', 'IEEE Sensors Journal', '2017'],
  ['Cross Corpus Physiological-Based Emotion Recognition Using a Learnable Visual Semantic Graph', 'ACM Multimedia (MM)', '2020'],
  ['ASCERTAIN: Emotion and Personality Recognition Using Commercial Sensors', 'IEEE Transactions on Affective Computing', '2018'],
]
const TABLE = ['| # | Title | 期刊/会议 | 年份 |', '| --- | --- | --- | --- |', ...PAPERS.map(([t, j, y], i) => `| ${String(i + 1).padStart(2, '0')} | ${t} | ${j} | ${y} |`)].join('\n')
const DOC = `# 情绪识别论文清单

筛选条件：
1. 用手环或可穿戴设备采的生理信号，最好是 Empatica E4；
2. 标签是唤醒度（arousal）和效价（valence）；
3. 有公开数据集或代码。

09–14 是从 C73 的参考文献里补的。

${TABLE}

说明：
- 01：压缩包里是 2018 年的 arXiv 预印本，标题是 Wearable affect and stress recognition: A review；表里写的是 2019 年在 Sensors 正式发表的版本。
- 04：2026 年 4 月才挂上 arXiv，论文页眉写的是 NeurIPS 2025。

## 数据集长什么样

WESAD 用胸带和手环同时采，15 个人，每人大约两小时。

![K-EmoCon 的标注界面](附件/p3-1.png)

K-EmoCon 是两人对话时采的，标签是事后看录像自己标的。

## 读后笔记

EDA（皮电）对唤醒度最敏感，对效价几乎没用；效价要靠心率变异性和皮温一起。

跨被试的准确率普遍掉 15–25 个百分点，FEEL 那篇专门讲这个。

![各篇跨被试准确率](附件/p4-1.png)

## 下一步

- [ ] 把 05、07 的代码跑起来
- [ ] 问导师要不要加 EEG 的几篇
`
/** 旧宽度（276、间距 22）时拖过位置的三列：x 0 / 298 / 596，加宽以后会叠 */
const MOVED = `# 拖过的列

<!-- column id=c1 x=0 y=64 -->
## 第一列

一张卡。

<!-- column id=c2 x=298 y=64 -->
## 第二列

第二列的卡。

<!-- column id=c3 x=596 y=64 -->
## 第三列

第三列的卡。
`
const fx = (n: string) => readFileSync(join(__dirname, 'fixtures', 'anki', `${n}.png`))
const PAPER = '计划与调研/情绪识别论文清单.md'
const files = { [PAPER]: DOC, '计划与调研/拖过的列.md': MOVED, '计划与调研/附件/p3-1.png': fx('p3-1'), '计划与调研/附件/p4-1.png': fx('p4-1') }
const W = 1512
const H = 888

async function shot(run: Running, name: string) {
  if (!SHOTS) return
  await run.page.waitForTimeout(400)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(b64, 'base64'))
}

/** 一格里的字排成了几行（按字的行框数） */
const lines = (cell: Locator) =>
  cell.evaluate((td) => {
    const r = document.createRange()
    r.selectNodeContents(td)
    const tops = new Set([...r.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top)))
    return tops.size
  })

/** 白板上第一列（最左的内容）离工具板右边多远、列名有没有压在右上角那块底下 */
const clearance = (board: Locator) =>
  board.evaluate((b) => {
    const pal = b.querySelector('.bpal')!.getBoundingClientRect()
    const corner = b.querySelector('.db-corner')!.getBoundingClientRect()
    const wrap = b.querySelector('.board-wrap')!.getBoundingClientRect()
    const cols = [...b.querySelectorAll<HTMLElement>('.db-col')].map((c) => c.getBoundingClientRect()).filter((r) => r.width)
    const heads = [...b.querySelectorAll<HTMLElement>('.db-col h3')].map((h) => h.getBoundingClientRect()).filter((r) => r.width && r.right > wrap.left && r.left < wrap.right && r.bottom > wrap.top)
    return {
      gap: Math.min(...cols.map((r) => r.left)) - pal.right,
      // 和右上角那块横着有重叠的列名里，最靠上的那个的顶 − 那块的底
      under: Math.min(Infinity, ...heads.filter((h) => h.right > corner.left && h.left < corner.right).map((h) => h.top - corner.bottom)),
    }
  })

async function openBoard(page: Page, title: string) {
  await openNote(page, title)
  await acts(page).getByRole('tab', { name: '白板' }).click()
  const board = pane(page).getByTestId('doc-board')
  await expect(board).toBeVisible()
  return board
}

test('列 400、表格卡整张画出来换行不截、浮层按表宽和铺满、图不裁、放大和适合窗口不钻工具板底下、拖过的列推开不写文件', async () => {
  test.setTimeout(240_000)
  if (SHOTS) mkdirSync(SHOTS, { recursive: true })
  const run = await launch(files, {}, mint)
  const { page } = run
  try {
    await run.app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0]!.setContentSize(w!, h!), [W, H])
    await expect.poll(() => page.evaluate(() => innerHeight)).toBe(H)
    const board = await openBoard(page, '情绪识别论文清单')
    await page.waitForTimeout(600)

    // 列 400
    expect(await board.locator('.db-col:not(.bare)').first().evaluate((c) => getComputedStyle(c).width)).toBe('400px')

    // 表格卡：14 行全画出来、没有「还有 N 行」；4 列都在卡里（不横滚）
    const card = board.locator('.db-card', { has: page.locator('table.mt') }).first()
    await expect(card.locator('tbody tr')).toHaveCount(14)
    await expect(card.locator('.from')).toHaveCount(0)
    const box = await card.locator('.mt-box').evaluate((b) => ({ client: b.clientWidth, scroll: b.scrollWidth }))
    expect(box.scroll).toBeLessThanOrEqual(box.client + 1)
    // #、年份是短列：一行；长标题、长期刊换行看全（没有省略号、没被截）
    const row = (i: number) => card.locator('tbody tr').nth(i)
    await expect(card.locator('th').nth(0)).toHaveClass(/short/)
    await expect(card.locator('th').nth(3)).toHaveClass(/short/)
    await expect(card.locator('th').nth(1)).not.toHaveClass(/short/)
    for (let i = 0; i < 14; i++) {
      expect(await lines(row(i).locator('td').nth(0))).toBe(1)
      expect(await lines(row(i).locator('td').nth(3))).toBe(1)
    }
    expect(await lines(row(1).locator('td').nth(1))).toBeGreaterThanOrEqual(2) // K-EmoCon 那条长标题
    expect(await lines(row(4).locator('td').nth(2))).toBeGreaterThanOrEqual(2) // IEEE Transactions on Affective Computing
    const cut = await card.locator('td').evaluateAll((tds) => tds.filter((td) => td.scrollWidth > td.clientWidth + 1 || getComputedStyle(td).textOverflow === 'ellipsis').length)
    expect(cut).toBe(0)
    await expect(row(1).locator('td').nth(1)).toHaveText(PAPERS[1]![0])

    // 图卡：按图的比例、最高 260、不裁（p3-1 是 504 × 126 的横长图）
    const img = board.locator('.db-img img').first()
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBeTruthy()
    const im = await img.evaluate((i: HTMLImageElement) => ({ w: i.getBoundingClientRect().width, h: i.getBoundingClientRect().height, nw: i.naturalWidth, nh: i.naturalHeight, fit: getComputedStyle(i).objectFit }))
    expect(im.fit).not.toBe('cover')
    expect(Math.abs(im.w / im.h - im.nw / im.nh)).toBeLessThan(0.05)
    expect(im.h).toBeLessThanOrEqual(260)
    await shot(run, '11-after-400')

    // 双击表格卡：浮层按表的自然宽开（比 560 宽、不超过 1100），格子换行不截；点「铺满」铺满白板，再点回去
    await card.dblclick()
    const full = page.locator('.db-full')
    await expect(full).toBeVisible()
    await expect(full).toHaveClass(/tbl/)
    const fw = await full.evaluate((f) => f.getBoundingClientRect().width)
    expect(fw).toBeGreaterThan(560)
    expect(fw).toBeLessThanOrEqual(1100)
    await expect(full.locator('tbody tr')).toHaveCount(14)
    expect(await full.locator('td').evaluateAll((tds) => tds.filter((td) => td.scrollWidth > td.clientWidth + 1).length)).toBe(0)
    await shot(run, '12-after-full')
    const back = await page.locator('.db-full-back').evaluate((b) => b.getBoundingClientRect().width)
    await full.getByRole('button', { name: '铺满' }).click()
    await expect.poll(() => full.evaluate((f) => Math.round(f.getBoundingClientRect().width))).toBe(Math.round(back - 48))
    await shot(run, '13-after-fill')
    await full.getByRole('button', { name: '按表宽' }).click()
    await expect.poll(() => full.evaluate((f) => Math.round(f.getBoundingClientRect().width))).toBe(Math.round(fw))
    await page.keyboard.press('Escape')
    await expect(full).toHaveCount(0)

    // 放大（右上角菜单「放大」，软件自己挪视野）：第一列不钻到工具板底下，列名不压在「125%」底下
    const zoom = board.getByTestId('board-zoom')
    // 回到打开时的位置（上面双击时 Playwright 把表格卡滚进了画面）
    await board.locator('.board-wrap').evaluate((w) => w.scrollTo(...((w as HTMLElement).dataset.home!.split(',').map(Number) as [number, number])))
    for (let i = 0; i < 2; i++) {
      await pickFromNoteMenu(run, '放大')
      await zoom.click()
    }
    await expect(zoom).toHaveText('125%')
    await page.waitForTimeout(300)
    let c = await clearance(board)
    expect(c.gap).toBeGreaterThanOrEqual(11)
    expect(c.under).toBeGreaterThanOrEqual(0)
    await pickFromNoteMenu(run, '适合窗口')
    await zoom.click()
    await page.waitForTimeout(300)
    c = await clearance(board)
    expect(c.gap).toBeGreaterThanOrEqual(11)
    expect(c.under).toBeGreaterThanOrEqual(0)
    await pickFromNoteMenu(run, '100%')
    await zoom.click()
    await expect(zoom).toHaveText('100%')

    // 分屏「对照看」+ 放大到 125%（用户截图那种）：第一列在工具板右边，列名不在「125%」底下
    await acts(page).getByRole('tab', { name: '文档' }).click()
    await acts(page).getByRole('button', { name: /对照看/ }).first().click()
    const b2 = page.getByTestId('doc-board').last()
    await expect(b2).toBeVisible()
    await page.waitForTimeout(600)
    const z2 = b2.getByTestId('board-zoom')
    for (let i = 0; i < 2; i++) {
      await pickFromNoteMenu(run, '放大')
      await z2.click()
    }
    await expect(z2).toHaveText('125%')
    await page.waitForTimeout(300)
    c = await clearance(b2)
    expect(c.gap).toBeGreaterThanOrEqual(11)
    expect(c.under).toBeGreaterThanOrEqual(0)
    await shot(run, '14-after-split-125')
    await pickFromNoteMenu(run, '100%')
    await z2.click()

    // 看了半天，文件一个字节没变
    expect(readFileSync(join(run.vault, PAPER), 'utf8')).toBe(DOC)
  } finally {
    await run.close()
  }
})

test('原来按 276 宽拖过位置的列：加宽以后画的时候往右推开不叠，文件不写', async () => {
  test.setTimeout(120_000)
  const run = await launch(files, {}, mint)
  const { page } = run
  try {
    await run.app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0]!.setContentSize(w!, h!), [W, H])
    const board = await openBoard(page, '拖过的列')
    await expect(board.locator('.db-col.placed')).toHaveCount(3)
    await page.waitForTimeout(400)
    const rs = await board.locator('.db-col.placed').evaluateAll((cs) => cs.map((c) => c.getBoundingClientRect()).map((r) => ({ l: r.left, r: r.right })).sort((a, b) => a.l - b.l))
    for (let i = 1; i < rs.length; i++) expect(rs[i]!.l).toBeGreaterThanOrEqual(rs[i - 1]!.r + 10)
    await shot(run, '15-after-moved-cols')
    expect(readFileSync(join(run.vault, '计划与调研/拖过的列.md'), 'utf8')).toBe(MOVED)
  } finally {
    await run.close()
  }
})
