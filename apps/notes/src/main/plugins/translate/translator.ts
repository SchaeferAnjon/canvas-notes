/**
 * 翻译：一批段落问一次 AI，要它每段回一行 JSON（{"id":编号,"text":"译文"}），边生成边按行拆出来，
 * 先出来的段先显示。漏了的段再问一次；还漏就报「没翻成」（带原因，见 errors.ts）。
 * 有课程术语表时，这批里出现的词放进提示（「术语照这个译」），缓存键也带上用到的术语：改了表的段会重翻。
 * 每段按「目标语言 + 原文 + 用到的术语」缓存，同一段不再问。不碰 Electron，能单独测。
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { langName, pickTerms, type Term, type TrEngineId, type TrError } from '../../../shared/plugins/translate'
import { toTrError } from './errors'

export interface Item {
  id: number
  text: string
}

/** 问一次 AI：给回答（路由器还告诉是哪个引擎答的） */
export type AskFn = (system: string, prompt: string, signal: AbortSignal, onText: (delta: string) => void) => Promise<string | { text: string; engine: TrEngineId }>

export type OnResult = (id: number, text: string | null, error?: TrError) => void

export const SYSTEM = '你是翻译。只按要求的格式输出译文，不解释、不加别的话。'

export function buildPrompt(items: Item[], target: string, terms: Term[] = []): string {
  return [
    '命令：翻译段落',
    `目标语言：${langName(target)}（${target}）`,
    '把下面每一段翻成目标语言，意思准确、读起来自然，专有名词照惯用译法，数字和符号照原样。',
    ...(terms.length ? [`术语照这个译：${terms.map((t) => `${t.src} → ${t.dst}`).join('；')}`] : []),
    '每段输出一行 JSON：{"id":编号,"text":"译文"}，按编号顺序，一段一行；不要代码块，不要别的话。已经是目标语言的段原样返回。',
    '段落：',
    JSON.stringify(items.map((i) => ({ id: i.id, text: i.text }))),
  ].join('\n')
}

/** 用到的术语算一个短指纹，进缓存键 */
export function termsKey(terms: Term[]): string {
  if (!terms.length) return ''
  return createHash('sha1')
    .update(terms.map((t) => `${t.src}\u0001${t.dst}`).join('\u0002'))
    .digest('base64url')
    .slice(0, 12)
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

  private key(target: string, text: string, terms: string) {
    const h = createHash('sha1').update(target).update('\0').update(text)
    if (terms) h.update('\0').update(terms)
    return h.digest('base64url')
  }

  /** terms：用到的术语的指纹（termsKey），没用术语是空的 */
  get(target: string, text: string, terms = ''): string | undefined {
    return this.map.get(this.key(target, text, terms))
  }

  set(target: string, text: string, tr: string, terms = '') {
    const k = this.key(target, text, terms)
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

  /**
   * 翻一批：每翻好一段调一次 onResult（缓存里有的马上给）；没翻成的给原因。
   * glossary 是这门课的术语表（没有就是空的），这批里出现的放进提示。
   * 出错时：命令行退出、网络断这类再试一次；没登录、Key 不对、太快这类不白试。漏段再问一次，还漏是「格式不对」。
   */
  async translate(items: Item[], target: string, onResult: OnResult, signal: AbortSignal, glossary: Term[] = [], fresh = false): Promise<void> {
    const todo: (Item & { terms: Term[]; tkey: string })[] = []
    for (const it of items) {
      const terms = pickTerms(glossary, [it.text])
      const tkey = termsKey(terms)
      // fresh：「重新翻译」不看缓存，翻好的照样存回去（换掉旧的）
      const hit = fresh ? undefined : this.cache.get(target, it.text, tkey)
      if (hit !== undefined) {
        this.stats.fromCache++
        onResult(it.id, hit)
      } else todo.push({ ...it, terms, tkey })
    }
    let left = todo
    let lastError: TrError | null = null
    let engine: TrEngineId | undefined
    for (let attempt = 0; attempt < 2 && left.length && !signal.aborted; attempt++) {
      const byId = new Map(left.map((i) => [i.id, i]))
      const done = new Set<number>()
      const take = (id: number, tr: string) => {
        const it = byId.get(id)
        if (!it || done.has(id)) return
        done.add(id)
        this.stats.fromAi++
        this.cache.set(target, it.text, tr, it.tkey)
        onResult(id, tr)
      }
      const terms = pickTerms(glossary, left.map((i) => i.text))
      try {
        let buf = ''
        const out = await this.slot(() => {
          this.stats.aiCalls++
          return this.ask(SYSTEM, buildPrompt(left, target, terms), signal, (delta) => {
            buf += delta
            let nl: number
            while ((nl = buf.indexOf('\n')) !== -1) {
              const p = parseLine(buf.slice(0, nl))
              buf = buf.slice(nl + 1)
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
