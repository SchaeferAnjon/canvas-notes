/**
 * 发版前第 6 轮（美学）找出来的 3 条：每条一个测试，真打字、真点，量屏幕上画出来的样子。
 * - 底栏「N篇写不进去，字只在内存里」弹层：名字先保住，右边「有备份」整个留得下，整行不伸出弹层（长名字、短名字都量）。
 *   （读与 AI 组第 6 轮重做：只是原文件锁成只读会另存成一篇、编辑器换过去，不进这个弹层；哪都写不进去才进）
 * - 梦游预览条「退出预览 esc」：键帽不画框只留字，十套主题字和底 ≥ 4.5。
 * - 多行折叠标题第二行以「（」开头：括号的墨迹和下一行字的墨迹左边齐（text-spacing-trim: trim-start）。
 */
import { expect, test, type Page } from '@playwright/test'
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, leftView, openNote, pane, type Running } from './app'
import { DREAM_VAULT } from './fixtures/dream'
import { shotWindow } from './shots'
import { SKINS } from '../src/shared/appearance'

const size = (run: Running, w: number, h: number) => run.app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0]!.setSize(w, h), [w, h] as const)
const look = (a: { frame: 'a' | 'b'; skin: string }) => (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: a.skin, frame: a.frame, homeStyle: 'a' } }))
}
const LOOKS = [
  { tag: 'B-天青', frame: 'b', skin: 'sky' },
  { tag: 'B-深湖', frame: 'b', skin: 'petrol' },
  { tag: 'A-天青', frame: 'a', skin: 'sky' },
] as const

