/**
 * 从 AI 回答里的引用 ⌘点开一篇（task-3e53q 已定 3）：中间换了一篇，右栏 AI 不跟着换对话，留在点它的那段（旁支也留着）。
 * cite.tsx 开之前叫 stayAi()；AiDock 在中间那一篇换了的那一下拿走它（takeStay），把刚才看着的那段当「别处的对话」留着，
 * 头上那一行换成「切到《X》的 AI」（命令 ai-follow，键在命令表里能改）。平时切标签照旧跟着换。
 */

/** 中间这一下没换成（点的就是开着的那篇）：过一会儿就作废，不影响之后自己切标签 */
const WINDOW_MS = 1500

let at = 0

export function stayAi() {
  at = Date.now()
}

export function takeStay(): boolean {
  const ok = Date.now() - at < WINDOW_MS
  at = 0
  return ok
}
