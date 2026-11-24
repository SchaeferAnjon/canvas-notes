// AI 对话记笔记开关（2026-11-24 方向 A「开关两颗」，design/ai-note-switch）：读 PDF、网页、视频问框，真点。
// 写进去是普通文档（偏好「不要PDF自动笔记样式」）：一页一节「## 第 N 页 · 那页第一行大字」、一问一个「### 问的原话」、框的图、
// 「—— [第 N 页](…)」、一块带「回到 AI 对话」链接的 [!ai]；只往后加，撤回只拿掉那几行；旧配对笔记逐字节不动，新的接在后面。
import { _electron as electron, expect, test, type Locator, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import electronPath from 'electron'
import type { Server } from 'node:http'
import { launch, openAi, openNote, pane, rail, type Running, tabOn, waitSaved, webAboveAi, widenRight } from './app'
import { LECTURE } from './fixtures/pdf'
import { d2l, type D2l, P1_LAST } from './fixtures/d2l-pandas'
import { FAKE_VIDEO_ID, startFakeVideoSite } from './fixtures/fake-video'
import { FIXTURES } from '../../../packages/format/test/fixtures'
import { fragmentUrl } from '../src/shared/web-link'

let site: D2l
let video: { server: Server; base: string }
test.beforeAll(async () => {
  site = await d2l()
  video = await startFakeVideoSite()
})
test.afterAll(() => {
  site.close()
  video.server.close()
})

const PDF = '课程/线代/第3讲.pdf'
const NOTE = '课程/线代/第3讲 笔记.md'

const ai = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })
const side = (page: Page) => ai(page).getByRole('region', { name: '旁支' })
const askbox = (page: Page) => page.getByRole('dialog', { name: '选中的这句' })
const pdfPane = (page: Page) => page.locator('.pdfpane:not([hidden])')
const pdfPage = (page: Page, n: number) => pdfPane(page).locator(`.pdfpage[data-page="${n}"]`)
const msgs = (page: Page) => ai(page).getByTestId('reading-msg')
const noted = (l: Locator) => l.getByTestId('ai-noted')
const gitOut = (vault: string, ...args: string[]) => execFileSync('git', ['-C', vault, ...args], { encoding: 'utf8' }).trim()
const read = (vault: string, rel: string) => (existsSync(join(vault, rel)) ? readFileSync(join(vault, rel), 'utf8') : '')

