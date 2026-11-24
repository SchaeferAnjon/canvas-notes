/**
 * 混排文档（剪藏 + 自己打的字 + 问答）切白板（2026-11-24 用户批的「切白板的样子」，doc-board.ts 7b、7c）。一律无头、真点真拖：
 * 1 造的样本（一节里两处网页、自己打的字、两问带引文和图、一条旁支）：列和小列数对、问答成组、旁支在回答下面、没有收起的列；
 *   切白板再切回文件一字节不变；拖一张剪藏卡、一组问答到空白处只多位置那几行；白板上改回答里一句，文件里只那一行变。
 * 2 用户那篇真笔记的只读拷贝（CN_MIXED_REAL=<拷贝的库文件夹>，不进仓库；不给就跳过），薄荷、深湖各一遍：
 *   「2. 预备知识」按来源分小列、两组问答、旁支在组里、问题不当列名、没有一张卡装着整节；切回文档一字节不变。
 *   CN_MIXED_SHOTS=<文件夹>：截改后图。
 * 3 问的那句、① 引文整段露出（不截、不省略号）；长回答限高，截断处「展开全文」点了整段、再点「收起」，文件一字节不变（用户：「收起来看不到我问的内容」）。
 */
import { expect, test, type Locator, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { acts, launch, openNote, pane, type Running, waitSaved } from './app'
import { skinned } from './fixtures/book-digest'
import { LONG_ASKED, LONG_MD, LONG_NOTE, LONG_Q, MX_CROP1, MX_CROP2, MX_MD, MX_NOTE } from './fixtures/mixed-board'
import { solidPng } from './fixtures/png'

const REAL = process.env.CN_MIXED_REAL
const SHOTS = process.env.CN_MIXED_SHOTS
const board = (page: Page) => pane(page).getByTestId('doc-board')
const col = (page: Page, title: string) => board(page).locator('.db-col', { has: page.locator('h3 .truncate', { hasText: title }) })
const read = (run: Running, path: string) => readFileSync(join(run.vault, path), 'utf8')
const git = (vault: string, ...a: string[]) => execFileSync('git', ['-C', vault, ...a], { encoding: 'utf8' }).trim()
const home = (page: Page) => board(page).locator('.board-wrap').evaluate((w) => w.scrollTo(...((w as HTMLElement).dataset.home!.split(',').map(Number) as [number, number])))
const parts = (g: Locator) => g.locator('.db-card').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.part))

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
/** 拖到画面右边的空白处（缩到 50%，一排列的右边空着） */
async function dragToBlank(page: Page, from: Locator, dy: number) {
  const b = (await from.boundingBox())!
  const area = (await board(page).locator('.board-wrap').boundingBox())!
  await page.mouse.move(b.x + 30, b.y + 8)
  await page.mouse.down()
  await page.mouse.move(area.x + area.width - 220, area.y + dy, { steps: 12 })
  await page.mouse.up()
}

