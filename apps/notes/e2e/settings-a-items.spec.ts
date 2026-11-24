// 设置方向 A 新加的、以前写死现在能设的，每一项都真起作用（task-f7rib）：
// Git和同步在临时库 + 本机 bare 远程里真同步（自动同步、打开库时先拉、退出前推）、不进Git的文件、每天备份；
// 右栏网页的下载（三种放法）；给AI的长期说明真带进一问（假引擎复述）；快捷键撞了能对调、速记的全局键；
// 一般、文档和白板、文件和附件、读PDF、网页、隐私、高级各项改了软件真的跟着变。一律无头（CN_E2E=1）、临时库、临时设置目录。
import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import electronPath from 'electron'
import { acts, launch, openAi, pane, rail, type Running, tabOn } from './app'
import { LECTURE } from './fixtures/pdf'
import { armMenus, pickMenu } from './menu'

const files = {
  '随手记.md': '# 随手记\n\n一段字。\n',
  '课程/线代/第3讲.pdf': LECTURE,
  '课程/线代/.gitkeep': '',
}

const dlg = (page: Page) => page.getByRole('dialog', { name: '设置' })
const row = (page: Page, id: string) => dlg(page).locator(`[data-row="${id}"]`)
const toast = (page: Page) => dlg(page).getByTestId('settings-toast')
const settingsJson = (run: Running) => JSON.parse(readFileSync(join(run.userData, 'settings.json'), 'utf8'))
const git = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim()
const screen = (run: Running) => run.app.evaluate(() => (globalThis as unknown as { cnScreen: string[] }).cnScreen.join('|'))

async function goPage(page: Page, name: string) {
  if (!(await dlg(page).isVisible())) await page.keyboard.press('Meta+,')
  await dlg(page).getByRole('navigation', { name: '设置分页' }).getByRole('button', { name, exact: true }).click()
  await expect(dlg(page).getByTestId('settings-head').locator('h2')).toHaveText(name)
}

async function relaunch(run: Running, env: Record<string, string> = {}) {
  const app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [join(__dirname, '../out/main/index.js')],
    env: { ...process.env, CN_VAULT: run.vault, CN_USER_DATA: run.userData, CN_E2E: '1', CN_NO_AX: '1', CN_QUICK_KEY: 'Alt+Command+Shift+F19', CN_TRASH_DIR: run.trash, ...env },
  })
  const page = await app.firstWindow()
  await expect(page.locator('.vault b')).toHaveText('测试库')
  return { app, page }
}

async function openDoc(page: Page, name: string) {
  await page.keyboard.press('Meta+o')
  await page.keyboard.type(name)
  await page.keyboard.press('Enter')
  await expect(tabOn(page)).toHaveText(name)
}

