/**
 * 梦游和生长图动效（设计页 154 版本 A）的交付截图和录屏：薄荷、深湖两套主题，真软件里真点出来的。
 * CN_SHOTS=<目录> 才跑；录屏是 Chromium 的画面推流（Page.startScreencast）一帧帧存下来，之后用 ffmpeg 拼成 mp4 / gif。窗口不上屏。样本库是编的。
 */
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, leftView, tabOn, type Running } from './app'
import { DREAM2_VAULT, prepareDream2 } from './fixtures/dream2'
import { prepareHistory } from './fixtures/growth-history'

const DIR = process.env.CN_SHOTS
test.skip(!DIR, '交付截图：CN_SHOTS=<目录> 才跑')
test.setTimeout(240_000)

const skinned = (skin: string, then: (vault: string) => void) => (vault: string) => {
  then(vault)
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin, frame: 'b', winBg: 'aurora' } }))
}
async function shot(run: Running, name: string) {
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(DIR!, `${name}.png`), Buffer.from(b64, 'base64'))
}
/** 录屏：画面推流的每一帧存成 jpg（文件名带毫秒），停的时候返回帧数 */
async function record(page: Page, name: string) {
  const dir = join(DIR!, 'frames', name)
  mkdirSync(dir, { recursive: true })
  const cdp = await page.context().newCDPSession(page)
  let n = 0
  const t0 = Date.now()
  cdp.on('Page.screencastFrame', (f: { data: string; sessionId: number }) => {
    writeFileSync(join(dir, `${String(Date.now() - t0).padStart(6, '0')}.jpg`), Buffer.from(f.data, 'base64'))
    n++
    void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
  })
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, everyNthFrame: 1 })
  return async () => {
    await cdp.send('Page.stopScreencast')
    return n
  }
}
/** 录一块（小图那么大）：一张张截窗口那一块（左栏里的小图推流不出帧，截图截得到） */
function recordRect(run: Running, name: string, r: { x: number; y: number; width: number; height: number }) {
  const dir = join(DIR!, 'frames', name)
  mkdirSync(dir, { recursive: true })
  let on = true
  let n = 0
  const t0 = Date.now()
  const rect = { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
  const loop = (async () => {
    while (on) {
      const b64 = await run.app.evaluate(async ({ BrowserWindow }, rect) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage(rect)).toPNG().toString('base64'), rect)
      writeFileSync(join(dir, `${String(Date.now() - t0).padStart(6, '0')}.png`), Buffer.from(b64, 'base64'))
      n++
    }
  })()
  return async () => {
    on = false
    await loop
    return n
  }
}
const size = (run: Running) => run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1280, 800))
// 生长图之外再添几篇连着的（编的旅行笔记），小图里邻居多一点
const extra = (vault: string) => {
  const put = (p: string, t: string) => {
    mkdirSync(dirname(join(vault, p)), { recursive: true })
    writeFileSync(join(vault, p), t)
  }
  put('剪藏/旅行/黑沙滩.md', '# 黑沙滩\n\n在维克镇外，冬天风很大。看完去 [[极光预报]] 里写的那片空地。\n')
  put('剪藏/旅行/蓝湖.md', '# 蓝湖\n\n要提前订票，和 [[黑沙滩]] 一天去不完。\n')
  put('剪藏/旅行/雷克雅未克.md', '# 雷克雅未克\n\n住在老港口附近，去 [[蓝湖]] 和 [[黑沙滩]] 都方便。\n')
  put('写作/冰岛游记.md', '# 冰岛游记\n\n第一晚就看到了极光，见 [[极光预报]]、[[雷克雅未克]]。\n')
}

