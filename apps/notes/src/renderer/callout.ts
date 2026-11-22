/**
 * 提示块（callout，写法同 Obsidian）：`> [!question] 我的疑惑`，下面几行 `> 正文`。
 * 文档里（live-preview.ts、fold-block.ts）和白板卡片里（md-render.tsx）都按这里认类型、选图标和颜色（CN-59）。
 * `[!ai]` 是 AI 讲解的回答：`> [!ai] AI 讲解 · Claude Code · Opus 5.5 · 看了第 3 页`，图标画标题里写的那一家的标志（偏好「AI 图标用引擎标志」；
 * 没写哪家画对话图标），右端能收起。
 * `[!type]-` 默认收着、`[!type]+` 默认展开但能收起（同 Obsidian）。
 */
import type { CodiconName } from '@cn/design'
import { isSummaryHead } from '@cn/format'
import type { EngineId } from '../shared/agent'
import { ENGINE_LABEL } from '../shared/ai-features'

export const CALLOUT_HEAD = /^(\s*>\s*)\[!([A-Za-z][\w-]*)\]([+-]?)[ \t]*(.*)$/

export type CalloutTone = 'yellow' | 'green' | 'red' | 'acc' | 't2'

export interface CalloutKind {
  /** 归到的类型（css 类名 cm-callout-<kind>） */
  kind: string
  icon: CodiconName
  tone: CalloutTone
  /** 没写标题时显示的名字 */
  label: string
}

const KINDS: [string[], Omit<CalloutKind, 'kind'> & { kind: string }][] = [
  [['question', 'faq', 'help'], { kind: 'question', icon: 'question', tone: 'yellow', label: '疑惑' }],
  [['success', 'check', 'done'], { kind: 'success', icon: 'pass', tone: 'green', label: '讲通了' }],
  [['note'], { kind: 'note', icon: 'info', tone: 't2', label: '注' }],
  [['info', 'todo', 'abstract', 'summary', 'tldr', 'example', 'tip', 'hint', 'important'], { kind: 'info', icon: 'info', tone: 't2', label: '说明' }],
  [['warning', 'caution', 'attention'], { kind: 'warning', icon: 'warning', tone: 'yellow', label: '注意' }],
  [['danger', 'error', 'failure', 'fail', 'missing', 'bug'], { kind: 'danger', icon: 'error', tone: 'red', label: '出错' }],
  [['quote', 'cite'], { kind: 'quote', icon: 'quote', tone: 't2', label: '引文' }],
  [['ai'], { kind: 'ai', icon: 'comment-discussion', tone: 'acc', label: 'AI 讲解' }],
]

export function calloutKind(type: string): CalloutKind {
  const t = type.toLowerCase()
  for (const [names, k] of KINDS) if (names.includes(t)) return k
  // 不认识的类型按 note 画，标题照写
  return { kind: 'note', icon: 'info', tone: 't2', label: type }
}

export interface CalloutHead extends CalloutKind {
  /** 「> [!question] 」这一截的长度（文档里换成图标） */
  prefix: number
  title: string
  /** 能不能收起；默认收着 */
  foldable: boolean
  folded: boolean
  /** AI 讲解：标题里写着是哪一家做的（画它的标志代替 icon）；别的类型、没写哪家是 null */
  engine: EngineId | null
  /**
   * 「AI 总结」块没写是哪家（以前存的总结卡改过来的，task-5yp97）：不画图标，「AI 总结」和正文左对齐
   * （画对话图标就和旁支、句后的小标是同一个图标，看着像一条旁支）
   */
  bare?: boolean
}

/** 「AI 讲解 · Claude Code · Opus 5.5 · …」里写的是哪一家 */
function engineIn(title: string): EngineId | null {
  const parts = title.split(' · ')
  return (Object.entries(ENGINE_LABEL).find(([, v]) => parts.includes(v))?.[0] as EngineId | undefined) ?? null
}

/** 引用第一行是不是提示块的头 */
export function parseCallout(line: string): CalloutHead | null {
  const m = CALLOUT_HEAD.exec(line)
  if (!m) return null
  const k = calloutKind(m[2]!)
  return {
    ...k,
    prefix: line.length - m[4]!.length,
    title: m[4]!.trim(),
    foldable: m[3] !== '' || k.kind === 'ai',
    folded: m[3] === '-',
    engine: k.kind === 'ai' ? engineIn(m[4]!.trim()) : null,
    ...(k.kind === 'ai' && !engineIn(m[4]!.trim()) && isSummaryHead(m[4]!.trim()) ? { bare: true } : {}),
  }
}
