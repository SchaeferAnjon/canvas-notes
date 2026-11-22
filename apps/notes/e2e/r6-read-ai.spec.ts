/**
 * 发版前第 6 轮（实用 · 读与 AI）找出来的问题：每条一个测试，真按、真点。
 * - 写不进去另存：一篇笔记的字任何时刻只有一个落盘目标。另存以后标签跟到另存那篇、标明「原文件写不进去，字在这里」，
 *   以后的保存、退出时的保存都只写那篇；另存也写不进（像盘满了）时标签和底栏写「写不进去，字只在内存里」、字备份进设置目录、退出前要用户确认。
 * - 梦游「全部收下」：能收的都收，合不上的那条单独留着、说清是哪条为什么；两边都只往末尾加了几行算合得上。
 * - 刚打完字马上点「收下」：先把编辑器里没存的字存盘、一起合，不当成「外面改了」。
 * - 撤回认改名：改名时顺手改了几个字也认得出。
 * - 右栏地址栏打局域网地址（192.168.x.x、10.x、172.16–31.x、localhost、*.local）直接打开，不拿去 Google 搜。
 */
import { expect, test, type Page } from '@playwright/test'
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { acts, editorText, gitAct, launch, leftView, openNote, pane, rail, tabOn, type Running } from './app'
import { DREAM_VAULT } from './fixtures/dream'
import { launchCounted, netMark, netSince, tempHome } from './net'
import { shotTone, shotWindow } from './shots'

const saveState = (page: Page) => acts(page).getByTestId('save-state')
const allFiles = (root: string) => {
  const out: string[] = []
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === '.canvas-notes') continue
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else out.push(p.slice(root.length + 1))
    }
  }
  walk(root)
  return out.sort()
}
const withText = (root: string, s: string) => allFiles(root).filter((f) => readFileSync(join(root, f), 'utf8').includes(s))
const git = (vault: string, ...args: string[]) => execFileSync('git', ['-C', vault, '-c', 'core.quotepath=false', ...args], { encoding: 'utf8' })

async function recordToasts(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { toasts: string[] }
    w.toasts = []
    new MutationObserver(() => {
      const t = (document.querySelector('[data-testid="toast"]') as HTMLElement | null)?.innerText ?? ''
      if (t && !w.toasts.includes(t)) w.toasts.push(t)
    }).observe(document.body, { subtree: true, childList: true, characterData: true })
  })
  return () => page.evaluate(() => (window as unknown as { toasts: string[] }).toasts)
}
async function typeAtEnd(page: Page, text: string) {
  await pane(page).locator('.cm-content').click()
  await page.keyboard.press('Meta+End')
  await page.keyboard.type(text)
}
async function quit(run: Running) {
  const proc = run.app.process()
  const done = new Promise<void>((res) => proc.once('exit', () => res()))
  await run.app.evaluate(({ app }) => app.quit()).catch(() => undefined)
  await done
}
const quitLog = (run: Running) => (existsSync(join(run.userData, 'quit.log')) ? readFileSync(join(run.userData, 'quit.log'), 'utf8') : '')
const screen = (run: Running) => run.app.evaluate(() => (globalThis as unknown as { cnScreen: string[] }).cnScreen)

// ---------------------------------------------------------------- 写不进去另存：只有一个落盘目标

