/**
 * 网页剪藏 / 引用碰到数学公式（用户在 zh.d2l.ai 6.1：选中公式 6.1.1 小条上「引用」「剪藏」都没反应；剪了带行内公式的段落网页上不标；
 * 整段剪了两次紫色点线只画到第二行）。一个原因：选中的「这段字」用浏览器选区的字（MathJax 3 的公式选不出字），网页上找段落用藏着的
 * MathML 的字，文件里是 `$…$`，三样对不上。现在三处都把公式写成 `$…$` / `$$…$$`。
 * 再剪同一段进同一篇：不写第二份，底栏「这段已经剪过了 · 跳到那一处 · 再剪一份」。
 * 本机假网页 fixtures/d2l-conv.ts（照 d2l 6.1 的 MathJax 3.2 输出精简），无头（CN_E2E=1）、假 AI。
 */
import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, openNote, pane, rail, type Running, waitSaved, webAboveAi, widenRight } from './app'
import { d2lConv, type D2lSite, HIJ, XIJ } from './fixtures/d2l-conv'

let site: D2lSite
test.beforeAll(async () => {
  site = await d2lConv()
})
test.afterAll(() => site.close())

const NOTE = '课程/学习笔记：动手学深度学习.md'
const TITLE = '学习笔记：动手学深度学习'
const paired = () => `---\nread-along: ${site.base}/\n---\n# ${TITLE}\n\n## 6.1 从全连接层到卷积\n\n先读 6.1.2。\n`
const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const toast = (page: Page) => page.getByTestId('toast')
const file = (run: Running) => readFileSync(join(run.vault, NOTE), 'utf8')
const count = (s: string, part: string) => s.split(part).length - 1

function guest<T = unknown>(page: Page, code: string): Promise<T> {
  return page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code) as Promise<T>
}

async function openWeb(page: Page) {
  if (!(await web(page).isVisible())) await rail(page).getByRole('button', { name: '网页', exact: true }).click()
  const addr = web(page).getByRole('textbox', { name: '网址' })
  await addr.click()
  await addr.fill(site.url)
  await addr.press('Enter')
  await expect.poll(() => guest(page, 'document.readyState + "|" + location.href')).toBe(`complete|${site.url}`)
}

/** 网页里一处的中心（窗口坐标） */
async function point(page: Page, code: string) {
  const w = (await web(page).locator('webview.on').boundingBox())!
  const r = await guest<{ x: number; y: number; width: number; height: number }>(page, `(() => { const r = (${code}).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`)
  return { x: w.x + r.x + r.width / 2, y: w.y + r.y + r.height / 2 }
}

/** 中间那篇里 ⌘ 点一处字（真点：量它在编辑器里的位置；剪藏来源那一行的链接 ⌘ 点才开） */
async function cmdClickShown(page: Page, text: string) {
  const at = await pane(page)
    .locator('.cm-content')
    .evaluate((root, t) => {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      while (w.nextNode()) {
        const n = w.currentNode as Text
        const i = n.data.indexOf(t)
        if (i < 0) continue
        n.parentElement?.scrollIntoView({ block: 'center' })
        const r = document.createRange()
        r.setStart(n, i)
        r.setEnd(n, i + t.length)
        const b = r.getBoundingClientRect()
        return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
      }
      return null
    }, text)
  expect(at, `编辑器里看得到「${text}」`).not.toBeNull()
  await page.keyboard.down('Meta')
  await page.mouse.click(at!.x, at!.y)
  await page.keyboard.up('Meta')
}

const barShown = (page: Page) => guest(page, `document.getElementById('cn-clip-host')?.style.display`)

/** 用鼠标从 #id 第一个字拖到最后一个字（真拖，中间夹着公式）；小条出来 */
async function selectPara(page: Page, id: string) {
  await guest(page, `document.getElementById(${JSON.stringify(id)}).scrollIntoView({ block: 'center' })`)
  for (let i = 0; i < 3; i++) {
    const w = (await web(page).locator('webview.on').boundingBox())!
    const p = await guest<number[]>(
      page,
      `(() => { const el = document.getElementById(${JSON.stringify(id)}); const a = el.firstChild, b = el.lastChild;
        const f = document.createRange(); f.setStart(a, 0); f.setEnd(a, 1); const l = document.createRange(); l.setStart(b, b.data.length - 1); l.setEnd(b, b.data.length);
        const r1 = f.getClientRects()[0], r2 = l.getClientRects()[0]; return [r1.left + 1, r1.top + r1.height / 2, r2.right - 1, r2.top + r2.height / 2] })()`,
    )
    await page.mouse.move(w.x + p[0]!, w.y + p[1]!)
    await page.mouse.down()
    await page.mouse.move(w.x + p[2]!, w.y + p[3]!, { steps: 10 })
    await page.mouse.up()
    if (await expect.poll(() => barShown(page), { timeout: 1500 }).toBe('block').then(() => true, () => false)) return
  }
  throw new Error('小条没出来')
}

