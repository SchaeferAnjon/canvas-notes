// 从笔记出卡送 Anki（task-tz7y3，2026-11-22 用户选方向 B「AI 先改成卡，一张张过」，原型 /private/tmp/canvas-notes-anki/proto.html#dir=b）：
// 读 PDF 的笔记「只看我问的」点「出卡」→ AI（假的）把每一问改成能单独看懂的卡 → 一张张过（空格不送、E 改、← → 换张）→ 送进 Anki（假的 AnkiConnect）：
// 笔记类型「学习卡 · 问答」九个字段、牌组跟着目录来「课程::ecp::Lecture05」「课程::ecp::Week 2::补充材料」（不在课程里的进「知识」）、同牌组问题一样的不重复加 → 笔记里标「已送」→ 再出卡送过的默认不送；
// Anki 没开时提示、选好的留着，「打开Anki」开了接着送，送好了能撤回；「我的疑惑」那一页拿掉了，课程首页、⌘K、设置 › 读PDF、问题条上「做成卡」都能出卡。
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, leftView, rail, type Running, tabOn } from './app'
import { ankiVault, fakeAnki, L4_NOTE, L5_NOTE, L5_QUESTIONS, SIDE_QUOTE, weekVault } from './fixtures/anki'

const notes = (page: Page) => page.getByRole('complementary', { name: '笔记', exact: true })
const dlg = (page: Page) => page.getByRole('dialog', { name: '出卡' })
const squares = (page: Page) => dlg(page).getByRole('group', { name: '每一张' }).getByRole('button')
const toast = (page: Page) => page.getByTestId('toast')
const gitOut = (vault: string, ...args: string[]) => execFileSync('git', ['-C', vault, ...args], { encoding: 'utf8' }).trim()
const ankiJson = (vault: string) => JSON.parse(readFileSync(join(vault, '.canvas-notes/anki.json'), 'utf8')) as { sent: Record<string, string>; cards?: Record<string, { q: string; a: string; note?: number }> }
const screen = (run: Running) => run.app.evaluate(() => (globalThis as unknown as { cnScreen: string[] }).cnScreen.join('|'))
const palInput = (page: Page) => page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' })
const setDlg = (page: Page) => page.getByRole('dialog', { name: '设置' })
const setRow = (page: Page, id: string) => setDlg(page).locator(`[data-row="${id}"]`)

/** 假 AI 怎么改写（main/agent/fake-engine.ts 的出卡那一段）：问题「小标题」里：原话；答案是回答第一句里第一个逗号前；原文摘句是回答第一句 */
const fakeQ = (title: string, q: string) => `「${title}」里：${q}`

async function openPdf(page: Page, name: string) {
  await page.keyboard.press('Meta+k')
  await palInput(page).fill(name)
  await page.locator('.pal-row', { hasText: `${name}.pdf` }).first().click()
  await expect(tabOn(page)).toHaveText(`${name}.pdf`)
}

/** 右栏「笔记」标签，筛「只看我问的」 */
async function askedOnly(page: Page) {
  if (!(await notes(page).isVisible())) await rail(page).getByRole('button', { name: '笔记' }).click()
  await notes(page).getByRole('tab', { name: '只看我问的' }).click()
}

/** 等 AI 改完：头上「改好了…」，送的按钮能点 */
async function drafted(page: Page) {
  await expect(dlg(page).locator('.dh .sub')).toHaveText(/^改好了/, { timeout: 20_000 })
}

/** Anki 装好了的样子（测试里的假 Anki.app 和插件文件夹） */
function fakeInstall(root: string): Record<string, string> {
  const app = join(root, 'Anki.app')
  mkdirSync(join(app, 'Contents'), { recursive: true })
  writeFileSync(
    join(app, 'Contents/Info.plist'),
    '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>25.09</string></dict></plist>\n',
  )
  const addons = join(root, 'addons21')
  mkdirSync(join(addons, '2055492159'), { recursive: true })
  return { CN_ANKI_APP: app, CN_ANKI_ADDONS: addons }
}

