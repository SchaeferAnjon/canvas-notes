import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { gitStatus, launch, openNote, rail, waitSaved, railItems, webAboveAi, widenRight } from './app'
import { LECTURE } from './fixtures/pdf'

const P1 = 'In linear algebra, a rotation matrix is a transformation matrix that is used to perform a rotation in Euclidean space.'
let server: Server
let base: string

test.beforeAll(async () => {
  server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end(`<!doctype html><html lang="en"><head><title>Rotation matrix</title></head><body style="font:18px/1.6 Georgia,serif;padding:24px;max-width:640px;background:#fff;color:#1b1b1b">
      <h1>Rotation matrix</h1><p id="p1">${P1}</p><p><a id="lnk" href="#later">Later section</a></p></body></html>`)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
test.afterAll(() => {
  server.close()
})

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const ai = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })
const guest = (page: Page, code: string) => page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code)
const gitOut = (vault: string, ...args: string[]) => execFileSync('git', ['-C', vault, ...args], { encoding: 'utf8' }).trim()

async function openWeb(page: Page, u: string) {
  await rail(page).getByRole('button', { name: '网页' }).click()
  // 右栏默认 340 窄，第一段折得很长；先拉宽到 420 再打开网页、再框
  if (Math.round((await web(page).boundingBox())!.width) < 420) await widenRight(page, 80)
  const addr = web(page).getByRole('textbox', { name: '网址' })
  await addr.fill(u)
  await addr.press('Enter')
  await expect.poll(() => guest(page, 'document.readyState + "|" + location.href')).toBe(`complete|${u}`)
}

/** 在网页上按住 ⌘ 框住第一段 */
async function boxP1(page: Page) {
  const w = (await web(page).locator('webview.on').boundingBox())!
  const r = JSON.parse(String(await guest(page, `JSON.stringify(document.getElementById('p1').getBoundingClientRect())`))) as { x: number; y: number; width: number; height: number }
  await page.keyboard.down('Meta')
  await page.mouse.move(w.x + r.x - 4, w.y + r.y - 4)
  await page.mouse.down()
  await page.mouse.move(w.x + r.x + r.width / 2, w.y + r.y + r.height / 2, { steps: 5 })
  await page.mouse.move(w.x + r.x + r.width + 4, w.y + r.y + r.height + 4, { steps: 5 })
  await page.mouse.up()
  await page.keyboard.up('Meta')
}

