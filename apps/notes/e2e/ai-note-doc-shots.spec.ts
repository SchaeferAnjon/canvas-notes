/**
 * AI 对话记笔记开关（2026-11-24 方向 A）别处的 AI 对话那一半的截图：和设计页 85-AI对话记笔记开关 的 p-doc-backfill、p-none、p-more 同一个状态，
 * 另截「记进哪篇」看文档的菜单、找一篇、已记进 · 撤回。窗口 1240×800（设计图的大小）。
 * 平时跳过：CN_SHOTS_DIR=<目录> [CN_SHOT_TONE=dark] npx playwright test e2e/ai-note-doc-shots.spec.ts
 */
import { expect, type Locator, type Page, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, openAi, openNote, type Running } from './app'

const SHOTS = process.env.CN_SHOTS_DIR
const TONE = process.env.CN_SHOT_TONE === 'dark' ? 'dark' : 'light'
const W = 1240
const H = 800
test.skip(!SHOTS, '截图才跑：CN_SHOTS_DIR=<目录>')

const files = {
  '读书/第 6 章 读书笔记.md': '# 第 6 章 读书笔记\n\n## 汇聚层\n\n汇聚层就是把图缩小，让后面算得快。\n\n最大汇聚取一小块里最大的那个数。\n\n## LeNet\n\n两层卷积加三层全连接。\n',
  '周记.md': '# 周记\n\n这周读了 ECP。\n',
}
const look = (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: TONE === 'dark' ? 'petrol' : 'sky', frame: 'b', winBg: 'aurora' } }))
}
const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
async function shot(run: Running, name: string) {
  await run.page.waitForTimeout(400)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(SHOTS!, `${name}-${TONE}.png`), Buffer.from(b64, 'base64'))
}
async function ask(page: Page, q: string): Promise<Locator> {
  const msgs = chat(page).getByTestId('ai-msg')
  const n = await msgs.count()
  const box = chat(page).getByRole('textbox', { name: '问 AI' })
  await box.fill(q)
  await box.press('Enter')
  await expect(msgs.nth(n).locator('.txt')).toContainText('这是测试回答', { timeout: 15_000 })
  await expect(chat(page).getByRole('button', { name: '发送' })).toBeVisible()
  return msgs.nth(n)
}

test(`截图（${TONE}）：看文档补进去、记进哪篇、⋯ 记进、没开东西先问`, async () => {
  test.setTimeout(240_000)
  mkdirSync(SHOTS!, { recursive: true })
  const run = await launch(files, { CN_AI_FAKE: '1' }, look)
  const { page, app } = run
  try {
    await app.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0]!.setSize(s.W, s.H), { W, H })
    // 没开东西：首页问一句，拨开「记笔记」先问记进哪篇
    await openAi(page)
    await ask(page, '帮我想想下周组会讲什么')
    await chat(page).getByTestId('ai-note-main').click()
    await expect(page.getByTestId('ai-note-menu')).toBeVisible()
    await shot(run, 'b1-没开东西-先问记进哪篇')
    await page.getByTestId('ai-note-to-find').click()
    await page.getByTestId('ai-note-menu').getByRole('textbox', { name: '找一篇' }).fill('周')
    await shot(run, 'b2-没开东西-找一篇')
    await page.keyboard.press('Escape')

    // 看文档：问两句（关着），拨开 → 前面 2 问没记
    await openNote(page, '第 6 章 读书笔记')
    await ask(page, '我这段对汇聚层的理解对吗？')
    const a2 = await ask(page, '帮我补一句总结')
    await chat(page).getByTestId('ai-note-main').click()
    await expect(chat(page).getByTestId('ai-note-tip')).toContainText('前面 2 问没记')
    await shot(run, 'b3-看文档-补进去')
    await chat(page).getByTestId('ai-note-tip').getByRole('button', { name: '补进去' }).click()
    await expect(a2.getByTestId('ai-noted')).toHaveAttribute('data-state', 'done', { timeout: 15_000 })
    await shot(run, 'b4-看文档-已记进')
    await chat(page).getByTestId('ai-note-target').click()
    await expect(page.getByTestId('ai-note-menu')).toBeVisible()
    await shot(run, 'b5-看文档-记进哪篇')
    await page.keyboard.press('Escape')
    // 关掉再问一句，⋯ 里「记进《…》」
    await chat(page).getByTestId('ai-note-main').click()
    const a3 = await ask(page, '还缺什么？')
    await a3.hover()
    await a3.getByRole('button', { name: '这条回答还能做什么' }).click()
    await expect(page.getByRole('menu', { name: '这条回答还能做什么' })).toBeVisible()
    await shot(run, 'b6-看文档-更多里记进')
  } finally {
    await run.close()
  }
})
