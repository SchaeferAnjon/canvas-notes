/**
 * task-axoxy 第二条线：Fable 5.2 块手感顾问报告（设计稿目录 canvas-notes-visual/30-块手感顾问报告/）里三条结构改法管不到的 9 条
 * （编号对报告：8、9、11、14、16、17、20、21、22），每条照报告的复现按键真按，先在旧代码上跑红、改完转绿；
 * 改了文件的几条读磁盘上的 md 原文。断言不写死「几个空行是一个空块」（空块怎么存是结构线在定），只看光标停在哪、文件里块分没分开。
 * AXOXY_SHOTS=<目录> 时每条在关键一步截图（交付页的改前改后对照），文件名 <编号>-<AXOXY_PHASE>-<哪一步>.png。
 */
import { expect, type Page, test } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { editorText, launch, openNote, pane, type Running, waitSaved } from './app'

const ed = (page: Page) => pane(page).locator('.cm-content')
const line = (page: Page, text: string) => ed(page).locator('.cm-line', { hasText: text }).first()

const SHOTS = process.env.AXOXY_SHOTS
const PHASE = process.env.AXOXY_PHASE ?? 'after'

async function shot(page: Page, name: string, clip = { x: 430, y: 60, width: 620, height: 400 }) {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  // 窗口不上屏、没有系统焦点时编辑器不画光标：截图时在光标那里画一道红竖线（选区的另一头画浅蓝竖线），截完拿掉；
  // 光标在截图里的位置另存一份 json（交付页的框框在这里）
  const at = await ed(page).evaluate((el) => {
    const v = (el as HTMLElement & { cmTile: { view: any } }).cmTile.view
    const r = v.state.selection.main
    const out: { x: number; y: number; h: number }[] = []
    const bar = (pos: number, color: string) => {
      // 行尾先取前一个字那一边（行尾挂着的小块，比如待办的「定日子」，在光标后面）
      const end = pos === v.state.doc.lineAt(pos).to && pos > v.state.doc.lineAt(pos).from
      const c = (end ? v.coordsAtPos(pos, -1) : v.coordsAtPos(pos, 1)) ?? v.coordsAtPos(pos, end ? 1 : -1)
      if (!c) return
      const h = Math.max(16, c.bottom - c.top)
      const d = document.createElement('div')
      d.className = 'axoxy-caret'
      d.style.cssText = `position:fixed;z-index:99999;pointer-events:none;left:${c.left - 1}px;top:${c.top}px;width:2px;height:${h}px;background:${color}`
      document.body.appendChild(d)
      out.push({ x: c.left, y: c.top, h })
    }
    if (!r.empty) bar(r.anchor, '#4a90d9')
    bar(r.head, '#e0302a')
    return out
  })
  await page.waitForTimeout(150)
  const file = join(SHOTS, `${name.replace(/-/, `-${PHASE}-`)}`)
  await page.screenshot({ path: file + '.png', clip })
  writeFileSync(file + '.json', JSON.stringify(at.map((a) => ({ x: a.x - clip.x, y: a.y - clip.y, h: a.h }))))
  await page.evaluate(() => document.querySelectorAll('.axoxy-caret').forEach((d) => d.remove()))
}

/** 光标在 md 原文里第几行（从 1 数）、第几个字、那一行的字；有选区时 from/to、anchor/head */
async function caret(page: Page) {
  const { sel, text } = await pane(page)
    .locator('.cm-editor')
    .evaluate((el) => ({ sel: (el as HTMLElement & { cnSel: { anchor: number; head: number } }).cnSel, text: (el as HTMLElement & { cnText: string }).cnText }))
  const before = text.slice(0, sel.head)
  const lineNo = before.split('\n').length
  const lineStart = before.lastIndexOf('\n') + 1
  const end = text.indexOf('\n', sel.head)
  return { line: lineNo, col: sel.head - lineStart, text: text.slice(lineStart, end === -1 ? text.length : end), head: sel.head, anchor: sel.anchor }
}

