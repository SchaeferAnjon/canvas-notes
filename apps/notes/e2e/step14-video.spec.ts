// 看视频（2026-11-16，方向 A「视频条」）：右栏视频页地址栏下面的视频条和刻度；双语字幕（字幕从播放器自己的请求里读，翻译走双语翻译插件）；
// ⌥S 记下这一刻（文档插光标处、白板进「时刻」列、什么都没开进收件箱），每次一次提交、能撤回；⌥D 框一块问，AI 浮窗里答，答完自动记进笔记和「视频里的疑惑」；
// 字幕全文存进「剪藏/视频」带 AI 摘要；文档里点时刻块的时间跳回那一秒；白板上的视频卡、时刻卡；设置里改快捷键。
// 视频站是本机假的（e2e/fixtures/fake-video.ts，当成 YouTube），AI 是假的（CN_AI_FAKE）。
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { join } from 'node:path'
import { editorText, gitStatus, launch, openNote, pane, rail, type Running, waitSaved } from './app'
import { FAKE_NO_SUBS_ID, FAKE_VIDEO_ID, LINES, startFakeVideoSite } from './fixtures/fake-video'

let server: Server
let base: string
let requests: string[]

test.beforeAll(async () => {
  ;({ server, base, requests } = await startFakeVideoSite())
})
test.afterAll(() => server.close())

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const strip = (page: Page) => web(page).getByRole('region', { name: '视频条' })

function guest(page: Page, code: string): Promise<unknown> {
  return page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code)
}

const env = () => ({ CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '150', CN_VIDEO_TEST_ORIGIN: base })

async function openVideo(page: Page, id = FAKE_VIDEO_ID) {
  await rail(page).getByRole('button', { name: '网页' }).click()
  const addr = web(page).getByRole('textbox', { name: '网址' })
  await addr.fill(`${base}/watch?v=${id}`)
  await addr.press('Enter')
  await expect(strip(page)).toBeVisible({ timeout: 15_000 })
}

/** 让视频播到第 sec 秒附近停下 */
async function seek(page: Page, sec: number) {
  await guest(page, `(() => { const v = document.querySelector('video'); v.currentTime = ${sec}; v.pause(); return true })()`)
  await expect.poll(async () => Math.round(Number(await guest(page, 'document.querySelector("video").currentTime')))).toBe(sec)
}

/** 画面上的字幕：译文|原文 */
const subsText = (page: Page) =>
  guest(page, `(() => { const r = document.getElementById('cn-video-host')?.shadowRoot; const b = r && (r.querySelector('.subs:not(:empty)') || r.querySelector('.below:not(:empty)')); return b ? [...b.children].map((x) => x.textContent).join('|') : '' })()`)

/** 交付用的截图（CN_SHOTS 给了才截）：从主进程截整个窗口，右栏网页也在里面（Playwright 的截图截不对屏幕外窗口里的 webview） */
async function shot(run: Running, name: string) {
  const dir = process.env.CN_SHOTS
  if (!dir) return
  await run.page.waitForTimeout(250)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(dir, `${name}.png`), Buffer.from(b64, 'base64'))
}

const commits = (vault: string) => execFileSync('git', ['-C', vault, 'log', '--format=%s'], { encoding: 'utf8' }).trim().split('\n')
/** 那次提交改了哪些文件 */
function filesOf(vault: string, subject: string): string[] {
  const log = execFileSync('git', ['-C', vault, '-c', 'core.quotePath=false', 'log', '--format=@@%s', '--name-only'], { encoding: 'utf8' })
  const part = log.split('@@').find((p) => p.startsWith(subject + '\n'))
  return part ? part.split('\n').slice(1).filter(Boolean) : []
}

test('视频页：地址栏下面出视频条和刻度；字幕从播放器自己的请求里读，双语盖在画面上，网站自己的字幕藏起来；普通网页没有视频条', async () => {
  const run = await launch({ '第3讲 笔记.md': '# 第3讲 笔记\n\n线性 = 直线变完还是直线。\n' }, env())
  const { page } = run
  try {
    await openNote(page, '第3讲 笔记')
    await openVideo(page)
    // 播放器自己取了一条（带 pot），我们照它的地址换成人工字幕 en 去取
    await expect.poll(() => requests.some((r) => r.startsWith(`/api/timedtext?v=${FAKE_VIDEO_ID}&lang=en&fmt=json3&pot=FAKEPOT`))).toBe(true)
    await expect(strip(page).getByRole('button', { name: '字幕' })).toContainText('字幕 英→中', { timeout: 15_000 })
    await seek(page, 4)
    // 字幕层：译文（假翻译「译文：原文」）在上，原文在下
    await expect.poll(() => subsText(page)).toBe(`译文：${LINES[1]}|${LINES[1]}`)
    await expect.poll(() => guest(page, `getComputedStyle(document.querySelector('.ytp-caption-window-container')).display`)).toBe('none')
    // 记到：中间栏开着的文档
    await expect(strip(page).getByRole('button', { name: '记到 第3讲 笔记' })).toBeVisible()
    await expect(strip(page).getByRole('button', { name: '0 个时刻' }).or(strip(page).getByText('0个时刻'))).toBeVisible()
    await shot(run, 'video-strip')
    // 普通网页没有视频条
    const addr = web(page).getByRole('textbox', { name: '网址' })
    await addr.fill(`${base}/nothing`)
    await addr.press('Enter')
    await expect(strip(page)).toHaveCount(0)
    void LINES
  } finally {
    await run.close()
  }
})

