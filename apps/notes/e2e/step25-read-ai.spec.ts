// 发版前第 1 轮（实用 · 读与 AI）：读 PDF 右栏 AI 的发法、引擎菜单、只贴图、出错那条、⌘J 焦点
import { expect, test, type Page } from '@playwright/test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acts, launch, openAi, openNote, tabOn } from './app'
import { solidPng } from './fixtures/png'
import { shotPart, shotTone, shotWindow } from './shots'
import { LECTURE } from './fixtures/pdf'

const PDF = '课程/线性代数/第3讲 线性映射.pdf'
const files = { [PDF]: LECTURE, '随手记.md': '# 随手记\n\n一段字。\n' }

const ai = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })
const pdfPane = (page: Page) => page.locator('.pdfpane:not([hidden])')
const pdfPage = (page: Page, n: number) => pdfPane(page).locator(`.pdfpage[data-page="${n}"]`)
const box = (page: Page) => ai(page).getByRole('textbox', { name: '问 AI' })
const cap = (page: Page) => pdfPane(page).getByRole('toolbar', { name: '框好的这块' })
const userMsgs = (page: Page) => ai(page).locator('.um-wrap .um')
const dialog = (page: Page) => page.getByRole('dialog', { name: '设置' })

async function openPdf(page: Page) {
  await page.keyboard.press('Meta+k')
  await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
  await page.locator('.pal-row', { hasText: '第3讲 线性映射' }).first().click()
  await expect(tabOn(page)).toHaveText('第3讲 线性映射.pdf')
  await expect(pdfPage(page, 1).locator('canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
  await openAi(page)
  await expect(ai(page).getByTestId('reading-sees')).toContainText('读过全文5页')
}

async function drawBox(page: Page, n: number, a: [number, number], b: [number, number]) {
  const el = pdfPage(page, n)
  await el.scrollIntoViewIfNeeded()
  const r = (await el.boundingBox())!
  await page.mouse.move(r.x + r.width * a[0], r.y + r.height * a[1])
  await page.mouse.down()
  await page.mouse.move(r.x + r.width * b[0], r.y + r.height * b[1], { steps: 6 })
  await page.mouse.up()
}

/** 等这一问答完（发送键回来了、回答有字） */
async function answered(page: Page, n: number) {
  await expect(ai(page).getByTestId('reading-msg')).toHaveCount(n, { timeout: 15_000 })
  await expect(ai(page).getByTestId('reading-msg').last().locator('.txt')).not.toBeEmpty()
  await expect(ai(page).getByRole('button', { name: '发送' })).toBeVisible()
}

test('输入框里先打了问题再框一块：字留着、框的图挂上（光标在最后），回车发的是自己那句；输入框空着框一块照旧预填', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await shotTone(page)
    await openPdf(page)
    // 1. 先打字，再框：输入框里还是自己那句，下面挂着第 2 页框的图，光标在最后
    await box(page).fill('这里 T 指的是什么映射？')
    await drawBox(page, 2, [0.08, 0.15], [0.7, 0.3])
    await expect(ai(page).getByTestId('reading-att').locator('img')).toBeVisible()
    await expect(ai(page).getByTestId('reading-att')).toContainText('第2页')
    await expect(box(page)).toHaveValue('这里 T 指的是什么映射？')
    await expect(box(page)).toBeFocused()
    expect(await box(page).evaluate((t: HTMLTextAreaElement) => [t.selectionStart, t.selectionEnd])).toEqual([13, 13])
    await shotPart(ai(page), 'r1-typed-then-box')
    await page.keyboard.press('Enter')
    await answered(page, 1)
    await expect(userMsgs(page).last()).toHaveText('这里 T 指的是什么映射？')
    await expect(ai(page).locator('.um-wrap').last().locator('.att img')).toBeVisible()
    await expect(box(page)).toHaveValue('')

    // 2. 输入框空着时框一块：照旧预填「给我讲解一下」并全选；esc 收掉框，输入框空
    await drawBox(page, 3, [0.08, 0.25], [0.6, 0.42])
    await expect(box(page)).toHaveValue('给我讲解一下')
    await box(page).press('Escape')
    await expect(box(page)).toHaveValue('')
    await expect(ai(page).getByTestId('reading-att')).toHaveCount(0)
  } finally {
    await run.close()
  }
})

