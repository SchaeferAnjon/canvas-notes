// 第二轮试用反馈（用户 2026-11-15）：待办双击能直接改、整页剪藏拖上白板是干净的卡片、历史里点文件看改了什么、
// ⌘K 输入条不被压扁、红绿灯旁收起左栏、/整理当前白板 是命令、不认识的 / 命令交给 AI
import { expect, test, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, pane, waitSaved, gitAct } from './app'

const board = (page: Page) => pane(page).getByTestId('board')
const read = (vault: string, f: string) => readFileSync(join(vault, f), 'utf8')

const TODO_BOARD = `---
type: board
---
<!-- card id=t x=80 y=80 w=280 -->
**待办**
- [ ]

<!-- card id=n x=500 y=80 w=280 -->
一张普通卡片
`

async function openBoard(page: Page, name: string) {
  await page.locator('.nav .si', { hasText: new RegExp(`^${name}`) }).first().click()
  await expect(board(page)).toBeVisible()
}

async function dragBy(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 5 })
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 5 })
  await page.mouse.up()
}

test('待办：双击是一条条输入框，回车加一条、退格删空的一条，点别处存；不露 md 原文', async () => {
  const run = await launch({ '计划.md': TODO_BOARD })
  const { page, vault } = run
  try {
    await openBoard(page, '计划')
    const todo = board(page).locator('.bcard[data-id="t"]')
    await todo.dblclick()
    await expect(todo.getByRole('textbox', { name: '卡片内容' })).toHaveCount(0)
    await expect(todo.getByRole('textbox', { name: '待办标题' })).toHaveValue('待办')
    const items = todo.getByRole('textbox', { name: '待办事项' })
    await expect(items).toHaveCount(1)
    await expect(items.first()).toBeFocused()
    await page.keyboard.type('订机票')
    await page.keyboard.press('Enter')
    await expect(items).toHaveCount(2)
    await page.keyboard.type('订租车')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Backspace') // 空着的第三条删掉，光标回到第二条
    await expect(items).toHaveCount(2)
    await expect(items.nth(1)).toBeFocused()
    await todo.getByRole('checkbox', { name: '做完了' }).first().check()
    // 点白板空白处：存
    const bb = (await board(page).boundingBox())!
    await page.mouse.click(bb.x + bb.width - 60, bb.y + bb.height - 60)
    await waitSaved(page)
    expect(read(vault, '计划.md')).toContain('<!-- card id=t x=80 y=80 w=280 -->\n**待办**\n- [x] 订机票\n- [ ] 订租车\n')
    await expect(todo.locator('.td')).toHaveCount(2)
    await expect(todo.locator('.td.done')).toHaveText('订机票')

    // 双击第二条：光标落在第二条；esc 不改
    await todo.locator('.td', { hasText: '订租车' }).dblclick()
    await expect(todo.getByRole('textbox', { name: '待办事项' }).nth(1)).toBeFocused()
    await page.keyboard.type('不要的字')
    await page.keyboard.press('Escape')
    await waitSaved(page)
    expect(read(vault, '计划.md')).toContain('- [ ] 订租车\n')
    expect(read(vault, '计划.md')).not.toContain('不要的字')
  } finally {
    await run.close()
  }
})

test('整页剪藏从「未整理」拖上白板：是一张标题加摘要的卡片，那篇挪进素材，双击打开全文', async () => {
  const long = Array.from({ length: 30 }, (_, i) => `第 ${i + 1} 段，[链接](https://zh.wikipedia.org/wiki/%E5%86%B0 "冰") ![图](https://x.org/a.jpg)`).join('\n\n')
  const run = await launch({ '冰岛.md': '---\ntype: board\n---\n' })
  const { page, vault } = run
  mkdirSync(join(vault, '收件箱'))
  writeFileSync(join(vault, '收件箱', '雷克雅未克.md'), `---\ncreated: 2026-11-15 17:04\nsource: https://zh.wikipedia.org/wiki/R\n---\n# 雷克雅未克\n\n—— [雷克雅未克](https://zh.wikipedia.org/wiki/R)\n\n冰岛首都和最大城市。\n\n${long}\n`)
  try {
    await openBoard(page, '冰岛')
    await board(page).getByTestId('unsorted').click()
    const mini = board(page).locator('.mini', { hasText: '雷克雅未克' })
    const m = (await mini.boundingBox())!
    const bb = (await board(page).boundingBox())!
    await dragBy(page, { x: m.x + 20, y: m.y + 10 }, bb.x + 300 - m.x, bb.y + 200 - m.y)
    const card = board(page).locator('.bcard.k-doc')
    await expect(card).toHaveCount(1)
    await expect(card.locator('b')).toHaveText('雷克雅未克')
    await expect(card).toContainText('冰岛首都和最大城市')
    await expect(card).toContainText('zh.wikipedia.org')
    await expect(card).not.toContainText('](')
    await expect.poll(() => existsSync(join(vault, '收件箱', '雷克雅未克.md'))).toBe(false)
    expect(existsSync(join(vault, '素材', '冰岛', '雷克雅未克.md'))).toBe(true)
    await waitSaved(page)
    expect(read(vault, '冰岛.md')).toMatch(/<!-- card id=\w+ x=\d+ y=\d+ w=280 -->\n\[\[雷克雅未克\]\]\n/)
    await card.dblclick()
    await expect(page.getByRole('tab', { name: /雷克雅未克/ })).toHaveAttribute('aria-selected', 'true')
  } finally {
    await run.close()
  }
})

