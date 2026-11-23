/**
 * 在读 PDF、看视频的那一格里打了整个库的命令（整理收件箱、现在梦游、找重复、剪藏这一页、写这周的周记，task-9womr）：
 * AI 那一格换到收件箱或首页那段对话（「这是在…问的 · 回到…」），在那里跑；这里记着要跑哪一句，那段对话的 AiPanel 一挂上就拿走跑。
 */
import { t } from '../../shared/i18n'
import { INBOX } from '../../shared/layout'

let pending: { key: string; text: string } | null = null
const subs = new Set<() => void>()

export function runIn(key: string, text: string) {
  pending = { key, text }
  for (const s of subs) s()
}

/** 这个地方有要跑的一句：拿走（只跑一次） */
export function takeRun(key: string): string | null {
  if (pending?.key !== key) return null
  const t = pending.text
  pending = null
  return t
}

export function onRunIn(f: () => void): () => void {
  subs.add(f)
  return () => {
    subs.delete(f)
  }
}

/** 整个库的命令在哪段对话里跑：收件箱的两条在收件箱，别的在首页 */
// 不翻：比的是命令名（BUILTINS 的身份）；收件箱那段对话的名字是磁盘上的文件夹名（和 ai-place.ts 的 placeOf 一样）
export const libPlace = (name: string): { key: string; label: string } => (name === '整理收件箱' || name === '现在梦游' ? { key: 'inbox', label: INBOX } : { key: 'home', label: t('首页') })
