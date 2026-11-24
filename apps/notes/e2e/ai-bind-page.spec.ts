// AI 对话绑页面（方向 A「对话留着，页面认领」，2026-11-24，design/ai-bind-page/）：换页时右栏那段对话不换走；
// 右栏空着（AI 收着，或这段没问过、输入框没字、没带引用）才接上这一页的对话；正聊着别的就只在头上露「这页有 N 段对话 · 打开 ⌥⌘J」。
// 「留在这个对话」那张表并进「这段 → 那页」表（主进程 userData/ai/chats/<库>/pages.json），本机 localStorage 的旧表搬一次。
import { expect, test, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { launch, leftView, openNote, tabOn } from './app'

const SHOTS = '/private/tmp/canvas-notes-visual/112-AI对话绑页面施工'

const files = { '甲篇.md': '# 甲篇\n\n甲的正文。\n', '乙篇.md': '# 乙篇\n\n乙的正文。\n', '丙篇.md': '# 丙篇\n\n丙的正文。\n', '课程/生物/丁篇.md': '# 丁篇\n\n丁的正文。\n' }

const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const tree = (page: Page) => page.locator('aside.side').getByRole('tree')
const away = (page: Page) => chat(page).getByTestId('ai-away')

async function openDoc(page: Page, name: string) {
  if (name === '丁篇') {
    await openNote(page, name)
    return expect(tabOn(page)).toHaveText(name)
  }
  await leftView(page, '文件')
  await tree(page).getByRole('treeitem').filter({ has: page.locator('.truncate', { hasText: new RegExp(`^${name}$`) }) }).first().click()
  await expect(tabOn(page)).toHaveText(name)
}

async function ask(page: Page, text: string) {
  const box = chat(page).getByRole('textbox', { name: '问 AI' })
  await box.fill(text)
  await box.press('Enter')
  await expect(chat(page).getByTestId('ai-msg').last().locator('.txt')).toHaveText('这是测试回答（Claude Code）。', { timeout: 15_000 })
}

test('换页不换走正聊的那段，头上「这是在《甲篇》问的」；这页有对话时「这页有 1 段对话 · 打开」点了切过去；右栏空着时接上这页的对话、胶囊闪一下；输入框有字不接；AI 收着时打开是这页的', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await openDoc(page, '甲篇')
    await page.keyboard.press('Meta+j')
    await ask(page, '甲篇讲了什么')

    // 1. 换到乙篇：右栏还是甲篇那段，头上「这是在《甲篇》问的 · 切到《乙篇》的 AI ⌥⌘J」（乙篇还没对话）
    await openDoc(page, '乙篇')
    await expect(chat(page).getByTestId('ai-conv')).toHaveText('甲篇')
    await expect(chat(page).locator('.um')).toHaveText(['甲篇讲了什么'])
    await expect(away(page)).toHaveText('这是在《甲篇》问的切到《乙篇》的 AI⌥⌘J')
    await expect(chat(page).getByTestId('ai-sees')).toHaveCount(0)
    // 接着问还是甲篇那段
    await ask(page, '再说一点')
    await expect(chat(page).locator('.um')).toHaveText(['甲篇讲了什么', '再说一点'])

    // 2. ⌥⌘J 切到乙篇的 AI：空的乙篇对话，问一句
    await page.keyboard.press('Alt+Meta+j')
    await expect(chat(page).getByTestId('ai-conv')).toHaveText('乙篇')
    await expect(away(page)).toHaveCount(0)
    await expect(chat(page).getByTestId('ai-msg')).toHaveCount(0)
    await ask(page, '乙篇讲了什么')

    // 3. 回到甲篇：正聊着乙篇，只出顶条「这页有 1 段对话 · 打开」，不打断
    await openDoc(page, '甲篇')
    await expect(chat(page).getByTestId('ai-conv')).toHaveText('乙篇')
    await expect(away(page)).toHaveText('这是在《乙篇》问的这页有 1 段对话 · 打开⌥⌘J')
    await expect(away(page).locator('.k')).toHaveText('⌥⌘J')
    const bar = await away(page).getByTestId('ai-follow').boundingBox()
    expect(Math.round(bar!.height)).toBe(22)
    // 点「打开」：切到甲篇的对话
    await away(page).getByTestId('ai-follow').click()
    await expect(chat(page).getByTestId('ai-conv')).toHaveText('甲篇')
    await expect(chat(page).locator('.um')).toHaveText(['甲篇讲了什么', '再说一点'])
    await expect(away(page)).toHaveCount(0)

    // 4. 到丙篇（甲篇那段留着）→ ⌥⌘J 换成丙篇的空对话；这时右栏算空着，换到乙篇就接上乙篇那段，胶囊闪一下
    await openDoc(page, '丙篇')
    await expect(away(page)).toHaveText('这是在《甲篇》问的切到《丙篇》的 AI⌥⌘J')
    await page.keyboard.press('Alt+Meta+j')
    await expect(chat(page).getByTestId('ai-conv')).toHaveText('丙篇')
    await openDoc(page, '乙篇')
    await expect(chat(page).getByTestId('ai-conv')).toHaveText('乙篇')
    await expect(chat(page).locator('.um')).toHaveText(['乙篇讲了什么'])
    await expect(away(page)).toHaveCount(0)
    await expect(chat(page).getByTestId('ai-conv')).toHaveClass(/joined/)
    await expect(chat(page).getByTestId('ai-sees').locator('.chip').first()).toHaveText('文档：乙篇')

    // 5. 空对话但输入框里有字：不算空着，换页留着丙篇那段，打的字还在
    await openDoc(page, '丙篇')
    await expect(chat(page).getByTestId('ai-conv')).toHaveText('乙篇')
    await page.keyboard.press('Alt+Meta+j')
    await expect(chat(page).getByTestId('ai-conv')).toHaveText('丙篇')
    await expect(away(page)).toHaveCount(0)
    await chat(page).getByRole('textbox', { name: '问 AI' }).fill('打了一半')
    await openDoc(page, '甲篇')
    await expect(chat(page).getByTestId('ai-conv')).toHaveText('丙篇')
    await expect(chat(page).getByRole('textbox', { name: '问 AI' })).toHaveValue('打了一半')
    await expect(away(page)).toHaveText('这是在《丙篇》问的这页有 1 段对话 · 打开⌥⌘J')
    await chat(page).getByRole('textbox', { name: '问 AI' }).fill('')

    // 6. AI 收着：换页不留，打开时是这一页的
    await away(page).getByTestId('ai-follow').click()
    await expect(chat(page).getByTestId('ai-conv')).toHaveText('甲篇')
    await page.keyboard.press('Meta+j')
    await expect(chat(page)).toBeHidden()
    await openDoc(page, '乙篇')
    await page.keyboard.press('Meta+j')
    await expect(chat(page).getByTestId('ai-conv')).toHaveText('乙篇')
    await expect(chat(page).locator('.um')).toHaveText(['乙篇讲了什么'])
    await expect(away(page)).toHaveCount(0)
  } finally {
    await run.close()
  }
})

