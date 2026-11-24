// 选中小条能自定义（task-26nz7，方案 /private/tmp/canvas-notes-visual/21-选中小条自定义/，偏好「选中小条能自定义」「选中小条默认都弹」）：
// - 原型那条路：网页上拖选 → ⋯ →「加一颗…」→ 点例子「用高中生能懂的话讲」→ 设键（先按和「引用」撞的 ⌘↵，说撞了；再按 ⌥G）→ 存好 →
//   再选一段，条上多了它（竖线前、描一圈强调色）→ 点它、按 ⌥G，答案写进笔记（带框带标志，块头是那颗的名字）；命令.json 只多了该多的；
// - 设置 › 选中小条：从 ⋯ 加的那颗看得到、能改（名字、提示词）；拖着排、第 6 颗被拦、去掉勾再撤回、从我的命令里挑、删一条；
// - × 的右键「这个网站不弹」：再选字不弹，↵ 照样讲解；名单记进库里；
// - 文档里选了字的右键菜单最上面是勾了「文档」的几颗，点了在下面长出那颗的 AI 块；PDF 上的工具条也有它。
// 一律无头（CN_E2E=1）、假 AI（CN_AI_FAKE=1）、本机假网页（fixtures/d2l-pandas.ts），不上网。
import { expect, test, type Page } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { editorText, launch, openNote, pane, rail, type Running, tabOn, waitSaved, widenRight } from './app'
import { armMenus, menuLabels, openedMenu, pickMenu } from './menu'
import { d2l, type D2l } from './fixtures/d2l-pandas'
import { LECTURE } from './fixtures/pdf'

const NOTE = '课程/学习笔记：动手学深度学习.md'
const TITLE = '学习笔记：动手学深度学习'
const noteMd = (vault: string) => (existsSync(join(vault, NOTE)) ? readFileSync(join(vault, NOTE), 'utf8') : '')
const CMDS = '.canvas-notes/命令.json'
const PDF = '课程/线代/第3讲.pdf'

let site: D2l
test.beforeAll(async () => {
  site = await d2l()
})
test.afterAll(() => site.close())

const BODY = `# ${TITLE}\n\n## 2.2 数据预处理\n\n先把数据读进来，再处理缺失值。\n\n我的理解：先造一个小表，后面几节都拿它练。\n`
const paired = () => `---\nread-along: ${site.base}/\n---\n${BODY}`

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const reading = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })
const dlg = (page: Page) => page.getByRole('dialog', { name: '设置' })
const toast = (page: Page) => dlg(page).getByTestId('settings-toast')
const keyBtn = (page: Page) => dlg(page).getByRole('group', { name: '自定义一颗' }).getByRole('button', { name: '快捷键' })
const list = (page: Page) => dlg(page).getByRole('group', { name: '按钮' })
const zone = (page: Page, name: '条上' | '收进 ⋯' | '不出现') => list(page).getByRole('list', { name, exact: true })
const rowsOf = (page: Page, name: '条上' | '收进 ⋯' | '不出现') => zone(page, name).getByRole('listitem').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
const cmdsOnDisk = (vault: string) => JSON.parse(readFileSync(join(vault, CMDS), 'utf8')) as Record<string, unknown> & { own: { id: string; name: string; prompt?: string; out?: string; where: string[] }[]; bar: { on: string[]; more: string[]; off: string[]; enabled: boolean; offSites?: { site: string }[] }; keys?: Record<string, string> }

function guest<T = unknown>(page: Page, code: string): Promise<T> {
  return page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code) as Promise<T>
}
const wcId = (page: Page) => page.evaluate(() => (document.querySelector('.right.web webview.on') as unknown as { getWebContentsId(): number }).getWebContentsId())

/** 网页里按键：从主进程往网页送真的按键（走网页预加载的监听） */
async function pressInPage(run: Running, key: string, modifiers: ('alt' | 'meta' | 'shift')[] = []) {
  await run.app.evaluate(
    ({ webContents }, [id, k, mods]) => {
      const wc = webContents.fromId(id as number)!
      wc.sendInputEvent({ type: 'keyDown', keyCode: k as string, modifiers: mods as ('alt' | 'meta' | 'shift')[] })
      if (k === 'Return') wc.sendInputEvent({ type: 'char', keyCode: '\r', modifiers: mods as ('alt' | 'meta' | 'shift')[] })
      wc.sendInputEvent({ type: 'keyUp', keyCode: k as string, modifiers: mods as ('alt' | 'meta' | 'shift')[] })
    },
    [await wcId(run.page), key, modifiers] as const,
  )
}

