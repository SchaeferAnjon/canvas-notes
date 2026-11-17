import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { gitStatus, launch, leftView, openInboxTab } from './app'
import { fakeNotesFolder, type FakeNote } from './fixtures/apple-notes'

// 导入 500 条备忘录 → 梦游（假引擎按原文件夹分，分批问）→ 预览 → 收下全部：量每一步多久、预览时界面卡不卡（long task）。
// 量到的数写进 CN_SHOTS_DIR/import-500.json（有这个环境变量时）。

const SHOTS = process.env.CN_SHOTS_DIR
const shot = async (page: Page, name: string) => SHOTS && (await page.screenshot({ path: join(SHOTS, `${name}.png`) }))
const git = (vault: string, ...args: string[]) => execFileSync('git', ['-C', vault, '-c', 'core.quotepath=false', ...args], { encoding: 'utf8' })
const sheet = (page: Page) => page.getByRole('dialog', { name: '导入旧笔记' })
const panel = (page: Page) => page.getByRole('complementary', { name: '梦游报告' })
const side = (page: Page) => page.locator('aside.side')
const bar = (page: Page) => page.getByTestId('preview-bar')

/** 500 条：线性代数 150、ECP 100、毕设 60、生活 150、杂 40（假引擎拿不准，留收件箱） */
function notes500(): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'cn-e2e-500-')), 'group.com.apple.notes')
  const plan: [string, number, string][] = [
    ['线性代数', 150, '线代'],
    ['ECP', 100, 'ECP 笔记'],
    ['毕设', 60, '实验记录'],
    ['生活', 150, '日常'],
    ['杂', 40, '随手'],
  ]
  const notes: FakeNote[] = []
  let k = 0
  for (const [folder, n, word] of plan)
    for (let i = 1; i <= n; i++) {
      const t = new Date(Date.UTC(2021, 0, 1) + k++ * 86400_000)
      notes.push({
        folder,
        created: t,
        modified: t,
        paras: [{ text: `${word} ${i}`, style: 0 }, { text: `第 ${i} 条的正文，${word}相关的一些内容，写得长一点好让预览有字可看。` }, { text: '要做的事', style: 103, done: i % 2 === 0 }],
      })
    }
  fakeNotesFolder(dir, [{ name: '学习' }, { name: '线性代数', parent: '学习' }, { name: 'ECP', parent: '学习' }, { name: '工作' }, { name: '毕设', parent: '工作' }, { name: '生活' }, { name: '杂' }], notes)
  return dir
}

