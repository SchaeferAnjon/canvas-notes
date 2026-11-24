/**
 * 梦游对照「并排」上下滚动卡（梦游对比滚动）。用户（0.5.8 截图：一条「可以建的词条页」，对照是两篇长笔记并排、改了 36 处）：
 * 「这里上下滑动的时候感觉好卡」。
 * 样本照那一条的规模造（e2e/fixtures/dream-long.ts：一篇三千多行的长笔记、梦游提交改了 36 处；词条页那种只是提醒的条目
 * 梦游对照复审起不再按字比，样本换成一条真有提交的改动），真点报告里那一条开对照，
 * 从顶上一帧一帧往下滚到底（每帧 40px，像触控板慢慢滑），量两样：
 * - 帧率：requestAnimationFrame 两次之间隔多久（一秒几帧）；
 * - 每帧主线程花多久：Chromium 自己记的脚本、排版、算样式累计时间（CDP Performance.getMetrics），滚之前、滚完以后相减，除以帧数。
 *   里面是滚动事件、CodeMirror 量高度和重画看得见的行、样式、排版。无头时帧率跟着合成器走不一定准，这一样才是硬指标（< 8 ms）。
 *   先原地不滚走 120 帧当对照（idle）。
 * 并排时再量两栏对齐（梦游对照复审：错开约 24px）：折着、全展开各从顶翻到底一遍，同一行两边顶差 ≤ 1px。
 * 窗口不上屏（CN_E2E），都是真点。数写进 perf.json（附件）。
 */
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { acts, launch } from './app'
import { LONG_CHANGES, LONG_VAULT, prepareLong } from './fixtures/dream-long'

interface Run {
  frames: number
  fps: number
  /** 平均每帧：脚本、排版、算样式各几毫秒（Chromium 自己记的累计时间，滚之前和滚完之后相减） */
  scriptMs: number
  layoutMs: number
  styleMs: number
  /** 最长的一帧隔了多久 */
  longestGapMs: number
}

/** 从顶上一帧一帧滚到底：每帧 step 像素（step 0：不滚，原地走 frames 帧当对照）；回来帧率和每帧主线程花在哪 */
async function scrollThrough(page: Page, step: number, frames = 0): Promise<Run> {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]))
  const m0 = await metrics()
  const r = await page.evaluate(
    ([step, frames]) =>
      new Promise<{ frames: number; fps: number; longestGapMs: number }>((done) => {
        const sc = document.querySelector<HTMLElement>('[data-testid="dream-tab"]:not([hidden]) [data-testid="dream-scroll"]')!
        sc.scrollTop = 0
        const stamps: number[] = []
        const tick = (ts: number) => {
          stamps.push(ts)
          if (step ? sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 1 : stamps.length > frames) {
            const gaps = stamps.slice(1).map((t, i) => t - stamps[i]!)
            const total = stamps[stamps.length - 1]! - stamps[0]!
            done({
              frames: gaps.length,
              fps: Math.round((gaps.length / total) * 10000) / 10,
              longestGapMs: Math.round(Math.max(...gaps)),
            })
            return
          }
          sc.scrollTop += step
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(() => requestAnimationFrame(tick))
      }),
    [step, frames] as const,
  )
  const m1 = await metrics()
  await cdp.detach()
  const per = (k: string) => Math.round(((m1[k]! - m0[k]!) * 1000 * 100) / r.frames) / 100
  return {
    ...r,
    scriptMs: per('ScriptDuration'),
    layoutMs: per('LayoutDuration'),
    styleMs: per('RecalcStyleDuration'),
  }
}

/**
 * 并排两栏对齐没有（梦游对照复审：两栏错开约 24px）：从顶到底一屏一屏往下翻（每次 360px，等十帧让编辑器量完、两栏对完；量的是停下来以后的样子，滚的那一两帧里差一两 px 不算），
 * 每一屏里两边都有、都没改、在各自那篇里只出现一次的行，量两边的顶差；回来最大的那个（px）和在哪
 */
