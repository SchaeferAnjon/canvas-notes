/**
 * 「突然白屏」兜底（task-pyb39）：一块渲染出错只那一块换成出错卡、别的照常能用能存；整窗出错有出错页，重新加载能好；
 * 恢复上次的状态时坏数据丢掉、不白屏；这些都记进 main.log；菜单「帮助 › 打开日志文件夹」。
 * 渲染错误用测试模式才有的 window.cnTestCrash(哪一块) 注入（renderer/crash/report.ts）。
 * 交付截图：CN_SHOTS=目录 时截出错页和面板出错卡，CN_SHOT_TONE=dark 截深湖（不给是天青）。
 */
import { expect, test, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { gitStatus, launch, openAi, openNote, pane, tabOn, waitSaved, type Running } from './app'

const NOTE = '# 学习笔记：动手学深度学习\n\n2.3 线性代数\n\n标量、向量、矩阵。\n'
const FILES = { '学习笔记：动手学深度学习.md': NOTE, '第二篇.md': '# 第二篇\n\n别的内容。\n' }

const SHOTS = process.env.CN_SHOTS
const DARK = process.env.CN_SHOT_TONE === 'dark'
const tone = DARK ? 'dark' : 'light'
/** 截图时按要的深浅定主题（天青 / 深湖） */
const look = (vault: string) => {
  if (!SHOTS) return
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: DARK ? 'petrol' : 'sky' } }))
}
async function shot(run: Running, name: string) {
  if (!SHOTS) return
  await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
  await run.page.mouse.move(700, 870)
  await run.page.waitForTimeout(600)
  mkdirSync(SHOTS, { recursive: true })
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(SHOTS, `${name}-${tone}.png`), Buffer.from(b64, 'base64'))
}

const crash = (page: Page, area: string, on = true) => page.evaluate(([a, o]) => (window as unknown as { cnTestCrash(a: string, o: boolean): void }).cnTestCrash(a as string, o as boolean), [area, on] as const)
const logText = (run: Running) => {
  const f = join(run.userData, 'logs', 'main.log')
  return existsSync(f) ? readFileSync(f, 'utf8') : ''
}
const card = (page: Page, area: string) => page.locator(`[data-testid="panel-crash"][data-area="${area}"]`)

test('右栏 AI 渲染出错：只那一格换成出错卡，左栏、文档照常，打的字存上盘；重新打开就好；日志里有这条', async () => {
  const run = await launch(FILES, {}, look)
  const { page, vault } = run
  try {
    await openNote(page, '学习笔记：动手学深度学习')
    await openAi(page)
    await expect(page.getByRole('textbox', { name: '问 AI' })).toBeVisible()

    await crash(page, 'ai')
    const ai = card(page, 'ai')
    await expect(ai).toBeVisible()
    await expect(ai).toContainText('这一块出错了')
    await expect(ai.getByRole('button', { name: '重新打开' })).toBeVisible()
    await expect(page.getByRole('textbox', { name: '问 AI' })).toHaveCount(0)
    // 窗口没白：左栏、标签、文档都还在
    await expect(page.getByTestId('crash-page')).toHaveCount(0)
    await expect(page.locator('aside.side')).toBeVisible()
    await expect(tabOn(page)).toHaveText('学习笔记：动手学深度学习')
    await shot(run, 'panel-crash')

    // 文档里照样能打字、能存
    await pane(page).locator('.cm-line', { hasText: '标量、向量、矩阵。' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type('出错时也能写')
    await waitSaved(page)
    expect(readFileSync(join(vault, '学习笔记：动手学深度学习.md'), 'utf8')).toBe(NOTE.replace('矩阵。', '矩阵。出错时也能写'))

    // 错误详情能展开，写着是哪一块出的错
    await ai.getByRole('button', { name: '看原话' }).click()
    await expect(ai.getByTestId('crash-raw')).toContainText('测试注入的渲染错误：ai')
    await expect(ai.getByTestId('crash-raw')).toContainText('出错的地方：AI')
    await shot(run, 'panel-crash-open')

    // main.log 里有这条（带哪一块、堆栈）
    await expect.poll(() => logText(run)).toContain('[renderer-render] [ai] Error: 测试注入的渲染错误：ai')

    // 问题过去了，点「重新打开」这一格回来
    await crash(page, 'ai', false)
    await ai.getByRole('button', { name: '重新打开' }).click()
    await expect(ai).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: '问 AI' })).toBeVisible()
  } finally {
    await run.close()
  }
})

