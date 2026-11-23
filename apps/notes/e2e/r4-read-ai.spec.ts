/**
 * 发版前第 4 轮（实用 · 读与 AI）找出来的问题：每条一个测试，真按、真点。
 * - ⌘K：结果没出来先按 ↓ 和等出来再按 ↓ 落在同一行；不沾边的「意思相近」不列；打的像网址时只有名字对得上的才默认。
 * - 用户没去任何网站时软件 0 个对外请求（开软件、开右栏网页、新网页、设置各页）；记账代理数。
 * - 梦游「全部收下」时那篇开着：不说「在外面挪到了」。
 * - 收下归类后在外面改了名再撤回：说清是改了名、名字不重复；撤不回时「撤回」换成「在历史里看」。
 */
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, leftView, openNote, pane, rail, tabOn, type Running } from './app'
import { DREAM_VAULT } from './fixtures/dream'
import { burst, launchCounted, netMark, netSince, proxyLog, tempHome } from './net'
import { shotTone, shotWindow } from './shots'

const pal = (page: Page) => page.getByRole('dialog', { name: '搜索和命令' })
const palBox = (page: Page) => pal(page).getByRole('textbox', { name: '搜索笔记、输入网址或命令' })
const web = (page: Page) => page.getByRole('complementary', { name: '网页' })

// ---------------------------------------------------------------- ⌘K

test('⌘K：早按 ↓ 和晚按 ↓ 落在同一行；不沾边的意思相近不列；打的像网址时只有名字对得上的才默认', async () => {
  test.setTimeout(240_000)
  const files: Record<string, string | Uint8Array> = {
    '随手记.md': '# 随手记\n\n正文。\n',
    '线性代数复习.md': '# 线性代数复习\n\n核和像。矩阵乘法，特征值。\n',
    '线性代数习题.md': '# 线性代数习题\n\n题。\n',
    'readme.md': '# readme\n\n说明。\n',
    '代码托管.md': '# 代码托管\n\n仓库放在 github.com 上。\n',
    'example.org.md': '# example.org\n\n一个同名笔记。\n',
  }
  for (let i = 0; i < 300; i++) files[`杂/笔记${i}.md`] = `# 笔记${i}\n\n` + '随便写点。\n'.repeat(30)
  const run = await launchCounted(files, { CN_AI_FAKE: '1', ...tempHome() })
  const { page } = run
  try {
    await shotTone(page)
    await expect.poll(() => page.evaluate(() => (window as unknown as { cnSearch: { status(): Promise<{ phase: string }> } }).cnSearch.status().then((s) => s.phase)), { timeout: 120_000 }).toBe('ready')

    /** 开 ⌘K，按 how 打字按键，等 1.2 秒（意思相近早回来了）再回车；返回回车前选中的那一行、回车后开着的标签（框还开着是 null） */
    const tryIt = async (word: string, how: 'early' | 'late' | 'none') => {
      await page.keyboard.press('Meta+k')
      await palBox(page).waitFor()
      const mark = await netMark(run)
      await burst(run, word, how === 'early' ? ['Down'] : [])
      await page.waitForTimeout(1200)
      if (how === 'late') await page.keyboard.press('ArrowDown')
      await page.waitForTimeout(150)
      const on = (await pal(page).locator('.pal-row.on').allInnerTexts()).join('/')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(800)
      const open = await pal(page).isVisible()
      if (open) await page.keyboard.press('Escape')
      expect(await netSince(run, mark), `${word} ${how}`).toEqual([])
      expect(await web(page).isVisible(), `${word} ${how}`).toBe(false)
      return { on, tab: open ? null : (await tabOn(page).allInnerTexts()).join('/') }
    }

    // 1. 字面没结果、意思相近都没把握：早按 ↓、晚按 ↓、不按，三种都不选中、回车不做事
    for (const word of ['特斯拉股价', '老布什abc']) {
      const r = { none: await tryIt(word, 'none'), early: await tryIt(word, 'early'), late: await tryIt(word, 'late') }
      expect(r, word).toEqual({ none: { on: '', tab: null }, early: { on: '', tab: null }, late: { on: '', tab: null } })
    }

    // 2. 有把握的：早按、晚按落在同一行、开同一篇。最近打开的会排前一点（cmdk 方案「最合适」看最近用过没有），
    // 两次之间把「最近打开」清掉，两次从一样的起点比
    const fresh = () => page.evaluate(() => localStorage.removeItem('cn.recentFiles'))
    for (const word of ['线性代数', '矩阵的特征值']) {
      await fresh()
      const early = await tryIt(word, 'early')
      await fresh()
      const late = await tryIt(word, 'late')
      expect(early.tab, word).not.toBeNull()
      expect(early, word).toEqual(late)
    }

    // 3. 不沾边的词「意思相近」一条不出（task-j0249 收紧门槛；以前列出来但只能鼠标点），鼠标悬停也没有能选中的本地结果
    await page.keyboard.press('Meta+k')
    await palBox(page).fill('特斯拉股价')
    await expect(pal(page).locator('.pal-g', { hasText: '网页和AI' })).toBeVisible({ timeout: 5000 })
    await page.waitForTimeout(1200)
    await expect(pal(page).locator('.pal-g', { hasText: '意思相近' })).toHaveCount(0)
    await expect(pal(page).locator('.pal-row.on')).toHaveCount(0)
    await shotWindow(run, 'r4-palette-loose-hover')
    await page.keyboard.press('Escape')

    // 4. 像网址 / 域名：名字对不上的（意思相近、正文里有）都不默认，写清楚 ⌘↵ 去网页；名字对得上的照样默认
    for (const word of ['example.com', 'github.com']) {
      await page.keyboard.press('Meta+k')
      const mark = await netMark(run)
      await palBox(page).fill(word)
      await page.waitForTimeout(1200)
      await expect(pal(page).locator('.pal-row.on'), word).toHaveCount(0)
      await expect(pal(page).locator('.pal-none-why'), word).toHaveText(word === 'example.com' ? '回车不做事，⌘↵ 去网页打开' : `没有叫「${word}」的笔记，回车不做事，⌘↵ 去网页打开`)
      if (word === 'example.com') await shotWindow(run, 'r4-palette-domain')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(800)
      await expect(pal(page), word).toBeVisible()
      await page.keyboard.press('Escape')
      expect(await netSince(run, mark), word).toEqual([])
    }
    // 正文里有 github.com 的那篇：键盘挪得到（有把握），只是不当默认
    await page.keyboard.press('Meta+k')
    await palBox(page).fill('github.com')
    await page.waitForTimeout(1200)
    await page.keyboard.press('ArrowDown')
    await expect(pal(page).locator('.pal-row.on')).toContainText('代码托管')
    await page.keyboard.press('Escape')
    // 名字对得上：立刻回车也开笔记
    await page.keyboard.press('Meta+k')
    await burst(run, 'example.org', ['Return'])
    await expect(pal(page)).toHaveCount(0)
    await expect(tabOn(page)).toHaveText('example.org')
  } finally {
    await run.close()
  }
})

