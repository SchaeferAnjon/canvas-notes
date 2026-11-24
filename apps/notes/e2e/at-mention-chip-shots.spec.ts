/**
 * 交付图（@文档胶囊）：@ 候选、输入框里的胶囊、发出去的那条里的胶囊。
 * 只在截交付图时跑：CN_SHOTS=目录，CN_SHOT_SKIN=mint|petrol（默认薄荷，B 浮岛书桌）。平时跳过。
 */
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, openNote, tabOn, type Running } from './app'

const DIR = process.env.CN_SHOTS
const SKIN = process.env.CN_SHOT_SKIN ?? 'mint'
test.skip(!DIR, '只在截交付图时跑（CN_SHOTS=目录）')

const files = {
  '课程/study project 2/情绪识别调研.md': '# 情绪识别调研\n\n面部表情、语音、生理信号三条路。\n',
  '课程/study project 2/情绪识别实验记录.md': '# 情绪识别实验记录\n\n第一次跑 FER2013。\n',
  '读书/情绪的发明.pdf': '%PDF-1.4\n%%EOF\n',
  '写作/组会准备.md': '# 组会准备\n\n下周讲 LIF 神经元。\n',
}

const look = (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: SKIN, frame: 'b' } }))
}
const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })

async function shot(run: Running, name: string) {
  await run.page.waitForTimeout(400)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(DIR!, `${name}-${SKIN}.png`), Buffer.from(b64, 'base64'))
}

test('@ 候选 → Tab 选上成胶囊 → 发出去那条里也是胶囊', async () => {
  test.setTimeout(120_000)
  mkdirSync(DIR!, { recursive: true })
  const run = await launch(files, { CN_AI_FAKE: '1' }, look)
  const { page, app } = run
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900))
    await openNote(page, '组会准备')
    await expect(tabOn(page)).toHaveText('组会准备')
    await page.keyboard.press('Meta+j')
    const box = chat(page).getByRole('textbox', { name: '问 AI' })
    await box.click()
    await page.keyboard.type('对比一下 @情绪')
    await expect(chat(page).getByRole('listbox', { name: '引用笔记' }).getByRole('option')).toHaveCount(3)
    await shot(run, '1-候选')
    await page.keyboard.press('Tab')
    await page.keyboard.type('和 @情绪的')
    await page.keyboard.press('Tab')
    await page.keyboard.type('讲的情绪理论，哪里对得上')
    await expect(chat(page).getByTestId('mention-in')).toHaveCount(2)
    await shot(run, '2-输入框里的胶囊')
    await chat(page).getByTestId('mention-in').first().hover()
    await page.waitForTimeout(700)
    await shot(run, '3-悬停看路径')
    await page.keyboard.press('Enter')
    await expect(chat(page).getByTestId('ai-msg').last().locator('.txt')).toHaveText('这是测试回答（Claude Code）。', { timeout: 15_000 })
    await page.mouse.move(10, 10)
    await shot(run, '4-发出去的消息里的胶囊')
  } finally {
    await run.close()
  }
})
