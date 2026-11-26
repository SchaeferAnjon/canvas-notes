/**
 * 白板区照批准的设计施工（BUILD2，task-qv2yz）：
 * - AI 动手看得见（DESIGN.v3 2.3）：白板外圈、顶上「AI 正在整理这块白板 · 停下 esc」、去拿卡片的「AI」指针、正在挪的卡外圈；
 *   esc、提示条上的「停下」都能停（当前这一步做完就停，已做的一次提交）；网页里剪的段落标「✂ 剪成卡片」，撤回后没了。
 * - 文档切到白板照 doc-to-board 方向 A 小样：书摘卡头「《书》· 章」不露 md 链接；PDF 页画缩略图、$$ 公式排好、问过 AI 的截图、
 *   数据库小表、[[白板]] 是白板卡；左边工具板、顶上「按「##」摆成列 · 挪动了才写进文件」（只说一次，能收起）、右边一格收件箱（2026-11-21 方向 A，原来右上的「收件箱 N ⌄」）。
 * - 只是切到白板看、不挪：文件一个字节不变（打开再保存文件不变）。
 * 都是真点、真拖、真按键。
 */
import { expect, type Locator, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acts, gitStatus, inboxPop, launch, openNote, pane, waitSaved, webAboveAi } from './app'
import { BOOK, DOC as DIGEST, PATH as DIGEST_PATH } from './fixtures/book-digest'
import { docBoardVault, LECTURE_NOTE, TRAVEL_NOTE } from './fixtures/doc-board'

const ai = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const gitOut = (vault: string, ...args: string[]) => execFileSync('git', ['-C', vault, ...args], { encoding: 'utf8' }).trim()
const commits = (vault: string) => Number(gitOut(vault, 'rev-list', '--count', 'HEAD'))
const docBoard = (page: Page) => pane(page).getByTestId('doc-board')
const col = (page: Page, name: string) => docBoard(page).getByRole('region', { name, exact: true })

async function send(page: Page, text: string) {
  const box = ai(page).getByRole('textbox', { name: '问 AI' })
  await box.fill(text)
  await box.press('Enter')
}

/** 一块散着摆的白板：六张卡东一张西一张，「按列排」要一张张挪 */
const SCATTER = `---
type: board
---
# 冰岛准备

<!-- card id=a x=620 y=420 w=240 -->
订四驱车

<!-- card id=b x=60 y=60 w=240 -->
看极光预报

<!-- card id=c x=900 y=90 w=240 -->
蓝冰洞要跟向导

<!-- card id=d x=340 y=700 w=240 -->
买防滑钉

<!-- card id=e x=1100 y=520 w=240 -->
换点克朗

<!-- card id=f x=380 y=260 w=240 -->
驾照翻译件
`

