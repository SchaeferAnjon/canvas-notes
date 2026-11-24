/**
 * 交付对照图（task-5yp97 照用户看图定的五件）：软件摆成和 /private/tmp/canvas-notes-visual 里那几张图同一个状态，整窗（1440×887，B 浮岛书桌）
 * 和要看的那一块各截一张。只在截交付图时跑：CN_SHOTS=目录，CN_SHOT_TONE=dark 截深湖（不给是天青）。平时跳过。
 */
import { expect, test, type Locator, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { dirname, join } from 'node:path'
import { acts, launch, openAi, openNote, pane, rail, tabOn, type Running } from './app'
import { board, col } from './fixtures/board-doc'
import { FAKE_VIDEO_ID, startFakeVideoSite } from './fixtures/fake-video'
import { LECTURE } from './fixtures/pdf'

const DIR = process.env.CN_SHOTS
const DARK = process.env.CN_SHOT_TONE === 'dark'
test.skip(!DIR, '只在截交付图时跑（CN_SHOTS=目录）')

const tone = DARK ? 'dark' : 'light'
const look = (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: DARK ? 'petrol' : 'sky', frame: 'b', winBg: 'aurora' } }))
}
const askbox = (page: Page) => page.getByRole('dialog', { name: '选中的这句' })
const sideIn = (scope: Locator) => scope.getByRole('region', { name: '旁支' })

/** 「在哪」标注图要的框：几个要看的东西在窗口里的位置（CSS 像素），和整窗图放在一起 */
async function marks(name: string, boxes: Record<string, Locator>) {
  const out: Record<string, { x: number; y: number; width: number; height: number } | null> = {}
  for (const [k, l] of Object.entries(boxes)) out[k] = await l.first().boundingBox()
  writeFileSync(join(DIR!, `app-${name}-${tone}.json`), JSON.stringify(out))
}

async function full(run: Running, name: string, keepMouse = false) {
  // 鼠标停在左栏和中间那道缝上：不碰到图标栏的悬停提示
  if (!keepMouse) await run.page.mouse.move(289, 600)
  await run.page.waitForTimeout(700)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(DIR!, `app-${name}-${tone}.png`), Buffer.from(b64, 'base64'))
}
/** 裁一块：用窗口自己的 capturePage（page.screenshot 截网页栏时会把 <webview> 那一层画到问框上面，裁出来看不到问框） */
async function crop(run: Running, name: string, clip: { x: number; y: number; width: number; height: number }) {
  await run.page.waitForTimeout(300)
  const c = { x: Math.max(0, Math.round(clip.x)), y: Math.max(0, Math.round(clip.y)), width: Math.round(clip.width), height: Math.round(clip.height) }
  const b64 = await run.app.evaluate(async ({ BrowserWindow }, r) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage(r)).toPNG().toString('base64'), c)
  writeFileSync(join(DIR!, `app-${name}-${tone}-crop.png`), Buffer.from(b64, 'base64'))
}
async function size(run: Running) {
  await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
  await expect.poll(() => run.page.evaluate(() => innerHeight)).toBe(887)
}
async function selectText(page: Page, scope: Locator, from: string, to: string) {
  const pts = await scope.evaluate(
    (root, [a, b]) => {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let s: [Node, number] | null = null
      let e: [Node, number] | null = null
      while (w.nextNode()) {
        const n = w.currentNode as Text
        if (!s && n.data.includes(a!)) s = [n, n.data.indexOf(a!)]
        if (s && n.data.includes(b!, s[0] === n ? s[1] : 0)) {
          e = [n, n.data.indexOf(b!, s[0] === n ? s[1] : 0) + b!.length]
          break
        }
      }
      const r = document.createRange()
      r.setStart(s![0], s![1])
      r.setEnd(e![0], e![1])
      const rs = r.getClientRects()
      const f = rs[0]!
      const l = rs[rs.length - 1]!
      return [f.left + 1, f.top + f.height / 2, l.right - 1, l.top + l.height / 2]
    },
    [from, to],
  )
  await page.mouse.move(pts[0]!, pts[1]!)
  await page.mouse.down()
  await page.mouse.move(pts[2]!, pts[3]!, { steps: 8 })
  await page.mouse.up()
}
/** 小框和它上面那句：一起截下来（同 askbox-*.png 右半边那一块） */
async function cropAskbox(run: Running, name: string) {
  const b = (await askbox(run.page).boundingBox())!
  const top = await run.page.evaluate(() => getSelection()!.getRangeAt(0).getBoundingClientRect().top)
  await crop(run, name, { x: b.x - 40, y: top - 34, width: b.width + 80, height: b.y + 90 - (top - 34) })
}

