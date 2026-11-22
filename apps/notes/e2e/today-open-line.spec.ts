/**
 * 画布今日「打开笔记，到这一行」：canvas-notes://open?file=<库里的路径>&line=<第几行>
 * → 画布笔记打开这一篇、光标放到那一行行尾、滚到那一行、左边闪一下（以前这个入口只认 PDF）。
 */
import { expect, type Page, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, pane } from './app'

const DOC = '# 小论文计划\n\n截稿前把实验和初稿弄完，周五交给导师。\n\n## 这周\n\n- [ ] 读完三篇相关论文 📅 2026-11-22 🔼\n    - [x] Attention Is All You Need\n    - [ ] BERT\n    - [ ] ViT\n- [ ] 交论文初稿 📅 2026-11-23 15:00 🔔 提前1小时 ⏫\n- [x] 和导师约时间 ✅ 2026-11-21\n' + '\n这一段很长。\n'.repeat(60)

const caretLine = (page: Page) =>
  page.evaluate(() => {
    const n = document.getSelection()?.focusNode
    const el = (n?.nodeType === 1 ? n : n?.parentElement) as HTMLElement | null
    return el?.closest('.cm-line')?.textContent ?? ''
  })

test('canvas-notes://open?file=…&line=11：打开那一篇，光标在第 11 行，那一行闪一下', async () => {
  const run = await launch({ '写作/小论文计划.md': DOC, '收件箱/甲.md': '# 甲\n\n随便写点。\n' })
  const { page, app } = run
  try {
    await app.evaluate(({ app }) => app.emit('open-url', { preventDefault() {} }, 'canvas-notes://open?file=%E5%86%99%E4%BD%9C%2F%E5%B0%8F%E8%AE%BA%E6%96%87%E8%AE%A1%E5%88%92.md&line=11'))
    await expect(page.locator('.tabs .tab.on')).toContainText('小论文计划')
    await expect.poll(() => caretLine(page)).toContain('交论文初稿')
    await expect(pane(page).locator('.cm-flashbar:not([hidden])')).toBeVisible()
    // 只是打开，文件一个字节没改
    expect(readFileSync(join(run.vault, '写作/小论文计划.md'), 'utf8')).toBe(DOC)
    // 再来一次到别的行：换到那一行
    await app.evaluate(({ app }) => app.emit('open-url', { preventDefault() {} }, 'canvas-notes://open?file=%E5%86%99%E4%BD%9C%2F%E5%B0%8F%E8%AE%BA%E6%96%87%E8%AE%A1%E5%88%92.md&line=7'))
    await expect.poll(() => caretLine(page)).toContain('读完三篇相关论文')
    // 行号比篇幅大：落在最后一行，不报错
    await app.evaluate(({ app }) => app.emit('open-url', { preventDefault() {} }, 'canvas-notes://open?file=%E6%94%B6%E4%BB%B6%E7%AE%B1%2F%E7%94%B2.md&line=99'))
    await expect(page.locator('.tabs .tab.on')).toContainText('甲')
    await expect.poll(() => caretLine(page)).toContain('随便写点')
  } finally {
    await run.close()
  }
})
