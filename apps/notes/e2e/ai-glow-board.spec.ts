/**
 * 文档以白板看法开着时被 AI 用命令行改了，白板那一格也亮（AI改文档亮边那条只做了文档栏，功能小三件 1）：
 * - 四边一道光绕圈、顶上「AI 正在改这块白板 · 停下 esc」，AI 写进来的那一节在白板上长成新的一列；
 * - 做完收成「✓ 改好了 · +N −0 · 撤回」（和这次提交的加减行数一样），再淡掉；
 * - 白板看法里按 esc 是「停下」：光停住变灰，「停下了 · 改的留着 · +N −0」，AI 不再往下答；
 * - 白板文件（type: board）被命令行改了也一样亮。
 * 一律无头（CN_E2E=1）、假 AI（CN_AI_FAKE=1，「跑命令写文件」照 Claude Code 用 Bash 跑 python 那样直接写盘），真点、真按键。
 */
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acts, launch, pane, tabOn } from './app'

const SHOTS = '/private/tmp/canvas-notes-visual/117-功能小三件'
const MEET = '# 11.24 组会准备\n\n## 上周做了什么\n\n读完了残差网络那篇。\n\n## 要问导师的\n\n数据集要不要换。\n'
const ADD = '## 这周要讲的\n\n残差连接为什么能训得深：梯度有一条不经过非线性的捷径。\n\n和 C72 的对比：层数翻倍以后准确率还在涨。'
const BOARD = '---\ntype: board\n---\n\n# 课题看板\n\n## 在做\n\n整理实验记录。\n'
const files = { '11.24 组会准备.md': MEET, '课题看板.md': BOARD }

const ai = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const board = (page: Page) => pane(page).locator('[data-testid="doc-board"]')
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

