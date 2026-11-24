// AI 命令独立审核（task-nnss4，/private/tmp/canvas-notes-audit/notes.md）查出的文档、白板、周记、书摘这一类问题，
// 照报告的复现步骤在 AI 输入框里真打 /、真点「收下」「照样收下」「打开」（假 AI，CN_AI_FAKE=1）：
// 1. 自己的命令遇到笔记里的代码块，整篇照样完整写回；少了整节、命令又没说要删时，先给你看标红、没有实心的「收下」（task-1l29q）
// 2. 截图转成文字再跑认出转过的图、不再加一遍；超过 8 张分批做完；超过 24 张说清还剩几张，再跑接着做（task-t41et、task-ov1z1）
// 3. 自测题再出接在原来那一节后面、复习提纲再收换掉旧的那一节（task-idmm6）；空笔记出题不问 AI（task-ev29m）
// 4. 空白板写成文章不建文件、AI 回拒绝话不建文件（task-nphy3）；写成文章、存成卡片、整理收件箱的提交说明（task-gj0l0）
// 5. 翻译不带属性；PDF 上翻全文（task-n1ffi）
// 6. 书摘一章里挨着几条划线照样分得了节（task-ftdc9）
// 7. 同一周再写周记并进那一篇，回答和「打开」指真写进去的那篇；周记里有这周新划的线和问过的问题（task-f4kf7、task-iztii）
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isoWeek } from '../src/shared/cmd-run'
import { launch, openAi, tabOn } from './app'
import { LECTURE as PDF_BYTES } from './fixtures/pdf'
import { solidPng } from './fixtures/png'

const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const box = (page: Page) => chat(page).getByRole('textbox', { name: '问 AI' })
const menu = (page: Page) => page.getByTestId('slash-menu')
const lastMsg = (page: Page) => chat(page).getByTestId('ai-msg').last()
const read = (vault: string, f: string) => readFileSync(join(vault, f), 'utf8')
const subjects = (vault: string, n: number) => execFileSync('git', ['-C', vault, 'log', `-${n}`, '--format=%s'], { encoding: 'utf8' }).trim().split('\n')
const commits = (vault: string) => Number(execFileSync('git', ['-C', vault, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim())
/** 测试用的假 AI 记下的每一问（CN_FAKE_PICK_LOG）：命令、提示 */
const asks = (log: string) => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { cmd: string; prompt?: string }) : [])

