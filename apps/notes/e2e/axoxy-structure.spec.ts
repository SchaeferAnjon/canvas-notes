/**
 * task-axoxy 文档打字和块的三条结构改法（Fable 5.2 顾问报告 设计稿目录 canvas-notes-visual/30-块手感顾问报告/ 的「整体看法」）：
 * 改完规整、空块一套存法、拿掉记号连同空行一起改。报告里归到这三条的 13 条（编号对报告），每条照报告的按键真按，
 * 先在旧代码上跑红、改完转绿；「改坏文件」的 1–5 条都读磁盘上的 md 原文。
 * AXOXY_SHOTS=<目录> 时每条在关键一步截图（交付页的改前改后对照），文件名 <编号>-<AXOXY_PHASE>-<哪一步>.png。
 */
import { expect, type Page, test } from '@playwright/test'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { editorText, launch, openNote, pane, type Running, waitSaved } from './app'

const ed = (page: Page) => pane(page).locator('.cm-content')
const line = (page: Page, text: string) => ed(page).locator('.cm-line', { hasText: text }).first()

const SHOTS = process.env.AXOXY_SHOTS
const PHASE = process.env.AXOXY_PHASE ?? 'after'

async function shot(page: Page, name: string) {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  await page.waitForTimeout(150)
  await page.screenshot({ path: join(SHOTS, `${name.replace(/-/, `-${PHASE}-`)}.png`), clip: { x: 430, y: 60, width: 760, height: 560 } })
}

/** 光标在 md 原文里第几行（从 1 数）、第几个字、那一行的字；有选区时 from/to */
async function caret(page: Page) {
  const { sel, text } = await pane(page)
    .locator('.cm-editor')
    .evaluate((el) => ({ sel: (el as HTMLElement & { cnSel: { anchor: number; head: number } }).cnSel, text: (el as HTMLElement & { cnText: string }).cnText }))
  const before = text.slice(0, sel.head)
  const lineNo = before.split('\n').length
  const lineStart = before.lastIndexOf('\n') + 1
  const end = text.indexOf('\n', sel.head)
  return { line: lineNo, col: sel.head - lineStart, text: text.slice(lineStart, end === -1 ? text.length : end), from: Math.min(sel.anchor, sel.head), to: Math.max(sel.anchor, sel.head) }
}

/**
 * 光标看得见、不在块缝上（gap-lines.ts 的数法）；光标画出来有高度
 */
async function caretOk(page: Page) {
  return ed(page).evaluate((el) => {
    const v = (el as HTMLElement & { cmTile: { view: any } }).cmTile.view
    const s = v.state
    const head = s.selection.main.head
    const ln = s.doc.lineAt(head)
    const blank = (n: number) => n >= 1 && n <= s.doc.lines && s.doc.line(n).text.trim() === ''
    // 空行的数法（gap-lines.ts，Tolaria）：一串空行第一行是缝，标题前最后一行是留白，别的是空块
    let first = ln.number
    while (blank(first - 1)) first--
    let last = ln.number
    while (blank(last + 1)) last++
    const heading = (n: number) => n <= s.doc.lines && /^ {0,3}#{1,6}(\s|$)/.test(s.doc.line(n).text)
    const onGap = blank(ln.number) && ln.number < s.doc.lines && ((first > 1 && ln.number === first) || (ln.number === last && last > first && heading(last + 1)))
    const c = v.coordsAtPos(head, 1) ?? v.coordsAtPos(head, -1)
    return { onGap, height: c ? Math.round(c.bottom - c.top) : 0 }
  })
}

async function expectCaretOk(page: Page, what: string) {
  const r = await caretOk(page)
  expect(r.onGap, `${what}：光标停在块缝上`).toBe(false)
  expect(r.height, `${what}：光标高度`).toBeGreaterThan(10)
}

/** 屏上空块里的灰字「输入 / 插入块」有几处（文末那一行常驻的那份不算） */
const placeholders = (page: Page) => pane(page).locator('.cm-blockph').count()

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

