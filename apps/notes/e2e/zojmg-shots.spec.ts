// 英文版第一批的中英对照图（task-zojmg）：同一个库、同一个状态，中文、英文各截一张，浅色天青、深色深湖。
// 只在给了 CN_SHOTS（放图的文件夹）时跑；CN_SHOT_TONE=dark 截深色。窗口 1440 × 887，浮岛书桌，同设计稿。
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, leftView, type Running } from './app'

const DIR = process.env.CN_SHOTS ?? ''
const DARK = process.env.CN_SHOT_TONE === 'dark'
const TONE = DARK ? 'dark' : 'light'
test.skip(!DIR, '只在 CN_SHOTS 给了时截图')

const LIB: Record<string, string> = {
  '收件箱/Call the landlord.md': '# Call the landlord\n\nAsk about the heating before Friday.\n',
  '收件箱/Podcast idea.md': '# Podcast idea\n\nShort episodes on how people take notes.\n',
  '收件箱/待办.md': '# 待办\n\n- [ ] Book the ice cave tour 📅 2026-11-22\n- [ ] Call the landlord\n- [x] Pay rent\n',
  '课程/Machine Learning/Lecture 5 Attention.md': '# Lecture 5 Attention\n\nHow one word "looks at" the other words in a sentence.\n',
  '课程/Machine Learning/Lecture 4 Backprop.md': '# Lecture 4 Backprop\n\nThe chain rule, one layer at a time.\n',
  '课程/Linear Algebra/Week 3 Linear maps.md': '# Week 3 Linear maps\n\nKernel and image.\n',
  '阅读/Thinking, Fast and Slow.md': '# Thinking, Fast and Slow\n\nSystem 1 is fast and automatic; System 2 is slow and effortful.\n',
  '剪藏/How transformers work.md': '# How transformers work\n\n> Attention lets every token see every other token.\n',
  '周记/2026-W47.md': '# 2026-W47\n\nMonday: started the homework for lecture 5.\n',
  '写作/On slow reading.md': '# On slow reading\n\nA draft about reading one book for a whole month.\n',
  '项目/Iceland trip/Itinerary.md': '# Itinerary\n\nDay 1: Reykjavík. Day 2: the south coast.\n',
  '项目/Iceland trip/Trip board.md': '---\ntype: board\n---\n# Trip board\n\n## Before we go\n\nBook the ice cave tour two weeks ahead.\n',
  '生活/Running log.md': '# Running log\n\n5 km, 31 min.\n',
}

const look = (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: DARK ? 'petrol' : 'sky', frame: 'b', winBg: 'aurora' } }))
}

async function shot(page: Page, name: string, lang: string) {
  await page.waitForTimeout(450)
  await page.screenshot({ path: join(DIR, `${name}-${lang}-${TONE}.png`) })
  // 量：被截掉的（有省略号 / 直接裁掉）、按钮和标签折了行的、还露着的中文（用户的字也在里面，人工分）；对照页上标框用的几块
  const m = await page.evaluate(measure)
  const marks: Record<string, number[]> = {}
  for (const [k, sel] of Object.entries(MARKS)) {
    const loc = page.locator(sel).first()
    // 没有的不等（boundingBox 默认会等 30 秒）
    const r = (await loc.count()) ? await loc.boundingBox({ timeout: 500 }).catch(() => null) : null
    if (r && r.width && r.height) marks[k] = [r.x, r.y, r.width, r.height].map((v) => Math.round(v))
  }
  writeFileSync(join(DIR, `${name}-${lang}-${TONE}.json`), JSON.stringify({ ...m, marks }, null, 1))
}

/** 对照页上标框的几块（有就记） */
const MARKS: Record<string, string> = {
  lang: '[data-row="lang"]',
  toast: '[data-testid="settings-toast"].show',
  nav: '.set-nav',
  chips: 'aside.side .tchips',
  side: 'aside.side',
  status: 'footer.status',
  palFoot: '.pal-foot',
  palette: '.pal',
  greet: '.hello',
  quickWin: '.qk',
  srch: '.sa-srch',
  head: '[data-testid="settings-head"]',
}

