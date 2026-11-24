/**
 * task-h7oy8 梦游 Wiki 化交付截图（交付页 69-梦游Wiki施工）。CN_SHOTS=<目录> 时才跑；每张图的标框写进 boxes.json（截图像素，窗口 2 倍）。
 * 样本库那几张走 h7oy8-wiki.spec 同一份库和假 AI；CN_WIKI_VAULT=<真库拷贝，评测脚本跑过、链接已写进去> 时再在它的副本上截几张。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { expect, type Locator, type Page, test } from '@playwright/test'
import { launch, leftView, openNote, pane, rail, type Running, tabOn } from './app'
import { WIKI_FILES } from './fixtures/wiki'

const DIR = process.env.CN_SHOTS
test.skip(!DIR, '只在截交付图时跑（CN_SHOTS=目录）')

function look(vault: string, extra: Record<string, unknown> = {}) {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(
    join(ud, 'settings.json'),
    JSON.stringify({
      appearance: { followSystem: false, skin: 'sky', frame: 'b', winBg: 'aurora' },
      editor: { semantic: false },
      dream: { steps: { file: false, rename: false, week: false, viz: false, attach: false, dup: false, video: false } },
      ...extra,
    }),
  )
}

async function shot(run: Running, name: string, marks: Locator[] = []) {
  await run.page.waitForTimeout(600)
  const f = join(DIR!, 'boxes.json')
  const all = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {}
  all[name] = []
  for (const m of marks) {
    const b = await m.first().boundingBox()
    if (b) all[name].push([Math.round(b.x * 2), Math.round(b.y * 2), Math.round(b.width * 2), Math.round(b.height * 2)])
  }
  writeFileSync(f, JSON.stringify(all, null, 1))
  await run.page.screenshot({ path: join(DIR!, `${name}.png`) })
}

async function size(run: Running) {
  await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900))
  await run.page.waitForTimeout(400)
}

const report = (page: Page) => page.getByRole('complementary', { name: '梦游报告' })
const related = (page: Page) => page.getByRole('complementary', { name: '相关' })

test('样本库：报告里那一条、收下后的原句、⌘点到那一段、相关栏的词条卡、词条页里嵌进来的那一段', async () => {
  test.setTimeout(240_000)
  mkdirSync(DIR!, { recursive: true })
  const run = await launch(WIKI_FILES, { CN_AI_FAKE: '1', CN_FAKE_WIKI: '1' }, (v) => look(v))
  const { page } = run
  try {
    await size(run)
    // 改前：日记原样
    await openNote(page, '2026-10-11')
    await shot(run, 's0-before-journal', [pane(page).locator('.cm-line', { hasText: '训练：胸·三头' })])
    await page.evaluate(() => window.cn.dreamNow())
    await leftView(page, '梦游报告')
    const panel = report(page)
    const item = panel.getByTestId('dream-item').filter({ hasText: '链上 3 处' })
    await expect(item).toBeVisible({ timeout: 60_000 })
    await item.click()
    const detail = panel.getByTestId('dream-detail')
    await expect(detail.getByTestId('dream-change')).toHaveCount(2)
    await shot(run, 's1-report-item', [item, page.locator('[data-testid="dream-tab"]:not([hidden])').getByTestId('dream-evidence'), detail.getByTestId('dream-change').first(), panel.getByTestId('dream-wiki')])
    await detail.getByRole('button', { name: '收下', exact: true }).click()
    await expect(item).toContainText('已收下')
    await leftView(page, '最近')
    await openNote(page, '2026-10-11')
    await expect(pane(page).locator('.cm-wikilink', { hasText: '上斜哑铃卧推' })).toBeVisible()
    await shot(run, 's2-after-journal', [pane(page).locator('.cm-line', { hasText: '训练：胸·三头' })])
    await pane(page).locator('.cm-wikilink', { hasText: '上斜哑铃卧推' }).click({ modifiers: ['Meta'] })
    await expect(tabOn(page)).toHaveText('三分化训练计划')
    await shot(run, 's3-jump-block', [pane(page).locator('.cm-line', { hasText: '上斜哑铃卧推（辅助）' })])
    // 被链的那篇：右栏「相关」和文末「提到这篇的」写指着那一段
    await rail(page).getByRole('button', { name: /^相关/ }).click()
    await expect(related(page)).toBeVisible()
    await shot(run, 's4-plan-related', [related(page).locator('.rl-grp').first(), pane(page).locator('.doc-backlinks')])

    // 词条卡
    await openNote(page, '2026-10-18')
    const card = related(page).getByTestId('related-entry')
    await expect(card).toContainText('建词条页…')
    await shot(run, 's5-entry-card', [card])
    await card.click()
    await expect(card).toContainText('建好了', { timeout: 30_000 })
    await expect(related(page).getByTestId('related-entry-unsure')).toBeVisible()
    await shot(run, 's6-entry-made', [card, related(page).getByTestId('related-entry-linked'), related(page).getByTestId('related-entry-unsure')])
    await card.click()
    await expect(tabOn(page)).toHaveText('海德堡')
    const emb = pane(page).locator('[data-part="嵌进来的一段"]').first()
    await expect(emb).toBeVisible()
    await shot(run, 's7-entry-page', [pane(page).locator('.cm-line', { hasText: '梦游起草的词条' }), emb])
  } finally {
    await run.close()
  }
})

test('真库副本：日记里链到解剖课那一节、⌘点到第九节，被链的那篇底下指着那一节', async () => {
  test.skip(!process.env.CN_WIKI_VAULT, '要 CN_WIKI_VAULT')
  test.setTimeout(600_000)
  mkdirSync(DIR!, { recursive: true })
  const run = await launch({}, { CN_AI_FAKE: '1' }, (v) => {
    look(v)
    execFileSync('rsync', ['-a', '--exclude', '.git', '--exclude', '.git-orig-pointer', '--exclude', '.obsidian', process.env.CN_WIKI_VAULT!.replace(/\/?$/, '/'), v + '/'])
  })
  const { page } = run
  const jump = async (name: string) => {
    await page.keyboard.press('Meta+o')
    await page.getByRole('textbox', { name: '按名字跳到文件' }).fill(name)
    await page.getByRole('dialog', { name: '按名字跳到' }).getByRole('option').filter({ hasText: name }).first().click({ timeout: 60_000 })
    await expect(tabOn(page)).toHaveText(name)
  }
  try {
    await size(run)
    for (const [day, word] of JSON.parse(process.env.CN_WIKI_SHOTS ?? '[]') as [string, string][]) {
      await jump(day)
      const link = pane(page).locator('.cm-wikilink', { hasText: word }).first()
      await link.scrollIntoViewIfNeeded()
      await shot(run, `r-${day}-${word}`, [link])
      await link.click({ modifiers: ['Meta'] })
      await page.waitForTimeout(1200)
      await shot(run, `r-${day}-${word}-jump`, [])
    }
  } finally {
    await run.close()
  }
})
