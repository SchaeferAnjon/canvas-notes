/**
 * task-o48fa「这里需要支持 latex」：照用户截图（d2l 的数学符号表）写的一篇（MATH_DOC），在测试模式里真打开、真点、真按键：
 * 公式排好（数 .katex）、截图那几行不露 LaTeX；点一下 / → ← ↓ 走进去露写法、走开又排好；在写法里打字改公式，文件里写法对；
 * 退格先选中整颗、复制带出 $…$；单独成行的居中、宽了横着滚不撑宽版心；写错的标红色波浪；打开再保存一个字节不变；
 * 改公式时外面改了文件，打的字不丢。
 * CN_SHOTS=<文件夹> 时另存交付截图（浅、深、光标在公式里）。
 */
import { expect, test, type Page } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MATH_DOC } from '../../../packages/format/test/fixtures'
import { acts, editorText, gitStatus, launch, openNote, pane, waitSaved } from './app'

const NAME = '数学符号.md'
/** MATH_DOC 里排得出来的行内公式（截图里 33 个 + 一行中间的 $$…$$、\(…\)；写错的两个不算）、单独成行的、写错的 */
const INLINE = 35
const BLOCKS = 3
const ERRORS = 2

const ed = (page: Page) => pane(page).locator('.cm-editor')
const line = (page: Page, text: string) => pane(page).locator('.cm-line', { hasText: text }).first()

/** 文档滚到最上面、最下面（滚的是编辑器外面那一层 .body；CodeMirror 只画看得见附近的行） */
const scrollDoc = (page: Page, to: 'top' | 'bottom') =>
  ed(page).evaluate((el, to) => {
    let sc: HTMLElement | null = el as HTMLElement
    while (sc && !(sc.scrollHeight > sc.clientHeight + 2 && /auto|scroll/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement
    sc?.scrollTo(0, to === 'top' ? 0 : sc.scrollHeight)
  }, to)

/** 一行里看得见的字：排好的公式（.cm-math）去掉 */
const bare = (page: Page, text: string) =>
  line(page, text).evaluate((el) => {
    const c = el.cloneNode(true) as HTMLElement
    for (const m of c.querySelectorAll('.cm-math')) m.remove()
    return c.textContent ?? ''
  })

/** 在编辑器上发一次「拷贝」（不碰系统剪贴板）：CodeMirror 往里写的字 */
const copied = (page: Page) =>
  ed(page)
    .locator('.cm-content')
    .evaluate((el) => {
      const data = new DataTransfer()
      el.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }))
      return data.getData('text/plain')
    })

