/**
 * 勾选框不铺底、细边（task-gr4sx，用户「可以 这个按照推荐来就行」：半透明面板上白色实心方框太硬），和画布今日同一套（@cn/design 的 --cb-line）：
 * - 文档里的待办（.cm-taskbox）、待办首页和左栏（.td-cb）：没勾的不铺底、边是 --cb-line，悬停变深；勾上照旧主题色底白勾；⏫ 照旧黄框。
 * - 十套主题 × B 极光 / 冰洞 / 不用图 / A：没勾的框的边对它里外的底色（真截出来的像素）≥ 3:1（非文字元素）。
 * - 文档里勾掉的那条，框和字照样居中对齐（以前低 4px）；行末 ✅ 日期不露原文（藏起来，文件不变）。
 * - 真点勾、真点取消：文件写回对。
 * CN_SHOTS=<目录> 时另截改前改后对照图（CN_SHOT_TAG=before / after；浅色天青、深色深湖，B 冰洞）。
 */
import { expect, type Page, test } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { editorText, launch, leftView, openNote, pane, type Running, shownText, tabOn, waitSaved } from './app'
import { boxes, look, LOOKS, setLook, SKINS, worst } from './cb-measure'

const pad = (n: number) => String(n).padStart(2, '0')
const D = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const PLAN = `# 小论文计划\n\n截稿前把实验和初稿弄完，周五交给导师。\n\n## 这周\n\n- [ ] 读完三篇相关论文 📅 ${D(0)} 🔼\n    - [x] Attention Is All You Need\n    - [ ] BERT\n    - [ ] ViT\n- [ ] 交论文初稿 📅 ${D(1)} 15:00 🔔 提前1小时 ⏫\n- [x] 和导师约时间 ✅ ${D(-1)}\n- [x] 订组会的会议室 📅 ${D(-1)} ✅ ${D(-1)}\n\n## 下周\n\n- [ ] 补实验图 📅 ${D(3)} 🔼\n- [ ] 改摘要\n`
const FILES: Record<string, string> = {
  '写作/小论文计划.md': PLAN,
  '收件箱/待办.md': `# 待办\n\n- [ ] 回导师邮件 📅 ${D(0)} 10:30\n- [ ] 取快递 📅 ${D(0)} 18:00\n- [ ] 买打印纸\n- [ ] 交 ecp 作业 2 📅 ${D(-1)} 23:59 ⏫\n- [x] 买咖啡豆 📅 ${D(0)} ✅ ${D(0)}\n`,
}

async function start(skin = 'sky', frame = 'b', winBg = 'cave'): Promise<Running> {
  const run = await launch(FILES, { CN_TODAY_INSTALLED: '1' }, (vault) => {
    const ud = join(dirname(vault), 'user-data')
    mkdirSync(ud, { recursive: true })
    writeFileSync(join(ud, 'settings.json'), JSON.stringify(look(skin, frame, winBg)))
  })
  await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900))
  await expect.poll(() => run.page.evaluate(() => innerHeight)).toBe(900)
  return run
}

const bar = (page: Page) => page.getByRole('navigation', { name: '左栏' })
const home = (page: Page) => pane(page).getByTestId('todo-home')
const docLine = (page: Page, text: string) => pane(page).locator('.cm-line', { hasText: text }).first()
const homeRow = (page: Page, title: string) => home(page).locator('.td-r').filter({ has: page.locator('.td-t', { hasText: new RegExp(`^${title}$`) }) }).first()

/** 文档里每个勾选框的正中比它后面第一个字的正中低多少（px） */
async function boxOffsets(page: Page) {
  return pane(page)
    .locator('.cm-content')
    .evaluate((root) =>
      [...root.querySelectorAll<HTMLElement>('.cm-taskbox')].map((box) => {
        const line = box.closest('.cm-line')!
        const walk = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
        let t: Text | null = null
        for (let n = walk.nextNode(); n; n = walk.nextNode())
          if (box.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING && n.textContent!.trim()) {
            t = n as Text
            break
          }
        const r = document.createRange()
        r.setStart(t!, 0)
        r.setEnd(t!, 1)
        const tr = r.getBoundingClientRect()
        const br = box.getBoundingClientRect()
        return { on: box.classList.contains('on'), text: t!.textContent!.trim(), d: br.top + br.height / 2 - (tr.top + tr.height / 2) }
      }),
    )
}

const colorOf = (page: Page, v: string) =>
  page.evaluate((v) => {
    const p = document.createElement('i')
    p.style.color = `var(${v})`
    document.querySelector('.cm-content, .tdh-scroll')!.append(p)
    const c = getComputedStyle(p).color
    p.remove()
    return c
  }, v)

