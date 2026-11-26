/**
 * 梦游挪去处可选高亮（偏好「梦游挪去处可选高亮」，用户截图 0.5.12 梦游报告 › 归类和改名「《动手学深度学习》收件箱 · 挪到词条」）：
 * 中间梦游对照那行「→ 收件箱/ 原名 → 词条/ 新名」的去处是高亮的文件夹胶囊、新名字是能改的胶囊，都是真点：
 * ① 点去处胶囊弹「移到…」小弹层（files/move-pick.tsx）：打字找、刚挪去过、↑↓ 选一个再「新建文件夹…」建在它里面，选了就改这一条；
 * ② 改名：点名字原地改，esc 不改，回车定；名字重了加序号、底栏说一声；
 * ③ 左栏同一条跟着换（按去处分的小组、标题）；关掉再开报告还是改后的，报告文件里记着梦游原来的建议；
 * ④ 收下：文件真到了新文件夹、叫新名字，提到它的双链跟着换成新名，一次提交、工作区干净；
 * ⑤ 撤回：文件回收件箱、双链回原样，这一条回到待看、去处还是改后的；没改的那条（极光）照旧挪到 剪藏/旅行/极光 2。
 * 给了 CN_SHOTS（目录）时截交付图：薄荷、深湖各一套（改后的那一行、点开的文件夹选择、改名输入框、左栏同步）。
 */
import { expect, type Locator, type Page, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { gitStatus, launch, type Running } from './app'
import { DREAM2_VAULT, prepareDream2, TRIP } from './fixtures/dream2'

const DIR = process.env.CN_SHOTS
const ENTRY = '收件箱/《动手学深度学习》.md'
const MENTION = '剪藏/学习笔记：动手学深度学习.md'

/** 用户截图里那一篇：以前梦游建在收件箱里的词条页（类型: 词条），梦游建议挪进「词条/」；另一篇剪藏提到它 */
const VAULT: Record<string, string | Uint8Array> = {
  ...DREAM2_VAULT,
  [ENTRY]: '---\n类型: 词条\n来源: 梦游建议\n---\n# 《动手学深度学习》\n\n一本教材，笔记库里用的是 PyTorch 版。\n',
  [MENTION]: '---\nsource: https://example.com/d2l\n---\n# 学习笔记：动手学深度学习\n\n这周跟着 [[《动手学深度学习》]] 读第 3 章。\n',
}

async function shot(run: Running, name: string) {
  if (!DIR) return
  // 指针挪开：截图里不留按钮的悬停提示
  await run.page.mouse.move(1150, 860)
  await run.page.waitForTimeout(450)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(DIR, `${name}.png`), Buffer.from(b64, 'base64'))
}

async function dreamed(skin: 'mint' | 'petrol'): Promise<{ run: Running; page: Page; panel: Locator }> {
  const run = await launch(VAULT, { CN_AI_FAKE: '1' }, (vault) => {
    prepareDream2(vault)
    const ud = join(dirname(vault), 'user-data')
    mkdirSync(ud, { recursive: true })
    writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin, frame: 'b', winBg: 'aurora' } }))
  })
  const { page } = run
  await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1600, 900))
  const card = page.getByTestId('dream-card')
  await card.getByRole('button', { name: '现在梦游' }).click()
  await expect(card.locator('h3')).toContainText('等你过目', { timeout: 90_000 })
  await card.getByRole('button', { name: '看报告' }).click()
  const panel = page.getByRole('complementary', { name: '梦游报告' })
  await expect(panel.getByTestId('dream-item').first()).toBeVisible()
  return { run, page, panel }
}

