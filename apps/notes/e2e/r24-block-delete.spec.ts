/**
 * task-6lsvd 整块下面一行按删除删不掉、光标跳到上一段（用户 0.4.8：「我在这里点删除 删不掉数据库 然后光标会跳转到读后面」）。
 * 照公式块（task-o48fa）的规矩：整块下面一行行首退格、上面一行行尾 Delete，第一下选中整块（--acc-soft 底），第二下连同它占的行删掉，
 * 上下两段之间只留一个空行；⌘Z 一次回来，文件一个字节不差。能改字的块（代码块、提示块、AI 讲解、旁支）走进块里，不删记号。
 * 都在测试模式里真点、真按键。CN_SHOTS=<目录> 时另截公式块和数据库块选中的样子（浅色天青、深色深湖）给设计复审对照。
 */
import { expect, type Page, test } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { editorText, gitStatus, launch, openNote, pane, type Running, waitSaved } from './app'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

const ed = (page: Page) => pane(page).locator('.cm-content')
const line = (page: Page, text: string) => ed(page).locator('.cm-line', { hasText: text }).first()
const selBg = (page: Page) => pane(page).locator('.cm-blk-selbg')
/** 点块下面紧挨的那一行（文件最后那个空行，用户截图里光标那一行；灰字「输入 / 插入块」画在它下面） */
const clickBelow = (page: Page, block: string) => pane(page).locator(`${block} + .cm-line`).click({ position: { x: 4, y: 4 } })

/** 光标在哪一行：这一行的字、上一个兄弟（块部件或行）的字，和它是不是块部件 */
const caret = (page: Page) =>
  page.evaluate(() => {
    const n = document.getSelection()?.focusNode
    const el = (n?.nodeType === 1 ? n : n?.parentElement) as HTMLElement | null
    const ln = el?.closest('.cm-line') as HTMLElement | null
    const prev = ln?.previousElementSibling as HTMLElement | null
    return { text: ln?.textContent ?? null, prev: prev?.textContent ?? null }
  })

// ---------------------------------------------------------------- 用户那一篇

const PARA = '"事情就开始了"这一句把源头指向迪尔和怪人拉德利，先抛一个悬念：一场孩子的游戏，怎么会一路牵出让人多年后还要"谈论"的过往。第一章还没讲什么大事，但这种倒叙的框架已经让人想往下读。'
const BOOK = `# 杀死一只知更鸟（同名电影原著）

> 从迪尔来到我们这儿的那个夏天起——确切地说，是当迪尔怂恿我们把怪人拉德利引出来的时候，事情就开始了。

## 评价

开篇很克制：从杰姆胳膊肘骨折这件小事讲起，再说"过了一些年"兄妹俩回头谈起它，一下子定下了整本书的视角。

${PARA}

\`\`\`base
\`\`\`
`
// 块是全篇最后一样：只删块，上一段下面的空行留着（光标停在那里，灰字「输入 / 插入块」也在那一行）
const BOOK_GONE = BOOK.replace('```base\n```\n', '')
const BOOK_PATH = '阅读/杀死一只知更鸟（同名电影原著）.md'

