// 软件自己的文件不当笔记、不当附件（2026-11-25 用户看梦游报告左栏「收件箱 · 拿不准的：1 条留着不动 · .首页.json：这是隐藏的 json 文件，
// 像软件自己的首页配置……」问「这是为什么?」）。一份清单一个判断（@cn/format 的 isAppFile），全部真点：
// 1. 白板笔迹 附件/<白板>/笔迹.ink：目录树里没有、「清理」的确认框不列、点「移到废纸篓」它一个字节不动（以前算成没用到，一清就把手写挪进废纸篓）；
// 2. 收件箱里的 .首页.json、. 开头的笔记、.obsidian/ 里的 md：「现在梦游」的报告里没有，⌘F 搜不到；正常笔记照旧归类、搜得到。
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, leftView, type Running } from './app'
import { solidPng } from './fixtures/png'

const SHOTS = process.env.CN_SHOTS
async function shot(run: Running, name: string) {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  await run.page.waitForTimeout(400)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(b64, 'base64'))
}
const git = (root: string, args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
const mint = (v: string) => {
  const ud = join(dirname(v), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: 'mint', frame: 'b', winBg: 'aurora' } }))
  // 放了一小时的（1 分钟内刚加的算拿不准，不清）
  const old = (Date.now() - 3600_000) / 1000
  for (const f of ['附件/项目/计划白板/卡.png', '附件/项目/计划白板/没用的.png', '附件/项目/计划白板/笔迹.ink', '附件/项目/计划白板/.DS_Store']) if (existsSync(join(v, f))) utimesSync(join(v, f), old, old)
}

const INK = '{"ink":1}\n{"g":"k2m9q4ta","x":160,"y":120}\n{"id":"r8f2k1zq","g":"k2m9q4ta","pen":"pen","c":"#2459c6","p":"0,0,300,500,0;2000,800,0,0,16;2000,-400,0,0,16"}\n'
const W = '附件/项目/计划白板'
const BOARD: Record<string, string | Uint8Array> = {
  '项目/计划白板.md': `---\ntype: board\n---\n# 计划白板\n\n<!-- card id=a1 x=120 y=300 w=280 -->\n![](../${W}/卡.png)\n`,
  [`${W}/卡.png`]: solidPng(160, 100, [40, 120, 200]),
  [`${W}/没用的.png`]: solidPng(160, 100, [210, 90, 150]),
  [`${W}/笔迹.ink`]: INK,
  [`${W}/.DS_Store`]: 'x',
}

const tree = (page: Page) => page.locator('aside.side').getByRole('tree')
const row = (page: Page, p: string) => tree(page).locator(`[data-sel="${p}"]`)

test('白板笔迹不是附件：树里没有，「清理」不列它，移到废纸篓以后它一个字节不动', async () => {
  test.setTimeout(150_000)
  const run = await launch(BOARD, {}, mint)
  const { page, vault } = run
  try {
    await leftView(page, '文件')
    for (const p of ['附件', '附件/项目', W]) {
      const r = row(page, p)
      if ((await r.getAttribute('aria-expanded')) !== 'true') await r.locator('.ft-tw').click()
    }
    await expect(row(page, `${W}/没用的.png`)).toBeVisible()
    await shot(run, '1-附件树')
    // 树里只有两张图：笔迹.ink、.DS_Store 不列
    await expect(tree(page).locator(`.ft-att[data-path^="${W}/"]`)).toHaveCount(2)
    await expect(row(page, `${W}/笔迹.ink`)).toHaveCount(0)
    await expect(row(page, `${W}/没用的.png`).locator('.ft-use')).toHaveText('没用到')
    await expect(row(page, `${W}/卡.png`).locator('.ft-use')).toHaveText('被1篇用')

    const clean = tree(page).getByRole('button', { name: '清理', exact: true })
    await expect(clean).toHaveAttribute('title', '清理1个没用到的附件')
    await clean.click()
    const dlg = page.getByRole('dialog', { name: '清理没用到的附件' })
    await expect(dlg).toBeVisible()
    await shot(run, '2-清理确认框')
    await expect(dlg.getByRole('list', { name: '要清理的附件' }).locator('.t1')).toHaveText(['没用的.png'])
    await expect(dlg.getByRole('list', { name: '拿不准，不清' })).toHaveCount(0)
    await dlg.getByRole('button', { name: '移到废纸篓1个' }).click()
    await expect.poll(() => existsSync(join(vault, `${W}/没用的.png`))).toBe(false)
    await expect.poll(() => git(vault, ['log', '-1', '--format=%s'])).toBe('清理没用到的附件 1 个')
    expect(git(vault, ['show', '--name-only', '--format=', 'HEAD'])).toBe(`${W}/没用的.png`)
    expect(readFileSync(join(vault, `${W}/笔迹.ink`), 'utf8')).toBe(INK)
    expect(existsSync(join(vault, `${W}/卡.png`))).toBe(true)
    // 清完了：没有能清的，按钮不在
    await expect(tree(page).getByRole('button', { name: /^清理/ })).toHaveCount(0)
    // 白板照样打开、笔迹照样画（Mac 只能改，画在笔迹层上）
    const proj = row(page, '项目')
    if ((await proj.getAttribute('aria-expanded')) !== 'true') await proj.locator('.ft-tw').click()
    await row(page, '项目/计划白板.md').click()
    await expect(page.locator('[data-testid="db-ink"]:visible')).toHaveAttribute('data-strokes', '1', { timeout: 15_000 })
    await shot(run, '3-清理后白板笔迹还在')
  } finally {
    await run.close()
  }
})

