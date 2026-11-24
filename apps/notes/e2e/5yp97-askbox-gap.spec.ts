// 选中一句后浮出的横向小条（r129 用户「选中这个文字的时候 我希望它变成一个小条 浮现在文字的上方」，偏好「回答里选中出横条」）：
// 在选中高亮的上沿上方 6（同网页、PDF 的选中小条），不盖住选中的字。以前是选区下方 8 的竖着的小框（task-5yp97）。
// 四处一起量：读 PDF 右边 AI 的回答、AI 对话的回答、文档里的 AI 讲解块、白板上的 AI 讲解卡。
// 高亮的上沿用像素量：同一块截两张，一张带选区底色、一张把 ::selection 的底色换成透明，差出来的最上面一行就是高亮的上沿。
// 一律无头（CN_E2E=1）、假 AI（CN_AI_FAKE=1）；都是真拖选。
import { expect, test, type Locator, type Page } from '@playwright/test'
import { acts, launch, openAi, openNote, pane, tabOn } from './app'
import { col } from './fixtures/board-doc'
import { LECTURE } from './fixtures/pdf'

const askbox = (page: Page) => page.getByRole('toolbar', { name: '选中的这句' })

/** 在 scope 里用鼠标从 from 拖到 to（真拖，选区是浏览器自己算的） */
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

/** 小条下沿离选中高亮上沿多远（正数是在上面、没盖住）；text：离字的上沿多远 */
async function gapOf(page: Page): Promise<{ highlight: number; text: number }> {
  await expect(askbox(page)).toBeVisible()
  // 小条出来时有 0.16 秒的淡入：等它停了再截（不然两张差出来的是小条的阴影）
  await askbox(page).evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
  const bar = (await askbox(page).boundingBox())!
  const first = await page.evaluate(() => {
    const r = getSelection()!.getRangeAt(0)
    const rs = [...r.getClientRects()].filter((x) => x.width > 1)
    const f = rs.reduce((a, b) => (b.top < a.top ? b : a))
    return { left: f.left, right: f.right, top: f.top, bottom: f.bottom }
  })
  const bottom = bar.y + bar.height
  expect(bottom, '小条在选区上方').toBeLessThan(first.bottom)
  const clip = { x: Math.round(first.left) + 2, y: Math.floor(bottom) + 1, width: Math.max(8, Math.round(first.right - first.left) - 4), height: Math.ceil(first.bottom) - Math.floor(bottom) }
  const shot = async () => (await page.screenshot({ clip })).toString('base64')
  const withSel = await shot()
  await page.evaluate(() => {
    const s = document.createElement('style')
    s.id = 'e2e-no-sel'
    s.textContent = '*::selection { background: transparent !important; }'
    document.head.appendChild(s)
  })
  const noSel = await shot()
  await page.evaluate(() => document.getElementById('e2e-no-sel')?.remove())
  const { rows, h } = await page.evaluate(
    async ([a, b]) => {
      const load = async (s: string) => {
        const bin = Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
        const bm = await createImageBitmap(new Blob([bin], { type: 'image/png' }))
        const c = new OffscreenCanvas(bm.width, bm.height)
        const g = c.getContext('2d')!
        g.drawImage(bm, 0, 0)
        return g.getImageData(0, 0, bm.width, bm.height)
      }
      const A = await load(a!)
      const B = await load(b!)
      const rows: number[] = []
      for (let y = 0; y < A.height; y++) {
        let d = 0
        for (let x = 0; x < A.width; x++) {
          const i = (y * A.width + x) * 4
          d += Math.abs(A.data[i]! - B.data[i]!) + Math.abs(A.data[i + 1]! - B.data[i + 1]!) + Math.abs(A.data[i + 2]! - B.data[i + 2]!)
        }
        rows.push(d / A.width)
      }
      return { rows, h: A.height }
    },
    [withSel, noSel],
  )
  const full = Math.max(...rows)
  expect(full).toBeGreaterThan(3)
  const firstRow = rows.findIndex((d) => d > full * 0.08)
  const cover = Math.min(1, rows[firstRow]! / full)
  const scale = h / clip.height
  const top = clip.y + (firstRow + 1 - cover) / scale
  return { highlight: Math.round((top - bottom) * 10) / 10, text: Math.round((first.top - bottom) * 10) / 10 }
}

