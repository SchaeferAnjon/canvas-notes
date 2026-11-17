// 真网站 + 真登录 + 真 Soniox（CN-69，2026-11-17 用户授权用他 Chrome 里的登录），只在 CN_REAL_VIDEO=1 时跑，只读：
//   CN_REAL_VIDEO=1 npx playwright test e2e/real-stt.spec.ts
// 1. 用软件的「导入 Chrome 登录」把 Chrome 的登录导进这个测试实例的临时设置目录（macOS 可能问一次钥匙串；CN_REAL_CHROME_PROFILE 指定 Chrome 用户）；
// 2. B 站一个没字幕的公开短视频（2 分钟上下，CN_REAL_BILI_NOSUB 能换）：「生成字幕」走完 yt-dlp（带右栏的 B 站登录写成的 cookies.txt）→ Soniox → 双语；
// 3. YouTube 一个有字幕的视频：字幕照常读到，记下这一刻正常。
// 不点赞、不评论、不关注、不改账号任何东西；cookie 不打印、不截图、不进仓库。临时库和设置目录测完就删，临时 cookies.txt 生成完当场删（下面核对）。
// 翻译用假的（CN_AI_FAKE），不花 AI 额度；听写用环境变量 SONIOX_API_KEY（一段 1 分钟约 $0.002）。
import { expect, test, type Page } from '@playwright/test'
import { copyFileSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, rail } from './app'

test.skip(process.env.CN_REAL_VIDEO !== '1', '要上网、真登录、真听写：CN_REAL_VIDEO=1 才跑')
test.setTimeout(420_000)
// 网站看到 navigator.webdriver 就不给字幕：真用户的软件里没有这个标记，测试里也去掉
process.env.CN_E2E_ARGS = '--disable-blink-features=AutomationControlled'

// 默认：2 分 19 秒的绘画视频，配的英文歌，登录后也没字幕（2026-11-17；热门里有人说话的短视频登录后都带 B 站 AI 字幕）
const BILI = process.env.CN_REAL_BILI_NOSUB || 'https://www.bilibili.com/video/BV13QsH65EtG'
const YT = process.env.CN_REAL_YT || 'https://www.youtube.com/watch?v=kYB8IZa5AuE'

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const strip = (page: Page) => web(page).getByRole('region', { name: '视频条' })
const subsBtn = (page: Page) => strip(page).getByRole('button', { name: '字幕', exact: true })
const guest = (page: Page, code: string) => page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code)
const sttDirs = () => readdirSync(tmpdir()).filter((d) => d.startsWith('cn-stt-'))

async function open(page: Page, url: string) {
  if (!(await web(page).isVisible())) await rail(page).getByRole('button', { name: '网页' }).click()
  const addr = web(page).getByRole('textbox', { name: '网址' })
  await addr.fill(url)
  await addr.press('Enter')
  await expect(strip(page)).toBeVisible({ timeout: 60_000 })
}

