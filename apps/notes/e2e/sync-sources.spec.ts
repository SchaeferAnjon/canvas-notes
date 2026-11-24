/**
 * 同步来源 · Get笔记（设计页 61-同步来源）：真点真读盘，Get笔记 是本机的假服务（fixtures/fake-getnote.ts），不碰用户真的账号。
 * 没接的人只看到「接一个…」；Key 错了说人话；接上、第一次只拉勾的；定时拉（和自动化共用的钟）；开软件时拉一次；
 * 那边改了、删了；拉取记录里撤回；断开。Key 不落盘（测试实例的钥匙串只在内存里）。
 */
import { _electron as electron, expect, type Page, test } from '@playwright/test'
import electronPath from 'electron'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, type Running } from './app'
import { type FakeGetnote, GN_CLIENT, GN_KEY, gid, sampleNotes, startFakeGetnote, VAULT_HAS } from './fixtures/fake-getnote'

let fake: FakeGetnote
test.beforeAll(async () => {
  fake = await startFakeGetnote(sampleNotes())
})
test.afterAll(() => fake.server.close())
test.beforeEach(() => {
  fake.notes = sampleNotes()
  fake.mode = 'ok'
})

const FOLDER = '40-Clippings/Getnotes'
const env = (extra: Record<string, string> = {}) => ({ CN_GETNOTE_API: fake.base, CN_GETNOTE_GAP_MS: '0', ...extra })
const dlg = (page: Page) => page.getByRole('dialog', { name: '设置' })
const nav = (page: Page) => dlg(page).getByRole('navigation', { name: '设置分页' })
const group = (page: Page, name: string) => dlg(page).getByRole('group', { name, exact: true })
const toast = (page: Page) => dlg(page).getByTestId('settings-toast')
const read = (run: { vault: string }, p: string) => readFileSync(join(run.vault, p), 'utf8')
const commits = (run: { vault: string }) => execFileSync('git', ['-C', run.vault, 'log', '--format=%s'], { encoding: 'utf8' }).trim().split('\n')
const status = (run: { vault: string }) => execFileSync('git', ['-C', run.vault, 'status', '--porcelain'], { encoding: 'utf8' }).trim()

async function openVaultPage(page: Page) {
  await page.keyboard.press('Meta+Comma')
  await nav(page).getByRole('button', { name: '库', exact: true }).click()
  await expect(dlg(page).getByRole('heading', { name: '库' })).toBeVisible()
}

/** 整个文件夹里有没有这串字（Key 不该落盘） */
function grepDir(dir: string, needle: string): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (statSync(p).size < 20_000_000 && readFileSync(p).includes(needle)) out.push(p)
    }
  }
  walk(dir)
  return out
}

/** 填 Key 连上，交回对话框 */
async function connect(page: Page, key = GN_KEY) {
  const g = group(page, '同步来源')
  await g.getByRole('button', { name: '接一个…' }).click()
  await dlg(page).getByRole('menuitem', { name: /Get笔记/ }).click()
  await expect(dlg(page).getByRole('heading', { name: 'Get笔记' })).toBeVisible()
  await dlg(page).getByLabel('API Key', { exact: true }).fill(key)
  await dlg(page).getByLabel('Client ID', { exact: true }).fill(GN_CLIENT)
  await dlg(page).getByRole('button', { name: '连上' }).click()
}

