/**
 * 费曼「聊到底」（design/feynman-long 方向 A，② 列界面线）：真点一遍。
 * - 单子上「追问：三轮 ｜ 聊到底」选聊到底开讲 → 讲一段 → 追问 → 答不上换角度 → 再答不上给提示 → 第三次说穿 →（另一问）点「说穿吧」→
 *   点「先跳过」→ 点小点看「聊到哪了」→ 学生问完问收尾（暂停接着讲回到问收尾那块）→「接着往深里聊」→ 列头「收尾」→ 判定卡里的长谈记录；
 * - 说反了躲不掉：讲成「加上」，学生拿误解问，点先跳过，提前点收尾 →「收尾前说穿」块、那条讲错；
 * - 三轮用完点「接着聊下去」：注释转成 mode long，前面三轮照算；
 * - 开关记住上次选的（存在设置里，重开软件照旧）；
 * - 聊了多久、聊过 20 分钟那句、暂停接着讲回到等你答的那一问。
 * 每一步读文件断言写对了。AI 用假引擎（CN_AI_FAKE=1，shared/feynman/fake.ts 认得「梯度下降」）。
 * 截图：CN_SHOTS=<目录> 时存进去；CN_FY_SKIN=petrol 换深湖，文件名带 -petrol。
 */
import { expect, type Locator, type Page, test } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { type AddressInfo } from 'node:net'
import { dirname, join } from 'node:path'
import { findRounds } from '../src/shared/feynman/doc'
import type { FeynmanMeta } from '../src/shared/feynman/types'
import { launch, pane, type Running } from './app'
import { armMenus, menuLabels, openedMenu, pickMenu } from './menu'
import { board, openBoard } from './fixtures/board-doc'
import { BOARD_PATH, BOOK_PAGE, feynmanFiles } from './fixtures/feynman'

const SHOTS = process.env.CN_SHOTS
const SKIN = process.env.CN_FY_SKIN === 'petrol' ? 'petrol' : 'mint'

let server: Server
let book = ''
test.beforeAll(async () => {
  server = createServer((_q, r) => (r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }), r.end(BOOK_PAGE)))
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  book = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
test.afterAll(() => new Promise<void>((r) => server.close(() => r())))

/** 启动；settings 是软件设置目录里先放的 settings.json（主题、记住的开关） */
async function start(settings: Record<string, unknown> = {}, env: Record<string, string> = {}): Promise<Running> {
  const run = await launch(feynmanFiles(book), { CN_AI_FAKE: '1', CN_FAKE_SAY_MS: '2', ...env }, (vault) => {
    const ud = join(dirname(vault), 'user-data')
    mkdirSync(ud, { recursive: true })
    writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: SKIN }, ...settings }))
  })
  await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
  await armMenus(run)
  return run
}

/** 聊到底讲着时暂停在列头「⋯」里（第一项） */
async function pauseLong(run: Running, c: Locator) {
  await c.getByTestId('fy-more').click()
  expect(menuLabels(await openedMenu(run))[0]).toBe('暂停')
  await pickMenu(run, '暂停')
}

/** 回答框底边到滚动区底边还有多少（列自己的像素，白板缩放除掉；贴底时该是 12，框不被列底裁掉） */
const answerGap = (c: Locator) =>
  c.evaluate((el) => {
    const k = el.getBoundingClientRect().width / (el as HTMLElement).offsetWidth
    const b = el.querySelector('.fy-b')!.getBoundingClientRect()
    const a = el.querySelector('[data-testid="fy-answer"]')!.getBoundingClientRect()
    return Math.round((b.bottom - a.bottom) / k)
  })

/** 整个窗口截一张（屏幕外窗口从主进程截才对） */
async function shot(run: Running, name: string) {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  // 鼠标挪到白板空处：别停在哪颗按钮上（悬停提示、按下的底色会进截图）
  await run.page.mouse.move(600, 740)
  await run.page.waitForTimeout(600)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(SHOTS, `${name}${SKIN === 'petrol' ? '-petrol' : ''}.png`), Buffer.from(b64, 'base64'))
}

const col = (page: Page) => pane(page).getByTestId('fy-col')
const fileText = (run: Running) => readFileSync(join(run.vault, BOARD_PATH), 'utf8')
/** 文件里这一轮的注释（编辑器先存盘：等到 pred 对上） */
async function metaOf(run: Running, pred: (m: FeynmanMeta) => boolean = () => true): Promise<FeynmanMeta> {
  let m: FeynmanMeta | undefined
  await expect
    .poll(
      () => {
        m = findRounds(fileText(run)).find((r) => r.meta.topic === '梯度下降')?.meta
        return !!m && pred(m)
      },
      { timeout: 10_000 },
    )
    .toBe(true)
  return m!
}
const roundText = (run: Running) => {
  const t = fileText(run)
  const r = findRounds(t).find((x) => x.meta.topic === '梯度下降')!
  return t.slice(r.head.from, r.end)
}

