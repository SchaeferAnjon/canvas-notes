/**
 * 「让 Claude 帮我找」：前两层都没找到时，Claude Code 只拿只读的 Read、Glob、Grep 自己翻库里的文件（几秒到十几秒）。
 * 每调一次工具报一步（读了哪个文件、搜了什么），最后交一行 JSON：找到的文件、页码、一句为什么。
 * 用快模型（Haiku）；找的过程不改任何文件、不留会话。
 */
import { relative, sep } from 'node:path'
import type { ClaudeFound } from '../../shared/search'

export const FIND_SYSTEM = `你在帮一个人在他自己的笔记库里找东西。库就是当前工作目录，里面是 md 笔记、PDF 课件和 HTML 可视化。
- 只用 Glob、Grep、Read 看文件，什么都不改。PDF 可以直接 Read（给 pages 读几页）。
- 「<课件名> 笔记.md」是他读那份 PDF 时问过的问题原话和 AI 的回答（一份 PDF 一篇，按页一段）；看视频时问的在文档里「我的疑惑」开头的问答块。
- 先用 Grep 按他的话和相近的说法（中英文都试）搜，再 Read 最像的几个确认。不要把整个库都读一遍。
- 最后单独一行输出 JSON，别的什么都不要：{"found":[{"path":"库里的相对路径","page":页码（PDF 才有，没有就不写）,"why":"一句话为什么是它，尽量引原文"}]}
- 最多 5 条，最像的在前；实在没有就输出 {"found":[]}。`

export const findPrompt = (q: string) => `帮他在库里找：${q}`

/** 回答里最后那个带 found 的 JSON；路径一律变成库内相对路径，库外的、空的丢掉 */
export function parseFound(text: string, root: string): ClaudeFound[] {
  const m = [...text.matchAll(/\{[\s\S]*?"found"[\s\S]*\}/g)].pop()
  if (!m) return []
  let raw: { found?: unknown }
  try {
    raw = JSON.parse(m[0]) as { found?: unknown }
  } catch {
    return []
  }
  if (!Array.isArray(raw.found)) return []
  const out: ClaudeFound[] = []
  for (const f of raw.found as Record<string, unknown>[]) {
    if (!f || typeof f.path !== 'string' || !f.path.trim()) continue
    let p = f.path.trim()
    if (p.startsWith('/')) p = relative(root, p).split(sep).join('/')
    p = p.replace(/^\.\//, '')
    if (!p || p.startsWith('..')) continue
    const page = typeof f.page === 'number' && Number.isInteger(f.page) && f.page > 0 ? f.page : undefined
    out.push({ path: p, why: typeof f.why === 'string' ? f.why.trim() : '', ...(page ? { page } : {}) })
    if (out.length === 5) break
  }
  return out
}

/** 工具调用写成一步人话：「搜「矩阵」」「读 课程/线性代数/第3讲 笔记.md」 */
export function toolStep(name: string, input: Record<string, unknown>, root: string): string | null {
  const rel = (p: unknown) => (typeof p === 'string' ? (p.startsWith('/') ? relative(root, p).split(sep).join('/') : p) : '')
  if (name === 'Grep') return `搜「${String(input.pattern ?? '')}」${input.path ? ` · ${rel(input.path)}` : ''}`
  if (name === 'Glob') return `列出 ${String(input.pattern ?? '')}`
  if (name === 'Read') return `读 ${rel(input.file_path)}${typeof input.pages === 'string' ? ` 第 ${input.pages} 页` : ''}`
  return null
}