test('task-6lsvd 用户那一篇：数据库块下面一行行首退格，先选中、再删掉（连同它占的行），光标不跳到「读」后面；⌘Z 回来文件一个字节不差', async () => {
  const run = await launch({ [BOOK_PATH]: BOOK })
  const { page, vault } = run
  const file = () => readFileSync(join(vault, BOOK_PATH), 'utf8')
  try {
    await openNote(page, '杀死一只知更鸟（同名电影原著）')
    const db = pane(page).locator('[data-part="数据库块"]')
    await expect(db).toBeVisible()
    await expect(db.locator('.base-count')).toHaveText('表格 · 0 条')
    // 点数据库块下面那一行（用户截图里光标那一行）
    const card = (await db.boundingBox())!
    await clickBelow(page, '.cm-base')
    expect(await caret(page)).toEqual({ text: '', prev: expect.stringContaining('表格 · 0 条') })
    const tail = pane(page).locator('.cm-tailline')
    const tailY = (await tail.boundingBox())!.y

    // 第一下：选中整块，字不变，光标没跑到上一段。选中的样子和公式一样：强调色 24% 盖在卡上，大小、圆角跟卡自己
    await page.keyboard.press('Backspace')
    await expect(selBg(page)).toHaveCount(1)
    const bg = (await selBg(page).boundingBox())!
    for (const k of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(bg[k] - card[k]), k).toBeLessThanOrEqual(1)
    const look = await selBg(page).evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, r: getComputedStyle(el).borderTopLeftRadius, pe: getComputedStyle(el.parentElement!).pointerEvents }))
    const acc = await page.evaluate(() => getComputedStyle(document.querySelector('.pane:not([hidden]) .cm-editor')!).getPropertyValue('--acc').trim())
    expect(look.bg, `--acc 是 ${acc}`).toMatch(/0\.24\)$/)
    expect(look.r).toBe('10px')
    expect(look.pe).toBe('none')
    // 选中时下面的字不跳（光标原来那一行照旧一整行高）
    expect((await tail.boundingBox())!.y).toBeCloseTo(tailY, 0)
    expect(await editorText(page)).toBe(BOOK)

    // 第二下：整块连同它占的行删掉，上一段下面不留多余的空行；光标在原来那一行（段落下面），不在「读」后面
    await page.keyboard.press('Backspace')
    await expect(db).toHaveCount(0)
    await expect.poll(() => editorText(page)).toBe(BOOK_GONE)
    const c = await caret(page)
    expect(c.text).not.toContain('想往下读')
    await waitSaved(page)
    expect(file()).toBe(BOOK_GONE)

    // ⌘Z 一次：回来，文件一个字节不差
    await page.keyboard.press('Meta+z')
    await expect(db).toBeVisible()
    await expect.poll(() => editorText(page)).toBe(BOOK)
    await waitSaved(page)
    expect(Buffer.from(readFileSync(join(vault, BOOK_PATH))).equals(Buffer.from(BOOK))).toBe(true)
    expect(gitStatus(vault)).toBe('')

    // 上面一行行尾按 Delete：同样先选中、再删；⌘Z 回来
    await line(page, '想往下读').click()
    await page.keyboard.press('End')
    await page.keyboard.press('ArrowDown')
    expect((await caret(page)).text).toBe('')
    await page.keyboard.press('Delete')
    await expect(selBg(page)).toHaveCount(1)
    expect(await editorText(page)).toBe(BOOK)
    await page.keyboard.press('Delete')
    await expect(db).toHaveCount(0)
    await expect.poll(() => editorText(page)).toBe(BOOK_GONE)
    await page.keyboard.press('Meta+z')
    await expect(db).toBeVisible()
    await waitSaved(page)
    expect(Buffer.from(readFileSync(join(vault, BOOK_PATH))).equals(Buffer.from(BOOK))).toBe(true)
  } finally {
    await run.close()
  }
})

test('task-6lsvd 选中整块以后：方向键、点别处取消选中，字不变；回车、打字留着块，字另起一段接在块下面', async () => {
  const run = await launch({ [BOOK_PATH]: BOOK })
  const { page } = run
  try {
    await openNote(page, '杀死一只知更鸟（同名电影原著）')
    const db = pane(page).locator('[data-part="数据库块"]')
    await expect(db).toBeVisible()
    const below = async () => {
      await clickBelow(page, '.cm-base')
      await page.keyboard.press('Backspace')
      await expect(selBg(page)).toHaveCount(1)
    }
    for (const k of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
      await below()
      await page.keyboard.press(k)
      await expect(selBg(page), k).toHaveCount(0)
      expect(await editorText(page), k).toBe(BOOK)
    }
    // ↑ 收起选中停在块上面（空行），不跳进上一段
    await below()
    await page.keyboard.press('ArrowUp')
    expect((await caret(page)).text).not.toContain('想往下读')
    // 点别处
    await below()
    await line(page, '开篇很克制').click()
    await expect(selBg(page)).toHaveCount(0)
    expect(await editorText(page)).toBe(BOOK)
    // 打字：块留着，字另起一段接在块下面
    await below()
    await page.keyboard.type('新的一段')
    await expect(db).toBeVisible()
    await expect.poll(() => editorText(page)).toMatch(/想往下读。\n\n```base\n```\n+新的一段\n*$/)
    expect((await caret(page)).text).toBe('新的一段')
    await page.keyboard.press('Meta+z')
    await expect.poll(() => editorText(page)).toBe(BOOK)
    // 回车：块留着，下面空出新的一行，光标在那里
    await below()
    await page.keyboard.press('Enter')
    await expect(db).toBeVisible()
    await expect(selBg(page)).toHaveCount(0)
    const t = await editorText(page)
    expect(t.startsWith(BOOK.replace(/\n$/, ''))).toBe(true)
    await page.keyboard.type('回车后')
    await expect.poll(() => editorText(page)).toMatch(/```base\n```\n+回车后\n*$/)
  } finally {
    await run.close()
  }
})

