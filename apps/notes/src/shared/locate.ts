/**
 * 读 PDF 时贴进来的截图（粘贴、拖进来的图）是这份 PDF 的哪一页哪一段（0.5.9，用户：「直接截图发过去之后……它不会自动判断这个笔记属于哪里」）：
 * 图里认出的字（macOS Vision，主进程 reading:ocr）切成三个词一串，去每一页的字里找；只在一页里出现的串算得重，页眉页脚那种每页都有的不算数。
 * 找到了给那一页和那几块（框住那一段）；找不到时分两种：认出的字多半不在这份 PDF 里（别处的截图，foreign），或者没认出几个字（公式、图，照正看着的那页）。
 */
import type { PdfBlock } from '@cn/format'

/** 切成词：英文、数字一个词（小写），中日韩一个字一个词 */
export function tokens(s: string): string[] {
  return s.normalize('NFKC').toLowerCase().match(/[a-z0-9]+|[぀-ヿ㐀-鿿]/g) ?? []
}

/** 三个词一串（中文三个字） */
function shingles(ws: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i + 2 < ws.length; i++) out.push(`${ws[i]} ${ws[i + 1]} ${ws[i + 2]}`)
  return out
}

/** 算数的词：英文三个字母以上、中文每个字 */
const meaningful = (w: string) => w.length >= 3 || /^[぀-ヿ㐀-鿿]$/.test(w)

export type ShotPlace = { page: number; blocks: PdfBlock[] } | { page: 0; foreign: boolean }

/**
 * pages[i] 是第 i+1 页的块（没读到的页是空的）。认出是哪一页：给页码和对上的那几块；
 * 认不出：foreign = 认出了不少字（6 个以上算数的词）、可一半以上这份 PDF 里根本没有
 */
export function locateShot(ocr: string, pages: PdfBlock[][]): ShotPlace {
  const ws = tokens(ocr)
  const mine = new Set(shingles(ws))
  const perPage = pages.map((bs) => new Set(shingles(tokens(bs.filter((b) => b.kind !== 'image').map((b) => b.text).join('\n')))))
  // 一串在几页里出现过：只在一页的算 1，每页都有的（页眉页脚）几乎不算
  const df = new Map<string, number>()
  for (const s of mine) df.set(s, perPage.filter((p) => p.has(s)).length)
  const scores = perPage.map((p) => [...mine].reduce((n, s) => (p.has(s) ? n + 1 / df.get(s)! : n), 0))
  const order = scores.map((s, i) => [s, i] as const).sort((a, b) => b[0] - a[0])
  const [best, second] = [order[0], order[1]]
  if (best && best[0] >= 2 && (!second || best[0] >= second[0] * 1.5)) {
    const page = best[1] + 1
    // 那一段：这一页里有只在这一页出现的串的那几块
    const blocks = pages[best[1]]!.filter((b) => b.kind !== 'image' && shingles(tokens(b.text)).some((s) => mine.has(s) && df.get(s) === 1))
    return { page, blocks }
  }
  const real = ws.filter(meaningful)
  if (real.length < 6) return { page: 0, foreign: false }
  const vocab = new Set(pages.flatMap((bs) => bs.flatMap((b) => tokens(b.text))))
  const known = real.filter((w) => vocab.has(w)).length
  return { page: 0, foreign: known / real.length < 0.5 }
}

/** 那几块在这一页上的外框（比例，左、上、宽、高）；size 是这一页的宽高（和块同一种单位） */
export function blocksRect(blocks: PdfBlock[], size: { w: number; h: number }): [number, number, number, number] | undefined {
  if (!blocks.length || size.w <= 0 || size.h <= 0) return undefined
  const x0 = Math.min(...blocks.map((b) => b.x))
  const y0 = Math.min(...blocks.map((b) => b.y))
  const x1 = Math.max(...blocks.map((b) => b.x + b.w))
  const y1 = Math.max(...blocks.map((b) => b.y + b.h))
  const r = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000
  return [r(x0 / size.w), r(y0 / size.h), r((x1 - x0) / size.w), r((y1 - y0) / size.h)]
}
