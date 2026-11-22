import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import electronPath from 'electron'
import { gitStatus, launch, pane, tabOn, acts, gitAct } from './app'
import { ICELAND, LODGING } from './fixtures/board'
import { DREAM_VAULT } from './fixtures/dream'

const files = { '冰岛自驾.md': ICELAND, '住宿.md': LODGING, '所思所想.md': '# 所思所想\n\n第一段。\n', '收件箱/冰洞.md': '---\ncreated: 2026-11-14 21:10\n---\n冰洞只在冬天开放。\n' }
const settingsOf = (userData: string) => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'))
const homeFile = (vault: string) => join(vault, '.canvas-notes', '首页.json')
const settingsDialog = (page: Page) => page.getByRole('dialog', { name: '设置' })
// 编辑区（中间的岛）是主题的 --win；窗口本身在 B 里铺背景图
const winBg = (page: Page) => page.locator('main.center').evaluate((el) => getComputedStyle(el).backgroundColor)

async function openSettings(page: Page, tab: string) {
  await page.keyboard.press('Meta+,')
  await expect(settingsDialog(page)).toBeVisible()
  await settingsDialog(page).getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: tab, exact: true }).click()
}

/** 用同一个库和设置目录再开一次软件 */
async function relaunch(vault: string, userData: string, env: Record<string, string> = {}): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [join(__dirname, '../out/main/index.js')],
    env: { ...process.env, CN_VAULT: vault, CN_USER_DATA: userData, CN_E2E: '1', CN_NO_AX: '1', CN_QUICK_KEY: 'Alt+Command+Shift+F19', ...env },
  })
  const page = await app.firstWindow()
  await expect(page.locator('.vault b')).toHaveText('测试库')
  return { app, page }
}

test('四条栏：左右两条图标栏只放图标、悬停出名字，点亮着的那个收起那一侧；右边是大纲、网页、历史，左边是文件、最近、八个分类、梦游报告；梦游有报告时有小点', async () => {
  const run = await launch({ ...DREAM_VAULT, '冰岛自驾.md': ICELAND }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    const rail = page.getByRole('navigation', { name: '右栏' })
    const left = page.getByRole('navigation', { name: '左栏' })
    const names = (nav: typeof rail) => nav.getByRole('button').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
    // 「笔记」一直在最上面，不读 PDF 时和「大纲」一样原地变淡（右图标栏方向 A）；左边是八个分类分段（分类与入口方向 A）
    expect(await names(rail)).toEqual(['笔记（打开 PDF、或右栏开着配好对的网站时才有笔记）', '大纲（这一页没有标题，没有大纲）', '网页', '微信读书', '历史', '打开 AI'])
    expect(await names(left)).toEqual(['文件', '待办', '最近', '书桌', '收件箱', '课程', '阅读', '剪藏', '周记', '写作', '项目', '生活', '梦游报告', '最近删掉的', '库', '设置和外观'])
    // 图标栏贴着窗口右边，B 里 44 宽
    const box = (await rail.boundingBox())!
    const width = await page.evaluate(() => window.innerWidth)
    expect(Math.round(box.x + box.width)).toBe(width)
    expect(Math.round(box.width)).toBe(44)
    // 悬停出名字和快捷键（命令表里的键，task-spsmf）
    await rail.getByRole('button', { name: '网页' }).hover()
    await expect(page.getByTestId('tooltip')).toHaveText('网页⌥⌘W')

    await page.locator('.nav .si', { hasText: '冰岛自驾' }).click()
    await expect(acts(page).locator('.seg button')).toHaveText(['任务', '白板', '文档'])
    // 标签条右端只管当前页
    await expect(acts(page).locator('button', { hasText: '网页' })).toHaveCount(0)

    await rail.getByRole('button', { name: '网页' }).click()
    await expect(page.getByRole('complementary', { name: '网页' })).toBeVisible()
    await expect(rail.getByRole('button', { name: '网页' })).toHaveAttribute('aria-pressed', 'true')
    await rail.getByRole('button', { name: '历史' }).click()
    await expect(page.getByRole('complementary', { name: '网页' })).toBeHidden()
    await expect(page.getByRole('complementary', { name: '历史' })).toBeVisible()
    // 点亮着的那个 = 收起右栏
    await rail.getByRole('button', { name: '历史' }).click()
    await expect(page.getByRole('complementary', { name: '历史' })).toHaveCount(0)
    await rail.getByRole('button', { name: '大纲' }).click()
    await expect(page.getByRole('complementary', { name: '大纲' })).toContainText('冰岛自驾')

    // 左边：点亮着的那个收起左栏，再点展开
    await left.getByRole('button', { name: '最近', exact: true }).click()
    await expect(page.locator('.win')).toHaveClass(/side-hidden/)
    await left.getByRole('button', { name: '最近', exact: true }).click()
    await expect(page.locator('.win')).not.toHaveClass(/side-hidden/)

    await expect(page.getByTestId('dream-dot')).toHaveCount(0)
    await page.evaluate(() => window.cn.dreamNow())
    await expect(page.getByTestId('dream-dot')).toBeVisible({ timeout: 30_000 })
    await left.getByRole('button', { name: '梦游报告' }).click()
    await expect(page.getByRole('complementary', { name: '梦游报告' })).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('bars-dream.png') })
  } finally {
    await run.close()
  }
})

