/**
 * 交付对照图（task-4edsc 旁支方向 A「就地展开」）：软件摆成和原型 proto.html#dir=a 同一个状态，整窗截下来（1440×887，B 浮岛书桌）。
 * 只在截交付图时跑：CN_SHOTS=目录，CN_SHOT_TONE=dark 截深湖（不给是天青）。平时跳过。
 */
import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, openNote, pane, type Running, tabOn } from './app'
import { LECTURE } from './fixtures/pdf'

const DIR = process.env.CN_SHOTS
const DARK = process.env.CN_SHOT_TONE === 'dark'
test.skip(!DIR, '只在截交付图时跑（CN_SHOTS=目录）')

const look = (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: DARK ? 'petrol' : 'sky', frame: 'b', winBg: 'aurora' } }))
}
const reading = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })
const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const askbox = (page: Page) => page.getByRole('dialog', { name: '选中的这句' })

async function shot(run: Running, name: string) {
  await run.page.mouse.move(5, 300)
  // 答完那一圈光（停 0.25 秒、1.2 秒淡掉）走完再截，对照图里不带它
  await expect(run.page.getByTestId('ai-input-glow')).toHaveCount(0, { timeout: 5000 })
  await run.page.waitForTimeout(600)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(DIR!, `app-${name}-${DARK ? 'dark' : 'light'}.png`), Buffer.from(b64, 'base64'))
}

async function size(run: Running) {
  await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
  await expect.poll(() => run.page.evaluate(() => innerHeight)).toBe(887)
}