/**
 * 光标看得见、不在块缝上（gap-lines.ts 的数法，照 Tolaria：一串空行第一行是缝，文件开头那一串最后一行是缝，标题前最后一行是留白，别的是空块）；
 * 光标画出来有高度
 */
async function caretOk(page: Page) {
  return ed(page).evaluate((el) => {
    const v = (el as HTMLElement & { cmTile: { view: any } }).cmTile.view
    const s = v.state
    const head = s.selection.main.head
    const ln = s.doc.lineAt(head)
    const blank = (n: number) => n >= 1 && n <= s.doc.lines && s.doc.line(n).text.trim() === ''
    let first = ln.number
    while (blank(first - 1)) first--
    let last = ln.number
    while (blank(last + 1)) last++
    const heading = (n: number) => n <= s.doc.lines && /^ {0,3}#{1,6}(\s|$)/.test(s.doc.line(n).text)
    const n = ln.number
    const onGap =
      blank(n) && last < s.doc.lines && (first === 1 ? n === last : n === first || (n === last && last > first && heading(last + 1)))
    const c = v.coordsAtPos(head, 1) ?? v.coordsAtPos(head, -1)
    return { onGap, height: c ? Math.round(c.bottom - c.top) : 0, focused: v.hasFocus as boolean }
  })
}

async function expectCaretOk(page: Page, what: string) {
  const r = await caretOk(page)
  expect(r.onGap, `${what}：光标停在块缝上`).toBe(false)
  expect(r.height, `${what}：光标高度`).toBeGreaterThan(10)
}

async function expectCaretOkSoft(page: Page, what: string) {
  const r = await caretOk(page)
  expect.soft(r.onGap, `${what}：光标停在块缝上`).toBe(false)
  expect.soft(r.height, `${what}：光标高度`).toBeGreaterThan(10)
}

async function toStart(page: Page, text: string) {
  await line(page, text).click()
  await page.keyboard.press('Home')
}
async function toEnd(page: Page, text: string) {
  await line(page, text).click()
  await page.keyboard.press('End')
  await page.keyboard.press('End')
}

/** md 里第一个 needle 后面第 off 个字前面那一点的屏幕坐标 */
async function xy(page: Page, needle: string, off = 0) {
  return ed(page).evaluate(
    (el, [needle, off]) => {
      const v = (el as HTMLElement & { cmTile: { view: any } }).cmTile.view
      const pos = v.state.doc.toString().indexOf(needle as string) + (off as number)
      const c = v.coordsAtPos(pos, 1) ?? v.coordsAtPos(pos, -1)
      return { x: c.left + 1, y: (c.top + c.bottom) / 2 }
    },
    [needle, off] as const,
  )
}

/** 真点到 needle 后面第 off 个字前面 */
async function clickAt(page: Page, needle: string, off = 0) {
  const p = await xy(page, needle, off)
  await page.mouse.click(p.x, p.y)
}

