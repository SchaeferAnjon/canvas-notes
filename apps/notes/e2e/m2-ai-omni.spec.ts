// 2026-11-19 用户：「我希望是默认直接全能模式。关掉『全能模式』开关后，它还能做到新建、改名、挪动、删除笔记」（task-n7uwo）
// - AI 输入框下面一行「全能模式」方角开关（照 Dispatch 输入框下面的权限那一行）：默认开，点一下切换，全局记住（重开软件还在），AI 对话和读 PDF 共用；
// - 关着：AI 用库里的笔记工具新建、改名（[[双链]] 跟着改）、挪动、删到废纸篓，步骤行写人话，一轮一次提交，能撤回；做不了的请用户打开全能模式；
// - 开着：AI 自己写的文件这一轮结束提交成「AI：…」，用户没提交的字先单独提交，答的时候编辑器里打的字不算进去。
// 一律无头（CN_E2E=1）、假 AI（CN_AI_FAKE=1）、临时库、临时设置目录。
import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import electronPath from 'electron'
import { editorText, launch, openAi, pane, tabOn, waitSaved } from './app'
import { LECTURE } from './fixtures/pdf'

const PDF = '课程/线代/第3讲.pdf'
const files = {
  '随手记.md': '# 随手记\n\n一段字。\n',
  '旅行.md': '# 旅行\n\n见 [[冰岛]]，计划在 [冰岛](冰岛.md)。\n',
  '冰岛.md': '# 冰岛\n\n极光。\n',
  '课程/线代/.gitkeep': '',
  [PDF]: LECTURE,
}

const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const reading = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })
const git = (vault: string, ...args: string[]) => execFileSync('git', ['-C', vault, ...args], { encoding: 'utf8' }).trim()
const lastSubject = (vault: string) => git(vault, 'log', '-1', '--format=%s')
const lastFiles = (vault: string, rev = 'HEAD') => git(vault, 'show', '--name-status', '--format=', rev).split('\n').filter(Boolean)

async function send(page: Page, text: string) {
  const box = chat(page).getByRole('textbox', { name: '问 AI' })
  await box.fill(text)
  await box.press('Enter')
}

/** 最后一条回答（等它答完：发送键回来） */
async function answered(page: Page) {
  await expect(chat(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 20_000 })
  return chat(page).getByTestId('ai-msg').last()
}

