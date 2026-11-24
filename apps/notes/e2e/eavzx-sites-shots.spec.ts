/**
 * 回答下面那排换到各处的截图（task-eavzx B 线）：天青、深湖两套，B 浮岛书桌，都是真点到那个状态再截。
 * 只在给了 CN_SHOTS（目录）时跑；文件名 sites-<处>-<sky|petrol>.png。窗口内容 1440×900。
 */
import { expect, type Locator, type Page, test } from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { launch, openAi, openNote, pane, rail, type Running, tabOn, widenRight } from './app'
import { FILES } from './fixtures/board-select'
import { DREAM2_VAULT, prepareDream2 } from './fixtures/dream2'
import { FAKE_VIDEO_ID, startFakeVideoSite } from './fixtures/fake-video'
import { LECTURE } from './fixtures/pdf'

const DIR = process.env.CN_SHOTS
test.skip(!DIR, '只在截图时跑（CN_SHOTS=目录）')
test.describe.configure({ mode: 'serial' })

const SKINS = (['sky', 'petrol'] as const).filter((s) => !process.env.CN_SHOT_SKIN || process.env.CN_SHOT_SKIN === s)
const PDF = '课程/线性代数/第3讲 线性映射.pdf'

const reading = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })
const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const web = (page: Page) => page.getByRole('complementary', { name: '网页' })

function looked(skin: string, prepare?: (vault: string) => void) {
  return (vault: string) => {
    prepare?.(vault)
    const ud = join(dirname(vault), 'user-data')
    mkdirSync(ud, { recursive: true })
    writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin, frame: 'b', winBg: 'aurora' } }))
  }
}

async function sized(run: Running) {
  await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900))
}

/** 截一块（周围多留 pad）；不给 l 截整个窗口 */
async function shot(page: Page, name: string, l?: Locator | Locator[], pad = 12) {
  await page.waitForTimeout(450)
  const path = join(DIR!, `${name}.png`)
  if (!l) return void (await page.screenshot({ path }))
  const bs = (await Promise.all((Array.isArray(l) ? l : [l]).map((x) => x.boundingBox()))).filter((b): b is NonNullable<typeof b> => !!b)
  const x0 = Math.max(0, Math.min(...bs.map((b) => b.x)) - pad)
  const y0 = Math.max(0, Math.min(...bs.map((b) => b.y)) - pad)
  const vp = page.viewportSize() ?? (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })))
  const x1 = Math.min(vp.width, Math.max(...bs.map((b) => b.x + b.width)) + pad)
  const y1 = Math.min(vp.height, Math.max(...bs.map((b) => b.y + b.height)) + pad)
  await page.screenshot({ path, clip: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } })
}

async function openPdf(page: Page) {
  await page.keyboard.press('Meta+k')
  await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
  await page.locator('.pal-row', { hasText: '第3讲 线性映射' }).first().click()
  await expect(tabOn(page)).toHaveText('第3讲 线性映射.pdf')
  await openAi(page)
  await expect(reading(page).getByTestId('reading-sees')).toContainText('读过全文5页', { timeout: 15_000 })
}