// ---------------------------------------------------------------- 每一种整块

const VIDEO = '<!-- video video=youtube:7CVYBBX_zxA -->\n![视频标题](附件/a.png)\n[视频标题](https://www.youtube.com/watch?v=7CVYBBX_zxA)\nIC实验室 · 08:55'
const EXTRA: Record<string, string | Uint8Array> = {
  '其他.md': '# 其他\n\n## 小节\n\n小节里的字。\n',
  '白板甲.md': '---\ntype: board\n---\n<!-- card id=a1 x=10 y=20 -->\n一张卡。\n',
  '剪藏甲.md': '---\nsource: https://example.com/a\n---\n# 剪藏甲\n\n剪下来的字。\n',
  '住宿库.md': '```base\nviews:\n  - type: table\n```\n',
  '附件/a.png': PNG,
}
const KINDS: [string, string][] = [
  ['数据库块（```base）', '```base\nviews:\n  - type: table\n```'],
  ['图片', '![说明](附件/a.png)'],
  ['嵌入图 ![[图]]', '![[a.png]]'],
  ['嵌入白板缩略图', '![[白板甲]]'],
  ['白板链接 [[白板]]', '[[白板甲]]'],
  ['嵌入一节', '![[其他#小节]]'],
  ['嵌入一整篇（笔记卡）', '![[其他]]'],
  ['剪藏卡', '![[剪藏甲]]'],
  ['数据库卡（嵌入数据库那篇）', '![[住宿库]]'],
  ['表格', '| a | b |\n|---|---|\n| 1 | 2 |'],
  ['视频卡', VIDEO],
  ['单独成行的公式（对照）', '$$\n\\sum_i x_i\n$$'],
]

for (const [name, block] of KINDS) {
  test(`task-6lsvd ${name}：下面一行行首退格、上面一行行尾 Delete，第一下选中、第二下连同它占的行删掉，⌘Z 回来文件不变`, async () => {
    const doc = `# 块\n\n上一段。\n\n${block}\n\n下一段。\n`
    const gone = '# 块\n\n上一段。\n\n下一段。\n'
    const run = await launch({ '块.md': doc, ...EXTRA })
    const { page, vault } = run
    try {
      await openNote(page, '块')
      await page.waitForTimeout(300)
      for (const [key, place] of [
        ['Backspace', async () => (await line(page, '下一段').click({ position: { x: 2, y: 6 } }), await page.keyboard.press('ArrowUp'))],
        ['Delete', async () => (await line(page, '上一段').click(), await page.keyboard.press('End'), await page.keyboard.press('ArrowDown'))],
      ] as const) {
        await place()
        // 在块旁边的空行上
        expect((await caret(page)).text, key).toBe('')
        await page.keyboard.press(key)
        await expect(pane(page).locator('.cm-blk-selbg, .cm-math-sel'), key).toHaveCount(1)
        expect(await editorText(page), key).toBe(doc)
        await page.keyboard.press(key)
        await expect.poll(() => editorText(page), key).toBe(gone)
        // 光标在上一段和下一段之间的空行上
        const c = await caret(page)
        expect(c, key).toEqual({ text: '', prev: '上一段。' })
        await waitSaved(page)
        expect(readFileSync(join(vault, '块.md'), 'utf8'), key).toBe(gone)
        await page.keyboard.press('Meta+z')
        await expect.poll(() => editorText(page), key).toBe(doc)
        await waitSaved(page)
        expect(Buffer.from(readFileSync(join(vault, '块.md'))).equals(Buffer.from(doc)), key).toBe(true)
      }
      expect(gitStatus(vault)).toBe('')
    } finally {
      await run.close()
    }
  })
}