test('「留在这个对话」的旧表（localStorage cn.webStay：网页 → 那段）开软件时搬进主进程的「这段 → 那页」表，旧的删掉', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await expect(tabOn(page)).toBeVisible()
    await page.evaluate(() => localStorage.setItem('cn.webStay', JSON.stringify({ 'https://zh.d2l.ai/a.html': { key: 'file:甲篇.md', label: '甲篇' } })))
    await page.reload()
    const file = join(dirname(vault), 'user-data/ai/chats', createHash('sha1').update(vault).digest('hex').slice(0, 12), 'pages.json')
    await expect.poll(() => existsSync(file)).toBe(true)
    const pages = JSON.parse(readFileSync(file, 'utf8')) as Record<string, { page: string; label: string; at: number }>
    expect(pages['file:甲篇.md']).toMatchObject({ page: 'read:web:https://zh.d2l.ai/a.html', label: '甲篇' })
    await expect.poll(() => page.evaluate(() => localStorage.getItem('cn.webStay'))).toBeNull()
  } finally {
    await run.close()
  }
})

test('首页点「+」：问过的那段收进对话菜单「之前的对话」不丢，点几次都在；点一条切回接着问，空的新对话不收', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page } = run
  const menu = page.getByRole('menu', { name: '对话' })
  try {
    await page.keyboard.press('Meta+j')
    await expect(chat(page).getByTestId('ai-conv')).toHaveText('首页')
    await ask(page, '第一段问的')
    await chat(page).getByRole('button', { name: '新对话' }).click()
    await expect(chat(page).getByTestId('ai-msg')).toHaveCount(0)
    await ask(page, '第二段问的')
    await chat(page).getByRole('button', { name: '新对话' }).click()
    await expect(chat(page).getByTestId('ai-msg')).toHaveCount(0)
    // 空的这段再点「+」：不多收一段空的
    await chat(page).getByRole('button', { name: '新对话' }).click()
    await chat(page).getByTestId('ai-conv').click()
    await expect(menu.getByTestId('ai-older').locator('.lb')).toHaveText(['第二段问的', '第一段问的'])
    // 切回第一段：问答回来，接着问
    await menu.getByTestId('ai-older').filter({ hasText: '第一段问的' }).click()
    await expect(chat(page).locator('.um')).toHaveText(['第一段问的'])
    await ask(page, '接着第一段')
    await expect(chat(page).locator('.um')).toHaveText(['第一段问的', '接着第一段'])
    // 现在这段是第一段；第二段还在菜单里（空的那段不收）
    await chat(page).getByTestId('ai-conv').click()
    await expect(menu.getByTestId('ai-older').locator('.lb')).toHaveText(['第二段问的'])
    await page.keyboard.press('Escape')
  } finally {
    await run.close()
  }
})