test('task-o48fa 文档里的公式：照截图那篇排好，光标走进去露写法能改、走开又排好，退格先选中整颗，复制带出 $…$，写错的标红色波浪', async () => {
  const run = await launch({ [NAME]: MATH_DOC })
  const { page, vault } = run
  const file = join(vault, NAME)
  try {
    await openNote(page, '数学符号')
    // 排好：行内 35 个、单独成行 3 块、写错的 2 处；KaTeX 的字体加载好了
    await expect(ed(page).locator('.cm-math')).toHaveCount(INLINE)
    await expect(ed(page).locator('.cm-math .katex')).toHaveCount(INLINE)
    await scrollDoc(page, 'bottom')
    await expect(ed(page).locator('.cm-math-block .katex-display')).toHaveCount(BLOCKS)
    await expect(ed(page).locator('.cm-math-err')).toHaveCount(ERRORS)
    await expect(ed(page).locator('.cm-math-src, .cm-math-line')).toHaveCount(0)
    expect(await page.evaluate(() => document.fonts.check('16px KaTeX_Main'))).toBe(true)
    // 截图里那几行：去掉排好的公式，一个 $、一个 \math 都不剩
    for (const t of ['：标量', '：向量', '个元素', '列的元素', '：整数集合', '维实数向量集合', '的实数矩阵集合', '的并集', '的交集', '的相对补集']) {
      const rest = await bare(page, t)
      expect(rest, t).not.toMatch(/\$|\\math/)
    }
    expect((await bare(page, '的相对补集')).trim()).toBe('：集合  与集合  相减， 关于  的相对补集')
    // 钱数、代码照原样；\$ 的反斜杠和别的记号一样藏着，只露 $
    await expect(line(page, '一杯')).toContainText('一杯 $5，两杯 $10，美元写 $7。代码 echo $HOME 照旧。')
    // 写错的：原文照写，红色波浪，悬停说哪里错
    const err = ed(page).locator('.cm-math-err')
    await expect(err.first()).toHaveText('$\\frac{1}{$')
    await expect(err.first()).toHaveAttribute('title', /^公式写错了：/)
    await expect(err.nth(1)).toHaveAttribute('title', '公式写错了：不认识的命令 \\foo（第 1 个字）')
    expect(await err.first().evaluate((e) => getComputedStyle(e).textDecorationStyle)).toBe('wavy')

    // 量：行内的比正文大一点（1.05 倍），单独成行的居中、比正文大；很宽的那条自己横着滚，版心不变宽
    const m = await ed(page).evaluate((el) => {
      const px = (e: Element | null) => parseFloat(getComputedStyle(e!).fontSize)
      const li = [...el.querySelectorAll('.cm-line')].find((l) => l.textContent?.includes('：标量'))!
      const blocks = [...el.querySelectorAll<HTMLElement>('.cm-math-block')]
      const wide = blocks[2]!
      const content = el.querySelector<HTMLElement>('.cm-content')!
      const scroller = el.querySelector<HTMLElement>('.cm-scroller')!
      return {
        inline: px(li.querySelector('.cm-math .katex')) / px(li),
        block: px(blocks[0]!.querySelector('.katex')),
        body: px(li),
        centered: getComputedStyle(blocks[0]!.querySelector('.katex-display')!).textAlign,
        wideScrolls: wide.scrollWidth > wide.clientWidth + 1 && getComputedStyle(wide).overflowX === 'auto',
        wideFits: wide.getBoundingClientRect().width <= content.getBoundingClientRect().width + 1,
        noPageScroll: scroller.scrollWidth <= scroller.clientWidth + 1 && content.scrollWidth <= content.clientWidth + 1,
      }
    })
    console.log('量到', JSON.stringify(m))
    expect(m.inline).toBeCloseTo(1.05, 2)
    expect(m.block).toBeGreaterThan(m.body)
    expect(m.centered).toBe('center')
    expect(m.wideScrolls).toBe(true)
    expect(m.wideFits).toBe(true)
    expect(m.noPageScroll).toBe(true)
    await scrollDoc(page, 'top')

    // 点一下「向量」那行的公式：露出写法（等宽、两头 $ 淡），下面浮着排好的样子；别的公式照旧排好
    await line(page, '：向量').locator('.cm-math').click()
    const src = line(page, '：向量').locator('.cm-math-src')
    await expect(src).toHaveText('$\\mathbf{x}$')
    await expect(ed(page).locator('.cm-math')).toHaveCount(INLINE - 1)
    await expect(page.locator('.cm-math-tip .katex')).toBeVisible()
    // 浮层在这一行上方、离写法 6，不盖住下一行
    const tipBox = (await page.locator('.cm-math-tip').boundingBox())!
    const srcBox = (await src.boundingBox())!
    expect(Math.round(srcBox.y - (tipBox.y + tipBox.height))).toBeGreaterThanOrEqual(6)
    // 光标在写法末尾（结尾的 $ 前面）：打字改公式，文件里写法对
    await page.keyboard.type('_1')
    await expect(src).toHaveText('$\\mathbf{x}_1$')
    await expect(page.locator('.cm-math-tip .katex .msupsub')).toBeVisible()
    // → 走出去：又排好，浮层收起
    await page.keyboard.press('ArrowRight')
    await expect(src).toHaveCount(0)
    await expect(ed(page).locator('.cm-math')).toHaveCount(INLINE)
    await expect(page.locator('.cm-math-tip')).toHaveCount(0)
    await waitSaved(page)
    expect(readFileSync(file, 'utf8')).toBe(MATH_DOC.replace('$\\mathbf{x}$：向量', '$\\mathbf{x}_1$：向量'))
    // ← 从右边走进去（结尾 $ 前面），再 ← 一路走到最前面、← 出去
    await page.keyboard.press('ArrowLeft')
    await expect(src).toHaveText('$\\mathbf{x}_1$')
    for (let i = 0; i < '\\mathbf{x}_1'.length + 1; i++) await page.keyboard.press('ArrowLeft')
    await expect(src).toHaveCount(0)

    // 退格在公式后面：先选中整颗（选中的样子），复制出来是 $…$；再按一下整颗删掉；⌘Z 回来
    await line(page, '：标量').click()
    await page.keyboard.press('End')
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft')
    await expect(line(page, '：标量').locator('.cm-math-src')).toHaveCount(0)
    await page.keyboard.press('Backspace')
    await expect(line(page, '：标量').locator('.cm-math.cm-math-sel')).toHaveCount(1)
    expect(await copied(page)).toBe('$x$')
    await page.keyboard.press('Backspace')
    await expect.poll(() => editorText(page)).toContain('\n- ：标量\n')
    await page.keyboard.press('Meta+z')
    await expect.poll(() => editorText(page)).toContain('\n- $x$：标量\n')

    // 选中一整行（Home、⇧End）复制：带出原来的写法
    await line(page, '个元素').click()
    await page.keyboard.press('End')
    await page.keyboard.press('Shift+Home')
    expect(await copied(page)).toBe('- $x_i$, $\\mathbf{x}_i$：向量 $\\mathbf{x}$ 第 $i$ 个元素')
    // 选中时公式不露写法（选中前后每一行的宽高都不变）
    await expect(ed(page).locator('.cm-math-src')).toHaveCount(0)

    // 单独成行的：从上一行 ↓ 走进去，露出写法（三行等宽、--fill 底），下面接着排；再 ↓ 走出去又排好
    await line(page, '线性回归：').click()
    await page.keyboard.press('End')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await expect(ed(page).locator('.cm-math-line')).toHaveCount(3)
    await expect(ed(page).locator('.cm-math-preview .katex-display')).toBeVisible()
    await expect(ed(page).locator('.cm-math-block:not(.cm-math-preview)')).toHaveCount(BLOCKS - 1)
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown')
    await expect(ed(page).locator('.cm-math-line')).toHaveCount(0)
    await expect(ed(page).locator('.cm-math-block')).toHaveCount(BLOCKS)
    // 点单独成行的：光标进写法最后一行末尾
    await ed(page).locator('.cm-math-block').first().click()
    await expect(ed(page).locator('.cm-math-line')).toHaveCount(3)
    await page.keyboard.type(' + c')
    await waitSaved(page)
    expect(readFileSync(file, 'utf8')).toContain('\\hat{\\mathbf{y}} = \\mathbf{X}\\mathbf{w} + b + c\n$$')
    // 改回去：打开再保存文件一个字节不变
    for (let i = 0; i < 4; i++) await page.keyboard.press('Backspace')
    await line(page, '：向量').locator('.cm-math').click()
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Meta+s')
    await waitSaved(page)
    expect(Buffer.from(readFileSync(file)).equals(Buffer.from(MATH_DOC))).toBe(true)
    expect(gitStatus(vault)).toBe('')
  } finally {
    await run.close()
  }
})

