/**
 * PDF 全文的缓存：pdf-blocks 拼好的每页段落块和每页宽高，按 PDF 内容指纹存在 userData/reading/text/<指纹>.b2.json。
 * PDF 标签打开时界面读完交来写一份；搜索进程给没打开过的 PDF 也读一份。两边拼法一样（shared/pdf-page-text.ts），谁先读到谁写。
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PdfBlock } from '@cn/format'

export interface PdfTextCache {
  pdf: string
  pages: PdfBlock[][]
  /** 每页的宽、高（页面单位）；早先界面写的缓存没有 */
  sizes?: [number, number][]
}

/** PDF 的内容指纹：sha1 的前 20 位 */
export const pdfHash = (data: Uint8Array) => createHash('sha1').update(data).digest('hex').slice(0, 20)

/** 块的拼法变了就换一个后缀（旧的缓存不再读，打开时重新拼）：b2 = 认出一格一格的短标签（stack） */
const BLOCKS_VERSION = 'b2'
const safe = (hash: string) => hash.replace(/[^0-9a-f]/g, '')
export const textCachePath = (userData: string, hash: string) => join(userData, 'reading', 'text', `${safe(hash)}.${BLOCKS_VERSION}.json`)

/** 读全文缓存（pdf.js 拼的）；没有是 null */
export function readTextCache(userData: string, hash: string): PdfTextCache | null {
  const p = textCachePath(userData, hash)
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as PdfTextCache) : null
}
