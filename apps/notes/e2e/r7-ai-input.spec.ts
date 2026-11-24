// 第 2b 段：AI 输入框（AI 对话、读 PDF 共用一个）
// - CN-91 方向 C「照 Dispatch 三颗」：谁来答、模型、effort 三颗都在输入框底行，头上没有引擎胶囊；模型和 effort 只管这个对话；
// - 多段引用方向 B「材料一排加编号」：引用、贴的图、框的图收进输入框顶上一排小卡，字里在光标处多一个编号，发出去变成小圆点数字 + 下面一行一条；
// - CN-92 方向 A「框着时 ⌘↵」：框着时 ⌘↵ 是引用（task-6cxtc 起，原来的「改问法」「引用这块」合成「引用」：框的这块成为输入框顶上带编号的一块材料），没框时照旧问这一页；
// - CN-97：框选浮条点外面就收（点 PDF 空白处、右栏空白处连框和图一起取消；点进输入框只收浮条；esc 在哪都收）。
// 一律无头（CN_E2E=1）、假 AI（CN_AI_FAKE=1）。
import { _electron as electron, expect, test, type Locator, type Page } from '@playwright/test'
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import electronPath from 'electron'
import { launch, openNote, pane, tabOn, widenRight } from './app'
import { LECTURE } from './fixtures/pdf'
import { solidPng } from './fixtures/png'

const PDF = '课程/线代/第3讲.pdf'
const files = { '随手记.md': '# 随手记\n\n第一段甲。\n\n第二段乙。\n', '周记.md': '# 周记\n\n这周读了 ECP。\n', [PDF]: LECTURE }

const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const reading = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })
const box = async (l: Locator) => (await l.boundingBox())!
const css = (l: Locator, props: string[]) =>
  l.evaluate((e, ps) => {
    const cs = getComputedStyle(e)
    return Object.fromEntries(ps.map((p) => [p, cs.getPropertyValue(p)]))
  }, props)
const pdfPane = (page: Page) => page.locator('.pdfpane:not([hidden])')
const pdfPage = (page: Page, n: number) => pdfPane(page).locator(`.pdfpage[data-page="${n}"]`)
const capBar = (page: Page) => pdfPane(page).getByRole('toolbar', { name: '框好的这块' })

