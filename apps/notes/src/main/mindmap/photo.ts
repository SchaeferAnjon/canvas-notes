/**
 * 照片先放进一个临时文件夹（用户可能取消，不进库）。iPhone 的 HEIC 界面和 AI 都看不了，用系统的 sips 转成 JPEG；
 * 给 AI 的那份长边缩到 1600（再大 AI 也是先缩小，传得慢）。
 */
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { sniffImage } from '../web/save-image'
import { atomicWrite } from '@cn/atomic'

const run = promisify(execFile)
export const MAX_PHOTO = 40 * 1024 * 1024

export function isHeic(b: Uint8Array): boolean {
  const brand = Buffer.from(b.subarray(4, 12)).toString('latin1')
  return /^ftyp(heic|heix|hevc|hevx|mif1|msf1|heim|heis)$/.test(brand)
}

export interface Staged {
  id: string
  file: string
  ext: string
  mime: string
}

const MIME: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' }

/** 存一张照片进临时文件夹；不是图、太大、格式界面看不了都说清楚 */
export async function stagePhoto(dir: string, bytes: Uint8Array): Promise<Staged> {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw new Error('照片是空的')
  if (bytes.byteLength > MAX_PHOTO) throw new Error('照片太大（超过 40MB）')
  await mkdir(dir, { recursive: true })
  const id = randomUUID()
  if (isHeic(bytes)) {
    const src = join(dir, `${id}.heic`)
    const file = join(dir, `${id}.jpg`)
    await atomicWrite(src, bytes)
    try {
      await run('/usr/bin/sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '90', src, '--out', file], { timeout: 60_000 })
    } catch (e) {
      throw new Error(`HEIC 照片转不成 JPEG：${(e as Error).message}`)
    } finally {
      await rm(src, { force: true })
    }
    return { id, file, ext: 'jpg', mime: 'image/jpeg' }
  }
  const ext = sniffImage(bytes)
  if (!ext || !MIME[ext]) throw new Error(ext ? `这种格式（${ext}）认不了，换成 JPEG 或 PNG` : '这不是照片')
  const file = join(dir, `${id}.${ext}`)
  await atomicWrite(file, bytes)
  return { id, file, ext, mime: MIME[ext]! }
}

/** 给 AI 看的那份：长边 1600 的 JPEG，base64 */
export async function forAi(file: string, tmpDir: string): Promise<{ mime: string; base64: string }> {
  const out = join(tmpDir, `${randomUUID()}-ai.jpg`)
  try {
    await run('/usr/bin/sips', ['-Z', '1600', '-s', 'format', 'jpeg', '-s', 'formatOptions', '85', file, '--out', out], { timeout: 60_000 })
    return { mime: 'image/jpeg', base64: (await readFile(out)).toString('base64') }
  } finally {
    await rm(out, { force: true })
  }
}
