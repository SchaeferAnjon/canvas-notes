/**
 * 窗口背景「主题渐变」能动、浓淡和速度可调，纯色保留，A / B 任意组合（task-aph2j）。一律真点设置、无头。
 * 1. 设置 › 外观：窗口背景五格；点主题渐变出两行（慢慢动 + 快慢、浓淡）；点了 <html> 跟着变、色块那一层真在动；风格 A / B 换着点背景不变；重开记得。
 * 2. 窗口到后台（blur）、看不见（hide）时停，回来接着动；系统「减少动态效果」时不动，设置里说为什么。
 * 3. A + 渐变：标题栏和两条图标栏透出来，中间、左栏照旧实底；A + 纯色和改之前一样（外框、标题栏、图标栏的底色）。
 */
import { expect, type Page, test } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, type Running } from './app'

/** 设置：B 是一个对话框，A 开成中间的一个标签 */
const dlg = (page: Page) => page.getByRole('dialog', { name: '设置' }).or(page.getByRole('region', { name: '设置' }))
const settingsOf = (userData: string) => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'))
const html = (page: Page) => page.locator('html')
/** 色块那一层的动画：[状态, 现在走到几毫秒]；没有动画是 null */
const glow = (page: Page) =>
  page.evaluate(() => {
    const a = document.querySelector('.cn-wall > i')!.getAnimations()[0]
    return a ? { state: a.playState, t: Number(a.currentTime ?? 0) } : null
  })
const transformOf = (page: Page) => page.evaluate(() => getComputedStyle(document.querySelector('.cn-wall > i')!).transform)
const bgOf = (page: Page, sel: string) => page.locator(sel).first().evaluate((e) => getComputedStyle(e).backgroundColor)

/** 左下齿轮「设置和外观」› 外观和主题（用户最常走的那条路） */
async function openLook(page: Page) {
  await page.getByRole('navigation', { name: '左栏' }).getByRole('button', { name: '设置和外观' }).click()
  await page.getByRole('dialog', { name: '设置和外观' }).getByRole('menuitem', { name: '外观和主题' }).click()
  await expect(dlg(page)).toBeVisible()
  await expect(dlg(page).getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: '外观', exact: true })).toHaveAttribute('aria-current', 'page')
}

function launchWith(appearance: Record<string, unknown> | null, settingsFile?: string) {
  return launch({ 'a.md': '# a\n\n正文一行。\n' }, {}, (vault) => {
    const ud = join(dirname(vault), 'user-data')
    mkdirSync(ud, { recursive: true })
    if (settingsFile) writeFileSync(join(ud, 'settings.json'), settingsFile)
    else if (appearance) writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance }))
  })
}

