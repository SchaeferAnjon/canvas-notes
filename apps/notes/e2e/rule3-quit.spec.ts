import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { gitStatus, launch, openNote, pane, acts, type Running } from './app'
import { makeBigVault } from './fixtures/big-vault'

// 退出软件：刚打的字（停手不到 0.8 秒、还没自动保存）先存进文件、提交进 Git 再退；
// 退出途中主进程出了错也照样退出，不弹「A JavaScript error occurred」那个模态框（弹出来软件就停在框上关不掉）。

const lastSubject = (vault: string) => execFileSync('git', ['-C', vault, 'log', '-1', '--format=%s'], { encoding: 'utf8' }).trim()

test('⌘Q 时刚打的字还没自动保存：先存进文件、提交进 Git，再退出', async () => {
  const run = await launch({ '日记.md': '# 日记\n\n今天去了海边。\n' })
  const { page, vault } = run
  try {
    await openNote(page, '日记')
    await pane(page).locator('.cm-line', { hasText: '今天去了海边。' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type('退出前最后一句')
    // 还没存：自动保存要停手 0.8 秒
    await expect(acts(page).getByTestId('save-state')).toHaveAttribute('data-state', 'dirty')
    expect(readFileSync(join(vault, '日记.md'), 'utf8')).not.toContain('退出前最后一句')
    // 马上退出（和 ⌘Q 一样走 app.quit）
    await run.close({ keep: true })
    expect(readFileSync(join(vault, '日记.md'), 'utf8')).toBe('# 日记\n\n今天去了海边。退出前最后一句\n')
    expect(gitStatus(vault)).toBe('')
    expect(lastSubject(vault)).not.toBe('样本')
    expect(readFileSync(join(run.userData, 'quit.log'), 'utf8')).toMatch(/before-quit[\s\S]*存完[\s\S]*提交完[\s\S]*quit/)
  } finally {
    rmSync(dirname(vault), { recursive: true, force: true, maxRetries: 5 })
  }
})

test('关主窗口（软件不退）时刚打的字还没自动保存：先存进文件再关', async () => {
  const run = await launch({ '日记.md': '# 日记\n\n今天去了海边。\n' })
  const { page, vault } = run
  try {
    await openNote(page, '日记')
    await pane(page).locator('.cm-line', { hasText: '今天去了海边。' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type('关窗口前的一句')
    await expect(acts(page).getByTestId('save-state')).toHaveAttribute('data-state', 'dirty')
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close())
    await expect.poll(() => run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(0)
    expect(readFileSync(join(vault, '日记.md'), 'utf8')).toBe('# 日记\n\n今天去了海边。关窗口前的一句\n')
  } finally {
    await run.close()
  }
})

test('文档切成的白板上就地改着一张卡、打的字没存就 ⌘Q：先把卡里的字存进文件、提交，再退出', async () => {
  const run = await launch({ '弹层.md': '# 弹层\n\n## 一\n\n卡一。\n\n## 二\n\n卡二。\n' })
  const { page, vault } = run
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await openNote(page, '弹层')
    await acts(page).getByRole('tab', { name: '白板' }).click()
    // 2026-11-21 起双击字卡就在卡里改（不再弹「全文」改字）
    await pane(page).getByTestId('doc-board').locator('.db-card', { hasText: '卡二' }).dblclick()
    const box = pane(page).getByTestId('doc-board').getByRole('textbox', { name: '卡片内容' })
    await expect(box).toBeFocused()
    await box.press('End')
    await page.keyboard.type('弹层里没存的字')
    await run.close({ keep: true })
    expect(readFileSync(join(vault, '弹层.md'), 'utf8')).toBe('# 弹层\n\n## 一\n\n卡一。\n\n## 二\n\n卡二。弹层里没存的字\n')
    expect(gitStatus(vault)).toBe('')
  } finally {
    rmSync(dirname(vault), { recursive: true, force: true, maxRetries: 5 })
  }
})

test('白板（type: board）的卡正在改字（框还开着）就 ⌘Q：框里的字先存进文件、提交，再退出', async () => {
  // 新写法的白板：空白处一张卡（前面一行位置）
  const BOARD = '---\ntype: board\n---\n<!-- card id=c1 x=80 y=80 -->\n第一张卡\n'
  const run = await launch({ '选题墙.md': BOARD })
  const { page, vault } = run
  try {
    await openNote(page, '选题墙')
    await acts(page).getByRole('tab', { name: '白板' }).click()
    await pane(page).getByTestId('doc-board').locator('.db-card', { hasText: '第一张卡' }).dblclick()
    await expect(pane(page).getByTestId('doc-board').getByRole('textbox', { name: '卡片内容' })).toBeFocused()
    await page.keyboard.press('End')
    await page.keyboard.type('，框里没存')
    await run.close({ keep: true })
    expect(readFileSync(join(vault, '选题墙.md'), 'utf8')).toBe('---\ntype: board\n---\n<!-- card id=c1 x=80 y=80 -->\n第一张卡，框里没存\n')
    expect(gitStatus(vault)).toBe('')
  } finally {
    rmSync(dirname(vault), { recursive: true, force: true, maxRetries: 5 })
  }
})

test('退出途中主进程里的定时器抛错：不弹错误框，照样退出', async () => {
  const run = await launch({ 'a.md': '# a\n' })
  const marker = join(run.userData, 'error-box.txt')
  try {
    await run.app.evaluate(({ app, dialog }, marker) => {
      // Electron 默认遇到没接住的错就弹框；换成记一笔（测试里不在屏幕上弹框），看它弹没弹
      dialog.showErrorBox = (title: string, content: string) => process.getBuiltinModule('node:fs').appendFileSync(marker, `${title}\n${content}\n`)
      // 窗口都关了以后留一个马上到点、会抛错的定时器：它在 Node 收尾时才跑（视频、网页历史的写盘定时器出过这种事）
      app.on('will-quit', () => {
        setTimeout(() => {
          throw new Error('退出途中的错')
        }, 0)
        const end = Date.now() + 50
        while (Date.now() < end) {
          // 等它到点
        }
      })
    }, marker)
    const t = Date.now()
    await run.close({ keep: true })
    expect(Date.now() - t).toBeLessThan(10_000)
    expect(existsSync(marker) ? readFileSync(marker, 'utf8') : '').toBe('')
    expect(readFileSync(join(run.userData, 'quit.log'), 'utf8')).toContain('出错（不弹框）：Error: 退出途中的错')
  } finally {
    rmSync(dirname(run.vault), { recursive: true, force: true, maxRetries: 5 })
  }
})

/** 退出：从叫 app.quit（和 ⌘Q 一样）到进程真的没了，量毫秒 */
async function timedQuit(run: Running): Promise<number> {
  const proc = run.app.process()
  const t = Date.now()
  await run.close({ keep: true })
  const ms = Date.now() - t
  expect(proc.exitCode !== null || proc.signalCode !== null).toBe(true)
  return ms
}

test('退出要快：刚打了字也在 5 秒内存好、提交好、进程退干净', async () => {
  const run = await launch({ '日记.md': '# 日记\n\n今天去了海边。\n' })
  const { page, vault } = run
  try {
    await openNote(page, '日记')
    await pane(page).locator('.cm-line', { hasText: '今天去了海边。' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type('又一句')
    expect(await timedQuit(run)).toBeLessThan(5_000)
    expect(readFileSync(join(vault, '日记.md'), 'utf8')).toBe('# 日记\n\n今天去了海边。又一句\n')
    expect(gitStatus(vault)).toBe('')
  } finally {
    rmSync(dirname(vault), { recursive: true, force: true, maxRetries: 5 })
  }
})

test('标签条「更多」的系统菜单开着时退出：菜单收起，5 秒内退干净，没存的字照样存好、提交好', async () => {
  const run = await launch({ '日记.md': '# 日记\n\n今天去了海边。\n' }, { CN_E2E_REAL_MENUS: '1' })
  const { page, vault, app } = run
  try {
    // 记下系统菜单的弹出、收起（不换掉 popup：菜单是真弹出来的，测试窗口在屏幕外，没人去点它）
    await app.evaluate(({ Menu }) => {
      const g = globalThis as unknown as { cnMenus: string[] }
      g.cnMenus = []
      const popup = Menu.prototype.popup
      Menu.prototype.popup = function (this: Electron.Menu, opts?: Electron.PopupOptions) {
        g.cnMenus.push('弹出')
        this.once('menu-will-close', () => g.cnMenus.push('收起'))
        return popup.call(this, opts)
      }
    })
    await openNote(page, '日记')
    await pane(page).locator('.cm-line', { hasText: '今天去了海边。' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type('菜单开着时打的字')
    await acts(page).getByRole('button', { name: '更多' }).click()
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { cnMenus: string[] }).cnMenus)).toEqual(['弹出'])
    expect(await timedQuit(run)).toBeLessThan(5_000)
    expect(readFileSync(join(run.userData, 'quit.log'), 'utf8')).toMatch(/before-quit[\s\S]*收起菜单[\s\S]*存完[\s\S]*提交完[\s\S]*quit/)
    expect(readFileSync(join(vault, '日记.md'), 'utf8')).toBe('# 日记\n\n今天去了海边。菜单开着时打的字\n')
    expect(gitStatus(vault)).toBe('')
  } finally {
    rmSync(dirname(vault), { recursive: true, force: true, maxRetries: 5 })
  }
})

test('「更多」连点几次、好几个系统菜单套着开着时退出：全都收起，5 秒内退干净', async () => {
  const run = await launch({ '日记.md': '# 日记\n\n今天去了海边。\n' }, { CN_E2E_REAL_MENUS: '1' })
  const { page, vault, app } = run
  try {
    // 数还开着几个系统菜单（真弹出来的；Esc 是发给网页的，收不掉它）
    await app.evaluate(({ Menu }) => {
      const g = globalThis as unknown as { cnOpenMenus: number }
      g.cnOpenMenus = 0
      const popup = Menu.prototype.popup
      Menu.prototype.popup = function (this: Electron.Menu, opts?: Electron.PopupOptions) {
        g.cnOpenMenus++
        this.once('menu-will-close', () => g.cnOpenMenus--)
        return popup.call(this, opts)
      }
    })
    await openNote(page, '日记')
    for (let i = 0; i < 3; i++) {
      await acts(page).getByRole('button', { name: '更多' }).click()
      await page.waitForTimeout(300)
      await page.keyboard.press('Escape')
    }
    // 美学截图脚本每轮都点一次「更多」，一趟下来好几个菜单套在一起；只收最里面那个时退出卡死
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { cnOpenMenus: number }).cnOpenMenus)).toBeGreaterThanOrEqual(2)
    expect(await timedQuit(run)).toBeLessThan(5_000)
    expect(readFileSync(join(run.userData, 'quit.log'), 'utf8')).toMatch(/before-quit[\s\S]*收起菜单 [2-9] 个[\s\S]*存完[\s\S]*提交完[\s\S]*quit/)
    expect(gitStatus(vault)).toBe('')
  } finally {
    rmSync(dirname(vault), { recursive: true, force: true, maxRetries: 5 })
  }
})

test('右键菜单开着时退出（文档里、输入框里各右键一次）：全收起，5 秒内退干净，没存的字照样存好、提交好', async () => {
  const run = await launch({ '日记.md': '# 日记\n\n今天去了海边。\n' }, { CN_E2E_REAL_MENUS: '1' })
  const { page, vault, app } = run
  try {
    // 数还开着几个系统菜单（真弹出来的，测试窗口在屏幕外没人点）
    await app.evaluate(({ Menu }) => {
      const g = globalThis as unknown as { cnOpenMenus: number }
      g.cnOpenMenus = 0
      const popup = Menu.prototype.popup
      Menu.prototype.popup = function (this: Electron.Menu, opts?: Electron.PopupOptions) {
        g.cnOpenMenus++
        this.once('menu-will-close', () => g.cnOpenMenus--)
        return popup.call(this, opts)
      }
    })
    await openNote(page, '日记')
    await pane(page).locator('.cm-line', { hasText: '今天去了海边。' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type('右键菜单开着时打的字')
    // 文档自己的菜单
    await pane(page).locator('.cm-line', { hasText: '今天去了海边。' }).click({ button: 'right' })
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { cnOpenMenus: number }).cnOpenMenus)).toBe(1)
    // 主进程兜底的输入框菜单（属性面板之外的任意输入框：这里用标签条上改名的输入框不方便，直接对 AI 输入框发右键）
    await page.evaluate(() => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="问 AI"]')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
    await page.waitForTimeout(300)
    expect(await timedQuit(run)).toBeLessThan(5_000)
    expect(readFileSync(join(run.userData, 'quit.log'), 'utf8')).toMatch(/before-quit[\s\S]*收起菜单 [1-9] 个[\s\S]*存完[\s\S]*提交完[\s\S]*quit/)
    expect(readFileSync(join(vault, '日记.md'), 'utf8')).toBe('# 日记\n\n今天去了海边。右键菜单开着时打的字\n')
    expect(gitStatus(vault)).toBe('')
  } finally {
    rmSync(dirname(vault), { recursive: true, force: true, maxRetries: 5 })
  }
})

