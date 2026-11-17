/**
 * 真的 MinerU 在软件里跑一次（只读用本机已经装好的 ~/.mineru-venv，不装、不升级）：
 *   CN_REAL_MINERU=1 npx playwright test e2e/real-mineru.spec.ts
 * 临时库里放公开的 arXiv 1512.03385v1（ResNet），打开 → pdf.js 的块先出 → 后台 MinerU 认完换上：第 5 页的 Table 1 画成表、第 3 页公式渲染。
 */
import { expect, test } from '@playwright/test'
import { homedir } from 'node:os'
import { acts, launch, tabOn } from './app'
import { shotPart, shotTone, shotWindow } from './shots'

test.skip(process.env.CN_REAL_MINERU !== '1', '只在 CN_REAL_MINERU=1 时跑')

test('真的 MinerU：ResNet 第 5 页表格成表、第 3 页公式渲染', async () => {
  test.setTimeout(300_000)
  const res = await fetch('https://arxiv.org/pdf/1512.03385v1', { signal: AbortSignal.timeout(60_000) })
  const pdf = new Uint8Array(await res.arrayBuffer())
  const run = await launch({ '论文/ResNet.pdf': pdf }, { CN_AI_FAKE: '1', CN_MINERU_HOME: homedir() })
  const { page } = run
  const pane = page.locator('.pdfpane:not([hidden])')
  try {
    await shotTone(page)
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('ResNet')
    await page.locator('.pal-row', { hasText: 'ResNet' }).first().click()
    await expect(tabOn(page)).toHaveText('ResNet.pdf')
    await expect(acts(page).getByTestId('mineru-tool')).toBeVisible({ timeout: 30_000 })
    await expect(pane.getByTestId('mineru-bar')).toHaveCount(0)
    await acts(page).getByTestId('bi-mode').getByRole('button', { name: '原文 / 对照 / 只看译文' }).click()
    await acts(page).getByRole('radiogroup', { name: '原文 对照 只看译文' }).getByRole('radio', { name: '对照' }).click()
    await pane.getByRole('toolbar', { name: '双语工具条' }).getByRole('radio', { name: '重排' }).click()
    const p5 = pane.getByTestId('reflow').locator('[data-group="p5"]')
    await expect(p5.locator('.fc.table.rendered table').first()).toBeVisible({ timeout: 240_000 })
    await expect(p5.locator('.fc.table.rendered table').first()).toContainText('layer name')
    await expect(pane.getByTestId('reflow').locator('[data-group="p3"] .fc.formula.rendered .katex-display')).toHaveCount(2)
    await p5.scrollIntoViewIfNeeded()
    await shotWindow(run, 'real-mineru-p5')
    await shotPart(p5.locator('.fc.table.rendered').first(), 'real-mineru-table1')
    await shotPart(pane.getByTestId('reflow').locator('[data-group="p3"] .fc.formula.rendered').first(), 'real-mineru-formula1')
  } finally {
    await run.close()
  }
})