test('中间一个标签、左栏出错：各自换成出错卡，切到别的标签照常能写', async () => {
  const run = await launch(FILES)
  const { page, vault } = run
  try {
    await openNote(page, '第二篇')
    await openNote(page, '学习笔记：动手学深度学习')
    await crash(page, 'tab:note')
    // 两个笔记标签都抛：开着的那个看得到出错卡，标签条还在
    await expect(page.locator('.pane:not([hidden]) [data-testid="panel-crash"]')).toBeVisible()
    await expect(page.getByRole('tab').filter({ hasText: '第二篇' })).toBeVisible()
    await crash(page, 'tab:note', false)
    await page.locator('.pane:not([hidden])').getByRole('button', { name: '重新打开' }).click()
    await expect(pane(page).locator('.cm-content')).toBeVisible()

    await crash(page, 'left')
    await expect(card(page, 'left')).toBeVisible()
    await page.getByRole('tab').filter({ hasText: '第二篇' }).getByRole('button').first().click()
    await expect(tabOn(page)).toHaveText('第二篇')
    // 刚才藏着的「第二篇」也抛过，它自己的出错卡还在；点重新打开回来（左栏的出错卡不受影响）
    await page.locator('.pane:not([hidden])').getByRole('button', { name: '重新打开' }).click()
    await expect(card(page, 'left')).toBeVisible()
    await pane(page).locator('.cm-line', { hasText: '别的内容。' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type('左栏坏了也能写')
    await waitSaved(page)
    expect(readFileSync(join(vault, '第二篇.md'), 'utf8')).toBe('# 第二篇\n\n别的内容。左栏坏了也能写\n')
    await expect.poll(() => logText(run)).toContain('[renderer-render] [left]')
  } finally {
    await run.close()
  }
})

test('整窗出错：出错页不白屏，能看、能复制错误；点「重新加载」回来', async () => {
  const run = await launch(FILES, {}, look)
  const { page } = run
  try {
    await openNote(page, '学习笔记：动手学深度学习')
    await crash(page, 'window')
    const cp = page.getByTestId('crash-page')
    await expect(cp).toBeVisible()
    await expect(cp.getByRole('heading')).toHaveText('这一块出错了，你的笔记都在磁盘上，没丢')
    await expect(cp.getByRole('button', { name: '重新加载' })).toBeVisible()
    await expect(cp.getByRole('button', { name: '用默认布局打开' })).toBeVisible()
    await shot(run, 'crash-page')
    await cp.getByRole('button', { name: '看原话' }).click()
    await expect(cp.getByTestId('crash-raw')).toContainText('测试注入的渲染错误：window')
    // 复制：换掉页面的剪贴板写入（不动这台 Mac 的系统剪贴板），看拷的是错误摘要
    await page.evaluate(() => {
      const w = window as unknown as { copied: string }
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t: string) => void (w.copied = t) } })
    })
    await cp.getByRole('button', { name: '复制' }).click()
    await expect(cp.getByRole('button', { name: '已复制' })).toBeVisible()
    expect(await page.evaluate(() => (window as unknown as { copied: string }).copied)).toContain('测试注入的渲染错误：window')
    await shot(run, 'crash-page-open')
    await expect.poll(() => logText(run)).toContain('[renderer-render] [window]')

    await cp.getByRole('button', { name: '重新加载' }).click()
    await expect(page.locator('.vault b')).toHaveText('测试库')
    await expect(cp).toHaveCount(0)
    // 上次开着的标签照样恢复
    await expect(tabOn(page)).toHaveText('学习笔记：动手学深度学习')
  } finally {
    await run.close()
  }
})

