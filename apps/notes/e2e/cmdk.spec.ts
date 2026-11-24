/**
 * ⌘K 就地改（cmdk 方案方向 A，DESIGN.v3 第 3 节，task-vcov6）：没打字时八组、钉住、藏起再放回、拖着换组、撤回、
 * 起别名后搜别名排第一、设快捷键（撞了说撞了谁）、自己加的命令；快捷键和别名重开软件还在。都是真点、真拖、真按键。
 */
import { expect, type Locator, type Page, test } from '@playwright/test'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, type Running } from './app'

const FILES = {
  '收件箱/第一条.md': '# 第一条\n\n剪藏来的网页先放这里。\n',
  '写作/同步和备份怎么做.md': '# 同步和备份怎么做\n\nGit 推到远程仓库，每晚自动同步一次。\n',
  '写作/草稿.md': '# 草稿\n\n还没写完。\n',
  '课程/ecp/Lecture05 笔记.md': '# Lecture05 笔记\n\n第3讲的字幕和视频对不上，记下时间点再同步一次。\n',
}

const pal = (page: Page) => page.getByRole('dialog', { name: '搜索和命令' })
const input = (page: Page) => pal(page).getByRole('textbox', { name: '搜索笔记、输入网址或命令' })
/** 没打字时某一组 */
const sec = (page: Page, name: string) => pal(page).locator('.pal-sec').filter({ has: page.locator('.pal-g', { hasText: new RegExp(`^${name}$`) }) })
/** 一组里的命令名字 */
const names = (s: Locator) => s.locator('.pal-row .nm').allTextContents()
const row = (page: Page, name: string) => pal(page).locator('.pal-row').filter({ has: page.locator('.nm', { hasText: new RegExp(`^${name}$`) }) }).first()
const toast = (page: Page) => pal(page).locator('.pal-toast')
const menu = (page: Page) => page.getByRole('menu').filter({ has: page.locator('.pal-mhead') })
const cmdsJson = (run: Running) => JSON.parse(readFileSync(join(run.vault, '.canvas-notes/命令.json'), 'utf8')) as Record<string, unknown>

async function openPal(page: Page) {
  await page.keyboard.press('Meta+k')
  await expect(input(page)).toBeFocused()
}

