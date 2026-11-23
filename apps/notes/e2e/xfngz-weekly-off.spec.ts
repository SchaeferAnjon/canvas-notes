/**
 * 自带的「周记」默认关着（2026-11-23 task-xfngz，调度替用户定）：更新后头一次打开不往库里建周记、加待办、提交；
 * 设置 › 自动化里周记那一行显示关，打开才写进 .canvas-notes/自动化.md；周记关着时梦游照旧写本周小结（m552v-dream 那 7 条里有它）。
 * 测试模式里库还没有自动化.md 时自带的到点也不跑（钟拨到周日 20:00 以后、上次看到是周六）。都是真点，窗口不上屏。
 */
import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseLibrary } from '@cn/format'
import { launch } from './app'
import { shotTone, shotWindow } from './shots'

const git = (vault: string, ...a: string[]) => execFileSync('git', ['-C', vault, ...a], { encoding: 'utf8' }).trim()

test('周记默认关着：周日 20:00 过了打开也不建周记、不提交；设置里那一行是关的，打开才写进自动化.md', async () => {
  const run = await launch({ '课程/第3讲.md': '# 第3讲\n\n边际产量先升后降。\n' }, { CN_AI_FAKE: '1', CN_AUTO_NOW: '2026-11-22T20:30:00' }, (vault) => {
    const ud = join(dirname(vault), 'user-data')
    mkdirSync(ud, { recursive: true })
    writeFileSync(join(ud, 'automation.json'), JSON.stringify({ prefs: { on: true, missed: 'once', notify: true }, seen: { [vault]: '2026-11-21T10:00:00' } }))
  })
  const { page, vault } = run
  try {
    await shotTone(page)
    const commits = git(vault, 'rev-list', '--count', 'HEAD')
    await page.waitForTimeout(3000)
    expect(existsSync(join(vault, '周记'))).toBe(false)
    expect(existsSync(join(vault, '.canvas-notes/自动化记录'))).toBe(false)
    expect(git(vault, 'rev-list', '--count', 'HEAD')).toBe(commits)

    await page.keyboard.press('Meta+,')
    const settings = page.getByRole('dialog', { name: '设置' })
    await settings.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: '自动化', exact: true }).click()
    const sys = settings.getByRole('group', { name: '软件自带的' })
    const weekly = sys.getByRole('switch', { name: '周记' })
    await expect(weekly).toHaveAttribute('aria-checked', 'false')
    await expect(sys.getByRole('switch', { name: '定时整理收件箱' })).toHaveAttribute('aria-checked', 'false')
    await shotWindow(run, 'xfngz-weekly-off')

    // 用户打开：只这时才写进自动化.md
    expect(existsSync(join(vault, '.canvas-notes/自动化.md'))).toBe(false)
    await weekly.click()
    await expect(weekly).toHaveAttribute('aria-checked', 'true')
    const lib = () => (existsSync(join(vault, '.canvas-notes/自动化.md')) ? readFileSync(join(vault, '.canvas-notes/自动化.md'), 'utf8') : null)
    await expect.poll(() => parseLibrary(lib()).map((r) => [r.name, r.on])).toEqual([
      ['周记', true],
      ['整理收件箱', false],
    ])
    // 周记页里「梦游的写本周小结」跟着周记的开关：开着时并进周记
    await sys.locator('[data-part="周记"] .sa-lb').click()
    await expect(settings.getByRole('switch', { name: '梦游的「写本周小结」' })).toHaveAttribute('aria-checked', 'true')
    await shotWindow(run, 'xfngz-weekly-on')
  } finally {
    await run.close()
  }
})