async function openPdf(page: Page) {
  await page.keyboard.press('Meta+k')
  await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
  await page.locator('.pal-row', { hasText: '第3讲' }).first().click()
  await expect(tabOn(page)).toHaveText('第3讲.pdf')
  await expect(page.locator('.pdfpane:not([hidden]) .pdfpage[data-page="1"] canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
}

async function openDoc(page: Page, name: string) {
  await page.keyboard.press('Meta+o')
  await page.keyboard.type(name)
  await page.keyboard.press('Enter')
  await expect(tabOn(page)).toHaveText(name)
  await expect(pane(page).locator('.cm-content')).toBeVisible()
}

test('全能模式开关：默认开着，悬停说清两种模式；点一下关上、引擎拿到的就是关着；重开软件还是关着；读 PDF 的 AI 是同一个开关', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await openAi(page)
    const sw = chat(page).getByRole('switch', { name: '全能模式' })
    await expect(sw).toHaveAttribute('aria-checked', 'true')
    await expect(chat(page).getByTestId('ai-omni')).toContainText('全能模式能读写这台Mac上的文件、跑命令、上网')
    // 开关在输入框下面，左边和输入框里的「+」对齐（照 Dispatch 输入框下面的权限那一行）
    // （2026-11-24 起中间夹着「记笔记 ·《…》｜ 旁支」那一排：它紧贴输入框，全能模式紧贴它）
    const input = (await chat(page).getByTestId('ai-input').boundingBox())!
    const noteRow = (await chat(page).getByTestId('ai-note-sw').boundingBox())!
    const line = (await chat(page).getByTestId('ai-omni').boundingBox())!
    expect(noteRow.y).toBeGreaterThan(input.y + input.height)
    expect(noteRow.y - (input.y + input.height)).toBeLessThan(8)
    expect(line.y).toBeGreaterThanOrEqual(noteRow.y + noteRow.height)
    expect(line.y - (noteRow.y + noteRow.height)).toBeLessThan(8)
    // 悬停：两种模式各能做什么，一种一段；左边和开关对齐、不伸出右栏
    await sw.hover()
    const tip = page.getByTestId('tooltip')
    await expect(tip.locator('.para')).toHaveText([
      '开着：和在终端里用Claude Code一样，AI能读写这台Mac上的文件、跑命令、上网搜、开子Agent，不停下来问你。',
      '关着：AI只在库里动手（新建、改写、改名、挪动、删笔记，建文件夹），不碰库外的文件、不跑命令、不上网搜。',
      '两种都是一轮改动提交一次，能撤回；AI对话和读PDF共用这一个开关。',
    ])
    const tb = (await tip.boundingBox())!
    const cell = (await chat(page).boundingBox())!
    expect(Math.abs(tb.x - (await sw.boundingBox())!.x)).toBeLessThan(2)
    expect(tb.x + tb.width).toBeLessThanOrEqual(cell.x + cell.width + 1)
    await send(page, '现在是什么模式')
    await expect((await answered(page)).locator('.txt')).toHaveText('引擎拿到的：全能模式开着；话里写的：全能模式开着。')
    await sw.click()
    await expect(sw).toHaveAttribute('aria-checked', 'false')
    await expect(chat(page).getByTestId('ai-omni')).toContainText('关着：只在库里新建、改名、挪动、删笔记')
    await send(page, '现在是什么模式')
    await expect((await answered(page)).locator('.txt')).toHaveText('引擎拿到的：全能模式关着；话里写的：全能模式关着。')
    expect(JSON.parse(readFileSync(join(run.userData, 'ai/settings.json'), 'utf8')).omni).toBe(false)
    await page.waitForTimeout(400)
    await run.app.close()
    // 重开软件（同一个设置目录）：还是关着；读 PDF 的 AI 下面是同一个开关
    const app = await electron.launch({
      executablePath: electronPath as unknown as string,
      args: [join(__dirname, '../out/main/index.js')],
      env: { ...process.env, CN_VAULT: vault, CN_USER_DATA: run.userData, CN_AI_FAKE: '1', CN_E2E: '1', CN_NO_AX: '1', CN_QUICK_KEY: 'Alt+Command+Shift+F19', CN_TRASH_DIR: run.trash },
    })
    try {
      const p2 = await app.firstWindow()
      await expect(p2.locator('.vault b')).toHaveText('测试库')
      await openAi(p2)
      await expect(chat(p2).getByRole('switch', { name: '全能模式' })).toHaveAttribute('aria-checked', 'false')
      await openPdf(p2)
      await openAi(p2)
      // 刚才那段问过：换页留着（AI 对话绑页面），点头上那颗切到这一页的 AI
      await chat(p2).getByTestId('ai-follow').click()
      const rsw = reading(p2).getByRole('switch', { name: '全能模式' })
      await expect(rsw).toHaveAttribute('aria-checked', 'false')
      await rsw.click()
      await expect(rsw).toHaveAttribute('aria-checked', 'true')
      // 回到文档：AI 对话这边也开了
      await p2.getByTestId('tab-list').getByRole('tab', { name: /首页/ }).click()
      await expect(chat(p2).getByRole('switch', { name: '全能模式' })).toHaveAttribute('aria-checked', 'true')
      expect(JSON.parse(readFileSync(join(run.userData, 'ai/settings.json'), 'utf8')).omni).toBe(true)
    } finally {
      await app.close()
    }
  } finally {
    rmSync(dirname(vault), { recursive: true, force: true, maxRetries: 5 })
  }
})

