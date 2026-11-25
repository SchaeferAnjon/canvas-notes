/**
 * ⌘ 悬停弹出那一篇要快（⌘预览常驻）：用户「目前这里按住 cmd 预览有点慢」。
 * 造一个像真库那么大的临时库（2000 篇笔记、150 份 PDF、300 张图），同一篇里同一个链接，各量 10 次：
 * 先停在链接上再按 ⌘、先按住 ⌘ 再移到链接上。时间是软件里自己记的（peek.tsx 的 window.__cnPeek，从按下 ⌘ / 移到链接上那一刻起，到浮窗里整篇画出来那一帧）。
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, type Locator, type Page, test } from '@playwright/test'
import { launch, openNote, pane } from './app'

const TARGET = 'YitingWei_2026_C72_BST-GATNet'
const SECTION = '留一被试（LOSO）'

function bigVault(): Record<string, string | Uint8Array> {
  const files: Record<string, string | Uint8Array> = {}
  for (let f = 0; f < 40; f++) {
    for (let i = 0; i < 50; i++) {
      const body = Array.from({ length: 30 }, (_, k) => `第 ${k + 1} 段：文件夹 ${f} 第 ${i} 篇的正文，随便写一点字凑长度。见 [[笔记 ${(f * 50 + i + 7) % 2000}]]。`)
      files[`资料/夹${f}/笔记 ${f * 50 + i}.md`] = [`# 笔记 ${f * 50 + i}`, '', ...body, ''].join('\n')
    }
  }
  for (let i = 0; i < 150; i++) files[`论文/第${i}篇.pdf`] = new Uint8Array(64)
  for (let i = 0; i < 300; i++) files[`附件/图${i}.png`] = new Uint8Array(64)
  const target = [`# ${TARGET}`, '', ...Array.from({ length: 120 }, (_, i) => `开头第 ${i + 1} 段：BST-GATNet 的背景。`), '', `## ${SECTION}`, '', '这一节专门讲留一被试（LOSO）的考法：用没见过的司机来测试。', '', ...Array.from({ length: 200 }, (_, i) => `后面第 ${i + 1} 段。`), ''].join('\n')
  files[`文献/${TARGET}.md`] = target
  files['项目/study project 2/组会与沟通/11.24 组会准备.md'] = [
    '# 11.24 组会准备',
    '',
    `SAGE 在同一个数据集上正好做了对比：随机划分 91.8%，[[${TARGET}#${SECTION}|留一被试（LOSO，测试的司机完全没见过）]] 80.6%，不做个性化校准只有 65.7%。`,
    '',
    '另一个：[[笔记 42]]',
    '',
  ].join('\n')
  return files
}

type Times = Record<string, number>
const allTimes = (page: Page) => page.evaluate(() => ((window as unknown as { __cnPeek?: Times[] }).__cnPeek ?? []).slice())

function report(name: string, runs: Times[]) {
  const keys = [...new Set(runs.flatMap((r) => Object.keys(r)))].filter((k) => k !== 'at')
  const rows = keys.map((k) => {
    const v = runs.map((r) => (r[k] ?? NaN) - r.at!).filter((x) => !Number.isNaN(x)).sort((a, b) => a - b)
    const med = v.length ? v[Math.floor((v.length - 1) / 2)]! : NaN
    return `${k.padEnd(10)} 中位 ${med.toFixed(0).padStart(5)} ms  最大 ${(v.at(-1) ?? NaN).toFixed(0).padStart(5)} ms`
  })
  console.log(`\n== ${name}（${runs.length} 次）==\n` + rows.join('\n'))
  return runs.map((r) => r.shown! - r.at!)
}

async function away(page: Page) {
  const b = (await pane(page).boundingBox())!
  await page.mouse.move(b.x + 12, b.y + b.height - 12, { steps: 2 })
}

async function closeAll(page: Page) {
  await page.keyboard.up('Meta')
  await away(page)
  await page.mouse.click((await pane(page).boundingBox())!.x + 12, (await pane(page).boundingBox())!.y + (await pane(page).boundingBox())!.height - 12)
  await expect(page.getByTestId('peek')).toHaveCount(0)
}

async function measure(page: Page, link: Locator, how: 'hover-then-meta' | 'meta-then-hover', n: number, expectText = '这一节专门讲留一被试', name: string = how): Promise<number[]> {
  const before = (await allTimes(page)).length
  for (let i = 0; i < n; i++) {
    if (how === 'hover-then-meta') {
      await link.hover()
      await page.waitForTimeout(250)
      await page.keyboard.down('Meta')
    } else {
      await page.keyboard.down('Meta')
      await page.waitForTimeout(100)
      await link.hover()
    }
    await expect(page.locator('.pk[data-depth="0"]').getByTestId('peek-doc')).toContainText(expectText)
    await expect.poll(async () => (await allTimes(page)).at(-1)?.shown).toBeTruthy()
    await closeAll(page)
    await page.waitForTimeout(150)
  }
  return report(name, (await allTimes(page)).slice(before).filter((r) => r.shown))
}

test('⌘ 悬停弹出：大库里同一个链接各 10 次，量各段用了多久', async () => {
  test.setTimeout(240_000)
  const run = await launch(bigVault())
  const { page } = run
  try {
    await openNote(page, '11.24 组会准备')
    const link = pane(page).locator('.cm-wikilink', { hasText: '留一被试（LOSO' })
    await expect(link).toBeVisible()
    const a = await measure(page, link, 'hover-then-meta', 10)
    const b = await measure(page, link, 'meta-then-hover', 10)
    const all = [...a, ...b].sort((x, y) => x - y)
    // 不带标题的双链（还要认是不是数据库一行）
    await measure(page, pane(page).locator('.cm-wikilink', { hasText: '笔记 42' }), 'hover-then-meta', 10, '文件夹 0 第 42 篇', '不带标题的双链 hover-then-meta')
    // 库里刚变过（外面加了一篇）：记着的文件列表作废，1 秒后再弹
    writeFileSync(join(run.vault, '外面加的.md'), '# 外面加的\n')
    await page.waitForTimeout(1200)
    await measure(page, link, 'hover-then-meta', 1, undefined, '库里刚变过 1 秒后')
    console.log(`\n整篇画出来：中位 ${all[Math.floor((all.length - 1) / 2)]!.toFixed(0)} ms，最大 ${all.at(-1)!.toFixed(0)} ms`)
    // 要 150 ms 内出来（改前中位 406、最大 1173：等 120 ms 再弹，再让主进程把整个库列两遍）；机器忙时个别一次慢，看中位
    expect(all[Math.floor((all.length - 1) / 2)]!).toBeLessThan(150)
  } finally {
    await run.close()
  }
})