test('样本：按「##」分列、按来源分小列、问答成组旁支在下面、全展开；切回不变；拖卡只多位置行；改一句只变那一行', async () => {
  test.setTimeout(150_000)
  const run = await launch({ [MX_NOTE]: MX_MD, [MX_CROP1]: solidPng(360, 120, [222, 232, 246]), [MX_CROP2]: solidPng(360, 120, [246, 232, 222]) })
  const { page } = run
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await toBoard(page, '卷积笔记')
    // 列：「读书」一节按来源分成三小列（开头自己的字、6.1.2、6.2.1），再是「别的」；问题不当列名
    await expect(board(page).locator('.db-col h3 .truncate')).toHaveText(['读书', '6.1.2 多层感知机的限制', '6.2.1 互相关运算', '别的'])
    await expect(board(page).locator('.db-col[data-slice]')).toHaveCount(3)
    await expect(board(page).locator('.db-col[data-slice="first"]')).toHaveCount(1)
    await expect(board(page).locator('.db-col-sec')).toHaveText(['读书', '读书'])
    await expect(board(page).locator('.db-col[data-ask="1"]')).toHaveCount(0)
    // 全部展开：没有只剩列头的列，没有「还有N张」
    await expect(board(page).locator('.db-col.fold')).toHaveCount(0)
    await expect(board(page).locator('.db-more')).toHaveCount(0)

    // 6.1.2 那一小列：两段剪藏、第一问那一组（问的那张 + 回答）、自己打的字，照文档顺序
    const c1 = col(page, '6.1.2 多层感知机的限制')
    await expect(c1.locator('h3 .meta')).toHaveText('5张')
    const g1 = c1.locator('.db-askgroup')
    await expect(g1).toHaveCount(1)
    expect(await parts(g1)).toEqual(['q', 'qa'])
    const q1 = g1.locator('.db-card[data-part="q"]')
    await expect(q1.locator('.row.aq')).toHaveText('①这部分看不懂是说什么')
    await expect(q1.locator('.db-ask-quote')).toContainText('① 我们将参数替换为四阶权重张量')
    // 引文里的公式照排，不露 LaTeX 原文
    await expect(q1.locator('.db-ask-quote .katex').first()).toBeVisible()
    await expect(q1.locator('a.db-ask-src')).toHaveText('—— 6.1.2 多层感知机的限制 · 动手学深度学习 ↩')
    await expect(q1.locator('.db-ask-crop img')).toBeVisible()
    const a1 = g1.locator('.db-card[data-part="qa"]')
    await expect(a1).toContainText('全连接层里每个隐藏像素')
    await expect(a1).toHaveAttribute('data-face', 'callout')
    // 回答框头两行：「AI 回答」，下一行「Claude Code · Opus 5.5 · 回到 AI 对话」（和文档里的回答框一样）
    await expect(a1.locator('.cl .ct .nm')).toHaveText('AI 回答')
    await expect(a1.locator('.cl .ct .eng')).toHaveText('Claude Code · Opus 5.5 · 回到 AI 对话')
    await expect(a1.locator('a.db-chat')).toBeVisible()
    const mine = c1.locator('.db-card', { hasText: '我的理解：' })
    const y = async (l: Locator) => (await l.boundingBox())!.y
    expect(await y(q1)).toBeLessThan(await y(a1))
    expect(await y(a1)).toBeLessThan(await y(mine))

    // 6.2.1 那一小列：一段剪藏、第二问那一组（问的、回答、旁支）、最后补的一句
    const c2 = col(page, '6.2.1 互相关运算')
    const g2 = c2.locator('.db-askgroup')
    expect(await parts(g2)).toEqual(['q', 'qa', 'sideq', 'qa'])
    const a2 = g2.locator(':scope > .db-card[data-part="qa"]')
    const s2 = g2.locator('.db-askside .db-card[data-part="sideq"]')
    const sa2 = g2.locator('.db-askside .db-card[data-part="qa"]')
    await expect(sa2).toContainText('补一圈零以后')
    await expect(sa2.locator('.cl .ct .nm')).toHaveText('旁支回答')
    await expect(s2).toContainText('那补一圈零呢？')
    // 旁支在回答下面、往里缩一格；旁支回答里的公式照排
    expect(await y(s2)).toBeGreaterThan(await y(a2))
    expect((await s2.boundingBox())!.x).toBeGreaterThan((await a2.boundingBox())!.x + 8)
    await expect(s2.locator('.sq')).toContainText('卷积核不能伸出图像边界')
    expect(await y(sa2)).toBeGreaterThan(await y(s2))
    await expect(sa2.locator('.katex').first()).toBeVisible()
    expect(await y(c2.locator('.db-card', { hasText: '最后自己补一句' }))).toBeGreaterThan(await y(sa2))

    // 白板上不露写法
    await expect(board(page)).not.toContainText('[!ai]')
    await expect(board(page)).not.toContainText('<!--')
    // 公式照排（KaTeX 的 MathML 里留着 TeX 原文，不带 $）：不露「$\mathsf」这种写法
    await expect(board(page)).not.toContainText('$\\')
    await expect(board(page)).not.toContainText('canvas-notes://')

    // 只切看法：一个字节不写
    expect(read(run, MX_NOTE)).toBe(MX_MD)
    await toDoc(page)
    expect(read(run, MX_NOTE)).toBe(MX_MD)
    expect(git(run.vault, 'status', '--porcelain')).toBe('')

    // 拖第二问那一组（按住问的那张）到空白处：整组摆过去，问的标题前面多一行位置，正文不动
    await acts(page).getByRole('tab', { name: '白板' }).click()
    for (let i = 0; i < 5; i++) await page.keyboard.press('Meta+Minus')
    await expect(board(page).getByTestId('board-zoom')).toContainText('50%')
    await home(page)
    await dragToBlank(page, g2.locator('.db-card[data-part="q"]'), 160)
    await expect.poll(() => read(run, MX_NOTE)).toMatch(/<!-- card id=d1 x=\d+ y=\d+ -->\n### ②为什么输出变小了/)
    const placedG = board(page).locator('.db-askgroup.placed')
    await expect(placedG).toHaveCount(1)
    expect(await parts(placedG)).toEqual(['q', 'qa', 'sideq', 'qa'])
    // 拖一张剪藏卡到空白处：这段前面多一行位置
    await dragToBlank(page, col(page, '6.2.1 互相关运算').locator('.db-card.fc-clip', { hasText: '严格来说' }), 420)
    await expect.poll(() => read(run, MX_NOTE)).toMatch(/<!-- card id=d2 x=\d+ y=\d+ -->\n> 严格来说/)
    await waitSaved(page)
    const placed = read(run, MX_NOTE)
    expect(placed.replace(/<!-- card id=d[12] x=\d+ y=\d+ -->\n/g, '')).toBe(MX_MD)
    // git diff 只有新加的两行位置
    const diff = git(run.vault, 'diff', '-U0', '--', MX_NOTE).split('\n').filter((l) => /^[+-](?![+-])/.test(l))
    expect(diff.length).toBe(2)
    expect(diff.every((l) => /^\+<!-- card id=d[12] x=\d+ y=\d+ -->$/.test(l))).toBe(true)

    // 白板上改回答里一句：双击回答那张就地改，文件里只那一行变，[!ai] 头那行不动
    await page.keyboard.press('Meta+0')
    await home(page)
    // 6.2.1 那段剪藏摆出去以后这一节只剩一处来源，「读书」不再分小列
    await expect(board(page).locator('.db-col[data-slice]')).toHaveCount(0)
    const ans = col(page, '读书').locator('.db-askgroup > .db-card[data-part="qa"]', { hasText: '所以参数特别多' })
    await ans.scrollIntoViewIfNeeded()
    // 回答的字上双击是选词（开旁支），双击卡头就地改（和普通 AI 讲解卡一样）
    await ans.locator('.cl .ct').dblclick()
    const ed = ans.getByRole('textbox', { name: '卡片内容' })
    await expect(ed).toBeFocused()
    await page.keyboard.press('Meta+ArrowDown')
    await page.keyboard.type('（我补）')
    await board(page).locator('.board-wrap').click({ position: { x: 20, y: 600 } })
    await expect(board(page).locator('.db-toast')).toContainText('改好了')
    await waitSaved(page)
    const edited = read(run, MX_NOTE)
    // 改的那一行变了；AI 块头上照 ai-block.ts 的规矩多一个「改过」（文档里改 AI 回答也一样），别的一个字不动
    expect(edited).toBe(placed.replace('> 所以参数特别多。\n', '> 所以参数特别多。（我补）\n').replace('Opus 5.5 · [回到 AI 对话](canvas-notes://chat?key=file%3A%E5%8D%B7%E7%A7%AF%E7%AC%94%E8%AE%B0.md&msg=1795500000001)', 'Opus 5.5 · 改过 · [回到 AI 对话](canvas-notes://chat?key=file%3A%E5%8D%B7%E7%A7%AF%E7%AC%94%E8%AE%B0.md&msg=1795500000001)'))
    // 切到文档：文档里那句跟着变了
    await toDoc(page)
    await expect(pane(page).locator('.cm-content')).toContainText('所以参数特别多。（我补）')
    expect(read(run, MX_NOTE)).toBe(edited)
    // 自己打的字那张也一样：双击改一个词，只那一行变
    await acts(page).getByRole('tab', { name: '白板' }).click()
    const mineCard = col(page, '读书').locator('.db-card', { hasText: '我的理解：' })
    await mineCard.scrollIntoViewIfNeeded()
    await mineCard.dblclick()
    await expect(mineCard.getByRole('textbox', { name: '卡片内容' })).toBeFocused()
    await page.keyboard.press('Meta+ArrowDown')
    await page.keyboard.type('（对）')
    await board(page).locator('.board-wrap').click({ position: { x: 20, y: 600 } })
    await expect(board(page).locator('.db-toast')).toContainText('改好了')
    await waitSaved(page)
    expect(read(run, MX_NOTE)).toBe(edited.replace('谁挨着谁就丢了。\n', '谁挨着谁就丢了。（对）\n'))
  } finally {
    await run.close()
  }
})

