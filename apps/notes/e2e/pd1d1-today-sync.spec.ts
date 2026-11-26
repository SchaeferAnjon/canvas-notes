/**
 * 画布今日也打开同一个库时两边同步（task-pd1d1）：两个软件都用测试模式起（窗口不上屏），同一个临时库。
 * 画布今日里勾掉一条，画布笔记左边待办格、首页卡几秒内跟着变；画布笔记里勾掉、加一条，画布今日几秒内跟着变。
 * 要先在 apps/today 下 electron-vite build（画布今日的 out/），没有就跳过。
 */
import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import electronPath from 'electron'
import { launch, leftView, pane, tabOn } from './app'

const CT_MAIN = join(__dirname, '../../today/out/main/index.js')
const pad = (n: number) => String(n).padStart(2, '0')
const now = new Date()
const T0 = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
/** 画布今日的「现在」跟真的钟走（画布笔记没有拨钟） */
const CT_NOW = `${T0}T${pad(now.getHours())}:${pad(now.getMinutes())}:00`

const VAULT: Record<string, string> = {
  '收件箱/待办.md': `# 待办\n\n- [ ] 回导师邮件 📅 ${T0} 10:30\n- [ ] 取快递 📅 ${T0} 18:00 🔔 准时\n- [ ] 买打印纸\n`,
  '写作/小论文计划.md': `# 小论文计划\n\n- [ ] 读完三篇相关论文 📅 ${T0}\n`,
}

const cell = (page: Page) => page.locator('aside.side[aria-label="待办"]')
const row = (page: Page, folder: string, title: string) => cell(page).locator(`.td-fg[aria-label="${folder}"] .td-r`).filter({ has: page.locator('.td-t', { hasText: new RegExp(`^${title}$`) }) })
const ctRow = (cp: Page, title: string) => cp.locator('.center .row', { hasText: title }).first()

test('画布今日也开着同一个库：那边勾掉，这边三处几秒内跟着变；这边勾掉、加一条，那边几秒内跟着变', async () => {
  test.skip(!existsSync(CT_MAIN), '先在 apps/today 下 electron-vite build')
  const run = await launch(VAULT)
  const { page } = run
  const root = mkdtempSync(join(tmpdir(), 'ct-sync-'))
  // 画布今日 0.3.3 起打开先进「排一天」（设置能关）：这里关掉，照旧从「今天」那一列开始（同画布今日自己 e2e 的 LOOK）
  mkdirSync(join(root, 'ud'), { recursive: true })
  writeFileSync(join(root, 'ud', 'settings.json'), JSON.stringify({ lang: 'zh', followNotes: false, plan: { onOpen: false, tray: true, journal: null } }))
  const ct = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [CT_MAIN],
    env: { ...process.env, CT_E2E: '1', CT_VAULT: run.vault, CT_USER_DATA: join(root, 'ud'), CT_NOTES_DATA: join(root, 'nd'), CT_NOW, CT_DEVICE: 'mac-test', CT_COMMIT_MS: '300' },
  })
  try {
    const cp = await ct.firstWindow()
    await expect(ctRow(cp, '回导师邮件')).toBeVisible()
    await page.getByRole('navigation', { name: '左栏' }).getByRole('button', { name: '写作', exact: true }).click()
    await expect(tabOn(page)).toHaveText('写作')
    await leftView(page, '待办')
    await expect(row(page, '收件箱', '回导师邮件')).toBeVisible()
    await expect(page.getByTestId('todo-count')).toHaveText('3')

    // 画布今日里勾掉「回导师邮件」：画布笔记左边待办格几秒内不再列它，数字少一
    let t0 = Date.now()
    await ctRow(cp, '回导师邮件').locator('button.cb').click()
    await expect.poll(() => readFileSync(join(run.vault, '收件箱/待办.md'), 'utf8')).toContain(`- [x] 回导师邮件 📅 ${T0} 10:30 ✅ ${T0}\n`)
    await expect(row(page, '收件箱', '回导师邮件')).toHaveCount(0, { timeout: 4000 })
    await expect(page.getByTestId('todo-count')).toHaveText('2')
    console.log(`画布今日勾掉到画布笔记跟着变：${Date.now() - t0}ms`)

    // 画布笔记首页卡里勾掉「读完三篇相关论文」：画布今日几秒内把它从「今天」拿掉。
    // 点左边「待办」格时中间开了「待办」标签（待办首页，task-kzr3n），先点回「写作」标签看它的首页卡；左边还是待办格
    await page.getByTestId('tab-list').getByRole('tab', { name: '写作' }).click()
    await expect(tabOn(page)).toHaveText('写作')
    await expect(row(page, '写作', '读完三篇相关论文')).toBeVisible()
    await expect(ctRow(cp, '读完三篇相关论文')).toBeVisible()
    t0 = Date.now()
    await pane(page).getByTestId('todo-card').locator('.td-r', { hasText: '读完三篇相关论文' }).getByRole('checkbox').click()
    // 画布今日勾掉的进「已完成」、不留在「今天」里（2026-11-25 画布今日对标：打勾进已完成，规则和画布笔记同一份）：别处勾掉的几秒内从「今天」拿掉
    await expect(cp.locator('.center .row', { hasText: '读完三篇相关论文' })).toHaveCount(0, { timeout: 4000 })
    expect(readFileSync(join(run.vault, '写作/小论文计划.md'), 'utf8')).toContain('- [x] 读完三篇相关论文')
    console.log(`画布笔记勾掉到画布今日跟着变：${Date.now() - t0}ms`)

    // 画布笔记左边加一条今天的：画布今日的「今天」里几秒内出现
    await cell(page).getByRole('textbox', { name: '加一条' }).click()
    await page.keyboard.type('今天下午五点交实验报告')
    await page.keyboard.press('Enter')
    await expect(ctRow(cp, '交实验报告')).toBeVisible({ timeout: 4000 })
    expect(readFileSync(join(run.vault, '收件箱/待办.md'), 'utf8')).toContain(`- [ ] 交实验报告 📅 ${T0} 17:00\n`)
  } finally {
    await ct.close()
    rmSync(root, { recursive: true, force: true, maxRetries: 5 })
    await run.close()
  }
})
