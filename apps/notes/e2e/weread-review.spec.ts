// 书摘里给一条划线写评价（CN-121 方向 A「悬停出写评价」，小样 proposals2/D-读书与AI入口/v2/review/proto-a.html；CN-38 方案 B 的样子）：
// 鼠标移到没写评价的引文上，右下角出「写评价」；点了在下面开一段「我的评价」，光标在里面；回车写完落到下面新的一段；
// 什么都没写按 esc 或点别处，这一段消失，不留空标签；没写评价的引文下面不占位；光标在引文里按 ⌘↵ 也能开。
// 标题下一行是摘要「书摘 · 作者 · 微信读书 N 条划线 · 同步于今天 21:25」，正文里不画属性表（CN-122）。
import { expect, type Locator, type Page, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { acts, launch, openNote, pane, type Running, waitSaved } from './app'
import { ICELAND, LODGING } from './fixtures/board'
import { BOOK, DOC, PATH, Q, skinned } from './fixtures/book-digest'
import { DREAM_VAULT } from './fixtures/dream'
import { EDITOR_DOC } from './fixtures/editor-doc'
import { LEFT_VAULT } from './fixtures/left-vault'
import { shotWindow } from './shots'

const quote = (page: Page, i: number) => pane(page).locator('.cm-line.cm-quote', { hasText: Q[i]!.slice(0, 12) })
const btn = (page: Page) => pane(page).locator('.cm-review-btn')
const file = (run: Running) => readFileSync(join(run.vault, PATH), 'utf8')
const box = (l: Locator) => l.evaluate((el) => (({ x, y, width, height }) => ({ x, y, w: width, h: height }))(el.getBoundingClientRect()))

async function open(skin: 'sky' | 'petrol' = 'sky') {
  const run = await launch({ [PATH]: DOC, 'a.md': '# a\n' }, {}, skinned(skin))
  await openNote(run.page, BOOK)
  return run
}

test('CN-121 悬停没写评价的引文，右下角出「写评价」；点了开一段「我的评价」光标在里面，打字、回车落到下面新的一段', async () => {
  const run = await open()
  const { page } = run
  try {
    // 写过想法、评价的引文不出按钮；没写的出，在它最后一行右下角
    await quote(page, 0).hover()
    await expect(btn(page)).toHaveCount(0)
    await quote(page, 2).hover()
    await expect(btn(page)).toHaveCount(0)
    await quote(page, 1).hover()
    await expect(btn(page)).toHaveText('写评价')
    const content = await box(pane(page).locator('.cm-content'))
    const q1 = await box(quote(page, 1))
    const b = await box(btn(page))
    expect([b.w, b.h]).toEqual([69, 24])
    expect(b.x + b.w).toBeCloseTo(content.x + content.w, 0)
    expect(b.y + b.h).toBeCloseTo(q1.y + q1.h + 2, 0)
    await shotWindow(run, 'review-1-hover')
    // 移开就没了
    await pane(page).locator('.cm-h1').hover()
    await expect(btn(page)).toHaveCount(0)
    await quote(page, 1).hover()
    await btn(page).click()
    // 开出来的一段：小标签「我的评价」+ 灰字，弯钩连着引文
    const rev = pane(page).locator('.cm-line.cm-review').nth(1)
    await expect(rev.locator('.cm-review-tag')).toHaveText('我的评价')
    await expect(rev.locator('.cm-review-ph')).toHaveText('写下你对这一段的看法…')
    await shotWindow(run, 'review-2-open')
    await page.keyboard.type('这一脚踢掉的是自己的命')
    await expect(rev.locator('.cm-review-ph')).toHaveCount(0)
    await expect(rev).toContainText('这一脚踢掉的是自己的命')
    // 量：小标签 22 高、离正文 8；正文和引文的字对齐；引文到评价 8；弯钩 12×26、上端伸进引文
    const tag = rev.locator('.cm-review-tag')
    const t = await tag.evaluate((el) => {
      const cs = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      const line = el.closest('.cm-line')!
      const range = document.createRange()
      const text = [...line.childNodes].find((n) => n.nodeType === 3 && n.textContent!.trim())!
      range.setStart(text, 0)
      range.setEnd(text, 1)
      const hook = getComputedStyle(line, '::before')
      return { h: r.height, pad: cs.padding, radius: cs.borderRadius, font: `${cs.fontSize} ${cs.fontWeight}`, gap: range.getBoundingClientRect().left - r.right, x: r.x, hook: [hook.left, hook.top, hook.width, hook.height, hook.borderLeftWidth, hook.borderBottomLeftRadius] }
    })
    expect(t).toMatchObject({ h: 22, pad: '0px 7px', radius: '6px', font: '12px 500', hook: ['0px', '-14px', '12px', '26px', '2px', '9px'] })
    expect(t.gap).toBeCloseTo(8, 0)
    const qText = await quote(page, 1).evaluate((el) => {
      const r = document.createRange()
      const n = [...el.childNodes].find((x) => x.nodeType === 3 && x.textContent!.trim())!
      r.setStart(n, 0)
      r.setEnd(n, 1)
      return r.getBoundingClientRect().left
    })
    expect(t.x).toBeCloseTo(qText, 0)
    expect((await box(rev)).y - (q1.y + q1.h)).toBeCloseTo(8, 0)
    await shotWindow(run, 'review-3-typed')
    // 回车：光标落到下面新的一段
    await page.keyboard.press('Enter')
    await page.keyboard.type('下一段接着写')
    await waitSaved(page)
    expect(file(run)).toContain(`> ${Q[1]}\n\n我的评价：这一脚踢掉的是自己的命\n\n下一段接着写\n\n> ${Q[2]}`)
  } finally {
    await run.close()
  }
})

test('CN-121 开了不写：esc、点别处、回车，这一段都消失，不留空标签；文件一个字节不变', async () => {
  const run = await open()
  const { page } = run
  try {
    // esc
    await quote(page, 3).hover()
    await btn(page).click()
    await expect(pane(page).locator('.cm-review-ph')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(pane(page).locator('.cm-review-ph')).toHaveCount(0)
    await expect(pane(page).locator('.cm-review-tag')).toHaveCount(2)
    // 点别处
    await quote(page, 1).hover()
    await btn(page).click()
    await expect(pane(page).locator('.cm-review-ph')).toBeVisible()
    await pane(page).locator('.cm-line', { hasText: '我自己的想法' }).click()
    await expect(pane(page).locator('.cm-review-ph')).toHaveCount(0)
    await expect(pane(page).locator('.cm-review-tag')).toHaveCount(2)
    await page.waitForTimeout(1200)
    await waitSaved(page)
    expect(file(run)).toBe(DOC)
    // 空着回车：标签去掉，光标落在引文下面新的一段
    await quote(page, 1).hover()
    await btn(page).click()
    await page.keyboard.press('Enter')
    await expect(pane(page).locator('.cm-review-tag')).toHaveCount(2)
    await page.keyboard.type('随手记一句')
    await waitSaved(page)
    expect(file(run)).toContain(`> ${Q[1]}\n\n随手记一句\n\n> ${Q[2]}`)
  } finally {
    await run.close()
  }
})

test('CN-121 光标在引文里按 ⌘↵ 也能开；有想法的引文，评价开在想法后面；已有评价的 ⌘↵ 光标到那段末尾', async () => {
  const run = await open()
  const { page } = run
  try {
    await quote(page, 3).click()
    await page.keyboard.press('Meta+Enter')
    await page.keyboard.type('朱棣一走，家里就乱了')
    // 有微信读书的想法：评价开在想法后面
    await quote(page, 0).click()
    await page.keyboard.press('Meta+Enter')
    await page.keyboard.type('两样都有')
    await expect(pane(page).locator('.cm-review-tag.wr')).toHaveText('微信读书的想法')
    await shotWindow(run, 'review-4-both')
    // 已有评价：光标到那段末尾接着写
    await quote(page, 2).click()
    await page.keyboard.press('Meta+Enter')
    await page.keyboard.type('！')
    await waitSaved(page)
    const md = file(run)
    expect(md).toContain('微信读书的想法：御驾亲征这一下，比朝堂上吵三个月都管用。\n\n我的评价：两样都有\n\n')
    expect(md).toContain('我的评价：皇帝可以输道理，不能输面子。！\n')
    expect(md.trimEnd().endsWith(`> ${Q[3]}\n\n我的评价：朱棣一走，家里就乱了`)).toBe(true)
  } finally {
    await run.close()
  }
})

test('CN-38 没写评价的引文下面什么都不多；标签和弯钩只给写了的那几段', async () => {
  const run = await open()
  const { page } = run
  try {
    // 第二条（没写评价）和第三条引文之间：只有平常的一个空行，没有占位
    const a = await box(quote(page, 1))
    const c = await box(quote(page, 2))
    const next = await quote(page, 1).evaluate((el) => ({ h: el.nextElementSibling!.getBoundingClientRect().height, cls: el.nextElementSibling!.className, lh: parseFloat(getComputedStyle(el).lineHeight) }))
    // 只有平常隔开两块的那个空行（书摘里照小样压成 12），没有评价的占位
    expect(next.cls).not.toMatch(/review/)
    expect(next.h).toBeCloseTo(12, 0)
    expect(c.y - (a.y + a.h)).toBeCloseTo(next.h, 0)
    await expect(pane(page).locator('.cm-review')).toHaveCount(2)
    await expect(pane(page).locator('.cm-review-ph')).toHaveCount(0)
    await expect(pane(page).locator('.cm-review-tag')).toHaveText(['微信读书的想法', '我的评价'])
  } finally {
    await run.close()
  }
})

test('CN-122 书摘标题下一行摘要，正文里不画属性表；属性里按书摘列项、书的编号藏着（CN-123）', async () => {
  const run = await open()
  const { page } = run
  try {
    await expect(pane(page).locator('.cm-bookmeta')).toHaveText('书摘 · 关丁 · 微信读书 8 条划线 · 同步于今天 21:25')
    await expect(pane(page).locator('.cm-props')).toHaveCount(0)
    await expect(pane(page).locator('.cm-folder')).toHaveCount(0)
    await expect(pane(page).locator('.cm-content')).not.toContainText('bookId')
    const h1 = await box(pane(page).locator('.cm-h1'))
    const meta = await box(pane(page).locator('.cm-bookmeta span'))
    expect(await pane(page).locator('.cm-bookmeta span').evaluate((el) => getComputedStyle(el).fontSize)).toBe('12px')
    expect(meta.y).toBeGreaterThan(h1.y)
    await acts(page).getByRole('button', { name: '属性' }).click()
    const pop = page.getByRole('dialog', { name: '属性' })
    await expect(pop.locator('.pr .k')).toHaveText(['类型', '作者', '来源', '划线', '想法'])
    await expect(pop.getByRole('combobox', { name: '类型' })).toHaveValue('书摘')
    await shotWindow(run, 'props-book')
  } finally {
    await run.close()
  }
})

test('CN-131 旧书摘（type: weread）：属性里类型就是书摘，选别的类型只改那一行，文件里只有一个类型字段', async () => {
  const OLD = ['---', 'type: weread', `title: ${BOOK}`, 'author: 关丁', 'bookId: 3300064831', 'marks: 3', 'thoughts: 0', '---', `# ${BOOK}`, '', `> ${Q[0]}`, ''].join('\n')
  const run = await launch({ [PATH]: OLD, 'a.md': '# a\n' })
  const { page } = run
  try {
    await openNote(page, BOOK)
    await expect(pane(page).locator('.cm-bookmeta')).toHaveText('书摘 · 关丁 · 微信读书 3 条划线')
    await acts(page).getByRole('button', { name: '属性' }).click()
    const pop = page.getByRole('dialog', { name: '属性' })
    await expect(pop.getByRole('combobox', { name: '类型' })).toHaveValue('书摘')
    await expect(pop.locator('.pr .k')).not.toContainText(['课程'])
    await pop.getByRole('combobox', { name: '类型' }).selectOption('笔记')
    await waitSaved(page)
    await expect.poll(() => file(run)).toBe(OLD.replace('type: weread', '类型: 笔记'))
  } finally {
    await run.close()
  }
})

test('深色（深湖）：书摘里写评价', async () => {
  const run = await open('petrol')
  const { page } = run
  try {
    await quote(page, 1).hover()
    await shotWindow(run, 'review-dark-hover')
    await btn(page).click()
    await page.keyboard.type('深色下的样子')
    await shotWindow(run, 'review-dark-typed')
    await expect(pane(page).locator('.cm-review-tag')).toHaveText(['微信读书的想法', '我的评价', '我的评价'])
  } finally {
    await run.close()
  }
})

test('CN-119 夹具里的每一篇在文档看法下都没有横向滚动（文末不再多一条灰条）：书摘、长网址的旧书摘、导图属性、游记、白板切成文档', async () => {
  const OLD = ['---', 'type: weread', `title: ${BOOK}`, 'author: 关丁', 'bookId: 3300064831', `source: https://weread.qq.com/web/reader/${'394323d0813ab8286g'.repeat(8)}`, 'marks: 8', 'thoughts: 1', '---', `# 旧书摘`, '', `> ${Q[0]}`, '', '想法：御驾亲征。', ''].join('\n')
  const MAP = '---\ntype: board\n白板样式: 导图\n类型: 导图\n课程: 线性代数\n第几讲: 3\n来源: iPhone 拍的\n日期: 2026-11-15\nAI填的: 课程, 第几讲\n---\n# 导图\n\n- 线性映射\n  - 定义\n'
  const md = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([k, v]) => /\.md$/.test(k) && typeof v === 'string')) as Record<string, string>
  const files: Record<string, string> = { ...md(LEFT_VAULT), ...md(DREAM_VAULT), '写作/编辑器.md': EDITOR_DOC, '冰岛.md': ICELAND, '住宿.md': LODGING, [PATH]: DOC, '阅读/旧书摘.md': OLD, '课程/线代/导图.md': MAP }
  const run = await launch(files)
  const { page } = run
  try {
    const titles = [...new Set(Object.keys(files).map((p) => p.split('/').pop()!.replace(/\.md$/, '')))]
    const wide: string[] = []
    for (const t of titles) {
      await openNote(page, t)
      await page.waitForTimeout(150)
      const over = await pane(page).evaluate((el) => {
        const s = el.querySelector('.cm-scroller')!
        const b = el.querySelector('.body')!
        return Math.max(s.scrollWidth - s.clientWidth, b.scrollWidth - b.clientWidth)
      })
      if (over > 0) wide.push(`${t}：多出 ${over}px`)
    }
    expect(wide).toEqual([])
    expect(titles.length).toBeGreaterThan(20)
  } finally {
    await run.close()
  }
})

