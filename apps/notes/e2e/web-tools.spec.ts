/**
 * AI 操纵内置浏览器的工具补齐（AI网页工具）：本地测试页上把每个工具真跑一遍（下拉、勾选、单选、日期、上传、悬停菜单、按键、拖拽、滚到某段），
 * 右栏一次、中间栏一次；提交表单、登录、上传前先问用户（下一轮用户说可以才做）；「看得到」写清是哪个网页。
 * 假 AI（CN_AI_FAKE）照「网页工具：[[工具, 参数], …]」一个个调真的 MCP 工具，结果原样说出来。
 */
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, type Running, webAboveAi } from './app'
import { armMenus, openedMenu, pickMenu } from './menu'

const SHOTS = process.env.CN_SHOTS ?? ''

const ai = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
async function send(page: Page, text: string) {
  const box = ai(page).getByRole('textbox', { name: '问 AI' })
  await box.fill(text)
  await box.press('Enter')
}
/** 发一串工具，等这一问答完，回答的字 */
async function tools(page: Page, steps: [string, Record<string, unknown>][]): Promise<string> {
  const n = await ai(page).getByTestId('ai-msg').count()
  await send(page, `网页工具：${JSON.stringify(steps)}`)
  await expect(ai(page).getByTestId('ai-msg')).toHaveCount(n + 1, { timeout: 30_000 })
  const msg = ai(page).getByTestId('ai-msg').nth(n)
  // 答完：aria-busy 去掉
  await expect(msg).not.toHaveAttribute('aria-busy', 'true', { timeout: 60_000 })
  return (await msg.locator('.txt').innerText()).trim()
}

/** 测试页：表单（下拉、勾选、单选、日期、数字、时间、上传、登录、提交）、悬停菜单、按键、拖拽、很长要滚的一段 */
const PAGE = `<!doctype html><meta charset="utf-8"><title>网页工具测试页</title>
<style>
  body { font: 14px -apple-system, sans-serif; margin: 16px; }
  .menu { position: relative; display: inline-block; }
  .menu .sub { display: none; position: absolute; top: 100%; left: 0; background: #fff; border: 1px solid #ccc; padding: 4px; }
  .menu:hover .sub { display: block; }
  .fancy input { position: absolute; opacity: 0; width: 0; height: 0; }
  .fancy span { display: inline-block; padding: 2px 8px; border: 1px solid #888; border-radius: 4px; }
  .fancy input:checked + span { background: #333; color: #fff; }
  #items li { display: inline-block; padding: 6px 10px; margin: 2px; border: 1px solid #999; cursor: grab; }
  #bin { display: inline-block; width: 160px; height: 50px; border: 2px dashed #999; vertical-align: middle; }
  #modal { padding: 6px; border: 1px solid #c00; }
  #far { margin-top: 3000px; }
  #avatar-file { display: none; }
</style>
<h1>网页工具测试页</h1>
<form id="trip" onsubmit="event.preventDefault(); log('submit:trip')">
  <label>城市 <select id="city" onchange="log('city:' + this.value)"><option value="bj">北京</option><option value="sh">上海</option><option value="gz">广州</option></select></label>
  <label>标签 <select id="tags" multiple><option>海边</option><option>山里</option><option>城里</option></select></label><br>
  <label><input type="checkbox" id="agree" onchange="log('agree:' + this.checked)"> 同意条款</label>
  <label class="fancy"><input type="checkbox" id="news" onchange="log('news:' + this.checked)"><span>订阅周报</span></label><br>
  <label><input type="radio" name="ship" value="post" checked> 快递</label>
  <label><input type="radio" name="ship" value="self" onchange="log('ship:self')"> 自取</label><br>
  <label>出发日期 <input type="date" id="day" onchange="log('day:' + this.value)"></label>
  <label>人数 <input type="number" id="people" min="1" max="9"></label>
  <label>集合时间 <input type="time" id="at"></label><br>
  <label>附件 <input type="file" id="file" onchange="log('file:' + [...this.files].map((f) => f.name + ':' + f.size).join(','))"></label>
  <button type="button" id="avatar" onclick="document.getElementById('avatar-file').click()">换头像</button>
  <input type="file" id="avatar-file" onchange="log('avatar:' + [...this.files].map((f) => f.name).join(','))"><br>
  <label>备注 <input id="memo" value="原来的字"></label>
  <button type="submit">提交</button>
</form>
<form id="login" onsubmit="event.preventDefault(); log('submit:login')">
  <label>账号 <input id="user"></label> <label>密码 <input type="password" id="pw"></label> <button>登录</button>
</form>
<p><span class="menu"><button type="button">更多操作</button><span class="sub"><span role="menuitem" tabindex="0" onclick="log('menu:export')">导出 PDF</span> <span role="menuitem" tabindex="0" onclick="log('menu:print')">打印</span></span></span></p>
<p><label>快捷键框 <input id="keys"></label></p>
<div id="modal">弹出的提示（按 Esc 关掉）</div>
<ul id="items"><li draggable="true" id="i1">苹果</li><li draggable="true" id="i2">香蕉</li></ul>
<div id="bin">回收站</div>
<pre id="log"></pre>
<p id="far">第九段：目标在这里，要滚很久才看得到。</p>
<script>
  const logged = []
  function log(s) { logged.push(s); document.getElementById('log').textContent = logged.join('\\n') }
  document.getElementById('keys').addEventListener('keydown', (e) => log('key:' + (e.metaKey ? 'Meta+' : '') + (e.shiftKey ? 'Shift+' : '') + e.key))
  addEventListener('keydown', (e) => { if (e.key === 'Escape') { const m = document.getElementById('modal'); if (m) { m.remove(); log('modal:closed') } } })
  for (const li of document.querySelectorAll('#items li')) li.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', li.id))
  const bin = document.getElementById('bin')
  bin.addEventListener('dragover', (e) => e.preventDefault())
  bin.addEventListener('drop', (e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); bin.appendChild(document.getElementById(id)); log('drop:' + id) })
  addEventListener('focus', () => {}, true)
</script>`