test('Git和同步：在临时库 + 本机 bare 远程里真同步：自动同步拉下别处的、推上本机的；退出前推一次；打开库时先拉一次', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'cn-remote-'))
  const bare = join(tmp, 'remote.git')
  const other = join(tmp, 'other')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare])
  // 一分钟当 100 毫秒：「每30分钟」= 3 秒
  const run = await launch(files, { CN_MINUTE_MS: '100' })
  const { page } = run
  try {
    await goPage(page, 'Git和同步')
    const remote = row(page, 'remote').getByRole('textbox', { name: '远程地址' })
    await remote.fill(bare)
    await remote.press('Enter')
    await expect(row(page, 'remote').getByTestId('git-remote-state')).toContainText('地址存好了 · 还没同步过')
    await row(page, 'remote').getByRole('button', { name: '现在同步' }).click()
    await expect(row(page, 'remote').getByTestId('git-remote-state')).toContainText('上次同步', { timeout: 15_000 })
    expect(git(bare, 'log', '--format=%s', 'main')).toContain('样本')
    // 另一台电脑：clone、改一篇、推上去
    execFileSync('git', ['clone', '-q', bare, other])
    git(other, 'config', 'user.name', 'B')
    git(other, 'config', 'user.email', 'b@example.com')
    writeFileSync(join(other, '另一台.md'), '# 另一台\n\n别处写的。\n')
    git(other, 'add', '-A')
    git(other, 'commit', '-q', '-m', '另一台写的')
    git(other, 'push', '-q')
    // 自动同步：每30分钟（测试里 3 秒），说明里写下次的时间
    await row(page, 'autoSync').getByRole('combobox').selectOption('30')
    await expect(toast(page)).toContainText('已存 · 每隔30分钟同步一次 · 底栏「同步」旁会写下次的时间')
    await expect(row(page, 'autoSync')).toContainText(/每30分钟一次，下次 \d\d:\d\d/)
    await expect.poll(() => existsSync(join(run.vault, '另一台.md')), { timeout: 20_000 }).toBe(true)
    // 打开库时先拉、退出前推
    await row(page, 'pullOpen').getByRole('switch').click()
    await expect(toast(page)).toContainText('已存 · 下次打开这个库时先拉一次')
    await row(page, 'pushQuit').getByRole('switch').click()
    await expect(toast(page)).toContainText('已存 · 退出前推一次，没网时照常退出')
    await row(page, 'autoSync').getByRole('combobox').selectOption('0')
    expect(settingsJson(run).sync).toMatchObject({ autoMinutes: 0, pullOnOpen: true, pushOnQuit: true })
    await page.keyboard.press('Escape')
    // 本机写一篇、提交，退出时推上去
    writeFileSync(join(run.vault, '本机.md'), '# 本机\n\n退出前写的。\n')
    git(run.vault, 'add', '-A')
    git(run.vault, 'commit', '-q', '-m', '本机写的')
    await run.close({ keep: true })
    expect(git(bare, 'log', '--format=%s', 'main').split('\n')[0]).toBe('本机写的')
    expect(readFileSync(join(run.userData, 'quit.log'), 'utf8')).toContain('退出前推完')
    // 另一台又推了一次；再打开时先拉下来
    git(other, 'pull', '-q')
    writeFileSync(join(other, '再一篇.md'), '# 再一篇\n')
    git(other, 'add', '-A')
    git(other, 'commit', '-q', '-m', '另一台又写的')
    git(other, 'push', '-q')
    const again = await relaunch(run)
    try {
      await expect(again.page.getByTestId('toast')).toContainText('打开时先拉了一次：拉下1次提交', { timeout: 15_000 })
      expect(existsSync(join(run.vault, '再一篇.md'))).toBe(true)
    } finally {
      await again.app.close()
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
    rmSync(join(run.vault, '..'), { recursive: true, force: true })
  }
})

test('不进Git的文件（.gitignore 编辑一次提交一次）、每天备份一份（iCloud 云盘，clone 回来什么都在）', async () => {
  const drive = mkdtempSync(join(tmpdir(), 'cn-icloud-'))
  const run = await launch(files, { CN_ICLOUD_DRIVE: drive })
  const { page, vault } = run
  try {
    await goPage(page, 'Git和同步')
    await expect(row(page, 'ignore')).toContainText('还没有：库里的文件都进Git')
    await row(page, 'ignore').getByRole('button', { name: '编辑…' }).click()
    await row(page, 'ignore').getByRole('textbox', { name: '不进Git的文件' }).fill('*.mp4\n大文件夹/')
    await row(page, 'ignore').getByRole('button', { name: '保存' }).click()
    await expect(toast(page)).toContainText('已存 · 不进Git的文件')
    expect(readFileSync(join(vault, '.gitignore'), 'utf8')).toBe('*.mp4\n大文件夹/\n')
    expect(git(vault, 'log', '-1', '--format=%s')).toBe('改了不进Git的文件')
    await expect(row(page, 'ignore')).toContainText('*.mp4、大文件夹/ · 写在库里的 .gitignore')
    await row(page, 'backup').getByRole('combobox').selectOption('icloud')
    await expect(toast(page)).toContainText('每天备份一份到「iCloud云盘」')
    const file = join(drive, 'Canvas Notes 备份', '测试库.bundle')
    await expect.poll(() => existsSync(file), { timeout: 15_000 }).toBe(true)
    await expect(row(page, 'backup').getByTestId('backup-state')).toContainText('上次备份 · ', { timeout: 10_000 })
    const back = join(drive, 'back')
    execFileSync('git', ['clone', '-q', file, back])
    expect(readFileSync(join(back, '随手记.md'), 'utf8')).toBe('# 随手记\n\n一段字。\n')
    expect(git(back, 'log', '-1', '--format=%s')).toBe('改了不进Git的文件')
  } finally {
    await run.close()
    rmSync(drive, { recursive: true, force: true })
  }
})

