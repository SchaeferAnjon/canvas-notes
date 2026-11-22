/**
 * 交付对照图（task-83vl3 第 3 条「回答底下一排」）：右栏 AI 对话问一句，回答是照用户截图 r34 那段（表格、长行内代码、代码块）。
 * 只在截交付图时跑：CN_SHOTS=目录，CN_SHOT_TONE=dark 截深湖（不给是天青），CN_SHOT_STAGE=before|after（文件名前缀）。平时跳过。
 * after 多截：悬停「插进文档」的提示、点了以后中间文档里插进来的那一块、之前那条回答悬停才露、中间没开文档时变淡、读 PDF 讲解卡那排；
 * 每张图上要标的框（CSS 像素，相对那张图的左上角）写进 boxes-<tone>.json，交付页照着画框。
 */
import { expect, test, type Locator } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, openAi, openNote, pane, type Running } from './app'
import { LECTURE } from './fixtures/pdf'

const DIR = process.env.CN_SHOTS
const DARK = process.env.CN_SHOT_TONE === 'dark'
const STAGE = process.env.CN_SHOT_STAGE ?? 'after'
test.skip(!DIR, '只在截交付图时跑（CN_SHOTS=目录）')

const tone = DARK ? 'dark' : 'light'
const look = (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: DARK ? 'petrol' : 'sky', frame: 'b', winBg: 'aurora' } }))
}
type Rect = { x: number; y: number; width: number; height: number }

async function shot(run: Running, name: string, clip?: Rect) {
  await run.page.waitForTimeout(clip ? 300 : 700)
  const r = clip && { x: Math.max(0, Math.round(clip.x)), y: Math.max(0, Math.round(clip.y)), width: Math.round(clip.width), height: Math.round(clip.height) }
  const b64 = await run.app.evaluate(async ({ BrowserWindow }, c) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage(c ?? undefined)).toPNG().toString('base64'), r)
  writeFileSync(join(DIR!, `${STAGE}-${name}-${tone}.png`), Buffer.from(b64, 'base64'))
}
/** 记一个框：what 的位置减去图的左上角 at */
async function mark(name: string, what: Locator | Rect, at: { x: number; y: number } = { x: 0, y: 0 }) {
  const b = 'x' in what ? what : (await what.first().boundingBox())!
  const f = join(DIR!, `boxes-${tone}.json`)
  const all = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {}
  all[name] = { x: b.x - Math.max(0, Math.round(at.x)), y: b.y - Math.max(0, Math.round(at.y)), width: b.width, height: b.height }
  writeFileSync(f, JSON.stringify(all, null, 1))
}

