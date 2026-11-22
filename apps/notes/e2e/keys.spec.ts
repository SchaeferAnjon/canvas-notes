/**
 * 快捷键写了就能用、全部能自定义（task-spsmf）：
 * - ⇧⌘E 在编辑器、AI 输入框、网页、白板有焦点时都开关左栏「文件」（0.4.6 里提示写着 ⇧⌘E，按了没反应）；
 * - 命令表里「软件里」的命令照命令表的键，四种焦点下逐个真按都跑对；要看场合的（文档里、白板上、PDF 上、网页里）在场合里按；
 * - 改了键：提示、⌘K、设置、菜单栏跟着变，新键能用、旧键不再做事；没有默认键的命令设了键能用、重开还在；⌘K 里清掉、回到默认、两个对调。
 * 都是真按键：主窗口里用 Playwright 的键盘，网页里从主进程往网页送真的按键（Playwright 的键盘到不了 webview 里）。
 */
import { expect, type Page, test } from '@playwright/test'
import { readFileSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { dirname, join } from 'node:path'
import { accelOf } from '../src/shared/cmd-keys'
import { KEYMAP } from '../src/shared/cmd-table'
import { acts, editorText, launch, openAi, openNote, pane, type Running, tabOn, waitSaved } from './app'
import { LECTURE } from './fixtures/pdf'
import { CHECKS, CTXS, focusCtx, inWeb, KEY_FILES, type KeyRun, keysNow, openWeb, palette, press, pressInWeb, web } from './keys-checks'

let server: Server
let base: string

test.beforeAll(async () => {
  server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end('<title>测试网页</title><body style="font:16px sans-serif;padding:20px"><h1>测试网页</h1><p>A short paragraph for translating.</p><p>Another paragraph here.</p></body>')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
test.afterAll(() => server.close())

const left = (page: Page, name: string) => page.getByRole('navigation', { name: '左栏' }).getByRole('button', { name, exact: true })
const dlg = (page: Page) => page.getByRole('dialog', { name: '设置' })
const keyRow = (page: Page, id: string) => dlg(page).locator(`[data-row="k-cmd-${id}"]`)
const cmdsJson = (run: Running) => JSON.parse(readFileSync(join(run.vault, '.canvas-notes/命令.json'), 'utf8')) as { keys?: Record<string, string> }

/** 设置 › 快捷键：点这一条的键位，按一个新组合 */
async function setKeyInSettings(page: Page, id: string, name: string, pw: string) {
  if (!(await dlg(page).isVisible())) await page.keyboard.press('Meta+Comma')
  await dlg(page).getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: '快捷键', exact: true }).click()
  await keyRow(page, id).getByRole('button', { name: `改 ${name} 的快捷键` }).click()
  await expect(keyRow(page, id).getByRole('button', { name: `改 ${name} 的快捷键` })).toHaveText('按新的组合键…')
  await page.keyboard.press(pw)
}

/** 菜单栏上每一项现在显示的键（Electron 的写法） */
const menuAccels = (run: Running) =>
  run.app.evaluate(({ Menu }) => {
    const out: Record<string, string> = {}
    const walk = (m: Electron.Menu, path: string) => {
      for (const i of m.items) {
        if (i.type === 'separator') continue
        if (i.accelerator) out[path + i.label] = i.accelerator
        if (i.submenu) walk(i.submenu, `${path}${i.label} › `)
      }
    }
    walk(Menu.getApplicationMenu()!, '')
    return out
  })

test('⇧⌘E 在编辑器、AI 输入框、网页、白板有焦点时都开关左栏「文件」', async () => {
  const run = await launch(KEY_FILES)
  const { page } = run
  const k: KeyRun = { run, base }
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    const files = left(page, '文件')
    for (const ctx of CTXS) {
      await focusCtx(k, ctx)
      const was = await files.getAttribute('aria-pressed')
      await press(k, ctx, '⇧⌘E')
      await expect(files, ctx).toHaveAttribute('aria-pressed', was === 'true' ? 'false' : 'true')
      if (was === 'true') await expect(page.locator('.win')).toHaveClass(/side-hidden/)
      await press(k, ctx, '⇧⌘E')
      await expect(files, ctx).toHaveAttribute('aria-pressed', was ?? 'false')
    }
    // AI 输入框里按的不打出字
    await focusCtx(k, 'ai')
    await press(k, 'ai', '⇧⌘E')
    await expect(page.getByRole('textbox', { name: '问 AI' })).toHaveValue('')
  } finally {
    await run.close()
  }
})

