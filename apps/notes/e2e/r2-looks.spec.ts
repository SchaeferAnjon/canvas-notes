/**
 * 发版前第 2 轮（美学）找出来的问题：每条一个测试，真点、真按，量屏幕上画出来的样子。
 */
import { expect, test, type Page } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { acts, launch, leftView, openAi, openNote, rail, tabOn, webAboveAi } from './app'
import { measureGaps, USER_TEXT, type Gap } from './cjk-gap'
import { LEFT_VAULT, withTimes } from './fixtures/left-vault'
import { LECTURE } from './fixtures/pdf'

const gaps = (page: Page, scope: string): Promise<Gap[]> =>
  page.evaluate(([s, k]) => (0, eval)(`(${s})`)(...k), [measureGaps.toString(), [scope, USER_TEXT, !!process.env.CN_GAP_ALL]] as const)
/** 在右栏开着的网页（webview）里跑一段 */
const guest = <T = unknown>(page: Page, code: string): Promise<T> =>
  page.evaluate((c) => {
    const w = document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> } | null
    try {
      return w ? w.executeJavaScript(c).catch(() => null) : null
    } catch {
      return null
    }
  }, code) as Promise<T>
const tree = (page: Page) => page.getByRole('tree', { name: '全部文件' })
const row = (page: Page, name: string) =>
  tree(page)
    .getByRole('treeitem')
    .filter({ has: page.locator('.truncate', { hasText: new RegExp(`^${name}$`) }) })
    .first()
async function expand(page: Page, name: string) {
  if ((await row(page, name).getAttribute('aria-expanded')) !== 'true') await row(page, name).locator('.ft-tw').click()
}

test('中文和数字、西文挨着：空隙全靠 autospace（量到 1–2.5px），不被 flex gap 撑开、不手打空格', async () => {
  const run = await launch({ ...LEFT_VAULT, '课程/线性代数/第4讲 特征值.pdf': LECTURE }, { CN_AI_FAKE: '1' }, (v) => withTimes(v))
  const { page, vault } = run
  try {
    // 底栏「本周2次提交」
    await expect(page.getByTestId('week-commits')).toBeVisible()
    expect.soft(await gaps(page, '.status')).toEqual([])

    // 文件夹首页：头上「剪藏 / 冰岛旅行 · 18篇」、「文件夹3」「再显示3篇」
    await leftView(page, '文件')
    await expand(page, '剪藏')
    await row(page, '冰岛旅行').click()
    await expect(tabOn(page)).toHaveText('冰岛旅行')
    await expect(page.getByTestId('folder-content').locator('.fc-more').first()).toBeVisible()
    expect.soft(await gaps(page, '.pane:not([hidden])')).toEqual([])

    // 读 PDF：右栏「看得到」的芯片「读过全文5页」「笔记0段」
    await expand(page, '课程')
    await expand(page, '线性代数')
    await row(page, '第4讲 特征值').click()
    await openAi(page)
    const r = page.getByRole('complementary', { name: '边读边问 AI' })
    await expect(r.getByTestId('reading-sees')).toContainText('读过全文', { timeout: 20_000 })
    expect.soft(await gaps(page, '[data-testid="reading-sees"]')).toEqual([])

    // 历史：「还没提交的改动」那一行「…每10分钟自动提交」
    const f = join(vault, '写作/投稿清单.md')
    writeFileSync(f, readFileSync(f, 'utf8') + '\n外面加的一句。\n')
    await rail(page).getByRole('button', { name: /^历史/ }).click()
    const h = page.getByRole('complementary', { name: '历史' })
    await expect(h).toContainText('每10分钟自动提交', { timeout: 10_000 })
    expect.soft(await gaps(page, 'aside.right[aria-label="历史"]')).toEqual([])

    // ⌘K：组头「文字 · 笔记和PDF里的字」
    await page.keyboard.press('Meta+k')
    const pal = page.getByRole('dialog', { name: '搜索和命令' })
    await pal.getByRole('textbox').fill('冰岛')
    await expect(pal.locator('.pal-g', { hasText: /^(最合适|笔记|笔记和PDF里的字)$/ }).first()).toBeVisible({ timeout: 10_000 })
    expect.soft(await gaps(page, '.pal')).toEqual([])
    await page.keyboard.press('Escape')

    // 右栏新网页（自带的 BookmarkKeeper）：开 autospace，日期「11月17日 · 星期二」，「0个网站」不手打空格
    await rail(page).getByRole('button', { name: '网页', exact: true }).click()
    const date = () => guest<string>(page, `document.getElementById('dateDisplay')?.textContent ?? ''`)
    await expect.poll(date, { timeout: 15_000 }).toMatch(/^\d{1,2}月\d{1,2}日 · 星期[日一二三四五六]$/)
    expect(await guest(page, `getComputedStyle(document.body).textAutospace`)).toBe('normal')
    expect.soft(await guest(page, `(${measureGaps.toString()})('body', 'input, textarea, code, kbd', ${!!process.env.CN_GAP_ALL})`)).toEqual([])
  } finally {
    await run.close()
  }
})

