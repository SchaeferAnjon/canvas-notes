/**
 * 「日历」格（task-kzr3n）主进程和界面之间的样子：系统日历连没连、有哪些日历，AI 排进空着的时间的结果。
 * 实现在 main/calendar.ts，preload 暴露成 window.cnCal。
 */
import type { CalEvent } from '@cn/calendar'

export interface CalLinkState {
  /** 有没有能读系统日历的小助手（没装画布今日的发布版没有） */
  available: boolean
  /** 系统日历的授权：full / denied / restricted / notDetermined / writeOnly / unknown */
  auth: string
  /** 系统正在问 */
  asking: boolean
  /** 连上了（有小助手、给了完全访问） */
  active: boolean
  /** hidden：左栏右键「不在这里显示」了（和画布今日共用一份，task-ov5bb）；它的日程不画、不占时间 */
  calendars: { id: string; title: string; color: string; source: string; hidden: boolean }[]
  /** 系统提醒事项里画布今日镜像的那个列表（画布今日那边连了才有）：名字和它自己的颜色 */
  reminders: { title: string; color: string } | null
  error: string | null
}

export interface SchedSlot {
  key: string
  date: string
  time: string
  minutes: number
  title: string
}

export type SchedResult = { ok: true; slots: SchedSlot[]; candidates: number } | { ok: false; aborted?: boolean; message: string }

export interface CnCalApi {
  state(): Promise<CalLinkState>
  connect(): Promise<CalLinkState>
  events(from: string, to: string): Promise<CalEvent[]>
  openPrivacy(): Promise<void>
  /** 左栏一个日历：藏起 / 再显示 */
  hide(id: string, hide: boolean): Promise<CalLinkState>
  /** 全部显示 */
  showAll(): Promise<CalLinkState>
  aiInfo(): Promise<{ engine: string; label: string; full: string }>
  aiSchedule(id: string): Promise<SchedResult>
  aiCancel(id: string): Promise<void>
  /** 日历 App 里改了：重读这几天的日程 */
  onChanged(f: () => void): () => void
  /** 系统在问权限时状态变了 */
  onState(f: (s: CalLinkState) => void): () => void
}