test('全能模式关着：AI 用库里的笔记工具新建、改名（[[双链]]跟着改）、挪进别的文件夹、删到废纸篓；步骤行写人话，一轮一次提交，撤回回到原样；重名说清楚；要自己写文件就请用户打开全能模式', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page, vault, trash } = run
  try {
    await openAi(page)
    await chat(page).getByRole('switch', { name: '全能模式' }).click()
    await expect(chat(page).getByRole('switch', { name: '全能模式' })).toHaveAttribute('aria-checked', 'false')

    // 新建：放进课程/线代，开头补「# 标题」
    await send(page, '新建一篇「第3讲要点」放到「课程/线代」写上「列就是基向量去哪。」')
    let msg = await answered(page)
    await expect(msg.getByTestId('ai-step')).toHaveText(['新建《第3讲要点》，放进「课程/线代」'])
    await expect(msg.getByTestId('ai-step')).toHaveClass(/\bok\b/)
    await expect(msg.locator('.txt')).toHaveText('建好了：课程/线代/第3讲要点.md。')
    expect(readFileSync(join(vault, '课程/线代/第3讲要点.md'), 'utf8')).toBe('# 第3讲要点\n\n列就是基向量去哪。\n')
    expect(lastSubject(vault)).toBe('AI：新建一篇「第3讲要点」放到「课程/线代」写上「列就是基向量去哪。」')
    await expect(msg.getByTestId('ai-change')).toContainText('改了1个文件')
    await expect(msg.getByTestId('ai-change').locator('.fr .k')).toHaveText(['新'])

    // 同名再建一次：步骤红叉，后面跟原因
    await send(page, '新建一篇「第3讲要点」放到「课程/线代」')
    msg = await answered(page)
    await expect(msg.getByTestId('ai-step')).toHaveClass(/\berr\b/)
    await expect(msg.getByTestId('ai-step')).toContainText('「课程/线代」里已经有一篇叫「第3讲要点」了')

    // 改名：库里的 [[冰岛]] 跟着改，开头「# 冰岛」跟着改
    await send(page, '把「冰岛.md」改名为「冰岛自驾」')
    msg = await answered(page)
    await expect(msg.getByTestId('ai-step')).toHaveText(['把《冰岛》改名为《冰岛自驾》'])
    expect(readFileSync(join(vault, '冰岛自驾.md'), 'utf8')).toBe('# 冰岛自驾\n\n极光。\n')
    expect(readFileSync(join(vault, '旅行.md'), 'utf8')).toContain('见 [[冰岛自驾]]')
    expect(existsSync(join(vault, '冰岛.md'))).toBe(false)
    expect(git(vault, 'status', '--porcelain')).toBe('')
    // 改动预览：它自己（旧名、新名）写「改名」，链接跟着改的那篇写「改」
    const chg = msg.getByTestId('ai-change')
    // 改名的一篇只占一行「冰岛.md → 冰岛自驾.md」，标题数的是两个文件
    await expect(chg.locator('.hd')).toContainText('改了2个文件')
    await expect(chg.locator('.fr.renamed')).toHaveCount(1)
    await expect(chg.locator('.fr.renamed .truncate')).toHaveText('冰岛.md冰岛自驾.md')
    await expect(chg.locator('.fr.renamed .k')).toHaveText('改名')
    await expect(chg.locator('.fr', { hasText: '旅行.md' }).locator('.k')).toHaveText('改')

    // 挪进课程/线代：别处指向它的相对链接跟着改
    await send(page, '把「冰岛自驾.md」挪到「课程/线代」')
    msg = await answered(page)
    await expect(msg.getByTestId('ai-step')).toHaveText(['把《冰岛自驾》挪进「课程/线代」'])
    expect(existsSync(join(vault, '课程/线代/冰岛自驾.md'))).toBe(true)
    expect(readFileSync(join(vault, '旅行.md'), 'utf8')).toContain('[冰岛](课程/线代/冰岛自驾.md)')
    expect(lastFiles(vault)).toEqual(expect.arrayContaining(['M\t旅行.md']))

    // 删掉：进（测试用的）废纸篓，一次提交；撤回就回来
    await send(page, '删掉「课程/线代/冰岛自驾.md」')
    msg = await answered(page)
    await expect(msg.getByTestId('ai-step')).toHaveText(['删掉《冰岛自驾》（在废纸篓里能找回）'])
    expect(existsSync(join(vault, '课程/线代/冰岛自驾.md'))).toBe(false)
    expect(readdirSync(trash).some((n) => n.endsWith('冰岛自驾.md'))).toBe(true)
    expect(lastFiles(vault)).toEqual(['D\t课程/线代/冰岛自驾.md'])
    await msg.getByTestId('ai-change').getByRole('button', { name: '撤回' }).click()
    await expect(msg.getByTestId('ai-change')).toContainText('已撤回')
    expect(readFileSync(join(vault, '课程/线代/冰岛自驾.md'), 'utf8')).toBe('# 冰岛自驾\n\n极光。\n')
    expect(lastSubject(vault)).toBe('撤回AI：删掉「课程/线代/冰岛自驾.md」')

    // 关着时要它自己写文件：说做不了、请用户打开全能模式，什么都不写
    await send(page, '自己写文件「外面.md」「x」')
    msg = await answered(page)
    await expect(msg.locator('.txt')).toHaveText('全能模式关着，我不能自己写文件。请在 AI 输入框下面打开「全能模式」再说一次。')
    expect(existsSync(join(vault, '外面.md'))).toBe(false)
  } finally {
    await run.close()
  }
})

