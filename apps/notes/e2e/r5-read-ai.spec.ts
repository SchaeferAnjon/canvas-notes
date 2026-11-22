/**
 * 发版前第 5 轮（实用 · 读与 AI）找出来的问题：每条一个测试，真按、真点。
 * - 梦游「全部收下」时开着的笔记既被挪走又被补双链：标签跟到新路径、显示收下后的内容，接着打的字存进新文件；
 *   保存一直没成功时底栏如实说，退出时不当「存完」。
 * - 第一次去网站时拦广告规则来得慢、取不到：第一页最多等 3 秒，等的时候地址栏留着网址、在转圈；取不到先放行这一页（不拦），下一页再用规则；
 *   取规则卡住、失败后，之后的网页都不等。
 * - ⌘K 打纯数字（3.14、版本号）不当网址：正文里有它的笔记回车就开，⌘↵ 拿它去网页搜，不去连 3.0.0.14。
 * - 收下归类后在外面改名、同时添了几句，再撤回：说「改名成了」，不说「被删了」。
 */
import { expect, test, type Page } from '@playwright/test'
import { chmodSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { acts, editorText, launch, leftView, openNote, pane, rail, tabOn, type Running } from './app'
import { DREAM_VAULT } from './fixtures/dream'
import { burst, launchCounted, netMark, netSince, proxyLog, tempHome } from './net'
import { shotTone, shotWindow } from './shots'

// ---------------------------------------------------------------- 梦游全部收下：开着的那篇跟过去

const dreamPanel = (page: Page) => page.getByRole('complementary', { name: '梦游报告' })
const saveState = (page: Page) => acts(page).getByTestId('save-state')
const allFiles = (root: string) => {
  const out: string[] = []
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === '.canvas-notes') continue
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else out.push(p.slice(root.length + 1))
    }
  }
  walk(root)
  return out.sort()
}
const withText = (root: string, s: string) => allFiles(root).filter((f) => readFileSync(join(root, f), 'utf8').includes(s))

async function recordToasts(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { toasts: string[] }
    w.toasts = []
    new MutationObserver(() => {
      const t = (document.querySelector('[data-testid="toast"]') as HTMLElement | null)?.innerText ?? ''
      if (t && !w.toasts.includes(t)) w.toasts.push(t)
    }).observe(document.body, { subtree: true, childList: true, characterData: true })
  })
  return () => page.evaluate(() => (window as unknown as { toasts: string[] }).toasts)
}
async function dreamNow(page: Page) {
  await leftView(page, '梦游报告')
  await dreamPanel(page).getByRole('button', { name: '现在梦游' }).click()
  await expect(dreamPanel(page).getByTestId('dream-summary')).toContainText('整理了', { timeout: 60_000 })
}
async function typeAtEnd(page: Page, text: string) {
  await pane(page).locator('.cm-content').click()
  await page.keyboard.press('Meta+End')
  await page.keyboard.type(text)
}
async function quit(run: Running) {
  const proc = run.app.process()
  const done = new Promise<void>((res) => proc.once('exit', () => res()))
  await run.app.evaluate(({ app }) => app.quit()).catch(() => undefined)
  await done
}

for (const when of ['后台', '当前'] as const)
  test(`梦游「全部收下」：《极光》既挪走又补双链、收下时是${when}标签：标签跟到新路径、显示收下后的内容，打的字存进新文件，退出后还在`, async () => {
    const run = await launch({ ...DREAM_VAULT }, { CN_AI_FAKE: '1' })
    const { page, vault } = run
    try {
      await shotTone(page)
      const toasts = await recordToasts(page)
      await openNote(page, '极光')
      await openNote(page, '冰洞')
      await dreamNow(page)
      // 《极光》在报告里两条：从收件箱挪来、补上 [[极光预报]]
      await expect(dreamPanel(page).getByTestId('dream-item').filter({ hasText: /^极光/ })).toHaveCount(2)
      if (when === '当前') await page.locator('.tab', { hasText: '极光' }).first().click()
      await dreamPanel(page).getByRole('button', { name: '全部收下' }).click()
      await expect(page.getByTestId('toast')).toContainText('剩下的都收下了')
      await expect.poll(() => existsSync(join(vault, '收件箱/极光.md'))).toBe(false)
      const moved = join(vault, '剪藏/旅行/极光.md')
      expect(readFileSync(moved, 'utf8')).toContain('[[极光预报]]')
      await page.locator('.tab', { hasText: '极光' }).first().click()
      await expect(tabOn(page)).toHaveText('极光')
      // 标签跟到新位置
      await expect(pane(page)).toHaveAttribute('data-path', '剪藏/旅行/极光.md')
      // 编辑器里是收下后的内容（带补上的双链）
      await expect.poll(() => editorText(page)).toContain('[[极光预报]]')
      await typeAtEnd(page, '收下以后打的。')
      await expect(saveState(page)).toHaveAttribute('data-state', 'saved', { timeout: 10_000 })
      expect(readFileSync(moved, 'utf8')).toMatch(/\[\[极光预报\]\][\s\S]*收下以后打的。/)
      expect(existsSync(join(vault, '收件箱/极光.md'))).toBe(false)
      // 软件自己挪的、改的：不说「在外面」「外部改动」
      expect((await toasts()).filter((t) => /在外面|外部改动|不在了/.test(t))).toEqual([])
      await shotWindow(run, `r5-dream-takeall-follow-${when === '后台' ? 'bg' : 'active'}`)
      await quit(run)
      expect(withText(vault, '收下以后打的。')).toEqual(['剪藏/旅行/极光.md'])
      expect(readFileSync(join(run.userData, 'quit.log'), 'utf8')).toMatch(/存完/)
    } finally {
      await run.close().catch(() => undefined)
    }
  })

