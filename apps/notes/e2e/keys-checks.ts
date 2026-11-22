/**
 * 快捷键逐个真按（task-spsmf）：四种焦点（编辑器、AI 输入框、网页、白板）怎么摆好、怎么真按一个组合键，
 * 命令表里每条全局命令按下去该看到什么、看完怎么复原。keys.spec.ts 照命令表一条条用它。
 */
import { expect, type Page } from '@playwright/test'
import { acts, leftView, openAi, openNote, pane, rail, type Running, tabOn } from './app'

export type Ctx = 'editor' | 'ai' | 'web' | 'board'
export const CTXS: Ctx[] = ['editor', 'ai', 'web', 'board']

export interface KeyRun {
  run: Running
  /** 本机测试网页的地址 */
  base: string
}

export const KEY_FILES = {
  '写作/草稿.md': '# 草稿\n\n还没写完的一段。\n\n## 小标题\n\n第二段。\n',
  '写作/路线.md': '# 路线\n\n## 第一天\n\n到雷克雅未克。\n\n## 第二天\n\n黄金圈。\n',
  '收件箱/第一条.md': '# 第一条\n\n剪藏来的网页先放这里。\n',
}

export const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const left = (page: Page, name: string) => page.getByRole('navigation', { name: '左栏' }).getByRole('button', { name, exact: true })
export const railBtn = (page: Page, name: RegExp) => rail(page).getByRole('button', { name })
export const palette = (page: Page) => page.getByRole('dialog', { name: '搜索和命令' })
const settingsBox = (page: Page) => page.locator('[aria-label="设置"]').filter({ has: page.getByTestId('settings-head') })
const T = { timeout: 3000 }

/** 「⇧⌘E」→ Playwright 的写法「Shift+Meta+KeyE」 */
export function pwKey(combo: string): string {
  const mods = /^[⌃⌥⇧⌘]*/.exec(combo)![0]
  const name = combo.slice(mods.length)
  const m = [...mods].map((c) => ({ '⌃': 'Control', '⌥': 'Alt', '⇧': 'Shift', '⌘': 'Meta' })[c]!)
  const special: Record<string, string> = { '\\': 'Backslash', '[': 'BracketLeft', ']': 'BracketRight', ',': 'Comma', '.': 'Period', '/': 'Slash', ';': 'Semicolon', "'": 'Quote', '-': 'Minus', '=': 'Equal', '`': 'Backquote', '↵': 'Enter', '⌫': 'Backspace', '⌦': 'Delete', '⇥': 'Tab', '↑': 'ArrowUp', '↓': 'ArrowDown', '←': 'ArrowLeft', '→': 'ArrowRight', Space: 'Space' }
  const key = special[name] ?? (/^[A-Z]$/.test(name) ? `Key${name}` : /^\d$/.test(name) ? `Digit${name}` : name)
  return [...m, key].join('+')
}

/** 「⇧⌘E」→ Electron sendInputEvent 的 keyCode 和 modifiers */
export function inputKey(combo: string): { keyCode: string; modifiers: ('shift' | 'meta' | 'alt' | 'control')[] } {
  const mods = /^[⌃⌥⇧⌘]*/.exec(combo)![0]
  const name = combo.slice(mods.length)
  const modifiers = [...mods].map((c) => ({ '⌃': 'control', '⌥': 'alt', '⇧': 'shift', '⌘': 'meta' })[c]! as 'shift' | 'meta' | 'alt' | 'control')
  const special: Record<string, string> = { '↵': 'Return', '⌫': 'Backspace', '⌦': 'Delete', '⇥': 'Tab', '↑': 'Up', '↓': 'Down', '←': 'Left', '→': 'Right', Space: 'Space' }
  return { keyCode: special[name] ?? name, modifiers }
}

/** 右栏打开一个网页，等它载完 */
export async function openWeb(page: Page, url: string) {
  if (!(await web(page).isVisible())) await railBtn(page, /^网页$/).click()
  const address = web(page).getByRole('textbox', { name: '网址' })
  await address.fill(url)
  await address.press('Enter')
  await expect(web(page).locator('webview.on')).toBeVisible()
  await expect.poll(() => page.evaluate(() => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<string> }).executeJavaScript('document.readyState'))).toBe('complete')
}

/** 右栏开着的网页里跑一段（读网页里的东西） */
export const inWeb = <R>(page: Page, js: string) => page.evaluate((js) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<R> }).executeJavaScript(js), js)

