// AI 命令（task-9womr，方向 C 第二版，小样 canvas-notes-commands/v2/proto-c2.html）：
// 1. / 菜单把这里能用的全列出来，「我的命令 / 这一篇 / 整个库」，列表定死 392 高能滚，打字筛的时候高度不变；
// 2. 12 条新加的自带命令每条都真能跑（假 AI），写到它说的地方、只改它说会改的，一次提交「AI：/命令 · 对象」，回答下面能撤回；
// 3. 自己存的命令（命令.json 里 kind: ai）：在 / 菜单最上面、在这里用不了时写一行灰字；跑的时候先给你看（摆在中间），收下才写，一次提交，能撤回；
//    空对话输入框上面那排小按钮在一道竖线后面列它，点了就跑；
// 4. / 命令跟着输入框底行选的那一家、模型、想多久（task-0fhyo）。
// 都是在 AI 输入框里真打 /、真按 ↑↓ 回车、真点按钮。
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type { Server } from 'node:http'
import { join } from 'node:path'
import { launch, openAi, pane, rail, tabOn } from './app'
import { DOC as DIGEST, PATH as DIGEST_PATH } from './fixtures/book-digest'
import { FAKE_VIDEO_ID, startFakeVideoSite } from './fixtures/fake-video'
import { solidPng } from './fixtures/png'
import { LECTURE as PDF_BYTES } from './fixtures/pdf'

const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const box = (page: Page) => chat(page).getByRole('textbox', { name: '问 AI' })
const menu = (page: Page) => page.getByTestId('slash-menu')
const subjects = (vault: string, n: number) => execFileSync('git', ['-C', vault, 'log', `-${n}`, '--format=%s'], { encoding: 'utf8' }).trim().split('\n')
const read = (vault: string, f: string) => readFileSync(join(vault, f), 'utf8')
const lastMsg = (page: Page) => chat(page).getByTestId('ai-msg').last()
/** 说明以 prefix 开头的最近一次提交：说明和改了哪些文件（视频页同时还会自己存字幕全文，不一定是最新那次） */
function commitOf(vault: string, prefix: string): string[] {
  const log = execFileSync('git', ['-C', vault, '-c', 'core.quotePath=false', 'log', '--format=@@%s', '--name-only'], { encoding: 'utf8' })
  const part = log.split('@@').find((x) => x.startsWith(prefix))
  return part ? part.split('\n').filter(Boolean) : []
}

const LECTURE = `# 第2讲 预备知识

## 张量

张量就是多维数组，矩阵是两个轴的张量。

![](../附件/截图 1.png)

—— 出处：动手学深度学习

## 广播

形状不同时自动扩展。

![](../附件/截图%202.png)
`

const BOARD = '---\ntype: board\n---\n## 想法\n\n订机票\n\n看极光\n\n## 杂\n\n写游记\n\n买雪地靴\n'

const FILES = {
  '课程/第2讲 预备知识.md': LECTURE,
  '课程/张量.md': '# 张量\n\n多维数组。\n',
  '课程/矩阵.md': '# 矩阵\n\n两个轴的张量。\n',
  '计划/冰岛.md': BOARD,
  '附件/截图 1.png': solidPng(40, 30, [200, 30, 30]),
  '附件/截图 2.png': solidPng(40, 30, [30, 200, 30]),
  [DIGEST_PATH]: DIGEST,
}

/** 命令.json 里存好的一条自己的命令（「存成命令」那张表存下的样子） */
const MINE = {
  version: 1,
  own: [
    {
      id: 'own-tidy',
      name: '整理成通顺笔记',
      kind: 'ai',
      target: '1. 同一个出处只写一次\n2. 问答保留原样',
      rules: [{ t: '同一个出处只写一次', e: '「—— 出处」从 6 行变成 3 处节头' }, { t: '问答保留原样', e: '3 组问答一字没改' }],
      where: ['doc'],
      write: 'inplace',
      desc: '照「学习笔记」4 轮前后的对比提炼，每次先给你看',
      from: { path: '课程/学习笔记.md', title: '学习笔记', rounds: 4, place: 'file:课程/学习笔记.md' },
    },
  ],
}

/** ⌘K 里按名字打开一篇 */
async function openByName(page: Page, name: string) {
  await page.keyboard.press('Meta+k')
  await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill(name)
  await page.locator('.pal-row', { has: page.locator('.nm', { hasText: new RegExp(`^${name}$`) }) }).first().click()
  await expect(tabOn(page)).toHaveText(name)
}

