/**
 * 用真的 Claude Code 认一张手写导图照片，走一遍拍照窗口 → 核对 → 做成白板导图。
 * 会联网、花一点 Claude 额度，平时跳过；要跑：CN_REAL_AI=1 npx playwright test e2e/real-mindmap.spec.ts
 * 模型用 CN_MAP_MODEL（这里默认 haiku，便宜）；CN_SHOTS_DIR=<文件夹> 时存截图。
 */
import { expect, test } from '@playwright/test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, pane } from './app'

test.skip(process.env.CN_REAL_AI !== '1', '要真的 AI 和网络：CN_REAL_AI=1 才跑')
test.setTimeout(240_000)

test('真的认：拖进一张照片，认出大纲，放上白板', async () => {
  const run = await launch({ '课程/线性代数/第3讲.md': '# 第3讲\n' }, { CN_MAP_MODEL: process.env.CN_MAP_MODEL || 'haiku' })
  const { page, vault } = run
  try {
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('拍一张导图')
    await page.keyboard.press('Enter')
    const sheet = page.getByRole('dialog', { name: /拍一张导图|核对认出来的/ })
    const b64 = readFileSync(join(__dirname, 'fixtures/handwritten-map.jpg')).toString('base64')
    await sheet.evaluate((el, b64) => {
      const dt = new DataTransfer()
      dt.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], 'IMG_2041.jpg', { type: 'image/jpeg' }))
      for (const t of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }))
    }, b64)
    await sheet.getByRole('button', { name: '用这张' }).click()
    const t = Date.now()
    await expect(sheet.locator('.mm-rows .or').nth(9)).toBeVisible({ timeout: 180_000 })
    console.log(`认了 ${((Date.now() - t) / 1000).toFixed(1)} 秒，${await sheet.locator('.mm-rows .or').count()} 个节点：`, await sheet.locator('.mm-ft .help').textContent())
    if (process.env.CN_SHOTS_DIR) await page.screenshot({ path: join(process.env.CN_SHOTS_DIR, 'real-check-light.png') })
    await sheet.getByRole('button', { name: '做成白板导图' }).click()
    await expect(pane(page).getByTestId('map-pill')).toContainText(/做好了|放好了/, { timeout: 15_000 })
    if (process.env.CN_SHOTS_DIR) await page.screenshot({ path: join(process.env.CN_SHOTS_DIR, 'real-map-light.png') })
    const [md] = readdirSync(join(vault, '收件箱'))
    console.log(readFileSync(join(vault, '收件箱', md!), 'utf8'))
  } finally {
    await run.close()
  }
})
