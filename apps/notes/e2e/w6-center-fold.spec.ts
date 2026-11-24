// 读网页时收起中间栏、摘录照写（task-kbnc0，用户 2026-11-22：「有时候我在看网页 我想关了左边的……还是想继续做摘录摘录到文档里，哪怕他不显示」）：
// 中间开着书摘，右栏网页在读这本书 → 收起中间栏 → 网页占满 → 在网页上选一段剪下来 → 文件里多了那段、底栏说记进哪篇
// → 展开中间栏，编辑器里看得到；收起的样子记在本机，重开软件还在；左栏点那篇、快捷键（命令表 fold-center）也能展开。
// task-6cxtc 起剪藏写进「这个网页正在剪进去的那篇」：书摘和这本书配好对（属性 read-along），中间收起时接在那篇末尾。
// task-05p2w 起「收起中间栏」并进窗口右上角那颗「网页占满 / 还原」，底栏「记进《X》」带「看一眼」（小牌、换一篇、混用见 05p2w-web-full）
// （没配对、中间又看不见文档时照旧剪成卡片进收件箱，那是 step4 白板那条测的）。
import { expect, test, type Page } from '@playwright/test'
import { readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { editorText, launch, leftView, rail, tabOn, type Running } from './app'
import { fakeBook, type FakeBook } from './fixtures/fake-book'

const NOTE = '阅读/杀死一只知更鸟.md'
const BODY = '# 杀死一只知更鸟\n\n读到第三章。\n'

let book: FakeBook
test.beforeAll(async () => {
  book = await fakeBook()
})
test.afterAll(() => book.close())

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const addr = (page: Page) => web(page).getByRole('textbox', { name: '网址' })
const tree = (page: Page) => page.getByRole('tree', { name: '全部文件' })
const toast = (page: Page) => page.getByTestId('toast')
const center = (page: Page) => page.locator('.win > main.center')
const guest = <T = unknown>(page: Page, code: string): Promise<T> =>
  page.evaluate((c) => {
    const w = document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> } | null
    try {
      return w ? w.executeJavaScript(c).catch(() => null) : null
    } catch {
      return null
    }
  }, code) as Promise<T>

async function openTree(page: Page) {
  await leftView(page, '文件')
  const folder = tree(page).getByRole('treeitem').filter({ hasText: /^阅读/ }).first()
  const toggle = folder.getByRole('button', { name: '展开 阅读' })
  if (await toggle.count()) await toggle.click()
  await tree(page).locator(`[data-path="${NOTE}"]`).click()
  await expect(tabOn(page)).toHaveText('杀死一只知更鸟')
}

/** 在网页上选一段，点黑色小条上的「剪藏」（真点：量小条在网页里的位置） */
async function clipFromPage(page: Page, text: string) {
  await guest(page, `(() => { const p = [...document.querySelectorAll('p')].find((x) => x.textContent.includes(${JSON.stringify(text)})); p.scrollIntoView({ block: 'center' }); const r = document.createRange(); r.selectNodeContents(p); const s = getSelection(); s.removeAllRanges(); s.addRange(r) })()`)
  const at = await expect
    .poll(async () => guest<{ x: number; y: number } | null>(page, `(() => { const h = document.getElementById('cn-clip-host'); if (!h || h.style.display === 'none') return null; const b = h.shadowRoot.querySelector('button.clip').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 } })()`))
    .not.toBeNull()
    .then(() => guest<{ x: number; y: number }>(page, `(() => { const b = document.getElementById('cn-clip-host').shadowRoot.querySelector('button.clip').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 } })()`))
  const wv = (await web(page).locator('webview.on').boundingBox())!
  await page.mouse.click(wv.x + at.x, wv.y + at.y)
}

