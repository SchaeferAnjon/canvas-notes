/**
 * task-ys1rr 文档里块和光标的手感对照 Notion（用户：「这个块儿和这个Cursor还是用起来不丝滑 没有notion的感觉」）。
 * 每一条先在旧代码上跑红、改完转绿；都是测试模式里真按键、真点。对照报告在 /private/tmp/canvas-notes-visual/20-文档手感对照Notion/。
 */
import { expect, type Page, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { editorText, launch, openNote, pane, type Running, waitSaved } from './app'

const ed = (page: Page) => pane(page).locator('.cm-content')
const line = (page: Page, text: string) => ed(page).locator('.cm-line', { hasText: text }).first()

/** 光标在 md 原文里的哪一行（从 1 数）、第几个字、那一行的字；有选区时 from/to */
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

/** 点一行，再到看得见的开头（Home）/ 末尾（End 两下：折行的段落第一下只到这一屏行的末尾） */
async function toStart(page: Page, text: string) {
  await line(page, text).click()
  await page.keyboard.press('Home')
}
async function toEnd(page: Page, text: string) {
  await line(page, text).click()
  await page.keyboard.press('End')
  await page.keyboard.press('End')
}

async function open(name: string, doc: string, extra: Record<string, string | Uint8Array> = {}): Promise<Running> {
  const run = await launch({ [name + '.md']: doc, ...extra })
  await run.page.setViewportSize({ width: 1440, height: 900 })
  await openNote(run.page, name)
  return run
}

const file = (run: Running, name: string) => readFileSync(join(run.vault, name + '.md'), 'utf8')


test('← 在列表项、待办、引用续行的开头：走到上一行末尾，不卡在原地', async () => {
  const doc = '# 左\n\n- 列表第一项\n- 列表第二项\n\n- [ ] 待办一\n- [ ] 待办二\n\n> 引用一\n> 引用二\n'
  const run = await open('左', doc)
  const { page } = run
  try {
    for (const [here, up] of [
      ['列表第二项', '- 列表第一项'],
      ['待办二', '- [ ] 待办一'],
      ['引用二', '> 引用一'],
    ] as const) {
      await toStart(page, here)
      const a = await caret(page)
      expect(a.text, here).toContain(here)
      await page.keyboard.press('ArrowLeft')
      const b = await caret(page)
      expect(b.text, here).toBe(up)
      expect(b.col, here).toBe(up.length)
    }
    expect(await editorText(page)).toBe(doc)
  } finally {
    await run.close()
  }
})

const CODE_DOC = '# 码\n\n上一段。\n\n```js\nconst a = 1\n```\n\n下一段。\n'

test('代码块删得掉（用户报的）：字删光以后再退格，代码块没了；⌘Z 一下一下回来', async () => {
  const run = await open('码', CODE_DOC)
  const { page } = run
  try {
    await toStart(page, 'const a = 1')
    await page.keyboard.press('Shift+End')
    await page.keyboard.press('Backspace')
    await expect.poll(() => editorText(page)).toBe('# 码\n\n上一段。\n\n```js\n\n```\n\n下一段。\n')
    // 空的代码块里退格：代码块没了，这里变成一个空段落，光标还在这里（像 Notion 把块变回正文）
    await page.keyboard.press('Backspace')
    await expect.poll(() => editorText(page)).not.toContain('```')
    expect(await editorText(page)).toBe('# 码\n\n上一段。\n\n\n\n下一段。\n')
    expect((await caret(page)).line).toBe(5)
    // 再退格：空段落也没了，光标回到上一段末尾
    await page.keyboard.press('Backspace')
    await expect.poll(() => editorText(page)).toBe('# 码\n\n上一段。\n\n下一段。\n')
    expect(await caret(page)).toMatchObject({ text: '上一段。', col: 4 })
    await waitSaved(page)
    expect(file(run, '码')).toBe('# 码\n\n上一段。\n\n下一段。\n')
    await page.keyboard.press('Meta+z')
    await page.keyboard.press('Meta+z')
    await expect.poll(() => editorText(page)).toBe('# 码\n\n上一段。\n\n```js\n\n```\n\n下一段。\n')
  } finally {
    await run.close()
  }
})

test('代码块删得掉：从「上|一段」拖选到「下|一段」（整个代码块都在里面）按退格，围栏一起删掉，上下两段并成「上一段。」', async () => {
  const run = await open('码', CODE_DOC)
  const { page } = run
  try {
    const a = (await line(page, '上一段').boundingBox())!
    const b = (await line(page, '下一段').boundingBox())!
    // 一个汉字 15 宽：点在第一个字右半边，落在它后面
    await page.mouse.move(a.x + 11, a.y + a.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + 11, b.y + b.height / 2, { steps: 12 })
    await page.mouse.up()
    const sel = await caret(page)
    expect(await editorText(page).then((t) => t.slice(sel.from, sel.to))).toBe('一段。\n\n```js\nconst a = 1\n```\n\n下')
    await page.keyboard.press('Backspace')
    await expect.poll(() => editorText(page)).toBe('# 码\n\n上一段。\n')
  } finally {
    await run.close()
  }
})

/** md 里第一个 needle 后面第 offset 个字（从 0 数）的右半边：鼠标落在它后面 */
async function afterChar(page: Page, needle: string, offset: number) {
  return pane(page)
    .locator('.cm-content')
    .evaluate(
      (el, [needle, offset]) => {
        const v = (el as HTMLElement & { cmTile: { view: { state: { doc: { toString(): string } }; coordsAtPos(p: number): { left: number; top: number; bottom: number } | null } } }).cmTile.view
        const pos = v.state.doc.toString().indexOf(needle as string) + (offset as number)
        const a = v.coordsAtPos(pos)!
        const b = v.coordsAtPos(pos + 1)!
        return { x: a.left + (b.left - a.left) * 0.75, y: (a.top + a.bottom) / 2 }
      },
      [needle, offset] as const,
    )
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 12 })
  await page.mouse.up()
}

