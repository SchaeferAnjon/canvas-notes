/**
 * 翻译：一批段落问一次 AI，要它每段回一行 JSON（{"id":编号,"text":"译文"}），边生成边按行拆出来，
 * 先出来的段先显示。漏了的段（回了空的也算）再问一次；还漏就报「没翻成」（带原因，见 errors.ts）。
 * 每段按「目标语言 + 原文」缓存，同一段不再问（2026-11-22 术语表拿掉了，task-6cxtc：提示和缓存键都不带术语）。不碰 Electron，能单独测。
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { langName, type TrEngineId, type TrError } from '../../../shared/plugins/translate'
import { toTrError } from './errors'
import { atomicWriteSync } from '@cn/atomic'

export interface Item {
  id: number
  text: string
}

/** 问一次 AI：给回答（路由器还告诉是哪个引擎答的） */
export type AskFn = (system: string, prompt: string, signal: AbortSignal, onText: (delta: string) => void) => Promise<string | { text: string; engine: TrEngineId }>

export type OnResult = (id: number, text: string | null, error?: TrError) => void

export const SYSTEM = '你是翻译。只按要求的格式输出译文，不解释、不加别的话。'

export function buildPrompt(items: Item[], target: string): string {
  return [
    '命令：翻译段落',
    `目标语言：${langName(target)}（${target}）`,
    '把下面每一段翻成目标语言，意思准确、读起来自然，专有名词照惯用译法，数字和符号照原样。',
    // 视频字幕一句常拆成几行：模型爱把整句译文塞进第一行、后一行重复或留空，对着画面就是「内容不对」（r172）
    '每段只译它自己的字，不要把前后段的意思挪进来、合并或重复；半句话就译成半句。',
    '每段输出一行 JSON：{"id":编号,"text":"译文"}，按编号顺序，一段一行；不要代码块，不要别的话。已经是目标语言的段原样返回。',
    '段落：',
    JSON.stringify(items.map((i) => ({ id: i.id, text: i.text }))),
  ].join('\n')
}

/** 一个 JSON 对象里的一段译文：{"id":1,"text":"…"}（有的模型写 "translation"）；不是这样的给 null */
function itemOf(o: unknown): { id: number; text: string } | null {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null
  const r = o as { id?: unknown; text?: unknown; translation?: unknown }
  const id = typeof r.id === 'string' && r.id.trim() ? Number(r.id) : r.id
  const text = typeof r.text === 'string' ? r.text : typeof r.translation === 'string' ? r.translation : null
  return typeof id === 'number' && Number.isFinite(id) && text !== null ? { id, text } : null
}

/**
 * 从回答里找出完整的 JSON 对象（花括号配对，字符串里的括号、转义不算）：前后夹着话、一行几个、一个对象拆成几行、
 * 前面带「1.」「- 」、包在数组或代码块里都认得。rest 是最后一个完整对象后面还没收完的（边生成边拆时接着往后拼）。
 * 以前只认「一行一个、行首就是 {」和「整段就是一个数组」，模型多说一句、换个排法整批就「格式不对」（r172：朋友那里「无法解析」）
 */
export function takeObjects(text: string): { found: unknown[]; rest: string } {
  const found: unknown[] = []
  let depth = 0
  let start = -1
  let inStr = false
  let esc = false
  let cut = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') {
      if (depth > 0) inStr = true
    } else if (ch === '{') {
      if (depth === 0) start = i
      depth++
    } else if (ch === '}' && depth > 0) {
      depth--
      if (depth === 0) {
        try {
          found.push(JSON.parse(text.slice(start, i + 1)))
        } catch {
          // 不是合法的 JSON（模型写坏了一段）：跳过这一段，后面的照拆
        }
        cut = i + 1
      }
    }
  }
  return { found, rest: depth > 0 ? text.slice(start) : text.slice(cut) }
}

/** 从一段（一行或几行）里拆出第一段译文；没有给 null */
export function parseLine(line: string): { id: number; text: string } | null {
  for (const o of takeObjects(line).found) {
    const it = itemOf(o)
    if (it) return it
  }
  return null
}

/** 整段回答拆成 编号 → 译文：一个个对象（见 takeObjects），或者整个是 {"1":"…","2":"…"} */
export function parseWhole(text: string): Map<number, string> {
  const out = new Map<number, string>()
  const objs = takeObjects(text).found
  for (const o of objs) {
    const it = itemOf(o)
    if (it) out.set(it.id, it.text)
  }
  if (out.size) return out
  for (const o of objs) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) continue
    for (const [k, v] of Object.entries(o)) if (typeof v === 'string' && Number.isFinite(Number(k))) out.set(Number(k), v)
  }
  return out
}

const MAX_CACHE = 20_000

/** 段落缓存：键是「目标语言 + 原文」的哈希，存在文件里，软件重开还在 */
export class TranslationCache {
  private map = new Map<string, string>()
  private timer: NodeJS.Timeout | null = null

