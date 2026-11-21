import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { dirname, join } from 'node:path'
import electronPath from 'electron'
import { gitStatus, launch, openAi, pane, rail, waitSaved, tabOn, railItems } from './app'
import { DREAM_VAULT } from './fixtures/dream'

const ai = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const gitOut = (vault: string, ...args: string[]) => execFileSync('git', ['-C', vault, ...args], { encoding: 'utf8' }).trim()
const commits = (vault: string) => Number(gitOut(vault, 'rev-list', '--count', 'HEAD'))

const PLAN = `---
type: board
---
# 旅行计划

<!-- card id=a x=420 y=300 w=280 -->
出发前先定住处

<!-- card id=b x=60 y=80 w=280 -->
冰岛环岛十天
`
const files = { '旅行计划.md': PLAN, '随笔.md': '# 随笔\n\n第一段。\n\n第二段。\n' }

async function send(page: Page, text: string) {
  const box = ai(page).getByRole('textbox', { name: '问 AI' })
  await box.fill(text)
  await box.press('Enter')
}

/** 白板上卡片的位置和大小（白板坐标） */
/** 空白处的卡（新写法：前面一行位置 <!-- card id x y -->） */
function cardsOf(md: string) {
  return [...md.matchAll(/<!-- card id=(\w+) x=(\d+) y=(\d+) -->\n([^\n]+)/g)].map((m) => ({ id: m[1]!, x: +m[2]!, y: +m[3]!, text: m[4]! }))
}

let server: Server
let base: string

