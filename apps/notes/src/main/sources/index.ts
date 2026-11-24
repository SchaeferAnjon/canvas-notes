/**
 * 同步来源在主进程这一边（设计页 61-同步来源，用户 2026-11-23 定稿）：把 runner.ts 接上 Electron。
 * - Key：这台 Mac 的钥匙串（Electron safeStorage 加密，照翻译插件 plugins/translate/keys.ts），密文在设置目录 sources/keys.json，
 *   不进库、不进 Git、不进日志；界面只拿得到「有没有、最后 4 位」。测试实例只放内存。
 * - 钟：和自动化共用（自动化引擎每次看钟叫 tick）：打开库那一次拉一次，之后照「什么时候拉」；自动化总开关关了不定时拉。
 * - 每拉一次：记进自动化的记录、和拉来的文件一起一次提交（「同步来源 Get笔记：拉了 N 篇」），设置 › 自动化「最近跑的」里有、能撤回；
 *   拉到新的时底栏说一句（设置开着「跑完告诉我 · 发通知」再发系统通知）。
 * - IPC：window.cn.sources（契约 shared/sources.ts）；设置 › 自动化「软件自带的」里那一行走 automation.ts 的 auto:system。
 * 测试：CN_GETNOTE_API 指向假 Get笔记；E2E 里 globalThis.cnSources.tick(时间) 当一次看钟。
 */
import { defaultSourceSettings, type FirstPlan, ruleStats, newSyncState, nextPull, pullDue, type RemoteItem, type SourceSettings, SYNC_EVERY, type SyncEvery, syncStatePath } from '@cn/format'
import { commitPaths, GitError } from '@cn/git'
import { type BrowserWindow, ipcMain, Notification, safeStorage } from 'electron'
import { join } from 'node:path'
import type { AutoPrefs, AutoSystemInfo } from '../../shared/automation'
import { type FirstItem, type SourceFail, type SourceInfo, type SourcePullResult, sourceRuleName, type SourcesListing } from '../../shared/sources'
import type { AutoEngine } from '../automation-engine'
import { cleanKey, KeyStore } from '../plugins/translate/keys'
import { E2E } from '../test-mode'
import type { Vault } from '../vault'
import { SourceError } from './adapter'
import { type GetnoteKey, getnoteAdapter } from './getnote'
import { type PullResult, SourceRunner } from './runner'

export interface SourcesDeps {
  vault(): Vault | null
  win(): BrowserWindow | null
  userData: string
  engine: AutoEngine
  prefs(): AutoPrefs
}

/** 「接一个…」里列的几家：只有 Get笔记 现在能接，别的写着以后接（设计页第 7 节的顺序；名字是服务自己的，不翻） */
const CATALOG = [
  { id: 'getnote', name: 'Get笔记', desc: '链接、图片、录音的 AI 笔记 · 填 API Key 和 Client ID', ready: true, lang: 'zh' as const, idProp: 'getnote_id' },
  { id: 'readwise', name: 'Readwise', desc: '书和文章里的划线', ready: false, lang: 'en' as const, idProp: 'readwise_id' },
  { id: 'flomo', name: 'flomo 浮墨', desc: '每一条 memo', ready: false, lang: 'zh' as const, idProp: 'flomo_id' },
  { id: 'raindrop', name: 'Raindrop.io', desc: '收藏的网址和划线', ready: false, lang: 'en' as const, idProp: 'raindrop_id' },
  { id: 'zotero', name: 'Zotero', desc: '文献和 PDF 标注', ready: false, lang: 'en' as const, idProp: 'zotero_key' },
]

/** 什么时候拉（不翻：自动化页「软件自带的」那一行的说明由主进程写，和梦游那一行一样） */
const EVERY_LABEL: Record<SyncEvery, string> = { 'open+1h': '开软件时和每小时', 'open+2h': '开软件时和每2小时', 'open+22': '开软件时和每天22:00', open: '只在开软件时', manual: '只手动' }