/** 一个元素的字和它下面的底的对比度（照 WCAG）：底色一层层往上叠到不透明为止；元素自己的 opacity 也算进字色 */
const CONTRAST = (el: Element) => {
  const probe = document.createElement('canvas').getContext('2d')!
  const rgba = (c: string): number[] => {
    probe.clearRect(0, 0, 1, 1)
    probe.fillStyle = c
    probe.fillRect(0, 0, 1, 1)
    const d = probe.getImageData(0, 0, 1, 1).data
    return [d[0]!, d[1]!, d[2]!, d[3]! / 255]
  }
  const blend = (top: number[], bot: number[]) => {
    const a = top[3]!
    return [0, 1, 2].map((i) => top[i]! * a + bot[i]! * (1 - a)).concat(1)
  }
  const layers: number[][] = []
  for (let n: Element | null = el; n; n = n.parentElement) {
    const b = rgba(getComputedStyle(n).backgroundColor)
    if (b[3]! > 0) {
      layers.push(b)
      if (b[3]! >= 0.99) break
    }
  }
  let bg = [255, 255, 255, 1]
  while (layers.length) bg = blend(layers.pop()!, bg)
  let alpha = 1
  for (let n: Element | null = el; n && n !== n.closest('.pv-bar'); n = n.parentElement) alpha *= parseFloat(getComputedStyle(n).opacity)
  const c = rgba(getComputedStyle(el).color)
  const fg = blend([c[0]!, c[1]!, c[2]!, c[3]! * alpha], bg)
  const lum = (c: number[]) => {
    const f = (v: number) => {
      v /= 255
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * f(c[0]!) + 0.7152 * f(c[1]!) + 0.0722 * f(c[2]!)
  }
  const [l1, l2] = [lum(fg), lum(bg)]
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

// ---------------------------------------------------------------- 1 底栏「N篇写不进去」弹层：名字优先

const SHORT = '冰岛行前准备'
const LONG = '2026年冬天冰岛环岛自驾行前准备清单'

/** 原文件锁成只读、库最外层也建不了新文件（像盘满了）：哪都写不进去，字只在内存里 */
async function failSave(page: Page, vault: string, title: string, text: string) {
  await openNote(page, title)
  chmodSync(join(vault, `${title}.md`), 0o444)
  chmodSync(vault, 0o555)
  await pane(page).locator('.cm-content').click()
  await page.keyboard.press('Meta+End')
  await page.keyboard.type(text)
  await expect(page.getByTestId('tab-acts').getByTestId('save-state')).toHaveAttribute('data-state', 'failed', { timeout: 10_000 })
}

for (const L of LOOKS) {
  test(`底栏「2篇写不进去」弹层（${L.tag}）：名字先保住，右边「有备份」整个留得下，长名字、短名字都不伸出弹层`, async () => {
    const run = await launch({ [`${SHORT}.md`]: `# ${SHORT}\n\n正文。\n`, [`${LONG}.md`]: `# ${LONG}\n\n正文。\n` }, {}, look(L))
    const { page, vault } = run
    try {
      await size(run, 1100, 700)
      // 下面「没提交的改动」也有两行（量它们照旧）：外面新建的两篇
      writeFileSync(join(vault, '外面新建的一篇.md'), '# 外面新建的一篇\n')
      writeFileSync(join(vault, '外面新建的另一篇.md'), '# 外面新建的另一篇\n')
      await expect(page.getByTestId('git-changed')).toContainText('2处没提交', { timeout: 10_000 })
      await failSave(page, vault, SHORT, '短名字没存上的字。')
      await failSave(page, vault, LONG, '长名字没存上的字。')
      await expect(page.getByTestId('git-changed')).toContainText('2篇写不进去，字只在内存里')
      await page.getByTestId('git-changed').click()
      const pop = page.getByRole('dialog', { name: '没提交的改动' })
      await expect(pop).toBeVisible()
      for (const [name, short] of [[SHORT, true], [LONG, false]] as const) {
        const row = pop.getByRole('menuitem', { name: new RegExp(`^${name}\\.md`) })
        await expect(row).toContainText('有备份')
        const m = await row.evaluate((el) => {
          const box = (e: Element) => e.getBoundingClientRect()
          const popEl = el.closest('.shell-menu')!
          const nameEl = el.querySelector('.truncate')!
          const r = el.querySelector('.r')!
          const ps = getComputedStyle(popEl)
          // 字本来要多宽（不管省略号）：比元素宽就是被省略了，scrollWidth 取整量不出差零点几像素的那种
          const natural = (e: Element) => {
            const rg = document.createRange()
            rg.selectNodeContents(e)
            return rg.getBoundingClientRect().width
          }
          return {
            pop: { left: box(popEl).left + parseFloat(ps.paddingLeft), right: box(popEl).right - parseFloat(ps.paddingRight) },
            row: { left: box(el).left, right: box(el).right, w: box(el).width },
            name: { w: box(nameEl).width, natural: natural(nameEl), full: nameEl.scrollWidth, shown: nameEl.clientWidth, right: box(nameEl).right },
            r: { left: box(r).left, right: box(r).right, w: box(r).width, full: r.scrollWidth, shown: r.clientWidth, overflow: getComputedStyle(r).textOverflow, pad: parseFloat(getComputedStyle(r).paddingLeft) },
            title: (el as HTMLElement).title,
          }
        })
        console.log(`${L.tag} ${short ? '短' : '长'}名字`, JSON.stringify(m))
        // 整行、右边那句都在弹层里面
        expect(m.row.right).toBeLessThanOrEqual(m.pop.right + 0.5)
        expect(m.r.right).toBeLessThanOrEqual(m.row.right + 0.5)
        expect(m.r.left).toBeGreaterThanOrEqual(m.name.right - 0.5)
        // 右边写不下才省略；「有备份」三个字名字再长也留得下（右边最窄 44 = 8 + 三个 12 号字）
        expect(m.r.overflow).toBe('ellipsis')
        expect(m.r.shown).toBeGreaterThanOrEqual(m.r.full)
        // 悬停给全：哪篇、备份在哪
        expect(m.title).toContain(name)
        expect(m.title).toMatch(/字备份在 .*没存上的字\/.*\.md，点了在访达里显示/)
        if (short) {
          // 短名字整个写得下（连零点几像素的省略都没有）
          expect(m.name.w).toBeGreaterThanOrEqual(m.name.natural - 0.01)
        } else {
          // 长名字（18 个字）：也整个写得下，名字占这一行的大头，只给右边留「字在…」那么宽
          expect(m.name.w).toBeGreaterThanOrEqual(m.name.natural - 0.01)
          expect(m.name.w).toBeGreaterThan(m.r.w * 3)
          expect(m.name.w).toBeGreaterThanOrEqual(0.7 * (m.name.w + m.r.w))
        }
      }
      // 下面「没提交的改动」那几行照旧：右边「新」「改」整个在，名字长了缩名字
      const others = await pop.locator('.mi:not(.unsaved) .r').evaluateAll((els) =>
        els.map((e) => {
          const rg = document.createRange()
          rg.selectNodeContents(e)
          const pad = parseFloat(getComputedStyle(e).paddingLeft)
          return { t: e.textContent, w: e.getBoundingClientRect().width - pad, natural: rg.getBoundingClientRect().width }
        }),
      )
      expect(others.length).toBe(2)
      for (const o of others) expect(o.w, `「${o.t}」`).toBeGreaterThanOrEqual(o.natural - 0.01)
      await page.mouse.move(2, 2)
      await shotWindow(run, `r6-unsaved-pop-${L.frame}-${L.skin}`)
    } finally {
      chmodSync(vault, 0o755)
      for (const t of [SHORT, LONG]) if (existsSync(join(vault, `${t}.md`))) chmodSync(join(vault, `${t}.md`), 0o644)
      // 字只在内存里：退出前会问，测试里点「仍然退出」
      await run.app.evaluate(({ dialog }) => {
        dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox
      })
      await run.close()
    }
  })
}

// ---------------------------------------------------------------- 2 梦游预览条：esc 键帽只留字

for (const frame of ['b', 'a'] as const) {
  test(`梦游预览条（${frame.toUpperCase()}）：「退出预览 esc」的键帽不画框只留字，十套主题字和底 ≥ 4.5`, async () => {
    test.setTimeout(120_000)
    const run = await launch({ ...DREAM_VAULT }, { CN_AI_FAKE: '1' }, look({ frame, skin: 'sky' }))
    const { page } = run
    const panel = page.getByRole('complementary', { name: '梦游报告' })
    try {
      await size(run, 1440, 900)
      await leftView(page, '梦游报告')
      await panel.getByRole('button', { name: '现在梦游' }).click()
      await expect(panel.getByTestId('dream-summary')).toContainText('整理了', { timeout: 60_000 })
      await panel.getByRole('button', { name: '预览' }).click()
      const bar = page.getByTestId('preview-bar')
      await expect(bar).toBeVisible()
      const btn = bar.getByRole('button', { name: /退出预览/ })
      const kbd = btn.locator('.kbd-in')
      await expect(kbd).toHaveText('esc')
      const rows: string[] = []
      for (const skin of SKINS) {
        await page.evaluate((s) => Object.assign(document.documentElement.dataset, { skin: s.id, tone: s.tone, tabmark: s.tab }), skin)
        for (const state of ['静止', '悬停'] as const) {
          if (state === '静止') await page.mouse.move(2, 2)
          else await btn.hover()
          await page.waitForTimeout(250)
          const m = await kbd.evaluate((el) => {
            const s = getComputedStyle(el)
            const k = el.getBoundingClientRect()
            const b = el.closest('button')!.getBoundingClientRect()
            return { border: [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth], opacity: s.opacity, top: k.top - b.top, bottom: b.bottom - k.bottom }
          })
          const ratio = await kbd.evaluate(CONTRAST)
          rows.push(`${skin.name} ${state} esc ${ratio.toFixed(2)}`)
          expect(m.border, `${skin.name} 键帽不画框`).toEqual(['0px', '0px', '0px', '0px'])
          expect(m.opacity).toBe('1')
          expect(ratio, `${skin.name} ${state} esc 字和底`).toBeGreaterThanOrEqual(4.5)
          // 字在按钮里面，不碰按钮的描边
          expect(m.top).toBeGreaterThanOrEqual(1)
          expect(m.bottom).toBeGreaterThanOrEqual(1)
        }
        if (skin.id === 'sky' || skin.id === 'petrol') {
          await page.mouse.move(2, 2)
          await page.waitForTimeout(200)
          await shotWindow(run, `r6-preview-esc-${frame}-${skin.id}`)
        }
      }
      console.log(rows.join('\n'))
    } finally {
      await run.close()
    }
  })
}

// ---------------------------------------------------------------- 3 多行折叠标题：行首「（」不缩进

const FOLD = `# 多行折叠

<details>
<summary>
冬天冰岛环岛自驾
（东段从赫本到埃伊尔斯塔济要翻山，冬天常常封路，出发前一晚和当天早上都要看路况和风速，风速超过二十米每秒就别出门）的路况每天都不一样，雪大时环岛公路整段关闭，只能原地多住一晚
</summary>

里面一段。

</details>
`

/** 窗口上一块地方从主进程截下来，逐列找第一列有字的墨迹（和底色差得多的点），返回窗口里的 x */
async function inkLeft(run: Running, r: { x: number; y: number; width: number; height: number }) {
  return run.app.evaluate(async ({ BrowserWindow }, r) => {
    const img = await BrowserWindow.getAllWindows()[0]!.webContents.capturePage(r)
    const { width, height } = img.getSize()
    const px = img.toBitmap()
    const at = (x: number, y: number) => {
      const i = (y * width + x) * 4
      return [px[i + 2]!, px[i + 1]!, px[i]!]
    }
    const bg = at(0, Math.floor(height / 2))
    for (let x = 0; x < width; x++)
      for (let y = 0; y < height; y++) {
        const c = at(x, y)
        if (Math.abs(c[0]! - bg[0]!) + Math.abs(c[1]! - bg[1]!) + Math.abs(c[2]! - bg[2]!) > 120) return r.x + (x * r.width) / width
      }
    return -1
  }, r)
}

for (const L of LOOKS) {
  test(`多行折叠标题（${L.tag}）：第二行以「（」开头时括号不缩进，墨迹和折下去那行的字、第一行的字左边齐`, async () => {
    const run = await launch({ '多行折叠.md': FOLD }, {}, look(L))
    const { page } = run
    try {
      await size(run, 1100, 700)
      await openNote(page, '多行折叠')
      await pane(page).locator('.cm-fold-head').first().dispatchEvent('mousedown', { button: 0 })
      const heads = pane(page).locator('.cm-fold-headline')
      await expect(heads).toHaveCount(2)
      await page.mouse.move(2, 2)
      // 每一行（含折下去的行）第一个字的方框：第一行、「（」那行、「（…」折下去的那一行
      const starts = await heads.evaluateAll((lines) => {
        const out: { ch: string; x: number; y: number; h: number }[] = []
        for (const line of lines) {
          const w = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
          let lastTop = -Infinity
          for (let n = w.nextNode() as Text | null; n; n = w.nextNode() as Text | null) {
            for (let i = 0; i < n.data.length; i++) {
              const r = document.createRange()
              r.setStart(n, i)
              r.setEnd(n, i + 1)
              const b = r.getClientRects()[0]
              if (!b || !n.data[i]!.trim()) continue
              if (b.top > lastTop + 4) out.push({ ch: n.data[i]!, x: b.left, y: b.top, h: b.height })
              lastTop = Math.max(lastTop, b.top)
            }
          }
        }
        return out
      })
      console.log(L.tag, JSON.stringify(starts))
      expect(starts.length).toBeGreaterThanOrEqual(3)
      expect(starts[0]!.ch).toBe('冬')
      expect(starts[1]!.ch).toBe('（')
      const ink = []
      for (const s of starts.slice(0, 3)) ink.push(await inkLeft(run, { x: Math.floor(s.x) - 6, y: Math.floor(s.y) + 2, width: 26, height: Math.floor(s.h) - 4 }))
      console.log(L.tag, '墨迹左边', ink.map((x) => x.toFixed(1)).join(' / '))
      for (const x of ink) expect(x).toBeGreaterThan(0)
      // 「（」的墨迹和下一行字、第一行字的墨迹差不过 2px（不加 trim 时差 8px，半个字）
      expect(Math.abs(ink[1]! - ink[2]!)).toBeLessThanOrEqual(2)
      expect(Math.abs(ink[1]! - ink[0]!)).toBeLessThanOrEqual(2)
      await expect(heads.nth(1)).toHaveCSS('text-spacing-trim', 'trim-start')
      await shotWindow(run, `r6-fold-paren-${L.frame}-${L.skin}`)
    } finally {
      await run.close()
    }
  })
}
