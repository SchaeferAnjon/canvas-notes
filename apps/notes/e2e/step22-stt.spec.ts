// 没字幕的视频生成字幕（录屏 CN-69 / 81，方向 A「菜单里一键」）：字幕菜单里一句话说三步、用时、花费 +「生成字幕」；
// 生成时字幕胶囊「生成字幕 2/3」、菜单里写到了哪一步、能停下；做完是「原文用哪条字幕」里的一条并选上、开始翻、画面上双语；
// 字幕存进库里跟着 Git 走，关掉软件再开同一个视频直接有字幕、不再听写；之前没字幕时记的时刻块补上原文和译文。
// 下载器是假的 yt-dlp（e2e/fixtures/fake-ytdlp.mjs），Soniox 是本机假服务（e2e/fixtures/fake-soniox.ts），翻译是假的（CN_AI_FAKE）。
import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, readFileSync, rmSync } from 'node:fs'
import type { Server } from 'node:http'
import { dirname, join } from 'node:path'
import electronPath from 'electron'
import { gitStatus, launch, openNote, pane, rail } from './app'
import { type FakeSoniox, startFakeSoniox, STT_LINES_EN } from './fixtures/fake-soniox'
import { FAKE_NO_SUBS_ID, startFakeVideoSite } from './fixtures/fake-video'
import { shotPart, shotTone, shotWindow } from './shots'

const FAKE_YTDLP = join(__dirname, 'fixtures/fake-ytdlp.mjs')
let server: Server
let base: string
let soniox: FakeSoniox

test.beforeAll(async () => {
  chmodSync(FAKE_YTDLP, 0o755)
  ;({ server, base } = await startFakeVideoSite())
  soniox = await startFakeSoniox({ english: true })
})
test.afterAll(() => {
  server.close()
  soniox.server.close()
})

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const strip = (page: Page) => web(page).getByRole('region', { name: '视频条' })
const subsBtn = (page: Page) => strip(page).getByRole('button', { name: '字幕', exact: true })
const menu = (page: Page) => web(page).getByRole('dialog', { name: '字幕' })
/** 用本机的假 yt-dlp 和假 Soniox；SONIOX_API_KEY 换成假服务认的那个（开发机上可能有真的，不能用） */
const env = (more: Record<string, string> = {}) => ({ CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '50', CN_VIDEO_TEST_ORIGIN: base, CN_YTDLP: FAKE_YTDLP, CN_SONIOX_BASE: soniox.base, SONIOX_API_KEY: 'test-soniox-key', ...more })

function guest(page: Page, code: string): Promise<unknown> {
  return page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code)
}
async function openVideo(page: Page, id = FAKE_NO_SUBS_ID) {
  if (!(await web(page).isVisible())) await rail(page).getByRole('button', { name: '网页' }).click()
  const addr = web(page).getByRole('textbox', { name: '网址' })
  await addr.fill(`${base}/watch?v=${id}`)
  await addr.press('Enter')
  await expect(strip(page)).toBeVisible({ timeout: 15_000 })
}
async function seek(page: Page, sec: number) {
  await guest(page, `(() => { const v = document.querySelector('video'); v.currentTime = ${sec}; v.pause(); return true })()`)
  await expect.poll(async () => Math.round(Number(await guest(page, 'document.querySelector("video").currentTime')))).toBe(sec)
}
const subsText = (page: Page) =>
  guest(page, `(() => { const r = document.getElementById('cn-video-host')?.shadowRoot; const b = r && (r.querySelector('.subs:not(:empty)') || r.querySelector('.below:not(:empty)')); return b ? [...b.children].map((x) => x.textContent).join('|') : '' })()`)
const read = (vault: string, f: string) => readFileSync(join(vault, f), 'utf8')
const log = (vault: string) => execFileSync('git', ['-C', vault, '-c', 'core.quotepath=false', 'log', '--format=%s', '--name-only'], { encoding: 'utf8' })
const VTT = `.canvas-notes/字幕/youtube-${FAKE_NO_SUBS_ID}.vtt`

