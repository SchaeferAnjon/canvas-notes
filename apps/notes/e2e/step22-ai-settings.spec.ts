// 设置 › AI（CN-44 方向 A）：默认一行 + 各功能一个下拉，选了真的按它跑；回答上面写是哪家哪个模型答的（CN-54）
import { expect, test, type Page } from '@playwright/test'
import { launch, openNote, tabOn } from './app'
import { LECTURE } from './fixtures/pdf'

const files = { '随手记.md': '# 随手记\n\n一段字。\n', '课程/线代/第3讲.pdf': LECTURE }
const dialog = (page: Page) => page.getByRole('dialog', { name: '设置' })
const row = (page: Page, f: string) => dialog(page).locator(`.aip-row[data-feature="${f}"]`)

async function openAiSettings(page: Page) {
  await page.keyboard.press('Meta+,')
  await page.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: 'AI', exact: true }).click()
  await expect(dialog(page).getByTestId('ai-default')).toBeVisible()
}

async function choose(page: Page, f: string, label: string, sub: string) {
  await dialog(page).getByTestId(`ai-pick-${f}`).click()
  const menu = dialog(page).getByRole('menu')
  await menu.getByRole('menuitemradio').filter({ hasText: label }).filter({ hasText: sub }).first().click()
  await expect(menu).toHaveCount(0)
}

test('CN-44：设置 › AI 默认一行、五个功能各一个下拉；AI 对话换成 Sonnet 后浮窗和边读边问真的用 Sonnet，回答上面写着「Claude Code · Sonnet」', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await openAiSettings(page)
    await expect(dialog(page).getByTestId('ai-default')).toContainText('Claude Code已装好 · 模型Opus 5.5')
    await expect(dialog(page).locator('.aip-row')).toHaveCount(5)
    await expect(row(page, 'chat')).toContainText('跟默认Claude Code · Opus 5.5')
    await expect(row(page, 'dream')).toContainText('跟默认Claude Code · Opus 5.5')
    await expect(row(page, 'vision')).toContainText('只有它能看图')
    await expect(row(page, 'translate')).toContainText('按顺序')
    await expect(row(page, 'translate').getByRole('button', { name: '排顺序' })).toBeVisible()
    await expect(row(page, 'quick')).toContainText('Claude CodeHaiku')

    // AI 对话单独指定 Claude Code · Sonnet
    await choose(page, 'chat', 'Claude Code', 'Sonnet')
    await expect(row(page, 'chat').getByTestId('ai-pick-chat')).toContainText('Claude CodeSonnet')
    await page.keyboard.press('Escape')

    // 右下角浮窗：真的用 Sonnet 答，回答上面一行写着
    await openNote(page, '随手记')
    await page.keyboard.press('Meta+j')
    const float = page.getByRole('complementary', { name: 'AI 对话' })
    await float.getByRole('textbox', { name: '问 AI' }).fill('你用的什么模型')
    await float.getByRole('textbox', { name: '问 AI' }).press('Enter')
    const msg = float.getByTestId('ai-msg').last()
    await expect(msg.locator('.txt')).toHaveText('模型：sonnet（Claude Code）', { timeout: 15_000 })
    await expect(msg.locator('.read')).toHaveText('Claude Code · Sonnet')
    await page.keyboard.press('Meta+j')

    // 边读边问：同一个
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
    await page.locator('.pal-row', { hasText: '第3讲' }).first().click()
    await expect(tabOn(page)).toHaveText('第3讲.pdf')
    const ai = page.getByRole('complementary', { name: '边读边问 AI' })
    await ai.getByRole('textbox', { name: '问 AI' }).fill('这一页你用的什么模型')
    await ai.getByRole('textbox', { name: '问 AI' }).press('Enter')
    const rm = ai.getByTestId('reading-msg').last()
    await expect(rm.locator('.txt')).toHaveText('模型：sonnet', { timeout: 15_000 })
    await expect(rm.locator('.read')).toContainText('· Claude Code · Sonnet')

    // AI 对话改回跟默认，默认换成 Codex：浮窗换成 Codex（它自己的默认模型，不传模型）
    await openAiSettings(page)
    await choose(page, 'chat', '跟默认', 'Claude Code · Opus 5.5')
    await dialog(page).getByTestId('ai-default-pick').click()
    await dialog(page).getByRole('menu').getByRole('menuitemradio').filter({ hasText: 'Codex' }).click()
    await expect(dialog(page).getByTestId('ai-default')).toContainText('Codex已装好 · 用它自己的默认模型')
    await expect(row(page, 'chat')).toContainText('跟默认Codex')
    // 看图问只有 Claude Code 能做：默认换成 Codex 时它还是 Claude Code
    await expect(row(page, 'vision').getByTestId('ai-pick-vision')).toContainText('Claude Code')
    await page.keyboard.press('Escape')
    await openNote(page, '随手记')
    await page.keyboard.press('Meta+j')
    await expect(float.getByTestId('ai-engine')).toHaveText('Codex')
    await float.getByRole('textbox', { name: '问 AI' }).fill('现在用的什么模型')
    await float.getByRole('textbox', { name: '问 AI' }).press('Enter')
    await expect(float.getByTestId('ai-msg').last().locator('.txt')).toHaveText('模型：没指定（Codex）', { timeout: 15_000 })
    await expect(float.getByTestId('ai-msg').last().locator('.read')).toHaveText('Codex')
  } finally {
    await run.close()
  }
})
