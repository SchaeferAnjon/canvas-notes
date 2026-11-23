/**
 * 思维导图第一批（task-wuv05）的交付对照图：设计页原型（proto.html?screen=…）和真软件同一个状态，左原型、右软件拼成一张，天青、深湖各一组。
 * 只在截交付图时跑：CN_SHOTS=目录（没给就跳过）。软件照常 CN_E2E 测试模式；原型和拼图在同一个 Electron 里另开看不见的窗口画（不上屏幕）。
 *   CN_SHOTS=/private/tmp/canvas-notes-build4/wuv05-b1 npx playwright test e2e/wuv05-b1-shots.spec.ts
 */
import { expect, test, type Page } from '@playwright/test'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { launch, pane, type Running } from './app'
import { mapFiles } from './fixtures/mindmap-b1'
import { armMenus, dismissMenu, openedMenu } from './menu'

/** 在一个看不见的窗口里开 url（内容区 w × h），等一会儿截下来 */
async function render(run: Running, url: string, w: number, h: number, file: string, wait = 900) {
  const b64 = await run.app.evaluate(
    async ({ BrowserWindow }, o) => {
      const win = new BrowserWindow({ show: false, useContentSize: true, width: o.w, height: o.h, webPreferences: { backgroundThrottling: false } })
      await win.loadURL(o.url)
      await new Promise((r) => setTimeout(r, o.wait))
      const png = (await win.webContents.capturePage()).toPNG().toString('base64')
      win.destroy()
      return png
    },
    { url, w, h, wait },
  )
  writeFileSync(file, Buffer.from(b64, 'base64'))
}

const DIR = process.env.CN_SHOTS
const PROTO = process.env.CN_PROTO ?? '/private/tmp/canvas-notes-visual/15-思维导图/proto.html'
test.skip(!DIR || !existsSync(PROTO), '只在截交付图时跑（CN_SHOTS=目录，原型在 /private/tmp/canvas-notes-visual/15-思维导图/）')

const SCREENS = ['keys', 'drag', 'fold', 'layout', 'down', 'focus'] as const
type Screen = (typeof SCREENS)[number]
const TITLE: Record<Screen, string> = { keys: '① 选中主题、加号、右键菜单', drag: '② 拖到两个同级中间', fold: '③ 折叠', layout: '④ 左右展开 + 布局菜单', down: '④ 向下展开', focus: '⑤ 只看这一枝' }

const board = (page: Page) => pane(page).getByTestId('board')
const esc = (s: string) => s.replace(/[()+=.*?[\]\\^$|]/g, '\\$&')
const node = (page: Page, text: string) => board(page).locator('.mm-node', { has: page.locator('.t', { hasText: new RegExp(`^${esc(text)}$`) }) })

async function shotApp(run: Running, file: string) {
  await run.page.waitForTimeout(700)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(file, Buffer.from(b64, 'base64'))
}

