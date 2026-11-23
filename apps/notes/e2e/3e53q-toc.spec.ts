// task-3e53q 设计页「三、b」「四、c」：AI 对话目录（照文档目录条）和旁支头上的「全能 / 只在库里」标签。
// 真点：问一问就出细条；指着展开、点一条滚过去、正在看的亮；旁支挂在那一问下面、截短；读 PDF 的 AI 和旁支里也有；
// 全能开关开关后旁支标签字跟着变。一律无头（CN_E2E=1）、假 AI（CN_AI_FAKE=1，问里有「分几节讲」答三个小标题）、临时库。
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launch, openAi, openNote, tabOn } from './app'
import { LECTURE } from './fixtures/pdf'

const PDF = '课程/线代/第3讲.pdf'
const files = { '收件箱/随手.md': '# 随手\n\n问问 AI。\n', [PDF]: LECTURE }
const ENV = { CN_AI_FAKE: '1', CN_FAKE_SAY_MS: '1' }

const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const reading = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })
const bar = (col: Locator) => col.locator('[data-part="对话目录条"]')
const pop = (col: Locator) => col.locator('[data-part="对话目录浮层"]')
const askbox = (page: Page) => page.getByRole('dialog', { name: '选中的这句' })
/** 条上第几条亮着 */
const onAt = (col: Locator) => bar(col).evaluate((b) => [...b.children].findIndex((i) => i.classList.contains('on')))

async function ask(col: Locator, testid: string, text: string, done: string) {
  const ta = col.getByRole('textbox', { name: '问 AI' })
  await ta.fill(text)
  await ta.press('Enter')
  await expect(col.getByTestId(testid).last()).toContainText(done, { timeout: 20_000 })
  await expect(col.getByRole('button', { name: '发送' })).toBeVisible({ timeout: 20_000 })
}

async function selectText(page: Page, scope: Locator, from: string, to: string) {
  const pts = await scope.evaluate(
    (root, [a, b]) => {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      while (w.nextNode()) {
        const n = w.currentNode as Text
        const i = n.data.indexOf(a!)
        const j = n.data.indexOf(b!, i)
        if (i < 0 || j < 0) continue
        const r = document.createRange()
        r.setStart(n, i)
        r.setEnd(n, j + b!.length)
        n.parentElement!.scrollIntoView({ block: 'center' })
        const rs = r.getClientRects()
        return [rs[0]!.left + 1, rs[0]!.top + rs[0]!.height / 2, rs[rs.length - 1]!.right - 1, rs[rs.length - 1]!.top + rs[rs.length - 1]!.height / 2]
      }
      throw new Error('没找到那一句')
    },
    [from, to],
  )
  await page.mouse.move(pts[0]!, pts[1]!)
  await page.mouse.down()
  await page.mouse.move(pts[2]!, pts[3]!, { steps: 8 })
  await page.mouse.up()
}

/** 指着细条：0.2 秒后展开浮层 */
async function hoverBar(page: Page, col: Locator) {
  const b = (await bar(col).boundingBox())!
  await page.mouse.move(b.x + b.width / 2, b.y + 6)
  await expect(pop(col)).toBeVisible()
}
async function leave(page: Page, col: Locator) {
  await page.mouse.move(5, 300)
  await expect(pop(col)).toHaveCount(0)
}
/** 元素离对话那一格顶上多远 */
const fromTop = (el: Locator, list: Locator) => Promise.all([el.boundingBox(), list.boundingBox()]).then(([e, l]) => e!.y - l!.y)

