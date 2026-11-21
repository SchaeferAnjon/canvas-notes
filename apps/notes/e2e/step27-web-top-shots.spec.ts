// 网页栏顶上和问框（task-sta8n）交付用的截图：和原型方向 A 同几个状态（展开、收起、⋯、刚框好、答好），天青 / 深湖，网页栏 600 和 380。
// 只在给了 CN_SHOTS（存图的文件夹）时跑；截的是网页那一组（从主进程截，网页里的视频也在）。视频站、AI 都是假的。
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { dirname, join } from 'node:path'
import { launch, openAi, openNote, pane, rail, type Running, widenRight } from './app'
import { FAKE_VIDEO_ID, startFakeVideoSite } from './fixtures/fake-video'

const DIR = process.env.CN_SHOTS
test.skip(!DIR, '只在 CN_SHOTS 给了时截图')

let video: Server
let pages: Server
let base = ''
let other = ''
test.beforeAll(async () => {
  ;({ server: video, base } = await startFakeVideoSite())
  pages = createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    const t = req.url?.includes('d2l') ? '前言 · 动手学深度学习' : '微信读书'
    res.end(`<title>${t}</title><body style="font:16px sans-serif;padding:20px"><h1>${t}</h1></body>`)
  })
  await new Promise<void>((r) => pages.listen(0, '127.0.0.1', r))
  other = `http://127.0.0.1:${(pages.address() as { port: number }).port}`
})
test.afterAll(() => {
  video.close()
  pages.close()
})

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const strip = (page: Page) => web(page).getByRole('region', { name: '视频条' })

function guest(page: Page, code: string): Promise<unknown> {
  return page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code)
}

async function go(page: Page, url: string) {
  const addr = web(page).getByRole('textbox', { name: '网址' })
  await addr.fill(url)
  await addr.press('Enter')
}

/** 截网页那一组（extra：往右、往下多截一点，菜单伸出去的部分） */
async function shot(run: Running, name: string, extra = { w: 0, h: 0 }) {
  await run.page.mouse.move(5, 890)
  await run.page.waitForTimeout(400)
  const g = (await run.page.locator('.dgrp').filter({ has: run.page.getByTestId('dtab-web') }).boundingBox())!
  const rect = { x: Math.round(g.x), y: Math.round(g.y), width: Math.round(g.width + extra.w), height: Math.round(Math.min(g.height, 820) + extra.h) }
  const b64 = await run.app.evaluate(async ({ BrowserWindow }, r) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage(r)).toPNG().toString('base64'), rect)
  writeFileSync(join(DIR!, `${name}.png`), Buffer.from(b64, 'base64'))
}