for (const [tone, skin, theme] of [
  ['天青', 'sky', 'light'],
  ['深湖', 'petrol', 'dark'],
] as const) {
  test(`对照图（${tone}）：原型和软件同一个状态并排`, async () => {
    test.setTimeout(240_000)
    mkdirSync(DIR!, { recursive: true })
    const look = (vault: string) => {
      const ud = join(dirname(vault), 'user-data')
      mkdirSync(ud, { recursive: true })
      writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin, frame: 'b', winBg: 'aurora' } }))
    }
    const run = await launch(mapFiles(), { CN_AI_FAKE: '1' }, look)
    const { page } = run
    try {
      // 软件：和原型一样 1440 × 887 的窗口，左栏收起（原型里没有左栏），开那张导图
      await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
      await expect.poll(() => page.evaluate(() => innerHeight)).toBe(887)
      await page.locator('.nav .si', { hasText: /^学习笔记/ }).first().click()
      await page.locator('.nav .si', { hasText: /^导图 11-22/ }).first().click()
      await expect(board(page).locator('.mm-node')).toHaveCount(16)
      await page.keyboard.press('Meta+Backslash')
      await page.waitForTimeout(500)
      const app = (s: Screen) => join(DIR!, `软件-${s}-${tone}.png`)

      // 鼠标放在白板空处（别停在图标栏上冒提示）
      const rest = async () => {
        const b = (await board(page).boundingBox())!
        await page.mouse.move(b.x + b.width - 40, b.y + b.height - 40)
      }

      // ① 选中「核与像」：外圈、加号；右键菜单是系统菜单截不到，读出实际的项和键，拼图时写在旁边
      await node(page, '核与像').click()
      await rest()
      await shotApp(run, app('keys'))
      await armMenus(run)
      await node(page, '核与像').click({ button: 'right' })
      await openedMenu(run)
      const sym = (a: string) => a.replace(/Command\+/g, '⌘').replace(/Shift\+/g, '⇧').replace(/Alt\+/g, '⌥').replace('Return', '↵').replace('Backspace', '⌫').replace('Up', '↑').replace('Down', '↓').replace('Space', '空格')
      const menuItems = (
        await run.app.evaluate(() => (globalThis as unknown as { cnMenu: { menu: Electron.Menu } }).cnMenu.menu.items.map((i) => (i.type === 'separator' ? null : [i.label, i.accelerator ?? '', i.enabled] as const)))
      ).map((x) => (x ? [x[0], sym(x[1]), x[2]] as const : null))
      await dismissMenu(run)
      const kerBox = (await node(page, '核与像').boundingBox())!

      // ② 拖「秩-零化度定理」到「ker T 映到 0」上边（照原型：手在它上面 7）
      const from = (await node(page, '秩-零化度定理').boundingBox())!
      const ker = (await node(page, 'ker T 映到 0').boundingBox())!
      await page.mouse.move(from.x + 10, from.y + 10)
      await page.mouse.down()
      await page.mouse.move(ker.x + 40, ker.y + 20, { steps: 5 })
      await page.mouse.move(ker.x + 40, ker.y - 7, { steps: 3 })
      await expect(page.getByTestId('map-drag-hint')).toHaveText('排到「ker T 映到 0」前面')
      await shotApp(run, app('drag'))
      await page.keyboard.press('Escape')
      await page.mouse.up()
      // 补（原型这一屏没有）：拖到「定义」正中间，放进去的虚线框和小牌
      const k2 = (await node(page, 'ker T 映到 0').boundingBox())!
      const def = (await node(page, '定义').boundingBox())!
      await page.mouse.move(k2.x + 10, k2.y + k2.height / 2)
      await page.mouse.down()
      await page.mouse.move(def.x + def.width / 2, def.y + def.height / 2, { steps: 8 })
      await expect(page.getByTestId('map-drag-hint')).toHaveText('放进「定义」，排在最后')
      await shotApp(run, join(DIR!, `补-放进去-${tone}.png`))
      await page.keyboard.press('Escape')
      await page.mouse.up()

      // ③ 「定义」「例子」收着，「矩阵表示」选中
      for (const t of ['定义', '例子']) {
        await node(page, t).hover()
        await node(page, t).locator('.fold').click()
      }
      await node(page, '矩阵表示').click()
      await rest()
      await shotApp(run, app('fold'))
      // 「在哪」标注图要的框（窗口里的 CSS 像素）：标签条「布局 ▾」、选中主题的「+」、收着的圆点、选中的主题
      const where: [string, { x: number; y: number; width: number; height: number }][] = [
        ['标签条右端「布局 ▾」：换向右 / 左右 / 向下，收起到第一层、全部展开', (await page.getByTestId('tab-acts').getByTestId('map-layout').boundingBox())!],
        ['选中的主题：外圈强调色，旁边「+」加子主题（Tab），右键是全部的键', (await node(page, '矩阵表示').boundingBox())!],
        ['折叠圆点：收着写藏了几个，点一下展开；收起写进文件', (await node(page, '定义').locator('.fold').boundingBox())!],
        ['「+」：加子主题', (await board(page).getByTestId('map-plus').boundingBox())!],
      ]
      for (const t of ['定义', '例子']) await node(page, t).locator('.fold').click()
      await expect(board(page).locator('.mm-node')).toHaveCount(16)

      // ④ 左右展开，菜单开着
      const btn = page.getByTestId('tab-acts').getByTestId('map-layout')
      await btn.click()
      await page.getByTestId('map-layout-menu').getByRole('menuitemradio', { name: /左右展开/ }).click()
      await expect(board(page).getByTestId('mindmap')).toHaveAttribute('data-layout', 'both')
      await btn.click()
      await rest()
      await shotApp(run, app('layout'))
      await page.keyboard.press('Escape')
      // 补：左右展开收起菜单后的整张（左边一半的连线）
      await expect(page.getByTestId('map-layout-menu')).toHaveCount(0)
      await rest()
      await shotApp(run, join(DIR!, `补-左右展开-${tone}.png`))

      // ④ 向下展开
      await btn.click()
      await page.getByTestId('map-layout-menu').getByRole('menuitemradio', { name: /向下展开/ }).click()
      await expect(board(page).getByTestId('mindmap')).toHaveAttribute('data-layout', 'down')
      await rest()
      await shotApp(run, app('down'))
      await btn.click()
      await page.getByTestId('map-layout-menu').getByRole('menuitemradio', { name: /向右展开/ }).click()

      // ⑤ 只看「核与像」这一枝
      await node(page, '核与像').click()
      await page.keyboard.press('Alt+Enter')
      await expect(board(page).getByTestId('map-focus')).toBeVisible()
      await rest()
      await shotApp(run, app('focus'))
      await page.keyboard.press('Escape')

      // 补：下划线主题有下级时，圆点对着下划线（给「T(cv)=cT(v)」加一个子主题再选中它）
      await node(page, 'T(cv)=cT(v)').click()
      await page.keyboard.press('Tab')
      await page.getByRole('textbox', { name: '节点的字' }).fill('标量')
      await page.keyboard.press('Enter')
      await node(page, 'T(cv)=cT(v)').click()
      await rest()
      await shotApp(run, join(DIR!, `补-下划线主题的圆点-${tone}.png`))

      // 原型：同样 1440 × 887，每个画面截一张
      for (const s of SCREENS) await render(run, `${pathToFileURL(PROTO).href}?screen=${s}&theme=${theme}`, 1440, 887, join(DIR!, `原型-${s}-${tone}.png`))

      // 系统右键菜单：照实际读到的项和键列出来（不是截图，只为对字和顺序），放在主题右下
      const rows = menuItems.map((x) => (x ? `<div style="display:flex;gap:24px;padding:3px 10px;${x[2] ? '' : 'opacity:.4'}"><span>${x[0]}</span><span style="margin-left:auto;opacity:.6">${x[1]}</span></div>` : '<hr style="border:0;border-top:1px solid rgba(127,127,127,.35);margin:4px 0">')).join('')
      const menuPanel = `<div style="position:absolute;left:${kerBox.x + kerBox.width + 40}px;top:${kerBox.y - 6}px;width:300px;padding:6px;border-radius:8px;background:${theme === 'dark' ? 'rgba(40,44,48,.96)' : 'rgba(246,246,246,.97)'};box-shadow:0 8px 30px rgba(0,0,0,.3);font:13px/1.5 -apple-system,'PingFang SC';color:${theme === 'dark' ? '#eee' : '#111'}"><div style="font-size:11px;opacity:.6;padding:2px 10px 6px">系统右键菜单（照实际读到的项和键画的示意）</div>${rows}</div>`

      // 拼：左原型、右软件，上面一行写是哪一屏（拼的页面也放在这个目录里，图按相对路径读；用完删掉）
      for (const s of SCREENS) {
        const html = join(DIR!, `.pair-${s}-${tone}.html`)
        writeFileSync(
          html,
          `<!doctype html><meta charset="utf-8"><body style="margin:0;background:${theme === 'dark' ? '#101418' : '#f4f3f0'};font:22px -apple-system,'PingFang SC',sans-serif;color:${theme === 'dark' ? '#ddd' : '#222'}">` +
            `<div style="display:flex;gap:20px;height:46px;align-items:center;padding:0 20px"><div style="width:1440px">原型 · ${TITLE[s]} · ${tone}</div><div style="width:1440px">软件 · ${TITLE[s]} · ${tone}</div></div>` +
            `<div style="display:flex;gap:20px;padding:0 20px 20px"><img src="原型-${s}-${tone}.png" style="width:1440px;height:887px"><div style="position:relative;width:1440px;height:887px"><img src="软件-${s}-${tone}.png" style="width:1440px;height:887px">${s === 'keys' ? menuPanel : ''}</div></div></body>`,
        )
        await render(run, pathToFileURL(html).href, 2940, 953, join(DIR!, `并排-${s}-${tone}.png`), 500)
        rmSync(html)
      }

      // 「在哪」：软件截图上画红框和编号，右边一列写每个框是什么（交回报告开头那张）
      const pad = 6
      const boxes = where.map(([, b], i) => `<div style="position:absolute;left:${b.x - pad}px;top:${b.y - pad}px;width:${b.width + pad * 2}px;height:${b.height + pad * 2}px;border:3px solid #d42020;border-radius:6px"><b style="position:absolute;left:-14px;top:-14px;width:26px;height:26px;border-radius:50%;background:#d42020;color:#fff;font:600 15px/26px -apple-system;text-align:center">${i + 1}</b></div>`).join('')
      const notes = where.map(([t], i) => `<li style="margin:0 0 14px"><b style="display:inline-block;width:26px;height:26px;border-radius:50%;background:#d42020;color:#fff;text-align:center;line-height:26px;margin-right:8px">${i + 1}</b>${t}</li>`).join('')
      const whereHtml = join(DIR!, `.where-${tone}.html`)
      writeFileSync(
        whereHtml,
        `<!doctype html><meta charset="utf-8"><body style="margin:0;display:flex;gap:24px;padding:20px;background:#f4f3f0;font:20px/1.5 -apple-system,'PingFang SC',sans-serif;color:#222"><div style="position:relative;width:1440px;height:887px;flex:none"><img src="软件-fold-${tone}.png" style="width:1440px;height:887px;display:block">${boxes}</div><ol style="list-style:none;margin:0;padding:8px 0;width:420px">${notes}</ol></body>`,
      )
      await render(run, pathToFileURL(whereHtml).href, 1928, 927, join(DIR!, `在哪-${tone}.png`), 500)
      rmSync(whereHtml)
    } finally {
      await run.close()
    }
  })
}
