/**
 * AI 写进文档时字一点点长出来（task-6kun1，照流光原型 A2「写一段」：每 60 毫秒 2 个字，那一段左边竖线里的光往下走，
 * 下面「AI 在写这一段 · 停下 esc」；用户 0.4.8：「再续写一点评价」那一节是整段一下子出现的）：
 * - 文档里 / 菜单「AI 写一段」「AI 总结这页」：AI 的字边收边写进编辑器，中途读 DOM 看得到字在长、竖线的光在走；
 *   esc 停下留下已经显出来的那些，⌘Z 一步撤掉；写完的文件和以前一次插进去的一样。
 * - AI 对话里 AI 自己往开着的这篇里写（全能模式像 Claude Code 用命令、Edit 那样一次写进文件）：按 diff 新的那节先短后长，
 *   竖线的光在；esc 一下全显；文件字节就是 AI 写的（只是显示，不碰文件）。
 * - 用户正在那一段里打字：不做动画，直接合并；在别的段打字照样长。
 * - 减少动态：直接全显，竖线不走。
 * - 白板上 AI 加一张卡：卡里的字长出来，卡的大小、位置一点不动。
 * - 长文档一次改很多段：只前 8 处一个字一个字显，后面的直接显示；显示的时候没有超过 50 毫秒的长任务。
 * 一律无头（CN_E2E=1）、假 AI（CN_AI_FAKE=1，走真的 MCP 工具和真的文件监听）、临时库；真点、真打字、真按 esc。
 */
import { expect, test, type Locator, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { aiBlock, wrapNewBlocks } from '@cn/format'
import { editorText, launch, openNote, pane, waitSaved } from './app'

const ai = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const gitOut = (vault: string, ...args: string[]) => execFileSync('git', ['-C', vault, ...args], { encoding: 'utf8' }).trim()

async function send(page: Page, text: string) {
  const box = ai(page).getByRole('textbox', { name: '问 AI' })
  await box.fill(text)
  await box.press('Enter')
}

/** 编辑器里看得见的字（每一行的字，换行接起来；藏着没显的不在 DOM 里） */
const visible = (page: Page) =>
  pane(page)
    .locator('.cm-content')
    .evaluate((el) => Array.from(el.querySelectorAll('.cm-line'), (l) => l.textContent ?? '').join('\n'))

/** want 从头起看得见几个字（最长的那截开头在看得见的字里） */
async function shown(page: Page, want: string): Promise<number> {
  const v = await visible(page)
  let lo = 0
  let hi = want.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (v.includes(want.slice(0, mid))) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** 每 100 毫秒读一次，读到 until 成立或读满 n 次 */
async function frames(page: Page, want: string, n = 40, until?: (k: number) => boolean): Promise<number[]> {
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const k = await shown(page, want)
    out.push(k)
    if (until?.(k)) break
    await page.waitForTimeout(100)
  }
  return out
}

/**
 * 从现在起在网页里每一帧记一次 want 看得见几个字（变了才记；两个字以上才算出来了，免得撞上别处同一个字），字全显了就停。
 * 先开始记、再让 AI 写，最后 done() 等它长完、交回记下的。frames 那样从测试这边隔 100 毫秒来回读一次，机器忙时一次要几百毫秒，
 * 读到第一下时字早长完了（r22 偶发「第一帧就全显」）
 */
async function watchGrowth(page: Page, want: string): Promise<() => Promise<number[]>> {
  const key = await page.evaluate((want) => {
    const k = `cnGrow${Math.random().toString(36).slice(2)}`
    const out: number[] = []
    ;(window as unknown as Record<string, number[]>)[k] = out
    const now = () => {
      const v = Array.from(document.querySelectorAll('.pane:not([hidden]) .cm-content .cm-line'), (l) => l.textContent ?? '').join('\n')
      let lo = 0
      let hi = want.length
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2)
        if (v.includes(want.slice(0, mid))) lo = mid
        else hi = mid - 1
      }
      return lo
    }
    const tick = () => {
      const n = now()
      if (n >= 2 && out.at(-1) !== n) out.push(n)
      if (n < want.length) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    return k
  }, want)
  const read = () => page.evaluate((k) => (window as unknown as Record<string, number[]>)[k]!, key)
  return async () => {
    await expect.poll(async () => (await read()).at(-1) ?? 0, { timeout: 20_000 }).toBe(want.length)
    return read()
  }
}

/** 竖线里那道光在走（Web Animations 在跑） */
const cometRunning = (line: Locator) => line.evaluate((el) => el.getAnimations({ subtree: true }).filter((a) => a.playState === 'running' && !(a instanceof CSSTransition)).length)

const BOOK = `# 杀死一只知更鸟

> 我哥哥杰姆快满十三岁的时候，胳膊肘遭受了一次严重的骨折。

> 等过了一些年，日子长到足够让当事人回首往事时，我们有时候会谈论导致他受伤的那些过往事件。
`

