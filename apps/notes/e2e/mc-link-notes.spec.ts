// MeetCaption 联动（画布笔记这一侧，设计 24-meetcaption联动「从文件夹首页的组件启动」「两个软件互相跳」，已定第 3、7、9、11、12、15 件）：
// 课程首页自动放上 MeetCaption 组件（连库时对上的文件夹），下一节照课表、最近几节从上课记录读；开始上课 / 换成网课走 meetcaption://start 深链；
// 上课中、刚下课照 MeetCaption 的状态文件变；没装时下载引导、最近几节照样列；会议项目「开始开会」「待办 N」。
// 上课记录：录音条、字幕全文、关键画面；正文 ▶ 时间就地播；录音还是 LFS 指针时说没下到、跳到字幕；打开再保存一字节不变；
// MeetCaption 跳过来（canvas-notes://open?file=…&t=…&session=…&back=…、canvas-notes://meetcaption?session=…&t=…）打开那一篇、滚到那个时间点、录音停在那一秒。
// 给了 CN_SHOTS（目录）时顺手截薄荷主题的交付图。
import { expect, type Page, test } from '@playwright/test'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acts, gitStatus, launch, pane, type Running, tabOn, waitSaved } from './app'
import { FOLDER, MC_FILES, MEET, REC_A, REC_B, S1, S2, S3, SUB, TEXT_A } from './fixtures/meetcaption'

test.setTimeout(240_000)

const shots = process.env.CN_SHOTS
const home = (page: Page) => page.getByTestId('folder-home')
const widget = (page: Page) => home(page).getByTestId('mc-widget')
const bar = (page: Page) => pane(page).getByTestId('mc-record')
const screenLog = (run: Running) => run.app.evaluate(() => (globalThis as unknown as { cnScreen: string[] }).cnScreen.slice())
/** 照 macOS 交给软件的 open-url */
const openUrl = (run: Running, url: string) => run.app.evaluate(({ app }, u) => app.emit('open-url', { preventDefault: () => undefined }, u), url)
const audioAt = (page: Page) => bar(page).getByTestId('mc-audio').evaluate((a: HTMLAudioElement) => Math.round(a.currentTime))

let dir = ''
test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cn-mc-'))
})
test.afterEach(() => rmSync(dir, { recursive: true, force: true }))

async function start(installed: Record<string, string>) {
  const inst = join(dir, 'installed.json')
  writeFileSync(inst, JSON.stringify(installed))
  const run = await launch(MC_FILES, { CN_FAMILY_INSTALLED_FILE: inst, CN_MEETCAPTION_DIR: dir })
  await run.page.setViewportSize({ width: 1440, height: 900 })
  if (shots) {
    await run.page.evaluate(() => window.cn.setSettings({ appearance: { followSystem: false, skin: 'mint' } }))
    await run.page.reload()
    await run.page.locator('.vault b').waitFor()
  }
  return run
}
const shot = async (page: Page, name: string) => {
  if (!shots) return
  await page.mouse.move(700, 890)
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(shots, `${name}.png`) })
}
const live = (o: Record<string, unknown>) => writeFileSync(join(dir, 'canvas-notes-live.json'), JSON.stringify(o))