test('右栏网页的下载：放进下载文件夹、库里的「附件/下载」、每次问（自己的存储面板）', async () => {
  const dl = mkdtempSync(join(tmpdir(), 'cn-dl-'))
  const server = createServer((req, res) => {
    if (req.url === '/file.txt') {
      res.writeHead(200, { 'content-type': 'text/plain', 'content-disposition': "attachment; filename*=UTF-8''%E7%AC%94%E8%AE%B0.txt" })
      return res.end('下载的字')
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end('<!doctype html><title>下载页</title><a id="go" href="/file.txt">下载</a>')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const run = await launch(files, { CN_DOWNLOADS_DIR: dl })
  const { page, app, vault } = run
  const click = () =>
    app.evaluate(async ({ webContents }, u) => {
      const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith(u + '/page'))
      if (!wc) throw new Error('右栏网页还没开')
      await wc.executeJavaScript('document.getElementById("go").click()')
    }, base)
  try {
    await rail(page).getByRole('button', { name: '网页' }).click()
    const addr = page.getByRole('complementary', { name: '网页' }).getByRole('textbox', { name: '网址' })
    await addr.fill(`${base}/page`)
    await addr.press('Enter')
    await expect.poll(() => app.evaluate(({ webContents }, u) => webContents.getAllWebContents().some((w) => w.getURL().startsWith(u + '/page')), base), { timeout: 15_000 }).toBe(true)
    await click()
    await expect(page.getByTestId('toast')).toContainText('下载好了：笔记.txt', { timeout: 15_000 })
    expect(readFileSync(join(dl, '笔记.txt'), 'utf8')).toBe('下载的字')
    // 同名的不盖掉
    await click()
    await expect.poll(() => existsSync(join(dl, '笔记 (1).txt')), { timeout: 15_000 }).toBe(true)
    await page.getByTestId('toast').getByRole('button', { name: '在访达中显示' }).click()
    expect(await screen(run)).toContain(`在访达中显示 ${join(dl, '笔记 (1).txt')}`)
    await goPage(page, '网页和视频')
    await row(page, 'dlDir').getByRole('combobox').selectOption('vault')
    await expect(toast(page)).toContainText('已存 · 右栏网页里的下载放进「库里的「附件/下载」」')
    await page.keyboard.press('Escape')
    await click()
    await expect.poll(() => existsSync(join(vault, '附件', '下载', '笔记.txt')), { timeout: 15_000 }).toBe(true)
    await goPage(page, '网页和视频')
    await row(page, 'dlDir').getByRole('combobox').selectOption('ask')
    await page.keyboard.press('Escape')
    await click()
    await expect.poll(() => screen(run), { timeout: 15_000 }).toContain('存储面板')
  } finally {
    await run.close()
    server.close()
    rmSync(dl, { recursive: true, force: true })
  }
})

test('给AI的长期说明：离开框就存，下一问真的带上（假引擎复述）；全能模式和输入框下面那颗是同一个开关', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await goPage(page, 'AI')
    const box = row(page, 'prompt').getByRole('textbox', { name: '给AI的长期说明' })
    await box.fill('回答用中文，先说结论')
    await row(page, 'omni').click({ position: { x: 5, y: 5 } })
    await expect(toast(page)).toContainText('已存 · 给AI的长期说明：下一问起都带上')
    await row(page, 'omni').getByRole('switch').click()
    await expect(toast(page)).toContainText('AI输入框下面那颗开关也关了')
    expect((await page.evaluate(() => window.cn.aiEngines())).omni).toBe(false)
    await page.keyboard.press('Escape')
    await openAi(page)
    const chat = page.getByRole('complementary', { name: 'AI 对话' })
    await expect(chat.getByRole('switch', { name: /全能模式/ })).toHaveAttribute('aria-checked', 'false')
    const input = chat.getByRole('textbox', { name: '问 AI' })
    await input.fill('复述长期说明')
    await input.press('Enter')
    await expect(chat.getByTestId('ai-msg').last()).toContainText('长期说明：回答用中文，先说结论', { timeout: 20_000 })
  } finally {
    await run.close()
  }
})

