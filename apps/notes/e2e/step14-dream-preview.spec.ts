import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { gitStatus, launch, pane, rail, tabOn, leftView } from './app'

// 梦游里的归类和改名 + 预览（task-xfrgu 第 2 段，设计稿 design-mindmap 方向 B 第 7、8 节）：
// 现在梦游 → 报告里「归类和改名」按去处分组 → 在树里看（以前叫「预览」，task-m552v 改名；左栏换成改好后的样子，挪来的标「新」，收件箱留影子）
// → 跟 AI 说哪里不对、重做 → 逐条丢掉再撤回 → 收下这 N 处（一次提交）→ 撤回；大批量按去处收起。
// AI 用假引擎（CN_AI_FAKE=1，main/ai.ts 的 fakeFiling / fakeRedo）。

const SHOTS = process.env.CN_SHOTS_DIR
const shot = async (page: Page, name: string) => SHOTS && (await page.screenshot({ path: join(SHOTS, `${name}.png`) }))
const git = (vault: string, ...args: string[]) => execFileSync('git', ['-C', vault, '-c', 'core.quotepath=false', ...args], { encoding: 'utf8' })

const MAP = '---\ntype: board\n白板样式: 导图\n类型: 导图\n课程: 线性代数\n第几讲: 3\n来源: iPhone 拍的\n日期: 2026-11-15\nAI填的: 课程, 第几讲\n---\n# 导图 11-15 21∶40\n\n![原照片 · 11 月 15 日 21:40 · iPhone](../附件/导图/2026-11-15-2140.jpg)\n\n- 线性映射\n  - 定义\n  - 核与像\n'
const VAULT: Record<string, string | Uint8Array> = {
  '课程/线性代数/第3讲 线性映射.md': '# 第3讲 线性映射\n\n课上讲了线性映射的定义。\n',
  '课程/概率论/第1讲.md': '# 第1讲\n',
  '复习.md': '---\ntype: board\n---\n# 复习\n\n<!-- card id=a1 x=40 y=40 w=280 -->\n[[导图 11-15 21∶40]]\n',
  '收件箱/导图 11-15 21∶40.md': MAP,
  '附件/导图/2026-11-15-2140.jpg': readFileSync(join(__dirname, 'fixtures/handwritten-map.jpg')),
  '收件箱/一条速记.md': '---\ncreated: 2026-11-15 20:10\n---\n周末去花市买绣球，顺便看看多肉。\n',
  '收件箱/说不好的.md': '---\ncreated: 2026-11-15 20:30\n---\n一句说不好放哪的话。\n',
}
const NEW_MAP = '课程/线性代数/第3讲 线性代数 导图.md'

function darkSettings(vault: string) {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: 'pine' } }))
}

const panel = (page: Page) => page.getByRole('complementary', { name: '梦游报告' })
const side = (page: Page) => page.locator('aside.side')
const bar = (page: Page) => page.getByTestId('preview-bar')
const toast = (page: Page) => page.getByTestId('preview-toast')

async function dreamNow(page: Page) {
  await leftView(page, '梦游报告')
  await panel(page).getByRole('button', { name: '现在梦游' }).click()
  await expect(panel(page).getByTestId('dream-summary')).toContainText('收下才合进main', { timeout: 30_000 })
}