const DOC = '课程/ecp/第5讲 注意力机制.md'
const DOC_TEXT = [
  '# 第5讲 注意力机制',
  '',
  '## 讲解',
  '',
  '这一讲从「一句话里每个词该看谁」讲起，引出 Q、K、V 三样东西。',
  '',
  '> [!ai] AI 讲解 · Claude Code · Opus 5.5 · 看了 00:06 这一帧',
  '> 这一帧在讲缩放点积注意力：先拿 Q 和每个 K 做点积。分数要先除以 √d，再过 softmax 变成权重。',
  '>',
  '> 最后用这些权重把 V 加起来，就是这个位置的输出。维度 d 越大，不缩放时点积越大，softmax 会几乎只剩一个 1。',
  '',
  '我的理解：缩放是为了让分数别太极端。',
  '',
].join('\n')

test('1 选句小框离高亮 8：读 PDF、AI 对话、文档、白板', async () => {
  test.setTimeout(150_000)
  const run = await launch({ '课程/线代/第3讲.pdf': LECTURE, '周记/2026-W47.md': '# 2026-W47\n\n周一：第5讲的作业开了个头。\n\n周三：早上开始跑步，5 公里。\n', [DOC]: DOC_TEXT }, { CN_AI_FAKE: '1' }, look)
  const { page } = run
  try {
    await size(run)
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
    await page.locator('.pal-row', { hasText: '第3讲' }).first().click()
    await expect(tabOn(page)).toHaveText('第3讲.pdf')
    await expect(page.locator('.pdfpane:not([hidden]) .pdfpage[data-page="1"] canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
    await page.keyboard.press('Meta+j')
    const reading = page.getByRole('complementary', { name: '边读边问 AI' })
    const p2 = page.locator('.pdfpane:not([hidden]) .pdfpage[data-page="2"]')
    await p2.scrollIntoViewIfNeeded()
    const r = (await p2.boundingBox())!
    await page.mouse.move(r.x + r.width * 0.08, r.y + r.height * 0.2)
    await page.mouse.down()
    await page.mouse.move(r.x + r.width * 0.6, r.y + r.height * 0.4, { steps: 6 })
    await page.mouse.up()
    await expect(reading.getByTestId('reading-att').locator('img')).toBeVisible()
    await reading.getByRole('textbox', { name: '问 AI' }).press('Enter')
    const rmsg = reading.getByTestId('reading-msg').last()
    await expect(rmsg.getByTestId('ai-noted')).toHaveAttribute('data-state', 'done', { timeout: 20_000 })
    await selectText(page, rmsg.locator('.txt'), '列就是', '去哪')
    await expect(askbox(page)).toBeVisible()
    await full(run, 'askbox-pdf', true)
    await cropAskbox(run, 'askbox-pdf')
    await page.keyboard.press('Escape')

    await openNote(page, '2026-W47')
    await openAi(page)
    const chat = page.getByRole('complementary', { name: 'AI 对话' })
    await chat.getByRole('textbox', { name: '问 AI' }).fill('把这周的周记总结成三句话')
    await chat.getByRole('textbox', { name: '问 AI' }).press('Enter')
    const cmsg = chat.getByTestId('ai-msg').last()
    await expect(cmsg.locator('.txt')).toContainText('周三开始每天早上跑步', { timeout: 15_000 })
    await expect(chat.getByRole('button', { name: '发送' })).toBeVisible()
    await selectText(page, cmsg.locator('.txt'), '周三开始', '下来了。')
    await expect(askbox(page)).toBeVisible()
    await full(run, 'askbox-chat', true)
    await cropAskbox(run, 'askbox-chat')
    await page.keyboard.press('Escape')

    await openNote(page, '第5讲 注意力机制')
    await selectText(page, pane(page).locator('.cm-content'), '最后用这些', '的输出。')
    await expect(askbox(page)).toBeVisible()
    await full(run, 'askbox-doc', true)
    await cropAskbox(run, 'askbox-doc')
    await page.keyboard.press('Escape')

    await acts(page).getByRole('tab', { name: '白板' }).click()
    const card = col(page, '讲解').locator('.db-card[aria-label="AI 讲解"]')
    await selectText(page, card.locator('.side-text'), '分数要先', '变成权重。')
    await expect(askbox(page)).toBeVisible()
    await full(run, 'askbox-board', true)
    await marks('askbox-board', { '小框': askbox(page), '那张卡': card })
    await cropAskbox(run, 'askbox-board')
  } finally {
    await run.close()
  }
})

let server: Server
let base: string
test.beforeAll(async () => {
  if (DIR) ({ server, base } = await startFakeVideoSite())
})
test.afterAll(() => server?.close())
const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const guest = (page: Page, code: string): Promise<unknown> =>
  page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code)

test('2 问框里旁支输入框钉在问框底部', async () => {
  test.setTimeout(150_000)
  const NOTE = '看视频的笔记.md'
  const run = await launch({ [NOTE]: '# 看视频的笔记\n\n我先写的一句。\n' }, { CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '60', CN_AI_FAKE_ASK_MS: '300', CN_VIDEO_TEST_ORIGIN: base }, look)
  const { page } = run
  try {
    await size(run)
    await openNote(page, '看视频的笔记')
    await pane(page).getByText('我先写的一句。').click()
    await page.keyboard.press('End')
    await rail(page).getByRole('button', { name: '网页', exact: true }).click()
    const addr = web(page).getByRole('textbox', { name: '网址' })
    await addr.fill(`${base}/watch?v=${FAKE_VIDEO_ID}`)
    await addr.press('Enter')
    await expect(web(page).getByRole('region', { name: '视频条' })).toBeVisible({ timeout: 15_000 })
    await guest(page, `(() => { const v = document.querySelector('video'); v.currentTime = 6; v.pause(); return true })()`)
    await page.waitForTimeout(400)
    await pane(page).getByText('我先写的一句。').click()
    await page.keyboard.press('Alt+KeyD')
    await expect.poll(() => guest(page, `!!document.getElementById('cn-video-host').shadowRoot.querySelector('.box')`)).toBe(true)
    const wv = (await web(page).locator('webview.on').boundingBox())!
    await page.mouse.move(wv.x + 40, wv.y + 30)
    await page.mouse.down()
    await page.mouse.move(wv.x + 200, wv.y + 120, { steps: 6 })
    await page.mouse.up()
    const ask = web(page).getByRole('dialog', { name: '问 AI' })
    await ask.getByRole('textbox', { name: '想问什么' }).fill('讲解这一块')
    await ask.getByRole('textbox', { name: '想问什么' }).press('Enter')
    const ans = ask.getByTestId('ak-answer').first()
    await expect(ask.getByRole('button', { name: /已记进/ })).toBeVisible({ timeout: 15_000 })
    await selectText(page, ans, '任何向量', '的组合，')
    await askbox(page).getByRole('textbox', { name: '问这句' }).fill('为什么是组合？')
    await askbox(page).getByRole('textbox', { name: '问这句' }).press('Enter')
    const s = sideIn(ask)
    await expect(s.locator('.acts')).toBeVisible({ timeout: 15_000 })
    await page.mouse.move(289, 600)
    await page.waitForTimeout(500)
    await full(run, 'askcard-pin')
    await marks('askcard-pin', { '钉在底部': ask.getByTestId('ak-side-dock'), '问框': ask })
    const b = (await ask.boundingBox())!
    const w = (await web(page).boundingBox())!
    await crop(run, 'askcard-pin', { x: w.x, y: w.y, width: w.width, height: b.y + b.height + 40 - w.y })
  } finally {
    await run.close()
  }
})

const SUMMARY = '这块白板讲了注意力的三步：先拿 Q 和每个 K 做点积得到分数，分数除以 √d 再过 softmax 变成权重，最后用权重把 V 加起来。多头注意力是把 Q、K、V 切成几份各算各的，再拼回来。'
const BOARD = '---\ntype: board\n---\n# 第5讲 注意力机制\n\n<!-- card id=s1 ai=2026-11-21 -->\n> [!ai] AI 总结 · Claude Code · Opus 5.5\n> ' + SUMMARY + '\n\n## 讲解\n\n先拿 Q 和每个 K 做点积，得到「该看谁」的分数。\n\n最后用这些权重把 V 加起来，就是这个位置的输出。\n\n## 多头注意力\n\n把 Q、K、V 各切成几份，各算各的，再拼回来。\n\n## 还没想通\n\n为什么偏偏是根号 d？\n'

test('3 「AI 总结的」卡写成 AI 总结块：白板上开旁支、切到文档', async () => {
  test.setTimeout(150_000)
  const run = await launch({ '课程/ecp/第5讲 注意力机制.md': BOARD }, { CN_AI_FAKE: '1' }, look)
  const { page } = run
  try {
    await size(run)
    await openNote(page, '第5讲 注意力机制')
    if ((await acts(page).getByRole('tab', { name: '白板' }).getAttribute('aria-selected')) !== 'true') await acts(page).getByRole('tab', { name: '白板' }).click()
    const card = board(page).locator('.db-card[aria-label="AI 总结"]')
    await selectText(page, card.locator('.side-text'), '分数除以', '变成权重，')
    await askbox(page).getByRole('textbox', { name: '问这句' }).fill('为什么要除以 √d？')
    await askbox(page).getByRole('textbox', { name: '问这句' }).press('Enter')
    await expect(sideIn(card).locator('.acts')).toBeVisible({ timeout: 15_000 })
    const bb = (await board(page).boundingBox())!
    await page.mouse.click(bb.x + bb.width - 40, bb.y + bb.height - 40)
    await expect(sideIn(card)).toBeVisible()
    await page.mouse.move(289, 600)
    await full(run, 'summary-board')
    await marks('summary-board', { '总结卡': card, '旁支': sideIn(card) })
    const cb = (await card.boundingBox())!
    await crop(run, 'summary-board', { x: cb.x - 24, y: cb.y - 24, width: Math.min(700, cb.width + 420), height: cb.height + 48 })
    await page.keyboard.press('Escape')
    await acts(page).getByRole('tab', { name: '文档' }).click()
    const content = pane(page).locator('.cm-content')
    await content.locator('.badge').click()
    await expect(sideIn(pane(page)).locator('.acts')).toBeVisible()
    await page.mouse.move(289, 600)
    await full(run, 'summary-doc')
    const pb = (await pane(page).boundingBox())!
    await crop(run, 'summary-doc', { x: pb.x, y: pb.y, width: pb.width, height: Math.min(620, pb.height) })
  } finally {
    await run.close()
  }
})

/** 2-30天 图里那六篇：今天、昨天、周四、11月18日、11月10日、11月3日删的 */
function trashHistory(vault: string) {
  const g = (args: string[], at?: Date) =>
    execFileSync('git', ['-C', vault, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
      env: { ...process.env, ...(at ? { GIT_AUTHOR_DATE: at.toISOString(), GIT_COMMITTER_DATE: at.toISOString() } : {}) },
    })
  const put = (p: string, t: string) => {
    mkdirSync(dirname(join(vault, p)), { recursive: true })
    writeFileSync(join(vault, p), t)
  }
  const now = new Date()
  const day = (back: number, h: number, m: number) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, h, m)
    return d
  }
  const thursday = (now.getDay() + 7 - 4) % 7 || 7
  const files: [string, string, Date][] = [
    ['模板/读书笔记模板.md', '# 读书笔记模板\n\n书名：\n', new Date(now.getFullYear(), 10, 3, 10, 0)],
    ['剪藏/未命名白板/未命名白板.md', '---\ntype: board\ncolor: "#8A6AA8"\n---\n# 未命名白板\n', new Date(now.getFullYear(), 10, 10, 10, 0)],
    ['项目/冰岛自驾/冰岛行程 第一版.md', '---\ntype: board\ncolor: "#C9853A"\n---\n# 冰岛行程 第一版\n', new Date(now.getFullYear(), 10, 18, 10, 0)],
    ['写作/旧的读书计划.md', '# 旧的读书计划\n\n今年想读完的书：\n\n1. 《巴菲特传》，每周两章，周日写一段读后感。\n2. 《杀死一只知更鸟》，配着电影一起看。\n3. 《人类简史》，先看第一部分「认知革命」。\n\n（后来改成在「阅读」里一本一篇书摘，这篇就删了。）\n', day(thursday, 21, 5)],
    ['课程/ecp/Lecture00.pdf', LECTURE.toString('latin1'), day(1, 15, 30)],
    ['收件箱/草稿 2.md', '# 草稿 2\n\n还没想好写什么。\n', day(0, 0, 12)],
  ]
  for (const [p, t] of files) p.endsWith('.pdf') ? writeFileSync(join(vault, p), LECTURE) : put(p, t)
  g(['add', ...files.map((f) => f[0])])
  g(['commit', '-q', '-m', '建好'], new Date(now.getFullYear(), 9, 1))
  for (const [p, , at] of files) {
    g(['rm', '-q', p])
    g(['commit', '-q', '-m', `删除 ${p}`], at)
  }
}

