/**
 * 交付图（⌘预览常驻）：文档、白板、AI 回答、梦游对照里 ⌘ 悬停弹出后，松开 ⌘、鼠标移开，浮窗还在。
 * 只在截图时跑：CN_SHOTS=目录。每张图的标框（截图像素，窗口 2 倍）写进 boxes.json：先链接、后浮窗、再鼠标停的地方。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, type Locator, type Page, test } from '@playwright/test'
import { acts, launch, openAi, openNote, pane, type Running } from './app'
import { AURORA, AURORA_MD, DREAM2_VAULT, prepareDream2 } from './fixtures/dream2'

const DIR = process.env.CN_SHOTS
test.skip(!DIR, '只在截交付图时跑（CN_SHOTS=目录）')

const layer = (page: Page) => page.locator('.pk[data-depth="0"]')

async function size(run: Running) {
  await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
  await expect.poll(() => run.page.evaluate(() => innerHeight)).toBe(887)
}

async function shot(run: Running, name: string, marks: (Locator | { x: number; y: number })[]) {
  await run.page.waitForTimeout(500)
  const f = join(DIR!, 'boxes.json')
  const all = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {}
  all[name] = []
  for (const m of marks) {
    const b = 'x' in m && typeof m.x === 'number' ? { x: m.x - 10, y: m.y - 10, width: 20, height: 20 } : (await (m as Locator).first().boundingBox())!
    all[name].push([b.x, b.y, b.width, b.height].map((v) => Math.round(v * 2)))
  }
  writeFileSync(f, JSON.stringify(all))
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(DIR!, `${name}.png`), Buffer.from(b64, 'base64'))
}

/** ⌘ 停在 link 上弹出 → 截「按着 ⌘」；松开 ⌘、鼠标移到 rest → 截「松开以后」 */
async function pair(run: Running, name: string, link: Locator, rest: { x: number; y: number }) {
  const { page } = run
  await link.hover()
  await page.keyboard.down('Meta')
  await expect(layer(page)).toBeVisible()
  await shot(run, `${name}-1按着`, [link, layer(page)])
  await page.keyboard.up('Meta')
  await page.mouse.move(rest.x, rest.y, { steps: 4 })
  await page.waitForTimeout(800)
  await expect(layer(page)).toBeVisible()
  await shot(run, `${name}-2松开`, [link, layer(page), rest])
  await page.keyboard.press('Escape')
  await expect(layer(page)).toHaveCount(0)
}

const TARGET = 'YitingWei_2026_C72_BST-GATNet'
const DOC_VAULT = {
  [`文献/${TARGET}.md`]: [`# ${TARGET}`, '', 'BST-GATNet：用图注意力网络从多模态生理信号里认司机的压力。', '', '## 数据集', '', 'AffectiveROAD，30 秒一个窗口，窗口重叠 15 秒。', '', '## 留一被试（LOSO）', '', '这一节专门讲留一被试（LOSO）的考法：用没见过的司机来测试。', '', '每次拿一个司机的全部数据当测试集，其余司机训练；所有司机轮一遍取平均。', '', '- 随机划分：同一个司机的窗口会同时出现在训练集和测试集里，分数偏高。', '- LOSO：测试的司机完全没见过，更接近真的用起来。', '', '## 结果', '', 'LOSO 下 80.6%，随机划分 91.8%。', ''].join('\n'),
  '项目/组会/11.24 组会准备.md': ['# 11.24 组会准备', '', '第二步，讲一个自己发现的东西：分数很大程度上取决于怎么划分训练集和测试集。', '', `- SAGE 在同一个数据集上正好做了对比：随机划分 91.8%，[[${TARGET}#留一被试（LOSO）|留一被试（LOSO，测试的司机完全没见过）]] 80.6%，不做个性化校准只有 65.7%。`, '', '- 所以真正难的是「换一个新司机」。', ''].join('\n'),
  '课程/读论文白板.md': ['# 读论文白板', '', '## 方法', '', '<!-- card id=c7 -->', '**LOSO 评估**', '随机划分 91.8%，留一被试 80.6%：差 11 个点。', '', `见 [[${TARGET}#留一被试（LOSO）|LOSO 那一节]]。`, '', '## 结果', '', '结果那张。', ''].join('\n'),
}

