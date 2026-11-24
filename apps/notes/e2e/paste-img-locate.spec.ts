// 读 PDF 贴截图问也自动定位（0.5.9，用户：「我这种直接截图发过去之后 它是不会放到笔记里面的 它不会自动判断这个笔记属于哪里 该插到哪里」）。
// 截图里的字用 macOS Vision 真认（本机，不联网），去 PDF 文字层里找：
// 开着第 3 页贴第 3 页公式截图 → 记进配对笔记第 3 页那一节、带图、来源行框着那一段，回答头上「看的是第3页（按截图认出）」；
// 停在第 3 页贴第 5 页的截图 → 落到第 5 页；没字的图 → 照正看着的那页；别处的截图（认出的字这份 PDF 里没有）→「没定位的问答」，点「放到第 2 页」挪过去。
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { acts, launch, pane } from './app'
import { lecturePdf } from './fixtures/pdf'

const PDF = '论文/BST-GATNet.pdf'
const NOTE = '论文/BST-GATNet 笔记.md'
const SHOTS = '/private/tmp/canvas-notes-visual/100-贴图问定位'

const PAPER = lecturePdf([
  { title: 'BST-GATNet: Driver Stress', lines: ['Driver stress impairs executive functions and reaction times.', 'We propose a bimodal spatio-temporal graph attention network.'] },
  { title: 'I. Related Work', lines: ['Earlier work used handcrafted heart rate features with random forests.', 'Recurrent models capture the temporal order of physiological signals.'] },
  {
    title: 'II. Method',
    lines: [
      'The GAT computes self-attention coefficients as shown in (1),',
      'alpha_ij = exp(LeakyReLU(a [W h_i || W h_j]))      (1)',
      'where N(i) denotes the neighborhood of node i (fully connected).',
      'The resulting node representations are updated through',
      'multi-head aggregation as defined in (2):',
      "h'_i = 1/K sum_k sigma(sum_j alpha_ij W h_j)      (2)",
      'Fig. 2. Overview of the proposed BST-GATNet.',
    ],
    lineGap: 30,
  },
  { title: 'III. Experiments', lines: ['We evaluate on a naturalistic driving dataset with thirty drivers.', 'Leave-one-subject-out validation avoids identity leakage.'] },
  { title: 'IV. Results', lines: ['Our model reaches an accuracy of ninety one percent on unseen drivers.', 'Removing the static stream lowers the F1 score by six points.'] },
])

