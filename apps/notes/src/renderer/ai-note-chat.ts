/**
 * 别处的 AI 对话（AiPanel）记笔记这一半（shared/ai-note.ts 说明，方向 A）：哪条回答记进了哪篇、正在记、没记成。
 * 记在模块里按对话（地方的 key）分：换了页面，正在写的那一问照样写完、回来照样看得到。
 * 「已记进」以笔记里认出来的为准（refreshNoted 问 noteHas），重开软件不靠内存；一段对话的写排队（补进去按问的先后）。
 */
import { useSyncExternalStore } from 'react'
import { type AskMat, type NoteAsk, webSrc } from '@cn/format'
import type { NoteTarget } from '../shared/ai-note'
import { type Material, PASTED_NAME } from '../shared/materials'
import { fragmentUrl } from '../shared/web-link'
import { writeAskInto } from './web-notes/flow'
import { titleOf } from '../shared/layout'
import { withoutEffort } from '@cn/ai-engines/shared'
import { hideToolMarkup } from '../shared/tool-markup'
import type { NotedState } from './ai-note-ui'
import * as C from './ai-chats'

/** 一条回答记的样子；note 是记进的那篇（库里的路径） */
export type Noted = NotedState & { note: string }

const byKey = new Map<string, Map<number, Noted>>()
const subs = new Set<() => void>()
let version = 0
const emit = () => {
  version++
  subs.forEach((f) => f())
}

function put(key: string, msg: number, v: Noted | null) {
  const m = new Map(byKey.get(key))
  if (v) m.set(msg, v)
  else m.delete(msg)
  byKey.set(key, m)
  emit()
}

/** 这段对话里哪几条回答记了（跟着变） */
export function useNoted(key: string): ReadonlyMap<number, Noted> {
  useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => version,
  )
  return byKey.get(key) ?? EMPTY
}
const EMPTY: ReadonlyMap<number, Noted> = new Map()

export const notedNow = (key: string, msg: number): Noted | undefined => byKey.get(key)?.get(msg)

/** 照笔记里认：这几篇里记着这段对话的哪几条（正在写、没写成的留着） */
export async function refreshNoted(key: string, notes: string[]) {
  const got = new Map<number, Noted>()
  for (const note of [...new Set(notes)]) {
    const ids = await window.cnReading.noteHas(note, key)
    for (const id of ids) got.set(id, { state: 'done', to: titleOf(note), note })
  }
  for (const [id, v] of byKey.get(key) ?? []) if (v.state !== 'done' && !got.has(id)) got.set(id, v)
  byKey.set(key, got)
  emit()
}

/** 新对话：这段对话记的样子清掉（笔记里已经写的留着） */
export function forgetNoted(key: string) {
  byKey.delete(key)
  emit()
}

const queues = new Map<string, Promise<unknown>>()
/** 同一段对话的写一个接一个（补进去按问的先后，答完自动记的排在后面） */
function queued<T>(key: string, f: () => Promise<T>): Promise<T> {
  const run = (queues.get(key) ?? Promise.resolve()).then(f, f)
  queues.set(
    key,
    run.catch(() => undefined),
  )
  return run
}

const errText = (e: unknown) => String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/**
 * 问的那句带的材料（输入框顶上那一排）：引用的字（网页上引的来源写成回到那一段的链接）；图（贴的、网页上框的、拖进来的）还在 pasted/ 里，
 * 路径先写文件名，主进程记的时候拷进库里
 */
const matsOf = (mats?: Material[]): AskMat[] =>
  (mats ?? []).flatMap((m): AskMat[] => {
    if (m.kind === 'quote') return [{ kind: 'quote', text: m.text, ...(m.url && /^https?:/i.test(m.url) ? { src: `${m.src} ↩`, href: webSrc('', '', fragmentUrl(m.url, m.text)).href } : { src: m.src }) }]
    return PASTED_NAME.test(m.name) ? [{ kind: 'image', path: m.name, src: m.src }] : []
  })

/** 回答原文（去掉模型写成字的工具调用，和画出来的一样；步骤不在字里） */
const answerOf = (m: C.Msg) => hideToolMarkup(m.text ?? '', false).trim()