test('设置真点：窗口背景五格；主题渐变出慢慢动和浓淡两行；动、快慢、浓淡、风格 A/B 都当场变；重开软件还是这样', async () => {
  test.setTimeout(180_000)
  let run: Running | null = await launchWith({ followSystem: false, skin: 'sky', frame: 'b', winBg: 'aurora', wallMix: 'mid' })
  let saved = ''
  try {
    const { page, userData } = run
    await openLook(page)
    const s = dlg(page)
    const bgs = s.getByRole('radiogroup', { name: '窗口背景' })
    await expect(bgs.getByRole('radio')).toHaveText(['主题渐变', '纯色', '极光照片', '冰洞照片', '从电脑选'])
    await expect(html(page)).toHaveAttribute('data-winbg', 'photo')
    // 不是主题渐变时没有那两行
    await expect(s.locator('[data-row="wallMove"]')).toHaveCount(0)

    await bgs.getByRole('radio', { name: '主题渐变' }).click()
    await expect(bgs.getByRole('radio', { name: '主题渐变' })).toHaveAttribute('aria-checked', 'true')
    await expect(html(page)).toHaveAttribute('data-winbg', 'wall')
    await expect(page.locator('body > .cn-wall')).toBeVisible()
    await expect.poll(() => settingsOf(userData).appearance.winBg).toBe('wall')
    // 外框透明，露出的是渐变（不是照片、不是纯色）
    expect(await bgOf(page, '.win')).toBe('rgba(0, 0, 0, 0)')
    expect(await page.locator('.cn-wall').evaluate((e) => getComputedStyle(e).backgroundImage)).toMatch(/^linear-gradient/)
    // 默认慢慢动（耗电实测定的，交付页 49）：开关开着、慢
    const move = s.getByRole('switch', { name: '慢慢动' })
    await expect(move).toHaveAttribute('aria-checked', 'true')
    await expect(html(page)).toHaveAttribute('data-wallmove', 'slow')
    // 关掉：没有动画，快慢那一格收起，旁边说一句
    await move.click()
    await expect(move).toHaveAttribute('aria-checked', 'false')
    await expect.poll(() => settingsOf(userData).appearance.wallMove).toBe(false)
    await expect(s.locator('[data-row="wallMove"]')).toContainText('不动；窗口在后台时本来也停')
    expect(await glow(page)).toBeNull()
    await expect(s.getByRole('radiogroup', { name: '动多快' })).toHaveCount(0)

    // 再开：慢（45 秒一个方向），色块那一层真在走
    await move.click()
    await expect(move).toHaveAttribute('aria-checked', 'true')
    await expect(html(page)).toHaveAttribute('data-wallmove', 'slow')
    await expect.poll(() => settingsOf(userData).appearance.wallMove).toBe(true)
    const speed = s.getByRole('radiogroup', { name: '动多快' })
    await expect(speed.getByRole('radio')).toHaveText(['慢', '中', '快'])
    await expect(speed.getByRole('radio', { name: '慢' })).toHaveAttribute('aria-checked', 'true')
    const a0 = (await glow(page))!
    expect(a0.state).toBe('running')
    expect(await page.evaluate(() => (document.querySelector('.cn-wall > i')!.getAnimations()[0]!.effect as KeyframeEffect).getTiming().duration)).toBe(45_000)
    const tr0 = await transformOf(page)
    await page.waitForTimeout(1500)
    expect((await glow(page))!.t).toBeGreaterThan(a0.t + 800)
    expect(await transformOf(page)).not.toBe(tr0)

    // 快：8 秒
    await speed.getByRole('radio', { name: '快' }).click()
    await expect(html(page)).toHaveAttribute('data-wallmove', 'fast')
    await expect.poll(() => page.evaluate(() => (document.querySelector('.cn-wall > i')!.getAnimations()[0]!.effect as KeyframeEffect).getTiming().duration)).toBe(8_000)
    await expect.poll(() => settingsOf(userData).appearance.wallSpeed).toBe('fast')

    // 浓淡：三格，默认标准；淡 = 色块一半浓度，浓 = 饱和度 1.45、面板 75%
    const mix = s.getByRole('radiogroup', { name: '浓淡' })
    await expect(mix.getByRole('radio')).toHaveText(['淡', '标准', '浓'])
    await expect(mix.getByRole('radio', { name: '标准' })).toHaveAttribute('aria-checked', 'true')
    const glowStyle = () => page.locator('.cn-wall > i').evaluate((e) => [getComputedStyle(e).opacity, getComputedStyle(e).filter])
    expect(await glowStyle()).toEqual(['1', 'saturate(1) brightness(1)'])
    await mix.getByRole('radio', { name: '淡' }).click()
    await expect(html(page)).toHaveAttribute('data-wallmix', 'soft')
    await expect.poll(glowStyle).toEqual(['0.5', 'saturate(1) brightness(1)'])
    await mix.getByRole('radio', { name: '浓' }).click()
    await expect(html(page)).toHaveAttribute('data-wallmix', 'rich')
    await expect.poll(glowStyle).toEqual(['1', 'saturate(1.45) brightness(1)'])
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--isle-k').trim())).toBe('75%')
    await expect.poll(() => settingsOf(userData).appearance.wallMix).toBe('rich')

    // 风格 A：背景还是主题渐变、还在动（两个选项不互相锁）；标题栏、图标栏透明，中间实底
    const frames = s.getByRole('radiogroup', { name: '界面风格' })
    await frames.getByRole('radio', { name: /照VS Code/ }).click()
    await expect(html(page)).toHaveAttribute('data-frame', 'a')
    await expect(html(page)).toHaveAttribute('data-winbg', 'wall')
    // A 里设置是中间的一个标签：点回它接着改
    await page.getByRole('tab', { name: /^设置/ }).click()
    await expect(bgs.getByRole('radio', { name: '主题渐变' })).toHaveAttribute('aria-checked', 'true')
    expect((await glow(page))!.state).toBe('running')
    expect(await bgOf(page, '.frame-a .titlebar')).toBe('rgba(0, 0, 0, 0)')
    expect(await bgOf(page, '.frame-a .abar.left')).toBe('rgba(0, 0, 0, 0)')
    expect(await bgOf(page, '.frame-a > .center')).toBe('rgb(251, 253, 254)')
    expect(await bgOf(page, '.frame-a > .side')).not.toBe('rgba(0, 0, 0, 0)')
    // A 下换纯色、照片、再回渐变，风格不跟着变
    await bgs.getByRole('radio', { name: '纯色' }).click()
    await expect(html(page)).toHaveAttribute('data-winbg', 'none')
    await expect(s.locator('[data-row="wallMove"]')).toHaveCount(0)
    await bgs.getByRole('radio', { name: '冰洞照片' }).click()
    await expect(html(page)).toHaveAttribute('data-winbg', 'photo')
    expect(await bgOf(page, '.frame-a .titlebar')).toBe('rgba(0, 0, 0, 0)')
    await bgs.getByRole('radio', { name: '主题渐变' }).click()
    await expect(html(page)).toHaveAttribute('data-frame', 'a')
    // 回到 B
    await frames.getByRole('radio', { name: /浮岛书桌/ }).click()
    await expect(html(page)).toHaveAttribute('data-frame', 'b')
    await expect(html(page)).toHaveAttribute('data-winbg', 'wall')
    await expect.poll(() => settingsOf(userData).appearance).toMatchObject({ frame: 'b', winBg: 'wall', wallMove: true, wallSpeed: 'fast', wallMix: 'rich' })
    saved = readFileSync(join(userData, 'settings.json'), 'utf8')
  } finally {
    await run?.close()
  }

  // 重开：同一份设置文件，一打开就是渐变、浓、快、在动；设置里各格也是这样
  run = await launchWith(null, saved)
  try {
    const { page } = run
    await expect(html(page)).toHaveAttribute('data-winbg', 'wall')
    await expect(html(page)).toHaveAttribute('data-wallmix', 'rich')
    await expect(html(page)).toHaveAttribute('data-wallmove', 'fast')
    expect((await glow(page))!.state).toBe('running')
    await openLook(page)
    const s = dlg(page)
    await expect(s.getByRole('radiogroup', { name: '窗口背景' }).getByRole('radio', { name: '主题渐变' })).toHaveAttribute('aria-checked', 'true')
    await expect(s.getByRole('switch', { name: '慢慢动' })).toHaveAttribute('aria-checked', 'true')
    await expect(s.getByRole('radiogroup', { name: '动多快' }).getByRole('radio', { name: '快' })).toHaveAttribute('aria-checked', 'true')
    await expect(s.getByRole('radiogroup', { name: '浓淡' }).getByRole('radio', { name: '浓' })).toHaveAttribute('aria-checked', 'true')
  } finally {
    await run.close()
  }
})

