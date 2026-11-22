/**
 * 拍导图放在拍的地方（task-wuv05，用户：「这个思维导图也可以链接在这个白板下方，显示的话可以作为一个子白板在白板中显示」；
 * designer 稿 /private/tmp/canvas-notes-visual/15-思维导图/ 的「存在哪」一节）：
 * - 白板工具板点一下「拍导图」：导图是这块白板的子白板，文件和白板同一个文件夹，白板正中那一列多一张导图卡（缩略 +「导图 · N个主题」），
 *   双击进导图，面包屑多一节回到白板；这篇、导图、照片一次提交，底栏「撤回」一次全回去；打开再保存文件不变。
 * - 笔记里 /拍导图：导图在这篇旁边，光标处一块 `![[导图]]` 缩略图（不露列表原文），点「打开 ›」是同一个文件；⌘K 在文档里也插在光标处。
 * - 首页 ⌘K 拍：照旧进收件箱，打开它。
 * AI 认照片用假引擎（CN_AI_FAKE=1，固定回答 15 个节点）。CN_SHOTS_DIR=<目录> 时存天青、深湖对照图。
 */
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { acts, gitStatus, launch, openNote, pane, tabOn, waitSaved } from './app'

const PHOTO = join(__dirname, 'fixtures/handwritten-map.jpg')
const SHOTS = process.env.CN_SHOTS_DIR
const sheet = (page: Page) => page.getByRole('dialog', { name: /拍一张导图|核对认出来的/ })
const toast = (page: Page) => page.getByTestId('toast')
const git = (vault: string, ...args: string[]) => execFileSync('git', ['-C', vault, ...args], { encoding: 'utf8' }).trim()
const env = () => ({ CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '300', CN_AIRDROP_DIR: mkdtempSync(join(tmpdir(), 'cn-airdrop-')) })
const mapsIn = (vault: string, dir: string) => (existsSync(join(vault, dir)) ? readdirSync(join(vault, dir)).filter((f) => f.startsWith('导图 ')) : [])

/** 设置：界面风格、主题（面包屑是方向 A 的；方向 B 是标题栏搜索框里那一行） */
const settings = (appearance: Record<string, unknown>) => (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, ...appearance } }))
}

/** 拍照窗口里放下手写导图的照片、用这张、等认完、做成白板导图 */
async function shootAndPlace(page: Page) {
  await expect(sheet(page)).toHaveAccessibleName('拍一张导图')
  const b64 = readFileSync(PHOTO).toString('base64')
  await sheet(page).evaluate((el, b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const dt = new DataTransfer()
    dt.items.add(new File([bytes], '导图.jpg', { type: 'image/jpeg' }))
    for (const t of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }))
  }, b64)
  await sheet(page).getByRole('button', { name: '用这张' }).click()
  await expect(sheet(page).locator('.mm-rows .or')).toHaveCount(15)
  await sheet(page).getByRole('button', { name: '做成白板导图' }).click()
  await expect(sheet(page)).toHaveCount(0)
}

const BOARD = '---\ntype: board\n---\n# 复习\n\n## 第三讲\n\n线性映射的定义。\n\n## 第四讲\n\n特征值。\n'

