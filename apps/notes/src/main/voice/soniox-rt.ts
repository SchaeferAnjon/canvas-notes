/**
 * Soniox 实时听写（费曼的语音输入，task-yvabi）：一段话开一条 WebSocket，边送声音边收字。
 * 不依赖 Electron（单元测试直接连本机假服务 e2e/fixtures/fake-soniox-rt.ts）。
 *
 * 照官方文档写（2026-11-23 查 https://docs.soniox.com/stt/api-reference/websocket-api ）：
 * - 地址 wss://stt-rt.soniox.com/transcribe-websocket，密钥放在连接的 Authorization: Bearer 头里（配置里的 api_key 2027-01-15 起不认）。
 * - 第一条发 JSON 配置：model、audio_format=pcm_s16le、sample_rate、num_channels、language_hints；之后二进制帧送声音。
 * - 回的每条有 tokens：is_final 的只发一次、以后不变；没定的每条整段重发、换掉上一条的。<fin>、<end> 是记号，不是字。
 * - 说完发一个空的文字帧，等 {finished:true} 再算完；出错时回 {error_code,error_type,error_message} 然后关连接。
 * - {"type":"ping"} 马上回 pong：连着时每 5 秒问一次，10 秒没听到 Soniox 任何回话就算超时。
 * 模型 stt-rt-v6（docs.soniox.com/stt/models：现役实时模型；v5 2026-12-15 下线）。
 */
import type { DictErrorCode } from '../../shared/voice-api'

export const SONIOX_RT_URL = 'wss://stt-rt.soniox.com/transcribe-websocket'
export const SONIOX_RT_MODEL = 'stt-rt-v6'

export interface RtHandlers {
  /** 新定下的字（接在前面定下的后面）、这会儿还没定的字（整段换掉上一次的） */
  text(final: string, interim: string): void
  /** 出错停了（只报一次，报完连接已经关了） */
  error(code: DictErrorCode, detail: string): void
}

export interface RtOptions {
  url?: string
  key: string
  model?: string
  languageHints?: string[]
  /** 可能说到的词：交给 Soniox 配置里的 context.terms（WebSocket 参考里的 context：general、text、terms） */
  terms?: string[]
  /** 多久连不上算超时 */
  connectMs?: number
  /** 连着时多久问一次 ping */
  pingMs?: number
  /** 多久没听到回话算超时 */
  silentMs?: number
  /** 说完以后等 Soniox 定稿最多等多久 */
  finishMs?: number
}

/** Soniox 的错误码换成界面认的几种（docs.soniox.com 的 WebSocket 参考里列的那几个） */
export function errorCode(status: number): DictErrorCode {
  if (status === 401 || status === 403) return 'auth'
  if (status === 402) return 'quota'
  if (status === 408) return 'timeout'
  if (status === 429) return 'busy'
  return 'server'
}

const MARKS = new Set(['<fin>', '<end>'])
const CJK = /[\p{Script=Han}\u3000-\u303f\uff00-\uffef]/u

/** 接在 before 后面的一段：开头的空格去掉（Soniox 停顿定稿后下一段开头带个空格，中文接中文、一句话开头都不要它） */
export function tidyJoin(before: string, next: string): string {
  if (!next.startsWith(' ')) return next
  const head = next.trimStart().charAt(0)
  if (!before || (CJK.test(before.slice(-1)) && CJK.test(head))) return next.trimStart()
  return next
}

export class SonioxStream {
  private ws: WebSocket
  private queue: ArrayBuffer[] = []
  private state: 'connecting' | 'open' | 'finishing' | 'done' = 'connecting'
  private timers: ReturnType<typeof setTimeout>[] = []
  private ping: ReturnType<typeof setInterval> | null = null
  private heard = Date.now()
  private finished: (() => void) | null = null
  private finishWait: Promise<void> | null = null
  /** 已经定下来的字（接下一段时看最后一个字） */
  private said = ''

