/**
 * 设置里每一项不搜也翻得到（task-xy89o「功能有、但正常翻找不到」）：设置索引（shared/settings-index.ts）里的每一项，
 * 点侧栏那一页以后，页里有它那一行（data-row）、看得见。只在某个条件下才画的写在 WHEN 里。
 */
import { expect, test } from '@playwright/test'
import { SETTINGS_ITEMS, SETTINGS_PAGES } from '../src/shared/settings-index'
import { launch } from './app'

/** 只在某个条件下才画的行：条件 */
const WHEN: Record<string, string> = {
  homeWinBg: '首页样式选 B 时（这一项只管样式 B）',
}

test('设置索引里的每一项：点侧栏那一页就看得到那一行，不靠搜', async () => {
  test.setTimeout(120_000)
  const run = await launch({ 'a.md': '# a\n' }, { CN_LANG_SWITCH: '1' })
  const { page } = run
  try {
    await page.keyboard.press('Meta+,')
    const set = page.getByRole('dialog', { name: '设置' })
    await expect(set).toBeVisible()
    const nav = set.getByRole('navigation', { name: '设置分页' })
    const missing: string[] = []
    for (const p of SETTINGS_PAGES) {
      await nav.getByRole('button', { name: p.name, exact: true }).click()
      await expect(nav.getByRole('button', { name: p.name, exact: true })).toHaveAttribute('aria-current', 'page')
      await page.waitForTimeout(300)
      for (const it of SETTINGS_ITEMS.filter((x) => x.pg === p.id)) {
        if (WHEN[it.id]) continue
        const row = set.locator(`[data-row="${it.id}"]`)
        if (!(await row.count()) || !(await row.first().isVisible())) missing.push(`${p.name} › ${it.grp} › ${it.label}（${it.id}）`)
      }
    }
    expect(missing).toEqual([])
  } finally {
    await run.close()
  }
})