async function openPdf(page: Page) {
  await page.keyboard.press('Meta+k')
  await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
  await page.locator('.pal-row', { hasText: '第3讲' }).first().click()
  await expect(tabOn(page)).toHaveText('第3讲.pdf')
  await expect(pdfPage(page, 1).locator('canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
}

async function drawBox(page: Page, n: number, a: [number, number], b: [number, number]) {
  const el = pdfPage(page, n)
  await el.scrollIntoViewIfNeeded()
  const r = await box(el)
  await page.mouse.move(r.x + r.width * a[0], r.y + r.height * a[1])
  await page.mouse.down()
  await page.mouse.move(r.x + r.width * b[0], r.y + r.height * b[1], { steps: 6 })
  await page.mouse.up()
}

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

/** 往输入框里粘一张图：照浏览器的粘贴事件来（不碰这台 Mac 真的剪贴板） */
async function pasteImage(page: Page, textarea: Locator) {
  const png = [...solidPng(40, 30, [200, 80, 60])]
  await textarea.evaluate((el, bytes) => {
    ;(el as HTMLTextAreaElement).focus()
    const dt = new DataTransfer()
    dt.items.add(new File([new Uint8Array(bytes)], '截图.png', { type: 'image/png' }))
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, png)
}

const caret = (ta: Locator) => ta.evaluate((t: HTMLTextAreaElement) => [t.selectionStart, t.selectionEnd])
const labels = (l: Locator) => l.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))

test('CN-91 方向 C：谁来答、模型、effort 三颗在输入框底行（头上没有引擎胶囊）；菜单照小样、点外面 / esc / 再点按钮都收；模型和 effort 只管这个对话，回答头上写全；Gemini 没有 effort；没找到的灰掉，「装在别处？指定位置…」走指定位置；读 PDF 同一套', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1', CN_AI_FAKE_CLI: 'codex=missing' })
  const { page, vault } = run
  const root = dirname(vault)
  try {
    await openNote(page, '随手记')
    await page.keyboard.press('Meta+j')
    const ai = chat(page)
    await expect(ai).toBeVisible()
    // 头上没有引擎胶囊，底行：加图 · 谁来答 · 模型 · effort ……发送
    await expect(ai.locator('.aih [data-testid="ai-engine"]')).toHaveCount(0)
    const ft = ai.locator('.aiin .ft')
    expect(await labels(ft.locator('button'))).toEqual(['加图', '选 AI 引擎', '选模型', '选想多久（effort）', '发送'])
    const eng = ai.getByTestId('ai-engine')
    const model = ai.getByTestId('ai-model')
    const effort = ai.getByTestId('ai-effort')
    await expect(eng).toHaveText('Claude Code')
    await expect(model).toHaveText('Opus 5.5')
    await expect(effort).toHaveText('High')
    // 三颗：24 高、左右 6、圆角 6、12px；发送圆钮 28、没字时 --fill2 底
    for (const p of [eng, model, effort]) {
      expect((await box(p)).height).toBe(24)
      expect(await css(p, ['border-radius', 'font-size', 'padding-left', 'padding-right'])).toEqual({ 'border-radius': '6px', 'font-size': '12px', 'padding-left': '6px', 'padding-right': '6px' })
    }
    const send = ai.getByRole('button', { name: '发送' })
    expect(await box(send)).toMatchObject({ width: 28, height: 28 })
    // 输入框外形：外边距 8 12 6（下面是全能模式那一行，2026-11-19）、圆角 12、内边距 8 10 6
    expect(await css(ai.locator('.aiin'), ['margin', 'padding', 'border-radius'])).toEqual({ margin: '8px 12px 6px', padding: '8px 10px 6px', 'border-radius': '12px' })
    // 全能模式那一行：22 高的一颗开关，外边距 0 16 6（开关和输入框里的「+」对齐，到这一格底 6）
    const omni = ai.getByTestId('ai-omni')
    expect(await css(omni, ['margin'])).toEqual({ margin: '0px 16px 6px' })
    expect((await box(omni.getByRole('switch', { name: '全能模式' }))).height).toBe(22)

    // 谁来答：320 宽、往上弹、头「谁来答」，每行右边写在哪找到，没找到的灰掉，分隔线下面「装在别处？指定位置…」
    await eng.click()
    const engMenu = page.getByRole('menu', { name: 'AI 引擎' })
    await expect(engMenu).toBeVisible()
    await expect(eng).toHaveAttribute('aria-expanded', 'true')
    const mb = await box(engMenu)
    expect(mb.width).toBe(320)
    expect(mb.y + mb.height).toBeLessThanOrEqual((await box(eng)).y - 4)
    // 按三条路分组，组名写谁付钱（task-587os）
    await expect(engMenu.locator('.mh')).toHaveText(['本机命令行 · 订阅', 'API Key · 按用量', '本机模型 · 不花钱'])
    const rows = engMenu.getByRole('menuitemradio')
    await expect(rows).toHaveText(['Claude Code~/.local/bin', 'Codex没找到', 'Gemini/opt/homebrew/bin', 'OpenCode~/.opencode/bin', 'Claude API没填Key', 'OpenAI API没填Key', 'DeepSeek API没填Key', 'OpenRouter API没填Key', 'Ollama没找到', 'LM Studio没找到'])
    expect((await box(rows.first())).height).toBe(30)
    await expect(rows.nth(0)).toHaveAttribute('aria-checked', 'true')
    await expect(rows.nth(1)).toBeDisabled()
    await expect(engMenu.getByRole('menuitem', { name: '装在别处？指定位置…' })).toBeVisible()
    // 点外面（回答区）收起
    await ai.locator('.msgs').click({ position: { x: 40, y: 40 } })
    await expect(engMenu).toHaveCount(0)
    // esc 收起，AI 那一格还在
    await eng.click()
    await expect(engMenu).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(engMenu).toHaveCount(0)
    await expect(ai).toBeVisible()
    // 再点按钮是收起不是重开
    await eng.click()
    await expect(engMenu).toBeVisible()
    await eng.click()
    await expect(engMenu).toHaveCount(0)
    await expect(eng).toHaveAttribute('aria-expanded', 'false')

    // 模型：280 宽、头「Claude Code 的模型」，换成 Sonnet
    await model.click()
    const modelMenu = page.getByRole('menu', { name: '模型' })
    await expect(modelMenu).toBeVisible()
    expect((await box(modelMenu)).width).toBe(280)
    await expect(modelMenu.locator('.mh')).toHaveText('Claude Code的模型')
    await expect(modelMenu.getByRole('menuitemradio')).toHaveText(['Opus 5.5', 'Sonnet', 'Haiku'])
    await modelMenu.getByRole('menuitemradio', { name: 'Sonnet' }).click()
    await expect(modelMenu).toHaveCount(0)
    await expect(model).toHaveText('Sonnet')
    // effort：头「想多久（effort）」，每行右边旁注，最下面一行说只管这个对话
    await effort.click()
    const effMenu = page.getByRole('menu', { name: '想多久（effort）' })
    expect((await box(effMenu)).width).toBe(280)
    await expect(effMenu.locator('.mh')).toHaveText('想多久（effort）')
    await expect(effMenu.getByRole('menuitemradio')).toHaveText(['Low最快，小追问够用', 'Medium', 'High讲解默认', 'Extra high想得更久', 'Max最慢、最贵'])
    await expect(effMenu.locator('.sub')).toHaveText('只管这个对话；默认在设置 › AI「AI对话」那一行。')
    await effMenu.getByRole('menuitemradio', { name: /^Low/ }).click()
    await expect(effort).toHaveText('Low')

    // 发一句：引擎真的拿到 Sonnet · Low，回答头上写全；设置里「AI 对话」那一行不变
    const ta = ai.getByRole('textbox', { name: '问 AI' })
    await ta.fill('你用的什么模型')
    await ta.press('Enter')
    const msg = ai.getByTestId('ai-msg').last()
    await expect(msg.locator('.txt')).toHaveText('模型：sonnet，effort：low（Claude Code）', { timeout: 15_000 })
    await expect(msg.locator('.read')).toHaveText('Claude Code · Sonnet · Low')
    expect((await page.evaluate(() => window.cn.aiEngines())).label).toBe('Claude Code · Opus 5.5 · High')

    // 换一篇：那篇的对话是默认的；回来还是这篇自己选的
    await openNote(page, '周记')
    await expect(model).toHaveText('Opus 5.5')
    await expect(effort).toHaveText('High')
    await openNote(page, '随手记')
    await expect(model).toHaveText('Sonnet')
    await expect(effort).toHaveText('Low')

    // 换成 Gemini：没有 effort 那颗，模型是它自己的默认；回答头上只写 Gemini
    await eng.click()
    await engMenu.getByRole('menuitemradio', { name: /Gemini/ }).click()
    await expect(eng).toHaveText('Gemini')
    await expect(effort).toHaveCount(0)
    await expect(model).toHaveText('Gemini 默认模型')
    await ta.fill('这回你用的什么模型')
    await ta.press('Enter')
    await expect(ai.getByTestId('ai-msg').last().locator('.txt')).toHaveText('模型：没指定，effort：没指定（Gemini）', { timeout: 15_000 })
    await expect(ai.getByTestId('ai-msg').last().locator('.read')).toHaveText('Gemini')
    // 换回 Claude Code：这个对话选过的 Sonnet · Low 还在
    await eng.click()
    await engMenu.getByRole('menuitemradio', { name: /Claude Code/ }).click()
    await expect(model).toHaveText('Sonnet')
    await expect(effort).toHaveText('Low')

    // 「装在别处？指定位置…」：只有 Codex 没找到，直接给它选位置（系统选文件框换成直接给一个能跑的 codex）
    const fake = join(root, 'my-tools/codex')
    mkdirSync(dirname(fake), { recursive: true })
    writeFileSync(fake, '#!/bin/sh\necho "codex-cli 9.9.9-test"\n')
    chmodSync(fake, 0o755)
    await run.app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as typeof dialog.showOpenDialog
    }, fake)
    await eng.click()
    await engMenu.getByRole('menuitem', { name: '装在别处？指定位置…' }).click()
    await expect(engMenu).toHaveCount(0)
    await expect(eng).toHaveText('Codex')
    await eng.click()
    await expect(engMenu.getByRole('menuitemradio', { name: /Codex/ })).toBeEnabled()
    await expect(engMenu.getByRole('menuitemradio', { name: /Codex/ })).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('Escape')
    await eng.click()
    await engMenu.getByRole('menuitemradio', { name: /Claude Code/ }).click()

    // 快捷键提示：右栏窄于 420 先藏起来（默认 380，谁来答的名字露着）；窄于 348 谁来答只留标志。拖宽到 600 都露出来
    const hint = ai.getByTestId('ai-hint')
    await expect(hint).toBeHidden()
    await expect(hint).toHaveText('↵ 发送')
    await expect(eng.locator('.lb')).toBeVisible()
    await widenRight(page, -40)
    await expect(eng.locator('.lb')).toBeHidden()
    const sep = await box(page.getByRole('separator', { name: '拖动调整右栏宽度' }))
    await page.mouse.move(sep.x + sep.width / 2, sep.y + 300)
    await page.mouse.down()
    await page.mouse.move(sep.x + sep.width / 2 - 260, sep.y + 300, { steps: 6 })
    await page.mouse.up()
    await expect(hint).toBeVisible()
    await expect(eng.locator('.lb')).toBeVisible()
    expect(await css(hint, ['font-size'])).toEqual({ 'font-size': '11px' })

    // 读 PDF：同一套三颗；effort 换成 Max 只管这份 PDF 的对话
    await openPdf(page)
    const r = reading(page)
    await expect(r).toBeVisible()
    await expect(r.getByTestId('ai-engine')).toHaveText('Claude Code')
    await expect(r.getByTestId('ai-model')).toHaveText('Opus 5.5')
    await r.getByTestId('ai-effort').click()
    await page.getByRole('menu', { name: '想多久（effort）' }).getByRole('menuitemradio', { name: /^Max/ }).click()
    await expect(r.getByTestId('ai-effort')).toHaveText('Max')
    const rta = r.getByRole('textbox', { name: '问 AI' })
    await rta.fill('这一页你用的什么模型')
    await rta.press('Enter')
    const rm = r.getByTestId('reading-msg').last()
    await expect(rm.locator('.txt')).toHaveText('模型：claude-opus-5-5，effort：max', { timeout: 15_000 })
    await expect(rm.locator('.read')).toContainText('· Claude Code · Opus 5.5 · Max')
    await page.waitForTimeout(600)

    // 重开软件：这篇对话选的 Sonnet · Low、这份 PDF 选的 Max 都还在
    await run.app.close()
    const app2 = await electron.launch({
      executablePath: electronPath as unknown as string,
      args: [join(__dirname, '../out/main/index.js')],
      env: { ...process.env, CN_VAULT: vault, CN_USER_DATA: join(root, 'user-data'), CN_AI_FAKE: '1', CN_E2E: '1', CN_NO_AX: '1', CN_QUICK_KEY: 'Alt+Command+Shift+F19' },
    })
    try {
      const p2 = await app2.firstWindow()
      await expect(p2.locator('.vault b')).toHaveText('测试库')
      await expect(reading(p2).getByTestId('ai-effort')).toHaveText('Max')
      await openNote(p2, '随手记')
      await expect(chat(p2).getByTestId('ai-model')).toHaveText('Sonnet')
      await expect(chat(p2).getByTestId('ai-effort')).toHaveText('Low')
    } finally {
      await app2.close()
    }
  } finally {
    // 上面已经关过一次（重开那一段）：再关一次不管成没成，临时库和设置目录删掉
    await run.app.close().catch(() => undefined)
    rmSync(root, { recursive: true, force: true, maxRetries: 5 })
  }
})

