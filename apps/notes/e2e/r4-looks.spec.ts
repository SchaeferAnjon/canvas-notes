/**
 * 发版前第 4 轮（美学）找出来的问题：每条一个测试，真点、真按、真悬停，量屏幕上画出来的样子。
 */
import { expect, test, type Locator, type Page } from '@playwright/test'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, leftView, openNote, rail, type Running } from './app'
import { DREAM_VAULT } from './fixtures/dream'
import { startFakeSoniox, type FakeSoniox } from './fixtures/fake-soniox'
import { FAKE_NO_SUBS_ID, startFakeVideoSite } from './fixtures/fake-video'
import { LEFT_VAULT, withTimes } from './fixtures/left-vault'
import { shotWindow } from './shots'

const FAKE_YTDLP = join(__dirname, 'fixtures/fake-ytdlp.mjs')
let video: Awaited<ReturnType<typeof startFakeVideoSite>>
let soniox: FakeSoniox
test.beforeAll(async () => {
  chmodSync(FAKE_YTDLP, 0o755)
  video = await startFakeVideoSite()
  soniox = await startFakeSoniox({ english: true })
})
test.afterAll(() => {
  video?.server.close()
  soniox?.server.close()
})

const size = (run: Running, w: number, h: number) => run.app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0]!.setSize(w, h), [w, h] as const)
/** 外观写进设置（启动前） */
const look = (a: { frame: 'a' | 'b'; skin: string }) => (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: a.skin, frame: a.frame, homeStyle: 'a' } }))
}
const LOOKS = [
  { tag: 'B-浅', frame: 'b', skin: 'sky' },
  { tag: 'A-浅', frame: 'a', skin: 'sky' },
  { tag: 'B-深', frame: 'b', skin: 'petrol' },
] as const

// ---------------------------------------------------------------- 量

/** 首页组件区：.hwrap 的内容宽、网格列数、几处会折行的字各占几行、有没有东西伸出卡片 */
const HOME_MEASURE = () => {
  const lines = (e: Element) => {
    const r = document.createRange()
    r.selectNodeContents(e)
    return new Set(Array.from(r.getClientRects()).filter((x) => x.width > 0).map((x) => Math.round(x.top))).size
  }
  const wrap = document.querySelector('[data-testid="home"] .hwrap') as HTMLElement
  const cs = getComputedStyle(wrap)
  const inner = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
  const grid = document.querySelector('[data-testid="home"] .wgrid') as HTMLElement
  const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length
  const wrapped: string[] = []
  for (const sel of ['.clock .dt', '.w-inbox .big small', '.th .n b']) for (const e of Array.from(grid.querySelectorAll(sel))) if (lines(e) > 1) wrapped.push(`${sel} «${e.textContent}» ${lines(e)}行`)
  // 白板卡底那一行：日期那段要么整段露着（和数同一行），要么整段藏起来，不折成两半
  const metas = Array.from(grid.querySelectorAll('.th .n > span')).map((m) => {
    const box = m.getBoundingClientRect()
    const segs = Array.from(m.children).map((s) => {
      const r = s.getBoundingClientRect()
      return { t: s.textContent, lines: lines(s), shown: r.bottom <= box.bottom + 0.5 && r.top >= box.top - 0.5 }
    })
    return segs
  })
  for (const segs of metas) for (const s of segs) if (s.lines > 1) wrapped.push(`白板卡底 «${s.t}» ${s.lines}行`)
  // 伸出卡片：卡片里每个有字的东西右边不超过卡片右边
  const out: string[] = []
  for (const card of Array.from(grid.querySelectorAll('.wd'))) {
    const c = card.getBoundingClientRect()
    for (const e of Array.from(card.querySelectorAll('*'))) {
      if (!(e.textContent || '').trim() || e.children.length > 2) continue
      const r = e.getBoundingClientRect()
      if (!r.width) continue
      if (getComputedStyle(e).visibility === 'hidden') continue
      const clipped = e.closest('.th .n > span') && (r.top >= (e.closest('.th .n > span') as Element).getBoundingClientRect().bottom - 0.5)
      if (clipped) continue
      if (r.right > c.right + 0.5) out.push(`${(card as HTMLElement).dataset.widget}: «${(e.textContent || '').trim().slice(0, 16)}» 伸出 ${Math.round(r.right - c.right)}`)
    }
  }
  return { inner: Math.round(inner), cols, wrapped, out, metas, cardW: Array.from(grid.querySelectorAll('.wd')).map((c) => `${(c as HTMLElement).dataset.widget}:${Math.round(c.getBoundingClientRect().width)}`) }
}