test('CN-69 没字幕的视频：菜单里点「生成字幕」→ 下载音频、Soniox 听写、翻译三步 → 多一条「English（听写 · Soniox）」并选上，画面上双语；之前记的时刻块补上原文和译文；关掉再开不再听写', async () => {
  const run = await launch({ '看视频.md': '# 看视频\n\n先记一句。\n' }, env())
  const { page, vault } = run
  try {
    await shotTone(page)
    await openNote(page, '看视频')
    await pane(page).getByText('先记一句。').click()
    await page.keyboard.press('Meta+End')
    await openVideo(page)
    await expect(subsBtn(page)).toContainText('没有字幕', { timeout: 15_000 })
    // 没字幕时先记一刻：块里那句提示
    await seek(page, 4)
    await strip(page).getByRole('button', { name: '记下这一刻' }).click()
    await expect(page.locator('.vtoast')).toContainText('00:04')

    // 菜单：一句话三步 + 用时、花费；没有开发进度那种话（CN-81）
    await subsBtn(page).click()
    const box = menu(page).getByTestId('stt-box')
    await expect(box).toContainText('这个视频没带字幕')
    await expect(box).toContainText('下载音频 → Soniox听写成原文 → 用你设的AI翻成简体中文。0分24秒的视频约1分钟，Soniox不到 ¥0.1。')
    await expect(menu(page)).not.toContainText('这一版还没做')
    await expect(box.getByRole('switch', { name: '以后没字幕的视频打开就自动生成' })).toHaveAttribute('aria-checked', 'false')
    await shotPart(menu(page), 'cn69-menu')
    await box.getByRole('button', { name: '生成字幕' }).click()
    // 生成时：胶囊写到了第几步，菜单里写到了哪一步、能停下
    await expect(subsBtn(page)).toContainText(/生成字幕[123]\/3/)
    await expect(box).toContainText('正在生成')
    await expect(box.getByRole('button', { name: '停下' })).toBeVisible()
    await shotPart(menu(page), 'cn69-running')

    // 做完：多一条并选上，开始翻；画面上双语
    const track = menu(page).getByRole('radiogroup', { name: '原文用哪条字幕' }).getByRole('radio', { name: /English（听写 · Soniox）/ })
    await expect(track).toHaveAttribute('aria-checked', 'true', { timeout: 20_000 })
    await expect(subsBtn(page)).toContainText('字幕 英→中')
    await page.keyboard.press('Escape')
    await seek(page, 4)
    await expect.poll(() => subsText(page), { timeout: 10_000 }).toBe(`译文：${STT_LINES_EN[1]}|${STT_LINES_EN[1]}`)
    // 字幕存进库、一次提交；云端的文件和转写都删了
    expect(read(vault, VTT)).toContain(`NOTE lang=en source=soniox stt-async-v6`)
    expect(log(vault)).toContain(`视频：生成字幕《A video without subtitles》（Soniox 听写）\n\n${VTT}`)
    expect(soniox.requests.filter((r) => r.method === 'DELETE').map((r) => r.path)).toEqual(['/v1/transcriptions/tr-1', '/v1/files/file-1'])
    // 之前没字幕时记的那一块：补上原文和译文（一次提交）
    await expect.poll(() => read(vault, '看视频.md'), { timeout: 15_000 }).toContain(`> **00:03 ${STT_LINES_EN[1]} / 译文：${STT_LINES_EN[1]}**`)
    await expect(page.locator('.toast-cn')).toContainText('补上了1处时刻的原文和译文')
    await expect.poll(() => log(vault)).toContain('视频：字幕生成好了，补上 1 处时刻的原文和译文《A video without subtitles》')
    await pane(page).getByText('先记一句。').click()
    await expect(pane(page).locator('.cm-vmoment[data-part="时刻块"] .o')).toHaveText(STT_LINES_EN[1]!)
    // 生成、补块都提交了，库里没有落下没提交的
    await expect.poll(() => gitStatus(vault), { timeout: 10_000 }).toBe('')
    if (process.env.CN_SHOTS) {
      await subsBtn(page).click()
      await shotPart(menu(page), 'cn69-done')
      await page.keyboard.press('Escape')
      await shotWindow(run, 'cn74-filled')
    }
  } finally {
    await run.close({ keep: true })
  }

  // 关掉软件再开：同一个视频直接有这条字幕，不再下载、听写
  const before = soniox.requests.length
  const app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [join(__dirname, '../out/main/index.js')],
    env: { ...process.env, ...env(), CN_VAULT: run.vault, CN_USER_DATA: run.userData, CN_E2E: '1', CN_NO_AX: '1', CN_QUICK_KEY: 'Alt+Command+Shift+F19' },
  })
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.vault b')).toHaveText('测试库')
    await openVideo(page)
    await expect(subsBtn(page)).toContainText('字幕 英→中', { timeout: 15_000 })
    expect(soniox.requests.length).toBe(before)
  } finally {
    await app.close()
    rmSync(dirname(run.vault), { recursive: true, force: true, maxRetries: 5 })
  }
})