/** 白板工具板「费曼学习」→ 直接写一个词 → 列出「这次要讲到」 */
async function openWord(page: Page): Promise<Locator> {
  await openBoard(page, '线性代数 2.3 白板')
  await board(page).getByTestId('pal-feynman').click()
  const pop = page.getByTestId('fy-start')
  await pop.getByRole('textbox', { name: '直接写一个词' }).fill('梯度下降')
  await pop.getByTestId('fy-start-go').click()
  const c = col(page)
  await expect(c.getByTestId('fy-plan')).toBeVisible({ timeout: 15_000 })
  await expect(c.getByTestId('fy-begin')).toBeVisible()
  return c
}

/** 回答框里打一段，点「讲完了 / 回」 */
async function say(c: Locator, text: string) {
  const box = c.getByTestId('fy-answer')
  await expect(box).toBeVisible({ timeout: 15_000 })
  await box.locator('textarea').fill(text)
  await c.getByTestId('fy-send').click()
}

/** 学生问完这一句（不在想了、回答框出来了；问收尾时是那两颗按钮） */
async function asked(c: Locator) {
  await expect(c.getByTestId('fy-thinking')).toHaveCount(0, { timeout: 15_000 })
  await expect(c.getByTestId('fy-answer').or(c.getByTestId('fy-finish')).or(c.getByTestId('fy-offer-wrap'))).toBeVisible({ timeout: 15_000 })
}

/** 最后一块学生的话 */
const lastStudent = (c: Locator) => c.locator('[data-testid="fy-student"], [data-testid="fy-offer"]').last()

