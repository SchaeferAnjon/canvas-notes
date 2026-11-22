// 旁支接上还没接的两处（task-p90ra，偏好「旁支就地展开」「旁支全局能用」；方向 A 原型 /private/tmp/canvas-notes-branch/proto.html#dir=a，
// 推到这两处的原型 /private/tmp/canvas-notes-build4/side-more/proto.html）：
// 1. 白板上的 AI 讲解卡：卡里拖选一句 → 同一个小框「问这句」→ 旁支就地长在卡里那一段下面（卡跟着长高，同一列下面的卡往下让）；
//    问答写进同一篇（`> [!side]` 挂在讲解下面，和文档里看是同一份），切到文档看得到小标；收起只留小标，小标再开；
// 2. 网页视频「框一块问」问框自己的回答：回答里选一句 → 问框里就地开旁支，旁支的输入框和「记到哪」钉在问框底部（主输入框那一行让给它，task-5yp97）；
//    问答写进那篇文档 AI 讲解块下面的 `> [!side]`。
// 一律无头（CN_E2E=1）、假 AI（CN_AI_FAKE=1）；视频站是本机假的（fixtures/fake-video.ts）。
import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { join } from 'node:path'
import { acts, launch, openNote, pane, rail, waitSaved } from './app'
import { board, col } from './fixtures/board-doc'
import { FAKE_VIDEO_ID, startFakeVideoSite } from './fixtures/fake-video'
import { FIXTURES } from '../../../packages/format/test/fixtures'

const askbox = (page: Page) => page.getByRole('dialog', { name: '选中的这句' })
const sideIn = (scope: Locator) => scope.getByRole('region', { name: '旁支' })
const box = async (l: Locator) => (await l.boundingBox())!

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

async function askInBox(page: Page, q: string) {
  await expect(askbox(page)).toBeVisible()
  const t = askbox(page).getByRole('textbox', { name: '问这句' })
  if (q) await t.fill(q)
  await t.press('Enter')
  await expect(askbox(page)).toHaveCount(0)
}

/** 旁支那一块紧挨在含那句（亮着）的那一段后面 */
const rightUnderSentence = (s: Locator) =>
  s.evaluate((el) => {
    const prev = el.closest('.side-host')?.previousElementSibling
    return !!prev && !!prev.querySelector('.asked.on')
  })

/** 接着问、收起只剩小标、小标再开、esc 收起；input：旁支的输入框不在那一块里时（问框里钉在底部，task-5yp97）在哪 */
async function walk(page: Page, o: { scope: Locator; txt: Locator; q1: string; q2: string; input?: Locator }) {
  const s = sideIn(o.scope)
  const sin = o.input ?? s.getByRole('textbox')
  await expect(sin).toHaveAttribute('placeholder', '接着问这条旁支…')
  await sin.fill(o.q2)
  await sin.press('Enter')
  await expect(s.locator('.sq')).toHaveText([o.q1, o.q2])
  await expect(s.getByTestId('side-msg').last()).toContainText('接着聊', { timeout: 15_000 })
  await expect(s.locator('.acts')).toBeVisible({ timeout: 15_000 })
  await s.getByRole('button', { name: '收起旁支' }).first().click()
  await expect(s).toHaveCount(0)
  const badge = o.txt.locator('.badge')
  await expect(badge).toHaveText('1')
  await expect(badge).toHaveAttribute('title', '这句有 1 条旁支')
  await expect(badge).not.toHaveClass(/\bcur\b/)
  await badge.click()
  await expect(s).toBeVisible()
  await expect(s.locator('.sq')).toHaveText([o.q1, o.q2])
  await expect(sin).toBeFocused()
  await expect(badge).toHaveClass(/\bcur\b/)
  await page.keyboard.press('Escape')
  await expect(s).toHaveCount(0)
  await expect(badge).toHaveText('1')
}

// ---------------------------------------------------------------- 白板上的 AI 讲解卡

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
  '> 最后用这些权重把 V 加起来，就是这个位置的输出。',
  '',
  '我的理解：缩放是为了让分数别太极端。',
  '',
  '## 还没想通',
  '',
  '为什么偏偏是根号 d？',
  '',
].join('\n')

