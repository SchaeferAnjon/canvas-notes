import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gitStatus, launch, pane, waitSaved, acts, tabOn } from './app'
import { ICELAND, LODGING } from './fixtures/board'

const board = (page: Page) => pane(page).getByTestId('board')
const card = (page: Page, id: string) => board(page).locator(`.bcard[data-id="${id}"]`)

async function openBoard(page: Page, name: string) {
  await page.locator('.nav .si', { hasText: new RegExp(`^${name}`) }).first().click()
  await expect(tabOn(page)).toHaveText(name)
  await expect(board(page)).toBeVisible()
}

async function dragBy(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 5 })
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 5 })
  await page.mouse.up()
}

async function center(page: Page, sel: ReturnType<Page['locator']>) {
  const b = (await sel.boundingBox())!
  return { x: b.x + b.width / 2, y: b.y + 18 }
}

const read = (vault: string, f: string) => readFileSync(join(vault, f), 'utf8')

test('打开白板什么都不做：文件不变；挪一张卡只改它那一行注释，⌘Z 回到原样', async () => {
  const run = await launch({ '冰岛自驾.md': ICELAND, '住宿.md': LODGING, '极光预报.md': '# 极光\n' })
  const { page, vault } = run
  try {
    await openBoard(page, '冰岛自驾')
    await expect(card(page, 'k1')).toContainText('出发前先定')
    await expect(card(page, 'k2')).toContainText('safetravel.is')
    await expect(card(page, 'k7')).toContainText('1张卡片')
    await expect(board(page).locator('.bcol h3')).toContainText('极光看哪两晚')
    await expect(board(page).locator('.wire')).toHaveCount(1)
    await page.waitForTimeout(1200)
    expect(gitStatus(vault)).toBe('')

    await dragBy(page, await center(page, card(page, 'k1')), 100, 50)
    await waitSaved(page)
    const after = read(vault, '冰岛自驾.md')
    expect(after).toMatch(/<!-- card id=k1 x=2[12]\d y=1[56]\d w=280 -->/)
    const stat = execFileSync('git', ['-C', vault, 'diff', '--numstat'], { encoding: 'utf8' }).trim()
    expect(stat).toBe('1\t1\t冰岛自驾.md')

    await board(page).focus()
    await page.keyboard.press('Meta+z')
    await waitSaved(page)
    expect(read(vault, '冰岛自驾.md')).toBe(ICELAND)
  } finally {
    await run.close()
  }
})

