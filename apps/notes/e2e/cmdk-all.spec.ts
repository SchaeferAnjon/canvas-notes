/**
 * ⌘K 不打字也找得到每一条命令（task-xy89o）：用户截图「搜书桌有存成书桌，直接 ⌘K 往下翻没有」。
 * 1. 「书桌」一组没有书桌时也在、只有「存成书桌…」，点了真能存；存了以后书桌在前、「存成书桌…」在最后。
 * 2. 遍历命令表：进 ⌘K 的每一条（有 home 的）不打字时要么在某一组、要么在「更多命令 ›」点开的里面、要么是只在某个场合才有（SCENE 写着哪个场合）；
 *    不进 ⌘K 的（没有 home）都在 KEY_ONLY 里写着为什么。都是真按 ⌘K、真点。
 */
import { expect, type Page, test } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { KEYMAP } from '../src/shared/cmd-table'
import { launch, openNote } from './app'

const FILES = {
  '写作/读书计划.md': '# 读书计划\n\n这周读完第二章。\n',
  '收件箱/第一条.md': '# 第一条\n\n剪来的。\n',
}

/** 只在某个场合才有的（App.tsx 里带条件的那几条）：场合 */
const SCENE: Record<string, string> = {
  'mm-fold-all': '开着导图白板时（NoteTab 的 useMapCommands 登记）',
  'mm-unfold-all': '开着导图白板时（NoteTab 的 useMapCommands 登记）',
  'mm-export': '开着导图白板时（NoteTab 的 useMapCommands 登记）',
  notes: '读 PDF 时（右栏「读PDF时的笔记」那一格有东西）',
  rename: '当前标签能改名（笔记、白板、PDF）',
  'toggle-view': '中间开着笔记',
  'pair-web': '中间开着笔记、右栏开着网页',
  'web-address': '右栏网页开着',
  'web-reload': '右栏网页开着',
  'web-top-fold': '右栏网页开着',
  'web-bookmarks-bar': '右栏网页开着',
  'cards-pdf': '读过 PDF（问过 AI）',
  'cards-course': '开着课程首页或读过这门课的 PDF',
}

/**
 * 不进 ⌘K 的（命令表里没有 home）：只按键才说得通，在它自己的地方按。
 * 在哪儿能按（area）是文档里、⌘K 里、网页里、目录树里、视频、梦游、导图里、固定的键的，本来就只在那一处按（设置 › 快捷键里列着）；
 * 「软件里」「在任何软件里」的写在这里
 */
/** ⌘K 里的名字跟着状态换、不是命令表里那个名字的：画的是这几个之一 */
const NAMED: Record<string, string[]> = {
  'split-center': ['向右分屏', '合成一格'], // 命令表里叫「分屏 / 合成一格」（中间栏分屏）
}

const KEY_AREAS = new Set(['editor', 'palette', 'page', 'tree', 'video', 'dream', 'mindmap', 'fixed'])
const KEY_ONLY: Record<string, string> = {
  'todo-when': '文档、白板卡里光标在一行待办上、待办详情小卡开着时按，弹那一行的定日子和时间选择器（pd289-when 真按）',
  'quick-note': '全局键，软件没在前面时也能按',
  search: '就是 ⌘K 自己',
  'zoom-in': '白板、PDF 上按；别处是系统的放大整个窗口',
  'zoom-out': '同上',
  'zoom-reset': '同上',
  'zoom-fit': '白板、PDF 上按',
  'board-inbox': '白板上按（标签条「收件箱」那个弹窗有按钮）',
  quote: 'AI 回答里选了字、PDF 上框着一块时按（那里有「引用」按钮）',
  'ask-page': 'PDF、HTML 上按（那里有「问这一页」按钮）',
  translate: '双语翻译插件自己给 ⌘K 一条（插件开着才有，在「网页」）',
  'pane-1': '中间分成两格时按，跳到左边（上面）那一格（点那一格也是）；没分时没有这一格（中间栏分屏）',
  'pane-2': '中间分成两格时按，跳到右边（下面）那一格；没分时就是向右分屏，⌘K 里有「向右分屏」（中间栏分屏）',
  'ai-follow': '从 AI 回答里 ⌘点开一篇以后右栏还在原来那段对话时按（右栏头上那颗「切到《X》的 AI」按钮是同一件事，3e53q-kinds 真按）',
}

