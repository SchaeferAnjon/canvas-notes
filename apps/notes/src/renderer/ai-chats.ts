/**
 * AI 对话按地方存（D 组 CN-132）的界面这一半：每个地方一份消息，读进来、改了 300 毫秒后存回去（主进程存在 userData/ai/chats/）。
 * 放在模块里不放在组件里：换了页面，正在答的那一轮照样往它自己那个地方的对话里写字，不会写进新的地方。
 * 主进程一次只跑一轮 AI 动手（工具要知道是哪一轮），所以「正在答」是全软件一个，记着是哪个地方的。
 */
import { useEffect, useSyncExternalStore } from 'react'
import type { ChatSide, StoredMsg, ToolStep } from '../shared/agent'
import type { AiPick } from '../shared/ai-features'
import type { Place } from './ai-place'
import { t } from '../shared/i18n'

/** 存下来的部分 + 只在这次打开时有的（还在生成、按钮） */
export type Msg = StoredMsg & {
  pending?: boolean
  /** 流式的字往这条里写 */
  live?: boolean
  actions?: { label: string; primary?: boolean; run(): Promise<void> | void }[]
  /** 找重复正在算：已比几篇、共几篇（total 是 0 时还在读全库、切字） */
  dupProgress?: { done: number; total: number }
}

/** 一条旁支（task-4edsc，方向 A「就地展开」）：问答和主对话一样的消息，答着的那条带 live */
export type Side = Omit<ChatSide, 'msgs'> & { msgs: Msg[] }

interface Chat {
  label: string
  msgs: Msg[]
  loaded: boolean
  /** 这个对话自己选的模型、effort（输入框底行，CN-91 方向 C：只管这个对话，主进程记在这个地方的对话文件里）；没选过没有 */
  pick?: AiPick | null
  /** 这段对话里开的旁支（和对话一起存，不往主对话里加东西） */
  sides: Side[]
}

const chats = new Map<string, Chat>()
const subs = new Set<() => void>()
let version = 0
const emit = () => {
  version++
  for (const s of subs) s()
}

const EMPTY: Chat = { label: '', msgs: [], loaded: false, sides: [] }
export const chatOf = (key: string): Chat => chats.get(key) ?? EMPTY

/** 存盘时去掉只在这次打开时有的东西；没做完的那条记成停下了 */
export function stored(m: Msg): StoredMsg {
  const { pending, live, actions, dupProgress, ...rest } = m
  void live
  void actions
  void dupProgress
  return pending && !rest.text && !rest.error ? { ...rest, error: t('没做完（软件关了）') } : rest
}

const storedSide = (s: Side): ChatSide => ({ ...s, msgs: s.msgs.map(stored) })
const write = (key: string, c: Chat) => window.cn.aiChatSave(key, c.label, c.msgs.map(stored), c.sides.map(storedSide))

const timers = new Map<string, ReturnType<typeof setTimeout>>()
function save(key: string) {
  clearTimeout(timers.get(key))
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key)
      const c = chats.get(key)
      if (c?.loaded) void write(key, c)
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
      return c?.loaded ? write(key, c) : undefined
    }),
  )
}

const loading = new Set<string>()
async function load(place: Place) {
  if (chats.get(place.key)?.loaded || loading.has(place.key)) return
  loading.add(place.key)
  try {
    const [msgs, pick, sides] = await Promise.all([window.cn.aiChatLoad(place.key), window.cn.aiChatPick(place.key), window.cn.aiChatSides(place.key)])
    // 读的时候已经往里加了（读得慢、刚打开就发了一句）：加的排在后面；读的时候已经换了模型、effort：留着刚换的
    const cur = chats.get(place.key)
    const now = cur?.msgs ?? []
    chats.set(place.key, { label: place.label, msgs: [...msgs, ...now], loaded: true, pick: cur?.pick !== undefined ? cur.pick : pick, sides: [...sides, ...(cur?.sides ?? [])] })
    emit()
    if (now.length) save(place.key)
  } finally {
    loading.delete(place.key)
  }
}

/** 改这个地方的消息（改完 300 毫秒后存回去） */
export function update(key: string, f: (msgs: Msg[]) => Msg[], label?: string) {
  const c = chats.get(key) ?? { label: label ?? key, msgs: [], loaded: false, sides: [] }
  chats.set(key, { ...c, ...(label ? { label } : {}), msgs: f(c.msgs) })
  emit()
  save(key)
}

