// 录屏 86 条里看视频时 AI 这一组（G3）：「记到哪」菜单的样子（CN-78）、底部提示在窄栏里不截断（CN-85）、
// 框一块问就地答进文档、不再弹浮窗（CN-84 B）。视频站是本机假的（e2e/fixtures/fake-video.ts），AI 是假的（CN_AI_FAKE）。
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { join } from 'node:path'
import { launch, openNote, pane, rail, type Running, waitSaved } from './app'
import { FAKE_VIDEO_ID, startFakeVideoSite } from './fixtures/fake-video'

let server: Server
let base: string

test.beforeAll(async () => {
  ;({ server, base } = await startFakeVideoSite())
})
test.afterAll(() => server.close())

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const strip = (page: Page) => web(page).getByRole('region', { name: '视频条' })
const env = () => ({ CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '150', CN_VIDEO_TEST_ORIGIN: base })

function guest(page: Page, code: string): Promise<unknown> {
  return page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code)
}

async function openVideo(page: Page) {
  await rail(page).getByRole('button', { name: '网页' }).click()
  const addr = web(page).getByRole('textbox', { name: '网址' })
  await addr.fill(`${base}/watch?v=${FAKE_VIDEO_ID}`)
  await addr.press('Enter')
  await expect(strip(page)).toBeVisible({ timeout: 15_000 })
  await expect(strip(page).getByRole('button', { name: '字幕' })).toContainText('英→中', { timeout: 15_000 })
}

async function seek(page: Page, sec: number) {
  await guest(page, `(() => { const v = document.querySelector('video'); v.currentTime = ${sec}; v.pause(); return true })()`)
  await expect.poll(async () => Math.round(Number(await guest(page, 'document.querySelector("video").currentTime')))).toBe(sec)
}

/** 交付用的截图（CN_SHOTS 给了才截）：从主进程截整个窗口，右栏网页也在里面 */
async function shot(run: Running, name: string) {
  const dir = process.env.CN_SHOTS
  if (!dir) return
  await run.page.waitForTimeout(250)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(dir, `${name}.png`), Buffer.from(b64, 'base64'))
}

async function setWindowWidth(app: ElectronApplication, w: number) {
  await app.evaluate(({ BrowserWindow }, width) => {
    const win = BrowserWindow.getAllWindows()[0]!
    const [, h] = win.getSize()
    win.setSize(width, h!)
  }, w)
}

test('CN-78：「记到哪」菜单和引擎菜单一个样子（280 宽、圆角 12、行 30 高无边框、勾在左边 12 宽、图标和名字一行）', async () => {
  const run = await launch({ '看视频的笔记.md': '# 看视频的笔记\n\n' }, env())
  const { page } = run
  try {
    await openNote(page, '看视频的笔记')
    await openVideo(page)
    await strip(page).getByRole('button', { name: '记到 看视频的笔记' }).click()
    const menu = web(page).getByRole('menu', { name: '记到' })
    await expect(menu).toBeVisible()
    // 弹出动画（缩放）走完再量
    await expect.poll(() => menu.evaluate((el) => el.getAnimations().length)).toBe(0)
    const m = await menu.evaluate((el) => {
      const cs = getComputedStyle(el)
      const rows = [...el.querySelectorAll('button')].map((b) => {
        const s = getComputedStyle(b)
        const r = b.getBoundingClientRect()
        const ck = b.querySelector('.ck')!.getBoundingClientRect()
        const icon = b.querySelector(':scope > .ci')!.getBoundingClientRect()
        const label = b.querySelector('.mlabel')!.getBoundingClientRect()
        return { h: Math.round(r.height), border: s.borderTopWidth, ckX: Math.round(ck.left - r.left), ckW: Math.round(ck.width), sameLine: Math.abs(icon.top + icon.height / 2 - (label.top + label.height / 2)) < 3, text: b.textContent }
      })
      return { w: Math.round(el.getBoundingClientRect().width), radius: cs.borderRadius, rows }
    })
    expect(m.w).toBe(280)
    expect(m.radius).toBe('12px')
    expect(m.rows).toHaveLength(2)
    for (const r of m.rows) {
      expect(r.h).toBe(30)
      expect(r.border).toBe('0px')
      expect(r.ckX).toBe(8)
      expect(r.ckW).toBe(12)
      expect(r.sameLine).toBe(true)
    }
    expect(m.rows[0]!.text).toContain('文档光标处 · 看视频的笔记')
    expect(m.rows[1]!.text).toContain('收件箱 · 新建一篇')
    await expect(menu.getByRole('menuitemradio', { name: /文档光标处/ })).toHaveAttribute('aria-checked', 'true')
    await shot(run, 'CN-78-dest-menu')
  } finally {
    await run.close()
  }
})

