// 费曼「讲完以后」（③ feynman-after，task-yvabi；设计页 16-费曼学习 第 3、4 节）：
// 导图上的进度小点和「费曼 讲过 n/m」、补进导图留下的空框点开自己填、课程首页「费曼」那一块（一行数、每讲一颗、下次先讲）随一轮讲完变化；
// 判定卡上的按钮（② 画的）：补进导图先核对再放、算了不动、放进去改对那一支、撤回回到原样；拍成导图进子白板；出卡来源是费曼缺口、送进假的 AnkiConnect；记进笔记写在材料那篇末尾。
import { expect, type Locator, test, type Page } from '@playwright/test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseMindmap, withMindmap } from '@cn/format'
import { applyMapMerge, planMapMerge } from '../src/shared/feynman/after'
import { findRounds } from '../src/shared/feynman/doc'
import { launch, pane, tabOn } from './app'
import { fakeAnki } from './fixtures/anki'
import { CARDS_PATH, COURSE, feynmanVault, MAP_PATH, MAP_TEXT, passRound } from './fixtures/feynman-after'

const SHOTS = process.env.CN_SHOTS_DIR
/** 交付页用的截图（CN_SHOTS_DIR 给了才截）：marks 是要框出来的几处，框记在同名 .boxes.json（截图的像素） */
const shot = async (page: Page, name: string, marks: [string, Locator][] = []) => {
  if (!SHOTS) return
  await page.screenshot({ path: join(SHOTS, `${name}.png`) })
  const k = await page.evaluate(() => devicePixelRatio)
  const items = []
  for (const [what, l] of marks) {
    const b = await l.first().boundingBox()
    if (b) items.push({ n: items.length + 1, box: [b.x * k - 6, b.y * k - 6, b.width * k + 12, b.height * k + 12].map(Math.round), what })
  }
  writeFileSync(join(SHOTS, `${name}.boxes.json`), JSON.stringify(items, null, 1))
}
const read = (vault: string, rel: string) => readFileSync(join(vault, rel), 'utf8')
const map = (page: Page) => pane(page).getByTestId('mindmap')

/** 左栏「最近」点一篇（样例库刚建好，都在「今天」里） */
async function openPath(page: Page, title: string) {
  await page.locator('.nav .si', { hasText: title }).first().click()
  await expect(tabOn(page)).toHaveText(title)
}

/** 「范数」这一支补进去过的样子（空框、讲错标红）：先用同一套纯函数做好放进库里 */
const mergedText = () => {
  const roots = parseMindmap(MAP_TEXT).roots
  return withMindmap(MAP_TEXT, applyMapMerge(roots, planMapMerge(roots, '0.2', findRounds(MAP_TEXT)[0]!.meta)).roots)
}

test('导图上：第一层的进度小点、「费曼 讲过 n/m」；讲错标红挂正确说法、空框点开自己填；又讲完一轮以后小点和数跟着变', async () => {
  const run = await launch({ ...feynmanVault(), [MAP_PATH]: mergedText() }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await openPath(page, '导图 · 线性代数 2.3')
    await expect(map(page)).toBeVisible()
    const dots = map(page).getByTestId('map-feynman-dot')
    await expect(dots).toHaveCount(3)
    await expect(dots.nth(0)).toHaveAttribute('data-state', 'none')
    await expect(dots.nth(2)).toHaveAttribute('data-state', 'fail')
    await expect(dots.nth(2)).toHaveAttribute('data-tip', /^没过 · .+讲的 · 讲过1次$/)
    await expect(map(page).getByTestId('map-feynman-progress')).toHaveText('费曼 讲过1/3')
    // 讲错的节点字是红的，下面挂着带框的正确说法；含糊的后面一个虚线空框
    const wrong = map(page).locator('.mm-node.wrong')
    await expect(wrong).toHaveText('f(αx) = |α| f(x)')
    await expect(map(page).locator('.mm-node.fixn')).toHaveText('是 |α| 倍')
    const blank = map(page).getByTestId('map-blank')
    await expect(blank).toHaveCount(1)
    await expect(blank).toHaveText('自己补一句')
    await shot(page, 'map-merged', [
      ['第一层每个点后面一个小点：没讲过空心灰圈、过绿、差一点黄、没过红', dots.nth(2)],
      ['中心下面「费曼 讲过1/3」', map(page).getByTestId('map-feynman-progress')],
      ['讲错的节点字变红，后面挂一个带红框的正确说法（AI 写的）', map(page).locator('.mm-node.fixn')],
      ['含糊、没讲到的后面挂虚线空框「自己补一句」', blank],
    ])

    // 点开空框自己填：变成「非负」下面的一个子节点，空框没了
    await blank.click()
    await page.getByTestId('map-inline').fill('只有零向量的范数是 0')
    await page.keyboard.press('Enter')
    await expect(map(page).getByTestId('map-blank')).toHaveCount(0)
    await expect(map(page).locator('.mm-node', { hasText: '只有零向量的范数是 0' })).toBeVisible()
    await expect.poll(() => read(vault, MAP_PATH)).toContain('    - 非负 f(x) ≥ 0\n      - 只有零向量的范数是 0\n')
    expect(read(vault, MAP_PATH)).not.toContain('<!-- blank -->')

    // 「标量和向量」那一支又讲完一轮（过了）：小点变绿，讲过 2/3
    writeFileSync(join(vault, MAP_PATH), passRound(read(vault, MAP_PATH)))
    await expect(dots.nth(0)).toHaveAttribute('data-state', 'pass', { timeout: 10_000 })
    await expect(map(page).getByTestId('map-feynman-progress')).toHaveText('费曼 讲过2/3')
    await dots.nth(0).hover()
    await page.waitForTimeout(700)
    await shot(page, 'map-dots', [
      ['又讲完一轮「标量和向量」：小点变绿，悬停写哪天讲的', dots.nth(0)],
      ['讲过 2/3', map(page).getByTestId('map-feynman-progress')],
      ['空框点开自己填的，变成它下面的子节点', map(page).locator('.mm-node', { hasText: '只有零向量的范数是 0' })],
    ])
  } finally {
    await run.close()
  }
})