const INBOX: Record<string, string> = {
  '收件箱/极光.md': '---\ncreated: 2026-11-14 21:20\n---\n极光要看太阳风和云量，云量低于三成、KP 指数到 3 以上就值得出门。\n',
  '收件箱/冰洞.md': '---\ncreated: 2026-11-14 21:10\n---\n冰洞只在冬天开放，必须跟导游进去，提前两周订。\n',
  '收件箱/.首页.json': '{"cards":[{"path":"收件箱/极光.md","x":0,"y":0}]}\n',
  '收件箱/.极光草稿.md': '藏起来的极光草稿，KP 指数。\n',
  '.obsidian/极光模板.md': '极光模板，KP 指数。\n',
  '剪藏/旅行/雷克雅未克.md': '# 雷克雅未克\n\n城里看不到极光，要开车出城。\n',
}

test('收件箱里的 .首页.json、. 开头的笔记、.obsidian/ 里的：梦游报告里没有，⌘F 搜不到；正常笔记照旧归类、搜得到', async () => {
  test.setTimeout(180_000)
  const run = await launch(INBOX, { CN_AI_FAKE: '1' }, mint)
  const { page } = run
  try {
    const panel = page.getByRole('complementary', { name: '梦游报告' })
    await leftView(page, '梦游报告')
    await panel.getByRole('button', { name: '现在梦游' }).click()
    await expect(panel.getByTestId('dream-summary')).toContainText('收下才合进main', { timeout: 120_000 })
    const file = panel.getByRole('region', { name: '归类和改名' })
    await expect(file.getByTestId('dream-item')).toHaveCount(2)
    await shot(run, '4-梦游报告')
    await expect(panel).not.toContainText('首页')
    await expect(panel).not.toContainText('极光草稿')
    await expect(panel).not.toContainText('极光模板')
    // 拿不准、留着不动的：一条都没有（以前 .首页.json 送给 AI、AI 判「留着」，列在这里等用户定）
    await expect(file.locator('.dstay')).toHaveCount(0)
    await expect(panel.getByTestId('dream-stay-why')).toHaveCount(0)

    // ⌘F：搜「KP 指数」只有收件箱里那篇
    await page.keyboard.press('Meta+f')
    const pal = page.getByRole('dialog', { name: '搜索和命令' })
    await pal.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('KP 指数')
    // 「网页和AI」那两行（网页搜、让 Claude 找）不算
    const hits = pal.getByRole('listbox', { name: '结果' }).getByRole('option').filter({ hasNotText: /google|Claude/ })
    await expect(hits.filter({ hasText: '极光' }).first()).toBeVisible({ timeout: 15_000 })
    await shot(run, '5-搜索')
    await expect(hits).toHaveCount(1)
    await expect(pal).not.toContainText('极光草稿')
    await expect(pal).not.toContainText('极光模板')
  } finally {
    await run.close()
  }
})
