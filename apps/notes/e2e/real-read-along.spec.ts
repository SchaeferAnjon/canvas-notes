// 真网页走一遍（task-kbnc0）：测试模式（CN_E2E=1，窗口不上屏幕、不登录、不碰本机 Chrome）真开 zh.d2l.ai 的前言和 2.1，
// 配成一对 → 在 2.1 往下滚到「索引和切片」那一节的第一段 → 换一台 Mac（新的本机设置）→ 点这篇：网页回到那段、亮一下。
// 平时跳过（要上网）：CN_REAL_D2L=1 npx playwright test e2e/real-read-along.spec.ts；CN_SHOTS=<目录> 时截图
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, leftView, rail, tabOn, type Running } from './app'

test.skip(process.env.CN_REAL_D2L !== '1', '要上网：CN_REAL_D2L=1 才跑')
test.setTimeout(240_000)

const NOTE = '课程/学习笔记：动手学深度学习.md'
const PREFACE = 'https://zh.d2l.ai/chapter_preface/index.html'
const NDARRAY = 'https://zh.d2l.ai/chapter_preliminaries/ndarray.html'
const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const addr = (page: Page) => web(page).getByRole('textbox', { name: '网址' })
const tree = (page: Page) => page.getByRole('tree', { name: '全部文件' })
const toast = (page: Page) => page.getByTestId('toast')
const guest = <T = unknown>(page: Page, code: string): Promise<T> =>
  page.evaluate((c) => {
    const w = document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> } | null
    try {
      return w ? w.executeJavaScript(c).catch(() => null) : null
    } catch {
      return null
    }
  }, code) as Promise<T>

async function shot(run: Running, name: string) {
  const dir = process.env.CN_SHOTS
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  await run.page.waitForTimeout(500)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(dir, `${name}.png`), Buffer.from(b64, 'base64'))
}

/** 「2.1.4. 索引和切片」那一节下面第一段：在哪、亮没亮 */
const target = (page: Page) =>
  guest<{ top: number; bottom: number; vh: number; text: string; flash: boolean } | null>(
    page,
    `(() => { const h = [...document.querySelectorAll('h2')].find((x) => x.textContent.includes('索引和切片')); if (!h) return null;
      let p = h.nextElementSibling; while (p && p.tagName !== 'P') p = p.nextElementSibling; if (!p) return null;
      const r = p.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight, text: p.textContent.trim().slice(0, 40), flash: p.hasAttribute('data-cn-flash') } })()`,
  )

async function go(page: Page, u: string) {
  await addr(page).click()
  await addr(page).fill(u)
  await addr(page).press('Enter')
  await expect.poll(() => guest(page, 'location.href'), { timeout: 60_000 }).toBe(u)
  await expect.poll(() => guest(page, 'document.readyState'), { timeout: 60_000 }).toBe('complete')
}

async function openTreeNote(page: Page) {
  await leftView(page, '文件')
  const toggle = tree(page).getByRole('treeitem').filter({ hasText: /^课程/ }).first().getByRole('button', { name: '展开 课程' })
  if (await toggle.count()) await toggle.click()
  await tree(page).locator(`[data-path="${NOTE}"]`).click()
  await expect(tabOn(page)).toHaveText('学习笔记：动手学深度学习')
}

test('真开 zh.d2l.ai：前言配成一对，2.1 读到「索引和切片」，换一台 Mac 点这篇回到那段', async () => {
  let run = await launch({ [NOTE]: '# 学习笔记：动手学深度学习\n\n## 前言\n\n## 2.1 数据操作\n' })
  const vault = run.vault
  const dirs = [dirname(vault)]
  try {
    let page = run.page
    await openTreeNote(page)
    await rail(page).getByRole('button', { name: '网页', exact: true }).click()
    await go(page, PREFACE)
    await web(page).getByRole('button', { name: '更多', exact: true }).click()
    await web(page).getByRole('menu', { name: '更多', exact: true }).getByRole('menuitem', { name: '和中间这篇配成一对…' }).click()
    const pop = page.getByRole('dialog', { name: '和网页配成一对' })
    await expect(pop.getByRole('radio', { name: /^这本书：zh\.d2l\.ai 下的每一页/ })).toBeChecked()
    await shot(run, 'd2l-1-pair')
    await pop.getByRole('button', { name: '配成一对', exact: true }).click()
    await expect.poll(() => readFileSync(join(vault, NOTE), 'utf8')).toContain('read-along: https://zh.d2l.ai/')

    // 翻到 2.1（地址栏，算人翻过去的），往下滚到「索引和切片」下面第一段压着读的那一行
    await go(page, NDARRAY)
    const box = (await web(page).locator('webview.on').boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    let ok = false
    for (let i = 0; i < 400 && !ok; i++) {
      const t = await target(page)
      const line = t ? t.vh * 0.18 : 0
      if (t && t.top <= line - 4 && t.bottom >= line + 4) ok = true
      else await page.mouse.wheel(0, t && t.top < line ? -40 : 60), await page.waitForTimeout(30)
    }
    expect(ok).toBe(true)
    const para = (await target(page))!.text
    await expect(page.locator('.pane:not([hidden])').getByRole('button', { name: /^对着看/ })).toContainText('读到 2.1.4. 索引和切片', { timeout: 10_000 })
    await shot(run, 'd2l-2-reading')
    await expect.poll(() => JSON.parse(readFileSync(join(vault, '.canvas-notes/读到哪.json'), 'utf8'))['https://zh.d2l.ai/']?.text ?? '', { timeout: 10_000 }).toContain(para.slice(0, 10))

    // 换一台 Mac（新的本机设置）：点这篇，网页在右栏开到 2.1、回到那段、亮一下
    await run.close({ keep: true })
    run = await launch({ 'x.md': '# x\n' }, { CN_VAULT: vault })
    dirs.push(dirname(run.vault))
    page = run.page
    await openTreeNote(page)
    await expect(web(page)).toBeVisible()
    await expect.poll(() => guest(page, 'location.href'), { timeout: 60_000 }).toBe(NDARRAY)
    await expect
      .poll(async () => {
        const t = await target(page)
        return !!t && t.top > 0 && t.bottom < t.vh && t.flash
      }, { timeout: 30_000 })
      .toBe(true)
    await expect(toast(page)).toContainText('网页跟着开了：回到上次读到的「2.1.4. 索引和切片」那段')
    await shot(run, 'd2l-3-back')
  } finally {
    await run.close({ keep: true })
    for (const d of dirs) rmSync(d, { recursive: true, force: true, maxRetries: 5 })
  }
})