test('历史：点文件在下面展开这次改了什么，能打开这篇', async () => {
  const run = await launch({ '甲.md': '# 甲\n\n第一行\n' })
  const { page, vault } = run
  try {
    writeFileSync(join(vault, '甲.md'), '# 甲\n\n第一行\n\n新加的一行\n')
    await gitAct(page, '提交')
    await expect(page.getByTestId('git-changed')).toHaveText('都提交了')
    await gitAct(page, '历史')
    const hist = page.getByRole('complementary', { name: '历史' })
    await hist.locator('.commit.open .fr', { hasText: '甲.md' }).click()
    const diff = hist.getByTestId('history-diff')
    await expect(diff.locator('.dl .a', { hasText: '新加的一行' })).toHaveCount(1)
    await diff.getByRole('button', { name: '打开这篇' }).click()
    await expect(page.getByRole('tab', { name: /^甲/ })).toHaveAttribute('aria-selected', 'true')
  } finally {
    await run.close()
  }
})

test('⌘K 输入条在列表很长时也不被压扁；红绿灯旁的按钮收起、展开左栏，⌘\\ 也行', async () => {
  const files: Record<string, string> = {}
  for (let i = 0; i < 30; i++) files[`笔记 ${i}.md`] = `# 笔记 ${i}\n`
  const run = await launch(files)
  const { page } = run
  try {
    await page.keyboard.press('Meta+k')
    const row = page.locator('.pal-in')
    await expect(row).toBeVisible()
    expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(59)
    await page.keyboard.press('Escape')

    await expect(page.locator('.side')).toBeVisible()
    await page.getByRole('button', { name: '收起左栏' }).click()
    await expect(page.locator('.side')).toBeHidden()
    // 中间的岛左边贴着左图标栏
    const bar = (await page.getByRole('navigation', { name: '左栏' }).boundingBox())!
    expect(Math.abs((await page.locator('main.center').boundingBox())!.x - (bar.x + bar.width))).toBeLessThan(2)
    await page.getByRole('button', { name: '展开左栏' }).click()
    await expect(page.locator('.side')).toBeVisible()
    await page.keyboard.press('Meta+\\')
    await expect(page.locator('.side')).toBeHidden()
  } finally {
    await run.close()
  }
})

test('/整理当前白板 是一条命令，交给 AI 动手；不认识的 / 命令也交给 AI，不报错', async () => {
  const run = await launch({ '计划.md': TODO_BOARD }, { CN_AI_FAKE: '1' })
  const { page } = run
  const ai = page.getByRole('complementary', { name: 'AI 对话' })
  try {
    await openBoard(page, '计划')
    await page.keyboard.press('Meta+j')
    const box = ai.getByRole('textbox', { name: '问 AI' })
    await box.fill('/整理')
    await expect(ai).toContainText('整理当前白板')
    await box.fill('/整理当前白板')
    await box.press('Enter')
    await expect(ai).toContainText('按列排整齐了')
    await expect(ai).toContainText('改了 1 个文件') // 这一轮跑完才能发下一句
    await expect(ai).not.toContainText('没有叫')

    await box.fill('/随便说点什么')
    await expect(ai).toContainText('回车直接交给 AI 去做')
    await box.press('Enter')
    await expect(ai).toContainText('这是测试回答')
    await expect(ai).not.toContainText('没有叫「随便说点什么」的命令')
    // ⌘J 再按一次关上
    await page.keyboard.press('Meta+j')
    await expect(ai).toHaveCount(0)
  } finally {
    await run.close()
  }
})

