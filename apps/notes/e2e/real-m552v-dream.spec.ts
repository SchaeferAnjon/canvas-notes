// 用本机真的 AI 命令行梦游一次（task-m552v），在照用户样子造的临时库上（PDF 和它的笔记、以前做的可视化 HTML、剪藏、收件箱里几篇），
// 从头走一遍梦游报告：点条目、对照（历史那一套）里展开、打开「文件名」、收下、丢掉、撤回、笔记里嵌着的可视化能拖。
// 要联网、花一点额度，平时跳过：
//   env -i HOME="$HOME" USER="$USER" LOGNAME="$LOGNAME" PATH="$PATH" TMPDIR="$TMPDIR" ANTHROPIC_API_KEY="$(dispatch env get CN_TEST_ANTHROPIC_API_KEY)" CN_REAL_AI=1 npx playwright test e2e/real-m552v-dream.spec.ts
// （在 Claude Code 的终端里跑要像上面这样去掉父会话的 CLAUDE_* 环境变量；用测试的 API key，不占订阅的每周额度，key 只在运行时读；
// 没有 key 时换成登录过的 CLAUDE_CONFIG_DIR）。测试模式、临时库、临时设置目录；梦游用 Claude Code · Sonnet · Low。
// Claude Code 额度用完时 CN_REAL_ENGINE=codex 换 Codex（它的默认模型 · Low）走同一遍。
// 截图在 CN_SHOTS（给了的话）；跑完只删这次产生的会话记录（~/.claude 下按临时库起名的、~/.codex/sessions 里写着临时库路径的）。
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { acts, gitStatus, launch, leftView, tabOn, type Running } from './app'
import { COURSE, DREAM2_VAULT, NOTE, prepareDream2 } from './fixtures/dream2'

test.skip(!process.env.CN_REAL_AI, '真 AI 才跑：CN_REAL_AI=1')
test.setTimeout(20 * 60_000)

const SHOTS = process.env.CN_SHOTS
const git = (vault: string, ...args: string[]) => execFileSync('git', ['-C', vault, '-c', 'core.quotepath=false', ...args], { encoding: 'utf8' }).trim()

async function shot(run: Running, name: string) {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  await run.page.waitForTimeout(500)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(b64, 'base64'))
}

/** 这次在 Claude 设置目录（CLAUDE_CONFIG_DIR，没给是 ~/.claude）下留的会话记录：projects 下按临时库路径起名的文件夹，和这几个会话号在 session-env、file-history、todos、tasks 下的 */
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

/** 这次 Codex 留的会话记录：~/.codex/sessions 下这次跑的时候写的、内容里有临时库路径的那几份 */
function forgetCodexSessions(run: Running, since: number) {
  const root = join(homedir(), '.codex', 'sessions')
  if (!existsSync(root)) return
  const stamp = dirname(run.vault)
  const gone: string[] = []
  const walk = (dir: string) => {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, d.name)
      if (d.isDirectory()) walk(p)
      else if (d.name.endsWith('.jsonl') && statSync(p).mtimeMs >= since && readFileSync(p, 'utf8').includes(stamp)) {
        rmSync(p)
        gone.push(d.name)
      }
    }
  }
  walk(root)
  console.log(`删掉了这次的 Codex 会话记录：${gone.join('、') || '（没有）'}`)
}

const ENGINE = process.env.CN_REAL_ENGINE === 'codex' ? 'codex' : 'claude'

/** 以前做过的一张可视化：笔记第 1 页那段脚上一行链接（以前的写法，不自动改），目录树里挂在笔记下面 */
const OLD_VIZ = `${COURSE}/五个信号.html`
const OLD_HTML = '<!doctype html><html><head><meta charset="utf-8"><title>五个信号 · 点一下看波形</title><meta name="类型" content="可视化"></head><body><h1>五个信号</h1><input type="range" aria-label="时间" min="0" max="120" value="10"></body></html>'

