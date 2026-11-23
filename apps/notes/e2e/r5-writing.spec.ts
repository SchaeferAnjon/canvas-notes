/**
 * 发版前第 5 轮（实用 · 写作区）找出来的问题：每条一个测试，真点、真按（←、↓、Home、退格、Delete、Ctrl+D）、真打字。
 */
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acts, launch, openNote, pane, slowDisk, waitSaved, type Running } from './app'
import { ICELAND } from './fixtures/board'

const vaultGit = (vault: string, args: string[]) => execFileSync('git', ['-C', vault, ...args], { encoding: 'utf8' }).trim()
const read = (run: Running, rel: string) => readFileSync(join(run.vault, rel), 'utf8')
const content = (page: Page) => pane(page).locator('.cm-content')
const line = (page: Page, text: string) => pane(page).locator('.cm-line', { hasText: text })

/** 点在某一行最左边（行首） */
async function clickLineStart(page: Page, text: string) {
  const b = (await line(page, text).boundingBox())!
  await page.mouse.click(b.x + 2, b.y + b.height / 2)
}

/** 白板（新写法）：空白处三张卡，前面各一行位置 */
const BOARD = (c1: string) => `---\ntype: board\n---\n<!-- card id=c0 x=0 y=80 -->\n十一月\n\n<!-- card id=c1 x=300 y=80 -->\n${c1}\n\n<!-- card id=c2 x=600 y=80 -->\n想写的\n`

test('白板上改卡时外面改了同一张卡：存下时留我的版本，外面那版存成冲突副本，底栏说清楚；外面改的是别的卡就合在一起', async () => {
  const run = await launch({ '写作/写作计划.md': BOARD('十二月'), '写作/另一块.md': BOARD('十二月') })
  const { page, vault } = run
  const copies = () => readdirSync(join(vault, '写作')).filter((f) => f.includes('冲突'))
  try {
    for (const how of ['Esc', '点空白'] as const) {
      // 每次从干净的开头来
      writeFileSync(join(vault, '写作/写作计划.md'), BOARD('十二月'))
      for (const f of copies()) rmSync(join(vault, '写作', f))
      await openNote(page, '写作计划').catch(() => {})
      await acts(page).getByRole('tab', { name: '白板' }).click()
      const board = pane(page).getByTestId('doc-board')
      await expect(board.locator('.db-card[data-id="c1"]')).toContainText('十二月')
      await board.locator('.db-card[data-id="c1"]').dblclick()
      const box = pane(page).getByRole('textbox', { name: '卡片内容' })
      await expect(box).toBeFocused()
      await page.keyboard.press('End')
      await page.keyboard.type('我' + how)
      // 外面（同步盘、另一台机器）改了同一张卡
      writeFileSync(join(vault, '写作/写作计划.md'), BOARD('十二月外面' + how))
      await page.waitForTimeout(2000)
      if (how === 'Esc') await page.keyboard.press('Escape')
      else {
        const b = (await board.locator('.board-wrap').boundingBox())!
        await page.mouse.click(b.x + b.width - 40, b.y + b.height - 40)
      }
      await expect(box).toHaveCount(0)
      await expect.poll(() => read(run, '写作/写作计划.md')).toContain(`\n十二月我${how}\n`)
      await expect.poll(copies).toHaveLength(1)
      expect(read(run, `写作/${copies()[0]}`)).toContain(`\n十二月外面${how}\n`)
      // 白板自己底部那条提示（标签还开着；关标签、退出时存回去的才说在软件底栏）
      await expect(board.locator('.db-toast')).toContainText(`外面改了《写作计划》的同一段：留了你的版本，外面那版存成《${copies()[0]!.replace(/\.md$/, '')}》`)
    }

    // 外面改的是别的卡：两边都留住，说一句合在一起了
    await openNote(page, '另一块').catch(() => {})
    await acts(page).getByRole('tab', { name: '白板' }).click()
    const board = pane(page).getByTestId('doc-board')
    await board.locator('.db-card[data-id="c1"]').dblclick()
    await page.keyboard.press('End')
    await page.keyboard.type('我的')
    writeFileSync(join(vault, '写作/另一块.md'), BOARD('十二月').replace('\n想写的\n', '\n想写的外面\n'))
    await expect(board.locator('.db-card[data-id="c2"]')).toContainText('想写的外面')
    await page.keyboard.press('Escape')
    await expect.poll(() => read(run, '写作/另一块.md')).toBe(BOARD('十二月我的').replace('\n想写的\n', '\n想写的外面\n'))
    await expect(board.locator('.db-toast')).toContainText('外面也改过《另一块》，已经合并进来')
    expect(copies()).toHaveLength(1)
  } finally {
    await run.close()
  }
})

