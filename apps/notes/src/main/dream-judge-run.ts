/**
 * 梦游判断走哪条路（设置 › 梦游「AI判断补双链」，task-h7oy8，用户定「两种都做，让人来选」）：
 * - cli：这台 Mac 上登录的命令行（Claude Code、Codex…），用订阅额度；同时问 4 篇（CN_DREAM_JUDGE_PARALLEL 能调）；
 * - local：软件自己在本机跑的模型（local-llm/，选哪个模型在卡片上选，存在 userData/local-llm.json），不花额度；一次问一篇。
 *   本地小模型只给「回 JSON」会漏条、写到数组外面（实测），所以按候选数给一个 JSON Schema 钉住条数、档名。
 */
import { pickLabel } from '../shared/ai-features'
import { JUDGE_KINDS } from '../shared/dream-judge'
import type { DreamJudge } from '../shared/dream-settings'
import { localModel } from '../shared/local-models'
import { chatRun } from './agent'
import { ask } from './ai'
import type { JudgeAsk } from './dream-links'
import { judgeLine, type JudgeLine } from './dream-judge'
import { localAsk, localLlmStatus } from './local-llm'

/** 一问最多等几分钟（命令行起进程、本地模型第一次载入都要时间） */
const TIMEOUT = 5 * 60_000

const within = (signal?: AbortSignal) => (signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT)]) : AbortSignal.timeout(TIMEOUT))

/** 回答的样子（和 shared/dream-judge 提示里写的一样）：每篇 B 一项，按 B1、B2… 的顺序 */
function answerSchema(n: number) {
  return {
    type: 'array',
    prefixItems: Array.from({ length: n }, (_, i) => ({
      type: 'object',
      properties: { b: { const: i + 1 }, kind: { enum: [...JUDGE_KINDS] }, reason: { type: 'string' }, quote_a: { type: 'string' }, quote_b: { type: 'string' }, confidence: { type: 'number' } },
    })),
    minItems: n,
    maxItems: n,
  } as const
}

export function judgeRunner(j: DreamJudge): { ask: JudgeAsk; by: string; parallel: number; line: JudgeLine } {
  if (j.via === 'local') {
    return {
      ask: (system, prompt, signal) => {
        const n = (prompt.match(/^=== B\d+ ===$/gm) ?? []).length
        return localAsk(system, prompt, { signal: within(signal), maxTokens: 400 + n * 220, schema: answerSchema(n) as never })
      },
      by: `本地模型 · ${localModel(localLlmStatus().model)?.name ?? ''}`,
      parallel: 1,
      line: judgeLine(j),
    }
  }
  const pick = { engine: j.engine, ...(j.model ? { model: j.model } : {}), ...(j.effort ? { effort: j.effort } : {}) }
  return {
    ask: (system, prompt, signal) => ask(system, prompt, within(signal), undefined, 'dream', { pick }),
    by: pickLabel({ engine: j.engine, ...chatRun(j.engine, pick) }),
    parallel: Number(process.env.CN_DREAM_JUDGE_PARALLEL) || 4,
    line: judgeLine(j),
  }
}