// ---------------------------------------------------------------- 没去任何网站时 0 个对外请求

test('用户没去任何网站时 0 个对外请求：开软件、开右栏网页、新网页、设置每一页；去了网站才取拦广告规则', async () => {
  test.setTimeout(120_000)
  // 拦广告的规则地址换成一个要走代理的假网址（像正式版的 easylist.to）：正式版启动时会不会去取，这里就看得见
  const proxyAtLaunch = proxyLog.length
  const run = await launchCounted({ '随手记.md': '# 随手记\n\n正文。\n' }, { CN_AI_FAKE: '1', ...tempHome(), CN_ADBLOCK_LISTS: 'https://lists.adblock.invalid/easylist.txt' })
  const { page } = run
  // 代理记账是整个测试进程共用的（前面的测试文件也往里记）：从这次启动起数
  const start = { proxy: proxyAtLaunch, nav: 0 }
  const seen = async (step: string) => expect(await netSince(run, start), step).toEqual([])
  try {
    await shotTone(page)
    await page.waitForTimeout(3000)
    await seen('开软件')
    await openNote(page, '随手记')
    await seen('开笔记')
    // 右栏网页：软件自带的新标签页
    await rail(page).getByRole('button', { name: '网页' }).click()
    await expect(web(page)).toBeVisible()
    // dom-ready 之前 getURL 会抛：当作还没有
    await expect
      .poll(() =>
        page.evaluate(() => {
          try {
            return (document.querySelector('.right.web webview.on') as unknown as { getURL(): string } | null)?.getURL() ?? ''
          } catch {
            return ''
          }
        }),
      )
      .toMatch(/^cn-ext:\/\/bookmarkkeeper\/newtab/)
    await page.waitForTimeout(2500)
    await seen('开右栏网页')
    // 新标签页没用外面的字体：页面上的字体都是本机的
    const fonts = (await page.evaluate(() =>
      (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<string[]> }).executeJavaScript(
        `[...document.querySelectorAll('link[href^="http"], script[src^="http"], img[src^="http"]')].map((e) => e.outerHTML.slice(0, 120))`,
      ),
    )) as string[]
    expect(fonts).toEqual([])
    await shotWindow(run, 'r4-newtab-offline')
    await web(page).getByLabel('新网页', { exact: true }).click()
    await page.waitForTimeout(2000)
    await seen('新网页')
    // 设置每一页
    await page.keyboard.press('Meta+,')
    const nav = page.getByRole('navigation', { name: '设置分页' })
    await expect(nav).toBeVisible()
    for (const name of ['一般', '外观', '首页', '文档和白板', '文件和附件', '读PDF', '网页和视频', 'AI', '梦游', '库', 'Git和同步', '隐私和联网', '插件', '快捷键', '高级']) {
      await nav.getByRole('button', { name, exact: true }).click()
      await page.waitForTimeout(1000)
      await seen(`设置 · ${name}`)
    }
    await page.keyboard.press('Escape')
    await page.waitForTimeout(1500)
    await seen('关上设置')

    // 对照：真去一个网站，代理记到了这个网站，也是这时才去取拦广告的规则
    const addr = web(page).getByRole('textbox', { name: '网址' })
    await addr.fill('https://example.com/')
    await addr.press('Enter')
    await expect.poll(() => proxyLog.slice(proxyAtLaunch).join(' '), { timeout: 15_000 }).toContain('example.com')
    await expect.poll(() => proxyLog.slice(proxyAtLaunch).join(' '), { timeout: 15_000 }).toContain('lists.adblock.invalid')
  } finally {
    await run.close()
  }
})

