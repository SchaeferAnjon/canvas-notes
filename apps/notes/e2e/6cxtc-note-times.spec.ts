// 右栏「笔记」每一条右边的时间（task-6cxtc，设计稿每条都有「12:47」）：本机记着的优先，没有就用 git 里那一行（块头、剪藏的来源那一行）
// 是哪次提交写的作者时间。别处写的（另一台 Mac、iPad 上写了经 git 同步过来）、清过本机记录的、改过头一行的，现在也有时间。
// 一律无头（CN_E2E=1）、假 AI（CN_AI_FAKE=1）、本机假网页（fixtures/d2l-pandas.ts），不上网。
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { editorText, launch, openNote, pane, rail, webAboveAi, widenRight } from './app'
import { d2l, type D2l, P1, P1_LAST, P2_PART } from './fixtures/d2l-pandas'
import { fragmentUrl } from '../src/shared/web-link'
import { when } from '../src/shared/when'

const NOTE = '课程/学习笔记：动手学深度学习.md'
const TITLE = '学习笔记：动手学深度学习'

let site: D2l
test.beforeAll(async () => {
  site = await d2l()
})
test.afterAll(() => site.close())

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const notesTab = (page: Page) => page.getByRole('complementary', { name: '笔记', exact: true })

function guest<T = unknown>(page: Page, code: string): Promise<T> {
  return page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code) as Promise<T>
}

async function openWeb(page: Page, u: string) {
  if (!(await web(page).isVisible())) await rail(page).getByRole('button', { name: '网页' }).click()
  const addr = web(page).getByRole('textbox', { name: '网址' })
  await addr.click()
  await addr.fill(u)
  await addr.press('Enter')
  await expect.poll(() => guest(page, 'document.readyState + "|" + location.href')).toBe(`complete|${u}`)
}

/** 网页里一处的中心（窗口坐标） */
async function guestPoint(page: Page, code: string) {
  const w = (await web(page).locator('webview.on').boundingBox())!
  const r = await guest<{ x: number; y: number; width: number; height: number }>(page, `(() => { const r = (${code}).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`)
  return { x: w.x + r.x + r.width / 2, y: w.y + r.y + r.height / 2 }
}

/** 在网页的 #id 里用鼠标从 from 拖到 to（真拖，选区是网页自己算的）；选好以后小条出来 */
async function selectIn(page: Page, id: string, from: string, to: string) {
  await guest(page, `document.getElementById(${JSON.stringify(id)}).scrollIntoView({ block: 'center' })`)
  for (let i = 0; i < 3; i++) {
    const w = (await web(page).locator('webview.on').boundingBox())!
    const pts = await guest<number[]>(
      page,
      `(() => {
        const root = document.getElementById(${JSON.stringify(id)})
        const a = ${JSON.stringify(from)}, b = ${JSON.stringify(to)}
        const t = root.firstChild
        const s = t.data.indexOf(a), e = t.data.indexOf(b, s) + b.length
        const r = document.createRange(); r.setStart(t, s); r.setEnd(t, e)
        const rs = r.getClientRects(), f = rs[0], l = rs[rs.length - 1]
        return [f.left + 1, f.top + f.height / 2, l.right - 1, l.top + l.height / 2]
      })()`,
    )
    await page.mouse.move(w.x + pts[0]!, w.y + pts[1]!)
    await page.mouse.down()
    await page.mouse.move(w.x + pts[2]!, w.y + pts[3]!, { steps: 8 })
    await page.mouse.up()
    const want = `${from}…${to}`
    const got = await expect
      .poll(() => guest<string>(page, `(() => { const s = getSelection().toString().replace(/\\s+/g, ' ').trim(); return s.startsWith(${JSON.stringify(from)}) && s.endsWith(${JSON.stringify(to)}) ? ${JSON.stringify(want)} : s })()`), { timeout: 1500 })
      .toBe(want)
      .then(() => true, () => false)
    if (got) break
  }
  await expect.poll(() => guest(page, `document.getElementById('cn-clip-host')?.style.display`)).toBe('block')
}

/** 网页选字小条上点一颗（真点：量它在网页里的位置） */
async function clickBar(page: Page, label: string) {
  const p = await guestPoint(page, `[...document.getElementById('cn-clip-host').shadowRoot.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || b.textContent).trim().startsWith(${JSON.stringify(label)}))`)
  await page.mouse.click(p.x, p.y)
}

