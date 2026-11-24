// task-3e53q 设计页「二、a」后半：AI 回答里没写成链接的也认。用户 2026-11-23 定（已定 4）：按名字认照防认错规则做，设置里能关。
// 假 AI 先读一遍《小论文计划》（步骤里记下读过它），回答里光写「小论文计划」、写反引号路径、写「路径:行号」、书名号包着一篇没读过的。
// 真点：认成链接 → 点开卡上有「软件按名字认的」→「不是这篇」后不再认 → ⌘Z 回来 → 设置里关掉后不认（路径照认）。一律无头、假 AI、临时库。
import { expect, type Locator, test, type Page } from '@playwright/test'
import { launch, openAi, openNote, tabOn } from './app'

// 旁支那条要等假 AI 答两回：机器忙时一分钟不够
test.setTimeout(2 * 60_000)

const PLAN = '课程/小论文计划.md'
const PLAN_MD = ['# 小论文计划', ...Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 条：先放着。`), 'SAGE 排第 2 篇，编号 J52。', '作者和 C72 重叠（Chenpei Xie）。', ''].join('\n')
const files = { [PLAN]: PLAN_MD, '课程/线代/第3讲 笔记.md': '# 第3讲 笔记\n\n## 定义\n线性：加起来再变和变了再加一样。\n', '收件箱/随手.md': '# 随手\n\n问问 AI。\n' }

const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const card = (page: Page) => page.getByRole('dialog', { name: '引用' })
const dialog = (page: Page) => page.getByRole('dialog', { name: '设置' })

async function ask(page: Page) {
  await openNote(page, '随手')
  await openAi(page)
  const ta = chat(page).getByRole('textbox', { name: '问 AI' })
  await ta.fill('按名字认')
  await ta.press('Enter')
  const msg = chat(page).getByTestId('ai-msg').last()
  await expect(msg).toContainText('别的几篇先放着', { timeout: 15_000 })
  // 答完（「停下」没了）
  await expect(chat(page).getByRole('button', { name: '停下' })).toHaveCount(0, { timeout: 15_000 })
  return msg
}

test('按名字认：读过的「小论文计划」认成链接、卡上写是软件认的；「不是这篇」后这段对话里不再认，⌘Z 回来；反引号路径、路径:行号、书名号包着的也认', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    const msg = await ask(page)
    // 光写名字的那一处：认成链接，和 AI 写的一个样子（a.cite），带着为什么认；同一个名字第二次不认
    const named = msg.locator('a.cite[data-auto]', { hasText: /^小论文计划$/ })
    await expect(named).toHaveCount(1)
    await expect(named).toHaveAttribute('data-auto', 'touched')
    await expect(msg.locator('.md-p, li').filter({ hasText: '别的几篇先放着' }).locator('a.cite')).toHaveCount(0)
    // 反引号路径（样子还是代码）、「路径:42-43」按路径认，卡上没有「软件按名字认的」
    await expect(msg.locator('a.cite > code', { hasText: '课程/小论文计划.md' })).toHaveCount(1)
    const colon = msg.locator('a.cite', { hasText: '课程/小论文计划.md:42-43' })
    await expect(colon).toHaveCount(1)
    await colon.click()
    await expect(card(page).locator('.u')).toHaveText('课程 · 第42–43行')
    await expect(card(page).getByTestId('cite-auto')).toHaveCount(0)
    await page.keyboard.press('Escape')
    // 书名号包着、这一轮没读过的：也认（为什么写的是书名号）
    const quoted = msg.locator('a.cite[data-auto="quoted"]', { hasText: '第3讲 笔记' })
    await expect(quoted).toHaveCount(1)

    // 点一下：预览卡和 AI 写的链接一样，多一行小字「软件按名字认的」，按钮多一个「不是这篇」
    await named.click()
    await expect(card(page).locator('.top b')).toHaveText('小论文计划')
    await expect(card(page).getByTestId('cite-auto')).toHaveText('软件按名字认的：AI读过这篇')
    await expect(card(page).locator('.why button')).toHaveText('不是这篇')
    await expect(card(page).locator('.acts button')).toHaveText(['打开 ⌘点', '新标签打开 ⇧⌘点', '拷贝'])
    // ⌘点照样打开
    await page.keyboard.press('Escape')
    await named.click({ modifiers: ['Meta'] })
    await expect(tabOn(page)).toHaveText('小论文计划')
    await page.getByTestId('tab-list').locator(':scope > .tab').filter({ hasText: '随手' }).click()

    // 「不是这篇」：卡收起，回答里那个名字不再是链接，底栏能撤回
    await msg.locator('a.cite[data-auto]', { hasText: /^小论文计划$/ }).click()
    await card(page).getByRole('button', { name: '不是这篇' }).click()
    await expect(card(page)).toHaveCount(0)
    await expect(msg.locator('a.cite[data-auto]', { hasText: /^小论文计划$/ })).toHaveCount(0)
    await expect(msg).toContainText('SAGE 在小论文计划里排第 2 篇')
    await expect(page.getByTestId('toast')).toContainText('「小论文计划」在这段对话里不再认成链接')
    // 路径照认（「不是这篇」只管按名字认的）
    await expect(msg.locator('a.cite > code', { hasText: '课程/小论文计划.md' })).toHaveCount(1)
    // ⌘Z：回来
    await page.keyboard.press('Meta+z')
    await expect(msg.locator('a.cite[data-auto]', { hasText: /^小论文计划$/ })).toHaveCount(1)
  } finally {
    await run.close()
  }
})

test('设置 › AI「回答里提到的笔记名自动认成链接」关掉：光写名字的不再认，路径照认；不认的名单里加了的名字也不认', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    const msg = await ask(page)
    await expect(msg.locator('a.cite[data-auto]')).toHaveCount(2)

    // 不认的名单里加「第3讲 笔记」：书名号包着的那处不再认
    await page.keyboard.press('Meta+,')
    await page.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: 'AI', exact: true }).click()
    const group = dialog(page).getByRole('group', { name: '回答里的链接' })
    await expect(group).toBeVisible()
    const skip = group.getByRole('textbox', { name: '这些名字不认' })
    await skip.fill('第3讲 笔记')
    await skip.blur()
    await expect(msg.locator('a.cite[data-auto]', { hasText: '第3讲 笔记' })).toHaveCount(0)
    await expect(msg.locator('a.cite[data-auto]', { hasText: '小论文计划' })).toHaveCount(1)

    // 关掉开关：光写名字的都不认，反引号路径、路径:行号照认
    const sw = group.getByRole('switch', { name: '回答里提到的笔记名自动认成链接' })
    await expect(sw).toHaveAttribute('aria-checked', 'true')
    await sw.click()
    await expect(sw).toHaveAttribute('aria-checked', 'false')
    await expect(msg.locator('a.cite[data-auto]')).toHaveCount(0)
    await expect(msg.locator('a.cite > code', { hasText: '课程/小论文计划.md' })).toHaveCount(1)
    await expect(msg.locator('a.cite', { hasText: '课程/小论文计划.md:42-43' })).toHaveCount(1)
    // 再开：回来
    await sw.click()
    await expect(msg.locator('a.cite[data-auto]', { hasText: '小论文计划' })).toHaveCount(1)
  } finally {
    await run.close()
  }
})

/** 在 scope 里用鼠标从 from 拖到 to（真拖，选区是浏览器自己算的；同 side-inline.spec.ts） */
async function selectText(page: Page, scope: Locator, from: string, to: string) {
  const pts = await scope.evaluate(
    (root, [a, b]) => {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let s: [Node, number] | null = null
      let e: [Node, number] | null = null
      while (w.nextNode()) {
        const n = w.currentNode as Text
        if (!s && n.data.includes(a!)) s = [n, n.data.indexOf(a!)]
        if (s && n.data.includes(b!, s[0] === n ? s[1] : 0)) {
          e = [n, n.data.indexOf(b!, s[0] === n ? s[1] : 0) + b!.length]
          break
        }
      }
      const r = document.createRange()
      r.setStart(s![0], s![1])
      r.setEnd(e![0], e![1])
      ;(s![0] as Text).parentElement!.scrollIntoView({ block: 'center' })
      const rs = r.getClientRects()
      const f = rs[0]!
      const l = rs[rs.length - 1]!
      return [f.left + 1, f.top + f.height / 2, l.right - 1, l.top + l.height / 2]
    },
    [from, to],
  )
  await page.mouse.move(pts[0]!, pts[1]!)
  await page.mouse.down()
  await page.mouse.move(pts[2]!, pts[3]!, { steps: 8 })
  await page.mouse.up()
}

test('回答上划了旁支小标时点「不是这篇」、⌘Z：小标还在，链接跟着变，不出错', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page } = run
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  try {
    const msg = await ask(page)
    const txt = msg.locator('.txt')
    // 选「线性的定义另见」开一条旁支，收起后那句划着虚线、后面一个小标
    await selectText(page, txt, '线性的定义', '另见')
    const box = page.getByRole('toolbar', { name: '选中的这句' })
    await expect(box).toBeVisible()
    await box.getByRole('button', { name: '问这句' }).click()
    // 「问这句」直接开旁支，光标在旁支的输入框里，问题在那里打（r129 小条上不再常驻问题那一格）
    await page.keyboard.insertText('这是哪一篇？')
    await page.keyboard.press('Enter')
    const side = chat(page).getByRole('region', { name: '旁支' })
    await expect(side.getByTestId('side-msg').last()).not.toContainText('在答…', { timeout: 15_000 })
    await page.keyboard.press('Escape')
    await expect(side).toHaveCount(0)
    await expect(txt.locator('.asked')).toHaveCount(1)

    await txt.locator('a.cite[data-auto]', { hasText: /^小论文计划$/ }).click()
    await card(page).getByRole('button', { name: '不是这篇' }).click()
    await expect(txt.locator('a.cite[data-auto]', { hasText: /^小论文计划$/ })).toHaveCount(0)
    await expect(txt.locator('.asked')).toHaveCount(1)
    await page.keyboard.press('Meta+z')
    await expect(txt.locator('a.cite[data-auto]', { hasText: /^小论文计划$/ })).toHaveCount(1)
    await expect(txt.locator('.asked')).toHaveCount(1)
    expect(errors).toEqual([])
  } finally {
    await run.close()
  }
})