test('文档以白板看法开着、AI 跑命令改了它：白板四边亮、顶上「AI 正在改这块白板 · 停下 esc」，新的一列长出来；做完「改好了 · +N −0 · 撤回」再收掉；esc 停下；白板文件一样亮', async () => {
  const gate = join(mkdtempSync(join(tmpdir(), 'cn-hold-')), '放行')
  const run = await launch(files, { CN_AI_FAKE: '1', CN_FAKE_HOLD: gate })
  const { page, vault } = run
  try {
    mkdirSync(SHOTS, { recursive: true })
    await open(page, '11.24 组会准备')
    // 标签条上点「白板」：这篇切成白板看法（按 ## 摆成列）
    await acts(page).getByRole('tab', { name: '白板' }).click()
    await expect(board(page)).toBeVisible()
    await expect(board(page)).toContainText('读完了残差网络那篇')
    await page.keyboard.press('Meta+j')

    // AI 跑命令把新的一节写进这篇末尾，写完还在答（放行开关关着）
    rmSync(gate, { force: true })
    await send(page, `跑命令写文件「11.24 组会准备.md」「${MEET.trimEnd()}\n\n${ADD}\n」`)
    const glow = board(page).getByTestId('ai-acting')
    await expect(glow).toBeVisible({ timeout: 15_000 })
    await expect(glow).toHaveAttribute('data-phase', 'run')
    const bar = board(page).getByTestId('ai-actbar')
    await expect(bar).toContainText('AI 正在改这块白板')
    await expect(bar.getByRole('button', { name: /停下/ })).toBeVisible()
    // 胶囊离白板顶 16，和右上角「80% · 收件箱」那组同一行
    // （进场动画从上面滑下来，等它停了再量）
    await expect.poll(() => bar.evaluate((el) => Math.round(el.getBoundingClientRect().top - el.closest('[data-testid="ai-act"]')!.getBoundingClientRect().top))).toBe(16)
    // 光真的在走：四条边里光的位置隔一会儿不一样
    const beamAt = () => glow.evaluate((el) => [...el.querySelectorAll('.beam')].map((b) => getComputedStyle(b).transform).join('|'))
    const b0 = await beamAt()
    await page.waitForTimeout(400)
    expect(await beamAt()).not.toBe(b0)
    // AI 写进来的那一节在白板上长成新的一列
    await expect(board(page)).toContainText('这周要讲的', { timeout: 10_000 })
    // 文档栏那层不在（白板看法里文档栏没挂），只这一格亮
    await expect(page.getByTestId('ai-acting')).toHaveCount(1)
    await page.waitForTimeout(600)
    await page.screenshot({ path: join(SHOTS, '1-白板看法改的时候.png') })

    // 放行：这一轮答完、提交；顶上收成「✓ 改好了 · +N −0 · 撤回」，N 和这次提交一样
    writeFileSync(gate, '')
    await expect(bar).toContainText(/改好了 · \+\d+ −0/, { timeout: 20_000 })
    await expect(bar.getByRole('button', { name: '撤回' })).toBeVisible()
    await expect(bar.locator('.n.add')).not.toHaveClass(/zero/)
    await expect(bar.locator('.n.del')).toHaveClass(/zero/)
    await page.screenshot({ path: join(SHOTS, '2-白板看法改好了.png') })
    const [added, removed] = gitOut(vault, 'show', '--numstat', '--format=', 'HEAD', '--', '11.24 组会准备.md').split(/\s+/)
    expect(gitOut(vault, 'log', '-1', '--format=%s')).toMatch(/^AI：/)
    await expect(bar).toContainText(`改好了 · +${added} −${removed}`)
    expect(Number(added)).toBeGreaterThanOrEqual(5)
    await expect(board(page).getByTestId('ai-act')).toHaveCount(0, { timeout: 5000 })
    await expect(board(page)).toContainText('层数翻倍以后准确率还在涨')

    // 白板看法里按 esc 是「停下」：光停住变灰，「停下了 · 改的留着 · +N −0」，AI 不再往下答
    rmSync(gate, { force: true })
    await send(page, `跑命令写文件「11.24 组会准备.md」「${readFileSync(join(vault, '11.24 组会准备.md'), 'utf8').trimEnd()}\n\n## 下周\n\n跑消融实验。\n」`)
    await expect(bar).toContainText('AI 正在改这块白板', { timeout: 15_000 })
    await expect(board(page)).toContainText('跑消融实验', { timeout: 10_000 })
    // 光标放回白板空白处再按（AI 输入框里的 esc 是收起右栏）
    const r = (await board(page).boundingBox())!
    await page.mouse.click(r.x + r.width - 40, r.y + r.height - 40)
    await page.keyboard.press('Escape')
    await expect(bar).toContainText(/停下了/, { timeout: 15_000 })
    await expect(ai(page).getByTestId('ai-msg').last()).not.toContainText('写好了', { timeout: 3000 })
    writeFileSync(gate, '')
    await expect(board(page).getByTestId('ai-act')).toHaveCount(0, { timeout: 8000 })
    // 停下了：改进来的那一节留着
    expect(readFileSync(join(vault, '11.24 组会准备.md'), 'utf8')).toContain('跑消融实验。')

    // 白板文件（type: board）被命令行改了一样亮
    await open(page, '课题看板')
    await expect(board(page)).toContainText('整理实验记录')
    rmSync(gate, { force: true })
    await send(page, `跑命令写文件「课题看板.md」「${BOARD.trimEnd()}\n\n## 做完了\n\n画好了第三张图。\n」`)
    await expect(board(page).getByTestId('ai-acting')).toBeVisible({ timeout: 15_000 })
    await expect(bar).toContainText('AI 正在改这块白板')
    await expect(board(page)).toContainText('画好了第三张图', { timeout: 10_000 })
    writeFileSync(gate, '')
    await expect(bar).toContainText(/改好了 · \+\d+ −0/, { timeout: 20_000 })
    await expect(board(page).getByTestId('ai-act')).toHaveCount(0, { timeout: 5000 })
  } finally {
    await run.close()
  }
})
