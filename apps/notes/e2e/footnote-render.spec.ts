// 配对笔记旧写法（0.5.7 以前，@cn/format reading-note.ts renderDoc）末尾的脚注在文档看法里画好（用户 r119「这个粘贴的图是不是存不进来呀」）：
// 问题条里的 [^p1-4-1] 是圈号 ①，末尾「[^p1-4-1]: ![粘贴的图|180](…)」画成 ① + 缩略图，「[^p1-4-3]: 「原文」 出处」画成 ③ + 引文；
// 不露 [^、]: 、![粘贴的图 这些原文，也不露「^p1-4-3:」（以前链接那一处把 [^p1-4-3] 当链接藏了方括号）。打开、打一个字再删、保存，一个字节不变。
import { expect, test } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { type AskSection, newReadingNote, threadId, upsertSection } from '@cn/format'
import { acts, gitStatus, launch, openNote, pane, tabOn, waitSaved } from './app'
import { solidPng } from './fixtures/png'

const PDF = '论文/BST-GATNet.pdf'
const NOTE = '论文/BST-GATNet 笔记.md'
const IMG1 = '附件/BST-GATNet/p1-4-d160978a.png'
const IMG2 = '附件/BST-GATNet/p1-4-45b1274e.png'
const SHOTS = '/private/tmp/canvas-notes-visual/105-脚注显示'

/** 照那篇写的一段：问题条带两张粘贴的图、旁支带三段引文，脚注定义在小结后面（用写法函数写，就是 0.5.7 以前真写出来的样子） */
function sample(): string {
  const s: AskSection = {
    id: threadId('BST-GATNet-p1-4'),
    file: PDF,
    page: 1,
    title: '讲解一下这部分',
    time: '08:55',
    figures: [],
    doubts: [],
    good: '',
    points: [],
    failed: [],
    rounds: 0,
    links: [],
    qas: [
      {
        q: '①②这两张图说的是什么？',
        a: '第一张是模型三件套：GAT、Bi-LSTM、静态流。第二张是热图。',
        mats: [
          { kind: 'image', path: IMG1, src: '粘贴的图' },
          { kind: 'image', path: IMG2, src: '粘贴的图' },
        ],
        sides: [
          {
            quote: 'Transformer 增强',
            turns: [
              {
                q: '①②③这几句是什么意思？',
                a: '都是在说时间上的建模。',
                mats: [
                  { kind: 'quote', text: 'Transformer 增强', src: 'AI的回答 · 第1页' },
                  { kind: 'quote', text: '双向长短期记忆网络（Bi-LSTM）：负责横着看 LSTM：一秒一秒按顺序读数据，手边带一个"小本子"，读到重要的就记下来，过时的就划掉。', src: 'AI的回答 · 第1页' },
                  { kind: 'quote', text: '慢慢漂移。', src: 'AI的回答 · 第1页' },
                ],
              },
            ],
          },
        ],
      },
    ],
    recap: '用大白话串起论文的问题、数据和模型。',
  }
  return upsertSection(newReadingNote(PDF, new Date('2026-11-20T08:00:00')), s, NOTE)
}

test('配对笔记末尾的脚注：图画成缩略图、引文画成引文、问题条里是圈号，不露原始 Markdown；打开再保存一个字节不变', async () => {
  const md = sample()
  // 样本就是用户那篇的样子：问题条里引用、末尾定义（图两张、引文三段）
  expect(md).toContain('[^p1-4-1][^p1-4-2]这两张图说的是什么？')
  expect(md).toMatch(/\n\[\^p1-4-1\]: !\[粘贴的图\|180\]\(\.\.\/附件\/BST-GATNet\/p1-4-d160978a\.png\)\n/)
  expect(md).toContain('\n[^p1-4-3]: 「Transformer 增强」 AI的回答 · 第1页\n')
  const run = await launch({ [NOTE]: md, [IMG1]: solidPng(360, 200, [96, 170, 140]), [IMG2]: solidPng(300, 220, [220, 160, 90]) }, {}, (v) => {
    const ud = join(dirname(v), 'user-data')
    mkdirSync(ud, { recursive: true })
    writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: 'mint', frame: 'b' } }))
  })
  const { page, vault } = run
  try {
    await openNote(page, 'BST-GATNet 笔记')
    await expect(tabOn(page)).toHaveText('BST-GATNet 笔记')
    const doc = pane(page).locator('.cm-content')
    await expect(doc).toContainText('这两张图说的是什么？')
    // 末尾的定义：两张缩略图真的加载出来（宽照写着的 180），三条引文
    const imgs = doc.locator('.cm-fn-img')
    await expect(imgs).toHaveCount(2)
    for (const i of [0, 1]) await expect.poll(() => imgs.nth(i).evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(0)
    expect((await imgs.first().boundingBox())!.width).toBeLessThanOrEqual(181)
    await expect(doc.locator('.cm-fn')).toHaveCount(5)
    await expect(doc.locator('.cm-fn-sign')).toHaveText(['①', '②', '③', '④', '⑤'])
    await expect(doc.locator('.cm-fn-quote').first()).toHaveText('「Transformer 增强」')
    await expect(doc.locator('.cm-fn-src').first()).toContainText('AI的回答 · 第1页')
    // 问题条里的引用是圈号，指着看得到那一条写的是什么
    await expect(doc.locator('.cm-callout-head .cm-fn-ref')).toHaveText(['①', '②', '③', '④', '⑤'])
    await expect(doc.locator('.cm-fn-ref').nth(2)).toHaveAttribute('title', '「Transformer 增强」 AI的回答 · 第1页')
    // 原始 Markdown 一点不露（光标停在定义那几行也不露）
    const shown = await doc.innerText()
    for (const raw of ['[^', ']:', '![粘贴的图', '^p1-4', '.png)']) expect(shown, raw).not.toContain(raw)
    await doc.locator('.cm-fn-quote').last().click()
    expect(await doc.innerText()).not.toContain('^p1-4')
    await doc.locator('.cm-fn').last().scrollIntoViewIfNeeded()
    if (process.env.CN_SHOTS) {
      mkdirSync(SHOTS, { recursive: true })
      await page.waitForTimeout(300)
      const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
      writeFileSync(join(SHOTS, '脚注显示-薄荷.png'), Buffer.from(b64, 'base64'))
    }
    // 打开再保存：打一个字再删、保存、关掉，一个字节不变
    expect(readFileSync(join(vault, NOTE), 'utf8')).toBe(md)
    await doc.focus()
    await page.keyboard.press('Meta+ArrowDown')
    await page.keyboard.type('x')
    await expect(acts(page).getByTestId('save-state')).toHaveAttribute('data-state', 'dirty')
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Meta+s')
    await waitSaved(page)
    await page.keyboard.press('Meta+w')
    await page.waitForTimeout(800)
    expect(readFileSync(join(vault, NOTE), 'utf8')).toBe(md)
    expect(gitStatus(vault)).toBe('')
  } finally {
    await run.close()
  }
})