// ---------------------------------------------------------------- 能改字的块

const TEXT_KINDS: [string, string, string, string][] = [
  // 名字、块、退格后光标那一行的字、Delete 后光标那一行的字
  ['代码块', '```js\nlet a = 1\n```', 'let a = 1', 'let a = 1'],
  ['提示块', '> [!tip] 提示标题\n> 提示正文。', '提示正文。', '提示标题'],
  ['AI 讲解（展开）', '> [!ai]+ 讲解\n> 正文一', '正文一', '讲解'],
  ['AI 讲解（收着）', '> [!ai]- 讲解\n> 正文一', '讲解', '讲解'],
]

test('task-6lsvd 能改字的块（代码块、提示块、AI 讲解）：下面一行行首退格、上面一行行尾 Delete 走进块里，记号不丢、光标不跳走', async () => {
  const files: Record<string, string> = {}
  TEXT_KINDS.forEach(([, block], i) => (files[`字块${i}.md`] = `# 字块${i}\n\n上一段。\n\n${block}\n\n下一段。\n`))
  const run = await launch(files)
  const { page, vault } = run
  try {
    for (const [i, [name, , atBs, atDel]] of TEXT_KINDS.entries()) {
      const doc = files[`字块${i}.md`]!
      await openNote(page, `字块${i}`)
      await page.waitForTimeout(300)
      await line(page, '下一段').click({ position: { x: 2, y: 6 } })
      await page.keyboard.press('ArrowUp')
      expect((await caret(page)).text, name).toBe('')
      await page.keyboard.press('Backspace')
      expect(await editorText(page), name).toBe(doc)
      expect((await caret(page)).text, name + ' 退格').toContain(atBs)
      await line(page, '上一段').click()
      await page.keyboard.press('End')
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Delete')
      expect(await editorText(page), name).toBe(doc)
      expect((await caret(page)).text, name + ' Delete').toContain(atDel)
    }
    expect(gitStatus(vault)).toBe('')
  } finally {
    await run.close()
  }
})

// ---------------------------------------------------------------- 设计复审用的截图

const DIR = process.env.CN_SHOTS
const DARK = process.env.CN_SHOT_TONE === 'dark'

async function shot(run: Running, name: string) {
  await run.page.waitForTimeout(350)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(DIR!, `${name}${DARK ? '-dark' : '-light'}.png`), Buffer.from(b64, 'base64'))
}

test('task-6lsvd 截图：公式块（对照）和数据库块选中的样子、删掉以后', async () => {
  test.skip(!DIR, '只在给了 CN_SHOTS 时截图')
  mkdirSync(DIR!, { recursive: true })
  const run = await launch({ [BOOK_PATH]: BOOK, '公式.md': `# 公式\n\n上一段。\n\n$$\n\\sum_{i=1}^{n} x_i\n$$\n\n下一段。\n` })
  const { page, app } = run
  try {
    await page.evaluate((dark) => window.cn.setSettings({ appearance: { followSystem: false, skin: dark ? 'petrol' : 'sky' } }), DARK)
    await page.reload()
    await page.locator('.vault b').waitFor()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    await page.waitForTimeout(400)
    await openNote(page, '公式')
    await line(page, '下一段').click({ position: { x: 2, y: 6 } })
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('Backspace')
    await expect(pane(page).locator('.cm-math-sel')).toHaveCount(1)
    await shot(run, '1-公式块选中')
    await openNote(page, '杀死一只知更鸟（同名电影原著）')
    const db = pane(page).locator('[data-part="数据库块"]')
    await clickBelow(page, '.cm-base')
    await shot(run, '2-数据库块下面一行')
    await page.keyboard.press('Backspace')
    await expect(selBg(page)).toHaveCount(1)
    await shot(run, '3-数据库块选中')
    await page.keyboard.press('Backspace')
    await expect(db).toHaveCount(0)
    await shot(run, '4-数据库块删掉以后')
  } finally {
    await run.close()
  }
})