test('文档里：没勾的框不铺底、悬停变深；勾掉的那条框和字对齐；行末 ✅ 日期不露；真点勾、真点取消，文件写回对', async () => {
  const run = await start()
  const { page } = run
  const file = join(run.vault, '写作/小论文计划.md')
  try {
    await openNote(page, '小论文计划')
    const box = docLine(page, '改摘要').locator('.cm-taskbox')
    await expect(box).toBeVisible()
    const css = () => box.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, border: getComputedStyle(el).borderTopColor }))
    const rest = await css()
    expect(rest.bg).toBe('rgba(0, 0, 0, 0)')
    await box.hover()
    await expect.poll(async () => (await css()).border).toBe(await colorOf(page, '--t2'))
    // ⏫ 照旧黄框，悬停也不变灰
    const hi = docLine(page, '交论文初稿').locator('.cm-taskbox')
    await expect(hi).toHaveClass(/\bhi\b/)
    await hi.hover()
    await expect.poll(() => hi.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(await colorOf(page, '--cb-hi'))
    await page.mouse.move(5, 450)

    // 勾掉的和没勾的，框的正中都和字的正中对齐（差不到 1px）
    const offs = await boxOffsets(page)
    expect(offs.filter((o) => o.on).length).toBeGreaterThanOrEqual(3)
    for (const o of offs) expect(Math.abs(o.d), `「${o.text}」的框比字低 ${o.d.toFixed(1)}px`).toBeLessThanOrEqual(1)

    // 行末 ✅ 日期：看不到原文，文件里照旧在
    const shown = await shownText(page)
    expect(shown).toContain('和导师约时间')
    expect(shown).not.toContain('✅')
    expect(shown).not.toContain(D(-1))
    expect(await editorText(page)).toBe(PLAN)
    // 有日子的那条：日子小块照旧（昨天），✅ 也收进去
    await expect(docLine(page, '订组会的会议室').locator('.cm-tdchip')).toHaveText('昨天')

    // 真点勾：文件里那一行变成 - [x]；框是主题色底
    await box.click()
    await expect(box).toHaveClass(/\bon\b/)
    expect(await box.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(await colorOf(page, '--acc-bg'))
    await waitSaved(page)
    await expect.poll(() => readFileSync(file, 'utf8')).toBe(PLAN.replace('- [ ] 改摘要', '- [x] 改摘要'))
    // 勾上以后框和字照样对齐
    const after = (await boxOffsets(page)).find((o) => o.text === '改摘要')!
    expect(Math.abs(after.d)).toBeLessThanOrEqual(1)
    // 真点取消：回到原来的字节
    await box.click()
    await expect(box).not.toHaveClass(/\bon\b/)
    await waitSaved(page)
    await expect.poll(() => readFileSync(file, 'utf8')).toBe(PLAN)
  } finally {
    await run.close()
  }
})

test('文档里：藏起来的 ✅ 日期前面打字、退格、回车，字不打进记号里，记号留在原来那一条', async () => {
  const run = await start('sky', 'a', 'none')
  const { page } = run
  const file = join(run.vault, '写作/小论文计划.md')
  try {
    await openNote(page, '小论文计划')
    // 点在「和导师约时间」那一行，按 End（屏上的行尾），打一个字
    await docLine(page, '和导师约时间').locator('text=和导师约时间').click()
    await page.keyboard.press('End')
    await page.keyboard.type('了')
    await waitSaved(page)
    await expect.poll(() => readFileSync(file, 'utf8')).toBe(PLAN.replace('- [x] 和导师约时间 ✅', '- [x] 和导师约时间了 ✅'))
    expect(await shownText(page)).not.toContain('✅')
    await page.keyboard.press('Backspace')
    await waitSaved(page)
    await expect.poll(() => readFileSync(file, 'utf8')).toBe(PLAN)
    // 行尾回车：新的一条起在记号后面，打的字在新的一条里
    await page.keyboard.press('Enter')
    await page.keyboard.type('订机票')
    await waitSaved(page)
    await expect.poll(() => readFileSync(file, 'utf8')).toBe(PLAN.replace(`- [x] 和导师约时间 ✅ ${D(-1)}\n`, `- [x] 和导师约时间 ✅ ${D(-1)}\n- [ ] 订机票\n`))
    expect(await shownText(page)).not.toContain('✅')
  } finally {
    await run.close()
  }
})