/** AI 往书摘末尾续写的「评价」一节（两段，一百多字） */
const REVIEW_HEAD = '评价'
const REVIEW_P1 = '开篇很克制：从杰姆胳膊肘骨折这件小事讲起，再说过了一些年兄妹俩回头谈起它，一下子定下了整本书的视角。孩子当时的天真和成年人回忆时的距离叠在一起。'
const REVIEW_P2 = '“事情就开始了”这一句把源头指向迪尔和怪人拉德利，先抛一个悬念，让人想往下读。'
const REVIEW = `## ${REVIEW_HEAD}\n\n${REVIEW_P1}\n\n${REVIEW_P2}`
/** 看得见的那样子（「## 」藏着） */
const REVIEW_SEEN = `${REVIEW_HEAD}\n\n${REVIEW_P1}\n\n${REVIEW_P2}`

/** 和 main/ai.ts 假回答「写长一段」一样 */
const LONG_PARA = '开篇很克制：从杰姆胳膊肘骨折这件小事讲起，再说过了一些年兄妹俩回头谈起它，一下子定下了整本书的视角。孩子当时的天真和成年人回忆时的距离叠在一起。\n\n“事情就开始了”这一句把源头指向迪尔和怪人拉德利，先抛一个悬念，让人想往下读。'
const SUMMARY = '这一页记了冰岛自驾要先定的三件事：住处、租车和看极光的两晚。住处还没订，车要四驱。极光看预报再定是哪两晚。'

/** AI 写进来的整段包成 [!ai] 块（task-dtc34）：头上写哪家哪个模型；AI 对话里的还链回对话（比的时候去掉链接） */
const BY = { by: 'Claude Code · Opus 5.5' }
const noLink = (s: string) => s.replace(/ · \[回到 AI 对话\]\(canvas-notes:\/\/chat\?[^)]*\)/g, '')
/** AI 这一轮把 before 改成 after：这一轮结束软件补包以后文件的样子（去掉链接） */
const wrapped = (before: string, after: string) => wrapNewBlocks(before, after, BY).text
const disk = (vault: string, f: string) => noLink(readFileSync(join(vault, f), 'utf8'))

/** 在「第一段。」后面回车（它是最后一块：回车就到文末那一行，task-ys1rr 6.4b），打「/ai」回车，说要写什么 */
async function slashWrite(page: Page, want: string) {
  await pane(page).locator('.cm-line', { hasText: '第一段。' }).click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/ai')
  await page.keyboard.press('Enter')
  const ask = page.getByRole('textbox', { name: '让 AI 写什么' })
  await expect(ask).toBeFocused()
  await page.keyboard.type(want)
  await page.keyboard.press('Enter')
}

test('/ AI 写一段：字边收边写、一点点长出来，竖线的光往下走、下面「AI 在写这一段 · 停下 esc」；写完文件和以前一次插进去的一样', async () => {
  const run = await launch({ '书摘.md': '# 书摘\n\n第一段。\n' }, { CN_AI_FAKE: '1', CN_FAKE_SAY_MS: '40' })
  const { page, vault } = run
  try {
    await openNote(page, '书摘')
    const grown = await watchGrowth(page, LONG_PARA)
    await slashWrite(page, '写长一段')
    // 字一出来，输入框收起，字在原处一点点长：先短后长（读好几帧，一帧比一帧多，没有一下子全出来）
    const f = await grown()
    const grew = f.filter((k, i) => i > 0 && k > f[i - 1]!).length
    expect(f.some((k) => k > 0 && k < LONG_PARA.length / 2)).toBe(true)
    expect(grew).toBeGreaterThanOrEqual(5)
    for (let i = 1; i < f.length; i++) expect(f[i]!).toBeGreaterThanOrEqual(f[i - 1]!)
    expect(f.at(-1)).toBe(LONG_PARA.length)
    await expect(page.getByRole('textbox', { name: '让 AI 写什么' })).toBeHidden()
    // 写完：竖线变实线再淡掉，那一颗收起；文件就是以前一次插进去的样子
    await expect(pane(page).getByTestId('ai-spot-line')).toHaveCount(0, { timeout: 6000 })
    await expect(pane(page).getByTestId('ai-spot-bar')).toHaveCount(0)
    await waitSaved(page)
    // 包在一个「AI 写的 · 哪家 · 模型」块里（task-dtc34）
    expect(readFileSync(join(vault, '书摘.md'), 'utf8')).toBe(`# 书摘\n\n第一段。\n\n${aiBlock(LONG_PARA, BY)}\n`)
  } finally {
    await run.close()
  }
})

