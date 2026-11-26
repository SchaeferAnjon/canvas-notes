/**
 * 剪藏去处规则（2026-11-25 用户定：「⌘S 直接按，就存到收件箱；我选了目录之后，就存到那个目录；已经配对的，肯定写进配对的文档里。」）：
 * 这个网站配对了一篇 → 写进那篇；选过文件夹 → 进那个文件夹；都没有 → 收件箱。中间开着什么（文档、白板、文件夹首页、网页占满时看不见的那篇）都不改去处。
 * 这里只测和 0.5.13 不一样的格子（每条修以前都挂）：选中文字 ⌘S、网页占满、在中间开成一页的网页、整页剪藏、右键「剪进文档」、拖进文档以后、
 * AI 剪整页 / 剪一段、视频记下这一刻、地址栏小牌写什么。本机假网页、假视频站、假 AI，无头（CN_E2E=1），不上网。
 */
import { expect, test, type Page } from '@playwright/test'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { launch, openNote, pane, rail, type Running } from './app'
import { armMenus, menuLabels, openedMenu, pickMenu } from './menu'
import { guest, inboxFiles, openWeb, pressInPage, read, selectPara, toast, web } from './clip-web'
import { solidPng } from './fixtures/png'
import { FAKE_VIDEO_ID, startFakeVideoSite } from './fixtures/fake-video'

test.setTimeout(300_000)

const P = [
  '数据预处理的第一步是把原始数据读进来，常见的格式是逗号分隔的表格文件，每一行是一条记录。',
  '读进来以后先看有没有缺失值，缺失值可以用均值填补，也可以直接删掉那一行，看数据多少再定。',
  '接着把类别变量换成独热编码，这样每一类都成了一列零或一，模型才认得出来。',
  '最后把整张表换成张量，交给后面的模型去训练，这一步要注意数据类型是不是浮点数。',
]
const PNG = solidPng(120, 80, [40, 160, 120])

let server: Server
let base: string
let video: Server
let vbase: string
test.beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/flow.png') {
      res.setHeader('content-type', 'image/png')
      return res.end(PNG)
    }
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end(`<!doctype html><html><head><meta charset="utf-8"><title>1.1 数据预处理 · 小书</title></head>
      <body style="font:15px sans-serif;padding:12px;max-width:640px"><article>
      <h1>1.1 数据预处理</h1>
      <h2>1.1.1 读数据</h2>
      <p id="p1">${P[0]}</p>
      <p id="p2">${P[1]}</p>
      <figure><img id="img" src="/flow.png" alt="flow" width="120" height="80" style="display:block"><figcaption>图1.1 数据预处理的流程</figcaption></figure>
      <h2>1.1.2 换成张量</h2>
      <p id="p3">${P[2]}</p>
      <p id="p4">${P[3]}</p>
      <p>${'这一节讲的都是动手之前的准备工作。'.repeat(12)}</p>
      </article></body></html>`)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  ;({ server: video, base: vbase } = await startFakeVideoSite())
})
test.afterAll(() => {
  server.close()
  video.close()
})

const NOTE = '课程/读书笔记.md'
const PAIRED = (site: string) => `---\nread-along: ${site}/\n---\n# 读书笔记\n\n第一段。\n`
const dlg = (page: Page) => page.getByRole('dialog', { name: '记到哪篇' })
const chip = (page: Page) => page.getByTestId('full-chip')
const mdIn = (vault: string, dir: string) => (existsSync(join(vault, dir)) ? readdirSync(join(vault, dir)).filter((f) => f.endsWith('.md')).sort() : [])
/** 这个网站（网址的 origin）在本机记成剪进一个文件夹（同在小牌里选了「放进一个文件夹…」） */
const pickDir = (page: Page, site: string, dir: string) => page.evaluate(([s, d]) => localStorage.setItem('cn.webTarget', JSON.stringify({ [s!]: `:dir:${d}` })), [site, dir])

async function clipPara(run: Running, id: string) {
  await selectPara(run.page, id)
  await pressInPage(run, 'S', ['meta'])
}

