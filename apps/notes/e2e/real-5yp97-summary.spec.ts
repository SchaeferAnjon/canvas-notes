// 用本机真的 Claude Code 验「AI 总结的」卡开旁支（task-5yp97）：以前存的总结卡打开时一次改成 AI 总结块，卡里选一句、开旁支、真问一句，
// 回答写进同一篇、挂在总结块后面的 `> [!side]`。要联网、花一点额度，平时跳过：
//   env -i HOME="$HOME" USER="$USER" LOGNAME="$LOGNAME" PATH="$PATH" TMPDIR="$TMPDIR" CN_REAL_AI=1 CN_SHOTS=<目录> npx playwright test e2e/real-5yp97-summary.spec.ts
// （在 Claude Code 的终端里跑要像上面这样去掉父会话的 CLAUDE_* 环境变量）。测试模式、临时库、临时设置目录；CN_AI_MODEL=sonnet，effort 选 Low。
// 跑完只删这次产生的 Claude 会话记录。
import { expect, test, type Locator, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { acts, launch, openNote, type Running } from './app'
import { board } from './fixtures/board-doc'

test.skip(!process.env.CN_REAL_AI, '真 AI 才跑：CN_REAL_AI=1')
test.setTimeout(10 * 60_000)

const DIR = process.env.CN_SHOTS ?? ''
const askbox = (page: Page) => page.getByRole('toolbar', { name: '选中的这句' })
const sideIn = (scope: Locator) => scope.getByRole('region', { name: '旁支' })

async function shot(run: Running, name: string) {
  if (!DIR) return
  mkdirSync(DIR, { recursive: true })
  await run.page.mouse.move(5, 300)
  await run.page.waitForTimeout(500)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(DIR, `real-${name}.png`), Buffer.from(b64, 'base64'))
}

function forgetSessions(run: Running) {
  const claude = join(homedir(), '.claude')
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
  console.log(`删掉了这次的会话记录：${mine.join('、') || '（没有）'}（会话 ${ids.join('、') || '无'}）`)
}

async function selectText(page: Page, scope: Locator, from: string, to: string) {
  const pts = await scope.evaluate(
    (root, [a, b]) => {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let s: [Node, number] | null = null
      let e: [Node, number] | null = null
      while (w.nextNode()) {
        const n = w.currentNode as Text
        if (!s && n.data.includes(a!)) s = [n, n.data.indexOf(a!)]
        if (s && n.data.includes(b!, s[0] === n ? s[1] : 0)) {
          e = [n, n.data.indexOf(b!, s[0] === n ? s[1] : 0) + b!.length]
          break
        }
      }
      const r = document.createRange()
      r.setStart(s![0], s![1])
      r.setEnd(e![0], e![1])
      const rs = r.getClientRects()
      const f = rs[0]!
      const l = rs[rs.length - 1]!
      return [f.left + 1, f.top + f.height / 2, l.right - 1, l.top + l.height / 2]
    },
    [from, to],
  )
  await page.mouse.move(pts[0]!, pts[1]!)
  await page.mouse.down()
  await page.mouse.move(pts[2]!, pts[3]!, { steps: 8 })
  await page.mouse.up()
}

const DOC = '课程/ecp/注意力白板.md'
const SUMMARY = '这块白板讲了注意力的三步：先拿 Q 和每个 K 做点积得到分数，分数除以 √d 再过 softmax 变成权重，最后用权重把 V 加起来。多头注意力是把 Q、K、V 切成几份各算各的，再拼回来。'
const OLD = `---\ntype: board\n---\n# 注意力白板\n\n<!-- card id=s1 ai=2026-11-21 -->\n${SUMMARY}\n\n## 讲解\n\n先拿 Q 和每个 K 做点积，得到「该看谁」的分数。\n`

test('真 Claude Code：以前存的「AI 总结的」卡打开时改成 AI 总结块，卡里选一句开旁支、真问一句，写进同一篇、挂在总结块后面', async () => {
  const run = await launch({ [DOC]: OLD }, { CN_AI_MODEL: 'sonnet' })
  const { page, vault } = run
  const file = () => readFileSync(join(vault, DOC), 'utf8')
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    await openNote(page, '注意力白板')
    if ((await acts(page).getByRole('tab', { name: '白板' }).getAttribute('aria-selected')) !== 'true') await acts(page).getByRole('tab', { name: '白板' }).click()
    await expect.poll(file).toContain(`<!-- card id=s1 ai=2026-11-21 -->\n> [!ai] AI 总结\n> ${SUMMARY}\n`)
    const card = board(page).locator('.db-card[aria-label="AI 总结"]')
    await selectText(page, card.locator('.side-text'), '分数除以', '变成权重，')
    await expect(askbox(page)).toBeVisible()
    await askbox(page).getByRole('button', { name: '问这句' }).click()
    const s = sideIn(card)
    await expect(s).toBeVisible()
    await s.getByTestId('ai-effort').click()
    await page.getByRole('menu', { name: '想多久（effort）' }).getByRole('menuitemradio', { name: /^Low/ }).click()
    await expect(s.getByTestId('ai-effort')).toHaveText('Low')
    const t0 = Date.now()
    await s.getByRole('textbox').fill('为什么要除以根号 d？用两句话说。')
    await s.getByRole('textbox').press('Enter')
    await expect(s.locator('.acts')).toBeVisible({ timeout: 240_000 })
    const a = await s.getByTestId('side-msg').last().innerText()
    console.log(`旁支答好用了 ${Math.round((Date.now() - t0) / 1000)} 秒：`, a.slice(0, 300))
    expect(a.length).toBeGreaterThan(10)
    await expect(s.getByRole('alert')).toHaveCount(0)
    await expect(s.locator('.rec')).toHaveText('写在这篇文档里，挂在这段总结下面')
    await shot(run, 'summary-side')
    await expect.poll(file, { timeout: 15_000 }).toContain(`> ${SUMMARY}\n\n> [!side] 为什么要除以根号 d？用两句话说。\n> > 分数除以 √d 再过 softmax 变成权重，\n>\n> `)
    console.log('文件：\n' + file())
    await s.getByRole('button', { name: '收起旁支' }).first().click()
    await acts(page).getByRole('tab', { name: '文档' }).click()
    await expect(page.locator('.pane:not([hidden]) .cm-content .badge')).toHaveText('1')
  } finally {
    await run.close()
    forgetSessions(run)
  }
})
