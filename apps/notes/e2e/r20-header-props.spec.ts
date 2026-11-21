/**
 * 0.4.6 之后用户提的三处（task-zligc）：
 * 1. 标题下那行（文件夹 ▾ · 改于 · 字数 · 剪自 网站）：中间栏窄到 420 时文件夹名不被挤成一字一行的竖排、来源不被截成半个词；
 *    放不下时整项换到下一行（偏好「标题下那行不折成竖排」）。
 * 2. 「属性」弹层照设计（DESIGN.v3 1.8、four-items 小样 2a）：按类型列项、界面上的名字是中文（文件里的键不改）、
 *    视频的时长写成 28:39、字幕写「中文 · 人工字幕」；附件组的字照第 114 行；改一项写回文件、键名不变。
 * 3. 网页栏和中间栏的分隔线：网页栏不再卡在 640，只让中间至少留 420；双击拉到最宽、再双击回来；重开软件还在。
 * 都是真点、真拖，窗口不上屏。
 */
import { _electron as electron, expect, test, type Locator, type Page } from '@playwright/test'
import { readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import electronPath from 'electron'
import { acts, launch, openNote, pane, rail, type Running, waitSaved } from './app'
import { solidPng } from './fixtures/png'

const VIDEO = '剪藏/视频/为了使用Claude，中国地区用户都搞出了什么招.md'
const VIDEO_TEXT = [
  '---',
  'type: video',
  'source: https://www.youtube.com/watch?v=rEJHzg2nW84',
  'site: youtube',
  'channel: 我拿过诺奖',
  'duration: 1719',
  'subtitles: zh · 人工字幕',
  '---',
  '# 为了使用Claude，中国地区用户都搞出了什么招',
  '',
  '## AI 摘要',
  'AI 在写摘要…',
  '',
  '## 记下的时刻',
  '还没有。看的时候按 ⌥S 记下这一刻。',
  '',
  '## 00:00 00:00 起',
  '[00:00](https://www.youtube.com/watch?v=rEJHzg2nW84&t=0s) 今年上半年，Anthropic 一共封掉了多少个 Claude 账号？',
  '',
].join('\n')
const BOOK = '阅读/趣说明朝276年.md'
const BOOK_TEXT = ['---', '类型: 书摘', '作者: 关丁', '来源: https://weread.qq.com/web/reader/abc', '划线: 4', '想法: 1', 'bookId: "3300012345"', '---', '# 趣说明朝276年', '', '> 朱元璋出身贫苦。', ''].join('\n')
const CLIP = '剪藏/冰岛/最佳旅游季节.md'
const CLIP_TEXT = ['---', 'created: 2026-11-20 16:08', 'source: https://example.com/iceland/season', '---', '# 最佳旅游季节', '', '夏季白天长。', ''].join('\n')
const PDFNOTE = '课程/ecp/第3讲 笔记.md'
const PDFNOTE_TEXT = ['---', '类型: 笔记', '课程: ecp', '第几讲: 3', '来源: "[[第3讲.pdf]]"', '日期: 2026-11-10', '---', '# 第3讲 笔记', '', '比较静态。', ''].join('\n')
const PIC = '课程/ecp/Lecture05 笔记.md'
const PIC_DIR = '附件/课程/ecp/Lecture05 笔记'
const PIC_TEXT = ['---', '类型: 笔记', '课程: ecp', '第几讲: 5', '---', '# Lecture05 笔记', '', '![](../../附件/课程/ecp/Lecture05%20笔记/%E6%88%AA%E5%9B%BE%201.png)', '', '## 为什么要先看符号', '', '![](../../附件/课程/ecp/Lecture05%20笔记/%E6%88%AA%E5%9B%BE%202.png)', ''].join('\n')

const files = {
  [VIDEO]: VIDEO_TEXT,
  [BOOK]: BOOK_TEXT,
  [CLIP]: CLIP_TEXT,
  [PDFNOTE]: PDFNOTE_TEXT,
  [PIC]: PIC_TEXT,
  [`${PIC_DIR}/截图 1.png`]: solidPng(160, 90, [40, 120, 160]),
  [`${PIC_DIR}/截图 2.png`]: solidPng(160, 90, [160, 90, 60]),
  '周记/2026-W47.md': '# 2026-W47\n\n这周读线代。\n',
}

const SHOTS = process.env.CN_SHOTS
async function shot(run: Running, name: string) {
  if (!SHOTS) return
  await run.page.waitForTimeout(300)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(b64, 'base64'))
}
const settings = (appearance: Record<string, unknown>) => (v: string) => {
  const ud = join(dirname(v), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, ...appearance } }))
}
const read = (vault: string, f: string) => readFileSync(join(vault, f), 'utf8')
const size = (run: Running, w: number, h = 900) => run.app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0]!.setContentSize(w!, h!), [w, h])
const width = (l: Locator) => l.evaluate((el) => el.getBoundingClientRect().width)
const center = (page: Page) => page.locator('main.center')
const webCol = (page: Page) => page.locator('.dcol').filter({ has: page.getByTestId('dtab-web') })
const sash = (page: Page) => page.getByRole('separator', { name: '拖动调整右栏宽度' })