test('选区跨了几块（从引用中间到待办中间、列表一项中间到下一项中间）按退格：剩下的字并进第一块，后面那块的记号跟着删，不露「- [ ] 」原文（像 Notion）；⌘Z 一下回来；拖选跨过块缝时版面不跳，松手在哪就选到哪', async () => {
  const doc = '# 跨\n\n> 一段引用的文字\n\n- [ ] 待办一\n- [x] 待办二\n\n## 小标题\n\n- 列表第一项\n- 列表第二项\n'
  const run = await open('跨', doc)
  const { page } = run
  const picked = async () => {
    const sel = await caret(page)
    return (await editorText(page)).slice(sel.from, sel.to)
  }
  try {
    // 点在「一」后面，⇧点在「待」后面
    const a = await afterChar(page, '一段引用', 0)
    await page.mouse.click(a.x, a.y)
    const b = await afterChar(page, '待办一', 0)
    await page.keyboard.down('Shift')
    await page.mouse.click(b.x, b.y)
    await page.keyboard.up('Shift')
    expect(await picked()).toBe('段引用的文字\n\n- [ ] 待')
    await page.keyboard.press('Backspace')
    await expect.poll(() => editorText(page)).toBe('# 跨\n\n> 一办一\n- [x] 待办二\n\n## 小标题\n\n- 列表第一项\n- 列表第二项\n')
    expect(await caret(page)).toMatchObject({ text: '> 一办一', col: 3 })
    await page.keyboard.press('Meta+z')
    await expect.poll(() => editorText(page)).toBe(doc)

    // 拖选：跨过引用和待办之间的块缝，缝不撑开、下面不跳，松手的地方就是选区的头
    await drag(page, await afterChar(page, '一段引用', 0), await afterChar(page, '待办一', 0))
    expect(await picked()).toBe('段引用的文字\n\n- [ ] 待')
    await page.keyboard.press('Escape')

    await drag(page, await afterChar(page, '列表第一项', 2), await afterChar(page, '列表第二项', 3))
    await page.keyboard.press('Backspace')
    await expect.poll(() => editorText(page)).toBe('# 跨\n\n> 一段引用的文字\n\n- [ ] 待办一\n- [x] 待办二\n\n## 小标题\n\n- 列表第项\n')
    await waitSaved(page)
    expect(file(run, '跨')).toBe('# 跨\n\n> 一段引用的文字\n\n- [ ] 待办一\n- [x] 待办二\n\n## 小标题\n\n- 列表第项\n')
  } finally {
    await run.close()
  }
})

