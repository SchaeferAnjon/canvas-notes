import { expect, test, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { age, gitStatus, launch, pane, pickFromNoteMenu, waitSaved, tabOn, leftView, openInboxTab } from './app'
import { ICELAND } from './fixtures/board'
import { makeBigVault, type BigVaultStats } from './fixtures/big-vault'

const side = (page: Page) => page.locator('.side')
const group = (page: Page, name: string) => page.locator('.nav').getByRole('group', { name })
/** 一组里每行的名字（右边的时间不算） */
const names = (page: Page, name: string) => group(page, name).locator('.si .truncate')
const sideRow = (page: Page, title: string) => page.locator('.nav .si').filter({ has: page.locator('.truncate', { hasText: new RegExp(`^${title}$`) }) })
const pinsFile = (vault: string) => join(vault, '.canvas-notes', '置顶.json')
const settingsDialog = (page: Page) => page.getByRole('dialog', { name: '设置' })
const settingsOf = (userData: string) => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'))
/** 截图放哪：CN_SHOTS 指定了就放那里（交付页用），不然放测试输出目录 */
const shot = (name: string) => {
  const dir = process.env.CN_SHOTS
  if (!dir) return test.info().outputPath(name)
  mkdirSync(dir, { recursive: true })
  return join(dir, name)
}

/** 一个小库：这周的、上个月的、很久以前的文档和白板、很久以前的速记 */
const SMALL = {
  '这周写的.md': '# 这周写的\n\n刚写的。\n',
  '上个月.md': '# 上个月\n\n四十五天前改的。\n',
  '很久以前.md': '# 很久以前\n\n两百天前改的。\n',
  '旧白板.md': ICELAND,
  '收件箱/老速记.md': '---\ncreated: 2026-01-01 10:00\n---\n很久以前记的一句\n',
}
const agedSmall = (vault: string) => {
  age(vault, '上个月.md', 45)
  age(vault, '很久以前.md', 200)
  // 和「很久以前」差 10 天：两个都写 200 天时，两次 age() 之间时钟走过 1 毫秒，旧白板就新了 1 毫秒、在归档列表里排到前面（全套跑时偶尔失败的原因）
  age(vault, '旧白板.md', 210)
  age(vault, '收件箱/老速记.md', 300)
}

async function openVaultSettings(page: Page) {
  await page.keyboard.press('Meta+,')
  await settingsDialog(page).getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: '库', exact: true }).click()
}

