/**
 * 拦广告主进程这半（CN-51）：在内置浏览器的分区（persist:web，右栏和中间的宽网页都用它）上挂 Ghostery 的拦截引擎。
 * - 网络：onBeforeRequest / onHeadersReceived 交给引擎（广告脚本、跟踪请求不发出去）；
 * - 页面元素：分区上注册引擎自带的网页预加载，它问主进程要这个网站的隐藏规则（.ad-banner 这类），插进页面。
 * 规则：EasyList + EasyPrivacy，编好的引擎存在 <userData>/plugins/adblock/engine.bin；超过一周（或没有）才重新取，取不到就用旧的。
 * 什么时候取：用户第一次在网页里去网站时（不是开软件时）。用户没去任何网站，软件就不对外连（第 4 轮：开软件就连 easylist.to、raw.githubusercontent.com）。
 * 手里一条规则都没有时，第一个网站的请求等规则最多 3 秒（2026-11-17 用户定，第 5 轮）：3 秒内取回来，第一页就拦；
 * 没取回来先放行这一页（这一页不拦，拦一半更怪），下一页再用规则。所有请求共用这一个 3 秒，不是每个请求各等一次。
 * 取规则失败（国内常连不上 GitHub）后 10 分钟内不再让任何网页等，之后再去网站时在后台重取（隔一分钟最多一次）。
 * 插件关着、网页在「不拦」名单里：一律放行（钩子一直挂着，按当时的开关和名单判断，开关不用重开软件）。
 * 测试：CN_ADBLOCK_LISTS 换成本机的假规则（逗号隔开），CN_ADBLOCK_RESOURCES 换掉引擎另外要取的 resources.json；
 * 测试实例（CN_E2E）没给假规则时不联网取。
 */
import { ElectronBlocker } from '@ghostery/adblocker-electron'
import { ipcMain, type IpcMainInvokeEvent, session, webContents } from 'electron'
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { ADBLOCK, type AdblockSettings, type AdblockStatus, allowed, DEFAULT_LISTS, normalizeAdblock, REFRESH_MS } from '../../../shared/plugins/adblock'
import type { MainPlugin, PluginHost } from '../host'

/** 引擎自带的网页预加载（问隐藏规则、看页面上新加的元素） */
const PRELOAD = () => createRequire(createRequire(__filename).resolve('@ghostery/adblocker-electron')).resolve('@ghostery/adblocker-electron-preload')

/** 第一次去网站时最多等规则这么久 */
const FIRST_WAIT_MS = 3000
/** 取规则失败后这么久里不再让网页等 */
const QUIET_MS = 10 * 60_000

const lists = () => (process.env.CN_ADBLOCK_LISTS ? process.env.CN_ADBLOCK_LISTS.split(',').filter(Boolean) : process.env.CN_E2E === '1' ? [] : DEFAULT_LISTS)

/** 一个请求是哪个网页发的：有 webContents 就看它现在的网址；整页导航看要去的网址 */
function pageOf(d: { url: string; resourceType?: string; webContentsId?: number; webContents?: Electron.WebContents }): string {
  if (d.resourceType === 'mainFrame') return d.url
  const wc = d.webContents ?? (d.webContentsId !== undefined ? webContents.fromId(d.webContentsId) : undefined)
  return wc && !wc.isDestroyed() ? wc.getURL() : ''
}

