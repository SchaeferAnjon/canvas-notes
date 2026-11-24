/**
 * 主题渐变的截图（task-aph2j，交付页 49-主题渐变施工）：CN_SHOTS=<文件夹> 时存图，不设只跑一遍（各处的属性对不对）。
 * 十套 B 渐变 / 纯色、浓淡三档挑四套、动的两帧、A + 渐变浅深（和 A 纯色对照）、石墨改前改后、设置那几行。
 */
import { expect, type Page, test } from '@playwright/test'
import { open, shot } from './aph2j-look'

const SKINS = ['mint', 'sky', 'sakura', 'lilac', 'stone', 'pine', 'petrol', 'cocoa', 'ink', 'graphite']
const only = process.env.APH_SKINS?.split(',')

/** 色块那一层停在动画的某个位置 */
async function pose(page: Page, at: number) {
  await page.evaluate((at) => {
    document.documentElement.dataset.wallmove = 'fast'
    const a = document.querySelector('.cn-wall > i')!.getAnimations()[0]!
    a.pause()
    a.currentTime = Number((a.effect as KeyframeEffect).getTiming().duration) * at
  }, at)
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
}

for (const skin of only ?? SKINS)
  test(`${skin}：B + 主题渐变 标准；纯色对照`, async () => {
    test.setTimeout(180_000)
    for (const winBg of ['wall', 'none'] as const) {
      const run = await open({ skin, frame: 'b', winBg })
      try {
        await expect(run.page.locator('html')).toHaveAttribute('data-winbg', winBg)
        await expect(run.page.locator('body > .cn-wall')).toBeVisible({ visible: winBg === 'wall' })
        await shot(run, `B-${skin}-${winBg}`)
      } finally {
        await run.close()
      }
    }
  })

test('浓淡三档：天青、樱花、墨夜、石墨', async () => {
  test.setTimeout(300_000)
  for (const skin of ['sky', 'sakura', 'ink', 'graphite']) {
    const run = await open({ skin, frame: 'b', winBg: 'wall' })
    try {
      for (const mix of ['soft', 'mid', 'rich']) {
        await run.page.evaluate((m) => (document.documentElement.dataset.wallmix = m), mix)
        await run.page.waitForTimeout(200)
        await shot(run, `mix-${skin}-${mix}`)
      }
    } finally {
      await run.close()
    }
  }
})

test('动的两帧：天青、深湖，停在起点和走到三分之二；真动起来隔 3 秒两张', async () => {
  test.setTimeout(300_000)
  for (const skin of ['sky', 'petrol']) {
    const run = await open({ skin, frame: 'b', winBg: 'wall' })
    try {
      await pose(run.page, 0)
      await shot(run, `move-${skin}-0`)
      const t0 = await run.page.evaluate(() => getComputedStyle(document.querySelector('.cn-wall > i')!).transform)
      await pose(run.page, 0.66)
      await shot(run, `move-${skin}-66`)
      expect(await run.page.evaluate(() => getComputedStyle(document.querySelector('.cn-wall > i')!).transform)).not.toBe(t0)
      // 真动：快，隔 3 秒
      await run.page.evaluate(() => {
        document.documentElement.dataset.wallmove = 'fast'
        document.querySelector('.cn-wall > i')!.getAnimations()[0]!.play()
      })
      await run.page.waitForTimeout(500)
      await shot(run, `live-${skin}-a`)
      await run.page.waitForTimeout(3000)
      await shot(run, `live-${skin}-b`)
    } finally {
      await run.close()
    }
  }
})

test('A 照 VS Code + 渐变（天青、深湖），和 A + 纯色对照；A + 照片', async () => {
  test.setTimeout(300_000)
  for (const skin of ['sky', 'petrol'])
    for (const winBg of ['wall', 'none', 'aurora'] as const) {
      const run = await open({ skin, frame: 'a', winBg })
      try {
        await expect(run.page.locator('html')).toHaveAttribute('data-frame', 'a')
        await shot(run, `A-${skin}-${winBg}`)
      } finally {
        await run.close()
      }
    }
})

test('石墨改前（设计稿 26 的配方）改后', async () => {
  const run = await open({ skin: 'graphite', frame: 'b', winBg: 'wall' })
  try {
    await shot(run, 'graphite-after')
    await run.page.evaluate(() =>
      document.documentElement.style.setProperty(
        '--wall-glow',
        'radial-gradient(120% 70% at 18% 0%, #2f2a26 0%, transparent 60%), radial-gradient(85% 60% at 88% 8%, #1d2631 0%, transparent 55%), radial-gradient(70% 55% at 72% 100%, #3b2a1c 0%, transparent 60%)',
      ),
    )
    await run.page.waitForTimeout(200)
    await shot(run, 'graphite-before')
  } finally {
    await run.close()
  }
})

test('设置 › 外观：窗口背景五格和渐变那两行（天青浅、石墨深）', async () => {
  test.setTimeout(300_000)
  for (const skin of ['sky', 'graphite']) {
    const run = await open({ skin, frame: 'b', winBg: 'wall', wallMove: true, wallSpeed: 'mid' })
    const { page } = run
    try {
      await page.getByRole('navigation', { name: '左栏' }).getByRole('button', { name: '设置和外观' }).click()
      await page.getByRole('dialog', { name: '设置和外观' }).getByRole('menuitem', { name: '外观和主题' }).click()
      const s = page.getByRole('dialog', { name: '设置' })
      await s.locator('[data-row="wallMix"]').scrollIntoViewIfNeeded()
      await expect(s.getByRole('switch', { name: '慢慢动' })).toHaveAttribute('aria-checked', 'true')
      await page.waitForTimeout(300)
      await shot(run, `settings-${skin}`)
    } finally {
      await run.close()
    }
  }
})
