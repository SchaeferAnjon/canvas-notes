/**
 * 发版前第 3 轮（实用 · 读与 AI）找出来的问题：每条一个测试，真按、真点。
 * ⌘K 那几条用「记账代理」数对外请求：软件所有的网都走本机一个代理，代理记下要连哪、一律回 502，不连真网站。
 */
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { acts, gitStatus, launch, leftView, openNote, pane, rail, tabOn, waitSaved, type Running } from './app'
import { DREAM_VAULT } from './fixtures/dream'
import { LECTURE } from './fixtures/pdf'
import { solidPng } from './fixtures/png'
import { burst, launchCounted, netMark, netSince } from './net'
import { shotPart, shotTone, shotWindow } from './shots'

const pal = (page: Page) => page.getByRole('dialog', { name: '搜索和命令' })
const palBox = (page: Page) => pal(page).getByRole('textbox', { name: '搜索笔记、输入网址或命令' })
const web = (page: Page) => page.getByRole('complementary', { name: '网页' })

test('⌘K 各种打法没选网页时 0 个对外请求：10ms 内回车、40ms 内 ↓ 回车、像网址的笔记名、库里没有的词、索引建好后不沾边的词', async () => {
  test.setTimeout(180_000)
  const files: Record<string, string | Uint8Array> = {
    '随手记.md': '# 随手记\n\n正文。\n',
    '线性代数复习.md': '# 线性代数复习\n\n核和像。\n',
    '线性代数习题.md': '# 线性代数习题\n\n题。\n',
    'Node.js.md': '# Node.js\n\n事件循环。\n',
    'readme.md': '# readme\n\n说明。\n',
    'v0.4.0 发版.md': '# v0.4.0 发版\n\n清单。\n',
    '课程/Lecture06.pdf': Buffer.from('%PDF-1.4\n%%EOF\n'),
  }
  for (let i = 0; i < 300; i++) files[`杂/笔记${i}.md`] = `# 笔记${i}\n\n` + '随便写点。\n'.repeat(30)
  const run = await launchCounted(files, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await shotTone(page)
    // 每一种打法：开 ⌘K、打字按键、看开了什么（tab 为 null：什么都不开，框还开着），数对外请求
    const cases: { label: string; word: string; keys: string[]; wait?: number; tab: RegExp | null }[] = [
      { label: '笔记名 10ms 内回车', word: '随手记', keys: ['Return'], tab: /随手记/ },
      { label: '打完马上 ↓ 回车', word: '线性代数', keys: ['Down', 'Return'], tab: /线性代数/ },
      { label: '隔 40ms ↓ 回车', word: '线性代数', keys: ['Down+40', 'Return'], tab: /线性代数/ },
      { label: 'readme.md 10ms 内回车', word: 'readme.md', keys: ['Return'], tab: /readme/ },
      { label: 'readme.md 等 1 秒回车', word: 'readme.md', keys: [], wait: 1000, tab: /readme/ },
      { label: 'Node.js 10ms 内回车', word: 'Node.js', keys: ['Return'], tab: /Node\.js/ },
      { label: 'Node.js 等 1 秒回车', word: 'Node.js', keys: [], wait: 1000, tab: /Node\.js/ },
      { label: 'Lecture06.pdf 等 1 秒回车', word: 'Lecture06.pdf', keys: [], wait: 1000, tab: /Lecture06\.pdf/ },
      { label: 'v0.4.0 等 1 秒回车', word: 'v0.4.0', keys: [], wait: 1000, tab: /v0\.4\.0 发版/ },
      { label: '库里没有的词 10ms 内回车', word: '老布什xyz', keys: ['Return'], tab: null },
      { label: '库里没有的词等 1 秒回车', word: '老布什abc', keys: [], wait: 1000, tab: null },
      { label: '像网址、库里没有 10ms 内回车', word: 'foo.bar', keys: ['Return'], tab: null },
      { label: '像网址、库里没有 ↓ 回车', word: 'lecture07.pdf', keys: ['Down', 'Return'], tab: null },
    ]
    const run1 = async (c: (typeof cases)[number]) => {
      await page.keyboard.press('Meta+k')
      await palBox(page).waitFor()
      const before = (await tabOn(page).allInnerTexts()).join('/')
      const mark = await netMark(run)
      await burst(run, c.word, c.keys)
      if (c.wait) {
        await page.waitForTimeout(c.wait)
        await page.keyboard.press('Enter')
      }
      if (c.tab) {
        await expect(pal(page), c.label).toHaveCount(0)
        await expect(tabOn(page), c.label).toHaveText(c.tab)
      } else {
        await page.waitForTimeout(1200)
        await expect(pal(page), c.label).toBeVisible()
        expect((await tabOn(page).allInnerTexts()).join('/'), c.label).toBe(before)
        await page.keyboard.press('Escape')
      }
      await page.waitForTimeout(300)
      expect(await web(page).isVisible(), c.label).toBe(false)
      expect(await netSince(run, mark), c.label).toEqual([])
    }
    for (const c of cases) await run1(c)

    // 像网址的笔记名等 1 秒：默认选中的是笔记那一行，网页那一行在下面、没选中（截图）
    await page.keyboard.press('Meta+k')
    await palBox(page).fill('readme.md')
    await expect(pal(page).locator('.pal-row.on')).toContainText('readme')
    await expect(pal(page).locator('.pal-row').first()).not.toContainText('在右栏网页里')
    await expect(pal(page).locator('.pal-row', { hasText: '在右栏网页里打开' })).toHaveAttribute('aria-selected', 'false')
    await shotWindow(run, 'r3-palette-urlname')
    await page.keyboard.press('Escape')

    // 索引建好以后：字面没结果、「意思相近」列出不沾边的笔记，但一条都不默认选中；回车不做事，写清楚要上网按 ⌘↵
    await expect.poll(() => page.evaluate(() => (window as unknown as { cnSearch: { status(): Promise<{ phase: string }> } }).cnSearch.status().then((s) => s.phase)), { timeout: 90_000 }).toBe('ready')
    for (const word of ['特斯拉股价', '没有这个qq', '老布什abc'])
      await run1({ label: `索引建好后「${word}」等 1.2 秒回车`, word, keys: [], wait: 1200, tab: null })
    await page.keyboard.press('Meta+k')
    await palBox(page).fill('特斯拉股价')
    await page.waitForTimeout(1000)
    await expect(pal(page).locator('.pal-none')).toHaveText('笔记和PDF里都没有「特斯拉股价」这几个字')
    await expect(pal(page).locator('.pal-none-why')).toHaveText('回车没有可打开的，⌘↵ 去网页搜')
    // 不沾边的照样列在「意思相近」下面（要开可以自己挪过去），只是不默认选中
    await expect(pal(page).locator('.pal-g', { hasText: '意思相近' })).toBeVisible()
    await expect(pal(page).locator('.pal-row.on')).toHaveCount(0)
    await shotWindow(run, 'r3-palette-meaning-gate')
    await page.keyboard.press('Escape')

    // 选了网页才上网：⌘↵ 去网上（代理记到了），明明白白的网址回车默认就是打开它
    let mark = await netMark(run)
    await page.keyboard.press('Meta+k')
    await burst(run, '随手记', [])
    await page.keyboard.press('Meta+Enter')
    await expect(web(page)).toBeVisible()
    await expect.poll(() => netSince(run, mark).then((l) => l.length)).toBeGreaterThan(0)
    for (const url of ['https://example.com/a', 'www.example.org']) {
      await page.keyboard.press('Meta+k')
      await palBox(page).fill(url)
      await page.waitForTimeout(400)
      await expect(pal(page).locator('.pal-row.on')).toContainText('在右栏网页里打开')
      mark = await netMark(run)
      await page.keyboard.press('Enter')
      await expect(pal(page)).toHaveCount(0)
      await expect.poll(() => netSince(run, mark).then((l) => l.join(' '))).toContain('example')
    }
  } finally {
    await run.close()
  }
})