test('没接任何来源：同步来源一组只有「接一个…」；Key 错了说人话、不存；Key 对了第一次只拉勾的', async () => {
  const run = await launch(VAULT_HAS, env())
  const { page } = run
  try {
    await page.setViewportSize({ width: 1300, height: 860 })
    await openVaultPage(page)
    const g = group(page, '同步来源')
    await expect(g.locator('.sa-row')).toHaveCount(1)
    await expect(g).toContainText('从别的服务拉进库')
    await expect(g).not.toContainText('Get笔记')
    // 小菜单：库里已经有 Get笔记 拉进来的，排第一个、写库里有几篇；还没做的几家点不了
    await g.getByRole('button', { name: '接一个…' }).click()
    const items = dlg(page).getByRole('menuitem')
    await expect(items.first()).toContainText('库里有11篇来自Get笔记，接上就能接着拉')
    await expect(dlg(page).getByRole('menuitem', { name: /Readwise/ })).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(dlg(page).getByRole('menu')).toHaveCount(0)

    // Key 错了
    await connect(page, 'gk_live_wrongkey0001')
    const alert = dlg(page).getByRole('alert')
    await expect(alert).toContainText('Get笔记不认这个Key：看看API Key和Client ID有没有抄全、是不是同一个应用的')
    await expect(alert).not.toContainText('10004')
    await expect(alert.getByRole('button', { name: '去开放平台 ›' })).toBeVisible()
    expect(await page.evaluate(() => window.cn.sources.list())).toMatchObject({ sources: [] })
    expect(existsSync(join(run.vault, '.canvas-notes/同步来源/getnote.json'))).toBe(false)

    // Key 对了：对话框分新旧，默认只勾新的（空录音不算）
    await dlg(page).getByLabel('API Key', { exact: true }).fill(GN_KEY)
    await dlg(page).getByRole('button', { name: '连上' }).click()
    const first = page.getByRole('dialog', { name: '连上了：Get笔记里有17篇' })
    await expect(first).toBeVisible()
    await expect(first).toContainText('库里已经有10篇（认出getnote_id），还差7篇：')
    await expect(first).toContainText('5篇比库里最新那篇（9月7日）还新')
    await expect(first).toContainText('1篇链接、1篇课堂录音、1篇录音、1篇图片、1篇文字；其中1篇是空录音，照「跳过空录音」不拉')
    await expect(first.getByRole('button', { name: '拉4篇' })).toBeVisible()
    // 更早的能展开一篇篇勾，按钮上的篇数跟着变
    await first.getByRole('button', { name: '展开勾几篇' }).click()
    await first.getByRole('checkbox', { name: /更早的一篇/ }).check()
    await expect(first.getByRole('button', { name: '拉5篇' })).toBeVisible()
    await first.getByRole('checkbox', { name: /更早的一篇/ }).uncheck()
    await page.screenshot({ path: 'test-results/sync-sources/1-第一次连上.png' })
    await first.getByRole('button', { name: '拉4篇' }).click()
    await expect(first).toHaveCount(0, { timeout: 20_000 })
    await expect(toast(page)).toContainText('Get笔记：拉了4篇进40-Clippings/Getnotes')
    await expect(toast(page).getByRole('button', { name: '撤回' })).toBeVisible()

    // 盘上：四篇、四张图（一张在链接原文里），照用户库的写法，一次提交，Key 不落盘
    const kindle = read(run, `${FOLDER}/旧 Kindle 越狱：装上读书插件.md`)
    expect(kindle).toContain(`getnote_id: ${gid(30)}`)
    expect(kindle).toContain('url: "https://mp.weixin.qq.com/s?__biz=MzA5&mid=2448525734&idx=1&sn=863f"')
    expect(kindle).toContain('![](../../附件/40-Clippings/Getnotes/旧%20Kindle%20越狱：装上读书插件/图1.png)')
    expect(kindle).not.toMatch(/127\.0\.0\.1|getnotes\.seek|pass_ticket/)
    expect(existsSync(join(run.vault, '附件/40-Clippings/Getnotes/多 Agent 配置指南/图2.png'))).toBe(true)
    expect(existsSync(join(run.vault, `${FOLDER}/鼠标垫.md`))).toBe(false)
    expect(existsSync(join(run.vault, `${FOLDER}/更早的一篇.md`))).toBe(false)
    expect(commits(run)[0]).toBe('同步来源 Get笔记：拉了4篇 · 下了4张图；跳过1篇空录音')
    expect(status(run)).toBe('')
    expect(grepDir(run.vault, GN_KEY)).toEqual([])
    expect(grepDir(run.userData, GN_KEY)).toEqual([])

    // 子页：Key 只显示最后 4 位、文件夹自己认出来、拉取记录一行能看是哪几篇
    await expect(dlg(page).locator('.src-keyshow').first()).toHaveText('••••0001')
    await expect(dlg(page).locator('[data-row="sourceFolder"] .src-keyshow')).toHaveText(FOLDER)
    await expect(dlg(page).locator('[data-row="sourceDedupe"]')).toContainText('已认出16篇')
    const row = dlg(page).locator('[data-row^="sourceRun-"]').first()
    await expect(row).toContainText('拉了4篇 · 下了4张图 · 跳过1篇空录音')
    await row.getByRole('button', { name: '看是哪几篇 ›' }).click()
    await expect(row.locator('.src-files li')).toHaveCount(4)
    await page.screenshot({ path: 'test-results/sync-sources/2-子页.png' })
    await dlg(page).locator('.set-body').evaluate((e) => (e.scrollTop = e.scrollHeight))
    await page.screenshot({ path: 'test-results/sync-sources/3-子页下半.png' })

    // 回到库：一行 Get笔记，上次拉了什么、多久拉、放哪
    await dlg(page).getByRole('button', { name: '回到库' }).click()
    const line = group(page, '同步来源').locator('[data-source="getnote"]')
    await expect(line).toContainText('拉了4篇')
    await expect(line).toContainText('开软件时和每2小时 · 40-Clippings/Getnotes')
    await expect(group(page, '同步来源')).toContainText('再接一个')
    await page.screenshot({ path: 'test-results/sync-sources/4-库页.png' })
  } finally {
    await run.close()
  }
})

