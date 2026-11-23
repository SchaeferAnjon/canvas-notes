// 对照截图（task-26nz7，原型 /private/tmp/canvas-notes-visual/21-选中小条自定义/proto.html）：照原型那条路一步一张——
// 编辑一颗（例子填好、键撞了「引用」）、设置 › 选中小条的表、条上满了被拦、从我的命令里挑、预览的文档那格、网页上的小条（新加的描圈）、⋯、× 的右键、写进笔记。
// 天青 / 深湖，B 风格，1440 × 887，真软件、临时库、假 AI、本机假网页。库里先放和原型一样的两条自己的命令（一条在 ⋯ 里、一条不出现）和两条「存成命令」存的。
// 只在给了 CN_SHOTS=<目录> 时跑：CN_SHOTS=/private/tmp/canvas-notes-build4/26nz7/app npx playwright test e2e/26nz7-shots.spec.ts
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, openNote, pane, rail, type Running, widenRight } from './app'
import { d2l, type D2l } from './fixtures/d2l-pandas'

const DIR = process.env.CN_SHOTS
test.skip(!DIR, '对照截图：CN_SHOTS=<目录> 才跑')
test.setTimeout(240_000)

const NOTE = '课程/学习笔记：动手学深度学习.md'
const TITLE = '学习笔记：动手学深度学习'

let site: D2l
test.beforeAll(async () => {
  site = await d2l()
})
test.afterAll(() => site.close())

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const dlg = (page: Page) => page.getByRole('dialog', { name: '设置' })
function guest<T = unknown>(page: Page, code: string): Promise<T> {
  return page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code) as Promise<T>
}
async function shot(run: Running, name: string) {
  await run.page.waitForTimeout(500)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(DIR!, `${name}.png`), Buffer.from(b64, 'base64'))
}
async function openWeb(page: Page, u: string) {
  if (!(await web(page).isVisible())) await rail(page).getByRole('button', { name: '网页', exact: true }).click()
  const addr = web(page).getByRole('textbox', { name: '网址' })
  await addr.click()
  await addr.fill(u)
  await addr.press('Enter')
  await expect.poll(() => guest(page, 'document.readyState + "|" + location.href')).toBe(`complete|${u}`)
}
async function selectIn(page: Page, id: string, from: string, to: string) {
  await guest(page, `document.getElementById(${JSON.stringify(id)}).scrollIntoView({ block: 'center' })`)
  for (let i = 0; i < 3; i++) {
    const w = (await web(page).locator('webview.on').boundingBox())!
    const pts = await guest<number[]>(
      page,
      `(() => { const t = document.getElementById(${JSON.stringify(id)}).firstChild; const s = t.data.indexOf(${JSON.stringify(from)}), e = t.data.indexOf(${JSON.stringify(to)}, s) + ${to.length}; const r = document.createRange(); r.setStart(t, s); r.setEnd(t, e); const rs = r.getClientRects(), f = rs[0], l = rs[rs.length - 1]; return [f.left + 1, f.top + f.height / 2, l.right - 1, l.top + l.height / 2] })()`,
    )
    await page.mouse.move(w.x + pts[0]!, w.y + pts[1]!)
    await page.mouse.down()
    await page.mouse.move(w.x + pts[2]!, w.y + pts[3]!, { steps: 8 })
    await page.mouse.up()
    if (await expect.poll(() => guest(page, `document.getElementById('cn-clip-host')?.style.display`), { timeout: 1500 }).toBe('block').then(() => true, () => false)) return
  }
}
async function hostClick(page: Page, sel: string, button: 'left' | 'right' = 'left') {
  const w = (await web(page).locator('webview.on').boundingBox())!
  const p = await guest<{ x: number; y: number }>(page, `(() => { const b = document.getElementById('cn-clip-host').shadowRoot.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 } })()`)
  await page.mouse.click(w.x + p.x, w.y + p.y, { button })
}

/** 和原型一样的起点：⋯ 里有「查这个词的词源」，「改写成考试要点」不出现；「存成命令」存过两条没放上来 */
const cmds = () =>
  JSON.stringify({
    version: 1,
    own: [
      { id: 'own-et', name: '查这个词的词源', kind: 'ai', target: '1. 说说', rules: [{ t: '说说{选中的字}这个词是怎么来的：词根、最早的意思、后来怎么变成现在的意思。三句以内。' }], prompt: '说说{选中的字}这个词是怎么来的：词根、最早的意思、后来怎么变成现在的意思。三句以内。', out: 'answer', where: ['web', 'pdf', 'doc'], write: 'answer', desc: '11月16日存 · 网页、PDF' },
      { id: 'own-exam', name: '改写成考试要点', kind: 'ai', target: '1. 改写', rules: [{ t: '把{选中的字}改写成考试时要记的两三条要点，每条一行。' }], prompt: '把{选中的字}改写成考试时要记的两三条要点，每条一行。', out: 'note', where: ['pdf', 'html'], write: 'answer', desc: '改写成考试要点' },
      { id: 'own-tidy', name: '整理成通顺笔记', kind: 'ai', target: '1. 整理', rules: [{ t: '把这篇整理成通顺的笔记：按意思分段，去掉重复，原意不改' }], where: ['doc'], write: 'inplace', desc: '11月18日存 · 文档' },
      { id: 'own-eng', name: '翻成英文摘要', kind: 'ai', target: '1. 英文', rules: [{ t: '用三句英文概括' }], where: ['doc', 'web'], write: 'answer', desc: '11月19日存 · 文档、网页' },
    ],
    bar: { on: ['explain', 'translate', 'quote', 'clip'], more: ['only', 'own-et', 'copy'], off: ['own-exam'], enabled: true },
  }) + '\n'