test('聊到底一整场：换角度 → 提示 → 说穿；说穿吧、先跳过；聊到哪了；问收尾（暂停接着讲回到那块）→ 往深里聊 → 列头收尾 → 判定卡长谈记录', async () => {
  test.setTimeout(240_000)
  const run = await start()
  const { page } = run
  try {
    const c = await openWord(page)
    // 单子底部：追问：三轮 ｜ 聊到底（默认三轮）；第一次选聊到底，下面一行灰字
    const mode = c.getByTestId('fy-mode')
    await expect(c.getByTestId('fy-mode-rounds')).toHaveAttribute('aria-pressed', 'true')
    await expect(c.getByTestId('fy-mode-hint')).toHaveCount(0)
    await c.getByTestId('fy-mode-long').click()
    await expect(c.getByTestId('fy-mode-long')).toHaveAttribute('aria-pressed', 'true')
    await expect(c.getByTestId('fy-mode-hint')).toHaveText('不限轮：没讲清的一条条问，你随时点「收尾」；它想问的都问完了，会问你要不要收尾。')
    await expect(mode).toBeVisible()
    await shot(run, '01-开关')
    // 开始讲：注释写 mode long；设置里记住、灰字以后不出
    await c.getByTestId('fy-begin').click()
    let m = await metaOf(run, (x) => x.status === 'talking')
    expect(m.mode).toBe('long')
    await expect.poll(() => JSON.parse(readFileSync(join(run.userData, 'settings.json'), 'utf8')).feynman).toEqual({ mode: 'long', longSeen: true })
    // 列头：收尾（次按钮）在；暂停并进「⋯」（列头留给标题，标题不截）；一屏只有一个黑色主按钮（回答框的发送钮）
    await expect(c.getByTestId('fy-wrap')).toBeVisible()
    await expect(c.getByTestId('fy-pause')).toHaveCount(0)
    expect(await c.locator('.fy-t > b').evaluate((b) => b.scrollWidth <= b.clientWidth)).toBe(true)
    await expect(c.getByTestId('fy-wrap')).toBeDisabled()
    await expect(c.getByTestId('fy-long-meta')).toHaveText(' · 聊到底')

    // 讲一段：讲到了 c1、c2；学生问没碰的 c3
    await say(c, '先随便猜一个初始值，然后一步步往下走。每一步把 θ 减去学习率乘坡度，沿负梯度走。')
    await asked(c)
    await expect(lastStudent(c)).toContainText('学习率太大、太小会怎样')
    await expect(c.locator('.fy-btn.solid:visible')).toHaveCount(1)
    await expect(c.getByTestId('fy-wrap')).toBeEnabled()
    await expect(c.getByTestId('fy-tell')).toBeVisible()
    await expect(c.getByTestId('fy-skip')).toBeVisible()
    await expect(c.getByTestId('fy-long-meta')).toHaveText(/ · 聊到底 · 问了1次( · 不到1分钟)?$/)
    // 列头第二行：每一段一行写完（不掉一个字到下一行），只在「 · 」处换行
    const meta = await c.locator('.fy-m').evaluate((m) => ({
      h: (m as HTMLElement).offsetHeight,
      segs: [...m.querySelectorAll('.fy-nw')].map((e) => {
        const r = document.createRange()
        r.selectNodeContents(e)
        // 一段一行（分隔点包在后一项里，点也就不会挂在上一行行尾）：几个框的上沿都一样
        return getComputedStyle(e).display + ':' + new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size
      }),
      // 分隔点不挂在行尾：每个点和它后面那一项在同一行
    }))
    expect(meta.segs.every((x) => x === 'inline:1')).toBe(true)
    expect(meta.h).toBeLessThan(60)
    expect(await answerGap(c)).toBe(12)
    // 小点：聊到哪了（c1、c2 聊过，c3 正在聊，c4 还没聊）
    await c.getByTestId('fy-dots').click()
    const list = c.getByTestId('fy-talk-list')
    await expect(list.getByTestId('fy-talk-row')).toHaveCount(4)
    await expect(list.locator('[data-k="c3"]')).toHaveAttribute('data-state', 'now')
    await expect(list.locator('[data-k="c3"]')).toContainText('正在聊')
    await expect(list.locator('[data-k="c4"]')).toHaveAttribute('data-state', 'todo')
    await expect(list.locator('[data-k="c4"]')).toContainText('还没聊')
    await expect(list.locator('[data-k="c1"]')).toContainText('聊过')
    await page.keyboard.press('Escape')
    await expect(list).toHaveCount(0)
    // esc 只收小单，不暂停
    await expect(c).toHaveAttribute('data-status', 'talking')

    // 答不上：第 1 次换个角度
    await say(c, '学习率就是一个数吧。')
    await asked(c)
    await expect(lastStudent(c)).toHaveAttribute('data-step', 'angle')
    await expect(lastStudent(c).getByTestId('fy-step')).toHaveText('换个角度')
    // 这一步写在右边小字，正文不再重复「换个角度问：」
    await expect(lastStudent(c).locator('.q')).not.toContainText('换个角度')
    // 第 2 次给一个提示
    await say(c, '它影响速度吧。')
    await asked(c)
    await expect(lastStudent(c)).toHaveAttribute('data-step', 'hint')
    await expect(lastStudent(c).getByTestId('fy-step')).toHaveText('提示')
    await expect(lastStudent(c)).toContainText('提示一下')
    await shot(run, '02-追问提示')
    m = await metaOf(run, (x) => x.asked.some((a) => a.step === 'hint'))
    expect(m.asked.filter((a) => a.act === 'ask').map((a) => a.step)).toEqual(['new', 'angle', 'hint'])
    // 第 3 次：说穿，换下一条 c4
    await say(c, '我还是说不明白。')
    await asked(c)
    const reveal = c.getByTestId('fy-reveal')
    await expect(reveal).toHaveCount(1)
    await expect(reveal.getByTestId('fy-step')).toHaveText('说穿')
    await expect(reveal).not.toHaveAttribute('data-end')
    await expect(reveal).toContainText('太大来回跳甚至发散')
    await expect(lastStudent(c)).toContainText('好几个参数时怎么改')
    // 引他原话那一截完整（引号里的句号没把右引号切掉）
    await expect(lastStudent(c).locator('.quote')).toHaveText('你说「我还是说不明白。」')
    m = await metaOf(run, (x) => x.asked.some((a) => a.act === 'reveal'))
    expect(m.asked.find((a) => a.act === 'reveal')).toMatchObject({ point: 'c3' })
    expect(roundText(run)).toContain('> [!ai] 说穿')

    // 另一问（c4）：点「说穿吧」，没有新的一段你说的
    const meBefore = await c.getByTestId('fy-mine').count()
    await c.getByTestId('fy-tell').click()
    await asked(c)
    await expect(reveal).toHaveCount(2)
    await expect(reveal.last()).toContainText('先用旧 θ 把偏导全算完')
    await expect(c.getByTestId('fy-mine')).toHaveCount(meBefore)
    await expect(lastStudent(c)).toContainText('带数的例子')
    m = await metaOf(run, (x) => x.asked.filter((a) => a.act === 'reveal').length === 2)
    expect(m.asked.filter((a) => a.act === 'reveal').map((a) => a.point)).toEqual(['c3', 'c4'])
    await shot(run, '03-说穿吧跳过')
    // 点「先跳过」：这一问记 skip，换下一问（说穿过的 c3 换个情形再问）
    await c.getByTestId('fy-skip').click()
    await asked(c)
    await expect(lastStudent(c)).toHaveAttribute('data-step', 'again')
    await expect(lastStudent(c).getByTestId('fy-step')).toHaveText('换个情形')
    await expect(lastStudent(c).locator('.q')).not.toContainText('换个情形')
    m = await metaOf(run, (x) => x.asked.some((a) => a.skip))
    expect(m.asked.find((a) => a.skip)).toMatchObject({ step: 'example', point: 'c2', skip: 1 })
    // 进度小单：聊过 / 正在聊 / 说穿过 / 跳过了，点只有 --t1 / --t3 / 空心
    await c.getByTestId('fy-dots').click()
    await expect(list.locator('[data-k="c1"]')).toHaveAttribute('data-state', 'done')
    // 跳过的是带数的例子（加分题）：c2 照旧算聊过
    await expect(list.locator('[data-k="c2"]')).toHaveAttribute('data-state', 'done')
    await expect(list.locator('[data-k="c3"]')).toHaveAttribute('data-state', 'now')
    await expect(list.locator('[data-k="c4"]')).toHaveAttribute('data-state', 'revealed')
    await expect(list.locator('[data-k="c4"]')).toContainText('说穿过')
    const colors = await list.locator('.row i').evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor))
    const t1 = await c.evaluate((e) => getComputedStyle(e).color)
    expect(colors[2]).toBe(t1)
    // 正在聊那一行字 13/500 --t1，别的行 --t2；标题 13/500
    const rowLook = await list.locator('.row .tx').evaluateAll((els) => els.map((e) => [getComputedStyle(e).fontSize, getComputedStyle(e).fontWeight, getComputedStyle(e).color].join(' ')))
    expect(rowLook[2]).toBe(`13px 500 ${t1}`)
    expect(rowLook[0]).not.toContain(t1)
    expect(await list.locator('b').first().evaluate((e) => getComputedStyle(e).fontSize + ' ' + getComputedStyle(e).fontWeight)).toBe('13px 500')
    await expect(list.locator('.ft')).toHaveText('只记聊没聊到；讲没讲清，收尾时一起给。')
    await shot(run, '04-进度小单')
    // 点别处收起
    await c.locator('.fy-t > b').click()
    await expect(list).toHaveCount(0)

    // 换个情形答上 c3、c4，误解题答上：清单问空，问收尾
    await say(c, '学习率太大会来回跳甚至发散，太小走得慢。')
    await asked(c)
    await say(c, '两个参数时先用旧的值把偏导都算完再一起改。')
    await asked(c)
    await expect(lastStudent(c)).toContainText('有人说')
    await say(c, '不对，θ 减去一个负数会变大。')
    await asked(c)
    const offer = c.getByTestId('fy-offer')
    await expect(offer).toContainText('我想问的都问完了。收个尾看判定，还是接着往深里聊？')
    await expect(offer.getByTestId('fy-offer-wrap')).toBeVisible()
    await expect(offer.getByTestId('fy-offer-deep')).toBeVisible()
    // 问收尾那块出来：列头收尾先收起，回答框收起，没有说穿吧 / 先跳过；「收尾，看判定」是这一屏唯一的黑色主按钮
    await expect(c.getByTestId('fy-wrap')).toHaveCount(0)
    await expect(c.getByTestId('fy-answer')).toHaveCount(0)
    await expect(c.getByTestId('fy-tell')).toHaveCount(0)
    await expect(c.locator('.fy-btn.solid:visible')).toHaveCount(1)
    await expect(offer.getByTestId('fy-offer-wrap')).toHaveClass(/\bsolid\b/)
    // 贴着底：问收尾那块整块露出来，下面留 12
    expect(await c.evaluate((el) => {
      const b = el.querySelector('.fy-b')!
      return b.scrollHeight - b.scrollTop - b.clientHeight
    })).toBeLessThan(2)
    await shot(run, '05-问收尾')
    // 暂停（列头「⋯」第一项）、接着讲：回到问收尾那块
    await pauseLong(run, c)
    await expect(c).toHaveAttribute('data-status', 'paused')
    await expect(c.getByTestId('fy-paused')).toContainText('暂停在第8问')
    await metaOf(run, (x) => x.status === 'paused')
    await c.getByTestId('fy-resume').click()
    await expect(offer.getByTestId('fy-offer-deep')).toBeVisible()
    await expect(c.getByTestId('fy-answer')).toHaveCount(0)

    // 接着往深里聊：问一两句（不算判定）
    await offer.getByTestId('fy-offer-deep').click()
    await asked(c)
    await expect(c.getByTestId('fy-answer')).toBeVisible()
    await expect(lastStudent(c)).toHaveAttribute('data-step', 'deep')
    await expect(lastStudent(c).getByTestId('fy-step')).toHaveText('往深里聊 · 不算判定')
    await expect(c.getByTestId('fy-wrap')).toBeVisible()
    m = await metaOf(run, (x) => (x.deep ?? 0) === 1)
    await say(c, '像大雾里下山，只看脚下的坡。')
    await asked(c)
    await expect(lastStudent(c)).toHaveAttribute('data-step', 'deep')

    // 列很长：滚到底时列头出「回到开头」，点了回到开头
    const body = c.locator('.fy-b')
    await body.evaluate((b) => (b.scrollTop = b.scrollHeight))
    await expect(c.getByTestId('fy-top')).toBeVisible()
    await c.getByTestId('fy-top').click()
    await expect.poll(() => body.evaluate((b) => b.scrollTop)).toBe(0)
    await expect(c.getByTestId('fy-top')).toHaveCount(0)

    // 列头「收尾」→ 判定
    await c.getByTestId('fy-wrap').click()
    const v = c.getByTestId('fy-verdict')
    await expect(v).toBeVisible({ timeout: 15_000 })
    await expect(v).toHaveAttribute('data-verdict', 'pass')
    await expect(v.locator('.rt b')).toHaveText('过')
    await expect(v).toContainText('当场补讲')
    await expect(v).toContainText('说穿过的几处后来换个情形讲清了')
    await expect(v.getByTestId('fy-long-line')).toHaveText(/^(聊了不到1分钟 · )?问了10次 · 提示1次$/)
    // 右上只写第几次（列头已写聊到底）；右边状态只写「含糊」，怎么补上的跟在引文后面
    await expect(v.locator('.rt .m')).toHaveText('第1次')
    await expect(v.locator('[data-k="c3"] .st')).toHaveText('含糊')
    await expect(v.locator('[data-k="c3"] .qt .how')).toHaveText(/^( · )?说穿后补讲清$/)
    // 说穿后补讲清是黄点，和「含糊」同一个黄（不是绿点）
    await expect(v.locator('[data-k="c3"]')).toHaveClass(/\bst-vague\b/)
    const dot = await v.locator('[data-k="c3"] .l1 i').evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(dot).toBe(await v.locator('[data-k="c3"] .l1 .st').evaluate((el) => getComputedStyle(el).color))
    await expect(c.getByTestId('fy-gaps')).toContainText('✓ 说穿后补讲清')
    await expect(c.getByTestId('fy-long-meta')).toHaveText(' · 聊到底 · 判过了')
    await expect(c.getByTestId('fy-wrap')).toHaveCount(0)
    await shot(run, '06-判定')
    // 文件：判定块里的长谈记录、缺口、注释
    m = await metaOf(run, (x) => x.status === 'judged')
    expect(m).toMatchObject({ mode: 'long', verdict: 'pass', redone: true })
    expect(m.secs).toBeGreaterThan(0)
    const f = roundText(run)
    expect(f).toMatch(/> \[!ai\] 判定[^\n]*\n> 过 · 当场补讲：说穿过的几处后来换个情形讲清了。\n> 下一步：三天后再讲一次。\n> (聊了不到1分钟 · )?问了10次 · 提示1次\n/)
    expect(f).toContain('✓ 说穿后补讲清')

    // 文档看法：整节全展开（AI 块没折起来，说穿那句看得到）
    await page.getByTestId('tab-acts').getByRole('tab', { name: '文档' }).click()
    const ed = pane(page).locator('.cm-content')
    await expect(ed).toContainText('费曼 · 梯度下降')
    // 编辑器只画看得到的几行：滚到底再看
    for (let i = 0; i < 6; i++) {
      await ed.evaluate((el) => {
        let p: HTMLElement | null = el.parentElement
        while (p && !(p.scrollHeight > p.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(p).overflowY))) p = p.parentElement
        p?.scrollTo({ top: p.scrollHeight })
      })
      await page.waitForTimeout(150)
    }
    await expect(ed).toContainText('问了10次 · 提示1次')
    await expect(ed).toContainText('我想问的都问完了')
    await expect(pane(page).locator('.cm-callout-folded')).toHaveCount(0)
  } finally {
    await run.close()
  }
})

