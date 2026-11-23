/**
 * task-ys1rr 对照报告（/private/tmp/canvas-notes-visual/20-文档手感对照Notion/）用的连续帧：画布笔记里每个操作按前、按后各截一张
 * （光标常亮，记下光标在图上的位置），再截整个窗口（天青、深湖、同一篇切到白板）给设计复审并排看。
 * 只在截图时跑：CN_FRAMES=<目录>（CN_FRAMES_IMG=<一张 png> 换掉 1×1 的图）；同一份脚本在改前、改后的代码上各跑一次出前后对比。平时跳过。
 */
import { type Page, test } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { acts, editorText, launch, openNote, pane, type Running, waitSaved } from './app'

const OUT = process.env.CN_FRAMES ?? ''
test.skip(!OUT, '只在截对照图时跑（CN_FRAMES=目录）')
if (OUT) mkdirSync(OUT, { recursive: true })
const meta: Record<string, unknown> = {}

// CN_FRAMES_IMG：报告里放一张像样的图（不给就用 1×1 的点）
const PNG = process.env.CN_FRAMES_IMG
  ? readFileSync(process.env.CN_FRAMES_IMG)
  : Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

export const DOC = `# 对照测试

第一段正文，有几句话。

第二段正文。

## 二级标题

- 列表第一项
- 列表第二项

> 一段引用的文字

\`\`\`js
const a = 1
const b = 2
\`\`\`

- [ ] 待办一
- [x] 待办二

![图](附件/图.png)

| 列一 | 列二 |
| --- | --- |
| a | b |

> [!note] 提示块标题
> 提示块正文

最后一段。
`

const view = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector('.pane:not([hidden]) .cm-content') as HTMLElement & { cmTile: { view: any } }
    const v = el.cmTile.view
    const s = v.state.selection.main
    const line = v.state.doc.lineAt(s.head)
    const c = v.coordsAtPos(s.head, 1) ?? v.coordsAtPos(s.head, -1)
    return { head: s.head, anchor: s.anchor, line: line.number, text: line.text, col: s.head - line.from, caret: c ? { x: c.left, y: c.top, h: c.bottom - c.top } : null, focus: v.hasFocus }
  })

const line = (page: Page, text: string) => pane(page).locator('.cm-line', { hasText: text }).first()

async function clickEnd(page: Page, text: string) {
  await line(page, text).click()
  await page.keyboard.press('End')
  await page.keyboard.press('End')
}
async function clickStart(page: Page, text: string) {
  await line(page, text).click()
  await page.keyboard.press('Home')
}

/** 截一帧：编辑器那一栏（版心左右各留 80）、从 top 往下 h 高；记下光标、选中块在图上的框 */
/** top：截图上沿；给 [某一行的字, 偏移] 时按截图那一刻这一行在哪算（中间有滚动也对得上，这一行上面的不动、下面跳没跳看得出来） */
async function frame(page: Page, name: string, at?: number | [string, number], h = 420) {
  const top = Array.isArray(at) ? (await yOf(page, at[0])) + at[1] : at
  const body = (await pane(page).locator('.body').first().boundingBox())!
  // 鼠标挪开（不挂链接卡、把手），等悬停的东西收起
  await page.mouse.move(body.x + body.width - 4, body.y + body.height - 4)
  await page.waitForTimeout(350)
  const c = (await pane(page).locator('.cm-content').boundingBox())!
  const y0 = Math.max(body.y, top ?? body.y)
  const clip = { x: Math.round(c.x - 80), y: Math.round(y0), width: Math.round(c.width + 160), height: Math.round(Math.min(h, body.y + body.height - y0)) }
  // 无头截图里系统光标画不出来：在光标的位置画一根 2px 的竖线（只为截图，截完拿掉）
  const v = await view(page)
  if (v.caret && v.anchor === v.head)
    await page.evaluate((c) => {
      const m = document.createElement('div')
      m.id = 'ys1rr-caret'
      m.style.cssText = `position:fixed;left:${c.x - 1}px;top:${c.y}px;width:2px;height:${c.h}px;background:#111;z-index:99999;pointer-events:none`
      document.body.appendChild(m)
    }, v.caret)
  await page.screenshot({ path: join(OUT, name + '.png'), clip })
  await page.evaluate(() => document.getElementById('ys1rr-caret')?.remove())
  meta[name] = { clip, caret: v.caret ? { x: Math.round(v.caret.x - clip.x - 6), y: Math.round(v.caret.y - clip.y - 4), w: 12, h: Math.round(v.caret.h + 8) } : null, line: v.line, col: v.col, text: v.text, focus: v.focus, md: await editorText(page) }
  writeFileSync(join(OUT, 'frames.json'), JSON.stringify(meta, null, 1))
}