test('第 3 条对照图：回答底下一排', async () => {
  const run = await launch({ '学习笔记：动手学深度学习.md': '# 学习笔记：动手学深度学习\n\n2.2 数据预处理：把文字列换成数字，再转成张量。\n\n下面接着写。\n', '课程/第3讲.pdf': LECTURE }, { CN_AI_FAKE: '1' }, look)
  const { page } = run
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    await expect.poll(() => page.evaluate(() => innerHeight)).toBe(887)
    await openNote(page, '学习笔记：动手学深度学习')
    await openAi(page)
    const chat = page.getByRole('complementary', { name: 'AI 对话' })
    const box = chat.getByRole('textbox', { name: '问 AI' })
    await box.fill('这一步 get_dummies 是在干什么？给我一段宽内容')
    await box.press('Enter')
    await expect(chat.getByRole('button', { name: '发送' })).toBeVisible({ timeout: 30_000 })
    const msg = chat.getByTestId('ai-msg').last()
    await expect(msg.locator('.txt')).toContainText('下一步就能转成张量')
    // 对话滚到底，回答最后几行和下面那排都在视野里
    await chat.locator('.msgs').evaluate((el) => el.scrollTo({ top: el.scrollHeight }))
    await page.mouse.move(289, 600)
    const row = msg.getByTestId('ai-ans-acts')
    const panel = (await chat.boundingBox())!
    await shot(run, 'full')
    if (STAGE === 'before') {
      const t = (await msg.locator('.txt').boundingBox())!
      await mark('before-end', { x: t.x, y: t.y + t.height + 2, width: 260, height: 30 })
      return
    }
    await mark('row', row)
    // 悬停「插进文档」：出提示（往上弹）
    const ins = row.getByRole('button', { name: '插进文档' })
    await ins.hover()
    const tip = page.getByTestId('tooltip')
    await expect(tip).toBeVisible({ timeout: 3000 })
    const rb = (await row.boundingBox())!
    const crop = { x: panel.x, y: rb.y - 190, width: panel.width, height: 240 }
    await shot(run, 'tip', crop)
    await mark('tip-row', row, crop)
    await mark('tip', tip, crop)
    // 真点：插到文档里，写成带 Claude 标志的 [!ai] 块，块头链回对话
    await row.getByRole('button', { name: '插进文档' }).click()
    await page.mouse.move(289, 600)
    await shot(run, 'inserted')
    const ed = pane(page).locator('.cm-content')
    const hb = (await ed.locator('.cm-callout-head').first().boundingBox())!
    const lastLine = ed.locator('.cm-callout-bot').last()
    const bb = (await lastLine.boundingBox())!
    await mark('ins-block', { x: hb.x - 4, y: hb.y - 4, width: hb.width + 8, height: bb.y + bb.height - hb.y + 8 })
    await mark('ins-head', ed.locator('.cm-callout-head').first())
    await mark('ins-table', ed.locator('.cm-inquote .cm-table').last())
    await mark('ins-code', ed.locator('.cm-inquote-code'))
    await mark('toast', page.getByText('插进了《学习笔记：动手学深度学习》'))

    // 再问一句：之前那条回答下面那排平时藏着，指着那条才露；点「拷贝」变「已拷贝」
    await box.fill('把这周总结成三句话')
    await box.press('Enter')
    await expect(chat.getByRole('button', { name: '发送' })).toBeVisible({ timeout: 30_000 })
    const older = chat.getByTestId('ai-msg').nth(0)
    const newer = chat.getByTestId('ai-msg').nth(1)
    const orow = older.getByTestId('ai-ans-acts')
    await chat.locator('.msgs').evaluate((el) => el.scrollTo({ top: el.scrollHeight }))
    await orow.getByRole('button', { name: '拷贝' }).hover()
    await orow.getByRole('button', { name: '拷贝' }).click()
    await expect(orow.getByRole('button', { name: '已拷贝' })).toBeVisible()
    const ob = (await orow.boundingBox())!
    const nb = (await newer.getByTestId('ai-ans-acts').boundingBox())!
    const ocrop = { x: panel.x, y: ob.y - 60, width: panel.width, height: Math.min(nb.y + nb.height + 20, panel.y + panel.height) - (ob.y - 60) }
    await shot(run, 'older', ocrop)
    await mark('older-row', orow, ocrop)
    await mark('newer-row', newer.getByTestId('ai-ans-acts'), ocrop)

    // 中间没开文档：关掉文档回首页，对话菜单里点开「学习笔记」那段，「插进文档」变淡、悬停说为什么
    await page.getByTestId('tab-on').hover()
    await page.getByTestId('tab-on').getByRole('button', { name: '关闭标签' }).click()
    await expect(page.getByTestId('tab-on')).toHaveText('首页')
    await chat.getByTestId('ai-conv').click()
    await chat.locator('.convmenu .it', { hasText: '学习笔记' }).click()
    const drow = chat.getByTestId('ai-msg').last().getByTestId('ai-ans-acts')
    await expect(drow.getByRole('button', { name: '插进文档' })).toHaveAttribute('aria-disabled', 'true')
    await drow.getByRole('button', { name: '插进文档' }).hover()
    await expect(page.getByTestId('tooltip')).toHaveText('中间开着一篇文档才能插')
    const db = (await drow.boundingBox())!
    const dcrop = { x: panel.x, y: db.y - 150, width: panel.width, height: 200 }
    await shot(run, 'disabled', dcrop)
    await mark('dis-row', drow, dcrop)
    await mark('dis-tip', page.getByTestId('tooltip'), dcrop)

    // 对照：读 PDF 讲解卡下面那排（还是不懂 · 换个方式讲 · 做个可视化）
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
    await page.locator('.pal-row').filter({ has: page.locator('.nm', { hasText: /^第3讲/ }) }).first().click()
    await openAi(page)
    const ai = page.getByRole('complementary', { name: '边读边问 AI' })
    await ai.getByRole('textbox', { name: '问 AI' }).fill('这一页讲的是什么')
    await ai.getByRole('textbox', { name: '问 AI' }).press('Enter')
    const rm = ai.getByTestId('reading-msg').last()
    await expect(rm.getByRole('button', { name: '换个方式讲' })).toBeVisible({ timeout: 15_000 })
    await page.mouse.move(289, 600)
    const rmb = (await rm.boundingBox())!
    const ab = (await ai.boundingBox())!
    const pcrop = { x: ab.x, y: rmb.y - 10, width: ab.width, height: Math.min(rmb.height + 20, 260) }
    await shot(run, 'pdf-row', pcrop)
    await mark('pdf-row', rm.locator('.acts').first(), pcrop)
  } finally {
    await run.close()
  }
})