/** 带默认键的全局命令里，不在四种焦点下逐个按、在下面按场合按的（写清在哪一条测） */
const IN_CONTEXT: Record<string, string> = {
  close: '文档里：⌘W 关标签；网页里：关网页标签',
  rename: '文档里：F2 改名',
  'toggle-view': '文档里：⌘E 切看法',
  'zoom-in': '白板上、PDF 上',
  'zoom-out': '白板上、PDF 上',
  'zoom-reset': '白板上、PDF 上',
  'zoom-fit': '白板上',
  'board-inbox': '白板上（8isml-inbox-pop 按 ⇧⌘I 开关收件箱弹窗、设置里改键）',
  'ask-page': '读 PDF（step13-pdf、r2-read-ai 等按 ⌘↵）',
  quote: 'AI 回答里选了字（r7-ai-input 按 ⇧⌘L）',
  'clip-page': '网页里',
  'web-address': '网页里',
  'web-reload': '网页里',
  translate: '网页里',
}

test('命令表里「软件里」的命令：照命令表的键，在编辑器、AI 输入框、网页、白板有焦点时逐个真按都跑对', async () => {
  test.setTimeout(420_000)
  const withKeys = KEYMAP.filter((d) => d.area === 'app' && !d.fixed && !d.store && d.keys?.length)
  // 每条都有人测：要么在这里四种焦点逐个按，要么在下面按场合的那几条里按
  expect(withKeys.filter((d) => !CHECKS[d.id] && !IN_CONTEXT[d.id]).map((d) => d.id)).toEqual([])
  const run = await launch(KEY_FILES)
  const { page } = run
  const k: KeyRun = { run, base }
  const done: string[] = []
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    // 先走过几个标签，后退有地方退
    await openNote(page, '第一条')
    for (const ctx of CTXS) {
      for (const d of withKeys) {
        const c = CHECKS[d.id]
        if (!c || (c.ctxs && !c.ctxs.includes(ctx))) continue
        for (const combo of await keysNow(page, d.id)) {
          await focusCtx(k, ctx)
          await test.step(`${ctx} · ${d.name} ${combo}`, () => c.check(k, ctx, () => press(k, ctx, combo), combo))
          done.push(`${ctx} ${d.id} ${combo}`)
        }
      }
    }
    console.log(`逐个按了 ${done.length} 下：\n${done.join('\n')}`)
    expect(done.length).toBeGreaterThanOrEqual(4 * 18)
  } finally {
    await run.close()
  }
})