/** 一个按钮的字和底的对比度（照 WCAG）：底色往上一层层叠到不透明为止，按钮自己的 opacity 连底带字一起淡 */
const CONTRAST = (el: Element) => {
  const parse = (c: string): number[] | null => {
    let m = c.match(/^rgba?\(([^)]+)\)/)
    if (m) {
      const p = m[1]!.split(/[\s,/]+/).filter(Boolean).map(Number)
      return [p[0]!, p[1]!, p[2]!, p[3] ?? 1]
    }
    m = c.match(/^color\(srgb ([^)]+)\)/)
    if (m) {
      const p = m[1]!.split(/[\s/]+/).filter(Boolean).map(Number)
      return [p[0]! * 255, p[1]! * 255, p[2]! * 255, p[3] ?? 1]
    }
    return null
  }
  const blend = (top: number[], bot: number[]) => {
    const a = top[3]!
    return [top[0]! * a + bot[0]! * (1 - a), top[1]! * a + bot[1]! * (1 - a), top[2]! * a + bot[2]! * (1 - a), 1]
  }
  const under = (from: Element | null): number[] => {
    const layers: number[][] = []
    let n = from
    while (n) {
      const b = parse(getComputedStyle(n).backgroundColor)
      if (b && b[3]! > 0) {
        layers.push(b)
        if (b[3]! >= 0.99) break
      }
      n = n.parentElement
    }
    let c = layers.length ? layers.pop()! : [255, 255, 255, 1]
    if (c[3]! < 0.99) c = blend(c, [255, 255, 255, 1])
    while (layers.length) c = blend(layers.pop()!, c)
    return c
  }
  const lum = (c: number[]) => {
    const f = (v: number) => {
      v /= 255
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * f(c[0]!) + 0.7152 * f(c[1]!) + 0.0722 * f(c[2]!)
  }
  const cs = getComputedStyle(el)
  const base = under(el.parentElement)
  const own = parse(cs.backgroundColor) ?? [0, 0, 0, 0]
  const op = Number(cs.opacity)
  const bg = blend([own[0]!, own[1]!, own[2]!, own[3]! * op], base)
  const fg0 = parse(cs.color)!
  const fg = blend([fg0[0]!, fg0[1]!, fg0[2]!, fg0[3]! * op], bg)
  const l1 = lum(fg)
  const l2 = lum(bg)
  return { ratio: (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05), bg: cs.backgroundColor, color: cs.color, opacity: op }
}

/** 悬停前后各量一次（悬停后等过渡走完） */
async function hoverContrast(page: Page, btn: Locator) {
  await page.mouse.move(2, 2)
  await page.waitForTimeout(250)
  const rest = await btn.evaluate(CONTRAST)
  await btn.hover()
  await page.waitForTimeout(300)
  const hover = await btn.evaluate(CONTRAST)
  return { rest, hover }
}

