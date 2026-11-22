import { expect, test, type Page } from '@playwright/test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { gitAct, launch, openNote, pane, rail, tabOn, webMore } from './app'
import { armMenus, clipboardText, enabledOf, menuLabels, openedMenu, pickMenu } from './menu'
import { fragmentUrl, sourceLabel } from '../src/shared/web-link'

// 右栏网页里的右键：链接、图、选的字、输入框、空白处各有各的项；点了真的做

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQEAP2/D/E2JyQKAAAAAElFTkSuQmCC', 'base64')
let server: Server
let base: string

test.beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/dot.png') {
      res.setHeader('content-type', 'image/png')
      return res.end(PNG)
    }
    res.setHeader('content-type', 'text/html; charset=utf-8')
    if (req.url === '/two') return res.end('<title>Two</title><p>second page</p>')
    res.end(`<title>Rich</title><body style="font:16px sans-serif;padding:20px">
      <p id="p1">Seek wealth, not money or status.</p>
      <p><a id="a1" href="/two">Second page link</a></p>
      <p><img id="i1" src="/dot.png" width="80" height="80" alt="dot"></p>
      <p><input id="in1" value="" style="width:200px"></p>
      <p id="blank" style="height:60px"></p></body>`)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
test.afterAll(() => server.close())

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const guest = (page: Page, code: string): Promise<unknown> =>
  page.evaluate((c) => (document.querySelector('aside webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code)

async function openWeb(page: Page, url: string) {
  await rail(page).getByRole('button', { name: '网页' }).click()
  const addr = web(page).getByRole('textbox', { name: '网址' })
  await addr.fill(url)
  await addr.press('Enter')
  await expect(web(page).locator('webview.on')).toBeVisible()
  await expect.poll(() => guest(page, 'document.readyState + "|" + location.href')).toBe(`complete|${url}`)
}

/** 网页里某个元素的中心（界面坐标） */
async function at(page: Page, id: string) {
  const w = (await web(page).locator('webview.on').boundingBox())!
  const r = JSON.parse(String(await guest(page, `JSON.stringify(document.getElementById('${id}').getBoundingClientRect())`))) as { x: number; y: number; width: number; height: number }
  return { x: w.x + r.x + Math.min(r.width / 2, 40), y: w.y + r.y + r.height / 2 }
}

async function rightClick(page: Page, id: string) {
  const p = await at(page, id)
  await page.mouse.click(p.x, p.y, { button: 'right' })
}

const inbox = (vault: string) => (existsSync(join(vault, '收件箱')) ? readdirSync(join(vault, '收件箱')) : [])

test('网页：链接右键「在中间栏打开」「剪进收件箱」「拷贝链接」；空白处前进灰着、整页剪藏进收件箱', async () => {
  const run = await launch({ 'a.md': '# a\n' })
  const { page, vault } = run
  try {
    await armMenus(run)
    await openWeb(page, `${base}/rich`)
    await rightClick(page, 'a1')
    const m = await openedMenu(run)
    expect(menuLabels(m)).toEqual(['在新标签打开', '在中间栏打开', '拷贝链接', '剪进收件箱', '后退', '前进', '重新载入', '双语翻译', '剪藏这一页'])
    await pickMenu(run, '拷贝链接')
    await expect.poll(() => clipboardText(run)).toBe(`${base}/two`)

    await rightClick(page, 'a1')
    await pickMenu(run, '剪进收件箱')
    await expect.poll(() => inbox(vault).length).toBe(1)
    expect(readFileSync(join(vault, '收件箱', inbox(vault)[0]!), 'utf8')).toContain(`[Second page link](${base}/two)`)

    await rightClick(page, 'a1')
    await pickMenu(run, '在中间栏打开')
    await expect(tabOn(page)).toContainText(/Second page link|Two|127\.0\.0\.1/)

    // 回到右栏那页：空白处右键
    await rightClick(page, 'blank')
    const m2 = await openedMenu(run)
    expect(enabledOf(m2, '前进')).toBe(false)
    expect(menuLabels(m2)).toEqual(['后退', '前进', '重新载入', '双语翻译', '剪藏这一页'])
    await pickMenu(run, '剪藏这一页')
    await expect.poll(() => inbox(vault).length).toBe(2)
  } finally {
    await run.close()
  }
})

// task-6cxtc 起右键「剪进文档」和小条的「剪藏」走同一个剪藏：这个网站还没和哪篇配对时先问「记到哪篇」，「记到这篇」顺手配成一对，
// 再插到光标处，来源一行是回到这一段的链接，底栏「剪进《X》光标处」
test('网页：选了字右键「剪成卡片」进收件箱、「剪进文档」（没配对先问记到哪篇）插到光标处、「问 AI」放进输入框', async () => {
  const run = await launch({ '读书.md': '# 读书\n\n第一段。\n' })
  const { page, vault } = run
  try {
    await armMenus(run)
    await openNote(page, '读书')
    await pane(page).locator('.cm-line', { hasText: '第一段' }).click()
    await page.keyboard.press('End')
    await openWeb(page, `${base}/rich`)
    await guest(page, `(() => { const r = document.createRange(); r.selectNodeContents(document.getElementById('p1')); getSelection().removeAllRanges(); getSelection().addRange(r) })()`)
    await rightClick(page, 'p1')
    const m = await openedMenu(run)
    expect(menuLabels(m).slice(0, 5)).toEqual(['拷贝', '剪成卡片', '剪进文档', '翻译', '问 AI'])
    await pickMenu(run, '剪进文档')
    const dlg = page.getByRole('dialog', { name: '记到哪篇' })
    await expect(dlg).toBeVisible()
    await expect(dlg.getByRole('radio').nth(0)).toHaveAccessibleName(/读书/)
    await expect(dlg.getByRole('radio').nth(0)).toBeChecked()
    await dlg.getByRole('button', { name: /记到这篇/ }).click()
    await expect(dlg).toHaveCount(0)
    await expect(page.getByTestId('toast')).toContainText('剪进《读书》光标处')
    const quote = 'Seek wealth, not money or status.'
    const clipMd = `> ${quote}\n—— [${sourceLabel({ title: 'Rich', url: `${base}/rich` })}](${fragmentUrl(`${base}/rich`, quote)})`
    await expect.poll(() => readFileSync(join(vault, '读书.md'), 'utf8')).toBe(`---\nread-along: ${base}/\n---\n# 读书\n\n第一段。\n\n${clipMd}\n\n`)

    await guest(page, `(() => { const r = document.createRange(); r.selectNodeContents(document.getElementById('p1')); getSelection().removeAllRanges(); getSelection().addRange(r) })()`)
    await rightClick(page, 'p1')
    await pickMenu(run, '剪成卡片')
    await expect.poll(() => inbox(vault).length).toBe(1)

    await guest(page, `(() => { const r = document.createRange(); r.selectNodeContents(document.getElementById('p1')); getSelection().removeAllRanges(); getSelection().addRange(r) })()`)
    await rightClick(page, 'p1')
    await pickMenu(run, '拷贝')
    await expect.poll(() => clipboardText(run)).toBe('Seek wealth, not money or status.')
    await rightClick(page, 'p1')
    await pickMenu(run, '问 AI')
    // 第 2b 段：选的字成为 AI 输入框顶上那一排的第一块引用（来源「网页《标题》」），字里是编号 ①
    await expect(page.getByRole('textbox', { name: '问 AI' })).toHaveValue('①')
    await expect(page.getByTestId('ai-mat').locator('.ct')).toHaveText('Seek wealth, not money or status.')
    await expect(page.getByTestId('ai-mat').locator('.cs')).toHaveText(/^网页/)
  } finally {
    await run.close()
  }
})

test('网页：图右键「存进附件」存进库里、「拷贝图片地址」；输入框右键是标准编辑菜单，粘贴真的进了网页的输入框', async () => {
  const run = await launch({ 'a.md': '# a\n' })
  const { page, vault } = run
  try {
    await armMenus(run)
    await openWeb(page, `${base}/rich`)
    await rightClick(page, 'i1')
    const m = await openedMenu(run)
    expect(menuLabels(m).slice(0, 3)).toEqual(['拷贝图片', '拷贝图片地址', '存进附件'])
    await pickMenu(run, '存进附件')
    await expect.poll(() => (existsSync(join(vault, '附件')) ? readdirSync(join(vault, '附件')).length : 0)).toBe(1)
    await expect(page.getByTestId('toast')).toContainText('图存进了附件/')
    await rightClick(page, 'i1')
    await pickMenu(run, '拷贝图片地址')
    await expect.poll(() => clipboardText(run)).toBe(`${base}/dot.png`)

    await run.app.evaluate(({ clipboard }) => clipboard.writeText('pasted words'))
    const p = await at(page, 'in1')
    await page.mouse.click(p.x, p.y)
    await page.mouse.click(p.x, p.y, { button: 'right' })
    const m2 = await openedMenu(run)
    expect(menuLabels(m2).slice(0, 6)).toEqual(['撤销', '重做', '剪切', '拷贝', '粘贴', '全选'])
    await pickMenu(run, '粘贴')
    await expect.poll(() => guest(page, `document.getElementById('in1').value`)).toBe('pasted words')
  } finally {
    await run.close()
  }
})

test('网页的浏览历史右键「在中间栏打开」「拷贝链接」；Git 历史的一次提交右键「拷贝提交号」', async () => {
  const run = await launch({ 'a.md': '# a\n' })
  const { page, vault } = run
  try {
    await armMenus(run)
    await openWeb(page, `${base}/rich`)
    await webMore(page, '书签和历史')
    await web(page).getByRole('tab', { name: /历史/ }).click()
    const row = web(page).getByRole('list', { name: '历史' }).getByRole('listitem').first()
    await expect(row).toContainText('Rich')
    await row.click({ button: 'right' })
    expect(menuLabels(await openedMenu(run))).toEqual(['打开', '在新标签打开', '在中间栏打开', '拷贝链接'])
    await pickMenu(run, '拷贝链接')
    await expect.poll(() => clipboardText(run)).toBe(`${base}/rich`)

    await gitAct(page, '历史')
    // 最新那次默认展开，下面列着改的文件（文件行有自己的右键），所以右键点提交那一行
    const commit = page.locator('.commit').first().locator('.ch')
    await expect(commit).toBeVisible()
    await commit.click({ button: 'right' })
    expect(menuLabels(await openedMenu(run))).toEqual(['看这次改了什么', '拷贝提交号', '拷贝说明'])
    await pickMenu(run, '拷贝提交号')
    const { execFileSync } = await import('node:child_process')
    const head = execFileSync('git', ['-C', vault, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    await expect.poll(() => clipboardText(run)).toBe(head)
  } finally {
    await run.close()
  }
})
