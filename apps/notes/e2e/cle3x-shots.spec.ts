/**
 * 交付图（task-cle3x：数字格不再改数）。只在截图时跑：CN_SHOTS=目录，CN_SHOT_TONE=dark 截深湖（不给是天青），CN_SHOT_TAG=before/after 写进文件名。平时跳过。
 * 真按键：点开数字格 → 按 ↓ → 回车；再点开 → 滚轮滚三下 → 回车；打「20x3」回车；日期格按 ↓。
 * 每一步后文件里那一行记进 log-<标签>-<主题>.json，标框（截图像素，窗口 2 倍）记进 boxes-<标签>-<主题>.json。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { expect, type Locator, test } from '@playwright/test'
import { launch, openNote, pane, type Running } from './app'

const DIR = process.env.CN_SHOTS
const DARK = process.env.CN_SHOT_TONE === 'dark'
const TAG = process.env.CN_SHOT_TAG ?? 'after'
test.skip(!DIR, '只在截交付图时跑（CN_SHOTS=目录）')
const tone = DARK ? 'dark' : 'light'

const BASE =
  '```base\nfilters:\n  and:\n    - file.inFolder("论文")\nviews:\n  - type: table\n    name: 表格\n    order:\n      - file.name\n      - 年份\n      - 读完\n      - 作者\nproperties:\n  年份:\n    type: number\n  读完:\n    type: date\n```'
const PRIMER = '论文/A Primer on Memory Consistency.md'
const FILES: Record<string, string> = {
  '论文清单.md': `# 论文清单\n\n读过和要读的论文，一篇一条。\n\n${BASE}\n\n后面一段。\n`,
  [PRIMER]: '---\n年份: 2011\n读完: 2026-11-20\n作者: Sorin, Hill, Wood\n---\n',
  '论文/Algorithms for Scalable Synchronization.md': '---\n年份: 1991\n读完: 2026-10-02\n作者: Mellor-Crummey, Scott\n---\n',
  '论文/Attention Is All You Need.md': '---\n年份: 2017\n作者: Vaswani 等\n---\n',
}

function prepare(vault: string) {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: DARK ? 'petrol' : 'sky', frame: 'b', winBg: 'aurora' } }))
}

async function shot(run: Running, name: string, marks: Locator[] = []) {
  await run.page.waitForTimeout(500)
  const f = join(DIR!, `boxes-${TAG}-${tone}.json`)
  const all = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {}
  all[name] = []
  for (const m of marks) {
    if (!(await m.count())) continue
    const b = (await m.first().boundingBox())!
    all[name].push([b.x, b.y, b.width, b.height].map((v) => Math.round(v * 2)))
  }
  writeFileSync(f, JSON.stringify(all))
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(DIR!, `${name}-${TAG}-${tone}.png`), Buffer.from(b64, 'base64'))
}

test('交付图', async () => {
  test.setTimeout(180_000)
  mkdirSync(DIR!, { recursive: true })
  const run = await launch(FILES, {}, prepare)
  const { page, vault } = run
  const log: Record<string, string> = {}
  const line = (k: string) => (log[k] = readFileSync(join(vault, PRIMER), 'utf8').split('\n').filter((l) => /^(年份|读完):/.test(l)).join(' · '))
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1200, 760))
    await expect.poll(() => page.evaluate(() => innerHeight)).toBe(760)
    await openNote(page, '论文清单')
    const db = pane(page).locator('[data-part="数据库块"]')
    await expect(db.locator('tbody tr')).toHaveCount(3)
    const row = db.locator('tbody tr', { hasText: 'A Primer' })
    const year = row.locator('td').nth(1)
    const box = db.getByLabel('A Primer on Memory Consistency · 年份', { exact: true })
    line('0 打开')

    await year.click()
    await expect(box).toBeFocused()
    await shot(run, '1-open', [row.locator('td').nth(1)])
    await page.keyboard.press('ArrowDown')
    await shot(run, '2-down', [row.locator('td').nth(1)])
    await page.keyboard.press('Enter')
    await page.waitForTimeout(800)
    line('2 按↓回车')
    await shot(run, '3-enter', [row.locator('td').nth(1)])

    await year.click()
    await expect(box).toBeFocused()
    const b = (await box.boundingBox())!
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    for (let i = 0; i < 3; i++) {
      await page.mouse.wheel(0, 120)
      await page.waitForTimeout(60)
    }
    await shot(run, '4-wheel', [row.locator('td').nth(1)])
    await page.keyboard.press('Enter')
    await page.waitForTimeout(800)
    line('4 滚轮三下回车')

    await year.click()
    await expect(box).toBeFocused()
    await page.keyboard.press('Meta+A')
    await page.keyboard.type('20x3')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(300)
    await shot(run, '5-bad', [row.locator('td').nth(1), page.getByTestId('toast')])
    await page.keyboard.press('Escape')
    await page.waitForTimeout(800)
    line('5 打20x3回车')

    const day = row.locator('td').nth(2)
    await day.click()
    await page.keyboard.press('ArrowDown')
    await shot(run, '6-date-down', [day])
    await page.keyboard.press('Enter')
    await page.waitForTimeout(800)
    line('6 日期按↓回车')
    writeFileSync(join(DIR!, `log-${TAG}-${tone}.json`), JSON.stringify(log, null, 1))
  } finally {
    await run.close()
  }
})
