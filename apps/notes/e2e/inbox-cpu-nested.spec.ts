// 2026-11-26 收件箱「新 Mac、空文件夹当库，CPU 被 git 占满」：空文件夹放在一个本身是 Git 仓库的目录下面（主目录被做成了放配置文件的仓库、
// 某个项目仓库里）。以前软件问的是「在不在某个仓库里」，答「在」就不建自己的仓库，拿上层那个当库的仓库用：
// 底栏写「上层改过的几千处没提交」，每次刷新都对整个上层跑 git status，退出前把上层的文件整个提交进去。
// 现在只认库文件夹自己的仓库：上层是仓库也给库建自己的，底栏「都提交了」，退出后上层一个提交都不多、一个文件都没被收进去。
import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import electronPath from 'electron'

const g = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

test('空文件夹放在一个 Git 仓库下面当库：建自己的仓库，不碰上层的仓库', async () => {
  test.setTimeout(120_000)
  const root = mkdtempSync(join(tmpdir(), 'cn-nested-'))
  const up = join(root, '主目录')
  mkdirSync(up)
  g(up, 'init', '-q', '-b', 'main')
  g(up, 'config', 'user.name', '上层')
  g(up, 'config', 'user.email', 'up@example.com')
  writeFileSync(join(up, '.zshrc'), 'export A=1\n')
  g(up, 'add', '.zshrc')
  g(up, 'commit', '-q', '-m', '配置文件')
  // 上层还有一堆没进它仓库的文件（下载、图片……）
  for (let i = 0; i < 200; i++) {
    mkdirSync(join(up, `Downloads/${i % 10}`), { recursive: true })
    writeFileSync(join(up, `Downloads/${i % 10}/f${i}.txt`), `${i}\n`)
  }
  const vault = join(up, 'Documents/新库')
  mkdirSync(vault, { recursive: true })
  const userData = join(root, 'user-data')
  const app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [join(__dirname, '../out/main/index.js')],
    env: { ...process.env, CN_VAULT: vault, CN_USER_DATA: userData, CN_E2E: '1', CN_NO_AX: '1', CN_QUICK_KEY: 'Alt+Command+Shift+F19', CN_TRASH_DIR: join(root, 'trash'), CN_ICLOUD_CONTAINER: join(root, 'icloud') },
  })
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.vault b')).toHaveText('新库')
    // 库自己有了仓库
    await expect.poll(() => existsSync(join(vault, '.git'))).toBe(true)
    expect(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: vault, encoding: 'utf8' }).trim().endsWith('Documents/新库')).toBe(true)
    // 底栏数的是库自己的：都提交了（以前是上层那 200 个下载的文件「没提交」）
    await expect(page.getByTestId('git-changed')).toHaveText('都提交了')
    // 写一篇再退出：退出前的提交只进库自己的仓库
    writeFileSync(join(vault, '第一篇.md'), '# 第一篇\n\n一段字。\n')
    await expect(page.getByTestId('git-changed')).toContainText('1处没提交')
  } finally {
    await app.close()
  }
  // 上层仓库一点没动：还是那一个提交，下载的文件没被收进去
  expect(g(up, 'rev-list', '--count', 'HEAD')).toBe('1')
  expect(g(up, 'ls-files')).toBe('.zshrc')
  // 库自己的仓库里只有库里的东西
  const mine = g(vault, 'ls-files').split('\n')
  expect(mine).toContain('第一篇.md')
  expect(mine.some((f) => f.startsWith('Downloads') || f.includes('.zshrc'))).toBe(false)
  rmSync(root, { recursive: true, force: true })
})
