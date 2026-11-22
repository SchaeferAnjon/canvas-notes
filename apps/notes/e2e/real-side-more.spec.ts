// 用本机真的 Claude Code 验旁支接上白板 AI 讲解卡和问框回答（task-p90ra）：两处各开一条旁支、真问一句，截图。要联网、花一点额度，平时跳过：
//   env -i HOME="$HOME" USER="$USER" LOGNAME="$LOGNAME" PATH="$PATH" TMPDIR="$TMPDIR" CN_REAL_AI=1 CN_SHOTS=<目录> npx playwright test e2e/real-side-more.spec.ts
// （在 Claude Code 的终端里跑要像上面这样去掉父会话的 CLAUDE_* 环境变量）。测试模式、临时库、临时设置目录；CN_AI_MODEL=sonnet，effort 选 Low。
// 问框那处用本机的假视频页（fixtures/fake-video.ts），问框和旁支都是真 Claude Code。跑完只删这次产生的 Claude 会话记录。
import { expect, test, type Locator, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { acts, launch, openNote, pane, rail, type Running } from './app'
import { col } from './fixtures/board-doc'
import { FAKE_VIDEO_ID, startFakeVideoSite } from './fixtures/fake-video'

test.skip(!process.env.CN_REAL_AI, '真 AI 才跑：CN_REAL_AI=1')
test.setTimeout(10 * 60_000)

const DIR = process.env.CN_SHOTS ?? ''
const askbox = (page: Page) => page.getByRole('dialog', { name: '选中的这句' })
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

/** 回答第一段里拖选第一句（真回答的字事先不知道） */
async function selectFirstSentence(page: Page, txt: Locator): Promise<string> {
  const r = await txt.evaluate((root) => {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    while (w.nextNode()) {
      const n = w.currentNode as Text
      if (n.parentElement?.closest('.katex, code, .md-h, .badge')) continue
      const t = n.data
      if (t.trim().length < 8) continue
      const start = t.search(/\S/)
      const stop = t.indexOf('。', start)
      const end = stop > start + 4 ? stop + 1 : Math.min(t.length, start + 24)
      const range = document.createRange()
      range.setStart(n, start)
      range.setEnd(n, end)
      const rs = range.getClientRects()
      const f = rs[0]!
      const l = rs[rs.length - 1]!
      return { text: t.slice(start, end), pts: [f.left + 1, f.top + f.height / 2, l.right - 1, l.top + l.height / 2] }
    }
    return null
  })
  if (!r) throw new Error('回答里没找到一句能选的字')
  await page.mouse.move(r.pts[0]!, r.pts[1]!)
  await page.mouse.down()
  await page.mouse.move(r.pts[2]!, r.pts[3]!, { steps: 8 })
  await page.mouse.up()
  return r.text
}

/** 空着回车打开旁支，旁支输入框底行选 Low，打字真问一句，等真回答答完 */
/** input：旁支的输入框在哪（问框里钉在问框底部，task-5yp97；别处在那一块里） */
async function askLow(page: Page, s: Locator, q: string, input: Locator = s) {
  await expect(askbox(page)).toBeVisible()
  await askbox(page).getByRole('textbox', { name: '问这句' }).press('Enter')
  await expect(s).toBeVisible()
  await input.getByTestId('ai-effort').click()
  await page.getByRole('menu', { name: '想多久（effort）' }).getByRole('menuitemradio', { name: /^Low/ }).click()
  await expect(input.getByTestId('ai-effort')).toHaveText('Low')
  const t0 = Date.now()
  await input.getByRole('textbox').fill(q)
  await input.getByRole('textbox').press('Enter')
  await expect(s.locator('.acts')).toBeVisible({ timeout: 240_000 })
  const a = await s.getByTestId('side-msg').last().innerText()
  console.log(`旁支答好用了 ${Math.round((Date.now() - t0) / 1000)} 秒：`, a.slice(0, 200))
  expect(a.length).toBeGreaterThan(10)
  await expect(s.getByRole('alert')).toHaveCount(0)
}

test('真 Claude Code：白板上的 AI 讲解卡里选一句开旁支，真问一句，写进同一篇 `> [!side]`', async () => {
  const DOC = '第5讲 注意力机制.md'
  const text = '# 第5讲 注意力机制\n\n## 讲解\n\n> [!ai] AI 讲解 · Claude Code · Opus 5.5 · 看了 00:06 这一帧\n> 这一帧在讲缩放点积注意力：先拿 Q 和每个 K 做点积。分数要先除以 √d，再过 softmax 变成权重。\n>\n> 最后用这些权重把 V 加起来，就是这个位置的输出。\n\n我的理解：缩放是为了让分数别太极端。\n'
  const run = await launch({ [DOC]: text }, { CN_AI_MODEL: 'sonnet' })
  const { page, vault } = run
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    await openNote(page, '第5讲 注意力机制')
    await acts(page).getByRole('tab', { name: '白板' }).click()
    const card = col(page, '讲解').locator('.db-card[aria-label="AI 讲解"]')
    await selectText(page, card.locator('.side-text'), '分数要先', '变成权重。')
    await askLow(page, sideIn(card), '为什么要除以根号 d？用两句话说。')
    await shot(run, 'board')
    await expect.poll(() => readFileSync(join(vault, DOC), 'utf8'), { timeout: 15_000 }).toContain('> [!side] 为什么要除以根号 d？用两句话说。\n> > 分数要先除以 √d，再过 softmax 变成权重。\n>\n> ')
    console.log('文件：\n' + readFileSync(join(vault, DOC), 'utf8'))
    await sideIn(card).getByRole('button', { name: '收起旁支' }).first().click()
    await acts(page).getByRole('tab', { name: '文档' }).click()
    await expect(pane(page).locator('.cm-content .badge')).toHaveText('1')
  } finally {
    await run.close()
    forgetSessions(run)
  }
})