for (const tone of ['light', 'dark'] as const) {
  test(`梦游归类和改名：预览、跟 AI 说、丢掉再撤回、收下这 N 处、撤回（${tone === 'light' ? '浅色' : '深色'}）`, async () => {
    const run = await launch(VAULT, { CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '600' }, tone === 'dark' ? darkSettings : undefined)
    const { page, vault } = run
    const read = (p: string) => readFileSync(join(vault, p), 'utf8')
    try {
      await dreamNow(page)
      // 报告：归类和改名按去处分组，拿不准的留着
      const file = panel(page).getByRole('region', { name: '归类和改名' })
      await expect(file.locator('.dg')).toHaveText('归类和改名2条在树里看')
      await expect(file.locator('.dsub')).toHaveText(['课程/线性代数1条', '生活1条'])
      await expect(file.getByTestId('dream-item')).toHaveText(['第3讲 线性代数 导图从收件箱挪来 · 原名「导图 11-15 21∶40」', '周末去花市买从收件箱挪来 · 原名「一条速记」'])
      await expect(file.locator('.dstay')).toHaveText('收件箱 · 拿不准的1条留着不动，等你自己定')
      // 点开一条：中间开它（task-m552v）：为什么在条目头上，挪到哪、改名在挪动那一块；左栏小卡只留第几条、改了几个文件；收下不再是主按钮
      await file.getByTestId('dream-item').first().click()
      const detail = panel(page).getByTestId('dream-detail')
      await expect(detail.locator('.pv-k')).toHaveText(/^归类和改名 · 第1条，共3条 · 改了\d+个文件$/)
      const center = page.locator('[data-testid="dream-tab"]:not([hidden])')
      await expect(center.getByTestId('dream-why')).toHaveText('属性里写着课程「线性代数」、第3讲，放进这门课。')
      await expect(center.getByTestId('dream-move')).toContainText('收件箱/导图 11-15 21∶40→课程/线性代数/第3讲 线性代数 导图')
      await expect(detail.getByRole('button', { name: '收下' })).not.toHaveClass(/btn-primary/)
      await expect(panel(page).locator('.btn-primary')).toHaveCount(0)
      // main 上什么都没动
      expect(gitStatus(vault)).toBe('')
      expect(read('收件箱/导图 11-15 21∶40.md')).toBe(MAP)
      await shot(page, `dream-report-${tone}`)

      // 在树里看：左栏换成改好后的样子
      await file.getByRole('button', { name: '在树里看' }).click()
      await expect(bar(page)).toContainText('正在预览梦游的整理 · 2处挪动和改名')
      await expect(bar(page).getByRole('button', { name: '收下这2处' })).toHaveClass(/btn-primary/)
      // 点「预览」左栏换到「文件」页；「最近」页里也是改好后的样子
      await expect(page.getByRole('navigation', { name: '左栏' }).getByRole('button', { name: '文件', exact: true })).toHaveAttribute('aria-pressed', 'true')
      await expect(page.getByRole('complementary', { name: '文件' })).toHaveClass(/previewing/)
      // 预览条的按钮照设计稿（design/frame）的顺序：跟 AI 说哪里不对 ｜ 丢掉 ｜ 收下这 N 处 ｜ 退出预览 esc
      await expect(bar(page).getByRole('button')).toHaveText([/跟AI说哪里不对/, '丢掉', '收下这2处', /退出预览/])
      // 「文件」页里有改动的文件夹都展开着：挪来的标「新」、原处的影子行一眼看得到（设计复审第 3 条）
      const files = page.getByRole('complementary', { name: '文件' })
      const moved = files.locator('.ft-row', { hasText: '第3讲 线性代数 导图' })
      await expect(moved.locator('.tag-new')).toHaveText('新')
      // 「新」和名字在同一行里露着（行是 overflow: hidden 的折行布局：不能掉到第二行，也不能把行里的名字滚走）
      const fit = await moved.evaluate((r) => {
        const b = r.getBoundingClientRect()
        const t = r.querySelector('.tag-new')!.getBoundingClientRect()
        const n = r.querySelector('.truncate')!.getBoundingClientRect()
        return { scroll: r.scrollTop, tagIn: t.top >= b.top && t.bottom <= b.bottom, nameIn: n.top >= b.top && n.bottom <= b.bottom }
      })
      expect(fit).toEqual({ scroll: 0, tagIn: true, nameIn: true })
      await expect(files.locator('.pv-ghost').first()).toBeVisible()
      // 开头的呼吸点是条上的字色（强调色底上是白的，不和底同色）；B 的底栏只剩预览胶囊，后面不留磨砂底
      const dot = await bar(page).locator('.pd').evaluate((d) => [getComputedStyle(d).backgroundColor, getComputedStyle(d.closest('.pv-bar')!).color])
      expect(dot[0]).toBe(dot[1])
      expect(await page.locator('footer.status').evaluate((f) => getComputedStyle(f).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
      // 截图前鼠标挪开（点「预览」的位置换成了目录树的一行，不然那行带着悬停底色）
      await page.mouse.move(900, 600)
      await shot(page, `dream-preview-files-${tone}`)
      await leftView(page, '最近')
      await expect(side(page)).toHaveClass(/previewing/)
      const newMap = side(page).locator('.si', { hasText: '第3讲 线性代数 导图' })
      await expect(newMap.locator('.tag-new')).toHaveText('新')
      await expect(newMap.locator('.tag-new')).toHaveAttribute('title', '原名 导图 11-15 21∶40')
      await expect(side(page).getByRole('group', { name: '收件箱 · 挪走的' }).locator('.pv-ghost')).toHaveText(['一条速记挪到生活', '导图 11-15 21∶40挪到线性代数'])
      await expect(page.getByTestId('inbox-count')).toHaveText('1')
      await shot(page, `dream-preview-${tone}`)
      // 预览里点挪来的那篇：打开的是 main 上原来那篇
      await newMap.click()
      await expect(tabOn(page)).toHaveText('导图 11-15 21∶40')

      // 跟 AI 说哪里不对：速记放写作 → 重做 → 那一条标「按你说的改了」
      await bar(page).getByRole('button', { name: '跟 AI 说哪里不对' }).click()
      const pop = page.getByRole('dialog', { name: '跟 AI 说这 2 处哪里不对' })
      await pop.getByRole('button', { name: '速记放 写作 下面' }).click()
      await expect(pop.getByRole('textbox', { name: '哪里不对' })).toHaveValue('速记放 写作 下面')
      await shot(page, `dream-feedback-${tone}`)
      await pop.getByRole('button', { name: /重做/ }).click()
      await expect(bar(page)).toContainText('AI按你说的重做中 ·「速记放 写作 下面」')
      await expect(toast(page)).toContainText('重做好了 · 1处变了，标着「按你说的改了」，再看看', { timeout: 15_000 })
      await leftView(page, '梦游报告')
      await expect(file.locator('.dsub')).toHaveText(['课程/线性代数1条', '写作1条'])
      const flower = file.getByTestId('dream-item').filter({ hasText: '原名「一条速记」' })
      await expect(flower.locator('.tag-acc')).toHaveText('按你说的改了')
      await leftView(page, '最近')
      await expect(side(page).getByRole('group', { name: '收件箱 · 挪走的' }).locator('.pv-ghost')).toHaveText(['一条速记挪到写作', '导图 11-15 21∶40挪到线性代数'])
      await shot(page, `dream-redone-${tone}`)

      // 左栏悬停「丢掉这一处」，再撤回
      const flowerRow = side(page).locator('.si', { hasText: '周末去花市买' })
      await flowerRow.hover()
      await flowerRow.getByRole('button', { name: '丢掉这一处' }).click()
      await expect(toast(page)).toContainText('丢掉了1处 · 收件箱保持原样')
      await leftView(page, '梦游报告')
      await expect(flower).toContainText('已丢掉')
      await expect(bar(page)).toContainText('1处挪动和改名')
      await toast(page).getByRole('button', { name: '撤回' }).click()
      await expect(toast(page)).toContainText('撤回了 · 又回到待看')
      await expect(bar(page)).toContainText('2处挪动和改名')

      // 收下这 2 处：一次提交；文件挪好、改好名，复习.md 里的双链跟着换；预览自己退出
      const before = Number(git(vault, 'rev-list', '--count', 'HEAD').trim())
      await bar(page).getByRole('button', { name: '收下这2处' }).click()
      await expect(toast(page)).toContainText('收下了2处，已提交到main')
      await expect(bar(page)).toHaveCount(0)
      expect(Number(git(vault, 'rev-list', '--count', 'HEAD').trim())).toBe(before + 1)
      expect(git(vault, 'log', '-1', '--format=%s').trim()).toBe('收下梦游的归类和改名：2 处')
      expect(read(NEW_MAP)).toContain('# 第3讲 线性代数 导图\n\n![原照片 · 11 月 15 日 21:40 · iPhone](../../附件/导图/2026-11-15-2140.jpg)')
      expect(read('写作/周末去花市买.md')).toContain('周末去花市买绣球')
      expect(read('复习.md')).toContain('[[第3讲 线性代数 导图]]')
      expect(existsSync(join(vault, '收件箱/说不好的.md'))).toBe(true)
      expect(gitStatus(vault)).toBe('')
      await expect(toast(page).locator('code')).toHaveText(git(vault, 'rev-parse', '--short=7', 'HEAD').trim())
      await shot(page, `dream-taken-${tone}`)

      // 撤回：反向提交，文件回到收件箱、原来的名字
      await toast(page).getByRole('button', { name: '撤回' }).click()
      await expect(toast(page)).toContainText('已撤回 · 文件回到收件箱，原来的名字 · 新提交')
      expect(read('收件箱/导图 11-15 21∶40.md')).toBe(MAP)
      expect(read('复习.md')).toContain('[[导图 11-15 21∶40]]')
      expect(existsSync(join(vault, NEW_MAP))).toBe(false)
      expect(gitStatus(vault)).toBe('')
      await leftView(page, '梦游报告')
      await expect(file.getByTestId('dream-item').filter({ hasText: '已收下' })).toHaveCount(0)
      // 又能在树里看，esc 退出、回到报告
      await file.getByRole('button', { name: '在树里看' }).click()
      await expect(bar(page)).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(bar(page)).toHaveCount(0)
      await expect(side(page)).not.toHaveClass(/previewing/)
      await expect(panel(page)).toBeVisible()
    } finally {
      await run.close()
    }
  })
}

test('大批量：40 条按去处分组、默认收起，组里只露 5 条和搜索；收下这组是一次提交', async () => {
  const files: Record<string, string> = { '生活/已有.md': '# 已有\n' }
  for (let i = 1; i <= 30; i++) files[`收件箱/备忘 ${i}.md`] = `房租第${i}期交了，记一下。\n`
  for (let i = 1; i <= 10; i++) files[`收件箱/剪 ${i}.md`] = `极光第${i}晚：云量低于三成就出门。\n`
  const run = await launch(files, { CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '300' })
  const { page, vault } = run
  try {
    await dreamNow(page)
    const file = panel(page).getByRole('region', { name: '归类和改名' })
    await expect(file.locator('.dg')).toHaveText('归类和改名40条 · 2组在树里看')
    const groups = file.getByTestId('dream-bulk')
    await expect(groups.locator('.dbulk-h .tx')).toHaveText(['生活30条挪进来 · 改了30个名字', '剪藏/旅行10条挪进来 · 改了0个名字'])
    // 默认收起：一条都不铺开
    await expect(file.getByTestId('dream-item')).toHaveCount(0)
    await groups.first().locator('.dbulk-h').click()
    await expect(groups.first().locator('.dbulk-r')).toHaveCount(5)
    await expect(groups.first().locator('.dbulk-more')).toContainText('还有25条')
    await groups.first().getByRole('textbox', { name: '在这组里找' }).fill('备忘 7')
    await expect(groups.first().locator('.dbulk-r')).toHaveText([/原名 备忘 7$/])
    await groups.first().getByRole('textbox', { name: '在这组里找' }).fill('')
    await file.getByRole('button', { name: '在树里看' }).click()
    await expect(bar(page)).toContainText('40条，分到2个文件夹')
    await expect(bar(page).getByRole('button', { name: '收下全部' })).toBeVisible()
    // 点「预览」左栏换到「文件」页；「最近」页里也是改好后的样子
    await expect(page.getByRole('navigation', { name: '左栏' }).getByRole('button', { name: '文件', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await leftView(page, '最近')
    const ghosts = side(page).getByRole('group', { name: '收件箱 · 挪走的' })
    await expect(ghosts.locator('.pv-ghost')).toHaveCount(5)
    await expect(ghosts.locator('.s-none')).toHaveText('还有35条挪走的')
    await shot(page, 'dream-bulk-light')

    const before = Number(git(vault, 'rev-list', '--count', 'HEAD').trim())
    // 回到左栏的梦游报告页收下一组
    await leftView(page, '梦游报告')
    await groups.nth(1).getByRole('button', { name: '收下这组', exact: true }).click()
    await expect(toast(page)).toContainText('收下了10处，已提交到main')
    expect(Number(git(vault, 'rev-list', '--count', 'HEAD').trim())).toBe(before + 1)
    expect(existsSync(join(vault, '剪藏/旅行/剪 7.md'))).toBe(true)
    expect(existsSync(join(vault, '收件箱/备忘 7.md'))).toBe(true)
    await expect(bar(page)).toContainText('30条，分到1个文件夹')
    expect(gitStatus(vault)).toBe('')
  } finally {
    await run.close()
  }
})

test('收件箱堆了 30 条：点「在树里看」后第一处「新」滚进左栏视野，不用自己往下翻', async () => {
  const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`收件箱/说不好的 ${String(i + 1).padStart(2, '0')}.md`, `---\ncreated: 2026-11-15 20:30\n---\n一句说不好放哪的话 ${i + 1}。\n`]))
  const run = await launch({ ...VAULT, ...many }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    await dreamNow(page)
    await panel(page).getByRole('region', { name: '归类和改名' }).getByRole('button', { name: '在树里看' }).click()
    await expect(bar(page)).toBeVisible()
    const files = page.getByRole('complementary', { name: '文件' })
    const moved = files.locator('.ft-row', { hasText: '第3讲 线性代数 导图' })
    await expect(moved.locator('.tag-new')).toHaveText('新')
    // 这一行整个在左栏能滚的那一块的可见区里
    const seen = () =>
      moved.evaluate((r) => {
        let sc: HTMLElement | null = r.parentElement
        while (sc && !(sc.scrollHeight > sc.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement
        const b = r.getBoundingClientRect()
        const v = (sc ?? document.documentElement).getBoundingClientRect()
        return b.top >= v.top - 1 && b.bottom <= v.bottom + 1
      })
    await expect.poll(seen).toBe(true)
  } finally {
    await run.close()
  }
})