const git = (vault: string, ...args: string[]) => execFileSync('git', ['-C', vault, '-c', 'core.quotepath=false', ...args], { encoding: 'utf8' })
const dtab = (page: Page) => page.locator('[data-testid="dream-tab"]:not([hidden])')
const item = (panel: Locator, text: string | RegExp) => panel.getByTestId('dream-item').filter({ hasText: text })
/** 左栏「归类和改名」里这个去处的小组头 */
const group = (panel: Locator, folder: string) => panel.locator('.dsub').filter({ has: panel.page().locator('.truncate', { hasText: new RegExp(`^${folder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) })
/** 报告文件（软件设置目录 dream/<库>.json）里这一条 */
function reportItem(run: Running, title: RegExp) {
  const d = join(run.userData, 'dream')
  const f = readdirSync(d).find((n) => /^[0-9a-f]{16}\.json$/.test(n))!
  const r = JSON.parse(readFileSync(join(d, f), 'utf8')) as { items: { title: string; move?: { from: string; to: string }; picked?: { to: string }; state: string }[] }
  return r.items.find((i) => title.test(i.title))!
}

for (const skin of ['mint', 'petrol'] as const) {
  test(`梦游挪去处：改文件夹、新建文件夹、改名、左栏同步、重开还在、收下真挪、撤回回原样（${skin === 'mint' ? '薄荷' : '深湖'}）`, async () => {
    test.skip(!DIR && skin !== 'mint', '不截图时只跑一套')
    test.setTimeout(300_000)
    if (DIR) mkdirSync(DIR, { recursive: true })
    const { run, page, panel } = await dreamed(skin)
    const t = dtab(page)
    const mv = t.getByTestId('dream-move')
    const dest = mv.getByTestId('dream-dest')
    const name = mv.getByTestId('dream-name')
    const picker = page.locator('.movepick')
    try {
      // 用户截图那一条：收件箱里的词条页，建议挪进「词条/」
      await item(panel, '《动手学深度学习》').click()
      await expect(mv.locator('s')).toHaveText('《动手学深度学习》')
      await expect(dest).toHaveText('词条/')
      await expect(name).toHaveText('《动手学深度学习》')
      // 去处胶囊是高亮的：强调色的字、不是普通灰字
      const look = await dest.evaluate((el) => {
        const cs = getComputedStyle(el)
        const probe = document.createElement('span')
        probe.style.color = 'var(--acc-t)'
        el.append(probe)
        const acc = getComputedStyle(probe).color
        probe.remove()
        return { color: cs.color, acc, bg: cs.backgroundColor, tag: el.tagName }
      })
      expect(look.tag).toBe('BUTTON')
      expect(look.color).toBe(look.acc)
      expect(look.bg).not.toBe('rgba(0, 0, 0, 0)')
      await expect(item(panel, '《动手学深度学习》')).toContainText('挪进 词条/')
      await shot(run, `01-去处高亮-${skin}`)
      // 悬停：边换成实色强调色，出「换个文件夹」一个提示
      await dest.hover()
      await expect(page.getByTestId('tooltip')).toContainText('换个文件夹')
      if (DIR) {
        await page.waitForTimeout(450)
        const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
        writeFileSync(join(DIR, `08-悬停-${skin}.png`), Buffer.from(b64, 'base64'))
      }

      // 打开弹层停在现在的去处（「词条」库里还没有，也列出来写「新建」、打勾），直接回车去处不变
      await dest.click()
      await expect(picker).toBeVisible()
      await expect(picker.locator('.mi.kb')).toContainText('词条')
      await expect(picker.locator('.mi.kb')).toContainText('新建')
      await expect(picker.locator('.mi.kb .ck')).toHaveCount(1)
      await expect(picker.locator('.mi .ck')).toHaveCount(1)
      await picker.getByRole('searchbox').press('Enter')
      await expect(picker).toHaveCount(0)
      await expect(dest).toHaveText('词条/')
      await page.waitForTimeout(300)
      expect(reportItem(run, /《动手学深度学习》/).move?.to).toBe('词条/《动手学深度学习》.md')
      expect(reportItem(run, /《动手学深度学习》/).picked).toBeUndefined()

      // ① 点去处：「移到…」弹层，头上写哪篇，收件箱（本来就在）灰着；打字找
      await dest.click()
      await expect(picker).toBeVisible()
      await expect(picker.locator('.mv-hd')).toHaveText('把「《动手学深度学习》」移到…')
      await expect(picker.getByRole('menuitem', { name: /^收件箱/ })).toBeDisabled()
      await expect(picker.getByRole('menuitem', { name: '新建文件夹…' })).toBeVisible()
      await shot(run, `02-文件夹选择-${skin}`)
      await picker.getByRole('searchbox').fill('旅行')
      await expect(picker.getByRole('menuitem', { name: /旅行/ })).toHaveCount(1)
      await picker.getByRole('searchbox').press('Enter')
      await expect(picker).toHaveCount(0)
      await expect(dest).toHaveText('剪藏/旅行/')
      await expect(page.getByTestId('toast')).toContainText('去处改成「剪藏/旅行/」')
      // 左栏同一条挪到「剪藏/旅行」那一组
      await expect(group(panel, '剪藏/旅行')).toBeVisible()
      await expect(item(panel, '《动手学深度学习》')).toBeVisible()

      // ② 改名：esc 不改
      await name.click()
      const input = mv.getByTestId('dream-name-input')
      await expect(input).toBeFocused()
      await input.fill('随便打的')
      await input.press('Escape')
      await expect(input).toHaveCount(0)
      await expect(name).toHaveText('《动手学深度学习》')
      await expect(page.locator('.movepick')).toHaveCount(0)
      // 名字重了（剪藏/旅行 里已经有「冰岛行程」）：加序号，底栏说一声
      await name.click()
      await input.fill('冰岛行程')
      await shot(run, `03-改名输入框-${skin}`)
      await input.press('Enter')
      await expect(name).toHaveText('冰岛行程 2')
      await expect(page.getByTestId('toast')).toContainText('改叫「冰岛行程 2」')

      // ① 再换：↑↓ 选「课程」，在它里面新建「深度学习」，建好就当选了它
      await dest.click()
      await picker.getByRole('searchbox').fill('课程')
      await picker.getByRole('searchbox').press('ArrowDown')
      await picker.getByRole('searchbox').press('ArrowUp')
      await expect(picker.locator('.mi.kb')).toContainText('课程')
      await picker.getByRole('menuitem', { name: '新建文件夹…' }).click()
      const nf = picker.getByRole('textbox', { name: '新文件夹的名字' })
      // 开发版那份「新建文件夹…」（剪藏去处一起用）：占位字「新文件夹」，右边灰字写建在哪
      await expect(nf).toHaveAttribute('placeholder', '新文件夹')
      await expect(picker.locator('.mv-new .r')).toHaveText('建在「课程」里')
      await nf.fill('深度学习')
      await shot(run, `05-新建文件夹-${skin}`)
      await nf.press('Enter')
      await expect(picker).toHaveCount(0)
      await expect(dest).toHaveText('课程/深度学习/')
      expect(existsSync(join(run.vault, '课程/深度学习'))).toBe(true)
      // 刚挪去过：下次打开排在最前
      await dest.click()
      await expect(picker.locator('.mh').first()).toHaveText('刚挪去过')
      await expect(picker.getByRole('menuitem').first()).toContainText('深度学习')
      await shot(run, `06-刚挪去过-${skin}`)
      await page.keyboard.press('Escape')
      await expect(picker).toHaveCount(0)
      // 改回一个好名字
      await name.click()
      await input.fill('动手学深度学习（第二版）')
      await input.press('Enter')
      await expect(name).toHaveText('动手学深度学习（第二版）')
      // 中间的标签跟着写新名字
      await expect(page.getByRole('tab', { name: /梦游 · 动手学深度学习（第二版）/ })).toBeVisible()

      // ③ 左栏：标题换成新名字，在「课程/深度学习」那一组；条目头的为什么写着你改的
      const row = item(panel, '动手学深度学习（第二版）')
      await expect(row).toBeVisible()
      await expect(group(panel, '课程/深度学习')).toBeVisible()
      await expect(t.getByTestId('dream-why')).toContainText('你改成放进「课程/深度学习」、叫「动手学深度学习（第二版）」')
      await shot(run, `04-左栏同步-${skin}`)
      // 关掉报告、再开：还是改后的；报告文件里记着梦游原来的建议
      await panel.getByRole('button', { name: '关上梦游报告' }).click()
      await expect(panel).toHaveCount(0)
      await page.getByRole('navigation', { name: '左栏' }).getByRole('button', { name: '梦游报告' }).click()
      await expect(panel).toBeVisible()
      await item(page.getByRole('complementary', { name: '梦游报告' }), '动手学深度学习（第二版）').click()
      await expect(dest).toHaveText('课程/深度学习/')
      await expect(name).toHaveText('动手学深度学习（第二版）')
      const saved = reportItem(run, /动手学深度学习（第二版）/)
      expect(saved.move).toEqual({ from: ENTRY, to: '课程/深度学习/动手学深度学习（第二版）.md' })
      expect(saved.picked?.to).toBe('词条/《动手学深度学习》.md')
      // 还没收下：库里一个字没动
      expect(existsSync(join(run.vault, ENTRY))).toBe(true)
      expect(readFileSync(join(run.vault, MENTION), 'utf8')).toContain('[[《动手学深度学习》]]')

      // ④ 收下：真挪到新文件夹、叫新名字，提到它的双链跟着换，工作区干净
      await t.getByTestId('dream-change-bar').getByRole('button', { name: '收下' }).click()
      await expect(t.getByTestId('dream-taken')).toBeVisible()
      const moved = join(run.vault, '课程/深度学习/动手学深度学习（第二版）.md')
      expect(existsSync(moved)).toBe(true)
      expect(existsSync(join(run.vault, ENTRY))).toBe(false)
      expect(existsSync(join(run.vault, '词条/《动手学深度学习》.md'))).toBe(false)
      expect(existsSync(join(run.vault, '剪藏/旅行/冰岛行程 2.md'))).toBe(false)
      expect(readFileSync(join(run.vault, MENTION), 'utf8')).toContain('[[动手学深度学习（第二版）]]')
      expect(readFileSync(join(run.vault, MENTION), 'utf8')).not.toContain('[[《动手学深度学习》]]')
      expect(readFileSync(join(run.vault, TRIP), 'utf8')).toContain('[[极光]]')
      expect(gitStatus(run.vault)).toBe('')
      // 收下了就不能再改：胶囊只是看的
      await expect(dest).not.toHaveRole('button')
      await expect(mv.locator('button')).toHaveCount(0)
      if (DIR) {
        // 收下后 0.7 秒中间会往下走到下一条：点回这一条再截
        await item(page.getByRole('complementary', { name: '梦游报告' }), '动手学深度学习（第二版）').click()
        await expect(t.getByTestId('dream-taken')).toBeVisible()
        await shot(run, `07-收下后-${skin}`)
      }

      // ⑤ 撤回：回收件箱、双链回原样，这一条回到待看，去处还是改后的（收下后 0.7 秒中间会往下走到下一条，先点回这一条）
      await item(page.getByRole('complementary', { name: '梦游报告' }), '动手学深度学习（第二版）').click()
      await t.getByTestId('dream-head').getByRole('button', { name: '撤回' }).click()
      await expect(t.getByTestId('dream-change-bar')).toBeVisible()
      expect(existsSync(join(run.vault, ENTRY))).toBe(true)
      expect(existsSync(moved)).toBe(false)
      expect(readFileSync(join(run.vault, MENTION), 'utf8')).toContain('[[《动手学深度学习》]]')
      await expect(dest).toHaveText('课程/深度学习/')
      expect(gitStatus(run.vault)).toBe('')
      // 再打开：停在改后的去处「深度学习」那一行、打勾
      await dest.click()
      await expect(picker.locator('.mi.kb')).toContainText('深度学习')
      await expect(picker.locator('.mi.kb .ck')).toHaveCount(1)
      await page.keyboard.press('Escape')
      await expect(picker).toHaveCount(0)

      if (DIR) {
        // 交付图：中间窄于 900、去处路径很长时，两颗胶囊换到下一行、长路径省略
        await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1180, 900))
        await dest.click()
        await picker.getByRole('searchbox').fill('study project 2')
        await picker.getByRole('searchbox').press('ArrowDown')
        await picker.getByRole('searchbox').press('ArrowUp')
        await picker.getByRole('menuitem', { name: '新建文件夹…' }).click()
        const nf2 = picker.getByRole('textbox', { name: '新文件夹的名字' })
        await nf2.fill('二〇二六春季学期 · 深度学习与神经网络专题阅读材料')
        await nf2.press('Enter')
        await expect(dest).toContainText('二〇二六春季学期')
        expect(await t.evaluate((el) => el.clientWidth)).toBeLessThan(900)
        await shot(run, `09-窄栏长路径-${skin}`)
        await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1600, 900))
      }

      // 没改的那条照旧：极光挪到 剪藏/旅行/极光 2，[[极光]] 换成 [[极光 2]]
      await item(page.getByRole('complementary', { name: '梦游报告' }), '原名「极光」').click()
      await expect(dest).toHaveText('剪藏/旅行/')
      await expect(name).toHaveText('极光 2')
      await t.getByTestId('dream-change-bar').getByRole('button', { name: '收下' }).click()
      await expect(t.getByTestId('dream-taken')).toBeVisible()
      expect(existsSync(join(run.vault, '剪藏/旅行/极光 2.md'))).toBe(true)
      expect(readFileSync(join(run.vault, TRIP), 'utf8')).toContain('[[极光 2]]')
      expect(git(run.vault, 'log', '-1', '--format=%s')).toContain('极光')
    } finally {
      await run.close()
    }
  })
}
