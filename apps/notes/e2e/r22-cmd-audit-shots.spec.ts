// 并排对照图（命令审核文档类修复，task-1l29q、task-f4kf7）：同一个窗口（1440×887）、浅色天青、深色深湖各一套，左边是邻页（原来就有的样子），右边是这次改的：
// 1. proposal-warn-*：左「先给你看」平常那一条（/整理成通顺笔记，整篇都在），右 AI 漏了后面三节（/整理成要点）：文件条「删了3节」、底条红字、「照样收下」；
// 2. week-merge-*：左第一次写这周的周记（新文件），右同一周再写一次（改那一篇，回答开头先说这周已经有）。
// 平时跳过：CN_SHOTS=<目录> npx playwright test e2e/r22-cmd-audit-shots.spec.ts
import { chromium, expect, test, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, openAi, type Running } from './app'
import { skinned } from './fixtures/book-digest'

const SHOTS = process.env.CN_SHOTS
test.skip(!SHOTS, '截对照图才跑：CN_SHOTS=<目录>')
test.setTimeout(5 * 60_000)

const CHROMIUM = { ...(process.env.CN_CHROMIUM ? { executablePath: process.env.CN_CHROMIUM } : {}) }
const W = 1440
const H = 887
const NOTE = '---\ntags: [机器学习]\n---\n# 第2讲 预备知识\n\n## 张量\n\n张量就是多维数组，一个轴是向量，两个轴是矩阵。\n\n```python\nx = torch.arange(12)\nX = x.reshape(3, 4)\n```\n\n## 广播\n\n形状不同的两个张量，按元素运算前会自动扩展成一样的形状。\n\n## 自动微分\n\nbackward 只能对标量调用，要对向量求导先把它加起来变成一个数。\n\n## 线性回归回顾\n\n线性回归用均方误差当损失函数，最小二乘有解析解。\n'
const OWN = {
  version: 1,
  own: [
    { id: 'own-tidy', name: '整理成通顺笔记', kind: 'ai', target: '1. 同一个出处只写一次', rules: [{ t: '同一个出处只写一次' }], where: ['doc'], write: 'inplace', desc: '照「学习笔记」3 轮前后的对比提炼，每次先给你看' },
    { id: 'own-short', name: '整理成要点', kind: 'ai', target: '1. 把正文整理成要点\n2. （测试：漏掉后面几节）', rules: [{ t: '把正文整理成要点' }, { t: '（测试：漏掉后面几节）' }], where: ['doc'], write: 'inplace', desc: '整理成要点' },
  ],
}

async function winShot(run: Running): Promise<Buffer> {
  await run.page.waitForTimeout(400)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  return Buffer.from(b64, 'base64')
}

/** 左右拼成一张，上面一行写哪边是哪边 */
async function pair(name: string, left: [string, Buffer], right: [string, Buffer]) {
  const b = await chromium.launch(CHROMIUM)
  const p = await b.newPage({ viewport: { width: W * 2 + 24, height: H + 40 } })
  const img = (x: Buffer) => `data:image/png;base64,${x.toString('base64')}`
  const col = ([t, x]: [string, Buffer]) => `<div><div style="height:32px;line-height:32px;color:#fff;padding-left:8px">${t}</div><img src="${img(x)}" style="width:${W}px;height:${H}px;display:block"></div>`
  await p.setContent(`<body style="margin:0;background:#888;font:14px -apple-system"><div style="display:flex;gap:24px">${col(left)}${col(right)}</div></body>`)
  await p.waitForTimeout(200)
  writeFileSync(join(SHOTS!, `${name}.png`), await p.screenshot({ fullPage: true }))
  await b.close()
}

const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })

async function slash(page: Page, typed: string, name: string) {
  const box = chat(page).getByRole('textbox', { name: '问 AI' })
  await box.click()
  await box.fill('')
  await page.keyboard.type('/' + typed)
  await page.getByTestId('slash-menu').locator(`.it:has(.n:text-is("${name}"))`).first().click()
}

async function openNote(page: Page, name: string) {
  await page.keyboard.press('Meta+k')
  await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill(name)
  await page.locator('.pal-row', { has: page.locator('.nm', { hasText: new RegExp(`^${name}$`) }) }).first().click()
}