test('课程首页的 MeetCaption 组件：自动放上、下一节、最近几节、开始上课走深链、上课中、刚下课；会议项目', async () => {
  const run = await start({ meetcaption: '0.7.0' })
  const { page, vault } = run
  try {
    await openUrl(run, 'canvas-notes://open?file=' + encodeURIComponent(FOLDER))
    await expect(home(page)).toHaveAttribute('data-folder', FOLDER)
    // 连库时对上的文件夹：第一次打开自动放一张，放在最前面；记下放过了（删了不再放）
    await expect(widget(page)).toBeVisible()
    await expect(widget(page)).toHaveAttribute('data-state', 'idle')
    expect(JSON.parse(readFileSync(join(vault, '.canvas-notes/meetcaption-placed.json'), 'utf8'))).toEqual({ placed: [FOLDER] })
    expect(JSON.parse(readFileSync(join(vault, FOLDER, '.首页.json'), 'utf8')).order[0]).toBe('meetcaption')
    await expect(home(page).getByTestId('mc-tag')).toHaveText('ecp · 课堂 · 教室现场')
    // 下一节：照 MeetCaption 记的课表（明天 09:00）
    await expect(widget(page).getByTestId('mc-next')).toContainText('下一节')
    await expect(widget(page).getByTestId('mc-next')).toContainText('09:00')
    await expect(widget(page).getByTestId('mc-next')).toContainText('照课表')
    // 最近几节：新的在上；时长 · 段数；落在哪个子文件夹
    const rows = widget(page).getByTestId('mc-row')
    await expect(rows).toHaveCount(2)
    await expect(rows.first()).toContainText('11-04')
    await expect(rows.first()).toContainText('近似加法器与 CDM8 乘法器')
    await expect(rows.first()).toContainText('2:30 · 2 段')
    await expect(rows.nth(1)).toContainText('AI、ML 方法与硬件导论')
    await expect(widget(page)).toContainText('最近几节 · 落在「上课的录音和转录」')
    await shot(page, '01-组件-没上课')

    // 开始上课：meetcaption://start，项目、模式是这门课的，带着这个文件夹（下课回来）
    await widget(page).getByTestId('mc-start').click()
    const back = encodeURIComponent(FOLDER)
    await expect.poll(() => screenLog(run)).toContainEqual(`用浏览器打开 meetcaption://start?project=ecp&mode=class&source=mic&back=${back}`)
    // 换成网课：只换这一次，听电脑的声音
    await widget(page).getByTestId('mc-start-alt').click()
    await expect.poll(() => screenLog(run)).toContainEqual(`用浏览器打开 meetcaption://start?project=ecp&mode=online&source=system&back=${back}`)
    await expect(home(page).getByTestId('mc-tag')).toHaveText('ecp · 课堂 · 教室现场')

    // 上课中：MeetCaption 写了状态文件
    live({ session: '2026-11-18 09.00', startedAt: Date.now() - 37 * 60_000, project: 'ecp', mode: 'class', file: `${SUB}/2026-11-18 上课记录.md` })
    await expect(widget(page)).toHaveAttribute('data-state', 'live', { timeout: 15_000 })
    await expect(widget(page).getByTestId('mc-live')).toContainText('上课中 · 37 分钟')
    await expect(widget(page)).toContainText('正写进「2026-11-18 上课记录」')
    await shot(page, '02-组件-上课中')
    await widget(page).getByTestId('mc-open-live').click()
    await expect.poll(() => screenLog(run)).toContainEqual('用浏览器打开 meetcaption://open?session=2026-11-18%2009.00')

    // 下课：写进了 11-04 那一篇（样本里就是它），作业几件
    live({ session: S1, startedAt: Date.now() - 150 * 60_000, endedAt: Date.now(), project: 'ecp', mode: 'class', file: REC_A, todos: 2, dated: 1 })
    await expect(widget(page)).toHaveAttribute('data-state', 'after', { timeout: 15_000 })
    await expect(widget(page).getByTestId('mc-after')).toContainText('刚下课 · 写进了「2026-11-04 近似加法器与 CDM8 乘法器」 · 作业 2 件，1 件带日子')
    await expect(rows.first()).toHaveClass(/\bon\b/)
    await shot(page, '03-组件-下课回来')

    // 点「打开笔记」开那一篇
    await rows.first().getByRole('button', { name: '打开笔记' }).click()
    await expect(tabOn(page)).toHaveText('2026-11-04 近似加法器与 CDM8 乘法器')

    // 会议项目：开始开会、换成面试、每行待办 N
    await openUrl(run, 'canvas-notes://open?file=' + encodeURIComponent(MEET))
    await expect(home(page)).toHaveAttribute('data-folder', MEET)
    await expect(widget(page)).toBeVisible()
    await expect(home(page).getByTestId('mc-tag')).toHaveText('hiwi2 · 会议')
    await expect(widget(page).getByTestId('mc-start')).toHaveText('开始开会')
    await expect(widget(page).getByTestId('mc-start-alt')).toContainText('换成面试')
    await expect(widget(page).getByTestId('mc-next')).toContainText('日历里没有下一次 · 随时能开')
    await expect(widget(page).getByTestId('mc-row').first()).toContainText('待办 1')
    await shot(page, '04-组件-会议')
    await widget(page).getByTestId('mc-start').click()
    await expect.poll(() => screenLog(run)).toContainEqual(`用浏览器打开 meetcaption://start?project=hiwi2&mode=meeting&source=system&back=${encodeURIComponent(MEET)}`)
  } finally {
    await run.close()
  }
})

