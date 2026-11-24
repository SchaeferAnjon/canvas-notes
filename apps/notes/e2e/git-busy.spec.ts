/**
 * 同步途中（pull --rebase，HEAD 临时分离）git:state 不抛错（0.5.10 那台 main.log「git symbolic-ref 失败：fatal: ref HEAD is not a symbolic ref」）：
 * 底栏照常显示分支，同步那里写「正在同步」、提交和同步先不让点；做完回到「同步」。
 */
import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch } from './app'

test('库正停在 rebase 上：底栏照常显示 main、「正在同步」，日志里没有 symbolic-ref 的错；rebase 做完回到「同步」', async () => {
  const run = await launch({ 'a.md': '第一行\n' })
  const { page, vault } = run
  const g = (...args: string[]) => execFileSync('git', ['-C', vault, ...args], { stdio: 'pipe' })
  try {
    g('checkout', '-q', '-b', 'other')
    writeFileSync(join(vault, 'a.md'), '别处改的\n')
    g('commit', '-q', '-am', '别处')
    g('checkout', '-q', 'main')
    writeFileSync(join(vault, 'a.md'), '这里改的\n')
    g('commit', '-q', '-am', '这里')
    expect(() => g('rebase', 'other')).toThrow()
    expect(existsSync(join(vault, '.git', 'rebase-merge'))).toBe(true)

    await page.evaluate(() => window.cn.setSettings({ appearance: { frame: 'a' } }))
    await page.reload()
    await expect(page.locator('.vault b')).toHaveText('测试库')
    expect(await page.evaluate(() => window.cn.gitState().then((s) => ({ branch: s.branch, busy: s.busy })))).toEqual({ branch: 'main', busy: 'rebase' })
    const bar = page.locator('footer.status')
    await expect(bar.locator('.bi', { hasText: /^main$/ })).toBeVisible()
    const sync = page.getByTestId('sync-btn')
    await expect(sync).toContainText('正在同步')
    await expect(sync).toBeDisabled()
    const log = join(run.userData, 'logs', 'main.log')
    expect(existsSync(log) ? readFileSync(log, 'utf8') : '').not.toContain('symbolic-ref')

    g('rebase', '--abort')
    await page.reload()
    await expect(page.locator('.vault b')).toHaveText('测试库')
    await expect(sync).toHaveText('同步')
    await expect(sync).toBeEnabled()
  } finally {
    await run.close()
  }
})
