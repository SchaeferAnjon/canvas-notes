/**
 * AI 对话按地方存（D 组 CN-132）的界面这一半：每个地方一份消息，读进来、改了 300 毫秒后存回去（主进程存在 userData/ai/chats/）。
 * 放在模块里不放在组件里：换了页面，正在答的那一轮照样往它自己那个地方的对话里写字，不会写进新的地方。
 * 主进程一次只跑一轮 AI 动手（工具要知道是哪一轮），所以「正在答」是全软件一个，记着是哪个地方的。
 */
import { useEffect, useSyncExternalStore } from 'react'
import type { StoredMsg, ToolStep } from '../shared/agent'
import type { AiPick } from '../shared/ai-features'
import type { Place } from './ai-place'

/** 存下来的部分 + 只在这次打开时有的（还在生成、按钮） */
export type Msg = StoredMsg & {
  pending?: boolean
  /** 流式的字往这条里写 */
  live?: boolean
  actions?: { label: string; primary?: boolean; run(): Promise<void> | void }[]
  /** 找重复正在算：已比几篇、共几篇（total 是 0 时还在读全库、切字） */
  dupProgress?: { done: number; total: number }
}

interface Chat {
  label: string
  msgs: Msg[]
  loaded: boolean
  /** 这个对话自己选的模型、effort（输入框底行，CN-91 方向 C：只管这个对话，主进程记在这个地方的对话文件里）；没选过没有 */
  pick?: AiPick | null
}

const chats = new Map<string, Chat>()
const subs = new Set<() => void>()
let version = 0
const emit = () => {
  version++
  for (const s of subs) s()
}

const EMPTY: Chat = { label: '', msgs: [], loaded: false }
export const chatOf = (key: string): Chat => chats.get(key) ?? EMPTY

/** 存盘时去掉只在这次打开时有的东西；没做完的那条记成停下了 */
export function stored(m: Msg): StoredMsg {
  const { pending, live, actions, dupProgress, ...rest } = m
  void live
  void actions
  void dupProgress
  return pending && !rest.text && !rest.error ? { ...rest, error: '没做完（软件关了）' } : rest
}

const timers = new Map<string, ReturnType<typeof setTimeout>>()
function save(key: string) {
  clearTimeout(timers.get(key))
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key)
      const c = chats.get(key)
      if (c?.loaded) void window.cn.aiChatSave(key, c.label, c.msgs.map(stored))
    }, 300),
  )
}

/** 还没存的现在就存（对话菜单列之前） */
export async function flush() {
  const pending = [...timers.keys()]
  for (const key of pending) clearTimeout(timers.get(key))
  timers.clear()
  await Promise.all(
    pending.map((key) => {
      const c = chats.get(key)
      return c?.loaded ? window.cn.aiChatSave(key, c.label, c.msgs.map(stored)) : undefined
    }),
  )
}

const loading = new Set<string>()
async function load(place: Place) {
  if (chats.get(place.key)?.loaded || loading.has(place.key)) return
  loading.add(place.key)
  try {
    const [msgs, pick] = await Promise.all([window.cn.aiChatLoad(place.key), window.cn.aiChatPick(place.key)])
    // 读的时候已经往里加了（读得慢、刚打开就发了一句）：加的排在后面；读的时候已经换了模型、effort：留着刚换的
    const cur = chats.get(place.key)
    const now = cur?.msgs ?? []
    chats.set(place.key, { label: place.label, msgs: [...msgs, ...now], loaded: true, pick: cur?.pick !== undefined ? cur.pick : pick })
    emit()
    if (now.length) save(place.key)
  } finally {
    loading.delete(place.key)
  }
}

/** 改这个地方的消息（改完 300 毫秒后存回去） */
export function update(key: string, f: (msgs: Msg[]) => Msg[], label?: string) {
  const c = chats.get(key) ?? { label: label ?? key, msgs: [], loaded: false }
  chats.set(key, { ...c, ...(label ? { label } : {}), msgs: f(c.msgs) })
  emit()
  save(key)
}

/** 改一条消息：不管它在哪个地方的对话里（消息编号全软件不重） */
export function patch(id: number, p: Partial<Msg> | ((m: Msg) => Msg)) {
  for (const [key, c] of chats) {
    if (!c.msgs.some((m) => m.id === id && m.role === 'ai')) continue
    update(key, (msgs) => msgs.map((m) => (m.id === id && m.role === 'ai' ? (typeof p === 'function' ? p(m) : { ...m, ...p }) : m)))
    return
  }
}

let listening = false
/** 边生成边显示：主进程按编号发字和工具步骤，写进那条消息（在哪个地方的对话里都一样） */
function listen() {
  if (listening) return
  listening = true
  window.cn.onAiEvent((id, e) =>
    patch(id, (m) => {
      if (!m.live) return m
      if (e.type === 'text') return { ...m, text: (m.text ?? '') + e.delta }
      const steps = [...(m.steps ?? [])]
      const i = steps.findIndex((s) => s.id === e.id)
      const step: ToolStep = { id: e.id, label: e.label, status: e.status, ...(e.detail ? { detail: e.detail } : {}) }
      if (i === -1) steps.push(step)
      else steps[i] = step
      return { ...m, steps }
    }),
  )
}

/** 这个地方的对话：第一次用到时读进来，跟着变 */
export function useChat(place: Place): Chat {
  useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    () => version,
  )
  useEffect(() => {
    listen()
    void load(place)
  }, [place.key])
  return chatOf(place.key)
}

/** 输入框底行换了模型、effort（CN-91）：只管这个地方的对话，马上记下 */
export function setPick(key: string, pick: AiPick) {
  const c = chats.get(key) ?? { label: key, msgs: [], loaded: false }
  chats.set(key, { ...c, pick })
  emit()
  void window.cn.aiChatSetPick(key, pick)
}

/** 新对话：这个地方的对话清掉（会话号、选的模型和 effort 主进程一起清） */
export function clear(key: string) {
  const c = chats.get(key)
  if (c) chats.set(key, { ...c, msgs: [], pick: null })
  clearTimeout(timers.get(key))
  emit()
  void window.cn.aiChatClear(key)
}

// ---------- 正在答的那一轮（全软件一个） ----------

let running: { id: number; key: string; label: string } | null = null
export const runningNow = () => running
export function setRunning(r: typeof running) {
  running = r
  emit()
}
