// 交回时开头那张「在哪」标注图（task-9womr）：四格，软件真截的：① 对话最后一行「存成命令」② 那张表 ③ 另一篇里打 /，我的命令在最上面
// ④ 跑了以后先给你看：中间的对比标签和「收下 · 不要」。每格用编号框圈出来。平时跳过：CN_WHERE=<png 路径> npx playwright test e2e/r21-where.spec.ts
import { chromium, expect, test } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, openAi, type Running, tabOn } from './app'
import { skinned } from './fixtures/book-digest'

const OUT = process.env.CN_WHERE
test.skip(!OUT, '截「在哪」图才跑：CN_WHERE=<png 路径>')
test.setTimeout(5 * 60_000)

const W = 1440
const H = 887
const CHROMIUM = { ...(process.env.CN_CHROMIUM ? { executablePath: process.env.CN_CHROMIUM } : {}) }
const BEFORE = '# 学习笔记\n\n教材：《动手学深度学习》。\n\n> 张量表示一个由数值组成的数组。\n\n—— 2.1. 数据操作 — 动手学深度学习 2.0.0 documentation\n\n> 广播：形状不同时自动扩展。\n\n—— 2.1. 数据操作 — 动手学深度学习 2.0.0 documentation\n\n**问** 广播什么时候发生\n\n**答** 形状不同、但能扩展成一样时。\n'
const R1 = '# 学习笔记\n\n教材：《动手学深度学习》。\n\n## 2.1 数据操作\n\n> 张量表示一个由数值组成的数组。\n\n—— 2.1. 数据操作 — 动手学深度学习 2.0.0 documentation\n\n> 广播：形状不同时自动扩展。\n\n—— 2.1. 数据操作 — 动手学深度学习 2.0.0 documentation\n\n**问** 广播什么时候发生\n\n**答** 形状不同、但能扩展成一样时。\n'
const R2 = '# 学习笔记\n\n教材：《动手学深度学习》。\n\n## 2.1 数据操作\n\n出处：动手学深度学习 · 2.1 节\n\n张量就是多维数组；形状不同、能扩展成一样时自动广播。\n\n> 张量表示一个由数值组成的数组。\n\n**问** 广播什么时候发生\n\n**答** 形状不同、但能扩展成一样时。\n'
const LECTURE = '# 第2讲 预备知识\n\n## 张量\n\n张量就是多维数组。\n\n—— 出处：动手学深度学习\n'

type Box = { x: number; y: number; w: number; h: number; n: number }

async function shot(run: Running, sel: { css: string; n: number }[]): Promise<{ png: Buffer; boxes: Box[] }> {
  await run.page.waitForTimeout(400)
  const boxes: Box[] = []
  for (const s of sel) {
    const b = await run.page.locator(s.css).first().boundingBox()
    if (b) boxes.push({ x: b.x, y: b.y, w: b.width, h: b.height, n: s.n })
  }
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  return { png: Buffer.from(b64, 'base64'), boxes }
}