test('窄窗文件夹首页：卡片底下的「没开始」「2篇 · 10月8日」放不下时整段藏起来，不剩一个「没」字', async () => {
  const run = await launch(LEFT_VAULT, {}, (v) => withTimes(v))
  const { page, app } = run
  const size = (w: number, h: number) => app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0]!.setSize(w, h), [w, h] as const)
  /** 每张卡底下那段：看得见的宽（藏起来的算 0）和全文 */
  const metas = () =>
    page.getByTestId('folder-content').evaluate((root) =>
      [...root.querySelectorAll<HTMLElement>('.fc-tcard .fm, .fc-fcard .fm')].map((m) => {
        // 看得见的范围：那一行的框（overflow 切在内边距外沿，掉进下内边距里的半截字也看得见）
        const box = m.parentElement!.getBoundingClientRect()
        const r = m.getBoundingClientRect()
        const seen = Math.max(0, Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top))
        return { text: m.textContent ?? '', w: seen > 0 ? Math.round(m.clientWidth) : 0, whole: seen >= r.height - 1 || seen === 0, cut: m.scrollWidth > m.clientWidth + 1 }
      }),
    )
  try {
    for (const [w, h] of [
      [1100, 700],
      [960, 700],
      [1600, 1000],
    ] as const) {
      await size(w, h)
      await leftView(page, '文件')
      await expand(page, '剪藏')
      await row(page, '冰岛旅行').click()
      await expect(tabOn(page)).toHaveText('冰岛旅行')
      await expect(page.getByTestId('folder-content').locator('.fc-tcard').first()).toBeVisible()
      await page.waitForTimeout(300)
      const all = await metas()
      expect(all.length).toBeGreaterThan(3)
      // 露出来的至少放得下三个字（「没开始」整个，或「4张卡…」带省略号），不露半截一个字
      for (const m of all) {
        expect(m.w === 0 || m.w >= 36, `${w}：${m.text} 露了 ${m.w}px`).toBe(true)
        // 要么整行露着，要么一点都不露（不露半截字）
        expect(m.whole, `${w}：${m.text} 露了半截`).toBe(true)
      }
      await page.screenshot({ path: `test-results/r2-folder-cards-${w}.png` })
      if (w === 1600) expect(all.find((m) => m.text === '没开始')).toMatchObject({ cut: false })
    }
  } finally {
    await run.close()
  }
})