async function open(doc = DOC, name = '对照测试', extra: Record<string, string> = {}): Promise<Running> {
  const run = await launch({ [name + '.md']: doc, '附件/图.png': PNG, ...extra })
  // 窗口按 1440×900 摆（不用 setViewportSize：它把截图压成 1 倍，报告里放大就糊；窗口本身是 2 倍屏）
  await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900))
  await run.page.waitForTimeout(300)
  await openNote(run.page, name)
  // 光标常亮（截图时不赶上闪烁的那一半）
  await run.page.addStyleTag({ content: '.cm-cursorLayer{animation:none!important}' })
  await run.page.waitForTimeout(300)
  return run
}

const yOf = async (page: Page, text: string) => (await line(page, text).boundingBox())!.y

test.describe.configure({ mode: 'serial' })
test.setTimeout(240_000)

test('帧：回车、方向键、退格 Delete', async () => {
  const run = await open()
  const { page } = run
  try {
    // 「在哪」：整个窗口，记下正文、第一段和第二段之间的缝、标题栏的位置
    await page.mouse.move(5, 895)
    await page.waitForTimeout(300)
    await page.screenshot({ path: join(OUT, 'where.png') })
    const box = async (sel: string, text?: string) => {
      const b = text ? await line(page, text).boundingBox() : await pane(page).locator(sel).first().boundingBox()
      return b ? { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } : null
    }
    meta.where = { content: await box('.cm-content'), first: await box('', '第一段正文'), second: await box('', '第二段正文'), list: await box('', '列表第二项'), quote: await box('', '一段引用的文字') }
    writeFileSync(join(OUT, 'frames.json'), JSON.stringify(meta, null, 1))

    // 1 段末回车
    await clickEnd(page, '第一段正文')
    const t1: [string, number] = ['第一段正文', -40]
    await frame(page, 'enter-0', t1, 260)
    await page.keyboard.press('Enter')
    await frame(page, 'enter-1', t1, 260)
    await page.keyboard.type('新的一句')
    await frame(page, 'enter-2', t1, 260)
    for (let i = 0; i < 8 && (await editorText(page)) !== DOC; i++) await page.keyboard.press('Meta+z')
    // 段中间回车
    await clickStart(page, '第二段正文')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await frame(page, 'split-0', t1, 260)
    await page.keyboard.press('Enter')
    await frame(page, 'split-1', t1, 260)
    for (let i = 0; i < 8 && (await editorText(page)) !== DOC; i++) await page.keyboard.press('Meta+z')

    // 2 ↓ 走过块和块之间
    await clickEnd(page, '列表第二项')
    const t2: [string, number] = ['列表第一项', -30]
    await frame(page, 'down-0', t2, 300)
    await page.keyboard.press('ArrowDown')
    await frame(page, 'down-1', t2, 300)
    await page.keyboard.press('ArrowDown')
    await frame(page, 'down-2', t2, 300)
    // → 走过块和块之间
    await clickEnd(page, '第一段正文')
    await frame(page, 'right-0', t1, 260)
    await page.keyboard.press('ArrowRight')
    await frame(page, 'right-1', t1, 260)
    await page.keyboard.press('ArrowRight')
    await frame(page, 'right-2', t1, 260)

    // 3 段首退格（上一块是段落）
    await clickStart(page, '第二段正文')
    await frame(page, 'bs-0', t1, 260)
    await page.keyboard.press('Backspace')
    await frame(page, 'bs-1', t1, 260)
    await page.keyboard.press('Backspace')
    await frame(page, 'bs-2', t1, 260)
    for (let i = 0; i < 8 && (await editorText(page)) !== DOC; i++) await page.keyboard.press('Meta+z')
    // 段末 Delete
    await clickEnd(page, '第一段正文')
    await frame(page, 'del-0', t1, 260)
    await page.keyboard.press('Delete')
    await frame(page, 'del-1', t1, 260)
    await page.keyboard.press('Delete')
    await frame(page, 'del-2', t1, 260)
    for (let i = 0; i < 8 && (await editorText(page)) !== DOC; i++) await page.keyboard.press('Meta+z')

    // 5 ← 在列表项开头
    await clickStart(page, '列表第二项')
    await frame(page, 'left-0', t2, 200)
    await page.keyboard.press('ArrowLeft')
    await frame(page, 'left-1', t2, 200)
    await page.keyboard.press('ArrowLeft')
    await frame(page, 'left-2', t2, 200)
  } finally {
    await run.close().catch((e) => console.error('关闭慢：', String(e).slice(0, 200)))
  }
})