test('文末那一行打「/ai」，问的小框开着时那一行留着（AI 的字要写在那里，不再贴在上一段下面），什么都没写就 esc：那一行一起拿掉，文件一个字节不变', async () => {
  const doc = '# 书摘\n\n第一段。\n'
  const run = await launch({ '书摘.md': doc }, { CN_AI_FAKE: '1', CN_FAKE_SAY_MS: '40' })
  const { page, vault } = run
  try {
    await openNote(page, '书摘')
    await pane(page).locator('.cm-line', { hasText: '第一段。' }).click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('/ai')
    await page.keyboard.press('Enter')
    const ask = page.getByRole('textbox', { name: '让 AI 写什么' })
    await expect(ask).toBeFocused()
    // 小框开着：文末那一行还在（没被当成没打字拿掉）
    await expect.poll(() => editorText(page)).toBe(doc + '\n\n')
    await page.keyboard.press('Escape')
    await expect(ask).toBeHidden()
    await expect.poll(() => editorText(page)).toBe(doc)
    await page.keyboard.press('ArrowUp')
    await waitSaved(page)
    expect(readFileSync(join(vault, '书摘.md'), 'utf8')).toBe(doc)
  } finally {
    await run.close()
  }
})

test('/ AI 写一段写到一半按 esc：停在那里，已经显出来的留着、没显的不要；「停下了：写到一半的这段留着」；⌘Z 一步撤掉', async () => {
  const run = await launch({ '书摘.md': '# 书摘\n\n第一段。\n' }, { CN_AI_FAKE: '1', CN_FAKE_SAY_MS: '90' })
  const { page, vault } = run
  try {
    await openNote(page, '书摘')
    const before = await editorText(page)
    await slashWrite(page, '写长一段')
    // 正在写：竖线里光在走，下面「AI 在写这一段 · 停下 esc」
    const line = pane(page).getByTestId('ai-spot-line')
    await expect(line).toBeVisible()
    await expect.poll(() => cometRunning(line)).toBe(1)
    const inl = pane(page).getByTestId('ai-spot-bar')
    await expect(inl).toContainText('AI 在写这一段')
    await expect(inl.getByRole('button', { name: '停下 esc' })).toBeVisible()
    // 竖线挨着正在长的那一段：照原型顶比这一段第一行低 3px、底到字的最后一行（不伸到下面那一颗旁边）
    const f = await frames(page, LONG_PARA, 40, (k) => k >= 20)
    expect(f.at(-1)!).toBeGreaterThanOrEqual(20)
    const geo = await pane(page).evaluate(() => {
      const bar = document.querySelector('[data-testid="ai-spot-line"]')!.getBoundingClientRect()
      const pill = document.querySelector('[data-testid="ai-spot-bar"]')!.getBoundingClientRect()
      const t = [...document.querySelectorAll('.cm-line')].find((l) => l.textContent?.startsWith('开篇很克制'))!.getBoundingClientRect()
      return { dTop: bar.top - t.top, under: pill.top - bar.bottom, gap: t.left - bar.right }
    })
    expect(Math.abs(geo.dTop - 3)).toBeLessThan(1.5)
    expect(geo.under).toBeGreaterThanOrEqual(0)
    expect(geo.gap).toBeGreaterThan(0)
    await page.screenshot({ path: 'test-results/grow-slash-run.png' })
    await page.keyboard.press('Escape')
    await expect(inl).toContainText('停下了：写到一半的这段留着')
    await expect(inl.getByRole('button', { name: '停下 esc' })).toHaveCount(0)
    const kept = await shown(page, LONG_PARA)
    expect(kept).toBeGreaterThan(0)
    expect(kept).toBeLessThan(LONG_PARA.length)
    // 停了就不再长
    await page.waitForTimeout(600)
    expect(await shown(page, LONG_PARA)).toBe(kept)
    await waitSaved(page)
    const text = await editorText(page)
    expect(text).toContain(LONG_PARA.slice(0, kept))
    expect(text).not.toContain(LONG_PARA.slice(0, kept + 1))
    expect(readFileSync(join(vault, '书摘.md'), 'utf8')).toBe(text)
    // ⌘Z 一步撤掉 AI 写的（回到打 / 之前那一空行）
    await pane(page).locator('.cm-content').click()
    await page.keyboard.press('Meta+z')
    await expect.poll(() => editorText(page)).not.toContain(LONG_PARA.slice(0, 4))
    expect((await editorText(page)).replace(/\n+$/, '')).toBe(before.replace(/\n+$/, ''))
  } finally {
    await run.close()
  }
})

test('/ AI 写一段长到屏幕下面：跟着往下滚，正在长的那一行一直看得见', async () => {
  const filler = Array.from({ length: 40 }, (_x, i) => `前面的第 ${i + 1} 段。`).join('\n\n')
  const run = await launch({ '书摘.md': `# 书摘\n\n${filler}\n\n第一段。\n` }, { CN_AI_FAKE: '1', CN_FAKE_SAY_MS: '40' })
  const { page } = run
  try {
    await openNote(page, '书摘')
    // 把「第一段。」放到屏幕最下面一行附近再写
    await pane(page).locator('.cm-content').click()
    await page.keyboard.press('Meta+ArrowDown')
    await slashWrite(page, '写长一段')
    await expect.poll(() => shown(page, LONG_PARA), { timeout: 8000 }).toBe(LONG_PARA.length)
    // 最后一句在屏幕里
    const last = pane(page).locator('.cm-line', { hasText: '让人想往下读' })
    await expect(last).toBeInViewport()
  } finally {
    await run.close()
  }
})