async function openWeb(page: Page) {
  await rail(page).getByRole('button', { name: '网页' }).click()
  await expect(webCol(page)).toHaveCount(1)
}
/** 窗口宽到中间栏正好 420 */
async function centerTo(run: Running, want: number) {
  for (let i = 0; i < 3; i++) {
    const [win, c] = await Promise.all([run.page.evaluate(() => innerWidth), width(center(run.page))])
    if (Math.abs(c - want) < 1) return
    await size(run, Math.round(win + want - c))
    await run.page.waitForTimeout(250)
  }
  expect(Math.round(await width(center(run.page)))).toBe(want)
}

/** 标题下那一行：每一项的框（文件夹按钮、名字、改于、字数、剪自） */
const metaBoxes = (page: Page) =>
  pane(page)
    .locator('.cm-meta')
    .evaluate((meta) => {
      const r = (el: Element | null | undefined) => {
        const b = el!.getBoundingClientRect()
        return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), h: Math.round(b.height) }
      }
      const btn = meta.querySelector('.cm-folder')!
      const name = [...btn.querySelectorAll('span')].find((s) => !s.children.length)!
      const label = [...meta.querySelectorAll('.cm-meta-src span')].find((s) => !s.children.length) as HTMLElement | undefined
      // 每一项（新的一项一块；旧代码是一整串）
      const content = meta.closest('.cm-content')!
      const cs = getComputedStyle(content)
      const cr = content.getBoundingClientRect()
      return {
        name: { text: name.textContent, ...r(name) },
        folder: r(btn),
        rest: [...meta.querySelectorAll('.cm-meta-item:not(.src), .cm-meta-rest')].filter((el) => getComputedStyle(el).display !== 'contents').map((el) => ({ text: el.textContent, ...r(el) })),
        src: label ? { text: label.textContent, ...r(label), clipped: label.scrollWidth > label.clientWidth + 1 } : null,
        srcBox: meta.querySelector('.cm-meta-src') ? r(meta.querySelector('.cm-meta-src')) : null,
        contentRight: Math.round(cr.right - parseFloat(cs.paddingRight)),
        metaRight: Math.round(meta.getBoundingClientRect().right),
      }
    })

