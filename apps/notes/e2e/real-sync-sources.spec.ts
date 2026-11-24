/**
 * 真接一次 Get笔记（同步来源，设计页 61）：只在给了 CN_REAL_VAULT（用户库的一份临时副本，不是真库）和 GETNOTE_API_KEY、GETNOTE_CLIENT_ID 时跑。
 * 真点：设置 › 库 › 接一个… › Get笔记，填 Key 连上，对话框照默认勾（比库里最新那篇还新的），拉；再点「现在拉一次」应该没有新的。
 * 只读 Get笔记（列表、详情、下图）。Key 只从环境变量读，打进输入框，不写进任何文件。CN_SHOTS 给了时截几张图。
 */
import { _electron as electron, expect, type Page, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import electronPath from 'electron'
import { openNote, pane } from './app'

const vault = process.env.CN_REAL_VAULT
const key = process.env.GETNOTE_API_KEY
const client = process.env.GETNOTE_CLIENT_ID
const shots = process.env.CN_SHOTS
const dlg = (page: Page) => page.getByRole('dialog', { name: '设置' })

test('真接一次 Get笔记，拉进用户库的临时副本', async () => {
  test.skip(!vault || !key || !client, '只在给了 CN_REAL_VAULT、GETNOTE_API_KEY、GETNOTE_CLIENT_ID 时跑')
  test.setTimeout(15 * 60_000)
  const userData = mkdtempSync(join(tmpdir(), 'cn-real-src-'))
  const env = { ...process.env }
  delete env.GETNOTE_API_KEY
  delete env.GETNOTE_CLIENT_ID
  const app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [join(__dirname, '../out/main/index.js')],
    env: { ...env, CN_VAULT: vault!, CN_USER_DATA: userData, CN_E2E: '1', CN_NO_AX: '1', CN_QUICK_KEY: 'Alt+Command+Shift+F19' } as Record<string, string>,
  })
  const page = await app.firstWindow()
  const shot = async (name: string) => shots && page.screenshot({ path: join(shots, `real-${name}.png`) })
  try {
    await page.setViewportSize({ width: 1440, height: 887 })
    await page.locator('.vault b').waitFor({ timeout: 60_000 })
    await page.keyboard.press('Meta+Comma')
    await dlg(page).getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: '库', exact: true }).click()
    await dlg(page).getByRole('button', { name: '接一个…' }).click()
    const item = dlg(page).getByRole('menuitem', { name: /Get笔记/ })
    console.log('[真接] 小菜单：', (await item.innerText()).replace(/\n/g, ' · '))
    await shot('1-接一个')
    await item.click()
    await dlg(page).getByLabel('API Key', { exact: true }).fill(key!)
    await dlg(page).getByLabel('Client ID', { exact: true }).fill(client!)
    const t0 = Date.now()
    await dlg(page).getByRole('button', { name: '连上' }).click()
    const first = page.getByRole('dialog', { name: /连上了/ })
    await first.waitFor({ timeout: 5 * 60_000 })
    console.log(`[真接] 连上（翻完列表）用了 ${((Date.now() - t0) / 1000).toFixed(1)} 秒`)
    console.log('[真接] 对话框：', (await first.innerText()).replace(/\n+/g, ' | '))
    await first.getByRole('button', { name: '展开勾几篇' }).click()
    await shot('2-第一次连上')
    const btn = first.getByRole('button', { name: /^拉\d+篇$/ })
    console.log('[真接] 按钮：', await btn.innerText())
    const t1 = Date.now()
    await btn.click()
    await first.waitFor({ state: 'detached', timeout: 12 * 60_000 })
    console.log(`[真接] 拉完用了 ${((Date.now() - t1) / 1000).toFixed(1)} 秒`)
    const row = dlg(page).locator('[data-row^="sourceRun-"]').first()
    await row.waitFor()
    console.log('[真接] 拉取记录：', (await row.innerText()).replace(/\n+/g, ' | '))
    console.log('[真接] 提示条：', await dlg(page).getByTestId('settings-toast').innerText().catch(() => ''))
    await shot('3-拉完')
    await dlg(page).getByRole('button', { name: '现在拉一次' }).last().click()
    await expect(dlg(page).getByTestId('settings-toast')).toContainText('没有新的', { timeout: 3 * 60_000 })
    console.log('[真接] 再拉一次：', await dlg(page).getByTestId('settings-toast').innerText())
  } finally {
    await app.close()
  }
})

test('真拉进来的笔记在画布笔记里打开的样子（截图）', async () => {
  test.skip(!vault || !shots, '只在给了 CN_REAL_VAULT、CN_SHOTS 时截')
  test.setTimeout(5 * 60_000)
  const app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [join(__dirname, '../out/main/index.js')],
    env: { ...process.env, CN_VAULT: vault!, CN_USER_DATA: mkdtempSync(join(tmpdir(), 'cn-real-src-')), CN_E2E: '1', CN_NO_AX: '1', CN_QUICK_KEY: 'Alt+Command+Shift+F19' } as Record<string, string>,
  })
  const page = await app.firstWindow()
  try {
    await page.setViewportSize({ width: 1440, height: 887 })
    await page.locator('.vault b').waitFor({ timeout: 60_000 })
    for (const [title, name] of [
      ['十年老 Kindle 越狱复活：装微信读书插件后，显示效果仍胜过专用阅读器', 'kindle'],
      ['对人骨的疑问', 'bone'],
    ] as const) {
      await openNote(page, title)
      await page.waitForTimeout(800)
      await page.screenshot({ path: join(shots!, `real-note-${name}-top.png`) })
      await pane(page).locator('.cm-scroller').evaluate((e) => (e.scrollTop = e.scrollHeight))
      await page.waitForTimeout(500)
      await page.screenshot({ path: join(shots!, `real-note-${name}-end.png`) })
    }
  } finally {
    await app.close()
  }
})
