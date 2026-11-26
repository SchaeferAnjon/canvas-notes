/**
 * 文档切到白板（方向 A「先按节摆、再自由」）：切过去按节摆成列，只看不写；拖进别的列文档里也挪；拖到空白处只多一行位置；
 * 勾待办只改一个字；双击看全文、在文档里看；摆回原样；/整理当前白板 照同一套规则。都是真点、真拖。
 */
import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { acts, gitStatus, launch, openNote, pane, waitSaved } from './app'

const TRAVEL = `# 冰岛十天环岛

## 出发前

还没订完的：

- [ ] 租车
- [x] 机票

> 冰岛的天气五分钟一变。
—— [旅行杂志](https://example.com)

## 住哪

第一晚住雷克雅未克。

## 路线

第一天：黄金圈。

***

| 天 | 地方 |
|---|---|
| 1 | 黄金圈 |
| 2 | 黑沙滩 |

## 第 3 页 · 冰川为什么是蓝的

> [!question] 我的疑惑
> 冰川为什么是蓝的？

> [!success] 讲通的讲法（第 1 版）
> 冰把红光吸掉了。
`

const board = (page: Page) => pane(page).getByTestId('doc-board')
const col = (page: Page, name: string) => board(page).getByRole('region', { name, exact: true })
const cardIn = (page: Page, name: string, text: string) => col(page, name).locator('.db-card', { hasText: text })

async function dragTo(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 10, from.y + 10, { steps: 3 })
  await page.mouse.move(to.x, to.y, { steps: 12 })
  await page.mouse.up()
}