test('CN-69 没填 Soniox 密钥：「生成字幕」灰着，旁边「先在设置里填 Soniox 密钥」点了到设置 › AI；填好就能点；「以后自动生成」开关记住', async () => {
  const run = await launch({ 'a.md': '# a\n' }, env({ SONIOX_API_KEY: '' }))
  const { page } = run
  try {
    await openVideo(page)
    await expect(subsBtn(page)).toContainText('没有字幕', { timeout: 15_000 })
    await subsBtn(page).click()
    const box = menu(page).getByTestId('stt-box')
    await expect(box.getByRole('button', { name: '生成字幕' })).toBeDisabled()
    await box.getByRole('button', { name: '先在设置里填Soniox密钥' }).click()
    const dialog = page.getByRole('dialog', { name: '设置' })
    await expect(dialog.getByRole('textbox', { name: 'Soniox 密钥' })).toBeVisible()
    await expect(dialog.getByTestId('stt-key-state')).toHaveText('还没填：到soniox.com注册后在控制台拿一个API Key')
    await dialog.getByRole('textbox', { name: 'Soniox 密钥' }).fill('test-soniox-key')
    await dialog.getByRole('textbox', { name: 'Soniox 密钥' }).press('Enter')
    await expect(dialog.getByTestId('stt-key-state')).toHaveText('已填 ••••-key，加密存在这台Mac上')
    await page.keyboard.press('Meta+,')
    if (!(await menu(page).isVisible())) await subsBtn(page).click()
    await expect(menu(page).getByTestId('stt-box').getByRole('button', { name: '生成字幕' })).toBeEnabled()
    await menu(page).getByRole('switch', { name: '以后没字幕的视频打开就自动生成' }).click()
    await expect.poll(async () => (await page.evaluate(() => window.cnVideo.settings())).autoStt).toBe(true)
    expect(existsSync(join(run.vault, VTT))).toBe(false)
  } finally {
    await run.close()
  }
})

test('第 5 轮：音频下好了、Soniox 连不上：说「网络不通，没连上Soniox」，不把「字幕没生成成」写两遍；英文原话收在「看原话」里', async () => {
  const run = await launch({ '看视频.md': '# 看视频\n' }, env({ CN_SONIOX_BASE: 'http://127.0.0.1:9' }))
  const { page } = run
  try {
    await shotTone(page)
    await openVideo(page)
    await expect(subsBtn(page)).toContainText('没有字幕', { timeout: 15_000 })
    await subsBtn(page).click()
    const box = menu(page).getByTestId('stt-box')
    await box.getByRole('button', { name: '生成字幕' }).click()
    const err = menu(page).getByTestId('stt-error')
    await expect(err).toHaveText(/网络不通，没连上Soniox/, { timeout: 20_000 })
    await expect(err).not.toContainText('网络不通，没连上Soniox，再试一次')
    expect((await box.innerText()).match(/字幕没生成成/g)?.length).toBe(1)
    await shotPart(menu(page), 'r5-stt-soniox-down')
    await box.getByRole('button', { name: '看原话' }).click()
    await expect(box.locator('pre.raw')).toHaveText(/^fetch failed/)
  } finally {
    await run.close()
  }
})
