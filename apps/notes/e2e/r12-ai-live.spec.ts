// 2026-11-21 用户在另一台 Mac 上让 AI「整理当前页面」（task-wnbi1）：
// 1. AI 改了开着的这篇，编辑器没跟着变，AI 只能叫用户「把标签关掉再打开」；
// 2. AI 那次提交里混进了 15 个和这篇无关的附件删除（这一轮开始前工作区里就有的改动）；
// 3. 第一轮没答完就停了，接着问时开了新会话，对话里后面几轮看不到。
// 一律无头（CN_E2E=1）、假 AI（CN_AI_FAKE=1）、临时库、临时设置目录。
import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import electronPath from 'electron'
import { editorText, launch, openAi, pane, rail, tabOn, waitSaved, webAboveAi } from './app'
import { solidPng } from './fixtures/png'

const NOTE = '课程/study project/学习笔记.md'
const ATT = '附件/课程/study project/学习笔记'

/** 一篇带十几张图的长笔记（照用户那篇的样子：标题、引用、出处、截图、公式） */
function longNote(): string {
  const parts = ['# 学习笔记', '', '摘录、截图和问答。', '']
  for (let i = 1; i <= 12; i++) {
    parts.push(`## 第 ${i} 节`, '', `> 第 ${i} 段摘录：任何一种计算技术要想发挥其全部影响力，都必须得到充分的理解。`.repeat(3), '—— [出处](https://zh.d2l.ai/)', '', `![](../../附件/课程/study%20project/学习笔记/截图%20${i}.png)`, '', `$f:\\mathbb{R}\\to\\mathbb{R}$ 第 ${i} 条。`, '')
  }
  return parts.join('\n')
}

function files(): Record<string, string | Uint8Array> {
  const out: Record<string, string | Uint8Array> = { [NOTE]: longNote(), '别的.md': '# 别的\n\n![](附件/冰岛国旗.png)\n' }
  for (let i = 1; i <= 12; i++) out[`${ATT}/截图 ${i}.png`] = solidPng(40, 30, [i * 20, 80, 120])
  for (let i = 1; i <= 3; i++) out[`附件/Lecture05/p${i}-1.png`] = solidPng(20, 20, [200, i * 40, 40])
  out['附件/冰岛国旗.png'] = solidPng(12, 8, [0, 0, 200])
  return out
}

const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const git = (vault: string, ...args: string[]) => execFileSync('git', ['-C', vault, ...args], { encoding: 'utf8' }).trim()
const filesOf = (vault: string, rev: string) => git(vault, '-c', 'core.quotepath=false', 'show', '--name-status', '--format=', rev).split('\n').filter(Boolean)

async function send(page: Page, text: string) {
  const box = chat(page).getByRole('textbox', { name: '问 AI' })
  await box.fill(text)
  await box.press('Enter')
}

async function answered(page: Page) {
  await expect(chat(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 30_000 })
  return chat(page).getByTestId('ai-msg').last()
}

async function openDoc(page: Page, name: string) {
  await page.keyboard.press('Meta+o')
  await page.keyboard.type(name)
  await page.keyboard.press('Enter')
  await expect(tabOn(page)).toHaveText(name)
  await expect(pane(page).locator('.cm-content')).toBeVisible()
}

/** 同一个库、同一个设置目录再开一次软件（重开以后的样子） */
async function relaunch(vault: string, userData: string) {
  const app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [join(__dirname, '../out/main/index.js')],
    env: { ...process.env, CN_VAULT: vault, CN_USER_DATA: userData, CN_AI_FAKE: '1', CN_E2E: '1', CN_NO_AX: '1', CN_QUICK_KEY: 'Alt+Command+Shift+F19', CN_TRASH_DIR: join(dirname(vault), 'trash') },
  })
  const page = await app.firstWindow()
  await expect(page.locator('.vault b')).toHaveText('测试库')
  return { app, page }
}

