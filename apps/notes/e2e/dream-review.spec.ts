/**
 * 梦游对照复审（2026-11-24，设计复审没过的 6 条），都是真点：
 * ① 「可以建的词条页」只是提醒、没有提交：中间两篇整篇并排、抬头写两篇名字、提到那个词的段淡底，不按字比、不写「改了 N 处」；
 * ② 合一里删掉的行画成文档样子（不露「## 」「**」），历史「文档」看法也一样；
 * ③ 并排两栏同一行两边顶差 ≤ 1px（长文的在 dream-scroll-perf）；
 * ④ 左栏小卡里没有空格的长文件名不撑出横向滚动条；
 * ⑤ 词条页那条中间和小卡都是「不要 · 建词条页」（和别的条目同一套收不收），小卡里不再写「为什么」；中间点「不要」两边一起变成已丢掉，撤回回来；
 * 设计复审第二轮：提到它的三篇都看得到（中间一排、小卡一篇一行，点了右边换成那篇），淡底的说明在抬头下面第一行；
 * ⑥ 两列抬头的字和文件条的图标左边齐。
 * 给了 CN_SHOTS（目录）时顺便截交付图：薄荷、深湖（CN_SHOT_SKIN 只截一套），宽窗口并排 / 合一，窄窗口（中间窄于 900）合一。
 */
import { expect, type Page, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { acts, launch, type Running } from './app'
import { LIST, prepareReview, REVIEW_VAULT } from './fixtures/dream-review'

const DIR = process.env.CN_SHOTS
const SKINS = (['mint', 'petrol'] as const).filter((s) => !process.env.CN_SHOT_SKIN || process.env.CN_SHOT_SKIN === s)

async function shot(run: Running, name: string) {
  if (!DIR) return
  await run.page.waitForTimeout(450)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(DIR, `${name}.png`), Buffer.from(b64, 'base64'))
}

/** 并排时两边都有、都没改、只出现一次的行，两边顶差最大多少 px */
async function alignGap(page: Page): Promise<{ worst: number; pairs: number }> {
  return page.evaluate(() => {
    const sc = document.querySelector('[data-testid="dream-tab"]:not([hidden]) [data-testid="dream-scroll"]')!
    const lines = (s: 'a' | 'b') => {
      const m = new Map<string, HTMLElement | null>()
      for (const l of sc.querySelectorAll<HTMLElement>(`.cm-merge-${s} .cm-content > .cm-line:not(.cm-changedLine)`)) {
        const t = l.textContent ?? ''
        if (t.trim().length >= 4) m.set(t, m.has(t) ? null : l)
      }
      return m
    }
    const b = lines('b')
    let worst = 0
    let pairs = 0
    for (const [t, la] of lines('a')) {
      const lb = b.get(t)
      if (!la || !lb) continue
      pairs++
      worst = Math.max(worst, Math.abs(la.getBoundingClientRect().top - lb.getBoundingClientRect().top))
    }
    return { worst, pairs }
  })
}

/** 两列抬头第一个字的左边、文件条图标的左边（屏幕上的 x） */
async function headLefts(page: Page): Promise<{ cols: number; icon: number; name: number }> {
  return page.evaluate(() => {
    const t = document.querySelector('[data-testid="dream-tab"]:not([hidden])')!
    const textLeft = (el: Element) => {
      const r = document.createRange()
      const n = [...el.childNodes].find((c) => c.nodeType === 3 && c.nodeValue!.trim()) ?? el.firstChild!
      r.setStart(n, 0)
      r.setEnd(n, 1)
      return r.getBoundingClientRect().left
    }
    const fbar = t.querySelector('[data-testid="dream-fbar"]')!
    return {
      cols: textLeft(t.querySelector('.dv-cols > span')!),
      icon: fbar.querySelector('svg, .ci')!.getBoundingClientRect().left,
      name: textLeft(fbar.querySelector('.nm')!),
    }
  })
}

