// 梦游报告（录屏 CN-49 / 55 / 57 / 63）：标题放进和标签条齐平的那一条；侧栏每处改动一行人话，点了中间开对比标签。
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, leftView } from './app'
import { shotTone, shotWindow } from './shots'
import { DREAM_VAULT } from './fixtures/dream'

const frameA = (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { frame: 'a' } }))
}

/** 梦游报告的头和中间标签条：上沿、下沿各在哪 */
async function heads(page: Page) {
  const box = async (sel: string) => (await page.locator(sel).first().boundingBox())!
  const head = await box('.dream-panel .rhead')
  const tabs = await box('.center > .tabs')
  return { head, tabs }
}

for (const frame of ['b', 'a'] as const) {
  test(`梦游报告（${frame.toUpperCase()}）：「梦游报告 · 时间 · ×」那一行和中间标签条齐平，上面没有空条`, async () => {
    const run = await launch(DREAM_VAULT, { CN_AI_FAKE: '1' }, frame === 'a' ? frameA : undefined)
    const { page } = run
    try {
      await shotTone(page)
      await leftView(page, '梦游报告')
      const panel = page.getByRole('complementary', { name: '梦游报告' })
      await expect(panel.locator('.rhead b')).toHaveText('梦游报告')
      const { head, tabs } = await heads(page)
      expect(Math.abs(head.y - tabs.y)).toBeLessThanOrEqual(1)
      expect(Math.abs(head.y + head.height - (tabs.y + tabs.height))).toBeLessThanOrEqual(1)
      // 头上面就是左栏的上沿，没有另一条空条
      const side = (await panel.boundingBox())!
      expect(head.y - side.y).toBeLessThanOrEqual(1)
      await shotWindow(run, `cn49-dream-head-${frame}`)
    } finally {
      await run.close()
    }
  })
}