  constructor(
    private o: RtOptions,
    private h: RtHandlers,
  ) {
    // Node（undici）的 WebSocket 认第二个参数里的 headers；类型表用的是浏览器那份，没有这一项
    const NodeWebSocket = WebSocket as unknown as new (url: string, init: { headers: Record<string, string> }) => WebSocket
    this.ws = new NodeWebSocket(o.url ?? SONIOX_RT_URL, { headers: { Authorization: `Bearer ${o.key}` } })
    this.ws.binaryType = 'arraybuffer'
    this.timers.push(setTimeout(() => this.state === 'connecting' && this.fail('timeout', `${Math.round((o.connectMs ?? 10_000) / 1000)} 秒没连上 Soniox`), o.connectMs ?? 10_000))
    this.ws.addEventListener('open', () => {
      if (this.state !== 'connecting') return
      this.state = 'open'
      this.heard = Date.now()
      this.ws.send(
        JSON.stringify({
          model: o.model ?? SONIOX_RT_MODEL,
          audio_format: 'pcm_s16le',
          sample_rate: 16000,
          num_channels: 1,
          language_hints: o.languageHints ?? ['zh', 'en'],
          // 停顿处就定稿（灰字变黑）：不开的话 stt-rt-v6 实测一句 6 秒全是灰的，到下一句才定（2026-11-23 真跑）
          enable_endpoint_detection: true,
          ...(o.terms?.length ? { context: { terms: o.terms } } : {}),
        }),
      )
      for (const b of this.queue) this.ws.send(b)
      this.queue = []
      let n = 0
      this.ping = setInterval(() => {
        if (Date.now() - this.heard > (o.silentMs ?? 10_000)) return this.fail('timeout', `${Math.round((o.silentMs ?? 10_000) / 1000)} 秒没听到 Soniox 回话`)
        this.ws.send(JSON.stringify({ type: 'ping', id: ++n }))
      }, o.pingMs ?? 5_000)
    })
    this.ws.addEventListener('message', (ev) => this.onMessage(ev.data))
    this.ws.addEventListener('close', (ev) => {
      if (this.state === 'done') return
      // 没等到 finished 就断了：网络断了，或 Soniox 那边关的
      this.fail('net', `连接断了（${ev.code}${ev.reason ? ' ' + ev.reason : ''}）`)
    })
    // error 之后总会有 close，原因在 close 里报
    this.ws.addEventListener('error', () => {})
  }

  private onMessage(data: unknown) {
    this.heard = Date.now()
    if (typeof data !== 'string') return
    let m: { tokens?: { text: string; is_final: boolean }[]; finished?: boolean; error_code?: number; error_type?: string; error_message?: string; type?: string }
    try {
      m = JSON.parse(data)
    } catch {
      return this.fail('server', `Soniox 回的不是 JSON：${data.slice(0, 80)}`)
    }
    if (m.type === 'pong') return
    if (m.error_code) return this.fail(errorCode(m.error_code), `Soniox ${m.error_code} ${m.error_type ?? ''}：${m.error_message ?? ''}`.trim())
    if (m.tokens) {
      const fin = tidyJoin(this.said, m.tokens.filter((t) => t.is_final && !MARKS.has(t.text)).map((t) => t.text).join(''))
      this.said += fin
      const int = tidyJoin(this.said, m.tokens.filter((t) => !t.is_final && !MARKS.has(t.text)).map((t) => t.text).join(''))
      this.h.text(fin, int)
    }
    if (m.finished) {
      this.end()
      this.finished?.()
    }
  }

  /** 送一段声音（还没连上就先排着） */
  send(pcm: ArrayBuffer) {
    if (this.state === 'connecting') this.queue.push(pcm)
    else if (this.state === 'open') this.ws.send(pcm)
  }

  /** 说完了：发空帧，等 Soniox 把剩下的字定下来；超时报错（已经出来的字界面上留着） */
  finish(): Promise<void> {
    if (this.finishWait) return this.finishWait
    this.finishWait = new Promise<void>((resolve) => {
      if (this.state === 'done') return resolve()
      this.finished = resolve
      const go = () => {
        this.state = 'finishing'
        this.ws.send('')
      }
      if (this.state === 'open') go()
      else {
        // 还没连上就说完了：连上以后把排着的声音送完再发空帧
        this.ws.addEventListener('open', () => this.state === 'open' && go())
      }
      this.timers.push(setTimeout(() => this.fail('timeout', `说完后 ${Math.round((this.o.finishMs ?? 8_000) / 1000)} 秒没等到 Soniox 定稿`), this.o.finishMs ?? 8_000))
    })
    return this.finishWait
  }

  /** 不要了：马上断开，不报错 */
  cancel() {
    this.end()
    this.finished?.()
  }

  private end() {
    if (this.state === 'done') return
    this.state = 'done'
    for (const t of this.timers) clearTimeout(t)
    if (this.ping) clearInterval(this.ping)
    this.ws.close()
  }

  private fail(code: DictErrorCode, detail: string) {
    if (this.state === 'done') return
    this.end()
    this.h.error(code, detail)
    this.finished?.()
  }
}
