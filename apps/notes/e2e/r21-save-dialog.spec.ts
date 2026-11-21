/**
 * 「存成命令」那张表（task-9womr，方向 C 第二版摆法 A「设置在右边」，小样 canvas-notes-commands/v2/proto-c2.html）：
 * 在 AI 输入框真打 4 轮（假引擎照 CN_FAKE_ROUNDS 把那一篇整篇换掉、走真的提交），点「存成命令」：
 * 三种对照、指一条规矩亮出依据、钉住后折起的展开、上一处 / 下一处、改前里「改前没有这一样」、只改这一篇浮出几次提交、
 * 勾掉、改字、改名字影响卡那一格闪、重名黄字、网页那句提醒、新建放旁边、在哪能用全不选、看说明全文、esc 一层层收、⌘↵ 存好；
 * ⌘K「让AI做」里有它、能设快捷键；⌘K「加一条自己的命令…」选「让AI做一件事」从头写；只在这台 Mac 的不进命令.json、改和删都行。
 * 一律无头（CN_E2E=1）、假 AI（CN_AI_FAKE=1）、临时库、临时设置目录。尺寸都是量 DOM。
 * CN_SHOTS=目录 时另截并排对照用的整窗图（CN_SHOT_TONE=dark 截深湖）。
 */
import { expect, type Locator, type Page, test } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { launch, openAi, pane, rail, type Running, tabOn } from './app'
import { solidPng } from './fixtures/png'

const DIR = 'study project'
const NOTE = `课程/${DIR}/学习笔记.md`
const SHOTS = process.env.CN_SHOTS
const DARK = process.env.CN_SHOT_TONE === 'dark'

const LOG = Array.from({ length: 20 }, (_, i) => `- 11-${String(i + 2).padStart(2, '0')} 第 ${i + 1} 次练习：${['reshape', '广播', '索引', '切片', '求和'][i % 5]} 的例子跑了一遍`)
const QA = ['**问** 广播什么时候发生', '', '**答** 形状不同、但能扩展成一样时。', '', '**问** sum(axis=0) 是按行还是按列', '', '**答** 沿着第 0 轴加，结果是每一列的和。']
const TAIL = ['', ...QA, '', '练习记录：', '', ...LOG, '']
const SRC1 = '—— 前言 — 动手学深度学习 2.0.0 documentation'
const SRC2 = '—— 2.1. 数据操作 — 动手学深度学习 2.0.0 documentation'

/** 4 轮之前（照 test/distill.test.ts 的 BEFORE，加两组问答和一长串没动的练习记录） */
const BEFORE = [
  '# 学习笔记',
  '',
  '教材：《动手学深度学习》，PyTorch 版。',
  '',
  '> 任何一种计算技术要想发挥其全部影响力，都必须得到充分的理解。',
  '',
  SRC1,
  '',
  '> （1）以特定方式提出问题的动机；（2）给定建模方法的数学。',
  '',
  SRC1,
  '',
  '![](附件/截图1.png)',
  '',
  '> 张量表示一个由数值组成的数组。',
  '',
  SRC2,
  '',
  '![](附件/截图2.png)',
  ...TAIL,
].join('\n')

/** 第 1 轮「整理当前页面」：加了小标题，出处还重复着 */
const R1 = BEFORE.replace('> 任何一种', '## 前言\n\n> 任何一种').replace('> 张量', '## 2.1 数据操作\n\n> 张量')
/** 第 2 轮「继续」：出处并成节头的一行 */
const R2 = R1.replace(`## 前言\n\n`, '## 前言\n\n出处：动手学深度学习 · 前言\n\n')
  .replace(`\n\n${SRC1}`, '')
  .replace(`\n\n${SRC1}`, '')
  .replace(`## 2.1 数据操作\n\n`, '## 2.1 数据操作\n\n出处：动手学深度学习 · 2.1 节\n\n')
  .replace(`\n\n${SRC2}`, '')
/** 第 3 轮「图片的话都转成文字」：图换成表格和一段字 */
const R3 = R2.replace('\n\n![](附件/截图1.png)', '').replace('![](附件/截图2.png)', '| 写法 | 意思 |\n| --- | --- |\n| x | 标量 |')
/** 第 4 轮「通顺的 可读的」：现在的样子（照 test/distill.test.ts 的 AFTER） */
const AFTER = [
  '# 学习笔记：动手学深度学习',
  '',
  '教材：《动手学深度学习》，PyTorch 版。',
  '',
  '## 前言',
  '',
  '出处：动手学深度学习 · 前言',
  '',
  '> 任何一种计算技术要想发挥其全部影响力，都必须得到充分的理解。',
  '',
  '要真正用好深度学习，得同时懂四样东西。',
  '',
  '## 2.1 数据操作',
  '',
  '出处：动手学深度学习 · 2.1 节',
  '',
  '张量就是多维数组。',
  '',
  '| 写法 | 意思 |',
  '| --- | --- |',
  '| x | 标量 |',
  ...TAIL,
].join('\n')

const SAYS = ['整理当前页面', '继续', '我没看到你改动啊 你是怎么改的? 图片的话都转成文字', '就是那种通顺的 可读的. 现在还是太乱了.']

let scratch: string
let rounds: string
test.beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'cn-r21-'))
  const say = ['整理当前页面', '继续', '图片的话都转成文字', '现在还是太乱了']
  const list = [R1, R2, R3, AFTER].map((text, i) => {
    const file = join(scratch, `r${i + 1}.md`)
    writeFileSync(file, text)
    return { say: say[i], path: NOTE, file, reply: `第 ${i + 1} 轮改好了。` }
  })
  rounds = join(scratch, 'rounds.json')
  writeFileSync(rounds, JSON.stringify(list))
})
test.afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const FILES = {
  [NOTE]: BEFORE,
  [`课程/${DIR}/第2讲 预备知识.md`]: '# 第2讲 预备知识\n\n张量、广播、求和。\n',
  [`课程/${DIR}/附件/截图1.png`]: solidPng(40, 30, [40, 80, 120]),
  [`课程/${DIR}/附件/截图2.png`]: solidPng(40, 30, [120, 80, 40]),
  '收件箱/第一条.md': '# 第一条\n\n剪藏来的网页先放这里。\n',
}

