import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decodeNote } from '@cn/format'
import { FIXTURES } from '../../../packages/format/test/fixtures'
import { gitStatus, launch, leftView, openNote, pane, waitSaved, acts } from './app'
import { MAP, MAP_PATH, mapFiles } from './fixtures/mindmap-b1'
import { MAP2, map2Files } from './fixtures/mindmap-b2'
import { feynmanVault, MAP_PATH as FEY_PATH, MAP_TEXT as FEY_TEXT } from './fixtures/feynman-after'

// 规矩 1：一篇笔记打开、什么都不改、保存，文件一个字节都不变（Git 里没有假改动）。

test('导图白板（收起写在行尾注释里的 fold、属性里的「导图布局」，task-wuv05）：打开、白板 / 文档来回切、打一个字再删、关掉，一个字节都不变', async () => {
  const text = MAP.replace('白板样式: 导图\n', '白板样式: 导图\n导图布局: 左右\n')
    .replace('  - 定义 <!-- box=0.233,0.211,0.091,0.082 -->', '  - 定义 <!-- box=0.233,0.211,0.091,0.082 fold -->')
    .replace('  - 例子 <!-- box=0.233,0.675,0.091,0.082 -->\n', '  - 例子 <!-- fold box=0.233,0.675,0.091,0.082 -->\n')
    .replace('    - 先加再映射，和先映射再加，结果一样；数乘也一样\n', '    - 先加再映射，和先映射再加，结果一样；数乘也一样 <!--fold-->\n')
  const run = await launch(mapFiles(text))
  const { page, vault } = run
  try {
    await page.locator('.nav .si', { hasText: /^导图 11-22/ }).first().click()
    const board = pane(page).getByTestId('board')
    await expect(board.getByTestId('mindmap')).toHaveAttribute('data-layout', 'both')
    // 收着的两枝不画孩子
    await expect(board.locator('.mm-node')).toHaveCount(10)
    for (const v of ['文档', '白板', '文档']) {
      await acts(page).getByRole('tab', { name: v }).click()
      await page.waitForTimeout(200)
    }
    await expect(pane(page).locator('.cm-content')).toBeVisible()
    await pane(page).locator('.cm-content').focus()
    await page.keyboard.press('Meta+ArrowDown')
    await page.keyboard.type('x')
    await expect(acts(page).getByTestId('save-state')).toHaveAttribute('data-state', 'dirty')
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Meta+s')
    await waitSaved(page)
    expect(readFileSync(join(vault, MAP_PATH), 'utf8')).toBe(text)
    await page.keyboard.press('Meta+w')
    await page.waitForTimeout(800)
    expect(readFileSync(join(vault, MAP_PATH), 'utf8')).toBe(text)
    expect(gitStatus(vault)).toBe('')
  } finally {
    await run.close()
  }
})
test('导图白板第二批（备注续行、外框、概要、短编号、图、浮动主题、配色、骨架、联系线、鱼骨，task-wuv05）：打开、白板 / 文档来回切、打一个字再删、关掉，一个字节都不变', async () => {
  const text = MAP2.replace('白板样式: 导图\n', '白板样式: 导图\n导图布局: 鱼骨\n导图配色: 彩虹\n导图骨架: 线条\n导图联系线:\n  - k1 -> k2 "求导也能写成矩阵"\n  - k3 -> k1 bend=30\n')
    .replace('  - 定义 <!-- box=0.233,0.211,0.091,0.082 -->', '  - 定义 <!-- box=0.233,0.211,0.091,0.082 frame=2 frame-title="都能写成矩阵" -->')
    .replace('    - 复合 = 矩阵相乘 <!-- box=0.755,0.32,0.202,0.066 -->', '    - 复合 = 矩阵相乘 <!-- box=0.755,0.32,0.202,0.066 sum=2 sum-text="乘法对应复合" id=k2 -->')
    .replace('    - 旋转 <!-- box=0.073,0.591,0.072,0.068 -->', '    - 旋转 ![旋转](../../附件/导图/2026-11-22-1751.jpg) <!-- box=0.073,0.591,0.072,0.068 img-w=88 -->')
    .replace('    - 求导 d/dx <!-- box=0.207,0.882,0.142,0.068 -->\n', '    - 求导 d/dx <!-- box=0.207,0.882,0.142,0.068 id=k1 -->\n- 先记一笔 <!-- at=470,250 id=k3 -->\n  - 后来想到的\n')
  const run = await launch(map2Files(text))
  const { page, vault } = run
  try {
    await page.locator('.nav .si', { hasText: /^导图 11-22/ }).first().click()
    const board = pane(page).getByTestId('board')
    await expect(board.getByTestId('mindmap')).toHaveAttribute('data-layout', 'fish')
    await expect(board.getByTestId('map-note-icon').first()).toBeVisible()
    await expect(board.getByTestId('map-topic-img')).toHaveCount(1)
    for (const v of ['文档', '白板', '文档']) {
      await acts(page).getByRole('tab', { name: v }).click()
      await page.waitForTimeout(200)
    }
    await pane(page).locator('.cm-content').focus()
    await page.keyboard.press('Meta+ArrowDown')
    await page.keyboard.type('x')
    await expect(acts(page).getByTestId('save-state')).toHaveAttribute('data-state', 'dirty')
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Meta+s')
    await waitSaved(page)
    expect(readFileSync(join(vault, MAP_PATH), 'utf8')).toBe(text)
    await page.keyboard.press('Meta+w')
    await page.waitForTimeout(800)
    expect(readFileSync(join(vault, MAP_PATH), 'utf8')).toBe(text)
    expect(gitStatus(vault)).toBe('')
  } finally {
    await run.close()
  }
})

