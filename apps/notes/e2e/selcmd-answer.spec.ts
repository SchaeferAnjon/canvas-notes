// AI 回答里选中一句的小菜单也列出自己的 AI 命令（用户 r106「这里是不是也能 把我们自定义的那些放进去?」）：
// 命令库 .canvas-notes/命令.json 里 kind: ai 的命令默认都列在「问这句」下面，去掉勾的（answerSel.off）不列；最多露 4 条，多的在「更多…」；
// 点一条拿选中的那句填好 {选中的字}，开旁支发出去（和「问这句」打了问题一样），旁支里出假回答；「调整…」去设置 › 回答下面那排的「回答里选中一句」，
// 那里去掉勾、小菜单跟着少一条，命令.json 记进 answerSel.off；读 PDF 回答里也一样。
// 一律无头（CN_E2E=1）、假 AI（CN_AI_FAKE=1）、临时库。
import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, openAi, openNote, tabOn } from './app'
import { LECTURE } from './fixtures/pdf'

const WEEK = '周记/2026-W47.md'
const WEEK_TEXT = '# 2026-W47\n\n周一：第5讲的作业开了个头。\n\n周三：早上开始跑步，5 公里。\n'
const CMDS = '.canvas-notes/命令.json'
const SENT = '周三开始每天早上跑步，三次都坚持下来了。'

const ai = (id: string, name: string, prompt: string) => ({ id, name, kind: 'ai', target: `1. ${prompt}`, rules: [{ t: prompt }], where: ['doc'], write: 'answer', desc: prompt, prompt })
const CMDS_TEXT =
  JSON.stringify(
    {
      version: 1,
      own: [
        ai('own-plain', '大白话', '用大白话解释{选中的字}'),
        ai('own-quiz', '考考我', '就这句出一道题考我'),
        ai('own-hidden', '藏起的', '这条去掉了勾'),
        ai('own-ex', '举个例子', '给{选中的字}举个生活里的例子'),
        ai('own-why', '为什么', '为什么会这样'),
        ai('own-en', '翻成英文', '把{选中的字}翻成英文'),
        ai('own-more', '再深一层', '往下再讲深一层'),
      ],
      answerSel: { off: ['own-hidden'] },
    },
    null,
    2,
  ) + '\n'

const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const askbox = (page: Page) => page.getByRole('dialog', { name: '选中的这句' })
const mine = (page: Page) => askbox(page).getByRole('group', { name: '我的命令' })
const sideIn = (scope: Locator) => scope.getByRole('region', { name: '旁支' })
const dlg = (page: Page) => page.getByRole('dialog', { name: '设置' })

/** 在 scope 里用鼠标从 from 拖到 to（真拖，选区是浏览器自己算的；同 side-inline.spec） */
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
      ;(s![0] as Text).parentElement!.scrollIntoView({ block: 'center' })
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