test('置顶：右键「置顶」进左栏最上面一组，存在库里 .canvas-notes/置顶.json；改名跟着走；「取消置顶」拿掉；归档里的笔记置顶后回到左栏', async () => {
  const run = await launch(SMALL, {}, agedSmall)
  const { page, vault } = run
  try {
    await expect(group(page, '置顶')).toHaveCount(0)
    await pickFromNoteMenu(run, '置顶')
    await sideRow(page, '这周写的').click({ button: 'right' })
    await expect(names(page, '置顶')).toHaveText(['这周写的'])
    // 置顶的不在下面「今天」里重复
    await expect(group(page, '今天').locator('.si', { hasText: '这周写的' })).toHaveCount(0)
    expect(JSON.parse(readFileSync(pinsFile(vault), 'utf8'))).toEqual(['这周写的.md'])
    expect(readFileSync(pinsFile(vault), 'utf8')).toBe('[\n  "这周写的.md"\n]\n')
    // 进 Git：底栏看得到一个没提交的文件
    expect(gitStatus(vault)).toBe('?? .canvas-notes/置顶.json\n')
    await expect(page.locator('.gitbar').getByTestId('git-changed')).toContainText('1处没提交')

    // 改名：置顶跟着换路径
    await pickFromNoteMenu(run, '重命名')
    await sideRow(page, '这周写的').click({ button: 'right' })
    const input = page.locator('.nav').getByRole('textbox', { name: '新名字' })
    await input.fill('置顶的那篇')
    await input.press('Enter')
    await expect(names(page, '置顶')).toHaveText(['置顶的那篇'])
    await expect.poll(() => JSON.parse(readFileSync(pinsFile(vault), 'utf8'))).toEqual(['置顶的那篇.md'])

    // 归档里的「很久以前」：在归档列表里右键置顶，回到左栏置顶组，归档少一篇
    await expect(page.getByTestId('archive-count')).toHaveText('2篇')
    await side(page).getByRole('button', { name: /^归档/ }).click()
    const list = pane(page).getByRole('list', { name: '归档的笔记' })
    await expect(list.getByRole('listitem')).toHaveCount(2)
    await pickFromNoteMenu(run, '置顶')
    await list.getByRole('listitem').filter({ hasText: '很久以前' }).getByRole('button').click({ button: 'right' })
    await expect(names(page, '置顶')).toHaveText(['置顶的那篇', '很久以前'])
    await expect(page.getByTestId('archive-count')).toHaveText('1篇')
    await expect(list.getByRole('listitem')).toHaveCount(1)
    // 中间的「最近」整页：归档了的也列（找东西用），按月收起在「更早」的月份里
    await side(page).getByRole('button', { name: '在中间打开' }).click()
    const all = pane(page).getByRole('list', { name: '最近的笔记' })
    await pane(page).getByRole('textbox', { name: '筛选' }).fill('旧白板')
    await expect(all.getByRole('listitem').filter({ hasText: '旧白板' })).toHaveCount(1)

    // 取消置顶：菜单里这时是「取消置顶」
    await pickFromNoteMenu(run, '取消置顶')
    await sideRow(page, '置顶的那篇').click({ button: 'right' })
    await expect(names(page, '置顶')).toHaveText(['很久以前'])
    await expect(group(page, '今天').locator('.si', { hasText: '置顶的那篇' })).toHaveCount(1)
    expect(JSON.parse(readFileSync(pinsFile(vault), 'utf8'))).toEqual(['很久以前.md'])
    await pickFromNoteMenu(run, '取消置顶')
    await sideRow(page, '很久以前').click({ button: 'right' })
    await expect(group(page, '置顶')).toHaveCount(0)
    await expect(sideRow(page, '很久以前')).toHaveCount(0)
    await expect(page.getByTestId('archive-count')).toHaveText('2篇')
    expect(readFileSync(pinsFile(vault), 'utf8')).toBe('[]\n')
  } finally {
    await run.close()
  }
})

