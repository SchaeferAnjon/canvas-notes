// CN-91（M1 录屏 3:11「一定要加上」）的后端：每家能选的模型和 effort、「AI 对话」现在选的（effort 默认 High）；
// 每一问带的模型和 effort 一路传到引擎（假引擎问「用的什么模型」时把两样都说出来），回答头上写「Claude Code · Opus 5.5 · High」。
// 输入框底行那三颗按钮是下一段的界面；这里按界面会发的请求真发（window.cn / window.cnReading），再在现在的面板里真问。
import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, openAi, openNote, tabOn } from './app'
import { LECTURE } from './fixtures/pdf'

const PDF = '课程/线代/第3讲.pdf'
const ai = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })

async function askReading(page: Page, text: string) {
  const box = ai(page).getByRole('textbox', { name: '问 AI' })
  await box.fill(text)
  await box.press('Enter')
  return ai(page).getByTestId('reading-msg').last()
}

test('CN-91：ai:engines 给每家的模型、effort 和「AI 对话」现在选的；浮窗、读 PDF 每一问带的模型和 effort 真的传到引擎，回答头上带着 effort；换成 Codex 的模型、Gemini（没有 effort）也对', async () => {
  const run = await launch({ '随手记.md': '# 随手记\n\n一段字。\n', [PDF]: LECTURE }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    const r = await page.evaluate(() => window.cn.aiEngines())
    expect(r.chat).toEqual({ engine: 'claude', model: 'claude-opus-5-5', effort: 'high' })
    expect(r.label).toBe('Claude Code · Opus 5.5 · High')
    const by = Object.fromEntries(r.engines.map((e) => [e.id, e]))
    expect(by.claude!.models.map((m) => m.label)).toEqual(['Opus 5.5', 'Sonnet', 'Haiku'])
    expect(by.claude!.efforts.map((e) => `${e.label}${e.note ? ` ${e.note}` : ''}`)).toEqual(['Low 最快，小追问够用', 'Medium', 'High 讲解默认', 'Extra high 想得更久', 'Max 最慢、最贵'])
    expect(by.codex!.models.map((m) => m.label)).toEqual(['Codex 默认模型', 'GPT-6.1 Terra', 'GPT-6-Luna'])
    expect(by.codex!.models[2]!.efforts.map((e) => e.id)).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    expect(by.gemini!.models).toEqual([{ id: '', label: 'Gemini 默认模型', efforts: [] }])
    expect(by.gemini!.efforts).toEqual([])
    expect(by.opencode!.efforts).toEqual([])

    // 浮窗：没带就用「AI 对话」那一行（Opus 5.5 · High），回答头上写着
    await openNote(page, '随手记')
    await page.keyboard.press('Meta+j')
    const float = page.getByRole('complementary', { name: 'AI 对话' })
    await float.getByRole('textbox', { name: '问 AI' }).fill('你用的什么模型')
    await float.getByRole('textbox', { name: '问 AI' }).press('Enter')
    const msg = float.getByTestId('ai-msg').last()
    await expect(msg.locator('.txt')).toHaveText('模型：claude-opus-5-5，effort：high（Claude Code）', { timeout: 15_000 })
    await expect(msg.locator('.read')).toHaveText('Claude Code · Opus 5.5 · High')
    await expect(float.getByRole('button', { name: '发送' })).toBeVisible()
    // 这一问带了模型和 effort（输入框底行选的，只管这个对话）：真的传到引擎，「AI 对话」那一行不变
    const turn = await page.evaluate(() =>
      window.cn.aiTurn({ id: 9001, engine: 'claude', text: '你用的什么模型', context: { tab: { type: 'none', title: '' }, web: { open: false, url: null } }, model: 'haiku', effort: 'low' }),
    )
    expect(turn.text).toBe('模型：haiku，effort：low（Claude Code）')
    expect((await page.evaluate(() => window.cn.aiEngines())).label).toBe('Claude Code · Opus 5.5 · High')
    // 参数不对的不发
    const bad = await page.evaluate(() =>
      window.cn.aiTurn({ id: 9002, engine: 'claude', text: '你好', context: { tab: { type: 'none', title: '' }, web: { open: false, url: null } }, effort: 'High; rm -rf' }),
    )
    expect(bad.error).toBe('AI 参数不对')
    await page.keyboard.press('Meta+j')

    // 读 PDF：同一套
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
    await page.locator('.pal-row', { hasText: '第3讲' }).first().click()
    await expect(tabOn(page)).toHaveText('第3讲.pdf')
    await openAi(page)
    let rm = await askReading(page, '这一页你用的什么模型')
    await expect(rm.locator('.txt')).toHaveText('模型：claude-opus-5-5，effort：high', { timeout: 15_000 })
    await expect(rm.locator('.read')).toContainText('· Claude Code · Opus 5.5 · High')
    const asked = await page.evaluate((pdf) =>
      window.cnReading.ask({ id: 9003, pdf, hash: 'x', engine: 'claude', thread: { id: '.canvas-notes/对话/第3讲-p1-9.md', page: 1, createdAt: Date.now() }, text: '你用的什么模型', images: [], pageText: '', pages: 3, model: 'sonnet', effort: 'max' }),
    PDF)
    expect(asked.text).toBe('模型：sonnet，effort：max')

    // 换成 Codex 的一个模型、它不认的一档：记成「AI 对话」那一行，这一档换成这个模型自己的默认档；右栏头上跟着换
    await page.evaluate(() => window.cn.aiSetChatPick({ engine: 'codex', model: 'gpt-6-luna', effort: 'ultra' }))
    const r2 = await page.evaluate(() => window.cn.aiEngines())
    expect(r2.chat).toEqual({ engine: 'codex', model: 'gpt-6-luna', effort: 'medium' })
    expect(r2.label).toBe('Codex · GPT-6-Luna · Medium')
    await expect(ai(page).getByRole('button', { name: '选 AI 引擎' })).toContainText('Codex')
    rm = await askReading(page, '现在你用的什么模型')
    await expect(rm.locator('.txt')).toHaveText('模型：gpt-6-luna，effort：medium', { timeout: 15_000 })
    await expect(rm.locator('.read')).toContainText('· Codex · GPT-6-Luna · Medium')

    // Gemini 没有 effort：模型、effort 都不传，回答头上只写 Gemini
    await page.evaluate(() => window.cn.aiSetChatPick({ engine: 'gemini', effort: 'high' }))
    await expect(ai(page).getByRole('button', { name: '选 AI 引擎' })).toContainText('Gemini')
    rm = await askReading(page, '这回你用的什么模型')
    await expect(rm.locator('.txt')).toHaveText('模型：没指定，effort：没指定', { timeout: 15_000 })
    await expect(rm.locator('.read')).toContainText('· Gemini')
    await expect(rm.locator('.read')).not.toContainText('High')

    // 设置里记的是「AI 对话」那一行，默认没动
    const settings = JSON.parse(readFileSync(join(run.userData, 'ai/settings.json'), 'utf8'))
    expect(settings.prefs.default).toEqual({ engine: 'claude', model: 'claude-opus-5-5' })
    expect(settings.prefs.features.chat).toEqual({ engine: 'gemini' })
  } finally {
    await run.close()
  }
})