test('「在哪」标注图', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cn-where-'))
  writeFileSync(join(dir, 'r1.md'), R1)
  writeFileSync(join(dir, 'r2.md'), R2)
  const path = '课程/study project/学习笔记.md'
  writeFileSync(join(dir, 'rounds.json'), JSON.stringify([
    { say: '整理当前页面', path, file: join(dir, 'r1.md'), reply: '按书的章节加了小标题。' },
    { say: '就是那种通顺的 可读的', path, file: join(dir, 'r2.md'), reply: '改成了通顺的段落，出处只在节头写一次。' },
  ]))
  const run = await launch({ [path]: BEFORE, '课程/study project/第2讲 预备知识.md': LECTURE }, { CN_AI_FAKE: '1', CN_FAKE_ROUNDS: join(dir, 'rounds.json') }, skinned('sky'))
  const { page, app } = run
  try {
    await app.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0]!.setContentSize(s.w, s.h), { w: W, h: H })
    const open = async (name: string) => {
      await page.keyboard.press('Meta+k')
      await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill(name)
      await page.locator('.pal-row', { has: page.locator('.nm', { hasText: new RegExp(`^${name}$`) }) }).first().click()
      await expect(tabOn(page)).toHaveText(name)
    }
    await open('学习笔记')
    await openAi(page)
    const chat = page.getByRole('complementary', { name: 'AI 对话' })
    for (const say of ['整理当前页面', '就是那种通顺的 可读的']) {
      await chat.getByRole('textbox', { name: '问 AI' }).fill(say)
      await page.keyboard.press('Enter')
      await expect(chat.getByTestId('ai-msg').last().getByTestId('ai-change')).toBeVisible({ timeout: 15_000 })
    }
    const a = await shot(run, [{ css: '[data-testid="cmd-saverow"]', n: 1 }])
    await chat.getByRole('button', { name: '存成命令' }).click()
    const dlg = page.getByRole('dialog', { name: '存成命令' })
    await expect(dlg).toBeVisible()
    await page.waitForTimeout(800)
    const b = await shot(run, [{ css: '[role="dialog"][aria-label="存成命令"]', n: 2 }])
    await page.keyboard.press('Meta+Enter')
    await expect(dlg).toHaveCount(0)
    await open('第2讲 预备知识')
    await chat.getByRole('textbox', { name: '问 AI' }).click()
    await page.keyboard.type('/')
    await expect(page.getByTestId('slash-menu')).toBeVisible()
    const c = await shot(run, [{ css: '[data-testid="slash-menu"] .it', n: 3 }])
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('proposal-bar')).toBeVisible({ timeout: 15_000 })
    const d = await shot(run, [
      { css: '[data-testid="proposal-bar"]', n: 4 },
      { css: '[data-testid="ai-msg"]:last-child .acts', n: 5 },
    ])
    // 拼成 2×2，编号框照 DOM 量的位置画
    const notes = ['① 好几轮把一篇改成想要的样子以后，对话最后一行「存成命令」', '② 那张表：左边改前改后对照，右边看出的规矩和怎么用，底下存之前看清它会改什么', '③ 另一篇里打 /：我的命令在最上面，下面这一篇、整个库，列全、定死高度能滚', '④ 跑了以后先给你看：中间对比标签底下「收下 · 不要」', '⑤ 回答里也能收下、不要；收下才写进去，一次提交，回答下面能撤回']
    const cell = (s: { png: Buffer; boxes: Box[] }) =>
      `<div class="c"><img src="data:image/png;base64,${s.png.toString('base64')}">${s.boxes.map((x) => `<div class="b" style="left:${x.x - 4}px;top:${x.y - 4}px;width:${x.w + 8}px;height:${x.h + 8}px"><span>${'①②③④⑤'[x.n - 1]}</span></div>`).join('')}</div>`
    const bw = await chromium.launch(CHROMIUM)
    const p = await bw.newPage({ viewport: { width: W * 2 + 20, height: H * 2 + 20 + 150 } })
    await p.setContent(`<style>body{margin:0;background:#1d2730;font:16px -apple-system,"PingFang SC"}.g{display:grid;grid-template-columns:${W}px ${W}px;gap:20px}.c{position:relative;width:${W}px;height:${H}px}.c img{width:${W}px;height:${H}px;display:block}.b{position:absolute;border:3px solid #ff3b30;border-radius:8px;box-sizing:border-box}.b span{position:absolute;left:-14px;top:-14px;width:28px;height:28px;border-radius:50%;background:#ff3b30;color:#fff;font-weight:700;display:grid;place-items:center}.n{color:#e8eef2;padding:16px 20px;line-height:1.7;font-size:18px}</style><div class="g">${cell(a)}${cell(b)}${cell(c)}${cell(d)}</div><div class="n">${notes.join('<br>')}</div>`)
    await p.waitForTimeout(300)
    writeFileSync(OUT!, await p.screenshot({ fullPage: true }))
    await bw.close()
  } finally {
    await run.close()
  }
})
