// 用本机真的 Claude Code 验「选中小条能自定义」（task-26nz7）：网页上选一句点自己加的那颗「用高中生能懂的话讲」，真答完一块 [!ai] 写进配好对的那篇
// （块头是那颗的名字）；文档里选一段右键点它，选中那一段下面长出那颗的 AI 块。要联网、花一点额度，平时跳过：
//   env -i HOME="$HOME" USER="$USER" LOGNAME="$LOGNAME" PATH="$PATH" TMPDIR="$TMPDIR" ANTHROPIC_API_KEY="$(dispatch env get CN_TEST_ANTHROPIC_API_KEY)" \
//     CN_REAL_AI=1 npx playwright test e2e/real-26nz7-selbar.spec.ts
// 测试模式（窗口不上屏幕）、临时库、临时设置目录；CN_AI_MODEL=sonnet，AI 对话那一行设成 Low。跑完只删这次产生的 Claude 会话记录。
import { expect, test, type Page } from '@playwright/test'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { launch, openNote, pane, rail, type Running, waitSaved, widenRight } from './app'
import { armMenus, pickMenu } from './menu'
import { d2l, type D2l, P1_LAST } from './fixtures/d2l-pandas'

test.skip(!process.env.CN_REAL_AI, '真 AI 才跑：CN_REAL_AI=1')
test.setTimeout(10 * 60_000)

const NOTE = '课程/学习笔记：动手学深度学习.md'
const TITLE = '学习笔记：动手学深度学习'
let site: D2l
test.beforeAll(async () => {
  site = await d2l()
})
test.afterAll(() => site.close())

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
function guest<T = unknown>(page: Page, code: string): Promise<T> {
  return page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code) as Promise<T>
}

/** 按这次临时库路径起名的 Claude 会话记录：挪到 ~/待删/<日子>/task-26nz7/（夜里删东西没人点权限框），清单.md 记一行 */
const TRASH = join(homedir(), '待删', '2026-11-23')
function away(p: string, why: string) {
  const to = join(TRASH, 'task-26nz7', p.split('/').slice(-2).join('__'))
  mkdirSync(dirname(to), { recursive: true })
  renameSync(p, to)
  appendFileSync(join(TRASH, '清单.md'), `- ${p} → ${to}：${why}\n`)
}
function forgetSessions(run: Running) {
  const claude = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
  const projects = join(claude, 'projects')
  const stamp = dirname(run.vault).split('/').pop()!
  const mine = existsSync(projects) ? readdirSync(projects).filter((d) => d.includes(stamp)) : []
  const ids = mine.flatMap((d) => readdirSync(join(projects, d)).filter((f) => f.endsWith('.jsonl')).map((f) => f.slice(0, -6)))
  for (const d of mine) away(join(projects, d), '真 AI 测试这次的 Claude 会话记录（task-26nz7）')
  for (const sub of ['session-env', 'file-history', 'todos', 'tasks']) {
    const dir = join(claude, sub)
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir)) if (ids.some((id) => f.startsWith(id))) away(join(dir, f), '真 AI 测试这次的 Claude 会话附带记录（task-26nz7）')
  }
  console.log(`挪走了这次的会话记录：${mine.join('、') || '（没有）'}（会话 ${ids.join('、') || '无'}）`)
}

const CMDS =
  JSON.stringify({
    version: 1,
    own: [{ id: 'own-hs', name: '用高中生能懂的话讲', kind: 'ai', target: '1. 讲', rules: [{ t: '讲' }], prompt: '用高中生能听懂的话讲{选中的字}：先一句话说它在干什么，再举一个生活里的例子。不用术语，三句以内。', out: 'note', where: ['web', 'pdf', 'html', 'doc'], write: 'answer', desc: '用高中生能听懂的话讲' }],
    bar: { on: ['explain', 'translate', 'quote', 'clip', 'own-hs'], more: ['only', 'copy'], off: [], enabled: true },
    keys: { 'own-hs': '⌥G' },
  }) + '\n'

