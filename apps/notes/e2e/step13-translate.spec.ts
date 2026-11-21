// 双语翻译补强（2026-11-16，方向 A「按钮带菜单」）：菜单里换语言、显示、七种样式；没翻成说原因和办法；
// 一个能用的都没有时一开就说；设置里「翻译用什么」（顺序、指定一个、DeepSeek Key 只露 4 位、测试连接、试一句）；
// 整页剪藏带不带译文；课程术语表（AI 起头、翻译照表、选中加进表）；PDF 不假装在翻。
// AI 都是假的：命令行走 CN_AI_FAKE（CN_TR_FAKE_CLI / CN_TR_FAKE_FAIL 定状态和出错），DeepSeek 走本机假的 OpenAI 兼容服务，不用真 Key。
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gitStatus, launch, openNote, type Running, rail, tabOn, widenRight } from './app'

const SRC = {
  h: 'Lecture 7: Eigenvalues and Eigenvectors',
  p1: 'An eigenvector of a square matrix A is a nonzero vector x that does not change direction when A acts on it.',
  p2: 'We find the eigenvalues first by solving the characteristic equation, and then find each eigenvector.',
  li: 'The trace of A equals the sum of the eigenvalues.',
}
const ALL_MISSING = 'claude=missing,codex=missing,gemini=missing,opencode=missing'

let server: Server
let base: string
let pdfFile: string
/** 假 DeepSeek 收到的请求 */
const apiSeen: { auth?: string; model?: string }[] = []
let apiMode: 'ok' | '401' = 'ok'

