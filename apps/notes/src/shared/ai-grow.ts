/**
 * AI 写进文档、白板卡里的字一点点长出来（task-6kun1，照流光原型 A2「写一段」）：节奏、一次写进来很多时先显哪些、
 * 藏起来的那截在编辑器里怎么切。纯计算，不碰 DOM、不依赖 Electron；编辑器（renderer/ai-grow.ts）和白板卡（renderer/ai-card-grow.ts）都用它，
 * 单元测试在 test/ai-grow.test.ts。
 *
 * 只是显示：文件里的字一个不少（藏着的字照样在编辑器的文字里、照样存盘），打开再保存文件不变。
 */

/** 原型的节奏：每 60 毫秒出 2 个字（每秒约 33 个字） */
export const GROW_TICK = 60
export const GROW_STEP = 2
/** 一次写进来的最多 4 秒显完：长的加速（每一下多出几个字），不让人干等 */
export const GROW_MAX_MS = 4000
/** 一个字一个字显的最多 800 个字（按整段算：跨过 800 的那一段照样打完）；后面的段打到那里一下子全显出来 */
export const GROW_CHARS = 800
/** 一次改了很多处：只有前 8 处一个字一个字显（也只有它们画竖线），后面的直接显示 */
export const GROW_SPANS = 8
/** 边收边写（/ 菜单「AI 写一段」「AI 总结这页」）：落下的字 1.5 秒内追上 */
export const GROW_CATCHUP_MS = 1500

/** 知道一共多少个单位时，每一下出几个：原型 2 个；长的加速，GROW_MAX_MS 内显完 */
export function growStep(units: number): number {
  return Math.max(GROW_STEP, Math.ceil(units / Math.floor(GROW_MAX_MS / GROW_TICK)))
}

/** 边收边写：还差 backlog 个没显出来，这一下出几个（原型 2 个；落得多就快一点，GROW_CATCHUP_MS 内追上） */
export function catchUpStep(backlog: number): number {
  return Math.max(GROW_STEP, Math.ceil(backlog / Math.floor(GROW_CATCHUP_MS / GROW_TICK)))
}

/**
 * 一截要一点点显出来的字：from–to 是在文档里的范围。atom：一整块一下子显出来（表格、图片这些编辑器整块画的，
 * 不能从中间切开），只算 1 个单位
 */
export interface Seg {
  from: number
  to: number
  atom?: boolean
}

export const segUnits = (s: Seg) => (s.atom ? 1 : s.to - s.from)
export const unitsOf = (segs: readonly Seg[]) => segs.reduce((n, s) => n + segUnits(s), 0)

/**
 * 一个字一个字显到哪就一下子全显（cap ≤ 总单位数）：按段（空行分开）累计，过了 GROW_CHARS 的那一段打完，后面的不再一个字一个字等。
 * text(seg)：这一截的字（一整块的不用）
 */
export function capOf(segs: readonly Seg[], text: (s: Seg) => string): number {
  let acc = 0
  const total = unitsOf(segs)
  for (const s of segs) {
    if (s.atom) {
      acc += 1
      if (acc >= GROW_CHARS) return acc
      continue
    }
    const t = text(s)
    let i = 0
    while (i < t.length) {
      const j = t.indexOf('\n\n', i)
      const end = j < 0 ? t.length : j + 2
      acc += end - i
      i = end
      if (acc >= GROW_CHARS) return Math.min(acc, total)
    }
  }
  return total
}

/** 第 ticks 下的时候显到几个单位：step 一下，打到 cap 就全显 */
export function shownAt(ticks: number, step: number, cap: number, units: number): number {
  const n = Math.max(0, ticks) * step
  return n >= cap ? units : n
}

/** 一行在文档里的范围（行首、行尾，不含换行） */
export type LineAt = (pos: number) => { from: number; to: number }

/**
 * 已经显到第 shown 个单位时，编辑器里要藏起来的几截 [from, to)，按文档顺序、不重叠（用不跨块的 Decoration.replace 藏）：
 * - 一截从行首开始（这一行一个字都还没显）：往前多藏一个换行，接在上一行后面，不留一行空的、也不带出这一行的标题样子；
 *   上一行是整块画的（表格、图片，keepBreak 说是）时不往前多藏，免得和那一块搅在一起；
 * - 一截在行首结束（写进来的字以换行结尾）：最后那个换行不藏，下一行照样是自己的一行
 */
export function hiddenRanges(segs: readonly Seg[], shown: number, lineAt: LineAt, keepBreak: (pos: number) => boolean = () => false): { from: number; to: number }[] {
  const raw: [number, number][] = []
  let left = shown
  for (const s of segs) {
    const u = segUnits(s)
    if (left >= u) {
      left -= u
      continue
    }
    raw.push(s.atom ? [s.from, s.to] : [s.from + left, s.to])
    left = 0
  }
  const out: { from: number; to: number }[] = []
  for (const [a, b] of raw) {
    if (a >= b) continue
    let from = a
    let to = b
    if (from > 0 && lineAt(from).from === from && !keepBreak(from - 1)) from -= 1
    if (to > from + 1 && lineAt(to).from === to) to -= 1
    if (from >= to) continue
    const last = out.at(-1)
    if (last && from <= last.to) last.to = Math.max(last.to, to)
    else out.push({ from, to })
  }
  return out
}

/** 写进来的字里第一个不是空白的位置、最后一个不是空白的后面（竖线、「AI 在写这一段」挂在这一截上）；全是空白返回 null */
export function trimSpan(text: string, from: number): { from: number; to: number } | null {
  const lead = text.length - text.trimStart().length
  const body = text.trim()
  if (!body) return null
  return { from: from + lead, to: from + lead + body.length }
}