const pal = (page: Page) => page.getByRole('dialog', { name: '搜索和命令' })
const input = (page: Page) => pal(page).getByRole('textbox', { name: '搜索笔记、输入网址或命令' })
const sec = (page: Page, g: string) => pal(page).locator(`.pal-sec[data-g="${g}"]`)
const rowNames = (page: Page, g: string) => sec(page, g).locator('.pal-row .nm').allTextContents()

async function openPal(page: Page) {
  await page.keyboard.press('Meta+k')
  await expect(input(page)).toBeFocused()
  await expect(input(page)).toHaveValue('')
}

test('⌘K 不打字：「书桌」一组没有书桌时也有「存成书桌…」，往下翻点它真能存；存了以后书桌在前、它在最后', async () => {
  const run = await launch(FILES)
  const { page, vault } = run
  try {
    await openNote(page, '读书计划')
    await openPal(page)
    // 组的先后：钉住的、书桌、最近打开……最后是收成一行的「更多命令」
    await expect(pal(page).locator('.pal-sec > .pal-g')).toHaveText(['钉住的', '书桌', '最近打开', '去哪', '新建和导入', '让AI做', '网页', '库和同步', '设置和外观'])
    expect(await rowNames(page, 'desks')).toEqual(['存成书桌…'])
    // 新建和导入里不再有它（只在书桌一组）
    expect(await rowNames(page, 'new')).not.toContain('存成书桌…')
    // 往下翻：用 ↓ 一行行走到它（用户的走法）
    const all = await pal(page).locator('.pal-row').allTextContents()
    const at = all.findIndex((x) => x.startsWith('存成书桌…'))
    for (let i = 0; i < at; i++) await page.keyboard.press('ArrowDown')
    await expect(pal(page).locator('.pal-row.on .nm')).toHaveText('存成书桌…')
    await expect(pal(page).locator('.pal-row.on .lc')).toHaveText('记下现在这一整套')
    await page.keyboard.press('Enter')
    const dlg = page.getByRole('dialog', { name: '存成书桌' })
    await expect(dlg).toBeVisible()
    await dlg.getByRole('textbox', { name: '书桌的名字' }).fill('写作')
    await dlg.getByRole('button', { name: '存成书桌', exact: true }).click()
    await expect(dlg).toHaveCount(0)
    const file = join(vault, '.canvas-notes/书桌/写作.json')
    await expect.poll(() => existsSync(file)).toBe(true)
    expect((JSON.parse(readFileSync(file, 'utf8')) as { notes: string[] }).notes).toEqual(['写作/读书计划.md'])

    await openPal(page)
    expect(await rowNames(page, 'desks')).toEqual(['书桌：写作', '存成书桌…'])
    // 鼠标点「存成书桌…」也开那张表
    await sec(page, 'desks').locator('.pal-row', { hasText: '存成书桌…' }).click()
    await expect(dlg).toBeVisible()
    await page.keyboard.press('Escape')
  } finally {
    await run.close()
  }
})