test('打开再保存文件不变：每个样本打开、⌘S、打一个字再删掉、等自动保存，Git 状态仍然干净', async () => {
  const run = await launch(FIXTURES)
  const { page, vault } = run
  try {
    for (const [name, bytes] of Object.entries(FIXTURES)) {
      const title = name.replace(/\.md$/, '')
      await openNote(page, title)
      await pane(page).locator('.cm-content').click()
      // 点到的地方可能是表格（表格的格子自己接字，回车或点开才写进文档）：焦点放回正文，光标到文末再打字
      await pane(page).locator('.cm-content').focus()
      await page.keyboard.press('Meta+ArrowDown')
      await page.keyboard.press('Meta+s')
      if (!decodeNote(bytes).meta.readOnly) {
        await page.keyboard.type('x')
        await expect(acts(page).getByTestId('save-state')).toHaveAttribute('data-state', 'dirty')
        await page.keyboard.press('Backspace')
        await page.keyboard.press('Meta+s')
        await waitSaved(page)
      } else {
        // 只读文件：打字不进去
        await page.keyboard.type('x')
        await expect(acts(page).getByTestId('page-note')).toContainText('只读')
      }
      expect(Buffer.from(readFileSync(join(vault, name))).equals(Buffer.from(bytes)), name).toBe(true)
    }
    // 关掉所有标签（关的时候会再保存一次），之后仍然一个字节都不变；关完回到首页（只剩首页时不再关）
    const tabs = page.getByTestId('tab-list').locator('.tab')
    // 只点中间的标签（配好对的样本开着时右栏网页也开着，它的当前网页标签也是 .tab.on）
    while (!((await tabs.count()) === 1 && (await page.getByTestId('tab-on').textContent()) === '首页')) await tabs.locator('.x').and(page.locator('.tab.on .x')).click()
    await page.waitForTimeout(1200)
    expect(gitStatus(vault)).toBe('')
  } finally {
    await run.close()
  }
})

// 合成一张（task-5ryf9）：列里一张（只记编号的一行带 merge=2）、空白处一张（位置行带 merge=3）、连线；
// 白板、文档来回切，文档里打一个字再删、⌘S，关掉再开：一个字节不变（这块样本只放这里，不进 Swift 对照的 FIXTURES）
const MERGED = '---\ntype: board\nlinks:\n  - d1 -> m2\n---\n# 合成\n\n## 前言\n\n<!-- card id=m2 merge=2 -->\n第一段。\n\n> 第二段是引文。\n—— [来源](https://example.com)\n\n## 别的\n\n单独一张。\n\n<!-- card id=d1 x=40 y=420 merge=3 -->\n[[导图]]\n\n范数：向量有多大。\n\n- 非负\n- 三角不等式\n'
test('合成一张的白板打开再保存不变：白板、文档来回切，打一个字再删、⌘S，关掉，文件一个字节不变', async () => {
  const run = await launch({ '合成.md': MERGED, '导图.md': '---\ntype: board\n---\n# 导图\n' })
  const { page, vault } = run
  try {
    await openNote(page, '合成')
    await acts(page).getByRole('tab', { name: '白板' }).click()
    await expect(pane(page).locator('.db-card.merged')).toHaveCount(2)
    await expect(pane(page).locator('.db-card.merged').first().locator('.db-part')).toHaveCount(2)
    await acts(page).getByRole('tab', { name: '文档' }).click()
    await pane(page).locator('.cm-content').focus()
    await page.keyboard.press('Meta+ArrowDown')
    await page.keyboard.press('Meta+s')
    await page.keyboard.type('x')
    await expect(acts(page).getByTestId('save-state')).toHaveAttribute('data-state', 'dirty')
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Meta+s')
    await waitSaved(page)
    expect(readFileSync(join(vault, '合成.md'), 'utf8')).toBe(MERGED)
    await page.keyboard.press('Meta+w')
    await page.waitForTimeout(1200)
    expect(readFileSync(join(vault, '合成.md'), 'utf8')).toBe(MERGED)
    expect(gitStatus(vault)).toBe('')
  } finally {
    await run.close()
  }
})

