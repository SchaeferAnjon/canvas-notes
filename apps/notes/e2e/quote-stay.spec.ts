/**
 * 网页上点「引用」进右栏正开着的那段对话（偏好「引用留在当前对话」，2026-11-24 用户在 d2l 6.1：右栏开着「学习笔记」那段，
 * 点引用却进了网页自己那段、顶上还叫人「回到「zh.d2l.ai」」）：
 * - 右栏 AI 看着一篇笔记的对话：引用成为它输入框顶上的一块（来源「6.1.2 多层感知机的限制」），发出去的那条来源点了回到那一段；
 * - 右栏没开 AI：照旧进这个网页自己那段；
 * - 看着别处那段时顶上「这是在「X」问的 · 留在这个对话 · 回到「…」」：引用也进看着的那段；「回到」切回网页自己那段；
 *   点「留在这个对话」那一行不再出，之后引用、讲解一下都进这段，重开软件照旧（换了中间那篇、右栏看着别的对话也拉回这段）。
 * 本机假网页 fixtures/d2l-conv.ts，无头（CN_E2E=1）、假 AI。CN_SHOTS=1 时截一张图（薄荷）。
 */
import { _electron as electron, type ElectronApplication, expect, test, type Page } from '@playwright/test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import electronPath from 'electron'
import { launch, openAi, openNote, pane, rail, webAboveAi, widenRight } from './app'
import { d2lConv, type D2lSite } from './fixtures/d2l-conv'

let site: D2lSite
test.beforeAll(async () => {
  site = await d2lConv()
})
test.afterAll(() => site.close())

const NOTE = '课程/学习笔记：动手学深度学习.md'
const TITLE = '学习笔记：动手学深度学习'
const OTHER = '随手记.md'
/** 选中小条上自己加的一颗（task-26nz7 的写法）：答在 AI 栏 */
const CMDS = '.canvas-notes/命令.json'
const OWN = '用高中生能懂的话讲'
const cmds =
  JSON.stringify({
    version: 1,
    own: [{ id: 'own-hs', name: OWN, kind: 'ai', target: '1. 用高中生能听懂的话讲{选中的字}', rules: [{ t: '用高中生能听懂的话讲{选中的字}' }], prompt: '用高中生能听懂的话讲{选中的字}', out: 'note', where: ['web', 'pdf', 'html', 'doc'], write: 'answer', desc: '用高中生能听懂的话讲' }],
    bar: { on: ['explain', 'translate', 'quote', 'clip', 'own-hs'], more: ['only', 'copy'], off: [], enabled: true },
  }) + '\n'
const SHOTS = '/private/tmp/canvas-notes-visual/91-引用留在当前对话'
const paired = () => `---\nread-along: ${site.base}/\n---\n# ${TITLE}\n\n## 6.1 从全连接层到卷积\n\n先读 6.1.2。\n`
const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const reading = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })
const menu = (page: Page) => page.locator('.convmenu')
const mint = (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: 'mint', frame: 'a' } }))
}

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

async function point(page: Page, code: string) {
  const w = (await web(page).locator('webview.on').boundingBox())!
  const r = await guest<{ x: number; y: number; width: number; height: number }>(page, `(() => { const r = (${code}).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`)
  return { x: w.x + r.x + r.width / 2, y: w.y + r.y + r.height / 2 }
}

const barShown = (page: Page) => guest(page, `document.getElementById('cn-clip-host')?.style.display`)

/** 真拖着选中 #id 一整段，小条出来 */
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

/** 选中一段点小条上一颗 */
/** 按住 ⌘ 框住 #id 这一段（真拖），框好的工具条出来 */
async function boxPara(page: Page, id: string) {
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
  await expect.poll(() => guest(page, `document.getElementById('cn-box-host')?.shadowRoot?.querySelector('.cap')?.style.display`)).toBe('flex')
}

async function onPara(page: Page, id: string, label: '引用' | '讲解一下' | typeof OWN) {
  await selectPara(page, id)
  await clickBar(page, label)
}

async function pickConvo(page: Page, from: ReturnType<typeof chat>, label: string) {
  await from.getByTestId('ai-conv').click()
  await menu(page).getByRole('menuitemradio').filter({ hasText: label }).first().click()
  await expect(menu(page)).toHaveCount(0)
}

async function shot(app: ElectronApplication, name: string) {
  if (!process.env.CN_SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  const b64 = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(SHOTS, name), Buffer.from(b64, 'base64'))
}