test('选中文字 ⌘S：都没有时直接进收件箱，不再问「记到哪篇」，中间开着的那篇不动（地址栏小牌写收件箱）；网页占满时也一样', async () => {
  const run = await launch({ [NOTE]: '# 读书笔记\n\n第一段。\n' })
  const { page, vault } = run
  try {
    await openNote(page, '读书笔记')
    await openWeb(page, `${base}/book`)
    const before = read(vault, NOTE)
    // 小牌如实写收件箱（以前写中间开着的那篇「读书笔记」）
    await expect(chip(page)).toHaveAttribute('aria-label', '剪进收件箱')
    await clipPara(run, 'p1')
    await expect(toast(page)).toContainText('剪成卡片，放进收件箱了')
    await expect(dlg(page)).toHaveCount(0)
    await expect.poll(() => inboxFiles(vault).length).toBe(1)
    expect(read(vault, `收件箱/${inboxFiles(vault)[0]}`)).toContain(`> ${P[0]}`)
    expect(read(vault, NOTE)).toBe(before)

    // 网页占满（中间那篇看不见）：以前剪进中间那篇，现在照样进收件箱
    await page.locator('.dhead:has([data-testid="dtab-web"]) .maxbtn').click()
    await expect(page.locator('.win > main.center')).toHaveClass(/folded/)
    await expect(chip(page)).toHaveText(/^剪进 收件箱$/)
    await clipPara(run, 'p2')
    await expect.poll(() => inboxFiles(vault).length).toBe(2)
    await page.waitForTimeout(500)
    expect(read(vault, NOTE)).toBe(before)
  } finally {
    await run.close()
  }
})

test('地址栏小牌如实写去处：配对了写那篇，选过文件夹写文件夹名，都没有写收件箱（中间开着文件夹首页、白板都不变）', async () => {
  const run = await launch({ [NOTE]: PAIRED(base), '白板.md': '---\ntype: board\n---\n# 白板\n\n<!-- card id=a x=60 y=60 w=240 -->\n一张卡\n', '剪藏/视频/字幕.md': '# 字幕\n' })
  const { page } = run
  try {
    // 中间开着白板：配对了 → 写那篇（以前白板时也写那篇，这格不变，放这里对照）
    await openNote(page, '白板')
    await openWeb(page, `${base}/book`)
    await expect(chip(page)).toHaveAttribute('aria-label', '记进《读书笔记》')
    // 选过文件夹 → 文件夹名；中间换成 剪藏/视频 的文件夹首页也照旧写它
    await pickDir(page, base, '网页摘录')
    await page.getByRole('navigation', { name: '左栏' }).getByRole('button', { name: '文件', exact: true }).click()
    const tree = page.getByRole('tree', { name: '全部文件' })
    const open = tree.getByRole('button', { name: '展开 剪藏' })
    if (await open.count()) await open.click()
    await tree.locator('[data-path="剪藏/视频"]').first().click()
    await expect(chip(page)).toHaveAttribute('aria-label', '剪进「网页摘录」')
  } finally {
    await run.close()
  }
})

test('在中间开成一页的网页：这个网站选过文件夹，剪的进那个文件夹（以前一律进收件箱）', async () => {
  const run = await launch({ 'a.md': '# a\n' })
  const { page, vault } = run
  try {
    await pickDir(page, base, '网页摘录')
    await openWeb(page, `${base}/book`)
    await web(page).getByRole('button', { name: '更多' }).click()
    await web(page).getByRole('menu', { name: '更多' }).getByRole('menuitem', { name: /在中间开成一页/ }).click()
    const MID = '.wpane:not([hidden]) webview'
    await expect(page.locator(MID)).toBeVisible()
    const g = (code: string) => page.evaluate(([c, s]) => (document.querySelector(s!) as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c!), [code, MID])
    await expect.poll(() => g('document.readyState')).toBe('complete')
    await g(`(() => { const p = document.getElementById('p3'); p.scrollIntoView({ block: 'center' }); const r = document.createRange(); r.selectNodeContents(p); const s = getSelection(); s.removeAllRanges(); s.addRange(r) })()`)
    const where = `(() => { const h = document.getElementById('cn-clip-host'); if (!h || h.style.display === 'none') return null; const b = h.shadowRoot.querySelector('button.clip').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 } })()`
    await expect.poll(() => g(where)).not.toBeNull()
    const at = (await g(where)) as { x: number; y: number }
    const wv = (await page.locator(MID).boundingBox())!
    await page.mouse.click(wv.x + at.x, wv.y + at.y)
    await expect.poll(() => mdIn(vault, '网页摘录').length).toBe(1)
    expect(inboxFiles(vault)).toEqual([])
  } finally {
    await run.close()
  }
})