for (const then of ['退出', '先提交再退出'] as const)
  test(`写不进去另存后：标签跟到另存那篇、标明「原文件写不进去，字在这里」；在那篇接着写、${then}，字都在另存那篇，原文件一字不动`, async () => {
    const run = await launch({ '随手记.md': '# 随手记\n\n正文。\n' }, { CN_AI_FAKE: '1' })
    const { page, vault } = run
    const file = join(vault, '随手记.md')
    try {
      await shotTone(page)
      const toasts = await recordToasts(page)
      await openNote(page, '随手记')
      const tabs = await page.locator('.tab').count()
      // 像别的程序把这个文件锁成只读
      chmodSync(file, 0o444)
      await typeAtEnd(page, '锁上以后打的。')
      const toast = page.getByTestId('toast')
      await expect(toast).toContainText('「随手记」写不进去', { timeout: 10_000 })
      // 标签跟到另存那篇，标明原文件写不进去
      await expect(tabOn(page)).toHaveText(/^随手记（没存上的字 \d\d-\d\d）$/)
      await expect(acts(page).getByTestId('page-note')).toHaveText('原文件写不进去，字在这里')
      // 原来那篇的标签换成了另存那篇，没多出一个标签
      await expect(page.locator('.tab')).toHaveCount(tabs)
      const copy = allFiles(vault).find((f) => f.includes('没存上的字'))!
      expect(copy).toMatch(/^随手记（没存上的字 \d\d-\d\d）\.md$/)
      // 字已经在另存那篇里了：底栏不说「没存上」，那篇是新文件、没提交
      await expect(saveState(page)).toHaveAttribute('data-state', 'saved', { timeout: 10_000 })
      await expect(page.getByTestId('git-changed')).toContainText('没提交')
      await shotWindow(run, 'r6-rescued-tab')
      // 照提示点「打开另存的」：还是这一个标签
      await toast.getByRole('button', { name: '打开另存的' }).click()
      await expect(page.locator('.tab')).toHaveCount(tabs)
      await expect(tabOn(page)).toHaveText(/^随手记（没存上的字 \d\d-\d\d）$/)
      await typeAtEnd(page, '在另存的那篇里接着写的一大段。')
      await expect(saveState(page)).toHaveAttribute('data-state', 'saved', { timeout: 10_000 })
      expect(readFileSync(join(vault, copy), 'utf8')).toBe('# 随手记\n\n正文。\n锁上以后打的。在另存的那篇里接着写的一大段。')
      if (then === '先提交再退出') {
        await gitAct(page, '提交')
        await expect(page.getByTestId('git-changed')).toHaveText('都提交了', { timeout: 10_000 })
        expect(git(vault, 'show', `HEAD:${copy}`)).toContain('在另存的那篇里接着写的一大段。')
      }
      expect((await toasts()).filter((t) => /外面|冲突/.test(t))).toEqual([])
      await quit(run)
      expect(readFileSync(join(vault, copy), 'utf8')).toBe('# 随手记\n\n正文。\n锁上以后打的。在另存的那篇里接着写的一大段。')
      expect(readFileSync(file, 'utf8')).toBe('# 随手记\n\n正文。\n')
      expect(withText(vault, '在另存的那篇里接着写')).toEqual([copy])
      expect(git(vault, 'status', '--porcelain')).toBe('')
      // 字都在另存那篇里，退出时如实记存完，记下另存到了哪
      expect(quitLog(run)).toMatch(/存完（原文件写不进去，字在另存的那篇：随手记\.md → 随手记（没存上的字 \d\d-\d\d）\.md）/)
    } finally {
      chmodSync(file, 0o644)
      await run.close().catch(() => undefined)
    }
  })

