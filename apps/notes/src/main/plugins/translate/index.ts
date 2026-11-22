/**
 * 双语翻译（我们自己的「沉浸式翻译」）主进程这半：网页预加载把看得见的段落一批批发来，
 * 这里查缓存、按设置挑引擎问（本机命令行或自己填 Key 的 API，见 router.ts），翻好一段就发回那个网页一段。
 * 网页那半在 preload/plugins/translate.ts，界面那半在 renderer/plugins/translate/。
 */
import { safeStorage } from 'electron'
import { join } from 'node:path'
import { isEngineId, isTargetLang, normalizeTranslate, TRANSLATE, type TranslateSettings, type TrEngineId } from '../../../shared/plugins/translate'
import { E2E } from '../../test-mode'
import type { MainPlugin } from '../host'
import { askApi, isApi, PROVIDERS } from './api'
import { toTrError } from './errors'
import { cleanKey, KeyStore } from './keys'
import { EngineRouter } from './router'
import { setTranslateService, TranslateService, type Block } from './service'
import { buildPrompt, type Item, SYSTEM, TranslationCache, Translator } from './translator'

const MAX_ITEMS = 60
const MAX_TEXT = 6000
/** 测试连接、试一句用的词 */
const PROBE = 'eigenvalue'

function checkTarget(t: unknown): string {
  if (!isTargetLang(t)) throw new Error('目标语言不对')
  return t.trim()
}

function checkItems(raw: unknown): Item[] {
  if (!Array.isArray(raw) || raw.length > MAX_ITEMS) throw new Error('段落参数不对')
  return raw.map((x: { id?: unknown; text?: unknown }) => {
    if (typeof x?.id !== 'number' || typeof x.text !== 'string' || !x.text.trim()) throw new Error('段落参数不对')
    return { id: x.id, text: x.text.slice(0, MAX_TEXT) }
  })
}

function checkEngine(id: unknown): TrEngineId {
  if (!isEngineId(id)) throw new Error('没有这个翻译引擎')
  return id
}

