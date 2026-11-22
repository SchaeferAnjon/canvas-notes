/**
 * 白板收件箱弹窗（task-8isml）的对照截图：和定稿图 01-画布笔记小处/inbox-pop-*.png 同样的库、同样的状态，
 * B 浮岛书桌、天青（浅）/ 深湖（深）。只在截交付图时跑：CN_SHOTS=目录，CN_SHOT_TONE=dark 截深色。交互的验收在 8isml-inbox-pop.spec.ts。
 */
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { acts, launch, pane, type Running, widenRight } from './app'
import { board, col, openBoard } from './fixtures/board-doc'

const DIR = process.env.CN_SHOTS
const DARK = process.env.CN_SHOT_TONE === 'dark'
test.skip(!DIR, '只在截交付图时跑（CN_SHOTS=目录）')

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const TODAY = ymd(new Date())
const daysAgo = (n: number) => ymd(new Date(Date.now() - n * 86400_000))

/** 定稿图里那块白板：路线、住哪、预算三列 */
const TRIP = `---
type: board
---
# 冰岛十天环岛

## 路线

第一天：凯夫拉维克取车，先去雷克雅未克。

第二天：黄金圈，辛格韦德利、间歇泉、黄金瀑布。

## 住哪

前两晚住老港口边上的青旅。

## 预算

机票 620 欧，租车 9 天 540 欧。
`

const quick = (at: string, text: string) => `---\ncreated: ${at}\n---\n${text}\n`

/** 定稿图「正常宽」「中栏 420」的收件箱：一条剪藏、两条速记 */
function three(): Record<string, string> {
  return {
    '项目/冰岛十天环岛.md': TRIP,
    '收件箱/冰岛自驾注意事项.md': `---\ncreated: ${TODAY} 02:25:30\nsource: https://vedur.is/\n---\n# 冰岛自驾注意事项\n\n出门前看 vedur.is 的天气和路况，F 路要四驱。\n`,
    '收件箱/旺季提前两周.md': quick(`${TODAY} 02:25:20`, '旺季提前两周，晚上的场次便宜。'),
    '收件箱/停车场多数只收卡.md': quick(`${TODAY} 02:25:10`, '停车场多数只收卡。'),
  }
}

const OLDER = [
  '热狗在 Bæjarins 那家。', '羊毛衫在 Handknitting 买。', '冰川徒步要请向导。', '租车带碎石险。', '退税在机场办。', '加油站要先刷卡再加。', '蓝湖要带拖鞋。', '超市 Bónus 便宜。',
  '极光预报看 aurora 指数。', '雷克雅未克教堂顶上能看全城。', '黑沙滩别靠近浪。', '杰古沙龙冰河湖坐船。', '钻石沙滩早上去。', '米湖温泉比蓝湖便宜。', '斯奈山半岛一天来回。',
  '维克的教堂在坡上。', '霍芬吃龙虾。', '塞里雅兰瀑布能走到后面。', '斯科加瀑布爬楼梯上去。', '辛格韦德利有大裂缝。', '间歇泉十分钟喷一次。', '黄金瀑布风很大。',
  '1 号公路有单车道桥。', '路上的羊别按喇叭。', '冰岛水龙头的水能直接喝。', '充电头和欧洲一样。', '小费不用给。', '酒在专卖店买。', '周日商店关得早。', '鲸鱼在胡萨维克看。',
  '海鹦六月最多。', '冰洞要跟团。', '火山口 Kerið 要门票。', '雷克雅未克停车用 app 付。', '冬天轮胎带钉。', '天黑前到住处。', '风速过 20 别上路。', '防水裤必带。', '机场大巴提前订。',
]

/** 定稿图「条目多的时候」：今天 6 条、更早 39 条 */
function many(): Record<string, string> {
  const files: Record<string, string> = { '项目/冰岛十天环岛.md': TRIP }
  const today = ['停车场多数只收卡。', '旺季提前两周，晚上的场次便宜。', '雷克雅未克的青旅要早订。', '冰岛语的谢谢是 takk。', '加油站的热狗也好吃。', '出门前看 vedur.is。']
  today.forEach((t, i) => (files[`收件箱/今天 ${i + 1}.md`] = quick(`${TODAY} 02:${String(35 - i).padStart(2, '0')}`, t)))
  OLDER.forEach((t, i) => (files[`收件箱/更早 ${i + 1}.md`] = quick(`${daysAgo(4 + Math.floor(i / 3))} 09:${String(8 - (i % 3)).padStart(2, '0')}`, t)))
  return files
}

const skin = (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: DARK ? 'petrol' : 'sky', frame: 'b', winBg: 'aurora' } }))
}