// ---------------------------------------------------------------- 梦游

const dreamPanel = (page: Page) => page.getByRole('complementary', { name: '梦游报告' })
const toast = (page: Page) => page.getByTestId('toast')
const git = (vault: string, ...a: string[]) => execFileSync('git', ['-C', vault, '-c', 'core.quotepath=false', ...a], { encoding: 'utf8' })
const findFile = (root: string, name: string): string | null => {
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === '.canvas-notes') continue
    const p = join(root, e.name)
    if (e.isDirectory()) {
      const hit = findFile(p, name)
      if (hit) return hit
    } else if (e.name === name) return p
  }
  return null
}
async function recordToasts(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { toasts: string[] }
    w.toasts = []
    new MutationObserver(() => {
      for (const sel of ['[data-testid="toast"]', '[data-testid="preview-toast"]']) {
        const t = (document.querySelector(sel) as HTMLElement | null)?.innerText ?? ''
        if (t && !w.toasts.includes(t)) w.toasts.push(t)
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true })
  })
  return () => page.evaluate(() => (window as unknown as { toasts: string[] }).toasts)
}
async function dreamNow(page: Page) {
  await leftView(page, '梦游报告')
  await dreamPanel(page).getByRole('button', { name: '现在梦游' }).click()
  await expect(dreamPanel(page).getByTestId('dream-summary')).toContainText('整理了', { timeout: 60_000 })
}
async function typeAtEnd(page: Page, text: string) {
  await pane(page).locator('.cm-content').click()
  await page.keyboard.press('Meta+End')
  await page.keyboard.type(text)
}