/** 网页有焦点（主进程让网页拿到焦点），从主进程往网页里送一个真的组合键（Playwright 的键盘到不了 webview 里） */
export async function pressInWeb(run: Running, combo: string) {
  const id = await run.page.evaluate(() => (document.querySelector('.right.web webview.on') as unknown as { getWebContentsId(): number }).getWebContentsId())
  const k = inputKey(combo)
  await run.app.evaluate(({ webContents }, { wcId, k }) => {
    const wc = webContents.fromId(wcId)!
    wc.focus()
    wc.sendInputEvent({ type: 'keyDown', keyCode: k.keyCode, modifiers: k.modifiers })
    wc.sendInputEvent({ type: 'keyUp', keyCode: k.keyCode, modifiers: k.modifiers })
  }, { wcId: id, k })
}

/** 摆好这种焦点 */
export async function focusCtx(k: KeyRun, ctx: Ctx) {
  const { page } = k.run
  await page.keyboard.press('Escape')
  if (ctx === 'editor' || ctx === 'board') {
    const want = ctx === 'editor' ? '草稿' : '路线'
    if ((await tabOn(page).textContent().catch(() => null)) !== want) {
      // 左栏换到「最近」（前面按过的键可能把左栏收了、换成了梦游报告），在那里点开这一篇
      await leftView(page, '最近')
      await openNote(page, want)
    }
    const tab = acts(page).getByRole('tab', { name: ctx === 'editor' ? '文档' : '白板' })
    if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click()
    if (ctx === 'editor') {
      await pane(page).locator('.cm-content').click()
      await expect(pane(page).locator('.cm-content')).toBeFocused()
    } else {
      const board = pane(page).getByTestId('doc-board')
      await expect(board).toBeVisible()
      const b = (await board.boundingBox())!
      await page.mouse.click(b.x + b.width - 30, b.y + b.height - 30)
    }
  } else if (ctx === 'ai') {
    await openAi(page)
    const ask = page.getByRole('textbox', { name: '问 AI' })
    await ask.click()
    await expect(ask).toBeFocused()
  } else if (!(await web(page).locator('webview.on').isVisible().catch(() => false))) await openWeb(page, `${k.base}/`)
}

/** 在这种焦点下真按一个组合键 */
export async function press(k: KeyRun, ctx: Ctx, combo: string) {
  if (ctx === 'web') return pressInWeb(k.run, combo)
  await k.run.page.keyboard.press(pwKey(combo))
}

/**
 * 一条全局命令：按下去该看到什么，看完复原。p 是「在这种焦点下真按这条命令的键」，combo 是这个键
 * （复原那一下有时要在界面里按：焦点跟着收起的网页一起没了）
 */
export interface Check {
  /** 在哪几种焦点下按（不给是四种都按） */
  ctxs?: Ctx[]
  check(k: KeyRun, ctx: Ctx, p: () => Promise<void>, combo: string): Promise<void>
}

const flips = async (p: () => Promise<void>, read: () => Promise<string | null>) => {
  const was = await read()
  await p()
  await expect.poll(read, T).not.toBe(was)
  await p()
  await expect.poll(read, T).toBe(was)
}

/** 开着就收、收着就开的一格（右栏的网页、大纲、历史） */
const railToggle = (name: RegExp): Check => ({
  async check(k, ctx, p, combo) {
    const b = railBtn(k.run.page, name)
    const was = await b.getAttribute('aria-pressed')
    await p()
    await expect(b).toHaveAttribute('aria-pressed', was === 'true' ? 'false' : 'true', T)
    // 网页那种焦点下收起网页，焦点跟着没了：复原那一下在界面里按
    if (ctx === 'web') await k.run.page.keyboard.press(pwKey(combo))
    else await p()
    await expect(b).toHaveAttribute('aria-pressed', was ?? 'false', T)
  },
})

/** 打开一个弹层，esc 关上 */
const opens = (find: (page: Page) => ReturnType<Page['locator']>): Check => ({
  async check(k, _c, p) {
    await p()
    await expect(find(k.run.page)).toBeVisible(T)
    await k.run.page.keyboard.press('Escape')
    await expect(find(k.run.page)).toHaveCount(0, T)
  },
})

const closeTab = async (page: Page) => {
  const t = page.getByTestId('tab-on')
  await t.hover()
  await t.getByRole('button', { name: /关闭/ }).click()
}