test.beforeAll(async () => {
  // 一个有字的 PDF（macOS 自带的 cupsfilter 把一段字印成 PDF）
  const dir = mkdtempSync(join(tmpdir(), 'cn-pdf-'))
  writeFileSync(join(dir, 'a.txt'), 'The eigenvalue of a matrix.\n')
  pdfFile = join(dir, 'a.pdf')
  writeFileSync(pdfFile, execFileSync('/usr/sbin/cupsfilter', ['-m', 'application/pdf', join(dir, 'a.txt')], { stdio: ['ignore', 'pipe', 'ignore'] }))
  server = createServer((req, res) => {
    if (req.url === '/chat/completions') {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        const b = JSON.parse(body) as { model: string; messages: { content: string }[] }
        apiSeen.push({ auth: req.headers.authorization, model: b.model })
        if (apiMode === '401') {
          res.writeHead(401, { 'content-type': 'application/json' })
          return res.end('{"error":{"message":"Authentication Fails"}}')
        }
        const items = JSON.parse(/^段落：\n([\s\S]*)$/m.exec(b.messages[1]!.content)?.[1] ?? '[]') as { id: number; text: string }[]
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        for (const it of items) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify({ id: it.id, text: it.text === 'eigenvalue' ? '特征值' : `DS：${it.text.slice(0, 30)}` }) + '\n' } }] })}\n\n`)
        res.end('data: [DONE]\n\n')
      })
      return
    }
    if (req.url === '/doc.pdf') {
      res.setHeader('content-type', 'application/pdf')
      return res.end(readFileSync(pdfFile))
    }
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end(`<!doctype html><html lang="en"><title>Lecture 7</title><body style="font:16px/1.5 Georgia,serif;padding:20px;max-width:640px;background:#fff;color:#1b1b1b">
      <article><h1 id="h">${SRC.h}</h1><p id="p1">${SRC.p1}</p><p id="p2">${SRC.p2}</p><ul><li id="li">${SRC.li}</li></ul>
      <p id="w">Look up <span id="term">eigenspace</span> later.</p></article></body></html>`)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
test.afterAll(() => {
  server.close()
  rmSync(join(pdfFile, '..'), { recursive: true, force: true })
})

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const bar = (page: Page) => web(page).getByRole('toolbar', { name: '这一页' })
const trBtn = (page: Page) => bar(page).getByRole('button', { name: '双语翻译' })
const menuBtn = (page: Page) => web(page).getByRole('button', { name: '翻译选项' })
const menu = (page: Page) => page.getByRole('dialog', { name: '双语翻译' })

function guest(page: Page, code: string): Promise<unknown> {
  return page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code)
}

async function go(page: Page, u: string) {
  const addr = web(page).getByRole('textbox', { name: '网址' })
  await addr.fill(u)
  await addr.press('Enter')
  await expect.poll(() => guest(page, 'document.readyState + "|" + location.href')).toBe(`complete|${u}`)
}

async function openWeb(page: Page, u: string) {
  await rail(page).getByRole('button', { name: '网页' }).click()
  await expect(web(page)).toBeVisible()
  await go(page, u)
}

const trOf = (page: Page, id: string) => guest(page, `document.getElementById('${id}')?.querySelector('cn-tr')?.textContent ?? null`)
const attrOf = (page: Page, id: string, a: string) => guest(page, `document.getElementById('${id}')?.querySelector('cn-tr')?.getAttribute('${a}') ?? null`)
const css = (page: Page, sel: string, prop: string) => guest(page, `getComputedStyle(document.querySelector('${sel}')).${prop}`)
const fake = (t: string) => '译文：' + t.slice(0, 40)
const savedSettings = (run: Running) => (JSON.parse(readFileSync(join(run.userData, 'plugins/state.json'), 'utf8')) as { settings: { translate: Record<string, unknown> } }).settings.translate

async function guestRect(page: Page, code: string) {
  const w = (await web(page).locator('webview.on').boundingBox())!
  const r = JSON.parse(String(await guest(page, `JSON.stringify(${code}.getBoundingClientRect())`))) as { x: number; y: number; width: number; height: number }
  return { x: w.x + r.x + r.width / 2, y: w.y + r.y + r.height / 2 }
}

test('菜单：小箭头开菜单换语言、对照 / 只看译文、七种样式，网页上马上变、菜单不关；改了就记住，下次点开关按上次的翻；点外面、Esc、再点箭头都关', async () => {
  const run = await launch({ 'a.md': '# a\n' }, { CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '200' })
  const { page } = run
  try {
    await openWeb(page, `${base}/lecture`)
    // 关着翻译时也能开菜单先挑好：选「日本語」
    await menuBtn(page).click()
    await expect(menu(page)).toBeVisible()
    await expect(menuBtn(page)).toHaveAttribute('aria-expanded', 'true')
    await expect(menu(page).getByRole('switch', { name: '双语翻译 开关' })).toHaveAttribute('aria-checked', 'false')
    await menu(page).getByRole('radio', { name: '日本語' }).click()
    await expect(menu(page).getByRole('radio', { name: '日本語' })).toHaveAttribute('aria-checked', 'true')
    await expect.poll(() => savedSettings(run).target).toBe('ja')
    // 再点箭头关
    await menuBtn(page).click()
    await expect(menu(page)).toHaveCount(0)

    // 点开关：按刚选的翻成日文；地址栏里只有图标（设好就收起来），翻成什么写在悬停提示里
    await trBtn(page).click()
    await expect(trBtn(page)).toHaveText('')
    await expect(trBtn(page)).toHaveAttribute('title', '恢复原文（在翻成日）⌥A')
    await expect(bar(page).locator('.trctl')).toHaveClass(/\bon\b/)
    await expect.poll(() => trOf(page, 'p1')).toBe(fake(SRC.p1))

    // 菜单里换回简体中文：先出「翻译中…」再重翻；菜单不关
    await menuBtn(page).click()
    await expect(menu(page).getByText('这页是English')).toBeVisible()
    await menu(page).getByRole('radio', { name: '简体中文' }).click()
    await expect.poll(() => trOf(page, 'p1'), { timeout: 2000 }).toBe('翻译中…')
    await expect.poll(() => trOf(page, 'p1')).toBe(fake(SRC.p1))
    await expect(trBtn(page)).toHaveAttribute('title', '恢复原文（在翻成中）⌥A')
    await expect(menu(page)).toBeVisible()
    // 默认样式淡色：译文比原文淡一档
    expect(await attrOf(page, 'p1', 'data-s')).toBe('plain')
    expect(await css(page, '#p1 cn-tr', 'color')).not.toBe(await css(page, '#p1', 'color'))

    // 七种样式挨个点：网页上马上换
    const styles: [string, string, () => Promise<void>][] = [
      ['下划线', 'underline', async () => expect(String(await css(page, '#p1 cn-tr', 'textDecorationLine'))).toBe('underline')],
      ['虚线框', 'dashed', async () => expect(await css(page, '#p1 cn-tr', 'borderTopStyle')).toBe('dashed')],
      ['荧光笔', 'marker', async () => expect(String(await css(page, '#p1 cn-tr > span', 'backgroundImage'))).toContain('linear-gradient')],
      ['左竖线', 'bar', async () => expect(await css(page, '#p1 cn-tr', 'borderLeftWidth')).toBe('2px')],
      ['淡化原文', 'fade', async () => expect(await guest(page, `document.getElementById('p1').hasAttribute('data-cn-fade')`)).toBe(true)],
      ['模糊自测', 'blur', async () => expect.poll(() => css(page, '#p1 cn-tr', 'filter')).toBe('blur(5px)')],
    ]
    for (const [name, id, check] of styles) {
      await menu(page).getByRole('radio', { name }).click()
      await expect.poll(() => attrOf(page, 'p1', 'data-s')).toBe(id)
      await check()
    }
    await expect(menu(page).getByText('点一段看译文')).toBeVisible()
    await expect.poll(() => savedSettings(run).style).toBe('blur')
    // 淡化原文换走了：段落上的淡化也拿掉
    expect(await guest(page, `document.querySelectorAll('[data-cn-fade]').length`)).toBe(0)

    // 模糊自测：点一下显出来，再点糊回去（真的鼠标点在网页里）
    await page.keyboard.press('Escape')
    await expect(menu(page)).toHaveCount(0)
    const t = await guestRect(page, `document.querySelector('#p1 cn-tr')`)
    await page.mouse.click(t.x, t.y)
    await expect.poll(() => attrOf(page, 'p1', 'data-shown')).toBe('')
    await expect.poll(() => css(page, '#p1 cn-tr', 'filter')).toBe('none')
    await page.mouse.click(t.x, t.y)
    await expect.poll(() => attrOf(page, 'p1', 'data-shown')).toBeNull()
    // ⌘F「模糊自测：全部显示」
    await page.keyboard.press('Meta+f')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('模糊自测')
    await expect(page.getByRole('option', { name: /模糊自测：全部显示/ })).toBeVisible()
    await page.keyboard.press('Enter')
    await expect.poll(() => guest(page, `[...document.querySelectorAll('cn-tr')].every((t) => t.hasAttribute('data-shown'))`)).toBe(true)

    // 只看译文：原文藏起来，译文不套样式；样式组不能点
    await menuBtn(page).click()
    await menu(page).getByRole('radio', { name: '只看译文' }).click()
    await expect.poll(() => css(page, '#p1 cn-orig', 'display')).toBe('none')
    expect(await attrOf(page, 'p1', 'data-s')).toBeNull()
    await expect(menu(page).getByText('只看译文时没有样式')).toBeVisible()
    await expect(menu(page).getByRole('radio', { name: '淡色' })).toBeDisabled()
    await menu(page).getByRole('radio', { name: '对照' }).click()
    await expect.poll(() => guest(page, `document.querySelectorAll('cn-orig').length`)).toBe(0)
    // 点菜单外面关
    await page.locator('.pane:not([hidden])').click({ position: { x: 200, y: 300 } })
    await expect(menu(page)).toHaveCount(0)

    // 恢复原文；重开软件后设置还在：点开关直接按上次的样式翻
    await trBtn(page).click()
    await expect.poll(() => guest(page, `document.querySelectorAll('cn-tr').length`)).toBe(0)
    expect(savedSettings(run)).toMatchObject({ target: 'zh-CN', display: 'below', style: 'blur' })
    // ⌘F 里「翻成…」打开同一个菜单
    await page.keyboard.press('Meta+f')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('翻成')
    await expect(page.getByRole('option', { name: /翻成…/ })).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(menu(page)).toBeVisible()
  } finally {
    await run.close()
  }
})

test('没翻成：按钮不再亮紫色、不写「双语对照中」，写「没翻成」带红点；段落下一行固定 12px「没翻成 · 重试」；菜单里写原因和办法（怎么登录、改用 Codex）', async () => {
  const run = await launch({ 'a.md': '# a\n' }, { CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '100', CN_TR_FAKE_FAIL: 'claude=Claude Code 没答完：Invalid API key · Please run /login' })
  const { page } = run
  try {
    // 指定只用 Claude Code，它没登录（问了才知道）
    await page.evaluate(() => window.cnPlugins.setSettings('translate', { engineMode: 'pick', pick: 'claude' }))
    await openWeb(page, `${base}/lecture`)
    await trBtn(page).click()
    await expect.poll(() => trOf(page, 'p1')).toBe('没翻成 · 重试')
    const ctl = bar(page).locator('.trctl')
    await expect(ctl).toHaveClass(/\berr\b/)
    await expect(ctl).not.toHaveClass(/\bon\b/)
    await expect(trBtn(page)).toHaveText('没翻成')
    await expect(ctl.locator('.trc-dot')).toBeVisible()
    expect(await trBtn(page).getAttribute('title')).not.toContain('双语对照中')
    // 标题下面那行也是 12px，不跟 h1 放大；悬停写原因
    expect(await css(page, '#h cn-tr', 'fontSize')).toBe('12px')
    expect(await guest(page, `document.querySelector('#h cn-tr').title`)).toBe('Claude Code还没登录。点「重试」再翻这一段')
    // 菜单不自己弹出来；点开才看到原因
    await expect(menu(page)).toHaveCount(0)
    await menuBtn(page).click()
    const alert = menu(page).getByRole('alert', { name: '没翻成的原因' })
    await expect(alert).toContainText('段没翻成：Claude Code还没登录')
    await expect(alert).toContainText('设置里指定了只用Claude Code。')
    await expect(menu(page).getByText('指定用Claude Code')).toBeVisible()
    await alert.getByRole('button', { name: '怎么登录' }).click()
    await expect(alert).toContainText('打开「终端」，输入claude回车')
    // 改用 Codex：设置切成指定 Codex，失败的段重翻
    await alert.getByRole('button', { name: '改用Codex' }).click()
    await expect.poll(() => trOf(page, 'p1')).toBe(fake(SRC.p1))
    expect(await trOf(page, 'h')).toBe(fake(SRC.h))
    await expect(ctl).toHaveClass(/\bon\b/)
    await expect(trBtn(page)).toHaveAttribute('title', '恢复原文（在翻成中）⌥A')
    await expect(menu(page).getByRole('alert')).toHaveCount(0)
    await expect(menu(page).getByText('用Codex翻')).toBeVisible()
    await page.keyboard.press('Escape')

    // 自动模式：Claude Code 不行就换下一个，不打扰人
    await trBtn(page).click()
    await page.evaluate(() => window.cnPlugins.setSettings('translate', { engineMode: 'auto' }))
    await page.evaluate(() => window.cnPlugins.call('translate', 'clearCache'))
    await web(page).getByRole('button', { name: '重新载入' }).click()
    await expect.poll(() => guest(page, 'document.readyState')).toBe('complete')
    await trBtn(page).click()
    await expect.poll(() => trOf(page, 'p1')).toBe(fake(SRC.p1))
    expect(await guest(page, `document.querySelectorAll('cn-tr[data-st="err"]').length`)).toBe(0)
    await expect(bar(page).locator('.trctl')).toHaveClass(/\bon\b/)
  } finally {
    await run.close()
  }
})

test('一个能用的都没有：一按就打开菜单说原因，不往段落里写字；去设置填 DeepSeek Key（只露最后 4 位）、测试连接，网页接着用 DeepSeek 翻', async () => {
  apiSeen.length = 0
  apiMode = 'ok'
  const run = await launch({ 'a.md': '# a\n' }, { CN_AI_FAKE: '1', CN_TR_FAKE_CLI: ALL_MISSING, CN_TR_API_BASE_DEEPSEEK: base })
  const { page } = run
  try {
    await openWeb(page, `${base}/lecture`)
    await trBtn(page).click()
    await expect(menu(page)).toBeVisible()
    const alert = menu(page).getByRole('alert')
    await expect(alert).toContainText('现在没有能翻的')
    await expect(alert).toContainText('Claude Code、Codex、Gemini、OpenCode没装，API都没填Key')
    await expect(alert).toContainText('最快：填一个DeepSeek Key')
    await expect(bar(page).locator('.trctl')).toHaveClass(/\berr\b/)
    expect(await guest(page, `document.querySelectorAll('cn-tr').length`)).toBe(0)

    // 去设置：最上面同样一块，「填 DeepSeek Key」展开那一行、光标在框里
    await alert.getByRole('button', { name: '去设置' }).click()
    const set = page.getByRole('dialog', { name: '设置' })
    await expect(set.getByRole('alert', { name: '现在没有能翻的' })).toBeVisible()
    await set.getByRole('button', { name: '填DeepSeek Key' }).click()
    const input = set.getByRole('textbox', { name: 'DeepSeek 的 API Key' })
    await expect(input).toBeFocused()
    await expect(set.getByRole('button', { name: '测试连接' })).toBeDisabled()
    const KEY = 'sk-e2e-0123456789abcdefa3f9'
    await input.fill(KEY)
    await set.getByRole('button', { name: '存好' }).click()
    // 只露最后 4 位：整串 Key 不在界面上
    const row = set.getByRole('listitem', { name: 'DeepSeek' })
    await expect(row).toContainText('能用 · ••••a3f9')
    await expect(row).toContainText('正在用')
    expect(await page.content()).not.toContain(KEY)
    await expect(set.getByLabel('已存的 Key')).toHaveText('••••••••••••a3f9')
    // 存在测试实例的内存里，不写进软件文件夹（真软件是 safeStorage 加密进钥匙串）
    expect(existsSync(join(run.userData, 'plugins/translate/keys.json'))).toBe(false)
    // 测试连接：走本机假的 DeepSeek（照官方格式）
    await set.getByRole('button', { name: '测试连接' }).click()
    await expect(set.getByRole('status').filter({ hasText: '能用' })).toContainText('eigenvalue → 特征值（DeepSeek）')
    expect(apiSeen.at(-1)).toEqual({ auth: `Bearer ${KEY}`, model: 'deepseek-flash' })
    // 试一句：用现在的设置
    await set.getByRole('button', { name: '试一句' }).click()
    await expect(set.getByRole('status').filter({ hasText: '答的' })).toContainText('DeepSeek API答的')
    await expect(set.getByRole('alert', { name: '现在没有能翻的' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(set).toHaveCount(0)

    // 网页那边刚才不能用的：现在用 DeepSeek 翻了
    await expect.poll(() => trOf(page, 'p1')).toBe(`DS：${SRC.p1.slice(0, 30)}`)
    await expect(bar(page).locator('.trctl')).toHaveClass(/\bon\b/)

    // Key 不对：测试连接说 401
    apiMode = '401'
    await page.keyboard.press('Meta+,')
    const set2 = page.getByRole('dialog', { name: '设置' })
    await set2.getByRole('button', { name: '插件' }).click()
    await set2.getByRole('listitem', { name: 'DeepSeek' }).getByRole('button', { name: '换Key' }).click()
    await set2.getByRole('button', { name: '测试连接' }).click()
    await expect(set2.getByRole('status').filter({ hasText: 'Key不对' })).toHaveText('Key不对（401），去DeepSeek看看是不是复制少了')
    await expect(set2.getByRole('listitem', { name: 'DeepSeek' })).toContainText('Key不对')
    // 删掉 Key
    await set2.getByRole('button', { name: '删掉' }).click()
    await expect(set2.getByRole('listitem', { name: 'DeepSeek' })).toContainText('没填Key')
  } finally {
    apiMode = 'ok'
    await run.close()
  }
})

test('设置 › 翻译用什么：自动 / 指定一个，拖动换顺序，记在设置里', async () => {
  const run = await launch({ 'a.md': '# a\n' }, { CN_AI_FAKE: '1', CN_TR_FAKE_CLI: 'claude=login,gemini=missing' })
  const { page } = run
  try {
    await page.keyboard.press('Meta+,')
    const set = page.getByRole('dialog', { name: '设置' })
    await set.getByRole('button', { name: '插件' }).click()
    const list = set.getByRole('list', { name: '翻译用什么' })
    await expect(list.getByRole('listitem')).toHaveText([/1.*Claude Code.*没登录.*怎么登录/, /2.*Codex.*正在用.*能用/, /3.*Gemini CLI.*没装.*怎么装/, /4.*OpenCode/, /5.*DeepSeek.*没填Key/, /6.*智谱GLM.*没填Key/])
    // 怎么登录：展开命令
    await list.getByRole('listitem', { name: 'Claude Code' }).getByRole('button', { name: '怎么登录' }).click()
    await expect(set.getByText('打开「终端」，输入claude回车')).toBeVisible()
    // 拖 DeepSeek 到最上面
    await list.getByLabel('拖动 DeepSeek 换顺序').dragTo(list.getByRole('listitem', { name: 'Claude Code' }))
    await expect.poll(() => savedSettings(run).engineOrder).toEqual(['deepseek', 'claude', 'codex', 'gemini', 'opencode', 'zhipu'])
    await expect(list.getByRole('listitem').first()).toContainText('DeepSeek')
    // 指定一个：单选
    await set.getByRole('radiogroup', { name: '怎么选翻译引擎' }).getByRole('radio', { name: '指定一个' }).click()
    const radios = set.getByRole('radiogroup', { name: '翻译用什么' })
    await radios.getByRole('radio', { name: 'OpenCode' }).click()
    await expect(radios.getByRole('radio', { name: 'OpenCode' })).toHaveAttribute('aria-checked', 'true')
    await expect.poll(() => savedSettings(run)).toMatchObject({ engineMode: 'pick', pick: 'opencode' })
    await expect(set.getByText('只用选中的这个；它出错时不换别的，直接告诉你。')).toBeVisible()
  } finally {
    await run.close()
  }
})

test('整页剪藏带上译文：默认关只存原文；菜单里打开，每段原文后面跟一段「> 」引用，提示条多半句「· 带了译文」；只看译文时也存原文', async () => {
  const run = await launch({ 'a.md': '# a\n' }, { CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '50' })
  const { page, vault } = run
  try {
    await openWeb(page, `${base}/lecture`)
    await trBtn(page).click()
    await expect.poll(() => trOf(page, 'p2')).toBe(fake(SRC.p2))
    const clip = async () => {
      await web(page).getByRole('button', { name: '剪藏这一页' }).click()
      await expect(web(page).locator('.wnote')).toContainText('整页存进收件箱了')
      const files = readdirSync(join(vault, '收件箱')).sort()
      return { md: readFileSync(join(vault, '收件箱', files.at(-1)!), 'utf8'), note: await web(page).locator('.wnote').innerText() }
    }
    const off = await clip()
    expect(off.md).toContain(SRC.p1)
    expect(off.md).not.toContain('译文：')
    expect(off.note).not.toContain('带了译文')

    await menuBtn(page).click()
    await expect(menu(page).getByText('关着只存原文')).toBeVisible()
    await menu(page).getByRole('switch', { name: '整页剪藏带上译文' }).click()
    await expect(menu(page).getByText('原文下面跟译文')).toBeVisible()
    await menu(page).getByRole('radio', { name: '只看译文' }).click()
    await page.keyboard.press('Escape')
    await web(page).locator('.wnote').getByRole('button', { name: '撤回' }).click()
    await expect(web(page).locator('.wnote')).toContainText('撤回了')
    const on = await clip()
    expect(on.md).toContain(`${SRC.p1}\n\n> ${fake(SRC.p1)}`)
    expect(on.md).toContain(`> ${fake(SRC.li)}`)
    await expect(web(page).locator('.wnote')).toContainText('· 带了译文')
    expect(savedSettings(run).clipWithTranslation).toBe(true)
    expect(gitStatus(vault)).toBe('')
  } finally {
    await run.close()
  }
})

test('课程术语表：中间栏开着课程里的文件，菜单里「让 AI 起个头」写成表（一次提交）并在中间栏打开；翻译照表译；网页里选一个词「加进术语表」', async () => {
  const run = await launch({ '课程/线性代数/第7讲 特征值.md': '# 第7讲 特征值\n\n先解特征方程。\n' }, { CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '100' })
  const { page, vault } = run
  try {
    await openNote(page, '第7讲 特征值')
    await openWeb(page, `${base}/lecture`)
    await menuBtn(page).click()
    const row = menu(page).getByLabel('术语表')
    await expect(row).toContainText('线性代数还没有')
    await row.getByRole('button', { name: '让AI起个头' }).click()
    await expect(tabOn(page)).toHaveText('术语表')
    const md = readFileSync(join(vault, '课程/线性代数/术语表.md'), 'utf8')
    expect(md).toContain('| 原文 | 译法 | 备注 |')
    expect(md).toContain('| eigenvalue | 特征值 |  |')
    expect(md).toContain('| characteristic equation | 特征方程 | 不译「特性方程」 |')
    expect(execFileSync('git', ['-C', vault, 'log', '-1', '--format=%s'], { encoding: 'utf8' }).trim()).toBe('术语表：AI 起头「线性代数」5 条')
    expect(gitStatus(vault)).toBe('')

    // 翻译时带上这门课的术语：这批里出现的词进提示（假 AI 在译文后面写出用到的术语）
    await page.keyboard.press('Escape')
    await openNote(page, '第7讲 特征值')
    await trBtn(page).click()
    await expect.poll(() => trOf(page, 'p2')).toBe(`${fake(SRC.p2)} [特征值、特征向量、特征方程]`)
    await menuBtn(page).click()
    await expect(menu(page).getByLabel('术语表')).toContainText('线性代数 · 5条')
    await page.keyboard.press('Escape')

    // 网页里双击选一个词，工具条上「加进术语表」：加一行，译法先留空，一次提交，在中间栏打开
    // 右栏默认 340 窄：先拉宽一点，工具条整条露在网页里
    await widenRight(page, 80)
    await guest(page, `document.getElementById('term').scrollIntoView({ block: 'center' })`)
    const w = await guestRect(page, `document.getElementById('term')`)
    for (let i = 0; i < 3; i++) {
      await page.mouse.dblclick(w.x, w.y)
      if (await expect.poll(() => guest(page, 'getSelection().toString().trim()'), { timeout: 1000 }).toBe('eigenspace').then(() => true, () => false)) break
    }
    await expect.poll(() => guest(page, `document.getElementById('cn-clip-host')?.shadowRoot?.querySelector('button.term')?.hidden`)).toBe(false)
    const b = await guestRect(page, `document.getElementById('cn-clip-host').shadowRoot.querySelector('button.term')`)
    await page.mouse.click(b.x, b.y)
    await expect.poll(() => readFileSync(join(vault, '课程/线性代数/术语表.md'), 'utf8')).toContain('| eigenspace |  |  |')
    await expect(tabOn(page)).toHaveText('术语表')
    await expect.poll(() => execFileSync('git', ['-C', vault, 'log', '-1', '--format=%s'], { encoding: 'utf8' }).trim()).toBe('术语表：加「eigenspace」')
  } finally {
    await run.close()
  }
})

test('PDF：右栏网页打开 PDF 时没有双语翻译这一项（地址栏、⌘K 都没有）；按 ⌥A 只说一句翻不了、去 PDF 阅读器框一块「翻译 + 讲一讲」（PDF 对照读 2026-11-18 删了，不再指过去）', async () => {
  const run = await launch({ 'a.md': '# a\n' }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await rail(page).getByRole('button', { name: '网页' }).click()
    // 先在普通网页上：翻译那一对在
    const addr = web(page).getByRole('textbox', { name: '网址' })
    await addr.fill(`${base}/en`)
    await addr.press('Enter')
    await expect(trBtn(page)).toBeVisible()
    await addr.fill(`${base}/doc.pdf`)
    await addr.press('Enter')
    await expect.poll(() => guest(page, 'document.contentType').catch(() => '')).toBe('application/pdf')
    await expect(bar(page).locator('.trctl')).toHaveCount(0)
    await page.keyboard.press('Meta+k')
    const pal = page.getByRole('dialog', { name: '搜索和命令' })
    await pal.getByRole('textbox').fill('双语翻译')
    await expect(pal.getByRole('option').filter({ hasText: /双语翻译这个网页/ })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(pal).toBeHidden()
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('Alt+KeyA')
    await expect(page.locator('.toast-cn')).toHaveText(/这是PDF，网页里的双语翻译翻不了它。放进库里用PDF阅读器打开，框一块点「翻译 \+ 讲一讲」/)
    await expect(page.locator('.toast-cn')).not.toContainText('对照读')
    // 回到普通网页：那一对又回来了
    await addr.fill(`${base}/en`)
    await addr.press('Enter')
    await expect(trBtn(page)).toBeVisible()
  } finally {
    await run.close()
  }
})