async function openByName(page: Page, name: string) {
  await page.keyboard.press('Meta+k')
  await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill(name)
  await page.locator('.pal-row', { has: page.locator('.nm', { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) }).first().click()
  await expect(tabOn(page)).toHaveText(name)
}

/** 输入框里真打 /几个字，菜单里点名字对上的那一条；等这一问的回答那一条出来 */
async function slash(page: Page, typed: string, name: string) {
  const n = await chat(page).getByTestId('ai-msg').count()
  await box(page).click()
  await box(page).fill('')
  await page.keyboard.type('/' + typed)
  await expect(menu(page)).toBeVisible()
  await menu(page).locator(`.it:has(.n:text-is("${name}"))`).first().click()
  await expect(chat(page).getByTestId('ai-msg')).toHaveCount(n + 1)
}

/** AI 那一格最后一条答完（不再转圈） */
async function answered(page: Page) {
  await expect(lastMsg(page)).not.toHaveAttribute('aria-busy', 'true', { timeout: 20_000 })
  return lastMsg(page)
}

// ---------------------------------------------------------------- 1. 自己的命令 · 代码块

const CODE_NOTE = `---
tags: [机器学习]
---
# 第2讲 预备知识

## 张量

张量就是多维数组，一个轴是向量，两个轴是矩阵。

\`\`\`python
x = torch.arange(12)
X = x.reshape(3, 4)
\`\`\`

—— 出处：动手学深度学习

## 广播

形状不同的两个张量，按元素运算前会自动扩展成一样的形状。

## 自动微分

backward 只能对标量调用，要对向量求导先把它加起来变成一个数。

## 线性回归回顾

线性回归用均方误差当损失函数，最小二乘有解析解。
`

const OWN = {
  version: 1,
  own: [
    { id: 'own-tidy', name: '整理成通顺笔记', kind: 'ai', target: '1. 同一个出处只写一次', rules: [{ t: '同一个出处只写一次' }], where: ['doc'], write: 'inplace', desc: '照「学习笔记」4 轮前后的对比提炼，每次先给你看' },
    // 假 AI 照「（测试：漏掉后面几节）」只交回第一节，演 AI 漏掉整节
    { id: 'own-short', name: '整理成要点', kind: 'ai', target: '1. 把正文整理成要点\n2. （测试：漏掉后面几节）', rules: [{ t: '把正文整理成要点' }, { t: '（测试：漏掉后面几节）' }], where: ['doc'], write: 'inplace', desc: '整理成要点' },
  ],
}

test('自己的命令：笔记里有代码块，改好的整篇照样完整写回；少了整节、命令没说要删时先给你看标红，只有「照样收下」（task-1l29q）', async () => {
  test.setTimeout(120_000)
  const run = await launch({ '课程/第2讲 预备知识.md': CODE_NOTE, '.canvas-notes/命令.json': JSON.stringify(OWN) }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  const path = '课程/第2讲 预备知识.md'
  try {
    await openByName(page, '第2讲 预备知识')
    await openAi(page)
    await slash(page, '整理成通', '整理成通顺笔记')
    const bar = page.getByTestId('proposal-bar')
    await expect(bar).toBeVisible({ timeout: 15_000 })
    await expect(bar).toContainText('/整理成通顺笔记 改好了，还没写进去')
    await expect(page.getByTestId('diff-tab').locator('.dv-sum')).toHaveText('')
    const calmBg = await bar.evaluate((e) => getComputedStyle(e).backgroundColor)
    await bar.getByRole('button', { name: '收下' }).click()
    await expect(lastMsg(page).getByTestId('ai-change')).toContainText('改了1个文件')
    const done = read(vault, path)
    // 代码块后面三节都在，代码块完整收尾
    for (const h of ['## 广播', '## 自动微分', '## 线性回归回顾']) expect(done).toContain(h)
    expect(done).toContain('```python\nx = torch.arange(12)\nX = x.reshape(3, 4)\n```\n')
    expect(done).toContain('线性回归用均方误差当损失函数，最小二乘有解析解。')
    expect(done).not.toContain('—— 出处')
    expect(subjects(vault, 1)).toEqual(['AI：/整理成通顺笔记 · 第2讲 预备知识'])

    // AI 漏掉了后面三节：底下那条铺淡红、红字，节名放最后，「收下」不是实心的、叫「照样收下」；文件条写删了哪几节
    await slash(page, '整理成要', '整理成要点')
    await expect(bar).toBeVisible({ timeout: 15_000 })
    await expect(bar).toHaveClass(/warn/)
    await expect(bar.locator('.lt')).toHaveText('比原文少了3节，命令里没说要删，先看清再决定：广播、自动微分、线性回归回顾')
    await expect(bar.locator('.lt')).toHaveAttribute('data-tip', '比原文少了3节，命令里没说要删，先看清再决定：广播、自动微分、线性回归回顾')
    await expect(bar.getByRole('button')).toHaveText(['不要', '照样收下'])
    await expect(bar.getByRole('button', { name: '照样收下' }).locator('svg')).toHaveCount(1)
    await expect(bar.locator('.btn-primary')).toHaveCount(0)
    expect(await bar.evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe(calmBg)
    const sum = page.getByTestId('diff-tab').locator('.dv-sum')
    await expect(sum).toHaveText('删了3节：广播、自动微分、线性回归回顾')
    await expect(sum).toHaveClass(/warn/)
    const msg = lastMsg(page)
    await expect(msg.getByTestId('ai-alert')).toHaveText('比原文少了3节（广播、自动微分、线性回归回顾），命令里没说要删')
    await expect(msg.getByTestId('ai-alert').locator('svg')).toHaveCount(1)
    await expect(msg).toContainText('改好了，先在中间看清：真要这样就点「照样收下」。')
    await expect(msg.getByRole('button', { name: '照样收下' })).toBeVisible()
    await expect(msg.getByRole('button', { name: '收下', exact: true })).toHaveCount(0)
    // 软件最窄的窗口 960×600：那句放不下时出省略号（不从半个字处切），图标不被挤
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(960, 600))
    await expect
      .poll(() => bar.locator('.lt .truncate').evaluate((e) => ({ cut: e.scrollWidth > e.clientWidth, dots: getComputedStyle(e).textOverflow, icon: Math.round(e.parentElement!.querySelector('svg')!.getBoundingClientRect().width) })))
      .toEqual({ cut: true, dots: 'ellipsis', icon: 14 })
    // 不要：文件不动
    await bar.getByRole('button', { name: '不要' }).click()
    await expect(bar).toHaveCount(0)
    expect(read(vault, path)).toBe(done)
    // 再跑一次，照样收下：写进去、一次提交，能撤回
    await slash(page, '整理成要', '整理成要点')
    await expect(bar).toBeVisible({ timeout: 15_000 })
    await bar.getByRole('button', { name: '照样收下' }).click()
    await expect(lastMsg(page).getByTestId('ai-change')).toContainText('改了1个文件')
    expect(read(vault, path)).not.toContain('## 广播')
    expect(subjects(vault, 1)).toEqual(['AI：/整理成要点 · 第2讲 预备知识'])
    await lastMsg(page).getByTestId('ai-change').getByRole('button', { name: '撤回' }).click()
    await expect(lastMsg(page).getByTestId('ai-change')).toContainText('已撤回')
    await expect.poll(() => read(vault, path)).toBe(done)
  } finally {
    await run.close()
  }
})

// ---------------------------------------------------------------- 2. 截图转成文字

/** n 张截图的一篇（每张一段字隔开） */
function shots(n: number, dir: string): { doc: string; files: Record<string, Buffer> } {
  const files: Record<string, Buffer> = {}
  const lines = [`# ${n}张图`, '']
  for (let i = 1; i <= n; i++) {
    files[`附件/${dir}/截图 ${i}.png`] = solidPng(24, 16, [(i * 37) % 256, (i * 91) % 256, (i * 53) % 256])
    lines.push(`第${i}段。`, '', `![](../附件/${dir}/截图%20${i}.png)`, '')
  }
  return { doc: lines.join('\n'), files }
}

/** 每张图下面（跳过空行）是不是写了字：写了的那几张的编号 */
function written(doc: string): number[] {
  const lines = doc.split('\n')
  const out: number[] = []
  lines.forEach((l, i) => {
    const m = /截图%20(\d+)\.png/.exec(l)
    if (!m) return
    const next = lines.slice(i + 1).find((x) => x.trim())
    if (next && !next.startsWith('第') && !next.startsWith('![')) out.push(Number(m[1]))
  })
  return out
}

/** 假 AI 写的字（每批第一张是一张表，别的是「图N里的字：测试文字N」）各有几处 */
const inserted = (doc: string) => doc.split('\n').filter((l) => /^(\| 写法 \| 意思 \||图\d+里的字：测试文字\d+)$/.test(l)).length

test('截图转成文字：再跑一次认出转过的、不再加一遍；10 张分两批一次做完；26 张先做 24 张、说还剩 2 张，再跑接着做（task-t41et、task-ov1z1）', async () => {
  test.setTimeout(180_000)
  const two = shots(2, '两张')
  const ten = shots(10, '十张')
  const many = shots(26, '多张')
  const log = join(mkdtempSync(join(tmpdir(), 'cn-ocr-')), 'ask.log')
  const run = await launch({ '课程/两张图.md': two.doc, '课程/十张图.md': ten.doc, '课程/二十六张图.md': many.doc, ...two.files, ...ten.files, ...many.files }, { CN_AI_FAKE: '1', CN_FAKE_PICK_LOG: log })
  const { page, vault } = run
  const ocrAsks = () => asks(log).filter((a) => a.cmd === '截图转成文字').length
  try {
    // 两张：跑一次，再跑一次
    await openByName(page, '两张图')
    await openAi(page)
    await slash(page, '截图', '截图转成文字')
    await expect((await answered(page)).getByTestId('ai-change')).toBeVisible()
    const once = read(vault, '课程/两张图.md')
    expect(written(once)).toEqual([1, 2])
    const n0 = commits(vault)
    expect(ocrAsks()).toBe(1)
    await slash(page, '截图', '截图转成文字')
    const again = await answered(page)
    await expect(again).toContainText('这篇的2张图下面都已经写过字了（上次「/截图转成文字」加的），没再问AI。')
    await expect(again.getByTestId('ai-change')).toHaveCount(0)
    expect(read(vault, '课程/两张图.md')).toBe(once)
    expect(commits(vault)).toBe(n0)
    expect(ocrAsks()).toBe(1)

    // 十张：8 张一批，问两次，一次写完
    await openByName(page, '十张图')
    await slash(page, '截图', '截图转成文字')
    await expect((await answered(page)).getByTestId('ai-change')).toBeVisible()
    await expect(lastMsg(page)).toContainText('把10张图里的字写在了图下面，原图留着。')
    expect(written(read(vault, '课程/十张图.md'))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(ocrAsks()).toBe(3)
    expect(subjects(vault, 1)).toEqual(['AI：/截图转成文字 · 十张图'])

    // 二十六张：先做 24 张，说还剩 2 张；再跑一次只做后 2 张
    await openByName(page, '二十六张图')
    await slash(page, '截图', '截图转成文字')
    await expect((await answered(page)).getByTestId('ai-change')).toBeVisible()
    await expect(lastMsg(page)).toContainText('把24张图里的字写在了图下面，原图留着。还剩2张没做：再打一次「/截图转成文字」接着做后面的。')
    const first = read(vault, '课程/二十六张图.md')
    expect(written(first)).toEqual(Array.from({ length: 24 }, (_x, i) => i + 1))
    expect(ocrAsks()).toBe(6)
    await slash(page, '截图', '截图转成文字')
    await expect((await answered(page)).getByTestId('ai-change')).toBeVisible()
    await expect(lastMsg(page)).toContainText('把2张图里的字写在了图下面，原图留着。另外24张上次转过，跳过了。')
    const all = read(vault, '课程/二十六张图.md')
    expect(written(all)).toEqual(Array.from({ length: 26 }, (_x, i) => i + 1))
    expect(inserted(all)).toBe(26)
    expect(ocrAsks()).toBe(7)
  } finally {
    await run.close()
  }
})

// ---------------------------------------------------------------- 3. 自测题再出、空笔记

test('出几道自测题：再出接在原来那一节后面、编号接着往下；空笔记、只有标题的不问 AI，直接说为什么（task-idmm6、task-ev29m）', async () => {
  test.setTimeout(120_000)
  const log = join(mkdtempSync(join(tmpdir(), 'cn-quiz-')), 'ask.log')
  const run = await launch(
    { '课程/梯度下降.md': '# 梯度下降\n\n## 学习率\n\n学习率太大会来回震荡甚至发散，太小收敛很慢。\n\n## 批量\n\n批量梯度下降每步用全部样本，随机梯度下降每步只用一个。\n', '收件箱/空白.md': '', '收件箱/只有标题.md': '# 只有标题\n' },
    { CN_AI_FAKE: '1', CN_FAKE_PICK_LOG: log },
  )
  const { page, vault } = run
  const quizAsks = () => asks(log).filter((a) => a.cmd === '出几道自测题').length
  try {
    await openByName(page, '梯度下降')
    await openAi(page)
    await slash(page, '自测', '出几道自测题')
    await expect((await answered(page)).getByTestId('ai-change')).toBeVisible()
    await slash(page, '自测', '出几道自测题')
    await expect((await answered(page)).getByTestId('ai-change')).toBeVisible()
    await expect(lastMsg(page)).toContainText('「自测题」一节里接着加了5道（第6–10题），和原来的不重复；答案先折着。')
    const doc = read(vault, '课程/梯度下降.md')
    expect(doc.match(/^## 自测题$/gm)).toHaveLength(1)
    expect(doc.match(/^\d+\. /gm)).toEqual(['1. ', '2. ', '3. ', '4. ', '5. ', '6. ', '7. ', '8. ', '9. ', '10. '])
    expect(doc.match(/<details>/g)).toHaveLength(10)
    expect(quizAsks()).toBe(2)
    // 第二次交给 AI 的话里列出了已有的 5 道
    expect(asks(log).filter((a) => a.cmd === '出几道自测题')[1]!.prompt).toContain('不和它们重复')

    for (const [name, say] of [
      ['空白', '这篇还没有正文，出不了题。先写点内容再来。'],
      ['只有标题', '这篇还没有正文（只有标题），出不了题。先写点内容再来。'],
    ] as const) {
      await openByName(page, name)
      const n0 = commits(vault)
      await slash(page, '自测', '出几道自测题')
      const m = await answered(page)
      await expect(m).toContainText(say)
      await expect(m.getByTestId('ai-error')).toHaveCount(0)
      expect(commits(vault)).toBe(n0)
    }
    expect(quizAsks()).toBe(2)
  } finally {
    await run.close()
  }
})

// ---------------------------------------------------------------- 4. 写成文章、存成卡片、整理收件箱

const BOARD = '---\ntype: board\n---\n## 想法\n\n订机票\n\n看极光\n\n## 杂\n\n写游记\n\n买雪地靴\n'

test('写成文章：空白板不问 AI、不建文件；AI 回的不是文章也不建；写成文章、存成卡片、整理收件箱的提交说明都是「AI：/命令 · 对象」（task-nphy3、task-gj0l0）', async () => {
  test.setTimeout(120_000)
  const log = join(mkdtempSync(join(tmpdir(), 'cn-article-')), 'ask.log')
  const run = await launch(
    {
      '项目/搬家/空白板.md': '---\ntype: board\n---\n',
      '项目/搬家/太少.md': '---\ntype: board\n---\n## 想法\n\n（测试：太少）\n',
      '项目/冰岛/冰岛.md': BOARD,
      '收件箱/极光.md': '# 极光\n\n冰岛看极光的几个地方。\n',
    },
    { CN_AI_FAKE: '1', CN_FAKE_PICK_LOG: log },
  )
  const { page, vault } = run
  try {
    await openByName(page, '空白板')
    await openAi(page)
    const n0 = commits(vault)
    await slash(page, '写成', '写成文章')
    await expect(await answered(page)).toContainText('这块白板上还没有卡，写不成文章。')
    await expect(lastMsg(page).getByTestId('ai-error')).toHaveCount(0)
    expect(readdirSync(join(vault, '项目/搬家')).sort()).toEqual(['太少.md', '空白板.md'])
    expect(commits(vault)).toBe(n0)
    expect(asks(log).filter((a) => a.cmd === '写成文章')).toHaveLength(0)

    // AI 回的是一句拒绝话（没有标题、不像一篇文章）：照实说它的话，不建文件
    await openByName(page, '太少')
    await slash(page, '写成', '写成文章')
    await expect(await answered(page)).toContainText('AI这次没写成文章，什么都没建。它说：白板上的内容太少，写不成一篇文章。')
    expect(readdirSync(join(vault, '项目/搬家')).sort()).toEqual(['太少.md', '空白板.md'])
    expect(commits(vault)).toBe(n0)

    await openByName(page, '冰岛')
    await slash(page, '写成', '写成文章')
    await expect((await answered(page)).getByRole('button', { name: '打开', exact: true })).toBeVisible()
    expect(subjects(vault, 1)).toEqual(['AI：/写成文章 · 冰岛'])

    await slash(page, '总结', '总结这块白板')
    await (await answered(page)).getByRole('button', { name: '存成卡片' }).click()
    await expect(lastMsg(page).getByTestId('ai-change')).toBeVisible()
    expect(subjects(vault, 1)).toEqual(['AI：/总结这块白板 · 冰岛'])

    await slash(page, '整理收', '整理收件箱')
    await (await answered(page)).getByRole('button', { name: '同意，挪过去' }).click()
    await expect(lastMsg(page).getByTestId('ai-change')).toBeVisible()
    expect(subjects(vault, 1)).toEqual(['AI：/整理收件箱 · 1条'])
  } finally {
    await run.close()
  }
})

// ---------------------------------------------------------------- 5. 翻译、读 PDF 那一格再跑

const PDF_NOTE = '# 第3讲 笔记\n\n## 第 2 页 · 定义\n[第 2 页](第3讲.pdf#page=2) · 10:20 <!-- cn:thread=第3讲-p2-1 -->\n\n> [!question] 线性是什么意思\n\n加起来再变和变了再加一样。\n'

test('翻译不带属性；PDF 上翻全文；复习提纲再收换掉旧的那一节、自测题再出接着往下（task-n1ffi、task-idmm6）', async () => {
  test.setTimeout(150_000)
  const log = join(mkdtempSync(join(tmpdir(), 'cn-tr-')), 'ask.log')
  const run = await launch(
    {
      '剪藏/网页/冰岛自驾攻略.md': '---\nsource: https://zhuanlan.zhihu.com/p/62019734\n---\n# 冰岛自驾攻略\n\n> 冬天白天只有五六个小时；加油站多数要密码卡。\n',
      '课程/线代/第3讲.pdf': PDF_BYTES,
      '课程/线代/第3讲 笔记.md': PDF_NOTE,
    },
    { CN_AI_FAKE: '1', CN_FAKE_PICK_LOG: log },
  )
  const { page, vault } = run
  const trAsks = () => asks(log).filter((a) => a.cmd === '翻译')
  try {
    await openByName(page, '冰岛自驾攻略')
    await openAi(page)
    await slash(page, '翻译', '翻译')
    await answered(page)
    expect(trAsks()).toHaveLength(1)
    expect(trAsks()[0]!.prompt).not.toContain('source:')
    expect(trAsks()[0]!.prompt).toContain('冬天白天只有五六个小时')

    // PDF：/ 菜单说「没选就翻整篇」，短的 PDF 翻全文
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲.pdf')
    await page.locator('.pal-row', { hasText: '第3讲.pdf' }).first().click()
    await expect(tabOn(page)).toHaveText('第3讲.pdf')
    await openAi(page)
    // 刚才在冰岛自驾攻略上问过：换页留着那段（AI 对话绑页面），点头上那颗切到这份 PDF 的 AI
    await page.getByTestId('ai-follow').click()
    const rchat = page.getByRole('complementary', { name: '边读边问 AI' })
    const rbox = rchat.getByRole('textbox', { name: '问 AI' })
    const rlast = () => rchat.getByTestId('reading-msg').last()
    await expect(rchat.getByTestId('reading-sees')).toContainText('读过全文5页', { timeout: 15_000 })
    await rbox.click()
    await page.keyboard.type('/翻译')
    await menu(page).locator('.it:has(.n:text-is("翻译"))').click()
    await expect(rlast()).toContainText('读了全文5页', { timeout: 15_000 })
    await expect(rlast()).toContainText('（译文）')
    await expect.poll(() => trAsks().length).toBe(2)
    expect(trAsks()[1]!.prompt).toContain('Lecture 3 Linear Maps')
    expect(trAsks()[1]!.prompt).toContain('3.6 Summary')

    // 复习提纲收一次；又问了一问以后再收：还是只有一节，换掉了旧的
    const path = '课程/线代/第3讲 笔记.md'
    await rbox.click()
    await page.keyboard.type('/复习')
    await page.keyboard.press('Enter')
    await expect(rlast().getByTestId('ai-change')).toBeVisible({ timeout: 15_000 })
    await expect(rlast()).toContainText('在笔记最上面加了「复习提纲」，1条')
    const more = '\n## 第 4 页 · 核\n[第 4 页](第3讲.pdf#page=4) · 10:40 <!-- cn:thread=第3讲-p4-1 -->\n\n> [!question] 核是什么\n\n被送到零的那些向量。\n'
    writeFileSync(join(vault, path), read(vault, path) + more)
    execFileSync('git', ['-C', vault, 'commit', '-qam', '又问了一问'])
    await rbox.click()
    await page.keyboard.type('/复习')
    await page.keyboard.press('Enter')
    await expect(rlast()).toContainText('读了笔记里问过的2问', { timeout: 15_000 })
    await expect(rlast().getByTestId('ai-change')).toBeVisible({ timeout: 15_000 })
    await expect(rlast()).toContainText('换掉了原来的「复习提纲」，现在2条；问答原文没动。')
    const review = read(vault, path)
    expect(review.match(/^## 复习提纲$/gm)).toHaveLength(1)
    expect(review).toMatch(/## 复习提纲\n\n- \[第 2 页\]\(.+\)：测试：弄懂了「线性是什么意思」\n- \[第 4 页\]\(.+\)：测试：弄懂了「核是什么」\n\n## 第 2 页 · 定义/)
    expect(review).toContain(PDF_NOTE.slice('# 第3讲 笔记\n\n'.length).trimEnd())
    expect(review).toContain(more.trim())
    // 和原来一字不差时不提交，照实说
    const n0 = commits(vault)
    await rbox.click()
    await page.keyboard.type('/复习')
    await page.keyboard.press('Enter')
    await expect(rlast()).toContainText('和笔记里原来的一样，笔记没动。', { timeout: 15_000 })
    expect(commits(vault)).toBe(n0)
    // 自测题出两次：一节、10 道
    for (let i = 0; i < 2; i++) {
      await rbox.click()
      await page.keyboard.type('/自测')
      await page.keyboard.press('Enter')
      await expect(rlast().getByTestId('ai-change')).toBeVisible({ timeout: 15_000 })
    }
    await expect(rlast()).toContainText('「自测题」一节里接着加了5道（第6–10题）')
    expect(read(vault, path).match(/^## 自测题$/gm)).toHaveLength(1)
    expect(read(vault, path).match(/<details>/g)).toHaveLength(10)
  } finally {
    await run.close()
  }
})

// ---------------------------------------------------------------- 6. 书摘按主题分节

const Q = ['接到叔叔谋反的消息，朱瞻基立刻下令御驾亲征，大军行动神速，很快就到达了乐安城下。', '见面后，叔侄俩开聊，朱高煦突然伸出一脚，把朱瞻基勾倒在地。', '莫名其妙地吃了个狗啃泥，再好脾气的人也得发飙，何况他还是个皇帝。', '永乐皇帝朱棣去世以后，他的大儿子朱高炽当了皇帝。', '朱高炽在位不到一年就去世了，但他减轻赋税、平反冤狱，口碑很好。', '仁宣之治，是明朝最太平的十年。', '于谦站出来说：「言南迁者，可斩也！」']
const BOOK_PATH = '阅读/趣说明朝276年（微信读书出品）.md'
/** 审核那本书摘：第 3 章第二、三条挨着，第 4 章两条挨着、都没写想法（微信读书同步来的写法） */
const BOOK = ['---', '类型: 书摘', '作者: 关丁', '划线: 7', 'bookId: 3300064831', '---', '# 趣说明朝276年（微信读书出品）', '', '## 3 作死小能手朱高煦，千古难找第二个', '', `> ${Q[0]}`, '', '微信读书的想法：御驾亲征这一下，比朝堂上吵三个月都管用。', '', `> ${Q[1]}`, '', `> ${Q[2]}`, '', '我的评价：皇帝可以输道理，不能输面子。', '', '## 4 来自亲爹的愤怒', '', `> ${Q[3]}`, '', `> ${Q[4]}`, '', '## 5 仁宣之治', '', `> ${Q[5]}`, '', '## 7 土木堡', '', `> ${Q[6]}`, '', '我的评价：于谦是真正的狠人。', '', '## 书评', '', '轻松好读，适合当明史入门。', ''].join('\n')

test('书摘按主题分节：一章里挨着几条划线也分得了节，七条划线一条不少、想法评价一字不改（task-ftdc9）', async () => {
  const run = await launch({ [BOOK_PATH]: BOOK }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await openByName(page, '趣说明朝276年（微信读书出品）')
    await openAi(page)
    await slash(page, '书摘', '书摘按主题分节')
    const m = await answered(page)
    await expect(m.getByTestId('ai-change')).toBeVisible()
    await expect(m).toContainText('读了《趣说明朝276年（微信读书出品）》的7条划线')
    await expect(m).toContainText('划线、想法和你的评价一字没改')
    const out = read(vault, BOOK_PATH)
    expect(out).toContain('## 测试主题一')
    for (const l of BOOK.split('\n').filter((x) => /^>|想法：|评价：/.test(x))) expect(out).toContain(l)
    expect(out).not.toContain('## 4 来自亲爹的愤怒')
    expect(out.trimEnd().endsWith('## 书评\n\n轻松好读，适合当明史入门。')).toBe(true)
    expect(subjects(vault, 1)).toEqual(['AI：/书摘按主题分节 · 趣说明朝276年（微信读书出品）'])
  } finally {
    await run.close()
  }
})

// ---------------------------------------------------------------- 7. 写这周的周记

const L5_NOTE = (qs: [number, string, string, string][]) =>
  `# Lecture05 笔记\n\n我的总结：搬数据比算还贵。\n${qs.map(([p, q, a, r]) => `\n## 第 ${p} 页 · x\n[第 ${p} 页](Lecture05.pdf#page=${p}) · 20:21 <!-- cn:thread=Lecture05-p${p}-1 -->\n\n> [!question] ${q}\n\n${a}\n\n> [!recap] ${r}\n`).join('')}`
const OLD_Q: [number, string, string, string] = [3, '为什么要把计算栈分成这么多层？', '分层是为了让每一层只关心自己的接口。', '分层让每层能单独换']
const NEW_Q: [number, string, string, string] = [7, '屋顶线模型的拐点怎么算？', '拐点等于峰值算力除以内存带宽。', '拐点是峰值算力除以带宽']
const OLD_BOOK = ['---', '类型: 书摘', 'bookId: 3300064831', '---', '# 趣说明朝276年（微信读书出品）', '', '## 3 作死小能手朱高煦，千古难找第二个', '', `> ${Q[0]}`, ''].join('\n')
const NEW_BOOK = OLD_BOOK + ['', '## 5 仁宣之治', '', `> ${Q[5]}`, '', '我的评价：难得太平。', ''].join('\n')
/** 这周才开始读的一本：三周前那一版里还没有这个文件 */
const NEW_BOOK_PATH = '阅读/人类简史.md'
const THIS_WEEK_BOOK = '---\n类型: 书摘\nbookId: 9900001\n---\n# 人类简史\n\n## 第一章\n\n> 智人能合作，是因为能相信虚构的故事。\n'

test('写这周的周记：读了什么照这周新划的线、问过的问题写；同一周再写一次并进那一篇，回答和「打开」指真写进去的那篇（task-iztii、task-f4kf7）', async () => {
  test.setTimeout(150_000)
  const week = isoWeek(new Date())
  const weekPath = `周记/${week} 周记.md`
  const run = await launch(
    { '课程/梯度下降.md': '# 梯度下降\n\n学习率太大会震荡。\n', [BOOK_PATH]: NEW_BOOK, [NEW_BOOK_PATH]: THIS_WEEK_BOOK, '课程/机器学习/Lecture05.pdf': PDF_BYTES, '课程/机器学习/Lecture05 笔记.md': L5_NOTE([OLD_Q, NEW_Q]) },
    // 中文系统（审核里真跑时 LANG=zh_CN.UTF-8）：git 的报错是中文的，软件不能靠认英文报错判断「那时还没有这一篇」
    { CN_AI_FAKE: '1', LANG: 'zh_CN.UTF-8', LC_ALL: 'zh_CN.UTF-8' },
    (vault) => {
      // 三周前就有的：书摘里第一条划线、笔记里第一问（这周以前的不该写进这周的周记）；《人类简史》这周才有
      const was = new Date(Date.now() - 21 * 86_400_000).toISOString()
      writeFileSync(join(vault, BOOK_PATH), OLD_BOOK)
      writeFileSync(join(vault, '课程/机器学习/Lecture05 笔记.md'), L5_NOTE([OLD_Q]))
      rmSync(join(vault, NEW_BOOK_PATH))
      execFileSync('git', ['-C', vault, 'add', '-A'])
      execFileSync('git', ['-C', vault, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', '三周前'], { env: { ...process.env, GIT_AUTHOR_DATE: was, GIT_COMMITTER_DATE: was } })
      writeFileSync(join(vault, BOOK_PATH), NEW_BOOK)
      writeFileSync(join(vault, NEW_BOOK_PATH), THIS_WEEK_BOOK)
      writeFileSync(join(vault, '课程/机器学习/Lecture05 笔记.md'), L5_NOTE([OLD_Q, NEW_Q]))
    },
  )
  const { page, vault } = run
  try {
    await openByName(page, '梯度下降')
    await openAi(page)
    await slash(page, '周记', '写这周的周记')
    const bar = page.getByTestId('proposal-bar')
    await expect(bar).toBeVisible({ timeout: 15_000 })
    await bar.getByRole('button', { name: '收下' }).click()
    await expect(lastMsg(page).getByTestId('ai-change')).toContainText('改了1个文件')
    const first = read(vault, weekPath)
    // 读了什么：这周新划的那条、这周问的那一问、这周才开始读的那本，原话；三周前的不算，也没有「笔记里没记」这种话
    expect(first).toContain(Q[5]!)
    expect(first).toContain('智人能合作，是因为能相信虚构的故事。')
    expect(first).toContain('屋顶线模型的拐点怎么算？')
    expect(first).not.toContain(Q[0]!)
    expect(first).not.toContain('为什么要把计算栈分成这么多层')
    expect(first).not.toMatch(/没记|没写/)

    // 同一周又改了一篇，再写一次：先给你看里是改那一篇（不是新文件），收下后只有一篇周记
    writeFileSync(join(vault, '课程/新的一篇.md'), '# 新的一篇\n\n周五新写的。\n')
    execFileSync('git', ['-C', vault, 'add', '-A'])
    execFileSync('git', ['-C', vault, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', '新的一篇'])
    await slash(page, '周记', '写这周的周记')
    await expect(bar).toBeVisible({ timeout: 15_000 })
    await expect(lastMsg(page)).toContainText(`这周已经有「${week} 周记」：新的事并进那一篇，原来写的一个字不动。`)
    await expect(page.getByTestId('diff-tab').locator('.dv-tag')).toHaveCount(0)
    await expect(page.getByTestId('diff-tab').locator('.dv-sum')).toHaveText('并进这周那一篇')
    await bar.getByRole('button', { name: '收下' }).click()
    const msg = lastMsg(page)
    await expect(msg).toContainText(`收下了，写进了「${week} 周记」`)
    expect(readdirSync(join(vault, '周记'))).toEqual([`${week} 周记.md`])
    const merged = read(vault, weekPath)
    expect(merged).toContain('[[新的一篇]]')
    for (const l of first.split('\n')) expect(merged.split('\n')).toContain(l)
    // 「打开」开的就是写进去的那篇
    await openByName(page, '梯度下降')
    await msg.getByRole('button', { name: '打开', exact: true }).click()
    await expect(tabOn(page)).toHaveText(`${week} 周记`)
  } finally {
    await run.close()
  }
})
