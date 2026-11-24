// 读 PDF 放大缩小（r82，task-2onrm）：⌘= ⌘- ⌘0 ⇧⌘1、「100% ▾」菜单、捏合以手指为中心、按比例重画、每份记自己的、改键；
// 页边标记、问过的框、框好的框、选中小条、跳回时闪的框跟着对齐（误差 ≤ 2px）
import { expect, type Locator, type Page, test } from '@playwright/test'
import { acts, launch, rail, type Running, tabOn } from './app'
import { LECTURE } from './fixtures/pdf'
import { armMenus, openedMenu, pickMenu } from './menu'

const A = '课程/线代/第3讲 线性映射.pdf'
const B = '课程/线代/第4讲 特征值.pdf'
const files = { [A]: LECTURE, [B]: LECTURE }
const W = 612
const H = 792

const pdfPane = (page: Page) => page.locator('.pdfpane:not([hidden])')
const pdfPage = (page: Page, n: number) => pdfPane(page).locator(`.pdfpage[data-page="${n}"]`)
const ai = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })
const pill = (page: Page) => acts(page).getByTestId('pdf-zoom')
const pct = async (page: Page) => Number((await pill(page).textContent())!.replace('%', ''))
const box = async (l: Locator) => (await l.boundingBox())!

async function openPdf(page: Page, name: string) {
  await page.keyboard.press('Meta+k')
  await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill(name)
  await page.locator('.pal-row', { hasText: name }).first().click()
  await expect(tabOn(page)).toHaveText(`${name}.pdf`)
  await expect(pdfPage(page, 1).locator('canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
}

/** 第 1 页现在的比例（页宽 / 612）和画布是不是按这个比例画的（画布像素 = 页面 CSS 宽 × 屏幕倍数） */
async function rendered(page: Page) {
  return pdfPage(page, 1).evaluate((el) => {
    const c = el.querySelector('canvas[data-ready]') as HTMLCanvasElement | null
    const w = el.getBoundingClientRect().width
    return { css: w, scale: c ? Number(c.dataset.scale) : 0, px: c?.width ?? 0, want: Math.floor(w * Math.min(devicePixelRatio, Math.sqrt(2 ** 24 / (w * w * (792 / 612))))) }
  })
}
async function expectCrisp(page: Page, scale: number) {
  await expect.poll(async () => (await rendered(page)).scale).toBeCloseTo(scale, 2)
  const r = await rendered(page)
  expect(Math.abs(r.css - W * scale)).toBeLessThanOrEqual(1)
  expect(Math.abs(r.px - r.want)).toBeLessThanOrEqual(1)
}

test('⌘= ⌘- ⌘0 ⇧⌘1 和「100% ▾」：按档位缩放、按新比例重画、适合宽度跟着栏宽、每份 PDF 记自己的、键在设置里能改', async () => {
  const run = await launch(files)
  const { page } = run
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openPdf(page, '第3讲 线性映射')
    const view = pdfPane(page).getByTestId('pdf-view')
    // 新打开照设置（默认适合宽度）：纸离栏左右各 40（task-2onrm 去掉了纸外右边放标记的那条，常显的滚动条算在右边 40 里）
    const vw = await view.evaluate((el) => (el as HTMLElement).offsetWidth)
    const fit = (vw - 80) / W
    await expect(pill(page)).toHaveText(`${Math.round(fit * 100)}%`)
    await expect(pill(page)).toHaveAttribute('data-key', '⌘= ⌘- ⌘0')
    await expectCrisp(page, Math.round(fit * 1000) / 1000)

    // ⌘=：到上一档（档位 …1、1.1、1.25…）
    const up = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5].find((s) => s > fit + 0.001)!
    await view.focus()
    await page.keyboard.press('Meta+Equal')
    await expect(pill(page)).toHaveText(`${Math.round(up * 100)}%`)
    await expectCrisp(page, up)
    await page.keyboard.press('Meta+Minus')
    await page.keyboard.press('Meta+Minus')
    await expect.poll(() => pct(page)).toBeLessThan(Math.round(fit * 100))
    // ⌘0 适合宽度，⇧⌘1 适合整页（第 1 页整页放进这一栏，上下各留 24）
    await page.keyboard.press('Meta+Digit0')
    await expect(pill(page)).toHaveText(`${Math.round(fit * 100)}%`)
    await page.keyboard.press('Shift+Meta+Digit1')
    const vh = await view.evaluate((el) => el.clientHeight)
    await expect(pill(page)).toHaveText(`${Math.round(Math.min(fit, (vh - 48) / H) * 100)}%`)
    expect((await box(pdfPage(page, 1))).height).toBeLessThanOrEqual(vh - 48 + 1)

    // 「100% ▾」：系统菜单，勾着现在这一个；点 200%
    await armMenus(run)
    await pill(page).click()
    const items = await openedMenu(run)
    expect(items.filter((i) => i.type !== 'separator').map((i) => i.label)).toEqual(['放大', '缩小', '适合宽度', '适合整页', '50%', '75%', '100%', '125%', '150%', '200%', '300%', '触控板捏合、按住 ⌘ 滚动也能缩放'])
    expect(items.find((i) => i.label === '适合整页')!.checked).toBe(true)
    expect(items.find((i) => i.label === '适合宽度')!.checked).toBe(false)
    await pickMenu(run, '200%')
    await expect(pill(page)).toHaveText('200%')
    await expectCrisp(page, 2)
    // 纸比栏宽：能左右滚
    expect(await view.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)

    // 每份记自己的：关了再开还是 200%；另一份照设置是适合宽度
    await page.keyboard.press('Meta+w')
    await expect(pdfPane(page)).toHaveCount(0)
    await openPdf(page, '第4讲 特征值')
    await expect(pill(page)).toHaveText(`${Math.round(fit * 100)}%`)
    await openPdf(page, '第3讲 线性映射')
    await expect(pill(page)).toHaveText('200%')
    // 适合宽度跟着栏宽变；定死的比例不变
    await page.getByTestId('tab-list').getByRole('tab', { name: /第4讲 特征值\.pdf/ }).click()
    await page.setViewportSize({ width: 1100, height: 900 })
    await expect.poll(() => pct(page)).toBeLessThan(Math.round(fit * 100))
    const fit2 = ((await pdfPane(page).getByTestId('pdf-view').evaluate((el) => (el as HTMLElement).offsetWidth)) - 80) / W
    await expect(pill(page)).toHaveText(`${Math.round(fit2 * 100)}%`)
    await page.getByTestId('tab-list').getByRole('tab', { name: /第3讲 线性映射\.pdf/ }).click()
    await expect(pill(page)).toHaveText('200%')
    await page.setViewportSize({ width: 1440, height: 900 })

    // 改键：设置 › 快捷键「放大」改成 ⌃⌥⌘=，新键能用、旧键不再放大，按钮提示跟着变
    await page.keyboard.press('Meta+Comma')
    const dlg = page.getByRole('dialog', { name: '设置' })
    await dlg.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: '快捷键', exact: true }).click()
    const row = dlg.locator('[data-row="k-cmd-zoom-in"]')
    await expect(row).toContainText('放大')
    await row.getByRole('button', { name: '改 放大 的快捷键' }).click()
    await page.keyboard.press('Control+Alt+Meta+Equal')
    await expect(row.locator('.sa-keyb')).toHaveText('⌃⌥⌘=')
    await page.keyboard.press('Escape')
    if (await dlg.count()) await page.keyboard.press('Escape')
    await expect(dlg).toHaveCount(0)
    await expect(pill(page)).toHaveAttribute('data-key', '⌃⌥⌘= ⌘- ⌘0')
    await pdfPane(page).getByTestId('pdf-view').focus()
    await page.keyboard.press('Meta+Equal')
    await page.waitForTimeout(300)
    await expect(pill(page)).toHaveText('200%')
    await page.keyboard.press('Control+Alt+Meta+Equal')
    await expect(pill(page)).toHaveText('250%')
  } finally {
    await run.close()
  }
})

