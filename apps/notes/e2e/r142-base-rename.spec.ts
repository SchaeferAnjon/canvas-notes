/**
 * 文档里的数据库块（r142）：双击块头的名字原地改名（回车确认、Esc 取消），改的是数据源文件夹，文件里 file.inFolder 跟着换；
 * 数据库文件夹改名、挪走以后，右栏「记录」开着的那一条跟到新路径（标签收着时也跟），点表里一条照样在右栏打开，
 * main.log 里没有拿旧路径去读的 note:read ENOENT（用户那台：挪了文件夹后还在读「收件箱/未命名数据库/第一条.md」）。
 * 都是真点、真打字。
 */
import { expect, type Page, test } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, openNote, pane, type Running } from './app'

const NOTE = '收件箱/计划.md'
const BASE = (folder: string) => ['```base', 'filters:', '  and:', `    - file.inFolder("${folder}")`, 'views:', '  - type: table', '    name: 表格', '    order:', '      - file.name', '      - 状态', '```'].join('\n')
const FILES: Record<string, string> = {
  [NOTE]: `# 计划\n\n要读的几篇。\n\n${BASE('收件箱/未命名数据库')}\n\n后面一段。\n`,
  '收件箱/未命名数据库/第一条.md': '---\n状态: 未开始\n---\n第一条的正文。\n',
  '收件箱/未命名数据库/第二条.md': '---\n状态: 在读\n---\n第二条的正文。\n',
  '项目/说明.md': '# 说明\n',
}

const SHOTS = process.env.CN_SHOTS
const shot = async (page: Page, name: string) => SHOTS && (await page.screenshot({ path: join(SHOTS, name) }))

const logText = (run: Running) => {
  const f = join(run.userData, 'logs', 'main.log')
  return existsSync(f) ? readFileSync(f, 'utf8') : ''
}
const db = (page: Page) => pane(page).locator('[data-part="数据库块"]')
const peek = (page: Page) => page.locator('.rpeek')

async function start() {
  const run = await launch(FILES)
  await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
  const errors: string[] = []
  run.page.on('pageerror', (e) => errors.push(String(e)))
  await openNote(run.page, '计划')
  await expect(db(run.page).locator('tbody tr')).toHaveCount(2)
  return { ...run, errors }
}

/** 点表里一条：右栏「记录」开着它，正文读出来了 */
async function openRec(page: Page, name: string, body: string) {
  await db(page).getByRole('button', { name, exact: true }).click()
  await expect(page.getByTestId('dtab-record')).toHaveText(name)
  await expect(peek(page).locator('.rec-body .cm-content')).toContainText(body)
}
const closeRec = (page: Page) => page.getByTestId('dtab-record').locator('button.x').click()

test('文档里双击数据库块头的名字改名：Esc 不改；回车改了数据源文件夹，file.inFolder 跟着换、别的字一个不动；右栏开过的一条跟到新路径、日志没有 ENOENT', async () => {
  const run = await start()
  const { page, vault, errors } = run
  const file = () => readFileSync(join(vault, NOTE), 'utf8')
  try {
    const head = db(page).locator('.base-top')
    await expect(head.locator('.base-name')).toHaveText('未命名数据库')
    // 右栏开过第一条，再收起标签（record 还记着这一条）
    await openRec(page, '第一条', '第一条的正文')
    await closeRec(page)
    await expect(page.getByTestId('dtab-record')).toHaveCount(0)

    // Esc 不改
    await head.locator('.base-name').dblclick()
    const box = head.getByRole('textbox', { name: '数据库的新名字' })
    await expect(box).toBeFocused()
    await expect(box).toHaveValue('未命名数据库')
    await page.keyboard.type('不要')
    await page.keyboard.press('Escape')
    await expect(box).toHaveCount(0)
    await expect(head.locator('.base-name')).toHaveText('未命名数据库')
    expect(file()).toBe(FILES[NOTE])

    // 双击、打新名字、回车
    await head.locator('.base-name').dblclick()
    await expect(box).toBeFocused()
    await shot(page, '1-文档里双击改名.png')
    await page.keyboard.press('Meta+a')
    await page.keyboard.type('读书清单')
    await page.keyboard.press('Enter')
    await expect.poll(file).toBe(FILES[NOTE]!.replace('收件箱/未命名数据库', '收件箱/读书清单'))
    expect(existsSync(join(vault, '收件箱/读书清单/第一条.md'))).toBe(true)
    expect(existsSync(join(vault, '收件箱/未命名数据库'))).toBe(false)
    await expect(head.locator('.base-name')).toHaveText('读书清单')
    await expect(db(page).locator('tbody tr')).toHaveCount(2)

    // 点表里一条：右栏在新路径打开；之前那一条（收着的）也跟到了新路径
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cn.record') ?? 'null')?.path)).toBe('收件箱/读书清单/第一条.md')
    await openRec(page, '第二条', '第二条的正文')
    await openRec(page, '第一条', '第一条的正文')
    await shot(page, '2-改名以后右栏记录.png')
    await page.waitForTimeout(500)
    expect(logText(run)).not.toMatch(/ENOENT/)
    expect(errors).toEqual([])
  } finally {
    await run.close()
  }
})

