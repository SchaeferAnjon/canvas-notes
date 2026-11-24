// 回答下面那排（task-eavzx，款式页「62-回答按钮款式」第二版）：AI 对话这一处的真点。
// 左边功能按钮固定（拷贝 · 插进文档 · ⋯），AI 对话默认一颗快捷回复也没有；命令库里勾了 AI 对话的快捷回复，每加一颗这一排多一颗，
// 点了替你在这段对话里发那句；放不下的进 ⋯（⋯ 里上面固定的功能、中间放不下的、最下面「调整这一排…」），右栏拉宽又排出来；
// 「插进文档」按钮和右键同名那项插出来的是同一个 AI 块。无头、假 AI、临时库。
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, openAi, openNote, pane, widenRight } from './app'
import { armMenus, pickMenu } from './menu'

const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })

async function ask(page: Page, text: string) {
  const box = chat(page).getByRole('textbox', { name: '问 AI' })
  await box.fill(text)
  await box.press('Enter')
  await expect(chat(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 30_000 })
  const msg = chat(page).getByTestId('ai-msg').last()
  await expect(msg).not.toHaveAttribute('aria-busy')
  return msg
}

/** 命令库里的几颗自己的快捷回复（和设置里「加一颗」、存成快捷回复存下来的一样） */
function cmds(replies: { id: string; name: string; say: string; where: string[] }[]) {
  return (
    JSON.stringify(
      {
        version: 1,
        own: replies.map((r) => ({ id: r.id, name: r.name, kind: 'ai', target: r.say, prompt: r.say, write: 'answer', where: [], desc: r.say, reply: { where: r.where, out: 'here' } })),
        replies: { on: ['still', 'another', 'viz', ...replies.map((r) => r.id)], more: [], off: [] },
      },
      null,
      2,
    ) + '\n'
  )
}

const NOTE = '# 学习笔记\n\n第一段。\n'

test('AI 对话默认只有左边的功能按钮；⋯ 里存进收件箱 · 拷贝为 Markdown · 调整这一排…；加了一颗「举个例子」这一排多一颗，点了真发出那句', async () => {
  const run = await launch({ '学习笔记.md': NOTE }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await openNote(page, '学习笔记')
    await openAi(page)
    const msg = await ask(page, '你好')
    const row = msg.getByTestId('ai-ans-acts')
    await expect(row.getByRole('button')).toHaveText(['拷贝', '插进文档', ''])
    await expect(row.locator('[data-reply]')).toHaveCount(0)
    await expect(row.locator('.cn-ab-sep')).toHaveCount(0)
    // 功能按钮无边框灰字：没有边框、背景透明
    await expect(row.getByRole('button', { name: '拷贝' })).toHaveCSS('border-top-width', '0px')
    await expect(row.getByRole('button', { name: '拷贝' })).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await row.getByRole('button', { name: '这条回答还能做什么' }).click()
    const menu = page.getByRole('menu', { name: '这条回答还能做什么' })
    await expect(menu.getByRole('menuitem')).toHaveText(['存进收件箱', '拷贝为 Markdown', '调整这一排…'])
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)

    // 命令库里加一颗勾了 AI 对话的「举个例子」（外面改了命令.json，同步过来一样，软件跟着读）
    mkdirSync(join(vault, '.canvas-notes'), { recursive: true })
    writeFileSync(join(vault, '.canvas-notes/命令.json'), cmds([{ id: 'own-eg', name: '举个例子', say: '举个生活里的例子', where: ['chat'] }]))
    // 库里点文件夹里的变动不单独通知：再动一篇笔记，软件重读一遍库（同别的电脑同步过来）
    writeFileSync(join(vault, '别的.md'), '# 别的\n')
    await expect(row.locator('[data-reply]')).toHaveText(['举个例子'], { timeout: 10_000 })
    await expect(row.locator('.cn-ab-sep')).toHaveCount(1)
    // 快捷回复：描边胶囊，画那一家的标志
    const eg = row.getByRole('button', { name: '举个例子' })
    await expect(eg).toHaveCSS('border-top-width', '1px')
    await expect(eg).toHaveCSS('border-top-left-radius', '999px')
    await expect(eg.locator('.cn-ab-logo .eng-logo')).toHaveCount(1)
    await eg.click()
    // 和自己打字发出去一样：多一句「举个生活里的例子」，AI 接着答，新的那条下面照样有这一颗
    await expect(chat(page).locator('.um').last()).toHaveText('举个生活里的例子')
    await expect(chat(page).getByTestId('ai-msg')).toHaveCount(2)
    const next = chat(page).getByTestId('ai-msg').last()
    await expect(next).not.toHaveAttribute('aria-busy', { timeout: 30_000 })
    await expect(next.getByTestId('ai-ans-acts').locator('[data-reply]')).toHaveText(['举个例子'])
    // 只勾了 AI 对话：读 PDF 那几颗自带的不在这里
    await expect(next.getByTestId('ai-ans-acts').getByRole('button', { name: '还是不懂' })).toHaveCount(0)
    await page.screenshot({ path: test.info().outputPath('chat-one-reply.png') })
  } finally {
    await run.close()
  }
})

