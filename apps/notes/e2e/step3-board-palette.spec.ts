import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { acts, foldInbox, gitStatus, launch, pane, rail, waitSaved, tabOn } from './app'

// 工具板上的卡片、待办、列、子白板：按住拖到白板上，在松手处新建（用户 2026-11-15：「这些需要可以直接拖动到白板。」）

const PLAN = `---
type: board
color: #4A7FA7
---
<!-- column id=c1 x=700 y=80 w=300 title=要订的 -->
<!-- card id=k5 in=c1 -->
机票

<!-- card id=k6 in=c1 -->
车
`

/** 鼠标捏在新卡左上角往里这么多（画布坐标），和 board-drop.ts 的 GRAB 一样 */
const GRAB = { x: 24, y: 16 }

const board = (page: Page) => pane(page).getByTestId('board')
const pal = (page: Page, name: string) => board(page).locator('.bpal').getByRole('button', { name })
const ghost = (page: Page) => board(page).getByTestId('pal-ghost')
const read = (vault: string, f = '计划.md') => readFileSync(join(vault, f), 'utf8')

async function openBoard(page: Page, name: string) {
  await page.locator('.nav .si', { hasText: new RegExp(`^${name}`) }).first().click()
  await expect(tabOn(page)).toHaveText(name)
  await expect(board(page)).toBeVisible()
  await foldInbox(page)
}

async function mid(page: Page, name: string) {
  const b = (await pal(page, name).boundingBox())!
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}

/** 真鼠标：按住工具板上的按钮，分两段移到 to；release 为 false 时不松手 */
async function dragFromPal(page: Page, name: string, to: { x: number; y: number }, release = true) {
  const from = await mid(page, name)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 })
  await page.mouse.move(to.x, to.y, { steps: 5 })
  if (release) await page.mouse.up()
}

/** 画布坐标 → 屏幕坐标（按 .plane 现在的位置和缩放） */
async function screenOf(page: Page, p: { x: number; y: number }, scale: number) {
  const plane = (await board(page).locator('.plane').boundingBox())!
  return { x: plane.x + p.x * scale, y: plane.y + p.y * scale }
}

/** 落在屏幕上这一点时，新东西在文件里的左上角应该是多少 */
async function expectedAt(page: Page, at: { x: number; y: number }, scale: number) {
  const plane = (await board(page).locator('.plane').boundingBox())!
  return { x: (at.x - plane.x) / scale - GRAB.x, y: (at.y - plane.y) / scale - GRAB.y }
}

function expectNear(m: RegExpMatchArray | null, want: { x: number; y: number }) {
  expect(m, '文件里找不到新块').not.toBeNull()
  expect(Math.abs(Number(m![1]) - want.x)).toBeLessThanOrEqual(3)
  expect(Math.abs(Number(m![2]) - want.y)).toBeLessThanOrEqual(3)
}

/**
 * 这块白板用以前的写法（注释存列），2026-11-21 起打开时会一次转成「## 列名」写法（新写法的工具板、右键在 r9-board-doc.spec.ts、b2-board.spec.ts）。
 * 这里测的是以前的自由白板（导图、撤回了转写法的白板还用它）：把它记进旧写法名单，打开不转
 */
const keepOld = (...paths: string[]) => ({ '.canvas-notes/白板旧写法.json': JSON.stringify({ 版本: 1, 白板: paths }) })

async function start(files: Record<string, string> = { '计划.md': PLAN }) {
  const run = await launch({ ...files, ...keepOld('计划.md') })
  await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
  await openBoard(run.page, '计划')
  return run
}