test('网页上框着问：中间开着文档就插到光标处（带网址和回到网页的链接），一次提交；没开文档进收件箱；⌘ 点一下链接还是网页自己的', async () => {
  const run = await launch({ '线性代数 草稿.md': '# 线性代数 草稿\n\n我的草稿。\n' }, { CN_AI_FAKE: '1', CN_FAKE_NOTE_MS: '50' })
  const { page, vault } = run
  try {
    await openNote(page, '线性代数 草稿')
    await page.locator('.pane:not([hidden]) .cm-content').click()
    await page.keyboard.press('Meta+ArrowDown')
    await openWeb(page, `${base}/wiki/Rotation_matrix`)
    // ⌘ 点一下（不拖）：网页自己的（跳到锚点）
    // 右栏刚拉宽，网页可能还在重排：量完点一下，没跳就重新量再点（最多三次）
    for (let i = 0; i < 3; i++) {
      const lr = JSON.parse(String(await guest(page, `JSON.stringify(document.getElementById('lnk').getBoundingClientRect())`))) as { x: number; y: number }
      const w = (await web(page).locator('webview.on').boundingBox())!
      await page.mouse.click(w.x + lr.x + 5, w.y + lr.y + 5)
      if (await expect.poll(() => guest(page, 'location.hash'), { timeout: 1500 }).toBe('#later').then(() => true, () => false)) break
    }
    await expect.poll(() => guest(page, 'location.hash')).toBe('#later')

    // 框一块：AI 开出来，输入框里有截图、预填「给我讲解一下」。工作区方向 A（task-9okg5）：AI 和网页叠成一组、AI 在前面，
    // 想边看网页边问就把网页拖到上半（真拖），后面一直上下两块
    await boxP1(page)
    await expect(ai(page)).toBeVisible()
    await expect(page.getByTestId('dtab-web')).toHaveAttribute('aria-selected', 'false')
    await webAboveAi(page)
    await expect(web(page)).toBeVisible()
    await expect(ai(page)).toBeVisible()
    await expect(ai(page).getByTestId('reading-sees')).toContainText('网页 · Rotation matrix')
    await expect(ai(page).getByTestId('reading-att').locator('img')).toBeVisible()
    await expect(ai(page).getByRole('textbox')).toHaveValue('给我讲解一下')
    // 网页上问的没有一篇自己的笔记：「笔记」在原位变淡（右图标栏方向 A）
    await expect.poll(() => railItems(page)).toEqual(['笔记', '大纲', '网页', '微信读书', '历史'])
    await expect(rail(page).getByRole('button', { name: /^笔记/ })).toHaveClass(/\bdim\b/)
    await ai(page).getByRole('textbox').press('Enter')
    await expect(ai(page).locator('.um').last()).toHaveText('给我讲解一下')
    await expect(ai(page).getByText('读了网页这一段')).toBeVisible()
    await expect(ai(page).getByText('已记进《线性代数 草稿》')).toBeVisible({ timeout: 15_000 })
    await waitSaved(page)
    const md = readFileSync(join(vault, '线性代数 草稿.md'), 'utf8')
    expect(md).toContain('我的草稿。')
    expect(md).toMatch(/## 测试小标题 p\d+\n\[127\.0\.0\.1\]\(http:\/\/127\.0\.0\.1:\d+\/wiki\/Rotation_matrix#later\) · \d\d:\d\d/)
    expect(md).toContain('![我框的](附件/网页/127.0.0.1-p1-1.png)')
    // 身份写在第二行行尾，完整对话不再另写一份（CN-93）
    expect(md).toMatch(/\) · \d\d:\d\d <!-- cn:thread=网页-127\.0\.0\.1-p1-1 -->\n/)
    expect(md).not.toContain('完整对话')
    expect(gitOut(vault, 'log', '-1', '--format=%s')).toMatch(/^笔记：网页「Rotation matrix」· 测试小标题 p\d+ → 线性代数 草稿$/)
    expect(gitStatus(vault)).toBe('')
    expect(existsSync(join(vault, '.canvas-notes/对话'))).toBe(false)

    // 关掉文档：再框一块，记进收件箱
    await page.locator('main.center .tab', { hasText: '线性代数 草稿' }).getByRole('button', { name: '关闭标签' }).click()
    await boxP1(page)
    await expect(ai(page).getByRole('textbox')).toHaveValue('给我讲解一下')
    await ai(page).getByRole('textbox').press('Enter')
    await expect(ai(page).getByText('已记进收件箱《Rotation matrix 笔记》')).toBeVisible({ timeout: 15_000 })
    const inbox = readFileSync(join(vault, '收件箱/Rotation matrix 笔记.md'), 'utf8')
    expect(inbox).toContain('类型: 笔记')
    expect(inbox).toMatch(/来源: http:\/\/127\.0\.0\.1:\d+\/wiki\/Rotation_matrix#later/)
    expect(inbox).toMatch(/\[127\.0\.0\.1\]\(http:\/\/127\.0\.0\.1:\d+/)
    expect(gitStatus(vault)).toBe('')
  } finally {
    await run.close()
  }
})

test('中间开着 PDF 时在网页上框着问：进这份 PDF 的 AI，「看得到」多一颗网页；笔记那段记进 PDF 的笔记，来源写域名', async () => {
  const run = await launch({ '课程/线性代数/第3讲 线性映射.pdf': LECTURE }, { CN_AI_FAKE: '1', CN_FAKE_NOTE_MS: '50' })
  const { page, vault } = run
  try {
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
    await page.locator('.pal-row', { hasText: '第3讲 线性映射' }).first().click()
    await expect(page.locator('.pdfpane:not([hidden]) .pdfpage[data-page="1"] canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
    await openWeb(page, `${base}/wiki/Rotation_matrix`)
    await boxP1(page)
    await expect(ai(page).getByTestId('reading-sees')).toContainText('第3讲 线性映射.pdf · 第1页')
    await expect(ai(page).getByTestId('reading-sees')).toContainText('网页 · Rotation matrix')
    await ai(page).getByRole('textbox').press('Enter')
    await expect(ai(page).getByText('读了网页这一段 · 对上第1页')).toBeVisible()
    await expect(ai(page).getByText('已记进网页（记在第3讲 线性映射 笔记里）')).toBeVisible({ timeout: 15_000 })
    const md = readFileSync(join(vault, '课程/线性代数/第3讲 线性映射 笔记.md'), 'utf8')
    expect(md).toMatch(/## 第 1 页 · 测试小标题 p\d+\n\[127\.0\.0\.1\]\(http:\/\/127\.0\.0\.1:\d+\/wiki\/Rotation_matrix\)/)
    // 笔记里这段的来源胶囊写域名
    await rail(page).getByRole('button', { name: '笔记' }).click()
    await expect(page.getByRole('complementary', { name: '笔记', exact: true }).getByText('127.0.0.1')).toBeVisible()
    expect(existsSync(join(vault, '收件箱'))).toBe(false)
  } finally {
    await run.close()
  }
})
