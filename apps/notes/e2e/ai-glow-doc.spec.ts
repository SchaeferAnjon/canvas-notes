/**
 * AI 改文档时文档栏也亮四边（2026-11-24 用户：「AI 操作文档的时候 我希望也有一个类似于白板那样的边儿」）：
 * 全能模式下 AI 跑命令直接写盘（不走软件的文档工具），改到正开着的那篇：
 * - 那一格四边一道光绕圈、顶上「AI 正在改这篇 · 停下 esc」，改的那一段竖线、字长出来照旧；
 * - 做完收成「✓ 改好了 · +N −M · 撤回」（和这次提交的加减行数一样），再淡掉；
 * - 分屏两格各自：另一格开着的别的篇不亮，用户同时在那一格打字也不亮；
 * - 改一篇没开着的：哪一格都不亮，esc 也不被当成「停下」接走。
 * 一律无头（CN_E2E=1）、假 AI（CN_AI_FAKE=1，「跑命令写文件」照 Claude Code 用 Bash 跑 python 那样直接写盘），真打字、真按键。
 */
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, tabOn } from './app'

const SHOTS = '/private/tmp/canvas-notes-visual/111-AI改文档亮边'
const MEET = '# 11.24 组会准备\n\n## 上周做了什么\n\n读完了残差网络那篇。\n'
const ADD = '## 这周要讲的\n\n一、残差连接为什么能训得深：梯度有一条不经过非线性的捷径。\n\n二、和 C72 的对比：同一批数据，层数翻倍以后准确率还在涨。'
const files = { '11.24 组会准备.md': MEET, '周报.md': '# 周报\n\n这周写了组会的稿子。\n', '另一篇.md': '# 另一篇\n\n没开着的一篇。\n' }

const ai = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const slot = (page: Page, p: 0 | 1) => page.locator(`main.center > .cslot[data-pane="${p}"]:not([hidden])`)
const gitOut = (vault: string, ...args: string[]) => execFileSync('git', ['-C', vault, ...args], { encoding: 'utf8' }).trim()

async function open(page: Page, name: string) {
  await page.keyboard.press('Meta+o')
  await page.keyboard.type(name)
  await page.waitForTimeout(150)
  await page.keyboard.press('Enter')
  await expect(tabOn(page)).toHaveText(name)
}

async function send(page: Page, text: string) {
  const box = ai(page).getByRole('textbox', { name: '问 AI' })
  await box.fill(text)
  await box.press('Enter')
}