test('另存以后另存那篇也写不进去了（盘满了）：不再另存第三篇，标签和底栏写「写不进去，字只在内存里」、字备份进设置目录；腾出空间后接着打，字存回另存那篇', async () => {
  const run = await launch({ '随手记.md': '# 随手记\n\n正文。\n' }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  const file = join(vault, '随手记.md')
  const locked: string[] = []
  try {
    await openNote(page, '随手记')
    chmodSync(file, 0o444)
    await typeAtEnd(page, '锁上以后打的。')
    await expect(acts(page).getByTestId('page-note')).toHaveText('原文件写不进去，字在这里', { timeout: 10_000 })
    await expect(saveState(page)).toHaveAttribute('data-state', 'saved', { timeout: 10_000 })
    const copy = allFiles(vault).find((f) => f.includes('没存上的字'))!
    // 盘满了：另存那篇、库最外层都写不进去
    for (const p of [join(vault, copy), vault]) {
      chmodSync(p, p.endsWith('.md') ? 0o444 : 0o555)
      locked.push(p)
    }
    await typeAtEnd(page, '盘满以后打的。')
    await expect(saveState(page)).toHaveAttribute('data-state', 'failed', { timeout: 4000 })
    await expect(page.getByTestId('git-changed')).toHaveText('1篇写不进去，字只在内存里')
    expect(allFiles(vault).filter((f) => f.includes('没存上的字'))).toEqual([copy])
    const stashDir = join(run.userData, '没存上的字')
    await expect.poll(() => (existsSync(stashDir) ? readdirSync(stashDir).map((f) => readFileSync(join(stashDir, f), 'utf8')) : [])).toEqual(['# 随手记\n\n正文。\n锁上以后打的。盘满以后打的。'])
    // 腾出空间：再打一个字就存回另存那篇，红字消失
    for (const p of locked) chmodSync(p, p.endsWith('.md') ? 0o644 : 0o755)
    await typeAtEnd(page, '腾出空间以后打的。')
    await expect(saveState(page)).toHaveAttribute('data-state', 'saved', { timeout: 10_000 })
    await expect(page.getByTestId('git-changed')).not.toContainText('写不进去')
    expect(readFileSync(join(vault, copy), 'utf8')).toBe('# 随手记\n\n正文。\n锁上以后打的。盘满以后打的。腾出空间以后打的。')
    expect(readFileSync(file, 'utf8')).toBe('# 随手记\n\n正文。\n')
  } finally {
    for (const p of locked) chmodSync(p, p.endsWith('.md') ? 0o644 : 0o755)
    chmodSync(file, 0o644)
    await run.close().catch(() => undefined)
  }
})

test('原文件和旁边、库最外层都写不进去（像盘满了）：标签和底栏马上写「写不进去，字只在内存里」，字备份进设置目录；⌘Q 先要确认，「先不退出」不退，「仍然退出」才退', async () => {
  const run = await launch({ '随手记.md': '# 随手记\n\n正文。\n', '甲/乙/深处.md': '# 深处\n\n第一行。\n' }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  const file = join(vault, '甲/乙/深处.md')
  const locked = [file, join(vault, '甲/乙'), vault]
  try {
    await shotTone(page)
    await openNote(page, '深处')
    chmodSync(file, 0o444)
    chmodSync(join(vault, '甲/乙'), 0o555)
    chmodSync(vault, 0o555)
    await typeAtEnd(page, '锁上以后打的。')
    await expect(saveState(page)).toHaveAttribute('data-state', 'failed', { timeout: 4000 })
    await expect(saveState(page)).toHaveText('写不进去，字只在内存里')
    await expect(page.getByTestId('git-changed')).toHaveText('1篇写不进去，字只在内存里')
    await expect(page.getByTestId('toast')).toContainText('字只在内存里')
    // 标签还是原来那篇（没另存成）
    await expect(tabOn(page)).toHaveText('深处')
    // 字备份进软件自己的设置目录
    const stashDir = join(run.userData, '没存上的字')
    await expect.poll(() => (existsSync(stashDir) ? readdirSync(stashDir) : []).length).toBe(1)
    const stash = join(stashDir, readdirSync(stashDir)[0]!)
    expect(readFileSync(stash, 'utf8')).toContain('第一行。\n锁上以后打的。')
    await shotWindow(run, 'r6-stranded')
    // 底栏弹层说清楚，点那一篇在访达里显示备份
    await page.getByTestId('git-changed').click()
    const pop = page.getByRole('dialog', { name: '没提交的改动' })
    await expect(pop).toContainText('写不进去 · 字只在内存里')
    await pop.getByRole('menuitem', { name: /甲\/乙\/深处\.md/ }).click()
    await expect.poll(() => screen(run)).toContain(`在访达中显示 ${stash}`)
    // 再打几个字：备份跟着更新，还是同一个文件
    await typeAtEnd(page, '又打的。')
    await expect.poll(() => readFileSync(stash, 'utf8')).toContain('锁上以后打的。又打的。')
    expect(readdirSync(stashDir)).toHaveLength(1)
    // ⌘Q：先弹确认（测试模式下回「先不退出」），不退
    await run.app.evaluate(({ app }) => app.quit())
    await expect.poll(() => screen(run)).toContain('提示框：有 1 篇写不进去，字只在内存里')
    await page.waitForTimeout(1500)
    expect(run.app.process().exitCode).toBeNull()
    await expect(saveState(page)).toHaveText('写不进去，字只在内存里')
    expect(await editorText(page)).toContain('锁上以后打的。又打的。')
    expect(quitLog(run)).toMatch(/没退出/)
    // 用户点「仍然退出」
    await run.app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox
    })
    await quit(run)
    expect(quitLog(run)).toMatch(/没存好：甲\/乙\/深处\.md 写不进去，字只在内存里/)
    expect(quitLog(run)).not.toMatch(/存完/)
    expect(readFileSync(stash, 'utf8')).toContain('锁上以后打的。又打的。')
  } finally {
    for (const p of locked) chmodSync(p, p.endsWith('.md') ? 0o644 : 0o755)
    await run.close().catch(() => undefined)
  }
})