test('定时拉（和自动化共用的钟）：到点拉新的，底栏一句带「看一眼」「撤回」；设置 › 自动化里多一行；同一天第二次不全量', async () => {
  const run = await launch(VAULT_HAS, env())
  const { page, app } = run
  try {
    await openVaultPage(page)
    await connect(page)
    await page.getByRole('dialog', { name: /连上了/ }).getByRole('button', { name: '拉4篇' }).click()
    await expect(toast(page)).toContainText('拉了4篇')
    await page.keyboard.press('Escape')
    await expect(dlg(page)).toHaveCount(0)

    // 那边新存了一篇；一个小时以后看钟：还没到（每 2 小时），不拉
    fake.notes.unshift({ id: gid(41), title: '刚存的一篇', content: '新的', note_type: 'plain_text', created_at: '2026-11-23 09:00:00', updated_at: '2026-11-23 09:00:00' })
    const tick = (ms: number) =>
      app.evaluate(async (_e, ms) => {
        const g = globalThis as unknown as { cnSourcesNow?: string; cnSources: { tick(iso: string): void; idle(): Promise<unknown> } }
        const at = new Date(Date.now() + ms).toISOString()
        g.cnSourcesNow = at
        g.cnSources.tick(at)
        await new Promise((r) => setTimeout(r, 300))
        await g.cnSources.idle()
      }, ms)
    await tick(60 * 60_000)
    expect(existsSync(join(run.vault, `${FOLDER}/刚存的一篇.md`))).toBe(false)
    // 两个小时以后：拉了
    fake.requests = []
    await tick(2 * 60 * 60_000 + 60_000)
    await expect.poll(() => existsSync(join(run.vault, `${FOLDER}/刚存的一篇.md`))).toBe(true)
    expect(fake.requests.filter((r) => r.includes('/list')).length).toBe(1)
    const bar = page.getByTestId('toast').filter({ hasText: 'Get笔记：拉了1篇' })
    await expect(bar).toBeVisible()
    await expect(bar.getByRole('button', { name: '看一眼' })).toBeVisible()
    await page.screenshot({ path: 'test-results/sync-sources/5-定时拉底栏.png' })
    await expect.poll(() => commits(run)[0]).toBe('同步来源 Get笔记：拉了1篇')

    // 设置 › 自动化「软件自带的」里有这一行
    await page.keyboard.press('Meta+Comma')
    await nav(page).getByRole('button', { name: '自动化', exact: true }).click()
    const auto = dlg(page).locator('[data-row="autoSource-getnote"]')
    await expect(auto).toContainText('同步来源 · Get笔记')
    await expect(auto).toContainText('开软件时和每2小时 · 40-Clippings/Getnotes')
    await expect(auto).toContainText('跑过2次')
    await page.screenshot({ path: 'test-results/sync-sources/6-自动化页.png' })
    // 关掉：库页那一行跟着关
    await auto.getByRole('switch').click()
    await nav(page).getByRole('button', { name: '库', exact: true }).click()
    await expect(group(page, '同步来源').locator('[data-source="getnote"]').getByRole('switch')).toHaveAttribute('aria-checked', 'false')
    expect(JSON.parse(read(run, '.canvas-notes/同步来源/getnote.json')).settings.on).toBe(false)
  } finally {
    await run.close()
  }
})

