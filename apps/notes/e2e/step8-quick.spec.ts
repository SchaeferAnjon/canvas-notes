import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BRAND } from '../src/shared/brand'
import { gitStatus, launch } from './app'

const lastSubject = (vault: string) => execFileSync('git', ['-C', vault, 'log', '-1', '--format=%s'], { encoding: 'utf8' }).trim()

type QuickHook = { show(): Promise<void>; menu: Electron.Menu; registered: boolean }

/** 速记框（测试从菜单栏菜单的「速记」那一项打开，不按真的全局快捷键） */
async function openQuick(app: ElectronApplication): Promise<Page> {
  const existing = app.windows().find((w) => w.url().endsWith('/quick.html'))
  if (existing) {
    await app.evaluate(() => (globalThis as unknown as { cnQuick: QuickHook }).cnQuick.menu.items[0]!.click())
    return existing
  }
  const [w] = await Promise.all([app.waitForEvent('window'), app.evaluate(() => (globalThis as unknown as { cnQuick: QuickHook }).cnQuick.menu.items[0]!.click())])
  await w.waitForLoadState()
  return w
}

const quickVisible = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('/quick.html'))?.isVisible() ?? false)

test('全局速记：快捷键注册上了，菜单栏有入口；回车进收件箱并提交；esc 取消；没辅助功能权限时只给提示', async () => {
  const run = await launch({ 'a.md': 'a\n' })
  const { app, page, vault } = run
  try {
    expect(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Alt+Command+Shift+F19'))).toBe(true)
    const labels = await app.evaluate(() => (globalThis as unknown as { cnQuick: QuickHook }).cnQuick.menu.items.map((i) => i.label))
    expect(labels).toEqual(['速记', `打开 ${BRAND.name}`, '现在梦游', '', '退出'])

    const quick = await openQuick(app)
    await expect.poll(() => quickVisible(app)).toBe(true)
    const box = quick.getByRole('textbox', { name: '速记内容' })
    await expect(box).toBeFocused()
    await expect(quick.getByTestId('quick-hint')).toContainText('允许「辅助功能」后')
    await expect(quick.getByTestId('quick-selection')).toHaveCount(0)
    await quick.screenshot({ path: test.info().outputPath('quick.png') })

    await box.pressSequentially('明天先订 2.27 的住处')
    await box.press('Shift+Enter')
    await box.pressSequentially('再订车')
    await box.press('Enter')
    await expect.poll(() => quickVisible(app)).toBe(false)
    const files = readdirSync(join(vault, '收件箱'))
    expect(files).toEqual(['明天先订 2.27 的住处.md'])
    expect(readFileSync(join(vault, '收件箱', files[0]!), 'utf8')).toMatch(/^---\ncreated: \d{4}-\d\d-\d\d \d\d:\d\d\n---\n明天先订 2\.27 的住处\n再订车\n$/)
    expect(lastSubject(vault)).toBe('速记：明天先订 2.27 的住处')
    expect(gitStatus(vault)).toBe('')
    // 主窗口左栏收件箱数字跟着变
    await expect(page.getByTestId('inbox-count')).toHaveText('1')

    // 再弹一次：框是空的；esc 取消，什么都不存
    await openQuick(app)
    await expect.poll(() => quickVisible(app)).toBe(true)
    await expect(box).toHaveValue('')
    await box.pressSequentially('不要了')
    await box.press('Escape')
    await expect.poll(() => quickVisible(app)).toBe(false)
    expect(readdirSync(join(vault, '收件箱'))).toHaveLength(1)

    // 「不用了」：以后不再提示去开权限（记在设置里）
    await openQuick(app)
    await quick.getByTestId('quick-hint').getByRole('button', { name: '不用了' }).click()
    await expect(quick.getByTestId('quick-hint')).toHaveCount(0)
    expect(JSON.parse(readFileSync(join(run.userData, 'settings.json'), 'utf8')).quickHint).toBe(false)
    await box.press('Escape')
    await openQuick(app)
    await expect(quick.getByTestId('quick-hint')).toHaveCount(0)
    await box.press('Escape')
  } finally {
    await run.close()
  }
})