test('真改了字就写回，CRLF 和 BOM 照旧', async () => {
  const run = await launch({ 'bom-crlf.md': FIXTURES['bom-crlf.md']! })
  const { page, vault } = run
  try {
    await openNote(page, 'bom-crlf')
    await pane(page).locator('.cm-line', { hasText: '内容' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type('加了几个字')
    await waitSaved(page)
    const bytes = readFileSync(join(vault, 'bom-crlf.md'))
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(bytes.subarray(3).toString('utf8')).toBe('# BOM 加 CRLF\r\n内容加了几个字\r\n')
  } finally {
    await run.close()
  }
})

test('名字叫「待办」的笔记用任务界面打开（task-pd1d1）：只看、任务 / 白板 / 文档来回切、关掉，文件一个字节不变（CRLF、BOM 也一样）', async () => {
  const enc = (s: string) => new TextEncoder().encode(s)
  const files: Record<string, Uint8Array> = {
    '收件箱/待办.md': enc('# 待办\r\n\r\n- [ ] 回导师邮件 📅 2099-01-01 10:30\r\n- [x] 交读书报告 ✅ 2026-11-21\r\n'),
    '写作/待办.md': new Uint8Array([0xef, 0xbb, 0xbf, ...enc('# 待办\n\n- [ ] 买打印纸\n- [ ] 给猫买粮 📅 2099-01-02   \n\t- [ ] 子任务\n')]),
  }
  const run = await launch(files)
  const { page, vault } = run
  try {
    for (const [path, bytes] of Object.entries(files)) {
      const folder = path.split('/')[0]!
      await leftView(page, '待办')
      await page.locator(`aside.side .td-fg[aria-label="${folder}"]`).getByRole('button', { name: `打开 ${folder}/待办 ›` }).click()
      await expect(acts(page).getByRole('tab', { name: '任务' })).toHaveAttribute('aria-selected', 'true')
      await expect(pane(page).locator('.td-view .td-r').first()).toBeVisible()
      for (const v of ['白板', '文档', '任务', '文档', '任务']) {
        await acts(page).getByRole('tab', { name: v }).click()
        await page.waitForTimeout(150)
      }
      await page.keyboard.press('Meta+s')
      await page.waitForTimeout(600)
      expect(Buffer.from(readFileSync(join(vault, path))).equals(Buffer.from(bytes)), path).toBe(true)
      await page.keyboard.press('Meta+w')
      await page.waitForTimeout(600)
      expect(Buffer.from(readFileSync(join(vault, path))).equals(Buffer.from(bytes)), path).toBe(true)
    }
    expect(gitStatus(vault)).toBe('')
  } finally {
    await run.close()
  }
})

test('导图白板上补进过费曼（行尾注释 wrong / fix / blank、费曼一轮那一节和它的注释，task-yvabi）：打开、白板 / 文档来回切、打一个字再删、关掉，一个字节都不变', async () => {
  const text = FEY_TEXT.replace('    - f(αx) = |α| f(x)\n', '    - f(αx) = |α| f(x) <!-- wrong -->\n      - 是 |α| 倍 <!-- fix -->\n').replace('    - 非负 f(x) ≥ 0\n', '    - 非负 f(x) ≥ 0 <!-- blank -->\n')
  const run = await launch({ ...feynmanVault(), [FEY_PATH]: text })
  const { page, vault } = run
  try {
    await page.locator('.nav .si', { hasText: '导图 · 线性代数 2.3' }).first().click()
    await expect(pane(page).getByTestId('map-blank')).toHaveCount(1)
    for (const v of ['文档', '白板', '文档']) {
      await acts(page).getByRole('tab', { name: v }).click()
      await page.waitForTimeout(200)
    }
    await pane(page).locator('.cm-content').focus()
    await page.keyboard.press('Meta+ArrowDown')
    await page.keyboard.type('x')
    await expect(acts(page).getByTestId('save-state')).toHaveAttribute('data-state', 'dirty')
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Meta+s')
    await waitSaved(page)
    expect(readFileSync(join(vault, FEY_PATH), 'utf8')).toBe(text)
    await page.keyboard.press('Meta+w')
    await page.waitForTimeout(800)
    expect(readFileSync(join(vault, FEY_PATH), 'utf8')).toBe(text)
    expect(gitStatus(vault)).toBe('')
  } finally {
    await run.close()
  }
})