// ---------------------------------------------------------------- 块和块之间（block-flow.ts）

const FLOW = '# 块\n\n第一段正文。\n\n第二段。\n\n## 小标题\n\n- 列表第一项\n- 列表第二项\n\n> 一段引用的文字\n\n最后一段。\n'

/** 光标所在的那一行上画着文末那一行灰字「输入 / 插入块」 */
const caretOnTail = (page: Page) =>
  page.evaluate(() => {
    const n = getSelection()?.focusNode
    const el = (n?.nodeType === 1 ? n : n?.parentElement) as HTMLElement | null
    return !!el?.closest('.cm-line')?.querySelector('.cm-tailline')
  })

/** 一行在屏上的上沿（量版面跳没跳） */
const topOf = async (page: Page, text: string) => Math.round((await line(page, text).boundingBox())!.y)

test('回车新起一块（像 Notion）：段末回车下面多一个空块、光标在里面，打的字是单独一段；段中间回车拆成两块；⇧回车才是段里换行', async () => {
  const run = await open('块', FLOW)
  const { page } = run
  try {
    await toEnd(page, '第一段正文')
    await page.keyboard.press('Enter')
    expect(await editorText(page)).toBe(FLOW.replace('第一段正文。\n\n', '第一段正文。\n\n\n\n'))
    expect(await caret(page)).toMatchObject({ line: 5, text: '' })
    // 空块和上下两段之间各隔着一道缝（不是紧贴着上一段的「段里一行」）
    const p1 = (await line(page, '第一段正文').boundingBox())!
    const cur = await page.evaluate(() => {
      const r = getSelection()!.getRangeAt(0).getBoundingClientRect()
      const el = (getSelection()!.focusNode as HTMLElement).nodeType === 1 ? (getSelection()!.focusNode as HTMLElement) : getSelection()!.focusNode!.parentElement!
      const ln = el.closest('.cm-line')!.getBoundingClientRect()
      return { top: Math.round(ln.top), h: Math.round(ln.height), r: r.top }
    })
    expect(cur.top - (p1.y + p1.height)).toBeGreaterThanOrEqual(11)
    // 空块里写着灰字「输入 / 插入块，或者直接写」（像 Notion 的「Press / to insert blocks」），就在光标那一行
    const ph = pane(page).locator('.cm-blockph')
    await expect(ph).toHaveCount(1)
    await expect(ph).toHaveText('输入 / 插入块，或者直接写')
    expect(Math.round((await ph.boundingBox())!.y)).toBeGreaterThanOrEqual(cur.top - 1)
    expect(Math.round((await ph.boundingBox())!.y)).toBeLessThanOrEqual(cur.top + cur.h)
    await page.keyboard.type('新的一块')
    await expect.poll(() => editorText(page)).toBe(FLOW.replace('第一段正文。\n\n', '第一段正文。\n\n新的一块\n\n'))
    await expect(ph).toHaveCount(0)
    // 段中间回车：拆成两块，光标在后一块开头
    await toStart(page, '第二段')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Enter')
    await expect.poll(() => editorText(page)).toContain('第二\n\n段。')
    expect(await caret(page)).toMatchObject({ text: '段。', col: 0 })
    // ⇧回车：段里换行（同一块）
    await page.keyboard.press('Shift+Enter')
    await expect.poll(() => editorText(page)).toContain('第二\n\n\n段。')
    await page.keyboard.press('Meta+z')
    await page.keyboard.press('Meta+z')
    await expect.poll(() => editorText(page)).toContain('第二段。')
    // 标题末尾回车：下面新起一个空块
    await toEnd(page, '小标题')
    await page.keyboard.press('Enter')
    await page.keyboard.type('标题下面')
    await expect.poll(() => editorText(page)).toContain('## 小标题\n\n标题下面\n\n- 列表第一项')
    // 最后一块末尾回车：和点文末那一行一样，光标和灰字「输入 / 插入块」在同一行
    await toEnd(page, '最后一段')
    await page.keyboard.press('Enter')
    const tail = pane(page).locator('.cm-tailline')
    await expect(tail).toHaveCount(1)
    await expect(tail).toHaveClass(/inline/)
    expect(await caretOnTail(page)).toBe(true)
    await page.keyboard.type('接着写')
    await expect.poll(() => editorText(page)).toMatch(/最后一段。\n\n接着写\n$/)
    await waitSaved(page)
    expect(file(run, '块')).toMatch(/最后一段。\n\n接着写\n$/)
  } finally {
    await run.close()
  }
})