const BODY = `---\nread-along: \${BASE}/\n---\n# ${TITLE}\n\n## 2.2 数据预处理\n\n先把数据读进来，再处理缺失值。\n\n> 举一个例子，我们首先创建一个人工数据集，并存储在CSV（逗号分隔值）文件 ../data/house_tiny.csv中。\n\n我的理解：先造一个小表，后面几节都拿它练。\n`

for (const skin of ['sky', 'petrol'] as const) {
  test(`对照图：${skin}`, async () => {
    mkdirSync(DIR!, { recursive: true })
    const run = await launch({ [NOTE]: BODY.replace('${BASE}', site.base), '.canvas-notes/命令.json': cmds() }, { CN_AI_FAKE: '1', CN_FAKE_NOTE_MS: '50' }, (vault) => {
      const ud = join(dirname(vault), 'user-data')
      mkdirSync(ud, { recursive: true })
      writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin, frame: 'b', winBg: 'aurora' } }))
    })
    const { page } = run
    try {
      await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
      await openNote(page, TITLE)
      await openWeb(page, site.pandas)
      await widenRight(page, 270)
      await expect(page.getByTestId('toast')).toHaveCount(0, { timeout: 15_000 })
      // 网页上拖选 → ⋯ →「加一颗…」
      await selectIn(page, 'p1', '举一个例子', '写入CSV文件中。')
      await shot(run, `0-web-bar-before-${skin}`)
      await hostClick(page, 'button[data-k="__more"]')
      await shot(run, `1-web-more-before-${skin}`)
      await hostClick(page, '.more-menu [data-k="__add"]')
      await expect(dlg(page)).toBeVisible()
      await dlg(page).getByRole('button', { name: '用高中生能懂的话讲' }).click()
      const keyBtn = dlg(page).getByRole('group', { name: '自定义一颗' }).getByRole('button', { name: '快捷键' })
      await keyBtn.click()
      await page.keyboard.press('Meta+Enter')
      await shot(run, `2-edit-clash-${skin}`)
      await keyBtn.click()
      await page.keyboard.press('Alt+g')
      await dlg(page).getByRole('button', { name: /^存好/ }).click()
      await expect(dlg(page).getByTestId('settings-toast')).toContainText('放上了条上')
      await shot(run, `3-settings-list-${skin}`)
      await dlg(page).getByTestId('selbar-preview').getByRole('radio', { name: 'PDF' }).click()
      await shot(run, `3b-preview-pdf-${skin}`)
      await dlg(page).getByTestId('selbar-preview').getByRole('radio', { name: '网页' }).click()
      // 条上满了：「拷贝」⋯ › 放上条 被拦
      await dlg(page).getByRole('group', { name: '按钮' }).getByRole('listitem', { name: '拷贝', exact: true }).getByRole('button', { name: '这一颗还能…' }).click()
      await shot(run, `4-row-menu-${skin}`)
      await page.keyboard.press('Escape')
      // 拖「拷贝」往条上放：被拦（松手后描红、说一句 2.4 秒）
      const list = dlg(page).getByRole('group', { name: '按钮' })
      const a = (await list.getByRole('listitem', { name: '拷贝', exact: true }).boundingBox())!
      const b = (await list.getByRole('listitem', { name: '引用', exact: true }).boundingBox())!
      await page.mouse.move(a.x + 20, a.y + a.height / 2)
      await page.mouse.down()
      await page.mouse.move(a.x + 20, a.y + a.height / 2 + 8, { steps: 2 })
      await page.mouse.move(a.x + 20, b.y + 6, { steps: 10 })
      await shot(run, `5-full-deny-${skin}`)
      await page.mouse.up()
      await dlg(page).getByRole('button', { name: '从我的命令里挑…' }).click()
      await shot(run, `6-pick-${skin}`)
      await page.keyboard.press('Escape')
      await dlg(page).getByTestId('selbar-preview').getByRole('radio', { name: '文档' }).click()
      await shot(run, `7-preview-doc-${skin}`)
      // 名单和总开关
      await dlg(page).locator('.set-body').evaluate((el) => (el.scrollTop = el.scrollHeight))
      await shot(run, `8-settings-bottom-${skin}`)
      await page.keyboard.press('Escape')
      await expect(dlg(page)).toBeHidden()
      // 再选一段：条上多了它（描一圈）
      await guest(page, `[...document.querySelectorAll('p')].find((p) => p.textContent.startsWith('要从创建的')).id = 'pc'`)
      await selectIn(page, 'pc', '要从创建的', '（“Price”）。')
      await shot(run, `9-web-bar-new-${skin}`)
      const own = await guest<string>(page, `[...document.getElementById('cn-clip-host').shadowRoot.querySelectorAll('.bar button')].find((b) => b.textContent.includes('高中生')).dataset.k`)
      await hostClick(page, `button[data-k="${own}"]`)
      await expect.poll(async () => pane(page).locator('.cm-content').innerText(), { timeout: 15_000 }).toContain('用高中生能懂的话讲')
      await page.waitForTimeout(1500)
      await shot(run, `12-written-${skin}`)
      await rail(page).getByRole('button', { name: '网页', exact: true }).click()
      await guest(page, `[...document.querySelectorAll('p')].find((p) => p.textContent.startsWith('要从创建的')).id = 'pc'`)
      await selectIn(page, 'pc', '要从创建的', '（“Price”）。')
      await hostClick(page, 'button[data-k="__more"]')
      await shot(run, `10-web-more-${skin}`)
      await hostClick(page, 'button[data-k="__more"]')
      await hostClick(page, 'button[data-k="__x"]', 'right')
      await shot(run, `11-web-x-menu-${skin}`)
    } finally {
      await run.close()
    }
  })
}
