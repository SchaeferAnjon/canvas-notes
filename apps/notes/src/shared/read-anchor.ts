/**
 * 网页上「那一段」怎么记、怎么找回（task-kbnc0，照 Hypothesis 的做法：存那段字和前后文，网页改了先模糊找，找不到再按滚动比例停）。
 * 输入是网页上一块块的字（段落、列表项、代码、小标题，按先后），纯函数：网页预加载用它，单元测试也测它。
 */
import type { ReadAnchor } from './read-along'

const MAX = 80
const CTX = 32
/** 开头一句太短（「是的。」）就多带一些字，不然到处都对得上 */
const MIN = 16

export const normText = (s: string) => s.replace(/\s+/g, ' ').trim()

/** 那段的开头一句（最多 80 字） */
export function firstSentence(block: string): string {
  const t = normText(block)
  const m = /^[\s\S]*?[。！？!?；;]|^[\s\S]*?\.(?=\s)/.exec(t.slice(0, MAX))
  // 80 字里没有句号：前 80 字就是「开头一句」；句子太短：带到 48 字
  const s = !m ? t : m[0].length >= MIN ? m[0] : t.slice(0, MIN * 3)
  return s.slice(0, MAX)
}

/** 第 i 块的记法：开头一句，前面 32 个字（前几块拼起来的末尾），后面 32 个字（开头一句后面接着的字） */
export function anchorAt(blocks: readonly string[], i: number): ReadAnchor {
  const t = normText(blocks[i] ?? '')
  const text = firstSentence(t)
  let before = ''
  for (let j = i - 1; j >= 0 && before.length < CTX; j--) before = normText(blocks[j]!) + (before ? ' ' + before : '')
  let after = t.slice(text.length).trim()
  for (let j = i + 1; j < blocks.length && after.length < CTX; j++) after = (after ? after + ' ' : '') + normText(blocks[j]!)
  return { text, before: before.slice(-CTX), after: after.slice(0, CTX) }
}

/** 两段字有多像（字两两一组的 Dice 系数，0–1） */
export function likeness(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  const grams = (s: string) => {
    const m = new Map<string, number>()
    for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1)
    return m
  }
  const A = grams(a)
  const B = grams(b)
  let both = 0
  for (const [g, n] of A) both += Math.min(n, B.get(g) ?? 0)
  const total = Math.max(1, a.length - 1 + (b.length - 1))
  return (2 * both) / total
}

/** 前后文对得上多少：前面看末尾，后面看开头 */
function contextScore(blocks: readonly string[], i: number, a: ReadAnchor): number {
  const here = anchorAt(blocks, i)
  return likeness(here.before, a.before) + likeness(here.after, a.after)
}

/** 模糊找时，多像才算同一段 */
export const FUZZY_MIN = 0.72

/**
 * 找回那一段：先找开头一句一字不差的（几处都有时看前后文），没有就找最像的一段（够像才算），都没有是 null（这时按滚动比例停，说一句）
 */
export function findAnchor(blocks: readonly string[], a: ReadAnchor): { index: number; how: 'exact' | 'fuzzy' } | null {
  const text = normText(a.text)
  if (!text) return null
  const norm = blocks.map(normText)
  let hits = norm.flatMap((b, i) => (b.startsWith(text) ? [i] : []))
  if (!hits.length) hits = norm.flatMap((b, i) => (b.includes(text) ? [i] : []))
  if (hits.length === 1) return { index: hits[0]!, how: 'exact' }
  if (hits.length > 1) {
    let best = hits[0]!
    let score = -1
    for (const i of hits) {
      const s = contextScore(norm, i, a)
      if (s > score) ((best = i), (score = s))
    }
    return { index: best, how: 'exact' }
  }
  // 网页改了几个字：开头一句和每一段同样长的开头比，最像的够像才算；一样像时看前后文
  let best = -1
  let score = 0
  for (let i = 0; i < norm.length; i++) {
    const s = likeness(text, norm[i]!.slice(0, text.length + 4))
    const ctx = s >= FUZZY_MIN ? contextScore(norm, i, a) / 4 : 0
    if (s + ctx > score) ((best = i), (score = s + ctx))
  }
  if (best >= 0 && likeness(text, norm[best]!.slice(0, text.length + 4)) >= FUZZY_MIN) return { index: best, how: 'fuzzy' }
  return null
}
