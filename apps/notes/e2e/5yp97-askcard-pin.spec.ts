// 视频「框一块问」问框里开了旁支：旁支的输入框和「记到哪」那一行钉在问框底部（task-5yp97，用户看了
// /private/tmp/canvas-notes-visual/01-画布笔记小处/askcard-pin.png 选「选法 2」，原话「这里可以」）。
// 以前输入框在旁支那一块里，旁支一长就落到问框下沿外面，要滚一下才能接着问。现在：钉在主输入框那一行的位置（主输入框让给它，
// 收起旁支再回来），上面一条细线和滚着的问答分开；旁支问多长、回答区滚到哪，输入框都在问框里看得见、点得到，也不往上挡视频。
// 一律无头（CN_E2E=1）、假 AI（CN_AI_FAKE=1）；视频站是本机假的（fixtures/fake-video.ts）。
import { expect, test, type Locator, type Page } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { join } from 'node:path'
import { launch, openNote, pane, rail, waitSaved } from './app'
import { FAKE_VIDEO_ID, startFakeVideoSite } from './fixtures/fake-video'

const askbox = (page: Page) => page.getByRole('toolbar', { name: '选中的这句' })
const sideIn = (scope: Locator) => scope.getByRole('region', { name: '旁支' })
const box = async (l: Locator) => (await l.boundingBox())!

async function selectText(page: Page, scope: Locator, from: string, to: string) {
  const pts = await scope.evaluate(
    (root, [a, b]) => {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let s: [Node, number] | null = null
      let e: [Node, number] | null = null
      while (w.nextNode()) {
        const n = w.currentNode as Text
        if (!s && n.data.includes(a!)) s = [n, n.data.indexOf(a!)]
        if (s && n.data.includes(b!, s[0] === n ? s[1] : 0)) {
          e = [n, n.data.indexOf(b!, s[0] === n ? s[1] : 0) + b!.length]
          break
        }
      }
      const r = document.createRange()
      r.setStart(s![0], s![1])
      r.setEnd(e![0], e![1])
      const rs = r.getClientRects()
      const f = rs[0]!
      const l = rs[rs.length - 1]!
      return [f.left + 1, f.top + f.height / 2, l.right - 1, l.top + l.height / 2]
    },
    [from, to],
  )
  await page.mouse.move(pts[0]!, pts[1]!)
  await page.mouse.down()
  await page.mouse.move(pts[2]!, pts[3]!, { steps: 8 })
  await page.mouse.up()
}

let server: Server
let base: string
test.beforeAll(async () => {
  ;({ server, base } = await startFakeVideoSite())
})
test.afterAll(() => server.close())

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const strip = (page: Page) => web(page).getByRole('region', { name: '视频条' })
const askCard = (page: Page) => web(page).getByRole('dialog', { name: '问 AI' })
const NOTE = '看视频的笔记.md'
const guest = (page: Page, code: string): Promise<unknown> =>
  page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code)

/**
 * 旁支的输入框整个在问框里、真点得到：盒子在问框里，四个角和中间按 elementFromPoint 找到的都是这个输入框（没被别的盖住、没被滚出去），
 * 而且它不在会滚的回答区里（钉在底部）
 */
async function inputReachable(ask: Locator, input: Locator) {
  const a = await box(ask)
  const b = await box(input)
  expect(b.y).toBeGreaterThanOrEqual(a.y)
  expect(b.y + b.height).toBeLessThanOrEqual(a.y + a.height)
  const hit = await input.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const pts = [
      [r.left + r.width / 2, r.top + r.height / 2],
      [r.left + 4, r.top + 4],
      [r.right - 4, r.bottom - 4],
    ]
    return pts.every(([x, y]) => {
      const at = document.elementFromPoint(x!, y!)
      return !!at && (at === el || el.contains(at) || at.contains(el))
    })
  })
  expect(hit).toBe(true)
  expect(await input.evaluate((el) => !!el.closest('[role="log"]'))).toBe(false)
}

