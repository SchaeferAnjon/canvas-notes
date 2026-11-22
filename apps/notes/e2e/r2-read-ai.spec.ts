/**
 * 发版前第 2 轮（实用 · 读与 AI）找出来的问题：每条一个测试，真按、真点。
 */
import { expect, test, type Page } from '@playwright/test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { acts, launch, leftView, openAi, openNote, pane, rail, tabOn, waitSaved, type Running } from './app'
import { LECTURE } from './fixtures/pdf'
import { solidPng } from './fixtures/png'
import { shotPart, shotTone, shotWindow } from './shots'

const pal = (page: Page) => page.getByRole('dialog', { name: '搜索和命令' })
const palBox = (page: Page) => pal(page).getByRole('textbox', { name: '搜索笔记、输入网址或命令' })
const web = (page: Page) => page.getByRole('complementary', { name: '网页' })

/** 不真的去 Google：拦下发往 google.com 的请求，记下发过几次 */
async function countGoogle(run: Running) {
  await run.app.evaluate(({ session }) => {
    const g = globalThis as unknown as { googleHits: string[] }
    g.googleHits = []
    session.fromPartition('persist:web').webRequest.onBeforeRequest({ urls: ['*://*.google.com/*'] }, (d, cb) => {
      g.googleHits.push(d.url)
      cb({ cancel: true })
    })
  })
  return () => run.app.evaluate(() => (globalThis as unknown as { googleHits: string[] }).googleHits.length)
}

test('⌘K 打笔记名马上回车（10ms 内）：打开的是笔记，绝不去网上搜；库里没有的词回车不做事，⌘↵ 才去网上', async () => {
  const files: Record<string, string> = { '随手记.md': '# 随手记\n\n正文。\n', '线性代数复习.md': '# 线性代数复习\n\n核和像。\n' }
  for (let i = 0; i < 300; i++) files[`杂/笔记${i}.md`] = `# 笔记${i}\n\n` + '随便写点。\n'.repeat(30)
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await shotTone(page)
    const google = await countGoogle(run)
    for (const word of ['随手记', '线性代数复习', '随手记', '线性代数复习']) {
      await page.keyboard.press('Meta+k')
      await palBox(page).waitFor()
      // 在页面里量：打进字（input）到按下回车（keydown）隔了多久
      await palBox(page).evaluate((el) => {
        const w = window as unknown as { gap: { input?: number; enter?: number } }
        w.gap = {}
        el.addEventListener('input', () => (w.gap.input ??= performance.now()), { capture: true })
        el.addEventListener('keydown', (e) => (e as KeyboardEvent).key === 'Enter' && (w.gap.enter ??= performance.now()), { capture: true })
      })
      // 打字和回车从主进程一口气送进窗口（真的输入事件，不经测试进程来回，间隔才压得到 10ms 以内）
      await run.app.evaluate(async ({ BrowserWindow }, w) => {
        const wc = BrowserWindow.getAllWindows()[0]!.webContents
        await wc.insertText(w)
        wc.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
        wc.sendInputEvent({ type: 'char', keyCode: 'Return' })
        wc.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
      }, word)
      const gap = await page.evaluate(() => {
        const g = (window as unknown as { gap: { input: number; enter: number } }).gap
        return g.enter - g.input
      })
      expect(gap).toBeLessThan(10)
      await expect(pal(page)).toHaveCount(0)
      await expect(tabOn(page)).toContainText(word)
      expect(await web(page).isVisible()).toBe(false)
    }
    expect(await google()).toBe(0)

    // 库里没有的词：回车不做事（列表里只有「在右栏网页里搜」「让 Claude 找」，两行都没选中），框还开着
    await page.keyboard.press('Meta+k')
    await page.keyboard.insertText('老布什')
    await page.keyboard.press('Enter')
    await expect(pal(page).locator('.pal-none')).toHaveText('笔记和PDF里都没有「老布什」这几个字')
    await expect(pal(page).locator('.pal-none-why')).toHaveText('回车没有可打开的，⌘↵ 去网页搜')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(400)
    await expect(pal(page)).toBeVisible()
    await expect(pal(page).locator('.pal-row.on')).toHaveCount(0)
    await shotWindow(run, 'r2-palette-nohit')
    expect(await web(page).isVisible()).toBe(false)
    expect(await google()).toBe(0)
    // ↓ 只在有把握的本地结果里挪（第 4 轮 d501a46）：这里没有本地结果，↓ 不选中网页那一行，再回车也不上网
    await page.keyboard.press('ArrowDown')
    await expect(pal(page).locator('.pal-row.on')).toHaveCount(0)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(400)
    await expect(pal(page)).toBeVisible()
    expect(await web(page).isVisible()).toBe(false)
    expect(await google()).toBe(0)
    // 明确要上网：⌘↵ 去网页搜
    await page.keyboard.press('Meta+Enter')
    await expect(pal(page)).toHaveCount(0)
    await expect(web(page)).toBeVisible()
    await expect.poll(google).toBeGreaterThan(0)
    // 鼠标点「在右栏网页里搜」那一行：也是明确要上网，换个词再搜一次
    const before = await google()
    await page.keyboard.press('Meta+k')
    await page.keyboard.insertText('小布什')
    await expect(pal(page).locator('.pal-none')).toHaveText('笔记和PDF里都没有「小布什」这几个字')
    await pal(page).getByRole('option').filter({ hasText: '在右栏网页里搜' }).click()
    await expect(pal(page)).toHaveCount(0)
    await expect.poll(google).toBeGreaterThan(before)
  } finally {
    await run.close()
  }
})