test('task-o48fa 打开、在公式里走一圈、⌘S：文件一个字节不变（规矩 1）', async () => {
  const run = await launch({ [NAME]: MATH_DOC })
  const { page, vault } = run
  try {
    await openNote(page, '数学符号')
    await expect(ed(page).locator('.cm-math')).toHaveCount(INLINE)
    await line(page, '：矩阵').locator('.cm-math').click()
    for (const k of ['ArrowLeft', 'ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowDown', 'ArrowUp', 'End', 'Home']) await page.keyboard.press(k)
    await ed(page).locator('.cm-math-block').first().click()
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('Meta+s')
    await page.waitForTimeout(600)
    expect(Buffer.from(readFileSync(join(vault, NAME))).equals(Buffer.from(MATH_DOC))).toBe(true)
    expect(gitStatus(vault)).toBe('')
  } finally {
    await run.close()
  }
})

test('task-o48fa 单独成行的公式露写法时字号、行高和代码块一样：等宽 12.5、行高 1.65 倍（$$…$$ 和 \\[…\\] 都是）', async () => {
  const doc = '# 量一量\n\n```python\nw = w - lr * grad\nb = b - lr * db\n```\n\n损失：\n\n$$\nL = \\frac{1}{n}\\sum_i (y_i - \\hat{y}_i)^2\n$$\n\n方阵：\n\n\\[\nA = \\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}\n\\]\n'
  const run = await launch({ '量一量.md': doc })
  const { page } = run
  const style = (sel: string, text?: string) =>
    ed(page)
      .locator(sel, text ? { hasText: text } : {})
      .first()
      .evaluate((el) => {
        const s = getComputedStyle(el)
        return { size: s.fontSize, height: (parseFloat(s.lineHeight) / parseFloat(s.fontSize)).toFixed(2), family: s.fontFamily }
      })
  try {
    await openNote(page, '量一量')
    await expect(ed(page).locator('.cm-math-block')).toHaveCount(2)
    const code = await style('.cm-line.cm-codeblock', 'w = w - lr')
    expect(code).toMatchObject({ size: '12.5px', height: '1.65' })
    // 点进 $$…$$：露写法，三行
    await ed(page).locator('.cm-math-block').first().click()
    await expect(ed(page).locator('.cm-math-line')).toHaveCount(3)
    expect(await style('.cm-math-line')).toEqual(code)
    // 行高真按 1.65 排：中间那一行（上下没有内边距）高 12.5 × 1.65
    const mid = await ed(page).locator('.cm-math-line').nth(1).evaluate((el) => el.getBoundingClientRect().height)
    expect(mid).toBeCloseTo(12.5 * 1.65, 0)
    // 点进 \[…\]：一样
    await ed(page).locator('.cm-math-block:not(.cm-math-preview)').last().click()
    await expect(ed(page).locator('.cm-math-line')).toHaveCount(3)
    await expect(ed(page).locator('.cm-math-line').first()).toHaveText('\\[')
    expect(await style('.cm-math-line')).toEqual(code)
    // CN_SHOTS 时：浅（天青）、深（深湖）各一张，光标在 $$…$$ 里，上面就是代码块，好并排对照
    if (process.env.CN_SHOTS) {
      for (const skin of ['sky', 'petrol'] as const) {
        await page.evaluate((s) => window.cn.setSettings({ appearance: { followSystem: false, skin: s } }), skin)
        await page.reload()
        await page.locator('.vault b').waitFor()
        await openNote(page, '量一量')
        await ed(page).locator('.cm-math-block').first().click()
        await expect(ed(page).locator('.cm-math-line')).toHaveCount(3)
        await page.waitForTimeout(300)
        await pane(page).screenshot({ path: join(process.env.CN_SHOTS, `${process.env.CN_SHOTS_TAG ?? 'after'}-codeblock-${skin === 'sky' ? 'light' : 'dark'}.png`) })
      }
    }
  } finally {
    await run.close()
  }
})

