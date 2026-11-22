/**
 * 截图里第二条「我的评价」（task-busas）：「就说」「x」「x 是 4 维向量」、「tensor(0, 1, 2, 3)」。
 * - 「x」两遍、断行在文件里就是这样：AI 回答里排好的公式 𝐱 拷出来，浏览器把 KaTeX 给读屏的那份和看的那份都拷了。改成拷出 `$\mathbf{x}$`。
 * - 方括号不见了是画的问题：「[0, 1, 2, 3]」lezer 认成链接、括号藏了还画下划线。光一对方括号不是链接，原样露着。
 * 不碰系统剪贴板：拷贝、粘贴都用页面里的 ClipboardEvent 带一个 DataTransfer 走软件自己的处理。
 */
import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { editorText, launch, openNote, pane, waitSaved } from './app'

const FILE = '向量.md'
const SAY = '比如 x = tensor([0, 1, 2, 3]) 里有 4 个数，就说 $\\mathbf{x}$ 是 4 维向量。'
const DOC = `# 向量\n\n${SAY}\n\n看 [d2l](https://d2l.ai) 和 [[向量]]。\n\n> 向量只是一个数字数组。\n—— [2.3. 线性代数](https://zh.d2l.ai/x)\n\n我的评价：\n`
const line = (page: Page, text: string) => pane(page).locator('.cm-line', { hasText: text }).first()

test('光一对方括号原样露着（链接、双链照旧）；从白板卡上拷带公式的一段：纯文字里公式是 $原文$、只一遍，粘进「我的评价」文件对', async () => {
  const run = await launch({ [FILE]: DOC.replace('\n\n我的评价：\n', '\n') })
  const { page } = run
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openNote(page, '向量')
    // 文档里：方括号看得见、不画成链接；真链接、双链照旧
    const say = line(page, '里有 4 个数')
    await expect(say).toContainText('tensor([0, 1, 2, 3])')
    await expect(say.locator('.cm-link')).toHaveCount(0)
    await expect(line(page, '看 ').locator('.cm-link', { hasText: 'd2l' })).toHaveCount(1)
    await expect(line(page, '看 ').locator('.cm-wikilink')).toHaveText('向量')
    await page.screenshot({ path: 'test-results/busas-brackets.png' })

    // 白板看法：卡上是软件排好的公式（和 AI 回答同一份 KaTeX 输出，tex.ts）。卡能拖、字选不了：把这一段原样放进一块能选字的地方（同 AI 回答），选中拷贝
    await page.keyboard.press('Meta+e')
    await expect(page.locator('.katex:visible').first()).toBeVisible()
    const got = await page.evaluate(() => {
      const k = [...document.querySelectorAll('.katex')].find((e) => (e as HTMLElement).getClientRects().length > 0 && !e.closest('.cm-editor'))!
      let p = k.parentElement!
      while (!p.textContent!.includes('比如')) p = p.parentElement!
      const box = document.createElement('div')
      box.style.cssText = 'position:fixed;left:20px;top:20px;width:600px;user-select:text;background:#fff;z-index:9999'
      box.innerHTML = `<p>${p.innerHTML}</p>`
      document.body.append(box)
      const r = document.createRange()
      r.selectNodeContents(box.firstElementChild!)
      const sel = document.getSelection()!
      sel.removeAllRanges()
      sel.addRange(r)
      const browser = sel.toString()
      const dt = new DataTransfer()
      box.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }))
      box.remove()
      return { browser, ours: dt.getData('text/plain'), html: dt.getData('text/html').length }
    })

    // 浏览器自己的拷法：x 不止一遍（读屏那份 + 看的那份）；软件拷出的：公式写回 $原文$、只一遍
    expect(got.browser).toMatch(/就说 *\n.+\nx 是/)
    expect(got.ours.trim()).toBe(SAY)
    expect(got.html).toBeGreaterThan(0)

    // 回到文档，粘进一段评价里：文件里公式只一遍
    await page.keyboard.press('Meta+e')
    await line(page, '2.3. 线性代数').click()
    await page.keyboard.press('End')
    await page.keyboard.press('Tab')
    await expect(pane(page).locator('.cm-review-tag')).toHaveText('我的评价')
    await pane(page).locator('.cm-content').evaluate((el, text) => {
      const dt = new DataTransfer()
      dt.setData('text/plain', text)
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    }, got.ours.trim())
    await waitSaved(page)
    const md = readFileSync(join(run.vault, FILE), 'utf8')
    expect(md).toContain(`我的评价：${SAY}\n`)
    expect(await editorText(page)).toBe(md)
    await page.screenshot({ path: 'test-results/busas-paste-math.png' })
  } finally {
    await run.close()
  }
})
