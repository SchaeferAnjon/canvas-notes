import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, pane, rail, waitSaved } from './app'
import { ICELAND, LODGING } from './fixtures/board'

const ai = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const lastSubject = (vault: string) => execFileSync('git', ['-C', vault, 'log', '-1', '--format=%s'], { encoding: 'utf8' }).trim()
const files = { '冰岛自驾.md': ICELAND, '住宿.md': LODGING, '所思所想.md': '# 所思所想\n\nSeek wealth, not money or status.\n\n第二段。\n', '极光预报.md': '极光\n' }

async function openAi(page: Page) {
  await page.getByRole('button', { name: '打开 AI' }).click()
  await expect(ai(page)).toBeVisible()
}

async function send(page: Page, text: string) {
  const box = ai(page).getByRole('textbox', { name: '问 AI' })
  await box.fill(text)
  await box.press('Enter')
}

test('首页：这周攒下几样、本周积累和收件箱组件、积累墙、最近的白板缩略图，点开就是那块白板', async () => {
  const run = await launch(files)
  const { page, vault } = run
  mkdirSync(join(vault, '收件箱'))
  writeFileSync(join(vault, '收件箱', '冰洞.md'), '---\ncreated: 2026-11-14 21:10\nsource: https://safetravel.is/ice\n---\n> 冰洞\n')
  try {
    await expect(pane(page).locator('.tool h1')).toHaveText('首页')
    await expect(page.locator('.hello .lead')).toContainText('这周攒下了 2 样东西')
    const week = page.getByTestId('home-stats')
    await expect(week.locator('div')).toHaveText(['2篇自己写的', '0段剪来的'])
    const inbox = page.getByTestId('widget-inbox')
    await expect(inbox.locator('.big')).toHaveText('1条没整理')
    await expect(inbox.locator('.li')).toHaveText(['冰洞'])
    await expect(inbox.getByRole('button', { name: '让 AI 分一分' })).toBeVisible()
    // 积累墙：52 周 × 7 天，今天那格有外圈
    await expect(page.getByTestId('wall').locator('.hgrid i')).toHaveCount(52 * 7)
    await expect(page.getByTestId('wall').locator('.hgrid i.today')).toHaveCount(1)
    await expect(page.locator('.thumbs .th')).toHaveCount(2)
    await expect(page.locator('.th', { hasText: '冰岛自驾' }).locator('.p i')).not.toHaveCount(0)
    await page.locator('.th', { hasText: '冰岛自驾' }).click()
    await expect(pane(page).getByTestId('board')).toBeVisible()
  } finally {
    await run.close()
  }
})

test('AI：/ 菜单筛选和键盘选；/总结这块白板 → 存成卡片 → 白板上多一张 AI 卡，一个提交；撤回又没了', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await page.locator('.nav .si', { hasText: '冰岛自驾' }).click()
    await openAi(page)
    await expect(page.getByTestId('ai-sees')).toContainText('白板：冰岛自驾')
    const box = ai(page).getByRole('textbox', { name: '问 AI' })
    await box.type('/')
    await expect(ai(page).getByRole('option')).toHaveCount(7)
    await box.type('总结')
    await expect(ai(page).getByRole('option')).toHaveCount(1)
    await box.press('Enter')
    const msg = ai(page).getByTestId('ai-msg').last()
    await expect(msg).toContainText('读了 冰岛自驾.md · 7 张卡片')
    await expect(msg).toContainText('这块白板讲了三件事')
    await msg.getByRole('button', { name: '存成卡片' }).click()
    await expect(msg).toContainText('存到了白板左下角')
    await expect(msg.getByTestId('ai-change')).toContainText('改了 1 个文件')
    const card = pane(page).locator('.bcard', { hasText: '这块白板讲了三件事' })
    await expect(card).toContainText('AI 总结的 ·')
    expect(lastSubject(vault)).toBe('AI：总结「冰岛自驾」存成卡片')
    expect(readFileSync(join(vault, '冰岛自驾.md'), 'utf8')).toContain('这块白板讲了三件事')
    await expect(page.getByTestId('week-commits')).toHaveText('本周 2 次提交')

    await msg.getByRole('button', { name: '撤回' }).click()
    await expect(msg.getByTestId('ai-change')).toContainText('已撤回')
    await expect(card).toHaveCount(0)
    expect(readFileSync(join(vault, '冰岛自驾.md'), 'utf8')).toBe(ICELAND)
    expect(lastSubject(vault)).toBe('Revert "AI：总结「冰岛自驾」存成卡片"')
    await expect(page.getByTestId('week-commits')).toHaveText('本周 3 次提交')

    // 打错命令
    await box.fill('/没有这个')
    await expect(ai(page).locator('.nocmd')).toHaveText('没有叫这个的命令')
  } finally {
    await run.close()
  }
})

test('AI：用户没提交的字先单独提交，撤回 AI 的改动不带走用户的字', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await page.locator('.nav .si', { hasText: '冰岛自驾' }).click()
    await pane(page).getByTestId('board').locator('.bcard[data-id="k1"]').dblclick()
    await page.keyboard.press('Meta+a')
    await page.keyboard.type('用户自己改的')
    await page.keyboard.press('Meta+Enter')
    await waitSaved(page)
    await openAi(page)
    await send(page, '/总结这块白板')
    const msg = ai(page).getByTestId('ai-msg').last()
    await msg.getByRole('button', { name: '存成卡片' }).click()
    await expect(msg.getByTestId('ai-change')).toContainText('改了 1 个文件')
    await msg.getByRole('button', { name: '撤回' }).click()
    await expect(msg.getByTestId('ai-change')).toContainText('已撤回')
    const md = readFileSync(join(vault, '冰岛自驾.md'), 'utf8')
    expect(md).toContain('用户自己改的')
    expect(md).not.toContain('这块白板讲了三件事')
    await expect(pane(page).locator('.bcard[data-id="k1"]')).toHaveText('用户自己改的')
  } finally {
    await run.close()
  }
})

