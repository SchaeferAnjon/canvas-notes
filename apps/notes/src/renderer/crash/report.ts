/**
 * 出错了报给主进程记进 main.log（task-pyb39）；测试模式下往某一块注入渲染错误；「用默认布局打开」清掉的东西。
 */
import { useSyncExternalStore } from 'react'
import type { RendererReport } from '../../shared/crash'

export function report(r: RendererReport) {
  try {
    window.cnCrash?.report(r)
  } catch {
    // 报日志本身出错不能再抛：这里就是兜底
  }
}

const errText = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e))

/** 恢复上次的状态时丢掉了坏数据：记一行，不抛 */
export function dropped(area: string, why: string) {
  report({ kind: 'restore', area, message: `恢复时丢掉了坏数据：${why}` })
}

/** 没接住的异常、没人接的 Promise 失败都记一笔（不改原来的行为：控制台照样有） */
export function watchGlobalErrors() {
  window.addEventListener('error', (e) => {
    const err = e.error as unknown
    report({ kind: 'error', message: err ? errText(err) : e.message, stack: err instanceof Error ? err.stack : `${e.filename}:${e.lineno}:${e.colno}` })
  })
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as unknown
    report({ kind: 'rejection', message: errText(r), stack: r instanceof Error ? r.stack : undefined })
  })
}

// ---------- 测试模式：往某一块注入一个渲染时抛的错（只有 CN_E2E=1 时有 window.cnTestCrash） ----------
const armed = new Set<string>()
const subs = new Set<() => void>()
let ver = 0
const subscribe = (f: () => void) => (subs.add(f), () => subs.delete(f))
const snapshot = () => ver

export function installTestCrash() {
  if (!window.cnCrash?.e2e) return
  ;(window as unknown as { cnTestCrash: (area: string, on?: boolean) => void }).cnTestCrash = (area, on = true) => {
    if (on) armed.add(area)
    else armed.delete(area)
    ver++
    for (const f of subs) f()
  }
}

/** 放在每块兜底里面：测试模式下这一块被点名了就在渲染时抛错 */
export function Boom({ area }: { area: string }) {
  useSyncExternalStore(subscribe, snapshot)
  if (armed.has(area)) throw new Error(`测试注入的渲染错误：${area}`)
  return null
}

// ---------- 用默认布局打开 ----------
/** 上次开着的标签、右栏的摆法、网页标签、左右栏宽、左栏看哪一样：清掉这些再加载，库里的文件不动 */
const LAYOUT_KEYS = ['cn.dock', 'cn.aiOpen', 'cn.rightW', 'cn.webtabs', 'cn.sideHidden', 'cn.sideW', 'cn.centerFold', 'cn.leftView', 'cn.webTopFold']

export function clearLayout() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('cn.tabs:') || LAYOUT_KEYS.includes(k)) localStorage.removeItem(k)
  } catch {
    // 本机存储打不开：照样重新加载
  }
}

export function reloadWindow() {
  // 预加载没挂上时退回页面自己的重新加载
  if (window.cnCrash) void window.cnCrash.reload()
  else location.reload()
}
