// 英文版第一批（task-zojmg，设计稿 /private/tmp/canvas-notes-en/）：界面语言（设置 › 一般 › 语言、CN_LANG、跟随系统）、
// 切了当场换（菜单栏、菜单栏图标的菜单、设置、提示条带撤回、正在打的字不丢）、库语言（英文界面新建的库记下 English）。
// 一律无头（CN_E2E=1）、临时库、临时设置目录。
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import electronPath from 'electron'
import { launch, leftView, pane } from './app'
import { armMenus, menuLabels, openedMenu, pickMenu } from './menu'

type QuickHook = { show(): Promise<void>; menu: Electron.Menu }

const settingsJson = (userData: string) => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')) as { lang?: string }
const menuBar = (app: ElectronApplication) => app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.map((i) => i.label))
const fileMenu = (app: ElectronApplication) => app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items[1]!.submenu!.items.map((i) => i.label))
const trayMenu = (app: ElectronApplication) => app.evaluate(() => (globalThis as unknown as { cnQuick: QuickHook }).cnQuick.menu.items.map((i) => i.label))
const lastSubjects = (vault: string, n = 5) => execFileSync('git', ['-C', vault, 'log', `-${n}`, '--format=%s'], { encoding: 'utf8' }).trim().split('\n')

/** 设置弹窗（中文、英文两种名字都认） */
const dlg = (page: Page) => page.getByRole('dialog', { name: /^(设置|Settings)$/ })
const langRow = (page: Page) => dlg(page).locator('[data-row="lang"]')
const toast = (page: Page) => dlg(page).getByTestId('settings-toast')

/** 用一个已有的文件夹（不是 Git 仓库也行：软件自己 git init，就是「新建的库」）和设置目录启动 */
async function launchAt(vault: string, userData: string, env: Record<string, string> = {}) {
  const app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [join(__dirname, '../out/main/index.js')],
    env: { ...process.env, CN_VAULT: vault, CN_USER_DATA: userData, CN_E2E: '1', CN_NO_AX: '1', CN_QUICK_KEY: 'Alt+Command+Shift+F19', CN_TRASH_DIR: join(userData, '..', 'trash'), ...env },
  })
  const page = await app.firstWindow()
  await expect(page.locator('.vault b')).toHaveText(vault.split('/').pop()!)
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0)))))
  return { app, page }
}

/** 菜单栏图标里点「速记」，拿到速记小窗 */
async function openQuick(app: ElectronApplication): Promise<Page> {
  const [w] = await Promise.all([app.waitForEvent('window'), app.evaluate(() => (globalThis as unknown as { cnQuick: QuickHook }).cnQuick.menu.items[0]!.click())])
  await w.waitForLoadState()
  return w
}

/** 打开设置、翻到「一般」（侧栏第一页；⌘, 默认开的是外观） */
async function openSettings(page: Page) {
  await page.keyboard.press('Meta+,')
  await expect(dlg(page)).toBeVisible()
  await dlg(page).getByRole('navigation').locator('button.si').first().click()
  await expect(langRow(page)).toBeVisible()
}

