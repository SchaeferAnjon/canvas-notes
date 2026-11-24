// AI 命令（task-9womr）和旁支（task-4edsc）一起用：两边 DESIGN 写的样子合起来（DESIGN.v3 2.8.1 最后一条、DESIGN.md「旁支」）。
// 旁支开着时主输入框缩成一行，/ 菜单不出；旁支自己的输入框里打 / 就是字（问「1/2」这种照样问），不弹命令菜单；
// 「存成命令」那一行照旧在对话最后，点了开那张表，esc 只收那张表、旁支还开着；点缩着的那一行回到主对话，旁支收起，打 / 菜单照常出、能跑。
import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, openAi, openNote } from './app'

const DOC = '课程/学习笔记.md'
const BEFORE = '# 学习笔记\n\n张量就是多维数组。\n\n广播：形状不同时自动扩展。\n'
const AFTER = '# 学习笔记\n\n## 2.1 数据操作\n\n张量就是多维数组。\n\n## 2.2 广播\n\n广播：形状不同时自动扩展。\n'

const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const askbox = (page: Page) => page.getByRole('toolbar', { name: '选中的这句' })
const side = (page: Page) => chat(page).getByRole('region', { name: '旁支' })
const slashMenu = (page: Page) => page.getByTestId('slash-menu')

/** 在 scope 里用鼠标从 from 拖到 to（真拖） */
async function selectText(page: Page, scope: Locator, from: string, to: string) {
  const pts = await scope.evaluate(
    (root, [a, b]) => {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      while (w.nextNode()) {
        const n = w.currentNode as Text
        const i = n.data.indexOf(a!)
        const j = n.data.indexOf(b!, i)
        if (i < 0 || j < 0) continue
        const r = document.createRange()
        r.setStart(n, i)
        r.setEnd(n, j + b!.length)
        const rs = r.getClientRects()
        const f = rs[0]!
        const l = rs[rs.length - 1]!
        return [f.left + 1, f.top + f.height / 2, l.right - 1, l.top + l.height / 2]
      }
      throw new Error('没找到那一句')
    },
    [from, to],
  )
  await page.mouse.move(pts[0]!, pts[1]!)
  await page.mouse.down()
  await page.mouse.move(pts[2]!, pts[3]!, { steps: 8 })
  await page.mouse.up()
}

test('旁支开着：主输入框缩成一行不出 / 菜单，旁支的输入框里 / 就是字；「存成命令」照旧能点、esc 只收那张表；点那一行回到主对话，/ 菜单照常', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cn-side-cmd-'))
  writeFileSync(join(dir, 'after.md'), AFTER)
  writeFileSync(join(dir, 'rounds.json'), JSON.stringify([{ say: '按小节整理一下', path: DOC, file: join(dir, 'after.md'), reply: '按书的小节加了两个小标题，正文没动。' }]))
  const run = await launch({ [DOC]: BEFORE }, { CN_AI_FAKE: '1', CN_FAKE_ROUNDS: join(dir, 'rounds.json') })
  const { page } = run
  try {
    await openNote(page, '学习笔记')
    await openAi(page)
    const ta = chat(page).getByRole('textbox', { name: '问 AI' })
    await ta.fill('按小节整理一下')
    await ta.press('Enter')
    const msg = chat(page).getByTestId('ai-msg').last()
    await expect(msg.getByTestId('ai-change')).toBeVisible({ timeout: 15_000 })
    await expect(chat(page).getByTestId('cmd-saverow')).toBeVisible()

    // 回答里选一句开旁支：主输入框缩成一行
    await selectText(page, msg.locator('.txt'), '按书的', '正文没动。')
    await expect(askbox(page)).toBeVisible()
    await askbox(page).getByRole('button', { name: '问这句' }).click()
    // 「问这句」直接开旁支，光标在旁支的输入框里，问题在那里打（r129 小条上不再常驻问题那一格）
    await page.keyboard.insertText('为什么这样分？')
    await page.keyboard.press('Enter')
    await expect(side(page)).toBeVisible()
    await expect(chat(page).getByTestId('ai-input-slim')).toBeVisible()
    await expect(side(page).getByTestId('side-msg').last()).toContainText('旁支', { timeout: 15_000 })

    // 旁支自己的输入框：/ 是字，不弹命令菜单
    const sideBox = side(page).getByRole('textbox')
    await sideBox.click()
    await page.keyboard.type('/2 是什么意思')
    await expect(sideBox).toHaveValue('/2 是什么意思')
    await expect(slashMenu(page)).toHaveCount(0)
    await sideBox.fill('')

    // 「存成命令」那一行照旧在对话最后：开那张表，esc 只收那张表，旁支还开着
    await chat(page).getByTestId('cmd-saverow').getByRole('button', { name: '存成命令' }).click()
    const dlg = page.getByRole('dialog', { name: '存成命令' })
    await expect(dlg).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dlg).toHaveCount(0)
    await expect(side(page)).toBeVisible()
    await expect(chat(page).getByTestId('ai-input-slim')).toBeVisible()

    // 点缩着的那一行：旁支收起，光标回主对话，打 / 菜单照常出、能挑
    await chat(page).getByTestId('ai-input-slim').click()
    await expect(side(page)).toHaveCount(0)
    await expect(ta).toBeFocused()
    await page.keyboard.type('/')
    await expect(slashMenu(page)).toBeVisible()
    await expect(slashMenu(page).locator('.it .n').first()).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(slashMenu(page)).toHaveCount(0)
  } finally {
    await run.close()
  }
})