for (const skin of ['sky', 'petrol'] as const)
  for (const width of [600, 380])
    test(`截图：${skin} · 网页栏 ${width}`, async () => {
      test.setTimeout(150_000)
      const tone = skin === 'sky' ? 'light' : 'dark'
      const run = await launch({ '注意力机制，一步一步讲清楚.md': '# 注意力机制，一步一步讲清楚\n\n一个词怎么「看」别的词。\n' }, { CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '150', CN_AI_FAKE_ASK_MS: '600', CN_VIDEO_TEST_ORIGIN: base }, (vault) => {
        const ud = join(dirname(vault), 'user-data')
        mkdirSync(ud, { recursive: true })
        writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin, frame: 'b' } }))
      })
      const { page } = run
      try {
        // 书签栏里两个书签（原型 ⋯ › 书签里列着的那两个）
        for (const b of [
          { title: '前言 · 动手学深度学习', url: `${other}/d2l` },
          { title: '微信读书', url: `${other}/weread` },
        ])
          await page.evaluate((x) => window.cnWeb.addBookmark({ ...x, folder: '书签栏' }), b)
        await openNote(page, '注意力机制，一步一步讲清楚')
        await pane(page).getByText('一个词怎么「看」别的词。').click()
        await page.keyboard.press('End')
        // 组头和原型一样：历史 · 网页 · AI
        await rail(page).getByRole('button', { name: '历史', exact: true }).click()
        await openAi(page)
        await rail(page).getByRole('button', { name: '网页', exact: true }).click()
        await page.getByTestId('dtab-web').click()
        await go(page, `${other}/d2l`)
        await web(page).getByRole('button', { name: '新网页' }).click()
        await go(page, `${other}/weread`)
        await web(page).getByRole('button', { name: '新网页' }).click()
        await go(page, `${base}/watch?v=${FAKE_VIDEO_ID}`)
        await expect(strip(page).getByRole('button', { name: '字幕', exact: true })).toContainText('英→中', { timeout: 15_000 })
        if (width !== 380) await widenRight(page, width - 380)
        // 两个时刻
        for (const t of [3, 10]) {
          await guest(page, `(() => { const v = document.querySelector('video'); v.currentTime = ${t}; v.pause(); return true })()`)
          await page.waitForTimeout(350)
          await strip(page).getByRole('button', { name: '记下这一刻' }).click()
          await expect(page.locator('.vtoast')).toContainText('记进了')
        }
        await guest(page, `(() => { const v = document.querySelector('video'); v.currentTime = 6; v.pause(); return true })()`)
        await page.waitForTimeout(400)
        await shot(run, `open-${tone}-${width}`)
        await page.getByTestId('web-fold').click()
        await shot(run, `folded-${tone}-${width}`)
        await page.getByTestId('web-fold').click()
        await web(page).getByRole('button', { name: '更多', exact: true }).click()
        await shot(run, `more-${tone}-${width}`, { w: 0, h: 0 })
        await page.keyboard.press('Escape')
        // 框一块问：画面左上那一块
        await strip(page).getByRole('button', { name: '框一块问' }).click()
        await expect.poll(() => guest(page, `!!document.getElementById('cn-video-host').shadowRoot.querySelector('.box')`)).toBe(true)
        const wv = (await web(page).locator('webview.on').boundingBox())!
        await page.mouse.move(wv.x + wv.width * 0.08, wv.y + wv.width * 0.56 * 0.18)
        await page.mouse.down()
        await page.mouse.move(wv.x + wv.width * 0.6, wv.y + wv.width * 0.56 * 0.45, { steps: 8 })
        await page.mouse.up()
        const ask = web(page).getByRole('dialog', { name: '问 AI' })
        await expect(ask).toBeVisible()
        await expect(ask.getByTestId('ak-sug').getByRole('button')).toHaveCount(4)
        await shot(run, `card-${tone}-${width}`)
        await ask.getByRole('textbox', { name: '想问什么' }).fill('为什么要除以根号 d？')
        await ask.getByRole('textbox', { name: '想问什么' }).press('Enter')
        await expect(ask.getByRole('button', { name: /已记进/ })).toBeVisible({ timeout: 15_000 })
        await shot(run, `answer-${tone}-${width}`)
        // 交回报告开头的「在哪」标注图：整个窗口 + 几处的框
        if (tone === 'light' && width === 600) {
          await page.mouse.move(5, 890)
          await page.waitForTimeout(400)
          const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
          writeFileSync(join(DIR!, 'where.png'), Buffer.from(b64, 'base64'))
          const rects = await page.evaluate(() => {
            const r = (sel: string) => {
              const e = document.querySelector(sel)
              if (!e) return null
              const b = e.getBoundingClientRect()
              return { x: b.x, y: b.y, w: b.width, h: b.height }
            }
            return { fold: r('[data-testid="web-fold"]'), row1: r('[data-testid="web-row1"]'), row2: r('[data-testid="web-row2"]'), ask: r('.ak'), block: r('.pane:not([hidden]) [data-part="问答块"]'), win: { w: innerWidth, h: innerHeight } }
          })
          writeFileSync(join(DIR!, 'where.json'), JSON.stringify(rects))
        }
      } finally {
        await run.close()
      }
    })
