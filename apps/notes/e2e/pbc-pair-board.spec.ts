/**
 * 配对笔记白板分列（2026-11-23 用户：「这个笔记的白板怎么做出来是一长条的…每个问话作为一列吧 旁支的话可以作为主对话 放在对话那一列」
 * 「这个白板不能从右往左滑，把“费曼学习”划到中间」）。一律无头、真点：
 * 1 造的样本（多问、旁支、划线段、框的图）：切到白板列数 = 问过的处数，旁支在本列它那一问下面，划线进那一页的列；
 *   按住一张卡拖走整列只多一行位置；切回文档文件一个字节不变。
 * 2 用户那篇真笔记的副本（CN_PBC_REAL=<文件夹>，不进仓库；不给就跳过）：一列、几张卡；打开不把白板推到费曼那一列；切回文档不变。
 * 3 平移：两指滑、按住空格拖、中键拖三种都能把最右那列、最左那列拖到画面正中（±40）；适合窗口后最左那列不在工具板底下。
 * 4 写一个词开费曼：那一列出在画面里。
 * 5 问的那句、引文整段露出（不截、不省略号）；长回答限高，「展开全文」点了整段、再点「收起」，文件一字节不变（用户：「收起来看不到我问的内容」）。
 */
import { expect, test, type Locator, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { acts, launch, openNote, pane, type Running, waitSaved } from './app'
import { LECTURE } from './fixtures/pdf'
import { solidPng } from './fixtures/png'
import { PB_CROP, PB_EIGHT as EIGHT, PB_LONG, PB_MD, PB_NOTE, PB_PDF } from './fixtures/paired-board'

const REAL = process.env.CN_PBC_REAL
const board = (page: Page) => pane(page).getByTestId('doc-board')
const col = (page: Page, title: string) => board(page).locator('.db-col', { has: page.locator('h3 .truncate', { hasText: title }) })
const read = (run: Running, path: string) => readFileSync(join(run.vault, path), 'utf8')
const git = (vault: string, ...a: string[]) => execFileSync('git', ['-C', vault, ...a], { encoding: 'utf8' }).trim()
const sample = () => launch({ [PB_PDF]: LECTURE, [PB_NOTE]: PB_MD, [PB_CROP]: solidPng(480, 160, [222, 232, 246]) }, { CN_AI_FAKE: '1' })

async function toBoard(page: Page, title: string) {
  await openNote(page, title)
  await acts(page).getByRole('tab', { name: '白板' }).click()
  await expect(board(page)).toBeVisible()
}
async function toDoc(page: Page) {
  await acts(page).getByRole('tab', { name: '文档' }).click()
  await expect(pane(page).locator('.cm-content')).toBeVisible()
  await waitSaved(page)
}
/** 卡片的种类（问过 AI 那一列里是哪一块）：从卡上的字认 */
const tops = async (page: Page, title: string) => (await col(page, title).locator('.db-card').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top)))

