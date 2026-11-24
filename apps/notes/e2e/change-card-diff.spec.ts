// 2026-11-24 用户（改动卡展开）：AI 回答下「改了 N 个文件」那张卡「这里点不开」「能不能做成图二这种」（Orca 的改动卡）。
// - 文件行能点：就地展开这次的改动，新建的整篇淡绿、改的用历史那套（行号、淡绿淡红、没改的折起），限高能滚，再点收起；
// - 卡片头「改了 N 个文件 +a −b」；只改了一个文件时默认展开，几个文件时默认收起；
// - 展开时行右边「打开这篇」「拷贝」。
// 一律无头（CN_E2E=1）、假 AI（CN_AI_FAKE=1）、临时库。
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, openAi, tabOn } from './app'

const SHOTS = process.env.CN_SHOTS ?? ''
const LONG = ['# 随手记', '', ...Array.from({ length: 40 }, (_, i) => `第${i + 1}行：没改的字。`)].join('\n') + '\n'
const files = {
  '随手记.md': LONG,
  '旅行.md': '# 旅行\n\n见 [[冰岛]]。\n',
  '冰岛.md': '# 冰岛\n\n极光。\n',
}

const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })

async function send(page: Page, text: string) {
  const box = chat(page).getByRole('textbox', { name: '问 AI' })
  await box.fill(text)
  await box.press('Enter')
}

async function answered(page: Page) {
  await expect(chat(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 20_000 })
  return chat(page).getByTestId('ai-msg').last()
}

let scratch: string
test.beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'cn-chgdiff-'))
})
test.afterAll(() => rmSync(scratch, { recursive: true, force: true }))

test('改动卡：新建的一篇默认展开整篇淡绿、点行收起再展开；改一篇看到淡绿淡红、没改的折起；两个文件默认收起点开看；打开这篇、拷贝', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page, app } = run
  const saved = await app.evaluate(({ clipboard }) => clipboard.readText())
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await openAi(page)

    // 1. 新建一篇：卡片头「改了1个文件 +3」，只有一个文件，默认展开，三行都是加上来的（淡绿），有行号
    await send(page, '新建一篇「组会准备」放到「」写上「先讲三个方向。」')
    let msg = await answered(page)
    let card = msg.getByTestId('ai-change')
    await expect(card.locator('.hd')).toContainText('改了1个文件')
    await expect(card.locator('.hd .tot')).toHaveText('+3')
    const row = card.getByRole('button', { name: '收起改动：组会准备.md' })
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    let diff = card.getByTestId('ai-change-diff')
    await expect(diff.locator('.cm-content')).toContainText('先讲三个方向。')
    await expect(diff.locator('.cm-changedLine')).toHaveCount(3)
    await expect(diff.locator('.cm-lineNumbers .cm-gutterElement', { hasText: /^3$/ })).toHaveCount(1)
    // 再点收起，再点展开
    await row.click()
    await expect(diff).toHaveCount(0)
    await card.getByRole('button', { name: '展开改动：组会准备.md' }).click()
    await expect(diff.locator('.cm-changedLine')).toHaveCount(3)
    // 拷贝：这一版全文
    await card.getByRole('button', { name: '拷贝' }).click()
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('# 组会准备\n\n先讲三个方向。\n')
    // 打开这篇：中间开这篇
    await card.getByRole('button', { name: '打开这篇' }).click()
    await expect(tabOn(page)).toHaveText('组会准备')

    // 2. 改一篇：第 20 行改了、末尾加一行；改的淡绿淡红，没改的折起，限高里能滚
    const next = LONG.replace('第20行：没改的字。', '第20行：AI 改过的字。') + '最后加的一行。\n'
    const src = join(scratch, 'next.md')
    writeFileSync(src, next)
    await send(page, `整篇改写「随手记.md」照「${src}」`)
    msg = await answered(page)
    card = msg.getByTestId('ai-change')
    await expect(card.locator('.hd .tot')).toHaveText('+2−1')
    diff = card.getByTestId('ai-change-diff')
    await expect(diff.locator('.cm-changedLine', { hasText: '第20行：AI 改过的字。' })).toHaveCount(1)
    await expect(diff.locator('.cm-deletedChunk', { hasText: '第20行：没改的字。' })).toHaveCount(1)
    await expect(diff.locator('.cm-changedLine', { hasText: '最后加的一行。' })).toHaveCount(1)
    await expect(diff.locator('.cm-collapsedLines').first()).toContainText('展开没改的')
    await expect(diff.locator('.cm-content')).not.toContainText('第5行：没改的字。')
    // 限高：卡片里的改动框不超过 280
    expect((await diff.locator('.fx-scroll').boundingBox())!.height).toBeLessThanOrEqual(281)
    if (SHOTS) {
      mkdirSync(SHOTS, { recursive: true })
      await diff.scrollIntoViewIfNeeded()
      await chat(page).screenshot({ path: join(SHOTS, '改一篇-展开.png') })
    }
    // 点「展开没改的 N 行」，第 5 行露出来
    await diff.locator('.cm-collapsedLines').first().click()
    await expect(diff.locator('.cm-content')).toContainText('第5行：没改的字。')

    // 3. 改名连带改了另一篇：两个文件默认收起，点「旅行.md」那行展开看到改的链接
    await send(page, '把「冰岛.md」改名为「冰岛自驾」')
    msg = await answered(page)
    card = msg.getByTestId('ai-change')
    await expect(card.locator('.hd')).toContainText('改了2个文件')
    await expect(card.getByTestId('ai-change-diff')).toHaveCount(0)
    await card.getByRole('button', { name: '展开改动：旅行.md' }).click()
    diff = card.getByTestId('ai-change-diff')
    await expect(diff.locator('.cm-changedLine', { hasText: '见 [[冰岛自驾]]。' })).toHaveCount(1)
    await expect(diff.locator('.cm-deletedChunk', { hasText: '见 [[冰岛]]。' })).toHaveCount(1)
    // 改名那行也能点开：开头的「# 冰岛」跟着改成了「# 冰岛自驾」
    await card.getByRole('button', { name: '展开改动：冰岛自驾.md' }).click()
    await expect(card.getByTestId('ai-change-diff')).toHaveCount(2)
    await expect(card.getByTestId('ai-change-diff').first().locator('.cm-changedLine', { hasText: '# 冰岛自驾' })).toHaveCount(1)
    if (SHOTS) await chat(page).screenshot({ path: join(SHOTS, '两个文件-点开一个.png') })
  } finally {
    await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), saved)
    await run.close()
  }
})
