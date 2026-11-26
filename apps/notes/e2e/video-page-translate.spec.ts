// 收件箱「youtube 不能翻译」：视频页上地址栏的「双语翻译」以前只开关字幕（字幕开着时点了反而关掉），网页一个字不翻；
// YouTube 的简介、评论在 yt-attributed-string 里（全是 span，没有 p），整页翻译也认不出来。
// 现在：点了标题、简介、评论都翻，字幕开着双语；再点恢复原文，字幕照旧。视频站是本机假的（结构照 YouTube），翻译是假的（CN_AI_FAKE）。
import { expect, test, type Page } from '@playwright/test'
import type { Server } from 'node:http'
import { launch, rail } from './app'
import { COMMENT, DESCRIPTION, FAKE_VIDEO_ID, FAKE_ZH_ID, startFakeVideoSite, ZH_LINES } from './fixtures/fake-video'

let server: Server
let base: string

test.beforeAll(async () => {
  ;({ server, base } = await startFakeVideoSite())
})
test.afterAll(() => server.close())

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const strip = (page: Page) => web(page).getByRole('region', { name: '视频条' })
const guest = (page: Page, code: string) => page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code)
/** 各处插的译文：标题、简介、评论 */
const translated = (page: Page) =>
  guest(page, `JSON.stringify({ title: document.querySelector('h1 cn-tr')?.textContent ?? '', desc: document.querySelector('#description cn-tr')?.textContent ?? '', comment: document.querySelector('#content-text cn-tr')?.textContent ?? '' })`).then((s) => JSON.parse(s as string) as { title: string; desc: string; comment: string })

test('视频页上点「双语翻译」：标题、简介、评论都翻，字幕开着双语；再点恢复原文、字幕照旧', async () => {
  const run = await launch({ 'a.md': '# a\n' }, { CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '50', CN_VIDEO_TEST_ORIGIN: base })
  const { page } = run
  try {
    await rail(page).getByRole('button', { name: '网页' }).click()
    const addr = web(page).getByRole('textbox', { name: '网址' })
    await addr.fill(`${base}/watch?v=${FAKE_VIDEO_ID}`)
    await addr.press('Enter')
    const subs = strip(page).getByRole('button', { name: '字幕' })
    await expect(subs).toContainText('英→中', { timeout: 15_000 })

    const btn = web(page).getByRole('button', { name: '双语翻译', exact: true })
    await btn.click()
    await expect(btn).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => translated(page), { timeout: 15_000 }).toEqual({
      title: '译文：Linear transformations and matrices',
      desc: `译文：${DESCRIPTION.slice(0, 40)}`,
      comment: `译文：${COMMENT.slice(0, 40)}`,
    })
    // 字幕没被关掉
    await expect(subs).toContainText('英→中')

    // 再点：原文放回，字幕照旧
    await btn.click()
    await expect(btn).toHaveAttribute('aria-pressed', 'false')
    await expect.poll(() => guest(page, `document.querySelectorAll('cn-tr').length`)).toBe(0)
    await expect(subs).toContainText('英→中')

    // 字幕关着时点：网页翻、字幕也打开
    await subs.click()
    await web(page).getByRole('dialog', { name: '字幕' }).getByRole('radio', { name: '关' }).click()
    await expect(subs).toContainText('字幕关')
    await page.keyboard.press('Escape')
    await btn.click()
    await expect.poll(() => translated(page).then((t) => t.title)).toBe('译文：Linear transformations and matrices')
    await expect(subs).toContainText('英→中')
  } finally {
    await run.close()
  }
})

// r172「AI 翻译的回答内容不对，然后无法解析」：翻译那家不照「一行一个 JSON」回（前后多说话、带编号、一个对象拆成几行）时，
// 以前整批算「格式不对」、字幕只剩原文一行（视频条「N句没翻成」）、网页一段都不出；现在照样拆得出来
test('翻译那家回多余的话、排法不对：字幕双语照样出、视频条不报没翻成，网页标题简介照样翻', async () => {
  const run = await launch({ 'a.md': '# a\n' }, { CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '50', CN_TR_FAKE_CHATTY: '1', CN_VIDEO_TEST_ORIGIN: base })
  const { page } = run
  try {
    await rail(page).getByRole('button', { name: '网页' }).click()
    const addr = web(page).getByRole('textbox', { name: '网址' })
    await addr.fill(`${base}/watch?v=${FAKE_VIDEO_ID}`)
    await addr.press('Enter')
    const subs = strip(page).getByRole('button', { name: '字幕' })
    await expect(subs).toContainText('英→中', { timeout: 15_000 })
    await guest(page, `(() => { const v = document.querySelector('video'); v.currentTime = 4; v.pause(); return true })()`)
    const lines = () => guest(page, `[...document.getElementById('cn-video-host').shadowRoot.querySelectorAll('.subs span')].map((s) => s.className).join('|')`)
    await expect.poll(lines, { timeout: 15_000 }).toBe('t|o')
    // 全翻好了：不是「N句没翻成」，也没有百分比
    await expect.poll(() => subs.textContent(), { timeout: 15_000 }).toBe('字幕 英→中')
    await web(page).getByRole('button', { name: '双语翻译', exact: true }).click()
    await expect.poll(() => translated(page).then((t) => [t.title, t.desc.slice(0, 3)]), { timeout: 15_000 }).toEqual(['译文：Linear transformations and matrices', '译文：'])
  } finally {
    await run.close()
  }
})

// r172：中文视频、翻成是默认的中文时以前不翻（原文和翻成一种语言），画面上只有中文一行；现在按字幕的字认出是中文，换成翻成英文
test('中文视频（翻成默认中文）：字幕自动翻成英文，画面上双语两行', async () => {
  const run = await launch({ 'a.md': '# a\n' }, { CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '50', CN_VIDEO_TEST_ORIGIN: base })
  const { page } = run
  try {
    await rail(page).getByRole('button', { name: '网页' }).click()
    const addr = web(page).getByRole('textbox', { name: '网址' })
    await addr.fill(`${base}/watch?v=${FAKE_ZH_ID}`)
    await addr.press('Enter')
    const subs = strip(page).getByRole('button', { name: '字幕' })
    await expect(subs).toContainText('中→英', { timeout: 15_000 })
    await guest(page, `(() => { const v = document.querySelector('video'); v.currentTime = 4; v.pause(); return true })()`)
    const lines = () => guest(page, `[...document.getElementById('cn-video-host').shadowRoot.querySelectorAll('.subs span')].map((s) => s.className + ':' + s.textContent).join('|')`)
    await expect.poll(lines, { timeout: 15_000 }).toBe(`t:译文：${ZH_LINES[1]}|o:${ZH_LINES[1]}`)
  } finally {
    await run.close()
  }
})