test('书摘照小样的疏密：两段之间 12、评价下面 14、章节标题上面 26 下面 10、标题到摘要 6；光标停在空行上照常一整行高', async () => {
  const run = await open()
  const { page } = run
  try {
    const gaps = await pane(page).evaluate((el) => {
      const lines = [...el.querySelectorAll('.cm-content > .cm-line, .cm-content > .cm-meta')]
      const r = (e: Element) => e.getBoundingClientRect()
      const at = (t: string) => lines.find((l) => (l.textContent ?? '').startsWith(t))!
      const gap = (a: Element, b: Element) => Math.round((r(b).top - r(a).bottom) * 10) / 10
      const h1 = el.querySelector('.cm-h1')!
      const metaText = el.querySelector('.cm-bookmeta span')!
      return {
        titleToMeta: Math.round((r(metaText).top - (r(h1).bottom - parseFloat(getComputedStyle(h1).paddingBottom))) * 10) / 10,
        metaToH2: gap(el.querySelector('.cm-bookmeta')!, at('3 作死')),
        h2ToQuote: gap(at('3 作死'), at('接到叔叔')),
        quoteToQuote: gap(at('见面后'), at('莫名其妙')),
        reviewToPara: gap([...el.querySelectorAll('.cm-review')].pop()!, at('我自己的想法')),
        thoughtToQuote: gap(el.querySelector('.cm-review-wr')!, at('见面后')),
        paraToH2: gap(at('我自己的想法'), at('4 来自')),
      }
    })
    expect(gaps).toEqual({ titleToMeta: 6, metaToH2: 26, h2ToQuote: 10, quoteToQuote: 12, reviewToPara: 14, thoughtToQuote: 14, paraToH2: 26 })
    // 光标停在两条引文之间的空行：这一行回到一整行高，打的字看得见
    const between = () => quote(page, 1).evaluate((el) => ({ h: el.nextElementSibling!.getBoundingClientRect().height, cls: el.nextElementSibling!.className }))
    expect((await between()).h).toBeCloseTo(12, 0)
    const q = (await box(quote(page, 1)))
    await page.mouse.click(q.x + 60, q.y + q.h - 8)
    await page.keyboard.press('ArrowDown')
    await expect.poll(async () => (await between()).cls).not.toMatch(/cm-dg-gap/)
    expect((await between()).h).toBeGreaterThan(24)
  } finally {
    await run.close()
  }
})