test('CN-85：记下这一刻的底部提示在中间栏 420、600、900 宽时「记进了」「00:01」「撤回」都看得全', async () => {
  const run = await launch({ '看视频的笔记.md': '# 看视频的笔记\n\n' }, env())
  const { page, app } = run
  try {
    await openNote(page, '看视频的笔记')
    await openVideo(page)
    await seek(page, 1)
    await strip(page).getByRole('button', { name: '记下这一刻' }).click()
    const toast = page.locator('.vtoast')
    await expect(toast).toContainText('记进了《看视频的笔记》 · 00:01')
    const center = page.locator('main.center')
    for (const target of [900, 600, 420]) {
      // 调窗口宽，让中间栏到目标宽
      for (let i = 0; i < 4; i++) {
        const cw = (await center.boundingBox())!.width
        if (Math.abs(cw - target) < 6) break
        const ww = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getSize()[0]!)
        await setWindowWidth(app, Math.round(ww + target - cw))
        await page.waitForTimeout(150)
      }
      const cw = (await center.boundingBox())!.width
      expect(Math.abs(cw - target)).toBeLessThan(10)
      const box = (await toast.boundingBox())!
      const cb = (await center.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(cb.x)
      expect(box.x + box.width).toBeLessThanOrEqual(cb.x + cb.width)
      for (const sel of ['.vt-verb', '.vt-time']) {
        const el = toast.locator(sel)
        await expect(el).toBeVisible()
        // 没被截：自己的内容宽 = 看得到的宽
        expect(await el.evaluate((e) => e.scrollWidth <= e.clientWidth + 1 && e.getBoundingClientRect().width > 0)).toBe(true)
      }
      await expect(toast.locator('.vt-verb')).toHaveText('记进了')
      await expect(toast.locator('.vt-time')).toHaveText(' · 00:01')
      const undo = toast.getByRole('button', { name: '撤回' })
      await expect(undo).toBeVisible()
      const ub = (await undo.boundingBox())!
      expect(ub.x + ub.width).toBeLessThanOrEqual(box.x + box.width)
      // 窄于 520 时附带说明不显示
      if (target < 520) await expect(toast.locator('.vt-extra')).toBeHidden()
      else await expect(toast.locator('.vt-extra')).toBeVisible()
      await shot(run, `CN-85-toast-${target}`)
      // 提示 6 秒后收起：再记一次让它一直在
      if (target !== 420) {
        await seek(page, 1)
        await strip(page).getByRole('button', { name: '记下这一刻' }).click()
      }
    }
    void pane
  } finally {
    await run.close()
  }
})

/** ⌥D 框一块问：在画面上拖一个框，问话框里回车 */
async function boxAsk(page: Page) {
  // 点第一行字进文档：不点编辑器正中，答过一问后正中是问答块的「接着问」按钮（点了开右栏 AI、焦点进它的输入框）
  await pane(page).locator('.cm-content .cm-line').first().click()
  await page.keyboard.press('Meta+End')
  await page.keyboard.press('Alt+KeyD')
  await expect.poll(() => guest(page, `!!document.getElementById('cn-video-host').shadowRoot.querySelector('.box')`)).toBe(true)
  const wv = (await web(page).locator('webview.on').boundingBox())!
  await page.mouse.move(wv.x + 120, wv.y + 60)
  await page.mouse.down()
  await page.mouse.move(wv.x + 220, wv.y + 140, { steps: 6 })
  await page.mouse.up()
  const ask = web(page).getByRole('dialog', { name: '问 AI' })
  await expect(ask).toBeVisible()
  await ask.getByRole('textbox', { name: '想问什么' }).press('Enter')
}