test('500 条：导入、梦游分批归类、预览不卡、收下全部', async () => {
  test.setTimeout(15 * 60_000)
  const data = notes500()
  const run = await launch({ '课程/线性代数/第1讲.md': '# 第1讲\n' }, { CN_AI_FAKE: '1', CN_NOTES_DIR: data })
  const { page, vault } = run
  const m: Record<string, number> = {}
  try {
    // 界面里超过 50 毫秒的长任务都记下来
    await page.evaluate(() => {
      const w = window as unknown as { __long: number[] }
      w.__long = []
      new PerformanceObserver((l) => l.getEntries().forEach((e) => w.__long.push(e.duration))).observe({ type: 'longtask', buffered: false })
    })
    const longs = async () => {
      const l = await page.evaluate(() => (window as unknown as { __long: number[] }).__long.splice(0))
      return { n: l.length, max: Math.round(Math.max(0, ...l)) }
    }

    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('导入旧笔记')
    await page.getByRole('option', { name: /导入旧笔记…/ }).click()
    let t = Date.now()
    await sheet(page).getByRole('button', { name: /^备忘录/ }).click()
    await expect(sheet(page).getByTestId('import-summary')).toHaveText('选了5个文件夹 · 500条')
    m.scanMs = Date.now() - t
    t = Date.now()
    await sheet(page).getByRole('button', { name: '导入500条' }).click()
    await expect(sheet(page).getByTestId('import-result')).toContainText('从备忘录导入了500条', { timeout: 120_000 })
    m.importMs = Date.now() - t
    const li = await longs()
    m.importLongTasks = li.n
    m.importLongestMs = li.max
    expect(git(vault, 'show', '--name-only', '--format=', 'HEAD').trim().split('\n')).toHaveLength(500)

    // 梦游
    t = Date.now()
    await sheet(page).getByRole('button', { name: '现在就让梦游整理' }).click()
    await expect(panel(page).getByTestId('dream-summary')).toContainText('点「预览」看改好后的样子', { timeout: 10 * 60_000 })
    m.dreamMs = Date.now() - t
    const file = panel(page).getByRole('region', { name: '归类和改名' })
    // 大批量：只列按去处分的组，默认收起，一条都不铺开
    await expect(file.locator('.dg')).toHaveText('归类和改名460条 · 4组预览')
    await expect(file.getByTestId('dream-item')).toHaveCount(0)
    await expect(file.locator('.dstay')).toContainText('40条留着不动')
    await shot(page, 'import-500-report-light')
    await longs()

    // 预览：多久出来、出来时有没有长任务；左栏点一下、滚一下有没有卡
    t = Date.now()
    await file.getByRole('button', { name: '预览' }).click()
    await expect(bar(page)).toContainText('460条，分到4个文件夹')
    await expect(side(page)).toHaveClass(/previewing/)
    m.previewMs = Date.now() - t
    await leftView(page, '最近')
    await page.waitForTimeout(500)
    const lp = await longs()
    m.previewLongTasks = lp.n
    m.previewLongestMs = lp.max
    // 左栏：挪走的只露 5 条加「还有 N 条」，不铺开 460 行
    const ghosts = side(page).getByRole('group', { name: '收件箱 · 挪走的' })
    await expect(ghosts.locator('.pv-ghost')).toHaveCount(5)
    await expect(ghosts.locator('.s-none')).toHaveText('还有455条挪走的')
    m.sideRows = await side(page).locator('.si, .pv-ghost').count()
    t = Date.now()
    await openInboxTab(page)
    await expect(page.locator('.tab.on')).toContainText('收件箱')
    m.sideClickMs = Date.now() - t
    // 收件箱 500 条：先画最新的 60 张卡，底下一颗「再显示 60 条」
    const inbox = page.locator('.pane:not([hidden])')
    await expect(inbox.locator('.lcard')).toHaveCount(60)
    await inbox.getByRole('button', { name: /再显示\s*60\s*条\s*·\s*还有\s*440\s*条/ }).click()
    await expect(inbox.locator('.lcard')).toHaveCount(120)
    await expect(inbox.locator('.lcard').first().locator('.t')).toHaveText('2022年5月15日')
    await side(page).hover()
    await page.mouse.wheel(0, 600)
    await page.waitForTimeout(300)
    const ls = await longs()
    m.sideLongTasks = ls.n
    m.sideLongestMs = ls.max
    await shot(page, 'import-500-preview-light')

    // 收下全部：一次提交
    const before = Number(git(vault, 'rev-list', '--count', 'HEAD').trim())
    t = Date.now()
    await bar(page).getByRole('button', { name: '收下全部' }).click()
    await expect(page.getByTestId('preview-toast')).toContainText('收下了460处，已提交到main', { timeout: 120_000 })
    await expect(bar(page)).toHaveCount(0)
    m.takeAllMs = Date.now() - t
    expect(Number(git(vault, 'rev-list', '--count', 'HEAD').trim())).toBe(before + 1)
    expect(git(vault, 'ls-files', '课程/线性代数').trim().split('\n')).toHaveLength(151)
    expect(git(vault, 'ls-files', '收件箱').trim().split('\n')).toHaveLength(40)
    expect(gitStatus(vault)).toBe('')
    // 挪动不算改过：收下的 460 篇修改时间还是 2021、2022 年的，直接进归档，不占「今天」「这周」
    await leftView(page, '最近')
    await expect(page.locator('.sall .si', { hasText: '归档' })).toContainText('460篇')
    await expect(side(page).getByRole('group', { name: '今天' }).locator('.si .truncate')).toHaveText(['第1讲'])
    console.log('500 条量到的', JSON.stringify(m))
    if (SHOTS) writeFileSync(join(SHOTS, 'import-500.json'), JSON.stringify(m, null, 1))
    // 预览时界面不该卡住半秒以上
    expect(m.previewLongestMs).toBeLessThan(500)
    expect(m.sideLongestMs).toBeLessThan(200)
  } finally {
    await run.close()
    rmSync(dirname(data), { recursive: true, force: true })
  }
})
