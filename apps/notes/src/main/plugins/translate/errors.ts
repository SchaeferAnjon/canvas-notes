/**
 * 没翻成的原因：命令行、API 报的原话认成 11 种之一（spec 3.1），界面按种类给原因和办法。
 * 不碰 Electron，能单独测。
 */
import { aiErrorCode } from '../../../shared/ai-errors'
import type { TrEngineId, TrError, TrErrorCode } from '../../../shared/plugins/translate'

/** 带原因的错误：引擎、路由、翻译器之间往外抛这个 */
export class TranslateError extends Error {
  constructor(readonly info: TrError) {
    super(info.raw)
  }
}

/** 这几种是「这个引擎现在用不了」：自动模式下换下一个，不打扰人 */
export const SWITCHABLE: TrErrorCode[] = ['not-installed', 'not-logged-in', 'bad-model', 'bad-key', 'no-key', 'no-balance', 'incompatible']

/**
 * 认原话（和 AI 对话、边读边问共用 shared/ai-errors.ts 那一套）。status 是 API 回的 HTTP 状态码（命令行没有）。
 * 被安全检查拦下在翻译里没有单独的说法，算 other。
 */
export function classify(raw: string, engine?: TrEngineId, status?: number): TrError {
  const s = raw.trim() || '没翻成'
  const c = aiErrorCode(s, status)
  const code: TrErrorCode = c === 'blocked' ? 'other' : c === 'broken' ? 'not-installed' : c
  return { code, ...(engine ? { engine } : {}), raw: s }
}

/** 抛出来的东西换成 TrError（已经认过的原样给） */
export function toTrError(e: unknown, engine?: TrEngineId): TrError {
  if (e instanceof TranslateError) return e.info
  return classify(String((e as Error)?.message ?? e), engine)
}
