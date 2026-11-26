/**
 * AI 对话菜单「全部对话」的组和段分清楚（2026-11-25 用户截图「这里目录和文字需要明显的区分开」）：
 * - 组头（图标 + 「课程 › ecp › Lecture05.pdf」+ 右边「2 段」）12 --t2，段 13 --t1，时间在右、当前这段打勾；
 * - 画布今日问的（today:<编号>，一段一个 key）、没挂页面的各归一组，不再每段自己成一组、下面又一行同样的字。
 * 对话直接写进软件设置目录（AgentStore 的 chats/<库>/、读 PDF 的 reading/），和用户截图同一个场景。
 * CN_SHOTS=目录 时另截交付图（CN_SHOT_SKIN=mint|petrol，CN_SHOT_TAG=改前|改后）。
 */
import { expect, test, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, leftView, openAi, openInboxTab, type Running } from './app'

const files = {
  '课程/ecp/第5讲 笔记.md': '# 第5讲 笔记\n\n逻辑电路。\n',
  '课程/test/读论文.md': '# 读论文\n\n',
}

const sha = (s: string, n: number) => createHash('sha1').update(s).digest('hex').slice(0, n)
const H = 3_600_000
const now = Date.now()
/** 一段：问的那句、几小时以前 */
const msgs = (text: string, ago: number, id = 1) => [
  { id, role: 'user', text, time: now - ago * H },
  { id: id + 1, role: 'ai', text: '这是测试回答。', time: now - ago * H + 1000 },
]

/** 用户截图那个库：收件箱两段（正看着第一段）、画布今日两段、没挂页面一段、课程/ecp 文件夹一段、两份 PDF、首页一段 */
function seed(vault: string, skin?: string) {
  const ud = join(dirname(vault), 'user-data')
  const chats = join(ud, 'ai', 'chats', sha(vault, 12))
  mkdirSync(chats, { recursive: true })
  const index: Record<string, { label: string; asks: number; at: number; n?: number; first?: string }> = {}
  const place = (key: string, label: string, cur: ReturnType<typeof msgs>, older: ReturnType<typeof msgs>[] = []) => {
    writeFileSync(join(chats, `${sha(key, 16)}.json`), JSON.stringify({ vault, place: key, label, msgs: cur, sessions: {}, at: cur[1]!.time, older: older.map((m, i) => ({ id: 1000 + i, msgs: m, sessions: {} })) }))
    index[key] = { label, asks: 1 + older.length, at: cur[1]!.time, ...(older.length ? { n: 1 + older.length } : {}), first: cur[0]!.text }
  }
  place('inbox', '收件箱', msgs('①帮我把放假的日子加入日历', 0.5), [msgs('/Users/macbook14 你能看到这个文件夹里的东西吗', 2)])
  place('today:a1', '我总感觉我有什么没做 你从我的…', msgs('我总感觉我有什么没做 你从我的待办里看看', 1))
  place('today:b2', '把今天要做的这几条排进今天空着…', msgs('把今天要做的这几条排进今天空着的时间', 3))
  place('conv:77', '学习笔记', msgs('这段不挂任何页了', 4))
  place('folder:课程/ecp', 'ecp', msgs('hi', 5))
  place('home', '首页', msgs('今天先做什么', 6))
  writeFileSync(join(chats, 'index.json'), JSON.stringify(index))
  writeFileSync(join(chats, 'pages.json'), JSON.stringify({ 'conv:77': { page: '-', label: '', at: now } }))
  // 读 PDF 那一套：userData/reading/<库 + 来源的 hash>.json
  const reading = join(ud, 'reading')
  mkdirSync(reading, { recursive: true })
  const pdf = (src: string, cur: ReturnType<typeof msgs>, older: ReturnType<typeof msgs>[] = []) =>
    writeFileSync(join(reading, `${sha(vault + '\0' + src, 16)}.json`), JSON.stringify({ pdf: src, page: 1, msgs: cur, threads: [], older: older.map((m, i) => ({ id: 2000 + i, msgs: m })) }))
  pdf('课程/ecp/Lecture05.pdf', msgs('给我讲解一下', 20), [msgs('what is the logic', 30)])
  pdf('课程/test/alr170025.pdf', msgs('这篇的方法是什么', 50))
  if (skin) writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin, frame: 'b' } }))
}

