// 「AI 总结的」卡正文写成 `> [!ai] AI 总结 · …` 提示块，能选一句开旁支（task-5yp97，用户看了
// /private/tmp/canvas-notes-visual/01-画布笔记小处/summary-o1.png 选「选法 1」，原话「这里可以」）。
// 以前存的总结卡（编号行后面一段普通的字）第一次打开时一次改好：单独一次提交、底栏能撤回（撤回后文件一个字节不差、以后不再自动改）；
// 改完再打开不再动、⌘S 字节不变（打开再保存不变那条规矩：改写只做一次）。卡里选一句开旁支，`> [!side]` 挂在总结块后面，
// 「记到哪」写「挂在这段总结下面」；新存的总结直接是 AI 总结块，头一行写是哪家、哪个模型。
// 一律无头（CN_E2E=1）、假 AI（CN_AI_FAKE=1）。
import { expect, test, type Locator, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { acts, gitStatus, launch, openAi, openNote, pane, waitSaved } from './app'
import { board, col } from './fixtures/board-doc'

const askbox = (page: Page) => page.getByRole('dialog', { name: '选中的这句' })
const sideIn = (scope: Locator) => scope.getByRole('region', { name: '旁支' })
const toast = (page: Page) => page.locator('footer, .status')

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

const DOC = '课程/ecp/注意力白板.md'
const OLD = [
  '---',
  'type: board',
  '---',
  '# 注意力白板',
  '',
  '<!-- card id=s1 ai=2026-11-21 -->',
  '这块白板讲了注意力的三步：先拿 Q 和每个 K 做点积得到分数，分数除以 √d 再过 softmax 变成权重，最后用权重把 V 加起来。多头注意力是把 Q、K、V 切成几份各算各的，再拼回来。',
  '',
  '## 讲解',
  '',
  '先拿 Q 和每个 K 做点积，得到「该看谁」的分数。',
  '',
  '最后用这些权重把 V 加起来，就是这个位置的输出。',
  '',
].join('\n')
const SUMMARY = '这块白板讲了注意力的三步：先拿 Q 和每个 K 做点积得到分数，分数除以 √d 再过 softmax 变成权重，最后用权重把 V 加起来。多头注意力是把 Q、K、V 切成几份各算各的，再拼回来。'
const NEW_TEXT = OLD.replace(`<!-- card id=s1 ai=2026-11-21 -->\n${SUMMARY}`, `<!-- card id=s1 ai=2026-11-21 -->\n> [!ai] AI 总结\n> ${SUMMARY}`)

const git = (vault: string, args: string[]) => execFileSync('git', ['-C', vault, ...args], { encoding: 'utf8' }).trim()

test('以前存的「AI 总结的」卡：第一次打开一次改成 AI 总结块（单独一次提交）；卡里选一句开旁支，`> [!side]` 挂在总结块后面、「记到哪」写总结；文档里是同一份；再打开不再改、⌘S 字节不变', async () => {
  test.setTimeout(120_000)
  const run = await launch({ [DOC]: OLD }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  const file = () => readFileSync(join(vault, DOC), 'utf8')
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    const before = Number(git(vault, ['rev-list', '--count', 'HEAD']))
    await openNote(page, '注意力白板')
    if ((await acts(page).getByRole('tab', { name: '白板' }).getAttribute('aria-selected')) !== 'true') await acts(page).getByRole('tab', { name: '白板' }).click()
    // 一次改好：只改那张卡（头一行「AI 总结」，每行加「> 」），单独一次提交；底栏一句带撤回
    await expect.poll(file).toBe(NEW_TEXT)
    await expect.poll(() => git(vault, ['log', '-1', '--format=%s'])).toBe('AI 总结卡改成提示块写法：注意力白板')
    expect(Number(git(vault, ['rev-list', '--count', 'HEAD']))).toBe(before + 1)
    expect(gitStatus(vault)).toBe('')
    await expect(toast(page).getByText('《注意力白板》里的「AI 总结的」卡改了写法：能选一句开旁支了')).toBeVisible()

    // 白板上：一张「AI 总结」卡，头上「AI 总结」，卡底照旧「AI 总结的 · 日期」
    const card = board(page).locator('.db-card[aria-label="AI 总结"]')
    await expect(card).toBeVisible()
    await expect(card.locator('.ct .nm')).toHaveText('AI 总结')
    // 不知道是哪家写的：不画图标（对话图标和旁支、小标撞了），「AI 总结」和正文左对齐（设计复审）
    await expect(card.locator('.ct > :first-child')).toHaveClass(/\bnm\b/)
    expect(Math.abs((await card.locator('.ct .nm').boundingBox())!.x - (await card.locator('.side-text').boundingBox())!.x)).toBeLessThanOrEqual(1)
    await expect(card.locator('.aifoot')).toHaveText('AI 总结的 · 2026-11-21')
    const body = card.locator('.side-text')

    // 卡里拖选一句 → 同一个小框 → 问这句：旁支就地长在卡里
    await selectText(page, body, '分数除以', '变成权重，')
    await expect(askbox(page)).toBeVisible()
    await askbox(page).getByRole('textbox', { name: '问这句' }).fill('为什么要除以 √d？')
    await askbox(page).getByRole('textbox', { name: '问这句' }).press('Enter')
    const s = sideIn(card)
    await expect(s).toBeVisible()
    await expect(body.locator('.asked.on')).toHaveText('分数除以 √d 再过 softmax 变成权重，')
    await expect(s.getByTestId('side-msg').last()).toContainText('旁支的回答', { timeout: 15_000 })
    await expect(s.locator('.rec')).toHaveText('写在这篇文档里，挂在这段总结下面')
    await s.getByRole('button', { name: '旁支菜单' }).click()
    await expect(page.getByRole('menu', { name: '旁支' }).locator('.mh')).toHaveText('这段总结的旁支')
    await page.keyboard.press('Escape')
    // 文件里：挂在总结块后面、「## 讲解」前面，第一问带那一句
    await waitSaved(page)
    await expect
      .poll(file, { timeout: 15_000 })
      .toContain(`> ${SUMMARY}\n\n> [!side] 为什么要除以 √d？\n> > 分数除以 √d 再过 softmax 变成权重，\n>\n> #### 旁支的回答`)
    expect(file().indexOf('> [!side]')).toBeLessThan(file().indexOf('## 讲解'))
    // 白板上不露 md，旁支和总结还是一张卡
    await expect(card).not.toContainText('[!side]')
    await page.keyboard.press('Escape')
    await expect(s).toHaveCount(0)
    await expect(body.locator('.badge')).toHaveText('1')

    // 文档看法：总结块头上「AI 总结」，那句后面有小标，点开问答都在；「记到哪」同样写总结
    await acts(page).getByRole('tab', { name: '文档' }).click()
    const content = pane(page).locator('.cm-content')
    await expect(content).toContainText('AI 总结')
    await expect(content).not.toContainText('[!ai]')
    await expect(content.locator('.cm-callout-head .cm-callout-icon.bare')).toHaveCount(1)
    await expect(content.locator('.cm-callout-head .cm-callout-icon svg')).toHaveCount(0)
    await content.locator('.badge').click()
    const ds = sideIn(pane(page))
    await expect(ds.locator('.sq')).toHaveText(['为什么要除以 √d？'])
    await expect(ds.locator('.rec')).toHaveText('写在这篇文档里，挂在这段总结下面')
    await page.keyboard.press('Escape')
    await expect(ds).toHaveCount(0)
    await waitSaved(page)

    // 改完再打开不再动（不多提交）、⌘S 字节不变
    const commits = Number(git(vault, ['rev-list', '--count', 'HEAD']))
    const saved = readFileSync(join(vault, DOC))
    await page.locator('.tab.on .x').click()
    await openNote(page, '注意力白板')
    if ((await acts(page).getByRole('tab', { name: '白板' }).getAttribute('aria-selected')) !== 'true') await acts(page).getByRole('tab', { name: '白板' }).click()
    await expect(board(page).locator('.db-card[aria-label="AI 总结"] .badge')).toHaveText('1')
    await board(page).focus()
    await page.keyboard.press('Meta+s')
    await page.waitForTimeout(1000)
    expect(readFileSync(join(vault, DOC)).equals(saved)).toBe(true)
    expect(Number(git(vault, ['rev-list', '--count', 'HEAD']))).toBe(commits)
  } finally {
    await run.close()
  }
})

test('改写法能撤回：底栏「撤回」文件回到改之前一个字节不差、记进名单，再打开不再自动改', async () => {
  const run = await launch({ [DOC]: OLD }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  const file = () => readFileSync(join(vault, DOC), 'utf8')
  try {
    await openNote(page, '注意力白板')
    if ((await acts(page).getByRole('tab', { name: '白板' }).getAttribute('aria-selected')) !== 'true') await acts(page).getByRole('tab', { name: '白板' }).click()
    await expect.poll(file).toBe(NEW_TEXT)
    await toast(page).getByRole('button', { name: '撤回' }).click()
    await expect.poll(file).toBe(OLD)
    await expect.poll(() => git(vault, ['log', '-1', '--format=%s'])).toBe('撤回：AI 总结卡改成提示块写法：注意力白板')
    expect(JSON.parse(readFileSync(join(vault, '.canvas-notes/总结卡旧写法.json'), 'utf8')).文件).toEqual([DOC])
    await expect.poll(() => gitStatus(vault)).toBe('')
    await expect(toast(page).getByText('撤回了：《注意力白板》里的总结卡回到以前的写法，以后打开不再自动改')).toBeVisible()
    // 白板上照旧是那张普通的「AI 总结的」卡
    await expect(board(page).locator('.db-card', { hasText: '这块白板讲了注意力的三步' }).locator('.aifoot')).toHaveText('AI 总结的 · 2026-11-21')
    // 关掉再开：不再改
    const commits = git(vault, ['rev-list', '--count', 'HEAD'])
    await page.locator('.tab.on .x').click()
    await openNote(page, '注意力白板')
    if ((await acts(page).getByRole('tab', { name: '白板' }).getAttribute('aria-selected')) !== 'true') await acts(page).getByRole('tab', { name: '白板' }).click()
    await expect(board(page)).toBeVisible()
    await page.waitForTimeout(800)
    expect(file()).toBe(OLD)
    expect(git(vault, ['rev-list', '--count', 'HEAD'])).toBe(commits)
  } finally {
    await run.close()
  }
})

test('新存的总结直接是 AI 总结块（头一行写哪家、哪个模型），卡上选一句就能开旁支', async () => {
  test.setTimeout(120_000)
  const name = '课程/ecp/新白板.md'
  const run = await launch({ [name]: '---\ntype: board\n---\n# 新白板\n\n## 讲解\n\n先拿 Q 和每个 K 做点积。\n\n最后用这些权重把 V 加起来。\n' }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await openNote(page, '新白板')
    if ((await acts(page).getByRole('tab', { name: '白板' }).getAttribute('aria-selected')) !== 'true') await acts(page).getByRole('tab', { name: '白板' }).click()
    await openAi(page)
    const ai = page.getByRole('complementary', { name: 'AI 对话' })
    const box = ai.getByRole('textbox', { name: '问 AI' })
    await box.fill('/总结这块白板')
    await box.press('Enter')
    const msg = ai.getByTestId('ai-msg').last()
    await expect(msg).toContainText('这块白板讲了三件事', { timeout: 15_000 })
    await msg.getByRole('button', { name: '存成卡片' }).click()
    await expect(msg).toContainText('存到了白板最左一组的最上面')
    const md = readFileSync(join(vault, name), 'utf8')
    expect(md).toMatch(/<!-- card id=s1 ai=\d{4}-\d{2}-\d{2} -->\n> \[!ai\] AI 总结 · Claude Code · [^\n]+\n> 这块白板讲了三件事/)
    expect(existsSync(join(vault, '.canvas-notes/总结卡旧写法.json'))).toBe(false)
    const card = board(page).locator('.db-card[aria-label="AI 总结"]')
    await expect(card).toBeVisible()
    await expect(card.locator('.ct .eng')).toContainText('Claude Code')
    // 新存的写了是哪家：画那家的标志
    await expect(card.locator('.ct > :first-child')).not.toHaveClass(/\bnm\b/)
    await selectText(page, card.locator('.side-text'), '这块白板', '三件事')
    await expect(askbox(page)).toBeVisible()
    await askbox(page).getByRole('textbox', { name: '问这句' }).press('Enter')
    await expect(sideIn(card)).toBeVisible()
    await expect(sideIn(card).locator('.rec')).toHaveText('写在这篇文档里，挂在这段总结下面')
    // 打开再保存：新存的不会被当成以前的写法再改一次
    await page.keyboard.press('Escape')
    await expect(col(page, '讲解')).toBeVisible()
  } finally {
    await run.close()
  }
})