test('/ AI 总结这页：三句话在开头（标题下面）一点点长出来，写完文件和以前一样', async () => {
  const note = '# 冰岛准备\n\n住处还没订。\n\n租四驱车。\n\n第一段。\n'
  const run = await launch({ '冰岛准备.md': note }, { CN_AI_FAKE: '1', CN_FAKE_SAY_MS: '40' })
  const { page, vault } = run
  try {
    await openNote(page, '冰岛准备')
    await pane(page).locator('.cm-line', { hasText: '第一段。' }).click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.type('/总结')
    const grown = await watchGrowth(page, SUMMARY)
    await page.keyboard.press('Enter')
    const f = await grown()
    expect(f.some((k) => k > 0 && k < SUMMARY.length / 2)).toBe(true)
    expect(f.filter((k, i) => i > 0 && k > f[i - 1]!).length).toBeGreaterThanOrEqual(4)
    expect(f.at(-1)).toBe(SUMMARY.length)
    await waitSaved(page)
    // 和以前一次插进去的一样：标题下面三句话、后面空一行（打 / 前回车留下的空行照旧在末尾）
    const file = readFileSync(join(vault, '冰岛准备.md'), 'utf8')
    expect(file.startsWith(`# 冰岛准备\n\n> [!ai] AI 总结 · Claude Code · Opus 5.5\n> ${SUMMARY}\n\n住处还没订。\n\n租四驱车。\n\n第一段。\n`)).toBe(true)
    expect(file).toBe(await editorText(page))
  } finally {
    await run.close()
  }
})

