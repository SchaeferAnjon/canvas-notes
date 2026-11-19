/**
 * 设置 › AI（CN-44 方向 A）：上面「默认」一家一个模型；下面每个功能各自「跟默认」或指定某家某模型。
 * 主进程按这里选的跑，界面上「哪个模型做的」（CN-54）也从这里取名字。不碰 Electron，能单独测。
 * 翻译另有自己的一串顺序（设置 › 插件 › 双语翻译），不在这里存。
 */
import type { EngineId, EngineInfo } from './agent'

/** 跟着这里走的功能：AI 对话（浮窗、边读边问、/ 命令）、梦游（整理、周记、可视化）、看图问（视频框一块问、拍导图）、小活（视频摘要、起名、插件快问） */
export type AiFeature = 'chat' | 'dream' | 'vision' | 'quick'
export const FEATURES: AiFeature[] = ['chat', 'dream', 'vision', 'quick']

export interface AiPick {
  engine: EngineId
  /** 模型：Claude Code 的 --model；Codex 的 turn/start model（不给是 Codex 自己的默认模型）；Gemini、OpenCode 用它自己的默认模型，不留 */
  model?: string
  /** 想多久（CN-91）：Claude Code 的 --effort、Codex 的 turn/start effort；不给是 High（DEFAULT_EFFORT）；Gemini、OpenCode 没有 */
  effort?: string
}

/** effort 菜单里的一档：id 是命令行认的 */
export interface EffortOption {
  id: string
  label: string
  /** 菜单里的旁注 */
  note?: string
}