test('别处写的几条（git 里有、本机没记）右边也有时间：用那一行所在提交的作者时间，按时间新的在上；这台 Mac 上新问的一条也有时间、排最上面', async () => {
  const pandas = () => site.pandas
  const head = `---\nread-along: ${site.base}/\n---\n# ${TITLE}\n\n## 2.2 数据预处理\n\n先把数据读进来，再处理缺失值。\n`
  const clip = () => `> ${P1}\n—— [2.2.1 读取数据集 · 动手学深度学习](${fragmentUrl(pandas(), P1)})\n`
  const one = (label: string, quote: string, h: string) => `> [!ai] ${label} · Claude Code · Opus 5.5 · [${h} ↩](${fragmentUrl(pandas(), quote)})\n> > ${quote}\n>\n> 回答。\n`
  const explain = () => one('讲解一下', P2_PART, '2.2.2 处理缺失值')
  const asked = () => one('你问：插值法和删除法各适合什么时候？', P2_PART, '2.2.2 处理缺失值')
  // 三次提交（像另一台 Mac 上写的、经 git 同步过来）：在那篇里的先后是 剪藏、讲解一下、你问，写的先后是 你问（最早）、剪藏、讲解一下（最新）
  const now = Date.now()
  const tAsk = now - 30 * 60_000
  const tClip = now - 20 * 60_000
  const tExplain = now - 10 * 60_000
  const run = await launch({ '别的一篇.md': '# 别的一篇\n' }, { CN_AI_FAKE: '1', CN_FAKE_NOTE_MS: '50' }, (vault) => {
    const commit = (text: string, at: number, msg: string) => {
      writeFileSync(join(vault, NOTE), text)
      execFileSync('git', ['-C', vault, 'add', '--', NOTE])
      execFileSync('git', ['-C', vault, 'commit', '-q', `--date=@${Math.floor(at / 1000)}`, '-m', msg])
    }
    mkdirSync(join(vault, '课程'), { recursive: true })
    commit(`${head}\n${asked()}`, tAsk, '另一台 Mac：你问')
    commit(`${head}\n${clip()}\n${asked()}`, tClip, '另一台 Mac：剪藏')
    commit(`${head}\n${clip()}\n${explain()}\n${asked()}`, tExplain, '另一台 Mac：讲解一下')
  })
  const { page } = run
  try {
    await openNote(page, TITLE)
    await widenRight(page, 200)
    await pane(page).locator('.cm-line', { hasText: '先把数据读进来' }).click()
    await page.keyboard.press('End')
    await openWeb(page, site.pandas)
    await rail(page).getByRole('button', { name: /^笔记/ }).click()
    const n = notesTab(page)
    await expect(n).toBeVisible()
    await webAboveAi(page)
    const rows = n.getByTestId('web-note')
    // 本机 localStorage 里没有这三条的时间：时间全从 git 来，按时间新的在上（不是按在那篇里的先后）
    await expect(rows.locator('.t')).toHaveText([`讲解一下「${P2_PART}」`, /^「举一个例子，我们首先创建一个人工数据集/, '插值法和删除法各适合什么时候？'])
    await expect(rows.locator('.wn-at')).toHaveText([when(tExplain), when(tClip), when(tAsk)])
    expect(await page.evaluate(() => localStorage.getItem('cn.webNoteAt'))).toBeNull()

    // 在那篇里打字（这几条没变）：不跑 git blame。数主进程里「git:line-times」被调了几次
    await run.app.evaluate(({ ipcMain }) => {
      const m = (ipcMain as unknown as { _invokeHandlers: Map<string, (...a: unknown[]) => unknown> })._invokeHandlers
      const f = m.get('git:line-times')!
      const g = globalThis as unknown as { lineTimesCalls: number }
      g.lineTimesCalls = 0
      m.set('git:line-times', (...a) => (g.lineTimesCalls++, f(...a)))
    })
    const calls = () => run.app.evaluate(() => (globalThis as unknown as { lineTimesCalls: number }).lineTimesCalls)
    await pane(page).locator('.cm-line', { hasText: '先把数据读进来' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type('边读边记。')
    await expect.poll(() => editorText(page)).toContain('再处理缺失值。边读边记。')
    await page.waitForTimeout(1500)
    expect(await calls()).toBe(0)

    // 这台 Mac 上真点一次「讲解一下」：新写进去的一条有时间（本机记下的），排在最上面
    await selectIn(page, 'p1', '下面我们将', '写入CSV文件中。')
    const clicked = Date.now()
    await clickBar(page, '讲解一下')
    await expect.poll(() => editorText(page), { timeout: 15_000 }).toContain(`[2.2.1 读取数据集 ↩](${fragmentUrl(site.pandas, P1_LAST)})`)
    if (!(await n.isVisible())) await page.getByTestId('dtab-note').click()
    await expect(rows).toHaveCount(4)
    await expect(rows.locator('.t')).toHaveText([`讲解一下「${P1_LAST}」`, `讲解一下「${P2_PART}」`, /^「举一个例子，我们首先创建一个人工数据集/, '插值法和删除法各适合什么时候？'])
    const fresh = await rows.first().locator('.wn-at').textContent()
    expect([when(clicked), when(Date.now())]).toContain(fresh)
    await expect(rows.locator('.wn-at').nth(1)).toHaveText(when(tExplain))
    // 多了一条（key 变了）才重查
    expect(await calls()).toBeGreaterThan(0)
  } finally {
    await run.close()
  }
})
