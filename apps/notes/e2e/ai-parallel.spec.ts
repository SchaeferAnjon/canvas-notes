// AI 对话同时跑（偏好「AI对话能同时跑」）：不同页的对话能同时答，同一段一次一问；对话菜单、全部对话里正在答的小转圈、答完没看一个点；
// 同时答的到了上限（默认 3 段）排队，输入框下面「同时在答 3 段，排在第 1 个 · 去看看」，前面答完自动开始；
// 全能模式下同一个文件同一时间只让一段对话写（后一段的步骤里「等另一段对话改完《X》」）；停下（esc、停下键）只停当前这段。
// 假 AI 一段一段放行：话里写「〔等放行 X〕」的那一问说出头几个字以后等 CN_FAKE_GATES 里出现 X 这个文件（fake-engine.ts）。
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { launch, openNote, type Running, tabOn } from './app'

const SHOTS = '/private/tmp/canvas-notes-visual/126-AI对话同时跑'
const files = { '甲篇.md': '# 甲篇\n\n甲的正文。\n', '乙篇.md': '# 乙篇\n\n乙的正文。\n', '丙篇.md': '# 丙篇\n\n丙的正文。\n', '丁篇.md': '# 丁篇\n\n丁的正文。\n' }

const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const menu = (page: Page) => page.getByRole('menu', { name: '对话' })
const last = (page: Page) => chat(page).getByTestId('ai-msg').last()
const stopKey = (page: Page) => chat(page).getByRole('button', { name: '停下' })
const gitOut = (vault: string, ...args: string[]) => execFileSync('git', ['-C', vault, ...args], { encoding: 'utf8' }).trim()

/** 放行一段：假 AI 接着往下答 */
const open = (gates: string, name: string) => writeFileSync(join(gates, name), '')

/** 薄荷 · B 浮岛书桌（交付图） */
const mint = (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: 'mint', frame: 'b' } }))
}

async function shot(run: Running, name: string) {
  mkdirSync(SHOTS, { recursive: true })
  await run.page.waitForTimeout(300)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(b64, 'base64'))
}

/** 打开一篇，右栏换成这一页的 AI（正聊着别的那段留着时点「切到这页的 AI」） */
async function goTo(page: Page, name: string) {
  await openNote(page, name)
  await expect(tabOn(page)).toHaveText(name)
  if (!(await chat(page).getByTestId('ai-conv').isVisible())) await page.keyboard.press('Meta+j')
  else if ((await chat(page).getByTestId('ai-conv').textContent()) !== name) await page.keyboard.press('Alt+Meta+j')
  await expect(chat(page).getByTestId('ai-conv')).toHaveText(name)
}

/** 拨开「记笔记」记进这篇本身（还没定记进哪篇时先问，点「这篇本身」） */
async function noteHere(page: Page) {
  // 开关按看的东西分（文档一个）：前一篇拨开了这篇就是开着的
  if ((await chat(page).getByTestId('ai-note-main').getAttribute('aria-checked')) === 'true') return
  await chat(page).getByTestId('ai-note-main').click()
  const self = page.getByTestId('ai-note-to-self')
  if (await self.isVisible().catch(() => false)) await self.click()
  await expect(chat(page).getByTestId('ai-note-main')).toHaveAttribute('aria-checked', 'true')
}

/** 发一句，不等答完（等到说出头几个字：在答了） */
async function say(page: Page, text: string) {
  const box = chat(page).getByRole('textbox', { name: '问 AI' })
  await box.fill(text)
  await box.press('Enter')
  await expect(chat(page).locator('.um').last()).toHaveText(text)
}

async function launchWith(gates: string, look?: (vault: string) => void) {
  const run = await launch(files, { CN_AI_FAKE: '1', CN_FAKE_GATES: gates }, look)
  await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900))
  return run
}

