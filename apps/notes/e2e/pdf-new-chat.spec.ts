// 读 PDF 时右栏「+」新对话（读PDF新建对话）：以前点了只在同一段里记一个时间（下一问前面才插一条「新对话」分隔线），点完看不出变化。
// 现在和 AI 对话那边一样开一段空的；以前那段收进头上对话菜单「之前的对话」，点了切回；配对笔记一个字不动。真点。
import { expect, test, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, tabOn } from './app'
import { LECTURE } from './fixtures/pdf'
import { readingKey } from '../src/main/reading/chats'

const PDF = '课程/线代/第3讲.pdf'
const NOTE = '课程/线代/第3讲 笔记.md'
const SHOTS = '/private/tmp/canvas-notes-visual/107-读PDF新建对话'

const ai = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })
const msgs = (page: Page) => ai(page).getByTestId('reading-msg')
const list = (page: Page) => ai(page).locator('.msgs')
const plus = (page: Page) => ai(page).getByRole('button', { name: '新对话' })
const menu = (page: Page) => ai(page).getByRole('menu', { name: '对话' })
const older = (page: Page) => menu(page).getByTestId('ai-older')
const pdfPage = (page: Page, n: number) => page.locator(`.pdfpane:not([hidden]) .pdfpage[data-page="${n}"]`)
const read = (vault: string, rel: string) => (existsSync(join(vault, rel)) ? readFileSync(join(vault, rel), 'utf8') : '')