/** 合成一次复制 / 剪切（不碰系统剪贴板，走编辑器同一段处理代码），拿到写进剪贴板的东西 */
async function clip(page: Page, kind: 'copy' | 'cut'): Promise<Record<string, string>> {
  return page.evaluate((kind) => {
    const dt = new DataTransfer()
    document.querySelector('.pane:not([hidden]) .cm-content')!.dispatchEvent(new ClipboardEvent(kind, { clipboardData: dt, bubbles: true, cancelable: true }))
    const o: Record<string, string> = {}
    for (const t of dt.types) o[t] = dt.getData(t)
    return o
  }, kind)
}

async function paste(page: Page, data: Record<string, string>) {
  await page.evaluate((data) => {
    const dt = new DataTransfer()
    for (const [k, v] of Object.entries(data)) dt.setData(k, v)
    document.querySelector('.pane:not([hidden]) .cm-content')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, data)
}

async function open(name: string, doc: string, extra: Record<string, string | Uint8Array> = {}): Promise<Running> {
  const run = await launch({ [name + '.md']: doc, ...extra })
  await run.page.setViewportSize({ width: 1440, height: 900 })
  await openNote(run.page, name)
  return run
}

const file = (run: Running, name: string) => readFileSync(join(run.vault, name + '.md'), 'utf8')

/** 存好以后磁盘上的 md 原文 */
async function disk(run: Running, name: string) {
  await waitSaved(run.page)
  return file(run, name)
}

test.describe.configure({ timeout: 120_000 })

const FLOW = '# 流\n\n第一段正文。\n\n第二段正文。\n\n第三段正文。\n'

test('第 1 条 三击选一段再打字：只换掉这一段的字，下一段不并进来；三击再退格留一个空块，光标在里面', async () => {
  const run = await open('流', FLOW)
  const { page } = run
  try {
    const a = await xy(page, '第一段正文', 2)
    await page.mouse.click(a.x, a.y, { clickCount: 3 })
    await page.keyboard.type('重新写的第一段。')
    await shot(page, '01-retyped')
    expect(await editorText(page)).toBe('# 流\n\n重新写的第一段。\n\n第二段正文。\n\n第三段正文。\n')
    expect(await disk(run, '流')).toBe('# 流\n\n重新写的第一段。\n\n第二段正文。\n\n第三段正文。\n')
    // 三击第二段再退格：这一块的字没了、块还在（像 Notion 删光一块的字），光标在空块里、看得见，灰字只这一处
    const b = await xy(page, '第二段正文', 2)
    await page.mouse.click(b.x, b.y, { clickCount: 3 })
    await page.keyboard.press('Backspace')
    await shot(page, '01-backspace')
    expect(await editorText(page)).toBe('# 流\n\n重新写的第一段。\n\n\n第三段正文。\n')
    await expectCaretOk(page, '三击再退格')
    expect(await placeholders(page)).toBe(1)
    await page.keyboard.type('字')
    expect(await editorText(page)).toBe('# 流\n\n重新写的第一段。\n\n字\n\n第三段正文。\n')
    expect(await disk(run, '流')).toBe('# 流\n\n重新写的第一段。\n\n字\n\n第三段正文。\n')
    // ⌘Z 回去：打的字一步、退格一步（半秒内连着按 CodeMirror 并成一步，所以最多两下）
    const back = '# 流\n\n重新写的第一段。\n\n第二段正文。\n\n第三段正文。\n'
    for (let i = 0; i < 2 && (await editorText(page)) !== back; i++) await page.keyboard.press('Meta+z')
    await expect.poll(() => editorText(page)).toBe(back)
  } finally {
    await run.close()
  }
})

test('第 2 条 没选字 ⌘C 再 ⌘V：贴进来的是单独一块；没选字 ⌘X：整块剪走，光标到下一块开头，接着打的字不并段', async () => {
  const run = await open('流', FLOW)
  const { page } = run
  try {
    await clickAt(page, '第一段正文', 2)
    const c = await clip(page, 'copy')
    expect(c['text/plain']).toContain('第一段正文。')
    await clickAt(page, '第三段正文', 2)
    await paste(page, c)
    await shot(page, '02-paste')
    expect(await editorText(page)).toBe('# 流\n\n第一段正文。\n\n第二段正文。\n\n第一段正文。\n\n第三段正文。\n')
    expect(await disk(run, '流')).toBe('# 流\n\n第一段正文。\n\n第二段正文。\n\n第一段正文。\n\n第三段正文。\n')
    await page.keyboard.press('Meta+z')
    await expect.poll(() => editorText(page)).toBe(FLOW)
    // 没选字剪切：第二段整块走了，块和块之间还是一个空行，光标在第三段开头
    await clickAt(page, '第二段正文', 2)
    const x = await clip(page, 'cut')
    expect(x['text/plain']).toContain('第二段正文。')
    await shot(page, '02-cut')
    expect(await editorText(page)).toBe('# 流\n\n第一段正文。\n\n第三段正文。\n')
    expect(await caret(page)).toMatchObject({ text: '第三段正文。', col: 0 })
    await expectCaretOk(page, '剪切以后')
    await page.keyboard.type('字')
    expect(await disk(run, '流')).toBe('# 流\n\n第一段正文。\n\n字第三段正文。\n')
  } finally {
    await run.close()
  }
})

const LISTS = '# 列\n\n段落一。\n\n- 列表一\n- 列表二\n- 列表三\n\n1. 编号甲\n2. 编号乙\n3. 编号丙\n\n- 外项\n  - 内项\n\n尾。\n'

test('第 3 条 空的列表项回车出列表：这一行上下各一个空行，是一个空块（有灰字），接着写的正文不算列表的续行；编号重排；子项先退一级', async () => {
  const run = await open('列', LISTS)
  const { page } = run
  try {
    // 列表中间出列表：列表拆成两段，中间是一个空块
    await toEnd(page, '列表一')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await shot(page, '03-exit')
    expect(await editorText(page)).toBe(LISTS.replace('- 列表一\n- 列表二', '- 列表一\n\n\n- 列表二'))
    await expectCaretOk(page, '出列表以后')
    expect(await placeholders(page)).toBe(1)
    await page.keyboard.type('出来的一段')
    await page.keyboard.press('Enter')
    await page.keyboard.type('再一段')
    await shot(page, '03-typed')
    expect(await disk(run, '列')).toBe(LISTS.replace('- 列表一\n- 列表二', '- 列表一\n\n出来的一段\n\n再一段\n\n- 列表二'))
    // 编号列表中间出列表：后面那一截从 1 重新数
    await toEnd(page, '编号乙')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.type('编号中间')
    expect(await editorText(page)).toContain('1. 编号甲\n2. 编号乙\n\n编号中间\n\n1. 编号丙\n')
    // 套着的子项里空项回车：先退一级（成了上一级的一项），再回车才出列表
    await toEnd(page, '内项')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    expect(await editorText(page)).toContain('- 外项\n  - 内项\n- \n\n尾。')
    await page.keyboard.press('Enter')
    await page.keyboard.type('子项出来')
    expect(await disk(run, '列')).toContain('- 外项\n  - 内项\n\n子项出来\n\n尾。\n')
  } finally {
    await run.close()
  }
})

const QUOTES = '# 引\n\n- 列表一\n- 列表二\n\n1. 编号甲\n2. 编号乙\n3. 编号丙\n\n> 引用一\n> 引用二\n\n> [!tip] 提示\n> 提示正文\n\n尾。\n'

test('第 4 条 不是第一行的行首退格：引用里一下并到上一行；列表项变成独立的一段（上下空行、编号重排）；提示块正文第一行不并进标题', async () => {
  const run = await open('引', QUOTES)
  const { page } = run
  try {
    await toStart(page, '引用二')
    await page.keyboard.press('Backspace')
    await shot(page, '04-quote')
    expect(await editorText(page)).toContain('> 引用一引用二\n\n')
    expect(await caret(page)).toMatchObject({ text: '> 引用一引用二', col: '> 引用一'.length })
    await toStart(page, '列表二')
    await page.keyboard.press('Backspace')
    await shot(page, '04-list')
    expect(await editorText(page)).toContain('- 列表一\n\n列表二\n\n1. 编号甲')
    await expectCaretOk(page, '列表项退格以后')
    await toStart(page, '编号乙')
    await page.keyboard.press('Backspace')
    expect(await editorText(page)).toContain('1. 编号甲\n\n编号乙\n\n1. 编号丙\n\n')
    // 提示块正文第一行：不把正文并进标题，光标走到标题末尾
    await toStart(page, '提示正文')
    await page.keyboard.press('Backspace')
    expect(await editorText(page)).toContain('> [!tip] 提示\n> 提示正文\n')
    expect(await disk(run, '引')).toBe('# 引\n\n- 列表一\n\n列表二\n\n1. 编号甲\n\n编号乙\n\n1. 编号丙\n\n> 引用一引用二\n\n> [!tip] 提示\n> 提示正文\n\n尾。\n')
  } finally {
    await run.close()
  }
})

test('第 5 条 粘贴几行纯文本：一行一块；末尾带换行的一行：贴在光标这里，光标看得见', async () => {
  const run = await open('流', FLOW)
  const { page } = run
  try {
    await toEnd(page, '第一段正文')
    await page.keyboard.press('Enter')
    await paste(page, { 'text/plain': '甲行\n乙行\n丙行' })
    await shot(page, '05-lines')
    expect(await editorText(page)).toBe('# 流\n\n第一段正文。\n\n甲行\n\n乙行\n\n丙行\n\n第二段正文。\n\n第三段正文。\n')
    expect(await caret(page)).toMatchObject({ text: '丙行', col: 2 })
    expect(await disk(run, '流')).toBe('# 流\n\n第一段正文。\n\n甲行\n\n乙行\n\n丙行\n\n第二段正文。\n\n第三段正文。\n')
    await toEnd(page, '第二段正文')
    await page.keyboard.press('Enter')
    await paste(page, { 'text/plain': '行尾带换行\n' })
    expect(await caret(page)).toMatchObject({ text: '行尾带换行', col: 5 })
    await expectCaretOk(page, '贴完带尾换行的一行')
    // 列表、引用连着的几行不拆
    await toEnd(page, '第三段正文')
    await page.keyboard.press('Enter')
    await paste(page, { 'text/plain': '- 甲\n- 乙\n> 引一\n> 引二\n末行' })
    expect(await disk(run, '流')).toBe('# 流\n\n第一段正文。\n\n甲行\n\n乙行\n\n丙行\n\n第二段正文。\n\n行尾带换行\n\n第三段正文。\n\n- 甲\n- 乙\n\n> 引一\n> 引二\n\n末行\n')
  } finally {
    await run.close()
  }
})

test('第 6 条 改了字的那一下光标不落在块缝上：引用中间空行回车、打 --- 成分隔线以后', async () => {
  const run = await open('引', '# 引\n\n> 引用一\n> 引用二\n\n上一段。\n\n\n下一段。\n')
  const { page } = run
  try {
    await toEnd(page, '引用一')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await shot(page, '06-quote')
    await expectCaretOk(page, '引用中间空行回车')
    await page.keyboard.type('字')
    expect(await editorText(page)).toContain('> 引用一\n\n字\n\n> 引用二')
    // 空块里打 ---：成了分隔线，光标在它下面新的空块里
    await toEnd(page, '上一段')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.type('---')
    await expectCaretOk(page, '打 --- 以后')
    await page.keyboard.type('线下')
    expect(await disk(run, '引')).toContain('上一段。\n\n---\n\n线下\n\n下一段。\n')
  } finally {
    await run.close()
  }
})

test('第 7 条 文末：回车后马上打字再 ⌘Z，只撤打的字，文末那一行还在、光标在里面；点文末打字撤回也一样', async () => {
  const run = await open('流', FLOW)
  const { page } = run
  try {
    // a：最后一段末尾回车，马上打字，⌘Z，再打
    await toEnd(page, '第三段正文')
    await page.keyboard.press('Enter')
    await page.keyboard.type('打错了')
    await page.keyboard.press('Meta+z')
    await shot(page, '07-undo')
    expect(await caret(page)).toMatchObject({ text: '', line: 9 })
    await page.keyboard.type('重打')
    expect(await disk(run, '流')).toBe(FLOW + '\n重打\n')
    await page.keyboard.press('Meta+z')
    await page.keyboard.press('Meta+z')
    await expect.poll(() => editorText(page)).toBe(FLOW)
    // b：光标原来在第一段，点文末下面的空白，马上打字，⌘Z，再打字：字还在文末那一行
    await toEnd(page, '第一段正文')
    await page.mouse.click(800, 800)
    await page.keyboard.type('打错了')
    await page.keyboard.press('Meta+z')
    await page.keyboard.type('重打')
    expect(await disk(run, '流')).toBe(FLOW + '\n重打\n')
  } finally {
    await run.close()
  }
})

test('第 10 条 选着字按回车：删掉选中的字，拆成两块，光标在后一块开头；⌘Z 一下回来', async () => {
  const run = await open('流', FLOW)
  const { page } = run
  try {
    await clickAt(page, '第一段正文', 1)
    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('Enter')
    await shot(page, '10-enter')
    expect(await editorText(page)).toBe('# 流\n\n第\n\n正文。\n\n第二段正文。\n\n第三段正文。\n')
    expect(await caret(page)).toMatchObject({ text: '正文。', col: 0 })
    await page.keyboard.press('Meta+z')
    await expect.poll(() => editorText(page)).toBe(FLOW)
    // 跨两块拖选再回车：选中的删掉，在那一点拆开
    const a = await xy(page, '第一段正文', 2)
    const b = await xy(page, '第二段正文', 2)
    await page.mouse.move(a.x, a.y)
    await page.mouse.down()
    await page.mouse.move(b.x, b.y, { steps: 10 })
    await page.mouse.up()
    await page.keyboard.press('Enter')
    expect(await editorText(page)).toBe('# 流\n\n第一\n\n段正文。\n\n第三段正文。\n')
  } finally {
    await run.close()
  }
})

test('第 12 条 ⌘⌫、⌥⌫ 在块开头，⌥Delete、⌃K 在块末尾：一下并块（像 Notion），不变成同一段的两行', async () => {
  const run = await open('流', FLOW)
  const { page } = run
  try {
    const joined = '# 流\n\n第一段正文。第二段正文。\n\n第三段正文。\n'
    for (const [where, key] of [
      ['start', 'Meta+Backspace'],
      ['start', 'Alt+Backspace'],
      ['end', 'Alt+Delete'],
      ['end', 'Control+k'],
    ] as const) {
      if (where === 'start') await toStart(page, '第二段正文')
      else await toEnd(page, '第一段正文')
      await page.keyboard.press(key)
      if (key === 'Meta+Backspace') await shot(page, '12-cmd-backspace')
      expect(await editorText(page), key).toBe(joined)
      expect(await caret(page), key).toMatchObject({ col: '第一段正文。'.length })
      await page.keyboard.press('Meta+z')
      await expect.poll(() => editorText(page)).toBe(FLOW)
    }
  } finally {
    await run.close()
  }
})

const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAGQAAAAoCAIAAACHGsgUAAAAPklEQVR42u3QMQEAAAgDILV/51nBzwci0JlkOBlZsmTJkiVLlixZsmTJkiVLlixZsmTJkiVLlixZsmTJ+rI0vAROBdUo6wAAAABJRU5ErkJggg==', 'base64'))
const CARDS = '# 卡\n\n图上面一段。\n\n![图](附件/图.png)\n\n图下面一段。\n\n| 列一 | 列二 |\n| --- | --- |\n| a | b |\n\n表下面一段。\n'

test('第 13 条 选中卡片（图片、表格）：打字另起一块接在卡片下面（第 6 轮定的），和下一段隔着空行；回车在它下面新起一个空块、光标进去', async () => {
  const run = await open('卡', CARDS, { '附件/图.png': PNG })
  const { page } = run
  try {
    await toEnd(page, '图上面一段')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.type('x')
    await shot(page, '13-type')
    expect(await editorText(page)).toBe(CARDS.replace('图.png)\n\n图下面', '图.png)\n\nx\n\n图下面'))
    expect(await disk(run, '卡')).toBe(CARDS.replace('图.png)\n\n图下面', '图.png)\n\nx\n\n图下面'))
    await page.keyboard.press('Meta+z')
    await expect.poll(() => editorText(page)).toBe(CARDS)
    await toEnd(page, '图上面一段')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await shot(page, '13-enter')
    expect(await editorText(page)).toBe(CARDS.replace('图.png)\n\n图下面', '图.png)\n\n\n图下面'))
    await expectCaretOk(page, '选中图片回车')
    await page.keyboard.type('字')
    expect(await disk(run, '卡')).toBe(CARDS.replace('图.png)\n\n图下面', '图.png)\n\n字\n\n图下面'))
    // 表格
    await toEnd(page, '图下面一段')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expectCaretOk(page, '选中表格回车')
    await page.keyboard.type('表下')
    expect(await disk(run, '卡')).toContain('| a | b |\n\n表下\n\n表下面一段。\n')
  } finally {
    await run.close()
  }
})

test('第 15 条 文末那一行里回车再起一个空块（像 Notion），打了字中间的空块留着；什么都不打离开文件一个字节不多', async () => {
  const run = await open('流', FLOW)
  const { page } = run
  try {
    await page.mouse.click(800, 800)
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await shot(page, '15-enters')
    await expectCaretOk(page, '文末回车两下')
    expect(await pane(page).locator('.cm-blockph, .cm-tailline').count()).toBe(1)
    // 不打字离开：文件不变
    await toEnd(page, '第一段正文')
    await page.waitForTimeout(300)
    expect(await editorText(page)).toBe(FLOW)
    expect(file(run, '流')).toBe(FLOW)
    // 回车两下再打 q：中间隔两个空块（像 Notion）
    await page.mouse.click(800, 800)
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.type('q')
    expect(await disk(run, '流')).toBe(FLOW + '\n\n\nq\n')
  } finally {
    await run.close()
  }
})

test('第 18 条 两个空行就是一个空块（Tolaria 的数法）：光标进得去、打字是新的一块；标题前出列表留着标题上方的留白；两个空块挨着，在下面那个里打字上面那个留着', async () => {
  const doc = '# 两\n\n上段。\n\n\n下段。\n\n- [ ] 待办一\n\n## 小标题\n\n尾。\n'
  const run = await open('两', doc)
  const { page } = run
  try {
    // 原有的两个空行：在别处打字不碰它
    await toEnd(page, '尾')
    await page.keyboard.type('好')
    expect(await disk(run, '两')).toBe(doc.replace('尾。', '尾。好'))
    // 两个空行中间那一行是空块：↓ 进得去，灰字在那里
    await toEnd(page, '上段')
    await page.keyboard.press('ArrowDown')
    await shot(page, '18-empty')
    await expectCaretOk(page, '两个空行')
    expect(await placeholders(page)).toBe(1)
    expect(await caret(page)).toMatchObject({ line: 5, text: '' })
    // 待办末尾空项回车（下面紧挨着标题）：一个空块、光标在里面，标题上方的留白还在
    await toEnd(page, '待办一')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await shot(page, '18-todo')
    await expectCaretOk(page, '待办空项回车')
    expect(await editorText(page)).toContain('- [ ] 待办一\n\n\n\n## 小标题')
    await page.keyboard.type('新段')
    expect(await disk(run, '两')).toContain('- [ ] 待办一\n\n新段\n\n## 小标题')
    // 两个空块挨着，在下面那个里打字：上面那个空块留着
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.type('再下')
    expect(await disk(run, '两')).toContain('新段\n\n\n再下\n\n## 小标题')
  } finally {
    await run.close()
  }
})

test('第 19 条 文件末尾：只按一个空格离开不多出空行；粘贴后撤回不留空行；新笔记写第一段以换行结尾；选到底删掉留住结尾的换行', async () => {
  const run = await open('流', FLOW, { '新.md': '# 新\n\n' })
  const { page } = run
  try {
    // 点文末，只按一个空格，点别处
    await page.mouse.click(800, 800)
    await page.keyboard.press('Space')
    await toEnd(page, '第一段正文')
    await expect.poll(() => editorText(page)).toBe(FLOW)
    await page.waitForTimeout(400)
    expect(file(run, '流')).toBe(FLOW)
    // 最后一段末尾回车，粘贴几段字，⌘Z，点别处
    await toEnd(page, '第三段正文')
    await page.keyboard.press('Enter')
    await paste(page, { 'text/html': '<p>甲段</p><p>乙段</p>', 'text/plain': '甲段\n\n乙段' })
    await page.keyboard.press('Meta+z')
    await toEnd(page, '第一段正文')
    await page.waitForTimeout(400)
    await expect.poll(() => editorText(page)).toBe(FLOW)
    // ⇧⌘↓ 选到底删掉：文件以换行结尾
    await toEnd(page, '第二段正文')
    await page.keyboard.press('Shift+Meta+ArrowDown')
    await page.keyboard.press('Backspace')
    expect(await disk(run, '流')).toBe('# 流\n\n第一段正文。\n\n第二段正文。\n')
    // 新建的笔记（# 新\n\n）写第一段
    await openNote(page, '新')
    await page.mouse.click(800, 800)
    await page.keyboard.type('正文一')
    await shot(page, '19-new')
    expect(await disk(run, '新')).toBe('# 新\n\n正文一\n')
  } finally {
    await run.close()
  }
})

test('第 19 条里改完规整管的一样：⇧⌘↓ 选到底删掉，文件结尾的换行留着', async () => {
  const run = await open('流', FLOW)
  const { page } = run
  try {
    await toEnd(page, '第二段正文')
    await page.keyboard.press('Shift+Meta+ArrowDown')
    await page.keyboard.press('Backspace')
    expect(await disk(run, '流')).toBe('# 流\n\n第一段正文。\n\n第二段正文。\n')
  } finally {
    await run.close()
  }
})

test('第 1 条用输入法打：三击选一段再拼音组字上屏，下一段也不并进来；⌘Z 一下回来', async () => {
  const run = await open('流', FLOW)
  const { page } = run
  try {
    const a = await xy(page, '第一段正文', 2)
    await page.mouse.click(a.x, a.y, { clickCount: 3 })
    const cdp = await page.context().newCDPSession(page)
    for (const t of ['c', 'ch', 'chong']) await cdp.send('Input.imeSetComposition', { text: t, selectionStart: t.length, selectionEnd: t.length })
    await cdp.send('Input.insertText', { text: '重新写' })
    await expect.poll(() => editorText(page)).toBe('# 流\n\n重新写\n\n第二段正文。\n\n第三段正文。\n')
    expect(await disk(run, '流')).toBe('# 流\n\n重新写\n\n第二段正文。\n\n第三段正文。\n')
    await page.keyboard.press('Meta+z')
    await expect.poll(() => editorText(page)).toBe(FLOW)
  } finally {
    await run.close()
  }
})