test('属性下面第一段摆在白板上：段首 ← 再打字、退格两下，属性和位置行原样，屏上不露 created、---', async () => {
  const NOTE = '---\ncreated: 2026-11-17 10:00\n---\n<!-- card id=d1 x=825 y=778 -->\n属性下面第一段。\n\n第二段。\n'
  const run = await launch({ '属性.md': NOTE })
  const { page } = run
  try {
    await openNote(page, '属性')
    const b = (await line(page, '属性下面第一段').boundingBox())!
    await page.mouse.click(b.x + 40, b.y + b.height / 2)
    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.type('Y')
    await waitSaved(page)
    expect(read(run, '属性.md')).toBe(NOTE.replace('属性下面', 'Y属性下面'))
    await page.keyboard.press('Home')
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Backspace')
    await page.keyboard.type('Z')
    await waitSaved(page)
    expect(read(run, '属性.md')).toBe(NOTE.replace('属性下面', 'ZY属性下面'))
    await expect(content(page)).not.toContainText('created')
    await expect(content(page)).not.toContainText('---')
    await expect(content(page)).not.toContainText('<!--')
  } finally {
    await run.close()
  }
})

test('上一段末尾按 Delete、Ctrl+D，空行上按 Delete，没有标题时第一段段首退格：位置行不被删掉，并段时挪到并好的那段前面', async () => {
  const LINE = '<!-- card id=d2 x=900 y=200 -->'
  const NOTE = (t: string) => `# ${t}\n\n第一段卡片。\n\n第二段卡片。\n\n${LINE}\n收尾一段。\n`
  const FIRST = '<!-- card id=d1 x=1 y=2 -->\n没有标题的第一段。\n\n第二段。\n'
  const run = await launch({ '删除键.md': NOTE('删除键'), '控制D.md': NOTE('控制D'), '空行.md': NOTE('空行'), '开头.md': FIRST })
  const { page } = run
  try {
    for (const [name, key] of [
      ['删除键', 'Delete'],
      ['控制D', 'Control+d'],
    ] as const) {
      await openNote(page, name)
      await line(page, '第二段卡片').click()
      await page.keyboard.press('End')
      await page.keyboard.press(key)
      await waitSaved(page)
      expect(read(run, `${name}.md`)).toBe(`# ${name}\n\n第一段卡片。\n\n第二段卡片。\n${LINE}\n收尾一段。\n`)
      await page.keyboard.press(key)
      await waitSaved(page)
      expect(read(run, `${name}.md`)).toBe(`# ${name}\n\n第一段卡片。\n\n${LINE}\n第二段卡片。收尾一段。\n`)
      await expect(content(page)).not.toContainText('<!--')
    }
    // 空行上 Delete（段尾 → 一下到两段中间的空行；位置行藏在这一行后面）：空行没了，位置行还在，光标到「收尾一段」段首
    await openNote(page, '空行')
    await line(page, '第二段卡片').click()
    await page.keyboard.press('End')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Delete')
    await page.keyboard.type('X')
    await waitSaved(page)
    expect(read(run, '空行.md')).toBe(`# 空行\n\n第一段卡片。\n\n第二段卡片。\n${LINE}\nX收尾一段。\n`)
    // 没有标题、第一段摆在白板上：段首退格一下，什么都不删
    await openNote(page, '开头')
    await clickLineStart(page, '没有标题的第一段')
    await page.keyboard.press('Backspace')
    await page.keyboard.type('W')
    await waitSaved(page)
    expect(read(run, '开头.md')).toBe(FIRST.replace('没有标题', 'W没有标题'))
    await expect(content(page)).not.toContainText('<!--')
  } finally {
    await run.close()
  }
})