const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const menu = (page: Page) => page.getByRole('menu', { name: '对话' })

async function openAll(page: Page) {
  await openInboxTab(page)
  await openAi(page)
  await expect(chat(page).getByTestId('ai-conv')).toHaveText('收件箱')
  await chat(page).getByTestId('ai-conv').click()
  await menu(page).getByRole('menuitem', { name: '全部对话…' }).click()
  await expect(menu(page).getByTestId('ai-all-group').first()).toBeVisible()
}

test('全部对话：组头和段样子分开（字号、颜色、图标、段数靠右）；画布今日、没挂页面各一组不重复；当前这段打勾、时间在右；点一段切过去', async () => {
  test.setTimeout(120_000)
  const run = await launch(files, { CN_AI_FAKE: '1' }, (v) => seed(v))
  const { page } = run
  try {
    await openAll(page)
    const m = menu(page)
    const heads = m.locator('.gh')
    await expect(heads).toHaveText(['这一页 · 收件箱2 段', '画布今日2 段', '没挂页面1 段', '课程 › ecp1 段', '首页1 段', '课程 › ecp › Lecture05.pdf2 段', '课程 › test › alr170025.pdf1 段'])
    // 每组头前面一个图标：收件箱、画布今日、没挂页面、文件夹、首页、PDF、PDF
    await expect(heads.locator('.gi svg')).toHaveCount(7)
    // 画布今日的两段在一组里，组名不再是第一问；没有哪一行的字和组头一样
    const today = m.getByTestId('ai-all-group').filter({ has: page.locator('.gh', { hasText: '画布今日' }) })
    await expect(today.getByTestId('ai-all-row').locator('.lb')).toHaveText(['我总感觉我有什么没做 你从我的待办里看看', '把今天要做的这几条排进今天空着的时间'])
    const headNames = await heads.locator('.nm').allTextContents()
    const rowNames = await m.getByTestId('ai-all-row').locator('.lb').allTextContents()
    expect(rowNames.filter((r) => headNames.includes(r))).toEqual([])
    expect(rowNames).toHaveLength(10)

    // 量样子：组头 12、段 13；组头字色和段的字色不同（--t2 / --t1），段数比组名淡（--t3）
    const look = await page.evaluate(() => {
      const css = (el: Element | null) => (el ? getComputedStyle(el) : null)!
      const h = document.querySelector('.convmenu .gh')!
      const row = document.querySelector('.convmenu [data-testid="ai-all-row"]')!
      const probe = (v: string) => {
        const s = document.createElement('span')
        s.style.color = `var(${v})`
        // 量在菜单里面：右栏浮岛面板上 --t1/--t2 另有一套
        h.append(s)
        const c = getComputedStyle(s).color
        s.remove()
        return c
      }
      return {
        headSize: css(h.querySelector('.nm')).fontSize,
        headColor: css(h.querySelector('.nm')).color,
        countColor: css(h.querySelector('.n')).color,
        rowSize: css(row.querySelector('.lb')).fontSize,
        rowColor: css(row.querySelector('.lb')).color,
        t1: probe('--t1'),
        t2: probe('--t2'),
        t3: probe('--t3'),
      }
    })
    expect(look.headSize).toBe('12px')
    expect(look.rowSize).toBe('13px')
    expect(look.headColor).toBe(look.t2)
    expect(look.rowColor).toBe(look.t1)
    expect(look.countColor).toBe(look.t3)
    expect(look.headColor).not.toBe(look.rowColor)

    // 段数在组头最右；段的时间在那一行最右、和字同一行（截图里长的那行时间掉到下一行）
    const lay = await page.evaluate(() => {
      const box = (el: Element) => el.getBoundingClientRect()
      const h = document.querySelector('.convmenu .gh')!
      const rows = [...document.querySelectorAll('.convmenu [data-testid="ai-all-row"]')]
      return {
        count: { right: box(h.querySelector('.n')!).right, rowRight: box(h).right },
        rows: rows.map((r) => {
          const b = box(r)
          const t = box(r.querySelector('.r')!)
          const l = box(r.querySelector('.lb')!)
          return { right: b.right - t.right, inRow: t.top >= b.top && t.bottom <= b.bottom, sameLine: Math.abs(t.top + t.height / 2 - (l.top + l.height / 2)) < 2, labelLeft: l.left, h: b.height }
        }),
        headTextLeft: box(h.querySelector('.nm')!).left,
      }
    })
    expect(lay.count.rowRight - lay.count.right).toBeLessThanOrEqual(9)
    for (const r of lay.rows) {
      expect(r.right).toBeLessThanOrEqual(9)
      expect(r.inRow).toBe(true)
      expect(r.sameLine).toBe(true)
      expect(r.h).toBe(30)
      // 段的字和组名左边对齐（勾那一格 14 + 8）
      expect(Math.abs(r.labelLeft - lay.headTextLeft)).toBeLessThan(1)
    }

    // 当前这段（收件箱现在这段）打勾，别的不打
    const checked = m.getByRole('menuitemradio', { checked: true })
    await expect(checked).toHaveCount(1)
    await expect(checked.locator('.lb')).toHaveText('①帮我把放假的日子加入日历')
    await expect(checked.locator('.ck svg')).toHaveCount(1)

    // 搜「今天」：只剩画布今日那组的一段和首页那段
    await m.getByRole('searchbox', { name: '搜对话' }).fill('今天')
    await expect(heads).toHaveText(['画布今日1 段', '首页1 段'])
    await m.getByRole('searchbox', { name: '搜对话' }).fill('')

    // 「最近在别处问的」也是一组一行：画布今日一行写 2 段
    await page.keyboard.press('Escape')
    await chat(page).getByTestId('ai-conv').click()
    await expect(m.getByTestId('ai-page').locator('.lb')).toHaveText(['画布今日', '没挂页面', 'ecp', '首页', 'Lecture05.pdf'])
    await expect(m.getByTestId('ai-page').first().locator('.r')).toContainText('2 段')
    // 展开画布今日：两段各一行 30 高，时间在右边同一行（以前这几行套上了笔记页头的 .aih .sub，16 高、时间折到下面看不见）
    await m.getByRole('button', { name: '展开《画布今日》的几段' }).click()
    await expect(m.locator('.it.nest .lb')).toHaveText(['我总感觉我有什么没做 你从我的待办里看看', '把今天要做的这几条排进今天空着的时间'])
    const nest = await m.locator('.it.nest').evaluateAll((els) =>
      els.map((e) => {
        const b = e.getBoundingClientRect()
        const t = e.querySelector('.r')!.getBoundingClientRect()
        return { h: b.height, inRow: t.top >= b.top && t.bottom <= b.bottom && t.right <= b.right, text: e.querySelector('.r')!.textContent }
      }),
    )
    for (const r of nest) expect(r).toMatchObject({ h: 30, inRow: true, text: expect.stringMatching(/^今天 \d\d:\d\d$/) })

    // 真点：全部对话里点「hi」切到 ecp 那段
    await m.getByRole('menuitem', { name: '全部对话…' }).click()
    await m.getByTestId('ai-all-row').filter({ hasText: 'hi' }).click()
    await expect(m).toBeHidden()
    await expect(chat(page).getByTestId('ai-conv')).toHaveText('ecp')
    await expect(chat(page).locator('.um')).toHaveText(['hi'])
    // 再开：勾跟着到了「hi」
    await chat(page).getByTestId('ai-conv').click()
    await m.getByRole('menuitem', { name: '全部对话…' }).click()
    await expect(m.getByRole('menuitemradio', { checked: true }).locator('.lb')).toHaveText('hi')
  } finally {
    await run.close()
  }
})

