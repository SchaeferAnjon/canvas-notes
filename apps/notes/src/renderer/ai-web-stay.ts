/**
 * 网页上点「引用」「讲解一下」「翻译 + 讲一讲」进哪段对话（偏好「引用留在当前对话」，2026-11-24）：
 * 1. 这个网页点过「留在这个对话」：进那段（那段挂到了这个网页上，「这段 → 那页」表 ai-pages.ts，关了再开照旧）；
 * 2. 不然右栏 AI 标签开着、看着的是一段普通对话或 PDF / HTML 的对话（不是哪个网页自己那段）：进它；
 * 3. 都不是：进这个网页自己那段（照旧，web-notes/flow.ts）。
 * 记进哪篇跟着那段对话走（读 PDF 的记进那份的笔记，普通对话照它自己的规矩），web-notes/target.ts 不管这里。
 * AiDock 每画一次记下看着哪段（setShown），要换到哪段用 showConvo；普通对话收材料走 feedConvo（AiPanel 收）。
 */
import { useSyncExternalStore } from 'react'
import type { Material } from '../shared/materials'
import { convosOn, setPage, usePages, webPage } from './ai-pages'

export interface Convo {
  key: string
  label: string
}

const subs = new Set<() => void>()
const bump = () => {
  for (const s of [...subs]) s()
}
const sub = (f: () => void) => (subs.add(f), () => void subs.delete(f))

// ---------------------------------------------------------------- AI 那一格看着哪段

let shown: (Convo & { open: boolean }) | null = null
/** AiDock：这一格看着的那段；open 是 AI 标签开着（在别的标签后面也算） */
export const setShown = (c: (Convo & { open: boolean }) | null) => void (shown = c)

/** 输入框里有字或带着引用、材料的那段（AiPanel、ReadingAi 每画一次报一回）：换页时这段不算空着，不换走（AI 对话绑页面） */
const drafts = new Map<string, boolean>()
export const setDraft = (key: string, has: boolean) => void (has ? drafts.set(key, true) : drafts.delete(key))
export const hasDraft = (key: string) => drafts.has(key)

// ---------------------------------------------------------------- 留在这个对话（并进「这段 → 那页」表，ai-pages.ts）

/** 这个网页留在哪段：挂到这个网页上的那几段里新挂的那段 */
export const stayOf = (url: string): Convo | null => convosOn(webPage(url))[0] ?? null

/** 「留在这个对话」：这段挂到这个网页上（搬家，一段只挂一页） */
export const setStay = (url: string, c: Convo) => void setPage(c.key, { page: webPage(url), label: c.label })

/** 不留了：挂在这个网页上的几段都回到自己那一页 */
export function clearStay(url: string) {
  for (const c of convosOn(webPage(url))) void setPage(c.key, null)
}

/** 留的变了就重画（头上那一行出不出） */
export const useStays = usePages

/** 是哪个网页自己那段（read:web:…） */
const isWebConvo = (key: string) => key.startsWith('read:web:')

/** 这个网页的引用、讲解进哪段（规则见文件头）；null 是进这个网页自己那段 */
export function convoFor(url: string): Convo | null {
  const s = stayOf(url)
  if (s) return s
  if (shown?.open && !isWebConvo(shown.key)) return { key: shown.key, label: shown.label }
  return null
}

// ---------------------------------------------------------------- 换到那段、交材料

let want: (Convo & { seq: number }) | null = null
let seq = 0

/** AI 那一格换到这段（是这里的就回到这里，别处的当「看别处的对话」开着） */
export function showConvo(c: Convo) {
  want = { ...c, seq: ++seq }
  bump()
}
export const useWantConvo = () => useSyncExternalStore(sub, () => want)
export function wantDone(s: number) {
  if (want?.seq !== s) return
  want = null
  bump()
}

/** 交给普通对话的一块引用；ask 给了是直接问这句（讲解一下），不给是放进输入框（引用） */
export interface Feed {
  key: string
  mat: Material
  ask?: string
  seq: number
}
let feed: Feed | null = null

export function feedConvo(key: string, mat: Material, ask?: string) {
  feed = { key, mat, ...(ask ? { ask } : {}), seq: ++seq }
  bump()
}
export const useFeed = () => useSyncExternalStore(sub, () => feed)
export function feedDone(s: number) {
  if (feed?.seq !== s) return
  feed = null
  bump()
}