test('网页占满：网页上剪一段照样记进中间那篇，底栏说记进哪篇；展开后编辑器里看得到；重开软件还收着；左栏点那篇、快捷键也能展开', async () => {
  test.setTimeout(150_000)
  const TEXT = `---\nread-along: ${book.base}/\n---\n${BODY}`
  let run: Running = await launch({ [NOTE]: TEXT })
  const vault = run.vault
  const dirs = [dirname(vault)]
  try {
    let page = run.page
    await openTree(page)
    // 配好对的书摘一打开右栏网页就开着：开着就不再点（点了是收起）
    if (!(await web(page).isVisible())) await rail(page).getByRole('button', { name: '网页', exact: true }).click()
    await addr(page).click()
    await addr(page).fill(`${book.base}/chapter_preface/index.html`)
    await addr(page).press('Enter')
    await expect.poll(() => guest(page, 'location.href')).toBe(`${book.base}/chapter_preface/index.html`)
    const before = (await web(page).boundingBox())!.width
    const mid = (await center(page).boundingBox())!.width

    // 网页占满（右上角那颗）：中间那一栏宽 0、看不见，网页占满（宽了中间那么多）
    await page.locator('.dhead:has([data-testid="dtab-web"]) .maxbtn').click()
    await expect(center(page)).toHaveClass(/folded/)
    await expect.poll(async () => Math.round((await web(page).boundingBox())!.width)).toBeGreaterThan(before + mid - 20)
    // 标题栏那颗换成「还原」
    await expect(page.locator('.dhead:has([data-testid="dtab-web"]) .maxbtn')).toHaveAccessibleName('还原')

    // 网页上选一段剪下来：记进配好对的《杀死一只知更鸟》（中间看不见也照写，接在末尾、不问记到哪篇），底栏说一句
    await clipFromPage(page, '这本书想让深度学习平易近人')
    await expect(toast(page)).toContainText('记进《杀死一只知更鸟》')
    await expect(toast(page).getByRole('button', { name: '撤回' })).toBeVisible()
    await expect(page.getByRole('dialog', { name: '记到哪篇' })).toHaveCount(0)
    await expect.poll(() => readFileSync(join(vault, NOTE), 'utf8'), { timeout: 10_000 }).toContain('这本书想让深度学习平易近人')
    // 原来的字一个没动，剪的那段（引文 + 来源一行）接在后面
    const saved = readFileSync(join(vault, NOTE), 'utf8')
    expect(saved.startsWith(TEXT)).toBe(true)
    expect(saved.slice(TEXT.length)).toMatch(/^\n?> [^\n]*这本书想让深度学习平易近人[^\n]*\n—— \[[^\]]+\]\(http:\/\/127\.0\.0\.1:\d+\/chapter_preface\/index\.html#:~:text=[^)]+\)\n*$/)
    await expect(center(page)).toHaveClass(/folded/)

    // 重开软件：还收着
    const userData = run.userData
    await run.close({ keep: true })
    run = await launch({ 'x.md': '# x\n' }, { CN_VAULT: vault, CN_USER_DATA: userData })
    dirs.push(dirname(run.vault))
    page = run.page
    await expect(web(page)).toBeVisible()
    await expect(center(page)).toHaveClass(/folded/)

    // 标题栏「还原」：中间那篇回来，编辑器里看得到剪进来的那段
    await page.locator('.dhead:has([data-testid="dtab-web"]) .maxbtn').click()
    await expect(center(page)).not.toHaveClass(/folded/)
    await expect.poll(() => editorText(page)).toContain('这本书想让深度学习平易近人')

    // 快捷键（命令表 fold-center，默认 ⌃⌘\）：焦点在网页那一组时收起；占满盖住左栏（每一栏都能占满），点顶上提示展开
    await page.getByTestId('dtab-web').click()
    await page.keyboard.press('Control+Meta+Backslash')
    await expect(center(page)).toHaveClass(/folded/)
    await page.getByTestId('max-hint').click()
    await expect(center(page)).not.toHaveClass(/folded/)
  } finally {
    await run.close({ keep: true })
    for (const d of dirs) rmSync(d, { recursive: true, force: true, maxRetries: 5 })
  }
})
