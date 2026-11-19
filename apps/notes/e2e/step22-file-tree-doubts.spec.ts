// 目录树里的「我的疑惑」（录屏 CN-56，方向 A）：软件汇总的排课程第一行、带「自动汇总」小标，和下面的笔记隔一条细线；
// 读 PDF 笔记行右端「疑惑 N」，点了打开「我的疑惑」跳到这一讲那段。
import { doubtsNote } from '@cn/format'
import { expect, test, type Page } from '@playwright/test'
import { launch, leftView, pane, tabOn } from './app'
import { LECTURE } from './fixtures/pdf'
import { shotPart, shotTone } from './shots'

const tree = (page: Page) => page.getByRole('tree', { name: '全部文件' })
const item = (page: Page, name: string) => tree(page).getByRole('treeitem').filter({ hasText: new RegExp(`^${name}`) })

const sec = (page: number, q: string) => ({ id: `s${page}`, page, title: '小标题', doubts: [q], good: '讲通的讲法', time: '20:50' }) as never
const DOUBTS = doubtsNote(
  '课程/ecp',
  'ecp',
  [
    { id: 'a', pdf: '课程/ecp/Lecture04.pdf', lecture: 4, section: sec(3, '为什么流水线要分级？') },
    ...[5, 6, 7, 8, 9, 10].map((p) => ({ id: `b${p}`, pdf: '课程/ecp/Lecture05.pdf', lecture: 5, section: sec(p, `第 ${p} 页没懂的地方`) })),
  ],
  new Set(),
)

/** 说明写得很长，「我的疑惑」里 Lecture05 那段在一屏以下，跳过去才看得见 */
const FILES: Record<string, string | Uint8Array> = {
  '课程/ecp/Lecture04.pdf': LECTURE,
  '课程/ecp/Lecture04 笔记.md': '# Lecture04 笔记\n',
  '课程/ecp/Lecture05.pdf': LECTURE,
  '课程/ecp/Lecture05 笔记.md': '# Lecture05 笔记\n',
  '课程/ecp/高维准正交.html': '<!doctype html><title>高维准正交</title><p>拖动维度</p>',
  '课程/ecp/我的疑惑.md': DOUBTS.replace('# 我的疑惑\n', '# 我的疑惑\n' + '\n这里是一段很长的说明。\n'.repeat(40)),
}

test('CN-56 目录树：「我的疑惑」排课程第一行、标「自动汇总」，下面一条细线；笔记行「疑惑 6」点了跳到汇总里 Lecture05 那段', async () => {
  const run = await launch(FILES)
  const { page } = run
  try {
    await shotTone(page)
    await leftView(page, '文件')
    await item(page, 'ecp').getByRole('button', { name: '展开 ecp' }).click()
    // 树的第一行是库本身（CN-106）：课程第 2 层、ecp 第 3 层，ecp 里面是第 4 层
    const rows = tree(page).getByRole('treeitem', { level: 4 })
    await expect(rows.first()).toHaveText(/^我的疑惑自动汇总$/)
    await expect(item(page, '我的疑惑').locator('.ft-auto')).toHaveText('自动汇总')
    // 汇总和下面的笔记之间一条细线
    await expect(tree(page).getByRole('separator')).toHaveCount(1)
    const sepY = (await tree(page).getByRole('separator').boundingBox())!.y
    expect(sepY).toBeGreaterThan((await item(page, '我的疑惑').boundingBox())!.y)
    expect(sepY).toBeLessThan((await rows.nth(1).boundingBox())!.y)
    // 笔记行右端：这一讲在汇总里有几条
    await expect(item(page, 'Lecture05 笔记').getByRole('button', { name: '疑惑6' })).toBeVisible()
    await expect(item(page, 'Lecture04 笔记').getByRole('button', { name: '疑惑1' })).toBeVisible()
    await expect(item(page, 'Lecture04').first().getByRole('button')).toHaveCount(0)
    await shotPart(page.locator('aside.side'), 'cn56-tree')

    // 点「疑惑 6」：打开「我的疑惑」，光标在「第 5 讲 · Lecture05」那段，滚得到
    await item(page, 'Lecture05 笔记').getByRole('button', { name: '疑惑6' }).click()
    await expect(tabOn(page)).toHaveText('我的疑惑')
    const heading = pane(page).locator('.cm-line', { hasText: '第 5 讲 · Lecture05' })
    await expect(heading).toBeInViewport()
    await expect(pane(page).locator('.cm-activeLine, .cm-line').filter({ hasText: '第 5 讲 · Lecture05' })).toHaveCount(1)
    const cursorLine = await pane(page).locator('.cm-content').evaluate(() => {
      const sel = window.getSelection()
      return sel?.anchorNode ? (sel.anchorNode.nodeType === 1 ? (sel.anchorNode as Element) : sel.anchorNode.parentElement)?.closest('.cm-line')?.textContent ?? '' : ''
    })
    expect(cursorLine).toContain('第 5 讲 · Lecture05')
  } finally {
    await run.close()
  }
})