async function alignGap(page: Page): Promise<{ worst: number; pairs: number; at: string }> {
  return page.evaluate(
    () =>
      new Promise<{ worst: number; pairs: number; at: string }>((done) => {
        const sc = document.querySelector<HTMLElement>('[data-testid="dream-tab"]:not([hidden]) [data-testid="dream-scroll"]')!
        const lines = (s: 'a' | 'b') => {
          const m = new Map<string, HTMLElement | null>()
          for (const l of sc.querySelectorAll<HTMLElement>(`.cm-merge-${s} .cm-content > .cm-line:not(.cm-changedLine)`)) {
            const t = l.textContent ?? ''
            if (t.trim().length < 8) continue
            m.set(t, m.has(t) ? null : l)
          }
          return m
        }
        let worst = 0
        let pairs = 0
        let at = ''
        const frames = (n: number, then: () => void) => (n ? requestAnimationFrame(() => frames(n - 1, then)) : then())
        const view = () => {
          const box = sc.getBoundingClientRect()
          const b = lines('b')
          for (const [t, la] of lines('a')) {
            const lb = b.get(t)
            if (!la || !lb) continue
            const ra = la.getBoundingClientRect()
            const rb = lb.getBoundingClientRect()
            if (ra.bottom < box.top || ra.top > box.bottom) continue
            pairs++
            const d = Math.abs(ra.top - rb.top)
            if (d > worst) ((worst = d), (at = `${t.slice(0, 24)}… 左 ${Math.round(ra.top)} 右 ${Math.round(rb.top)} · 滚到 ${sc.scrollTop}`))
          }
          if (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 1) return done({ worst: Math.round(worst * 10) / 10, pairs, at })
          sc.scrollTop += 360
          frames(10, view)
        }
        sc.scrollTop = 0
        frames(10, view)
      }),
  )
}

/** 脚本 + 排版 + 样式，平均每帧 */
const work = (r: Run) => Math.round((r.scriptMs + r.layoutMs + r.styleMs) * 100) / 100