test('AI 对话里 AI 自己往开着的这篇末尾续写一节（像 Claude Code 用命令一次写进文件）：新的那节先短后长、竖线的光在；esc 一下全显；文件字节就是 AI 写的', async () => {
  // 写完再答 4.5 秒（CN_FAKE_TAIL_MS，同真 AI 写完还要说几句）：字长完这一轮才结束、才补包成 AI 块（task-dtc34）
  const run = await launch({ '书摘.md': BOOK }, { CN_AI_FAKE: '1', CN_FAKE_OWN_MS: '300', CN_FAKE_TAIL_MS: '4500' })
  const { page, vault } = run
  try {
    await openNote(page, '书摘')
    await page.keyboard.press('Meta+j')
    const want = `${BOOK.trimEnd()}\n\n${REVIEW}\n`
    // 第一次：不按 esc，从头长到尾；量第一段（这一轮答完补包成 AI 块以后也还是连着的一段字）
    const grown = await watchGrowth(page, REVIEW_P1)
    await send(page, `过一会儿在「书摘.md」末尾加「${REVIEW}」`)
    await expect.poll(() => editorText(page), { timeout: 15_000 }).toContain(REVIEW_P2)
    const f = await grown()
    expect(f[0]!).toBeLessThan(REVIEW_P1.length / 2)
    expect(f.filter((k, i) => i > 0 && k > f[i - 1]!).length).toBeGreaterThanOrEqual(5)
    for (let i = 1; i < f.length; i++) expect(f[i]!).toBeGreaterThanOrEqual(f[i - 1]!)
    expect(f.at(-1)).toBe(REVIEW_P1.length)
    // 文件就是 AI 写的那样（这一轮结束补包成 AI 块，task-dtc34），编辑器没有往回写别的
    await expect.poll(() => disk(vault, '书摘.md')).toBe(wrapped(BOOK, want))
    await waitSaved(page)
    expect(disk(vault, '书摘.md')).toBe(wrapped(BOOK, want))
    await expect(pane(page).getByTestId('ai-spot-line')).toHaveCount(0, { timeout: 8000 })

    // 第二次：长到一半按 esc，下一帧就全显；文件还是 AI 写的那样
    const more = '第三段：拉德利这个人一直没露面，全靠孩子们的想象。他住在街角那栋关着百叶窗的房子里，孩子们每天上学都绕着走，猜他晚上出来做什么。'
    await send(page, `过一会儿在「书摘.md」末尾加「${more}」`)
    await expect.poll(() => editorText(page), { timeout: 15_000 }).toContain(more)
    const k0 = await shown(page, more)
    expect(k0).toBeLessThan(more.length)
    // 头两个字和竖线同一帧出来
    expect(k0).toBeGreaterThanOrEqual(2)
    const line = pane(page).getByTestId('ai-spot-line')
    await expect(line).toBeVisible()
    expect(await cometRunning(line)).toBe(1)
    // 整篇四边亮、顶上「AI 正在改这篇 · 停下 esc」（2026-11-24）：那一段下面不再挂一颗「停下」
    await expect(pane(page).getByTestId('ai-acting')).toBeVisible()
    await expect(pane(page).getByTestId('ai-actbar')).toContainText('AI 正在改这篇')
    await expect(pane(page).getByTestId('ai-spot-bar')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect.poll(() => shown(page, more), { timeout: 400 }).toBe(more.length)
    const w1 = wrapped(BOOK, want)
    await expect.poll(() => disk(vault, '书摘.md')).toBe(wrapped(w1, `${w1.trimEnd()}\n\n${more}\n`))
    await waitSaved(page)
    expect(disk(vault, '书摘.md')).toBe(wrapped(w1, `${w1.trimEnd()}\n\n${more}\n`))
    expect(gitOut(vault, 'log', '--format=%s', '-1')).toMatch(/^AI：/)
  } finally {
    await run.close()
  }
})

test('AI 写完文件还在答（这一轮没做完）：整篇四边亮、顶上「AI 正在改这篇 · 停下 esc」跟着这一轮；esc 停的是这一轮，字一下全显、「停下了 · 改的留着 · +N −M」，已经写的照样提交', async () => {
  // 写完以后 AI 一直「还在答」，看完这一会儿该有的样子再放它答完（以前固定答 4 秒，机器忙时没看完这一轮就结束了）
  const gate = join(mkdtempSync(join(tmpdir(), 'cn-hold-')), '放行')
  const release = () => writeFileSync(gate, '')
  const hold = () => rmSync(gate, { force: true })
  const run = await launch({ '书摘.md': BOOK }, { CN_AI_FAKE: '1', CN_FAKE_HOLD: gate })
  const { page, vault } = run
  try {
    await openNote(page, '书摘')
    await page.keyboard.press('Meta+j')
    const want = `${BOOK.trimEnd()}\n\n${REVIEW}\n`
    // 全能模式下 AI 自己用 Write 整篇写好，接着还要答几秒（CN_FAKE_OWN_MS）
    await send(page, `自己写文件「书摘.md」「${want}」`)
    await expect.poll(() => editorText(page), { timeout: 15_000 }).toBe(want)
    expect(await shown(page, REVIEW_SEEN)).toBeLessThan(REVIEW_SEEN.length)
    const bar = pane(page).getByTestId('ai-actbar')
    await expect(bar).toContainText('AI 正在改这篇')
    await expect(pane(page).getByTestId('ai-spot-bar')).toHaveCount(0)
    // 字显完了这一轮还在答：顶上那条照样在、四边的光照样走
    // （这一轮答完补包成 AI 块以后框头插在标题和第一段之间，量最后一段）
    await expect.poll(() => shown(page, REVIEW_P2), { timeout: 6000 }).toBe(REVIEW_P2.length)
    await expect(bar.getByRole('button', { name: /停下/ })).toBeVisible()
    await expect(pane(page).getByTestId('ai-acting')).toHaveAttribute('data-phase', 'run')
    release()
    // 再写一回、长到一半按 esc：停的是这一轮（AI 那边「停下了」），字一下全显
    await expect(ai(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 15_000 })
    // 这一轮结束补包成 AI 块（task-dtc34）；第二回 AI 照现在的文件接着写
    await expect.poll(() => disk(vault, '书摘.md')).toBe(wrapped(BOOK, want))
    const cur = readFileSync(join(vault, '书摘.md'), 'utf8')
    const more = '第三段：拉德利这个人一直没露面，全靠孩子们的想象。他住在街角那栋关着百叶窗的房子里，孩子们每天上学都绕着走。'
    hold()
    await send(page, `自己写文件「书摘.md」「${cur.trimEnd()}\n\n${more}\n」`)
    await expect.poll(() => editorText(page), { timeout: 15_000 }).toContain(more)
    expect(await shown(page, more)).toBeLessThan(more.length)
    await expect(ai(page).getByRole('button', { name: '停下' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect.poll(() => shown(page, more), { timeout: 600 }).toBe(more.length)
    await expect(pane(page).getByTestId('ai-actbar')).toContainText(/停下了/)
    await expect(ai(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 15_000 })
    await expect.poll(() => disk(vault, '书摘.md')).toBe(noLink(wrapped(cur, `${cur.trimEnd()}\n\n${more}\n`)))
    await waitSaved(page)
    await expect.poll(() => gitOut(vault, 'show', 'HEAD:书摘.md')).toContain(more)
    // 停下的那一条说这次提交留下的行数，再收掉
    const [a, r] = gitOut(vault, 'show', '--numstat', '--format=', 'HEAD', '--', '书摘.md').split(/\s+/)
    await expect(pane(page).getByTestId('ai-actbar')).toContainText(`停下了 · 改的留着 · +${a} −${r}`)
    await expect(pane(page).getByTestId('ai-act')).toHaveCount(0, { timeout: 4000 })
  } finally {
    await run.close()
  }
})

test('用户正在那一段打字：AI 改到这一段不做动画、直接合并，打的字一个不少；在别的段打字，AI 新写的照样长出来', async () => {
  const note = '# 随手记\n\n第一段，我在这里打字。\n\n最后一段'
  const run = await launch({ '随手记.md': note }, { CN_AI_FAKE: '1', CN_FAKE_OWN_MS: '900', CN_FAKE_TAIL_MS: '4500' })
  const { page, vault } = run
  try {
    await openNote(page, '随手记')
    await page.keyboard.press('Meta+j')
    // 1. 光标在最后一段末尾、一直在打字：AI 接着这一段往下写，不藏、不长
    const add = 'AI 加的一段：接着最后一段往下写，这里有好几个字。'
    await send(page, `过一会儿在「随手记.md」末尾加「${add}」`)
    await pane(page).locator('.cm-line', { hasText: '最后一段' }).click()
    await page.keyboard.press('End')
    const typing = page.keyboard.type('我正在打的字', { delay: 160 })
    await expect.poll(() => editorText(page), { timeout: 15_000 }).toContain(add)
    expect(await shown(page, add)).toBe(add.length)
    await typing
    await waitSaved(page)
    const text = readFileSync(join(vault, '随手记.md'), 'utf8')
    expect(text).toContain('我正在打的字')
    expect(text).toContain(add)
    await expect(pane(page).getByTestId('ai-spot-line')).toHaveCount(0)

    // 2. 在第一段打字，AI 往末尾写：不是同一段，照样一点点长（等上一轮答完、提交好：这一轮结束还要补包 AI 块，task-dtc34）
    await expect(ai(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 15_000 })
    const add2 = '第二回 AI 加的一段：用户在别的段打字，这一段照样一个字一个字长出来。'
    const grown = await watchGrowth(page, add2)
    await send(page, `过一会儿在「随手记.md」末尾加「${add2}」`)
    await pane(page).locator('.cm-line', { hasText: '第一段' }).click()
    await page.keyboard.press('End')
    const typing2 = page.keyboard.type('第一段打的', { delay: 160 })
    await expect.poll(() => editorText(page), { timeout: 15_000 }).toContain(add2)
    const f = await grown()
    expect(f[0]!).toBeLessThan(add2.length)
    expect(f.at(-1)).toBe(add2.length)
    await typing2
    await waitSaved(page)
    expect(readFileSync(join(vault, '随手记.md'), 'utf8')).toContain('第一段，我在这里打字。第一段打的')
  } finally {
    await run.close()
  }
})

test('减少动态：AI 写进来的字直接全显，竖线不走；/ AI 写一段也一样', async () => {
  const run = await launch({ '书摘.md': BOOK.replace(/\n$/, '\n\n第一段。\n') }, { CN_AI_FAKE: '1', CN_FAKE_SAY_MS: '40' })
  const { page } = run
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openNote(page, '书摘')
    await page.keyboard.press('Meta+j')
    await send(page, `过一会儿在「书摘.md」末尾加「${REVIEW}」`)
    // 文件里这一轮结束会补包成 AI 块（task-dtc34）：看的是两段字都直接全显
    await expect.poll(() => editorText(page), { timeout: 15_000 }).toContain(REVIEW_P2)
    expect(await shown(page, REVIEW_P1)).toBe(REVIEW_P1.length)
    expect(await shown(page, REVIEW_P2)).toBe(REVIEW_P2.length)
    // 那一节左边照样一道竖线（标出 AI 写了哪），只是里面的光不走
    const line = pane(page).getByTestId('ai-spot-line').first()
    await expect(line).toBeVisible()
    expect(await cometRunning(line)).toBe(0)
    // / 菜单写的也是收到多少显多少，不再一个字一个字等
    await page.keyboard.press('Meta+j')
    await slashWrite(page, '写长一段')
    await expect.poll(() => editorText(page), { timeout: 15_000 }).toContain(aiBlock(LONG_PARA, BY).split('\n').slice(1).join('\n'))
    expect(await shown(page, LONG_PARA)).toBe(LONG_PARA.length)
  } finally {
    await run.close()
  }
})

/** 一块散着摆的白板（和 r20-ai-glow 一样） */
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
`

test('白板上 AI 加一张卡：卡里的字一点点长出来（藏着的字越来越少），卡的大小、位置一点不动', async () => {
  const run = await launch({ '冰岛准备.md': SCATTER }, { CN_AI_FAKE: '1', CN_FAKE_SAY_MS: '250' })
  const { page, vault } = run
  try {
    await page.locator('.nav .si', { hasText: '冰岛准备' }).click()
    const board = pane(page).getByTestId('doc-board')
    await expect(board).toBeVisible()
    await expect.poll(() => gitOut(vault, 'log', '--format=%s', '-1')).toMatch(/^白板改成按「##」分列/)
    await page.keyboard.press('Meta+j')
    const card = '这周时间怎么分：论文三个半小时，教材五个半小时，视频一小时。周三前读完 SAGE，周末读 C72。'
    await send(page, `加一张卡「${card}」`)
    const el = board.locator('.db-card', { hasText: card.slice(0, 10) })
    await expect(el).toBeVisible({ timeout: 15_000 })
    // 每 100 毫秒读一次：卡里还藏着几个字（CSS 高亮 cn-ai-grow 盖住的字）、卡的框
    const read = () =>
      el.evaluate((c) => {
        const hl = (CSS as unknown as { highlights?: Map<string, Set<Range>> }).highlights?.get('cn-ai-grow')
        let hidden = 0
        for (const r of hl ?? []) if (c.contains(r.startContainer)) hidden += r.toString().length
        // 卡在白板上的位置（加上白板平移了多少：AI 加的卡被挡着时白板会平移过去）和大小
        const b = c.getBoundingClientRect()
        const wrap = c.closest('.board-wrap')!
        const w = wrap.getBoundingClientRect()
        return { hidden, box: `${Math.round(b.x - w.x + wrap.scrollLeft)},${Math.round(b.y - w.y + wrap.scrollTop)},${Math.round(b.width)},${Math.round(b.height)}` }
      })
    const seen: { hidden: number; box: string }[] = []
    for (let i = 0; i < 50; i++) {
      seen.push(await read())
      if (i > 2 && seen.at(-1)!.hidden === 0) break
      await page.waitForTimeout(100)
    }
    const hid = seen.map((s) => s.hidden)
    expect(Math.max(...hid)).toBeGreaterThan(card.length / 2)
    expect(hid.filter((h, i) => i > 0 && h < hid[i - 1]!).length).toBeGreaterThanOrEqual(4)
    expect(hid.at(-1)).toBe(0)
    // 字长的时候卡不动：框从头到尾一样
    expect(new Set(seen.map((s) => s.box)).size, JSON.stringify(seen)).toBe(1)
  } finally {
    await run.close()
  }
})

/** 两列的白板：第二列在默认窗口里被右边收件箱一格挡着一截 */
const TWO_COLS = `---
type: board
---
# 本周学习计划

## 这周要补的知识

对，先看晨佩的论文。这周只补读懂论文要用的知识，大约 8 小时；PyTorch 这些等选定方向再学。

读 SAGE 时留意一组数字：随机划分准确率 91.8%，留一被试只有 80.6%。

## 这周读这些

吴恩达的课正好接得上这本《动手学深度学习》。这周只读和 C72 有关的 11 个小节，大约 5.5 小时。

这周先跳过：第 1–3 章和 4.1–4.3、4.7，吴恩达课里讲过。
`

// 以前右边有收件箱一格挡住第二列；收件箱改成弹窗（task-8isml）以后不占白板的地方，这里用窄窗口（1000 宽）加右边 AI 栏让第二列露一截
test('白板上 AI 加的卡落在看得见的白板外面（窗口窄、第二列露一截）：白板平移过去，正在长字的卡连同下面那一颗整个露出来', async () => {
  const run = await launch({ '本周学习计划.md': TWO_COLS }, { CN_AI_FAKE: '1', CN_FAKE_SAY_MS: '250' })
  const { page, app } = run
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1000, 800))
    await page.locator('.nav .si', { hasText: '本周学习计划' }).click()
    const board = pane(page).getByTestId('doc-board')
    await expect(board).toBeVisible()
    await page.keyboard.press('Meta+j')
    await expect(ai(page)).toBeVisible()
    // 第二列有一截在看得见的白板外面
    const cut = await board.evaluate((b) => {
      const w = b.querySelector('.board-wrap')!.getBoundingClientRect()
      const col = [...b.querySelectorAll('.db-col')].at(-1)!.getBoundingClientRect()
      return col.right - w.right
    })
    expect(cut).toBeGreaterThan(0)
    const card = '这周时间怎么分：论文三个半小时，教材五个半小时，视频一小时。'
    await send(page, `加一张卡「${card}」`)
    const el = board.locator('.db-card', { hasText: card.slice(0, 8) })
    await expect(el).toBeVisible({ timeout: 15_000 })
    // 平移过去：卡整个在看得见的白板里（四周留 24，下面还放得下那一颗）
    await expect
      .poll(
        () =>
          board.evaluate((b, t) => {
            const w = b.querySelector('.board-wrap')!.getBoundingClientRect()
            const c = [...b.querySelectorAll('.db-card')].find((x) => x.textContent?.includes(t))!.getBoundingClientRect()
            return c.left >= w.left && c.right <= w.right && c.bottom + 32 <= w.bottom
          }, card.slice(0, 8)),
        { timeout: 3000 },
      )
      .toBe(true)
    // 那一颗「AI 在写这张卡」左边和卡对齐
    const bar = board.getByTestId('ai-spot-bar')
    if (await bar.count()) {
      const dx = await board.evaluate((b, t) => {
        const c = [...b.querySelectorAll('.db-card')].find((x) => x.textContent?.includes(t))!.getBoundingClientRect()
        return Math.abs(b.querySelector('[data-testid="ai-spot-bar"]')!.getBoundingClientRect().left - c.left)
      }, card.slice(0, 8))
      expect(dx).toBeLessThan(2)
    }
  } finally {
    await run.close()
  }
})

test('白板上新卡片里打 / 用「AI 写一段」：卡里就地改的小编辑器照旧写完一次插进去（不出错），存进文件', async () => {
  const run = await launch({ '冰岛准备.md': SCATTER }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await page.locator('.nav .si', { hasText: '冰岛准备' }).click()
    const board = pane(page).getByTestId('doc-board')
    await expect(board).toBeVisible()
    await expect.poll(() => gitOut(vault, 'log', '--format=%s', '-1')).toMatch(/^白板改成按「##」分列/)
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e.message)))
    await board.locator('.bpal button[data-kind="card"]').click()
    const draft = board.getByTestId('db-draft')
    await expect(draft.getByRole('textbox', { name: '新卡片的字' })).toBeFocused()
    await page.keyboard.type('/ai')
    await page.keyboard.press('Enter')
    const ask = page.getByRole('textbox', { name: '让 AI 写什么' })
    await expect(ask).toBeFocused()
    await page.keyboard.type('写一句')
    await page.keyboard.press('Enter')
    await expect(ask).toBeHidden({ timeout: 10_000 })
    await expect(draft).toContainText('这是测试回答。')
    await page.keyboard.press('Meta+Enter')
    await expect(board.locator('.db-card', { hasText: '这是测试回答。' })).toBeVisible()
    await expect.poll(() => readFileSync(join(vault, '冰岛准备.md'), 'utf8'), { timeout: 10_000 }).toContain('这是测试回答。')
    expect(errors).toEqual([])
  } finally {
    await run.close()
  }
})

test('长文档一次改很多段：只前 8 处一个字一个字显、后面的直接显示；显示的时候没有超过 50 毫秒的长任务', async () => {
  // 400 段的长笔记；AI 整篇改写：前 12 段（都在屏幕上）和后面 200–230 的单数段，每段后面补一句（一共 28 处）
  const paras = Array.from({ length: 400 }, (_x, i) => `第 ${i + 1} 段：任何一种计算技术要想发挥其全部影响力，都必须得到充分的理解。`)
  const note = `# 长笔记\n\n${paras.join('\n\n')}\n`
  const run = await launch({ '长笔记.md': note }, { CN_AI_FAKE: '1' })
  const { page } = run
  const dir = mkdtempSync(join(tmpdir(), 'cn-grow-'))
  try {
    await openNote(page, '长笔记')
    await page.keyboard.press('Meta+j')
    const pick = (n: number) => n <= 12 || (n >= 200 && n <= 230 && n % 2 === 1)
    const next = note.replace(/第 (\d+) 段：任何一种计算技术要想发挥其全部影响力，都必须得到充分的理解。/g, (m, n: string) => (pick(Number(n)) ? `${m}AI 补第 ${n} 段。` : m))
    writeFileSync(join(dir, 'next.md'), next)
    // 量长任务：从发问开始
    await page.evaluate(() => {
      const w = window as unknown as { cnLong: number[] }
      w.cnLong = []
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) w.cnLong.push(Math.round(e.duration))
      }).observe({ type: 'longtask', buffered: false })
    })
    await send(page, `整篇改写「长笔记.md」照「${join(dir, 'next.md')}」`)
    await expect.poll(() => editorText(page), { timeout: 20_000 }).toBe(next)
    const at = Date.now()
    // 第 1 处一开始藏着（一个字一个字长）；第 11 处（超过 8 处）直接显示，一个字都不藏
    const first = 'AI 补第 1 段。'
    const far = 'AI 补第 11 段。'
    expect(await shown(page, first)).toBeLessThan(first.length)
    expect(await shown(page, far)).toBe(far.length)
    // 前 8 处的竖线：只画 8 条
    expect(await pane(page).getByTestId('ai-spot-line').count()).toBeLessThanOrEqual(8)
    await expect.poll(() => shown(page, first), { timeout: 6000 }).toBe(first.length)
    // 整个过程（从改进来到显完）里的长任务：改进来那一下之后不能再有超过 50 毫秒的
    await page.waitForTimeout(Math.max(0, 4500 - (Date.now() - at)))
    const long = await page.evaluate(() => (window as unknown as { cnLong: number[] }).cnLong)
    console.log(`长任务（毫秒）：${long.join('、') || '无'}`)
    expect(long.filter((d) => d > 50).length).toBeLessThanOrEqual(1)
  } finally {
    await run.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