test('找回以前点「+」清掉的对话：Claude Code 留着的会话记录（没被引用的）收进首页的「之前的对话」，点了能看、接着问；只读不改那份记录', async () => {
  const cdir = mkdtempSync(join(tmpdir(), 'cn-claude-'))
  const prompt = (text: string) => `模式说明\n当前标签：首页\n右栏网页：没开\n\n用户说：\n${text}\n\n【语言】用中文答。`
  let jsonl = ''
  const run = await launch(files, { CN_AI_FAKE: '1', CN_CLAUDE_DIR: cdir }, (vault) => {
    const proj = join(cdir, 'projects', realpathSync(vault).replace(/[^a-zA-Z0-9]/g, '-'))
    mkdirSync(proj, { recursive: true })
    jsonl = join(proj, '11111111-2222-3333-4444-555555555555.jsonl')
    writeFileSync(
      jsonl,
      [
        { type: 'user', timestamp: '2026-11-20T10:00:00Z', message: { role: 'user', content: prompt('以前首页问的') } },
        { type: 'assistant', timestamp: '2026-11-20T10:00:05Z', message: { content: [{ type: 'text', text: '以前的回答' }] } },
      ]
        .map((x) => JSON.stringify(x))
        .join('\n'),
    )
  })
  const { page } = run
  const menu = page.getByRole('menu', { name: '对话' })
  try {
    const before = readFileSync(jsonl, 'utf8')
    await page.keyboard.press('Meta+j')
    await expect(chat(page).getByTestId('ai-conv')).toHaveText('首页')
    await chat(page).getByTestId('ai-conv').click()
    await expect(menu.getByTestId('ai-older').locator('.lb')).toHaveText(['以前首页问的'])
    await menu.getByTestId('ai-older').click()
    await expect(chat(page).locator('.um')).toHaveText(['以前首页问的'])
    await expect(chat(page).getByTestId('ai-msg').locator('.txt')).toHaveText(['以前的回答'])
    await ask(page, '接着问')
    await expect(chat(page).locator('.um')).toHaveText(['以前首页问的', '接着问'])
    expect(readFileSync(jsonl, 'utf8')).toBe(before)
  } finally {
    await run.close()
    rmSync(cdir, { recursive: true, force: true })
  }
})

