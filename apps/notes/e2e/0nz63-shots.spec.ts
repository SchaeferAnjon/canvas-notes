/**
 * task-0nz63 交付页（设计稿目录 canvas-notes-visual/28-空块灰字和大框/）的改前改后截图：同一份脚本在改前、改后的代码上各跑一次，
 * CN_SHOTS=<目录>，CN_SHOT_TONE=dark 换深色。平时跳过。
 */
import { expect, type Page, test } from '@playwright/test'
import { join } from 'node:path'
import { launch, openNote, pane, type Running } from './app'
import { LECTURE } from './fixtures/pdf'
import { shotTone, shotWindow } from './shots'

test.skip(!process.env.CN_SHOTS, '只在截交付图时跑（CN_SHOTS=目录）')

const PDF = '课程/ecp/Lecture05.pdf'
const NOTE = '课程/ecp/Lecture05 笔记.md'
const DOC =
  '# Lecture05 笔记\n\n重叠意味着相邻两个窗口有 15 秒数据完全相同。更严格的做法是按驾驶场次或按司机来划分。\n\n> [!info] 说明\n\n> [!danger] 出错\n\n> [!info] 讲了重采样后不滤波、靠卷积自学去噪，以及 30 秒窗口 50% 重叠的道理\n'
const line = (page: Page, text: string) => pane(page).locator('.cm-content .cm-line', { hasText: text }).first()
const dark = process.env.CN_SHOT_TONE === 'dark'

async function start(): Promise<Running> {
  const run = await launch({ [PDF]: LECTURE, [NOTE]: DOC })
  await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
  await shotTone(run.page)
  await openNote(run.page, 'Lecture05 笔记')
  await expect(line(run.page, '讲了重采样')).toBeVisible()
  return run
}

/** 编辑器下半截（从提示块往下）放大截一块 */
async function shotEnd(page: Page, name: string) {
  const c = (await line(page, '说明').boundingBox())!
  const content = (await pane(page).locator('.cm-content').boundingBox())!
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(process.env.CN_SHOTS!, `${name}${dark ? '-dark' : ''}.png`), clip: { x: content.x - 90, y: c.y - 30, width: content.width + 180, height: 330 } })
}

test('空块灰字：提示块末尾回车两下出块', async () => {
  const run = await start()
  const { page } = run
  try {
    await line(page, '讲了重采样').click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.mouse.move(5, 5)
    // 光标不闪（常亮），图上看得到光标就在灰字那一行
    await page.addStyleTag({ content: '.cm-cursorLayer { animation: none !important; visibility: visible !important }' })
    await shotEnd(page, '1-空块灰字')
    await shotWindow(run, '1-空块灰字-整窗')
    // 鼠标停在光标那一行下面（文末那一行）：看悬停出不出空的加号、把手
    const ph = (await pane(page).locator('.cm-blockph').boundingBox())!
    await page.mouse.move(ph.x + 60, ph.y + ph.height + 14)
    await page.waitForTimeout(400)
    await shotEnd(page, '1-空块灰字-悬停下一行')
  } finally {
    await run.close()
  }
})

test('拖选框：从文末下面往左上拖到提示块，松手没送到页面', async () => {
  const run = await start()
  const { page } = run
  try {
    const cdp = await page.context().newCDPSession(page)
    const mouse = (type: 'mouseMoved' | 'mousePressed' | 'mouseReleased', x: number, y: number, buttons: number) =>
      cdp.send('Input.dispatchMouseEvent', { type, x, y, buttons, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', clickCount: type === 'mouseMoved' ? 0 : 1 })
    const c = (await line(page, '讲了重采样').boundingBox())!
    // 用户截图 img3 的样子：从文末下面的空白按下（光标进到文末那一行），往左上拖过提示块
    await page.mouse.move(c.x + 640, c.y + 300)
    await page.mouse.down()
    await page.mouse.move(c.x + 630, c.y + 260, { steps: 4 })
    await page.mouse.move(c.x - 120, c.y + 14, { steps: 10 })
    // 窗口外松手：之后页面只收到左键已经松开的 mousemove，鼠标回到提示块左边停着
    await mouse('mouseMoved', c.x - 200, c.y - 60, 0)
    await mouse('mouseMoved', c.x - 120, c.y + 14, 0)
    await page.waitForTimeout(300)
    await shotWindow(run, '2-拖选框-整窗')
  } finally {
    await run.close()
  }
})
