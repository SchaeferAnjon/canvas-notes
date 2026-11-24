/**
 * 交付图（task-3e53q：AI 回答里的引用能点开）。只在截图时跑：CN_SHOTS=目录，CN_SHOT_TONE=dark 截深湖（不给是天青）。平时跳过。
 * 1 读 PDF 时旁支回答里点「小论文计划里排」出的预览卡（用户截图那一处）；2 ⌘点后中间开到那两行、左边闪；
 * 3 AI 对话里网页那段的预览卡；4 白板卡里的引用预览卡。
 */
import { expect, test, type Locator, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { acts, launch, openAi, openNote, type Running, tabOn } from './app'
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

const PLAN_MD = ['# 小论文计划', ...Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 篇：先放着。`), 'SAGE 排第 2 篇，编号 J52。', '作者和 C72 重叠（Chenpei Xie），核心同样是图神经网络。', '', ...Array.from({ length: 30 }, (_, i) => `后面第 ${i + 1} 行。`)].join('\n') + '\n'
const files = {
  '课程/小论文计划.md': PLAN_MD,
  '课程/线代/第3讲.pdf': LECTURE,
  '课程/线代/第3讲 笔记.md': '# 第3讲 笔记\n\n## 定义\n线性：加起来再变和变了再加一样。\n',
  '收件箱/随手.md': '# 随手\n\n问问 AI。\n',
  '课程/线代/板书.md': '# 板书\n\n见[计划那两句](../小论文计划.md#L42-L43)。\n\n另一张卡。\n',
}

/** 截一张；marks：要在交付页上标的框（截图像素，窗口 2 倍），写进 boxes-<主题>.json */
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

test('交付图', async () => {
  test.setTimeout(120_000)
  const run = await launch(files, { CN_AI_FAKE: '1' }, look)
  const { page } = run
  const card = page.getByRole('dialog', { name: '引用' })
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    await expect.poll(() => page.evaluate(() => innerHeight)).toBe(887)

    // 1 读 PDF：讲解里开旁支问「列出引用」，点旁支回答里的「小论文计划里排」
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲.pdf')
    await page.locator('.pal-row', { hasText: '第3讲' }).first().click()
    await expect(tabOn(page)).toHaveText('第3讲.pdf')
    await page.keyboard.press('Meta+j')
    const ai = page.getByRole('complementary', { name: '边读边问 AI' })
    await acts(page).getByRole('button', { name: /问这一页/ }).click()
    const msg = ai.getByTestId('reading-msg').last()
    await expect(msg.locator('.txt')).toContainText('列就是基向量去哪', { timeout: 20_000 })
    await selectText(page, msg.locator('.txt'), '列就是', '去哪')
    const ab = page.getByRole('toolbar', { name: '选中的这句' })
    await ab.getByRole('button', { name: '问这句' }).click()
    // 「问这句」直接开旁支，光标在旁支的输入框里，问题在那里打（r129 小条上不再常驻问题那一格）
    await page.keyboard.insertText('这里引的是库里哪几处？列出引用')
    await page.keyboard.press('Enter')
    const side = ai.getByRole('region', { name: '旁支' })
    const ans = side.getByTestId('side-msg').last()
    await expect(ans).toContainText('没有这篇', { timeout: 20_000 })
    await page.waitForTimeout(600)
    await ans.locator('a.cite', { hasText: '小论文计划里排' }).hover()
    await shot(run, '0-hover')
    await ans.locator('a.cite', { hasText: '小论文计划里排' }).click()
    await expect(card).toBeVisible()
    await shot(run, '1-pdf-side-card', [ans.locator('a.cite', { hasText: '小论文计划里排' }), card])

    // 2 ⌘点：中间开到第 42–43 行，左边闪
    await page.keyboard.press('Escape')
    await ans.locator('a.cite', { hasText: '小论文计划里排' }).click({ modifiers: ['Meta'] })
    await expect(tabOn(page)).toHaveText('小论文计划')
    await page.waitForTimeout(150)
    await shot(run, '2-cmd-open', [page.locator('.pane:not([hidden]) .cm-flashbar:not([hidden])'), page.getByTestId('tab-on')])

    // 3 AI 对话：网页那段的预览卡
    await openNote(page, '随手')
    await openAi(page)
    const chat = page.getByRole('complementary', { name: 'AI 对话' })
    const ta = chat.getByRole('textbox', { name: '问 AI' })
    await ta.fill('列出引用')
    await ta.press('Enter')
    const m2 = chat.getByTestId('ai-msg').last()
    await expect(m2).toContainText('没有这篇', { timeout: 15_000 })
    await m2.locator('a.cite', { hasText: '注意力那段' }).click()
    await expect(card).toBeVisible()
    await shot(run, '3-chat-web-card', [m2.locator('a.cite', { hasText: '注意力那段' }), card])
    await page.keyboard.press('Escape')
    await m2.locator('a.cite.wl', { hasText: '第3讲 笔记' }).click()
    await expect(card).toBeVisible()
    await shot(run, '4-chat-wiki-card', [m2.locator('a.cite.wl', { hasText: '第3讲 笔记' }), card])
    await page.keyboard.press('Escape')

    // 5 白板卡
    await openNote(page, '板书')
    await acts(page).getByRole('tab', { name: '白板' }).click()
    const board = page.locator('.pane:not([hidden])').getByTestId('doc-board')
    await board.locator('a.cite', { hasText: '计划那两句' }).click()
    await expect(card).toBeVisible()
    await shot(run, '5-board-card', [board.locator('a.cite', { hasText: '计划那两句' }), card])
  } finally {
    await run.close()
  }
})