test('交付图：文档、白板', async () => {
  test.setTimeout(180_000)
  mkdirSync(DIR!, { recursive: true })
  const run = await launch(DOC_VAULT)
  const { page } = run
  try {
    await size(run)
    await openNote(page, '11.24 组会准备')
    const link = pane(page).locator('.cm-wikilink', { hasText: '留一被试（LOSO' })
    const b = (await pane(page).boundingBox())!
    await pair(run, '1文档', link, { x: b.x + b.width - 60, y: b.y + b.height - 60 })

    await openNote(page, '读论文白板')
    await acts(page).getByRole('tab', { name: '白板' }).click()
    const board = pane(page).getByTestId('doc-board')
    await expect(board).toBeVisible()
    await pair(run, '2白板', board.locator('a.cite', { hasText: 'LOSO 那一节' }), { x: b.x + b.width - 60, y: b.y + b.height - 60 })
  } finally {
    await run.close()
  }
})

const PLAN_MD = ['# 小论文计划', ...Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 条：先放着。`), 'SAGE 排第 2 篇，编号 J52。', '作者和 C72 重叠（Chenpei Xie）。', ''].join('\n')
const SUBJECT = '整理小论文计划'
const AI_VAULT = {
  '课程/小论文计划.md': PLAN_MD,
  '收件箱/随手.md': '# 随手\n\n问问 AI。\n',
  '课程/读论文白板.md': DOC_VAULT['课程/读论文白板.md'],
}
function prepareAi(vault: string) {
  const git = (...a: string[]) => execFileSync('git', ['-C', vault, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...a])
  git('add', '-A')
  git('commit', '-q', '-m', '开始')
  writeFileSync(join(vault, '课程/小论文计划.md'), PLAN_MD + '排第 3 篇还没定。\n')
  git('add', '-A')
  git('commit', '-q', '-m', SUBJECT)
  writeFileSync(join(vault, '收件箱/样本.md'), '# 样本\n')
}

test('交付图：AI 回答', async () => {
  test.setTimeout(180_000)
  mkdirSync(DIR!, { recursive: true })
  const run = await launch(AI_VAULT, { CN_AI_FAKE: '1' }, prepareAi)
  const { page, vault } = run
  try {
    await size(run)
    await openNote(page, '随手')
    await openAi(page)
    const chat = page.getByRole('complementary', { name: 'AI 对话' })
    const ta = chat.getByRole('textbox', { name: '问 AI' })
    const hash = execFileSync('git', ['-C', vault, 'log', '-1', '--format=%h', `--grep=${SUBJECT}`], { encoding: 'utf8' }).trim()
    await ta.fill(`列出七种引用 ${hash}`)
    await ta.press('Enter')
    const msg = chat.getByTestId('ai-msg').last()
    await expect(msg).toContainText('整理计划那次', { timeout: 15_000 })
    const b = (await pane(page).boundingBox())!
    await pair(run, '3AI回答', msg.locator('a.cite', { hasText: '小论文计划里排' }), { x: b.x + 60, y: b.y + b.height - 60 })
  } finally {
    await run.close()
  }
})

test('交付图：梦游对照', async () => {
  test.setTimeout(180_000)
  mkdirSync(DIR!, { recursive: true })
  const vault = { ...DREAM2_VAULT, [AURORA]: AURORA_MD + '\n相关：[[所思所想]]\n' }
  const run = await launch(vault, { CN_AI_FAKE: '1' }, prepareDream2)
  const { page } = run
  try {
    await size(run)
    const dcard = page.getByTestId('dream-card')
    await dcard.getByRole('button', { name: '现在梦游' }).click()
    await expect(dcard.locator('h3')).toContainText('等你过目', { timeout: 60_000 })
    await dcard.getByRole('button', { name: '看报告' }).click()
    const panel = page.getByRole('complementary', { name: '梦游报告' })
    await panel.getByTestId('dream-item').filter({ hasText: '↔ [[极光预报]]' }).click()
    const dtab = page.locator('[data-testid="dream-tab"]:not([hidden])')
    const link = dtab.locator('.cm-merge-b .cm-wikilink', { hasText: '极光预报' })
    await expect(link).toBeVisible({ timeout: 10_000 })
    await page.waitForTimeout(1200)
    const b = (await dtab.boundingBox())!
    await pair(run, '4梦游对照', link, { x: b.x + 80, y: b.y + b.height - 40 })
  } finally {
    await run.close()
  }
})
