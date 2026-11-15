import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import electronPath from 'electron'

export interface Running {
  app: ElectronApplication
  page: Page
  vault: string
  /** 测试用的「废纸篓」（不往用户真的废纸篓里放） */
  trash: string
  /** 软件的设置目录 */
  userData: string
  /** 开始启动软件的时间（库已经建好、提交好之后），量启动耗时用 */
  launchedAt: number
  close(): Promise<void>
}

/** 建一个临时库（Git 仓库，文件都已提交），用它启动软件 */
export async function launch(
  files: Record<string, Uint8Array | string>,
  env: Record<string, string> = {},
  /** 提交前再动一下库（比如造一个大库、改修改时间） */
  prepare?: (vault: string) => void,
): Promise<Running> {
  const root = mkdtempSync(join(tmpdir(), 'cn-e2e-'))
  const vault = join(root, '测试库')
  const userData = join(root, 'user-data')
  const trash = join(root, 'trash')
  mkdirSync(trash)
  execFileSync('git', ['init', '-q', '-b', 'main', vault])
  execFileSync('git', ['-C', vault, 'config', 'user.name', 'Test'])
  execFileSync('git', ['-C', vault, 'config', 'user.email', 'test@example.com'])
  execFileSync('git', ['-C', vault, 'config', 'core.autocrlf', 'false'])
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(vault, name)), { recursive: true })
    writeFileSync(join(vault, name), content)
  }
  prepare?.(vault)
  execFileSync('git', ['-C', vault, 'add', '-A'])
  execFileSync('git', ['-C', vault, 'commit', '-q', '-m', '样本'])

  const launchedAt = Date.now()
  const app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [join(__dirname, '../out/main/index.js')],
    env: {
      ...process.env,
      CN_VAULT: vault,
      CN_USER_DATA: userData,
      // 测试实例：窗口放到屏幕外、全局快捷键换成一个没人用的、不碰辅助功能权限、不往真的废纸篓里放
      CN_E2E: '1',
      CN_NO_AX: '1',
      CN_QUICK_KEY: 'Alt+Command+Shift+F19',
      CN_TRASH_DIR: trash,
      ...env,
    },
  })
  const page = await app.firstWindow()
  await expect(page.locator('.vault b')).toHaveText('测试库')
  // 库名画出来时，React 的 effect（⌘F、⌘, 这些快捷键的监听）可能还没挂上；机器忙时紧接着按的第一个快捷键会丢（十次里两三次）。
  // 等两帧再交给测试
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0)))))
  return {
    app,
    page,
    vault,
    trash,
    userData,
    launchedAt,
    async close() {
      await app.close()
      // 大库（几千个文件）删的时候系统可能还在写别的东西，删不干净就再试几次
      rmSync(root, { recursive: true, force: true, maxRetries: 5 })
    },
  }
}

/** 窗口最右边的竖条（网页、梦游、历史） */
export const rail = (page: Page) => page.getByRole('navigation', { name: '右栏' })

/** 当前标签的内容区 */
export const pane = (page: Page) => page.locator('.pane:not([hidden])')

/** 左栏点一篇；白板默认以白板样式打开，这里切到文档，好打字 */
export async function openNote(page: Page, title: string) {
  const exact = new RegExp('^' + title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$')
  await expect(page.getByTestId('all-count')).not.toHaveText('0 篇')
  const row = page.locator('.nav .si').filter({ has: page.locator('.truncate', { hasText: exact }) })
  if (await row.count()) await row.click()
  else {
    // 左栏只放这周动过的前几篇；其余从「全部笔记」里筛出来打开
    await page.locator('.sall .si', { hasText: '全部笔记' }).click()
    await pane(page).getByRole('textbox', { name: '筛选' }).fill(title)
    await pane(page).getByRole('list', { name: '全部笔记' }).getByRole('listitem').filter({ has: page.locator('.t', { hasText: exact }) }).getByRole('button').click()
  }
  await expect(pane(page).locator('.tool h1')).toHaveText(title)
  const doc = pane(page).getByRole('tab', { name: '文档' })
  if ((await pane(page).getByRole('tab', { name: '白板' }).getAttribute('aria-selected')) === 'true') {
    await expect(pane(page).getByTestId('board')).toBeVisible()
    await page.waitForTimeout(300)
    await doc.click()
  }
  await expect(pane(page).locator('.cm-content')).toBeVisible()
}

const lines = (page: Page) =>
  pane(page)
    .locator('.cm-content')
    .evaluate((el) => Array.from(el.querySelectorAll('.cm-line'), (l) => l.textContent ?? '').join('\n'))

/** 编辑器里的 md 原文：文档模式会把记号藏起来，所以切到「源文件」读，读完切回去 */
export async function editorText(page: Page): Promise<string> {
  const seg = pane(page).getByRole('tablist', { name: '看法' })
  const wasDoc = (await seg.getByRole('tab', { name: '文档' }).getAttribute('aria-selected')) === 'true'
  if (wasDoc) await seg.getByRole('tab', { name: '源文件' }).click()
  const t = await lines(page)
  if (wasDoc) await seg.getByRole('tab', { name: '文档' }).click()
  return t
}

/** 编辑器里现在看得到的字（文档模式下记号是藏起来的） */
export const shownText = lines

export async function waitSaved(page: Page) {
  await expect(pane(page).getByTestId('save-state')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 })
}

export function gitStatus(vault: string): string {
  return execFileSync('git', ['-C', vault, 'status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' })
}

/** 左栏右键是系统原生菜单，Playwright 点不到：把菜单弹出换成「直接点某一项」，其余都走真的代码 */
export async function pickFromNoteMenu(run: Running, label: string) {
  await run.app.evaluate(({ Menu }, label) => {
    Menu.prototype.popup = function (this: Electron.Menu, opts?: Electron.PopupOptions) {
      const item = this.items.find((i) => i.label === label)
      if (!item) throw new Error('菜单里没有 ' + label)
      item.click()
      opts?.callback?.()
    }
  }, label)
}

/** 把库里一篇的修改时间改成 days 天前（模拟很久没动过） */
export function age(vault: string, rel: string, days: number) {
  const t = (Date.now() - days * 86400_000) / 1000
  utimesSync(join(vault, rel), t, t)
}
