#!/usr/bin/env node
// 官网和 README 的截图：用真软件、临时库（冰岛自驾的样本笔记）截，存进 website/shots/。
//   先构建：cd apps/notes && npx electron-vite build
//   node scripts/site-shots.mjs            截全部
//   node scripts/site-shots.mjs board doc  只截这几张
// 测试实例：临时库、临时设置目录、窗口在屏幕外、不碰辅助功能权限、AI 用测试引擎（CN_AI_FAKE=1，不调模型、走真的工具）。
// 网页面板里的文章是本机给的（拦下 example.com 的请求），不联网。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const APP = path.join(ROOT, 'apps/notes')
const OUT = path.join(ROOT, 'website/shots')
const COVERS = path.join(APP, 'src/renderer/assets/covers')
const require = createRequire(path.join(APP, 'package.json'))
const { _electron: electron } = require('@playwright/test')
const electronPath = require('electron')

const only = process.argv.slice(2)
fs.mkdirSync(OUT, { recursive: true })

/* ---------------- 样本库：冰岛自驾 ---------------- */
const BOARD = `---
type: board
color: #4A7FA7
links:
  - k1 -> k6
  - k4 -> k7
---
十天环岛，二月底出发，冬天开一号公路。

<!-- card id=k1 x=90 y=30 w=240 -->
## 出发前先定
租**四驱**，冬天走一号公路要防滑钉胎。每天开车不超过 4 小时，天黑得早。

<!-- card id=k2 x=90 y=230 w=240 -->
**还没订的**
- [x] 机票
- [x] 雷克雅未克两晚
- [ ] 四驱车
- [ ] 蓝冰洞向导

<!-- card id=k3 x=360 y=30 w=270 -->
![柯克朱费尔山](附件/kirkjufell.jpg)
—— [冰岛摄影笔记](https://example.com/iceland/photos)

<!-- card id=k4 x=360 y=330 w=270 -->
> Ice caves are only safe in winter. Always go with a certified guide; entrances move every year.
—— [Ice caves in Iceland](https://example.com/iceland/ice-caves)

<!-- card id=k5 x=90 y=440 w=170 -->
#4A7FA7 冰川蓝

<!-- column id=c1 x=660 y=30 w=250 title="极光看哪两晚" -->
<!-- card id=k6 in=c1 -->
3 月 1 日 · 维克，云量预报 20%

<!-- card id=k7 in=c1 -->
3 月 3 日 · 霍芬，看 [[极光预报]] 再定

<!-- card id=k8 in=c1 -->
![冰河湖](附件/icebergs.jpg)

<!-- card id=k9 x=940 y=80 w=180 -->
[[住宿]]

<!-- card id=k10 x=940 y=180 w=180 -->
[[逐日行程]]
`
const LODGING = `---
type: board
color: #A8775A
---
<!-- card id=a x=60 y=60 w=260 -->
雷克雅未克 · 老港口边的公寓，两晚

<!-- card id=b x=360 y=60 w=260 -->
维克 · 黑沙滩旁的农舍，能看极光
`
const DAYS = `---
type: board
color: #6E8B5B
---
<!-- column id=c1 x=110 y=30 w=260 title="南岸" -->
<!-- card id=a in=c1 -->
D1 雷克雅未克 → 塞尔福斯

<!-- card id=b in=c1 -->
D2 黄金瀑布、间歇泉

<!-- card id=c in=c1 -->
D3 维克，黑沙滩
`
const AURORA = `# 极光预报

极光要两样都有：**太阳风够强**（KP 指数 3 以上），**天上没云**。

> 每天下午五点看冰岛气象局的云量图，白色是云，地图上没白的地方就是今晚能看的地方。
—— [Aurora forecast](https://example.com/iceland/aurora)

所以 3 月 1 日、3 月 3 日两晚先空着，到时候看 [[冰岛自驾]] 上的路线往没云的地方开。

![黄金瀑布](附件/gullfoss.jpg)
`
const TRIP = `# 冰岛十日

第一次冬天去冰岛，想把南岸和斯奈山半岛都走一遍。

## 为什么是二月
白天有七八个小时，路况比一月好，夜里还够黑，能看极光。

## 每天开多远
不超过 4 小时。冬天路上随时会封，**每天早上先看路况**再出门。

> Road conditions change by the hour in winter. Check before every drive.
—— [Driving in winter](https://example.com/iceland/winter-driving)
`
const INBOX = {
  '收件箱/租车.md': '---\ncreated: 2026-11-14 21:05\nsource: https://example.com/iceland/car-rental\n---\n冬天租车一定要四驱，雪胎是标配，问清楚有没有碎石险。\n',
  '收件箱/冰洞.md': '---\ncreated: 2026-11-14 21:10\n---\n冰洞只在冬天开放，必须跟向导进去，提前两周订。\n',
  '收件箱/极光.md': '---\ncreated: 2026-11-14 21:20\n---\n极光要看太阳风和云量，云量低于三成就值得出门。\n',
}
const CLIPS = {
  '素材/冰岛/冬季自驾.md':
    '---\ncreated: 2026-11-12 22:40\nsource: https://example.com/iceland/winter-driving\n---\n# 冬季自驾\n\n冬天的一号公路大部分时间能走，但风大的时候会临时封路。出门前看路况网站，车里带水和吃的。\n',
  '素材/冰岛/黑沙滩.md': '---\ncreated: 2026-11-13 09:12\nsource: https://example.com/iceland/black-beach\n---\n# 黑沙滩\n\n海浪很危险，不要背对大海，不要靠近水边。\n',
}