test('AI 在白板上排卡片看得见：外圈、顶上提示条、AI 指针去拿卡、正在挪的卡外圈；做完全收起，一次提交', async () => {
  const run = await launch({ '冰岛准备.md': SCATTER }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await page.locator('.nav .si', { hasText: '冰岛准备' }).click()
    // 2026-11-21 起白板就是这篇文档：旧写法打开时一次转好（转好那次提交之后再数）
    const board = pane(page).getByTestId('doc-board')
    await expect(board).toBeVisible()
    await expect.poll(() => gitOut(vault, 'log', '--format=%s', '-1')).toMatch(/^白板改成按「##」分列/)
    const before = commits(vault)
    await page.keyboard.press('Meta+j')
    await send(page, '在白板上加卡片「订机票」「订租车」，再把卡片按列排')
    // 1. 白板四边一道光在走（流光 A2，task-k9f5y；细节在 r20-ai-glow.spec.ts）
    const ring = board.getByTestId('ai-acting')
    await expect(ring).toBeVisible()
    await expect(ring).toHaveAttribute('data-phase', 'run')
    expect(await ring.locator('.beam').count()).toBe(4)
    // 2. 顶上居中：「AI 正在整理这块白板 · 停下 esc」，32 高，居中
    const bar = board.getByTestId('ai-actbar')
    await expect(bar).toContainText('AI 正在整理这块白板')
    await expect(bar.getByRole('button', { name: /停下/ })).toContainText('esc')
    // 居中在白板那一格上（右边一格收件箱不算：光和提示条只盖 AI 在动的白板）
    const bb = (await board.locator('.db-area').boundingBox())!
    const barBox = (await bar.boundingBox())!
    expect(barBox.height).toBeCloseTo(32, 1)
    expect(Math.abs(barBox.x + barBox.width / 2 - (bb.x + bb.width / 2))).toBeLessThan(2)
    // 3. AI 指针：出来、带「AI」小胶囊，指着刚加的卡
    const cursor = board.getByTestId('ai-cursor')
    await expect(cursor).toHaveClass(/\bon\b/)
    await expect(cursor).toContainText('AI')
    // 4. 正在拿的那张：边上跑一圈光，跟那张卡一样大；指针就在这张卡上（指针去拿下一张的路上，上一张的光还在淡出：等指针到了再看）
    await expect(board.getByTestId('ai-grab-ring').first()).toBeVisible()
    await expect
      .poll(() =>
        board.evaluate((b) => {
          const g = b.querySelector('[data-testid="ai-grab-ring"]')?.getBoundingClientRect()
          const c = b.querySelector('[data-testid="ai-cursor"]')!.getBoundingClientRect()
          return !!g && c.x >= g.x - 1 && c.x <= g.x + g.width
        }),
      )
      .toBe(true)
    const at = await board.evaluate((b) => {
      const g = b.querySelector('[data-testid="ai-grab-ring"]')?.getBoundingClientRect()
      const c = b.querySelector('[data-testid="ai-cursor"]')!.getBoundingClientRect()
      const cards = [...b.querySelectorAll('.db-card')].map((e) => e.getBoundingClientRect())
      const ring = b.querySelector('[data-testid="ai-grab-ring"]')
      return g ? { g: g.toJSON() as DOMRect, c: c.toJSON() as DOMRect, cards: cards.map((r) => r.toJSON() as DOMRect), glow: !!ring?.querySelector('.ai-glow-ring') } : null
    })
    expect(at).not.toBeNull()
    expect(at!.cards.some((c) => Math.abs(c.x - at!.g.x) < 3 && Math.abs(c.width - at!.g.width) < 3)).toBe(true)
    expect(at!.glow).toBe(true)
    await page.screenshot({ path: 'test-results/b2-ai-board.png' })
    // 排的时候一张张挪：指针先后去拿好几张不同的卡
    const seen = new Set<string>()
    for (let i = 0; i < 60 && seen.size < 3; i++) {
      const r = await board.getByTestId('ai-grab-ring').first().boundingBox().catch(() => null)
      if (r) seen.add(`${Math.round(r.x / 10)},${Math.round(r.y / 10)}`)
      await page.waitForTimeout(150)
    }
    expect(seen.size).toBeGreaterThanOrEqual(3)
    // 做完：外圈、提示条、指针都收起；一次提交
    const msg = ai(page).getByTestId('ai-msg').last()
    await expect(msg.getByTestId('ai-change')).toContainText('改了1个文件', { timeout: 30_000 })
    await expect(board.getByTestId('ai-act')).toHaveCount(0)
    expect(commits(vault)).toBe(before + 1)
    const md = readFileSync(join(vault, '冰岛准备.md'), 'utf8')
    expect(md).toContain('订机票')
    expect(md).toContain('订租车')
  } finally {
    await run.close()
  }
})

test('AI 排卡片时按 esc 停下：手上这一步做完就停，已经做了的一次提交，提示条说停下了', async () => {
  const run = await launch({ '冰岛准备.md': SCATTER }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await page.locator('.nav .si', { hasText: '冰岛准备' }).click()
    const board = pane(page).getByTestId('doc-board')
    await expect(board).toBeVisible()
    await expect.poll(() => gitOut(vault, 'log', '--format=%s', '-1')).toMatch(/^白板改成按「##」分列/)
    const before = commits(vault)
    await page.keyboard.press('Meta+j')
    await send(page, '在白板上加卡片「订机票」「订租车」「看极光」，再把卡片按列排')
    // 第一张加上、指针去拿它的时候按 esc（焦点还在 AI 输入框里：esc 是停下，不是关浮窗）
    await expect(board.getByTestId('ai-cursor')).toHaveClass(/\bon\b/)
    await page.keyboard.press('Escape')
    const msg = ai(page).getByTestId('ai-msg').last()
    await expect(msg).toContainText('停下了', { timeout: 20_000 })
    await expect(board.getByTestId('ai-act')).toHaveCount(0)
    await expect(ai(page)).toBeVisible()
    // 只加了第一张，没排
    const md = readFileSync(join(vault, '冰岛准备.md'), 'utf8')
    expect(md).toContain('订机票')
    expect(md).not.toContain('订租车')
    // 没排：散着的卡还在原处（旧坐标换到新白板上是 + (4, 64)）
    expect(md).toContain('<!-- card id=a x=624 y=484 -->')
    expect(commits(vault)).toBe(before + 1)
    await expect(msg.getByTestId('ai-change')).toContainText('改了1个文件')
  } finally {
    await run.close()
  }
})

test('文档切成的白板上 AI 动手也看得见：加卡时只亮那张卡（顶上那条说明让位），点那张卡下面的「停下 esc」停', async () => {
  const doc = '# 冰岛\n\n## 出发前\n\n还没订完的：\n\n- [ ] 租车\n\n## 路线\n\n第一天：黄金圈。\n'
  const run = await launch({ '冰岛.md': doc }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await openNote(page, '冰岛')
    await acts(page).getByRole('tab', { name: '白板' }).click()
    await expect(docBoard(page)).toBeVisible()
    await expect(docBoard(page).locator('.db-hint')).toBeVisible()
    await page.keyboard.press('Meta+j')
    await send(page, '在白板上加卡片「订机票」「订租车」「看极光」，再排整齐')
    // 先加卡：只亮刚加的那张（流光 A2：只加一张卡时整块不亮），指针去拿它；顶上那条「按「##」摆成列」让位
    const spot = docBoard(page).getByTestId('ai-spot-bar')
    await expect(spot).toContainText('AI 在写这张卡')
    await expect(docBoard(page).getByTestId('ai-spot-ring')).toBeVisible()
    await expect(docBoard(page).getByTestId('ai-cursor')).toHaveClass(/\bon\b/)
    await expect(docBoard(page).locator('.db-hint')).toBeHidden()
    await page.screenshot({ path: 'test-results/b2-ai-docboard.png' })
    await spot.getByRole('button', { name: '停下 esc' }).click()
    const msg = ai(page).getByTestId('ai-msg').last()
    await expect(msg).toContainText('停下了', { timeout: 20_000 })
    await expect(docBoard(page).getByTestId('ai-act')).toHaveCount(0)
    await waitSaved(page)
    const md = readFileSync(join(vault, '冰岛.md'), 'utf8')
    expect(md).toContain('订机票')
    // AI 加的卡进了列、文件里没有位置行：顶上不说「离开了自己那一节」，也没有「摆回原样」（说明只说一次、6 秒收起，task-wn3x5）
    expect(md).not.toContain('<!-- card')
    await expect(docBoard(page).locator('.db-hint', { hasText: '离开了自己那一节' })).toHaveCount(0)
    await expect(docBoard(page).getByRole('button', { name: '摆回原样' })).toHaveCount(0)
    expect(md).not.toContain('看极光')
  } finally {
    await run.close()
  }
})

let server: Server
let base: string
test.beforeAll(async () => {
  server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end(
      '<title>Ice caves in Iceland</title><body style="font:16px Georgia;margin:24px"><h1>Ice caves in Iceland</h1>' +
        '<p>Ice caves form inside glaciers every winter and change shape from year to year.</p>' +
        '<p>Only enter ice caves with a certified glacier guide. Entrances move and are impossible to find on your own.</p>' +
        '<p>Caves are only safe from November to March. Warm days and rain can make the roof collapse.</p>' +
        '<p>Wear crampons and a helmet. Your guide will provide them; check before you book.</p></body>',
    )
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
test.afterAll(() => server.close())

const guest = (page: Page, code: string) =>
  page.evaluate((c) => {
    const w = document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> } | null
    return w ? w.executeJavaScript(c).catch(() => null) : null
  }, code)

test('AI 在网页里剪段落：指针去拿、那段亮一下，剪完段尾「✂ 剪成卡片」、左边一道竖线；撤回后标记没了', async () => {
  const run = await launch({ '随笔.md': '# 随笔\n\n第一段。\n' }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await page.locator('.nav .si', { hasText: '随笔' }).click()
    await page.keyboard.press('Meta+j')
    await send(page, `打开 ${base}/ice 看看`)
    await expect(ai(page).getByTestId('ai-msg').last().locator('.txt')).toContainText('网页标题是「Ice caves in Iceland」', { timeout: 30_000 })
    // 上一轮做完（停下键变回发送键）才发下一句，不然这一句发不出去
    await expect(ai(page).getByRole('button', { name: '发送' })).toBeVisible()
    // 工作区方向 A（task-9okg5）：AI 开的网页在 AI 后面；要看 AI 在网页里动手，把网页拖到上半（真拖）
    await webAboveAi(page)
    const before = commits(vault)
    await send(page, '把网页里「certified glacier guide」「crampons and a helmet」这两段剪进收件箱')
    // 网页外圈和提示条
    const web = page.getByRole('complementary', { name: '网页' })
    await expect(web.getByTestId('ai-acting')).toBeVisible()
    await expect(web.getByTestId('ai-actbar')).toContainText('AI 正在操作这个网页')
    // 网页里的「AI」指针出来、正在选的那段亮一下
    await expect.poll(() => guest(page, `!!document.querySelector('#cn-ai-cursor.on')`)).toBe(true)
    await expect.poll(() => guest(page, `document.querySelector('[data-cn-ai-hit]')?.innerText.slice(0, 20) ?? ''`), { intervals: [50] }).not.toBe('')
    await page.screenshot({ path: 'test-results/b2-ai-web.png' })
    const msg = ai(page).getByTestId('ai-msg').last()
    await expect(msg.getByTestId('ai-change')).toContainText('改了2个文件', { timeout: 30_000 })
    // 两段都标上了，标的就是那两段；左边一道竖线（::before）
    const tags = await guest(page, `[...document.querySelectorAll('.cn-ai-cliptag')].map((t) => [t.textContent, t.parentElement.innerText.slice(0, 40)])`)
    expect(tags).toEqual([
      ['剪成卡片', 'Only enter ice caves with a certified gl'],
      ['剪成卡片', 'Wear crampons and a helmet. Your guide w'],
    ])
    const bar = await guest(page, `getComputedStyle(document.querySelector('[data-cn-ai-clip]'), '::before').width`)
    expect(bar).toBe('3px')
    // 做完：指针收起，外圈没了
    await expect(web.getByTestId('ai-act')).toHaveCount(0)
    expect(await guest(page, `!!document.querySelector('#cn-ai-cursor.on')`)).toBe(false)
    expect(commits(vault)).toBe(before + 1)
    const clipped = gitOut(vault, 'show', '--name-only', '--format=', 'HEAD').split('\n')
    expect(clipped).toHaveLength(2)
    expect(readFileSync(join(vault, clipped[0]!), 'utf8')).toContain('Only enter ice caves with a certified glacier guide.')
    // 撤回：两篇没了，网页里的标记也没了
    await msg.getByRole('button', { name: '撤回' }).click()
    await expect(msg.getByTestId('ai-change')).toContainText('已撤回')
    await expect.poll(() => guest(page, `document.querySelectorAll('.cn-ai-cliptag').length`)).toBe(0)
    expect(await guest(page, `document.querySelectorAll('[data-cn-ai-clip]').length`)).toBe(0)
    for (const p of clipped) expect(existsSync(join(vault, p))).toBe(false)
  } finally {
    await run.close()
  }
})

test('文档切到白板不露原文：书摘卡头《书》· 章、PDF 页缩略图、公式排好、问过 AI 的截图、数据库小表、[[白板]] 是白板卡；只看文件一个字节不变', async () => {
  const run = await launch(docBoardVault())
  const { page, vault } = run
  const read = (p: string) => readFileSync(join(vault, p), 'utf8')
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    // ---------- 旅行稿 ----------
    await openNote(page, '冰岛十天环岛')
    await acts(page).getByRole('tab', { name: '白板' }).click()
    await expect(docBoard(page)).toBeVisible()
    const all = docBoard(page).locator('.db-cols')
    for (const raw of ['[《', '](weread', 'weread://', '```', 'file.inFolder', '[[', '![[', '<!--', '—— [']) await expect(all).not.toContainText(raw, { useInnerText: true })
    // 书摘：卡头「《在冰岛开车》· 第二章 天气」，评价单独一栏；另一种写法（—— [《书》 · 章](阅读页)）同样，带「回原文」
    const books = col(page, '出发前').locator('.db-card.fc-clip .src')
    await expect(books.nth(0)).toHaveText('《在冰岛开车》· 第二章 天气')
    // 书摘提示块里的「我的评价：」：和文档里一样是标签小块（冒号不画），挂在引文下面
    const rev = col(page, '出发前').locator('.db-card.fc-clip .md-attached.hooked')
    await expect(rev.locator('.md-review-tag')).toHaveText('我的评价')
    await expect(rev).toHaveText('我的评价所以每天只排一个主景点，剩下的时间留给天气。')
    await expect(books.nth(1)).toHaveText('safetravel.is')
    await expect(books.nth(2)).toContainText('《在冰岛开车》· 第五章 冰洞')
    await expect(books.nth(2).getByRole('button', { name: '回原文' })).toBeVisible()
    // [[冰岛自驾]]：白板卡（颜色方块、名字、几张卡片）
    const boardCard = col(page, '住哪').locator('.db-card[data-face="board"]')
    await expect(boardCard).toContainText('冰岛自驾')
    await expect(boardCard).toContainText('白板 · 2张卡片 · 双击打开')
    expect(await boardCard.locator('.sq').evaluate((e) => getComputedStyle(e).backgroundColor)).toBe('rgb(74, 127, 167)')
    // 数据库（2026-11-21 方向 A4 小样）：卡头「住宿 · 表格 … 8条」，不画表头的小表露 4 条（名字、状态小色块），虚线下「还有4条 … 展开」；
    // 展开：原地长成整张表（文档里那张数据库表），Esc 收起
    const base = col(page, '住哪').locator('.db-card[data-face="base"]')
    await expect(base.locator('.kh')).toContainText('住宿 · 表格')
    await expect(base.locator('.kh .r')).toHaveText('8条')
    await expect(base.locator('thead')).toHaveCount(0)
    await expect(base.locator('tbody tr')).toHaveCount(4)
    await expect(base.locator('tbody tr').first()).toContainText('雷克雅未克订了')
    await expect(base.locator('.db-tag').first()).toHaveText('订了')
    await expect(base.locator('.dbfoot')).toContainText('还有4条')
    await base.getByTestId('db-expand').click()
    const big = docBoard(page).locator('.dbx')
    await expect(big.locator('tbody tr')).toHaveCount(8)
    await expect(big).toContainText('每一条是「写作/冰岛十天环岛/住宿/」里的一篇笔记')
    await page.keyboard.press('Escape')
    await expect(big).toHaveCount(0)
    // 整页剪藏：封面、标题、来源，不露链接
    const clip = col(page, '路线').locator('.db-card[data-face="clipnote"]')
    await expect(clip).toContainText('去冰岛之前要知道的十件事')
    await expect(clip.locator('.src')).toContainText('zhuanlan.zhihu.com')
    await expect(clip.locator('.cv')).toHaveCount(1)
    // 图集、视频
    await expect(col(page, '路线').locator('.db-gal .cell')).toHaveCount(4)
    await expect(col(page, '路线').locator('.db-gal .plus')).toHaveText('+2')
    await page.screenshot({ path: 'test-results/b2-docboard-travel.png' })

    // ---------- 课程笔记 ----------
    await openNote(page, 'Lecture05 笔记')
    await acts(page).getByRole('tab', { name: '白板' }).click()
    await expect(docBoard(page)).toBeVisible()
    for (const raw of ['$$', '\\frac', '![[', '](../../', '<details', '[[Lecture05']) await expect(docBoard(page).locator('.db-cols')).not.toContainText(raw, { useInnerText: true })
    // PDF 那一页：卡头「Lecture05 · 第3页」，缩略图画出来了
    const pdf = col(page, '这一讲讲什么').locator('.db-card[data-face="pdf"]')
    await expect(pdf.locator('.kh')).toHaveText('Lecture05 · 第3页')
    await expect.poll(() => pdf.locator('.db-slide img').evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth), { timeout: 15_000 }).toBeGreaterThan(200)
    // 公式：KaTeX 排好的两条
    const math = col(page, '用代码验证').locator('.db-card[data-face="math"]')
    await expect(math.locator('.kh')).toHaveText('公式')
    await expect(math.locator('.katex')).toHaveCount(2)
    await expect(math.locator('.katex .mfrac')).toHaveCount(1)
    // 问过 AI（一处一列，以前的格式整节一张）：框下来的截图画出来；没有截图的第 12 页画那一页
    await expect(docBoard(page).locator('.db-col[data-ask="1"] h3 .truncate')).toHaveText(['第3页 · 计算栈为什么分成九层', '第5页 · 矩阵乘法在 GPU 上为什么快', '第12页 · 搬一次数据比算一次还费电？'])
    const asks = docBoard(page).locator('.db-col[data-ask="1"] .db-card[data-face="ask"]')
    await expect(asks).toHaveCount(3)
    await expect(asks.nth(0).locator('.kh')).toContainText('第3页')
    await expect(asks.nth(0).locator('.tt')).toHaveText('计算栈为什么分成九层')
    await expect(asks.nth(0).locator('.foot')).toHaveText('完整对话 · 2轮 · 没讲通1版')
    await expect.poll(() => asks.nth(0).locator('.thumb img').evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBe(320)
    await expect.poll(() => asks.nth(2).locator('.thumb img').evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth), { timeout: 15_000 }).toBeGreaterThan(100)
    // 代码卡头：语言 … 14行；HTML 链接卡；嵌入的笔记
    await expect(col(page, '用代码验证').locator('.db-card[data-face="code"] .kh')).toContainText('python14行')
    // 配对笔记（「Lecture05 笔记.md」）所有列完整显示、一行往右排：问过 AI 一处一列以后这一节是第 7 列，也不收成列头
    await expect(col(page, '我还没懂的')).not.toHaveClass(/\bfold\b/)
    const html = col(page, '我还没懂的').locator('.db-card[data-face="link"]')
    await expect(html).toContainText('加速器为何又快又省 · 拖动看车间')
    await expect(html).toContainText('Lecture05 可视化 · HTML · 双击打开')
    await expect(col(page, '我还没懂的').locator('.db-card[data-face="note"] .kh')).toContainText('嵌入的笔记课程 / ecp')
    await page.screenshot({ path: 'test-results/b2-docboard-lecture.png' })
    // 双击问过 AI 看全文：要点、没讲通那一版都在；关掉不写
    await asks.nth(0).dblclick()
    const full = page.getByRole('dialog', { name: '全文' })
    await expect(full.locator('.db-full-hd')).toContainText('问过 AI· 在文档「第 3 页 · 计算栈为什么分成九层」里')
    await expect(full).toContainText('指令集 = 软件看得到的约定')
    await full.getByRole('button', { name: '关掉' }).click()
    // 折叠块点开（只在白板上展开）
    await col(page, '我还没懂的').locator('.det').click()
    await expect(col(page, '我还没懂的').locator('.det-b')).toContainText('推到拐点')

    // ---------- 只看不挪：两篇一个字节都没变，库里没有改动 ----------
    await page.waitForTimeout(1500)
    expect(read('课程/ecp/Lecture05 笔记.md')).toBe(LECTURE_NOTE)
    expect(read('写作/冰岛十天环岛.md')).toBe(TRAVEL_NOTE)
    expect(gitStatus(vault)).toBe('')
    // 切回文档再关掉标签：还是一个字节不变
    await acts(page).getByRole('tab', { name: '文档' }).click()
    await page.keyboard.press('Meta+w')
    await page.waitForTimeout(800)
    expect(read('课程/ecp/Lecture05 笔记.md')).toBe(LECTURE_NOTE)
    expect(gitStatus(vault)).toBe('')
    // 双击白板卡：开那块白板
    await page.locator('.tab', { hasText: '冰岛十天环岛' }).first().click()
    await col(page, '住哪').locator('.db-card[data-face="board"]').dblclick()
    await expect(page.getByTestId('tab-on')).toHaveText('冰岛自驾')
  } finally {
    await run.close()
  }
})

test('文档切成的白板：工具板七样、顶上那条说明、右边一格收件箱；卡片拖到空白处就地写、拖待办进一列、收件箱拖进一列、加一列并改名、摆回原样', async () => {
  const run = await launch(docBoardVault())
  const { page, vault } = run
  const file = () => readFileSync(join(vault, '写作/冰岛十天环岛.md'), 'utf8')
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openNote(page, '冰岛十天环岛')
    await acts(page).getByRole('tab', { name: '白板' }).click()
    await expect(docBoard(page)).toBeVisible()
    // 工具板：卡片、待办、列、数据库、子白板｜拍导图、费曼学习（2026-11-21 方向 A 加了数据库；task-yvabi 加了费曼学习）
    const pal = docBoard(page).locator('.bpal button')
    await expect(pal).toHaveText(['卡片', '待办', '列', '数据库', '子白板', '装饰', '拍导图', '费曼学习'])
    // 顶上居中：第一次打开说一次「按「##」摆成列 · 挪动了才写进文件」，右边 ×；没东西可摆时没有「摆回原样」（task-wn3x5）
    const hint = docBoard(page).locator('.db-hint')
    await expect(hint).toHaveText('按「##」摆成列 · 挪动了才写进文件')
    await expect(hint.getByRole('button', { name: '摆回原样' })).toHaveCount(0)
    await expect(hint.getByRole('button', { name: '收起这条说明' })).toBeVisible()
    await expect(hint.locator('b')).toHaveText('挪动了才写进文件')
    const hb = (await hint.boundingBox())!
    // 进场动画（落下 6px 淡入，带着 transform）还在走时量出来是 32.0000076 这种浮点尾数：差在百分之一像素以内就是 32
    expect(hb.height).toBeCloseTo(32, 2)
    // 收件箱：白板右上角「收件箱 1」，弹窗默认收着（task-8isml）
    const inbox = pane(page).getByTestId('db-inbox')
    await expect(inbox).toHaveText('收件箱1')
    await expect(docBoard(page).getByRole('dialog', { name: '收件箱' })).toHaveCount(0)
    expect(file()).toBe(TRAVEL_NOTE)

    // 「卡片」拖到空白处：那里出一张空卡就地写，⌘↵ 放好；文档末尾多这一段和一行位置，顶上那条跟着变；卡底不写在哪一节
    const cardBtn = (await pal.filter({ hasText: '卡片' }).boundingBox())!
    // 画布上一处空白（不在列、卡、顶上那条、工具板上）：从下往上、从左往右找
    const spot = await docBoard(page).locator('.board-wrap').evaluate((w) => {
      const r = w.getBoundingClientRect()
      for (let y = r.bottom - 40; y > r.top + 120; y -= 24)
        for (let x = r.left + 120; x < r.right - 40; x += 24) {
          const el = document.elementFromPoint(x, y)
          if (el && w.contains(el) && !el.closest('.db-col, .db-card, .db-top, .bpal, .dbx')) return { x, y }
        }
      return null
    })
    expect(spot).not.toBeNull()
    await page.mouse.move(cardBtn.x + cardBtn.width / 2, cardBtn.y + cardBtn.height / 2)
    await page.mouse.down()
    await page.mouse.move(cardBtn.x + 80, cardBtn.y + 30, { steps: 4 })
    await page.mouse.move(spot!.x, spot!.y, { steps: 12 })
    await page.mouse.up()
    const draft = docBoard(page).getByTestId('db-draft')
    await expect(draft.getByRole('textbox', { name: '新卡片的字' })).toBeFocused()
    await page.keyboard.type('记得带转换插头')
    await page.keyboard.press('Meta+Enter')
    await expect(docBoard(page).locator('.db-card.placed')).toContainText('记得带转换插头')
    await waitSaved(page)
    expect(file()).toMatch(/\n<!-- card id=d1 x=\d+ y=\d+ -->\n记得带转换插头\n$/)
    expect(file().replace(/\n<!-- card id=d1 x=\d+ y=\d+ -->\n记得带转换插头\n$/, '')).toBe(TRAVEL_NOTE.replace(/\n$/, '') + '\n')
    await expect(hint).toContainText('1张卡离开了自己那一节 · 文件里多了1行位置')
    await expect(docBoard(page).locator('.db-card.placed .from')).toHaveCount(0)
    // 空着收起：什么都不写
    await pal.filter({ hasText: '卡片' }).click()
    await expect(draft).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(draft).toHaveCount(0)

    // 待办拖进「住哪」：那一节末尾出一张空待办就地写
    const from = (await pal.filter({ hasText: '待办' }).boundingBox())!
    const target = (await col(page, '住哪').boundingBox())!
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(from.x + 60, from.y + 20, { steps: 4 })
    await page.mouse.move(target.x + 80, target.y + target.height - 10, { steps: 12 })
    await expect(col(page, '住哪').locator('.db-drop')).toHaveCount(1)
    await page.mouse.up()
    await expect(col(page, '住哪').getByTestId('db-draft')).toBeVisible()
    await page.keyboard.type('订维克那晚的房')
    await page.keyboard.press('Meta+Enter')
    await expect(col(page, '住哪')).toContainText('订维克那晚的房')
    await waitSaved(page)
    expect(file()).toContain('维克那晚要是封路，就退掉，改住塞里雅兰瀑布附近。\n\n- [ ] 订维克那晚的房\n\n## 路线')

    // 收件箱拖进「出发前」第一张前面：短的一条插进那一节，收件箱那篇进废纸篓
    const drawer = await inboxPop(page)
    const mini = drawer.getByRole('listitem').first()
    await expect(mini).toContainText('到了先在机场换一点克朗')
    const m = (await mini.boundingBox())!
    const first = (await col(page, '出发前').locator('.db-card').first().boundingBox())!
    await page.mouse.move(m.x + 30, m.y + 10)
    await page.mouse.down()
    await page.mouse.move(m.x - 40, m.y + 40, { steps: 4 })
    await page.mouse.move(first.x + 80, first.y + 8, { steps: 12 })
    await expect(col(page, '出发前').locator('.db-drop')).toHaveCount(1)
    await page.mouse.up()
    await expect(col(page, '出发前')).toContainText('到了先在机场换一点克朗')
    await expect.poll(() => existsSync(join(vault, '收件箱/记得换钱.md'))).toBe(false)
    await waitSaved(page)
    // 那篇开头的「# 记得换钱」是名字，不进文档（不然多一个一级标题）
    expect(file()).toContain('## 出发前\n\n到了先在机场换一点克朗，停车场多数只收卡。\n\n还没订完的：')
    expect(file()).not.toContain('# 记得换钱')
    await expect(drawer.locator('.dbr-empty')).toContainText('收件箱是空的')

    // 列：点一下文档末尾新起一节「新的列」，马上改名
    await pal.filter({ hasText: /^列$/ }).click()
    const name = docBoard(page).getByRole('textbox', { name: '列名' })
    await expect(name).toHaveValue('新的列')
    await name.fill('装备')
    await name.press('Enter')
    await expect(col(page, '装备')).toBeVisible()
    await waitSaved(page)
    expect(file()).toContain('\n\n## 装备\n')
    // 双击列名改名：只改标题那行
    await col(page, '预算').locator('h3').dblclick()
    await docBoard(page).getByRole('textbox', { name: '列名' }).fill('花销')
    await docBoard(page).getByRole('textbox', { name: '列名' }).press('Enter')
    await expect(col(page, '花销')).toBeVisible()
    await waitSaved(page)
    expect(file()).toContain('## 花销\n\n| 项目 | 欧元 |')

    // 摆回原样：位置行去掉
    await hint.getByRole('button', { name: '摆回原样' }).click()
    await expect(docBoard(page).locator('.db-card.placed')).toHaveCount(0)
    await waitSaved(page)
    expect(file()).not.toContain('<!-- card')
    await page.screenshot({ path: 'test-results/b2-docboard-chrome.png' })
  } finally {
    await run.close()
  }
})

