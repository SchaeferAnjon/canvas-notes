/**
 * 机器慢、盘慢时关标签、退出：关之前按标题改名、存字一定做完（全量 e2e 里「写了标题直接 ⌘W」连着两次没改成名）。
 * 慢盘用 slowDisk 在主进程里给读写 md 加等待，竞态每次都撞得上，不靠碰运气。
 */
import { expect, test } from '@playwright/test'
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { acts, gitStatus, launch, openNote, pane, slowDisk, type Running } from './app'
import { armMenus, pickMenu } from './menu'

const inbox = (run: Running) => readdirSync(join(run.vault, '收件箱')).sort()
const read = (run: Running, rel: string) => readFileSync(join(run.vault, rel), 'utf8')

/** 左栏「新建笔记」，打标题，停到自动保存那次写已经发出去（盘慢，它还在路上） */
async function freshWithTitle(run: Running, title: string) {
  const { page } = run
  await page.locator('aside.side .vh').getByRole('button', { name: '新建笔记' }).click()
  await expect(page.getByTestId('tab-on')).toHaveText(/^未命名/)
  await page.keyboard.type(title)
  await expect(acts(page).getByTestId('save-state')).toHaveAttribute('data-state', 'saving')
}

test('盘慢、自动保存正写着时 ⌘W 关新建的笔记：文件按标题改了名、里面是标题，旧名字没被写回来', async () => {
  const run = await launch({ '项目/说明.md': '# 说明\n' })
  try {
    await slowDisk(run, { write: 600 })
    await freshWithTitle(run, '慢盘上的标题')
    await run.page.keyboard.press('Meta+w')
    await expect.poll(() => inbox(run), { timeout: 10_000 }).toEqual(['慢盘上的标题.md'])
    expect(read(run, '收件箱/慢盘上的标题.md')).toBe('# 慢盘上的标题\n\n')
    // 再等一会儿：没有晚到的写把「未命名」建回来
    await run.page.waitForTimeout(1500)
    expect(inbox(run)).toEqual(['慢盘上的标题.md'])
  } finally {
    await run.close()
  }
})

for (const how of ['关闭右侧', '关闭其他'] as const) {
  test(`盘慢、自动保存正写着时右键别的标签「${how}」关掉新建的笔记：一样先按标题改名、字都在`, async () => {
    const run = await launch({ '说明.md': '# 说明\n\n一段。\n' })
    const { page } = run
    try {
      await armMenus(run)
      await openNote(page, '说明')
      await slowDisk(run, { write: 600 })
      await freshWithTitle(run, `${how}前的标题`)
      // 右键「说明」那个标签（不切过去：新建的那篇光标还在标题里）
      await page.getByTestId('tab-list').getByRole('tab', { name: /说明/ }).click({ button: 'right' })
      await pickMenu(run, how)
      await expect(page.getByTestId('tab-list').getByRole('tab', { name: /未命名|前的标题/ })).toHaveCount(0)
      await expect.poll(() => inbox(run), { timeout: 10_000 }).toEqual([`${how}前的标题.md`])
      expect(read(run, `收件箱/${how}前的标题.md`)).toBe(`# ${how}前的标题\n\n`)
      await page.waitForTimeout(1500)
      expect(inbox(run)).toEqual([`${how}前的标题.md`])
    } finally {
      await run.close()
    }
  })
}