test('主题：十套都能换，窗口底色和当前标签的标记跟着变，存在设置目录；跟着系统时白天、夜里各用自己选的那套；重开还在', async () => {
  const run = await launch(files)
  const { page, userData, vault } = run
  try {
    await expect(page.locator('html')).toHaveAttribute('data-skin', /^(mint|pine)$/)
    // 左下齿轮菜单「外观和主题」打开设置的外观页
    await page.getByRole('navigation', { name: '左栏' }).getByRole('button', { name: '设置和外观' }).click()
    await page.getByRole('dialog', { name: '设置和外观' }).getByRole('menuitem', { name: '外观和主题' }).click()
    const dlg = settingsDialog(page)
    await expect(dlg.getByRole('radiogroup', { name: '主题' }).getByRole('radio')).toHaveCount(10)
    await dlg.getByRole('switch', { name: '跟着系统换浅深' }).click()
    await expect(dlg.getByRole('switch', { name: '跟着系统换浅深' })).toHaveAttribute('aria-checked', 'false')

    const expected: [string, 'light' | 'dark', string, string][] = [
      ['mint', 'light', 'rgb(250, 253, 251)', 'top'],
      ['sky', 'light', 'rgb(251, 253, 254)', 'bottom'],
      ['sakura', 'light', 'rgb(255, 251, 252)', 'fill'],
      ['lilac', 'light', 'rgb(253, 251, 255)', 'top'],
      ['stone', 'light', 'rgb(255, 255, 255)', 'none'],
      ['pine', 'dark', 'rgb(45, 53, 59)', 'top'],
      ['petrol', 'dark', 'rgb(0, 43, 54)', 'bottom'],
      ['cocoa', 'dark', 'rgb(44, 37, 37)', 'fill'],
      ['ink', 'dark', 'rgb(13, 16, 23)', 'bottom'],
      ['graphite', 'dark', 'rgb(12, 10, 9)', 'none'],
    ]
    for (const [id, tone, bg, mark] of expected) {
      await dlg.locator(`[data-skin-card="${id}"]`).click()
      await expect(page.locator('html')).toHaveAttribute('data-skin', id)
      await expect(page.locator('html')).toHaveAttribute('data-tone', tone)
      await expect(page.locator('html')).toHaveAttribute('data-tabmark', mark)
      await expect.poll(() => winBg(page)).toBe(bg)
      await expect(dlg.locator(`[data-skin-card="${id}"]`)).toHaveAttribute('aria-checked', 'true')
      await expect.poll(() => settingsOf(userData).appearance.skin).toBe(id)
    }
    // 窗口背景哪套主题都能换：不用图 → 没有照片；换回极光照片
    const bgs = dlg.getByRole('radiogroup', { name: '窗口背景' })
    await bgs.getByRole('radio', { name: '不用图' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-winbg', 'none')
    await expect.poll(() => settingsOf(userData).appearance.winBg).toBe('none')
    await bgs.getByRole('radio', { name: '极光照片' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-winbg', 'photo')
    await page.screenshot({ path: test.info().outputPath('graphite-aurora.png') })

    // 跟着系统：白天樱花、夜里可可；系统换成深色就是可可
    await dlg.getByRole('switch', { name: '跟着系统换浅深' }).click()
    await dlg.getByRole('combobox', { name: '白天用' }).selectOption('sakura')
    await dlg.getByRole('combobox', { name: '夜里用' }).selectOption('cocoa')
    await page.emulateMedia({ colorScheme: 'light' })
    await expect(page.locator('html')).toHaveAttribute('data-skin', 'sakura')
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect(page.locator('html')).toHaveAttribute('data-skin', 'cocoa')
    // 跟系统时点一张浅色卡 = 换掉白天那套，卡上写「白天」
    await dlg.locator('[data-skin-card="sky"]').click()
    await expect.poll(() => settingsOf(userData).appearance).toMatchObject({ followSystem: true, day: 'sky', night: 'cocoa' })
    await expect(dlg.locator('.sk:has([data-skin-card="sky"]) .slot')).toHaveText('白天')
    await page.keyboard.press('Escape')
    await expect(dlg).toBeHidden()
    // 设置不进库
    expect(gitStatus(vault)).toBe('')

    await run.app.close()
    const again = await relaunch(vault, userData)
    try {
      await again.page.emulateMedia({ colorScheme: 'dark' })
      await expect(again.page.locator('html')).toHaveAttribute('data-skin', 'cocoa')
      await again.page.emulateMedia({ colorScheme: 'light' })
      await expect(again.page.locator('html')).toHaveAttribute('data-skin', 'sky')
    } finally {
      await again.app.close()
    }
  } finally {
    rmSync(dirname(vault), { recursive: true, force: true })
  }
})

test('首页 A / B：设置里切换；A 有封面长条和工具栏，B 封面铺满首页、没有工具栏、组件是玻璃', async () => {
  const run = await launch(files)
  const { page, userData } = run
  try {
    const home = page.getByTestId('home')
    await expect(home).toHaveAttribute('data-style', 'a')
    await expect(tabOn(page)).toHaveText('首页')
    await expect(page.getByTestId('home-cover')).toHaveCSS('height', '220px')
    await expect(page.getByTestId('home-title')).toHaveText(/^(早上好|中午好|下午好|晚上好|夜深了)$/)
    await expect(page.locator('.wgrid > .wd')).toHaveCount(7)

    await openSettings(page, '外观')
    await settingsDialog(page).getByRole('radiogroup', { name: '首页样式' }).getByRole('radio', { name: /B · 整页背景/ }).click()
    await page.keyboard.press('Escape')
    await expect(home).toHaveAttribute('data-style', 'b')
    await expect(home.locator('.tool')).toHaveCount(0)
    await expect.poll(() => home.locator('.hscroll').evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('url(')
    await expect.poll(() => page.getByTestId('widget-week').evaluate((el) => getComputedStyle(el).backdropFilter)).toContain('blur')
    expect(settingsOf(userData).appearance.homeStyle).toBe('b')
    await page.screenshot({ path: test.info().outputPath('home-b.png') })

    await openSettings(page, '首页')
    await settingsDialog(page).getByRole('radio', { name: /A · 封面长图/ }).click()
    await page.keyboard.press('Escape')
    await expect(home).toHaveAttribute('data-style', 'a')
  } finally {
    await run.close()
  }
})

test('编辑首页：拖把手把梦游报告挪到最前，收起、放回、变宽；存在库里 .canvas-notes/首页.json，重开还是这样', async () => {
  const run = await launch(files)
  const { page, vault, userData } = run
  try {
    await page.getByRole('button', { name: '编辑首页' }).click()
    await expect(page.getByRole('button', { name: '完成' })).toBeVisible()
    const order = () => page.locator('.wgrid > .wd').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.widget))
    await expect.poll(order).toEqual(['cats', 'clock', 'week', 'inbox', 'boards', 'dream', 'wall'])

    // 按住梦游报告的把手，拖到时钟上松手：插到时钟前面（最前面是一整行「分类」，先把时钟那一行滚到上面）
    await page.getByTestId('widget-clock').evaluate((e) => e.scrollIntoView({ block: 'start' }))
    const grip = page.getByRole('button', { name: '拖动梦游报告' })
    const g = (await grip.boundingBox())!
    const c = (await page.getByTestId('widget-clock').boundingBox())!
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2)
    await page.mouse.down()
    await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2, { steps: 12 })
    await expect(page.getByTestId('widget-clock')).toHaveClass(/drop-before/)
    await page.mouse.up()
    await expect.poll(order).toEqual(['cats', 'dream', 'clock', 'week', 'inbox', 'boards', 'wall'])

    // 收起收件箱，抽屉里有它；放回最近写的；时钟变宽
    await page.getByTestId('widget-inbox').getByRole('button', { name: '收起' }).click()
    const tray = page.getByTestId('home-tray')
    await expect(tray.getByRole('button')).toHaveText(['最近写的', '随手翻一张', '收件箱'])
    await tray.getByRole('button', { name: '最近写的' }).click()
    await page.getByTestId('widget-clock').getByRole('button', { name: '变宽' }).click()
    await expect(page.getByTestId('widget-clock')).toHaveClass(/\bs2\b/)
    // 积累墙不能换大小
    await expect(page.getByTestId('widget-wall').getByRole('button', { name: /变宽|整行|变窄/ })).toHaveCount(0)
    await page.getByRole('button', { name: '完成' }).click()
    await expect(page.locator('.wgrip')).toHaveCount(0)

    await expect.poll(() => existsSync(homeFile(vault)) && JSON.parse(readFileSync(homeFile(vault), 'utf8'))).toMatchObject({
      order: ['cats', 'dream', 'clock', 'week', 'boards', 'wall', 'recent'],
      hidden: ['flip', 'inbox'],
      sizes: { clock: 2 },
    })

    await run.app.close()
    const again = await relaunch(vault, userData)
    try {
      const order2 = () => again.page.locator('.wgrid > .wd').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.widget))
      await expect.poll(order2).toEqual(['cats', 'dream', 'clock', 'week', 'boards', 'wall', 'recent'])
      await expect(again.page.getByTestId('widget-clock')).toHaveClass(/\bs2\b/)
    } finally {
      await again.app.close()
    }
  } finally {
    rmSync(dirname(vault), { recursive: true, force: true })
  }
})

