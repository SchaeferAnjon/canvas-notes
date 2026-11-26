// 选中小条统一、网页的笔记写进正在剪进去的那篇、拿掉术语表（task-6cxtc，设计稿 /private/tmp/canvas-notes-visual/11-选中小条/，
// 偏好「选中小条统一、合成那颗叫引用」「网页的笔记记在正在剪进去的那篇」「术语表功能拿掉」）：
// - 四处小条一个顺序：讲解一下 ↵ · 翻译 + 讲一讲 · 引用 ⌘↵ ｜ 各自特有的（网页选字「剪藏 ⌘S」）· ⋯（框着的还有 ×）；
// - 引用：这段（字或截图）成为那一处 AI 输入框顶上的一块材料、光标进去，接着选别处再点攒成 ①②；
// - 网页上讲解一下、翻译 + 讲一讲、引用后问的，写进这个网页正在剪进去的那篇本身（2026-11-24 AI 对话记笔记开关，
//   偏好「剪藏和AI笔记同一篇」：中间开着插在光标处，一问一个小标题，选的那段带回到网页那一段的来源行，再是 AI 回答框）；
//   剪藏 ⌘S 也写进那篇，来源那一行是同样的链接；底栏说剪到了哪，带「撤回」「换一篇」；
// - 右栏「笔记」标签在开着配好对的网页时也亮，只列那篇里来自这一页的，点一条网页跳回那段、亮一下；
// - 还没配对时第一次问 / 剪，小条下面问一句记到哪篇，「记到这篇」顺手配成一对；
// - 术语表的按钮、菜单、设置都没了。
// 一律无头（CN_E2E=1）、假 AI（CN_AI_FAKE=1）、本机假网页（fixtures/d2l-pandas.ts），不上网。
import { expect, test, type Locator, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { editorText, launch, openNote, pane, rail, type Running, tabOn, waitSaved, webAboveAi, widenRight } from './app'
import { d2l, type D2l, P1, P1_LAST, P2, P2_PART } from './fixtures/d2l-pandas'
import { LECTURE } from './fixtures/pdf'
import { fragmentUrl } from '../src/shared/web-link'

const NOTE = '课程/学习笔记：动手学深度学习.md'
const TITLE = '学习笔记：动手学深度学习'
const noteMd = (vault: string) => (existsSync(join(vault, NOTE)) ? readFileSync(join(vault, NOTE), 'utf8') : '')
const NOTE2 = '课程/第二章的习题.md'
const TITLE2 = '第二章的习题'
const PDF = '课程/线代/第3讲.pdf'
const HTML = '课程/线代/旋转矩阵.html'
const VIZ = `<!doctype html><html><head><meta charset="utf-8"><title>旋转矩阵</title></head>
<body style="margin:0;font:16px sans-serif;background:#fff"><div id="box" style="margin:24px;width:320px;height:200px;background:#e8eefc">R(θ) 的第一列是转完的 e₁</div></body></html>`

let site: D2l
test.beforeAll(async () => {
  site = await d2l()
})
test.afterAll(() => site.close())

const BODY = `# ${TITLE}\n\n## 2.2 数据预处理\n\n先把数据读进来，再处理缺失值。\n`
const paired = () => `---\nread-along: ${site.base}/\n---\n${BODY}`

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const reading = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })
const notesTab = (page: Page) => page.getByRole('complementary', { name: '笔记', exact: true })
const chooser = (page: Page) => page.getByRole('dialog', { name: '记到哪篇' })
const gitOut = (vault: string, ...args: string[]) => execFileSync('git', ['-C', vault, ...args], { encoding: 'utf8' }).trim()

function guest<T = unknown>(page: Page, code: string): Promise<T> {
  return page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code) as Promise<T>
}
const wcId = (page: Page) => page.evaluate(() => (document.querySelector('.right.web webview.on') as unknown as { getWebContentsId(): number }).getWebContentsId())

/** 网页里按键：Playwright 的 keyboard 到不了 webview 里的网页，从主进程往网页送真的按键（走网页预加载的监听） */
async function pressInPage(run: Running, key: string, modifiers: ('alt' | 'meta' | 'shift')[] = []) {
  await run.app.evaluate(
    ({ webContents }, [id, k, mods]) => {
      const wc = webContents.fromId(id as number)!
      wc.sendInputEvent({ type: 'keyDown', keyCode: k as string, modifiers: mods as ('alt' | 'meta' | 'shift')[] })
      if (k === 'Return' || k === 'Enter') wc.sendInputEvent({ type: 'char', keyCode: '\r', modifiers: mods as ('alt' | 'meta' | 'shift')[] })
      wc.sendInputEvent({ type: 'keyUp', keyCode: k as string, modifiers: mods as ('alt' | 'meta' | 'shift')[] })
    },
    [await wcId(run.page), key, modifiers] as const,
  )
}

async function openWeb(page: Page, u: string) {
  if (!(await web(page).isVisible())) await rail(page).getByRole('button', { name: '网页' }).click()
  const addr = web(page).getByRole('textbox', { name: '网址' })
  await addr.click()
  await addr.fill(u)
  await addr.press('Enter')
  await expect.poll(() => guest(page, 'document.readyState + "|" + location.href')).toBe(`complete|${u}`)
}

/** 网页里一处的中心（窗口坐标） */
async function guestPoint(page: Page, code: string) {
  const w = (await web(page).locator('webview.on').boundingBox())!
  const r = await guest<{ x: number; y: number; width: number; height: number }>(page, `(() => { const r = (${code}).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`)
  return { x: w.x + r.x + r.width / 2, y: w.y + r.y + r.height / 2 }
}

