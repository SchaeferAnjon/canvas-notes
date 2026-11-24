// 拖进只读文件（用户 0.5.11）：微信、Safari 存下来的 PDF 常是 0444、带隔离标记，拖到课程首页「课件进度」报
// 「EACCES: permission denied, open '…/.alr170025.pdf.cn-…tmp'」，底栏还截掉了后半截。
// 现在：只读的、普通的、带隔离标记的都拷进文件夹（本人可写 0644）、出现在课件进度、能打开能问（批注）；
// 库里本来就只读的 PDF 照样能打开、问；写失败时 main.log 有完整路径和栈，底栏点开看全文、能拷贝
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, restoreClipboard, saveClipboard, tabOn } from './app'
import { lecturePdf } from './fixtures/pdf'

test.setTimeout(240_000)

const pdf = (title: string) => lecturePdf([{ title, lines: ['Approximate computing trades accuracy for energy.'] }, { title: `${title} (2)`, lines: ['More.'] }])
const VAULT = { '课程/ecp/Lecture04.pdf': pdf('Analog Computing') }

const home = (page: Page) => page.getByTestId('folder-home')
const slides = (page: Page) => home(page).getByTestId('fw-slides')
const covers = (page: Page) => slides(page).getByTestId('slide-cover')
const toast = (page: Page) => page.locator('.toast-cn')
const pdfPane = (page: Page) => page.locator('.pdfpane:not([hidden])')
const pdfPage = (page: Page, n: number) => pdfPane(page).locator(`.pdfpage[data-page="${n}"]`)
const ai = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })
const temps = (dir: string) => readdirSync(dir).filter((n) => n.endsWith('.tmp'))
const mode = (p: string) => statSync(p).mode & 0o777

/** 从访达拖文件进来（同 step22-slides）：文件经由文件选择框变成真的本机文件，再照拖放的事件顺序发到首页上 */
async function dropFiles(page: Page, paths: string[]) {
  await page.evaluate(() => {
    if (document.getElementById('e2e-files')) return
    const i = document.createElement('input')
    i.type = 'file'
    i.multiple = true
    i.id = 'e2e-files'
    i.style.display = 'none'
    document.body.append(i)
  })
  await page.setInputFiles('#e2e-files', paths)
  await page.evaluate(() => {
    const dt = new DataTransfer()
    for (const f of (document.getElementById('e2e-files') as HTMLInputElement).files!) dt.items.add(f)
    const target = document.querySelector('[data-testid="fw-slides"]')!
    for (const type of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }))
  })
}

async function openCourse(page: Page) {
  await page.keyboard.press('Meta+k')
  await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('ecp')
  await page.locator('.pal-row', { hasText: 'ecp' }).first().click()
  await expect(home(page)).toBeVisible()
}

/** 打开这份 PDF、在第 1 页框一块问 AI（假 AI），等笔记记好：问过的就写进「<名> 笔记.md」 */
async function openAndAsk(page: Page, name: string) {
  await page.keyboard.press('Meta+k')
  await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill(name)
  await page.locator('.pal-row', { hasText: `${name}.pdf` }).first().click()
  await expect(tabOn(page)).toHaveText(`${name}.pdf`)
  await expect(pdfPage(page, 1).locator('canvas[data-ready="1"]')).toBeAttached({ timeout: 20_000 })
  const p = (await pdfPage(page, 1).boundingBox())!
  await page.keyboard.down('Meta')
  await page.mouse.move(p.x + p.width * 0.1, p.y + p.height * 0.12)
  await page.mouse.down()
  await page.mouse.move(p.x + p.width * 0.7, p.y + p.height * 0.22, { steps: 6 })
  await page.mouse.up()
  await page.keyboard.up('Meta')
  const input = ai(page).getByRole('textbox', { name: '问 AI' })
  await expect(ai(page).getByTestId('reading-att')).toHaveCount(1)
  // 每份都是头一回问：右栏是这一份的（空的）对话
  await expect(ai(page).getByTestId('reading-msg')).toHaveCount(0)
  await input.press('Enter')
  await expect(ai(page).getByTestId('reading-msg')).toHaveCount(1)
  await expect(ai(page).getByTestId('reading-msg').last().getByTestId('ai-noted')).toHaveAttribute('data-state', 'done', { timeout: 30_000 })
  // 收起 AI、关上这份：下一份问的是它自己的对话（对话绑开始的那一页）
  await page.getByRole('button', { name: '收起 AI' }).first().click()
  await expect(ai(page)).toHaveCount(0)
  await page.keyboard.press('Meta+w')
}

