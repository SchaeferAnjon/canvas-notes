/**
 * task-h7oy8 梦游 Wiki 化真点一遍（设计页 24-梦游底层 W 节，用户定 A1 B1 C1 D1）。窗口不上屏（CN_E2E=1），假 AI（CN_AI_FAKE=1、CN_FAKE_WIKI=1 照 wiki-fake 判），临时库：
 * - 现在梦游 → 报告里一条「2026-10-11」：三个动作各链到解剖课那一节、三分化计划里那一段；点开看证据、点「收下」→ 文件里原句变成链接，计划那段行尾多了块编号；
 *   点「撤回」→ 两个文件一字节不差回到原样；再收下；
 * - 打开那篇日记，⌘点「上斜哑铃卧推」→ 开三分化计划、光标停在那一段；⌘点「双杠臂屈伸」→ 停在第九节；
 * - 解剖课里把第九节的标题改短 → 日记里指着它的链接跟着改；
 * - 日记的右栏「相关」顶上「海德堡 · 建词条页…」→ 点了才建：库最外层「词条/」多一篇「海德堡」（不再放收件箱），嵌进欧洲史那一段（画得出来），
 *   那段行尾加了块编号；「撤销」→ 词条页没了、加过块编号的几篇一字节不差。库里有「MOC」文件夹时建在它里面。
 * - 以前建在收件箱里的词条页：梦游报告里一条「挪进 词条/」，收下才挪，提到它的双链还通（梦游对比滚动这一轮）。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { editorText, launch, leftView, openNote, pane, rail, type Running, tabOn, waitSaved } from './app'

import { ANAT, DAY, EURO, onlyLinks, PLAN, WIKI_FILES } from './fixtures/wiki'

const read = (vault: string, p: string) => readFileSync(join(vault, p), 'utf8')
const bytes = (vault: string, p: string) => readFileSync(join(vault, p))
const report = (page: Page) => page.getByRole('complementary', { name: '梦游报告' })
const related = (page: Page) => page.getByRole('complementary', { name: '相关' })
const git = (vault: string, ...a: string[]) => execFileSync('git', ['-C', vault, ...a], { encoding: 'utf8' })
/** 光标停在哪一行（goToLines 把光标放在那几行末尾） */
const caretLine = (page: Page) =>
  page.evaluate(() => {
    const n = window.getSelection()?.anchorNode
    const el = n ? (n.nodeType === 1 ? (n as Element) : n.parentElement) : null
    return (el?.closest('.cm-line') as HTMLElement | null)?.textContent ?? ''
  })

let run: Running
test.afterEach(async () => run?.close())

