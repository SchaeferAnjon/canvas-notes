/**
 * 正在一次写进几千个文件（导入旧笔记）：这时别的地方别去「把没提交的都提交掉」（2026-11-26 导入卡死）。
 * 以前导到一半，自动提交（每 10 分钟）、闲时梦游（电脑 15 分钟没人动）会 git add -A 把写了一半的导入整个提交走
 * （实测 3000 篇导到第 5 分钟，梦游提交了「新增 4155 个文件」再开一份工作副本），导入那一次提交就不全了、撤回也撤不干净，
 * 梦游接着拿几千篇去问 AI。导入自己写完会提交一次。
 */
let running: string | null = null

/** 开始一次大批量写（what：给人看的，「导入旧笔记」）；返回结束时调的 */
export function beginBulk(what: string): () => void {
  running = what
  return () => {
    if (running === what) running = null
  }
}

/** 正在做的那件（没有是 null） */
export const bulkBusy = (): string | null => running

/**
 * AI 正在答、还没把这一轮提交完的有几轮（2026-11-26「AI 这一轮提交没成功」）：这时自动提交、闲时梦游先不「把没提交的都提交掉」，
 * 不然 AI 这一轮改到一半的文件被一个普通提交收走，这一轮结束时按自己的清单再提交就对不上，「撤回这一轮」也撤不全。
 * 这一轮结束自己提交（全能模式下连同这期间用户的字一起单独提交一次），下一轮自动提交照常
 */
let aiTurns = 0
export function aiTurnBegin(): () => void {
  aiTurns++
  let ended = false
  return () => {
    if (!ended) aiTurns--
    ended = true
  }
}
export const aiTurnsBusy = (): boolean => aiTurns > 0