test('快捷键：撞了别的说撞了谁、两个对调；速记的全局键能改（测试实例不真注册，只记下）', async () => {
  const run = await launch(files)
  const { page, vault } = run
  try {
    await goPage(page, '快捷键')
    await row(page, 'k-cmd-new-note').getByRole('button', { name: '改 新建笔记 的快捷键' }).click()
    await expect(row(page, 'k-cmd-new-note').getByRole('button', { name: '改 新建笔记 的快捷键' })).toHaveText('按新的组合键…')
    await page.keyboard.press('Meta+J')
    await expect(row(page, 'k-cmd-new-note').getByRole('alert')).toContainText('⌘J 已经给了「问AI」')
    // 录键时 ⌘J 没去开 AI，esc 也没关设置
    await expect(dlg(page)).toBeVisible()
    await row(page, 'k-cmd-new-note').getByRole('button', { name: '两个对调' }).click()
    await expect(row(page, 'k-cmd-new-note').getByRole('button', { name: '改 新建笔记 的快捷键' })).toHaveText('⌘J')
    await expect(row(page, 'k-cmd-ask-ai').getByRole('button', { name: '改 问AI 的快捷键' })).toHaveText('⌘N')
    await expect(toast(page)).toContainText('对调了：「新建笔记」⌘J，「问AI」⌘N')
    await expect.poll(() => JSON.parse(readFileSync(join(vault, '.canvas-notes/命令.json'), 'utf8')).keys).toMatchObject({ 'new-note': '⌘J', 'ask-ai': '⌘N' })
    // 照 Obsidian：命令就是 ⌘K 那一份，没有默认键的也在；顶上搜、只看已设的；改过的能回到默认、能清掉
    await expect(row(page, 'k-cmd-sync')).toBeVisible()
    await expect(row(page, 'k-cmd-sync').locator('.sa-keyb')).toHaveText('没有')
    await row(page, 'k-cmd-sync').getByRole('button', { name: '改 同步 的快捷键' }).click()
    await page.keyboard.press('Alt+Meta+Y')
    await expect(row(page, 'k-cmd-sync').locator('.sa-keyb')).toHaveText('⌥⌘Y')
    await dlg(page).getByRole('textbox', { name: '搜快捷键' }).fill('同步')
    await expect(dlg(page).locator('[data-row^="k-cmd-"]').first()).toContainText('同步')
    await dlg(page).getByRole('textbox', { name: '搜快捷键' }).fill('')
    await dlg(page).getByRole('switch', { name: '只看已设的' }).click()
    await expect(row(page, 'k-cmd-tidy-inbox')).toHaveCount(0)
    await expect(row(page, 'k-cmd-sync')).toBeVisible()
    // 真点（像人一样用鼠标）：两颗小按钮一直占着位置、不跟着动
    await row(page, 'k-cmd-sync').getByRole('button', { name: '清掉 同步 的快捷键' }).click()
    await expect(row(page, 'k-cmd-sync')).toHaveCount(0)
    await dlg(page).getByRole('switch', { name: '只看已设的' }).click()
    await row(page, 'k-cmd-new-note').getByRole('button', { name: '新建笔记 回到默认' }).click()
    await expect(row(page, 'k-cmd-new-note').locator('.sa-keyb')).toHaveText('⌘N')
    // 速记：⌥⌘J（一般页的「速记快捷键」是同一个）
    await row(page, 'kQuick').getByRole('button', { name: '改 速记 的快捷键' }).click()
    await page.keyboard.press('Alt+Meta+K')
    await expect(row(page, 'kQuick').getByRole('button', { name: '改 速记 的快捷键' })).toHaveText('⌥⌘K')
    await expect.poll(() => settingsJson(run).general.quickKey).toBe('⌥⌘K')
    await expect.poll(() => run.app.evaluate(() => (globalThis as unknown as { cnQuick: { wanted: string } }).cnQuick.wanted)).toBe('Alt+Command+K')
    await goPage(page, '一般')
    await expect(row(page, 'quickKey').locator('.sa-keyb')).toHaveText('⌥⌘K')
    // 视频的键只认 ⌥ 加字母
    await goPage(page, '快捷键')
    await row(page, 'kSnap').getByRole('button', { name: '改 记下这一刻 的快捷键' }).click()
    await page.keyboard.press('Meta+E')
    await expect(row(page, 'kSnap').getByRole('alert')).toContainText('视频的键只能用 ⌥ 加一个字母或数字')
  } finally {
    await run.close()
  }
})