test('白板上的 AI 讲解卡：卡里选一句「问这句」，旁支就地长在卡里那一段下面（卡长高、同一列下面的卡往下让）；问答写进这篇的 `> [!side]`，文档看法里看得到；收起只留小标、小标再开；打开再保存不变', async () => {
  test.setTimeout(120_000)
  const run = await launch({ [DOC]: DOC_TEXT }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  const file = () => readFileSync(join(vault, DOC), 'utf8')
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await openNote(page, '第5讲 注意力机制')
    await acts(page).getByRole('tab', { name: '白板' }).click()
    const card = col(page, '讲解').locator('.db-card[aria-label="AI 讲解"]')
    await expect(card).toBeVisible()
    const below = col(page, '讲解').locator('.db-card', { hasText: '我的理解' })
    const y0 = (await box(below)).y
    const h0 = (await box(card)).height
    const body = card.locator('.side-text')

    // 拖选卡里的一句：卡不跟着挪（文件里不多出位置行），出同一个小框
    await selectText(page, body, '分数要先', '变成权重。')
    await askInBox(page, 'V 在这里是什么？')
    expect(file()).not.toContain('<!-- card')
    const s = sideIn(card)
    await expect(s).toBeVisible()
    expect(await rightUnderSentence(s)).toBe(true)
    await expect(body.locator('.asked.on')).toHaveText('分数要先除以 √d，再过 softmax 变成权重。')
    await expect(s.locator('.sq')).toHaveText(['V 在这里是什么？'])
    await expect(s.getByTestId('side-msg').last()).toContainText('旁支的回答', { timeout: 15_000 })
    await expect(s.locator('.rec')).toHaveText('写在这篇文档里，挂在这段讲解下面')
    await expect(s.locator('.acts button')).toHaveText(['放进主对话', '拷贝'])
    // 卡跟着长高，同一列下面那张往下让（不叠在一起）
    expect((await box(card)).height).toBeGreaterThan(h0 + 150)
    const cb = await box(card)
    expect((await box(below)).y).toBeGreaterThanOrEqual(cb.y + cb.height)
    // 写进文件：挂在讲解下面，第一问带那一句
    await waitSaved(page)
    await expect.poll(file, { timeout: 15_000 }).toContain('就是这个位置的输出。\n\n> [!side] V 在这里是什么？\n> > 分数要先除以 √d，再过 softmax 变成权重。\n>\n> #### 旁支的回答')
    // 白板上不露 md（[!side] 那几行还是和讲解一张卡，卡上只画小标）
    await expect(card).not.toContainText('[!side]')
    await expect(col(page, '讲解').locator('.db-card')).toHaveCount(3)

    await walk(page, { scope: card, txt: body, q1: 'V 在这里是什么？', q2: '为什么偏偏除以根号 d？' })
    await expect.poll(file, { timeout: 15_000 }).toContain('> [!side] 为什么偏偏除以根号 d？\n>\n> #### 旁支的回答')
    // 收起以后卡回到原来的高，下面那张回来
    await expect.poll(async () => Math.round((await box(card)).height)).toBeLessThan(h0 + 40)
    await expect.poll(async () => Math.round((await box(below)).y)).toBe(Math.round(y0))
    await waitSaved(page)

    // 文档看法里是同一份：那句后面有小标，点开问答都在
    await acts(page).getByRole('tab', { name: '文档' }).click()
    const content = pane(page).locator('.cm-content')
    await expect(content.locator('.badge')).toHaveText('1')
    await content.locator('.badge').click()
    const ds = sideIn(pane(page))
    await expect(ds.locator('.sq')).toHaveText(['V 在这里是什么？', '为什么偏偏除以根号 d？'])
    await page.keyboard.press('Escape')
    await expect(ds).toHaveCount(0)

    // 打开再保存不变（白板看法）：关掉再开、切白板、⌘S，字节不变
    const saved = readFileSync(join(vault, DOC))
    await page.locator('.tab.on .x').click()
    await openNote(page, '第5讲 注意力机制')
    await acts(page).getByRole('tab', { name: '白板' }).click()
    await expect(col(page, '讲解').locator('.db-card[aria-label="AI 讲解"] .badge')).toHaveText('1')
    await board(page).focus()
    await page.keyboard.press('Meta+s')
    await page.waitForTimeout(1000)
    expect(readFileSync(join(vault, DOC)).equals(saved)).toBe(true)
  } finally {
    await run.close()
  }
})