test('↑↓←→ 不停在块和块之间的空行上：一下到下一块（↓ 横向位置不变），下面的字不跳', async () => {
  const run = await open('块', FLOW)
  const { page } = run
  try {
    // ↓：列表第二项 → 引用，一下
    await toEnd(page, '列表第二项')
    const quoteY = await topOf(page, '一段引用的文字')
    const lastY = await topOf(page, '最后一段')
    await page.keyboard.press('ArrowDown')
    expect((await caret(page)).text).toBe('> 一段引用的文字')
    expect(await topOf(page, '最后一段')).toBe(lastY)
    expect(await topOf(page, '一段引用的文字')).toBe(quoteY)
    // ↑：回到列表第二项，一下
    await page.keyboard.press('ArrowUp')
    expect((await caret(page)).text).toBe('- 列表第二项')
    // ↓ 从第一段到第二段：横向位置照旧（第 3 个字后面 → 第 3 个字后面）
    await toStart(page, '第一段正文')
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowDown')
    expect(await caret(page)).toMatchObject({ text: '第二段。', col: 3 })
    // →：第一段末尾 → 第二段开头，一下；← 回去，一下
    await toEnd(page, '第一段正文')
    await page.keyboard.press('ArrowRight')
    expect(await caret(page)).toMatchObject({ text: '第二段。', col: 0 })
    await page.keyboard.press('ArrowLeft')
    expect(await caret(page)).toMatchObject({ text: '第一段正文。', col: 6 })
    // → 进标题：落在看得见的第一个字前面
    await toEnd(page, '第二段')
    await page.keyboard.press('ArrowRight')
    expect(await caret(page)).toMatchObject({ text: '## 小标题', col: 3 })
    expect(await editorText(page)).toBe(FLOW)
  } finally {
    await run.close()
  }
})

test('点两块之间的缝：上半落进上一块、下半落进下一块（横向照点的地方），不停在缝上；缝不撑开', async () => {
  const run = await open('块', FLOW)
  const { page } = run
  try {
    const a = (await line(page, '第一段正文').boundingBox())!
    const b = (await line(page, '第二段').boundingBox())!
    const gap = b.y - (a.y + a.height)
    expect(gap).toBeGreaterThanOrEqual(10)
    expect(gap).toBeLessThanOrEqual(14)
    await page.mouse.click(a.x + 30, a.y + a.height + 2)
    expect(await caret(page)).toMatchObject({ text: '第一段正文。' })
    expect(await topOf(page, '第二段')).toBe(Math.round(b.y))
    await page.mouse.click(a.x + 30, b.y - 2)
    expect(await caret(page)).toMatchObject({ text: '第二段。' })
    expect(await topOf(page, '第二段')).toBe(Math.round(b.y))
  } finally {
    await run.close()
  }
})