/** 组头图标的颜色：课程/ecp 那组（文件夹）、Lecture05.pdf 那组、首页那组；文件树里 课程/ecp 那一行的文件夹图标；菜单里量的 --acc-t */
async function inks(page: Page) {
  const m = menu(page)
  const icon = (name: string) => m.getByTestId('ai-all-group').filter({ has: page.locator('.gh', { hasText: name }) }).first().getByTestId('ai-group-icon')
  const color = (l: ReturnType<Page['locator']>) => l.evaluate((el) => getComputedStyle(el).color)
  const accT = await m.evaluate((el) => {
    const s = document.createElement('span')
    s.style.color = 'var(--acc-t)'
    el.append(s)
    const c = getComputedStyle(s).color
    s.remove()
    return c
  })
  return {
    folder: await color(icon('课程 › ecp1 段')),
    pdf: await color(icon('Lecture05.pdf')),
    home: await color(icon('首页')),
    accT,
  }
}

/** 文件树里 课程/ecp 那一行的文件夹图标颜色（左栏「文件」，课程点开） */
async function treeInk(page: Page) {
  await leftView(page, '文件')
  const row = page.locator('[data-path="课程/ecp"]').first()
  if (!(await row.count())) await page.locator('[data-path="课程"]').first().click()
  await expect(row).toBeVisible()
  return row.locator('.fglyph').first().evaluate((el) => getComputedStyle(el).color)
}

