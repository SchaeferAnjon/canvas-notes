/**
 * 白板和文档联动（task-vcov6）的对照截图：和小样 board-doc/proto-a.html 同一个状态、同样 1440 × 887，浅色天青、深色深湖各一组。
 * CN_SHOTS_DIR 给了就存到那里（并排对照图用），不给存在 test-results/r9-shots/。只截图，交互的验收在 r9-board-doc.spec.ts。
 */
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { acts, launch, pane } from './app'
import { board, col, FILES, openBoard } from './fixtures/board-doc'

const DIR = process.env.CN_SHOTS_DIR ?? join(__dirname, '../test-results/r9-shots')

/** 「在哪」标注图用：几处的位置（窗口里的 CSS 像素），和截图一起存 */
async function rects(page: Page, name: string) {
  const at = await page.evaluate(() => {
    const one = (sel: string) => {
      const e = document.querySelector(sel)
      if (!e) return null
      const r = e.getBoundingClientRect()
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
    }
    const col = [...document.querySelectorAll('.pane:not([hidden]) .db-col')].find((c) => c.getAttribute('aria-label') === '住哪')
    const r = col?.getBoundingClientRect()
    const card = col?.querySelector('.db-card')?.getBoundingClientRect()
    const box = (b?: DOMRect) => (b ? { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } : null)
    return {
      tabs: one('[data-testid="tab-acts"]'),
      inboxBtn: one('[data-testid="db-inbox"]'),
      pal: one('.pane:not([hidden]) .bpal'),
      base: one('.pane:not([hidden]) .bpal button[data-kind="base"]'),
      hint: one('.pane:not([hidden]) .db-hint'),
      col: box(r),
      card: box(card),
      drawer: one('.pane:not([hidden]) .db-drawer'),
    }
  })
  writeFileSync(join(DIR, name + '.json'), JSON.stringify(at, null, 2))
}

async function shoot(page: Page, name: string) {
  await page.waitForTimeout(450)
  await page.screenshot({ path: join(DIR, name + '.png') })
}

for (const [tone, skin] of [
  ['light', 'sky'],
  ['dark', 'petrol'],
] as const) {
  test(`对照截图（${tone}）`, async () => {
    mkdirSync(DIR, { recursive: true })
    const run = await launch(FILES)
    const { page, app } = run
    try {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
      await page.evaluate((s) => window.cn.setSettings({ appearance: { followSystem: false, skin: s, frame: 'b' } }), skin)
      // 换主题要重载一次才生效（设计复审查出来的：不重载两组都是默认的薄荷浅色）
      await page.reload()
      await page.locator('.vault b').waitFor()
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
      await openBoard(page, '冰岛十天环岛')
      // 左栏收起（小样里左边只有图标栏）
      await page.keyboard.press('Meta+Backslash')
      await expect(board(page)).toBeVisible()
      await shoot(page, `${tone}-01-board-inbox`)
      await rects(page, `${tone}-01-board-inbox`)
      // 数据库：点工具板「数据库」，挑「住宿」，展开，改一格
      await board(page).locator('.bpal button[data-kind="base"]').click()
      await shoot(page, `${tone}-02-base-menu`)
      await page.getByRole('menu', { name: '放一张数据库卡' }).getByRole('menuitem').filter({ hasText: '住宿' }).first().click()
      await shoot(page, `${tone}-03-base-card`)
      await board(page).getByTestId('db-expand').click()
      const big = board(page).locator('.dbx')
      await big.locator('tbody tr', { hasText: 'Mývatn 小屋' }).locator('td').nth(2).click()
      await page.keyboard.press('Meta+a')
      await page.keyboard.type('3')
      await page.keyboard.press('Enter')
      await expect(board(page).locator('.db-toast')).toContainText('晚数改成了「3」')
      await shoot(page, `${tone}-04-base-expanded`)
      await big.getByTestId('db-collapse').click()
      // 空白卡：点「卡片」，正中那一列多一张空卡；打 / 出插入菜单
      await board(page).locator('.bpal button[data-kind="card"]').click()
      await shoot(page, `${tone}-05-new-card`)
      await page.keyboard.type('/')
      await shoot(page, `${tone}-06-new-card-slash`)
      // 收起插入菜单、删掉那个「/」，空卡 Esc 收起什么都不写（不然文档里多一段「/」）
      await page.keyboard.press('Escape')
      await page.keyboard.press('Backspace')
      await page.keyboard.press('Escape')
      // 收件箱拖两条：速记进「住哪」，剪藏到空白处
      const drawer = board(page).getByRole('complementary', { name: '收件箱' })
      const quick = drawer.getByRole('listitem', { name: '蓝湖温泉要提前两周订，周末更紧。' })
      const q = (await quick.boundingBox())!
      const t = (await col(page, '住哪').locator('.db-card').first().boundingBox())!
      await page.mouse.move(q.x + 40, q.y + 20)
      await page.mouse.down()
      await page.mouse.move(t.x + 100, t.y + t.height + 10, { steps: 16 })
      await page.mouse.up()
      const clip = drawer.getByRole('listitem', { name: 'Geography of Iceland' })
      const c = (await clip.boundingBox())!
      const w = (await board(page).locator('.board-wrap').boundingBox())!
      await page.mouse.move(c.x + 40, c.y + 20)
      await page.mouse.down()
      await page.mouse.move(w.x + 900, w.y + 560, { steps: 16 })
      await page.mouse.up()
      await shoot(page, `${tone}-07-inbox-dragged`)
      // 收件箱收起：标签条上留「收件箱 N」
      await drawer.getByRole('button', { name: '收起收件箱' }).click()
      await shoot(page, `${tone}-08-inbox-closed`)
      await acts(page).getByTestId('db-inbox').click()
      // 文档看法：列是标题、卡是段落；文末「提到这篇的」
      await acts(page).getByRole('tab', { name: '文档' }).click()
      await expect(pane(page).locator('.cm-content')).toBeVisible()
      await shoot(page, `${tone}-09-doc`)
      await pane(page).locator('.body').evaluate((el) => el.scrollTo(0, el.scrollHeight))
      await shoot(page, `${tone}-10-doc-bottom`)
      // 周记里嵌白板和一节
      await openBoard(page, '2026-W47')
      await expect(pane(page).locator('.cm-embed').first()).toBeVisible()
      await shoot(page, `${tone}-11-w47`)
    } finally {
      await run.close()
    }
  })
}
