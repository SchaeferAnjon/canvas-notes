// AI 回答下面那排去掉「引用再问」，改成在回答里选中一句引用（task-bppvn，用户 r77：「这个引用再问有必要么? 不就是直接问么?」）。
// 真拖选回答里的一句 → 选区下方的小框「引用 ⌘↵ · 问这句 ↵」→ 点「引用」：输入框顶上一张引用小卡①，来源「AI的回答」、原文就是这一句；
// 再选一句按 ⌘↵：第二张②。发出去那一条下面列着这两句。读 PDF 的回答里选一句按 ⌘↵ 也是引用，不去问这一页。
// 一律无头（CN_E2E=1）、假 AI（CN_AI_FAKE=1）、临时库。CN_SHOTS=目录 时另存交付图（天青）。
import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, openAi, openNote, tabOn, widenRight, type Running } from './app'
import { LECTURE } from './fixtures/pdf'
import { CODICONS } from '../../../packages/design/src/codicons.gen'
import { armMenus, dismissMenu, menuLabels, openedMenu } from './menu'

const SHOTS = process.env.CN_SHOTS
const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const askbox = (page: Page) => page.getByRole('toolbar', { name: '选中的这句' })

/** 浅色天青、B 款（交付图用这一套） */
const sky = (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: 'sky', frame: 'b', winBg: 'aurora' } }))
}

/** 在 scope 里用鼠标从 from 的第一个字拖到 to 的最后一个字（真拖，选区是浏览器自己算的） */
async function drag(page: Page, scope: Locator, from: string, to: string) {
  const pts = await scope.evaluate(
    (root, [a, b]) => {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      const at = (s: string, end: boolean) => {
        w.currentNode = root
        while (w.nextNode()) {
          const n = w.currentNode as Text
          const i = n.data.indexOf(s)
          if (i < 0) continue
          const r = document.createRange()
          const k = end ? i + s.length - 1 : i
          r.setStart(n, k)
          r.setEnd(n, k + 1)
          const q = r.getBoundingClientRect()
          return end ? { x: q.right - 1, y: q.top + q.height / 2 } : { x: q.left + 1, y: q.top + q.height / 2 }
        }
        throw new Error('找不到：' + s)
      }
      return [at(a!, false), at(b!, true)]
    },
    [from, to],
  )
  await page.mouse.move(pts[0]!.x, pts[0]!.y)
  await page.mouse.down()
  await page.mouse.move(pts[1]!.x, pts[1]!.y, { steps: 8 })
  await page.mouse.up()
}

async function shot(run: Running, name: string, clip: { x: number; y: number; width: number; height: number }) {
  if (!SHOTS) return
  await run.page.waitForTimeout(300)
  const r = { x: Math.max(0, Math.round(clip.x)), y: Math.max(0, Math.round(clip.y)), width: Math.round(clip.width), height: Math.round(clip.height) }
  const b64 = await run.app.evaluate(async ({ BrowserWindow }, c) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage(c)).toPNG().toString('base64'), r)
  mkdirSync(SHOTS, { recursive: true })
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(b64, 'base64'))
}

const S2 = '周三开始每天早上跑步，三次都坚持下来了。'
const S3 = '下周要把论文计划的第一节写完，并约导师见一面。'

