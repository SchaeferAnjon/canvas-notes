/**
 * 界面里别的地方（网页阅读视图的对照读、右键「翻译这段」）用的翻译：给一串块，翻好一块回一块。和网页翻译同一个缓存、同一套引擎设置和课程术语表。
 *
 *   const job = translateBlocks([{ id: 'p3-1', text: '…' }], { target: 'zh-CN' }, (r) => …)
 *   await job.done      // 全部回来（或者停下）后
 *   job.cancel()        // 不要了：主进程停下还没问的批
 *
 * r.text 是译文；没翻成时是 null，r.error 里是原因（errorTitle(r.error) 给一句人话）。
 */
import type { TrError } from '../../../shared/plugins/translate'
import { ID } from './shared'

export interface BlockResult {
  id: string
  text: string | null
  error?: TrError
}

let seq = 0

export function translateBlocks(
  blocks: { id: string; text: string }[],
  opts: { target?: string; course?: string | null; fresh?: boolean },
  onResult: (r: BlockResult) => void,
): { done: Promise<void>; cancel(): void } {
  const req = ++seq + Math.random()
  let stopped = false
  // 主进程一块块发回来的译文和「全部翻完」走两条路，可能比「翻完」晚到：等到每块都回来（最多再等 2 秒）再停止收听
  const left = new Set(blocks.filter((b) => b.text.trim()).map((b) => b.id))
  let drained: (() => void) | null = null
  const off = window.cnPlugins.on(ID, 'blocks', (p) => {
    const r = p as BlockResult & { req: number }
    if (stopped || r.req !== req) return
    left.delete(r.id)
    onResult({ id: r.id, text: r.text, ...(r.error ? { error: r.error } : {}) })
    if (!left.size) drained?.()
  })
  const done = window.cnPlugins
    .call<void>(ID, 'blocks', { req, blocks, ...opts })
    .then(() => {
      if (!left.size || stopped) return
      return new Promise<void>((res) => {
        const t = setTimeout(res, 2000)
        drained = () => (clearTimeout(t), res())
      })
    })
    .finally(off)
  return {
    done,
    cancel() {
      stopped = true
      void window.cnPlugins.call(ID, 'blocksCancel', req)
    },
  }
}