test('文档里：⌘E 切白板、F2 改名、⌘W 关标签；加粗、斜体、高亮、加链接、复制这一块、上下挪、马上存盘照命令表；⌘[ 是后退不是缩进', async () => {
  const run = await launch(KEY_FILES)
  const { page } = run
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openNote(page, '第一条')
    await openNote(page, '草稿')
    const before = await editorText(page)
    const line = pane(page).locator('.cm-line', { hasText: '还没写完的一段。' })
    // 选中这一段
    const select = async () => {
      await line.click()
      await page.keyboard.press('End')
      await page.keyboard.press('Shift+Home')
    }
    const undo = async () => {
      await page.keyboard.press('Meta+z')
      await expect.poll(() => editorText(page)).toBe(before)
    }
    await select()
    await page.keyboard.press('Meta+b')
    await expect.poll(() => editorText(page)).toContain('**还没写完的一段。**')
    await undo()
    await select()
    await page.keyboard.press('Meta+i')
    await expect.poll(() => editorText(page)).toContain('*还没写完的一段。*')
    await undo()
    await select()
    await page.keyboard.press('Shift+Meta+KeyM')
    await expect.poll(() => editorText(page)).toContain('==还没写完的一段。==')
    await undo()
    // 选了字按 ⌘K 是加链接，搜索不出来
    await select()
    await page.keyboard.press('Meta+k')
    await expect.poll(() => editorText(page)).toContain('[还没写完的一段。](')
    await expect(palette(page)).toHaveCount(0)
    await undo()
    // ⌘D 复制这一块、⌥⇧↓ 往下挪、⌥⇧↑ 挪回来
    await line.first().click()
    await page.keyboard.press('Meta+d')
    await expect.poll(async () => (await editorText(page)).split('还没写完的一段。').length - 1).toBe(2)
    await undo()
    await line.click()
    await page.keyboard.press('Alt+Shift+ArrowDown')
    await expect.poll(async () => (await editorText(page)).indexOf('还没写完的一段。') > (await editorText(page)).indexOf('## 小标题')).toBe(true)
    await page.keyboard.press('Alt+Shift+ArrowUp')
    await expect.poll(() => editorText(page)).toBe(before)
    // ⌘S 马上存盘
    await line.click()
    await page.keyboard.press('End')
    await page.keyboard.type('又')
    await page.keyboard.press('Meta+s')
    await waitSaved(page)
    await expect.poll(() => readFileSync(join(run.vault, '写作/草稿.md'), 'utf8')).toContain('还没写完的一段。又')
    // ⌘[ 在文档里是后退（以前是 CodeMirror 的缩进）：回到「第一条」，字没变；⌘] 再回来
    const text = await editorText(page)
    await page.keyboard.press('Meta+BracketLeft')
    await expect(tabOn(page)).toHaveText('第一条')
    await page.keyboard.press('Meta+BracketRight')
    await expect(tabOn(page)).toHaveText('草稿')
    expect(await editorText(page)).toBe(text)
    // F2 改名（标签上出改名框），esc 不改
    await pane(page).locator('.cm-line', { hasText: '还没写完的一段。' }).click()
    await page.keyboard.press('F2')
    await expect(page.locator('.tab-rename')).toBeFocused()
    await page.keyboard.press('Escape')
    // ⌘E 切到白板，再按回到文档
    await pane(page).locator('.cm-line', { hasText: '还没写完的一段。' }).click()
    await page.keyboard.press('Meta+e')
    await expect(acts(page).getByRole('tab', { name: '白板' })).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Meta+e')
    await expect(acts(page).getByRole('tab', { name: '文档' })).toHaveAttribute('aria-selected', 'true')
    // ⌘W 关掉这个标签
    await pane(page).locator('.cm-content').click()
    await page.keyboard.press('Meta+w')
    await expect(tabOn(page)).not.toHaveText('草稿')
  } finally {
    await run.close()
  }
})

