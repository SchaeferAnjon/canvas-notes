import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { dirname, join } from 'node:path'
import { gitStatus, launch, openNote, rail, waitSaved, railItems, webAboveAi, widenRight } from './app'
import { d2l } from './fixtures/d2l-pandas'
import { LECTURE } from './fixtures/pdf'
import { fragmentUrl } from '../src/shared/web-link'

const P1 = 'In linear algebra, a rotation matrix is a transformation matrix that is used to perform a rotation in Euclidean space.'
let server: Server
let base: string
/** 同一页放在另一个端口：另一个网站（还没和哪篇配对） */
let server2: Server
let base2: string

test.beforeAll(async () => {
  const serve = () =>
    createServer((_req, res) => {
      res.setHeader('content-type', 'text/html; charset=utf-8')
      res.end(`<!doctype html><html lang="en"><head><title>Rotation matrix</title></head><body style="font:18px/1.6 Georgia,serif;padding:24px;max-width:640px;background:#fff;color:#1b1b1b">
      <h1>Rotation matrix</h1><p id="p1">${P1}</p><p><a id="lnk" href="#later">Later section</a></p></body></html>`)
    })
  server = serve()
  server2 = serve()
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  await new Promise<void>((r) => server2.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  base2 = `http://127.0.0.1:${(server2.address() as { port: number }).port}`
})
test.afterAll(() => {
  server.close()
  server2.close()
})

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const ai = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })
const guest = (page: Page, code: string) => page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code)
const gitOut = (vault: string, ...args: string[]) => execFileSync('git', ['-C', vault, ...args], { encoding: 'utf8' }).trim()

async function openWeb(page: Page, u: string) {
  // 配好对的笔记一打开右栏网页就开着（read-along）：开着就不再点，点了是收起
  if (!(await web(page).isVisible())) await rail(page).getByRole('button', { name: '网页' }).click()
  // 右栏默认 340 窄，第一段折得很长；先拉宽到 420 再打开网页、再框
  if (Math.round((await web(page).boundingBox())!.width) < 420) await widenRight(page, 80)
  const addr = web(page).getByRole('textbox', { name: '网址' })
  await addr.fill(u)
  await addr.press('Enter')
  await expect.poll(() => guest(page, 'document.readyState + "|" + location.href')).toBe(`complete|${u}`)
}

/** 在网页上按住 ⌘ 框住第一段 */
async function boxP1(page: Page) {
  const w = (await web(page).locator('webview.on').boundingBox())!
  const r = JSON.parse(String(await guest(page, `JSON.stringify(document.getElementById('p1').getBoundingClientRect())`))) as { x: number; y: number; width: number; height: number }
  await page.keyboard.down('Meta')
  await page.mouse.move(w.x + r.x - 4, w.y + r.y - 4)
  await page.mouse.down()
  await page.mouse.move(w.x + r.x + r.width / 2, w.y + r.y + r.height / 2, { steps: 5 })
  await page.mouse.move(w.x + r.x + r.width + 4, w.y + r.y + r.height + 4, { steps: 5 })
  await page.mouse.up()
  await page.keyboard.up('Meta')
}

