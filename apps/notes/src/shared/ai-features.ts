/**
 * 设置 › AI（CN-44 方向 A）：上面「默认」一家一个模型；下面每个功能各自「跟默认」或指定某家某模型。
 * 主进程按这里选的跑，界面上「哪个模型做的」（CN-54）也从这里取名字。不碰 Electron，能单独测。
 * 翻译另有自己的一串顺序（设置 › 插件 › 双语翻译），不在这里存。
 */
import type { EngineId } from './agent'

/** 跟着这里走的功能：AI 对话（浮窗、边读边问、/ 命令）、梦游（整理、周记、可视化）、看图问（视频框一块问、拍导图）、小活（视频摘要、起名、插件快问） */
export type AiFeature = 'chat' | 'dream' | 'vision' | 'quick'
export const FEATURES: AiFeature[] = ['chat', 'dream', 'vision', 'quick']

export interface AiPick {
  engine: EngineId
  /** 只有 Claude Code 能选模型；别家用它自己的默认模型 */
  model?: string
}

export interface AiPrefs {
  default: AiPick
  /** 没写 = 跟默认 */
  features: Partial<Record<AiFeature, AiPick>>
}

export const ENGINE_LABEL: Record<EngineId, string> = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini', opencode: 'OpenCode' }

/** Claude Code 能选的模型：名字是 claude 命令行的 --model 认的 */
export const CLAUDE_MODELS: { id: string; label: string }[] = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5' },
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'haiku', label: 'Haiku' },
]
export const CLAUDE_DEFAULT = 'claude-opus-5-5'

/** 从没设过时：都跟默认，只有小活用 Claude Code 的 Haiku（快、便宜，一次问很多遍） */
export const INITIAL_PREFS: AiPrefs = { default: { engine: 'claude', model: CLAUDE_DEFAULT }, features: { quick: { engine: 'claude', model: 'haiku' } } }

const ENGINES: EngineId[] = ['claude', 'codex', 'gemini', 'opencode']
const isEngine = (x: unknown): x is EngineId => typeof x === 'string' && (ENGINES as string[]).includes(x)

/** 存的东西读回来：不认识的丢掉；模型只给 Claude Code 留 */
export function normalizePick(x: unknown): AiPick | null {
  if (!x || typeof x !== 'object') return null
  const o = x as { engine?: unknown; model?: unknown }
  if (!isEngine(o.engine)) return null
  if (o.engine !== 'claude') return { engine: o.engine }
  const model = typeof o.model === 'string' && o.model.trim() ? o.model.trim() : CLAUDE_DEFAULT
  return { engine: 'claude', model }
}

export function normalizePrefs(x: unknown, legacyEngine?: EngineId): AiPrefs {
  const o = (x && typeof x === 'object' ? x : {}) as { default?: unknown; features?: unknown }
  const def = normalizePick(o.default) ?? (legacyEngine ? normalizePick({ engine: legacyEngine }) : null) ?? INITIAL_PREFS.default
  const features: AiPrefs['features'] = {}
  const f = (o.features && typeof o.features === 'object' ? o.features : o.default === undefined ? INITIAL_PREFS.features : {}) as Record<string, unknown>
  for (const k of FEATURES) {
    const p = normalizePick(f[k])
    if (p) features[k] = p
  }
  return { default: def, features }
}

/** 这个功能真的用哪家哪个模型。看图问只有 Claude Code 能做：默认不是它时用 Claude Code 的默认模型 */
export function resolvePick(p: AiPrefs, feature: AiFeature): AiPick {
  const own = p.features[feature]
  const pick = own ?? p.default
  if (feature === 'vision' && pick.engine !== 'claude') return { engine: 'claude', model: CLAUDE_DEFAULT }
  return pick
}

/** 「Claude Code · Opus 5.5」；别家只写名字（模型用它自己的默认） */
export function pickLabel(p: AiPick): string {
  if (p.engine !== 'claude') return ENGINE_LABEL[p.engine]
  const m = CLAUDE_MODELS.find((x) => x.id === p.model)?.label ?? p.model ?? 'Opus 5.5'
  return `${ENGINE_LABEL.claude} · ${m}`
}

/** 「Claude Code · Opus 5.5」是哪家（放它的标志） */
export function engineOfLabel(label: string): EngineId | null {
  const name = label.split(' · ')[0]
  return (Object.entries(ENGINE_LABEL).find(([, v]) => v === name)?.[0] as EngineId | undefined) ?? null
}

export const samePick = (a: AiPick | undefined, b: AiPick | undefined) => !!a && !!b && a.engine === b.engine && (a.engine !== 'claude' || a.model === b.model)