test('标题下那一行：中间栏 420 时文件夹名一行、「youtube」完整、整项不拆；宽的时候一行放下', async () => {
  const run = await launch(files)
  const { page } = run
  try {
    await openNote(page, '为了使用Claude，中国地区用户都搞出了什么招')
    await openWeb(page)
    await centerTo(run, 420)
    await page.waitForTimeout(300)
    const m = await metaBoxes(page)
    // 文件夹名「视频」只占一行（12px × 1.5 = 18 高），不被挤成「视 / 频」
    expect(m.name.text).toBe('视频')
    expect(m.name.h).toBeLessThanOrEqual(20)
    expect(m.folder.h).toBeLessThanOrEqual(24)
    // 来源「youtube.com」整个看得到：没被省略、没伸出正文右边
    expect(m.src?.text).toBe('youtube.com')
    expect(m.src!.clipped).toBe(false)
    expect(m.src!.right).toBeLessThanOrEqual(m.contentRight + 1)
    expect(m.srcBox!.h).toBeLessThanOrEqual(20)
    // 每一项（改于、字数）自己不折行
    for (const r of m.rest) expect(r.h, `「${r.text}」折行了`).toBeLessThanOrEqual(20)
    await shot(run, 'meta-420')

    // 宽的时候：网页栏收起，整行一行放下（每一项同一个顶）
    await rail(page).getByRole('button', { name: '网页' }).click()
    await expect(webCol(page)).toHaveCount(0)
    await page.waitForTimeout(300)
    const w = await metaBoxes(page)
    const tops = new Set([w.name.top, ...w.rest.filter((r) => r.text?.trim()).map((r) => r.top), w.src!.top])
    expect([...tops].every((t) => Math.abs(t - w.name.top) <= 2)).toBe(true)
    await shot(run, 'meta-wide')
  } finally {
    await run.close()
  }
})

/** 弹层里每一行：界面上的名字、看到的值 */
const propRows = (page: Page) =>
  page
    .getByRole('dialog', { name: '属性' })
    .locator('.pr:not(.new)')
    .evaluateAll((rows) =>
      rows.map((r) => {
        const k = r.querySelector('.k')!.textContent!.trim()
        const sel = r.querySelector('select')
        const inp = r.querySelector('input')
        const v = sel ? sel.selectedOptions[0]!.textContent!.trim() : inp ? inp.value : (r.querySelector('.v')?.textContent ?? '').trim()
        return [k, v]
      }),
    )
async function openProps(page: Page) {
  await acts(page).getByRole('button', { name: '属性' }).click()
  await expect(page.getByRole('dialog', { name: '属性' })).toBeVisible()
}
async function closeProps(page: Page) {
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: '属性' })).toHaveCount(0)
}