test('type: board 的白板上，AI 讲解卡（带「AI 总结的」编号行）挂着的旁支只露小标；点小标打开同一份问答；白板看法 ⌘S 字节不变', async () => {
  const name = '白板带旁支.md'
  const run = await launch({ [name]: FIXTURES[name]! }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await openNote(page, '白板带旁支')
    if (await acts(page).getByRole('tab', { name: '白板' }).getAttribute('aria-selected') !== 'true') await acts(page).getByRole('tab', { name: '白板' }).click()
    const card = col(page, '讲解').locator('.db-card[aria-label="AI 讲解"]')
    const body = card.locator('.side-text')
    await expect(body.locator('.badge')).toHaveText(['1', '1'])
    await expect(card).not.toContainText('[!side]')
    await expect(card).not.toContainText('V 是每个词带的内容')
    await body.locator('.badge').last().click()
    const s = sideIn(card)
    await expect(s.locator('.sq')).toHaveText(['V 在这里是什么？', '那 K 呢？'])
    await expect(body.locator('.asked.on')).toHaveText('最后用这些权重把 V 加起来，就是这个位置的输出。')
    await page.keyboard.press('Escape')
    await expect(s).toHaveCount(0)
    await board(page).focus()
    await page.keyboard.press('Meta+s')
    await page.waitForTimeout(1000)
    expect(Buffer.from(readFileSync(join(vault, name))).equals(Buffer.from(FIXTURES[name]!))).toBe(true)
  } finally {
    await run.close()
  }
})

// ---------------------------------------------------------------- 网页视频框一块问：问框自己的回答

let server: Server
let base: string
test.beforeAll(async () => {
  ;({ server, base } = await startFakeVideoSite())
})
test.afterAll(() => server.close())

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const strip = (page: Page) => web(page).getByRole('region', { name: '视频条' })
const askCard = (page: Page) => web(page).getByRole('dialog', { name: '问 AI' })
const NOTE = '看视频的笔记.md'
const guest = (page: Page, code: string): Promise<unknown> =>
  page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code)