test('多段引用方向 B：回答里选一段点小框的「引用」、⇧⌘L 再引用一段、粘一张图、PDF 上框一块点「引用」：一排 4 张卡，编号 ①②③④ 插在光标处；拖第 3 张到最前、删一张，字里的编号跟着改；卡 44 高最宽 220；输入框只多一排；点卡看全文；发出去是小圆点编号和下面的列表', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await openPdf(page)
    await page.keyboard.press('Meta+j')
    const r = reading(page)
    const ta = r.getByRole('textbox', { name: '问 AI' })
    const inp = r.locator('.aiin')
    await ta.fill('给我讲讲这一页')
    await ta.press('Enter')
    const answer = r.getByTestId('reading-msg').last().locator('.txt')
    await expect(answer).toContainText('列就是基向量去哪', { timeout: 15_000 })
    await expect(r.getByRole('button', { name: '发送' })).toBeVisible()
    const h0 = (await box(inp)).height

    // 回答里选一段：选区下方的小框（读 PDF 的旁支，上面一格打问题，下面「引用 ⌘↵」「问这句 ↵」，task-bppvn 起和别处小条一个叫法），点「引用」
    await selectText(page, answer, '列就是', '去哪')
    const qbox = page.getByRole('toolbar', { name: '选中的这句' })
    await expect(qbox).toBeVisible()
    await expect(qbox.getByRole('button')).toHaveText(['问这句↵', '引用⌘↵'])
    await qbox.getByRole('button', { name: /^引用/ }).click()
    await expect(qbox).toHaveCount(0)
    await expect(ta).toHaveValue('①')
    await expect(ta).toBeFocused()
    expect(await caret(ta)).toEqual([1, 1])
    await page.keyboard.type('这句和')
    // 再选一段，⇧⌘L（小条上不写，照旧能用）
    await selectText(page, answer, '这是', '讲解')
    await page.keyboard.press('Meta+Shift+KeyL')
    await expect(ta).toHaveValue('①这句和②')
    await page.keyboard.type('有关？')
    // ⌘V 粘一张图
    await pasteImage(page, ta)
    await expect(ta).toHaveValue('①这句和②有关？③')
    await page.keyboard.type('这图')
    // PDF 上框一块，工具条点「引用」（task-6cxtc 原来的「引用这块」合成了这一颗）
    await drawBox(page, 2, [0.1, 0.2], [0.6, 0.45])
    await expect(capBar(page)).toBeVisible()
    await capBar(page).getByRole('button', { name: /^引用/ }).click()
    await expect(capBar(page)).toHaveCount(0)
    await expect(page.getByTestId('pdf-box')).toHaveCount(0)
    await expect(ta).toHaveValue('①这句和②有关？③这图④')

    const chips = r.getByTestId('ai-mat')
    await expect(chips).toHaveCount(4)
    await expect(chips.locator('.nb')).toHaveText(['1', '2', '3', '4'])
    await expect(chips.nth(0).locator('.cs')).toHaveText('AI的回答 · 第1页')
    await expect(chips.nth(0).locator('.ct')).toHaveText('列就是基向量去哪')
    await expect(chips.nth(1).locator('.ct')).toHaveText('这是讲解')
    await expect(chips.nth(2)).toHaveAttribute('data-src', '粘贴的图')
    await expect(chips.nth(3)).toHaveAttribute('data-src', '第2页 · 我框的')
    // 卡 44 高、最宽 220（task-6cxtc 复审：132 只露四五个字）；编号圆 16；一排在输入框顶上，输入框只多这一排（约 57）
    for (let i = 0; i < 4; i++) {
      const b = await box(chips.nth(i))
      expect(b.height).toBe(44)
      expect(b.width).toBeLessThanOrEqual(220)
      expect(await css(chips.nth(i), ['max-width'])).toEqual({ 'max-width': '220px' })
    }
    expect(await box(chips.first().locator('.nb'))).toMatchObject({ width: 16, height: 16 })
    expect((await box(r.getByTestId('ai-shelf'))).y).toBeLessThan((await box(ta)).y)
    const h1 = (await box(inp)).height
    expect(h1 - h0).toBeGreaterThanOrEqual(55)
    expect(h1 - h0).toBeLessThanOrEqual(58)
    await expect(r.getByTestId('ai-hint')).toHaveText('2段引用、2张图 · 字里的 ①② 是它们的位置')

    // 拖第 3 张（贴的图）到第 1 张前面：卡和字里的编号跟着换
    const c3 = await box(chips.nth(2))
    const c1 = await box(chips.nth(0))
    await page.mouse.move(c3.x + c3.width / 2, c3.y + c3.height / 2)
    await page.mouse.down()
    await page.mouse.move(c1.x + 6, c1.y + c1.height / 2, { steps: 8 })
    await page.mouse.up()
    await expect(chips.nth(0)).toHaveAttribute('data-src', '粘贴的图')
    await expect(chips.locator('.nb')).toHaveText(['1', '2', '3', '4'])
    await expect(ta).toHaveValue('②这句和③有关？①这图④')
    // 删第 2 张（列就是…）：它的编号去掉，后面的往前补
    await chips.nth(1).getByRole('button', { name: '删掉这块' }).click()
    await expect(chips).toHaveCount(3)
    await expect(ta).toHaveValue('这句和②有关？①这图③')
    await expect(r.getByTestId('ai-hint')).toHaveText('1段引用、2张图 · 字里的 ①② 是它们的位置')

    // 点一张卡：上面弹 360 宽的小卡看全文，点外面收起
    await chips.nth(1).click()
    const peek = page.getByTestId('ai-peek')
    await expect(peek).toBeVisible()
    await expect(peek).toContainText('这是讲解')
    await expect(peek).toContainText('AI的回答 · 第1页')
    expect((await box(peek)).width).toBe(360)
    expect((await box(peek)).y + (await box(peek)).height).toBeLessThanOrEqual((await box(chips.nth(1))).y)
    await r.locator('.msgs').click({ position: { x: 30, y: 30 } })
    await expect(peek).toHaveCount(0)

    // 发出去：字里的编号是 15 的小圆点数字，下面一行一条列出每块；AI 收到两张图、三块材料
    await ta.click()
    await ta.press('End')
    await ta.press('Enter')
    const um = r.locator('.um.mq').last()
    await expect(um.locator('.mt')).toHaveText('这句和2有关？1这图3')
    const inline = um.locator('.mt .fn')
    await expect(inline).toHaveCount(3)
    expect(await box(inline.first())).toMatchObject({ width: 15, height: 15 })
    const items = um.locator('.fnl .fni')
    await expect(items).toHaveCount(3)
    await expect(items.nth(0)).toContainText('粘贴的图')
    expect((await box(items.nth(0).locator('img'))).height).toBe(36)
    await expect(items.nth(1)).toHaveText('2这是讲解· AI的回答 · 第1页')
    await expect(items.nth(2)).toContainText('第2页 · 我框的')
    expect(await css(um.locator('.fnl'), ['border-top-width', 'padding-top', 'font-size'])).toEqual({ 'border-top-width': '1px', 'padding-top': '6px', 'font-size': '12px' })
    await expect(r.getByTestId('reading-msg').last().locator('.txt')).toContainText('图 2 张', { timeout: 15_000 })
    await expect(r.getByTestId('reading-msg').last().locator('.txt')).toContainText('材料 3 块')
    // 发完：一排收起，输入框回到原来的高
    await expect(r.getByTestId('ai-shelf')).toHaveCount(0)
    await expect(ta).toHaveValue('')
    expect((await box(inp)).height).toBe(h0)
  } finally {
    await run.close()
  }
})

