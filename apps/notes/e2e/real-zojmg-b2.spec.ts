// 真的 Claude Code：英文版第二批里交给 AI 的两项（task-zojmg）。英文界面在文档里打 /，用英文名筛出「AI: write a paragraph」
// 「AI: summarize this page」，真问真答，写进文档的那段是英文（默认跟界面语言）。在本机跑：
//   env -i HOME="$HOME" USER="$USER" LOGNAME="$LOGNAME" PATH="$PATH" TMPDIR="$TMPDIR" ANTHROPIC_API_KEY="$(dispatch env get CN_TEST_ANTHROPIC_API_KEY)" CN_REAL_AI=1 npx playwright test e2e/real-zojmg-b2.spec.ts
// （去掉父会话的 CLAUDE_* 环境变量；测试专用的 API key 只在运行时交给 claude 进程，不写进仓库和日志。）测试模式、临时库、临时设置目录；
// CN_AI_MODEL=sonnet，effort 选 Low。跑完只删这次产生的 Claude 会话记录（按临时库路径起名的那个文件夹）。
import { expect, test, type Page } from '@playwright/test'
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { launch, openAi, pane, type Running } from './app'

test.skip(!process.env.CN_REAL_AI, '真 AI 才跑：CN_REAL_AI=1')
test.setTimeout(300_000)

const HAN = /\p{Script=Han}/u
const FIRST = 'We land at Keflavík on Monday and drive to Reykjavík. Day two is the south coast.'
const NOTE = `# Iceland\n\n${FIRST}\n`
/** AI 写进文档的包在 [!ai] 块里（task-dtc34）：块头「AI 写的 · …」跟库语言（这是没记语言的旧库，中文），只看块里的字 */
const aiText = (s: string) => s.split('\n').filter((l) => !/^>\s*\[!ai\]/.test(l)).map((l) => l.replace(/^>\s?/, '')).join('\n').trim()

function forgetSessions(run: Running) {
  const claude = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
  const projects = join(claude, 'projects')
  const stamp = dirname(run.vault).split('/').pop()!
  const mine = existsSync(projects) ? readdirSync(projects).filter((d) => d.includes(stamp)) : []
  const ids = mine.flatMap((d) => readdirSync(join(projects, d)).filter((f) => f.endsWith('.jsonl')).map((f) => f.slice(0, -6)))
  for (const d of mine) rmSync(join(projects, d), { recursive: true, force: true })
  for (const sub of ['session-env', 'file-history', 'todos', 'tasks']) {
    const dir = join(claude, sub)
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir)) if (ids.some((id) => f.startsWith(id))) rmSync(join(dir, f), { recursive: true, force: true })
  }
  console.log(`删掉了这次的会话记录：${mine.join('、') || '（没有）'}（会话 ${ids.join('、') || '无'}）`)
}

/** Claude Code（Sonnet · Low）：effort 在 AI 对话的引擎条上选，/ 菜单交给 AI 的也照它 */
async function lowEffort(page: Page) {
  await openAi(page)
  const chat = page.getByRole('complementary', { name: /^(AI 对话|AI chat)$/ })
  await chat.getByTestId('ai-effort').click()
  await page.getByRole('menu', { name: /^(想多久（effort）|.*effort.*)$/ }).getByRole('menuitemradio', { name: /^Low/ }).click()
}

/** 等文件满足 ok、而且连着两次读（隔 1.5 秒）一样：AI 写完、存完；等不到时把文件现在的样子打出来 */
async function settled(read: () => string, ok: (t: string) => boolean) {
  let last = ''
  try {
    await expect
      .poll(
        () => {
          const t = read()
          const done = ok(t) && t === last
          last = t
          return done
        },
        { timeout: 200_000, intervals: [1500] },
      )
      .toBe(true)
  } catch (e) {
    console.log(`等不到，文件现在是：\n${read()}`)
    throw e
  }
}

/**
 * 在文档末尾（给了 after 就在那一行后面）另起一行，打 / 和筛的字，回车选第一项。
 * 写过一段以后文末是那块 [!ai]（task-dtc34），在块里另起一行还在块里，所以第二次接在原来那一段后面
 */
async function slash(page: Page, q: string, after?: string) {
  if (after) {
    await pane(page).locator('.cm-line', { hasText: after }).click()
    await page.keyboard.press('End')
  } else {
    await pane(page).locator('.cm-content').click()
    await page.keyboard.press('Meta+ArrowDown')
  }
  await page.keyboard.press('Enter')
  await page.keyboard.type('/' + q, { delay: 30 })
  // 机器忙时（别的会话同时跑 e2e）菜单晚几秒才出来
  await expect(page.locator('.slash-menu')).toBeVisible({ timeout: 15_000 })
  await page.keyboard.press('Enter')
}

