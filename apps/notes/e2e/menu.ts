import { expect } from '@playwright/test'
import type { Running } from './app'

/** 系统右键菜单里的一项（测试读出来看） */
export interface MenuShot {
  label: string
  enabled: boolean
  type: string
  checked: boolean
  submenu?: MenuShot[]
}

type Held = { menu: Electron.Menu; cb?: () => void } | null

/**
 * 右键菜单是系统原生的，Playwright 看不到也点不到：把弹出换成「记下这个菜单、先不收」。
 * 之后 openedMenu() 读出这个菜单的项，pickMenu() 像人一样点其中一项（菜单这才收起）。其余都走真的代码。
 */
export async function armMenus(run: Running) {
  await run.app.evaluate(({ Menu }) => {
    const g = globalThis as unknown as { cnMenu: Held }
    g.cnMenu = null
    Menu.prototype.popup = function (this: Electron.Menu, opts?: Electron.PopupOptions) {
      g.cnMenu = { menu: this, cb: opts?.callback }
    }
  })
}

/** 等到弹出了一个菜单，读出它的项（分隔线是 —） */
export async function openedMenu(run: Running): Promise<MenuShot[]> {
  let shot: MenuShot[] | null = null
  await expect
    .poll(async () => {
      shot = await run.app.evaluate(() => {
        const g = globalThis as unknown as { cnMenu: Held }
        const read = (m: Electron.Menu): MenuShot[] =>
          m.items.map((i) => ({ label: i.type === 'separator' ? '—' : i.label, enabled: i.enabled, type: i.type, checked: i.checked, ...(i.submenu ? { submenu: read(i.submenu) } : {}) }))
        return g.cnMenu ? read(g.cnMenu.menu) : null
      })
      return shot !== null
    })
    .toBe(true)
  return shot!
}

/** 菜单里看得到的字（不含分隔线） */
export const menuLabels = (m: MenuShot[]) => m.filter((i) => i.type !== 'separator').map((i) => i.label)

/** 某一项灰没灰 */
export const enabledOf = (m: MenuShot[], label: string) => m.find((i) => i.label === label)?.enabled

/** 点开着的菜单里的一项；子菜单里的写成「转成 › 待办」 */
export async function pickMenu(run: Running, path: string) {
  await openedMenu(run)
  await run.app.evaluate((_e, path) => {
    const g = globalThis as unknown as { cnMenu: Held }
    const open = g.cnMenu!
    let items = open.menu.items
    let item: Electron.MenuItem | undefined
    for (const name of path.split(' › ')) {
      item = items.find((i) => i.label === name)
      if (!item) throw new Error(`菜单里没有「${name}」：${items.map((i) => i.label).join('、')}`)
      if (!item.enabled) throw new Error(`「${name}」是灰的`)
      items = item.submenu?.items ?? []
    }
    g.cnMenu = null
    item!.click()
    open.cb?.()
  }, path)
}

/** 不点，收起菜单（像按 Esc） */
export async function dismissMenu(run: Running) {
  await openedMenu(run)
  await run.app.evaluate(() => {
    const g = globalThis as unknown as { cnMenu: Held }
    const cb = g.cnMenu?.cb
    g.cnMenu = null
    cb?.()
  })
}

/** 系统剪贴板 */
export const clipboardText = (run: Running) => run.app.evaluate(({ clipboard }) => clipboard.readText())
export const setClipboard = (run: Running, text: string) => run.app.evaluate(({ clipboard }, t) => clipboard.writeText(t), text)
