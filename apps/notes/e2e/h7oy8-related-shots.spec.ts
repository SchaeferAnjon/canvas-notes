/**
 * 交付图（task-h7oy8 右栏「相关」）。只在截图时跑：CN_SHOTS=目录，CN_SHOT_TONE=dark 截深湖（不给是天青），B 浮岛书桌 + 极光背景（半透明面板）。
 * 样本库那几张照设计页 44 的状态截；CN_REAL_VAULT=<库> 时再在那个库的副本上打开《05-Amdahl定律》截一张（库先拷进临时目录、建 Git，原来的不动）。
 * 每张图的标框写进 boxes-<主题>.json（截图像素，窗口 2 倍）。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { expect, type Locator, type Page, test } from '@playwright/test'
import { launch, openNote, pane, rail, type Running } from './app'
import { dreamState, FILES, key, SPEED } from './fixtures/related'

const DIR = process.env.CN_SHOTS
const DARK = process.env.CN_SHOT_TONE === 'dark'
test.skip(!DIR, '只在截交付图时跑（CN_SHOTS=目录）')
const tone = DARK ? 'dark' : 'light'

function look(vault: string) {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: DARK ? 'petrol' : 'sky', frame: 'b', winBg: 'aurora' } }))
}

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

const related = (page: Page) => page.getByRole('complementary', { name: '相关' })
const relatedBtn = (page: Page) => rail(page).getByRole('button', { name: /^相关/ })
const row = (page: Page, name: string) => related(page).getByTestId('related-row').filter({ has: page.locator('.tt', { hasText: name }) })
const size = (run: Running) => run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))

test('交付图：样本库', async () => {
  test.setTimeout(240_000)
  mkdirSync(DIR!, { recursive: true })
  const run = await launch(FILES, { CN_AI_FAKE: '1' }, (v) => (look(v), dreamState(v)))
  const { page, vault, userData } = run
  try {
    await size(run)
    await expect.poll(() => page.evaluate(() => innerHeight)).toBe(887)
    await openNote(page, '05-Amdahl定律')
    // 1 小点：梦游又收下一条
    const f = join(userData, 'dream', key(vault) + '.json')
    const r = JSON.parse(readFileSync(f, 'utf8'))
    r.items.push({ id: 'k2', group: 'link', title: 'Speedup（加速比）', sub: '↔ [[05-Amdahl定律]]', why: '同一个式子：这篇算的就是那篇定义的加速比', commit: null, files: [SPEED], state: 'taken' })
    writeFileSync(f, JSON.stringify(r))
    writeFileSync(join(vault, SPEED), readFileSync(join(vault, SPEED), 'utf8') + '\n相关：[[05-Amdahl定律]]\n')
    execFileSync('git', ['-C', vault, '-c', 'user.name=梦游', '-c', 'user.email=dream@example.com', 'commit', '-qam', '梦游：「Speedup（加速比）」补上 [[05-Amdahl定律]]'])
    await openNote(page, 'HPC')
    await openNote(page, '05-Amdahl定律')
    await expect(rail(page).getByTestId('related-dot')).toHaveCount(1)
    await shot(run, '1-dot', [relatedBtn(page)])

    // 2 打开：三组
    await relatedBtn(page).click()
    await expect(row(page, '10-Amdahl定律（H&P视角）')).toBeVisible()
    await shot(run, '2-full', [related(page).locator('.rl-grp[data-group="mention"]'), related(page).locator('.rl-grp[data-group="dream"]')])
    // 3 往下滚：像但还没连的；悬停出按钮
    const gus = row(page, 'Gustafson-Law（古斯塔夫森定律）')
    await gus.scrollIntoViewIfNeeded()
    await gus.hover()
    await shot(run, '3-like-hover', [gus.locator('.acts'), related(page).locator('.rl-grp[data-group="like"]')])
    // 4 点「连上」：原句里那几个字变成链接，那条原地留一句带「撤销」
    await gus.getByRole('button', { name: '连上' }).click()
    const done = related(page).getByTestId('related-done').first()
    await expect(done).toBeVisible()
    await expect(pane(page).locator('.cm-wikilink', { hasText: 'Gustafson' })).toBeVisible()
    await page.mouse.move(700, 400)
    console.log('[status after link]', JSON.stringify(execFileSync('git', ['-C', vault, 'status', '--porcelain'], { encoding: 'utf8' })))
    await shot(run, '4-linked', [done, pane(page).locator('.cm-line', { hasText: '的反驳在下一篇' })])
    await done.getByRole('button', { name: '撤销' }).click()
    await expect(row(page, 'Gustafson-Law（古斯塔夫森定律）')).toBeVisible()
    // 5 ⌘ 停在一条上
    await related(page).locator('.rl-scroll').evaluate((e) => (e.scrollTop = 0))
    const hp = row(page, '10-Amdahl定律（H&P视角）')
    await hp.hover()
    await page.keyboard.down('Meta')
    await expect(page.getByTestId('peek')).toBeVisible()
    await shot(run, '5-peek', [hp, page.getByTestId('peek')])
    await page.keyboard.up('Meta')
    // 浮窗常驻（⌘预览常驻）：松开 ⌘ 不收，Esc 收
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('peek')).toHaveCount(0)
    // 6 光标这一段
    await pane(page).locator('.cm-line', { hasText: '加速比 a = 1/(s + p/N)' }).click()
    await related(page).getByRole('tab', { name: '光标这一段' }).click()
    await expect(related(page).locator('.rl-grp[data-group="para"]')).toBeVisible()
    await shot(run, '6-para', [related(page).getByTestId('related-where'), related(page).locator('.rl-grp[data-group="para"]')])
    await related(page).getByRole('tab', { name: '整篇' }).click()
    // 7 文末「提到这篇的」
    await pane(page).locator('.doc-backlinks').scrollIntoViewIfNeeded()
    await shot(run, '7-doc-end', [pane(page).locator('.doc-backlinks')])
    // 11 梦游连上的那条悬停出「撤掉」
    const gpu = related(page).locator('.rl-grp[data-group="dream"]').getByTestId('related-row').first()
    await gpu.scrollIntoViewIfNeeded()
    await gpu.hover()
    await shot(run, '11-dream-hover', [gpu.locator('.acts'), gpu])
    // 12 没人提到的那篇
    await openNote(page, '随手 3')
    await expect(related(page).getByTestId('related-no-mention')).toBeVisible()
    await page.mouse.move(700, 400)
    await shot(run, '12-no-mention', [related(page).locator('.rl-grp[data-group="mention"]'), related(page).locator('.rl-grp[data-group="like"]')])
  } finally {
    await run.close()
  }
})

test('交付图：新库、没人提到这篇', async () => {
  test.setTimeout(120_000)
  mkdirSync(DIR!, { recursive: true })
  const run = await launch({ '收件箱/第一篇.md': '# 第一篇\n\n随手记一句。\n', '收件箱/第二篇.md': '# 第二篇\n\n提到 [[第一篇]]。\n' }, { CN_AI_FAKE: '1' }, look)
  const { page } = run
  try {
    await size(run)
    await openNote(page, '第二篇')
    await relatedBtn(page).click()
    await expect(related(page).getByTestId('related-empty')).toBeVisible()
    await shot(run, '8-new-vault', [related(page).getByTestId('related-empty')])
  } finally {
    await run.close()
  }
})

test('交付图：真库副本', async () => {
  test.skip(!process.env.CN_REAL_VAULT, '要 CN_REAL_VAULT')
  test.setTimeout(600_000)
  mkdirSync(DIR!, { recursive: true })
  const run = await launch({}, { CN_AI_FAKE: '1' }, (v) => {
    look(v)
    execFileSync('rsync', ['-a', '--exclude', '.git', '--exclude', '.obsidian', process.env.CN_REAL_VAULT!.replace(/\/?$/, '/'), v + '/'])
  })
  const { page } = run
  try {
    await size(run)
    // 左栏「最近」不一定列着它：⌘O 按名字跳
    await page.keyboard.press('Meta+o')
    await page.getByRole('textbox', { name: '按名字跳到文件' }).fill('05-Amdahl定律')
    await page.getByRole('dialog', { name: '按名字跳到' }).getByRole('option').filter({ hasText: '05-Amdahl定律' }).first().click({ timeout: 60_000 })
    await expect(page.getByTestId('tab-list').locator('.tab.on')).toContainText('05-Amdahl定律')
    await relatedBtn(page).click()
    await expect(related(page).getByTestId('related-row').first()).toBeVisible({ timeout: 60_000 })
    const ms = await page.evaluate(async () => {
      const p = (document.querySelector('[data-cite-base]') as HTMLElement).dataset.citeBase!
      const out: number[] = []
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now()
        await window.cn.related(p)
        out.push(Math.round(performance.now() - t0))
      }
      return out
    })
    writeFileSync(join(DIR!, `real-ms-${tone}.json`), JSON.stringify({ openMs: ms }))
    await shot(run, '9-real', [related(page).locator('.rl-grp[data-group="mention"]')])
    await pane(page).locator('.doc-backlinks').scrollIntoViewIfNeeded()
    await shot(run, '10-real-doc-end', [pane(page).locator('.doc-backlinks')])
  } finally {
    await run.close()
  }
})