export const adblockPlugin: MainPlugin<AdblockSettings> = {
  manifest: ADBLOCK,
  normalizeSettings: normalizeAdblock,
  setup(host: PluginHost<AdblockSettings>) {
    const ses = session.fromPartition('persist:web')
    const file = join(host.dir, 'engine.bin')
    let engine: ElectronBlocker | null = null
    const st: AdblockStatus = { state: 'idle', rules: 0, updated: 0, blocked: 0 }
    const status = (): AdblockStatus => ({ ...st })
    const changed = () => host.emit('status', status())

    const use = (e: ElectronBlocker, updated: number) => {
      engine = e
      const f = e.getFilters()
      st.state = 'ok'
      st.rules = f.networkFilters.length + f.cosmeticFilters.length
      st.updated = updated
      delete st.error
      e.on('request-blocked', () => {
        st.blocked++
      })
      changed()
    }

    /** 存着的引擎（不联网）：开软件时读，有就马上能拦 */
    function loadCached() {
      try {
        use(ElectronBlocker.deserialize(new Uint8Array(readFileSync(file))), statSync(file).mtimeMs)
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('[adblock] 存着的规则读不出来，下次去网站时重新取', (e as Error).message)
        if (!lists().length) ((st.state = 'off'), changed())
      }
    }

    /** 取规则、编成引擎、存起来；force：不管上次是什么时候（设置里点「现在更新」） */
    let loading: Promise<void> | null = null
    /** 上次去取的时间：手里有旧规则时一小时内不再取，一条都没有时一分钟内不再取（不然每个请求都去取一次） */
    let tried = 0
    /** 上次取失败的时间：之后 10 分钟里网页不等规则 */
    let failedAt = 0
    /** 这一次取规则时网页最多等到几点（0：不等） */
    let waitUntil = 0
    function load(force = false): Promise<void> {
      if (loading) return loading
      const urls = lists()
      if (!urls.length) return Promise.resolve()
      if (!force && ((engine && Date.now() - st.updated < REFRESH_MS) || Date.now() - tried < (engine ? 3600_000 : 60_000))) return Promise.resolve()
      tried = Date.now()
      // 刚失败过：后台重取，网页不等
      waitUntil = engine || Date.now() - failedAt < QUIET_MS ? 0 : Date.now() + FIRST_WAIT_MS
      loading = (async () => {
        if (!engine) ((st.state = 'loading'), changed())
        try {
          const fetch = (u: string) =>
            ses.fetch(process.env.CN_ADBLOCK_RESOURCES && u.endsWith('/resources.json') ? process.env.CN_ADBLOCK_RESOURCES : u, { signal: AbortSignal.timeout(30_000), bypassCustomProtocolHandlers: true })
          const e = await ElectronBlocker.fromLists(fetch, urls, { loadCosmeticFilters: true, loadNetworkFilters: true, enableMutationObserver: true })
          mkdirSync(host.dir, { recursive: true })
          writeFileSync(file + '.tmp', e.serialize())
          renameSync(file + '.tmp', file)
          use(e, Date.now())
        } catch (e) {
          console.warn('[adblock] 规则没取到', (e as Error).message)
          failedAt = Date.now()
          if (!engine) st.state = 'error'
          st.error = `规则没取到：${(e as Error).message}`
          changed()
        }
      })().finally(() => ((loading = null), (waitUntil = 0)))
      return loading
    }

    /** 没等到规则就放行的网页（webContents id）：这一页不拦，下一次整页导航再用规则 */
    const passed = new Set<number>()
    const on = (page: string, wcId?: number) => !!engine && host.enabled() && !allowed(host.settings().allow, page) && !(wcId !== undefined && passed.has(wcId))
    const wcOf = (d: { webContentsId?: number; webContents?: Electron.WebContents }) => d.webContentsId ?? d.webContents?.id

    // 网络：拦广告请求；页面元素：引擎的网页预加载要隐藏规则。
    // 网页里去网站（有 webContents、http(s)）才去取规则；软件自己在主进程里取的（规则本身、网站小图标）不算
    ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (d, cb) => {
      const fromPage = (d.webContentsId !== undefined || !!d.webContents) && /^https?:/i.test(d.url)
      const wc = wcOf(d)
      const go = () => {
        // 整页导航放行时手里还没规则：这一页都不拦
        if (d.resourceType === 'mainFrame' && wc !== undefined) {
          if (engine) passed.delete(wc)
          else passed.add(wc)
        }
        return on(pageOf(d), wc) ? engine!.onBeforeRequest(d, cb) : cb({})
      }
      if (!fromPage || !host.enabled()) return go()
      const p = load()
      // 手里还没有规则、正在取：等到取回来或到点（第一次去网站时起最多 3 秒，大家共用这一个点）再放行
      const left = waitUntil - Date.now()
      if (!engine && loading && left > 0) void Promise.race([p, new Promise((r) => setTimeout(r, left))]).then(go)
      else go()
    })
    ses.webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, (d, cb) => (on(pageOf(d), wcOf(d)) ? engine!.onHeadersReceived(d, cb) : cb({})))
    ses.registerPreloadScript({ type: 'frame', filePath: PRELOAD() })
    ipcMain.handle('@ghostery/adblocker/inject-cosmetic-filters', (e: IpcMainInvokeEvent, url: string, msg?: unknown) =>
      on(typeof url === 'string' ? url : '', e.sender.id) ? engine!.onInjectCosmeticFilters(e, url, msg as never) : undefined,
    )
    ipcMain.handle('@ghostery/adblocker/is-mutation-observer-enabled', (e: IpcMainInvokeEvent) => (engine ? engine.onIsMutationObserverEnabled(e) : false))

    host.handle('status', () => status())
    host.handle('update', async () => (await load(true), status()))

    // 开软件只读存着的；超过一周的，下次去网站时再取（onBeforeRequest）
    loadCached()
  },
}