test('三千多行、改了 36 处的对照「并排」：折着、全展开、合一都从顶滚到底，一秒 ≥ 50 帧，每帧脚本 + 排版 + 样式 < 8 ms；并排两栏同一行顶差 ≤ 1px', async () => {
  test.setTimeout(300_000)
  // CN_SHOTS=目录：顺便截一张全展开后滚到中段的并排（交付图，量两栏对齐）；CN_SHOT_SKIN=mint|petrol 换主题
  const skin = process.env.CN_SHOT_SKIN
  const run = await launch(LONG_VAULT, {}, (vault) => {
    prepareLong(vault)
    if (!skin) return
    const ud = join(dirname(vault), 'user-data')
    mkdirSync(ud, { recursive: true })
    writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin, frame: 'b', winBg: 'aurora' } }))
  })
  const { page } = run
  try {
    await page.getByTestId('dream-card').getByRole('button', { name: '看报告' }).click()
    const panel = page.getByRole('complementary', { name: '梦游报告' })
    await panel.getByTestId('dream-item').filter({ hasText: '学习笔记：动手学深度学习' }).click()
    const t = page.locator('[data-testid="dream-tab"]:not([hidden])')
    await expect(t).toBeVisible()
    // 用户截图里的看法：并排、文档样子；对照是历史那一套（没改的折成「展开没改的 N 行」）
    await expect(acts(page).getByRole('tab', { name: '并排' })).toHaveAttribute('aria-selected', 'true')
    await expect(t.locator('.dv-diff.doc-look')).toBeVisible()
    await expect(t.locator('.cm-merge-b .cm-changedLine').first()).toBeVisible()
    await expect(t.getByTestId('dream-fbar')).toContainText(new RegExp(`改了\\s*${LONG_CHANGES}\\s*处`))
    const folds = t.locator('.cm-collapsedLines')
    await expect(folds.first()).toBeVisible()
    // 下一处：一处一处往下跳（36 处，折着的也跳得到）
    const sc0 = t.getByTestId('dream-scroll')
    await sc0.evaluate((el) => (el.scrollTop = 0))
    // 跳完等滚的位置停稳再记（跳过去以后编辑器量出上面几段的实际高，浏览器的滚动锚定会再挪几十 px；机器忙时记早了，「上一处」就比较错）
    const settled = () => sc0.evaluate((el) => new Promise<number>((done) => {
      let v = el.scrollTop
      let same = 0
      const tick = () => (el.scrollTop === v ? ++same : ((same = 0), (v = el.scrollTop)), same >= 6 ? done(v) : requestAnimationFrame(tick))
      requestAnimationFrame(tick)
    }))
    let last = 0
    for (let i = 0; i < 5; i++) {
      await acts(page).getByRole('button', { name: '下一处' }).click()
      await expect.poll(() => sc0.evaluate((el) => el.scrollTop)).toBeGreaterThan(last)
      last = await settled()
    }
    await acts(page).getByRole('button', { name: '上一处' }).click()
    await expect.poll(() => sc0.evaluate((el) => el.scrollTop)).toBeLessThan(last)
    await page.waitForTimeout(500)
    const idle = await scrollThrough(page, 0, 120)
    await scrollThrough(page, 40)
    const folded = await scrollThrough(page, 40)
    await expect(t.locator('.cm-merge-b .cm-line').last()).toBeInViewport()
    await page.screenshot({ path: test.info().outputPath('folded.png') })
    // 并排两栏对齐：折着时从顶翻到底，同一行两边顶差 ≤ 1px
    const alignFolded = await alignGap(page)
    // 一路展开到整篇（真点每一条「展开没改的 N 行」），再从顶滚到底
    // （编辑器只画看得见的那一截：从顶往下一屏一屏找，见到一条点一条）
    const sc = t.getByTestId('dream-scroll')
    await sc.evaluate((el) => (el.scrollTop = 0))
    let opened = 0
    for (let i = 0; i < 400; i++) {
      if (await folds.count()) {
        await folds.first().click()
        opened++
        await page.waitForTimeout(30)
        continue
      }
      const end = await sc.evaluate((el) => {
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) return true
        el.scrollTop += el.clientHeight
        return false
      })
      if (end) break
      await page.waitForTimeout(30)
    }
    expect(opened).toBeGreaterThan(LONG_CHANGES / 2)
    await expect(t.locator('.cm-collapsedLines')).toHaveCount(0)
    await scrollThrough(page, 40)
    const whole = await scrollThrough(page, 40)
    const alignWhole = await alignGap(page)
    // 滚到底以后：末尾那几行画出来了（不是空白），画着的只是看得见的那几十行
    await expect(t.locator('.cm-merge-b .cm-line').last()).toBeInViewport()
    const linesInDom = await t.evaluate((el) => el.querySelectorAll('.cm-merge-a .cm-line, .cm-merge-b .cm-line').length)
    await page.screenshot({ path: test.info().outputPath('whole-bottom.png') })
    if (process.env.CN_SHOTS) {
      await sc.evaluate((el) => (el.scrollTop = Math.round(el.scrollHeight * 0.47)))
      await page.waitForTimeout(600)
      const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
      writeFileSync(join(process.env.CN_SHOTS, `06-长文并排滚到中段-${skin ?? 'default'}.png`), Buffer.from(b64, 'base64'))
    }
    // 合一
    await acts(page).getByRole('tab', { name: '合一' }).click()
    await expect(t.locator('.dv-unified .cm-changedLine').first()).toBeVisible()
    await page.waitForTimeout(300)
    await scrollThrough(page, 40)
    const unified = await scrollThrough(page, 40)
    await acts(page).getByRole('tab', { name: '并排' }).click()
    const res = { idle, folded, whole, unified, linesInDom, opened, alignFolded, alignWhole }
    writeFileSync(test.info().outputPath('perf.json'), JSON.stringify(res, null, 2))
    console.log('perf', JSON.stringify(res))
    expect(linesInDom).toBeLessThan(400)
    for (const a of [alignFolded, alignWhole]) {
      expect(a.pairs).toBeGreaterThan(100)
      expect(a.worst, a.at).toBeLessThanOrEqual(1)
    }
    for (const r of [folded, whole, unified]) {
      expect(r.fps).toBeGreaterThanOrEqual(50)
      expect(work(r)).toBeLessThan(8)
    }
  } finally {
    await run.close()
  }
})