for (const [skin, label] of [['mint', '薄荷'], ['petrol', '深湖']] as const) {
  test(`梦游前后小图：${label}`, async () => {
    const run = await launch(DREAM2_VAULT, { CN_AI_FAKE: '1' }, skinned(skin, (v) => (prepareDream2(v), extra(v))))
    const { page } = run
    try {
      await size(run)
      const card = page.getByTestId('dream-card')
      await card.getByRole('button', { name: '现在梦游' }).click()
      await expect(card.locator('h3')).toContainText('等你过目', { timeout: 60_000 })
      await card.getByRole('button', { name: '看报告' }).click()
      const panel = page.getByRole('complementary', { name: '梦游报告' })
      const box = panel.getByTestId('dream-replay')
      await expect(box).toBeVisible({ timeout: 20_000 })
      let stop: (() => Promise<number>) | null = null
      if (skin === 'mint') {
        // 录屏：真点「重播」从头放一遍，录小图那一块（上下多带一点）
        await page.waitForTimeout(800)
        await panel.locator(".dlist").evaluate((e) => (e.scrollTop = 0))
        await page.waitForTimeout(200)
        const b = (await box.boundingBox())!
        await panel.getByTestId('dream-replay-again').click()
        stop = recordRect(run, 'dream', { x: b.x - 8, y: b.y - 8, width: b.width + 16, height: b.height + 16 })
        await page.mouse.move(700, 500)
      }
      await expect(box).toHaveAttribute('data-phase', 'step0', { timeout: 10_000 })
      await page.waitForTimeout(450)
      // 自己播的时候左栏不滚：小图一直在顶上
      expect(await panel.locator('.dlist').evaluate((e) => e.scrollTop)).toBe(0)
      await shot(run, `dream-step-${skin}`)
      await expect(box).toHaveAttribute('data-phase', 'after', { timeout: 15_000 })
      await page.waitForTimeout(600)
      if (stop) console.log('dream frames', await stop())
      await panel.locator(".dlist").evaluate((e) => (e.scrollTop = 0))
      await page.waitForTimeout(200)
      await shot(run, `dream-end-${skin}`)
    } finally {
      await run.close()
    }
  })

  test(`生长图：${label}`, async () => {
    const run = await launch({}, {}, skinned(skin, prepareHistory))
    const { page } = run
    try {
      await size(run)
      await leftView(page, '梦游报告')
      const stop = skin === 'mint' ? await record(page, 'growth') : null
      await page.getByTestId('dream-seg-growth').click()
      await expect(tabOn(page)).toContainText('生长')
      const canvas = page.getByTestId('growth-canvas')
      await expect(canvas).toHaveAttribute('data-playing', '1', { timeout: 30_000 })
      await page.waitForTimeout(1300)
      await shot(run, `growth-growing-${skin}`)
      await expect(canvas).toHaveAttribute('data-playing', '', { timeout: 15_000 })
      await page.waitForTimeout(900)
      await shot(run, `growth-${skin}`)
      const at = (p: string) => page.evaluate((p) => (window as unknown as { cnGrowthPerf: { at(p: string): { x: number; y: number } | null } }).cnGrowthPerf.at(p), p)
      if (stop) {
        // 录屏里真拖一篇、拖画布、滚轮放大
        const p = (await at('课程/HPDC/第10讲.md'))!
        await page.mouse.move(p.x, p.y)
        await page.mouse.down()
        await page.mouse.move(p.x + 80, p.y - 50, { steps: 20 })
        await page.waitForTimeout(200)
        await page.mouse.up()
        await page.waitForTimeout(1000)
        const s = (await page.locator('.gr-stage').boundingBox())!
        await page.mouse.move(s.x + s.width * 0.7, s.y + s.height * 0.75)
        await page.mouse.down()
        await page.mouse.move(s.x + s.width * 0.6, s.y + s.height * 0.7, { steps: 15 })
        await page.mouse.up()
        for (let i = 0; i < 6; i++) {
          await page.mouse.wheel(0, -80)
          await page.waitForTimeout(60)
        }
        await page.waitForTimeout(500)
        await page.getByRole('button', { name: '看全部' }).click()
        await page.waitForTimeout(500)
      }
      const a = (await at('课程/HPDC/Amdahl定律.md'))!
      await page.mouse.click(a.x, a.y)
      await expect(page.getByTestId('growth-card')).toBeVisible()
      await page.waitForTimeout(900)
      await shot(run, `growth-selected-${skin}`)
      if (stop) {
        await page.mouse.click(a.x + 600, a.y - 200 > 150 ? a.y - 200 : a.y + 200)
        await page.waitForTimeout(900)
        console.log('growth frames', await stop())
      }
    } finally {
      await run.close()
    }
  })
}