test.beforeAll(async () => {
  server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end('<title>极光预报站</title><body><h1>今晚云量 20%</h1><a href="/next">明天</a></body>')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
test.afterAll(() => server.close())

test('AI 只住右栏：右下角的圆钮打开右栏 AI 那一格，切引擎记住选择，关了再开、重开软件对话都还在', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  const root = dirname(vault)
  try {
    // 右边竖条里没有 AI
    await page.locator('.nav .si', { hasText: '随笔' }).click()
    await expect.poll(() => railItems(page)).toEqual(['笔记', '大纲', '网页', '微信读书', '历史'])
    const fab = page.getByRole('navigation', { name: '右栏' }).getByRole('button', { name: '打开 AI' })
    await expect(fab).toBeVisible()
    await fab.click()
    await expect(ai(page)).toBeVisible()
    // 圆钮一直在（D 组方向 A），开着时写「收起 AI」、多一圈强调色
    await expect(rail(page).locator('.ai-fab')).toHaveAttribute('aria-label', '收起 AI')
    await expect(rail(page).locator('.ai-fab')).toHaveClass(/\bon\b/)

    // 切引擎
    const eng = ai(page).getByTestId('ai-engine')
    await expect(eng).toHaveText('Claude Code')
    await eng.click()
    // 第 2b 段（CN-91 方向 C）：菜单挂在 body 上，每行右边写在哪找到
    const items = page.getByRole('menu', { name: 'AI 引擎' }).getByRole('menuitemradio')
    await expect(items).toHaveText(['Claude Code~/.local/bin', 'Codex/opt/homebrew/bin', 'Gemini/opt/homebrew/bin', 'OpenCode~/.opencode/bin'])
    await items.filter({ hasText: 'Codex' }).click()
    await expect(eng).toHaveText('Codex')
    await send(page, '你好')
    const msg = ai(page).getByTestId('ai-msg').last()
    await expect(msg).toHaveAttribute('data-engine', 'codex')
    await expect(msg.locator('.txt')).toHaveText('这是测试回答（Codex）。')

    // ⌘J 关上再开：对话还在
    await page.keyboard.press('Meta+j')
    await expect(ai(page)).toBeHidden()
    await expect(fab).toBeVisible()
    await page.keyboard.press('Meta+j')
    await expect(ai(page).getByTestId('ai-msg').locator('.txt')).toHaveText(['这是测试回答（Codex）。'])
    await page.waitForTimeout(500)

    // 重开软件（同一个设置目录）：AI 那一格还开着（开关记在本机），引擎还是 Codex，对话还在，不在库里
    await run.app.close()
    const app = await electron.launch({
      executablePath: electronPath as unknown as string,
      args: [join(__dirname, '../out/main/index.js')],
      // 测试实例：窗口不出现在屏幕上（CN_E2E）
      env: { ...process.env, CN_VAULT: vault, CN_USER_DATA: join(root, 'user-data'), CN_AI_FAKE: '1', CN_E2E: '1', CN_NO_AX: '1', CN_QUICK_KEY: 'Alt+Command+Shift+F19' },
    })
    try {
      const p2 = await app.firstWindow()
      await expect(ai(p2)).toBeVisible()
      await expect(rail(p2).locator('.ai-fab')).toHaveAttribute('aria-label', '收起 AI')
      await expect(ai(p2).getByTestId('ai-engine')).toHaveText('Codex')
      await expect(ai(p2).getByTestId('ai-msg').locator('.txt')).toHaveText(['这是测试回答（Codex）。'])
      await expect(ai(p2).locator('.um')).toHaveText(['你好'])
      expect(gitOut(vault, 'status', '--porcelain', '--untracked-files=all')).toBe('')
      // 新对话清空
      await ai(p2).getByRole('button', { name: '新对话' }).click()
      await expect(ai(p2).getByTestId('ai-msg')).toHaveCount(0)
    } finally {
      await app.close()
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('白板上让 AI 加卡片并排整齐：文件里对、一次提交、撤回还原', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await page.locator('.nav .si', { hasText: '旅行计划' }).click()
    await expect(pane(page).getByTestId('doc-board')).toBeVisible()
    // 以前写法的白板打开时转成新写法、单独一次提交（坐标换到新画布上：x + 4、y + 64）
    await expect.poll(() => gitOut(vault, 'log', '-1', '--format=%s')).toBe('白板改成按「##」分列：旅行计划')
    const converted = readFileSync(join(vault, '旅行计划.md'), 'utf8')
    const before = commits(vault)
    await page.keyboard.press('Meta+j')
    await send(page, '在白板上加卡片「订机票」「订租车」「看极光」，再排整齐')
    const msg = ai(page).getByTestId('ai-msg').last()
    // 白板开在屏幕上时 AI 一张一张拿、一张一张挪，人看得清（DESIGN.v3 2.3，每张约 1 秒）
    await expect(msg.locator('.txt')).toHaveText('我加 3 张卡片，再按网格排整齐。好了。', { timeout: 30_000 })
    // 字是边生成边出的，这一轮做完（提交好）才出改动预览
    await expect(msg.getByTestId('ai-change')).toContainText('改了1个文件')
    await expect(msg.getByTestId('ai-step')).toHaveText(['看白板上有什么', '加卡片「订机票」', '加卡片「订租车」', '加卡片「看极光」', '按网格排整齐'])
    await expect(msg.locator('.tstep.ok')).toHaveCount(5)

    // 白板上看得到，文件里对
    for (const t of ['订机票', '订租车', '看极光']) await expect(pane(page).locator('.db-card', { hasText: t })).toBeVisible()
    const md = readFileSync(join(vault, '旅行计划.md'), 'utf8')
    const cards = cardsOf(md)
    expect(cards.map((c) => c.text)).toEqual(['出发前先定住处', '冰岛环岛十天', '订机票', '订租车', '看极光'])
    // 网格：一行 3 个（5 张取平方根向上取整），从上到下、从左到右，原来的顺序是 b a 订机票 订租车 看极光
    const pos = Object.fromEntries(cards.map((c) => [c.text, [c.x, c.y]]))
    expect(pos['冰岛环岛十天']).toEqual([64, 144])
    expect(pos['出发前先定住处']![1]).toBe(144)
    expect(pos['订机票']![1]).toBe(144)
    expect(pos['订租车']![0]).toBe(64)
    expect(pos['看极光']![1]).toBe(pos['订租车']![1])
    expect(pos['订租车']![1]).toBeGreaterThan(144 + 60)
    // 白板上量出来不重叠
    const boxes = await pane(page).locator('.db-card').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as DOMRect))
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!
        const b = boxes[j]!
        expect(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top).toBe(true)
      }

    // 一次提交，只有这块白板
    expect(commits(vault)).toBe(before + 1)
    expect(gitOut(vault, 'log', '-1', '--format=%s')).toBe('AI：在白板上加卡片「订机票」「订租车」「看极光」，再排整齐')
    expect(gitOut(vault, 'show', '--name-only', '--format=', 'HEAD')).toBe('旅行计划.md')
    await expect(msg.getByTestId('ai-change')).toContainText('改了1个文件')
    expect(gitOut(vault, 'status', '--porcelain')).toBe('')

    // 撤回：文件回到原样，白板上的新卡片没了
    await msg.getByRole('button', { name: '撤回' }).click()
    await expect(msg.getByTestId('ai-change')).toContainText('已撤回')
    expect(readFileSync(join(vault, '旅行计划.md'), 'utf8')).toBe(converted)
    await expect(pane(page).locator('.db-card', { hasText: '订机票' })).toHaveCount(0)
    await expect(pane(page).locator('.db-card')).toHaveCount(2)
    await page.waitForTimeout(1200)
    expect(gitOut(vault, 'status', '--porcelain')).toBe('')
  } finally {
    await run.close()
  }
})

