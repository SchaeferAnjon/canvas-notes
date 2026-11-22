// AI 回答正文里露出原始工具调用文字（task-ne7cw，用户截图 r20/img26）：模型把一次工具调用写成了普通文字，
// 回答前面夹着一段 <invoke name="Bash"><parameter …>…</invoke>。显示时去掉，答着的时候也不闪出来；
// 代码块里的 <invoke> 照原样；对话记录里存的还是原文。无头、假 AI、临时库。
import { expect, test, type Page } from '@playwright/test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, openAi } from './app'

const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })

test('回答里成段的 <invoke> 不显示、答着时也不闪；正常回答、步骤行照常；代码块里的原样；存的是原文', async () => {
  const run = await launch({ '阅读/书.md': '# 书\n\n> 一段划线。\n' }, { CN_AI_FAKE: '1' })
  const { page, userData } = run
  try {
    await openAi(page)
    // 答的全程记下回答区出现过的字：哪一刻露出过「<invoke」「<parameter」都算错
    await page.evaluate(() => {
      const w = window as unknown as { seen: string[] }
      w.seen = []
      const panel = document.querySelector('[aria-label="AI 对话"]')!
      new MutationObserver(() => {
        // 代码块（pre）里的是正常内容，不算
        for (const t of panel.querySelectorAll('[data-testid="ai-msg"] .txt')) {
          const c = t.cloneNode(true) as HTMLElement
          c.querySelectorAll('pre').forEach((p) => p.remove())
          w.seen.push(c.textContent ?? '')
        }
      }).observe(panel, { subtree: true, childList: true, characterData: true })
    })
    const box = chat(page).getByRole('textbox', { name: '问 AI' })
    await box.fill('演漏出来的工具调用')
    await box.press('Enter')
    await expect(chat(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 30_000 })
    const msg = chat(page).getByTestId('ai-msg').last()
    await expect(msg.getByTestId('ai-step')).toHaveCount(1)
    await expect(msg.getByTestId('ai-step')).toContainText('跑命令')
    const txt = msg.locator('.txt')
    // 正文第一段就是正常的回答
    await expect(txt.locator('p').first()).toHaveText('我在文末加了一节「评价」，共两段。')
    await expect(txt).not.toContainText('<parameter')
    await expect(txt).not.toContainText('Read the current book note')
    // 代码块里的 <invoke> 原样
    await expect(txt.locator('pre')).toHaveText('<invoke name="Read">\n</invoke>')
    const outside = await txt.evaluate((el) => {
      const c = el.cloneNode(true) as HTMLElement
      c.querySelectorAll('pre').forEach((p) => p.remove())
      return c.textContent ?? ''
    })
    expect(outside).not.toContain('<invoke')
    const seen = await page.evaluate(() => (window as unknown as { seen: string[] }).seen)
    expect(seen.length).toBeGreaterThan(5)
    expect(seen.filter((s) => /<[a-z]/.test(s))).toEqual([])
    // 对话记录里存的是原文（完整的 <invoke> 块还在）
    const dir = join(userData, 'ai', 'chats')
    const files = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.json') && !f.endsWith('index.json'))
    const raw = files.map((f) => readFileSync(join(dir, f), 'utf8')).join('\n')
    expect(raw).toContain('<invoke name=\\"Bash\\">\\n<parameter name=\\"command\\">cat ')
    await page.screenshot({ path: process.env.CN_SHOT_DIR ? join(process.env.CN_SHOT_DIR, 'markup.png') : test.info().outputPath('markup.png') })
  } finally {
    await run.close()
  }
})