test('⌘K 没打字时八组、组间横线；钉住、藏起再从「藏着的」放回、拖一条换组、每次改完能撤回', async () => {
  const run = await launch(FILES)
  const { page } = run
  try {
    await openPal(page)
    // 八组，组名写在横线下面
    await expect(pal(page).locator('.pal-sec > .pal-g')).toHaveText(['钉住的', '书桌', '最近打开', '去哪', '新建和导入', '让AI做', '网页', '库和同步', '设置和外观'])
    const line = await pal(page).locator('.pal-sec').nth(1).evaluate((e) => getComputedStyle(e).borderTopWidth + ' ' + getComputedStyle(e).borderTopStyle)
    expect(line).toBe('1px solid')
    expect(await names(sec(page, '钉住的'))).toEqual(['新建笔记', '问AI', '按名字跳到…'])
    expect(await names(sec(page, '库和同步'))).toEqual(['现在提交', '同步', '看历史', '找重复'])
    // 输入条 60 高、17px；面板 680 宽
    expect((await pal(page).locator('.pal-in').boundingBox())!.height).toBe(60)
    expect(await input(page).evaluate((e) => getComputedStyle(e).fontSize)).toBe('17px')
    expect(Math.round((await pal(page).boundingBox())!.width)).toBe(680)
    // 底部提示
    await expect(pal(page).locator('.pal-foot')).toHaveText('↑↓ 选择 · ↵ 打开 · ⌘. 这一条能做什么 · ⌘↵ 网页搜 · ⌥↵ 让Claude找 · esc 关闭')

    // 文件夹首页收成一行，点开才一个个列出来
    const folders = row(page, '文件夹首页')
    await expect(folders.locator('.lc')).toHaveText(/^\d+ 个$/)
    await expect(pal(page).locator('.pal-row.child')).toHaveCount(0)
    await folders.click()
    await expect(pal(page).locator('.pal-row.child').first()).toBeVisible()
    expect(await pal(page).locator('.pal-row.child .nm').allTextContents()).toContain('写作 首页')
    await folders.click()
    await expect(pal(page).locator('.pal-row.child')).toHaveCount(0)

    // 指着「同步」出 ⋯，点开菜单「钉住」
    const sync = row(page, '同步')
    await sync.hover()
    await expect(sync.locator('.pal-more')).toBeVisible()
    await sync.locator('.pal-more').click()
    await expect(menu(page)).toBeVisible()
    await expect(menu(page).locator('.pal-mhead')).toHaveText('同步')
    await expect(menu(page).getByRole('menuitem')).toHaveText(['钉住⌘P', '挪到', '设快捷键…', '起别名…', '藏起⌘⌫'])
    await page.screenshot({ path: 'test-results/cmdk-menu.png' })
    await menu(page).getByRole('menuitem', { name: /钉住/ }).click()
    await expect(toast(page)).toContainText('钉住了「同步」，没打字时排在最上面')
    expect(await names(sec(page, '钉住的'))).toEqual(['新建笔记', '问AI', '按名字跳到…', '同步'])
    expect(await names(sec(page, '库和同步'))).toEqual(['现在提交', '看历史', '找重复'])
    await expect.poll(() => (cmdsJson(run).groups as { id: string; items: string[] }[]).find((g) => g.id === 'pin')?.items).toEqual(['new-note', 'ask-ai', 'goto', 'sync'])
    // 撤回
    await toast(page).getByRole('button', { name: '撤回' }).click()
    await expect(toast(page)).toHaveCount(0)
    expect(await names(sec(page, '钉住的'))).toEqual(['新建笔记', '问AI', '按名字跳到…'])
    expect(await names(sec(page, '库和同步'))).toEqual(['现在提交', '同步', '看历史', '找重复'])

    // 右键「归档」藏起：列表里没了，最下面「藏着的 1 条」点开能放回
    await row(page, '归档').click({ button: 'right' })
    await menu(page).getByRole('menuitem', { name: /藏起/ }).click()
    await expect(toast(page)).toContainText('藏起了「归档」，打字搜照样找得到')
    expect(await names(sec(page, '去哪'))).not.toContain('归档')
    const hidden = row(page, '藏着的 1 条')
    await hidden.click()
    const put = pal(page).locator('.pal-row.hid')
    await expect(put.locator('.nm')).toHaveText('归档')
    // 打字搜照样找得到，后面标「藏着的」
    await input(page).fill('归档')
    await expect(pal(page).locator('.pal-row').filter({ hasText: '归档' }).first().locator('.pal-tag')).toHaveText('藏着的')
    await input(page).fill('')
    await row(page, '藏着的 1 条').click()
    await pal(page).locator('.pal-row.hid').getByRole('button', { name: '放回' }).click()
    await expect(toast(page)).toContainText('放回了「归档」')
    expect(await names(sec(page, '去哪'))).toContain('归档')
    await expect(row(page, '藏着的 1 条')).toHaveCount(0)

    // 按住「找重复」左边的把手拖到「让AI做」
    const dup = row(page, '找重复')
    await dup.scrollIntoViewIfNeeded()
    await dup.hover()
    const grip = (await dup.locator('.pal-grip').boundingBox())!
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
    await page.mouse.down()
    await page.mouse.move(grip.x + 4, grip.y - 30, { steps: 4 })
    const article = row(page, '写成文章')
    await article.scrollIntoViewIfNeeded()
    const a = (await article.boundingBox())!
    await page.mouse.move(a.x + 120, a.y + a.height - 6, { steps: 8 })
    await expect(page.locator('.pal-dragrow')).toBeVisible()
    await expect(page.locator('.pal-dropline')).toBeVisible()
    // 落点横线画在列表里面，不画到面板外面（设计复审）
    const lb = (await page.locator('.pal-dropline').boundingBox())!
    const listBox = (await pal(page).locator('.pal-list').boundingBox())!
    expect(lb.y).toBeGreaterThanOrEqual(listBox.y - 1)
    expect(lb.y + lb.height).toBeLessThanOrEqual(listBox.y + listBox.height + 1)
    await page.screenshot({ path: 'test-results/cmdk-drag.png' })
    await page.mouse.up()
    await expect(toast(page)).toContainText('「找重复」挪到了「让AI做」')
    expect(await names(sec(page, '让AI做'))).toEqual(['整理收件箱', '总结这块白板', '写成文章', '找重复', '现在梦游'])
    expect(await names(sec(page, '库和同步'))).toEqual(['现在提交', '同步', '看历史'])
    // 指着哪一行就选中哪一行：⌘. 打开它的菜单；⌘P 钉住 / 取消钉住它
    await row(page, '新建笔记').hover()
    await expect(row(page, '新建笔记')).toHaveClass(/\bon\b/)
    await input(page).press('Meta+.')
    await expect(menu(page).locator('.pal-mhead')).toHaveText('新建笔记')
    await page.keyboard.press('Escape')
    await expect(menu(page)).toHaveCount(0)
    await expect(pal(page)).toBeVisible()
    await expect(input(page)).toBeFocused()
    await input(page).press('Meta+p')
    await expect(toast(page)).toContainText('取消钉住「新建笔记」')
    expect(await names(sec(page, '钉住的'))).toEqual(['问AI', '按名字跳到…'])
    expect((await names(sec(page, '新建和导入')))[0]).toBe('新建笔记')
    await toast(page).getByRole('button', { name: '撤回' }).click()
    expect(await names(sec(page, '钉住的'))).toEqual(['新建笔记', '问AI', '按名字跳到…'])
  } finally {
    await run.close()
  }
})

