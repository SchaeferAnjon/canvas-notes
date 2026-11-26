// bug 一批 1125b 之 10：右栏 AI 顶上「这是在《s》问的 · 切到《情绪识别…》」，地方名只露一个字母。
// 存的名字是全的（胶囊上写着「study project 2」），是那一行排不开：右边按钮不让、「这是在」「问的」不让，名字只剩几像素。
// 这里换页后读顶上那一行：名字露全（放不下的长名字至少露几个字、带省略号，悬停看全）；右栏窄时按钮换成短句「切到这页」「这页 N 段」，不截动作的字。
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { launch, openNote, widenRight } from './app'

const SHOTS = '/private/tmp/canvas-notes-visual/162-bug一批1125b'
const LONG = '情绪识别与可穿戴生理信号多模态数据集调研笔记第二版'
const files = {
  'study project 2/study project 2.md': '# study project 2\n\n项目首页。\n',
  'study project 2/计划与调研/情绪识别论文清单.md': '# 情绪识别论文清单\n\n1. 第一篇。\n',
  [`study project 2/${LONG}.md`]: `# ${LONG}\n\n正文。\n`,
}

const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const away = (page: Page) => chat(page).getByTestId('ai-away')

async function ask(page: Page, text: string) {
  const box = chat(page).getByRole('textbox', { name: '问 AI' })
  await box.fill(text)
  await box.press('Enter')
  await expect(chat(page).getByTestId('ai-msg').last().locator('.txt')).toHaveText('这是测试回答（Claude Code）。', { timeout: 15_000 })
}

/** 按钮：窄时画的短句（::before）、整句露出来的宽、快捷键露没露、悬停说明、按钮里的字有没有被截 */
const btnBox = (page: Page) =>
  away(page)
    .getByTestId('ai-follow')
    .evaluate((el) => {
      const lb = el.querySelector<HTMLElement>('.lb')!
      const k = el.querySelector<HTMLElement>('.k')
      return {
        short: getComputedStyle(el, '::before').content,
        lb: lb.offsetParent ? lb.clientWidth : 0,
        key: !!k?.offsetParent,
        title: el.getAttribute('title'),
        cut: el.scrollWidth > el.clientWidth + 1,
      }
    })

/** 地方名那一截：露出来的宽、整段要的宽、悬停说明 */
const nameBox = (page: Page) =>
  away(page)
    .locator('.nm')
    .evaluate((el) => ({ shown: el.clientWidth, need: el.scrollWidth, text: el.textContent, title: el.getAttribute('title') }))