/** 改一条消息：不管它在哪个地方的对话里、在主对话还是旁支里（消息编号全软件不重） */
export function patch(id: number, p: Partial<Msg> | ((m: Msg) => Msg)) {
  const put = (m: Msg) => (m.id === id && m.role === 'ai' ? (typeof p === 'function' ? p(m) : { ...m, ...p }) : m)
  for (const [key, c] of chats) {
    if (c.msgs.some((m) => m.id === id && m.role === 'ai')) {
      update(key, (msgs) => msgs.map(put))
      return
    }
    const side = c.sides.find((s) => s.msgs.some((m) => m.id === id && m.role === 'ai'))
    if (side) {
      updateSides(key, (all) => all.map((s) => (s === side ? { ...s, msgs: s.msgs.map(put) } : s)))
      return
    }
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
      const step: ToolStep = { id: e.id, label: e.label, ...(e.code ? { code: e.code } : {}), status: e.status, ...(e.detail ? { detail: e.detail } : {}) }
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
  const c = chats.get(key) ?? { label: key, msgs: [], loaded: false, sides: [] }
  chats.set(key, { ...c, pick })
  emit()
  void window.cn.aiChatSetPick(key, pick)
}

/** 新对话：这个地方的对话清掉（会话号、选的模型和 effort 主进程一起清） */
export function clear(key: string) {
  const c = chats.get(key)
  if (c) chats.set(key, { ...c, msgs: [], pick: null, sides: [] })
  ui.delete(key)
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

// ---------- 旁支（task-4edsc，方向 A「就地展开」）：跟着这个地方的对话存；开着哪一条、刚收起哪一条只在这次打开时有 ----------

/** 改这个地方的旁支（300 毫秒后和对话一起存回去） */
export function updateSides(key: string, f: (sides: Side[]) => Side[]) {
  const c = chats.get(key) ?? { label: key, msgs: [], loaded: false, sides: [] }
  chats.set(key, { ...c, sides: f(c.sides) })
  emit()
  save(key)
}

/** 开着哪一条；flash：刚收起的那一条（那句闪一下） */
const ui = new Map<string, { open: string | null; flash: { side: string; seq: number } | null }>()
const NONE = { open: null, flash: null }
export const sideUi = (key: string) => ui.get(key) ?? NONE

/** 正在答的旁支：旁支编号 → 那条回答的编号 */
const sideRun = new Map<string, number>()
export const sideRunning = (id: string) => sideRun.get(id)
export function setSideRunning(id: string, ai: number | null) {
  if (ai === null) sideRun.delete(id)
  else sideRun.set(id, ai)
  emit()
}

let seq = 0
/** 打开以后光标进旁支的输入框（问这句、小标、小签、⋯ 里切过去） */
let wantFocus = false
export function takeSideFocus(): boolean {
  const w = wantFocus
  wantFocus = false
  return w
}

/** 没问过的空旁支不留（keep 那条除外：刚开、光标在它的输入框里） */
const dropEmpty = (all: Side[], keep: string | null) => all.filter((s) => s.msgs.length || s.id === keep)

/** 在 msg 那条回答里选中的 quote 开一条旁支（一次只开一条：别的收起） */
export function openSide(key: string, label: string, at: { msg: number; quote: string }): string {
  const side: Side = { id: `cs-${Date.now().toString(36)}-${(++seq).toString(36)}`, msg: at.msg, quote: at.quote.replace(/\s+/g, ' ').trim(), msgs: [], createdAt: Date.now() }
  if (!chats.has(key)) chats.set(key, { label, msgs: [], loaded: false, sides: [] })
  updateSides(key, (all) => [...dropEmpty(all, null), side])
  ui.set(key, { open: side.id, flash: null })
  wantFocus = true
  emit()
  return side.id
}

/** 切到一条（小标、小签、⋯）；null 是收起（那句闪一下）。切走时没问过的空旁支不留 */
export function showSide(key: string, id: string | null) {
  const was = sideUi(key).open
  updateSides(key, (all) => dropEmpty(all, id))
  ui.set(key, { open: id, flash: !id && was ? { side: was, seq: ++seq } : null })
  if (id) wantFocus = true
  emit()
}

/** 头上「+」：同一句再开一条 */
export function newSideOn(key: string, label: string, id: string): string | undefined {
  const s = chatOf(key).sides.find((x) => x.id === id)
  return s ? openSide(key, label, { msg: s.msg, quote: s.quote }) : undefined
}

export function renameSide(key: string, id: string, name: string) {
  updateSides(key, (all) => all.map((s) => (s.id === id ? { ...s, name: name.trim() || undefined } : s)))
}

/** 删掉一条：正在答就停下 */
export function deleteSide(key: string, id: string) {
  const ai = sideRun.get(id)
  if (ai !== undefined) void window.cn.aiTurnStop(ai)
  updateSides(key, (all) => all.filter((s) => s.id !== id))
  if (sideUi(key).open === id) ui.set(key, { open: null, flash: null })
  emit()
}
