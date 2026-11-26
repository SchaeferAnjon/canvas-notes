/**
 * 剪藏两个毛病（剪藏入口统计 design/clip-survey 第 4 节前两条，真点、真按 ⌘S、真右键）：
 * 1. 「⋯ › 剪到哪篇…」选「剪成卡片，放进收件箱」：以前点了什么都不变，接着 ⌘S 照样进原来那篇。现在这个网站以后剪进收件箱，
 *    底栏说一句，那篇一个字不动；再选回那篇又剪进那篇。
 * 2. 网页右键选字「剪成卡片」：以前直接拿右键给的纯文字，没有回到那段的链接、公式丢了 md。现在和 ⌘S 进收件箱走同一条路，
 *    两张卡片除了创建时间一字不差，⌘ 点来源回到那段、亮一下。
 * 本机假网页（fixtures/d2l-pandas、fixtures/d2l-conv），无头（CN_E2E=1），不上网。
 */
import { expect, test } from '@playwright/test'
import { launch, openNote, pane } from './app'
import { armMenus, menuLabels, openedMenu, pickMenu } from './menu'
import { clipTip, flashed, guest, inboxFiles, metaClickText, openPickTarget, openWeb, pressInPage, read, selectPara, toast, web } from './clip-web'
import { d2l, type D2l, P1, P2 } from './fixtures/d2l-pandas'
import { d2lConv, type D2lSite, HIJ, XIJ } from './fixtures/d2l-conv'

test.setTimeout(180_000)

let pandas: D2l
let conv: D2lSite
test.beforeAll(async () => {
  pandas = await d2l()
  conv = await d2lConv()
})
test.afterAll(async () => {
  await pandas.close()
  await conv.close()
})

const NOTE = '课程/读书笔记.md'

test('「⋯ › 剪到哪篇…」选收件箱：底栏说以后剪进收件箱，接着 ⌘S 进收件箱、那篇一个字不动；弹层再开先选着收件箱，选回那篇又剪进那篇', async () => {
  const run = await launch({ [NOTE]: '# 读书笔记\n\n第一段。\n' })
  const { page, vault } = run
  try {
    // 中间开着《读书笔记》：「⋯ › 剪到哪篇…」记到这篇（顺手配成一对），⌘S 剪进它（剪藏去处规则：没配对时 ⌘S 进收件箱，不再先问）
    await openNote(page, '读书笔记')
    await pane(page).locator('.cm-line', { hasText: '第一段' }).click()
    await page.keyboard.press('End')
    await openWeb(page, pandas.pandas)
    await selectPara(page, 'p1')
    await openPickTarget(page)
    const dlg = page.getByRole('dialog', { name: '记到哪篇' })
    await expect(dlg).toBeVisible()
    await dlg.getByRole('button', { name: /记到这篇/ }).click()
    await expect(toast(page)).toContainText('这个网站以后记进《读书笔记》')
    await selectPara(page, 'p1')
    await pressInPage(run, 'S', ['meta'])
    await expect(toast(page)).toContainText('剪进《读书笔记》')
    await expect.poll(() => read(vault, NOTE)).toContain(P1.slice(0, 12))
    await expect.poll(() => read(vault, NOTE)).toContain('read-along:')
    expect(inboxFiles(vault)).toEqual([])

    // ⋯ › 剪到哪篇…：右边写着《读书笔记》；选「剪成卡片，放进收件箱」
    await selectPara(page, 'p2')
    expect(await openPickTarget(page)).toContain('读书笔记')
    await expect(dlg).toBeVisible()
    await dlg.getByRole('radio', { name: /放进收件箱/ }).click()
    await expect(dlg.locator('.wh-go')).toHaveText(/剪进收件箱/)
    await expect(dlg).toContainText('以后这个网站剪的都进收件箱')
    await dlg.locator('.wh-go').click()
    await expect(dlg).toHaveCount(0)
    await expect(toast(page)).toContainText('这个网站以后剪进收件箱')
    await page.waitForTimeout(600)
    const before = read(vault, NOTE)

    // 接着 ⌘S（中间还开着《读书笔记》、它也配着这个网站）：进收件箱，那篇不动
    await selectPara(page, 'p2')
    expect(await clipTip(page)).toContain('剪成卡片，放进收件箱')
    await pressInPage(run, 'S', ['meta'])
    await expect(dlg).toHaveCount(0)
    await expect(toast(page)).toContainText('剪成卡片，放进收件箱了')
    await expect.poll(() => inboxFiles(vault).length).toBe(1)
    const card = read(vault, `收件箱/${inboxFiles(vault)[0]}`)
    expect(card).toContain(`> ${P2}`)
    expect(card).toContain('#:~:text=')
    await page.waitForTimeout(800)
    expect(read(vault, NOTE)).toBe(before)

    // 再开「剪到哪篇…」：右边写收件箱，先选着「放进收件箱」；选回《读书笔记》
    await selectPara(page, 'p1')
    expect(await openPickTarget(page)).toContain('收件箱')
    await expect(dlg).toBeVisible()
    await expect(dlg.getByRole('radio', { name: /放进收件箱/ })).toHaveAttribute('aria-checked', 'true')
    await dlg.getByRole('radio', { name: /读书笔记/ }).click()
    await dlg.locator('.wh-go').click()
    await expect(toast(page)).toContainText('这个网站以后记进《读书笔记》')
    await selectPara(page, 'p1')
    await pressInPage(run, 'S', ['meta'])
    // p1 剪过了：底栏说剪过了（进的是《读书笔记》，不是收件箱）
    await expect(toast(page)).toContainText('这段已经剪过了')
    expect(inboxFiles(vault).length).toBe(1)
  } finally {
    await run.close()
  }
})