test('展开的折叠块：后面那段段首退格三下，</details> 不丢；前面有位置行时从上一段 ↓ 两下打字进标题；多行标题都在标题条里', async () => {
  const FOLD = '# 折叠退格\n\n<details>\n<summary>标题甲</summary>\n\n第一段里面。\n\n</details>\n\n后面一段。\n'
  const PLACED = '# 折叠下移\n\n第一段。\n\n<!-- card id=d3 x=1 y=2 -->\n<details>\n<summary>收着的标题</summary>\n\n里面。\n\n</details>\n\n后面。\n'
  const MULTI = '# 多行标题\n\n<details>\n<summary>\n多行的\n标题\n</summary>\n\n第一段里面。\n\n</details>\n'
  const run = await launch({ '折叠退格.md': FOLD, '折叠下移.md': PLACED, '多行标题.md': MULTI })
  const { page } = run
  // 真点标题条（按下、松手）：只派一个 mousedown 不松手的话，文档拉框（task-5ryf9）一直等着松手，下一次挪鼠标就当成拉框，后面的点不进字里
  const expand = async () => {
    await pane(page).locator('.cm-fold-head').first().click()
    await expect(pane(page).locator('.cm-fold-headline').first()).toBeVisible()
  }
  try {
    await openNote(page, '折叠退格')
    await expand()
    await clickLineStart(page, '后面一段')
    for (let i = 0; i < 3; i++) await page.keyboard.press('Backspace')
    await page.keyboard.type('Z')
    await waitSaved(page)
    expect(read(run, '折叠退格.md')).toBe(FOLD.replace('</details>\n\n后面一段', '</details>\nZ后面一段'))
    await expect(content(page)).not.toContainText('<details>')
    await expect(content(page)).not.toContainText('summary')

    await openNote(page, '折叠下移')
    await expand()
    await line(page, '第一段。').click()
    await page.keyboard.press('End')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.type('Q')
    await waitSaved(page)
    const got = read(run, '折叠下移.md')
    expect(got).toContain('<!-- card id=d3 x=1 y=2 -->\n<details>\n<summary>')
    expect(got.replace('Q', '')).toBe(PLACED)
    await expect(content(page)).not.toContainText('<details>')

    await openNote(page, '多行标题')
    await expand()
    // 两行字都在标题条里（同一种底色的行），不落在块外
    await expect(pane(page).locator('.cm-fold-headline')).toHaveCount(2)
    await expect(pane(page).locator('.cm-fold-headline').nth(1)).toHaveText('标题')
    const head = (await pane(page).locator('.cm-fold-headline').first().boundingBox())!
    const more = (await pane(page).locator('.cm-fold-headline').nth(1).boundingBox())!
    expect(Math.abs(more.y - (head.y + head.height))).toBeLessThan(1)
    expect(more.x).toBe(head.x)
  } finally {
    await run.close()
  }
})

test('盘慢时：新建的笔记还在按标题改名，再点「新建笔记」开一个新标签、新文件，不复用上一篇；两篇的字各在各的文件里，没有冲突副本', async () => {
  // 库里有十几篇：按标题改名后要挨篇读一遍改双链，盘慢时（读一次 0.6 秒）改名落到盘上以后还要好几秒才做完、标签才换名字
  const many = Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`项目/笔记${i}.md`, `# 笔记${i}\n\n第${i}篇。\n`]))
  const run = await launch({ '项目/说明.md': '# 说明\n', ...many })
  const { page, vault } = run
  const inbox = () => (existsSync(join(vault, '收件箱')) ? readdirSync(join(vault, '收件箱')).sort() : [])
  const newBtn = page.locator('aside.side .vh').getByRole('button', { name: '新建笔记' })
  const noteTabs = page.getByTestId('tab-list').getByRole('tab')
  try {
    await slowDisk(run, { write: 1500, read: 600 })
    const before = await noteTabs.count()
    await newBtn.click()
    await expect(noteTabs).toHaveCount(before + 1, { timeout: 10_000 })
    await expect(content(page)).toBeFocused({ timeout: 10_000 })
    await page.keyboard.type('甲标题')
    await page.keyboard.press('Enter')
    await page.keyboard.type('甲正文')
    // 改名已经落到盘上，标签可能还没换名字（盘慢）
    await expect.poll(inbox, { timeout: 20_000 }).toContain('甲标题.md')
    await newBtn.click()
    await expect(noteTabs).toHaveCount(before + 2, { timeout: 15_000 })
    await expect(content(page)).toBeFocused({ timeout: 10_000 })
    await page.keyboard.type('乙标题')
    await page.keyboard.press('Enter')
    await page.keyboard.type('乙正文')
    await expect.poll(inbox, { timeout: 40_000 }).toEqual(['乙标题.md', '甲标题.md'])
    await expect.poll(() => read(run, '收件箱/甲标题.md'), { timeout: 40_000 }).toContain('甲正文')
    await expect.poll(() => read(run, '收件箱/乙标题.md'), { timeout: 40_000 }).toContain('乙正文')
    expect(read(run, '收件箱/甲标题.md')).not.toContain('乙')
    expect(read(run, '收件箱/乙标题.md')).not.toContain('甲')
    await expect(page.getByTestId('tab-list').getByRole('tab', { name: /甲标题/ })).toHaveCount(1, { timeout: 30_000 })
    await expect(page.getByTestId('tab-list').getByRole('tab', { name: /乙标题/ })).toHaveCount(1, { timeout: 30_000 })
    expect(inbox().some((f) => f.includes('冲突') || f.startsWith('未命名'))).toBe(false)
  } finally {
    await run.close()
  }
})

