/**
 * 发版前第 5 轮（美学）找出来的 5 条小问题：每条一个测试，真点、真悬停、真拖窗口宽度，量屏幕上画出来的样子。
 */
import { expect, test, type Page } from '@playwright/test'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { acts, launch, leftView, openNote, pane, rail, type Running } from './app'
import { DREAM_VAULT } from './fixtures/dream'
import { startFakeSoniox, type FakeSoniox } from './fixtures/fake-soniox'
import { FAKE_NO_SUBS_ID, startFakeVideoSite } from './fixtures/fake-video'
import { LEFT_VAULT, withTimes } from './fixtures/left-vault'
import { shotWindow } from './shots'
import { SKINS } from '../src/shared/appearance'
import { createServer, type Server } from 'node:http'

const FAKE_YTDLP = join(__dirname, 'fixtures/fake-ytdlp.mjs')
let video: Awaited<ReturnType<typeof startFakeVideoSite>>
let soniox: FakeSoniox
let site: Server
let siteBase = ''
test.beforeAll(async () => {
  chmodSync(FAKE_YTDLP, 0o755)
  video = await startFakeVideoSite()
  soniox = await startFakeSoniox({ english: true })
  // 一个本机网站，开它的三页：新网页里这个网站一张卡「3个开着」
  site = createServer((req, res) => res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<title>第${req.url}页</title><h1>${req.url}</h1>`))
  await new Promise<void>((r) => site.listen(0, '127.0.0.1', r))
  siteBase = `http://127.0.0.1:${(site.address() as { port: number }).port}`
})
test.afterAll(() => {
  video?.server.close()
  soniox?.server.close()
  site?.close()
})

const size = (run: Running, w: number, h: number) => run.app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0]!.setSize(w, h), [w, h] as const)
const look = (a: { frame: 'a' | 'b'; skin: string }) => (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: a.skin, frame: a.frame, homeStyle: 'a' } }))
}

/** 一块里的字：换了行、新一行第一个字是不能放行首的标点（。，、；：！？）」』》），记下来 */
const ORPHANS = (root: Element) => {
  const out: string[] = []
  const blocks = root.matches('.cm-content') ? Array.from(root.querySelectorAll('.cm-line')) : [root]
  for (const block of blocks) {
    const w = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
    let lastTop = -1
    let prev = ''
    for (let n = w.nextNode() as Text | null; n; n = w.nextNode() as Text | null) {
      const t = n.data
      for (let i = 0; i < t.length; i++) {
        const r = document.createRange()
        r.setStart(n, i)
        r.setEnd(n, i + 1)
        const rs = r.getClientRects()
        if (!rs.length) continue
        const top = Math.round(rs[rs.length - 1]!.top)
        if (lastTop >= 0 && top > lastTop + 4 && /[。，、；：！？）」』》]/.test(t[i]!)) out.push(`«${prev.slice(-8)}|${t[i]}»`)
        if (rs[0]!.width > 0) {
          lastTop = top
          prev = (prev + t[i]).slice(-12)
        }
      }
    }
  }
  return out
}

/** 一块等宽原话：换行处前后都是字母或数字（一个词被拆到两行），记下来 */
const WORD_SPLITS = (root: Element) => {
  const out: string[] = []
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let lastTop = -1
  let prev = ''
  for (let n = w.nextNode() as Text | null; n; n = w.nextNode() as Text | null) {
    const t = n.data
    for (let i = 0; i < t.length; i++) {
      const r = document.createRange()
      r.setStart(n, i)
      r.setEnd(n, i + 1)
      const rs = r.getClientRects()
      if (!rs.length) continue
      const top = Math.round(rs[rs.length - 1]!.top)
      if (lastTop >= 0 && top > lastTop + 4 && /\w/.test(t[i]!) && /\w$/.test(prev)) out.push(`${prev.slice(-6)}|${t.slice(i, i + 6)}`)
      if (rs[0]!.width > 0 && t[i] !== '\n') {
        lastTop = top
        prev = (prev + t[i]).slice(-12)
      }
    }
  }
  return out
}

