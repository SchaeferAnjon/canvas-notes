/**
 * 打好的 Canvas Notes.app 冒烟（发版时跑，同画布今日 t8-packaged）：CN_APP=<…/Canvas Notes.app> npx playwright test e2e/packaged-smoke.spec.ts
 * 测试模式（窗口不上屏）起包里的那一份：库读得出、打字存盘写进文件、开读 PDF 画得出第一页、⌘, 开设置、关于里的版本是 package.json 的版本。
 */
import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openNote, pane } from './app'
import { LECTURE } from './fixtures/pdf'

const APP = process.env.CN_APP
test.skip(!APP, '只在给了 CN_APP=<打好的 .app> 时跑')

test('打好的 .app：起得来、打字存盘、开读 PDF、开设置、版本对', async () => {
  test.setTimeout(120_000)
  const root = mkdtempSync(join(tmpdir(), 'cn-packaged-'))
  const vault = join(root, '测试库')
  const trash = join(root, 'trash')
  mkdirSync(trash)
  mkdirSync(join(vault, '课程'), { recursive: true })
  writeFileSync(join(vault, '随手.md'), '# 随手\n\n第一段。\n')
  writeFileSync(join(vault, '课程/第3讲.pdf'), LECTURE)
  const git = (...a: string[]) => execFileSync('git', ['-C', vault, ...a])
  execFileSync('git', ['init', '-q', '-b', 'main', vault])
  git('config', 'user.name', 'Test')
  git('config', 'user.email', 'test@example.com')
  git('add', '-A')
  git('commit', '-q', '-m', '样本')

  const app = await electron.launch({
    executablePath: join(APP!, 'Contents/MacOS/Canvas Notes'),
    env: {
      ...process.env,
      CN_VAULT: vault,
      CN_USER_DATA: join(root, 'user-data'),
      CN_E2E: '1',
      CN_NO_AX: '1',
      CN_QUICK_KEY: 'Alt+Command+Shift+F19',
      CN_TRASH_DIR: trash,
      CN_ICLOUD_CONTAINER: join(root, 'icloud'),
    },
  })
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.vault b')).toHaveText('测试库')
    const want = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8')).version
    expect(await app.evaluate(({ app }) => app.getVersion())).toBe(want)
    expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true)

    // 打字存盘
    await openNote(page, '随手')
    await expect(pane(page).locator('.cm-content')).toContainText('第一段。')
    await pane(page).locator('.cm-line', { hasText: '第一段。' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type('包里打的字')
    await expect.poll(() => readFileSync(join(vault, '随手.md'), 'utf8'), { timeout: 15_000 }).toBe('# 随手\n\n第一段。包里打的字\n')

    // 开读 PDF
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
    await page.locator('.pal-row', { hasText: '第3讲' }).first().click()
    await expect(page.locator('.pdfpane:not([hidden]) .pdfpage[data-page="1"] canvas[data-ready="1"]')).toBeAttached({ timeout: 20_000 })

    // 开设置
    await page.keyboard.press('Meta+Comma')
    const set = page.getByRole('dialog', { name: '设置' })
    await expect(set).toBeVisible()
    await set.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: '外观', exact: true }).click()
    await expect(set.getByText('主题').first()).toBeVisible()
    if (process.env.CN_SHOTS) await page.screenshot({ path: join(process.env.CN_SHOTS, 'packaged-settings.png') })
    await page.keyboard.press('Escape')
    await expect(set).toHaveCount(0)
  } finally {
    await app.close()
  }
})
