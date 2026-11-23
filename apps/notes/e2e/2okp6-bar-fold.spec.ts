/**
 * 矮窗口图标栏（task-2okp6，designer 对比图 /private/tmp/canvas-notes-visual/12-矮窗口图标栏/ 最后一节）：
 * 窗口一点点变矮（900 → 600，每次 10 像素，不点别处）每一步都收好：格子全在窗口里、没有被压扁、放不下的进了「⋯」；
 * 再一点点变高（600 → 900）收起的放回来，同一个高度收的格子和变矮时一样。收的顺序是旧做法：从最后一个分类往前收，
 * 「待办」「书桌」一直在（2026-11-22 用户看图定「这里用旧做法就行」）。「⋯」上是收起格子里的数字合计，收起的格子正开着时「⋯」亮着。
 * A、B 两种风格都测。无头（CN_E2E=1）、临时库、临时设置目录；菜单是系统菜单，走 e2e/menu.ts 真点。
 * CN_SHOTS=目录 时另截交付图（矮窗口，浅色天青 / 深色深湖，B 和 A）。
 */
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, type Running } from './app'
import { B2_VAULT, withTimes } from './fixtures/b2-vault'
import { armMenus, menuLabels, openedMenu, pickMenu } from './menu'

const CATS = ['收件箱', '课程', '阅读', '剪藏', '周记', '写作', '项目', '生活']
const ALL = ['文件', '待办', '日历', '最近', '书桌', ...CATS, '梦游报告', '最近删掉的', '库', '设置和外观']
const pad = (n: number) => String(n).padStart(2, '0')
const d = new Date()
const TODAY = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
/** 今天要做的三条：「待办」格上的数字是 3 */
const VAULT = { ...B2_VAULT, '写作/待办.md': `# 待办\n\n- [ ] 改第二章 📅 ${TODAY}\n- [ ] 给编辑发邮件 📅 ${TODAY}\n- [ ] 读完三篇论文 📅 ${TODAY}\n` }
/** 正常一格的高：A 48，B 34（外边距上下各 2） */
const CELL = { a: 48, b: 34 } as const

const bar = (page: Page) => page.getByRole('navigation', { name: '左栏' })
const more = (page: Page) => bar(page).getByTestId('ab-more')

function look(frame: 'a' | 'b', skin: string) {
  return (vault: string) => {
    const ud = join(dirname(vault), 'user-data')
    mkdirSync(ud, { recursive: true })
    writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin, frame, winBg: 'aurora' } }))
    withTimes(vault)
  }
}

async function start(frame: 'a' | 'b', skin = 'sky'): Promise<Running> {
  const run = await launch(VAULT, {}, look(frame, skin))
  await armMenus(run)
  await expect(bar(run.page).getByTestId('todo-count')).toHaveText('3')
  return run
}

/** 只改窗口高（宽 1440），等页面量到新高、再等两帧（ResizeObserver 和重画都过去） */
async function height(run: Running, h: number) {
  await run.app.evaluate(({ BrowserWindow }, h) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, h), h)
  await expect.poll(() => run.page.evaluate(() => innerHeight)).toBe(h)
  await run.page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
}

/** 量一次图标栏：每格的名字和框、「⋯」写着收了哪几个、栏下面剩的空 */
function measure(page: Page) {
  return bar(page).evaluate((nav) => {
    const outer = (e: Element) => {
      const cs = getComputedStyle(e)
      return (e as HTMLElement).offsetHeight + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom)
    }
    const nr = nav.getBoundingClientRect()
    const cells = [...nav.querySelectorAll('button.ab')].map((b) => {
      const r = b.getBoundingClientRect()
      return { name: b.getAttribute('aria-label')!, top: r.top, bottom: r.bottom, h: r.height }
    })
    const m = nav.querySelector('[data-testid=ab-more]')
    const sep = nav.querySelector('.ab-sep')
    return {
      win: innerHeight,
      navTop: nr.top,
      navBottom: nr.bottom,
      cells,
      tip: m?.getAttribute('data-tip') ?? null,
      slack: (nav.querySelector(':scope > .grow') as HTMLElement).offsetHeight,
      cellOuter: outer(nav.querySelector(':scope > .abg > .ab')!),
      sepOuter: sep ? outer(sep) : 0,
      fits: nav.scrollHeight <= nav.clientHeight + 1,
    }
  })
}

