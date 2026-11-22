// 重开软件后网页里的视频不自己播（task-0t4jq）：用户关了软件再开，右栏记住的网页标签里的视频一律停着、不出声；
// 后台标签点进去才载入，载入了也停着；用户自己点播放、软件的 ⌥K 照常能播；「记下这一刻」照常记。新开的网页照旧（会自己播的照样播）。
// 视频站是本机假的（当成 YouTube：CN_VIDEO_TEST_ORIGIN），视频带声音，页面像 YouTube 一样一打开就 play()，过一会儿再 play() 一次，
// 另有一个静音自动播的小视频（静音的浏览器本来不拦）。
// 真 YouTube 那条：CN_REAL_VIDEO=1 才跑，要上网，不登录。
import { expect, test, type Page } from '@playwright/test'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { dirname, join } from 'node:path'
import { launch, openNote, rail, type Running } from './app'

// 测试的声音不放出来（不吵用户）。静音开关下 isCurrentlyAudible 量不到，「出声」按网页里有没有不静音、音量不为零、正在播的视频算
process.env.CN_E2E_ARGS = [process.env.CN_E2E_ARGS, '--mute-audio'].filter(Boolean).join(' ')

let server: Server
let base: string
const VIDEO = readFileSync(join(__dirname, 'fixtures/video-sound.webm'))

