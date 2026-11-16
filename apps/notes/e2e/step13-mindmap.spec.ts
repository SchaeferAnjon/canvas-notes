import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { gitStatus, launch, pane, type Running, acts, tabOn } from './app'

// 拍手写导图（task-xfrgu 第 1 段，方向 B「先核对再放」+ A 的长出来动画）：
// 拍照窗口（Chromium 的假摄像头当「Mac 摄像头」）→ 核对 → 做成白板导图（节点一个个长出来）→ 白板上改 → 属性。
// AI 认照片用假引擎（CN_AI_FAKE=1，main/mindmap/fake.ts 的固定回答：线性代数第 3 讲，一个节点拿不准）。

const PHOTO = join(__dirname, 'fixtures/handwritten-map.jpg')
const SHOTS = process.env.CN_SHOTS_DIR

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`) })
}

const sheet = (page: Page) => page.getByRole('dialog', { name: /拍一张导图|核对认出来的/ })
const board = (page: Page) => pane(page).getByTestId('board')
const node = (page: Page, text: string) => board(page).locator('.mm-node', { has: page.locator('.t', { hasText: new RegExp(`^${text.replace(/[()+=]/g, '\\$&')}$`) }) })

function files(vault: string, dir: string): string[] {
  return existsSync(join(vault, dir)) ? readdirSync(join(vault, dir)) : []
}

/** 菜单「文件 › 拍一张导图」：真的点菜单项（Playwright 的按键到不了系统菜单） */
async function menuOpen(run: Running) {
  await run.app.evaluate(({ Menu }) => {
    const file = Menu.getApplicationMenu()!.items.find((i) => i.label === '文件')!
    file.submenu!.items.find((i) => i.label === '拍一张导图')!.click()
  })
}

/** 在拍照窗口里放下一个文件（和从访达拖进来一样的 drop 事件） */
async function dropFile(page: Page, file: string, name: string, type = 'image/jpeg') {
  const b64 = readFileSync(file).toString('base64')
  await sheet(page).evaluate(
    (el, { b64, name, type }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      const dt = new DataTransfer()
      dt.items.add(new File([bytes], name, { type }))
      for (const t of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }))
    },
    { b64, name, type },
  )
}

const env = (airdrop: string) => ({ CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '1500', CN_AIRDROP_DIR: airdrop })
const COURSES = { '课程/线性代数/第3讲 线性映射.md': '# 第3讲 线性映射\n', '课程/概率论/第1讲.md': '# 第1讲\n' }

function darkSettings(vault: string) {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: 'pine' } }))
}

for (const tone of ['light', 'dark'] as const) {
  test(`拍 → 核对 → 做成白板导图，节点一个个长出来（${tone === 'light' ? '浅色' : '深色'}）`, async () => {
    const airdrop = mkdtempSync(join(tmpdir(), 'cn-airdrop-'))
    const run = await launch(COURSES, env(airdrop), tone === 'dark' ? darkSettings : undefined)
    const { page, vault } = run
    try {
      // ⌘K 里「拍一张导图」
      await page.keyboard.press('Meta+k')
      await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('拍一张导图')
      await page.keyboard.press('Enter')
      await expect(sheet(page)).toHaveAccessibleName('拍一张导图')
      await expect(sheet(page).locator('.mm-steps [aria-current="step"]')).toHaveText('1拍')

      // 第一次默认 iPhone：测试机上没有，说清楚、「拍」是灰的
      const vf = sheet(page).getByTestId('viewfinder')
      await expect(vf).toContainText('iPhone 没连上')
      await expect(sheet(page).getByRole('button', { name: /^拍/ })).toBeDisabled()
      // 桌上视角：列不出来，窗口里照实说
      await sheet(page).getByRole('tab', { name: '桌上视角' }).click()
      await expect(sheet(page).getByTestId('desk-unsupported')).toContainText('这台 Mac 用不了桌上视角')
      await expect(sheet(page).getByTestId('desk-unsupported')).toContainText('这个软件读不到那一路画面')
      await shot(page, `cam-desk-${tone}`)

      // Mac 摄像头（假摄像头）：有实时画面
      await sheet(page).getByRole('tab', { name: 'Mac 摄像头' }).click()
      await expect(vf.locator('.live')).toHaveText('实时 · Mac 摄像头')
      await expect.poll(() => vf.locator('video').evaluate((v: HTMLVideoElement) => v.videoWidth)).toBeGreaterThan(0)
      await expect(vf.locator('.corner')).toHaveCount(4)
      await shot(page, `cam-live-${tone}`)
      // 空格拍：画面定住
      await page.keyboard.press(' ')
      await expect(vf.locator('.live')).toHaveText('拍好了')
      await expect(vf.locator('img')).toBeVisible()
      await expect(sheet(page).locator('.mm-hint')).toHaveText('字看得清就用这张；糊了、反光就重拍。')
      // 重拍回到实时画面；换成拖进来的照片（假摄像头拍出来的不像导图，后面用手写导图的照片）
      await sheet(page).getByRole('button', { name: '重拍' }).click()
      await expect(vf.locator('.live')).toHaveText('实时 · Mac 摄像头')
      await dropFile(page, PHOTO, '导图.jpg')
      await expect(vf.locator('.live')).toHaveText('从照片选的')
      await expect.poll(() => vf.locator('img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(1280)
      await shot(page, `cam-shot-${tone}`)

      // ② 核对：先认（扫描线），认完出大纲
      await sheet(page).getByRole('button', { name: '用这张' }).click()
      await expect(sheet(page)).toHaveAccessibleName('核对认出来的')
      await expect(sheet(page).locator('.mm-reading')).toContainText('正在认这张导图')
      await expect(sheet(page).locator('.mm-photo .scan')).toBeVisible()
      await shot(page, `check-reading-${tone}`)
      const rows = sheet(page).locator('.mm-rows .or')
      await expect(rows).toHaveCount(15)
      await expect(sheet(page).locator('.mm-photo .bx')).toHaveCount(15)
      await expect(sheet(page).locator('.mm-ft .help')).toHaveText('认出 15 个节点，1 个拿不准 · 放上白板后也能改')
      const unsure = rows.filter({ has: page.locator('.tag-yel') })
      await expect(unsure).toHaveCount(1)
      await expect(unsure.locator('input')).toHaveValue('秩-零化渡定理')
      // 一打开就落在拿不准的那行，照片上那一块加粗
      await expect(unsure.locator('input')).toBeFocused()
      await expect(sheet(page).locator('.mm-photo .bx.on.unsure')).toHaveCount(1)
      await shot(page, `check-${tone}`)

      // 点别的行：照片上换成那一块
      await rows.filter({ has: page.locator('input[value="矩阵表示"]') }).locator('input').click()
      await expect(sheet(page).locator('.mm-photo .bx.on')).toHaveAttribute('title', '矩阵表示')
      // 改拿不准的字：黄色去掉
      await unsure.locator('input').fill('秩-零化度定理')
      await expect(sheet(page).locator('.tag-yel')).toHaveCount(0)
      await expect(sheet(page).locator('.mm-ft .help')).toHaveText('认出 15 个节点，都核对过了 · 放上白板后也能改')
      // 回车加一行同级，Tab 缩到上一行下面
      const last = rows.filter({ has: page.locator('input[value="求导 d/dx"]') }).locator('input')
      await last.click()
      await page.keyboard.press('Enter')
      await page.keyboard.type('积分')
      await page.keyboard.press('Tab')
      await expect(rows).toHaveCount(16)
      await expect(rows.nth(15)).toHaveCSS('padding-left', `${4 + 3 * 18}px`)

      // ③ 做成白板导图：新标签打开，节点一个个长出来
      await sheet(page).getByRole('button', { name: '做成白板导图' }).click()
      await expect(sheet(page)).toHaveCount(0)
      await expect(board(page)).toBeVisible()
      await expect(board(page).getByTestId('map-pill')).toContainText('正在放上白板')
      const shownNow = await board(page).locator('.mm-node:not(.hid)').count()
      expect(shownNow).toBeLessThan(16)
      await page.waitForTimeout(900)
      await shot(page, `map-growing-${tone}`)
      const later = await board(page).locator('.mm-node:not(.hid)').count()
      expect(later).toBeGreaterThan(shownNow)
      await expect(board(page).getByTestId('map-pill')).toHaveText('做好了，放在收件箱 · 今晚梦游时归类、起名', { timeout: 10_000 })
      await expect(board(page).locator('.mm-node:not(.hid)')).toHaveCount(16)
      await expect(board(page).getByTestId('map-photo')).toContainText('原照片 · ')
      await expect(acts(page).getByTestId('page-note')).toHaveText('收件箱 · 今晚梦游时归类、起名')
      await expect(tabOn(page)).toHaveText(/^导图 \d\d-\d\d \d\d∶\d\d$/)
      // 自己在收件箱里，不算进自己的「未整理」
      await expect(board(page).getByTestId('unsorted')).toContainText('0')
      await page.waitForTimeout(400)
      await shot(page, `map-${tone}`)

      // 文件：收件箱里一块导图白板，属性当场填好；照片在 附件/导图/；一次提交，没有没提交的
      const [md] = files(vault, '收件箱')
      expect(md).toMatch(/^导图 \d\d-\d\d \d\d∶\d\d\.md$/)
      const text = readFileSync(join(vault, '收件箱', md!), 'utf8')
      expect(text).toMatch(/^---\ntype: board\n白板样式: 导图\n类型: 导图\n课程: 线性代数\n第几讲: 3\n来源: 照片\n日期: \d{4}-\d\d-\d\d\nAI填的: 课程, 第几讲\n---\n# 导图 /)
      expect(text).toContain('](../附件/导图/')
      expect(text).toContain('- 线性映射 <!-- box=0.402,0.436,0.197,0.095 -->\n  - 定义 <!--')
      expect(text).toContain('    - 秩-零化度定理 <!-- box=0.579,0.872,0.186,0.068 -->\n')
      expect(text).toContain('    - 求导 d/dx <!-- box=0.207,0.882,0.142,0.068 -->\n      - 积分\n')
      expect(files(vault, '附件/导图')).toHaveLength(1)
      expect(execFileSync('git', ['-C', vault, 'log', '-1', '--format=%s'], { encoding: 'utf8' })).toMatch(/^拍导图：导图 \d\d-\d\d \d\d:\d\d 进收件箱/)
      expect(gitStatus(vault)).toBe('')
    } finally {
      await run.close()
    }
  })
}

test('照片从菜单打开的窗口里拖进来、粘贴、隔空投送（含 HEIC），不像导图时说清楚', async () => {
  const airdrop = mkdtempSync(join(tmpdir(), 'cn-airdrop-'))
  const run = await launch(COURSES, env(airdrop))
  const { page } = run
  try {
    await menuOpen(run)
    await expect(sheet(page)).toHaveAccessibleName('拍一张导图')
    const vf = sheet(page).getByTestId('viewfinder')

    // ⌘V 粘贴
    const b64 = readFileSync(PHOTO).toString('base64')
    await page.evaluate((b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      const dt = new DataTransfer()
      dt.items.add(new File([bytes], 'image.jpg', { type: 'image/jpeg' }))
      window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    }, b64)
    await expect(vf.locator('.live')).toHaveText('粘贴的照片')
    await expect.poll(() => vf.locator('img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(1280)

    // 隔空投送：下载文件夹里来了一张 iPhone 的 HEIC
    const heic = join(airdrop, 'IMG_2041.HEIC')
    execFileSync('/usr/bin/sips', ['-s', 'format', 'heic', PHOTO, '--out', heic + '.tmp'])
    copyFileSync(heic + '.tmp', heic)
    await expect(vf.locator('.live')).toHaveText('隔空投送来的', { timeout: 15_000 })
    await expect(sheet(page).locator('.mm-hint')).toHaveText('收到隔空投送的照片「IMG_2041.HEIC」')
    // HEIC 转成了 JPEG，界面看得到
    await expect.poll(() => vf.locator('img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(1000)
    await shot(page, 'cam-airdrop-light')

    // 不像导图的照片：说清楚，能重拍、再认一次
    await dropFile(page, PHOTO, 'not-map 风景.jpg')
    await expect(vf.locator('.live')).toHaveText('从照片选的')
    await sheet(page).getByRole('button', { name: '用这张' }).click()
    await expect(sheet(page).locator('.mm-fail')).toContainText('这张看着不像导图。', { timeout: 10_000 })
    await expect(sheet(page).getByRole('button', { name: '做成白板导图' })).toBeDisabled()
    await sheet(page).locator('.mm-fail').getByRole('button', { name: '重拍' }).click()
    await expect(sheet(page)).toHaveAccessibleName('拍一张导图')

    // 认的时候按 esc 停下
    await dropFile(page, PHOTO, '导图.jpg')
    await sheet(page).getByRole('button', { name: '用这张' }).click()
    await expect(sheet(page).locator('.mm-reading')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(sheet(page).locator('.mm-fail')).toContainText('停下了')
    // 再按 esc 关窗口；什么都没进库
    await page.keyboard.press('Escape')
    await expect(sheet(page)).toHaveCount(0)
    expect(files(run.vault, '收件箱')).toEqual([])
    expect(gitStatus(run.vault)).toBe('')
  } finally {
    await run.close()
  }
})

test('白板工具板「拍导图」拖到白板上：做好后落点放一张指向导图的卡片', async () => {
  const run = await launch({ ...COURSES, '复习.md': '---\ntype: board\n---\n# 复习\n' }, env(mkdtempSync(join(tmpdir(), 'cn-airdrop-'))))
  const { page, vault } = run
  try {
    await page.locator('.nav .si', { hasText: /^复习/ }).first().click()
    await expect(board(page)).toBeVisible()
    const btn = board(page).locator('.bpal').getByRole('button', { name: '拍导图' })
    const b = (await btn.boundingBox())!
    const wrap = (await board(page).locator('.board-wrap').boundingBox())!
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await page.mouse.move(wrap.x + 400, wrap.y + 300, { steps: 6 })
    await page.mouse.move(wrap.x + 500, wrap.y + 320, { steps: 6 })
    await page.mouse.up()
    await expect(sheet(page)).toHaveAccessibleName('拍一张导图')
    await dropFile(page, PHOTO, '导图.jpg')
    await sheet(page).getByRole('button', { name: '用这张' }).click()
    await expect(sheet(page).locator('.mm-rows .or')).toHaveCount(15)
    await sheet(page).getByRole('button', { name: '做成白板导图' }).click()
    await expect(tabOn(page)).toHaveText(/^导图 /)
    const title = (await tabOn(page).textContent())!
    await expect.poll(() => readFileSync(join(vault, '复习.md'), 'utf8'), { timeout: 10_000 }).toContain(`[[${title}]]`)
  } finally {
    await run.close()
  }
})

const MAP = `---
type: board
白板样式: 导图
类型: 导图
课程: 线性代数
第几讲: 3
来源: iPhone 拍的
日期: 2026-11-15
AI填的: 课程, 第几讲
---
# 导图 11-15 21∶40