export const translatePlugin: MainPlugin<TranslateSettings> = {
  manifest: TRANSLATE,
  normalizeSettings: normalizeTranslate,
  setup(host) {
    const cache = new TranslationCache(join(host.dir, 'cache.json'))
    // Key 加密后存在插件文件夹里，加密钥匙在钥匙串（safeStorage）；测试实例只放内存，不碰真的钥匙串
    const keys = E2E
      ? new KeyStore(null, null)
      : new KeyStore(join(host.dir, 'keys.json'), {
          encrypt: (s) => {
            if (!safeStorage.isEncryptionAvailable()) throw new Error('这台 Mac 的钥匙串现在用不了，Key 没存')
            return safeStorage.encryptString(s)
          },
          decrypt: (b) => safeStorage.decryptString(b),
        })
    const router = new EngineRouter({ cli: host.cli(), keys, settings: () => host.settings() })
    const tr = new Translator((s, p, signal, onText) => router.ask(s, p, signal, onText), cache)
    const service = new TranslateService(tr, router, () => host.settings().target, () => host.settings().style)
    setTranslateService(service)
    host.onQuit(() => cache.flush())

    /** 每个网页正在翻的批次：恢复原文、网页关掉时停下，不白花 AI */
    const live = new Map<number, Set<AbortController>>()
    const stop = (wcId: number) => {
      for (const ac of live.get(wcId) ?? []) ac.abort()
      live.delete(wcId)
    }
    const track = (wc: Electron.WebContents, ac: AbortController) => {
      if (!live.has(wc.id)) {
        live.set(wc.id, new Set())
        wc.once('destroyed', () => stop(wc.id))
      }
      live.get(wc.id)!.add(ac)
      return () => live.get(wc.id)?.delete(ac)
    }

    // ---------------------------------------------------------------- 网页里调的

    host.handle(
      'translate',
      async ({ sender }, arg) => {
        const { items, target } = (arg ?? {}) as { items?: unknown; target?: unknown }
        const list = checkItems(items)
        const to = checkTarget(target)
        const ac = new AbortController()
        const untrack = track(sender, ac)
        try {
          await tr.translate(list, to, (id, text, error) => host.emitToPage(sender, 'result', { id, text, ...(error ? { error } : {}) }), ac.signal)
        } finally {
          untrack()
        }
      },
      { page: true },
    )
    host.handle('cancel', ({ sender }) => stop(sender.id), { page: true })

    // 开翻译之前先查有没有能用的（不真的问 AI）
    host.handle(
      'preflight',
      () => {
        const r = router.preflight()
        return r.ok ? { ok: true, engine: r.engine, label: router.label(r.engine) } : r
      },
      { page: true },
    )

    // 选中一段翻：整段一次给回去
    host.handle(
      'selection',
      async (_ctx, arg) => {
        const { text, target } = (arg ?? {}) as { text?: unknown; target?: unknown }
        if (typeof text !== 'string' || !text.trim()) throw new Error('没有选中文字')
        const to = checkTarget(target)
        let out: string | null = null
        let err = '没翻成'
        await tr.translate([{ id: 1, text: text.trim().slice(0, MAX_TEXT) }], to, (_id, t, e) => ((out = t), e && (err = e.raw)), new AbortController().signal)
        if (out === null) throw new Error(err)
        return out
      },
      { page: true },
    )

    // ---------------------------------------------------------------- 界面调的

    host.handle('stats', () => ({ ...tr.stats, cached: cache.size }))
    host.handle('engine', () => {
      const cur = router.current()
      return cur ? router.label(cur) : ''
    })
    host.handle('clearCache', () => cache.clear())

    /** 设置页、菜单：每个引擎的状态（打开时查一次）、现在用哪个 */
    host.handle('engines', (_ctx, arg) => {
      if ((arg as { refresh?: boolean })?.refresh) router.refresh()
      const cur = router.current()
      const pre = router.preflight(false)
      return { list: router.statuses(), current: cur, label: cur ? router.label(cur) : null, lastUsed: router.lastUsed, blocked: pre.ok ? null : pre.error }
    })

    host.handle('setKey', (_ctx, id, key) => {
      const e = checkEngine(id)
      if (!isApi(e)) throw new Error('只有 API 要填 Key')
      keys.set(e, cleanKey(key))
      router.forget(e)
      return router.statuses()
    })
    host.handle('clearKey', (_ctx, id) => {
      const e = checkEngine(id)
      keys.delete(e)
      router.forget(e)
      return router.statuses()
    })

    /** 测试连接：用这个 Key 翻一个词，10 秒没回应算连不上 */
    host.handle('testKey', async (_ctx, id) => {
      const e = checkEngine(id)
      if (!isApi(e)) throw new Error('只有 API 能测试连接')
      const key = keys.get(e)
      if (!key) throw new Error('先填 Key')
      const t0 = Date.now()
      try {
        const out = await askApi(PROVIDERS[e], key, SYSTEM, buildPrompt([{ id: 1, text: PROBE }], 'zh-CN'), new AbortController().signal, () => undefined, 10_000)
        router.forget(e)
        return { ok: true, ms: Date.now() - t0, text: firstText(out) }
      } catch (err) {
        const info = toTrError(err, e)
        router.forget(e)
        if (info.code === 'bad-key') router.mark(e, 'badkey')
        else if (info.code === 'no-balance') router.mark(e, 'nobalance')
        return { ok: false, ms: Date.now() - t0, error: info }
      }
    })

    /** 试一句：用现在的设置翻「eigenvalue」，看谁答、多快 */
    host.handle('tryOne', async () => {
      const t0 = Date.now()
      try {
        const r = await router.ask(SYSTEM, buildPrompt([{ id: 1, text: PROBE }], 'zh-CN'), new AbortController().signal, () => undefined)
        return { ok: true, engine: r.engine, label: router.label(r.engine), ms: Date.now() - t0, text: firstText(r.text) }
      } catch (err) {
        return { ok: false, ms: Date.now() - t0, error: toTrError(err) }
      }
    })

    // ---------------------------------------------------------------- 给别处用：一串块进、一块块译文出（网页阅读视图、右键翻译这段）

    const reqs = new Map<number, AbortController>()
    host.handle('blocks', async (_ctx, arg) => {
      const { req, blocks, target, fresh } = (arg ?? {}) as { req?: unknown; blocks?: unknown; target?: unknown; fresh?: unknown }
      if (typeof req !== 'number' || !Array.isArray(blocks) || blocks.length > 2000) throw new Error('参数不对')
      const list: Block[] = blocks.map((b: { id?: unknown; text?: unknown }) => {
        if (typeof b?.id !== 'string' || typeof b.text !== 'string') throw new Error('块的参数不对')
        return { id: b.id, text: b.text.slice(0, MAX_TEXT) }
      })
      const ac = new AbortController()
      reqs.set(req, ac)
      try {
        await service.translateBlocks(
          list,
          { ...(target !== undefined ? { target: checkTarget(target) } : {}), ...(fresh === true ? { fresh: true } : {}) },
          (r) => host.emit('blocks', { req, ...r }),
          ac.signal,
        )
      } finally {
        reqs.delete(req)
      }
    })
    host.handle('blocksCancel', (_ctx, req) => reqs.get(req as number)?.abort())
  },
}

/** 回答里第一段译文（试一句、测试连接显示用） */
function firstText(out: string): string {
  for (const line of out.split('\n')) {
    try {
      const o = JSON.parse(line.trim()) as { text?: unknown }
      if (typeof o.text === 'string') return o.text
    } catch {
      // 下一行
    }
  }
  return out.trim().slice(0, 40)
}