test('属性弹层按类型列项、名字是中文：视频（时长 28:39、字幕「中文 · 人工字幕」）、书摘、剪藏网页、PDF 笔记、带图的笔记（附件组）；改频道写回 channel', async () => {
  const run = await launch(files)
  const { page, vault } = run
  try {
    // 视频
    await openNote(page, '为了使用Claude，中国地区用户都搞出了什么招')
    await openProps(page)
    expect(await propRows(page)).toEqual([
      ['类型', '视频'],
      ['网站', 'YouTube'],
      ['频道', '我拿过诺奖'],
      ['时长', '28:39'],
      ['字幕', '中文 · 人工字幕'],
      ['来源', 'https://www.youtube.com/watch?v=rEJHzg2nW84'],
    ])
    const pop = page.getByRole('dialog', { name: '属性' })
    // 照小样 2a：没有附件时 320 宽，名字一列 64、行 30 高
    expect(Math.round(await width(pop))).toBe(320)
    expect(await pop.locator('.pr').first().evaluate((el) => Math.round(el.getBoundingClientRect().height))).toBe(30)
    await expect(pop.locator('.foot')).toHaveText('AI 认出来当场填好，你改了以你为准。存在文件开头；改属性不挪文件、不改名。')
    // 底下那句在「为准。」后面换行：两行，各一句（designer 复审）
    expect(await pop.locator('.foot span').evaluateAll((ss) => ss.map((s) => Math.round(s.getBoundingClientRect().height)))).toEqual([18, 18])
    // 值的框左右一样离弹层边 16（名字左边 16，框右边 16）
    const edges = await pop.evaluate((el) => {
      const p = el.getBoundingClientRect()
      const k = el.querySelector('.pr .k')!.getBoundingClientRect()
      const v = el.querySelector('.pr select')!.getBoundingClientRect()
      return [Math.round(k.left - p.left), Math.round(p.right - v.right)]
    })
    expect(edges).toEqual([16, 16])
    await shot(run, 'props-video')
    // 改频道：写回 channel 那一行，别的键不动
    const ch = pop.getByRole('textbox', { name: '频道' })
    await ch.fill('诺奖频道')
    await ch.press('Enter')
    await waitSaved(page)
    const after = read(vault, VIDEO)
    expect(after).toBe(VIDEO_TEXT.replace('channel: 我拿过诺奖', 'channel: 诺奖频道'))
    await closeProps(page)

    // 书摘：类型、作者、来源、划线、想法；书的编号藏着
    await openNote(page, '趣说明朝276年')
    await openProps(page)
    expect(await propRows(page)).toEqual([
      ['类型', '书摘'],
      ['作者', '关丁'],
      ['来源', 'https://weread.qq.com/web/reader/abc'],
      ['划线', '4'],
      ['想法', '1'],
    ])
    await closeProps(page)

    // 剪藏的网页：类型、来源、剪于
    await openNote(page, '最佳旅游季节')
    await openProps(page)
    expect(await propRows(page)).toEqual([
      ['类型', '剪藏'],
      ['来源', 'https://example.com/iceland/season'],
      ['剪于', '2026-11-20 16:08'],
    ])
    await closeProps(page)

    // 读 PDF 的笔记、课程笔记：类型、课程、第几讲、来源、日期
    await openNote(page, '第3讲 笔记')
    await openProps(page)
    expect(await propRows(page)).toEqual([
      ['类型', '笔记'],
      ['课程', 'ecp'],
      ['第几讲', '3'],
      ['来源', '[[第3讲.pdf]]'],
      ['日期', '2026-11-10'],
    ])
    await closeProps(page)

    // 带图的笔记：属性下面一组附件，弹层 340 宽；字照 DESIGN.v3 第 114 行
    await openNote(page, 'Lecture05 笔记')
    await openProps(page)
    expect((await propRows(page)).map((r) => r[0])).toEqual(['类型', '课程', '第几讲'])
    const sec = pop.getByRole('region', { name: '附件' })
    await expect(sec).toBeVisible()
    expect(Math.round(await width(pop))).toBe(340)
    await expect(sec.locator('.pa-hd')).toHaveText(/^附件2 张 · [\d.]+ (B|KB)$/)
    await expect(sec.locator('.pa-row .n')).toHaveText(['截图 1.png', '截图 2.png'])
    await expect(sec.locator('.pa-row .w')).toHaveText(['第 1 段', '为什么要先看符号'])
    expect(await sec.locator('.pa-row').first().evaluate((el) => Math.round(el.getBoundingClientRect().height))).toBe(44)
    await shot(run, 'props-attach')
    await closeProps(page)

    // 中间栏窄到 420（右边开着网页）：弹层整个在中间栏里，左边不被切掉（0.4.6 时「属性」两个字被切掉一半）
    await openWeb(page)
    await centerTo(run, 420)
    await openProps(page)
    await expect(sec).toBeVisible()
    const c = await center(page).evaluate((el) => el.getBoundingClientRect().toJSON())
    const p = await pop.evaluate((el) => el.getBoundingClientRect().toJSON())
    expect(p.left).toBeGreaterThanOrEqual(c.left + 7)
    expect(p.right).toBeLessThanOrEqual(c.right - 7)
    expect(Math.round(p.width)).toBe(340)
    await closeProps(page)
  } finally {
    await run.close()
  }
})