for (const tone of ['sky', 'petrol'] as const) {
  test(`白板工具板点一下「拍导图」：做成这块白板的子白板，同一个文件夹，正中那一列一张导图卡；双击进去、面包屑回来；撤回一次全回去（${tone}）`, async () => {
    const run = await launch({ '课程/线性代数/复习.md': BOARD }, env(), settings({ frame: 'a', skin: tone }))
    const { page, vault } = run
    const boardFile = () => readFileSync(join(vault, '课程/线性代数/复习.md'), 'utf8')
    try {
      const head = git(vault, 'rev-parse', 'HEAD')
      await page.locator('.nav .si', { hasText: /^复习/ }).first().click()
      const db = pane(page).getByTestId('doc-board')
      await expect(db).toBeVisible()
      // 只是打开看：一个字节不变
      expect(boardFile()).toBe(BOARD)
      await db.locator('.bpal').getByRole('button', { name: '拍导图' }).click()
      await shootAndPlace(page)

      // 留在父白板上，不另开导图
      await expect(tabOn(page)).toHaveText('复习')
      // 文件在白板同一个文件夹，属性记上所属白板，照片链接按新位置算
      await expect.poll(() => mapsIn(vault, '课程/线性代数')).toHaveLength(1)
      const [md] = mapsIn(vault, '课程/线性代数')
      const title = md!.replace(/\.md$/, '')
      const mapPath = `课程/线性代数/${md}`
      const mapText = readFileSync(join(vault, mapPath), 'utf8')
      expect(mapText).toContain('所属白板: "[[复习]]"')
      expect(mapText).toMatch(/!\[原照片[^\]]*\]\(\.\.\/\.\.\/附件\/导图\/\d{4}-\d\d-\d\d-\d{4}\.jpg\)/)
      expect(mapsIn(vault, '收件箱')).toEqual([])
      // 正中那一列（第三讲）多一张导图卡：缩略 + 名字 +「导图 · 15个主题」，不写「0张卡片」
      const card = db.locator('.db-card', { has: page.locator('.mm-card') })
      await expect(card).toHaveCount(1)
      await expect(card.locator('.mm-card-row')).toHaveText(`${title}导图 · 15个主题`)
      await expect(card.locator('.mm-thumb rect')).not.toHaveCount(0)
      await expect(card).not.toContainText('张卡片')
      // 点一下放进屏幕正中那一列的最后（同工具板别的几样）：哪一列离正中近就是哪一列
      const col = await card.evaluate((el) => el.closest('.db-col')?.getAttribute('aria-label'))
      expect(['第三讲', '第四讲']).toContain(col)
      await expect.poll(boardFile).toBe(col === '第三讲' ? BOARD.replace('线性映射的定义。\n', `线性映射的定义。\n\n[[${title}]]\n`) : `${BOARD}\n[[${title}]]\n`)
      // 三样一次提交，没有没提交的
      await expect.poll(() => git(vault, 'log', '-1', '--format=%s')).toMatch(/^拍导图：导图 \d\d-\d\d \d\d:\d\d 放进《复习》/)
      const changed = git(vault, '-c', 'core.quotepath=false', 'show', '--name-only', '--format=', 'HEAD').split('\n')
      expect(changed).toHaveLength(3)
      expect(changed).toEqual(expect.arrayContaining([mapPath, '课程/线性代数/复习.md', expect.stringMatching(/^附件\/导图\/\d{4}-\d\d-\d\d-\d{4}\.jpg$/)]))
      expect(gitStatus(vault)).toBe('')
      if (SHOTS) {
        await page.screenshot({ path: join(SHOTS, `board-card-${tone}.png`) })
        await db.locator('.board-wrap').click({ position: { x: 700, y: 600 } })
        await page.waitForTimeout(1800)
        await card.screenshot({ path: join(SHOTS, `el-card-${tone}.png`) })
      }

      // 双击卡进导图；面包屑「库 › 课程 › 线性代数 › 复习 › 导图…」，点「复习」回来
      await card.dblclick()
      await expect(tabOn(page)).toHaveText(title)
      await expect(pane(page).getByTestId('board')).toBeVisible()
      const crumbs = page.getByRole('navigation', { name: '位置' })
      await expect(crumbs.locator('.cr')).toHaveText(['测试库', '课程', '线性代数', '复习', title])
      if (SHOTS) await page.screenshot({ path: join(SHOTS, `map-opened-${tone}.png`) })
      await page.waitForTimeout(800)
      await crumbs.getByRole('button', { name: '复习' }).click()
      await expect(tabOn(page)).toHaveText('复习')
      await expect(db).toBeVisible()
      // 打开再保存文件不变：导图、白板开过一遍，字节都没动
      expect(readFileSync(join(vault, mapPath), 'utf8')).toBe(mapText)
      expect(gitStatus(vault)).toBe('')

      // 撤回：再拍一张，点底栏「撤回」，导图、照片、白板上的卡一次全回去
      const before = git(vault, 'rev-parse', 'HEAD')
      const was = boardFile()
      await db.locator('.bpal').getByRole('button', { name: '拍导图' }).click()
      await shootAndPlace(page)
      await expect(toast(page)).toContainText('是这块白板的子白板')
      await expect.poll(() => git(vault, 'rev-list', '--count', `${before}..HEAD`)).toBe('1')
      await toast(page).getByRole('button', { name: '撤回' }).click()
      await expect.poll(() => git(vault, 'diff', '--name-only', before, 'HEAD')).toBe('')
      await expect.poll(boardFile).toBe(was)
      await expect(card).toHaveCount(1)
      expect(mapsIn(vault, '课程/线性代数')).toEqual([md])
      expect(gitStatus(vault)).toBe('')
      expect(head).not.toBe(before)
    } finally {
      await run.close()
    }
  })
}