// 第 6 轮重做：原文件写不进去时另存成一篇，编辑器从此指向那篇（只有一个落盘目标）；哪都写不进去的情形见 r6-read-ai.spec.ts
test('保存一直没成功（文件写不进去）：字另存成一篇，标签换到那篇、标明原文件写不进去；底栏不说「都提交了」；退出时字在另存那篇里', async () => {
  const run = await launch({ '随手记.md': '# 随手记\n\n正文。\n' }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  const file = join(vault, '随手记.md')
  try {
    await shotTone(page)
    await openNote(page, '随手记')
    await expect(page.getByTestId('git-changed')).toHaveText('都提交了')
    // 像别的程序把这个文件锁成只读：写不进去
    chmodSync(file, 0o444)
    await typeAtEnd(page, '写不进去的字。')
    const toast = page.getByTestId('toast')
    await expect(toast).toContainText('「随手记」写不进去：文件不让写（可能锁成了只读）。字另存成了「随手记（没存上的字', { timeout: 10_000 })
    // 打的字另存成了一篇，库里找得到；原文件一字不动
    await expect.poll(() => withText(vault, '写不进去的字。').length, { timeout: 10_000 }).toBe(1)
    expect(readFileSync(file, 'utf8')).toBe('# 随手记\n\n正文。\n')
    // 另存的那篇左栏列得出来，名字里的时间是「16-43」
    await expect(page.locator('aside.side .nav .si', { hasText: /没存上的字 \d\d-\d\d/ })).toHaveCount(1)
    // 标签换到另存那篇，标明原文件写不进去；字已经在那篇里了
    await expect(tabOn(page)).toHaveText(/随手记（没存上的字 \d\d-\d\d）/)
    await expect(acts(page).getByTestId('page-note')).toHaveText('原文件写不进去，字在这里')
    await expect(saveState(page)).toHaveAttribute('data-state', 'saved')
    await expect(page.getByTestId('git-changed')).not.toHaveText('都提交了')
    await shotWindow(run, 'r5-save-failed')
    await expect.poll(() => editorText(page)).toContain('写不进去的字。')
    await quit(run)
    expect(withText(vault, '写不进去的字。')).toEqual([expect.stringMatching(/^随手记（没存上的字 \d\d-\d\d）\.md$/)])
    expect(readFileSync(join(run.userData, 'quit.log'), 'utf8')).toMatch(/存完（原文件写不进去，字在另存的那篇/)
  } finally {
    if (existsSync(file)) chmodSync(file, 0o644)
    await run.close().catch(() => undefined)
  }
})

// ---------------------------------------------------------------- 拦广告规则来得慢、取不到

let srv: Server
let base = ''
test.beforeAll(async () => {
  srv = createServer((req, res) => {
    const u = req.url ?? ''
    const rules = '[Adblock Plus 2.0]\n/adframe/banner.js$script\n##.ad-banner\n'
    // 15 秒才回的规则
    if (u === '/slow.txt') return void setTimeout(() => res.writeHead(200, { 'content-type': 'text/plain' }).end(rules), 15_000)
    // 一直不回（像连不上 GitHub）
    if (u === '/hang.txt') return
    if (u === '/resources.json') return res.writeHead(200, { 'content-type': 'application/json' }).end('{}')
    if (u === '/adframe/banner.js') return res.writeHead(200, { 'content-type': 'text/javascript' }).end('window.__ad = 1')
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<title>旅行杂志</title><body style="font:16px sans-serif;padding:20px">
      <div class="ad-banner" id="ad" style="height:90px;background:#fc0">广告位</div><p>冰岛南岸的黑沙滩。</p><script src="/adframe/banner.js"></script></body>`)
  })
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`
})
test.afterAll(() => srv.close())

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const guest = <T = unknown>(page: Page, code: string): Promise<T> =>
  page.evaluate((c) => {
    const w = document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> } | null
    try {
      return w ? w.executeJavaScript(c).catch(() => null) : null
    } catch {
      return null
    }
  }, code) as Promise<T>
const ads = (page: Page) => guest<string>(page, `(window.__ad ? '脚本' : '') + '|' + (getComputedStyle(document.getElementById('ad')).display === 'none' ? '' : '广告位')`)
/** 地址栏打网址回车，到网页载完（readyState complete、地址对上）用了多少毫秒 */
async function visit(page: Page, u: string, during?: () => Promise<void>): Promise<number> {
  const addr = web(page).getByRole('textbox', { name: '网址' })
  await addr.fill(u)
  const t = Date.now()
  await addr.press('Enter')
  await during?.()
  await expect.poll(() => guest(page, 'document.readyState + "|" + location.href'), { timeout: 30_000, intervals: [50] }).toBe(`complete|${u}`)
  return Date.now() - t
}
const adState = (page: Page) => page.evaluate(() => window.cnPlugins.call<{ state: string }>('adblock', 'status')).then((s) => s.state)

test('拦广告规则 15 秒才回：第一页最多等 3 秒就出来、这一页不拦；等的时候地址栏留着网址、在转圈；规则到了下一页就拦', async () => {
  test.setTimeout(90_000)
  const start = proxyLog.length
  const run = await launchCounted({ 'a.md': '# a\n' }, { ...tempHome(), CN_ADBLOCK_LISTS: `${base}/slow.txt`, CN_ADBLOCK_RESOURCES: `${base}/resources.json` })
  const { page } = run
  try {
    await shotTone(page)
    await rail(page).getByRole('button', { name: '网页', exact: true }).click()
    await expect(web(page)).toBeVisible()
    await page.waitForTimeout(1500)
    const ms = await visit(page, `${base}/one`, async () => {
      await page.waitForTimeout(1000)
      // 等规则的这会儿：地址栏还是打的网址，重新载入的图标在转
      await expect(web(page).getByRole('textbox', { name: '网址' })).toHaveValue(new RegExp(`127\\.0\\.0\\.1:\\d+/one`))
      await expect(web(page).getByRole('button', { name: '重新载入' }).locator('.spin')).toBeVisible()
      // 标签名先写主机名，不停在「新网页」：task-sta8n 起当前标签就是地址块，去网址的路上露着的就是打的网址（主机名打头），不盖标题那一层
      await expect(web(page).locator('.tab.on .addr')).not.toHaveClass(/\bdisp\b/)
      await expect(web(page).locator('.tab.on')).not.toContainText('新网页')
      await shotWindow(run, 'r5-adblock-waiting')
    })
    expect(ms, `第一页 ${ms} ms`).toBeLessThan(4500)
    // 没等到规则：这一页不拦（广告脚本跑了、广告位在）
    await expect.poll(() => ads(page)).toBe('脚本|广告位')
    // 规则到了：下一页拦住
    await expect.poll(() => adState(page), { timeout: 30_000 }).toBe('ok')
    const ms2 = await visit(page, `${base}/two`)
    expect(ms2).toBeLessThan(2000)
    await expect.poll(() => ads(page)).toBe('|')
    // 全程没对外连（规则、resources 都是本机的）
    expect(proxyLog.slice(start)).toEqual([])
  } finally {
    await run.close()
  }
})

test('拦广告规则一直不回（像连不上 GitHub）：第一页最多等 3 秒，后面的网页一页都不等', async () => {
  test.setTimeout(90_000)
  const run = await launchCounted({ 'a.md': '# a\n' }, { ...tempHome(), CN_ADBLOCK_LISTS: `${base}/hang.txt`, CN_ADBLOCK_RESOURCES: `${base}/resources.json` })
  const { page } = run
  try {
    await rail(page).getByRole('button', { name: '网页', exact: true }).click()
    await expect(web(page)).toBeVisible()
    await page.waitForTimeout(1500)
    const ms1 = await visit(page, `${base}/one`)
    expect(ms1, `第一页 ${ms1} ms`).toBeLessThan(4500)
    expect(await adState(page)).toBe('loading')
    for (const p of ['two', 'three']) {
      const ms = await visit(page, `${base}/${p}`)
      expect(ms, `${p} ${ms} ms`).toBeLessThan(1500)
    }
  } finally {
    await run.close()
  }
})

// ---------------------------------------------------------------- ⌘K 打数字

test('⌘K 打「3.14」「3.1415926」「2.0」：不当网址，正文里有它的笔记回车就开、0 个对外请求；⌘↵ 拿它去网页搜，不去连 3.0.0.14', async () => {
  test.setTimeout(180_000)
  const run = await launchCounted(
    {
      '圆周率.md': '# 圆周率\n\nπ 约等于 3.14，背到 3.1415926。\n',
      '发版.md': '# 发版\n\n下一版是 2.0，再下一版 1.5 的补丁不出了。\n',
      '随手记.md': '# 随手记\n\n正文。\n',
    },
    { CN_AI_FAKE: '1', ...tempHome() },
  )
  const { page } = run
  const pal = page.getByRole('dialog', { name: '搜索和命令' })
  try {
    await shotTone(page)
    await expect.poll(() => page.evaluate(() => (window as unknown as { cnSearch: { status(): Promise<{ phase: string }> } }).cnSearch.status().then((s) => s.phase)), { timeout: 120_000 }).toBe('ready')
    for (const [word, note] of [
      ['3.14', '圆周率'],
      ['3.1415926', '圆周率'],
      ['2.0', '发版'],
    ] as const) {
      await page.keyboard.press('Meta+k')
      await pal.getByRole('textbox').waitFor()
      const mark = await netMark(run)
      await burst(run, word, [])
      await page.waitForTimeout(1200)
      await expect(pal, word).not.toContainText('去网页打开')
      await expect(pal.locator('.pal-row.on'), word).toContainText(note)
      if (word === '3.14') await shotWindow(run, 'r5-palette-number')
      await page.keyboard.press('Enter')
      await expect(tabOn(page), word).toHaveText(note)
      expect(await netSince(run, mark), word).toEqual([])
    }
    // ⌘↵：拿 3.14 去网页搜（右栏开的是搜索），不当网址去连 3.0.0.14
    await page.keyboard.press('Meta+k')
    await pal.getByRole('textbox').waitFor()
    await burst(run, '3.14', [])
    await page.waitForTimeout(1200)
    const mark = await netMark(run)
    await page.keyboard.press('Meta+Enter')
    await expect.poll(async () => (await netSince(run, mark)).join(' '), { timeout: 10_000 }).toContain('search?q=3.14')
    expect((await netSince(run, mark)).filter((s) => s.includes('3.0.0.14'))).toEqual([])
  } finally {
    await run.close()
  }
})

// ---------------------------------------------------------------- 收下后在外面改名又加字，再撤回

test('收下《冰洞》后在外面改名成「冰岛冰洞」、同时添两句，再点「撤回」：说「改名成了「冰岛冰洞」」，不说「被删了」；文件还在、库干净', async () => {
  const run = await launch({ ...DREAM_VAULT }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await shotTone(page)
    await dreamNow(page)
    await dreamPanel(page).getByTestId('dream-item').filter({ hasText: /^冰洞\s*从/ }).click()
    await dreamPanel(page).getByTestId('dream-detail').getByRole('button', { name: '收下', exact: true }).click()
    // 收下的提示在底栏，带「在历史里看」「撤回」（task-m552v：不再有中间上浮的预览提示条）
    const pv = page.getByTestId('toast')
    await expect(pv).toContainText('收下了「冰洞」')
    const taken = join(vault, '剪藏/旅行/冰洞.md')
    await expect.poll(() => existsSync(taken)).toBe(true)
    // 像在访达里改名、再用别的编辑器添两句
    const renamed = join(vault, '剪藏/旅行/冰岛冰洞.md')
    writeFileSync(renamed, readFileSync(taken, 'utf8') + '\n去之前看天气预报，零下十度要穿雪地靴。\n导游会给冰爪和头盔，不用自己带。\n')
    rmSync(taken)
    await page.waitForTimeout(2500)
    await pv.getByRole('button', { name: /撤回/ }).click()
    await expect(page.getByTestId('toast')).toContainText('撤回不了：「冰洞」收下以后改名成了「冰岛冰洞」，什么都没动')
    await expect(page.getByTestId('toast')).not.toContainText('被删了')
    await shotWindow(run, 'r5-dream-undo-renamed-edited')
    expect(existsSync(renamed)).toBe(true)
    expect(execFileSync('git', ['-C', vault, 'status', '--porcelain'], { encoding: 'utf8' })).toBe('')
  } finally {
    await run.close()
  }
})