test('AI：/写成文章 新建一篇草稿，左栏「我写的」多一篇标着草稿，点打开', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await page.locator('.nav .si', { hasText: '冰岛自驾' }).click()
    await openAi(page)
    await send(page, '/写成文章')
    const msg = ai(page).getByTestId('ai-msg').last()
    await expect(msg.locator('.dprev')).toContainText('冰岛自驾：文章草稿')
    await expect(msg.getByTestId('ai-change')).toContainText('新')
    const draft = join(vault, '冰岛自驾：文章草稿.md')
    expect(readFileSync(draft, 'utf8')).toMatch(/^---\ndraft: true\nfrom: "\[\[冰岛自驾\]\]"\n---\n# 冰岛自驾\n/)
    await expect(page.locator('.nav .si', { hasText: '冰岛自驾：文章草稿' })).toContainText('草稿')
    await msg.getByRole('button', { name: '打开' }).click()
    await expect(pane(page).locator('.tool h1')).toHaveText('冰岛自驾：文章草稿')
    expect(lastSubject(vault)).toBe('AI：按「冰岛自驾」写成文章草稿')
    expect(readFileSync(join(vault, '冰岛自驾.md'), 'utf8')).toBe(ICELAND)
  } finally {
    await run.close()
  }
})

test('AI：/整理收件箱 列出要挪去的主题，点同意一次挪好、一个提交，撤回回到收件箱', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  mkdirSync(join(vault, '收件箱'))
  writeFileSync(join(vault, '收件箱', '冰洞.md'), '---\ncreated: 2026-11-14 21:10\n---\n> 冰洞只在冬天开放\n')
  writeFileSync(join(vault, '收件箱', '极光.md'), '---\ncreated: 2026-11-14 21:20\n---\n极光看云量\n')
  execFileSync('git', ['-C', vault, 'add', '-A'])
  execFileSync('git', ['-C', vault, 'commit', '-qm', '收件箱'])
  try {
    await page.locator('.nav .si', { hasText: '收件箱' }).click()
    await openAi(page)
    await expect(page.getByTestId('ai-sees')).toContainText('收件箱 2 条')
    await ai(page).getByRole('button', { name: '/整理收件箱' }).click()
    const msg = ai(page).getByTestId('ai-msg').last()
    await expect(msg.locator('.mv')).toHaveCount(2)
    await expect(msg).toContainText('→ 素材/旅行')
    await msg.getByRole('button', { name: '同意，挪过去' }).click()
    await expect(msg).toContainText('挪好了 2 条')
    expect(existsSync(join(vault, '素材', '旅行', '冰洞.md'))).toBe(true)
    expect(existsSync(join(vault, '收件箱', '冰洞.md'))).toBe(false)
    await expect(page.locator('.nav .si', { hasText: '旅行' })).toContainText('2')
    expect(lastSubject(vault)).toBe('AI：整理收件箱：挪了 2 条')
    await msg.getByRole('button', { name: '撤回' }).click()
    await expect(msg.getByTestId('ai-change')).toContainText('已撤回')
    expect(existsSync(join(vault, '收件箱', '冰洞.md'))).toBe(true)
    expect(existsSync(join(vault, '素材', '旅行', '冰洞.md'))).toBe(false)
  } finally {
    await run.close()
  }
})

test('AI：/翻译 选中的那段；@ 引用笔记加进「看得到」；⌘J 开关；右栏开着时 AI 还浮在中间栏右下角', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await page.locator('.nav .si', { hasText: '所思所想' }).click()
    await pane(page).locator('.cm-line', { hasText: 'Seek wealth' }).click({ clickCount: 3 })
    await page.keyboard.press('Meta+j')
    await expect(ai(page)).toBeVisible()
    await send(page, '/翻译')
    const msg = ai(page).getByTestId('ai-msg').last()
    await expect(msg).toContainText(/读了选中的 \d+ 个字/)
    await expect(msg).toContainText('（译文）')

    const box = ai(page).getByRole('textbox', { name: '问 AI' })
    await box.fill('')
    await box.type('看看 @极光')
    await expect(ai(page).getByRole('option')).toHaveCount(1)
    await box.press('Enter')
    await expect(page.getByTestId('ai-sees')).toContainText('@极光预报')
    await expect(box).toHaveValue('看看 @极光预报 ')

    await page.keyboard.press('Meta+j')
    await expect(ai(page)).toBeHidden()
    // 右栏开着时再开 AI：还是浮在中间栏右下角，右栏的历史照样开着；顶栏切换里没有 AI
    await rail(page).getByRole('button', { name: '历史' }).click()
    await expect(rail(page).getByRole('button')).toHaveText(['网页', '梦游', '历史'])
    await page.keyboard.press('Meta+j')
    await expect(ai(page)).toBeVisible()
    await expect(ai(page)).toHaveClass(/floating/)
    await expect(page.getByRole('complementary', { name: '历史' })).toBeVisible()
    const center = (await page.locator('main.center').boundingBox())!
    const panel = (await ai(page).boundingBox())!
    expect(Math.round(center.x + center.width - (panel.x + panel.width))).toBe(16)
  } finally {
    await run.close()
  }
})