test('样本：每一处一列，旁支在它那一问下面，划线进那一页；按住卡拖走整列只多一行位置；切回文档一个字节不变', async () => {
  test.setTimeout(120_000)
  const run = await sample()
  const { page } = run
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await toBoard(page, '第3讲 笔记')
    // 列数 = 问过的处数（3 处）；第 5 页只划了线自己一列，最后是自己写的一列
    await expect(board(page).locator('.db-col[data-ask="1"]')).toHaveCount(3)
    await expect(board(page).locator('.db-col h3 .truncate')).toHaveText(['第1页 · 线性映射的定义', '第2页 · 加法条件', '第4页 · 核与像', '第 5 页 · 划的线', '我的总结'])
    const p1 = col(page, '第1页 · 线性映射的定义')
    await expect(p1.locator('h3 .meta')).toHaveText('5问')
    // 第 1 页：框的图（点了回 PDF）、两问、三条旁支、小结
    await expect(p1.locator('a.db-ask-crop img')).toBeVisible()
    const qa1 = p1.locator('.db-card', { hasText: '这块在讲什么？' })
    const side1 = p1.locator('.db-card', { hasText: '为什么叫「线性」？' })
    const side2 = p1.locator('.db-card', { hasText: '数乘为什么要单独列一条？' })
    const qa2 = p1.locator('.db-card', { hasText: '那旋转是不是线性映射？' })
    const side3 = p1.locator('.db-card', { hasText: '平行四边形怎么看出来？' })
    // 接着问的那一轮和第一条旁支是同一张
    await expect(side1).toContainText('那平移算不算？')
    const y = async (l: ReturnType<Page['locator']>) => (await l.boundingBox())!.y
    // 旁支在主对话下面：第一问 < 它的旁支 < 第二问 < 第二问的旁支 < 小结
    const ys = [await y(qa1), await y(side1), await y(side2), await y(qa2), await y(side3), await y(p1.locator('.db-card', { hasText: '旋转是，平移不是' }))]
    expect([...ys].sort((a, b) => a - b)).toEqual(ys)
    // 旁支和第一问在同一列（横着同一个位置）
    expect(Math.abs((await qa1.boundingBox())!.x - (await side3.boundingBox())!.x)).toBeLessThan(1)
    // 划线：第 2 页那一段写在问的前面，也进第 2 页那一列；第 4 页的进第 4 页
    await expect(col(page, '第2页 · 加法条件').locator('.db-ask-marks .mk')).toHaveText(['T(u + v) = T(u) + T(v)', 'for all scalars c'])
    await expect(col(page, '第4页 · 核与像').locator('.db-ask-marks .mk')).toHaveText(['the kernel of T'])
    await expect(col(page, '第 5 页 · 划的线').locator('.db-ask-marks .mk')).toHaveText(['rank-nullity theorem'])
    // 白板上不露写法
    await expect(board(page)).not.toContainText('[!question]')
    await expect(board(page)).not.toContainText('cn:hl')
    await expect(board(page)).not.toContainText('<!--')
    // 只切看法：一个字节不写
    expect(read(run, PB_NOTE)).toBe(PB_MD)
    await toDoc(page)
    expect(read(run, PB_NOTE)).toBe(PB_MD)
    expect(git(run.vault, 'status', '--porcelain')).toBe('')

    // 按住第一问那张卡拖到右边的空白处（缩到 50%，一排列的右边空着）：整列摆过去，标题前面多一行位置，别的字不动
    await acts(page).getByRole('tab', { name: '白板' }).click()
    for (let i = 0; i < 5; i++) await page.keyboard.press('Meta+Minus')
    await expect(board(page).getByTestId('board-zoom')).toContainText('50%')
    await home(page)
    const before = await tops(page, '第1页 · 线性映射的定义')
    const b = (await qa1.boundingBox())!
    await page.mouse.move(b.x + 40, b.y + 10)
    await page.mouse.down()
    // 落点：画面里一处空白（列 400 以后 50% 时一排列也铺满了画面右边，以前的「右边 200」落在列上）
    const spot = await board(page).locator('.board-wrap').evaluate((w) => {
      const r = w.getBoundingClientRect()
      for (let y = r.bottom - 80; y > r.top + 200; y -= 40)
        for (let x = r.right - 200; x > r.left + 300; x -= 40) {
          const ok = [-60, 0, 60].every((d) => [-40, 0, 40].every((e) => (document.elementFromPoint(x + d, y + e) as HTMLElement | null)?.matches('.db-plane, .db-stage, .board-wrap')))
          if (ok) return { x, y }
        }
      return null
    })
    expect(spot).not.toBeNull()
    await page.mouse.move(spot!.x, spot!.y, { steps: 10 })
    await page.mouse.up()
    await expect.poll(() => read(run, PB_NOTE)).toMatch(/<!-- column id=c1 x=\d+ y=\d+ -->\n## 第 1 页 · 线性映射的定义/)
    const moved = read(run, PB_NOTE)
    expect(moved.replace(/<!-- column id=c1 x=\d+ y=\d+ -->\n/, '')).toBe(PB_MD)
    // 整列一起走：卡的先后不变
    const after = await tops(page, '第1页 · 线性映射的定义')
    expect(after.length).toBe(before.length)
    expect(after.map((v) => v - after[0]!)).toEqual(before.map((v) => v - before[0]!))
  } finally {
    await run.close()
  }
})