/** 输入框里真打 /几个字，菜单里点名字对上的那一条 */
async function slash(page: Page, typed: string, name: string) {
  await box(page).click()
  await box(page).fill('')
  await page.keyboard.type('/' + typed)
  await expect(menu(page)).toBeVisible()
  await menu(page).locator(`.it:has(.n:text-is("${name}"))`).first().click()
}

const groupTitles = (page: Page) => menu(page).locator('.g:not(.hid)').allTextContents()
const listBox = (page: Page) => menu(page).locator('.sl-list')

test('/ 菜单：文档里三组列全，列表定死 392 高能滚，打字筛的时候高度不变；写这周的周记先给你看，收下才写，一次提交，能撤回', async () => {
  test.setTimeout(120_000)
  const run = await launch(FILES, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await openByName(page, '第2讲 预备知识')
    await openAi(page)
    await box(page).click()
    await page.keyboard.type('/')
    await expect(menu(page)).toBeVisible()
    expect(await groupTitles(page)).toEqual(['我的命令', '这一篇', '整个库'])
    await expect(menu(page).locator('.ph').first()).toHaveText('调出满意的样子后点「存成命令」，就会在这里')
    await expect(page.getByTestId('slash-count')).toHaveText('这里能用 11 条')
    expect(await menu(page).locator('.it .n').allTextContents()).toEqual(['截图转成文字', '补双链', '出几道自测题', '拆成白板卡片', '总结这块白板', '翻译', '写这周的周记', '整理收件箱', '剪藏这一页', '找重复', '现在梦游'])
    const h = () => listBox(page).evaluate((e) => Math.round(e.getBoundingClientRect().height))
    expect(await h()).toBe(392)
    // 每条两行，44 高；改是黄底、新建是绿底、只回答是灰底
    expect(await menu(page).locator('.it').first().evaluate((e) => e.getBoundingClientRect().height)).toBe(44)
    await expect(menu(page).locator('.it:has(.n:text-is("截图转成文字")) .tg span').first()).toHaveClass('w')
    await expect(menu(page).locator('.it:has(.n:text-is("拆成白板卡片")) .tg span').first()).toHaveClass('nw')
    await expect(menu(page).locator('.it:has(.n:text-is("翻译")) .tg span').first()).toHaveClass('')
    // ↓ 九次：选中跟着走、列表滚下去，高度不变
    for (let i = 0; i < 9; i++) await page.keyboard.press('ArrowDown')
    await expect(menu(page).locator('.it.on .n')).toHaveText('找重复')
    expect(await listBox(page).evaluate((e) => e.scrollTop)).toBeGreaterThan(0)
    expect(await h()).toBe(392)
    // 打字筛：剩一条、写「筛出 1 条」，高度还是 392
    await page.keyboard.type('周')
    await expect(page.getByTestId('slash-count')).toHaveText('筛出 1 条')
    expect(await groupTitles(page)).toEqual(['整个库'])
    expect(await h()).toBe(392)
    // 筛剩一条时列表照样整宽、靠左（不被全局 .list 收窄居中），也不画滚动条
    const geo = await menu(page).evaluate((m) => {
      const l = m.querySelector('.sl-list') as HTMLElement
      const it = m.querySelector('.it') as HTMLElement
      return { menuW: Math.round(m.getBoundingClientRect().width), listW: Math.round(l.getBoundingClientRect().width), gap: Math.round(it.getBoundingClientRect().left - l.getBoundingClientRect().left), bar: l.offsetWidth - l.clientWidth }
    })
    expect(geo).toEqual({ menuW: geo.listW, listW: geo.listW, gap: 6, bar: 0 })
    // 回车跑写这周的周记：先给你看（中间开对比标签），收下才写
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('proposal-bar')).toBeVisible({ timeout: 15_000 })
    await expect(tabOn(page)).toContainText('周记 · /写这周的周记 改的')
    const msg = lastMsg(page)
    await expect(msg).toContainText('改好了，摆在中间先给你看：收下才写进去。')
    expect(existsSync(join(vault, '周记'))).toBe(false)
    await page.getByTestId('proposal-bar').getByRole('button', { name: '收下' }).click()
    await expect(page.getByTestId('proposal-bar')).toHaveCount(0)
    await expect(msg.getByTestId('ai-change')).toContainText('改了1个文件')
    const week = subjects(vault, 1)[0]!
    expect(week).toMatch(/^AI：\/写这周的周记 · \d{4}-W\d{2}$/)
    const path = `周记/${week.split(' · ')[1]} 周记.md`
    expect(read(vault, path)).toMatch(/^---\n类型: 周记\n日期: \d{4}-\d{2}-\d{2}\n---\n# \d{4}-W\d{2} 周记\n\n## 这周做了什么/)
    await expect(msg.getByTestId('ai-change')).toContainText('改了1个文件')
    await msg.getByTestId('ai-change').getByRole('button', { name: '撤回' }).click()
    await expect(msg.getByTestId('ai-change')).toContainText('已撤回')
    expect(existsSync(join(vault, path))).toBe(false)
    // esc 关掉菜单、清掉 /
    await box(page).click()
    await page.keyboard.type('/')
    await expect(menu(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu(page)).toHaveCount(0)
    await expect(box(page)).toHaveValue('')
  } finally {
    await run.close()
  }
})

test('文档、书摘、白板上的新命令：截图转成文字只在图下加字、补双链只加链接、自测题只接在末尾、拆成白板新建一块放旁边、书摘分节只挪顺序、排成计划只挪卡加列、拆成待办只加一张卡；都是一次提交、能撤回', async () => {
  test.setTimeout(180_000)
  const run = await launch(FILES, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await openByName(page, '第2讲 预备知识')
    await openAi(page)
    const lec = '课程/第2讲 预备知识.md'

    // 截图转成文字：两张图下面各插一段，原文一行不少
    await slash(page, '截图', '截图转成文字')
    await expect(lastMsg(page).getByTestId('ai-change')).toBeVisible({ timeout: 15_000 })
    await expect(lastMsg(page)).toContainText('把2张图里的字写在了图下面，原图留着。')
    expect(subjects(vault, 1)).toEqual(['AI：/截图转成文字 · 第2讲 预备知识'])
    const ocr = read(vault, lec)
    expect(ocr).toContain('![](../附件/截图 1.png)\n\n| 写法 | 意思 |')
    expect(ocr).toContain('![](../附件/截图%202.png)\n\n图2里的字：测试文字2')
    for (const line of LECTURE.split('\n')) expect(ocr.split('\n')).toContain(line)
    // 撤回：文件回到原样
    await lastMsg(page).getByTestId('ai-change').getByRole('button', { name: '撤回' }).click()
    await expect(lastMsg(page).getByTestId('ai-change')).toContainText('已撤回')
    await expect.poll(() => read(vault, lec)).toBe(LECTURE)

    // 补双链：只把「张量」「矩阵」包成 [[…]]，别的字不动
    await slash(page, '补双', '补双链')
    await expect(lastMsg(page).getByTestId('ai-change')).toBeVisible({ timeout: 15_000 })
    const linked = read(vault, lec)
    expect(linked).toContain('[[张量]]就是多维数组，[[矩阵]]是两个轴的张量。')
    expect(linked.replace(/\[\[([^\]]+)\]\]/g, '$1')).toBe(LECTURE)
    expect(subjects(vault, 1)).toEqual(['AI：/补双链 · 第2讲 预备知识'])

    // 出几道自测题：末尾一节，5 道，答案折着
    await slash(page, '自测', '出几道自测题')
    await expect(lastMsg(page).getByTestId('ai-change')).toBeVisible({ timeout: 15_000 })
    const quiz = read(vault, lec)
    expect(quiz.startsWith(linked.replace(/\s+$/, '') + '\n\n## 自测题\n\n1. ')).toBe(true)
    expect(quiz.match(/<details><summary>答案<\/summary>/g)).toHaveLength(5)

    // 拆成白板卡片：旁边新建一块白板（按小标题分列），原文不动
    const beforeSplit = read(vault, lec)
    await slash(page, '拆成', '拆成白板卡片')
    await expect(lastMsg(page).getByRole('button', { name: '打开' })).toBeVisible({ timeout: 15_000 })
    const board = read(vault, '课程/第2讲 预备知识：白板.md')
    expect(board).toMatch(/^---\ntype: board\nfrom: "\[\[第2讲 预备知识\]\]"\n---\n## 张量\n\n/)
    expect(board).toContain('## 广播')
    expect(read(vault, lec)).toBe(beforeSplit)
    expect(subjects(vault, 1)).toEqual(['AI：/拆成白板卡片 · 第2讲 预备知识'])

    // 书摘按主题分节：划线、想法、评价一字不改，只挪顺序、加小标题
    await openByName(page, '趣说明朝276年（微信读书出品）')
    await box(page).click()
    await page.keyboard.type('/')
    expect(await groupTitles(page)).toEqual(['我的命令', '这本书的书摘', '整个库'])
    await slash(page, '书摘', '书摘按主题分节')
    await expect(lastMsg(page).getByTestId('ai-change')).toBeVisible({ timeout: 15_000 })
    const themed = read(vault, DIGEST_PATH)
    expect(themed).toContain('## 测试主题一')
    expect(themed).toContain('## 测试主题二')
    for (const q of DIGEST.split('\n').filter((l) => /^>|想法：|评价：/.test(l))) expect(themed).toContain(q)
    expect(themed).not.toContain('## 3 作死小能手朱高煦')

    // 白板排成计划：加「这周」「下周」「以后」三列，卡一张不少
    await openByName(page, '冰岛')
    await box(page).click()
    await page.keyboard.type('/')
    expect(await groupTitles(page)).toEqual(['我的命令', '这块白板', '整个库'])
    await expect(page.getByTestId('slash-count')).toHaveText('这里能用 12 条')
    await slash(page, '排成', '白板排成计划')
    await expect(lastMsg(page).getByTestId('ai-change')).toBeVisible({ timeout: 15_000 })
    const plan = read(vault, '计划/冰岛.md')
    expect(plan).toMatch(/## 这周\n\n\*\*待办\*\*\n- \[ \] 订机票\n\n\*\*待办\*\*\n- \[ \] 买雪地靴\n\n## 下周\n\n看极光\n\n## 以后\n\n\*\*待办\*\*\n- \[ \] 写游记\n\n## 想法/)
    expect(subjects(vault, 1)).toEqual(['AI：/白板排成计划 · 冰岛'])

    // 计划拆成待办：先选中一张卡，拆好的一张待办卡接在它后面
    await expect(pane(page).locator('.db-card', { hasText: '看极光' })).toBeVisible()
    await pane(page).locator('.db-card', { hasText: '看极光' }).first().click()
    await slash(page, '拆成待', '计划拆成待办')
    await expect(lastMsg(page).getByTestId('ai-change')).toBeVisible({ timeout: 15_000 })
    expect(read(vault, '计划/冰岛.md')).toContain('看极光\n\n**待办**\n- [ ] 查一下看极光要准备什么\n- [ ] 列出看极光的花费\n- [ ] 把看极光定下来\n')
  } finally {
    await run.close()
  }
})

test('视频：要点带时间、字幕整理成一篇新建进收件箱，每条能点回那一秒；自己的命令在视频里写一行「在这里用不了」', async () => {
  test.setTimeout(120_000)
  const { server, base } = await startFakeVideoSite()
  const run = await launch({ ...FILES, '.canvas-notes/命令.json': JSON.stringify(MINE) }, { CN_AI_FAKE: '1', CN_VIDEO_TEST_ORIGIN: base })
  const { page, vault } = run
  try {
    await rail(page).getByRole('button', { name: '网页' }).click()
    const web = page.getByRole('complementary', { name: '网页' })
    const addr = web.getByRole('textbox', { name: '网址' })
    await addr.fill(`${base}/watch?v=${FAKE_VIDEO_ID}`)
    await addr.press('Enter')
    await expect(web.getByRole('region', { name: '视频条' })).toBeVisible({ timeout: 15_000 })
    // 字幕真拿到了（视频条上写出是哪一条），再打 /：不然命令会照实说「还没拿到字幕」
    await expect(web.getByRole('region', { name: '视频条' }).getByRole('button', { name: '字幕' })).toContainText('字幕 英', { timeout: 15_000 })
    // 右栏开着视频时 AI 那一格是边读边问的那一格（和读 PDF 同一个），/ 菜单照样在
    await openAi(page)
    const rchat = page.getByRole('complementary', { name: '边读边问 AI' })
    const rbox = rchat.getByRole('textbox', { name: '问 AI' })
    const rlast = () => rchat.getByTestId('reading-msg').last()
    await rbox.click()
    await page.keyboard.type('/')
    expect(await groupTitles(page)).toEqual(['我的命令', '这个视频', '整个库'])
    await expect(menu(page).locator('.ph').first()).toHaveText('「整理成通顺笔记」在这里用不了：它只选了文档')
    await expect(page.getByTestId('slash-count')).toHaveText('这里能用 8 条')
    await page.keyboard.type('视频')
    await menu(page).locator('.it:has(.n:text-is("视频要点带时间"))').click()
    await expect(rlast().getByTestId('ai-change')).toBeVisible({ timeout: 30_000 })
    await expect(rlast()).toContainText('写了')
    const note = commitOf(vault, 'AI：/视频要点带时间')
    expect(note[0]).toMatch(/^AI：\/视频要点带时间 · /)
    expect(note[1]).toMatch(/^收件箱\/.+ 要点\.md$/)
    expect(read(vault, note[1]!)).toMatch(/^---\n来源: .+watch\?v=fakevid0001\n---\n# .+ 要点\n\n- \[00:00\]\(.+watch\?v=fakevid0001&t=0s\) 测试要点1/)
    await rbox.click()
    await page.keyboard.type('/字幕')
    await menu(page).locator('.it:has(.n:text-is("字幕整理成一篇"))').click()
    await expect(rlast().getByTestId('ai-change')).toBeVisible({ timeout: 30_000 })
    const text = commitOf(vault, 'AI：/字幕整理成一篇')
    expect(text[0]).toMatch(/^AI：\/字幕整理成一篇 · /)
    expect(read(vault, text[1]!)).toMatch(/### \[00:00\]\(.+&t=0s\)\n\n/)
    // 撤回：新建的那篇没了
    await rlast().getByTestId('ai-change').getByRole('button', { name: '撤回' }).click()
    await expect(rlast().getByTestId('ai-change')).toContainText('已撤回')
    expect(existsSync(join(vault, text[1]!))).toBe(false)
    // 整个库的命令：换到收件箱那段对话里跑
    await rbox.click()
    await page.keyboard.type('/整理收件箱')
    await page.keyboard.press('Enter')
    // （收件箱里有刚才视频要点那一篇）
    await expect(chat(page).getByTestId('ai-msg').last()).toContainText(/读了收件箱\d+条/, { timeout: 15_000 })
    await expect(chat(page).getByTestId('ai-away')).toContainText('收件箱')
  } finally {
    await run.close()
    server.close()
  }
})

test('自己存的命令：/ 菜单最上面；跑的时候只读这一篇、先给你看，收下才写、一次提交「AI：/名字 · 这篇」，能撤回；空对话那排小按钮在竖线后面列它、点了就跑', async () => {
  test.setTimeout(120_000)
  const run = await launch({ ...FILES, '.canvas-notes/命令.json': JSON.stringify(MINE) }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await openByName(page, '第2讲 预备知识')
    await openAi(page)
    // 空对话：小按钮里竖线后面是自己的命令（书签图标、强调色）
    const own = chat(page).getByTestId('ai-quick').locator('.qc.own')
    await expect(own).toHaveText('整理成通顺笔记')
    await expect(chat(page).getByTestId('ai-quick').locator('.qsep')).toHaveCount(1)
    await box(page).click()
    await page.keyboard.type('/')
    await expect(menu(page).locator('.it').first().locator('.n')).toHaveText('整理成通顺笔记')
    await expect(menu(page).locator('.it').first().locator('.tg span')).toHaveText(['改这一篇', '先给你看', '能撤回'])
    await expect(page.getByTestId('slash-count')).toHaveText('这里能用 12 条')
    await page.keyboard.press('Enter')
    // 先给你看：中间开对比标签，文件没动
    await expect(page.getByTestId('proposal-bar')).toBeVisible({ timeout: 15_000 })
    expect(read(vault, '课程/第2讲 预备知识.md')).toBe(LECTURE)
    const msg = lastMsg(page)
    await expect(msg.getByRole('button', { name: '收下' })).toBeVisible()
    await page.getByTestId('proposal-bar').getByRole('button', { name: '收下' }).click()
    await expect(msg.getByTestId('ai-change')).toContainText('改了1个文件')
    expect(subjects(vault, 1)).toEqual(['AI：/整理成通顺笔记 · 第2讲 预备知识'])
    const done = read(vault, '课程/第2讲 预备知识.md')
    expect(done).toContain('（测试：照 2 条规矩改过）')
    expect(done).not.toContain('—— 出处')
    await msg.getByTestId('ai-change').getByRole('button', { name: '撤回' }).click()
    await expect(msg.getByTestId('ai-change')).toContainText('已撤回')
    await expect.poll(() => read(vault, '课程/第2讲 预备知识.md')).toBe(LECTURE)
    // 不要：文件不动、标签关掉
    await box(page).click()
    await page.keyboard.type('/整理成')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('proposal-bar')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('proposal-bar').getByRole('button', { name: '不要' }).click()
    await expect(page.getByTestId('proposal-bar')).toHaveCount(0)
    await expect(lastMsg(page)).toContainText('没收下，文件没动')
    expect(read(vault, '课程/第2讲 预备知识.md')).toBe(LECTURE)
    // 新对话：小按钮里的自己的命令点了就跑
    await chat(page).getByRole('button', { name: '新对话' }).click()
    await chat(page).getByTestId('ai-quick').locator('.qc.own').click()
    await expect(page.getByTestId('proposal-bar')).toBeVisible({ timeout: 15_000 })
  } finally {
    await run.close()
  }
})

test('/ 命令跟着输入框底行选的模型和想多久走（task-0fhyo）：选 Low 跑 /总结这块白板，引擎拿到的就是 low', async () => {
  const run = await launch(FILES, { CN_AI_FAKE: '1', CN_FAKE_SAY_PICK: '1' })
  const { page } = run
  try {
    await openByName(page, '冰岛')
    await openAi(page)
    // 输入框底行「想多久」那颗：真点开、选 Low（只管这个对话）
    await chat(page).getByTestId('ai-effort').click()
    await page.getByRole('menuitemradio', { name: /^Low/ }).click()
    await expect(chat(page).getByTestId('ai-effort')).toContainText('Low')
    await slash(page, '总结', '总结这块白板')
    await expect(lastMsg(page).locator('.txt')).toContainText('（claude · 模型：claude-opus-5-5 · effort：low）', { timeout: 15_000 })
  } finally {
    await run.close()
  }
})

test('读 PDF 那一格打 /：这份 PDF 三条写进它的笔记（每页讲什么、自测题接在末尾，复习提纲插在最上面、问答原文不动），一次提交能撤回；整个库的换到首页那段对话跑', async () => {
  test.setTimeout(150_000)
  const note = '# 第3讲 笔记\n\n## 第 2 页 · 定义\n[第 2 页](第3讲.pdf#page=2) · 10:20 <!-- cn:thread=第3讲-p2-1 -->\n\n> [!question] 线性是什么意思\n\n加起来再变和变了再加一样。\n'
  const run = await launch({ '课程/线代/第3讲.pdf': PDF_BYTES, '课程/线代/第3讲 笔记.md': note }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲.pdf')
    await page.locator('.pal-row', { hasText: '第3讲.pdf' }).first().click()
    await expect(tabOn(page)).toHaveText('第3讲.pdf')
    await openAi(page)
    const rchat = page.getByRole('complementary', { name: '边读边问 AI' })
    const rbox = rchat.getByRole('textbox', { name: '问 AI' })
    const rlast = () => rchat.getByTestId('reading-msg').last()
    await expect(rchat.getByTestId('reading-sees')).toContainText('读过全文5页', { timeout: 15_000 })
    await rbox.click()
    await page.keyboard.type('/')
    expect(await groupTitles(page)).toEqual(['我的命令', '这份 PDF', '整个库'])
    await expect(page.getByTestId('slash-count')).toHaveText('这里能用 9 条')
    expect(await menu(page).locator('.g:has-text("这份 PDF") ~ .it .n').allTextContents()).toContain('这份课件每页讲什么')
    await page.keyboard.type('每页')
    await page.keyboard.press('Enter')
    await expect(rlast().getByTestId('ai-change')).toBeVisible({ timeout: 15_000 })
    await expect(rlast()).toContainText('在笔记末尾加了「每页讲什么」，5页各一两句。')
    const path = '课程/线代/第3讲 笔记.md'
    const pages = read(vault, path)
    expect(pages.startsWith(note.trimEnd() + '\n\n## 每页讲什么\n\n- [第 1 页](%E7%AC%AC3%E8%AE%B2.pdf#page=1)：') || pages.startsWith(note.trimEnd() + '\n\n## 每页讲什么\n\n- [第 1 页](第3讲.pdf#page=1)：')).toBe(true)
    expect(pages.match(/^- \[第 \d 页\]/gm)).toHaveLength(5)
    expect(subjects(vault, 1)).toEqual(['AI：/这份课件每页讲什么 · 第3讲'])
    // 复习提纲：插在最上面，问答原文一字不动
    await rbox.click()
    await page.keyboard.type('/复习')
    await page.keyboard.press('Enter')
    await expect(rlast()).toContainText('在笔记最上面加了「复习提纲」', { timeout: 15_000 })
    const review = read(vault, path)
    expect(review.startsWith('# 第3讲 笔记\n\n## 复习提纲\n\n- [第 2 页]')).toBe(true)
    expect(review).toContain(note.slice('# 第3讲 笔记\n\n'.length).trimEnd())
    // 撤回：回到加提纲之前
    await rlast().getByTestId('ai-change').getByRole('button', { name: '撤回' }).click()
    await expect(rlast().getByTestId('ai-change')).toContainText('已撤回')
    await expect.poll(() => read(vault, path)).toBe(pages)
    // 自测题：末尾一节
    await rbox.click()
    await page.keyboard.type('/自测')
    await page.keyboard.press('Enter')
    await expect(rlast()).toContainText('在笔记末尾加了「自测题」一节', { timeout: 15_000 })
    expect(read(vault, path).match(/<details><summary>答案<\/summary>/g)).toHaveLength(5)
    // 整个库的：换到首页那段对话里跑（这里写「这是在「首页」问的」）
    await rbox.click()
    await page.keyboard.type('/找重复')
    await page.keyboard.press('Enter')
    await expect(chat(page).getByTestId('ai-away')).toContainText('首页')
    await expect(chat(page).getByTestId('ai-msg').last()).toContainText(/没找到重复的|对可能重复/, { timeout: 15_000 })
  } finally {
    await run.close()
  }
})

test('/ 菜单里右键一条：往下挪、藏起（最下面「藏着的 1 条」里放回，底部能撤回）；顺序和藏起记在库里的命令.json', async () => {
  const run = await launch(FILES, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await openByName(page, '第2讲 预备知识')
    await openAi(page)
    await box(page).click()
    await page.keyboard.type('/')
    const names = () => menu(page).locator('.it:not(.put) .n').allTextContents()
    expect((await names()).slice(0, 2)).toEqual(['截图转成文字', '补双链'])
    // 右键「截图转成文字」→ 往下挪：和补双链换个位置
    await menu(page).locator('.it:has(.n:text-is("截图转成文字"))').click({ button: 'right' })
    const rowMenu = page.getByRole('menu', { name: '截图转成文字' })
    await expect(rowMenu.getByRole('menuitem')).toHaveText(['复制一份再改…', '往上挪', '往下挪', '藏起'])
    await expect(rowMenu.getByRole('menuitem', { name: '往上挪' })).toBeDisabled()
    await rowMenu.getByRole('menuitem', { name: '往下挪' }).click()
    await expect.poll(async () => (await names()).slice(0, 2)).toEqual(['补双链', '截图转成文字'])
    await expect(menu(page).locator('.ft .sl-toast')).toContainText('「截图转成文字」往下挪了一格')
    // 底栏那一句就是底栏里的一行字：不带浮层的边框、底色、阴影，不超出 28 高的底栏
    const look = await menu(page)
      .locator('.ft .sl-toast')
      .evaluate((el) => {
        const s = getComputedStyle(el)
        const r = el.getBoundingClientRect()
        const ft = el.parentElement!.getBoundingClientRect()
        return { inside: r.top >= ft.top && r.bottom <= ft.bottom, border: s.borderTopWidth, shadow: s.boxShadow, bg: s.backgroundColor }
      })
    expect(look).toEqual({ inside: true, border: '0px', shadow: 'none', bg: 'rgba(0, 0, 0, 0)' })
    // 藏起「翻译」：不列了，最下面「藏着的 1 条」
    await menu(page).locator('.it:has(.n:text-is("翻译"))').click({ button: 'right' })
    await page.getByRole('menu', { name: '翻译' }).getByRole('menuitem', { name: '藏起' }).click()
    await expect(menu(page).locator('.it:not(.put) .n', { hasText: /^翻译$/ })).toHaveCount(0)
    const rows = menu(page).locator('.it:not(.put)')
    await expect(rows).toHaveCount(10)
    await expect(menu(page).locator('.ft .sl-toast')).toContainText('藏起了「翻译」')
    await expect.poll(() => JSON.parse(read(vault, '.canvas-notes/命令.json')).slash).toEqual({ hidden: ['tr'], order: ['link', 'ocr', 'quiz', 'split', 'sum', 'tr'] })
    // 底部「撤回」：翻译又回来
    await menu(page).locator('.ft .sl-toast').getByRole('button', { name: '撤回' }).click()
    await expect(rows).toHaveCount(11)
    await expect.poll(() => JSON.parse(read(vault, '.canvas-notes/命令.json')).slash.hidden ?? []).toEqual([])
    // 再藏一次，从「藏着的 1 条」里放回
    await menu(page).locator('.it:has(.n:text-is("翻译"))').click({ button: 'right' })
    await page.getByRole('menu', { name: '翻译' }).getByRole('menuitem', { name: '藏起' }).click()
    await expect(rows).toHaveCount(10)
    await menu(page).getByRole('button', { name: '藏着的 1 条' }).click()
    await menu(page).locator('.it.put:has(.n:text-is("翻译"))').getByRole('button', { name: '放回' }).click()
    await expect(rows).toHaveCount(11)
    await expect.poll(() => JSON.parse(read(vault, '.canvas-notes/命令.json')).slash.hidden ?? []).toEqual([])
  } finally {
    await run.close()
  }
})

test('/现在梦游 也跟着输入框底行选的想多久走（task-0fhyo）：梦游问 AI 的每一问带的是输入框选的 Low', async () => {
  const log = join(mkdtempSync(join(tmpdir(), 'cn-pick-')), 'pick.log')
  const run = await launch({ ...FILES, '收件箱/极光.md': '# 极光\n\n冰岛看极光的几个地方。\n' }, { CN_AI_FAKE: '1', CN_FAKE_PICK_LOG: log })
  const { page } = run
  try {
    await openByName(page, '第2讲 预备知识')
    await openAi(page)
    await chat(page).getByTestId('ai-effort').click()
    await page.getByRole('menuitemradio', { name: /^Low/ }).click()
    await expect(chat(page).getByTestId('ai-effort')).toContainText('Low')
    await slash(page, '梦游', '现在梦游')
    await expect(lastMsg(page)).toContainText('梦游跑完了', { timeout: 30_000 })
    const asks = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { cmd: string; feature: string; pick: { engine: string; effort?: string } | null })
    const dream = asks.filter((a) => a.feature === 'dream')
    expect(dream.length).toBeGreaterThan(0)
    for (const a of dream) expect(a.pick).toMatchObject({ engine: 'claude', effort: 'low' })
  } finally {
    await run.close()
  }
})

test('软件最窄的窗口 960×600：/ 菜单里每条的名字都看得全（小标签先让：只留第一个，再窄就不要），底下「这里能用 N 条」不被截掉', async () => {
  const run = await launch({ ...FILES, '.canvas-notes/命令.json': JSON.stringify(MINE) }, { CN_AI_FAKE: '1' })
  const { page, app } = run
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(960, 600))
    await openByName(page, '第2讲 预备知识')
    await openAi(page)
    await box(page).click()
    await page.keyboard.type('/')
    await expect(menu(page)).toBeVisible()
    // 名字一个字不省略（看得到的那几条）
    const cut = await menu(page)
      .locator('.it:not(.put) .n')
      .evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height > 0 && e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent))
    expect(cut).toEqual([])
    await expect(menu(page).locator('.it .n', { hasText: '整理成通顺笔记' })).toBeVisible()
    // 底下那行：「这里能用 N 条」整句在菜单里
    const count = await menu(page).getByTestId('slash-count').boundingBox()
    const m = await menu(page).boundingBox()
    expect(count!.x + count!.width).toBeLessThanOrEqual(m!.x + m!.width)
    await expect(menu(page).getByTestId('slash-count')).toHaveText(/^这里能用 \d+ 条$/)
  } finally {
    await run.close()
  }
})