/** 一块里每个看得见、能点的 .btn：悬停时对比度不低于 4.5（静止时就不到 4.5 的淡字按钮，悬停不能更淡） */
async function allButtonsReadableOnHover(page: Page, scope: Locator, where: string) {
  const btns = scope.locator('button.btn:visible:not([disabled])')
  const n = await btns.count()
  const rows: string[] = []
  for (let i = 0; i < n; i++) {
    const b = btns.nth(i)
    const name = ((await b.textContent()) ?? '').trim() || ((await b.getAttribute('aria-label')) ?? '')
    const { rest, hover } = await hoverContrast(page, b)
    rows.push(`${where}「${name}」 静止 ${rest.ratio.toFixed(2)} 悬停 ${hover.ratio.toFixed(2)}（${hover.bg} / ${hover.color}）`)
    if (rest.ratio >= 4.5) expect(hover.ratio, `${where}「${name}」悬停：${hover.bg} 底 ${hover.color} 字`).toBeGreaterThanOrEqual(4.5)
    else expect(hover.ratio, `${where}「${name}」悬停比静止更淡`).toBeGreaterThanOrEqual(rest.ratio - 0.2)
  }
  return rows
}

// ---------------------------------------------------------------- 首页 + AI 浮窗

for (const L of LOOKS) {
  test(`首页开着 AI 浮窗（${L.tag}）：组件按让出浮窗后剩下的宽换列，1100 / 1300 / 1600 下没有字折成两半、没有东西伸出卡片`, async () => {
    const run = await launch(LEFT_VAULT, { CN_AI_FAKE: '1' }, (v) => (withTimes(v), look(L)(v)))
    const { page } = run
    try {
      await expect(page.getByTestId('home')).toBeVisible()
      for (const [w, h] of [[1100, 700], [1300, 800], [1600, 1000]] as const) {
        await size(run, w, h)
        await page.waitForTimeout(500)
        const closed = await page.evaluate(HOME_MEASURE)
        await page.keyboard.press('Meta+j')
        await expect(page.getByRole('textbox', { name: '问 AI' })).toBeVisible()
        await page.waitForTimeout(500)
        const m = await page.evaluate(HOME_MEASURE)
        console.log(`[${L.tag} ${w}] 不开AI 内容宽${closed.inner} ${closed.cols}列 · 开AI 内容宽${m.inner} ${m.cols}列 ${m.cardW.join(' ')}`)
        // 让出浮窗：组件区右边在浮窗左边之外（不被浮窗盖住）
        const gap = await page.evaluate(() => (document.querySelector('.ai.floating') as HTMLElement).getBoundingClientRect().left - (document.querySelector('[data-testid="home"] .wgrid') as HTMLElement).getBoundingClientRect().right)
        expect(gap).toBeGreaterThanOrEqual(0)
        expect(m.inner).toBeLessThan(closed.inner)
        expect(m.cols).toBe(m.inner > 680 ? 4 : m.inner > 400 ? 2 : 1)
        expect(m.wrapped).toEqual([])
        expect(m.out).toEqual([])
        expect(closed.wrapped).toEqual([])
        expect(closed.out).toEqual([])
        await shotWindow(run, `r4-home-ai-${L.tag}-${w}`)
        await page.keyboard.press('Meta+j')
        await expect(page.getByRole('textbox', { name: '问 AI' })).toBeHidden()
      }
    } finally {
      await run.close()
    }
  })
}

// ---------------------------------------------------------------- 生成字幕

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
async function openSttMenu(page: Page) {
  await openNote(page, '看视频')
  await rail(page).getByRole('button', { name: '网页', exact: true }).click()
  const addr = web(page).getByRole('textbox', { name: '网址' })
  await addr.fill(`${video.base}/watch?v=${FAKE_NO_SUBS_ID}`)
  await addr.press('Enter')
  const strip = web(page).getByRole('region', { name: '视频条' })
  await expect(strip).toBeVisible({ timeout: 15_000 })
  const sb = strip.getByRole('button', { name: '字幕', exact: true })
  await expect(sb).toContainText('没有字幕', { timeout: 15_000 })
  await sb.click()
  return web(page).getByRole('dialog', { name: '字幕' })
}