test('四样都能拖到白板上任意位置，在松手处新建；拖的时候有跟着鼠标的预览', async () => {
  const run = await start()
  const { page, vault } = run
  try {
    // 卡片：拖到 (200, 160)，松手后直接进入编辑
    let to = await screenOf(page, { x: 200, y: 160 }, 1)
    await dragFromPal(page, '卡片', to, false)
    await expect(ghost(page)).toBeVisible()
    await expect(ghost(page)).toHaveAttribute('data-kind', 'card')
    await expect(ghost(page)).not.toHaveClass(/off/)
    const g = (await ghost(page).boundingBox())!
    expect(Math.abs(g.x - (to.x - GRAB.x))).toBeLessThanOrEqual(2)
    expect(Math.abs(g.y - (to.y - GRAB.y))).toBeLessThanOrEqual(2)
    expect(Math.abs(g.width - 280)).toBeLessThanOrEqual(2)
    let want = await expectedAt(page, to, 1)
    await page.mouse.up()
    await expect(ghost(page)).toHaveCount(0)
    const ta = board(page).getByRole('textbox', { name: '卡片内容' })
    await expect(ta).toBeFocused()
    await page.keyboard.type('拖出来的卡')
    await page.keyboard.press('Meta+Enter')
    await waitSaved(page)
    expectNear(read(vault).match(/<!-- card id=\w+ x=(\d+) y=(\d+) w=280 -->\n拖出来的卡\n/), want)

    // 待办：带一行空待办
    to = await screenOf(page, { x: 200, y: 360 }, 1)
    want = await expectedAt(page, to, 1)
    await dragFromPal(page, '待办', to)
    await waitSaved(page)
    expectNear(read(vault).match(/<!-- card id=\w+ x=(\d+) y=(\d+) w=280 -->\n\*\*待办\*\*\n- \[ \] \n/), want)
    await expect(board(page).locator('.bcard.k-todo')).toHaveCount(1)

    // 列：画布上一列「新的列」
    to = await screenOf(page, { x: 200, y: 520 }, 1)
    want = await expectedAt(page, to, 1)
    await dragFromPal(page, '列', to)
    await waitSaved(page)
    expectNear(read(vault).match(/<!-- column id=\w+ x=(\d+) y=(\d+) w=300 title=新的列 -->/), want)
    await expect(board(page).locator('.bcol')).toHaveCount(2)

    // 子白板：新建子白板文件，卡片放在松手处，开新标签起名
    to = await screenOf(page, { x: 450, y: 300 }, 1)
    want = await expectedAt(page, to, 1)
    await dragFromPal(page, '子白板', to)
    await expect(page.getByRole('textbox', { name: '笔记名字' })).toBeFocused()
    await page.keyboard.type('环岛路线')
    await page.keyboard.press('Enter')
    await expect(tabOn(page)).toHaveText('环岛路线')
    await expect.poll(() => read(vault)).toContain('[[环岛路线]]')
    expectNear(read(vault).match(/<!-- card id=\w+ x=(\d+) y=(\d+) w=280 -->\n\[\[环岛路线\]\]\n/), want)
    await page.locator('.tab', { hasText: '计划' }).locator('.tl').click()
    await expect(board(page).locator('.bcard.k-board', { hasText: '环岛路线' })).toBeVisible()
  } finally {
    await run.close()
  }
})

test('卡片和待办拖进已有的列：列高亮，松手放进那一列、排在落点的位置', async () => {
  const run = await start()
  const { page, vault } = run
  try {
    const col = board(page).locator('.bcol[data-id="c1"]')
    // 待办拖到「机票」和「车」之间
    const k6 = (await col.locator('.bcard[data-id="k6"]').boundingBox())!
    await dragFromPal(page, '待办', { x: k6.x + 60, y: k6.y + 2 }, false)
    await expect(col).toHaveClass(/drop/)
    await expect(ghost(page)).toHaveAttribute('data-kind', 'todo')
    await page.mouse.up()
    await expect(col).not.toHaveClass(/drop/)
    await expect(col.locator('.bcard')).toHaveCount(3)
    await expect(col.locator('h3 .meta')).toHaveText('3张卡片')
    await waitSaved(page)
    let md = read(vault)
    expect(md).toMatch(/<!-- card id=k5 in=c1 -->\n机票\n\n<!-- card id=\w+ in=c1 -->\n\*\*待办\*\*\n- \[ \] \n\n<!-- card id=k6 in=c1 -->\n车\n/)

    // 卡片拖到列最上面：放进列，直接进入编辑
    const top = (await col.locator('.bcard').first().boundingBox())!
    await dragFromPal(page, '卡片', { x: top.x + 60, y: top.y + 4 })
    const ta = col.getByRole('textbox', { name: '卡片内容' })
    await expect(ta).toBeFocused()
    await page.keyboard.type('护照')
    await page.keyboard.press('Meta+Enter')
    await waitSaved(page)
    md = read(vault)
    expect(md).toContain('<!-- column id=c1 x=700 y=80 w=300 title=要订的 -->\n<!-- card id=')
    expect(md).toMatch(/title=要订的 -->\n<!-- card id=\w+ in=c1 -->\n护照\n\n<!-- card id=k5 in=c1 -->/)
    await expect(col.locator('h3 .meta')).toHaveText('4张卡片')
  } finally {
    await run.close()
  }
})