test('白板上：⌘= ⌘- ⌘0 ⇧⌘1 缩放（比例按钮上的数跟着变）；PDF 上 ⌘= ⌘- ⌘0 缩放（记在本机的比例跟着变）', async () => {
  const run = await launch({ ...KEY_FILES, '课程/线代/第3讲.pdf': LECTURE })
  const { page } = run
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openNote(page, '路线')
    await acts(page).getByRole('tab', { name: '白板' }).click()
    const zoom = pane(page).getByTestId('board-zoom')
    await expect(zoom).toBeVisible()
    const b = (await pane(page).getByTestId('doc-board').boundingBox())!
    await page.mouse.click(b.x + b.width - 30, b.y + b.height - 30)
    const pct = async () => Number((await zoom.locator('.num').textContent())!.replace('%', ''))
    const at = await pct()
    await page.keyboard.press('Meta+Equal')
    await expect.poll(pct).toBeGreaterThan(at)
    await page.keyboard.press('Meta+Minus')
    await page.keyboard.press('Meta+Minus')
    await expect.poll(pct).toBeLessThan(at)
    await page.keyboard.press('Meta+Digit0')
    await expect.poll(pct).toBe(at)
    await page.keyboard.press('Shift+Meta+Digit1')
    await expect.poll(pct).not.toBe(at)
    // 提示上写的是命令表里的键
    await expect(zoom).toHaveAttribute('data-key', '⌘= ⌘- ⌘0')

    // PDF
    await page.keyboard.press('Meta+o')
    await page.keyboard.type('第3讲')
    await page.keyboard.press('Enter')
    await expect(tabOn(page)).toHaveText('第3讲.pdf')
    await expect(pane(page).locator('canvas').first()).toBeVisible()
    const pdfZoom = () => page.evaluate(() => Number(localStorage.getItem('cn.pdfZoom:课程/线代/第3讲.pdf') ?? '1'))
    const z0 = await pdfZoom()
    await page.keyboard.press('Meta+Equal')
    await expect.poll(pdfZoom).toBeGreaterThan(z0)
    await page.keyboard.press('Meta+Minus')
    await page.keyboard.press('Meta+Minus')
    await expect.poll(pdfZoom).toBeLessThan(z0)
    await page.keyboard.press('Meta+Digit0')
    await expect.poll(pdfZoom).toBe(1)
  } finally {
    await run.close()
  }
})

test('右栏网页有焦点：⌘L 地址栏、⌘R 重新载入、⇧⌘S 剪藏这一页、⌥A 双语翻译（网页里的脚本接）、⌘T 新网页标签、⌘W 关网页标签', async () => {
  const run = await launch(KEY_FILES, { CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '100' })
  const { page } = run
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openWeb(page, `${base}/`)
    // ⌘L：焦点到地址栏
    await pressInWeb(run, '⌘L')
    await expect(web(page).getByRole('textbox', { name: '网址' })).toBeFocused()
    // ⌘R：网页重新载入（网页里放的记号没了）
    await inWeb(page, 'window.cnMark = 1')
    await pressInWeb(run, '⌘R')
    await expect.poll(() => inWeb(page, 'window.cnMark ?? null')).toBeNull()
    await expect.poll(() => inWeb(page, 'document.readyState')).toBe('complete')
    // ⇧⌘S：整页剪进收件箱
    await pressInWeb(run, '⇧⌘S')
    await expect(web(page).locator('.wnote')).toContainText('整页存进收件箱了')
    // ⌥A：网页里的脚本开关双语（假引擎），按钮亮、再按灭
    const tr = web(page).getByRole('button', { name: '双语翻译', exact: true })
    await pressInWeb(run, '⌥A')
    await expect(tr).toHaveAttribute('aria-pressed', 'true')
    await pressInWeb(run, '⌥A')
    await expect(tr).toHaveAttribute('aria-pressed', 'false')
    // ⌘T 新网页标签，⌘W 关掉它
    const tabs = web(page).getByRole('button', { name: '关闭网页标签' })
    const n = await tabs.count()
    await pressInWeb(run, '⌘T')
    await expect(tabs).toHaveCount(n + 1)
    await openWeb(page, `${base}/two`)
    await pressInWeb(run, '⌘W')
    await expect(tabs).toHaveCount(n)
  } finally {
    await run.close()
  }
})