/** 照截图的样子：B 浮岛书桌，浅色天青、深色深湖 */
const look = (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: DARK ? 'petrol' : 'sky', frame: 'b', winBg: 'aurora' } }))
}

const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const dlg = (page: Page) => page.getByRole('dialog', { name: /^(存成命令|加一条 AI 命令|改这条命令|复制「.*」再改)$/ })
const pal = (page: Page) => page.getByRole('dialog', { name: '搜索和命令' })
const palRow = (page: Page, name: string) => pal(page).locator('.pal-row').filter({ has: page.locator('.nm', { hasText: new RegExp(`^${name}$`) }) }).first()
const palSec = (page: Page, name: string) => pal(page).locator('.pal-sec').filter({ has: page.locator('.pal-g', { hasText: new RegExp(`^${name}$`) }) })
const palMenu = (page: Page) => page.getByRole('menu').filter({ has: page.locator('.pal-mhead') })
const cmdsFile = (run: Running) => join(run.vault, '.canvas-notes/命令.json')
const cmdsJson = (run: Running) => JSON.parse(readFileSync(cmdsFile(run), 'utf8')) as { own?: Record<string, unknown>[]; keys?: Record<string, string> }
const localJson = (run: Running) => JSON.parse(readFileSync(join(run.userData, 'ai', 'commands.json'), 'utf8')) as { own: Record<string, unknown>[] }
const box = async (l: Locator) => (await l.boundingBox())!
const rule = (page: Page, i: number) => dlg(page).locator('.sc-rule').nth(i)
const meta = (page: Page) => dlg(page).locator('.sc-meta')
const fact = (page: Page, k: string) => dlg(page).locator(`.sc-fact[data-fact="${k}"] .v`)
const foot = (page: Page) => dlg(page).locator('.sc-foot .lt')

/** 整窗截一张（CN_SHOTS 才截）；hover：鼠标留在原处（指着一条规矩的那几张） */
async function shot(run: Running, name: string, hover = false) {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  if (!hover) await run.page.mouse.move(2, 880)
  await run.page.waitForTimeout(450)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(SHOTS, `${name}-${DARK ? 'dark' : 'light'}.png`), Buffer.from(b64, 'base64'))
}

async function send(page: Page, text: string) {
  const input = chat(page).getByRole('textbox', { name: '问 AI' })
  await input.click()
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
  await expect(chat(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 30_000 })
}

async function openDoc(page: Page, name: string) {
  await page.keyboard.press('Meta+o')
  await page.keyboard.type(name)
  await page.waitForTimeout(250)
  await page.keyboard.press('Enter')
  await expect(tabOn(page)).toHaveText(name)
  await expect(pane(page).locator('.cm-content')).toBeVisible()
}

/** 亮着的依据有几行（并排里左右两边同一高度的算一行） */
const litRows = (page: Page) =>
  dlg(page)
    .locator('.sc-cp')
    .evaluate((cp) => {
      const tops = [...cp.querySelectorAll('.cm-line.sc-ev')].map((e) => Math.round(e.getBoundingClientRect().top))
      return new Set(tops).size
    })

/** 在 AI 里真打 4 轮，点「存成命令」 */
async function fourRounds(page: Page) {
  await openDoc(page, '学习笔记')
  await openAi(page)
  for (const s of SAYS) await send(page, s)
  await expect(chat(page).getByTestId('ai-msg')).toHaveCount(4)
  // 答完才出的这一行：停在最底下的对话跟着滚到它，整行看得见（不用自己往下滚）
  await expect(chat(page).getByTestId('cmd-saverow')).toBeInViewport({ ratio: 1 })
  await chat(page).getByTestId('cmd-saverow').getByRole('button', { name: '存成命令' }).click()
  await expect(dlg(page)).toBeVisible()
}

