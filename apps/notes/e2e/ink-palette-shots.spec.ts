/**
 * 墨水色板和深色便签纸的截图（交付页 143「橙色和深色便签」）：薄荷、深湖各一张白板，红、蓝、橙、黑四种墨水各写一笔，
 * 空白处、卡上、黄便签上、蓝便签上都有；文件里记的是旧红、旧蓝、旧橙（#d64545、#2459c6、#e08a00），看「旧值照新值画」。
 * CN_SHOTS=目录 时才截（文件名前缀 CN_SHOT_TAG，比改前改后用）；没给就只走一遍、核对四种墨水都画出来了。
 */
import { expect, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { acts, launch, openNote, pane } from './app'
import { scribble, underline } from './ink-samples'

const SHOTS = process.env.CN_SHOTS
const TAG = process.env.CN_SHOT_TAG ?? 'palette'

const BOARD = `---
type: board
---
# 色板白板

## 方向

驾驶压力识别 + 图网络。

<!-- card id=k1 ink=1 -->
情绪识别：E4 手环，唤醒和效价。

<!-- card id=n1 x=580 y=40 note=yellow rot=-2 ink=1 -->
问 Nima：数据什么时候给？

<!-- card id=n2 x=820 y=40 note=blue rot=2 ink=1 -->
周五前交初稿。
`
const PATH = '色板白板.md'
const INK_PATH = '附件/色板白板/笔迹.ink'
const COLORS = ['#1d2421', '#d64545', '#2459c6', '#e08a00']
const lines = ['{"ink":1}']
let n = 0
function group(id: string, on: string | null, x: number, y: number, len: number, under: boolean) {
  lines.push(`{"g":"${id}"${on ? `,"on":"${on}"` : ''},"x":${x},"y":${y}}`)
  COLORS.forEach((c, i) => {
    n++
    lines.push(`{"id":"s${String(n).padStart(7, '0')}","g":"${id}","pen":"pen","c":"${c}","seed":${n},"p":"${under ? underline(len) : scribble(len, n)}"}`.replace(/"p":"(-?\d+),(-?\d+),/, (_m, x0, y0) => `"p":"${x0},${Number(y0) + i * 2400},`))
  })
}
group('gfree001', null, 620, 330, 160, false)
group('gcard001', 'k1', 16, 60, 150, true)
group('gnote001', 'n1', 20, 70, 140, true)
group('gnote002', 'n2', 20, 70, 140, true)
const INK = lines.join('\n') + '\n'

for (const skin of ['mint', 'petrol'] as const) {
  test(`墨水色板截图：${skin}`, async () => {
    test.setTimeout(120_000)
    if (SHOTS) mkdirSync(SHOTS, { recursive: true })
    const run = await launch({ [PATH]: BOARD, [INK_PATH]: INK }, {}, (vault) => {
      const ud = join(vault, '..', 'user-data')
      mkdirSync(ud, { recursive: true })
      writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin, frame: 'b' } }))
    })
    const { page } = run
    try {
      await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1512, 888))
      await openNote(page, '色板白板')
      await acts(page).getByRole('tab', { name: '白板' }).click()
      const board = pane(page).getByTestId('doc-board')
      await expect(board.getByTestId('db-ink')).toHaveAttribute('data-strokes', String(n))
      const hint = board.locator('.db-hint-x').first()
      if (await hint.isVisible().catch(() => false)) await hint.click()
      await page.waitForTimeout(600)
      if (SHOTS) {
        const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
        writeFileSync(join(SHOTS, `${TAG}-mac-${skin}.png`), Buffer.from(b64, 'base64'))
      }
    } finally {
      await run.close()
    }
  })
}
