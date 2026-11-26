// 框一块问的问框（task-sta8n，方向 A 和旁支 A「就地展开」同一套样子，原型 /private/tmp/canvas-notes-webbar/proto.html#dir=a）：
// 问框在视频下面、不挡视频；头上是框住那块的小图、「问框住的这一块」、「00:06 这一帧 ·」和默认勾上的「带上前后字幕」；
// 四个建议（「讲解这一块」「换个说法讲」两颗固定，另两颗小活看字幕现想）；多行输入；谁来答 · 模型 · effort（看不了图的灰着写「看不了图」）；
// 最底下「记进《…》▾」能换（开着的这篇、新建一篇、收件箱、只问不记），这个视频记住。回车后回答在问框里就地出来，
// 写进那篇本身、插在光标处（2026-11-24 AI 对话记笔记开关：一问一个小标题 + AI 回答框，不再插老的讲解块）；
// 接着问也记进去；「在 AI 标签里聊」把问答带去 AI 标签。esc：在答时停下，答完关掉。
// 视频站是本机假的（e2e/fixtures/fake-video.ts，当成 YouTube），AI 是假的（CN_AI_FAKE）。
import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { join } from 'node:path'
import { launch, openNote, pane, rail, waitSaved } from './app'
import { FAKE_VIDEO_ID, startFakeVideoSite } from './fixtures/fake-video'

let server: Server
let base: string
test.beforeAll(async () => {
  ;({ server, base } = await startFakeVideoSite())
})
test.afterAll(() => server.close())

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const strip = (page: Page) => web(page).getByRole('region', { name: '视频条' })
const askCard = (page: Page) => web(page).getByRole('dialog', { name: '问 AI' })
const env = () => ({ CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '150', CN_AI_FAKE_ASK_MS: '1500', CN_VIDEO_TEST_ORIGIN: base })
const NOTE = '看视频的笔记.md'

function guest(page: Page, code: string): Promise<unknown> {
  return page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code)
}

async function openVideo(page: Page) {
  await rail(page).getByRole('button', { name: '网页', exact: true }).click()
  const addr = web(page).getByRole('textbox', { name: '网址' })
  await addr.fill(`${base}/watch?v=${FAKE_VIDEO_ID}`)
  await addr.press('Enter')
  await expect(strip(page)).toBeVisible({ timeout: 15_000 })
  await expect(strip(page).getByRole('button', { name: '字幕', exact: true })).toContainText('英→中', { timeout: 15_000 })
}

async function seek(page: Page, sec: number) {
  await guest(page, `(() => { const v = document.querySelector('video'); v.currentTime = ${sec}; v.pause(); return true })()`)
  await expect.poll(async () => Math.round(Number(await guest(page, 'document.querySelector("video").currentTime')))).toBe(sec)
}

/** ⌥D，在画面上拖一个框（视频左上那一块） */
async function box(page: Page) {
  await page.keyboard.press('Alt+KeyD')
  await expect.poll(() => guest(page, `!!document.getElementById('cn-video-host').shadowRoot.querySelector('.box')`)).toBe(true)
  const wv = (await web(page).locator('webview.on').boundingBox())!
  await page.mouse.move(wv.x + 40, wv.y + 30)
  await page.mouse.down()
  await page.mouse.move(wv.x + 200, wv.y + 120, { steps: 6 })
  await page.mouse.up()
  await expect(askCard(page)).toBeVisible()
}

/** 视频下沿在窗口里的位置 */
async function videoBottom(page: Page): Promise<number> {
  const wv = (await web(page).locator('webview.on').boundingBox())!
  const r = (await guest(page, `(() => { const b = document.getElementById('movie_player').getBoundingClientRect(); return b.bottom })()`)) as number
  return wv.y + r
}

const md = (vault: string) => readFileSync(join(vault, NOTE), 'utf8')

/** 这个视频站记进这一篇（同「记到这篇」：剪藏去处规则 2026-11-25 起记下这一刻只照这个网站的去处走，中间开着的那篇不算） */
const pickNote = (page: Page, path: string) => page.evaluate(([o, p]) => localStorage.setItem('cn.webTarget', JSON.stringify({ [o!]: p })), [base, path])

