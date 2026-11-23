// AI 回答下面一排「拷贝 · 插进文档 · ⋯」（task-83vl3 第 3 条，用户：「每次回答完之后，我觉得应该有复制、插入文档或者其他的操作」；
// 「引用再问」task-bppvn 拿掉了，选一句引用在 bppvn-quote-sentence.spec.ts）。
// 真点：拷贝进剪贴板的是整条回答的 md；插入到文档插在光标处（没点进过文档接在末尾），文件里多出来回答原文 + 一行出处和链回对话，
// 打开再保存文件不变；点那条链接 AI 格回到那段对话、那条回答。无头、假 AI、临时库。
import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { WIDE_ANSWER } from '../src/main/agent/fake-engine'
import { launch, openAi, openNote, pane } from './app'
import { clipboardText } from './menu'

const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })

async function ask(page: Page, text: string) {
  const box = chat(page).getByRole('textbox', { name: '问 AI' })
  await box.fill(text)
  await box.press('Enter')
  await expect(chat(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 30_000 })
  return chat(page).getByTestId('ai-msg').last()
}

const NOTE = '# 学习笔记\n\n第一段。\n\n第二段。\n'

test('拷贝、插进文档（光标处）：剪贴板、输入框、文件里的字都对；打开再保存不变；点「回到 AI 对话」回到那条回答', async () => {
  const run = await launch({ '学习笔记.md': NOTE, '别的.md': '# 别的\n\n一段。\n' }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await openNote(page, '学习笔记')
    await openAi(page)
    await ask(page, '给我一段宽内容')
    await ask(page, '把这周总结成三句话')
    const first = chat(page).getByTestId('ai-msg').nth(0)
    const second = chat(page).getByTestId('ai-msg').nth(1)
    await expect(second.locator('.txt')).toContainText('下周要把论文计划')
    const row1 = first.getByTestId('ai-ans-acts')
    const row2 = second.getByTestId('ai-ans-acts')
    await expect(row2.getByRole('button')).toHaveText(['拷贝', '插进文档', ''])
    // 第 3 颗是 ⋯（task-r00en），只有图标；没有「引用再问」（task-bppvn）
    await expect(row2.getByRole('button').nth(2)).toHaveAccessibleName('这条回答还能做什么')
    await expect(row2.getByRole('button', { name: '引用再问' })).toHaveCount(0)
    // 最新那条一直露着；之前那条平时看不见、指着那条回答才露
    await page.mouse.move(5, 5)
    await expect(row2).toHaveCSS('opacity', '1')
    await expect(row1).toHaveCSS('opacity', '0')
    await first.locator('.txt p').first().hover()
    await expect(row1).toHaveCSS('opacity', '1')
    // 悬停出提示
    await row1.getByRole('button', { name: '拷贝' }).hover()
    await expect(page.getByTestId('tooltip')).toContainText('拷贝这条回答（Markdown原文）')

    // 拷贝：整条回答的 md 原文，按钮变「已拷贝」
    await row1.getByRole('button', { name: '拷贝' }).click()
    await expect(row1.getByRole('button', { name: '已拷贝' })).toBeVisible()
    expect(await clipboardText(run)).toBe(WIDE_ANSWER)
    await expect(row1.getByRole('button', { name: '拷贝' })).toBeVisible({ timeout: 3000 })

    // 插进文档：先在文档「第一段。」末尾点一下放光标，再点按钮
    const ed = pane(page).locator('.cm-content')
    await ed.getByText('第一段。').click()
    await page.keyboard.press('End')
    await first.hover()
    await row1.getByRole('button', { name: '插进文档' }).hover()
    await expect(page.getByTestId('tooltip')).toContainText('插到《学习笔记》光标处写成 AI 块，块头链回这段对话')
    await row1.getByRole('button', { name: '插进文档' }).click()
    await expect(page.getByText('插进了《学习笔记》')).toBeVisible()
    const id = await first.getAttribute('data-msg')
    const link = `[回到 AI 对话](canvas-notes://chat?key=${encodeURIComponent('file:学习笔记.md')}&msg=${id})`
    // 文件里是一个 [!ai] 提示块：块头谁答的 + 链回对话，块里每行「> 」是回答原文（空行写「>」）
    const quoted = WIDE_ANSWER.split('\n').map((l) => (l.trim() ? `> ${l}` : '>')).join('\n')
    const want = `# 学习笔记\n\n第一段。\n\n> [!ai] AI 回答 · Claude Code · Opus 5.5 · ${link}\n${quoted}\n\n第二段。\n`
    const file = join(vault, '学习笔记.md')
    // 插完光标落在下面新的空段落（文件里那一行空着）；存盘后去掉多出的那个空段落比
    await expect.poll(() => readFileSync(file, 'utf8').replace(/\n{3,}/g, '\n\n'), { timeout: 10_000 }).toBe(want)
    // 文档里画成带框、带 Claude 标志的 AI 块；块里的两张表、一个代码块照常排，一个「|」「```」写法都不露
    const doc = pane(page).locator('.cm-content')
    const head = doc.locator('.cm-callout-head.cm-callout-ai')
    await expect(head).toHaveCount(1)
    await expect(head.locator('.cm-callout-icon svg, .cm-callout-icon img').first()).toBeVisible()
    // 块头两行（同网页讲解写进来的块，task-6cxtc 复审）：第一行「AI 回答」，第二行「Claude Code · Opus 5.5 · 回到 AI 对话」
    await expect(head.locator('.cm-callout-name')).toHaveText('AI 回答')
    await expect(head.locator('.cm-callout-meta')).toHaveText('Claude Code · Opus 5.5 · 回到 AI 对话')
    await expect(doc.locator('.cm-inquote .cm-table')).toHaveCount(2)
    await expect(doc.locator('.cm-inquote .cm-table').nth(1).locator('th')).toHaveCount(9)
    await expect(doc.locator('.cm-inquote-code')).toHaveText(WIDE_ANSWER.split('```python\n')[1]!.split('\n```')[0]!)
    const shown = await doc.evaluate((el) => (el as HTMLElement).innerText)
    expect(shown).not.toContain('|---')
    expect(shown).not.toContain('```')
    expect(shown).not.toContain('[!ai]')
    // 块里的表、代码块和提示块同宽，左右对齐（套在提示块的底里，不出框）
    const hb = (await head.boundingBox())!
    for (const b of await doc.locator('.cm-inquote').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))) {
      expect(Math.abs(b.x - hb.x)).toBeLessThanOrEqual(1)
      expect(Math.abs(b.width - hb.width)).toBeLessThanOrEqual(1)
    }
    // 宽表在自己框里横着滚，文档不横着滚
    const wide = doc.locator('.cm-inquote .cm-table').nth(1)
    expect(await wide.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
    expect(await pane(page).locator('.cm-scroller').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    await page.screenshot({ path: test.info().outputPath('inserted.png') })
    await expect(pane(page).locator('.cm-link', { hasText: '回到 AI 对话' })).toBeVisible()

    // 打开再保存：关掉标签重开、⌘S，文件一个字节不变
    const saved = readFileSync(file)
    await page.keyboard.press('Meta+w')
    await openNote(page, '学习笔记')
    await pane(page).locator('.cm-content').click()
    await page.keyboard.press('Meta+s')
    await page.waitForTimeout(800)
    expect(readFileSync(file).equals(saved)).toBe(true)

    // 点那条链接：先把 AI 对话滚到最上面；指着链接出链接卡「回到对话」，点了滚回那条回答、闪一下
    await chat(page).locator('.msgs').evaluate((el) => el.scrollTo({ top: 0 }))
    await second.evaluate((el) => el.scrollIntoView())
    const lk = pane(page).locator('.cm-link', { hasText: '回到 AI 对话' })
    await lk.scrollIntoViewIfNeeded()
    await lk.hover()
    const card = page.getByRole('dialog', { name: '链接' })
    await expect(card.locator('.u')).toHaveText('AI 对话里的一条回答')
    await card.getByRole('button', { name: /回到对话/ }).click()
    await expect(first).toHaveClass(/jumped/)
    await expect(first).toBeInViewport()

    // 换到别的文档：AI 格换成「别的」那段对话；在「别的」里点那条链接，AI 格当「看别处的对话」打开「学习笔记」那段、滚到那条
    await openNote(page, '别的')
    await expect(chat(page).getByTestId('ai-msg')).toHaveCount(0)
    await pane(page).locator('.cm-content').click()
    await page.keyboard.press('Meta+End')
    await page.keyboard.type(`\n\n${link}`)
    await page.keyboard.press('Escape')
    const lk2 = pane(page).locator('.cm-link', { hasText: '回到 AI 对话' })
    await lk2.click({ modifiers: ['Meta'] })
    await expect(chat(page).getByTestId('ai-msg')).toHaveCount(2)
    await expect(chat(page).getByTestId('ai-msg').first()).toHaveClass(/jumped/)
    await expect(chat(page).getByTestId('ai-conv')).toHaveAttribute('aria-label', '对话：学习笔记')
  } finally {
    await run.close()
  }
})

