/**
 * 读 PDF（PDF、HTML、网页上框着问）的对话在 userData/reading/<库 + 来源的 hash>.json；AI 对话菜单「最近在别处问的」要列它们。
 * 只读文件头没变的不重读（按修改时间记着上次读出来的那几样）。
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { type ChatSummary, readKey, readLabel } from '../../shared/ai-chats'
import type { ReadingState } from '../../shared/reading'

/** 读 PDF / HTML 记在本机的进度、会话文件名：库 + 路径的 hash */
export const readingKey = (root: string, pdf: string) => createHash('sha1').update(root + '\0' + pdf).digest('hex').slice(0, 16)

type Seen = { pdf: string; asks: number; at: number; title?: string }
const cache = new Map<string, { mtime: number; seen: Seen | null }>()

function summarize(p: string): Seen | null {
  let s: ReadingState
  try {
    s = JSON.parse(readFileSync(p, 'utf8')) as ReadingState
  } catch {
    // 写到一半的、坏了的：菜单里不列，读 PDF 那边打开时照旧报
    return null
  }
  if (!s || typeof s.pdf !== 'string' || !Array.isArray(s.msgs)) return null
  // 点「+」收起来的那几段也算：只问过以前那段、现在这段是空的，菜单里照样列这份 PDF（点进去从「之前的对话」切回）
  const all = [...s.msgs, ...(Array.isArray(s.older) ? s.older.flatMap((c) => (Array.isArray(c?.msgs) ? c.msgs : [])) : [])]
  const asks = all.filter((m) => m.role === 'user').length
  const at = all.reduce((t, m) => Math.max(t, typeof m.time === 'number' ? m.time : 0), 0)
  const title = Array.isArray(s.threads) ? [...s.threads].reverse().find((t) => t.web?.title)?.web?.title : undefined
  return { pdf: s.pdf, asks, at, ...(title ? { title } : {}) }
}

/** 这个库里问过的读 PDF 对话（没问过、只记着看到哪页的不列） */
export function readingChats(dir: string, root: string): ChatSummary[] {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw e
  }
  const out: ChatSummary[] = []
  for (const name of names) {
    if (!name.endsWith('.json') || name.endsWith('.sessions.json')) continue
    const p = join(dir, name)
    let mtime: number
    try {
      mtime = statSync(p).mtimeMs
    } catch {
      continue
    }
    let hit = cache.get(p)
    if (!hit || hit.mtime !== mtime) cache.set(p, (hit = { mtime, seen: summarize(p) }))
    const s = hit.seen
    // 文件名是「库 + 来源」的 hash：对得上才是这个库的
    if (!s || !s.asks || readingKey(root, s.pdf) !== name.slice(0, -5)) continue
    out.push({ key: readKey(s.pdf), label: readLabel(s.pdf, s.title), asks: s.asks, at: s.at })
  }
  return out
}
