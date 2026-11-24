/**
 * 生长图的状态（task-h7oy8）：中间的「生长」标签和左栏梦游报告的「生长」看法、报告顶上那晚的小图共用一份：
 * 数据（主进程后台算好的）、停在哪一天、停在哪一晚、选中哪篇、只看周围、只看哪个文件夹、估的画不画空心、左栏看报告还是看生长。
 */
import { useSyncExternalStore } from 'react'
import type { GrowthState } from '../../shared/api'
import { makeModel, type Model } from './model'
import { ipcOn } from '../crash/ipc'

export interface GrowthUi {
  /** 数据、在不在算、上次没算成的原因 */
  state: GrowthState
  model: Model | null
  /** 停在哪一天（null 是今天） */
  t: number | null
  /** 停在哪一晚（那晚连的线加粗） */
  night: number | null
  /** 选中的那篇（按路径记，数据重算了还认得） */
  sel: string | null
  local: boolean
  folder: string
  hollow: boolean
  /** 左栏梦游报告里看哪一样 */
  side: 'report' | 'growth'
  playing: boolean
}

const HOLLOW_KEY = 'cn.growth.hollow'
const readHollow = () => {
  try {
    return localStorage.getItem(HOLLOW_KEY) !== '0'
  } catch {
    return true
  }
}

let ui: GrowthUi = { state: { data: null, building: false, error: null }, model: null, t: null, night: null, sel: null, local: false, folder: '', hollow: readHollow(), side: 'report', playing: false }
const subs = new Set<() => void>()

export function setGrowth(p: Partial<GrowthUi>) {
  ui = { ...ui, ...p }
  if ('hollow' in p)
    try {
      localStorage.setItem(HOLLOW_KEY, p.hollow ? '1' : '0')
    } catch {
      // 存不下就只这一次
    }
  for (const f of subs) f()
}

export const growthNow = () => ui

export function useGrowth(): GrowthUi {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    () => ui,
  )
}

function take(s: GrowthState) {
  const model = s.data && s.data !== ui.state.data ? makeModel(s.data) : s.data ? ui.model : null
  // 数据换了：停着的那天还在范围里就不动
  const t = ui.t !== null && model && (ui.t < model.start || ui.t > model.end) ? null : ui.t
  setGrowth({ state: s, model, t })
}

let wired = false
/** 要用时调一次：拿数据（库变了主进程会在后台重算，算完推过来） */
export function loadGrowth() {
  if (!wired) {
    wired = true
    ipcOn(window.cn.onGrowth, 'cn.onGrowth')(take)
  }
  void window.cn.growthData().then(take, (e: Error) => setGrowth({ state: { ...ui.state, error: e.message } }))
}

/** 停到某一晚：时间轴跳到那天、那晚连的线加粗 */
export function focusNight(day: number) {
  setGrowth({ t: day, night: day, playing: false })
}
