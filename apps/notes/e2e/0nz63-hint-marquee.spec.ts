/**
 * task-0nz63（用户在 0.5.2 里看到的两处，截图 r83 img2、img3）：读 PDF 的配对笔记，最后一块是提示块。测试模式里真按键、真鼠标，先红后绿。
 * - 空块灰字：提示块末尾回车、空的「> 」再回车出块，光标停在文末的空块里：灰字只写在光标这一行（以前光标这一行和文末那一行各写一遍，两行一样）。
 * - 拖选多块的框：从文末下面的空白往左上拖到提示块，松手没送到页面（透明窗口外松手），框得收掉、点字光标照常落下（以前框留在屏上跟着鼠标走，
 *   提示块一直被选着，光标只能落进文末那一行）。
 * 两条都只是显示：文件里的字只有真打的那几下。
 */
import { expect, type Page, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { editorText, launch, openNote, pane, type Running, waitSaved } from './app'
import { LECTURE } from './fixtures/pdf'

const PDF = '课程/ecp/Lecture05.pdf'
const NOTE = '课程/ecp/Lecture05 笔记.md'
const DOC =
  '# Lecture05 笔记\n\n重叠意味着相邻两个窗口有 15 秒数据完全相同。更严格的做法是按驾驶场次或按司机来划分。\n\n> [!info] 讲了重采样后不滤波、靠卷积自学去噪，以及 30 秒窗口 50% 重叠的道理\n'
const HINT = '输入 / 插入块，或者直接写'

const line = (page: Page, text: string) => pane(page).locator('.cm-content .cm-line', { hasText: text }).first()
const file = (run: Running) => readFileSync(join(run.vault, NOTE), 'utf8')
/** 编辑器里所有写着灰字「输入 / 插入块…」的地方（空块的、文末那一行的） */
const hints = (page: Page) => pane(page).locator('.cm-blockph, .cm-tail-ph').filter({ hasText: HINT })

async function caret(page: Page) {
  const { sel, text } = await pane(page)
    .locator('.cm-editor')
    .evaluate((el) => ({ sel: (el as HTMLElement & { cnSel: { anchor: number; head: number } }).cnSel, text: (el as HTMLElement & { cnText: string }).cnText }))
  return { head: sel.head, empty: sel.head === sel.anchor, line: text.slice(0, sel.head).split('\n').length }
}

async function start(): Promise<Running> {
  const run = await launch({ [PDF]: LECTURE, [NOTE]: DOC })
  await run.page.setViewportSize({ width: 1440, height: 900 })
  await openNote(run.page, 'Lecture05 笔记')
  await expect(line(run.page, '讲了重采样')).toBeVisible()
  return run
}

test('提示块里空的「> 」回车出块，光标停在文末的空块里：灰字只有光标这一行一份；光标走开文末那一行照旧一份；文件只多真打的', async () => {
  const run = await start()
  const { page } = run
  try {
    // 文末那一行常驻一份
    await expect(hints(page)).toHaveCount(1)
    await line(page, '讲了重采样').click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    expect(await editorText(page)).toBe(DOC + '\n\n')
    // 光标在空块里：灰字一份，就在光标那一行
    await expect(hints(page)).toHaveCount(1)
    // 文末的空块只在屏上（task-axoxy，照 Tolaria）：这一行就是文末那一行，灰字是它那一份
    const onCaretLine = await page.evaluate(() => {
      const n = getSelection()?.focusNode
      const el = (n?.nodeType === 1 ? n : n?.parentElement) as HTMLElement | null
      return !!el?.closest('.cm-line')?.querySelector('.cm-blockph, .cm-tailline')
    })
    expect(onCaretLine).toBe(true)
    // 光标回到提示块：空块的灰字没了，文末那一行照旧一份
    await page.keyboard.press('ArrowUp')
    await expect(pane(page).locator('.cm-blockph')).toHaveCount(0)
    await expect(hints(page)).toHaveCount(1)
    // 回到空块打字：灰字没了，字是单独一段
    await page.keyboard.press('ArrowDown')
    await expect(hints(page)).toHaveCount(1)
    await page.keyboard.type('接着写')
    await expect.poll(() => editorText(page)).toBe(DOC + '\n接着写\n')
    await waitSaved(page)
    expect(file(run)).toBe(DOC + '\n接着写\n')
    await expect(pane(page).locator('.cm-blockph')).toHaveCount(0)
  } finally {
    await run.close()
  }
})

test('从文末下面的空白往左上拖到提示块，松手没送到页面（窗口外松手）：框收掉、提示块不再跟着鼠标被选上、点字光标落下；文件一个字节不变', async () => {
  const run = await start()
  const { page } = run
  try {
    const cdp = await page.context().newCDPSession(page)
    /** 真鼠标事件；buttons 0：左键已经松开（松手那一下发生在窗口外，页面没收到 mouseup） */
    const mouse = (type: 'mouseMoved' | 'mousePressed' | 'mouseReleased', x: number, y: number, buttons: number) =>
      cdp.send('Input.dispatchMouseEvent', { type, x, y, buttons, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', clickCount: type === 'mouseMoved' ? 0 : 1 })
    const c = (await line(page, '讲了重采样').boundingBox())!
    // 从文末下面的空白按下（光标进到文末那一行），往左上拖到提示块左边：出框，提示块选上
    await page.mouse.move(c.x + 640, c.y + 300)
    await page.mouse.down()
    await page.mouse.move(c.x + 630, c.y + 260, { steps: 4 })
    await page.mouse.move(c.x - 120, c.y + 14, { steps: 10 })
    const box = page.getByTestId('doc-marquee')
    await expect(box).toBeVisible()
    await expect(pane(page).locator('.cm-blkSelLayer .cm-blk-sel')).toHaveCount(1)
    // 拖出窗口外松手：页面只收到之后左键已经松开的 mousemove
    await mouse('mouseMoved', c.x + 300, c.y + 200, 0)
    await mouse('mouseMoved', c.x + 500, c.y + 320, 0)
    await expect(box).toHaveCount(0)
    // 就当在最后按着的地方松了手：框碰到的提示块留着选中（和正常松手一样）
    await expect(pane(page).locator('.cm-blkSelLayer .cm-blk-sel')).toHaveCount(1)
    // 再移动鼠标：不再出框，框不再跟着鼠标改选（移到别处，提示块照旧是那一块）
    await mouse('mouseMoved', c.x - 100, c.y - 120, 0)
    await mouse('mouseMoved', c.x + 400, c.y + 400, 0)
    await expect(box).toHaveCount(0)
    await expect(pane(page).locator('.cm-blkSelLayer .cm-blk-sel')).toHaveCount(1)
    // 点正文的字：光标落到那里（以前拖还没收，点字的光标被拦下，提示块还选着）
    const p = (await line(page, '重叠意味着').boundingBox())!
    await mouse('mouseMoved', p.x + 60, p.y + 10, 0)
    await mouse('mousePressed', p.x + 60, p.y + 10, 1)
    await mouse('mouseReleased', p.x + 60, p.y + 10, 0)
    await expect.poll(async () => (await caret(page)).line).toBe(3)
    await expect(pane(page).locator('.cm-blkSelLayer .cm-blk-sel')).toHaveCount(0)
    // 再从左边空白正常拖一次（按下、拖、松手都送到）：照常出框、松手就收
    await mouse('mouseMoved', c.x - 120, p.y + 6, 0)
    await mouse('mousePressed', c.x - 120, p.y + 6, 1)
    for (let i = 1; i <= 8; i++) await mouse('mouseMoved', c.x - 120 + i, p.y + 6 + i * ((c.y - p.y + 10) / 8), 1)
    await expect(box).toBeVisible()
    await mouse('mouseReleased', c.x - 112, c.y + 16, 0)
    await expect(box).toHaveCount(0)
    await expect(pane(page).locator('.cm-blkSelLayer .cm-blk-sel')).toHaveCount(2)
    await waitSaved(page)
    expect(file(run)).toBe(DOC)
  } finally {
    await run.close()
  }
})
