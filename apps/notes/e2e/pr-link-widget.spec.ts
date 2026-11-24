// ParaRead 联动（画布笔记这一侧，设计 20-pararead联动「ParaRead 组件放进画布笔记」「两个来源」）：
// 课程首页「编辑首页 › 加组件」加 ParaRead 组件 → 没装时「这台 Mac 上没装 ParaRead」、点「下载 ParaRead」变「等你装好」、
// 装上后点「装好了，再看一下」换成在读那篇（读到哪是 ParaRead 记在库里那份的，还有几处看不懂数配对笔记）、「继续读」走 pararead://open 深链；
// ParaRead 回来的深链 canvas-notes://open?file=<文件夹> 开那个文件夹首页；出卡里划成「定义」的那条默认勾上
import { expect, type Page, test } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, rail, type Running, tabOn } from './app'
import { LECTURE, ROTATION } from './fixtures/pdf'

test.setTimeout(180_000)

const A = '课程/线代/第3讲 线性映射.pdf'
const B = '课程/线代/第4讲 旋转.pdf'
const NOTE_A = `---
类型: 笔记
来源: "[[第3讲 线性映射.pdf]]"
进度: 4/5
---
# 第3讲 线性映射 笔记

## 第 2 页 · 划的线
- ==Both rules together keep linear combinations.== · 定义 · [第 2 页](第3讲%20线性映射.pdf#page=2&rect=0.118,0.224,0.387,0.023) <!-- cn:hl=p2-h1 k=def -->

## 第 4 页 · 看不懂：The kernel is the set of vec…
[第 4 页](第3讲%20线性映射.pdf#page=4&rect=0.118,0.173,0.369,0.023) · 16:44 <!-- cn:thread=第3讲 线性映射-p4-1 -->

> [!question] 看不懂
> ==The kernel is the set of vectors sent to zero.== <!-- cn:hl=p4-h1 k=confused -->
`
/** ParaRead 今天 15:26 读到第 3 页、40%、读了 39 分钟（两个软件共用的那份） */
const READ_AT = JSON.stringify({ files: { [A]: { page: 3, pages: 5, pct: 40, section: 'Example 3.4 Rotation', at: Date.now() - 60_000, by: 'pararead', ms: { pararead: 39 * 60_000 } } } }, null, 2) + '\n'

const files = { [A]: LECTURE, [B]: ROTATION, ['课程/线代/第3讲 线性映射 笔记.md']: NOTE_A, '.canvas-notes/读到哪.json': READ_AT }

const home = (page: Page) => page.getByTestId('folder-home')
const widget = (page: Page) => home(page).getByTestId('pararead-widget')
const screenLog = (run: Running) => run.app.evaluate(() => (globalThis as unknown as { cnScreen: string[] }).cnScreen.slice())

let dir = ''
test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cn-pr-'))
})
test.afterEach(() => rmSync(dir, { recursive: true, force: true }))

/** ParaRead 回画布笔记的深链（照 macOS 交给软件的 open-url） */
const openUrl = (run: Running, url: string) => run.app.evaluate(({ app }, u) => app.emit('open-url', { preventDefault: () => undefined }, u), url)