test('挪走数据库文件夹（标签收着和开着各一次）：右栏「记录」跟到新路径、数据源跟着换，点卡里一条能打开，日志没有 ENOENT', async () => {
  const run = await start()
  const { page, vault, errors } = run
  try {
    await openRec(page, '第一条', '第一条的正文')
    await closeRec(page)
    // 标签收着时把数据库文件夹挪进「项目」（同左栏右键「移到」）
    await page.evaluate(() => (window as unknown as { cnFolder: { move(f: string, p: string): Promise<string> } }).cnFolder.move('收件箱/未命名数据库', '项目'))
    await expect.poll(() => readFileSync(join(vault, NOTE), 'utf8')).toContain('file.inFolder("项目/未命名数据库")')
    const rec = () => page.evaluate(() => JSON.parse(localStorage.getItem('cn.record') ?? 'null') as { path: string; src: string } | null)
    await expect.poll(async () => (await rec())?.path).toBe('项目/未命名数据库/第一条.md')
    await expect.poll(async () => (await rec())?.src).toContain('file.inFolder("项目/未命名数据库")')
    await expect(db(page).locator('tbody tr')).toHaveCount(2)
    await openRec(page, '第二条', '第二条的正文')
    // 标签开着时再挪回收件箱：右栏这一条跟过去，属性照样读得出
    await page.evaluate(() => (window as unknown as { cnFolder: { move(f: string, p: string): Promise<string> } }).cnFolder.move('项目/未命名数据库', '收件箱'))
    await expect.poll(async () => (await rec())?.path).toBe('收件箱/未命名数据库/第二条.md')
    await expect(peek(page).locator('.rec-title')).toHaveText('第二条')
    await expect(peek(page).locator('.rec-row[data-col="状态"] .v')).toHaveText('在读')
    await openRec(page, '第一条', '第一条的正文')
    await page.waitForTimeout(500)
    expect(logText(run)).not.toMatch(/ENOENT/)
    expect(errors).toEqual([])
  } finally {
    await run.close()
  }
})

test('开着的那一条在外面被挪走（软件没收到改名）：再显示「记录」时不拿旧路径去读，标签收起，日志没有 ENOENT', async () => {
  const run = await start()
  const { page } = run
  try {
    await openRec(page, '第一条', '第一条的正文')
    // 模拟上次留下的旧路径（在外面挪走、重启以后）
    await page.evaluate(() => {
      const r = JSON.parse(localStorage.getItem('cn.record')!)
      localStorage.setItem('cn.record', JSON.stringify({ ...r, path: '收件箱/不在了/第一条.md' }))
    })
    await page.reload()
    // 「记录」标签开着回来：盘上没这一条，收起（不读旧路径）
    await expect(page.getByTestId('dtab-record')).toHaveCount(0)
    expect(await page.evaluate(() => localStorage.getItem('cn.record'))).toBeNull()
    await openNote(page, '计划')
    await openRec(page, '第二条', '第二条的正文')
    await page.waitForTimeout(500)
    expect(logText(run)).not.toMatch(/ENOENT/)
  } finally {
    await run.close()
  }
})