test('文档切成的白板：工具板「子白板」建一块白板、在新标签改名，正中那一列多一张白板卡；「拍导图」拖进一列，做好后那一节多一张指向导图的卡', async () => {
  const doc = '# 复习\n\n## 第三讲\n\n线性映射的定义。\n\n## 第四讲\n\n特征值。\n'
  const env = { CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '300', CN_AIRDROP_DIR: mkdtempSync(join(tmpdir(), 'cn-airdrop-')) }
  const run = await launch({ '课程/线性代数/复习.md': doc, '课程/线性代数/第3讲 线性映射.md': '# 第3讲 线性映射\n' }, env)
  const { page, vault } = run
  const file = () => readFileSync(join(vault, '课程/线性代数/复习.md'), 'utf8')
  try {
    await openNote(page, '复习')
    await acts(page).getByRole('tab', { name: '白板' }).click()
    await expect(docBoard(page)).toBeVisible()
    const pal = docBoard(page).locator('.bpal button')
    // 子白板：点一下，新白板在新标签里改名；回到这篇，屏幕正中那一列多一张指向它的卡（2026-11-21：点工具板放进正中那一列）
    await pal.filter({ hasText: '子白板' }).click()
    // 新白板的标签进入改名（输入框里是「未命名白板…」）；esc 不改名
    await expect(page.getByTestId('tab-on').locator('input.tab-rename')).toHaveValue(/^未命名白板/)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('tab-on')).toHaveText(/^未命名白板/)
    await page.locator('.tab', { hasText: '复习' }).first().click()
    const card = docBoard(page).locator('.db-col .db-card[data-face="board"]')
    await expect(card).toContainText('未命名白板')
    await expect(card).toContainText('白板 · 0张卡片 · 双击打开')
    await waitSaved(page)
    expect(file()).toMatch(/\n\n\[\[未命名白板\]\]\n/)
    expect(file()).not.toContain('<!-- card')

    // 拍导图：拖进「第三讲」，拍好、核对、做成白板导图；回到这篇，那一节多一张指向导图的卡
    const b = (await pal.filter({ hasText: '拍导图' }).boundingBox())!
    const col3 = (await col(page, '第三讲').boundingBox())!
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + 80, b.y + 20, { steps: 4 })
    await page.mouse.move(col3.x + 80, col3.y + col3.height - 8, { steps: 10 })
    await page.mouse.up()
    const sheet = page.getByRole('dialog', { name: /拍一张导图|核对认出来的/ })
    await expect(sheet).toHaveAccessibleName('拍一张导图')
    const b64 = readFileSync(join(__dirname, 'fixtures/handwritten-map.jpg')).toString('base64')
    await sheet.evaluate((el, b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      const dt = new DataTransfer()
      dt.items.add(new File([bytes], '导图.jpg', { type: 'image/jpeg' }))
      for (const t of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }))
    }, b64)
    await sheet.getByRole('button', { name: '用这张' }).click()
    await sheet.getByRole('button', { name: '做成白板导图' }).click({ timeout: 20_000 })
    // 2026-11-22 task-wuv05：导图是这块白板的子白板，和它同一个文件夹，留在这块白板上；那一列多一张导图卡
    await expect(page.getByTestId('tab-on')).toHaveText('复习')
    const dir = join(vault, '课程/线性代数')
    await expect.poll(() => readdirSync(dir).filter((f) => f.startsWith('导图 '))).toHaveLength(1)
    const title = readdirSync(dir).find((f) => f.startsWith('导图 '))!.replace(/\.md$/, '')
    await expect.poll(file, { timeout: 10_000 }).toContain(`线性映射的定义。\n\n[[${title}]]\n\n## 第四讲`)
    await expect(col(page, '第三讲').locator('.mm-card-row')).toContainText(`${title}导图 · 15个主题`)
  } finally {
    await run.close()
  }
})

