/**
 * ⌘K 的自定义存在库里的 .canvas-notes/命令.json（跟着 Git 走；DESIGN.v3 3.3）。
 * 还有自己设的快捷键：网页、视频有焦点时按键先到主进程（before-input-event），界面把要接的组合键交过来，
 * 这里认出来转给界面（app:key「combo:⌥⌘S」）；菜单栏上拍一张导图、设置… 显示的键跟着换。
 */
import { ipcMain } from 'electron'
import { readFile } from 'node:fs/promises'
import { type CmdConfig, commandsJson, COMMANDS_FILE, normalizeCommands, sameAsDefault } from '../shared/commands'
import { comboOf, isCombo, type KeyLike } from '../shared/cmd-keys'
import { writeFileAtomic } from './atomic'
import type { Vault } from './vault'

export async function readCommands(vault: Vault): Promise<CmdConfig> {
  try {
    return normalizeCommands(JSON.parse(await readFile(vault.abs(COMMANDS_FILE), 'utf8')))
  } catch (e) {
    // 没有文件是还没改过；文件坏了（手改错、合并冲突）当没改过，不挡着 ⌘K
    if ((e as NodeJS.ErrnoException).code === 'ENOENT' || e instanceof SyntaxError) return normalizeCommands(null)
    throw e
  }
}

/** 界面交来的整份（先过一遍 normalize 再写）；和盘上一样不写，还是默认的样子又没有文件时不建 */
export async function writeCommands(vault: Vault, raw: unknown): Promise<CmdConfig> {
  const c = normalizeCommands(raw)
  const p = vault.abs(COMMANDS_FILE)
  const cur = await readFile(p, 'utf8').catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'ENOENT') return null
    throw e
  })
  if (!(cur === null && sameAsDefault(c))) await writeFileAtomic(p, commandsJson(c))
  return c
}

/** 网页有焦点时要转给界面的组合键 */
let forward = new Set<string>()
/** 菜单栏上显示的键：拍一张导图、设置…（null 是这一条现在没有键） */
export interface MenuKeys {
  capture: string | null
  settings: string | null
}
let menuKeys: MenuKeys = { capture: '⇧⌘C', settings: '⌘,' }
export const currentMenuKeys = (): MenuKeys => menuKeys

/** 网页、视频里按下的键是不是要转给界面的：是就给「combo:⌥⌘S」 */
export function forwardedKey(input: KeyLike & { type?: string }): string | null {
  if (input.type && input.type !== 'keyDown') return null
  const c = comboOf(input)
  return c && forward.has(c) ? `combo:${c}` : null
}

export function registerCommands(getVault: () => Vault, rebuildMenu: () => void) {
  ipcMain.handle('cmds:get', () => readCommands(getVault()))
  ipcMain.handle('cmds:set', (_e, c: unknown) => writeCommands(getVault(), c))
  ipcMain.handle('cmds:keys', (_e, raw: unknown) => {
    const o = (raw && typeof raw === 'object' ? raw : {}) as { forward?: unknown; menu?: Partial<Record<keyof MenuKeys, unknown>> }
    forward = new Set(Array.isArray(o.forward) ? o.forward.filter(isCombo) : [])
    const pick = (v: unknown) => (isCombo(v) ? v : null)
    const next: MenuKeys = { capture: pick(o.menu?.capture), settings: pick(o.menu?.settings) }
    if (next.capture !== menuKeys.capture || next.settings !== menuKeys.settings) {
      menuKeys = next
      rebuildMenu()
    }
  })
}
