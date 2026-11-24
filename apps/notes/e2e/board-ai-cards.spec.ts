/**
 * 普通文档以白板看法开着时 AI 写进来的几段（bug 三组 2）：
 * - 这一轮结束补包 [!ai] 块时照白板一段一张卡包（以前只认 type: board，两段包成一块，白板上并成一张卡）；
 * - AI 卡头带「回到 AI 对话」时两行：块名「AI 写的」一行不省略，「Claude Code · Opus 5.5 · 回到 AI 对话」一行（以前挤在一行成了「AI … Claude Code · Opus 5.5 · …」）。
 * 一律无头（CN_E2E=1）、假 AI（CN_AI_FAKE=1，「跑命令写文件」照 Claude Code 用 Bash 跑 python 那样直接写盘），真点、真按键。
 */
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { acts, launch, pane, tabOn } from './app'

const SHOTS = '/private/tmp/canvas-notes-visual/119-bug三组'
const MEET = '# 11.24 组会准备\n\n## 上周做了什么\n\n读完了残差网络那篇。\n\n## 要问导师的\n\n数据集要不要换。\n'
const ADD = '## 这周要讲的\n\n残差连接为什么能训得深：梯度有一条不经过非线性的捷径。\n\n和 C72 的对比：层数翻倍以后准确率还在涨。'

const ai = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const board = (page: Page) => pane(page).locator('[data-testid="doc-board"]')

for (const skin of [null, 'petrol'] as const) {
  test(`文档以白板看法开着、AI 跑命令加了两段：补包成两块 [!ai]，白板上两张卡；卡头「AI 写的」一行、「Claude Code · Opus 5.5 · 回到 AI 对话」一行${skin ? '（深色）' : ''}`, async () => {
    const run = await launch({ '11.24 组会准备.md': MEET }, { CN_AI_FAKE: '1' })
    const { page, vault } = run
    try {
      mkdirSync(SHOTS, { recursive: true })
      if (skin) {
        await page.evaluate((s) => window.cn.setSettings({ appearance: { followSystem: false, skin: s } }), skin)
        await page.reload()
        await page.locator('.vault b').waitFor()
      }
      await page.keyboard.press('Meta+o')
      await page.keyboard.type('11.24 组会准备')
      await page.waitForTimeout(150)
      await page.keyboard.press('Enter')
      await expect(tabOn(page)).toHaveText('11.24 组会准备')
      // 标签条上点「白板」：这篇切成白板看法（看法不写进文件）
      await acts(page).getByRole('tab', { name: '白板' }).click()
      await expect(board(page)).toContainText('读完了残差网络那篇')
      await page.keyboard.press('Meta+j')
      const box = ai(page).getByRole('textbox', { name: '问 AI' })
      await box.fill(`跑命令写文件「11.24 组会准备.md」「${MEET.trimEnd()}\n\n${ADD}\n」`)
      await box.press('Enter')
      await expect(ai(page).getByTestId('ai-msg').last()).toContainText('写好了', { timeout: 20_000 })

      // 文件里两段各包一块
      const file = () => readFileSync(join(vault, '11.24 组会准备.md'), 'utf8')
      await expect.poll(() => (file().match(/^> \[!ai\] AI 写的 · /gm) ?? []).length, { timeout: 10_000 }).toBe(2)
      expect(file()).toContain('> 残差连接为什么能训得深：梯度有一条不经过非线性的捷径。\n\n> [!ai] AI 写的 · ')
      expect(file()).not.toMatch(/捷径。\n>\n> 和 C72/)

      // 白板上「这周要讲的」一列两张 AI 卡
      const col = board(page).locator('.db-col[aria-label="这周要讲的"]')
      await expect(col.locator('.db-card')).toHaveCount(2)
      const cards = col.locator('.db-card .cl[data-kind="ai"]')
      await expect(cards).toHaveCount(2)
      await expect(cards.nth(0)).toContainText('残差连接为什么能训得深')
      await expect(cards.nth(1)).toContainText('层数翻倍以后准确率还在涨')
      await expect(col.locator('.db-meta, .meta').first()).toContainText('2张')

      // 卡头两行：块名一行不省略，下一行「Claude Code · Opus 5.5 · 回到 AI 对话」也不省略
      for (const k of [0, 1]) {
        const head = cards.nth(k).locator('.ct')
        await expect(head.locator('.nm')).toHaveText('AI 写的')
        await expect(head.locator('.eng')).toHaveText('Claude Code · Opus 5.5 · 回到 AI 对话')
        const g = await head.evaluate((el) => {
          const nm = el.querySelector<HTMLElement>('.nm')!
          const eng = el.querySelector<HTMLElement>('.eng')!
          return { nmCut: nm.scrollWidth > nm.clientWidth + 1, engCut: eng.scrollWidth > eng.clientWidth + 1, below: eng.getBoundingClientRect().top >= nm.getBoundingClientRect().bottom - 2 }
        })
        expect(g).toEqual({ nmCut: false, engCut: false, below: true })
      }
      // 「回到 AI 对话」点得到：回到这一问的那条回答
      // 新卡的字一点点长出来（ai-card-grow.ts），长完再截图
      await expect.poll(() => page.evaluate(() => (CSS as unknown as { highlights: Map<string, unknown> }).highlights.has('cn-ai-grow')), { timeout: 8000 }).toBe(false)
      await expect(board(page).getByTestId('ai-act')).toHaveCount(0, { timeout: 8000 })
      await page.screenshot({ path: join(SHOTS, `2-白板上AI写的两段各一张卡${skin ? '-深色' : ''}.png`) })
      await cards.nth(0).locator('.db-chat').click()
      await expect(ai(page).getByTestId('ai-msg').last()).toBeVisible()
    } finally {
      await run.close()
    }
  })
}

