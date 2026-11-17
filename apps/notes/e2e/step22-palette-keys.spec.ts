// ⌘K 搜索框的两个组合键（录屏 ① CN-41）：打完字直接 ⌘↵ 在右栏网页里搜、⌥↵ 让 Claude 找，不用先上下键选；搜得到笔记时也一样。
// 不真的去 Google：persist:web 分区里拦下发往 google.com 的请求，只看右栏网页开的是哪个网址。
import { expect, test, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, type Running } from './app'

const pal = (page: Page) => page.getByRole('dialog', { name: '搜索和命令' })
const box = (page: Page) => pal(page).getByRole('textbox', { name: '搜索笔记、输入网址或命令' })
const web = (page: Page) => page.getByRole('complementary', { name: '网页' })

async function blockGoogle(run: Running) {
  await run.app.evaluate(({ session }) => {
    session.fromPartition('persist:web').webRequest.onBeforeRequest({ urls: ['*://*.google.com/*'] }, (_d, cb) => cb({ cancel: true }))
  })
}

async function shot(run: Running, name: string) {
  const dir = process.env.CN_SHOTS
  if (!dir) return
  await run.page.waitForTimeout(250)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(dir, `${name}.png`), Buffer.from(b64, 'base64'))
}

test('⌘↵ 在右栏网页里搜、⌥↵ 让 Claude 找；两行写着键帽，底栏写着这两个键；库里搜得到时照样有效；像网址时 ⌘↵ 直接打开', async () => {
  const run = await launch({ '旅行/冰岛.md': '# 冰岛\n\n自驾环岛，看极光。\n', '杂记.md': '# 杂记\n\n小布什的回忆录。\n' }, { CN_AI_FAKE: '1', CN_FAKE_FIND_MS: '600' })
  const { page } = run
  try {
    await blockGoogle(run)
    // ---- 库里没有的词：⌘↵ ----
    await page.keyboard.press('Meta+k')
    await box(page).fill('老布什')
    const webRow = pal(page).getByRole('option').filter({ hasText: '在右栏网页里搜' })
    await expect(webRow).toContainText('google.com/search?q=老布什')
    await expect(webRow.locator('kbd')).toHaveText('⌘↵')
    await expect(pal(page).getByRole('option').filter({ hasText: '让Claude帮我找「老布什」' }).locator('kbd')).toHaveText('⌥↵')
    await expect(pal(page).getByLabel('快捷键')).toHaveText('↑↓ 选择 · ↵ 打开 · ⌘↵ 网页搜 · ⌥↵ 让Claude找 · esc 关闭')
    // 选中的不是网页那一行（第一行是「笔记和 PDF 里都没有」之后的网页行；先往下挪到 Claude 那行再按，证明不看选中哪行）
    await box(page).press('ArrowDown')
    await shot(run, 'palette-keys')
    await box(page).press('Meta+Enter')
    await expect(pal(page)).toHaveCount(0)
    await expect(web(page)).toBeVisible()
    await expect(web(page).getByRole('textbox', { name: '网址' })).toHaveValue(/google\.com\/search\?q=(%E8%80%81%E5%B8%83%E4%BB%80|老布什)/)

    // ---- 库里搜得到的词：回车开笔记，⌘↵ 还是去网页搜 ----
    await page.keyboard.press('Meta+k')
    await box(page).fill('小布什')
    await expect(pal(page).getByRole('option').filter({ hasText: '杂记' }).first()).toBeVisible()
    await box(page).press('Meta+Enter')
    await expect(pal(page)).toHaveCount(0)
    await expect(web(page).getByRole('textbox', { name: '网址' })).toHaveValue(/q=(%E5%B0%8F%E5%B8%83%E4%BB%80|小布什)/)
    await expect(page.locator('.center .tabs .tab.on')).not.toContainText('杂记')

    // ---- ⌥↵：Claude 那一行开始找（假引擎），搜得到笔记时也行 ----
    await page.keyboard.press('Meta+k')
    await box(page).fill('冰岛')
    await expect(pal(page).getByRole('option').filter({ hasText: '冰岛' }).first()).toBeVisible()
    await box(page).press('Alt+Enter')
    await expect(pal(page).getByRole('option').filter({ hasText: 'Claude在翻文件…' })).toBeVisible()
    await expect(pal(page).locator('.pal-g', { hasText: 'Claude找到的' })).toBeVisible({ timeout: 10_000 })
    await page.keyboard.press('Escape')

    // ---- 像网址：⌘↵ 直接打开这个网址 ----
    await page.keyboard.press('Meta+k')
    await box(page).fill('www.google.com/maps')
    await expect(pal(page).getByRole('option').filter({ hasText: '在右栏网页里打开' })).toContainText('google.com/maps')
    await box(page).press('Meta+Enter')
    await expect(web(page).getByRole('textbox', { name: '网址' })).toHaveValue(/^(https:\/\/)?www\.google\.com\/maps$/)
  } finally {
    await run.close()
  }
})
