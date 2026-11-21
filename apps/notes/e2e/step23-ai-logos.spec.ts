// 偏好「AI 图标用引擎标志」（task-5svkm）：凡是交给 AI 引擎跑的，左边的图标就是跑它的那一家的标志（和右下角圆钮同一个），
// 不再用通用的闪光；设置 › AI 换了引擎，⌘K、右键、块菜单、打 / 的插入菜单当场跟着换。
import { expect, test, type Locator, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { launch, openNote, pane, type Running } from './app'
import { armMenus, dismissMenu, openedMenu } from './menu'

const pal = (page: Page) => page.getByRole('dialog', { name: '搜索和命令' })
const box = (page: Page) => pal(page).getByRole('textbox', { name: '搜索笔记、输入网址或命令' })
const row = (page: Page, name: string) => pal(page).getByRole('option').filter({ has: page.locator('.nm', { hasText: new RegExp(`^${name}$`) }) })
const size = async (l: Locator) => {
  const b = (await l.boundingBox())!
  return [Math.round(b.width), Math.round(b.height)]
}

/** ⌘K 打一个词，等那一行出来 */
async function palette(page: Page, q: string) {
  if (!(await pal(page).isVisible())) await page.keyboard.press('Meta+k')
  await box(page).fill(q)
}

/** 系统右键菜单里那一项的图标：有没有、多大、是不是模板图（单色、跟着菜单字色）、有没有 Claude 的橙色 */
async function menuIcon(run: Running, label: string) {
  await openedMenu(run)
  return run.app.evaluate((_e, label) => {
    const g = globalThis as unknown as { cnMenu: { menu: Electron.Menu } | null }
    const it = g.cnMenu!.menu.items.find((i) => i.label === label)
    if (!it) throw new Error(`菜单里没有「${label}」`)
    const icon = it.icon as Electron.NativeImage | undefined
    if (!icon || icon.isEmpty()) return null
    const bmp = icon.toBitmap({ scaleFactor: 2 })
    let orange = 0
    // BGRA；Claude 的标志是 #D97757
    for (let i = 0; i < bmp.length; i += 4) if (bmp[i + 3]! > 200 && Math.abs(bmp[i + 2]! - 0xd9) < 24 && Math.abs(bmp[i + 1]! - 0x77) < 24 && Math.abs(bmp[i]! - 0x57) < 24) orange++
    return { size: icon.getSize(), template: icon.isTemplateImage(), orange: orange > 20 }
  }, label)
}

test('⌘K 里交给 AI 的命令画当前引擎的标志（16，和别的图标一样大）；换成 Codex 后 ⌘K、右键「问 AI」、块菜单、插入菜单当场都换成 Codex', async () => {
  const run = await launch({ '随笔.md': '# 随笔\n\n第一段文字。\n\n第二段文字。\n' }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    // ---- ⌘K：Claude Code ----
    await palette(page, '整理收件箱')
    for (const name of ['整理收件箱']) {
      const logo = row(page, name).locator('.eng-logo')
      await expect(logo).toHaveAttribute('data-engine', 'claude')
      expect(await size(logo)).toEqual([16, 16])
    }
    await palette(page, '问AI')
    await expect(row(page, '问AI').locator('.eng-logo')).toHaveAttribute('data-engine', 'claude')
    await palette(page, '总结这块白板')
    await expect(row(page, '总结这块白板').locator('.eng-logo')).toHaveAttribute('data-engine', 'claude')
    await palette(page, '写成文章')
    await expect(row(page, '写成文章').locator('.eng-logo')).toHaveAttribute('data-engine', 'claude')
    await palette(page, '现在梦游')
    await expect(row(page, '现在梦游').locator('.eng-logo')).toHaveAttribute('data-engine', 'claude')
    // 不经 AI 的两条不画标志，也不再画闪光
    await palette(page, '找重复')
    await expect(row(page, '找重复').locator('.eng-logo')).toHaveCount(0)
    // 左边只有它自己的图标（右端那颗 ⋯ 不算）
    await expect(row(page, '找重复').locator('svg.ci.i')).toHaveCount(1)
    await palette(page, '剪藏这一页')
    await expect(row(page, '剪藏这一页').locator('.eng-logo')).toHaveCount(0)
    // 搜不到时「让Claude帮我找」：这件活一直是 Claude Code 跑的
    await palette(page, '库里绝对没有的词')
    const find = pal(page).getByRole('option').filter({ hasText: '让Claude帮我找' })
    await expect(find.locator('.eng-logo')).toHaveAttribute('data-engine', 'claude')
    expect(await size(find.locator('.eng-logo'))).toEqual([16, 16])
    await page.keyboard.press('Escape')

    // ---- 右键「问 AI」（系统菜单）：Claude 的橙色标志，16 点 ----
    await armMenus(run)
    await openNote(page, '随笔')
    await pane(page).locator('.cm-line', { hasText: '第一段文字' }).click({ button: 'right' })
    const claudeIcon = await menuIcon(run, '问 AI 这一块')
    expect(claudeIcon).toEqual({ size: { width: 16, height: 16 }, template: false, orange: true })
    await dismissMenu(run)

    // ---- 设置 › AI 默认换成 Codex ----
    await page.keyboard.press('Meta+,')
    await page.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: 'AI', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '设置' })
    await dialog.getByTestId('ai-default-pick').click()
    await page.getByRole('menu', { name: '默认用哪一家' }).getByRole('menuitemradio').filter({ hasText: 'Codex' }).click()
    await expect(dialog.getByTestId('ai-default')).toContainText('Codex')
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()

    // ⌘K 再开：AI 对话那几条、梦游（跟默认）都是 Codex；「让Claude帮我找」还是 Claude
    await palette(page, '整理收件箱')
    await expect(row(page, '整理收件箱').locator('.eng-logo')).toHaveAttribute('data-engine', 'codex')
    await palette(page, '现在梦游')
    await expect(row(page, '现在梦游').locator('.eng-logo')).toHaveAttribute('data-engine', 'codex')
    await palette(page, '库里绝对没有的词')
    await expect(pal(page).getByRole('option').filter({ hasText: '让Claude帮我找' }).locator('.eng-logo')).toHaveAttribute('data-engine', 'claude')
    await page.keyboard.press('Escape')

    // 右键「问 AI」：Codex 的标志是单色的，做成模板图（系统按菜单的字色画，深色菜单里是白的）
    await pane(page).locator('.cm-line', { hasText: '第一段文字' }).click({ button: 'right' })
    expect(await menuIcon(run, '问 AI 这一块')).toEqual({ size: { width: 16, height: 16 }, template: true, orange: false })
    await dismissMenu(run)

    // 块菜单「问 AI 这一块」
    const line = pane(page).locator('.cm-line', { hasText: '第二段文字' })
    await expect(async () => {
      const b = (await line.boundingBox())!
      await page.mouse.move(b.x + 40, b.y + b.height / 2)
      await page.mouse.move(b.x + 60, b.y + b.height / 2)
      await expect(pane(page).locator('.blk-bar:not([hidden]) .blk-grip')).toBeVisible({ timeout: 500 })
    }).toPass({ timeout: 5000 })
    await pane(page).locator('.blk-bar:not([hidden]) .blk-grip').click()
    const bmenu = page.getByRole('menu', { name: '块菜单' })
    const ask = bmenu.getByRole('menuitem', { name: '问 AI 这一块' })
    await expect(ask.locator('.eng-logo')).toHaveAttribute('data-engine', 'codex')
    expect(await size(ask.locator('.eng-logo'))).toEqual([14, 14])
    await page.keyboard.press('Escape')
    await expect(bmenu).toBeHidden()

    // 打 / 的插入菜单：AI 那一组
    await line.click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('/ai')
    const slash = page.locator('.slash-menu')
    const aiRow = slash.getByRole('option').filter({ hasText: 'AI 写一段' })
    await expect(aiRow.locator('.eng-logo')).toHaveAttribute('data-engine', 'codex')
    expect(await size(aiRow.locator('.eng-logo'))).toEqual([16, 16])
    await page.keyboard.press('Escape')
  } finally {
    await run.close()
  }
})