test('⌥S 记下这一刻：文档光标处多一块时刻（截图 + 时间 + 前后双语字幕），第一次先插视频卡；一次提交，能撤回', async () => {
  const run = await launch({ '第3讲 笔记.md': '# 第3讲 笔记\n\n线性 = 直线变完还是直线。\n' }, env())
  const { page, vault } = run
  try {
    await openNote(page, '第3讲 笔记')
    await pane(page).locator('.cm-content').click()
    await page.keyboard.press('Meta+End')
    await openVideo(page)
    await expect(strip(page).getByRole('button', { name: '字幕' })).toContainText('英→中', { timeout: 15_000 })
    await seek(page, 7)
    // 焦点在文档里按 ⌥S
    await pane(page).locator('.cm-content').click()
    await page.keyboard.press('Alt+KeyS')
    await expect(page.locator('.vtoast')).toContainText('记进了《第3讲 笔记》 · 00:07')
    await waitSaved(page)
    const md = await editorText(page)
    expect(md).toContain(`<!-- video video=youtube:${FAKE_VIDEO_ID} -->`)
    expect(md).toContain(`<!-- moment video=youtube:${FAKE_VIDEO_ID} t=7`)
    expect(md).toContain(`![00:07](附件/视频/youtube-${FAKE_VIDEO_ID}/00-07.jpg)`)
    expect(md).toContain('> **00:06 Watch where i-hat lands. / 译文：Watch where i-hat lands.**')
    expect(existsSync(join(vault, `附件/视频/youtube-${FAKE_VIDEO_ID}/00-07.jpg`))).toBe(true)
    // 一次提交：文档改动 + 截图（字幕全文自己另有提交）
    await expect.poll(() => commits(vault)).toContain('视频：记下 00:07《Linear transformations and matrices》→ 第3讲 笔记')
    expect(filesOf(vault, '视频：记下 00:07《Linear transformations and matrices》→ 第3讲 笔记')).toEqual(expect.arrayContaining(['第3讲 笔记.md', `附件/视频/youtube-${FAKE_VIDEO_ID}/00-07.jpg`]))
    expect(gitStatus(vault)).not.toContain('第3讲')
    // 刻度上一根
    await expect(strip(page).getByText('1个时刻')).toBeVisible()
    await shot(run, 'video-moment')
    // 撤回
    await page.locator('.vtoast').getByRole('button', { name: '撤回' }).click()
    await expect(page.locator('.vtoast')).toContainText('撤回了')
    await expect.poll(async () => (await editorText(page)).includes('<!-- moment')).toBe(false)
    expect(existsSync(join(vault, `附件/视频/youtube-${FAKE_VIDEO_ID}/00-07.jpg`))).toBe(false)
    await expect(strip(page).getByText('0个时刻')).toBeVisible()
  } finally {
    await run.close()
  }
})

const read = (vault: string, f: string) => readFileSync(join(vault, f), 'utf8')
const BOARD = '---\ntype: board\n---\n# 线性代数 白板\n\n<!-- card id=a1 x=60 y=60 w=280 -->\n线性 = 直线变完还是直线\n'
const videoTime = async (page: Page) => Number(await guest(page, 'document.querySelector("video").currentTime'))

