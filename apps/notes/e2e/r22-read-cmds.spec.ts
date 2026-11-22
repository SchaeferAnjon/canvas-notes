// 读 PDF、看视频那一格里的 AI 命令（AI 命令独立审核 task-nnss4 查出的四条）：
// 1. 视频要点带时间、字幕整理成一篇：每条的时间是它说的那一句在字幕里的时间，不是二十秒一段的段首（task-fw1f3）；
// 2. PDF 在中间时在右栏开视频，回到文档点 AI 圆钮：到的是这个视频的那段对话，/ 菜单有「这个视频」（task-ajtr9）；
// 3. 命令跑不了（右栏已经不是视频）：照实写原因，不说成「Claude Code没答出来」、不给「再问一次」（task-s2mhv）；
// 4. 命令的结果下面没有讲解用的「还是不懂」「换个方式讲」，给命令结果的按钮：写进去的那一篇（新建的、PDF 的笔记）「打开」，再下面是撤回（task-69r0v）。
// 视频站是本机假的（e2e/fixtures/fake-video.ts，当成 YouTube，8 句字幕每 3 秒一句），AI 是假的（CN_AI_FAKE）；都是真点、真打字。
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { join } from 'node:path'
import { launch, openAi, openNote, rail, tabOn } from './app'
import { FAKE_VIDEO_ID, LINES, startFakeVideoSite } from './fixtures/fake-video'
import { LECTURE } from './fixtures/pdf'

let server: Server
let base: string
test.beforeAll(async () => {
  ;({ server, base } = await startFakeVideoSite())
})
test.afterAll(() => server.close())

const PDF = '课程/线性代数/第3讲 线性映射.pdf'
const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const strip = (page: Page) => web(page).getByRole('region', { name: '视频条' })
const rchat = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })
const rbox = (page: Page) => rchat(page).getByRole('textbox', { name: '问 AI' })
const rlast = (page: Page) => rchat(page).getByTestId('reading-msg').last()
const menu = (page: Page) => page.getByTestId('slash-menu')
const read = (vault: string, f: string) => readFileSync(join(vault, f), 'utf8')
/** 说明以 prefix 开头的最近一次提交改了哪些文件 */
function filesOf(vault: string, prefix: string): string[] {
  const log = execFileSync('git', ['-C', vault, '-c', 'core.quotePath=false', 'log', '--format=@@%s', '--name-only'], { encoding: 'utf8' })
  const part = log.split('@@').find((x) => x.startsWith(prefix))
  return part ? part.split('\n').filter(Boolean).slice(1) : []
}
/** 一句字幕开头的几个字 → 它在字幕里的那一秒（假视频每 3 秒一句） */
const secOfLine = (head: string) => {
  const i = LINES.findIndex((l) => l.startsWith(head.trim()))
  expect(i, `字幕里找不到「${head}」`).toBeGreaterThanOrEqual(0)
  return i * 3
}

/** 右栏网页打开假视频，等到字幕拿到 */
async function openVideo(page: Page) {
  await rail(page).getByRole('button', { name: '网页' }).click()
  const addr = web(page).getByRole('textbox', { name: '网址' })
  await addr.fill(`${base}/watch?v=${FAKE_VIDEO_ID}`)
  await addr.press('Enter')
  await expect(strip(page)).toBeVisible({ timeout: 15_000 })
  await expect(strip(page).getByRole('button', { name: '字幕' })).toContainText('字幕 英', { timeout: 15_000 })
}

/** 在边读边问那一格打 / 和命令名，点菜单里那一条 */
async function runCmd(page: Page, name: string) {
  await rbox(page).click()
  await page.keyboard.type('/' + name)
  await menu(page).locator(`.it:has(.n:text-is("${name}"))`).click()
}

async function openPdf(page: Page) {
  await page.keyboard.press('Meta+k')
  await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
  await page.locator('.pal-row', { hasText: '第3讲 线性映射' }).first().click()
  await expect(tabOn(page)).toHaveText('第3讲 线性映射.pdf')
}