test('盘慢、自动保存正写着时又打了几个字就 ⌘Q：后打的字也存进文件、提交进 Git 再退', async () => {
  const run = await launch({ '日记.md': '# 日记\n\n今天去了海边。\n' })
  const { page, vault } = run
  try {
    await openNote(page, '日记')
    await slowDisk(run, { write: 600 })
    await pane(page).locator('.cm-line', { hasText: '今天去了海边。' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type('先打的')
    await expect(acts(page).getByTestId('save-state')).toHaveAttribute('data-state', 'saving')
    // 那次写还在路上：接着打，马上退出
    await page.keyboard.type('后打的')
    await run.close({ keep: true })
    expect(readFileSync(join(vault, '日记.md'), 'utf8')).toBe('# 日记\n\n今天去了海边。先打的后打的\n')
    expect(gitStatus(vault)).toBe('')
  } finally {
    rmSync(dirname(vault), { recursive: true, force: true, maxRetries: 5 })
  }
})

test('新建笔记写了标题不按回车直接 ⌘Q：和关标签一样先按标题改名再退，下次打开标题和文件名对得上', async () => {
  const run = await launch({ '说明.md': '# 说明\n' })
  const { vault } = run
  try {
    await slowDisk(run, { write: 600 })
    await freshWithTitle(run, '退出前的标题')
    await run.close({ keep: true })
    expect(readdirSync(join(vault, '收件箱'))).toEqual(['退出前的标题.md'])
    expect(readFileSync(join(vault, '收件箱/退出前的标题.md'), 'utf8')).toBe('# 退出前的标题\n\n')
    expect(gitStatus(vault)).toBe('')
  } finally {
    rmSync(dirname(vault), { recursive: true, force: true, maxRetries: 5 })
  }
})

test('盘慢、读文件慢时新建笔记：标签一出来马上打字，头几个字不丢（编辑器和标签一起出来）', async () => {
  const run = await launch({ '说明.md': '# 说明\n' })
  const { page } = run
  try {
    await slowDisk(run, { read: 600 })
    await page.locator('aside.side .vh').getByRole('button', { name: '新建笔记' }).click()
    await expect(page.getByTestId('tab-on')).toHaveText('未命名')
    await page.keyboard.type('头几个字')
    await expect(pane(page).locator('.cm-line').first()).toHaveText('头几个字')
    await page.keyboard.press('Meta+w')
    await expect.poll(() => inbox(run), { timeout: 10_000 }).toEqual(['头几个字.md'])
    expect(read(run, '收件箱/头几个字.md')).toBe('# 头几个字\n\n')
  } finally {
    await run.close()
  }
})

test('真白板上正在改一张卡（框开着）按 ⌘W：框里的字先存进文件，标签关掉（框不再把 ⌘W 拦下）', async () => {
  const BOARD = '---\ntype: board\n---\n<!-- card id=c1 x=80 y=80 w=280 -->\n冰岛\n'
  const run = await launch({ '写作计划.md': BOARD })
  const { page, vault } = run
  try {
    await openNote(page, '写作计划')
    await acts(page).getByRole('tab', { name: '白板' }).click()
    await pane(page).getByTestId('board').locator('.bcard', { hasText: '冰岛' }).dblclick()
    await expect(pane(page).getByTestId('board').getByRole('textbox', { name: '卡片内容' })).toBeFocused()
    await page.keyboard.press('End')
    await page.keyboard.type('自驾')
    await page.keyboard.press('Meta+w')
    await expect(page.getByRole('tab', { name: /写作计划/ })).toHaveCount(0)
    await expect.poll(() => readFileSync(join(vault, '写作计划.md'), 'utf8')).toContain('<!-- card id=c1 x=80 y=80 w=280 -->\n冰岛自驾\n')
  } finally {
    await run.close()
  }
})

test('文档白板「改字」弹层开着、外面改了同一段时按 ⌘W：主文件留我的、外面那版存冲突副本，标签关了提示照样出在底部', async () => {
  const NOTE = '# 冲突弹层\n\n## 一\n\n卡一。\n\n## 二\n\n卡二。\n'
  const run = await launch({ '冲突弹层.md': NOTE, '留着.md': '# 留着\n' })
  const { page, vault } = run
  const path = join(vault, '冲突弹层.md')
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await openNote(page, '冲突弹层')
    await acts(page).getByRole('tab', { name: '白板' }).click()
    const board = pane(page).getByTestId('doc-board')
    await board.locator('.db-card', { hasText: '卡二' }).dblclick()
    const dlg = page.getByRole('dialog', { name: '全文' })
    await dlg.getByRole('button', { name: '改字' }).click()
    await dlg.getByRole('textbox', { name: '这张卡的原文' }).press('End')
    await page.keyboard.type('我加的')
    const theirs = NOTE.replace('卡二。', '卡二外面改了。')
    writeFileSync(path, theirs)
    await expect(board.locator('.db-card', { hasText: '卡二外面改了' })).toBeVisible()
    await page.keyboard.press('Meta+w')
    await expect(page.getByRole('tab', { name: /冲突弹层/ })).toHaveCount(0)
    const copies = () => readdirSync(vault).filter((f) => f.startsWith('冲突弹层（冲突 '))
    await expect.poll(copies).toHaveLength(1)
    expect(readFileSync(join(vault, copies()[0]!), 'utf8')).toBe(theirs)
    await expect.poll(() => readFileSync(path, 'utf8')).toBe(NOTE.replace('卡二。', '卡二。我加的'))
    await expect(page.getByTestId('toast')).toContainText(`外面改了《冲突弹层》的同一段：留了你的版本，外面那版存成《${copies()[0]!.replace(/\.md$/, '')}》`)
  } finally {
    await run.close()
  }
})
