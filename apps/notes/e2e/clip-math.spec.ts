/**
 * 剪藏、引用、整页剪藏不丢公式和代码块（用户：zh.d2l.ai 剪进来「行索引（ ）和列索引（ ）」括号里的 $i$、$j$ 没了；
 * 「代码块或公式是没有办法选中的 所以它剪藏的时候就会 miss 掉」）。本机假网页（fixtures/math-page.ts）：
 * MathJax 3、MathJax 2、KaTeX 的公式写成 $…$ / $$…$$，代码块带语言、页签只带显示的那个；文档里画成公式；打开再保存不变
 */
import { expect, test, type Page } from '@playwright/test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { launch, openNote, pane, rail, type Running, waitSaved, webAboveAi } from './app'
import { mathSite, type MathSite, TAGGED } from './fixtures/math-page'

let site: MathSite
test.beforeAll(async () => {
  site = await mathSite()
})
test.afterAll(() => site.close())

const NOTE = '课程/学习笔记.md'
const TITLE = '学习笔记'
const paired = () => `---\nread-along: ${site.base}/\n---\n# ${TITLE}\n\n先看矩阵。\n`
const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const guest = <T = unknown>(page: Page, code: string) =>
  page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code) as Promise<T>
const file = (run: Running) => readFileSync(join(run.vault, NOTE), 'utf8')

async function openWeb(page: Page) {
  if (!(await web(page).isVisible())) await rail(page).getByRole('button', { name: '网页', exact: true }).click()
  const addr = web(page).getByRole('textbox', { name: '网址' })
  await addr.fill(site.url)
  await addr.press('Enter')
  await expect.poll(() => guest(page, 'document.readyState + "|" + location.href')).toBe(`complete|${site.url}`)
}

