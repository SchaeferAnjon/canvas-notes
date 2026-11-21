/**
 * 一个 PDF 一篇笔记（task-9okg5，原型 design/workspace/proto-a.html 的左栏、底栏）：
 * - 老库打开时整理一次：没改过的「我的疑惑.md」删掉、改过的改名留下，同一份 PDF 的两篇笔记合成一篇；一次提交，底栏一句带「撤回」，撤回全回来，再开不再整理；
 * - 左栏 PDF 和它的笔记是一行（右端笔记图标 + 问了几问），笔记不单独一行；点这一行开 PDF、笔记标签跟着开；右键「单独打开笔记」；
 * - 读 PDF 问完记笔记，不再写「我的疑惑.md」；
 * - 主对话、旁支记进笔记时底栏说记到了哪，笔记标签没露出来时带「在笔记里看」。
 * 都是真点，窗口不上屏。
 */
import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import electronPath from 'electron'
import { newReadingNote, renderSection, type AskSection, withDerived } from '@cn/format'
import { acts, launch, leftView, noteBeside, openAi, rail, tabOn } from './app'
import { armMenus, openedMenu, pickMenu } from './menu'
import { LECTURE } from './fixtures/pdf'

const DIR = '课程/机器学习'
const PDF4 = `${DIR}/第4讲 卷积网络.pdf`
const NOTE4 = `${DIR}/第4讲 卷积网络 笔记.md`
const NOTE4B = `${DIR}/第4讲 卷积网络 笔记 2.md`
const PDF5 = `${DIR}/第5讲 注意力机制.pdf`
const NOTE5 = `${DIR}/第5讲 注意力机制 笔记.md`

const sec = (pdf: string, page: number, qs: string[], name: string): AskSection =>
  withDerived({
    id: `.canvas-notes/对话/${name}-p${page}-1.md`,
    file: pdf,
    page,
    title: `第 ${page} 页的小标题`,
    time: '20:14',
    figures: [],
    doubts: [],
    good: '',
    points: [],
    failed: [],
    rounds: 0,
    links: [],
    qas: qs.map((q) => ({ q, a: `${q}的回答。`, sides: [] })),
    recap: `第 ${page} 页的小结`,
  })
const note = (pdf: string, path: string, secs: AskSection[]) => newReadingNote(pdf) + secs.map((s) => '\n' + renderSection(s, path)).join('')

const DOUBTS = '---\n类型: 我的疑惑\n课程: 机器学习\n生成: 软件\n---\n# 我的疑惑\n\n机器学习 · 1 条。软件按这里各篇读 PDF 的笔记自动汇总，要改就改笔记里那一段。\n\n## 第 4 讲 · 第4讲 卷积网络\n\n- **问三** [第 3 页](第4讲%20卷积网络.pdf#page=3)\n  问三的回答。\n'