async function openPdf(page: Page) {
  await page.keyboard.press('Meta+k')
  await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
  await page.locator('.pal-row', { hasText: '第3讲.pdf' }).first().click()
  await expect(tabOn(page)).toHaveText('第3讲.pdf')
  await expect(pdfPage(page, 1).locator('canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
  await page.keyboard.press('Meta+j')
  await expect(ai(page).getByTestId('reading-sees')).toContainText('读过全文5页')
}

async function ask(page: Page, text: string, n: number) {
  const box = ai(page).getByRole('textbox', { name: '问 AI' })
  await box.fill(text)
  await box.press('Enter')
  await expect(msgs(page)).toHaveCount(n, { timeout: 20_000 })
  await expect(msgs(page).nth(n - 1).getByTestId('reading-ans-acts')).toBeVisible({ timeout: 20_000 })
}

/** 本机存的这份 PDF 的对话记录 */
function stateOf(userData: string, vault: string) {
  const dir = join(userData, 'reading')
  const name = readdirSync(dir).find((f) => f.endsWith('.json') && !f.endsWith('.sessions.json') && readFileSync(join(dir, f), 'utf8').includes('"pdf":"课程/线代/第3讲.pdf"'))
  void vault
  return name ? (JSON.parse(readFileSync(join(dir, name), 'utf8')) as { msgs: { text: string; role: string }[]; older?: { msgs: { text: string; role: string }[] }[] }) : null
}

test('读 PDF 答完点「+」：一段空的新对话；以前那段在对话菜单「之前的对话」里能切回、接着问；配对笔记不动', async () => {
  const run = await launch({ [PDF]: LECTURE }, { CN_AI_FAKE: '1' })
  const { page, vault, userData } = run
  try {
    await openPdf(page)
    // 截图里那样：问完、答完、记进了配对笔记
    await ask(page, '第一段：这一页讲什么', 1)
    await expect(msgs(page).first().getByTestId('ai-noted')).toHaveAttribute('data-state', 'done', { timeout: 20_000 })
    const note = read(vault, NOTE)
    expect(note).toContain('第一段：这一页讲什么')

    // 答完「+」能点；点了是一段空的（打招呼那一句回来），不是同一段里插一条分隔线
    await expect(plus(page)).toBeEnabled()
    await plus(page).click()
    await expect(msgs(page)).toHaveCount(0)
    await expect(ai(page).locator('.msgs.greeting')).toBeVisible()
    await expect(ai(page)).not.toContainText('新对话 ·')
    // 头上对话菜单：「这里」还没问过；「之前的对话」一行，名字是那段第一问，右边「1问 · 时间」
    await ai(page).getByTestId('ai-conv').click()
    await expect(menu(page).getByRole('menuitemradio').first()).toContainText('新对话')
    await expect(menu(page)).toContainText('之前的对话')
    await expect(older(page)).toHaveCount(1)
    await expect(older(page).first()).toContainText('第一段：这一页讲什么')
    await expect(older(page).first()).toHaveAttribute('title', /1问$/)
    mkdirSync(SHOTS, { recursive: true })
    await ai(page).screenshot({ path: join(SHOTS, '1-点加号后-对话菜单.png') })
    await page.keyboard.press('Escape')
    await expect(menu(page)).toHaveCount(0)
    // 配对笔记一个字不动
    expect(read(vault, NOTE)).toBe(note)

    // 新的一段里问一句：只有这一问，记进同一篇笔记（接在后面）
    await ask(page, '第二段：再讲一遍', 1)
    await expect(list(page)).toContainText('第二段：再讲一遍')
    await expect(list(page)).not.toContainText('第一段')
    await expect(msgs(page).first().getByTestId('ai-noted')).toHaveAttribute('data-state', 'done', { timeout: 20_000 })
    const note2 = read(vault, NOTE)
    expect(note2.startsWith(note.trimEnd())).toBe(true)
    expect(note2).toContain('第二段：再讲一遍')

    // 切回第一段：第一段的问答回来、「已记进」照旧；第二段收进「之前的对话」
    await ai(page).getByTestId('ai-conv').click()
    await older(page).filter({ hasText: '第一段' }).click()
    await expect(menu(page)).toHaveCount(0)
    await expect(msgs(page)).toHaveCount(1)
    await expect(list(page)).toContainText('第一段：这一页讲什么')
    await expect(list(page)).not.toContainText('第二段')
    await expect(msgs(page).first().getByTestId('ai-noted')).toHaveAttribute('data-state', 'done')
    await ai(page).getByTestId('ai-conv').click()
    await expect(menu(page).getByRole('menuitemradio').first()).toContainText('1问')
    await expect(older(page)).toHaveCount(1)
    await expect(older(page).first()).toContainText('第二段：再讲一遍')
    await page.keyboard.press('Escape')

    // 切回的那段接着问：接在它后面
    await ask(page, '第一段接着问', 2)
    await expect(list(page)).toContainText('第一段接着问')
    expect(read(vault, NOTE)).toContain('第一段接着问')

    // 存在本机：现在这段两问，之前的对话一段（第二段）
    await expect.poll(() => stateOf(userData, vault)?.msgs.filter((m) => m.role === 'user').map((m) => m.text)).toEqual(['第一段：这一页讲什么', '第一段接着问'])
    expect(stateOf(userData, vault)?.older?.map((c) => c.msgs.filter((m) => m.role === 'user').map((m) => m.text))).toEqual([['第二段：再讲一遍']])
  } finally {
    await run.close()
  }
})

test('旧记录（以前点「+」只记了时间）：读进来时那之前的问答挪成「之前的对话」一段', async () => {
  const run = await launch({ [PDF]: LECTURE }, { CN_AI_FAKE: '1' })
  const { page, vault, userData } = run
  try {
    const t0 = Date.now() - 3600_000
    const msg = (id: number, role: 'user' | 'ai', text: string, time: number) => ({ id, role, thread: '第3讲-p1-1', text, time, page: 1 })
    const dir = join(userData, 'reading')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, `${readingKey(vault, PDF)}.json`),
      JSON.stringify({
        pdf: PDF,
        page: 1,
        threads: [{ id: '第3讲-p1-1', page: 1, createdAt: t0 }],
        msgs: [msg(1, 'user', '旧的那一问', t0), msg(2, 'ai', '旧的回答', t0 + 1000), msg(3, 'user', '点了加号以后问的', t0 + 120_000), msg(4, 'ai', '新的回答', t0 + 121_000)],
        newChatAt: t0 + 60_000,
      }),
    )
    await openPdf(page)
    await expect(msgs(page)).toHaveCount(1)
    await expect(list(page)).toContainText('点了加号以后问的')
    await expect(ai(page)).not.toContainText('旧的那一问')
    await ai(page).getByTestId('ai-conv').click()
    await expect(older(page)).toHaveCount(1)
    await older(page).first().click()
    await expect(msgs(page)).toHaveCount(1)
    await expect(list(page)).toContainText('旧的那一问')
    await expect(list(page)).not.toContainText('点了加号以后问的')
  } finally {
    await run.close()
  }
})
