/**
 * 双语翻译（我们自己的「沉浸式翻译」）主进程这半：网页预加载把看得见的段落一批批发来，
 * 这里查缓存、问 AI（Claude Code 的 Haiku，见 agent/index.ts 的 askFast），翻好一段就发回那个网页一段。
 * 网页那半在 preload/plugins/translate.ts，界面那半在 renderer/plugins/translate/。
 */
import { join } from 'node:path'
import { LANGS, normalizeTranslate, TRANSLATE, type TranslateSettings } from '../../../shared/plugins/translate'
import type { MainPlugin } from '../host'
import { type Item, TranslationCache, Translator } from './translator'

const MAX_ITEMS = 60
const MAX_TEXT = 6000

function checkTarget(t: unknown): string {
  if (typeof t !== 'string' || !LANGS.some((l) => l.code === t)) throw new Error('目标语言不对')
  return t
}

function checkItems(raw: unknown): Item[] {
  if (!Array.isArray(raw) || raw.length > MAX_ITEMS) throw new Error('段落参数不对')
  return raw.map((x: { id?: unknown; text?: unknown }) => {
    if (typeof x?.id !== 'number' || typeof x.text !== 'string' || !x.text.trim()) throw new Error('段落参数不对')
    return { id: x.id, text: x.text.slice(0, MAX_TEXT) }
  })
}

export const translatePlugin: MainPlugin<TranslateSettings> = {
  manifest: TRANSLATE,
  normalizeSettings: normalizeTranslate,
  setup(host) {
    const cache = new TranslationCache(join(host.dir, 'cache.json'))
    const tr = new Translator((s, p, signal, onText) => host.ai(s, p, signal, onText), cache)
    host.onQuit(() => cache.flush())
    /** 每个网页正在翻的批次：恢复原文、网页关掉时停下，不白花 AI */
    const live = new Map<number, Set<AbortController>>()
    const stop = (wcId: number) => {
      for (const ac of live.get(wcId) ?? []) ac.abort()
      live.delete(wcId)
    }

    host.handle(
      'translate',
      async ({ sender }, arg) => {
        const { items, target } = (arg ?? {}) as { items?: unknown; target?: unknown }
        const list = checkItems(items)
        const to = checkTarget(target)
        const ac = new AbortController()
        if (!live.has(sender.id)) {
          live.set(sender.id, new Set())
          sender.once('destroyed', () => stop(sender.id))
        }
        live.get(sender.id)!.add(ac)
        try {
          await tr.translate(list, to, (id, text, error) => host.emitToPage(sender, 'result', { id, text, ...(error ? { error } : {}) }), ac.signal)
        } finally {
          live.get(sender.id)?.delete(ac)
        }
      },
      { page: true },
    )
    host.handle('cancel', ({ sender }) => stop(sender.id), { page: true })

    // 选中一段翻：整段一次给回去
    host.handle(
      'selection',
      async (_ctx, arg) => {
        const { text, target } = (arg ?? {}) as { text?: unknown; target?: unknown }
        if (typeof text !== 'string' || !text.trim()) throw new Error('没有选中文字')
        const to = checkTarget(target)
        let out: string | null = null
        let err = '没翻成'
        await tr.translate([{ id: 1, text: text.trim().slice(0, MAX_TEXT) }], to, (_id, t, e) => ((out = t), e && (err = e)), new AbortController().signal)
        if (out === null) throw new Error(err)
        return out
      },
      { page: true },
    )

    host.handle('stats', () => ({ ...tr.stats, cached: cache.size }))
    host.handle('engine', () => host.aiLabel())
    host.handle('clearCache', () => cache.clear())
  },
}
