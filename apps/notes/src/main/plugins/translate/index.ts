/**
 * 双语翻译（我们自己的「沉浸式翻译」）主进程这半：网页预加载把看得见的段落一批批发来，
 * 这里查缓存、按设置挑引擎问（本机命令行或自己填 Key 的 API，见 router.ts），带上课程术语表，翻好一段就发回那个网页一段。
 * 网页那半在 preload/plugins/translate.ts，界面那半在 renderer/plugins/translate/。
 */
import * as git from '@cn/git'
import { safeStorage, webContents } from 'electron'
import { join } from 'node:path'
import { glossaryMd, glossaryPath, isEngineId, isTargetLang, normalizeTranslate, TRANSLATE, type TranslateSettings, type TrEngineId } from '../../../shared/plugins/translate'
import { E2E } from '../../test-mode'
import { isOurWebview } from '../../web'
import type { MainPlugin } from '../host'
import { askApi, isApi, PROVIDERS } from './api'
import { toTrError } from './errors'
import { appendTerm, courseMaterial, draftPrompt, Glossaries, parseDraft } from './glossary'
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
    const glossaries = new Glossaries()
    const vault = () => {
      try {
        return host.vault()
      } catch {
        return null
      }
    }
    const service = new TranslateService(tr, router, glossaries, vault, () => host.settings().target, () => host.settings().style)
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
          const terms = await service.glossaryFor(undefined)
          await tr.translate(list, to, (id, text, error) => host.emitToPage(sender, 'result', { id, text, ...(error ? { error } : {}) }), ac.signal, terms)
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
        const terms = await service.glossaryFor(undefined)
        await tr.translate([{ id: 1, text: text.trim().slice(0, MAX_TEXT) }], to, (_id, t, e) => ((out = t), e && (err = e.raw)), new AbortController().signal, terms)
        if (out === null) throw new Error(err)
        return out
      },
      { page: true },
    )

    // 网页里选中一个词「加进术语表」：加一行（译法先留空），在中间栏打开表
    host.handle(
      'glossaryAdd',
      async (_ctx, arg) => {
        const text = String((arg as { text?: unknown })?.text ?? '').trim()
        if (!text || text.length > 80) throw new Error('选一个词或短语再加')
        const course = glossaries.course()
        if (!course) throw new Error('中间栏先打开一门课（课程/<课>/）里的文件，再加进它的术语表')
        const v = host.vault()
        const path = await appendTerm(v, course, text)
        await git.commitPaths(v.root, [path], `术语表：加「${text.slice(0, 40)}」`)
        host.filesChanged()
        host.emit('openNote', { path })
        return { path }
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

    // ---------------------------------------------------------------- 术语表

    /** 中间栏开着的文件（界面在换标签时报） */
    host.handle('context', (_ctx, path) => {
      glossaries.activePath = typeof path === 'string' ? path : null
    })
    host.handle('glossary', () => glossaries.info(vault()))

    /** 让 AI 起个头：读这门课的笔记、PDF 和当前网页，写成表，一次提交；边写边报找到几条 */
    host.handle('glossaryDraft', async (_ctx, arg) => {
      const { wcId } = (arg ?? {}) as { wcId?: unknown }
      const course = glossaries.course()
      if (!course) throw new Error('中间栏先打开一门课（课程/<课>/）里的文件')
      const v = host.vault()
      let page = ''
      const wc = typeof wcId === 'number' ? webContents.fromId(wcId) : undefined
      if (wc && !wc.isDestroyed() && isOurWebview(wc)) page = String(await wc.executeJavaScript('document.body ? document.body.innerText.slice(0, 8000) : ""').catch(() => ''))
      const { text } = await courseMaterial(v, course, page)
      if (!text.trim()) throw new Error(`「${course}」文件夹里还没有笔记或 PDF，网页也没有字，AI 没东西可读`)
      let found = 0
      const r = await router.ask(SYSTEM, draftPrompt(course, text, host.settings().target), new AbortController().signal, (d) => {
        const n = (d.match(/"src"\s*:/g) ?? []).length
        if (n) host.emit('glossaryProgress', { found: (found += n) })
      })
      const terms = parseDraft(r.text)
      if (!terms.length) throw new Error('AI 没挑出术语，再试一次')
      const path = glossaryPath(course)
      const res = await v.write(path, glossaryMd(terms), '')
      if (!res.ok) throw new Error('术语表刚被人建好了，打开看看')
      await git.commitPaths(v.root, [path], `术语表：AI 起头「${course}」${terms.length} 条`)
      glossaries.lastCourse = course
      host.filesChanged()
      return { path, count: terms.length, engine: router.label(r.engine) }
    })

    // ---------------------------------------------------------------- 给别处用：一串块进、一块块译文出（PDF 对照读）

    const reqs = new Map<number, AbortController>()
    host.handle('blocks', async (_ctx, arg) => {
      const { req, blocks, target, course, fresh } = (arg ?? {}) as { req?: unknown; blocks?: unknown; target?: unknown; course?: unknown; fresh?: unknown }
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
          { ...(target !== undefined ? { target: checkTarget(target) } : {}), ...(course === null || typeof course === 'string' ? { course } : {}), ...(fresh === true ? { fresh: true } : {}) },
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
