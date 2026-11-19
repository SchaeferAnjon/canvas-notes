/**
 * AI 输入框里粘贴 / 拖进来的图（CN-24）：存在软件设置目录的 pasted/（不进库、不进 Git），
 * 发给引擎时读出来；界面用 cn-file://app/pasted/<名字> 显示。
 */
import { BrowserWindow, dialog, ipcMain, nativeImage } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { PASTED_NAME } from '../shared/materials'
import type { EngineImage } from './agent/engines'

/** 一次最多带几张 */
export const MAX_PASTED = 4
const NAME = PASTED_NAME
const MAX_BYTES = 20 * 1024 * 1024

let dir = ''

async function keep(bytes: Uint8Array, mime: unknown): Promise<string> {
  const ext = mime === 'image/jpeg' ? 'jpg' : 'png'
  const name = `${randomUUID()}.${ext}`
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, name), bytes)
  return name
}

export function setupPasted(appDir: string) {
  dir = join(appDir, 'pasted')
  ipcMain.handle('ai:paste', async (_e, bytes: unknown, mime: unknown) => {
    if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > MAX_BYTES) throw new Error('这张图不对（最大 20 MB）')
    return keep(bytes, mime)
  })
  // 输入框底行「+」加图（CN-91 方向 C）：系统选图框，选的图存进 pasted/（PNG、JPEG 原样，别的格式画成 PNG），返回名字和文件名；
  // room：输入框还放得下几张。测试模式里选图框被换成记录器（test-mode.ts），测试要用时自己再换
  ipcMain.handle('ai:paste:pick', async (e, room: unknown) => {
    const n = typeof room === 'number' && room > 0 ? Math.min(MAX_PASTED, Math.floor(room)) : 0
    if (!n) return []
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: Electron.OpenDialogOptions = { title: '加图', properties: ['openFile', 'multiSelections'], filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'bmp', 'tiff'] }] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled) return []
    const out: { name: string; label: string }[] = []
    for (const p of r.filePaths.slice(0, n)) {
      const raw = await readFile(p)
      if (!raw.length || raw.length > MAX_BYTES) throw new Error(`「${basename(p)}」不对（最大 20 MB）`)
      const jpeg = /\.jpe?g$/i.test(p)
      const png = /\.png$/i.test(p)
      let bytes: Uint8Array = raw
      if (!jpeg && !png) {
        const img = nativeImage.createFromBuffer(raw)
        if (img.isEmpty()) throw new Error(`「${basename(p)}」读不出来，换一张 PNG 或 JPEG`)
        bytes = img.toPNG()
      }
      out.push({ name: await keep(bytes, jpeg ? 'image/jpeg' : 'image/png'), label: basename(p) })
    }
    return out
  })
}

/** pasted/ 里一张图在这台 Mac 上的路径（记笔记时拷进库里的附件）；名字不对的报错，不碰别的文件 */
export function pastedPath(name: string): string {
  if (!NAME.test(name)) throw new Error('粘贴的图不对')
  return join(dir, name)
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
