// ParaRead 联动（设计 20-pararead联动「两边看到的完全一样」）：两个软件同时开着同一个库，来回切两次，全程真点。
//  1. ParaRead：拖选划「重点」「看不懂」，带着一句摘录问 AI（真 DeepSeek，要 DEEPSEEK_API_KEY）；
//  2. 画布笔记：打开同一份 PDF，纸面上照笔记画出 ParaRead 划的线，右栏「笔记」里有划的线、看不懂、ParaRead 问的那一问；
//     在画布笔记里划一条「定义」；
//  3. ParaRead：阅读页里马上多一条绿色的「定义」；把它换成「想引用」；
//  4. 画布笔记：那一条变成想引用；右键 ParaRead 划的「重点」删掉；
//  5. ParaRead：那一条没了。
// 要先打好两个软件（apps/notes、apps/pararead 各 electron-vite build）；PR_BOTH_PAPER=<一篇论文 PDF>（默认用测试讲义）、PR_BOTH_SHOTS=<截图目录>
import { _electron as electron, expect, type ElectronApplication, type Page, test } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { launch, rail, tabOn } from './app'
import { LECTURE } from './fixtures/pdf'
import { armMenus, pickMenu } from './menu'

test.setTimeout(420_000)

const PR = join(__dirname, '../../pararead')
const PR_ELECTRON = join(PR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
const PAPER = process.env.PR_BOTH_PAPER
const REL = `课程/ecp/${PAPER ? basename(PAPER) : '第3讲 线性映射.pdf'}`
const NOTE = REL.replace(/\.pdf$/i, ' 笔记.md')
const SHOTS = process.env.PR_BOTH_SHOTS
const shot = async (p: Page, name: string) => {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  await p.screenshot({ path: join(SHOTS, `${name}.png`) })
}

const pdfPane = (page: Page) => page.locator('.pdfpane:not([hidden])')
const pdfPage = (page: Page, n: number) => pdfPane(page).locator(`.pdfpage[data-page="${n}"]`)
const hlOn = (page: Page, n: number) => pdfPane(page).locator('.pdfslot').nth(n - 1)
const notes = (page: Page) => page.getByRole('complementary', { name: '笔记', exact: true })

/** ParaRead 原文模式里第 1 页上第 n 段长一点的字：拖选它的前一大半，回选中的字 */
async function prSelect(w: Page, n: number): Promise<string> {
  const ls = await w.evaluate(() =>
    [...document.querySelectorAll('.page[data-page="1"] .textLayer span')]
      .filter((s) => (s.textContent ?? '').trim().length > 40 && s.getBoundingClientRect().top > 160 && s.getBoundingClientRect().top < 820)
      .map((sp) => {
        const q = sp.getBoundingClientRect()
        // 拖到这一段大半处那个词的末尾（不停在词中间）
        const tn = sp.firstChild as Text
        const txt = sp.textContent ?? ''
        let cut = txt.indexOf(' ', Math.floor(txt.length * 0.6))
        if (cut < 0) cut = txt.length
        const rg = document.createRange()
        rg.setStart(tn, 0)
        rg.setEnd(tn, Math.min(cut, tn.length))
        const rr = rg.getBoundingClientRect()
        return { x: q.x, y: q.y, w: q.width, h: q.height, end: rr.right - 1 }
      }),
  )
  const l = ls[n]!
  await w.mouse.move(l.x + 1, l.y + l.h / 2)
  await w.mouse.down()
  await w.mouse.move(l.end, l.y + l.h / 2, { steps: 8 })
  await w.mouse.up()
  await w.locator('.sel-toolbar').waitFor({ timeout: 5000 })
  return (await w.evaluate(() => window.getSelection()?.toString() ?? '')).replace(/\s+/g, ' ').trim()
}

test('两个软件来回切两次：ParaRead 划的、问的画布笔记看得到，画布笔记划的 ParaRead 看得到', async () => {
  test.skip(!existsSync(join(PR, 'out/main/index.js')), '先打 ParaRead：cd apps/pararead && pnpm run build')
  test.skip(!process.env.DEEPSEEK_API_KEY, 'ParaRead 问 AI 要 DEEPSEEK_API_KEY')
  const run = await launch({ [REL]: PAPER ? readFileSync(PAPER) : LECTURE }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  const note = () => (existsSync(join(vault, NOTE)) ? readFileSync(join(vault, NOTE), 'utf8') : '')
  let pr: ElectronApplication | null = null
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    await armMenus(run)
    // ParaRead：测试模式（窗口不上屏），从画布笔记的设置目录知道这个库
    const prData = mkdtempSync(join(tmpdir(), 'pr-both-'))
    pr = await electron.launch({
      executablePath: PR_ELECTRON,
      args: [join(PR, 'out/main/index.js'), `--data-dir=${prData}`],
      cwd: PR,
      env: { ...process.env, E2E: '1', PARAREAD_UI_LANG: 'zh', CN_USER_DATA: run.userData },
    })
    const w = await pr.firstWindow()
    await w.waitForLoadState('domcontentloaded')
    await pr.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await w.evaluate(() => (window as any).api.setSettings({ onboarded: true, display: 'src', provider: 'deepseek' }))
    await w.evaluate((v) => (window as any).api.cnConnect(v), vault)
    await w.evaluate((v) => (window as any).api.cnSetFolders(v, ['课程/ecp']), vault)
    let id = ''
    await expect.poll(async () => (id = (await w.evaluate(() => (window as any).api.listPapers())).find((p: { cn: unknown }) => p.cn)?.id ?? ''), { timeout: 30_000 }).not.toBe('')

    // ---- 1. ParaRead：划两条、问一句
    await w.locator('.cn-nav .nav-item[data-cn-folder="课程/ecp"]').click()
    await w.dblclick(`[data-paper="${id}"]`)
    await w.locator('.mid-bar').waitFor()
    await w.evaluate(() => (document.querySelectorAll('.mid-bar .seg-item')[0] as HTMLElement | undefined)?.click())
    await w.locator('.page[data-page="1"] .textLayer span').first().waitFor({ timeout: 30_000 })
    await w.waitForTimeout(1500)
    const keyText = await prSelect(w, 0)
    await w.locator('.sel-toolbar .tb-kind[data-kind="key"]').click()
    await w.waitForTimeout(500)
    const confusedText = await prSelect(w, 2)
    await w.locator('.sel-toolbar .tb-kind[data-kind="confused"]').click()
    await expect.poll(note).toContain('k=confused -->')
    const askText = await prSelect(w, 4)
    await w.locator('.sel-toolbar .tb-btn', { hasText: '问 AI' }).click()
    const box = w.locator('.chat textarea, .composer textarea').first()
    await box.fill('用一句话讲这句在说什么')
    await box.press('Enter')
    await expect(w.locator('.msg-ai').last()).not.toBeEmpty({ timeout: 90_000 })
    await expect.poll(note, { timeout: 120_000 }).toContain('用一句话讲这句在说什么')
    await shot(w, 'both-1-pararead')

    // ---- 2. 画布笔记：同一份 PDF，ParaRead 划的、问的都在
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill(basename(REL, '.pdf'))
    await page.locator('.pal-row', { hasText: basename(REL) }).first().click()
    await expect(tabOn(page)).toHaveText(basename(REL))
    await expect(pdfPage(page, 1).locator('canvas[data-ready="1"]')).toBeAttached({ timeout: 20_000 })
    if (!(await notes(page).isVisible())) await rail(page).getByRole('button', { name: '笔记' }).first().click()
    await expect(notes(page).getByTestId('note-hl').filter({ hasText: keyText.slice(0, 20) })).toBeVisible({ timeout: 15_000 })
    // 看不懂那一段、ParaRead 问的那一问各是右栏里的一段（收着，标题写着）
    await expect(notes(page).getByRole('button').filter({ hasText: `看不懂：${confusedText.slice(0, 16)}` })).toBeVisible()
    await expect(notes(page).getByRole('button', { name: /用一句话讲这句在说什么/ })).toBeVisible()
    await expect(notes(page).getByRole('tablist', { name: '按含义筛划线' })).toContainText('看不懂')
    await expect(hlOn(page, 1).locator('[data-testid="pdf-hl"][data-k="key"]').first()).toBeAttached({ timeout: 10_000 })
    await expect(hlOn(page, 1).locator('[data-testid="pdf-hl"][data-k="confused"]').first()).toBeAttached()
    void askText
    await shot(page, 'both-2-canvas-notes')

    // 画布笔记里划一条「定义」（第 1 页另一段）
    const cnSpan = await pdfPage(page, 1).evaluate((el) => {
      const sp = [...el.querySelectorAll('.textLayer span')].filter((s) => (s.textContent ?? '').trim().length > 40)
      const s = sp[Math.min(6, sp.length - 1)]!
      s.scrollIntoView({ block: 'center' })
      return s.textContent!.trim()
    })
    await page.waitForTimeout(300)
    const sb = (await pdfPage(page, 1).locator('.textLayer span', { hasText: cnSpan }).first().boundingBox())!
    await page.mouse.move(sb.x + 1, sb.y + sb.height / 2)
    await page.mouse.down()
    await page.mouse.move(sb.x + sb.width * 0.6, sb.y + sb.height / 2, { steps: 6 })
    await page.mouse.up()
    await pdfPane(page).getByTestId('hl-pick').filter({ hasText: '定义' }).click()
    await expect.poll(note).toContain('k=def -->')

    // ---- 3. ParaRead：马上多一条绿色的定义；换成想引用
    let def: { id: string; hl: string; color: string } | undefined
    await expect
      .poll(async () => (def = (await w.evaluate((x) => (window as any).api.annList(x), id)).find((a: { kind: string }) => a.kind === 'def')), { timeout: 15_000 })
      .toBeTruthy()
    expect(def!.color).toBe('green')
    const defEl = w.locator(`.pdf-hl[data-ann="${def!.id}"]`).first()
    await defEl.waitFor({ timeout: 10_000 })
    await defEl.scrollIntoViewIfNeeded()
    await shot(w, 'both-3-pararead')
    const db = (await defEl.boundingBox())!
    await w.mouse.click(db.x + db.width * 0.8, db.y + db.height / 2)
    await w.locator('.sel-toolbar .tb-kind.current[data-kind="def"]').waitFor({ timeout: 5000 })
    await w.locator('.sel-toolbar .tb-kind[data-kind="cite"]').click()
    await expect.poll(note).toContain(`cn:hl=${def!.hl} k=cite -->`)

    // ---- 4. 画布笔记：那一条成了想引用；右键 ParaRead 划的重点，删掉
    await expect(hlOn(page, 1).locator('[data-testid="pdf-hl"][data-k="cite"]').first()).toBeAttached({ timeout: 15_000 })
    await expect(notes(page).getByTestId('note-hl').filter({ hasText: cnSpan.slice(0, 20) })).toContainText('想引用')
    const keyEl = hlOn(page, 1).locator('[data-testid="pdf-hl"][data-k="key"]').first()
    await keyEl.scrollIntoViewIfNeeded()
    const kb = (await keyEl.boundingBox())!
    await page.mouse.click(kb.x + kb.width / 2, kb.y + kb.height / 2, { button: 'right' })
    await pickMenu(run, '删掉这条划线')
    await expect.poll(note).not.toContain('k=key -->')
    await shot(page, 'both-4-canvas-notes')

    // ---- 5. ParaRead：重点那一条没了，别的照旧
    await expect
      .poll(async () => (await w.evaluate((x) => (window as any).api.annList(x), id)).map((a: { kind: string }) => a.kind).sort().join(','), { timeout: 15_000 })
      .toBe('cite,confused')
    await shot(w, 'both-5-pararead')
  } finally {
    if (pr) await pr.evaluate(({ app }) => app.quit()).catch(() => undefined)
    await run.close()
  }
})