test('以前写法的白板（旧写法名单里的）开着时 ⌥S：时刻进这个视频的「时刻」列（没有视频卡先放一张），最新的在上面；列最多摆 3 张，多的收成一行；双击时刻卡跳回那一秒', async () => {
  const run = await launch({ '线性代数 白板.md': BOARD, '.canvas-notes/白板旧写法.json': JSON.stringify({ 版本: 1, 白板: ['线性代数 白板.md'] }) }, env())
  const { page, vault } = run
  try {
    await page.locator('.nav .si', { hasText: /^线性代数 白板/ }).first().click()
    await expect(pane(page).getByTestId('board')).toBeVisible()
    await openVideo(page)
    await expect(strip(page).getByRole('button', { name: '记到 线性代数 白板' })).toBeVisible()
    await expect(strip(page).getByRole('button', { name: '字幕' })).toContainText('英→中', { timeout: 15_000 })
    const secs = [2, 5, 9, 13]
    for (const sec of secs) {
      await seek(page, sec)
      // 焦点在网页里按 ⌥S：主进程接住转过来，网站收不到
      await web(page).locator('webview.on').focus()
      await page.keyboard.press('Alt+KeyS')
      await expect(page.locator('.vtoast')).toContainText(`· 00:${String(sec).padStart(2, '0')}`)
      await expect(strip(page).getByText(`${secs.indexOf(sec) + 1}个时刻`)).toBeVisible()
    }
    const board = pane(page).getByTestId('board')
    await expect(board.locator('.bcard.k-video')).toHaveCount(1)
    await expect(board.locator('.bcard.k-video')).toContainText('Linear transformations and matrices')
    await expect(board.locator('.bcard.k-video')).toContainText('4个时刻')
    const col = board.locator('.bcol')
    await expect(col.locator('h3')).toContainText('时刻')
    await expect(col.locator('h3')).toContainText('4个')
    // 最多摆 3 张，最新的（00:13）在最上面放大
    await expect(col.locator('.bcard.k-moment')).toHaveCount(3)
    await expect(col.locator('.bcard.k-moment').first()).not.toHaveClass(/small/)
    await expect(col.locator('.bcard.k-moment').first()).toContainText('00:13')
    await expect(col.getByRole('button', { name: '还有1个，按时间排' })).toBeVisible()
    await shot(run, 'video-board')
    await col.getByRole('button', { name: '还有1个，按时间排' }).click()
    await expect(col.locator('.bcard.k-moment')).toHaveCount(4)
    await waitSaved(page)
    const md = read(vault, '线性代数 白板.md')
    expect(md).toContain(`moments=youtube:${FAKE_VIDEO_ID}`)
    expect(md.indexOf('t=13')).toBeLessThan(md.indexOf('t=9'))
    await expect.poll(() => gitStatus(vault)).toBe('')
    // 双击最下面那张（00:02）：视频跳回第 2 秒
    await seek(page, 20)
    await col.locator('.bcard.k-moment').last().dblclick()
    await expect.poll(() => videoTime(page)).toBeLessThan(5)
  } finally {
    await run.close()
  }
})

test('白板（「## 列名」写法）开着时 ⌥S：时刻挂在这个视频的视频卡下面（没有视频卡先在文末放一张），按时间先后；点一下时刻从那一秒播', async () => {
  const run = await launch({ '线性代数 白板.md': '---\ntype: board\n---\n# 线性代数 白板\n\n## 看过的\n\n线性 = 直线变完还是直线\n' }, env())
  const { page, vault } = run
  try {
    await page.locator('.nav .si', { hasText: /^线性代数 白板/ }).first().click()
    const board = pane(page).getByTestId('doc-board')
    await expect(board).toBeVisible()
    await openVideo(page)
    await expect(strip(page).getByRole('button', { name: '记到 线性代数 白板' })).toBeVisible()
    await expect(strip(page).getByRole('button', { name: '字幕' })).toContainText('英→中', { timeout: 15_000 })
    for (const sec of [2, 9]) {
      await seek(page, sec)
      await web(page).locator('webview.on').focus()
      await page.keyboard.press('Alt+KeyS')
      await expect(page.locator('.vtoast')).toContainText(`· 00:${String(sec).padStart(2, '0')}`)
    }
    // 一张视频卡，两个时刻挂在下面（先记的在上）
    const video = board.locator('.db-card[data-kind="video"]')
    await expect(video).toHaveCount(1)
    await expect(video).toContainText('Linear transformations and matrices')
    await expect(video.locator('.db-moment')).toHaveCount(2)
    await expect(video.locator('.db-moment').first()).toContainText('00:02')
    await expect(video.locator('.db-moment').last()).toContainText('00:09')
    await waitSaved(page)
    const md = read(vault, '线性代数 白板.md')
    expect(md.search(/ t=2(\.\d)? -->/)).toBeGreaterThan(md.indexOf('线性 = 直线变完还是直线'))
    expect(md.search(/ t=2(\.\d)? -->/)).toBeLessThan(md.search(/ t=9(\.\d)? -->/))
    await expect.poll(() => gitStatus(vault)).toBe('')
    await shot(run, 'video-docboard')
    // 点第一个时刻：视频跳回第 2 秒
    await seek(page, 20)
    await video.locator('.db-moment').first().click()
    await expect.poll(() => videoTime(page)).toBeLessThan(5)
  } finally {
    await run.close()
  }
})