async function paste(page: Page, data: Record<string, string>) {
  await page.evaluate((data) => {
    const dt = new DataTransfer()
    for (const [k, v] of Object.entries(data)) dt.setData(k, v)
    document.querySelector('.pane:not([hidden]) .cm-content')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, data)
}

async function open(name: string, doc: string): Promise<Running> {
  const run = await launch({ [name + '.md']: doc })
  await run.page.setViewportSize({ width: 1440, height: 900 })
  await openNote(run.page, name)
  return run
}

/** 存好以后磁盘上的 md 原文 */
async function disk(run: Running, name: string) {
  await waitSaved(run.page)
  return readFileSync(join(run.vault, name + '.md'), 'utf8')
}

/** 连着按 key，一直到 done 成立（最多 max 下）；每一下都要挪了光标（按了不动就是卡住），返回按了几下 */
async function pressUntil(page: Page, key: string, done: (c: Awaited<ReturnType<typeof caret>>) => boolean, max: number) {
  for (let i = 1; i <= max; i++) {
    const was = (await caret(page)).head
    await page.keyboard.press(key)
    const c = await caret(page)
    if (done(c)) return i
    expect(c.head, `按 ${key} 第 ${i} 下光标没动（${c.line} 行 ${c.col} 字「${c.text}」）`).not.toBe(was)
  }
  throw new Error(`按了 ${max} 下 ${key} 还没到`)
}

test.describe.configure({ timeout: 120_000 })

const FLOW = '# 流\n\n第一段正文。\n\n第二段正文。\n\n第三段正文。\n'

test('第 8 条 空块里按 →（⌃F 一样）走到下一块开头，不卡在空块里', async () => {
  const DOC = '# 空\n\n上段。\n\n\n\n下段。\n'
  const run = await open('空', DOC)
  const { page } = run
  try {
    await toEnd(page, '上段')
    await page.keyboard.press('ArrowRight')
    const inBlock = await caret(page)
    expect(inBlock.text, '上段末尾 → 进到空块').toBe('')
    await expectCaretOk(page, '→ 进空块')
    // 截图：按到「下段。」为止（最多三下；改前一直在空块里）
    for (let i = 0; i < 3 && (await caret(page)).text !== '下段。'; i++) await page.keyboard.press('ArrowRight')
    await shot(page, '08-right')
    // 再来一遍，每一下都看：空块里 → 要挪
    await toEnd(page, '上段')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    expect((await caret(page)).head, '空块里 → 光标没动').not.toBe(inBlock.head)
    if ((await caret(page)).text !== '下段。') await pressUntil(page, 'ArrowRight', (c) => c.text === '下段。', 3)
    const c = await caret(page)
    expect(c.col, '到下段开头').toBe(0)
    // ← 回来：先进空块，再到上段末尾
    await pressUntil(page, 'ArrowLeft', (c) => c.text === '上段。', 4)
    expect((await caret(page)).col).toBe(3)
    // ⌃F（Emacs 的 →）一样
    await page.keyboard.press('ArrowRight')
    await pressUntil(page, 'Control+f', (c) => c.text === '下段。', 3)
    expect(await editorText(page)).toBe(DOC)
  } finally {
    await run.close()
  }
  // 空块下面是标题（中间那一行是标题上方的留白，也是缝）：→ 一样走得过去，← 回得来
  const DOC2 = '# 空\n\n上段。\n\n\n\n## 下标题\n\n尾。\n'
  const run2 = await open('空', DOC2)
  try {
    const page2 = run2.page
    await toEnd(page2, '上段')
    await page2.keyboard.press('ArrowRight')
    expect((await caret(page2)).text, '→ 进空块').toBe('')
    await expectCaretOk(page2, '标题上面的空块')
    await pressUntil(page2, 'ArrowRight', (c) => c.text === '## 下标题', 3)
    expect((await caret(page2)).col, '到标题的字前面').toBe(3)
    await pressUntil(page2, 'ArrowLeft', (c) => c.text === '', 2)
    await expectCaretOk(page2, '← 回空块')
    expect(await editorText(page2)).toBe(DOC2)
  } finally {
    await run2.close()
  }
})

test('第 9 条 代码块：最后一行末尾 → 到下一块开头，↓ 也出得去；第一行 ↑ 到上一块，不停在缝上', async () => {
  const DOC = '# 码\n\n上一段。\n\n```js\nconst a = 1\nlet b = 2\n```\n\n下一段。\n'
  const run = await open('码', DOC)
  const { page } = run
  try {
    await toEnd(page, 'let b = 2')
    await page.keyboard.press('ArrowRight')
    await shot(page, '09-right')
    let c = await caret(page)
    expect.soft(c.text, '代码最后一行末尾 → 到下一段').toBe('下一段。')
    expect.soft(c.col).toBe(0)
    await expectCaretOkSoft(page, '→ 出代码块')
    // ← 回到代码最后一行末尾
    await page.keyboard.press('ArrowLeft')
    c = await caret(page)
    expect.soft(c.text).toBe('let b = 2')
    expect.soft(c.col).toBe(9)
    // ↓ 出去
    await page.keyboard.press('ArrowDown')
    expect.soft((await caret(page)).text, '代码最后一行 ↓').toBe('下一段。')
    // 第一行 ↑：一下到上一段，光标看得见
    await toStart(page, 'const a')
    await page.keyboard.press('ArrowUp')
    await shot(page, '09-up')
    c = await caret(page)
    expect(c.text, '代码第一行 ↑ 到上一段').toBe('上一段。')
    await expectCaretOk(page, '↑ 出代码块')
    // 在那里打字：进的是上一段（横向照原来那一列），不贴在代码块上面另起一行
    await page.keyboard.type('字')
    expect(await disk(run, '码')).toMatch(/\n\n(字上一段。|上字一段。)\n\n```js\n/)
    // ⌃F 在代码最后一行末尾也走得出去
    await toEnd(page, 'let b = 2')
    await page.keyboard.press('Control+f')
    expect((await caret(page)).text, '⌃F 出代码块').toBe('下一段。')
    await expectCaretOk(page, '⌃F 出代码块')
  } finally {
    await run.close()
  }
})

test('第 11 条 文首回车上面正好多一个空块；标题开头回车上面也多一个空块（光标进得去），标题跟着往下；⌘Z 一下回来', async () => {
  const DOC = '第一段。\n\n第二段。\n'
  const run = await open('首', DOC)
  const { page } = run
  try {
    await toStart(page, '第一段')
    await page.keyboard.press('Enter')
    let c = await caret(page)
    expect(c.text, '文首回车：光标跟着字往下').toBe('第一段。')
    expect(c.col).toBe(0)
    await page.keyboard.press('ArrowUp')
    await shot(page, '11-top')
    c = await caret(page)
    expect.soft(c.text, '↑ 进到上面的空块').toBe('')
    await expectCaretOkSoft(page, '文首空块')
    const first = c.head
    // 再 ↑：上面没有第二个空块了
    await page.keyboard.press('ArrowUp')
    expect.soft((await caret(page)).head, '文首回车一次只多一个空块').toBe(first)
    await page.keyboard.type('x')
    expect.soft(await disk(run, '首')).toBe('x\n\n第一段。\n\n第二段。\n')
  } finally {
    await run.close()
  }

  const DOC2 = '# 流\n\n第一段。\n\n## 小标题\n\n第二段。\n'
  const run2 = await open('流', DOC2)
  try {
    const page2 = run2.page
    await toStart(page2, '小标题')
    await page2.keyboard.press('Enter')
    await shot(page2, '11-heading')
    let c = await caret(page2)
    expect(c.text, '标题开头回车：光标还在标题上').toBe('## 小标题')
    expect(c.col).toBe(3)
    await page2.keyboard.press('ArrowUp')
    c = await caret(page2)
    expect(c.text, '标题上面多了一个空块，↑ 进得去').toBe('')
    await expectCaretOk(page2, '标题上面的空块')
    await page2.keyboard.type('x')
    const after = await disk(run2, '流')
    expect(after).toMatch(/^# 流\n\n第一段。\n\nx\n\n+## 小标题\n\n第二段。\n$/)
    // ⌘Z 回到回车之前
    await page2.keyboard.press('Meta+z')
    await page2.keyboard.press('Meta+z')
    await expect.poll(() => editorText(page2)).toBe(DOC2)
  } finally {
    await run2.close()
  }
})

test('第 14 条 ↑↓ 经过空块以后横向位置不丢', async () => {
  const DOC = '# 横\n\n第一段正文比较长一些。\n\n\n\n短。\n\n第三段正文也比较长一些。\n'
  const run = await open('横', DOC)
  const { page } = run
  try {
    await clickAt(page, '第一段正文', 6)
    expect((await caret(page)).col).toBe(6)
    await pressUntil(page, 'ArrowDown', (c) => c.text === '短。', 4)
    await shot(page, '14-short')
    expect.soft((await caret(page)).col, '到「短。」在行尾（那一列比它长）').toBe(2)
    await page.keyboard.press('ArrowDown')
    await shot(page, '14-third')
    let c = await caret(page)
    expect(c.text).toBe('第三段正文也比较长一些。')
    expect(c.col, '到第三段回到原来那一列').toBe(6)
    await pressUntil(page, 'ArrowUp', (c) => c.text === '第一段正文比较长一些。', 5)
    c = await caret(page)
    expect(c.col, '回到第一段还是原来那一列').toBe(6)
  } finally {
    await run.close()
  }
})

test('第 16 条 列表、待办、编号的第一项按 Tab 不动（上面没有能挂的一项）；第二项照旧缩进', async () => {
  const DOC = '# 办\n\n- [ ] 待办一\n- [ ] 待办二\n\n1. 编号一\n2. 编号二\n\n- 列表一\n- 列表二\n\n尾。\n'
  const run = await open('办', DOC)
  const { page } = run
  try {
    await toEnd(page, '待办一')
    await page.keyboard.press('Tab')
    await shot(page, '16-tab')
    expect(await editorText(page), '第一条待办 Tab').toBe(DOC)
    await toEnd(page, '编号一')
    await page.keyboard.press('Tab')
    await toEnd(page, '列表一')
    await page.keyboard.press('Tab')
    expect(await editorText(page), '第一个编号、第一个列表项 Tab').toBe(DOC)
    // 第二项照旧缩进成第一项的子项；缩进以后它是子列表的第一项，再 Tab 不动
    await toEnd(page, '待办二')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    expect(await disk(run, '办')).toBe(DOC.replace('\n- [ ] 待办二', '\n  - [ ] 待办二'))
    await page.keyboard.press('Shift+Tab')
    expect(await disk(run, '办')).toBe(DOC)
  } finally {
    await run.close()
  }
})

test('第 17 条 ⇧→ / ⇧← 一下跨块（不先选那个看不见的换行）', async () => {
  const run = await open('流', FLOW)
  const { page } = run
  try {
    await toEnd(page, '第一段正文')
    await page.keyboard.press('Shift+ArrowRight')
    await shot(page, '17-shift-right')
    // 段尾那个换行选上了：画一小截选区色（系统选区涂不出换行）
    await expect.soft(pane(page).locator('.cm-selbreak'), '段尾画出选上的换行').toHaveCount(1)
    let c = await caret(page)
    expect(c.text, '⇧→ 一下到下一块开头').toBe('第二段正文。')
    expect(c.col).toBe(0)
    await page.keyboard.press('Shift+ArrowRight')
    c = await caret(page)
    expect(c.col, '再 ⇧→ 选进第二段第一个字').toBe(1)
    // ⇧← 两下回到第一段末尾（选区收没了）
    await page.keyboard.press('Shift+ArrowLeft')
    await page.keyboard.press('Shift+ArrowLeft')
    c = await caret(page)
    expect(c.text, '⇧← 一下跨回上一块末尾').toBe('第一段正文。')
    expect(c.head).toBe(c.anchor)
    // 从第二段开头 ⇧← 一下到第一段末尾
    await toStart(page, '第二段正文')
    await page.keyboard.press('Shift+ArrowLeft')
    c = await caret(page)
    expect(c.text).toBe('第一段正文。')
    expect(c.col).toBe(6)
    // 选着跨块的字删掉：两块并成一块（跨块删的老规矩）
    await page.keyboard.press('Backspace')
    expect(await disk(run, '流')).toBe('# 流\n\n第一段正文。第二段正文。\n\n第三段正文。\n')
  } finally {
    await run.close()
  }
})

test('第 20 条 粘贴网页里的空 div：不留只有空格的行，连着的空行压成一个', async () => {
  const run = await open('流', FLOW)
  const { page } = run
  try {
    await toEnd(page, '第三段正文')
    await page.keyboard.press('Enter')
    const html = '<meta charset="utf-8"><p>网页第一段</p><p>网页第二段<br>换行后</p><p>&nbsp;</p><p>空段后</p><div><br></div><div>div 一行</div>'
    await paste(page, { 'text/html': html, 'text/plain': '网页第一段\n网页第二段\n换行后\n\n空段后\n\ndiv 一行' })
    await shot(page, '20-paste', { x: 430, y: 200, width: 620, height: 420 })
    const md = await disk(run, '流')
    expect(md, '没有只有空白的行').not.toMatch(/\n[ \t]+\n/)
    expect(md).toContain('空段后\n\ndiv 一行')
    expect(md).toContain('网页第一段\n\n网页第二段')
    expect(md, '贴进来的几段之间不多出空块').not.toMatch(/网页第一段[\s\S]*\n\n\n[\s\S]*div 一行/)
    expect(md.endsWith('div 一行\n')).toBe(true)
  } finally {
    await run.close()
  }
})

test('第 21 条 AI 块：末尾回车两下出块，块里的字没变，头上不写「改过」；块里真打了字才写', async () => {
  const HEAD = '> [!ai] AI 写的 · Claude Code · Opus 5.5'
  const DOC = `# 卡\n\n上一段。\n\n${HEAD}\n> AI 第一段。\n>\n> AI 第二段。\n\n块下面一段。\n`
  const run = await open('卡', DOC)
  const { page } = run
  try {
    await toEnd(page, 'AI 第二段')
    await page.keyboard.press('Enter')
    const once = await editorText(page)
    await page.keyboard.press('Enter')
    await page.keyboard.type('我')
    await shot(page, '21-out')
    expect(once, '回车一下（块里续一行）').toContain(HEAD + '\n')
    let md = await disk(run, '卡')
    expect(md, '头上没有「改过」').toContain(HEAD + '\n')
    expect(md).toContain('> AI 第二段。\n\n我\n\n块下面一段。\n')
    // 块里真打了字：写「改过」（老规矩不变）
    await toEnd(page, 'AI 第一段')
    await page.keyboard.type('加')
    md = await disk(run, '卡')
    expect(md).toContain('> [!ai] AI 写的 · Claude Code · Opus 5.5 · 改过\n> AI 第一段。加\n')
  } finally {
    await run.close()
  }
})

test('第 22 条 点标题上面的留白：光标落到第一行，编辑器不失焦，接着打的字进文档', async () => {
  const run = await open('流', FLOW)
  const { page } = run
  try {
    await clickAt(page, '第二段正文', 2)
    // 标题上面那条留白：标签条下面、第一行上面
    const top = await ed(page).evaluate((el) => {
      const v = (el as HTMLElement & { cmTile: { view: any } }).cmTile.view
      const c = v.coordsAtPos(0, 1)
      const r = (el as HTMLElement).getBoundingClientRect()
      return { x: r.left + r.width / 2, y: c.top - 14, lineTop: c.top }
    })
    const hit = await page.evaluate(([x, y]) => {
      const t = document.elementFromPoint(x, y) as HTMLElement | null
      return t ? `${t.tagName}.${t.className}` : ''
    }, [top.x, top.y] as const)
    expect(hit, '点的是留白（不是按钮）').not.toMatch(/BUTTON/)
    await page.mouse.click(top.x, top.y)
    const r = await caretOk(page)
    const c0 = await caret(page)
    await page.keyboard.type('abc')
    await shot(page, '22-typed', { x: 430, y: 0, width: 760, height: 400 })
    expect(r.focused, '编辑器没失焦').toBe(true)
    expect(c0.line, '光标落到第一行').toBe(1)
    const c = await caret(page)
    expect(c.line).toBe(1)
    expect(c.text, '打的字进了第一行').toContain('abc')
  } finally {
    await run.close()
  }
})