test('「语言」没放出来（LANG_SWITCH 关着）：设置里没有这一行、搜不到、⌘K 里也没有；系统是英文也照旧中文，不往设置里记语言', async () => {
  const run = await launch({ '随手记.md': '# 随手记\n' }, { CN_SYS_LANG: 'en-US' })
  const { page, userData } = run
  try {
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
    await page.keyboard.press('Meta+,')
    await expect(dlg(page)).toHaveAttribute('aria-label', '设置')
    await dlg(page).getByRole('navigation').locator('button.si').first().click()
    await expect(dlg(page).locator('[data-row="reopen"]')).toBeVisible()
    await expect(langRow(page)).toHaveCount(0)
    await dlg(page).getByRole('textbox').first().fill('language')
    await expect(dlg(page).locator('[data-go="lang"]')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Meta+k')
    await page.keyboard.type('language')
    await expect(page.getByRole('dialog', { name: '搜索和命令' })).toBeVisible()
    await expect(page.getByRole('dialog', { name: '搜索和命令' }).getByText('界面语言')).toHaveCount(0)
    await page.keyboard.press('Escape')
    const saved = existsSync(join(userData, 'settings.json')) ? settingsJson(userData) : {}
    expect(saved.lang).toBeUndefined()
  } finally {
    await run.close()
  }
})

test('CN_LANG=en 开局就是英文：菜单栏、菜单栏图标的菜单、设置、速记小窗；中文库里写进文件的字照旧中文', async () => {
  const run = await launch({ '随手记.md': '# 随手记\n\n一段字。\n' }, { CN_LANG: 'en' })
  const { page, app, vault } = run
  try {
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    expect(await menuBar(app)).toEqual(expect.arrayContaining(['File', 'Edit', 'View', 'Go']))
    // 文件菜单照 DESIGN.md「菜单栏」：新建一门课、新建文件夹、存成书桌…（task-xy89o 补的）也是英文
    expect(await fileMenu(app)).toEqual(['New Note', 'New Board', 'New Course', 'New Folder', 'Snap a Mind Map', 'Import Notes…', 'Save as Desk…', '', 'Close'])
    // 帮助 › 打开日志文件夹（task-pyb39）；菜单栏里软件自己的项一个中文字都不剩
    const help = await app.evaluate(({ Menu }) => {
      const h = Menu.getApplicationMenu()!.items.find((i) => i.role === 'help')!
      return [h.label, ...h.submenu!.items.map((i) => i.label)]
    })
    expect(help).toEqual(['Help', 'Open Logs Folder'])
    const allLabels = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.flatMap((i) => [i.label, ...(i.submenu?.items.map((x) => x.label) ?? [])]))
    expect(allLabels.filter((l) => /[\u4e00-\u9fff]/.test(l))).toEqual([])
    expect(await trayMenu(app)).toEqual(['Quick Note', 'Open Canvas Notes', 'Dream Now', '', 'Quit'])

    await openSettings(page)
    await expect(dlg(page)).toHaveAttribute('aria-label', 'Settings')
    await expect(langRow(page)).toContainText('Interface language')
    await expect(langRow(page).getByRole('combobox')).toHaveValue('en')
    await page.keyboard.press('Escape')

    // 速记小窗是英文；这是已有的中文库，写进库里的提交说明照库语言用中文
    const quick = await openQuick(app)
    const box = quick.getByRole('textbox', { name: 'Quick note text' })
    await expect(box).toBeVisible()
    await expect(quick.locator('.qk-k')).toHaveText('Quick note · Return saves to the Inbox')
    await expect(quick.locator('.qk-foot')).toContainText('Save to Inbox')
    await box.pressSequentially('call the landlord')
    await box.press('Enter')
    await expect.poll(() => lastSubjects(vault, 1)[0]).toBe('速记：call the landlord')
    expect(existsSync(join(vault, '.canvas-notes', '库.json'))).toBe(false)
  } finally {
    await run.close()
  }
})

