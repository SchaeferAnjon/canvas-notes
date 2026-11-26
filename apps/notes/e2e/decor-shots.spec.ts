/**
 * 白板装饰的交付截图（交付页 155、设计复审用）：薄荷、深湖各一套。CN_SHOTS=目录 时才截（文件名 mac-<场景>-<主题>.png）；没给就只走一遍流程。
 * 场景：总览（便签 + 样式卡 + 贴纸 + 胶带同框）、卡片样式五种、样式浮层、装饰抽屉三页、胶带吸附虚线框、贴纸选中（把手和小条）、
 * 消失笔正在写的光迹、设置里那一行。
 */
import { expect, test } from '@playwright/test'
import { acts, openNote, pane } from './app'
import { center, drag, openDecorBoard, shot, toScreen } from './decor-helpers'
import { BOARD, INK_PATH } from './decor-samples'

/** 白板滚回打开时的样子（data-home 是四周垫的空白） */
const home = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const w = document.querySelector<HTMLElement>('.pane:not([hidden]) .board-wrap')!
    const [x, y] = (w.dataset.home ?? '0,0').split(',').map(Number)
    w.scrollLeft = x!
    w.scrollTop = y!
  })

const STYLE_CARD = (title: string) => `#### ${title}
- C72 BST-GATNet：第 1、2 页逐段读了，第 4、5 页读了一部分。
- J52 SAGE：读了第 1 页。核心问题是换一个新司机模型就不准。`

/** 卡片样式一览：同一张卡五种画法摆一排 */
const STYLES = `---
type: board
---
# 卡片样式一览

<!-- card id=p1 x=40 y=60 -->
${STYLE_CARD('纸面 · 这周实际做了什么')}

<!-- card id=p2 x=470 y=60 style=glass -->
${STYLE_CARD('磨砂玻璃 · 这周实际做了什么')}

<!-- card id=p3 x=900 y=60 style=outline color=2 -->
${STYLE_CARD('描边 · 这周实际做了什么')}

<!-- card id=p4 x=40 y=330 style=header color=0 -->
${STYLE_CARD('彩头 · 这周实际做了什么')}

<!-- card id=p5 x=470 y=330 style=lined color=0 -->
${STYLE_CARD('横线纸 · 读书计划')}

<!-- column id=c0 x=900 y=330 -->
## 说明

同一张卡（「11.24 组会准备」里的）五种画法：纸面跟主题，磨砂玻璃在浮岛书桌配背景图时透出窗口背景，描边、彩头、横线纸的颜色用主题的六色。
`

/** 总览：组会白板上贴了便签、胶带、贴纸，一列彩头、一张横线纸 */
const OVERVIEW_MD = BOARD.replace('## 这周学到的（会上讲，约 2 分钟）\n', '## 这周学到的（会上讲，约 2 分钟）\n<!-- column style=header color=0 -->\n')
  .replace('<!-- card id=k1 ink=1 -->', '<!-- card id=k1 ink=1 style=outline color=1 -->')
  .concat('\n<!-- card id=n1 x=520 y=470 note=yellow rot=-2.5 -->\n问 Nima：数据什么时候给？一共几个人？\n\n<!-- card id=n2 x=790 y=500 note=green rot=2 -->\n下次组会带半页纸草稿：先学 C73，用 E4 数据跑一遍。\n')
const OVERVIEW_INK = [
  '{"ink":1}',
  '{"tape":"t1aaaaaa","on":"k1","at":"br","pat":"mint","len":80,"rot":-40,"seed":2}',
  '{"tape":"t2bbbbbb","on":"n1","at":"t","pat":"dots","len":78,"rot":-3,"seed":5}',
  '{"tape":"t3cccccc","x":930,"y":448,"pat":"stars","len":110,"rot":-14,"seed":8}',
  '{"sticker":"s1dddddd","k":"coffee","x":462,"y":470,"w":64,"rot":10}',
  '{"sticker":"s2eeeeee","k":"star","on":"k1","x":378,"y":30,"w":56,"rot":12}',
  '{"sticker":"s3ffffff","k":"wls","on":"n2","x":150,"y":172,"w":96,"rot":-6}',
  '{"sticker":"s4gggggg","k":"bulb","x":985,"y":655,"w":60,"rot":-8}',
  '',
].join('\n')