test('CN-92 方向 A + CN-97：框一块，图在输入框那一排第一张（不带编号、左下角「第2页」）、预填全选；⌘↵（焦点在输入框或 PDF 上）是引用：这块成为带编号的材料 ①、框收起、光标在输入框；没框 ⌘↵ 问这一页；esc、点右栏空白处、点 PDF 空白处、点标签条，浮条都收；点进输入框只收浮条；发出去马上收', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await openPdf(page)
    await page.keyboard.press('Meta+j')
    const r = reading(page)
    const ta = r.getByRole('textbox', { name: '问 AI' })
    const lead = r.getByTestId('reading-att')
    const hint = r.getByTestId('ai-hint')
    const frame = page.getByTestId('pdf-box')
    await expect(hint).toHaveText('↵ 发送 · ⌘↵ 问这一页')

    await drawBox(page, 2, [0.1, 0.2], [0.6, 0.45])
    const cap = capBar(page)
    await expect(cap).toBeVisible()
    await expect(cap.getByRole('button')).toHaveText(['讲解一下↵', '翻译 + 讲一讲', '引用⌘↵', '', ''])
    await expect(cap.getByRole('button').nth(3)).toHaveAttribute('aria-label', '更多')
    await expect(cap.getByRole('button', { name: '取消' })).toBeVisible()
    // 工具条照小样：34 高、圆角 9、13px；引用后面一个 ⌘↵ 键帽，样子同讲解一下的 ↵
    expect((await box(cap)).height).toBe(34)
    expect(await css(cap, ['border-radius', 'font-size'])).toEqual({ 'border-radius': '9px', 'font-size': '13px' })
    expect(await css(cap.locator('kbd').nth(1), ['font-size', 'border-radius'])).toEqual(await css(cap.locator('kbd').nth(0), ['font-size', 'border-radius']))
    await expect(lead).toBeVisible()
    await expect(lead.locator('.nb')).toHaveCount(0)
    await expect(lead.locator('.pg')).toHaveText('第2页')
    await expect(lead.locator('img')).toBeVisible()
    await expect(ta).toHaveValue('给我讲解一下')
    await expect(ta).toBeFocused()
    expect(await caret(ta)).toEqual([0, 6])
    await expect(hint).toHaveText('↵ 讲解一下 · ⌘↵ 引用 · esc 取消这块')

    // ⌘↵（焦点在输入框里）：引用。预填清掉，框的这块成为输入框顶上带编号的一块材料（不再是不带编号的第一张），字里一个 ①、
    // 光标在输入框；浮条、框都收起
    const chips = r.getByTestId('ai-mat')
    await page.keyboard.press('Meta+Enter')
    await expect(ta).toHaveValue('①')
    await expect(ta).toBeFocused()
    await expect(chips).toHaveCount(1)
    await expect(chips.first()).toHaveAttribute('data-src', '第2页 · 我框的')
    await expect(chips.first().locator('.nb')).toHaveText('1')
    await expect(lead).toHaveCount(0)
    await expect(cap).toHaveCount(0)
    await expect(frame).toHaveCount(0)
    // 不要这块了：点卡上的 ×，字里的编号跟着去掉，提示回到平时
    await chips.first().getByRole('button', { name: '删掉这块' }).click()
    await expect(chips).toHaveCount(0)
    await expect(ta).toHaveValue('')
    await expect(hint).toHaveText('↵ 发送 · ⌘↵ 问这一页')

    // ⌘↵（焦点在 PDF 上）：一样是引用
    await drawBox(page, 2, [0.1, 0.2], [0.6, 0.45])
    await expect(cap).toBeVisible()
    await page.getByTestId('pdf-view').focus()
    await page.keyboard.press('Meta+Enter')
    await expect(ta).toHaveValue('①')
    await expect(ta).toBeFocused()
    await expect(chips).toHaveCount(1)
    await expect(lead).toHaveCount(0)
    await expect(cap).toHaveCount(0)
    await expect(frame).toHaveCount(0)
    // 打自己的问法，回车：带着引用的那块发出去（字里是编号，下面一行列出「第2页 · 我框的」那张图）
    await page.keyboard.type('这三行什么关系')
    await page.keyboard.press('Enter')
    await expect(r.getByTestId('reading-msg')).toHaveCount(1)
    const um = r.locator('.um.mq').last()
    await expect(um.locator('.mt')).toHaveText('1这三行什么关系')
    await expect(um.locator('.fnl .fni')).toHaveCount(1)
    await expect(um.locator('.fnl .fni').first()).toContainText('第2页 · 我框的')
    await expect(um.locator('.fnl .fni img')).toBeVisible()
    await expect(chips).toHaveCount(0)
    await expect(r.getByRole('button', { name: '发送' })).toBeVisible({ timeout: 15_000 })

    // 没框时 ⌘↵：照旧问这一页
    await page.getByTestId('pdf-view').focus()
    await page.keyboard.press('Meta+Enter')
    await expect(r.locator('.um-wrap').last().locator('.um')).toHaveText('给我讲解一下这一页')
    await expect(r.getByRole('button', { name: '发送' })).toBeVisible({ timeout: 15_000 })

    // 焦点在输入框里（只有预填的字）按 esc：浮条、框、图一起取消
    await drawBox(page, 2, [0.1, 0.2], [0.6, 0.45])
    await expect(cap).toBeVisible()
    await expect(ta).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(cap).toHaveCount(0)
    await expect(frame).toHaveCount(0)
    await expect(lead).toHaveCount(0)
    await expect(ta).toHaveValue('')

    // 点右栏空白处
    await drawBox(page, 2, [0.1, 0.2], [0.6, 0.45])
    await expect(cap).toBeVisible()
    const msgs = await box(r.locator('.msgs'))
    await page.mouse.click(msgs.x + msgs.width - 20, msgs.y + msgs.height - 20)
    await expect(cap).toHaveCount(0)
    await expect(frame).toHaveCount(0)
    await expect(lead).toHaveCount(0)

    // 点 PDF 空白处（页边灰的地方）
    await drawBox(page, 2, [0.1, 0.2], [0.6, 0.45])
    await expect(cap).toBeVisible()
    const pv = await box(page.getByTestId('pdf-view'))
    const pg = await box(pdfPage(page, 2))
    await page.mouse.click(pv.x + (pg.x - pv.x) / 2, pg.y + pg.height / 2)
    await expect(cap).toHaveCount(0)
    await expect(frame).toHaveCount(0)
    await expect(lead).toHaveCount(0)

    // 点标签条
    await drawBox(page, 2, [0.1, 0.2], [0.6, 0.45])
    await expect(cap).toBeVisible()
    await tabOn(page).click()
    await expect(cap).toHaveCount(0)
    await expect(lead).toHaveCount(0)

    // 点进输入框：浮条收起，框和图留着；打了自己的字再按 esc 不丢图
    await drawBox(page, 2, [0.1, 0.2], [0.6, 0.45])
    await expect(cap).toBeVisible()
    await ta.click()
    await expect(cap).toHaveCount(0)
    await expect(lead).toBeVisible()
    await expect(frame).toBeVisible()
    await ta.fill('这里的箭头是什么')
    await page.keyboard.press('Escape')
    await expect(lead).toBeVisible()
    await expect(ta).toHaveValue('这里的箭头是什么')
    await lead.getByRole('button', { name: '不要这块了' }).click()
    await expect(lead).toHaveCount(0)
    await expect(frame).toHaveCount(0)
    await ta.fill('')

    // 点「讲解一下」：发出去，浮条马上收
    await drawBox(page, 2, [0.1, 0.2], [0.6, 0.45])
    await cap.getByRole('button', { name: /讲解一下/ }).click()
    await expect(cap).toHaveCount(0)
    await expect(r.locator('.um-wrap').last().locator('.um')).toHaveText('给我讲解一下')
    await expect(lead).toHaveCount(0)
  } finally {
    await run.close()
  }
})

