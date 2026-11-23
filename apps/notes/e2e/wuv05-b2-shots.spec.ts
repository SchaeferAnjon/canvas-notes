/**
 * 思维导图第二批 + 在这一页里找（task-wuv05）的交付对照图：设计页原型（proto.html?screen=b2-…）和真软件同一个状态，左原型、右软件拼成一张，
 * 天青、深湖各一组；「在这一页里找」在文档、白板、PDF、网页里的样子（原型没有这几屏）单独截。
 * 只在截交付图时跑：CN_SHOTS=目录（没给就跳过）。软件照常 CN_E2E 测试模式；原型和拼图在同一个 Electron 里另开看不见的窗口画。
 *   CN_SHOTS=/private/tmp/canvas-notes-build4/wuv05-b2 npx playwright test e2e/wuv05-b2-shots.spec.ts
 */
import { expect, test, type Page } from '@playwright/test'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { acts, launch, pane, rail, type Running } from './app'
import { MAP2_OPEN, MAP_PATH as PATH, map2Files } from './fixtures/mindmap-b2'
import { LECTURE } from './fixtures/pdf'

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

const ROT = `<svg xmlns="http://www.w3.org/2000/svg" width="176" height="132" viewBox="0 0 176 132"><rect width="176" height="132" fill="#fbfaf6"/><g stroke="#c9c4b8" stroke-width="1"><path d="M88 10V122M20 66H156"/></g><g fill="none" stroke-width="3" stroke-linecap="round"><path d="M88 66L140 66" stroke="#4f86a8"/><path d="M88 66L125 29" stroke="#c0784a"/><path d="M118 66A30 30 0 0 0 109 45" stroke="#5d9460" stroke-width="2"/><path d="M104 41l6 3-1 7" stroke="#5d9460" stroke-width="2"/></g><text x="120" y="82" font-family="Helvetica" font-size="13" fill="#4f86a8">v</text><text x="128" y="26" font-family="Helvetica" font-size="13" fill="#c0784a">Tv</text><text x="112" y="58" font-family="Helvetica" font-size="12" fill="#5d9460">θ</text></svg>`

/** 原型第二批那一份：备注、链接、「旋转」上一张图 */
const BASE = MAP2_OPEN.replace('    - 旋转 <!-- box=0.073,0.591,0.072,0.068 -->', '    - 旋转 ![旋转](../../附件/导图/旋转.svg) <!-- box=0.073,0.591,0.072,0.068 img-w=88 -->')
/** 再加上外框、概要、联系线（原型 b2rich） */
const RICH = BASE.replace('白板样式: 导图\n', '白板样式: 导图\n导图联系线:\n  - k1 -> k2 "求导也能写成矩阵"\n')
  .replace('img-w=88 -->', 'frame=3 frame-title="都能写成矩阵" img-w=88 -->')
  .replace('    - T(u+v)=T(u)+T(v) <!-- box=0.075,0.074,0.232,0.066 -->', '    - T(u+v)=T(u)+T(v) <!-- box=0.075,0.074,0.232,0.066 sum=2 sum-text="这两条合起来就是「线性」" -->')
  .replace('    - 求导 d/dx <!-- box=0.207,0.882,0.142,0.068 -->', '    - 求导 d/dx <!-- box=0.207,0.882,0.142,0.068 id=k1 -->')
  .replace('    - 列 = 基向量的像 <!-- box=0.712,0.061,0.202,0.066 -->', '    - 列 = 基向量的像 <!-- box=0.712,0.061,0.202,0.066 id=k2 -->')
const FLOATS = BASE + '- 期中考到第 3 讲 <!-- at=330,-330 -->\n- 问助教：秩和维数是一回事吗 <!-- at=470,250 -->\n'
const withProp = (t: string, line: string) => t.replace('白板样式: 导图\n', `白板样式: 导图\n${line}\n`)

