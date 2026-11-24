/**
 * 梦游重新设计的对照图（task-m552v）：和 demo /private/tmp/canvas-notes-dream/v2/proto.html 同样的状态，天青 / 深湖 × B / A 各一套。
 * 只在给了 CN_SHOTS（目录）时跑；CN_SHOT_LOOK=sky-b 只截一套。窗口内容 1440×887（demo 量的那个大小）。都是真点。
 */
import { expect, type Page, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { acts, launch, leftView, type Running, tabOn } from './app'
import { DREAM2_VAULT, NOTE, PDF, prepareDream2 } from './fixtures/dream2'

const DIR = process.env.CN_SHOTS
test.skip(!DIR, '只在截对照图时跑（CN_SHOTS=目录）')

const LOOKS = (
  [
    ['sky', 'b'],
    ['petrol', 'b'],
    ['sky', 'a'],
    ['petrol', 'a'],
  ] as const
).filter(([s, f]) => !process.env.CN_SHOT_LOOK || process.env.CN_SHOT_LOOK === `${s}-${f}`)

const VIZ_TITLE = '旋转矩阵 · 拖动角度看基向量'

async function shot(run: Running, name: string) {
  await run.page.waitForTimeout(450)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(DIR!, `${name}.png`), Buffer.from(b64, 'base64'))
}

/** 每个状态记下几样量出来的尺寸（和 demo 的 DOM 量的比） */
async function measure(page: Page, name: string) {
  const m = await page.evaluate(({ PDF, NOTE }) => {
    const r = (sel: string) => {
      const e = document.querySelector(sel)
      if (!e) return null
      const b = e.getBoundingClientRect()
      const cs = getComputedStyle(e)
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), font: cs.fontSize + '/' + cs.lineHeight + ' ' + cs.fontWeight, pad: cs.padding, radius: cs.borderRadius }
    }
    const t = '[data-testid="dream-tab"]:not([hidden]) '
    return {
      prog: r('.dprog'),
      progBtn: r('.dprog .bar button'),
      dsum: r('.dsum'),
      dg: r('.dg'),
      di: r('.di.on'),
      card: r('.dd'),
      frow: r('.dd .dchg'),
      head: r(t + '.dt-head'),
      h2: r(t + '.dt-head h2'),
      why: r(t + '.dt-head .why'),
      files: r(t + '.dt-files'),
      chip: r(t + '.dt-chip'),
      fbar: r(t + '.dt-fbar'),
      move: r(t + '.dt-move'),
      cols: r(t + '.dt-cols'),
      fold: r(t + '.dv-fold'),
      mm: r(t + '.dt-mm'),
      viz: r('.pane:not([hidden]) .cm-viz .vz'),
      vizHead: r('.pane:not([hidden]) .cm-viz .vz-h'),
      acts: r('[data-testid="tab-acts"]'),
      treePdf: r(`[role="treeitem"][data-path="${PDF}"]`),
      treeNote: r(`[role="treeitem"][data-path="${NOTE}"]`),
      treeViz: r('[role="treeitem"][data-path$=".html"]'),
      strip: r('[data-testid="dream-tree-strip"]'),
      toast: r('[data-testid="toast"]'),
    }
  }, { PDF, NOTE })
  writeFileSync(join(DIR!, `${name}.json`), JSON.stringify(m, null, 1))
}