/** 一点点放大（⌘+ 那样整页放大），到八个分类全收进「⋯」为止 */
async function zoomToAllFolded(run: Running) {
  for (let z = 1; z < 2; z += 0.02) {
    await run.app.evaluate(({ BrowserWindow }, z) => BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(z), z)
    await run.page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
    if ((await more(run.page).getAttribute('aria-label').catch(() => null)) === '还有8个') return
  }
  throw new Error('放大到 2 倍也没把八格都收进去')
}

/** 这一步该对的：全在窗口里、一格都没压扁、收的是末尾的分类（待办、书桌一直在）、少收一格就放不下；返回收了几格 */
async function check(page: Page, frame: 'a' | 'b', h: number): Promise<number> {
  const m = await measure(page)
  const at = `窗口 ${h} 高`
  for (const c of m.cells) {
    expect(Math.abs(c.h - CELL[frame]), `${at}：「${c.name}」被压扁（${c.h} 高）`).toBeLessThan(0.05)
    expect(c.top, `${at}：「${c.name}」顶出栏外`).toBeGreaterThanOrEqual(m.navTop - 0.5)
    expect(c.bottom, `${at}：「${c.name}」掉出窗口`).toBeLessThanOrEqual(Math.min(m.win, m.navBottom) + 0.5)
  }
  expect(m.fits, `${at}：栏里放不下`).toBe(true)
  const names = m.cells.map((c) => c.name)
  const f = m.tip ? Number(m.tip.match(/^还有(\d+)个/)![1]) : 0
  const hidden = f ? CATS.slice(-f) : []
  // 收的是末尾 f 个分类，菜单提示按栏里的先后写；其余格子照旧在、顺序不变；「⋯」紧跟在最先收的那一格那一段后面
  if (f) expect(m.tip!.replace(/ \d+/g, ''), at).toBe(`还有${f}个：${hidden.join('、')}`)
  expect(names.filter((n) => !/^还有\d+个$/.test(n)), at).toEqual(ALL.filter((n) => !hidden.includes(n)))
  expect(f, `${at}：「⋯」自己占一格，只收一格腾不出地方`).not.toBe(1)
  // 收得最少：剩的空不够再放回一格（加一道分隔线）
  if (f) expect(m.slack, `${at}：收多了`).toBeLessThan(m.cellOuter + m.sepOuter)
  return f
}