test('拖进只读 / 普通 / 带隔离标记的 PDF 都收进课程、能打开能问；库里只读的照样能打开能问；写失败记进 main.log、底栏点开看全文能拷贝', async () => {
  const outside = mkdtempSync(join(tmpdir(), 'cn-wechat-'))
  // ① 微信存下来的样子：只读 + 隔离标记；② 普通的；③ 只有隔离标记（Safari 下载）
  const ro = join(outside, 'alr170025.pdf')
  writeFileSync(ro, pdf('Read Only'))
  execFileSync('xattr', ['-w', 'com.apple.quarantine', '0082;6b05ff5d;WeChat;', ro])
  chmodSync(ro, 0o444)
  const plain = join(outside, 'Lecture06.pdf')
  writeFileSync(plain, pdf('Plain'))
  const qt = join(outside, 'Safari下载.pdf')
  writeFileSync(qt, pdf('Quarantined'))
  execFileSync('xattr', ['-w', 'com.apple.quarantine', '0081;6b05ff5d;Safari;', qt])
  const run = await launch(VAULT, { CN_AI_FAKE: '1' })
  const { page, vault, userData, app } = run
  const dir = join(vault, '课程/ecp')
  const clip = await saveClipboard(app)
  try {
    // 库里本来就只读的一份（用户那张就是这样留在库里的）
    chmodSync(join(dir, 'Lecture04.pdf'), 0o444)
    await openCourse(page)
    await expect(covers(page)).toHaveCount(1)

    for (const [src, name] of [[ro, 'alr170025'], [plain, 'Lecture06'], [qt, 'Safari下载']] as const) {
      await dropFiles(page, [src])
      await expect(toast(page)).toContainText(`拷进了ecp：${name}.pdf`)
      const dest = join(dir, `${name}.pdf`)
      expect(readFileSync(dest).equals(readFileSync(src))).toBe(true)
      // 本人能写（改名、以后再盖都不卡），其他位照留
      expect(mode(dest)).toBe(0o644)
      expect(temps(dir)).toEqual([])
    }
    // 卡上最多列 3 份，「全部 4 份」
    await expect(covers(page)).toHaveCount(3)
    await expect(slides(page)).toContainText('全部4份')
    // 原文件不动：还是只读、还带隔离标记
    expect(mode(ro)).toBe(0o444)
    expect(execFileSync('xattr', ['-p', 'com.apple.quarantine', ro], { encoding: 'utf8' })).toContain('WeChat')

    // 拖进来的只读那份、带隔离标记那份、库里本来只读那份：都能打开、框一块问（问过的记进配对笔记）
    for (const name of ['alr170025', 'Safari下载', 'Lecture04']) {
      await openAndAsk(page, name)
      await expect.poll(() => readdirSync(dir).some((f) => f.startsWith(name) && f.endsWith('.md'))).toBe(true)
    }
    // 库里只读那份还是只读（不替用户改权限；软件从不往 PDF 里写，批注记在配对笔记里）
    expect(mode(join(dir, 'Lecture04.pdf'))).toBe(0o444)

    // 故意写失败：课程文件夹锁成只读再拖
    await openCourse(page)
    const fail = join(outside, '写不进.pdf')
    writeFileSync(fail, pdf('Fail'))
    chmodSync(dir, 0o555)
    try {
      await dropFiles(page, [fail])
      await expect(toast(page)).toContainText('EACCES')
    } finally {
      chmodSync(dir, 0o755)
    }
    expect(temps(dir)).toEqual([])
    // main.log：哪个调用、完整路径、调用栈
    const log = join(userData, 'logs', 'main.log')
    await expect.poll(() => (existsSync(log) ? readFileSync(log, 'utf8') : '')).toContain('[ipc-error] slides:import')
    const text = readFileSync(log, 'utf8')
    const entry = text.slice(text.lastIndexOf('[ipc-error] slides:import'))
    expect(entry).toContain(fail)
    expect(entry).toContain(`${dir}/.写不进.pdf.cn-`)
    expect(entry).toMatch(/\n\s+at /)
    // 底栏：字被截短，点开看全文，能拷贝；esc 收起
    const msg = page.getByTestId('toast-text')
    const full = (await msg.textContent())!
    expect(full).toContain(`${dir}/.写不进.pdf.cn-`)
    expect(await msg.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
    await msg.click()
    await expect(page.getByTestId('toast-full-text')).toHaveText(full)
    await page.getByTestId('toast-copy').click()
    await expect(page.getByTestId('toast-copy')).toHaveText('已拷贝')
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(full)
    await page.screenshot({ path: join(process.env.CN_SHOT_DIR ?? tmpdir(), 'drop-readonly-toast-full.png') })
    // 开着时不自己消失
    await page.waitForTimeout(6500)
    await expect(page.getByTestId('toast-full')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('toast-full')).toHaveCount(0)
  } finally {
    await restoreClipboard(app, clip)
    await run.close()
    chmodSync(outside, 0o755)
    rmSync(outside, { recursive: true, force: true })
  }
})