test('打了自己的问题按 ⌘↵：发的是这句（带上这一页的整页图），不是「给我讲解一下这一页」；空着按 ⌘↵ 还是问这一页', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await openPdf(page)
    await box(page).fill('核和像有什么区别？')
    await box(page).press('Meta+Enter')
    await answered(page, 1)
    await expect(userMsgs(page)).toHaveCount(1)
    await expect(userMsgs(page).last()).toHaveText('核和像有什么区别？')
    await expect(ai(page).locator('.um-wrap').last().locator('.att img')).toBeVisible()
    await expect(ai(page).getByTestId('reading-msg').last().locator('.txt')).toContainText('图 1 张')
    await expect(box(page)).toHaveValue('')

    // 输入框空着按 ⌘↵：还是「给我讲解一下这一页」
    await box(page).press('Meta+Enter')
    await answered(page, 2)
    await expect(userMsgs(page).last()).toHaveText('给我讲解一下这一页')
  } finally {
    await run.close()
  }
})

test('框一块连点两下「讲解一下」只发一次、笔记只记一段', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1', CN_FAKE_SAY_MS: '120' })
  const { page, vault } = run
  try {
    await openPdf(page)
    // 1. 连点两下
    await drawBox(page, 3, [0.08, 0.25], [0.6, 0.42])
    await expect(ai(page).getByTestId('reading-att').locator('img')).toBeVisible()
    await cap(page).getByRole('button', { name: /讲解一下/ }).dblclick()
    await answered(page, 1)
    // 记笔记、晚到的第二下都过去了也还是一问一答
    await expect(ai(page).getByTestId('reading-msg').last().getByTestId('ai-noted')).toHaveAttribute('data-state', 'done', { timeout: 15_000 })
    await page.waitForTimeout(800)
    await expect(userMsgs(page)).toHaveCount(1)
    await expect(ai(page).getByTestId('reading-msg')).toHaveCount(1)
    const note = readFileSync(join(vault, '课程/线性代数/第3讲 线性映射 笔记.md'), 'utf8')
    expect(note.match(/^## 第 3 页/gm)).toHaveLength(1)
  } finally {
    await run.close()
  }
})

test('AI 还在答时框一块点「讲解一下」：排在后面（输入框上写着），答完自动发；排着时按 × 不要了就不发', async () => {
  // AI 答到一半停着，等测试框好、点好再放行（以前靠答得慢，机器忙时框好之前就答完了，排不上）
  const gate = join(mkdtempSync(join(tmpdir(), 'cn-hold-')), '放行')
  const release = () => writeFileSync(gate, '')
  const hold = () => rmSync(gate, { force: true })
  const run = await launch(files, { CN_AI_FAKE: '1', CN_FAKE_HOLD: gate })
  const { page } = run
  try {
    await shotTone(page)
    await openPdf(page)
    // 问这一页，答的时候框另一块点「讲解一下」
    await acts(page).getByRole('button', { name: /问这一页/ }).click()
    await expect(ai(page).getByRole('button', { name: '停下' })).toBeVisible()
    await drawBox(page, 4, [0.1, 0.15], [0.6, 0.3])
    await expect(ai(page).getByTestId('reading-att').locator('img')).toBeVisible()
    await cap(page).getByRole('button', { name: /讲解一下/ }).click()
    // 排上了：输入框上面一行写着，框的工具条收起，图还挂着
    await expect(ai(page).getByTestId('reading-queued')).toContainText('答完上一问自动发出：给我讲解一下')
    await shotWindow(run, 'r1-queued')
    await expect(cap(page)).toHaveCount(0)
    await expect(ai(page).getByTestId('reading-att')).toBeVisible()
    release()
    // 上一问答完，这一块自己发出去
    await expect(userMsgs(page)).toHaveCount(2, { timeout: 15_000 })
    await expect(userMsgs(page).nth(0)).toHaveText('给我讲解一下这一页')
    await expect(userMsgs(page).nth(1)).toHaveText('给我讲解一下')
    await answered(page, 2)
    await expect(ai(page).locator('.daysep').last()).toContainText('第4页')
    await expect(ai(page).getByTestId('reading-queued')).toHaveCount(0)
    await expect(ai(page).getByTestId('reading-att')).toHaveCount(0)

    // 3. 排着的时候按 × 不要这块了：答完不再发
    hold()
    await acts(page).getByRole('button', { name: /问这一页/ }).click()
    await expect(ai(page).getByRole('button', { name: '停下' })).toBeVisible()
    await drawBox(page, 2, [0.1, 0.15], [0.6, 0.3])
    await expect(ai(page).getByTestId('reading-att').locator('img')).toBeVisible()
    await cap(page).getByRole('button', { name: /讲解一下/ }).click()
    await expect(ai(page).getByTestId('reading-queued')).toBeVisible()
    await ai(page).getByRole('button', { name: '不要这块了' }).click()
    await expect(ai(page).getByTestId('reading-queued')).toHaveCount(0)
    release()
    await answered(page, 3)
    await page.waitForTimeout(1500)
    await expect(userMsgs(page)).toHaveCount(3)
  } finally {
    await run.close()
  }
})

async function openAiSettings(page: Page) {
  await page.keyboard.press('Meta+,')
  await page.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: 'AI', exact: true }).click()
  await expect(dialog(page).getByTestId('ai-default')).toBeVisible()
}