test('存成命令：打开就问 AI 比对，三种对照、指一条亮出依据、钉住展开折起的、上一处下一处、只改这一篇浮出提交；勾掉、改字、改名字、重名、网页提醒、放旁边、全不选；看说明全文、esc 一层层收、⌘↵ 存好进命令.json 和 ⌘K', async () => {
  const run = await launch(FILES, { CN_AI_FAKE: '1', CN_FAKE_ROUNDS: rounds }, look)
  const { page, app } = run
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    await fourRounds(page)
    const d = dlg(page)
    await expect(d.locator('.sc-head .tt')).toHaveText('存成命令')
    await expect(d.locator('.sc-head .st')).toHaveText('照「学习笔记」4 轮之前和现在的样子，看出你要的是哪几条')
    // 规矩是 AI 比对出来的：比完 6 条（5 条照改前改后 + 只改这一篇照提交），名字照 AI 起的
    await expect(d.locator('.sc-rule')).toHaveCount(6, { timeout: 20_000 })
    await expect(d.locator('.sc-rule .rt')).toHaveText([
      '按书的章节分节，每节一个「##」小标题',
      '同一个出处只写一次，放在节头',
      '图里的内容写成文字：表格写成表格；原图留在附件里',
      '每节先用一两句话讲清楚，原文只留要紧的一句',
      '问答保留原样',
      '只改这一篇：不新建、不挪、不删别的文件',
    ])
    await expect(d.locator('.sc-rule .re').first()).toHaveText('依据：改后多了 2 个小标题，改前一个都没有')
    await expect(d.locator('.sc-rule .re').last()).toHaveText('依据：4 轮的 4 次提交都只改了「学习笔记.md」')
    await expect(d.locator('.sc-said')).toHaveText('没算进去的话：「继续」「我没看到你改动啊 你是怎么改的?」')
    await expect(d.locator('.sc-said')).toHaveAttribute('title', '你说过、结果里看不出来的，没算进去：「继续」「我没看到你改动啊 你是怎么改的?」')
    await expect(d.getByRole('textbox', { name: '名字' })).toHaveValue('整理成通顺笔记')
    await expect(foot(page)).toHaveText('勾着的 6 条会写成命令的说明')

    // 尺寸（1440 × 887）：弹窗 1160 × 816、离顶 44，头 52，对照工具条 44，右栏 452，底栏 56，影响卡文件树 330 + 六格三列
    const D = await box(d)
    expect([Math.round(D.x), Math.round(D.y), Math.round(D.width), Math.round(D.height)]).toEqual([140, 44, 1160, 816])
    expect(Math.round((await box(d.locator('.sc-head'))).height)).toBe(52)
    expect(Math.round((await box(d.locator('.sc-bar'))).height)).toBe(44)
    expect(Math.round((await box(d.locator('.sc-rc'))).width)).toBe(452)
    expect(Math.round((await box(d.locator('.sc-foot'))).height)).toBe(56)
    expect(Math.round((await box(d.locator('.sc-tree'))).width)).toBe(330)
    await expect(d.locator('.sc-fact')).toHaveCount(6)
    expect(await d.locator('.sc-facts').evaluate((e) => getComputedStyle(e).gridTemplateColumns.split(' ').length)).toBe(3)
    expect(await d.locator('.sc-frow').evaluateAll((rows) => rows.map((r) => [r.querySelector('label')!.textContent, Math.round(r.getBoundingClientRect().height), Math.round(r.querySelector('.ctl')!.getBoundingClientRect().x - r.getBoundingClientRect().x)]))).toEqual([
      ['名字', 32, 76],
      ['在哪能用', 32, 76],
      ['写到哪', 32, 76],
      ['存在哪', 32, 76],
    ])
    // 影响卡整宽一条接在底栏上面（173 高：文件树和六格都在里面，不压到底栏）
    const band = await box(d.locator('.sc-band'))
    expect(Math.round(band.y + band.height)).toBe(Math.round(D.y + D.height - 56))
    expect(Math.round((await box(d.locator('.sc-tree'))).y + (await box(d.locator('.sc-tree'))).height)).toBeLessThanOrEqual(Math.round(band.y + band.height))
    expect(Math.round(band.height)).toBe(173)
    // 存好是这一屏唯一的实心按钮
    await expect(d.locator('.btn-primary')).toHaveCount(1)
    await expect(d.locator('.btn-primary')).toHaveText('存好⌘↵')

    // 三种对照：默认并排，两列抬头
    const tabs = d.getByRole('tablist', { name: '对照的看法' }).getByRole('tab')
    await expect(tabs).toHaveText(['改前 · 4 轮之前', '改后 · 现在', '并排对照'])
    await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true')
    await expect(d.locator('.sc-cp .dv-cols > span')).toHaveText([/^改之前 · 4 轮之前 · [0-9a-f]{7}$/, /^现在 · [0-9a-f]{7}$/])
    await expect(d.locator('.sc-cp .cm-mergeView')).toHaveCount(1)
    await expect(meta(page)).toHaveText(/^\+\d+ −\d+4 轮 · [0-9a-f]{7} → [0-9a-f]{7}$/)
    // 照设计复审：抬头里的提交号等宽；行号是看得到的单位连续编号；图和表这种整块在改动里也上红绿，图旁写文件名；
    // 整行换掉的不画字级底，标题只改了几个字的照样画；标题和正文从同一个位置起
    expect(await d.locator('.sc-cp .dv-cols .mono').evaluateAll((els) => els.map((e) => /mono|menlo/i.test(getComputedStyle(e).fontFamily)))).toEqual([true, true])
    // 头一个是量宽度用的占位（看不见），不算
    const nums = (side: 'a' | 'b') =>
      d
        .locator(`.sc-cp .cm-merge-${side} .sc-ln .cm-gutterElement`)
        .evaluateAll((els) => els.filter((e) => getComputedStyle(e).visibility !== 'hidden' && e.textContent).slice(0, 8).map((e) => Number(e.textContent)))
    expect(await nums('a')).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(await nums('b')).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    // 编辑器自己的行号藏起来（只留一列号）
    for (const g of await d.locator('.sc-cp .cm-lineNumbers').all()) await expect(g).toBeHidden()
    await expect(d.locator('.sc-cp .cm-merge-a .cm-image.dv-blk-del').first()).toBeVisible()
    await expect(d.locator('.sc-cp .cm-merge-b .cm-table.dv-blk-add')).toHaveCount(1)
    await expect(d.locator('.sc-cp .cm-merge-a .cm-image .sc-imgname').first()).toHaveText('截图1.png')
    expect(await d.locator('.sc-cp .cm-merge-a .cm-line.sc-whole').count()).toBeGreaterThan(0)
    await expect(d.locator('.sc-cp .cm-merge-b .cm-line').first()).not.toHaveClass(/sc-whole/)
    const padL = (sel: string) => d.locator(sel).first().evaluate((e) => getComputedStyle(e).paddingLeft)
    expect(await padL('.sc-cp .cm-merge-b .cm-line.cm-h2')).toBe(await padL('.sc-cp .cm-merge-b .cm-line:not(.cm-h):not(.sc-blank)'))
    await shot(run, 'open')

    // 指第 1 条：并排里 2 处依据，亮着 2 行，别的淡下去
    await rule(page, 0).locator('.rt').hover()
    await expect(meta(page)).toHaveText('并排里 2 处依据')
    expect(await litRows(page)).toBe(2)
    await expect.poll(() => d.locator('.sc-cp .cm-line:not(.sc-ev)').first().evaluate((e) => getComputedStyle(e).opacity)).toBe('0.42')
    const ring = await d.locator('.sc-cp .cm-line.sc-ev').first().evaluate((e) => getComputedStyle(e).boxShadow)
    expect(ring).toContain('1.5px')
    await shot(run, 'hover-1', true)

    // 指第 5 条（问答）：有几处在折起来的里面，折起那一条写着；点一下钉住：折起的自己展开，4 处依据都亮着
    await rule(page, 4).locator('.rt').hover()
    await expect(meta(page)).toHaveText('并排里 4 处依据')
    await expect(d.locator('.sc-cp .cm-collapsedLines.sc-has-ev').first()).toContainText(/里面有 \d 处依据/)
    await rule(page, 4).locator('.rt').click()
    await expect(rule(page, 4)).toHaveClass(/pin/)
    await expect(d.locator('.sc-cp .cm-collapsedLines.sc-has-ev')).toHaveCount(0)
    await page.mouse.move(700, 870)
    await expect(meta(page)).toContainText('并排里 4 处依据')
    expect(await litRows(page)).toBe(4)
    await shot(run, 'pin-qa')
    // 上一处、下一处：滚过去
    const cp = d.locator('.sc-cp')
    const top0 = await cp.evaluate((e) => e.scrollTop)
    await d.getByRole('button', { name: '下一处' }).click()
    await expect.poll(() => cp.evaluate((e) => e.scrollTop)).toBeGreaterThan(top0)
    const top1 = await cp.evaluate((e) => e.scrollTop)
    await d.getByRole('button', { name: '上一处' }).click()
    await expect.poll(() => cp.evaluate((e) => e.scrollTop)).toBeLessThan(top1)

    // 钉第 2 条，切「改前」：改前 3 处依据；「改后」：2 处
    await rule(page, 1).locator('.rt').click()
    await tabs.nth(0).click()
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true')
    await page.mouse.move(700, 870)
    await expect(meta(page)).toContainText('改前 3 处依据')
    expect(await litRows(page)).toBe(3)
    await shot(run, 'pin-src-before')
    await tabs.nth(1).click()
    await expect(meta(page)).toContainText('改后 2 处依据')
    expect(await litRows(page)).toBe(2)
    await shot(run, 'pin-src-after')
    // 钉第 1 条看「改前」：改前没有这一样
    await rule(page, 0).locator('.rt').click()
    await tabs.nth(0).click()
    await expect(d.locator('.sc-empty')).toHaveText('改前没有这一样：切到「改后」或「并排对照」看它多出来的地方')
    await tabs.nth(1).click()
    await expect(d.locator('.sc-empty')).toHaveCount(0)
    expect(await litRows(page)).toBe(2)
    await d.getByRole('button', { name: '不钉了' }).click()
    await expect(rule(page, 0)).not.toHaveClass(/pin/)
    await tabs.nth(2).click()

    // 指「只改这一篇」：对照区顶上浮出 4 次提交
    await rule(page, 5).locator('.rt').hover()
    const commits = d.locator('.sc-commits')
    await expect(commits.locator('.t')).toHaveText('这条看的是提交：4 轮都只改了「学习笔记.md」')
    await expect(commits.locator('.c')).toHaveCount(4)
    await expect(commits.locator('.c').first()).toHaveText(/^[0-9a-f]{7}学习笔记\.md · 「整理当前页面」\+\d+ −\d+$/)
    await expect(meta(page)).toHaveText('依据在提交里')
    await shot(run, 'hover-scope', true)
    await page.mouse.move(700, 870)
    await expect(commits).toHaveCount(0)

    // 勾掉第 4 条：变灰、写「不写进去」，底栏变 5 条
    await rule(page, 3).getByRole('checkbox').click()
    await expect(rule(page, 3)).toHaveClass(/off/)
    await expect(rule(page, 3).locator('.re')).toHaveText('依据：引文从 3 段变成 1 段，多了 2 段自己的话 · 不写进去')
    await expect(foot(page)).toHaveText('勾着的 5 条会写成命令的说明')

    // 笔改字：回车收下
    await rule(page, 1).hover()
    await rule(page, 1).getByRole('button', { name: '改字' }).click()
    const edit = rule(page, 1).getByRole('textbox', { name: '这条规矩' })
    await expect(edit).toBeFocused()
    await page.keyboard.press('End')
    await page.keyboard.type('（节头写书名和节号）')
    await shot(run, 'edit')
    await page.keyboard.press('Enter')
    await expect(rule(page, 1).locator('.rt')).toHaveText('同一个出处只写一次，放在节头（节头写书名和节号）')

    // 改名字：「提交」那一格跟着变、闪一下
    await d.evaluate((el) => {
      const w = window as unknown as { scFlash: string[] }
      w.scFlash = []
      new MutationObserver((ms) => {
        for (const m of ms) if (m.target instanceof HTMLElement && m.target.classList.contains('flash')) w.scFlash.push(m.target.dataset.fact ?? 'tree')
      }).observe(el, { subtree: true, attributes: true, attributeFilter: ['class'] })
    })
    const name = d.getByRole('textbox', { name: '名字' })
    await name.fill('通顺笔记')
    await expect(fact(page, 'commit')).toHaveText('1 次「AI：/通顺笔记 · 第2讲 预备知识」，回答下面能撤回')
    expect(await page.evaluate(() => (window as unknown as { scFlash: string[] }).scFlash)).toContain('commit')
    await expect(d.locator('.sc-imp .ih .x')).toHaveText('拿「第2讲 预备知识」举例：下次在它上面打 /通顺笔记')
    // 和自带的重名：黄字
    await name.fill('翻译')
    await expect(d.locator('.sc-warn')).toHaveText('和自带的「翻译」重名，打 / 时两条都在')
    await shot(run, 'dup')
    await name.fill('整理成通顺笔记')
    await expect(d.locator('.sc-warn')).toHaveCount(0)

    // 在哪能用加网页：在哪出现变了，文件树下面多一句提醒
    await d.getByRole('checkbox', { name: '网页' }).click()
    await expect(fact(page, 'appear')).toHaveText('文档里打 /、网页上右键「问 AI」，⌘K「让AI做」')
    await expect(d.locator('.sc-tree .note')).toHaveText('在网页上用时没有「这一篇」可改：那时新建一篇进收件箱')
    await shot(run, 'web')
    await d.getByRole('checkbox', { name: '网页' }).click()
    await expect(d.locator('.sc-tree .note')).toHaveCount(0)

    // 写到哪选「新建，放旁边」：之后多一篇绿底「新」
    await d.getByRole('radiogroup', { name: '写到哪' }).getByRole('radio', { name: '新建，放旁边' }).click()
    const after = d.locator('.sc-tree .col').nth(1).locator('.sc-tr')
    await expect(after).toHaveCount(3)
    await expect(after.nth(2)).toHaveClass(/new/)
    await expect(after.nth(2)).toHaveText('第2讲 预备知识：整理稿.md新')
    await expect(fact(page, 'touch')).toHaveText('只新建这一个文件，原文只读；全能模式不开')
    await shot(run, 'beside')
    await d.getByRole('radiogroup', { name: '写到哪' }).getByRole('radio', { name: '改这一篇' }).click()
    await expect(after).toHaveCount(2)

    // 在哪能用一处都不选：在哪出现变黄、存好灰掉
    await d.getByRole('checkbox', { name: '文档' }).click()
    await expect(foot(page)).toHaveText('「在哪能用」一处都没选')
    await expect(d.getByRole('button', { name: '存好' })).toBeDisabled()
    await expect(fact(page, 'appear')).toHaveText('一处都没选：存了也调不出来')
    await expect(fact(page, 'appear')).toHaveClass(/warn/)
    await shot(run, 'nowhere')
    await d.getByRole('checkbox', { name: '文档' }).click()
    await expect(d.getByRole('button', { name: '存好' })).toBeEnabled()

    // 看说明全文：存进去的就是勾着的 5 条，改过字的是改后的字
    await d.getByRole('button', { name: '看说明全文' }).click()
    const pop = d.getByRole('dialog', { name: '说明全文' })
    await expect(pop.locator('li')).toHaveText([
      '按书的章节分节，每节一个「##」小标题',
      '同一个出处只写一次，放在节头（节头写书名和节号）',
      '图里的内容写成文字：表格写成表格；原图留在附件里',
      '问答保留原样',
      '只改这一篇：不新建、不挪、不删别的文件',
    ])
    await expect(pop.locator('.s')).toHaveText('照「学习笔记」4 轮之前和现在的对比提炼。没勾的 1 条不写进去。')
    await shot(run, 'text')

    // esc 一层层收：说明全文 → 钉住 → 弹窗
    await page.keyboard.press('Escape')
    await expect(pop).toHaveCount(0)
    await rule(page, 4).locator('.rt').click()
    await expect(rule(page, 4)).toHaveClass(/pin/)
    await page.keyboard.press('Escape')
    await expect(rule(page, 4)).not.toHaveClass(/pin/)
    await expect(dlg(page)).toBeVisible()
    // 改字时 esc 只收改字，原来的字不变
    await rule(page, 0).hover()
    await rule(page, 0).getByRole('button', { name: '改字' }).click()
    await page.keyboard.type('不要的字')
    await page.keyboard.press('Escape')
    await expect(rule(page, 0).locator('.rt')).toHaveText('按书的章节分节，每节一个「##」小标题')
    await expect(dlg(page)).toBeVisible()

    // ⌘↵ 存好：命令.json 里有这一条（kind ai、规矩、在哪能用、写到哪）
    await page.keyboard.press('Meta+Enter')
    await expect(dlg(page)).toHaveCount(0)
    await expect(page.locator('.toast-cn')).toContainText('存好了：/整理成通顺笔记 · 在 / 菜单和 ⌘K 的「让AI做」里')
    await expect.poll(() => existsSync(cmdsFile(run))).toBe(true)
    const own = cmdsJson(run).own!.find((o) => o.name === '整理成通顺笔记')!
    expect(own).toMatchObject({
      kind: 'ai',
      where: ['doc'],
      write: 'inplace',
      desc: '照「学习笔记」4 轮前后的对比提炼，每次先给你看',
      from: { path: NOTE, title: '学习笔记', rounds: 4 },
    })
    expect((own.rules as { t: string; off?: boolean }[]).map((r) => [r.t, !!r.off])).toEqual([
      ['按书的章节分节，每节一个「##」小标题', false],
      ['同一个出处只写一次，放在节头（节头写书名和节号）', false],
      ['图里的内容写成文字：表格写成表格；原图留在附件里', false],
      ['每节先用一两句话讲清楚，原文只留要紧的一句', true],
      ['问答保留原样', false],
      ['只改这一篇：不新建、不挪、不删别的文件', false],
    ])
    expect(own.target).toBe('1. 按书的章节分节，每节一个「##」小标题\n2. 同一个出处只写一次，放在节头（节头写书名和节号）\n3. 图里的内容写成文字：表格写成表格；原图留在附件里\n4. 问答保留原样\n5. 只改这一篇：不新建、不挪、不删别的文件')
    // AI 面板里换成「存成了」；再改一次：名字和设置照存好的
    await expect(chat(page).getByTestId('cmd-saved')).toContainText('存成了 /整理成通顺笔记')
    await chat(page).getByRole('button', { name: '再改一次' }).click()
    await expect(dlg(page)).toBeVisible()
    await expect(dlg(page).getByRole('textbox', { name: '名字' })).toHaveValue('整理成通顺笔记')
    await expect(dlg(page).locator('.sc-rule')).toHaveCount(6)
    await expect(dlg(page).locator('.sc-rule').nth(3)).toHaveClass(/off/)
    await page.keyboard.press('Escape')
    await expect(dlg(page)).toHaveCount(0)

    // ⌘K「让AI做」里有它，提示字是它的标签，图标是引擎标志；能设快捷键
    await page.keyboard.press('Meta+k')
    await expect(palSec(page, '让AI做').locator('.pal-row .nm')).toContainText(['整理成通顺笔记'])
    const r = palRow(page, '整理成通顺笔记')
    await expect(r.locator('.lc')).toHaveText('改这一篇 · 先给你看 · 能撤回')
    await expect(r.locator('.eng-logo')).toHaveCount(1)
    await r.click({ button: 'right' })
    await expect(palMenu(page).getByRole('menuitem')).toHaveText(['钉住⌘P', '挪到', '设快捷键…', '起别名…', '改这条命令…', '删掉这条', '藏起⌘⌫'])
    await palMenu(page).getByRole('menuitem', { name: '设快捷键…' }).click()
    await page.keyboard.press('Alt+Meta+KeyT')
    await page.keyboard.press('Enter')
    await expect(r.locator('kbd')).toHaveText('⌥⌘T')
    await expect.poll(() => cmdsJson(run).keys?.[own.id as string]).toBe('⌥⌘T')
    await page.keyboard.press('Escape')
    await expect(pal(page)).toHaveCount(0)
    // 按快捷键：交给 AI 对话跑 /整理成通顺笔记
    await page.keyboard.press('Alt+Meta+KeyT')
    await expect(chat(page).locator('.um').last()).toContainText('/整理成通顺笔记')
    expect(errors).toEqual([])
  } finally {
    await run.close()
  }
})