test('甲页在答时到乙页发一句，乙也在答；菜单里两段都转圈；乙答完时看着它不记点，甲答完没看记一个点；两段各自记进各自的笔记；停下键只停当前这段', async () => {
  test.setTimeout(180_000)
  const gates = mkdtempSync(join(tmpdir(), 'cn-gates-'))
  const run = await launchWith(gates, mint)
  const { page, vault } = run
  try {
    // 甲：记笔记记进甲篇本身，问一句（停在「还在答」）
    await goTo(page, '甲篇')
    await noteHere(page)
    await say(page, '甲篇讲了什么〔等放行 甲〕')
    await expect(last(page).locator('.txt')).toContainText('这是', { timeout: 15_000 })
    await expect(stopKey(page)).toBeVisible()

    // 乙：照样能发（以前发送键是灰的），也在答；下面没有「排在第几个」
    await goTo(page, '乙篇')
    await noteHere(page)
    await say(page, '乙篇讲了什么〔等放行 乙〕')
    await expect(last(page).locator('.txt')).toContainText('这是', { timeout: 15_000 })
    await expect(chat(page).getByTestId('ai-wait')).toHaveCount(0)

    // 对话菜单：这里（乙）转圈，「最近在别处问的」甲篇那一行也转圈
    await chat(page).getByTestId('ai-conv').click()
    await expect(menu(page).getByTestId('ai-convo').filter({ hasText: '乙篇讲了什么' }).getByTestId('ai-run-spin')).toBeVisible()
    await expect(menu(page).getByTestId('ai-page').filter({ hasText: '甲篇' }).getByTestId('ai-run-spin')).toBeVisible()
    await shot(run, '1-两段同时在答的菜单')
    // 全部对话里也是
    await menu(page).getByRole('menuitem', { name: '全部对话…' }).click()
    await expect(menu(page).getByTestId('ai-all-row').getByTestId('ai-run-spin')).toHaveCount(2)
    await shot(run, '2-全部对话两段转圈')
    await chat(page).getByTestId('ai-conv').click()
    await expect(menu(page)).toHaveCount(0)

    // 乙先答完（正看着它）：不记点；甲还在答
    open(gates, '乙')
    await expect(last(page).locator('.txt')).toHaveText('这是测试回答（Claude Code）。', { timeout: 15_000 })
    await expect(chat(page).getByTestId('ai-noted').last()).toContainText('已记进《乙篇》', { timeout: 15_000 })
    // 甲答完（没在看它）：头上胶囊一个点，菜单里甲那一行一个点
    open(gates, '甲')
    await expect(chat(page).getByTestId('ai-conv-dot')).toBeVisible({ timeout: 15_000 })
    await chat(page).getByTestId('ai-conv').click()
    await expect(menu(page).getByTestId('ai-page').filter({ hasText: '甲篇' }).getByTestId('ai-run-dot')).toBeVisible()
    await expect(menu(page).getByTestId('ai-convo').filter({ hasText: '乙篇讲了什么' }).getByTestId('ai-run-dot')).toHaveCount(0)
    await shot(run, '3-甲答完没看一个点')
    // 点开甲：点没了；各自记进各自的笔记
    await menu(page).getByTestId('ai-page').filter({ hasText: '甲篇' }).click()
    await expect(chat(page).getByTestId('ai-conv')).toHaveText('甲篇')
    await expect(chat(page).getByTestId('ai-conv-dot')).toHaveCount(0)
    await expect(chat(page).getByTestId('ai-noted').last()).toContainText('已记进《甲篇》', { timeout: 15_000 })
    await expect.poll(() => readFileSync(join(vault, '甲篇.md'), 'utf8')).toContain('### 甲篇讲了什么〔等放行 甲〕')
    await expect.poll(() => readFileSync(join(vault, '乙篇.md'), 'utf8')).toContain('### 乙篇讲了什么〔等放行 乙〕')
    expect(readFileSync(join(vault, '甲篇.md'), 'utf8')).not.toContain('乙篇讲了什么')
    expect(readFileSync(join(vault, '乙篇.md'), 'utf8')).not.toContain('甲篇讲了什么')

    // 停下只停当前这段：甲、乙又各问一句，看着甲按停下键，乙照样答完
    await say(page, '甲再问一句〔等放行 甲2〕')
    await expect(last(page).locator('.txt')).toContainText('这是', { timeout: 15_000 })
    await goTo(page, '乙篇')
    await say(page, '乙再问一句〔等放行 乙2〕')
    await expect(last(page).locator('.txt')).toContainText('这是', { timeout: 15_000 })
    await goTo(page, '甲篇')
    await stopKey(page).click()
    await expect(last(page)).toContainText('停下了', { timeout: 15_000 })
    await chat(page).getByTestId('ai-conv').click()
    await expect(menu(page).getByTestId('ai-page').filter({ hasText: '乙篇' }).getByTestId('ai-run-spin')).toBeVisible()
    await chat(page).getByTestId('ai-conv').click()
    open(gates, '乙2')
    await goTo(page, '乙篇')
    await expect(last(page).locator('.txt')).toHaveText('这是测试回答（Claude Code）。', { timeout: 15_000 })
  } finally {
    await run.close()
  }
})