test('聊几问后切文档看法：「## 费曼 · 梯度下降」整节全展开（每一问、我说的、说穿块都露着），切回白板文件一字节不变', async () => {
  test.setTimeout(150_000)
  const run = await start({ feynman: { mode: 'long', longSeen: true } })
  const { page } = run
  try {
    const c = await openWord(page)
    await expect(c.getByTestId('fy-mode-long')).toHaveAttribute('aria-pressed', 'true')
    await c.getByTestId('fy-begin').click()
    // 讲一段 → 追问 → 换角度 → 提示 → 说穿（还在聊，没收尾）
    const mine = ['先随便猜一个初始值，然后一步步往下走。每一步把 θ 减去学习率乘坡度，沿负梯度走。', '学习率就是一个数吧。', '它影响速度吧。', '我还是说不明白。']
    for (const x of mine) {
      await say(c, x)
      await asked(c)
    }
    await expect(c.getByTestId('fy-reveal')).toHaveCount(1)
    await expect(lastStudent(c)).toContainText('好几个参数时怎么改')
    const m = await metaOf(run, (x) => x.asked.some((a) => a.act === 'reveal'))
    expect(m.status).toBe('talking')
    // 列里学生问的每一句（去掉右边的步骤小字）：文档里都要看得到
    const asks = await c.locator('[data-testid="fy-student"] .q').allInnerTexts()
    expect(asks.length).toBeGreaterThanOrEqual(4)
    const sec = roundText(run)
    expect(sec).toContain('> [!ai] 说穿')
    const before = readFileSync(join(run.vault, BOARD_PATH))

    // 文档看法：滚一遍，把编辑器画出来、看得到的字（innerText 不含收起藏掉的）攒起来
    await page.getByTestId('tab-acts').getByRole('tab', { name: '文档' }).click()
    const ed = pane(page).locator('.cm-content')
    await expect(ed).toContainText('费曼 · 梯度下降')
    let seen = ''
    let folded = 0
    for (let i = 0, end = false; i < 40 && !end; i++) {
      const r = await ed.evaluate((el) => {
        let p: HTMLElement | null = el.parentElement
        while (p && !(p.scrollHeight > p.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(p).overflowY))) p = p.parentElement
        const text = (el as HTMLElement).innerText
        const folded = el.querySelectorAll('.cm-callout-folded, .cm-fold-head:not(.open)').length
        if (!p) return { text, folded, end: true }
        const end = p.scrollTop + p.clientHeight >= p.scrollHeight - 2
        p.scrollTop += p.clientHeight * 0.6
        return { text, folded, end }
      })
      seen += '\n' + r.text
      folded += r.folded
      end = r.end
      await page.waitForTimeout(120)
    }
    const flat = (x: string) => x.replace(/\s+/g, '')
    expect(folded).toBe(0)
    for (const a of asks) expect(flat(seen)).toContain(flat(a))
    for (const x of mine) expect(flat(seen)).toContain(flat(x))
    // 说穿块：标题和里面那句都看得到
    expect(seen).toContain('说穿')
    expect(flat(seen)).toContain(flat('太大来回跳甚至发散'))

    // 切回白板：文件一字节不变
    await page.getByTestId('tab-acts').getByRole('tab', { name: '白板' }).click()
    await expect(col(page)).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(800)
    expect(readFileSync(join(run.vault, BOARD_PATH)).equals(before)).toBe(true)
  } finally {
    await run.close()
  }
})