test('对话菜单按页归组：「这里」是这页的几段，「最近在别处问的」一行一页（路径、几段、展开看那页的几段）；「全部对话」按文件夹归组、能搜、点一段切回接着问；「挂到这一页」把那段搬过来', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page } = run
  const menu = page.getByRole('menu', { name: '对话' })
  const follow = () => away(page).getByTestId('ai-follow').click()
  const plus = () => chat(page).getByRole('button', { name: '新对话' }).click()
  try {
    // 丁篇（课程/生物 里）两段、乙篇两段
    await openDoc(page, '丁篇')
    await page.keyboard.press('Meta+j')
    await ask(page, '丁一 光合作用')
    await plus()
    await ask(page, '丁二 呼吸作用')
    await openDoc(page, '乙篇')
    await follow()
    await ask(page, '乙一 光合作用的条件')
    await plus()
    await ask(page, '乙二 细胞')
    // 到丙篇：右栏留着乙篇那段，切到丙篇的空对话
    await openDoc(page, '丙篇')
    await follow()
    await expect(chat(page).getByTestId('ai-conv')).toHaveText('丙篇')

    await chat(page).getByTestId('ai-conv').click()
    await expect(menu.locator('.mh')).toHaveText(['这里', '最近在别处问的'])
    await expect(menu.getByTestId('ai-convo').locator('.lb')).toHaveText(['丙篇'])
    const pages = menu.getByTestId('ai-page')
    await expect(pages.locator('.lb')).toHaveText(['乙篇', '丁篇'])
    await expect(pages.locator('.path')).toHaveText(['课程 › 生物'])
    await expect(pages.locator('.r')).toHaveText([/^2 段 · 今天 \d\d:\d\d$/, /^2 段 · 今天 \d\d:\d\d$/])
    // 展开丁篇：那页的两段，新的在上
    await menu.getByRole('button', { name: '展开《丁篇》的几段' }).click()
    await expect(menu.locator('.it.sub .lb')).toHaveText(['丁二 呼吸作用', '丁一 光合作用'])
    mkdirSync(SHOTS, { recursive: true })
    await page.screenshot({ path: join(SHOTS, '1-对话菜单按页归组.png') })
    // 点页名：回到那页最近那段
    await pages.filter({ hasText: '乙篇' }).click()
    await expect(chat(page).locator('.um')).toHaveText(['乙二 细胞'])
    await expect(away(page)).toContainText('这是在《乙篇》问的')

    // 全部对话：两处四段，按页归组；搜「光合」筛出两段；点丁一切回去接着问
    await chat(page).getByTestId('ai-conv').click()
    await menu.getByRole('menuitem', { name: '全部对话…' }).click()
    await expect(menu.locator('.gh')).toHaveText(['乙篇 · 2 段', '课程 › 生物 › 丁篇 · 2 段'])
    await expect(menu.getByTestId('ai-all-row')).toHaveCount(4)
    await menu.getByRole('searchbox', { name: '搜对话' }).fill('光合')
    await expect(menu.getByTestId('ai-all-row').locator('.lb')).toHaveText(['乙一 光合作用的条件', '丁一 光合作用'])
    await page.screenshot({ path: join(SHOTS, '2-全部对话-搜光合.png') })
    // 输入法还在组字时的回车是给输入法的：不跳进第一段，菜单还开着
    await menu.getByRole('searchbox', { name: '搜对话' }).evaluate((el) => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })))
    await expect(menu.getByTestId('ai-all-row')).toHaveCount(2)
    await expect(chat(page).locator('.um')).toHaveText(['乙二 细胞'])
    await menu.getByTestId('ai-all-row').filter({ hasText: '丁一 光合作用' }).click()
    await expect(chat(page).locator('.um')).toHaveText(['丁一 光合作用'])
    await expect(away(page)).toContainText('这是在《丁篇》问的')
    await ask(page, '接着丁一')
    await expect(chat(page).locator('.um')).toHaveText(['丁一 光合作用', '接着丁一'])

    // 挂到这一页《丙篇》：这段搬到丙篇（头上那一行不再出，菜单「这里」里有它、打勾），丁篇留一段空的、收起来的丁二还在
    await chat(page).getByTestId('ai-conv').click()
    await menu.getByRole('menuitem', { name: '挂到这一页《丙篇》' }).click()
    await expect(away(page)).toHaveCount(0)
    await expect(chat(page).getByTestId('ai-sees').locator('.chip').first()).toHaveText('文档：丙篇')
    await expect(chat(page).locator('.um')).toHaveText(['丁一 光合作用', '接着丁一'])
    await chat(page).getByTestId('ai-conv').click()
    await expect(menu.getByTestId('ai-convo').filter({ hasText: '丁一 光合作用' })).toHaveAttribute('aria-checked', 'true')
    await menu.getByRole('button', { name: '展开《丁篇》的几段' }).click()
    await expect(menu.locator('.it.sub .lb')).toHaveText(['丁二 呼吸作用'])
    await page.keyboard.press('Escape')
    // 换到丁篇再回丙篇：搬过来的那段跟着丙篇
    await openDoc(page, '丁篇')
    await expect(away(page)).toContainText('这是在《丙篇》问的')
    await follow()
    await expect(chat(page).getByTestId('ai-msg')).toHaveCount(0)
    await openDoc(page, '丙篇')
    await chat(page).getByTestId('ai-conv').click()
    await menu.getByTestId('ai-convo').filter({ hasText: '丁一 光合作用' }).click()
    await expect(chat(page).locator('.um')).toHaveText(['丁一 光合作用', '接着丁一'])
    await expect(away(page)).toHaveCount(0)
  } finally {
    await run.close()
  }
})