test('英文界面：/ 菜单打英文筛出交给 AI 的两项，真问真答，写进文档的是英文', async () => {
  const run = await launch({ 'Iceland.md': NOTE }, { CN_AI_MODEL: 'sonnet', CN_LANG: 'en' })
  const { page, vault } = run
  const file = () => readFileSync(join(vault, 'Iceland.md'), 'utf8')
  try {
    await lowEffort(page)
    await page.keyboard.press('Meta+k')
    await page.getByRole('dialog', { name: 'Search and commands' }).getByRole('textbox').first().fill('Iceland')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('tab-on')).toHaveText('Iceland')

    // AI: write a paragraph：小框是英文，说一句要写什么，回车；写好插在光标处
    await slash(page, 'write')
    const box = page.getByRole('dialog', { name: 'AI: write a paragraph' })
    await expect(box).toBeVisible()
    await expect(box.getByRole('textbox', { name: 'What should AI write' })).toHaveAttribute('placeholder', 'Continue from here, or say what to write')
    await box.getByRole('textbox').fill('Two short sentences on what to pack for the cold.')
    await box.getByRole('textbox').press('Enter')
    // 小框在 AI 开始写的那一刻收起；等写完、存进文件（字数停下来不再变）
    await expect(box).toHaveCount(0, { timeout: 200_000 })
    await settled(file, (t) => t.slice(NOTE.length).trim().length > 20)
    const wrote = file().slice(NOTE.length).trim()
    console.log(`写的一段：${wrote}`)
    expect(wrote.length).toBeGreaterThan(20)
    expect(HAN.test(aiText(wrote))).toBe(false)

    // AI: summarize this page：一打开就开始，写成三句话放在开头（标题下面）
    await slash(page, 'summarize', 'Day two is the south coast.')
    await expect(page.getByRole('dialog', { name: 'AI: summarize this page' })).toHaveCount(0, { timeout: 200_000 })
    // 总结常常也拿「We land at」开头：找原来那一段的整句，从后往前找
    await settled(file, (t) => t.lastIndexOf(FIRST) - '# Iceland\n\n'.length > 20)
    const after = file()
    const summary = after.slice('# Iceland\n\n'.length, after.lastIndexOf(FIRST)).trim()
    console.log(`总结：${summary}`)
    expect(summary.length).toBeGreaterThan(20)
    expect(HAN.test(aiText(summary))).toBe(false)
  } finally {
    try {
      await run.close()
    } finally {
      forgetSessions(run)
    }
  }
})

// 插进笔记的字跟笔记的语言（slash-menu.tsx 的 aiSystem：「用英文（除非笔记是别的语言）」）：英文界面里总结一篇中文笔记，写的是中文
const ZH_FIRST = '周一落地凯夫拉维克，开车去雷克雅未克。第二天走南岸，看塞里雅兰瀑布和维克的黑沙滩。'
const ZH_NOTE = `# 冰岛\n\n${ZH_FIRST}\n`

test('英文界面、中文笔记：AI 总结这页跟笔记写中文', async () => {
  const run = await launch({ '冰岛.md': ZH_NOTE }, { CN_AI_MODEL: 'sonnet', CN_LANG: 'en' })
  const { page, vault } = run
  const file = () => readFileSync(join(vault, '冰岛.md'), 'utf8')
  try {
    await lowEffort(page)
    await page.keyboard.press('Meta+k')
    await page.getByRole('dialog', { name: 'Search and commands' }).getByRole('textbox').first().fill('冰岛')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('tab-on')).toHaveText('冰岛')
    await slash(page, 'summarize')
    await expect(page.getByRole('dialog', { name: 'AI: summarize this page' })).toHaveCount(0, { timeout: 200_000 })
    await settled(file, (t) => t.lastIndexOf(ZH_FIRST) - '# 冰岛\n\n'.length > 20)
    const after = file()
    const summary = after.slice('# 冰岛\n\n'.length, after.lastIndexOf(ZH_FIRST)).trim()
    console.log(`总结：${summary}`)
    expect(summary.length).toBeGreaterThan(20)
    // 句子是中文（地名可以带外文）：汉字比拉丁字母的词多得多
    expect((summary.match(/\p{Script=Han}/gu) ?? []).length).toBeGreaterThan((summary.match(/\p{Script=Latin}+/gu) ?? []).length * 3)
  } finally {
    try {
      await run.close()
    } finally {
      forgetSessions(run)
    }
  }
})