test('task-o48fa 正在改公式时外面改了文件（规矩 2）：公式里打的字一个不少，外面的改动合并进来', async () => {
  const run = await launch({ [NAME]: MATH_DOC })
  const { page, vault } = run
  const file = join(vault, NAME)
  try {
    await openNote(page, '数学符号')
    await line(page, '：矩阵').locator('.cm-math').click()
    await expect(line(page, '：矩阵').locator('.cm-math-src')).toHaveText('$\\mathbf{X}$')
    const typing = page.keyboard.type('^\\top', { delay: 120 })
    await page.waitForTimeout(300)
    writeFileSync(file, MATH_DOC.replace('一杯 $5', '一杯 $6'))
    await typing
    await expect.poll(() => editorText(page)).toContain('一杯 $6')
    expect(await editorText(page)).toContain('$\\mathbf{X}^\\top$：矩阵')
    await page.keyboard.press('ArrowRight')
    await waitSaved(page)
    expect(readFileSync(file, 'utf8')).toBe(MATH_DOC.replace('一杯 $5', '一杯 $6').replace('$\\mathbf{X}$：矩阵', '$\\mathbf{X}^\\top$：矩阵'))
    await expect(line(page, '：矩阵').locator('.cm-math .katex')).toHaveCount(1)
  } finally {
    await run.close()
  }
})