/** 在网页的 #id 里用鼠标从 from 拖到 to（真拖，选区是网页自己算的）；选好以后小条出来 */
async function selectIn(page: Page, id: string, from: string, to: string) {
  await guest(page, `document.getElementById(${JSON.stringify(id)}).scrollIntoView({ block: 'center' })`)
  for (let i = 0; i < 3; i++) {
    const w = (await web(page).locator('webview.on').boundingBox())!
    const pts = await guest<number[]>(
      page,
      `(() => {
        const root = document.getElementById(${JSON.stringify(id)})
        const a = ${JSON.stringify(from)}, b = ${JSON.stringify(to)}
        const t = root.firstChild
        const s = t.data.indexOf(a), e = t.data.indexOf(b, s) + b.length
        const r = document.createRange(); r.setStart(t, s); r.setEnd(t, e)
        const rs = r.getClientRects(), f = rs[0], l = rs[rs.length - 1]
        return [f.left + 1, f.top + f.height / 2, l.right - 1, l.top + l.height / 2]
      })()`,
    )
    await page.mouse.move(w.x + pts[0]!, w.y + pts[1]!)
    await page.mouse.down()
    await page.mouse.move(w.x + pts[2]!, w.y + pts[3]!, { steps: 8 })
    await page.mouse.up()
    const want = `${from}…${to}`
    const got = await expect
      .poll(() => guest<string>(page, `(() => { const s = getSelection().toString().replace(/\\s+/g, ' ').trim(); return s.startsWith(${JSON.stringify(from)}) && s.endsWith(${JSON.stringify(to)}) ? ${JSON.stringify(want)} : s })()`), { timeout: 1500 })
      .toBe(want)
      .then(() => true, () => false)
    if (got) break
  }
  await expect.poll(() => guest(page, `document.getElementById('cn-clip-host')?.style.display`)).toBe('block')
}

/** 网页选字小条上的几颗（按钮上的字，键帽也算） */
const barTexts = (page: Page) => guest<string[]>(page, `[...document.getElementById('cn-clip-host').shadowRoot.querySelectorAll('.bar > button')].map((b) => b.textContent.replace(/\\s+/g, ' ').trim())`)
/** 网页选字小条上点一颗（真点：量它在网页里的位置） */
async function clickBar(page: Page, label: string) {
  const p = await guestPoint(page, `[...document.getElementById('cn-clip-host').shadowRoot.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || b.textContent).trim().startsWith(${JSON.stringify(label)}))`)
  await page.mouse.click(p.x, p.y)
}

/** 网页上按住 ⌘ 框住 #id 那一段 */
async function boxIn(page: Page, id: string) {
  await guest(page, `document.getElementById(${JSON.stringify(id)}).scrollIntoView({ block: 'center' })`)
  const w = (await web(page).locator('webview.on').boundingBox())!
  const r = await guest<{ x: number; y: number; width: number; height: number }>(page, `(() => { const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`)
  await page.keyboard.down('Meta')
  await page.mouse.move(w.x + r.x - 4, w.y + r.y - 4)
  await page.mouse.down()
  await page.mouse.move(w.x + r.x + r.width / 2, w.y + r.y + r.height / 2, { steps: 5 })
  await page.mouse.move(w.x + r.x + r.width + 4, w.y + r.y + r.height + 4, { steps: 5 })
  await page.mouse.up()
  await page.keyboard.up('Meta')
}

/** 网页上一块自己画的东西在窗口里的方框（看不见是 null）：选字的小条、框好的那块下面的工具条 */
async function shownBox(page: Page, code: string) {
  const w = (await web(page).locator('webview.on').boundingBox())!
  const r = await guest<{ x: number; y: number; width: number; height: number } | null>(page, `(() => { const e = ${code}; if (!e) return null; const r = e.getBoundingClientRect(); return r.width ? { x: r.x, y: r.y, width: r.width, height: r.height } : null })()`)
  return r && { x: w.x + r.x, y: w.y + r.y, width: r.width, height: r.height }
}
const selBar = (page: Page) => shownBox(page, `document.getElementById('cn-clip-host')?.style.display === 'block' ? document.getElementById('cn-clip-host').shadowRoot.querySelector('.bar') : null`)
const boxBar = (page: Page) => shownBox(page, `(() => { const c = document.getElementById('cn-box-host')?.shadowRoot?.querySelector('.cap'); return c && c.style.display === 'flex' ? c : null })()`)
/** 小条离选中的底色多远：底色按整行高铺（d2l 行高是字的两倍），字的方框上下各矮半个行距 */
const barGap = (page: Page) =>
  guest<number>(
    page,
    `(() => { const s = getSelection(); const rg = s.getRangeAt(0); const r = rg.getClientRects()[0]; const lh = parseFloat(getComputedStyle(rg.startContainer.parentElement).lineHeight); const top = r.top - (lh > r.height ? (lh - r.height) / 2 : 0); const b = document.getElementById('cn-clip-host').shadowRoot.querySelector('.bar').getBoundingClientRect(); return Math.round(top - b.bottom) })()`,
  )

const pdfPane = (page: Page) => page.locator('.pdfpane:not([hidden])')
const pdfPage = (page: Page, n: number) => pdfPane(page).locator(`.pdfpage[data-page="${n}"]`)

async function openFile(page: Page, name: string, tab: string) {
  await page.keyboard.press('Meta+o')
  await page.getByRole('textbox', { name: '按名字跳到文件' }).fill(name)
  await page.keyboard.press('Enter')
  await expect(tabOn(page)).toHaveText(tab)
}

async function drawPdfBox(page: Page, n: number) {
  const el = pdfPage(page, n)
  await el.scrollIntoViewIfNeeded()
  const r = (await el.boundingBox())!
  await page.mouse.move(r.x + r.width * 0.1, r.y + r.height * 0.2)
  await page.mouse.down()
  await page.mouse.move(r.x + r.width * 0.6, r.y + r.height * 0.45, { steps: 6 })
  await page.mouse.up()
}