test('改了键：提示、⌘K、设置、菜单栏都跟着变，新键能用、旧键不再做事', async () => {
  const run = await launch(KEY_FILES)
  const { page } = run
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    // 一开始：标题栏、活动栏、菜单栏写的都是命令表里默认的键
    await expect(page.getByRole('button', { name: '后退' })).toHaveAttribute('data-key', '⌘[')
    await expect(left(page, '文件')).toHaveAttribute('data-key', '⇧⌘E')
    await expect(left(page, '最近')).toHaveAttribute('data-key', '⇧⌘R')
    const menu = await menuAccels(run)
    const want: Record<string, string> = { '显示 › 左栏：文件': '⇧⌘E', '显示 › 左栏：最近': '⇧⌘R', '前往 › 后退': '⌘[', '前往 › 前进': '⌘]', '文件 › 新建白板': '⇧⌘N', '文件 › 关闭': '⌘W', '显示 › 白板 / 文档切换': '⌘E', '显示 › 历史': '⌘Y' }
    for (const [item, key] of Object.entries(want)) expect(menu[item], item).toBe(accelOf(key))
    // 菜单栏里没有会把整个软件重新载入的那两项（以前 ⇧⌘R 在这里）
    expect(Object.values(menu)).not.toContain('Shift+CmdOrCtrl+R')
    expect(Object.values(menu)).not.toContain('CmdOrCtrl+R')

    // 设置 › 快捷键：「左栏：文件」换成 ⌥⌘E
    await setKeyInSettings(page, 'left-files', '左栏：文件', 'Alt+Meta+KeyE')
    await expect(keyRow(page, 'left-files').locator('.sa-keyb')).toHaveText('⌥⌘E')
    await page.keyboard.press('Escape')
    await expect(dlg(page)).toHaveCount(0)
    expect(cmdsJson(run).keys).toEqual({ 'left-files': '⌥⌘E' })
    // 提示、菜单栏跟着变
    await expect(left(page, '文件')).toHaveAttribute('data-key', '⌥⌘E')
    await expect.poll(async () => (await menuAccels(run))['显示 › 左栏：文件']).toBe('Alt+Command+E')
    // ⌘K 里那一条写着新键
    await page.keyboard.press('Meta+k')
    await palette(page).getByRole('textbox').fill('左栏：文件')
    await expect(palette(page).locator('.pal-row').filter({ hasText: '左栏：文件' }).first().locator('kbd')).toHaveText('⌥⌘E')
    await page.keyboard.press('Escape')
    // 新键能用，旧键不再做事
    const files = left(page, '文件')
    const was = await files.getAttribute('aria-pressed')
    await page.keyboard.press('Shift+Meta+KeyE')
    await page.waitForTimeout(300)
    await expect(files).toHaveAttribute('aria-pressed', was ?? 'false')
    await page.keyboard.press('Alt+Meta+KeyE')
    await expect(files).toHaveAttribute('aria-pressed', was === 'true' ? 'false' : 'true')
  } finally {
    await run.close()
  }
})