test('开软件时拉一次；那边改了：没动过的换新、动过的只标；那边删了只标；拉取记录里撤回；断开', async () => {
  // 先接上拉一次（第一个实例），再用同一个库、带着 Key 重开（测试实例的钥匙串只在内存里）
  const run1 = await launch(VAULT_HAS, env())
  let vault = ''
  try {
    await openVaultPage(run1.page)
    await connect(run1.page)
    await run1.page.getByRole('dialog', { name: /连上了/ }).getByRole('button', { name: '拉4篇' }).click()
    await expect(toast(run1.page)).toContainText('拉了4篇')
    vault = run1.vault
  } finally {
    await run1.close({ keep: true })
  }
  // 用户改了 Kindle 那篇；那边改了 Kindle 和对人骨两篇、删了一篇老的、新存了一篇
  const kindlePath = join(vault, `${FOLDER}/旧 Kindle 越狱：装上读书插件.md`)
  execFileSync('sh', ['-c', `printf '\\n我自己加的一行\\n' >> "${kindlePath}" && git -C "${vault}" commit -qam 用户改了`])
  const kindle = fake.notes.find((n) => n.id === gid(30))!
  kindle.updated_at = '2026-11-24 08:00:00'
  kindle.content += '\n\n那边补了一段'
  const bone = fake.notes.find((n) => n.id === gid(28))!
  bone.updated_at = '2026-11-24 08:00:00'
  bone.content = '### 📑 智能总结\n- 那边重写了总结'
  fake.notes = fake.notes.filter((n) => n.id !== gid(101))
  fake.notes.unshift({ id: gid(42), title: '开软件时拉到的', content: '新的', note_type: 'plain_text', created_at: '2026-11-23 09:00:00', updated_at: '2026-11-23 09:00:00' })

  // 重开：开软件时拉一次（到了第二天，每天第一次顺带全量对账）
  const tomorrow = new Date(Date.now() + 86400_000).toISOString()
  const app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [join(__dirname, '../out/main/index.js')],
    env: { ...process.env, CN_VAULT: vault, CN_USER_DATA: run1.userData, CN_E2E: '1', CN_NO_AX: '1', CN_QUICK_KEY: 'Alt+Command+Shift+F19', ...env({ CN_E2E_GETNOTE_KEY: GN_KEY, CN_E2E_GETNOTE_CLIENT: GN_CLIENT, CN_SOURCES_NOW: tomorrow }) },
  })
  const page = await app.firstWindow()
  const run = { vault, page, app }
  try {
    await expect(page.locator('.vault b')).toHaveText('测试库')
    await expect.poll(() => existsSync(join(vault, `${FOLDER}/开软件时拉到的.md`)), { timeout: 20_000 }).toBe(true)
    await expect.poll(() => read(run, `${FOLDER}/对人骨的疑问.md`)).toContain('那边重写了总结')
    const k = read(run, `${FOLDER}/旧 Kindle 越狱：装上读书插件.md`)
    expect(k).toContain('我自己加的一行')
    expect(k).not.toContain('那边补了一段')
    expect(k).toContain('getnote_newer: 2026-11-24 08:00:00')
    expect(read(run, `${FOLDER}/AI-Tech/早就有的 1.md`)).toMatch(/getnote_deleted: \d{4}-\d{2}-\d{2}/)
    await expect.poll(() => commits(run)[0]).toMatch(/^同步来源 Get笔记：拉了1篇；1篇Get笔记那边改了，换成新的；1篇标了「Get笔记里有新版」；1篇标了「Get笔记里删了」/)

    // 拉取记录里撤回刚才那一次：新拉的那篇没了，换新的那篇换回去，之后也不拉回来
    await openVaultPage(page)
    await group(page, '同步来源').locator('[data-source="getnote"]').click()
    const row = dlg(page).locator('[data-row^="sourceRun-"]').first()
    await expect(row).toContainText('拉了1篇')
    await row.getByRole('button', { name: '撤回' }).click()
    await expect(toast(page)).toContainText('撤回了')
    expect(existsSync(join(vault, `${FOLDER}/开软件时拉到的.md`))).toBe(false)
    expect(read(run, `${FOLDER}/对人骨的疑问.md`)).not.toContain('那边重写了总结')
    await expect(row).toContainText('撤回了')
    expect(status(run)).toBe('')
    await dlg(page).getByRole('button', { name: '现在拉一次' }).last().click()
    await expect(toast(page)).toContainText('Get笔记：没有新的')
    expect(existsSync(join(vault, `${FOLDER}/开软件时拉到的.md`))).toBe(false)

    // 断开：确认框里才有红字；Key 删了，拉来的都在，库页回到只有「接一个…」
    await dlg(page).getByRole('button', { name: '断开…' }).click()
    const ask = page.getByRole('alertdialog', { name: '断开Get笔记？' })
    await expect(ask).toBeVisible()
    await page.screenshot({ path: 'test-results/sync-sources/7-断开.png' })
    await ask.getByRole('button', { name: '断开', exact: true }).click()
    await expect(dlg(page).getByRole('heading', { name: '库' })).toBeVisible()
    await expect(group(page, '同步来源').locator('[data-source]')).toHaveCount(0)
    await expect(group(page, '同步来源')).toContainText('从别的服务拉进库')
    expect(existsSync(kindlePath)).toBe(true)
    expect((await page.evaluate(() => window.cn.sources.list())).sources).toEqual([])
  } finally {
    await app.close()
    rmSync(dirname(vault), { recursive: true, force: true })
  }
})