test('AI 对话目录：问一问就出细条，贴着右边不挡字；指着展开、点一条滚过去、正在看的亮；旁支挂在那一问下面、截短；旁支头上的标签跟着全能开关变', async () => {
  const run = await launch(files, ENV)
  const { page } = run
  try {
    await openNote(page, '随手')
    await openAi(page)
    const col = chat(page)
    const list = col.locator('.msgs')
    // 还没问：没有细条
    await expect(bar(col)).toHaveCount(0)

    // 问一问就出（不设 3 问门槛）：一问一条长横线 + 回答里三个小标题三条短横线
    await ask(col, 'ai-msg', '整体在做什么分几节讲', '整体在做什么 · 结果')
    await expect(bar(col).locator('i')).toHaveCount(4)
    await expect(bar(col).locator('i.d0')).toHaveCount(1)
    await expect(bar(col).locator('i.d1')).toHaveCount(3)
    // 横线右端离栏右边 20；回答的字和气泡右边离横线至少 10，不挡字
    const cb = (await col.boundingBox())!
    const bb = (await bar(col).locator('i.d0').boundingBox())!
    expect(Math.abs(cb.x + cb.width - (bb.x + bb.width) - 20)).toBeLessThanOrEqual(1)
    const left = (await bar(col).locator('i').first().boundingBox())!.x
    for (const el of [col.locator('.um').first(), col.locator('.am .txt').first()]) {
      const r = (await el.boundingBox())!
      expect(r.x + r.width).toBeLessThanOrEqual(left - 10 + 0.5)
    }

    await ask(col, 'ai-msg', '留一被试是什么分几节讲', '留一被试是什 · 结果')
    await ask(col, 'ai-msg', '数据泄漏在哪分几节讲', '数据泄漏在哪 · 结果')
    await expect(bar(col).locator('i')).toHaveCount(12)
    // 停在最底下：亮的是最后一问那几条里的
    expect(await onAt(col)).toBeGreaterThanOrEqual(8)

    // 指着展开：264 宽，头一行「这段对话 · 3 问」，一行一问（序号 + 问题），下面一级是回答里的小标题
    await hoverBar(page, col)
    expect(Math.round((await pop(col).boundingBox())!.width)).toBe(264)
    await expect(pop(col).locator('.hd')).toContainText('这段对话 · 3 问')
    await expect(pop(col).locator('.r.q')).toHaveText(['1整体在做什么分几节讲', '2留一被试是什么分几节讲', '3数据泄漏在哪分几节讲'])
    await expect(pop(col).locator('.r').nth(1)).toHaveText('整体在做什么 · 一句话')
    await expect(pop(col).locator('.r.h')).toHaveCount(9)
    // 浮层整个在右栏里
    const pb = (await pop(col).boundingBox())!
    expect(pb.x).toBeGreaterThanOrEqual(cb.x)

    // 点第一问的「三步」：对话滚过去，那一条亮着
    await pop(col).locator('.r', { hasText: '整体在做什么 · 三步' }).click()
    await expect(pop(col)).toHaveCount(0)
    const h = col.locator('.am .md-h', { hasText: '整体在做什么 · 三步' })
    await expect.poll(() => fromTop(h, list)).toBeLessThan(40)
    await expect.poll(() => onAt(col)).toBe(2)
    await leave(page, col)
    await hoverBar(page, col)
    await expect(pop(col).locator('.r.on')).toHaveText('整体在做什么 · 三步')
    // 点第二问：气泡滚到上面，外圈亮一下
    await pop(col).locator('.r.q', { hasText: '留一被试' }).click()
    const q2 = col.locator('.um-wrap').nth(1)
    await expect.poll(() => fromTop(q2, list)).toBeLessThan(40)
    await expect(q2.locator('.um')).toHaveClass(/toc-hit/)
    await expect.poll(() => onAt(col)).toBe(4)
    await leave(page, col)

    // 键盘：展开时 ↑↓ 选、↵ 跳过去
    await hoverBar(page, col)
    await page.keyboard.press('ArrowDown')
    await expect(pop(col).locator('.r.kb')).toHaveText('留一被试是什 · 一句话')
    await page.keyboard.press('Enter')
    await expect(pop(col)).toHaveCount(0)
    await expect.poll(() => onAt(col)).toBe(5)
    await leave(page, col)

    // 旁支：在第二问回答「三步」那一段里选一句开旁支，问一句长的
    const a2 = col.getByTestId('ai-msg').nth(1)
    await selectText(page, a2.locator('.txt'), '三：先把', '30 秒一窗')
    await expect(askbox(page)).toBeVisible()
    await askbox(page).getByRole('textbox', { name: '问这句' }).fill('这一段里说的随机划分和留一被试到底差在哪里')
    await askbox(page).getByRole('textbox', { name: '问这句' }).press('Enter')
    const side = col.getByRole('region', { name: '旁支' })
    await expect(side.getByTestId('side-msg').last()).toContainText('第二段', { timeout: 20_000 })
    // 旁支开着时主输入框缩成一行、全能那行藏起（照现在）
    await expect(col.getByTestId('ai-input-slim')).toBeVisible()
    await expect(col.getByTestId('ai-omni')).toHaveCount(0)
    // 旁支头上灰色小标签：默认全能；只显示、不能点（不是按钮），指着出说明
    const tag = side.getByTestId('side-mode')
    await expect(tag).toHaveText('全能')
    expect(await tag.evaluate((e) => e.tagName)).toBe('SPAN')
    await tag.hover()
    await expect(page.getByTestId('tooltip')).toContainText('全能：能读写这台 Mac 上的文件、跑命令、上网。')
    await expect(page.getByTestId('tooltip')).toContainText('和主对话同一个开关；收起旁支后，在输入框下面那行改。')
    await tag.click()
    await expect(tag).toHaveText('全能')

    // 目录：旁支是强调色的短横线，挂在第二问「三步」后面；旁支回答里的小标题（「旁支的回答」）不进目录
    await expect(bar(col).locator('i')).toHaveCount(13)
    expect(await bar(col).evaluate((b) => [...b.children].findIndex((i) => i.classList.contains('ds')))).toBe(7)
    await hoverBar(page, col)
    const sRow = pop(col).locator('.r.s')
    await expect(sRow).toHaveCount(1)
    await expect(pop(col).locator('.r').nth(7)).toHaveClass(/\bs\b/)
    await expect(pop(col).locator('.r', { hasText: '旁支的回答' })).toHaveCount(0)
    // 一行截短：30 高，名字放不下是省略号
    await expect(sRow).toHaveAttribute('title', '这一段里说的随机划分和留一被试到…')
    expect(Math.round((await sRow.boundingBox())!.height)).toBe(30)
    expect(await sRow.locator('.tx').evaluate((e) => e.scrollWidth > e.clientWidth && getComputedStyle(e).textOverflow === 'ellipsis')).toBe(true)
    await leave(page, col)

    // 收起旁支（点缩成一行的主输入框），把全能关掉；从目录点那条旁支：打开它，标签写「只在库里」
    await col.getByTestId('ai-input-slim').click()
    await expect(side).toHaveCount(0)
    const sw = col.getByRole('switch', { name: '全能模式' })
    await expect(sw).toHaveAttribute('aria-checked', 'true')
    await sw.click()
    await expect(sw).toHaveAttribute('aria-checked', 'false')
    await list.evaluate((e) => e.scrollTo({ top: 0 }))
    await expect.poll(() => onAt(col)).toBe(0)
    await hoverBar(page, col)
    await pop(col).locator('.r.s').click()
    await expect(side).toBeVisible()
    await expect(side.getByTestId('side-mode')).toHaveText('只在库里')
    await side.getByTestId('side-mode').hover()
    await expect(page.getByTestId('tooltip')).toContainText('只在库里：能读库里的笔记')
    await expect.poll(() => fromTop(side, list)).toBeLessThan(400)
    await expect.poll(() => fromTop(side, list)).toBeGreaterThan(-40)
    // 开着旁支目录照样在
    await expect(bar(col).locator('i')).toHaveCount(13)
    // 再开回全能：旁支开着时开关藏着，收起来改
    await col.getByTestId('ai-input-slim').click()
    await sw.click()
    await expect(sw).toHaveAttribute('aria-checked', 'true')
    await hoverBar(page, col)
    await pop(col).locator('.r.s').click()
    await expect(side.getByTestId('side-mode')).toHaveText('全能')
  } finally {
    await run.close()
  }
})