test('换封面：自带的照片和渐变点一下就换；从电脑选或拖到封面上的图拷进库里 附件/封面/ 并显示出来；调整位置拖一下保存', async () => {
  const run = await launch(files)
  const { page, vault } = run
  const tmp = mkdtempSync(join(tmpdir(), 'cn-cover-'))
  // 2×2 的 PNG
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR42mP8z8DwnwEIGBkZGRgAAB0ABAEvYm5lAAAAAElFTkSuQmCC', 'base64')
  writeFileSync(join(tmp, '我的海.png'), png)
  try {
    const cover = page.getByTestId('home-cover')
    await expect(cover).toHaveAttribute('data-cover', 'aurora')
    await cover.hover()
    await page.getByRole('button', { name: '换封面' }).click()
    const gal = page.getByRole('dialog', { name: '换封面' })
    await gal.getByRole('button', { name: '冰河湖' }).click()
    await expect(cover).toHaveAttribute('data-cover', 'icebergs')
    await expect(gal).toBeVisible()
    await gal.getByRole('button', { name: '渐变' }).click()
    await gal.getByRole('button', { name: '李子暮色' }).click()
    await expect(cover).toHaveAttribute('data-cover', 'plum')
    await expect.poll(() => JSON.parse(readFileSync(homeFile(vault), 'utf8')).cover).toEqual({ kind: 'builtin', id: 'plum' })

    // 从电脑选：系统的选文件框换成直接给一张图
    await run.app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as typeof dialog.showOpenDialog
    }, join(tmp, '我的海.png'))
    await gal.getByRole('button', { name: '从电脑选' }).click()
    await expect(cover).toHaveAttribute('data-cover', '附件/封面/我的海.png')
    expect(readFileSync(join(vault, '附件', '封面', '我的海.png')).equals(png)).toBe(true)
    // 封面图真的读得出来（cn-file:// 读的是库里的文件）
    const size = await page.evaluate(async () => {
      const img = new Image()
      img.src = 'cn-file://vault/' + encodeURIComponent('附件') + '/' + encodeURIComponent('封面') + '/' + encodeURIComponent('我的海.png')
      await img.decode()
      return img.naturalWidth
    })
    expect(size).toBe(2)
    await page.keyboard.press('Escape')
    await expect(gal).toBeHidden()

    // 拖一张图到封面上（访达里拖进来的文件）
    await cover.evaluate((el, b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      const dt = new DataTransfer()
      dt.items.add(new File([bytes], '拖进来.png', { type: 'image/png' }))
      el.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }))
      el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
    }, png.toString('base64'))
    await expect(cover).toHaveAttribute('data-cover', '附件/封面/拖进来.png')
    expect(readFileSync(join(vault, '附件', '封面', '拖进来.png')).equals(png)).toBe(true)

    // 调整位置：往下拖，位置变小；保存后写进文件
    await cover.hover()
    await page.getByRole('button', { name: '调整位置' }).click()
    await expect(cover).toContainText('上下拖动图片，挑一个位置')
    const b = (await cover.boundingBox())!
    await page.mouse.move(b.x + b.width / 3, b.y + 100)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width / 3, b.y + 155, { steps: 6 })
    await page.mouse.up()
    await page.getByRole('button', { name: '保存位置' }).click()
    await expect.poll(() => JSON.parse(readFileSync(homeFile(vault), 'utf8')).coverY).toBe(62 - 25)
    // 首页设置跟着 Git 走：自动提交时一起提交
    await gitAct(page, '提交')
    await expect.poll(() => gitStatus(vault)).toBe('')
    expect(execFileSync('git', ['-C', vault, '-c', 'core.quotepath=false', 'ls-files'], { encoding: 'utf8' })).toContain('.canvas-notes/首页.json')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
    await run.close()
  }
})