// task-6cxtc 起网页上问的不再写成「## 测试小标题」一段、也不进收件箱：一问一块 [!ai] 写进这个网页正在剪进去的那篇（这里是和这个网站
// 配好对的那篇，属性 read-along），块头带回到网页那一段的链接（网址 + #:~:text=那段开头），框一块问的放那块截图。
// 原来「关掉文档再框一块进收件箱」那半段改成：关掉文档再问，接在配好对的那篇末尾、底栏说记进了哪，不建收件箱。
// 没配对时先问记到哪篇、「这次只问，不记」在下面那条。
test('网页上框着问：回答一问一块 [!ai] 插到配好对的那篇光标处（块头带回到那一段的链接、框的截图），一次提交；关掉文档再问接在那篇末尾、底栏说记进了哪，不进收件箱；⌘ 点一下链接还是网页自己的', async () => {
  const START = `---\nread-along: ${base}/\n---\n# 线性代数 草稿\n\n我的草稿。\n`
  const run = await launch({ '线性代数 草稿.md': START }, { CN_AI_FAKE: '1', CN_FAKE_NOTE_MS: '50' })
  const { page, vault } = run
  const file = () => readFileSync(join(vault, '线性代数 草稿.md'), 'utf8')
  const dlg = page.getByRole('dialog', { name: '记到哪篇' })
  const dirty = () => gitStatus(vault).split('\n').filter((l) => l.trim() && !l.includes('读到哪.json'))
  try {
    await openNote(page, '线性代数 草稿')
    await page.locator('.pane:not([hidden]) .cm-content').click()
    await page.keyboard.press('Meta+ArrowDown')
    await openWeb(page, `${base}/wiki/Rotation_matrix`)
    // ⌘ 点一下（不拖）：网页自己的（跳到锚点）
    // 右栏刚拉宽，网页可能还在重排：量完点一下，没跳就重新量再点（最多三次）
    for (let i = 0; i < 3; i++) {
      const lr = JSON.parse(String(await guest(page, `JSON.stringify(document.getElementById('lnk').getBoundingClientRect())`))) as { x: number; y: number }
      const w = (await web(page).locator('webview.on').boundingBox())!
      await page.mouse.click(w.x + lr.x + 5, w.y + lr.y + 5)
      if (await expect.poll(() => guest(page, 'location.hash'), { timeout: 1500 }).toBe('#later').then(() => true, () => false)) break
    }
    await expect.poll(() => guest(page, 'location.hash')).toBe('#later')

    // 框一块：AI 开出来，输入框里有截图、预填「给我讲解一下」。工作区方向 A（task-9okg5）：AI 和网页叠成一组、AI 在前面，
    // 想边看网页边问就把网页拖到上半（真拖），后面一直上下两块
    await boxP1(page)
    await expect(ai(page)).toBeVisible()
    await expect(page.getByTestId('dtab-web')).toHaveAttribute('aria-selected', 'false')
    await webAboveAi(page)
    await expect(web(page)).toBeVisible()
    await expect(ai(page)).toBeVisible()
    await expect(ai(page).getByTestId('reading-sees')).toContainText('网页 · Rotation matrix')
    await expect(ai(page).getByTestId('reading-att').locator('img')).toBeVisible()
    await expect(ai(page).getByRole('textbox')).toHaveValue('给我讲解一下')
    // 开着配好对的网页：「笔记」亮着（列那篇里来自这一页的几条）
    await expect.poll(() => railItems(page)).toEqual(['笔记', '大纲', '网页', '微信读书', '记录', '自动化', '历史'])
    await expect(rail(page).getByRole('button', { name: /^笔记/ })).not.toHaveClass(/\bdim\b/)
    await ai(page).getByRole('textbox').press('Enter')
    await expect(ai(page).locator('.um').last()).toHaveText('给我讲解一下')
    await expect(ai(page).getByText('读了网页这一段')).toBeVisible()
    await expect(ai(page).getByText('已记进《线性代数 草稿》')).toBeVisible({ timeout: 15_000 })
    await waitSaved(page)
    const back = `[Rotation matrix ↩](${fragmentUrl(`${base}/wiki/Rotation_matrix`, P1)})`
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const md = file()
    expect(md.startsWith(START)).toBe(true)
    // 一问一块：头一行「讲解一下 · 谁答的 · 回到那一段的链接」，下面框的那块截图，再是回答；插在光标处（草稿那段后面）
    const m = md.match(new RegExp(`\n> \\[!ai\\] 讲解一下 · Claude Code · [^\\n]+ · ${esc(back)}\n> !\\[我框的\\]\\(([^)]+\\.png)\\)\n>\n> \\S`))
    expect(m, md).not.toBeNull()
    expect(existsSync(join(vault, decodeURI(m![1]!)))).toBe(true)
    expect(md.indexOf('我的草稿。')).toBeLessThan(md.indexOf('[!ai]'))
    // 不再写「## 小标题」那一段、身份注释、完整对话
    expect(md).not.toMatch(/## 测试小标题|cn:thread=|完整对话/)
    expect(gitOut(vault, 'log', '-1', '--format=%s')).toBe('笔记：网页「Rotation matrix」· 讲解一下 → 线性代数 草稿')
    // 那篇和截图一次提交干净（读到哪.json 是配好对的网页记读到哪的，跟着自动提交走，不算这一问的）
    expect(dirty()).toEqual([])
    expect(existsSync(join(vault, '.canvas-notes/对话'))).toBe(false)

    // 关掉文档：再框一块，不再问记到哪篇，接在配好对的那篇末尾；底栏说记进了哪
    await page.locator('main.center .tab', { hasText: '线性代数 草稿' }).getByRole('button', { name: '关闭标签' }).click()
    await boxP1(page)
    await expect(ai(page).getByRole('textbox')).toHaveValue('给我讲解一下')
    await ai(page).getByRole('textbox').press('Enter')
    await expect(page.getByTestId('toast')).toContainText('记进《线性代数 草稿》· Rotation matrix', { timeout: 15_000 })
    await expect(dlg).toHaveCount(0)
    await expect.poll(() => file().split('[!ai] 讲解一下').length - 1).toBe(2)
    await expect(page.getByTestId('toast').getByRole('button', { name: '在笔记里看' })).toBeVisible()
    // 接在末尾：最后一块后面再没有别的
    expect(file().slice(file().lastIndexOf('\n> [!ai]') + 1).trimEnd().split('\n').every((l) => l.startsWith('>'))).toBe(true)
    expect(existsSync(join(vault, '收件箱'))).toBe(false)
    await expect.poll(() => dirty()).toEqual([])
  } finally {
    await run.close()
  }
})

// 还没配对时网页上框着问：第一次问先问记到哪篇（默认中间开着的那篇），「记到这篇」顺手配成一对、回答写进那篇；
// 另一个没配对的网站选「这次只问，不记」：照样答，库里什么都不写（DESIGN「网页的笔记」）。
// 框着的工具条点「讲解一下」先问（App.tsx onWebBox → web-notes/flow.ts 的 ensureAsk）；框好以后在输入框里回车的，答好了贴着输入框问（writeAsk）。
test('网页上框着问（还没配对）：先问记到哪篇，「记到这篇」配成一对、回答写进那篇；「这次只问，不记」照样答、什么都不写', async () => {
  const START = '# 线性代数 草稿\n\n我的草稿。\n'
  const run = await launch({ '线性代数 草稿.md': START }, { CN_AI_FAKE: '1', CN_FAKE_NOTE_MS: '50' })
  const { page, vault } = run
  const file = () => readFileSync(join(vault, '线性代数 草稿.md'), 'utf8')
  const dlg = page.getByRole('dialog', { name: '记到哪篇' })
  try {
    await openNote(page, '线性代数 草稿')
    await page.locator('.pane:not([hidden]) .cm-content').click()
    await page.keyboard.press('Meta+ArrowDown')
    await openWeb(page, `${base}/wiki/Rotation_matrix`)
    await boxP1(page)
    await expect(ai(page)).toBeVisible()
    await webAboveAi(page)
    await expect(ai(page).getByRole('textbox')).toHaveValue('给我讲解一下')
    await expect(rail(page).getByRole('button', { name: /^笔记/ })).toHaveClass(/\bdim\b/)
    await ai(page).getByRole('textbox').press('Enter')
    await expect(dlg).toBeVisible()
    await expect(dlg.getByRole('radio').nth(0)).toHaveAccessibleName(/线性代数 草稿/)
    await expect(dlg.getByRole('radio').nth(0)).toBeChecked()
    await dlg.getByRole('button', { name: /记到这篇/ }).click()
    await expect(dlg).toHaveCount(0)
    await expect(ai(page).getByText('已记进《线性代数 草稿》')).toBeVisible({ timeout: 15_000 })
    await waitSaved(page)
    expect(file()).toContain(`read-along: ${base}/`)
    expect(file()).toContain(`[Rotation matrix ↩](${fragmentUrl(`${base}/wiki/Rotation_matrix`, P1)})`)
    await expect(rail(page).getByRole('button', { name: /^笔记/ })).not.toHaveClass(/\bdim\b/)

    const before = file()
    const commits = gitOut(vault, 'rev-list', '--count', 'HEAD')
    await openWeb(page, `${base2}/wiki/Rotation_matrix`)
    await boxP1(page)
    await expect(ai(page).getByRole('textbox')).toHaveValue('给我讲解一下')
    await ai(page).getByRole('textbox').press('Enter')
    await expect(dlg).toBeVisible()
    await dlg.getByRole('radio', { name: '这次只问，不记' }).click()
    await dlg.getByRole('button', { name: /只问这次/ }).click()
    await expect(dlg).toHaveCount(0)
    await expect(ai(page).locator('.um').last()).toHaveText('给我讲解一下')
    await expect(ai(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 15_000 })
    await expect(ai(page).getByText(/已记进/)).toHaveCount(0)
    expect(file()).toBe(before)
    expect(gitOut(vault, 'rev-list', '--count', 'HEAD')).toBe(commits)
    expect(existsSync(join(vault, '收件箱'))).toBe(false)
  } finally {
    await run.close()
  }
})

test('中间开着 PDF 时在网页上框着问：进这份 PDF 的 AI，「看得到」多一颗网页；笔记那段记进 PDF 的笔记，来源写域名', async () => {
  const run = await launch({ '课程/线性代数/第3讲 线性映射.pdf': LECTURE }, { CN_AI_FAKE: '1', CN_FAKE_NOTE_MS: '50' })
  const { page, vault } = run
  try {
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
    await page.locator('.pal-row', { hasText: '第3讲 线性映射' }).first().click()
    await expect(page.locator('.pdfpane:not([hidden]) .pdfpage[data-page="1"] canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
    await openWeb(page, `${base}/wiki/Rotation_matrix`)
    await boxP1(page)
    await expect(ai(page).getByTestId('reading-sees')).toContainText('第3讲 线性映射.pdf · 第1页')
    await expect(ai(page).getByTestId('reading-sees')).toContainText('网页 · Rotation matrix')
    await ai(page).getByRole('textbox').press('Enter')
    await expect(ai(page).getByText('读了网页这一段 · 对上第1页')).toBeVisible()
    await expect(ai(page).getByText('已记进网页（记在第3讲 线性映射 笔记里）')).toBeVisible({ timeout: 15_000 })
    const md = readFileSync(join(vault, '课程/线性代数/第3讲 线性映射 笔记.md'), 'utf8')
    expect(md).toMatch(/## 第 1 页 · 测试小标题 p\d+\n\[127\.0\.0\.1\]\(http:\/\/127\.0\.0\.1:\d+\/wiki\/Rotation_matrix\)/)
    // 笔记里这段的来源胶囊写域名
    await rail(page).getByRole('button', { name: '笔记' }).click()
    await expect(page.getByRole('complementary', { name: '笔记', exact: true }).getByText('127.0.0.1')).toBeVisible()
    expect(existsSync(join(vault, '收件箱'))).toBe(false)
  } finally {
    await run.close()
  }
})

// task-6cxtc 复审：网页上引用了两段、还没问时，右栏 AI 那一处的空白提示和「看得到」写网页标题（不是域名、整串网址），A、B 一样；
// 摆法同对照截图（右栏拉宽 270、网页在上半、笔记在下半，AI 和网页叠在一组）。小卡最宽 220。
for (const frame of ['b', 'a'] as const) {
  test(`网页上引用两段（界面风格 ${frame.toUpperCase()}）：空白提示「要问《2.2. 数据预处理》哪里？选一段或框一块就能问。」、看得到「网页 · 2.2. 数据预处理」；小卡最宽 220`, async () => {
    const site = await d2l()
    const note = '课程/学习笔记：动手学深度学习.md'
    const run = await launch({ [note]: `---\nread-along: ${site.base}/\n---\n# 学习笔记：动手学深度学习\n\n先把数据读进来。\n` }, { CN_AI_FAKE: '1' }, (vault) => {
      const ud = join(dirname(vault), 'user-data')
      mkdirSync(ud, { recursive: true })
      writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, frame } }))
    })
    const { page, app } = run
    const wv = (code: string) => page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code)
    /** 网页 #id 里从 from 拖到 to（真拖），点小条上的「引用」 */
    async function quote(id: string, from: string, to: string) {
      if (!(await web(page).locator('webview.on').isVisible())) await page.getByTestId('dtab-web').click()
      await wv(`document.getElementById(${JSON.stringify(id)}).scrollIntoView({ block: 'center' })`)
      for (let i = 0; i < 3; i++) {
        const w = (await web(page).locator('webview.on').boundingBox())!
        const pts = (await wv(
          `(() => { const t = document.getElementById(${JSON.stringify(id)}).firstChild; const s = t.data.indexOf(${JSON.stringify(from)}), e = t.data.indexOf(${JSON.stringify(to)}, s) + ${to.length}; const r = document.createRange(); r.setStart(t, s); r.setEnd(t, e); const rs = r.getClientRects(), f = rs[0], l = rs[rs.length - 1]; return [f.left + 1, f.top + f.height / 2, l.right - 1, l.top + l.height / 2] })()`,
        )) as number[]
        await page.mouse.move(w.x + pts[0]!, w.y + pts[1]!)
        await page.mouse.down()
        await page.mouse.move(w.x + pts[2]!, w.y + pts[3]!, { steps: 8 })
        await page.mouse.up()
        if (await expect.poll(() => wv(`document.getElementById('cn-clip-host')?.style.display`), { timeout: 1500 }).toBe('block').then(() => true, () => false)) break
      }
      const w = (await web(page).locator('webview.on').boundingBox())!
      const p = (await wv(`(() => { const b = document.getElementById('cn-clip-host').shadowRoot.querySelector('button.qt').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 } })()`)) as { x: number; y: number }
      await page.mouse.click(w.x + p.x, w.y + p.y)
    }
    try {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
      await openNote(page, '学习笔记：动手学深度学习')
      if (!(await web(page).isVisible())) await rail(page).getByRole('button', { name: '网页', exact: true }).click()
      const addr = web(page).getByRole('textbox', { name: '网址' })
      await addr.click()
      await addr.fill(site.pandas)
      await addr.press('Enter')
      await expect.poll(() => wv('document.readyState + "|" + location.href')).toBe(`complete|${site.pandas}`)
      await widenRight(page, 270)
      await rail(page).getByRole('button', { name: /^笔记/ }).click()
      await webAboveAi(page)
      await quote('p2', '典型的方法', '插值法和删除法')
      const mats = ai(page).getByTestId('ai-mat')
      await expect(mats).toHaveCount(1)
      await quote('p1', '下面我们将', '写入CSV文件中。')
      await expect(mats).toHaveCount(2)
      await expect(ai(page)).toBeVisible()
      await expect(ai(page).getByTestId('ai-greet').locator('p')).toHaveText('要问《2.2. 数据预处理》哪里？选一段或框一块就能问。')
      await expect(ai(page).getByTestId('ai-greet').locator('p')).toBeVisible()
      await expect(ai(page).getByTestId('reading-sees')).toContainText('网页 · 2.2. 数据预处理')
      await expect(ai(page).getByTestId('reading-sees')).not.toContainText('http')
      // 小卡：原文长，放到最宽 220（以前 132 只露四五个字）
      for (let i = 0; i < 2; i++) {
        const b = (await mats.nth(i).boundingBox())!
        expect(b.width).toBeGreaterThan(200)
        expect(b.width).toBeLessThanOrEqual(220)
      }
      await page.screenshot({ path: `test-results/step16-web-quote-${frame}.png` })
    } finally {
      await run.close()
      await site.close()
    }
  })
}
