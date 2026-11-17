import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { launch, rail, acts } from './app'
import { solidPng } from './fixtures/png'

const PNG_1PX = solidPng(40, 30, [90, 120, 200])

export const ARTICLE = {
  p1: 'In linear algebra, a rotation matrix is a transformation matrix that is used to perform a rotation in Euclidean space.',
  p2: 'It rotates points in the xy plane counterclockwise through an angle about the origin, written as a column vector.',
  p3: 'Rotation matrices are orthogonal matrices with determinant one, and their inverse is their transpose.',
}

let server: Server
let base: string

export function articleHtml(): string {
  return `<!doctype html><html lang="en"><head><title>Rotation matrix - Wikipedia</title></head><body style="font:16px/1.5 Georgia,serif;padding:20px;max-width:640px;background:#fff;color:#1b1b1b">
  <nav><a href="/">Main page</a></nav>
  <main><article><h1 id="h">Rotation matrix</h1>
  <p id="p1">${ARTICLE.p1}</p>
  <p id="p2">${ARTICLE.p2}</p>
  <dl><dd><span class="mwe-math-element"><img class="mwe-math-fallback-image-display" src="/math.png" alt="x' = x cos t - y sin t" style="width:180px;height:24px"></span></dd></dl>
  <h2 id="h2">Properties</h2>
  <p id="p3">${ARTICLE.p3}</p>
  <figure><img src="/fig.png" alt="Rotation of a vector" style="width:200px;height:120px"></figure>
  <pre>R = [[cos t, -sin t], [sin t, cos t]]</pre>
  </article></main></body></html>`
}

test.beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/fig.png' || req.url === '/math.png') {
      res.setHeader('content-type', 'image/png')
      return res.end(PNG_1PX)
    }
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end(articleHtml())
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
test.afterAll(() => {
  server.close()
})

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const guest = (page: Page, code: string) => page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code)

async function openWeb(page: Page, u: string) {
  await rail(page).getByRole('button', { name: '网页' }).click()
  const addr = web(page).getByRole('textbox', { name: '网址' })
  await addr.fill(u)
  await addr.press('Enter')
  await expect.poll(() => guest(page, 'document.readyState + "|" + location.href')).toBe(`complete|${u}`)
}

test('网页阅读视图：翻译菜单「在中间栏左右对照读」开成中间栏标签，同一个重排组件对照读；公式、代码、图不翻；只看译文；回到网页；存成双语笔记进收件箱带原网址', async () => {
  const run = await launch({ 'a.md': '# a\n' }, { CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '50' })
  const { page, vault } = run
  try {
    await openWeb(page, `${base}/wiki/Rotation_matrix`)
    await web(page).getByRole('button', { name: '翻译选项' }).click()
    await page.getByRole('dialog', { name: '双语翻译' }).getByRole('button', { name: '在中间栏左右对照读' }).click()
    await expect(page.getByRole('dialog', { name: '双语翻译' })).toHaveCount(0)
    const pane = page.locator('.webread:not([hidden])')
    await expect(page.locator('main.center .tab.on')).toContainText('Rotation matrix - Wikipedia · 阅读视图')
    await expect(acts(page).getByTestId('page-note')).toHaveText('阅读视图 · 127.0.0.1')
    const flow = pane.getByTestId('reflow')
    // 每段原文跟译文
    const p1 = flow.locator('.fb', { hasText: ARTICLE.p1 })
    await expect(p1.locator('.t')).toHaveText('译文：' + ARTICLE.p1.slice(0, 40))
    await expect(flow.locator('.fb.heading', { hasText: 'Properties' }).locator('.t')).toHaveText('译文：Properties')
    // 导航、页眉不进来；公式是图、代码原样、图是图，都不翻
    await expect(flow.locator('.fb', { hasText: 'Main page' })).toHaveCount(0)
    await expect(flow.locator('.fc.formula img')).toHaveAttribute('src', `${base}/math.png`)
    await expect(flow.locator('.fc.formula pre')).toHaveText('R = [[cos t, -sin t], [sin t, cos t]]')
    await expect(flow.locator('.fc.figure img')).toHaveAttribute('src', `${base}/fig.png`)
    await expect(pane.getByTestId('bi-status')).toHaveText('译文4/4段')

    // 只看译文
    await acts(page).getByRole('radio', { name: '只看译文' }).click()
    const p1tr = flow.locator('.fb', { hasText: '译文：In linear algebra' })
    await expect(p1tr.locator('.o')).toHaveCount(0)
    await expect(p1tr.locator('.t')).toBeVisible()

    // 存成双语笔记：收件箱，来源是网址，一次提交
    await pane.getByRole('button', { name: '存成双语笔记' }).click()
    const note = '收件箱/Rotation matrix - Wikipedia 双语.md'
    await expect(page.getByText(`已存成${note} · 带原网址`)).toBeVisible({ timeout: 15_000 })
    const md = readFileSync(join(vault, note), 'utf8')
    expect(md).toContain(`来源: ${base}/wiki/Rotation_matrix`)
    expect(md).toContain(`[回到网页](${base}/wiki/Rotation_matrix)`)
    expect(md).toContain(`> ${ARTICLE.p1}\n\n译文：${ARTICLE.p1.slice(0, 40).trim()}`)
    expect(md).toContain(`![公式](${base}/math.png)`)
    expect(execFileSync('git', ['-C', vault, 'log', '-1', '--format=%s'], { encoding: 'utf8' }).trim()).toBe('双语笔记：Rotation matrix - Wikipedia 双语')

    // 回到网页：右栏打开原网页
    await rail(page).getByRole('button', { name: '网页' }).click()
    await expect(web(page)).toBeHidden()
    await flow.getByRole('button', { name: '回到网页' }).click()
    await expect(web(page)).toBeVisible()
  } finally {
    await run.close()
  }
})