test('窗口到后台、看不见时停住，回来接着动；系统「减少动态效果」时不动，设置里说为什么', async () => {
  const run = await launchWith({ followSystem: false, skin: 'pine', frame: 'b', winBg: 'wall', wallMix: 'mid', wallMove: true, wallSpeed: 'fast' })
  const { page, app } = run
  try {
    await expect(html(page)).toHaveAttribute('data-wallrun', '1')
    expect((await glow(page))!.state).toBe('running')
    // 深色主题的「浓」色块再提亮 1.3（浅色不提，见上一条）
    await page.evaluate(() => (document.documentElement.dataset.wallmix = 'rich'))
    await expect.poll(() => page.locator('.cn-wall > i').evaluate((e) => getComputedStyle(e).filter)).toBe('saturate(1.45) brightness(1.3)')
    await page.evaluate(() => (document.documentElement.dataset.wallmix = 'mid'))
    // 别的软件到前面：窗口失焦
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await expect(html(page)).toHaveAttribute('data-wallrun', '0')
    await expect.poll(async () => (await glow(page))!.state).toBe('paused')
    // 停是下一帧才真停（pending pause）：等它落定再记位置
    await page.evaluate(() => document.querySelector('.cn-wall > i')!.getAnimations()[0]!.ready.then(() => 0))
    const t1 = (await glow(page))!.t
    await page.waitForTimeout(800)
    expect((await glow(page))!.t).toBe(t1)
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect.poll(async () => (await glow(page))!.state).toBe('running')
    await expect.poll(async () => (await glow(page))!.t).toBeGreaterThan(t1 + 300)

    // 看不见：窗口藏起来（收进程序坞、被盖住时系统也这样告诉页面）
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.hide())
    const hidden = await page.evaluate(() => document.visibilityState)
    if (hidden !== 'hidden') {
      // 测试窗口从不显示，hide() 后系统不一定改 visibilityState：照系统会发的那样告诉页面
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
        document.dispatchEvent(new Event('visibilitychange'))
      })
    }
    await expect(html(page)).toHaveAttribute('data-wallrun', '0')
    await expect.poll(async () => (await glow(page))!.state).toBe('paused')
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await expect.poll(async () => (await glow(page))!.state).toBe('running')

    // 减少动态效果：没有动画（色块停在不动时的位置），设置里开关后面说为什么
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect.poll(() => glow(page)).toBeNull()
    expect(await transformOf(page)).toBe('none')
    await openLook(page)
    await expect(dlg(page).locator('[data-row="wallMove"]')).toContainText('系统开了「减少动态效果」，现在不动')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await expect.poll(async () => (await glow(page))?.state).toBe('running')
    await expect(dlg(page).locator('[data-row="wallMove"]')).not.toContainText('减少动态效果')
  } finally {
    await run.close()
  }
})