test('没装 MeetCaption：一句说明、下载，最近几节照样列、照样能开', async () => {
  const run = await start({})
  const { page } = run
  try {
    await openUrl(run, 'canvas-notes://open?file=' + encodeURIComponent(FOLDER))
    await expect(widget(page)).toHaveAttribute('data-state', 'missing')
    await expect(widget(page)).toContainText('这台 Mac 上没装 MeetCaption')
    await expect(widget(page)).toContainText('装了以后在这里一键开始上课。')
    await expect(widget(page).getByTestId('mc-start')).toHaveCount(0)
    await expect(widget(page).getByTestId('mc-row')).toHaveCount(2)
    await shot(page, '05-组件-没装')
    await widget(page).getByTestId('mc-download').click()
    await expect.poll(() => screenLog(run)).toContainEqual(expect.stringContaining('meetcaption.us-cloud.uk'))
    await expect(widget(page)).toContainText('等你装好')
    // ▶ 听：在画布笔记里开那一篇、从头放；没装时没有「在 MeetCaption 里打开」
    await widget(page).getByTestId('mc-row').first().getByRole('button', { name: '▶ 听' }).click()
    await expect(tabOn(page)).toHaveText('2026-11-04 近似加法器与 CDM8 乘法器')
    await expect(bar(page)).toHaveAttribute('data-playing', '1')
    await expect(bar(page).getByTestId('mc-open-in')).toHaveCount(0)
  } finally {
    await run.close()
  }
})

