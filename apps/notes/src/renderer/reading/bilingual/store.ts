/**
 * 双语对照读的译文（PDF 和网页阅读视图共用）：按段落指纹记着每段译文；看得到的先翻（几段合一次请求），
 * 翻译走双语翻译插件的 translateBlocks（同一个缓存、引擎、术语表、语言）。缓存在主进程，这里只是这次开着时的。
 * 照 ParaRead 的 ReflowView：视口上下两屏内的段排队；「重新翻译」不读缓存；只看译文时每段能临时「显示原文」。
 */
import { blockHash } from '@cn/format'
import { useSyncExternalStore } from 'react'
import { errorTitle, langName, LANG_ZH, primary, type TrError } from '../../../shared/plugins/translate'
import { translateBlocks } from '../../plugins/translate/api'
import { settingsNow } from '../../plugins/translate/shared'

export interface Tr {
  state: 'wait' | 'ok' | 'err'
  text?: string
  error?: string
}

/** 原文 / 对照 / 只看译文；对照时的版式 并排 / 重排 */
export type BiMode = 'orig' | 'bi' | 'tr'
export type BiLayout = 'side' | 'flow'

interface Source {
  /** 段落指纹 → 译文 */
  tr: Record<string, Tr>
  /** 只看译文时临时露出原文的段 */
  showOrig: Record<string, true>
  /** 翻成什么（换了语言就全部重来） */
  target: string
}

const sources = new Map<string, Source>()
const subs = new Set<() => void>()
let version = 0
const emit = () => {
  version++
  for (const s of subs) s()
}

function src(key: string): Source {
  const target = settingsNow().target
  let s = sources.get(key)
  if (!s || s.target !== target) {
    s = { tr: {}, showOrig: {}, target }
    sources.set(key, s)
  }
  return s
}

export function useBi(key: string): Source {
  useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    () => version,
  )
  return src(key)
}

export const hashOf = (text: string) => blockHash(text)

/** 现在有的译文（存双语笔记时一次拿走） */
export const trOf = (key: string) => src(key).tr

/** 「英文 → 中文」：原文的语言按字认，译文是设置里的 */
export function langsLine(sample: string): string {
  const target = settingsNow().target
  const t = langName(target)
  const zhT = LANG_ZH[primary(target)] ?? t
  const han = (sample.match(/[一-鿿]/g) ?? []).length
  const latin = (sample.match(/[A-Za-z]/g) ?? []).length
  const from = han > latin ? '中文' : latin ? '英文' : '原文'
  return `${from} → ${zhT}`
}

/** 正在翻的请求：同一段不重复要 */
const inflight = new Map<string, Set<string>>()

/**
 * 要这些段的译文（已经有的、正在翻的跳过）。course：照哪门课的术语表（null 不用）。
 * 返回翻完的 Promise。
 */
export function request(key: string, blocks: { text: string }[], course: string | null, fresh = false): Promise<void> {
  const s = src(key)
  const busy = inflight.get(key) ?? new Set<string>()
  inflight.set(key, busy)
  const want = new Map<string, string>()
  for (const b of blocks) {
    const h = hashOf(b.text)
    if (want.has(h) || busy.has(h)) continue
    if (!fresh && (s.tr[h]?.state === 'ok' || s.tr[h]?.state === 'wait')) continue
    want.set(h, b.text)
  }
  if (!want.size) return Promise.resolve()
  for (const h of want.keys()) {
    busy.add(h)
    s.tr[h] = { state: 'wait', ...(fresh && s.tr[h]?.text ? { text: s.tr[h]!.text } : {}) }
  }
  emit()
  const job = translateBlocks(
    [...want].map(([id, text]) => ({ id, text })),
    { target: s.target, course, ...(fresh ? { fresh: true } : {}) },
    (r) => {
      busy.delete(r.id)
      s.tr[r.id] = r.text !== null ? { state: 'ok', text: r.text } : { state: 'err', error: r.error ? errorTitle(r.error as TrError) : '没翻成' }
      emit()
    },
  )
  return job.done.then(
    () => settle(key, [...want.keys()], '没翻成'),
    (e: unknown) => settle(key, [...want.keys()], String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')),
  )
}

/** 一批回来了，还在等的算没翻成 */
function settle(key: string, hashes: string[], why: string) {
  const s = src(key)
  const busy = inflight.get(key)
  let changed = false
  for (const h of hashes) {
    busy?.delete(h)
    if (s.tr[h]?.state === 'wait') {
      s.tr[h] = { state: 'err', error: why }
      changed = true
    }
  }
  if (changed) emit()
}

export function toggleOrig(key: string, text: string) {
  const s = src(key)
  const h = hashOf(text)
  if (s.showOrig[h]) delete s.showOrig[h]
  else s.showOrig[h] = true
  emit()
}

// ---------------------------------------------------------------- 选的显示（每份 PDF 记着）

const modeKey = (key: string) => `cn.bi:${key}`

export function savedMode(key: string): { mode: BiMode; layout?: BiLayout } {
  try {
    const v = JSON.parse(localStorage.getItem(modeKey(key)) ?? 'null') as { mode?: unknown; layout?: unknown } | null
    const mode = v?.mode === 'bi' || v?.mode === 'tr' ? v.mode : 'orig'
    return { mode, ...(v?.layout === 'side' || v?.layout === 'flow' ? { layout: v.layout } : {}) }
  } catch {
    return { mode: 'orig' }
  }
}

export function saveMode(key: string, v: { mode: BiMode; layout?: BiLayout }) {
  try {
    localStorage.setItem(modeKey(key), JSON.stringify(v))
  } catch {
    // 记不住只是下次回到原文
  }
}

/** ⌥A 轮流：原文 → 对照 → 只看译文 → 原文 */
export const nextMode = (m: BiMode): BiMode => (m === 'orig' ? 'bi' : m === 'bi' ? 'tr' : 'orig')

/** 没手选过版式时：右栏 AI 开着、中间栏窄于 1100 → 重排；不然并排 */
export const autoLayout = (aiOpen: boolean, width: number): BiLayout => (aiOpen && width < 1100 ? 'flow' : 'side')