test('⌘K「加一条自己的命令…」选「让AI做一件事」：关上 ⌘K 开那张表，没有左边对照，一条条加规矩，存好进命令.json 和「让AI做」', async () => {
  const run = await launch(FILES, { CN_AI_FAKE: '1' }, look)
  const { page, app } = run
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    await openDoc(page, '第2讲 预备知识')
    await page.keyboard.press('Meta+k')
    await palRow(page, '加一条自己的命令…').click()
    const form = pal(page).getByRole('form', { name: '加一条自己的命令' })
    const card = form.getByRole('radio', { name: /让AI做一件事/ })
    await expect(card.locator('.eng-logo')).toHaveCount(1)
    await card.click()
    await expect(pal(page)).toHaveCount(0)
    const d = dlg(page)
    await expect(d.locator('.sc-head .tt')).toHaveText('加一条 AI 命令')
    await expect(d.locator('.sc-head .st')).toHaveText('从头写一条，没有对话就没有左边对照，只填规矩')
    await expect(d.locator('.sc-cmp')).toHaveCount(0)
    await expect(foot(page)).toHaveText('先写一条规矩')
    await expect(d.getByRole('button', { name: '存好' })).toBeDisabled()
    // 一条条加：回车加一条
    const add = d.getByRole('textbox', { name: '加一条规矩' })
    await add.click()
    await page.keyboard.type('按这周、下周、以后分三节')
    await page.keyboard.press('Enter')
    await page.keyboard.type('每节只列标题，不写正文')
    await page.keyboard.press('Enter')
    await expect(d.locator('.sc-rule .rt')).toHaveText(['按这周、下周、以后分三节', '每节只列标题，不写正文'])
    await expect(add).toHaveValue('')
    await expect(foot(page)).toHaveText('名字空着')
    await d.getByRole('textbox', { name: '名字' }).fill('排成计划')
    await expect(foot(page)).toHaveText('勾着的 2 条会写成命令的说明')
    // 举例用开着的那一篇
    await expect(d.locator('.sc-imp .ih .x')).toHaveText('拿「第2讲 预备知识」举例：下次在它上面打 /排成计划')
    // 宽度按内容收窄：880；影响卡六格两列
    expect(Math.round((await box(d)).width)).toBe(880)
    expect(await d.locator('.sc-facts').evaluate((e) => getComputedStyle(e).gridTemplateColumns.split(' ').length)).toBe(2)
    await shot(run, 'new')
    await d.getByRole('button', { name: '存好' }).click()
    await expect(d).toHaveCount(0)
    await expect(page.locator('.toast-cn')).toContainText('存好了：/排成计划 · 在 / 菜单和 ⌘K 的「让AI做」里')
    await expect.poll(() => cmdsJson(run).own?.find((o) => o.name === '排成计划')).toMatchObject({
      kind: 'ai',
      rules: [{ t: '按这周、下周、以后分三节' }, { t: '每节只列标题，不写正文' }],
      where: ['doc'],
      write: 'inplace',
      target: '1. 按这周、下周、以后分三节\n2. 每节只列标题，不写正文',
    })
    await page.keyboard.press('Meta+k')
    await expect(palSec(page, '让AI做').locator('.pal-row .nm')).toContainText(['排成计划'])
    // 改这条命令…：开同一张表（改这条命令），名字和规矩都在
    await palRow(page, '排成计划').click({ button: 'right' })
    await palMenu(page).getByRole('menuitem', { name: '改这条命令…' }).click()
    await expect(pal(page)).toHaveCount(0)
    await expect(d.locator('.sc-head .tt')).toHaveText('改这条命令')
    await expect(d.getByRole('textbox', { name: '名字' })).toHaveValue('排成计划')
    await expect(d.locator('.sc-rule .rt')).toHaveText(['按这周、下周、以后分三节', '每节只列标题，不写正文'])
    await d.getByRole('checkbox', { name: '白板' }).click()
    await d.getByRole('button', { name: '存好' }).click()
    await expect.poll(() => cmdsJson(run).own?.filter((o) => o.name === '排成计划').map((o) => o.where)).toEqual([['doc', 'board']])
  } finally {
    await run.close()
  }
})

