/**
 * 翻译用什么：四个本机命令行 + 两个 API，按设置「自动」（从上往下用第一个能用的，一个用不了就换下一个，不打扰人）
 * 或「指定一个」（只用它，它不行就直接报）。状态在打开设置页、按翻译按钮时查一次（不轮询、不真的问 AI）；
 * 问的时候发现用不了的（没登录、Key 不对、余额不够、模型不对），记下来，自动模式下这一批和后面的批都跳过它。
 * 不碰 Electron，能单独测。
 */
import {
  engineMeta,
  type EngineState,
  type EngineStatus,
  type TrEngineId,
  type TrError,
  type TranslateSettings,
  stateError,
} from '../../../shared/plugins/translate'
import { type ApiProvider, askApi, isApi, PROVIDERS } from './api'
import type { CliBackend } from '../host'
import { SWITCHABLE, toTrError, TranslateError } from './errors'
import type { KeyStore } from './keys'

/** 命令行多久一个字都没吐算没回应 */
export const CLI_IDLE_MS = 60_000

const MARK: Partial<Record<TrError['code'], EngineState>> = {
  'not-installed': 'missing',
  'not-logged-in': 'login',
  'bad-key': 'badkey',
  'no-key': 'nokey',
  'no-balance': 'nobalance',
  'bad-model': 'badmodel',
}

export interface RouterDeps {
  cli: CliBackend
  keys: KeyStore
  settings(): TranslateSettings
  /** 测试里缩短「没回应」的时间 */
  idleMs?: number
  env?: NodeJS.ProcessEnv
}

export class EngineRouter {
  /** 查过的状态（命令行在不在、登录没有） */
  private checked = new Map<TrEngineId, EngineState>()
  /** 问的时候发现用不了的 */
  private marks = new Map<TrEngineId, EngineState>()
  private running = new Map<TrEngineId, number>()
  private waiting = new Map<TrEngineId, (() => void)[]>()
  /** 上一次真答了的 */
  lastUsed: TrEngineId | null = null

  constructor(private d: RouterDeps) {}

  /** 重新查一遍（打开设置页、按翻译按钮时）：命令行的记号清掉，可能刚登录好；API 的记号留着，换了 Key 才清 */
  refresh() {
    this.checked.clear()
    for (const [id, st] of [...this.marks]) if (!isApi(id) || st === 'badmodel') this.marks.delete(id)
  }

  state(id: TrEngineId): EngineState {
    const mark = this.marks.get(id)
    if (mark) return mark
    let st = this.checked.get(id)
    if (!st) {
      st = isApi(id) ? (this.d.keys.has(id) ? 'ok' : 'nokey') : this.d.cli.state(id)
      this.checked.set(id, st)
    }
    return st
  }

  /** 换了 Key、测试连接通了：重新算 */
  forget(id: TrEngineId) {
    this.marks.delete(id)
    this.checked.delete(id)
  }

  /** 设置页的列表：按设置里的顺序 */
  statuses(): EngineStatus[] {
    const order = this.d.settings().engineOrder
    return order.map((id) => {
      const m = engineMeta(id)
      const tail = isApi(id) ? this.d.keys.tail(id) : undefined
      return { id, name: m.name, kind: m.kind, sub: m.sub, state: this.state(id), ...(tail ? { keyTail: tail } : {}) }
    })
  }

  /** 现在会用哪个（没有能用的给 null） */
  current(): TrEngineId | null {
    const s = this.d.settings()
    if (s.engineMode === 'pick') return this.state(s.pick) === 'ok' ? s.pick : null
    return s.engineOrder.find((id) => this.state(id) === 'ok') ?? null
  }

  /** 记下这个引擎现在用不了（测试连接发现 Key 不对、余额不够） */
  mark(id: TrEngineId, st: EngineState) {
    this.marks.set(id, st)
  }

  /** 开翻译之前先查：有没有能用的（不真的问 AI）；refresh 时重新看命令行和登录 */
  preflight(refresh = true): { ok: true; engine: TrEngineId } | { ok: false; error: TrError } {
    if (refresh) this.refresh()
    const cur = this.current()
    if (cur) return { ok: true, engine: cur }
    const s = this.d.settings()
    if (s.engineMode === 'pick') return { ok: false, error: stateError(s.pick, this.state(s.pick)) }
    return { ok: false, error: { code: 'none', raw: noneReason(this.statuses()) } }
  }

