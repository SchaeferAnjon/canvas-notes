/**
 * AI 输入框里粘贴 / 拖进来的图（CN-24）：存在软件设置目录的 pasted/（不进库、不进 Git），
 * 发给引擎时读出来；界面用 cn-file://app/pasted/<名字> 显示。
 */
import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { EngineImage } from './agent/engines'

/** 一次最多带几张 */
export const MAX_PASTED = 4
const NAME = /^[0-9a-f-]{36}\.(png|jpg)$/

let dir = ''

export function setupPasted(appDir: string) {
  dir = join(appDir, 'pasted')
  ipcMain.handle('ai:paste', async (_e, bytes: unknown, mime: unknown) => {
    if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > 20 * 1024 * 1024) throw new Error('这张图不对（最大 20 MB）')
    const ext = mime === 'image/jpeg' ? 'jpg' : 'png'
    const name = `${randomUUID()}.${ext}`
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, name), bytes)
    return name
  })
}

/** 界面给的名字 → 发给引擎的图（名字不对的报错，不读别的文件） */
export async function pastedImages(names: unknown): Promise<EngineImage[]> {
  if (names === undefined) return []
  if (!Array.isArray(names) || names.length > MAX_PASTED || !names.every((n) => typeof n === 'string' && NAME.test(n))) throw new Error('粘贴的图不对')
  return Promise.all(
    (names as string[]).map(async (n) => {
      const path = join(dir, n)
      return { mime: n.endsWith('.jpg') ? ('image/jpeg' as const) : ('image/png' as const), data: (await readFile(path)).toString('base64'), path }
    }),
  )
}
