// 用本机真的 Claude Code 验「网页的笔记写进正在剪进去的那篇」（task-6cxtc）：本机假的 d2l 网页上选一句点「讲解一下」，
// 第一次问记到哪篇、记到这篇，真答完一块 [!ai] 写进那篇（块头带回到那一段的链接），网页滚走后点「↩」网页回到那几句、亮一下。要联网、花一点额度，平时跳过：
//   env -i HOME="$HOME" USER="$USER" LOGNAME="$LOGNAME" PATH="$PATH" TMPDIR="$TMPDIR" ANTHROPIC_API_KEY="$(dispatch env get CN_TEST_ANTHROPIC_API_KEY)" \
//     CN_REAL_AI=1 CN_SHOTS=<目录> npx playwright test e2e/real-6cxtc-web-notes.spec.ts
// （在 Claude Code 的终端里跑要像上面这样去掉父会话的 CLAUDE_* 环境变量；测试用的 API key 只在运行时从 dispatch env 读，不写进任何文件、不打印。
// 没有 key 时可以换成登录过的 Claude 配置目录 CLAUDE_CONFIG_DIR=<目录>）。测试模式（窗口不上屏幕）、临时库、临时设置目录；
// CN_AI_MODEL=sonnet，AI 对话那一行设成 Low。跑完只删这次产生的 Claude 会话记录（配置目录（默认 ~/.claude）projects 下按临时库路径起名的那个文件夹）。
// Claude Code 用不了（额度用完）时可以换 Codex 跑同一遍：CN_REAL_ENGINE=codex（只删这次 ~/.codex/sessions 里写着这个临时库的那几个会话文件）。
import { expect, test, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { editorText, launch, openNote, pane, rail, type Running, widenRight } from './app'
import { d2l, type D2l, P1_LAST } from './fixtures/d2l-pandas'
import { fragmentUrl } from '../src/shared/web-link'

test.skip(!process.env.CN_REAL_AI, '真 AI 才跑：CN_REAL_AI=1')
test.setTimeout(10 * 60_000)

const DIR = process.env.CN_SHOTS ?? ''
const ENGINE = process.env.CN_REAL_ENGINE === 'codex' ? 'codex' : 'claude'
const NOTE = '课程/学习笔记：动手学深度学习.md'
const TITLE = '学习笔记：动手学深度学习'
const BODY = `# ${TITLE}\n\n## 2.2 数据预处理\n\n先把数据读进来，再处理缺失值。\n`

let site: D2l
test.beforeAll(async () => {
  site = await d2l()
})
test.afterAll(() => site.close())

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const look = (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: 'sky', frame: 'b', winBg: 'aurora' } }))
}
function guest<T = unknown>(page: Page, code: string): Promise<T> {
  return page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code) as Promise<T>
}

async function shot(run: Running, name: string) {
  if (!DIR) return
  mkdirSync(DIR, { recursive: true })
  await run.page.waitForTimeout(400)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(DIR, `real-${name}.png`), Buffer.from(b64, 'base64'))
}

/** 这次在 Claude 配置目录（CLAUDE_CONFIG_DIR，默认 ~/.claude）下留的会话记录（同 real-side.spec.ts）：只删按这次临时库路径起名的 */
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
  console.log(`删掉了这次的会话记录：${mine.join('、') || '（没有）'}（会话 ${ids.join('、') || '无'}）`)
}

/** Codex 这次的会话记录：~/.codex/sessions 下开始以后写过、里面写着这个临时库路径的那几个文件 */
function forgetCodex(run: Running, since: number) {
  const root = join(homedir(), '.codex', 'sessions')
  const stamp = dirname(run.vault).split('/').pop()!
  const gone: string[] = []
  const walk = (d: string) => {
    if (!existsSync(d)) return
    for (const f of readdirSync(d)) {
      const p = join(d, f)
      const st = statSync(p)
      if (st.isDirectory()) walk(p)
      else if (st.mtimeMs >= since && f.endsWith('.jsonl') && readFileSync(p, 'utf8').includes(stamp)) {
        rmSync(p)
        gone.push(f)
      }
    }
  }
  walk(root)
  console.log(`删掉了这次的 Codex 会话记录：${gone.join('、') || '（没有）'}`)
}

