/**
 * 费曼「讲完以后」的主线部分（③ feynman-after，task-yvabi）：补进导图前让 AI 把这一轮讲的话按那一支的结构对上去，回一份改动单子
 * （界面列给用户核对，点「放进去」才改，偏好「先核对再放」）。用「AI 对话」那一家（已定）；CN_AI_FAKE=1 时用 shared/feynman/after.ts 的按字对。
 * 提示词和读回答在 shared/feynman/after.ts（mapPlanAsk、readPlan），真 AI 验一遍：pnpm eval:feynman（eval/feynman/map-plan.eval.ts）。
 */
import { ipcMain } from 'electron'
import { parseMindmap } from '@cn/format'
import { t } from '../shared/i18n'
import { branchOf, MAP_PLAN_SYSTEM, mapPlanAsk, type MergePlan, planMapMerge, readPlan } from '../shared/feynman/after'
import { findRounds } from '../shared/feynman/doc'
import { ask, featureLabel } from './agent'

const FAKE = () => process.env.CN_AI_FAKE === '1'

export interface MapPlanResult {
  plan: MergePlan
  /** 「Claude Code · Opus 5.5」：核对框底下写是谁对的 */
  by: string
}

export function setupFeynmanAfter() {
  const jobs = new Map<number, AbortController>()
  ipcMain.handle('feynman:map-plan', async (_e, job: unknown, text: unknown, notePath: unknown, roundId: unknown): Promise<MapPlanResult> => {
    if (typeof job !== 'number' || typeof text !== 'string' || typeof notePath !== 'string' || typeof roundId !== 'string') throw new Error(t('参数不对'))
    const round = findRounds(text).find((r) => r.meta.id === roundId)
    if (!round) throw new Error(t('这一轮不在这篇里了'))
    const branch = branchOf(text, notePath, round.meta)
    if (branch === null) throw new Error(t('导图上找不到这一轮讲的那一支了'))
    const roots = parseMindmap(text).roots
    if (FAKE()) return { plan: planMapMerge(roots, branch, round.meta), by: featureLabel('chat') }
    const ctl = new AbortController()
    jobs.set(job, ctl)
    try {
      const answer = await ask(MAP_PLAN_SYSTEM, mapPlanAsk(roots, branch, round), ctl.signal, () => {})
      const plan = readPlan(roots, branch, answer)
      if (!plan) throw new Error(t('AI 的回答读不懂，再试一次'))
      return { plan, by: featureLabel('chat') }
    } finally {
      jobs.delete(job)
    }
  })
  ipcMain.handle('feynman:map-plan:stop', (_e, job: unknown) => jobs.get(Number(job))?.abort())
}