test('窗口最窄 960、读 PDF 又开着网页：右栏 250 上下时 AI 头的「收起」、当前网页标签、回答头那一行都整个露着', async () => {
  const titles: Record<string, string> = { '/a': 'Lecture 7 Eigenvalues', '/b': 'Linear maps and matrices', '/c': 'Third page with a long title' }
  const pages = createServer((q, r) => r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<title>${titles[q.url ?? ''] ?? 'x'}</title><h1>${q.url}</h1>`))
  await new Promise<void>((r) => pages.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(pages.address() as { port: number }).port}`
  const run = await launch({ ...LEFT_VAULT, '课程/线性代数/第4讲 特征值.pdf': LECTURE }, { CN_AI_FAKE: '1' }, (v) => withTimes(v))
  const { page, app } = run
  const size = (w: number, h: number) => app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0]!.setSize(w, h), [w, h] as const)
  const ai = page.getByRole('complementary', { name: '边读边问 AI' })
  const web = page.getByRole('complementary', { name: '网页' })
  const addr = web.getByRole('textbox', { name: '网址' })
  const inside = (inner: { x: number; width: number }, outer: { x: number; width: number }) => inner.x >= outer.x - 0.5 && inner.x + inner.width <= outer.x + outer.width + 0.5
  try {
    await size(1100, 700)
    await leftView(page, '文件')
    await expand(page, '课程')
    await expand(page, '线性代数')
    await row(page, '第4讲 特征值').click()
    await openAi(page)
    await expect(ai.getByTestId('reading-sees')).toContainText('读过全文', { timeout: 20_000 })
    // 问一页，等它答完：回答头上「✓ 读了第1页 · 引擎 · 模型」
    await acts(page).getByRole('button', { name: /问这一页/ }).click()
    await expect(ai.locator('.am .read').first()).toBeVisible({ timeout: 20_000 })
    await expect(ai.getByRole('button', { name: '发送' })).toBeVisible({ timeout: 20_000 })
    // 右栏开网页，三个标签，当前是最后一个
    await rail(page).getByRole('button', { name: '网页', exact: true }).click()
    for (const p of ['/a', '/b', '/c']) {
      if (p !== '/a') await web.locator('button.wnew').click()
      await addr.fill(base + p)
      await addr.press('Enter')
      await expect(web.locator('.wtabs .tab.on')).toContainText(titles[p]!.slice(0, 5), { timeout: 10_000 })
    }
    // 工作区方向 A（task-9okg5）：网页和 AI 默认是一组两个标签；拖成上下两块（网页在上）再看
    await webAboveAi(page)
    await size(960, 700)
    await page.waitForTimeout(900)
    const right = (await page.locator('.win .dcol').filter({ has: page.getByTestId('dtab-ai') }).boundingBox())!
    expect(right.width).toBeLessThan(300)
    // 收起 AI 是组头上「AI」标签的 ×（AI 头上不再有「收起 ⌘J」）：整个在这一组里；组头、AI 头都不溢出
    const grp = page.locator('.dgrp').filter({ has: page.getByTestId('dtab-ai') })
    const cb = (await page.getByTestId('dtab-ai').getByRole('button', { name: '收起AI' }).boundingBox())!
    const gb = (await grp.boundingBox())!
    expect(inside(cb, gb), `收起 ${cb.x}+${cb.width} 组 ${gb.x}+${gb.width}`).toBe(true)
    expect(await grp.locator('.dhead').evaluate((h) => h.scrollWidth <= h.clientWidth)).toBe(true)
    expect(await ai.locator('.aih').evaluate((h) => h.scrollWidth <= h.clientWidth)).toBe(true)
    // 当前网页标签整个在标签条里
    const list = (await web.locator('.wtlist').boundingBox())!
    const on = (await web.locator('.wtabs .tab.on').boundingBox())!
    expect(inside(on, list), `当前标签 ${on.x}+${on.width} 标签条 ${list.x}+${list.width}`).toBe(true)
    // 回答头：一行，放不下用省略号，不折成两行
    const rh = await ai
      .locator('.am .read')
      .first()
      .evaluate((e) => ({ h: e.getBoundingClientRect().height, line: parseFloat(getComputedStyle(e).fontSize) * 1.7 }))
    expect(rh.h).toBeLessThanOrEqual(Math.ceil(rh.line) + 1)
    await page.screenshot({ path: 'test-results/r2-960-right.png' })
  } finally {
    await run.close()
    pages.close()
  }
})