test('真笔记副本：一列，问题、回答几节、小结；打开不把白板推到费曼那一列；切回文档一个字节不变', async () => {
  test.skip(!REAL, '没给真笔记的副本（CN_PBC_REAL）')
  test.setTimeout(120_000)
  const files: Record<string, Buffer> = {}
  for (const f of readdirSync(REAL!)) files[`课程/study project 2/${f}`] = readFileSync(join(REAL!, f))
  const note = readdirSync(REAL!).find((f) => f.endsWith(' 笔记.md'))!
  const path = `课程/study project 2/${note}`
  const original = files[path]!.toString('utf8')
  const run = await launch(files)
  const { page } = run
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await toBoard(page, note.replace(/\.md$/, ''))
    await expect(board(page).locator('.db-col[data-ask="1"]')).toHaveCount((original.match(/<!-- cn:thread=/g) ?? []).length)
    const c = board(page).locator('.db-col[data-ask="1"]').first()
    await expect(c.locator('h3 .truncate')).toHaveText('第1页 · SAGE：个性化压力与脑力负荷监测')
    // 链接那张、第一问、回答后面五节、小结；没有一张卡比画面还高很多（以前整篇一张）
    await expect(c.locator('.db-card')).toHaveCount(8)
    await expect(c.locator('.db-card').nth(1)).toContainText('给我大概介绍一下这个论文在讲什么')
    await expect(c.locator('.db-card').nth(5)).toContainText('读的时候值得留个心眼')
    // 打开时白板停在起点：这一列在画面里、在工具板右边
    const pal = (await board(page).locator('.bpal').boundingBox())!
    const cb = (await c.boundingBox())!
    expect(cb.x).toBeGreaterThanOrEqual(pal.x + pal.width)
    await toDoc(page)
    expect(read(run, path)).toBe(original)
    expect(git(run.vault, 'status', '--porcelain')).toBe('')
  } finally {
    await run.close()
  }
})

/** 一列的中心离画面（白板那一格）正中多远 */
async function offCenter(page: Page, title: string) {
  const w = (await board(page).locator('.board-wrap').boundingBox())!
  const h = (await col(page, title).locator('h3').boundingBox())!
  const c = (await col(page, title).boundingBox())!
  return { dx: c.x + c.width / 2 - (w.x + w.width / 2), dy: h.y - (w.y + w.height / 2), w, c }
}
const home = (page: Page) => board(page).locator('.board-wrap').evaluate((w) => w.scrollTo(...((w as HTMLElement).dataset.home!.split(',').map(Number) as [number, number])))

test('平移：两指滑、按住空格拖、中键拖都能把最右、最左那一列拖到画面正中；适合窗口后最左那列不在工具板底下', async () => {
  test.setTimeout(150_000)
  const run = await sample()
  const { page } = run
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await toBoard(page, '第3讲 笔记')
    for (let i = 0; i < 4; i++) await page.keyboard.press('Meta+Minus')
    await expect(board(page).getByTestId('board-zoom')).toContainText('67%')
    for (const title of ['我的总结', '第1页 · 线性映射的定义']) {
      // 两指滑（不按 ⌘）：一下一下滑过去
      await home(page)
      let o = await offCenter(page, title)
      await page.mouse.move(o.w.x + o.w.width / 2, o.w.y + o.w.height / 2)
      for (let k = 0; k < 40 && (Math.abs(o.dx) > 20 || Math.abs(o.dy) > 20); k++) {
        await page.mouse.wheel(Math.max(-120, Math.min(120, o.dx)), Math.max(-120, Math.min(120, o.dy)))
        await page.waitForTimeout(30)
        o = await offCenter(page, title)
      }
      expect(Math.abs(o.dx), `${title} 两指滑`).toBeLessThanOrEqual(40)
      expect(Math.abs(o.dy), `${title} 两指滑`).toBeLessThanOrEqual(40)
      // 按住空格拖：按在列头上拖到正中
      for (const how of ['space', 'middle'] as const) {
        await home(page)
        // 按在列头上拖；列 400 以后最右那列的列头可能在窗口外：先从白板正中拖几下，列头进了画面再按在列头上拖（一下拖不出白板）
        for (let k = 0; k < 4; k++) {
          const s = await offCenter(page, title)
          if (Math.abs(s.dx) <= 40 && Math.abs(s.dy) <= 40) break
          const head = { x: s.c.x + s.c.width / 2, y: s.c.y + 12 }
          const inside = head.x > s.w.x + 20 && head.x < s.w.x + s.w.width - 20 && head.y > s.w.y + 20 && head.y < s.w.y + s.w.height - 20
          const from = inside ? head : { x: s.w.x + s.w.width / 2, y: s.w.y + s.w.height / 2 }
          const to = { x: Math.max(s.w.x + 10, Math.min(s.w.x + s.w.width - 10, from.x - s.dx)), y: Math.max(s.w.y + 10, Math.min(s.w.y + s.w.height - 10, from.y - s.dy)) }
          await board(page).focus()
          if (how === 'space') await page.keyboard.down('Space')
          await page.mouse.move(from.x, from.y)
          await page.mouse.down({ button: how === 'space' ? 'left' : 'middle' })
          await page.mouse.move(to.x, to.y, { steps: 12 })
          await page.mouse.up({ button: how === 'space' ? 'left' : 'middle' })
          if (how === 'space') await page.keyboard.up('Space')
        }
        const e = await offCenter(page, title)
        expect(Math.abs(e.dx), `${title} ${how}`).toBeLessThanOrEqual(40)
        expect(Math.abs(e.dy), `${title} ${how}`).toBeLessThanOrEqual(40)
      }
    }
    // 拖过、滑过都不写文件
    expect(read(run, PB_NOTE)).toBe(PB_MD)
    // 适合窗口（⇧⌘1）：最左那一列在工具板右边
    await page.keyboard.press('Shift+Meta+1')
    await page.waitForTimeout(300)
    const pal = (await board(page).locator('.bpal').boundingBox())!
    await expect.poll(async () => (await col(page, '第1页 · 线性映射的定义').boundingBox())!.x).toBeGreaterThanOrEqual(pal.x + pal.width)
  } finally {
    await run.close()
  }
})