test('CN-84 B / CN-76：框一块问不弹浮窗，文档里先出占位（esc 停下），答好原地变成 [!ai] 提示块，块下面空一段、光标在那里；「接着问」和 ⌘J 开在右栏下格', async () => {
  const run = await launch({ '看视频的笔记.md': '# 看视频的笔记\n\n我先写的一句。\n' }, { ...env(), CN_AI_FAKE_ASK_MS: '1500' })
  const { page, vault } = run
  const float = page.getByRole('complementary', { name: 'AI 对话' })
  try {
    await openNote(page, '看视频的笔记')
    await openVideo(page)
    await seek(page, 6)
    // 网页每 250 毫秒报一次播到哪（视频条、占位上的时间用它）
    await page.waitForTimeout(400)

    // 第一问：占位出在文档里，浮窗不出来，底栏「后台 1 件」
    await boxAsk(page)
    const wait = pane(page).locator('.cm-aiwait')
    await expect(wait).toBeVisible()
    await expect(wait).toContainText('AI正在看00:06这一帧…')
    await expect(wait.getByRole('button', { name: /停下/ })).toBeVisible()
    await expect(float).toBeHidden()
    await expect(page.locator('.status')).toContainText('后台1件')
    await shot(run, 'CN-84-waiting')
    // 答好了：占位换成问答块 + 提示块，提示「AI 讲完了」
    await expect(page.getByText('AI讲完了，记进《看视频的笔记》和「视频里的疑惑」')).toBeVisible({ timeout: 15_000 })
    await expect(wait).toHaveCount(0)
    await expect(float).toBeHidden()
    // 焦点留在视频上（不抢焦点）；回到文档（焦点回来、不点别处）光标就停在提示块下面的空段落：直接打字
    await page.evaluate(() => (document.querySelector('.pane:not([hidden]) .cm-content') as HTMLElement).focus())
    await page.keyboard.type('我自己的理解：两个落点定一切')
    await expect.poll(() => readFileSync(join(vault, '看视频的笔记.md'), 'utf8'), { timeout: 10_000 }).toContain('我自己的理解')
    await waitSaved(page)
    const md = readFileSync(join(vault, '看视频的笔记.md'), 'utf8')
    expect(md).toMatch(/我先写的一句。\n+<!-- video video=youtube:/)
    expect(md).toContain('> **我的疑惑**：框里这两个箭头为什么能决定整个网格怎么动？\n\n> [!ai] AI 讲解 · Claude Code · Opus 5.5 · 看了 00:06 这一帧、00:00–00:36 的字幕\n> 框里是 i 帽和 j 帽变换后的位置。')
    expect(md).toContain('> - 矩阵的两列就是这两个落点\n\n我自己的理解：两个落点定一切\n')
    expect(md).not.toContain('AI正在看')
    await shot(run, 'CN-76-answered')

    // 第二问：esc 停下，文档不多东西
    await boxAsk(page)
    await expect(wait).toBeVisible()
    await pane(page).getByText('我先写的一句。').click()
    await page.keyboard.press('Escape')
    await expect(wait).toHaveCount(0)
    await expect(page.getByText('停下了，这一问没记')).toBeVisible()
    await page.waitForTimeout(1800)
    expect(readFileSync(join(vault, '看视频的笔记.md'), 'utf8').match(/moment-ask/g)).toHaveLength(1)

    // 「接着问」：AI 开在右栏下格，这条疑惑放进输入框当引文；不弹浮窗
    const reading = page.getByRole('complementary', { name: '边读边问 AI' })
    await pane(page).getByText('我先写的一句。').click()
    await pane(page).locator('[data-part="问答块"]').getByRole('button', { name: '接着问' }).click()
    await expect(reading).toBeVisible()
    await expect(reading.getByTestId('reading-att').locator('.ct')).toHaveText('框里这两个箭头为什么能决定整个网格怎么动？')
    await expect(float).toBeHidden()
    await shot(run, 'CN-84-followup')
    // ⌘J 收起；右栏开着视频时 ⌘J 开在右栏下格，不是中间栏的浮窗
    await reading.getByRole('button', { name: '收起 AI' }).click()
    await expect(reading).toHaveCount(0)
    await pane(page).getByText('我先写的一句。').click()
    await page.keyboard.press('Meta+j')
    await expect(reading).toBeVisible()
    await expect(float).toBeHidden()
  } finally {
    await run.close()
  }
})
