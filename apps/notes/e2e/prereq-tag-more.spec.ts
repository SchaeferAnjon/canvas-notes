// 前置知识就地标签（功能小三件 3）：以前只有读 PDF 打〔前置知识〕，现在网页、视频、普通文档的问答也打。
// AI 回答末尾〔前置知识〕不显示（拷贝、插进文档也不带），记进剪藏那篇 / 记进的那篇时那一问的小标题末尾 #前置知识（照读 PDF 那套）；
// 写进那篇本身的（光标处、末尾）照旧在那里，只带标签；记进另一篇、没引哪一段的进那篇末尾「## 前置知识」一节。
// 问眼前内容本身的不带标签。一律无头（CN_E2E=1）、假 AI（CN_AI_FAKE=1：问「什么是 softmax」「什么是向量」时标前置知识），真点、真打字。
import { expect, test, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { join } from 'node:path'
import { launch, openAi, openNote, pane, rail, waitSaved, webAboveAi, widenRight } from './app'
import { d2l, type D2l, P1_LAST } from './fixtures/d2l-pandas'
import { FAKE_VIDEO_ID, startFakeVideoSite } from './fixtures/fake-video'

const SHOTS = '/private/tmp/canvas-notes-visual/117-功能小三件'
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

const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const reading = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })
const webPane = (page: Page) => page.getByRole('complementary', { name: '网页' })
const read = (vault: string, rel: string) => (existsSync(join(vault, rel)) ? readFileSync(join(vault, rel), 'utf8') : '')
function guest<T = unknown>(page: Page, code: string): Promise<T> {
  return page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code) as Promise<T>
}