test('说反了躲不掉：讲成「加上」，学生拿误解问，点先跳过、提前点收尾 → 收尾前说穿、那条讲错', async () => {
  test.setTimeout(150_000)
  const run = await start({ feynman: { mode: 'long', longSeen: true } })
  const { page } = run
  try {
    const c = await openWord(page)
    // 记住的是聊到底、灰字说过了：不再出，悬停「聊到底」才有那句
    await expect(c.getByTestId('fy-mode-long')).toHaveAttribute('aria-pressed', 'true')
    await expect(c.getByTestId('fy-mode-hint')).toHaveCount(0)
    await expect(c.getByTestId('fy-mode-long')).toHaveAttribute('data-tip', /^不限轮/)
    await c.getByTestId('fy-begin').click()
    await say(c, '先随便猜一个初始值，每一步把 θ 加上学习率乘梯度。')
    await asked(c)
    // 加还是减：先确认一句（等你答的还是讲的那一段，没有说穿吧 / 先跳过）
    await expect(lastStudent(c)).toContainText('还是减')
    await expect(c.getByTestId('fy-tell')).toHaveCount(0)
    await say(c, '是加上。')
    await asked(c)
    await expect(lastStudent(c)).toHaveAttribute('data-step', 'wrong')
    await expect(lastStudent(c)).toContainText('梯度是负的，θ 就往小里走')
    let m = await metaOf(run, (x) => (x.flip ?? []).includes('c2'))
    // 先跳过：说反的那条排到最后
    await c.getByTestId('fy-skip').click()
    await asked(c)
    await expect(lastStudent(c)).toContainText('学习率太大、太小会怎样')
    m = await metaOf(run, (x) => x.asked.some((a) => a.skip))
    expect(m.flip).toEqual(['c2'])
    // 聊到哪了：跳过的那条写「跳过了」
    await c.getByTestId('fy-dots').click()
    await expect(c.getByTestId('fy-talk-list').locator('[data-k="c2"]')).toHaveAttribute('data-state', 'skipped')
    await expect(c.getByTestId('fy-talk-list').locator('[data-k="c2"]')).toContainText('跳过了')
    await page.keyboard.press('Escape')
    // 提前收尾：说反的那条软件先说穿（收尾前说穿），记讲错；没聊到的两条记没讲到
    await c.getByTestId('fy-wrap').click()
    const end = c.locator('[data-testid="fy-reveal"][data-end]')
    await expect(end).toHaveCount(1, { timeout: 15_000 })
    await expect(end.getByTestId('fy-step')).toHaveText('收尾前说穿')
    await expect(end).toContainText('坡度为负时 θ 变大')
    const v = c.getByTestId('fy-verdict')
    await expect(v).toHaveAttribute('data-verdict', 'fail', { timeout: 15_000 })
    await expect(v.locator('[data-k="c2"]')).toHaveAttribute('data-state', 'wrong')
    await expect(v).toContainText('收尾时还有2条没聊到')
    await expect(v.getByTestId('fy-long-line')).toContainText('问了2次')
    m = await metaOf(run, (x) => x.status === 'judged')
    expect(m.asked.find((a) => a.act === 'reveal')).toEqual({ act: 'reveal', point: 'c2', flip: 1, end: 1 })
    expect(m.states?.find((s) => s.id === 'c2')?.state).toBe('wrong')
    expect(roundText(run)).toMatch(/> \[!ai\] 说穿[^\n]*\n> 新 θ = 旧 θ − α × 坡度/)
  } finally {
    await run.close()
  }
})