const files = {
  [PDF4]: LECTURE,
  [NOTE4]: note(PDF4, NOTE4, [sec(PDF4, 3, ['问三'], '第4讲 卷积网络')]),
  [NOTE4B]: note(PDF4, NOTE4B, [sec(PDF4, 3, ['问三', '还是不懂'], '第4讲 卷积网络'), sec(PDF4, 7, ['问七'], '第4讲 卷积网络')]) + '\n## 我自己的总结\n\n卷积就是滑动的加权和。\n',
  [PDF5]: LECTURE,
  [NOTE5]: note(PDF5, NOTE5, [sec(PDF5, 2, ['问二'], '第5讲 注意力机制')]),
  '课程/线代/第1讲.pdf': LECTURE,
  // 另一门课：软件写的、后来自己改过（最后一次提交不是软件的）
  '课程/线代/我的疑惑.md': '---\n类型: 我的疑惑\n生成: 软件\n---\n# 我的疑惑\n\n- **旧的一条** [第 1 页](第1讲.pdf#page=1)\n\n我自己加的一句：考前看第 1 页。\n',
}
/** 软件写的「我的疑惑」：最后一次是软件记笔记那次提交的（「笔记：」开头） */
const prepare = (vault: string) => {
  writeFileSync(join(vault, DIR, '我的疑惑.md'), DOUBTS)
  execFileSync('git', ['-C', vault, 'add', '--', `${DIR}/我的疑惑.md`])
  execFileSync('git', ['-C', vault, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', '笔记：第4讲 卷积网络 第 3 页 · 第 3 页的小标题'])
}
const read = (vault: string, p: string) => readFileSync(join(vault, p), 'utf8')
const gitOut = (vault: string, ...args: string[]) => execFileSync('git', ['-C', vault, ...args], { encoding: 'utf8' }).trim()
const tree = (page: Page) => page.getByRole('tree', { name: '全部文件' })
const row = (page: Page, name: string) => tree(page).getByRole('treeitem').filter({ has: page.locator('.truncate', { hasText: new RegExp(`^${name}$`) }) })
async function expand(page: Page, ...names: string[]) {
  await leftView(page, '文件')
  for (const n of names) {
    const b = row(page, n).getByRole('button', { name: `展开 ${n}` })
    if (await b.count()) await b.click()
  }
}

test('老库打开整理一次：生成版「我的疑惑」删掉、改过的改名留下、两篇笔记并成一篇，一次提交，底栏一句带撤回；左栏 PDF 和笔记一行，点开 PDF 笔记跟着开，右键「单独打开笔记」；撤回全回来，再开不再整理', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' }, prepare)
  const { page, vault } = run
  const root = dirname(vault)
  try {
    // 底栏左边一句，关掉之前一直在
    const msg = page.getByTestId('tidy-msg')
    await expect(msg).toContainText('整理好了：「我的疑惑」改在课程首页看，改过的「我的疑惑」改名留着，两篇《第4讲 卷积网络 笔记》并成一篇')
    await expect(msg.getByRole('button', { name: '撤回' })).toBeVisible()
    // 一次提交
    expect(gitOut(vault, 'log', '-1', '--format=%s')).toBe('整理：「我的疑惑」改在课程首页看，改过的「我的疑惑」改名留着，两篇《第4讲 卷积网络 笔记》并成一篇')
    expect(gitOut(vault, 'status', '--porcelain')).toBe('')
    expect(existsSync(join(vault, DIR, '我的疑惑.md'))).toBe(false)
    expect(existsSync(join(vault, NOTE4B))).toBe(false)
    expect(read(vault, '课程/线代/我的疑惑（我改过的）.md')).toBe(files['课程/线代/我的疑惑.md'])
    const merged = read(vault, NOTE4)
    expect(merged).toContain('> [!question] 还是不懂')
    expect(merged).toContain('## 以前的版本 · 第 3 页 · 第 3 页的小标题')
    expect(merged).toContain('## 从《第4讲 卷积网络 笔记 2》并进来的\n\n### 我自己的总结')

    // 左栏：PDF 和笔记是一行，右端笔记图标 + 问了几问；笔记不单独一行；「我的疑惑」不在
    await expand(page, '课程', '机器学习')
    await expect(row(page, '第4讲 卷积网络')).toHaveCount(1)
    await expect(row(page, '第4讲 卷积网络').getByTestId('ft-note')).toHaveText('3')
    await expect(row(page, '第4讲 卷积网络').locator('.ft-ext')).toHaveText('PDF')
    await expect(row(page, '第4讲 卷积网络')).toHaveAttribute('title', 'PDF 和它的笔记是一行：点开 PDF，笔记跟着在旁边')
    await expect(row(page, '第4讲 卷积网络 笔记')).toHaveCount(0)
    await expect(row(page, '第5讲 注意力机制').getByTestId('ft-note')).toHaveText('1')
    await expect(row(page, '我的疑惑')).toHaveCount(0)
    // 点这一行：开 PDF，笔记标签跟着开（2轮 · 3问）
    await row(page, '第4讲 卷积网络').click()
    await expect(tabOn(page)).toHaveText('第4讲 卷积网络.pdf')
    const notes = page.getByRole('complementary', { name: '笔记', exact: true })
    await expect(notes).toBeVisible()
    await expect(notes.getByTestId('note-count')).toHaveText('2轮 · 3问')
    // 「只看我问的」：这份 PDF 问过的原话
    await notes.getByRole('tablist', { name: '笔记筛选' }).getByRole('tab', { name: '只看我问的' }).click()
    await expect(notes.getByTestId('note-q').locator('.q')).toHaveText(['问三', '还是不懂', '问七'])
    // 右键「单独打开笔记」：在中间当文档开
    await armMenus(run)
    await row(page, '第4讲 卷积网络').click({ button: 'right' })
    expect((await openedMenu(run)).map((i) => i.label)).toContain('单独打开笔记')
    await pickMenu(run, '单独打开笔记')
    await expect(tabOn(page)).toHaveText('第4讲 卷积网络 笔记')

    // 撤回：五篇回来，底栏那一句收起，说一句
    await msg.getByRole('button', { name: '撤回' }).click()
    await expect(msg).toHaveCount(0)
    await expect(page.getByTestId('toast')).toContainText('撤回了这次整理：「我的疑惑.md」和《第4讲 卷积网络 笔记 2》回来了')
    await expect.poll(() => existsSync(join(vault, DIR, '我的疑惑.md'))).toBe(true)
    expect(read(vault, DIR + '/我的疑惑.md')).toBe(DOUBTS)
    expect(read(vault, NOTE4B)).toBe(files[NOTE4B])
    expect(read(vault, NOTE4)).toBe(files[NOTE4])
    expect(read(vault, '课程/线代/我的疑惑.md')).toBe(files['课程/线代/我的疑惑.md'])
    expect(existsSync(join(vault, '课程/线代/我的疑惑（我改过的）.md'))).toBe(false)
    expect(gitOut(vault, 'log', '-1', '--format=%s')).toMatch(/^撤回整理：/)
    await page.waitForTimeout(400)

    // 重开软件：整理过了（库里记着），不再整理，底栏没有那一句
    await run.app.close()
    const app2 = await electron.launch({
      executablePath: electronPath as unknown as string,
      args: [join(__dirname, '../out/main/index.js')],
      env: { ...process.env, CN_VAULT: vault, CN_USER_DATA: join(root, 'user-data'), CN_AI_FAKE: '1', CN_E2E: '1', CN_NO_AX: '1', CN_QUICK_KEY: 'Alt+Command+Shift+F19', CN_TRASH_DIR: join(root, 'trash'), CN_ICLOUD_CONTAINER: join(root, 'icloud') },
    })
    try {
      const p2 = await app2.firstWindow()
      await expect(p2.locator('.vault b')).toHaveText('测试库')
      await p2.waitForTimeout(800)
      await expect(p2.getByTestId('tidy-msg')).toHaveCount(0)
      expect(existsSync(join(vault, DIR, '我的疑惑.md'))).toBe(true)
      expect(gitOut(vault, 'log', '-1', '--format=%s')).toMatch(/^撤回整理：/)
    } finally {
      await app2.close()
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('读 PDF 问完记笔记不再写「我的疑惑.md」：那次提交里只有笔记和截图；左栏那一行的数跟着变', async () => {
  const run = await launch({ [PDF5]: LECTURE }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await expand(page, '课程', '机器学习')
    await expect(row(page, '第5讲 注意力机制')).toHaveCount(1)
    await expect(row(page, '第5讲 注意力机制').getByTestId('ft-note')).toHaveCount(0)
    await row(page, '第5讲 注意力机制').click()
    await expect(tabOn(page)).toHaveText('第5讲 注意力机制.pdf')
    await expect(page.locator('.pdfpane:not([hidden]) .pdfpage[data-page="1"] canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
    await acts(page).getByRole('button', { name: /问这一页/ }).click()
    await expect.poll(() => gitOut(vault, 'log', '-1', '--format=%s'), { timeout: 20_000 }).toMatch(/^笔记：第5讲 注意力机制/)
    const changed = gitOut(vault, 'show', '--name-only', '--format=', 'HEAD').split('\n')
    expect(changed).toContain(NOTE5)
    expect(changed.some((p) => p.endsWith('我的疑惑.md'))).toBe(false)
    expect(existsSync(join(vault, DIR, '我的疑惑.md'))).toBe(false)
    // 左栏那一行：PDF 和笔记合成一行，右端是问了几问
    await expect(row(page, '第5讲 注意力机制').getByTestId('ft-note')).toHaveText('1')
    await expect(row(page, '第5讲 注意力机制 笔记')).toHaveCount(0)
  } finally {
    await run.close()
  }
})

test('问完底栏说记进了哪篇第几页，笔记在后面时带「在笔记里看」、点了换到笔记；旁支答完说挂在哪一问下面；笔记看得见时只说一句（原型 proto-a 的两句）', async () => {
  const run = await launch({ [PDF5]: LECTURE }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await expand(page, '课程', '机器学习')
    await row(page, '第5讲 注意力机制').click()
    await expect(tabOn(page)).toHaveText('第5讲 注意力机制.pdf')
    await expect(page.locator('.pdfpane:not([hidden]) .pdfpage[data-page="1"] canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
    // 笔记和 AI 叠成一组、AI 在前：笔记看不见
    await rail(page).getByRole('button', { name: '笔记' }).click()
    await openAi(page)
    await expect(page.getByTestId('dtab-ai')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('dtab-note')).toHaveAttribute('aria-selected', 'false')
    await acts(page).getByRole('button', { name: /问这一页/ }).click()
    const toast = page.getByTestId('toast')
    await expect(toast).toContainText('记进《第5讲 注意力机制 笔记》第1页', { timeout: 20_000 })
    await toast.getByRole('button', { name: '在笔记里看' }).click()
    await expect(page.getByTestId('dtab-note')).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.dview[data-view="note"] .rnd')).toHaveCount(1)
    // 旁支：回到 AI，在回答里拖选一句，问
    await page.getByTestId('dtab-ai').click()
    const ai = page.getByRole('complementary', { name: '边读边问 AI' })
    const t = (await ai.getByTestId('reading-msg').last().locator('.txt').boundingBox())!
    await page.mouse.move(t.x + 4, t.y + 10)
    await page.mouse.down()
    await page.mouse.move(t.x + Math.min(160, t.width - 10), t.y + 10, { steps: 6 })
    await page.mouse.up()
    const askbox = page.getByRole('dialog', { name: '选中的这句' })
    await askbox.getByRole('textbox', { name: '问这句' }).fill('为什么？')
    await askbox.getByRole('textbox', { name: '问这句' }).press('Enter')
    await expect(toast).toContainText(/^旁支也记进了笔记，挂在第1页「.{1,10}」下面/, { timeout: 20_000 })
    await expect(toast.getByRole('button', { name: '在笔记里看' })).toBeVisible()
    // 笔记拖到中间左边，看得见了：再问一句，底栏只说一句，不带「在笔记里看」。
    // 旁支就地开着时主对话的输入框缩成一行（task-4edsc 方向 A）：点它收起旁支、回到主对话再打字
    await noteBeside(page)
    await ai.getByTestId('ai-input-slim').click()
    await expect(ai.getByRole('region', { name: '旁支' })).toHaveCount(0)
    await ai.getByRole('textbox', { name: '问 AI' }).fill('还是不懂')
    await ai.getByRole('textbox', { name: '问 AI' }).press('Enter')
    await expect(toast).toHaveText('记进《第5讲 注意力机制 笔记》第1页', { timeout: 20_000 })
    await expect(toast.getByRole('button')).toHaveCount(0)
  } finally {
    await run.close()
  }
})
