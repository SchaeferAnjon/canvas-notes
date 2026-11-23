// 「找不到的功能」第 6、7 件（task-r00en，用户看过 19-找不到的功能 说「可以施工了」）：
// 6. 斜杠菜单的提示块「全部列出来」：不打字 5 种都在；tishi、tip、拼音、英文、中文都搜得到（真打字）
// 7. AI 回答下面那排后面一颗 ⋯，里面「存进收件箱」（以前只在右键里、叫「存成卡片」）：真点，读盘看收件箱里那篇
import { expect, test, type Page } from '@playwright/test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, openAi, openNote, pane, waitSaved } from './app'

const slash = (page: Page) => page.locator('.slash-menu')
const KINDS = [/提示块 · 说明/, /提示块 · 注意/, /提示块 · 疑惑/, /提示块 · 讲通了/, /提示块 · 出错/]
const calloutRows = (page: Page) => slash(page).getByRole('option', { name: /^提示块 · / })

test('斜杠菜单：不打字 5 种提示块都列；打 tishi、tip、callout、提示 出 5 种；zhuyi、warning、注意 只出那一种，回车插进去', async () => {
  const run = await launch({ '贴士.md': '# 贴士\n\n开头。\n' })
  const { page, vault } = run
  const file = () => readFileSync(join(vault, '贴士.md'), 'utf8')
  try {
    await openNote(page, '贴士')
    await pane(page).locator('.cm-line', { hasText: '开头。' }).click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')

    // 不打字：5 种都在，挨在一起
    await page.keyboard.type('/')
    await expect(slash(page)).toBeVisible()
    await expect(calloutRows(page)).toHaveText(KINDS)
    const names = await slash(page).getByRole('option').evaluateAll((els) => els.map((e) => e.textContent ?? ''))
    const at = names.findIndex((n) => n.includes('提示块 · 说明'))
    expect(names.slice(at, at + 5).every((n) => n.startsWith('提示块 · '))).toBe(true)
    await page.screenshot({ path: 'test-results/r00en-slash-all.png' })

    // 总称：5 种都出
    for (const q of ['tishi', 'tip', 'callout', '提示']) {
      await page.keyboard.type(q)
      await expect(calloutRows(page), q).toHaveText(KINDS)
      for (let i = 0; i < q.length; i++) await page.keyboard.press('Backspace')
    }
    // 名字的拼音、英文、中文：只出那一种
    const one: [string, RegExp][] = [['zhuyi', /提示块 · 注意/], ['warning', /提示块 · 注意/], ['yihuo', /提示块 · 疑惑/], ['question', /提示块 · 疑惑/], ['error', /提示块 · 出错/], ['chucuo', /提示块 · 出错/], ['jiangtongle', /提示块 · 讲通了/], ['info', /提示块 · 说明/], ['讲通了', /提示块 · 讲通了/]]
    for (const [q, want] of one) {
      await page.keyboard.type(q)
      await expect(calloutRows(page), q).toHaveText([want])
      for (let i = 0; i < q.length; i++) await page.keyboard.press('Backspace')
    }
    // 打 zhuyi 回车：插进「注意」，写标题、回车写正文
    await page.keyboard.type('zhuyi')
    await expect(slash(page).getByRole('option').first()).toHaveAttribute('aria-selected', 'true')
    await expect(slash(page).getByRole('option').first()).toContainText('提示块 · 注意')
    await page.keyboard.press('Enter')
    await expect(slash(page)).toBeHidden()
    await page.keyboard.type('路上小心')
    await page.keyboard.press('Enter')
    await page.keyboard.type('冬天路面结冰。')
    await waitSaved(page)
    // 文末那一行里回车两下是两个空块（像 Notion，task-axoxy 第 15 条），提示块插在第二个里，上面留着一个空块
    expect(file()).toBe('# 贴士\n\n开头。\n\n\n> [!warning] 路上小心\n> 冬天路面结冰。\n')
  } finally {
    await run.close()
  }
})

const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })

test('AI 回答下面那排：最后一颗 ⋯，点开「存进收件箱」，回答原样进收件箱一篇、底栏说存进了；菜单开着时这排不藏；Esc 关', async () => {
  const run = await launch({ '学习笔记.md': '# 学习笔记\n\n第一段。\n' }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  const inbox = () => (existsSync(join(vault, '收件箱')) ? readdirSync(join(vault, '收件箱')).filter((f) => f.endsWith('.md')) : [])
  try {
    await openNote(page, '学习笔记')
    await openAi(page)
    const box = chat(page).getByRole('textbox', { name: '问 AI' })
    for (const q of ['你好', '把这周总结成三句话']) {
      await box.fill(q)
      await box.press('Enter')
      await expect(chat(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 30_000 })
    }
    const first = chat(page).getByTestId('ai-msg').nth(0)
    const second = chat(page).getByTestId('ai-msg').nth(1)
    await expect(second).not.toHaveAttribute('aria-busy')
    const row = second.getByTestId('ai-ans-acts')
    const more = row.getByRole('button', { name: '这条回答还能做什么' })
    // 排在「插进文档」后面（「引用再问」task-bppvn 拿掉了），24 方
    await expect(row.getByRole('button')).toHaveText(['拷贝', '插进文档', ''])
    const mb = (await more.boundingBox())!
    expect([Math.round(mb.width), Math.round(mb.height)]).toEqual([24, 24])
    const qb = (await row.getByRole('button', { name: '插进文档' }).boundingBox())!
    expect(Math.round(mb.x - (qb.x + qb.width))).toBe(6)
    await more.hover()
    await expect(page.getByTestId('tooltip')).toHaveText('更多')

    // 之前那条：⋯ 打开后鼠标挪进菜单（离开那条回答），这排照样露着
    const orow = first.getByTestId('ai-ans-acts')
    await first.locator('.txt').hover()
    await orow.getByRole('button', { name: '这条回答还能做什么' }).click()
    const menu = page.getByRole('dialog', { name: '这条回答还能做什么' })
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('menuitem')).toHaveText(['存进收件箱'])
    await menu.getByRole('menuitem').hover()
    await expect(orow).toHaveCSS('opacity', '1')
    await expect(orow.getByRole('button', { name: '这条回答还能做什么' })).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    expect(inbox()).toEqual([])

    // 最新那条：⋯ → 存进收件箱
    await more.click()
    await expect(menu).toBeVisible()
    // 菜单在 ⋯ 下面 4，右边和 ⋯ 的右边对齐（往回答那边伸，不出右栏）
    const pb = (await menu.boundingBox())!
    const mb2 = (await more.boundingBox())!
    expect(Math.round(pb.x + pb.width)).toBe(Math.round(mb2.x + mb2.width))
    expect(Math.round(pb.y - (mb2.y + mb2.height))).toBe(4)
    const side = (await chat(page).boundingBox())!
    expect(pb.x).toBeGreaterThanOrEqual(side.x)
    await page.screenshot({ path: 'test-results/r00en-ans-more.png' })
    await menu.getByRole('menuitem', { name: '存进收件箱' }).click()
    await expect(menu).toHaveCount(0)
    await expect(page.getByTestId('toast')).toContainText('存进了收件箱')
    await expect.poll(inbox).toHaveLength(1)
    const saved = readFileSync(join(vault, '收件箱', inbox()[0]!), 'utf8')
    expect(saved).toContain('这周主要在赶第5讲的作业')
    expect(saved).toContain('下周要把论文计划的第一节写完')
  } finally {
    await run.close()
  }
})