test('盘慢时点「新建笔记」马上打字：字进新笔记的标题，不进原来那篇；建的时候按钮是「正在建」的样子', async () => {
  const run = await launch({ '日记.md': '# 日记\n\n今天下雪了。\n' })
  const { page } = run
  const newBtn = page.locator('aside.side .vh').getByRole('button', { name: '新建笔记' })
  try {
    await openNote(page, '日记')
    await line(page, '今天下雪了').click()
    await page.keyboard.press('End')
    await slowDisk(run, { write: 600, read: 600 })
    await newBtn.click()
    await expect(newBtn).toHaveAttribute('aria-busy', 'true')
    await page.waitForTimeout(250)
    await page.keyboard.type('六百毫秒标题')
    await expect(newBtn).not.toHaveAttribute('aria-busy', 'true', { timeout: 10_000 })
    await expect(line(page, '六百毫秒标题')).toBeVisible({ timeout: 10_000 })
    await page.keyboard.press('Enter')
    await page.keyboard.type('接着写')
    await expect.poll(() => (existsSync(join(run.vault, '收件箱/六百毫秒标题.md')) ? read(run, '收件箱/六百毫秒标题.md') : ''), { timeout: 20_000 }).toContain('接着写')
    expect(read(run, '日记.md')).toBe('# 日记\n\n今天下雪了。\n')
  } finally {
    await run.close()
  }
})

