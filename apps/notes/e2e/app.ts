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
  // 署名直接写在这一次提交上：prepare 去掉了库里的署名（测「这台 Mac 上 git 没有署名」）时照样提交得上
  execFileSync('git', ['-C', vault, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', '样本'])

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
      CN_ICLOUD_CONTAINER: join(root, 'icloud'),
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
        new Promise<boolean>((r) => (timer = setTimeout(() => r(true), Number(process.env.CN_E2E_QUIT_WAIT ?? 20) * 1000))),
      ])
      clearTimeout(timer)
      if (stuck) {
        const log = existsSync(join(userData, 'quit.log')) ? readFileSync(join(userData, 'quit.log'), 'utf8').trim().replace(/\n/g, ' → ') : '（没有 quit.log）'
        // 它这会儿起着的子进程（卡在哪个 git 命令上）
        // 机器上进程多（几千个、命令行很长）时 ps 的输出超过默认 1MB，execFileSync 报 ENOBUFS 盖掉真正的「没退出」
        const ps = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,etime=,command='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
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

/** 右图标栏上的几项（不算右下角的 AI 圆按钮；变淡的「大纲（这一页没有标题，没有大纲）」只取名字） */
export const railItems = (page: Page) =>
  rail(page)
    .locator('button.ab')
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')!.replace(/ · .*|（.*$/, '')))

/** 右栏网页面板地址栏右边的「⋯」里点一项（书签和历史、导入Chrome登录、插件） */
export async function webMore(page: Page, item: '书签和历史' | '导入Chrome登录' | '插件') {
  const web = page.getByRole('complementary', { name: '网页' })
  await web.getByRole('button', { name: '更多', exact: true }).click()
  await web.getByRole('menu', { name: '更多', exact: true }).getByRole('menuitem', { name: new RegExp('^' + item) }).click()
}

/** 「⋯」菜单里的书签项（加书签 / 已收藏 · 改标签和备注 / 取消书签）：打开菜单，返回这一项 */
export async function starItem(page: Page) {
  const web = page.getByRole('complementary', { name: '网页' })
  await web.getByRole('button', { name: '更多', exact: true }).click()
  // 「显示书签栏 ⇧⌘B」也是一项勾选（task-sta8n）：不算
  return web.getByRole('menu', { name: '更多', exact: true }).getByRole('menuitemcheckbox').filter({ hasText: /书签|收藏/ }).filter({ hasNotText: '显示书签栏' })
}

/**
 * 打开右栏 AI 那一格（右图标栏最下面的圆钮、A 是底栏最右一项，和点它一样）；已经开着就不点。
 * AI 只住右栏以后（第 2a 段）打开 PDF 不再自己把 AI 打开，开关记在本机，重开软件照旧
 */
export async function openAi(page: Page) {
  // 英文界面（task-zojmg 第二批起）叫 Show AI chat / Hide AI chat
  const entry = page.getByRole('button', { name: /^(打开 AI|Show AI chat)$/ })
  if (await entry.count()) await entry.first().click()
  await expect(page.getByRole('button', { name: /^(收起 AI|Hide AI chat)$/ }).first()).toBeVisible()
}

/** 当前标签的内容区 */
export const pane = (page: Page) => page.locator('.pane:not([hidden])')

/** 标签条右端：当前这一页的动作（属性、白板 / 文档、页码、问这一页、更多……） */
export const acts = (page: Page) => page.getByTestId('tab-acts')

/** 白板的收件箱弹窗收着（2026-11-22 起是弹窗、默认就收着，task-8isml）：开着就点白板右上角「收件箱 N」收起 */
export async function foldInbox(page: Page) {
  const p = pane(page).locator('.db-inbox-pop')
  if (await p.isVisible()) await pane(page).getByTestId('db-inbox').click()
  await expect(p).toHaveCount(0)
}

/** 白板的收件箱弹窗（task-8isml）：没开就点白板右上角「收件箱 N」打开，等落下的动画走完 */
export async function inboxPop(page: Page) {
  const p = pane(page).getByRole('dialog', { name: '收件箱' })
  if (!(await p.isVisible())) await pane(page).getByTestId('db-inbox').click()
  await expect(p).toBeVisible()
  await p.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
  return p
}

/** 左边图标栏换到某一页（文件、最近、摘在左边的分类和别的文件夹、梦游报告；分类和文件夹那一格同时开它的首页）；已经开着就不再点（再点是收起） */
export async function leftView(page: Page, name: '文件' | '最近' | '课程' | '收件箱' | '梦游报告' | (string & {})) {
  // 英文界面（task-zojmg）左栏叫 Left sidebar
  const b = page.getByRole('navigation', { name: /^(左栏|Left sidebar)$/ }).getByRole('button', { name, exact: true })
  if ((await b.getAttribute('aria-pressed')) !== 'true') await b.click()
  await expect(b).toHaveAttribute('aria-pressed', 'true')
}

/**
 * 工作区方向 A（task-9okg5）：网页和 AI 默认叠在同一组；把「网页」标签拖到这一组的上半，成了以前「网页在上、AI 在下，各一半」的样子。
 * view 给了拖的是别的标签（历史、大纲）。真拖：按下、挪过 4、指到组的上面 12%、松开
 */
export async function webAboveAi(page: Page, view = 'web') {
  const tab = page.getByTestId(`dtab-${view}`)
  const t = (await tab.boundingBox())!
  const g = (await page.locator('.dgrp').filter({ has: tab }).boundingBox())!
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2)
  await page.mouse.down()
  await page.mouse.move(t.x + t.width / 2 + 8, t.y + t.height / 2 + 3, { steps: 2 })
  await page.mouse.move(g.x + g.width / 2, g.y + g.height * 0.12, { steps: 10 })
  await expect(page.getByTestId('drop-mark')).toHaveText('放到上半')
  await page.mouse.up()
  await expect(page.locator('.dgrp')).toHaveCount(2)
}