test('网页上点引用进右栏正开着的那段对话；「留在这个对话」以后引用、讲解都进这段、那一行不再出，重开照旧；「回到」切回网页自己那段', async () => {
  test.setTimeout(240_000)
  const run = await launch({ [NOTE]: paired(), [OTHER]: '# 随手记\n\n一行。\n', [CMDS]: cmds }, { CN_AI_FAKE: '1' }, mint)
  const { page } = run
  let relaunched: Awaited<ReturnType<typeof electron.launch>> | null = null
  try {
    // 学习笔记那段对话先问一句
    await openNote(page, TITLE)
    await widenRight(page, 160)
    await openAi(page)
    const q = chat(page).getByRole('textbox', { name: '问 AI' })
    await q.fill('卷积是什么')
    await q.press('Enter')
    await expect(chat(page).getByTestId('ai-msg').last().locator('.txt')).toHaveText('这是测试回答（Claude Code）。', { timeout: 15_000 })

    // 1. 右栏开着学习笔记那段：网页上引用一段，进它的输入框，来源是那段上面的小标题；顶上没有「这是在…问的」
    await openWeb(page)
    if ((await page.locator('.dgrp').count()) < 2) await webAboveAi(page)
    await onPara(page, 'p1', '引用')
    await expect(chat(page)).toBeVisible()
    await expect(reading(page)).toBeHidden()
    await expect(chat(page).getByTestId('ai-conv')).toHaveText(TITLE)
    const mat = chat(page).getByTestId('ai-mat')
    await expect(mat).toHaveCount(1)
    await expect(mat.first()).toHaveAttribute('data-src', '6.1.2 多层感知机的限制')
    await expect(chat(page).getByTestId('ai-away')).toHaveCount(0)
    // 发出去：那条的来源点了回到网页那一段
    await q.fill('这段讲的什么')
    await q.press('Enter')
    await expect(chat(page).getByTestId('ai-msg').last().locator('.txt')).toHaveText('这是测试回答（Claude Code，材料 1 块）。', { timeout: 15_000 })
    await expect(chat(page).locator('.um')).toHaveCount(2)
    await guest(page, 'window.scrollTo(0, document.body.scrollHeight)')
    await chat(page).getByTestId('mat-back').last().click()
    await expect
      .poll(() => guest<boolean>(page, `(() => { const r = document.getElementById('p1').getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight * 0.6 })()`))
      .toBe(true)

    // 2. 右栏没开 AI：照旧进这个网页自己那段
    await page.keyboard.press('Meta+j')
    await expect(chat(page)).toBeHidden()
    await onPara(page, 'p2', '引用')
    await expect(reading(page)).toBeVisible()
    await expect(reading(page).getByTestId('ai-mat')).toHaveCount(1)
    // 重开的 AI 和网页叠在一组里：网页拖回上半，两样一起看（同用户截图）
    if (!(await web(page).isVisible())) await webAboveAi(page)
    await expect(web(page)).toBeVisible()

    // 3. 网页自己那段里点对话菜单看学习笔记那段：顶上「这是在「学习笔记…」问的 · 留在这个对话 · 回到「…」」，引用进看着的这段
    await pickConvo(page, reading(page), TITLE)
    await expect(chat(page)).toBeVisible()
    const away = chat(page).getByTestId('ai-away')
    await expect(away).toBeVisible()
    await expect(away.getByRole('button')).toHaveText(['留在这个对话', /^回到「.+」$/])
    await onPara(page, 'p1', '引用')
    await expect(chat(page).getByTestId('ai-mat')).toHaveCount(1)
    await expect(away).toBeVisible()
    await shot(run.app, '01-留在这个对话.png')

    // 4. 「回到」：切回网页自己那段，再引用进它
    await away.getByTestId('ai-back').click()
    await expect(reading(page)).toBeVisible()
    await onPara(page, 'p1', '引用')
    // 切走再回来，输入框里没发的那块不留（读 PDF 那一格本来就这样）：这里只有刚引的这块
    await expect(reading(page).getByTestId('ai-mat')).toHaveCount(1)
    await expect(reading(page).getByTestId('ai-mat')).toHaveAttribute('title', /首先，多层感知机的输入/)

    // 5. 再看学习笔记那段、点「留在这个对话」：那一行不再出；引用、讲解一下都进这段
    await pickConvo(page, reading(page), TITLE)
    await expect(away).toBeVisible()
    await away.getByTestId('ai-stay-here').click()
    await expect(away).toHaveCount(0)
    await onPara(page, 'p2', '引用')
    await expect(chat(page).getByTestId('ai-mat')).toHaveCount(2)
    await q.fill('这两段')
    await q.press('Enter')
    await expect(chat(page).locator('.um')).toHaveCount(3)
    await expect(chat(page).getByTestId('ai-msg').last().locator('.txt')).toHaveText('这是测试回答（Claude Code，材料 2 块）。', { timeout: 15_000 })
    await onPara(page, 'p2', '讲解一下')
    await expect(chat(page).locator('.um')).toHaveCount(4)
    await expect(chat(page).locator('.um').last()).toContainText('给我讲解一下')
    await expect(chat(page).locator('.um').last()).toContainText('6.1.2 多层感知机的限制')
    await expect(chat(page).getByTestId('ai-msg').last().locator('.txt')).toHaveText('这是测试回答（Claude Code，材料 1 块）。', { timeout: 15_000 })
    await expect(chat(page).getByTestId('ai-away')).toHaveCount(0)
    await expect(chat(page).getByTestId('ai-conv')).toHaveText(TITLE)

    // 选中小条上自己加的那颗：也进这段、答在这里
    await onPara(page, 'p1', OWN)
    await expect(chat(page).locator('.um')).toHaveCount(5)
    await expect(chat(page).locator('.um').last()).toContainText('用高中生能听懂的话讲')
    await expect(chat(page).getByTestId('ai-msg').last().locator('.txt')).toHaveText('这是测试回答（Claude Code，材料 1 块）。', { timeout: 15_000 })
    await expect(chat(page).getByTestId('ai-conv')).toHaveText(TITLE)

    // 按住 ⌘ 框一块点「引用」：这块截图成为这段输入框顶上的一块图，来源是那段的小标题；右栏不被拽回网页自己那段
    await boxPara(page, 'p2')
    await expect(reading(page)).toBeHidden()
    const boxQuote = await point(page, `document.getElementById('cn-box-host').shadowRoot.querySelector('[data-k="quote"]')`)
    await page.mouse.click(boxQuote.x, boxQuote.y)
    const img = chat(page).getByTestId('ai-mat')
    await expect(img).toHaveCount(1)
    await expect(img.first()).toHaveClass(/\bimg\b/)
    await expect(img.first()).toHaveAttribute('data-src', '6.1.2 多层感知机的限制')
    await expect(chat(page).getByTestId('ai-conv')).toHaveText(TITLE)
    await expect(reading(page)).toBeHidden()
    await shot(run.app, '02-框一块进学习笔记那段.png')
    // 网页自己那段没问过
    expect(await page.evaluate(() => document.querySelectorAll('[aria-label="边读边问 AI"] [data-testid="reading-msg"]').length)).toBe(0)
    await page.waitForTimeout(600)

    // 6. 重开软件：中间开随手记、右栏看它的对话，网页上引用还是拉回学习笔记那段，那一行不出
    await run.app.close()
    relaunched = await electron.launch({
      executablePath: electronPath as unknown as string,
      args: [join(__dirname, '../out/main/index.js')],
      env: { ...process.env, CN_VAULT: run.vault, CN_USER_DATA: run.userData, CN_AI_FAKE: '1', CN_E2E: '1', CN_NO_AX: '1', CN_QUICK_KEY: 'Alt+Command+Shift+F19', CN_TRASH_DIR: run.trash },
    })
    const p2 = await relaunched.firstWindow()
    await expect(p2.locator('.vault b')).toHaveText('测试库')
    await openNote(p2, '随手记')
    await openAi(p2)
    await expect(chat(p2).getByTestId('ai-conv')).toHaveText('随手记')
    await openWeb(p2)
    if ((await p2.locator('.dgrp').count()) < 2) await webAboveAi(p2)
    await expect(chat(p2)).toBeVisible()
    await onPara(p2, 'p1', '引用')
    await expect(chat(p2).getByTestId('ai-conv')).toHaveText(TITLE)
    await expect(chat(p2).getByTestId('ai-mat')).toHaveCount(1)
    await expect(chat(p2).getByTestId('ai-away')).toHaveCount(0)
    await expect(chat(p2).locator('.um')).toHaveCount(5)
    // 中间那篇照旧是随手记
    await expect(pane(p2).locator('.cm-line', { hasText: '一行。' })).toBeVisible()
  } finally {
    // 重开过：第一回的已经关了，关第二回的、删临时库
    if (relaunched) {
      await relaunched.close()
      rmSync(dirname(run.vault), { recursive: true, force: true, maxRetries: 5 })
    } else await run.close()
  }
})
