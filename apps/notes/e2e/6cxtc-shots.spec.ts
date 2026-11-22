// 对照截图（task-6cxtc，设计稿 /private/tmp/canvas-notes-visual/11-选中小条/）：四处选中后的小条、剪藏的悬停提示、⋯ 菜单、引用攒成 ①②、
// 网页的笔记写进那篇和网页上的小标、记到哪篇、右栏「笔记」标签（摆法 B）。天青 / 深湖 × B / A，1440 × 887 窗口，真软件、临时库、假 AI、本机假网页。
// 只在给了 CN_SHOTS=<目录> 时跑：CN_SHOTS=/private/tmp/canvas-notes-build4/6cxtc/shots npx playwright test e2e/6cxtc-shots.spec.ts
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, openNote, pane, rail, type Running, tabOn, webAboveAi, widenRight } from './app'
import { d2l, type D2l, P1_LAST, P2_PART } from './fixtures/d2l-pandas'
import { LECTURE } from './fixtures/pdf'
import { clipMarkdown } from '../src/shared/layout'
import { fragmentUrl } from '../src/shared/web-link'
import { webAskBlock } from '../src/shared/web-notes'

const DIR = process.env.CN_SHOTS
test.skip(!DIR, '对照截图：CN_SHOTS=<目录> 才跑')
test.setTimeout(240_000)

const LOOKS = [
  ['sky', 'b'],
  ['petrol', 'b'],
  ['sky', 'a'],
  ['petrol', 'a'],
] as const

const NOTE = '课程/学习笔记：动手学深度学习.md'
const TITLE = '学习笔记：动手学深度学习'
const P1_FIRST = '举一个例子，我们首先创建一个人工数据集，并存储在CSV（逗号分隔值）文件 ../data/house_tiny.csv中。'

let site: D2l
test.beforeAll(async () => {
  site = await d2l()
})
test.afterAll(() => site.close())

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
function guest<T = unknown>(page: Page, code: string): Promise<T> {
  return page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code) as Promise<T>
}

async function shot(run: Running, name: string) {
  await run.page.waitForTimeout(450)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(DIR!, `${name}.png`), Buffer.from(b64, 'base64'))
}

async function openWeb(page: Page, u: string) {
  if (!(await web(page).isVisible())) await rail(page).getByRole('button', { name: '网页', exact: true }).click()
  const addr = web(page).getByRole('textbox', { name: '网址' })
  await addr.click()
  await addr.fill(u)
  await addr.press('Enter')
  await expect.poll(() => guest(page, 'document.readyState + "|" + location.href')).toBe(`complete|${u}`)
}

/** 网页 #id 里从 from 拖到 to（真拖）；小条出来 */
async function selectIn(page: Page, id: string, from: string, to: string) {
  for (let i = 0; i < 3; i++) {
    const w = (await web(page).locator('webview.on').boundingBox())!
    const pts = await guest<number[]>(
      page,
      `(() => { const t = document.getElementById(${JSON.stringify(id)}).firstChild; const s = t.data.indexOf(${JSON.stringify(from)}), e = t.data.indexOf(${JSON.stringify(to)}, s) + ${to.length}; const r = document.createRange(); r.setStart(t, s); r.setEnd(t, e); const rs = r.getClientRects(), f = rs[0], l = rs[rs.length - 1]; return [f.left + 1, f.top + f.height / 2, l.right - 1, l.top + l.height / 2] })()`,
    )
    await page.mouse.move(w.x + pts[0]!, w.y + pts[1]!)
    await page.mouse.down()
    await page.mouse.move(w.x + pts[2]!, w.y + pts[3]!, { steps: 8 })
    await page.mouse.up()
    if (await expect.poll(() => guest(page, `document.getElementById('cn-clip-host')?.style.display`), { timeout: 1500 }).toBe('block').then(() => true, () => false)) return
  }
}

async function barPoint(page: Page, sel: string) {
  const w = (await web(page).locator('webview.on').boundingBox())!
  const p = await guest<{ x: number; y: number }>(page, `(() => { const b = document.getElementById('cn-clip-host').shadowRoot.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 } })()`)
  return { x: w.x + p.x, y: w.y + p.y }
}

