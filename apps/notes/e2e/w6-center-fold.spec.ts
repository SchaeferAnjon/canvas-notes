// 读网页时收起中间栏、摘录照写（task-kbnc0，用户 2026-11-22：「有时候我在看网页 我想关了左边的……还是想继续做摘录摘录到文档里，哪怕他不显示」）：
// 中间开着书摘，右栏网页在读这本书 → 收起中间栏 → 网页占满 → 在网页上选一段剪下来 → 文件里多了那段、底栏说记进哪篇
// → 展开中间栏，编辑器里看得到；收起的样子记在本机，重开软件还在；左栏点那篇、快捷键（命令表 fold-center）也能展开。
import { expect, test, type Page } from '@playwright/test'
import { readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { editorText, launch, leftView, rail, tabOn, type Running } from './app'
import { fakeBook, type FakeBook } from './fixtures/fake-book'

const NOTE = '阅读/杀死一只知更鸟.md'
const TEXT = '# 杀死一只知更鸟\n\n读到第三章。\n'

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

/** 在网页上选一段，点黑色小条上的「剪进文档」（真点：量小条在网页里的位置） */
async function clipFromPage(page: Page, text: string) {
  await guest(page, `(() => { const p = [...document.querySelectorAll('p')].find((x) => x.textContent.includes(${JSON.stringify(text)})); p.scrollIntoView({ block: 'center' }); const r = document.createRange(); r.selectNodeContents(p); const s = getSelection(); s.removeAllRanges(); s.addRange(r) })()`)
  const at = await expect
    .poll(async () => guest<{ x: number; y: number } | null>(page, `(() => { const h = document.getElementById('cn-clip-host'); if (!h || h.style.display === 'none') return null; const b = h.shadowRoot.querySelector('button.clip').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 } })()`))
    .not.toBeNull()
    .then(() => guest<{ x: number; y: number }>(page, `(() => { const b = document.getElementById('cn-clip-host').shadowRoot.querySelector('button.clip').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 } })()`))
  const wv = (await web(page).locator('webview.on').boundingBox())!
  await page.mouse.click(wv.x + at.x, wv.y + at.y)
}

test('收起中间栏：网页占满，网页上剪一段照样记进中间那篇，底栏说记进哪篇；展开后编辑器里看得到；重开软件还收着；左栏点那篇、快捷键也能展开', async () => {
  test.setTimeout(150_000)
  let run: Running = await launch({ [NOTE]: TEXT })
  const vault = run.vault
  const dirs = [dirname(vault)]
  try {
    let page = run.page
    await openTree(page)
    await rail(page).getByRole('button', { name: '网页', exact: true }).click()
    await addr(page).click()
    await addr(page).fill(`${book.base}/chapter_preface/index.html`)
    await addr(page).press('Enter')
    await expect.poll(() => guest(page, 'location.href')).toBe(`${book.base}/chapter_preface/index.html`)
    const before = (await web(page).boundingBox())!.width
    const mid = (await center(page).boundingBox())!.width

    // 收起中间栏：中间那一栏宽 0、看不见，网页占满（宽了中间那么多）
    await page.getByTestId('center-fold').click()
    await expect(center(page)).toHaveClass(/folded/)
    await expect.poll(async () => Math.round((await web(page).boundingBox())!.width)).toBeGreaterThan(before + mid - 20)
    // 标题栏那颗换成「展开中间栏」
    await expect(page.getByTestId('tb-web')).toHaveAccessibleName('展开中间栏')

    // 网页上选一段剪下来：记进《杀死一只知更鸟》（中间看不见也照写），底栏说一句
    await clipFromPage(page, '这本书想让深度学习平易近人')
    await expect(toast(page)).toContainText('记进《杀死一只知更鸟》')
    await expect.poll(() => readFileSync(join(vault, NOTE), 'utf8'), { timeout: 10_000 }).toContain('这本书想让深度学习平易近人')
    await expect(center(page)).toHaveClass(/folded/)

    // 重开软件：还收着
    const userData = run.userData
    await run.close({ keep: true })
    run = await launch({ 'x.md': '# x\n' }, { CN_VAULT: vault, CN_USER_DATA: userData })
    dirs.push(dirname(run.vault))
    page = run.page
    await expect(web(page)).toBeVisible()
    await expect(center(page)).toHaveClass(/folded/)

    // 标题栏「展开中间栏」：中间那篇回来，编辑器里看得到剪进来的那段
    await page.getByTestId('tb-web').click()
    await expect(center(page)).not.toHaveClass(/folded/)
    await expect.poll(() => editorText(page)).toContain('这本书想让深度学习平易近人')

    // 快捷键（命令表 fold-center，默认 ⌃⌘\）：收起；左栏点那篇：展开
    await page.locator('main.center').click({ position: { x: 200, y: 300 } })
    await page.keyboard.press('Control+Meta+Backslash')
    await expect(center(page)).toHaveClass(/folded/)
    await openTree(page)
    await expect(center(page)).not.toHaveClass(/folded/)
  } finally {
    await run.close({ keep: true })
    for (const d of dirs) rmSync(d, { recursive: true, force: true, maxRetries: 5 })
  }
})