/** 一个元素在第 1 页上的位置（这一页上的比例） */
async function frac(page: Page, l: Locator) {
  const p = await box(pdfPage(page, 1))
  const b = await box(l)
  return { x: (b.x - p.x) / p.width, y: (b.y - p.y) / p.height, w: b.width / p.width, h: b.height / p.height }
}
/** 照比例算回来的位置和现在量到的差几个像素 */
async function drift(page: Page, l: Locator, f: { x: number; y: number; w: number; h: number }) {
  const p = await box(pdfPage(page, 1))
  const b = await box(l)
  return Math.max(Math.abs(b.x - (p.x + f.x * p.width)), Math.abs(b.y - (p.y + f.y * p.height)), Math.abs(b.width - f.w * p.width), Math.abs(b.height - f.h * p.height))
}

test('捏合以手指为中心；放大缩小后页边标记、问过的框、框好的框、选中小条、跳回时闪的框都跟着对齐（≤ 2px）', async () => {
  const run: Running = await launch(files, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openPdf(page, '第3讲 线性映射')
    await rail(page).getByRole('button', { name: '打开 AI' }).click()
    await expect(ai(page)).toBeVisible()
    // 第 1 页框一块问：问过的框和页边标记
    const drag = async (a: [number, number], b: [number, number]) => {
      const p = await box(pdfPage(page, 1))
      await page.keyboard.down('Meta')
      await page.mouse.move(p.x + p.width * a[0], p.y + p.height * a[1])
      await page.mouse.down()
      await page.mouse.move(p.x + p.width * b[0], p.y + p.height * b[1], { steps: 6 })
      await page.mouse.up()
      await page.keyboard.up('Meta')
    }
    await drag([0.1, 0.12], [0.7, 0.2])
    await ai(page).getByRole('textbox', { name: '问 AI' }).press('Enter')
    await expect(ai(page).getByTestId('reading-msg').last().getByTestId('ai-noted')).toHaveAttribute('data-state', 'done', { timeout: 20_000 })
    const mk = pdfPane(page).getByRole('button', { name: '第 1 页这里问过 1 轮' })
    const asked = pdfPage(page, 1).locator('xpath=..').locator('.fr.asked')
    await expect(mk).toBeVisible()
    // 再框一块不发：框好的框和小条
    await drag([0.15, 0.3], [0.6, 0.38])
    const pending = pdfPane(page).getByTestId('pdf-box')
    const cap = pdfPane(page).getByRole('toolbar', { name: '框好的这块' })
    await expect(cap).toBeVisible()

    const fAsked = await frac(page, asked)
    const fPending = await frac(page, pending)
    const capGap = async () => (await box(pending)).y - ((await box(cap)).y + (await box(cap)).height)
    // 小条出来时从上面 4px 滑下来（cap-in，0.16 秒）：等它停稳再量，不然量到半路，多出一两个像素
    await cap.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
    const gap0 = await capGap()
    // 标记在纸里右边那一列（task-2onrm）：和框上沿齐，离看得到的那块纸右边一样远（纸比栏宽时贴着看得到的右边）
    const mkOff = async () => {
      const m = await box(mk)
      const a = await box(asked)
      const p = await box(pdfPage(page, 1))
      const right = await pdfPane(page).getByTestId('pdf-view').evaluate((el) => el.getBoundingClientRect().left + el.clientWidth)
      return { dy: m.y - a.y, dx: m.x - Math.min(p.x + p.width, right) }
    }
    const off0 = await mkOff()

    // 捏合：指在框好的那块中间，触控板捏合是带 ctrlKey 的滚轮，往外张五下
    const pb = await box(pending)
    const at = { x: Math.round(pb.x + pb.width / 2), y: Math.round(pb.y + pb.height / 2) }
    const p0 = await box(pdfPage(page, 1))
    const fx = (at.x - p0.x) / p0.width
    const fy = (at.y - p0.y) / p0.height
    const s0 = await pct(page)
    await page.mouse.move(at.x, at.y)
    await page.keyboard.down('Control')
    for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -8)
    await page.keyboard.up('Control')
    await expect.poll(() => pct(page)).toBeGreaterThan(s0 + 30)
    // 停下以后按新比例重画（不是把旧图拉大）
    const s1 = (await box(pdfPage(page, 1))).width / W
    await expectCrisp(page, Math.round(s1 * 1000) / 1000)
    // 手指下面还是同一处
    const p1 = await box(pdfPage(page, 1))
    expect(Math.abs(p1.x + fx * p1.width - at.x)).toBeLessThanOrEqual(2)
    expect(Math.abs(p1.y + fy * p1.height - at.y)).toBeLessThanOrEqual(2)

    // 框都跟着页面走（误差 ≤ 2px），小条还在框上方同样的距离，标记还和框上沿齐、贴着看得到的纸右边
    expect(await drift(page, asked, fAsked)).toBeLessThanOrEqual(2)
    expect(await drift(page, pending, fPending)).toBeLessThanOrEqual(2)
    await expect(cap).toBeVisible()
    expect(Math.abs((await capGap()) - gap0)).toBeLessThanOrEqual(2)
    const off1 = await mkOff()
    expect(Math.abs(off1.dy - off0.dy)).toBeLessThanOrEqual(2)
    expect(Math.abs(off1.dx - off0.dx)).toBeLessThanOrEqual(2)

    // 缩小（按键）：同样都对齐
    await page.keyboard.press('Escape')
    await pdfPane(page).getByTestId('pdf-view').focus()
    for (let i = 0; i < 6; i++) await page.keyboard.press("Meta+Minus")
    await expect.poll(() => pct(page)).toBeLessThan(s0)
    expect(await drift(page, asked, fAsked)).toBeLessThanOrEqual(2)
    const off2 = await mkOff()
    expect(Math.abs(off2.dy - off0.dy)).toBeLessThanOrEqual(2)

    // 选中一段字：放大后小条还贴着选区（文字层不重建，选着的字还在）
    const span = pdfPage(page, 2).locator('.textLayer span', { hasText: 'for every scalar c' })
    await span.scrollIntoViewIfNeeded()
    const sb = await box(span)
    await page.mouse.move(sb.x + 2, sb.y + sb.height / 2)
    await page.mouse.down()
    await page.mouse.move(sb.x + sb.width - 2, sb.y + sb.height / 2, { steps: 6 })
    await page.mouse.up()
    await expect(cap).toBeVisible()
    const selGap = async () => {
      const r = await page.evaluate(() => {
        const b = window.getSelection()!.getRangeAt(0).getBoundingClientRect()
        return { top: b.top, bottom: b.bottom, text: window.getSelection()!.toString() }
      })
      const c = await box(cap)
      return { gap: r.top - (c.y + c.height), text: r.text }
    }
    // 小条出来有 0.16 秒往下落的动画：落定了再量
    await cap.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
    const g0 = await selGap()
    await page.keyboard.press('Meta+Equal')
    await page.keyboard.press('Meta+Equal')
    await expect.poll(async () => (await rendered(page)).scale).toBeGreaterThan(0)
    await page.waitForTimeout(400)
    const g1 = await selGap()
    expect(g1.text).toBe(g0.text)
    expect(Math.abs(g1.gap - g0.gap)).toBeLessThanOrEqual(2)
    await page.keyboard.press('Escape')

    // 从笔记跳回来：闪的框和问过的框重合
    await rail(page).getByRole('button', { name: '笔记', exact: true }).click()
    const notes = page.getByRole('complementary', { name: '笔记', exact: true })
    await notes.getByRole('button', { name: '第1页 ›' }).click()
    const flash = pdfPane(page).getByTestId('pdf-flash')
    await expect(flash).toBeVisible()
    // 跳回去是平滑滚动：同一刻量两个框
    const diff = await pdfPane(page).evaluate((el) => {
      const f = el.querySelector('[data-testid="pdf-flash"]')!.getBoundingClientRect()
      const a = el.querySelector('.pdfslot .fr.asked')!.getBoundingClientRect()
      return Math.max(Math.abs(f.x - a.x), Math.abs(f.y - a.y), Math.abs(f.width - a.width), Math.abs(f.height - a.height))
    })
    expect(diff).toBeLessThanOrEqual(2)
  } finally {
    await run.close()
  }
})