test('4 最近删掉的：图标栏底部一格（task-iq2ow 从树最底下挪上来）、左栏列表、指着一行、点一条看删掉前的样子', async () => {
  test.setTimeout(150_000)
  const run = await launch(
    {
      '收件箱/一个 App 的点子.md': '# 一个 App 的点子\n',
      '收件箱/周三组会要问的.md': '# 周三组会要问的\n',
      '课程/ecp/第5讲.md': '# 第5讲\n',
      '课程/study project/学习笔记.md': '# 学习笔记\n',
      '阅读/趣说明朝.md': '# 趣说明朝\n',
      '写作/日记.md': '# 日记\n',
      '项目/冰岛自驾/预算.md': '# 预算\n',
      '生活/体检.md': '# 体检\n',
      '周记/2026-W47.md': '# 2026-W47\n',
      '剪藏/冰岛旅行/第三方.md': '# 第三方\n',
      '旧笔记导入/a.md': '# a\n',
    },
    {},
    (v) => (look(v), trashHistory(v)),
  )
  const { page } = run
  try {
    await size(run)
    const row = page.getByRole('navigation', { name: '左栏' }).getByTestId('ab-trash')
    await expect(row.getByTestId('trash-count')).toHaveText('6')
    await row.click()
    const list = page.getByTestId('trash-panel').getByRole('list', { name: '最近删掉的' }).getByRole('listitem')
    await expect(list).toHaveCount(6)
    await list.nth(2).click()
    await expect(page.getByTestId('trash-page').getByRole('region', { name: '删掉前的样子' })).toContainText('巴菲特传')
    await list.nth(0).hover()
    await full(run, 'trash', true)
    await marks('trash', { '图标栏底部': row, '列表': page.getByTestId('trash-panel'), '删掉前的样子': page.getByTestId('trash-page').locator('.tr-prev') })
  } finally {
    await run.close()
  }
})