test('中间没开文档时「插进文档」变淡、点了不插，悬停说要开一篇文档', async () => {
  const run = await launch({ '学习笔记.md': NOTE }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await openNote(page, '学习笔记')
    await openAi(page)
    await ask(page, '把这周总结成三句话')
    // 关掉文档回首页（中间没有文档），对话菜单里点开「学习笔记」那段
    await pane(page).locator('.cm-content').click()
    await page.keyboard.press('Meta+w')
    await expect(page.getByTestId('tab-on')).toHaveText('首页')
    await chat(page).getByTestId('ai-conv').click()
    await chat(page).locator('.convmenu .it', { hasText: '学习笔记' }).click()
    const row = chat(page).getByTestId('ai-msg').last().getByTestId('ai-ans-acts')
    const ins = row.getByRole('button', { name: '插进文档' })
    await expect(ins).toHaveAttribute('aria-disabled', 'true')
    await expect(ins).toHaveCSS('opacity', '0.45')
    await ins.hover()
    await expect(page.getByTestId('tooltip')).toHaveText('中间开着一篇文档才能插')
    await ins.click({ force: true })
    await page.waitForTimeout(500)
    expect(readFileSync(join(vault, '学习笔记.md'), 'utf8')).toBe(NOTE)
    // 拷贝照样能用
    await row.getByRole('button', { name: '拷贝' }).click()
    expect(await clipboardText(run)).toBe('这周主要在赶第5讲的作业，注意力机制那部分花了两个晚上才弄懂。\n\n周三开始每天早上跑步，三次都坚持下来了。\n\n下周要把论文计划的第一节写完，并约导师见一面。')
  } finally {
    await run.close()
  }
})
