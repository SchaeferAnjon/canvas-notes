/**
 * AI 动手时的流光（task-k9f5y，2026-11-21 用户选方向 A 后的 A2：慢一点、一道光、边缘柔化、颜色淡；DESIGN.v3 2.3）：
 * - 整块白板整理：四边一道光在走（读光的 transform 前后不一样）、顶上提示条边上同一道光；改到哪张卡那张边上跑一圈；
 *   做完变「整理好了 · 挪了N张卡 · 撤回」，约 1.8 秒后收起；点「撤回」撤的就是这一轮（AI 消息里跟着「已撤回」）。
 * - 点「停下」（esc 一样，b2-board 里按 esc）：光停住变灰，「停下了：这一步做完就停」→「停下了 · 做完的N步留着」，再收掉。
 * - 只加一张卡：整块不亮，只那张卡边上一圈光、卡下面「AI 在写这张卡 · 停下 esc」；做完停成一圈淡掉。
 * - 文档里只写一段：这一段左边竖线里光往下走、下面「AI 在写这一段 · 停下 esc」；整篇改写：整块亮、改到的段落竖线亮、「改好了 · 改了N段」。
 * - AI 对话：答的时候输入框边上一道光，答完停成一圈淡掉。
 * - 减少动态：光不走（没有动画），只有不动的一圈。
 * 都是真发消息（CN_AI_FAKE 走的是真的 MCP 工具）、真按 esc、真点按钮。
 */
import { expect, test, type Locator, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, openNote, pane, waitSaved } from './app'

const ai = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const gitOut = (vault: string, ...args: string[]) => execFileSync('git', ['-C', vault, ...args], { encoding: 'utf8' }).trim()
const docBoard = (page: Page) => pane(page).getByTestId('doc-board')

async function send(page: Page, text: string) {
  const box = ai(page).getByRole('textbox', { name: '问 AI' })
  await box.fill(text)
  await box.press('Enter')
}

/** 一块散着摆的白板（旧写法，打开时转成「##」写法，位置留着）：六张卡东一张西一张，「按列排」要一张张挪 */
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

/** 四条边里光的位置（transform），和光那一层的动画在不在跑 */
const beams = (scope: Locator) =>
  scope.evaluate((el) => {
    const edge = el.querySelector('[data-testid="ai-acting"]')
    if (!edge) return null
    const b = [...edge.querySelectorAll('.beam')]
    return { t: b.map((x) => getComputedStyle(x).transform).join('|'), running: b.flatMap((x) => x.getAnimations()).filter((a) => a.playState === 'running').length }
  })