/**
 * 工作区方向 A：把右边一个标签（ai、note、web、outline、history）真拖到中间内容的左边成一栏（「放到中间左边」），
 * 比如笔记拖到 PDF 左边，一边问一边看笔记长出来
 */
export async function noteBeside(page: Page, view = 'note') {
  const t = (await page.getByTestId(`dtab-${view}`).boundingBox())!
  const c = (await page.locator('main.center').boundingBox())!
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2)
  await page.mouse.down()
  await page.mouse.move(t.x + t.width / 2 + 8, t.y + t.height / 2 + 3, { steps: 2 })
  await page.mouse.move(c.x + c.width * 0.08, c.y + c.height / 2, { steps: 12 })
  await expect(page.getByTestId('drop-mark')).toHaveText('放到中间左边')
  await page.mouse.up()
  await expect(page.locator('.dcol').filter({ has: page.getByTestId(`dtab-${view}`) })).toHaveCount(1)
}

/** 拖右栏左边的分隔线，把右栏拉宽 dx（右栏默认 340；网页上要框较长的一段时先拉宽，跟人一样） */
export async function widenRight(page: Page, dx: number) {
  const sep = (await page.getByRole('separator', { name: '拖动调整右栏宽度' }).boundingBox())!
  await page.mouse.move(sep.x + sep.width / 2, sep.y + 300)
  await page.mouse.down()
  await page.mouse.move(sep.x + sep.width / 2 - dx, sep.y + 300, { steps: 6 })
  await page.mouse.up()
}

/**
 * 收件箱的长列表开在中间（⌘K「打开收件箱」）。2026-11-18 起活动栏的「收件箱」一格开的是收件箱这个分类的首页，
 * 左栏是它那一枝目录树，不再有「在中间打开整个收件箱」那颗按钮
 */