for (const skin of SKINS) {
  test(`梦游对照复审 6 条（${skin === 'mint' ? '薄荷' : '深湖'}）`, async () => {
    test.skip(!DIR && skin !== 'mint', '不截图时只跑一套')
    test.setTimeout(240_000)
    if (DIR) mkdirSync(DIR, { recursive: true })
    const run = await launch(REVIEW_VAULT, {}, (vault) => {
      prepareReview(vault)
      const ud = join(dirname(vault), 'user-data')
      mkdirSync(ud, { recursive: true })
      writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin, frame: 'b', winBg: 'aurora' } }))
    })
    const { page } = run
    try {
      await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1600, 900))
      await page.getByTestId('dream-card').getByRole('button', { name: '看报告' }).click()
      const panel = page.getByRole('complementary', { name: '梦游报告' })
      const item = (s: string) => panel.getByTestId('dream-item').filter({ hasText: s })
      const t = page.locator('[data-testid="dream-tab"]:not([hidden])')

      // ① 词条页那条：两篇整篇并排，抬头两篇名字，提到它的段淡底，没有文件条、没有「改了 N 处」、没有红绿
      await item('《动手学深度学习》').click()
      const cols = t.getByTestId('dream-cols')
      await expect(cols).toContainText('YitingWei_2026_J52_SAGE_stress_workload_JBHI_reading_notes_v3_final')
      await expect(cols).toContainText('学习笔记：动手学深度学习')
      await expect(t.getByTestId('dream-fbar')).toHaveCount(0)
      await expect(t).not.toContainText(/改了\s*\d+\s*处/)
      await expect(t.locator('.cm-changedLine, .cm-changedText, .cm-deletedChunk')).toHaveCount(0)
      const rows = t.locator('.dt-rows > .dt-cell')
      await expect(rows).toHaveCount(2)
      await expect(rows.nth(0).locator('.dv-mark').first()).toBeVisible()
      await expect(rows.nth(1).locator('.dv-mark').first()).toBeVisible()
      // 淡底的就是提到那个词的段
      for (const k of [0, 1]) for (const m of await rows.nth(k).locator('.cm-line.dv-mark').allTextContents()) expect(m).toContain('动手学深度学习')
      await expect(t.locator('.dt-same')).toHaveText('浅色底的几段都提到《动手学深度学习》。')
      // 说明在两列抬头下面第一行（第一屏就看得到）；抬头的按钮只写「打开」
      await expect(t.locator('.dt-same')).toBeInViewport()
      await expect(cols.getByRole('button')).toHaveText(['打开', '打开'])
      // 提到它的三篇：中间一排，点第三篇右边换成它；小卡里一篇一行，点了一样换
      const chips = t.getByTestId('dream-mentions').getByRole('tab')
      await expect(chips).toHaveText(['YitingWei_2026_J52_SAGE_stress_workload_JBHI_reading_notes_v3_final', '学习笔记：动手学深度学习', '深度学习入门书单'])
      await chips.nth(2).click()
      await expect(cols.locator('b')).toHaveText(['YitingWei_2026_J52_SAGE_stress_workload_JBHI_reading_notes_v3_final', '深度学习入门书单'])
      await expect(chips.nth(2)).toHaveAttribute('aria-selected', 'true')
      await expect(chips.nth(1)).toHaveAttribute('aria-selected', 'false')
      const rowsInCard = panel.getByTestId('dream-mention')
      await expect(rowsInCard).toHaveCount(3)
      await expect(rowsInCard.nth(2)).toHaveClass(/\bon\b/)
      await rowsInCard.nth(1).click()
      await expect(cols.locator('b')).toHaveText(['YitingWei_2026_J52_SAGE_stress_workload_JBHI_reading_notes_v3_final', '学习笔记：动手学深度学习'])
      await expect(rowsInCard.nth(1)).toHaveClass(/\bon\b/)
      // ⑤ 中间和小卡都是「建词条页 · 不要」，中间没有「知道了」；小卡里没有「为什么」那段
      const head = t.getByTestId('dream-head')
      // 和别的条目同一套收不收：不要（无边框）在左、建词条页在右，中间实心、小卡描边
      await expect(head.getByTestId('dream-head-entry').getByRole('button')).toHaveText(['不要', '建词条页'])
      await expect(head.getByTestId('dream-head-entry').locator('[data-act="accept"]')).toHaveClass(/solid/)
      await expect(panel.getByTestId('dream-panel-entry').locator('[data-act="accept"]')).toHaveClass(/out/)
      await expect(head.getByRole('button', { name: '知道了' })).toHaveCount(0)
      const card = panel.getByTestId('dream-detail')
      await expect(card.getByRole('button', { name: '建词条页' })).toBeVisible()
      await expect(card.getByRole('button', { name: '不要' })).toBeVisible()
      await expect(head.getByTestId('dream-why')).toContainText('点「建词条页」才建')
      await expect(card).not.toContainText('点「建词条页」才建')
      // ④ 小卡里长文件名折行，左栏没有横向滚动条
      await expect(card.locator('.dentry')).toContainText('YitingWei_2026_J52_SAGE')
      const over = await panel.locator('.dlist').evaluate((el) => el.scrollWidth - el.clientWidth)
      expect(over).toBeLessThanOrEqual(0)
      await shot(run, `01-词条页并排-${skin}`)

      // ⑥ 补双链那条（真有提交）：两列抬头的字和文件条图标左边齐；③ 两栏对齐
      await item('卷积神经网络').click()
      await expect(t.getByTestId('dream-fbar')).toContainText('学习笔记：动手学深度学习')
      await expect(acts(page).getByRole('tab', { name: '并排' })).toHaveAttribute('aria-selected', 'true')
      await expect(t.locator('.cm-merge-b .cm-changedLine').first()).toBeVisible()
      await page.waitForTimeout(300)
      const x = await headLefts(page)
      expect(Math.abs(x.cols - x.icon), JSON.stringify(x)).toBeLessThanOrEqual(1)
      // 文件条「课程」和「· 改了3处」之间就是 8 的间距（以前「在哪」最窄 40，短的后面空出一截）
      const gapDir = await t.getByTestId('dream-fbar').evaluate((el) => el.querySelector('.say')!.getBoundingClientRect().left - el.querySelector('.dir')!.getBoundingClientRect().right)
      expect(gapDir).toBeLessThanOrEqual(9)
      const gap = await alignGap(page)
      expect(gap.pairs).toBeGreaterThan(3)
      expect(gap.worst).toBeLessThanOrEqual(1)
      await shot(run, `02-补双链并排-${skin}`)

      // ② 合一：删掉的标题、整段画成文档样子（标题是标题，不露「## 」「**」），删掉的字照旧深红
      await acts(page).getByRole('tab', { name: '合一' }).click()
      const del = t.locator('.cm-deletedChunk')
      await expect(del.first()).toBeVisible()
      await expect(t.locator('.cm-deletedChunk .dv-deldoc').first()).toBeVisible()
      await expect(t.locator('.cm-deletedChunk .cm-h2').filter({ hasText: '第 6 章 · 卷积' })).toBeVisible()
      await expect(t.locator('.cm-deletedChunk .cm-h2').filter({ hasText: '读到哪了' })).toBeVisible()
      for (const s of await del.allInnerTexts()) {
        expect(s).not.toMatch(/^#+ /m)
        expect(s).not.toContain('**')
      }
      await expect(t.locator('.cm-deletedChunk .cm-deletedText').first()).toBeVisible()
      await shot(run, `03-补双链合一-${skin}`)

      // 中间窄于 900：自动合一，删掉的那几行一样是文档样子
      await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1180, 900))
      await expect(t).toHaveClass(/narrow/)
      await expect(t.locator('.dv-diff.dv-unified .cm-deletedChunk .dv-deldoc').first()).toBeVisible()
      await shot(run, `04-窄于900合一-${skin}`)
      await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1600, 900))
      await expect(t).not.toHaveClass(/narrow/)

      // ② 历史「文档」看法合一：书单那次提交，删掉的一级标题、整行也是文档样子
      await page.keyboard.press('Meta+y')
      const hist = page.getByRole('complementary', { name: '历史' })
      await hist.locator('.commit, [data-testid="commit"]').filter({ hasText: '书单换成 2026 版' }).first().click()
      await hist.getByText(LIST.split('/').pop()!.replace(/\.md$/, '')).first().click()
      const dv = page.locator('[data-testid="diff-tab"]:not([hidden])')
      await expect(dv).toBeVisible()
      await expect(acts(page).getByRole('tab', { name: '文档' })).toHaveAttribute('aria-selected', 'true')
      await acts(page).getByRole('tab', { name: '合一' }).click()
      await expect(dv.locator('.cm-deletedChunk .dv-deldoc').first()).toBeVisible()
      await expect(dv.locator('.cm-deletedChunk .cm-h1').filter({ hasText: '深度学习入门书单' })).toBeVisible()
      for (const s of await dv.locator('.cm-deletedChunk').allInnerTexts()) expect(s).not.toMatch(/^# /m)
      // 源码看法照旧露源码
      await acts(page).getByRole('tab', { name: '源码' }).click()
      await expect(dv.locator('.cm-deletedChunk').first()).toContainText('# 深度学习入门书单')
      await expect(dv.locator('.cm-deletedChunk .dv-deldoc')).toHaveCount(0)
      await acts(page).getByRole('tab', { name: '文档' }).click()
      await shot(run, `05-历史文档合一-${skin}`)

      // ⑤ 回到词条页那条，中间点「不要」：两边一起变成已丢掉；撤回回来（放最后：底栏的提示不进上面的图）
      await item('《动手学深度学习》').click()
      await head.getByRole('button', { name: '不要' }).click()
      await expect(card.getByTestId('dream-state')).toContainText('已丢掉')
      await expect(head.locator('.chip-drop')).toHaveText('已丢掉')
      await card.getByRole('button', { name: '撤回' }).click()
      await expect(head.getByTestId('dream-head-entry')).toBeVisible()
    } finally {
      await run.close()
    }
  })
}
