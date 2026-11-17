/**
 * 发版前第 3 轮：7000 篇的大库 ⌘K「找重复」。
 * 以前要算 10 分钟，只写「正在想…」，「停下」不停，新问题发不出去。
 * 现在：60 秒内出完整结果；算的时候写「已比 N/M 篇」、先找到的先列出来；「停下」马上停（算的进程没了）；算的时候能发新问题。
 */
import { expect, test, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, type Running } from './app'
import { makeBigVault } from './fixtures/big-vault'

const ai = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const running = (run: Running) => run.app.evaluate(() => (globalThis as unknown as { cnSimilarRunning?: string[] }).cnSimilarRunning ?? [])

const DRIVE = '一号公路一圈大约一千三百公里，冬天很多路段会封，出发前每天看路况网站，风大的时候开车门要抓紧，别让风把门吹坏。加油站之间隔得远，油表过半就加满。看极光要等云量低、KP 指数高的晚上，离开城镇找没有路灯的地方停车，别停在弯道上。'

/** ⌘K 打「找重复」，点这一项 */
async function findDups(page: Page) {
  await page.keyboard.press('Meta+k')
  const pal = page.getByRole('dialog', { name: '搜索和命令' })
  await pal.getByRole('textbox').fill('找重复')
  // 大库里全文搜「找重复」的结果陆续回来，列表会动：等它停下再点命令那一行
  const opt = pal.getByRole('option').filter({ hasText: /^找重复/ }).first()
  await expect(opt).toBeVisible()
  await expect(pal.getByText('在找…')).toHaveCount(0, { timeout: 15_000 })
  await page.waitForTimeout(300)
  await opt.click()
  await expect(pal).toBeHidden()
}

test('7000 篇的大库 ⌘K 找重复：边算边报已比几篇、先找到的先列；停下马上停；算的时候能发新问题；60 秒内出完整结果，埋的那对排第一', async () => {
  test.setTimeout(300_000)
  const run = await launch({ '首页留着.md': '# 首页留着\n' }, { CN_AI_FAKE: '1' }, (v) => {
    makeBigVault(v)
    writeFileSync(join(v, '冰岛自驾提醒.md'), `# 冰岛自驾提醒\n\n${DRIVE}\n`)
    writeFileSync(join(v, '冰岛自驾注意事项（剪藏）.md'), `# 冰岛自驾注意事项（剪藏）\n\n${DRIVE}还有：租车时把砂石险买上。\n`)
  })
  const { page } = run
  try {
    // ① 算起来：写已比几篇，数字在涨，先找到的先列出来
    await findDups(page)
    await expect(ai(page).getByTestId('ai-msg').last().getByTestId('dup-progress')).toBeVisible()
    // 钉住这一条（后面发新问题，最后一条会换成那个问题的回答）
    const msg = ai(page).getByTestId('ai-msg').nth((await ai(page).getByTestId('ai-msg').count()) - 1)
    const prog = msg.getByTestId('dup-progress')
    await expect(prog).toBeVisible()
    await expect(prog).toContainText(/已比 ?\d+\/70\d\d ?篇/, { timeout: 30_000 })
    const n1 = Number(/已比 ?(\d+)/.exec((await prog.textContent())!)![1])
    await expect.poll(async () => Number(/已比 ?(\d+)/.exec((await prog.textContent()) ?? '')?.[1] ?? 0), { timeout: 20_000 }).toBeGreaterThan(n1)
    await expect(msg.getByTestId('ai-dups').locator('.dup').first()).toBeVisible({ timeout: 20_000 })
    expect(await prog.isVisible()).toBe(true)
    await page.screenshot({ path: test.info().outputPath('dups-progress.png') })

    // ② 算的时候发新问题：不排在它后面，马上有回答
    const box = ai(page).getByRole('textbox', { name: '问 AI' })
    await box.fill('这篇讲了什么')
    await box.press('Enter')
    await expect(box).toHaveValue('')
    await expect(ai(page).getByTestId('ai-msg').last()).not.toHaveText(/正在想/, { timeout: 15_000 })
    await expect(prog).toBeVisible()

    // ③ 停下：算的进程马上没了，已经找到的留着
    await prog.getByRole('button', { name: '停下' }).click()
    await expect.poll(() => running(run), { timeout: 2_000 }).toEqual([])
    await expect(prog).toHaveCount(0)
    await expect(msg.locator('.txt')).toContainText(/^停下了（比了 ?\d+\/70\d\d ?篇），先找到的\d+对，像的在前：/)

    // ④ 再算一遍，等它算完：60 秒内，埋的那对排第一
    const t = Date.now()
    await findDups(page)
    await expect(ai(page).getByTestId('ai-msg').last().getByTestId('dup-progress')).toBeVisible()
    const again = ai(page).getByTestId('ai-msg').nth((await ai(page).getByTestId('ai-msg').count()) - 1)
    await expect(again.locator('.txt')).toContainText(/^找到\d+对可能重复的，像的在前：/, { timeout: 60_000 })
    const ms = Date.now() - t
    console.log(`7000 篇找重复用了 ${ms} ms，${await again.locator('.txt').textContent()}`)
    expect(ms).toBeLessThan(60_000)
    await expect(again.getByTestId('ai-dups').locator('.dup').first().locator('.pair')).toHaveText(/^冰岛自驾提醒↔冰岛自驾注意事项（剪藏）\d+%$|^冰岛自驾注意事项（剪藏）↔冰岛自驾提醒\d+%$/)
    await expect.poll(() => running(run)).toEqual([])
    // 上万对不一次铺开：先列 50 对，「再显示50对」往下加
    const rows = again.getByTestId('ai-dups').locator('.dup')
    await expect(rows).toHaveCount(50)
    await again.getByRole('button', { name: /^再显示50对/ }).click()
    await expect(rows).toHaveCount(100)
  } finally {
    await run.close()
  }
})
