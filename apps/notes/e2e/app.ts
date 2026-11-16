import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
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
  /** 退出软件、删掉临时库；keep：留着库和设置目录（看退出后磁盘上的样子，测试自己删） */
  close(opts?: { keep?: boolean }): Promise<void>
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
    // CN_E2E_ARGS：额外的 Chromium 开关（真网站的测试用 --disable-blink-features=AutomationControlled，网站才不当它是自动化）
    args: [...(process.env.CN_E2E_ARGS?.split(' ').filter(Boolean) ?? []), join(__dirname, '../out/main/index.js')],
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
    async close(opts: { keep?: boolean } = {}) {
      // 关不掉时别把整条测试的时间耗完：20 秒还没退出就杀掉，报出退出卡在哪一步（软件在 quit.log 里记的）
      const proc = app.process()
      let timer: NodeJS.Timeout | undefined
      const stuck = await Promise.race([
        app.close().then(() => false),
        new Promise<boolean>((r) => (timer = setTimeout(() => r(true), 20_000))),
      ])
      clearTimeout(timer)
      if (stuck) {
        const log = existsSync(join(userData, 'quit.log')) ? readFileSync(join(userData, 'quit.log'), 'utf8').trim().replace(/\n/g, ' → ') : '（没有 quit.log）'
        // 它这会儿起着的子进程（卡在哪个 git 命令上）
        const ps = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,etime=,command='], { encoding: 'utf8' })
          .split('\n')
          .filter((l) => l.trim().split(/\s+/)[1] === String(proc.pid))
          .map((l) => l.trim().slice(0, 200))
          .join(' | ')
        console.error(`[关不掉] ${log} · 子进程：${ps}`)
        proc.kill('SIGKILL')
        rmSync(root, { recursive: true, force: true, maxRetries: 5 })
        throw new Error(`软件 20 秒没退出，退出走到：${log}；子进程：${ps || "无"}`)
      }
      if (opts.keep) return
      // 大库（几千个文件）删的时候系统可能还在写别的东西，删不干净就再试几次
      rmSync(root, { recursive: true, force: true, maxRetries: 5 })
    },
  }
}

/** 窗口最右边的竖条（网页、梦游、历史） */
export const rail = (page: Page) => page.getByRole('navigation', { name: '右栏' })

/** 右图标栏上的几项（不算右下角的 AI 圆按钮；「大纲 · 这一页没有大纲」只取名字） */
export const railItems = (page: Page) =>
  rail(page)
    .locator('button.ab')
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')!.replace(/ · .*/, '')))

/** 右栏网页面板地址栏右边的「⋯」里点一项（书签和历史、导入 Chrome 登录、插件） */
export async function webMore(page: Page, item: '书签和历史' | '导入 Chrome 登录' | '插件') {
  const web = page.getByRole('complementary', { name: '网页' })
  await web.getByRole('button', { name: '更多', exact: true }).click()
  await web.getByRole('menu', { name: '更多', exact: true }).getByRole('menuitem', { name: new RegExp('^' + item) }).click()
}

/** 「⋯」菜单里的书签项（加书签 / 已收藏 · 改标签和备注 / 取消书签）：打开菜单，返回这一项 */
export async function starItem(page: Page) {
  const web = page.getByRole('complementary', { name: '网页' })
  await web.getByRole('button', { name: '更多', exact: true }).click()
  return web.getByRole('menu', { name: '更多', exact: true }).getByRole('menuitemcheckbox')
}

/** 当前标签的内容区 */
export const pane = (page: Page) => page.locator('.pane:not([hidden])')

/** 标签条右端：当前这一页的动作（属性、白板 / 文档 / 源文件、页码、问这一页、更多……） */
export const acts = (page: Page) => page.getByTestId('tab-acts')

/** 左边图标栏换到某一页（文件、最近、课程和文件夹首页、收件箱、梦游报告）；已经开着就不再点（再点是收起） */
export async function leftView(page: Page, name: '文件' | '最近' | '课程和文件夹首页' | '收件箱' | '梦游报告') {
  const b = page.getByRole('navigation', { name: '左栏' }).getByRole('button', { name, exact: true })
  if ((await b.getAttribute('aria-pressed')) !== 'true') await b.click()
  await expect(b).toHaveAttribute('aria-pressed', 'true')
}

/** 拖右栏左边的分隔线，把右栏拉宽 dx（右栏默认 340；网页上要框较长的一段时先拉宽，跟人一样） */
export async function widenRight(page: Page, dx: number) {
  const sep = (await page.getByRole('separator', { name: '拖动调整右栏宽度' }).boundingBox())!
  await page.mouse.move(sep.x + sep.width / 2, sep.y + 300)
  await page.mouse.down()
  await page.mouse.move(sep.x + sep.width / 2 - dx, sep.y + 300, { steps: 6 })
  await page.mouse.up()
}

/** 收件箱整个开在中间（左图标栏「收件箱」页头的「在中间打开整个收件箱」） */
export async function openInboxTab(page: Page) {
  await leftView(page, '收件箱')
  await page.locator('aside.side').getByRole('button', { name: '在中间打开整个收件箱' }).click()
  await expect(page.getByTestId('tab-on')).toHaveText('收件箱')
}

/** 底栏的提交、同步、历史：B（默认）收在「N 处没提交」的弹层里 */
export async function gitAct(page: Page, name: '提交' | '同步' | '历史') {
  if (name === '提交') await expect(page.getByTestId('git-changed')).toContainText('没提交')
  const pop = page.getByRole('dialog', { name: '没提交的改动' })
  // 弹层提交完还开着；再点「N 处没提交」会把它关上
  if (!(await pop.isVisible())) await page.getByTestId('git-changed').click()
  await pop.getByRole('button', { name, exact: true }).click()
}

/** 当前标签（标签上写着这一页的名字；页面里不再有标题行） */
export const tabOn = (page: Page) => page.getByTestId('tab-on')

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
  await expect(tabOn(page)).toHaveText(title)
  const doc = acts(page).getByRole('tab', { name: '文档' })
  if ((await acts(page).getByRole('tab', { name: '白板' }).getAttribute('aria-selected')) === 'true') {
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
  const seg = acts(page).getByRole('tablist', { name: '看法' })
  const wasDoc = (await seg.getByRole('tab', { name: '文档' }).getAttribute('aria-selected')) === 'true'
  if (wasDoc) await seg.getByRole('tab', { name: '源文件' }).click()
  const t = await lines(page)
  if (wasDoc) await seg.getByRole('tab', { name: '文档' }).click()
  return t
}

/** 编辑器里现在看得到的字（文档模式下记号是藏起来的） */
export const shownText = lines

export async function waitSaved(page: Page) {
  await expect(acts(page).getByTestId('save-state')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 })
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
