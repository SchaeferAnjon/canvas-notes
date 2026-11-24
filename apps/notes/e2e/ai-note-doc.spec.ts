// AI 对话记笔记开关（2026-11-24 方向 A「开关两颗」，design/ai-note-switch）在别处的 AI 对话（AiPanel）这一半：
// - 看文档：默认关，问了不写；拨开后答一条记一条，写进这篇本身（2026-11-24 偏好「剪藏和AI笔记同一篇」：插在光标处，自己的字不动），
//   一问一个 ### 小标题、一块带「回到 AI 对话」链接的 [!ai]，一次提交「笔记：<那篇> · <问的那句>」；
//   中途打开「前面 N 问没记 · 补进去 / 只记以后的」，撤回、⋯ 记进 / 拿掉，中途关「之后的不记了；已记的 N 问留在…」，
//   旁支开着时旁支答完也记（挂在被问那一问后面）；开关存在库里 .canvas-notes/ai-note.json，重开软件还记得，「已记进」照笔记认。
// - 没开东西（首页）：拨开先问记进哪篇，选「收件箱新建一篇」建「和 AI 聊：…」；新对话清掉选的那篇，「找一篇…」选库里一篇。
// 一律无头（CN_E2E=1）、假 AI（CN_AI_FAKE=1）。
import { _electron as electron, expect, test, type Locator, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import electronPath from 'electron'
import { launch, openAi, openNote, type Running } from './app'

const DOC = '读书/第6章读书笔记.md'
const files = { [DOC]: '# 第6章读书笔记\n\n汇聚层就是把图缩小，让后面算得快。\n', '周记.md': '# 周记\n\n这周读了 ECP。\n' }

const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const read = (run: Running, rel: string) => (existsSync(join(run.vault, rel)) ? readFileSync(join(run.vault, rel), 'utf8') : null)
const lastCommit = (run: Running) => execFileSync('git', ['-C', run.vault, 'log', '-1', '--format=%s'], { encoding: 'utf8' }).trim()
const answers = (page: Page) => chat(page).getByTestId('ai-msg')

async function ask(page: Page, q: string) {
  const n = await answers(page).count()
  const box = chat(page).getByRole('textbox', { name: '问 AI' })
  await box.fill(q)
  await box.press('Enter')
  await expect(answers(page)).toHaveCount(n + 1)
  await expect(answers(page).nth(n).locator('.txt')).toContainText('这是测试回答', { timeout: 15_000 })
  await expect(chat(page).getByRole('button', { name: '发送' })).toBeVisible()
  return answers(page).nth(n)
}

/** 回答下面 ⋯ 里点一项 */
async function more(page: Page, msg: Locator, item: RegExp) {
  await msg.hover()
  await msg.getByRole('button', { name: '这条回答还能做什么' }).click()
  await page.getByRole('menu', { name: '这条回答还能做什么' }).getByRole('menuitem', { name: item }).click()
}

/** 在 scope 里用鼠标从 from 拖到 to（真拖，选区是浏览器自己算的） */
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

/** 关掉再用同一个库、同一个设置目录开（看重开软件后还记得） */
async function reopen(run: Running): Promise<{ page: Page; close(): Promise<void> }> {
  await run.close({ keep: true })
  const root = dirname(run.vault)
  const app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [join(__dirname, '../out/main/index.js')],
    env: { ...process.env, CN_VAULT: run.vault, CN_USER_DATA: run.userData, CN_E2E: '1', CN_NO_AX: '1', CN_QUICK_KEY: 'Alt+Command+Shift+F19', CN_TRASH_DIR: run.trash, CN_ICLOUD_CONTAINER: join(root, 'icloud'), CN_AI_FAKE: '1' },
  })
  const page = await app.firstWindow()
  await expect(page.locator('.vault b')).toHaveText('测试库')
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0)))))
  return {
    page,
    async close() {
      await app.close()
      rmSync(root, { recursive: true, force: true, maxRetries: 5 })
    },
  }
}