for (const tone of ['sky', 'petrol'] as const) {
  test(`笔记里 /拍导图：导图在这篇旁边，光标处一块缩略图（不露列表原文），「打开 ›」是同一个文件；⌘K 在文档里也插在光标处（${tone}）`, async () => {
    const NOTE = '# 读书笔记\n\n第一段。\n\n第二段。\n'
    const run = await launch({ '写作/读书笔记.md': NOTE }, env(), settings({ frame: 'a', skin: tone }))
    const { page, vault } = run
    const noteFile = () => readFileSync(join(vault, '写作/读书笔记.md'), 'utf8')
    try {
      await openNote(page, '读书笔记')
      // 光标放到「第一段。」末尾，回车新起一段，打 /拍导图
      await pane(page).locator('.cm-line', { hasText: '第一段。' }).click()
      await page.keyboard.press('End')
      await page.keyboard.press('Enter')
      await page.keyboard.type('/拍导图')
      await expect(page.locator('.slash-menu button.on')).toContainText('拍导图')
      await page.keyboard.press('Enter')
      await shootAndPlace(page)

      await expect(tabOn(page)).toHaveText('读书笔记')
      await expect.poll(() => mapsIn(vault, '写作')).toHaveLength(1)
      const [md] = mapsIn(vault, '写作')
      const title = md!.replace(/\.md$/, '')
      const mapText = readFileSync(join(vault, '写作', md!), 'utf8')
      expect(mapText).toContain('所属笔记: "[[读书笔记]]"')
      expect(mapText).toMatch(/\]\(\.\.\/附件\/导图\//)
      await waitSaved(page)
      expect(noteFile()).toBe(`# 读书笔记\n\n第一段。\n\n![[${title}]]\n\n第二段。\n`)
      await expect.poll(() => git(vault, 'log', '-1', '--format=%s')).toMatch(/放进《读书笔记》/)
      expect(gitStatus(vault)).toBe('')
      // 缩略图块：头上「名字 · 15个主题」「打开 ›」，下面缩略；不露列表原文和 box 注释
      const block = pane(page).locator('[data-part="笔记里的导图块"]')
      await expect(block).toBeVisible()
      await expect(block.locator('.emh')).toContainText(`${title} · 15个主题`)
      await expect(block.locator('.mm-thumb rect')).not.toHaveCount(0)
      await expect(pane(page).locator('.cm-content')).not.toContainText('box=')
      await expect(pane(page).locator('.cm-content')).not.toContainText('线性映射')
      // 光标不停在块下面的空行上时：块上下离前后两段一样远（空行压矮，6.1）
      await pane(page).locator('.cm-line', { hasText: '第一段。' }).click()
      await page.waitForTimeout(300)
      const gaps = await pane(page).locator('.cm-content').evaluate((root) => {
        const lines = [...root.querySelectorAll<HTMLElement>('.cm-line')]
        const r = (t: string) => lines.find((l) => l.textContent === t)!.getBoundingClientRect()
        const b = root.querySelector('[data-part="笔记里的导图块"]')!.getBoundingClientRect()
        return { above: b.top - r('第一段。').bottom, below: r('第二段。').top - b.bottom }
      })
      expect(Math.abs(gaps.above - gaps.below)).toBeLessThanOrEqual(4)
      if (SHOTS) {
        await page.screenshot({ path: join(SHOTS, `note-block-${tone}.png`) })
        await block.screenshot({ path: join(SHOTS, `el-embed-${tone}.png`) })
      }

      // 「打开 ›」是同一个文件；面包屑多一节回到这篇
      await block.getByRole('button', { name: '打开 ›' }).click()
      await expect(tabOn(page)).toHaveText(title)
      await expect(page.getByRole('navigation', { name: '位置' }).locator('.cr')).toHaveText(['测试库', '写作', '读书笔记', title])
      await page.getByRole('navigation', { name: '位置' }).getByRole('button', { name: '读书笔记' }).click()
      await expect(tabOn(page)).toHaveText('读书笔记')

      // ⌘K「拍一张导图」在文档里：也插在光标处（文末「第二段。」后面）
      await pane(page).locator('.cm-line', { hasText: '第二段。' }).click()
      await page.keyboard.press('End')
      await page.keyboard.press('Meta+k')
      await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('拍一张导图')
      await expect(page.getByRole('dialog', { name: '搜索和命令' }).locator('.pal-row.on .nm')).toHaveText('拍一张导图')
      await page.getByRole('dialog', { name: '搜索和命令' }).locator('.pal-row.on').click()
      await shootAndPlace(page)
      await expect.poll(() => mapsIn(vault, '写作')).toHaveLength(2)
      await waitSaved(page)
      expect(noteFile()).toMatch(new RegExp(`第二段。\\n\\n!\\[\\[导图 [^\\]]+\\]\\]\\n`))
      await expect(pane(page).locator('[data-part="笔记里的导图块"]')).toHaveCount(2)
      expect(gitStatus(vault)).toBe('')
    } finally {
      await run.close()
    }
  })
}

test('首页 ⌘K 拍：照旧进收件箱，打开它', async () => {
  const run = await launch({ '写作/读书笔记.md': '# 读书笔记\n' }, env())
  const { page, vault } = run
  try {
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('拍一张导图')
    await expect(page.getByRole('dialog', { name: '搜索和命令' }).locator('.pal-row.on .nm')).toHaveText('拍一张导图')
    await page.getByRole('dialog', { name: '搜索和命令' }).locator('.pal-row.on').click()
    await shootAndPlace(page)
    await expect(tabOn(page)).toHaveText(/^导图 /)
    await expect.poll(() => mapsIn(vault, '收件箱')).toHaveLength(1)
    expect(readFileSync(join(vault, '收件箱', mapsIn(vault, '收件箱')[0]!), 'utf8')).not.toContain('所属')
    expect(mapsIn(vault, '写作')).toEqual([])
    await expect(acts(page).getByTestId('page-note')).toHaveText('收件箱 · 今晚梦游时归类、起名')
    expect(git(vault, 'log', '-1', '--format=%s')).toMatch(/进收件箱$/)
  } finally {
    await run.close()
  }
})