async function openBoard(page: Page, vault: string) {
  await page.locator('.nav .si', { hasText: '冰岛准备' }).click()
  await expect(docBoard(page)).toBeVisible()
  await expect.poll(() => gitOut(vault, 'log', '--format=%s', '-1')).toMatch(/^白板改成按「##」分列/)
  await page.keyboard.press('Meta+j')
}

test('整块白板：一道光沿四边在走、改到的卡边上跑一圈；做完「整理好了 · 挪了N张卡 · 撤回」约 1.8 秒后收起', async () => {
  const run = await launch({ '冰岛准备.md': SCATTER }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await openBoard(page, vault)
    const board = docBoard(page)
    const before = readFileSync(join(vault, '冰岛准备.md'), 'utf8')
    await send(page, '整理当前白板')
    // 1. 四边的光：出来、在走（隔 400 毫秒读两次位置不一样），一道光四条边各一截（不是两道）
    const edge = board.getByTestId('ai-acting')
    await expect(edge).toBeVisible()
    await expect(edge).toHaveAttribute('data-phase', 'run')
    expect(await edge.locator('.beam').count()).toBe(4)
    const a = await beams(board)
    await page.waitForTimeout(400)
    const b = await beams(board)
    expect(a!.running).toBe(4)
    expect(b!.t).not.toBe(a!.t)
    // 一圈 7 秒：四条边的动画都是 7000 毫秒一圈
    const durs = await edge.evaluate((el) => [...el.querySelectorAll('.beam')].flatMap((b) => b.getAnimations()).map((x) => x.effect!.getTiming().duration))
    expect(durs).toEqual([7000, 7000, 7000, 7000])
    // 2. 顶上那条：字照原型，边上同一道光
    const bar = board.getByTestId('ai-actbar')
    await expect(bar).toContainText('AI 正在整理这块白板')
    // 在页面里记下「整理好了」出来、提示条收起（加上 hide）各是什么时候：不受 Playwright 轮询、截图慢不慢的影响
    await bar.evaluate((el) => {
      const w = window as unknown as { cnFin?: number; cnHide?: number }
      const mo = new MutationObserver(() => {
        if (!w.cnFin && el.textContent?.includes('整理好了')) w.cnFin = performance.now()
        if (w.cnFin && el.classList.contains('hide')) {
          w.cnHide = performance.now()
          mo.disconnect()
        }
      })
      mo.observe(el, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true, characterData: true })
    })
    await expect(bar.getByRole('button', { name: /停下/ })).toContainText('esc')
    await expect(bar.getByTestId('ai-bar-glow')).toHaveAttribute('data-mode', 'loop')
    // 3. 改到哪张卡：那张边上跑一圈光，和卡一样大
    const grab = board.getByTestId('ai-grab-ring').first()
    await expect(grab).toBeVisible()
    const at = await board.evaluate((b) => {
      const g = b.querySelector('[data-testid="ai-grab-ring"]')!.getBoundingClientRect()
      const cards = [...b.querySelectorAll('.db-card')].map((e) => e.getBoundingClientRect())
      return cards.some((c) => Math.abs(c.x - g.x) < 3 && Math.abs(c.width - g.width) < 3)
    })
    expect(at).toBe(true)
    await page.screenshot({ path: 'test-results/glow-board-run.png' })
    // 4. 做完：「整理好了 · 挪了6张卡 · 撤回」，约 1.8 秒后收起，整层没了
    await expect(bar).toContainText(/整理好了 · 挪了\d张卡/, { timeout: 30_000 })
    await expect(bar.getByRole('button', { name: '撤回' })).toBeVisible()
    await expect(edge).toHaveAttribute('data-phase', 'gone')
    await page.screenshot({ path: 'test-results/glow-board-done.png' })
    const hidAfter = await page.evaluate(
      () =>
        new Promise<number>((done) => {
          const w = window as unknown as { cnFin?: number; cnHide?: number }
          const t = setInterval(() => w.cnHide && w.cnFin && (clearInterval(t), done(w.cnHide - w.cnFin)), 20)
          setTimeout(() => (clearInterval(t), done(-1)), 4000)
        }),
    )
    expect(hidAfter).toBeGreaterThan(1500)
    expect(hidAfter).toBeLessThan(2600)
    await expect(board.getByTestId('ai-act')).toHaveCount(0)
    expect(readFileSync(join(vault, '冰岛准备.md'), 'utf8')).not.toBe(before)

  } finally {
    await run.close()
  }
})

test('点提示条上的「停下」：光停在原地变灰，「停下了：这一步做完就停」→「停下了 · 做完的N步留着」，再收掉', async () => {
  const run = await launch({ '冰岛准备.md': SCATTER }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await openBoard(page, vault)
    const board = docBoard(page)
    await send(page, '整理当前白板')
    await expect(board.getByTestId('ai-grab-ring').first()).toBeVisible()
    const edge = board.getByTestId('ai-acting')
    const bar = board.getByTestId('ai-actbar')
    await bar.getByRole('button', { name: /停下/ }).click()
    // 光停住（动画暂停、位置不变）、变灰；按钮收起
    await expect(edge).toHaveClass(/\bhalt\b/)
    await expect(bar).toContainText('停下了：这一步做完就停')
    const a = await beams(board)
    await page.waitForTimeout(300)
    const b = await beams(board)
    if (a && b) {
      expect(b.t).toBe(a.t)
      expect(b.running).toBe(0)
    }
    await expect(bar.getByRole('button', { name: /停下/ })).toHaveCount(0)
    await page.screenshot({ path: 'test-results/glow-board-stop.png' })
    await expect(bar).toContainText(/停下了 · 做完的\d步留着/, { timeout: 20_000 })
    await expect(board.getByTestId('ai-act')).toHaveCount(0, { timeout: 4000 })
  } finally {
    await run.close()
  }
})