// 设计复审：A 风格底栏是彩色一条（天青、深湖）时「写不进去」那一项红底白字；中间窄于 900 时红字整句不截；另存说明用 --t2
for (const skin of ['sky', 'petrol'] as const)
  test(`写不进去的样子（A · ${skin}）：底栏那一项红底白字 ≥ 4.5，右栏开着中间变窄时标签条上的红字整句不截，另存那句是 --t2`, async () => {
    const run = await launch({ '随手记.md': '# 随手记\n\n正文。\n', '甲/深处.md': '# 深处\n\n第一行。\n' }, { CN_AI_FAKE: '1' }, (vault) => {
      const ud = join(vault, '../user-data')
      mkdirSync(ud, { recursive: true })
      writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin, frame: 'a', homeStyle: 'a' } }))
    })
    const { page, vault } = run
    const locked = [join(vault, '随手记.md'), join(vault, '甲/深处.md'), join(vault, '甲'), vault]
    try {
      await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1100, 760))
      await rail(page).getByRole('button', { name: '网页', exact: true }).click()
      // 先只锁原文件：另存成一篇，标签上那句说明是 --t2
      await openNote(page, '随手记')
      chmodSync(locked[0]!, 0o444)
      await typeAtEnd(page, '锁上以后打的。')
      const note = acts(page).getByTestId('page-note')
      await expect(note).toHaveText('原文件写不进去，字在这里', { timeout: 10_000 })
      const colors = await note.evaluate((el) => {
        const probe = document.createElement('span')
        probe.style.color = 'var(--t2)'
        el.parentElement!.appendChild(probe)
        const t2 = getComputedStyle(probe).color
        probe.remove()
        return { note: getComputedStyle(el).color, t2 }
      })
      expect(colors.note).toBe(colors.t2)
      // 再锁到哪都写不进去
      for (const p of locked.slice(1)) chmodSync(p, p.endsWith('.md') ? 0o444 : 0o555)
      await openNote(page, '深处')
      await typeAtEnd(page, '盘满以后打的。')
      const st = saveState(page)
      await expect(st).toHaveText('写不进去，字只在内存里', { timeout: 4000 })
      expect(await page.locator('.center').evaluate((el) => el.getBoundingClientRect().width)).toBeLessThan(900)
      const cut = await st.evaluate((el) => ({ full: el.scrollWidth, shown: el.clientWidth }))
      expect(cut.shown).toBeGreaterThanOrEqual(cut.full)
      // 底栏：红底白字，没有红点
      const bar = page.getByTestId('git-changed')
      await expect(bar).toHaveText('1篇写不进去，字只在内存里')
      const m = await bar.evaluate((el) => {
        const lum = (c: string) => {
          const [r, g, b] = c.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number).map((v) => {
            v /= 255
            return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
          })
          return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
        }
        const bg = getComputedStyle(el).backgroundColor
        const fg = getComputedStyle(el.querySelector('.num')!).color
        const [a, b] = [lum(fg), lum(bg)]
        return { bg, fg, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), dot: getComputedStyle(el.querySelector('.gdot')!).display }
      })
      expect(m.fg).toBe('rgb(255, 255, 255)')
      expect(m.ratio).toBeGreaterThanOrEqual(4.5)
      expect(m.dot).toBe('none')
      await shotWindow(run, `r6-stranded-a-${skin}`)
    } finally {
      for (const p of locked) chmodSync(p, p.endsWith('.md') ? 0o644 : 0o755)
      await run.close().catch(() => undefined)
    }
  })

// ---------------------------------------------------------------- 梦游：刚打完字就收下、全部收下碰到冲突

const dreamPanel = (page: Page) => page.getByRole('complementary', { name: '梦游报告' })
async function dreamNow(page: Page) {
  await leftView(page, '梦游报告')
  await dreamPanel(page).getByRole('button', { name: '现在梦游' }).click()
  await expect(dreamPanel(page).getByTestId('dream-summary')).toContainText('整理了', { timeout: 60_000 })
}
const conflictCopies = (vault: string) => allFiles(vault).filter((f) => f.includes('冲突'))