const SCREENS = ['b2-note', 'b2-find', 'b2-link', 'b2-export', 'b2-multi', 'b2-frame', 'b2-float', 'b2-img', 'b2-pal', 'b2-ink', 'b2-fish', 'b2-time', 'b2-menu', 'b2-down'] as const
type Screen = (typeof SCREENS)[number]
const TITLE: Record<Screen, string> = {
  'b2-note': '① 备注',
  'b2-find': '② 在导图里找（⇧⌘F）',
  'b2-link': '③ 链接和链接卡',
  'b2-export': '④ 导出',
  'b2-multi': '⑤ 多选和操作条',
  'b2-frame': '⑥⑨ 外框、概要、联系线',
  'b2-float': '⑦ 浮动主题',
  'b2-img': '⑧ 图片挂在主题上',
  'b2-pal': '⑩ 配色「彩虹」',
  'b2-ink': '⑩ 墨线 + 线条',
  'b2-fish': '⑪ 鱼骨',
  'b2-time': '⑪ 时间线',
  'b2-menu': '⑩⑪ 布局菜单（配色、骨架、五种摆法）',
  'b2-down': '向下展开 + 外框、概要、联系线',
}

const board = (page: Page) => pane(page).getByTestId('board')
const esc = (s: string) => s.replace(/[()+=.*?[\]\\^$|]/g, '\\$&')
const node = (page: Page, text: string) => board(page).locator('.mm-node:not(.sumt)', { has: page.locator('.t', { hasText: new RegExp(`^${esc(text)}$`) }) })

async function shotApp(run: Running, file: string) {
  await run.page.waitForTimeout(700)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(file, Buffer.from(b64, 'base64'))
}

