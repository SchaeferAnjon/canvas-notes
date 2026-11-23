/**
 * 「日历」格的主进程（task-kzr3n，画布今日 v2 原型「画布笔记 · 日历」）：系统日历只读、AI 帮我排进空着的时间。
 * 读系统日历用画布今日的小助手（apps/today/native/reminders，EventKit；和画布今日同一份源码、同一个程序，这里不另写）：
 *   发布版用装着的画布今日里那一个（Canvas Today.app/Contents/MacOS/canvas-today-reminders）；没装画布今日就没有系统日历；
 *   开发时是 apps/today 编出来的；CN_CAL_HELPER 指定；测试模式（CN_E2E）一律 --memory <CN_CAL_MEMORY> 的假日历，没给就当没有小助手。
 * 和小助手说话照画布今日的 rem-helper.ts（直接用那一份）；AI 排空档照画布今日的 main/ai.ts、shared/ai-plan.ts（直接用那一份，「小活」那一家）。
 * 只在打开「日历」格时才起小助手（不为它在开软件时多一个进程）。
 * 左栏每个系统日历能「不在这里显示」（task-ov5bb）：记在设置目录的 calendars.json，和画布今日共用一份（画布今日的 main/cal-hidden.ts，直接用那一份），
 * 藏起的日历的日程 events() 就不给（周、月、全天、小月历的点、排空档都不算它）；画布今日那边改了，看着文件跟上。
 */
import type { CalEvent } from '@cn/calendar'
import { addDays, minutesOf } from '@cn/tasks'
import { app, type BrowserWindow, ipcMain, shell } from 'electron'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { aiLabel, aiPick, aiSchedule } from '../../../today/src/main/ai'
import { CAL_PREFS_FILE, HiddenCals, isHidden } from '../../../today/src/main/cal-hidden'
import { HelperError, RemHelper } from '../../../today/src/main/rem-helper'
import type { Busy, SchedCandidate } from '../../../today/src/shared/ai-plan'
import type { CalLinkState, SchedResult } from '../shared/calendar'
import { isOpen, listed, type TodoItem } from '../shared/todo'
import { E2E } from './test-mode'
import { localToday } from './todo-edit'

interface HelperCal {
  id: string
  title: string
  color: string | null
  source: string
}
interface HelperEvent {
  id: string
  title: string
  calendar: string
  allDay: boolean
  start: string
  end: string
}

/** 日历没给的颜色：灰（同画布今日） */
const GREY = '#8A949B'
/** 画布今日镜像带提醒的待办用的那个提醒事项列表（中文、英文两种名字都认） */
const REM_LISTS = ['画布今日', 'Canvas Today']

/** 小助手在哪；没有能用的是 null */
async function helperCmd(): Promise<{ bin: string; args: string[] } | null> {
  const memory = process.env.CN_CAL_MEMORY
  if (E2E && !memory) return null
  const dev = join(app.getAppPath(), '../today/native/reminders/.build/apple/Products/Release/canvas-today-reminders')
  let bin: string | undefined
  if (process.env.CN_CAL_HELPER) bin = process.env.CN_CAL_HELPER
  else if (!app.isPackaged && existsSync(dev)) bin = dev
  else if (!E2E) {
    try {
      const info = await app.getApplicationInfoForProtocol('canvas-today://')
      const p = join(info.path, 'Contents/MacOS/canvas-today-reminders')
      if (existsSync(p)) bin = p
    } catch {
      // 没装画布今日：没有系统日历
    }
  }
  if (!bin || !existsSync(bin)) return null
  return { bin, args: memory ? ['--memory', memory] : [] }
}

const why = (e: unknown) => (e instanceof HelperError ? e.message : String((e as Error)?.message ?? e))

