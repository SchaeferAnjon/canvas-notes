// 网页翻译、视频字幕翻译在任何网站都能用（用户 2026-11-26：「这个应该是不要再出现了，就应该是任何网页上都可以吧?」）。
// 本机几类假网站（fixtures/fake-sites.ts，照真网站的结构）：普通文章（p 和 div>span）、单页应用（过一会儿才画、换路由）、
// 要登录才出正文、shadow DOM（两层）、同源 iframe、严格 CSP；视频：B 站结构（/zh-Hans/video/ 地址）、Vimeo 结构（<track> 挂 VTT）、
// 随便一个带 <video><track> 的网页。每类：点地址栏「双语翻译」正文出译文；有视频的字幕是双语。翻译是假的（CN_AI_FAKE：「译文：」+ 原文前 40 个字）。
import { expect, test, type Page } from '@playwright/test'
import { readdirSync, readFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { join } from 'node:path'
import { launch, rail } from './app'
import { startFakeSites, SUB_LINES, TEXT } from './fixtures/fake-sites'

let server: Server
let base: string
test.beforeAll(async () => {
  ;({ server, base } = await startFakeSites())
})
test.afterAll(() => server.close())

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const strip = (page: Page) => web(page).getByRole('region', { name: '视频条' })
const trBtn = (page: Page) => web(page).getByRole('button', { name: '双语翻译', exact: true })
const guest = (page: Page, code: string) => page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code)
const env = () => ({ CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '50', CN_VIDEO_TEST_ORIGIN: base })
const fake = (s: string) => `译文：${s.slice(0, 40)}`

/** 网页里所有译文（连同 shadow DOM 里的、同源 iframe 里的） */
const allTr = (page: Page) =>
  guest(
    page,
    `(() => {
      const out = []
      const walk = (root) => {
        for (const el of root.querySelectorAll('*')) {
          if (el.tagName === 'CN-TR' && !el.hasAttribute('data-st')) out.push(el.textContent)
          if (el.shadowRoot) walk(el.shadowRoot)
          if (el.tagName === 'IFRAME') { try { if (el.contentDocument) walk(el.contentDocument) } catch {} }
        }
      }
      walk(document)
      return out
    })()`,
  ) as Promise<string[]>

async function open(page: Page, path: string) {
  const addr = web(page).getByRole('textbox', { name: '网址' })
  await addr.fill(`${base}${path}`)
  await addr.press('Enter')
}

/** 开一个页面（先做 prepare），点「双语翻译」，等到这几句的译文 */
async function translates(path: string, want: string[], prepare?: (page: Page) => Promise<void>, after?: (page: Page) => Promise<void>) {
  const run = await launch({ 'a.md': '# a\n' }, env())
  const { page } = run
  try {
    await rail(page).getByRole('button', { name: '网页' }).click()
    await open(page, path)
    await expect(web(page).getByRole('textbox', { name: '网址' })).toHaveValue(new RegExp(path.replace(/[/?]/g, '\\$&')))
    if (prepare) await prepare(page)
    await page.waitForTimeout(600)
    await trBtn(page).click()
    await expect.poll(() => allTr(page), { timeout: 15_000 }).toEqual(expect.arrayContaining(want.map(fake)))
    if (after) await after(page)
  } finally {
    await run.close()
  }
}

test('普通文章：p 里的、div>span 里的都翻（很多新闻站、博客不用 p），导航短链接不翻；再点恢复原文', () =>
  translates('/article', [TEXT.articleP, TEXT.articleSpan], undefined, async (page) => {
    expect((await allTr(page)).some((t) => t.includes('Home'))).toBe(false)
    await trBtn(page).click()
    await expect.poll(() => allTr(page)).toEqual([])
  }))

test('单页应用：正文过一会儿才画出来；换路由（不整页刷新）以后的新正文也翻', () =>
  translates(
    '/spa',
    [TEXT.spa],
    async (page) => {
      await expect.poll(() => guest(page, `document.querySelector('#app .body')?.textContent ?? ''`)).toContain('rendered')
    },
    async (page) => {
      await guest(page, `document.getElementById('next').click(), true`)
      await expect.poll(() => allTr(page), { timeout: 15_000 }).toContain(fake(TEXT.spa2))
    },
  ))

test('要登录才出正文的页：登录（表单提交、跳到会员页）以后点翻译', () =>
  translates('/login', [TEXT.members], async (page) => {
    await expect.poll(() => guest(page, `!!document.getElementById('signin')`)).toBe(true)
    await guest(page, `document.getElementById('signin').click(), true`)
    await expect.poll(() => guest(page, `location.pathname`), { timeout: 10_000 }).toBe('/members')
  }))