test('看文档：默认不记；拨开后答一条记一条写进这篇本身，补进去、撤回、⋯ 记进 / 拿掉、关掉留着、旁支也记，重开软件还记得', async () => {
  test.setTimeout(240_000)
  const run = await launch(files, { CN_AI_FAKE: '1' })
  let page = run.page
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  let again: Awaited<ReturnType<typeof reopen>> | null = null
  try {
    await openNote(page, '第6章读书笔记')
    await openAi(page)
    const main = chat(page).getByTestId('ai-note-main')
    // 默认关：输入框下面那一排「记笔记 ·《第6章读书笔记》▾ ｜ 旁支」，两颗都关着，头上没有「正在记进」
    await expect(main).toHaveAttribute('aria-checked', 'false')
    await expect(chat(page).getByTestId('ai-note-side')).toHaveAttribute('aria-checked', 'false')
    await expect(chat(page).getByTestId('ai-note-target')).toHaveText('《第6章读书笔记》')
    await expect(chat(page).getByTestId('ai-note-rec')).toHaveCount(0)

    // 关着问一句：不写
    const a1 = await ask(page, '第一问：汇聚层是什么？')
    await page.waitForTimeout(500)
    expect(read(run, DOC)).toBe(files[DOC])
    await expect(a1.getByTestId('ai-noted')).toHaveCount(0)

    // 拨开：前面那一问没记，问补不补；「只记以后的」
    await main.click()
    const tip = chat(page).getByTestId('ai-note-tip')
    await expect(tip).toContainText('前面 1 问没记')
    await tip.getByRole('button', { name: '只记以后的' }).click()
    await expect(tip).toHaveCount(0)
    await expect(main).toHaveAttribute('aria-checked', 'true')
    await expect(chat(page).getByTestId('ai-note-rec')).toContainText('正在记进《第6章读书笔记》 · 旁支不记')
    await expect.poll(() => JSON.parse(read(run, '.canvas-notes/ai-note.json') ?? '{}').doc).toEqual({ main: true, side: false })

    // 再问一句：写进这篇本身（光标在自己那句后面，插在它后面）
    await page.locator('.pane:not([hidden])').getByText('汇聚层就是把图缩小').click()
    await page.keyboard.press('End')
    const a2 = await ask(page, '第二问：最大汇聚怎么算？')
    await expect(a2.getByTestId('ai-noted')).toHaveAttribute('data-state', 'done', { timeout: 15_000 })
    await expect(a2.getByTestId('ai-noted')).toContainText('已记进《第6章读书笔记》')
    await expect.poll(() => read(run, DOC)).toContain('### 第二问：最大汇聚怎么算？')
    const n1 = read(run, DOC)!
    expect(n1.startsWith('# 第6章读书笔记\n\n汇聚层就是把图缩小，让后面算得快。\n\n### 第二问：最大汇聚怎么算？\n\n> [!ai] AI 回答 · Claude Code')).toBe(true)
    expect(n1).toMatch(/> \[!ai\] AI 回答 · Claude Code[^\n]*\[回到 AI 对话\]\(canvas-notes:\/\/chat\?key=file%3A/)
    expect(n1).toContain('> 这是测试回答（Claude Code）。')
    expect(n1).not.toContain('第一问')
    expect(n1).not.toContain('AI 笔记')
    expect(existsSync(join(run.vault, '读书/第6章读书笔记 · AI 笔记.md'))).toBe(false)
    await expect.poll(() => lastCommit(run)).toBe('笔记：第6章读书笔记 · 第二问：最大汇聚怎么算？')

    // 头上的「正在记进」点了打开那篇（就是这篇）
    await chat(page).getByTestId('ai-note-rec').click()
    await expect(page.getByTestId('tab-on')).toHaveText('第6章读书笔记')

    // 中途关：之后的不记了，已记的留着（4 秒收）
    await main.click()
    await expect(tip).toContainText('之后的不记了；已记的 1 问留在《第6章读书笔记》里')
    await expect(tip).toHaveCount(0, { timeout: 6000 })
    expect(read(run, DOC)).toContain('### 第二问')
    await ask(page, '第三问：关着问的')
    await page.waitForTimeout(500)
    expect(read(run, DOC)).not.toContain('第三问')

    // 再开：前面 2 问没记（第一问、第三问），补进去
    await main.click()
    await expect(tip).toContainText('前面 2 问没记')
    await tip.getByRole('button', { name: '补进去' }).click()
    await expect(tip).toContainText('补进去了，按问的先后排好')
    await expect(a1.getByTestId('ai-noted')).toHaveAttribute('data-state', 'done', { timeout: 15_000 })
    const n2 = read(run, DOC)!
    expect(n2.indexOf('### 第二问')).toBeLessThan(n2.indexOf('### 第一问'))
    expect(n2.indexOf('### 第一问')).toBeLessThan(n2.indexOf('### 第三问'))

    // 撤回第一问：只拿掉那几行
    await a1.getByTestId('ai-noted-undo').click()
    await expect(a1.getByTestId('ai-noted')).toHaveCount(0)
    expect(read(run, DOC)).not.toContain('第一问')
    expect(read(run, DOC)).toContain('### 第二问')
    await expect.poll(() => lastCommit(run)).toBe('笔记：从第6章读书笔记拿掉 · 第一问：汇聚层是什么？')

    // ⋯ 记进：只记这一条；再 ⋯ 拿掉
    await more(page, a1, /^记进《第6章读书笔记》$/)
    await expect(a1.getByTestId('ai-noted')).toHaveAttribute('data-state', 'done', { timeout: 15_000 })
    expect(read(run, DOC)).toContain('### 第一问')
    await more(page, a1, /^从《第6章读书笔记》拿掉$/)
    await expect(a1.getByTestId('ai-noted')).toHaveCount(0)
    expect(read(run, DOC)).not.toContain('第一问')

    // 旁支开着：在回答里选一句问，旁支答完记进去，挂在被问那一问后面
    await chat(page).getByTestId('ai-note-side').click()
    await expect(chat(page).getByTestId('ai-note-side')).toHaveAttribute('aria-checked', 'true')
    await expect(chat(page).getByTestId('ai-note-rec')).toHaveText('正在记进《第6章读书笔记》')
    await selectText(page, a2.locator('.txt'), '测试', '回答')
    const box = page.getByRole('dialog', { name: '选中的这句' })
    await box.getByRole('textbox', { name: '问这句' }).fill('为什么叫测试？')
    await box.getByRole('textbox', { name: '问这句' }).press('Enter')
    const side = chat(page).getByRole('region', { name: '旁支' })
    await expect(side.getByTestId('side-msg').last()).not.toContainText('在答…', { timeout: 15_000 })
    await expect.poll(() => read(run, DOC), { timeout: 15_000 }).toContain('#### 旁支：为什么叫测试？')
    const n3 = read(run, DOC)!
    expect(n3).toContain('> 测试回答')
    expect(n3).toContain('—— 在「第二问：最大汇聚怎么算？」的回答里')
    expect(n3).toMatch(/> \[!ai\] 旁支回答/)
    // 旁支插在第二问后面、第三问前面
    expect(n3.indexOf('#### 旁支')).toBeGreaterThan(n3.indexOf('### 第二问'))
    expect(n3.indexOf('#### 旁支')).toBeLessThan(n3.indexOf('### 第三问'))
    await page.keyboard.press('Escape')
    await expect(side).toHaveCount(0)

    expect(errors).toEqual([])

    // 重开软件：开关还记得（库里文件），「已记进」照笔记认
    again = await reopen(run)
    page = again.page
    page.on('pageerror', (e) => errors.push(String(e)))
    await openNote(page, '第6章读书笔记')
    await openAi(page)
    await expect(chat(page).getByTestId('ai-note-main')).toHaveAttribute('aria-checked', 'true')
    await expect(chat(page).getByTestId('ai-note-side')).toHaveAttribute('aria-checked', 'true')
    await expect(chat(page).getByTestId('ai-note-rec')).toBeVisible()
    await expect(answers(page).nth(1).getByTestId('ai-noted')).toHaveAttribute('data-state', 'done')
    await expect(answers(page).nth(0).getByTestId('ai-noted')).toHaveCount(0)
    await expect(answers(page).nth(2).getByTestId('ai-noted')).toHaveAttribute('data-state', 'done')
    expect(errors).toEqual([])
  } finally {
    if (again) await again.close()
    else await run.close()
  }
})

test('没开东西（首页）：拨开先问记进哪篇，收件箱新建「和 AI 聊：…」；新对话清掉选的那篇，「找一篇…」记进库里一篇', async () => {
  test.setTimeout(180_000)
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page } = run
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  try {
    await openAi(page)
    await expect(chat(page).getByTestId('ai-sees')).toContainText('首页')
    const main = chat(page).getByTestId('ai-note-main')
    await expect(main).toHaveAttribute('aria-checked', 'false')
    await expect(chat(page).getByTestId('ai-note-target')).toHaveText('选一篇')

    const a1 = await ask(page, '帮我想想下周组会讲什么')
    // 拨开：先问记进哪篇
    await main.click()
    const menu = page.getByTestId('ai-note-menu')
    await expect(menu).toBeVisible()
    await expect(menu).toContainText('以后在首页聊：每段对话打开「记笔记」时都先问这一句。')
    await expect(menu.getByTestId('ai-note-to-inbox')).toContainText('和 AI 聊：帮我想想下周组会讲什么')
    await menu.getByTestId('ai-note-to-inbox').click()
    await expect(menu).toHaveCount(0)
    await expect(main).toHaveAttribute('aria-checked', 'true')
    await expect(chat(page).getByTestId('ai-note-target')).toHaveText('《和 AI 聊：帮我想想下周组…》')
    const tip = chat(page).getByTestId('ai-note-tip')
    await expect(tip).toContainText('前面 1 问没记')
    await tip.getByRole('button', { name: '补进去' }).click()
    await expect(a1.getByTestId('ai-noted')).toHaveAttribute('data-state', 'done', { timeout: 15_000 })
    const INBOX_NOTE = '收件箱/和 AI 聊：帮我想想下周组会讲什么.md'
    const n1 = read(run, INBOX_NOTE)!
    expect(n1).toContain('# 和 AI 聊：帮我想想下周组会讲什么')
    expect(n1).toContain('## 首页')
    expect(n1).toContain('### 帮我想想下周组会讲什么')
    expect(n1).toContain('canvas-notes://chat?key=home')
    expect(lastCommit(run)).toBe('笔记：和 AI 聊：帮我想想下周组会讲什么 · 帮我想想下周组会讲什么')
    await expect(chat(page).getByTestId('ai-note-rec')).toContainText('正在记进《和 AI 聊：帮我想想下周组会讲什么》')

    // 开着接着问：记进去
    const a2 = await ask(page, '第二页怎么画？')
    await expect(a2.getByTestId('ai-noted')).toHaveAttribute('data-state', 'done', { timeout: 15_000 })
    expect(read(run, INBOX_NOTE)).toContain('### 第二页怎么画？')
    expect(JSON.parse(read(run, '.canvas-notes/ai-note.json')!).none).toEqual({ main: true, side: false })

    // 新对话：选的那篇清掉，「记笔记」显示关着、要再选；「▾」里找一篇库里的
    await chat(page).getByRole('button', { name: '新对话' }).click()
    await expect(answers(page)).toHaveCount(0)
    await expect(main).toHaveAttribute('aria-checked', 'false')
    await expect(chat(page).getByTestId('ai-note-target')).toHaveText('选一篇')
    await chat(page).getByTestId('ai-note-target').click()
    await menu.getByTestId('ai-note-to-find').click()
    await menu.getByRole('textbox', { name: '找一篇' }).fill('周记')
    await menu.getByRole('listbox', { name: '找到的' }).getByRole('option', { name: /周记/ }).click()
    await expect(menu).toHaveCount(0)
    // 开关本来就开着（没开东西这一种记住的是开）：选好就开始记
    await expect(main).toHaveAttribute('aria-checked', 'true')
    const a3 = await ask(page, '这周读了什么？')
    await expect(a3.getByTestId('ai-noted')).toHaveAttribute('data-state', 'done', { timeout: 15_000 })
    const w = read(run, '周记.md')!
    expect(w.startsWith('# 周记\n\n这周读了 ECP。\n')).toBe(true)
    expect(w).toContain('## 首页')
    expect(w).toContain('### 这周读了什么？')
    // 收件箱那篇不动
    expect(read(run, INBOX_NOTE)).not.toContain('这周读了什么')
    expect(errors).toEqual([])
  } finally {
    await run.close()
  }
})