async function closeBox(page: Page) {
  await page.keyboard.press('Escape')
  await expect(askbox(page)).toHaveCount(0)
}

const PDF = '课程/线代/第3讲.pdf'
const WEEK = '周记/2026-W47.md'
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
  '> 最后用这些权重把 V 加起来，就是这个位置的输出。维度 d 越大，不缩放时点积越大。',
  '',
  '我的理解：缩放是为了让分数别太极端。',
  '',
].join('\n')

test('选一句出的横向小条在选中高亮上方 6（±1）、不盖住选区：读 PDF 的回答、AI 对话的回答、文档里的 AI 讲解块、白板上的 AI 讲解卡四处一样', async () => {
  test.setTimeout(150_000)
  const run = await launch({ [PDF]: LECTURE, [WEEK]: '# 2026-W47\n\n周一：第5讲的作业开了个头。\n\n周三：早上开始跑步，5 公里。\n', [DOC]: DOC_TEXT }, { CN_AI_FAKE: '1' })
  const { page } = run
  const got: Record<string, { highlight: number; text: number }> = {}
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))

    // 1. 读 PDF：框一块问，回答里选一句
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
    await page.locator('.pal-row', { hasText: '第3讲' }).first().click()
    await expect(tabOn(page)).toHaveText('第3讲.pdf')
    await expect(page.locator('.pdfpane:not([hidden]) .pdfpage[data-page="1"] canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
    await page.keyboard.press('Meta+j')
    const reading = page.getByRole('complementary', { name: '边读边问 AI' })
    await expect(reading).toBeVisible()
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
    got['读 PDF'] = await gapOf(page)
    await closeBox(page)

    // 2. AI 对话：回答里选一句
    await openNote(page, '2026-W47')
    await openAi(page)
    const chat = page.getByRole('complementary', { name: 'AI 对话' })
    const ta = chat.getByRole('textbox', { name: '问 AI' })
    await ta.fill('把这周的周记总结成三句话')
    await ta.press('Enter')
    const cmsg = chat.getByTestId('ai-msg').last()
    await expect(cmsg.locator('.txt')).toContainText('周三开始每天早上跑步', { timeout: 15_000 })
    // 答完（发送键回来）再选：边答边出字时字还在一截截换
    await expect(chat.getByRole('button', { name: '发送' })).toBeVisible()
    await selectText(page, cmsg.locator('.txt'), '周三开始', '下来了。')
    got['AI 对话'] = await gapOf(page)
    await closeBox(page)

    // 3. 文档里的 AI 讲解块
    await openNote(page, '第5讲 注意力机制')
    const content = pane(page).locator('.cm-content')
    await selectText(page, content, '最后用这些', '的输出。')
    got['文档'] = await gapOf(page)
    await closeBox(page)

    // 4. 白板上的 AI 讲解卡
    await acts(page).getByRole('tab', { name: '白板' }).click()
    const card = col(page, '讲解').locator('.db-card[aria-label="AI 讲解"]')
    await expect(card).toBeVisible()
    await selectText(page, card.locator('.side-text'), '分数要先', '变成权重。')
    got['白板'] = await gapOf(page)
    await closeBox(page)

    console.log('小条离高亮上沿 / 离字的上沿：', JSON.stringify(got))
    for (const [where, g] of Object.entries(got)) expect(Math.abs(g.highlight - 6), `${where}：离高亮上沿 ${g.highlight}`).toBeLessThanOrEqual(1)
  } finally {
    await run.close()
  }
})