test('帧：代码块、块部件、文末、点空白', async () => {
  const run = await open()
  const { page } = run
  try {
    // 4 代码块：选中里面的字删掉，再退格三下
    await clickStart(page, 'const a = 1')
    const t4: [string, number] = ['列表第二项', -6]
    await page.keyboard.press('Shift+ArrowDown')
    await page.keyboard.press('Shift+End')
    await frame(page, 'code-0', t4, 260)
    await page.keyboard.press('Backspace')
    await frame(page, 'code-1', t4, 260)
    // 再退格一下、两下、三下各截一张（改前三下都删不掉；改后第一下变回空块、第二下空块也删掉）
    for (const n of [2, 3, 4]) {
      await page.keyboard.press('Backspace')
      await frame(page, `code-${n}`, t4, 260)
    }
    for (let i = 0; i < 8 && (await editorText(page)) !== DOC; i++) await page.keyboard.press('Meta+z')
    // 从引用拖选到待办，按退格
    const a = (await line(page, '一段引用的文字').boundingBox())!
    const b = (await line(page, '待办一').boundingBox())!
    await page.mouse.move(a.x + 40, a.y + a.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + 30, b.y + 4, { steps: 12 })
    await page.mouse.up()
    await frame(page, 'codesel-0', t4, 260)
    await page.keyboard.press('Backspace')
    await frame(page, 'codesel-1', t4, 260)
    for (let i = 0; i < 8 && (await editorText(page)) !== DOC; i++) await page.keyboard.press('Meta+z')

    // 7 ↑ 从提示块标题往上：跳过图片、表格
    await clickStart(page, '提示块标题')
    const t7: [string, number] = ['待办一', -20]
    await frame(page, 'card-0', t7, 600)
    await page.keyboard.press('ArrowUp')
    await frame(page, 'card-1', t7, 600)

    // ↓ 从待办二往下：图片
    await clickEnd(page, '待办二')
    await frame(page, 'cardd-0', t7, 600)
    await page.keyboard.press('ArrowDown')
    await frame(page, 'cardd-1', t7, 600)
    await page.keyboard.press('ArrowDown')
    await frame(page, 'cardd-2', t7, 600)

    // 8 点左右留白（左边点在加号把手那一槽外面）
    // 滚回顶上（滚轮滚的是鼠标底下真在滚的那一层）
    const bb = (await pane(page).locator('.body').first().boundingBox())!
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2)
    await page.mouse.wheel(0, -4000)
    await page.waitForTimeout(500)
    await clickEnd(page, '第二段正文')
    const box = (await pane(page).locator('.cm-content').boundingBox())!
    const p = (await line(page, '第一段正文').boundingBox())!
    const t8 = p.y - 40
    await frame(page, 'margin-0', t8, 200)
    await page.mouse.click(box.x + box.width + 40, p.y + p.height / 2)
    await frame(page, 'margin-right', t8, 200)
    await clickEnd(page, '第二段正文')
    await page.mouse.click(box.x - 70, p.y + p.height / 2)
    await frame(page, 'margin-left', t8, 200)
    // 点第一段和第二段之间的缝
    const q = (await line(page, '第二段正文').boundingBox())!
    await page.mouse.click(box.x + 60, p.y + p.height + 3)
    await frame(page, 'gapclick', t8, 200)
    void q

    // 粘贴带格式的字（合成粘贴事件，不碰系统剪贴板）
    await clickEnd(page, '第一段正文')
    await page.evaluate(() => {
      const dt = new DataTransfer()
      dt.setData('text/plain', '小标题\n要点一\n要点二')
      dt.setData('text/html', '<h2>小标题</h2><ul><li>要点<b>一</b></li><li>要点二</li></ul><p>一段带<a href="https://example.com">链接</a></p>')
      document.querySelector('.pane:not([hidden]) .cm-content')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    })
    await frame(page, 'paste', t8, 330)
  } finally {
    await run.close().catch((e) => console.error('关闭慢：', String(e).slice(0, 200)))
  }
})