test('列拖到已有的列上：不高亮，不嵌套，新列放在画布上', async () => {
  const run = await start()
  const { page, vault } = run
  try {
    const col = board(page).locator('.bcol[data-id="c1"]')
    const k5 = (await col.locator('.bcard[data-id="k5"]').boundingBox())!
    const to = { x: k5.x + 80, y: k5.y + 10 }
    const want = await expectedAt(page, to, 1)
    await dragFromPal(page, '列', to, false)
    await expect(ghost(page)).toHaveAttribute('data-kind', 'column')
    await expect(col).not.toHaveClass(/drop/)
    await page.mouse.up()
    await expect(board(page).locator('.bcol')).toHaveCount(2)
    await expect(board(page).locator('.bcol .bcol')).toHaveCount(0)
    await waitSaved(page)
    const md = read(vault)
    expectNear(md.match(/<!-- column id=\w+ x=(\d+) y=(\d+) w=300 title=新的列 -->/), want)
    expect(md).not.toMatch(/<!-- column [^>]*in=/)
    expect(md).toContain('<!-- column id=c1 x=700 y=80 w=300 title=要订的 -->\n<!-- card id=k5 in=c1 -->\n机票\n\n<!-- card id=k6 in=c1 -->\n车\n')
  } finally {
    await run.close()
  }
})