const item = (panel: ReturnType<Page['getByRole']>, t: string | RegExp) => panel.getByTestId('dream-item').filter({ hasText: t })

test(`真 AI（${ENGINE === 'codex' ? 'Codex' : 'Claude Code'}）梦游一次，从头走一遍报告：点条目、对照、展开、打开、收下、丢掉、撤回、嵌着的可视化能拖`, async () => {
  const since = Date.now()
  const run = await launch(DREAM2_VAULT, { CN_AI_MODEL: 'sonnet' }, (vault) => {
    prepareDream2(vault)
    // 以前做的可视化：第 1 页那段脚上一行链接
    writeFileSync(join(vault, OLD_VIZ), OLD_HTML)
    const note = readFileSync(join(vault, NOTE), 'utf8').replace(/(## 第 1 页 · 这篇在做什么[\s\S]*?)(\n## 第 2 页)/, '$1\n[可视化 · 五个信号 · 点一下看波形](五个信号.html)\n$2')
    writeFileSync(join(vault, NOTE), note)
    // 梦游用 Claude Code · Sonnet · Low（或 Codex 默认模型 · Low）
    const ai = join(dirname(vault), 'user-data', 'ai')
    mkdirSync(ai, { recursive: true })
    const pick = ENGINE === 'codex' ? { engine: 'codex', effort: 'low' } : { engine: 'claude', model: 'sonnet', effort: 'low' }
    writeFileSync(join(ai, 'settings.json'), JSON.stringify({ engine: ENGINE, prefs: { default: pick, features: { dream: pick, chat: pick, quick: pick } } }))
  })
  const { page, vault } = run
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    const works = readFileSync(join(vault, '所思所想.md'), 'utf8')
    const card = page.getByTestId('dream-card')
    await card.getByRole('button', { name: '现在梦游' }).click()
    await expect(card.locator('h3')).toContainText('等你过目', { timeout: 15 * 60_000 })
    const report = (await page.evaluate(() => window.cn.dreamReport()))!
    console.log('梦游出来的：' + report.items.map((i) => `${i.group}|${i.title}|${i.sub}`).join('\n'))
    console.log('说明：' + report.notes.join('；'))
    // 真 AI 都答完了（额度用完、没登录时这里就停，不当成过了）；归类和可视化是这个库一定有的两样
    expect(report.notes.filter((n) => /没答完|没登录|出错/.test(n)), 'AI 没答完').toEqual([])
    expect(report.items.some((i) => i.group === 'viz'), '没做出可视化').toBe(true)
    expect(report.items.some((i) => i.group === 'file'), '收件箱没归类').toBe(true)
    await card.getByRole('button', { name: '看报告' }).click()
    const panel = page.getByRole('complementary', { name: '梦游报告' })
    const dt = page.locator('[data-testid="dream-tab"]:not([hidden])')
    // 看报告：中间开第一条没处理的；顶上进度一条一格
    await expect(dt.getByTestId('dream-k')).toHaveText(new RegExp(`第1条，共${report.items.length}条$`))
    await expect(panel.getByTestId('dream-progress').locator('button')).toHaveCount(report.items.length)
    await shot(run, 'real-01-report')

    // 可视化那条（真 AI 做出来才有）：笔记的对照、HTML 就是那张图、收下、笔记里嵌着能拖
    const viz = report.items.find((i) => i.group === 'viz')
    if (viz) {
      await item(panel, viz.title).click()
      await expect(dt.getByTestId('dream-fbar')).toContainText('笔记')
      await expect(dt.locator('.cm-merge-b .cm-changedLine').first()).toBeVisible()
      await shot(run, 'real-02-viz-note')
      await dt.getByTestId('dream-file').filter({ hasText: '.html' }).click()
      await expect(dt.locator('[data-testid="viz-frame"]')).toBeVisible()
      await expect(dt.getByTestId('dream-open')).toContainText('梦游分支上的')
      await shot(run, 'real-03-viz-html')
      await dt.getByRole('button', { name: '收下', exact: true }).click()
      await expect(item(panel, viz.title)).toContainText('已收下', { timeout: 60_000 })
      const md = readFileSync(join(vault, NOTE), 'utf8')
      expect(md).toMatch(/\n!\[可视化 · [^\]]+\]\([^)]+\.html\)\n/)
      expect(md).toContain('[可视化 · 五个信号 · 点一下看波形](五个信号.html)')
      // 打开笔记：嵌着的可视化是一块能拖的图
      await item(panel, viz.title).click()
      await dt.getByTestId('dream-file').first().click()
      await dt.getByTestId('dream-open').click()
      await expect(tabOn(page)).toContainText('笔记')
      const embed = page.locator('.pane:not([hidden]) .cm-viz').filter({ hasText: viz.title.split(' · ')[0] ?? '' })
      await embed.first().scrollIntoViewIfNeeded()
      await expect(embed.first().locator('.vz-badge')).toHaveText('能拖')
      await shot(run, 'real-05-note-embed')
      // 目录树：PDF › 笔记 › 两张可视化
      await leftView(page, '文件')
      const tree = page.getByRole('tree', { name: '全部文件' })
      const folder = tree.locator(`[data-path="${COURSE}"]`)
      if ((await folder.getAttribute('aria-expanded')) !== 'true') await folder.getByRole('button', { name: `展开 ${COURSE.split('/').pop()}` }).click()
      await expect(tree.locator(`[data-path="${NOTE}"] .truncate`)).toHaveText('笔记')
      await expect(tree.locator(`[data-path="${OLD_VIZ}"]`)).toBeVisible()
      await shot(run, 'real-06-tree')
      await leftView(page, '梦游报告')
    }

    // 补双链那条：末尾那一行；折起的「展开没改的 N 行」一下就开
    const link = report.items.find((i) => i.group === 'link' && i.state === 'pending')
    if (link) {
      await item(panel, link.title).first().click()
      await expect(dt.locator('.cm-merge-b .cm-changedLine').first()).toBeVisible()
      const fold = dt.locator('.cm-merge-b .cm-collapsedLines').first()
      if (await fold.count()) {
        const n = await dt.locator('.cm-merge-b .cm-collapsedLines').count()
        await fold.click()
        await expect(dt.locator('.cm-merge-b .cm-collapsedLines')).toHaveCount(n - 1)
      }
      await shot(run, 'real-07-link')
    }

    // 归类那条：挪动那一块；丢掉，再撤回；再收下
    const file = report.items.find((i) => i.group === 'file' && i.state === 'pending')
    if (file) {
      await item(panel, file.title).first().click()
      await expect(dt.getByTestId('dream-move')).toBeVisible()
      await shot(run, 'real-08-file')
      await dt.getByRole('button', { name: '不要', exact: true }).click()
      await expect(item(panel, file.title).first()).toContainText(/已丢掉|留在收件箱/)
      await item(panel, file.title).first().click()
      await dt.getByRole('button', { name: '撤回' }).click()
      await expect(dt.getByRole('button', { name: '收下', exact: true })).toBeVisible()
      await dt.getByRole('button', { name: '收下', exact: true }).click()
      await expect(item(panel, file.title).first()).toContainText('已收下', { timeout: 60_000 })
      // 收下后往下走一条（不跳回第一条）
      await shot(run, 'real-09-after-take')
    }
    expect(gitStatus(vault)).toBe('')
    // 自己写的作品一个字节不变
    expect(readFileSync(join(vault, '所思所想.md'), 'utf8')).toBe(works)
    console.log('最近几次提交：\n' + git(vault, 'log', '-6', '--format=%h %s'))
  } finally {
    await run.close()
    forgetSessions(run)
    forgetCodexSessions(run, since)
  }
})