test('AI 面板头上换引擎只改「AI 对话」那一行：设置 › AI 的默认、梦游不动', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await openPdf(page)
    const eng = ai(page).getByRole('button', { name: '选 AI 引擎' })
    await expect(eng).toHaveText('Claude Code')
    await eng.click()
    await page.getByRole('menu', { name: 'AI 引擎' }).getByRole('menuitemradio').filter({ hasText: 'Gemini' }).click()
    await expect(eng).toHaveText('Gemini')

    await openAiSettings(page)
    await expect(dialog(page).getByTestId('ai-default')).toContainText('Claude Code')
    await expect(dialog(page).locator('[data-row="fDream"]')).toContainText('跟默认Claude Code · Opus 5.5')
    await expect(dialog(page).getByTestId('ai-pick-chat')).toContainText('Gemini')
  } finally {
    await run.close()
  }
})

test('设置里改「AI 对话」：开着的读 PDF 面板和文档浮窗马上换，不用重开；浮窗头上选回默认那家就是跟默认', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await openPdf(page)
    const eng = ai(page).getByRole('button', { name: '选 AI 引擎' })
    await expect(eng).toHaveText('Claude Code')
    await openAiSettings(page)
    // 设置开着改「AI 对话」成 Claude Code · Sonnet；关掉设置，右栏头上已经换了，问一句真的是 Sonnet 答
    // 先选家，再选模型（task-m55m7）
    await dialog(page).getByTestId('ai-pick-chat').click()
    await page.getByRole('menu', { name: 'AI对话用哪一家' }).getByRole('menuitemradio').filter({ has: page.locator('.nm', { hasText: /^Claude Code$/ }) }).click()
    await dialog(page).getByTestId('ai-pick-chat-model').click()
    await page.getByRole('menu', { name: '模型' }).getByRole('menuitemradio').filter({ has: page.locator('.nm', { hasText: /^Sonnet$/ }) }).click()
    await expect(dialog(page).locator('[data-row="fChat"]')).toContainText('Claude CodeSonnet')
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toHaveCount(0)
    await expect(eng).toHaveText('Claude Code')
    await expect(box(page)).toHaveAttribute('placeholder', /跟Claude Code说/)
    await box(page).fill('你用的什么模型')
    await box(page).press('Enter')
    await answered(page, 1)
    await expect(ai(page).getByTestId('reading-msg').last().locator('.txt')).toHaveText('模型：sonnet，effort：high')
    await expect(ai(page).getByTestId('reading-msg').last().locator('.read')).toContainText('· Claude Code · Sonnet')

    // 文档里的 AI 对话开着时（同一格，开着就还开着）去设置改「AI 对话」成 Codex：马上是 Codex
    await openNote(page, '随手记')
    await openAi(page)
    // PDF 那段问过：换页留着（AI 对话绑页面），点头上那颗切到这篇的
    await ai(page).getByTestId('ai-follow').click()
    const float = page.getByRole('complementary', { name: 'AI 对话' })
    await expect(float.getByTestId('ai-engine')).toHaveText('Claude Code')
    await openAiSettings(page)
    await dialog(page).getByTestId('ai-pick-chat').click()
    await page.getByRole('menu', { name: 'AI对话用哪一家' }).getByRole('menuitemradio').filter({ hasText: 'Codex' }).click()
    await page.keyboard.press('Escape')
    await expect(float.getByTestId('ai-engine')).toHaveText('Codex')
    // 浮窗头上选回 Claude Code（默认那家）：「AI 对话」回到跟默认，梦游还是跟默认
    await float.getByTestId('ai-engine').click()
    await page.getByRole('menu', { name: 'AI 引擎' }).getByRole('menuitemradio').filter({ hasText: 'Claude Code' }).click()
    await openAiSettings(page)
    await expect(dialog(page).locator('[data-row="fChat"]')).toContainText('跟默认Claude Code · Opus 5.5')
    await expect(dialog(page).getByTestId('ai-default')).toContainText('Claude Code')
  } finally {
    await run.close()
  }
})