test('遍历命令表：进 ⌘K 的每一条不打字时找得到（某一组、「更多命令 ›」里、或只在某个场合）；不进 ⌘K 的都写着为什么', async () => {
  test.setTimeout(120_000)
  // 界面语言那一条只在能换语言时有（还没放出来，CN_LANG_SWITCH=1 打开）
  const run = await launch(FILES, { CN_LANG_SWITCH: '1' })
  const { page } = run
  try {
    // 场合：中间开着笔记、右栏开着网页（右栏网页那几条才有）
    await openNote(page, '读书计划')
    await openPal(page)
    await input(page).fill('打开网页')
    await pal(page).locator('.pal-row', { has: page.locator('.nm', { hasText: /^打开网页$/ }) }).first().click()
    await expect(page.locator('.web')).toBeVisible()

    await openPal(page)
    // 「更多命令 ›」收成一行写几条，点开才列出来
    const more = sec(page, 'more').locator('.pal-row.allcmds')
    await expect(more.locator('.nm')).toHaveText('更多命令')
    await expect(more.locator('.lc')).toHaveText(/^\d+ 条$/)
    const n = Number((await more.locator('.lc').textContent())!.replace(/\D/g, ''))
    await expect(sec(page, 'more').locator('.pal-row')).toHaveCount(1)
    // 和别的行一样：图标左边对齐、36 高
    const iconX = async (sel: string) => (await pal(page).locator(sel).locator('.i, svg').first().boundingBox())!.x
    expect(Math.round(await iconX('.pal-row.allcmds'))).toBe(Math.round(await iconX('.pal-row.add:not(.allcmds)')))
    expect(Math.round((await more.boundingBox())!.height)).toBe(36)
    await more.click()
    await expect(more).toHaveAttribute('aria-expanded', 'true')
    await expect(sec(page, 'more').locator('.pal-row')).toHaveCount(n + 1)
    const inMore = (await rowNames(page, 'more')).slice(1)
    const everywhere = await pal(page).locator('.pal-sec .pal-row .nm').allTextContents()
    await page.screenshot({ path: 'test-results/cmdk-all-more.png' })

    const missing: string[] = []
    for (const d of KEYMAP) {
      if (!d.home) {
        if (!KEY_ONLY[d.id] && !KEY_AREAS.has(d.area)) missing.push(`${d.id}（${d.name}）没有 home，也没写在 KEY_ONLY`)
        continue
      }
      expect(KEY_ONLY[d.id], `${d.id} 有 home 就别写在 KEY_ONLY`).toBeUndefined()
      if (everywhere.includes(d.name)) continue
      if (NAMED[d.id]?.some((n) => everywhere.includes(n))) continue
      if (SCENE[d.id]) continue
      missing.push(`${d.id}（${d.name}）不打字找不到`)
    }
    expect(missing).toEqual([])
    // 这次的场合（中间开着笔记、右栏开着网页）该有的都在
    for (const id of ['toggle-view', 'rename', 'web-address', 'web-reload', 'web-top-fold', 'web-bookmarks-bar']) expect(everywhere, id).toContain(KEYMAP.find((d) => d.id === id)!.name)
    // 补进组里的几条在它该在的那组
    expect(await rowNames(page, 'new')).toContain('新建文件夹')
    expect(await rowNames(page, 'web')).toContain('新网页标签')
    expect(await rowNames(page, 'app')).toEqual(expect.arrayContaining(['快捷键设置', '界面语言', '设置 › 读PDF › 出卡']))
    expect(inMore).toEqual(expect.arrayContaining(['后退', '前进', '收起 / 展开左栏', '左栏：书桌', '找文件', '大纲', '关掉', '新对话', '白板 / 文档切换', '地址栏']))

    // 点「更多命令」里的一条真跑：左栏换到书桌
    await sec(page, 'more').locator('.pal-row', { has: page.locator('.nm', { hasText: /^左栏：书桌$/ }) }).click()
    await expect(pal(page)).toHaveCount(0)
    await expect(page.locator('aside.side[aria-label="书桌"]')).toBeVisible()

    // 从「更多命令」钉住一条：出来到钉住的，「更多命令」少一条
    await openPal(page)
    await sec(page, 'more').locator('.pal-row.allcmds').click()
    const back = sec(page, 'more').locator('.pal-row', { has: page.locator('.nm', { hasText: /^后退$/ }) })
    await back.hover()
    await back.locator('.pal-more').click()
    await page.getByRole('menuitem', { name: /钉住/ }).click()
    expect(await rowNames(page, 'pin')).toContain('后退')
    await expect(sec(page, 'more').locator('.pal-row.allcmds .lc')).toHaveText(`${n - 1} 条`)
  } finally {
    await run.close()
  }
})