test('帧：用户截图那一篇（文末是引文）', async () => {
  const doc = '# 对照测试\n\n> X = torch.arange(24).reshape(2, 3, 4)\n> X\n—— [2.3. 线性代数 — 动手学深度学习 2.0.0 documentation](https://zh.d2l.ai/x.html)\n'
  const run = await open(doc)
  const { page } = run
  try {
    await clickEnd(page, '2.3. 线性代数')
    const t: [string, number] = ['torch.arange', -30]
    await frame(page, 'tail-0', t, 220)
    await page.keyboard.press('ArrowDown')
    await frame(page, 'tail-1', t, 220)
    await page.keyboard.type('接着写')
    await frame(page, 'tail-2', t, 220)
  } finally {
    await run.close().catch((e) => console.error('关闭慢：', String(e).slice(0, 200)))
  }
})

test('帧：只有一个数据库块、块收尾在文件最末（用户报的文末打不了字）', async () => {
  const rooms = '```base\nfilters:\n  and:\n    - file.inFolder("冰岛旅行/住宿")\nviews:\n  - type: table\n    name: 表格\n    order:\n      - file.name\n      - 价格\n```'
  const run = await open(`# 旅行住宿\n\n${rooms}`, '旅行住宿', { '冰岛旅行/住宿/米湖民宿.md': '---\n价格: 900\n---\n', '冰岛旅行/住宿/雷克雅未克公寓.md': '---\n价格: 1500\n---\n' })
  const { page } = run
  try {
    await clickEnd(page, '旅行住宿')
    const t: [string, number] = ['旅行住宿', -20]
    await frame(page, 'db-0', t, 420)
    await page.keyboard.press('ArrowDown')
    await frame(page, 'db-1', t, 420)
    await page.keyboard.press('ArrowDown')
    await frame(page, 'db-2', t, 420)
    await page.keyboard.type('接着写')
    await frame(page, 'db-3', t, 420)
  } finally {
    await run.close().catch((e) => console.error('关闭慢：', String(e).slice(0, 200)))
  }
})

// 整个窗口（设计复审、和改前并排）：天青（浅）、深湖（深），B 浮岛书桌；光标停在回车新起的空块里、文末那一行各一张
for (const tone of ['light', 'dark'] as const) {
  test(`帧：整个窗口（${tone}）`, async () => {
    const run = await launch({ '对照测试.md': DOC, '附件/图.png': PNG }, {}, (vault) => {
      const ud = join(vault, '..', 'user-data')
      mkdirSync(ud, { recursive: true })
      writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: tone === 'dark' ? 'petrol' : 'sky', frame: 'b', winBg: 'aurora' } }))
    })
    const { page } = run
    try {
      await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900))
      await page.setViewportSize({ width: 1440, height: 900 })
      await openNote(page, '对照测试')
      await page.addStyleTag({ content: '.cm-cursorLayer{animation:none!important}' })
      const full = async (name: string) => {
        await page.mouse.move(1430, 890)
        await page.waitForTimeout(500)
        // 等存完（不然改前改后一张写「未保存」一张没有，看图的人以为是这次改出来的）
        await waitSaved(page).catch(() => {})
        const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
        writeFileSync(join(OUT, `${name}-${tone}.png`), Buffer.from(b64, 'base64'))
      }
      // 第二段末尾回车：下面一个空块，光标在里面
      await clickEnd(page, '第二段正文')
      await page.keyboard.press('Enter')
      await full('page-enter')
      for (let i = 0; i < 4 && (await editorText(page)) !== DOC; i++) await page.keyboard.press('Meta+z')
      // 列表第二项末尾 ↓：进引用（改前停在两块之间，那一行撑开）
      await clickEnd(page, '列表第二项')
      await page.keyboard.press('ArrowDown')
      await full('page-down')
      // 待办二末尾 ↓：选中图片（改前一下跳过图片），看两套主题里选中那层底
      await clickEnd(page, '待办二')
      await page.keyboard.press('ArrowDown')
      await full('page-card')
      // 再 ↓：选中紧挨着的表格（深底的卡，选中那层底最难看出来的情形）
      await page.keyboard.press('ArrowDown')
      await full('page-table')
      // 邻页：同一篇切到白板（这次没动它，前后应该一样）
      await acts(page).getByRole('tab', { name: '白板' }).click()
      await page.waitForTimeout(800)
      await full('page-board')
    } finally {
      await run.close().catch((e) => console.error('关闭慢：', String(e).slice(0, 200)))
    }
  })
}
