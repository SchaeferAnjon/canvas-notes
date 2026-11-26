/**
 * 交付图（AI 对话绑页面，design/ai-bind-page/）：对话菜单按页归组、「全部对话」、换页时头上「这页有 N 段对话 · 打开 ⌥⌘J」。
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
  '学习笔记.md': '# 学习笔记\n\n动手学深度学习，先读 6.1.2。\n',
  '课程/study project 2/情绪识别调研.md': '# 情绪识别调研\n\n面部表情、语音、生理信号三条路。\n',
  '课程/线性代数/第3讲 笔记.md': '# 第3讲 笔记\n\n线性映射和矩阵。\n',
  '写作/组会准备.md': '# 组会准备\n\n下周讲 LIF 神经元。\n',
}

const look = (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: SKIN, frame: 'b' } }))
}
const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const away = (page: Page) => chat(page).getByTestId('ai-away')

async function shot(run: Running, name: string) {
  await run.page.waitForTimeout(400)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(DIR!, `${name}-${SKIN}.png`), Buffer.from(b64, 'base64'))
}

async function go(page: Page, title: string) {
  await openNote(page, title)
  await expect(tabOn(page)).toHaveText(title)
}

async function ask(page: Page, text: string) {
  const box = chat(page).getByRole('textbox', { name: '问 AI' })
  await box.fill(text)
  await box.press('Enter')
  await expect(chat(page).getByTestId('ai-msg').last().locator('.txt')).toHaveText('这是测试回答（Claude Code）。', { timeout: 15_000 })
}

test('对话菜单「这里」/「最近在别处问的」展开一页、「全部对话」按文件夹归组和搜、换页头上「这页有 3 段对话 · 打开」', async () => {
  test.setTimeout(240_000)
  mkdirSync(DIR!, { recursive: true })
  const run = await launch(files, { CN_AI_FAKE: '1' }, look)
  const { page, app } = run
  const menu = page.getByRole('menu', { name: '对话' })
  const plus = () => chat(page).getByRole('button', { name: '新对话' }).click()
  const follow = () => away(page).getByTestId('ai-follow').click()
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900))
    // 情绪识别调研三段
    await go(page, '情绪识别调研')
    await page.keyboard.press('Meta+j')
    await ask(page, '面部表情识别有哪些公开数据集')
    await plus()
    await ask(page, '语音情绪识别用什么特征')
    await plus()
    await ask(page, '生理信号的采集设备怎么选')
    // 组会准备、第3讲 笔记各一段
    await go(page, '组会准备')
    await follow()
    await ask(page, 'LIF 神经元怎么讲清楚')
    await go(page, '第3讲 笔记')
    await follow()
    await ask(page, '线性映射和矩阵是什么关系')
    // 学习笔记两段：现在看着第二段
    await go(page, '学习笔记')
    await follow()
    await ask(page, '卷积核为什么是奇数')
    await plus()
    await ask(page, '多层感知机为什么不行')

    // 1. 对话菜单：「这里」两段，「最近在别处问的」三页，展开情绪识别调研
    await chat(page).getByTestId('ai-conv').click()
    await expect(menu.locator('.mh')).toHaveText(['这里', '最近在别处问的'])
    await expect(menu.getByTestId('ai-page').locator('.lb')).toHaveText(['第3讲 笔记', '组会准备', '情绪识别调研'])
    await menu.getByRole('button', { name: '展开《情绪识别调研》的几段' }).click()
    await expect(menu.locator('.it.nest')).toHaveCount(3)
    await page.mouse.move(10, 890)
    await shot(run, '1-对话菜单')

    // 2. 全部对话：按文件夹归组，再搜「怎么」（两页各一段）
    await menu.getByRole('menuitem', { name: '全部对话…' }).click()
    await expect(menu.locator('.gh')).toHaveCount(4)
    await shot(run, '2-全部对话')
    await menu.getByRole('searchbox', { name: '搜对话' }).fill('怎么')
    await expect(menu.getByTestId('ai-all-row').locator('.lb')).toHaveText(['LIF 神经元怎么讲清楚', '生理信号的采集设备怎么选'])
    await shot(run, '3-全部对话-搜怎么')
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()

    // 3. 正聊着学习笔记那段，换到情绪识别调研：右栏不换走，头上「这页有 3 段对话 · 打开 ⌥⌘J」
    await go(page, '情绪识别调研')
    await expect(chat(page).getByTestId('ai-conv')).toHaveText('学习笔记')
    await expect(away(page)).toHaveText('这是在《学习笔记》问的这页有 3 段对话 · 打开⌥⌘J')
    await shot(run, '4-换页顶条')
    // 真点「打开」：切到这页最近那段
    await follow()
    await expect(chat(page).getByTestId('ai-conv')).toHaveText('情绪识别调研')
    await expect(chat(page).locator('.um')).toHaveText(['生理信号的采集设备怎么选'])
    await shot(run, '5-点打开以后')
  } finally {
    await run.close()
  }
})