export const CHECKS: Record<string, Check> = {
  'toggle-left': { check: (k, _c, p) => flips(p, async () => String(await k.run.page.locator('.win').evaluate((e) => e.classList.contains('side-hidden')))) },
  'left-files': { check: (k, _c, p) => flips(p, () => left(k.run.page, '文件').getAttribute('aria-pressed')) },
  'left-recent': { check: (k, _c, p) => flips(p, () => left(k.run.page, '最近').getAttribute('aria-pressed')) },
  // 收起 / 展开中间栏（task-kbnc0）：记在本机，按一下变、再按变回来（网页没开时中间照样在，只是记着）
  'fold-center': { check: (k, _c, p) => flips(p, () => k.run.page.evaluate(() => String(localStorage.getItem('cn.centerFold') === '1'))) },
  'dream-report': { check: (k, _c, p) => flips(p, () => left(k.run.page, '梦游报告').getAttribute('aria-pressed')) },
  'toggle-right': {
    async check(k, ctx, p, combo) {
      const right = () => k.run.page.locator('.win').evaluate((e) => String(e.classList.contains('with-right')))
      const was = await right()
      await p()
      await expect.poll(right, T).not.toBe(was)
      if (ctx === 'web' && was === 'true') await k.run.page.keyboard.press(pwKey(combo))
      else await p()
      await expect.poll(right, T).toBe(was)
    },
  },
  search: opens(palette),
  goto: opens((page) => page.getByRole('dialog', { name: '按名字跳到' })),
  capture: opens((page) => page.getByRole('dialog', { name: '拍一张导图' })),
  settings: opens(settingsBox),
  'ask-ai': {
    async check(k, ctx, p) {
      const page = k.run.page
      const shown = (await page.getByRole('button', { name: '收起 AI', exact: true }).count()) > 0
      await p()
      await expect(page.getByRole('button', { name: shown ? '打开 AI' : '收起 AI', exact: true }).first()).toBeVisible(T)
      if (ctx === 'ai') return void (await openAi(page))
      await (ctx === 'web' && !shown ? page.getByRole('button', { name: '收起 AI', exact: true }).first().click() : p())
      await expect(page.getByRole('button', { name: shown ? '收起 AI' : '打开 AI', exact: true }).first()).toBeVisible(T)
    },
  },
  'new-note': {
    async check(k, _c, p) {
      await p()
      await expect(tabOn(k.run.page)).toHaveText(/^未命名/, T)
      await closeTab(k.run.page)
    },
  },
  'new-board': {
    async check(k, _c, p) {
      const page = k.run.page
      await p()
      // 新建的白板在标签上改名：改名框里是「未命名白板」，esc 收起
      await expect(page.locator('.tab-rename')).toHaveValue(/^未命名白板/, T)
      await page.keyboard.press('Escape')
      await expect(tabOn(page)).toHaveText(/^未命名白板/, T)
      await closeTab(page)
    },
  },
  home: {
    async check(k, _c, p) {
      await p()
      await expect(tabOn(k.run.page)).toHaveText('首页', T)
    },
  },
  back: {
    // 走过的标签：后退离开现在这个
    async check(k, _c, p) {
      const now = await tabOn(k.run.page).textContent()
      await p()
      await expect(tabOn(k.run.page)).not.toHaveText(now ?? '', T)
    },
  },
  forward: {
    // 先按命令表里后退的键退一步，再前进回来
    async check(k, ctx, p) {
      const page = k.run.page
      const now = await tabOn(page).textContent()
      const [backKey] = await keysNow(page, 'back')
      await press(k, ctx, backKey!)
      await expect(tabOn(page)).not.toHaveText(now ?? '', T)
      await p()
      await expect(tabOn(page)).toHaveText(now ?? '', T)
    },
  },
  'open-web': railToggle(/^网页$/),
  outline: { ...railToggle(/^大纲/), ctxs: ['editor', 'ai', 'board'] },
  history: railToggle(/^历史$/),
  // 网页栏顶上收成一行 / 展开、书签栏开关（task-sta8n）：网页那一格看得见时才归它，所以只在网页有焦点时按（别的焦点在 step27-web-top 里按）
  'web-top-fold': { ctxs: ['web'], check: (k, _c, p) => flips(p, () => k.run.page.getByTestId('web-fold').getAttribute('aria-label')) },
  'web-bookmarks-bar': { ctxs: ['web'], check: (k, _c, p) => flips(p, () => k.run.page.evaluate(() => String(localStorage.getItem('cn.webBookmarksBar') === '1'))) },
  'web-new-tab': {
    async check(k, _c, p) {
      // 网页那一格藏在别的标签后面时标签还在：连藏着的一起数
      const tabs = k.run.page.locator('aside.right.web button[aria-label="关闭网页标签"]')
      const n = await tabs.count()
      await p()
      await expect(web(k.run.page)).toBeVisible(T)
      await expect(tabs).toHaveCount(Math.max(n + 1, 1), T)
      await tabs.last().click()
      await expect(tabs).toHaveCount(n, T)
    },
  },
}

/** 这条命令现在的键（界面里 window.cnKeys 交出来的；测试里改过键也认） */
export const keysNow = (page: Page, id: string): Promise<string[]> => page.evaluate((id) => (window as unknown as { cnKeys: { keysFor(id: string): string[] } }).cnKeys.keysFor(id), id)