test('退格、Delete 在块边上一下就并（像 Notion）：段首退格并进上一段末尾，段末 Delete 把下一段并上来；空块退格删掉它；最后一块末尾 Delete 不吃掉文件末尾的换行', async () => {
  const run = await open('块', FLOW)
  const { page } = run
  try {
    await toStart(page, '第二段')
    await page.keyboard.press('Backspace')
    await expect.poll(() => editorText(page)).toBe(FLOW.replace('第一段正文。\n\n第二段。', '第一段正文。第二段。'))
    expect(await caret(page)).toMatchObject({ text: '第一段正文。第二段。', col: 6 })
    await page.keyboard.press('Meta+z')
    await expect.poll(() => editorText(page)).toBe(FLOW)
    await toEnd(page, '第一段正文')
    await page.keyboard.press('Delete')
    await expect.poll(() => editorText(page)).toBe(FLOW.replace('第一段正文。\n\n第二段。', '第一段正文。第二段。'))
    await page.keyboard.press('Meta+z')
    // 标题开头退格：先变正文，再退格并进上一段
    await toStart(page, '小标题')
    await page.keyboard.press('Backspace')
    await expect.poll(() => editorText(page)).toContain('\n\n小标题\n\n')
    await page.keyboard.press('Backspace')
    await expect.poll(() => editorText(page)).toContain('第二段。小标题\n\n')
    await page.keyboard.press('Meta+z')
    await page.keyboard.press('Meta+z')
    await expect.poll(() => editorText(page)).toBe(FLOW)
    // 回车出来的空块：退格删掉它，光标回到上一段末尾
    await toEnd(page, '第二段')
    await page.keyboard.press('Enter')
    expect(await editorText(page)).toBe(FLOW.replace('第二段。\n\n', '第二段。\n\n\n\n'))
    await page.keyboard.press('Backspace')
    await expect.poll(() => editorText(page)).toBe(FLOW)
    expect(await caret(page)).toMatchObject({ text: '第二段。', col: 4 })
    // 最后一块末尾 Delete：什么都不做
    await toEnd(page, '最后一段')
    await page.keyboard.press('Delete')
    await page.keyboard.press('Delete')
    expect(await editorText(page)).toBe(FLOW)
    await waitSaved(page)
    expect(file(run, '块')).toBe(FLOW)
  } finally {
    await run.close()
  }
})

test('用户截图那一篇：文末是剪进来的引文，↓ 到下面、点下面：光标就在灰字「输入 / 插入块」那一行，打的字是新的一段，不并进引文', async () => {
  const doc = '# 学习笔记\n\n> X = torch.arange(24).reshape(2, 3, 4)\n> X\n—— [2.3. 线性代数 — 动手学深度学习 2.0.0 documentation](https://zh.d2l.ai/x.html)\n'
  const run = await open('学习笔记', doc)
  const { page } = run
  try {
    await toEnd(page, '2.3. 线性代数')
    await page.keyboard.press('ArrowDown')
    const tail = pane(page).locator('.cm-tailline')
    await expect(tail).toHaveClass(/inline/)
    // 光标和灰字在同一行
    expect(await caretOnTail(page)).toBe(true)
    await page.keyboard.type('接着写')
    await expect.poll(() => editorText(page)).toBe(doc + '\n接着写\n')
    await waitSaved(page)
    expect(file(run, '学习笔记')).toBe(doc + '\n接着写\n')
  } finally {
    await run.close()
  }
})

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const CARDS = '# 卡\n\n图上面一段。\n\n![图](附件/图.png)\n\n图下面一段。\n\n| 列一 | 列二 |\n| --- | --- |\n| a | b |\n\n表下面一段。\n'
const selText = async (page: Page) => {
  const c = await caret(page)
  return (await editorText(page)).slice(c.from, c.to)
}