test('真登录：B 站没字幕的短视频生成字幕（yt-dlp 带登录 → Soniox → 双语）', async () => {
  const log = join(tmpdir(), `cn-real-stt-${Date.now()}.log`)
  const before = new Set(sttDirs())
  const run = await launch({ '看视频.md': '# 看视频\n\n' }, { CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '20', CN_REAL_STT: '1', CN_VIDEO_LOG: log })
  const { page, vault } = run
  try {
    // ---- 导入 Chrome 登录（cookie 只进这个临时实例的 persist:web）：用登着 B 站的那个 Chrome 用户（CN_REAL_CHROME_PROFILE 能指定）----
    const biliLogin = () =>
      run.app.evaluate(async ({ session }) => {
        const r = await session.fromPartition('persist:web').fetch('https://api.bilibili.com/x/web-interface/nav')
        return !!((await r.json()) as { data?: { isLogin?: boolean } }).data?.isLogin
      })
    const profiles = await page.evaluate(() => window.cn.chromeProfiles())
    const want = process.env.CN_REAL_CHROME_PROFILE
    const order = want ? profiles.filter((p) => p.id === want || p.name === want) : profiles
    expect(order.length, '这台电脑上没找到 Chrome 用户').toBeGreaterThan(0)
    let used = ''
    for (const p of order) {
      const r = await page.evaluate((id) => window.cn.importChrome(id), p.id)
      if (r.imported > 0 && (await biliLogin())) {
        used = p.name
        break
      }
      // 这个 Chrome 用户没登 B 站：清掉再试下一个
      await run.app.evaluate(({ session }) => session.fromPartition('persist:web').clearStorageData({ storages: ['cookies'] }))
    }
    if (!used) {
      // 没有哪个 Chrome 用户登着 B 站：用第一个用户的 cookie（没登录）接着走，yt-dlp 照样带着写好的 cookies.txt
      await page.evaluate((id) => window.cn.importChrome(id), order[0]!.id)
      console.log(`Chrome 里 ${order.length} 个用户都没登着 B 站：用「${order[0]!.name}」的 cookie（没登录）接着走`)
    } else console.log(`导入了 Chrome 用户「${used}」的登录（B 站已登录）`)

    // ---- B 站：没字幕 → 生成字幕 ----
    await open(page, BILI)
    await expect(subsBtn(page)).not.toContainText('读取中', { timeout: 60_000 })
    const first = (await subsBtn(page).textContent()) ?? ''
    console.log('B 站字幕开关：', first)
    expect(first, `这个视频登录后有字幕（${first}），换一个没字幕的：CN_REAL_BILI_NOSUB=<网址>`).toMatch(used ? /没有字幕/ : /没有字幕|字幕要登录B站/)
    await subsBtn(page).click()
    const menu = web(page).getByRole('dialog', { name: '字幕' })
    const box = menu.getByTestId('stt-box')
    await expect(box.getByRole('button', { name: '生成字幕' })).toBeEnabled()
    await box.getByRole('button', { name: '生成字幕' }).click()
    await expect(subsBtn(page)).toContainText(/生成字幕[123]\/3/)
    const t0 = Date.now()
    const track = menu.getByRole('radiogroup', { name: '原文用哪条字幕' }).getByRole('radio', { name: /（听写 · Soniox）/ })
    // 没生成成就当场报菜单里写的原因（不干等：B 站两分钟后会自动连播下一个视频，原因就看不到了）
    const failed = box.getByText('字幕没生成成')
    await expect(track.or(failed)).toBeVisible({ timeout: 300_000 })
    if (await failed.isVisible()) throw new Error(`生成字幕失败：${await box.locator('p').first().textContent()}`)
    await expect(track).toHaveAttribute('aria-checked', 'true')
    console.log(`生成字幕用了 ${Math.round((Date.now() - t0) / 1000)} 秒：`, await track.textContent(), '·', await subsBtn(page).textContent())
    await expect(box).toHaveCount(0)
    await page.keyboard.press('Escape')
    // 画面上双语：停在听写出来的第二句中间（第一句常在片头）
    const cue = /(\d\d):(\d\d):(\d\d)\.(\d{3}) --> (\d\d):(\d\d):(\d\d)\.(\d{3})/g
    const vttText = readFileSync(join(vault, '.canvas-notes/字幕', readdirSync(join(vault, '.canvas-notes/字幕')).find((f) => f.startsWith('bilibili-'))!), 'utf8')
    const times = [...vttText.matchAll(cue)].map((m) => [(+m[1]! * 60 + +m[2]!) * 60 + +m[3]! + +m[4]! / 1000, (+m[5]! * 60 + +m[6]!) * 60 + +m[7]! + +m[8]! / 1000])
    const [a, b] = times[Math.min(1, times.length - 1)]!
    await guest(page, `(() => { const v = document.querySelector('video'); v.muted = true; v.pause(); v.currentTime = ${(a! + b!) / 2}; return true })()`)
    const subsText = () => guest(page, `document.getElementById('cn-video-host')?.shadowRoot?.querySelector('.subs')?.textContent ?? ''`)
    await expect.poll(subsText, { timeout: 30_000 }).toContain('译文：')
    console.log('B 站画面上：', await subsText())
    // 只截视频那一块（网页顶上有登录的头像，不截）
    const r = (await guest(
      page,
      `(() => { const v = document.querySelector('video'); v.scrollIntoView({ block: 'center' }); const b = v.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height } })()`,
    )) as { x: number; y: number; width: number; height: number }
    const shot = test.info().outputPath('bili-bilingual.png')
    const png = await run.app.evaluate(async ({ webContents }, b) => {
      const wc = webContents.getAllWebContents().find((w) => w.getType() === 'webview' && /bilibili\.com\/video/.test(w.getURL()))!
      return (await wc.capturePage({ x: Math.round(b.x), y: Math.round(Math.max(0, b.y)), width: Math.round(b.width), height: Math.round(b.height) })).toPNG().toString('base64')
    }, r)
    writeFileSync(shot, Buffer.from(png, 'base64'))
    console.log('双语截图：', shot)
    // 字幕进库、一次提交；yt-dlp 用了右栏的 B 站登录；临时目录（音频、cookies.txt）当场删了
    const vtt = readdirSync(join(vault, '.canvas-notes/字幕')).find((f) => f.startsWith('bilibili-'))
    expect(vtt).toBeTruthy()
    console.log('字幕文件：', vtt, readFileSync(join(vault, '.canvas-notes/字幕', vtt!), 'utf8').split('\n').slice(0, 7).join(' | '))
    // 登着 B 站时 yt-dlp 带着写好的 cookies.txt；没登录就不带
    if (used) expect(readFileSync(log, 'utf8')).toMatch(/stt cookies\.txt：B 站 \d+ 条/)
    else expect(existsSync(log) ? readFileSync(log, 'utf8') : '').not.toMatch(/stt cookies\.txt/)
    expect(sttDirs().filter((d) => !before.has(d))).toEqual([])

  } finally {
    await run.close()
    // 没过：日志留在测试结果目录里排查（只有步骤，不记 cookie、密钥）
    if (test.info().status !== test.info().expectedStatus && existsSync(log)) {
      copyFileSync(log, test.info().outputPath('video.log'))
      console.log('日志：', test.info().outputPath('video.log'))
    }
    rmSync(log, { force: true })
  }
  // 临时设置目录（导入的 cookie 在里面）和临时库都删了
  expect(existsSync(run.userData)).toBe(false)
})