async function openPdf(page: Page, name = '第3讲') {
  await page.keyboard.press('Meta+k')
  await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill(name)
  await page.locator('.pal-row', { hasText: `${name}.pdf` }).first().click()
  await expect(tabOn(page)).toHaveText(`${name}.pdf`)
  await expect(pdfPage(page, 1).locator('canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
}

async function drawBox(page: Page, n: number, a: [number, number], b: [number, number]) {
  const el = pdfPage(page, n)
  await el.scrollIntoViewIfNeeded()
  const r = (await el.boundingBox())!
  await page.mouse.move(r.x + r.width * a[0], r.y + r.height * a[1])
  await page.mouse.down()
  await page.mouse.move(r.x + r.width * b[0], r.y + r.height * b[1], { steps: 6 })
  await page.mouse.up()
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
      ;(s![0] as Text).parentElement!.scrollIntoView({ block: 'center' })
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

/** 回答下面那排的 ⋯ 里点一项 */
async function more(page: Page, msg: Locator, item: string | RegExp) {
  await msg.hover()
  await msg.getByTestId('reading-ans-acts').locator('[data-act="more"]').click()
  await page.locator('.cn-ab-menu').getByRole('menuitem', { name: item }).click()
}

/** 等最后一条回答答完（回答下面那排出来） */
async function answered(page: Page, n: number) {
  await expect(msgs(page)).toHaveCount(n, { timeout: 20_000 })
  await expect(msgs(page).nth(n - 1).getByTestId('reading-ans-acts')).toBeVisible({ timeout: 20_000 })
}

test('读 PDF：问一句记进配对笔记（新写法）；关「记笔记」不记；⋯ 单记、撤回、拿掉；中途打开补进去；旁支开关和框头标签；重开软件照笔记认', async () => {
  const run = await launch({ [PDF]: LECTURE }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await openPdf(page)
    await page.keyboard.press('Meta+j')
    await expect(ai(page).getByTestId('reading-sees')).toContainText('读过全文5页')
    // 输入框下面那一排：记笔记 ·《第3讲 笔记》▾ ｜ 旁支，读 PDF 默认都开
    const sw = ai(page).getByTestId('ai-note-sw')
    await expect(sw.getByTestId('ai-note-main')).toHaveAttribute('aria-checked', 'true')
    await expect(sw.getByTestId('ai-note-side')).toHaveAttribute('aria-checked', 'true')
    await expect(sw.getByTestId('ai-note-target')).toContainText('《第3讲 笔记》')
    await expect(ai(page).getByTestId('ai-note-rec')).toContainText('正在记进《第3讲 笔记》')
    // 「记进哪篇 ▾」：PDF 只列配对那篇和一句默认说明
    await sw.getByTestId('ai-note-target').click()
    const menu = page.getByTestId('ai-note-menu')
    await expect(menu.getByRole('menuitemradio')).toHaveCount(1)
    await expect(menu.getByRole('menuitemradio')).toContainText('第3讲 笔记')
    await expect(menu.getByRole('menuitemradio')).toContainText('配对的那篇')
    await expect(menu).toContainText('读 PDF 时默认：记笔记开、旁支开')
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)

    // 框第 2 页一块问：记进配对笔记，新写法一节
    await drawBox(page, 2, [0.11, 0.085], [0.42, 0.135])
    await expect(ai(page).getByTestId('reading-att').locator('img')).toBeVisible()
    await ai(page).getByRole('textbox', { name: '问 AI' }).press('Enter')
    await answered(page, 1)
    const first = msgs(page).first()
    await expect(noted(first)).toHaveAttribute('data-state', 'done', { timeout: 20_000 })
    await expect(noted(first)).toContainText('已记进《第3讲 笔记》')
    let md = read(vault, NOTE)
    expect(md).toMatch(/\n## 第 2 页( · .+)?\n\n### 给我讲解一下\n\n!\[我框的\|\d+\]\(\.\.\/\.\.\/附件\/第3讲\/p2-1\.png\)\n\n—— \[第 2 页\]\(第3讲\.pdf#page=2&rect=[\d.,]+\)\n\n> \[!ai\] AI 回答 · Claude Code · Opus 5\.5 · \[回到 AI 对话\]\(canvas-notes:\/\/chat\?key=read%3A[^)]+&msg=\d+&th=%E7%AC%AC3%E8%AE%B2-p2-1\)\n> 这是讲解/)
    // 不再是旧写法：没有身份注释、问题条、小结，也不让快模型起标题
    expect(md).not.toMatch(/cn:thread=|\[!question\]|\[!recap\]|测试小标题|测试小结/)
    await expect.poll(() => gitOut(vault, 'log', '-1', '--format=%s')).toBe('笔记：第3讲 笔记 · 给我讲解一下')
    await expect.poll(() => gitOut(vault, 'status', '--porcelain', '--untracked-files=all')).toBe('')

    // 关「记笔记」：提示一句（已记的留着），再问不写
    await sw.getByTestId('ai-note-main').click()
    await expect(sw.getByTestId('ai-note-main')).toHaveAttribute('aria-checked', 'false')
    await expect(ai(page).getByTestId('ai-note-tip')).toContainText('之后的不记了；已记的 1 问留在《第3讲 笔记》里')
    await expect(ai(page).getByTestId('ai-note-rec')).toHaveCount(0)
    await expect.poll(() => JSON.parse(read(vault, '.canvas-notes/ai-note.json') || '{}').pdf).toEqual({ main: false, side: true })
    await first.getByRole('button', { name: '还是不懂' }).click()
    await answered(page, 2)
    const second = msgs(page).nth(1)
    await page.waitForTimeout(800)
    await expect(noted(second)).toHaveCount(0)
    expect(read(vault, NOTE)).toBe(md)
    // 提示 4 秒收
    await expect(ai(page).getByTestId('ai-note-tip')).toHaveCount(0, { timeout: 6000 })

    // ⋯ 最前面「记进《第3讲 笔记》」：开关关着也能单记这一条
    await more(page, second, /记进《第3讲 笔记》/)
    await expect(noted(second)).toHaveAttribute('data-state', 'done', { timeout: 15_000 })
    md = read(vault, NOTE)
    expect(md).toContain('\n### 还是不懂\n\n> [!ai] AI 回答 · ')
    // 同一处接着问的不再放图和来源行
    expect(md.match(/!\[我框的/g)).toHaveLength(1)
    // 「撤回」：只拿掉这一问写进去的几行
    await noted(second).getByTestId('ai-noted-undo').click()
    await expect(noted(second)).toHaveCount(0, { timeout: 15_000 })
    expect(read(vault, NOTE)).not.toContain('### 还是不懂')
    expect(read(vault, NOTE)).toContain('### 给我讲解一下')
    await expect.poll(() => gitOut(vault, 'log', '-1', '--format=%s')).toBe('笔记：从第3讲 笔记拿掉 · 还是不懂')
    // ⋯「从《第3讲 笔记》拿掉」：第一问也拿掉（这一节空了，## 那一行一起拿掉）
    await more(page, first, /从《第3讲 笔记》拿掉/)
    await expect(noted(first)).toHaveCount(0, { timeout: 15_000 })
    expect(read(vault, NOTE)).not.toMatch(/## 第 2 页|### 给我讲解一下|!\[我框的/)

    // 中途打开：前面 2 问没记 · 补进去 → 按先后补记
    await sw.getByTestId('ai-note-main').click()
    await expect(ai(page).getByTestId('ai-note-tip')).toContainText('前面 2 问没记')
    await ai(page).getByTestId('ai-note-tip').getByRole('button', { name: '补进去' }).click()
    await expect(noted(first)).toHaveAttribute('data-state', 'done', { timeout: 15_000 })
    await expect(noted(second)).toHaveAttribute('data-state', 'done', { timeout: 15_000 })
    await expect(ai(page).getByTestId('ai-note-tip')).toContainText('补进去了')
    md = read(vault, NOTE)
    expect(md.indexOf('### 给我讲解一下')).toBeGreaterThan(0)
    expect(md.indexOf('### 还是不懂')).toBeGreaterThan(md.indexOf('### 给我讲解一下'))
    // 补进去的第一问照样带框的图（这一处在这篇里第一次记）
    expect(md).toMatch(/### 给我讲解一下\n\n!\[我框的\|\d+\]/)

    // 旁支：选第一个回答里的一句问，「旁支」开着 → 记在它那一问后面
    await selectText(page, first.locator('.txt'), '列就是', '去哪')
    await askbox(page).getByRole('textbox', { name: '问这句' }).fill('为什么是列？')
    await askbox(page).getByRole('textbox', { name: '问这句' }).press('Enter')
    await expect(side(page).locator('.acts')).toBeVisible({ timeout: 15_000 })
    await expect(side(page).getByTestId('side-note-tag')).toHaveText('记进笔记')
    await expect(side(page).getByTestId('side-noted')).toHaveAttribute('data-state', 'done', { timeout: 15_000 })
    md = read(vault, NOTE)
    expect(md).toContain('#### 旁支：为什么是列？\n\n> 列就是基向量去哪\n> —— 在「给我讲解一下」的回答里\n\n> [!ai] 旁支回答 · ')
    // 旁支挂在它那一问后面（在「还是不懂」之前）
    expect(md.indexOf('#### 旁支：为什么是列？')).toBeLessThan(md.indexOf('### 还是不懂'))
    // 框头标签单管这一条：拨成「不记」，接着问的不记
    await side(page).getByTestId('side-note-tag').click()
    await expect(side(page).getByTestId('side-note-tag')).toHaveText('不记')
    await side(page).getByRole('textbox', { name: '问 AI' }).fill('那行呢？')
    await side(page).getByRole('textbox', { name: '问 AI' }).press('Enter')
    await expect(side(page).getByTestId('side-msg')).toHaveCount(2)
    await expect(side(page).locator('.acts')).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(800)
    expect(read(vault, NOTE)).not.toContain('那行呢')
    await expect(side(page).getByTestId('side-noted')).toHaveCount(1)
    await side(page).getByRole('button', { name: '收起旁支' }).first().click()

    // 「旁支」总开关关了：新开的旁支不记
    await sw.getByTestId('ai-note-side').click()
    await expect(sw.getByTestId('ai-note-side')).toHaveAttribute('aria-checked', 'false')
    await expect(ai(page).getByTestId('ai-note-rec')).toContainText('旁支不记')
    await selectText(page, second.locator('.txt'), '先别看', '公式')
    await askbox(page).getByRole('textbox', { name: '问这句' }).fill('看哪张图？')
    await askbox(page).getByRole('textbox', { name: '问这句' }).press('Enter')
    await expect(side(page).locator('.acts')).toBeVisible({ timeout: 15_000 })
    await expect(side(page).getByTestId('side-note-tag')).toHaveText('不记')
    await page.waitForTimeout(800)
    expect(read(vault, NOTE)).not.toContain('看哪张图')
    await side(page).getByRole('button', { name: '收起旁支' }).first().click()
    await expect.poll(() => gitOut(vault, 'status', '--porcelain', '--untracked-files=all')).toBe('')
    md = read(vault, NOTE)

    // 重开软件：「已记进」照笔记里认，不靠内存
    const userData = run.userData
    await run.app.close()
    const app = await electron.launch({
      executablePath: electronPath as unknown as string,
      args: [join(__dirname, '../out/main/index.js')],
      env: { ...process.env, CN_VAULT: vault, CN_USER_DATA: userData, CN_AI_FAKE: '1', CN_E2E: '1', CN_NO_AX: '1', CN_QUICK_KEY: 'Alt+Command+Shift+F19', CN_TRASH_DIR: join(dirname(vault), 'trash') },
    })
    try {
      const p2 = await app.firstWindow()
      await expect(p2.locator('.vault b')).toHaveText('测试库')
      await openPdf(p2)
      if (!(await ai(p2).isVisible())) await p2.keyboard.press('Meta+j')
      await expect(msgs(p2)).toHaveCount(2)
      await expect(noted(msgs(p2).first())).toHaveAttribute('data-state', 'done')
      await expect(noted(msgs(p2).nth(1))).toHaveAttribute('data-state', 'done')
      // 开关记在库里：旁支还是关着
      await expect(ai(p2).getByTestId('ai-note-side')).toHaveAttribute('aria-checked', 'false')
      expect(read(vault, NOTE)).toBe(md)
    } finally {
      await app.close()
    }
  } finally {
    await run.close().catch(() => undefined)
  }
})

test('旧配对笔记（ParaRead 写的看不懂那段）接着问：新写法接在旧那段后面，旧的一字节不动', async () => {
  const PR_PDF = 'paper/2026_C72_BST-GATNet.pdf'
  const PR_NOTE = 'paper/2026_C72_BST-GATNet 笔记.md'
  const old = FIXTURES['2026_C72_BST-GATNet 笔记.md']!
  const run = await launch({ [PR_PDF]: LECTURE, [PR_NOTE]: old }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  const notes = page.getByRole('complementary', { name: '笔记', exact: true })
  try {
    await openPdf(page, '2026_C72_BST-GATNet')
    // 打开时先给以前没图的那段补一张「我框的」（task-yp8l7，和这次无关）：补好、提交了再拿问之前的样子
    await expect.poll(() => read(vault, PR_NOTE), { timeout: 15_000 }).toContain('![我框的')
    await expect.poll(() => gitOut(vault, 'status', '--porcelain', '--untracked-files=all')).toBe('')
    const before = readFileSync(join(vault, PR_NOTE))
    expect(before.toString('utf8')).toContain(Buffer.from(old).toString('utf8').split('\n> [!question]')[1]!)
    if (!(await notes.isVisible())) await rail(page).getByRole('button', { name: '笔记' }).first().click()
    const confused = notes.getByTestId('note-confused')
    if (!(await confused.isVisible())) await notes.getByRole('button').filter({ hasText: '看不懂：Bi-LSTM 为什么放在注意力后面' }).first().click()
    await confused.getByTestId('hl-ask').click()
    await expect(ai(page)).toBeVisible()
    await answered(page, 1)
    await expect(noted(msgs(page).first())).toHaveAttribute('data-state', 'done', { timeout: 20_000 })
    // 属性（「进度」跟上）之后的正文：旧的划线、看不懂那段逐字节是新正文的开头，新写法接在后面
    const body = (b: Uint8Array) => {
      const buf = Buffer.from(b)
      const end = buf.indexOf('\n---\n', 4)
      return buf.subarray(end + 5)
    }
    const was = body(before)
    const now = body(readFileSync(join(vault, PR_NOTE)))
    expect(now.subarray(0, was.length).toString('utf8')).toBe(was.toString('utf8'))
    const added = now.subarray(was.length).toString('utf8')
    expect(read(vault, PR_NOTE)).toMatch(/\n进度: 2\/5\n/)
    // 接在旧那段后面：同一页新起一节，问话写回「看不懂：原文」（不是发给 AI 的那句），回答一块 [!ai]
    expect(added).toMatch(/^\n## 第 2 页( · .+)?\n\n### 看不懂：a Bi-LSTM is introduced as a temporal refinement layer\n\n> \[!ai\] AI 回答 · Claude Code · Opus 5\.5 · \[回到 AI 对话\]\(canvas-notes:\/\/chat\?key=[^)]+&th=2026_C72_BST-GATNet-p2-5\)\n> /)
    expect(added).not.toContain('这句看不懂：')
    expect(added).not.toContain('cn:hl=')
  } finally {
    await run.close()
  }
})

// ---------------------------------------------------------------- 网页

const WEB_NOTE = '课程/学习笔记：动手学深度学习.md'
const WEB_TITLE = '学习笔记：动手学深度学习'
/** 以前另开的那篇（2026-11-24 改成写进剪藏那篇本身，不该再有） */
const WEB_AI = '课程/学习笔记：动手学深度学习 · AI 笔记.md'
const webPane = (page: Page) => page.getByRole('complementary', { name: '网页' })
function guest<T = unknown>(page: Page, code: string): Promise<T> {
  return page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code) as Promise<T>
}
async function openWeb(page: Page, u: string) {
  if (!(await webPane(page).isVisible())) await rail(page).getByRole('button', { name: '网页' }).click()
  const addr = webPane(page).getByRole('textbox', { name: '网址' })
  await addr.click()
  await addr.fill(u)
  await addr.press('Enter')
  await expect.poll(() => guest(page, 'document.readyState + "|" + location.href')).toBe(`complete|${u}`)
}
async function selectIn(page: Page, id: string, from: string, to: string) {
  await guest(page, `document.getElementById(${JSON.stringify(id)}).scrollIntoView({ block: 'center' })`)
  for (let i = 0; i < 3; i++) {
    const w = (await webPane(page).locator('webview.on').boundingBox())!
    const pts = await guest<number[]>(
      page,
      `(() => { const t = document.getElementById(${JSON.stringify(id)}).firstChild; const s = t.data.indexOf(${JSON.stringify(from)}), e = t.data.indexOf(${JSON.stringify(to)}, s) + ${to.length}; const r = document.createRange(); r.setStart(t, s); r.setEnd(t, e); const rs = r.getClientRects(), f = rs[0], l = rs[rs.length - 1]; return [f.left + 1, f.top + f.height / 2, l.right - 1, l.top + l.height / 2] })()`,
    )
    await page.mouse.move(w.x + pts[0]!, w.y + pts[1]!)
    await page.mouse.down()
    await page.mouse.move(w.x + pts[2]!, w.y + pts[3]!, { steps: 8 })
    await page.mouse.up()
    const ok = await expect
      .poll(() => guest<string>(page, `getSelection().toString().replace(/\\s+/g, ' ').trim()`), { timeout: 1500 })
      .toContain(to)
      .then(() => true, () => false)
    if (ok) break
  }
  await expect.poll(() => guest(page, `document.getElementById('cn-clip-host')?.style.display`)).toBe('block')
}
async function clickBar(page: Page, label: string) {
  const w = (await webPane(page).locator('webview.on').boundingBox())!
  const r = await guest<{ x: number; y: number; width: number; height: number }>(
    page,
    `(() => { const b = [...document.getElementById('cn-clip-host').shadowRoot.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || b.textContent).trim().startsWith(${JSON.stringify(label)})); const r = b.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`,
  )
  await page.mouse.click(w.x + r.x + r.width / 2, w.y + r.y + r.height / 2)
}

test('网页：问一句写进剪藏那篇本身（插在光标处，和剪藏、自己的字混排），不另开 AI 笔记；右栏「笔记」列出这一问、点了回网页那段', async () => {
  const body = `# ${WEB_TITLE}\n\n## 2.2 数据预处理\n\n先把数据读进来，再处理缺失值。\n`
  const run = await launch({ [WEB_NOTE]: `---\nread-along: ${site.base}/\n---\n${body}`, '课程/没配对的一篇.md': '# 没配对的一篇\n\n正文。\n' }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await openNote(page, WEB_TITLE)
    await widenRight(page, 200)
    // 光标放在自己那句后面
    await pane(page).getByText('先把数据读进来，再处理缺失值。').click()
    await page.keyboard.press('End')
    await openWeb(page, site.pandas)
    await selectIn(page, 'p1', '下面我们将', '写入CSV文件中。')
    await clickBar(page, '讲解一下')
    await answered(page, 1)
    await expect(noted(msgs(page).first())).toHaveAttribute('data-state', 'done', { timeout: 20_000 })
    await expect(noted(msgs(page).first())).toContainText(`已记进《${WEB_TITLE}》`)
    await expect(ai(page).getByTestId('ai-note-rec')).toContainText(`正在记进《${WEB_TITLE}》`)
    await waitSaved(page)
    const md = read(vault, WEB_NOTE)
    // 自己那句后面接着：问的那句、引的那段带回到网页这段的来源、AI 回答框
    expect(md).toContain(`先把数据读进来，再处理缺失值。\n\n### 给我讲解一下\n\n> ${P1_LAST}\n> —— [2.2.1 读取数据集`)
    expect(md).toContain(`↩](${fragmentUrl(site.pandas, P1_LAST)})\n\n> [!ai] AI 回答 · Claude Code · Opus 5.5 · [回到 AI 对话](canvas-notes://chat?key=read%3Aweb%3A`)
    expect(md.startsWith(`---\nread-along: ${site.base}/\n---\n# ${WEB_TITLE}\n\n## 2.2 数据预处理\n\n`)).toBe(true)
    expect(md).not.toContain('AI 笔记')
    expect(existsSync(join(vault, WEB_AI))).toBe(false)
    await expect.poll(() => gitOut(vault, 'log', '-1', '--format=%s')).toBe(`笔记：${WEB_TITLE} · 给我讲解一下`)
    // 「记进哪篇 ▾」：剪藏那篇、换一篇…
    await ai(page).getByTestId('ai-note-target').click()
    const menu = page.getByTestId('ai-note-menu')
    await expect(menu.getByRole('menuitemradio')).toHaveText([new RegExp(`${WEB_TITLE}.*剪藏那篇`), /换一篇…/])
    await page.keyboard.press('Escape')
    // 右栏「笔记」：来自这个网页的这一问，认成「问的」不算剪藏；点了网页回到那段
    await rail(page).getByRole('button', { name: /^笔记/ }).click()
    const n = page.getByRole('complementary', { name: '笔记', exact: true })
    await expect(n.getByRole('tab')).toHaveText(['全部 1', '问的 1', '剪的 0'])
    await expect(n.getByTestId('web-note').locator('.t')).toHaveText([`讲解一下「${P1_LAST}」`])
    await guest(page, 'window.scrollTo(0, document.body.scrollHeight)')
    await n.getByTestId('web-note').first().click()
    await expect.poll(() => guest<boolean>(page, `(() => { const r = document.getElementById('p1').getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight })()`)).toBe(true)
  } finally {
    await run.close()
  }
})

test('网页还没配对：第一次问「记到哪篇」选「这次只问，不记」= 关掉网页的「记笔记」；再打开选一篇，补进去写进那篇本身', async () => {
  const run = await launch({ [WEB_NOTE]: `# ${WEB_TITLE}\n\n先把数据读进来。\n` }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await openNote(page, WEB_TITLE)
    await openWeb(page, site.pandas)
    await widenRight(page, 200)
    await selectIn(page, 'p1', '下面我们将', '写入CSV文件中。')
    await clickBar(page, '讲解一下')
    const dlg = page.getByRole('dialog', { name: '记到哪篇' })
    await expect(dlg).toBeVisible()
    await expect(dlg).toContainText('以后在这里讲解、引用、剪藏的都记进这篇')
    await expect(dlg).not.toContainText('AI 笔记')
    await dlg.getByRole('radio', { name: '这次只问，不记' }).click()
    await expect(dlg).toContainText('「记笔记」跟着关上')
    await dlg.getByRole('button', { name: /只问这次/ }).click()
    await answered(page, 1)
    await expect(ai(page).getByTestId('ai-note-main')).toHaveAttribute('aria-checked', 'false')
    await expect(ai(page).getByTestId('ai-note-target')).toContainText('选一篇')
    await page.waitForTimeout(800)
    expect(read(vault, WEB_NOTE)).toBe(`# ${WEB_TITLE}\n\n先把数据读进来。\n`)
    await expect(noted(msgs(page).first())).toHaveCount(0)
    await expect.poll(() => JSON.parse(read(vault, '.canvas-notes/ai-note.json') || '{}').web).toEqual({ main: false, side: true })
    // 再打开「记笔记」：还没定剪藏那篇，先问一篇；选了中间这篇，前面那一问提示补进去
    await ai(page).getByTestId('ai-note-main').click()
    await expect(dlg).toBeVisible()
    await dlg.getByRole('button', { name: /记到这篇/ }).click()
    await expect(ai(page).getByTestId('ai-note-main')).toHaveAttribute('aria-checked', 'true')
    await expect(ai(page).getByTestId('ai-note-tip')).toContainText('前面 1 问没记')
    await ai(page).getByTestId('ai-note-tip').getByRole('button', { name: '补进去' }).click()
    await expect(noted(msgs(page).first())).toHaveAttribute('data-state', 'done', { timeout: 15_000 })
    await expect.poll(() => read(vault, WEB_NOTE)).toContain(`> ${P1_LAST}\n> —— [2.2.1 读取数据集`)
    expect(read(vault, WEB_NOTE)).toContain('先把数据读进来。')
    expect(existsSync(join(vault, WEB_AI))).toBe(false)
  } finally {
    await run.close()
  }
})

const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
/** 按住 ⌘ 框住 #id 这一段（真拖），框好的工具条出来 */
async function boxPara(page: Page, id: string) {
  await guest(page, `document.getElementById(${JSON.stringify(id)}).scrollIntoView({ block: 'center' })`)
  const w = (await webPane(page).locator('webview.on').boundingBox())!
  const r = await guest<{ x: number; y: number; width: number; height: number }>(page, `(() => { const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`)
  await page.keyboard.down('Meta')
  await page.mouse.move(w.x + r.x - 4, w.y + r.y - 4)
  await page.mouse.down()
  await page.mouse.move(w.x + r.x + r.width / 2, w.y + r.y + r.height / 2, { steps: 5 })
  await page.mouse.move(w.x + r.x + r.width + 4, w.y + r.y + r.height + 4, { steps: 5 })
  await page.mouse.up()
  await page.keyboard.up('Meta')
  await expect.poll(() => guest(page, `document.getElementById('cn-box-host')?.shadowRoot?.querySelector('.cap')?.style.display`)).toBe('flex')
}
async function clickBox(page: Page, label: string) {
  const w = (await webPane(page).locator('webview.on').boundingBox())!
  const r = await guest<{ x: number; y: number; width: number; height: number }>(
    page,
    `(() => { const b = [...document.getElementById('cn-box-host').shadowRoot.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || b.textContent).trim().startsWith(${JSON.stringify(label)})); const r = b.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`,
  )
  await page.mouse.click(w.x + r.x + r.width / 2, w.y + r.y + r.height / 2)
}

// 2026-11-24 用户在 d2l 6.2：「刚才不知道为什么它就默认不放进去」——前面几问没写进剪藏那篇、后来那问写进去了。
// 原因：偏好「引用留在当前对话」以后，右栏 AI 看着的是这篇笔记自己那段对话时，网页上的引用、框的一块进了那段对话，那段对话不记网页的笔记
// （flow.ts 只在进网页自己那段时才定记到哪篇、写进去）；右栏换回网页自己那段以后问的才写进去。这里照原样复现：现在一定写进剪藏那篇。
test('网页引用、框的一块进了这篇笔记自己那段对话：问的那句、① 引文（点了回网页那段）、② 框的图、AI 回答框照样写进剪藏那篇', async () => {
  test.setTimeout(180_000)
  const body = `# ${WEB_TITLE}\n\n## 2.2 数据预处理\n\n先把数据读进来，再处理缺失值。\n`
  const run = await launch({ [WEB_NOTE]: `---\nread-along: ${site.base}/\n---\n${body}` }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await openNote(page, WEB_TITLE)
    await widenRight(page, 200)
    await pane(page).getByText('先把数据读进来，再处理缺失值。').click()
    await page.keyboard.press('End')
    // 右栏 AI 开着这篇笔记自己那段对话（看文档的「记笔记」默认关）
    await openAi(page)
    await expect(chat(page).getByTestId('ai-conv')).toHaveText(WEB_TITLE)
    await openWeb(page, site.pandas)
    if ((await page.locator('.dgrp').count()) < 2) await webAboveAi(page)
    await expect(chat(page)).toBeVisible()
    // ① 选一句点引用、② 按住 ⌘ 框一段点引用：都进了这段对话的输入框
    await selectIn(page, 'p1', '下面我们将', '写入CSV文件中。')
    await clickBar(page, '引用')
    await expect(chat(page).getByTestId('ai-mat')).toHaveCount(1)
    await boxPara(page, 'p2')
    await clickBox(page, '引用')
    await expect(chat(page).getByTestId('ai-mat')).toHaveCount(2)
    const q = chat(page).getByRole('textbox', { name: '问 AI' })
    await q.click()
    await page.keyboard.press('End')
    await page.keyboard.type('这部分看不懂是说什么')
    await q.press('Enter')
    await expect(chat(page).getByTestId('ai-msg').last().locator('.txt')).toContainText('这是测试回答', { timeout: 20_000 })
    await expect(chat(page).getByTestId('ai-noted').last()).toContainText(`已记进《${WEB_TITLE}》`, { timeout: 20_000 })
    await waitSaved(page)
    const md = read(vault, WEB_NOTE)
    const att = /!\[[^\]]*\|180\]\(\.\.\/附件\/学习笔记：动手学深度学习\/([0-9a-f]{8})\.png\)/.exec(md)
    expect(att, md).not.toBeNull()
    expect(existsSync(join(vault, `附件/学习笔记：动手学深度学习/${att![1]}.png`))).toBe(true)
    expect(md).toMatch(new RegExp(`先把数据读进来，再处理缺失值。\\n\\n### ①②这部分看不懂是说什么\\n\\n> ① ${P1_LAST}\\n> —— \\[2\\.2\\.1 读取数据集[^\\]]* ↩\\]\\(${fragmentUrl(site.pandas, P1_LAST).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)\\n\\n!\\[`))
    expect(md).toMatch(/\.png\)\n\n> \[!ai\] AI 回答 · Claude Code · Opus 5\.5 · \[回到 AI 对话\]\(canvas-notes:\/\/chat\?key=file%3A/)
    expect(md).not.toContain('AI 笔记')
    // 新写法带材料不再写脚注（0.5.7 以前的 [^p1-4-1]: 定义，r119）：①② 直接写在这一问下面
    expect(md).not.toMatch(/\[\^/)
    expect(gitOut(vault, 'status', '--porcelain')).toBe('')
    // 引文的来源点一下：右栏网页回到那一段
    await guest(page, 'window.scrollTo(0, document.body.scrollHeight)')
    await pane(page).locator('.cm-line', { hasText: '读取数据集' }).filter({ hasText: '↩' }).first().getByText(/↩/).click()
    await expect.poll(() => guest<boolean>(page, `(() => { const r = document.getElementById('p1').getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight })()`), { timeout: 10_000 }).toBe(true)
  } finally {
    await run.close()
  }
})

// ---------------------------------------------------------------- 视频

const VIDEO_NOTE = '看视频的笔记.md'
const askCard = (page: Page) => webPane(page).getByRole('dialog', { name: '问 AI' })

test('视频问框：问一句写进「记到哪」那篇本身（插在光标处：框住那块的小图、回到那一秒、AI 回答框）；接着问的接在后面', async () => {
  test.setTimeout(120_000)
  const run = await launch({ [VIDEO_NOTE]: '# 看视频的笔记\n\n我先写的一句。\n' }, { CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '150', CN_AI_FAKE_ASK_MS: '600', CN_VIDEO_TEST_ORIGIN: video.base })
  const { page, vault } = run
  try {
    await openNote(page, '看视频的笔记')
    await rail(page).getByRole('button', { name: '网页', exact: true }).click()
    const addr = webPane(page).getByRole('textbox', { name: '网址' })
    await addr.fill(`${video.base}/watch?v=${FAKE_VIDEO_ID}`)
    await addr.press('Enter')
    const strip = webPane(page).getByRole('region', { name: '视频条' })
    await expect(strip).toBeVisible({ timeout: 15_000 })
    await expect(strip.getByRole('button', { name: '字幕', exact: true })).toContainText('英→中', { timeout: 15_000 })
    await guest(page, `(() => { const v = document.querySelector('video'); v.currentTime = 6; v.pause(); return true })()`)
    await expect.poll(async () => Math.round(Number(await guest(page, 'document.querySelector("video").currentTime')))).toBe(6)
    await pane(page).getByText('我先写的一句。').click()
    await page.keyboard.press('Alt+KeyD')
    await expect.poll(() => guest(page, `!!document.getElementById('cn-video-host').shadowRoot.querySelector('.box')`)).toBe(true)
    const wv = (await webPane(page).locator('webview.on').boundingBox())!
    await page.mouse.move(wv.x + 40, wv.y + 30)
    await page.mouse.down()
    await page.mouse.move(wv.x + 200, wv.y + 120, { steps: 6 })
    await page.mouse.up()
    const ask = askCard(page)
    await expect(ask).toBeVisible()
    await expect(ask.getByRole('button', { name: /^记进/ })).toContainText('记进《看视频的笔记》')
    await ask.getByRole('button', { name: '讲解这一块', exact: true }).click()
    await expect(ask.getByTestId('ak-answer').first()).toContainText('框里是 i 帽', { timeout: 15_000 })
    await expect(ask.getByRole('button', { name: /已记进《看视频的笔记》/ })).toBeVisible({ timeout: 15_000 })
    await waitSaved(page)
    const md = read(vault, VIDEO_NOTE)
    expect(md).toContain('# 看视频的笔记\n\n我先写的一句。\n\n### 讲解这一块\n\n![我框的](')
    expect(md).toMatch(/\.jpg\)\n\n—— \[▶ 00:06 · Linear transformations and matrices\]\([^)]*watch\?v=[^)]*&t=6s\)\n\n> \[!ai\] AI 回答 · Claude Code · Opus 5\.5 · \[回到 AI 对话\]\(canvas-notes:\/\/chat\?key=read%3Aweb%3A[^)]+\)\n> 框里是 i 帽/)
    expect(md).not.toContain('moment-ask')
    expect(md).not.toContain('AI 笔记')
    // 接着问：接在后面，一问一个小标题，不再放图
    await ask.getByRole('textbox', { name: '想问什么' }).fill('那网格线为什么还平行？')
    await ask.getByRole('textbox', { name: '想问什么' }).press('Enter')
    await expect(ask.getByTestId('ak-answer')).toHaveCount(2)
    await expect.poll(() => read(vault, VIDEO_NOTE), { timeout: 15_000 }).toContain('\n### 那网格线为什么还平行？\n\n—— [▶ 00:06')
    expect(read(vault, VIDEO_NOTE).match(/!\[我框的/g)).toHaveLength(1)
    // 「已记进」点了：中间是那篇
    await ask.getByRole('button', { name: /已记进/ }).click()
    await expect(tabOn(page)).toContainText('看视频的笔记')
    void (null as unknown as Running)
  } finally {
    await run.close()
  }
})