/** 从 #a 第一个字拖到 #b 最后一个字（真拖），小条出来 */
async function dragSelect(page: Page, a: string, b: string) {
  await guest(page, `document.getElementById(${JSON.stringify(a)}).scrollIntoView({ block: 'start' })`)
  const w = (await web(page).locator('webview.on').boundingBox())!
  for (let i = 0; i < 3; i++) {
    const p = await guest<number[]>(
      page,
      `(() => { const f = document.createRange(); const a = document.getElementById(${JSON.stringify(a)}).firstChild; f.setStart(a, 0); f.setEnd(a, 1); const l = document.createRange(); const bn = document.getElementById(${JSON.stringify(b)}); const t = bn.lastChild; l.setStart(t, t.data.length - 1); l.setEnd(t, t.data.length); const r1 = f.getClientRects()[0], r2 = l.getClientRects()[0]; return [r1.left + 1, r1.top + r1.height / 2, r2.right - 1, r2.top + r2.height / 2] })()`,
    )
    await page.mouse.move(w.x + p[0]!, w.y + p[1]!)
    await page.mouse.down()
    await page.mouse.move(w.x + p[2]!, w.y + p[3]!, { steps: 10 })
    await page.mouse.up()
    if (await expect.poll(() => guest(page, `document.getElementById('cn-clip-host')?.style.display`), { timeout: 1500 }).toBe('block').then(() => true, () => false)) return
  }
  throw new Error('小条没出来')
}
async function clickBar(page: Page, sel: string) {
  const w = (await web(page).locator('webview.on').boundingBox())!
  const p = await guest<{ x: number; y: number }>(page, `(() => { const r = document.getElementById('cn-clip-host').shadowRoot.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
  await page.mouse.click(w.x + p.x, w.y + p.y)
}

test('剪一段：MathJax 3、KaTeX 的公式写成 $…$，块级公式 $$…$$，代码块带语言、只带显示的页签；文档里画成公式；打开再保存不变', async () => {
  const run = await launch({ [NOTE]: paired() }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await openNote(page, TITLE)
    await pane(page).locator('.cm-line', { hasText: '先看矩阵' }).click()
    await page.keyboard.press('End')
    await openWeb(page)
    await dragSelect(page, 'm1', 'm4')
    // 选区碰到的公式、代码块整块铺选中色：5 个行内公式、1 个块级公式、代码块
    expect(await guest<number>(page, `document.querySelectorAll('mjx-container.cn-selblock, .katex.cn-selblock, pre.cn-selblock').length`)).toBeGreaterThanOrEqual(7)
    // 底色是系统选区色（和旁边选中的字一个蓝），块里原生选区透明；行内公式不加外圈、圆角 2，块级圆角 3、外圈 2
    const look = await guest<{ hl: string; inl: string[]; blk: string[]; inner: string }>(
      page,
      `(() => { const p = document.createElement('i'); p.style.background = 'Highlight'; document.body.appendChild(p); const hl = getComputedStyle(p).backgroundColor; p.remove(); const cs = (el) => { const c = getComputedStyle(el); return [c.backgroundColor, c.boxShadow, c.borderRadius] }; const inner = getComputedStyle(document.querySelector('.katex.cn-selblock .katex-html'), '::selection').backgroundColor; return { hl, inl: cs(document.querySelector('.katex.cn-selblock')), blk: cs(document.querySelector('mjx-container[display="true"].cn-selblock')), inner } })()`,
    )
    expect(look.inl).toEqual([look.hl, 'none', '2px'])
    expect(look.blk[0]).toBe(look.hl)
    expect(look.blk[1]).toContain('0px 0px 0px 2px')
    expect(look.blk[2]).toBe('3px')
    expect(look.inner).toBe('rgba(0, 0, 0, 0)')
    // 小条 1px 浅色内描边
    expect(await guest<string>(page, `getComputedStyle(document.getElementById('cn-clip-host').shadowRoot.querySelector('.bar')).boxShadow`)).toContain('rgba(255, 255, 255, 0.14) 0px 0px 0px 1px inset')
    await clickBar(page, 'button.clip')
    await expect(page.locator('.toast-cn')).toContainText(`剪进《${TITLE}》`)
    await expect.poll(() => guest<number>(page, `document.querySelectorAll('.cn-selblock').length`)).toBe(0)
    await waitSaved(page)
    const md = file(run)
    expect(md).toContain('> 我们可以通过行索引（$i$）和列索引（$j$）来访问矩阵中的标量元素。')
    expect(md).toContain(String.raw`> 通过指定两个分量$m$和$n$来创建一个形状为$m\times n$的矩阵。`)
    // Sphinx 的式号「(2.3.7)」写进公式的 \tag，不单独占一行
    expect(md).toContain(`> $$\n> ${TAGGED}\n> $$`)
    expect(md).not.toMatch(/^> \(2\.3\.7\)/m)
    expect(md).toContain('> ```python\n> import torch\n> x = torch.arange(12)\n> ```')
    expect(md).not.toContain('mxnet')
    expect(md).toContain('> 上面的代码创建了一个行向量。')
    // 文档里画成公式（光标不在那几行）
    await pane(page).locator('.cm-line', { hasText: '先看矩阵' }).click()
    await expect.poll(() => pane(page).locator('.cm-math').count()).toBeGreaterThanOrEqual(5)
    // 引文里的整行公式也画成一整块（外面接着引文的竖线），式号画在右边；文档里不露 TeX 原文
    const box = pane(page).locator('.cm-math-inquote.q .cm-math-block')
    await expect(box).toHaveCount(1)
    await expect(box.locator('.katex-tag')).toContainText('2.3.7')
    await expect(pane(page).locator('.cm-line', { hasText: 'begin{bmatrix}' })).toHaveCount(0)
    const bar = await box.evaluate((el) => { const q = el.parentElement!; const cs = getComputedStyle(q); return { w: cs.borderLeftWidth, pad: cs.paddingLeft } })
    expect(bar).toEqual({ w: '2px', pad: '16px' })
    // 引文里的代码块也画成一块（不露「> 」和围栏），外面接着引文的竖线
    await expect(pane(page).locator('.cm-inquote.q .cm-inquote-code')).toHaveText('import torch\nx = torch.arange(12)')
    await expect(pane(page).locator('.cm-line', { hasText: '```python' })).toHaveCount(0)
    // 打开再保存：文件一个字节不变
    const saved = file(run)
    await page.keyboard.press('Meta+w')
    await openNote(page, TITLE)
    await pane(page).locator('.cm-content').click()
    await page.keyboard.press('Meta+s')
    await page.waitForTimeout(800)
    expect(file(run)).toBe(saved)
  } finally {
    await run.close()
  }
})

