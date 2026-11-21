/**
 * ⌘K 的自定义在界面这边的一份（DESIGN.v3 3.2、3.3）：钉住、藏起、分组、别名、快捷键、自己加的命令、网页「⋯」的调整。
 * 改的时候先改这份（界面马上变），再交主进程写进库里的 .canvas-notes/命令.json；每次改都留着改之前的那份，底部「撤回」用。
 *
 * App 每次画的时候把现有的命令交进来（setRegistry）；键归谁、交给主进程的在 renderer/keys.ts。
 */
import { useSyncExternalStore } from 'react'
import { type CmdConfig, commandsJson, defaultCommands } from '../../shared/commands'

let cfg: CmdConfig = defaultCommands()
let version = 0
/** 正在写：这时候文件变了的通知读到的还是旧的，不拿它盖掉刚改的 */
let writing = 0
const subs = new Set<() => void>()
const emit = () => {
  version++
  for (const s of subs) s()
}

/** 打开库、库里文件变了（拉下来别的电脑改的）时重读 */
export async function loadCmds() {
  const c = await window.cnCmds.get()
  if (writing) return
  cfg = c
  emit()
  changed()
}

export const cmdConfig = () => cfg

/** 改一处；返回改之前的那份（撤回就是把它写回去） */
export async function updateCmds(fn: (c: CmdConfig) => CmdConfig): Promise<CmdConfig> {
  const before = cfg
  const next = fn(cfg)
  if (next === cfg) return before
  cfg = next
  emit()
  changed()
  writing++
  try {
    // 交给主进程的是文件里的样子（webMenu、不认识的字段摊在最外层），主进程照读文件一样再验一遍
    cfg = await window.cnCmds.set(JSON.parse(commandsJson(next)) as Record<string, unknown>)
  } finally {
    writing--
  }
  emit()
  return before
}

export function useCmds(): CmdConfig {
  useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    () => version,
  )
  return cfg
}

// ---------------------------------------------------------------- 最近用过的命令（只在这台 Mac 上，「最合适」排序用）

const USED_KEY = 'cn.cmdUsed'
let used: string[] = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(USED_KEY) ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 8) : []
  } catch {
    // 读不出来：当没用过
    return []
  }
})()

export function noteUsed(id: string) {
  used = [id, ...used.filter((x) => x !== id)].slice(0, 8)
  try {
    localStorage.setItem(USED_KEY, JSON.stringify(used))
  } catch {
    // 存不下只是「最合适」少一点依据
  }
}

/** 最近用过的第几条（0 是刚用过）；没用过 undefined */
export const usedRank = (id: string): number | undefined => {
  const i = used.indexOf(id)
  return i < 0 ? undefined : i
}

// ---------------------------------------------------------------- 交进来的命令

/** App 交进来的命令（⌘K 那一份：命令表里的、插件的、自己加的）：id、名字、默认的键（命令表以外的才用）、键是不是它自己那块接的 */
export interface KeyCmd {
  id: string
  name: string
  keys?: string
  fixedKeys?: boolean
}

let registry: KeyCmd[] = []
let regSig = ''
/** 设置、命令变了（键交给主进程那边听这个；不是 React 的重画） */
const changeSubs = new Set<() => void>()
export function onCmdsChange(cb: () => void): () => void {
  changeSubs.add(cb)
  return () => changeSubs.delete(cb)
}
const changed = () => changeSubs.forEach((f) => f())

/** 软件里现在有的命令（App 每次画都交）；有变化才告诉听的 */
export function setRegistry(list: KeyCmd[]) {
  const sig = JSON.stringify(list)
  if (sig === regSig) return
  regSig = sig
  registry = list
  changed()
}

/** 现在交进来的命令 */
export const registryNow = (): readonly KeyCmd[] => registry
