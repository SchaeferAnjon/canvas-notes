import { useEffect, useLayoutEffect, useRef } from 'react'
import type { Clip } from '../../shared/api'
import { HOLD_POLICY } from '../../shared/web-api'
import type { ClipMode } from '../WebPanel'
import { pageReported } from '../plugins/host'
import { videoReported } from '../video/store'
import { noteFavicon } from './favicons'
import { dropWebDragAt, noteWebDrag } from './image-drop'
import { webReadIpc } from '../reading/web-bridge'
import { registerWebMenu, type WebMenuHost } from '../ctx/web-menu'
import { pageOutside } from './page-outside'
import { readPosIpc } from '../read-along/web'
import { type LogoEngine, useAiLogo } from '../engine-logo'

/** 恢复的标签用的网页设置：要用户在这个网页里动过才许出声自动播（和 Chrome 平常一样）；主进程按它认出这是恢复的标签 */
const HOLD_PREFS = `autoplayPolicy=${HOLD_POLICY}`

/** webview 元素上我们用到的方法 */
export interface WebviewEl extends HTMLElement {
  loadURL(url: string): Promise<void>
  getURL(): string
  getTitle(): string
  goBack(): void
  goForward(): void
  reload(): void
  canGoBack(): boolean
  canGoForward(): boolean
  send(channel: string, ...args: unknown[]): void
  executeJavaScript(code: string): Promise<unknown>
  getWebContentsId(): number
  focus(): void
  /** 换网址：网页还没载好（dom-ready 之前 loadURL 会抛错）就先记着，载好了再换（WebView 装上的） */
  go(url: string): void
}

export interface NavState {
  url: string
  back: boolean
  forward: boolean
  loading: boolean
}

/**
 * 一个网页（一个 <webview>）。src 只在第一次挂上时用，之后的跳转走 loadURL，不会因为重新渲染又载一遍。
 * 挂好后报 webContents 的 id（插件、整页剪藏、新标签要用）。
 */