  /** 按设置问：自动模式下用不了的换下一个；都不行报最后一个的原因（一个都没有就是 none） */
  async ask(system: string, prompt: string, signal: AbortSignal, onText: (d: string) => void): Promise<{ text: string; engine: TrEngineId }> {
    const s = this.d.settings()
    const order = s.engineMode === 'pick' ? [s.pick] : s.engineOrder
    let last: TrError | null = null
    for (const id of order) {
      const st = this.state(id)
      if (st !== 'ok') {
        if (s.engineMode === 'pick') throw new TranslateError(stateError(id, st))
        continue
      }
      try {
        const text = await this.askOne(id, system, prompt, signal, onText)
        this.lastUsed = id
        return { text, engine: id }
      } catch (e) {
        if (signal.aborted) throw e
        const info = toTrError(e, id)
        const mark = MARK[info.code]
        if (mark) this.marks.set(id, mark)
        if (s.engineMode === 'auto' && SWITCHABLE.includes(info.code)) {
          last = info
          continue
        }
        throw new TranslateError(info)
      }
    }
    throw new TranslateError(last ?? { code: 'none', raw: noneReason(this.statuses()) })
  }

  /** 只用这一个问（测试连接、指定模式）；同一个引擎同时问的次数有上限（API 照各家的并发，命令行 4） */
  async askOne(id: TrEngineId, system: string, prompt: string, signal: AbortSignal, onText: (d: string) => void): Promise<string> {
    const limit = isApi(id) ? PROVIDERS[id].concurrency : 4
    if ((this.running.get(id) ?? 0) >= limit) {
      await new Promise<void>((r) => {
        const q = this.waiting.get(id) ?? []
        q.push(r)
        this.waiting.set(id, q)
      })
    }
    this.running.set(id, (this.running.get(id) ?? 0) + 1)
    try {
      if (isApi(id)) {
        const key = this.d.keys.get(id)
        if (!key) throw new TranslateError(stateError(id, 'nokey'))
        return await askApi(PROVIDERS[id] as ApiProvider, key, system, prompt, signal, onText, this.d.idleMs, this.d.env)
      }
      return await this.askCli(id, system, prompt, signal, onText)
    } finally {
      this.running.set(id, (this.running.get(id) ?? 1) - 1)
      this.waiting.get(id)?.shift()?.()
    }
  }

  /** 命令行：一分钟一个字都没吐就停下，报「等了 60 秒没回应」 */
  private async askCli(id: Exclude<TrEngineId, 'deepseek' | 'zhipu'>, system: string, prompt: string, signal: AbortSignal, onText: (d: string) => void): Promise<string> {
    const idleMs = this.d.idleMs ?? CLI_IDLE_MS
    const ac = new AbortController()
    const stop = () => ac.abort()
    signal.addEventListener('abort', stop)
    let timedOut = false
    let idle: NodeJS.Timeout | undefined
    const poke = () => {
      clearTimeout(idle)
      idle = setTimeout(() => {
        timedOut = true
        ac.abort()
      }, idleMs)
    }
    poke()
    try {
      // 只用这一家（设置 › AI「翻译」那一行选了模型、想多久）：照选的问；按顺序时各家用自己翻译用的那个
      const s = this.d.settings()
      const pick = s.engineMode === 'pick' && s.pick === id && (s.pickModel || s.pickEffort) ? { ...(s.pickModel ? { model: s.pickModel } : {}), ...(s.pickEffort ? { effort: s.pickEffort } : {}) } : undefined
      return await this.d.cli.ask(id, system, prompt, ac.signal, (d) => (poke(), onText(d)), pick)
    } catch (e) {
      if (timedOut && !signal.aborted) throw new TranslateError({ code: 'timeout', engine: id, raw: `${engineMeta(id).name} 等了 ${Math.round(idleMs / 1000)} 秒没回应` })
      throw e
    } finally {
      clearTimeout(idle)
      signal.removeEventListener('abort', stop)
    }
  }

  /** 设置页、菜单底下的「用 Claude Code · Haiku 翻」 */
  label(id: TrEngineId): string {
    return id === 'claude' ? 'Claude Code · Haiku' : isApi(id) ? `${engineMeta(id).name} API` : engineMeta(id).name
  }
}

/** 一个都不能用时的那句：「Claude Code、Codex、OpenCode 没装，Gemini 没登录，API 都没填 Key」 */
export function noneReason(list: Pick<EngineStatus, 'id' | 'name' | 'kind' | 'state'>[]): string {
  const by = new Map<EngineState, string[]>()
  for (const e of list) {
    if (e.state === 'ok') continue
    const name = e.name.replace(/ CLI$/, '')
    by.set(e.state, [...(by.get(e.state) ?? []), name])
  }
  const parts: string[] = []
  const api = list.filter((e) => e.kind === 'api')
  for (const [st, names] of by) {
    if (st === 'nokey' && api.length && names.length === api.length) {
      parts.push('API都没填Key')
      continue
    }
    const word = st === 'missing' ? '没装' : st === 'login' ? '没登录' : st === 'nokey' ? '没填Key' : st === 'badkey' ? 'Key不对' : st === 'nobalance' ? '余额不够' : '模型不对'
    parts.push(`${names.join('、')}${/^[A-Za-z]/.test(word) ? ' ' : ''}${word}`)
  }
  return parts.join('，') || '没有能用的翻译引擎'
}
