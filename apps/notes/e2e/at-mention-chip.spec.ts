import { expect, test, type Page } from '@playwright/test'
import { launch, tabOn } from './app'

// @ 文档（@文档胶囊）：候选第一条一出来就亮着，Tab 和 ↵ 都选上它，↵ 不当发送；选上的是一颗胶囊，退格一下整个删掉；
// 发出去的那条里也是胶囊，点了打开那篇
const ai = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const files = { '情绪识别调研.md': '# 情绪识别调研\n\n正文\n', '所思所想.md': '# 所思所想\n\n第二段。\n', '读书/情绪的发明.pdf': '%PDF-1.4\n%%EOF\n' }

async function openAi(page: Page) {
  await page.getByRole('button', { name: '打开 AI' }).click()
  const box = ai(page).getByRole('textbox', { name: '问 AI' })
  await box.click()
  return box
}

test('@情 → Tab 选上成胶囊；@情 → ↵ 选上不发送；退格一下删掉整颗', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    const box = await openAi(page)
    await page.keyboard.type('看看 @情')
    const menu = ai(page).getByRole('listbox', { name: '引用笔记' })
    const opts = menu.getByRole('option')
    // 文档和 PDF 都列，名字打头的在前；第一条亮着
    await expect(opts).toHaveCount(2)
    await expect(opts.first()).toContainText('情绪识别调研')
    await expect(opts.nth(1)).toContainText('情绪的发明')
    await expect(opts.nth(1)).toContainText('PDF')
    await expect(opts.first()).toHaveAttribute('aria-selected', 'true')
    await expect(menu).toContainText('Tab / ↵ 选中')
    await page.keyboard.press('Tab')
    await expect(box).toBeFocused()
    await expect(box).toHaveValue('看看 @情绪识别调研 ')
    await expect(menu).toBeHidden()
    // 输入框里是一颗胶囊：图标盖住 @，悬停看路径；「看得到」里有它
    const chip = ai(page).getByTestId('mention-in')
    await expect(chip).toHaveCount(1)
    await expect(chip).toHaveAttribute('data-tip', '情绪识别调研.md')
    await expect(ai(page).locator('.mchip-in')).toHaveText('@情绪识别调研')
    await expect(page.getByTestId('ai-sees')).toContainText('@情绪识别调研')

    // 退格一下：整颗删掉（连后面那个空格）
    await page.keyboard.press('Backspace')
    await expect(box).toHaveValue('看看 ')
    await expect(chip).toHaveCount(0)
    await expect(page.getByTestId('ai-sees')).not.toContainText('@情绪识别调研')

    // ↵ 选上不发送：第二条（↓ 换过去）
    await page.keyboard.type('@情')
    await page.keyboard.press('ArrowDown')
    await expect(opts.nth(1)).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Enter')
    await expect(box).toHaveValue('看看 @情绪的发明 ')
    await expect(ai(page).locator('.um')).toHaveCount(0)
    await expect(chip).toHaveAttribute('data-tip', '读书/情绪的发明.pdf')
    await expect(ai(page).locator('.mchip-in')).toHaveAttribute('data-kind', 'pdf')

    // esc 只收菜单：字留着
    await page.keyboard.type('还有 @所')
    await expect(opts).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    await expect(box).toHaveValue('看看 @情绪的发明 还有 @所')
    await expect(ai(page)).toBeVisible()
  } finally {
    await run.close()
  }
})

test('发出去的那条里也是胶囊，点了打开那篇；← 走不进胶囊里', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    const box = await openAi(page)
    await page.keyboard.type('帮我看看 @情')
    await page.keyboard.press('Tab')
    await page.keyboard.type('写得怎么样')
    // ← 一路走回去：光标跳过胶囊（从末尾一下到开头），不停在中间
    for (let i = 0; i < '写得怎么样 '.length; i++) await page.keyboard.press('ArrowLeft')
    const at = () => box.evaluate((el: HTMLTextAreaElement) => el.selectionStart)
    expect(await at()).toBe('帮我看看 @情绪识别调研'.length)
    await page.keyboard.press('ArrowLeft')
    expect(await at()).toBe('帮我看看 '.length)
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    const bubble = ai(page).locator('.um').last()
    await expect(bubble).toContainText('帮我看看')
    await expect(bubble).toContainText('写得怎么样')
    const chip = bubble.getByTestId('mention-chip')
    await expect(chip).toHaveText('情绪识别调研')
    await expect(chip).toHaveAttribute('data-tip', '情绪识别调研.md')
    await expect(bubble).not.toContainText('@情绪识别调研')
    await expect(box).toHaveValue('')
    await expect(page.getByTestId('ai-sees')).toContainText('@情绪识别调研')
    await chip.click()
    await expect(tabOn(page)).toHaveText('情绪识别调研')
  } finally {
    await run.close()
  }
})

test('输入法组着字时候选照样出、底下那行说先选好字；字上屏以后 Tab 选上', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    const box = await openAi(page)
    await page.keyboard.type('@')
    // 像微信输入法那样组字时就把汉字写在框里（还没上屏）
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.imeSetComposition', { text: '情绪', selectionStart: 2, selectionEnd: 2 })
    const menu = ai(page).getByRole('listbox', { name: '引用笔记' })
    await expect(menu.getByRole('option').first()).toContainText('情绪识别调研')
    await expect(menu).toContainText('先选好字，再按 Tab 或 ↵ 选中')
    await cdp.send('Input.insertText', { text: '情绪' })
    await expect(menu).toContainText('Tab / ↵ 选中')
    await page.keyboard.press('Tab')
    await expect(box).toHaveValue('@情绪识别调研 ')
    await expect(ai(page).getByTestId('mention-in')).toHaveCount(1)
  } finally {
    await run.close()
  }
})