for (const L of [LOOKS[0], LOOKS[2]]) {
  test(`生成字幕（${L.tag}）：黑色「生成字幕」「再试一次」悬停时字看得清；步骤行一行、分隔号不落到行首、和字幕轨同一个名字；失败时一句中文 +「看原话」`, async () => {
    const run = await launch({ '看视频.md': '# 看视频\n\n先记一句。\n' }, {
      CN_AI_FAKE: '1', CN_VIDEO_TEST_ORIGIN: video.base, CN_YTDLP: FAKE_YTDLP, CN_SONIOX_BASE: soniox.base, SONIOX_API_KEY: 'test-soniox-key',
      CN_FAKE_YTDLP_567: '1', CN_FAKE_YTDLP_DELAY_MS: '1500',
    }, look(L))
    const { page } = run
    try {
      await size(run, 1100, 700)
      const menu = await openSttMenu(page)
      const box = menu.getByTestId('stt-box')
      const go = box.getByRole('button', { name: '生成字幕' })
      await expect(go).toHaveClass(/btn-primary/)
      const g = await hoverContrast(page, go)
      console.log(`[${L.tag}] 生成字幕 静止 ${g.rest.ratio.toFixed(2)} 悬停 ${g.hover.ratio.toFixed(2)} ${g.hover.bg}`)
      expect(g.hover.ratio).toBeGreaterThanOrEqual(4.5)
      await shotWindow(run, `r4-stt-hover-${L.tag}`)
      // 点了不挪鼠标：生成中
      await go.click()
      await expect(box).toContainText('正在生成')
      const steps = box.getByTestId('stt-steps')
      await expect(steps).toContainText('下载音频中')
      await expect(steps).toContainText('听写 · Soniox')
      const st = await steps.evaluate((e) => {
        const r = document.createRange()
        r.selectNodeContents(e)
        const tops = new Set(Array.from(r.getClientRects()).filter((x) => x.width > 0).map((x) => Math.round(x.top)))
        return { lines: tops.size, over: e.scrollWidth > e.clientWidth, text: (e as HTMLElement).innerText }
      })
      expect(st.lines).toBe(1)
      expect(st.over).toBe(false)
      expect(st.text).not.toMatch(/^[·→]|\n[·→]/)
      await expect(box.locator('.vstt-foot')).toContainText('（听写 · Soniox）')
      await shotWindow(run, `r4-stt-running-${L.tag}`)
      // 失败：鼠标还停在原处，「再试一次」就在它下面
      await expect(box).toContainText('字幕没生成成', { timeout: 20_000 })
      const err = box.getByTestId('stt-error')
      await expect(err).toHaveText('YouTube的音频服务器拒绝了下载，再试一次多半就好')
      await expect(box).not.toContainText('HTTP Error 567')
      const again = box.getByRole('button', { name: '再试一次' })
      const a = await hoverContrast(page, again)
      console.log(`[${L.tag}] 再试一次 静止 ${a.rest.ratio.toFixed(2)} 悬停 ${a.hover.ratio.toFixed(2)} ${a.hover.bg}`)
      expect(a.hover.ratio).toBeGreaterThanOrEqual(4.5)
      await shotWindow(run, `r4-stt-failed-hover-${L.tag}`)
      // 看原话：点开才露英文，等宽
      await box.getByRole('button', { name: '看原话' }).click()
      const raw = box.locator('pre.raw')
      await expect(raw).toHaveText('[download] Got error: HTTP Error 567: Unknown Status. Giving up after 10 retries')
      expect(await raw.evaluate((e) => getComputedStyle(e).fontFamily)).toMatch(/mono|Menlo|SF Mono/i)
      await shotWindow(run, `r4-stt-failed-raw-${L.tag}`)
      console.log((await allButtonsReadableOnHover(page, menu, `${L.tag} 字幕菜单`)).join('\n'))
    } finally {
      await run.close()
    }
  })
}

// ---------------------------------------------------------------- 全软件的实心 / 自己定了底色的按钮