test('问框：小图、带上前后字幕、四个建议、谁来答（看不了图的灰着）、多行输入、换记到哪；回车后回答在问框里出来、写进那篇本身；接着问接在后面；在 AI 标签里聊带过去', async () => {
  test.setTimeout(120_000)
  const run = await launch({ [NOTE]: '# 看视频的笔记\n\n我先写的一句。\n' }, env())
  const { page, vault } = run
  try {
    await pickNote(page, '看视频的笔记.md')
    await openNote(page, '看视频的笔记')
    await pane(page).getByText('我先写的一句。').click()
    await page.keyboard.press('End')
    await openVideo(page)
    await seek(page, 6)
    await page.waitForTimeout(400)
    await pane(page).getByText('我先写的一句。').click()
    await box(page)
    const ask = askCard(page)
    // 放在视频下面，不挡视频
    const ab = (await ask.boundingBox())!
    expect(ab.y).toBeGreaterThanOrEqual((await videoBottom(page)) + 4)
    expect(Math.round(ab.width)).toBe(Math.min(380, Math.round((await web(page).boundingBox())!.width) - 24))
    // 头：框住那块的小图（真的画出来了）、标题、这一帧、带上前后字幕（默认勾上）
    const thumb = ask.getByRole('img', { name: '框住的那块' })
    await expect(thumb).toBeVisible()
    await expect.poll(() => thumb.evaluate((i) => (i as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    await expect(ask).toContainText('问框住的这一块')
    await expect(ask).toContainText('00:06 这一帧')
    const ctx = ask.getByRole('checkbox', { name: '带上前后字幕' })
    await expect(ctx).toBeChecked()
    await ctx.click()
    await expect(ctx).not.toBeChecked()
    await ctx.click()
    await expect(ctx).toBeChecked()
    // 建议四颗：两颗固定，另两颗看字幕现想（假的小活回两颗）
    await expect(ask.getByRole('button', { name: '讲解这一块', exact: true })).toBeVisible()
    await expect(ask.getByRole('button', { name: '换个说法讲', exact: true })).toBeVisible()
    await expect(ask.getByTestId('ak-sug').getByRole('button')).toHaveCount(4, { timeout: 10_000 })
    // 光标在输入框里
    const input = ask.getByRole('textbox', { name: '想问什么' })
    await expect(input).toBeFocused()
    // 谁来答：Claude Code；别家灰着写「看不了图」
    await ask.getByTestId('ai-engine').click()
    const fam = page.getByRole('menu', { name: 'AI 引擎' })
    await expect(fam.getByRole('menuitemradio', { name: /Claude Code/ })).toBeEnabled()
    await expect(fam.getByRole('menuitemradio', { name: /Codex/ })).toBeDisabled()
    await expect(fam.getByRole('menuitemradio', { name: /Codex/ })).toContainText('看不了图')
    await page.keyboard.press('Escape')
    await expect(fam).toHaveCount(0)
    // effort 换成 Low：回答头上跟着写
    await ask.getByTestId('ai-effort').click()
    await page.getByRole('menu', { name: '想多久（effort）' }).getByRole('menuitemradio', { name: /Low/ }).click()
    await expect(ask.getByTestId('ai-effort')).toContainText('Low')
    // 记到哪：四样，换收件箱再换回来
    const dest = ask.getByRole('button', { name: /^记进/ })
    await expect(dest).toContainText('记进《看视频的笔记》')
    await dest.click()
    const dm = web(page).getByRole('menu', { name: '记到哪' })
    await expect(dm.getByRole('menuitemradio')).toHaveText([/看视频的笔记.*开着的这篇/, /新建一篇.*用视频标题/, /收件箱/, /只问不记.*回答只在这张卡里/])
    await dm.getByRole('menuitemradio', { name: /收件箱/ }).click()
    await expect(dest).toContainText('记进《Linear transformations and matrices》')
    await dest.click()
    await dm.getByRole('menuitemradio', { name: /开着的这篇/ }).click()
    await expect(dest).toContainText('记进《看视频的笔记》')
    // 多行：⇧↵ 换行，框跟着长高
    await input.click()
    const h1 = (await input.boundingBox())!.height
    await page.keyboard.type('这两个箭头')
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.type('为什么能定整个网格？')
    expect(await input.inputValue()).toBe('这两个箭头\n为什么能定整个网格？')
    expect((await input.boundingBox())!.height).toBeGreaterThan(h1 + 10)
    // 回车问：问框里先是「AI 正在看 00:06 这一帧…」和停下；焦点回到视频（文档里不再出占位：答好才写进那篇）
    await page.keyboard.press('Enter')
    await expect(ask).toContainText('你问：这两个箭头')
    await expect(ask.getByTestId('ak-wait')).toContainText('AI 正在看 00:06 这一帧…')
    await expect(ask.getByRole('button', { name: /停下/ })).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.activeElement?.tagName.toLowerCase())).toBe('webview')
    // 答好：回答在问框里，头上写着看了哪一帧、谁答的；写进那篇（问的原话做小标题、框住那块的小图）；底行「已记进《…》」
    const answer = ask.getByTestId('ak-answer').first()
    await expect(answer).toContainText('框里是 i 帽和 j 帽变换后的位置', { timeout: 15_000 })
    await expect(ask.getByTestId('ak-meta').first()).toContainText('看了 00:06 这一帧 · Claude Code · Opus 5.5 · Low')
    await expect(ask.getByRole('button', { name: /已记进《看视频的笔记》/ })).toBeVisible()
    await expect.poll(() => md(vault)).toContain('我先写的一句。\n\n### 这两个箭头\n\n为什么能定整个网格？\n\n![我框的](')
    expect(md(vault)).toContain('> [!ai] AI 回答 · Claude Code · Opus 5.5 · [回到 AI 对话](')
    await waitSaved(page)
    expect(md(vault)).not.toContain('moment-ask')
    // 回答下面那排（task-eavzx）：拷贝 · 插进文档 · ⋯ ｜ 还是不懂 · 换个方式讲；「接着问」拿掉了（问框下面就是输入框）
    const acts = ask.getByTestId('ak-ans-acts')
    // 问框窄：功能按钮带字，快捷回复排得下的排上、放不下的进 ⋯（eavzx-answer-sites 里数全两颗）
    await expect(acts.locator('[data-act]')).toHaveText(['拷贝', '插进文档', ''])
    await expect(acts.locator('[data-reply="still"]')).toBeVisible()
    await expect(ask.getByRole('button', { name: '接着问', exact: true })).toHaveCount(0)
    // 空格照样播放（焦点在视频上）
    await page.keyboard.press('Space')
    await expect.poll(() => guest(page, 'document.querySelector("video").paused')).toBe(false)
    await guest(page, `document.querySelector('video').pause()`)

    // 接着问（点下面的输入框）：写进同一块讲解
    await input.click()
    await expect(input).toBeFocused()
    await expect(input).toHaveAttribute('placeholder', '接着问这一块…')
    await page.keyboard.type('那网格线为什么还平行？')
    await page.keyboard.press('Enter')
    await expect(ask.getByTestId('ak-answer')).toHaveCount(2)
    await expect(ask.getByTestId('ak-answer').nth(1)).toContainText('框里是 i 帽', { timeout: 15_000 })
    // 第二问顶到问框上沿：问的那句露着，上一问滚上去了
    const log = ask.getByRole('log', { name: '回答' })
    expect(
      await log.evaluate((b) => {
        const q = b.lastElementChild!.querySelector('.ak-q')!.getBoundingClientRect()
        const r = b.getBoundingClientRect()
        return q.top >= r.top - 1 && q.bottom <= r.bottom + 1
      }),
    ).toBe(true)
    await expect.poll(() => md(vault), { timeout: 10_000 }).toContain('\n### 那网格线为什么还平行？\n')
    expect(md(vault).match(/^### /gm)).toHaveLength(2)
    expect(md(vault)).not.toContain('AI 笔记')
    // 「已记进」点了：中间是那篇
    await ask.getByRole('button', { name: /已记进/ }).click()
    await expect(page.getByTestId('tab-on')).toContainText('看视频的笔记')

    // ⋯ 里「到 AI 对话里接着聊」：问答都带过去
    await ask.getByTestId('ak-ans-acts').locator('[data-act="more"]').click()
    await page.getByRole('menuitem', { name: '到 AI 对话里接着聊' }).click()
    const reading = page.getByRole('complementary', { name: '边读边问 AI' })
    await expect(reading).toBeVisible()
    await expect(reading).toContainText('这两个箭头')
    await expect(reading).toContainText('框里是 i 帽和 j 帽变换后的位置')
    await expect(reading).toContainText('那网格线为什么还平行？')
  } finally {
    await run.close()
  }
})

test('问框：esc 在答时停下（这一问不记），答完关掉；只问不记不写进文档；重框用视频那一行的「框一块问」', async () => {
  test.setTimeout(120_000)
  const run = await launch({ [NOTE]: '# 看视频的笔记\n\n我先写的一句。\n' }, { ...env(), CN_AI_FAKE_ASK_MS: '2500' })
  const { page, vault } = run
  try {
    await openNote(page, '看视频的笔记')
    await pane(page).getByText('我先写的一句。').click()
    await openVideo(page)
    await seek(page, 9)
    await pane(page).getByText('我先写的一句。').click()
    await box(page)
    const ask = askCard(page)
    // 空着回车就是「讲解这一块」；在答时（焦点在视频上）按 esc：停下，文档里不多东西
    await ask.getByRole('textbox', { name: '想问什么' }).press('Enter')
    await expect(ask).toContainText('你问：讲解这一块')
    await expect(ask.getByTestId('ak-wait')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByText('停下了，这一问没记')).toBeVisible()
    await expect(ask).toHaveCount(0)
    await page.waitForTimeout(3000)
    expect(md(vault)).not.toContain('moment-ask')
    expect(md(vault)).not.toContain('[!ai]')

    // 只问不记：回答只在问框里，文档不动；记住这个视频选的
    await pane(page).getByText('我先写的一句。').click()
    await box(page)
    await ask.getByRole('button', { name: /^记进/ }).click()
    await web(page).getByRole('menu', { name: '记到哪' }).getByRole('menuitemradio', { name: /只问不记/ }).click()
    await expect(ask.getByRole('button', { name: /只问不记/ })).toBeVisible()
    await ask.getByRole('button', { name: '讲解这一块', exact: true }).click()
    await expect(ask.getByTestId('ak-answer')).toContainText('框里是 i 帽', { timeout: 15_000 })
    await expect(ask).toContainText('没记进笔记（只问不记）')
    await page.waitForTimeout(800)
    expect(md(vault)).not.toContain('moment-ask')
    expect(md(vault)).not.toContain('[!ai]')
    // 答完 esc：关掉问框
    await page.keyboard.press('Escape')
    await expect(ask).toHaveCount(0)
    // 这个视频记住了「只问不记」
    await pane(page).getByText('我先写的一句。').click()
    await box(page)
    await expect(ask.getByRole('button', { name: /只问不记/ })).toBeVisible()
    // 重框：问框上没有那颗了（2026-11-25 拿掉，和「框一块问」重复），用视频那一行的「框一块问」，问框收起、拖框重新开始
    await expect(ask.getByRole('button', { name: '重框' })).toHaveCount(0)
    await web(page).getByRole('region', { name: '视频条' }).getByRole('button', { name: '框一块问' }).click()
    await expect(ask).toHaveCount(0)
    await expect.poll(() => guest(page, `!!document.getElementById('cn-video-host').shadowRoot.querySelector('.box')`)).toBe(true)
    await page.keyboard.press('Escape')
  } finally {
    await run.close()
  }
})

test('网页栏 380 窄：问框宽是栏宽减 24，放在栏里；输入框底行（谁来答、模型、effort、发送）都在框里', async () => {
  const run = await launch({ [NOTE]: '# 看视频的笔记\n\n' }, env())
  const { page } = run
  try {
    await openNote(page, '看视频的笔记')
    await openVideo(page)
    await seek(page, 6)
    await pane(page).locator('.cm-content').click()
    await box(page)
    const ask = askCard(page)
    const panel = (await web(page).boundingBox())!
    const ab = (await ask.boundingBox())!
    expect(Math.round(ab.width)).toBe(Math.round(panel.width) - 24)
    expect(ab.x).toBeGreaterThanOrEqual(panel.x + 11)
    expect(ab.x + ab.width).toBeLessThanOrEqual(panel.x + panel.width - 11)
    const inBox = (await ask.getByTestId('ak-in').boundingBox())!
    for (const id of ['ai-engine', 'ai-model', 'ai-effort']) {
      const b = (await ask.getByTestId(id).boundingBox())!
      expect(b.x + b.width).toBeLessThanOrEqual(inBox.x + inBox.width)
    }
    const send = (await ask.getByRole('button', { name: '问', exact: true }).boundingBox())!
    expect(send.x + send.width).toBeLessThanOrEqual(inBox.x + inBox.width)
  } finally {
    await run.close()
  }
})
