/**
 * 费曼学习的引擎和存法（task-yvabi 第 ① 条线）：真的 Electron 窗口里走 window.cnFeynman（preload → main/feynman.ts），AI 用 CN_AI_FAKE=1 的假回答。
 * - 四种入口都能抽要点：导图一支、白板上的卡（含读 PDF 配对笔记转成的白板：框选截图交给看图那家、出处写回 PDF 那一页）、一个词、一整份真的 PDF（主进程抽字，先给单子）；
 * - 一整轮：开讲 → 学生追问（字一点点推过来）→ 说穿 → 判定，按存法写进那块白板；在软件里打开（文档、白板两种看法）再关掉，文件一字不变；
 * - esc 停得下。
 * 对照图：CN_SHOTS=<目录> 时存进去（交付页用）。
 */
import { expect, test } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import type { ExtractResult, JudgeResult, TurnResult } from '../src/shared/feynman/api'
import { addRound, appendEntry, findRounds, putBlock, setMeta } from '../src/shared/feynman/doc'
import { newMeta } from '../src/shared/feynman/round'
import type { FeynmanMeta } from '../src/shared/feynman/types'
import { acts, gitStatus, launch, openNote, pane, tabOn } from './app'
import { LECTURE } from './fixtures/pdf'

const SHOTS = process.env.CN_SHOTS