test('网页有焦点时 ⌘J 也能打开、关上 AI', async () => {
  const { createServer } = await import('node:http')
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end('<title>页</title><body style="height:2000px"><p id="p">点我</p></body>')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`
  const run = await launch({ '甲.md': '# 甲\n' })
  const { page } = run
  try {
    await page.getByRole('navigation', { name: '右栏' }).getByRole('button', { name: '网页' }).click()
    const web = page.getByRole('complementary', { name: '网页' })
    const addr = web.getByRole('textbox', { name: '网址' })
    await addr.fill(url)
    await addr.press('Enter')
    const wv = web.locator('webview')
    await expect(wv).toBeVisible()
    await expect
      .poll(() => page.evaluate(() => (document.querySelector('webview') as unknown as { executeJavaScript(c: string): Promise<string> }).executeJavaScript('document.readyState')))
      .toBe('complete')
    const b = (await wv.boundingBox())!
    await page.mouse.click(b.x + 100, b.y + 200)
    // Playwright 的 keyboard 只到软件界面；从主进程往网页里送真的按键，和人在网页里按一样
    const id = await page.evaluate(() => (document.querySelector('webview') as unknown as { getWebContentsId(): number }).getWebContentsId())
    const press = () =>
      run.app.evaluate(({ webContents }, wcId) => {
        const wc = webContents.fromId(wcId)!
        wc.sendInputEvent({ type: 'keyDown', keyCode: 'J', modifiers: ['meta'] })
        wc.sendInputEvent({ type: 'keyUp', keyCode: 'J', modifiers: ['meta'] })
      }, id)
    const ai = page.getByRole('complementary', { name: 'AI 对话' })
    await press()
    await expect(ai).toBeVisible()
    await page.mouse.click(b.x + 100, b.y + 200)
    await press()
    await expect(ai).toHaveCount(0)
  } finally {
    await run.close()
    server.close()
  }
})

test('整页剪藏维基百科这类网页：信息框、[编辑]、脚注 [1]、目录不进笔记；链接网址是能读的字、不带 title', async () => {
  const { createServer } = await import('node:http')
  const { readdirSync } = await import('node:fs')
  const para = (n: number) => `<p>第 ${n} 段：雷克雅未克是冰岛首都和最大城市，位于法赫萨湾南岸，全国文化、经济、政治中心。<sup class="reference"><a href="#c${n}">[${n}]</a></sup> 这里有一座<a href="/wiki/%E7%8F%8D%E7%8F%A0%E6%A5%BC" title="珍珠楼">珍珠楼</a>。</p>`
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end(`<title>雷克雅未克 - 维基百科</title><body><div id="content"><h1>雷克雅未克<span class="mw-editsection">[编辑]</span></h1>
      <table class="infobox"><tr><td><img src="/a.jpg" alt="左上：夏季在珍珠楼上眺望雷克雅未克老城区和哈尔格林姆教堂；右上：在哈尔格林姆教堂俯瞰"></td></tr><tr><td>市镇</td></tr></table>
      <div id="toc" class="toc">目录 1 历史 2 气候</div>
      ${[1, 2, 3, 4, 5, 6].map(para).join('')}
      <h2>气候<span class="mw-editsection">[编辑]</span></h2><p>近极地海洋性气候，受北大西洋暖流影响，比同纬度城市暖和，一月均温约 0 度，七月约 11 度。</p>
      <ol class="references"><li id="c1">参考文献一</li></ol></div></body>`)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/wiki/R`
  const run = await launch({ '甲.md': '# 甲\n' })
  const { page, vault } = run
  try {
    await page.getByRole('navigation', { name: '右栏' }).getByRole('button', { name: '网页' }).click()
    const addr = page.getByRole('complementary', { name: '网页' }).getByRole('textbox', { name: '网址' })
    await addr.fill(url)
    await addr.press('Enter')
    await expect
      .poll(() => page.evaluate(() => (document.querySelector('webview') as unknown as { executeJavaScript(c: string): Promise<string> }).executeJavaScript('document.readyState + location.pathname')))
      .toBe('complete/wiki/R')
    const p = await page.evaluate((u) => window.cn.clipCurrentPage({ webUrl: u }), url)
    expect(readdirSync(join(vault, '收件箱'))).toHaveLength(1)
    const md = read(vault, p as string)
    expect(md).toContain('第 1 段：雷克雅未克是冰岛首都')
    expect(md).toContain('## 气候')
    expect(md).toContain('/wiki/珍珠楼)')
    for (const junk of ['[编辑]', '[1]', '目录 1', '市镇', '左上：夏季', '"珍珠楼"', '%E7', '参考文献一']) expect(md).not.toContain(junk)
  } finally {
    await run.close()
    server.close()
  }
})