/** 右栏拖到 w 宽（拖分隔线，跟人一样） */
async function rightWidth(page: Page, panel: Locator, w: number) {
  const now = (await panel.boundingBox())!.width
  const sep = (await page.getByRole('separator', { name: '拖动调整右栏宽度' }).boundingBox())!
  await page.mouse.move(sep.x + sep.width / 2, sep.y + 300)
  await page.mouse.down()
  await page.mouse.move(sep.x + sep.width / 2 - (w - now), sep.y + 300, { steps: 8 })
  await page.mouse.up()
  await expect.poll(async () => Math.round((await panel.boundingBox())!.width)).toBe(w)
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

async function ask(page: Page, s: Locator, q: string) {
  const t = s.getByRole('textbox').last()
  if (q) await t.fill(q)
  await t.press('Enter')
  await expect(s.locator('.acts')).toBeVisible({ timeout: 15_000 })
}

test('读 PDF：340 开着、一句三条、收起只剩小标；480 开着', async () => {
  mkdirSync(DIR!, { recursive: true })
  const run = await launch({ '课程/ecp/Lecture05.pdf': LECTURE }, { CN_AI_FAKE: '1', CN_FAKE_SAY_MS: '1' }, look)
  const { page } = run
  try {
    await size(run)
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('Lecture05')
    await page.locator('.pal-row', { hasText: 'Lecture05' }).first().click()
    await expect(tabOn(page)).toHaveText('Lecture05.pdf')
    await page.keyboard.press('Meta+j')
    const ai = reading(page)
    await expect(ai).toBeVisible()
    await rightWidth(page, ai, 340)
    const pg = page.locator('.pdfpane:not([hidden]) .pdfpage[data-page="2"]')
    await pg.scrollIntoViewIfNeeded()
    const r = (await pg.boundingBox())!
    await page.mouse.move(r.x + r.width * 0.08, r.y + r.height * 0.2)
    await page.mouse.down()
    await page.mouse.move(r.x + r.width * 0.6, r.y + r.height * 0.4, { steps: 6 })
    await page.mouse.up()
    await ai.getByRole('textbox', { name: '问 AI' }).press('Enter')
    const msg = ai.getByTestId('reading-msg').last()
    await expect(msg.locator('.noted')).toContainText('已记进笔记', { timeout: 20_000 })
    const txt = msg.locator('.txt')
    await selectText(page, txt, '列就是', '去哪')
    await askbox(page).getByRole('textbox').fill('为什么是基向量？')
    await askbox(page).getByRole('textbox').press('Enter')
    const s = ai.getByRole('region', { name: '旁支' })
    await expect(s.locator('.acts')).toBeVisible({ timeout: 15_000 })
    await ask(page, s, '那行呢？')
    await shot(run, 'pdf-340-open')
    // 「在哪」标注图要的框（2 倍像素）：旁支那一块、被问的那句和小标、缩成一行的主输入框、记到哪那一行
    if (!DARK) {
      const px = async (l: Locator) => {
        const b = (await l.boundingBox())!
        return [b.x, b.y, b.width, b.height].map((v) => Math.round(v * 2))
      }
      const a = (await txt.locator('.asked.on').first().boundingBox())!
      const g = (await txt.locator('.badge.cur').boundingBox())!
      const x0 = Math.min(a.x, g.x)
      const y0 = Math.min(a.y, g.y)
      const sentence = [x0, y0, Math.max(a.x + a.width, g.x + g.width) - x0, Math.max(a.y + a.height, g.y + g.height) - y0].map((v) => Math.round(v * 2))
      const items = [
        { n: 1, box: await px(s), color: 'green', what: '旁支就地长在被问那句所在的那一段下面：问答、输入框、记到哪都在这一块里' },
        { n: 2, box: sentence, color: 'green', what: '被问的那句开着时整句亮，后面的小标是这一句开了几条，点它开 / 收' },
        { n: 3, box: await px(ai.getByTestId('ai-input-slim')), color: 'green', what: '开着旁支时主对话的输入框缩成一行灰字，点它收起旁支、回到主对话' },
        { n: 4, box: await px(s.locator('.rec')), color: 'green', what: '记到哪：读 PDF 记进笔记第几页（AI 对话「跟着这段对话存」，文档「写在这篇文档里」）' },
      ]
      writeFileSync(join(DIR!, 'where.boxes.json'), JSON.stringify({ image: 'app-pdf-340-open-light.png', items }, null, 1))
    }
    // 一句三条：头上「+」再开两条，小签切换
    await s.getByRole('button', { name: '这句再开一条旁支' }).click()
    await ask(page, s, '')
    await s.getByRole('button', { name: '这句再开一条旁支' }).click()
    await ask(page, s, '那 ASIC 呢？')
    await shot(run, 'pdf-340-multi')
    await s.getByRole('button', { name: '收起旁支' }).last().click()
    await page.waitForTimeout(250)
    await shot(run, 'pdf-340-closed')
    await rightWidth(page, ai, 480)
    await txt.locator('.badge').click()
    await s.locator('.chips .chip').first().click()
    await expect(s.locator('.acts')).toBeVisible()
    await shot(run, 'pdf-480-open')
  } finally {
    await run.close()
  }
})

test('AI 对话：480、340 开着', async () => {
  mkdirSync(DIR!, { recursive: true })
  const run = await launch(
    { '周记/2026-W47.md': '# 2026-W47\n\n周一：第5讲的作业开了个头，注意力那节公式看懂了，但不知道为什么要缩放。\n\n周三：原来是怕点积太大，softmax 变得太尖。早上开始跑步，5 公里。\n\n周五：跑步第三天。约导师下周见面，要先把第一节写完。\n' },
    { CN_AI_FAKE: '1', CN_FAKE_SAY_MS: '1' },
    look,
  )
  const { page } = run
  try {
    await size(run)
    await openNote(page, '2026-W47')
    await page.keyboard.press('Meta+j')
    const ai = chat(page)
    await expect(ai).toBeVisible()
    await rightWidth(page, ai, 480)
    const ta = ai.getByRole('textbox', { name: '问 AI' })
    await ta.fill('把这周的周记总结成三句话')
    await ta.press('Enter')
    const txt = ai.getByTestId('ai-msg').last().locator('.txt')
    await expect(txt).toContainText('下周要把论文计划', { timeout: 15_000 })
    await selectText(page, txt, '周三开始', '下来了。')
    await askbox(page).getByRole('textbox').fill('三次都是几点跑的？')
    await askbox(page).getByRole('textbox').press('Enter')
    const s = ai.getByRole('region', { name: '旁支' })
    await expect(s.locator('.acts')).toBeVisible({ timeout: 15_000 })
    await ask(page, s, '下周还能坚持吗？')
    await shot(run, 'chat-480-open')
    await rightWidth(page, ai, 340)
    await shot(run, 'chat-340-open')
  } finally {
    await run.close()
  }
})

test('文档里的 AI 讲解：340 开着', async () => {
  mkdirSync(DIR!, { recursive: true })
  const doc = [
    '# 第5讲 注意力机制',
    '',
    '这一讲从「一句话里每个词该看谁」讲起，引出 Q、K、V 三样东西。',
    '',
    '> [!ai] AI 讲解 · Claude Code · Opus 5.5 · 看了 00:06 这一帧',
    '> 这一帧在讲缩放点积注意力：先拿 Q 和每个 K 做点积，得到「该看谁」的分数。分数要先除以 √d，再过 softmax 变成权重。',
    '>',
    '> 最后用这些权重把 V 加起来，就是这个位置的输出。维度 d 越大，不缩放时点积越大，softmax 会几乎只剩一个 1，梯度就没了。',
    '',
    '我的理解：缩放是为了让分数别太极端，不然 softmax 只会盯着一个词。',
    '',
    '## 多头注意力',
    '',
    '把 Q、K、V 各切成几份，各算各的，再拼回来。',
    '',
  ].join('\n')
  const run = await launch({ '课程/ecp/第5讲 注意力机制.md': doc }, { CN_AI_FAKE: '1', CN_FAKE_SAY_MS: '1' }, look)
  const { page } = run
  try {
    await size(run)
    await openNote(page, '第5讲 注意力机制')
    await page.keyboard.press('Meta+j')
    await expect(chat(page)).toBeVisible()
    await rightWidth(page, chat(page), 340)
    const content = pane(page).locator('.cm-content')
    await selectText(page, content, '最后用这些', '的输出。')
    await askbox(page).getByRole('textbox').fill('V 在这里是什么？')
    await askbox(page).getByRole('textbox').press('Enter')
    const s = pane(page).getByRole('region', { name: '旁支' })
    await expect(s.locator('.acts')).toBeVisible({ timeout: 15_000 })
    await ask(page, s, '为什么偏偏除以根号 d？')
    await pane(page).locator('.cm-scroller').evaluate((e) => (e.scrollTop = 120))
    await shot(run, 'doc-340-open')
  } finally {
    await run.close()
  }
})