/** 拷贝的库里的文件（相对路径 → 内容），只读 */
function filesOf(dir: string): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {}
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f)
      if (statSync(p).isDirectory()) walk(p)
      else if (!f.startsWith('.')) out[relative(dir, p)] = readFileSync(p)
    }
  }
  walk(dir)
  return out
}

for (const skin of ['mint', 'petrol'] as const) {
  test(`真笔记拷贝（${skin}）：「2. 预备知识」按来源分小列、两组问答、旁支在组里、全展开；切回文档一字节不变`, async () => {
    test.skip(!REAL, '没给真笔记的拷贝（CN_MIXED_REAL）')
    test.setTimeout(150_000)
    const files = filesOf(REAL!)
    const NOTE = Object.keys(files).find((f) => f.endsWith('学习笔记：动手学深度学习.md'))!
    const orig = Buffer.from(files[NOTE]!).toString('utf8')
    const run = await launch(files, {}, skinned(skin))
    const { page } = run
    try {
      await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
      await toBoard(page, '学习笔记：动手学深度学习')
      const titles = await board(page).locator('.db-col h3 .truncate').allTextContents()
      // 「2. 预备知识」还在（以前被两个问题顶掉了），分出的小列里有 6.1.2、6.2.1；问题不当列名
      expect(titles).toContain('2. 预备知识')
      expect(titles).toContain('6.1.2 多层感知机的限制')
      expect(titles).toContain('6.2.1 互相关运算')
      expect(titles.some((t) => /这部分看不懂|参数一下少了/.test(t))).toBe(false)
      await expect(board(page).locator('.db-col[data-slice]')).toHaveCount(7)
      await expect(board(page).locator('.db-col.fold')).toHaveCount(0)
      await expect(board(page).locator('.db-more')).toHaveCount(0)
      const c = col(page, '6.1.2 多层感知机的限制')
      const gs = c.locator('.db-askgroup')
      await expect(gs).toHaveCount(2)
      expect(await parts(gs.nth(0))).toEqual(['q', 'qa'])
      expect(await parts(gs.nth(1))).toEqual(['q', 'qa', 'sideq', 'qa'])
      // 问的那张露出 ① 引文、回到网页的来源、框的图
      const q = gs.nth(0).locator('.db-card[data-part="q"]')
      await expect(q.locator('.db-ask-quote')).toContainText('四阶权重张量')
      await expect(q.locator('a.db-ask-src')).toContainText('6.1.2 多层感知机的限制')
      await expect(q.locator('.db-ask-crop img')).toBeVisible()
      await expect(gs.nth(1).locator('.db-card[data-part="sideq"] .sq .katex').first()).toBeVisible()
      // 没有一张卡装着整节：最长的一张不到 4000 字（以前一张卡塞了约 190 行）
      const longest = Math.max(...(await board(page).locator('.db-card').evaluateAll((els) => els.map((e) => (e.textContent ?? '').length))))
      expect(longest).toBeLessThan(4000)
      if (SHOTS) {
        await page.waitForTimeout(600)
        await page.screenshot({ path: join(SHOTS, `board-after-${skin}.png`) })
        // 6.1.2 那一小列摆到画面左上（让开工具板和顶上那条）
        await c.evaluate((el) => {
          const w = el.closest('.board-wrap') as HTMLElement
          const r = el.getBoundingClientRect()
          const wr = w.getBoundingClientRect()
          w.scrollBy(r.left - wr.left - 120, r.top - wr.top - 64)
        })
        await page.waitForTimeout(400)
        await page.screenshot({ path: join(SHOTS, `board-after-${skin}-qa.png`) })
        // 高一点的窗口、往下滚到两组问答
        await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 1500))
        await gs.nth(0).evaluate((el) => {
          const w = el.closest('.board-wrap') as HTMLElement
          w.scrollBy(0, el.getBoundingClientRect().top - w.getBoundingClientRect().top - 80)
        })
        await page.waitForTimeout(500)
        await page.screenshot({ path: join(SHOTS, `board-after-${skin}-groups.png`) })
      }
      expect(read(run, NOTE)).toBe(orig)
      await toDoc(page)
      expect(read(run, NOTE)).toBe(orig)
      expect(git(run.vault, 'status', '--porcelain')).toBe('')
    } finally {
      await run.close()
    }
  })
}