![原照片 · 11 月 15 日 21:40 · iPhone](../附件/导图/2026-11-15-2140.jpg)

- 线性映射 <!-- box=0.402,0.436,0.197,0.095 -->
  - 定义 <!-- box=0.233,0.211,0.091,0.082 -->
    - T(u+v)=T(u)+T(v)
    - T(cv)=cT(v)
  - 矩阵表示 <!-- box=0.655,0.189,0.159,0.082 -->
    - 列 = 基向量的像
  - 核与像 <!-- box=0.669,0.675,0.125,0.082 -->
    - ker T 映到 0 <!-- box=0.812,0.567,0.164,0.064 -->
    - 秩-零化渡定理 <!-- box=0.579,0.872,0.186,0.068 unsure guesses="秩-零化度定理|秩-零化渡定理" -->
  - 例子
    - 旋转
`

test('白板上改导图：对照照片改拿不准的、Tab 加子节点、删、双击改字、拖去换父节点、撤销、收起；不改就不写盘', async () => {
  const path = '收件箱/导图 11-15 21∶40.md'
  const run = await launch({ ...COURSES, [path]: MAP, '附件/导图/2026-11-15-2140.jpg': readFileSync(PHOTO) }, env(mkdtempSync(join(tmpdir(), 'cn-airdrop-'))))
  const { page, vault } = run
  const read = () => readFileSync(join(vault, path), 'utf8')
  try {
    await page.locator('.nav .si', { hasText: /^导图 11-15/ }).first().click()
    await expect(board(page)).toBeVisible()
    await expect(board(page).locator('.mm-node')).toHaveCount(11)
    await expect(board(page).getByTestId('map-photo').locator('img')).toHaveJSProperty('complete', true)
    // 打开再关掉：一个字节都不变
    await page.waitForTimeout(500)
    expect(read()).toBe(MAP)
    expect(gitStatus(vault)).toBe('')
    // 文档视图就是大纲：行尾记框的注释藏起来
    await acts(page).getByRole('tab', { name: '文档' }).click()
    await expect(pane(page).locator('.cm-content')).toContainText('线性映射')
    await expect(pane(page).locator('.cm-content')).not.toContainText('box=0.669')
    // 属性在标题下面一张表，frontmatter 原文藏起来
    const table = pane(page).locator('.cm-props')
    await expect(table.locator('.pr')).toHaveCount(5)
    await expect(table.locator('.pr', { hasText: '课程' })).toHaveText('课程线性代数AI 填的')
    await expect(pane(page).locator('.cm-content')).not.toContainText('type: board')
    await shot(page, 'map-doc-light')
    // 点一行：露出原文，光标在那一行
    await table.locator('.pr', { hasText: '第几讲' }).click()
    await expect(pane(page).locator('.cm-content')).toContainText('第几讲: 3')
    await expect(pane(page).locator('.cm-props')).toHaveCount(0)
    await acts(page).getByRole('tab', { name: '白板' }).click()
    await expect(board(page).locator('.mm-node')).toHaveCount(11)
    expect(read()).toBe(MAP)

    // 点一个节点：照片上框出那一块
    await node(page, '矩阵表示').click()
    await expect(node(page, '矩阵表示')).toHaveClass(/sel/)
    await expect(board(page).getByTestId('photo-highlight')).toBeVisible()
    await shot(page, 'map-select-light')

    // 拿不准的：点「?」，照片框出来，挑 AI 猜的写法
    await node(page, '秩-零化渡定理').getByRole('button', { name: '对照照片改' }).click()
    const fix = page.getByRole('dialog', { name: '照片上这块写的是？' })
    await expect(fix).toContainText('AI 读成了「秩-零化渡定理」')
    await page.waitForTimeout(400)
    await shot(page, 'map-fix-light')
    await fix.getByRole('button', { name: '秩-零化度定理' }).click()
    await fix.getByRole('button', { name: /改好了/ }).click()
    await expect(fix).toHaveCount(0)
    await expect(node(page, '秩-零化度定理')).toHaveClass(/flash/)
    await expect(node(page, '秩-零化度定理').getByRole('button')).toHaveCount(0)
    await expect.poll(read).toContain('    - 秩-零化度定理 <!-- box=0.579,0.872,0.186,0.068 -->\n')

    // Tab 加子节点，直接打字
    await node(page, '定义').click()
    await page.keyboard.press('Tab')
    await page.getByRole('textbox', { name: '节点的字' }).fill('可加性')
    await page.keyboard.press('Enter')
    await expect.poll(read).toContain('    - T(cv)=cT(v)\n    - 可加性\n  - 矩阵表示')

    // 回车加同级
    await node(page, '旋转').click()
    await page.keyboard.press('Enter')
    await page.getByRole('textbox', { name: '节点的字' }).fill('投影')
    await page.keyboard.press('Enter')
    await expect.poll(read).toContain('    - 旋转\n    - 投影\n')

    // 双击改字：只动那一行
    const before = read()
    await node(page, 'ker T 映到 0').dblclick()
    await page.getByRole('textbox', { name: '节点的字' }).fill('ker T 映到零')
    await page.keyboard.press('Enter')
    await expect.poll(read).toContain('ker T 映到零')
    const diff = before.split('\n').filter((l, i) => l !== read().split('\n')[i])
    expect(diff).toEqual(['    - ker T 映到 0 <!-- box=0.812,0.567,0.164,0.064 -->'])

    // 拖「矩阵表示」到「核与像」上：换父节点，整枝跟着走
    const from = (await node(page, '矩阵表示').boundingBox())!
    const to = (await node(page, '核与像').boundingBox())!
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(to.x + 10, to.y + 10, { steps: 6 })
    await expect(node(page, '核与像')).toHaveClass(/drop/)
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 3 })
    await page.mouse.up()
    await expect.poll(read).toContain('    - 矩阵表示 <!-- box=0.655,0.189,0.159,0.082 -->\n      - 列 = 基向量的像\n  - 例子')

    // ⌘Z 撤回刚才的拖动
    await page.keyboard.press('Meta+z')
    await expect.poll(read).toContain('  - 矩阵表示 <!-- box=0.655,0.189,0.159,0.082 -->\n    - 列 = 基向量的像\n  - 核与像')

    // ⌫ 删掉「例子」整枝
    await node(page, '例子').click()
    await page.keyboard.press('Backspace')
    await expect.poll(read).not.toContain('例子')
    await expect(node(page, '旋转')).toHaveCount(0)

    // 空格收起「核与像」：孩子不画，右边一个数
    await node(page, '核与像').click()
    await page.keyboard.press(' ')
    await expect(node(page, 'ker T 映到零')).toHaveCount(0)
    await expect(node(page, '核与像').locator('.fold')).toHaveText('2')
    await page.keyboard.press(' ')
    await expect(node(page, 'ker T 映到零')).toHaveCount(1)
  } finally {
    await run.close()
  }
})

test('属性：工具栏「属性」里改课程（不再算 AI 填的）、加一个属性', async () => {
  const path = '收件箱/导图 11-15 21∶40.md'
  const run = await launch({ ...COURSES, [path]: MAP, '附件/导图/2026-11-15-2140.jpg': readFileSync(PHOTO) }, env(mkdtempSync(join(tmpdir(), 'cn-airdrop-'))))
  const { page, vault } = run
  const read = () => readFileSync(join(vault, path), 'utf8')
  try {
    await page.locator('.nav .si', { hasText: /^导图 11-15/ }).first().click()
    await expect(board(page)).toBeVisible()
    await acts(page).getByRole('button', { name: '属性' }).click()
    const pop = page.getByRole('dialog', { name: '属性' })
    await expect(pop.getByRole('combobox', { name: '类型' })).toHaveValue('导图')
    await expect(pop.getByRole('combobox', { name: '课程' })).toHaveValue('线性代数')
    await expect(pop.locator('.pr', { hasText: '课程' }).locator('.ai')).toHaveText('AI 填的')
    await expect(pop.locator('.pr', { hasText: '来源' }).locator('.ai')).toHaveText('')
    await shot(page, 'props-light')
    await pop.getByRole('combobox', { name: '课程' }).selectOption('概率论')
    await expect.poll(read).toContain('课程: 概率论\n')
    expect(read()).toContain('AI填的: 第几讲\n')
    await expect(pop.locator('.pr', { hasText: '课程' }).locator('.ai')).toHaveText('')
    await pop.getByRole('button', { name: '加一个属性' }).click()
    await pop.getByRole('textbox', { name: '属性名' }).fill('老师')
    await pop.getByRole('textbox', { name: '属性值' }).fill('王老师')
    await page.keyboard.press('Enter')
    await expect.poll(read).toContain('老师: 王老师\n---\n')
    await expect(pop.getByRole('textbox', { name: '老师' })).toHaveValue('王老师')
    // 改属性不挪文件、不改名
    expect(existsSync(join(vault, path))).toBe(true)
  } finally {
    await run.close()
  }
})