let server: Server
let base: string
test.beforeAll(async () => {
  ;({ server, base } = await startFakeVideoSite())
})
test.afterAll(() => server?.close())

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const guest = (page: Page, code: string): Promise<unknown> =>
  page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code)

test('真 Claude Code：本机假视频页上框一块问（真看图答），问框的回答里选一句开旁支，真问一句，写进那篇讲解下面', async () => {
  const NOTE = '看视频的笔记.md'
  const run = await launch({ [NOTE]: '# 看视频的笔记\n\n我先写的一句。\n' }, { CN_AI_MODEL: 'sonnet', CN_VIDEO_TEST_ORIGIN: base })
  const { page, vault } = run
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    await openNote(page, '看视频的笔记')
    await pane(page).getByText('我先写的一句。').click()
    await page.keyboard.press('End')
    await rail(page).getByRole('button', { name: '网页', exact: true }).click()
    const addr = web(page).getByRole('textbox', { name: '网址' })
    await addr.fill(`${base}/watch?v=${FAKE_VIDEO_ID}`)
    await addr.press('Enter')
    await expect(web(page).getByRole('region', { name: '视频条' })).toBeVisible({ timeout: 15_000 })
    await guest(page, `(() => { const v = document.querySelector('video'); v.currentTime = 6; v.pause(); return true })()`)
    await page.waitForTimeout(400)
    await pane(page).getByText('我先写的一句。').click()
    await page.keyboard.press('Alt+KeyD')
    await expect.poll(() => guest(page, `!!document.getElementById('cn-video-host').shadowRoot.querySelector('.box')`)).toBe(true)
    const wv = (await web(page).locator('webview.on').boundingBox())!
    await page.mouse.move(wv.x + 40, wv.y + 30)
    await page.mouse.down()
    await page.mouse.move(wv.x + 200, wv.y + 120, { steps: 6 })
    await page.mouse.up()
    const ask = web(page).getByRole('dialog', { name: '问 AI' })
    await ask.getByTestId('ai-effort').click()
    await page.getByRole('menu', { name: '想多久（effort）' }).getByRole('menuitemradio', { name: /Low/ }).click()
    await ask.getByRole('textbox', { name: '想问什么' }).fill('框住的这一块是什么颜色？一两句话。')
    await ask.getByRole('textbox', { name: '想问什么' }).press('Enter')
    await expect(ask.getByRole('button', { name: /已记进/ })).toBeVisible({ timeout: 240_000 })
    const ans = ask.getByTestId('ak-answer').first()
    console.log('问框的回答：', await ans.innerText())
    const quote = await selectFirstSentence(page, ans)
    console.log('选的那句：', quote)
    await askLow(page, sideIn(ask), '换个说法再讲一遍这句。', ask.getByTestId('ak-side-dock'))
    await expect(ask.getByTestId('ak-side-dock').getByRole('textbox')).toBeVisible()
    await shot(run, 'ask')
    await expect.poll(() => readFileSync(join(vault, NOTE), 'utf8'), { timeout: 15_000 }).toContain('> [!side] 换个说法再讲一遍这句。\n> > ')
    const md = readFileSync(join(vault, NOTE), 'utf8')
    console.log('文件：\n' + md)
    expect(md.indexOf('> [!side]')).toBeGreaterThan(md.indexOf('> [!ai] AI 讲解'))
    await sideIn(ask).getByRole('button', { name: '收起旁支' }).first().click()
    await expect(pane(page).locator('.cm-content .badge')).toHaveText('1')
  } finally {
    await run.close()
    forgetSessions(run)
  }
})
