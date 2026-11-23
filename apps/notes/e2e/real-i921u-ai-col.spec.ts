// 用本机真的 Claude Code 走一遍数据库 AI 列（task-i921u「AI 生成一列」）：加 AI 列「每一讲的练习题」→ 看样例 → 全跑 →
// 文件写对、新建的练习题笔记带 [!ai] 块 → 单格重跑 → 手改（打开那篇直接改）→ 整列重跑不动手改的 → 撤回回到原样。要联网、花一点额度，平时跳过：
//   env -i HOME="$HOME" USER="$USER" LOGNAME="$LOGNAME" PATH="$PATH" TMPDIR="$TMPDIR" ANTHROPIC_API_KEY="$(dispatch env get CN_TEST_ANTHROPIC_API_KEY)" \
//     CN_REAL_AI=1 CN_SHOTS=<目录> npx playwright test e2e/real-i921u-ai-col.spec.ts
// （在 Claude Code 的终端里跑要像上面这样去掉父会话的 CLAUDE_* 环境变量；测试用的 API key 只在运行时从 dispatch env 读，不写进任何文件、不打印）。
// 测试模式（窗口不上屏幕）、临时库、临时设置目录；CN_AI_MODEL=sonnet，AI 对话那一行设成 Low。跑完只删这次产生的 Claude 会话记录。
import { expect, type Locator, type Page, test } from '@playwright/test'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { aiFilled, aiNoteSummary, prop } from '@cn/format'
import { ECP_DOC, EXERCISES, LECTURES } from '../../../packages/format/test/base-samples'
import { lineDiff } from '../../../packages/format/test/line-diff'
import { gitStatus, launch, openNote, pane, type Running, tabOn } from './app'

test.skip(!process.env.CN_REAL_AI, '真 AI 才跑：CN_REAL_AI=1')
test.setTimeout(20 * 60_000)

const DIR = process.env.CN_SHOTS ?? ''
const DOC = '课程/ecp/ecp 课程计划.md'
const FILES: Record<string, string> = { [DOC]: ECP_DOC, ...LECTURES, ...EXERCISES }
const P = (n: string) => Object.keys(LECTURES).find((p) => p.includes(`/${n} `))!
const nameOf = (p: string) => p.split('/').pop()!.replace(/\.md$/, '')
const NOTE = (p: string) => `课程/ecp/练习题/${nameOf(p)} 练习题.md`
const read = (vault: string, p: string) => readFileSync(join(vault, p), 'utf8')

const db = (page: Page) => pane(page).locator('[data-part="数据库块"]').first()
const cell = (page: Page, name: string, col: string) => db(page).locator('tbody tr', { hasText: name }).locator(`td[data-col="${col}"]`)
const side = (page: Page) => page.getByTestId('dview-aicol')
const toast = (page: Page) => page.getByTestId('toast')
async function clickSteady(page: Page, el: Locator) {
  await el.scrollIntoViewIfNeeded()
  await page.waitForTimeout(200)
  await el.click()
}
const look = (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: 'sky', frame: 'b', winBg: 'aurora' } }))
}
async function shot(run: Running, name: string) {
  if (!DIR) return
  mkdirSync(DIR, { recursive: true })
  await run.page.waitForTimeout(400)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(DIR, `real-${name}.png`), Buffer.from(b64, 'base64'))
}
/** 这次在 Claude 配置目录下留的会话记录：只删按这次临时库路径起名的（同 real-6cxtc-web-notes） */
function forgetSessions(run: Running) {
  const claude = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
  const projects = join(claude, 'projects')
  const stamp = dirname(run.vault).split('/').pop()!
  const mine = existsSync(projects) ? readdirSync(projects).filter((d) => d.includes(stamp)) : []
  const ids = mine.flatMap((d) => readdirSync(join(projects, d)).filter((f) => f.endsWith('.jsonl')).map((f) => f.slice(0, -6)))
  for (const d of mine) rmSync(join(projects, d), { recursive: true, force: true })
  for (const sub of ['session-env', 'file-history', 'todos', 'tasks']) {
    const dir = join(claude, sub)
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir)) if (ids.some((id) => f.startsWith(id))) rmSync(join(dir, f), { recursive: true, force: true })
  }
  console.log(`删掉了这次的会话记录：${mine.join('、') || '（没有）'}（会话 ${ids.length} 个）`)
}

