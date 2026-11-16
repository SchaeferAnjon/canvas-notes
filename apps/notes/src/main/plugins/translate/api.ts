/**
 * 翻译用的 API（只给翻译用，AI 对话框还是只用本机命令行）：OpenAI 兼容的 POST {base}/chat/completions，
 * Authorization: Bearer <Key>，stream: true，SSE 每行「data: {chunk}」，文字在 choices[0].delta.content，最后「data: [DONE]」。
 * DeepSeek 照官方文档（api-docs.deepseek.com，2026-11 查过）：base https://api.deepseek.com，模型 deepseek-flash，
 * 不要思考过程（thinking: {type: 'disabled'}）；错误码 401 Key 不对、402 余额不够、429 太快。
 * 智谱照官方文档（docs.bigmodel.cn）：base https://open.bigmodel.cn/api/paas/v4，余额不够也回 429（code 1113），按原话认。
 * 不碰 Electron，能单独测（测试用本机假的 OpenAI 兼容服务，CN_TR_API_BASE_<ID> 换地址）。
 */
import type { TrEngineId } from '../../../shared/plugins/translate'
import { classify, TranslateError } from './errors'

export interface ApiProvider {
  id: Extract<TrEngineId, 'deepseek' | 'zhipu'>
  name: string
  baseUrl: string
  model: string
  /** 同时最多几次请求 */
  concurrency: number
  /** 请求体里另加的（关掉思考过程，翻译要快） */
  extra: Record<string, unknown>
}

export const PROVIDERS: Record<ApiProvider['id'], ApiProvider> = {
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    concurrency: 4,
    extra: { thinking: { type: 'disabled' } },
  },
  zhipu: {
    id: 'zhipu',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-5.3-flash',
    concurrency: 2,
    extra: { reasoning_effort: 'none' },
  },
}

export const isApi = (id: TrEngineId): id is ApiProvider['id'] => id === 'deepseek' || id === 'zhipu'

/** 测试换地址：CN_TR_API_BASE_DEEPSEEK=http://127.0.0.1:端口 */
export function baseUrlOf(p: ApiProvider, env: NodeJS.ProcessEnv = process.env): string {
  return (env[`CN_TR_API_BASE_${p.id.toUpperCase()}`] || p.baseUrl).replace(/\/+$/, '')
}

/** 多久一个字都没来算没回应 */
export const IDLE_MS = 60_000

/** 回答里的错误：{"error":{"message":"…","code":"1113"}} 或者纯文字 */
function errorText(body: string): string {
  try {
    const o = JSON.parse(body) as { error?: { message?: string; code?: string | number } | string; message?: string }
    if (typeof o.error === 'string') return o.error
    if (o.error?.message) return `${o.error.message}${o.error.code ? `（${o.error.code}）` : ''}`
    if (o.message) return o.message
  } catch {
    // 不是 JSON：原样
  }
  return body.slice(0, 300)
}

/**
 * 问一次（流式）：onText 边收边给，返回整段。出错抛 TranslateError（已认好种类）。
 * idleMs 内一个字都没来就停下报「等了 N 秒没回应」。
 */
export async function askApi(
  p: ApiProvider,
  key: string,
  system: string,
  prompt: string,
  signal: AbortSignal,
  onText: (delta: string) => void,
  idleMs = IDLE_MS,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const ac = new AbortController()
  let timedOut = false
  let idle: NodeJS.Timeout | undefined
  const poke = () => {
    clearTimeout(idle)
    idle = setTimeout(() => {
      timedOut = true
      ac.abort()
    }, idleMs)
  }
  const stop = () => ac.abort()
  signal.addEventListener('abort', stop)
  poke()
  const fail = (raw: string, status?: number) => new TranslateError(classify(raw, p.id, status))
  try {
    let res: Response
    try {
      res = await fetch(`${baseUrlOf(p, env)}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream', authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: p.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ],
          stream: true,
          temperature: 0.3,
          ...p.extra,
        }),
        signal: ac.signal,
      })
    } catch (e) {
      if (signal.aborted) throw e
      if (timedOut) throw fail(`${p.name} 等了 ${Math.round(idleMs / 1000)} 秒没回应`)
      const err = e as Error & { cause?: { code?: string; message?: string } }
      throw fail(`${err.message}${err.cause?.code ? `（${err.cause.code}）` : err.cause?.message ? `（${err.cause.message}）` : ''}`)
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw fail(`${p.name} 回了 ${res.status}：${errorText(body)}`, res.status)
    }
    if (!res.body) throw fail(`${p.name} 没有回答`)
    let text = ''
    let buf = ''
    const dec = new TextDecoder()
    const reader = res.body.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        poke()
        buf += dec.decode(value, { stream: true })
        let nl: number
        while ((nl = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, nl).trim()
          buf = buf.slice(nl + 1)
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trim()
          if (data === '[DONE]') return text
          let chunk: { choices?: { delta?: { content?: string | null } }[]; error?: unknown }
          try {
            chunk = JSON.parse(data)
          } catch {
            continue
          }
          if (chunk.error) throw fail(`${p.name}：${errorText(data)}`)
          const d = chunk.choices?.[0]?.delta?.content
          if (d) {
            text += d
            onText(d)
          }
        }
      }
    } catch (e) {
      if (e instanceof TranslateError || signal.aborted) throw e
      if (timedOut) throw fail(`${p.name} 等了 ${Math.round(idleMs / 1000)} 秒没回应`)
      throw fail(`${p.name} 中途断了：${(e as Error).message}`)
    }
    if (timedOut) throw fail(`${p.name} 等了 ${Math.round(idleMs / 1000)} 秒没回应`)
    return text
  } finally {
    clearTimeout(idle)
    signal.removeEventListener('abort', stop)
  }
}