/** 普通白板上两张书摘卡：剪下来带出处的（挂着想法和评价），只有引文和评价的 */
const READING_BOARD = `---
type: board
---
# 读书

<!-- card id=k1 x=60 y=60 w=300 -->
> 接到叔叔谋反的消息，朱瞻基立刻下令御驾亲征，大军行动神速。
—— [《趣说明朝276年》 · 3 作死小能手朱高煦](https://weread.qq.com/web/reader/394323d0813ab8286g)

微信读书的想法：御驾亲征这一下，比朝堂上吵三个月都管用。

我的评价：先动手的人说了算。

<!-- card id=k2 x=420 y=60 w=280 -->
> 莫名其妙地吃了个狗啃泥，再好脾气的人也得发飙。

我的评价：皇帝可以输道理，不能输面子。
`

/** 小标签的样子和位置 */
const tagLook = (l: Locator) =>
  l.evaluate((e) => {
    const c = getComputedStyle(e)
    const r = e.getBoundingClientRect()
    return { bg: c.backgroundColor, color: c.color, weight: c.fontWeight, radius: parseFloat(c.borderTopLeftRadius), h: Math.round(r.height), x: r.x }
  })

/** 文档切成的白板上一张书摘卡：挂着的第一段的弯钩（::before）的样子，它和引文竖线（.q 的左边框）、引文的字的位置 */
const hookOf = (card: Locator) =>
  card.evaluate((c) => {
    const e = c.querySelector('.md-attached')!
    const b = getComputedStyle(e, '::before')
    const r = e.getBoundingClientRect()
    const q = c.querySelector('.q')!.getBoundingClientRect()
    return {
      border: b.borderLeftWidth,
      bottomBorder: b.borderBottomWidth,
      radius: b.borderBottomLeftRadius,
      // 弯钩左边和引文竖线左边差多少、上端伸进引文多少
      dx: Math.round(r.x + parseFloat(b.left) - q.x),
      into: Math.round(q.bottom - (r.y + parseFloat(b.top))),
      textX: c.querySelector('.q .md-p')!.getBoundingClientRect().x,
    }
  })

