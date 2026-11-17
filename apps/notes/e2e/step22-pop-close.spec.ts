// 右栏弹层点网页正文、在网页里按 Esc 也收起（录屏 ① CN-43）：翻译菜单、书签和历史都走同一个「点外面收起」。
import { expect, test, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { launch, rail, type Running } from './app'

let server: Server
let base: string

test.beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end(`<html lang="en"><title>George H. W. Bush</title><body style="font:16px sans-serif;padding:20px"><div style="height:560px">（上面一大段导航）</div>
      <p id="p1">George Herbert Walker Bush was the 41st president of the United States from 1989 to 1993.</p>
      <p id="p2">He served as the 43rd vice president under Ronald Reagan.</p></body></html>`)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
test.afterAll(() => server.close())

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const trMenu = (page: Page) => page.getByRole('dialog', { name: '双语翻译' })
const guest = (page: Page, code: string): Promise<unknown> =>
  page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code)
async function guestRect(page: Page, id: string) {
  const w = (await web(page).locator('webview.on').boundingBox())!
  const r = JSON.parse(String(await guest(page, `JSON.stringify(document.getElementById('${id}').getBoundingClientRect())`))) as { x: number; y: number; width: number; height: number }
  return { x: w.x + r.x, y: w.y + r.y, w: r.width, h: r.height }
}
async function pressInPage(run: Running, key: string) {
  const id = await run.page.evaluate(() => (document.querySelector('.right.web webview.on') as unknown as { getWebContentsId(): number }).getWebContentsId())
  await run.app.evaluate(({ webContents }, [wcId, k]) => {
    const wc = webContents.fromId(wcId as number)!
    wc.sendInputEvent({ type: 'keyDown', keyCode: k as string })
    wc.sendInputEvent({ type: 'keyUp', keyCode: k as string })
  }, [id, key] as const)
}

test('翻译菜单：点网页正文收起；拖选正文时收起、剪藏小条照常出；网页里按 Esc 收起；书签和历史同样', async () => {
  const run = await launch({ 'a.md': '# a\n' }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await rail(page).getByRole('button', { name: '网页' }).click()
    const addr = web(page).getByRole('textbox', { name: '网址' })
    await addr.fill(`${base}/bush`)
    await addr.press('Enter')
    await expect.poll(() => guest(page, 'document.readyState + "|" + location.href')).toBe(`complete|${base}/bush`)
    const openTr = async () => {
      await web(page).getByRole('button', { name: '翻译选项' }).click()
      await expect(trMenu(page)).toBeVisible()
    }
    // 正文里离弹层远的地方（弹层盖着网页上半截）
    const clickBody = async () => {
      const w = (await web(page).locator('webview.on').boundingBox())!
      await page.mouse.click(w.x + 30, w.y + w.height - 40)
    }

    // 点正文
    await openTr()
    await clickBody()
    await expect(trMenu(page)).toHaveCount(0)

    // 拖选正文：菜单收起，小条照常出
    await openTr()
    const p1 = await guestRect(page, 'p1')
    await page.mouse.move(p1.x + 2, p1.y + p1.h / 2)
    await page.mouse.down()
    await page.mouse.move(p1.x + 200, p1.y + p1.h / 2, { steps: 8 })
    await page.mouse.up()
    await expect(trMenu(page)).toHaveCount(0)
    await expect.poll(() => guest(page, `document.getElementById('cn-clip-host')?.style.display`)).toBe('block')

    // 网页里按 Esc（焦点在网页里）
    await openTr()
    await pressInPage(run, 'Escape')
    await expect(trMenu(page)).toHaveCount(0)

    // 软件里按 Esc
    await openTr()
    await page.keyboard.press('Escape')
    await expect(trMenu(page)).toHaveCount(0)

    // 书签和历史：点正文收起、网页里按 Esc 收起
    const lib = web(page).getByRole('dialog', { name: '书签和历史' })
    const openLib = async () => {
      await web(page).getByRole('button', { name: '更多', exact: true }).click()
      await web(page).getByRole('menu', { name: '更多', exact: true }).getByRole('menuitem', { name: /^书签和历史/ }).click()
      await expect(lib).toBeVisible()
    }
    await openLib()
    await clickBody()
    await expect(lib).toHaveCount(0)
    await openLib()
    await pressInPage(run, 'Escape')
    await expect(lib).toHaveCount(0)
  } finally {
    await run.close()
  }
})