test('拖回工具板、拖到画布外、按 esc：都取消，文件不变，也不当成点了一下', async () => {
  const run = await start()
  const { page, vault } = run
  try {
    // 拖出去再拖回工具板上松手
    const back = await mid(page, '列')
    await dragFromPal(page, '卡片', await screenOf(page, { x: 300, y: 300 }, 1), false)
    await expect(ghost(page)).not.toHaveClass(/off/)
    await page.mouse.move(back.x, back.y, { steps: 5 })
    await expect(ghost(page)).toHaveClass(/off/)
    await page.mouse.up()
    await expect(ghost(page)).toHaveCount(0)

    // 拖到左栏（画布外）松手
    const side = (await page.locator('.nav').boundingBox())!
    await dragFromPal(page, '待办', { x: side.x + side.width / 2, y: side.y + 40 }, false)
    await expect(ghost(page)).toHaveClass(/off/)
    await page.mouse.up()

    // 拖到右边一格收件箱上松手（2026-11-21 起「未整理」浮层换成了这一格，标签条「收件箱 N」打开）
    await acts(page).getByTestId('db-inbox').click()
    const drawer = (await board(page).locator('.db-drawer').boundingBox())!
    await dragFromPal(page, '列', { x: drawer.x + 40, y: drawer.y + 60 })

    // 拖到一半按 esc
    await dragFromPal(page, '子白板', await screenOf(page, { x: 300, y: 400 }, 1), false)
    await expect(ghost(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(ghost(page)).toHaveCount(0)
    await page.mouse.up()

    await page.waitForTimeout(1200)
    await expect(board(page).locator('.bcard')).toHaveCount(2)
    await expect(board(page).locator('.bcol')).toHaveCount(1)
    await expect(board(page).getByRole('textbox', { name: '卡片内容' })).toHaveCount(0)
    await expect(tabOn(page)).toHaveText('计划')
    expect(read(vault)).toBe(PLAN)
    expect(gitStatus(vault)).toBe('')
  } finally {
    await run.close()
  }
})

test('点一下照旧放在可见区左上角附近；按住只抖几像素也算点', async () => {
  const run = await start()
  const { page, vault } = run
  try {
    // freeSpot = 60 + (块数 % 5) × 24：现在 3 块（一列两张卡）
    await pal(page, '待办').click()
    await waitSaved(page)
    expect(read(vault)).toMatch(/<!-- card id=\w+ x=132 y=132 w=280 -->\n\*\*待办\*\*\n- \[ \] \n/)

    // 按下、移 2 像素、松开：还是点一下（4 块：60 + 4 × 24）
    const m = await mid(page, '列')
    await page.mouse.move(m.x, m.y)
    await page.mouse.down()
    await page.mouse.move(m.x + 2, m.y + 1, { steps: 2 })
    await expect(ghost(page)).toHaveCount(0)
    await page.mouse.up()
    await waitSaved(page)
    expect(read(vault)).toMatch(/<!-- column id=\w+ x=156 y=156 w=300 title=新的列 -->/)

    await pal(page, '卡片').click()
    await expect(board(page).getByRole('textbox', { name: '卡片内容' })).toBeFocused()
    await page.keyboard.type('点出来的')
    await page.keyboard.press('Meta+Enter')
    await waitSaved(page)
    expect(read(vault)).toMatch(/<!-- card id=\w+ x=60 y=60 w=280 -->\n点出来的\n/)
  } finally {
    await run.close()
  }
})

test('AI 浮窗或右栏开着、白板缩到 0.8 时，落点照样对', async () => {
  const run = await start()
  const { page, vault } = run
  try {
    await page.getByRole('button', { name: '打开 AI' }).click()
    await expect(page.getByRole('complementary', { name: 'AI 对话' })).toBeVisible()
    await expect(board(page).locator('.plane')).toHaveAttribute('style', /scale\(0\.8\)/)

    let to = await screenOf(page, { x: 200, y: 300 }, 0.8)
    let want = await expectedAt(page, to, 0.8)
    await dragFromPal(page, '待办', to, false)
    // 预览跟着缩到 0.8
    const g = (await ghost(page).boundingBox())!
    expect(Math.abs(g.width - 280 * 0.8)).toBeLessThanOrEqual(2)
    expect(Math.abs(g.x - (to.x - GRAB.x * 0.8))).toBeLessThanOrEqual(2)
    await page.mouse.up()
    await waitSaved(page)
    expectNear(read(vault).match(/<!-- card id=\w+ x=(\d+) y=(\d+) w=280 -->\n\*\*待办\*\*/), want)

    // 缩放时拖进列也认得出落点：放在「车」后面
    const col = board(page).locator('.bcol[data-id="c1"]')
    const k6 = (await col.locator('.bcard[data-id="k6"]').boundingBox())!
    // 落点靠列的左边：画布上边让出 64 后（第 3 轮美学），「车」下面那一截到了 AI 浮窗的高度，浮窗盖着列的右半边
    await dragFromPal(page, '卡片', { x: k6.x + 20, y: k6.y + k6.height + 6 })
    await expect(col.getByRole('textbox', { name: '卡片内容' })).toBeFocused()
    await page.keyboard.type('缩放时放进来的')
    await page.keyboard.press('Meta+Enter')
    await waitSaved(page)
    expect(read(vault)).toMatch(/<!-- card id=k6 in=c1 -->\n车\n\n<!-- card id=\w+ in=c1 -->\n缩放时放进来的\n/)

    // 收起 AI，开右栏（历史），也是 0.8
    await page.keyboard.press('Meta+j')
    await expect(page.getByRole('complementary', { name: 'AI 对话' })).toHaveCount(0)
    await rail(page).getByRole('button', { name: /历史/ }).click()
    await expect(board(page).locator('.plane')).toHaveAttribute('style', /scale\(0\.8\)/)
    to = await screenOf(page, { x: 380, y: 520 }, 0.8)
    want = await expectedAt(page, to, 0.8)
    await dragFromPal(page, '列', to)
    await waitSaved(page)
    expectNear(read(vault).match(/<!-- column id=\w+ x=(\d+) y=(\d+) w=300 title=新的列 -->/), want)
  } finally {
    await run.close()
  }
})
