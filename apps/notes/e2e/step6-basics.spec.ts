import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { dirname, join } from 'node:path'
import { gitStatus, launch, openNote, pane, pickFromNoteMenu, rail, waitSaved, tabOn } from './app'

const lastSubject = (vault: string) => execFileSync('git', ['-C', vault, 'log', '-1', '--format=%s'], { encoding: 'utf8' }).trim()
const commits = (vault: string) => Number(execFileSync('git', ['-C', vault, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim())
const palette = (page: Page) => page.getByRole('dialog', { name: '搜索和命令' })
const toast = (page: Page) => page.locator('.toast-cn')

test('⌘F 全局搜索：搜到正文里的词（刚打的字也算），回车打开那篇；esc 关掉', async () => {
  const run = await launch({ '所思所想.md': '# 所思所想\n\n财富是睡觉时也在赚钱的资产。\n', '旅行.md': '# 旅行\n\n冰岛\n' })
  const { page } = run
  try {
    await page.keyboard.press('Meta+f')
    const box = palette(page).getByRole('textbox', { name: '搜索笔记、输入网址或命令' })
    await expect(box).toBeFocused()
    await box.fill('睡觉时')
    const first = palette(page).getByRole('option').first()
    await expect(first).toContainText('所思所想')
    await expect(first).toContainText('财富是睡觉时也在赚钱的资产')
    await box.press('Enter')
    await expect(palette(page)).toHaveCount(0)
    await expect(tabOn(page)).toHaveText('所思所想')

    // 在另一篇里打几个字，保存后马上搜得到；编辑器里按 ⌘F 也是全局搜索
    await openNote(page, '旅行')
    await pane(page).locator('.cm-line', { hasText: '冰岛' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type('，去黑沙滩看极光')
    await waitSaved(page)
    await page.keyboard.press('Meta+f')
    await expect(box).toBeFocused()
    await box.fill('黑沙滩')
    await expect(palette(page).getByRole('option').first()).toContainText('旅行')
    await expect(palette(page).getByRole('option').first()).toContainText('去黑沙滩看极光')
    await box.press('Escape')
    await expect(palette(page)).toHaveCount(0)

    // 左栏的搜索框也打开同一个面板
    await page.getByRole('button', { name: '搜索' }).click()
    await expect(box).toBeFocused()
    await box.fill('没有这个词')
    await expect(palette(page).locator('.pal-none')).toHaveText('笔记和PDF里都没有「没有这个词」这几个字')
  } finally {
    await run.close()
  }
})

test('左栏右键「移到废纸篓」：文件进废纸篓，开着的标签关掉，当场提交一次删除', async () => {
  const run = await launch({ '删我.md': '# 删我\n\n不要了\n', '留着.md': '# 留着\n' })
  const { page, vault } = run
  try {
    await openNote(page, '删我')
    await expect(page.locator('.tab', { hasText: '删我' })).toHaveCount(1)
    await pickFromNoteMenu(run, '移到废纸篓')
    await page.locator('.nav .si', { hasText: '删我' }).click({ button: 'right' })
    await expect(toast(page)).toContainText('已删除《删我》')
    await expect(page.locator('.tab', { hasText: '删我' })).toHaveCount(0)
    await expect(page.locator('.nav .si', { hasText: '删我' })).toHaveCount(0)
    expect(existsSync(join(vault, '删我.md'))).toBe(false)
    const trashed = readdirSync(run.trash)
    expect(trashed).toHaveLength(1)
    expect(trashed[0]).toMatch(/删我\.md$/)
    expect(readFileSync(join(run.trash, trashed[0]!), 'utf8')).toBe('# 删我\n\n不要了\n')
    // 删笔记当场就是一次提交（2026-11-23 附件跟着笔记走：笔记和跟着它走的图同一次）
    expect(gitStatus(vault)).toBe('')
    expect(lastSubject(vault)).toBe('移到废纸篓：删我.md')
    await expect(page.locator('.gitbar').getByTestId('git-changed')).not.toContainText('没提交')
    expect(readFileSync(join(vault, '留着.md'), 'utf8')).toBe('# 留着\n')
  } finally {
    await run.close()
  }
})

test('左栏右键「重命名」：原地改名，文件和标签跟着变', async () => {
  const run = await launch({ '旧名字.md': '正文\n', '引用.md': '见 [[旧名字]]\n' })
  const { page, vault } = run
  try {
    await openNote(page, '旧名字')
    await pickFromNoteMenu(run, '重命名')
    await page.locator('.nav .si', { hasText: '旧名字' }).click({ button: 'right' })
    const input = page.locator('.nav').getByRole('textbox', { name: '新名字' })
    await expect(input).toBeFocused()
    await input.fill('新名字')
    await input.press('Enter')
    await expect(page.locator('.nav .si', { hasText: '新名字' })).toHaveCount(1)
    await expect(page.locator('.tab.on')).toContainText('新名字')
    expect(existsSync(join(vault, '旧名字.md'))).toBe(false)
    expect(readFileSync(join(vault, '新名字.md'), 'utf8')).toBe('正文\n')
    await expect.poll(() => readFileSync(join(vault, '引用.md'), 'utf8')).toBe('见 [[新名字]]\n')
  } finally {
    await run.close()
  }
})

test('自动提交：到点把没提交的改动提交掉，底栏变回已提交', async () => {
  const run = await launch({ '所思所想.md': '# 所思所想\n\n' }, { CN_MINUTE_MS: '150' })
  const { page, vault } = run
  try {
    const before = commits(vault)
    await openNote(page, '所思所想')
    await pane(page).locator('.cm-content').click()
    await page.keyboard.press('Meta+End')
    await page.keyboard.type('自动提交的一句话')
    await waitSaved(page)
    await expect.poll(() => gitStatus(vault), { timeout: 10_000 }).toBe('')
    expect(commits(vault)).toBe(before + 1)
    expect(lastSubject(vault)).toBe('更新 1 个文件：所思所想')
    await expect(page.locator('.gitbar').getByTestId('git-changed')).not.toContainText('没提交', { timeout: 10_000 })
  } finally {
    await run.close()
  }
})

test('退出前提交：关软件时没提交的改动提交掉', async () => {
  const run = await launch({ 'a.md': 'a\n' })
  const { page, vault } = run
  try {
    await expect(page.locator('.nav .si', { hasText: 'a' })).toHaveCount(1)
    writeFileSync(join(vault, '外面写的.md'), '别的软件写进来的\n')
    await expect(page.locator('.nav .si', { hasText: '外面写的' })).toHaveCount(1)
    await run.app.close()
    expect(gitStatus(vault)).toBe('')
    expect(lastSubject(vault)).toBe('新增 1 个文件：外面写的')
  } finally {
    rmSync(dirname(vault), { recursive: true, force: true })
  }
})

test('拖动右栏左边的分隔线：右栏变宽，下次打开还是这个宽度', async () => {
  const run = await launch({ 'a.md': 'a\n' })
  const { page } = run
  try {
    await openNote(page, 'a')
    await rail(page).getByRole('button', { name: '历史' }).click()
    const panel = page.getByRole('complementary', { name: '历史' })
    await expect(panel).toBeVisible()
    const w0 = (await panel.boundingBox())!.width
    const sep = page.getByRole('separator', { name: '拖动调整右栏宽度' })
    const b = (await sep.boundingBox())!
    await page.mouse.move(b.x + b.width / 2, b.y + 200)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width / 2 - 60, b.y + 200, { steps: 4 })
    await page.mouse.move(b.x + b.width / 2 - 120, b.y + 200, { steps: 4 })
    await page.mouse.up()
    const w1 = (await panel.boundingBox())!.width
    expect(Math.abs(w1 - (w0 + 120))).toBeLessThanOrEqual(2)
    // 工作区方向 A（task-9okg5）：宽度记在本机的布局里（cn.dock，这一栏的 w）
    expect(await page.evaluate(() => (JSON.parse(localStorage.getItem('cn.dock') ?? '{}').cols as { id: string; w?: number }[]).find((c) => c.id !== 'center')?.w)).toBe(Math.round(w1))

    await rail(page).getByRole('button', { name: '历史' }).click()
    await expect(panel).toHaveCount(0)
    await rail(page).getByRole('button', { name: '历史' }).click()
    expect(Math.abs((await panel.boundingBox())!.width - w1)).toBeLessThanOrEqual(1)
  } finally {
    await run.close()
  }
})

let server: Server
let base: string
test.beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end(`<title>${decodeURIComponent(req.url ?? '')}</title><body><a id="go" href="/wiki/%E6%9E%81%E5%85%89">极光</a></body>`)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
test.afterAll(() => server.close())

test('地址栏显示中文：打中文网址、网页里点 %E6 那种链接，都显示成中文', async () => {
  const run = await launch({ 'a.md': 'a\n' })
  const { page } = run
  try {
    await openNote(page, 'a')
    await rail(page).getByRole('button', { name: '网页' }).click()
    const web = page.getByRole('complementary', { name: '网页' })
    const addr = web.getByRole('textbox', { name: '网址' })
    await addr.fill(`${base}/wiki/冰岛`)
    await addr.press('Enter')
    const guest = (code: string) => page.evaluate((c) => (document.querySelector('webview') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code)
    await expect.poll(() => guest('document.readyState + "|" + location.pathname')).toBe('complete|/wiki/%E5%86%B0%E5%B2%9B')
    await expect(addr).toHaveValue(`${base.replace(/^http:\/\//, "")}/wiki/冰岛`)
    await guest(`document.getElementById('go').click()`)
    await expect.poll(() => guest('location.pathname')).toBe('/wiki/%E6%9E%81%E5%85%89')
    await expect(addr).toHaveValue(`${base.replace(/^http:\/\//, "")}/wiki/极光`)
  } finally {
    await run.close()
  }
})