test('只在这台 Mac：不进命令.json，⌘K「让AI做」里照样有、能改、能删能撤回', async () => {
  const run = await launch(FILES, { CN_AI_FAKE: '1' }, look)
  const { page } = run
  try {
    await page.keyboard.press('Meta+k')
    await palRow(page, '加一条自己的命令…').click()
    await pal(page).getByRole('form', { name: '加一条自己的命令' }).getByRole('radio', { name: /让AI做一件事/ }).click()
    const d = dlg(page)
    // 没开着笔记：举例写「这一篇」
    await expect(d.locator('.sc-imp .ih .x')).toHaveText('拿「这一篇」举例：下次在它上面打 /我的命令')
    await d.getByRole('textbox', { name: '加一条规矩' }).fill('只回答，不改文件')
    await d.getByRole('textbox', { name: '加一条规矩' }).press('Enter')
    await d.getByRole('textbox', { name: '名字' }).fill('问问看')
    await d.getByRole('radiogroup', { name: '写到哪' }).getByRole('radio', { name: '只回答' }).click()
    await d.getByRole('radiogroup', { name: '存在哪' }).getByRole('radio', { name: '只在这台 Mac' }).click()
    await expect(fact(page, 'store')).toHaveText('只在这台 Mac 上，不进库、不进历史')
    await d.getByRole('button', { name: '存好' }).click()
    await expect(d).toHaveCount(0)
    await expect.poll(() => (existsSync(join(run.userData, 'ai', 'commands.json')) ? localJson(run).own.map((o) => o.name) : [])).toEqual(['问问看'])
    expect(existsSync(cmdsFile(run)) ? (cmdsJson(run).own ?? []).map((o) => o.name) : []).toEqual([])
    // ⌘K 里照样有
    await page.keyboard.press('Meta+k')
    await expect(palSec(page, '让AI做').locator('.pal-row .nm')).toContainText(['问问看'])
    await expect(palRow(page, '问问看').locator('.lc')).toHaveText('只回答')
    // 改：开表、改名字存好，这台 Mac 上那份跟着改
    await palRow(page, '问问看').click({ button: 'right' })
    await palMenu(page).getByRole('menuitem', { name: '改这条命令…' }).click()
    await expect(d.locator('.sc-head .tt')).toHaveText('改这条命令')
    await d.getByRole('textbox', { name: '名字' }).fill('问一问')
    await d.getByRole('button', { name: '存好' }).click()
    // 存好才关上（开着时 ⌘K 这些按键归这张表）
    await expect(d).toHaveCount(0)
    await expect.poll(() => localJson(run).own.map((o) => o.name)).toEqual(['问一问'])
    // 删掉：⌘K 里没了，能撤回
    await page.keyboard.press('Meta+k')
    await palRow(page, '问一问').click({ button: 'right' })
    await palMenu(page).getByRole('menuitem', { name: '删掉这条' }).click()
    await expect(pal(page).locator('.pal-toast')).toContainText('删掉了这条自己的命令')
    await expect(palRow(page, '问一问')).toHaveCount(0)
    await expect.poll(() => localJson(run).own.length).toBe(0)
    await pal(page).locator('.pal-toast').getByRole('button', { name: '撤回' }).click()
    await expect(palRow(page, '问一问')).toHaveCount(1)
    await expect.poll(() => localJson(run).own.map((o) => o.name)).toEqual(['问一问'])
  } finally {
    await run.close()
  }
})