test('读 PDF 的 AI 也有对话目录：问一问就出，点小标题滚过去；旁支挂在那一问下面，旁支头上有「全能 / 只在库里」', async () => {
  const run = await launch(files, ENV)
  const { page } = run
  try {
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
    await page.locator('.pal-row', { hasText: '第3讲' }).first().click()
    await expect(tabOn(page)).toHaveText('第3讲.pdf')
    await openAi(page)
    const col = reading(page)
    const list = col.locator('.msgs')
    await expect(bar(col)).toHaveCount(0)
    await ask(col, 'reading-msg', '这一页分几节讲', '这一页 · 结果')
    await expect(bar(col).locator('i')).toHaveCount(4)
    await ask(col, 'reading-msg', '公式那块分几节讲', '公式那块 · 结果')
    await expect(bar(col).locator('i')).toHaveCount(8)

    await hoverBar(page, col)
    await expect(pop(col).locator('.hd')).toContainText('这段对话 · 2 问')
    await expect(pop(col).locator('.r.q')).toHaveText(['1这一页分几节讲', '2公式那块分几节讲'])
    await pop(col).locator('.r', { hasText: '这一页 · 结果' }).click()
    const h = col.locator('.am .md-h', { hasText: '这一页 · 结果' })
    await expect.poll(() => fromTop(h, list)).toBeLessThan(40)
    await expect.poll(() => onAt(col)).toBe(3)
    await leave(page, col)

    // 旁支：第一问回答里选一句开
    const a1 = col.getByTestId('reading-msg').first()
    await selectText(page, a1.locator('.txt'), '一：先把', '30 秒一窗')
    await expect(askbox(page)).toBeVisible()
    await askbox(page).getByRole('textbox', { name: '问这句' }).fill('窗口怎么切')
    await askbox(page).getByRole('textbox', { name: '问这句' }).press('Enter')
    const side = col.getByRole('region', { name: '旁支' })
    await expect(side.getByTestId('side-msg').last()).toContainText('第二段', { timeout: 20_000 })
    await expect(side.getByTestId('side-mode')).toHaveText('全能')
    await expect(bar(col).locator('i.ds')).toHaveCount(1)
    expect(await bar(col).evaluate((b) => [...b.children].findIndex((i) => i.classList.contains('ds')))).toBe(2)
    await hoverBar(page, col)
    await expect(pop(col).locator('.r.s')).toHaveText('旁支 · 窗口怎么切')
  } finally {
    await run.close()
  }
})