test('真 Claude Code：网页上选一句讲解一下，问记到哪篇、记到这篇，回答一块 [!ai] 写进那篇；点「↩」网页回到那几句', async () => {
  const since = Date.now()
  const run = await launch({ [NOTE]: BODY }, { CN_AI_MODEL: 'sonnet' }, look)
  const { page, vault } = run
  try {
    await page.evaluate((engine) => {
      const pick = engine === 'codex' ? { engine: 'codex' as const, effort: 'low' } : { engine: 'claude' as const, model: 'sonnet', effort: 'low' }
      return window.cn.aiSetPrefs({ default: pick, features: { chat: pick } })
    }, ENGINE)
    await openNote(page, TITLE)
    await pane(page).locator('.cm-line', { hasText: '先把数据读进来' }).click()
    await page.keyboard.press('End')
    await rail(page).getByRole('button', { name: '网页', exact: true }).click()
    const addr = web(page).getByRole('textbox', { name: '网址' })
    await addr.fill(site.pandas)
    await addr.press('Enter')
    await expect.poll(() => guest(page, 'document.readyState + "|" + location.href')).toBe(`complete|${site.pandas}`)
    await widenRight(page, 200)
    // 真鼠标拖选最后一句（机器忙时拖一次可能没选全：看选区对了再点，不对重拖，最多三次）
    await guest(page, `document.getElementById('p1').scrollIntoView({ block: 'center' })`)
    const w = (await web(page).locator('webview.on').boundingBox())!
    for (let i = 0; i < 3; i++) {
      const pts = await guest<number[]>(page, `(() => { const t = document.getElementById('p1').firstChild; const s = t.data.indexOf('下面我们将'); const r = document.createRange(); r.setStart(t, s); r.setEnd(t, t.data.length); const rs = r.getClientRects(); const f = rs[0], l = rs[rs.length - 1]; return [f.left + 1, f.top + f.height / 2, l.right - 1, l.top + l.height / 2] })()`)
      await page.mouse.move(w.x + pts[0]!, w.y + pts[1]!)
      await page.mouse.down()
      await page.mouse.move(w.x + pts[2]!, w.y + pts[3]!, { steps: 8 })
      await page.mouse.up()
      const got = await expect
        .poll(() => guest<string>(page, 'getSelection().toString().trim()'), { timeout: 2000 })
        .toBe(P1_LAST)
        .then(() => true, () => false)
      if (got) break
    }
    expect(await guest<string>(page, 'getSelection().toString().trim()')).toBe(P1_LAST)
    await expect.poll(() => guest(page, `document.getElementById('cn-clip-host')?.style.display`)).toBe('block')
    const ex = await guest<{ x: number; y: number }>(page, `(() => { const b = document.getElementById('cn-clip-host').shadowRoot.querySelector('button.ex').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 } })()`)
    await page.mouse.click(w.x + ex.x, w.y + ex.y)
    const dlg = page.getByRole('dialog', { name: '记到哪篇' })
    await expect(dlg).toBeVisible()
    await shot(run, '记到哪篇')
    await dlg.getByRole('button', { name: /记到这篇/ }).click()
    const link = `[2.2.1 读取数据集 ↩](${fragmentUrl(site.pandas, P1_LAST)})`
    // 等这一问答完（回答下面「已记进」或出错的一句），答不出来时把右栏 AI 里看得到的字打出来
    const ai = page.getByRole('complementary', { name: '边读边问 AI' })
    const ok = await expect
      .poll(() => editorText(page), { timeout: 4 * 60_000, intervals: [2000] })
      .toContain(link)
      .then(() => true, () => false)
    if (!ok) {
      await shot(run, '没写进去')
      console.log('右栏 AI 里：\n' + (await ai.innerText().catch(() => '(看不到 AI 那一格)')))
    }
    expect(ok).toBe(true)
    const md = await editorText(page)
    const block = md.slice(md.indexOf('> [!ai] 讲解一下'))
    console.log('写进那篇的一块：\n' + block)
    expect(block).toMatch(/^> \[!ai\] 讲解一下 · (Claude Code|Codex)[^\n]* · \[2\.2\.1 读取数据集 ↩\]/)
    expect(block).toContain(`> > ${P1_LAST}`)
    expect(block.split('\n').slice(3).join('').length).toBeGreaterThan(30)
    expect(md).toContain(`read-along: ${site.base}/`)
    await expect.poll(() => readFileSync(join(vault, NOTE), 'utf8'), { timeout: 15_000 }).toContain(link)
    await shot(run, '写进那篇')
    // 网页滚走，点块头的「↩」：网页回到那几句、亮一下
    await guest(page, 'window.scrollTo(0, document.body.scrollHeight)')
    const at = await pane(page)
      .locator('.cm-content')
      .evaluate((root) => {
        const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        while (tw.nextNode()) {
          const n = tw.currentNode as Text
          const i = n.data.indexOf('2.2.1 读取数据集 ↩')
          if (i < 0) continue
          const r = document.createRange()
          r.setStart(n, i)
          r.setEnd(n, i + 5)
          n.parentElement?.scrollIntoView({ block: 'center' })
          const b = r.getBoundingClientRect()
          return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
        }
        return null
      })
    expect(at).not.toBeNull()
    await page.mouse.click(at!.x, at!.y)
    await expect.poll(() => guest<boolean>(page, `(() => { const r = document.getElementById('p1').getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight * 0.6 })()`)).toBe(true)
    await expect.poll(() => guest<number>(page, `document.getElementById('cn-mark-host')?.shadowRoot?.querySelectorAll('.flash').length ?? 0`)).toBeGreaterThan(0)
    await shot(run, '回到那几句')
  } finally {
    forgetSessions(run)
    forgetCodex(run, since)
    await run.close()
  }
})
