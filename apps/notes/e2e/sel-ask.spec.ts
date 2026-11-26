// 用户 0.5.13 r171「我选多个文件，然后点问 AI 没反应」：收件箱里框选 8 篇，底部「问 AI」点了什么都不发生。
// 当时右栏 AI 开着、正显示一段别处问的旧对话（顶上「这是在《收件箱》问的 · 切到《第一次打…》⌥⌘J」）：
// 选中的几篇其实记下了，可「看得到」那一行被「这是在《X》问的」那一行顶掉，「选中的N个」画不出来，看着就是没反应。
// 这里真框选、真点按钮、真发一句：右栏回到这一页的 AI，看得到「选中的3个」（悬停是哪 3 篇），假引擎收到的上下文里是这 3 篇的路径。
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { launch, leftView, widenRight } from './app'
import { armMenus, openedMenu, pickMenu } from './menu'

const SHOTS = process.env.CN_SHOTS ?? '/private/tmp/canvas-notes-visual/sel-ask'
const LONG = '第一次打开的时候 问 AI 需要让登录'
const files = {
  [`收件箱/${LONG}.md`]: `# ${LONG}\n\n第一次打开问 AI 要先登录 Claude。\n`,
  '收件箱/白板里面回车有问题.md': '# 白板里面回车有问题\n\n白板卡片里按回车跳出卡片。\n',
  '收件箱/费曼学习需要检测到白板的内容.md': '# 费曼学习需要检测到白板的内容\n\n费曼讲的时候 AI 看不到白板。\n',
  '收件箱/视频 ai 放大之后消失.md': '# 视频 ai 放大之后消失\n\n视频放大以后 AI 按钮不见了。\n',
  '收件箱/速记抓不到内容.md': '# 速记抓不到内容\n\n速记窗口抓不到网页内容。\n',
}

const side = (page: Page) => page.locator('aside.side')
const tree = (page: Page) => side(page).getByRole('tree')
const bar = (page: Page) => side(page).getByRole('toolbar', { name: '选中的' })
const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const box = (page: Page) => chat(page).getByRole('textbox', { name: '问 AI' })
const title = (p: string) => p.split('/').pop()!.replace(/\.md$/, '')

/** 收件箱那一枝的行，从上到下 */
const rows = (page: Page) => tree(page).locator('[role="treeitem"][data-path^="收件箱/"]')

/** 真框选：在最后一行下面的空白处按下，往上拖到倒数第 n 行，松开；回选中的那几篇（从上到下） */
async function lassoLast(page: Page, n: number): Promise<string[]> {
  const all = rows(page)
  const count = await all.count()
  const t = (await tree(page).boundingBox())!
  const last = (await all.nth(count - 1).boundingBox())!
  const top = (await all.nth(count - n).boundingBox())!
  await page.mouse.move(t.x + 120, last.y + last.height + 30)
  await page.mouse.down()
  await page.mouse.move(t.x + 130, top.y + top.height / 2, { steps: 8 })
  await expect(tree(page).locator('.ft-lasso')).toBeVisible()
  await page.mouse.up()
  await expect(bar(page).locator('b')).toHaveText(`已选${n}个`)
  const paths: string[] = []
  for (let i = count - n; i < count; i++) paths.push((await all.nth(i).getAttribute('data-path'))!)
  return paths
}

async function ask(page: Page, text: string, answer: string | RegExp) {
  await box(page).fill(text)
  await box(page).press('Enter')
  await expect(chat(page).getByTestId('ai-msg').last().locator('.txt')).toHaveText(answer, { timeout: 15_000 })
}

/** 选中的几篇进了右栏：看得到第一颗「选中的N个」、悬停写是哪几篇，问候换成好几篇的（这段还空着时），输入框拿到焦点 */
async function seesPicked(page: Page, picked: string[]) {
  const ai = chat(page)
  await expect(ai).toBeVisible()
  await expect(ai.getByTestId('ai-away')).toHaveCount(0)
  await expect(ai.getByTestId('ai-sees').locator('.chip').first()).toHaveText(`选中的${picked.length}个`)
  await expect(ai.getByTestId('ai-picked')).toHaveAttribute('title', picked.map(title).join('\n'))
  await expect(box(page)).toBeFocused()
}

