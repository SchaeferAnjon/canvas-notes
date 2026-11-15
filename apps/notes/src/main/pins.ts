/** 置顶列表存在库里的 .canvas-notes/置顶.json（和首页设置同一个文件夹，跟着 Git 走） */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { movePin, normalizePins, pinsJson, PINS_FILE, setPin } from '../shared/sidebar'
import type { Vault } from './vault'

export async function readPins(vault: Vault): Promise<string[]> {
  try {
    return normalizePins(JSON.parse(await readFile(vault.abs(PINS_FILE), 'utf8')))
  } catch (e) {
    // 没有文件是还没置顶过；文件坏了（手改、合并冲突）当没置顶，不挡着左栏
    if ((e as NodeJS.ErrnoException).code === 'ENOENT' || e instanceof SyntaxError) return []
    throw e
  }
}

async function writePins(vault: Vault, pins: string[]): Promise<string[]> {
  const text = pinsJson(pins)
  const p = vault.abs(PINS_FILE)
  const cur = await readFile(p, 'utf8').catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'ENOENT') return null
    throw e
  })
  // 一样就不写，免得 Git 里多出假改动；还没置顶过、也没要置顶的，不建文件
  if (cur !== text && !(cur === null && pins.length === 0)) {
    await mkdir(dirname(p), { recursive: true })
    await writeFile(p, text)
  }
  return normalizePins(pins)
}

export async function pinNote(vault: Vault, path: string, on: boolean): Promise<string[]> {
  vault.abs(path)
  return writePins(vault, setPin(await readPins(vault), path, on))
}

/** 改名、挪走、删掉之后：置顶跟着换路径或拿掉；没置顶这篇就什么都不写 */
export async function repin(vault: Vault, from: string, to: string | null): Promise<void> {
  const pins = await readPins(vault)
  if (!pins.includes(from)) return
  await writePins(vault, movePin(pins, from, to))
}
