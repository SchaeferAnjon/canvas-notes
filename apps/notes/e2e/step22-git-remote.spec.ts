// 设置 › Git 和同步 › 远程地址（录屏 CN-45，方向 A）：地址框旁写全「保存」；存前黄点「地址还没保存：按 ↵ 或点保存」，
// 离开这一页也自动存；存后「已保存」、状态「地址存好了 · 还没同步过」、「现在同步」成为这一页唯一的主按钮。
// 远程是本机临时目录里的一个空仓库（不联网）。
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'

import { launch } from './app'
import { shotPart, shotTone } from './shots'

const dialog = (page: Page) => page.getByRole('dialog', { name: '设置' })
async function openGitPage(page: Page) {
  if (!(await dialog(page).isVisible())) await page.keyboard.press('Meta+,')
  await dialog(page).getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: 'Git和同步', exact: true }).click()
}
const remoteOf = (vault: string) => {
  try {
    return execFileSync('git', ['-C', vault, 'remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}
/** 这一页里黑色实心的主按钮（.btn-primary）有几个、叫什么 */
const solids = (page: Page) => dialog(page).locator('.btn-primary').allInnerTexts()

test('CN-45 远程地址：写全「保存」，存前存后各说一句；回车保存、「现在同步」变主按钮推上去；换页自动存', async () => {
  const run = await launch({ 'a.md': '# a\n' })
  const { page, vault } = run
  const bare = join(dirname(vault), 'remote.git')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare])
  try {
    await shotTone(page)
    await openGitPage(page)
    const state = dialog(page).getByTestId('git-remote-state')
    const sync = dialog(page).getByRole('button', { name: '现在同步' })
    await expect(state).toHaveText('还没有远程仓库：先填地址，再同步')
    await expect(sync).toBeDisabled()

    // 填了没存：「保存」是主按钮，黄点那句；同步灰着
    await dialog(page).getByRole('textbox', { name: '远程地址' }).fill(bare)
    await expect(dialog(page).getByRole('button', { name: '保存', exact: true })).toBeEnabled()
    await expect(state).toHaveText('地址还没保存：按 ↵ 或点「保存」离开这一页时也会自动存')
    await expect(state.locator('.dot.warn')).toBeVisible()
    await expect(sync).toBeDisabled()
    expect(await solids(page)).toEqual(['保存'])
    await shotPart(dialog(page), 'cn45-before')

    // 回车保存
    await dialog(page).getByRole('textbox', { name: '远程地址' }).press('Enter')
    await expect(page.locator('.toast-cn')).toContainText('远程地址存好了')
    await expect.poll(() => remoteOf(vault)).toBe(bare)
    await expect(dialog(page).getByRole('button', { name: '已保存' })).toBeDisabled()
    await expect(state).toHaveText('地址存好了 · 还没同步过：点「现在同步」推上去')
    await expect(state.locator('.dot.ok')).toBeVisible()
    await expect(sync).toBeEnabled()
    expect(await solids(page)).toEqual(['现在同步'])
    await shotPart(dialog(page), 'cn45-after')

    // 现在同步：推到那个空仓库
    await sync.click()
    const pushed = () => {
      try {
        return execFileSync('git', ['-C', bare, 'log', '--format=%s', 'main'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
      } catch {
        return ''
      }
    }
    await expect.poll(pushed, { timeout: 15_000 }).toContain('样本')
    await expect(state).toHaveText(/^地址存好了 · 上次同步今天 \d\d:\d\d$/)

    // 改了地址不点保存，换到别的设置页：自动存
    const other = join(dirname(vault), 'other.git')
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', other])
    await dialog(page).getByRole('textbox', { name: '远程地址' }).fill(other)
    await dialog(page).getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: '快捷键', exact: true }).click()
    await expect.poll(() => remoteOf(vault)).toBe(other)
    await openGitPage(page)
    await expect(dialog(page).getByRole('textbox', { name: '远程地址' })).toHaveValue(other)
    await expect(dialog(page).getByRole('button', { name: '已保存' })).toBeVisible()
  } finally {
    await run.close()
  }
})

test('CN-45 远程地址填错时「现在同步」：一句中文「这个地址找不到仓库」，状态行写「上次同步没成功」并一直留着；地址改对、同步成功后回到「上次同步 hh:mm」', async () => {
  const run = await launch({ 'a.md': '# a\n' })
  const { page, vault } = run
  const bad = join(dirname(vault), 'nope.git')
  try {
    await shotTone(page)
    await openGitPage(page)
    const state = dialog(page).getByTestId('git-remote-state')
    await dialog(page).getByRole('textbox', { name: '远程地址' }).fill(bad)
    await dialog(page).getByRole('textbox', { name: '远程地址' }).press('Enter')
    await expect.poll(() => remoteOf(vault)).toBe(bad)
    await dialog(page).getByRole('button', { name: '现在同步' }).click()
    await expect(page.locator('.toast-cn')).toContainText('这个地址找不到仓库，检查一下远程地址')
    await expect(page.locator('.toast-cn')).not.toContainText('fatal')
    await expect(state).toHaveText(/^上次同步没成功（今天 \d\d:\d\d）：这个地址找不到仓库，检查一下远程地址$/)
    await expect(state.locator('.dot.warn')).toBeVisible()
    await shotPart(dialog(page), 'r1-sync-error')
    // 换一页再回来还写着
    await dialog(page).getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: '快捷键', exact: true }).click()
    await openGitPage(page)
    await expect(state).toContainText('上次同步没成功')
    // 地址改对，同步成功
    const bare = join(dirname(vault), 'remote.git')
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare])
    await dialog(page).getByRole('textbox', { name: '远程地址' }).fill(bare)
    await dialog(page).getByRole('textbox', { name: '远程地址' }).press('Enter')
    await expect.poll(() => remoteOf(vault)).toBe(bare)
    await dialog(page).getByRole('button', { name: '现在同步' }).click()
    await expect(state).toHaveText(/^地址存好了 · 上次同步今天 \d\d:\d\d$/, { timeout: 15_000 })
  } finally {
    await run.close()
  }
})