test('全能模式开着：AI 自己写的文件这一轮结束提交成「AI：…」，步骤行写「写《…》」；用户没提交的字先单独提交，答的时候编辑器里打的字不算进 AI 那次', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1', CN_FAKE_OWN_MS: '2500' })
  const { page, vault } = run
  try {
    await openDoc(page, '随手记')
    await pane(page).locator('.cm-content').click()
    await page.keyboard.press('Meta+ArrowDown')
    await page.keyboard.type('先打的字')
    await waitSaved(page)
    await openAi(page)
    await expect(chat(page).getByRole('switch', { name: '全能模式' })).toHaveAttribute('aria-checked', 'true')
    await send(page, '自己写文件「AI写的.md」「# AI写的\n\n内容」')
    const msg = chat(page).getByTestId('ai-msg').last()
    await expect(msg.getByTestId('ai-step')).toHaveText(['写《AI写的》'])
    // AI 还在答（写完等着）：用户接着在编辑器里打字
    await pane(page).locator('.cm-content').click()
    await page.keyboard.press('Meta+ArrowDown')
    await page.keyboard.type('答的时候打的字')
    await waitSaved(page)
    await answered(page)
    await expect(msg.getByTestId('ai-step')).toHaveClass(/\bok\b/)
    await expect(msg.getByTestId('ai-change')).toContainText('改了1个文件')
    expect(lastSubject(vault)).toBe('AI：自己写文件「AI写的.md」「# AI写的 内容」')
    expect(lastFiles(vault)).toEqual(['A\tAI写的.md'])
    // 用户开始问之前打的字：单独一次提交，在 AI 那次前面
    expect(lastFiles(vault, 'HEAD~1')).toEqual(['M\t随手记.md'])
    expect(git(vault, 'show', 'HEAD~1:随手记.md')).toContain('先打的字')
    // 答的时候打的字没进 AI 那次，还在工作区里等用户提交
    expect(git(vault, 'show', 'HEAD~1:随手记.md')).not.toContain('答的时候打的字')
    expect(git(vault, 'status', '--porcelain')).toBe('M 随手记.md')
  } finally {
    await run.close()
  }
})

test('全能模式开着：AI 自己改了正开着的这一篇（在外面改），编辑器跟着刷新、正在打的字不丢（「外部改动不丢正在打的字」）；这一轮的提交里有这篇', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1', CN_FAKE_OWN_MS: '1500' })
  const { page, vault } = run
  try {
    await openDoc(page, '随手记')
    await openAi(page)
    await send(page, '过一会儿在「随手记.md」末尾加「AI加的一行」')
    const msg = chat(page).getByTestId('ai-msg').last()
    await expect(msg.getByTestId('ai-step')).toHaveText(['改《随手记》'])
    await expect(msg.getByTestId('ai-step')).toHaveClass(/\brun\b/)
    // AI 还没改（等着）：用户在编辑器里接着打字
    await pane(page).locator('.cm-content').click()
    await page.keyboard.press('Meta+ArrowDown')
    await page.keyboard.type('用户正在打的字')
    await answered(page)
    await expect(msg.getByTestId('ai-step')).toHaveClass(/\bok\b/)
    // 编辑器里两样都在，存下去也都在
    await expect.poll(() => editorText(page)).toContain('AI加的一行')
    expect(await editorText(page)).toContain('用户正在打的字')
    await waitSaved(page)
    const disk = readFileSync(join(vault, '随手记.md'), 'utf8')
    expect(disk).toContain('AI加的一行')
    expect(disk).toContain('用户正在打的字')
    expect(git(vault, 'log', '--format=%s')).toContain('AI：过一会儿在「随手记.md」末尾加「AI加的一行」')
    expect(git(vault, 'show', 'HEAD:随手记.md').includes('AI加的一行') || git(vault, 'show', 'HEAD~1:随手记.md').includes('AI加的一行')).toBe(true)
  } finally {
    await run.close()
  }
})

test('读 PDF 的 AI 也能动手：新建一篇放进课程文件夹，回答下面有步骤行和改动块，撤回回到原样', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await openPdf(page)
    await openAi(page)
    const box = reading(page).getByRole('textbox', { name: '问 AI' })
    await box.fill('新建一篇「第3讲摘要」放到「课程/线代」写上「旋转矩阵的列是基向量转过去的位置。」')
    await box.press('Enter')
    const msg = reading(page).getByTestId('reading-msg').last()
    await expect(msg.getByTestId('ai-step')).toHaveText(['新建《第3讲摘要》，放进「课程/线代」'], { timeout: 20_000 })
    await expect(msg.locator('.txt')).toContainText('建好了：课程/线代/第3讲摘要.md。')
    await expect(msg.getByTestId('ai-change')).toContainText('改了1个文件')
    expect(readFileSync(join(vault, '课程/线代/第3讲摘要.md'), 'utf8')).toContain('旋转矩阵的列是基向量转过去的位置。')
    expect(git(vault, 'log', '--format=%s')).toContain('AI：读第3讲时：新建一篇「第3讲摘要」')
    await msg.getByTestId('ai-change').getByRole('button', { name: '撤回' }).click()
    await expect(msg.getByTestId('ai-change')).toContainText('已撤回')
    expect(existsSync(join(vault, '课程/线代/第3讲摘要.md'))).toBe(false)
  } finally {
    await run.close()
  }
})