export function WebView(props: {
  initialUrl: string
  visible: boolean
  /**
   * 重开软件时恢复的标签：网页里的视频不自己播、不出声，等用户在网页里点过（或软件的播放命令）才放开。
   * 只在挂上时看一次（webpreferences 属性只在 webview 挂上时生效）；主进程 did-attach-webview 认它（web/media-hold.ts）
   */
  hold?: boolean
  clipMode: ClipMode
  onRef(el: WebviewEl | null): void
  onAttach(webContentsId: number): void
  onNav(n: NavState): void
  onTitle(title: string): void
  onClip(c: Clip): void
  /** 网页里右键菜单的「在新标签打开」「在中间栏打开」「整页剪藏」在这个网页所在的地方怎么做 */
  menuHost: WebMenuHost
}) {
  const ref = useRef<WebviewEl | null>(null)
  const ready = useRef(false)
  const logosRef = useRef<{ chat: LogoEngine | null; translate: LogoEngine | null }>({ chat: null, translate: null })
  const cb = useRef(props)
  cb.current = props
  const first = useRef(props.initialUrl)
  /** dom-ready 之前要换的网址（刚开的新标签页里马上在地址栏打了网址） */
  const pendingUrl = useRef<string | null>(null)

  // 用 layout effect：webview 一插进页面就可能挂上，普通 effect 要等画完才跑，会漏掉 did-attach
  useLayoutEffect(() => {
    const w = ref.current!
    const nav = (loading: boolean) => {
      if (!ready.current) return
      cb.current.onNav({ url: w.getURL(), back: w.canGoBack(), forward: w.canGoForward(), loading })
    }
    // 报 webContents id：did-attach 时 webview 有时还拿不到 id（getWebContentsId 会抛错），那就等 dom-ready 再报；
    // 漏报的话这个标签对不上它的网页，插件按钮、剪藏、插件的「当前标签」都不灵
    let reported = false
    let offMenu = () => {}
    const onAttach = () => {
      if (reported) return
      let id: number
      try {
        id = w.getWebContentsId()
      } catch {
        return
      }
      reported = true
      cb.current.onAttach(id)
      offMenu = registerWebMenu(
        id,
        { url: () => w.getURL(), title: () => w.getTitle(), canGoBack: () => w.canGoBack(), canGoForward: () => w.canGoForward(), goBack: () => w.goBack(), goForward: () => w.goForward(), reload: () => w.reload(), rect: () => w.getBoundingClientRect() },
        () => cb.current.menuHost,
      )
    }
    const onReady = () => {
      onAttach()
      ready.current = true
      const next = pendingUrl.current
      pendingUrl.current = null
      if (next) void w.loadURL(next).catch(() => undefined)
      w.send('cn:mode', cb.current.clipMode)
      w.send('cn:ai-logo', logosRef.current)
      nav(false)
    }
    const onIpc = (e: Event) => {
      const { channel, args } = e as Event & { channel: string; args: unknown[] }
      if (channel === 'cn:clip') {
        const c = args[0] as Partial<Clip> | undefined
        if (!c || typeof c.text !== 'string' || typeof c.url !== 'string' || typeof c.title !== 'string' || !c.text.trim()) return
        cb.current.onClip({ text: c.text, url: c.url, title: c.title })
      } else if (channel === 'cn:drag') {
        const d = args[0] as { src?: unknown; alt?: unknown; url?: unknown; title?: unknown } | undefined
        if (typeof d?.src === 'string' && typeof d.url === 'string') noteWebDrag({ src: d.src, alt: String(d.alt ?? ''), url: d.url, title: String(d.title ?? '') })
      } else if (channel === 'cn:plugin') {
        // 网页里的内置插件报状态（比如双语开没开）
        pageReported(w.getWebContentsId(), args[0], args[1])
      } else if (channel === 'cn:video') {
        // 视频页报的：播到哪、框好了（video/store.ts）
        videoReported(w.getWebContentsId(), args[0])
      } else if (channel.startsWith('cn:read:')) {
        // 阅读视图要的正文、在网页上框好的一块（reading/web-bridge.ts）
        webReadIpc(w, channel, args)
      } else if (channel.startsWith('cn:readpos')) {
        // 读到哪（task-kbnc0）：读到的地方、人在网页里按了键、回到那段的结果（read-along/web.ts）
        readPosIpc(w.getWebContentsId(), channel, args)
      } else if (channel === 'cn:page-down' || channel === 'cn:page-esc') {
        pageOutside(channel === 'cn:page-down' ? 'down' : 'esc')
      } else if (channel === 'cn:dragend') {
        const p = args[0] as { x?: unknown; y?: unknown } | undefined
        const r = w.getBoundingClientRect()
        if (typeof p?.x === 'number' && typeof p.y === 'number') dropWebDragAt(r.left + p.x, r.top + p.y)
      }
    }
    const onTitle = (e: Event) => cb.current.onTitle((e as Event & { title: string }).title)
    // 网站小图标记下来，书签首页用
    const onFavicon = (e: Event) => noteFavicon(w.getURL(), (e as Event & { favicons: string[] }).favicons ?? [])
    const onStart = () => nav(true)
    const onStop = () => nav(false)
    const onNavEv = () => nav(false)
    w.addEventListener('did-attach', onAttach)
    w.addEventListener('dom-ready', onReady)
    w.addEventListener('did-navigate', onNavEv)
    w.addEventListener('did-navigate-in-page', onNavEv)
    w.addEventListener('did-start-loading', onStart)
    w.addEventListener('did-stop-loading', onStop)
    w.addEventListener('page-title-updated', onTitle)
    w.addEventListener('page-favicon-updated', onFavicon)
    w.addEventListener('ipc-message', onIpc)
    return () => {
      w.removeEventListener('did-attach', onAttach)
      w.removeEventListener('dom-ready', onReady)
      w.removeEventListener('did-navigate', onNavEv)
      w.removeEventListener('did-navigate-in-page', onNavEv)
      w.removeEventListener('did-start-loading', onStart)
      w.removeEventListener('did-stop-loading', onStop)
      w.removeEventListener('page-title-updated', onTitle)
      w.removeEventListener('page-favicon-updated', onFavicon)
      w.removeEventListener('ipc-message', onIpc)
      offMenu()
    }
  }, [])

  useEffect(() => {
    if (ready.current) ref.current?.send('cn:mode', props.clipMode)
  }, [props.clipMode.mode, props.clipMode.target])

  // 网页里画的「翻译」「讲解一下」用哪家的标志（preload/ai-logo.ts）：打开时和设置里换了都发一次
  const logos = { chat: useAiLogo('chat'), translate: useAiLogo('translate') }
  logosRef.current = logos
  useEffect(() => {
    if (ready.current) ref.current?.send('cn:ai-logo', logos)
  }, [logos.chat, logos.translate])

  return (
    <webview
      ref={(el) => {
        ref.current = el as WebviewEl | null
        if (ref.current)
          ref.current.go = (url) => {
            if (ready.current) void ref.current!.loadURL(url).catch(() => undefined)
            else pendingUrl.current = url
          }
        props.onRef(ref.current)
      }}
      className={props.visible ? 'on' : ''}
      src={first.current}
      partition="persist:web"
      webpreferences={props.hold ? HOLD_PREFS : undefined}
      // 新窗口链接要靠它才会交给主进程（再开成新标签）；React 不会把布尔值写成这个属性，所以给字符串
      {...({ allowpopups: 'true' } as object)}
    />
  )
}