test('网页上让 AI 打开网址并读出标题：网页开在 AI 后面、底栏带「看网页」，点了地址栏是那个网址', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await page.locator('.nav .si', { hasText: '随笔' }).click()
    await expect(page.getByRole('complementary', { name: '网页' })).toHaveCount(0)
    await page.getByRole('navigation', { name: '右栏' }).getByRole('button', { name: '打开 AI' }).click()
    const url = `${base}/aurora`
    await send(page, `打开 ${url} 看看标题`)
    const msg = ai(page).getByTestId('ai-msg').last()
    await expect(msg.locator('.txt')).toContainText('网页标题是「极光预报站」', { timeout: 30_000 })
    await expect(msg.getByTestId('ai-step')).toHaveText(['打开网页 127.0.0.1', '读网页'])
    // 工作区方向 A（task-9okg5）：AI 看得见时网页开在 AI 那一组的后面，AI 不被换下去；底栏说一句，带「看网页」
    await expect(ai(page)).toBeVisible()
    await expect(page.getByTestId('dtab-web')).toHaveAttribute('aria-selected', 'false')
    await expect(page.getByTestId('toast')).toContainText('AI在「网页」标签里打开了127.0.0.1')
    // 「看得到」里有这个网页（在后面也算）
    await expect(page.getByTestId('ai-sees')).toContainText('网页：127.0.0.1')
    // 点「看网页」：换到网页标签，地址栏是那个网址
    await page.getByTestId('toast').getByRole('button', { name: '看网页' }).click()
    const web = page.getByRole('complementary', { name: '网页' })
    await expect(web).toBeVisible()
    await expect(web.getByRole('textbox', { name: '网址' })).toHaveValue(url.replace(/^http:\/\//, ''))
  } finally {
    await run.close()
  }
})