test('MathJax 2：剪一段写成 $x_i$ 和块级 $$；「引用」进 AI 输入框的材料里也是 $…$', async () => {
  const run = await launch({ [NOTE]: paired() }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await openNote(page, TITLE)
    await pane(page).locator('.cm-line', { hasText: '先看矩阵' }).click()
    await page.keyboard.press('End')
    await openWeb(page)
    await dragSelect(page, 't1', 't2')
    await clickBar(page, 'button.clip')
    await expect(page.locator('.toast-cn')).toContainText(`剪进《${TITLE}》`)
    await waitSaved(page)
    expect(file(run)).toContain('> 向量$x_i$的长度称为维数，求和写成\n> $$\n> \\sum_{i=1}^n x_i\n> $$\n> 这就是向量的和。')
    // 引用：材料里的原文带 $…$
    await dragSelect(page, 'm1', 'm1')
    await clickBar(page, 'button.qt')
    await webAboveAi(page)
    await expect(page.getByRole('complementary', { name: '边读边问 AI' }).getByTestId('ai-mat').first()).toContainText('$i$')
  } finally {
    await run.close()
  }
})

test('整页剪藏：公式写成 $…$ / $$…$$，代码块带语言、只带显示的页签', async () => {
  const run = await launch({ [NOTE]: paired() }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await openNote(page, TITLE)
    await openWeb(page)
    const wc = await page.evaluate(() => (document.querySelector('.right.web webview.on') as unknown as { getWebContentsId(): number }).getWebContentsId())
    await guest(page, 'window.focus()')
    await run.app.evaluate(({ webContents }, id) => {
      const w = webContents.fromId(id)!
      w.sendInputEvent({ type: 'keyDown', keyCode: 'S', modifiers: ['meta', 'shift'] })
      w.sendInputEvent({ type: 'keyUp', keyCode: 'S', modifiers: ['meta', 'shift'] })
    }, wc)
    const inbox = join(run.vault, '收件箱')
    const newest = () => {
      try {
        const all = readdirSync(inbox, { recursive: true }) as string[]
        const mds = all.filter((f) => f.endsWith('.md')).map((f) => join(inbox, f))
        return mds.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] ?? null
      } catch {
        return null
      }
    }
    // 剪藏去处规则（2026-11-25）：这个网站配好对，整页写进那篇末尾（以前另建一篇进收件箱）
    await expect.poll(() => file(run), { timeout: 30_000 }).toContain('$i$')
    expect(newest()).toBeNull()
    const md = file(run)
    expect(md).toContain(String.raw`$m\times n$`)
    expect(md).toContain(`$$\n${TAGGED}\n$$`)
    expect(md).not.toMatch(/^\(2\.3\.7\)/m)
    expect(md).toContain('```python\nimport torch')
    expect(md).not.toContain('mxnet')
    expect(md).toContain('$x_i$')
    expect(md).toContain(String.raw`\sum_{i=1}^n x_i`)
  } finally {
    await run.close()
  }
})