test('↑↓←→ 走到图片、表格这些卡片上先选中它（像 Notion），再按一下才走过去；以前一下跳过整张卡', async () => {
  const run = await open('卡', CARDS, { '附件/图.png': PNG })
  const { page } = run
  try {
    const sel = pane(page).locator('.cm-blk-selbg')
    await toEnd(page, '图上面一段')
    await page.keyboard.press('ArrowDown')
    expect(await selText(page)).toBe('![图](附件/图.png)')
    await expect(sel).toHaveCount(1)
    await page.keyboard.press('ArrowDown')
    expect(await caret(page)).toMatchObject({ text: '图下面一段。', from: (await caret(page)).to })
    await page.keyboard.press('ArrowDown')
    expect(await selText(page)).toBe('| 列一 | 列二 |\n| --- | --- |\n| a | b |')
    await page.keyboard.press('ArrowUp')
    expect(await caret(page)).toMatchObject({ text: '图下面一段。' })
    await page.keyboard.press('ArrowUp')
    expect(await selText(page)).toBe('![图](附件/图.png)')
    await page.keyboard.press('ArrowUp')
    expect(await caret(page)).toMatchObject({ text: '图上面一段。' })
    // → ←：上一段末尾 → 选中图，再 → 到下一段开头；← 回来同样
    await toEnd(page, '图上面一段')
    await page.keyboard.press('ArrowRight')
    expect(await selText(page)).toBe('![图](附件/图.png)')
    await page.keyboard.press('ArrowRight')
    expect(await caret(page)).toMatchObject({ text: '图下面一段。', col: 0 })
    await page.keyboard.press('ArrowLeft')
    expect(await selText(page)).toBe('![图](附件/图.png)')
    await page.keyboard.press('ArrowLeft')
    expect(await caret(page)).toMatchObject({ text: '图上面一段。', col: 6 })
    // 选中着按退格：删掉这张卡（整块的规矩照旧），⌘Z 回来
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Backspace')
    await expect.poll(() => editorText(page)).toBe(CARDS.replace('![图](附件/图.png)\n\n', ''))
    await page.keyboard.press('Meta+z')
    await expect.poll(() => editorText(page)).toBe(CARDS)
  } finally {
    await run.close()
  }
})

test('一篇里只有一个数据库块、块收尾在文件最末（后面没有换行）：从标题 ↓ 或 → 选中它，再按一下就在块下面新起一段，打的字接在块下面；不打字离开文件不变（用户报的「文末打不了字」）', async () => {
  const rooms = '```base\nfilters:\n  and:\n    - file.inFolder("冰岛旅行/住宿")\nviews:\n  - type: table\n    name: 表格\n    order:\n      - file.name\n      - 价格\n```'
  const doc = `# 旅行住宿\n\n${rooms}`
  const run = await open('旅行住宿', doc, {
    '冰岛旅行/住宿/米湖民宿.md': '---\n价格: 900\n---\n',
    '冰岛旅行/住宿/雷克雅未克公寓.md': '---\n价格: 1500\n---\n',
  })
  const { page } = run
  try {
    await expect(pane(page).locator('[data-part="数据库块"]')).toBeVisible()
    // ↓：先选中数据库块，再 ↓ 到块下面那一行（光标和灰字同一行），打字
    await toEnd(page, '旅行住宿')
    await page.keyboard.press('ArrowDown')
    expect(await selText(page)).toBe(rooms)
    await page.keyboard.press('ArrowDown')
    await expect.poll(() => caretOnTail(page)).toBe(true)
    // 已经是全篇最后一块：再 ↓、→、⌘↓ 都不动（不跑到它后面那个空行上，把这一行拿掉）
    for (const k of ['ArrowDown', 'ArrowRight', 'Meta+ArrowDown']) {
      await page.keyboard.press(k)
      await expect.poll(() => caretOnTail(page), k).toBe(true)
    }
    await page.keyboard.type('接着写')
    await expect.poll(() => editorText(page)).toBe(`${doc}\n\n接着写\n`)
    await waitSaved(page)
    expect(file(run, '旅行住宿')).toBe(`${doc}\n\n接着写\n`)
    for (let i = 0; i < 4 && (await editorText(page)) !== doc; i++) await page.keyboard.press('Meta+z')
    expect(await editorText(page)).toBe(doc)
    // →：同样，不打字就点回标题，文件一个字节不多
    await toEnd(page, '旅行住宿')
    await page.keyboard.press('ArrowRight')
    expect(await selText(page)).toBe(rooms)
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => caretOnTail(page)).toBe(true)
    await line(page, '旅行住宿').click()
    await expect.poll(() => editorText(page)).toBe(doc)
    await waitSaved(page)
    expect(file(run, '旅行住宿')).toBe(doc)
  } finally {
    await run.close()
  }
})

