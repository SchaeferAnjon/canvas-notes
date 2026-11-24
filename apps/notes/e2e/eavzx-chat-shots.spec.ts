// 交付对照截图（task-eavzx，交付页 75-回答按钮施工）：右栏 AI 对话这一排。天青 / 深湖，B 风格，1440 × 887，真软件、临时库、假 AI。
// 默认（只有左边功能按钮）、⋯ 点开、加了「举个例子」多一颗、四颗时右栏窄放不下进 ⋯、拉宽四颗都排上。
// 只在给了 CN_SHOTS=<目录> 时跑：CN_SHOTS=/private/tmp/canvas-notes-visual/75-回答按钮施工/img npx playwright test e2e/eavzx-chat-shots.spec.ts
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, openAi, openNote, type Running, widenRight } from './app'

const DIR = process.env.CN_SHOTS
test.skip(!DIR, '对照截图：CN_SHOTS=<目录> 才跑')
test.setTimeout(240_000)

const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const MINE = [
  { id: 'own-eg', name: '举个例子', say: '举个生活里的例子' },
  { id: 'own-quiz', name: '考考我', say: '就{这条回答}出三道选择题考我' },
  { id: 'own-en', name: '用英文讲', say: '用英文再讲一遍' },
  { id: 'own-short', name: '再短一点', say: '再说短一点' },
]
const cmds = (n: number) =>
  JSON.stringify({
    version: 1,
    own: MINE.slice(0, n).map((r) => ({ id: r.id, name: r.name, kind: 'ai', target: r.say, prompt: r.say, write: 'answer', where: [], desc: r.say, reply: { where: ['chat'], out: 'here' } })),
    replies: { on: ['still', 'another', 'viz', ...MINE.slice(0, n).map((r) => r.id)], more: [], off: [] },
  })

async function shot(run: Running, name: string) {
  await run.page.waitForTimeout(500)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(DIR!, `${name}.png`), Buffer.from(b64, 'base64'))
}

async function ask(page: Page, text: string) {
  const box = chat(page).getByRole('textbox', { name: '问 AI' })
  await box.fill(text)
  await box.press('Enter')
  await expect(chat(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 30_000 })
  const msg = chat(page).getByTestId('ai-msg').last()
  await expect(msg).not.toHaveAttribute('aria-busy')
  return msg
}

for (const skin of ['sky', 'petrol'] as const) {
  const look = (n: number) => (vault: string) => {
    const ud = join(dirname(vault), 'user-data')
    mkdirSync(ud, { recursive: true })
    writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin, frame: 'b', winBg: 'aurora' } }))
    if (n) {
      mkdirSync(join(vault, '.canvas-notes'), { recursive: true })
      writeFileSync(join(vault, '.canvas-notes/命令.json'), cmds(n))
    }
  }
  const NOTE = { '学习笔记.md': '# 学习笔记\n\n第一段。\n' }

  test(`${skin}：AI 对话默认、⋯ 点开`, async () => {
    mkdirSync(DIR!, { recursive: true })
    const run = await launch(NOTE, { CN_AI_FAKE: '1' }, look(0))
    try {
      await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
      await openNote(run.page, '学习笔记')
      await openAi(run.page)
      const msg = await ask(run.page, '你好')
      await run.page.mouse.move(5, 5)
      await shot(run, `chat-default-${skin}`)
      await msg.getByTestId('ai-ans-acts').getByRole('button', { name: '这条回答还能做什么' }).click()
      await shot(run, `chat-more-${skin}`)
    } finally {
      await run.close()
    }
  })

  test(`${skin}：加了「举个例子」多一颗`, async () => {
    const run = await launch(NOTE, { CN_AI_FAKE: '1' }, look(1))
    try {
      await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
      await openNote(run.page, '学习笔记')
      await openAi(run.page)
      await ask(run.page, '举个生活里的例子')
      await run.page.mouse.move(5, 5)
      await shot(run, `chat-one-${skin}`)
    } finally {
      await run.close()
    }
  })

  test(`${skin}：四颗，窄了进 ⋯、拉宽排出来`, async () => {
    const run = await launch(NOTE, { CN_AI_FAKE: '1' }, look(4))
    try {
      await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
      await openNote(run.page, '学习笔记')
      await openAi(run.page)
      const msg = await ask(run.page, '你好')
      const row = msg.getByTestId('ai-ans-acts')
      for (let i = 0; i < 6 && (await row.getAttribute('data-spill')) === null; i++) await widenRight(run.page, -60)
      await run.page.mouse.move(5, 5)
      await shot(run, `chat-narrow-${skin}`)
      await row.getByRole('button', { name: '这条回答还能做什么' }).click()
      await shot(run, `chat-narrow-more-${skin}`)
      await run.page.keyboard.press('Escape')
      await widenRight(run.page, 520)
      await expect(row).not.toHaveAttribute('data-spill')
      await run.page.mouse.move(5, 5)
      await shot(run, `chat-wide-${skin}`)
    } finally {
      await run.close()
    }
  })
}