test('task-o48fa 同一篇切到白板：卡片里的公式同一个认法排好（行内的、单独成行的公式卡），钱数、代码照旧，写错的标红色波浪', async () => {
  const run = await launch({ [NAME]: MATH_DOC })
  const { page } = run
  try {
    await openNote(page, '数学符号')
    await acts(page).getByRole('tab', { name: '白板' }).click()
    const board = pane(page).getByTestId('doc-board')
    await expect(board.locator('.db-math .katex-display').first()).toBeVisible()
    // 单独成行的两段（$$…$$、\[…\]，中间隔着字的不并）在公式卡里；很宽的那条也是
    await expect(board.locator('.db-math .katex-display')).toHaveCount(BLOCKS)
    await expect(board.locator('.mi .katex').first()).toBeVisible()
    const cols = await board.evaluate((el) => {
      const c = el.cloneNode(true) as HTMLElement
      for (const m of c.querySelectorAll('.katex, .math-err')) m.remove()
      return c.textContent ?? ''
    })
    expect(cols).not.toMatch(/\\math|\\frac\{1\}\{n\}/)
    await expect(board).toContainText('一杯 $5，两杯 $10，美元写 $7。代码 echo $HOME 照旧。')
    await expect(board.locator('.math-err')).toHaveCount(ERRORS)
    await expect(board.locator('.math-err').nth(1)).toHaveAttribute('title', '公式写错了：不认识的命令 \\foo（第 1 个字）')
    if (process.env.CN_SHOTS) await pane(page).screenshot({ path: join(process.env.CN_SHOTS, 'after-board.png') })
  } finally {
    await run.close()
  }
})

test('task-o48fa 表格格子里、标题里、引用里、加粗里的公式也排好', async () => {
  const doc = '# 范数 $\\|x\\|$\n\n| 量 | 写法 |\n|---|---|\n| 门槛 | $V_{th}$ |\n| 钱 | $5 和 $6 |\n\n> 引用里 $\\alpha$\n\n**加粗 $x^2$** 照排\n'
  const run = await launch({ '表.md': doc })
  const { page, vault } = run
  try {
    await openNote(page, '表')
    await expect(ed(page).locator('.cm-table .cm-math .katex')).toHaveCount(1)
    await expect(ed(page).locator('.cm-table')).toContainText('$5 和 $6')
    await expect(ed(page).locator('.cm-line .cm-math .katex')).toHaveCount(3)
    await expect(ed(page).locator('.cm-strong .cm-math')).toHaveCount(1)
    await page.keyboard.press('Meta+s')
    await page.waitForTimeout(500)
    expect(readFileSync(join(vault, '表.md'), 'utf8')).toBe(doc)
  } finally {
    await run.close()
  }
})

test('task-o48fa 截图（CN_SHOTS 时）：浅、深各一张，光标在行内公式里、在单独成行的公式里', async () => {
  test.skip(!process.env.CN_SHOTS, '只在交付截图时跑')
  const dir = process.env.CN_SHOTS!
  const tag = process.env.CN_SHOTS_TAG ?? 'after'
  const run = await launch({ [NAME]: MATH_DOC })
  const { page } = run
  try {
    for (const skin of ['mint', 'petrol'] as const) {
      if (skin !== 'mint') {
        await page.evaluate((s) => window.cn.setSettings({ appearance: { followSystem: false, skin: s } }), skin)
        await page.reload()
        await page.locator('.vault b').waitFor()
      }
      await openNote(page, '数学符号')
      await expect(ed(page).locator('.cm-line').first()).toBeVisible()
      await page.waitForTimeout(500)
      await pane(page).screenshot({ path: join(dir, `${tag}-${skin === 'mint' ? 'light' : 'dark'}.png`) })
      if (tag !== 'after') continue
      await scrollDoc(page, 'bottom')
      await page.waitForTimeout(300)
      await pane(page).screenshot({ path: join(dir, `${tag}-${skin === 'mint' ? 'light' : 'dark'}-bottom.png`) })
      await scrollDoc(page, 'top')
      if (skin === 'mint') {
        await line(page, '个元素').locator('.cm-math').nth(1).click()
        await page.waitForTimeout(300)
        await pane(page).screenshot({ path: join(dir, `${tag}-cursor-inline.png`) })
        await ed(page).locator('.cm-math-block').first().click()
        await ed(page).locator('.cm-math-line').first().evaluate((e) => e.scrollIntoView({ block: 'center' }))
        await page.waitForTimeout(300)
        await pane(page).screenshot({ path: join(dir, `${tag}-cursor-block.png`) })
      }
    }
  } finally {
    await run.close()
  }
})