test('回答下面一排只剩「拷贝 · 插进文档 · ⋯」；选一句点「引用」、再选一句按 ⌘↵：输入框顶上①②两张引用小卡，原文就是那两句；发出去下面列着这两句', async () => {
  const run = await launch({ '学习笔记.md': '# 学习笔记\n\n第一段。\n' }, { CN_AI_FAKE: '1' }, sky)
  const { page } = run
  try {
    // 矮一点的窗口、右栏拉宽到放得下两张小卡（交付图里回答和输入框挨得近，两张卡都露全）
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 640))
    await expect.poll(() => page.evaluate(() => innerHeight)).toBe(640)
    await openNote(page, '学习笔记')
    await openAi(page)
    await widenRight(page, 140)
    const box = chat(page).getByRole('textbox', { name: '问 AI' })
    await box.fill('把这周总结成三句话')
    await box.press('Enter')
    await expect(chat(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 30_000 })
    const msg = chat(page).getByTestId('ai-msg').last()
    const txt = msg.locator('.txt')
    await expect(txt).toContainText(S3)

    // 回答下面一排：拷贝 · 插进文档 · ⋯，没有「引用再问」
    const row = msg.getByTestId('ai-ans-acts')
    await expect(row.locator('[data-act]')).toHaveText(['拷贝', '插进文档', ''])
    await expect(row.getByRole('button', { name: '引用再问' })).toHaveCount(0)
    await page.mouse.move(5, 5)
    const panel = (await chat(page).boundingBox())!
    const mb = (await msg.boundingBox())!
    await shot(run, 'bppvn-row-light', { x: panel.x, y: mb.y - 16, width: panel.width, height: mb.height + 32 })

    // 选中第二句：小框「引用 ⌘↵」「问这句 ↵」
    await drag(page, txt, '周三', '下来了。')
    expect(await page.evaluate(() => window.getSelection()!.toString())).toBe(S2)
    const ab = askbox(page)
    await expect(ab).toBeVisible()
    await expect(ab.locator(':scope > button')).toHaveText(['问这句↵', '引用⌘↵'])
    // 「引用」的图标同网页、PDF 小条上的引用：comment（quote 那个 ” 在网页小条上是剪藏）
    expect(await ab.locator(':scope > button').nth(1).locator('svg path').first().getAttribute('d')).toBe(/ d="([^"]+)"/.exec(CODICONS.comment[1])![1])
    const ib = (await chat(page).locator('.aiin').boundingBox())!
    const abb = (await ab.boundingBox())!
    await shot(run, 'bppvn-askbox-light', { x: panel.x, y: mb.y - 16, width: panel.width, height: abb.y + abb.height + 16 - (mb.y - 16) })

    // 点「引用」：小框收起，输入框顶上一张小卡①：来源「AI的回答」、原文这一句；字里光标处一个 ①，光标在输入框里
    await ab.getByRole('button', { name: /^引用/ }).click()
    await expect(ab).toHaveCount(0)
    const mats = chat(page).getByTestId('ai-mat')
    await expect(mats).toHaveCount(1)
    await expect(mats.first()).toHaveAttribute('data-src', 'AI的回答')
    await expect(mats.first()).toHaveAttribute('title', `AI的回答：${S2}`)
    await expect(mats.first().locator('.nb')).toHaveText('1')
    await expect(mats.first().locator('.cs')).toHaveText('AI的回答')
    await expect(mats.first().locator('.ct')).toHaveText(S2)
    await expect(box).toBeFocused()
    await expect(box).toHaveValue('①')
    await page.keyboard.type('和')

    // 再选第三句，按 ⌘↵：第二张②，接在光标处
    await drag(page, txt, '下周', '一面。')
    await expect(askbox(page)).toBeVisible()
    await page.keyboard.press('Meta+Enter')
    await expect(askbox(page)).toHaveCount(0)
    await expect(mats).toHaveCount(2)
    await expect(mats.nth(1)).toHaveAttribute('title', `AI的回答：${S3}`)
    await expect(mats.nth(1).locator('.nb')).toHaveText('2')
    await expect(box).toBeFocused()
    await expect(box).toHaveValue('①和②')
    // ⌘↵ 只引用，没发出去
    await expect(chat(page).getByTestId('ai-msg')).toHaveCount(1)
    expect(await page.evaluate(() => window.getSelection()!.isCollapsed)).toBe(true)
    // 交付图：再选一句时的小框，下面输入框里已有的两张引用小卡
    await drag(page, txt, '这周', '弄懂。')
    await expect(askbox(page)).toBeVisible()
    const ib2 = (await chat(page).locator('.aiin').boundingBox())!
    await shot(run, 'bppvn-askbox-cards-light', { x: panel.x, y: mb.y - 16, width: panel.width, height: ib2.y + ib2.height + 6 - (mb.y - 16) })
    await page.keyboard.press('Escape')
    await expect(askbox(page)).toHaveCount(0)
    expect(ib.height).toBeGreaterThan(0)

    // 发出去：用户那一条下面列着这两句（· AI的回答）
    await box.click()
    await page.keyboard.press('End')
    await page.keyboard.type('有关系吗')
    await page.keyboard.press('Enter')
    await expect(chat(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 30_000 })
    const sent = chat(page).locator('.um.mq').last()
    await expect(sent.locator('.fni .fq')).toHaveText([S2, S3])
    await expect(sent.locator('.fni .fs')).toHaveText(['· AI的回答', '· AI的回答'])
    await expect(mats).toHaveCount(0)
  } finally {
    await run.close()
  }
})

test('右键回答：菜单里没有「引用再问」', async () => {
  const run = await launch({ '学习笔记.md': '# 学习笔记\n\n第一段。\n' }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await openNote(page, '学习笔记')
    await openAi(page)
    const box = chat(page).getByRole('textbox', { name: '问 AI' })
    await box.fill('把这周总结成三句话')
    await box.press('Enter')
    await expect(chat(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 30_000 })
    await armMenus(run)
    await chat(page).getByTestId('ai-msg').last().locator('.txt').click({ button: 'right' })
    const labels = menuLabels(await openedMenu(run))
    expect(labels).toEqual(['拷贝', '拷贝为 Markdown', '插进文档', '存进收件箱'])
    await dismissMenu(run)
  } finally {
    await run.close()
  }
})

test('读 PDF 的回答里选一句按 ⌘↵：是引用（输入框顶上一张小卡），不去问这一页', async () => {
  const run = await launch({ '课程/线代/第3讲.pdf': LECTURE }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
    await page.locator('.pal-row', { hasText: '第3讲' }).first().click()
    await expect(tabOn(page)).toHaveText('第3讲.pdf')
    await page.keyboard.press('Meta+j')
    const r = page.getByRole('complementary', { name: '边读边问 AI' })
    const ta = r.getByRole('textbox', { name: '问 AI' })
    await ta.fill('给我讲讲这一页')
    await ta.press('Enter')
    const answer = r.getByTestId('reading-msg').last().locator('.txt')
    await expect(answer).toContainText('列就是基向量去哪', { timeout: 15_000 })
    await expect(r.getByRole('button', { name: '发送' })).toBeVisible()
    const n = await r.getByTestId('reading-msg').count()
    await drag(page, answer, '列就是', '去哪')
    await expect(askbox(page)).toBeVisible()
    await expect(askbox(page).locator(':scope > button')).toHaveText(['问这句↵', '引用⌘↵'])
    await page.keyboard.press('Meta+Enter')
    await expect(askbox(page)).toHaveCount(0)
    const mats = r.getByTestId('ai-mat')
    await expect(mats).toHaveCount(1)
    await expect(mats.first().locator('.ct')).toHaveText('列就是基向量去哪')
    await expect(ta).toHaveValue('①')
    await page.waitForTimeout(600)
    await expect(r.getByTestId('reading-msg')).toHaveCount(n)
  } finally {
    await run.close()
  }
})