test('什么都没开（首页）：新建「收件箱/<视频标题>.md」在中间打开，同一个视频都进这一篇，第一次先放视频卡；字幕全文存进「剪藏/视频」带 AI 摘要和记下的时刻', async () => {
  const run = await launch({ 'a.md': '# a\n' }, env())
  const { page, vault } = run
  try {
    await openVideo(page)
    await expect(strip(page).getByRole('button', { name: /^记到 / })).toHaveAttribute('aria-label', '记到 新建《Linear transformations and matrices》')
    await expect(strip(page).getByRole('button', { name: '字幕' })).toContainText('英→中', { timeout: 15_000 })
    const matPath = '剪藏/视频/Linear transformations and matrices.md'
    await expect.poll(() => existsSync(join(vault, matPath)) && read(vault, matPath).includes('## AI 摘要\n- [00:00]'), { timeout: 15_000 }).toBe(true)
    await expect.poll(() => read(vault, matPath)).toContain(`[00:03](${base}/watch?v=${FAKE_VIDEO_ID}&t=3s) A matrix moves every vector.\n译文：A matrix moves every vector.`)
    const m0 = read(vault, matPath)
    expect(m0).toMatch(/^---\ntype: video\nsource: .*\nsite: youtube\nchannel: 3Blue1Brown\nduration: 24\nsubtitles: en · 人工字幕\ntranslated: zh-CN\n---\n# Linear transformations and matrices\n/)
    expect(m0).toContain('## 00:00 Intro')
    expect(m0).toContain('## 00:12 Matrices')
    await seek(page, 10)
    await strip(page).getByRole('button', { name: '记下这一刻' }).click()
    await expect(page.locator('.vtoast')).toContainText('新建了《Linear transformations and matrices》，记了00:10')
    await seek(page, 16)
    await strip(page).getByRole('button', { name: '记下这一刻' }).click()
    await expect(page.locator('.vtoast')).toContainText('· 00:16')
    await waitSaved(page)
    const inbox = read(vault, '收件箱/Linear transformations and matrices.md')
    expect(inbox.startsWith(`---\n视频: ${base}/watch?v=${FAKE_VIDEO_ID}\n---\n\n# Linear transformations and matrices\n\n<!-- video video=youtube:${FAKE_VIDEO_ID} -->\n![Linear transformations and matrices](../附件/视频/youtube-${FAKE_VIDEO_ID}/cover.jpg)\n`)).toBe(true)
    expect(inbox.match(/<!-- moment /g)).toHaveLength(2)
    expect(existsSync(join(vault, `附件/视频/youtube-${FAKE_VIDEO_ID}/cover.jpg`))).toBe(true)
    // 字幕全文的「记下的时刻」跟着这次提交更新
    await expect.poll(() => read(vault, matPath)).toContain('## 记下的时刻\n- [00:10]')
    await expect.poll(() => gitStatus(vault)).toBe('')
    expect(commits(vault)).toContain('视频：记下 00:16《Linear transformations and matrices》→ Linear transformations and matrices')
    // 「N 个时刻」弹层：按章节分组，点一个跳回去
    await strip(page).getByRole('button', { name: /2个时刻/ }).click()
    const pop = web(page).getByRole('dialog', { name: '时刻' })
    await expect(pop.locator('.trm-lab', { hasText: 'Matrices' })).toBeVisible()
    await expect(pop.locator('.trm-lab', { hasText: 'Intro' })).toBeVisible()
    await shot(run, 'video-moments-menu')
    await pop.getByRole('button', { name: /00:10/ }).click()
    await expect.poll(async () => Math.round(await videoTime(page))).toBe(10)
  } finally {
    await run.close()
  }
})

test('⌥D 框一块问：视频暂停、拖一个框、问话框里回车；不弹浮窗，写进那篇本身、插在光标处（2026-11-24 AI 对话记笔记开关），一次提交；刻度上多一个空心圆', async () => {
  const run = await launch({ '课程/线性代数/第3讲 笔记.md': '# 第3讲 笔记\n\n线性 = 直线变完还是直线。\n' }, env())
  const { page, vault } = run
  try {
    await openNote(page, '第3讲 笔记')
    await openVideo(page)
    await expect(strip(page).getByRole('button', { name: '字幕' })).toContainText('英→中', { timeout: 15_000 })
    await guest(page, 'document.querySelector("video").play()')
    await seek(page, 8)
    await guest(page, 'document.querySelector("video").play()')
    await pane(page).locator('.cm-content').click()
    await page.keyboard.press('Alt+KeyD')
    await expect.poll(() => guest(page, `!!document.getElementById('cn-video-host').shadowRoot.querySelector('.box')`)).toBe(true)
    expect(await guest(page, 'document.querySelector("video").paused')).toBe(true)
    // 在画面上拖一个框
    const wv = (await web(page).locator('webview.on').boundingBox())!
    await page.mouse.move(wv.x + 120, wv.y + 60)
    await page.mouse.down()
    await page.mouse.move(wv.x + 220, wv.y + 140, { steps: 6 })
    await page.mouse.up()
    const ask = web(page).getByRole('dialog', { name: '问 AI' })
    await expect(ask).toBeVisible()
    await expect(ask.getByRole('textbox', { name: '想问什么' })).toBeFocused()
    // 问框（task-sta8n）：底下「记进《…》▾」能换、右边「esc 关掉」
    await expect(ask.getByRole('button', { name: /^记进/ })).toContainText('记进《第3讲 笔记》')
    await expect(ask).toContainText('esc 关掉')
    await shot(run, 'video-ask')
    const at = Math.floor(await videoTime(page))
    const tt = `00:${String(at).padStart(2, '0')}`
    await ask.getByRole('textbox', { name: '想问什么' }).press('Enter')
    // 回答在问框里就地出来，同时答进文档（CN-84、task-sta8n）：问框底行「已记进《…》」
    await expect(ask.getByRole('button', { name: /已记进《第3讲 笔记》/ })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('complementary', { name: 'AI 对话' })).toBeHidden()
    await shot(run, 'video-asked')
    await waitSaved(page)
    const NOTE = '课程/线性代数/第3讲 笔记.md'
    const am = readFileSync(join(vault, NOTE), 'utf8')
    const jpg = `附件/视频/youtube-${FAKE_VIDEO_ID}/${tt.replace(':', '-')}-问.jpg`
    expect(am).toContain(`\n\n### 讲解这一块\n\n![我框的](../../${jpg})\n\n—— [▶ ${tt} · Linear transformations and matrices](`)
    expect(am).toContain('> [!ai] AI 回答 · Claude Code · Opus 5.5 · [回到 AI 对话](')
    expect(am).toContain('> 框里是 i 帽和 j 帽变换后的位置。')
    // 新写法（小标题 + AI 回答框），不是老的 moment-ask 问答块；没有一节视频名的大标题、没有 AI 笔记属性
    const md = await editorText(page)
    expect(md).not.toContain('moment-ask')
    expect(md).toContain('线性 = 直线变完还是直线。')
    expect(am).not.toContain('## Linear transformations and matrices')
    expect(am).not.toContain('AI 笔记')
    expect(existsSync(join(vault, '课程/线性代数/视频里的疑惑.md'))).toBe(false)
    await expect.poll(() => gitStatus(vault)).toBe('')
    expect(filesOf(vault, '笔记：第3讲 笔记 · 讲解这一块').sort()).toEqual([NOTE, jpg].sort())
    await expect(strip(page).locator('.vmark.asked')).toHaveCount(1)
  } finally {
    await run.close()
  }
})

test('文档里：时刻块画成卡片（截图、时间、这一秒的双语、前后几行），点时间跳回那一秒；视频卡一行；网页收起来点时间也会在右栏打开', async () => {
  const run = await launch({ '第3讲 笔记.md': '# 第3讲 笔记\n\n线性。\n' }, env())
  const { page } = run
  try {
    await openNote(page, '第3讲 笔记')
    await pane(page).locator('.cm-content').click()
    await page.keyboard.press('Meta+End')
    await openVideo(page)
    await expect(strip(page).getByRole('button', { name: '字幕' })).toContainText('英→中', { timeout: 15_000 })
    await seek(page, 12)
    await strip(page).getByRole('button', { name: '记下这一刻' }).click()
    await expect(page.locator('.vtoast')).toContainText('· 00:12')
    // 插进来马上就是卡片（光标在它下面新的空段落，CN-71）
    const m = pane(page).locator('[data-part="时刻块"]')
    await expect(m).toBeVisible()
    await expect(m.locator('img')).toHaveAttribute('src', /00-12\.jpg$/)
    await expect(m.locator('.o')).toHaveText(LINES[4]!)
    await expect(m.locator('.t')).toHaveText(`译文：${LINES[4]}`)
    // 焦点留在视频上，不交回文档（2026-11-17 用户定，空格照样控制视频）；光标照样落在时刻块下面新的空段落（CN-71）：
    // 回到文档（只给焦点，不点别处）就接着往下写
    expect(await page.evaluate(() => document.activeElement?.classList.contains('cm-content') ?? false)).toBe(false)
    await pane(page).locator('.cm-content').focus()
    await page.keyboard.press('Enter')
    await page.keyboard.type('接着写')
    await expect.poll(() => pane(page).locator('.cm-line', { hasText: '接着写' }).count()).toBe(1)
    expect(await pane(page).locator('.cm-content').evaluate((el) => (el.textContent ?? '').includes('<!-- moment'))).toBe(false)
    await m.getByRole('button', { name: /前后4行/ }).click()
    await expect(m.locator('.lines')).toBeVisible()
    const card = pane(page).locator('[data-part="视频卡"]')
    await expect(card).toContainText('Linear transformations and matrices')
    await expect(card).toContainText('YouTube · 3Blue1Brown · 00:24 · 这篇记了1处')
    await shot(run, 'video-doc-blocks')
    // 视频播到别处，点时间胶囊回到第 12 秒
    await seek(page, 3)
    await m.locator('.vpill').click()
    await expect.poll(async () => Math.round(await videoTime(page))).toBe(12)
    // 右栏收起来再点：右栏打开、还是这个视频（不另开一个）
    await rail(page).getByRole('button', { name: '网页' }).click()
    await m.locator('.vpill').click()
    await expect(web(page)).toBeVisible()
    await expect(web(page).getByRole('tablist', { name: '网页标签' }).getByRole('tab')).toHaveCount(1)
  } finally {
    await run.close()
  }
})

test('字幕菜单：双语 / 只看译文 / 只看原文、放在画面下面、换原文字幕、翻成任何语言（和网页翻译同一个设置）；⌥A 在视频页上开关字幕', async () => {
  const run = await launch({ 'a.md': '# a\n' }, env())
  const { page, userData } = run
  try {
    await openVideo(page)
    await expect(strip(page).getByRole('button', { name: '字幕' })).toContainText('英→中', { timeout: 15_000 })
    await seek(page, 4)
    await strip(page).getByRole('button', { name: '字幕' }).click()
    const menu = web(page).getByRole('dialog', { name: '字幕' })
    await expect(menu).toBeVisible()
    await shot(run, 'video-submenu')
    await menu.getByRole('radio', { name: '只看译文' }).click()
    await expect.poll(() => subsText(page)).toBe(`译文：${LINES[1]}`)
    await menu.getByRole('radio', { name: '只看原文' }).click()
    await expect.poll(() => subsText(page)).toBe(LINES[1])
    await menu.getByRole('radio', { name: '放在画面下面' }).click()
    await expect.poll(() => guest(page, `document.getElementById('cn-video-host').shadowRoot.querySelector('.below').hidden`)).toBe(false)
    await menu.getByRole('radio', { name: '盖在画面上' }).click()
    await menu.getByRole('radio', { name: '双语' }).click()
    // 原文换成自动生成的那条：播放器去取 kind=asr
    await menu.getByRole('radio', { name: /English \(auto-generated\)/ }).click()
    await expect.poll(() => requests.some((r) => r.includes('lang=en') && r.includes('kind=asr'))).toBe(true)
    // 翻成任何语言：搜不到的直接「翻成「斯瓦希里语」」
    await menu.getByRole('textbox', { name: '翻成什么语言' }).fill('斯瓦希里语')
    await menu.getByRole('radio', { name: '翻成「斯瓦希里语」' }).click()
    await expect.poll(() => (JSON.parse(readFileSync(join(userData, 'plugins/state.json'), 'utf8')) as { settings: { translate: { target: string } } }).settings.translate.target).toBe('斯瓦希里语')
    await expect(strip(page).getByRole('button', { name: '字幕' })).toContainText('英→斯')
    await page.keyboard.press('Escape')
    // ⌥A：关字幕（网站自己的字幕还回去）、再开
    await page.locator('.center').click({ position: { x: 300, y: 300 } })
    await page.keyboard.press('Alt+KeyA')
    await expect(strip(page).getByRole('button', { name: '字幕' })).toContainText('字幕关')
    await expect.poll(() => subsText(page)).toBe('')
    await expect.poll(() => guest(page, `getComputedStyle(document.querySelector('.ytp-caption-window-container')).display`)).not.toBe('none')
    await page.keyboard.press('Alt+KeyA')
    await expect(strip(page).getByRole('button', { name: '字幕' })).not.toContainText('字幕关')
  } finally {
    await run.close()
  }
})

test('没有字幕的视频：字幕开关写「没有字幕」，菜单里是「生成字幕」那一块；照样能记下这一刻', async () => {
  const run = await launch({ 'a.md': '# a\n' }, env())
  const { page, vault } = run
  try {
    await openVideo(page, FAKE_NO_SUBS_ID)
    await expect(strip(page).getByRole('button', { name: '字幕' })).toContainText('没有字幕', { timeout: 15_000 })
    await strip(page).getByRole('button', { name: '字幕' }).click()
    // 菜单里不放开发进度，换成「生成字幕」那一块（CN-81 / 69）
    await expect(web(page).getByRole('dialog', { name: '字幕' })).toContainText('这个视频没带字幕')
    await expect(web(page).getByRole('dialog', { name: '字幕' })).not.toContainText('还没做')
    await shot(run, 'video-nosubs')
    await page.keyboard.press('Escape')
    await seek(page, 3)
    await strip(page).getByRole('button', { name: '记下这一刻' }).click()
    await expect(page.locator('.vtoast')).toContainText('记了00:03')
    expect(read(vault, '收件箱/A video without subtitles.md')).toContain(`<!-- moment video=youtube:${FAKE_NO_SUBS_ID} t=3`)
  } finally {
    await run.close()
  }
})

test('设置 › 快捷键：「记下这一刻」改成 ⌥M，视频条上跟着变，按 ⌥M 记下；⌥K 这类占用的不让设', async () => {
  const run = await launch({ 'a.md': '# a\n' }, env())
  const { page } = run
  try {
    // 设置 › 快捷键（方向 A 重做后照命令表列，task-f7rib、task-spsmf）：「看视频」那一段
    await page.keyboard.press('Meta+,')
    const set = page.getByRole('dialog', { name: '设置' })
    await set.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: '快捷键', exact: true }).click()
    const btn = set.getByRole('button', { name: '改 记下这一刻 的快捷键' })
    await btn.click()
    await page.keyboard.press('Alt+KeyK')
    await expect(set.getByText('⌥K 是「播放 / 暂停」，换一个')).toBeVisible()
    await btn.click()
    await page.keyboard.press('Alt+KeyM')
    await expect(btn).toHaveText('⌥M')
    await shot(run, 'video-keys')
    await page.keyboard.press('Meta+,')
    await openVideo(page)
    await expect(strip(page).getByRole('button', { name: '记下这一刻' })).toContainText('⌥M')
    await seek(page, 5)
    await page.locator('.center').click({ position: { x: 300, y: 300 } })
    await page.keyboard.press('Alt+KeyM')
    await expect(page.locator('.vtoast')).toContainText('记了00:05')
  } finally {
    await run.close()
  }
})