test('同时答满 3 段时第 4 段排队：输入框下面「同时在答 3 段，排在第 1 个 · 去看看」、菜单「排第 1」，点「去看看」到最早那段；前面一段答完它自动开始', async () => {
  test.setTimeout(180_000)
  const gates = mkdtempSync(join(tmpdir(), 'cn-gates-'))
  const run = await launchWith(gates, mint)
  const { page } = run
  try {
    await goTo(page, '甲篇')
    for (const [i, name] of ['甲', '乙', '丙'].entries()) {
      if (i) await goTo(page, `${name}篇`)
      await say(page, `${name}篇讲了什么〔等放行 ${name}〕`)
      await expect(last(page).locator('.txt')).toContainText('这是', { timeout: 15_000 })
    }
    // 第 4 段：发得出去，排队，写明排第几、为什么；停下键在（排着时能不排）
    await goTo(page, '丁篇')
    await say(page, '丁篇讲了什么〔等放行 丁〕')
    const wait = chat(page).getByTestId('ai-wait')
    await expect(wait).toHaveText('同时在答 3 段，排在第 1 个·去看看')
    await expect(stopKey(page)).toBeVisible()
    await expect(last(page)).toHaveAttribute('aria-busy', 'true')
    await expect(last(page).locator('.thinking')).toHaveText('排在第 1 个，前面答完自动开始…')
    await shot(run, '4-第4段排队')
    await chat(page).getByTestId('ai-conv').click()
    await expect(menu(page).getByTestId('ai-convo').filter({ hasText: '丁篇讲了什么' }).getByTestId('ai-run-queue')).toHaveText('排第 1')
    await shot(run, '5-菜单里排第1')
    await chat(page).getByTestId('ai-conv').click()
    // 去看看：到最早开始答的甲
    await wait.getByTestId('ai-wait-go').click()
    await expect(chat(page).getByTestId('ai-conv')).toHaveText('甲篇')
    // 甲答完：丁自动开始（放行了丁的，丁答完）
    open(gates, '丁')
    open(gates, '甲')
    await expect(last(page).locator('.txt')).toHaveText('这是测试回答（Claude Code）。', { timeout: 15_000 })
    await goTo(page, '丁篇')
    await expect(chat(page).getByTestId('ai-wait')).toHaveCount(0)
    await expect(last(page).locator('.txt')).toHaveText('这是测试回答（Claude Code）。', { timeout: 15_000 })
    open(gates, '乙')
    open(gates, '丙')
  } finally {
    await run.close()
  }
})

