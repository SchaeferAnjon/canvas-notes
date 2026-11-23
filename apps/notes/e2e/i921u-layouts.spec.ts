/**
 * 数据库第三批第 2 块（task-i921u）：看板、日历、画廊三种看法。真点、真拖（按住、挪、松开，走 @cn/calendar 的 useDragDrop），
 * 每个动作之后读盘：只改了该改的那一篇的那一行，和 packages/format 的 writeCell / moveToDay 算出来的一字不差；
 * 别的每一篇、文档本身都不变；撤回回到原样；只看（打开、翻月、点开一条）不碰文件。
 * 样本照设计页：课程计划八讲、练习七题（packages/format/test/base-samples.ts），三篇文档各把一种看法放在第一个视图（打开就是它）；
 * 从视图标签条切过去、点开在右栏开的连着测在 i921u-joined.spec.ts。
 */
import { expect, test, type Locator, type Page } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { baseContext, moveToDay, parseBaseDoc, writeCell } from '@cn/format'
import { ECP_BASE, EXERCISES, LECTURES, records } from '../../../packages/format/test/base-samples'
import { gitStatus, launch, openNote, pane, tabOn } from './app'
import { DOCS } from './fixtures/ecp-views'

/** 1×1 的 PNG：画廊封面「正文第一张图」真读得到 */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkqM+oBwAEZgGBe0a7fQAAAABJRU5ErkJggg==', 'base64')
const IMAGES: Record<string, Uint8Array> = {
  '课程/ecp/课程计划/第2讲 需求和效用/需求曲线.png': PNG,
  '课程/ecp/课程计划/边际产量.png': PNG,
  '课程/ecp/课程计划/市场.png': PNG,
}
const FILES: Record<string, string | Uint8Array> = { ...DOCS, ...LECTURES, ...EXERCISES, ...IMAGES }
const TEXTS: Record<string, string> = { ...DOCS, ...LECTURES, ...EXERCISES }

/** 和界面同一个算法算出来的改法（packages/format） */
const ctx = () => baseContext(parseBaseDoc(ECP_BASE), records(LECTURES), { related: { '课程/ecp/练习': records(EXERCISES) } })

const read = (vault: string, p: string) => readFileSync(join(vault, p), 'utf8')
/** 除了 except 这几篇，样本里每一篇都和原来一字不差 */
function othersSame(vault: string, except: string[] = []) {
  for (const [p, text] of Object.entries(TEXTS)) if (!except.includes(p)) expect(read(vault, p), p).toBe(text)
}

const db = (page: Page) => pane(page).locator('[data-part="数据库块"]')

/** 真拖：按住、分几步挪过去（过 5 才算拖）、松开 */
async function drag(page: Page, from: Locator, to: Locator) {
  const a = (await from.boundingBox())!
  const b = (await to.boundingBox())!
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + a.width / 2 + 8, a.y + a.height / 2 + 4, { steps: 3 })
  await page.mouse.move(b.x + b.width / 2, b.y + Math.min(b.height / 2, 40), { steps: 12 })
  await page.mouse.up()
}