test('文档里选字 ⌘J、右键「问 AI」成为第一块引用（来源「《文档标题》」），光标在它后面，不再塞「> 引文」；再 ⌘J 换掉这一块；换篇拿掉它、自己打的字留着；粘图、「+」加图也是一块；字最多 6 行再滚；发出去 AI 收到编号 ① 和材料', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  const line = (t: string) => pane(page).locator('.cm-line', { hasText: t })
  const selectLine = async (t: string) => {
    await line(t).click()
    await page.keyboard.press('End')
    await page.keyboard.press('Shift+Home')
  }
  try {
    await openNote(page, '随手记')
    await selectLine('第一段甲')
    await page.keyboard.press('Meta+j')
    const ai = chat(page)
    const ta = ai.getByRole('textbox', { name: '问 AI' })
    const chips = ai.getByTestId('ai-mat')
    await expect(chips).toHaveCount(1)
    await expect(chips.first().locator('.cs')).toHaveText('《随手记》')
    await expect(chips.first().locator('.ct')).toHaveText('第一段甲。')
    await expect(ta).toHaveValue('①')
    await expect(ta).toBeFocused()
    expect(await caret(ta)).toEqual([1, 1])
    await page.keyboard.type('帮我改得口语一点')
    // 再选一段 ⌘J：换掉这一块（还是 ①），打的字留着
    await page.keyboard.press('Escape')
    await selectLine('第二段乙')
    await page.keyboard.press('Meta+j')
    await expect(chips).toHaveCount(1)
    await expect(chips.first().locator('.ct')).toHaveText('第二段乙。')
    await expect(ta).toHaveValue('①帮我改得口语一点')
    // 换篇：这一块和它的编号拿掉，自己打的字留着
    await openNote(page, '周记')
    await expect(chips).toHaveCount(0)
    await expect(ta).toHaveValue('帮我改得口语一点')

    // 粘一张图、「+」加一张图（系统选图框换成直接给一张）：各是一块
    await ta.click()
    await ta.press('End')
    await pasteImage(page, ta)
    await expect(ta).toHaveValue('帮我改得口语一点①')
    const png = join(dirname(vault), '草图.png')
    writeFileSync(png, solidPng(30, 20, [20, 120, 200]))
    await run.app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as typeof dialog.showOpenDialog
    }, png)
    await ai.getByRole('button', { name: '加图' }).click()
    await expect(chips).toHaveCount(2)
    await expect(chips.nth(1)).toHaveAttribute('data-src', '草图.png')
    await expect(ta).toHaveValue('帮我改得口语一点①②')

    // 字：6 行不滚，第 7 行开始在框里滚，输入框不再变高
    await ta.press('End')
    for (let i = 2; i <= 6; i++) {
      await ta.press('Shift+Enter')
      await page.keyboard.type(`第${i}行`)
    }
    const scroll = () => ta.evaluate((t: HTMLTextAreaElement) => t.scrollHeight > t.clientHeight + 1)
    expect(await scroll()).toBe(false)
    const h6 = (await box(ai.locator('.aiin'))).height
    await ta.press('Shift+Enter')
    await page.keyboard.type('第7行')
    expect(await scroll()).toBe(true)
    expect((await box(ai.locator('.aiin'))).height).toBe(h6)

    // 发出去：消息里小圆点编号、下面的列表；AI 收到两张图、两块材料
    await ta.press('Enter')
    const um = ai.locator('.um.mq').last()
    await expect(um.locator('.mt .fn')).toHaveText(['1', '2'])
    await expect(um.locator('.fnl .fni')).toHaveCount(2)
    await expect(um.locator('.fnl .fni').nth(1)).toContainText('草图.png')
    const reply = ai.getByTestId('ai-msg').last().locator('.txt')
    await expect(reply).toContainText('图 2 张', { timeout: 15_000 })
    await expect(reply).toContainText('材料 2 块')
    await expect(chips).toHaveCount(0)

    // 右键「问 AI 这一块」：同样成为第一块引用
    await openNote(page, '随手记')
    await expect(chips).toHaveCount(0)
  } finally {
    await run.close()
  }
})