test('起别名后搜别名排第一；设快捷键撞了别的命令说撞了谁，换过来；软件自己的键不给；重开软件别名和快捷键还在', async () => {
  const run = await launch(FILES)
  const { page } = run
  let second: Running | null = null
  let closed = false
  try {
    await openPal(page)
    // 起别名
    await row(page, '同步').click({ button: 'right' })
    await menu(page).getByRole('menuitem', { name: /起别名/ }).click()
    const alias = page.getByRole('dialog', { name: '别名' })
    await expect(alias).toContainText('给「同步」起个别名：打全它，这一条排第一')
    await alias.getByRole('textbox').fill('tb')
    await alias.getByRole('textbox').press('Enter')
    await expect(toast(page)).toContainText('打「tb」就是「同步」')
    await expect(row(page, '同步').locator('.pal-alias')).toHaveText('tb')
    await input(page).fill('tb')
    await expect(pal(page).locator('.pal-g').first()).toHaveText('最合适')
    await expect(pal(page).locator('.pal-row').first().locator('.nm')).toHaveText('同步')
    await expect(pal(page).locator('.pal-row').first()).toHaveClass(/\bon\b/)
    // 有命令对上时不说「笔记和PDF里都没有」（设计复审）
    await page.waitForTimeout(400)
    await expect(pal(page).locator('.pal-none')).toHaveCount(0)
    await input(page).fill('')

    // 设快捷键：按 ⌘N，说已经给了新建笔记；按「好」换过来
    await row(page, '同步').click({ button: 'right' })
    await menu(page).getByRole('menuitem', { name: /设快捷键/ }).click()
    const keys = page.getByRole('dialog', { name: '设快捷键' })
    await expect(keys).toContainText('给「同步」设快捷键（软件开着时在哪都能按）')
    await expect(keys.locator('.keys')).toHaveText('现在按下组合键…')
    await expect(keys.getByRole('button', { name: '好' })).toBeDisabled()
    // 系统的键：不给（软件自己的命令都在命令表里能改，⌘W 是「关掉」，撞了说撞了谁，见下面 ⌘N）
    await page.keyboard.press('Meta+q')
    await expect(keys.locator('.keys')).toHaveText('⌘Q')
    await expect(keys.locator('.why')).toHaveText('⌘Q 是退出，换一个')
    await expect(keys.getByRole('button', { name: '好' })).toBeDisabled()
    // 按 ⌘N 不会新建笔记（键只记在这里）
    await page.keyboard.press('Meta+n')
    await expect(keys.locator('.keys')).toHaveText('⌘N')
    await expect(keys.locator('.why')).toHaveText('已经给了「新建笔记」，按「好」就换给这一条')
    await page.screenshot({ path: 'test-results/cmdk-keys-clash.png' })
    await keys.getByRole('button', { name: '好' }).click()
    await expect(toast(page)).toContainText('「同步」的快捷键是 ⌘N')
    await expect(row(page, '同步').locator('kbd')).toHaveText('⌘N')
    await expect(row(page, '新建笔记').locator('kbd')).toHaveCount(0)
    // 再换成 ⌥⌘S
    await row(page, '同步').click({ button: 'right' })
    await menu(page).getByRole('menuitem', { name: /设快捷键/ }).click()
    await page.keyboard.press('Alt+Meta+KeyS')
    await expect(keys.locator('.keys')).toHaveText('⌥⌘S')
    await expect(keys.locator('.why')).toHaveCount(0)
    await keys.getByRole('button', { name: '好' }).click()
    await expect(row(page, '同步').locator('kbd')).toHaveText('⌥⌘S')
    // 命令.json 排队原子写（@cn/atomic writeQueued），界面先变、盘上后到：等它写好
    await expect.poll(() => cmdsJson(run).keys).toEqual({ sync: '⌥⌘S', 'new-note': '' })
    expect(cmdsJson(run).alias).toEqual({ sync: 'tb' })
    // 文件里只有该有的几样（界面那份的 web、rest 不能混进来，一写一层）
    expect(Object.keys(cmdsJson(run)).sort()).toEqual(['alias', 'keys', 'version'])
    await page.keyboard.press('Escape')
    await expect(pal(page)).toHaveCount(0)

    // 在主窗口按 ⌥⌘S：跑同步（这个库没有远程仓库，底部说同步不了）
    await page.keyboard.press('Alt+Meta+KeyS')
    await expect(page.locator('.toast-cn')).toContainText('这个库还没有远程仓库')
    // ⌘N 已经给出去了：不再新建笔记
    const before = await page.evaluate(() => document.querySelectorAll('[data-testid="tab-on"]').length)
    await page.keyboard.press('Meta+n')
    await page.waitForTimeout(400)
    expect(existsSync(join(run.vault, '收件箱/未命名.md'))).toBe(false)
    expect(await page.evaluate(() => document.querySelectorAll('[data-testid="tab-on"]').length)).toBe(before)

    // 重开软件：别名、快捷键还在
    const { vault, userData } = run
    await run.close({ keep: true })
    closed = true
    // launch 总会另建一个临时库（要有一个文件才提交得上）；CN_VAULT、CN_USER_DATA 指回刚才那个库和设置目录
    second = await launch({ '占位.md': '# 占位\n' }, { CN_VAULT: vault, CN_USER_DATA: userData })
    const p2 = second.page
    await openPal(p2)
    await input(p2).fill('tb')
    await expect(pal(p2).locator('.pal-row').first().locator('.nm')).toHaveText('同步')
    await expect(pal(p2).locator('.pal-row').first().locator('kbd')).toHaveText('⌥⌘S')
    await p2.keyboard.press('Escape')
    await p2.keyboard.press('Alt+Meta+KeyS')
    await expect(p2.locator('.toast-cn')).toContainText('这个库还没有远程仓库')
  } finally {
    if (second) await second.close()
    if (!closed) await run.close()
    else rmSync(dirname(run.vault), { recursive: true, force: true })
  }
})