/** 一个元素的字和它下面的底的对比度（照 WCAG）：底色一层层往上叠到不透明为止 */
const CONTRAST = (el: Element) => {
  const probe = document.createElement('canvas').getContext('2d')!
  const rgba = (c: string): number[] => {
    // 交给 canvas 换成 rgba（color-mix、color(srgb …) 都认）
    probe.clearRect(0, 0, 1, 1)
    probe.fillStyle = c
    probe.fillRect(0, 0, 1, 1)
    const d = probe.getImageData(0, 0, 1, 1).data
    return [d[0]!, d[1]!, d[2]!, d[3]! / 255]
  }
  const blend = (top: number[], bot: number[]) => {
    const a = top[3]!
    return [0, 1, 2].map((i) => top[i]! * a + bot[i]! * (1 - a)).concat(1)
  }
  const layers: number[][] = []
  for (let n: Element | null = el; n; n = n.parentElement) {
    const b = rgba(getComputedStyle(n).backgroundColor)
    if (b[3]! > 0) {
      layers.push(b)
      if (b[3]! >= 0.99) break
    }
  }
  let bg = [255, 255, 255, 1]
  while (layers.length) bg = blend(layers.pop()!, bg)
  const fg = blend(rgba(getComputedStyle(el).color), bg)
  const lum = (c: number[]) => {
    const f = (v: number) => {
      v /= 255
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * f(c[0]!) + 0.7152 * f(c[1]!) + 0.0722 * f(c[2]!)
  }
  const [l1, l2] = [lum(fg), lum(bg)]
  return { ratio: (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05), bg: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color }
}

// ---------------------------------------------------------------- 1 粗体后的句号不落到行首

const KIN = `# 标点

2.27 和 2.28 两晚住哪还没订，**租车要四驱**。冬天去冰岛，路况一天三变，**出门前看 road.is**。

我的评价：这句话在雷克雅未克被反复印证，==出门永远带防风外套==。后面接着写一句话把这一行撑长一点看看会不会断开。

看完 [[极光预报]]，再定哪两晚去维克，云量低于三成才出门，**钉胎**，不用防滑链，*侧风*要小心。

租车公司冬天默认给钉胎（studded tyres），出门前看 \`vedur.is\`，风速超过 20 m/s 时车门可能被吹坏，[官网](https://www.vedur.is)。
`

test('粗体、高亮、链接后面的句号不单独掉到行首：文档 900–1600 每 2px 扫一遍，白板卡片 180–420 宽每 1px 扫一遍', async () => {
  test.setTimeout(300_000)
  const run = await launch({ '标点.md': KIN, '极光预报.md': '# 极光预报\n\n云量。\n' })
  const { page } = run
  try {
    await openNote(page, '标点')
    // 光标放到最后一行（人点过，记号该藏的都藏着）
    await page.keyboard.press('Meta+End')
    await page.keyboard.type('\n')
    await page.mouse.move(2, 2)
    const content = pane(page).locator('.cm-content')
    const seen = new Set<string>()
    for (let w = 900; w <= 1600; w += 2) {
      await size(run, w, 800)
      await page.waitForTimeout(60)
      for (const b of await content.evaluate(ORPHANS)) seen.add(`${w} ${b}`)
    }
    console.log(`文档：扫了 ${(1600 - 900) / 2 + 1} 个宽度，行首标点 ${seen.size} 处 ${[...seen].join(' ')}`)
    expect([...seen]).toEqual([])
    // 藏起来的 ** 两边那两个能断行的 <img> 挪出行内排版，但还量得到（高一个字，就在这一行里）
    const bufs = await content.locator('.cm-line', { hasText: '租车要四驱' }).evaluate((l) => {
      const lr = l.getBoundingClientRect()
      return Array.from(l.querySelectorAll('img.cm-widgetBuffer')).map((i) => {
        const r = i.getBoundingClientRect()
        return { pos: getComputedStyle(i).position, inLine: r.height > 10 && r.top >= lr.top - 1 && r.bottom <= lr.bottom + 1 }
      })
    })
    expect(bufs.length).toBe(8)
    expect(bufs.every((b) => b.pos === 'absolute' && b.inLine)).toBe(true)
    // 1058 宽（第 5 轮截到「。」掉到行首的那个宽度）截一张
    await size(run, 1058, 800)
    await page.waitForTimeout(200)
    await shotWindow(run, 'r5-kin-doc-1058')

    // 切到白板：同一段成一张卡片，卡片宽一点点变，句号也不掉到行首
    await size(run, 1440, 900)
    await acts(page).getByRole('tab', { name: '白板' }).click()
    const card = pane(page).getByTestId('doc-board').locator('.db-card', { hasText: '租车要四驱' })
    await expect(card).toBeVisible()
    const bad: string[] = []
    for (let w = 180; w <= 420; w++) {
      await card.evaluate((e, w) => void ((e as HTMLElement).style.width = `${w}px`), w)
      for (const b of await card.evaluate(ORPHANS)) bad.push(`${w} ${b}`)
    }
    console.log(`白板卡片：行首标点 ${bad.length} 处 ${bad.join(' ')}`)
    expect(bad).toEqual([])
  } finally {
    await run.close()
  }
})

test('藏起来的记号旁边光标用的 <img> 挪出行内排版以后：刚打开就停在「**粗体**」后面的光标照样打字，方向键一个字一个字走（藏着的 ** 不白按）', async () => {
  const run = await launch({ '光标.md': '# 光标\n\n前面是**粗体**\n' })
  const { page, vault } = run
  try {
    await openNote(page, '光标')
    // 打开时光标在这一段末尾（藏起来的 ** 后面），记号都藏着
    const line = pane(page).locator('.cm-line', { hasText: '粗体' })
    await expect(line).toHaveText('前面是粗体')
    await page.keyboard.type('。')
    await expect.poll(() => readFileSync(join(vault, '光标.md'), 'utf8'), { timeout: 5_000 }).toBe('# 光标\n\n前面是**粗体**。\n')
    // 往左走（文档方向 A：藏着的 ** 不占一下）：。前 → 体前 → 粗前 → 是前；在「是」前面打一个字
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft')
    await page.keyboard.type('就')
    await expect.poll(() => readFileSync(join(vault, '光标.md'), 'utf8'), { timeout: 5_000 }).toBe('# 光标\n\n前面就是**粗体**。\n')
  } finally {
    await run.close()
  }
})

// ---------------------------------------------------------------- 2 梦游预览条的描边按钮

for (const frame of ['b', 'a'] as const) {
  test(`梦游预览条（${frame.toUpperCase()}）：「跟AI说哪里不对」「退出预览」「丢掉」透明底细描边，十套主题静止、悬停字和底都 ≥ 4.5`, async () => {
    test.setTimeout(180_000)
    const run = await launch({ ...DREAM_VAULT }, { CN_AI_FAKE: '1' }, look({ frame, skin: 'sky' }))
    const { page } = run
    const panel = page.getByRole('complementary', { name: '梦游报告' })
    try {
      await size(run, 1440, 900)
      await leftView(page, '梦游报告')
      await panel.getByRole('button', { name: '现在梦游' }).click()
      await expect(panel.getByTestId('dream-summary')).toContainText('整理了', { timeout: 60_000 })
      await panel.getByRole('button', { name: '预览' }).click()
      const bar = page.getByTestId('preview-bar')
      await expect(bar).toBeVisible()
      const btns = bar.locator('button.btn:visible')
      await expect(btns).toHaveCount(4)
      const rows: string[] = []
      for (const skin of SKINS) {
        await page.evaluate((s) => Object.assign(document.documentElement.dataset, { skin: s.id, tone: s.tone, tabmark: s.tab }), skin)
        for (let i = 0; i < 4; i++) {
          const b = btns.nth(i)
          const name = (await b.innerText()).replace(/\s+/g, ' ').trim() || ((await b.getAttribute('aria-label')) ?? '')
          const primary = /btn-primary/.test((await b.getAttribute('class')) ?? '')
          await page.mouse.move(2, 2)
          await page.waitForTimeout(120)
          const rest = await b.evaluate(CONTRAST)
          await b.hover()
          await page.waitForTimeout(250)
          const hover = await b.evaluate(CONTRAST)
          const ring = await b.evaluate((e) => getComputedStyle(e).boxShadow)
          rows.push(`${skin.name}「${name}」 静止 ${rest.ratio.toFixed(2)} 悬停 ${hover.ratio.toFixed(2)}`)
          expect(rest.ratio, `${skin.name}「${name}」静止 ${rest.bg} 底 ${rest.color} 字`).toBeGreaterThanOrEqual(4.5)
          expect(hover.ratio, `${skin.name}「${name}」悬停 ${hover.bg} 底 ${hover.color} 字`).toBeGreaterThanOrEqual(4.5)
          if (!primary) {
            // 次按钮：底透明（字直接落在 --acc-bg 上），一圈细描边
            expect(rest.bg).toBe('rgba(0, 0, 0, 0)')
            expect(hover.bg).toBe('rgba(0, 0, 0, 0)')
            expect(ring).toMatch(/inset/)
          }
        }
        if (skin.id === 'sky' || skin.id === 'petrol') {
          await page.mouse.move(2, 2)
          await page.waitForTimeout(200)
          await shotWindow(run, `r5-preview-bar-${frame}-${skin.id}`)
        }
      }
      console.log(rows.join('\n'))
    } finally {
      await run.close()
    }
  })
}

// ---------------------------------------------------------------- 3 看原话：按单词折行，「看原话 ›」≥ 4.5

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
for (const L of [{ tag: 'B-天青', frame: 'b', skin: 'sky' }, { tag: 'B-深湖', frame: 'b', skin: 'petrol' }, { tag: 'A-天青', frame: 'a', skin: 'sky' }] as const) {
  test(`字幕没生成成（${L.tag}）：「看原话 ›」静止就 ≥ 4.5；点开的英文原话按单词折行，没有一个词被拆到两行`, async () => {
    const run = await launch({ '看视频.md': '# 看视频\n\n先记一句。\n' }, {
      CN_AI_FAKE: '1', CN_VIDEO_TEST_ORIGIN: video.base, CN_YTDLP: FAKE_YTDLP, CN_SONIOX_BASE: soniox.base, SONIOX_API_KEY: 'test-soniox-key',
      CN_FAKE_YTDLP_567: '1',
    }, look(L))
    const { page } = run
    try {
      await size(run, 1100, 700)
      await openNote(page, '看视频')
      await rail(page).getByRole('button', { name: '网页', exact: true }).click()
      const addr = web(page).getByRole('textbox', { name: '网址' })
      await addr.fill(`${video.base}/watch?v=${FAKE_NO_SUBS_ID}`)
      await addr.press('Enter')
      const strip = web(page).getByRole('region', { name: '视频条' })
      const sb = strip.getByRole('button', { name: '字幕', exact: true })
      await expect(sb).toContainText('没有字幕', { timeout: 15_000 })
      await sb.click()
      const box = web(page).getByRole('dialog', { name: '字幕' }).getByTestId('stt-box')
      await box.getByRole('button', { name: '生成字幕' }).click()
      await expect(box).toContainText('字幕没生成成', { timeout: 20_000 })
      const tg = box.getByRole('button', { name: '看原话' })
      await page.mouse.move(2, 2)
      await page.waitForTimeout(200)
      const c = await tg.evaluate(CONTRAST)
      console.log(`[${L.tag}] 看原话 静止 ${c.ratio.toFixed(2)}（${c.color}）`)
      expect(c.ratio).toBeGreaterThanOrEqual(4.5)
      await tg.click()
      const raw = box.locator('pre.raw')
      await expect(raw).toHaveText('[download] Got error: HTTP Error 567: Unknown Status. Giving up after 10 retries')
      const m = await raw.evaluate((e) => ({ w: Math.round(e.getBoundingClientRect().width), font: getComputedStyle(e).fontSize, over: e.scrollWidth > e.clientWidth }))
      const splits = await raw.evaluate(WORD_SPLITS)
      console.log(`[${L.tag}] 原话 ${m.w} 宽 ${m.font}，词被拆开 ${JSON.stringify(splits)}`)
      expect(splits).toEqual([])
      expect(m.over).toBe(false)
      expect(m.font).toBe('12px')
      await page.mouse.move(2, 2)
      await shotWindow(run, `r5-raw-stt-${L.tag}`)
    } finally {
      await run.close()
    }
  })
}

test('AI 出错框和字幕一个样子：「看原话 ›」静止 ≥ 4.5，原话按单词折行，长过整行的 Request ID 才在词里断', async () => {
  const run = await launch({ '冰岛.md': '# 冰岛\n\n先记一句。\n' }, { CN_AI_FAKE: '1' }, look({ frame: 'b', skin: 'sky' }))
  const { page } = run
  try {
    await size(run, 1100, 700)
    await openNote(page, '冰岛')
    await page.keyboard.press('Meta+j')
    const input = page.getByRole('textbox', { name: '问 AI' })
    await expect(input).toBeVisible()
    await input.fill('假装被拦：讲讲这页')
    await input.press('Enter')
    const err = page.getByTestId('ai-error')
    await expect(err).toBeVisible({ timeout: 20_000 })
    const tg = err.getByRole('button', { name: '看原话' })
    await page.mouse.move(2, 2)
    await page.waitForTimeout(200)
    const c = await tg.evaluate(CONTRAST)
    console.log(`AI 出错 看原话 静止 ${c.ratio.toFixed(2)}（${c.color}）`)
    expect(c.ratio).toBeGreaterThanOrEqual(4.5)
    await tg.click()
    const raw = err.locator('pre.raw')
    await expect(raw).toContainText('Request ID')
    const splits = await raw.evaluate(WORD_SPLITS)
    const r = await raw.evaluate((e) => ({ text: e.textContent, over: e.scrollWidth > e.clientWidth, w: Math.round(e.clientWidth) }))
    console.log(`AI 出错 原话 ${r.w} 宽：${JSON.stringify(r.text)} 拆开 ${JSON.stringify(splits)}`)
    // 只有放不下一整行的词（比一行还长）才许在词里断
    const words = (r.text ?? '').split(/\s+/)
    for (const s of splits) {
      const head = s.split('|')[0]!
      const word = words.find((x) => x.includes(head))!
      const fits = await raw.evaluate((e, word) => {
        const m = document.createElement('span')
        m.textContent = word
        e.appendChild(m)
        const ok = m.getBoundingClientRect().width <= e.clientWidth - 20
        m.remove()
        return ok
      }, word)
      expect(fits, `「${word}」放得下一行却被拆开了`).toBe(false)
    }
    expect(r.over).toBe(false)
    await shotWindow(run, 'r5-raw-ai')
  } finally {
    await run.close()
  }
})

// ---------------------------------------------------------------- 4 积累墙不被卡片边切成半格

test('首页积累墙：窗口窄、开着 AI 浮窗时只画放得下的整周，最左一列和标题齐，没有被卡片边切开的半格', async () => {
  test.setTimeout(120_000)
  const run = await launch(LEFT_VAULT, { CN_AI_FAKE: '1' }, (v) => (withTimes(v), look({ frame: 'b', skin: 'petrol' })(v)))
  const { page } = run
  const measure = () =>
    page.getByTestId('wall').evaluate((wall) => {
      const card = wall.closest('.wd') as HTMLElement
      const cs = getComputedStyle(card)
      const c = card.getBoundingClientRect()
      const inL = c.left + parseFloat(cs.paddingLeft)
      const inR = c.right - parseFloat(cs.paddingRight)
      const cells = Array.from(wall.querySelectorAll('.hgrid i')).map((i) => i.getBoundingClientRect())
      const head = (card.querySelector('.wk') as HTMLElement).getBoundingClientRect()
      return {
        weeks: cells.length / 7,
        cut: cells.filter((r) => r.left < inL - 0.5 || r.right > inR + 0.5).length,
        left: Math.round(Math.min(...cells.map((r) => r.left)) - head.left),
        right: Math.round(inR - Math.max(...cells.map((r) => r.right))),
        inner: Math.round(inR - inL),
        today: wall.querySelectorAll('.hgrid i.today').length,
      }
    })
  try {
    await expect(page.getByTestId('home')).toBeVisible()
    const rows: string[] = []
    for (const [w, h, ai] of [[1600, 1000, false], [1600, 1000, true], [1300, 800, false], [1300, 800, true], [1100, 700, false], [1100, 700, true], [960, 700, false]] as const) {
      await size(run, w, h)
      const open = await page.getByRole('textbox', { name: '问 AI' }).isVisible()
      if (open !== ai) await page.keyboard.press('Meta+j')
      await page.waitForTimeout(500)
      const m = await measure()
      rows.push(`${w}${ai ? ' 开AI' : ''}：${m.weeks} 周，内容宽 ${m.inner}，切开 ${m.cut} 格，左边离标题 ${m.left}，右边留 ${m.right}`)
      expect(m.cut).toBe(0)
      expect(m.weeks).toBe(Math.min(52, Math.floor((m.inner + 3) / 15)))
      expect(Math.abs(m.left)).toBeLessThanOrEqual(1)
      expect(m.right).toBeGreaterThanOrEqual(-0.5)
      expect(m.right).toBeLessThanOrEqual(1)
      expect(m.today).toBe(1)
      if (w === 1600 && ai) await shotWindow(run, 'r5-wall-1600-ai')
      if (w === 1100 && !ai) await shotWindow(run, 'r5-wall-1100')
    }
    console.log(rows.join('\n'))
  } finally {
    await run.close()
  }
})

// ---------------------------------------------------------------- 5 新网页的中文小字

const guest = <T,>(page: Page, code: string): Promise<T> =>
  page.evaluate((c) => {
    const w = document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> } | null
    try {
      return w ? w.executeJavaScript(c).catch(() => null) : null
    } catch {
      return null
    }
  }, code) as Promise<T>