let server: Server
let base: string
test.beforeAll(async () => {
  server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end('<title>线性映射</title><body style="font:16px -apple-system,sans-serif;padding:24px;line-height:1.7"><h1>线性映射</h1><p>矩阵是线性映射在一组基下的样子：把每个基向量的像排成一列一列，矩阵就写出来了。</p><p>换一组基，同一个线性映射的矩阵也跟着换。</p><p>复合两个线性映射，就是把它们的矩阵乘起来。</p></body>')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
test.afterAll(() => server.close())

for (const [tone, skin, theme] of [
  ['天青', 'sky', 'light'],
  ['深湖', 'petrol', 'dark'],
] as const) {
  test(`对照图（${tone}）：原型和软件同一个状态并排；在这一页里找在各页面的样子`, async () => {
    test.setTimeout(420_000)
    mkdirSync(DIR!, { recursive: true })
    const look = (vault: string) => {
      const ud = join(dirname(vault), 'user-data')
      mkdirSync(ud, { recursive: true })
      writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin, frame: 'b', winBg: 'aurora' } }))
    }
    const files = {
      ...map2Files(BASE),
      '附件/导图/旋转.svg': ROT,
      '线代复习.md': '# 线代复习\n\n矩阵乘法就是线性映射的复合。\n\n同一个矩阵，换一组基写出来不一样。\n\n最后一句：矩阵。\n',
      '复习白板.md': '---\ntype: board\n---\n# 复习白板\n\n## 第一列\n\n讲矩阵乘法的一张卡。\n\n一张别的卡。\n\n## 第二列\n\n又一个矩阵。\n',
      '课程/线代/第3讲.pdf': LECTURE,
    }
    const run = await launch(files, { CN_AI_FAKE: '1' }, look)
    const { page } = run
    const app = (s: string) => join(DIR!, `软件-${s}-${tone}.png`)
    /** 换一份导图（外面改了文件，软件跟着重读） */
    const load = async (text: string, count: number) => {
      writeFileSync(join(run.vault, PATH), text)
      await expect(board(page).locator('.mm-node:not(.sumt)')).toHaveCount(count)
      await page.waitForTimeout(300)
    }
    const rest = async () => {
      const b = (await board(page).boundingBox())!
      await page.mouse.move(b.x + b.width - 30, b.y + b.height - 30)
    }
    const deselect = async () => {
      await board(page).getByTestId('mindmap').focus()
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
    }
    try {
      await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
      await expect.poll(() => page.evaluate(() => innerHeight)).toBe(887)
      await page.locator('.nav .si', { hasText: /^学习笔记/ }).first().click()
      await page.locator('.nav .si', { hasText: /^导图 11-22/ }).first().click()
      await expect(board(page).locator('.mm-node:not(.sumt)')).toHaveCount(17)
      await page.keyboard.press('Meta+Backslash')
      await page.waitForTimeout(500)

      // ① 备注弹层开着
      await node(page, '秩-零化度定理').getByTestId('map-note-icon').click()
      await expect(page.getByTestId('map-note')).toBeVisible()
      await shotApp(run, app('b2-note'))
      await page.keyboard.press('Escape')

      // ② 找「矩阵」第 2 处（「矩阵表示」收着）
      await load(BASE.replace('<!-- box=0.655,0.189,0.159,0.082 -->', '<!-- box=0.655,0.189,0.159,0.082 fold -->'), 14)
      await node(page, '线性映射').click()
      await page.keyboard.press('Meta+Shift+F')
      await page.keyboard.type('矩阵')
      await page.keyboard.press('Enter')
      await expect(board(page).getByTestId('find-count')).toHaveText('2/4')
      await rest()
      await shotApp(run, app('b2-find'))
      // 「在哪」的框
      const where: [string, { x: number; y: number; width: number; height: number }][] = [
        ['找的条（⇧⌘F，全软件同一个）：右上角，「2/4」、上一个下一个、也找备注、关掉；下面一行说这一处在哪', (await board(page).getByTestId('find-bar').boundingBox())!],
        ['当前那一处：外圈强调色、选中；找到的字铺淡底；这一处在备注里，备注小图标亮着', (await node(page, '列 = 基向量的像').boundingBox())!],
        ['收着的「矩阵表示」：里面有找到的，临时展开（圆点变虚线），关掉找就收回，不写文件', (await node(page, '矩阵表示').locator('.fold').boundingBox())!],
        ['链接：只露名字，强调色下划线；指着停一下出链接卡', (await node(page, '详见 第3讲 矩阵乘法').boundingBox())!],
        ['标签条「布局 ▾」：五种摆法、配色、骨架都在这一个菜单里；「⋯」里导出图片、PDF、OPML', (await page.getByTestId('tab-acts').getByTestId('map-layout').boundingBox())!],
      ]
      await shotApp(run, join(DIR!, `.where-src-${tone}.png`))
      await page.keyboard.press('Escape')
      await load(BASE, 17)

      // ③ 链接卡
      await node(page, '详见 第3讲 矩阵乘法').getByTestId('map-link').hover()
      await expect(page.getByTestId('map-link-card')).toBeVisible()
      await shotApp(run, app('b2-link'))
      await rest()
      await page.waitForTimeout(400)

      // ④ 导出弹窗
      await board(page).getByTestId('mindmap').focus()
      await page.keyboard.press('Meta+k')
      await page.keyboard.type('导出导图')
      await page.getByRole('dialog', { name: '搜索和命令' }).getByRole('option', { name: /导出导图…/ }).click()
      await expect(page.getByTestId('map-export')).toBeVisible()
      await page.getByTestId('map-export-fmt').getByRole('radio', { name: 'PNG 图片' }).click()
      await page.getByTestId('map-export-scale').getByRole('radio', { name: '2倍' }).click()
      await expect(page.getByTestId('map-export-preview').locator('img')).toBeVisible()
      await page.waitForTimeout(500)
      await shotApp(run, app('b2-export'))
      await page.keyboard.press('Escape')

      // ⑤ 多选三个
      await node(page, 'ker T 映到 0').click()
      await node(page, 'im T 所有的像').click({ modifiers: ['Meta'] })
      await node(page, '秩-零化度定理').click({ modifiers: ['Meta'] })
      await expect(board(page).getByTestId('map-selbar')).toBeVisible()
      await rest()
      await shotApp(run, app('b2-multi'))
      await deselect()

      // ⑥⑨ 外框、概要、联系线（选中联系线）
      await load(RICH, 17)
      await board(page).getByTestId('map-rel').first().dispatchEvent('pointerdown')
      await expect(board(page).getByTestId('map-rel-handle')).toBeVisible()
      await rest()
      await shotApp(run, app('b2-frame'))
      await deselect()

      // ⑦ 浮动主题（选中右下那个）
      await load(FLOATS, 19)
      await node(page, '问助教：秩和维数是一回事吗').click()
      await rest()
      await shotApp(run, app('b2-float'))
      await deselect()

      // ⑧ 图片（选中「旋转」）
      await load(BASE, 17)
      await node(page, '旋转').click()
      await rest()
      await shotApp(run, app('b2-img'))
      await deselect()

      // ⑩ 彩虹；墨线 + 线条
      await load(withProp(BASE, '导图配色: 彩虹'), 17)
      await rest()
      await shotApp(run, app('b2-pal'))
      await load(withProp(BASE, '导图配色: 墨线\n导图骨架: 线条'), 17)
      await rest()
      await shotApp(run, app('b2-ink'))
      // ⑪ 鱼骨、时间线
      await load(withProp(BASE, '导图布局: 鱼骨'), 17)
      await rest()
      await shotApp(run, app('b2-fish'))
      await load(withProp(BASE, '导图布局: 时间线'), 17)
      await rest()
      await shotApp(run, app('b2-time'))
      // 布局菜单开着（彩虹）
      await load(withProp(BASE, '导图配色: 彩虹'), 17)
      await page.getByTestId('tab-acts').getByTestId('map-layout').click()
      await expect(page.getByTestId('map-layout-menu')).toBeVisible()
      await shotApp(run, app('b2-menu'))
      await page.keyboard.press('Escape')
      // 向下 + 外框、概要、联系线
      await load(withProp(RICH, '导图布局: 向下'), 17)
      await rest()
      await shotApp(run, app('b2-down'))

      // 在这一页里找：文档、白板、PDF、网页（原型没有这几屏，单独截）
      await page.keyboard.press('Meta+o')
      await page.keyboard.type('线代复习')
      await page.waitForTimeout(150)
      await page.keyboard.press('Enter')
      await pane(page).locator('.cm-content').click()
      await page.keyboard.press('Meta+Shift+F')
      await page.keyboard.type('矩阵')
      await page.keyboard.press('Enter')
      await shotApp(run, join(DIR!, `找-文档-${tone}.png`))
      await page.keyboard.press('Escape')
      await page.keyboard.press('Meta+o')
      await page.keyboard.type('复习白板')
      await page.waitForTimeout(150)
      await page.keyboard.press('Enter')
      await pane(page).getByTestId('doc-board').focus()
      await page.keyboard.press('Meta+Shift+F')
      await page.keyboard.type('矩阵')
      await shotApp(run, join(DIR!, `找-白板-${tone}.png`))
      await page.keyboard.press('Escape')
      await page.keyboard.press('Meta+k')
      await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
      await page.locator('.pal-row', { hasText: '第3讲' }).first().click()
      await expect(page.locator('.pdfpane:not([hidden]) .pdfpage[data-page="1"] canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
      await page.getByTestId('pdf-view').focus()
      await page.keyboard.press('Meta+Shift+F')
      await page.keyboard.type('rotated')
      await expect(page.getByTestId('find-count')).toHaveText('1/2')
      await page.waitForTimeout(1200)
      await shotApp(run, join(DIR!, `找-PDF-${tone}.png`))
      await page.keyboard.press('Escape')
      await rail(page).getByRole('button', { name: '网页' }).click()
      const web = page.getByRole('complementary', { name: '网页' })
      const addr = web.getByRole('textbox', { name: '网址' })
      await addr.fill(`${base}/a`)
      await addr.press('Enter')
      await expect(web.getByRole('tablist', { name: '网页标签' }).getByRole('tab').first()).toContainText('线性映射')
      const wb = (await web.locator('webview.on').boundingBox())!
      await page.mouse.click(wb.x + 20, wb.y + 20)
      await page.keyboard.press('Meta+Shift+F')
      await page.keyboard.type('矩阵')
      await expect(web.getByTestId('find-count')).toHaveText(/\/\d/)
      await page.waitForTimeout(500)
      await shotApp(run, join(DIR!, `找-网页-${tone}.png`))

      // 原型：同样 1440 × 887，每个画面截一张
      for (const s of SCREENS) await render(run, `${pathToFileURL(PROTO).href}?screen=${s}&theme=${theme}`, 1440, 887, join(DIR!, `原型-${s}-${tone}.png`), 1200)
      // 拼：左原型、右软件
      for (const s of SCREENS) {
        const html = join(DIR!, `.pair-${s}-${tone}.html`)
        writeFileSync(
          html,
          `<!doctype html><meta charset="utf-8"><body style="margin:0;background:${theme === 'dark' ? '#101418' : '#f4f3f0'};font:22px -apple-system,'PingFang SC',sans-serif;color:${theme === 'dark' ? '#ddd' : '#222'}">` +
            `<div style="display:flex;gap:20px;height:46px;align-items:center;padding:0 20px"><div style="width:1440px">原型 · ${TITLE[s]} · ${tone}</div><div style="width:1440px">软件 · ${TITLE[s]} · ${tone}</div></div>` +
            `<div style="display:flex;gap:20px;padding:0 20px 20px"><img src="原型-${s}-${tone}.png" style="width:1440px;height:887px"><img src="软件-${s}-${tone}.png" style="width:1440px;height:887px"></div></body>`,
        )
        await render(run, pathToFileURL(html).href, 2940, 953, join(DIR!, `并排-${s}-${tone}.png`), 500)
        rmSync(html)
      }
      // 「在哪」：在导图里找的那一屏上画红框和编号，右边写每个框是什么
      const pad = 6
      const boxes = where.map(([, b], i) => `<div style="position:absolute;left:${b.x - pad}px;top:${b.y - pad}px;width:${b.width + pad * 2}px;height:${b.height + pad * 2}px;border:3px solid #d42020;border-radius:6px"><b style="position:absolute;left:-14px;top:-14px;width:26px;height:26px;border-radius:50%;background:#d42020;color:#fff;font:600 15px/26px -apple-system;text-align:center">${i + 1}</b></div>`).join('')
      const notes = where.map(([t], i) => `<li style="margin:0 0 14px"><b style="display:inline-block;width:26px;height:26px;border-radius:50%;background:#d42020;color:#fff;text-align:center;line-height:26px;margin-right:8px">${i + 1}</b>${t}</li>`).join('')
      const whereHtml = join(DIR!, `.where-${tone}.html`)
      writeFileSync(
        whereHtml,
        `<!doctype html><meta charset="utf-8"><body style="margin:0;display:flex;gap:24px;padding:20px;background:#f4f3f0;font:20px/1.5 -apple-system,'PingFang SC',sans-serif;color:#222"><div style="position:relative;width:1440px;height:887px;flex:none"><img src=".where-src-${tone}.png" style="width:1440px;height:887px;display:block">${boxes}</div><ol style="list-style:none;margin:0;padding:8px 0;width:460px">${notes}</ol></body>`,
      )
      await render(run, pathToFileURL(whereHtml).href, 1968, 927, join(DIR!, `在哪-${tone}.png`), 500)
      rmSync(whereHtml)
      rmSync(join(DIR!, `.where-src-${tone}.png`))
    } finally {
      await run.close()
    }
  })
}