test('真登录：YouTube 有字幕的视频照常读到字幕、记下这一刻', async () => {
  const run = await launch({ '看视频.md': '# 看视频\n\n' }, { CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '20' })
  const { page, vault } = run
  try {
    const profiles = await page.evaluate(() => window.cn.chromeProfiles())
    const want = process.env.CN_REAL_CHROME_PROFILE
    const profile = profiles.find((p) => p.id === want || p.name === want) ?? profiles[0]
    expect(profile, '这台电脑上没找到 Chrome 用户').toBeTruthy()
    const r = await page.evaluate((id) => window.cn.importChrome(id), profile!.id)
    expect(r.imported).toBeGreaterThan(0)
    const yt = await run.app.evaluate(async ({ session }) => (await session.fromPartition('persist:web').cookies.get({ domain: 'youtube.com' })).some((c) => c.name === 'SAPISID' || c.name === '__Secure-3PSID'))
    console.log(`导入了 Chrome 用户「${profile!.name}」的登录：YouTube ${yt ? '登着' : '没登'}`)
    // ---- YouTube：有字幕的照常读到，记下这一刻 ----
    await open(page, YT)
    await page.waitForTimeout(3000)
    if (await guest(page, `!!document.querySelector('form[action*="consent"], ytd-consent-bump-v2-lightbox, .eom-buttons')`))
      await guest(page, `[...document.querySelectorAll('button, [role=button]')].find((b) => /Reject all|Alle ablehnen|全部拒绝/.test(b.textContent))?.click(), true`)
    await expect(subsBtn(page)).toContainText('→中', { timeout: 150_000 })
    console.log('YouTube 字幕开关：', await subsBtn(page).textContent())
    await guest(page, `(() => { const v = document.querySelector('video'); v.muted = true; v.currentTime = 222; v.play(); return true })()`)
    await expect.poll(() => guest(page, `document.querySelector('video').currentTime > 224`), { timeout: 60_000 }).toBe(true)
    await strip(page).getByRole('button', { name: '记下这一刻' }).click()
    await expect(page.locator('.vtoast')).toContainText(/记进了|新建了/, { timeout: 30_000 })
    const dir = join(vault, '附件/视频/youtube-kYB8IZa5AuE')
    expect(existsSync(dir) && readdirSync(dir).some((f) => /^0\d-\d\d\.jpg$/.test(f))).toBe(true)
    console.log('YouTube 记下这一刻：', await page.locator('.vtoast').textContent())
  } finally {
    await run.close()
  }
  expect(existsSync(run.userData)).toBe(false)
})