test('AI 对话：回答里选一句，「问这句」下面列出自己的命令（露 4 条 + 更多…），点一条在旁支里拿那句去问；「调整…」去设置去掉勾，小菜单少一条', async () => {
  test.setTimeout(180_000)
  const run = await launch({ [WEEK]: WEEK_TEXT, [CMDS]: CMDS_TEXT }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await openNote(page, '2026-W47')
    await openAi(page)
    const panel = chat(page)
    const ta = panel.getByRole('textbox', { name: '问 AI' })
    await ta.fill('把这周的周记总结成三句话')
    await ta.press('Enter')
    const msg = panel.getByTestId('ai-msg').last()
    const txt = msg.locator('.txt')
    await expect(txt).toContainText('周三开始每天早上跑步', { timeout: 15_000 })
    await expect(panel.getByRole('button', { name: '发送' })).toBeVisible()

    // 选一句：引用、问这句照旧，下面露前 4 条（去掉勾的那条不在），「更多…」写着还有几条，最下面「调整…」
    await selectText(page, txt, '周三开始', '下来了。')
    await expect(askbox(page)).toBeVisible()
    await expect(mine(page).locator('.it')).toHaveText(['大白话', '考考我', '举个例子', '为什么', '更多…2'])
    // 「调整…」在命令组外面、隔一道线自成一组
    await expect(askbox(page).locator(':scope > .it')).toHaveText(['引用⌘↵', '问这句↵', '调整…'])
    // 「更多…」就地展开：剩下两条接在后面，「更多…」不见了
    await mine(page).getByRole('button', { name: /更多…/ }).click()
    await expect(mine(page).locator('.it')).toHaveText(['大白话', '考考我', '举个例子', '为什么', '翻成英文', '再深一层'])
    // 展开以后小框还在窗口里
    const b = (await askbox(page).boundingBox())!
    const vh = await page.evaluate(() => window.innerHeight)
    expect(b.y + b.height).toBeLessThanOrEqual(vh)
    await page.screenshot({ path: process.env.CN_SHOT_DIR ? join(process.env.CN_SHOT_DIR, 'chat-more.png') : test.info().outputPath('chat-more.png') })

    // 点「翻成英文」（在更多里的）：小框收起，那句下面就地开旁支，发出去的是填好 {选中的字} 的那句，假回答讲的是选中的那句
    await mine(page).getByRole('button', { name: '翻成英文' }).click()
    await expect(askbox(page)).toHaveCount(0)
    const s = sideIn(panel)
    await expect(s).toBeVisible()
    await expect(txt.locator('.asked.on')).toHaveText(SENT)
    await expect(s.locator('.sq').first()).toHaveText(`把「${SENT}」翻成英文`)
    const ans = s.getByTestId('side-msg').last()
    await expect(ans).toContainText('旁支，从 fake-claude 分叉', { timeout: 15_000 })
    await expect(ans).toContainText(`讲「${SENT.slice(0, 12)}」`)
    await expect(ans).toContainText(`问的是「把「${SENT}」翻成英文」`)
    // 主对话里不多出东西
    await expect(panel.getByTestId('ai-msg')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(s).toHaveCount(0)

    // 没写 {选中的字} 的：原样发（旁支本来就带着那句）
    await selectText(page, txt, '周三开始', '下来了。')
    await mine(page).getByRole('button', { name: '考考我' }).click()
    await expect(sideIn(panel).locator('.sq').first()).toHaveText('就这句出一道题考我')
    await expect(sideIn(panel).getByTestId('side-msg').last()).toContainText(`讲「${SENT.slice(0, 12)}」`, { timeout: 15_000 })
    await page.keyboard.press('Escape')

    // 「调整…」：设置开在回答下面那排，「回答里选中一句」那一节在眼前；七条都列着，去掉勾的那条没勾
    await selectText(page, txt, '周三开始', '下来了。')
    await askbox(page).getByRole('button', { name: '调整…' }).click()
    await expect(askbox(page)).toHaveCount(0)
    const sec = dlg(page).getByTestId('replies-sel')
    await expect(sec).toBeInViewport()
    const rows = sec.getByRole('listitem')
    await expect(rows).toHaveCount(7)
    await expect(sec.getByRole('checkbox', { name: '藏起的' })).toHaveAttribute('aria-checked', 'false')
    await expect(sec.getByRole('listitem', { name: '为什么' })).toContainText('露着')
    await expect(sec.getByRole('listitem', { name: '翻成英文' })).toContainText('在「更多…」里')
    await page.screenshot({ path: process.env.CN_SHOT_DIR ? join(process.env.CN_SHOT_DIR, 'settings.png') : test.info().outputPath('settings.png') })
    // 去掉「大白话」的勾、勾上「藏起的」：命令.json 的 answerSel.off 跟着变，别的不动
    await sec.getByRole('checkbox', { name: '大白话' }).click()
    await expect(sec.getByRole('checkbox', { name: '大白话' })).toHaveAttribute('aria-checked', 'false')
    await sec.getByRole('checkbox', { name: '藏起的' }).click()
    await expect(sec.getByRole('checkbox', { name: '藏起的' })).toHaveAttribute('aria-checked', 'true')
    await expect.poll(() => JSON.parse(readFileSync(join(vault, CMDS), 'utf8')).answerSel).toEqual({ off: ['own-plain'] })
    const saved = JSON.parse(readFileSync(join(vault, CMDS), 'utf8'))
    expect(saved.own).toEqual(JSON.parse(CMDS_TEXT).own)
    await page.keyboard.press('Escape')
    await expect(dlg(page)).toHaveCount(0)

    // 小菜单跟着变：大白话不在了，藏起的排回原来的位置
    await selectText(page, txt, '周三开始', '下来了。')
    await expect(mine(page).locator('.it')).toHaveText(['考考我', '藏起的', '举个例子', '为什么', '更多…2'])
    await page.keyboard.press('Escape')
  } finally {
    await run.close()
  }
})

test('一条自己的命令都没有：小框照旧只有「引用」「问这句」，不多出分隔线和「调整…」', async () => {
  const run = await launch({ [WEEK]: WEEK_TEXT }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await openNote(page, '2026-W47')
    await openAi(page)
    const panel = chat(page)
    const ta = panel.getByRole('textbox', { name: '问 AI' })
    await ta.fill('把这周的周记总结成三句话')
    await ta.press('Enter')
    const txt = panel.getByTestId('ai-msg').last().locator('.txt')
    await expect(txt).toContainText('周三开始每天早上跑步', { timeout: 15_000 })
    // 等答完（发送那颗回来）再选：不然那句还没流完
    await expect(panel.getByRole('button', { name: '发送' })).toBeVisible()
    await selectText(page, txt, '周三开始', '下来了。')
    await expect(askbox(page).locator('.it')).toHaveText(['引用⌘↵', '问这句↵'])
    await expect(askbox(page).locator('.sep')).toHaveCount(1)
  } finally {
    await run.close()
  }
})

test('读 PDF 的回答里也一样：选一句点自己的命令，旁支里发填好的那句', async () => {
  const PDF = '课程/线代/第3讲.pdf'
  const run = await launch({ [PDF]: LECTURE, [CMDS]: CMDS_TEXT }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
    await page.locator('.pal-row', { hasText: '第3讲' }).first().click()
    await expect(tabOn(page)).toHaveText('第3讲.pdf')
    await expect(page.locator('.pdfpane:not([hidden]) .pdfpage[data-page="1"] canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
    await page.keyboard.press('Meta+j')
    const panel = page.getByRole('complementary', { name: '边读边问 AI' })
    await expect(panel).toBeVisible()
    const ta = panel.getByRole('textbox', { name: '问 AI' })
    await ta.fill('这一页讲什么')
    await ta.press('Enter')
    const txt = panel.getByTestId('reading-msg').last().locator('.txt')
    await expect(txt).toContainText('列就是', { timeout: 20_000 })
    await selectText(page, txt, '列就是', '去哪')
    await expect(mine(page).locator('.it')).toHaveText(['大白话', '考考我', '举个例子', '为什么', '更多…2'])
    await mine(page).getByRole('button', { name: '大白话' }).click()
    const s = sideIn(panel)
    await expect(s.locator('.sq').first()).toHaveText('用大白话解释「列就是基向量去哪」')
    await expect(s.getByTestId('side-msg').last()).toContainText('问的是「用大白话解释「列就是基向量去哪」」', { timeout: 20_000 })
  } finally {
    await run.close()
  }
})