test('收下一条 Wiki 链接：原句里的字变成链接（那一节、那一段），那段行尾加块编号；撤回一字节不差；⌘点跳到那一段、那一节；标题改名链接跟着改', async () => {
  test.setTimeout(180_000)
  run = await launch(WIKI_FILES, { CN_AI_FAKE: '1', CN_FAKE_WIKI: '1' }, onlyLinks)
  const { page, vault } = run
  const before = Object.fromEntries(Object.keys(WIKI_FILES).map((p) => [p, bytes(vault, p)]))

  await page.evaluate(() => window.cn.dreamNow())
  await leftView(page, '梦游报告')
  const panel = report(page)
  await expect(panel.getByTestId('dream-wiki')).toContainText('Wiki 链接：问了', { timeout: 60_000 })
  const item = panel.getByTestId('dream-item').filter({ hasText: '链上 3 处：杠铃卧推、上斜哑铃卧推、双杠臂屈伸' })
  await item.click()
  const detail = panel.getByTestId('dream-detail')
  // 为什么、每处去哪在中间的条目头上：这篇那一行一次，每处一行
  const center = page.locator('[data-testid="dream-tab"]:not([hidden])')
  await expect(center.getByTestId('dream-why')).toHaveText('原句里 3 处字变成链接，字不变：2 处指着一节，1 处指着一段')
  await expect(center.getByTestId('dream-wiki-link')).toHaveText([/^杠铃卧推→《解剖02-练胸》›「八、动作评述③：杠铃卧推（多关节）」一节/, /^上斜哑铃卧推→《三分化训练计划》一段/, /^双杠臂屈伸→《解剖02-练胸》›「九、动作评述④：双杠臂屈伸（多关节） 52:56」一节/])
  await expect(center.getByTestId('dream-evidence').locator('mark')).toHaveText(['杠铃卧推', '上斜哑铃卧推', '双杠臂屈伸'])
  await expect(center.getByTestId('dream-evidence')).toContainText('AI 判的，每处的字和原话软件逐字核对过')
  // 改了两个文件：日记那一行、计划那段行尾的块编号
  await expect(detail.getByTestId('dream-change')).toHaveCount(2)
  await expect(detail.getByTestId('dream-change').filter({ hasText: '三分化训练计划' })).toContainText('看不见的编号')
  await page.screenshot({ path: test.info().outputPath('01-report-item.png') })
  // 还没收下：main 上一个字节没动
  for (const [p, b] of Object.entries(before)) expect(bytes(vault, p).equals(b)).toBe(true)

  await detail.getByRole('button', { name: '收下', exact: true }).click()
  await expect(item).toContainText('已收下')
  const id = /\^([a-z][a-z0-9]{5})/.exec(read(vault, PLAN))![1]!
  expect(read(vault, DAY)).toContain(
    `- 训练：胸·三头——[[解剖02-练胸#八、动作评述③：杠铃卧推（多关节）|杠铃卧推]] 60kg×6×3、[[三分化训练计划#^${id}|上斜哑铃卧推]] 26kg×8×3、[[解剖02-练胸#九、动作评述④：双杠臂屈伸（多关节） 52:56|双杠臂屈伸]] 自重×5、蝴蝶机夹胸 45kg。`,
  )
  expect(read(vault, PLAN)).toBe(WIKI_FILES[PLAN]!.replace('下落要慢。', `下落要慢。 ^${id}`))

  // 撤回：两个文件回到原样，一字节不差
  await panel.getByTestId('dream-detail').getByRole('button', { name: '撤回' }).click()
  await expect(item).not.toContainText('已收下')
  await expect.poll(() => bytes(vault, DAY).equals(before[DAY]!)).toBe(true)
  expect(bytes(vault, PLAN).equals(before[PLAN]!)).toBe(true)
  // 再收下
  await item.click()
  await panel.getByTestId('dream-detail').getByRole('button', { name: '收下', exact: true }).click()
  await expect(item).toContainText('已收下')
  const id2 = /\^([a-z][a-z0-9]{5})/.exec(read(vault, PLAN))![1]!

  // 打开日记：屏上字不变，只是变成链接
  await leftView(page, '最近')
  await openNote(page, '2026-10-11')
  const doc = pane(page)
  await expect(doc.locator('.cm-wikilink', { hasText: '上斜哑铃卧推' })).toBeVisible()
  await expect(doc.locator('.cm-content')).toContainText('训练：胸·三头——杠铃卧推 60kg×6×3、上斜哑铃卧推 26kg×8×3、双杠臂屈伸 自重×5、蝴蝶机夹胸 45kg。')
  await page.screenshot({ path: test.info().outputPath('02-journal-links.png') })
  // ⌘点「上斜哑铃卧推」：开三分化计划，光标停在那一段
  await doc.locator('.cm-wikilink', { hasText: '上斜哑铃卧推' }).click({ modifiers: ['Meta'] })
  await expect(tabOn(page)).toHaveText('三分化训练计划')
  await expect.poll(() => caretLine(page)).toContain('上斜哑铃卧推（辅助）')
  // 块编号在编辑器里看不见
  await expect(pane(page).locator('.cm-content')).not.toContainText(`^${id2}`)
  await page.screenshot({ path: test.info().outputPath('03-jump-block.png') })
  // 回到日记，⌘点「双杠臂屈伸」：停在第九节
  await openNote(page, '2026-10-11')
  await pane(page).locator('.cm-wikilink', { hasText: '双杠臂屈伸' }).click({ modifiers: ['Meta'] })
  await expect(tabOn(page)).toHaveText('解剖02-练胸')
  await expect.poll(() => caretLine(page)).toContain('双杠臂屈伸身体前倾练胸')
  await page.screenshot({ path: test.info().outputPath('04-jump-heading.png') })

  // 解剖课里把第九节的标题改短：日记里指着它的链接跟着改
  const head = pane(page).locator('.cm-line', { hasText: '九、动作评述④：双杠臂屈伸（多关节） 52:56' })
  await head.click()
  await page.keyboard.press('End')
  for (let i = 0; i < ' 52:56'.length; i++) await page.keyboard.press('Backspace')
  await waitSaved(page)
  await expect.poll(() => read(vault, ANAT)).toContain('## 九、动作评述④：双杠臂屈伸（多关节）\n')
  await expect.poll(() => read(vault, DAY)).toContain('[[解剖02-练胸#九、动作评述④：双杠臂屈伸（多关节）|双杠臂屈伸]]')
  expect(read(vault, DAY)).not.toContain('52:56')
  // 改了标题以后 ⌘点照样跳得到
  await openNote(page, '2026-10-11')
  await expect.poll(() => editorText(page)).toContain('双杠臂屈伸（多关节）|双杠臂屈伸]]')
  await pane(page).locator('.cm-wikilink', { hasText: '双杠臂屈伸' }).click({ modifiers: ['Meta'] })
  await expect(tabOn(page)).toHaveText('解剖02-练胸')
  await expect.poll(() => caretLine(page)).toContain('双杠臂屈伸身体前倾练胸')
})

