/**
 * 文档里选好几块（task-5ryf9，17-白板框选 方向 A 的文档部分，块结构照 task-ys1rr）：真拖、真点、真按键，读盘看只改了该改的。
 * - 从左边空白往下拖：经过的块整块选上，浮出「已选N块 · 转成 · 移到 · 问AI · AI整理 · 出卡 ｜ 复制 · 删除 · ⋯」；从字上拖还是选字；
 * - 转成小标题、⌘Z 撤回；⇧ 点把手连选、⌫ 删掉、⌘Z 回来；在字里按 Esc 选中这一块；几块一起拖；
 * - AI整理（假 AI）：先在中间给你看，收下才写，一次提交；只选、Esc：文件一个字节不变。
 */
import { expect, type Page, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { editorText, launch, openNote, pane, type Running, waitSaved } from './app'
import { DOC, DOC_PATH, FILES } from './fixtures/board-select'

const bar = (page: Page) => page.getByTestId('doc-selbar')
const file = (run: Running) => readFileSync(join(run.vault, DOC_PATH), 'utf8')
const sel = (page: Page) => pane(page).locator('.cm-blkSelLayer .cm-blk-sel')
const line = (page: Page, text: string) => pane(page).locator('.cm-line', { hasText: text }).first()

async function start(env: Record<string, string> = {}) {
  const run = await launch(FILES, env)
  await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
  await openNote(run.page, '2.3 线性代数')
  await expect(line(run.page, '按常数缩放')).toBeVisible()
  return run
}

/** 从「矩阵-矩阵乘法 AB」左边空白按住，往下拖到「按常数缩放」：六块 */
async function frameSix(page: Page) {
  const a = (await line(page, '矩阵-矩阵乘法 AB').boundingBox())!
  const z = (await line(page, '按常数缩放').boundingBox())!
  await page.mouse.move(a.x - 30, a.y + 6)
  await page.mouse.down()
  await page.mouse.move(a.x - 28, a.y + 40, { steps: 4 })
  await page.mouse.move(a.x - 26, z.y + 10, { steps: 10 })
  await expect(page.getByTestId('doc-marquee')).toBeVisible()
  await page.mouse.up()
  await expect(page.getByTestId('doc-marquee')).toHaveCount(0)
  await expect(sel(page)).toHaveCount(6)
}

test('从左边空白往下拖选上六块，浮出文档那一条（照原型的字和先后）；从字上拖还是选字；Esc 取消；只选不写文件', async () => {
  const run = await start()
  const { page } = run
  try {
    await frameSix(page)
    await expect(bar(page)).toBeVisible()
    await expect(bar(page).locator('.cnt')).toHaveText('已选6块')
    const names = await bar(page).locator('button.sb').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
    expect(names).toEqual(['转成', '移到', '问AI', 'AI整理', '出卡', '复制', '删除', '更多'])
    // 浮在第一块上方 10
    const bb = (await bar(page).boundingBox())!
    const first = (await sel(page).first().boundingBox())!
    expect(Math.abs(bb.y + bb.height + 10 - first.y)).toBeLessThan(2)
    // Esc 取消
    await page.keyboard.press('Escape')
    await expect(sel(page)).toHaveCount(0)
    await expect(bar(page)).toHaveCount(0)
    // 从字上拖是选字：一块都不选
    const p = (await line(page, '我的疑问').boundingBox())!
    await page.mouse.move(p.x + 20, p.y + 10)
    await page.mouse.down()
    await page.mouse.move(p.x + 140, p.y + 12, { steps: 6 })
    await page.mouse.up()
    await expect(sel(page)).toHaveCount(0)
    const picked = await pane(page).locator('.cm-editor').evaluate((el) => (el as HTMLElement & { cnSel: { anchor: number; head: number } }).cnSel)
    expect(picked.head).not.toBe(picked.anchor)
    // 在一段字里按 Esc：选中这一块；再按 Esc 取消
    await page.mouse.click(p.x + 30, p.y + 10)
    await page.keyboard.press('Escape')
    await expect(sel(page)).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(sel(page)).toHaveCount(0)
    await waitSaved(page)
    expect(file(run)).toBe(DOC)
  } finally {
    await run.close()
  }
})

test('转成小标题（每块开头加「### 」、字不变）、⌘Z 撤回；⇧ 点把手连选五块、⌫ 删掉、⌘Z 回来；选着几块按住把手一起拖到标题前面', async () => {
  const run = await start()
  const { page } = run
  try {
    await frameSix(page)
    await bar(page).getByRole('button', { name: '转成' }).click()
    const menu = page.getByRole('menu', { name: '转成' })
    await expect(menu.getByRole('menuitem')).toHaveText(['正文', '标题', '小标题', '列表', '编号列表', '待办', '引用', '提示块'])
    await menu.getByRole('menuitem', { name: '小标题' }).click()
    await waitSaved(page)
    expect(file(run)).toContain('### 矩阵-矩阵乘法 AB 可以看作 m 次矩阵-向量积，再把结果拼在一起。\n\n### 矩阵-矩阵乘法可以简单地称为矩阵乘法')
    expect(file(run)).toContain('### 范数非负\n\n### 三角不等式\n\n### 按常数缩放')
    await pane(page).locator('.cm-content').focus()
    await page.keyboard.press('Meta+z')
    await expect.poll(() => editorText(page)).toBe(DOC)
    await waitSaved(page)
    expect(file(run)).toBe(DOC)

    // ⇧ 点把手连选：点「范数：」的把手（出块菜单，Esc 收起），再 ⇧ 点「我的疑问」的把手：中间五块连着选上
    const grip = async (text: string) => {
      const l = (await line(page, text).boundingBox())!
      await page.mouse.move(l.x + 20, l.y + 8)
      const g = pane(page).locator('.blk-grip')
      await expect(g).toBeVisible()
      return (await g.boundingBox())!
    }
    const g1 = await grip('范数：向量有多大')
    await page.mouse.click(g1.x + 8, g1.y + 8)
    await expect(page.getByRole('menu', { name: '块菜单' })).toBeVisible()
    await page.keyboard.press('Escape')
    const g2 = await grip('我的疑问')
    await page.keyboard.down('Shift')
    await page.mouse.click(g2.x + 8, g2.y + 8)
    await page.keyboard.up('Shift')
    await expect(sel(page)).toHaveCount(5)
    await expect(bar(page).locator('.cnt')).toHaveText('已选5块')
    await page.keyboard.press('Backspace')
    await waitSaved(page)
    expect(file(run)).not.toContain('范数：向量有多大')
    expect(file(run)).not.toContain('我的疑问')
    expect(file(run)).toContain('> 矩阵-矩阵乘法可以简单地称为矩阵乘法，不应与“Hadamard积”混淆。\n\n### 2.3.11 Frobenius 范数')
    await page.keyboard.press('Meta+z')
    await expect.poll(() => editorText(page)).toBe(DOC)

    // 选着三条列表，按住其中一条的把手拖到「教材」前面：三条一起挪过去，拖影写「3块」
    const g3 = await grip('范数非负')
    await page.mouse.click(g3.x + 8, g3.y + 8)
    await page.keyboard.press('Escape')
    const g4 = await grip('按常数缩放')
    await page.keyboard.down('Shift')
    await page.mouse.click(g4.x + 8, g4.y + 8)
    await page.keyboard.up('Shift')
    await expect(sel(page)).toHaveCount(3)
    const g5 = await grip('三角不等式')
    const to = (await line(page, '教材').boundingBox())!
    await page.mouse.move(g5.x + 8, g5.y + 8)
    await page.mouse.down()
    await page.mouse.move(g5.x + 20, g5.y - 20, { steps: 4 })
    await page.mouse.move(to.x + 40, to.y + 2, { steps: 14 })
    await expect(page.getByTestId('blk-ghost')).toHaveText('3块')
    await page.mouse.up()
    await waitSaved(page)
    expect(file(run).startsWith('# 2.3 线性代数\n\n- 范数非负\n- 三角不等式\n- 按常数缩放\n\n教材：')).toBe(true)
  } finally {
    await run.close()
  }
})

test('AI整理这几段（假 AI）：先在中间给你看改前改后，收下才写（一次提交，小标题比上面的标题低一级），撤回回到原样', async () => {
  const run = await start({ CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await frameSix(page)
    const n0 = Number(execFileSync('git', ['-C', vault, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim())
    // 问AI：右栏打开，「看得到」写「这篇里选中的6块」
    await bar(page).getByRole('button', { name: '问AI' }).click()
    const ai = page.getByRole('complementary', { name: 'AI 对话' })
    await expect(ai.getByTestId('ai-cards')).toHaveText('这篇里选中的6块')
    await expect(ai.getByRole('button', { name: '讲一讲这几块' })).toBeVisible()
    await bar(page).getByRole('button', { name: 'AI整理' }).click()
    const msg = ai.getByTestId('ai-msg').last()
    await expect(msg).toContainText('理成了2节（矩阵乘法、其他）。', { timeout: 20_000 })
    expect(file(run)).toBe(DOC)
    await msg.getByRole('button', { name: '收下', exact: true }).click()
    await expect.poll(() => file(run)).toContain('### 矩阵乘法')
    const after = file(run)
    expect(after).toContain('## 2.3 线性代数\n\n### 矩阵乘法\n\n矩阵-矩阵乘法 AB 可以看作 m 次矩阵-向量积，再把结果拼在一起。\n\n> 矩阵-矩阵乘法可以简单地称为矩阵乘法，不应与“Hadamard积”混淆。\n\n### 其他\n\n范数：向量有多大。')
    // 文件先写好、提交跟着来：等提交
    await expect.poll(() => Number(execFileSync('git', ['-C', vault, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim())).toBe(n0 + 1)
    await ai.getByTestId('ai-msg').last().getByRole('button', { name: '撤回' }).click()
    await expect.poll(() => file(run)).toBe(DOC)
  } finally {
    await run.close()
  }
})

test('移到别的笔记：选六块点「移到」，挑「第 3 章」回车，六块接到那篇末尾、这篇少了这六块，两篇一次提交（编辑器从 note-doc-ref 拿，不再动态 import，task-xfngz）', async () => {
  const run = await start()
  const { page } = run
  const OTHER = '课程/第 3 章 线性神经网络.md'
  const commits = () => Number(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: run.vault, encoding: 'utf8' }).trim())
  try {
    await frameSix(page)
    const before = commits()
    await bar(page).getByRole('button', { name: '移到' }).click()
    const pick = page.getByTestId('sel-notepick')
    await expect(pick).toBeVisible()
    await pick.getByRole('textbox', { name: '筛选笔记' }).fill('第 3 章')
    await page.keyboard.press('Enter')
    await expect.poll(() => readFileSync(join(run.vault, OTHER), 'utf8')).toContain('按常数缩放')
    const other = readFileSync(join(run.vault, OTHER), 'utf8')
    expect(other.startsWith('# 第 3 章 线性神经网络\n\n线性回归是最简单的神经网络。\n\n')).toBe(true)
    expect(other).toContain('矩阵-矩阵乘法 AB')
    await waitSaved(page)
    await expect.poll(() => file(run)).not.toContain('按常数缩放')
    expect(file(run)).not.toContain('矩阵-矩阵乘法 AB')
    await expect.poll(commits).toBe(before + 1)
    await expect(page.getByTestId('toast')).toContainText('挪了6块到《第 3 章 线性神经网络》末尾')
  } finally {
    await run.close()
  }
})