  constructor(private file: string | null) {
    if (!file) return
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as { entries?: [string, string][] }
      for (const [k, v] of raw.entries ?? []) if (typeof k === 'string' && typeof v === 'string') this.map.set(k, v)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT' && !(e instanceof SyntaxError)) throw e
    }
  }

  private key(target: string, text: string) {
    return createHash('sha1').update(target).update('\0').update(text).digest('base64url')
  }

  get(target: string, text: string): string | undefined {
    return this.map.get(this.key(target, text))
  }

  set(target: string, text: string, tr: string) {
    const k = this.key(target, text)
    this.map.delete(k)
    this.map.set(k, tr)
    while (this.map.size > MAX_CACHE) this.map.delete(this.map.keys().next().value!)
    this.later()
  }

  get size() {
    return this.map.size
  }

  clear() {
    this.map.clear()
    this.flush()
  }

  private later() {
    if (this.timer || !this.file) return
    this.timer = setTimeout(() => this.flush(), 2000)
  }

  flush() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (!this.file) return
    mkdirSync(dirname(this.file), { recursive: true })
    atomicWriteSync(this.file, JSON.stringify({ v: 1, entries: [...this.map] }))
  }
}

export interface Stats {
  /** 问了 AI 几次 */
  aiCalls: number
  /** 从缓存拿了几段 */
  fromCache: number
  /** AI 翻了几段 */
  fromAi: number
}

/** 同时最多几次 AI 调用（每次是一个命令行进程） */
const CONCURRENCY = 4

export class Translator {
  stats: Stats = { aiCalls: 0, fromCache: 0, fromAi: 0 }
  private running = 0
  private waiting: (() => void)[] = []

  constructor(
    private ask: AskFn,
    readonly cache: TranslationCache,
  ) {}

  private async slot<T>(f: () => Promise<T>): Promise<T> {
    if (this.running >= CONCURRENCY) await new Promise<void>((r) => this.waiting.push(r))
    this.running++
    try {
      return await f()
    } finally {
      this.running--
      this.waiting.shift()?.()
    }
  }

  /**
   * 翻一批：每翻好一段调一次 onResult（缓存里有的马上给）；没翻成的给原因。
   * 出错时：命令行退出、网络断这类再试一次；没登录、Key 不对、太快这类不白试。漏段再问一次，还漏是「格式不对」。
   */
  async translate(items: Item[], target: string, onResult: OnResult, signal: AbortSignal, fresh = false): Promise<void> {
    const todo: Item[] = []
    for (const it of items) {
      // fresh：「重新翻译」不看缓存，翻好的照样存回去（换掉旧的）
      const hit = fresh ? undefined : this.cache.get(target, it.text)
      // 旧版本存下的空译文不算（以前回空的也进了缓存，重试永远拿回空的）
      if (hit !== undefined && hit.trim()) {
        this.stats.fromCache++
        onResult(it.id, hit)
      } else todo.push(it)
    }
    let left = todo
    let lastError: TrError | null = null
    let engine: TrEngineId | undefined
    for (let attempt = 0; attempt < 2 && left.length && !signal.aborted; attempt++) {
      const byId = new Map(left.map((i) => [i.id, i]))
      const done = new Set<number>()
      const take = (id: number, tr: string) => {
        const it = byId.get(id)
        // 回了空的（一句拆在两行字幕里，AI 常把整句译文放进一行、另一行留空）：当漏了，下一轮单独再问
        if (!it || done.has(id) || !tr.trim()) return
        done.add(id)
        this.stats.fromAi++
        this.cache.set(target, it.text, tr)
        onResult(id, tr)
      }
      try {
        let buf = ''
        const out = await this.slot(() => {
          this.stats.aiCalls++
          return this.ask(SYSTEM, buildPrompt(left, target), signal, (delta) => {
            // 边生成边拆：每拼出一个完整的对象就交出去（不管前后有没有换行、夹没夹着话）
            const got = takeObjects(buf + delta)
            buf = got.rest
            for (const o of got.found) {
              const p = itemOf(o)
              if (p) take(p.id, p.text)
            }
          })
        })
        const text = typeof out === 'string' ? out : out.text
        if (typeof out !== 'string') engine = out.engine
        for (const [id, tr] of parseWhole(text)) take(id, tr)
        lastError = null
      } catch (e) {
        if (signal.aborted) return
        lastError = toTrError(e)
        if (!RETRY.includes(lastError.code)) break
      }
      left = left.filter((i) => !done.has(i.id))
    }
    if (signal.aborted) return
    const err: TrError = lastError ?? { code: 'bad-output', ...(engine ? { engine } : {}), raw: `AI 回的格式不对，漏了 ${left.length} 段（已经自动重问过一次）` }
    for (const it of left) onResult(it.id, null, err)
  }
}

/** 这几种再问一次可能就好了 */
const RETRY: TrError['code'][] = ['exited', 'network', 'other']