/** 往输入框里粘图：照浏览器的粘贴事件来（不碰这台 Mac 真的剪贴板） */
async function pasteImage(page: Page, selector: string) {
  const png = [...solidPng(40, 30, [200, 80, 60])]
  await page.evaluate(
    ([sel, bytes]) => {
      const el = document.querySelector(sel as string) as HTMLElement
      el.focus()
      const dt = new DataTransfer()
      dt.items.add(new File([new Uint8Array(bytes as number[])], '截图.png', { type: 'image/png' }))
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    },
    [selector, png] as const,
  )
}

test('只贴一张图不打字：发送键能点，回车发出「这张图讲的是什么」带着这张图', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await openPdf(page)
    await pasteImage(page, '.reading-in textarea')
    await expect(ai(page).getByTestId('ai-mat')).toHaveCount(1)
    await expect(box(page)).toHaveValue('①')
    await expect(ai(page).getByRole('button', { name: '发送' })).toBeEnabled()
    await box(page).press('Enter')
    await answered(page, 1)
    await expect(userMsgs(page).last().locator('.mt')).toHaveText('这张图讲的是什么')
    await expect(ai(page).locator('.um-wrap').last().locator('img[alt="粘贴的图"]')).toBeVisible()
    await expect(ai(page).getByTestId('reading-msg').last().locator('.txt')).toContainText('图 1 张')
    await expect(ai(page).getByTestId('ai-mat')).toHaveCount(0)
    // 什么都没有：发送键灰着
    await expect(ai(page).getByRole('button', { name: '发送' })).toBeDisabled()
  } finally {
    await run.close()
  }
})

test('AI 出错的那条头上没有「✓ 读了第几页」，只有红字说为什么', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await openPdf(page)
    await box(page).fill('假装被拦：讲讲这页')
    await box(page).press('Enter')
    const last = ai(page).getByTestId('reading-msg').last()
    await expect(last.getByTestId('ai-error')).toBeVisible({ timeout: 15_000 })
    await expect(last.locator('.read')).toHaveCount(0)
    await expect(last.locator('.ok')).toHaveCount(0)
  } finally {
    await run.close()
  }
})

test('读 PDF 时 ⌘J 收起再 ⌘J 打开 AI：光标在输入框里，直接打字', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await openPdf(page)
    // ⌘J 收起、再 ⌘J 打开：光标在输入框里，直接打字
    await page.locator('.pdfpane:not([hidden]) .pdfpage[data-page="1"]').click({ position: { x: 20, y: 20 } })
    await page.keyboard.press('Meta+j')
    await expect(ai(page)).toHaveCount(0)
    await page.keyboard.press('Meta+j')
    await expect(ai(page)).toBeVisible()
    await expect(box(page)).toBeFocused()
    await page.keyboard.type('接着问')
    await expect(box(page)).toHaveValue('接着问')
  } finally {
    await run.close()
  }
})