export function registerCalendar(o: { win: () => BrowserWindow | null; todos: () => Promise<TodoItem[]>; root: () => string | null }) {
  let helper: RemHelper | null = null
  let ready: Promise<RemHelper | null> | null = null
  let auth = 'unknown'
  let asking = false
  let cals: HelperCal[] = []
  let rem: { title: string; color: string } | null = null
  let error: string | null = null
  /** 不在这里显示的日历：画布今日那边改了（文件变了）就重读日历、叫界面重读日程 */
  const hidden = new HiddenCals(join(app.getPath('userData'), CAL_PREFS_FILE), () => void (active() && o.win()?.webContents.send('cal:changed')))
  app.on('browser-window-focus', () => hidden.check())

  const get = () =>
    (ready ??= helperCmd().then((cmd) => {
      if (!cmd) return null
      helper = new RemHelper(cmd)
      helper.on('changed', () => void loadCals().then(() => o.win()?.webContents.send('cal:changed')))
      if (E2E && helper.memory)
        (globalThis as unknown as { cnCal: unknown }).cnCal = {
          external: (p: Record<string, unknown>) => helper!.request('test.external', p),
          set: (p: Record<string, unknown>) => helper!.request('test.set', p),
          dump: () => helper!.request('test.dump'),
        }
      return helper
    }))

  const active = () => !!helper && auth === 'full'
  const state = (): CalLinkState => ({
    available: !!helper,
    auth,
    asking,
    active: active(),
    calendars: active() ? cals.map((c) => ({ id: c.id, title: c.title, color: c.color ?? GREY, source: c.source, hidden: isHidden(c, hidden.get(), cals) })) : [],
    reminders: active() ? rem : null,
    error,
  })

  async function loadCals() {
    if (!helper) return
    try {
      cals = (await helper.request<{ calendars: HelperCal[] }>('calendars')).calendars
      // 系统提醒事项里画布今日镜像的那个列表（画布今日那边连了才有；只看，不弹窗）
      const st = await helper.request<{ auth: string }>('status')
      rem = null
      if (st.auth === 'full') {
        const { lists } = await helper.request<{ lists: { title: string; color?: string | null }[] }>('lists')
        const l = lists.find((x) => REM_LISTS.includes(x.title))
        rem = l ? { title: l.title, color: l.color ?? GREY } : null
      }
      error = null
    } catch (e) {
      error = why(e)
    }
  }

  ipcMain.handle('cal:state', async (): Promise<CalLinkState> => {
    const h = await get()
    if (!h) return state()
    try {
      auth = (await h.request<{ auth: string }>('calStatus')).auth
    } catch (e) {
      error = why(e)
    }
    if (active()) await loadCals()
    return state()
  })

  /** 连接系统日历：第一次系统问一次（「允许完全访问」） */
  ipcMain.handle('cal:connect', async (): Promise<CalLinkState> => {
    const h = await get()
    if (!h) return state()
    asking = true
    o.win()?.webContents.send('cal:state', state())
    try {
      auth = (await h.request<{ auth: string }>('calRequest', {}, 10 * 60_000)).auth
    } catch (e) {
      error = why(e)
    } finally {
      asking = false
    }
    if (active()) await loadCals()
    return state()
  })

  /** 这几天（本地日子，都含）的日程，交给 @cn/calendar 画；没连是空的 */
  ipcMain.handle('cal:events', async (_e, from: unknown, to: unknown): Promise<CalEvent[]> => {
    if (typeof from !== 'string' || typeof to !== 'string' || !active()) return []
    return events(from, to)
  })

  async function events(from: string, to: string): Promise<CalEvent[]> {
    if (!helper || !active()) return []
    try {
      const { events } = await helper.request<{ events: HelperEvent[] }>('events', { from, to })
      const byId = new Map(cals.map((c) => [c.id, c]))
      const off = new Set(cals.filter((c) => isHidden(c, hidden.get(), cals)).map((c) => c.id))
      return events.filter((e) => !off.has(e.calendar)).map((e) => {
        const c = byId.get(e.calendar)
        return { id: e.id, title: e.title, calendar: c?.title ?? '', color: c?.color ?? GREY, allDay: e.allDay, start: e.start, end: e.end }
      })
    } catch (e) {
      error = why(e)
      return []
    }
  }

  /** 左栏一个日历：不在这里显示 / 在这里显示（右键、点色块）；全部显示 */
  ipcMain.handle('cal:hide', (_e, id: unknown, hide: unknown): CalLinkState => {
    if (typeof id !== 'string' || typeof hide !== 'boolean') throw new Error('日历的参数不对')
    const c = cals.find((x) => x.id === id)
    if (c && active()) hidden.set(c, hide, cals)
    return state()
  })
  ipcMain.handle('cal:showAll', (): CalLinkState => {
    hidden.clear()
    return state()
  })

  /** 系统设置 › 隐私与安全性 › 日历 */
  ipcMain.handle('cal:openPrivacy', () => shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars'))

  /** AI 用哪一家（按钮上画它的标志、「Claude Code 在看这两天的空档」） */
  ipcMain.handle('cal:aiInfo', () => aiLabel(aiPick(app.getPath('userData'))))

  /** 帮我排进空着的时间：今天、明天还没定钟点的待办，避开日程和有钟点的待办（照画布今日 ct:aiSchedule） */
  const jobs = new Map<string, AbortController>()
  ipcMain.handle('cal:aiSchedule', async (_e, id: unknown): Promise<SchedResult> => {
    if (typeof id !== 'string') return { ok: false, message: '参数不对' }
    const d = localToday()
    const tom = addDays(d, 1)
    const now = new Date()
    const nowT = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    const tasks = await o.todos()
    const cands: SchedCandidate[] = tasks.filter((t) => isOpen(t) && listed(t) && !t.time && (t.date === d || t.date === tom)).map((t) => ({ key: t.key, title: t.title, date: t.date!, prio: t.prio }))
    const busy: Busy[] = tasks
      .filter((t) => isOpen(t) && t.time && (t.date === d || t.date === tom))
      .map((t) => ({ date: t.date!, from: minutesOf(t.time!), to: Math.min(1440, minutesOf(t.time!) + 60), title: t.title }))
    const evs = await events(d, tom)
    for (const e of evs) {
      if (e.allDay) continue
      for (const day of [d, tom]) {
        const sd = e.start.slice(0, 10)
        const ed = e.end.slice(0, 10)
        if (day < sd || day > ed) continue
        busy.push({ date: day, from: day === sd ? minutesOf(e.start.slice(11, 16)) : 0, to: day === ed ? minutesOf(e.end.slice(11, 16)) : 1440, title: e.title })
      }
    }
    const ac = new AbortController()
    jobs.set(id, ac)
    try {
      const slots = await aiSchedule(aiPick(app.getPath('userData')), { date: d, time: nowT }, cands, busy, o.root() ?? dirname(app.getPath('userData')), ac.signal)
      const byKey = new Map(cands.map((c) => [c.key, c.title]))
      return { ok: true, slots: slots.map((x) => ({ ...x, title: byKey.get(x.key) ?? '' })), candidates: cands.length }
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return { ok: false, aborted: true, message: '' }
      return { ok: false, message: String((e as Error)?.message ?? e) }
    } finally {
      jobs.delete(id)
    }
  })
  ipcMain.handle('cal:aiCancel', (_e, id: unknown) => void (typeof id === 'string' && jobs.get(id)?.abort()))

  app.on('will-quit', () => {
    helper?.stop()
    hidden.close()
  })
}