async function selectPdfSpan(page: Page, n: number, text: string) {
  const span = pdfPage(page, n).locator('.textLayer span', { hasText: text })
  await span.scrollIntoViewIfNeeded()
  const sb = (await span.boundingBox())!
  await page.mouse.move(sb.x + 2, sb.y + sb.height / 2)
  await page.mouse.down()
  await page.mouse.move(sb.x + sb.width - 2, sb.y + sb.height / 2, { steps: 6 })
  await page.mouse.up()
}

/** 中间编辑器里点一处看得到的字（真点） */
async function clickShown(page: Page, text: string) {
  const at = await pane(page)
    .locator('.cm-content')
    .evaluate((root, t) => {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      while (w.nextNode()) {
        const n = w.currentNode as Text
        const i = n.data.indexOf(t)
        if (i < 0) continue
        const r = document.createRange()
        r.setStart(n, i)
        r.setEnd(n, i + t.length)
        r.startContainer.parentElement?.scrollIntoView({ block: 'center' })
        const b = r.getBoundingClientRect()
        return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
      }
      return null
    }, text)
  expect(at, `编辑器里看得到「${text}」`).not.toBeNull()
  await page.mouse.click(at!.x, at!.y)
}

/** 网页里 #id 那一段在不在看得见的地方（顶在窗口上半截） */
const inView = (page: Page, id: string) => guest<boolean>(page, `(() => { const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight * 0.6 })()`)
/** 网页 #id 里那几句露在外面：在钉着的蓝色头下面、窗口上半截（回到那几句时不能被网页钉着的头盖住） */
const textInView = (page: Page, id: string, text: string) =>
  guest<boolean>(
    page,
    `(() => { const t = document.getElementById(${JSON.stringify(id)}).firstChild; const i = t.data.indexOf(${JSON.stringify(text)}); const r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + ${text.length}); const b = r.getClientRects()[0]; const head = document.querySelector('.mdl-layout__header').getBoundingClientRect().bottom; return b.top >= head && b.top < innerHeight * 0.6 })()`,
  )
/** 网页上亮着的那几块（回到那段时亮 1.6 秒） */
const flashed = (page: Page) => guest<number>(page, `(() => { const h = document.getElementById('cn-mark-host'); return h && h.shadowRoot ? h.shadowRoot.querySelectorAll('.flash').length : 0 })()`)

test('网页选字的小条：讲解一下 ↵ · 翻译 + 讲一讲 · 引用 ⌘↵ ｜ 剪藏 ⌘S · ⋯；「剪藏」悬停说剪进哪篇；⋯ 里只看译文、翻译设置…、剪到哪篇…、拷贝；选一个词也没有术语表', async () => {
  const run = await launch({ [NOTE]: paired() }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await openNote(page, TITLE)
    await widenRight(page, 260)
    await openWeb(page, site.pandas)
    await selectIn(page, 'p1', '举一个例子', '写入CSV文件中。')
    // task-26nz7：⋯ 前面也一道竖线，最后多一颗 ×（右键：这个网站不弹）
    expect(await barTexts(page)).toEqual(['讲解一下↵', '翻译 + 讲一讲', '引用⌘↵', '剪藏⌘S', '', ''])
    // 离选中的底色 6（designer 复审：原来只差 1）
    expect(Math.abs((await barGap(page)) - 6)).toBeLessThanOrEqual(1)
    expect(await guest(page, `document.getElementById('cn-clip-host').shadowRoot.querySelector('.bar > button:last-of-type').getAttribute('aria-label')`)).toBe('收起（右键或按住：这个网站不弹…）')
    // 「引用」和「剪藏」之间一道竖线：后面是网页自己特有的
    expect(await guest(page, `(() => { const b = document.getElementById('cn-clip-host').shadowRoot.querySelector('.bar'); const kids = [...b.children]; const s = kids.findIndex((e) => e.classList.contains('sep')); return [kids[s - 1].textContent.trim().startsWith('引用'), kids[s + 1].textContent.trim().startsWith('剪藏')] })()`)).toEqual([true, true])
    // 指着「剪藏」：说剪进哪篇、剪完底栏能撤回、能换一篇
    const clip = await guestPoint(page, `[...document.getElementById('cn-clip-host').shadowRoot.querySelectorAll('.bar > button')].find((b) => b.textContent.includes('剪藏'))`)
    await page.mouse.move(clip.x, clip.y)
    await expect.poll(() => guest(page, `document.getElementById('cn-clip-host').shadowRoot.querySelector('.tip')?.innerText.replace(/\\n+/g, '|')`)).toBe(`剪进《${TITLE}》光标处|剪完底栏说剪到了哪，能撤回、能换一篇`)
    // ⋯
    await clickBar(page, '更多')
    await expect
      .poll(() => guest(page, `[...document.getElementById('cn-clip-host').shadowRoot.querySelectorAll('.more-menu [role=menuitem]')].map((b) => b.textContent.replace(/\\s+/g, ' ').trim())`))
      .toEqual(['只看译文不进对话', '拷贝⌘C', '翻译设置…', `剪到哪篇…${TITLE}`, '加一颗…拿这段试', '小条设置…'])
    await pressInPage(run, 'Escape')

    // 选一个词：没有「加进术语表」，⋯ 里也没有「固定这个词的译法」
    await guest(page, `document.getElementById('p2').scrollIntoView({ block: 'center' })`)
    const word = await guestPoint(page, `(() => { const t = document.getElementById('p2').firstChild; const r = document.createRange(); const i = t.data.indexOf('插值法'); r.setStart(t, i); r.setEnd(t, i + 3); return r })()`)
    for (let i = 0; i < 3; i++) {
      await page.mouse.dblclick(word.x, word.y)
      if (await expect.poll(() => guest(page, 'getSelection().toString().trim().length'), { timeout: 1000 }).toBeGreaterThan(0).then(() => true, () => false)) break
    }
    await expect.poll(() => guest(page, `document.getElementById('cn-clip-host').style.display`)).toBe('block')
    expect((await barTexts(page)).join('|')).not.toContain('术语')
    await clickBar(page, '更多')
    await expect.poll(() => guest<number>(page, `document.getElementById('cn-clip-host').shadowRoot.querySelectorAll('.more-menu [role=menuitem]').length`)).toBe(6)
    expect(await guest(page, `document.getElementById('cn-clip-host').shadowRoot.querySelector('.menu').textContent`)).not.toMatch(/术语|固定这个词/)
  } finally {
    await run.close()
  }
})