for (const frame of ['b', 'a'] as const) {
  test(`${frame.toUpperCase()} 风格：900 → 600 每次矮 10、再 600 → 900 每次高 10，每一步都收好、放回来，同一高度收的一样；「待办」「书桌」和待办数字一直在`, async () => {
    test.setTimeout(240_000)
    const run = await start(frame)
    const { page } = run
    try {
      // 2026-11-22 图标栏多了「日历」一格（task-kzr3n）：A 格子大，900 高已经要收两格，从 960 起量（那里一格不收）
      const top = frame === 'a' ? 960 : 900
      await height(run, top)
      const down = new Map<number, number>()
      for (let h = top; h >= 600; h -= 10) {
        await height(run, h)
        down.set(h, await check(page, frame, h))
      }
      expect(down.get(top)).toBe(0)
      expect(down.get(900)).toBe(frame === 'b' ? 0 : 2)
      // 越矮收得越多
      const seq = [...down.values()]
      for (let i = 1; i < seq.length; i++) expect(seq[i]).toBeGreaterThanOrEqual(seq[i - 1]!)
      // 600 高：收的是末尾的分类（B 五格「剪藏」到「生活」；A 格子大，八个分类全收），「待办」「书桌」「日历」和数字 3 都还在（多了「日历」一格以前是 B 四格、A 七格）
      expect(down.get(600)).toBe(frame === 'b' ? 5 : 8)
      await expect(bar(page).getByRole('button', { name: '日历', exact: true })).toBeInViewport()
      await expect(bar(page).getByRole('button', { name: '待办', exact: true })).toBeInViewport()
      await expect(bar(page).getByRole('button', { name: '书桌', exact: true })).toBeInViewport()
      await expect(bar(page).getByTestId('todo-count')).toHaveText('3')
      for (let h = 610; h <= top; h += 10) {
        await height(run, h)
        expect(await check(page, frame, h), `变高到 ${h}，收的格数和变矮时不一样`).toBe(down.get(h))
      }
      await expect(more(page)).toHaveCount(0)
    } finally {
      await run.close()
    }
  })

  test(`${frame.toUpperCase()} 风格：从「⋯」打开收起的分类，「⋯」照普通格子亮着；换回别的格子它不亮；放大到收起收件箱时「⋯」上是收件箱的数字`, async () => {
    const run = await start(frame)
    const { page } = run
    try {
      const inbox = await bar(page).getByTestId('inbox-count').textContent()
      // A 在 600 高时连收件箱都收了（多了「日历」一格，task-kzr3n）：停在 650，只收分类
      for (let h = 900; h >= (frame === 'a' ? 650 : 600); h -= 50) await height(run, h)
      await expect(more(page)).toBeVisible()
      await expect(more(page)).toHaveAttribute('aria-pressed', 'false')
      // 收起的都是分类，没有数字：「⋯」上没有数字
      await expect(more(page).getByTestId('more-count')).toHaveCount(0)
      await more(page).click()
      const items = menuLabels(await openedMenu(run))
      expect(items.at(-1)).toBe('生活')
      await pickMenu(run, '生活')
      await expect(page.getByTestId('folder-home')).toHaveAttribute('data-folder', '生活')
      // 亮着：class on、aria-pressed，靠外一侧那道 2px 强调色竖线和普通格子亮着时一样
      await expect(more(page)).toHaveClass(/\bon\b/)
      await expect(more(page)).toHaveAttribute('aria-pressed', 'true')
      const line = () =>
        page.evaluate(() => {
          const el = document.querySelector('nav[aria-label="左栏"] .ab.on')!
          const s = getComputedStyle(el, '::before')
          return { w: s.width, bg: s.backgroundColor, content: s.content }
        })
      const moreLine = await line()
      await bar(page).getByRole('button', { name: '文件', exact: true }).click()
      await expect(more(page)).not.toHaveClass(/\bon\b/)
      await expect(more(page)).toHaveAttribute('aria-pressed', 'false')
      expect(await line()).toEqual(moreLine)
      expect(moreLine.w).toBe('2px')
      // 放大（⌘+ 那样整页放大）到连收件箱都收进去：「⋯」上是收件箱的数字，同格子上数字的样子
      // 正好收完八格又放得下的放大倍数（底部多了「最近删掉的」一格以后变了，task-iq2ow）：从 1 起每次大 0.02，收满八格就停
      await zoomToAllFolded(run)
      await expect(more(page)).toHaveAttribute('aria-label', '还有8个')
      await expect(bar(page).getByTestId('inbox-count')).toHaveCount(0)
      const badge = more(page).getByTestId('more-count')
      await expect(badge).toHaveText(inbox!)
      await expect(badge).toHaveClass(/badge num/)
      await expect(more(page)).toHaveAttribute('data-tip', new RegExp(`收件箱 ${inbox}、`))
      await expect(bar(page).getByTestId('todo-count')).toHaveText('3')
      await check(page, frame, 600)
      await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(1))
      await expect(more(page).getByTestId('more-count')).toHaveCount(0)
      await expect(bar(page).getByTestId('inbox-count')).toHaveText(inbox!)
    } finally {
      await run.close()
    }
  })
}

const SHOTS = process.env.CN_SHOTS
test.describe('交付图', () => {
  test.skip(!SHOTS, '只在截交付图时跑（CN_SHOTS=目录）')
  for (const [frame, tone, skin] of [
    ['b', 'light', 'sky'],
    ['b', 'dark', 'petrol'],
    ['a', 'light', 'sky'],
    ['a', 'dark', 'petrol'],
  ] as const) {
    test(`矮窗口 ${frame.toUpperCase()} ${tone}：一点点压到 600、从「⋯」打开「生活」`, async () => {
      test.setTimeout(120_000)
      const run = await start(frame, skin)
      const { page, app } = run
      const shot = async (name: string) => {
        await page.mouse.move(700, 400)
        await page.waitForTimeout(450)
        const b64 = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
        mkdirSync(SHOTS!, { recursive: true })
        writeFileSync(join(SHOTS!, `${name}.png`), Buffer.from(b64, 'base64'))
      }
      try {
        for (let h = 900; h >= 600; h -= 10) await height(run, h)
        await shot(`${frame}-${tone}-600`)
        if (await more(page).count()) {
          await more(page).click()
          await openedMenu(run)
          await pickMenu(run, '生活')
          await shot(`${frame}-${tone}-600-more-on`)
          // 放大到收件箱也收进去：「⋯」上是收件箱的数字
          await bar(page).getByRole('button', { name: '文件', exact: true }).click()
          await zoomToAllFolded(run)
          await expect(more(page).getByTestId('more-count')).toBeVisible()
          await shot(`${frame}-${tone}-600-zoom-badge`)
        }
      } finally {
        await run.close()
      }
    })
  }
})
