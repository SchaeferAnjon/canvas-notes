/**
 * 交付图（task-3e53q 第 ① 条线：七种引用的预览卡和开法，已定 1、2、3）。只在截图时跑：CN_SHOTS=目录，CN_SHOT_TONE=dark 截深湖（不给是天青）。平时跳过。
 * 每种东西一张预览卡；页码小牌的卡；⌘点白板卡后那张卡外圈亮；⇧⌘点底栏那一句；读 PDF 的旁支里 ⌘点后右栏留着、头上「切到《X》的 AI」。
 * 每张图的标框写进 boxes-<主题>.json（截图像素，窗口 2 倍）。
 */
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { acts, launch, openAi, openNote, type Running, tabOn } from './app'
import { LECTURE } from './fixtures/pdf'

const DIR = process.env.CN_SHOTS
const DARK = process.env.CN_SHOT_TONE === 'dark'
test.skip(!DIR, '只在截交付图时跑（CN_SHOTS=目录）')
const tone = DARK ? 'dark' : 'light'

const PLAN_MD = ['# 小论文计划', ...Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 篇：先放着。`), 'SAGE 排第 2 篇，编号 J52，名字就叫 SAGE。', '作者和 C72 重叠（Chenpei Xie），核心同样是图神经网络，14 页。', ''].join('\n')
const BOARD_MD = ['# 读论文白板', '', '## 方法', '', '<!-- card id=c7 -->', '**LOSO 评估**', '随机划分 91.8%，留一被试 80.6%：差 11 个点，说明随机划分漏了题。', '', '窗口 30 秒，重叠 15 秒。', '', '## 结果', '', 'BST-GATNet 在 AffectiveROAD 上 88.43%。', ''].join('\n')
const FILES = {
  // 假 AI 的回答里写的路径（fake-engine「列出七种引用」）
  '课程/小论文计划.md': PLAN_MD,
  '课程/线代/第3讲.pdf': LECTURE,
  '收件箱/随手.md': '# 随手\n\n问问 AI。\n',
  '课程/读论文白板.md': BOARD_MD,
  '文献库.md': ['# 文献库', '', '```base', 'filters:', '  and:', '    - file.inFolder("文献库")', 'views:', '  - type: table', '    name: 表格', '    order:', '      - file.name', '      - 状态', '      - 年份', '      - 和 C72', '      - 页数', '```', ''].join('\n'),
  '文献库/SAGE.md': ['---', '状态: 在读', '年份: 2025', '和 C72: 同一组作者', '页数: 14', '---', '# SAGE', '', '图神经网络。', ''].join('\n'),
  '待办.md': ['# 待办', '', '- [ ] 周五前读完 SAGE 📅 2026-11-27', '- [ ] 给导师发计划', ''].join('\n'),
}
const SUBJECT = '整理小论文计划：SAGE 挪到第 2 篇'

function prepare(vault: string) {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: DARK ? 'petrol' : 'sky', frame: 'b', winBg: 'aurora' } }))
  const git = (...a: string[]) => execFileSync('git', ['-C', vault, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...a])
  git('add', '-A')
  git('commit', '-q', '-m', '开始')
  // 改一行、加一行：卡上「+2 −1」
  const plan = join(vault, '课程/小论文计划.md')
  writeFileSync(plan, readFileSync(plan, 'utf8').replace('第 1 篇：先放着。', '第 1 篇：C72，读完了。') + '排第 3 篇还没定。\n')
  appendFileSync(join(vault, '课程/读论文白板.md'), '\n又一张。\n')
  git('add', '-A')
  git('commit', '-q', '-m', SUBJECT)
  writeFileSync(join(vault, '收件箱/样本.md'), '# 样本\n')
}

/** 截一张；marks：要在交付页上标的框 */
async function shot(run: Running, name: string, marks: Locator[] = []) {
  await run.page.waitForTimeout(450)
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
  test.setTimeout(180_000)
  const run = await launch(FILES, { CN_AI_FAKE: '1' }, prepare)
  const { page, vault } = run
  const card = page.getByRole('dialog', { name: '引用' })
  const chat = page.getByRole('complementary', { name: 'AI 对话' })
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    await expect.poll(() => page.evaluate(() => innerHeight)).toBe(887)
    const hash = execFileSync('git', ['-C', vault, 'log', '-1', '--format=%h', `--grep=${SUBJECT}`], { encoding: 'utf8' }).trim()
    await openNote(page, '随手')
    await openAi(page)
    const ta = chat.getByRole('textbox', { name: '问 AI' })
    await ta.fill(`把小论文用到的东西都列出来（列出七种引用 ${hash}）`)
    await ta.press('Enter')
    const msg = chat.getByTestId('ai-msg').last()
    await expect(msg).toContainText('整理计划那次', { timeout: 15_000 })
    await page.waitForTimeout(500)

    const kinds: [string, string][] = [
      ['1-note', '小论文计划里排'],
      ['2-pdf', '第 4 页'],
      ['3-web', '注意力那段'],
      ['4-board', 'LOSO 那张卡'],
      ['5-row', 'SAGE 那一行'],
      ['6-todo', '周五前读完 SAGE'],
      ['7-commit', '整理计划那次'],
    ]
    for (const [name, text] of kinds) {
      const link = msg.locator('a.cite', { hasText: text })
      await link.click()
      await expect(card).toBeVisible()
      if (name === '2-pdf') await expect(card.getByTestId('cite-thumb').locator('img')).toBeVisible({ timeout: 15_000 })
      if (name === '5-row') await expect(card.getByTestId('cite-row')).toBeVisible()
      if (name === '7-commit') await expect(card.getByTestId('cite-commit-files')).toBeVisible()
      await shot(run, name, [link, card])
      await page.keyboard.press('Escape')
    }

    // 待办：卡上直接勾掉，底栏「勾掉了 … 撤回」
    const tl = msg.locator('a.cite', { hasText: '周五前读完 SAGE' })
    await tl.click()
    await card.getByRole('checkbox').click()
    await expect(card.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByTestId('toast')).toContainText('勾掉了')
    await shot(run, '8-todo-ticked', [card.locator('.td'), page.getByTestId('toast')])
    await page.keyboard.press('Escape')
    await page.keyboard.press('Meta+z')
    await page.waitForTimeout(600)

    // ⇧⌘点白板卡：开在后面，中间不动，底栏说一句
    const bl = msg.locator('a.cite', { hasText: 'LOSO 那张卡' })
    await bl.click({ modifiers: ['Meta', 'Shift'] })
    await expect(page.getByTestId('toast')).toContainText('开在后面的标签里了')
    await shot(run, '9-behind', [page.getByTestId('tab-list').locator(':scope > .tab', { hasText: '读论文白板' }), page.getByTestId('toast')])
    await page.getByTestId('tab-list').locator(':scope > .tab', { hasText: '读论文白板' }).click()
    const c7 = page.locator('.pane:not([hidden])').getByTestId('doc-board').locator('.db-card[data-id="c7"]')
    await expect(c7).toHaveClass(/flown/)
    await page.waitForTimeout(150)
    await shot(run, '10-board-flown', [c7])

    // 读 PDF：回答里的「第 2 页」先出卡；旁支里 ⌘点一篇，右栏留着，头上「切到《X》的 AI」
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲.pdf')
    await page.locator('.pal-row', { hasText: '第3讲' }).first().click()
    await expect(tabOn(page)).toHaveText('第3讲.pdf')
    const ai = page.getByRole('complementary', { name: '边读边问 AI' })
    await expect(ai).toBeVisible()
    await acts(page).getByRole('button', { name: /问这一页/ }).click()
    const rm = ai.getByTestId('reading-msg').last()
    await expect(rm.locator('.txt')).toContainText('列就是基向量去哪', { timeout: 20_000 })
    const p2 = rm.locator('a.pg', { hasText: '第 2 页' })
    await p2.click()
    await expect(card.getByTestId('cite-thumb').locator('img')).toBeVisible({ timeout: 15_000 })
    await shot(run, '11-page-pill', [p2, card])
    await page.keyboard.press('Escape')
    await selectText(page, rm.locator('.txt'), '列就是', '去哪')
    const ab = page.getByRole('dialog', { name: '选中的这句' })
    await ab.getByRole('textbox', { name: '问这句' }).fill('这里引的是库里哪几处？列出引用')
    await ab.getByRole('textbox', { name: '问这句' }).press('Enter')
    const side = ai.getByRole('region', { name: '旁支' })
    const ans = side.getByTestId('side-msg').last()
    await expect(ans).toContainText('没有这篇', { timeout: 20_000 })
    await ans.locator('a.cite', { hasText: '小论文计划里排' }).click({ modifiers: ['Meta'] })
    await expect(tabOn(page)).toHaveText('小论文计划')
    await expect(ai.getByTestId('ai-follow')).toBeVisible()
    await page.waitForTimeout(300)
    await shot(run, '12-stay', [ai.getByTestId('ai-away'), side, page.getByTestId('tab-on')])
    await page.keyboard.press('Alt+Meta+KeyJ')
    await expect(chat).toBeVisible()
    await shot(run, '13-followed', [chat.getByTestId('ai-conv')])
  } finally {
    await run.close()
  }
})