/**
 * 量白板：工具板右边、白板可见区右边、某一列的左右（屏幕坐标）；
 * cut：有没有哪一列压在工具板底下（左边在工具板右边以左、右边又露在工具板右边以右）
 */
async function edges(page: Page, col: string) {
  return pane(page).evaluate((root, name) => {
    const pal = root.querySelector('.bpal')!.getBoundingClientRect()
    const wrap = root.querySelector<HTMLElement>('.board-wrap')!
    const w = wrap.getBoundingClientRect()
    const cols = [...root.querySelectorAll('.db-col')].map((e) => e.getBoundingClientRect())
    const c = root.querySelector(`.db-col[aria-label="${name}"]`)?.getBoundingClientRect()
    return {
      pal: Math.round(pal.right),
      right: Math.round(w.left + wrap.clientWidth),
      cut: cols.some((r) => r.left < pal.right - 1 && r.right > pal.right + 1),
      gap: Math.round(Math.min(...cols.filter((r) => r.left >= pal.right - 1).map((r) => r.left)) - pal.right),
      col: c ? { left: Math.round(c.left), right: Math.round(c.right) } : null,
    }
  }, col)
}

for (const width of [1440, 1280]) {
  test(`${width} 宽的窗口、白板放不下、AI 在最右边加列：白板按整列平移，新的一列整个露出来，没有哪一列压在左边工具板底下`, async () => {
    const run = await launch({ '11.24 组会准备.md': MEET }, { CN_AI_FAKE: '1' })
    const { page } = run
    try {
      await run.app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0]!.setSize(w, 900), width)
      await page.keyboard.press('Meta+o')
      await page.keyboard.type('11.24 组会准备')
      await page.waitForTimeout(150)
      await page.keyboard.press('Enter')
      await expect(tabOn(page)).toHaveText('11.24 组会准备')
      await acts(page).getByRole('tab', { name: '白板' }).click()
      await expect(board(page)).toContainText('读完了残差网络那篇')
      // 右栏 AI 开着：白板缩到 0.8，三列放不下
      await page.keyboard.press('Meta+j')
      await expect(page.locator('.pane:not([hidden]) .db-plane')).toHaveAttribute('style', /zoom: 0\.8/)
      await page.waitForTimeout(400)
      const e0 = await edges(page, '上周做了什么')
      expect(e0.cut).toBe(false)
      const gap0 = e0.gap

      const box = ai(page).getByRole('textbox', { name: '问 AI' })
      await box.fill(`跑命令写文件「11.24 组会准备.md」「${MEET.trimEnd()}\n\n${ADD}\n」`)
      await box.press('Enter')
      await expect(board(page).locator('.db-col[aria-label="这周要讲的"]')).toBeVisible({ timeout: 20_000 })
      // 平移（平滑滚动）停下来以后量：新的一列整个看得见，没有半截压在工具板底下的列，最左露着的那列离工具板和刚打开时一样
      const settled = async (name: string) => {
        let prev = ''
        for (let i = 0; i < 20; i++) {
          await page.waitForTimeout(150)
          const now = JSON.stringify(await edges(page, name))
          if (now === prev) break
          prev = now
        }
        return edges(page, name)
      }
      const e1 = await settled('这周要讲的')
      expect(e1.cut, JSON.stringify(e1)).toBe(false)
      expect(e1.col!.left).toBeGreaterThanOrEqual(e1.pal)
      expect(e1.col!.right).toBeLessThanOrEqual(e1.right)
      expect(Math.abs(e1.gap - gap0), JSON.stringify({ e0, e1 })).toBeLessThanOrEqual(1)
      await expect(ai(page).getByTestId('ai-msg').last()).toContainText('写好了', { timeout: 20_000 })
      await expect(board(page).getByTestId('ai-act')).toHaveCount(0, { timeout: 10_000 })
      await expect.poll(() => page.evaluate(() => (CSS as unknown as { highlights: Map<string, unknown> }).highlights.has('cn-ai-grow')), { timeout: 8000 }).toBe(false)
      const e2 = await settled('这周要讲的')
      expect(e2.cut).toBe(false)
      expect(e2.col!.right).toBeLessThanOrEqual(e2.right)
      await page.screenshot({ path: join(SHOTS, `3-AI加列按整列平移-${width}.png`) })

      // 再加一列、整列都在屏幕外：照样按整列推进来
      const now = readFileSync(join(run.vault, '11.24 组会准备.md'), 'utf8').trimEnd()
      await box.fill(`跑命令写文件「11.24 组会准备.md」「${now}\n\n## 下周\n\n跑消融实验。\n」`)
      await box.press('Enter')
      await expect(board(page).locator('.db-col[aria-label="下周"]')).toBeVisible({ timeout: 20_000 })
      const e3 = await settled('下周')
      expect(e3.cut).toBe(false)
      expect(e3.col!.left).toBeGreaterThanOrEqual(e3.pal)
      expect(e3.col!.right).toBeLessThanOrEqual(e3.right)
      expect(Math.abs(e3.gap - gap0)).toBeLessThanOrEqual(1)
    } finally {
      await run.close()
    }
  })
}
