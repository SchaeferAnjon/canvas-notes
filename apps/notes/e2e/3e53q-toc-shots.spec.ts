/**
 * 交付图（task-3e53q「三、b」对话目录、「四、c」旁支头上的全能标签）。只在截图时跑：CN_SHOTS=目录，CN_SHOT_TONE=dark 截深湖（不给是天青）。平时跳过。
 * 1 读 PDF 的 AI 问了三问，细条收着；2 指着展开；3 点了第二问滚过去；4 全能关着，旁支头上「只在库里」和说明；
 * 5 全能开着，「全能」和说明；6 右栏 AI 对话，展开的目录里旁支挂在那一问下面。
 */
import { expect, test, type Locator, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, openAi, openNote, type Running, tabOn } from './app'
import { LECTURE } from './fixtures/pdf'

const DIR = process.env.CN_SHOTS
const DARK = process.env.CN_SHOT_TONE === 'dark'
test.skip(!DIR, '只在截交付图时跑（CN_SHOTS=目录）')
const tone = DARK ? 'dark' : 'light'
const look = (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: DARK ? 'petrol' : 'sky', frame: 'b', winBg: 'aurora' } }))
}
const files = { '课程/线代/第3讲.pdf': LECTURE, '收件箱/随手.md': '# 随手\n\n问问 AI。\n' }

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

const bar = (col: Locator) => col.locator('[data-part="对话目录条"]')
const pop = (col: Locator) => col.locator('[data-part="对话目录浮层"]')

async function ask(col: Locator, testid: string, text: string) {
  const ta = col.getByRole('textbox', { name: '问 AI' })
  await ta.fill(text)
  await ta.press('Enter')
  await expect(col.getByTestId(testid).last()).toContainText('六：', { timeout: 20_000 })
  await expect(col.getByRole('button', { name: '发送' })).toBeVisible({ timeout: 20_000 })
}
async function hoverBar(page: Page, col: Locator) {
  const b = (await bar(col).boundingBox())!
  await page.mouse.move(b.x + b.width / 2, b.y + 6)
  await expect(pop(col)).toBeVisible()
}
async function leave(page: Page, col: Locator) {
  await page.mouse.move(700, 500)
  await expect(pop(col)).toHaveCount(0)
}

test('交付图', async () => {
  test.setTimeout(180_000)
  const run = await launch(files, { CN_AI_FAKE: '1', CN_FAKE_SAY_MS: '1', CN_FAKE_SECTIONS: '1' }, look)
  const { page } = run
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    await expect.poll(() => page.evaluate(() => innerHeight)).toBe(887)

    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲.pdf')
    await page.locator('.pal-row', { hasText: '第3讲' }).first().click()
    await expect(tabOn(page)).toHaveText('第3讲.pdf')
    await openAi(page)
    const col = page.getByRole('complementary', { name: '边读边问 AI' })
    const list = col.locator('.msgs')
    await ask(col, 'reading-msg', '这一页整体在讲什么？')
    await ask(col, 'reading-msg', '留一被试（LOSO）是什么？为什么要这么考')
    await ask(col, 'reading-msg', '数据泄漏在哪？')
    await list.evaluate((e) => e.scrollTo({ top: 0 }))
    await shot(run, '1-strip', [bar(col)])

    await hoverBar(page, col)
    await shot(run, '2-open', [pop(col).locator('.r.on'), pop(col).locator('.r.q').nth(1)])

    await pop(col).locator('.r.q', { hasText: '留一被试' }).click()
    await page.mouse.move(700, 500)
    await page.waitForTimeout(250)
    await shot(run, '3-jumped', [col.locator('.um-wrap').nth(1), bar(col).locator('i.on')])

    // 全能关着：旁支头上「只在库里」，指着出说明
    const sw = col.getByRole('switch', { name: '全能模式' })
    await sw.click()
    await expect(sw).toHaveAttribute('aria-checked', 'false')
    const a2 = col.getByTestId('reading-msg').nth(1)
    await selectText(page, a2.locator('.txt'), '三：先把', '30 秒一窗')
    const ab = page.getByRole('dialog', { name: '选中的这句' })
    await ab.getByRole('textbox', { name: '问这句' }).fill('窗口为什么切成 30 秒？')
    await ab.getByRole('textbox', { name: '问这句' }).press('Enter')
    const side = col.getByRole('region', { name: '旁支' })
    await expect(side.getByTestId('side-msg').last()).toContainText('第二段', { timeout: 20_000 })
    const tag = side.getByTestId('side-mode')
    await expect(tag).toHaveText('只在库里')
    await tag.hover()
    await expect(page.getByTestId('tooltip')).toBeVisible()
    await shot(run, '4-side-lib', [tag, page.getByTestId('tooltip'), col.getByTestId('ai-input-slim')])

    // 收起旁支，开全能；从目录点那条旁支开回来：「全能」
    await col.getByTestId('ai-input-slim').click()
    await sw.click()
    await expect(sw).toHaveAttribute('aria-checked', 'true')
    await hoverBar(page, col)
    await pop(col).locator('.r.s').click()
    await expect(tag).toHaveText('全能')
    await tag.hover()
    await expect(page.getByTestId('tooltip')).toBeVisible()
    await shot(run, '5-side-omni', [tag, page.getByTestId('tooltip')])

    // 右栏 AI 对话：两问，第一问的回答里开一条旁支；展开目录，旁支挂在那一问下面一级
    await openNote(page, '随手')
    const chat = page.getByRole('complementary', { name: 'AI 对话' })
    await ask(chat, 'ai-msg', '这篇随手记要怎么整理？')
    const m1 = chat.getByTestId('ai-msg').first()
    await selectText(page, m1.locator('.txt'), '一：先把', '30 秒一窗')
    await ab.getByRole('textbox', { name: '问这句' }).fill('这里说的随机划分和留一被试到底差在哪里')
    await ab.getByRole('textbox', { name: '问这句' }).press('Enter')
    const s2 = chat.getByRole('region', { name: '旁支' })
    await expect(s2.getByTestId('side-msg').last()).toContainText('第二段', { timeout: 20_000 })
    await chat.getByTestId('ai-input-slim').click()
    await ask(chat, 'ai-msg', '再列几条要补的')
    await leave(page, chat).catch(() => undefined)
    await hoverBar(page, chat)
    await shot(run, '6-chat-side', [pop(chat).locator('.r.s'), bar(chat).locator('i.ds')])
  } finally {
    await run.close()
  }
})