test('只看我问的「出卡」：AI 改写、一张张过（空格、E 改、← →）、送进 Anki（学习卡 · 问答九个字段、牌组「课程::ecp」、同问题不重复）、笔记里标已送、再出卡送过的默认不送', async () => {
  // 牌组「课程::ecp」里已经有第 5 问改出来的那张（以前送过同一个问题）：这次不重复加
  const anki = await fakeAnki({ decks: { '课程::ecp::Lecture05': 42 }, notes: [{ deckName: '课程::ecp::Lecture05', modelName: '学习卡 · 问答', fields: { Question: fakeQ('为什么用脉冲就省电', 'SRAM 为什么比 DRAM 省电？') }, tags: ['来自::ChatCards'] }] })
  const run = await launch(ankiVault(), { CN_AI_FAKE: '1', CN_ANKI_URL: anki.url, CN_FAKE_CARD_MS: '120' })
  const { page, vault } = run
  try {
    await openPdf(page, 'Lecture05')
    await askedOnly(page)
    const n = notes(page)
    // 「以前的『我的疑惑』」那句换成 B 的一句，能点 × 收起
    await expect(n.locator('.qhint')).toHaveText('点右上「出卡」，AI 把这几问改成能单独看懂的卡，你一张张过。')
    await expect(n.locator('.qonly .q')).toHaveText(L5_QUESTIONS)
    const open = n.getByRole('button', { name: '出卡 · 6问' })
    await expect(open).toBeVisible()

    // 出卡：AI 一张张改，头上写改到第几张，改完前不能送
    await open.click()
    await expect(dlg(page).locator('.dh b')).toHaveText('出卡 · Lecture05')
    await expect(dlg(page).locator('.dh .sub')).toHaveText(/^AI 在改写 \d\/6…$/)
    await expect(dlg(page).getByRole('button', { name: /^送进Anki/ })).toBeDisabled()
    await drafted(page)
    await expect(dlg(page).locator('.dh .sub')).toHaveText(/^改好了6张 · Claude Code · /)
    await expect(squares(page)).toHaveCount(6)
    await expect(squares(page).first()).toHaveClass(/\bcur\b/)
    // 第 1 张：纸顶「Canvas Notes · ecp」、AI 改过的问题、我框的图、答案、纸底「Lecture05 · 第 2 页」，下面「你当时问的：「…」」
    const paper = dlg(page).locator('.paper')
    await expect(paper.locator('.meta')).toHaveText('Canvas Notes · ecp')
    await expect(paper.locator('.pq')).toHaveText(fakeQ('LIF 神经元的三条公式', '给我讲解一下这三条公式'))
    await expect(paper.locator('.shot img')).toHaveAttribute('src', /\/Lecture05\/p2-1\.png$/)
    await expect(paper.locator('.pa')).toHaveText('把神经元想成一个漏水的水桶')
    await expect(paper.locator('.foot')).toContainText('Lecture05 · 第 2 页')
    await expect(paper.locator('.foot')).toContainText('打开原文')
    await expect(dlg(page).locator('.orig')).toHaveText('你当时问的：「给我讲解一下这三条公式」')

    // → 第 2 张是旁支：纸顶多「· 旁支」，下面写问的是哪一句；空格不送，跳到下一张
    await page.keyboard.press('ArrowRight')
    await expect(squares(page).nth(1)).toHaveClass(/\bcur\b/)
    await expect(paper.locator('.meta')).toHaveText('Canvas Notes · ecp · 旁支')
    await expect(dlg(page).locator('.orig')).toHaveText(`你当时问的：「为什么减掉门槛，而不是清零？」 · 旁支，问的是「${SIDE_QUOTE.slice(0, 14)}…」`)
    await page.keyboard.press(' ')
    await expect(squares(page).nth(1)).toHaveClass(/\bskip\b/)
    await expect(squares(page).nth(2)).toHaveClass(/\bcur\b/)
    await expect(dlg(page).locator('.df .cnt')).toHaveText('要送5张 · 不送1张')

    // E 改第 3 张的问题，回车改好
    await page.keyboard.press('e')
    const q = paper.locator('.pq[contenteditable="true"]')
    await expect(q).toBeFocused()
    await page.keyboard.press('Meta+a')
    await page.keyboard.type('LIF 里 τ 变大，神经元会怎样？（改过）')
    await page.keyboard.press('Enter')
    await expect(paper.locator('.pq')).toHaveText('LIF 里 τ 变大，神经元会怎样？（改过）')
    await expect(paper.locator('.pq[contenteditable="true"]')).toHaveCount(0)
    // ← → 换张：左到头停在第 1 张，再一路往右
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await expect(squares(page).first()).toHaveClass(/\bcur\b/)
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight')
    await expect(squares(page).nth(5)).toHaveClass(/\bcur\b/)
    await expect(paper.locator('.pq')).toHaveText(fakeQ('Roofline 的拐点', 'Roofline 的拐点怎么算？'))
    // 点方块也能换张
    await squares(page).nth(2).click()
    await expect(paper.locator('.pq')).toHaveText('LIF 里 τ 变大，神经元会怎样？（改过）')

    // 送：5 张里第 5 问牌组里已经有一样的问题，不重复加
    await dlg(page).getByRole('button', { name: '送进Anki · 5张' }).click()
    await expect(dlg(page)).toHaveCount(0)
    await expect(toast(page)).toContainText('已送进Anki · 4张（牌组「课程::ecp::Lecture05」），1张Anki里已经有了，跳过')
    await expect(toast(page).getByRole('button', { name: '打开Anki' })).toBeVisible()
    await expect(toast(page).getByRole('button', { name: '撤回' })).toBeVisible()

    // 笔记类型：和 ChatCards 同一个「学习卡 · 问答」，九个英文字段、卡片家族 v3 的样子
    const model = anki.models.get('学习卡 · 问答')!
    expect(model.fields).toEqual(['Question', 'Answer', 'More', 'Quote', 'Image', 'Label', 'Source', 'Link', 'ID'])
    expect(model.css.startsWith('/* 卡片家族 v3 */')).toBe(true)
    expect(model.templates.map((t) => t.Name)).toEqual(['问答'])
    const added = anki.notes.filter((x) => x.tags.includes('来自::Canvas_Notes'))
    expect(added.map((x) => x.fields.Question)).toEqual([
      fakeQ('LIF 神经元的三条公式', '给我讲解一下这三条公式'),
      'LIF 里 τ 变大，神经元会怎样？（改过）',
      fakeQ('为什么用脉冲就省电', '为什么用脉冲就省电？'),
      fakeQ('Roofline 的拐点', 'Roofline 的拐点怎么算？'),
    ])
    for (const x of added) {
      expect(x.deckName).toBe('课程::ecp::Lecture05')
      expect(x.modelName).toBe('学习卡 · 问答')
      expect(x.options).toEqual({ allowDuplicate: false, duplicateScope: 'deck' })
      expect(Object.keys(x.fields)).toEqual(['Question', 'Answer', 'More', 'Quote', 'Image', 'Label', 'Source', 'Link', 'ID'])
      expect(x.tags).toEqual(['来自::Canvas_Notes', '主题::ecp', '主题::Lecture05'])
      expect(x.fields.Label).toBe('Canvas Notes · ecp')
      expect(x.fields.Link).toMatch(/^canvas-notes:\/\/open\?file=%E8%AF%BE%E7%A8%8B%2Fecp%2FLecture05\.pdf&amp;page=\d&amp;rect=/)
      expect(x.fields.Image).toMatch(/^<img class="lead" src="canvasnotes-\w+\.png" width="\d+">$/)
      expect(x.fields.ID).toMatch(/^canvasnotes-\w+$/)
    }
    // 第 1 张：答案、原文摘句（回答里原样的一句）、出处
    expect(added[0]!.fields).toMatchObject({ Answer: '把神经元想成一个漏水的水桶', Quote: '把神经元想成一个漏水的水桶：每一步先漏掉一点（乘 β），再加上这一步流进来的电流。', Source: 'Lecture05 · 第 2 页' })
    expect(added[1]!.fields.Source).toBe('Lecture05 · 第 2 页')
    expect(added[3]!.fields.Source).toBe('Lecture05 · 第 4 页')

    // 送过的记在库里 .canvas-notes/anki.json（跟着 Git 走）：加进去的 4 张和 Anki 里已经有的 1 张，记着送进去的字和 Anki 里的编号；一次提交
    const st = ankiJson(vault)
    expect(Object.keys(st.sent)).toHaveLength(5)
    expect(Object.values(st.cards ?? {}).map((c) => c.q)).toContain('LIF 里 τ 变大，神经元会怎样？（改过）')
    expect(Object.values(st.cards ?? {}).filter((c) => c.note).length).toBe(4)
    expect(gitOut(vault, 'log', '-1', '--format=%s')).toBe('送进 Anki：Lecture05 4 张')
    expect(gitOut(vault, 'status', '--porcelain', '--untracked-files=all')).toBe('')

    // 笔记里标「已送」，按钮只剩没送的那一问（旁支那一问）
    await expect(n.locator('.qonly').filter({ has: page.locator('.st', { hasText: '已送' }) })).toHaveCount(5)
    await expect(n.locator('.qonly').nth(1).locator('.st')).toHaveCount(0)
    await expect(n.getByRole('button', { name: '出卡 · 1问' })).toBeVisible()
    // 「全部」里问题条上也标「已送」
    await n.getByRole('tab', { name: '全部' }).click()
    await n.locator('.rnd.fold .fh', { hasText: 'LIF 神经元的三条公式' }).click()
    await expect(n.locator('.rnd:not(.fold) .qs .mk').first()).toHaveText('已送')
    // 旁支那一问没送：问题条上悬停出「做成卡」
    await expect(n.locator('.rnd:not(.fold) .nside .qs .hov')).toHaveCount(1)

    // 再出卡：送过的 5 张虚线带绿点、默认不送、不再改写；没送的那张在最前，用上次改好的
    await n.getByRole('button', { name: '出卡 · 1问' }).click()
    await drafted(page)
    await expect(dlg(page).locator('.dh .sub')).toHaveText(/^改好了1张 · 5张送过了，不再改写 · Claude Code · /)
    await expect(squares(page)).toHaveCount(6)
    await expect(squares(page).locator('.gd')).toHaveCount(5)
    await expect(squares(page).first()).not.toHaveClass(/\bskip\b/)
    await expect(paper.locator('.meta')).toHaveText('Canvas Notes · ecp · 旁支')
    await expect(dlg(page).locator('.df .cnt')).toHaveText('要送1张 · 不送5张')
    await page.keyboard.press('ArrowRight')
    await expect(dlg(page).locator('.done')).toContainText('这一问送过了')
    await expect(dlg(page).locator('.done')).toContainText('这次不送。')
    await expect(dlg(page).getByRole('button', { name: '还是再送一张' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dlg(page)).toHaveCount(0)
  } finally {
    await run.close()
    await anki.close()
  }
})

test('Anki 没开：送的时候说清楚、选好的留着；「怎么装」三行；「打开Anki」开了接着送；送好了能撤回；课程首页「读PDF时问过的」和「今天要复习」', async () => {
  const anki = await fakeAnki({ down: true })
  // Anki 装好了（假的 Anki.app、插件文件夹），只是没开
  const inst = mkdtempSync(join(tmpdir(), 'cn-anki-'))
  const env = fakeInstall(inst)
  const run = await launch(ankiVault(), { CN_AI_FAKE: '1', CN_ANKI_URL: anki.url, CN_FAKE_CARD_MS: '60', ...env })
  const { page } = run
  try {
    // 课程首页：「我的疑惑」那张卡改名「读PDF时问过的」，底下「出卡 · 没送的8问」；「今天要复习」空着时说在哪出卡
    await leftView(page, '课程')
    await page.locator('aside.side').getByRole('treeitem').filter({ has: page.locator('.truncate', { hasText: /^ecp$/ }) }).click()
    const card = page.getByTestId('fw-doubts')
    await expect(card.locator('.wk .truncate')).toHaveText('读PDF时问过的')
    await expect(card.locator('.wk .n')).toHaveText('8问')
    await expect(card.locator('.fw-sub')).toHaveText('最近问的 · 第5讲')
    await expect(card.locator('.fw-row .truncate')).toHaveText(['Roofline 的拐点怎么算？', 'SRAM 为什么比 DRAM 省电？', '为什么用脉冲就省电？'])
    await expect(card.locator('.fw-chips button')).toHaveText(['第5讲 6问', '第4讲 2问'])
    await expect(card.locator('.fw-foot .num')).toHaveText('8问 · 都还没出卡')
    await expect(page.getByTestId('fw-review').locator('.fw-empty')).toHaveText('这门课还没有卡送进Anki。在下面「读PDF时问过的」点「出卡」，AI改好你一张张过。')

    // 出卡 · 没送的8问：第 1 张不送，第 2 张改问题
    await card.getByRole('button', { name: '出卡 · 没送的8问' }).click()
    await expect(dlg(page).locator('.dh b')).toHaveText('出卡 · ecp')
    await drafted(page)
    await expect(squares(page)).toHaveCount(8)
    await page.keyboard.press(' ')
    await page.keyboard.press('e')
    await page.keyboard.press('Meta+a')
    await page.keyboard.type('LIF 发完 spike 为什么减门槛、不清零？')
    await page.keyboard.press('Enter')
    await dlg(page).getByRole('button', { name: '送进Anki · 7张' }).click()
    // Anki 没开：一行说清楚，选的都留着；装好了的有「打开Anki」，也能看怎么装
    const warn = dlg(page).locator('.warnrow')
    await expect(warn).toContainText('Anki没开着。选的都留着，开了接着送。')
    await warn.getByRole('button', { name: '怎么装' }).click()
    const how = dlg(page).getByRole('region', { name: '连上Anki' })
    await expect(how.locator('.hrow')).toHaveText([/^Anki桌面版装好了 · 25\.09/, /^AnkiConnect插件装好了 · 编号2055492159/, /^Anki开着没开着打开Anki$/, '8765端口被占时复制命令贴进终端，看是哪个程序占着；关掉它，再重启Anki复制命令'])
    // 关掉再出卡：上次不送的、改过的都还在，不再问 AI
    await page.keyboard.press('Escape')
    await expect(dlg(page)).toHaveCount(0)
    await page.keyboard.press('Meta+k')
    await palInput(page).fill('出卡')
    await page.locator('.pal-row', { hasText: '出卡：这门课 ecp 没送的' }).click()
    await expect(dlg(page).locator('.dh .sub')).toHaveText(/^改好了8张 · Claude Code · /)
    await expect(squares(page).first()).toHaveClass(/\bskip\b/)
    await expect(dlg(page).locator('.df .cnt')).toHaveText('要送7张 · 不送1张')
    await squares(page).nth(1).click()
    await expect(dlg(page).locator('.paper .pq')).toHaveText('LIF 发完 spike 为什么减门槛、不清零？')
    await dlg(page).getByRole('button', { name: '送进Anki · 7张' }).click()
    await expect(warn).toContainText('Anki没开着。选的都留着，开了接着送。')
    // 打开Anki：软件去开 Anki（测试里只记下），开了接着送
    await warn.getByRole('button', { name: '打开Anki' }).click()
    await expect(warn).toContainText('在等Anki打开…打开了接着送')
    await expect.poll(() => screen(run)).toContain(`打开 ${env.CN_ANKI_APP}`)
    anki.down = false
    await expect(toast(page)).toContainText('已送进Anki · 7张（牌组「课程::ecp」下的2个牌组）', { timeout: 15_000 })
    expect(anki.notes.map((x) => x.fields.Question)).toContain('LIF 发完 spike 为什么减门槛、不清零？')
    expect(anki.notes).toHaveLength(7)
    expect(gitOut(run.vault, 'log', '-1', '--format=%s')).toBe('送进 Anki：ecp 7 张')
    // 左栏：Lecture05 六问都送了，数字后面一个绿勾；Lecture04 第一问（这次第 1 张）没送，不画（数字在 PDF 下面挂着的「笔记」那行，task-m552v）
    const tree = page.locator('aside.side')
    await expect(tree.locator(`[role="treeitem"][data-path="${L5_NOTE}"] .ft-sent`)).toBeVisible()
    await expect(tree.locator(`[role="treeitem"][data-path="${L4_NOTE}"] .ft-sent`)).toHaveCount(0)
    // 课程首页跟着变：7 问已在 Anki，「今天要复习」从 Anki 读这门课的卡
    await expect(card.locator('.fw-foot .num')).toHaveText('8问 · 7问已在Anki')
    await expect(card.getByRole('button', { name: '出卡 · 没送的1问' })).toBeVisible()
    const review = page.getByTestId('fw-review')
    await expect(review.locator('.due b')).toHaveText(['7', '0'])
    await expect(review.locator('.due span')).toHaveText(['新卡', '今天到期'])
    await expect(review.locator('.fw-empty')).toHaveText('牌组「课程::ecp」里的卡。数从Anki读，复习在Anki里做。')
    await expect(review.getByRole('button', { name: '打开Anki' })).toBeVisible()

    // 撤回：Anki 里删掉这 7 张，送过的记号拿掉，一次提交
    await toast(page).getByRole('button', { name: '撤回' }).click()
    await expect.poll(() => anki.notes.length).toBe(0)
    await expect(card.locator('.fw-foot .num')).toHaveText('8问 · 都还没出卡')
    expect(Object.keys(ankiJson(run.vault).sent)).toHaveLength(0)
    expect(gitOut(run.vault, 'log', '-1', '--format=%s')).toBe('撤回送进 Anki：ecp 7 张')
  } finally {
    await run.close()
    await anki.close()
    rmSync(inst, { recursive: true, force: true })
  }
})

test('「我的疑惑」那一页拿掉了：⌘K 打「我的疑惑」说它去哪了、打 anki 是出卡；设置 › 读PDF「送进Anki」一组；问题条上「做成卡」当场送', async () => {
  const anki = await fakeAnki()
  const run = await launch(ankiVault(), { CN_AI_FAKE: '1', CN_ANKI_URL: anki.url, CN_FAKE_CARD_MS: '60' })
  const { page } = run
  try {
    await openPdf(page, 'Lecture05')
    // ⌘K 打「我的疑惑」：没有那一页了，一句说问过的在哪；回车开这份 PDF 的「只看我问的」
    await page.keyboard.press('Meta+k')
    await palInput(page).fill('我的疑惑')
    const pal = page.getByRole('dialog', { name: '搜索和命令' })
    await expect(pal.locator('.pal-g', { hasText: '以前的「我的疑惑」' })).toBeVisible()
    const gone = pal.locator('.pal-row', { hasText: '这一页拿掉了：问过的在每份PDF的笔记「只看我问的」里' })
    await expect(gone).toBeVisible()
    await gone.click()
    await expect(notes(page).getByRole('tab', { name: '只看我问的' })).toHaveAttribute('aria-selected', 'true')
    await expect(tabOn(page)).toHaveText('Lecture05.pdf')

    // ⌘K 打 anki：出卡这份、这门课，设置那一行
    await page.keyboard.press('Meta+k')
    await palInput(page).fill('anki')
    await expect(pal.locator('.pal-row .nm')).toContainText(['出卡：Lecture05 没送的', '出卡：这门课 ecp 没送的', '设置 › 读PDF › 出卡'])
    await expect(pal.locator('.pal-row', { hasText: '出卡：Lecture05 没送的' })).toContainText('6问')
    await expect(pal.locator('.pal-row', { hasText: '出卡：这门课 ecp 没送的' })).toContainText('8问')
    await pal.locator('.pal-row', { hasText: '设置 › 读PDF › 出卡' }).click()

    // 设置 › 读PDF：「送进Anki」一组
    await expect(setDlg(page).getByTestId('settings-head').locator('h2')).toHaveText('读PDF')
    const grp = setDlg(page).getByRole('group', { name: '送进Anki' })
    await expect(grp.locator('.sa-lb')).toHaveText(['Anki', '送进哪个牌组', '旁支里问的也送', '改写成卡用哪家AI', 'Anki 没开、没装时', '整个库读PDF时问过的'])
    await expect(setRow(page, 'anki')).toContainText('连上了')
    await expect(setRow(page, 'ankiDeck')).toContainText('按文件夹分牌组；直接放在课里的用PDF的名字，别处的进「知识」例：课程/ecp/Week 2/补充材料 → 课程::ecp::Week 2::补充材料')
    await expect(setRow(page, 'ankiDeck').locator('.sa-val')).toHaveText('跟着文件夹')
    await expect(setRow(page, 'ankiAll').locator('.sa-ds')).toHaveText('8问 · 0问已在Anki')
    await expect(setRow(page, 'ankiAll').getByRole('button', { name: '出卡 · 8问' })).toBeVisible()
    await expect(setRow(page, 'ankiEngine')).toContainText('跟默认')
    // 旁支里问的也送：关了，笔记「出卡」不算旁支那一问
    await setRow(page, 'ankiSides').getByRole('switch').click()
    await page.keyboard.press('Escape')
    await askedOnly(page)
    await expect(notes(page).getByRole('button', { name: '出卡 · 5问' })).toBeVisible()

    // 问题条上「做成卡」：AI 改好在旁边出一张小卡，送进 Anki；问题条标「已送」
    const n = notes(page)
    await n.getByRole('tab', { name: '全部' }).click()
    const bar = n.locator('.rnd:not(.fold) .qs').filter({ hasText: 'Roofline 的拐点怎么算？' })
    if (!(await bar.count())) await n.locator('.rnd.fold .fh', { hasText: 'Roofline 的拐点' }).click()
    await bar.hover()
    await bar.getByRole('button', { name: '做成卡' }).click()
    const pop = page.getByRole('dialog', { name: '做成卡' })
    await expect(pop.locator('.paper .pq')).toHaveText(fakeQ('Roofline 的拐点', 'Roofline 的拐点怎么算？'), { timeout: 15_000 })
    await pop.getByRole('button', { name: '送进Anki' }).click()
    await expect(toast(page)).toContainText('已送进Anki · 1张（牌组「课程::ecp::Lecture05」）')
    await expect(bar.locator('.mk')).toHaveText('已送')
    expect(anki.notes.map((x) => x.fields.Source)).toEqual(['Lecture05 · 第 4 页'])
  } finally {
    await run.close()
    await anki.close()
  }
})

test('牌组跟着目录来：Week 2 里的进「课程::ecp::Week 2」，Week 2/补充材料 里的进「课程::ecp::Week 2::补充材料」，不在课程里的进「知识」；PDF 带书签也不按章分；进了几个牌组时提示条怎么写', async () => {
  const anki = await fakeAnki()
  const run = await launch(weekVault(), { CN_AI_FAKE: '1', CN_ANKI_URL: anki.url, CN_FAKE_CARD_MS: '0' })
  const { page } = run
  const deckOf = (pdf: string) => [...new Set(anki.notes.filter((n) => n.tags.includes(`主题::${pdf}`)).map((n) => n.deckName))]
  try {
    // 先读 Lecture05（带书签的 PDF），再从 ⌘K 出这门课没送的：Week 2 的 6 问、Week 2/补充材料 的 2 问
    await openPdf(page, 'Lecture05')
    await page.keyboard.press('Meta+k')
    await palInput(page).fill('出卡')
    await page.locator('.pal-row', { hasText: '出卡：这门课 ecp 没送的' }).click()
    await drafted(page)
    await expect(squares(page)).toHaveCount(8)
    await dlg(page).getByRole('button', { name: '送进Anki · 8张' }).click()
    await expect(toast(page)).toContainText('已送进Anki · 8张（牌组「课程::ecp::Week 2」和下面的「补充材料」）')
    expect(anki.notes).toHaveLength(8)
    expect(deckOf('Lecture05')).toEqual(['课程::ecp::Week 2'])
    expect(deckOf('Lecture04')).toEqual(['课程::ecp::Week 2::补充材料'])

    // 撤回，再从设置 › 读PDF 把全库没送的一起出：课程里的和「知识」没有共同的上一层，提示条只写几个牌组
    await toast(page).getByRole('button', { name: '撤回' }).click()
    await expect.poll(() => anki.notes.length).toBe(0)
    await page.keyboard.press('Meta+,')
    await setDlg(page).getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: '读PDF', exact: true }).click()
    await setRow(page, 'ankiAll').getByRole('button').click()
    await drafted(page)
    await expect(squares(page)).toHaveCount(9)
    await dlg(page).getByRole('button', { name: '送进Anki · 9张' }).click()
    await expect(toast(page)).toContainText('已送进Anki · 9张（3个牌组）')
    expect(deckOf('Lecture05')).toEqual(['课程::ecp::Week 2'])
    expect(deckOf('Lecture04')).toEqual(['课程::ecp::Week 2::补充材料'])
    expect(deckOf('STDP')).toEqual(['知识'])
    // 书签里的「5.2 LIF neuron」「4.2 Bandwidth」这些章没变成牌组
    expect(Object.keys(anki.decks).sort()).toEqual(['Default', '知识', '课程::ecp::Week 2', '课程::ecp::Week 2::补充材料'].sort())
  } finally {
    await run.close()
    await anki.close()
  }
})