test('字幕全文那一篇：章节默认收起（「▸ 展开 · N 行」），点开露出这一章的双语字幕；文字一个字都不改', async () => {
  const lines = (from: number, n: number) =>
    Array.from({ length: n }, (_, i) => {
      const t = from + i * 5
      const mm = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
      return `[${mm}](https://www.youtube.com/watch?v=abcdefghijk&t=${t}s) Line ${t}.\n第 ${t} 秒的译文。\n`
    }).join('\n')
  const doc = `---\ntype: video\nsource: https://www.youtube.com/watch?v=abcdefghijk\nsite: youtube\nchannel: C\nduration: 600\nsubtitles: en · 人工字幕\ntranslated: zh-CN\n---\n# 一集很长的课\n\n## AI 摘要\n- [00:10](https://www.youtube.com/watch?v=abcdefghijk&t=10s) 开场。\n\n## 记下的时刻\n还没有。\n\n## 00:00 开场\n${lines(0, 30)}\n## 05:00 第二章\n${lines(300, 40)}`
  const run = await launch({ '剪藏/视频/一集很长的课.md': doc }, env())
  const { page, vault } = run
  try {
    await openNote(page, '一集很长的课')
    const folds = pane(page).locator('.cm-vfold')
    // 没看过：第一章展开着（30 行），第二章收着；编辑器只画看得见的，先滚下去
    await pane(page).locator('.cm-content').hover()
    for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 1500)
    await expect(folds).toHaveCount(2)
    await expect(folds.nth(0)).toHaveText('▴ 收起这一章')
    await expect(folds.nth(1)).toHaveText('▸ 展开 · 40行')
    await expect(pane(page).getByText('Line 300.')).toHaveCount(0)
    // 收起第一章、展开第二章
    await folds.nth(0).click()
    await expect(folds.nth(0)).toHaveText('▸ 展开 · 30行')
    await expect(pane(page).getByText('Line 25.')).toHaveCount(0)
    await folds.nth(1).click()
    // 展开以后视口停在按钮那儿（这一章的末尾，task-axoxy 起文末多画一个空块），露出来的是这一章后半；编辑器只画看得见的，开头那几行不在 DOM 里
    await expect(pane(page).getByText('Line 495.')).toBeVisible()
    await expect(pane(page).getByText('第 495 秒的译文。')).toBeVisible()
    await shot(run, 'video-material')
    await page.waitForTimeout(1000)
    expect(read(vault, '剪藏/视频/一集很长的课.md')).toBe(doc)
  } finally {
    await run.close()
  }
})

