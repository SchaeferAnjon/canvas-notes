// 微信读书（第三个内置插件，2026-11-16）：右栏读微信读书，用它自带的划线；划的那一段自动插进左边开着的文档（引文 + 书名章节 + 回到微信读书的链接），
// 右下角一行「已加到《…》」；每本书的划线和想法同步进「素材/微信读书/<书名>.md」；设置 › 插件 里开关、同步状态、上次同步时间、现在同步。
// 微信读书是本机假的（e2e/fixtures/fake-weread.ts：阅读页 + 接口），不碰用户真的账号。
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { editorText, launch, openNote, pane, rail, type Running, waitSaved } from './app'
import { BOOK, type FakeWeread, OTHER, PARAS, startFakeWeread } from './fixtures/fake-weread'

let fake: FakeWeread

test.beforeAll(async () => {
  fake = await startFakeWeread()
})
test.afterAll(() => fake.server.close())
test.beforeEach(() => {
  fake.loggedOut = false
  for (const [id, list] of fake.marks) fake.marks.set(id, list.slice(0, 1))
})

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const env = () => ({ CN_WEREAD_ORIGIN: fake.base, CN_WEREAD_API: fake.base })
const read = (vault: string, f: string) => readFileSync(join(vault, f), 'utf8')
const bookPath = `素材/微信读书/${BOOK.title}.md`
const commits = (vault: string) => execFileSync('git', ['-C', vault, 'log', '--format=%s'], { encoding: 'utf8' }).trim().split('\n')

function guest(page: Page, code: string): Promise<unknown> {
  return page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code)
}

async function shot(run: Running, name: string) {
  const dir = process.env.CN_SHOTS
  if (!dir) return
  await run.page.waitForTimeout(250)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(dir, `${name}.png`), Buffer.from(b64, 'base64'))
}

async function openReader(page: Page) {
  await rail(page).getByRole('button', { name: '网页' }).click()
  const addr = web(page).getByRole('textbox', { name: '网址' })
  await addr.fill(`${fake.base}/web/reader/ce032b305a9bc1ce0b0dd2a`)
  await addr.press('Enter')
  await expect.poll(() => guest(page, 'document.readyState')).toBe('complete')
}

/** 在阅读页里选中第 i 段的一部分，再点微信读书自己的「划线」（真的鼠标拖选、真的点） */
async function highlight(page: Page, i: number, chars: number) {
  const wv = (await web(page).locator('webview.on').boundingBox())!
  const r = JSON.parse(String(await guest(page, `(() => { const p = document.getElementById('p${i}'); const range = document.createRange(); range.setStart(p.firstChild, 0); range.setEnd(p.firstChild, ${chars}); const a = range.getClientRects()[0]; const rs = range.getClientRects(); const b = rs[rs.length - 1]; return JSON.stringify({ x0: a.left + 1, y0: a.top + a.height / 2, x1: b.right - 1, y1: b.top + b.height / 2 }) })()`))) as { x0: number; y0: number; x1: number; y1: number }
  // 右栏刚打开时第一下拖选有时落空：拖完看一眼选中了没有，没有就再拖
  for (let k = 0; k < 3; k++) {
    await page.mouse.move(wv.x + r.x0, wv.y + r.y0)
    await page.mouse.down()
    await page.mouse.move(wv.x + r.x1, wv.y + r.y1, { steps: 8 })
    await page.mouse.up()
    if (String(await guest(page, 'String(getSelection())')).trim()) break
    await page.waitForTimeout(300)
  }
  expect(String(await guest(page, 'String(getSelection())')).trim().length).toBeGreaterThan(0)
  const btn = JSON.parse(String(await guest(page, `JSON.stringify(document.getElementById('mark').getBoundingClientRect())`))) as { x: number; y: number; width: number; height: number }
  const sent = () => fake.requests.filter((u) => u.startsWith('/web/book/addBookmark')).length
  const before = sent()
  await page.mouse.click(wv.x + btn.x + btn.width / 2, wv.y + btn.y + btn.height / 2)
  // 先确认「划线」真的发出去了（没发出去是点的这一步的事，不是我们插段落的事）
  await expect.poll(sent, { message: `第 ${i} 段的「划线」请求没发到微信读书` }).toBe(before + 1)
}