test('设置页：⌘, 打开，改自动提交间隔马上生效（关掉就不提交，改成 5 分钟到点提交）', async () => {
  // 测试里一分钟 = 300ms：5 分钟 = 1.5 秒，默认 10 分钟 = 3 秒
  const run = await launch(files, { CN_MINUTE_MS: '300' })
  const { page, vault, userData } = run
  try {
    await openSettings(page, 'Git和同步')
    const sel = settingsDialog(page).getByRole('combobox', { name: '自动提交' })
    await expect(sel).toHaveValue('10')
    await sel.selectOption('0')
    await expect.poll(() => settingsOf(userData).autoCommitMinutes).toBe(0)

    writeFileSync(join(vault, '外面写的.md'), '别的软件写进来的\n')
    await page.waitForTimeout(4000)
    expect(gitStatus(vault)).not.toBe('')

    await sel.selectOption('5')
    await expect.poll(() => gitStatus(vault), { timeout: 10_000 }).toBe('')
    expect(settingsOf(userData).autoCommitMinutes).toBe(5)
    expect(await page.evaluate(async () => (await window.cn.gitState()).autoCommitMinutes)).toBe(5)

    // 远程地址：只改本机配置
    await settingsDialog(page).getByRole('textbox', { name: '远程地址' }).fill('https://example.com/me/notes.git')
    await settingsDialog(page).getByRole('button', { name: '保存' }).click()
    const remoteUrl = () => {
      try {
        return execFileSync('git', ['-C', vault, 'remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
      } catch {
        return ''
      }
    }
    await expect.poll(remoteUrl).toBe('https://example.com/me/notes.git')

    // 快捷键页
    await settingsDialog(page).getByRole('button', { name: '快捷键', exact: true }).click()
    await expect(settingsDialog(page).locator('[data-row="kQuick"]')).toContainText('速记')
    await expect(settingsDialog(page).locator('[data-row="kQuick"]')).toContainText('⌥⌘N')
    await expect(settingsDialog(page).locator('[data-row="k-cmd-ask-ai"]')).toContainText('⌘J')
    await page.keyboard.press('Meta+,')
    await expect(settingsDialog(page)).toBeHidden()
  } finally {
    await run.close()
  }
})

test('设置页：AI 默认引擎和 AI 浮窗是同一个；库页能换到别的文件夹，旧库没提交的先提交', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  const other = join(dirname(vault), '另一个库')
  mkdirSync(other)
  writeFileSync(join(other, '别处.md'), '# 别处\n')
  try {
    await openSettings(page, 'AI')
    await settingsDialog(page).getByTestId('ai-default-pick').click()
    await page.getByRole('menu', { name: '默认用哪一家' }).getByRole('menuitemradio', { name: /Codex/ }).click()
    await expect(settingsDialog(page).getByTestId('ai-default')).toContainText('Codex')
    await page.keyboard.press('Escape')
    await page.getByRole('navigation', { name: '右栏' }).getByRole('button', { name: '打开 AI' }).click()
    await expect(page.getByRole('complementary', { name: 'AI 对话' }).getByTestId('ai-engine')).toHaveText('Codex')
    await page.keyboard.press('Meta+j')

    writeFileSync(join(vault, '没提交的.md'), '还没提交\n')
    await expect(page.locator('.nav .si', { hasText: '没提交的' })).toHaveCount(1)
    await openSettings(page, '库')
    await expect(settingsDialog(page)).toContainText('测试库')
    await run.app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir] })) as typeof dialog.showOpenDialog
    }, other)
    await settingsDialog(page).getByRole('button', { name: '打开别的文件夹…' }).click()
    await expect(page.locator('.vault b')).toHaveText('另一个库')
    await expect(page.locator('.nav .si', { hasText: '别处' })).toHaveCount(1)
    expect(gitStatus(vault)).toBe('')
    expect(existsSync(join(other, '.git'))).toBe(true)
  } finally {
    await run.close()
  }
})

test('速记小卡跟着主窗口的主题', async () => {
  const run = await launch(files)
  const { app, page } = run
  try {
    await openSettings(page, '外观')
    await settingsDialog(page).getByRole('switch', { name: '跟着系统换浅深' }).click()
    await settingsDialog(page).locator('[data-skin-card="petrol"]').click()
    await expect(page.locator('html')).toHaveAttribute('data-skin', 'petrol')
    type QuickHook = { show(): Promise<void> }
    const [w] = await Promise.all([app.waitForEvent('window'), app.evaluate(() => (globalThis as unknown as { cnQuick: QuickHook }).cnQuick.show())])
    await expect(w.locator('html')).toHaveAttribute('data-skin', 'petrol')
    await w.screenshot({ path: test.info().outputPath('quick-petrol.png') })
  } finally {
    await run.close()
  }
})