test('什么都没选，写一个词开费曼：那一列出在画面里（不挂到右下角外面）', async () => {
  test.setTimeout(120_000)
  const run = await sample()
  const { page } = run
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1200, 800))
    await toBoard(page, '第3讲 笔记')
    // 先往右下平移一段：在白板中间偏右开
    await board(page).locator('.board-wrap').evaluate((w) => w.scrollBy(500, 300))
    await board(page).getByTestId('pal-feynman').click()
    const pop = page.getByTestId('fy-start')
    await pop.getByRole('textbox', { name: '直接写一个词' }).fill('范数')
    await pop.getByTestId('fy-start-go').click()
    const c = pane(page).getByTestId('fy-col')
    await expect(c).toBeVisible({ timeout: 15_000 })
    // 白板平移过去是一段动画：等它停在画面里（以前固定等 0.8 秒，机器忙时动画还没走完就量）
    const where = async () => {
      const w = (await board(page).locator('.board-wrap').boundingBox())!
      const r = (await c.boundingBox())!
      return { left: r.x >= w.x, right: r.x + r.width <= w.x + w.width, top: r.y >= w.y, upper: r.y < w.y + w.height / 2 }
    }
    await expect.poll(where, { timeout: 10_000 }).toEqual({ left: true, right: true, top: true, upper: true })
    // 写进文件的位置行就在这一列现在的地方
    await expect.poll(() => read(run, PB_NOTE)).toMatch(/<!-- column id=c\d+ x=\d+ y=\d+ -->\n## 费曼 · 范数/)
  } finally {
    await run.close()
  }
})


test('8 问的配对笔记：8 列排成一行，第 7、8 列不收成列头、卡和字都在；普通文档 8 节照旧第 7 列起只留列头', async () => {
  test.setTimeout(120_000)
  const normal = '# 普通文档\n\n' + Array.from({ length: 8 }, (_, i) => `## 第${i + 1}节\n\n第${i + 1}节的字。\n`).join('\n')
  const run = await launch({ [PB_PDF]: LECTURE, [PB_NOTE]: EIGHT, '课程/线代/普通文档.md': normal })
  const { page } = run
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await toBoard(page, '第3讲 笔记')
    const asks = board(page).locator('.db-col[data-ask="1"]')
    await expect(asks).toHaveCount(8)
    await expect(board(page).locator('.db-col.fold')).toHaveCount(0)
    // 一行往右排：8 列同一个顶
    const tops8 = await asks.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)))
    expect(new Set(tops8).size).toBe(1)
    for (const n of [7, 8]) {
      const c = asks.nth(n - 1)
      await c.scrollIntoViewIfNeeded()
      await expect(c.locator('.db-card')).toHaveCount(3)
      await expect(c.locator('.db-card').nth(1)).toBeVisible()
      await expect(c).toContainText(`第${n}问问的是什么`)
      await expect(c).toContainText(`第${n}问的回答在这里。`)
      await expect(c).toContainText(`第${n}问的小结。`)
    }
    expect(read(run, PB_NOTE)).toBe(EIGHT)
    // 普通文档照旧：一排 6 列，第 7、8 节只留列头
    await toBoard(page, '普通文档')
    await expect(board(page).locator('.db-col.fold')).toHaveCount(2)
    await expect(board(page).locator('.db-col.fold h3 .truncate')).toHaveText(['第7节', '第8节'])
  } finally {
    await run.close()
  }
})