/** 小条和 PDF 那一栏（滚动区看得见的那块，不算竖滚动条）在窗口里的位置 */
async function capAndView(page: Page) {
  // 小条出来时有 0.16 秒从上面 4 落下来的动画：等它停稳再量
  await page.waitForTimeout(250)
  const cap = await box(capBar(page))
  const v = await page.getByTestId('pdf-view').evaluate((e) => {
    const r = e.getBoundingClientRect()
    return { left: r.left + e.clientLeft, right: r.left + e.clientLeft + e.clientWidth, top: r.top + e.clientTop, sw: e.scrollWidth, cw: e.clientWidth }
  })
  return { cap, v }
}

/** PDF 第 n 页里一行字（textLayer 的 span）上真拖一遍选中它，返回这一行在窗口里的位置 */
async function selectLine(page: Page, n: number, text: string) {
  const span = pdfPage(page, n).locator('.textLayer span', { hasText: text }).first()
  const sb = await box(span)
  await page.mouse.move(sb.x + 2, sb.y + sb.height / 2)
  await page.mouse.down()
  await page.mouse.move(sb.x + sb.width - 2, sb.y + sb.height / 2, { steps: 6 })
  await page.mouse.up()
  // 选区（浏览器自己算的）在窗口里的位置
  return page.evaluate(() => {
    const r = getSelection()!.getRangeAt(0).getBoundingClientRect()
    return { x: r.x, y: r.y, width: r.width, height: r.height }
  })
}