test('写死的值放进设置：一般、文档和白板、文件和附件、读PDF、网页、隐私、高级，改了软件真的跟着变', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page, app, vault, userData } = run
  const flip = async (id: string) => row(page, id).getByRole('switch').click()
  try {
    // 一般：菜单栏图标关了就拿掉
    await goPage(page, '一般')
    expect(await app.evaluate(() => (globalThis as unknown as { cnQuick: { tray: boolean } }).cnQuick.tray)).toBe(true)
    await flip('tray')
    await expect(toast(page)).toContainText('菜单栏图标拿掉了')
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { cnQuick: { tray: boolean } }).cnQuick.tray)).toBe(false)
    await flip('quickSrc')
    await expect.poll(() => settingsJson(run).general.quickSrc).toBe(false)
    // 文档和白板：拼写检查、点阵、新建先用白板、按意思找
    await goPage(page, '文档和白板')
    await flip('spell')
    await flip('boardDots')
    await expect(page.locator('html')).toHaveAttribute('data-board-dots', 'off')
    await row(page, 'newView').getByRole('radio', { name: '白板' }).click()
    await expect(toast(page)).toContainText('⌘N 以后先建一块白板')
    await flip('semantic')
    await expect.poll(() => settingsJson(run).editor.semantic).toBe(false)
    await page.keyboard.press('Escape')
    await openDoc(page, '随手记')
    await expect(pane(page).locator('.cm-content')).toHaveAttribute('spellcheck', 'true')
    await page.keyboard.press('Meta+n')
    // 新白板：白板看法打开，标签上改名
    await expect(pane(page).locator('.board-wrap')).toBeVisible()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('冰岛')
    await expect(page.getByRole('dialog', { name: '搜索和命令' })).toContainText('按意思找关着（设置 › 文档和白板）', { timeout: 10_000 })
    await page.keyboard.press('Escape')
    // 文件和附件：新笔记总是收件箱；删笔记前每次都问；附件在访达里看
    await goPage(page, '文件和附件')
    await row(page, 'newWhere').getByRole('combobox').selectOption('inbox')
    await expect(toast(page)).toContainText('⌘N 以后放进「总是收件箱」')
    await row(page, 'delAsk').getByRole('combobox').selectOption('always')
    await row(page, 'attach').getByRole('button', { name: '在访达里看' }).click()
    await expect.poll(() => screen(run)).toContain(`在访达中显示 ${vault}`)
    await goPage(page, '文档和白板')
    await row(page, 'newView').getByRole('radio', { name: '文档' }).click()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Meta+n')
    await expect.poll(() => readdirNames(join(vault, '收件箱'))).toContain('未命名.md')
    // 删一篇没有图的：每次都问 → 弹框
    await openDoc(page, '随手记')
    await armMenus(run)
    await acts(page).getByRole('button', { name: '更多' }).click()
    await pickMenu(run, '移到废纸篓')
    await expect(page.getByRole('dialog', { name: '把《随手记》移到废纸篓？' })).toBeVisible()
    await page.getByRole('dialog', { name: '把《随手记》移到废纸篓？' }).getByRole('button', { name: '取消' }).click()
    // 读PDF：打开 PDF 时开着 AI；新打开的 PDF 用 100%
    await goPage(page, '读PDF')
    await flip('pdfAi')
    await row(page, 'pdfZoom').getByRole('combobox').selectOption('actual')
    await expect(toast(page)).toContainText('下次新打开的PDF用「100%」；看过的照旧')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
    await page.locator('.pal-row', { hasText: '第3讲' }).first().click()
    await expect(tabOn(page)).toHaveText('第3讲.pdf')
    await expect(page.getByRole('button', { name: '收起 AI', exact: true }).first()).toBeVisible()
    await expect(acts(page).getByTestId('pdf-zoom')).toHaveText('100%')
    await expect.poll(() => page.evaluate(() => localStorage.getItem('cn.pdfScale:课程/线代/第3讲.pdf'))).toBe('1')
    await expect(acts(page).getByRole('button', { name: '更多' })).toBeVisible()
    // 网页：新网页标签打开空白页；没字幕的视频打开就生成（和视频条里那个开关是同一个）
    await goPage(page, '网页和视频')
    await row(page, 'newTab').getByRole('combobox').selectOption('blank')
    await row(page, 'engine').getByRole('combobox').selectOption('bing')
    await expect(toast(page)).toContainText('地址栏里打的不是网址时，用Bing搜')
    await flip('autoSubs')
    await expect.poll(async () => (await page.evaluate(() => window.cnVideo.settings())).autoStt).toBe(true)
    // 隐私：拦广告关了 = 插件关了；检查更新和一般页是同一个
    await goPage(page, '隐私和联网')
    await flip('netAd')
    await expect.poll(async () => (await page.evaluate(() => window.cnPlugins.list())).find((p) => p.id === 'adblock')?.enabled).toBe(false)
    await flip('netWeread')
    await expect.poll(async () => (await page.evaluate(() => window.cnPlugins.list())).find((p) => p.id === 'weread')?.settings.sync).toBe(false)
    // 高级：软件设置目录在访达里看
    await goPage(page, '高级')
    await expect(row(page, 'cfgDir')).toContainText('设置、对话截图、意思索引')
    await row(page, 'cfgDir').getByRole('button', { name: '在访达里看' }).click()
    await expect.poll(() => screen(run)).toContain(`打开 ${userData}`)
    // Git：历史里藏起设置文件和历史头上「⋯」是同一个开关
    await goPage(page, 'Git和同步')
    await flip('hideInternal')
    expect(await page.evaluate(() => localStorage.getItem('cn.historyHideInternal'))).toBe('0')
    // 一般：不回到上次的样子 → 重开只有首页
    await goPage(page, '一般')
    await flip('reopen')
    await page.keyboard.press('Escape')
    await run.close({ keep: true })
    const again = await relaunch(run, { CN_AI_FAKE: '1' })
    try {
      await expect(again.page.getByTestId('tab-on')).toHaveText('首页')
      await expect(again.page.locator('.tabs .tab')).toHaveCount(1)
    } finally {
      await again.app.close()
    }
  } finally {
    await run.close().catch(() => undefined)
    rmSync(join(vault, '..'), { recursive: true, force: true })
  }
})

function readdirNames(dir: string): string[] {
  try {
    return require('node:fs').readdirSync(dir)
  } catch {
    return []
  }
}