test('文件最末是图片、代码块、分隔线（后面没有换行）：从上一段 ↓ 走过它，在它下面新起一段打字；多按几下 ↓ 也不跑丢', async () => {
  const docs: Record<string, string> = {
    图片: '# 末尾\n\n上面一段。\n\n![图](附件/图.png)',
    代码块: '# 末尾\n\n上面一段。\n\n```js\nconst a = 1\n```',
    分隔线: '# 末尾\n\n上面一段。\n\n***',
  }
  for (const [name, doc] of Object.entries(docs)) {
    const run = await open('末尾', doc, { '附件/图.png': PNG })
    const { page } = run
    try {
      await toEnd(page, '上面一段')
      for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown')
      await expect.poll(() => caretOnTail(page), name).toBe(true)
      await page.keyboard.type('接着写')
      await expect.poll(() => editorText(page), name).toBe(`${doc}\n\n接着写\n`)
    } finally {
      await run.close()
    }
  }
})

test('两张卡片挨着（图下面紧接着表格）：选中图按 ↓ 选中表格，再 ↓ 才到下面一段；↑ 回来一样，不一下跳过一张', async () => {
  const doc = '# 卡\n\n图上面一段。\n\n![图](附件/图.png)\n\n| 列一 | 列二 |\n| --- | --- |\n| a | b |\n\n表下面一段。\n'
  const run = await open('卡', doc, { '附件/图.png': PNG })
  const { page } = run
  try {
    await toEnd(page, '图上面一段')
    await page.keyboard.press('ArrowDown')
    expect(await selText(page)).toBe('![图](附件/图.png)')
    await page.keyboard.press('ArrowDown')
    expect(await selText(page)).toBe('| 列一 | 列二 |\n| --- | --- |\n| a | b |')
    await page.keyboard.press('ArrowDown')
    expect(await caret(page)).toMatchObject({ text: '表下面一段。' })
    await page.keyboard.press('ArrowUp')
    expect(await selText(page)).toBe('| 列一 | 列二 |\n| --- | --- |\n| a | b |')
    await page.keyboard.press('ArrowUp')
    expect(await selText(page)).toBe('![图](附件/图.png)')
    await page.keyboard.press('ArrowUp')
    expect(await caret(page)).toMatchObject({ text: '图上面一段。' })
    // → 也一样（光标在「图上面一段。」末尾）
    expect(await caret(page)).toMatchObject({ col: 6 })
    await page.keyboard.press('ArrowRight')
    expect(await selText(page)).toBe('![图](附件/图.png)')
    await page.keyboard.press('ArrowRight')
    expect(await selText(page)).toBe('| 列一 | 列二 |\n| --- | --- |\n| a | b |')
    expect(await editorText(page)).toBe(doc)
  } finally {
    await run.close()
  }
})

test('点版心左右的留白（加号把手那一槽外面）：光标落到这一高度那一行的开头 / 末尾，编辑器不失焦；点在卡片旁边选中卡片', async () => {
  const run = await open('卡', CARDS, { '附件/图.png': PNG })
  const { page } = run
  try {
    const c = (await ed(page).boundingBox())!
    const p = (await line(page, '图下面一段').boundingBox())!
    await toEnd(page, '表下面一段')
    // 左边 56 宽的槽里是加号和把手（悬停才出）：点在槽外面的留白
    await page.mouse.click(c.x - 70, p.y + p.height / 2)
    expect(await caret(page)).toMatchObject({ text: '图下面一段。', col: 0 })
    expect(await page.evaluate(() => document.activeElement?.classList.contains('cm-content'))).toBe(true)
    await toEnd(page, '表下面一段')
    await page.mouse.click(c.x + c.width + 30, p.y + p.height / 2)
    expect(await caret(page)).toMatchObject({ text: '图下面一段。', col: 6 })
    expect(await page.evaluate(() => document.activeElement?.classList.contains('cm-content'))).toBe(true)
    // 打字接着写在这一行末尾
    await page.keyboard.type('右')
    await expect.poll(() => editorText(page)).toContain('图下面一段。右')
    // 点图旁边的留白：选中图
    const img = (await pane(page).locator('.cm-image').first().boundingBox())!
    await page.mouse.click(c.x - 70, img.y + img.height / 2)
    expect(await selText(page)).toBe('![图](附件/图.png)')
  } finally {
    await run.close()
  }
})