test('文档切到白板：按节摆成列、只看不写；拖进别的列文档里也挪；拖到空白处只多一行位置；勾待办；双击看全文；摆回原样', async () => {
  const run = await launch({ '冰岛十天环岛.md': TRAVEL })
  const { page, vault, app } = run
  const file = () => readFileSync(join(vault, '冰岛十天环岛.md'), 'utf8')
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await openNote(page, '冰岛十天环岛')
    await acts(page).getByRole('tab', { name: '白板' }).click()
    await expect(board(page)).toBeVisible()
    // 列：出发前、住哪、路线、问过 AI 的那一处（列名是那一节的标题，配对笔记白板分列）；名字不成卡；冒号那句带上待办；分隔线是空隙
    await expect(board(page).locator('.db-col h3 .truncate')).toHaveText(['出发前', '住哪', '路线', '第3页 · 冰川为什么是蓝的'])
    await expect(col(page, '出发前').locator('.db-card')).toHaveCount(2)
    await expect(col(page, '路线').locator('.db-gap')).toHaveCount(1)
    await expect(col(page, '路线').locator('.db-card[data-kind="table"] .kh')).toHaveText('表格2行 × 2列')
    await expect(col(page, '第 3 页 · 冰川为什么是蓝的').locator('.db-card[data-kind="ask"]')).toHaveCount(1)
    await page.screenshot({ path: 'test-results/g2-docboard.png' })
    // 只看：文件一个字都不变
    await page.waitForTimeout(1200)
    expect(file()).toBe(TRAVEL)
    expect(gitStatus(vault)).toBe('')

    // 勾待办：只改那一个字
    await cardIn(page, '出发前', '租车').getByRole('checkbox').first().click()
    await expect.poll(file).toBe(TRAVEL.replace('- [ ] 租车', '- [x] 租车'))

    // 拖进别的列：引文从「出发前」挪进「住哪」，文档里也挪过去
    const q = (await cardIn(page, '出发前', '冰岛的天气').boundingBox())!
    const target = (await col(page, '住哪').boundingBox())!
    await dragTo(page, { x: q.x + 40, y: q.y + 20 }, { x: target.x + 60, y: target.y + target.height - 6 })
    await expect(cardIn(page, '住哪', '冰岛的天气')).toBeVisible()
    // 拖着挪是小操作：不出提示（2026-11-25 偏好「小操作不弹成功提示」，以前是「挪进了「住哪」：文档里这段也挪进了这一节」）
    // （上一步勾待办的那句可能还在，只看有没有挪的那句）
    await page.waitForTimeout(400)
    await expect(page.locator('.db-toast', { hasText: '挪进了' })).toHaveCount(0)
    await waitSaved(page)
    const moved = file()
    expect(moved).toContain('## 住哪\n\n第一晚住雷克雅未克。\n\n> 冰岛的天气五分钟一变。\n—— [旅行杂志](https://example.com)\n\n## 路线')
    expect(moved.replace('> 冰岛的天气五分钟一变。\n—— [旅行杂志](https://example.com)\n\n', '')).toBe(TRAVEL.replace('- [ ] 租车', '- [x] 租车').replace('> 冰岛的天气五分钟一变。\n—— [旅行杂志](https://example.com)\n\n', ''))

    // 拖到空白处：只在这段前面多一行位置，正文顺序不变；卡底不写在哪一节（偏好「白板卡别挂位置行」）
    const p = (await cardIn(page, '住哪', '第一晚').boundingBox())!
    const bb = (await board(page).boundingBox())!
    await dragTo(page, { x: p.x + 40, y: p.y + 20 }, { x: bb.x + 300, y: bb.y + bb.height - 150 })
    const placed = board(page).locator('.db-card.placed')
    await expect(placed).toHaveCount(1)
    await expect(placed.locator('.from')).toHaveCount(0)
    await expect(placed).not.toContainText('在文档')
    await waitSaved(page)
    const withPlace = file()
    expect(withPlace.split('\n').length).toBe(moved.split('\n').length + 1)
    expect(withPlace).toMatch(/\n<!-- card id=d1 x=\d+ y=\d+ -->\n第一晚住雷克雅未克。\n/)
    expect(withPlace.replace(/<!-- card id=d1 x=\d+ y=\d+ -->\n/, '')).toBe(moved)
    await page.screenshot({ path: 'test-results/g2-docboard-moved.png' })

    // 双击文字卡：就地改（卡里出编辑框），Esc 收起
    await cardIn(page, '路线', '黄金圈').first().dblclick()
    await expect(cardIn(page, '路线', '黄金圈').first().getByRole('textbox', { name: '卡片内容' })).toBeFocused()
    await page.keyboard.press('Escape')
    // 双击表格卡看全文，「在文档里看」切回文档
    await col(page, '路线').locator('.db-card[data-kind="table"]').dblclick()
    const dlg = page.getByRole('dialog', { name: '全文' })
    await expect(dlg).toContainText('黑沙滩')
    await page.screenshot({ path: 'test-results/g2-docboard-full.png' })
    await dlg.getByRole('button', { name: '在文档里看' }).click()
    await expect(acts(page).getByRole('tab', { name: '文档' })).toHaveAttribute('aria-selected', 'true')
    await acts(page).getByRole('tab', { name: '白板' }).click()

    // 摆回原样：位置行去掉
    await board(page).getByRole('button', { name: '摆回原样' }).click()
    await expect(board(page).locator('.db-card.placed')).toHaveCount(0)
    await expect.poll(file).toBe(moved)
  } finally {
    await run.close()
  }
})

test('/整理当前白板：普通文档照同一套规则摆（按节、去掉单独摆的位置），不问 AI', async () => {
  const placedDoc = TRAVEL.replace('第一晚住雷克雅未克。', '<!-- card id=d1 x=400 y=500 -->\n第一晚住雷克雅未克。')
  const run = await launch({ '冰岛十天环岛.md': placedDoc }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await openNote(page, '冰岛十天环岛')
    await acts(page).getByRole('tab', { name: '白板' }).click()
    await expect(board(page).locator('.db-card.placed')).toHaveCount(1)
    await page.keyboard.press('Meta+j')
    const box = page.getByRole('textbox', { name: '问 AI' })
    await box.fill('/整理当前白板')
    await box.press('Enter')
    await expect(page.getByTestId('ai-msg').last()).toContainText('照文档的节摆好了：4列')
    await expect(board(page).locator('.db-card.placed')).toHaveCount(0)
    await waitSaved(page)
    expect(readFileSync(join(vault, '冰岛十天环岛.md'), 'utf8')).toBe(TRAVEL)
  } finally {
    await run.close()
  }
})