/** 一张 8×8 的 png（框选截图的样子） */
function png(): Buffer {
  const crc = (b: Buffer) => {
    let c = ~0
    for (const x of b) {
      c ^= x
      for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
    }
    return ~c >>> 0
  }
  const chunk = (t: string, d: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(d.length)
    const td = Buffer.concat([Buffer.from(t), d])
    const c = Buffer.alloc(4)
    c.writeUInt32BE(crc(td))
    return Buffer.concat([len, td, c])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(8, 0)
  ihdr.writeUInt32BE(8, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const raw = Buffer.alloc(8 * (1 + 8 * 3), 200)
  for (let y = 0; y < 8; y++) raw[y * 25] = 0
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

const MAP = '课程/线代/第2讲 导图.md'
const READ = '课程/线代/读PDF 第3讲.md'
const FILES = {
  [MAP]: `---
type: board
白板样式: 导图
第几讲: 2
read-along: https://zh.d2l.ai/
---
- 线性代数
  - 范数
    - 量向量有多大
    - 放大 α 倍
    - 三角不等式
    - 非负
  - 矩阵

## 剪藏

<!-- card id=k1 x=900 y=100 -->
> 范数是向量的大小，L2 范数就是平方和开根号。
> —— [2.3. 线性代数](https://zh.d2l.ai/chapter_preliminaries/linear-algebra.html#norms)

<!-- card id=k2 x=900 y=300 -->
> ‖αx‖ = |α|‖x‖
> —— [2.3. 线性代数](https://zh.d2l.ai/chapter_preliminaries/linear-algebra.html#norms)
`,
  [READ]: `---
type: board
---

## 第 2 页

![我框的|360](附件/框选/p2.png)
[第 2 页](第3讲%20线性映射.pdf#page=2&rect=0.1,0.2,0.3,0.2) T(u+v)=T(u)+T(v)，线性映射保持加法。
`,
  '课程/线代/附件/框选/p2.png': png(),
  '课程/线代/第3讲 线性映射.pdf': LECTURE,
  '笔记/优化.md': '# 优化\n\n梯度下降从一个初始猜测出发，每一步沿负梯度走，学习率太大会来回跳。\n',
}

test('四种入口都能抽要点：导图一支、卡（框选截图交给看图那家）、一个词、一整份真的 PDF 先给单子', async () => {
  const log = join(tmpdir(), `cn-feynman-${Date.now()}.log`)
  writeFileSync(log, '')
  const run = await launch(FILES, { CN_AI_FAKE: '1', CN_FAKE_FEYNMAN_LOG: log })
  const { page } = run
  try {
    const ex = (req: unknown) => page.evaluate((r) => window.cnFeynman.extract(Math.floor(Math.random() * 1e9), r as never), req) as Promise<ExtractResult>

    const map = await ex({ refs: [{ kind: 'map', path: MAP, node: '0.0', text: '范数' }] })
    expect(map.kind).toBe('draft')
    if (map.kind !== 'draft') return
    expect(map.draft).toMatchObject({ topic: '范数', lecture: 2, basisLine: '照导图「范数」这一支和配对的网页核对', by: 'Claude Code · Opus 5.5' })
    expect(map.draft.points.filter((p) => p.kind === 'core').length).toBe(4)
    expect(map.draft.cover).toContainEqual({ kind: 'web', url: 'https://zh.d2l.ai/' })

    const card = await ex({ refs: [{ kind: 'card', path: READ, head: '![我框的|360](附件/框选/p2.png)' }], board: READ })
    if (card.kind !== 'draft') throw new Error(card.kind)
    expect(card.draft.cover).toContainEqual({ kind: 'pdf', path: '课程/线代/第3讲 线性映射.pdf', page: 2 })

    const word = await ex({ refs: [{ kind: 'word', word: '梯度下降' }] })
    if (word.kind !== 'draft') throw new Error(word.kind)
    expect(word.draft).toMatchObject({ topic: '梯度下降', basisLine: '照库里的 1 篇笔记核对' })

    const pdf = await ex({ refs: [{ kind: 'pdf', path: '课程/线代/第3讲 线性映射.pdf' }] })
    if (pdf.kind !== 'pick') throw new Error(pdf.kind)
    // 主进程真的读了这份 PDF 的字（假 AI 每页第一行当一个点）
    expect(pdf.items.map((x) => x.name)).toEqual(['Lecture 3 Linear', '3.2 Definition', 'Example 3.4 Rota', '3.5 Kernel and i', '3.6 Summary'])
    const one = await ex({ refs: [], pick: pdf.items[1] })
    if (one.kind !== 'draft') throw new Error(one.kind)
    expect(one.draft.from).toEqual([{ kind: 'pdf', path: '课程/线代/第3讲 线性映射.pdf', pages: [2, 2] }])
    expect(one.draft.lecture).toBe(3)

    // 哪一步用的哪家：带框选截图的那一问交给看图那家（Claude Code），别的走 AI 对话
    const asked = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { kind: string; images: number; engine: string })
    expect(asked.map((a) => `${a.kind}:${a.images}`)).toEqual(['extract:0', 'same:0', 'extract:1', 'extract:0', 'list:0', 'extract:0'])
    expect(asked[2]!.engine).toBe('claude')
  } finally {
    await run.close()
  }
})

test('一整轮：抽要点 → 讲 → 追问（字一点点推过来）→ 说穿 → 判定，写进白板；软件里打开再关掉一字不变；esc 停得下', async () => {
  const run = await launch(FILES, { CN_AI_FAKE: '1', CN_FAKE_SAY_MS: '5' })
  const { page, vault } = run
  try {
    await page.evaluate(() => {
      const w = window as unknown as { said: Record<number, string> }
      w.said = {}
      window.cnFeynman.onText((id, d) => (w.said[id] = (w.said[id] ?? '') + d))
    })
    const r = (await page.evaluate(() => window.cnFeynman.extract(1, { refs: [{ kind: 'map', path: '课程/线代/第2讲 导图.md', node: '0.0', text: '范数' }] }))) as ExtractResult
    if (r.kind !== 'draft') throw new Error(r.kind)
    let meta: FeynmanMeta = newMeta(r.draft, { today: '2026-11-23', id: 'f-20261123-e2e1' })
    let text = addRound(readFileSync(join(vault, MAP), 'utf8'), meta)
    const entries = () => findRounds(text)[0]!.entries.map((e) => ({ kind: e.kind, text: e.text }))
    const answers = ['范数就是量向量有多大 比如 (3, 4) 的长度是五 放大两倍的话 范数不变吧 嗯 L2 是平方和开根号', '这个我不知道', '说不上来', '两段路加起来不比直走短']
    text = appendEntry(text, meta.id, 'me', answers[0]!)
    let n = 10
    for (const a of answers.slice(1)) {
      const t = (await page.evaluate((req) => window.cnFeynman.turn(req as never), { reqId: ++n, meta, entries: entries() })) as TurnResult
      meta = t.meta
      if (t.reveal) text = appendEntry(text, meta.id, 'reveal', t.reveal, t.by)
      if (t.say) {
        // 学生的话是一点点推过来的，拼起来就是这一句
        expect(await page.evaluate((id) => (window as unknown as { said: Record<number, string> }).said[id], n)).toBe(t.say)
        text = appendEntry(text, meta.id, 'student', t.say, t.by)
      }
      text = setMeta(text, meta)
      if (t.act === 'done') break
      text = appendEntry(text, meta.id, 'me', a)
    }
    expect(meta.asked.some((x) => x.act === 'reveal')).toBe(true)
    const j = (await page.evaluate((req) => window.cnFeynman.judge(req as never), { reqId: 99, meta, entries: entries(), today: '2026-11-23', prevPasses: 0 })) as JudgeResult
    text = setMeta(text, j.meta)
    for (const k of ['verdict', 'gaps', 'wording', 'full'] as const) text = putBlock(text, meta.id, k, j.blocks[k] ?? '', j.by)
    expect(j.meta.verdict).toBe('fail')
    expect(j.meta.next).toBe('2026-11-24')
    writeFileSync(join(vault, MAP), text)
    const before = readFileSync(join(vault, MAP))
    // 同一轮放进一块普通白板（卡片白板）：白板看法里是一列
    const section = text.slice(findRounds(text)[0]!.head.from)
    const PLAIN = '课程/线代/范数白板.md'
    writeFileSync(join(vault, PLAIN), `---\ntype: board\n---\n\n## 剪藏\n\n> 范数是向量的大小，L2 范数就是平方和开根号。\n> —— [2.3. 线性代数](https://zh.d2l.ai/)\n\n${section}`)
    const plainBefore = readFileSync(join(vault, PLAIN))

    // 停下：假 AI 想 150 毫秒，50 毫秒时 esc（stop），这一问报停下了
    await page.evaluate(() => window.cnFeynman.stop(-1))
    const stopped = await page.evaluate(async (m) => {
      const p = window.cnFeynman.turn({ reqId: 777, meta: m as never, entries: [{ kind: 'me', text: 'x' }] }).then(
        () => 'done',
        (e: Error) => String(e.message),
      )
      await new Promise((res) => setTimeout(res, 50))
      await window.cnFeynman.stop(777)
      return p
    }, meta)
    expect(stopped).toMatch(/停下了/)

    // 在软件里打开这块白板：白板看法里这一轮是一列，注释那一行不成卡；文档看法照常；什么都不改，关掉一字不变
    await openNote(page, '第2讲 导图')
    if (SHOTS) await pane(page).screenshot({ path: join(SHOTS, 'doc-view.png') })
    await expect(pane(page).locator('.cm-content')).toContainText('费曼 · 范数')
    await expect(pane(page).locator('.cm-content')).not.toContainText('feynman {')
    await acts(page).getByRole('tab', { name: '白板' }).click()
    await expect(pane(page).locator('[data-testid="doc-board"], [data-testid="board"]').first()).toBeVisible()
    await page.waitForTimeout(800)
    if (SHOTS) await pane(page).screenshot({ path: join(SHOTS, 'board-view.png') })
    await expect(tabOn(page)).toHaveText('第2讲 导图')

    await openNote(page, '范数白板')
    await pane(page).getByText('没过：').scrollIntoViewIfNeeded()
    await page.waitForTimeout(300)
    if (SHOTS) await pane(page).screenshot({ path: join(SHOTS, 'doc-verdict.png') })
    await expect(pane(page).locator('.cm-content')).toContainText('没过：')
    await expect(pane(page).locator('.cm-content')).not.toContainText('feynman {')
    await acts(page).getByRole('tab', { name: '白板' }).click()
    const board = pane(page).locator('[data-testid="doc-board"]')
    await expect(board.getByText('费曼 · 范数').first()).toBeVisible()
    await expect(board).not.toContainText('feynman {')
    await page.waitForTimeout(800)
    if (SHOTS) await pane(page).screenshot({ path: join(SHOTS, 'board-column.png') })

    await openNote(page, '优化')
    await page.waitForTimeout(500)
    expect(readFileSync(join(vault, MAP)).equals(before)).toBe(true)
    expect(readFileSync(join(vault, PLAIN)).equals(plainBefore)).toBe(true)
    // 只有写进去的这两篇（导图改了、新的白板），软件打开、关掉没再动别的
    expect(gitStatus(vault).split('\n').filter(Boolean).length).toBe(2)
  } finally {
    await run.close()
  }
})