test('书摘里挂在引文下面的「微信读书的想法」「我的评价」：文档切成的白板、普通白板的卡上都和文档里一个样子（标签同底色、同字色、同字重，小一号；从引文竖线拐下来的弯钩）；只看不改字', async () => {
  // 普通白板这一半看的是以前的自由白板（导图、撤回了转写法的白板还用它）：这块记在旧写法名单里，打开不转（2026-11-21）
  const run = await launch({ [DIGEST_PATH]: DIGEST, '白板/读书.md': READING_BOARD, '.canvas-notes/白板旧写法.json': JSON.stringify({ 版本: 1, 白板: ['白板/读书.md'] }) })
  const { page, vault } = run
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openNote(page, '读书')
    await openNote(page, BOOK)
    // 文档里（书摘那边做的 review.css）：小标签 22 高、圆角 6
    const docMe = pane(page).locator('.cm-review-tag:not(.wr)').first()
    const docWr = pane(page).locator('.cm-review-tag.wr').first()
    await expect(docWr).toHaveText('微信读书的想法')
    await expect(docMe).toHaveText('我的评价')
    const dMe = await tagLook(docMe)
    const dWr = await tagLook(docWr)
    expect([dMe.h, dMe.radius, dMe.weight]).toEqual([22, 6, '500'])

    // ---------- 文档切成的白板 ----------
    await acts(page).getByRole('tab', { name: '白板' }).click()
    const cards = col(page, '3 作死小能手朱高煦，千古难找第二个').locator('.db-card')
    // 引文挂着想法 / 引文 / 引文挂着评价 / 自己写的一段（不在引文下面，不算评价）
    await expect(cards).toHaveCount(4)
    const first = cards.nth(0)
    await expect(first.locator('.md-review-tag')).toHaveText(['微信读书的想法'])
    await expect(first.locator('.md-attached')).toHaveText('微信读书的想法御驾亲征这一下，比朝堂上吵三个月都管用。')
    await expect(first.locator('.q')).not.toContainText('想法')
    await expect(cards.nth(1).locator('.md-review-tag')).toHaveCount(0)
    await expect(cards.nth(2).locator('.md-review-tag')).toHaveText(['我的评价'])
    await expect(cards.nth(3)).toContainText('我自己的想法：这一家子打架都这么接地气')
    await expect(cards.nth(3).locator('.md-review-tag')).toHaveCount(0)
    // 标签和文档里同底色、同字色、同字重；卡片里小一号（18 高、圆角 5）
    const bMe = await tagLook(cards.nth(2).locator('.md-review-tag'))
    const bWr = await tagLook(first.locator('.md-review-tag'))
    expect([bMe.bg, bMe.color, bMe.weight]).toEqual([dMe.bg, dMe.color, dMe.weight])
    expect([bWr.bg, bWr.color, bWr.weight]).toEqual([dWr.bg, dWr.color, dWr.weight])
    expect([bMe.h, bMe.radius, bWr.h]).toEqual([18, 5, 18])
    // 弯钩：2px、圆角 7，左边贴着引文竖线，上端伸进引文 5；标签和引文的字左边对齐
    const h1 = await hookOf(first)
    expect([h1.border, h1.bottomBorder, h1.radius, h1.dx, h1.into]).toEqual(['2px', '2px', '7px', 0, 5])
    expect(bWr.x).toBeCloseTo(h1.textX, 0)

    // ---------- 普通白板：剪下来带出处的书摘卡、只有引文和评价的卡 ----------
    // openNote 把白板切到了文档看法：回到那个标签再切回白板
    await page.locator('.tab').filter({ has: page.locator('.truncate', { hasText: /^读书$/ }) }).click()
    await acts(page).getByRole('tab', { name: '白板' }).click()
    const board = pane(page).getByTestId('board')
    const clip = board.locator('.bcard.k-clip')
    await expect(clip.locator('.md-review-tag')).toHaveText(['微信读书的想法', '我的评价'])
    await expect(clip.locator('.q')).not.toContainText('我的评价')
    await expect(clip.locator('.src')).toContainText('weread.qq.com')
    const cMe = await tagLook(clip.locator('.md-review-tag:not(.wr)'))
    const cWr = await tagLook(clip.locator('.md-review-tag.wr'))
    expect([cMe.bg, cMe.color, cMe.h, cWr.bg, cWr.color]).toEqual([dMe.bg, dMe.color, 18, dWr.bg, dWr.color])
    // 剪藏卡的竖线是 .q 的 ::before（左 14）：弯钩贴着它，标签和引文的字对齐（左 26）
    const qBar = await clip.locator('.q').evaluate((e) => {
      const r = e.getBoundingClientRect()
      const b = getComputedStyle(e, '::before')
      return { x: r.x + parseFloat(b.left), bottom: r.y + r.height - parseFloat(b.bottom), textX: r.x + parseFloat(getComputedStyle(e).paddingLeft) }
    })
    const item = clip.locator('.md-attached').first()
    const at = await item.evaluate((e) => {
      const r = e.getBoundingClientRect()
      const b = getComputedStyle(e, '::before')
      return { x: r.x + parseFloat(b.left), top: r.y + parseFloat(b.top), border: b.borderLeftWidth }
    })
    expect(at.border).toBe('2px')
    expect(at.x).toBeCloseTo(qBar.x, 0)
    expect(at.top).toBeLessThan(qBar.bottom)
    expect(cWr.x).toBeCloseTo(qBar.textX, 0)
    // 只有引文和评价（没有出处）的卡：照普通 md 画，评价也挂在引文下面
    const note = board.locator('.bcard', { hasText: '狗啃泥' })
    await expect(note.locator('.md-quote')).toHaveCount(1)
    await expect(note.locator('.md-attached.hooked .md-review-tag')).toHaveText('我的评价')
    await expect(note.locator('.md-attached')).toHaveText('我的评价皇帝可以输道理，不能输面子。')

    // 只是看：书摘、白板一个字节没变
    await page.waitForTimeout(1200)
    expect(readFileSync(join(vault, DIGEST_PATH), 'utf8')).toBe(DIGEST)
    expect(readFileSync(join(vault, '白板/读书.md'), 'utf8')).toBe(READING_BOARD)
    expect(gitStatus(vault)).toBe('')
  } finally {
    await run.close()
  }
})