test('看板：按状态三列，卡片上日期、进度、做完几题；拖卡换组只改「状态:」一行、能撤回；同一列里拖不写；列底「+ 新建」带上这一列的状态', async () => {
  const run = await launch(FILES)
  const { page, vault } = run
  const lec5 = '课程/ecp/课程计划/第5讲 博弈初步.md'
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await openNote(page, 'ecp 看板')
    const cols = db(page).locator('[data-part="看板一列"]')
    await expect(cols).toHaveCount(3)
    await expect(cols.locator('.bl-khead')).toHaveText(['未开始4', '在学2', '学完2'])
    const col = (n: string) => db(page).getByLabel(n, { exact: true }).and(cols)
    await expect(col('学完').locator('.bl-kcard .n')).toHaveText(['第1讲 绪论', '第2讲 需求和效用'])
    const card3 = col('在学').locator('.bl-kcard', { hasText: '第3讲 生产' })
    await expect(card3.locator('.m .bl-f')).toHaveText(['11月17日', '50%', '1/2'])
    // 没日期的第7讲：下面一行只有进度
    await expect(col('未开始').locator('.bl-kcard', { hasText: '第7讲' }).locator('.m .bl-f')).toHaveText(['0%'])
    // 只看不写
    await page.waitForTimeout(800)
    othersSame(vault)
    expect(gitStatus(vault)).toBe('')

    // 拖「第5讲」从未开始到在学：只换那一篇的「状态:」一行，和 writeCell 算的一样
    const want = writeCell(ctx(), lec5, '状态', '在学')
    expect(want).toHaveLength(1)
    await drag(page, col('未开始').locator('.bl-kcard', { hasText: '第5讲' }), col('在学'))
    await expect.poll(() => read(vault, lec5)).toBe(want[0]!.after)
    expect(want[0]!.after).toBe(LECTURES[lec5]!.replace('状态: 未开始', '状态: 在学'))
    othersSame(vault, [lec5])
    await expect(col('在学').locator('.bl-kcard .n')).toContainText(['第5讲 博弈初步'])
    await expect(cols.locator('.bl-khead')).toHaveText(['未开始3', '在学3', '学完2'])
    const toast = page.getByTestId('toast')
    await expect(toast).toContainText('「第5讲 博弈初步」的状态改成了「在学」 · 写进 课程/ecp/课程计划/第5讲 博弈初步.md')
    // 撤回：回到原样
    await toast.getByRole('button', { name: '撤回' }).click()
    await expect.poll(() => read(vault, lec5)).toBe(LECTURES[lec5])
    await expect(cols.locator('.bl-khead')).toHaveText(['未开始4', '在学2', '学完2'])
    othersSame(vault)

    // 同一列里上下拖：不记顺序，不写
    const unstarted = col('未开始').locator('.bl-kcard')
    await drag(page, unstarted.first(), unstarted.last())
    await page.waitForTimeout(600)
    othersSame(vault)

    // 点一张卡（没挪）：在右栏「记录」标签打开那一条（第 4 块），中间还是这篇文档
    await col('学完').locator('.bl-kcard', { hasText: '第1讲 绪论' }).click()
    await expect(page.getByTestId('dtab-record')).toHaveText('第1讲 绪论')
    await expect(tabOn(page)).toHaveText('ecp 看板')
    othersSame(vault)
    await openNote(page, 'ecp 看板')

    // 「学完」列底「+ 新建」：建一篇带「状态: 学完」，卡片上就地起名
    await col('学完').getByRole('button', { name: '新建' }).click()
    const box = col('学完').getByRole('textbox', { name: '新的一条叫什么' })
    await expect(box).toBeFocused()
    await box.fill('第9讲 期末')
    await box.press('Enter')
    const made = '课程/ecp/课程计划/第9讲 期末.md'
    await expect.poll(() => existsSync(join(vault, made))).toBe(true)
    expect(read(vault, made)).toMatch(/^---\n状态: 学完\n---\n/)
    await expect(col('学完').locator('.bl-kcard .n')).toContainText(['第9讲 期末'])
    othersSame(vault)
  } finally {
    await run.close()
  }
})

test('日历：周一开头的月历、没排日子的那一条；拖到另一天只改「日期:」一行、能撤回；从虚线框拖进格子定日子、拖回去拿掉这一行；翻月不写', async () => {
  const run = await launch(FILES)
  const { page, vault } = run
  const lec4 = '课程/ecp/课程计划/第4讲 市场结构.md'
  const lec7 = '课程/ecp/课程计划/第7讲 外部性.md'
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await openNote(page, 'ecp 日历')
    const cal = db(page).locator('[data-part="日历"]')
    await expect(cal.locator('.cal-mweek.head > div')).toHaveText(['周一', '周二', '周三', '周四', '周五', '周六', '周日'])
    const now = new Date()
    await expect(cal.locator('.bl-calh b')).toHaveText(`${now.getFullYear()}年${now.getMonth() + 1}月`)
    const tray = cal.locator('[data-part="没排日子的"]')
    await expect(tray).toContainText('没排日子的1条')
    await expect(tray.locator('.cal-chip')).toHaveText(['第7讲 外部性'])
    await expect(cal.locator('.bl-calh .hint')).toHaveText('按「日期」排 · 拖到哪天就改成哪天')
    // 翻到 2026 年 11 月（真点 ‹ ›），翻月不写文件
    const target = 2026 * 12 + 10
    for (let k = 0; k < 60; k++) {
      const [y, m] = ((await cal.locator('.bl-calh b').textContent()) ?? '').match(/\d+/g)!.map(Number) as [number, number]
      const cur = y * 12 + m - 1
      if (cur === target) break
      await cal.getByRole('button', { name: cur > target ? '上个月' : '下个月' }).click()
    }
    await expect(cal.locator('.bl-calh b')).toHaveText('2026年11月')
    const day = (d: string) => cal.locator(`[data-drop="mday:${d}"]`)
    await expect(day('2026-11-24').locator('.cal-chip')).toHaveText(['第4讲 市场结构'])
    await expect(day('2026-11-17').locator('.cal-chip')).toHaveText(['第3讲 生产'])
    // 第3讲在学：黄点；第1讲学完：绿点
    await expect(day('2026-11-17').locator('.cal-dot')).toHaveAttribute('style', /var\(--yellow\)/)
    await expect(day('2026-11-10').locator('.cal-dot')).toHaveAttribute('style', /var\(--green\)/)
    await page.waitForTimeout(600)
    othersSame(vault)
    expect(gitStatus(vault)).toBe('')

    // 第4讲 24 → 25：只换「日期:」一行
    const want = moveToDay(ctx(), lec4, '日期', '2026-11-25')
    await drag(page, day('2026-11-24').locator('.cal-chip', { hasText: '第4讲' }), day('2026-11-25'))
    await expect.poll(() => read(vault, lec4)).toBe(want[0]!.after)
    expect(want[0]!.after).toBe(LECTURES[lec4]!.replace('日期: 2026-11-24', '日期: 2026-11-25'))
    othersSame(vault, [lec4])
    await expect(day('2026-11-25').locator('.cal-chip')).toHaveText(['第4讲 市场结构'])
    const toast = page.getByTestId('toast')
    await expect(toast).toContainText('「第4讲 市场结构」的日期改成了「11月25日」')
    await toast.getByRole('button', { name: '撤回' }).click()
    await expect.poll(() => read(vault, lec4)).toBe(LECTURES[lec4])
    await expect(day('2026-11-24').locator('.cal-chip')).toHaveText(['第4讲 市场结构'])

    // 没排日子的第7讲拖进 27 日：加一行「日期:」
    const in27 = moveToDay(ctx(), lec7, '日期', '2026-11-27')
    await drag(page, tray.locator('.cal-chip', { hasText: '第7讲' }), day('2026-11-27'))
    await expect.poll(() => read(vault, lec7)).toBe(in27[0]!.after)
    expect(read(vault, lec7)).toContain('日期: 2026-11-27\n')
    othersSame(vault, [lec7])
    await expect(tray).toContainText('没排日子的0条')
    await expect(day('2026-11-27').locator('.cal-chip')).toHaveText(['第7讲 外部性'])
    // 拖回虚线框：拿掉这一行，回到原样
    await drag(page, day('2026-11-27').locator('.cal-chip'), tray)
    await expect.poll(() => read(vault, lec7)).toBe(LECTURES[lec7])
    await expect(page.getByTestId('toast')).toContainText('「第7讲 外部性」的日期清掉了')
    othersSame(vault)

    // 点一条（没挪）：在右栏「记录」标签打开那一条
    await day('2026-11-17').locator('.cal-chip').click()
    await expect(page.getByTestId('dtab-record')).toHaveText('第3讲 生产')
    await expect(tabOn(page)).toHaveText('ecp 日历')
    othersSame(vault)
    // 翻到哪个月记在本机：回来还是 11 月
    await openNote(page, 'ecp 日历')
    await expect(db(page).locator('.bl-calh b')).toHaveText('2026年11月')
  } finally {
    await run.close()
  }
})