test('网页栏和中间栏的分隔线：真拖到超过 640（中间不小于 420）、拖回来跟手；双击到最宽、再双击回来；重开软件宽度还在', async () => {
  const run = await launch(files)
  const { page, vault } = run
  const root = dirname(vault)
  let app2: Awaited<ReturnType<typeof electron.launch>> | null = null
  try {
    await size(run, 1600)
    await page.waitForTimeout(250)
    await openNote(page, '2026-W47')
    await openWeb(page)
    const w0 = await width(webCol(page))
    // 真拖：按住分隔线往左拖 900
    const s = (await sash(page).boundingBox())!
    const y = s.y + 300
    await page.mouse.move(s.x + s.width / 2, y)
    await page.mouse.down()
    await page.mouse.move(s.x + s.width / 2 - 450, y, { steps: 8 })
    await page.mouse.move(s.x + s.width / 2 - 900, y, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(200)
    const wide = await width(webCol(page))
    const c = await width(center(page))
    expect(wide).toBeGreaterThan(640)
    expect(c).toBeGreaterThanOrEqual(420)
    expect(c).toBeLessThan(422)
    // 能到的最宽：窗口 1600 减去两条图标栏、左栏、中间 420 和缝
    const side = await page.locator('aside.side').evaluate((el) => el.getBoundingClientRect().width)
    expect(wide).toBeGreaterThan(1600 - 96 - side - 420 - 20)
    await shot(run, 'web-wide')

    // 拖回来一点：立刻跟手（不是先拖过一段死区）
    const s2 = (await sash(page).boundingBox())!
    await page.mouse.move(s2.x + s2.width / 2, y)
    await page.mouse.down()
    await page.mouse.move(s2.x + s2.width / 2 + 200, y, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(200)
    const back = await width(webCol(page))
    expect(Math.abs(back - (wide - 200))).toBeLessThan(3)

    // 双击：一下拉到最宽（中间 420），再双击回到刚才的宽
    await sash(page).dblclick()
    await page.waitForTimeout(200)
    expect(Math.abs((await width(center(page))) - 420)).toBeLessThan(2)
    await sash(page).dblclick()
    await page.waitForTimeout(200)
    expect(Math.abs((await width(webCol(page))) - back)).toBeLessThan(3)
    expect(w0).toBeLessThan(back)

    // 窗口变窄：中间照样不小于 420（网页栏让）
    await size(run, 1200)
    await page.waitForTimeout(300)
    expect(await width(center(page))).toBeGreaterThanOrEqual(420)
    await size(run, 1600)
    await page.waitForTimeout(500)

    // 重开软件：网页栏还是这么宽
    await run.app.close()
    app2 = await electron.launch({
      executablePath: electronPath as unknown as string,
      args: [join(__dirname, '../out/main/index.js')],
      env: { ...process.env, CN_VAULT: vault, CN_USER_DATA: join(root, 'user-data'), CN_E2E: '1', CN_NO_AX: '1', CN_QUICK_KEY: 'Alt+Command+Shift+F19', CN_TRASH_DIR: join(root, 'trash'), CN_ICLOUD_CONTAINER: join(root, 'icloud') },
    })
    const p2 = await app2.firstWindow()
    await app2.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1600, 900))
    await expect(webCol(p2)).toHaveCount(1)
    await expect.poll(async () => Math.round(await width(webCol(p2)))).toBe(Math.round(back))
  } finally {
    await app2?.close()
    rmSync(root, { recursive: true, force: true })
  }
})

// 交付截图（只在给了 CN_SHOTS 时跑）：天青、深湖各一组
for (const [skin, tag] of [
  ['sky', '浅'],
  ['petrol', '深'],
] as const)
  test(`截图 ${tag}色`, async () => {
    test.skip(!SHOTS, '只在截交付图时跑')
    const run = await launch(files, {}, settings({ skin }))
    const { page } = run
    try {
      await openNote(page, '为了使用Claude，中国地区用户都搞出了什么招')
      await openWeb(page)
      await centerTo(run, 420)
      await shot(run, `1-标题下一行-420-${tag}`)
      await openProps(page)
      await shot(run, `2a-属性-视频-${tag}`)
      await closeProps(page)
      await openNote(page, 'Lecture05 笔记')
      await openProps(page)
      await page.waitForTimeout(400)
      await shot(run, `2b-属性-附件-${tag}`)
      await closeProps(page)
      await openNote(page, '趣说明朝276年')
      await openProps(page)
      await shot(run, `2c-属性-书摘-${tag}`)
      await closeProps(page)
      await size(run, 1600)
      await page.waitForTimeout(300)
      await openNote(page, '为了使用Claude，中国地区用户都搞出了什么招')
      await sash(page).dblclick()
      await page.waitForTimeout(400)
      await shot(run, `3-网页栏拉到最宽-${tag}`)
    } finally {
      await run.close()
    }
  })