/** 合成一次粘贴（不碰系统剪贴板） */
const paste = (page: Page, data: Record<string, string>) =>
  page.evaluate((data) => {
    const dt = new DataTransfer()
    for (const [k, v] of Object.entries(data)) dt.setData(k, v)
    document.querySelector('.pane:not([hidden]) .cm-content')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, data)

test('粘贴网页、文档里复制的带格式的字（像 Notion）：标题、列表、待办、加粗、链接、表格都留着；代码编辑器复制的、代码块里照旧粘纯文字', async () => {
  const doc = '# 粘\n\n第一段。\n\n```js\nlet a = 1\n```\n'
  const run = await open('粘', doc)
  const { page } = run
  try {
    await toEnd(page, '第一段')
    await paste(page, {
      'text/plain': '小标题\n要点一\n要点二\n买牛奶\n一段带链接\n列一 列二\na b',
      'text/html':
        '<h2>小标题</h2><ul><li>要点<b>一</b></li><li>要点二</li></ul><ul><li><input type="checkbox" checked>买牛奶</li></ul><p>一段带<a href="https://example.com/%E9%93%BE">链接</a></p><table><tr><th>列一</th><th>列二</th></tr><tr><td>a</td><td>b</td></tr></table>',
    })
    await expect
      .poll(() => editorText(page))
      .toBe('# 粘\n\n第一段。\n\n## 小标题\n\n- 要点**一**\n- 要点二\n\n- [x] 买牛奶\n\n一段带[链接](https://example.com/链)\n\n| 列一 | 列二 |\n| --- | --- |\n| a | b |\n\n```js\nlet a = 1\n```\n')
    await expect(pane(page).locator('.cm-h2', { hasText: '小标题' })).toBeVisible()
    await page.keyboard.press('Meta+z')
    await expect.poll(() => editorText(page)).toBe(doc)
    // VS Code 复制的一段代码（整段等宽 div、white-space: pre）：照旧粘纯文字
    await toEnd(page, '第一段')
    await paste(page, { 'text/plain': 'const x = 1', 'text/html': '<div style="color: #d4d4d4;font-family: Menlo;white-space: pre;"><div><span style="color: #569cd6;">const</span> x = 1</div></div>' })
    await expect.poll(() => editorText(page)).toBe(doc.replace('第一段。', '第一段。const x = 1'))
    await page.keyboard.press('Meta+z')
    await expect.poll(() => editorText(page)).toBe(doc)
    // 代码块里：纯文字
    await toEnd(page, 'let a = 1')
    await paste(page, { 'text/plain': 'b = 2', 'text/html': '<p><b>b</b> = 2</p>' })
    await expect.poll(() => editorText(page)).toBe(doc.replace('let a = 1', 'let a = 1b = 2'))
  } finally {
    await run.close()
  }
})

test('输入法拼字时按回车、退格（真输入法的按键：keyCode 229）：交给输入法，不新起一块、不并块；上屏后回车照常新起一块', async () => {
  const run = await open('块', FLOW)
  const { page } = run
  try {
    const cdp = await page.context().newCDPSession(page)
    // 段末拼「nihao」，回车确认拼音：字上屏，不拆块
    await toEnd(page, '第一段正文')
    await cdp.send('Input.imeSetComposition', { text: 'nihao', selectionStart: 5, selectionEnd: 5 })
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 })
    await cdp.send('Input.insertText', { text: 'nihao' })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
    await expect.poll(() => editorText(page)).toBe(FLOW.replace('第一段正文。', '第一段正文。nihao'))
    // 段首拼字时退格：删的是拼音，不并进上一段
    await toStart(page, '第二段')
    await cdp.send('Input.imeSetComposition', { text: 'ni', selectionStart: 2, selectionEnd: 2 })
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 })
    await cdp.send('Input.imeSetComposition', { text: 'n', selectionStart: 1, selectionEnd: 1 })
    await cdp.send('Input.insertText', { text: '你' })
    await expect.poll(() => editorText(page)).toContain('第一段正文。nihao\n\n你第二段。')
    // 上屏以后回车：照常新起一块
    await toEnd(page, '你第二段')
    await page.keyboard.press('Enter')
    await expect.poll(() => editorText(page)).toContain('你第二段。\n\n\n\n## 小标题')
  } finally {
    await run.close()
  }
})