test('新建白板、双击加卡、改卡片、删卡片', async () => {
  const run = await launch({ '甲.md': '甲\n' })
  const { page, vault } = run
  try {
    await page.locator('aside.side').getByRole('button', { name: '新建白板' }).click()
    await expect(page.getByRole('textbox', { name: '笔记名字' })).toBeFocused()
    await page.keyboard.type('冰岛自驾')
    await page.keyboard.press('Enter')
    await expect(board(page)).toBeVisible()
    await expect(tabOn(page)).toHaveText('冰岛自驾')
    await expect.poll(() => existsSync(join(vault, '冰岛自驾.md'))).toBe(true)
    expect(read(vault, '冰岛自驾.md')).toMatch(/^---\ntype: board\ncolor: #[0-9A-F]{6}\n---\n$/)

    const box = (await board(page).boundingBox())!
    await page.mouse.dblclick(box.x + 300, box.y + 200)
    const ta = board(page).getByRole('textbox', { name: '卡片内容' })
    await expect(ta).toBeFocused()
    await page.keyboard.type('2.27 的住处还没订')
    await page.mouse.click(box.x + 700, box.y + 500)
    await waitSaved(page)
    expect(read(vault, '冰岛自驾.md')).toMatch(/<!-- card id=\w+ x=\d+ y=\d+ w=280 -->\n2\.27 的住处还没订\n\n$/)
    // 左栏「最近」里这块白板一行：它自己的颜色方块，右边是时间（2026-11-17 起左栏按时间排，不再写卡片数）
    await expect(page.locator('.nav .si', { hasText: '冰岛自驾' }).locator('.sw')).toBeVisible()

    // 双击改字
    await board(page).locator('.bcard').dblclick()
    await page.keyboard.press('Meta+a')
    await page.keyboard.type('住处订好了')
    await page.keyboard.press('Meta+Enter')
    await waitSaved(page)
    expect(read(vault, '冰岛自驾.md')).toContain('\n住处订好了\n\n')
    // Esc 收起也存下（和文档白板「改字」一样，d312d8d；不要的字 ⌘Z 撤回）
    await board(page).locator('.bcard').dblclick()
    await page.keyboard.type('又加的字')
    await page.keyboard.press('Escape')
    await expect(board(page).locator('.bcard')).toHaveText('住处订好了又加的字')
    await page.keyboard.press('Meta+z')
    await expect(board(page).locator('.bcard')).toHaveText('住处订好了')

    // 选中按删除键
    await board(page).locator('.bcard').click()
    await page.keyboard.press('Backspace')
    await expect(board(page).locator('.bcard')).toHaveCount(0)
    await waitSaved(page)
    expect(read(vault, '冰岛自驾.md')).not.toContain('card id=')
  } finally {
    await run.close()
  }
})

test('列：卡片拖进列、在列里排序、拖出来；列名可改', async () => {
  const run = await launch({ '冰岛自驾.md': ICELAND, '住宿.md': LODGING, '极光预报.md': '' })
  const { page, vault } = run
  try {
    await openBoard(page, '冰岛自驾')
    const col = board(page).locator('.bcol')
    // k1 拖到列最上面
    const target = (await col.locator('.bcard').first().boundingBox())!
    const from = await center(page, card(page, 'k1'))
    await dragBy(page, from, target.x + 40 - from.x, target.y + 4 - from.y)
    await expect(col.locator('.bcard')).toHaveCount(3)
    await expect(col.locator('h3 .meta')).toHaveText('3张卡片')
    await waitSaved(page)
    let md = read(vault, '冰岛自驾.md')
    expect(md).toContain('<!-- column id=c1 x=820 y=90 w=300 title="极光看哪两晚" -->\n<!-- card id=k1 in=c1 -->\n## 出发前先定')
    expect(md.indexOf('id=k1')).toBeLessThan(md.indexOf('id=k5'))

    // 拖出来放到画布空处
    const k1 = await center(page, card(page, 'k1'))
    const bb = (await board(page).boundingBox())!
    await dragBy(page, k1, bb.x + 300 - k1.x, bb.y + 620 - k1.y)
    await expect(col.locator('.bcard')).toHaveCount(2)
    await waitSaved(page)
    md = read(vault, '冰岛自驾.md')
    expect(md).toMatch(/<!-- card id=k1 x=\d+ y=\d+ w=280 -->/)
    expect(md).not.toContain('id=k1 in=')

    // 改列名
    await col.locator('h3').dblclick()
    await page.keyboard.type('极光')
    await page.keyboard.press('Enter')
    await waitSaved(page)
    expect(read(vault, '冰岛自驾.md')).toContain('<!-- column id=c1 x=820 y=90 w=300 title=极光 -->')
  } finally {
    await run.close()
  }
})

test('连线：从卡片右边的小圆点拖到另一张卡；点中连线按删除键去掉', async () => {
  const run = await launch({ '冰岛自驾.md': ICELAND, '住宿.md': LODGING, '极光预报.md': '' })
  const { page, vault } = run
  try {
    await openBoard(page, '冰岛自驾')
    await card(page, 'k3').hover()
    const h = (await card(page, 'k3').locator('.handle').boundingBox())!
    const to = await center(page, card(page, 'k4'))
    await dragBy(page, { x: h.x + 6, y: h.y + 6 }, to.x - h.x, to.y + 20 - h.y)
    await expect(board(page).locator('.wire')).toHaveCount(2)
    await waitSaved(page)
    expect(read(vault, '冰岛自驾.md')).toContain('links:\n  - k1 -> k2\n  - k3 -> k4\n---')

    await board(page).locator('[data-link="k1>k2"] .hit').click({ force: true })
    await expect(board(page).locator('[data-link="k1>k2"]')).toHaveClass(/on/)
    await page.keyboard.press('Backspace')
    await expect(board(page).locator('.wire')).toHaveCount(1)
    await waitSaved(page)
    expect(read(vault, '冰岛自驾.md')).toContain('links:\n  - k3 -> k4\n---')

    // 删掉卡片，连着它的线一起没了
    await card(page, 'k4').click()
    await page.keyboard.press('Backspace')
    await expect(board(page).locator('.wire')).toHaveCount(0)
    await waitSaved(page)
    expect(read(vault, '冰岛自驾.md')).not.toContain('links:')
  } finally {
    await run.close()
  }
})

test('待办打勾；子白板新建、起名后父白板里的链接跟着改、双击打开', async () => {
  const run = await launch({ '冰岛自驾.md': ICELAND, '住宿.md': LODGING, '极光预报.md': '' })
  const { page, vault } = run
  try {
    await openBoard(page, '冰岛自驾')
    await card(page, 'k3').getByRole('checkbox').nth(1).click()
    await waitSaved(page)
    expect(read(vault, '冰岛自驾.md')).toContain('- [x] 机票\n- [x] 车\n- [ ] 蓝冰洞向导')

    await board(page).locator('.bpal').getByRole('button', { name: '子白板' }).click()
    // 新标签，名字框等着起名
    await expect(page.getByRole('textbox', { name: '笔记名字' })).toBeFocused()
    await page.keyboard.type('环岛路线')
    await page.keyboard.press('Enter')
    await expect(tabOn(page)).toHaveText('环岛路线')
    expect(existsSync(join(vault, '环岛路线.md'))).toBe(true)
    await expect.poll(() => read(vault, '冰岛自驾.md')).toContain('[[环岛路线]]')
    expect(read(vault, '冰岛自驾.md')).not.toContain('未命名白板')

    await page.locator('.tab', { hasText: '冰岛自驾' }).locator('.tl').click()
    const sub = board(page).locator('.bcard.k-board', { hasText: '环岛路线' })
    await expect(sub).toContainText('0张卡片')
    await sub.dblclick()
    await expect(tabOn(page)).toHaveText('环岛路线')
  } finally {
    await run.close()
  }
})

// 普通文档切到白板是按节摆（doc-board，e2e/g2-doc-board.spec.ts）；「未整理」是白板文件（type: board）的
test('未整理：白板里没放进卡片的段落和收件箱里的东西拖上白板', async () => {
  const run = await launch({ '所思所想.md': '---\ntype: board\n---\n# 所思所想\n\n第一段想法\n\n第二段想法\n' })
  const { page, vault } = run
  mkdirSync(join(vault, '收件箱'))
  writeFileSync(join(vault, '收件箱', '冰洞.md'), '---\ncreated: 2026-11-14 21:10\n---\n> 冰洞只在冬天开放。\n—— [Ice](https://safetravel.is/ice)\n')
  try {
    await page.locator('.nav .si', { hasText: '所思所想' }).click()
    await expect(board(page).getByTestId('unsorted')).toContainText('3未整理')
    await board(page).getByTestId('unsorted').click()
    const bb = (await board(page).boundingBox())!
    const mini = board(page).locator('.mini', { hasText: '第一段想法' })
    const m = (await mini.boundingBox())!
    await dragBy(page, { x: m.x + 20, y: m.y + 10 }, bb.x + 300 - m.x, bb.y + 200 - m.y)
    await expect(board(page).locator('.bcard')).toHaveText('第一段想法')
    await waitSaved(page)
    expect(read(vault, '所思所想.md')).toMatch(/^---\ntype: board\n---\n# 所思所想\n\n第二段想法\n\n<!-- card id=\w+ x=\d+ y=\d+ w=280 -->\n第一段想法\n\n$/)

    const clip = board(page).locator('.mini', { hasText: '冰洞只在冬天开放' })
    const c = (await clip.boundingBox())!
    await dragBy(page, { x: c.x + 20, y: c.y + 10 }, bb.x + 500 - c.x, bb.y + 400 - c.y)
    await expect(board(page).locator('.bcard.k-clip')).toContainText('safetravel.is')
    await expect.poll(() => existsSync(join(vault, '收件箱', '冰洞.md'))).toBe(false)
    await waitSaved(page)
    expect(read(vault, '所思所想.md')).toContain('> 冰洞只在冬天开放。\n—— [Ice](https://safetravel.is/ice)')
    // 切回文档：同一个文件，内容都在
    await acts(page).getByRole('tab', { name: '文档' }).click()
    await expect(pane(page).locator('.cm-content')).toContainText('第一段想法')
  } finally {
    await run.close()
  }
})
