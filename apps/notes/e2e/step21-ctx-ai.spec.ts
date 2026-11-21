import { expect, test, type Page } from '@playwright/test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, openNote, pane } from './app'
import { armMenus, clipboardText, menuLabels, openedMenu, pickMenu } from './menu'

// AI 对话里一条回答的右键：拷贝为 Markdown、插进文档、存成卡片

const ai = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })

test('AI 回答右键：「拷贝为 Markdown」「插进文档」插到光标处、「存成卡片」进收件箱', async () => {
  const run = await launch({ '随笔.md': '# 随笔\n\n第一段。\n' }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await armMenus(run)
    await openNote(page, '随笔')
    await pane(page).locator('.cm-line', { hasText: '第一段' }).click()
    await page.keyboard.press('End')
    await page.keyboard.press('Meta+j')
    const box = ai(page).getByRole('textbox', { name: '问 AI' })
    await box.fill('你好')
    await box.press('Enter')
    const msg = ai(page).getByTestId('ai-msg').last()
    await expect(msg.locator('.txt')).toHaveText('这是测试回答（Claude Code）。')
    // 字全到了还在答（这一轮没收尾）时右键只有系统的「拷贝」：等这条答完（全量跑、机器忙时字和收尾之间隔得开）
    await expect(msg).not.toHaveAttribute('aria-busy')

    await msg.locator('.txt').click({ button: 'right' })
    expect(menuLabels(await openedMenu(run))).toEqual(['拷贝', '拷贝为 Markdown', '插进文档', '存成卡片'])
    await pickMenu(run, '拷贝为 Markdown')
    await expect.poll(() => clipboardText(run)).toBe('这是测试回答（Claude Code）。')

    await msg.locator('.txt').click({ button: 'right' })
    await pickMenu(run, '插进文档')
    // 插完光标落在下面新的空段落（CN-17），文件末尾多一个空行
    await expect.poll(() => readFileSync(join(vault, '随笔.md'), 'utf8')).toBe('# 随笔\n\n第一段。\n\n这是测试回答（Claude Code）。\n\n')

    await msg.locator('.txt').click({ button: 'right' })
    await pickMenu(run, '存成卡片')
    await expect.poll(() => (existsSync(join(vault, '收件箱')) ? readdirSync(join(vault, '收件箱')).length : 0)).toBe(1)
    await expect(page.getByTestId('toast')).toContainText('存成卡片')

    // 自己问的那句也能右键
    await ai(page).locator('.um').last().click({ button: 'right' })
    await pickMenu(run, '拷贝')
    await expect.poll(() => clipboardText(run)).toBe('你好')
  } finally {
    await run.close()
  }
})