const stampOf = (d: Date) => {
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

const failOf = (e: unknown): SourceFail =>
  e instanceof SourceError ? { ok: false, kind: e.kind, error: e.message, ...(e.link ? { link: e.link } : {}) } : { ok: false, kind: 'other', error: String((e as Error)?.message ?? e).split('\n')[0]!.slice(0, 200) }

const firstItem = (r: RemoteItem): FirstItem => ({ id: r.id, title: r.title, kind: r.kind, created: r.created, empty: r.empty })

export function setupSources(d: SourcesDeps) {
  const keys = E2E
    ? new KeyStore(null, null)
    : new KeyStore(join(d.userData, 'sources', 'keys.json'), {
        encrypt: (s) => {
          if (!safeStorage.isEncryptionAvailable()) throw new Error('这台 Mac 的钥匙串现在用不了，Key 没存')
          return safeStorage.encryptString(s)
        },
        decrypt: (b) => safeStorage.decryptString(b),
      })
  // 测试实例的钥匙串只在内存里：「开软件时拉一次」的测试启动时带上（CN_E2E_GETNOTE_KEY、CN_E2E_GETNOTE_CLIENT）
  if (E2E && process.env.CN_E2E_GETNOTE_KEY && process.env.CN_E2E_GETNOTE_CLIENT) {
    keys.set('getnote.key', process.env.CN_E2E_GETNOTE_KEY)
    keys.set('getnote.client', process.env.CN_E2E_GETNOTE_CLIENT)
  }
  const gnKey = (): GetnoteKey | null => {
    const key = keys.has('getnote.key') ? keys.get('getnote.key') : undefined
    const client = keys.has('getnote.client') ? keys.get('getnote.client') : undefined
    return key && client ? { key, client } : null
  }
  /** 连上那一步试 Key 用的（还没存进钥匙串） */
  let trying: GetnoteKey | null = null
  const send = (ch: string, payload?: unknown) => {
    const w = d.win()
    if (w && !w.isDestroyed()) w.webContents.send(ch, payload)
  }
  const now = () => {
    // 测试：CN_SOURCES_NOW（启动时就是「明天」）或 globalThis.cnSourcesNow（看钟的测试一步步往后拨）
    const g = globalThis as unknown as { cnSourcesNow?: string }
    const at = E2E ? (g.cnSourcesNow ?? process.env.CN_SOURCES_NOW) : undefined
    return at ? new Date(at) : new Date()
  }
  const runner = new SourceRunner(
    getnoteAdapter(() => trying ?? gnKey()),
    {
      vault: d.vault,
      now,
      async download(url, signal) {
        const res = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) })
        if (!res.ok) throw new Error(`图取不回来（${res.status}）`)
        return new Uint8Array(await res.arrayBuffer())
      },
      progress: (p) => send('sources:progress', { id: 'getnote', ...p }),
    },
  )
  const runners = new Map<string, SourceRunner>([['getnote', runner as SourceRunner]])
  const need = (id: unknown) => {
    const r = typeof id === 'string' ? runners.get(id) : undefined
    if (!r) throw new Error('同步来源参数不对：id')
    return r
  }
  const hasKey = (id: string) => (id === 'getnote' ? !!gnKey() : false)

  /** 正在拉的（一家一次只拉一回）；ctl 给「断开」停下 */
  const running = new Map<string, { ctl: AbortController; done: Promise<SourcePullResult> }>()

  /** 拉一次，记进自动化记录、一次提交 */
  function pull(id: string, why: 'open' | 'auto' | 'run' | 'first', pick?: string[]): Promise<SourcePullResult> {
    const busy = running.get(id)
    if (busy) return busy.done
    const r = need(id)
    const ctl = new AbortController()
    const done = (async (): Promise<SourcePullResult> => {
      const v = d.vault()
      if (!v) return { ok: false, kind: 'other', error: '还没有打开库' }
      send('sources:changed')
      let res: PullResult
      try {
        res = await r.pull(pick ? { pick, newest: r.firstNewest } : {}, ctl.signal)
      } catch (e) {
        return failOf(e)
      }
      const name = r.a.name
      const fail = res.error ? failOf(res.error) : null
      const changed = res.files.some((f) => f !== syncStatePath(id))
      // 不翻：写进库里的自动化记录和提交说明
      const by = why === 'run' || why === 'first' ? 'run' : 'auto'
      const whyText = why === 'open' ? '打开软件时' : why === 'auto' ? EVERY_LABEL[(await r.readState())?.settings.every ?? 'open+2h'].replace('开软件时和', '') : why === 'first' ? '第一次连上' : '点了「现在拉一次」'
      let log: string | null = null
      if (changed || fail) {
        const entry = await d.engine.record({ rule: sourceRuleName(name), where: 'lib', by, why: whyText, did: res.did, files: changed ? res.files : [], ok: !fail, ...(fail ? { error: fail.error } : {}) }, `同步来源 ${name}：${res.did.join('；') || fail?.error}`)
        log = entry.id
        if (!changed && res.files.length) await commitPaths(v.root, res.files, `同步来源 ${name}：记下拉到哪`).catch((e) => (e instanceof GitError ? null : Promise.reject(e)))
      } else {
        // 没有新的：只更新了拉到哪，单独提交（不占「最近跑的」）
        await commitPaths(v.root, res.files, `同步来源 ${name}：没有新的`).catch((e) => (e instanceof GitError ? null : Promise.reject(e)))
      }
      // 自己拉到新的（开软件时、到点）：底栏说一句；点「现在拉一次」的由设置页自己说
      if ((res.pulled.length || res.replaced) && (why === 'open' || why === 'auto')) {
        send('sources:done', { id, name, did: res.did.join('，'), log, first: res.pulled[0] ?? null })
        if (d.prefs().notify) {
          const text = res.did.join('；')
          if (E2E) (globalThis as unknown as { cnScreen?: string[] }).cnScreen?.push(`系统通知：${name}：${text}`)
          else if (Notification.isSupported()) new Notification({ title: name, body: text }).show()
        }
      }
      if (fail && res.pulled.length) return { ok: true, pulled: res.pulled.length, images: res.images, did: res.did.join('，'), log, partial: fail }
      if (fail) return fail
      return { ok: true, pulled: res.pulled.length, images: res.images, did: res.did.join('，'), log }
    })().finally(() => {
      running.delete(id)
      send('sources:changed')
    })
    running.set(id, { ctl, done })
    return done
  }

  async function info(id: string): Promise<SourceInfo> {
    const r = need(id)
    const v = d.vault()
    const st = v ? await r.readState() : null
    const idx = v ? await r.index() : new Map()
    const last = st?.lastPull ? new Date(st.lastPull) : null
    const next = st && st.settings.on && hasKey(id) ? nextPull(st.settings.every, last, now()) : null
    const tail = keys.has(`${id}.key`) ? keys.tail(`${id}.key`) : undefined
    const guess = v ? await r.folderGuess(idx) : r.a.defaultFolder()
    return {
      id,
      name: r.a.name,
      connected: !!st,
      hasKey: hasKey(id),
      keyHint: tail ? `••••${tail}` : null,
      settings: st?.settings ?? defaultSourceSettings(guess),
      folderGuess: guess,
      inVault: idx.size,
      lastPull: st?.lastPull ?? null,
      next: next ? stampOf(next) : null,
      running: running.has(id),
    }
  }

  /** 接上了的（库里有记录、设置开着或这台 Mac 有 Key）：断开过的（关了、没 Key）不算 */
  const shown = (s: SourceInfo) => s.connected && (s.hasKey || s.settings.on)

  async function listing(): Promise<SourcesListing> {
    const sources = (await Promise.all([...runners.keys()].map(info))).filter(shown)
    const v = d.vault()
    const texts = v ? await v.texts() : new Map<string, string>()
    const catalog = CATALOG.filter((c) => !sources.some((s) => s.id === c.id)).map((c) => {
      let n = 0
      const re = new RegExp(`^${c.idProp}s?:`, 'm')
      for (const t of texts.values()) if (t.startsWith('---') && re.test(t.slice(0, 2000))) n++
      return { id: c.id, name: c.name, desc: c.desc, ready: c.ready, lang: c.lang, inVault: n }
    })
    return { sources, catalog }
  }

  async function saveSettings(id: string, patch: Partial<SourceSettings>): Promise<SourceSettings> {
    const r = need(id)
    const v = d.vault()
    if (!v) throw new Error('还没有打开库')
    const st = (await r.readState()) ?? (await freshState(r))
    const s = st.settings
    if (typeof patch.on === 'boolean') s.on = patch.on
    if (typeof patch.folder === 'string' && patch.folder.trim() && !patch.folder.split('/').includes('..') && !patch.folder.startsWith('/')) s.folder = patch.folder.trim().replace(/\/+$/, '')
    if (SYNC_EVERY.includes(patch.every as SyncEvery)) s.every = patch.every as SyncEvery
    for (const k of ['images', 'transcript', 'original', 'skipEmpty'] as const) if (typeof patch[k] === 'boolean') s[k] = patch[k]
    const rel = await r.writeState(st)
    await commitPaths(v.root, [rel], `同步来源 ${r.a.name}：改了设置`).catch((e) => (e instanceof GitError ? null : Promise.reject(e)))
    send('sources:changed')
    send('auto:changed')
    return s
  }
  /** 还没有记录时新建一份（照库里认出来的文件夹） */
  const freshState = async (r: SourceRunner) => newSyncState(await r.folderGuess())

  // ---------------------------------------------------------------- 钟

  let openedRoot: string | null = null
  function tick(t: Date) {
    const v = d.vault()
    if (!v) return
    const opening = openedRoot !== v.root
    openedRoot = v.root
    void (async () => {
      for (const [id, r] of runners) {
        if (!hasKey(id) || running.has(id)) continue
        const st = await r.readState()
        if (!st || !st.settings.on || st.settings.every === 'manual') continue
        // 自动化总开关关了：不定时拉（「现在拉一次」照样能点）
        if (!d.prefs().on) continue
        if (opening) void pull(id, 'open')
        else if (pullDue(st.settings.every, st.lastPull ? new Date(st.lastPull) : null, t)) void pull(id, 'auto')
      }
    })().catch((e) => console.error('同步来源看钟出错', e))
  }

  async function systems(): Promise<AutoSystemInfo[]> {
    const out: AutoSystemInfo[] = []
    const log = d.vault() ? await d.engine.readLog() : []
    for (const id of runners.keys()) {
      const s = await info(id)
      if (!shown(s)) continue
      const rule = sourceRuleName(s.name)
      out.push({ id: `source:${id}`, name: rule, on: s.settings.on && s.hasKey, desc: `${EVERY_LABEL[s.settings.every]} · ${s.settings.folder}${s.hasKey ? '' : ' · 这台Mac还没填Key'}`, rule, ...ruleStats(log, 'lib', rule) })
    }
    return out
  }

  // ---------------------------------------------------------------- IPC

  ipcMain.handle('sources:list', () => listing())
  ipcMain.handle('sources:connect', async (_e, id: unknown, key: unknown, client: unknown) => {
    const r = need(id)
    let k: GetnoteKey
    try {
      k = { key: cleanKey(key), client: cleanKey(client) }
    } catch (e) {
      return { ok: false, kind: 'auth', error: (e as Error).message } satisfies SourceFail
    }
    trying = k
    let plan: FirstPlan
    try {
      plan = await r.firstPlan(AbortSignal.timeout(5 * 60_000))
    } catch (e) {
      return failOf(e)
    } finally {
      trying = null
    }
    // 认了：存进钥匙串
    keys.set('getnote.key', k.key)
    keys.set('getnote.client', k.client)
    send('sources:changed')
    return { ok: true, plan: { total: plan.total, inVault: plan.inVault, newest: plan.newest, newer: plan.newer.map(firstItem), older: plan.older.map(firstItem) } }
  })
  ipcMain.handle('sources:firstPull', async (_e, id: unknown, pick: unknown) => {
    const r = need(id)
    if (!Array.isArray(pick) || pick.some((x) => typeof x !== 'string' || !/^[\w-]{1,40}$/.test(x))) throw new Error('同步来源参数不对：pick')
    // 第一次：记录照库里认出来的文件夹建起来（设置开着）
    const st = (await r.readState()) ?? (await freshState(r))
    st.settings.on = true
    await r.writeState(st)
    return pull(r.a.id, 'first', pick as string[])
  })
  ipcMain.handle('sources:pull', (_e, id: unknown) => pull(need(id).a.id, 'run'))
  ipcMain.handle('sources:settings', (_e, id: unknown, patch: unknown) => saveSettings(need(id).a.id, (patch ?? {}) as Partial<SourceSettings>))
  ipcMain.handle('sources:disconnect', async (_e, id: unknown) => {
    const r = need(id)
    running.get(r.a.id)?.ctl.abort()
    keys.delete(`${r.a.id}.key`)
    keys.delete(`${r.a.id}.client`)
    // 库里有记录的：关掉（别的 Mac 上也不再定时拉，要接着拉在那台再连一次）；拉来的笔记、认过的记录都留着
    if (d.vault() && (await r.readState())?.settings.on) await saveSettings(r.a.id, { on: false })
    send('sources:changed')
    send('auto:changed')
  })

  if (E2E) (globalThis as unknown as { cnSources: unknown }).cnSources = { tick: (iso?: string) => tick(iso ? new Date(iso) : now()), idle: () => Promise.all([...running.values()].map((x) => x.done)) }

  return {
    tick,
    systems,
    async setOn(id: string, on: boolean) {
      await saveSettings(need(id).a.id, { on })
    },
    async run(id: string) {
      await pull(need(id).a.id, 'run')
    },
  }
}