test('待办首页：没勾的框不铺底；真点勾、真点取消，文件写回对', async () => {
  const run = await start()
  const { page } = run
  const file = join(run.vault, '收件箱/待办.md')
  const before = FILES['收件箱/待办.md']!
  try {
    await bar(page).getByRole('button', { name: '待办', exact: true }).click()
    await expect(tabOn(page)).toHaveText('待办')
    const box = homeRow(page, '取快递').locator('.td-cb')
    await expect(box).toBeVisible()
    expect(await box.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
    const rest = await box.evaluate((el) => getComputedStyle(el).borderTopColor)
    await box.hover()
    await expect.poll(() => box.evaluate((el) => getComputedStyle(el).borderTopColor)).not.toBe(rest)
    // ⏫ 悬停照旧黄框
    const hi = homeRow(page, '交 ecp 作业 2').locator('.td-cb')
    await hi.hover()
    await expect.poll(() => hi.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(await colorOf(page, '--cb-hi'))
    await box.click()
    await expect.poll(() => readFileSync(file, 'utf8')).toBe(before.replace(`- [ ] 取快递 📅 ${D(0)} 18:00\n`, `- [x] 取快递 📅 ${D(0)} 18:00 ✅ ${D(0)}\n`))
    await expect(box).toHaveClass(/\bon\b/)
    await box.click()
    await expect.poll(() => readFileSync(file, 'utf8')).toBe(before)
    await expect(box).not.toHaveClass(/\bon\b/)
  } finally {
    await run.close()
  }
})

test('十套主题 × B 极光 / 冰洞 / 不用图 / A：待办首页、文档里没勾的框的边对底色 ≥ 3:1', async () => {
  test.setTimeout(600_000)
  const run = await start()
  const { page } = run
  try {
    const table: string[] = []
    let min = Infinity
    for (const [where, open, sel, hiSel] of [
      ['待办首页', async () => void (await bar(page).getByRole('button', { name: '待办', exact: true }).click()), '.tdh-scroll .td-cb:not(.on):not(.hi)', '.tdh-scroll .td-cb.hi:not(.on)'],
      [
        '文档',
        async () => {
          await leftView(page, '文件')
          await openNote(page, '小论文计划')
        },
        '.doc .cm-taskbox:not(.on):not(.hi)',
        '.doc .cm-taskbox.hi:not(.on)',
      ],
    ] as const) {
      for (const skin of SKINS) {
        const cells: string[] = []
        for (const l of LOOKS) {
          await setLook(page, skin, l.frame, l.winBg)
          await open()
          await page.mouse.move(5, 450)
          const bs = await boxes(page, sel)
          expect(bs.length, `${where} ${skin} ${l.name} 看得见的框`).toBeGreaterThan(1)
          const c = await worst(run, bs)
          // ⏫ 的黄框也是没勾的框，一样要 3:1
          const h = await worst(run, await boxes(page, hiSel))
          min = Math.min(min, c, h)
          cells.push(`${l.name} ${c.toFixed(2)}（⏫ ${h.toFixed(2)}）`)
        }
        table.push(`${where} ${skin.padEnd(9)} ${cells.join(' · ')}`)
      }
    }
    console.log(`画布笔记 勾选框边的对比度（最差的那个框）：\n${table.join('\n')}`)
    expect(min).toBeGreaterThanOrEqual(3)
  } finally {
    await run.close()
  }
})

const OUT = process.env.CN_SHOTS
test('对照图：文档里、待办首页，浅色天青、深色深湖，B 冰洞', async () => {
  test.skip(!OUT, '只在截对照图时跑（CN_SHOTS=<目录>）')
  test.setTimeout(240_000)
  mkdirSync(OUT!, { recursive: true })
  const tag = process.env.CN_SHOT_TAG ?? 'after'
  const shot = async (run: Running, name: string) => {
    await run.page.mouse.move(700, 895)
    await run.page.waitForTimeout(500)
    const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
    writeFileSync(join(OUT!, `${name}-${tag}.png`), Buffer.from(b64, 'base64'))
  }
  for (const [skin, tone] of [
    ['sky', 'light'],
    ['petrol', 'dark'],
  ] as const) {
    const run = await start(skin, 'b', 'cave')
    const { page } = run
    try {
      await bar(page).getByRole('button', { name: '待办', exact: true }).click()
      await expect(homeRow(page, '取快递')).toBeVisible()
      await shot(run, `notes-todo-${tone}`)
      await leftView(page, '文件')
      await openNote(page, '小论文计划')
      await pane(page).locator('.cm-line', { hasText: '截稿前' }).click()
      await shot(run, `notes-doc-${tone}`)
    } finally {
      await run.close()
    }
  }
})