for (const skin of ['mint', 'petrol'] as const) {
  test(`白板装饰截图：${skin}`, async () => {
    test.setTimeout(300_000)
    const { run, page, board } = await openDecorBoard({ '11.24 组会准备.md': OVERVIEW_MD, [INK_PATH]: OVERVIEW_INK, '卡片样式一览.md': STYLES }, skin)
    const name = (s: string) => `mac-${s}-${skin}`
    try {
      await expect(board.getByTestId('decor-sticker')).toHaveCount(4)
      // 顶上一次性的说明都点掉（截图里不挡）
      for (let i = 0; i < 3; i++) {
        const x = board.locator('.db-hint-x').first()
        if (await x.isVisible().catch(() => false)) await x.click({ timeout: 3000 }).catch(() => undefined)
        await page.waitForTimeout(400)
      }
      await home(page)
      await page.waitForTimeout(600)
      await shot(run, name('overview'))

      // ---- 贴纸选中：旋转把手、右下角缩放、小条 ----
      await board.locator('[data-decor="sticker:s4gggggg"]').click()
      await expect(page.getByTestId('decor-bar')).toBeVisible()
      await shot(run, name('sticker-selected'))
      await page.keyboard.press('Escape')

      // ---- 装饰抽屉三页 ----
      await home(page)
      await board.getByTestId('pal-decor').click()
      const drawer = page.getByTestId('decor-drawer')
      await expect(drawer).toBeVisible()
      await page.mouse.move(150, 700) // 鼠标挪到左栏空处：截图里没有悬停的底色
      await shot(run, name('drawer-note'))
      await drawer.getByRole('tab', { name: '胶带' }).click()
      await page.mouse.move(150, 700)
      await shot(run, name('drawer-tape'))
      // ---- 胶带拖到卡角：虚线框和顶上那句 ----
      const card = board.locator('.db-card[data-id]', { hasText: '笔记里只记到这些' })
      const cb = (await card.boundingBox())!
      const pick = await center(page, '[data-testid="decor-drawer"] .dw-item[data-v="floral"]')
      await page.mouse.move(pick.x, pick.y)
      await page.mouse.down()
      for (let i = 1; i <= 14; i++) await page.mouse.move(pick.x + ((cb.x + cb.width - 10 - pick.x) * i) / 14, pick.y + ((cb.y + 8 - pick.y) * i) / 14)
      await expect(board.getByTestId('decor-snap')).toBeVisible()
      await shot(run, name('tape-snap'))
      await page.keyboard.press('Escape')
      await page.mouse.up()
      await drawer.getByRole('tab', { name: '贴纸' }).click()
      await page.mouse.move(150, 700)
      await shot(run, name('drawer-sticker'))
      await drawer.getByRole('button', { name: '收起' }).click()

      // ---- 消失笔正在写 ----
      await page.getByTestId('fade-pen').click()
      const p = await toScreen(page, 980, 300)
      await page.mouse.move(p.x, p.y)
      await page.mouse.down()
      // 圈一圈、拉一道箭头
      for (let i = 0; i <= 40; i++) {
        const a = -2.4 + (i / 40) * Math.PI * 2.2
        await page.mouse.move(p.x + Math.cos(a) * 90, p.y + Math.sin(a) * 40)
      }
      await page.mouse.up()
      await page.mouse.move(p.x + 90, p.y + 40)
      await page.mouse.down()
      for (let i = 1; i <= 18; i++) await page.mouse.move(p.x + 90 + i * 9, p.y + 40 + i * 6)
      await shot(run, name('fade-live'))
      await page.mouse.up()
      // 再点一下出浮层
      await page.getByTestId('fade-pen').click()
      await expect(page.getByTestId('fade-pop')).toBeVisible()
      await shot(run, name('fade-pop'))
      await page.keyboard.press('Escape')

      // ---- 便签选中：纸色浮层 ----
      await board.locator('.db-card.placed.dc-note[data-note="yellow"]').click({ position: { x: 100, y: 130 } })
      await page.getByTestId('decor-cardbar').getByRole('button', { name: '纸色' }).click()
      await expect(page.getByTestId('decor-paper-pop')).toBeVisible()
      await shot(run, name('note-paper-pop'))
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')

      // ---- 卡片样式五种、样式浮层 ----
      await openNote(page, '卡片样式一览')
      await acts(page).getByRole('tab', { name: '白板' }).click()
      const b2 = pane(page).getByTestId('doc-board')
      await expect(b2.locator('.db-card.dc-cs')).toHaveCount(4)
      await page.keyboard.press('Shift+Meta+1')
      await page.waitForTimeout(800)
      await shot(run, name('card-styles'))
      await b2.locator('.db-card[data-id="p4"]').click({ position: { x: 60, y: 60 } })
      await page.getByTestId('decor-cardbar').getByRole('button', { name: '样式' }).click()
      await expect(page.getByTestId('decor-style-pop')).toBeVisible()
      await shot(run, name('style-pop'))
      await page.keyboard.press('Escape')

      // ---- 设置里那一行 ----
      await page.keyboard.press('Meta+,')
      const dlg = page.getByRole('dialog', { name: '设置' })
      await dlg.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: '文档和白板', exact: true }).click()
      const row = dlg.locator('[data-row="fadeSecs"]')
      await row.scrollIntoViewIfNeeded()
      await expect(row).toBeVisible()
      await shot(run, name('settings'))
      void drag
    } finally {
      await run.close()
    }
  })
}