test('新网页：「个开着」「3个开着」「个网页」这些中文小字不加字距、不小于 11（「个开着」12）', async () => {
  const run = await launch({ 'a.md': '# a\n' }, {}, look({ frame: 'b', skin: 'sky' }))
  const { page } = run
  try {
    await size(run, 1600, 1000)
    await rail(page).getByRole('button', { name: '网页', exact: true }).click()
    const addr = web(page).getByRole('textbox', { name: '网址' })
    // 同一个网站开三页，再开一个新网页
    for (const p of ['/a', '/b', '/c']) {
      if (p !== '/a') await web(page).locator('button.wnew').click()
      await addr.fill(siteBase + p)
      await addr.press('Enter')
      await expect(web(page).getByRole('tablist', { name: '网页标签' }).getByRole('tab', { selected: true })).toContainText(`第${p}页`)
    }
    await web(page).locator('button.wnew').click()
    await expect.poll(() => guest<string>(page, `document.querySelector('.open-tabs-badge')?.textContent.trim() ?? ''`), { timeout: 15_000 }).toBe('3个开着')
    // 右栏拉宽一点，看全新网页
    await page.evaluate(() => {
      const r = document.querySelector('.right.web') as HTMLElement | null
      if (r) r.style.width = '760px'
    })
    await page.waitForTimeout(600)
    const all = await guest<{ t: string; cls: string; size: number; ls: string; tt: string }[]>(
      page,
      `(() => { const out = []; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { const el = n.parentElement; const t = n.textContent.trim(); if (!el || !t || !/[\\u4e00-\\u9fff]/.test(t) || !el.getClientRects().length || el.closest('script,style')) continue; const c = getComputedStyle(el); if (c.visibility === 'hidden' || c.display === 'none') continue; out.push({ t: t.slice(0, 12), cls: el.className, size: parseFloat(c.fontSize), ls: c.letterSpacing, tt: c.textTransform }) } return out })()`,
    )
    const bad = all.filter((x) => x.size < 11 || !(x.ls === 'normal' || x.ls === '0px') || x.tt !== 'none')
    console.log(`新网页里的中文 ${all.length} 处；不合的 ${JSON.stringify(bad)}`)
    expect(all.length).toBeGreaterThan(5)
    expect(bad).toEqual([])
    const label = all.find((x) => x.cls === 'stat-label')!
    expect(label).toMatchObject({ t: '个开着', size: 12 })
    expect(all.find((x) => x.t === '3个开着')).toMatchObject({ size: 11 })
    await shotWindow(run, 'r5-newtab-1600')
  } finally {
    await run.close()
  }
})