test('AI 存卡提交没成功，别处又打了字：「再提交一次」只提交 AI 改的那篇、用「AI：」说明，成功后照样能撤回；又没成写「第2次也没提交上」', async () => {
  const run = await launch({ '冰岛自驾.md': ICELAND, '日记.md': '# 日记\n\n今天。\n' }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  const ai = page.getByRole('complementary', { name: 'AI 对话' })
  try {
    writeFileSync(join(vault, '.git/index.lock'), '')
    await page.locator('.nav .si', { hasText: '冰岛自驾' }).click()
    await page.getByRole('button', { name: '打开 AI' }).click()
    const box = ai.getByRole('textbox', { name: '问 AI' })
    await box.fill('/总结这块白板')
    await box.press('Enter')
    const msg = ai.getByTestId('ai-msg').last()
    await expect(msg).toContainText('这块白板讲了三件事')
    await msg.getByRole('button', { name: '存成卡片' }).click()
    const warn = msg.getByTestId('ai-warn')
    await expect(warn.locator('.t')).toHaveText('卡存好了，提交没成功', { timeout: 15_000 })

    // 锁还在，点一下：又没成，看得出点过
    await warn.getByRole('button', { name: '再提交一次' }).click()
    await expect(warn.locator('.why')).toContainText('第2次也没提交上', { timeout: 15_000 })

    // 去日记打几个字（没提交的别处改动）
    await openNote(page, '日记')
    await line(page, '今天').click()
    await page.keyboard.press('End')
    await page.keyboard.type('下雪')
    await waitSaved(page)

    rmSync(join(vault, '.git/index.lock'))
    // AI 对话跟着地方走（D 组 CN-132）：回到白板那段对话里点「再提交一次」
    await page.locator('.tab', { hasText: '冰岛自驾' }).locator('.tl').click()
    await warn.getByRole('button', { name: '再提交一次' }).click()
    await expect(msg.locator('.done')).toHaveText('卡存好了，提交好了', { timeout: 15_000 })
    const change = msg.getByTestId('ai-change')
    await expect(change).toContainText('改了1个文件')
    expect(vaultGit(vault, ['log', '-1', '--format=%s'])).toBe('AI：/总结这块白板 · 冰岛自驾')
    expect(vaultGit(vault, ['show', '--name-only', '--format=', 'HEAD'])).toBe('冰岛自驾.md')
    // 日记的字还没提交，不在 AI 那次里
    expect(vaultGit(vault, ['status', '--porcelain'])).toContain('日记.md')

    // 撤回：卡从白板上拿掉
    await change.getByRole('button', { name: '撤回' }).click()
    await expect(change).toContainText('已撤回')
    expect(read(run, '冰岛自驾.md')).not.toContain('这块白板讲了三件事')
  } finally {
    await run.close()
  }
})

test('设置 › Git和同步：库里、全局都没有署名时不提全局设置；改署名时 Esc 只收起这一行，格式不对的原因写在输入框下面', async () => {
  const home = mkdtempSync(join(tmpdir(), 'cn-home-'))
  const noId = { HOME: home, XDG_CONFIG_HOME: join(home, '.config'), GIT_CONFIG_GLOBAL: join(home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1' }
  const run = await launch({ '日记.md': '# 日记\n' }, noId)
  const { page, vault } = run
  try {
    // 打开库时软件给库补了署名；拿掉它，哪儿都没有
    execFileSync('git', ['-C', vault, 'config', '--unset', 'user.name'])
    execFileSync('git', ['-C', vault, 'config', '--unset', 'user.email'])
    await page.keyboard.press('Meta+,')
    const dlg = page.getByRole('dialog', { name: '设置' })
    await dlg.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: 'Git和同步', exact: true }).click()
    const row = dlg.locator('[data-row="gitId"]')
    await expect(row).toContainText('还没有，提交会失败')
    await expect(row).toContainText('填上后写在这个库里')
    await expect(dlg).not.toContainText('全局设置')
    await row.getByRole('button', { name: '改' }).click()
    const form = dlg.getByRole('form', { name: '改提交署名' })
    await form.getByRole('textbox', { name: '署名的名字' }).fill('写作的我')
    await form.getByRole('textbox', { name: '署名的邮箱' }).fill('not-an-email')
    await form.getByRole('button', { name: '保存' }).click()
    await expect(dlg.getByRole('alert')).toContainText('邮箱要写成')
    await expect(form).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(form).toHaveCount(0)
    await expect(dlg).toBeVisible()
  } finally {
    await run.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('自动提交一直没成功（库里留着锁）：底栏「没提交」弹层写明自动提交没成功和原因；提交上了就不再挂着', async () => {
  const run = await launch({ '日记.md': '# 日记\n\n今天。\n' }, { CN_MINUTE_MS: '300' })
  const { page, vault } = run
  try {
    writeFileSync(join(vault, '.git/index.lock'), '')
    await openNote(page, '日记')
    await line(page, '今天').click()
    await page.keyboard.press('End')
    await page.keyboard.type('下雪')
    await waitSaved(page)
    // 自动提交每 10「分钟」= 3 秒一次：等它撞上锁
    await page.waitForTimeout(4500)
    await page.getByTestId('git-changed').click()
    const pop = page.getByRole('dialog', { name: '没提交的改动' })
    await expect(pop.getByTestId('autocommit-error')).toContainText('自动提交没成功', { timeout: 10_000 })
    await expect(pop.getByTestId('autocommit-error')).toContainText('Git锁文件')
    rmSync(join(vault, '.git/index.lock'))
    await expect.poll(() => vaultGit(vault, ['status', '--porcelain']), { timeout: 15_000 }).toBe('')
  } finally {
    await run.close()
  }
})