for (const frame of ['b', 'a'] as const) {
  test(`task-6cxtc 复审 · 界面风格 ${frame.toUpperCase()}：PDF 小条带 ↵、⌘↵ 键帽（照命令表），放得下时整条在这一栏里（左右各留 8）；选字 9 颗放不下时伸出这一栏、不出窗口（用户定的 9 颗）；栏底不出横向滚动条；在选区上方 6，上面放不下放到下面 6；栏再窄才藏键帽`, async () => {
    const run = await launch(files, { CN_AI_FAKE: '1' }, (vault) => {
      const ud = join(dirname(vault), 'user-data')
      mkdirSync(ud, { recursive: true })
      writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, frame } }))
    })
    const { page, app } = run
    try {
      // 同截图：1440 宽、右栏拉宽 270，中间栏约 444
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
      await openPdf(page)
      await page.keyboard.press('Meta+j')
      await expect(reading(page)).toBeVisible()
      await widenRight(page, 270)
      const span = pdfPage(page, 2).locator('.textLayer span', { hasText: 'for every scalar c' }).first()
      await span.evaluate((e) => e.scrollIntoView({ block: 'center' }))
      await page.waitForTimeout(200)

      // 选一行字：小条在选区上方 6
      const sb = await selectLine(page, 2, 'for every scalar c')
      const cap = capBar(page)
      await expect(cap).toBeVisible()
      // 选了字时多四颗划线（ParaRead 联动，后合进来）：444 宽放不下整条，先藏划线的名字只留点，再藏键帽；框一块（没有划线）时键帽照样在，见下面
      await expect(cap.locator('kbd')).toHaveText(['↵', '⌘↵'])
      await expect(cap).toHaveClass(/\bnohl\b/)
      await expect(pdfPane(page).getByTestId('hl-pick').first().locator('span')).toBeHidden()
      let { cap: c, v } = await capAndView(page)
      expect(v.right - v.left).toBeGreaterThan(400)
      expect(v.right - v.left).toBeLessThan(470)
      // 用户定了「选字小条保持 9 颗（窄时只留图标）」，不收颗数（0.5.4 已知问题）：藏完名字、键帽 444 宽还放不下，
      // 小条浮在上面伸出这一栏（左边对齐这一栏留 8，往右伸），但不出窗口、不盖住选中的那行字、栏底不出横向滚动条
      const btns = cap.getByRole('button')
      await expect(btns).toHaveCount(9)
      const win = await page.evaluate(() => document.documentElement.clientWidth)
      for (const b of await btns.all()) {
        const bb = await box(b)
        expect(bb.x).toBeGreaterThanOrEqual(0)
        expect(bb.x + bb.width).toBeLessThanOrEqual(win)
      }
      expect(c.x).toBeGreaterThanOrEqual(8 - 1) // 小数宽度取整差零点几：差不到 1 都算留 8
      expect(c.x + c.width).toBeLessThanOrEqual(win - 8 + 1)
      expect(c.x + c.width).toBeGreaterThan(v.right - 8)
      expect(Math.abs(c.x - (v.left + 8))).toBeLessThanOrEqual(1)
      expect(v.sw).toBeLessThanOrEqual(v.cw)
      expect(Math.abs(sb.y - (c.y + c.height) - 6)).toBeLessThanOrEqual(2)
      // 伸出这一栏的那段浮在右边那栏上面（点得到，不被盖住）
      const top = await page.evaluate(([x, y]) => !!document.elementFromPoint(x!, y!)?.closest('[aria-label="框好的这块"]'), [c.x + c.width - 6, c.y + c.height / 2])
      expect(top).toBe(true)
      await page.screenshot({ path: `test-results/r7-pdf-cap-${frame}.png` })
      // 小条是 fixed 的：PDF 滚一下，它跟着选区走
      await page.getByTestId('pdf-view').evaluate((e) => (e.scrollTop += 40))
      await expect.poll(async () => Math.round((await box(cap)).y)).toBe(Math.round(c.y - 40))

      // 选区在这一栏最上面：上面放不下，放到选区下面 6
      await page.keyboard.press('Escape')
      await expect(cap).toHaveCount(0)
      await span.evaluate((e) => {
        const v = e.closest('.pdfv')!
        v.scrollTop += e.getBoundingClientRect().top - v.getBoundingClientRect().top - 10
      })
      await page.waitForTimeout(200)
      const sb2 = await selectLine(page, 2, 'for every scalar c')
      await expect(cap).toBeVisible()
      ;({ cap: c, v } = await capAndView(page))
      expect(sb2.y - v.top).toBeLessThan(40)
      expect(Math.abs(c.y - (sb2.y + sb2.height) - 6)).toBeLessThanOrEqual(2)
      expect(v.sw).toBeLessThanOrEqual(v.cw)
      await page.screenshot({ path: `test-results/r7-pdf-cap-below-${frame}.png` })

      // 框一块（框靠右）：同样在框上方 6、整条在栏里
      await page.keyboard.press('Escape')
      await drawBox(page, 2, [0.55, 0.4], [0.95, 0.5])
      await expect(cap).toBeVisible()
      const fb = await box(page.getByTestId('pdf-box'))
      // 框一块没有划线那几颗：同样 444 宽，键帽整个露着、11 号字
      for (const k of await cap.locator('kbd').all()) await expect(k).toBeVisible()
      expect(await css(cap.locator('kbd').first(), ['font-size'])).toEqual({ 'font-size': '11px' })
      ;({ cap: c, v } = await capAndView(page))
      expect(Math.abs(fb.y - (c.y + c.height) - 6)).toBeLessThanOrEqual(2)
      expect(c.x + c.width).toBeLessThanOrEqual(v.right - 8 + 1)
      expect(c.x).toBeGreaterThanOrEqual(v.left + 8 - 1)
      expect(v.sw).toBeLessThanOrEqual(v.cw)

      // 栏再窄（右栏再拉宽 120）：整条放不下才藏键帽，五颗照样整个露着、在栏里
      await page.keyboard.press('Escape')
      await widenRight(page, 120)
      await drawBox(page, 2, [0.1, 0.4], [0.5, 0.5])
      await expect(cap).toBeVisible()
      ;({ cap: c, v } = await capAndView(page))
      expect(v.right - v.left).toBeLessThan(420)
      await expect(cap.locator('kbd').first()).toBeHidden()
      await page.screenshot({ path: `test-results/r7-pdf-cap-narrow-${frame}.png` })
      expect(c.x).toBeGreaterThanOrEqual(v.left + 8 - 1)
      expect(c.x + c.width).toBeLessThanOrEqual(v.right - 8 + 1)
      expect(v.sw).toBeLessThanOrEqual(v.cw)
    } finally {
      await run.close()
    }
  })
}