test('换页后顶上「这是在《study project 2》问的」名字露全；右栏窄时按钮换短句、名字照样露全；名字长的截短带省略号，悬停看全；点按钮切过去', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page } = run
  mkdirSync(SHOTS, { recursive: true })
  try {
    await openNote(page, 'study project 2')
    await page.keyboard.press('Meta+j')
    await ask(page, '这个项目到哪一步了')

    // 1. 换到名字长的那篇（右栏默认宽）：右栏留着刚才那段，顶上一行写的是那段的地方名，露全
    await openNote(page, '情绪识别论文清单')
    await expect(chat(page).getByTestId('ai-conv')).toHaveText('study project 2')
    await expect(away(page).getByTestId('ai-follow')).toContainText('切到《情绪识别论文清单》的 AI')
    console.log('右栏宽', await chat(page).evaluate((el) => el.clientWidth))
    await away(page).screenshot({ path: `${SHOTS}/10-row.png` })
    const a = await nameBox(page)
    console.log('名字', a)
    expect(a.text).toBe('study project 2')
    // 修前右栏 380 宽时只给 42 像素，露「study…」
    expect(a.need - a.shown).toBeLessThanOrEqual(1)
    expect(a.title).toBe('study project 2')
    // 按钮是整句（名字截短）+ 快捷键，「切到《」露着；悬停看整句和快捷键
    const b1 = await btnBox(page)
    console.log('按钮', b1)
    expect(b1).toMatchObject({ short: 'none', key: true, title: '切到《情绪识别论文清单》的 AI ⌥⌘J' })
    expect(b1.lb).toBeGreaterThanOrEqual(3 * 12)

    // 2. 右栏拉到最窄（300，用户截图里那么宽；修前名字只给 7 像素，露一个「s」）：名字露全，按钮换成短句「切到这页」、藏起快捷键，不截
    await widenRight(page, -200)
    await expect.poll(() => chat(page).evaluate((el) => el.clientWidth)).toBeLessThanOrEqual(310)
    const narrow = await nameBox(page)
    console.log('最窄', await chat(page).evaluate((el) => el.clientWidth), narrow)
    expect(narrow.need - narrow.shown).toBeLessThanOrEqual(1)
    expect(await btnBox(page)).toMatchObject({ short: '"切到这页"', lb: 0, key: false, cut: false, title: '切到《情绪识别论文清单》的 AI ⌥⌘J' })
    await away(page).screenshot({ path: `${SHOTS}/10-row-narrow.png` })

    // 3. 地方名特别长、这页有一段对话（还是最窄）：名字截短带省略号、至少露 5 个字，「这是在」「问的」照旧在；按钮短句「这页 1 段」
    await openNote(page, LONG)
    await page.keyboard.press('Alt+Meta+j')
    await expect(chat(page).getByTestId('ai-conv')).toHaveText(LONG)
    await ask(page, '长名字这篇问一句')
    await openNote(page, 'study project 2')
    await expect(chat(page).getByTestId('ai-conv')).toHaveText(LONG)
    const c = await nameBox(page)
    console.log('长名字', c)
    expect(c.text).toBe(LONG)
    expect(c.title).toBe(LONG)
    expect(c.shown).toBeGreaterThanOrEqual(5 * 12)
    expect(c.need).toBeGreaterThan(c.shown)
    await expect(away(page).locator('.tx')).toHaveText(`这是在《${LONG}》问的`)
    expect(await btnBox(page)).toMatchObject({ short: '"这页 1 段"', key: false, cut: false, title: '这页有 1 段对话 · 打开 ⌥⌘J' })
    await chat(page).screenshot({ path: `${SHOTS}/10-long.png` })

    // 4. 拉回默认宽：长名字截短；「这页有 1 段对话 · 打开」整句放不下，换成短句「这页 1 段」带快捷键，不截
    await widenRight(page, 80)
    await expect.poll(() => chat(page).evaluate((el) => el.clientWidth)).toBeGreaterThan(360)
    expect(await chat(page).evaluate((el) => el.clientWidth)).toBeLessThan(400)
    expect(await btnBox(page)).toMatchObject({ short: '"这页 1 段"', lb: 0, key: true, cut: false })
    expect((await nameBox(page)).shown).toBeGreaterThanOrEqual(8 * 12)
    await away(page).screenshot({ path: `${SHOTS}/10-long-row.png` })

    // 5. 右栏拉得够宽：整句「这页有 1 段对话 · 打开 ⌥⌘J」露全
    await widenRight(page, 140)
    await expect.poll(() => chat(page).evaluate((el) => el.clientWidth)).toBeGreaterThan(480)
    const wide = await btnBox(page)
    console.log('够宽 按钮', wide)
    expect(wide).toMatchObject({ short: 'none', key: true, cut: false })
    await expect(away(page).locator('.lb')).toBeVisible()
    await away(page).screenshot({ path: `${SHOTS}/10-long-row-wide.png` })

    // 6. 真点按钮：切到这页（study project 2）的对话
    await away(page).getByTestId('ai-follow').click()
    await expect(chat(page).getByTestId('ai-conv')).toHaveText('study project 2')
    await expect(chat(page).locator('.um')).toHaveText(['这个项目到哪一步了'])
    await expect(away(page)).toHaveCount(0)
  } finally {
    await run.close()
  }
})