for (const how of ['全部收下', '单条收下双链'] as const)
  test(`梦游：在《极光》末尾打完字 0.2 秒内点「${how}」：打的字和双链都进笔记，不另出冲突副本、不说「外面改了」，报告和笔记对得上`, async () => {
    const run = await launch({ ...DREAM_VAULT }, { CN_AI_FAKE: '1' })
    const { page, vault } = run
    try {
      await shotTone(page)
      const toasts = await recordToasts(page)
      await openNote(page, '极光')
      await dreamNow(page)
      const link = dreamPanel(page).getByTestId('dream-item').filter({ hasText: /^极光\s*↔/ })
      // 点一条中间开它（task-m552v）：回到那篇的标签接着打字，再在左栏小卡里点收下
      if (how === '单条收下双链') {
        await link.click()
        await page.locator('[role="tab"][data-path="收件箱/极光.md"]').click()
      }
      await typeAtEnd(page, '维克的黑沙滩也能看。')
      const t = Date.now()
      if (how === '全部收下') await dreamPanel(page).getByRole('button', { name: '全部收下' }).click()
      else await dreamPanel(page).getByTestId('dream-detail').getByRole('button', { name: '收下', exact: true }).click()
      expect(Date.now() - t).toBeLessThan(200)
      if (how === '全部收下') await expect(page.getByTestId('toast')).toContainText('剩下的都收下了', { timeout: 20_000 })
      else await expect(link.locator('.st')).toHaveText('已收下', { timeout: 20_000 })
      const at = how === '全部收下' ? '剪藏/旅行/极光.md' : '收件箱/极光.md'
      await expect.poll(() => (existsSync(join(vault, at)) ? readFileSync(join(vault, at), 'utf8') : '')).toMatch(/维克的黑沙滩也能看。[\s\S]*相关：\[\[极光预报\]\]/)
      await expect(saveState(page)).toHaveAttribute('data-state', 'saved', { timeout: 10_000 })
      await expect.poll(() => editorText(page)).toMatch(/维克的黑沙滩也能看。[\s\S]*相关：\[\[极光预报\]\]/)
      await page.waitForTimeout(1500)
      expect(conflictCopies(vault)).toEqual([])
      expect((await toasts()).filter((x) => /外面|冲突|不在了/.test(x))).toEqual([])
      await shotWindow(run, `r6-dream-type-then-${how === '全部收下' ? 'takeall' : 'take'}`)
      await quit(run)
      expect(readFileSync(join(vault, at), 'utf8')).toMatch(/维克的黑沙滩也能看。[\s\S]*相关：\[\[极光预报\]\]/)
      expect(conflictCopies(vault)).toEqual([])
      expect(git(vault, 'status', '--porcelain')).toBe('')
    } finally {
      await run.close().catch(() => undefined)
    }
  })

test('梦游：在《极光》末尾添了一句、等自动保存后点「全部收下」：两边都只往末尾加一行算合得上，6 条都收下', async () => {
  const run = await launch({ ...DREAM_VAULT }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await openNote(page, '极光')
    await dreamNow(page)
    await typeAtEnd(page, '维克的黑沙滩也能看。')
    await expect(saveState(page)).toHaveAttribute('data-state', 'saved', { timeout: 10_000 })
    await page.waitForTimeout(2000)
    await dreamPanel(page).getByRole('button', { name: '全部收下' }).click()
    await expect(page.getByTestId('toast')).toContainText('剩下的都收下了', { timeout: 20_000 })
    await expect(dreamPanel(page).getByTestId('dream-left')).toContainText('都看完了')
    expect(readFileSync(join(vault, '剪藏/旅行/极光.md'), 'utf8')).toMatch(/维克的黑沙滩也能看。[\s\S]*相关：\[\[极光预报\]\]/)
    expect(conflictCopies(vault)).toEqual([])
  } finally {
    await run.close()
  }
})

