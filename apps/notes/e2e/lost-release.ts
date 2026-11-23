/**
 * 真鼠标（CDP 的 Input.dispatchMouseEvent，和 Playwright 的 page.mouse 走同一条路），多一样「松手丢在窗口外」（task-0nz63）：
 * 透明窗口外松手页面收不到 mouseup / pointerup，之后只收到按键已经松开的移动。Playwright 的 page.mouse.up 在窗口外也会送到页面，
 * 做不出这个，所以整次拖动都用这里的（不和 page.mouse 混用：它记着的按键状态对不上）。
 */
import type { Page } from '@playwright/test'

type Btn = 'left' | 'middle'
const BIT: Record<Btn, number> = { left: 1, middle: 4 }

export async function realMouse(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  let at = { x: 0, y: 0 }
  let held: Btn | null = null
  const send = (type: 'mouseMoved' | 'mousePressed' | 'mouseReleased', x: number, y: number, buttons: number, button: Btn | 'none', modifiers = 0) =>
    cdp.send('Input.dispatchMouseEvent', { type, x, y, buttons, button, modifiers, clickCount: type === 'mouseMoved' ? 0 : 1 })
  return {
    /** 移过去（不按键） */
    async move(x: number, y: number, steps = 1) {
      for (let i = 1; i <= steps; i++) await send('mouseMoved', at.x + ((x - at.x) * i) / steps, at.y + ((y - at.y) * i) / steps, 0, 'none')
      at = { x, y }
    },
    /** 在这里按下 */
    async down(x: number, y: number, button: Btn = 'left') {
      await this.move(x, y)
      held = button
      await send('mousePressed', x, y, BIT[button], button)
    },
    /** 按着拖到这里，一路 steps 下 */
    async drag(x: number, y: number, steps = 8) {
      const b = held ?? 'left'
      const from = at
      for (let i = 1; i <= steps; i++) await send('mouseMoved', from.x + ((x - from.x) * i) / steps, from.y + ((y - from.y) * i) / steps, BIT[b], b)
      at = { x, y }
    },
    /** 正常松手 */
    async up() {
      const b = held ?? 'left'
      held = null
      await send('mouseReleased', at.x, at.y, 0, b)
    },
    /** 松手丢在窗口外：不送松手，之后鼠标回到 (x, y)，一路只是按键已松开的移动 */
    async lost(x: number, y: number, steps = 4) {
      held = null
      await this.move(x, y, steps)
    },
    async click(x: number, y: number) {
      await this.down(x, y)
      await this.up()
    },
  }
}
