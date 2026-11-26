/**
 * 收件箱「速记抓不到内容」（用户：有时抓不到）：⌥⌘N 弹速记时，选中的字要带上来。
 * 测试实例不碰真的前台软件、不按真的全局键（窗口不上屏）：菜单栏那一项的跑法 cnQuick.show 里假装前台是哪个软件。
 * 前台是别的软件时模拟 ⌘C 的那一截（慢的软件、按键没松、连按）在 test/quick-grab.test.ts。
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BRAND } from '../src/shared/brand'
import { launch, openNote, pane } from './app'

type Front = { name: string; bundle: string }
type QuickHook = { show(t?: { front?: Front }): Promise<void> }
const SELF: Front = { name: BRAND.name, bundle: BRAND.appId }

let server: Server
let base = ''
test.beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end('<!doctype html><title>冰岛的瀑布</title><body><p id="p">斯科加瀑布高六十米。</p><p>别的一段。</p></body>')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
test.afterAll(() => server.close())

/** 照菜单栏「速记」那一项弹出（front：假装前台是哪个软件）；交回小窗 */
async function quick(app: ElectronApplication, front?: Front): Promise<Page> {
  const had = app.windows().find((w) => w.url().endsWith('/quick.html'))
  const open = app.evaluate((_e, f) => (globalThis as unknown as { cnQuick: QuickHook }).cnQuick.show(f ? { front: f } : undefined), front)
  if (had) return (await open, had)
  const [w] = await Promise.all([app.waitForEvent('window', (p) => p.url().endsWith('/quick.html')), open])
  await w.waitForLoadState()
  return w
}

const inbox = (vault: string) => readdirSync(join(vault, '收件箱')).map((f) => readFileSync(join(vault, '收件箱', f), 'utf8'))

test('前台就是画布笔记、笔记里选了一句：速记框带上这一句和「来自 Canvas Notes」，回车存进收件箱；没有辅助功能权限也行', async () => {
  const run = await launch({ '游记.md': '# 游记\n\n速记要带上的这一句。\n\n别的一段。\n' })
  const { app, page, vault } = run
  try {
    await openNote(page, '游记')
    await pane(page).locator('.cm-line', { hasText: '速记要带上的这一句' }).click()
    await page.keyboard.press('End')
    await page.keyboard.press('Shift+Home')
    const q = await quick(app, SELF)
    await expect(q.getByTestId('quick-selection')).toContainText('速记要带上的这一句。')
    await expect(q.getByTestId('quick-selection')).toContainText(`来自${BRAND.name}`)
    await q.getByRole('textbox', { name: '速记内容' }).press('Enter')
    await expect.poll(() => inbox(vault).join('\n')).toContain('> 速记要带上的这一句。')
    expect(inbox(vault).join('\n')).toContain(`—— 来自 ${BRAND.name}`)
  } finally {
    await run.close()
  }
})

test('前台就是画布笔记、右栏网页里选了一段：带上这一段、网页标题和网址', async () => {
  const run = await launch({ '游记.md': `# 游记\n\n去看[瀑布](${base}/fall)。\n` })
  const { app, page } = run
  try {
    await openNote(page, '游记')
    await pane(page).locator('.cm-link', { hasText: '瀑布' }).click({ modifiers: ['Meta'] })
    const web = page.getByRole('complementary', { name: '网页' })
    await expect(web).toBeVisible()
    // 网页里选中第一段、焦点在网页里（webview）
    await expect
      .poll(() =>
        app.evaluate(async ({ webContents }, url) => {
          const g = webContents.getAllWebContents().find((w) => w.getType() === 'webview' && w.getURL().startsWith(url))
          if (!g || g.isLoading()) return false
          await g.executeJavaScript('const r = document.createRange(); r.selectNodeContents(document.getElementById("p")); getSelection().removeAllRanges(); getSelection().addRange(r); true')
          return true
        }, base),
      )
      .toBe(true)
    await page.evaluate(() => (document.querySelector('webview') as HTMLElement).focus())
    const q = await quick(app, SELF)
    await expect(q.getByTestId('quick-selection')).toContainText('斯科加瀑布高六十米。')
    await expect(q.getByTestId('quick-selection')).toContainText('冰岛的瀑布')
  } finally {
    await run.close()
  }
})

test('连按两下、刚开好的小窗晚接上：只弹一个，选中的字不丢；小窗里晚订的也马上收到最近这一次', async () => {
  const run = await launch({ '游记.md': '# 游记\n\n第一次就带上。\n' })
  const { app, page } = run
  try {
    await openNote(page, '游记')
    await pane(page).locator('.cm-line', { hasText: '第一次就带上' }).click()
    await page.keyboard.press('End')
    await page.keyboard.press('Shift+Home')
    const [q] = await Promise.all([quick(app, SELF), app.evaluate((_e, f) => (globalThis as unknown as { cnQuick: QuickHook }).cnQuick.show({ front: f }), SELF)])
    await expect(q.getByTestId('quick-selection')).toContainText('第一次就带上。')
    expect(app.windows().filter((w) => w.url().endsWith('/quick.html'))).toHaveLength(1)
    // 界面晚一步才接上（机器忙、刚启动时 React 还没画完）：订的时候就交最近那一次
    const late = await q.evaluate(
      () =>
        new Promise<string>((r) => {
          type Api = { onContext(cb: (c: { selection?: string }) => void): () => void }
          ;(window as unknown as { quick: Api }).quick.onContext((c) => r(c.selection ?? ''))
          setTimeout(() => r('两秒内没收到'), 2000)
        }),
    )
    expect(late).toBe('第一次就带上。')
  } finally {
    await run.close()
  }
})
