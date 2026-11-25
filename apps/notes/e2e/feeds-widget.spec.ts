// 画布订阅联动（画布笔记这一侧，画布订阅第二批，设计页 135「文件夹首页『订阅』组件」）：
// 文件夹首页「编辑首页 › 加组件」加「画布订阅」→ 没读到画布订阅时一句话 +「打开画布订阅」；
// 画布订阅写了 widget.json（CN_FEEDS_DATA 指到临时目录）→ 列「全部」最新几篇，换成「科技」那一组（记进首页设置），点一篇走 canvas-feeds://item/<编号>
import { expect, type Page, test } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, type Running } from './app'

test.setTimeout(180_000)

const home = (page: Page) => page.getByTestId('folder-home')
const widget = (page: Page) => home(page).getByTestId('feeds-widget')
const screenLog = (run: Running) => run.app.evaluate(() => (globalThis as unknown as { cnScreen: string[] }).cnScreen.slice())
const openUrl = (run: Running, url: string) => run.app.evaluate(({ app }, u) => app.emit('open-url', { preventDefault: () => undefined }, u), url)

let dir = ''
test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cn-feeds-'))
})
test.afterEach(() => rmSync(dir, { recursive: true, force: true }))

const DATA = {
  v: 1,
  at: Date.now(),
  groups: [
    {
      id: 'all',
      name: '全部',
      unread: 2,
      articles: [
        { id: 'a_1', title: '提示词缓存省下的钱', feed: '测试博客', publishedAt: Date.now() - 30 * 60_000, read: false },
        { id: 'a_2', title: '本地优先的阅读器', feed: '测试博客', publishedAt: Date.now() - 3 * 3600_000, read: true },
      ],
    },
    { id: 'd_tech', name: '科技', unread: 1, articles: [{ id: 'a_3', title: 'Show HN: 800 个源 40 秒', feed: 'Hacker News', publishedAt: Date.now() - 2 * 3600_000, read: false }] },
  ],
}

test('文件夹首页的「画布订阅」组件：没读到时引导打开；读到了列一组的新文章，换一组记住，点一篇在画布订阅里打开', async () => {
  const feedsDir = join(dir, 'canvas-feeds')
  mkdirSync(feedsDir)
  const run = await launch({ '项目/读书/读书.md': '# 读书\n' }, { CN_FEEDS_DATA: feedsDir })
  const { page } = run
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openUrl(run, 'canvas-notes://open?file=' + encodeURIComponent('项目/读书'))
    await expect(home(page)).toHaveAttribute('data-folder', '项目/读书')
    await page.getByTestId('tab-acts').getByRole('button', { name: '编辑首页' }).click()
    await home(page).getByRole('button', { name: '加组件' }).click()
    const lib = page.getByRole('dialog', { name: '加组件' })
    await expect(lib.getByTestId('lib-feeds')).toContainText('绑一组订阅，列它的新文章')
    await lib.getByRole('button', { name: '加上 画布订阅' }).click()
    await lib.getByRole('button', { name: '完成' }).click()
    await page.getByTestId('tab-acts').getByRole('button', { name: '完成' }).click()

    // 还没有 widget.json：一句话 + 打开画布订阅
    await expect(widget(page)).toContainText('还没读到画布订阅')
    await widget(page).getByRole('button', { name: '打开画布订阅' }).click()
    await expect.poll(() => screenLog(run)).toContainEqual('用浏览器打开 canvas-feeds://')

    // 画布订阅写了那一份：窗口回到前面时读到，列「全部」
    writeFileSync(join(feedsDir, 'widget.json'), JSON.stringify(DATA))
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(widget(page).getByTestId('feeds-row')).toHaveCount(2)
    await expect(widget(page)).toContainText('2 篇没读')
    await expect(home(page).getByTestId('feeds-group')).toHaveText('订阅 · 全部')
    await expect(widget(page).getByTestId('feeds-row').first()).toContainText('提示词缓存省下的钱')
    await expect(widget(page).getByTestId('feeds-row').first()).toContainText('测试博客 · 30分钟前')
    // CN_FEEDS_SHOT=<文件> 时截一张（交付页用）
    if (process.env.CN_FEEDS_SHOT) {
      // 组件刚加上会闪一下：等闪完
      await page.waitForTimeout(2000)
      await page.screenshot({ path: process.env.CN_FEEDS_SHOT })
    }
    // 换成「科技」：记进这个文件夹的首页设置
    await home(page).getByTestId('feeds-group').click()
    await expect(home(page).getByTestId('feeds-group')).toHaveText('订阅 · 科技')
    await expect(widget(page).getByTestId('feeds-row')).toHaveCount(1)
    await expect.poll(() => readFileSync(join(run.vault, '项目/读书/.首页.json'), 'utf8'), { timeout: 15_000 }).toMatch(/"feedsGroup":\s*"d_tech"/)
    // 点一篇：canvas-feeds://item/<编号>
    await widget(page).getByTestId('feeds-row').first().getByRole('button').click()
    await expect.poll(() => screenLog(run)).toContainEqual('用浏览器打开 canvas-feeds://item/a_3')
  } finally {
    await run.close()
  }
})
