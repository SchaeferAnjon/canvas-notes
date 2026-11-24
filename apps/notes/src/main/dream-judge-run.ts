/**
 * 梦游判断走哪一家（设置 › 梦游「AI判断补双链」，task-h7oy8）：这台 Mac 上登录的命令行（Claude Code、Codex…），用订阅额度；
 * 同时问 4 篇（CN_DREAM_JUDGE_PARALLEL 能调）。软件自己跑的本地模型试过（真库上准确率五六成），2026-11-23 用户定去掉。
 */
import { pickLabel } from '../shared/ai-features'
import type { DreamJudge } from '../shared/dream-settings'
import { chatRun } from './agent'
import { ask } from './ai'
import type { JudgeAsk } from './dream-links'
import { judgeLine, type JudgeLine } from './dream-judge'

/** 一问最多等几分钟（命令行起进程要时间） */
const TIMEOUT = 5 * 60_000

const within = (signal?: AbortSignal) => (signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT)]) : AbortSignal.timeout(TIMEOUT))

export function judgeRunner(j: DreamJudge): { ask: JudgeAsk; by: string; parallel: number; line: JudgeLine } {
  const pick = { engine: j.engine, ...(j.model ? { model: j.model } : {}), ...(j.effort ? { effort: j.effort } : {}) }
  return {
    ask: (system, prompt, signal) => ask(system, prompt, within(signal), undefined, 'dream', { pick }),
    by: pickLabel({ engine: j.engine, ...chatRun(j.engine, pick) }),
    parallel: Number(process.env.CN_DREAM_JUDGE_PARALLEL) || 4,
    line: judgeLine(j),
  }
}