export async function openInboxTab(page: Page) {
  await page.keyboard.press('Meta+k')
  const pal = page.getByRole('dialog', { name: '搜索和命令' })
  await pal.getByRole('textbox').fill('打开收件箱')
  const opt = pal.getByRole('option').filter({ hasText: /^打开收件箱/ }).first()
  await expect(opt).toBeVisible()
  await opt.click()
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
  const row = page.locator('.nav .si').filter({ has: page.locator('.truncate', { hasText: exact }) })
  // 笔记列表是读出来的：等左栏「最近」有了第一行（或空库的那一句）
  await expect(page.locator('aside.side .nav .si, aside.side .s-none').first()).toBeVisible()
  if (await row.count()) await row.first().click()
  else {
    // 左栏「最近」只列今天、这周的，更早的按月收起；从中间的「最近」整页里筛出来打开
    await leftView(page, '最近')
    await page.locator('aside.side').getByRole('button', { name: '在中间打开' }).click()
    await pane(page).getByRole('textbox', { name: '筛选' }).fill(title)
    await pane(page).getByRole('list', { name: '最近的笔记' }).getByRole('listitem').filter({ has: page.locator('.t', { hasText: exact }) }).getByRole('button').click()
  }
  await expect(tabOn(page)).toHaveText(title)
  const doc = acts(page).getByRole('tab', { name: '文档' })
  if ((await acts(page).getByRole('tab', { name: '白板' }).getAttribute('aria-selected')) === 'true') {
    // 白板看法（2026-11-21 起 type: board 也是 doc-board；导图、撤回了转写法的旧白板还是 board）
    await expect(pane(page).locator('[data-testid="doc-board"], [data-testid="board"]').first()).toBeVisible()
    await page.waitForTimeout(300)
    await doc.click()
  }
  await expect(pane(page).locator('.cm-content')).toBeVisible()
}

const lines = (page: Page) =>
  pane(page)
    .locator('.cm-content')
    .evaluate((el) => Array.from(el.querySelectorAll('.cm-line'), (l) => l.textContent ?? '').join('\n'))

/** 编辑器里的 md 原文：文档里记号都藏着（没有「源文件」看法），直接读编辑器挂在外框上的 cnText（note-doc.ts） */
export async function editorText(page: Page): Promise<string> {
  return pane(page)
    .locator('.cm-editor')
    .evaluate((el) => (el as HTMLElement & { cnText: string }).cnText)
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

/**
 * 慢盘：主进程每次读、写 md 先等这么多毫秒（机器忙、盘慢、同步盘拦着时一样）。
 * 写慢：自动保存的那次写还在路上，量「关标签、改名、退出」等没等它写完；读慢：量标签出来了编辑器还没好的那一会儿。
 * 存笔记走原子写（@cn/atomic，task-8dula）：读是 open(md, 'r')，写是 open(.<名字>.md.cn-…tmp, 'wx')，这两样也拦
 */
export async function slowDisk(run: Running, ms: { read?: number; write?: number }) {
  await run.app.evaluate((_e, ms) => {
    type Fn = (p: unknown, ...rest: unknown[]) => Promise<unknown>
    const fsp = process.getBuiltinModule('node:fs/promises') as unknown as Record<'readFile' | 'writeFile' | 'open', Fn>
    const sleep = (n: number) => new Promise((r) => setTimeout(r, n))
    for (const name of ['readFile', 'writeFile'] as const) {
      const wait = name === 'readFile' ? ms.read : ms.write
      if (!wait) continue
      const orig = fsp[name]
      fsp[name] = async (p, ...rest) => {
        if (String(p).endsWith('.md')) await sleep(wait)
        return orig(p, ...rest)
      }
    }
    const open = fsp.open
    fsp.open = async (p, flags, ...rest) => {
      const s = String(p)
      if (ms.read && s.endsWith('.md') && (flags ?? 'r') === 'r') await sleep(ms.read)
      if (ms.write && /\.md\.cn-\d+-[0-9a-z]+\.tmp$/.test(s)) await sleep(ms.write)
      return open(p, flags, ...rest)
    }
  }, ms)
}