test('全软件自己定了底色的按钮（黑色实心、梦游预览条、底部提示里的「撤回」、设置里的「保存」）：悬停时字和底的对比度都不低于 4.5', async () => {
  for (const L of [LOOKS[0], LOOKS[1], LOOKS[2]]) {
    const run = await launch({ ...DREAM_VAULT }, { CN_AI_FAKE: '1' }, look(L))
    const { page } = run
    const panel = page.getByRole('complementary', { name: '梦游报告' })
    const rows: string[] = []
    try {
      await size(run, 1440, 900)
      // 梦游：收下一条 → 底部提示条带「撤回」
      await leftView(page, '梦游报告')
      await panel.getByRole('button', { name: '现在梦游' }).click()
      await expect(panel.getByTestId('dream-summary')).toContainText('整理了', { timeout: 60_000 })
      await panel.getByTestId('dream-item').filter({ hasText: /^冰洞\s*从/ }).click()
      await panel.getByTestId('dream-detail').getByRole('button', { name: '收下', exact: true }).click()
      // 归类这条走预览那条提示（中间栏上浮着）
      const pvToast = page.getByTestId('preview-toast')
      await expect(pvToast.getByRole('button', { name: '撤回' })).toBeVisible()
      rows.push(...(await allButtonsReadableOnHover(page, pvToast, `${L.tag} 梦游提示`)))
      // 补双链那条走底栏里的提示（黑底，按钮自己是半透明灰底）
      await panel.getByTestId('dream-item').filter({ hasText: /↔/ }).first().click()
      await panel.getByTestId('dream-detail').getByRole('button', { name: '收下', exact: true }).click()
      const toast = page.getByTestId('toast')
      await expect(toast.getByRole('button', { name: '撤回' })).toBeVisible()
      rows.push(...(await allButtonsReadableOnHover(page, toast, `${L.tag} 底栏提示`)))
      // 预览条：跟 AI 说、退出预览、丢掉、收下这 N 处
      await panel.getByRole('button', { name: '预览' }).click()
      const bar = page.getByTestId('preview-bar')
      await expect(bar).toBeVisible()
      rows.push(...(await allButtonsReadableOnHover(page, bar, `${L.tag} 预览条`)))
      await shotWindow(run, `r4-buttons-preview-${L.tag}`)
      await page.keyboard.press('Escape')
      // 设置 › Git 和同步：填了地址的「保存」是黑色实心
      await page.keyboard.press('Meta+,')
      // B 是弹窗，A 是中间一个标签
      const dlg = L.frame === 'b' ? page.getByRole('dialog', { name: '设置' }) : page.locator('.setpane')
      await dlg.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: 'Git和同步', exact: true }).click()
      await dlg.getByRole('textbox', { name: '远程地址' }).fill('https://example.com/a.git')
      const save = dlg.getByRole('button', { name: '保存', exact: true })
      await expect(save).toHaveClass(/btn-primary/)
      rows.push(...(await allButtonsReadableOnHover(page, dlg, `${L.tag} 设置 Git`)))
      console.log(rows.join('\n'))
    } finally {
      await run.close()
    }
  }
})

// ---------------------------------------------------------------- 梦游收下：窄时短写

