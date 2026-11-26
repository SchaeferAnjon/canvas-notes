/**
 * 安装包自带 git（2026-11-26 用户选「带上」）：拿打好的 .app 真跑，当成没装苹果命令行工具的新 Mac——
 * 空 HOME（没有全局 git 设置、没有署名）、DEVELOPER_DIR 指到不存在（系统 /usr/bin/git 一跑就报 xcrun 的错）、不读系统 git 设置，
 * PATH 最前面放一个一跑就记账、报错的假 git。空文件夹当库：建历史、新建一篇打字、底栏提交、设置里填本地远端（file://）、现在同步，
 * 远端收到了；假 git 一次没被调。每个 git 进程自己记一份 trace2（GIT_TRACE2_EVENT 指到一个文件夹，一个进程一个文件，
 * 记着起的是哪个程序、哪一版、谁起的它）：全是包里那一份。
 *   CN_APP=<…/Canvas Notes.app> npx playwright test e2e/packaged-git.spec.ts（在 apps/notes 下）
 */
import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gitAct, pane, tabOn } from './app'

const APP = process.env.CN_APP
test.skip(!APP, '只在给了 CN_APP=<打好的 .app> 时跑')

test('打好的 .app 在没装命令行工具的 Mac 上：只用包里的 git，空库建历史、提交、同步到本地远端', async () => {
  test.setTimeout(180_000)
  const root = mkdtempSync(join(tmpdir(), 'cn-pkg-git-'))
  const vault = join(root, '新库')
  const bare = join(root, 'remote.git')
  const fake = join(root, 'fakebin')
  const calls = join(root, 'system-git-calls.log')
  const trace = join(root, 'trace2')
  for (const d of [vault, fake, trace, join(root, 'home'), join(root, 'trash')]) mkdirSync(d, { recursive: true })
  writeFileSync(join(fake, 'git'), `#!/bin/sh\necho "$*" >> '${calls}'\necho "system git must not run" >&2\nexit 97\n`, { mode: 0o755 })
  // 测试这边看结果用包里同一份 git（不用这台 Mac 的）
  const res = join(APP!, 'Contents/Resources/git')
  const pkgGit = join(res, 'libexec/git-core/git')
  const g = (cwd: string, ...a: string[]) =>
    execFileSync(pkgGit, a, { cwd, encoding: 'utf8', env: { HOME: join(root, 'home'), PATH: '/usr/bin:/bin', GIT_EXEC_PATH: join(res, 'libexec/git-core'), GIT_TEMPLATE_DIR: join(res, 'share/git-core/templates'), GIT_CONFIG_NOSYSTEM: '1' } }).trim()
  g(root, 'init', '-q', '--bare', '-b', 'main', bare)

  // 从访达打开的软件拿到的那几个环境变量（launchd 给的），其余一概不带
  const env: Record<string, string> = {
    USER: process.env.USER ?? '',
    LOGNAME: process.env.LOGNAME ?? process.env.USER ?? '',
    SHELL: '/bin/zsh',
    __CF_USER_TEXT_ENCODING: process.env.__CF_USER_TEXT_ENCODING ?? '0x1F5:0x19:0x34',
    PATH: `${fake}:/usr/bin:/bin:/usr/sbin:/sbin`,
    HOME: join(root, 'home'),
    DEVELOPER_DIR: '/nonexistent/developer',
    GIT_CONFIG_NOSYSTEM: '1',
    CN_VAULT: vault,
    CN_USER_DATA: join(root, 'user-data'),
    CN_E2E: '1',
    CN_NO_AX: '1',
    CN_QUICK_KEY: 'Alt+Command+Shift+F19',
    CN_TRASH_DIR: join(root, 'trash'),
    CN_ICLOUD_CONTAINER: join(root, 'icloud'),
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    GIT_TRACE2_EVENT: trace,
  }
  const app = await electron.launch({ executablePath: join(APP!, 'Contents/MacOS/Canvas Notes'), env })
  try {
    const page = await app.firstWindow()
    expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true)
    await expect(page.locator('.vault b')).toHaveText('新库')
    // 建了历史
    await expect.poll(() => existsSync(join(vault, '.git/HEAD'))).toBe(true)
    await expect(page.getByTestId('git-changed')).toBeVisible()
    if (process.env.CN_SHOTS) await page.screenshot({ path: join(process.env.CN_SHOTS, 'pkg-git-1-opened.png') })

    // 新建一篇，打标题和一段字
    await page.keyboard.press('Meta+n')
    await expect(tabOn(page)).toHaveText('未命名')
    await page.keyboard.type('自带的git')
    await page.keyboard.press('Enter')
    await expect(tabOn(page)).toHaveText('自带的git')
    await page.keyboard.type('没装命令行工具也能提交。')
    await expect.poll(() => (existsSync(join(vault, '收件箱/自带的git.md')) ? readFileSync(join(vault, '收件箱/自带的git.md'), 'utf8') : ''), { timeout: 15_000 }).toContain('没装命令行工具也能提交。')
    await expect(pane(page).locator('.cm-content')).toContainText('没装命令行工具也能提交。')

    // 底栏提交
    await gitAct(page, '提交')
    await expect(page.getByTestId('git-changed')).toHaveText('都提交了', { timeout: 15_000 })
    const log = g(vault, 'log', '--format=%an|%s')
    expect(log).toMatch(/自带的git/)
    if (process.env.CN_SHOTS) await page.screenshot({ path: join(process.env.CN_SHOTS, 'pkg-git-2-committed.png') })

    // 设置 › Git和同步：填本地远端，现在同步
    await page.keyboard.press('Meta+Comma')
    const set = page.getByRole('dialog', { name: '设置' })
    await set.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: 'Git和同步', exact: true }).click()
    await set.getByRole('textbox', { name: '远程地址' }).fill(`file://${bare}`)
    await set.getByRole('textbox', { name: '远程地址' }).press('Enter')
    await expect(set.getByTestId('git-remote-state')).toHaveText('地址存好了 · 还没同步过：点「现在同步」推上去')
    await set.getByRole('button', { name: '现在同步' }).click()
    await expect(set.getByTestId('git-remote-state')).toHaveText(/^地址存好了 · 上次同步今天 \d\d:\d\d$/, { timeout: 20_000 })
    if (process.env.CN_SHOTS) await page.screenshot({ path: join(process.env.CN_SHOTS, 'pkg-git-3-synced.png') })
    expect(g(bare, 'log', '--format=%s', 'main')).toBe(g(vault, 'log', '--format=%s', 'main'))
    expect(g(bare, 'show', 'main:收件箱/自带的git.md')).toContain('没装命令行工具也能提交。')
    await page.keyboard.press('Escape')
  } finally {
    await app.close()
  }
  const systemCalls = existsSync(calls) ? readFileSync(calls, 'utf8') : ''
  // 软件起的每个 git 进程记下的自己是哪个程序、哪一版（测试这边 g() 起的不记）
  const paths = new Map<string, number>()
  const versions = new Set<string>()
  const parents = new Set<string>()
  const files = readdirSync(trace)
  for (const f of files)
    for (const l of readFileSync(join(trace, f), 'utf8').split('\n').filter(Boolean)) {
      const e = JSON.parse(l) as { event: string; argv?: string[]; exe?: string; ancestry?: string[] }
      if (e.event === 'start') paths.set(e.argv![0]!, (paths.get(e.argv![0]!) ?? 0) + 1)
      if (e.event === 'cmd_ancestry') parents.add(e.ancestry![0]!)
      if (e.event === 'version') versions.add(e.exe!)
    }
  console.log(`git 进程 ${files.length} 个；程序：${[...paths].map(([p, n]) => `${p} × ${n}`).join('；')}；版本：${[...versions].join('、')}；谁起的：${[...parents].join('、')}；假 git 被调：${systemCalls ? systemCalls.trim() : '0 次'}`)
  expect(systemCalls).toBe('')
  expect(files.length).toBeGreaterThan(5)
  // 软件起的都是包里那份的绝对路径；同步时 git 自己起的 git-upload-pack、git-receive-pack 照 GIT_EXEC_PATH 找的也是包里的（版本只有包里那一个，
  // 这台 Mac 的苹果 git 是 2.50.1）
  expect(paths.get(pkgGit)).toBeGreaterThan(5)
  for (const p of paths.keys()) expect(p === pkgGit || /^git-(upload-pack|receive-pack)$/.test(p), p).toBe(true)
  expect([...parents].sort()).toEqual(['Canvas Notes', 'git'])
  expect([...versions]).toEqual([readFileSync(join(res, 'SOURCE.txt'), 'utf8').match(/^Git (\S+),/)![1]])
  rmSync(root, { recursive: true, force: true })
})
