// 在一个真库的拷贝上真开生长图、截图（task-h7oy8）：第一个月、半年后、现在、选中一篇只看它周围、只看一个文件夹，
// 再梦游一晚（只补双链，CN_REAL_DUP=1 再找可能重复；不用 AI）全部收下，截梦游前、梦游后、报告顶上那晚的小图。数（后台算了多久等）写进 CN_SHOTS/growth.json。
// 给的库必须是一份拷贝；还不是 Git 库时这里 git init、整个提交一次（当成「导入那天」）。平时跳过：
//   CN_REAL_VAULT=<库的拷贝> CN_SHOTS=<截图目录> [CN_REAL_PICK=<选中的那篇的路径>] [CN_REAL_FOLDER=<只看的文件夹>] npx playwright test e2e/real-h7oy8-growth.spec.ts
import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import electronPath from 'electron'
import { leftView, tabOn } from './app'

const VAULT = process.env.CN_REAL_VAULT ?? ''
test.skip(!VAULT, '真库才跑：CN_REAL_VAULT=<库的拷贝>')
test.setTimeout(60 * 60_000)

const canvas = (page: Page) => page.getByTestId('growth-canvas')
const jump = (page: Page, name: string) => page.getByTestId('growth-jumps').getByRole('button', { name, exact: true }).click()