let server: Server
let base: string
test.beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end(PAGE)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
test.afterAll(() => server.close())
// 每个工具跑一遍、每一问都是一轮真的 MCP 调用：比默认的一分钟长
test.setTimeout(240_000)

/** 网址里带 p=<哪个> 的那一页里跑一段脚本（测试看网页真的变了） */
const inPage = <T>(run: Running, which: string, code: string) =>
  run.app.evaluate(
    async ({ webContents }, a) => {
      const wc = webContents.getAllWebContents().find((w) => w.getType() === 'webview' && w.getURL().includes(`p=${a.which}`))
      if (!wc) throw new Error(`没有 p=${a.which} 的网页`)
      return wc.executeJavaScript(a.code, true)
    },
    { which, code },
  ) as Promise<T>
const logOf = (run: Running, which: string) => inPage<string>(run, which, `document.getElementById('log').textContent`)

/** 每个工具真跑一遍（page：给 AI 的 page 参数，which：网址里的 p=） */
async function everyTool(run: Running, which: string, page?: 'right' | 'center', shot?: string) {
  const snap = async (name: string) => {
    if (!SHOTS || !shot) return
    mkdirSync(SHOTS, { recursive: true })
    await run.page.screenshot({ path: join(SHOTS, `${shot}-${name}.png`) })
  }
  const p = run.page
  const at = page ? { page } : {}
  // 读：下拉框带选项、勾选框带勾没勾、日期框带种类、上传框、登录按钮标着先问
  const read = await tools(p, [['web_read', at]])
  expect(read).toContain('下拉框 城市：选着「北京」；选项：北京 / 上海 / 广州')
  expect(read).toContain('下拉框 标签（能多选）')
  expect(read).toContain('勾选框 同意条款：没勾')
  expect(read).toContain('勾选框 订阅周报：没勾')
  expect(read).toContain('单选 快递（组 ship）：选着')
  expect(read).toContain('输入框 出发日期（date）')
  expect(read).toContain('上传文件 附件')
  expect(read).toMatch(/按钮 登录 +⚠ 点了会登录，先问用户/)
  expect(read).toMatch(/按钮 提交 +⚠ 点了会提交表单，先问用户/)
  expect(read).toContain('输入框 备注：现在是「原来的字」')
  if (page) expect(read).toContain(`哪个网页：${page === 'right' ? '右栏' : '中间栏'}`)

  // 下拉、多选、勾选（藏起来的那颗点它的 label）、单选、日期、数字、时间
  const form = await tools(p, [
    ['web_select', { label: '城市', option: '上海', ...at }],
    ['web_select', { label: '标签', option: ['海边', '城里'], ...at }],
    ['web_check', { label: '同意条款', checked: true, ...at }],
    ['web_check', { label: '订阅周报', checked: true, ...at }],
    ['web_check', { label: '同意条款', checked: true, ...at }],
    ['web_check', { label: '自取', checked: true, ...at }],
    ['web_type', { ref: refOf(read, '出发日期'), text: '2026-12-01', ...at }],
    ['web_type', { ref: refOf(read, '人数'), text: '3', ...at }],
    ['web_type', { ref: refOf(read, '集合时间'), text: '07:45', ...at }],
  ])
  expect(form).toContain('【web_select】「城市」选了：上海')
  expect(form).toContain('【web_select】「标签」选了：海边、城里')
  expect(form).toContain('【web_check】「同意条款」勾上了')
  expect(form).toContain('【web_check】「订阅周报」勾上了')
  expect(form).toContain('【web_check】「同意条款」本来就勾上了，没动')
  expect(form).toContain('【web_check】「自取」选上了')
  expect(form).toContain('【web_type】填好了：2026-12-01')
  expect(form).toContain('【web_type】填好了：3')
  expect(form).toContain('【web_type】填好了：07:45')
  const state = await inPage<Record<string, unknown>>(
    run,
    which,
    `({ city: city.value, tags: [...tags.selectedOptions].map((o) => o.text), agree: agree.checked, news: news.checked, ship: document.querySelector('input[name=ship]:checked').value, day: day.value, people: people.value, at: at.value })`,
  )
  expect(state).toEqual({ city: 'sh', tags: ['海边', '城里'], agree: true, news: true, ship: 'self', day: '2026-12-01', people: '3', at: '07:45' })
  await snap('选下拉和勾选')
  // 网页自己的脚本收到了 change（同手点）
  expect(await logOf(run, which)).toContain('city:sh\nagree:true\nnews:true\nship:self\nday:2026-12-01')
  // 去掉勾；日期写错了说清楚该怎么写；单选去不掉
  const more = await tools(p, [
    ['web_check', { label: '订阅周报', checked: false, ...at }],
    ['web_check', { label: '快递', checked: false, ...at }],
  ])
  expect(more).toContain('【web_check】「订阅周报」没勾')
  expect(more).toContain('【web_check】出错：「快递」是单选，去不掉')
  expect(await tools(p, [['web_type', { ref: refOf(read, '出发日期'), text: '12月1号', ...at }]])).toContain('date 框要写成 2026-11-24 这样')
  // 写错了不动原来填好的
  expect(await inPage(run, which, 'day.value')).toBe('2026-12-01')

  // 悬停出菜单，再点菜单里的一项
  const hover = await tools(p, [['web_hover', { text: '更多操作', ...at }]])
  expect(hover).toContain('【web_hover】移到「更多操作」上了，出来了：「导出 PDF」、「打印」')
  await snap('悬停出菜单')
  const r2 = await tools(p, [['web_read', at]])
  expect(await tools(p, [['web_click', { ref: refOf(r2, '导出 PDF'), ...at }]])).toContain('【web_click】点了「导出 PDF」')
  expect(await logOf(run, which)).toContain('menu:export')

  // 按键：焦点放到框里按 Shift+A、⌘A 全选、Tab 换到下一个、Esc 关掉弹出的提示
  const keys = await tools(p, [
    ['web_press', { keys: 'Shift+A', ref: refOf(r2, '快捷键框'), ...at }],
    ['web_press', { keys: '⌘A', ...at }],
    ['web_press', { keys: 'Escape', ...at }],
    ['web_press', { keys: 'Tab', ref: refOf(r2, '账号'), ...at }],
  ])
  expect(keys).toContain('【web_press】按了 ⇧A。焦点在「快捷键框」')
  expect(keys).toContain('【web_press】按了 ⌘A。')
  expect(keys).toContain('【web_press】按了 Tab。焦点在「密码」')
  const k = await logOf(run, which)
  expect(k).toContain('key:Shift+A')
  expect(k).toContain('key:Meta+a')
  expect(k).toContain('modal:closed')
  expect(await inPage(run, which, `({ v: document.getElementById('keys').value, sel: getSelection().toString() || (() => { const e = document.getElementById('keys'); return e.value.slice(e.selectionStart, e.selectionEnd) })() })`)).toEqual({ v: 'A', sel: '' })

  // 拖拽：HTML5 拖放（draggable）拖进回收站
  expect(await tools(p, [['web_drag', { from_text: '香蕉', to_text: '回收站', ...at }]])).toContain('【web_drag】把「香蕉」拖到了「回收站」')
  expect(await logOf(run, which)).toContain('drop:i2')

  // 滚到某一段：按字
  expect(await tools(p, [['web_scroll', { text: '目标在这里', ...at }]])).toMatch(/【web_scroll】滚到了「目标在这里」那里（\d+ \/ \d+）/)
  // 那一段在网页 3000 多往下：滚过去了（看不见的那一页这一轮做完就收回了假的窗口大小，量滚到哪不量在不在屏幕上）
  expect(await inPage<number>(run, which, 'scrollY')).toBeGreaterThan(2000)
  expect(await tools(p, [['web_scroll', { to: 'top', ...at }]])).toContain('滚到了 0 /')
}