test('梦游「全部收下」时那篇正开着、还在打字：标签跟过去，不说「在外面挪到了」，打的字都在', async () => {
  const run: Running = await launch({ ...DREAM_VAULT }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await shotTone(page)
    const toasts = await recordToasts(page)
    await openNote(page, '冰洞')
    await dreamNow(page)
    await typeAtEnd(page, '收下前打的。')
    await page.waitForTimeout(1200)
    await dreamPanel(page).getByRole('button', { name: '全部收下' }).click()
    await typeAtEnd(page, '收下时打的。')
    await expect(toast(page)).toContainText('剩下的都收下了')
    await expect.poll(() => existsSync(join(vault, '收件箱/冰洞.md'))).toBe(false)
    await page.waitForTimeout(3000)
    expect((await toasts()).filter((t) => /在外面/.test(t))).toEqual([])
    await expect(tabOn(page)).toHaveText('冰洞')
    const moved = findFile(vault, '冰洞.md')!
    // ⌘End 落在文末那一行，每次打的字各新起一段（task-ys1rr 文档块照 Notion）
    await expect.poll(() => readFileSync(moved, 'utf8')).toMatch(/订。\n\n收下前打的。\n\n收下时打的。\n$/)
    await shotWindow(run, 'r4-dream-takeall-open')
  } finally {
    await run.close()
  }
})

for (const frame of ['b', 'a'] as const)
test(`收下归类后在外面把那篇改了名再点「撤回」：说清是后来改了名、名字不重复；「撤回」换成「在历史里看」，库干净；窗口 960 宽时提示条还是一行（风格 ${frame.toUpperCase()}）`, async () => {
  const run = await launch({ ...DREAM_VAULT }, { CN_AI_FAKE: '1' }, (vault) => {
    const ud = join(dirname(vault), 'user-data')
    mkdirSync(ud, { recursive: true })
    writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { frame } }))
  })
  const { page, vault } = run
  try {
    await shotTone(page)
    await dreamNow(page)
    await dreamPanel(page).getByTestId('dream-item').filter({ hasText: /^冰洞\s*从/ }).click()
    await dreamPanel(page).getByTestId('dream-detail').getByRole('button', { name: '收下', exact: true }).click()
    // 收下的提示在底栏，带「在历史里看」「撤回」（task-m552v：点一条是中间开它，不再有中间上浮的预览提示条）
    const pv = toast(page)
    await expect(pv).toContainText('收下了「冰洞」')
    await expect.poll(() => existsSync(join(vault, '收件箱/冰洞.md'))).toBe(false)
    const taken = findFile(vault, '冰洞.md')!
    const renamed = taken.replace(/冰洞\.md$/, '冰洞攻略.md')
    // 像在访达里改名
    renameSync(taken, renamed)
    await page.waitForTimeout(2500)
    await pv.getByRole('button', { name: /撤回/ }).click()
    await expect(toast(page)).toContainText('撤回不了：「冰洞」收下以后改名成了「冰洞攻略」')
    const said = await toast(page).innerText()
    expect(said.match(/「冰洞」/g)?.length, said).toBe(1)
    expect(said).not.toMatch(/同一处/)
    // 撤不回：哪儿都没有「撤回」了，换成「在历史里看」
    await expect(page.getByRole('button', { name: /^撤回$/ })).toHaveCount(0)
    await expect(toast(page).getByRole('button', { name: '在历史里看' })).toHaveCount(1)
    await shotWindow(run, `r4-dream-undo-renamed-${frame}`)
    // 窄窗口：提示条还在底栏里、一行（放不下省略号），按钮不被挤掉
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(960, 800))
    await page.waitForTimeout(400)
    const h = (await toast(page).boundingBox())!.height
    expect(h).toBeLessThanOrEqual(24)
    await expect(toast(page).getByRole('button', { name: '在历史里看' })).toBeInViewport({ ratio: 1 })
    await shotWindow(run, `r4-dream-undo-renamed-${frame}-960`)
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await toast(page).getByRole('button', { name: '在历史里看' }).click()
    await expect(page.getByRole('complementary', { name: '历史' })).toBeVisible()
    // 什么都没动：改了名的那篇还在，库干净，没卡在撤回中间；撤回前先提交的那次说的是「挪了」
    expect(existsSync(renamed)).toBe(true)
    expect(existsSync(join(vault, '收件箱/冰洞.md'))).toBe(false)
    expect(git(vault, 'status', '--porcelain')).toBe('')
    expect(existsSync(join(vault, '.git/REVERT_HEAD'))).toBe(false)
    expect(git(vault, 'log', '-1', '--format=%s').trim()).toMatch(/^挪了 1 个(文件)?：.*冰洞 → .*冰洞攻略$/)
  } finally {
    await run.close()
  }
})