test('整窗出错点「用默认布局打开」：上次的标签和栏的摆法清掉，库里文件不动', async () => {
  const run = await launch(FILES)
  const { page, vault } = run
  try {
    await openNote(page, '学习笔记：动手学深度学习')
    await openAi(page)
    await crash(page, 'window')
    await page.getByTestId('crash-page').getByRole('button', { name: '用默认布局打开' }).click()
    await expect(page.locator('.vault b')).toHaveText('测试库')
    await expect(page.getByTestId('crash-page')).toHaveCount(0)
    await expect(page.getByRole('tab').filter({ hasText: '学习笔记' })).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: '问 AI' })).toHaveCount(0)
    expect(gitStatus(vault)).toBe('')
  } finally {
    await run.close()
  }
})

test('开库失败（以前一直空着、白屏）：显示出错页', async () => {
  const run = await launch(FILES)
  const { page, app } = run
  try {
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('vault:get')
      ipcMain.handle('vault:get', () => {
        throw new Error('模拟开库失败')
      })
    })
    await page.reload()
    await expect(page.getByTestId('crash-page')).toBeVisible()
    await page.getByTestId('crash-page').getByRole('button', { name: '看原话' }).click()
    await expect(page.getByTestId('crash-raw')).toContainText('模拟开库失败')
  } finally {
    await run.close()
  }
})

test('恢复的状态坏了（标签少字段、布局和网页标签不是 JSON、光标位置不是数字）：启动不白屏，坏的丢掉，日志有一行', async () => {
  const run = await launch(FILES)
  const { page, vault } = run
  try {
    await page.evaluate((v) => {
      localStorage.setItem(`cn.tabs:${v}`, JSON.stringify({ tabs: [{ id: 'x', type: 'note' }, { id: 'y', type: 'pdf', path: 7 }, null, { id: 'n', type: 'note', path: '第二篇.md' }], active: 'x' }))
      localStorage.setItem('cn.dock', '{"v":1,"cols":[{"id":"c1","groups":')
      localStorage.setItem('cn.webtabs', '{"tabs":[null,{"id":1,"url":2}],"owners":7}')
      localStorage.setItem('cn.openCursor', JSON.stringify({ '第二篇.md': 'abc' }))
    }, vault)
    await page.reload()
    await expect(page.locator('.vault b')).toHaveText('测试库')
    await expect(page.getByTestId('crash-page')).toHaveCount(0)
    await expect(page.getByTestId('panel-crash')).toHaveCount(0)
    // 好的那个标签照样恢复，能写
    await expect(tabOn(page)).toHaveText('第二篇')
    await expect(pane(page).locator('.cm-content')).toBeVisible()
    await expect.poll(() => logText(run)).toContain('[renderer-restore] [tabs] 恢复时丢掉了坏数据：丢掉 3 个标签')
    expect(logText(run)).toContain('[renderer-restore] [dock] 恢复时丢掉了坏数据')
    expect(logText(run)).toContain('[renderer-restore] [webtabs] 恢复时丢掉了坏数据')
  } finally {
    await run.close()
  }
})

test('settings.json 坏了：照样打开（以前开库、读设置都失败，白屏），原文件留成 .broken，日志有一行', async () => {
  const run = await launch(FILES, {}, (vault) => {
    const ud = join(dirname(vault), 'user-data')
    mkdirSync(ud, { recursive: true })
    writeFileSync(join(ud, 'settings.json'), '{"appearance": {"skin": "sky"')
  })
  try {
    await expect(run.page.getByTestId('crash-page')).toHaveCount(0)
    expect(readFileSync(join(run.userData, 'settings.json.broken'), 'utf8')).toBe('{"appearance": {"skin": "sky"')
    expect(logText(run)).toContain('[restore] [settings] 恢复时丢掉了坏数据：settings.json 读不出来')
  } finally {
    await run.close()
  }
})

test('菜单「帮助 › 打开日志文件夹」打开日志所在的文件夹', async () => {
  const run = await launch(FILES)
  try {
    const dir = join(run.userData, 'logs')
    await run.app.evaluate(({ Menu }) => {
      const help = Menu.getApplicationMenu()!.items.find((i) => i.label === '帮助')!
      help.submenu!.items.find((i) => i.label === '打开日志文件夹')!.click()
    })
    await expect.poll(() => run.app.evaluate(() => (globalThis as unknown as { cnScreen: string[] }).cnScreen)).toContain(`打开 ${dir}`)
    expect(existsSync(dir)).toBe(true)
  } finally {
    await run.close()
  }
})