test('没有默认键的命令（新建文件夹）在设置里设了键，真按就新建文件夹，关掉重开还在；⌘K 里清掉、回到默认、两个对调', async () => {
  const run = await launch(KEY_FILES)
  const { page } = run
  let second: Running | null = null
  let closed = false
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    await setKeyInSettings(page, 'new-folder', '新建文件夹', 'Control+Meta+KeyN')
    await expect(keyRow(page, 'new-folder').locator('.sa-keyb')).toHaveText('⌃⌘N')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Control+Meta+KeyN')
    const input = page.getByRole('textbox', { name: '新文件夹的名字' })
    await expect(input).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(input).toHaveCount(0)

    // 关掉重开：还在（重开的那个指回同一个库，命令.json 照旧读 run.vault 里的）
    const { vault, userData } = run
    await run.close({ keep: true })
    closed = true
    second = await launch({ '占位.md': '# 占位\n' }, { CN_VAULT: vault, CN_USER_DATA: userData })
    const p2 = second.page
    await p2.setViewportSize({ width: 1440, height: 900 })
    await p2.keyboard.press('Control+Meta+KeyN')
    await expect(p2.getByRole('textbox', { name: '新文件夹的名字' })).toBeFocused()
    await p2.keyboard.press('Escape')

    // ⌘K 里：右键那一条「设快捷键…」，清掉
    const row = (name: string) => palette(p2).locator('.pal-row').filter({ has: p2.locator('.nm', { hasText: new RegExp(`^${name}$`) }) }).first()
    const mini = p2.getByRole('dialog', { name: '设快捷键' })
    const keysMenu = async (name: string) => {
      if (!(await palette(p2).isVisible())) await p2.keyboard.press('Meta+k')
      await palette(p2).getByRole('textbox').fill(name)
      await row(name).click({ button: 'right' })
      await p2.getByRole('menu').filter({ has: p2.locator('.pal-mhead') }).getByRole('menuitem', { name: /设快捷键/ }).click()
      await expect(mini).toBeVisible()
    }
    await keysMenu('新建文件夹')
    await expect(mini.getByRole('button', { name: '回到默认：没有键' })).toBeVisible()
    await mini.getByRole('button', { name: '清掉', exact: true }).click()
    await expect(palette(p2).locator('.pal-toast')).toContainText('「新建文件夹」没有快捷键了')
    await expect(row('新建文件夹').locator('kbd')).toHaveCount(0)
    expect(cmdsJson(run).keys ?? {}).toEqual({})
    await p2.keyboard.press('Escape')
    await p2.keyboard.press('Control+Meta+KeyN')
    await p2.waitForTimeout(300)
    await expect(p2.getByRole('textbox', { name: '新文件夹的名字' })).toHaveCount(0)

    // 两个对调：新建白板拿 ⌘N，新建笔记拿新建白板原来的 ⇧⌘N
    await keysMenu('新建白板')
    await p2.keyboard.press('Meta+n')
    await expect(mini.locator('.why')).toHaveText('已经给了「新建笔记」，按「好」就换给这一条')
    await mini.getByRole('button', { name: '两个对调' }).click()
    await expect(palette(p2).locator('.pal-toast')).toContainText('对调了：「新建白板」⌘N，「新建笔记」⇧⌘N')
    await expect(row('新建白板').locator('kbd')).toHaveText('⌘N')
    expect(cmdsJson(run).keys).toEqual({ 'new-board': '⌘N', 'new-note': '⇧⌘N' })
    await p2.keyboard.press('Escape')
    await p2.keyboard.press('Meta+n')
    // 新建的白板在标签上改名（同 keys-checks 的 new-board、b2-board）：改名框里是「未命名白板」，esc 收起
    await expect(tabOn(p2).locator('input.tab-rename')).toHaveValue(/^未命名白板/)
    await p2.keyboard.press('Escape')
    await expect(tabOn(p2)).toHaveText(/^未命名白板/)

    // 回到默认：两条都回到命令表里的键
    await keysMenu('新建白板')
    await mini.getByRole('button', { name: '回到默认 ⇧⌘N' }).click()
    await keysMenu('新建笔记')
    await mini.getByRole('button', { name: '回到默认 ⌘N' }).click()
    await expect.poll(() => cmdsJson(run).keys ?? {}).toEqual({})
    await p2.keyboard.press('Escape')
  } finally {
    if (second) await second.close()
    if (!closed) await run.close()
    else rmSync(dirname(run.vault), { recursive: true, force: true })
  }
})

test('AI 输入框里打着字按全局键：照样跑，输入框里的字不动', async () => {
  const run = await launch(KEY_FILES)
  const { page } = run
  try {
    await openAi(page)
    const ask = page.getByRole('textbox', { name: '问 AI' })
    await ask.fill('写到一半')
    await page.keyboard.press('Meta+Backslash')
    await expect(page.locator('.win')).toHaveClass(/side-hidden/)
    await expect(ask).toHaveValue('写到一半')
    await page.keyboard.press('Meta+Backslash')
    await expect(page.locator('.win')).not.toHaveClass(/side-hidden/)
  } finally {
    await run.close()
  }
})