/** Claude Code 的 --effort（claude 2.1.323 的 --help 核过：low、medium、high、xhigh、max）；讲解默认 High */
export const CLAUDE_EFFORTS: EffortOption[] = [
  { id: 'low', label: 'Low', note: '最快，小追问够用' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High', note: '讲解默认' },
  { id: 'xhigh', label: 'Extra high', note: '想得更久' },
  { id: 'max', label: 'Max', note: '最慢、最贵' },
]
export const DEFAULT_EFFORT = 'high'

/** Codex 那几档（app-server model/list 的 supportedReasoningEfforts）：名字、旁注和 Claude Code 的同一套；它自己的说明是英文，不用 */
const EFFORT_EXTRA: EffortOption[] = [
  { id: 'none', label: 'None' },
  { id: 'minimal', label: 'Minimal' },
  { id: 'ultra', label: 'Ultra', note: '最慢，会自己分派子任务' },
]
export function effortOption(id: string): EffortOption {
  return CLAUDE_EFFORTS.find((e) => e.id === id) ?? EFFORT_EXTRA.find((e) => e.id === id) ?? { id, label: id.charAt(0).toUpperCase() + id.slice(1) }
}
/** 拿不到 Codex 模型列表时给它的几档（哪个模型都认） */
const CODEX_EFFORTS = ['low', 'medium', 'high'].map(effortOption)

/** 能选 effort 的两家 */
export const hasEffort = (e: EngineId) => e === 'claude' || e === 'codex'

/** 输入框底行模型菜单里的一项：id 是命令行认的；空串是这家自己的默认模型（不传 --model） */
export interface ModelOption {
  id: string
  label: string
  /** 这个模型能选的 effort（Gemini、OpenCode 是空的） */
  efforts: EffortOption[]
  /** 这个模型自己的默认档（Codex 的 model/list 给的） */
  defaultEffort?: string
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

/**
 * 每家能选的模型（CN-91），第一项是这家的默认：Claude Code 三个模型、各五档 effort；
 * Codex 第一项「Codex 默认模型」（不传 model，用它自己设置里的），后面是主进程问 app-server model/list 拿到的（拿不到就只有这一项）；
 * Gemini、OpenCode 只有它自己的默认模型、没有 effort
 */
export function modelsOf(engine: EngineId, codex: ModelOption[] = []): ModelOption[] {
  if (engine === 'claude') return CLAUDE_MODELS.map((m) => ({ ...m, efforts: CLAUDE_EFFORTS }))
  if (engine !== 'codex') return [{ id: '', label: `${ENGINE_LABEL[engine]} 默认模型`, efforts: [] }]
  const def = codex[0]
  return [{ id: '', label: 'Codex 默认模型', efforts: def?.efforts ?? CODEX_EFFORTS, ...(def?.defaultEffort ? { defaultEffort: def.defaultEffort } : {}) }, ...codex]
}

/**
 * 这一问真正用的模型和那一档（CN-91）：没给模型用这家的默认；给的那一档这个模型不认，就用它自己的默认档，再不认用 High，再不认用第一档；
 * Gemini、OpenCode 没有模型和 effort，只有哪家。主进程（effectivePick）和输入框底行（convPick）用同一套
 */
export function fitPick(engine: EngineId, models: ModelOption[], want: { model?: string; effort?: string }): AiPick {
  if (!hasEffort(engine)) return { engine }
  let model = want.model ?? ''
  if (engine === 'claude') model ||= CLAUDE_DEFAULT
  const option = models.find((m) => m.id === model)
  const efforts = option?.efforts ?? (engine === 'claude' ? CLAUDE_EFFORTS : [])
  let effort = want.effort ?? DEFAULT_EFFORT
  if (efforts.length && !efforts.some((e) => e.id === effort)) {
    const fallback = [option?.defaultEffort, DEFAULT_EFFORT].find((x) => x && efforts.some((e) => e.id === x))
    effort = fallback ?? efforts[0]!.id
  }
  return { engine, ...(model ? { model } : {}), effort }
}

/**
 * 一个对话这一问用的（CN-91 方向 C）：哪家跟设置 › AI「AI 对话」那一行（chat，ai:engines 给的）；
 * 这个对话自己选过这一家的模型、effort（own，记在这个对话里）就用自己的，没选过、选的是别家的用那一行的
 */
export function convPick(engines: EngineInfo[], chat: AiPick, own?: AiPick | null): AiPick {
  const id = chat.engine
  const models = engines.find((e) => e.id === id)?.models ?? modelsOf(id)
  const mine = own && own.engine === id ? own : null
  return fitPick(id, models, { model: mine?.model ?? chat.model, effort: mine?.effort ?? chat.effort })
}

/** 从没设过时：都跟默认，只有小活用 Claude Code 的 Haiku（快、便宜，一次问很多遍） */
export const INITIAL_PREFS: AiPrefs = { default: { engine: 'claude', model: CLAUDE_DEFAULT }, features: { quick: { engine: 'claude', model: 'haiku' } } }

const ENGINES: EngineId[] = ['claude', 'codex', 'gemini', 'opencode']
const isEngine = (x: unknown): x is EngineId => typeof x === 'string' && (ENGINES as string[]).includes(x)

/** 存的东西读回来：不认识的丢掉；模型给 Claude Code、Codex 留，effort 只留这家认的（旧设置没有 effort，读成不设 = High） */
export function normalizePick(x: unknown): AiPick | null {
  if (!x || typeof x !== 'object') return null
  const o = x as { engine?: unknown; model?: unknown; effort?: unknown }
  if (!isEngine(o.engine)) return null
  if (!hasEffort(o.engine)) return { engine: o.engine }
  const model = typeof o.model === 'string' && o.model.trim() ? o.model.trim() : undefined
  const effort = typeof o.effort === 'string' && /^[a-z]{1,20}$/.test(o.effort) && (o.engine === 'codex' || CLAUDE_EFFORTS.some((e) => e.id === o.effort)) ? o.effort : undefined
  if (o.engine === 'codex') return { engine: 'codex', ...(model ? { model } : {}), ...(effort ? { effort } : {}) }
  return { engine: 'claude', model: model ?? CLAUDE_DEFAULT, ...(effort ? { effort } : {}) }
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

/**
 * 回答头上、设置里写的「Claude Code · Opus 5.5」，带了 effort 再加一截「· High」（CN-91）；
 * Codex 选了模型写模型名（models 是 EngineInfo.models，拿名字用），用它自己默认模型的不写；Gemini、OpenCode 只写名字
 */
export function pickLabel(p: AiPick, models: { id: string; label: string }[] = []): string {
  const parts = [ENGINE_LABEL[p.engine]]
  if (p.engine === 'claude') parts.push(CLAUDE_MODELS.find((x) => x.id === p.model)?.label ?? p.model ?? 'Opus 5.5')
  else if (p.engine === 'codex' && p.model) parts.push(models.find((x) => x.id === p.model)?.label ?? p.model)
  if (p.effort && hasEffort(p.engine)) parts.push(effortOption(p.effort).label)
  return parts.join(' · ')
}

/** 「Claude Code · Opus 5.5」是哪家（放它的标志） */
export function engineOfLabel(label: string): EngineId | null {
  const name = label.split(' · ')[0]
  return (Object.entries(ENGINE_LABEL).find(([, v]) => v === name)?.[0] as EngineId | undefined) ?? null
}

export const samePick = (a: AiPick | undefined, b: AiPick | undefined) => !!a && !!b && a.engine === b.engine && (a.engine !== 'claude' || a.model === b.model)