/** 那篇里先写好三条（剪藏、讲解一下、你问），同设计稿「建议：写进正在剪进去的那篇」 */
function notesDoc(base: string, pandas: string) {
  const clip = clipMarkdown(P1_FIRST, '2.2.1 读取数据集 · 动手学深度学习', fragmentUrl(pandas, P1_FIRST))
  const explain = webAskBlock({
    label: '讲解一下',
    by: 'Claude Code · Opus 5.5',
    links: [{ text: '2.2.1 读取数据集 ↩', url: fragmentUrl(pandas, P1_LAST) }],
    quotes: [P1_LAST],
    answer: '这段在准备练习用的数据：先在上一级目录建 data 文件夹，再把 4 行房价数据按 CSV 写进 house_tiny.csv。CSV 每行一条记录、逗号隔开各列，后面用 pandas 的 read_csv 一行就能读回来。',
  })
  const asked = webAskBlock({
    label: '你问：插值法和删除法各适合什么时候？',
    by: 'Claude Code · Opus 5.5',
    links: [{ text: '2.2.2 处理缺失值 ↩', url: fragmentUrl(pandas, P2_PART) }],
    quotes: [P2_PART],
    answer: '缺得少、缺得随机时用插值（拿同一列的均值补上），样本一条不丢；某一列大半都缺、或者「缺」本身有含义时，直接删掉那一列或那几行更干净。',
  })
  return `---\nread-along: ${base}/\n---\n# ${TITLE}\n\n## 2.2 数据预处理\n\n先把数据读进来，再处理缺失值。\n\n${clip}\n\n${explain}\n\n我的理解：先造一个小表，后面几节都拿它练。\n\n${asked}\n`
}

