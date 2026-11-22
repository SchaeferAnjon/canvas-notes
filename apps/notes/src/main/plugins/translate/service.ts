/**
 * 翻译服务：网页、网页阅读视图、视频字幕、右键翻译这段都用这一个。给一串块（标题、段落、列表项…），按设置挑引擎，
 * 翻好一块回一块（缓存里有的马上回）。不碰 Electron，能单独测。
 *
 * 主进程里（视频字幕）这样用：
 *   const tr = translateService()
 *   await tr?.translateBlocks([{ id: 'p1-3', text: '…' }], { target: 'zh-CN' }, (r) => …, signal)
 * 界面那边用 renderer/plugins/translate/api.ts 的 translateBlocks（同一件事走 ipc）。
 */
import { isTargetLang, type TrError } from '../../../shared/plugins/translate'
import type { EngineRouter } from './router'
import type { Translator } from './translator'

export interface Block {
  id: string
  text: string
}

export interface BlockResult {
  id: string
  /** 译文；没翻成是 null，原因在 error */
  text: string | null
  error?: TrError
}

export interface BlockOptions {
  /** 翻成什么（不给用设置里的） */
  target?: string
  /** 重新翻译：不用缓存里的 */
  fresh?: boolean
}

const MAX_BATCH_ITEMS = 12
const MAX_BATCH_CHARS = 1200

/** 按顺序切成一批批：一批最多 12 块、1200 字（一块太长的自己一批） */
export function batches<T extends { text: string }>(list: T[], maxItems = MAX_BATCH_ITEMS, maxChars = MAX_BATCH_CHARS): T[][] {
  const out: T[][] = []
  let cur: T[] = []
  let chars = 0
  for (const it of list) {
    if (cur.length && (cur.length >= maxItems || chars + it.text.length > maxChars)) {
      out.push(cur)
      cur = []
      chars = 0
    }
    cur.push(it)
    chars += it.text.length
  }
  if (cur.length) out.push(cur)
  return out
}

export class TranslateService {
  constructor(
    readonly translator: Translator,
    readonly router: EngineRouter,
    private defaultTarget: () => string,
    private styleNow: () => string = () => 'plain',
  ) {}

  /** 现在设置里翻成什么（视频字幕跟它走） */
  target(): string {
    return this.defaultTarget()
  }

  /** 现在设置里的译文样式（视频字幕的译文行也用它） */
  style(): string {
    return this.styleNow()
  }


  /** 翻一串块：一批批并发去问（同时几批由翻译器和各引擎的上限管），翻好一块回一块；signal 停下就不再回 */
  async translateBlocks(blocks: Block[], opts: BlockOptions, onResult: (r: BlockResult) => void, signal: AbortSignal): Promise<void> {
    const target = opts.target ?? this.defaultTarget()
    if (!isTargetLang(target)) throw new Error('目标语言不对')
    const ids = new Map<number, string>()
    const items = blocks
      .filter((b) => b.text.trim())
      .map((b, i) => {
        ids.set(i + 1, b.id)
        return { id: i + 1, text: b.text }
      })
    await Promise.all(
      batches(items).map((batch) =>
        this.translator.translate(
          batch,
          target,
          (n, text, error) => {
            if (!signal.aborted) onResult({ id: ids.get(n)!, text, ...(error ? { error } : {}) })
          },
          signal,
          opts.fresh === true,
        ),
      ),
    )
  }
}

let current: TranslateService | null = null

/** 主进程里别的地方（视频字幕）拿翻译服务；双语翻译插件关着时也在（插件开关只管网页里的按钮） */
export const translateService = () => current
export const setTranslateService = (s: TranslateService) => (current = s)
