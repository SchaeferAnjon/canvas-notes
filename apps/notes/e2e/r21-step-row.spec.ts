// AI 回答里的步骤行（DESIGN.v3 2.3）：命令、库外的长路径是等宽的一段，放不下省略号，不能盖住下面的输入框（task-9womr 真跑时撞到：
// 真 Claude Code 读了一篇深路径的笔记，步骤行那段等宽字压在输入框上，点输入框点不到）
import { expect, test } from '@playwright/test'
import { launch, openAi, tabOn } from './app'

test('步骤行里很长的路径省略号收住，输入框照样点得到、打得进字', async () => {
  const long = `/tmp/${'很长的一层文件夹/'.repeat(12)}摘录.md`
  const run = await launch({ '随手记.md': '# 随手记\n\n一段字。\n' }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('随手记')
    await page.locator('.pal-row', { has: page.locator('.nm', { hasText: /^随手记$/ }) }).first().click()
    await expect(tabOn(page)).toHaveText('随手记')
    await openAi(page)
    const chat = page.getByRole('complementary', { name: 'AI 对话' })
    const box = chat.getByRole('textbox', { name: '问 AI' })
    await box.click()
    await box.fill(`自己写文件「${long}」「x」`)
    await page.keyboard.press('Enter')
    const step = chat.getByTestId('ai-step').last()
    await expect(step).toContainText('写')
    // 那段等宽字不超出这一条回答（省略号收住）
    const over = await step.evaluate((el) => {
      const sc = el.querySelector('.sc') as HTMLElement | null
      const msg = el.closest('[data-testid="ai-msg"]') as HTMLElement
      return sc ? sc.getBoundingClientRect().right - msg.getBoundingClientRect().right : -1
    })
    expect(over).toBeLessThanOrEqual(0.5)
    // 输入框真点得到（不是 focus()），打得进字
    await box.click()
    await page.keyboard.type('接着问')
    await expect(box).toHaveValue('接着问')
  } finally {
    await run.close()
  }
})
