/**
 * 交付图（task-hqula：按住 ⌘ 悬停弹出那一篇）。只在截图时跑：CN_SHOTS=目录，CN_SHOT_TONE=dark 截深湖（不给是天青）。平时跳过。
 * 文档里弹一层、套两层、AI 回答里、白板卡里、白板卡链接弹那块白板、PDF 页码弹那一页。每张图的标框写进 boxes-<主题>.json（截图像素，窗口 2 倍）。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { expect, type Locator, type Page, test } from '@playwright/test'
import { acts, launch, openAi, openNote, pane, type Running } from './app'
import { LECTURE } from './fixtures/pdf'

const DIR = process.env.CN_SHOTS
const DARK = process.env.CN_SHOT_TONE === 'dark'
test.skip(!DIR, '只在截交付图时跑（CN_SHOTS=目录）')
const tone = DARK ? 'dark' : 'light'

const ATTN = [
  '# 注意力机制',
  '',
  '读 Transformer 时记的。一句话：**每个词按和别的词有多像，把别的词的信息加权揽过来。**',
  '',
  '> [!tip] 先记住这个',
  '> 查询 Q 问「我要找什么」，键 K 答「我这里有什么」，值 V 是真正被拿走的内容。',
  '',
  '## 怎么算',
  '',
  '先把 Q 和 K 点积，除以 $\\sqrt{d_k}$ 防止数太大，再过 softmax：',
  '',
  '$$\\mathrm{Attention}(Q,K,V)=\\mathrm{softmax}\\left(\\frac{QK^\\top}{\\sqrt{d_k}}\\right)V$$',
  '',
  '除以 $\\sqrt{d_k}$ 是因为维度高了点积方差变大，softmax 会被推到几乎只剩一个 1。',
  '',
  '## 多头',
  '',
  '同一组词用 8 套不同的投影各算一遍，再拼起来：一个头看语法，一个头看指代。',
  '',
  '- 每个头的维度是 $d_{model}/h$',
  '- 总计算量和单头差不多',
  '',
  '## 和 RNN 比',
  '',
  'RNN 要一步一步传，长句子前面的信息走到后面就淡了；注意力一步就连上任意两个词。 ^why',
  '',
  '相关：[[位置编码]]、[[小论文计划]]',
  '',
]
const POS = ['# 位置编码', '', '注意力本身不知道词的先后，所以给每个位置加一个向量。', '', '$$PE_{(pos,2i)}=\\sin\\left(pos/10000^{2i/d}\\right)$$', '', '- 正弦的好处：没见过的长度也能外推', '- 学出来的位置向量：短句上效果差不多', ''].join('\n')
const READ = ['# 读 Transformer', '', '今天把第 3 节读完了，[[注意力机制]] 那篇记了公式。', '', '还没懂的：[为什么要除以根号 d](../课程/注意力机制.md#怎么算)，和 [RNN 那一段](../课程/注意力机制.md#^why)。', ''].join('\n')
const PLAN_MD = ['# 小论文计划', ...Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 篇：先放着。`), 'SAGE 排第 2 篇，编号 J52，名字就叫 SAGE。', '作者和 C72 重叠（Chenpei Xie），核心同样是图神经网络，14 页。', ''].join('\n')
const BOARD_MD = ['# 读论文白板', '', '## 方法', '', '<!-- card id=c7 -->', '**LOSO 评估**', '随机划分 91.8%，留一被试 80.6%：差 11 个点，说明随机划分漏了题。', '', '窗口 30 秒，重叠 15 秒，见 [[注意力机制]]。', '', '## 结果', '', 'BST-GATNet 在 AffectiveROAD 上 88.43%。', '', '和 C72 比高 3 个点。', ''].join('\n')
const FILES = {
  '课程/注意力机制.md': ATTN.join('\n'),
  '课程/位置编码.md': POS,
  '收件箱/读 Transformer.md': READ,
  '课程/小论文计划.md': PLAN_MD,
  '课程/线代/第3讲.pdf': LECTURE,
  '收件箱/随手.md': '# 随手\n\n问问 AI。\n',
  '课程/读论文白板.md': BOARD_MD,
  '待办.md': ['# 待办', '', '- [ ] 周五前读完 SAGE 📅 2026-11-27', ''].join('\n'),
}
const SUBJECT = '整理小论文计划'

function prepare(vault: string) {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: DARK ? 'petrol' : 'sky', frame: 'b', winBg: 'aurora' } }))
  const git = (...a: string[]) => execFileSync('git', ['-C', vault, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...a])
  git('add', '-A')
  git('commit', '-q', '-m', '开始')
  writeFileSync(join(vault, '课程/小论文计划.md'), PLAN_MD + '排第 3 篇还没定。\n')
  git('add', '-A')
  git('commit', '-q', '-m', SUBJECT)
  writeFileSync(join(vault, '收件箱/样本.md'), '# 样本\n')
}

async function shot(run: Running, name: string, marks: Locator[] = []) {
  await run.page.waitForTimeout(500)
  const f = join(DIR!, `boxes-${tone}.json`)
  const all = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {}
  all[name] = []
  for (const m of marks) {
    const b = (await m.first().boundingBox())!
    all[name].push([b.x, b.y, b.width, b.height].map((v) => Math.round(v * 2)))
  }
  writeFileSync(f, JSON.stringify(all))
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(DIR!, `${name}-${tone}.png`), Buffer.from(b64, 'base64'))
}

const layer = (page: Page, d: number) => page.locator(`.pk[data-depth="${d}"]`)

test('交付图', async () => {
  test.setTimeout(180_000)
  mkdirSync(DIR!, { recursive: true })
  const run = await launch(FILES, { CN_AI_FAKE: '1' }, prepare)
  const { page, vault } = run
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    await expect.poll(() => page.evaluate(() => innerHeight)).toBe(887)

    // 1 文档里：标题链接弹整篇，滚到「怎么算」、那几行亮着
    await openNote(page, '读 Transformer')
    const head = pane(page).locator('.cm-link', { hasText: '为什么要除以根号 d' })
    await head.hover()
    await page.keyboard.down('Meta')
    await expect(layer(page, 0).locator('.pk-hit').first()).toBeVisible()
    await expect(layer(page, 0).locator('.katex').first()).toBeVisible()
    await shot(run, '1-doc', [head, layer(page, 0)])
    await page.keyboard.up('Meta')
    await expect(page.getByTestId('peek')).toHaveCount(0)

    // 2 套两层：双链弹整篇，浮窗里的 [[位置编码]] 再弹一层
    const wiki = pane(page).locator('.cm-wikilink', { hasText: '注意力机制' })
    await wiki.hover()
    await page.keyboard.down('Meta')
    await expect(layer(page, 0)).toBeVisible()
    await layer(page, 0).locator('.pk-body').hover()
    await page.keyboard.up('Meta')
    const inner = layer(page, 0).locator('.cm-wikilink', { hasText: '位置编码' })
    await inner.scrollIntoViewIfNeeded()
    await inner.hover()
    await page.keyboard.down('Meta')
    await expect(layer(page, 1)).toBeVisible()
    await expect(layer(page, 1).locator('.katex').first()).toBeVisible()
    await shot(run, '2-nested', [layer(page, 0), layer(page, 1)])
    await layer(page, 1).locator('.pk-body').hover()
    await page.keyboard.up('Meta')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('peek')).toHaveCount(0)

    // 3 白板卡里的链接
    await openNote(page, '读论文白板')
    await acts(page).getByRole('tab', { name: '白板' }).click()
    const bl = pane(page).getByTestId('doc-board').locator('a.cite', { hasText: '注意力机制' })
    await bl.hover()
    await page.keyboard.down('Meta')
    await expect(layer(page, 0).locator('.katex').first()).toBeVisible()
    await shot(run, '3-board-card', [bl, layer(page, 0)])
    await page.keyboard.up('Meta')
    await expect(page.getByTestId('peek')).toHaveCount(0)

    // 4–6 AI 回答里：笔记几行、白板卡、PDF 页码
    await openNote(page, '随手')
    await openAi(page)
    const chat = page.getByRole('complementary', { name: 'AI 对话' })
    const hash = execFileSync('git', ['-C', vault, 'log', '-1', '--format=%h', `--grep=${SUBJECT}`], { encoding: 'utf8' }).trim()
    const ta = chat.getByRole('textbox', { name: '问 AI' })
    await ta.fill(`把小论文用到的东西都列出来（列出七种引用 ${hash}）`)
    await ta.press('Enter')
    const msg = chat.getByTestId('ai-msg').last()
    await expect(msg).toContainText('整理计划那次', { timeout: 15_000 })
    await page.waitForTimeout(500)
    const pairs: [string, string][] = [
      ['4-ai-note', '小论文计划里排'],
      ['5-ai-board', 'LOSO 那张卡'],
      ['6-ai-pdf', '第 4 页'],
    ]
    for (const [name, text] of pairs) {
      const link = msg.locator('a.cite', { hasText: text })
      await link.hover()
      await page.keyboard.down('Meta')
      await expect(layer(page, 0)).toBeVisible()
      if (name === '6-ai-pdf') await expect(layer(page, 0).getByTestId('peek-pdf').locator('img')).toBeVisible({ timeout: 15_000 })
      await shot(run, name, [link, layer(page, 0)])
      await page.keyboard.up('Meta')
      await expect(page.getByTestId('peek')).toHaveCount(0)
    }
  } finally {
    await run.close()
  }
})