test('7000 篇的大库后台梦游正算「找重复」（要算好几分钟）时退出：5 秒内存好刚打的字、提交好、退干净', async () => {
  test.setTimeout(300_000)
  const run = await launch({ '日记.md': '# 日记\n\n今天去了海边。\n' }, { CN_AI_FAKE: '1' }, (v) => void makeBigVault(v))
  const { page, vault, app } = run
  try {
    await openNote(page, '日记')
    // 闲了 15 分钟自己开始的梦游（用户实测：开着 5 分钟以后 ⌘Q 卡 13–18 分钟）：这里直接叫它开始
    void page.evaluate(() => void window.cn.dreamNow())
    // 等它读完全库、做完前几步，算到「找重复」（以前在主进程里一口气算，主进程整段卡住）
    await expect
      .poll(() => app.evaluate(() => (globalThis as unknown as { cnSimilarRunning?: string[] }).cnSimilarRunning ?? []), { timeout: 180_000, intervals: [500] })
      .toContain('dups')
    // 主进程不卡：这会儿问它一句马上回来
    const t = Date.now()
    await page.evaluate(() => window.cn.dreamReport())
    expect(Date.now() - t).toBeLessThan(1_000)
    await pane(page).locator('.cm-line', { hasText: '今天去了海边。' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type('大库退出前的一句')
    await expect(acts(page).getByTestId('save-state')).toHaveAttribute('data-state', 'dirty')
    const ms = await timedQuit(run)
    console.log(`大库梦游时退出用了 ${ms} ms`)
    expect(ms).toBeLessThan(5_000)
    expect(readFileSync(join(vault, '日记.md'), 'utf8')).toBe('# 日记\n\n今天去了海边。大库退出前的一句\n')
    expect(gitStatus(vault)).toBe('')
    expect(readFileSync(join(run.userData, 'quit.log'), 'utf8')).toMatch(/before-quit[\s\S]*停下找像的笔记 1 个[\s\S]*存完[\s\S]*提交完[\s\S]*quit/)
  } finally {
    rmSync(dirname(vault), { recursive: true, force: true, maxRetries: 5 })
  }
})