test('自动归档：90 天没改的不在左栏，「归档」里筛得到、打开得了；改一下就回到左栏；文件没挪、内容没变', async () => {
  const run = await launch(SMALL, {}, agedSmall)
  const { page, vault } = run
  try {
    // 左栏：这周写的在；上个月（45 天）收在月份里、没归档；很久以前、旧白板归档了；收件箱不归档
    await expect(sideRow(page, '这周写的')).toHaveCount(1)
    await expect(sideRow(page, '上个月')).toHaveCount(0)
    await expect(sideRow(page, '很久以前')).toHaveCount(0)
    await expect(sideRow(page, '旧白板')).toHaveCount(0)
    await expect(page.getByTestId('inbox-count')).toHaveText('1')
    await expect(page.getByTestId('recent-count')).toHaveText('5篇')
    await expect(page.getByTestId('archive-count')).toHaveText('2篇')
    // 上个月那篇在十月，收件箱那条（不归档）在一月
    await expect(side(page).locator('.s-fold')).toHaveCount(2)

    await side(page).getByRole('button', { name: /^归档/ }).click()
    await expect(tabOn(page)).toHaveText('归档')
    await expect(page.locator('.tab.on')).toContainText('归档')
    const list = pane(page).getByRole('list', { name: '归档的笔记' })
    await expect(list.getByRole('listitem').locator('.t')).toHaveText(['很久以前', '旧白板'])
    // 按类型筛：白板
    await pane(page).getByRole('tablist', { name: '类型' }).getByRole('tab', { name: '白板' }).click()
    await expect(list.getByRole('listitem').locator('.t')).toHaveText(['旧白板'])
    await pane(page).getByRole('tablist', { name: '类型' }).getByRole('tab', { name: '全部' }).click()
    // 按字筛
    await pane(page).getByRole('textbox', { name: '筛选' }).fill('很久')
    await expect(list.getByRole('listitem').locator('.t')).toHaveText(['很久以前'])
    await pane(page).getByRole('textbox', { name: '筛选' }).fill('没有这篇')
    await expect(pane(page).locator('.ix-empty')).toHaveText('没有符合「没有这篇」的笔记')
    await pane(page).getByRole('textbox', { name: '筛选' }).fill('很久')

    // 打开：开成标签，文件没挪
    await list.getByRole('listitem').filter({ hasText: '很久以前' }).getByRole('button').click()
    await expect(tabOn(page)).toHaveText('很久以前')
    expect(existsSync(join(vault, '很久以前.md'))).toBe(true)
    expect(readFileSync(join(vault, '很久以前.md'), 'utf8')).toBe(SMALL['很久以前.md'])
    expect(gitStatus(vault)).toBe('')

    // 改一下：修改时间变成现在，回到左栏「今天」，归档少一篇
    await pane(page).locator('.cm-line', { hasText: '两百天前改的' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type('今天又补了一句。')
    await waitSaved(page)
    await expect(group(page, '今天').locator('.si', { hasText: '很久以前' })).toHaveCount(1)
    await expect(page.getByTestId('archive-count')).toHaveText('1篇')
    expect(readFileSync(join(vault, '很久以前.md'), 'utf8')).toBe('# 很久以前\n\n两百天前改的。今天又补了一句。\n')
  } finally {
    await run.close()
  }
})

test('归档天数在设置 › 库 里改：30 天、不自动归档、180 天都马上生效，存在软件设置目录，不进库', async () => {
  const run = await launch(SMALL, {}, agedSmall)
  const { page, vault, userData } = run
  try {
    await expect(page.getByTestId('archive-count')).toHaveText('2篇')
    await openVaultSettings(page)
    const sel = settingsDialog(page).getByRole('combobox', { name: '自动归档' })
    await expect(sel).toHaveValue('90')
    await expect(sel.locator('option')).toHaveText(['30天没改过', '60天没改过', '90天没改过', '180天没改过', '不自动归档'])
    await sel.selectOption('30')
    // 上个月（45 天）也归档了
    await expect(page.getByTestId('archive-count')).toHaveText('3篇')
    expect(settingsOf(userData).archiveDays).toBe(30)
    await sel.selectOption('180')
    await expect(page.getByTestId('archive-count')).toHaveText('2篇')
    await sel.selectOption('0')
    await expect(page.getByTestId('archive-count')).toHaveText('0篇')
    expect(settingsOf(userData).archiveDays).toBe(0)
    await page.keyboard.press('Escape')
    await side(page).getByRole('button', { name: /^归档/ }).click()
    await expect(pane(page).locator('.ix-empty')).toContainText('没开自动归档')
    // 「在设置里打开」直接到库那一页
    await pane(page).getByRole('button', { name: '在设置里打开' }).click()
    await expect(settingsDialog(page).getByRole('combobox', { name: '自动归档' })).toHaveValue('0')
    await settingsDialog(page).getByRole('combobox', { name: '自动归档' }).selectOption('90')
    await expect(page.getByTestId('archive-count')).toHaveText('2篇')
    expect(gitStatus(vault)).toBe('')
  } finally {
    await run.close()
  }
})

test('收件箱超过 20 条：活动栏计数和首页收件箱组件变提醒样式，左栏收件箱那一枝底下多一行「让 AI 分一分」，点了就让 AI 整理收件箱；20 条时不提醒', async () => {
  const inbox = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`收件箱/第 ${i + 1} 条.md`, `---\ncreated: 2026-11-0${1 + (i % 9)} 10:00\n---\n第 ${i + 1} 条速记\n`]))
  const run = await launch({ ...inbox(20), '这周写的.md': '# 这周写的\n' }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await expect(page.getByTestId('inbox-count')).toHaveText('20')
    await expect(page.getByTestId('inbox-count')).not.toHaveClass(/warn/)
    await expect(page.getByTestId('widget-inbox')).not.toHaveClass(/warn/)
    // 20 条：左栏收件箱那一枝底下没有提醒那一行
    await leftView(page, '收件箱')
    await expect(side(page).locator('.s-tidy')).toHaveCount(0)

    // 再速记一条：21 条（收件箱整页在中间，⌘K「打开收件箱」）
    await openInboxTab(page)
    await pane(page).getByRole('textbox', { name: '速记' }).fill('第 21 条速记')
    await pane(page).getByRole('textbox', { name: '速记' }).press('Enter')
    await expect(page.getByTestId('inbox-count')).toHaveText('21')
    await expect(page.getByTestId('inbox-count')).toHaveClass(/warn/)
    const tidy = side(page).getByRole('button', { name: '收件箱堆了21条，让AI按主题分进剪藏' })
    await expect(tidy).toHaveClass(/s-tidy/)
    await expect(tidy).toContainText('让AI分一分')
    await page.getByRole('banner').getByRole('button', { name: '首页' }).click()
    const w = page.getByTestId('widget-inbox')
    await expect(w).toHaveClass(/warn/)
    await expect(w.locator('.big')).toHaveText('21条没整理 · 堆多了')
    await expect(w.getByRole('button', { name: '让AI分一分' })).toHaveClass(/btn-primary/)
    await page.screenshot({ path: shot('inbox-warn-home.png') })

    // 左栏收件箱底下那一行「让 AI 分一分」：打开 AI，跑 /整理收件箱
    await tidy.click()
    const ai = page.getByRole('complementary', { name: 'AI 对话' })
    await expect(ai).toBeVisible()
    await expect(ai.getByTestId('ai-msg').last()).toContainText('读了收件箱21条', { timeout: 20_000 })
    // 只给建议，点同意之前一条都不挪
    expect(existsSync(join(vault, '收件箱', '第 1 条.md'))).toBe(true)
  } finally {
    await run.close()
  }
})