test('问框里开旁支：旁支的输入框和「记到哪」钉在问框底部（主输入框那一行的位置），旁支问多长、回答区滚到顶，输入框都在问框里点得到；收起旁支主输入框回来', async () => {
  test.setTimeout(150_000)
  const run = await launch({ [NOTE]: '# 看视频的笔记\n\n我先写的一句。\n' }, { CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '60', CN_AI_FAKE_ASK_MS: '300', CN_VIDEO_TEST_ORIGIN: base })
  const { page, vault } = run
  // 视频问框的问答写进「记到哪」那篇本身（AI 对话记笔记开关）
  const md = () => (existsSync(join(vault, NOTE)) ? readFileSync(join(vault, NOTE), 'utf8') : '')
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await openNote(page, '看视频的笔记')
    await pane(page).getByText('我先写的一句。').click()
    await page.keyboard.press('End')
    await rail(page).getByRole('button', { name: '网页', exact: true }).click()
    const addr = web(page).getByRole('textbox', { name: '网址' })
    await addr.fill(`${base}/watch?v=${FAKE_VIDEO_ID}`)
    await addr.press('Enter')
    await expect(strip(page)).toBeVisible({ timeout: 15_000 })
    await guest(page, `(() => { const v = document.querySelector('video'); v.currentTime = 6; v.pause(); return true })()`)
    await page.waitForTimeout(400)
    await pane(page).getByText('我先写的一句。').click()
    await page.keyboard.press('Alt+KeyD')
    await expect.poll(() => guest(page, `!!document.getElementById('cn-video-host').shadowRoot.querySelector('.box')`)).toBe(true)
    const wv = await box(web(page).locator('webview.on'))
    await page.mouse.move(wv.x + 40, wv.y + 30)
    await page.mouse.down()
    await page.mouse.move(wv.x + 200, wv.y + 120, { steps: 6 })
    await page.mouse.up()
    const ask = askCard(page)
    await expect(ask).toBeVisible()
    await ask.getByRole('textbox', { name: '想问什么' }).press('Enter')
    const ans = ask.getByTestId('ak-answer').first()
    await expect(ans).toContainText('任何向量都是它俩的组合', { timeout: 15_000 })
    await expect(ask.getByRole('button', { name: /已记进《看视频的笔记》/ })).toBeVisible()
    await waitSaved(page)
    const askTop = (await box(ask)).y

    // 回答里选一句开旁支
    await selectText(page, ans, '任何向量', '的组合，')
    await expect(askbox(page)).toBeVisible()
    await askbox(page).getByRole('button', { name: '问这句' }).click()
    // 「问这句」直接开旁支，光标在旁支的输入框里，问题在那里打（r129 小条上不再常驻问题那一格）
    await page.keyboard.insertText('为什么是组合？')
    await page.keyboard.press('Enter')
    const s = sideIn(ask)
    await expect(s).toBeVisible()
    await expect(s.getByTestId('side-msg').last()).toContainText('旁支的回答', { timeout: 15_000 })

    // 接着问两句，旁支越来越长：输入框一直在问框里点得到，光标在里面（以前它在旁支那一块里，旁支一长就落到问框下沿外面）
    const sin = ask.locator('textarea[placeholder="接着问这条旁支…"]')
    await expect(sin).toHaveCount(1)
    await expect(s.locator('.acts')).toBeVisible({ timeout: 15_000 })
    for (const q of ['那三维呢？', '换个说法讲一遍？']) {
      await sin.fill(q)
      await sin.press('Enter')
      await expect(s.locator('.sq').last()).toHaveText(q)
      await expect(s.locator('.acts')).toBeVisible({ timeout: 15_000 })
      await inputReachable(ask, sin)
      await expect(sin).toBeFocused()
    }
    // 用户回头看问的那一帧和第一问（回答区滚到顶）：输入框照样在底部
    await ask.getByRole('log', { name: '回答' }).evaluate((el) => (el.scrollTop = 0))
    await inputReachable(ask, sin)

    // 旁支的输入框、记到哪：钉在问框底部（不在旁支那一块里、不在会滚的回答区里）；主输入框那一行让给它（缩成的一行灰字也没有）
    const dock = ask.getByTestId('ak-side-dock')
    await expect(dock).toBeVisible()
    await expect(dock.getByRole('textbox')).toHaveAttribute('placeholder', '接着问这条旁支…')
    await expect(s.getByRole('textbox')).toHaveCount(0)
    await expect(dock.locator('.rec')).toHaveText('写在《看视频的笔记》里，挂在这段回答下面')
    await expect(ask.getByRole('textbox', { name: '想问什么' })).toHaveCount(0)
    await expect(ask.getByTestId('ai-input-slim')).toHaveCount(0)
    await inputReachable(ask, sin)
    // 顺序：输入框、记到哪、底栏「已记进《…》」；上面一条 1px 细线和问答分开；输入框左右离问框边 10
    const a = await box(ask)
    const ib = await box(dock.locator('.aiin'))
    const rb = await box(dock.locator('.rec'))
    const fb = await box(ask.locator('.ak-foot'))
    expect(rb.y).toBeGreaterThan(ib.y + ib.height)
    expect(fb.y).toBeGreaterThanOrEqual(rb.y + rb.height - 1)
    expect(Math.round(ib.x - a.x)).toBe(10)
    expect(Math.round(a.x + a.width - (ib.x + ib.width))).toBe(10)
    expect(await dock.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe('1px')
    // 问框不往上长（上沿还在视频下沿下面 10 的老地方），不挡视频
    expect(Math.round((await box(ask)).y)).toBe(Math.round(askTop))

    // 真点一下输入框、打字回车：还是这条旁支接着问
    await sin.click()
    await page.keyboard.type('最后一问')
    await page.keyboard.press('Enter')
    await expect(s.locator('.sq').last()).toHaveText('最后一问')
    await expect(s.locator('.acts')).toBeVisible({ timeout: 15_000 })
    // 旁支的问答记进那篇、挂在这一问后面。问框旁支现在还是 doc-side 的 `> [!side]` 写法（没换成「#### 旁支：…」，另记待办），这里只核记进去了、记在哪
    await expect.poll(md, { timeout: 15_000 }).toMatch(/\n### 讲解这一块\n[\s\S]*\n> \[!ai\] AI 回答 · [\s\S]*最后一问\n[\s\S]*问的是「最后一问」/)
    expect(md()).not.toContain('AI 笔记')

    // 收起旁支：钉着的那一行不见了，主输入框回来、光标在里面
    await s.getByRole('button', { name: '收起旁支' }).first().click()
    await expect(s).toHaveCount(0)
    await expect(dock).toHaveCount(0)
    const input = ask.getByRole('textbox', { name: '想问什么' })
    await expect(input).toBeVisible()
    // 再开旁支（小标），点旁支的收起（task-eavzx 拿掉了回答下面的「接着问」）：旁支收起、光标回问框
    await ans.locator('.badge').click()
    await expect(s).toBeVisible()
    await expect(dock.getByRole('textbox')).toBeFocused()
    await s.getByRole('button', { name: '收起旁支' }).first().click()
    await expect(s).toHaveCount(0)
    await expect(input).toBeFocused()
  } finally {
    await run.close()
  }
})
