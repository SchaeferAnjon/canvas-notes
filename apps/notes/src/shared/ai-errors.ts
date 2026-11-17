/**
 * AI 没答出来时的原话认成几种原因（CN-75）：AI 对话、边读边问、视频框一块问、拍导图、翻译共用。
 * 界面只给一句中文和能点的下一步，英文原话收在「看原话 ›」里。不碰 Electron，能单独测。
 */

export type AiErrorCode =
  | 'blocked'
  | 'not-installed'
  | 'not-logged-in'
  | 'bad-model'
  | 'bad-key'
  | 'no-balance'
  | 'rate-limit'
  | 'network'
  | 'timeout'
  | 'exited'
  | 'bad-output'
  | 'other'

/**
 * 认原话。status 是 API 回的 HTTP 状态码（命令行没有）。
 * 先认 API 的状态码，再按原话里的字认；都不像的是 other。
 */
export function aiErrorCode(raw: string, status?: number): AiErrorCode {
  const s = raw.trim()
  // 被安全检查拦下：Claude 的 safeguards / flagged / 使用政策（aup）；先认它，原话里也带 API Error
  if (/safeguards?|flagged|\/aup\b|acceptable use|usage polic|content.?filter|安全检查/i.test(s)) return 'blocked'
  if (/等了 \d+ 秒没回应|timed? ?out|ETIMEDOUT/i.test(s)) return 'timeout'
  if (status === 402 || /insufficient|余额不足|余额不够|\b1113\b|balance/i.test(s)) return 'no-balance'
  if (status === 401 || status === 403) return 'bad-key'
  if (status === 429 || /rate.?limit|too many requests|请求过于频繁|overloaded/i.test(s)) return 'rate-limit'
  if (/没找到 \S+ 命令|command not found|启动不了：.*ENOENT/i.test(s)) return 'not-installed'
  if (/unrecognized_model|issue with the selected model|model[^.\n]{0,40}(not found|does not exist|not available|not supported)|invalid model|模型不存在/i.test(s)) return 'bad-model'
  if (/没登录|not logged in|log ?in|\/login|auth|credential|unauthori[sz]ed|\b401\b|api key/i.test(s)) return 'not-logged-in'
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ECONNABORTED|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|fetch failed|socket hang up|network|中途断了/i.test(s)) return 'network'
  if (/格式不对|漏了 \d+ 段/.test(s)) return 'bad-output'
  if (/退出了|没答完|没做完|没有回答|exited|killed|AI 进程已经退出|软件关了/.test(s)) return 'exited'
  return 'other'
}

/** 出错时能点的下一步 */
export type AiErrorAct = 'retry' | 'rephrase' | 'settings'

export interface AiErrorView {
  code: AiErrorCode
  /** 一行中文说明 */
  title: string
  acts: AiErrorAct[]
  /** 原话和说明不一样（英文、带编号），收在「看原话 ›」里 */
  raw: string | null
}

/** 引擎的登录命令（没登录时告诉人在终端里跑什么） */
const LOGIN: Record<string, string> = { claude: 'claude', codex: 'codex login', gemini: 'gemini', opencode: 'opencode auth login' }
const VENDOR: Record<string, string> = { claude: 'Claude', codex: 'OpenAI', gemini: 'Gemini', opencode: 'OpenCode' }

/** 我们自己写的中文短话（「先打开一块白板」「没答完（软件关了）」）原样显示，不用再收起原话 */
const ownWords = (s: string) => s.length <= 60 && !/[A-Za-z]{4,}/.test(s.replace(/Claude Code|Codex|Gemini|OpenCode|PDF|HTML|Git|Haiku|Opus|Sonnet/g, ''))

/** 原话 → 界面上那一行、下一步、收起来的原话 */
export function aiErrorView(raw: string, engine?: { id?: string; label?: string }): AiErrorView {
  const s = raw.trim() || '没答出来'
  const code = aiErrorCode(s)
  const name = engine?.label ?? 'AI'
  const vendor = (engine?.id && VENDOR[engine.id]) || name
  const keep = ownWords(s) ? null : s
  switch (code) {
    case 'blocked':
      return { code, title: `被${vendor}的安全检查拦下了，常是误拦`, acts: ['retry', 'rephrase'], raw: keep }
    case 'not-logged-in':
      return { code, title: `${name}还没登录：在终端里运行${(engine?.id && LOGIN[engine.id]) || 'claude'}登录一下`, acts: ['retry'], raw: keep }
    case 'network':
      return { code, title: '网络断了，没问成', acts: ['retry'], raw: keep }
    case 'bad-model':
      return { code, title: `${name}用不了设置的模型：去设置 › AI换一个`, acts: ['settings'], raw: keep }
    case 'timeout':
      return { code, title: `${name}等太久没回应`, acts: ['retry'], raw: keep }
    case 'not-installed':
      return { code, title: `这台Mac上没装${name}：去设置 › AI换一个`, acts: ['settings'], raw: keep }
    case 'bad-key':
      return { code, title: `${name}的Key不对：去设置 › AI换一个`, acts: ['settings'], raw: keep }
    case 'no-balance':
      return { code, title: `${name}余额不够`, acts: ['settings'], raw: keep }
    case 'rate-limit':
      return { code, title: `问得太快，${name}让等一会儿`, acts: ['retry'], raw: keep }
    case 'exited':
      return { code, title: keep ? `${name}中途退出了，没答完` : s, acts: ['retry'], raw: keep }
    case 'bad-output':
      return { code, title: `${name}给的格式不对`, acts: ['retry'], raw: keep }
    default:
      return { code, title: keep ? `${name}没答出来` : s, acts: keep ? ['retry'] : [], raw: keep }
  }
}