// ---------------------------------------------------------------- 读 PDF：答的时候再问（排队）、停下、关掉

const PDF = '课程/线性代数/第3讲 线性映射.pdf'
const NOTE = '课程/线性代数/第3讲 线性映射 笔记.md'
const pdfFiles = { [PDF]: LECTURE, '随手记.md': '# 随手记\n\n一段字。\n' }
const ai = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })
const pdfPane = (page: Page) => page.locator('.pdfpane:not([hidden])')
const pdfPage = (page: Page, n: number) => pdfPane(page).locator(`.pdfpage[data-page="${n}"]`)
const askBox = (page: Page) => ai(page).getByRole('textbox', { name: '问 AI' })
const cap = (page: Page) => pdfPane(page).getByRole('toolbar', { name: '框好的这块' })
const userMsgs = (page: Page) => ai(page).locator('.um-wrap .um')
const queued = (page: Page) => ai(page).getByTestId('reading-queued')
const stopBtn = (page: Page) => ai(page).getByRole('button', { name: '停下' })

async function openPdf(page: Page) {
  await page.keyboard.press('Meta+k')
  await palBox(page).fill('第3讲')
  await page.locator('.pal-row', { hasText: '第3讲 线性映射' }).first().click()
  await expect(tabOn(page)).toHaveText('第3讲 线性映射.pdf')
  await expect(pdfPage(page, 1).locator('canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
  await openAi(page)
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

/** 等第 n 条回答答完（发送键回来了、回答有字） */
async function answered(page: Page, n: number) {
  await expect(ai(page).getByTestId('reading-msg')).toHaveCount(n, { timeout: 15_000 })
  await expect(ai(page).getByTestId('reading-msg').last().locator('.txt')).not.toBeEmpty()
  await expect(ai(page).getByRole('button', { name: '发送' })).toBeVisible()
}

/** 问这一页，等它开始答（停下键出来） */
async function askPageRunning(page: Page) {
  await acts(page).getByRole('button', { name: /问这一页/ }).click()
  await expect(stopBtn(page)).toBeVisible()
}

test('AI 在答时：框一块直接按回车、打自己的问题回车，都和点浮条「讲解一下」一样排在后面，答完自动发', async () => {
  const run = await launch(pdfFiles, { CN_AI_FAKE: '1', CN_FAKE_SAY_MS: '120' })
  const { page } = run
  try {
    await shotTone(page)
    await openPdf(page)
    // 1. 框一块（预填「给我讲解一下」并全选）直接回车
    await askPageRunning(page)
    await drawBox(page, 4, [0.1, 0.15], [0.6, 0.3])
    await expect(ai(page).getByTestId('reading-att').locator('img')).toBeVisible()
    await expect(askBox(page)).toHaveValue('给我讲解一下')
    await askBox(page).press('Enter')
    await expect(queued(page)).toContainText('答完上一问自动发出：给我讲解一下')
    await expect(askBox(page)).toHaveValue('')
    await expect(userMsgs(page)).toHaveCount(2, { timeout: 15_000 })
    await expect(userMsgs(page).nth(1)).toHaveText('给我讲解一下')
    await answered(page, 2)
    await expect(ai(page).locator('.daysep').last()).toContainText('第4页')
    await expect(queued(page)).toHaveCount(0)

    // 2. 没框东西，打自己的问题回车
    await askPageRunning(page)
    await askBox(page).fill('这一页和上一页什么关系')
    await askBox(page).press('Enter')
    await expect(queued(page)).toContainText('答完上一问自动发出：这一页和上一页什么关系')
    await shotPart(ai(page).locator('.reading-in'), 'r2-queued-input')
    await shotWindow(run, 'r2-queued')
    await expect(askBox(page)).toHaveValue('')
    await expect(userMsgs(page)).toHaveCount(4, { timeout: 15_000 })
    await expect(userMsgs(page).nth(3)).toHaveText('这一页和上一页什么关系')
    await answered(page, 4)

    // 3. 排着时点「不发了」：字回到输入框，答完不发
    await askPageRunning(page)
    await askBox(page).fill('先别发这句')
    await askBox(page).press('Enter')
    await expect(queued(page)).toBeVisible()
    await queued(page).getByRole('button', { name: '不发了' }).click()
    await expect(queued(page)).toHaveCount(0)
    await expect(askBox(page)).toHaveValue('先别发这句')
    await answered(page, 5)
    await page.waitForTimeout(1200)
    await expect(userMsgs(page)).toHaveCount(5)
  } finally {
    await run.close()
  }
})

test('排着队时点「停下」：连排着的一起停，不再发；框的那块留在待问区，输入框写回原来的字', async () => {
  const run = await launch(pdfFiles, { CN_AI_FAKE: '1', CN_FAKE_SAY_MS: '120' })
  const { page } = run
  try {
    await shotTone(page)
    await openPdf(page)
    // 浮条「讲解一下」排上，再停下
    await askPageRunning(page)
    await drawBox(page, 4, [0.1, 0.15], [0.6, 0.3])
    await expect(ai(page).getByTestId('reading-att').locator('img')).toBeVisible()
    await cap(page).getByRole('button', { name: /讲解一下/ }).click()
    await expect(queued(page)).toBeVisible()
    await stopBtn(page).click()
    await expect(ai(page).getByRole('button', { name: '发送' })).toBeVisible()
    await expect(queued(page)).toHaveCount(0)
    await expect(ai(page).getByTestId('reading-att')).toContainText('第4页')
    await expect(askBox(page)).toHaveValue('给我讲解一下')
    await shotWindow(run, 'r2-stop-restored')
    await page.waitForTimeout(1500)
    await expect(userMsgs(page)).toHaveCount(1)
    await expect(stopBtn(page)).toHaveCount(0)
    // 自己回车发：发的就是待问区那块
    await askBox(page).press('Enter')
    await expect(userMsgs(page)).toHaveCount(2)
    await answered(page, 2)
    await expect(ai(page).locator('.daysep').last()).toContainText('第4页')

    // 打了自己的问题回车排上，再停下：那句回到输入框
    await askPageRunning(page)
    await askBox(page).fill('第三个箭头是什么')
    await askBox(page).press('Enter')
    await expect(queued(page)).toBeVisible()
    await expect(askBox(page)).toHaveValue('')
    await stopBtn(page).click()
    await expect(queued(page)).toHaveCount(0)
    await expect(askBox(page)).toHaveValue('第三个箭头是什么')
    await page.waitForTimeout(1500)
    await expect(userMsgs(page)).toHaveCount(3)
  } finally {
    await run.close()
  }
})

test('排着队时关掉 PDF：排着的那块不发、不记笔记；正在答的那一问照常记下', async () => {
  const run = await launch(pdfFiles, { CN_AI_FAKE: '1', CN_FAKE_SAY_MS: '120', CN_FAKE_NOTE_MS: '200' })
  const { page, vault } = run
  try {
    await shotTone(page)
    await openPdf(page)
    await askPageRunning(page)
    await drawBox(page, 4, [0.1, 0.15], [0.6, 0.3])
    await expect(ai(page).getByTestId('reading-att').locator('img')).toBeVisible()
    await cap(page).getByRole('button', { name: /讲解一下/ }).click()
    await expect(queued(page)).toBeVisible()
    await page.keyboard.press('Meta+w')
    await expect(tabOn(page)).not.toHaveText('第3讲 线性映射.pdf')
    // 正在答的第 1 页那一问记进笔记；第 4 页那块没问、没记
    const note = join(vault, NOTE)
    await expect.poll(() => existsSync(note) && /## 第 1 页/.test(readFileSync(note, 'utf8')), { timeout: 20_000 }).toBe(true)
    await page.waitForTimeout(4000)
    const text = readFileSync(note, 'utf8')
    expect(text.match(/^## /gm)?.length).toBe(1)
    expect(text).not.toContain('第 4 页')
  } finally {
    await run.close()
  }
})

// ---------------------------------------------------------------- 梦游报告里直接「收下」

const png = solidPng(64, 40, [80, 140, 120])
const L5 = '# Lecture05 笔记\n\n这一讲讲比较静态。\n\n![](../../附件/image-1.png)\n\n最后一段。\n'
const dreamFiles: Record<string, string | Uint8Array> = { '课程/ecp/Lecture05 笔记.md': L5, '附件/image-1.png': png }
const dreamPanel = (page: Page) => page.getByRole('complementary', { name: '梦游报告' })
const toast = (page: Page) => page.getByTestId('toast')

/** 记下出现过的每一句提示（提示会被下一句顶掉，只看最后一句看不出中间说过什么） */
async function recordToasts(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { toasts: string[] }
    w.toasts = []
    new MutationObserver(() => {
      const t = (document.querySelector('[data-testid="toast"]') as HTMLElement | null)?.innerText ?? ''
      if (t && w.toasts[w.toasts.length - 1] !== t) w.toasts.push(t)
    }).observe(document.body, { subtree: true, childList: true, characterData: true })
  })
  return () => page.evaluate(() => (window as unknown as { toasts: string[] }).toasts)
}

test('梦游报告里直接点「收下」：和预览标签一样有提示条和撤回；那篇正开着在打字时写「梦游挪了图，链接已更新」，不说外部改动，打的字都在', async () => {
  const run = await launch(dreamFiles, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  const note = join(vault, '课程/ecp/Lecture05 笔记.md')
  const moved = join(vault, '附件/课程/ecp/Lecture05 笔记/image-1.png')
  try {
    await shotTone(page)
    const toasts = await recordToasts(page)
    await leftView(page, '梦游报告')
    await dreamPanel(page).getByRole('button', { name: '现在梦游' }).click()
    await expect(dreamPanel(page).getByTestId('dream-summary')).toContainText('整理了', { timeout: 30_000 })
    const item = dreamPanel(page).getByTestId('dream-item').filter({ hasText: /老图/ })
    const detail = dreamPanel(page).getByTestId('dream-detail')

    // 1. 那篇没开：收下 → 「老图挪好了，一次提交进了main · 撤回」，撤回回到原样
    await item.click()
    await detail.getByRole('button', { name: '收下', exact: true }).click()
    await expect(toast(page)).toContainText('老图挪好了，一次提交进了main')
    await shotWindow(run, 'r2-dream-take')
    await expect.poll(() => existsSync(moved)).toBe(true)
    await toast(page).getByRole('button', { name: '撤回' }).click()
    await expect(toast(page)).toContainText('撤回了，老图回到了原处')
    await expect.poll(() => existsSync(join(vault, '附件/image-1.png'))).toBe(true)
    expect(readFileSync(note, 'utf8')).toBe(L5)

    // 2. 那篇开着、正在打字：收下 → 「梦游挪了图，链接已更新 · 撤回」，没有「外部改动已经合并进来」
    await leftView(page, '文件')
    await openNote(page, 'Lecture05 笔记')
    await pane(page).getByText('最后一段。').click()
    await page.keyboard.press('End')
    await page.keyboard.type('我正在打的字')
    await leftView(page, '梦游报告')
    await item.click()
    await detail.getByRole('button', { name: '收下', exact: true }).click()
    await expect(toast(page)).toContainText('梦游挪了图，链接已更新')
    await expect(toast(page).getByRole('button', { name: '撤回' })).toBeVisible()
    await shotWindow(run, 'r2-dream-take-open')
    await expect.poll(() => existsSync(moved)).toBe(true)
    await page.waitForTimeout(1500)
    await expect(toast(page)).toContainText('梦游挪了图，链接已更新')
    // 点那一条中间开了它的预览（task-m552v）：回到那篇的标签接着看
    await page.getByTestId('tab-list').locator('.tab', { hasText: 'Lecture05 笔记' }).first().click()
    await expect(tabOn(page)).toContainText('Lecture05 笔记')
    await waitSaved(page)
    const md = readFileSync(note, 'utf8')
    expect(md).toContain('最后一段。我正在打的字')
    expect(md).toContain('../../附件/课程/ecp/Lecture05%20笔记/image-1.png')
    expect((await toasts()).some((t) => t.includes('外部改动') || t.includes('外面也改过'))).toBe(false)
    // 撤回：图回原处、链接改回，打的字还在
    await toast(page).getByRole('button', { name: '撤回' }).click()
    await expect(toast(page)).toContainText('撤回了，老图回到了原处')
    await expect.poll(() => existsSync(join(vault, '附件/image-1.png'))).toBe(true)
    await page.waitForTimeout(1500)
    await waitSaved(page)
    expect(readFileSync(note, 'utf8')).toBe(L5.replace('最后一段。', '最后一段。我正在打的字'))
    expect((await toasts()).some((t) => t.includes('外部改动') || t.includes('外面也改过'))).toBe(false)
  } finally {
    await run.close()
  }
})

test('「问这一页」的整页图：右栏笔记里那一轮第二行写「· 整页」，不写「我框的」', async () => {
  const run = await launch(pdfFiles, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await shotTone(page)
    await openPdf(page)
    await acts(page).getByRole('button', { name: /问这一页/ }).click()
    await answered(page, 1)
    const msg = ai(page).getByTestId('reading-msg').last()
    await expect(msg.locator('.noted')).toContainText('已记进笔记', { timeout: 15_000 })
    await msg.locator('.noted .lnk').click()
    const notes = page.getByRole('complementary', { name: '笔记', exact: true })
    await expect(notes.locator('.rnd .loc').first()).toHaveText('第1页 ›· 整页')
    await expect(notes.locator('.rnd .crop img').first()).toHaveAttribute('alt', '整页')
    await shotWindow(run, 'r2-whole-page')
  } finally {
    await run.close()
  }
})

test('窗口拉到最窄（960）读 PDF：收起 AI 的 × 不被裁、组头和 AI 头不溢出、面板不横向溢出，中间至少 420', async () => {
  const run = await launch(pdfFiles, { CN_AI_FAKE: '1' })
  const { page, app } = run
  try {
    await shotTone(page)
    await openPdf(page)
    for (const w of [1100, 900]) {
      await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0]!.setSize(width, 900), w)
      await page.waitForTimeout(600)
      const m = await page.evaluate(() => {
        const aside = document.querySelector('.reading-ai:not([hidden])') as HTMLElement
        const head = aside.querySelector('.aih') as HTMLElement
        // 工作区方向 A（task-9okg5）：收起 AI 是组头上「AI」标签的 ×，AI 头上不再有「收起」
        const grp = document.querySelector('.dgrp:has(.dtab[data-view="ai"])') as HTMLElement
        const tabs = grp.querySelector('.dhead') as HTMLElement
        const btn = grp.querySelector('.dtab[data-view="ai"] .x') as HTMLElement
        const g = grp.getBoundingClientRect()
        const b = btn.getBoundingClientRect()
        return {
          win: window.innerWidth,
          center: (document.querySelector('main.center') as HTMLElement).getBoundingClientRect().width,
          hscroll: aside.scrollWidth - aside.clientWidth,
          headOver: head.scrollWidth - head.clientWidth,
          tabsOver: tabs.scrollWidth - tabs.clientWidth,
          btnInside: b.right <= g.right + 0.5 && b.width > 0,
        }
      })
      console.log(w, JSON.stringify(m))
      expect(m.hscroll).toBe(0)
      expect(m.headOver).toBe(0)
      expect(m.tabsOver).toBe(0)
      expect(m.btnInside).toBe(true)
      expect(m.center).toBeGreaterThanOrEqual(420)
      await shotWindow(run, `r2-narrow-${m.win}`)
    }
    await expect(page.getByTestId('dtab-ai').getByRole('button', { name: '收起AI' })).toBeVisible()
  } finally {
    await run.close()
  }
})

test('历史「还没提交的改动」那一行：点了中间开对比标签看改了什么；量词和底栏一样是「处」', async () => {
  const run = await launch({ '随手记.md': '# 随手记\n\n一段字。\n', '长文.md': '# 长文\n\n第一段。\n' })
  const { page, vault } = run
  try {
    await shotTone(page)
    await openNote(page, '随手记')
    await pane(page).getByText('一段字。').click()
    await page.keyboard.press('End')
    await page.keyboard.type('刚打的字')
    await waitSaved(page)
    writeFileSync(join(vault, '长文.md'), '# 长文\n\n第一段。\n\n外面加的一段。\n')
    await expect(page.getByTestId('git-changed')).toContainText('2处没提交', { timeout: 10_000 })
    await rail(page).getByRole('button', { name: '历史' }).click()
    const hist = page.getByRole('complementary', { name: '历史' })
    const row = hist.getByTestId('history-pending')
    await expect(row).toContainText(/^还没提交的改动2处 · /)
    await row.getByRole('button', { name: /还没提交的改动/ }).click()
    await expect(tabOn(page)).toHaveText('还没提交的改动')
    const dv = page.getByTestId('diff-tab')
    await expect(dv.locator('[data-file="随手记.md"]')).toBeVisible()
    await expect(dv.locator('[data-file="长文.md"]')).toBeVisible()
    await expect(dv).toContainText('刚打的字')
    await expect(dv).toContainText('外面加的一段。')
    await expect(acts(page).getByTestId('page-note')).toHaveText('还没提交的改动 · 2处')
    await shotWindow(run, 'r2-history-working')
  } finally {
    await run.close()
  }
})
