// 对照截图（task-eavzx A 线，款式页 /private/tmp/canvas-notes-visual/62-回答按钮款式/ 第二版 r2-settings / r2-edit / r2-save / r2-chat）：
// AI 对话里你发的那句悬停「存成快捷回复」→ 填好的小卡 → 存好这一排多一颗；设置 › 回答下面那排（预览读 PDF、表）；加一颗的编辑页。
// 天青 / 深湖，B 浮岛书桌，1440 × 887，真软件、临时库、假 AI。库里先放一条收进 ⋯ 的「考考我」（和原型一样）。
// 只在给了 CN_SHOTS=<目录> 时跑：CN_SHOTS=/private/tmp/canvas-notes-visual/75-回答按钮施工/img npx playwright test e2e/eavzx-shots.spec.ts
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, openAi, openNote, type Running } from './app'

const DIR = process.env.CN_SHOTS
test.skip(!DIR, '对照截图：CN_SHOTS=<目录> 才跑')
test.setTimeout(240_000)

const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const dlg = (page: Page) => page.getByRole('dialog', { name: '设置' })
async function shot(run: Running, name: string) {
  await run.page.waitForTimeout(500)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(DIR!, `${name}.png`), Buffer.from(b64, 'base64'))
}

const cmds = () =>
  JSON.stringify({
    version: 1,
    own: [{ id: 'own-quiz', name: '考考我', kind: 'ai', target: '1. 就{这条回答}出三道选择题考我', rules: [{ t: '就{这条回答}出三道选择题考我，我答完再告诉我对错。' }], prompt: '就{这条回答}出三道选择题考我，我答完再告诉我对错。', where: [], write: 'answer', desc: '就{这条回答}出三道选择题考我', reply: { where: ['pdf', 'web'], out: 'here' } }],
    replies: { on: ['still', 'another', 'viz'], more: ['own-quiz'], off: [] },
  }) + '\n'

for (const skin of ['sky', 'petrol'] as const) {
  test(`对照图：${skin}`, async () => {
    mkdirSync(DIR!, { recursive: true })
    const run = await launch({ '学习笔记.md': '# 学习笔记\n\n第一段。\n', '.canvas-notes/命令.json': cmds() }, { CN_AI_FAKE: '1' }, (vault) => {
      const ud = join(dirname(vault), 'user-data')
      mkdirSync(ud, { recursive: true })
      writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin, frame: 'b', winBg: 'aurora' } }))
    })
    const { page } = run
    try {
      await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
      await openNote(page, '学习笔记')
      await openAi(page)
      const box = chat(page).getByRole('textbox', { name: '问 AI' })
      await box.fill('举个生活里的例子')
      await box.press('Enter')
      await expect(chat(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 30_000 })
      await expect(page.getByTestId('toast')).toHaveCount(0, { timeout: 15_000 })
      // 你发的那句悬停：拷贝 · 存成快捷回复
      const um = chat(page).locator('.um-wrap').last()
      await um.locator('.um').hover()
      await shot(run, `save-hover-${skin}`)
      // 填好的小卡
      await um.getByRole('button', { name: '存成快捷回复' }).click()
      const card = page.getByRole('dialog', { name: '存成快捷回复' })
      await card.getByRole('textbox', { name: '名字（排上就写这几个字）' }).fill('举个例子')
      await shot(run, `save-${skin}`)
      await card.getByRole('button', { name: /^存好/ }).click()
      await expect(card).toBeHidden()
      await page.mouse.move(700, 400)
      await page.waitForTimeout(800)
      // 存好：这一排多了「举个例子」
      await shot(run, `save-done-${skin}`)
      await expect(page.getByTestId('toast')).toHaveCount(0, { timeout: 15_000 })
      // ⋯ 最下面「调整这一排…」开设置
      const row = chat(page).getByTestId('ai-msg').last().getByTestId('ai-ans-acts')
      await row.getByRole('button', { name: '这条回答还能做什么' }).click()
      await shot(run, `save-done-more-${skin}`)
      await page.getByRole('menu', { name: '这条回答还能做什么' }).getByRole('menuitem', { name: '调整这一排…' }).click()
      await expect(dlg(page)).toBeVisible()
      await dlg(page).getByTestId('replies-preview').getByRole('radio', { name: '读 PDF' }).click()
      await shot(run, `settings-${skin}`)
      await dlg(page).locator('.set-body').evaluate((el) => (el.scrollTop = el.scrollHeight))
      await shot(run, `settings-table-${skin}`)
      // ⋯ 那一颗还能…
      await dlg(page).getByRole('group', { name: '快捷回复', exact: true }).getByRole('listitem', { name: '举个例子' }).getByRole('button', { name: '这一颗还能…' }).click()
      await shot(run, `settings-row-menu-${skin}`)
      await page.keyboard.press('Escape')
      await dlg(page).getByRole('button', { name: '从我的命令里挑…' }).click()
      await shot(run, `settings-pick-${skin}`)
      await page.keyboard.press('Escape')
      // 加一颗：点例子「考考我」
      await dlg(page).getByRole('button', { name: '加一颗' }).click()
      await dlg(page).getByRole('button', { name: '考考我' }).click()
      // 新建一颗时光标在名字里（点了例子以后放回去，和刚打开时一样）
      await dlg(page).getByRole('textbox', { name: '名字' }).focus()
      await dlg(page).locator('.set-body').evaluate((el) => (el.scrollTop = 0))
      await shot(run, `edit-${skin}`)
      await dlg(page).locator('.set-body').evaluate((el) => (el.scrollTop = el.scrollHeight))
      await shot(run, `edit-bottom-${skin}`)
    } finally {
      await run.close()
    }
  })
}