async function clickBar(page: Page, label: string) {
  const p = await point(page, `[...document.getElementById('cn-clip-host').shadowRoot.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || b.textContent).trim().startsWith(${JSON.stringify(label)}))`)
  await page.mouse.click(p.x, p.y)
}

/**
 * 网页上 #id 这一段的点线：每一行（按段落的行高分行）字有多宽、点线盖了多宽；还有段落里的点线一共几条
 */
const underlines = (page: Page, id: string) =>
  guest<{ lines: { text: number; under: number; n: number }[]; total: number }>(
    page,
    `(() => {
      const el = document.getElementById(${JSON.stringify(id)}); const pr = el.getBoundingClientRect()
      const r = document.createRange(); r.selectNodeContents(el)
      // 一行：中线挨着（8px 以内）的字框并成一行（公式字大，行不一样高，不能按行高分）
      const lines = []
      for (const c of r.getClientRects()) {
        if (c.width < 1) continue
        const y = c.top + c.height / 2
        const v = lines.find((x) => Math.abs(x.y - y) < 8)
        if (v) { v.l = Math.min(v.l, c.left); v.r = Math.max(v.r, c.right) } else lines.push({ y, l: c.left, r: c.right, u: [] })
      }
      const us = [...(document.getElementById('cn-mark-host')?.shadowRoot?.querySelectorAll('.u') ?? [])].map((u) => u.getBoundingClientRect())
      let total = 0
      for (const u of us) {
        if (u.top < pr.top - 2 || u.top > pr.bottom + 2) continue
        total++
        // 点线画在字框底下：归到中线在它上面、离得最近的那一行
        const v = lines.filter((x) => x.y < u.top).sort((a, b) => b.y - a.y)[0]
        if (v) v.u.push([Math.max(u.left, v.l), Math.min(u.right, v.r)])
      }
      // 盖了多宽：几条点线合起来（重叠的只算一次）
      const cover = (iv) => { let s = 0, end = -1e9; for (const [a, b] of iv.sort((x, y) => x[0] - y[0])) { if (b <= end) continue; s += b - Math.max(a, end); end = b } return s }
      return { lines: lines.sort((a, b) => a.y - b.y).map((v) => ({ text: Math.round(v.r - v.l), under: Math.round(cover(v.u)), n: v.u.length })), total }
    })()`,
  )
const badges = (page: Page) => guest<string[]>(page, `[...(document.getElementById('cn-mark-host')?.shadowRoot?.querySelectorAll('.mk') ?? [])].map((b) => b.textContent.trim())`)

/** 每一行都有一条点线（公式那几行不叠出好几层）、盖满那一行的字（差不到 3px） */
async function coversWhole(page: Page, id: string) {
  await expect
    .poll(async () => {
      const u = await underlines(page, id)
      return u.lines.length > 1 && u.lines.every((l) => l.under >= l.text - 3 && l.n === 1) ? 'ok' : JSON.stringify(u)
    })
    .toBe('ok')
}

