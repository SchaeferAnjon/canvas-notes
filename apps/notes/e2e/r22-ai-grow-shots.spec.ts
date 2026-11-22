// 并排对照图（task-6kun1）：左边流光原型 A2（proto-a2.html），右边软件，同一个状态，浅色天青、深色深湖各一套：
// - para：AI 在第二段后面写一段，字长到一半（原型「写一段」，软件是 AI 对话里「插入」走 doc_insert）；
// - stop：写到一半按 esc（原型「写一段」停下，软件是文档里 / 菜单「AI 写一段」停下）；
// - card：白板上 AI 加一张卡，字长到一半（原型「加一张卡」）；
// 原型没有的两处只截软件：/ 菜单「AI 写一段」长到一半（app-slash-*）、AI 对话里 AI 自己续写一节（app-chat-*）。
// 浅色另录一张 para 的动图（左右并排，每 200 毫秒一帧）。
// 平时跳过：CN_SHOTS=<目录> npx playwright test e2e/r22-ai-grow-shots.spec.ts（原型路径 CN_PROTO，默认 canvas-notes-glow/v2/proto-a2.html）。
import { chromium, expect, type Page, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { editorText, launch, openNote, pane, type Running } from './app'
import { skinned } from './fixtures/book-digest'

const SHOTS = process.env.CN_SHOTS
const PROTO = process.env.CN_PROTO ?? '/private/tmp/canvas-notes-glow/v2/proto-a2.html'
test.skip(!SHOTS, '截对照图才跑：CN_SHOTS=<目录>')
test.setTimeout(5 * 60_000)

/** 这台 Mac 上装着的无头 Chromium（Playwright 自己那份没下的时候用；CN_CHROMIUM 能换） */
const CHROMIUM = { ...(process.env.CN_CHROMIUM ? { executablePath: process.env.CN_CHROMIUM } : {}) }

const NOTE = `# 学习笔记：动手学深度学习

这周的目标是读懂晨佩那篇论文里用到的模型，不求会写代码。教材只读和 C72 有关的 11 个小节。

残差网络的核心是在每一层加一条跳过去的捷径，输入可以直接加到输出上，所以就算中间那几层什么都没学到，至少也能把输入原样传下去，这样网络加深之后训练误差不会变大，这是 ResNet 能做到一百多层的原因。

## 循环神经网络

RNN 每一步都把上一步的隐藏状态带过来。序列一长，梯度在一步步往回传的时候会越乘越小，前面的信息就传不过来了，所以才有 LSTM。

LSTM 用三个门控制信息：遗忘门决定丢掉什么，输入门决定记下什么，输出门决定这一步给出什么。论文 C72 用的是双向 LSTM，正着读一遍、倒着读一遍再拼起来。

下周再看注意力机制。
`
const PARA = '为什么先读 SAGE：它和 C72 用的是同一批睡眠数据，数字可以直接对照。先看它的 Fig. 2，弄清每个方块在做什么，再回来读 C72 就快得多。'
const CARD = '这周时间怎么分：论文 3.5 小时，教材 5.5 小时，视频 1 小时。周三前读完 SAGE，周末读 C72。'
const BOARD = `---
type: board
---
# 本周学习计划

## 这周要补的知识

对，先看晨佩的论文。这周只补读懂论文要用的知识，大约 8 小时；PyTorch 这些等选定方向再学。

读 SAGE 时留意一组数字：随机划分准确率 91.8%，留一被试只有 80.6%。

## 这周读这些

吴恩达的课正好接得上这本《动手学深度学习》。这周只读和 C72 有关的 11 个小节，大约 5.5 小时。

这周先跳过：第 1–3 章和 4.1–4.3、4.7，吴恩达课里讲过。
`

/** 软件整个窗口 */
async function winShot(run: Running): Promise<Buffer> {
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  return Buffer.from(b64, 'base64')
}

/** 左原型、右软件拼成一张（上面一行写哪边是哪边），两边按软件窗口的宽高放 */
async function pair(name: string, left: Buffer, right: Buffer, w: number, h: number) {
  const b = await chromium.launch(CHROMIUM)
  const p = await b.newPage({ viewport: { width: w * 2 + 24, height: h + 40 } })
  const img = (x: Buffer) => `data:image/png;base64,${x.toString('base64')}`
  await p.setContent(
    `<body style="margin:0;background:#888;font:14px -apple-system"><div style="display:flex;gap:24px"><div><div style="height:32px;line-height:32px;color:#fff;padding-left:8px">原型 proto-a2.html</div><img src="${img(left)}" style="width:${w}px;height:${h}px;display:block;object-fit:contain;object-position:top left"></div><div><div style="height:32px;line-height:32px;color:#fff;padding-left:8px">软件</div><img src="${img(right)}" style="width:${w}px;height:${h}px;display:block"></div></div></body>`,
  )
  await p.waitForTimeout(200)
  writeFileSync(join(SHOTS!, `${name}.png`), await p.screenshot({ fullPage: true }))
  await b.close()
}

/** 原型：开一个场景，控制条藏起来（演示用的，不算），开始以后等 ms 截一张；stop：截之前按 esc */
async function protoShots(dark: boolean, scene: 'para' | 'card', w: number, h: number, at: number[], stop = false): Promise<Buffer[]> {
  const b = await chromium.launch(CHROMIUM)
  const p = await b.newPage({ viewport: { width: w, height: h + 76 } })
  await p.goto(`file://${PROTO}#scene=${scene}&noauto&theme=${dark ? 'dark' : 'light'}&skin=${dark ? 'petrol' : 'sky'}`)
  await p.waitForTimeout(300)
  await p.click('#bStart')
  const t0 = Date.now()
  const out: Buffer[] = []
  for (const ms of at) {
    await p.waitForTimeout(Math.max(0, ms - (Date.now() - t0)))
    if (stop) {
      await p.keyboard.press('Escape')
      await p.waitForTimeout(250)
    }
    out.push(await p.screenshot({ clip: { x: 0, y: 76, width: w, height: h } }))
  }
  await b.close()
  return out
}

const box = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' }).getByRole('textbox', { name: '问 AI' })
/** 在 AI 输入框里打一句发出去（先点进输入框：焦点还在文档里时 fill 偶尔会打进文档） */
async function ask(page: Page, text: string) {
  await box(page).click()
  await expect(box(page)).toBeFocused()
  await box(page).fill(text)
  await box(page).press('Enter')
}
/** 光标放到这一段的末尾（一段折成好几行时点最后一行的右下角，End 只到这一行的末尾） */
async function endOf(page: Page, text: string) {
  const line = pane(page).locator('.cm-line', { hasText: text })
  const b = (await line.boundingBox())!
  await line.click({ position: { x: b.width - 4, y: b.height - 6 } })
  await page.keyboard.press('End')
}

/** 看得见 want 从头起的几个字 */
const shown = (page: Page, want: string) =>
  pane(page)
    .locator('.cm-content')
    .evaluate((el, w) => {
      const v = Array.from(el.querySelectorAll('.cm-line'), (l) => l.textContent ?? '').join('\n')
      let k = 0
      while (k < w.length && v.includes(w.slice(0, k + 1))) k++
      return k
    }, want)

for (const dark of [false, true]) {
  const tone = dark ? 'dark' : 'light'
  /** 一篇干净的「学习笔记」，开好 AI 那一格；光标放在第二段末尾 */
  async function fresh(env: Record<string, string> = {}) {
    const run = await launch({ '课程/study project/学习笔记.md': NOTE }, { CN_AI_FAKE: '1', CN_FAKE_SAY_MS: '60', CN_FAKE_OWN_MS: '200', ...env }, skinned(dark ? 'petrol' : 'sky'))
    const size = await run.page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
    await openNote(run.page, '学习笔记')
    await run.page.keyboard.press('Meta+j')
    await endOf(run.page, '残差网络的核心')
    return { run, page: run.page, size }
  }

  test(`AI 在写这一段（${tone}）：原型「写一段」和软件 AI 插入的一段长到一半`, async () => {
    mkdirSync(SHOTS!, { recursive: true })
    const { run, page, size } = await fresh()
    try {
      // 跟 AI 说在光标这里插一段（AI 用 doc_insert 插在光标那一段后面）
      await ask(page, `插入「${PARA}」`)
      await expect.poll(() => shown(page, PARA), { timeout: 15_000, intervals: [30] }).toBeGreaterThanOrEqual(28)
      const app = await winShot(run)
      const [proto] = await protoShots(dark, 'para', size.w, size.h, [1000])
      await pair(`para-${tone}`, proto!, app, size.w, size.h)
    } finally {
      await run.close()
    }
  })

  if (!dark)
    test('写一段的动图（light）：干净的一篇、写在第二段后面，从字出来起每 200 毫秒一帧，左原型右软件', async () => {
      mkdirSync(SHOTS!, { recursive: true })
      const { run, page, size } = await fresh()
      const dir = join(SHOTS!, 'para-frames')
      try {
        rmSync(dir, { recursive: true, force: true })
        mkdirSync(dir, { recursive: true })
        const t = [0, 200, 400, 600, 800, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2400, 2800, 3200, 3600, 4000]
        await ask(page, `插入「${PARA}」`)
        await expect.poll(async () => (await editorText(page)).includes(PARA), { timeout: 15_000, intervals: [20] }).toBe(true)
        const t0 = Date.now()
        const apps: Buffer[] = []
        for (const ms of t) {
          await page.waitForTimeout(Math.max(0, ms - (Date.now() - t0)))
          apps.push(await winShot(run))
        }
        const protos = await protoShots(dark, 'para', size.w, size.h, t)
        for (let i = 0; i < t.length; i++) {
          const n = String(i).padStart(2, '0')
          writeFileSync(join(dir, `p${n}.png`), protos[i]!)
          writeFileSync(join(dir, `a${n}.png`), apps[i]!)
          execFileSync('magick', [join(dir, `p${n}.png`), '-resize', `${size.w}x${size.h}!`, join(dir, `a${n}.png`), '-resize', `${size.w}x${size.h}!`, '+append', '-resize', '1600x', join(dir, `f${n}.png`)])
        }
        execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '5', '-i', join(dir, 'f%02d.png'), '-vf', 'split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer', join(SHOTS!, 'para-light.gif')])
      } finally {
        await run.close()
      }
    })

  test(`AI 对话里 AI 自己续写一节（${tone}，只截软件）：干净的一篇，全能模式像 Claude Code 用命令写进文件`, async () => {
    mkdirSync(SHOTS!, { recursive: true })
    const { run, page } = await fresh()
    try {
      const more = '## 这周小结\n\n残差和 LSTM 都是在解决信息传不下去的问题：一个靠捷径，一个靠门。读 C72 时先看它怎么接这两样。'
      await ask(page, `过一会儿在「课程/study project/学习笔记.md」末尾加「${more}」`)
      await expect.poll(() => shown(page, '残差和 LSTM 都是在解决信息传不下去的问题'), { timeout: 15_000, intervals: [30] }).toBeGreaterThanOrEqual(8)
      await pane(page).locator('.cm-line', { hasText: '这周小结' }).scrollIntoViewIfNeeded()
      writeFileSync(join(SHOTS!, `app-chat-${tone}.png`), await winShot(run))
      // 「在哪」图（浅色）：在真窗口上按量到的位置画编号框：① 正在长的那一节 ② 左边竖线 ③ 「AI 在写这一段 · 停下 esc」 ④ 右栏 AI 对话里那一问
      if (!dark) {
        await page.evaluate(() => {
          const r = (el: Element | null | undefined) => el?.getBoundingClientRect()
          const lines = [...document.querySelectorAll('.pane:not([hidden]) .cm-line')].filter((l) => /这周小结|残差和 LSTM/.test(l.textContent ?? ''))
          const a = r(lines[0])
          const b = r(lines.at(-1))
          const bar = [...document.querySelectorAll('.pane:not([hidden]) [data-testid="ai-spot-line"]')].at(-1)
          const pill = [...document.querySelectorAll('.pane:not([hidden]) [data-testid="ai-spot-bar"]')].at(-1)
          const user = [...document.querySelectorAll('.um-wrap .um')].at(-1)
          const boxes: [number, DOMRect | undefined, number][] = [
            [1, a && b ? new DOMRect(a.x - 4, a.y - 4, Math.max(a.width, b.width) * 0.62, b.bottom - a.y + 8) : undefined, 0],
            [2, r(bar) && new DOMRect(r(bar)!.x - 8, r(bar)!.y - 4, 18, r(bar)!.height + 8), 0],
            [3, r(pill) && new DOMRect(r(pill)!.x - 4, r(pill)!.y - 4, r(pill)!.width + 8, r(pill)!.height + 8), 0],
            [4, r(user), 0],
          ]
          for (const [n, box] of boxes) {
            if (!box) continue
            const d = document.createElement('div')
            d.style.cssText = `position:fixed;left:${box.x}px;top:${box.y}px;width:${box.width}px;height:${box.height}px;border:3px solid #16a34a;border-radius:6px;z-index:99999;pointer-events:none`
            const t = document.createElement('b')
            t.textContent = String(n)
            t.style.cssText = 'position:absolute;left:-14px;top:-14px;width:24px;height:24px;border-radius:12px;background:#16a34a;color:#fff;font:700 14px/24px -apple-system;text-align:center'
            d.appendChild(t)
            document.body.appendChild(d)
          }
        })
        writeFileSync(join(SHOTS!, 'where-light.png'), await winShot(run))
      }
    } finally {
      await run.close()
    }
  })

  if (!dark)
    test('减少动态（light，只截软件）：AI 写进来的直接全显，竖线不走', async () => {
      mkdirSync(SHOTS!, { recursive: true })
      const { run, page } = await fresh()
      try {
        await page.emulateMedia({ reducedMotion: 'reduce' })
        const more = '## 这周小结\n\n残差和 LSTM 都是在解决信息传不下去的问题：一个靠捷径，一个靠门。读 C72 时先看它怎么接这两样。'
        await ask(page, `过一会儿在「课程/study project/学习笔记.md」末尾加「${more}」`)
        await expect.poll(() => shown(page, '残差和 LSTM 都是在解决信息传不下去的问题：一个靠捷径，一个靠门。'), { timeout: 15_000, intervals: [30] }).toBe('残差和 LSTM 都是在解决信息传不下去的问题：一个靠捷径，一个靠门。'.length)
        await pane(page).locator('.cm-line', { hasText: '这周小结' }).scrollIntoViewIfNeeded()
        writeFileSync(join(SHOTS!, 'app-still-light.png'), await winShot(run))
      } finally {
        await run.close()
      }
    })

  test(`停下（${tone}）：原型「写一段」写到一半 esc，软件 / 菜单「AI 写一段」写到一半 esc；/ 菜单写到一半只截软件`, async () => {
    mkdirSync(SHOTS!, { recursive: true })
    const run = await launch({ '课程/study project/学习笔记.md': NOTE }, { CN_AI_FAKE: '1', CN_FAKE_SAY_MS: '70' }, skinned(dark ? 'petrol' : 'sky'))
    const { page } = run
    try {
      const size = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
      await openNote(page, '学习笔记')
      await endOf(page, '残差网络的核心')
      await page.keyboard.press('Enter')
      await page.keyboard.press('Enter')
      await page.keyboard.type('/ai')
      await page.keyboard.press('Enter')
      await expect(page.getByRole('textbox', { name: '让 AI 写什么' })).toBeFocused()
      await page.keyboard.type('在第二段后面补一段：为什么先读 SAGE')
      await page.keyboard.press('Enter')
      await expect.poll(() => shown(page, PARA), { timeout: 15_000, intervals: [30] }).toBeGreaterThanOrEqual(28)
      writeFileSync(join(SHOTS!, `app-slash-${tone}.png`), await winShot(run))
      await page.keyboard.press('Escape')
      await expect(pane(page).getByTestId('ai-spot-bar')).toContainText('停下了：写到一半的这段留着')
      await page.waitForTimeout(150)
      const app = await winShot(run)
      const [proto] = await protoShots(dark, 'para', size.w, size.h, [1100], true)
      await pair(`stop-${tone}`, proto!, app, size.w, size.h)
      // 停下 2 秒以后：存好了（标签条右上不再是「未保存」），那一颗收起
      await page.waitForTimeout(2000)
      await expect(page.getByTestId('tab-acts').getByTestId('save-state')).toHaveAttribute('data-state', 'saved')
      writeFileSync(join(SHOTS!, `app-stop-2s-${tone}.png`), await winShot(run))
    } finally {
      await run.close()
    }
  })

  test(`白板加一张卡（${tone}）：原型「加一张卡」和软件 AI 加的卡，字长到一半`, async () => {
    mkdirSync(SHOTS!, { recursive: true })
    const run = await launch({ '本周学习计划.md': BOARD }, { CN_AI_FAKE: '1', CN_FAKE_SAY_MS: '250' }, skinned(dark ? 'petrol' : 'sky'))
    const { page } = run
    try {
      const size = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
      await page.locator('.nav .si', { hasText: '本周学习计划' }).click()
      const board = pane(page).getByTestId('doc-board')
      await expect(board).toBeVisible()
      await page.keyboard.press('Meta+j')
      await ask(page, `加一张卡「${CARD}」`)
      const card = board.locator('.db-card', { hasText: CARD.slice(0, 8) })
      await expect(card).toBeVisible({ timeout: 15_000 })
      // 长到一半：卡里还藏着一半左右的字
      await expect
        .poll(
          () =>
            card.evaluate((c) => {
              const hl = (CSS as unknown as { highlights?: Map<string, Set<Range>> }).highlights?.get('cn-ai-grow')
              let hidden = 0
              for (const r of hl ?? []) if (c.contains(r.startContainer)) hidden += r.toString().length
              return hidden
            }),
          { timeout: 5000, intervals: [30] },
        )
        .toBeLessThanOrEqual(CARD.length * 0.6)
      const app = await winShot(run)
      const [proto] = await protoShots(dark, 'card', size.w, size.h, [1500])
      await pair(`card-${tone}`, proto!, app, size.w, size.h)
    } finally {
      await run.close()
    }
  })
}
