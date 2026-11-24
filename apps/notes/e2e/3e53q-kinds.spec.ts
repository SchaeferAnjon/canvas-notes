// task-3e53q 第 ① 条线：AI 回答里七种引用的预览卡和开法（设计页「二、a. 引用都能点开」那张表），加已定的 1、2、3：
// 1 页码小牌先出卡（那页缩略图、框画出来）、⌘点再翻；2 ⇧⌘点开在后面的新标签、不切走，底栏说一句；
// 3 从 AI 回答 ⌘点开一篇，右栏 AI 不跟着换对话（旁支留着），头上「切到《X》的 AI ⌥⌘J」、按键或按钮才换；平时切标签照旧跟着换。
// 都是真点：一律无头（CN_E2E=1）、假 AI（CN_AI_FAKE=1，问「列出七种引用 <提交号>」答七种链接）、临时库。
import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { acts, launch, openAi, openNote, pane, tabOn, type Running } from './app'
import { LECTURE } from './fixtures/pdf'

const PLAN = '课程/小论文计划.md'
const PLAN_MD = ['# 小论文计划', ...Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 条：先放着。`), 'SAGE 排第 2 篇，编号 J52。', '作者和 C72 重叠（Chenpei Xie）。', ''].join('\n')
const PDF = '课程/线代/第3讲.pdf'
const HERE = '收件箱/随手.md'
const BOARD = '课程/读论文白板.md'
// 不是 type: board：一篇文档，卡上有编号；⌘点白板卡时换成白板看法
const BOARD_MD = ['# 读论文白板', '', '## 方法', '', '<!-- card id=c7 -->', '**LOSO 评估**', '随机划分 91.8%，留一被试 80.6%：差 11 个点。', '', '另一张卡。', '', '## 结果', '', '结果那张。', ''].join('\n')
const DB = '文献库.md'
const DB_MD = ['# 文献库', '', '```base', 'filters:', '  and:', '    - file.inFolder("文献库")', 'views:', '  - type: table', '    name: 表格', '    order:', '      - file.name', '      - 状态', '      - 年份', '      - 和 C72', '      - 页数', '      - 备注', '```', ''].join('\n')
const SAGE = '文献库/SAGE.md'
const SAGE_MD = ['---', '状态: 在读', '年份: 2025', '和 C72: 同一组作者', '页数: 14', '备注: 第五列不上卡', '---', '# SAGE', '', '图神经网络，和 C72 同一组作者。', ''].join('\n')
const TODO = '待办.md'
const TODO_MD = ['# 待办', '', '- [ ] 周五前读完 SAGE 📅 2026-11-27', '- [ ] 别的事', ''].join('\n')
const FILES = { [PLAN]: PLAN_MD, [PDF]: LECTURE, [HERE]: '# 随手\n\n问问 AI。\n', [BOARD]: BOARD_MD, [DB]: DB_MD, [SAGE]: SAGE_MD, [TODO]: TODO_MD }
const SUBJECT = '整理小论文计划：SAGE 挪到第 2 篇'

/** 库里先有一次「整理小论文计划」的提交（改了两篇），历史引用就指它 */
function prepare(vault: string) {
  const git = (...a: string[]) => execFileSync('git', ['-C', vault, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...a])
  git('add', '-A')
  git('commit', '-q', '-m', '开始')
  appendFileSync(join(vault, PLAN), '排第 3 篇还没定。\n')
  appendFileSync(join(vault, BOARD), '\n又一张。\n')
  git('add', '-A')
  git('commit', '-q', '-m', SUBJECT)
  writeFileSync(join(vault, '收件箱/样本.md'), '# 样本\n')
}
const hashOf = (vault: string) => execFileSync('git', ['-C', vault, 'log', '-1', '--format=%h', `--grep=${SUBJECT}`], { encoding: 'utf8' }).trim()

const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const card = (page: Page) => page.getByRole('dialog', { name: '引用' })
const tabs = (page: Page) => page.getByTestId('tab-list').locator(':scope > .tab')
const toast = (page: Page) => page.getByTestId('toast')
const pdfPane = (page: Page) => page.locator('.pdfpane:not([hidden])')

async function ask(run: Running): Promise<Locator> {
  const { page } = run
  await openNote(page, '随手')
  await openAi(page)
  const ta = chat(page).getByRole('textbox', { name: '问 AI' })
  await ta.fill(`列出七种引用 ${hashOf(run.vault)}`)
  await ta.press('Enter')
  const msg = chat(page).getByTestId('ai-msg').last()
  await expect(msg).toContainText('整理计划那次', { timeout: 15_000 })
  return msg
}

/** 点一下出卡：卡右上角写是哪种；不开标签 */
async function cardOf(page: Page, link: Locator, kind: string) {
  const n = await tabs(page).count()
  await link.click()
  await expect(card(page)).toBeVisible()
  await expect(card(page).locator('.top .kind')).toHaveText(kind)
  expect(await tabs(page).count()).toBe(n)
  return card(page)
}

/** ⇧⌘点：标签多一个、当前标签不变、底栏说开在后面了 */
async function behind(page: Page, link: Locator, said: RegExp) {
  // 卡开着先收起（esc 只收卡；没有卡时 esc 别处另有用处）
  if (await card(page).isVisible()) await page.keyboard.press('Escape')
  await expect(card(page)).toHaveCount(0)
  const n = await tabs(page).count()
  const on = await tabOn(page).textContent()
  await link.click({ modifiers: ['Meta', 'Shift'] })
  await expect(tabs(page)).toHaveCount(n + 1)
  await expect(tabOn(page)).toHaveText(on!)
  await expect(toast(page)).toContainText(said)
}

test('笔记几行、PDF 某页某块、网页某一段：卡上写是哪种；页码小牌点一下先出卡（那页缩略图、框画出来），⌘点才翻、框闪；⇧⌘点开在后面、底栏说一句', async () => {
  const run = await launch(FILES, { CN_AI_FAKE: '1' }, prepare)
  const { page } = run
  try {
    const msg = await ask(run)
    // 笔记：右上角「笔记」，那两行
    const note = msg.locator('a.cite', { hasText: '小论文计划里排' })
    const c1 = await cardOf(page, note, '笔记')
    await expect(c1.locator('.u')).toHaveText('课程 · 第42–43行')
    await expect(c1.locator('.ex p')).toHaveText(['SAGE 排第 2 篇，编号 J52。', '作者和 C72 重叠（Chenpei Xie）。'])
    await behind(page, note, /《小论文计划》开在后面的标签里了/)

    // PDF 页码小牌：先出卡，不翻
    const pg = msg.locator('a.pg.cite', { hasText: '第 4 页' })
    const c2 = await cardOf(page, pg, 'PDF')
    await expect(c2.locator('.top b')).toHaveText('第3讲.pdf')
    await expect(c2.locator('.u')).toHaveText('课程/线代 · 第4页')
    // 那页的缩略图画出来了，框在缩略图里面
    const img = c2.getByTestId('cite-thumb').locator('img')
    await expect(img).toBeVisible({ timeout: 15_000 })
    await expect.poll(() => img.evaluate((e: HTMLImageElement) => e.naturalWidth)).toBeGreaterThan(300)
    const box = c2.getByTestId('cite-thumb').locator('.box')
    await expect(box).toBeVisible()
    const tb = (await c2.getByTestId('cite-thumb').boundingBox())!
    const bb = (await box.boundingBox())!
    expect(bb.y).toBeGreaterThanOrEqual(tb.y - 1)
    expect(bb.y + bb.height).toBeLessThanOrEqual(tb.y + tb.height + 1)
    await expect(c2.locator('.acts button')).toHaveText(['翻到这页 ⌘点', '新标签打开 ⇧⌘点', '拷贝'])
    await expect(tabOn(page)).toHaveText('随手')
    // ⌘点：翻到第 4 页，框闪
    await page.keyboard.press('Escape')
    await pg.click({ modifiers: ['Meta'] })
    await expect(tabOn(page)).toHaveText('第3讲.pdf')
    await expect(acts(page).getByTestId('pdf-pager')).toHaveText('4 / 5', { timeout: 10_000 })
    await expect(pdfPane(page).getByTestId('pdf-flash')).toBeVisible()

    // 网页：右上角「网页」，网址和那几个字
    const web = msg.locator('a.cite', { hasText: '注意力那段' })
    const c3 = await cardOf(page, web, '网页')
    await expect(c3.locator('.u')).toHaveText('example.com/attn.html')
    await expect(c3.locator('.ex p')).toHaveText(['注意力'])
  } finally {
    await run.close()
  }
})

test('白板卡、数据库一行、待办一条：卡上画那张卡 / 表头前四列 / 勾选框（能直接勾、⌘Z 撤回）；⌘点开白板转到那张卡外圈亮、右栏开这一行、待办那一行闪；⇧⌘点开在后面', async () => {
  const run = await launch(FILES, { CN_AI_FAKE: '1' }, prepare)
  const { page, vault } = run
  const read = (p: string) => readFileSync(join(vault, p), 'utf8')
  try {
    const msg = await ask(run)

    // ---- 白板卡：卡里画那张卡本身
    const bl = msg.locator('a.cite', { hasText: 'LOSO 那张卡' })
    const c1 = await cardOf(page, bl, '白板卡')
    await expect(c1.locator('.top b')).toHaveText('读论文白板')
    await expect(c1.locator('.u')).toHaveText('课程 · 白板里的一张卡')
    await expect(c1.getByTestId('cite-board-card').locator('b')).toHaveText('LOSO 评估')
    await expect(c1.getByTestId('cite-board-card').locator('p')).toHaveText(['随机划分 91.8%，留一被试 80.6%：差 11 个点。'])
    await expect(c1.locator('.acts button').first()).toHaveText('打开白板 ⌘点')
    // ⇧⌘点：开在后面；切过去时是白板看法、那张卡外圈亮一下
    await behind(page, bl, /《读论文白板》开在后面的标签里了/)
    await tabs(page).filter({ hasText: '读论文白板' }).click()
    // 切过去了，「开在后面」那句就收掉
    await expect(toast(page).filter({ hasText: '开在后面' })).toHaveCount(0)
    const c7 = pane(page).getByTestId('doc-board').locator('.db-card[data-id="c7"]')
    await expect(c7).toBeVisible()
    await expect(c7).toHaveClass(/flown/)
    // 只亮一下，不选中
    await expect(c7).not.toHaveClass(/\bsel\b/)
    // 关掉它，再从回答里 ⌘点
    await page.keyboard.press('Meta+w')
    await expect(tabs(page).filter({ hasText: '读论文白板' })).toHaveCount(0)
    await tabs(page).filter({ hasText: '随手' }).click()
    // ⌘点：开白板看法，转到那张卡
    await bl.click({ modifiers: ['Meta'] })
    await expect(tabOn(page)).toHaveText('读论文白板')
    await expect(acts(page).getByRole('tab', { name: '白板' })).toHaveAttribute('aria-selected', 'true')
    await expect(pane(page).getByTestId('doc-board').locator('.db-card[data-id="c7"]')).toHaveClass(/flown/)
    await tabs(page).filter({ hasText: '随手' }).click()

    // ---- 数据库一行：表头前四列（第五列不上卡）
    const rl = msg.locator('a.cite', { hasText: 'SAGE 那一行' })
    const c2 = await cardOf(page, rl, '数据库')
    await expect(c2.locator('.top b')).toHaveText('SAGE')
    await expect(c2.locator('.u')).toHaveText('文献库 · 一行')
    await expect(c2.getByTestId('cite-row').locator('span')).toHaveText(['状态', '在读', '年份', '2025', '和 C72', '同一组作者', '页数', '14'])
    await expect(c2.locator('.acts button').first()).toHaveText('打开这一行 ⌘点')
    await behind(page, rl, /《SAGE》开在后面的标签里了/)
    // ⌘点：和数据库里点一行一样，右栏「记录」开这一行
    await rl.click({ modifiers: ['Meta'] })
    await expect(page.locator('.rpeek')).toBeVisible()
    await expect(page.locator('.rpeek')).toContainText('SAGE')
    await expect(tabOn(page)).toHaveText('随手')
    await openAi(page)

    // ---- 待办一条：勾选框 + 那一条 + 日子；卡上直接勾，文件里那一行勾上，底栏能撤回，⌘Z 也撤回
    const tl = msg.locator('a.cite', { hasText: '周五前读完 SAGE' })
    const c3 = await cardOf(page, tl, '待办')
    await expect(c3.locator('.u')).toHaveText('库根目录 · 第3行')
    await expect(c3.locator('.td .tt')).toContainText('周五前读完 SAGE')
    const box = c3.getByRole('checkbox', { name: '勾掉「周五前读完 SAGE」' })
    await expect(box).toHaveAttribute('aria-checked', 'false')
    await box.click()
    await expect.poll(() => read(TODO).split('\n')[2]).toMatch(/^- \[x\] 周五前读完 SAGE/)
    await expect(c3.getByRole('checkbox', { name: '取消勾选「周五前读完 SAGE」' })).toHaveAttribute('aria-checked', 'true')
    await expect(toast(page)).toContainText('勾掉了「周五前读完 SAGE」')
    await expect(toast(page).getByRole('button', { name: '撤回' })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Meta+z')
    await expect.poll(() => read(TODO)).toBe(TODO_MD)
    // ⇧⌘点开在后面；⌘点开待办，那一行闪
    await behind(page, tl, /《待办》开在后面的标签里了/)
    await tl.click({ modifiers: ['Meta'] })
    await expect(tabOn(page)).toHaveText('待办')
    await expect(pane(page).locator('.td-r.flash')).toContainText('周五前读完 SAGE')
  } finally {
    await run.close()
  }
})

test('历史里一次提交：卡上说明、时间、改了哪几篇和加减行数；⌘点开对比标签，⇧⌘点开在后面', async () => {
  const run = await launch(FILES, { CN_AI_FAKE: '1' }, prepare)
  const { page, vault } = run
  try {
    const msg = await ask(run)
    const h = hashOf(vault)
    const cl = msg.locator('a.cite', { hasText: '整理计划那次' })
    const c = await cardOf(page, cl, '历史')
    await expect(c.locator('.top b')).toHaveText(SUBJECT)
    await expect(c.locator('.u')).toContainText(`${h.slice(0, 7)} · 改了2篇`)
    const files = c.getByTestId('cite-commit-files').locator(':scope > div')
    await expect(files).toHaveCount(2)
    await expect(files.filter({ hasText: '小论文计划' })).toContainText('+1')
    await expect(files.filter({ hasText: '读论文白板' })).toContainText('+2')
    await expect(c.locator('.acts button').first()).toHaveText('看这次改动 ⌘点')
    await behind(page, cl, /这次改动开在后面的标签里了/)
    await expect(tabs(page).filter({ hasText: h.slice(0, 7) })).toHaveCount(1)
    await cl.click({ modifiers: ['Meta'] })
    await expect(tabOn(page)).toContainText(h.slice(0, 7))
    await expect(pane(page)).toContainText('小论文计划')
  } finally {
    await run.close()
  }
})

const reader = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })
const side = (page: Page) => reader(page).getByRole('region', { name: '旁支' })
const askbox = (page: Page) => page.getByRole('toolbar', { name: '选中的这句' })

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
        n.parentElement!.scrollIntoView({ block: 'center' })
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

test('读 PDF 的旁支里 ⌘点一篇笔记：右栏还是读 PDF 的 AI、旁支留着，头上「切到《小论文计划》的 AI ⌥⌘J」，按 ⌥⌘J 才换；回答里光写页码的「第 2 页」也是先出卡、⌘点才翻', async () => {
  const run = await launch(FILES, { CN_AI_FAKE: '1' }, prepare)
  const { page } = run
  try {
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲.pdf')
    await page.locator('.pal-row', { hasText: '第3讲' }).first().click()
    await expect(tabOn(page)).toHaveText('第3讲.pdf')
    await expect(pdfPane(page).locator('.pdfpage[data-page="1"] canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
    await page.keyboard.press('Meta+j')
    await expect(reader(page)).toBeVisible()
    await acts(page).getByRole('button', { name: /问这一页/ }).click()
    const msg = reader(page).getByTestId('reading-msg').last()
    await expect(msg.locator('.txt')).toContainText('列就是基向量去哪', { timeout: 20_000 })

    // 光写页码的「第 2 页」（这份 PDF 的）：点一下出卡（那页缩略图），不翻；⌘点才翻到第 2 页
    const p2 = msg.locator('a.pg', { hasText: '第 2 页' })
    await p2.click()
    await expect(card(page).locator('.top .kind')).toHaveText('PDF')
    await expect(card(page).locator('.u')).toHaveText('课程/线代 · 第2页')
    await expect(card(page).getByTestId('cite-thumb').locator('img')).toBeVisible({ timeout: 15_000 })
    await expect(acts(page).getByTestId('pdf-pager')).toHaveText('1 / 5')
    await page.keyboard.press('Escape')
    await p2.click({ modifiers: ['Meta'] })
    await expect(acts(page).getByTestId('pdf-pager')).toHaveText('2 / 5', { timeout: 10_000 })

    // 开旁支，问出引用
    await selectText(page, msg.locator('.txt'), '列就是', '去哪')
    await askbox(page).getByRole('button', { name: '问这句' }).click()
    // 「问这句」直接开旁支，光标在旁支的输入框里，问题在那里打（r129 小条上不再常驻问题那一格）
    await page.keyboard.insertText('列出引用')
    await page.keyboard.press('Enter')
    const ans = side(page).getByTestId('side-msg').last()
    await expect(ans).toContainText('没有这篇', { timeout: 20_000 })

    // ⌘点：中间开《小论文计划》；右栏还是读 PDF 的 AI，旁支还开着
    await ans.locator('a.cite', { hasText: '小论文计划里排' }).click({ modifiers: ['Meta'] })
    await expect(tabOn(page)).toHaveText('小论文计划')
    await expect(reader(page)).toBeVisible()
    await expect(side(page)).toBeVisible()
    await expect(chat(page)).toBeHidden()
    const away = reader(page).getByTestId('ai-away')
    await expect(away).toContainText('这是在《第3讲.pdf》问的')
    await expect(away.getByTestId('ai-follow')).toHaveText('切到《小论文计划》的 AI⌥⌘J')
    // 按 ⌥⌘J：右栏换成《小论文计划》的 AI 对话
    await page.keyboard.press('Alt+Meta+KeyJ')
    await expect(chat(page)).toBeVisible()
    await expect(reader(page)).toBeHidden()
    await expect(chat(page).getByTestId('ai-conv')).toContainText('小论文计划')

    // 平时切标签照旧跟着换：点回 PDF，右栏回到读 PDF 的 AI（旁支还在）
    await tabs(page).filter({ hasText: '第3讲.pdf' }).click()
    await expect(reader(page)).toBeVisible()
    await expect(reader(page).getByTestId('ai-away')).toHaveCount(0)
    await expect(side(page)).toBeVisible()
  } finally {
    await run.close()
  }
})

test('右栏 AI 对话里 ⌘点一篇：右栏留在「随手」那段，点头上的按钮才换成那篇的；⇧⌘点不切走、右栏不动', async () => {
  const run = await launch(FILES, { CN_AI_FAKE: '1' }, prepare)
  const { page } = run
  try {
    const msg = await ask(run)
    // ⇧⌘点：开在后面，中间和右栏都不动
    await behind(page, msg.locator('a.cite', { hasText: 'SAGE 那一行' }), /《SAGE》开在后面的标签里了/)
    await expect(chat(page).getByTestId('ai-conv')).toContainText('随手')
    await expect(chat(page).getByTestId('ai-away')).toHaveCount(0)
    await msg.locator('a.cite', { hasText: '小论文计划里排' }).click({ modifiers: ['Meta'] })
    await expect(tabOn(page)).toHaveText('小论文计划')
    // 还是「随手」那段：回答还在，胶囊写随手
    await expect(chat(page).getByTestId('ai-conv')).toContainText('随手')
    await expect(msg).toBeVisible()
    const away = chat(page).getByTestId('ai-away')
    await expect(away).toContainText('这是在《随手》问的')
    await away.getByTestId('ai-follow').click()
    await expect(chat(page).getByTestId('ai-conv')).toContainText('小论文计划')
    await expect(chat(page).getByTestId('ai-away')).toHaveCount(0)
    await expect(chat(page).getByTestId('ai-msg').filter({ hasText: '整理计划那次' })).toHaveCount(0)
  } finally {
    await run.close()
  }
})