test('画廊：三列，封面是正文第一张图（三种写法都认），没图露前几行字；名字下面「● 学完 · 11月10日」；点卡片打开；不写文件', async () => {
  const run = await launch(FILES)
  const { page, vault } = run
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await openNote(page, 'ecp 画廊')
    const gal = db(page).locator('[data-part="画廊"]')
    const cards = gal.locator('.bl-gcard')
    await expect(cards).toHaveCount(8)
    await expect(cards.locator('.bl-ginfo .n')).toHaveText(['第1讲 绪论', '第2讲 需求和效用', '第3讲 生产', '第4讲 市场结构', '第5讲 博弈初步', '第6讲 信息不对称', '第7讲 外部性', '第8讲 复习'])
    // 三列：前三张一样高
    const tops = await cards.evaluateAll((els) => els.slice(0, 4).map((e) => Math.round(e.getBoundingClientRect().top)))
    expect(new Set(tops.slice(0, 3)).size).toBe(1)
    expect(tops[3]).toBeGreaterThan(tops[0]!)
    // 第2讲 ![](相对路径)、第3讲 ![[名字]]、第4讲 <img src>：都读到了图
    for (const n of ['第2讲 需求和效用', '第3讲 生产', '第4讲 市场结构']) {
      const img = cards.filter({ hasText: n }).locator('.bl-gcov img')
      await expect(img, n).toBeVisible()
      await expect.poll(() => img.evaluate((e) => (e as HTMLImageElement).naturalWidth), { message: n }).toBe(1)
    }
    // 没图的露前几行字
    await expect(cards.filter({ hasText: '第1讲 绪论' }).locator('.bl-gcov .txt')).toHaveText('经济学研究稀缺资源怎么分配。这一讲讲机会成本和边际思考。\n读第1章')
    await expect(cards.filter({ hasText: '第1讲 绪论' }).locator('.bl-ginfo .m')).toHaveText('学完11月10日')
    await expect(cards.filter({ hasText: '第7讲 外部性' }).locator('.bl-ginfo .m')).toHaveText('未开始')
    await page.waitForTimeout(600)
    othersSame(vault)
    expect(gitStatus(vault)).toBe('')
    await cards.filter({ hasText: '第5讲 博弈初步' }).click()
    await expect(page.getByTestId('dtab-record')).toHaveText('第5讲 博弈初步')
    await expect(tabOn(page)).toHaveText('ecp 画廊')
    othersSame(vault)
    expect(gitStatus(vault)).toBe('')
  } finally {
    await run.close()
  }
})
