/**
 * task-h7oy8：右栏「相关」（设计页 44-相关栏和生长图，全按推荐）。都是真点：右图标栏点「相关」、悬停出按钮点「连上 / 不相关 / 撤掉」、点「撤销」、
 * 按住 ⌘ 停在一条上、切「光标这一段」。窗口不上屏（CN_E2E=1），假 AI（CN_AI_FAKE=1），临时库。
 * 梦游那边：报告（收下了的补双链）和判断进度（判过的一对）直接写进设置目录，和梦游跑完一晚留下的一样。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { launch, openNote, pane, rail, type Running } from './app'
import { dreamState, FILES, GPU, GUS, key, SPEED, T } from './fixtures/related'

const related = (page: Page) => page.getByRole('complementary', { name: '相关' })
const relatedBtn = (page: Page) => rail(page).getByRole('button', { name: /^相关/ })
const row = (page: Page, name: string) => related(page).getByTestId('related-row').filter({ has: page.locator('.tt', { hasText: name }) })
const grp = (page: Page, g: string) => related(page).locator(`.rl-grp[data-group="${g}"]`)
const bytes = (vault: string, p: string) => readFileSync(join(vault, p))
const log = (vault: string) => execFileSync('git', ['-C', vault, 'log', '--format=%s'], { encoding: 'utf8' })

let run: Running
test.afterEach(async () => run?.close())

test('右图标栏「相关」：大纲下面一格，默认不开；三组内容、那一句、指着哪一节哪一段；前后篇、只列名字的收成一行', async () => {
  run = await launch(FILES, { CN_AI_FAKE: '1' }, dreamState)
  const { page } = run
  // 默认不开；在大纲下面一格
  const labels = await rail(page).locator('button.ab').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')!))
  const oi = labels.findIndex((l) => l.startsWith('大纲'))
  expect(labels[oi + 1]).toMatch(/^相关/)
  await expect(page.getByTestId('dview-related')).toBeHidden()
  // 首页不是笔记：原地变淡
  await expect(relatedBtn(page)).toHaveAttribute('aria-label', '相关（这一页不是笔记）')

  await openNote(page, '05-Amdahl定律')
  await expect(relatedBtn(page)).toHaveAttribute('aria-label', '相关')
  await relatedBtn(page).click()
  await expect(related(page)).toBeVisible()

  // 提到这篇的：H&P 带那一句，链接那几个字打底色；练习指着「2. …」一节；术语表指着块那一段；HPC 嵌了这一篇
  const hp = row(page, '10-Amdahl定律（H&P视角）')
  await expect(hp.locator('.q')).toContainText('H&P 从「只优化一部分」讲同一条定律：05-Amdahl定律 和 06-Gustafson定律')
  await expect(hp.locator('.q mark')).toHaveText('05-Amdahl定律')
  await expect(hp.locator('.mt')).toHaveText('HPDC · 参考书')
  await expect(row(page, '02-Amdahl-Webserver').locator('.to')).toHaveText('指着「2. Amdahl 定律公式」')
  await expect(row(page, '02-Amdahl-Webserver').locator('.q mark')).toHaveText('Amdahl 定律（最对口的原子）')
  await expect(row(page, 'Amdahl-Law').locator('.to')).toHaveText('指着「串行占 1% 时最多快 100 倍。」那一段')
  await expect(row(page, 'HPC').locator('.why')).toHaveText('嵌了这一篇')
  // 同一篇只出现一次（文件修改时间一样，先后不定：比排好序的）
  await expect.poll(async () => (await grp(page, 'mention').getByTestId('related-row').locator('.tt').allTextContents()).sort()).toEqual(['02-Amdahl-Webserver', '10-Amdahl定律（H&P视角）', 'Amdahl-Law', 'HPC'])
  // 前后篇、目录页收成一行
  await expect(grp(page, 'mention')).toContainText('前后篇：04-Moore定律')
  await expect(grp(page, 'mention').getByTestId('related-listed')).toHaveText('还有1篇只列着它的名字（目录页、相关列表）')
  await grp(page, 'mention').getByTestId('related-listed').click()
  await expect(grp(page, 'mention').getByTestId('related-listed')).toContainText('00-Hub')

  // 梦游连上的：报告里收下的那条写哪晚、为什么；末尾「相关：」行里的也在
  const gpu = grp(page, 'dream').getByTestId('related-row').filter({ hasText: 'Amdahls-Law' })
  await expect(gpu.locator('.tag')).toHaveText('11月22日梦游连的')
  await expect(gpu.locator('.why')).toContainText('两门课讲同一条定律；那篇多讲了 GPU 上的串行瓶颈')
  await expect(gpu.locator('.why')).not.toContainText('只在这篇末尾加一行')
  await expect(gpu.locator('.q')).toHaveText('它告诉我们专注于减少串行部分：数据传输、内核启动开销和同步点。')
  await expect(grp(page, 'dream').getByTestId('related-row').filter({ hasText: '02-线性亚线性超线性缩放' }).locator('.why')).toHaveText('写在那篇末尾「相关：」那一行')

  // 像但还没连的：判过的两对按把握排，无关的那对不出
  const like = grp(page, 'like').getByTestId('related-row')
  await expect(like.locator('.tt')).toHaveText(['Gustafson-Law（古斯塔夫森定律）', 'Speedup（加速比）'])
  await expect(like.first().locator('.why')).toHaveText('和这篇对着讲的另一条定律：问题跟着 N 变大时，加速比接近 N')
  await expect(grp(page, 'like')).not.toContainText('03-Partial-Product')

  // 顺序：提到这篇的 → 梦游连上的 → 像但还没连的
  expect(await related(page).locator('.rl-grp').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.group))).toEqual(['mention', 'dream', 'like'])

  // 文末那块也叫「提到这篇的」，读同一份：每条带那一句，链到一段的写「引用了「…」那一段」，只列名字的收成一行
  const end = pane(page).locator('.doc-backlinks')
  await expect(end.locator('.bh')).toHaveText('提到这篇的')
  await expect(end.locator('.bl-item', { hasText: '10-Amdahl定律（H&P视角）' }).locator('.bq mark')).toHaveText('05-Amdahl定律')
  await expect(end.locator('.bl-item', { hasText: 'Amdahl-Law' }).locator('.how')).toHaveText('· 指着「串行占 1% 时最多快 100 倍。」那一段')
  await expect(end.locator('.bl-item').filter({ has: page.getByRole('button', { name: 'HPC', exact: true }) }).locator('.how')).toHaveText('· 嵌了这一篇')
  await expect(end.locator('.bl-more')).toHaveText('还有4篇只列着它的名字（目录页、相关列表）')
  await end.locator('.bl-more').click()
  await expect(end.locator('.bl-item', { hasText: '00-Hub' })).toBeVisible()

  // 点一条：中间打开那一篇，跳到那一句
  await hp.click()
  await expect(page.getByTestId('tab-list').locator('.tab.on')).toContainText('10-Amdahl定律（H&P视角）')
})

test('连上：原句里那几个字变成链接、一次提交；撤销后文件一字节不差；不相关以后不再出、撤销又回来', async () => {
  run = await launch(FILES, { CN_AI_FAKE: '1' }, dreamState)
  const { page, vault, userData } = run
  await openNote(page, '05-Amdahl定律')
  await relatedBtn(page).click()
  const before = bytes(vault, T)

  // 连上 Gustafson：悬停出按钮
  const gus = row(page, 'Gustafson-Law（古斯塔夫森定律）')
  await gus.hover()
  await gus.getByRole('button', { name: '连上' }).click()
  const done = related(page).getByTestId('related-done').filter({ hasText: '已连上' })
  await expect(done).toHaveText(/已连上：正文里「Gustafson」变成链接，字不变/)
  await expect.poll(() => readFileSync(join(vault, T), 'utf8')).toContain('[[Gustafson-Law（古斯塔夫森定律）|Gustafson]] 的反驳在下一篇')
  // 只改了那几个字
  expect(readFileSync(join(vault, T), 'utf8').replace('[[Gustafson-Law（古斯塔夫森定律）|Gustafson]]', 'Gustafson')).toBe(before.toString('utf8'))
  await expect.poll(() => log(vault)).toContain('相关栏：「05-Amdahl定律」里「Gustafson」连上 [[Gustafson-Law（古斯塔夫森定律）]]')
  // 连上就是一次提交，库里没有没提交的改动（编辑器合并进来后不再多存一份）
  await page.waitForTimeout(2500)
  expect(execFileSync('git', ['-C', vault, 'status', '--porcelain'], { encoding: 'utf8' }).trim()).toBe('')
  // 编辑器里也是链接了（外部改动合并进来）
  await expect(pane(page).locator('.cm-content')).toContainText('Gustafson 的反驳')
  // 那条原地留着「已连上」，等一会儿（库里的笔记变了、重读了）还在
  await page.waitForTimeout(1500)
  await expect(done).toBeVisible()

  // 撤销：一字节不差
  await done.getByRole('button', { name: '撤销' }).click()
  await expect.poll(() => bytes(vault, T).equals(before)).toBe(true)
  await expect.poll(() => log(vault)).toContain('撤销：相关栏连上「05-Amdahl定律」和「Gustafson-Law（古斯塔夫森定律）」')
  await expect(row(page, 'Gustafson-Law（古斯塔夫森定律）')).toBeVisible()
  await expect.poll(() => execFileSync('git', ['-C', vault, 'status', '--porcelain'], { encoding: 'utf8' }).trim()).toBe('')

  // 不相关：Speedup 以后不再出；记进梦游的「不再提」
  const sp = row(page, 'Speedup（加速比）')
  await sp.hover()
  await sp.getByRole('button', { name: '不相关' }).click()
  await expect(related(page).getByTestId('related-done').filter({ hasText: '以后不再把《Speedup（加速比）》和这篇列成像的' })).toBeVisible()
  const ledgerFile = join(userData, 'dream', key(vault) + '.ledger.json')
  expect(JSON.parse(readFileSync(ledgerFile, 'utf8')).rejected).toContain([SPEED, T].sort().join('\0'))
  // 关掉再开：不再列
  await relatedBtn(page).click()
  await expect(page.getByTestId('dview-related')).toBeHidden()
  await relatedBtn(page).click()
  await expect(row(page, 'Gustafson-Law（古斯塔夫森定律）')).toBeVisible()
  await expect(row(page, 'Speedup（加速比）')).toHaveCount(0)
  // 评测集里记了一行
  const labels = readFileSync(join(userData, 'dream-eval', key(vault), 'labels.jsonl'), 'utf8')
  expect(labels).toContain('"group":"related","choice":"no-link"')

  // 撤销「不相关」：又回来（在列表里再点一次不相关、再撤销）
  await row(page, 'Gustafson-Law（古斯塔夫森定律）').hover()
  await row(page, 'Gustafson-Law（古斯塔夫森定律）').getByRole('button', { name: '不相关' }).click()
  const d2 = related(page).getByTestId('related-done').filter({ hasText: 'Gustafson' })
  await d2.getByRole('button', { name: '撤销' }).click()
  await expect(row(page, 'Gustafson-Law（古斯塔夫森定律）')).toBeVisible()
  await expect.poll(() => JSON.parse(readFileSync(ledgerFile, 'utf8')).rejected).not.toContain([GUS, T].sort().join('\0'))
})

test('撤掉梦游连的：那一行去掉、一次提交，梦游不再连这一对；撤销一字节不差', async () => {
  run = await launch(FILES, { CN_AI_FAKE: '1' }, dreamState)
  const { page, vault, userData } = run
  await openNote(page, '05-Amdahl定律')
  await relatedBtn(page).click()
  const before = bytes(vault, GPU)
  const gpu = grp(page, 'dream').getByTestId('related-row').filter({ hasText: 'Amdahls-Law' })
  await gpu.hover()
  await gpu.getByRole('button', { name: '撤掉' }).click()
  const done = related(page).getByTestId('related-done').filter({ hasText: '已撤掉' })
  await expect(done).toBeVisible()
  await expect.poll(() => readFileSync(join(vault, GPU), 'utf8')).toBe("# Amdahl's Law\n\n它告诉我们专注于减少串行部分：数据传输、内核启动开销和同步点。\n")
  await expect.poll(() => log(vault)).toContain('相关栏：撤掉梦游连的「Amdahls-Law」→ [[05-Amdahl定律]]')
  const ledgerFile = join(userData, 'dream', key(vault) + '.ledger.json')
  expect(JSON.parse(readFileSync(ledgerFile, 'utf8')).rejected).toContain([GPU, T].sort().join('\0'))
  await done.getByRole('button', { name: '撤销' }).click()
  await expect.poll(() => bytes(vault, GPU).equals(before)).toBe(true)
  await expect.poll(() => JSON.parse(readFileSync(ledgerFile, 'utf8')).rejected).not.toContain([GPU, T].sort().join('\0'))
  await expect(grp(page, 'dream').getByTestId('related-row').filter({ hasText: 'Amdahls-Law' })).toBeVisible()
})

test('⌘ 停在一条上弹出那一篇；光标这一段：指着这一段的单独一组排在最前', async () => {
  run = await launch(FILES, { CN_AI_FAKE: '1' }, dreamState)
  const { page } = run
  await openNote(page, '05-Amdahl定律')
  await relatedBtn(page).click()
  const hp = row(page, '10-Amdahl定律（H&P视角）')
  await hp.hover()
  await page.keyboard.down('Meta')
  const peek = page.getByTestId('peek')
  await expect(peek).toBeVisible()
  await expect(peek).toContainText('H&P 从「只优化一部分」讲同一条定律')
  await page.keyboard.up('Meta')
  await expect(peek).toBeHidden()

  // 光标放进「2. Amdahl 定律公式」那一节
  await pane(page).locator('.cm-line', { hasText: '加速比 a = 1/(s + p/N)' }).click()
  await related(page).getByRole('tab', { name: '光标这一段' }).click()
  await expect(related(page).getByTestId('related-where')).toHaveText('光标在「2. Amdahl 定律公式」')
  const para = grp(page, 'para')
  expect(await related(page).locator('.rl-grp').first().getAttribute('data-group')).toBe('para')
  await expect(para.locator('.gh')).toContainText('提到这一段的')
  // 练习链的是这一节；Gustafson、Speedup 判的时候这篇那一句在这一节里
  await expect(para.getByTestId('related-row').locator('.tt')).toHaveText(['02-Amdahl-Webserver', 'Gustafson-Law（古斯塔夫森定律）', 'Speedup（加速比）'])
  // 别的照常列在下面
  await expect(grp(page, 'mention').getByTestId('related-row').filter({ hasText: '10-Amdahl定律（H&P视角）' })).toBeVisible()
  // 光标挪到「3. 数值表」：块那一段的那条换上来
  await pane(page).locator('.cm-line', { hasText: '串行占 1% 时最多快 100 倍' }).click()
  await expect(related(page).getByTestId('related-where')).toHaveText('光标在「3. 数值表」')
  await expect(para.getByTestId('related-row').locator('.tt')).toHaveText(['Amdahl-Law'])
})

test('小点：梦游给开着的这篇连了新的才出，在相关栏里看过就消；空的时候照设计页', async () => {
  run = await launch(FILES, { CN_AI_FAKE: '1' }, dreamState)
  const { page, vault, userData } = run
  await openNote(page, '05-Amdahl定律')
  // 第一次打开软件时报告里已经收下的不算新的
  await expect(rail(page).getByTestId('related-dot')).toHaveCount(0)
  // 梦游又收下一条（Speedup 那篇末尾加了「相关：」）：报告里多一条收下了的
  const f = join(userData, 'dream', key(vault) + '.json')
  const r = JSON.parse(readFileSync(f, 'utf8'))
  r.items.push({ id: 'k2', group: 'link', title: 'Speedup（加速比）', sub: '↔ [[05-Amdahl定律]]', why: '同一个式子', commit: null, files: [SPEED], state: 'taken' })
  writeFileSync(f, JSON.stringify(r))
  writeFileSync(join(vault, SPEED), readFileSync(join(vault, SPEED), 'utf8') + '\n相关：[[05-Amdahl定律]]\n')
  // 换一篇再回来（重新看一眼这篇有没有新的）
  await openNote(page, 'HPC')
  await openNote(page, '05-Amdahl定律')
  await expect(rail(page).getByTestId('related-dot')).toHaveCount(1)
  await relatedBtn(page).click()
  await expect(grp(page, 'dream').getByTestId('related-row').filter({ hasText: 'Speedup（加速比）' })).toBeVisible()
  await expect(rail(page).getByTestId('related-dot')).toHaveCount(0)
  // 关了再换篇回来也不再出
  await relatedBtn(page).click()
  await openNote(page, 'HPC')
  await openNote(page, '05-Amdahl定律')
  await page.waitForTimeout(500)
  await expect(rail(page).getByTestId('related-dot')).toHaveCount(0)

  // 没人提到的那篇：「还没有别的笔记提到这篇。」
  await openNote(page, '随手 3')
  await relatedBtn(page).click()
  await expect(related(page).getByTestId('related-no-mention')).toHaveText('还没有别的笔记提到这篇。')
})

test('新库（两三篇）：说这里会列什么、给「导入已有的笔记…」，不放假数据；梦游没跑过时说今晚第一次整理', async () => {
  run = await launch({ '收件箱/第一篇.md': '# 第一篇\n\n随手记一句。\n', '收件箱/第二篇.md': '# 第二篇\n\n提到 [[第一篇]]。\n' }, { CN_AI_FAKE: '1' })
  const { page } = run
  await openNote(page, '第二篇')
  await relatedBtn(page).click()
  const empty = related(page).getByTestId('related-empty')
  await expect(empty).toContainText('还没有相关的笔记')
  await expect(empty).toContainText('库里现在只有2篇')
  await expect(empty.getByRole('button', { name: '导入已有的笔记…' })).toBeVisible()
  // 有人提到的那篇照常列，梦游没跑过
  await openNote(page, '第一篇')
  await expect(row(page, '第二篇')).toBeVisible()
  await expect(related(page).getByTestId('related-dream-never')).toContainText('梦游还没跑过')
})