test('视频要点带时间、字幕整理成一篇：每条的时间是它说的那一句在字幕里的那一秒（task-fw1f3）', async () => {
  test.setTimeout(120_000)
  const run = await launch({ 'a.md': '# a\n' }, { CN_AI_FAKE: '1', CN_VIDEO_TEST_ORIGIN: base })
  const { page, vault } = run
  try {
    await openVideo(page)
    await openAi(page)
    await runCmd(page, '视频要点带时间')
    await expect(rlast(page).getByTestId('ai-change')).toBeVisible({ timeout: 30_000 })
    const [keys] = filesOf(vault, 'AI：/视频要点带时间')
    const items = [...read(vault, keys!).matchAll(/^- \[(\d\d):(\d\d)\]\(.+&t=(\d+)s\) 测试要点\d+：(.+)$/gm)].map((m) => ({ shown: Number(m[1]) * 60 + Number(m[2]), link: Number(m[3]), head: m[4]! }))
    expect(items.length).toBeGreaterThanOrEqual(5)
    // 每条写的时间、点回去的那一秒，都是这一句在字幕里开始的那一秒
    for (const x of items) {
      expect(x.shown, x.head).toBe(secOfLine(x.head))
      expect(x.link, x.head).toBe(x.shown)
    }
    // 不是全挤在 00:00
    expect(new Set(items.map((x) => x.shown)).size).toBe(items.length)

    await runCmd(page, '字幕整理成一篇')
    await expect(rlast(page).getByTestId('ai-change')).toBeVisible({ timeout: 30_000 })
    const [text] = filesOf(vault, 'AI：/字幕整理成一篇')
    const paras = [...read(vault, text!).matchAll(/^### \[(\d\d):(\d\d)\]\(.+&t=(\d+)s\)\n\n(.+)$/gm)].map((m) => ({ shown: Number(m[1]) * 60 + Number(m[2]), link: Number(m[3]), head: m[4]!.slice(0, 20) }))
    expect(paras.length).toBeGreaterThanOrEqual(3)
    for (const p of paras) {
      expect(p.shown, p.head).toBe(secOfLine(p.head))
      expect(p.link, p.head).toBe(p.shown)
    }
  } finally {
    await run.close()
  }
})

test('PDF 在中间时在右栏开视频，回到文档点 AI 圆钮：到的是这个视频的对话，/ 菜单有「这个视频」（task-ajtr9）', async () => {
  test.setTimeout(120_000)
  const run = await launch({ '生活/菜谱.md': '# 菜谱\n\n- 番茄炒蛋\n', [PDF]: LECTURE }, { CN_AI_FAKE: '1', CN_VIDEO_TEST_ORIGIN: base })
  const { page } = run
  try {
    // 1. 打开「菜谱」，点右下角圆钮打开 AI
    await openNote(page, '菜谱')
    await openAi(page)
    await expect(page.getByRole('complementary', { name: 'AI 对话' })).toBeVisible()
    // 2. 打开 PDF（PDF 在中间）
    await openPdf(page)
    // 3. 右栏图标「网页」，地址栏打开视频
    await openVideo(page)
    // 4. 回到「菜谱」，点 AI 圆钮
    await page.getByTestId('tab-list').locator('.tab', { hasText: '菜谱' }).click()
    await expect(tabOn(page)).toHaveText('菜谱')
    await expect(strip(page)).toBeVisible()
    await page.getByRole('button', { name: '打开 AI', exact: true }).first().click()
    await expect(rchat(page)).toBeVisible()
    // 看得到写这个视频叫什么（task-6cxtc：写页面的名字，不写整串网址；也不是网址最后一截「watch」）
    await expect(rchat(page).getByTestId('reading-sees')).toHaveText(/网页 · Linear transformations and matrices/)
    await rbox(page).click()
    await page.keyboard.type('/')
    await expect(menu(page)).toBeVisible()
    await expect(menu(page)).toContainText('这个视频')
    await expect(menu(page).locator('.it:has(.n:text-is("视频要点带时间"))')).toHaveCount(1)
  } finally {
    await run.close()
  }
})

test('右栏已经不是视频时在视频那段对话里跑视频命令：照实写原因，不说成没答出来、不给「再问一次」（task-s2mhv）', async () => {
  test.setTimeout(120_000)
  const run = await launch({ 'a.md': '# a\n' }, { CN_AI_FAKE: '1', CN_VIDEO_TEST_ORIGIN: base })
  const { page } = run
  try {
    await openVideo(page)
    await openAi(page)
    await expect(rchat(page)).toBeVisible()
    // 右栏地址栏换成一篇文章（不是视频）
    await page.getByRole('tab', { name: /网页/ }).first().click()
    const addr = web(page).getByRole('textbox', { name: '网址' })
    await addr.fill(`${base}/article`)
    await addr.press('Enter')
    await expect(strip(page)).toHaveCount(0, { timeout: 15_000 })
    await page.getByRole('button', { name: '打开 AI', exact: true }).first().click()
    await expect(rchat(page)).toBeVisible()
    await runCmd(page, '视频要点带时间')
    const msg = rlast(page)
    await expect(msg).toContainText('右栏没开着视频：先在右栏网页里打开一个YouTube或B站视频', { timeout: 15_000 })
    await expect(msg).not.toContainText('没答出来')
    await expect(msg.getByRole('button', { name: '再问一次' })).toHaveCount(0)
    await expect(msg.getByRole('button', { name: '看原话' })).toHaveCount(0)
    await expect(msg.getByRole('button', { name: '还是不懂' })).toHaveCount(0)
  } finally {
    await run.close()
  }
})

test('AI 那边真没答出来（这里演 Claude Code 中途退出）：还是认原因、给「再问一次」，点了是再跑一次这条命令（task-s2mhv）', async () => {
  test.setTimeout(120_000)
  const run = await launch({ 'a.md': '# a\n' }, { CN_AI_FAKE: '1', CN_VIDEO_TEST_ORIGIN: base, CN_AI_FAKE_FAIL: '视频要点带时间:1' })
  const { page, vault } = run
  try {
    await openVideo(page)
    await openAi(page)
    await runCmd(page, '视频要点带时间')
    const err = rlast(page).getByTestId('ai-error')
    await expect(err).toHaveAttribute('data-code', 'exited', { timeout: 15_000 })
    await err.getByRole('button', { name: '再问一次' }).click()
    // 再跑的是命令：新的一轮写出要点、建了文件，不是把「/视频要点带时间」当一句话问
    await expect(rlast(page).getByTestId('ai-change')).toBeVisible({ timeout: 30_000 })
    expect(filesOf(vault, 'AI：/视频要点带时间')[0]).toMatch(/ 要点\.md$/)
  } finally {
    await run.close()
  }
})

test('读 PDF、看视频那一格里命令结果下面：没有「还是不懂」「换个方式讲」，写进去的那一篇给「打开」，再下面能撤回（task-69r0v）', async () => {
  test.setTimeout(150_000)
  const run = await launch({ 'a.md': '# a\n', [PDF]: LECTURE }, { CN_AI_FAKE: '1', CN_VIDEO_TEST_ORIGIN: base })
  const { page, vault } = run
  try {
    // PDF：这份课件每页讲什么 → 写进笔记末尾
    await openPdf(page)
    await openAi(page)
    await expect(rchat(page).getByTestId('reading-sees')).toContainText('读过全文5页', { timeout: 15_000 })
    await runCmd(page, '这份课件每页讲什么')
    let msg = rlast(page)
    await expect(msg.getByTestId('ai-change')).toBeVisible({ timeout: 30_000 })
    await expect(msg.getByRole('button', { name: '还是不懂' })).toHaveCount(0)
    await expect(msg.getByRole('button', { name: '换个方式讲' })).toHaveCount(0)
    await expect(msg.getByRole('button', { name: '撤回' })).toBeVisible()
    // 「打开」：这份 PDF 的笔记开到中间，命令加的那一节在里面
    await msg.getByRole('button', { name: '打开', exact: true }).click()
    await expect(tabOn(page)).toHaveText('第3讲 线性映射 笔记')
    expect(read(vault, '课程/线性代数/第3讲 线性映射 笔记.md')).toContain('## 每页讲什么')
    await page.getByTestId('tab-list').locator('.tab', { hasText: '第3讲 线性映射.pdf' }).click()
    // 翻译（只回答）：也不出讲解那两颗；没选就翻整篇，五页的 PDF 翻全文（task-n1ffi）
    await openAi(page)
    await runCmd(page, '翻译')
    msg = rlast(page)
    await expect(msg).toContainText('读了全文5页', { timeout: 15_000 })
    await expect(msg.locator('.txt')).not.toBeEmpty()
    await expect(msg.getByRole('button', { name: '还是不懂' })).toHaveCount(0)

    // 视频：要点带时间 → 新建进收件箱，「打开」开到中间（先关掉 PDF：PDF 在中间时 AI 问的是 PDF）
    await page.getByTestId('tab-list').locator('.tab', { hasText: '第3讲 线性映射.pdf' }).getByRole('button', { name: '关闭标签' }).click()
    await openVideo(page)
    await openAi(page)
    // 看得到写这个视频叫什么（task-6cxtc：写页面的名字，不写整串网址；也不是网址最后一截「watch」）
    await expect(rchat(page).getByTestId('reading-sees')).toHaveText(/网页 · Linear transformations and matrices/)
    await runCmd(page, '视频要点带时间')
    msg = rlast(page)
    await expect(msg.getByTestId('ai-change')).toBeVisible({ timeout: 30_000 })
    await expect(msg.getByRole('button', { name: '还是不懂' })).toHaveCount(0)
    await expect(msg.getByRole('button', { name: '换个方式讲' })).toHaveCount(0)
    const [keys] = filesOf(vault, 'AI：/视频要点带时间')
    await msg.getByRole('button', { name: '打开', exact: true }).click()
    await expect(tabOn(page)).toHaveText(keys!.split('/').pop()!.replace(/\.md$/, ''))
  } finally {
    await run.close()
  }
})

test('看视频那一格里跑自己的命令（先给你看）：回答下面是「收下」「不要」「看改动」，收下以后是「打开」和撤回（task-69r0v）', async () => {
  test.setTimeout(120_000)
  const mine = { version: 1, own: [{ id: 'own-web', name: '网页整理成笔记', kind: 'ai', target: '1. 去掉出处行', rules: [{ t: '去掉出处行', e: '' }], where: ['web'], write: 'inbox', desc: '测试' }] }
  const run = await launch({ 'a.md': '# a\n', '.canvas-notes/命令.json': JSON.stringify(mine) }, { CN_AI_FAKE: '1', CN_VIDEO_TEST_ORIGIN: base })
  const { page, vault } = run
  try {
    await openVideo(page)
    await openAi(page)
    await runCmd(page, '网页整理成笔记')
    let msg = rlast(page)
    await expect(msg).toContainText('摆在中间先给你看', { timeout: 15_000 })
    await expect(msg.getByRole('button', { name: '还是不懂' })).toHaveCount(0)
    // 中间开着对比标签；先切走再点「看改动」切回来
    await expect(tabOn(page)).toContainText('/网页整理成笔记 改的')
    await page.getByTestId('tab-list').locator('.tab', { hasText: '首页' }).click()
    await msg.getByRole('button', { name: '看改动' }).click()
    await expect(tabOn(page)).toContainText('/网页整理成笔记 改的')
    await msg.getByRole('button', { name: '收下' }).click()
    msg = rlast(page)
    await expect(msg.getByTestId('ai-change')).toBeVisible({ timeout: 15_000 })
    await expect(msg.getByRole('button', { name: '收下' })).toHaveCount(0)
    const [made] = filesOf(vault, 'AI：/网页整理成笔记')
    expect(made).toMatch(/^收件箱\//)
    await expect(msg).toContainText(`收下了，写进了「${made}」`)
    await msg.getByRole('button', { name: '打开', exact: true }).click()
    await expect(tabOn(page)).toHaveText(made!.split('/').pop()!.replace(/\.md$/, ''))
    // 撤回以后「打开」收起来（那一篇没了）
    await msg.getByTestId('ai-change').getByRole('button', { name: '撤回' }).click()
    await expect(msg.getByTestId('ai-change')).toContainText('已撤回')
    await expect(msg.getByRole('button', { name: '打开', exact: true })).toHaveCount(0)
  } finally {
    await run.close()
  }
})