test('A 照 VS Code + 纯色和改之前一模一样；旧设置里的 A 打开还是纯色，旧设置里的 B 照旧', async () => {
  // 改之前的设置文件（没有 wallMix）：A + 极光（默认值）→ 当纯色
  const run = await launchWith({ followSystem: false, skin: 'sky', frame: 'a', winBg: 'aurora' })
  const { page, userData } = run
  try {
    await expect(html(page)).toHaveAttribute('data-frame', 'a')
    await expect(html(page)).toHaveAttribute('data-winbg', 'none')
    await expect(page.locator('body > .cn-wall')).toBeHidden()
    // 天青的 --title #e6f1f6、--bar #e6f1f6、--win #fbfdfe：外框、标题栏、图标栏都是原来的实色
    expect(await bgOf(page, '.win')).toBe('rgb(251, 253, 254)')
    const title = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--title').trim())
    const bar = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bar').trim())
    const hex = (h: string) => `rgb(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)})`
    expect(await bgOf(page, '.frame-a .titlebar')).toBe(hex(title))
    expect(await bgOf(page, '.frame-a .abar.left')).toBe(hex(bar))
    await openLook(page)
    await expect(dlg(page).getByRole('radiogroup', { name: '窗口背景' }).getByRole('radio', { name: '纯色' })).toHaveAttribute('aria-checked', 'true')
    // 改过一次设置后文件里有了 wallMix，以后不再当旧设置；A 选了照片就铺照片
    await dlg(page).getByRole('radiogroup', { name: '窗口背景' }).getByRole('radio', { name: '极光照片' }).click()
    await expect.poll(() => settingsOf(userData).appearance).toMatchObject({ frame: 'a', winBg: 'aurora', wallMix: 'mid' })
    await expect(html(page)).toHaveAttribute('data-winbg', 'photo')
  } finally {
    await run.close()
  }
})