test('卡片里不露 md 原文：折叠块整块一张卡、点开才看正文；==高亮== 是荧光底；AI 讲解卡头一行；表格、代码照文档的样子（第 1 轮美学）', async () => {
  const doc = `# 冰岛

## 出发前

我的评价：这句话被反复印证，==出门永远带防风外套==。

| 项目 | 金额 |
|---|---|
| **租车** | 168,000 |

\`\`\`
road.is → Southeast
\`\`\`

## 问过 AI

> [!ai] AI 讲解 · Claude Code · Opus 5.5 · 看了 road.is 这一页
> 冬天默认给钉胎，一般不需要防滑链。

<details><summary>没讲通 · 第 1 版：防滑链和钉胎的区别</summary>

旧讲法：钉胎像钉鞋，防滑链像冰爪。

</details>
`
  const run = await launch({ '冰岛.md': doc })
  const { page, vault } = run
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openNote(page, '冰岛')
    await acts(page).getByRole('tab', { name: '白板' }).click()
    await expect(board(page)).toBeVisible()
    const all = board(page).locator('.db-cols')
    // 一个字的原文都不露：<details>、</summary>、==、**
    for (const raw of ['<details', '</summary>', '</details>', '==', '**']) await expect(all).not.toContainText(raw)
    // 折叠块：一张卡，一行「› 标题 … 折着」，正文收着；点一下展开
    const fold = col(page, '问过 AI').locator('.db-card[data-kind="details"]')
    await expect(fold).toHaveCount(1)
    await expect(fold.locator('.det .nm')).toHaveText('没讲通 · 第 1 版：防滑链和钉胎的区别')
    await expect(fold.locator('.det .r')).toHaveText('折着')
    await expect(fold.getByText('旧讲法')).toBeHidden()
    await fold.locator('.det').click()
    await expect(fold.getByText('旧讲法：钉胎像钉鞋，防滑链像冰爪。')).toBeVisible()
    await expect(col(page, '问过 AI').locator('.db-card')).toHaveCount(2)
    // 高亮：荧光底的 <mark>，「我的评价」小标签
    const hl = cardIn(page, '出发前', '我的评价').locator('mark.md-hl')
    await expect(hl).toHaveText('出门永远带防风外套')
    expect(await hl.evaluate((e) => getComputedStyle(e).backgroundImage)).toContain('gradient')
    await expect(cardIn(page, '出发前', '我的评价').locator('.md-review-tag')).toHaveText('我的评价')
    // 表格：表头一行、单元格里的加粗照常显示；加粗字重 600
    const b = cardIn(page, '出发前', '租车').locator('td b')
    await expect(b).toHaveText('租车')
    expect(await b.evaluate((e) => getComputedStyle(e).fontWeight)).toBe('600')
    await expect(cardIn(page, '出发前', 'road.is').locator('pre.db-code')).toHaveText('road.is → Southeast')
    // AI 讲解：卡头一行（图标 + 「AI 讲解」+ 一行省略的引擎·模型·看了什么），不折行
    const head = col(page, '问过 AI').locator('.cl .ct').first()
    await expect(head.locator('.nm')).toHaveText('AI 讲解')
    const m = await head.evaluate((e) => {
      const meta = e.querySelector('.eng') as HTMLElement
      return { h: e.getBoundingClientRect().height, metaFs: getComputedStyle(meta).fontSize, ellipsis: getComputedStyle(meta).textOverflow, cut: meta.scrollWidth > meta.clientWidth }
    })
    expect(m.h).toBeLessThan(26)
    // 列 400 以后这一行放得下了（以前 276 时截省略号）：放不下时照样一行省略号
    expect(m).toMatchObject({ metaFs: '12px', ellipsis: 'ellipsis' })
    // 只看不写
    expect(readFileSync(join(vault, '冰岛.md'), 'utf8')).toBe(doc)
  } finally {
    await run.close()
  }
})