test('真库：生长图第一个月、半年后、现在、局部、文件夹，梦游一晚前后', async () => {
  const shots = process.env.CN_SHOTS || join(dirname(VAULT), 'shots')
  const userData = join(dirname(VAULT), 'user-data')
  mkdirSync(shots, { recursive: true })
  if (!existsSync(join(VAULT, '.git'))) {
    // 梦游只动画布笔记自己的分类文件夹（收件箱、剪藏、阅读、周记）：从 Obsidian 导进来时剪藏那一类换成「剪藏」（CN_REAL_RENAME=40-Clippings:剪藏）
    for (const pair of (process.env.CN_REAL_RENAME ?? '').split(',').filter(Boolean)) {
      const [from, to] = pair.split(':') as [string, string]
      renameSync(join(VAULT, from), join(VAULT, to))
    }
    const g = (...a: string[]) => execFileSync('git', ['-C', VAULT, ...a], { maxBuffer: 64 * 1024 * 1024 })
    g('init', '-q', '-b', 'main')
    g('add', '-A')
    g('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', '导入')
  }
  mkdirSync(userData, { recursive: true })
  writeFileSync(
    join(userData, 'settings.json'),
    JSON.stringify({
      editor: { semantic: false },
      dream: {
        auto: false,
        steps: { file: false, rename: false, week: false, viz: false, attach: false, dup: process.env.CN_REAL_DUP === '1', video: false, link: true },
      },
    }),
  )
  const app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [join(__dirname, '../out/main/index.js')],
    env: { ...process.env, CN_VAULT: VAULT, CN_USER_DATA: userData, CN_E2E: '1', CN_NO_AX: '1', CN_QUICK_KEY: 'Alt+Command+Shift+F19', CN_TRASH_DIR: join(dirname(VAULT), 'trash'), CN_ICLOUD_CONTAINER: join(dirname(VAULT), 'icloud') },
  })
  const page = await app.firstWindow()
  const out: Record<string, unknown> = {}
  const shot = async (name: string) => {
    await page.waitForTimeout(400)
    await page.screenshot({ path: join(shots, `${name}.png`) })
  }
  try {
    await page.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined)
    await expect(page.locator('.vault b')).toBeVisible({ timeout: 120_000 })
    await leftView(page, '梦游报告')
    const t0 = Date.now()
    await page.getByTestId('dream-seg-growth').click()
    await expect(tabOn(page)).toContainText('生长')
    await expect.poll(async () => Number(await canvas(page).getAttribute('data-notes')), { timeout: 20 * 60_000 }).toBeGreaterThan(100)
    out.firstOpenMs = Date.now() - t0
    const st = await page.evaluate(() => window.cn.growthData())
    const d = st.data!
    out.notes = d.notes.length
    out.links = d.links.length
    out.dreamLinks = d.links.filter((l) => l.dream).length
    out.est = d.notes.filter((n) => n.est).length
    out.from = d.notes.reduce<Record<string, number>>((a, n) => ((a[n.from] = (a[n.from] ?? 0) + 1), a), {})
    out.nights = d.nights.length
    out.imports = d.imports
    out.worker = d.ms
    console.log('真库生长图', JSON.stringify(out))

    await jump(page, '第一个月')
    await shot('real-first-month')
    await jump(page, '半年后')
    await shot('real-half-year')
    await jump(page, '现在')
    await shot('real-now')

    // 选中一篇（默认：链接最多的那篇），只看它周围
    const target =
      process.env.CN_REAL_PICK ||
      (() => {
        const deg = new Map<number, number>()
        for (const l of d.links) {
          deg.set(l.a, (deg.get(l.a) ?? 0) + 1)
          deg.set(l.b, (deg.get(l.b) ?? 0) + 1)
        }
        const best = [...deg].filter(([i]) => !/MOC|Hub|Home|course-map|目录/i.test(d.notes[i]!.path)).sort((a, b) => b[1] - a[1])[0]!
        return d.notes[best[0]]!.path
      })()
    const p = (await page.evaluate((q) => (window as unknown as { cnGrowthPerf: { at(p: string): { x: number; y: number } | null } }).cnGrowthPerf.at(q), target))!
    await page.mouse.click(p.x, p.y)
    await expect(page.getByTestId('growth-card')).toBeVisible()
    await shot('real-selected')
    await page.getByTestId('growth-card').getByRole('button', { name: '只看它周围' }).click()
    await shot('real-local')
    await page.getByTestId('growth-card').getByRole('button', { name: '回到全库' }).click()
    await page.getByTestId('growth-card').getByRole('button', { name: '不选这篇' }).click()

    // 只看一个文件夹
    const folder = process.env.CN_REAL_FOLDER
    if (folder) {
      await page.getByTestId('growth-folder').click()
      await page.getByTestId('growth-folders').getByRole('menuitem', { name: new RegExp(`^\\s*${folder.split('/').pop()} · `) }).first().click()
      await shot('real-folder')
      await page.getByTestId('growth-folder').click()
      await page.getByTestId('growth-folders').getByRole('menuitem', { name: /^全库/ }).click()
    }

    // 以前的一晚整理（库里的更新日志）
    const logNight = page.getByTestId('growth-night').filter({ hasText: '整理' }).first()
    if (await logNight.count()) {
      await logNight.click()
      await shot('real-log-night')
    }

    // 梦游一晚：只补双链、找可能重复（不用 AI），全部收下
    // CN_REAL_NO_DREAM=1：已经梦游过一晚（同一份拷贝再截一遍图），不再梦游
    if (process.env.CN_REAL_NO_DREAM !== '1') {
      const d0 = Date.now()
      const report = await page.evaluate(() => window.cn.dreamNow())
      out.dreamMs = Date.now() - d0
      out.dreamItems = report.items.map((i) => i.group).join(',')
      await page.evaluate(() => window.cn.dreamTakeAll())
    }
    // 收下以后库变了：等后台重算完（左栏、小图、中间都换成新的）
    const settled = async () => {
      await expect.poll(() => page.evaluate(() => window.cn.growthData().then((x) => x.building)), { timeout: 20 * 60_000, intervals: [2000] }).toBe(false)
      await expect(page.locator('.gr-busy')).toHaveCount(0, { timeout: 60_000 })
    }
    await settled()
    await page.getByTestId('dream-seg-report').click()
    const thumb = page.getByTestId('growth-thumb')
    await expect(thumb).toContainText('连了', { timeout: 20 * 60_000 })
    await shot('real-report-thumb')
    await thumb.click()
    await expect(canvas(page)).not.toHaveAttribute('data-night', '')
    await shot('real-after-dream')
    await jump(page, '梦游前')
    await shot('real-before-dream')
    await jump(page, '梦游后')
    await settled()
    const st2 = await page.evaluate(() => window.cn.growthData())
    out.afterDream = { links: st2.data!.links.length, dreamLinks: st2.data!.links.filter((l) => l.dream).length, ms: st2.data!.ms }
    // 深色
    await page.emulateMedia({ colorScheme: 'dark' })
    await shot('real-after-dream-dark')
    await page.emulateMedia({ colorScheme: 'light' })
    writeFileSync(join(shots, 'growth.json'), JSON.stringify(out, null, 2))
    console.log('真库生长图', JSON.stringify(out))
  } finally {
    await app.close()
  }
})
