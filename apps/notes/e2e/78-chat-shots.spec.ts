/**
 * 对照图（ParaRead 联动：AI 对话框搬进 @cn/ai-chat 前后像素比）。只在截图时跑：CN_SHOTS=目录 CN_SHOT_TAG=before|after。平时跳过。
 * 同一个状态截七张：读 PDF 的 AI（问过三问、带材料的那一问、展开的旁支）、目录浮层、输入框顶上一排材料、引擎菜单、effort 菜单；
 * 右栏 AI 对话（两问、回答下面那排、⋯ 菜单）。光标、动画都停好再截。
 */
import { expect, test, type Locator, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, openAi, openNote, type Running, tabOn } from './app'
import { LECTURE } from './fixtures/pdf'

const DIR = process.env.CN_SHOTS
const TAG = process.env.CN_SHOT_TAG ?? 'x'
test.skip(!DIR, '只在截对照图时跑（CN_SHOTS=目录）')
const files = { '课程/线代/第3讲.pdf': LECTURE, '收件箱/随手.md': '# 随手\n\n问问 AI。\n' }

async function shot(run: Running, name: string) {
  // 输入框的光标会闪、流光要淡掉：焦点拿走，等动画停
  await run.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
  await run.page.waitForTimeout(1800)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(DIR!, `cn-${TAG}-${name}.png`), Buffer.from(b64, 'base64'))
}

async function selectText(page: Page, scope: Locator, from: string, to: string) {
  const pts = await scope.evaluate(
    (root, [a, b]) => {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      while (w.nextNode()) {
        const n = w.currentNode as Text
        const i = n.data.indexOf(a!)
        const j = n.data.indexOf(b!, i)
        if (i < 0 || j < 0) continue
        const r = document.createRange()
        r.setStart(n, i)
        r.setEnd(n, j + b!.length)
        n.parentElement!.scrollIntoView({ block: 'center' })
        const rs = r.getClientRects()
        return [rs[0]!.left + 1, rs[0]!.top + rs[0]!.height / 2, rs[rs.length - 1]!.right - 1, rs[rs.length - 1]!.top + rs[rs.length - 1]!.height / 2]
      }
      throw new Error('没找到那一句')
    },
    [from, to],
  )
  await page.mouse.move(pts[0]!, pts[1]!)
  await page.mouse.down()
  await page.mouse.move(pts[2]!, pts[3]!, { steps: 8 })
  await page.mouse.up()
}

async function ask(col: Locator, testid: string, text: string) {
  const ta = col.getByRole('textbox', { name: '问 AI' })
  await ta.fill(text)
  await ta.press('Enter')
  await expect(col.getByTestId(testid).last()).toContainText('六：', { timeout: 20_000 })
  await expect(col.getByRole('button', { name: '发送' })).toBeVisible({ timeout: 20_000 })
}

test('对照图', async () => {
  test.setTimeout(240_000)
  const run = await launch(files, { CN_AI_FAKE: '1', CN_FAKE_SAY_MS: '1', CN_FAKE_SECTIONS: '1' })
  const { page } = run
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    await expect.poll(() => page.evaluate(() => innerHeight)).toBe(887)
    // 分隔行写「现在」还是钟点跟着时间走：钉住 Date.now
    await page.evaluate(() => {
      const t0 = Date.now()
      Date.now = () => t0
    })

    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲.pdf')
    await page.locator('.pal-row', { hasText: '第3讲' }).first().click()
    await expect(tabOn(page)).toHaveText('第3讲.pdf')
    await openAi(page)
    const col = page.getByRole('complementary', { name: '边读边问 AI' })
    await ask(col, 'reading-msg', '这一页整体在讲什么？')
    // 回答里选一句「引用」进输入框，再发：发出去那一条带材料（MatMsg）
    const a1 = col.getByTestId('reading-msg').first()
    await selectText(page, a1.locator('.txt'), '三：先把', '30 秒一窗')
    const ab = page.getByRole('dialog', { name: '选中的这句' })
    await ab.getByRole('button', { name: /^引用/ }).click()
    await expect(col.getByTestId('ai-mat')).toHaveCount(1)
    await ask(col, 'reading-msg', '① 这里为什么这么切？')
    // 第二问的回答里开一条旁支并问一句
    const a2 = col.getByTestId('reading-msg').nth(1)
    await selectText(page, a2.locator('.txt'), '三：先把', '30 秒一窗')
    await ab.getByRole('textbox', { name: '问这句' }).fill('窗口为什么切成 30 秒？')
    await ab.getByRole('textbox', { name: '问这句' }).press('Enter')
    const side = col.getByRole('region', { name: '旁支' })
    await expect(side.getByTestId('side-msg').last()).toContainText('第二段', { timeout: 20_000 })
    await page.mouse.move(700, 500)
    await shot(run, '1-read-side')

    // 收起旁支，目录浮层
    await col.getByTestId('ai-input-slim').click()
    await expect(side).toHaveCount(0)
    const bar = col.locator('[data-part="对话目录条"]')
    const bb = (await bar.boundingBox())!
    await page.mouse.move(bb.x + bb.width / 2, bb.y + 6)
    await expect(col.locator('[data-part="对话目录浮层"]')).toBeVisible()
    await shot(run, '2-read-toc')
    await page.mouse.move(700, 500)
    await expect(col.locator('[data-part="对话目录浮层"]')).toHaveCount(0)

    // 输入框顶上一排：引用两段
    const a3 = col.getByTestId('reading-msg').first()
    await selectText(page, a3.locator('.txt'), '三：先把', '30 秒一窗')
    await ab.getByRole('button', { name: /^引用/ }).click()
    await selectText(page, a3.locator('.txt'), '一：', '。')
    await ab.getByRole('button', { name: /^引用/ }).click()
    await expect(col.getByTestId('ai-mat')).toHaveCount(2)
    await col.getByRole('textbox', { name: '问 AI' }).fill('①和②哪个更要紧？')
    await page.mouse.move(700, 500)
    await shot(run, '3-read-shelf')

    // 谁来答、effort 的菜单
    await col.getByTestId('ai-engine').click()
    await expect(page.getByRole('menu', { name: 'AI 引擎' })).toBeVisible()
    await shot(run, '4-read-engine-menu')
    await page.keyboard.press('Escape')
    await col.getByTestId('ai-effort').click()
    await expect(page.getByRole('menu', { name: '想多久（effort）' })).toBeVisible()
    await shot(run, '5-read-effort-menu')
    await page.keyboard.press('Escape')

    // 右栏 AI 对话：两问，回答下面那排；⋯ 菜单
    await openNote(page, '随手')
    const chat = page.getByRole('complementary', { name: 'AI 对话' })
    await ask(chat, 'ai-msg', '这篇随手记要怎么整理？')
    await ask(chat, 'ai-msg', '再列几条要补的')
    await page.mouse.move(700, 500)
    await shot(run, '6-chat')
    await chat.getByTestId('ai-ans-acts').last().getByRole('button', { name: '这条回答还能做什么' }).click()
    await expect(page.getByRole('menu', { name: '这条回答还能做什么' })).toBeVisible()
    await shot(run, '7-chat-more')
  } finally {
    await run.close()
  }
})