test('文档里让 AI 在光标处插入：用户没提交的字先单独提交，撤回 AI 的不带走用户的字', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await page.locator('.nav .si', { hasText: '随笔' }).click()
    await pane(page).locator('.cm-line', { hasText: '第一段' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type('用户加的')
    await waitSaved(page)
    await page.keyboard.press('Meta+j')
    await send(page, '在光标处插入「AI 写的一段」')
    const msg = ai(page).getByTestId('ai-msg').last()
    await expect(msg.locator('.txt')).toHaveText('插好了。')
    await expect(msg.getByTestId('ai-change')).toContainText('改了1个文件')
    await expect(msg.getByTestId('ai-step')).toHaveText(['读文档', '插入「AI 写的一段」'])
    await expect(pane(page).locator('.cm-content')).toContainText('AI 写的一段')
    expect(readFileSync(join(vault, '随笔.md'), 'utf8')).toBe('# 随笔\n\n第一段。用户加的\n\nAI 写的一段\n\n第二段。\n')
    expect(gitOut(vault, 'log', '-2', '--format=%s').split('\n')).toEqual(['AI：在光标处插入「AI 写的一段」', '更新 1 个文件：随笔'])

    await msg.getByRole('button', { name: '撤回' }).click()
    await expect(msg.getByTestId('ai-change')).toContainText('已撤回')
    await expect(pane(page).locator('.cm-content')).not.toContainText('AI 写的一段')
    expect(readFileSync(join(vault, '随笔.md'), 'utf8')).toBe('# 随笔\n\n第一段。用户加的\n\n第二段。\n')
  } finally {
    await run.close()
  }
})

test('/找重复：每一对列出来（两篇能点开、相似度、为什么），不改文件；没有就说没找到', async () => {
  const run = await launch(DREAM_VAULT, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await page.getByRole('navigation', { name: '右栏' }).getByRole('button', { name: '打开 AI' }).click()
    await send(page, '/找重复')
    const msg = ai(page).getByTestId('ai-msg').last()
    await expect(msg.locator('.txt')).toHaveText('找到1对可能重复的，像的在前：')
    const dup = msg.getByTestId('ai-dups').locator('.dup')
    await expect(dup).toHaveCount(1)
    // 一对两篇按路径先后：「剪藏/巴黎/…」排在「收件箱/…」前面（以前「素材/…」排在后面）
    await expect(dup.locator('.pair')).toHaveText(/^巴黎深度漫游指南↔巴黎自由行全景指南\d+%$/)
    await expect(dup.locator('.why')).toHaveText(/^两篇约\d+%的字句相同，都有「.+」$/)
    expect(gitStatus(vault)).toBe('')
    await page.screenshot({ path: test.info().outputPath('ai-dups.png') })
    await dup.getByRole('button', { name: '巴黎深度漫游指南' }).click()
    await expect(tabOn(page)).toHaveText('巴黎深度漫游指南')
  } finally {
    await run.close()
  }
  const plain = await launch(files, { CN_AI_FAKE: '1' })
  try {
    await plain.page.getByRole('navigation', { name: '右栏' }).getByRole('button', { name: '打开 AI' }).click()
    await send(plain.page, '/找重复')
    await expect(ai(plain.page).getByTestId('ai-msg').last().locator('.txt')).toHaveText('没找到重复的。')
  } finally {
    await plain.close()
  }
})

test('/现在梦游：跑完说整理了几条、分几组，按钮在右栏打开梦游报告；main 上的文件不动', async () => {
  const run = await launch(DREAM_VAULT, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await page.getByRole('navigation', { name: '右栏' }).getByRole('button', { name: '打开 AI' }).click()
    await send(page, '/现在梦游')
    const msg = ai(page).getByTestId('ai-msg').last()
    await expect(msg.locator('.txt')).toContainText('梦游跑完了：整理了6条，分4组（归类和改名3 · 补上的双链1 · 可能重复1 · 本周小结1）。改动在dream/', { timeout: 30_000 })
    expect(gitStatus(vault)).toBe('')
    await expect(page.getByRole('complementary', { name: '梦游报告' })).toHaveCount(0)
    await msg.getByRole('button', { name: '打开梦游报告' }).click()
    const panel = page.getByRole('complementary', { name: '梦游报告' })
    await expect(panel.getByTestId('dream-summary')).toContainText('整理了6处')
    await page.screenshot({ path: test.info().outputPath('ai-dream.png') })
    // AI 浮窗还在右下角；关了再开，按钮还在
    await expect(ai(page)).toBeVisible()
    await page.keyboard.press('Meta+j')
    await page.keyboard.press('Meta+j')
    await expect(msg.getByRole('button', { name: '打开梦游报告' })).toBeVisible()
  } finally {
    await run.close()
  }
})