test('真点设置切语言：中文 → English（提示条带撤回）→ 撤回 → English → 简体中文；菜单栏跟着换，正在打的字不丢', async () => {
  const run = await launch({ '随手记.md': '# 随手记\n\n一段字。\n' }, { CN_LANG_SWITCH: '1' })
  const { page, app, userData, vault } = run
  try {
    // 先开一篇在打字
    await page.keyboard.press('Meta+o')
    await page.keyboard.type('随手记')
    await page.keyboard.press('Enter')
    const doc = pane(page).locator('.cm-content')
    await expect(doc).toContainText('一段字')
    await doc.click()
    await page.keyboard.press('Meta+ArrowDown')
    await page.keyboard.type('正在打的字')

    await openSettings(page)
    await expect(dlg(page)).toHaveAttribute('aria-label', '设置')
    await expect(langRow(page)).toContainText('界面语言')
    const sel = langRow(page).getByRole('combobox')
    await expect(sel).toHaveValue('system')
    // 选项：跟随系统（测试里的系统是简体中文）、语言名用它自己的写法
    await expect(sel.locator('option')).toHaveText(['跟随系统（简体中文）', '简体中文', 'English'])

    await sel.selectOption('en')
    await expect(dlg(page)).toHaveAttribute('aria-label', 'Settings')
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(toast(page)).toContainText('Saved · Now in English; system items (Edit menu, file dialogs) switch after a restart')
    await expect(sel.locator('option')).toHaveText(['Same as system (简体中文)', '简体中文', 'English'])
    await expect.poll(() => menuBar(app)).toEqual(expect.arrayContaining(['File', 'View', 'Go']))
    expect(await trayMenu(app)).toEqual(['Quick Note', 'Open Canvas Notes', 'Dream Now', '', 'Quit'])
    expect(settingsJson(userData).lang).toBe('en')

    // 撤回：回到跟随系统（中文）
    await toast(page).getByRole('button', { name: 'Undo' }).click()
    await expect(dlg(page)).toHaveAttribute('aria-label', '设置')
    await expect(sel).toHaveValue('system')
    await expect.poll(() => menuBar(app)).toEqual(expect.arrayContaining(['文件', '显示', '前往']))
    await expect.poll(() => settingsJson(userData).lang).toBe('system')

    await sel.selectOption('en')
    await expect(dlg(page)).toHaveAttribute('aria-label', 'Settings')
    await sel.selectOption('zh')
    await expect(dlg(page)).toHaveAttribute('aria-label', '设置')
    await expect(toast(page)).toContainText('已存 · 界面换成简体中文；系统自带的几处（编辑菜单、文件对话框）重开后换')
    expect(settingsJson(userData).lang).toBe('zh')

    // 关上设置：那篇还开着，刚才打的字还在，存得进文件
    await page.keyboard.press('Escape')
    await expect(doc).toContainText('正在打的字')
    await expect.poll(() => readFileSync(join(vault, '随手记.md'), 'utf8')).toContain('正在打的字')
  } finally {
    await run.close()
  }
})

test('第一次打开跟系统；升级上来的（有设置、没记过语言）照旧中文；选了的重开还在', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cn-lang-'))
  const vault = join(root, 'Notes')
  mkdirSync(vault)
  writeFileSync(join(vault, 'a.md'), '# a\n')
  execFileSync('git', ['init', '-q', '-b', 'main', vault])
  execFileSync('git', ['-C', vault, '-c', 'user.name=T', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', 'x'])
  try {
    // 第一次打开（没有设置文件），系统是英文：跟随系统，界面英文
    const fresh = join(root, 'ud-fresh')
    let r = await launchAt(vault, fresh, { CN_SYS_LANG: 'en-US', CN_LANG_SWITCH: '1' })
    await expect(r.page.locator('html')).toHaveAttribute('lang', 'en')
    await openSettings(r.page)
    await expect(langRow(r.page).getByRole('combobox')).toHaveValue('system')
    await expect(langRow(r.page).getByRole('combobox').locator('option').first()).toHaveText('Same as system (English)')
    await r.app.close()
    expect(settingsJson(fresh).lang).toBe('system')

    // 已经在用的（设置文件里没有 lang）：照旧中文，记成简体中文
    const old = join(root, 'ud-old')
    mkdirSync(old)
    writeFileSync(join(old, 'settings.json'), JSON.stringify({ appearance: { frame: 'b' } }))
    r = await launchAt(vault, old, { CN_SYS_LANG: 'en-US', CN_LANG_SWITCH: '1' })
    await expect(r.page.locator('html')).toHaveAttribute('lang', 'zh-CN')
    await openSettings(r.page)
    await expect(langRow(r.page).getByRole('combobox')).toHaveValue('zh')
    // 选 English，重开还是英文
    await langRow(r.page).getByRole('combobox').selectOption('en')
    await expect(dlg(r.page)).toHaveAttribute('aria-label', 'Settings')
    await r.app.close()
    expect(settingsJson(old).lang).toBe('en')
    r = await launchAt(vault, old, { CN_LANG_SWITCH: '1' })
    await expect(r.page.locator('html')).toHaveAttribute('lang', 'en')
    expect(await menuBar(r.app)).toEqual(expect.arrayContaining(['File', 'View', 'Go']))
    await r.app.close()
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5 })
  }
})