test('全能模式下两段对话改同一个文件：后一段等着（步骤里「等另一段对话改完《丙篇》」），前一段答完提交了它才写，两次提交各是各的', async () => {
  test.setTimeout(180_000)
  const gates = mkdtempSync(join(tmpdir(), 'cn-gates-'))
  const run = await launchWith(gates)
  const { page, vault } = run
  try {
    await goTo(page, '甲篇')
    await say(page, '排队在「丙篇.md」末尾加「甲加的一行」〔等放行 甲〕')
    await expect(last(page).locator('.txt')).toContainText('加好', { timeout: 15_000 })
    await expect.poll(() => readFileSync(join(vault, '丙篇.md'), 'utf8')).toContain('甲加的一行')
    await goTo(page, '乙篇')
    await say(page, '排队在「丙篇.md」末尾加「乙加的一行」〔等放行 乙〕')
    await expect(last(page).getByText('等另一段对话改完《丙篇》')).toBeVisible({ timeout: 15_000 })
    // 乙放行了也还等着：甲没答完，丙篇里没有乙的字
    open(gates, '乙')
    await page.waitForTimeout(800)
    expect(readFileSync(join(vault, '丙篇.md'), 'utf8')).not.toContain('乙加的一行')
    // 甲答完、提交：乙接着写、答完
    open(gates, '甲')
    await expect(last(page).locator('.txt')).toContainText('加好了「乙加的一行」', { timeout: 15_000 })
    await expect.poll(() => gitOut(vault, 'log', '--format=%s', '-3')).toMatch(/^AI：排队在「丙篇\.md」末尾加「乙加的一行」.*\nAI：排队在「丙篇\.md」末尾加「甲加的一行」/)
    const first = gitOut(vault, 'show', 'HEAD~1', '--format=', '-U0', '--', '丙篇.md')
    const second = gitOut(vault, 'show', 'HEAD', '--format=', '-U0', '--', '丙篇.md')
    expect(first).toMatch(/^\+.*甲加的一行/m)
    expect(first).not.toContain('乙加的一行')
    expect(second).toMatch(/^\+.*乙加的一行/m)
    expect(second).not.toContain('甲加的一行')
    expect(gitOut(vault, 'status', '--porcelain')).toBe('')
  } finally {
    await run.close()
  }
})

test('两段都在改开着的文档时按 esc 只停右栏看着的那段，另一段照样做完提交', async () => {
  test.setTimeout(180_000)
  const gates = mkdtempSync(join(tmpdir(), 'cn-gates-'))
  const run = await launchWith(gates)
  const { page, vault } = run
  try {
    await goTo(page, '甲篇')
    await say(page, '排队在「甲篇.md」末尾加「甲加的一行」〔等放行 甲〕')
    await expect(last(page).locator('.txt')).toContainText('加好', { timeout: 15_000 })
    await goTo(page, '乙篇')
    await say(page, '排队在「乙篇.md」末尾加「乙加的一行」〔等放行 乙〕')
    await expect(last(page).locator('.txt')).toContainText('加好', { timeout: 15_000 })
    // 乙篇开着、AI 正在改它：esc 停乙（右栏看着的那段），甲接着答
    await expect(page.locator('[data-testid="ai-actbar"]:visible').first()).toContainText('AI 正在改这篇', { timeout: 15_000 })
    await page.locator('body').press('Escape')
    await expect(last(page)).toContainText('停下了', { timeout: 15_000 })
    await chat(page).getByTestId('ai-conv').click()
    await expect(menu(page).getByTestId('ai-page').filter({ hasText: '甲篇' }).getByTestId('ai-run-spin')).toBeVisible()
    await chat(page).getByTestId('ai-conv').click()
    open(gates, '甲')
    await expect.poll(() => gitOut(vault, 'log', '--format=%s', '-5'), { timeout: 15_000 }).toContain('AI：排队在「甲篇.md」末尾加「甲加的一行」')
    await goTo(page, '甲篇')
    await expect(last(page).locator('.txt')).toHaveText('加好了「甲加的一行」。')
  } finally {
    await run.close()
  }
})