function measure() {
  const HAN = /\p{Script=Han}/u
  const out: { cut: { text: string; why: string; box: number[] }[]; wrap: { text: string; box: number[] }[]; han: string[] } = { cut: [], wrap: [], han: [] }
  const vis = (r: DOMRect) => r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth
  const box = (r: DOMRect) => [r.x, r.y, r.width, r.height].map((v) => Math.round(v))
  const han = new Set<string>()
  for (const el of document.querySelectorAll<HTMLElement>('body *')) {
    const r = el.getBoundingClientRect()
    if (!vis(r)) continue
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent ?? '').join('').replace(/\s+/g, ' ').trim()
    const cs = getComputedStyle(el)
    if (own && HAN.test(own) && cs.visibility !== 'hidden') han.add(own.slice(0, 60))
    const ph = (el as HTMLInputElement).placeholder
    if (ph && HAN.test(ph)) han.add('[提示字] ' + ph)
    if (!own && !ph) continue
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && (cs.overflowX !== 'visible' || cs.textOverflow === 'ellipsis'))
      out.cut.push({ text: (own || ph).slice(0, 80), why: cs.textOverflow === 'ellipsis' ? '省略号' : '裁掉', box: box(r) })
    const clickable = /^(BUTTON|A|LABEL)$/.test(el.tagName) || ['tab', 'menuitem', 'radio', 'option'].includes(el.getAttribute('role') ?? '')
    if (clickable && cs.whiteSpace !== 'nowrap') {
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4
      // 只量字本身占了几行（按钮里的缩略图、图标不算一行）
      const tops = new Set<number>()
      for (const n of el.childNodes) {
        if (n.nodeType !== 3 || !(n.textContent ?? '').trim()) continue
        const range = document.createRange()
        range.selectNodeContents(n)
        for (const x of range.getClientRects()) tops.add(Math.round(x.top))
      }
      const lines = tops.size
      if (lines > 1 && r.height > lh * 1.6) out.wrap.push({ text: own.slice(0, 80), box: box(r) })
    }
  }
  out.han = [...han]
  return out
}

/** 一种语言把这一批的画面走一遍 */
async function walk(lang: 'zh' | 'en') {
  const run: Running = await launch(LIB, { CN_AI_FAKE: '1', CN_LANG: lang }, look)
  const { page, app } = run
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    await expect.poll(() => page.evaluate(() => innerHeight)).toBe(887)
    await page.waitForTimeout(800)
    // 首页 + 左栏「最近」
    await leftView(page, '最近')
    await shot(page, 'home', lang)
    // 左栏「文件」（目录树的样子归下一批，这里看头上的类型筛选和底栏）
    await leftView(page, '文件')
    await shot(page, 'files', lang)
    // 左边「待办」格
    await page.getByTestId('ab-todo').click()
    await shot(page, 'todo', lang)
    await leftView(page, '最近')
    // ⌘K：没打字时、打了几个字时
    await page.keyboard.press('Meta+k')
    await page.waitForTimeout(300)
    await shot(page, 'cmdk', lang)
    await page.keyboard.type(lang === 'en' ? 'new' : '新建')
    await shot(page, 'cmdk-typed', lang)
    await page.keyboard.press('Escape')
    // 设置：每一页
    await page.keyboard.press('Meta+,')
    const dlg = page.getByRole('dialog', { name: /^(设置|Settings)$/ })
    await expect(dlg).toBeVisible()
    const pages = dlg.getByRole('navigation').locator('button.si')
    const n = await pages.count()
    for (let i = 0; i < n; i++) {
      await pages.nth(i).click()
      await shot(page, `settings-${String(i + 1).padStart(2, '0')}`, lang)
    }
    // 设置里搜
    await dlg.getByRole('textbox').first().fill(lang === 'en' ? 'font' : '字号')
    await shot(page, 'settings-search', lang)
    await page.keyboard.press('Escape')
    // 切语言的提示条：中文那一遍切成 English（提示条是英文），英文那一遍切成简体中文（提示条是中文）；切完拍的是新语言
    await pages.first().click()
    await dlg.locator('[data-row="lang"]').getByRole('combobox').selectOption(lang === 'zh' ? 'en' : 'zh')
    await expect(dlg.getByTestId('settings-toast')).toBeVisible()
    await shot(page, 'lang-toast', lang === 'zh' ? 'en' : 'zh')
    await dlg.locator('[data-row="lang"]').getByRole('combobox').selectOption(lang)
    await page.keyboard.press('Escape')
    // 速记小窗（菜单栏图标里点「速记」）
    // 小窗可能已经建好（藏着）：有就直接点，没有等它出来
    const click = () => app.evaluate(() => (globalThis as unknown as { cnQuick: { menu: Electron.Menu } }).cnQuick.menu.items[0]!.click())
    let quick = app.windows().find((w) => w.url().endsWith('/quick.html'))
    if (quick) await click()
    else [quick] = await Promise.all([app.waitForEvent('window'), click()])
    await quick.waitForLoadState()
    await quick.waitForTimeout(500)
    await quick.screenshot({ path: join(DIR, `quick-${lang}-${TONE}.png`) })
  } finally {
    await run.close()
  }
}

test('第一批画面：中文', async () => {
  test.setTimeout(240_000)
  mkdirSync(DIR, { recursive: true })
  await walk('zh')
})

test('第一批画面：英文', async () => {
  test.setTimeout(240_000)
  await walk('en')
})