async function openWeb(page: Page, u: string) {
  if (!(await web(page).isVisible())) await rail(page).getByRole('button', { name: '网页' }).click()
  const addr = web(page).getByRole('textbox', { name: '网址' })
  await addr.click()
  await addr.fill(u)
  await addr.press('Enter')
  await expect.poll(() => guest(page, 'document.readyState + "|" + location.href')).toBe(`complete|${u}`)
}

async function guestPoint(page: Page, code: string) {
  const w = (await web(page).locator('webview.on').boundingBox())!
  const r = await guest<{ x: number; y: number; width: number; height: number }>(page, `(() => { const r = (${code}).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`)
  return { x: w.x + r.x + r.width / 2, y: w.y + r.y + r.height / 2 }
}

const hostShown = (page: Page) => guest<string | undefined>(page, `document.getElementById('cn-clip-host')?.style.display`)

/** 在网页的 #id 里用鼠标从 from 拖到 to（真拖）；shown：等小条出来 */
async function selectIn(page: Page, id: string, from: string, to: string, shown = true) {
  await guest(page, `document.getElementById(${JSON.stringify(id)}).scrollIntoView({ block: 'center' })`)
  for (let i = 0; i < 3; i++) {
    const w = (await web(page).locator('webview.on').boundingBox())!
    const pts = await guest<number[]>(
      page,
      `(() => {
        const t = document.getElementById(${JSON.stringify(id)}).firstChild
        const a = ${JSON.stringify(from)}, b = ${JSON.stringify(to)}
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
    const ok = await expect
      .poll(() => guest<boolean>(page, `(() => { const s = getSelection().toString().replace(/\\s+/g, ' ').trim(); return s.startsWith(${JSON.stringify(from)}) && s.endsWith(${JSON.stringify(to)}) })()`), { timeout: 1500 })
      .toBe(true)
      .then(() => true, () => false)
    if (ok) break
  }
  if (shown) await expect.poll(() => hostShown(page)).toBe('block')
}

/** 小条上的几颗（字和键帽；⋯、× 是空串） */
const barTexts = (page: Page) => guest<string[]>(page, `[...document.getElementById('cn-clip-host').shadowRoot.querySelectorAll('.bar > button, .bar > .sep')].map((b) => b.classList.contains('sep') ? '|' : b.textContent.replace(/\\s+/g, ' ').trim())`)
async function clickBar(page: Page, label: string, opts: { button?: 'left' | 'right' } = {}) {
  const p = await guestPoint(page, `[...document.getElementById('cn-clip-host').shadowRoot.querySelectorAll('.bar > button')].find((b) => (b.getAttribute('aria-label') || b.textContent).trim().startsWith(${JSON.stringify(label)}))`)
  await page.mouse.click(p.x, p.y, opts)
}
const menuTexts = (page: Page, which: 'more-menu' | 'x-menu') =>
  guest<string[]>(page, `[...document.getElementById('cn-clip-host').shadowRoot.querySelectorAll('.${which} [role=menuitem], .${which} .note')].map((b) => b.textContent.replace(/\\s+/g, ' ').trim())`)
async function clickMenu(page: Page, which: 'more-menu' | 'x-menu', label: string) {
  const p = await guestPoint(page, `[...document.getElementById('cn-clip-host').shadowRoot.querySelectorAll('.${which} [role=menuitem]')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(label)}))`)
  await page.mouse.click(p.x, p.y)
}

/** 设置里真拖一行：按住那一行，挪到另一行的上半截（before）或某一段的末尾 */
async function dragRow(page: Page, name: string, to: { before: string } | { zoneEnd: '条上' | '收进 ⋯' | '不出现' }) {
  const row = list(page).getByRole('listitem', { name, exact: true })
  const a = (await row.boundingBox())!
  let y: number
  if ('before' in to) {
    const b = (await list(page).getByRole('listitem', { name: to.before, exact: true }).boundingBox())!
    y = b.y + 6
  } else {
    const z = (await zone(page, to.zoneEnd).boundingBox())!
    y = z.y + z.height - 4
  }
  await page.mouse.move(a.x + 20, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + 20, a.y + a.height / 2 + 8, { steps: 2 })
  await page.mouse.move(a.x + 20, y, { steps: 10 })
  await page.mouse.up()
}

test('原型那条路：网页上拖选 → ⋯ →「加一颗…」→ 例子「用高中生能懂的话讲」→ 键撞了「引用」说一句、换 ⌥G → 存好；再选一段条上多了它，点它、按 ⌥G 答案写进笔记；命令.json 只多了该多的', async () => {
  const run = await launch({ [NOTE]: paired() }, { CN_AI_FAKE: '1', CN_FAKE_NOTE_MS: '50' })
  const { page, vault } = run
  try {
    await openNote(page, TITLE)
    await widenRight(page, 260)
    await pane(page).locator('.cm-line', { hasText: '先把数据读进来' }).click()
    await page.keyboard.press('End')
    await openWeb(page, site.pandas)
    await selectIn(page, 'p1', '举一个例子', '写入CSV文件中。')
    // 默认的小条：讲解一下 ↵ · 翻译 + 讲一讲 · 引用 ⌘↵ ｜ 剪藏 ⌘S ｜ ⋯ ×
    expect(await barTexts(page)).toEqual(['讲解一下↵', '翻译 + 讲一讲', '引用⌘↵', '|', '剪藏⌘S', '|', '', ''])
    await clickBar(page, '更多')
    await expect.poll(() => menuTexts(page, 'more-menu')).toEqual(['只看译文不进对话', '拷贝⌘C', '翻译设置…', `剪到哪篇…${TITLE}`, '加一颗…拿这段试', '小条设置…'])
    await clickMenu(page, 'more-menu', '加一颗…')

    // 设置 › 选中小条 的编辑页：拿刚选的那段举例
    await expect(dlg(page)).toBeVisible()
    await expect(dlg(page).getByText('从网页小条的 ⋯ 来的：拿你刚选的那段举例')).toBeVisible()
    await dlg(page).getByRole('button', { name: '用高中生能懂的话讲' }).click()
    await expect(dlg(page).getByRole('textbox', { name: '名字' })).toHaveValue('用高中生能懂的话讲')
    await expect(dlg(page).getByTestId('selbar-sample')).toContainText('用高中生能听懂的话讲举一个例子，我们首先创建一个人工数据集')
    // 设键：先按 ⌘↵（和「引用」撞了），再换 ⌥G
    await keyBtn(page).click()
    await expect(keyBtn(page)).toHaveText('按下新键…')
    await page.keyboard.press('Meta+Enter')
    await expect(dlg(page).getByRole('status').filter({ hasText: '撞了' })).toContainText('和「引用」撞了')
    await expect(dlg(page).getByRole('button', { name: '换给这一条' })).toBeVisible()
    await keyBtn(page).click()
    await page.keyboard.press('Alt+g')
    await expect(keyBtn(page)).toHaveText('⌥G')
    await expect(dlg(page).getByText('撞了')).toHaveCount(0)
    await dlg(page).getByRole('button', { name: /^存好/ }).click()
    await expect(toast(page)).toContainText('已存 · 「用高中生能懂的话讲」放上了条上，回网页再选一段试试')
    // 设置里看得到它：条上第 5 颗，标「我的」
    expect(await rowsOf(page, '条上')).toEqual(['讲解一下', '翻译 + 讲一讲', '引用', '剪藏', '用高中生能懂的话讲'])
    await expect(list(page).getByRole('listitem', { name: '用高中生能懂的话讲' })).toContainText('我的')
    await expect(list(page).getByRole('listitem', { name: '用高中生能懂的话讲' })).toContainText('四处都有')
    await page.keyboard.press('Escape')
    await expect(dlg(page)).toBeHidden()

    // 读盘：命令.json 里多了这条命令、它在条上、它的键；别的不动
    const file = cmdsOnDisk(vault)
    const own = file.own.find((o) => o.name === '用高中生能懂的话讲')!
    expect(own).toMatchObject({ kind: 'ai', out: 'note', where: ['web', 'pdf', 'html', 'doc'], prompt: '用高中生能听懂的话讲{选中的字}：先一句话说它在干什么，再举一个生活里的例子。不用术语，非用不可就先解释。' })
    expect(file.bar.on).toEqual(['explain', 'translate', 'quote', 'clip', own.id])
    expect(file.keys).toEqual({ [own.id]: '⌥G' })
    expect(Object.keys(file).sort()).toEqual(['bar', 'groups', 'homes', 'keys', 'own', 'version'])

    // 再选一段：条上多了它（竖线前、带键帽、描一圈强调色）
    await selectIn(page, 'p2', '注意', '缺失值。')
    expect(await barTexts(page)).toEqual(['讲解一下↵', '翻译 + 讲一讲', '引用⌘↵', '用高中生能懂的话讲⌥G', '|', '剪藏⌘S', '|', '', ''])
    expect(await guest(page, `document.getElementById('cn-clip-host').shadowRoot.querySelector('.bar button.new')?.textContent.trim()`)).toBe('用高中生能懂的话讲⌥G')
    await clickBar(page, '用高中生能懂的话讲')
    // 写进剪藏那篇本身（2026-11-24 AI 对话记笔记开关）：小标题写那颗的名字（不写一长段提示词），选的那段带回到网页的链接
    await expect.poll(() => noteMd(vault), { timeout: 15_000 }).toMatch(/\n### 用高中生能懂的话讲\n\n> 注意，“NaN”项代表缺失值。[^\n]*\n> —— \[[^\n]+\n\n> \[!ai\] AI 回答 · Claude Code · [^\n]+\n> 这是讲解/)
    await expect(reading(page).getByTestId('ai-noted').last()).toContainText(`已记进《${TITLE}》`)
    await expect(reading(page).locator('.um').last()).toContainText('用高中生能听懂的话讲注意，“NaN”项代表缺失值。')
    // 第二次不再描圈；按 ⌥G 也一样写进去（右栏和「讲解一下」一样换到了 AI，点回网页）
    await rail(page).getByRole('button', { name: '网页' }).click()
    await selectIn(page, 'p1', '举一个例子', '写入CSV文件中。')
    expect(await guest(page, `document.getElementById('cn-clip-host').shadowRoot.querySelectorAll('.bar button.new').length`)).toBe(0)
    await pressInPage(run, 'G', ['alt'])
    await expect.poll(async () => noteMd(vault).split('### 用高中生能懂的话讲').length - 1, { timeout: 15_000 }).toBe(2)
    await waitSaved(page)
    expect(noteMd(vault)).not.toContain('AI 笔记')
  } finally {
    await run.close()
  }
})

/** 库里已经有的：一条「存成命令」存的（还没放上小条），一条已经收进 ⋯ 的 */
const seeded = () =>
  JSON.stringify({
    version: 1,
    own: [
      { id: 'own-tidy', name: '整理成通顺笔记', kind: 'ai', target: '1. 把这篇整理成通顺的笔记', rules: [{ t: '把这篇整理成通顺的笔记' }], where: ['doc'], write: 'inplace', desc: '把这篇整理成通顺的笔记，每次先给你看' },
      { id: 'own-et', name: '查这个词的词源', kind: 'ai', target: '1. 说说{选中的字}这个词是怎么来的', rules: [{ t: '说说{选中的字}这个词是怎么来的' }], prompt: '说说{选中的字}这个词是怎么来的', out: 'answer', where: ['web', 'pdf', 'doc'], write: 'answer', desc: '说说这个词是怎么来的' },
    ],
    bar: { on: ['explain', 'translate', 'quote', 'clip'], more: ['only', 'own-et', 'copy'], off: [], enabled: true },
  }) + '\n'

async function openBarSettings(page: Page) {
  await page.keyboard.press('Meta+,')
  await expect(dlg(page)).toBeVisible()
  await dlg(page).getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: '选中小条' }).click()
  await expect(list(page)).toBeVisible()
}

test('设置 › 选中小条：自己的那颗看得到、能改；拖着排；第 6 颗被拦；去掉勾再撤回；从我的命令里挑；删一条', async () => {
  const run = await launch({ [NOTE]: paired(), [CMDS]: seeded() }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await openNote(page, TITLE)
    await openBarSettings(page)
    expect(await rowsOf(page, '条上')).toEqual(['讲解一下', '翻译 + 讲一讲', '引用', '剪藏'])
    expect(await rowsOf(page, '收进 ⋯')).toEqual(['只看译文', '查这个词的词源', '拷贝'])
    await expect(list(page)).toContainText('4 / 5颗')
    // 预览：文档那格是右键菜单，最上面是勾了「文档」的那颗
    await dlg(page).getByTestId('selbar-preview').getByRole('radio', { name: '文档' }).click()
    await expect(dlg(page).getByRole('menu', { name: '文档里选了字的右键菜单' })).toContainText('查这个词的词源')

    // 自己的那颗能改：名字、提示词
    await list(page).getByRole('listitem', { name: '查这个词的词源' }).getByRole('button', { name: '这一颗还能…' }).click()
    await dlg(page).getByRole('menuitem', { name: '编辑…' }).click()
    await expect(dlg(page).getByRole('textbox', { name: '提示词' })).toHaveValue('说说{选中的字}这个词是怎么来的')
    await dlg(page).getByRole('textbox', { name: '名字' }).fill('查词源')
    await dlg(page).getByRole('textbox', { name: '提示词' }).fill('三句话说说{选中的字}的词源')
    await dlg(page).getByRole('button', { name: /^存好/ }).click()
    await expect(toast(page)).toContainText('「查词源」收进了 ⋯')
    expect(await rowsOf(page, '收进 ⋯')).toEqual(['只看译文', '查词源', '拷贝'])
    await expect.poll(() => cmdsOnDisk(vault).own.find((o) => o.id === 'own-et')).toMatchObject({ name: '查词源', prompt: '三句话说说{选中的字}的词源' })

    // 拖着排：「拷贝」拖到条上「翻译 + 讲一讲」前面
    await dragRow(page, '拷贝', { before: '翻译 + 讲一讲' })
    await expect(toast(page)).toContainText('「拷贝」在条上第 2 颗')
    expect(await rowsOf(page, '条上')).toEqual(['讲解一下', '拷贝', '翻译 + 讲一讲', '引用', '剪藏'])
    await expect(list(page)).toContainText('5 / 5颗')
    // 第 6 颗被拦：描红、说一句，松手回原处
    await dragRow(page, '只看译文', { before: '引用' })
    await expect(list(page).getByText('条上最多 5颗：先把一颗拖下去')).toBeVisible()
    await expect(zone(page, '条上')).toHaveClass(/deny/)
    expect(await rowsOf(page, '条上')).toEqual(['讲解一下', '拷贝', '翻译 + 讲一讲', '引用', '剪藏'])
    expect(await rowsOf(page, '收进 ⋯')).toEqual(['只看译文', '查词源'])
    // 一会儿就退掉，不一直描红
    await expect(zone(page, '条上')).not.toHaveClass(/deny/, { timeout: 4000 })
    await expect(list(page).getByText('条上最多 5颗：先把一颗拖下去')).not.toHaveClass(/show/)
    // ⋯ 菜单里的「放上条」灰着、写「满了」
    await list(page).getByRole('listitem', { name: '只看译文' }).getByRole('button', { name: '这一颗还能…' }).click()
    await expect(dlg(page).getByRole('menuitem', { name: /放上条/ })).toContainText('满了')
    await page.keyboard.press('Escape')

    // 去掉勾：掉进「不出现」；撤回又回来
    await list(page).getByRole('listitem', { name: '翻译 + 讲一讲' }).getByRole('checkbox').click()
    await expect(toast(page)).toContainText('「翻译 + 讲一讲」不出现了')
    expect(await rowsOf(page, '不出现')).toEqual(['翻译 + 讲一讲'])
    await toast(page).getByRole('button', { name: '撤回' }).click()
    await expect.poll(() => rowsOf(page, '条上')).toEqual(['讲解一下', '拷贝', '翻译 + 讲一讲', '引用', '剪藏'])
    await expect.poll(() => cmdsOnDisk(vault).bar.off).toEqual([])

    // 从我的命令里挑：条上满了进 ⋯；放上以后网页、PDF、HTML、文档都有它
    await dlg(page).getByRole('button', { name: '从我的命令里挑…' }).click()
    const pick = dlg(page).getByRole('menu', { name: '从我的命令里挑' })
    await expect(pick).toContainText('已在 ⋯ 里')
    await expect(pick).toContainText('存在库里 · 文档')
    await pick.getByRole('button', { name: '放上小条' }).click()
    await expect(toast(page)).toContainText('「整理成通顺笔记」放上了⋯ 里')
    expect(await rowsOf(page, '收进 ⋯')).toEqual(['只看译文', '查词源', '整理成通顺笔记'])
    await expect.poll(() => cmdsOnDisk(vault).own.find((o) => o.id === 'own-tidy')?.where).toEqual(['doc', 'web', 'pdf', 'html'])

    // 删一条：表里、命令.json 里都没了
    await list(page).getByRole('listitem', { name: '查词源' }).getByRole('button', { name: '这一颗还能…' }).click()
    await dlg(page).getByRole('menuitem', { name: '删掉这条命令' }).click()
    await expect(toast(page)).toContainText('已删掉「查词源」')
    expect(await rowsOf(page, '收进 ⋯')).toEqual(['只看译文', '整理成通顺笔记'])
    await expect.poll(() => cmdsOnDisk(vault).own.map((o) => o.id)).toEqual(['own-tidy'])
    expect(cmdsOnDisk(vault).bar.more).toEqual(['only', 'own-tidy'])
  } finally {
    await run.close()
  }
})

test('× 点一下只是收起；右键「这个网站不弹」以后再选字不弹，↵ 照样讲解；名单记进库里，设置里拿掉又弹', async () => {
  const run = await launch({ [NOTE]: paired() }, { CN_AI_FAKE: '1', CN_FAKE_NOTE_MS: '50' })
  const { page, vault } = run
  try {
    await openNote(page, TITLE)
    await widenRight(page, 260)
    await openWeb(page, site.pandas)
    await selectIn(page, 'p1', '举一个例子', '写入CSV文件中。')
    // 悬停提示说右键能做什么；点一下只是收起
    expect(await guest(page, `document.getElementById('cn-clip-host').shadowRoot.querySelector('.bar .x').title`)).toBe('收起（右键或按住：这个网站不弹…）')
    await clickBar(page, '收起')
    await expect.poll(() => hostShown(page)).toBe('none')
    await selectIn(page, 'p2', '注意', '缺失值。')
    await clickBar(page, '收起', { button: 'right' })
    const host = new URL(site.pandas).hostname
    await expect.poll(() => menuTexts(page, 'x-menu')).toEqual([`${host} 不弹记进名单`, '哪里都不弹总开关关掉', '点 × 只是这次收起。这两项在 设置 › 选中小条 改回来'])
    await clickMenu(page, 'x-menu', `${host} 不弹`)
    await expect(page.getByTestId('toast')).toContainText(`${host} 不再弹小条，选了字按 ↵、⌘↵ 照样能用`)
    await expect.poll(() => cmdsOnDisk(vault).bar.offSites?.map((s) => s.site)).toEqual([host])
    // 底栏「改名单」：打开设置 › 选中小条，名单上有它
    await page.getByTestId('toast').getByRole('button', { name: '改名单' }).click()
    await expect(dlg(page).getByRole('group', { name: '这些网站不弹' })).toContainText(host)
    await page.keyboard.press('Escape')
    await expect(dlg(page)).toBeHidden()

    // 再选字：不弹；↵ 照样讲解
    await selectIn(page, 'p1', '下面我们将', '写入CSV文件中。', false)
    await page.waitForTimeout(400)
    expect(await hostShown(page)).toBe('none')
    await pressInPage(run, 'Return')
    await expect(reading(page).locator('.um').last()).toHaveText('给我讲解一下')

    // 设置里拿掉：又弹
    await openBarSettings(page)
    const sites = dlg(page).getByRole('group', { name: '这些网站不弹' })
    await expect(sites).toContainText(host)
    await expect(sites).toContainText('今天加的')
    await sites.getByRole('button', { name: `从名单拿掉 ${host}` }).click()
    await expect(toast(page)).toContainText(`${host} 又会弹了`)
    await expect.poll(() => cmdsOnDisk(vault).bar?.offSites ?? []).toEqual([])
    await page.keyboard.press('Escape')
    await rail(page).getByRole('button', { name: '网页' }).click()
    await selectIn(page, 'p2', '注意', '缺失值。')
  } finally {
    await run.close()
  }
})

test('文档里选了字：不弹条，右键菜单最上面是勾了「文档」的那几颗，点了在下面长出那颗的 AI 块；PDF 上框着时工具条也有它', async () => {
  const cmds =
    JSON.stringify({
      version: 1,
      own: [{ id: 'own-hs', name: '用高中生能懂的话讲', kind: 'ai', target: '1. 用高中生能听懂的话讲{选中的字}', rules: [{ t: '用高中生能听懂的话讲{选中的字}' }], prompt: '用高中生能听懂的话讲{选中的字}', out: 'note', where: ['web', 'pdf', 'html', 'doc'], write: 'answer', desc: '用高中生能听懂的话讲' }],
      bar: { on: ['explain', 'translate', 'quote', 'clip', 'own-hs'], more: ['only', 'copy'], off: [], enabled: true },
    }) + '\n'
  const run = await launch({ [NOTE]: paired(), [CMDS]: cmds, [PDF]: LECTURE }, { CN_AI_FAKE: '1', CN_FAKE_NOTE_MS: '50' })
  const { page } = run
  try {
    await armMenus(run)
    await openNote(page, TITLE)
    const line = pane(page).locator('.cm-line', { hasText: '我的理解' })
    await line.click({ clickCount: 3 })
    await expect.poll(() => page.evaluate(() => getSelection()?.toString().trim())).toContain('我的理解')
    await line.click({ button: 'right' })
    const m = await openedMenu(run)
    expect(menuLabels(m).slice(0, 2)).toEqual(['用高中生能懂的话讲', '撤销'])
    expect(m[1]!.type).toBe('separator')
    await pickMenu(run, '用高中生能懂的话讲')
    await expect.poll(() => editorText(page), { timeout: 15_000 }).toContain('[!ai] 用高中生能懂的话讲 · ')
    await waitSaved(page)
    // 读盘：AI 块接在选中那一段下面，空一行
    expect(readFileSync(join(run.vault, NOTE), 'utf8')).toMatch(/我的理解：先造一个小表，后面几节都拿它练。\n\n> \[!ai\] 用高中生能懂的话讲 · Claude Code · [^\n]+\n> \S/)

    // PDF：选一段字，工具条上自己的那颗在「引用」后面
    await page.keyboard.press('Meta+o')
    await page.getByRole('textbox', { name: '按名字跳到文件' }).fill('第3讲')
    await page.keyboard.press('Enter')
    await expect(tabOn(page)).toHaveText('第3讲.pdf')
    const span = page.locator('.pdfpane:not([hidden]) .pdfpage[data-page="1"] .textLayer span').first()
    await span.scrollIntoViewIfNeeded()
    const sb = (await span.boundingBox())!
    await page.mouse.move(sb.x + 2, sb.y + sb.height / 2)
    await page.mouse.down()
    await page.mouse.move(sb.x + sb.width - 2, sb.y + sb.height / 2, { steps: 6 })
    await page.mouse.up()
    const cap = page.getByRole('toolbar', { name: '框好的这块' })
    await expect(cap).toBeVisible()
    // 自己的那颗后面是选了字时 PDF 特有的四颗划线（ParaRead 联动）
    await expect(cap.locator('> button')).toHaveText(['讲解一下↵', '翻译 + 讲一讲', '引用⌘↵', '用高中生能懂的话讲', '重点', '定义', '想引用', '看不懂', '', ''])
  } finally {
    await run.close()
  }
})

test('别的入口：⌘K 里自己那条命令右键「放到选中小条」，条上有空就上条；再开右键写「已在小条上」', async () => {
  const run = await launch({ [NOTE]: paired(), [CMDS]: seeded() }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await openNote(page, TITLE)
    const pal = page.getByRole('dialog', { name: '搜索和命令' })
    await page.keyboard.press('Meta+k')
    await pal.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('整理成通顺笔记')
    const row = pal.locator('.pal-row').filter({ has: page.locator('.nm', { hasText: /^整理成通顺笔记$/ }) }).first()
    await row.click({ button: 'right' })
    const menu = page.getByRole('menu').filter({ has: page.locator('.pal-mhead') })
    await menu.getByRole('menuitem', { name: /放到选中小条/ }).click()
    await expect(pal.locator('.pal-toast')).toContainText('「整理成通顺笔记」放上了选中小条')
    await expect.poll(() => cmdsOnDisk(vault).bar.on).toEqual(['explain', 'translate', 'quote', 'clip', 'own-tidy'])
    expect(cmdsOnDisk(vault).own.find((o) => o.id === 'own-tidy')!.where).toEqual(['doc', 'web', 'pdf', 'html'])
    await row.click({ button: 'right' })
    await expect(menu.getByRole('menuitem', { name: /放到选中小条/ })).toBeDisabled()
    await expect(menu.getByRole('menuitem', { name: /放到选中小条/ })).toContainText('已在小条上')
  } finally {
    await run.close()
  }
})