test('7000 篇的库：启动、左栏（最近、文件树）、文件夹首页、中间的「最近」、⌘F 搜索、首页、归档列表都不卡；不把上万条全铺开', async () => {
  test.setTimeout(240_000)
  let stats: BigVaultStats | null = null
  const run = await launch({}, {}, (v) => (stats = makeBigVault(v)))
  const { page } = run
  const s = stats!
  const nums: Record<string, number> = {}
  try {
    // 启动：从开软件到左栏「最近」数出 7000 篇
    await expect(page.getByTestId('recent-count')).toHaveText(`${s.total}篇`, { timeout: 60_000 })
    nums['启动到左栏出来（ms）'] = Date.now() - run.launchedAt
    await expect(page.getByTestId('widget-inbox')).toBeVisible()
    nums['启动到首页组件出来（ms）'] = Date.now() - run.launchedAt
    await expect(page.getByTestId('archive-count')).toHaveText(`${s.olderThan90}篇`)
    // 「最近」：今天、这周之外按月收起，每组最多先列 100 篇
    const rows = await side(page).locator('.si:visible').count()
    nums['左栏「最近」行数'] = rows
    expect(rows).toBeLessThanOrEqual(2 * 100 + 20)
    expect(await side(page).locator('.s-fold').count()).toBeGreaterThan(0)

    // 收件箱那一枝底下：堆多了的「让 AI 分一分」
    await leftView(page, '收件箱')
    await expect(side(page).getByRole('button', { name: /让AI按主题分进剪藏/ })).toBeVisible()

    // 文件树：只画展开了的，一个文件夹先列 100 个
    let t = Date.now()
    await leftView(page, '文件')
    await expect(side(page).getByRole('tree', { name: '全部文件' }).getByRole('treeitem').first()).toBeVisible()
    nums['切到「文件」树出来（ms）'] = Date.now() - t
    nums['文件树行数'] = await side(page).getByRole('treeitem').count()
    expect(nums['文件树行数']).toBeLessThan(150)

    // 文件夹首页：点「日记」（几百篇的文件夹）
    const diary = side(page).getByRole('treeitem').filter({ has: page.locator('.truncate', { hasText: /^日记$/ }) })
    t = Date.now()
    await diary.click()
    await expect(pane(page).getByTestId('folder-content').locator('.fc-fcard').first()).toBeVisible()
    nums['打开「日记」文件夹首页（ms）'] = Date.now() - t
    const year = side(page).getByRole('treeitem').filter({ has: page.locator('.truncate', { hasText: /^2025$/ }) })
    t = Date.now()
    await year.click()
    await expect(pane(page).getByTestId('folder-content').getByRole('region', { name: '笔记' }).locator('.fc-row').first()).toBeVisible()
    nums['打开「日记/2025」文件夹首页（ms）'] = Date.now() - t
    nums['「日记/2025」首页上的笔记行数'] = await pane(page).getByTestId('folder-content').locator('.fc-row').count()
    expect(nums['「日记/2025」首页上的笔记行数']).toBeLessThanOrEqual(4)
    expect(await side(page).getByRole('treeitem').count()).toBeLessThan(150 + 100)

    // 中间的「最近」：按月收起，打开就出来
    await leftView(page, '最近')
    t = Date.now()
    await side(page).getByRole('button', { name: '在中间打开' }).click()
    await expect(pane(page).getByRole('list', { name: '最近的笔记' }).locator('.rp-fold').first()).toBeVisible()
    nums['打开中间的「最近」（ms）'] = Date.now() - t
    nums['「最近」页上的行数'] = await pane(page).locator('.rp-row').count()
    expect(nums['「最近」页上的行数']).toBeLessThanOrEqual(200)
    t = Date.now()
    await pane(page).getByRole('textbox', { name: '筛选' }).fill('白板')
    await expect(pane(page).locator('.rp-row').first()).toContainText('白板')
    nums['「最近」页筛选（ms）'] = Date.now() - t

    // 列一次笔记（每次保存后都会列一次）：主进程有缓存，只看修改时间
    nums['再列一次 7000 篇（ms）'] = await page.evaluate(async () => {
      const t = performance.now()
      await window.cn.listNotes()
      return Math.round(performance.now() - t)
    })

    // ⌘F：第一次搜就出结果
    const t0 = Date.now()
    await page.keyboard.press('Meta+f')
    const pal = page.getByRole('dialog', { name: '搜索和命令' })
    await pal.getByRole('textbox').fill('极光 预报')
    await expect(pal.locator('.pal-g', { hasText: '笔记' })).toBeVisible()
    nums['⌘F 打字到出结果（ms，含 80ms 防抖）'] = Date.now() - t0
    nums['搜索一次（ms）'] = await page.evaluate(async () => {
      const t = performance.now()
      await window.cn.search('冰岛 自驾')
      return Math.round(performance.now() - t)
    })
    await page.keyboard.press('Escape')

    // 归档列表：几千行也只画看得见的几十行；滚到底还在
    const t1 = Date.now()
    await side(page).getByRole('button', { name: /^归档/ }).click()
    const list = pane(page).getByRole('list', { name: '归档的笔记' })
    await expect(list).toHaveAttribute('aria-rowcount', String(s.olderThan90))
    nums['打开归档列表（ms）'] = Date.now() - t1
    expect(await list.getByRole('listitem').count()).toBeLessThan(80)
    await pane(page).locator('.body').evaluate((el) => (el.scrollTop = el.scrollHeight))
    await expect(list.getByRole('listitem').last()).toBeVisible()
    expect(await list.getByRole('listitem').count()).toBeLessThan(80)
    const t3 = Date.now()
    await list.getByRole('listitem').first().getByRole('button').click()
    await expect(tabOn(page)).not.toHaveText('归档')
    nums['从归档打开一篇（ms）'] = Date.now() - t3

    // 回首页
    const t4 = Date.now()
    await page.getByRole('banner').getByRole('button', { name: '首页' }).click()
    await expect(page.getByTestId('widget-inbox')).toBeVisible()
    nums['切回首页（ms）'] = Date.now() - t4
    await expect(page.getByTestId('widget-inbox')).toHaveClass(/warn/)

    console.log('7000 篇库测得：', JSON.stringify({ ...s, ...nums }, null, 2))
    if (process.env.CN_PERF_OUT) writeFileSync(process.env.CN_PERF_OUT, JSON.stringify({ ...s, ...nums }, null, 2))
    for (const [k, v] of Object.entries(nums)) test.info().annotations.push({ type: k, description: String(v) })
    expect(nums['启动到左栏出来（ms）']).toBeLessThan(10_000)
    expect(nums['切到「文件」树出来（ms）']).toBeLessThan(1500)
    expect(nums['打开「日记」文件夹首页（ms）']).toBeLessThan(1500)
    expect(nums['打开中间的「最近」（ms）']).toBeLessThan(1500)
    expect(nums['再列一次 7000 篇（ms）']).toBeLessThan(1000)
    expect(nums['⌘F 打字到出结果（ms，含 80ms 防抖）']).toBeLessThan(2000)
  } finally {
    await run.close()
  }
})