function watchPage(id: string): string {
  const pr = { videoDetails: { videoId: id, title: `Autoplay ${id}`, author: 'Test', lengthSeconds: '30' }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [] } } }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Autoplay ${id} - YouTube</title>
  <style>body{margin:0;font:14px sans-serif}#movie_player{position:relative;width:100%;aspect-ratio:16/9;background:#000}video#v{width:100%;height:100%;display:block}
  #play{display:block;margin:12px 16px;width:160px;height:40px;font-size:16px}#bg{width:64px;height:36px}</style></head>
  <body><div id="movie_player" class="html5-video-player"><video id="v" src="/sound.webm" autoplay playsinline></video></div>
  <button id="play">▶ 播放</button>
  <p><a id="next" href="/watch?v=${id}x">下一个视频</a></p>
  <video id="bg" src="/sound.webm" autoplay muted loop playsinline></video>
  <script>
    window.ytInitialPlayerResponse = ${JSON.stringify(pr)}
    const mp = document.getElementById('movie_player')
    mp.getPlayerResponse = () => window.ytInitialPlayerResponse
    mp.loadModule = () => {}
    mp.setOption = () => {}
    const v = document.getElementById('v')
    window.playErrors = []
    const tryPlay = () => v.play().catch((e) => window.playErrors.push(e.name))
    // 和 YouTube 一样：播放器起来就播，过一会儿（广告、清晰度切换后）再播一次
    addEventListener('load', tryPlay)
    setTimeout(tryPlay, 1500)
    document.getElementById('play').addEventListener('click', () => v.play())
  </script></body></html>`
}

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x')
    if (u.pathname === '/watch') {
      res.setHeader('content-type', 'text/html; charset=utf-8')
      return res.end(watchPage(u.searchParams.get('v') ?? 'none'))
    }
    if (u.pathname === '/sound.webm') {
      const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '')
      if (range) {
        const start = Number(range[1])
        const end = range[2] ? Number(range[2]) : VIDEO.length - 1
        res.writeHead(206, { 'content-type': 'video/webm', 'content-range': `bytes ${start}-${end}/${VIDEO.length}`, 'accept-ranges': 'bytes', 'content-length': end - start + 1 })
        return res.end(VIDEO.subarray(start, end + 1))
      }
      res.writeHead(200, { 'content-type': 'video/webm', 'accept-ranges': 'bytes', 'content-length': VIDEO.length })
      return res.end(VIDEO)
    }
    res.statusCode = 404
    res.end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
test.afterAll(() => server.close())

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const webTabs = (page: Page) => web(page).getByRole('tablist', { name: '网页标签' }).getByRole('tab')
const strip = (page: Page) => web(page).getByRole('region', { name: '视频条' })
const A = () => `${base}/watch?v=autoplayAA`
const B = () => `${base}/watch?v=autoplayBB`

/** 软件里所有网页（webview）的视频：网址 → 每个 <video> 停没停、播到哪；还有这个网页出不出声（有没有不静音、正在播的视频） */
async function videos(run: Running): Promise<{ url: string; paused: boolean[]; t: number[]; audible: boolean }[]> {
  return run.app.evaluate(async ({ webContents }) => {
    const out: { url: string; paused: boolean[]; t: number[]; audible: boolean }[] = []
    for (const wc of webContents.getAllWebContents()) {
      if (wc.getType() !== 'webview' || wc.isDestroyed() || !/^https?:/.test(wc.getURL())) continue
      const r = (await wc.executeJavaScript(`[...document.querySelectorAll('video')].map((v) => [v.paused, v.currentTime, !v.paused && !v.muted && v.volume > 0])`).catch(() => [])) as [boolean, number, boolean][]
      out.push({ url: wc.getURL(), paused: r.map((x) => x[0]), t: r.map((x) => x[1]), audible: r.some((x) => x[2]) })
    }
    return out
  })
}

const pageOf = async (run: Running, url: string) => (await videos(run)).find((v) => v.url === url)

/** 在当前网页里点一个元素（真的鼠标点在窗口上，经过 webview 落到网页里） */
async function clickInPage(page: Page, selector: string) {
  const view = (await page.locator('.right.web webview.on').boundingBox())!
  const r = (await page.evaluate(
    (s) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(`(() => { const b = document.querySelector(${JSON.stringify(s)}).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 } })()`),
    selector,
  )) as { x: number; y: number }
  await page.mouse.click(view.x + r.x, view.y + r.y)
}

/** 右栏换到网页：重开后它可能已经开着（上次开着），开着就不再点（再点是收起） */
async function showWeb(page: Page) {
  await page.waitForTimeout(500)
  if (!(await web(page).isVisible())) await rail(page).getByRole('button', { name: '网页' }).click()
  await expect(web(page)).toBeVisible()
}

async function goTo(page: Page, u: string) {
  const addr = web(page).getByRole('textbox', { name: '网址' })
  await addr.fill(u)
  await addr.press('Enter')
}

test('重开软件：记住的网页标签里的视频都停着、不出声；后台标签点进去才载入、也停着；点播放、⌥K 能播，记下这一刻照常记；新开的照旧自己播', async () => {
  test.setTimeout(150_000)
  const env = { CN_VIDEO_TEST_ORIGIN: base, CN_AI_FAKE: '1' }
  let run = await launch({ 'a.md': '# a\n' }, env)
  const keep: string[] = [dirname(run.vault)]
  try {
    // 第一次：右栏开两个视频网页（A 在前，B 新标签里开）
    const { page } = run
    await rail(page).getByRole('button', { name: '网页' }).click()
    await expect(webTabs(page)).not.toHaveCount(0)
    await goTo(page, A())
    await expect(strip(page)).toBeVisible({ timeout: 15_000 })
    await web(page).getByRole('button', { name: '新网页' }).click()
    await goTo(page, B())
    await expect(webTabs(page)).toHaveCount(2)
    await expect(webTabs(page).nth(1)).toHaveAttribute('aria-selected', 'true')
    // 用户这一回自己开的网页照旧：会自己播的照样播（不改平常的行为）
    await expect.poll(async () => (await pageOf(run, B()))?.paused[0], { timeout: 15_000 }).toBe(false)

    // 关掉软件，同一份本机设置再开
    const userData = run.userData
    await run.close({ keep: true })
    run = await launch({ 'a.md': '# a\n' }, { ...env, CN_USER_DATA: userData })
    keep.push(dirname(run.vault))
    const p2 = run.page
    await showWeb(p2)
    await expect(webTabs(p2)).toHaveCount(2)
    await expect(webTabs(p2).nth(1)).toHaveAttribute('aria-selected', 'true')
    // 当前标签 B 载入了，页面自己的两次 play() 都过去了（1.5 秒那次）
    await expect.poll(async () => (await pageOf(run, B()))?.paused.length, { timeout: 15_000 }).toBe(2)
    await p2.waitForTimeout(2500)
    const b = (await pageOf(run, B()))!
    expect(b.paused).toEqual([true, true])
    expect(b.audible).toBe(false)
    // 出声的那个是浏览器拦下的（页面自己的 play() 被拒），静音的那个是我们停下的
    expect(await run.app.evaluate(async ({ webContents }, u) => webContents.getAllWebContents().find((w) => w.getURL() === u)!.executeJavaScript('window.playErrors'), B())).toContain('NotAllowedError')
    // 后台标签 A 还没载入（点进去才载）
    expect(await pageOf(run, A())).toBeUndefined()

    // ⌥K（软件的播放 / 暂停）在没点过的恢复标签上也能播
    await expect(strip(p2)).toBeVisible({ timeout: 15_000 })
    await p2.keyboard.press('Alt+KeyK')
    await expect.poll(async () => (await pageOf(run, B()))?.paused[0], { timeout: 10_000 }).toBe(false)
    await p2.keyboard.press('Alt+KeyK')
    await expect.poll(async () => (await pageOf(run, B()))?.paused[0]).toBe(true)

    // 点进后台标签 A：现在才载入，载入了也停着、不出声
    await webTabs(p2).nth(0).getByRole('button').first().click()
    await expect.poll(async () => (await pageOf(run, A()))?.paused.length, { timeout: 15_000 }).toBe(2)
    await p2.waitForTimeout(2500)
    const a = (await pageOf(run, A()))!
    expect(a.paused).toEqual([true, true])
    expect(a.audible).toBe(false)
    expect((await pageOf(run, B()))!.paused).toEqual([true, true])

    // 用户在网页里点播放：播
    await clickInPage(p2, '#play')
    await expect.poll(async () => (await pageOf(run, A()))?.paused[0], { timeout: 10_000 }).toBe(false)
    // 记下这一刻：照常记
    await p2.waitForTimeout(1200)
    await strip(p2).getByRole('button', { name: '记下这一刻' }).click()
    await expect(p2.locator('.vtoast')).toContainText('记了00:0', { timeout: 10_000 })
    expect(readFileSync(join(run.vault, '收件箱/Autoplay autoplayAA.md'), 'utf8')).toContain('<!-- moment video=youtube:autoplayAA t=')
    // 点过以后，在网页里点链接开下一个视频：照常自己播
    await clickInPage(p2, '#next')
    const C = `${A()}x`
    await expect.poll(async () => (await pageOf(run, C))?.paused[0], { timeout: 15_000 }).toBe(false)
  } finally {
    await run.close({ keep: true })
    for (const d of keep) rmSync(d, { recursive: true, force: true, maxRetries: 5 })
  }
})

test('中间栏的宽网页标签：重开软件后也停着，没点开的不载入', async () => {
  test.setTimeout(120_000)
  const env = { CN_VIDEO_TEST_ORIGIN: base, CN_AI_FAKE: '1' }
  let run = await launch({ 'a.md': '# a\n' }, env)
  const keep: string[] = [dirname(run.vault)]
  try {
    const { page } = run
    await rail(page).getByRole('button', { name: '网页' }).click()
    await expect(webTabs(page)).not.toHaveCount(0)
    await goTo(page, A())
    await expect(strip(page)).toBeVisible({ timeout: 15_000 })
    // 网页 ⋯ 里的「在中间开成一页」（task-05p2w 以前是标题栏的「移到中间」）：右栏这页开成中间栏的宽网页标签
    const webAside = page.getByRole('complementary', { name: '网页' })
    await webAside.getByRole('button', { name: '更多' }).click()
    await webAside.getByRole('menu', { name: '更多' }).getByRole('menuitem', { name: /在中间开成一页/ }).click()
    await expect(page.locator('.wpane:not([hidden]) webview')).toBeVisible({ timeout: 15_000 })
    await expect.poll(async () => (await pageOf(run, A()))?.paused[0], { timeout: 15_000 }).toBe(false)
    // 再开一篇笔记：宽网页标签退到后面
    await openNote(page, 'a')
    await expect(page.locator('.wpane:not([hidden])')).toHaveCount(0)

    const userData = run.userData
    // 中间栏的标签是按库记的：同一个库再开
    const vault = run.vault
    await run.close({ keep: true })
    run = await launch({ 'a.md': '# a\n' }, { ...env, CN_USER_DATA: userData, CN_VAULT: vault })
    keep.push(dirname(run.vault))
    const p2 = run.page
    await p2.waitForTimeout(3500)
    // 没点开的宽网页标签不载入
    expect(await pageOf(run, A())).toBeUndefined()
    for (const v of await videos(run)) expect(v.paused, v.url).toEqual(v.paused.map(() => true))
    // 点开它：载入，停着、不出声
    await p2.locator('.center .tabs .tab').filter({ hasText: 'Autoplay autoplayAA' }).click()
    await expect.poll(async () => (await pageOf(run, A()))?.paused.length, { timeout: 15_000 }).toBe(2)
    await p2.waitForTimeout(2500)
    const a = (await pageOf(run, A()))!
    expect(a.paused).toEqual([true, true])
    expect(a.audible).toBe(false)
  } finally {
    await run.close({ keep: true })
    for (const d of keep) rmSync(d, { recursive: true, force: true, maxRetries: 5 })
  }
})

/** 交付用的截图（CN_SHOTS 给了才截）：从主进程截整个窗口，右栏网页也在里面 */
async function shot(run: Running, name: string) {
  const dir = process.env.CN_SHOTS
  if (!dir) return
  await run.page.waitForTimeout(400)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(dir, `${name}.png`), Buffer.from(b64, 'base64'))
}

test.describe('真 YouTube（要上网，不登录）', () => {
  test.skip(process.env.CN_REAL_VIDEO !== '1', '要上网：CN_REAL_VIDEO=1 才跑')
  const YT1 = process.env.CN_REAL_YT || 'https://www.youtube.com/watch?v=kYB8IZa5AuE'
  const YT2 = 'https://www.youtube.com/watch?v=fNk_zzaMoSs'
  /** YouTube 页面上的 <video> 停没停，播放器自己说的状态（1 在播、2 暂停、-1 没开始、5 待播）；这个网页还没载入是 null */
  const ytState = (run: Running, prefix: string) =>
    run.app.evaluate(async ({ webContents }, p) => {
      const wc = webContents.getAllWebContents().find((w) => w.getType() === 'webview' && w.getURL().startsWith(p))
      if (!wc) return null
      return (await wc.executeJavaScript(
        `(() => { const v = document.querySelector('#movie_player video') || document.querySelector('video'); const mp = document.getElementById('movie_player'); return { paused: v ? v.paused : null, t: v ? v.currentTime : null, muted: v ? v.muted : null, state: mp && mp.getPlayerState ? mp.getPlayerState() : null } })()`,
      )) as { paused: boolean | null; t: number | null; muted: boolean | null; state: number | null }
    }, prefix)

  /** 欧洲第一次打开有「同意 Cookie」：点「全部拒绝」（临时的测试实例，不是用户的账号） */
  const rejectConsent = (run: Running) =>
    run.app.evaluate(async ({ webContents }) => {
      for (const wc of webContents.getAllWebContents())
        if (wc.getType() === 'webview') await wc.executeJavaScript(`[...document.querySelectorAll('button, [role=button]')].find((b) => /Reject all|Alle ablehnen|全部拒绝/.test(b.textContent))?.click(), true`).catch(() => undefined)
    })

  test('真 YouTube：开着两个视频标签关掉软件再开，视频停着；点进后台那个也停着，⌥K 能播', async () => {
    test.setTimeout(300_000)
    // 网站看到 navigator.webdriver 会不一样：真用户的软件里没有这个标记，测试里也去掉
    process.env.CN_E2E_ARGS = [process.env.CN_E2E_ARGS, '--disable-blink-features=AutomationControlled'].filter(Boolean).join(' ')
    let run = await launch({ 'a.md': '# a\n' }, { CN_AI_FAKE: '1' })
    const keep: string[] = [dirname(run.vault)]
    try {
      const { page } = run
      await rail(page).getByRole('button', { name: '网页' }).click()
      await expect(webTabs(page)).not.toHaveCount(0)
      await goTo(page, YT2)
      await page.waitForTimeout(4000)
      await rejectConsent(run)
      await web(page).getByRole('button', { name: '新网页' }).click()
      await goTo(page, YT1)
      await expect(strip(page)).toBeVisible({ timeout: 60_000 })
      await page.waitForTimeout(3000)
      await rejectConsent(run)
      // 平常（这一回自己开的）YouTube 会自己播
      await expect.poll(async () => (await ytState(run, YT1))?.paused, { timeout: 60_000 }).toBe(false)
      console.log('第一次开（自己开的）：', JSON.stringify(await ytState(run, YT1)))
      await shot(run, 'real-yt-before')

      const userData = run.userData
      await run.close({ keep: true })
      run = await launch({ 'a.md': '# a\n' }, { CN_AI_FAKE: '1', CN_USER_DATA: userData })
      keep.push(dirname(run.vault))
      const p2 = run.page
      await showWeb(p2)
      await expect(webTabs(p2)).toHaveCount(2)
      await expect.poll(async () => (await ytState(run, YT1))?.paused ?? null, { timeout: 60_000 }).not.toBeNull()
      // 等 YouTube 播放器起来、该自己播的时候都过去
      await p2.waitForTimeout(12_000)
      const s1 = (await ytState(run, YT1))!
      console.log('重开后当前标签：', JSON.stringify(s1))
      await shot(run, 'real-yt-after')
      expect(s1.paused).toBe(true)
      expect(await ytState(run, YT2)).toBeNull()
      // 点进后台的那个：载入了也停着
      await webTabs(p2).nth(0).getByRole('button').first().click()
      await expect.poll(async () => (await ytState(run, YT2))?.paused ?? null, { timeout: 60_000 }).not.toBeNull()
      await p2.waitForTimeout(12_000)
      const s2 = (await ytState(run, YT2))!
      console.log('点进后台标签：', JSON.stringify(s2))
      expect(s2.paused).toBe(true)
      await shot(run, 'real-yt-bg-tab')
      // ⌥K 照常能播
      await expect(strip(p2)).toBeVisible({ timeout: 30_000 })
      await p2.keyboard.press('Alt+KeyK')
      await expect.poll(async () => (await ytState(run, YT2))?.paused, { timeout: 30_000 }).toBe(false)
      console.log('⌥K 后：', JSON.stringify(await ytState(run, YT2)))
    } finally {
      await run.close({ keep: true })
      for (const d of keep) rmSync(d, { recursive: true, force: true, maxRetries: 5 })
    }
  })
})