/** 这一块和里面的字都整段露出：没有省略号截掉的、没有被限高（line-clamp）藏住的 */
const fullyShown = (l: Locator) =>
  l.evaluate((root) =>
    [root, ...root.querySelectorAll('*')].every((e) => {
      const st = getComputedStyle(e)
      if (st.textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth + 1) return false
      return st.overflowY === 'visible' || e.scrollHeight <= e.clientHeight + 1
    }),
  )
/** 一行字在卡里看得见：没被藏在限高下面 */
const seen = (box: Locator, text: string) =>
  box.evaluate((root, text) => {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const i = n.textContent!.indexOf(text)
      if (i < 0) continue
      const r = document.createRange()
      r.setStart(n, i)
      r.setEnd(n, i + text.length)
      const a = r.getBoundingClientRect()
      for (let e: HTMLElement | null = n.parentElement; e && e !== root.parentElement; e = e.parentElement) {
        if (getComputedStyle(e).overflowY !== 'visible' && a.bottom > e.getBoundingClientRect().bottom + 1) return false
      }
      return true
    }
    return false
  }, text)

test('问的那句、引文整段露出；长回答「展开全文」点了整段、「收起」回去；文件一字节不变', async () => {
  test.setTimeout(120_000)
  const run = await launch({ [PB_PDF]: LECTURE, [PB_NOTE]: PB_LONG, [PB_CROP]: solidPng(480, 160, [222, 232, 246]) })
  const { page } = run
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await toBoard(page, '第3讲 笔记')
    const c = col(page, '第2页 · 加法条件')
    await c.scrollIntoViewIfNeeded()
    // 选字问的原文整段
    const quote = c.locator('.db-ask-quote')
    await expect(quote).toContainText('the end of the quote must stay visible.')
    expect(await fullyShown(quote)).toBe(true)
    expect(await seen(quote, 'the end of the quote must stay visible')).toBe(true)
    // 问句整段
    const qa = c.locator('.db-card', { has: page.locator('.db-ask-qa') })
    const q = qa.locator('.row.aq')
    await expect(q).toContainText('问句末尾这几个字也要看得见')
    expect(await fullyShown(q)).toBe(true)
    // 回答限高，截断处「展开全文」
    const btn = qa.locator('.db-unfold')
    await expect(btn).toHaveText('展开全文')
    expect(await seen(qa, '长回答的最后一句在这里')).toBe(false)
    await btn.click()
    await expect(btn).toHaveText('收起')
    expect(await fullyShown(qa.locator('.db-fold'))).toBe(true)
    expect(await seen(qa, '长回答的最后一句在这里')).toBe(true)
    await btn.click()
    await expect(btn).toHaveText('展开全文')
    expect(await seen(qa, '长回答的最后一句在这里')).toBe(false)
    // 回答短的（第 4 页）不出按钮
    const short = col(page, '第4页 · 核与像').locator('.db-card', { hasText: '被映射到零向量的那些向量。' })
    await expect(short).toBeVisible()
    await expect(short.locator('.db-unfold')).toHaveCount(0)
    // 展开、收起只是看法：一字节不写
    expect(read(run, PB_NOTE)).toBe(PB_LONG)
    await toDoc(page)
    expect(read(run, PB_NOTE)).toBe(PB_LONG)
    expect(git(run.vault, 'status', '--porcelain')).toBe('')
  } finally {
    await run.close()
  }
})