const DBYAML = (folder: string) => '```base\nfilters:\n  and:\n    - file.inFolder("' + folder + '")\nviews:\n  - type: table\n    name: 表格\n    order:\n      - file.name\n```'

test('5 数据库的记录文件夹挂在那篇下面', async () => {
  test.setTimeout(150_000)
  const run = await launch(
    {
      '课程/study project/学习笔记：动手学深度学习.md': `# 学习笔记：动手学深度学习\n\n2.1 数据操作。\n\n${DBYAML('课程/study project/未命名数据库')}\n`,
      '课程/study project/未命名数据库/第一条.md': '---\n状态: 在读\n---\n',
      '课程/study project/未命名数据库/第二条.md': '---\n状态: 读完\n---\n',
      '课程/study project/未命名数据库/第三条.md': '---\n状态: 没读\n---\n',
      '课程/study project/小论文计划.md': '---\ntype: board\ncolor: "#5d8fb0"\n---\n# 小论文计划\n',
      '课程/ecp/第5讲.md': '# 第5讲\n',
      '课程/study project 2/a.md': '# a\n',
      '剪藏/冰岛旅行/第三方.md': `---\ntype: board\ncolor: "#5E9A6B"\n---\n# 第三方\n\n${DBYAML('剪藏/冰岛旅行/未命名数据库')}\n`,
      '剪藏/冰岛旅行/未命名数据库/一条.md': '---\n状态: 待订\n---\n',
      '剪藏/冰岛旅行/一、最佳旅游季节.md': '# 一、最佳旅游季节\n',
      '收件箱/一个 App 的点子.md': '# 一个 App 的点子\n',
    },
    {},
    look,
  )
  const { page } = run
  try {
    await size(run)
    await page.getByRole('navigation', { name: '左栏' }).getByRole('button', { name: '文件', exact: true }).click()
    const tree = page.getByRole('tree', { name: '全部文件' })
    for (const [p, n] of [['课程', '课程'], ['课程/study project', 'study project'], ['剪藏', '剪藏'], ['剪藏/冰岛旅行', '冰岛旅行']]) {
      const r = tree.locator(`[role="treeitem"][data-path="${p}"]`)
      await expect(r).toBeVisible()
      if ((await r.getAttribute('aria-expanded')) !== 'true') await r.getByRole('button', { name: `展开 ${n}`, exact: true }).click()
    }
    await tree.getByRole('button', { name: '展开 学习笔记：动手学深度学习 的数据库' }).click()
    await tree.getByRole('button', { name: '展开 第三方 的数据库' }).click()
    await expect(tree.locator('[data-path="课程/study project/未命名数据库"] .ft-count')).toHaveText('3条')
    await full(run, 'dbtree')
    await marks('dbtree', { '挂在那篇下面': tree.locator('[data-path="课程/study project/学习笔记：动手学深度学习.md"]'), '记录文件夹': tree.locator('[data-path="课程/study project/未命名数据库"]') })
    const side = (await page.locator('aside.side').boundingBox())!
    await crop(run, 'dbtree', { x: side.x, y: side.y, width: side.width, height: Math.min(640, side.height) })
  } finally {
    await run.close()
  }
})