test('只加一张卡：整块不亮，只那张卡边上一圈光，卡下面「AI 在写这张卡 · 停下 esc」；做完停成一圈淡掉', async () => {
  const run = await launch({ '冰岛准备.md': SCATTER }, { CN_AI_FAKE: '1', CN_FAKE_SAY_MS: '250' })
  const { page, vault } = run
  try {
    await openBoard(page, vault)
    const board = docBoard(page)
    await send(page, '加一张卡「这周时间怎么分」')
    const spot = board.getByTestId('ai-spot-ring')
    await expect(spot).toBeVisible()
    await expect(spot.locator('.ai-glow-ring')).toHaveAttribute('data-mode', 'loop')
    // 圈的就是新加的那张卡（卡被挡着时白板会平移过去，task-6kun1：等平移停了再量）
    await expect
      .poll(() =>
        board.evaluate((b) => {
          const g = b.querySelector('[data-testid="ai-spot-ring"]')?.getBoundingClientRect()
          const card = [...b.querySelectorAll('.db-card')].find((c) => c.textContent?.includes('这周时间怎么分'))?.getBoundingClientRect()
          return !!g && !!card && Math.abs(card.x - g.x) < 3 && Math.abs(card.y - g.y) < 3 && Math.abs(card.width - g.width) < 3
        }),
      )
      .toBe(true)
    const inl = board.getByTestId('ai-spot-bar')
    await expect(inl).toContainText('AI 在写这张卡')
    await expect(inl.getByRole('button', { name: '停下 esc' })).toBeVisible()
    // 整块不亮、顶上没有那条
    await expect(board.getByTestId('ai-acting')).toHaveCount(0)
    await expect(board.getByTestId('ai-actbar')).toHaveCount(0)
    await page.screenshot({ path: 'test-results/glow-card.png' })
    await expect(spot.locator('.ai-glow-ring')).toHaveAttribute('data-mode', /settle|fade/, { timeout: 20_000 })
    await expect(board.getByTestId('ai-act')).toHaveCount(0, { timeout: 4000 })
  } finally {
    await run.close()
  }
})