test('问框里的回答选一句也能开旁支：就地长在问框里那一段下面，旁支的输入框钉在问框底部（主输入框让给它）；问答写进那篇讲解块下面的 `> [!side]`，文档里看得到；收起只留小标、再开；接着问照样写进讲解块', async () => {
  test.setTimeout(150_000)
  const run = await launch({ [NOTE]: '# 看视频的笔记\n\n我先写的一句。\n' }, { CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '150', CN_AI_FAKE_ASK_MS: '600', CN_VIDEO_TEST_ORIGIN: base })
  const { page, vault } = run
  const md = () => readFileSync(join(vault, NOTE), 'utf8')
  try {
    await openNote(page, '看视频的笔记')
    await pane(page).getByText('我先写的一句。').click()
    await page.keyboard.press('End')
    await rail(page).getByRole('button', { name: '网页', exact: true }).click()
    const addr = web(page).getByRole('textbox', { name: '网址' })
    await addr.fill(`${base}/watch?v=${FAKE_VIDEO_ID}`)
    await addr.press('Enter')
    await expect(strip(page)).toBeVisible({ timeout: 15_000 })
    await guest(page, `(() => { const v = document.querySelector('video'); v.currentTime = 6; v.pause(); return true })()`)
    await page.waitForTimeout(400)
    await pane(page).getByText('我先写的一句。').click()
    await page.keyboard.press('Alt+KeyD')
    await expect.poll(() => guest(page, `!!document.getElementById('cn-video-host').shadowRoot.querySelector('.box')`)).toBe(true)
    const wv = await box(web(page).locator('webview.on'))
    await page.mouse.move(wv.x + 40, wv.y + 30)
    await page.mouse.down()
    await page.mouse.move(wv.x + 200, wv.y + 120, { steps: 6 })
    await page.mouse.up()
    const ask = askCard(page)
    await expect(ask).toBeVisible()
    await ask.getByRole('textbox', { name: '想问什么' }).press('Enter')
    const ans = ask.getByTestId('ak-answer').first()
    await expect(ans).toContainText('任何向量都是它俩的组合', { timeout: 15_000 })
    await expect(ask.getByRole('button', { name: /已记进《看视频的笔记》/ })).toBeVisible()
    await waitSaved(page)
    await expect.poll(md).toContain('> [!ai] AI 讲解')

    // 回答里选一句：同一个小框，问这句 → 问框里就地长出旁支
    await selectText(page, ans, '任何向量', '的组合，')
    await askInBox(page, '为什么是组合？')
    const s = sideIn(ask)
    await expect(s).toBeVisible()
    expect(await rightUnderSentence(s)).toBe(true)
    await expect(ans.locator('.asked.on')).toHaveText('任何向量都是它俩的组合，')
    await expect(s.getByTestId('side-msg').last()).toContainText('旁支的回答', { timeout: 15_000 })
    // 旁支的输入框和「记到哪」钉在问框底部（主输入框那一行的位置，task-5yp97 选法 2）：主输入框让给它，不在旁支那一块里
    const dock = ask.getByTestId('ak-side-dock')
    await expect(dock.locator('.rec')).toHaveText('写在《看视频的笔记》里，挂在这段讲解下面')
    await expect(s.getByRole('textbox')).toHaveCount(0)
    await expect(dock.getByRole('textbox')).toBeVisible()
    await expect(ask.getByRole('textbox', { name: '想问什么' })).toHaveCount(0)
    // 写进那篇：挂在讲解块下面
    await expect.poll(md, { timeout: 15_000 }).toMatch(/\n\n> \[!side\] 为什么是组合？\n> > 任何向量都是它俩的组合，\n>\n> #### 旁支的回答/)
    const ai = md().indexOf('> [!ai] AI 讲解')
    expect(md().indexOf('> [!side] 为什么是组合？')).toBeGreaterThan(ai)

    await walk(page, { scope: ask, txt: ans, q1: '为什么是组合？', q2: '那三维呢？', input: dock.getByRole('textbox') })
    // esc 只收起旁支，问框还在
    await expect(ask).toBeVisible()
    await expect.poll(md, { timeout: 15_000 }).toContain('> [!side] 那三维呢？\n>\n> #### 旁支的回答')

    // 再开、点回答下面的「接着问」：旁支收起、钉着的那一行收掉，光标回到问框的输入框
    await ans.locator('.badge').click()
    await expect(s).toBeVisible()
    await ask.locator('.ak-acts').getByRole('button', { name: '接着问' }).click()
    await expect(s).toHaveCount(0)
    await expect(dock).toHaveCount(0)
    const input = ask.getByRole('textbox', { name: '想问什么' })
    await expect(input).toBeFocused()

    // 问框里接着问：照样写进同一块讲解，在旁支前面（旁支挂在讲解块后面）
    await input.fill('那网格线为什么还平行？')
    await input.press('Enter')
    await expect(ask.getByTestId('ak-answer')).toHaveCount(2)
    await expect.poll(md, { timeout: 15_000 }).toContain('> **接着问**：那网格线为什么还平行？')
    const t = md()
    expect(t.indexOf('**接着问**')).toBeLessThan(t.indexOf('> [!side] 为什么是组合？'))
    // 第一问的小标还在
    await expect(ans.locator('.badge')).toHaveText('1')

    // 文档里是同一份：小标、点开问答都在
    await waitSaved(page)
    const content = pane(page).locator('.cm-content')
    await expect(content.locator('.badge')).toHaveText('1')
    await content.locator('.badge').click()
    await expect(sideIn(pane(page)).locator('.sq')).toHaveText(['为什么是组合？', '那三维呢？'])
  } finally {
    await run.close()
  }
})
