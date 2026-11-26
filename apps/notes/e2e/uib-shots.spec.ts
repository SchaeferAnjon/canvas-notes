/**
 * ui-b 给设计复审的截图（CN_SHOTS=<目录> 时才跑）：A3 文末打「#」、「# 」、「# 标题」三步的样子，用户的外观（薄荷 + 浮岛书桌 + 主题渐变）。
 * 截中间那一栏，光标那一行用一个 2px 的强调色竖线标出来（测试窗口不激活，系统不画光标）
 */
import { expect, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { launch, openNote, pane } from './app'

const DIR = process.env.CN_SHOTS
test.skip(!DIR, '只在 CN_SHOTS 给了目录时截图')

test('A3 三步截图', async () => {
  mkdirSync(DIR!, { recursive: true })
  const run = await launch({ '收件箱/收件箱整理.md': '# 收件箱整理\n\n## 软件问题与反馈\n\n- 在项目里新建文件夹时，PDF 没办法直接拖到新建的文件夹里。\n- 没有课程进度的组件。\n' })
  const { page } = run
  try {
    await openNote(page, '收件箱整理')
    await pane(page).locator('.cm-tailline').click()
    const shot = async (name: string) => {
      // 光标位置画一根竖线（截图里看得出光标在哪、多高）
      await page.evaluate(() => {
        document.getElementById('uib-caret')?.remove()
        const ed = document.querySelector('.pane:not([hidden]) .cm-editor') as HTMLElement & { cnSel: { head: number } }
        const sel = document.getSelection()!
        const r = sel.rangeCount ? sel.getRangeAt(0).getClientRects()[0] : null
        const ln = (sel.focusNode?.nodeType === 1 ? (sel.focusNode as HTMLElement) : sel.focusNode?.parentElement)?.closest('.cm-line') as HTMLElement | null
        const box = ln!.getBoundingClientRect()
        const fs = parseFloat(getComputedStyle(ln!).fontSize)
        const x = r && r.width === 0 && r.height ? r.left : box.left + 6 + (ln!.textContent?.length ? 0 : 0)
        const c = document.createElement('div')
        c.id = 'uib-caret'
        c.style.cssText = `position:fixed;left:${x}px;top:${box.top + (box.height - fs * 1.2) / 2}px;width:2px;height:${fs * 1.2}px;background:var(--acc);z-index:99999;pointer-events:none`
        document.body.appendChild(c)
        void ed
      })
      await pane(page).screenshot({ path: join(DIR!, `${name}.png`) })
    }
    await page.keyboard.type('#')
    await shot('a3-1-只打井号')
    await page.keyboard.type(' ')
    await shot('a3-2-井号空格')
    await page.keyboard.type('新的一节')
    await shot('a3-3-标题')
    await expect(pane(page).locator('.cm-line.cm-h1').last()).toHaveText('新的一节')
  } finally {
    await run.close()
  }
})