test('加一条自己的命令（打开一处）：放进钉住的，点了打开那个文件夹；存在库里的 命令.json', async () => {
  const run = await launch(FILES)
  const { page } = run
  try {
    await openPal(page)
    await row(page, '加一条自己的命令…').click()
    const form = pal(page).getByRole('form', { name: '加一条自己的命令' })
    await expect(form).toBeVisible()
    await expect(pal(page).locator('.pal-foot')).toHaveText('esc 回到列表 · ⌘↵ 加上')
    // 选中的输入框边框换成强调色（设计复审）
    const target = form.getByRole('textbox', { name: '打开哪里' })
    await expect(target).toBeFocused()
    const ring = await target.evaluate((e) => getComputedStyle(e).borderTopColor)
    const idle = await form.getByRole('textbox', { name: '名字' }).evaluate((e) => getComputedStyle(e).borderTopColor)
    expect(ring).not.toBe(idle)
    // 没填就加：说先填打开哪里
    await form.getByRole('button', { name: '加上' }).click()
    await expect(form.getByRole('alert')).toHaveText('先填打开哪里')
    await form.getByRole('textbox', { name: '打开哪里' }).fill('没有这个')
    await form.getByRole('textbox', { name: '名字' }).fill('打开没有')
    await form.getByRole('button', { name: '加上' }).click()
    await expect(form.getByRole('alert')).toHaveText('库里没有「没有这个」')
    await form.getByRole('textbox', { name: '名字' }).fill('')
    await form.getByRole('group', { name: '建议' }).getByRole('button', { name: '写作' }).click()
    await expect(form.getByRole('textbox', { name: '打开哪里' })).toHaveValue('写作')
    await expect(form.getByRole('textbox', { name: '名字' })).toHaveValue('打开 写作')
    await form.getByRole('textbox', { name: '别名' }).fill('xz')
    await page.screenshot({ path: 'test-results/cmdk-form.png' })
    await form.getByRole('button', { name: '加上' }).click()
    await expect(toast(page)).toContainText('加上了「打开 写作」')
    expect(await names(sec(page, '钉住的'))).toEqual(['新建笔记', '问AI', '按名字跳到…', '打开 写作'])
    const own = (cmdsJson(run).own as { name: string; kind: string; target: string }[])[0]!
    expect(own).toMatchObject({ name: '打开 写作', kind: 'open', target: '写作' })
    // 自己加的：菜单里多「改这条命令…」「删掉这条」
    await row(page, '打开 写作').click({ button: 'right' })
    await expect(menu(page).getByRole('menuitem')).toHaveText(['钉住⌘P'.replace('钉住', '取消钉住'), '挪到', '设快捷键…', '起别名…xz', '改这条命令…', '删掉这条', '藏起⌘⌫'])
    await page.keyboard.press('Escape')
    // 搜别名 xz：排第一，回车打开写作的首页
    await input(page).fill('xz')
    await expect(pal(page).locator('.pal-row').first().locator('.nm')).toHaveText('打开 写作')
    await input(page).press('Enter')
    await expect(pal(page)).toHaveCount(0)
    await expect(page.getByTestId('tab-on')).toContainText('写作')
  } finally {
    await run.close()
  }
})