test('单独一个公式：点一下块级公式整块选中、小条出来，点剪藏只剪这一块 $$…$$；停在行内公式上什么都不出，点一下整块选中、小条出来', async () => {
  const run = await launch({ [NOTE]: paired() }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await openNote(page, TITLE)
    await pane(page).locator('.cm-line', { hasText: '先看矩阵' }).click()
    await page.keyboard.press('End')
    await openWeb(page)
    await guest(page, `document.getElementById('m2').scrollIntoView({ block: 'start' })`)
    const w = (await web(page).locator('webview.on').boundingBox())!
    const at = (code: string) => guest<{ x: number; y: number }>(page, `(() => { const r = (${code}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
    // 公式排版、网页自己的脚本跑完以前点下去可能落空（排完那一块挪了位置）：同 dragSelect，每次重新量、最多点 3 次
    for (let i = 0; i < 3; i++) {
      const big = await at(`document.querySelector('mjx-container[display="true"]')`)
      await page.mouse.click(w.x + big.x, w.y + big.y)
      if (await expect.poll(() => guest(page, `document.getElementById('cn-clip-host')?.style.display`), { timeout: 1500 }).toBe('block').then(() => true, () => false)) break
    }
    await expect.poll(() => guest(page, `document.getElementById('cn-clip-host')?.style.display`)).toBe('block')
    await clickBar(page, 'button.clip')
    await expect(page.locator('.toast-cn')).toContainText(`剪进《${TITLE}》`)
    await waitSaved(page)
    const md = file(run)
    expect(md).toContain(`> $$\n> ${TAGGED}\n> $$`)
    expect(md).not.toContain('当调用函数')
    // 停在行内公式上：不出小条，也没有角上那颗（引用、剪藏选中才出）
    await guest(page, 'getSelection().removeAllRanges()')
    await expect.poll(() => guest(page, `document.getElementById('cn-clip-host').style.display`)).toBe('none')
    const km = await at(`document.querySelectorAll('.katex')[2]`)
    await page.mouse.move(w.x + 5, w.y + 5)
    await page.mouse.move(w.x + km.x, w.y + km.y, { steps: 5 })
    await page.waitForTimeout(1000)
    expect(await guest(page, `document.getElementById('cn-clip-host').style.display`)).toBe('none')
    expect(await guest(page, `[...document.documentElement.children].filter((e) => e.tagName === 'DIV' && e.id.startsWith('cn-') && !['cn-clip-host', 'cn-mark-host'].includes(e.id) && getComputedStyle(e).display !== 'none').map((e) => e.id)`)).toEqual([])
    // 点一下行内公式：整块选中，小条出来
    await page.mouse.click(w.x + km.x, w.y + km.y)
    await expect.poll(() => guest(page, `document.getElementById('cn-clip-host')?.style.display`)).toBe('block')
    expect(await guest<string>(page, 'getSelection().toString()')).toContain('m×n')
  } finally {
    await run.close()
  }
})

test('剪整节：选着标题时 ⋯ 里「剪整节」，这个标题到下一个同级标题之间全剪进来（公式写成 $…$、$$…$$）', async () => {
  const run = await launch({ [NOTE]: paired() }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await openNote(page, TITLE)
    await pane(page).locator('.cm-line', { hasText: '先看矩阵' }).click()
    await page.keyboard.press('End')
    await openWeb(page)
    await dragSelect(page, 'h-mj2', 'h-mj2')
    await clickBar(page, 'button.more')
    // 「剪整节」排在 ⋯ 第一项
    expect(await guest<string>(page, `document.getElementById('cn-clip-host').shadowRoot.querySelector('.menu [data-k]').dataset.k`)).toBe('section')
    const w = (await web(page).locator('webview.on').boundingBox())!
    const sec = await guest<{ x: number; y: number } | null>(page, `(() => { const b = document.getElementById('cn-clip-host').shadowRoot.querySelector('[data-k="section"]'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
    expect(sec).not.toBeNull()
    await page.mouse.click(w.x + sec!.x, w.y + sec!.y)
    await expect(page.locator('.toast-cn')).toContainText(`剪进《${TITLE}》`)
    await waitSaved(page)
    const md = file(run)
    expect(md).toContain('> 2.3.4. 张量')
    expect(md).toContain('> 向量$x_i$的长度称为维数，求和写成\n> $$\n> \\sum_{i=1}^n x_i\n> $$\n> 这就是向量的和。')
    expect(md).not.toContain('2.3.3. 矩阵')
  } finally {
    await run.close()
  }
})