const ARTICLE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Ice caves in Iceland</title>
<style>body{margin:0;font:17px/1.7 Georgia,serif;color:#1d1d1f;background:#fff}header{padding:14px 28px;border-bottom:1px solid #eee;font:600 14px -apple-system,sans-serif;letter-spacing:.04em}
main{padding:8px 24px 28px}h1{font-size:34px;line-height:1.2;margin:8px 0 12px}.by{font:13px -apple-system,sans-serif;color:#888}img{width:100%;height:170px;object-fit:cover;border-radius:6px;margin:14px 0 4px}figcaption{font:12px -apple-system,sans-serif;color:#999}</style></head>
<body><header>TRAVEL NOTES · ICELAND</header><main><h1>Ice caves in Iceland</h1><div class="by">Winter guide · 6 min read</div>
<img src="/iceland/ice-cave.jpg" alt=""><figcaption>Inside a glacier cave in January.</figcaption>
<p id="p1">Ice caves are only safe in winter. Always go with a certified guide; entrances move every year.</p>
<p id="p2">Most tours leave from Jökulsárlón. Book at least two weeks ahead in February, and bring crampons if the company does not supply them.</p>
<p id="p3">The blue colour comes from old, dense ice that absorbs every colour except blue.</p></main></body></html>`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function makeVault(root) {
  const vault = path.join(root, '冰岛')
  const g = (...a) => execFileSync('git', ['-C', vault, ...a])
  execFileSync('git', ['init', '-q', '-b', 'main', vault])
  for (const [k, v] of [['user.name', 'Canvas Notes'], ['user.email', 'notes@example.com'], ['core.autocrlf', 'false']]) g('config', k, v)
  const write = (files) => {
    for (const [name, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(vault, name)), { recursive: true })
      fs.writeFileSync(path.join(vault, name), content)
    }
  }
  fs.mkdirSync(path.join(vault, '附件'), { recursive: true })
  for (const f of ['kirkjufell', 'icebergs', 'gullfoss']) fs.copyFileSync(path.join(COVERS, `${f}.jpg`), path.join(vault, '附件', `${f}.jpg`))
  // 几次提交，历史面板里有东西看
  const steps = [
    [{ '冰岛十日.md': TRIP }, '新建「冰岛十日」'],
    [{ ...CLIPS }, '剪藏 2 篇：冬季自驾、黑沙滩'],
    [{ '住宿.md': LODGING, '逐日行程.md': DAYS }, '新建白板「住宿」「逐日行程」'],
    [{ '冰岛自驾.md': BOARD }, '白板「冰岛自驾」加了 10 张卡片'],
    [{ '极光预报.md': AURORA }, '新建「极光预报」'],
    [{ ...INBOX }, '速记 3 条进收件箱'],
  ]
  for (const [files, msg] of steps) {
    write(files)
    execFileSync('git', ['-C', vault, 'add', '-A'])
    execFileSync('git', ['-C', vault, 'commit', '-q', '-m', msg])
  }
  return vault
}

async function launch(name, { skin = 'mint', homeStyle = 'a', winBg = 'glow', hidpi = true, env = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-shots-'))
  const vault = makeVault(root)
  const userData = path.join(root, 'user-data')
  fs.mkdirSync(userData)
  fs.writeFileSync(
    path.join(userData, 'settings.json'),
    JSON.stringify({ appearance: { followSystem: false, day: skin === 'pine' || ['black', 'deepsea'].includes(skin) ? 'mint' : skin, night: ['pine', 'black', 'deepsea'].includes(skin) ? skin : 'pine', skin, homeStyle, winBg, winBgFile: null }, autoCommitMinutes: 10, quickHint: false }),
  )
  const app = await electron.launch({
    executablePath: electronPath,
    args: [path.join(APP, 'out/main/index.js')],
    env: { ...process.env, CN_VAULT: vault, CN_USER_DATA: userData, CN_E2E: '1', CN_NO_AX: '1', CN_QUICK_KEY: 'Alt+Command+Shift+F19', CN_TRASH_DIR: path.join(root, 'trash'), CN_AI_FAKE: '1', ...env },
  })
  // 网页面板里 example.com 的文章和图片由本机给
  await app.evaluate(
    async ({ session, net }, { article, covers }) => {
      const fs = process.mainModule.require('node:fs')
      session.fromPartition('persist:web').protocol.handle('https', (req) => {
        const u = new URL(req.url)
        if (u.hostname !== 'example.com') return net.fetch(req, { bypassCustomProtocolHandlers: true })
        if (u.pathname.endsWith('.jpg')) return new Response(fs.readFileSync(`${covers}/${u.pathname.split('/').pop()}`), { headers: { 'content-type': 'image/jpeg' } })
        return new Response(article, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      })
    },
    { article: ARTICLE, covers: COVERS },
  )
  const page = await app.firstWindow()
  await page.locator('.vault b').waitFor()
  // 截 2 倍图（窗口在屏幕外，默认按 1 倍画）
  if (hidpi) {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false })
  }
  await sleep(800)
  return {
    app,
    page,
    vault,
    async shot(file) {
      await sleep(400)
      const p = path.join(OUT, `${file}.png`)
      if (hidpi) await page.screenshot({ path: p })
      // 有网页的那张：Playwright 截的图里 webview 会按两倍画，改用 Electron 自己拼好的整窗截图
      else fs.writeFileSync(p, Buffer.from(await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows().find((w) => w.isVisible()).webContents.capturePage()).toPNG().toString('base64')), 'base64'))
      // 官网用 JPEG：宽 2160（1080 的两倍），质量 82，一张两三百 KB
      const jpg = p.replace(/\.png$/, '.jpg')
      execFileSync('sips', ['-Z', '2160', '-s', 'format', 'jpeg', '-s', 'formatOptions', '82', p, '--out', jpg], { stdio: 'ignore' })
      fs.rmSync(p)
      console.log('截好', path.relative(ROOT, jpg))
    },
    async close() {
      await app.close()
      fs.rmSync(root, { recursive: true, force: true })
    },
  }
}

const nav = (page, title) => page.locator('.nav .si').filter({ has: page.locator('.truncate', { hasText: new RegExp(`^${title}$`) }) }).click()
const rail = (page) => page.getByRole('navigation', { name: '右栏' })
const pane = (page) => page.locator('.pane:not([hidden])')
const web = (page) => page.getByRole('complementary', { name: '网页' })
const guest = (page, code) => page.evaluate((c) => document.querySelector('webview').executeJavaScript(c), code)

async function openWeb(page, url) {
  await rail(page).getByRole('button', { name: '网页' }).click()
  const addr = web(page).getByRole('textbox', { name: '网址' })
  await addr.fill(url)
  await addr.press('Enter')
  await web(page).locator('webview').waitFor()
  for (let i = 0; i < 50 && (await guest(page, 'document.readyState').catch(() => '')) !== 'complete'; i++) await sleep(200)
  await sleep(600)
}
async function selectPara(page, id) {
  const w = await web(page).locator('webview').boundingBox()
  const r = JSON.parse(await guest(page, `JSON.stringify(document.getElementById('${id}').getBoundingClientRect())`))
  await page.mouse.click(w.x + r.x + r.width / 2, w.y + r.y + r.height / 2, { clickCount: 3 })
  await sleep(500)
}

const SHOTS = {
  // 首屏：白板（浅、深）
  async board() {
    for (const [skin, file] of [['mint', 'board-light'], ['pine', 'board-dark']]) {
      const r = await launch(file, { skin })
      await nav(r.page, '冰岛自驾')
      await pane(r.page).getByTestId('board').waitFor()
      await sleep(800)
      await r.shot(file)
      await r.close()
    }
  },
  // 白板 + 网页：选中一段，剪刀工具条出来
  async clip() {
    const r = await launch('clip', { skin: 'mint', hidpi: false })
    await nav(r.page, '冰岛自驾')
    await pane(r.page).getByTestId('board').waitFor()
    await openWeb(r.page, 'https://example.com/iceland/ice-caves')
    await selectPara(r.page, 'p2')
    await r.shot('clip')
    await r.close()
  },
  // 文档（米白主题：文档是一张纸）
  async doc() {
    const r = await launch('doc', { skin: 'cream' })
    await nav(r.page, '极光预报')
    await sleep(800)
    // 光标放到正文里（停在标题行时会露出 # 号）
    await pane(r.page).locator('.cm-line', { hasText: '所以 3 月 1 日' }).click()
    await r.page.keyboard.press('End')
    await r.shot('doc')
    await r.close()
  },
  // AI 在白板上动手：加卡片、排整齐，一次提交可撤回
  async ai() {
    const r = await launch('ai', { skin: 'mint' })
    await nav(r.page, '逐日行程')
    await pane(r.page).getByTestId('board').waitFor()
    await r.page.keyboard.press('Meta+j')
    const box = r.page.getByRole('complementary', { name: 'AI 对话' }).getByRole('textbox', { name: '问 AI' })
    await box.fill('在白板上加卡片「D4 冰河湖」「D5 蓝冰洞」「D6 霍芬」，再按列排整齐')
    await box.press('Enter')
    await r.page.getByTestId('ai-change').waitFor({ timeout: 30_000 })
    await sleep(800)
    await r.shot('ai')
    await r.close()
  },
  // ⌘F 搜索
  async search() {
    const r = await launch('search', { skin: 'mint' })
    await nav(r.page, '冰岛十日')
    await sleep(500)
    await r.page.keyboard.press('Meta+f')
    await r.page.keyboard.type('极光')
    await sleep(600)
    await r.shot('search')
    await r.close()
  },
  // Git 历史
  async history() {
    const r = await launch('history', { skin: 'mint' })
    await nav(r.page, '冰岛自驾')
    await rail(r.page).getByRole('button', { name: '历史' }).click()
    await sleep(800)
    await r.shot('history')
    await r.close()
  },
  // 梦游：现在梦游 → 报告
  async dream() {
    const r = await launch('dream', { skin: 'pine' })
    const card = r.page.getByTestId('dream-card')
    await card.getByRole('button', { name: '现在梦游' }).click()
    await card.getByRole('button', { name: '看报告' }).waitFor({ timeout: 60_000 })
    await card.getByRole('button', { name: '看报告' }).click()
    await sleep(800)
    await r.shot('dream')
    await r.close()
  },
  // 首页 A（封面）、首页 B（深海蓝玻璃）、外观设置里的六套主题
  async home() {
    let r = await launch('home-a', { skin: 'mint' })
    await r.shot('home-a')
    await r.close()
    r = await launch('home-b', { skin: 'deepsea', homeStyle: 'b', winBg: 'aurora' })
    await r.shot('home-b')
    await r.close()
    r = await launch('themes', { skin: 'cream' })
    await r.page.locator('.sfoot').getByRole('button', { name: '外观' }).click()
    await sleep(800)
    await r.shot('themes')
    await r.close()
  },
}

for (const [name, fn] of Object.entries(SHOTS)) if (!only.length || only.includes(name)) await fn()