test('真 Claude Code：AI 列「每一讲的练习题」看样例、全跑、单格重跑、手改、整列重跑不动手改的、撤回', async () => {
  const run = await launch(FILES, { CN_AI_MODEL: 'sonnet' }, look)
  const { page, vault, app } = run
  try {
    await page.evaluate(() => {
      const pick = { engine: 'claude' as const, model: 'sonnet', effort: 'low' }
      return window.cn.aiSetPrefs({ default: pick, features: { chat: pick } })
    })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await openNote(page, 'ecp 课程计划')
    await expect(db(page).locator('tbody tr')).toHaveCount(8)

    // ---------- 加 AI 列
    await clickSteady(page, db(page).getByRole('button', { name: '加一列' }))
    await page.getByRole('dialog', { name: '加一列' }).getByRole('menuitem', { name: /AI 生成一列/ }).click()
    await side(page).getByRole('textbox', { name: '这一列放什么' }).pressSequentially('每一讲的练习题')
    await expect(side(page).getByRole('radio', { name: '新建一篇笔记，关联过来' })).toHaveAttribute('aria-checked', 'true')
    await shot(run, '1-form')

    // ---------- 先跑前 3 条：看样例
    await side(page).getByRole('button', { name: '先跑前 3 条' }).click()
    await expect(side(page).locator('.scard.run').first()).toBeVisible({ timeout: 30_000 })
    await shot(run, '2-sampling')
    await expect(toast(page)).toContainText('前 3 条写好了', { timeout: 5 * 60_000 })
    await shot(run, '3-samples')
    for (const n of ['第1讲', '第2讲', '第3讲']) {
      const p = P(n)
      expect(lineDiff(LECTURES[p]!, read(vault, p))).toEqual({ removed: [], added: [`练习题: "[[${nameOf(p)} 练习题]]"`, 'AI填的: 练习题'] })
      const note = read(vault, NOTE(p))
      expect(note.startsWith(`---\n所属讲: "[[${nameOf(p)}]]"\n---\n\n> [!ai] 练习题 · Claude Code`)).toBe(true)
      expect(note).toContain(`读了《${nameOf(p)}》`)
      expect(aiNoteSummary(note, '练习题').items.length).toBeGreaterThan(0)
      console.log(`样例《${nameOf(p)}》：${aiNoteSummary(note, '练习题').items.join(' / ').slice(0, 160)}`)
    }

    // ---------- 全跑剩下 5 条
    await side(page).getByRole('button', { name: '全跑剩下 5 条' }).click()
    await expect(side(page).locator('.rowlist [data-state="running"]').first()).toBeVisible({ timeout: 30_000 })
    await shot(run, '4-running')
    await expect(side(page).locator('.pfoot')).toContainText('8 格都填好了', { timeout: 8 * 60_000 })
    await shot(run, '5-done')
    for (const p of Object.keys(LECTURES)) {
      expect(aiFilled(read(vault, p))).toEqual(['练习题'])
      expect(read(vault, NOTE(p))).toMatch(/^> \[!ai\] 练习题 · Claude Code/m)
    }
    expect(gitStatus(vault).split('\n').filter((l) => l && !l.includes('ecp 课程计划'))).toEqual([])

    // ---------- 单格重跑：只换那篇里 AI 那一块
    const p3 = P('第3讲')
    const before3 = read(vault, NOTE(p3))
    await cell(page, '第3讲', '练习题').hover()
    await cell(page, '第3讲', '练习题').getByRole('button', { name: '重跑这一格' }).click()
    await expect(toast(page)).toContainText('重跑了「第3讲 生产」这一格', { timeout: 3 * 60_000 })
    const after3 = read(vault, NOTE(p3))
    expect(after3).toMatch(/^> \[!ai\] 练习题（第 2 版） · /m)
    expect(lineDiff(before3, after3).removed.every((l) => l.startsWith('>'))).toBe(true)

    // ---------- 手改：打开第2讲那篇，在 AI 块里改字，块头多「改过」
    const p2 = P('第2讲')
    await clickSteady(page, cell(page, '第2讲', '练习题').getByRole('button', { name: `打开《${nameOf(p2)} 练习题》` }))
    await expect(tabOn(page)).toHaveText(`${nameOf(p2)} 练习题`)
    const q1 = aiNoteSummary(read(vault, NOTE(p2)), '练习题').items[0]!
    await pane(page).locator('.cm-line', { hasText: q1.slice(0, 12) }).first().click()
    await page.keyboard.press('End')
    await page.keyboard.type('（我改的）')
    await expect.poll(() => read(vault, NOTE(p2))).toContain('（我改的）')
    expect(read(vault, NOTE(p2))).toMatch(/^> \[!ai\] 练习题 · .* · 改过$/m)
    const mine2 = read(vault, NOTE(p2))
    await openNote(page, 'ecp 课程计划')
    await expect(cell(page, '第2讲', '练习题').locator('.mine-dot')).toBeVisible()

    // ---------- 整列重跑：你改过的那篇不动
    const notesBefore = Object.fromEntries(Object.keys(LECTURES).map((p) => [p, read(vault, NOTE(p))]))
    const lecBefore = Object.fromEntries(Object.keys(LECTURES).map((p) => [p, read(vault, p)]))
    await clickSteady(page, db(page).locator('thead .base-th[data-col="练习题"]'))
    const menu = page.getByRole('menu', { name: '练习题 这一列' })
    await expect(menu.getByRole('menuitem', { name: /整列重跑/ })).toContainText('你改过的 1 格不动')
    await menu.getByRole('menuitem', { name: /整列重跑/ }).click()
    await expect(toast(page)).toContainText('「练习题」7 格写好了', { timeout: 8 * 60_000 })
    await shot(run, '6-rerun-all')
    expect(read(vault, NOTE(p2))).toBe(mine2)
    for (const p of Object.keys(LECTURES)) {
      expect(read(vault, p)).toBe(lecBefore[p])
      if (p !== p2) expect(read(vault, NOTE(p))).not.toBe(notesBefore[p])
    }

    // ---------- 撤回：回到整列重跑之前
    await toast(page).getByRole('button', { name: '撤回' }).click()
    await expect(toast(page)).toContainText('撤回了')
    for (const p of Object.keys(LECTURES)) await expect.poll(() => read(vault, NOTE(p))).toBe(notesBefore[p])
    expect(prop(read(vault, p3), '练习题')).toBe(`[[${nameOf(p3)} 练习题]]`)
    await shot(run, '7-undone')
  } finally {
    forgetSessions(run)
    await run.close()
  }
})