test('词条页只建议、点了才建：右栏「相关」顶上「建词条页…」→ 「词条/」多一篇，嵌进那一段（画得出来），那段行尾加块编号；撤销一字节不差', async () => {
  test.setTimeout(180_000)
  run = await launch(WIKI_FILES, { CN_AI_FAKE: '1', CN_FAKE_WIKI: '1' }, onlyLinks)
  const { page, vault } = run
  await page.evaluate(() => window.cn.dreamNow())
  await leftView(page, '梦游报告')
  // 报告里一条「可以建的词条页」：只是建议，没有提交
  const panel = report(page)
  const sug = panel.getByTestId('dream-item').filter({ hasText: '「海德堡」' })
  await expect(sug).toContainText('还没有讲它的一篇', { timeout: 60_000 })
  await sug.click()
  await expect(panel.getByTestId('dream-entry-notes')).toContainText('提到它的')
  await expect(panel.getByTestId('dream-entry-make')).toHaveText('建词条页')
  await page.screenshot({ path: test.info().outputPath('05-report-entry.png') })
  expect(existsSync(join(vault, '收件箱/海德堡.md'))).toBe(false)
  expect(existsSync(join(vault, '词条/海德堡.md'))).toBe(false)
  const head0 = git(vault, 'rev-parse', 'HEAD')

  // 日记的右栏「相关」顶上一张卡
  await leftView(page, '最近')
  await openNote(page, '2026-10-18')
  await rail(page).getByRole('button', { name: /^相关/ }).click()
  const card = related(page).getByTestId('related-entry')
  await expect(card).toContainText('海德堡')
  await expect(card).toContainText('篇提到它，还没有词条页')
  await expect(card).toContainText('建词条页…')
  await page.screenshot({ path: test.info().outputPath('06-related-card.png') })
  // 看了不点：什么都没建
  expect(git(vault, 'rev-parse', 'HEAD')).toBe(head0)
  const before = Object.fromEntries(Object.keys(WIKI_FILES).map((p) => [p, bytes(vault, p)]))

  await card.click()
  await expect(card).toContainText('建好了', { timeout: 30_000 })
  await expect(card.getByRole('button', { name: '撤销' })).toBeVisible()
  // 放在库最外层的「词条/」（第一次建时建这个文件夹），收件箱里没有
  expect(existsSync(join(vault, '收件箱/海德堡.md'))).toBe(false)
  const page1 = read(vault, '词条/海德堡.md')
  expect(page1).toMatch(/^---\n类型: 词条\n来源: 梦游建议\n---\n# 海德堡\n\n> \[!ai\] 梦游起草的词条/)
  const id = /!\[\[Day-001#\^([a-z][a-z0-9]{5})\]\]/.exec(page1)![1]!
  expect(read(vault, EURO)).toContain(`城堡残垣立在海德堡老城区上方。 ^${id}`)
  expect(git(vault, 'log', '-1', '--format=%s').trim()).toMatch(/^相关栏：建词条页「海德堡」，\d 篇里提到它的字链过来/)
  expect(git(vault, 'status', '--porcelain')).toBe('')
  // 提到它的地方链过来了（照 A1：原句里的字变成链接、每篇第一处；标签里的不动），同一次提交
  // （那一段要嵌进词条页时行尾还多一个块编号）
  expect(read(vault, '收件箱/2026-10-18.md')).toMatch(/^# 2026-10-18\n\n朋友来了，带他去\[\[海德堡\]\]老城区走了一圈，桥上人很多。( \^[a-z][a-z0-9]{5})?\n$/)
  expect(read(vault, '生活/搬家.md')).toMatch(/^# 搬家\n\n#地方\/海德堡 找房子太难了，\[\[海德堡\]\]的学生宿舍排队一年。( \^[a-z][a-z0-9]{5})?\n$/)
  expect(git(vault, 'show', '--name-only', '--format=', 'HEAD')).toContain('生活/搬家.md')
  const linkedList = related(page).getByTestId('related-entry-linked')
  await expect(linkedList).toContainText('篇里提到它的字链过来了')
  await expect(linkedList.locator('.it', { hasText: '搬家' }).locator('mark')).toHaveText('海德堡')
  // 同名的另一个东西（海德堡大学）：没改，列在「拿不准，你来定」
  const course = bytes(vault, '生活/选课.md')
  expect(read(vault, '生活/选课.md')).not.toContain('[[海德堡')
  const unsureList = related(page).getByTestId('related-entry-unsure')
  await expect(unsureList).toContainText('拿不准，你来定：1处')
  await expect(unsureList).toContainText('海德堡大学的选课系统很难用')
  await page.screenshot({ path: test.info().outputPath('07-related-made.png') })
  // 你来定：点「连上」那一句里的字链过去，「撤销」回到原样
  await unsureList.getByRole('button', { name: '连上' }).click()
  await expect(unsureList).toContainText('已连上')
  expect(read(vault, '生活/选课.md')).toContain('[[海德堡]]大学的选课系统')
  await unsureList.getByRole('button', { name: '撤销' }).click()
  await expect(unsureList.getByRole('button', { name: '连上' })).toBeVisible()
  expect(bytes(vault, '生活/选课.md').equals(course)).toBe(true)

  // 撤销：词条页没了，加过块编号的那篇一字节不差，一次提交
  await card.getByRole('button', { name: '撤销' }).click()
  await expect(card).toContainText('建词条页…')
  expect(existsSync(join(vault, '词条/海德堡.md'))).toBe(false)
  for (const [p, b] of Object.entries(before)) expect(bytes(vault, p).equals(b), p).toBe(true)
  expect(git(vault, 'log', '-1', '--format=%s').trim()).toBe('撤销：建词条页「海德堡」')
  expect(git(vault, 'status', '--porcelain')).toBe('')

  // 再建一次，点卡打开词条页：嵌进来的那一段画出来（不露 ![[…]]、不露块编号）
  await card.click()
  await expect(card).toContainText('建好了', { timeout: 30_000 })
  const id2 = /!\[\[Day-001#\^([a-z][a-z0-9]{5})\]\]/.exec(read(vault, '词条/海德堡.md'))![1]!
  await card.click()
  await expect(tabOn(page)).toHaveText('海德堡')
  const emb = pane(page).locator('[data-part="嵌进来的一段"]').filter({ hasText: 'Day-001' })
  await expect(emb).toContainText('海德堡注脚：1689 年和 1693 年法军两次攻破这里')
  await expect(emb).not.toContainText(`^${id2}`)
  await expect(pane(page).locator('.cm-content')).not.toContainText('![[')
  await page.screenshot({ path: test.info().outputPath('08-entry-page.png') })
  // 「去原文 ›」：开欧洲史，光标停在那一段
  await emb.getByRole('button', { name: '去原文 ›' }).click()
  await expect(tabOn(page)).toHaveText('Day-001')
  await expect.poll(() => caretLine(page)).toContain('海德堡注脚')
  // 已经有词条页了：那篇日记的卡换成那一页，点了打开
  await openNote(page, '2026-10-18')
  await expect(related(page).getByTestId('related-entry')).toContainText('打开')
  await related(page).getByTestId('related-entry').click()
  await expect(tabOn(page)).toHaveText('海德堡')
})

/** 建一次「海德堡」词条页：跑梦游、开那篇日记的右栏「相关」、点卡上「建词条页…」 */
async function makeEntry(page: Page) {
  await page.evaluate(() => window.cn.dreamNow())
  await leftView(page, '梦游报告')
  await expect(report(page).getByTestId('dream-item').filter({ hasText: '「海德堡」' })).toContainText('还没有讲它的一篇', { timeout: 60_000 })
  await leftView(page, '最近')
  await openNote(page, '2026-10-18')
  await rail(page).getByRole('button', { name: /^相关/ }).click()
  const card = related(page).getByTestId('related-entry')
  await card.click()
  await expect(card).toContainText('建好了', { timeout: 30_000 })
}

test('库里有「MOC」文件夹：词条页建在 MOC/ 里，不另建「词条/」', async () => {
  test.setTimeout(180_000)
  run = await launch({ ...WIKI_FILES, 'MOC/首页.md': '# 首页\n\n- [[解剖02-练胸]]\n' }, { CN_AI_FAKE: '1', CN_FAKE_WIKI: '1' }, onlyLinks)
  const { page, vault } = run
  await makeEntry(page)
  expect(read(vault, 'MOC/海德堡.md')).toMatch(/^---\n类型: 词条\n/)
  expect(existsSync(join(vault, '词条'))).toBe(false)
  expect(existsSync(join(vault, '收件箱/海德堡.md'))).toBe(false)
})

test('以前建在收件箱里的词条页：报告里一条「挪进 词条/」，收下才挪，提到它的双链还通', async () => {
  test.setTimeout(180_000)
  const OLD = '收件箱/莱茵河.md'
  const OLD_MD = '---\n类型: 词条\n来源: 梦游建议\n---\n# 莱茵河\n\n> [!ai] 梦游起草的词条 · 测试\n> 从阿尔卑斯山流到北海。\n'
  const LINKER = '生活/旅行计划.md'
  run = await launch({ ...WIKI_FILES, [OLD]: OLD_MD, [LINKER]: '# 旅行计划\n\n沿着[[莱茵河]]往北走。\n' }, { CN_AI_FAKE: '1', CN_FAKE_WIKI: '1' }, (v) => {
    // 只开归类（挪）：词条页的挪动走归类那一套
    const ud = join(dirname(v), 'user-data')
    mkdirSync(ud, { recursive: true })
    writeFileSync(join(ud, 'settings.json'), JSON.stringify({ editor: { semantic: false }, dream: { steps: { file: true, rename: false, link: false, week: false, viz: false, attach: false, dup: false, video: false } } }))
  })
  const { page, vault } = run
  await page.evaluate(() => window.cn.dreamNow())
  await leftView(page, '梦游报告')
  const panel = report(page)
  const it = panel.getByTestId('dream-item').filter({ hasText: '挪进 词条/' })
  await expect(it).toHaveCount(1, { timeout: 60_000 })
  await expect(it).toContainText('莱茵河')
  // 只是建议：还没挪
  expect(existsSync(join(vault, OLD))).toBe(true)
  expect(existsSync(join(vault, '词条/莱茵河.md'))).toBe(false)
  await it.click()
  await expect(panel.getByTestId('dream-detail')).toContainText('词条')
  await page.screenshot({ path: test.info().outputPath('09-entry-move.png') })
  await panel.getByTestId('dream-detail').getByRole('button', { name: '收下', exact: true }).click()
  await expect(it).toContainText('已收下', { timeout: 30_000 })
  // 挪过去了，一字不差；收件箱里没了；提到它的那篇的双链还指得到（名字没变）
  expect(existsSync(join(vault, OLD))).toBe(false)
  expect(read(vault, '词条/莱茵河.md')).toBe(OLD_MD)
  expect(read(vault, LINKER)).toContain('[[莱茵河]]')
  expect(git(vault, 'status', '--porcelain')).toBe('')
  // ⌘点那篇里的 [[莱茵河]]：开的是「词条/」里那一篇
  await leftView(page, '最近')
  await openNote(page, '旅行计划')
  await pane(page).locator('.cm-wikilink', { hasText: '莱茵河' }).first().click({ modifiers: ['Meta'] })
  await expect(tabOn(page)).toHaveText('莱茵河')
  await expect(pane(page).locator('.cm-content')).toContainText('从阿尔卑斯山流到北海')
})