/** 交回报告开头的「在哪」图：在真窗口上照元素的位置画编号框（框和编号画在页面最上层，不挡点按） */
async function mark(page: Page, boxes: { sel: string; n: number }[]) {
  await page.evaluate((list) => {
    for (const b of list) {
      const el = [...document.querySelectorAll(b.sel)].pop()
      if (!el) throw new Error(`找不到 ${b.sel}`)
      const r = el.getBoundingClientRect()
      const box = document.createElement('div')
      box.style.cssText = `position:fixed;left:${r.left - 4}px;top:${r.top - 4}px;width:${r.width + 8}px;height:${r.height + 8}px;border:2.5px solid #e8590c;border-radius:8px;z-index:99999;pointer-events:none`
      const tag = document.createElement('div')
      tag.textContent = String(b.n)
      tag.style.cssText = `position:fixed;left:${r.left - 16}px;top:${r.top - 16}px;width:24px;height:24px;border-radius:12px;background:#e8590c;color:#fff;font:600 14px/24px -apple-system;text-align:center;z-index:100000;pointer-events:none`
      document.body.append(box, tag)
    }
  }, boxes)
}

test('「在哪」图：先给你看少了整节时的三处（文件条、底条、AI 回答）', async () => {
  const run = await launch({ '课程/第2讲 预备知识.md': NOTE, '.canvas-notes/命令.json': JSON.stringify(OWN) }, { CN_AI_FAKE: '1' }, skinned('sky'))
  const { page, app } = run
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    await openNote(page, '第2讲 预备知识')
    await openAi(page)
    await slash(page, '整理成要', '整理成要点')
    await expect(page.getByTestId('proposal-bar')).toHaveClass(/warn/, { timeout: 15_000 })
    await mark(page, [
      { sel: '[data-testid="diff-tab"] .dv-sum.warn', n: 1 },
      { sel: '[data-testid="proposal-bar"]', n: 2 },
      { sel: '[aria-label="AI 对话"] [data-testid="ai-msg"]', n: 3 },
    ])
    writeFileSync(join(SHOTS!, 'where.png'), await winShot(run))
  } finally {
    await run.close()
  }
})

for (const dark of [false, true]) {
  const skin = dark ? 'petrol' : 'sky'
  const tag = dark ? 'dark' : 'light'

  test(`先给你看：平常那一条 vs 少了整节标红（${tag}）`, async () => {
    const run = await launch({ '课程/第2讲 预备知识.md': NOTE, '.canvas-notes/命令.json': JSON.stringify(OWN) }, { CN_AI_FAKE: '1' }, skinned(skin))
    const { page, app } = run
    try {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
      await openNote(page, '第2讲 预备知识')
      await openAi(page)
      await slash(page, '整理成通', '整理成通顺笔记')
      const bar = page.getByTestId('proposal-bar')
      await expect(bar).toBeVisible({ timeout: 15_000 })
      const calm = await winShot(run)
      await bar.getByRole('button', { name: '不要' }).click()
      await slash(page, '整理成要', '整理成要点')
      await expect(bar).toHaveClass(/warn/, { timeout: 15_000 })
      const warn = await winShot(run)
      await pair(`proposal-warn-${tag}`, ['邻页：先给你看平常那一条（整篇都在）', calm], ['这次：AI 漏了后面三节，标红、只给「照样收下」', warn])
    } finally {
      await run.close()
    }
  })

  test(`写这周的周记：第一次新建 vs 同一周再写并进那一篇（${tag}）`, async () => {
    const run = await launch({ '课程/梯度下降.md': '# 梯度下降\n\n学习率太大会震荡。\n' }, { CN_AI_FAKE: '1' }, skinned(skin))
    const { page, app, vault } = run
    try {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
      await openNote(page, '梯度下降')
      await openAi(page)
      await slash(page, '周记', '写这周的周记')
      const bar = page.getByTestId('proposal-bar')
      await expect(bar).toBeVisible({ timeout: 15_000 })
      const first = await winShot(run)
      await bar.getByRole('button', { name: '收下' }).click()
      await expect(chat(page).getByTestId('ai-msg').last().getByTestId('ai-change')).toBeVisible()
      writeFileSync(join(vault, '课程/新的一篇.md'), '# 新的一篇\n\n周五新写的。\n')
      const { execFileSync } = await import('node:child_process')
      execFileSync('git', ['-C', vault, 'add', '-A'])
      execFileSync('git', ['-C', vault, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', '新的一篇'])
      await slash(page, '周记', '写这周的周记')
      await expect(bar).toBeVisible({ timeout: 15_000 })
      await expect(chat(page).getByTestId('ai-msg').last()).toContainText('这周已经有')
      const merged = await winShot(run)
      await pair(`week-merge-${tag}`, ['邻页：第一次写这周的周记（新文件）', first], ['这次：同一周再写，并进那一篇（改）', merged])
    } finally {
      await run.close()
    }
  })
}
