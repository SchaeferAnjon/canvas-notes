/**
 * 翻译：一批段落问一次 AI，要它每段回一行 JSON（{"id":编号,"text":"译文"}），边生成边按行拆出来，
 * 先出来的段先显示。漏了的段再问一次；还漏就报「没翻成」。每段按「目标语言 + 原文」缓存，同一段不再问。
 * 不碰 Electron，能单独测。
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { langName } from '../../../shared/plugins/translate'

export interface Item {
  id: number
  text: string
}

export type AskFn = (system: string, prompt: string, signal: AbortSignal, onText: (delta: string) => void) => Promise<string>

export const SYSTEM = '你是翻译。只按要求的格式输出译文，不解释、不加别的话。'

export function buildPrompt(items: Item[], target: string): string {
  return [
    '命令：翻译段落',
    `目标语言：${langName(target)}（${target}）`,
    '把下面每一段翻成目标语言，意思准确、读起来自然，专有名词照惯用译法，数字和符号照原样。',
    '每段输出一行 JSON：{"id":编号,"text":"译文"}，按编号顺序，一段一行；不要代码块，不要别的话。已经是目标语言的段原样返回。',
    '段落：',
    JSON.stringify(items.map((i) => ({ id: i.id, text: i.text }))),
  ].join('\n')
}

/** 从一行里拆出 {id, text}；不是这样的一行给 null */
export function parseLine(line: string): { id: number; text: string } | null {
  const s = line.trim().replace(/^```(json)?|```$/g, '').trim().replace(/,$/, '')
  if (!s.startsWith('{')) return null
  try {
    const o = JSON.parse(s) as { id?: unknown; text?: unknown }
    const id = typeof o.id === 'string' ? Number(o.id) : o.id
    if (typeof id !== 'number' || !Number.isFinite(id) || typeof o.text !== 'string') return null
    return { id, text: o.text }
  } catch {
    return null
  }
}

/** 整段回答不是一行一个的时候（给了一个数组或者 {"1":"…"}）：整体再拆一次 */
export function parseWhole(text: string): Map<number, string> {
  const out = new Map<number, string>()
  for (const line of text.split('\n')) {
    const p = parseLine(line)
    if (p) out.set(p.id, p.text)
  }
  if (out.size) return out
  const body = text.replace(/```(json)?/g, '').trim()
  try {
    const o = JSON.parse(body) as unknown
    if (Array.isArray(o)) {
      for (const x of o as { id?: unknown; text?: unknown }[]) if (typeof x?.text === 'string' && Number.isFinite(Number(x.id))) out.set(Number(x.id), x.text)
    } else if (o && typeof o === 'object') {
      for (const [k, v] of Object.entries(o)) if (typeof v === 'string' && Number.isFinite(Number(k))) out.set(Number(k), v)
    }
  } catch {
    // 拆不出来：当没翻
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
    writeFileSync(this.file + '.tmp', JSON.stringify({ v: 1, entries: [...this.map] }))
    renameSync(this.file + '.tmp', this.file)
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

  /** 翻一批：每翻好一段调一次 onResult（缓存里有的马上给）；没翻成的给 error */
  async translate(items: Item[], target: string, onResult: (id: number, text: string | null, error?: string) => void, signal: AbortSignal): Promise<void> {
    const todo: Item[] = []
    for (const it of items) {
      const hit = this.cache.get(target, it.text)
      if (hit !== undefined) {
        this.stats.fromCache++
        onResult(it.id, hit)
      } else todo.push(it)
    }
    let left = todo
    let lastError = '没翻成'
    for (let attempt = 0; attempt < 2 && left.length && !signal.aborted; attempt++) {
      const byId = new Map(left.map((i) => [i.id, i]))
      const done = new Set<number>()
      const take = (id: number, tr: string) => {
        const it = byId.get(id)
        if (!it || done.has(id)) return
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
            buf += delta
            let nl: number
            while ((nl = buf.indexOf('\n')) !== -1) {
              const p = parseLine(buf.slice(0, nl))
              buf = buf.slice(nl + 1)
              if (p) take(p.id, p.text)
            }
          })
        })
        for (const [id, tr] of parseWhole(out)) take(id, tr)
      } catch (e) {
        if (signal.aborted) return
        lastError = String((e as Error).message ?? e)
      }
      left = left.filter((i) => !done.has(i.id))
    }
    if (signal.aborted) return
    for (const it of left) onResult(it.id, null, lastError)
  }
}