const pop = (page: Page) => board(page).getByRole('dialog', { name: '收件箱' })
const name = (n: string) => join(DIR!, `${n}-${DARK ? 'dark' : 'light'}.png`)

async function start(files: Record<string, string>): Promise<Running> {
  mkdirSync(DIR!, { recursive: true })
  const run = await launch(files, {}, skin)
  await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900))
  await openBoard(run.page, '冰岛十天环岛')
  // 左栏收起（定稿图里左边只有图标栏）
  await run.page.keyboard.press('Meta+Backslash')
  await expect(board(run.page)).toBeVisible()
  return run
}

async function open(page: Page) {
  await pane(page).getByTestId('db-inbox').click()
  await expect(pop(page)).toBeVisible()
  await pop(page).evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
  await page.mouse.move(700, 880)
}

/** 按住一条拖到「住哪」那一列第一张下面，不松手 */
async function holdOnStay(page: Page, text: string) {
  const it = pop(page).getByRole('listitem').filter({ hasText: text })
  const b = (await it.boundingBox())!
  const t = (await col(page, '住哪').locator('.db-card').first().boundingBox())!
  await page.mouse.move(b.x + 60, b.y + 20)
  await page.mouse.down()
  await page.mouse.move(b.x + 40, b.y + 30, { steps: 3 })
  await page.mouse.move(t.x + 160, t.y + t.height + 10, { steps: 16 })
  await expect(col(page, '住哪').locator('.db-drop')).toHaveCount(1)
}

test('正常宽：弹窗开着、拖一条到「住哪」', async () => {
  const run = await start(three())
  const { page } = run
  try {
    // 和定稿图一样只截中栏这一块（标签条到底）
    const pane = (await page.locator('.pane:not([hidden])').boundingBox())!
    const bar = (await acts(page).boundingBox())!
    const clip = { x: pane.x - 40, y: bar.y - 16, width: pane.width + 50, height: pane.y + pane.height - bar.y + 16 }
    await open(page)
    await page.waitForTimeout(300)
    await page.screenshot({ path: name('wide-open'), clip })
    await holdOnStay(page, '冰岛自驾注意事项')
    await page.waitForTimeout(200)
    await page.screenshot({ path: name('wide-drag'), clip })
    await page.mouse.up()
  } finally {
    await run.close()
  }
})

test('中栏 420：弹窗开着；收着时指着「收件箱 3」出提示', async () => {
  const run = await start(three())
  const { page } = run
  try {
    await page.keyboard.press('Meta+y')
    await expect(page.getByRole('complementary', { name: '历史' })).toBeVisible()
    for (let i = 0; i < 3; i++) {
      const bw = (await board(page).boundingBox())!.width
      if (Math.abs(bw - 420) < 1) break
      await widenRight(page, bw - 420)
      await page.waitForTimeout(200)
    }
    const pane = (await page.locator('.pane:not([hidden])').boundingBox())!
    const bar = (await acts(page).boundingBox())!
    const clip = { x: pane.x, y: bar.y - 10, width: pane.width, height: pane.y + pane.height - bar.y + 10 }
    await open(page)
    await page.screenshot({ path: name('narrow-open'), clip })
    await board(page).getByTestId('db-inbox').click()
    await expect(pop(page)).toHaveCount(0)
    await page.mouse.move(700, 880)
    await board(page).getByTestId('db-inbox').hover()
    await expect(page.getByTestId('tooltip')).toContainText('打开收件箱')
    await page.waitForTimeout(300)
    await page.screenshot({ path: name('narrow-tip'), clip })
  } finally {
    await run.close()
  }
})

test('45 条：列表滚到「更早」；拖一条到「住哪」', async () => {
  const run = await start(many())
  const { page } = run
  try {
    await open(page)
    const list = pop(page).getByRole('list', { name: '收件箱里的' })
    // 滚到「更早」的组头在上面一点（定稿图那样）
    await list.evaluate((el: HTMLElement) => {
      const g = [...el.querySelectorAll<HTMLElement>('.dbr-grp')].find((x) => x.textContent?.includes('更早'))!
      el.scrollTop = g.offsetTop - el.offsetTop - 70
    })
    const p = (await pop(page).boundingBox())!
    const bar = (await acts(page).boundingBox())!
    const clip = { x: p.x + p.width - 880, y: bar.y - 10, width: 900, height: p.y + p.height - bar.y + 40 }
    await page.waitForTimeout(300)
    await page.screenshot({ path: name('many-open'), clip })
    await holdOnStay(page, '热狗在 Bæjarins 那家。')
    await page.waitForTimeout(200)
    await page.screenshot({ path: name('many-drag'), clip })
    await page.mouse.up()
  } finally {
    await run.close()
  }
})