test('课程首页「费曼」：一行数、每讲一颗、下次先讲（没过隔一天的那个）；又讲完一轮数跟着变；点「下次先讲」打开那块白板', async () => {
  const run = await launch(feynmanVault(), { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('线性代数')
    await page.locator('.pal-row', { hasText: /^线性代数/ }).first().click()
    const w = page.locator('[data-widget="feynman"]')
    await expect(w).toBeVisible()
    // 两轮都是「范数」（导图那一轮、卡片那一轮）：同一个点算一个，看最近一次；单子上还有两个没讲过
    await expect(w.getByTestId('fw-feynman-count')).toHaveText(/^核心知识点3个\s*过0\s*差一点\d\s*没过\d\s*没讲过2$/)
    await expect(w.getByTestId('fw-feynman-next')).toContainText('下次先讲：')
    await expect(w.locator('.chip')).toHaveText(['第2讲 0/3'])
    await shot(page, 'course-before', [
      ['一行数：核心知识点 · 过 · 差一点 · 没过 · 没讲过', w.getByTestId('fw-feynman-count')],
      ['下次先讲一个，右边写为什么挑它', w.getByTestId('fw-feynman-next')],
      ['每讲一颗：过了几个 / 一共几个', w.locator('.chip')],
    ])

    // 「标量和向量」讲完一轮，过了
    writeFileSync(join(vault, MAP_PATH), passRound(read(vault, MAP_PATH)))
    await expect(w.getByTestId('fw-feynman-count')).toHaveText(/^核心知识点3个\s*过1\s*差一点\d\s*没过\d\s*没讲过1$/, { timeout: 10_000 })
    await expect(w.locator('.chip')).toHaveText(['第2讲 1/3'])
    await shot(page, 'course-after', [
      ['又讲完一轮（过）：过 +1、没讲过 −1', w.getByTestId('fw-feynman-count')],
      ['第2讲 1/3', w.locator('.chip')],
    ])

    // 点「下次先讲」：打开那块白板
    const next = w.getByTestId('fw-feynman-next')
    const topic = (await next.locator('.truncate').textContent())!.replace('下次先讲：', '')
    expect(topic.length).toBeGreaterThan(0)
    await next.click()
    await expect(tabOn(page)).toHaveText(/导图 · 线性代数 2\.3|范数 白板/)
    // 直接开讲那一个点：白板上出来一列，先列「这次要讲到」
    await expect(pane(page).getByTestId('fy-plan').first()).toBeVisible({ timeout: 15_000 })
    await shot(page, 'course-start')
    void COURSE
  } finally {
    await run.close()
  }
})

const sheet = (page: Page) => page.getByRole('dialog', { name: '核对要放的导图' })
const cardsDlg = (page: Page) => page.getByRole('dialog', { name: '出卡' })
const col = (page: Page) => pane(page).getByTestId('fy-col')

test('卡片那一轮：拍成导图（走拍导图的核对、放上白板，生成在这块白板的子白板里）；出卡（来源费曼缺口，送进假的 AnkiConnect，送过的标已送）；记进笔记（材料那篇末尾一块「费曼缺口 · 范数」）', async () => {
  const anki = await fakeAnki()
  const run = await launch(feynmanVault(), { CN_AI_FAKE: '1', CN_ANKI_URL: anki.url })
  const { page, vault } = run
  try {
    await openPath(page, '范数 白板')
    await expect(col(page)).toBeVisible()
    await col(page).scrollIntoViewIfNeeded()
    await shot(page, 'cards-column')

    // 拍成导图：② 核对（大纲是这一轮整理成的树），③ 放上白板
    await col(page).getByTestId('fy-tomap').click()
    await expect(sheet(page)).toBeVisible()
    await expect(sheet(page).locator('.mm-steps')).toContainText('讲')
    await shot(page, 'snap-check', [
      ['拍导图那套的三步：这里第一步是「讲」', sheet(page).locator('.mm-steps')],
      ['这一轮整理成的树：讲清的挂你的原话，讲错、空框标出来', sheet(page).locator('.mm-rows')],
      ['「做成白板导图」：生成在这块白板的子白板里', sheet(page).getByRole('button', { name: '做成白板导图' })],
    ])
    await sheet(page).getByRole('button', { name: '做成白板导图' }).click()
    await expect(sheet(page)).toHaveCount(0)
    const sub = `${COURSE}/范数 导图.md`
    await expect.poll(() => existsSync(join(vault, sub))).toBe(true)
    const subText = read(vault, sub)
    expect(subText).toContain('所属白板: "[[范数 白板]]"')
    expect(subText).toContain('- 范数\n  - 量的是向量有多大\n')
    expect(subText).toContain('  - 能不能是负的 <!-- blank -->\n')
    expect(subText).not.toContain('![')
    await expect.poll(() => read(vault, CARDS_PATH)).toContain('[[范数 导图]]')
    // 落点一张子白板卡，放进材料卡所在的「剪自 d2l」那一列末尾（不进费曼那一节，不出「离开了自己那一节」的提示）
    const subCard = pane(page).locator('.db-col', { hasText: '剪自 d2l' }).getByText('范数 导图', { exact: true })
    await subCard.scrollIntoViewIfNeeded()
    await expect(subCard).toBeVisible()
    expect(read(vault, CARDS_PATH)).toMatch(/范数必须非负：f\(x\) ≥ 0\n\n\[\[范数 导图\]\]\n/)
    await shot(page, 'snap-placed', [
      ['子白板卡放进材料卡那一列的末尾，点开是那张导图', subCard],
      ['底栏一句带撤回', page.getByRole('button', { name: '撤回' })],
    ])

    // 出卡：现有的出卡弹窗，来源「费曼缺口」，一张张过，送进 Anki
    await col(page).getByTestId('fy-cards').click()
    await expect(cardsDlg(page).locator('.dh b')).toHaveText('出卡 · 费曼缺口 · 范数')
    await expect(cardsDlg(page).locator('.paper .foot span').first()).toHaveText(/^费曼 · 范数/)
    await shot(page, 'cards-dialog', [
      ['现有的出卡弹窗，来源「费曼缺口 · 范数」，不再问 AI 改写', cardsDlg(page).locator('.dh')],
      ['问题是这一条核心，答案是缺口的正确说法', cardsDlg(page).locator('.paper .top')],
      ['纸底出处：费曼 · 范数 · 公式；「打开原文」回到这块白板', cardsDlg(page).locator('.paper .foot')],
      ['下面写这条是哪种、你当时说的', cardsDlg(page).locator('.orig')],
    ])
    await cardsDlg(page).getByRole('button', { name: /^送进Anki/ }).click()
    await expect(cardsDlg(page)).toHaveCount(0)
    await expect.poll(() => anki.notes.length).toBeGreaterThan(0)
    expect(anki.notes.every((n) => n.deckName.startsWith('课程::线性代数'))).toBe(true)
    expect(anki.notes.map((n) => n.fields.Question)).toContain('范数：放大 α 倍会怎样？')
    await expect.poll(() => read(vault, CARDS_PATH)).toContain('"sent":true')

    // 记进笔记：材料来自的那篇（这块白板）末尾一块
    const before = read(vault, CARDS_PATH)
    await col(page).getByTestId('fy-tonote').click()
    await expect.poll(() => read(vault, CARDS_PATH)).toContain('## 费曼缺口 · 范数\n\n> [!ai] 缺口')
    const after = read(vault, CARDS_PATH)
    expect(after.startsWith(before.replace(/\s*$/, ''))).toBe(true)
    expect(after.slice(after.indexOf('## 费曼缺口'))).not.toMatch(/- \[ \]/)
    await shot(page, 'to-note', [
      ['材料那篇（这块白板）末尾一块「费曼缺口 · 范数」：判定一行和缺口，AI 块', pane(page).getByText('费曼缺口 · 范数').first()],
      ['送过的缺口写「✓ 已送进Anki」', col(page).getByText('✓ 已送进Anki').first()],
      ['底部一句带撤回', page.getByRole('button', { name: '撤回' }).last()],
    ])
  } finally {
    await run.close()
    await anki.close()
  }
})

test('导图那一轮：补进导图先列出要改的几处；算了不动文件；放进去改对那一支、一个个长出来；撤回回到原样', async () => {
  const run = await launch(feynmanVault(), { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await openPath(page, '导图 · 线性代数 2.3')
    await expect(col(page)).toBeVisible()
    const merge = page.getByTestId('feynman-merge')
    const btn = col(page).getByTestId('fy-tomap')
    await expect(btn).toHaveText('补进导图')

    // 算了：什么都不动
    await btn.click()
    await expect(merge.locator('.fa-lines li')).toHaveText([
      '加一个节点，用你的原话：「范数就是向量的长度」',
      '「f(αx) = |α| f(x)」标红，下面挂一句正确说法：「是 |α| 倍」',
      '「非负 f(x) ≥ 0」后面留一个虚线空框，你自己补一句',
      '讲清的节点不动',
    ])
    await shot(page, 'merge-check', [
      ['贴着「补进导图」弹：先列出要改的几处', merge.locator('.fa-lines')],
      ['算了 / 放进去', merge.locator('.fa-ft')],
      ['导图那一支这时还没改', map(page).locator('.mm-node', { hasText: 'f(αx) = |α| f(x)' })],
    ])
    await merge.getByRole('button', { name: '算了' }).click()
    await expect(merge).toHaveCount(0)
    await page.waitForTimeout(800)
    expect(read(vault, MAP_PATH)).toBe(MAP_TEXT)

    // 放进去：那一支的列表行改对，别处一字不动
    await btn.click()
    await merge.getByTestId('feynman-merge-put').click()
    await expect(merge).toHaveCount(0)
    const want = MAP_TEXT.replace('    - f(αx) = |α| f(x)\n', '    - f(αx) = |α| f(x) <!-- wrong -->\n      - 是 |α| 倍 <!-- fix -->\n')
      .replace('    - 非负 f(x) ≥ 0\n', '    - 非负 f(x) ≥ 0 <!-- blank -->\n')
      .replace('    - L2：平方和开根 · L1：绝对值之和\n', '    - L2：平方和开根 · L1：绝对值之和\n    - 范数就是向量的长度\n')
    await expect.poll(() => read(vault, MAP_PATH), { timeout: 10_000 }).toBe(want)
    await expect(map(page).locator('.mm-node.wrong')).toHaveText('f(αx) = |α| f(x)')
    await expect(map(page).getByTestId('map-blank')).toHaveCount(1)
    await shot(page, 'merge-growing')
    // 一个个长出来：长完了，标红的、空框、你的原话都在
    await expect(map(page).locator('.mm-node.grow, .mm-blank.grow, .mm-node.hid')).toHaveCount(0, { timeout: 5000 })
    await shot(page, 'merge-done', [
      ['你讲了、导图上没有的：用你的原话加一个节点', map(page).locator('.mm-node', { hasText: '范数就是向量的长度' })],
      ['讲错的标红，挂一句正确说法', map(page).locator('.mm-node.fixn')],
      ['含糊的留虚线空框', map(page).getByTestId('map-blank')],
      ['底部一句带撤回', page.getByRole('button', { name: '撤回' }).last()],
    ])

    // 底部「撤回」：回到原样
    await page.getByRole('button', { name: '撤回' }).last().click()
    await expect.poll(() => read(vault, MAP_PATH), { timeout: 10_000 }).toBe(MAP_TEXT)
    await expect(map(page).locator('.mm-node.wrong')).toHaveCount(0)
  } finally {
    await run.close()
  }
})