test('截图：十套主题下的左栏（有置顶、收件箱提醒）和归档列表', async () => {
  const inbox = Object.fromEntries(Array.from({ length: 24 }, (_, i) => [`收件箱/速记 ${i + 1}.md`, `---\ncreated: 2026-11-10 10:00\n---\n第 ${i + 1} 条\n`]))
  const run = await launch(
    { ...SMALL, ...inbox, '冰岛自驾.md': ICELAND, '读书笔记.md': '# 读书笔记\n', '周报.md': '# 周报\n', '素材/旅行/冰洞.md': '---\nsource: https://safetravel.is\n---\n> 冰洞\n', '.canvas-notes/置顶.json': '["读书笔记.md", "很久以前.md"]\n' },
    {},
    agedSmall,
  )
  const { page } = run
  try {
    await expect(names(page, '置顶')).toHaveText(['读书笔记', '很久以前'])
    await page.keyboard.press('Meta+,')
    await settingsDialog(page).getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: '外观', exact: true }).click()
    await settingsDialog(page).getByRole('switch', { name: '跟着系统换浅深' }).click()
    await page.keyboard.press('Escape')
    for (const skin of ['mint', 'sky', 'sakura', 'lilac', 'stone', 'pine', 'petrol', 'cocoa', 'ink', 'graphite']) {
      await page.keyboard.press('Meta+,')
      await settingsDialog(page).locator(`[data-skin-card="${skin}"]`).click()
      await expect(page.locator('html')).toHaveAttribute('data-skin', skin)
      await page.keyboard.press('Escape')
      await side(page).getByRole('button', { name: /^归档/ }).click()
      await expect(pane(page).getByRole('list', { name: '归档的笔记' })).toBeVisible()
      await page.mouse.move(400, 300)
      await page.waitForTimeout(250)
      await page.screenshot({ path: shot(`skin-${skin}.png`) })
    }
    // 设置 › 库：自动归档天数
    await page.keyboard.press('Meta+,')
    await settingsDialog(page).locator('[data-skin-card="mint"]').click()
    await settingsDialog(page).getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: '库', exact: true }).click()
    await expect(settingsDialog(page).getByRole('combobox', { name: '自动归档' })).toBeVisible()
    await page.screenshot({ path: shot('settings-vault.png') })
    await page.keyboard.press('Escape')
    await leftView(page, '最近')
    await side(page).getByRole('button', { name: '在中间打开' }).click()
    await expect(pane(page).getByRole('list', { name: '最近的笔记' })).toBeVisible()
    await page.mouse.move(400, 300)
    await page.screenshot({ path: shot('recent-page.png') })
  } finally {
    await run.close()
  }
})
