/**
 * 白板装饰 e2e 共用（decor-*.spec.ts）：起软件开那块组会白板、读盘上的 md 和笔迹文件、白板坐标换窗口坐标、真鼠标拖。
 */
import { expect, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { acts, launch, openNote, pane, type Running } from './app'
import { BOARD, BOARD_PATH, INK_PATH } from './decor-samples'

export type Skin = 'mint' | 'petrol'

export async function openDecorBoard(files: Record<string, string | Uint8Array> = {}, skin: Skin = 'mint', extra: Record<string, unknown> = {}) {
  const run = await launch({ [BOARD_PATH]: BOARD, ...files }, {}, (vault) => {
    const ud = join(vault, '..', 'user-data')
    mkdirSync(ud, { recursive: true })
    writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin, frame: 'b' }, ...extra }))
  })
  const { page } = run
  await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1512, 900))
  await expect.poll(() => page.evaluate(() => innerHeight)).toBe(900)
  await openNote(page, '11.24 组会准备')
  await acts(page).getByRole('tab', { name: '白板' }).click()
  const board = pane(page).getByTestId('doc-board')
  await expect(board).toBeVisible()
  // 顶上那条一次性的说明点掉
  const hint = board.locator('.db-hint-x').first()
  if (await hint.isVisible().catch(() => false)) await hint.click()
  await page.waitForTimeout(300)
  return { run, page, board }
}

export const files = (run: Running) => ({
  md: () => readFileSync(join(run.vault, BOARD_PATH), 'utf8'),
  ink: () => (existsSync(join(run.vault, INK_PATH)) ? readFileSync(join(run.vault, INK_PATH), 'utf8') : ''),
  commits: () => Number(execFileSync('git', ['-C', run.vault, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim()),
  lastMsg: () => execFileSync('git', ['-C', run.vault, 'log', '-1', '--format=%s'], { encoding: 'utf8' }).trim(),
})

/** 白板坐标 → 窗口坐标 */
export const toScreen = (page: Page, x: number, y: number) =>
  page.evaluate(([x, y]) => {
    const plane = document.querySelector<HTMLElement>('.db-plane')!
    const r = plane.getBoundingClientRect()
    const z = Number(getComputedStyle(plane).zoom) || 1
    return { x: r.left + x * z, y: r.top + y * z, z }
  }, [x, y] as const)

/** 真鼠标从 a 拖到 b（中间走几步） */
export async function drag(page: Page, a: { x: number; y: number }, b: { x: number; y: number }, steps = 12, beforeUp?: () => Promise<void>) {
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  for (let i = 1; i <= steps; i++) await page.mouse.move(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps)
  if (beforeUp) await beforeUp()
  await page.mouse.up()
}

/** 两份字：没了哪几行、多了哪几行（按整行比） */
export function diff(a: string, b: string) {
  const x = a.split('\n')
  const y = b.split('\n')
  return { removed: x.filter((l) => !y.includes(l)), added: y.filter((l) => !x.includes(l)) }
}

/** 一个元素的中心（窗口坐标） */
export async function center(page: Page, sel: string) {
  const b = await page.locator(sel).first().boundingBox()
  if (!b) throw new Error('看不见 ' + sel)
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}

export async function shot(run: Running, name: string) {
  const dir = process.env.CN_SHOTS
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  await run.page.waitForTimeout(350)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(dir, `${name}.png`), Buffer.from(b64, 'base64'))
}