const ai = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })
const msgs = (page: Page) => ai(page).getByTestId('reading-msg')
const pdfPage = (page: Page, n: number) => page.locator(`.pdfpane:not([hidden]) .pdfpage[data-page="${n}"]`)
const read = (vault: string) => (existsSync(join(vault, NOTE)) ? readFileSync(join(vault, NOTE), 'utf8') : '')
const heads = (md: string) => md.split('\n').filter((l) => /^#{2,3} /.test(l))

async function goPage(page: Page, n: number) {
  await acts(page).getByTestId('pdf-pager').getByRole('button').click()
  const box = acts(page).getByRole('textbox', { name: '跳到第几页' })
  await box.fill(String(n))
  await box.press('Enter')
  await expect(acts(page).getByTestId('pdf-pager')).toHaveText(`${n} / 5`, { timeout: 10_000 })
  await expect(pdfPage(page, n).locator('canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
}

/** 往 AI 输入框里粘一张图（照浏览器的粘贴事件，不碰真的剪贴板）。from：从 PDF 第几页画好的那张裁一块（上、下的比例）；text：画一张写着这几行字的图；都没有是一块纯色 */
async function paste(page: Page, o: { from?: { page: number; top: number; bottom: number }; text?: string[] }) {
  // 那一页现在没画（只画看得见的几页）：翻过去截好再翻回来
  const back = o.from ? Number((await acts(page).getByTestId('pdf-pager').textContent())!.split('/')[0]) : 0
  if (o.from && back !== o.from.page) await goPage(page, o.from.page)
  if (o.from) await expect(pdfPage(page, o.from.page).locator('canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
  const png = await page.evaluate(async ({ from, text }) => {
    const out = document.createElement('canvas')
    const g = out.getContext('2d')!
    if (from) {
      const src = document.querySelector<HTMLCanvasElement>(`.pdfpane:not([hidden]) .pdfpage[data-page="${from.page}"] canvas[data-ready="1"]`)!
      const y = Math.round(src.height * from.top)
      out.width = src.width
      out.height = Math.round(src.height * (from.bottom - from.top))
      g.drawImage(src, 0, y, src.width, out.height, 0, 0, src.width, out.height)
    } else if (text) {
      out.width = 900
      out.height = 60 + text.length * 48
      g.fillStyle = '#fff'
      g.fillRect(0, 0, out.width, out.height)
      g.fillStyle = '#111'
      g.font = '32px "PingFang SC", sans-serif'
      text.forEach((l, i) => g.fillText(l, 30, 60 + i * 48))
    } else {
      out.width = 320
      out.height = 200
      g.fillStyle = '#4a7bd0'
      g.fillRect(0, 0, 320, 200)
      g.fillStyle = '#f2b134'
      g.beginPath()
      g.arc(160, 100, 60, 0, Math.PI * 2)
      g.fill()
    }
    const blob = await new Promise<Blob>((r) => out.toBlob((b) => r(b!), 'image/png'))
    return [...new Uint8Array(await blob.arrayBuffer())]
  }, o)
  if (o.from && back !== o.from.page) await goPage(page, back)
  await page.evaluate((bytes) => {
    const el = document.querySelector<HTMLTextAreaElement>('.reading-in textarea')!
    el.focus()
    const dt = new DataTransfer()
    dt.items.add(new File([new Uint8Array(bytes)], '截图.png', { type: 'image/png' }))
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, png)
  await expect(ai(page).getByTestId('ai-mat')).toHaveCount(1)
}

async function ask(page: Page, text: string, n: number) {
  const box = ai(page).getByRole('textbox', { name: '问 AI' })
  await box.press('End')
  await box.pressSequentially(text)
  await box.press('Enter')
  await expect(msgs(page)).toHaveCount(n, { timeout: 30_000 })
  await expect(msgs(page).nth(n - 1).getByTestId('reading-ans-acts')).toBeVisible({ timeout: 30_000 })
  await expect(msgs(page).nth(n - 1).getByTestId('ai-noted')).toHaveAttribute('data-state', 'done', { timeout: 20_000 })
}

test('贴截图问：按截图里的字定到那一页那一段记进配对笔记；认不出字照正看着的那页；别处的截图进「没定位的问答」、「放到第 2 页」挪过去', async () => {
  test.setTimeout(180_000)
  mkdirSync(SHOTS, { recursive: true })
  const run = await launch({ [PDF]: PAPER }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('BST-GATNet')
    await page.locator('.pal-row', { hasText: 'BST-GATNet.pdf' }).first().click()
    await expect(pdfPage(page, 1).locator('canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
    await page.keyboard.press('Meta+j')
    await expect(ai(page).getByTestId('reading-sees')).toContainText('读过全文5页', { timeout: 20_000 })

    // 先在第 1 页问一句（上一处在第 1 页：以前贴图问就接在这一处后面、记到第 1 页）
    await ai(page).getByRole('textbox', { name: '问 AI' }).fill('这篇讲什么')
    await ai(page).getByRole('textbox', { name: '问 AI' }).press('Enter')
    await expect(msgs(page)).toHaveCount(1, { timeout: 30_000 })
    await expect(msgs(page).first().getByTestId('ai-noted')).toHaveAttribute('data-state', 'done', { timeout: 20_000 })

    // ① 开着第 3 页，贴第 3 页公式 (1)(2) 那块的截图问 → 第 3 页那一节，带图，来源行框着那一段
    await goPage(page, 3)
    await paste(page, { from: { page: 3, top: 0.15, bottom: 0.5 } })
    await ask(page, '这两个公式 你用大白话给我讲一下', 2)
    const second = msgs(page).nth(1)
    await expect(second.locator('.read')).toContainText('看的是第3页（按截图认出）')
    let md = read(vault)
    expect(heads(md)).toEqual(['## 第 1 页 · BST-GATNet: Driver Stress', '### 这篇讲什么', '## 第 3 页 · II. Method', '### ①这两个公式 你用大白话给我讲一下'])
    const p3 = md.slice(md.indexOf('## 第 3 页'))
    expect(p3).toMatch(/!\[[^\]]*\]\(\.\.\/附件\/BST-GATNet\/p3-1-[0-9a-f]{8}\.png\)/)
    expect(p3).toMatch(/—— \[第 3 页\]\(BST-GATNet\.pdf#page=3&rect=[\d.,]+\)/)
    expect(execFileSync('git', ['-C', vault, 'status', '--porcelain'], { encoding: 'utf8' }).trim()).toBe('')
    await page.screenshot({ path: join(SHOTS, '1-第3页截图问.png') })

    // ② 中间停在第 3 页，贴第 5 页的截图 → 落到第 5 页
    await paste(page, { from: { page: 5, top: 0.08, bottom: 0.3 } })
    await ask(page, '这个结果怎么算的', 3)
    await expect(msgs(page).nth(2).locator('.read')).toContainText('看的是第5页（按截图认出）')
    md = read(vault)
    expect(heads(md).slice(-2)).toEqual(['## 第 5 页 · IV. Results', '### ①这个结果怎么算的'])
    await expect(acts(page).getByTestId('pdf-pager')).toHaveText('3 / 5')

    // 没字的图（纯色块）：认不出字 → 照正看着的第 4 页
    await goPage(page, 4)
    await paste(page, {})
    await ask(page, '这张图是什么', 4)
    await expect(msgs(page).nth(3).locator('.read')).toContainText('看的是第4页（你正看着的）')
    md = read(vault)
    expect(heads(md)).toContain('## 第 4 页 · III. Experiments')

    // ③ 别处的截图（认出的字这份 PDF 里没有）→「没定位的问答」，回答下面「放到第 N 页」
    await goPage(page, 2)
    // 照正看着的那页定的、又翻到别的页：最后一条回答下面给「放到第 2 页」
    await expect(msgs(page).nth(3).getByTestId('reading-move')).toContainText('照正看着的第 4 页记的·放到第 2 页')
    await paste(page, { text: ['今天天气很好，我们去公园散步', '顺便买一杯咖啡，再回家做饭'] })
    await ask(page, '这是什么意思', 5)
    const fifth = msgs(page).nth(4)
    await expect(msgs(page).nth(3).getByTestId('reading-move')).toHaveCount(0)
    await expect(fifth.locator('.read')).toContainText('没认出截图是哪一页')
    await expect(fifth.locator('.read .ok')).toHaveCount(0)
    await expect(page.getByText('记进《BST-GATNet 笔记》「没定位的问答」')).toBeVisible()
    md = read(vault)
    expect(heads(md).slice(-2)).toEqual(['## 没定位的问答', '### ①这是什么意思'])
    const move = fifth.getByTestId('reading-move')
    await expect(move).toContainText('记在「没定位的问答」里·放到第 2 页')
    await expect(move.getByRole('button')).toHaveText('放到第 2 页')
    await fifth.scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(SHOTS, '2-没定位-放到第2页.png') })
    await move.getByRole('button', { name: '放到第 2 页' }).click()
    await expect.poll(() => heads(read(vault))).toEqual([
      '## 第 1 页 · BST-GATNet: Driver Stress',
      '### 这篇讲什么',
      '## 第 2 页 · I. Related Work',
      '### ①这是什么意思',
      '## 第 3 页 · II. Method',
      '### ①这两个公式 你用大白话给我讲一下',
      '## 第 4 页 · III. Experiments',
      '### ①这张图是什么',
      '## 第 5 页 · IV. Results',
      '### ①这个结果怎么算的',
    ])
    await expect(move).toHaveCount(0)
    await expect(fifth.getByTestId('ai-noted')).toHaveAttribute('data-state', 'done', { timeout: 20_000 })
    md = read(vault)
    expect(md).not.toContain('没定位的问答')
    expect(md.slice(md.indexOf('## 第 2 页'), md.indexOf('## 第 3 页'))).not.toContain('—— [第 2 页]')
    await expect.poll(() => execFileSync('git', ['-C', vault, 'status', '--porcelain'], { encoding: 'utf8' }).trim()).toBe('')

    // 配对笔记打开看一眼（截图）。「最近」里配对笔记并进 PDF 那一条，点它右边的「笔记」小字开
    await page.locator('aside.side .nav .si').filter({ has: page.locator('.s-note') }).first().locator('.s-note').click()
    await expect(page.getByTestId('tab-on')).toHaveText('BST-GATNet 笔记')
    await pane(page).locator('.cm-content').evaluate((el) => el.closest('.cm-scroller')?.scrollTo(0, 0))
    await page.screenshot({ path: join(SHOTS, '3-配对笔记.png') })
  } finally {
    await run.close()
  }
})
