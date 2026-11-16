/**
 * BookmarkKeeper 页面（cn-ext://bookmarkkeeper/…）里的预加载：在页面自己的脚本跑之前，给它造一个 window.chrome，
 * 接口和 Chrome 插件页里的一样（Promise 版，也认最后一个参数是回调的写法），实际的事交给主进程（main/web/bookmarkkeeper/）。
 * 跨域的 fetch 也换成主进程替它发：Chrome 里插件有 host_permissions 不受跨域限制，失效链接检测和 AI 整理靠这个。
 */
import { contextBridge, ipcRenderer } from 'electron'
import { type ExtTheme, extThemeCss } from '../shared/ext-theme'

/** 预加载这边给页面的几样本事（穿过隔离，函数照样能调） */
interface Bridge {
  call(ns: string, method: string, args: unknown[]): Promise<unknown>
  onEvent(cb: (ev: Record<string, unknown>) => void): void
  fetch(req: unknown): Promise<unknown>
  abort(id: string): void
}

export function installExtPage() {
  const init = ipcRenderer.sendSync('ext:init') as { manifest?: Record<string, unknown>; theme?: ExtTheme | null; error?: string }
  if (!init.manifest) {
    console.error('书签管家页面起不来：', init.error)
    return
  }
  installTheme(init.theme ?? null)
  const bridge: Bridge = {
    call: (ns, method, args) =>
      ipcRenderer.invoke('ext:call', ns, method, args).catch((e: Error) => {
        throw new Error(String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      }),
    onEvent: (cb) => void ipcRenderer.on('ext:event', (_e, ev: Record<string, unknown>) => cb(ev)),
    fetch: (req) => ipcRenderer.invoke('ext:fetch', req),
    abort: (id) => ipcRenderer.send('ext:fetch-abort', id),
  }
  contextBridge.executeInMainWorld({ func: installChrome, args: [bridge, init.manifest, location.origin] })
}

/**
 * 插件页跟着软件的主题（shared/ext-theme.ts）：一有 <html> 就插进样式，免得先闪一下插件自己的米白底；
 * 页面的 DOM 好了再挪到 <head> 最后，排在插件自己的样式后面。换主题时主进程送来新的。
 */
function installTheme(first: ExtTheme | null) {
  const el = document.createElement('style')
  el.id = 'cn-ext-theme'
  const set = (t: ExtTheme | null) => {
    if (t) el.textContent = extThemeCss(t)
  }
  set(first)
  const put = () => (document.head ?? document.documentElement)?.appendChild(el)
  if (document.documentElement) put()
  else document.addEventListener('readystatechange', put, { once: true })
  document.addEventListener('DOMContentLoaded', put, { once: true })
  ipcRenderer.on('ext:theme', (_e, t: ExtTheme) => set(t))
}

/**
 * 在页面那边跑（会被转成字符串送过去）：只能用参数和页面自己的东西，不能引用这个文件里别的。
 */
function installChrome(bridge: Bridge, manifest: Record<string, unknown>, origin: string) {
  type Fn = (...a: unknown[]) => unknown
  const w = window as unknown as Record<string, unknown>
  const event = () => {
    const fns = new Set<Fn>()
    return {
      addListener: (f: Fn) => void fns.add(f),
      removeListener: (f: Fn) => void fns.delete(f),
      hasListener: (f: Fn) => fns.has(f),
      hasListeners: () => fns.size > 0,
      fire(...a: unknown[]) {
        for (const f of [...fns]) {
          try {
            f(...a)
          } catch (e) {
            console.error(e)
          }
        }
      },
    }
  }
  const runtime: Record<string, unknown> = { id: 'bookmarkkeeper', lastError: undefined }
  /** Promise 版；最后一个参数是函数时当回调（出错时 runtime.lastError 有值） */
  const api =
    (fn: (...a: unknown[]) => unknown) =>
    (...args: unknown[]) => {
      const cb = typeof args[args.length - 1] === 'function' ? (args.pop() as Fn) : null
      const p = Promise.resolve().then(() => fn(...args))
      if (!cb) return p
      p.then(
        (r) => cb(r),
        (e: Error) => {
          runtime.lastError = { message: String(e?.message ?? e) }
          try {
            cb()
          } finally {
            runtime.lastError = undefined
          }
        },
      )
      return undefined
    }
  const remote = (ns: string, method: string) => api((...a) => bridge.call(ns, method, a))

  // ---- runtime
  const onMessage = event()
  const getURL = (p: string) => origin + '/' + String(p ?? '').replace(/^\/+/, '')
  Object.assign(runtime, {
    getManifest: () => JSON.parse(JSON.stringify(manifest)),
    getURL,
    sendMessage: remote('runtime', 'sendMessage'),
    sendNativeMessage: remote('runtime', 'sendNativeMessage'),
    openOptionsPage: api(() => bridge.call('tabs', 'create', [{ url: getURL(String(manifest.options_page ?? 'options/options.html')) }])),
    getPlatformInfo: api(() => ({ os: 'mac', arch: 'arm', nacl_arch: 'arm' })),
    reload: () => location.reload(),
    onMessage,
    onInstalled: event(),
    onStartup: event(),
    onConnect: event(),
  })

  // ---- storage
  const onStorage = event()
  const areaApi = (area: string) => {
    const onChanged = event()
    onStorage.addListener((changes: unknown, a: unknown) => a === area && onChanged.fire(changes))
    return {
      get: api((keys) => bridge.call('storage', 'get', [area, keys ?? null])),
      set: api((items) => bridge.call('storage', 'set', [area, items])),
      remove: api((keys) => bridge.call('storage', 'remove', [area, keys])),
      clear: api(() => bridge.call('storage', 'clear', [area])),
      getBytesInUse: api(async () => JSON.stringify((await bridge.call('storage', 'get', [area, null])) ?? {}).length),
      onChanged,
    }
  }

  // ---- bookmarks：任何改动都按 onChanged 报（插件只拿它当「该重画了」）
  const bmEvents = ['onCreated', 'onRemoved', 'onChanged', 'onMoved', 'onChildrenReordered', 'onImportBegan', 'onImportEnded'] as const
  const bookmarks: Record<string, unknown> = {}
  for (const m of ['getTree', 'getSubTree', 'getChildren', 'get', 'getRecent', 'search', 'create', 'update', 'move', 'remove', 'removeTree']) bookmarks[m] = remote('bookmarks', m)
  for (const ev of bmEvents) bookmarks[ev] = event()

  // ---- tabs：query 在这边按条件筛
  type Tab = { id: number; url: string; title: string; active: boolean; windowId: number }
  const glob = (pat: string, url: string) => new RegExp('^' + pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$').test(url)
  const tabs = {
    query: api(async (q) => {
      const o = (q ?? {}) as { active?: boolean; url?: string | string[]; windowId?: number }
      const all = (await bridge.call('tabs', 'query', [])) as Tab[]
      const pats = o.url === undefined ? null : Array.isArray(o.url) ? o.url : [o.url]
      return all.filter((t) => (o.active === undefined || t.active === o.active) && (!pats || pats.some((p) => glob(p, t.url))))
    }),
    get: remote('tabs', 'get'),
    getCurrent: remote('tabs', 'getCurrent'),
    create: remote('tabs', 'create'),
    update: remote('tabs', 'update'),
    remove: remote('tabs', 'remove'),
    onCreated: event(),
    onRemoved: event(),
    onUpdated: event(),
    onActivated: event(),
    TAB_ID_NONE: -1,
  }
  const win = remote('windows', 'getCurrent')
  const windows = { getCurrent: win, getLastFocused: win, get: win, update: remote('windows', 'update'), WINDOW_ID_CURRENT: -2, WINDOW_ID_NONE: -1 }

  const noop = api(() => undefined)
  const chrome = (w.chrome && typeof w.chrome === 'object' ? w.chrome : {}) as Record<string, unknown>
  Object.assign(chrome, {
    runtime,
    storage: { local: areaApi('local'), sync: areaApi('sync'), onChanged: onStorage },
    bookmarks,
    tabs,
    windows,
    // 新标签页用不到、后台脚本才用的：给个空的，碰到不报错
    action: { setBadgeText: noop, setBadgeBackgroundColor: noop, setTitle: noop, onClicked: event() },
    contextMenus: { create: noop, removeAll: noop, onClicked: event() },
    commands: { onCommand: event(), getAll: api(() => []) },
    i18n: { getMessage: () => '', getUILanguage: () => navigator.language },
  })
  w.chrome = chrome

  bridge.onEvent((ev) => {
    if (ev.type === 'message') onMessage.fire(ev.message, { id: 'bookmarkkeeper', origin }, () => undefined)
    else if (ev.type === 'storage') onStorage.fire(ev.changes, ev.area)
    else if (ev.type === 'bookmarks') (bookmarks.onChanged as ReturnType<typeof event>).fire('', {})
  })

  // ---- 跨域 fetch 交给主进程
  const nativeFetch = window.fetch.bind(window)
  const NULL_BODY = [101, 103, 204, 205, 304]
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init)
    const u = new URL(req.url)
    if (u.origin === origin || (u.protocol !== 'http:' && u.protocol !== 'https:')) return nativeFetch(input, init)
    if (req.signal.aborted) throw new DOMException('The user aborted a request.', 'AbortError')
    let body: string | undefined
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const bytes = new Uint8Array(await req.arrayBuffer())
      let s = ''
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      body = btoa(s)
    }
    const id = Math.random().toString(36).slice(2) + Date.now().toString(36)
    type Res = { error?: string; status: number; statusText: string; headers: [string, string][]; body: string }
    const res = await new Promise<Res>((resolve, reject) => {
      const onAbort = () => {
        bridge.abort(id)
        reject(new DOMException('The user aborted a request.', 'AbortError'))
      }
      req.signal.addEventListener('abort', onAbort, { once: true })
      bridge
        .fetch({ id, url: req.url, method: req.method, headers: [...req.headers], body, redirect: req.redirect, credentials: req.credentials })
        .then((r) => resolve(r as Res), reject)
        .finally(() => req.signal.removeEventListener('abort', onAbort))
    })
    if (res.error) throw res.error === 'abort' ? new DOMException('The user aborted a request.', 'AbortError') : new TypeError('Failed to fetch')
    const bin = atob(res.body)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new Response(NULL_BODY.includes(res.status) ? null : bytes, { status: res.status, statusText: res.statusText, headers: res.headers })
  }
}
