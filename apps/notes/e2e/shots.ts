/**
 * 交付截图（只在给了 CN_SHOTS 时截）：CN_SHOT_TONE=dark 时先换成深色主题（松林），文件名后面加「-dark」。
 * 截整个窗口从主进程截（屏幕外窗口里的 webview 只有这样截得对）；截一块用 Playwright 的元素截图。
 */
import type { Locator, Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Running } from './app'

const dir = () => process.env.CN_SHOTS
const dark = () => process.env.CN_SHOT_TONE === 'dark'
const file = (name: string) => join(dir()!, `${name}${dark() ? '-dark' : ''}.png`)

/** 截图模式下按要的深浅换主题；平时什么都不做 */
export async function shotTone(page: Page) {
  if (!dir() || !dark()) return
  // 设置存进主进程，界面重新载入一次才按新主题画（刚启动，还什么都没开）
  await page.evaluate(() => window.cn.setSettings({ appearance: { followSystem: false, skin: 'pine' } }))
  await page.reload()
  await page.locator('.vault b').waitFor()
  await page.waitForTimeout(300)
}

export async function shotWindow(run: Running, name: string) {
  if (!dir()) return
  await run.page.waitForTimeout(300)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(file(name), Buffer.from(b64, 'base64'))
}

export async function shotPart(el: Locator, name: string) {
  if (!dir()) return
  await el.page().waitForTimeout(200)
  await el.screenshot({ path: file(name) })
}