/** 假引擎答的是它收到的上下文里「选中的这几篇」那一行列的路径 */
const echoed = (picked: string[]) => `这是测试回答（选中的${picked.length}篇：${picked.join('、')}）。`

test('收件箱里框选 3 篇，底部「问AI」：右栏 AI 打开，看得到「选中的3个」；发一句，AI 收到的是这 3 篇', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page, app } = run
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    await leftView(page, '收件箱')
    await expect(rows(page)).toHaveCount(5)
    const picked = await lassoLast(page, 3)
    await bar(page).getByRole('button', { name: '问AI' }).click()
    await seesPicked(page, picked)
    await expect(chat(page).getByTestId('ai-greet').locator('p')).toHaveText('要对选中的3个做点什么？')
    await ask(page, '选中的这几篇各讲什么', echoed(picked))
  } finally {
    await run.close()
  }
})

test('右栏开着一段别处问的对话（「这是在《收件箱》问的 · 切到《…》」）时框选 3 篇点「问AI」：回到这一页的 AI，看得到「选中的3个」，发一句 AI 收到这 3 篇；右键「问 AI」同一条路', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page, app } = run
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    await armMenus(run)
    // 用户截图里那样：在收件箱首页问过一段，再点开收件箱里的一篇，右栏留着刚才那段
    await leftView(page, '收件箱')
    await page.keyboard.press('Meta+j')
    await ask(page, '收件箱里有几篇', '这是测试回答（Claude Code）。')
    await tree(page).locator(`[data-path="收件箱/${LONG}.md"]`).click()
    await expect(page.getByTestId('tab-on')).toHaveText(LONG)
    const away = chat(page).getByTestId('ai-away')
    await expect(away).toContainText('这是在《收件箱》问的')
    await expect(away.getByTestId('ai-follow')).toBeVisible()

    // 框选最后 3 篇（开着的那篇排第二，不在里面），点底部「问AI」
    const picked = await lassoLast(page, 3)
    expect(picked).not.toContain(`收件箱/${LONG}.md`)
    mkdirSync(SHOTS, { recursive: true })
    await page.screenshot({ path: `${SHOTS}/1-before-click.png` })
    await bar(page).getByRole('button', { name: '问AI' }).click()
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${SHOTS}/2-after-click.png` })
    await seesPicked(page, picked)
    // 这一页（刚开的这篇）的对话还空着：问候是好几篇的
    await expect(chat(page).getByTestId('ai-conv')).toHaveText(LONG)
    await expect(chat(page).getByTestId('ai-greet').locator('p')).toHaveText('要对选中的3个做点什么？')
    await ask(page, '选中的这几篇各讲什么', echoed(picked))
    // 刚才收件箱那段没动，还在对话菜单里；点它是去看别处的对话：「选中的3个」拿掉（那边画不出来，不悄悄交给那段）
    await chat(page).getByTestId('ai-conv').click()
    await page.getByRole('menu', { name: '对话' }).getByTestId('ai-page').filter({ hasText: '收件箱' }).click()
    await expect(chat(page).getByTestId('ai-away')).toContainText('这是在《收件箱》问的')
    await expect(chat(page).getByTestId('ai-picked')).toHaveCount(0)

    // 右键「问 AI」：正看着菜单里点开的那段时，重新框选 2 篇（空白处按下就换掉刚才选的），右键对着这一组点「问 AI」
    const again = await lassoLast(page, 2)
    await tree(page).locator(`[data-path="${again[0]}"]`).click({ button: 'right' })
    const m = await openedMenu(run)
    expect(m.find((i) => i.label === '问 AI')?.enabled).toBe(true)
    await pickMenu(run, '问 AI')
    await seesPicked(page, again)
    await ask(page, '选中的这几篇各讲什么', echoed(again))
  } finally {
    await run.close()
  }
})

/** 地方名那一截：露出来的宽、整段要的宽 */
const nameBox = (page: Page) =>
  chat(page)
    .getByTestId('ai-away')
    .locator('.nm')
    .evaluate((el) => ({ shown: el.clientWidth, need: el.scrollWidth, text: el.textContent }))

test('同一张截图顶上「这是在《ゆ》问的」：收件箱首页问过、再开收件箱里标题长的一篇，右栏约 400 / 300 宽时「收件箱」露全（0.5.14 那次修复覆盖这种）', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page, app } = run
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    mkdirSync(SHOTS, { recursive: true })
    await leftView(page, '收件箱')
    await page.keyboard.press('Meta+j')
    await ask(page, '收件箱里有几篇', '这是测试回答（Claude Code）。')
    await tree(page).locator(`[data-path="收件箱/${LONG}.md"]`).click()
    const away = chat(page).getByTestId('ai-away')
    await expect(away.getByTestId('ai-follow')).toHaveAttribute('title', `切到《${LONG}》的 AI ⌥⌘J`)
    for (const w of [400, 300]) {
      const now = await chat(page).evaluate((el) => el.clientWidth)
      await widenRight(page, w - now)
      await expect.poll(() => chat(page).evaluate((el) => el.clientWidth)).toBeGreaterThan(w - 15)
      await expect.poll(() => chat(page).evaluate((el) => el.clientWidth)).toBeLessThan(w + 15)
      const n = await nameBox(page)
      console.log('右栏', await chat(page).evaluate((el) => el.clientWidth), n)
      expect(n.text).toBe('收件箱')
      expect(n.need - n.shown).toBeLessThanOrEqual(1)
      await away.screenshot({ path: `${SHOTS}/3-away-${w}.png` })
    }
  } finally {
    await run.close()
  }
})

// 真 Claude Code 问一句（要联网、花一点额度，平时跳过）：
//   CN_REAL_AI=1 npx playwright test e2e/sel-ask.spec.ts -g 真   （在 Claude Code 终端里跑先去掉父会话的 CLAUDECODE、CLAUDE_CODE_* 环境变量）
// 测试模式、临时库、临时设置目录；CN_AI_MODEL=sonnet。会话记录留在 ~/.claude/projects 下按临时库路径起名的文件夹里。
test('真 Claude Code：右栏开着别处的对话时框选 3 篇「问AI」，问「这几篇各讲什么」，回答讲到这 3 篇', async () => {
  test.skip(!process.env.CN_REAL_AI, '真 AI 才跑：CN_REAL_AI=1')
  test.setTimeout(10 * 60_000)
  const run = await launch(files, { CN_AI_MODEL: 'sonnet' })
  const { page, app } = run
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    mkdirSync(SHOTS, { recursive: true })
    await leftView(page, '收件箱')
    await page.keyboard.press('Meta+j')
    await box(page).fill('收件箱里有几篇？只答数字')
    await box(page).press('Enter')
    await expect(chat(page).getByTestId('ai-msg').last().locator('.txt')).toContainText(/\d|五/, { timeout: 180_000 })
    await tree(page).locator(`[data-path="收件箱/${LONG}.md"]`).click()
    await expect(chat(page).getByTestId('ai-away')).toContainText('这是在《收件箱》问的')
    const picked = await lassoLast(page, 3)
    await bar(page).getByRole('button', { name: '问AI' }).click()
    await seesPicked(page, picked)
    await box(page).fill('这几篇各讲什么')
    await box(page).press('Enter')
    // 三篇各讲的事：费曼讲的时候 AI 看不到白板、视频放大以后 AI 按钮不见、速记抓不到网页内容
    const a = chat(page).getByTestId('ai-msg').last().locator('.txt')
    for (const w of ['费曼', '视频', '速记']) await expect(a).toContainText(w, { timeout: 240_000 })
    await page.waitForTimeout(3000)
    console.log('回答：', await a.textContent())
    await page.screenshot({ path: `${SHOTS}/4-real-claude.png` })
  } finally {
    await run.close()
  }
})