// ---------------------------------------------------------------- 读 PDF：答的时候连排几句、排着时又打字、排着的 ⌘↵

const PDF = '课程/线性代数/第3讲 线性映射.pdf'
const pdfFiles = { [PDF]: LECTURE, '随手记.md': '# 随手记\n\n一段字。\n' }
const ai = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })
const pdfPane = (page: Page) => page.locator('.pdfpane:not([hidden])')
const pdfPage = (page: Page, n: number) => pdfPane(page).locator(`.pdfpage[data-page="${n}"]`)
const askBox = (page: Page) => ai(page).getByRole('textbox', { name: '问 AI' })
const userMsgs = (page: Page) => ai(page).locator('.um-wrap .um')
const aiTexts = (page: Page) => ai(page).getByTestId('reading-msg').locator('.txt')
const queued = (page: Page) => ai(page).getByTestId('reading-queued')
const stopBtn = (page: Page) => ai(page).getByRole('button', { name: '停下' })
const sendBtn = (page: Page) => ai(page).getByRole('button', { name: '发送' })

async function openPdf(page: Page) {
  await page.keyboard.press('Meta+k')
  await palBox(page).fill('第3讲')
  await page.locator('.pal-row', { hasText: '第3讲 线性映射' }).first().click()
  await expect(tabOn(page)).toHaveText('第3讲 线性映射.pdf')
  await expect(pdfPage(page, 1).locator('canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
  await expect(ai(page).getByTestId('reading-sees')).toContainText('读过全文5页')
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
/** 问这一页，等它开始答（停下键出来） */
async function askPageRunning(page: Page) {
  await acts(page).getByRole('button', { name: /问这一页/ }).click()
  await expect(stopBtn(page)).toBeVisible()
}

test('AI 在答时连排两句：两句都排上、按顺序发，哪句都不丢', async () => {
  const run = await launch(pdfFiles, { CN_AI_FAKE: '1', CN_FAKE_SAY_MS: '200' })
  const { page } = run
  try {
    await shotTone(page)
    await openPdf(page)
    await askPageRunning(page)
    await askBox(page).fill('问题丙')
    await askBox(page).press('Enter')
    await askBox(page).fill('问题丁')
    await askBox(page).press('Enter')
    await expect(queued(page)).toHaveCount(2)
    await expect(queued(page).nth(0)).toContainText('答完上一问自动发出：问题丙')
    await expect(queued(page).nth(1)).toContainText('再接着发：问题丁')
    // 一问一行：第二行在第一行下面，每行的字不被挤成省略号
    const [b0, b1] = [(await queued(page).nth(0).boundingBox())!, (await queued(page).nth(1).boundingBox())!]
    expect(b1.y).toBeGreaterThanOrEqual(b0.y + b0.height - 1)
    for (const i of [0, 1]) expect(await queued(page).nth(i).locator('.truncate').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    // 两个「不发了」在同一列（推到这一行最右边）
    const [l0, l1] = [(await queued(page).nth(0).getByRole('button', { name: '不发了' }).boundingBox())!, (await queued(page).nth(1).getByRole('button', { name: '不发了' }).boundingBox())!]
    expect(Math.abs(l0.x + l0.width - (l1.x + l1.width))).toBeLessThan(1)
    await expect(askBox(page)).toHaveValue('')
    await shotPart(ai(page).locator('.reading-in'), 'r3-queued-two')
    // 答完一问发一问：问这一页、问题丙、问题丁，三句都在对话里、顺序对
    await expect(userMsgs(page)).toHaveCount(3, { timeout: 20_000 })
    await expect(userMsgs(page)).toHaveText(['给我讲解一下这一页', '问题丙', '问题丁'])
    await expect(ai(page).getByTestId('reading-msg')).toHaveCount(3)
    await expect(sendBtn(page)).toBeVisible({ timeout: 15_000 })
    await expect(queued(page)).toHaveCount(0)
  } finally {
    await run.close()
  }
})

test('排着时又打了字：点「停下」「不发了」、换一块，排着的字都接在刚打的字后面（空一行），刚打的字不丢', async () => {
  const run = await launch(pdfFiles, { CN_AI_FAKE: '1', CN_FAKE_SAY_MS: '200' })
  const { page } = run
  try {
    await shotTone(page)
    await openPdf(page)
    // 停下：连排两句都回来，接在刚打的字后面
    await askPageRunning(page)
    await askBox(page).fill('问题己')
    await askBox(page).press('Enter')
    await askBox(page).fill('问题庚')
    await askBox(page).press('Enter')
    await askBox(page).fill('我正在打的另一句')
    await stopBtn(page).click()
    await expect(sendBtn(page)).toBeVisible()
    await expect(queued(page)).toHaveCount(0)
    await expect(askBox(page)).toHaveValue('我正在打的另一句\n\n问题己\n\n问题庚')
    // 输入框跟着字变高，五行字都看得见，不出滚动条
    expect(await askBox(page).evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true)
    await shotPart(ai(page).locator('.reading-in'), 'r3-stop-keeps-typed')
    await page.waitForTimeout(1200)
    await expect(userMsgs(page)).toHaveCount(1)

    // 不发了：只这一句回来，接在后面；另一句照排照发
    await askBox(page).fill('')
    await askPageRunning(page)
    await askBox(page).fill('问题辛')
    await askBox(page).press('Enter')
    await askBox(page).fill('问题壬')
    await askBox(page).press('Enter')
    await askBox(page).fill('又打了一句')
    await queued(page).nth(0).getByRole('button', { name: '不发了' }).click()
    await expect(askBox(page)).toHaveValue('又打了一句\n\n问题辛')
    await expect(queued(page)).toHaveCount(1)
    await expect(queued(page)).toContainText('答完上一问自动发出：问题壬')
    await expect(userMsgs(page)).toHaveCount(3, { timeout: 20_000 })
    await expect(userMsgs(page).last()).toHaveText('问题壬')
    await expect(sendBtn(page)).toBeVisible({ timeout: 15_000 })
    await expect(askBox(page)).toHaveValue('又打了一句\n\n问题辛')

    // 换一块：排着的那句是问上一块的，不发了，接回输入框，刚打的字留着
    await askBox(page).fill('')
    await askPageRunning(page)
    await askBox(page).fill('问题癸')
    await askBox(page).press('Enter')
    await askBox(page).fill('换块之前打的')
    await drawBox(page, 4, [0.1, 0.15], [0.6, 0.3])
    await expect(ai(page).getByTestId('reading-att').locator('img')).toBeVisible()
    await expect(queued(page)).toHaveCount(0)
    await expect(askBox(page)).toHaveValue('换块之前打的\n\n问题癸')
  } finally {
    await run.close()
  }
})

test('AI 在答时打字按 ⌘↵：排上队写着「带第几页」，发出去时和平时的 ⌘↵ 一样带上这一页', async () => {
  const run = await launch(pdfFiles, { CN_AI_FAKE: '1', CN_FAKE_SAY_MS: '200' })
  const { page } = run
  try {
    await openPdf(page)
    // 对照：不在答时 ⌘↵，假 AI 回显「图 1 张」
    await askBox(page).fill('对照：像是什么')
    await askBox(page).press('Meta+Enter')
    await expect(aiTexts(page)).toHaveCount(1, { timeout: 15_000 })
    await expect(sendBtn(page)).toBeVisible({ timeout: 15_000 })
    await expect(aiTexts(page).last()).toContainText('图 1 张')
    // 答的时候 ⌘↵：排上，写着带第 1 页；发出去也是「图 1 张」
    await askPageRunning(page)
    await askBox(page).fill('问题乙：像是什么')
    await askBox(page).press('Meta+Enter')
    await expect(queued(page)).toContainText('答完上一问自动发出（带第1页）：问题乙：像是什么')
    await expect(userMsgs(page)).toHaveCount(3, { timeout: 20_000 })
    await expect(userMsgs(page).last()).toHaveText('问题乙：像是什么')
    await expect(sendBtn(page)).toBeVisible({ timeout: 15_000 })
    await expect(aiTexts(page).last()).toContainText('第 1 页')
    await expect(aiTexts(page).last()).toContainText('图 1 张')
  } finally {
    await run.close()
  }
})

// ---------------------------------------------------------------- 梦游：收下归类那条那篇正开着、挪老图后改过图那一行再撤回

const dreamPanel = (page: Page) => page.getByRole('complementary', { name: '梦游报告' })
const toast = (page: Page) => page.getByTestId('toast')
const lastSubject = (vault: string) => execFileSync('git', ['-C', vault, 'log', '-1', '--format=%s'], { encoding: 'utf8' }).trim()

/** 记下出现过的每一句底栏提示和预览提示（提示会被下一句顶掉，只看最后一句看不出中间说过什么） */
async function recordToasts(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { toasts: string[] }
    w.toasts = []
    new MutationObserver(() => {
      for (const sel of ['[data-testid="toast"]', '[data-testid="preview-toast"]']) {
        const t = (document.querySelector(sel) as HTMLElement | null)?.innerText ?? ''
        if (t && !w.toasts.includes(t)) w.toasts.push(t)
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true })
  })
  return () => page.evaluate(() => (window as unknown as { toasts: string[] }).toasts)
}

async function dreamNow(page: Page) {
  await leftView(page, '梦游报告')
  await dreamPanel(page).getByRole('button', { name: '现在梦游' }).click()
  await expect(dreamPanel(page).getByTestId('dream-summary')).toContainText('整理了', { timeout: 60_000 })
}

test('梦游报告里收下归类那条、那篇正开着：标签跟过去，不说「在外面改名」；撤回的提交说明是中文「撤回梦游：…」', async () => {
  const run = await launch({ ...DREAM_VAULT }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await shotTone(page)
    const toasts = await recordToasts(page)
    await openNote(page, '极光')
    await dreamNow(page)
    await dreamPanel(page).getByTestId('dream-item').filter({ hasText: /^极光\s*从/ }).click()
    await dreamPanel(page).getByTestId('dream-detail').getByRole('button', { name: '收下', exact: true }).click()
    const pv = page.getByTestId('preview-toast')
    await expect(pv).toContainText('收下了1处，已提交到main')
    await expect.poll(() => existsSync(join(vault, '收件箱/极光.md'))).toBe(false)
    // 标签跟到新地方（编辑器的「所在文件夹」不再是收件箱），几秒里没有「在外面」那句
    await expect.poll(async () => (await page.evaluate(() => [...document.querySelectorAll('.cm-editor')].length)) > 0).toBe(true)
    await page.waitForTimeout(2500)
    expect((await toasts()).filter((t) => /在外面/.test(t))).toEqual([])
    await shotWindow(run, 'r3-dream-take-open')
    // 撤回：文件回收件箱，提交说明中文
    await pv.getByRole('button', { name: /撤回/ }).click()
    await expect.poll(() => existsSync(join(vault, '收件箱/极光.md'))).toBe(true)
    await expect.poll(() => lastSubject(vault)).toMatch(/^撤回梦游/)
    expect(lastSubject(vault)).not.toMatch(/Revert/)
    await page.waitForTimeout(2000)
    expect((await toasts()).filter((t) => /在外面/.test(t))).toEqual([])
    // 真在外面（访达）只挪了文件夹：说挪到了哪，不说「改名成了」同一个名字
    await expect(tabOn(page)).toHaveText('极光')
    mkdirSync(join(vault, '素材/旅行'), { recursive: true })
    renameSync(join(vault, '收件箱/极光.md'), join(vault, '素材/旅行/极光.md'))
    await expect(toast(page)).toContainText('「极光」在外面挪到了素材/旅行，标签跟过去了')
  } finally {
    await run.close()
  }
})

test('收下挪老图后在图那一行后面打了字，点「撤回」照样撤得回：图回原处、链接改回、打的字留着', async () => {
  const L5 = '# Lecture05 笔记\n\n这一讲讲比较静态。\n\n![](../../附件/image-1.png)\n\n最后一段。\n'
  const run = await launch({ '课程/ecp/Lecture05 笔记.md': L5, '附件/image-1.png': solidPng(64, 40, [80, 140, 120]) }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  const note = join(vault, '课程/ecp/Lecture05 笔记.md')
  try {
    await openNote(page, 'Lecture05 笔记')
    await dreamNow(page)
    await dreamPanel(page).getByTestId('dream-item').filter({ hasText: /老图/ }).click()
    await dreamPanel(page).getByTestId('dream-detail').getByRole('button', { name: '收下', exact: true }).click()
    await expect(toast(page)).toContainText('梦游挪了图，链接已更新')
    await expect.poll(() => readFileSync(note, 'utf8')).toContain('../../附件/课程/ecp/Lecture05%20笔记/image-1.png')
    // 在图那一行后面打字（切到源文件，点图那一行、按 End）
    await page.waitForTimeout(800)
    await acts(page).getByRole('tab', { name: '源文件' }).click()
    await pane(page).locator('.cm-line', { hasText: 'image-1.png' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type(' 图：这是比较静态的示意')
    await waitSaved(page)
    await expect.poll(() => readFileSync(note, 'utf8')).toContain('image-1.png) 图：这是比较静态的示意')
    await toast(page).getByRole('button', { name: '撤回' }).click()
    await expect(toast(page)).toContainText('撤回了，老图回到了原处')
    await expect.poll(() => existsSync(join(vault, '附件/image-1.png'))).toBe(true)
    await page.waitForTimeout(1500)
    await waitSaved(page)
    expect(readFileSync(note, 'utf8')).toBe(L5.replace('image-1.png)', 'image-1.png) 图：这是比较静态的示意'))
    expect(lastSubject(vault)).toMatch(/^撤回梦游：把 1 张老图/)
    expect(gitStatus(vault)).toBe('')
  } finally {
    await run.close()
  }
})

test('历史「还没提交的改动」对比标签开着时点「现在提交」：标签马上刷新成「都提交了」；再打字又列出来', async () => {
  const run = await launch({ '长文.md': '# 长文\n\n第一段。\n', 'b.md': '# b\n\n乙。\n' })
  const { page } = run
  try {
    await shotTone(page)
    await openNote(page, '长文')
    await pane(page).getByText('第一段。').click()
    await page.keyboard.press('End')
    await page.keyboard.type('我加的一句')
    await waitSaved(page)
    await expect(page.getByTestId('git-changed')).toContainText('1处没提交', { timeout: 10_000 })
    await rail(page).getByRole('button', { name: '历史' }).click()
    const hist = page.getByRole('complementary', { name: '历史' })
    await hist.getByTestId('history-pending').getByRole('button', { name: /还没提交的改动/ }).click()
    const dv = page.getByTestId('diff-tab')
    await expect(dv.locator('[data-file="长文.md"]')).toBeVisible()
    await expect(acts(page).getByTestId('page-note')).toHaveText('还没提交的改动 · 1处')
    await hist.getByTestId('history-pending').getByRole('button', { name: /现在提交/ }).click()
    await expect(hist.getByTestId('history-pending')).toHaveCount(0)
    // 不切标签：对比标签自己刷新
    await expect(acts(page).getByTestId('page-note')).toHaveText('都提交了')
    await expect(dv.locator('[data-file="长文.md"]')).toHaveCount(0)
    await expect(dv).toContainText('都提交了，没有还没提交的改动')
    await expect(acts(page).getByRole('button', { name: '上一处' })).toBeDisabled()
    await expect(acts(page).getByRole('button', { name: '下一处' })).toBeDisabled()
    await shotWindow(run, 'r3-history-working-committed')
    // 回去再打字，切回对比标签：又列出来
    await openNote(page, '长文')
    await pane(page).getByText('我加的一句').click()
    await page.keyboard.press('End')
    await page.keyboard.type('第二回')
    await waitSaved(page)
    await page.getByRole('tab', { name: /还没提交的改动/ }).click()
    await expect(dv.locator('[data-file="长文.md"]')).toBeVisible()
    await expect(dv).toContainText('第二回')
  } finally {
    await run.close()
  }
})