for (const [skin, frame] of LOOKS) {
  test(`对照图：${skin} · ${frame}`, async () => {
    mkdirSync(DIR!, { recursive: true })
    const tag = `${skin}-${frame}`
    const files = { [NOTE]: notesDoc(site.base, site.pandas), '课程/第二章的习题.md': '# 第二章的习题\n\n第一题。\n', '课程/读论文.md': '# 读论文\n\n先把数据读进来，再处理缺失值。\n', '课程/线代/第3讲.pdf': LECTURE }
    const run = await launch(files, { CN_AI_FAKE: '1' }, (vault) => {
      const ud = join(dirname(vault), 'user-data')
      mkdirSync(ud, { recursive: true })
      writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin, frame, winBg: 'aurora' } }))
    })
    const { page } = run
    try {
      await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
      // 右边那几条记的时间（同设计稿 12:45、12:47）
      await page.evaluate(([path, clipLine, explainLine, askLine]) => {
        const d = new Date()
        const at = (h: number, m: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime()
        localStorage.setItem('cn.webNoteAt', JSON.stringify({ [`${path}\n${clipLine}`]: at(12, 45), [`${path}\n${explainLine}`]: at(12, 47), [`${path}\n${askLine}`]: at(12, 52) }))
      }, [NOTE, `—— [2.2.1 读取数据集 · 动手学深度学习](${fragmentUrl(site.pandas, P1_FIRST)})`, `> [!ai] 讲解一下 · Claude Code · Opus 5.5 · [2.2.1 读取数据集 ↩](${fragmentUrl(site.pandas, P1_LAST)})`, `> [!ai] 你问：插值法和删除法各适合什么时候？ · Claude Code · Opus 5.5 · [2.2.2 处理缺失值 ↩](${fragmentUrl(site.pandas, P2_PART)})`])
      await openNote(page, TITLE)
      await openWeb(page, site.pandas)
      await widenRight(page, 270)
      // 挪了布局底栏说「布局记住了」（10 秒）：等它过去，别挡住后面几张该出的那句
      await expect(page.getByTestId('toast')).toHaveCount(0, { timeout: 15_000 })
      // ① 网页选字的小条（选整段）
      await guest(page, `document.getElementById('p1').scrollIntoView({ block: 'center' })`)
      await selectIn(page, 'p1', '举一个例子', '写入CSV文件中。')
      await shot(run, `1-web-bar-${tag}`)
      // ② 指着「剪藏」：提示剪进哪篇
      const clip = await barPoint(page, 'button.clip')
      await page.mouse.move(clip.x, clip.y)
      await expect.poll(() => guest(page, `document.getElementById('cn-clip-host').shadowRoot.querySelector('.tip').style.display`)).toBe('block')
      await shot(run, `1-web-tip-${tag}`)
      // ③ ⋯
      const more = await barPoint(page, 'button.more')
      await page.mouse.click(more.x, more.y)
      await expect.poll(() => guest(page, `document.getElementById('cn-clip-host').shadowRoot.querySelector('.menu').style.display`)).toBe('block')
      await shot(run, `1-web-more-${tag}`)
      await page.mouse.click(more.x, more.y)
      // ④ 网页的笔记写进那篇：网页上的小标和点线（网页滚到 2.2.1）
      await guest(page, 'getSelection().removeAllRanges()')
      await guest(page, `document.getElementById('p1').scrollIntoView({ block: 'start' }); scrollBy(0, -110)`)
      // 鼠标挪到底栏空着的地方（挪到左边图标栏上会出「周记」这类提示）
      await page.mouse.move(430, 880)
      await expect.poll(() => guest<number>(page, `document.getElementById('cn-mark-host')?.shadowRoot?.querySelectorAll('.mk').length ?? 0`)).toBeGreaterThan(0)
      await pane(page).locator('.cm-line', { hasText: '举一个例子' }).first().scrollIntoViewIfNeeded()
      await shot(run, `2-doc-${tag}`)
      // ⑤ 右栏「笔记」：拖到网页下半（摆法 B），点「你问」那一条
      await rail(page).getByRole('button', { name: /^笔记/ }).click()
      await webAboveAi(page)
      const n = page.getByRole('complementary', { name: '笔记', exact: true })
      await n.getByTestId('web-note').first().click()
      await page.waitForTimeout(300)
      await shot(run, `2-notes-b-${tag}`)
      // ⑥ 引用攒成 ①②（AI 在笔记那一组，叠在笔记前面）
      await guest(page, `document.getElementById('p2').scrollIntoView({ block: 'center' })`)
      await selectIn(page, 'p2', '典型的方法', '插值法和删除法')
      const q = await barPoint(page, 'button.qt')
      await page.mouse.click(q.x, q.y)
      await expect(page.getByRole('complementary', { name: '边读边问 AI' }).getByTestId('ai-mat')).toHaveCount(1)
      // AI 叠在网页那一组前面：点「网页」标签回到网页，接着选下一段（同人）
      if (!(await web(page).locator('webview.on').isVisible())) await page.getByTestId('dtab-web').click()
      await guest(page, `document.getElementById('p1').scrollIntoView({ block: 'center' })`)
      await selectIn(page, 'p1', '下面我们将', '写入CSV文件中。')
      const q2 = await barPoint(page, 'button.qt')
      await page.mouse.click(q2.x, q2.y)
      await expect(page.getByRole('complementary', { name: '边读边问 AI' }).getByTestId('ai-mat')).toHaveCount(2)
      await shot(run, `1-quote-${tag}`)
      // ⑦ 还没配对：第一次讲解一下问记到哪篇（另一篇、没配对的网页）
      await openNote(page, '读论文')
      await page.evaluate(() => localStorage.removeItem('cn.webTarget'))
      // 这一篇没配网站：换到另一个网站（同一个假网页，用 localhost 打开算另一个网站）
      if (!(await web(page).isVisible())) await page.getByTestId('dtab-web').click()
      await openWeb(page, site.pandas.replace('127.0.0.1', 'localhost'))
      await guest(page, `document.getElementById('p1').scrollIntoView({ block: 'center' })`)
      await selectIn(page, 'p1', '举一个例子', '写入CSV文件中。')
      const ex = await barPoint(page, 'button.ex')
      await page.mouse.click(ex.x, ex.y)
      await expect(page.getByRole('dialog', { name: '记到哪篇' })).toBeVisible()
      await shot(run, `2-where-${tag}`)
      await page.keyboard.press('Escape')
      // ⑧ PDF 选字的小条和 ⋯
      await page.keyboard.press('Meta+o')
      await page.getByRole('textbox', { name: '按名字跳到文件' }).fill('第3讲')
      await page.keyboard.press('Enter')
      await expect(tabOn(page)).toHaveText('第3讲.pdf')
      const pg = page.locator('.pdfpane:not([hidden]) .pdfpage[data-page="2"]')
      await expect(page.locator('.pdfpane:not([hidden]) .pdfpage[data-page="1"] canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
      const span = pg.locator('.textLayer span', { hasText: 'for every scalar c' })
      await span.scrollIntoViewIfNeeded()
      const sb = (await span.boundingBox())!
      await page.mouse.move(sb.x + 2, sb.y + sb.height / 2)
      await page.mouse.down()
      await page.mouse.move(sb.x + sb.width - 2, sb.y + sb.height / 2, { steps: 6 })
      await page.mouse.up()
      const cap = page.locator('.pdfpane:not([hidden])').getByRole('toolbar', { name: '框好的这块' })
      await expect(cap).toBeVisible()
      await shot(run, `1-pdf-bar-${tag}`)
      await cap.getByRole('button', { name: '更多' }).click()
      await shot(run, `1-pdf-more-${tag}`)
    } finally {
      await run.close()
    }
  })
}
