/**
 * ⌘K 的自定义在界面这边的一份（DESIGN.v3 3.2、3.3）：钉住、藏起、分组、别名、快捷键、自己加的命令、网页「⋯」的调整。
 * 改的时候先改这份（界面马上变），再交主进程写进库里的 .canvas-notes/命令.json；每次改都留着改之前的那份，底部「撤回」用。
 *
 * 也管自己设的快捷键：App 每次画的时候把现有的命令交进来（setRegistry），按键时 matchCombo 说这个键归谁；
 * 网页有焦点时要转回来的键交给主进程（cnCmds.keys）。
 */
import { useSyncExternalStore } from 'react'
import { type Avail, type CmdConfig, commandsJson, defaultCommands, effectiveKey } from '../../shared/commands'

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
  syncKeys()
}

export const cmdConfig = () => cfg

/** 改一处；返回改之前的那份（撤回就是把它写回去） */
export async function updateCmds(fn: (c: CmdConfig) => CmdConfig): Promise<CmdConfig> {
  const before = cfg
  const next = fn(cfg)
  if (next === cfg) return before
  cfg = next
  emit()
  syncKeys()
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

// ---------------------------------------------------------------- 快捷键

/** 交进来的命令：id、默认的键、键是不是它自己那块接的（双语翻译的 ⌥A） */
export interface KeyCmd {
  id: string
  name: string
  keys?: string
  fixedKeys?: boolean
}

/** 软件里本来就接着的默认键（App.tsx 的按键处理）：没改过就还走原来那条路（⌘J 带着选中的字问 AI 这些都照旧） */
const HANDLED: Record<string, string> = { 'new-note': '⌘N', 'ask-ai': '⌘J', goto: '⌘O', settings: '⌘,' }
/** 主进程转来的 app:key → 组合键 */
const APP_KEY: Record<string, string> = { n: '⌘N', j: '⌘J', o: '⌘O', ',': '⌘,', k: '⌘K', f: '⌘F', w: '⌘W', '\\': '⌘\\', 'alt+\\': '⌥⌘\\' }

let registry: KeyCmd[] = []
let byCombo = new Map<string, KeyCmd>()
let sentKeys = ''

/** 一条命令现在的键（设过的、默认的） */
export const keyOf = (c: Pick<KeyCmd, 'id' | 'keys'>): string | null => effectiveKey(cfg, c.id, c.keys)

/** 软件里现在有的命令（App 每次画都交）：算出每个键归谁，有变化才告诉主进程 */
export function setRegistry(list: KeyCmd[]) {
  registry = list
  syncKeys()
}

/** 现在有的命令（给 shared/commands 的那几个改法用） */
export const availOf = (list: readonly (KeyCmd & { home?: string })[]): Avail[] => list.map((c) => ({ id: c.id, home: c.home, keys: c.keys }))

function syncKeys() {
  byCombo = new Map()
  for (const c of registry) {
    const k = keyOf(c)
    if (k && !byCombo.has(k)) byCombo.set(k, c)
  }
  const forward = [...byCombo].filter(([k, c]) => !c.fixedKeys && HANDLED[c.id] !== k).map(([k]) => k)
  const menu = { capture: keyOf(registry.find((c) => c.id === 'capture') ?? { id: 'capture', keys: '⇧⌘C' }), settings: keyOf(registry.find((c) => c.id === 'settings') ?? { id: 'settings', keys: '⌘,' }) }
  const sig = JSON.stringify({ forward: forward.sort(), menu })
  if (sig === sentKeys || !window.cnCmds) return
  sentKeys = sig
  void window.cnCmds.keys({ forward, menu }).catch((e) => console.error('快捷键交给主进程没成', e))
}

/** 现在有键的命令（设置 › 快捷键里列出来）；custom：⌘K 里改过 */
export function keyedCommands(): { id: string; name: string; key: string; custom: boolean }[] {
  return registry.flatMap((c) => {
    const key = keyOf(c)
    return key && !c.fixedKeys ? [{ id: c.id, name: c.name, key, custom: cfg.keys[c.id] !== undefined }] : []
  })
}

/** 这个组合键现在归谁（设快捷键时说「已经给了「新建笔记」」） */
export const ownerOf = (combo: string, except?: string): KeyCmd | null => {
  for (const c of registry) if (c.id !== except && keyOf(c) === combo) return c
  return null
}

/**
 * 按下一个组合键：给了哪条命令就是它的 id；还走原来那条路的（没改过的 ⌘N、⌘J、⌘O、⌘,）、谁都没给的是 null；
 * 软件本来接着、但这条命令已经换了别的键（⌘N 给了「同步」以外的情况）是 skip：原来那条路也别走了
 */
export function matchCombo(combo: string | null): string | 'skip' | null {
  if (!combo) return null
  const owner = byCombo.get(combo)
  if (owner) return owner.fixedKeys || HANDLED[owner.id] === combo ? null : owner.id
  return Object.entries(HANDLED).some(([id, k]) => k === combo && registry.some((c) => c.id === id)) ? 'skip' : null
}

/** 主进程转来的键（网页有焦点时）：「combo:⌥⌘S」或者 n、j、o 这些 */
export function matchAppKey(k: string): string | 'skip' | null {
  if (k.startsWith('combo:')) return matchCombo(k.slice(6)) ?? 'skip'
  return matchCombo(APP_KEY[k] ?? null)
}
