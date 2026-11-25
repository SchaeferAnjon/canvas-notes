/**
 * 生长图（task-h7oy8，设计页 44「2. 生长图」方向 A，用户「全按推荐」）：都是真点，窗口不上屏（CN_E2E=1），临时库。
 * 样本库按日子一次次提交：2025-03-01 第一篇、3 到 4 月 HPDC 课一讲一讲加、6 月几篇剪藏、9 月 1 日一次导入 35 篇（老的，时间要估）、
 * 10 月 2 日夜里梦游补了两条双链，最后一篇还没提交。
 */
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { acts, launch, leftView, pane, tabOn } from './app'
import { DREAM2_VAULT, prepareDream2 } from './fixtures/dream2'

const commitAt = (vault: string, when: string, msg: string) => {
  execFileSync('git', ['-C', vault, 'add', '-A'])
  execFileSync('git', ['-C', vault, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', msg], { env: { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } })
}
const put = (vault: string, p: string, text: string) => {
  mkdirSync(dirname(join(vault, p)), { recursive: true })
  writeFileSync(join(vault, p), text)
}
const ymd = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
/** 本地日历的第几天（和软件里 dayOf 一样数） */
const dayNo = (s: string) => Math.floor(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86_400_000)

function prepareHistory(vault: string) {
  put(vault, '写作/开始.md', '# 开始\n\n今天开始用画布笔记。\n')
  commitAt(vault, '2025-03-01T10:00:00', '新建')
  put(vault, '课程/HPDC/Amdahl定律.md', '# Amdahl定律\n\n加速比的上限由串行的那一部分决定。\n')
  commitAt(vault, '2025-03-08T10:00:00', 'Amdahl')
  for (let i = 1; i <= 20; i++) {
    put(vault, `课程/HPDC/第${i}讲.md`, `# 第${i}讲\n\n${i > 1 ? `接着 [[第${i - 1}讲]]。` : '第一讲。'}${i % 5 === 0 ? '这一讲用到 [[Amdahl定律]]。' : ''}\n`)
    commitAt(vault, `${ymd(2025, i <= 10 ? 3 : 4, i <= 10 ? 10 + i : i - 8)}T10:00:00`, `第${i}讲`)
  }
  for (let i = 1; i <= 5; i++) put(vault, `剪藏/并行/剪藏${i}.md`, `---\nsource: https://example.com/${i}\n---\n# 剪藏${i}\n\n讲并行计算的第 ${i} 篇。\n`)
  commitAt(vault, '2025-06-12T21:00:00', '剪藏')
  // 一次导入 35 篇：前 20 篇写了创建日期（2023 年），后 15 篇没写，只能看修改时间（2024-05-10），画空心
  for (let i = 1; i <= 35; i++) {
    const p = `导入/旧库/旧笔记${i}.md`
    put(vault, p, `${i <= 20 ? `---\ncreated: ${ymd(2023, 1 + (i % 12), 3)}\n---\n` : ''}# 旧笔记${i}\n\n${i > 1 ? `见 [[旧笔记${i - 1}]]` : ''}\n`)
    if (i > 20) utimesSync(join(vault, p), new Date('2024-05-10T12:00:00'), new Date('2024-05-10T12:00:00'))
  }
  commitAt(vault, '2025-09-01T09:00:00', '从 Obsidian 导入 35 篇')
  // 10 月 2 日夜里梦游：补两条双链
  put(vault, '剪藏/并行/剪藏1.md', '---\nsource: https://example.com/1\n---\n# 剪藏1\n\n讲并行计算的第 1 篇。\n\n相关：[[Amdahl定律]]\n')
  commitAt(vault, '2025-10-02T02:30:00', '梦游：「剪藏1」补上 [[Amdahl定律]]')
  put(vault, '剪藏/并行/剪藏2.md', '---\nsource: https://example.com/2\n---\n# 剪藏2\n\n讲并行计算的第 2 篇。\n\n相关：[[第5讲]]\n')
  commitAt(vault, '2025-10-02T02:31:00', '梦游：「剪藏2」补上 [[第5讲]]')
  // 还没提交的一篇（launch 最后那次提交带上它）
  put(vault, '收件箱/新的一篇.md', '# 新的一篇\n\n记一下 [[开始]]。\n')
}
const TOTAL = 1 + 1 + 20 + 5 + 35 + 1

const canvas = (page: Page) => page.getByTestId('growth-canvas')
const num = async (page: Page, attr: string) => Number(await canvas(page).getAttribute(attr))
/** 某一篇在窗口里的位置（生长图自己报的，测试照这个真点） */
const at = (page: Page, path: string) => page.evaluate((p) => (window as unknown as { cnGrowthPerf: { at(p: string): { x: number; y: number } | null } }).cnGrowthPerf.at(p), path)

/** 左栏梦游报告 › 生长：中间开「生长」标签，等数据算好 */
async function openGrowth(page: Page) {
  await leftView(page, '梦游报告')
  await page.getByTestId('dream-seg-growth').click()
  await expect(tabOn(page)).toContainText('生长')
  await expect(canvas(page)).toHaveAttribute('data-notes', String(TOTAL), { timeout: 30_000 })
}

test('打开生长看法：全库、群名、图例；跳到第一个月；播放一颗颗亮起；拖时间轴；点左栏一晚看那晚梦游做了什么', async () => {
  test.setTimeout(150_000)
  const run = await launch({}, {}, prepareHistory)
  const { page } = run
  try {
    await openGrowth(page)
    // 现在：全库、两条梦游连的线，群名写在图上（HPDC 那一团 21 篇）
    await expect(page.getByTestId('growth-info')).toContainText(`${TOTAL}篇笔记`)
    await expect(page.getByTestId('growth-info')).toContainText('2条是梦游连的')
    await expect.poll(async () => (await canvas(page).getAttribute('data-labels')) ?? '').toContain('HPDC')
    await expect(page.getByTestId('growth-legend')).toContainText('导入')
    await expect(page.getByTestId('growth-legend')).toContainText('梦游连的')
    await expect(page.getByTestId('growth-legend')).toContainText('空心：时间是估的')

    // 第一个月：时间轴从 2023 年那批写了创建日期的旧笔记开始（导入前，估的）
    const jumps = page.getByTestId('growth-jumps')
    await jumps.getByRole('button', { name: '第一个月' }).click()
    const first = await num(page, 'data-notes')
    expect(first).toBeGreaterThan(0)
    expect(first).toBeLessThan(10)
    await expect(page.getByTestId('growth-info')).toContainText('2023年')
    await expect(page.getByTestId('growth-info')).toContainText('导入前的时间是估的')

    // 播放：日子往前走、篇数一路变多，走到今天自己停
    await page.getByTestId('growth-play').click()
    await expect(page.getByTestId('growth-play')).toHaveAttribute('aria-label', '暂停')
    const d0 = await num(page, 'data-day')
    await expect.poll(() => num(page, 'data-day')).toBeGreaterThan(d0)
    const seen: number[] = []
    for (let k = 0; k < 6; k++) {
      seen.push(await num(page, 'data-notes'))
      await page.waitForTimeout(150)
    }
    expect([...seen].sort((a, b) => a - b)).toEqual(seen)
    await expect(page.getByTestId('growth-play')).toHaveAttribute('aria-label', '播放', { timeout: 30_000 })
    await expect(canvas(page)).toHaveAttribute('data-notes', String(TOTAL))

    // 拖时间轴：按住从最左拖到 2025 年 3 月底那里
    const tl = (await page.getByTestId('growth-timeline').boundingBox())!
    await page.mouse.move(tl.x + 10, tl.y + 10)
    await page.mouse.down()
    await page.mouse.move(tl.x + tl.width * 0.3, tl.y + 10, { steps: 6 })
    const mid = await num(page, 'data-day')
    await page.mouse.move(tl.x + tl.width * 0.6, tl.y + 10, { steps: 6 })
    await page.mouse.up()
    const later = await num(page, 'data-day')
    expect(later).toBeGreaterThan(mid)
    expect(await num(page, 'data-notes')).toBeLessThanOrEqual(TOTAL)

    // 左栏「每一晚」：10 月 2 日那晚（梦游的提交），点了图停到那天、那晚两条线加粗，下面列出那晚做了什么
    const night = page.getByTestId('growth-night').filter({ hasText: '2025年10月2日' })
    await expect(night).toContainText('连了2条线')
    await night.click()
    await expect(canvas(page)).toHaveAttribute('data-night', String(dayNo('2025-10-02')))
    await expect(canvas(page)).toHaveAttribute('data-day', String(dayNo('2025-10-02')))
    await expect(page.getByTestId('growth-info')).toContainText('梦游的一晚')
    // 左上「这晚动了 2 篇 · 看这几篇」：点了视角移过去，那两篇在画布里
    await page.getByTestId('growth-these').click()
    await expect(page.getByTestId('growth-these')).toContainText('这晚动了2篇')
    const stage = (await page.locator('.gr-stage').boundingBox())!
    for (const q of ['剪藏/并行/剪藏1.md', '剪藏/并行/剪藏2.md']) {
      const pt = (await at(page, q))!
      expect(pt.x > stage.x && pt.x < stage.x + stage.width && pt.y > stage.y && pt.y < stage.y + stage.height).toBe(true)
    }
    const did = page.getByTestId('growth-night-detail')
    await expect(did).toContainText('「剪藏1」补上 [[Amdahl定律]]')
    await expect(did).toContainText('「剪藏2」补上 [[第5讲]]')
    // 点那晚的一条：图上选中那篇，出它的卡片
    await did.getByRole('button', { name: /剪藏1/ }).click()
    await expect(page.getByTestId('growth-card').locator('h3')).toHaveText('剪藏1')
    await expect(page.getByTestId('growth-card')).toContainText('梦游 · 2025年10月2日')
    await page.screenshot({ path: test.info().outputPath('night.png') })

    // 梦游前、梦游后
    await jumps.getByRole('button', { name: '梦游前' }).click()
    await expect(canvas(page)).toHaveAttribute('data-day', String(dayNo('2025-10-01')))
    await expect(canvas(page)).toHaveAttribute('data-night', '')
    await jumps.getByRole('button', { name: '现在' }).click()
    await expect(canvas(page)).toHaveAttribute('data-notes', String(TOTAL))
  } finally {
    await run.close()
  }
})

test('点一篇出卡片、打开笔记、双击打开、⌘ 停住弹出那篇；只看它周围；只看一个文件夹；估的画空心能关', async () => {
  test.setTimeout(150_000)
  const run = await launch({}, {}, prepareHistory)
  const { page } = run
  try {
    await openGrowth(page)
    // 点 Amdahl定律：卡片写哪个文件夹、哪天加进来（Git 记的）、几条链接（第5、10、15、20讲和梦游连的剪藏1）
    let p = (await at(page, '课程/HPDC/Amdahl定律.md'))!
    await page.mouse.click(p.x, p.y)
    const card = page.getByTestId('growth-card')
    await expect(card.locator('h3')).toHaveText('Amdahl定律')
    await expect(card).toContainText('课程 / HPDC')
    await expect(card).toContainText('2025年3月8日加进来')
    await expect(card).toContainText('Git 记的')
    await expect(card).toContainText('5条链接，其中1条是梦游连的')

    // 只看它周围：两步以内（一步：第5、10、15、20讲、剪藏1；两步：第4、6、9、11、14、16、19讲和梦游连着第5讲的剪藏2）
    const all = await num(page, 'data-shown')
    await card.getByRole('button', { name: '只看它周围' }).click()
    await expect.poll(() => num(page, 'data-shown')).toBe(1 + 5 + 8)
    await card.getByRole('button', { name: '回到全库' }).click()
    await expect.poll(() => num(page, 'data-shown')).toBe(all)

    // ⌘ 停在一篇上：弹出那篇（开发版已有的 peek）
    p = (await at(page, '课程/HPDC/Amdahl定律.md'))!
    await page.mouse.move(p.x + 1, p.y + 1)
    // 选中的那篇不出悬停提示（卡片上都有）
    await expect(page.getByTestId('growth-hot')).toBeVisible()
    await expect(page.getByTestId('growth-tip')).toHaveCount(0)
    await page.keyboard.down('Meta')
    await expect(page.locator('.pk[data-depth="0"] .pk-t')).toHaveText('Amdahl定律')
    await expect(page.locator('.pk[data-depth="0"]').getByTestId('peek-doc')).toContainText('加速比的上限')
    await page.keyboard.up('Meta')
    // 浮窗常驻（⌘预览常驻）：松开 ⌘ 不收，Esc 收
    await page.keyboard.press('Escape')
    await expect(page.locator('.pk')).toHaveCount(0, { timeout: 5000 })

    // 卡片上「打开笔记」：中间开这篇
    await card.getByRole('button', { name: '打开笔记' }).click()
    await expect(tabOn(page)).toContainText('Amdahl定律')
    await expect(pane(page).locator('.cm-content')).toContainText('加速比的上限')

    // 回到生长：双击另一篇也打开
    await page.getByTestId('tab-list').locator('.tab', { hasText: '生长' }).click()
    await expect(canvas(page)).toHaveAttribute('data-notes', String(TOTAL))
    p = (await at(page, '写作/开始.md'))!
    await page.mouse.move(p.x, p.y)
    await expect(page.getByTestId('growth-tip')).toContainText('开始')
    await expect(page.getByTestId('growth-tip')).toContainText('写作 · 2025年3月1日')
    await page.mouse.dblclick(p.x, p.y)
    await expect(tabOn(page)).toContainText('开始')
    await page.getByTestId('tab-list').locator('.tab', { hasText: '生长' }).click()

    // 只看一个文件夹：导入/旧库（35 篇；和它连着的外面的笔记淡着画，这里没有）
    await acts(page).getByTestId('growth-folder').click()
    const menu = page.getByTestId('growth-folders')
    await menu.getByRole('menuitem', { name: /旧库 · 35/ }).click()
    await expect(acts(page).getByTestId('growth-folder')).toContainText('旧库')
    await expect.poll(() => num(page, 'data-shown')).toBe(35)
    await page.screenshot({ path: test.info().outputPath('folder.png') })
    await acts(page).getByTestId('growth-folder').click()
    await menu.getByRole('menuitem', { name: /^全库/ }).click()
    await expect.poll(() => num(page, 'data-shown')).toBe(TOTAL)

    // 估的画空心：默认开着，点了关
    const hollow = acts(page).getByRole('button', { name: '估的画空心' })
    await expect(hollow).toHaveAttribute('aria-pressed', 'true')
    await hollow.click()
    await expect(hollow).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByTestId('growth-legend')).not.toContainText('空心')
  } finally {
    await run.close()
  }
})

test('梦游一晚收下以后：报告顶上放那晚的小图，点开是整张、停在这一晚；左栏换到「生长」列着这一晚', async () => {
  test.setTimeout(150_000)
  const run = await launch(DREAM2_VAULT, { CN_AI_FAKE: '1' }, prepareDream2)
  const { page } = run
  try {
    const card = page.getByTestId('dream-card')
    await card.getByRole('button', { name: '现在梦游' }).click()
    await expect(card.locator('h3')).toContainText('等你过目', { timeout: 60_000 })
    await card.getByRole('button', { name: '看报告' }).click()
    const panel = page.getByRole('complementary', { name: '梦游报告' })
    await panel.getByRole('button', { name: '全部收下' }).click()
    await expect(panel.getByTestId('dream-left')).toContainText('都看完了', { timeout: 30_000 })
    const thumb = panel.getByTestId('growth-thumb')
    await expect(thumb).toContainText('连了1条线', { timeout: 30_000 })
    await page.screenshot({ path: test.info().outputPath('thumb.png') })
    await thumb.click()
    await expect(tabOn(page)).toContainText('生长')
    const today = await page.evaluate(() => Math.floor((Date.now() - new Date().getTimezoneOffset() * 60_000) / 86_400_000))
    await expect(canvas(page)).toHaveAttribute('data-night', String(today))
    await expect(page.getByTestId('growth-info')).toContainText('梦游的一晚')
    await expect(panel.getByTestId('dream-seg-growth')).toHaveAttribute('aria-selected', 'true')
    const nightRow = panel.getByTestId('growth-night').first()
    await expect(nightRow).toContainText('这份报告')
    await expect(panel.getByTestId('growth-night-detail')).toContainText('极光')
    await panel.getByTestId('growth-night-detail').getByRole('button', { name: '看这晚的报告' }).click()
    await expect(panel.getByTestId('dream-summary')).toBeVisible()
  } finally {
    await run.close()
  }
})