test('梦游收下：窄时状态条和底部提示短写成「已收下 · 提交号」，提交号整个露着，「合进main」在悬停提示里；宽时照写全句', async () => {
  const run = await launch({ ...DREAM_VAULT }, { CN_AI_FAKE: '1' })
  const { page } = run
  const panel = page.getByRole('complementary', { name: '梦游报告' })
  try {
    await size(run, 1100, 700)
    await openNote(page, '所思所想')
    await leftView(page, '梦游报告')
    await panel.getByRole('button', { name: '现在梦游' }).click()
    await expect(panel.getByTestId('dream-summary')).toContainText('整理了', { timeout: 60_000 })
    await panel.getByTestId('dream-item').filter({ hasText: /^极光\s*从/ }).click()
    await panel.getByTestId('dream-detail').getByRole('button', { name: '收下', exact: true }).click()
    const fit = (loc: Locator) => loc.evaluate((e) => {
      const vis = (s: string) => { const x = e.querySelector(s) as HTMLElement | null; return x && getComputedStyle(x).display !== 'none' ? x.innerText : null }
      const c = e.querySelector('code') as HTMLElement
      const r = e.getBoundingClientRect()
      const cr = c.getBoundingClientRect()
      return { long: vis('.long'), short: vis('.short'), cut: Array.from(e.querySelectorAll('span')).some((s) => getComputedStyle(s).display !== 'none' && s.scrollWidth > s.clientWidth + 0.5), codeIn: cr.right <= r.right + 0.5, codeWhole: c.scrollWidth <= c.clientWidth, width: Math.round(r.width), box: Math.round((e.parentElement as HTMLElement).getBoundingClientRect().width) }
    })

    // 详情里的状态条：左栏默认宽（252）放不下全句，短写，提交号整个露着；悬停看整句
    const state = panel.locator('.pv-state')
    await expect(state.locator('code')).toHaveText(/^[0-9a-f]{7}$/)
    const s1 = await fit(state)
    console.log('状态条 默认宽', JSON.stringify(s1))
    expect(s1).toMatchObject({ short: '已收下 ·', long: null, cut: false, codeIn: true, codeWhole: true })
    await state.locator('.short').hover()
    await expect(page.getByTestId('tooltip')).toHaveText('已收下，合进main')
    await shotWindow(run, 'r4-dream-state')
    // 全句要多宽：把全句硬露出来量（说明不省略、提交号整个在行里）
    const need = await state.evaluate((e) => {
      const l = e.querySelector('.long') as HTMLElement
      const sh = e.querySelector('.short') as HTMLElement
      l.style.cssText = 'display:inline; overflow:visible'
      sh.style.display = 'none'
      const cs = getComputedStyle(e)
      const w = Array.from(e.children).filter((c) => getComputedStyle(c).display !== 'none').reduce((a, c) => a + (c as HTMLElement).scrollWidth, 0) + 4 * (e.children.length - 2) + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)
      l.style.cssText = ''
      sh.style.display = ''
      return Math.ceil(w)
    })
    console.log('状态条 全句要', need)
    expect(need).toBeGreaterThan(s1.width)
    // 左栏拉宽到放得下（详情那块内容宽到 200）：全句，一个字不省略
    await page.evaluate(() => ((document.querySelector('.dd') as HTMLElement).style.width = '208px'))
    const s2 = await fit(state)
    console.log('状态条 宽', JSON.stringify(s2))
    expect(s2).toMatchObject({ short: null, long: '已收下，合进main ·', cut: false, codeIn: true, codeWhole: true })
    await page.evaluate(() => ((document.querySelector('.dd') as HTMLElement).style.width = ''))

    // 中间栏上浮着的提示条：开着历史（中间 420 宽）短写
    const toast = page.getByTestId('preview-toast')
    await expect(toast.locator('code')).toHaveText(/^[0-9a-f]{7}$/)
    await rail(page).getByRole('button', { name: '历史', exact: true }).click()
    await page.waitForTimeout(400)
    const narrow = await fit(toast)
    console.log('提示条 窄', JSON.stringify(narrow))
    await shotWindow(run, 'r4-dream-toast-narrow')
    expect(narrow.box).toBeLessThanOrEqual(520)
    expect(narrow).toMatchObject({ short: '已收下 ·', long: null, cut: false, codeIn: true, codeWhole: true })
    await toast.locator('.short').hover()
    await expect(page.getByTestId('tooltip')).toHaveText('收下了1处，已提交到main')
    // 关掉历史：中间宽了，全句
    await rail(page).getByRole('button', { name: '历史', exact: true }).click()
    await page.waitForTimeout(400)
    const wide = await fit(toast)
    console.log('提示条 宽', JSON.stringify(wide))
    expect(wide.box).toBeGreaterThan(520)
    expect(wide).toMatchObject({ long: '收下了1处，已提交到main', short: null, cut: false, codeIn: true, codeWhole: true })
    await shotWindow(run, 'r4-dream-toast-wide')
  } finally {
    await run.close()
  }
})