/**
 * 发一串工具，假 AI 做完第一个、说出头几个字就停住（把放行开关 CN_FAKE_HOLD 拿开），这时 look() 看网页那一格亮没亮；看完放行、等答完
 */
async function heldTools(page: Page, gate: string, steps: [string, Record<string, unknown>][], look: () => Promise<void>) {
  renameSync(gate, gate + '.off')
  const n = await ai(page).getByTestId('ai-msg').count()
  await send(page, `网页工具：${JSON.stringify(steps)}`)
  const msg = ai(page).getByTestId('ai-msg').nth(n)
  await expect(msg.locator('.txt')).not.toHaveText('', { timeout: 30_000 })
  await look()
  renameSync(gate + '.off', gate)
  await expect(msg).not.toHaveAttribute('aria-busy', 'true', { timeout: 60_000 })
}

/** web_read 结果里名字是 name 的那一样的编号 */
function refOf(read: string, name: string): number {
  const m = new RegExp(`\\[(\\d+)\\] \\S+ ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).exec(read)
  if (!m) throw new Error(`web_read 里没有「${name}」：\n${read}`)
  return Number(m[1])
}

const files = { '随笔.md': '# 随笔\n\n第一段。\n', '资料/行程单.txt': '十二月一号出发\n' }

test('右栏网页：每个工具真跑一遍；提交、登录、上传先问用户，下一轮说可以才做；只能传库里或用户给的文件', async () => {
  const outside = mkdtempSync(join(tmpdir(), 'cn-up-'))
  const given = join(outside, '护照扫描.txt')
  writeFileSync(given, 'passport')
  const run = await launch(files, { CN_AI_FAKE: '1', CN_FAKE_SAY_MS: '1' })
  const p = run.page
  try {
    await p.locator('.nav .si', { hasText: '随笔' }).click()
    await p.getByRole('navigation', { name: '右栏' }).getByRole('button', { name: '打开 AI' }).click()
    await send(p, `打开 ${base}/?p=right 看看标题`)
    await expect(ai(p).getByTestId('ai-msg').last().locator('.txt')).toContainText('网页标题是「网页工具测试页」', { timeout: 30_000 })
    // 看得到：右栏的网页写「右栏网页」，能动手写默认操纵的是右栏网页
    await expect(p.getByTestId('ai-sees').locator('.chip').nth(1)).toHaveText('右栏网页：127.0.0.1')
    await expect(p.getByTestId('ai-sees').locator('.chip.hands')).toHaveText('能动手：在右栏网页点、填表、剪藏')
    // 网页开在 AI 后面看不见也能操纵（下面的 everyTool 全在 AI 后面那一页上跑）
    await expect(p.getByTestId('dtab-web')).toHaveAttribute('aria-selected', 'false')

    await everyTool(run, 'right')
    // 网页拖到 AI 上面（两样都看得见，最常见的用法）：重新打开这一页，再跑一遍
    await webAboveAi(p)
    await expect(p.getByRole('complementary', { name: '网页' })).toBeVisible()
    expect(await tools(p, [['web_open', { url: `${base}/?p=right`, page: 'right' }]])).toContain('【web_open】打开了：网页工具测试页（右栏）')
    if (SHOTS) {
      mkdirSync(SHOTS, { recursive: true })
      await p.screenshot({ path: join(SHOTS, '0-右栏网页在AI上面.png') })
    }
    await everyTool(run, 'right', 'right', '2-右栏')

    // ---- 提交表单：先问，同一轮里自己说可以不算 ----
    const r = await tools(p, [['web_read', {}]])
    const submit = refOf(r, '提交')
    const ask = await tools(p, [['web_click', { ref: submit }]])
    expect(ask).toBe('【web_click】要我点「提交」吗？')
    const msg = ai(p).getByTestId('ai-msg').last()
    // 步骤行是「等你点头」：黄色问号（这一下没做），不是做完的绿勾
    await expect(msg.getByTestId('ai-step')).toHaveText(['等你点头：点「提交」'])
    await expect(msg.getByTestId('ai-step')).toHaveClass(/\bask\b/)
    expect(await msg.getByTestId('ai-step').locator('.ci').evaluate((e) => getComputedStyle(e).color)).toBe(await p.evaluate(() => { const d = document.createElement('i'); d.style.color = 'var(--yellow)'; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c }))
    expect(await logOf(run, 'right')).not.toContain('submit:trip')
    // 同一轮里问完马上带 confirmed：不算，还是先问
    const self = await tools(p, [['web_click', { ref: submit }], ['web_click', { ref: submit, confirmed: true }]])
    expect(self).toContain('要我点「提交」吗？')
    expect(await logOf(run, 'right')).not.toContain('submit:trip')
    // 用户回话说可以（下一轮）：带 confirmed 才点
    expect(await tools(p, [['web_click', { ref: submit, confirmed: true }]])).toContain('【web_click】点了「提交」')
    expect(await logOf(run, 'right')).toContain('submit:trip')
    // 没问过就带 confirmed：先问
    expect(await tools(p, [['web_click', { text: '登录', confirmed: true }]])).toContain('要我点「登录」吗？')
    expect(await logOf(run, 'right')).not.toContain('submit:login')
    // 登录框里回车：也先问
    const r3 = await tools(p, [['web_read', {}]])
    expect(await tools(p, [['web_type', { ref: refOf(r3, '账号'), text: 'me', submit: true }]])).toContain('要我点「登录」吗？')
    expect(await tools(p, [['web_press', { keys: 'Enter', ref: refOf(r3, '密码') }]])).toContain('要我点「登录」吗？')
    expect(await logOf(run, 'right')).not.toContain('submit:login')

    // ---- 上传：库里的文件，先问；下一轮说可以才传 ----
    const up = await tools(p, [['web_upload', { label: '附件', files: ['资料/行程单.txt'] }]])
    expect(up).toMatch(/^【web_upload】要我把 ?行程单\.txt 传到 127\.0\.0\.1:\d+ ?吗？$/)
    await expect(ai(p).getByTestId('ai-msg').last().getByTestId('ai-step')).toHaveText(['等你点头：上传「行程单.txt」'])
    if (SHOTS) {
      mkdirSync(SHOTS, { recursive: true })
      await ai(p).screenshot({ path: join(SHOTS, '1-上传前先问.png') })
    }
    expect(await logOf(run, 'right')).not.toContain('file:')
    // 回答下面那排换成两颗按钮「不要 · 可以，上传」（偏好「等点头给两颗按钮」）；点「不要」= 回一句「不要」：AI 不传、说一声
    const asking = ai(p).getByTestId('ai-msg').last()
    const bar = ai(p).getByTestId('ai-ask-bar')
    await expect(bar.locator('button')).toHaveText(['不要', '可以，上传'])
    await expect(asking.getByTestId('ai-ans-acts')).toHaveCount(0)
    const nAsk = await ai(p).getByTestId('ai-msg').count()
    await bar.getByRole('button', { name: '不要' }).click()
    await expect(ai(p).locator('.um').last()).toHaveText('不要')
    await expect(ai(p).getByTestId('ai-msg').nth(nAsk).locator('.txt')).toHaveText('好，不做了。', { timeout: 30_000 })
    await expect(bar).toHaveCount(0)
    expect(await logOf(run, 'right')).not.toContain('file:')
    // 再问一次，点「可以，上传」= 回一句「可以，上传」：AI 带 confirmed 再调一次，真传上了
    await tools(p, [['web_upload', { label: '附件', files: ['资料/行程单.txt'] }]])
    await expect(bar.locator('button')).toHaveText(['不要', '可以，上传'])
    if (SHOTS) await ai(p).screenshot({ path: join(SHOTS, '1b-等点头两颗按钮.png') })
    const nYes = await ai(p).getByTestId('ai-msg').count()
    await bar.getByRole('button', { name: '可以，上传' }).click()
    await expect(ai(p).locator('.um').last()).toHaveText('可以，上传')
    await expect(ai(p).getByTestId('ai-msg').nth(nYes).locator('.txt')).toContainText('【web_upload】给「附件」选好了：行程单.txt', { timeout: 30_000 })
    await expect(bar).toHaveCount(0)
    expect(await logOf(run, 'right')).toContain('file:行程单.txt:22')
    // 用户自己打字回照旧：问提交，打「可以」
    const r4 = await tools(p, [['web_read', {}]])
    expect(await tools(p, [['web_click', { ref: refOf(r4, '提交') }]])).toBe('【web_click】要我点「提交」吗？')
    await expect(bar.locator('button')).toHaveText(['不要', '可以，提交'])
    const before = (await logOf(run, 'right')).split('submit:trip').length
    await send(p, '可以')
    await expect(ai(p).getByTestId('ai-msg').last().locator('.txt')).toContainText('【web_click】点了「提交」', { timeout: 30_000 })
    expect((await logOf(run, 'right')).split('submit:trip').length).toBe(before + 1)
    // 没给过的库外文件：不让传；用户在话里给了路径的可以（网页自己画的「换头像」按钮：拦下选文件的窗口把文件给它）
    // （AI 自己编的路径：跑出库的相对路径、库外的；用户话里没写过）
    writeFileSync(join(run.vault, '..', '没给的.txt'), 'secret')
    expect(await tools(p, [['web_upload', { label: '附件', files: ['../没给的.txt'] }]])).toContain('不在库里，也不是用户在对话里给的文件')
    expect(await tools(p, [['web_upload', { label: '附件', files: ['.git/config'] }]])).toContain('不在库里，也不是用户在对话里给的文件')
    await send(p, `我的文件在 ${given}，传到换头像那里`)
    await expect(ai(p).getByTestId('ai-msg').last().locator('.txt')).not.toHaveText('', { timeout: 30_000 })
    expect(await tools(p, [['web_upload', { label: '换头像', files: [given] }]])).toContain('要我把 护照扫描.txt 传到')
    expect(await tools(p, [['web_upload', { label: '换头像', files: [given], confirmed: true }]])).toContain('选好了：护照扫描.txt')
    expect(await logOf(run, 'right')).toContain('avatar:护照扫描.txt')
    // 直接点选文件的框：不弹系统的选文件窗口，告诉 AI 用 web_upload
    expect(await tools(p, [['web_click', { text: '附件' }]])).toContain('选文件的框')
  } finally {
    await run.close()
    rmSync(outside, { recursive: true, force: true })
  }
})

test('中间栏网页：page=center 开在中间、每个工具真跑一遍；用户点进哪个网页，不给 page 时 AI 就操纵哪个，看得到写清楚；AI 动哪一格哪一格亮', async () => {
  // 放行开关：平时开着（假 AI 不停），heldTools 拿开一会儿
  const gate = join(mkdtempSync(join(tmpdir(), 'cn-hold-')), 'go')
  writeFileSync(gate, '')
  const run = await launch(files, { CN_AI_FAKE: '1', CN_FAKE_SAY_MS: '1', CN_FAKE_HOLD: gate })
  const p = run.page
  try {
    await p.locator('.nav .si', { hasText: '随笔' }).click()
    await p.getByRole('navigation', { name: '右栏' }).getByRole('button', { name: '打开 AI' }).click()
    // 右栏开一页、中间开一页
    await send(p, `打开 ${base}/?p=right 看看标题`)
    await expect(ai(p).getByTestId('ai-msg').last().locator('.txt')).toContainText('网页标题是「网页工具测试页」', { timeout: 30_000 })
    expect(await tools(p, [['web_open', { url: `${base}/?p=center`, page: 'center' }]])).toContain('【web_open】打开了：网页工具测试页（中间栏）')
    await expect(p.locator('main.center .tab.on, main.center [data-testid="tab-on"]').first()).toContainText('网页工具测试页')
    // 中间换成了网页那一页：AI 这一格还看着《随笔》那段对话，切到这一页自己的
    await ai(p).getByRole('button', { name: /切到《网页工具测试页》的 AI/ }).click()
    // 中间是网页、右栏也是：看得到两颗都写清在哪
    const sees = p.getByTestId('ai-sees')
    await expect(sees.locator('.chip').first()).toHaveText('网页：127.0.0.1')
    await expect(sees.locator('.chip').nth(1)).toHaveText('右栏网页：127.0.0.1')

    await everyTool(run, 'center', 'center', '3-中间栏')

    // 用户点进中间那一页：不给 page 时操纵它，「能动手」写中间栏
    const box = await p.locator('main.center webview').first().boundingBox()
    await p.mouse.click(box!.x + box!.width / 2, box!.y + 40)
    // 默认操纵的就是这一页（中间开着的网页）：不写在哪，同别的「能动手」
    await expect(sees.locator('.chip.hands')).toHaveText('能动手：点、填表、剪藏网页')
    expect(await tools(p, [['web_read', {}]])).toContain('哪个网页：中间栏')
    if (SHOTS) {
      mkdirSync(SHOTS, { recursive: true })
      await p.screenshot({ path: join(SHOTS, '4-中间栏和右栏都开着.png') })
    }
    // AI 点中间那一页：中间那一格亮「AI 正在操作这个网页」，右栏网页不亮；做完收起
    const midAct = p.locator('main.center .wpane:not([hidden])').getByTestId('ai-act')
    const rightAct = p.locator('.right.web').getByTestId('ai-act')
    await heldTools(p, gate, [['web_click', { text: '更多操作' }], ['web_read', {}]], async () => {
      await expect(midAct.getByTestId('ai-acting')).toBeVisible()
      await expect(midAct.getByTestId('ai-actbar')).toContainText('AI 正在操作这个网页')
      await expect(rightAct).toHaveCount(0)
      if (SHOTS) await p.screenshot({ path: join(SHOTS, '5-AI在中间栏网页动手.png') })
    })
    await expect(midAct).toHaveCount(0, { timeout: 15_000 })
    // 没有那个网页：说清楚有哪几个
    expect(await tools(p, [['web_read', { page: 'center-left' }]])).toContain('没有分屏左格的网页。现在开着的：page=center（中间栏）、page=right（右栏）')

    // 网页标签向右分屏：两格各一个网页，加上右栏一共三颗，都写清在哪；按 page 操纵哪一格
    await armMenus(run)
    await p.getByTestId('tab-list').getByRole('tab', { name: /网页工具测试页/ }).click({ button: 'right' })
    await openedMenu(run)
    await pickMenu(run, '向右分屏')
    await expect(sees.locator('.chip')).toHaveText(['网页：127.0.0.1', '分屏左格网页：127.0.0.1', '右栏网页：127.0.0.1', /^能动手：/])
    expect(await tools(p, [['web_read', { page: 'center-left' }]])).toContain('哪个网页：分屏左格')
    expect(await tools(p, [['web_read', { page: 'center-right' }]])).toContain('哪个网页：分屏右格')
    if (SHOTS) await p.screenshot({ path: join(SHOTS, '6-分屏两格加右栏三个网页.png') })
    // AI 点分屏右格：只那一格亮，左格、右栏不亮；做完收起
    const cell = (n: number) => p.locator(`main.center .cslot[data-pane="${n}"]`).getByTestId('ai-act')
    await heldTools(p, gate, [['web_click', { text: '更多操作', page: 'center-right' }], ['web_read', { page: 'center-right' }]], async () => {
      await expect(cell(1).getByTestId('ai-actbar')).toContainText('AI 正在操作这个网页')
      await expect(cell(0)).toHaveCount(0)
      await expect(rightAct).toHaveCount(0)
      if (SHOTS) await p.screenshot({ path: join(SHOTS, '7-AI在分屏右格动手.png') })
    })
    await expect(cell(1)).toHaveCount(0, { timeout: 15_000 })
  } finally {
    await run.close()
  }
})