test('三轮用完点「接着聊下去」：这一轮转成聊到底，前面三轮照算，不能转回三轮', async () => {
  test.setTimeout(150_000)
  const run = await start()
  const { page } = run
  try {
    const c = await openWord(page)
    await expect(c.getByTestId('fy-mode-rounds')).toHaveAttribute('aria-pressed', 'true')
    await c.getByTestId('fy-begin').click()
    let m = await metaOf(run, (x) => x.status === 'talking')
    expect(m.mode).toBeUndefined()
    // 三轮模式：列头没有收尾，没有说穿吧 / 先跳过，小点不能点
    await say(c, '先随便猜一个初始值，然后一步步往下走。')
    await asked(c)
    await expect(c.getByTestId('fy-wrap')).toHaveCount(0)
    await expect(c.getByTestId('fy-tell')).toHaveCount(0)
    await expect(c.locator('button[data-testid="fy-dots"]')).toHaveCount(0)
    await expect(c.getByTestId('fy-long-meta')).toHaveCount(0)
    await say(c, '每一步减去学习率乘坡度。')
    await asked(c)
    await say(c, '太大会来回跳。')
    await asked(c)
    await say(c, '两个参数一起改。')
    await expect(c.getByTestId('fy-finish')).toBeVisible({ timeout: 15_000 })
    await expect(c.locator('.fy-done')).toContainText('问了3轮。了解即可的不追问。')
    await expect(c.getByTestId('fy-go-long')).toHaveText('接着聊下去')
    // 两行：上行那句一行写完，下行两颗靠右（间距 6），黑的只有「讲完了，看判定」
    const end = await c.locator('.fy-done.end').evaluate((el) => {
      const k = el.getBoundingClientRect().width / (el as HTMLElement).offsetWidth
      const say = el.querySelector('.say')!.getBoundingClientRect()
      const [a, b] = [...el.querySelectorAll('.acts .fy-btn')].map((x) => x.getBoundingClientRect())
      return { sayH: Math.round(say.height / k), gapRows: Math.round((a!.top - say.bottom) / k), gapBtns: Math.round((b!.left - a!.right) / k), right: Math.round((el.getBoundingClientRect().right - b!.right) / k) }
    })
    expect(end).toEqual({ sayH: 18, gapRows: 8, gapBtns: 6, right: 0 })
    await expect(c.getByTestId('fy-finish')).toHaveClass(/\bsolid\b/)
    await expect(c.getByTestId('fy-go-long')).not.toHaveClass(/\bsolid\b/)
    // 三轮的列头照旧：单独一颗「暂停」
    await expect(c.getByTestId('fy-pause')).toHaveText('暂停')
    await shot(run, '07-接着聊下去')
    // 三轮的那一节：注释里没有 mode
    m = await metaOf(run, (x) => x.asked.filter((a) => a.act === 'ask').length === 3 && !!x.touched?.includes('c4'))
    expect(m.mode).toBeUndefined()
    expect(m.secs).toBeUndefined()
    await c.getByTestId('fy-go-long').click()
    await asked(c)
    await expect(c.getByTestId('fy-finish')).toHaveCount(0)
    await expect(c.getByTestId('fy-go-long')).toHaveCount(0)
    await expect(c.getByTestId('fy-wrap')).toBeVisible()
    await expect(c.getByTestId('fy-long-meta')).toContainText('聊到底 · 问了4次')
    await expect(lastStudent(c)).toContainText('带数的例子')
    m = await metaOf(run, (x) => x.mode === 'long')
    // 前面三问照算（答上了），接着问的是第 4 问
    const asks = m.asked.filter((a) => a.act === 'ask')
    expect(asks).toHaveLength(4)
    expect(asks.slice(0, 3).map((a) => a.res)).toEqual(['right', 'right', 'right'])
    expect(asks[3]).toMatchObject({ step: 'example', point: 'c2' })
    expect(m.secs).toBeGreaterThanOrEqual(0)
    await expect(c.getByTestId('fy-tell')).toBeVisible()
  } finally {
    await run.close()
  }
})