test('四处小条一个样：网页按住 ⌘ 框一块、PDF 选字、PDF 框一块、HTML 框一块都是 讲解一下 ↵ · 翻译 + 讲一讲 · 引用 ⌘↵ ｜ ⋯ · ×；PDF 的 ⋯ 是拷贝、翻译设置', async () => {
  const run = await launch({ [NOTE]: paired(), [PDF]: LECTURE, [HTML]: VIZ }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await openNote(page, TITLE)
    await widenRight(page, 200)
    await openWeb(page, site.pandas)
    // 网页上按住 ⌘ 框一块
    await boxIn(page, 'p1')
    await expect.poll(() => guest(page, `document.getElementById('cn-box-host')?.shadowRoot?.querySelector('.cap')?.style.display`)).toBe('flex')
    expect(await guest(page, `[...document.getElementById('cn-box-host').shadowRoot.querySelectorAll('.cap > button')].map((b) => b.textContent.replace(/\\s+/g, ' ').trim() || b.getAttribute('aria-label'))`)).toEqual([
      '讲解一下↵',
      '翻译 + 讲一讲',
      '引用⌘↵',
      '更多',
      '取消',
    ])
    await pressInPage(run, 'Escape')

    // PDF 选字
    await openFile(page, '第3讲', '第3讲.pdf')
    await expect(pdfPage(page, 1).locator('canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
    await selectPdfSpan(page, 2, 'for every scalar c')
    const cap = pdfPane(page).getByRole('toolbar', { name: '框好的这块' })
    await expect(cap).toBeVisible()
    // 选了字时「引用」后面是这一处特有的四颗划线（ParaRead 联动：重点、定义、想引用、看不懂）
    await expect(cap.getByRole('button')).toHaveText(['讲解一下↵', '翻译 + 讲一讲', '引用⌘↵', '重点', '定义', '想引用', '看不懂', '', ''])
    await expect(cap.getByRole('button').nth(7)).toHaveAttribute('aria-label', '更多')
    await expect(cap.getByRole('button').nth(8)).toHaveAttribute('aria-label', '取消')
    await cap.getByRole('button', { name: '更多' }).click()
    await expect(page.getByRole('menu', { name: '这段还能做什么' }).getByRole('menuitem')).toHaveText(['拷贝这段⌘C', '翻译设置…', '加一颗…拿这段试', '小条设置…'])
    await page.keyboard.press('Escape')
    // PDF 框一块
    await drawPdfBox(page, 2)
    await expect(cap).toBeVisible()
    await expect(cap.getByRole('button')).toHaveText(['讲解一下↵', '翻译 + 讲一讲', '引用⌘↵', '', ''])
    await cap.getByRole('button', { name: '更多' }).click()
    await expect(page.getByRole('menu', { name: '这块还能做什么' }).getByRole('menuitem')).toHaveText(['拷贝这块', '翻译设置…', '加一颗…拿这段试', '小条设置…'])
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')

    // HTML 框一块
    await openFile(page, '旋转矩阵', '旋转矩阵')
    const hp = page.locator('.htmlpane:not([hidden])')
    await expect(page.frameLocator('[data-testid="html-frame"]').locator('#box')).toBeVisible()
    await page.locator('[data-testid="tab-acts"]').getByRole('button', { name: '框一块问' }).click()
    const b = (await page.frameLocator('[data-testid="html-frame"]').locator('#box').boundingBox())!
    await page.mouse.move(b.x - 6, b.y - 6)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width + 6, b.y + b.height + 6, { steps: 6 })
    await page.mouse.up()
    const hcap = hp.getByRole('toolbar', { name: '框好的这块' })
    await expect(hcap).toBeVisible()
    await expect(hcap.getByRole('button')).toHaveText(['讲解一下↵', '翻译 + 讲一讲', '引用⌘↵', '', ''])
  } finally {
    await run.close()
  }
})

test('引用 ⌘↵：网页上选一段按 ⌘↵、再选一段点「引用」，攒成 ①② 进网页那一处的输入框、光标在里面；PDF 上选字 ⌘↵、框一块点「引用」也攒成 ①②', async () => {
  const run = await launch({ [NOTE]: paired(), [PDF]: LECTURE }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await openNote(page, TITLE)
    await widenRight(page, 200)
    await openWeb(page, site.pandas)
    await selectIn(page, 'p1', '下面我们将', '写入CSV文件中。')
    await pressInPage(run, 'Return', ['meta'])
    const r = reading(page)
    const ta = r.getByRole('textbox', { name: '问 AI' })
    await expect(ta).toHaveValue('①')
    await expect(ta).toBeFocused()
    // 文档没变：引用不是剪藏
    expect(await editorText(page)).toBe(paired())
    // AI 和网页叠在一组、AI 在前面：像人一样把网页拖到上半，一边看网页一边攒引用
    await webAboveAi(page)
    await selectIn(page, 'p2', '典型的方法', '插值法和删除法')
    await clickBar(page, '引用')
    await expect(ta).toHaveValue('①②')
    await expect(ta).toBeFocused()
    const chips = r.getByTestId('ai-mat')
    await expect(chips).toHaveCount(2)
    await expect(chips.locator('.ct')).toHaveText([P1_LAST, P2_PART])
    await expect(chips.locator('.cs')).toHaveText(['2.2.1 读取数据集', '2.2.2 处理缺失值'])

    // PDF：选字 ⌘↵，框一块点「引用」
    await openFile(page, '第3讲', '第3讲.pdf')
    await expect(pdfPage(page, 1).locator('canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
    await selectPdfSpan(page, 2, 'for every scalar c')
    const cap = pdfPane(page).getByRole('toolbar', { name: '框好的这块' })
    await expect(cap).toBeVisible()
    await page.keyboard.press('Meta+Enter')
    await expect(ta).toHaveValue('①')
    await expect(ta).toBeFocused()
    await drawPdfBox(page, 3)
    await expect(cap).toBeVisible()
    await cap.getByRole('button', { name: /^引用/ }).click()
    await expect(ta).toHaveValue('①②')
    await expect(ta).toBeFocused()
    await expect(r.getByTestId('ai-mat')).toHaveCount(2)
    await expect(r.getByTestId('ai-mat').nth(1)).toHaveAttribute('data-src', '第3页 · 我框的')
    await expect(cap).toHaveCount(0)
    await expect(r.getByTestId('reading-att')).toHaveCount(0)
  } finally {
    await run.close()
  }
})

test('网页剪藏 ⌘S：写进配好对的那篇光标处，来源一行是回到这一段的链接；底栏说剪到了哪，「撤回」拿掉，「换一篇」挪到别的一篇', async () => {
  const run = await launch({ [NOTE]: paired(), [NOTE2]: `# ${TITLE2}\n\n第一题。\n` }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await openNote(page, TITLE)
    await widenRight(page, 200)
    await pane(page).locator('.cm-line', { hasText: '先把数据读进来' }).click()
    await page.keyboard.press('End')
    await openWeb(page, site.pandas)
    await selectIn(page, 'p1', '举一个例子', '写入CSV文件中。')
    await pressInPage(run, 'S', ['meta'])
    const toast = page.getByTestId('toast')
    await expect(toast).toContainText(`剪进《${TITLE}》光标处`)
    await expect(toast.getByRole('button', { name: '换一篇' })).toBeVisible()
    await expect(toast.getByRole('button', { name: '撤回' })).toBeVisible()
    const clipMd = `> ${P1}\n—— [2.2.1 读取数据集 · 动手学深度学习](${fragmentUrl(site.pandas, P1)})`
    await waitSaved(page)
    expect(await editorText(page)).toBe(paired().replace('再处理缺失值。\n', `再处理缺失值。\n\n${clipMd}\n\n`))
    expect(readFileSync(join(vault, NOTE), 'utf8')).toContain(clipMd)
    // 撤回：那篇回到剪之前
    await toast.getByRole('button', { name: '撤回' }).click()
    await waitSaved(page)
    // 撤回是盘上原子写回去再由监听合进编辑器，等它到
    await expect.poll(() => editorText(page)).toBe(paired())

    // 再剪一次，点「换一篇」：问记到哪篇，选别的一篇，挪过去
    await selectIn(page, 'p1', '举一个例子', '写入CSV文件中。')
    await clickBar(page, '剪藏')
    await expect(toast).toContainText(`剪进《${TITLE}》光标处`)
    await toast.getByRole('button', { name: '换一篇' }).click()
    const dlg = chooser(page)
    await expect(dlg).toBeVisible()
    await dlg.getByRole('radio', { name: /选别的一篇/ }).click()
    await dlg.getByRole('textbox', { name: '找一篇' }).fill('习题')
    await dlg.getByRole('option', { name: new RegExp(TITLE2) }).click()
    await dlg.getByRole('button', { name: /记到这篇/ }).click()
    await expect(dlg).toHaveCount(0)
    await expect(toast).toContainText(`挪到《${TITLE2}》了`)
    await waitSaved(page)
    expect(await editorText(page)).toBe(paired())
    await expect.poll(() => readFileSync(join(vault, NOTE2), 'utf8')).toContain(clipMd)
  } finally {
    await run.close()
  }
})

test('网页上讲解一下：写进剪藏那篇本身、插在光标处（问的原话做小标题、选的那段带回到网页那一段的链接、AI 回答框）；点「↩」网页滚回那段、亮一下', async () => {
  const run = await launch({ [NOTE]: paired() }, { CN_AI_FAKE: '1', CN_FAKE_NOTE_MS: '50' })
  const { page, vault } = run
  try {
    await openNote(page, TITLE)
    await widenRight(page, 200)
    await pane(page).locator('.cm-line', { hasText: '先把数据读进来' }).click()
    await page.keyboard.press('End')
    await openWeb(page, site.pandas)
    await selectIn(page, 'p1', '下面我们将', '写入CSV文件中。')
    await clickBar(page, '讲解一下')
    await expect(reading(page).locator('.um').last()).toHaveText('给我讲解一下')
    const link = `[2.2.1 读取数据集 ↩](${fragmentUrl(site.pandas, P1_LAST)})`
    await expect.poll(() => noteMd(vault), { timeout: 15_000 }).toContain(link)
    expect(noteMd(vault)).toContain(`### 给我讲解一下\n\n> ${P1_LAST}\n> —— ${link}\n\n> [!ai] AI 回答 · Claude Code · `)
    await expect.poll(() => gitOut(vault, 'log', '-1', '--format=%s')).toBe(`笔记：${TITLE} · 给我讲解一下`)
    await expect(reading(page).getByTestId('ai-noted')).toContainText(`已记进《${TITLE}》`)
    await waitSaved(page)
    // 插在光标处：自己那句后面接着问的那句
    expect(noteMd(vault)).toContain('先把数据读进来，再处理缺失值。\n\n### 给我讲解一下\n')
    expect(noteMd(vault)).not.toContain('AI 笔记')

    // 「已记进」点了中间是那篇、定位到这一问（亮一下）；右栏网页不动（这篇和网页配成一对，以前点了网页跟着跳回书的开头）
    const before = await guest<string>(page, 'location.href')
    await reading(page).getByTestId('ai-noted').getByRole('button').first().click()
    await expect(tabOn(page)).toContainText(TITLE)
    await expect(pane(page).locator('.cm-line', { hasText: '给我讲解一下' }).first()).toBeInViewport()
    await page.waitForTimeout(600)
    expect(await guest<string>(page, 'location.href')).toBe(before)
    expect(await guest<boolean>(page, '!!document.getElementById("p1")')).toBe(true)
    // 网页滚走，点来源行那个「↩」：网页回到那段、亮一下
    await guest(page, 'window.scrollTo(0, document.body.scrollHeight)')
    await expect.poll(() => inView(page, 'p1')).toBe(false)
    await clickShown(page, '2.2.1 读取数据集 ↩')
    await expect.poll(() => textInView(page, 'p1', P1_LAST)).toBe(true)
    await expect.poll(() => flashed(page)).toBeGreaterThan(0)
  } finally {
    await run.close()
  }
})

test('右栏「笔记」：开着配好对的网页时亮，只列那篇里来自这一页的；点一条网页跳回那段、亮一下，中间那篇滚到这一条', async () => {
  const one = (label: string, url: string, quote: string, head: string) => `> [!ai] ${label} · Claude Code · Opus 5.5 · [${head} ↩](${url})\n> > ${quote}\n>\n> 回答。\n`
  const pandas = site.pandas
  const longFill = Array.from({ length: 40 }, (_, i) => `自己写的第${i + 1}段。`).join('\n\n')
  const text = `${paired()}\n> ${P1}\n—— [2.2.1 读取数据集 · 动手学深度学习](${fragmentUrl(pandas, P1)})\n\n${one('讲解一下', fragmentUrl(pandas, P1_LAST), P1_LAST, '2.2.1 读取数据集')}\n${longFill}\n\n${one('你问：插值法和删除法各适合什么时候？', fragmentUrl(pandas, P2_PART), P2_PART, '2.2.2 处理缺失值')}\n${one('讲解一下', fragmentUrl(site.ndarray, '张量表示一个由数值组成的数组'), '张量表示一个由数值组成的数组', '2.1.1 入门')}`
  const run = await launch({ [NOTE]: text }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await openNote(page, TITLE)
    await widenRight(page, 200)
    await openWeb(page, pandas)
    const btn = rail(page).getByRole('button', { name: /^笔记/ })
    await expect(btn).not.toHaveClass(/\bdim\b/)
    await btn.click()
    const n = notesTab(page)
    await expect(n).toBeVisible()
    // 照设计稿摆法 B：笔记标签拖到网页下面（把网页拖到这一组的上半），一边看网页一边留着清单
    await webAboveAi(page)
    await expect(page.getByTestId('dtab-note').locator('..').locator('.dsub')).toHaveText(`《${TITLE}》· 来自这个网页`)
    await expect(n.getByRole('tab')).toHaveText(['全部 3', '问的 2', '剪的 1'])
    const rows = n.getByTestId('web-note')
    await expect(rows.locator('.t')).toHaveText(['插值法和删除法各适合什么时候？', `讲解一下「${P1_LAST}」`, /^「举一个例子，我们首先创建一个人工数据集/])
    await expect(rows.locator('.s')).toHaveText(['2.2.2 处理缺失值 · 你问', '2.2.1 读取数据集 · 讲解一下', '2.2.1 读取数据集 · 剪藏'])
    await expect(n.getByText('点一条：网页跳回那段、亮一下；中间那篇滚到这一条')).toBeVisible()
    // 点「你问」那一条：网页跳到 2.2.2 那段、亮一下；中间那篇滚到这一块
    await guest(page, 'window.scrollTo(0, 0)')
    await rows.first().click()
    await expect.poll(() => textInView(page, 'p2', P2_PART)).toBe(true)
    await expect.poll(() => flashed(page)).toBeGreaterThan(0)
    // 小标、点线、亮的那块只画在网页钉着的蓝头（64 高）下面
    await expect.poll(() => guest(page, `document.getElementById('cn-mark-host').style.clipPath`)).toMatch(/^inset\(64px/)
    await expect(pane(page).locator('.cm-line', { hasText: '你问：插值法和删除法各适合什么时候？' })).toBeInViewport()
    // 只看剪的
    await n.getByRole('tab', { name: /^剪的/ }).click()
    await expect(rows).toHaveCount(1)
    // 换到 2.1 那一页：只列那一页的一条
    await openWeb(page, site.ndarray)
    await n.getByRole('tab', { name: /^全部/ }).click()
    await expect(rows).toHaveCount(1)
    await expect(rows.locator('.t')).toHaveText(['讲解一下「张量表示一个由数值组成的数组」'])
  } finally {
    await run.close()
  }
})

test('网页上的小标画在段落左边的空白里、离段首的字 6，不盖字；网页正文贴边、左边只剩一点时那一段让出位置，拿掉了放回去', async () => {
  const pandas = site.pandas
  const text = `${paired()}\n> ${P1}\n—— [2.2.1 读取数据集 · 动手学深度学习](${fragmentUrl(pandas, P1)})\n`
  const run = await launch({ [NOTE]: text }, { CN_AI_FAKE: '1' })
  const { page } = run
  /** 小标和 p1 段首第一个字：盖没盖着、隔多远（网页里的坐标） */
  const lead = () =>
    guest<{ gap: number; overlap: boolean; badgeLeft: number; pad: string }>(
      page,
      `(() => { const b = document.getElementById('cn-mark-host').shadowRoot.querySelector('.mk').getBoundingClientRect(); const p = document.getElementById('p1'); const r = document.createRange(); r.setStart(p.firstChild, 0); r.setEnd(p.firstChild, 1); const c = r.getClientRects()[0]; return { gap: Math.round(c.left - b.right), overlap: !(b.right <= c.left || b.left >= c.right || b.bottom <= c.top || b.top >= c.bottom), badgeLeft: Math.round(b.left), pad: p.style.paddingLeft } })()`,
    )
  try {
    await openNote(page, TITLE)
    await openWeb(page, pandas)
    await guest(page, `document.getElementById('p1').scrollIntoView({ block: 'center' })`)
    await expect.poll(() => guest<number>(page, `document.getElementById('cn-mark-host')?.shadowRoot?.querySelectorAll('.mk').length ?? 0`)).toBe(1)
    // 网页自己的左边空白够：小标在空白里，离段首的字 6，段落不动
    await expect.poll(async () => (await lead()).gap).toBe(6)
    expect(await lead()).toMatchObject({ overlap: false, pad: '' })
    // 右栏拉窄（网页三百来宽）：照样在空白里、不盖字
    await widenRight(page, -260)
    await expect.poll(() => guest<number>(page, 'innerWidth')).toBeLessThan(420)
    await guest(page, `document.getElementById('p1').scrollIntoView({ block: 'center' })`)
    await expect.poll(async () => (await lead()).gap).toBe(6)
    expect((await lead()).overlap).toBe(false)
    // 正文贴着网页左边、左边只剩 12：这一段让出位置，小标还是离字 6、不出网页
    for (const pad of ['0px', '12px']) {
      await guest(page, `document.querySelector('.page').style.paddingLeft = '${pad}'; dispatchEvent(new Event('resize'))`)
      await expect.poll(async () => (await lead()).gap).toBe(6)
      const now = await lead()
      expect(now.overlap).toBe(false)
      expect(now.badgeLeft).toBeGreaterThanOrEqual(0)
      expect(now.pad).not.toBe('')
    }
    // 网页的空白又够了：让出的位置放回去
    await guest(page, `document.querySelector('.page').style.paddingLeft = ''; dispatchEvent(new Event('resize'))`)
    await expect.poll(async () => (await lead()).pad).toBe('')
    expect(await lead()).toMatchObject({ gap: 6, overlap: false })
  } finally {
    await run.close()
  }
})

test('还没配对：第一次点讲解一下，小条下面问记到哪篇（默认中间开着的那篇）；「记到这篇」顺手配成一对，回答写进那篇本身；再问不再问', async () => {
  const run = await launch({ [NOTE]: BODY }, { CN_AI_FAKE: '1', CN_FAKE_NOTE_MS: '50' })
  const { page, vault } = run
  try {
    await openNote(page, TITLE)
    await pane(page).locator('.cm-line', { hasText: '先把数据读进来' }).click()
    await page.keyboard.press('End')
    await openWeb(page, site.pandas)
    await widenRight(page, 200)
    await selectIn(page, 'p1', '下面我们将', '写入CSV文件中。')
    await clickBar(page, '讲解一下')
    const dlg = chooser(page)
    await expect(dlg).toBeVisible()
    // 小条和选区留着，弹层贴在小条下面 6、和小条左对齐（设计稿「第一次问记到哪」）
    const bar = (await selBar(page))!
    expect(bar).not.toBeNull()
    expect(await guest<string>(page, 'getSelection().toString()')).toContain('写入CSV文件中。')
    const d = (await dlg.boundingBox())!
    expect(Math.abs(d.y - (bar.y + bar.height) - 6)).toBeLessThanOrEqual(1)
    expect(Math.abs(d.x - bar.x)).toBeLessThanOrEqual(1)
    // 取消：小条和选区照旧留着，可以换一颗点
    await dlg.getByRole('button', { name: '取消' }).click()
    await expect(dlg).toHaveCount(0)
    expect(await selBar(page)).not.toBeNull()
    expect(await guest<string>(page, 'getSelection().toString()')).toContain('写入CSV文件中。')
    expect(await editorText(page)).not.toContain('[!ai]')
    await clickBar(page, '讲解一下')
    await expect(dlg).toBeVisible()
    await expect(dlg.getByText('这个网页问的、剪的记到哪篇？')).toBeVisible()
    await expect(dlg.getByRole('radio')).toHaveCount(3)
    await expect(dlg.getByRole('radio').nth(0)).toHaveAccessibleName(new RegExp(TITLE))
    await expect(dlg.getByRole('radio').nth(0)).toBeChecked()
    await expect(dlg.getByRole('radio').nth(0)).toContainText('中间开着的')
    await expect(dlg.getByRole('radio').nth(1)).toHaveAccessibleName('选别的一篇…')
    await expect(dlg.getByRole('radio').nth(2)).toHaveAccessibleName('这次只问，不记')
    await expect(dlg).toContainText('记好以后这个网站和这篇配成一对：以后在这里讲解、引用、剪藏的都记进这篇，不再问。')
    await expect(dlg.getByRole('button')).toHaveText(['取消', '记到这篇↵'])
    await dlg.getByRole('button', { name: /记到这篇/ }).click()
    await expect(dlg).toHaveCount(0)
    // 定了：小条收起、选区清掉（AI 开了、叠在网页前面，直接问网页里的）
    await expect.poll(() => guest(page, `document.getElementById('cn-clip-host').style.display`)).toBe('none')
    expect(await guest<string>(page, 'getSelection().toString()')).toBe('')
    // 配成一对：属性里写上这个网站
    await expect.poll(() => editorText(page)).toContain(`read-along: ${site.base}/`)
    await expect.poll(() => noteMd(vault), { timeout: 15_000 }).toContain(`[2.2.1 读取数据集 ↩](${fragmentUrl(site.pandas, P1_LAST)})`)
    await expect.poll(() => editorText(page)).toContain('### 给我讲解一下')
    expect(await editorText(page)).not.toContain('AI 笔记')
    await waitSaved(page)
    // 再问一段：不再问记到哪篇（AI 叠在网页前面：把网页拖到上半，同人一边看一边问）
    await webAboveAi(page)
    await selectIn(page, 'p2', '典型的方法', '插值法和删除法')
    await clickBar(page, '讲解一下')
    await expect.poll(() => noteMd(vault), { timeout: 15_000 }).toContain(`[2.2.2 处理缺失值 ↩](${fragmentUrl(site.pandas, P2_PART)})`)
    await expect(dlg).toHaveCount(0)
    expect(noteMd(vault)).toContain(`> ${P2_PART}`)
    void P2
  } finally {
    await run.close()
  }
})

test('选区刚换、小条还没跟上就按回车：讲解的是现在选中的这句，不是小条上一次记下的', async () => {
  const run = await launch({ [NOTE]: paired() }, { CN_AI_FAKE: '1', CN_FAKE_NOTE_MS: '50' })
  const { page } = run
  try {
    await openNote(page, TITLE)
    await pane(page).locator('.cm-line', { hasText: '先把数据读进来' }).click()
    await page.keyboard.press('End')
    await openWeb(page, site.pandas)
    await widenRight(page, 200)
    await selectIn(page, 'p2', '典型的方法', '插值法和删除法')
    // 同一刻换成 2.2.1 的最后一句、马上按回车（120ms 的防抖还没轮到，小条记着的还是上一段）
    await guest(
      page,
      `(() => { const t = document.getElementById('p1').firstChild; const i = t.data.indexOf(${JSON.stringify(P1_LAST)}); const r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + ${P1_LAST.length}); const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })()`,
    )
    await expect.poll(() => noteMd(run.vault), { timeout: 15_000 }).toContain(`> ${P1_LAST}`)
    expect(noteMd(run.vault)).not.toContain('> 典型的方法')
  } finally {
    await run.close()
  }
})

test('网页上按住 ⌘ 框一块点「讲解一下」（还没配对）：框和工具条留着，记到哪篇贴在工具条下面；取消了框照旧在，记到这篇以后框收起、回答带截图写进那篇本身', async () => {
  const run = await launch({ [NOTE]: BODY }, { CN_AI_FAKE: '1', CN_FAKE_NOTE_MS: '50' })
  const { page } = run
  const explainAt = () => guestPoint(page, `document.getElementById('cn-box-host').shadowRoot.querySelector('[data-k="explain"]')`)
  try {
    await openNote(page, TITLE)
    await pane(page).locator('.cm-line', { hasText: '先把数据读进来' }).click()
    await page.keyboard.press('End')
    await openWeb(page, site.pandas)
    await widenRight(page, 200)
    await boxIn(page, 'p1')
    await expect(reading(page)).toBeVisible()
    // 框好 AI 就开了、叠在网页前面：把网页拖到上半，一边看一边问
    await webAboveAi(page)
    await expect.poll(() => boxBar(page)).not.toBeNull()
    // 网页刚被拖到上半、还在改大小：工具条停稳了（隔 200 毫秒量两次一样）再点
    let ex = await explainAt()
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(200)
      const again = await explainAt()
      if (again.x === ex.x && again.y === ex.y) break
      ex = again
    }
    await page.mouse.click(ex.x, ex.y)
    const dlg = chooser(page)
    await expect(dlg).toBeVisible()
    const bar = (await boxBar(page))!
    expect(bar).not.toBeNull()
    const d = (await dlg.boundingBox())!
    expect(Math.abs(d.y - (bar.y + bar.height) - 6)).toBeLessThanOrEqual(1)
    expect(Math.abs(d.x - bar.x)).toBeLessThanOrEqual(1)
    // 取消：框和工具条照旧在，那篇里什么都没写
    await dlg.getByRole('button', { name: '取消' }).click()
    await expect(dlg).toHaveCount(0)
    expect(await boxBar(page)).not.toBeNull()
    expect(await editorText(page)).not.toContain('[!ai]')
    const ex2 = await explainAt()
    await page.mouse.click(ex2.x, ex2.y)
    await expect(dlg).toBeVisible()
    await dlg.getByRole('button', { name: /记到这篇/ }).click()
    await expect(dlg).toHaveCount(0)
    await expect.poll(() => boxBar(page)).toBeNull()
    await expect.poll(() => noteMd(run.vault), { timeout: 15_000 }).toContain('### 给我讲解一下\n\n![我框的')
    expect(await editorText(page)).toContain(`read-along: ${site.base}/`)
    expect(noteMd(run.vault)).toMatch(/\n—— \[2\.2\.1 读取数据集 ↩\]\(http:\/\/127\.0\.0\.1:\d+\/chapter_preliminaries\/pandas\.html#:~:text=[^)]+\)\n\n> \[!ai\] AI 回答 · /)
  } finally {
    await run.close()
  }
})

test('术语表拿掉了：网页小条、⋯、翻译菜单、设置里都没有；库里已有的术语表.md 照普通笔记排', async () => {
  const run = await launch({ '课程/线代/第7讲.md': '# 第7讲\n\n先解特征方程。\n', '课程/线代/术语表.md': '# 术语表\n\n| 原文 | 译法 | 备注 |\n| --- | --- | --- |\n| eigenvalue | 特征值 | |\n', '课程/线代/a 笔记.md': '# a 笔记\n' }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await openNote(page, '第7讲')
    await openWeb(page, site.pandas)
    await widenRight(page, 200)
    // 翻译菜单里没有「术语表」那一行
    await web(page).getByRole('button', { name: '翻译选项' }).click()
    const menu = page.getByRole('dialog', { name: '双语翻译' })
    await expect(menu).toBeVisible()
    await expect(menu.getByLabel('术语表')).toHaveCount(0)
    await expect(menu).not.toContainText('术语表')
    await page.keyboard.press('Escape')
    // 设置 › 插件 › 双语翻译：没有术语表那一行
    await page.keyboard.press('Meta+,')
    const set = page.getByRole('dialog', { name: '设置' })
    await set.getByRole('button', { name: '插件' }).click()
    // 默认只用 Claude Code（2026-11-25 起）时这一块是单选（radiogroup），自动换家时是列表
    await expect(set.getByRole('radiogroup', { name: '翻译用什么' })).toBeVisible()
    await expect(set).not.toContainText('术语表')
    await page.keyboard.press('Escape')
  } finally {
    await run.close()
  }
})

void ([] as Locator[])