let scratch: string
test.beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'cn-r12-'))
})
test.afterAll(() => rmSync(scratch, { recursive: true, force: true }))

test('AI 用 note_write 整篇改写开着的这篇：编辑器当场换成新内容，不用关标签；存盘后文件就是 AI 写的', async () => {
  const run = await launch(files(), { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await openDoc(page, '学习笔记')
    await openAi(page)
    const next = longNote().replace('# 学习笔记', '# 学习笔记：动手学深度学习').replace(/!\[\]\([^)]*截图%203\.png\)/, '图 3 写成了文字：符号表。')
    const src = join(scratch, 'next.md')
    writeFileSync(src, next)
    await send(page, `整篇改写「${NOTE}」照「${src}」`)
    await answered(page)
    await expect.poll(() => editorText(page)).toBe(next)
    await expect(pane(page).locator('.cm-content')).toContainText('图 3 写成了文字')
    await waitSaved(page)
    expect(git(vault, 'show', `HEAD:${NOTE}`)).toBe(next.trimEnd())
  } finally {
    await run.close()
  }
})

test('全能模式下 AI 自己写开着的这篇（像 Write、python 那样在外面整篇换掉）：编辑器当场换成新内容', async () => {
  const run = await launch(files(), { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await openDoc(page, '学习笔记')
    await openAi(page)
    await send(page, `自己写文件「${NOTE}」「# 学习笔记\n\n全换成了文字。」`)
    await answered(page)
    await expect.poll(() => editorText(page)).toBe('# 学习笔记\n\n全换成了文字。')
  } finally {
    await run.close()
  }
})

test('这一轮开始前工作区里已经删了几个附件，AI 这一轮只改一篇：两次提交，先提交的那次写清删了什么、不冒用 AI；AI 那次只含那一篇', async () => {
  const run = await launch(files(), { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await openDoc(page, '学习笔记')
    // 软件外面（或别的功能）删掉的附件，还没提交
    for (const f of ['附件/Lecture05/p1-1.png', '附件/Lecture05/p2-1.png', '附件/Lecture05/p3-1.png', '附件/冰岛国旗.png']) unlinkSync(join(vault, f))
    await openAi(page)
    await send(page, `在「${NOTE}」末尾加上「AI 加的一段」`)
    await answered(page)
    expect(git(vault, 'log', '-1', '--format=%s')).toBe(`AI：在「${NOTE}」末尾加上「AI 加的一段」`)
    expect(filesOf(vault, 'HEAD')).toEqual([`M\t${NOTE}`])
    const before = git(vault, 'log', '-1', '--format=%s', 'HEAD~1')
    expect(before).not.toMatch(/^AI/)
    expect(before).toContain('删除 4 个文件')
    expect(filesOf(vault, 'HEAD~1').sort()).toEqual(['D\t附件/Lecture05/p1-1.png', 'D\t附件/Lecture05/p2-1.png', 'D\t附件/Lecture05/p3-1.png', 'D\t附件/冰岛国旗.png'])
  } finally {
    await run.close()
  }
})

test('开始前那次提交没提交上（别的 git 进程一直占着锁）：工作区里已有的删除不算进 AI 那次，这一轮结束时先单独提交', async () => {
  const run = await launch(files(), { CN_AI_FAKE: '1', CN_FAKE_OWN_MS: '3000' })
  const { page, vault } = run
  try {
    await openDoc(page, '学习笔记')
    await openAi(page)
    for (const f of ['附件/Lecture05/p1-1.png', '附件/冰岛国旗.png']) unlinkSync(join(vault, f))
    // 锁占 2.4 秒：开始前那次提交等不到（最多等 1.8 秒），这一轮结束时（3 秒后）已经放了
    writeFileSync(join(vault, '.git/index.lock'), '')
    setTimeout(() => rmSync(join(vault, '.git/index.lock'), { force: true }), 2400)
    await send(page, '自己写文件「AI写的.md」「# AI写的」')
    await answered(page)
    expect(git(vault, 'log', '-1', '--format=%s')).toBe('AI：自己写文件「AI写的.md」「# AI写的」')
    expect(filesOf(vault, 'HEAD')).toEqual(['A\tAI写的.md'])
    expect(git(vault, 'log', '-1', '--format=%s', 'HEAD~1')).toBe('删除 2 个文件：附件/Lecture05/p1-1.png、附件/冰岛国旗.png')
    expect(git(vault, 'status', '--porcelain')).toBe('')
  } finally {
    await run.close()
  }
})

test('AI 这一轮没跑命令，答的时候库外面删了一张图：不算进 AI 那次，单独一次提交写清删了什么', async () => {
  const run = await launch(files(), { CN_AI_FAKE: '1', CN_FAKE_OWN_MS: '2000' })
  const { page, vault } = run
  try {
    await openDoc(page, '学习笔记')
    await openAi(page)
    await send(page, '自己写文件「AI写的.md」「# AI写的」')
    await expect(chat(page).getByTestId('ai-msg').last().getByTestId('ai-step')).toHaveText(['写《AI写的》'])
    unlinkSync(join(vault, '附件/冰岛国旗.png'))
    await answered(page)
    expect(filesOf(vault, 'HEAD')).toEqual(['A\tAI写的.md'])
    expect(git(vault, 'log', '-1', '--format=%s', 'HEAD~1')).toBe('删除 1 个文件：附件/冰岛国旗.png')
  } finally {
    await run.close()
  }
})

test('AI 这一轮跑了命令，答的时候用户在软件里删了一篇（连图）：软件自己删的不算进 AI 那次', async () => {
  const run = await launch(files(), { CN_AI_FAKE: '1', CN_FAKE_OWN_MS: '2000' })
  const { page, vault } = run
  try {
    await openDoc(page, '学习笔记')
    await openAi(page)
    await send(page, '跑命令写文件「AI写的.md」「# AI写的」')
    await expect(chat(page).getByTestId('ai-msg').last().getByTestId('ai-step')).toHaveText(['跑命令python3 /tmp/fix.py'])
    await page.evaluate(() => window.cnAttach.trashNote('别的.md', true))
    await answered(page)
    expect(filesOf(vault, 'HEAD')).toEqual(['A\tAI写的.md'])
    // 删的那篇和它的图照旧留在工作区，和平时在软件里删一样（下次提交带上）
    expect(git(vault, '-c', 'core.quotepath=false', 'status', '--porcelain').split('\n').map((l) => l.trim()).sort()).toEqual(['D 别的.md', 'D 附件/冰岛国旗.png'])
  } finally {
    await run.close()
  }
})

test('一轮做到一半断了：回答下面写清没做完、做到哪，带「接着做」；点它接着同一个会话做（不开新会话、不补「之前聊过的」）', async () => {
  const run = await launch(files(), { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await openDoc(page, '学习笔记')
    await openAi(page)
    await send(page, '整理当前页面，做到一半就断')
    const msg = await answered(page)
    await expect(msg.getByTestId('ai-step')).toHaveText(['读附件/截图 9.png'])
    await expect(msg.locator('.txt')).toHaveText('正在把这篇按章节重排')
    const cut = msg.getByTestId('ai-error')
    await expect(cut).toContainText('没做完')
    await expect(cut).toContainText('做到：读附件/截图 9.png')
    await expect(cut.getByRole('button', { name: '再问一次' })).toHaveCount(0)
    await cut.getByRole('button', { name: '接着做' }).click()
    const next = await answered(page)
    await expect(chat(page).locator('.um').last()).toHaveText('接着做')
    await expect(next.locator('.txt')).toHaveText('接着会话 fake-cut-claude 做完了。')
    // 接着做完了：上面那条的「接着做」收起来（不是最后一条了）
    await expect(cut.getByRole('button', { name: '接着做' })).toHaveCount(0)
  } finally {
    await run.close()
  }
})

test('按了停下：回答下面写清停在哪、带「接着做」；自己打「接着做」也接着同一个会话', async () => {
  const run = await launch(files(), { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await openDoc(page, '学习笔记')
    await openAi(page)
    await send(page, '慢慢做')
    const msg = chat(page).getByTestId('ai-msg').last()
    await expect(msg.locator('.txt')).toHaveText('正在把这篇按章节重排')
    await chat(page).getByRole('button', { name: '停下' }).click()
    await answered(page)
    const cut = msg.getByTestId('ai-error')
    await expect(cut).toContainText('没做完：停下了')
    // 做到的是做完的最后一步；停下时掐断的那一步在步骤行里写没做完
    await expect(cut.locator('.at')).toHaveText('做到：读附件/截图 9.png')
    // 停下时还在跑的那一步不再转圈，写没做完
    await expect(msg.getByTestId('ai-step').last()).toHaveClass(/\berr\b/)
    await expect(msg.getByTestId('ai-step').last()).toHaveAttribute('title', '没做完')
    await send(page, '接着做')
    const next = await answered(page)
    await expect(next.locator('.txt')).toHaveText('接着会话 fake-cut-claude 做完了。')
  } finally {
    await run.close()
  }
})

test('对话里每一轮都看得到：问了好几轮以后收起 AI、换标签再回来、右栏上半开着历史、重开软件，都停在最新那一轮（不是停在第一轮）', async () => {
  const run = await launch(files(), { CN_AI_FAKE: '1' })
  let page = run.page
  try {
    await openDoc(page, '学习笔记')
    await openAi(page)
    for (let i = 1; i <= 8; i++) {
      await send(page, `第 ${i} 问`)
      await answered(page)
    }
    const inView = async () => {
      const list = (await chat(page).locator('.msgs').boundingBox())!
      const last = (await chat(page).locator('.um').last().boundingBox())!
      return last.y >= list.y - 1 && last.y + last.height <= list.y + list.height + 1
    }
    expect(await inView()).toBe(true)
    // 收起 AI，换到别的标签再回来，再打开
    await page.getByRole('button', { name: '收起 AI', exact: true }).first().click()
    await openDoc(page, '别的')
    await openDoc(page, '学习笔记')
    await openAi(page)
    await expect(chat(page).locator('.um').last()).toHaveText('第 8 问')
    await expect.poll(inView).toBe(true)
    // AI 开着时换标签再回来，也停在最新那一轮
    await openDoc(page, '别的')
    await openDoc(page, '学习笔记')
    await expect.poll(inView).toBe(true)
    // 右栏上半开着历史（AI 那一格变矮）：还是停在最新那一轮。工作区方向 A（task-9okg5）：历史先和 AI 叠成标签，
    // 拖到上半（真拖）才是历史在上、AI 在下
    await rail(page).getByRole('button', { name: '历史' }).click()
    await webAboveAi(page, 'history')
    await expect(page.getByRole('complementary', { name: '历史' })).toBeVisible()
    await expect.poll(inView).toBe(true)
    // 重开软件（自动更新后「重启更新」）：打开 AI，停在最新那一轮
    // 对话存好了再退出（测试里窗口藏着，存盘的计时器要等页面被叫醒才走；真用时 0.3 秒就存）
    await expect.poll(() => page.evaluate(() => window.cn.aiChatLoad('file:课程/study project/学习笔记.md').then((m) => m.length))).toBe(16)
    await run.app.close()
    const again = await relaunch(run.vault, run.userData)
    try {
      page = again.page
      await expect(tabOn(page)).toHaveText('学习笔记')
      await openAi(page)
      await expect(chat(page).locator('.um').last()).toHaveText('第 8 问')
      await expect.poll(inView).toBe(true)
    } finally {
      await again.app.close()
    }
  } finally {
    await run.close().catch(() => undefined)
  }
})