test('选中公式 6.1.1：点一下整块选中、小条出来，「引用」进 AI 输入框的是这条公式；再点一下「剪藏」剪成 $$…$$ 带式号，网页上这块标上', async () => {
  const run = await launch({ [NOTE]: paired() }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await openNote(page, TITLE)
    await widenRight(page, 160)
    await pane(page).locator('.cm-line', { hasText: '先读 6.1.2' }).click()
    await page.keyboard.press('End')
    await openWeb(page)
    await guest(page, `document.getElementById('equation-why-conv-0').scrollIntoView({ block: 'center' })`)
    // 浏览器给的选区字是空的（公式选不出字）：以前小条当没选中
    const eq = await point(page, `document.querySelector('mjx-container[display="true"]')`)
    await page.mouse.click(eq.x, eq.y)
    await expect.poll(() => barShown(page)).toBe('block')
    expect(await guest<string>(page, 'getSelection().toString().trim()')).toBe('')
    await clickBar(page, '引用')
    await webAboveAi(page)
    const mat = page.getByRole('complementary', { name: '边读边问 AI' }).getByTestId('ai-mat').first()
    await expect(mat).toContainText('\\begin{split}')
    await expect(mat).toContainText('\\tag{6.1.1}')

    // 再点一下公式：整块选中、小条出来，点剪藏
    await guest(page, 'getSelection().removeAllRanges()')
    await expect.poll(() => barShown(page)).toBe('none')
    await guest(page, `document.getElementById('equation-why-conv-0').scrollIntoView({ block: 'center' })`)
    const eq2 = await point(page, `document.querySelector('mjx-container[display="true"]')`)
    await page.mouse.click(eq2.x, eq2.y)
    await expect.poll(() => barShown(page)).toBe('block')
    await clickBar(page, '剪藏')
    await expect(toast(page)).toContainText(`剪进《${TITLE}》`)
    await waitSaved(page)
    const md = file(run)
    expect(md).toMatch(/> \$\$\n> \\begin\{split\}\\begin\{aligned\} \\left\[\\mathbf\{H\}\\right\]_\{i, j\}[^\n]*\n> \\sum_a[^\n]*\\end\{split\} \\tag\{6\.1\.1\}\n> \$\$\n—— \[6\.1\.2 多层感知机的限制 · 动手学深度学习\]/)
    // 网页上这块公式标上：小标 1，公式底下有点线
    await guest(page, `document.getElementById('equation-why-conv-0').scrollIntoView({ block: 'center' })`)
    await expect.poll(() => badges(page)).toEqual(['1'])
    expect((await underlines(page, 'equation-why-conv-0')).total).toBeGreaterThan(0)
  } finally {
    await run.close()
  }
})

/** 小条以外软件挂在网页上的东西（点线 cn-mark-host 不算）：有就是悬停冒出来的 */
const strays = (page: Page) =>
  guest<string[]>(page, `[...document.documentElement.children].filter((e) => e.tagName === 'DIV' && e.id.startsWith('cn-') && !['cn-clip-host', 'cn-mark-host'].includes(e.id) && getComputedStyle(e).display !== 'none').map((e) => e.id)`)

test('引用、剪藏选中才出：鼠标划过、停在每个公式和代码块上 1 秒什么都不出；点一下公式小条出来；拖选带公式的段落小条出来', async () => {
  const run = await launch({ [NOTE]: paired() }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await openNote(page, TITLE)
    await widenRight(page, 160)
    await openWeb(page)
    const n = await guest<number>(page, `document.querySelectorAll('mjx-container, pre').length`)
    expect(n).toBe(14)
    const w = (await web(page).locator('webview.on').boundingBox())!
    await page.mouse.move(w.x + 5, w.y + 5)
    for (let i = 0; i < n; i++) {
      await guest(page, `document.querySelectorAll('mjx-container, pre')[${i}].scrollIntoView({ block: 'center' })`)
      const p = await point(page, `document.querySelectorAll('mjx-container, pre')[${i}]`)
      // 从上一处划过来，停 1 秒
      await page.mouse.move(p.x, p.y, { steps: 8 })
      await page.waitForTimeout(1000)
      const what = await guest<string>(page, `(() => { const e = document.querySelectorAll('mjx-container, pre')[${i}]; return e.tagName + ' ' + e.textContent.slice(0, 20) })()`)
      expect(await barShown(page), `停在第 ${i + 1} 个（${what}）上不出小条`).not.toBe('block')
      expect(await strays(page), `停在第 ${i + 1} 个（${what}）上不出角上按钮`).toEqual([])
      expect(await guest<boolean>(page, 'getSelection().isCollapsed'), '没选中东西').toBe(true)
    }

    // 点一下行内公式：整块选中、小条出来
    await guest(page, `document.getElementById('p2').scrollIntoView({ block: 'center' })`)
    const inl = await point(page, `document.querySelector('#p2 mjx-container')`)
    await page.mouse.click(inl.x, inl.y)
    await expect.poll(() => barShown(page)).toBe('block')
    // 点一下代码块：也是整块选中、小条出来
    await guest(page, 'getSelection().removeAllRanges()')
    await expect.poll(() => barShown(page)).toBe('none')
    await guest(page, `document.getElementById('code1').scrollIntoView({ block: 'center' })`)
    const code = await point(page, `document.getElementById('code1')`)
    await page.mouse.click(code.x, code.y)
    await expect.poll(() => barShown(page)).toBe('block')
    expect(await guest<string>(page, 'getSelection().toString()')).toContain('import torch')

    // 拖选带公式的段落：小条出来
    await guest(page, 'getSelection().removeAllRanges()')
    await expect.poll(() => barShown(page)).toBe('none')
    await selectPara(page, 'p1')
    expect(await strays(page)).toEqual([])
  } finally {
    await run.close()
  }
})

