/**
 * ⌘K 打「拍一张导图」回车，拍照窗口马上开（task-wuv05 合进 dev 后 step13 一条过一条挂的根因）：
 * 回车要等「笔记和PDF里的字」回来才走；「PDF 里的字」在搜索进程里排在本机向量模型载入后面，
 * 刚启动、机器忙时模型要载十几秒，回车就一直排着，窗口 5 秒内开不出来。
 * 这里让搜索进程每次都晚 15 秒回（CN_E2E_SLOW_SEARCH_MS），回车照样 3 秒内开窗口。
 */
import { expect, test } from '@playwright/test'
import { launch } from './app'

test('搜索进程回得慢（刚启动、载模型）：⌘K「拍一张导图」回车马上开拍照窗口，不等 PDF 里的字', async () => {
  const run = await launch({ '写作/读书笔记.md': '# 读书笔记\n' }, { CN_E2E_SLOW_SEARCH_MS: '15000' })
  const { page } = run
  try {
    await page.keyboard.press('Meta+k')
    const pal = page.getByRole('dialog', { name: '搜索和命令' })
    await pal.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('拍一张导图')
    await expect(pal.locator('.pal-row.on .nm')).toHaveText('拍一张导图')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', { name: '拍一张导图' })).toBeVisible({ timeout: 3000 })
    await expect(pal).toHaveCount(0)
  } finally {
    await run.close()
  }
})