test('AI 输入框打 /，右键自带的「翻译」→ 复制一份再改…：同一张表（复制「翻译」再改），规矩和设置照自带的，存成我自己的一条', async () => {
  const run = await launch(FILES, { CN_AI_FAKE: '1' }, look)
  const { page } = run
  try {
    await openDoc(page, '第2讲 预备知识')
    await openAi(page)
    await chat(page).getByRole('textbox', { name: '问 AI' }).click()
    await page.keyboard.type('/')
    const menu = chat(page).getByRole('listbox', { name: '命令' })
    await menu.locator('.it:has(.n:text-is("翻译"))').click({ button: 'right' })
    await page.getByRole('menu', { name: '翻译' }).getByRole('menuitem', { name: '复制一份再改…' }).click()
    const d = dlg(page)
    await expect(d.locator('.sc-head .tt')).toHaveText('复制「翻译」再改')
    await expect(d.locator('.sc-cmp')).toHaveCount(0)
    await expect(d.getByRole('textbox', { name: '名字' })).toHaveValue('我的翻译')
    await expect(d.locator('.sc-rule .rt')).toHaveText(['翻译选中的那段，没选就翻整篇', '中文翻成英文，别的语言翻成中文', '只输出译文'])
    await expect(d.getByRole('radiogroup', { name: '写到哪' }).getByRole('radio', { name: '只回答' })).toHaveAttribute('aria-checked', 'true')
    await expect(d.locator('.sc-tree .none')).toHaveText('库里的文件不变，回答只在对话里')
    await expect(fact(page, 'commit')).toHaveText('没有提交')
    // 改一条：第三条勾掉，加一条自己的
    await rule(page, 2).getByRole('checkbox').click()
    await d.getByRole('textbox', { name: '加一条规矩' }).fill('专有名词后面括号写原文')
    await d.getByRole('textbox', { name: '加一条规矩' }).press('Enter')
    await expect(foot(page)).toHaveText('勾着的 3 条会写成命令的说明')
    await page.keyboard.press('Meta+Enter')
    await expect(d).toHaveCount(0)
    await expect.poll(() => cmdsJson(run).own?.find((o) => o.name === '我的翻译')).toMatchObject({
      kind: 'ai',
      write: 'answer',
      where: ['doc'],
      target: '1. 翻译选中的那段，没选就翻整篇\n2. 中文翻成英文，别的语言翻成中文\n3. 专有名词后面括号写原文',
    })
  } finally {
    await run.close()
  }
})