/** 这一块和里面的字都整段露出：没有省略号截掉的、没有被限高（line-clamp）藏住的 */
const fullyShown = (l: Locator) =>
  l.evaluate((root) =>
    [root, ...root.querySelectorAll('*')].every((e) => {
      const st = getComputedStyle(e)
      if (st.textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth + 1) return false
      return st.overflowY === 'visible' || e.scrollHeight <= e.clientHeight + 1
    }),
  )
/** 一行字在卡里看得见：它的框在卡（限高的那块）里面，没被藏在限高下面 */
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
        const b = e.getBoundingClientRect()
        if (getComputedStyle(e).overflowY !== 'visible' && a.bottom > b.bottom + 1) return false
      }
      return true
    }
    return false
  }, text)

for (const skin of ['mint'] as const) {
  test(`问的那句、引文整段露出；长回答「展开全文」点了整段、「收起」回去；文件一字节不变（${skin}）`, async () => {
    test.setTimeout(120_000)
    const run = await launch({ [LONG_NOTE]: LONG_MD }, {}, skinned(skin))
    const { page } = run
    try {
      await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
      await toBoard(page, '长回答')
      const g = board(page).locator('.db-askgroup').first()
      expect(await parts(g)).toEqual(['q', 'qa'])
      // 问的那张：问句、① 引文、回到网页的来源整段，没有省略号、没有限高
      const q = g.locator('.db-card[data-part="q"]')
      await expect(q.locator('.row.aq')).toHaveText(LONG_Q)
      await expect(q.locator('.db-ask-quote')).toContainText('引文末尾这一句也要看得见。')
      await expect(q.locator('a.db-ask-src')).toHaveText('—— 6.1.2 多层感知机的限制 · 动手学深度学习 ↩')
      expect(await fullyShown(q)).toBe(true)
      expect(await seen(q, '问句末尾这几个字也要看得见')).toBe(true)
      expect(await seen(q, '引文末尾这一句也要看得见')).toBe(true)
      // 长回答：限高，最后一句藏着，截断处「展开全文」
      const a = g.locator('.db-card[data-part="qa"]')
      const fold = a.locator('.db-fold')
      const btn = a.locator('.db-unfold')
      await expect(btn).toHaveText('展开全文')
      expect(await seen(a, '长回答的最后一句在这里')).toBe(false)
      if (SHOTS) {
        await page.waitForTimeout(500)
        await g.evaluate((el) => {
          const w = el.closest('.board-wrap') as HTMLElement
          w.scrollBy(el.getBoundingClientRect().left - w.getBoundingClientRect().left - 140, el.getBoundingClientRect().top - w.getBoundingClientRect().top - 64)
        })
        await page.waitForTimeout(400)
        await page.screenshot({ path: join(SHOTS, `card-full-${skin}-folded.png`) })
      }
      // 点了在卡里整段展开，按钮变「收起」
      await btn.click()
      await expect(btn).toHaveText('收起')
      expect(await fullyShown(fold)).toBe(true)
      expect(await seen(a, '长回答的最后一句在这里')).toBe(true)
      if (SHOTS) {
        await page.waitForTimeout(400)
        await page.screenshot({ path: join(SHOTS, `card-full-${skin}-open.png`) })
      }
      // 再点「收起」回到限高
      await btn.click()
      await expect(btn).toHaveText('展开全文')
      expect(await seen(a, '长回答的最后一句在这里')).toBe(false)

      // 网页旧写法「你问：原话」那块：块头的问句、块里引着的原文整段，回答限高 + 展开全文
      const asked = board(page).locator('.db-card[data-face="callout"]', { hasText: '你问：' })
      await expect(asked.locator('.cl .ct .nm')).toHaveText(LONG_ASKED)
      expect(await fullyShown(asked.locator('.cl .ct .nm'))).toBe(true)
      expect(await fullyShown(asked.locator('.db-ai-lead'))).toBe(true)
      expect(await seen(asked, '被引的原文末尾这一句也要看得见')).toBe(true)
      expect(await seen(asked, '你问回答的最后一句在这里')).toBe(false)
      await asked.locator('.db-unfold').click()
      await expect(asked.locator('.db-unfold')).toHaveText('收起')
      expect(await seen(asked, '你问回答的最后一句在这里')).toBe(true)
      if (SHOTS) {
        await asked.evaluate((el) => {
          const w = el.closest('.board-wrap') as HTMLElement
          w.scrollBy(el.getBoundingClientRect().left - w.getBoundingClientRect().left - 140, el.getBoundingClientRect().top - w.getBoundingClientRect().top - 64)
        })
        await page.waitForTimeout(400)
        await page.screenshot({ path: join(SHOTS, `card-full-${skin}-asked.png`) })
      }
      // 回答短的那一问不出「展开全文」
      const short = board(page).locator('.db-askgroup', { hasText: '③短问' }).locator('.db-card[data-part="qa"]')
      await expect(short).toContainText('所以输出比输入小一圈。')
      await expect(short.locator('.db-unfold')).toHaveCount(0)

      // 展开、收起只是看法：一字节不写
      expect(read(run, LONG_NOTE)).toBe(LONG_MD)
      await toDoc(page)
      expect(read(run, LONG_NOTE)).toBe(LONG_MD)
      expect(git(run.vault, 'status', '--porcelain')).toBe('')
    } finally {
      await run.close()
    }
  })
}
