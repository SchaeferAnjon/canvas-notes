/** 网页剪藏的测试共用（clip-inbox-same 和它的截图）：右栏网页里执行、按键、真拖选一段、小条「⋯ › 剪到哪篇…」、收件箱里的卡片、⌘ 点编辑器里的字 */
import { expect, type Page } from '@playwright/test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pane, rail, type Running } from './app'

export const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
export const toast = (page: Page) => page.getByTestId('toast')
export function guest<T = unknown>(page: Page, code: string): Promise<T> {
  return page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code) as Promise<T>
}
export const wcId = (page: Page) => page.evaluate(() => (document.querySelector('.right.web webview.on') as unknown as { getWebContentsId(): number }).getWebContentsId())

/** 在网页里按键（焦点在网页里时 ⌘S 是网页预加载收的） */
export async function pressInPage(run: Running, key: string, modifiers: ('alt' | 'meta' | 'shift')[] = []) {
  await run.app.evaluate(
    ({ webContents }, [id, k, mods]) => {
      const wc = webContents.fromId(id as number)!
      wc.sendInputEvent({ type: 'keyDown', keyCode: k as string, modifiers: mods as ('alt' | 'meta' | 'shift')[] })
      wc.sendInputEvent({ type: 'keyUp', keyCode: k as string, modifiers: mods as ('alt' | 'meta' | 'shift')[] })
    },
    [await wcId(run.page), key, modifiers] as const,
  )
}

export async function openWeb(page: Page, u: string) {
  if (!(await web(page).isVisible())) await rail(page).getByRole('button', { name: '网页', exact: true }).click()
  const addr = web(page).getByRole('textbox', { name: '网址' })
  await addr.click()
  await addr.fill(u)
  await addr.press('Enter')
  await expect.poll(() => guest(page, 'document.readyState + "|" + location.href')).toBe(`complete|${u}`)
}

export const barShown = (page: Page) => guest(page, `document.getElementById('cn-clip-host')?.style.display`)

/** 用鼠标从 #id 第一个字拖到最后一个字（真拖，中间夹着公式也行）；等小条出来 */
export async function selectPara(page: Page, id: string) {
  await guest(page, 'getSelection().removeAllRanges()')
  await guest(page, `document.getElementById(${JSON.stringify(id)}).scrollIntoView({ block: 'center' })`)
  for (let i = 0; i < 3; i++) {
    const w = (await web(page).locator('webview.on').boundingBox())!
    const p = await guest<number[]>(
      page,
      `(() => { const el = document.getElementById(${JSON.stringify(id)}); const a = el.firstChild, b = el.lastChild;
        const f = document.createRange(); f.setStart(a, 0); f.setEnd(a, 1); const l = document.createRange(); l.setStart(b, b.data.length - 1); l.setEnd(b, b.data.length);
        const r1 = f.getClientRects()[0], r2 = l.getClientRects()[0]; return [r1.left + 1, r1.top + r1.height / 2, r2.right - 1, r2.top + r2.height / 2] })()`,
    )
    await page.mouse.move(w.x + p[0]!, w.y + p[1]!)
    await page.mouse.down()
    await page.mouse.move(w.x + p[2]!, w.y + p[3]!, { steps: 10 })
    await page.mouse.up()
    if (await expect.poll(() => barShown(page), { timeout: 1500 }).toBe('block').then(() => true, () => false)) return
  }
  throw new Error('小条没出来')
}

export const SR = `document.getElementById('cn-clip-host').shadowRoot`
export async function barPoint(page: Page, code: string) {
  const w = (await web(page).locator('webview.on').boundingBox())!
  const p = await guest<{ x: number; y: number }>(page, `(() => { const b = (${code}).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 } })()`)
  return { x: w.x + p.x, y: w.y + p.y }
}

/** 小条「⋯」打开，读出菜单里「剪到哪篇…」那一项右边写的，再点它 */
export async function openPickTarget(page: Page): Promise<string> {
  const more = await barPoint(page, `${SR}.querySelector('button[data-k="__more"]')`)
  await page.mouse.click(more.x, more.y)
  // 机器忙时 ⋯ 的菜单晚一点才摆好：等「剪到哪篇…」那一项有了位置再点（不然点在 0,0 上什么都没发生）
  await expect.poll(() => guest<number>(page, `${SR}.querySelector('.menu button[data-k="__target"]').getBoundingClientRect().width`)).toBeGreaterThan(0)
  const right = await guest<string>(page, `${SR}.querySelector('.menu button[data-k="__target"]').textContent.trim()`)
  const tgt = await barPoint(page, `${SR}.querySelector('.menu button[data-k="__target"]')`)
  await page.mouse.click(tgt.x, tgt.y)
  return right
}

/** 指着「剪藏」那颗，读悬停提示 */
export async function clipTip(page: Page) {
  const p = await barPoint(page, `${SR}.querySelector('button[data-k="clip"]')`)
  await page.mouse.move(p.x - 200, p.y + 200)
  await page.mouse.move(p.x, p.y, { steps: 4 })
  await expect.poll(() => guest<string>(page, `${SR}.querySelector('.tip').style.display`)).toBe('block')
  return guest<string>(page, `${SR}.querySelector('.tip').textContent`)
}

export const inboxFiles = (vault: string) => (existsSync(join(vault, '收件箱')) ? readdirSync(join(vault, '收件箱')).filter((f) => f.endsWith('.md')).sort() : [])
export const read = (vault: string, p: string) => readFileSync(join(vault, p), 'utf8')
export const flashed = (page: Page) => guest<number>(page, `(() => { const h = document.getElementById('cn-mark-host'); return h && h.shadowRoot ? h.shadowRoot.querySelectorAll('.flash').length : 0 })()`)

/** 中间那篇里 ⌘ 点一处字（量它在编辑器里的位置，真点） */
export async function metaClickText(page: Page, text: string) {
  await page.waitForTimeout(400)
  const at = await pane(page)
    .locator('.cm-content')
    .evaluate((root, t) => {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      while (w.nextNode()) {
        const n = w.currentNode as Text
        const i = n.data.indexOf(t)
        if (i < 0) continue
        n.parentElement?.scrollIntoView({ block: 'center' })
        const r = document.createRange()
        r.setStart(n, i)
        r.setEnd(n, i + t.length)
        const b = r.getBoundingClientRect()
        return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
      }
      return null
    }, text)
  expect(at, `编辑器里看得到「${text}」`).not.toBeNull()
  await page.keyboard.down('Meta')
  await page.mouse.click(at!.x, at!.y)
  await page.keyboard.up('Meta')
}