test('文档里只写一段只亮这一段；整篇改写整块亮、改到的段落竖线亮，「改好了 · 改了N段」', async () => {
  const note = '# 学习笔记\n\n第一段：这周的目标是读懂论文。\n\n第二段：残差网络的核心是捷径。\n\n第三段：下周再看注意力。\n'
  const run = await launch({ '学习笔记.md': note }, { CN_AI_FAKE: '1', CN_FAKE_SAY_MS: '250' })
  const { page, vault } = run
  try {
    await openNote(page, '学习笔记')
    const doc = pane(page)
    await doc.locator('.cm-line', { hasText: '第二段' }).click()
    await page.keyboard.press('End')
    await page.keyboard.press('Meta+j')
    await send(page, '插入「为什么先读 SAGE：它和 C72 用的是同一批数据。」')
    // 只这一段：左边竖线里光往下走，下面「AI 在写这一段 · 停下 esc」；整篇不亮
    const line = doc.getByTestId('ai-spot-line')
    await expect(line).toBeVisible()
    await expect.poll(() => line.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(1)
    const inl = doc.getByTestId('ai-spot-bar')
    await expect(inl).toContainText('AI 在写这一段')
    await expect(inl.getByRole('button', { name: '停下 esc' })).toBeVisible()
    await expect(doc.getByTestId('ai-acting')).toHaveCount(0)
    // 竖线挨着插进来的那一段（同一行高处）；字一点点长出来（task-6kun1），等这一段显出全文再量
    await expect(doc.locator('.cm-line', { hasText: '为什么先读 SAGE' })).toBeVisible()
    // 插进来的那一段包成 AI 块（task-dtc34）：竖线从块的头一行起
    const pos = await doc.evaluate((p) => {
      const l = p.querySelector('[data-testid="ai-spot-line"]')!.getBoundingClientRect()
      const t = [...p.querySelectorAll('.cm-line.cm-callout-ai.cm-callout-head')].at(-1)!.getBoundingClientRect()
      return { dy: Math.abs(l.top - t.top), left: t.left - l.left }
    })
    expect(pos.dy).toBeLessThan(4)
    expect(pos.left).toBeGreaterThan(0)
    await page.screenshot({ path: 'test-results/glow-para.png' })
    // 做完：竖线变实线再淡掉，那一颗收起
    await expect(line).toHaveClass(/\bsolid\b/, { timeout: 20_000 })
    await expect(doc.getByTestId('ai-spot-line')).toHaveCount(0, { timeout: 4000 })
    await expect(doc.getByTestId('ai-spot-bar')).toHaveCount(0)
    await waitSaved(page)

    // 整篇改写：整块亮、顶上「AI 正在改这篇」，改到的段落竖线亮；做完「改好了 · 改了2段」
    const dir = mkdtempSync(join(tmpdir(), 'cn-glow-'))
    const cur = readFileSync(join(vault, '学习笔记.md'), 'utf8')
    const next = cur.replace('第一段：这周的目标是读懂论文。', '第一段：这周只读懂论文。').replace('第三段：下周再看注意力。', '第三段：注意力放到下周。')
    writeFileSync(join(dir, 'new.md'), next)
    await send(page, `整篇改写「学习笔记.md」照「${join(dir, 'new.md')}」`)
    await expect(doc.getByTestId('ai-acting')).toBeVisible()
    await expect(doc.getByTestId('ai-actbar')).toContainText('AI 正在改这篇')
    await expect(doc.getByTestId('ai-spot-line').first()).toBeVisible()
    await page.screenshot({ path: 'test-results/glow-doc.png' })
    await expect(doc.getByTestId('ai-actbar')).toContainText('改好了 · 改了2段', { timeout: 20_000 })
    await expect(doc.getByTestId('ai-act')).toHaveCount(0, { timeout: 4000 })
  } finally {
    await run.close()
  }
})

test('AI 对话：答的时候输入框边上一道光绕着走，答完停成一圈再淡掉', async () => {
  const run = await launch({ '学习笔记.md': '# 学习笔记\n\n正文。\n' }, { CN_AI_FAKE: '1', CN_FAKE_SAY_MS: '200' })
  const { page } = run
  try {
    await openNote(page, '学习笔记')
    await page.keyboard.press('Meta+j')
    await send(page, '残差网络为什么能训练得更深？')
    const glow = ai(page).getByTestId('ai-input-glow')
    await expect(glow).toHaveAttribute('data-mode', 'loop')
    const spin = () => glow.evaluate((el) => getComputedStyle(el.querySelector('.rot')!).transform)
    const s1 = await spin()
    await page.waitForTimeout(300)
    expect(await spin()).not.toBe(s1)
    await page.screenshot({ path: 'test-results/glow-chat.png' })
    await expect(glow).toHaveAttribute('data-mode', /settle|fade/, { timeout: 20_000 })
    await expect(ai(page).getByTestId('ai-input-glow')).toHaveCount(0, { timeout: 3000 })
  } finally {
    await run.close()
  }
})

test('减少动态：光不走、不绕，只有不动的一圈；提示条照样有、照样收起', async () => {
  const run = await launch({ '冰岛准备.md': SCATTER }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openBoard(page, vault)
    const board = docBoard(page)
    const before = readFileSync(join(vault, '冰岛准备.md'), 'utf8')
    await send(page, '整理当前白板')
    const edge = board.getByTestId('ai-acting')
    await expect(edge).toBeVisible()
    await expect(board.getByTestId('ai-grab-ring').first()).toBeVisible()
    // 光那一层、顶上那条、改到的卡上：一个动画都没有；光那一截藏着，四边一圈不动的柔光
    const n = await board.evaluate((b) => {
      const sel = ['[data-testid="ai-acting"]', '[data-testid="ai-actbar"]', '[data-testid="ai-grab-ring"]']
      return sel.flatMap((s) => [...b.querySelectorAll(s)]).reduce((k, el) => k + el.getAnimations({ subtree: true }).filter((a) => !(a instanceof CSSTransition)).length, 0)
    })
    expect(n).toBe(0)
    expect(await edge.locator('.beam').first().evaluate((el) => getComputedStyle(el).display)).toBe('none')
    await expect(board.getByTestId('ai-bar-glow')).toHaveCount(0)
    await page.screenshot({ path: 'test-results/glow-still.png' })
    // 做完点提示条上的「撤回」：文件回到整理之前，AI 消息里那一轮跟着「已撤回」（撤的是同一次，不会撤两次）
    const bar = board.getByTestId('ai-actbar')
    await expect(bar).toContainText(/整理好了 · 挪了\d张卡/, { timeout: 30_000 })
    await bar.getByRole('button', { name: '撤回' }).click()
    await expect(bar).toContainText('撤回了')
    await expect(ai(page).getByTestId('ai-msg').last().getByTestId('ai-change')).toContainText('已撤回')
    await expect.poll(() => readFileSync(join(vault, '冰岛准备.md'), 'utf8')).toBe(before)
    await expect(board.getByTestId('ai-act')).toHaveCount(0, { timeout: 4000 })
  } finally {
    await run.close()
  }
})