test('组头图标染文件树里那个文件夹的颜色（深色主题往 --t1 掺），没有文件夹颜色的染 --acc-t；换主题跟着变', async () => {
  test.setTimeout(180_000)
  const seen: Record<string, Awaited<ReturnType<typeof inks>> & { tree: string }> = {}
  for (const skin of ['mint', 'petrol', 'pine', 'graphite']) {
    const run = await launch(files, { CN_AI_FAKE: '1' }, (v) => seed(v, skin))
    const { page } = run
    try {
      const tree = await treeInk(page)
      await openAll(page)
      const got = await inks(page)
      seen[skin] = { ...got, tree }
      // 文件夹那组和 PDF 那组（同在 课程/ecp）的图标和文件树里那个文件夹同色；首页那组是主题的 --acc-t
      expect(got.folder, skin).toBe(tree)
      expect(got.pdf, skin).toBe(tree)
      expect(got.home, skin).toBe(got.accT)
      expect(got.folder, skin).not.toBe(got.home)
    } finally {
      await run.close()
    }
  }
  // 薄荷是原色（课程下面的文件夹：天青 #2e7fa3），深色三套往 --t1 掺过、各不一样；--acc-t 四套各不一样
  expect(seen.mint!.folder).toBe('rgb(46, 127, 163)')
  expect(new Set(['mint', 'petrol', 'pine', 'graphite'].map((s) => seen[s]!.folder)).size).toBe(4)
  expect(new Set(['mint', 'petrol', 'pine', 'graphite'].map((s) => seen[s]!.home)).size).toBe(4)
})

const DIR = process.env.CN_SHOTS
test('交付图：和用户截图同一个场景的「全部对话」', async () => {
  test.skip(!DIR, '只在截交付图时跑（CN_SHOTS=目录）')
  test.setTimeout(120_000)
  const skin = process.env.CN_SHOT_SKIN ?? 'mint'
  const tag = process.env.CN_SHOT_TAG ?? '改后'
  mkdirSync(DIR!, { recursive: true })
  const run: Running = await launch(files, { CN_AI_FAKE: '1' }, (v) => seed(v, skin))
  const { page, app } = run
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1280, 820))
    await openAll(page)
    await page.mouse.move(5, 815)
    await page.waitForTimeout(400)
    const box = (await menu(page).boundingBox())!
    const pad = 16
    await page.screenshot({ path: join(DIR!, `${tag}-全部对话-${skin}.png`), clip: { x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2 } })
    await page.screenshot({ path: join(DIR!, `${tag}-全部对话-${skin}-整窗.png`) })
    // 滚到底：两份 PDF 那几组
    await menu(page).locator('.all').evaluate((el) => (el.scrollTop = el.scrollHeight))
    await page.waitForTimeout(200)
    await page.screenshot({ path: join(DIR!, `${tag}-全部对话-${skin}-滚到底.png`), clip: { x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2 } })
  } finally {
    await run.close()
  }
})