test('开关记住上次选的：选了聊到底存进设置，重开软件单子上照旧；选回三轮也记住', async () => {
  test.setTimeout(150_000)
  const run = await start()
  let saved = ''
  try {
    const c = await openWord(run.page)
    await c.getByTestId('fy-mode-long').click()
    await expect.poll(() => JSON.parse(readFileSync(join(run.userData, 'settings.json'), 'utf8')).feynman?.mode).toBe('long')
    saved = readFileSync(join(run.userData, 'settings.json'), 'utf8')
  } finally {
    await run.close()
  }
  // 重开：同一份设置
  const again = await start(JSON.parse(saved))
  try {
    const c = await openWord(again.page)
    await expect(c.getByTestId('fy-mode-long')).toHaveAttribute('aria-pressed', 'true')
    // 还没开讲过：灰字照样出（第一次选聊到底）
    await expect(c.getByTestId('fy-mode-hint')).toBeVisible()
    await c.getByTestId('fy-mode-rounds').click()
    await expect(c.getByTestId('fy-mode-rounds')).toHaveAttribute('aria-pressed', 'true')
    await expect(c.getByTestId('fy-mode-hint')).toHaveCount(0)
    await expect.poll(() => JSON.parse(readFileSync(join(again.userData, 'settings.json'), 'utf8')).feynman).toEqual({ mode: 'rounds', longSeen: true })
    // 再选聊到底：灰字不再出，悬停才有
    await c.getByTestId('fy-mode-long').click()
    await expect(c.getByTestId('fy-mode-hint')).toHaveCount(0)
    await expect(c.getByTestId('fy-mode-long')).toHaveAttribute('data-tip', /^不限轮/)
  } finally {
    await again.close()
  }
})