test('全能模式跑命令写进开着的那篇：那一格四边亮、顶上「AI 正在改这篇 · 停下 esc」，另一格不亮（用户在那里打字也不亮）；做完「改好了 · +N −0 · 撤回」再收掉；改没开着的那篇哪儿都不亮', async () => {
  const gate = join(mkdtempSync(join(tmpdir(), 'cn-hold-')), '放行')
  const run = await launch(files, { CN_AI_FAKE: '1', CN_FAKE_HOLD: gate })
  const { page, vault } = run
  try {
    mkdirSync(SHOTS, { recursive: true })
    // 左格《周报》，右格《11.24 组会准备》（⌃\ 分屏，右格 ⌘O 换篇）
    await open(page, '周报')
    await page.keyboard.press('Control+Backslash')
    await expect(page.getByTestId('tab-on-other')).toHaveText('周报')
    await open(page, '11.24 组会准备')
    await expect(slot(page, 1).locator('.cm-content')).toContainText('读完了残差网络那篇')
    await page.keyboard.press('Meta+j')

    // AI 跑命令把新的一节写进《11.24 组会准备》末尾，写完还在答（放行开关关着）
    rmSync(gate, { force: true })
    await send(page, `跑命令写文件「11.24 组会准备.md」「${MEET.trimEnd()}\n\n${ADD}\n」`)
    const meet = slot(page, 1)
    const week = slot(page, 0)
    await expect(meet.getByTestId('ai-acting')).toBeVisible({ timeout: 15_000 })
    const bar = meet.getByTestId('ai-actbar')
    await expect(bar).toContainText('AI 正在改这篇')
    await expect(bar.getByRole('button', { name: /停下/ })).toBeVisible()
    await expect(meet.getByTestId('ai-acting')).toHaveAttribute('data-phase', 'run')
    // 光真的在走：四条边里光的位置隔一会儿不一样
    const beamAt = () => meet.getByTestId('ai-acting').evaluate((el) => [...el.querySelectorAll('.beam')].map((b) => getComputedStyle(b).transform).join('|'))
    const b0 = await beamAt()
    await page.waitForTimeout(400)
    expect(await beamAt()).not.toBe(b0)
    // 四边常亮的那层底：强调色 24%（2026-11-25 按推荐小改，以前 16%）
    const baseAlpha = await meet.getByTestId('ai-acting').evaluate((el) => {
      const c = getComputedStyle(el.querySelector('.base')!).backgroundColor
      const m = /\/\s*([\d.]+)\)|rgba\([^)]*,\s*([\d.]+)\)/.exec(c)
      return Number(m?.[1] ?? m?.[2])
    })
    expect(baseAlpha).toBeCloseTo(0.24, 2)
    // 改的那一段：竖线照旧在（局部动画照留），那一段下面不再挂第二颗「停下」
    await expect(meet.getByTestId('ai-spot-line').first()).toBeVisible()
    await expect(meet.getByTestId('ai-spot-bar')).toHaveCount(0)
    // 另一格（《周报》）不亮；用户这时在《周报》里打字，它也不亮
    await expect(week.getByTestId('ai-act')).toHaveCount(0)
    await week.locator('.cm-content').click()
    await page.keyboard.press('Meta+ArrowDown')
    await page.keyboard.type('用户同时打的一句。')
    await expect.poll(() => readFileSync(join(vault, '周报.md'), 'utf8'), { timeout: 10_000 }).toContain('用户同时打的一句。')
    await page.waitForTimeout(300)
    await expect(week.getByTestId('ai-act')).toHaveCount(0)
    await expect(meet.getByTestId('ai-acting')).toBeVisible()
    // 顶上那条不压标题：在标题那一行的行框上面（以前离格顶 12 时压进行框 4，离字顶只剩 3）
    const gap = await meet.evaluate((el) => el.querySelector('.cm-line')!.getBoundingClientRect().top - el.querySelector('[data-testid="ai-actbar"]')!.getBoundingClientRect().bottom)
    expect(gap).toBeGreaterThanOrEqual(0)
    await page.screenshot({ path: join(SHOTS, '1-改的时候.png') })

    // 放行：这一轮答完、提交；顶上收成「✓ 改好了 · +N −0 · 撤回」，N 和这次提交一样
    writeFileSync(gate, '')
    await expect(bar).toContainText(/改好了 · \+\d+ −0/, { timeout: 20_000 })
    await expect(bar.getByRole('button', { name: '撤回' })).toBeVisible()
    // 结束补包成 AI 块那一下不当 AI 又写了一回：已经显出来的字不再藏起来重长，「改好了」时字都在
    await expect(meet.locator('.cm-content')).toContainText('层数翻倍以后准确率还在涨', { timeout: 500 })
    await expect(meet.locator('.cm-callout-ai')).not.toHaveCount(0)
    // 数字照改动卡上色：加的绿，是 0 的那一半淡
    await expect(bar.locator('.n.add')).not.toHaveClass(/zero/)
    await expect(bar.locator('.n.del')).toHaveClass(/zero/)
    await page.screenshot({ path: join(SHOTS, '2-改好了.png') })
    const [added, removed] = gitOut(vault, 'show', '--numstat', '--format=', 'HEAD', '--', '11.24 组会准备.md').split(/\s+/)
    expect(gitOut(vault, 'log', '-1', '--format=%s')).toMatch(/^AI：/)
    await expect(bar).toContainText(`改好了 · +${added} −${removed}`)
    expect(Number(added)).toBeGreaterThanOrEqual(5)
    // 用户在《周报》打的字不进 AI 的提交
    expect(gitOut(vault, 'show', '--name-only', '--format=', 'HEAD')).not.toContain('周报.md')
    // 再淡掉
    await expect(meet.getByTestId('ai-act')).toHaveCount(0, { timeout: 5000 })
    await expect(week.getByTestId('ai-act')).toHaveCount(0)
    // 那一段的竖线也跟着收掉
    await expect(meet.getByTestId('ai-spot-line')).toHaveCount(0, { timeout: 3000 })
    // 收完：AI 写的那一节（这一轮结束包成 AI 块）字都显出来
    await expect(meet.locator('.cm-content')).toContainText('层数翻倍以后准确率还在涨', { timeout: 6000 })
    await page.screenshot({ path: join(SHOTS, '3-收完.png') })

    // 改一篇没开着的（《另一篇》）：哪一格都不亮；这时按 esc 不当「停下」（AI 照样答完）
    rmSync(gate, { force: true })
    await send(page, '跑命令写文件「另一篇.md」「# 另一篇\n\n没开着的一篇。\n\nAI 加的一句。\n」')
    await expect.poll(() => readFileSync(join(vault, '另一篇.md'), 'utf8'), { timeout: 15_000 }).toContain('AI 加的一句。')
    await page.waitForTimeout(500)
    await expect(page.getByTestId('ai-act')).toHaveCount(0)
    // 光标放回《周报》里再按 esc（AI 输入框里的 esc 是收起右栏）
    await week.locator('.cm-content').click()
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    writeFileSync(gate, '')
    await expect(ai(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 15_000 })
    // 没被停下：照样答完（「写好了」），不是「停下了」
    await expect(ai(page).getByTestId('ai-msg').last()).toContainText('写好了 另一篇.md')
    await expect(ai(page).getByTestId('ai-msg').last()).not.toContainText('停下了')
    await expect(page.getByTestId('ai-act')).toHaveCount(0)
  } finally {
    await run.close()
  }
})