test('真 Claude Code：网页上点自己加的那颗，真回答写进那篇（块头是那颗的名字）；文档里右键点它，选中那段下面长出它的 AI 块', async () => {
  const body = () => `---\nread-along: ${site.base}/\n---\n# ${TITLE}\n\n## 2.2 数据预处理\n\n先把数据读进来，再处理缺失值。\n\nCSV 文件一行是一条记录，格子之间用逗号隔开。\n`
  const run = await launch({ [NOTE]: body(), '.canvas-notes/命令.json': CMDS }, { CN_AI_MODEL: 'sonnet' })
  const { page, vault } = run
  try {
    await page.evaluate(() => window.cn.aiSetPrefs({ default: { engine: 'claude', model: 'sonnet', effort: 'low' }, features: { chat: { engine: 'claude', model: 'sonnet', effort: 'low' } } }))
    await openNote(page, TITLE)
    await pane(page).locator('.cm-line', { hasText: '先把数据读进来' }).click()
    await page.keyboard.press('End')
    // 配好对的那篇打开时网页已经跟着开了；没开才点
    await page.waitForTimeout(800)
    if (!(await web(page).isVisible())) await rail(page).getByRole('button', { name: '网页', exact: true }).click()
    const addr = web(page).getByRole('textbox', { name: '网址' })
    await addr.fill(site.pandas)
    await addr.press('Enter')
    await expect.poll(() => guest(page, 'document.readyState + "|" + location.href')).toBe(`complete|${site.pandas}`)
    await widenRight(page, 200)
    await guest(page, `document.getElementById('p1').scrollIntoView({ block: 'center' })`)
    const w = (await web(page).locator('webview.on').boundingBox())!
    for (let i = 0; i < 3; i++) {
      const pts = await guest<number[]>(page, `(() => { const t = document.getElementById('p1').firstChild; const s = t.data.indexOf('下面我们将'); const r = document.createRange(); r.setStart(t, s); r.setEnd(t, t.data.length); const rs = r.getClientRects(); const f = rs[0], l = rs[rs.length - 1]; return [f.left + 1, f.top + f.height / 2, l.right - 1, l.top + l.height / 2] })()`)
      await page.mouse.move(w.x + pts[0]!, w.y + pts[1]!)
      await page.mouse.down()
      await page.mouse.move(w.x + pts[2]!, w.y + pts[3]!, { steps: 8 })
      await page.mouse.up()
      if (await expect.poll(() => guest<string>(page, 'getSelection().toString().trim()'), { timeout: 2000 }).toBe(P1_LAST).then(() => true, () => false)) break
    }
    await expect.poll(() => guest(page, `document.getElementById('cn-clip-host')?.style.display`)).toBe('block')
    const b = await guest<{ x: number; y: number }>(page, `(() => { const b = [...document.getElementById('cn-clip-host').shadowRoot.querySelectorAll('.bar button')].find((x) => x.textContent.includes('高中生')).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 } })()`)
    await page.mouse.click(w.x + b.x, w.y + b.y)
    const dlg = page.getByRole('dialog', { name: '记到哪篇' })
    if (await dlg.isVisible({ timeout: 3000 }).catch(() => false)) await dlg.getByRole('button', { name: /记到这篇/ }).click()
    const file = () => readFileSync(join(vault, NOTE), 'utf8')
    const ok = await expect
      .poll(file, { timeout: 4 * 60_000, intervals: [2000] })
      .toMatch(/> \[!ai\] 用高中生能懂的话讲 · Claude Code · [^\n]+\n> > 下面我们将数据集按行写入CSV文件中。\n>\n> \S/)
      .then(() => true, () => false)
    if (!ok) console.log('右栏 AI 里：\n' + (await page.getByRole('complementary', { name: '边读边问 AI' }).innerText().catch(() => '(看不到)')))
    expect(ok).toBe(true)
    console.log('网页那一颗写进去的：\n' + file().split('[!ai] 用高中生能懂的话讲')[1]!.slice(0, 400))

    // 文档里：选一段右键点它
    await armMenus(run)
    const line = pane(page).locator('.cm-line', { hasText: 'CSV 文件一行是一条记录' })
    await line.click({ clickCount: 3 })
    await line.click({ button: 'right' })
    await pickMenu(run, '用高中生能懂的话讲')
    const ok2 = await expect
      .poll(file, { timeout: 4 * 60_000, intervals: [2000] })
      .toMatch(/CSV 文件一行是一条记录，格子之间用逗号隔开。\n\n> \[!ai\] 用高中生能懂的话讲 · Claude Code · [^\n]+\n> \S/)
      .then(() => true, () => false)
    await waitSaved(page)
    console.log('文档里那一颗写进去的：\n' + file().split('格子之间用逗号隔开。')[1]!.slice(0, 400))
    expect(ok2).toBe(true)
  } finally {
    await run.close().catch((e) => console.log(String(e)))
    forgetSessions(run)
  }
})