for (const [skin, frame] of LOOKS) {
  test(`对照图：${skin} · ${frame}`, async () => {
    test.setTimeout(180_000)
    mkdirSync(DIR!, { recursive: true })
    const run = await launch(DREAM2_VAULT, { CN_AI_FAKE: '1' }, (vault) => {
      prepareDream2(vault)
      const ud = join(dirname(vault), 'user-data')
      mkdirSync(ud, { recursive: true })
      writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin, frame, winBg: 'aurora' } }))
    })
    const { page } = run
    const tag = `${skin}-${frame}`
    try {
      await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
      const card = page.getByTestId('dream-card')
      await card.getByRole('button', { name: '现在梦游' }).click()
      await expect(card.locator('h3')).toContainText('等你过目', { timeout: 60_000 })
      await card.getByRole('button', { name: '看报告' }).click()
      const panel = page.getByRole('complementary', { name: '梦游报告' })
      const item = (t: string) => panel.getByTestId('dream-item').filter({ hasText: t })
      const t = page.locator('[data-testid="dream-tab"]:not([hidden])')

      // ① 归类和改名那条（条目头、两个文件、挪动、对照是历史那一套）
      await item('原名「极光」').click()
      await expect(t.getByTestId('dream-move')).toBeVisible()
      await shot(run, `01-file-item-${tag}`)
      await measure(page, `01-file-item-${tag}`)
      // ② 同一条的第二个文件（换了双链的那篇）
      await t.getByTestId('dream-file').nth(1).click()
      await expect(t.getByTestId('dream-fbar')).toContainText('冰岛行程')
      await shot(run, `02-file-item-2-${tag}`)
      // ③ 可视化那条：笔记的对照，嵌进来的那一块
      await item(VIZ_TITLE).click()
      await expect(t.getByTestId('dream-fbar')).toContainText('笔记')
      await shot(run, `03-viz-note-${tag}`)
      await measure(page, `03-viz-note-${tag}`)
      // ④ 可视化那条的 HTML：左边 main 上没有，右边就是那张图
      await t.getByTestId('dream-file').filter({ hasText: '旋转矩阵.html' }).click()
      await expect(t.getByTestId('dream-void')).toBeVisible()
      await shot(run, `04-viz-html-${tag}`)
      // ⑥ 合一（2026-11-24 起没有「收下后的样子」「只看改动」：没改的本来就折着）
      await t.getByTestId('dream-file').first().click()
      await acts(page).getByRole('tab', { name: '合一' }).click()
      await expect(t.locator('.dv-diff.dv-unified')).toBeVisible()
      await shot(run, `07-viz-unified-${tag}`)
      await measure(page, `07-viz-unified-${tag}`)
      await acts(page).getByRole('tab', { name: '并排' }).click()
      // ⑦ 收下可视化：0.7 秒后往下走一条（补双链），底部提示带撤回、在历史里看
      await t.getByRole('button', { name: '收下', exact: true }).click()
      await expect(t.getByTestId('dream-k')).toHaveText('补上的双链 · 第5条，共7条', { timeout: 4000 })
      await shot(run, `08-after-take-${tag}`)
      // ⑧ 历史里看刚收下的那次
      await page.keyboard.press('Meta+y')
      const hist = page.getByRole('complementary', { name: '历史' })
      await hist.locator('.commit, [data-testid="commit"]').filter({ hasText: '梦游：做了可视化' }).first().click()
      await hist.getByText(NOTE.split('/').pop()!).first().click()
      await expect(t.getByTestId('dream-hist')).toBeVisible()
      await shot(run, `09-history-${tag}`)
      await page.keyboard.press('Meta+y')
      // ⑨ 文件树：PDF › 笔记 › 可视化
      await leftView(page, '文件')
      const tree = page.getByRole('tree', { name: '全部文件' })
      const folder = tree.locator('[data-path="课程/study project 2"]')
      if ((await folder.getAttribute('aria-expanded')) !== 'true') await folder.getByRole('button', { name: '展开 study project 2' }).click()
      await expect(tree.locator(`[data-path="${PDF}"]`)).toBeVisible()
      await shot(run, `10-tree-${tag}`)
      await measure(page, `10-tree-${tag}`)
      // ⑩ 剪藏筛选
      await page.getByRole('tablist', { name: '类型' }).first().getByRole('tab', { name: '剪藏' }).click()
      await expect(page.getByTestId('clip-rule')).toBeVisible()
      await shot(run, `11-clip-${tag}`)
      await page.getByRole('tablist', { name: '类型' }).first().getByRole('tab', { name: '全部' }).click()
      // ⑪ 收下后打开笔记：可视化是一块嵌着的图
      await tree.locator(`[data-path="${NOTE}"]`).click()
      await expect(tabOn(page)).toContainText('笔记')
      const viz = page.locator('.pane:not([hidden]) .cm-viz')
      await viz.scrollIntoViewIfNeeded()
      await page.evaluate(() => document.querySelector('.pane:not([hidden]) .cm-viz')?.scrollIntoView({ block: 'center' }))
      await shot(run, `12-note-embed-${tag}`)
      await measure(page, `12-note-embed-${tag}`)
    } finally {
      await run.close()
    }
  })
}

test('对照图：1024 × 768 · 天青 · B（中间窄于 900：自动合一、按钮挪到为什么下面、标签条只留图标）', async () => {
  test.skip(!!process.env.CN_SHOT_LOOK && process.env.CN_SHOT_LOOK !== 'sky-b', '只截天青 B')
  mkdirSync(DIR!, { recursive: true })
  const run = await launch(DREAM2_VAULT, { CN_AI_FAKE: '1' }, (vault) => {
    prepareDream2(vault)
    const ud = join(dirname(vault), 'user-data')
    mkdirSync(ud, { recursive: true })
    writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: 'sky', frame: 'b', winBg: 'aurora' } }))
  })
  const { page } = run
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1024, 768))
    const card = page.getByTestId('dream-card')
    await card.getByRole('button', { name: '现在梦游' }).click()
    await expect(card.locator('h3')).toContainText('等你过目', { timeout: 60_000 })
    await card.getByRole('button', { name: '看报告' }).click()
    const panel = page.getByRole('complementary', { name: '梦游报告' })
    await panel.getByTestId('dream-item').filter({ hasText: '原名「极光」' }).click()
    await expect(page.locator('[data-testid="dream-tab"]:not([hidden])').getByTestId('dream-move')).toBeVisible()
    await shot(run, '13-narrow-1024-sky-b')
  } finally {
    await run.close()
  }
})
