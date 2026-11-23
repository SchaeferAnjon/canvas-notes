/**
 * 自动化周记的对照截图（task-i921u，和原型 14-数据库第三批/automations/proto.html#scene=weekly 里打开那一篇对照）：
 * 深链跑「周记」（假 AI、钟拨到 2026-11-22 14:02，标题 2026-W47），在软件里打开那一篇截整个窗口。
 * B 浮岛书桌、天青 / 深湖。只在截交付图时跑：CN_SHOTS=目录 [CN_SHOT_TONE=dark]。
 */
import { expect, test } from '@playwright/test'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, openNote, pane } from './app'

const DIR = process.env.CN_SHOTS
const DARK = process.env.CN_SHOT_TONE === 'dark'
const TONE = DARK ? 'dark' : 'light'
test.skip(!DIR, '只在截交付图时跑（CN_SHOTS=目录）')

const skin = (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: DARK ? 'petrol' : 'sky', frame: 'b', winBg: 'aurora' } }))
}

test('周记那一篇对照截图', async () => {
  mkdirSync(DIR!, { recursive: true })
  const files = {
    '生活/2026 记账.md': '# 2026 记账\n\n这个月新记了 15 笔。\n',
    '课程/第3讲 生产.md': '# 第3讲 生产\n\n边际产量先升后降。\n\n- [x] 交小论文提纲 ✅ 2026-11-20\n',
    '写作/小论文计划.md': '# 小论文计划\n\n## 研究问题\n\n为什么边际产量会下降。\n',
  }
  const run = await launch(files, { CN_AI_FAKE: '1', CN_AUTO_NOW: '2026-11-22T14:02:00' }, skin)
  const { page, vault, app } = run
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 887))
    await app.evaluate(({ app: a }) => a.emit('open-url', { preventDefault() {} }, 'canvas-notes://automation/run?name=%E5%91%A8%E8%AE%B0'))
    await expect.poll(() => existsSync(join(vault, '周记/2026-W47.md')), { timeout: 40_000 }).toBe(true)
    await expect.poll(() => existsSync(join(vault, '周记/待办.md')), { timeout: 40_000 }).toBe(true)
    await page.waitForTimeout(1500)
    await openNote(page, '2026-W47')
    await expect(pane(page).locator('.cm-content')).toContainText('AI 本周摘要')
    await page.waitForTimeout(800)
    await page.screenshot({ path: join(DIR!, `app-周记-${TONE}.png`) })
  } finally {
    await run.close()
  }
})
