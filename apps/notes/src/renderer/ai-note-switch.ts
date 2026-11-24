/**
 * 记笔记开关在界面这边（shared/ai-note.ts 说明）：五样「在看什么」的开关，从库里 .canvas-notes/ai-note.json 读一次、记在模块里，
 * 读 PDF 的 AI（ReadingAi）、别处的 AI 对话（AiPanel）、视频问框共用；换库时重读（resetNoteSwitches）。
 */
import { useSyncExternalStore } from 'react'
import { DEFAULT_SWITCH, type NoteKind, type NoteSwitch } from '../shared/ai-note'

let all: Record<NoteKind, NoteSwitch> = DEFAULT_SWITCH
let loaded: Promise<void> | null = null
const subs = new Set<() => void>()
const tell = () => subs.forEach((f) => f())

function load() {
  loaded ??= window.cnReading
    .noteSwitches()
    .then((s) => {
      all = s
      tell()
    })
    .catch((e: unknown) => {
      // 读不到（还没开库）：照默认，下次再读
      loaded = null
      console.error('读记笔记开关失败', e)
    })
  return loaded
}

/** 换库了：下次用到时重读 */
export function resetNoteSwitches() {
  loaded = null
  all = DEFAULT_SWITCH
  tell()
  void load()
}

/** 现在的开关（发问那一刻用它定这一问记不记） */
export function noteSwitchNow(kind: NoteKind): NoteSwitch {
  void load()
  return all[kind]
}

/** 等读好再拿（发问时还没读到文件的那一次） */
export async function noteSwitchReady(kind: NoteKind): Promise<NoteSwitch> {
  await load()
  return all[kind]
}

export function useNoteSwitch(kind: NoteKind): NoteSwitch {
  void load()
  return useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => all[kind],
  )
}

/** 拨一颗：先改界面，再写进库里（写不成退回去、报错交给调用的） */
export async function setNoteSwitch(kind: NoteKind, s: NoteSwitch): Promise<void> {
  const was = all
  all = { ...all, [kind]: s }
  tell()
  try {
    all = await window.cnReading.setNoteSwitch(kind, s)
    tell()
  } catch (e) {
    all = was
    tell()
    throw e
  }
}
