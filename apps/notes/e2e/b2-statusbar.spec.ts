/**
 * A 风格底栏右端（设计走样，主界面 design/frame「底栏」）：译 · Claude Code ｜ 新版本 ｜ 本周 N 次提交 ｜ 通知铃 ｜ AI。
 * 「译」点开换翻译用的 AI（同 设置 › 插件 › 双语翻译「只用某家」）；铃列出这次打开以来底栏说过的话，有没看过的时右上一个小点。
 * 真点，窗口不上屏；翻译引擎用假命令行（CN_AI_FAKE），Codex 装成没登录。
 */
import { expect, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, tabOn } from './app'

const frameA = (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { frame: 'a' } }))
}

test('A 底栏右端：「译 · Claude Code」、本周提交、通知铃、AI；译点开能换引擎；铃列出说过的话', async () => {
  const run = await launch({ '甲.md': '# 甲\n\n正文。\n', '乙.md': '# 乙\n\n正文。\n' }, { CN_AI_FAKE: '1', CN_TR_FAKE_CLI: 'codex=login' }, frameA)
  const { page } = run
  try {
    const bar = page.locator('footer.status')
    const tr = page.getByTestId('translate-engine')
    await expect(tr).toHaveText('译 · Claude Code')
    // 右端的顺序：译 · 本周提交 · 铃 · AI
    const where = () =>
      bar.evaluate((f) => {
        const items = [f.querySelector('[data-testid="translate-engine"]'), f.querySelector('[data-testid="week-commits"]'), f.querySelector('[data-testid="bell"]'), f.querySelector('.ai-corner')]
        return items.map((e) => (e ? Math.round(e.getBoundingClientRect().left) : -1))
      })
    // 「本周 N 次提交」读完 git 记录才出来：等四样都在再量
    await expect.poll(async () => (await where()).every((x) => x >= 0)).toBe(true)
    const order = await where()
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    // 点「译」：列出引擎，现在用的打勾，用不了的灰掉写原因
    await tr.click()
    const pop = page.getByRole('dialog', { name: '翻译用哪个AI' })
    await expect(pop.locator('.mh')).toHaveText('网页和视频翻译用')
    await expect(pop.getByRole('menuitem', { name: /Claude Code/ })).toBeVisible()
    await expect(pop.getByRole('menuitem', { name: /Codex/ })).toBeDisabled()
    await expect(pop.getByRole('menuitem', { name: /Codex/ })).toContainText('没登录')
    await pop.getByRole('menuitem', { name: /Gemini/ }).click()
    await expect(pop).toHaveCount(0)
    await expect(tr).toHaveText('译 · Gemini CLI')

    // 通知铃：还没说过话时点开是「没有新通知」
    const bell = page.getByTestId('bell')
    await expect(page.getByTestId('bell-dot')).toHaveCount(0)
    await bell.click()
    const notes = page.getByRole('dialog', { name: '通知' })
    await expect(notes).toContainText('没有新通知')
    await page.keyboard.press('Escape')
    // 底栏说一句（关一个标签）：铃上出小点；点开列着那句和时间，小点没了
    await page.keyboard.press('Meta+o')
    await page.keyboard.type('甲')
    await page.waitForTimeout(150)
    await page.keyboard.press('Enter')
    await expect(tabOn(page)).toHaveText('甲')
    await page.keyboard.press('Meta+w')
    await expect(page.getByTestId('toast')).toContainText('关掉了「甲」')
    await expect(page.getByTestId('bell-dot')).toBeVisible()
    await bell.click()
    await expect(notes.locator('.nrow').first()).toContainText('关掉了「甲」')
    await expect(notes.locator('.nrow').first().locator('.when')).toHaveText(/^今天 \d\d:\d\d$/)
    await expect(page.getByTestId('bell-dot')).toHaveCount(0)
    // 清除
    await notes.getByRole('button', { name: '清除' }).click()
    await bell.click()
    await expect(notes).toContainText('没有新通知')
  } finally {
    await run.close()
  }
})

test('B 底栏不放「译」和铃（只留几项）', async () => {
  const run = await launch({ 'a.md': '# a\n' }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await expect(page.getByTestId('week-commits')).toBeVisible()
    await expect(page.getByTestId('translate-engine')).toHaveCount(0)
    await expect(page.getByTestId('bell')).toHaveCount(0)
  } finally {
    await run.close()
  }
})
