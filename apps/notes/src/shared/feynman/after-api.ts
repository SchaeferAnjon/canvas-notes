/** 费曼「讲完以后」界面和主线之间的接口（window.cnAfter，preload/feynman-after.ts） */
import type { MergePlan } from './after'

export interface CnAfterApi {
  /** 补进导图：AI 把这一轮讲的话对到那一支上，回一份改动单子（假 AI 时按字对）；job 是界面起的号，能停 */
  mapPlan(job: number, text: string, notePath: string, roundId: string): Promise<{ plan: MergePlan; by: string }>
  stopMapPlan(job: number): Promise<void>
}