test('聊了多久（单次最多 10 分钟、暂停不算）、聊过 20 分钟那句能点掉；暂停接着讲回到等你答的那一问', async () => {
  test.setTimeout(150_000)
  const run = await start({ feynman: { mode: 'long', longSeen: true } })
  const { page } = run
  try {
    const t0 = Date.now()
    await page.clock.setFixedTime(t0)
    const c = await openWord(page)
    await c.getByTestId('fy-begin').click()
    await say(c, '先随便猜一个初始值，然后一步步往下走。每一步把 θ 减去学习率乘坡度，沿负梯度走。')
    await asked(c)
    // 第一问：没过时间
    await expect(c.getByTestId('fy-long-meta')).toHaveText(' · 聊到底 · 问了1次')
    // 过了 25 分钟才答：只算 10 分钟
    await page.clock.setFixedTime(t0 + 25 * 60_000)
    await say(c, '学习率就是一个数吧。')
    await asked(c)
    await expect(c.getByTestId('fy-long-meta')).toHaveText(' · 聊到底 · 问了2次 · 10分钟')
    let m = await metaOf(run, (x) => x.secs === 600)
    await page.clock.setFixedTime(t0 + 36 * 60_000)
    await say(c, '它影响速度吧。')
    await asked(c)
    await expect(c.getByTestId('fy-long-meta')).toHaveText(' · 聊到底 · 问了3次 · 20分钟')
    // 聊过 20 分钟：列头多一行灰字，能点掉
    const tired = c.getByTestId('fy-long-tired')
    await expect(tired).toHaveText('聊了挺久了，累了可以先暂停，下次从这里接着问')
    // 列头多了一行：回答框还贴着底，没被列底裁掉
    await expect.poll(() => answerGap(c)).toBe(12)
    await shot(run, '08-聊了挺久')
    await tired.getByRole('button', { name: '收起' }).click()
    await expect(tired).toHaveCount(0)

    // 暂停：暂停前这一段记上（2 分钟），暂停的时间不算
    await page.clock.setFixedTime(t0 + 38 * 60_000)
    await pauseLong(run, c)
    await expect(c).toHaveAttribute('data-status', 'paused')
    m = await metaOf(run, (x) => x.status === 'paused')
    expect(m.secs).toBe(1320)
    // 隔了一天接着讲：回答框出来，等你答的那一问下面照旧有说穿吧 / 先跳过
    await page.clock.setFixedTime(t0 + 26 * 3600_000)
    await c.getByTestId('fy-resume').click()
    await expect(c.getByTestId('fy-answer')).toBeVisible()
    await expect(c.getByTestId('fy-tell')).toBeVisible()
    await expect(lastStudent(c)).toHaveAttribute('data-step', 'hint')
    await page.clock.setFixedTime(t0 + 26 * 3600_000 + 60_000)
    await say(c, '我还是说不明白。')
    await asked(c)
    await expect(c.getByTestId('fy-reveal')).toHaveCount(1)
    m = await metaOf(run, (x) => x.asked.some((a) => a.act === 'reveal'))
    expect(m.secs).toBe(1380)
    await expect(c.getByTestId('fy-long-meta')).toHaveText(' · 聊到底 · 问了4次 · 23分钟')
  } finally {
    await run.close()
  }
})