test('1200 宽的窗口：弹窗 1136 宽，对照区 684', async () => {
  const run = await launch(FILES, { CN_AI_FAKE: '1', CN_FAKE_ROUNDS: rounds }, look)
  const { page, app } = run
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1200, 887))
    await fourRounds(page)
    const d = dlg(page)
    await expect(d.locator('.sc-rule')).toHaveCount(6, { timeout: 20_000 })
    expect(Math.round((await box(d)).width)).toBe(1136)
    expect(Math.round((await box(d.locator('.sc-cmp'))).width)).toBe(684)
    await shot(run, 'open-1200')
  } finally {
    await run.close()
  }
})

test('软件最窄的窗口 960×600：弹窗 896×536，对照区和右栏不重叠、不出横向滚动条，底栏的「存好」看得见、点得到', async () => {
  const run = await launch(FILES, { CN_AI_FAKE: '1', CN_FAKE_ROUNDS: rounds }, look)
  const { page, app } = run
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(960, 600))
    await fourRounds(page)
    const d = dlg(page)
    await expect(d.locator('.sc-rule')).toHaveCount(6, { timeout: 20_000 })
    const dlgBox = await box(d)
    expect([Math.round(dlgBox.width), Math.round(dlgBox.height)]).toEqual([896, 536])
    const cmp = await box(d.locator('.sc-cmp'))
    const side = await box(d.locator('.sc-rc'))
    expect(cmp.x + cmp.width).toBeLessThanOrEqual(side.x + 0.5)
    expect(await d.evaluate((el) => [...el.querySelectorAll<HTMLElement>('*')].filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX === 'auto').map((e) => e.className))).toEqual([])
    // 工具条右边「N 轮 · 号 → 号」放不下时省略号收住，不压到右栏「看出的规矩」上
    const meta = await box(d.locator('.sc-meta'))
    expect(meta.x + meta.width).toBeLessThanOrEqual(side.x + 0.5)
    await shot(run, 'open-960')
    const save = d.getByRole('button', { name: /^存好/ })
    await expect(save).toBeInViewport({ ratio: 1 })
    await save.click()
    await expect(d).toHaveCount(0)
  } finally {
    await run.close()
  }
})