let server: Server
let base: string
test.beforeAll(async () => {
  server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end('<title>Ice caves</title><body><h1>Ice caves</h1><p>Only enter ice caves with a certified glacier guide.</p><p>Wear crampons and a helmet.</p></body>')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
test.afterAll(() => server.close())

const guest = (page: Page, code: string) =>
  page.evaluate((c) => {
    const w = document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> } | null
    return w ? w.executeJavaScript(c).catch(() => null) : null
  }, code)

test('AI 在网页里动手：指针旁的小胶囊画动手那一家的标志（Claude 的橙色）', async () => {
  const run = await launch({ '随笔.md': '# 随笔\n\n第一段。\n' }, { CN_AI_FAKE: '1' })
  const { page } = run
  const ai = page.getByRole('complementary', { name: 'AI 对话' })
  const send = async (text: string) => {
    const box = ai.getByRole('textbox', { name: '问 AI' })
    await box.fill(text)
    await box.press('Enter')
  }
  try {
    await page.locator('.nav .si', { hasText: '随笔' }).click()
    await page.keyboard.press('Meta+j')
    await send(`打开 ${base}/ice 看看`)
    await expect(ai.getByTestId('ai-msg').last().locator('.txt')).toContainText('网页标题是「Ice caves」', { timeout: 30_000 })
    await expect(ai.getByRole('button', { name: '发送' })).toBeVisible()
    await send('把网页里「certified glacier guide」这一段剪进收件箱')
    await expect.poll(() => guest(page, `!!document.querySelector('#cn-ai-cursor.on')`)).toBe(true)
    const logo = await guest(page, `document.querySelector('#cn-ai-cursor .cn-ai-lg')?.innerHTML ?? ''`)
    expect(logo).toContain('#D97757')
    expect(await guest(page, `document.querySelector('#cn-ai-cursor > span')?.innerText`)).toBe('AI')
  } finally {
    await run.close()
  }
})