test('剪带行内公式的段落：文件里是 $…$，网页上点线盖满整段每一行、计数对，旁边没剪的段落不标；同一段再剪不写第二份（「再剪一份」才写）；↩ 回到那段', async () => {
  const run = await launch({ [NOTE]: paired() }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await openNote(page, TITLE)
    await widenRight(page, 160)
    await pane(page).locator('.cm-line', { hasText: '先读 6.1.2' }).click()
    await page.keyboard.press('End')
    await openWeb(page)

    // 图 3 那段：整段剪
    await selectPara(page, 'p1')
    await clickBar(page, '剪藏')
    await expect(toast(page)).toContainText(`剪进《${TITLE}》`)
    await waitSaved(page)
    const P1 = String.raw`> 首先，多层感知机的输入是二维图像$\mathbf{X}$，其隐藏表示$\mathbf{H}$在数学上是一个矩阵，在代码中表示为二维张量。 其中$\mathbf{X}$和$\mathbf{H}$具有相同的形状。 为了方便理解，我们可以认为，无论是输入还是隐藏表示都拥有空间结构。`
    expect(file(run)).toContain(P1)
    await coversWhole(page, 'p1')
    await guest(page, 'window.scrollTo(0, 0)')
    await expect.poll(() => badges(page)).toEqual(['1'])

    // 图 2 那段：好几个行内公式
    await selectPara(page, 'p2')
    await clickBar(page, '剪藏')
    await expect(toast(page)).toContainText(`剪进《${TITLE}》`)
    await waitSaved(page)
    expect(file(run)).toContain(`> 使用$${XIJ}$和$${HIJ}$分别表示输入图像和隐藏表示中位置（$i$,$j$）处的像素。 为了使每个隐藏神经元`)
    await coversWhole(page, 'p2')
    await guest(page, 'window.scrollTo(0, 0)')
    await expect.poll(() => badges(page)).toEqual(['1', '1'])
    // 没剪的段落、公式不标
    for (const id of ['p3', 'p4', 'equation-why-conv-0']) {
      await guest(page, `document.getElementById(${JSON.stringify(id)}).scrollIntoView({ block: 'center' })`)
      await page.waitForTimeout(200)
      expect((await underlines(page, id)).total, id).toBe(0)
    }

    // 同一段再剪：不写第二份，底栏「这段已经剪过了」带「跳到那一处」「再剪一份」
    await selectPara(page, 'p1')
    await clickBar(page, '剪藏')
    await expect(toast(page)).toContainText('这段已经剪过了')
    await expect(toast(page).getByRole('button')).toHaveText(['跳到那一处', '再剪一份'])
    await page.waitForTimeout(400)
    expect(count(file(run), P1)).toBe(1)
    await guest(page, 'window.scrollTo(0, 0)')
    await expect.poll(() => badges(page)).toEqual(['1', '1'])
    // 跳到那一处：中间那篇滚到剪过的那一段
    await pane(page).locator('.cm-scroller').evaluate((s) => (s.scrollTop = s.scrollHeight))
    await toast(page).getByRole('button', { name: '跳到那一处' }).click()
    await expect(pane(page).locator('.cm-line', { hasText: '首先，多层感知机的输入是二维图像' }).first()).toBeInViewport()

    // ↩ 回到那段：网页滚走，⌘ 点文档里来源那一行的链接（第一段的），网页回到带公式的那段、亮那几句
    await guest(page, 'window.scrollTo(0, document.body.scrollHeight)')
    await cmdClickShown(page, '6.1.2 多层感知机的限制 · 动手学深度学习')
    await expect
      .poll(() => guest<boolean>(page, `(() => { const r = document.getElementById('p1').getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight * 0.6 })()`))
      .toBe(true)
    await expect.poll(() => guest<number>(page, `document.getElementById('cn-mark-host').shadowRoot.querySelectorAll('.flash').length`)).toBeGreaterThan(0)

    // 再剪一份：点了才写，计数 2
    await selectPara(page, 'p1')
    await clickBar(page, '剪藏')
    await expect(toast(page)).toContainText('这段已经剪过了')
    await toast(page).getByRole('button', { name: '再剪一份' }).click()
    await expect.poll(() => count(file(run), P1)).toBe(2)
    await guest(page, 'window.scrollTo(0, 0)')
    await expect.poll(() => badges(page)).toEqual(['2', '1'])
  } finally {
    await run.close()
  }
})