test('课程首页的 ParaRead 组件：没装时下载引导，装上后在读那篇、读到哪、看不懂几处，继续读走深链；深链回文件夹首页；定义出卡默认勾上', async () => {
  const installed = join(dir, 'installed.json')
  writeFileSync(installed, '{}')
  const run = await launch(files, { CN_FAMILY_INSTALLED_FILE: installed, CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    // ParaRead 回来：canvas-notes://open?file=课程/线代 开这个文件夹的首页
    await openUrl(run, 'canvas-notes://open?file=' + encodeURIComponent('课程/线代'))
    await expect(home(page)).toHaveAttribute('data-folder', '课程/线代')
    await expect(tabOn(page)).toHaveText('线代')

    // 加组件：「通用」里有 ParaRead
    await page.getByTestId('tab-acts').getByRole('button', { name: '编辑首页' }).click()
    await home(page).getByRole('button', { name: '加组件' }).click()
    const lib = page.getByRole('dialog', { name: '加组件' })
    await expect(lib.getByTestId('lib-pararead')).toContainText('对照读这个文件夹的PDF：读到哪、还有几处看不懂')
    await lib.getByRole('button', { name: '加上 ParaRead' }).click()
    await lib.getByRole('button', { name: '完成' }).click()
    await page.getByTestId('tab-acts').getByRole('button', { name: '完成' }).click()

    // 没装：说明、下载，PDF 照样列，右边是画布笔记「问到第几页」
    await expect(widget(page)).toContainText('这台 Mac 上没装 ParaRead')
    await expect(widget(page)).toContainText('读英文论文：每段原文下面跟一段译文')
    await expect(widget(page).getByTestId('pararead-row')).toHaveCount(2)
    await expect(widget(page).getByTestId('pararead-row').first()).toContainText('问到 4 / 5 页')
    await widget(page).getByTestId('pararead-download').click()
    await expect.poll(() => screenLog(run)).toContainEqual(expect.stringContaining('https://pararead.us-cloud.uk'))
    await expect(widget(page)).toContainText('等你装好')

    // 装好了，再看一下：换成在读那篇
    writeFileSync(installed, JSON.stringify({ pararead: '0.2.0' }))
    await widget(page).getByRole('button', { name: '装好了，再看一下' }).click()
    await expect(widget(page)).toContainText('在读 第3讲 线性映射 · 读到 40%')
    await expect(widget(page)).toContainText('Example 3.4 Rotation')
    await expect(widget(page)).toContainText('读了 39 分钟')
    await expect(widget(page)).toContainText('还有 1 处看不懂')
    await expect(widget(page).getByTestId('pararead-row').first()).toContainText('40% · 看不懂 1')
    await expect(widget(page).getByTestId('pararead-row').nth(1)).toContainText('没读过')
    await expect(home(page).locator('[data-widget] .wk-app')).toHaveCount(1)

    // 继续读：深链 pararead://open，翻到第 3 页，带着库和这个文件夹
    await widget(page).getByTestId('pararead-continue').click()
    const url = new URL((await screenLog(run)).find((x) => x.startsWith('用 ParaRead 打开 '))!.slice('用 ParaRead 打开 '.length))
    expect(url.protocol).toBe('pararead:')
    expect(url.searchParams.get('file')).toBe(join(vault, A))
    expect(url.searchParams.get('page')).toBe('3')
    expect(url.searchParams.get('vault')).toBe(vault)
    expect(url.searchParams.get('back')).toBe('课程/线代')
    expect(url.searchParams.get('view')).toBe('bilingual')
    const lastUrl = async () => new URL((await screenLog(run)).filter((x) => x.startsWith('用 ParaRead 打开 ')).pop()!.slice('用 ParaRead 打开 '.length))
    // 「换成原文看」只换这一次；头上小标签「线代 · 对照」点了改这个文件夹的默认看法，记在首页设置里
    await widget(page).getByTestId('pararead-alt').click()
    await expect.poll(async () => (await lastUrl()).searchParams.get('view')).toBe('original')
    const tag = home(page).getByTestId('pararead-view')
    await expect(tag).toHaveText('线代 · 对照')
    await tag.click()
    await expect(tag).toHaveText('线代 · 原文')
    await expect(widget(page).getByTestId('pararead-alt')).toHaveText('换成对照看')
    await widget(page).getByTestId('pararead-continue').click()
    await expect.poll(async () => (await screenLog(run)).filter((x) => x.includes('view=original')).length).toBe(2)

    // 「笔记」：在画布笔记里开配对笔记
    await widget(page).getByTestId('pararead-row').first().getByRole('button', { name: '笔记' }).click()
    await expect(tabOn(page)).toHaveText('第3讲 线性映射 笔记')

    // 出卡：划成「定义」的那一条一张，字是现成的，默认勾上（没问过 AI 的看不懂不出卡）
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲 线性映射')
    await page.locator('.pal-row', { hasText: '第3讲 线性映射.pdf' }).first().click()
    await expect(tabOn(page)).toHaveText('第3讲 线性映射.pdf')
    const notes = page.getByRole('complementary', { name: '笔记', exact: true })
    if (!(await notes.isVisible())) await rail(page).getByRole('button', { name: '笔记' }).first().click()
    await expect(notes.getByTestId('cards-open')).toHaveText('出卡 · 1问')
    await notes.getByTestId('cards-open').click()
    const dlg = page.getByRole('dialog', { name: '出卡' })
    await expect(dlg).toContainText('你划成「定义」的：「Both rules together keep linear combinations.」')
    await expect(dlg).toContainText('「Both rules together keep linear combinations.」是什么意思？')
    await expect(dlg.getByRole('button', { name: '送进Anki · 1张' })).toBeVisible()
  } finally {
    await run.close()
  }
})