test('shadow DOM：自定义元素里的、再套一层的都翻，译文样式在里面也生效', () =>
  translates(
    '/shadow',
    [TEXT.shadow, TEXT.shadowDeep],
    async (page) => {
      await expect.poll(() => guest(page, `!!document.querySelector('x-card')?.shadowRoot`)).toBe(true)
    },
    async (page) => {
      // 单独一行（样式进了 shadow DOM），不是挤在原文后面
      expect(await guest(page, `getComputedStyle(document.querySelector('x-card').shadowRoot.querySelector('cn-tr')).display`)).toBe('block')
    },
  ))

test('同源 iframe 里的正文也翻', () =>
  translates('/iframe', [TEXT.iframe], async (page) => {
    await expect.poll(() => guest(page, `document.getElementById('body')?.contentDocument?.querySelector('p')?.textContent ?? ''`)).toContain('iframe')
  }))

test('严格 CSP（不许内联样式）：译文照样出，样式也在', () =>
  translates(
    '/csp',
    [TEXT.csp],
    async (page) => {
      await expect.poll(() => guest(page, `document.querySelector('p')?.textContent ?? ''`)).toContain('security')
    },
    async (page) => {
      expect(await guest(page, `getComputedStyle(document.querySelector('cn-tr')).display`)).toBe('block')
    },
  ))

/** 画面上我们画的字幕两行：译文、原文 */
const subLines = (page: Page) => guest(page, `[...(document.getElementById('cn-video-host')?.shadowRoot?.querySelectorAll('.subs span') ?? [])].map((s) => s.className + ':' + s.textContent).join('|')`)

async function seek(page: Page, t: number) {
  await guest(page, `(() => { const v = document.querySelector('video'); v.currentTime = ${t}; v.pause(); return true })()`)
}

test('别的网站的视频也能记下这一刻：截图、带时间的链接指回那个网页（#t=秒）', async () => {
  const run = await launch({ 'a.md': '# a\n' }, env())
  const { page, vault } = run
  try {
    await rail(page).getByRole('button', { name: '网页' }).click()
    await open(page, '/lecture')
    await expect(strip(page).getByRole('button', { name: '字幕' })).toContainText('英→中', { timeout: 20_000 })
    await seek(page, 7)
    await strip(page).getByRole('button', { name: '记下这一刻' }).click()
    await expect(page.locator('.vtoast')).toContainText('记进了', { timeout: 20_000 })
    const inbox = readdirSync(join(vault, '收件箱')).filter((f) => f.endsWith('.md'))
    const md = inbox.map((f) => readFileSync(join(vault, '收件箱', f), 'utf8')).join('\n')
    expect(md).toContain(`${base}/lecture#t=7`)
    expect(md).toMatch(/<!-- moment video=web:\w+ t=7/)
  } finally {
    await run.close()
  }
})

for (const [name, path, title] of [
  ['B 站（中文界面跳到 /zh-Hans/video/ 的地址）', '/zh-Hans/video/BV1xx411c7mD', TEXT.biliTitle],
  ['Vimeo（字幕是 <track> 挂的 VTT）', '/vimeo/76979871', TEXT.vimeoTitle],
  ['Vimeo（字幕 VTT 在别的域名、视频没开跨域，浏览器读不进来）', '/vimeo-xo/1', TEXT.vimeoTitle],
  ['随便一个带 <video><track> 的网页', '/lecture', TEXT.lecture],
] as const) {
  test(`视频字幕：${name}，视频条出来、字幕双语；点双语翻译网页也翻`, async () => {
    const run = await launch({ 'a.md': '# a\n' }, env())
    const { page } = run
    try {
      await rail(page).getByRole('button', { name: '网页' }).click()
      await open(page, path)
      await expect(strip(page)).toBeVisible({ timeout: 15_000 })
      await expect(strip(page).getByRole('button', { name: '字幕' })).toContainText('英→中', { timeout: 20_000 })
      await seek(page, 4)
      await expect.poll(() => subLines(page), { timeout: 15_000 }).toBe(`t:${fake(SUB_LINES[1]!)}|o:${SUB_LINES[1]}`)
      await trBtn(page).click()
      await expect.poll(() => allTr(page), { timeout: 15_000 }).toContain(fake(title))
      // 播放器画面上的字（B 站的弹幕）不翻：译文会糊在画面上
      expect((await allTr(page)).some((t) => t.includes('Greetings'))).toBe(false)
    } finally {
      await run.close()
    }
  })
}
