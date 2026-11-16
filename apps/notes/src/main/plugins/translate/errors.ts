/**
 * 没翻成的原因：命令行、API 报的原话认成 11 种之一（spec 3.1），界面按种类给原因和办法。
 * 不碰 Electron，能单独测。
 */
import type { TrEngineId, TrError, TrErrorCode } from '../../../shared/plugins/translate'

/** 带原因的错误：引擎、路由、翻译器之间往外抛这个 */
export class TranslateError extends Error {
  constructor(readonly info: TrError) {
    super(info.raw)
  }
}

/** 这几种是「这个引擎现在用不了」：自动模式下换下一个，不打扰人 */
export const SWITCHABLE: TrErrorCode[] = ['not-installed', 'not-logged-in', 'bad-model', 'bad-key', 'no-key', 'no-balance']

/**
 * 认原话。status 是 API 回的 HTTP 状态码（命令行没有）。
 * 先认 API 的状态码，再按原话里的字认；都不像的是 other。
 */
export function classify(raw: string, engine?: TrEngineId, status?: number): TrError {
  const s = raw.trim() || '没翻成'
  const code = ((): TrErrorCode => {
    if (/等了 \d+ 秒没回应/.test(s)) return 'timeout'
    if (status === 402 || /insufficient|余额不足|余额不够|\b1113\b|balance/i.test(s)) return 'no-balance'
    if (status === 401 || status === 403) return 'bad-key'
    if (status === 429 || /rate.?limit|too many requests|请求过于频繁/i.test(s)) return 'rate-limit'
    if (/没找到 \S+ 命令|command not found|启动不了：.*ENOENT/i.test(s)) return 'not-installed'
    if (/unrecognized_model|issue with the selected model|model[^.\n]{0,40}(not found|does not exist|not available|not supported)|invalid model|模型不存在/i.test(s)) return 'bad-model'
    if (/没登录|not logged in|log ?in|\/login|auth|credential|unauthori[sz]ed|\b401\b|api key/i.test(s)) return 'not-logged-in'
    if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ECONNABORTED|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|fetch failed|socket hang up|network|中途断了/i.test(s)) return 'network'
    if (/格式不对|漏了 \d+ 段/.test(s)) return 'bad-output'
    if (/退出了|没答完|没有回答|exited|killed|AI 进程已经退出/.test(s)) return 'exited'
    return 'other'
  })()
  return { code, ...(engine ? { engine } : {}), raw: s }
}

/** 抛出来的东西换成 TrError（已经认过的原样给） */
export function toTrError(e: unknown, engine?: TrEngineId): TrError {
  if (e instanceof TranslateError) return e.info
  return classify(String((e as Error)?.message ?? e), engine)
}