test('文档切白板：提示块那张卡整张是提示块的底，里面不再套一层圆角框', async () => {
  const doc = '# 贴士\n\n开头。\n\n> [!warning] 路上小心\n> 冬天路面结冰，一号公路东段常封路。\n\n> [!question] 要不要防滑链\n> 租车公司默认给钉胎。\n'
  const run = await launch({ '贴士.md': doc })
  const { page } = run
  try {
    await openNote(page, '贴士')
    await acts(page).getByRole('tab', { name: '白板' }).click()
    const cards = page.getByTestId('doc-board').locator('.db-card[data-kind="callout"]')
    await expect(cards).toHaveCount(2)
    await page.screenshot({ path: 'test-results/r2-callout-card.png' })
    for (const c of await cards.all()) {
      const m = await c.evaluate((card) => {
        const box = card.querySelector<HTMLElement>('.cl')!
        const cs = getComputedStyle(box)
        const icon = card.querySelector('.cl .ct svg')!.getBoundingClientRect()
        const plain = document.createElement('div')
        plain.style.background = 'var(--card)'
        card.parentElement!.appendChild(plain)
        const cardColor = getComputedStyle(plain).backgroundColor
        plain.remove()
        return { cardBg: getComputedStyle(card).backgroundColor, cardColor, innerBg: cs.backgroundColor, innerPad: cs.padding, iconLeft: Math.round(icon.left - card.getBoundingClientRect().left) }
      })
      // 整张卡就是提示块的底（比普通卡深一点），里面那一层没有底、没有内边距（照 doc-to-board 小样：卡的内边距 14/16）
      expect(m.cardBg).not.toBe(m.cardColor)
      expect(m.innerBg).toBe('rgba(0, 0, 0, 0)')
      expect(m.innerPad).toBe('0px')
      // 图标离卡的左边就是卡的内边距 16，不再多一层 12
      expect(m.iconLeft).toBeLessThanOrEqual(17)
    }
  } finally {
    await run.close()
  }
})

test('⌘K 换一个词：新结果回来之前不露上一个词的结果，先写「在找…」', async () => {
  const files: Record<string, string> = { '贴士.md': '# 贴士\n\n租车公司默认给钉胎。\n', '冰岛行前准备.md': '# 冰岛行前准备\n\n钉胎和防滑链。\n' }
  for (let i = 0; i < 300; i++) files[`日记/第${i}天.md`] = `# 第${i}天\n\n平常的一天。\n`
  const run = await launch(files)
  const { page } = run
  try {
    await page.keyboard.press('Meta+k')
    const pal = page.getByRole('dialog', { name: '搜索和命令' })
    const box = pal.getByRole('textbox')
    await box.fill('钉胎')
    await expect(pal.getByRole('option').filter({ hasText: '租车公司默认给钉胎' })).toBeVisible()
    // 每一帧（用户看得到的样子）记下：输入框里已经是新词时，列表里还挂着旧词的结果
    await page.evaluate(() => {
      const bad: string[] = []
      ;(window as unknown as { stale: string[] }).stale = bad
      const end = performance.now() + 4000
      const frame = () => {
        if (document.querySelector<HTMLInputElement>('.pal-in input')?.value === '完全不存在的词')
          for (const r of document.querySelectorAll('.pal-row')) if (r.textContent?.includes('钉胎')) bad.push(r.textContent)
        if (performance.now() < end) requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
    })
    await box.fill('完全不存在的词')
    await expect(pal.locator('.pal-none')).toHaveText('笔记和PDF里都没有「完全不存在的词」这几个字')
    expect(await page.evaluate(() => (window as unknown as { stale: string[] }).stale)).toEqual([])
  } finally {
    await run.close()
  }
})