test('放不下的快捷回复进 ⋯，左边先收成图标；右栏拉宽又排出来', async () => {
  const mine = [
    { id: 'own-eg', name: '举个例子', say: '举个生活里的例子', where: ['chat'] },
    { id: 'own-quiz', name: '考考我', say: '就{这条回答}出三道选择题考我', where: ['chat'] },
    { id: 'own-en', name: '用英文讲', say: '用英文再讲一遍', where: ['chat'] },
    { id: 'own-short', name: '再短一点', say: '再说短一点', where: ['chat'] },
  ]
  const run = await launch({ '学习笔记.md': NOTE, '.canvas-notes/命令.json': cmds(mine) }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900))
    await openNote(page, '学习笔记')
    await openAi(page)
    const msg = await ask(page, '你好')
    const row = msg.getByTestId('ai-ans-acts')
    const spilled = async () => (await row.getAttribute('data-spill')) !== null
    // 先收窄到放不下：这一排一行，不折行，不出右栏
    const narrow = async () => {
      for (let i = 0; i < 6 && !(await spilled()); i++) await widenRight(page, -60)
    }
    await narrow()
    expect(await spilled()).toBe(true)
    await expect(row).toHaveAttribute('data-icons', 'true')
    await expect(row.getByRole('button', { name: '拷贝' })).toHaveText('')
    const rb = (await row.boundingBox())!
    const shown = await row.locator('[data-reply]').count()
    expect(shown).toBeLessThan(4)
    for (const b of await row.locator(':scope > button').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))) {
      expect(b.right).toBeLessThanOrEqual(rb.x + rb.width + 1)
      expect(Math.abs(b.y - rb.y)).toBeLessThan(8)
    }
    // 照表里的顺序：排上的是前几颗，后面的进 ⋯ 中间那一段，点 ⋯ 里那一颗照样发出去
    const names = mine.map((m) => m.name)
    await expect(row.locator('[data-reply]')).toHaveText(names.slice(0, shown))
    await row.getByRole('button', { name: '这条回答还能做什么' }).click()
    const menu = page.getByRole('menu', { name: '这条回答还能做什么' })
    await expect(menu.locator('.cn-ab-mh')).toHaveText('快捷回复（这一排放不下的）')
    await expect(menu.getByRole('menuitem')).toHaveText(['存进收件箱', '拷贝为 Markdown', ...names.slice(shown), '调整这一排…'])
    await page.screenshot({ path: test.info().outputPath('narrow-more.png') })
    await menu.getByRole('menuitem', { name: '再短一点' }).click()
    await expect(chat(page).locator('.um').last()).toHaveText('再说短一点')
    const last = chat(page).getByTestId('ai-msg').last()
    await expect(last).not.toHaveAttribute('aria-busy', { timeout: 30_000 })
    const row2 = last.getByTestId('ai-ans-acts')

    // 拉宽右栏：四颗都排出来，左边带字，⋯ 里没有快捷回复那一段
    await widenRight(page, 520)
    await expect(row2.locator('[data-reply]')).toHaveText(names)
    await expect(row2).not.toHaveAttribute('data-spill')
    await expect(row2).not.toHaveAttribute('data-icons')
    await expect(row2.getByRole('button', { name: '拷贝' })).toHaveText('拷贝')
    await row2.getByRole('button', { name: '这条回答还能做什么' }).click()
    await expect(menu.getByRole('menuitem')).toHaveText(['存进收件箱', '拷贝为 Markdown', '调整这一排…'])
    await page.keyboard.press('Escape')
    // {这条回答} 填进那句：发出去的是带着上一条回答的
    await row2.getByRole('button', { name: '考考我' }).click()
    await expect(chat(page).locator('.um').last()).toContainText('就「这是测试回答')
    await page.screenshot({ path: test.info().outputPath('wide.png') })
  } finally {
    await run.close()
  }
})

test('「插进文档」按钮和右键同名那项插出来的是同一个 AI 块', async () => {
  const run = await launch({ '学习笔记.md': NOTE }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await armMenus(run)
    await openNote(page, '学习笔记')
    await openAi(page)
    const msg = await ask(page, '你好')
    const file = join(vault, '学习笔记.md')
    await msg.getByTestId('ai-ans-acts').getByRole('button', { name: '插进文档' }).click()
    await expect.poll(() => readFileSync(file, 'utf8')).toContain('> [!ai]')
    const one = readFileSync(file, 'utf8').replace(/\n{3,}/g, '\n\n')
    const block = one.slice(NOTE.length).trim()
    expect(block).toMatch(/^> \[!ai\] AI 回答 · Claude Code · Opus 5\.5 · \[回到 AI 对话\]\(canvas-notes:\/\/chat\?key=.+&msg=\d+\)\n> 这是测试回答（Claude Code）。$/)
    // 光标还在新插的那块下面：右键再插一次，同样的一块又多一份
    await msg.locator('.txt').click({ button: 'right' })
    await pickMenu(run, '插进文档')
    await expect.poll(() => readFileSync(file, 'utf8').split('> [!ai]').length - 1).toBe(2)
    const both = readFileSync(file, 'utf8').replace(/\n{3,}/g, '\n\n')
    expect(both.split(block).length - 1).toBe(2)
    await expect(pane(page).locator('.cm-callout-head.cm-callout-ai')).toHaveCount(2)
  } finally {
    await run.close()
  }
})