/** AI 对话里问一句，等答完；返回那条回答 */
async function ask(page: Page, q: string, want: string) {
  const answers = chat(page).getByTestId('ai-msg')
  const n = await answers.count()
  const box = chat(page).getByRole('textbox', { name: '问 AI' })
  await box.fill(q)
  await box.press('Enter')
  await expect(answers).toHaveCount(n + 1)
  await expect(answers.nth(n).locator('.txt')).toContainText(want, { timeout: 15_000 })
  await expect(chat(page).getByRole('button', { name: '发送' })).toBeVisible()
  return answers.nth(n)
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
      .then(
        () => true,
        () => false,
      )
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

test('普通文档的 AI 对话：问论文外的基础知识，回答里不露〔前置知识〕、拷贝不带，写进这篇本身那一问带 #前置知识；问这一段本身的不带', async () => {
  test.setTimeout(180_000)
  const DOC = '读书/注意力机制.md'
  const run = await launch({ [DOC]: '# 注意力机制\n\n注意力就是按相关程度给每个词分权重。\n' }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    mkdirSync(SHOTS, { recursive: true })
    await openNote(page, '注意力机制')
    await openAi(page)
    // 拨开「记笔记」（看文档默认关），光标放在自己那句后面
    await chat(page).getByTestId('ai-note-main').click()
    await expect(chat(page).getByTestId('ai-note-main')).toHaveAttribute('aria-checked', 'true')
    await pane(page).getByText('注意力就是按相关程度').click()
    await page.keyboard.press('End')

    const a1 = await ask(page, '什么是 softmax', '这是眼前内容外的前置知识')
    await expect(a1).not.toContainText('〔前置知识〕')
    await expect(a1.getByTestId('ai-noted')).toHaveAttribute('data-state', 'done', { timeout: 15_000 })
    await expect.poll(() => read(vault, DOC)).toContain('### 什么是 softmax #前置知识\n\n> [!ai] AI 回答 · ')
    // 就地：接在自己那句后面（写进那篇本身的照旧插在光标处，不挪去末尾一节）
    expect(read(vault, DOC).startsWith('# 注意力机制\n\n注意力就是按相关程度给每个词分权重。\n\n### 什么是 softmax #前置知识\n')).toBe(true)
    expect(read(vault, DOC)).not.toContain('〔前置知识〕')
    expect(read(vault, DOC)).not.toContain('## 前置知识')
    // 编辑器里那一行：「#前置知识」画成一颗小标签「前置知识」（文件里照旧是字），问的那句照常
    const chip = pane(page).getByTestId('doc-pre-tag')
    await expect(chip).toHaveCount(1)
    await expect(chip).toHaveText('前置知识')
    await expect(pane(page).locator('.cm-h3', { has: page.getByTestId('doc-pre-tag') })).toContainText('什么是 softmax')
    await expect(pane(page).locator('.cm-h3', { has: page.getByTestId('doc-pre-tag') })).not.toContainText('#前置知识')
    expect(await chip.evaluate((el) => getComputedStyle(el).fontSize)).toBe('12px')
    // 回答下面 ⋯「拷贝为 Markdown」：不带标记
    await a1.hover()
    await a1.getByRole('button', { name: '这条回答还能做什么' }).click()
    await page.getByRole('menu', { name: '这条回答还能做什么' }).getByRole('menuitem', { name: '拷贝为 Markdown' }).click()
    await expect.poll(() => run.app.evaluate(({ clipboard }) => clipboard.readText())).toContain('softmax 把一串数变成')
    expect(await run.app.evaluate(({ clipboard }) => clipboard.readText())).not.toContain('〔前置知识〕')

    // 问这一段本身的：不带标签
    const a2 = await ask(page, '这一段讲了什么', '注意力怎么在几个词之间分配权重')
    await expect(a2.getByTestId('ai-noted')).toHaveAttribute('data-state', 'done', { timeout: 15_000 })
    await expect.poll(() => read(vault, DOC)).toContain('### 这一段讲了什么\n')
    expect(read(vault, DOC).match(/#前置知识/g)).toHaveLength(1)
    await waitSaved(page)
    await page.screenshot({ path: join(SHOTS, '5-文档问答带前置知识标签.png') })
  } finally {
    await run.close()
  }
})

test('首页聊、记进收件箱新建的那篇（不是看着的那篇本身）：前置知识进末尾「## 前置知识」一节，问别的照旧在「## 首页」、排在它前面', async () => {
  test.setTimeout(120_000)
  const run = await launch({ '周记.md': '# 周记\n\n这周读了 ECP。\n' }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await openAi(page)
    await expect(chat(page).getByTestId('ai-sees')).toContainText('首页')
    await ask(page, '这一段讲了什么', '注意力怎么在几个词之间分配权重')
    await chat(page).getByTestId('ai-note-main').click()
    const menu = page.getByTestId('ai-note-menu')
    await menu.getByTestId('ai-note-to-inbox').click()
    await chat(page).getByTestId('ai-note-tip').getByRole('button', { name: '补进去' }).click()
    const INBOX = '收件箱/和 AI 聊：这一段讲了什么.md'
    await expect.poll(() => read(vault, INBOX), { timeout: 15_000 }).toContain('## 首页\n\n### 这一段讲了什么\n')
    const a4 = await ask(page, '什么是 softmax', '这是眼前内容外的前置知识')
    await expect(a4.getByTestId('ai-noted')).toHaveAttribute('data-state', 'done', { timeout: 15_000 })
    await expect.poll(() => read(vault, INBOX)).toMatch(/\n## 前置知识\n\n### 什么是 softmax #前置知识\n\n> \[!ai\] /)
    const inbox = read(vault, INBOX)
    expect(inbox.indexOf('## 首页')).toBeLessThan(inbox.indexOf('## 前置知识'))
    // 首页再问一句别的：照旧进「## 首页」，排在「前置知识」一节前面
    const a5 = await ask(page, '这一段讲了什么呢', '注意力怎么在几个词之间分配权重')
    await expect(a5.getByTestId('ai-noted')).toHaveAttribute('data-state', 'done', { timeout: 15_000 })
    await expect.poll(() => read(vault, INBOX)).toContain('### 这一段讲了什么呢')
    const after = read(vault, INBOX)
    expect(after.indexOf('### 这一段讲了什么呢')).toBeLessThan(after.indexOf('## 前置知识'))
  } finally {
    await run.close()
  }
})

test('网页：选一句点「讲解一下」后接着问基础知识，剪藏那篇里那一问带 #前置知识，「讲解一下」那一问不带', async () => {
  test.setTimeout(180_000)
  const TITLE = '学习笔记：动手学深度学习'
  const NOTE = `课程/${TITLE}.md`
  const run = await launch({ [NOTE]: `---\nread-along: ${site.base}/\n---\n# ${TITLE}\n\n## 2.2 数据预处理\n\n先把数据读进来，再处理缺失值。\n` }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await openNote(page, TITLE)
    await widenRight(page, 200)
    await pane(page).getByText('先把数据读进来，再处理缺失值。').click()
    await page.keyboard.press('End')
    await openWeb(page, site.pandas)
    // 选一句点「讲解一下」（边读边问），再接着问「什么是 softmax」
    await selectIn(page, 'p1', '下面我们将', '写入CSV文件中。')
    await clickBar(page, '讲解一下')
    const msgs = reading(page).getByTestId('reading-msg')
    await expect(msgs.first().getByTestId('reading-ans-acts')).toBeVisible({ timeout: 20_000 })
    await expect(msgs.first().getByTestId('ai-noted')).toHaveAttribute('data-state', 'done', { timeout: 20_000 })
    const box = reading(page).getByRole('textbox', { name: '问 AI' })
    await box.fill('什么是 softmax')
    await box.press('Enter')
    await expect(msgs).toHaveCount(2, { timeout: 20_000 })
    await expect(msgs.nth(1)).toContainText('这是论文外的前置知识', { timeout: 20_000 })
    await expect(msgs.nth(1)).not.toContainText('〔前置知识〕')
    await expect(msgs.nth(1).getByTestId('ai-noted')).toHaveAttribute('data-state', 'done', { timeout: 20_000 })
    await expect.poll(() => read(vault, NOTE)).toContain('### 什么是 softmax #前置知识\n')
    // 「讲解一下」那一问不带
    expect(read(vault, NOTE)).toContain('### 给我讲解一下\n')
    expect(read(vault, NOTE).match(/#前置知识/g)).toHaveLength(1)
    expect(read(vault, NOTE)).not.toContain('〔前置知识〕')

  } finally {
    await run.close()
  }
})

test('网页：AI 对话里引了网页一段再问基础知识，写进剪藏那篇，问的那句带 ① 和 #前置知识', async () => {
  test.setTimeout(180_000)
  const TITLE = '学习笔记：动手学深度学习'
  const NOTE = `课程/${TITLE}.md`
  const run = await launch({ [NOTE]: `---\nread-along: ${site.base}/\n---\n# ${TITLE}\n\n## 2.2 数据预处理\n\n先把数据读进来，再处理缺失值。\n` }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await openNote(page, TITLE)
    await widenRight(page, 200)
    await pane(page).getByText('先把数据读进来，再处理缺失值。').click()
    await page.keyboard.press('End')
    // 右栏 AI 开着这篇笔记自己那段对话，网页摆在它上面
    await openAi(page)
    await openWeb(page, site.pandas)
    if ((await page.locator('.dgrp').count()) < 2) await webAboveAi(page)
    await expect(chat(page)).toBeVisible()
    await selectIn(page, 'p1', '下面我们将', '写入CSV文件中。')
    await clickBar(page, '引用')
    await expect(chat(page).getByTestId('ai-mat')).toHaveCount(1)
    const q = chat(page).getByRole('textbox', { name: '问 AI' })
    await q.click()
    await page.keyboard.press('End')
    await page.keyboard.type('什么是 softmax')
    await q.press('Enter')
    const last = chat(page).getByTestId('ai-msg').last()
    await expect(last.locator('.txt')).toContainText('这是眼前内容外的前置知识', { timeout: 20_000 })
    await expect(last).not.toContainText('〔前置知识〕')
    await expect(last.getByTestId('ai-noted')).toContainText(`已记进《${TITLE}》`, { timeout: 20_000 })
    await expect.poll(() => read(vault, NOTE)).toContain('### ①什么是 softmax #前置知识\n')
    expect(read(vault, NOTE)).not.toContain('〔前置知识〕')
    await waitSaved(page)
    await page.screenshot({ path: join(SHOTS, '6-网页问答带前置知识标签.png') })
  } finally {
    await run.close()
  }
})

test('视频问框：问视频外的基础知识，记进那篇的那一问带 #前置知识；问框里这一块本身的不带', async () => {
  test.setTimeout(120_000)
  const NOTE = '看视频的笔记.md'
  const run = await launch({ [NOTE]: '# 看视频的笔记\n\n我先写的一句。\n' }, { CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '150', CN_AI_FAKE_ASK_MS: '600', CN_VIDEO_TEST_ORIGIN: video.base })
  const { page, vault } = run
  try {
    await openNote(page, '看视频的笔记')
    await rail(page).getByRole('button', { name: '网页', exact: true }).click()
    const addr = webPane(page).getByRole('textbox', { name: '网址' })
    await addr.fill(`${video.base}/watch?v=${FAKE_VIDEO_ID}`)
    await addr.press('Enter')
    const strip = webPane(page).getByRole('region', { name: '视频条' })
    await expect(strip).toBeVisible({ timeout: 15_000 })
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
    const card = webPane(page).getByRole('dialog', { name: '问 AI' })
    await expect(card).toBeVisible()
    // 先问这一块本身（不带），再接着问「什么是向量」（带）
    await card.getByRole('button', { name: '讲解这一块', exact: true }).click()
    await expect(card.getByTestId('ak-answer').first()).toContainText('框里是 i 帽', { timeout: 15_000 })
    await expect(card.getByRole('button', { name: /已记进《看视频的笔记》/ })).toBeVisible({ timeout: 15_000 })
    await card.getByRole('textbox', { name: '想问什么' }).fill('什么是向量')
    await card.getByRole('textbox', { name: '想问什么' }).press('Enter')
    await expect(card.getByTestId('ak-answer')).toHaveCount(2)
    await expect(card.getByTestId('ak-answer').nth(1)).toContainText('这是视频外的前置知识', { timeout: 15_000 })
    await expect.poll(() => read(vault, NOTE), { timeout: 15_000 }).toContain('\n### 什么是向量 #前置知识\n\n—— [▶ 00:06')
    const md = read(vault, NOTE)
    expect(md).toContain('### 讲解这一块\n')
    expect(md.match(/#前置知识/g)).toHaveLength(1)
  } finally {
    await run.close()
  }
})