test('左边开着文档：微信读书里划一段，自动插到文档光标处（引文、书名章节、回到微信读书的链接），右下角一行提示；这本书同步进素材', async () => {
  const run = await launch({ '思考快与慢 读书笔记.md': '# 思考快与慢 读书笔记\n\n我的感想：\n' }, env())
  const { page, vault } = run
  try {
    await openNote(page, '思考快与慢 读书笔记')
    await pane(page).locator('.cm-content').click()
    await page.keyboard.press('Meta+End')
    await openReader(page)
    // 打开这本书：原来的划线只记下，不插；同步进素材（带想法）
    // 文件刚建出来时可能还没写完（先建空文件再写），等到内容齐了再读
    await expect.poll(() => (existsSync(join(vault, bookPath)) ? read(vault, bookPath) : ''), { timeout: 10_000 }).toContain(`bookId: ${BOOK.bookId}`)
    const first = read(vault, bookPath)
    expect(first).toContain(`> ${PARAS[0]}`)
    expect(first).toContain('想法：系统 1 就是直觉。')
    expect(first).toContain(`bookId: ${BOOK.bookId}`)
    expect(await editorText(page)).not.toContain('> ')
    // 用微信读书自带的划线划一段
    await highlight(page, 1, 20)
    const quote = PARAS[1]!.slice(0, 20)
    await expect(page.locator('#wr-toast')).toHaveText('已加到《思考快与慢 读书笔记》')
    await expect(page.locator('#wr-toast')).toHaveClass(/\bon\b/)
    await waitSaved(page)
    const md = await editorText(page)
    expect(md).toContain(`> ${quote}\n—— [《${BOOK.title}》 · 第1章 两个系统](${fake.base}/web/reader/ce032b305a9bc1ce0b0dd2a)`)
    await shot(run, 'weread-doc')
    // 素材里也有了这一段，一本书一次提交
    await expect.poll(() => read(vault, bookPath)).toContain(`> ${quote}`)
    // 写完素材才提交，提交要一会儿
    await expect.poll(() => commits(vault)).toContain(`微信读书：同步《${BOOK.title}》2 条划线`)
    // 再划一段：接着插在后面，前一段不重复。
    // 拦划线请求那条路没拦到时，靠网页里松开鼠标 1.5 秒后再去取，机器忙时 5 秒不够，多等一会儿
    await highlight(page, 2, 12)
    await expect
      .poll(async () => (await editorText(page)).split('—— [《').length - 1, { message: '第二段划线没插进文档', timeout: 15_000 })
      .toBe(2)
  } finally {
    await run.close()
  }
})

test('左边没开文档：不插，右下角说这一段在素材里；设置里关掉「划线插进左边开着的文档」后也不插', async () => {
  const run = await launch({ 'a.md': '# a\n' }, env())
  const { page, vault } = run
  try {
    await openReader(page)
    await expect.poll(() => existsSync(join(vault, bookPath)), { timeout: 10_000 }).toBe(true)
    await highlight(page, 1, 10)
    await expect(page.locator('#wr-toast')).toHaveText(`左边没开文档：这一段在「素材/微信读书/${BOOK.title}」里`)
    await expect.poll(() => read(vault, bookPath)).toContain(`> ${PARAS[1]!.slice(0, 10)}`)
    // 设置 › 插件：关掉插入
    await page.keyboard.press('Meta+,')
    await page.getByRole('button', { name: '插件' }).click()
    const sec = page.getByRole('region', { name: '微信读书' })
    await sec.getByRole('switch', { name: '划线插进左边开着的文档' }).click()
    await expect(sec.getByRole('switch', { name: '划线插进左边开着的文档' })).toHaveAttribute('aria-checked', 'false')
    await page.keyboard.press('Meta+,')
    await openNote(page, 'a')
    await web(page).getByRole('button', { name: '收起网页' }).click()
    await rail(page).getByRole('button', { name: '网页' }).click()
    await highlight(page, 2, 8)
    await expect.poll(() => read(vault, bookPath)).toContain(`> ${PARAS[2]!.slice(0, 8)}`)
    expect(await editorText(page)).not.toContain('—— [《')
  } finally {
    await run.close()
  }
})

test('深色：划一段插进文档，右下角提示', async () => {
  const run = await launch({ '读书笔记.md': '# 读书笔记\n\n' }, env(), (v) => {
    const ud = join(v, '..', 'user-data')
    mkdirSync(ud, { recursive: true })
    writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: 'pine' } }))
  })
  const { page, vault } = run
  try {
    await openNote(page, '读书笔记')
    await pane(page).locator('.cm-content').click()
    await page.keyboard.press('Meta+End')
    await openReader(page)
    await expect.poll(() => existsSync(join(vault, bookPath)), { timeout: 10_000 }).toBe(true)
    await highlight(page, 0, 18)
    await expect(page.locator('#wr-toast')).toHaveText('已加到《读书笔记》')
    await pane(page).locator('.cm-content').press('Meta+Home')
    await shot(run, 'weread-doc-dark')
  } finally {
    await run.close()
  }
})

test('设置 › 插件 › 微信读书：同步状态、上次同步时间；「现在同步」把有笔记的书都同步进素材；没登录时说怎么办', async () => {
  const run = await launch({ 'a.md': '# a\n' }, env())
  const { page, vault } = run
  try {
    await page.keyboard.press('Meta+,')
    await page.getByRole('button', { name: '插件' }).click()
    const sec = page.getByRole('region', { name: '微信读书' })
    await expect(sec).toContainText('还没同步过')
    await sec.getByRole('button', { name: '现在同步' }).click()
    await expect(sec.getByLabel('同步状态')).toContainText('已同步 2 本书、2 条划线 · 上次 今天')
    expect(read(vault, `素材/微信读书/${OTHER.title}.md`)).toContain('> 杰出不是天生的。')
    expect(read(vault, bookPath)).toContain(`> ${PARAS[0]}`)
    await shot(run, 'weread-settings')
    fake.loggedOut = true
    await sec.getByRole('button', { name: '现在同步' }).click()
    await expect(sec.getByLabel('同步状态')).toContainText('没登录微信读书')
  } finally {
    await run.close()
  }
})
