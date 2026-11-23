/**
 * 设置里每一项不搜也翻得到（task-xy89o「功能有、但正常翻找不到」）：设置索引（shared/settings-index.ts）里的每一项，
 * 点侧栏那一页以后，页里有它那一行（data-row）、看得见。只在某个条件下才画的写在 WHEN 里。
 */
import { expect, test } from '@playwright/test'
import { SETTINGS_ITEMS, SETTINGS_PAGES, type SettingsItem } from '../src/shared/settings-index'
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
      const check = async (sub: SettingsItem['sub']) => {
        for (const it of SETTINGS_ITEMS.filter((x) => x.pg === p.id && x.sub === sub)) {
          if (WHEN[it.id]) continue
          const row = set.locator(`[data-row="${it.id}"]`)
          if (!(await row.count()) || !(await row.first().isVisible())) missing.push(`${p.name} › ${it.grp} › ${it.label}（${it.id}）`)
        }
      }
      await check(undefined)
      // 子页（设置 › 自动化里点「周记」）：在那一页上点一下进去
      if (SETTINGS_ITEMS.some((x) => x.pg === p.id && x.sub === 'weekly')) {
        await set.locator('[data-part="周记"]').click()
        await expect(set.getByRole('button', { name: '回到自动化' })).toBeVisible()
        await page.waitForTimeout(300)
        await check('weekly')
        await set.getByRole('button', { name: '回到自动化' }).click()
      }
    }
    expect(missing).toEqual([])
  } finally {
    await run.close()
  }
})

test('搜到周记那几项、定时整理收件箱、数据库里建的：回车翻到那一行闪一下（周记的先进周记那一页）；之后点侧栏回自动化还是列表页', async () => {
  const run = await launch({ 'a.md': '# a\n' })
  const { page } = run
  try {
    await page.keyboard.press('Meta+,')
    const set = page.getByRole('dialog', { name: '设置' })
    const nav = set.getByRole('navigation', { name: '设置分页' })
    const search = set.getByRole('textbox', { name: '搜设置' })
    const go = async (q: string, id: string) => {
      await search.fill(q)
      await expect(set.locator('.sa-rrow.sel')).toHaveAttribute('data-go', id)
      await search.press('Enter')
      const row = set.locator(`[data-row="${id}"]`)
      await expect(row).toBeVisible()
      await expect(row).toHaveClass(/sa-flash/)
      // 搜着的时候侧栏是搜到的几项；清空才回到分页
      await search.fill('')
      await expect(nav.getByRole('button', { name: '自动化', exact: true })).toHaveAttribute('aria-current', 'page')
    }
    await go('每周几', 'weekDay')
    await expect(set.getByRole('button', { name: '回到自动化' })).toBeVisible()
    await go('建好就提醒', 'weekRemind')
    // 回到列表那几项：周记那一页退出来；软件自带的三样各是一行，闪那一行
    await go('定时整理收件箱', 'autoInbox')
    await expect(set.getByRole('button', { name: '回到自动化' })).toHaveCount(0)
    await go('数据库里建的', 'autoBase')
    // 再搜周记、换一页、点侧栏回自动化：是列表页，不是上次那个周记
    await go('几点 周记', 'weekAt')
    await nav.getByRole('button', { name: '一般', exact: true }).click()
    await nav.getByRole('button', { name: '自动化', exact: true }).click()
    await expect(set.locator('[data-row="autoAll"]')).toBeVisible()
    await expect(set.getByRole('button', { name: '回到自动化' })).toHaveCount(0)
  } finally {
    await run.close()
  }
})