for (const tone of ['light', 'dark'] as const) {
  test(`交付截图（${tone === 'light' ? '浅色' : '深色'}）：右栏 480 宽，文档里记了一刻、问过一次`, async () => {
    const run = await launch({ '课程/线性代数/第3讲 线性映射 笔记.md': '# 第3讲 线性映射 笔记\n\n看视频：线性变换和矩阵。\n' }, env(), (v) => {
      if (tone !== 'dark') return
      const ud = join(v, '..', 'user-data')
      mkdirSync(ud, { recursive: true })
      writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: 'pine' } }))
    })
    const { page } = run
    try {
      await openNote(page, '第3讲 线性映射 笔记')
      await pane(page).locator('.cm-content').click()
      await page.keyboard.press('Meta+End')
      await openVideo(page)
      const sep = (await page.getByRole('separator', { name: '拖动调整右栏宽度' }).boundingBox())!
      await page.mouse.move(sep.x + sep.width / 2, sep.y + 300)
      await page.mouse.down()
      await page.mouse.move(sep.x - 140, sep.y + 300, { steps: 6 })
      await page.mouse.up()
      await expect(strip(page).getByRole('button', { name: '字幕' })).toContainText('英→中', { timeout: 15_000 })
      await expect(strip(page).getByRole('button', { name: '框一块问' })).toContainText('框一块问')
      for (const sec of [6, 15]) {
        await seek(page, sec)
        await strip(page).getByRole('button', { name: '记下这一刻' }).click()
        await expect(page.locator('.vtoast')).toContainText(`· 00:${String(sec).padStart(2, '0')}`)
      }
      await seek(page, 10)
      await shot(run, `deliver-${tone}-moment`)
      await pane(page).getByText('看视频：线性变换和矩阵。').click()
      await shot(run, `deliver-${tone}-doc`)
      await strip(page).getByRole('button', { name: '字幕' }).click()
      await shot(run, `deliver-${tone}-submenu`)
      await page.keyboard.press('Escape')
      await strip(page).getByRole('button', { name: '框一块问' }).click()
      // 等网页里的框选层出来再拖（机器忙时点完按钮马上拖，框选层还没出来，拖了个空）
      await expect.poll(() => guest(page, `!!document.getElementById('cn-video-host').shadowRoot.querySelector('.box')`)).toBe(true)
      const wv = (await web(page).locator('webview.on').boundingBox())!
      await page.mouse.move(wv.x + 200, wv.y + 50)
      await page.mouse.down()
      await page.mouse.move(wv.x + 330, wv.y + 160, { steps: 6 })
      await page.mouse.up()
      await expect(web(page).getByRole('dialog', { name: '问 AI' })).toBeVisible()
      // 问框一出来光标就在输入框里（直接回车就是「讲解这一块」）
      await expect(web(page).getByRole('dialog', { name: '问 AI' }).getByRole('textbox', { name: '想问什么' })).toBeFocused()
      await shot(run, `deliver-${tone}-ask`)
      await page.keyboard.press('Enter')
      await expect(web(page).getByRole('dialog', { name: '问 AI' }).getByRole('button', { name: /已记进《第3讲 线性映射 笔记》/ })).toBeVisible({ timeout: 15_000 })
      await shot(run, `deliver-${tone}-asked`)
      await strip(page).getByRole('button', { name: /3个时刻/ }).click()
      await shot(run, `deliver-${tone}-moments`)
    } finally {
      await run.close()
    }
  })
}

test('白板上光秃秃的视频链接卡：画成视频卡（标题、频道），不再只有域名；双击在右栏打开', async () => {
  const run = await launch({ '看视频 白板.md': `---\ntype: board\n---\n<!-- card id=a1 x=60 y=60 -->\n${base}/watch?v=${FAKE_VIDEO_ID}\n` }, env())
  const { page } = run
  try {
    // 先看过一次（标题、频道记在本机；真 YouTube 从 oEmbed 取）
    await openVideo(page)
    await expect(strip(page).getByRole('button', { name: '字幕' })).toContainText('英→中', { timeout: 15_000 })
    await rail(page).getByRole('button', { name: '网页' }).click()
    await page.locator('.nav .si', { hasText: /^看视频 白板/ }).first().click()
    const card = pane(page).getByTestId('doc-board').locator('.db-card[data-face="video"]')
    await expect(card).toContainText('Linear transformations and matrices')
    await expect(card).toContainText('3Blue1Brown')
    await shot(run, 'video-link-card')
    await card.dblclick()
    await expect(web(page)).toBeVisible()
  } finally {
    await run.close()
  }
})
