/**
 * 交付图（task-3e53q 第 ② 条线：让 AI 写成链接 + 软件按名字认）。只在截图时跑：CN_SHOTS=目录，CN_SHOT_TONE=dark 截深湖（不给是天青）。平时跳过。
 * 1 回答里光写名字的「小论文计划」认成链接，点开卡上一行「软件按名字认的」和「不是这篇」；2 点了「不是这篇」以后那个名字不再是链接，底栏能撤回；
 * 3 设置 › AI「回答里的链接」那一组。
 */
import { expect, test, type Locator, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, openAi, openNote, type Running, widenRight } from './app'

const DIR = process.env.CN_SHOTS
const DARK = process.env.CN_SHOT_TONE === 'dark'
test.skip(!DIR, '只在截交付图时跑（CN_SHOTS=目录）')
const tone = DARK ? 'dark' : 'light'
const look = (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: DARK ? 'petrol' : 'sky', frame: 'b', winBg: 'aurora' } }))
}

const PLAN_MD = ['# 小论文计划', ...Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 条：先放着。`), 'SAGE 排第 2 篇，编号 J52。', '作者和 C72 重叠（Chenpei Xie）。', ''].join('\n')
const files = { '课程/小论文计划.md': PLAN_MD, '课程/线代/第3讲 笔记.md': '# 第3讲 笔记\n\n## 定义\n线性：加起来再变和变了再加一样。\n', '收件箱/随手.md': '# 随手\n\n问问 AI。\n' }

async function shot(run: Running, name: string, marks: Locator[] = []) {
  await run.page.waitForTimeout(500)
  const f = join(DIR!, `boxes-${tone}.json`)
  const all = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {}
  all[name] = []
  for (const m of marks) {
    const b = (await m.first().boundingBox())!
    all[name].push([b.x, b.y, b.width, b.height].map((v) => Math.round(v * 2)))
  }
  writeFileSync(f, JSON.stringify(all))
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(DIR!, `${name}-${tone}.png`), Buffer.from(b64, 'base64'))
}

const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const card = (page: Page) => page.getByRole('dialog', { name: '引用' })

test('交付图：按名字认的链接、预览卡、不是这篇、设置', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' }, look)
  const { page } = run
  try {
    await openNote(page, '随手')
    await openAi(page)
    const ta = chat(page).getByRole('textbox', { name: '问 AI' })
    await ta.fill('按名字认')
    await ta.press('Enter')
    const msg = chat(page).getByTestId('ai-msg').last()
    await expect(msg).toContainText('别的几篇先放着', { timeout: 15_000 })
    await expect(chat(page).getByRole('button', { name: '停下' })).toHaveCount(0, { timeout: 15_000 })
    const named = msg.locator('a.cite[data-auto]', { hasText: /^小论文计划$/ })
    await named.click()
    await expect(card(page).getByTestId('cite-auto')).toBeVisible()
    await shot(run, '1-按名字认-卡', [named, card(page).getByTestId('cite-auto'), card(page).getByRole('button', { name: '不是这篇' })])

    await card(page).getByRole('button', { name: '不是这篇' }).click()
    await expect(msg.locator('a.cite[data-auto]', { hasText: /^小论文计划$/ })).toHaveCount(0)
    await shot(run, '2-不是这篇以后', [msg.locator('.md-p').first(), page.getByTestId('toast')])
    await page.keyboard.press('Meta+z')
    await expect(msg.locator('a.cite[data-auto]', { hasText: /^小论文计划$/ })).toHaveCount(1)

    // 右栏拉到最窄：说明折行，不截掉「为什么」
    await widenRight(page, -400)
    await msg.locator('a.cite[data-auto]', { hasText: /^小论文计划$/ }).click()
    await expect(card(page).getByTestId('cite-auto')).toBeVisible()
    await shot(run, '4-窄栏', [card(page).locator('.why')])
    await page.keyboard.press('Escape')

    await page.keyboard.press('Meta+,')
    await page.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: 'AI', exact: true }).click()
    const group = page.getByRole('dialog', { name: '设置' }).getByRole('group', { name: '回答里的链接' })
    await group.scrollIntoViewIfNeeded()
    await shot(run, '3-设置', [group])
  } finally {
    await run.close()
  }
})