test('上课记录：录音条、字幕全文、关键画面，▶ 就地播，没下的录音跳到字幕；打开再保存不变；MeetCaption 跳过来到那个时间点', async () => {
  const run = await start({ meetcaption: '0.7.0' })
  const { page, vault } = run
  try {
    // 普通的打开（画布今日、搜索一样）：录音条在正文上面
    await openUrl(run, 'canvas-notes://open?file=' + encodeURIComponent(REC_A))
    await expect(tabOn(page)).toHaveText('2026-11-04 近似加法器与 CDM8 乘法器')
    await expect(bar(page)).toContainText('2 段 · 2 小时 30 分 · 点任何一个 ▶ 时间就在这里听')
    await expect(bar(page).getByTestId('mc-open-in')).toBeVisible()
    // 字幕全文：两段，双语、说话人
    await bar(page).getByTestId('mc-subs-tab').click()
    const subs = bar(page).getByTestId('mc-subs')
    await expect(bar(page).getByTestId('mc-subs-tab')).toHaveText('字幕全文 · 46 句')
    await expect(subs).toContainText('第 1 段 · 09:29')
    await expect(subs).toContainText('第 2 段 · 11:05')
    await expect(subs.locator('.mcr-cue').first()).toContainText('ProfApproximate computing sentence 1.Approximate computing 第 1 句。')
    // 关键画面：两张，图读得出来；正文里对应小节下面也嵌着
    await bar(page).getByTestId('mc-frames-tab').click()
    const frames = bar(page).getByTestId('mc-frame')
    await expect(frames).toHaveCount(2)
    await expect(frames.first()).toContainText('09:29:40')
    await expect.poll(() => frames.first().locator('img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(320)
    // （正文只画看得见的那几屏：第一张在）
    await expect.poll(() => pane(page).locator('.cm-content img[src*="%E7%94%BB%E9%9D%A2"]').first().evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(320)

    // 正文里点 ▶ 09:31（carry chain，09.29 那场第 120 秒）：就地从那一秒放
    // （正文只画看得见的那几屏：先往下滚到那一节）
    const link = pane(page).locator('.cm-content .cm-link', { hasText: '▶ 09:31' })
    for (let y = 0; !(await link.count()) && y < 3000; y += 200) await pane(page).locator('.body').evaluate((b, top) => (b.scrollTop = top), y)
    await link.click()
    await expect(bar(page)).toHaveAttribute('data-playing', '1')
    await expect(bar(page)).toHaveAttribute('data-seg', '0')
    await expect.poll(() => audioAt(page)).toBeGreaterThanOrEqual(120)
    await expect(bar(page).getByTestId('mc-at')).toContainText('第 1 段 · 09:31')
    expect(await screenLog(run)).not.toContainEqual(expect.stringContaining('meetcaption://open'))
    // 字幕里点第 2 段的一句：换到第 2 段的录音、从那句放；那句亮着
    await bar(page).getByTestId('mc-subs-tab').click()
    await subs.locator('[data-seg="1"][data-cue="3"]').click()
    await expect(bar(page)).toHaveAttribute('data-seg', '1')
    await expect.poll(() => audioAt(page)).toBeGreaterThanOrEqual(18)
    await expect(subs.locator('[data-seg="1"][data-cue="3"]')).toHaveClass(/\bon\b/)
    await shot(page, '06-上课记录-字幕全文')
    await bar(page).getByTestId('mc-play').click()
    await expect(bar(page)).toHaveAttribute('data-playing', '0')
    // 关键画面点一张：从那一刻放，正文滚到那一节
    await bar(page).getByTestId('mc-frames-tab').click()
    await frames.nth(1).click()
    await expect(bar(page)).toHaveAttribute('data-seg', '0')
    await expect.poll(() => audioAt(page)).toBeGreaterThanOrEqual(95)
    await bar(page).getByTestId('mc-play').click()
    await shot(page, '07-上课记录-关键画面')
    // 在 MeetCaption 里打开：那一场、那一秒
    await bar(page).getByTestId('mc-open-in').click()
    await expect.poll(() => screenLog(run)).toContainEqual(expect.stringMatching(/^用浏览器打开 meetcaption:\/\/open\?session=2026-11-04%2009\.29&t=9\d$/))

    // 打开再保存：一个字节不变
    await pane(page).locator('.cm-content').focus()
    await page.keyboard.press('Meta+ArrowDown')
    await page.keyboard.type('x')
    await expect(acts(page).getByTestId('save-state')).toHaveAttribute('data-state', 'dirty')
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Meta+s')
    await waitSaved(page)
    expect(readFileSync(join(vault, REC_A), 'utf8')).toBe(TEXT_A)

    // 10-21 那一篇：录音还是 LFS 指针，点 ▶ 说没下到、字幕打开跳到那一句
    await openUrl(run, 'canvas-notes://open?file=' + encodeURIComponent(REC_B))
    await expect(tabOn(page)).toHaveText('2026-10-21 AI、ML 方法与硬件导论')
    await pane(page).locator('.cm-content .cm-link', { hasText: '▶ 14:15' }).click()
    await expect(bar(page).getByTestId('mc-why')).toContainText('这一段的录音还没下到这台 Mac 上；字幕在，先跳到那一句')
    await expect(bar(page).getByTestId('mc-subs')).toBeVisible()
    await bar(page).getByRole('button', { name: '下下来' }).click()
    await expect(bar(page).getByTestId('mc-why')).toContainText('按需下载录音还没做')
    await shot(page, '08-上课记录-录音没下')

    // MeetCaption 跳过来：先回课程首页，再开那一篇，滚到第 2 段第 100 秒那一行（horizontal cut，60 秒那一条），录音停在那一秒
    await page.keyboard.press('Meta+w')
    await page.keyboard.press('Meta+w')
    await openUrl(run, `canvas-notes://open?file=${encodeURIComponent(REC_A)}&t=100&session=${encodeURIComponent(S2)}&back=${encodeURIComponent(FOLDER)}`)
    await expect(tabOn(page)).toHaveText('2026-11-04 近似加法器与 CDM8 乘法器')
    await expect(page.locator('.tab[role="tab"]').filter({ hasText: /^ECP$/ })).toHaveCount(1)
    await expect(bar(page)).toHaveAttribute('data-seg', '1')
    await expect.poll(() => audioAt(page)).toBe(100)
    await expect(bar(page)).toHaveAttribute('data-playing', '0')
    await expect(pane(page).locator('.cm-line', { hasText: 'horizontal cut' })).toBeInViewport()
    await shot(page, '09-从MeetCaption跳过来')
    // 只给哪一场：在库里找那一篇（10-21 那场第 1900 秒 → 脉动阵列那一节）
    await openUrl(run, `canvas-notes://meetcaption?session=${encodeURIComponent(S3)}&t=1900`)
    await expect(tabOn(page)).toHaveText('2026-10-21 AI、ML 方法与硬件导论')
    await expect(pane(page).locator('.cm-line', { hasText: '脉动阵列' })).toBeInViewport()
    // 库里没有的那一场：说一句
    await openUrl(run, `canvas-notes://meetcaption?session=${encodeURIComponent('2030-01-01 08.00')}&t=1`)
    await expect(page.getByText('库里没找到这一场的上课记录')).toBeVisible()
    void S1
    // 看过、点过、跳过：库里一个字没动
    expect(readFileSync(join(vault, REC_A), 'utf8')).toBe(TEXT_A)
    expect(gitStatus(vault)).toBe('')
  } finally {
    await run.close()
  }
})

/** MeetCaption 真写出来的库（apps/meetcaption 的无设备自测写进临时库）：CN_MC_REAL_VAULT=<库> CN_MC_REAL_RECORD=<篇> 时才跑 */
const REAL = process.env.CN_MC_REAL_VAULT
test('MeetCaption 真写出来的上课记录：认得出、录音能放、字幕在，MeetCaption 发来的两种深链都到那一篇', async () => {
  test.skip(!REAL, '没给 CN_MC_REAL_VAULT')
  const files: Record<string, Uint8Array> = {}
  const walk = (rel: string) => {
    for (const e of readdirSync(join(REAL!, rel), { withFileTypes: true })) {
      if (e.name === '.git') continue
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory() || (e.isSymbolicLink() && statSync(join(REAL!, r)).isDirectory())) walk(r)
      else files[r] = readFileSync(join(REAL!, r))
    }
  }
  walk('')
  const rec = process.env.CN_MC_REAL_RECORD!
  const text = Buffer.from(files[rec]!).toString('utf8')
  const session = /^meetcaption: \["([^"]+)"/m.exec(text)![1]!
  const inst = join(dir, 'installed.json')
  writeFileSync(inst, JSON.stringify({ meetcaption: '0.7.0' }))
  const run = await launch(files, { CN_FAMILY_INSTALLED_FILE: inst, CN_MEETCAPTION_DIR: dir })
  const { page } = run
  try {
    await openUrl(run, `canvas-notes://open?file=${encodeURIComponent(rec)}&t=5&session=${encodeURIComponent(session)}&back=${encodeURIComponent('课程/ECP')}`)
    await expect(bar(page)).toBeVisible()
    await expect.poll(() => audioAt(page), { timeout: 15_000 }).toBe(5)
    await bar(page).getByTestId('mc-subs-tab').click()
    await expect(bar(page).getByTestId('mc-subs').locator('.mcr-cue').first()).toContainText('Good morning')
    await openUrl(run, `canvas-notes://meetcaption?session=${encodeURIComponent(session)}&t=3`)
    await expect.poll(() => audioAt(page), { timeout: 15_000 }).toBe(3)
    expect(Buffer.from(readFileSync(join(run.vault, rec))).toString('utf8')).toBe(text)
  } finally {
    await run.close()
  }
})