/** 交回用的「在哪」标注图（只截图）：整窗截一张，几处的框（CSS 像素）另存成 <名字>.boxes.json */
async function where(run: Running, name: string, boxes: Record<string, Locator>) {
  await shot(run, name, true)
  const out: Record<string, number[]> = {}
  for (const [k, l] of Object.entries(boxes)) {
    const b = await box(l)
    out[k] = [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]
  }
  writeFileSync(join(SHOTS!, `${name}-${DARK ? 'dark' : 'light'}.boxes.json`), JSON.stringify(out))
}

test('「在哪」标注图（只截图）：AI 那一行「存成命令」、那张表的五块、⌘K 第三张卡、⌘K 里改和删', async () => {
  test.skip(!SHOTS, '只在截对照图时跑（CN_SHOTS=目录）')
  const run = await launch(FILES, { CN_AI_FAKE: '1', CN_FAKE_ROUNDS: rounds }, look)
  const { page, app } = run
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    await openDoc(page, '学习笔记')
    await openAi(page)
    for (const s of SAYS) await send(page, s)
    await page.mouse.move(700, 870)
    // 答完才出的这一行，对话跟着滚到它（原来差 60 左右露不全）
    await expect(chat(page).getByTestId('cmd-saverow')).toBeInViewport({ ratio: 1 })
    await where(run, 'where-saverow', { save: chat(page).getByTestId('cmd-saverow') })
    await chat(page).getByTestId('cmd-saverow').getByRole('button', { name: '存成命令' }).click()
    const d = dlg(page)
    await expect(d.locator('.sc-rule')).toHaveCount(6, { timeout: 20_000 })
    await page.mouse.move(700, 870)
    await where(run, 'where-dialog', { cmp: d.locator('.sc-cmp'), rules: d.locator('.sc-rules'), form: d.locator('.sc-form'), band: d.locator('.sc-band'), foot: d.locator('.sc-foot') })
    await page.keyboard.press('Meta+Enter')
    await expect(d).toHaveCount(0)
    await page.keyboard.press('Meta+k')
    await palRow(page, '加一条自己的命令…').click()
    const card = pal(page).getByRole('form', { name: '加一条自己的命令' }).getByRole('radio', { name: /让AI做一件事/ })
    await where(run, 'where-cmdk', { card })
    await page.keyboard.press('Escape')
    await palRow(page, '整理成通顺笔记').click({ button: 'right' })
    await where(run, 'where-menu', { row: palRow(page, '整理成通顺笔记'), edit: palMenu(page).getByRole('menuitem', { name: '改这条命令…' }), del: palMenu(page).getByRole('menuitem', { name: '删掉这条' }) })
  } finally {
    await run.close()
  }
})

test('邻页对照（只截图）：历史里点这一篇最后一次 AI 提交，对比标签和存成命令的并排对照是同一套', async () => {
  test.skip(!SHOTS, '只在截对照图时跑（CN_SHOTS=目录）')
  const run = await launch(FILES, { CN_AI_FAKE: '1', CN_FAKE_ROUNDS: rounds }, look)
  const { page, app } = run
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    await openDoc(page, '学习笔记')
    await openAi(page)
    for (const s of SAYS) await send(page, s)
    await rail(page).getByRole('button', { name: '历史' }).click()
    const latest = page.getByRole('complementary', { name: '历史' }).getByTestId('history-commit').first()
    await latest.locator('.fr', { hasText: '学习笔记' }).first().click()
    // 右栏收起来，中间栏宽过 900 才并排（窄了自动合一）
    await page.getByRole('button', { name: '关上历史' }).click()
    await page.keyboard.press('Meta+j')
    await expect(page.locator('[data-testid="diff-tab"]:not([hidden]) .cm-mergeView')).toBeVisible()
    await shot(run, 'history-diff')
  } finally {
    await run.close()
  }
})