/** 卡片去掉创建时间那一行 */
const noStamp = (s: string) => s.replace(/^created: .*\n/m, '')

test('右键选字「剪成卡片」和 ⌘S 进收件箱写出同一张卡片（除了创建时间一字不差：公式是 $…$、来源带回到那段）；⌘ 点来源网页回到那段、亮一下', async () => {
  // 库里没有配这个网站的篇、中间没开文档：⌘S 进收件箱
  const run = await launch({ '随手.md': '# 随手\n' })
  const { page, vault } = run
  try {
    await armMenus(run)
    await openWeb(page, conv.url)

    // 带行内公式的一段：右键「剪成卡片」
    await selectPara(page, 'p2')
    const w = (await web(page).locator('webview.on').boundingBox())!
    const r = await guest<{ x: number; y: number }>(page, `(() => { const t = document.getElementById('p2').firstChild; const g = document.createRange(); g.setStart(t, 0); g.setEnd(t, 1); const b = g.getBoundingClientRect(); return { x: b.right + 2, y: b.top + b.height / 2 } })()`)
    await page.mouse.click(w.x + r.x, w.y + r.y, { button: 'right' })
    expect(menuLabels(await openedMenu(run))).toContain('剪成卡片')
    await pickMenu(run, '剪成卡片')
    await expect(toast(page)).toContainText('剪成卡片，放进收件箱了')
    await expect.poll(() => inboxFiles(vault).length).toBe(1)
    const right = inboxFiles(vault)[0]!
    const a = read(vault, `收件箱/${right}`)

    // 同一段 ⌘S
    await selectPara(page, 'p2')
    await pressInPage(run, 'S', ['meta'])
    await expect.poll(() => inboxFiles(vault).length).toBe(2)
    const b = read(vault, `收件箱/${inboxFiles(vault).find((f) => f !== right)!}`)

    expect(a).toContain(`$${XIJ}$`)
    expect(a).toContain(`$${HIJ}$`)
    expect(a).toMatch(/\]\(http:\/\/[^)]+#:~:text=[^)]+\)/)
    expect(noStamp(a)).toBe(noStamp(b))

    // 打开右键剪的那张，⌘ 点来源：右栏网页回到那段、亮一下
    await guest(page, 'getSelection().removeAllRanges(); window.scrollTo(0, document.body.scrollHeight)')
    await openNote(page, right.replace(/\.md$/, ''))
    await metaClickText(page, '动手学')
    await expect.poll(() => flashed(page), { timeout: 8000 }).toBeGreaterThan(0)
    const top = await guest<number>(page, `document.getElementById('p2').getBoundingClientRect().top`)
    const h = await guest<number>(page, 'innerHeight')
    expect(top, '那段滚回看得见的地方').toBeGreaterThan(-10)
    expect(top).toBeLessThan(h)
  } finally {
    await run.close()
  }
})