test('整页剪藏：这个网站配对了一篇，整页写进那篇末尾（图存进那篇的附件），不再另建一篇进收件箱', async () => {
  const run = await launch({ [NOTE]: PAIRED(base), 'x.md': '# x\n' })
  const { page, vault } = run
  try {
    await openNote(page, 'x')
    await openWeb(page, `${base}/book`)
    await web(page).getByRole('button', { name: '更多' }).click()
    await web(page).getByRole('menu', { name: '更多' }).getByRole('menuitem', { name: '剪藏这一页' }).click()
    await expect.poll(() => read(vault, NOTE), { timeout: 30_000 }).toContain(P[3])
    const md = read(vault, NOTE)
    expect(md).toContain('第一段。')
    expect(md).toMatch(/^#{1,3} 1\.1 数据预处理 · 小书$/m)
    expect(md).toMatch(/\]\(\.\.\/附件\/课程\/读书笔记\/[^)]+\.png\)/)
    expect(inboxFiles(vault)).toEqual([])
  } finally {
    await run.close()
  }
})

test('右键「剪进文档」进中间开着的这篇光标处（用户点明了），不进这个网站配对的另一篇；拖进文档以后 ⌘S 照样照规则走', async () => {
  const run = await launch({ [NOTE]: PAIRED(base), '另一篇.md': '# 另一篇\n\n开头。\n' })
  const { page, vault } = run
  try {
    await armMenus(run)
    await openNote(page, '另一篇')
    await pane(page).locator('.cm-line', { hasText: '开头' }).click()
    await page.keyboard.press('End')
    await openWeb(page, `${base}/book`)
    const paired = read(vault, NOTE)
    await selectPara(page, 'p2')
    const w = (await web(page).locator('webview.on').boundingBox())!
    const r = await guest<{ x: number; y: number }>(page, `(() => { const t = document.getElementById('p2').firstChild; const g = document.createRange(); g.setStart(t, 0); g.setEnd(t, 1); const b = g.getBoundingClientRect(); return { x: b.right + 2, y: b.top + b.height / 2 } })()`)
    await page.mouse.click(w.x + r.x, w.y + r.y, { button: 'right' })
    expect(menuLabels(await openedMenu(run))).toContain('剪进文档')
    await pickMenu(run, '剪进文档')
    await expect.poll(() => read(vault, '另一篇.md')).toContain(P[1])
    await page.waitForTimeout(500)
    expect(read(vault, NOTE)).toBe(paired)
    // ⌘S 照规则：配对的那篇
    await clipPara(run, 'p4')
    await expect.poll(() => read(vault, NOTE)).toContain(P[3])
    expect(read(vault, '另一篇.md')).not.toContain(P[3])
  } finally {
    await run.close()
  }
})

test('AI 剪整页、剪一段照规则：这个网站选过文件夹就进那个文件夹（以前一律进收件箱）', async () => {
  const run = await launch({ 'a.md': '# a\n' }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await pickDir(page, base, '网页摘录')
    await openWeb(page, `${base}/book`)
    await page.keyboard.press('Meta+j')
    const ai = page.getByRole('complementary', { name: 'AI 对话' })
    const box = ai.getByRole('textbox', { name: '问 AI' })
    await box.fill('把这个网页整页剪进收件箱')
    await box.press('Enter')
    await expect(ai.getByTestId('ai-msg').last()).toContainText('剪好了', { timeout: 60_000 })
    await expect.poll(() => mdIn(vault, '网页摘录'), { timeout: 20_000 }).toEqual(['1.1 数据预处理.md'])
    await expect(ai.getByRole('button', { name: '发送' })).toBeVisible()
    await box.fill(`把网页里「${P[2]!.slice(0, 12)}」剪进收件箱`)
    await box.press('Enter')
    await expect.poll(() => mdIn(vault, '网页摘录').length, { timeout: 60_000 }).toBe(2)
    expect(inboxFiles(vault)).toEqual([])
  } finally {
    await run.close()
  }
})