async function askPdf(page: Page, text: string) {
  const box = reading(page).getByRole('textbox', { name: '问 AI' })
  await box.fill(text)
  await box.press('Enter')
  await expect(reading(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(300)
}

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
let vserver: Server
let vbase: string
test.beforeAll(async () => {
  mkdirSync(DIR!, { recursive: true })
  server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end('<!doctype html><html lang="en"><head><title>Rotation matrix</title></head><body style="font:18px/1.6 Georgia,serif;padding:24px;max-width:640px;background:#fff;color:#1b1b1b"><h1>Rotation matrix</h1><p id="p1">In linear algebra, a rotation matrix is a transformation matrix that is used to perform a rotation in Euclidean space.</p></body></html>')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  ;({ server: vserver, base: vbase } = await startFakeVideoSite())
})
test.afterAll(() => {
  server.close()
  vserver.close()
})

for (const skin of SKINS) {
  test(`读 PDF、旁支、出错 · ${skin}`, async () => {
    test.setTimeout(180_000)
    const run = await launch({ [PDF]: LECTURE }, { CN_AI_FAKE: '1' }, looked(skin))
    const { page } = run
    try {
      await sized(run)
      await openPdf(page)
      await askPdf(page, '给我讲解一下这一页')
      const ai = reading(page)
      await page.mouse.move(5, 5)
      await shot(page, `sites-pdf-${skin}`, ai)
      // ⋯ 点开
      const row = ai.getByTestId('reading-msg').last().getByTestId('reading-ans-acts')
      await row.locator('[data-act="more"]').click()
      await shot(page, `sites-pdf-more-${skin}`, [ai, page.locator('.cn-ab-menu')])
      await page.keyboard.press('Escape')
      // 旁支：选一句问这句，答完 ⋯ 点开
      const txt = ai.getByTestId('reading-msg').last().locator('.txt')
      const first = (await txt.innerText()).replace(/\s+/g, '').slice(0, 4)
      await selectText(page, txt, first.slice(0, 2), first.slice(2, 4))
      const askbox = page.getByRole('toolbar', { name: '选中的这句' })
      await expect(askbox).toBeVisible()
      await askbox.getByRole('button', { name: '问这句' }).click()
      // 「问这句」直接开旁支，光标在旁支的输入框里，问题在那里打（r129 小条上不再常驻问题那一格）
      await page.keyboard.insertText('为什么是这样？')
      await page.keyboard.press('Enter')
      const s = ai.getByRole('region', { name: '旁支' })
      await expect(s.getByTestId('side-ans-acts')).toBeVisible({ timeout: 15_000 })
      await page.mouse.move(5, 5)
      await shot(page, `sites-side-${skin}`, ai)
      await s.locator('[data-act="more"]').click()
      await shot(page, `sites-side-more-${skin}`, [ai, page.locator('.cn-ab-menu')])
      await page.keyboard.press('Escape')
      await s.getByRole('button', { name: '收起旁支' }).first().click()
      // 出错那条
      await askPdf(page, '假装被拦：讲讲这页')
      await expect(ai.getByTestId('ai-error')).toBeVisible()
      await shot(page, `sites-error-${skin}`, ai)
    } finally {
      await run.close()
    }
  })

  test(`网页上框着问 · ${skin}`, async () => {
    test.setTimeout(120_000)
    const run = await launch({ 'plain.md': `---\nread-along: ${base}/\n---\n# 随手\n` }, { CN_AI_FAKE: '1', CN_FAKE_NOTE_MS: '50' }, looked(skin))
    const { page } = run
    const guest = (code: string) => page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code)
    try {
      await sized(run)
      await rail(page).getByRole('button', { name: '网页' }).click()
      if (Math.round((await web(page).boundingBox())!.width) < 420) await widenRight(page, 80)
      const addr = web(page).getByRole('textbox', { name: '网址' })
      const u = `${base}/wiki/Rotation_matrix`
      await addr.fill(u)
      await addr.press('Enter')
      await expect.poll(() => guest('document.readyState + "|" + location.href')).toBe(`complete|${u}`)
      const w = (await web(page).locator('webview.on').boundingBox())!
      const r = JSON.parse(String(await guest(`JSON.stringify(document.getElementById('p1').getBoundingClientRect())`))) as { x: number; y: number; width: number; height: number }
      await page.keyboard.down('Meta')
      await page.mouse.move(w.x + r.x - 4, w.y + r.y - 4)
      await page.mouse.down()
      await page.mouse.move(w.x + r.x + r.width / 2, w.y + r.y + r.height / 2, { steps: 5 })
      await page.mouse.move(w.x + r.x + r.width + 4, w.y + r.y + r.height + 4, { steps: 5 })
      await page.mouse.up()
      await page.keyboard.up('Meta')
      const ai = reading(page)
      await ai.getByRole('textbox').press('Enter')
      await expect(ai.getByText('已记进《plain》')).toBeVisible({ timeout: 15_000 })
      await page.mouse.move(5, 5)
      await shot(page, `sites-web-${skin}`, ai)
    } finally {
      await run.close()
    }
  })

  test(`视频问框、文档里视频问答块 · ${skin}`, async () => {
    test.setTimeout(120_000)
    const NOTE = '看视频的笔记.md'
    const run = await launch({ [NOTE]: '# 看视频的笔记\n\n我先写的一句。\n' }, { CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '150', CN_AI_FAKE_ASK_MS: '800', CN_VIDEO_TEST_ORIGIN: vbase }, looked(skin))
    const { page } = run
    const vguest = (code: string) => page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code)
    try {
      await sized(run)
      await openNote(page, '看视频的笔记')
      await rail(page).getByRole('button', { name: '网页', exact: true }).click()
      const addr = web(page).getByRole('textbox', { name: '网址' })
      await addr.fill(`${vbase}/watch?v=${FAKE_VIDEO_ID}`)
      await addr.press('Enter')
      await expect(web(page).getByRole('region', { name: '视频条' })).toBeVisible({ timeout: 15_000 })
      await vguest(`(() => { const v = document.querySelector('video'); v.currentTime = 6; v.pause(); return true })()`)
      await page.waitForTimeout(400)
      await pane(page).getByText('我先写的一句。').click()
      await page.keyboard.press('Alt+KeyD')
      await expect.poll(() => vguest(`!!document.getElementById('cn-video-host').shadowRoot.querySelector('.box')`)).toBe(true)
      const wv = (await web(page).locator('webview.on').boundingBox())!
      await page.mouse.move(wv.x + 40, wv.y + 30)
      await page.mouse.down()
      await page.mouse.move(wv.x + 200, wv.y + 120, { steps: 6 })
      await page.mouse.up()
      const ask = web(page).getByRole('dialog', { name: '问 AI' })
      await expect(ask).toBeVisible()
      await ask.getByRole('textbox', { name: '想问什么' }).press('Enter')
      await expect(ask.getByTestId('ak-ans-acts')).toBeVisible({ timeout: 15_000 })
      await page.mouse.move(5, 5)
      await shot(page, `sites-video-${skin}`, ask)
      await ask.getByTestId('ak-ans-acts').locator('[data-act="more"]').click()
      await expect(page.locator('.cn-ab-menu')).toBeVisible()
      await page.waitForTimeout(300)
      await expect(ask).toBeVisible()
      await shot(page, `sites-video-more-${skin}`, [ask, page.locator('.cn-ab-menu')])
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      const qa = pane(page).locator('[data-part="问答块"]')
      await qa.scrollIntoViewIfNeeded()
      await expect(qa.getByRole('button', { name: '接着问' })).toBeVisible()
      await shot(page, `sites-video-doc-${skin}`, qa)
    } finally {
      await run.close()
    }
  })

  test(`AI整理 · ${skin}`, async () => {
    test.setTimeout(120_000)
    const run = await launch(FILES, { CN_AI_FAKE: '1' }, looked(skin))
    const { page } = run
    try {
      await sized(run)
      await openNote(page, '2.3 线性代数')
      const line = (t: string) => pane(page).locator('.cm-line', { hasText: t }).first()
      await expect(line('按常数缩放')).toBeVisible()
      const a = (await line('矩阵-矩阵乘法 AB').boundingBox())!
      const z = (await line('按常数缩放').boundingBox())!
      await page.mouse.move(a.x - 30, a.y + 6)
      await page.mouse.down()
      await page.mouse.move(a.x - 28, a.y + 40, { steps: 4 })
      await page.mouse.move(a.x - 26, z.y + 10, { steps: 10 })
      await page.mouse.up()
      await page.getByTestId('doc-selbar').getByRole('button', { name: 'AI整理' }).click()
      await expect(chat(page).getByTestId('ai-change-bar')).toBeVisible({ timeout: 20_000 })
      await page.mouse.move(5, 5)
      await shot(page, `sites-tidy-${skin}`)
      await chat(page).getByTestId('ai-change-bar').locator('[data-act="accept"]').click()
      await expect(chat(page).getByTestId('ai-change').locator('[data-act="undo"]')).toBeVisible({ timeout: 15_000 })
      await shot(page, `sites-tidy-taken-${skin}`, chat(page).getByTestId('ai-msg').last())
    } finally {
      await run.close()
    }
  })

  test(`梦游 · ${skin}`, async () => {
    test.setTimeout(180_000)
    const run = await launch(DREAM2_VAULT, { CN_AI_FAKE: '1' }, looked(skin, prepareDream2))
    const { page } = run
    try {
      await sized(run)
      const card = page.getByTestId('dream-card')
      await card.getByRole('button', { name: '现在梦游' }).click()
      await expect(card.locator('h3')).toContainText('等你过目', { timeout: 60_000 })
      await card.getByRole('button', { name: '看报告' }).click()
      const panel = page.getByRole('complementary', { name: '梦游报告' })
      await panel.getByTestId('dream-item').filter({ hasText: '原名「冰洞」' }).click()
      await expect(panel.getByTestId('dream-panel-bar')).toBeVisible()
      await page.mouse.move(700, 600)
      await shot(page, `sites-dream-${skin}`)
    } finally {
      await run.close()
    }
  })

  test(`日历帮我排 · ${skin}`, async () => {
    test.setTimeout(120_000)
    const pad = (n: number) => String(n).padStart(2, '0')
    const day = (n: number) => {
      const d = new Date()
      d.setDate(d.getDate() + n)
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    }
    const dir = mkdtempSync(join(tmpdir(), 'cn-cal-'))
    const memFile = join(dir, 'cal-mem.json')
    writeFileSync(memFile, JSON.stringify({ auth: 'full', calAuth: 'full', lists: [{ id: 'L-ct', title: '画布今日', icloud: true, color: '#F0883E' }], calendars: [{ id: 'C-work', title: '工作', color: '#4F7CAC', source: 'iCloud' }], events: [{ id: 'ev-2', title: '组会', calendar: 'C-work', allDay: false, start: `${day(1)}T09:30`, end: `${day(1)}T10:30` }] }))
    const HELPER = join(__dirname, '../../today/native/reminders/.build/apple/Products/Release/canvas-today-reminders')
    let run: Running | null = null
    try {
      run = await launch({ '写作/小论文计划.md': `# 小论文计划\n\n- [ ] 交论文初稿 📅 ${day(1)} 15:00\n- [ ] 补实验图 📅 ${day(1)}\n`, '收件箱/待办.md': `# 待办\n\n- [ ] 取快递 📅 ${day(0)}\n` }, { CN_CAL_HELPER: HELPER, CN_CAL_MEMORY: memFile, CN_AI_FAKE: '1', CT_AI_FAKE_MS: '300' }, looked(skin))
      const { page } = run
      await sized(run)
      await page.getByRole('navigation', { name: '左栏' }).getByRole('button', { name: '日历', exact: true }).click()
      const calp = page.locator('.pane.calp:not([hidden])')
      await calp.getByRole('button', { name: '帮我排进空着的时间' }).click()
      await expect(calp.getByTestId('cal-change-bar')).toBeVisible({ timeout: 15_000 })
      await page.mouse.move(5, 5)
      await shot(page, `sites-calendar-${skin}`)
    } finally {
      await run?.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
}