/** 答完了、能记的一条回答：有字、没出错，不是命令的结果（按钮、挪的几条、找重复…）；动了文件的照样记字 */
export const notable = (m: C.Msg | undefined): m is C.Msg => !!m && m.role === 'ai' && !m.pending && !m.live && !m.error && !!m.text?.trim() && !m.actions?.length && !m.dups && !m.moves && !m.dream && !m.draft

/** 问的那条能记：不是 / 命令 */
export const askable = (m: C.Msg | undefined): m is C.Msg => !!m && m.role === 'user' && !/^\//.test(m.text?.trim() ?? '')

/** 主对话里这条回答记进去的一问（前面那条是问的）；记不了是 null */
export function mainAsk(key: string, msg: number): NoteAsk | null {
  const msgs = C.chatOf(key).msgs
  const i = msgs.findIndex((m) => m.id === msg && m.role === 'ai')
  const a = msgs[i]
  const q = msgs[i - 1]
  if (!notable(a) || !askable(q)) return null
  const mats = matsOf(q.mats)
  return { key, msg, q: q.text ?? '', a: answerOf(a), ...(a.by ? { by: withoutEffort(a.by) } : {}), ...(mats.length ? { mats } : {}) }
}

/** 旁支里这条回答记进去的一问：引用那一句、被问那一问的原话、那一问回答的编号（插在它后面） */
export function sideAsk(key: string, msg: number): NoteAsk | null {
  const c = C.chatOf(key)
  const side = c.sides.find((s) => s.msgs.some((m) => m.id === msg && m.role === 'ai'))
  if (!side) return null
  const i = side.msgs.findIndex((m) => m.id === msg)
  const a = side.msgs[i]
  const q = side.msgs[i - 1]
  if (!notable(a) || q?.role !== 'user') return null
  const k = c.msgs.findIndex((m) => m.id === side.msg)
  const parent = c.msgs
    .slice(0, Math.max(0, k))
    .reverse()
    .find((m) => m.role === 'user')?.text
  const mats = matsOf(q.mats)
  return {
    key,
    msg,
    q: q.text ?? '',
    a: answerOf(a),
    ...(a.by ? { by: withoutEffort(a.by) } : {}),
    side: { quote: side.quote, ...(parent ? { parent } : {}), of: side.msg },
    ...(mats.length ? { mats } : {}),
  }
}

/** 记一问（主对话或旁支的这条回答）进 to，在 heading 那一节（to.inline 的写进那篇本身：光标处或末尾）；写不成写在这一条下面 */
export function noteOne(key: string, msg: number, to: NoteTarget, heading: string): Promise<void> {
  return queued(key, async () => {
    const ask = mainAsk(key, msg) ?? sideAsk(key, msg)
    if (!ask) return
    put(key, msg, { state: 'writing', note: to.path })
    try {
      const r = await window.cnReading.noteAppend({ note: to.path, ask, place: { heading }, ...(to.create ? { create: to.create } : {}), ...(to.inline ? { inline: true } : {}) })
      // 写进那篇本身的（看着的文档、网页上引了一段问的记进剪藏那篇）：插在光标处或接在末尾、提交
      if (r.md !== undefined) await writeAskInto(r.note, r.md, { files: r.files ?? [], subject: ask.q })
      put(key, msg, { state: 'done', to: titleOf(r.note), note: r.note })
    } catch (e) {
      put(key, msg, { state: 'error', error: errText(e), note: to.path })
    }
  })
}

/** 撤回、⋯「从《…》拿掉」：主对话的一问连着它后面的旁支一起拿掉，拿完照笔记重认一遍 */
export function unnote(key: string, msg: number): Promise<void> {
  return queued(key, async () => {
    const v = notedNow(key, msg)
    if (!v || v.state !== 'done') return
    put(key, msg, { ...v, undoing: true })
    try {
      await window.cnReading.noteRemove({ note: v.note, key, msg })
      put(key, msg, null)
      await refreshNoted(key, [...(byKey.get(key)?.values() ?? [])].map((x) => x.note).concat(v.note))
    } catch (e) {
      put(key, msg, { state: 'error', error: errText(e), note: v.note })
    }
  })
}