// ---------------------------------------------------------------- 视频记下这一刻

const strip = (page: Page) => web(page).getByRole('region', { name: '视频条' })
const VTITLE = 'Linear transformations and matrices'
async function openVideo(page: Page) {
  if (!(await web(page).isVisible())) await rail(page).getByRole('button', { name: '网页', exact: true }).click()
  const addr = web(page).getByRole('textbox', { name: '网址' })
  await addr.fill(`${vbase}/watch?v=${FAKE_VIDEO_ID}`)
  await addr.press('Enter')
  await expect(strip(page)).toBeVisible({ timeout: 30_000 })
}
async function moment(page: Page, sec: number) {
  await guest(page, `(() => { const v = document.querySelector('video'); v.currentTime = ${sec}; v.pause(); return true })()`)
  await expect.poll(async () => Math.round(Number(await guest(page, 'document.querySelector("video").currentTime'))), { timeout: 20_000 }).toBe(sec)
  await strip(page).getByRole('button', { name: '记下这一刻' }).click()
  // 底栏说记进了哪、这一秒（记完才能按下一次）
  await expect(page.locator('.vtoast')).toContainText(`00:${String(sec).padStart(2, '0')}`, { timeout: 30_000 })
}
const venv = () => ({ CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '150', CN_VIDEO_TEST_ORIGIN: vbase })

test('视频记下这一刻照规则：都没有 → 收件箱里这个视频那篇（中间开着的文档不动）；选过文件夹 → 那个文件夹里这个视频那篇；配对了 → 那篇末尾', async () => {
  const run = await launch({ '第3讲 笔记.md': '# 第3讲 笔记\n\n线性。\n', [NOTE]: PAIRED('http://pair.invalid') }, venv())
  const { page, vault } = run
  try {
    await openNote(page, '第3讲 笔记')
    await openVideo(page)
    // 等视频标题读到（视频条「记到」写上这个视频那篇）再按：标题没读到时按，那篇的文件名只能叫「视频」（机器快时视频条比标题先出来）
    await expect(strip(page).getByRole('button', { name: /^记到 / })).toHaveAttribute('aria-label', `记到 ${VTITLE}`, { timeout: 30_000 })
    const center = read(vault, '第3讲 笔记.md')
    // 都没有：以前插进中间开着的这篇光标处
    await moment(page, 4)
    await expect.poll(() => (existsSync(join(vault, `收件箱/${VTITLE}.md`)) ? read(vault, `收件箱/${VTITLE}.md`) : ''), { timeout: 30_000 }).toContain(`<!-- moment video=youtube:${FAKE_VIDEO_ID} t=4`)
    await page.waitForTimeout(500)
    expect(read(vault, '第3讲 笔记.md')).toBe(center)

    // 选过文件夹：那个文件夹里这个视频那篇
    await pickDir(page, vbase, '视频摘录')
    await moment(page, 7)
    await expect.poll(() => (existsSync(join(vault, `视频摘录/${VTITLE}.md`)) ? read(vault, `视频摘录/${VTITLE}.md`) : read(vault, `收件箱/${VTITLE}.md`)), { timeout: 20_000 }).toContain('t=7')
    expect(read(vault, `收件箱/${VTITLE}.md`)).not.toContain('t=7')

    // 配对了（读书笔记 配这个视频站）：那篇末尾，第一次先放视频卡
    await page.evaluate(() => localStorage.removeItem('cn.webTarget'))
    writeFileSync(join(vault, NOTE), PAIRED(vbase))
    await expect.poll(() => chip(page).getAttribute('aria-label'), { timeout: 15_000 }).toBe('记进《读书笔记》')
    await moment(page, 10)
    await expect.poll(() => read(vault, NOTE), { timeout: 20_000 }).toContain('t=10')
    expect(read(vault, NOTE)).toContain(`<!-- video video=youtube:${FAKE_VIDEO_ID} -->`)
    expect(read(vault, '第3讲 笔记.md')).toBe(center)
  } finally {
    await run.close()
  }
})