test('左栏类型筛选：英文一排放不下时末尾收进「⋯」（选着的一直露着），点开挑；中文五样都在、没有「⋯」', async () => {
  for (const lang of ['zh', 'en'] as const) {
    const run = await launch({ '收件箱/a.md': '# a\n', '附件/a/x.png': 'png' }, { CN_LANG: lang })
    const { page, app } = run
    try {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
      await leftView(page, '文件')
      const chips = page.locator('aside.side .side-chips').first()
      await expect(chips.getByRole('tab').first()).toBeVisible()
      // 每一颗都整个在左栏里，不被截
      const side = (await page.locator('aside.side').first().boundingBox())!
      for (const b of await chips.locator('button').all()) {
        const r = (await b.boundingBox())!
        expect(r.x + r.width, `${lang}：「${await b.textContent()}」`).toBeLessThanOrEqual(side.x + side.width)
      }
      if (lang === 'zh') {
        await expect(chips.getByRole('tab')).toHaveText(['全部', '文档', '白板', '剪藏', '附件'])
        await expect(chips.locator('.chip.more')).toHaveCount(0)
        continue
      }
      const more = chips.locator('.chip.more')
      await expect(more).toBeVisible()
      const shown = await chips.getByRole('tab').allTextContents()
      expect(shown[0]).toBe('All')
      expect(shown).not.toContain('Attachments')
      await armMenus(run)
      await more.click()
      expect(menuLabels(await openedMenu(run))).toContain('Attachments')
      await pickMenu(run, 'Attachments')
      // 选着的那一样露出来（换成别的收进去）
      await expect(chips.getByRole('tab', { name: 'Attachments' })).toHaveAttribute('aria-selected', 'true')
    } finally {
      await run.close()
    }
  }
})

test('库语言：英文界面新建的库记下 English（单独一次提交），写进文件的字用英文；已有的库不记、照旧中文', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cn-vlang-'))
  const vault = join(root, 'My Notes')
  mkdirSync(vault)
  try {
    const r = await launchAt(vault, join(root, 'ud'), { CN_LANG: 'en' })
    await expect.poll(() => existsSync(join(vault, '.canvas-notes', '库.json'))).toBe(true)
    expect(JSON.parse(readFileSync(join(vault, '.canvas-notes', '库.json'), 'utf8'))).toEqual({ 语言: 'en' })
    await expect.poll(() => lastSubjects(vault)).toContain('Vault language: English')
    // 速记：提交说明跟库语言
    const quick = await openQuick(r.app)
    const box = quick.getByRole('textbox', { name: 'Quick note text' })
    await box.pressSequentially('buy milk')
    await box.press('Enter')
    await expect.poll(() => lastSubjects(vault, 1)[0]).toBe('Quick note: buy milk')
    // 切成中文界面：库还是英文的，文件不动
    await openSettings(r.page)
    await langRow(r.page).getByRole('combobox').selectOption('zh')
    await expect(dlg(r.page)).toHaveAttribute('aria-label', '设置')
    expect(JSON.parse(readFileSync(join(vault, '.canvas-notes', '库.json'), 'utf8'))).toEqual({ 语言: 'en' })
    await r.app.close()
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5 })
  }
})
