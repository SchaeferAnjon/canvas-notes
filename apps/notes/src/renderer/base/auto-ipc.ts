/**
 * 数据库自动化、按钮列、周记在界面这一边要问主进程的都从这一个文件走（task-i921u「当……就……」方向 B）：
 * 契约是 shared/automation.ts（window.cn.auto），写法和纯函数是 @cn/format 的 automation.ts / automation-run.ts。
 * 底层换了通道或类型时只改这一个文件。
 */
import { type AutoRule, type AutoStep, type BaseCtx, baseWhere, type ButtonDef, parseAutomations, ruleLines, setButton, stepLines } from '@cn/format'
import type {
  AutoButtonReq,
  AutoCommandReq,
  AutoDone,
  AutoListing,
  AutoLogRow,
  AutoPrefs,
  AutoRef,
  AutoSentenceResult,
  AutoStartResult,
  AutoStarted,
  AutoTrial,
  AutoUndoResult,
  AutoWriteResult,
} from '../../shared/automation'

export type { AutoListing, AutoLogRow, AutoPrefs, AutoRef, AutoRuleInfo, AutoStarted, AutoDone, AutoTrial } from '../../shared/automation'
export type { AutoRule, AutoStep, AutoWhen } from '@cn/format'

const api = () => window.cn.auto

/** 一个数据库块在哪：那篇文档的第几个 base 块（白板上展开的卡没有文档时是 null） */
export const whereOf = (file: string | undefined, block: number): string | null => (file ? baseWhere(file, block) : null)

/** 块里写着的规则（读块，不问主进程：改了马上看得到） */
export const rulesOf = (src: string): AutoRule[] => parseAutomations(src)

/** 这一列是按钮：它做的几步 */
export const buttonOf = (ctx: BaseCtx | null, col: string): ButtonDef | null => {
  const d = ctx?.doc.props[col]
  return d?.type === 'button' ? (d as ButtonDef) : null
}
/** 存按钮列做的事（块里 properties 那一列的 do，只换那几行；表格的 edit.src 写回） */
export const setButtonSteps = (src: string, col: string, steps: AutoStep[]) => setButton(src, col, steps)

/** 「看写法」：一条规则 / 一个按钮在 md 里的样子 */
export const ruleYaml = (r: AutoRule) => ruleLines(r, 0).join('\n')
export const buttonYaml = (col: string, steps: AutoStep[]) => [`${col}:`, '  type: button', '  do:', ...steps.flatMap((s) => stepLines(s, 4))].join('\n')

export const listing = (where?: string): Promise<AutoListing> => api().list(where)
export const saveRule = (where: string, index: number | null, rule: AutoRule): Promise<AutoWriteResult> => api().save({ where, index, rule })
export const toggleRule = (ref: AutoRef, on: boolean): Promise<AutoWriteResult> => api().toggle(ref, on)
export const removeRule = (ref: AutoRef): Promise<AutoWriteResult> => api().remove(ref)
export const runRule = (ref: AutoRef, path?: string): Promise<AutoStartResult> => api().run({ ref, ...(path ? { path } : {}) })
export const pressButton = (req: AutoButtonReq): Promise<AutoStartResult> => api().button(req)
export const stopRun = (run: number): Promise<boolean> => api().stop(run)
export const trialRule = (where: string, rule: AutoRule, path?: string): Promise<AutoTrial> => api().trial({ where, rule, ...(path ? { path } : {}) })
export const runLog = (where?: string, limit = 100): Promise<AutoLogRow[]> => api().log({ ...(where ? { where } : {}), limit })
export const undoRun = (id: string): Promise<AutoUndoResult> => api().undo(id)
export const fromSentence = (sentence: string, where: string): Promise<AutoSentenceResult> => api().fromSentence({ sentence, where })
export const prefs = (patch?: Partial<AutoPrefs>): Promise<AutoPrefs> => api().prefs(patch)
export const dreamOn = (on?: boolean) => api().system('dream', on)
export const dreamRun = () => api().systemRun('dream')
export const onStarted = (f: (s: AutoStarted) => void) => api().onStarted(f)
export const onDone = (f: (d: AutoDone) => void) => api().onDone(f)
export const onCommand = (f: (c: AutoCommandReq) => void) => api().onCommand(f)
export const onChanged = (f: () => void) => api().onChanged(f)