test('梦游：《极光》在外面删了再点「全部收下」：能收的都收，极光那两条留着、列表上标出来，提示点名是哪条、为什么', async () => {
  const run = await launch({ ...DREAM_VAULT }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await shotTone(page)
    await dreamNow(page)
    rmSync(join(vault, '收件箱/极光.md'))
    await page.waitForTimeout(1000)
    await dreamPanel(page).getByRole('button', { name: '全部收下' }).click()
    const toast = page.getByTestId('toast')
    await expect(toast).toContainText('收下了', { timeout: 20_000 })
    await expect(toast).toContainText('「极光」')
    await expect(toast).toContainText('删了')
    // 能收的都收了：冰洞、巴黎挪走，周记写了
    expect(existsSync(join(vault, '剪藏/旅行/冰洞.md'))).toBe(true)
    expect(existsSync(join(vault, '剪藏/旅行/巴黎自由行全景指南.md'))).toBe(true)
    expect(allFiles(vault).some((f) => f.startsWith('周记/'))).toBe(true)
    // 极光那两条留着待看，列表上标出为什么
    await expect(dreamPanel(page).getByTestId('dream-left')).toContainText('还剩2条')
    await expect(dreamPanel(page).getByTestId('dream-conflict')).toHaveCount(2)
    await expect(dreamPanel(page).getByTestId('dream-conflict').first()).toContainText('删了')
    await shotWindow(run, 'r6-dream-takeall-partial')
    expect(git(vault, 'status', '--porcelain')).toBe('')
    expect(existsSync(join(vault, '.git/CHERRY_PICK_HEAD'))).toBe(false)
  } finally {
    await run.close()
  }
})

test('收下《冰洞》后在外面改名成「冰岛冰洞」、同时把「提前两周订」改成「提前三周订」，再点「撤回」：说「改名成了「冰岛冰洞」」，不说「被删了」', async () => {
  const run = await launch({ ...DREAM_VAULT }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await dreamNow(page)
    await dreamPanel(page).getByTestId('dream-item').filter({ hasText: /^冰洞\s*从/ }).click()
    await dreamPanel(page).getByTestId('dream-detail').getByRole('button', { name: '收下', exact: true }).click()
    // 收下的提示在底栏，带「在历史里看」「撤回」（task-m552v：不再有中间上浮的预览提示条）
    const pv = page.getByTestId('toast')
    await expect(pv).toContainText('收下了「冰洞」')
    const taken = join(vault, '剪藏/旅行/冰洞.md')
    await expect.poll(() => existsSync(taken)).toBe(true)
    const renamed = join(vault, '剪藏/旅行/冰岛冰洞.md')
    writeFileSync(renamed, readFileSync(taken, 'utf8').replace('提前两周订', '提前三周订'))
    rmSync(taken)
    await page.waitForTimeout(2500)
    await pv.getByRole('button', { name: /撤回/ }).click()
    await expect(page.getByTestId('toast')).toContainText('撤回不了：「冰洞」收下以后改名成了「冰岛冰洞」，什么都没动')
    expect(existsSync(renamed)).toBe(true)
  } finally {
    await run.close()
  }
})

// ---------------------------------------------------------------- 地址栏：局域网地址直接打开

test('右栏地址栏打局域网地址（192.168.1.1、10.0.0.5:5000、nas.local）：直接用 http 打开，不拿去 Google 搜', async () => {
  const run = await launchCounted({ 'a.md': '# a\n' }, { ...tempHome() })
  const { page } = run
  const web = page.getByRole('complementary', { name: '网页' })
  try {
    await rail(page).getByRole('button', { name: '网页', exact: true }).click()
    await expect(web).toBeVisible()
    for (const [typed, url] of [
      ['192.168.1.1', 'http://192.168.1.1/'],
      ['10.0.0.5:5000', 'http://10.0.0.5:5000/'],
      ['172.20.1.2/admin', 'http://172.20.1.2/admin'],
      ['nas.local', 'http://nas.local/'],
    ] as const) {
      const mark = await netMark(run)
      const addr = web.getByRole('textbox', { name: '网址' })
      await addr.fill(typed)
      await addr.press('Enter')
      // 等这一页真的连出去（代理收到 GET、回了 502）再打下一个：不然下一个网址打进去时这一页还在载入
      await expect.poll(async () => (await netSince(run, mark)).join(' '), { timeout: 10_000 }).toContain(`GET ${url} HTTP/1.1`)
      expect((await netSince(run, mark)).filter((s) => s.includes('google')), typed).toEqual([])
    }
  } finally {
    await run.close()
  }
})
