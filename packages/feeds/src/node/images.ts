/**
 * 存进画布笔记时把正文里网上的图下到这篇的附件文件夹（`附件/<笔记路径>/`，@cn/format attachmentDir），正文改成相对路径。
 * 起名、认格式照画布笔记 apps/notes/src/main/web/save-image.ts（baseNameFor、sniffImage、撞名加 -2）；
 * 画布笔记用内置浏览器的登录分区下图，这里用普通的联网（要登录才看得到的图下不到，留网址）。以后抽进 packages/clip。
 */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWrite } from '@cn/atomic'
import { attachmentDir } from '@cn/format'
import type { Http } from './http'

const MAX_BYTES = 30 * 1024 * 1024

const TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
}

export function sniffImage(b: Uint8Array): string | null {
  const s = (i: number, str: string) => [...str].every((c, j) => b[i + j] === c.charCodeAt(0))
  if (b[0] === 0x89 && s(1, 'PNG')) return 'png'
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg'
  if (s(0, 'GIF8')) return 'gif'
  if (s(0, 'RIFF') && s(8, 'WEBP')) return 'webp'
  if (s(4, 'ftypavif')) return 'avif'
  if (s(0, 'BM')) return 'bmp'
  const head = Buffer.from(b.subarray(0, 512)).toString('utf8').trimStart().toLowerCase()
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'svg'
  return null
}

export function baseNameFor(hint: string | undefined, fallback = '图片'): string {
  let s = (hint ?? '').trim()
  try {
    if (/^https?:/i.test(s)) s = decodeURIComponent(new URL(s).pathname.split('/').pop() ?? '')
  } catch {
    s = ''
  }
  s = s.replace(/\.[a-z0-9]{1,5}$/i, '')
  s = s
    .replace(/[\\/:*?"<>|()[\]#%{}^`~!@$&=+;,'\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 48)
  return s || fallback
}

/** 下一张图存进 note 的附件文件夹，返回库内路径 */
export async function saveImage(http: Http, vault: string, note: string, url: string): Promise<string> {
  const res = await http.get(url, { accept: 'image/*,*/*;q=0.5', maxBytes: MAX_BYTES })
  const bytes = res.body
  if (!bytes.byteLength) throw new Error('图片是空的')
  const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
  const ext = sniffImage(bytes) ?? TYPES[type] ?? null
  if (!ext) throw new Error('这不是图片')
  const folder = attachmentDir(note)
  const dir = join(vault, folder)
  await mkdir(dir, { recursive: true })
  const base = baseNameFor(url)
  for (let n = 1; ; n++) {
    const name = `${base}${n > 1 ? `-${n}` : ''}.${ext}`
    try {
      await atomicWrite(join(dir, name), bytes, { exclusive: true })
      return `${folder}/${name}`
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
    }
  }
}
