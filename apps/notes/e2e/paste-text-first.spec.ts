/**
 * 粘贴优先文字：微信复制多条聊天记录时剪贴板里同时有字（text/plain）和一张渲染图，贴进 AI 输入框、文档都是字；
 * AI 输入框下给「同时有一张图 · 改贴图片」，点了贴的那段字换成图（一块「粘贴的图」）。只有图（截图）照旧贴图。
 * 粘贴照浏览器的粘贴事件来（合成的 ClipboardEvent，不碰这台 Mac 真的剪贴板）。
 */
import { expect, test, type Page } from '@playwright/test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, openAi, openNote, pane, waitSaved } from './app'
import { solidPng } from './fixtures/png'
import { shotPart, shotTone } from './shots'

const PNG = [...solidPng(60, 40, [60, 160, 90])]
const WX = '张三 2026/11/24 10:02\n明天几点开会？\n\n李四 2026/11/24 10:05\n下午两点，三楼会议室'

/** 往 selector 那个元素上粘：text 不给就只有图 */
async function paste(page: Page, selector: string, text: string | null) {
  await page.evaluate(
    ([sel, bytes, txt]) => {
      const el = document.querySelector(sel as string) as HTMLElement
      el.focus()
      const dt = new DataTransfer()
      if (txt) dt.setData('text/plain', txt as string)
      dt.items.add(new File([new Uint8Array(bytes as number[])], 'image.png', { type: 'image/png' }))
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    },
    [selector, PNG, text] as const,
  )
}

const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const AI_BOX = 'aside [data-testid="ai-input"] textarea'
const pastedFiles = (userData: string) => {
  try {
    return readdirSync(join(userData, 'pasted'))
  } catch {
    return []
  }
}

test('AI 输入框：字和图一起粘是字，下面给「同时有一张图 · 改贴图片」，点了那段字换成一块图；接着打字提示收起', async () => {
  const run = await launch({ '学习笔记.md': '# 学习笔记\n\n第一段。\n' }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await openNote(page, '学习笔记')
    await openAi(page)
    const ai = chat(page)
    const box = ai.getByRole('textbox', { name: '问 AI' })
    await shotTone(page)
    await box.fill('帮我总结：')
    await paste(page, AI_BOX, WX)
    await expect(box).toHaveValue('帮我总结：' + WX)
    await expect(ai.getByTestId('ai-mat')).toHaveCount(0)
    const alt = ai.getByTestId('ai-paste-alt')
    await expect(alt).toHaveText('同时有一张图·改贴图片')
    await shotPart(ai.getByTestId('ai-input'), 'paste-1-贴成字下面给改贴图片')
    await ai.getByTestId('ai-paste-alt-go').hover()
    await shotPart(ai.getByTestId('ai-input'), 'paste-1b-悬停改贴图片')
    // ⌘Z 撤得掉（insertText 写进去的，和真粘贴一样），撤了提示收起
    await box.press('Meta+z')
    await expect(box).toHaveValue('帮我总结：')
    await expect(alt).toHaveCount(0)

    // 再贴一次，点「改贴图片」：那段字拿掉，图成为一块，编号落在原来贴的地方
    await paste(page, AI_BOX, WX)
    await expect(box).toHaveValue('帮我总结：' + WX)
    await ai.getByTestId('ai-paste-alt-go').click()
    await expect(ai.getByTestId('ai-mat')).toHaveCount(1)
    await expect(box).toHaveValue('帮我总结：①')
    await expect(alt).toHaveCount(0)
    await expect(box).toBeFocused()
    expect(pastedFiles(run.userData)).toHaveLength(1)
    await shotPart(ai.getByTestId('ai-input'), 'paste-2-点了换成图')

    // 贴成字后接着打字：提示收起
    await paste(page, AI_BOX, '第二份聊天记录')
    await expect(alt).toBeVisible()
    await box.press('End')
    await box.pressSequentially('好')
    await expect(alt).toHaveCount(0)
    await expect(box).toHaveValue('帮我总结：①第二份聊天记录好')
  } finally {
    await run.close()
  }
})

test('AI 输入框：只有图（截图）照旧贴成一块图，不给提示；字只是图的文件名（访达里拷的图）也贴图', async () => {
  const run = await launch({ '学习笔记.md': '# 学习笔记\n\n第一段。\n' }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await openNote(page, '学习笔记')
    await openAi(page)
    const ai = chat(page)
    const box = ai.getByRole('textbox', { name: '问 AI' })
    await paste(page, AI_BOX, null)
    await expect(ai.getByTestId('ai-mat')).toHaveCount(1)
    await expect(box).toHaveValue('①')
    await paste(page, AI_BOX, 'image.png')
    await expect(ai.getByTestId('ai-mat')).toHaveCount(2)
    await expect(box).toHaveValue('①②')
    await expect(ai.getByTestId('ai-paste-alt')).toHaveCount(0)
  } finally {
    await run.close()
  }
})

test('文档：字和图一起粘贴进来是字、不存附件；只有图照旧存进附件插图', async () => {
  const run = await launch({ '学习笔记.md': '# 学习笔记\n\n第一段。\n' })
  const { page, vault } = run
  const file = () => readFileSync(join(vault, '学习笔记.md'), 'utf8')
  try {
    await openNote(page, '学习笔记')
    await pane(page).locator('.cm-line', { hasText: '第一段' }).click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await paste(page, '.pane:not([hidden]) .cm-content', WX)
    await waitSaved(page)
    await expect.poll(file).toContain('明天几点开会？')
    expect(file()).toContain('下午两点，三楼会议室')
    expect(file()).not.toContain('![')
    expect(readdirSync(vault)).not.toContain('附件')

    // 只有图：存进这篇的附件，插 ![](附件/…)
    await page.keyboard.press('Meta+End')
    await paste(page, '.pane:not([hidden]) .cm-content', null)
    await expect.poll(file).toContain('![](附件/学习笔记/')
    expect(readdirSync(join(vault, '附件', '学习笔记'))).toHaveLength(1)
  } finally {
    await run.close()
  }
})
