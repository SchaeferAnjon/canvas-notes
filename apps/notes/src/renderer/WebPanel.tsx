import { Codicon, type CodiconName } from '@cn/design'
import { useKeepPopsInside } from './shell/keep-inside'
import { revealLeft } from './shell/tab-scroll'
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react'
import type { Clip } from '../shared/api'
import { isExtUrl, type NewTabInfo } from '../shared/bookmarkkeeper'
import type { Bookmark } from '../shared/web-api'
import { decodeUrl, toUrl } from './url'
import { Favicon } from './web/favicons'
import { ActionButtons } from './web/ActionButtons'
import { BookmarksBar } from './web/BookmarksBar'
import { ExtensionsPanel } from './web/ExtensionsPanel'
import { setCurrentPage } from './web/image-drop'
import { LibraryPanel } from './web/LibraryPanel'
import { PluginButtons, PluginPopup, usePageMenus, usePluginMenu, usePluginOn } from './plugins'
import { moveWebItem, toggleWebHidden, WEB_LOCKED, webMenuOrder } from '../shared/commands'
import { updateCmds, useCmds } from './search/cmd-store'
import type { WebPage } from './plugins/types'
import { setWebHost } from './plugins/host'
import { clipSuffix } from './plugins/translate/shared'
import { ProfileMenu } from './web/ProfileMenu'
import { activate, closeTab, followOwner, loadWebTabs, newTabId, openOrSwitch, openTab, saveWebTabs, updateTab, type WebTabs } from './web/web-tabs'
import { type NavState, WebView, type WebviewEl } from './web/WebView'
import { syncExtTheme } from './web/ext-theme'
import { onPageOutside } from './web/page-outside'
import './web/web.css'
import { videoOf } from '../shared/video'
import { useVideoKeys } from './video/keys'
import { setVideoHost } from './video/store'
import { VideoStrip } from './video/VideoStrip'
import { AiActLayer } from './ai-act'

export type ClipMode = { mode: 'inbox' | 'doc'; target?: string }

export { toUrl }

export const errText = (e: unknown) => String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** 开着的弹层：「⋯」菜单、从它打开的三个面板、星星的书签小卡；内置插件的弹窗是 plugin:<id> */
type Menu = null | 'more' | 'star' | 'login' | 'library' | 'extensions' | `plugin:${string}`

/** 书签管家插件的 id（它的弹窗由地址栏的星星开） */
const BOOKMARKS = 'bookmarks'

/**
 * 右栏网页：多个网页标签（⌘T 新建、⌘W 关当前），地址栏、书签栏、插件按钮、整页剪藏。
 * 按钮分两组：标签条右边只管标签和右栏（移到中间、收起）；地址栏里是这一页的开关（双语翻译、星星），右边是剪藏、固定的 Chrome 插件按钮和「⋯」。
 * 书签只有地址栏的星星一个入口；不常用的（书签和历史、导入 Chrome 登录、插件）在「⋯」里。
 * 新开的网页标签显示 BookmarkKeeper（用户自己的开源插件）原样的新标签页：书签管家开着、找到了插件文件时；
 * 它是一个 cn-ext:// 的网页，接口由主进程补（main/web/bookmarkkeeper/）。网页标签的 url 是 http(s) 网页或插件页面，空的是还没载入的新标签页。
 * 一直挂着（右栏切到历史 / AI 时只是藏起来），网页不会重新载入。
 */
export function WebPanel(props: {
  hidden: boolean
  /** 当前的中间栏标签：右栏跟着标签走，每个标签记住自己上次看的网页 */
  owner: string | null
  clipMode: ClipMode
  /** 别处要开一个网页（⌘K 里打的网址）：seq 变了就开一个新标签 */
  openRequest: { url: string; seq: number; reuse?: string } | null
  onShow(): void
  onUrl(url: string | null): void
  onClip(c: Clip): void
  onNotice(t: string): void
  onClose(): void
  /** 在中间栏开成宽标签 */
  onOpenWide(url: string, title: string): void
  /** 标题栏的「移到中间」调这里：右栏把当前网页开成中间的宽标签 */
  moveToCenter: React.MutableRefObject<(() => void) | null>
  /** 中间栏开着的宽网页标签（新标签页的「打开的标签」里也列出来） */
  wideTabs: { id: string; url: string; title?: string }[]
  onActivateWide(id: string): void
  onCloseWide(id: string): void
  onOpenNote(path: string): void
  /** 打开设置 · 插件 */
  onPluginSettings(): void
  /** ⌘W 在右栏网页这一格（App 认的当前栏）：关当前网页标签 */
  closeActive: React.MutableRefObject<(() => void) | null>
  /** 用户关了一个网页标签（×、⌘W）：App 在底栏说一句，undo 放回原处；last：关的是最后一个，网页这格收起了 */
  onClosedTab(c: { title: string; last: boolean; undo(): void }): void
}) {
  const [st, setSt] = useState<WebTabs>(loadWebTabs)
  const views = useRef(new Map<string, WebviewEl>())
  /** 标签 id → 它的 webContents id */
  const [wcIds, setWcIds] = useState<Record<string, number>>({})
  /** 主进程等着的新标签：标签 id → 请求号 */
  const pending = useRef(new Map<string, number>())
  const [nav, setNav] = useState<Record<string, NavState>>({})
  const [address, setAddress] = useState('')
  /**
   * 地址栏回车后、网页还没真去到那里的标签：标签 id → 要去的网址和等没等到它开始载入。
   * 第一次去网站时要等拦广告规则（最多 3 秒），这期间网页那边什么事件都没有：地址栏留着这个网址、重新载入的图标转着
   */
  const [going, setGoing] = useState<Record<string, { url: string; started: boolean }>>({})
  /** 地址框有焦点时显示完整网址 */
  const [addrFocus, setAddrFocus] = useState(false)
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [menu, setMenu] = useState<Menu>(null)
  const [importing, setImporting] = useState(false)
  const [clipping, setClipping] = useState(false)
  const [clipped, setClipped] = useState<{ path: string; undone?: boolean; extra?: string } | null>(null)
  const addr = useRef<HTMLInputElement>(null)
  const root = useRef<HTMLElement>(null)
  /** 网页叠放的那一格：AI 在网页里动手时外圈画在它上面 */
  const stack = useRef<HTMLDivElement>(null)
  useKeepPopsInside(root)
  const cb = useRef(props)
  cb.current = props

  const active = st.tabs.find((t) => t.id === st.active) ?? null
  const activeNav = active ? nav[active.id] : undefined
  const activeGoing = active ? going[active.id] : undefined
  const activeWc = active ? wcIds[active.id] : undefined
  /** 当前的 http(s) 网页（新标签页、插件页面不算）：星星、剪藏、移到中间、AI、插件都只管它 */
  const webUrl = active && /^https?:/.test(active.url) ? active.url : ''
  const page = useMemo(() => (webUrl && activeWc !== undefined ? { wcId: activeWc, url: webUrl, title: active!.title } : null), [webUrl, active?.title, activeWc])
  const keeperOn = usePluginOn(BOOKMARKS)
  const [newtab, setNewtab] = useState<NewTabInfo | null>(null)
  useEffect(() => void window.cnWeb.newtab().then(setNewtab), [])
  useEffect(() => syncExtTheme(), [])
  /** 新网页标签载入的页面：书签管家关着、没找到插件时没有（显示一句说明） */
  const newtabUrl = keeperOn ? (newtab?.url ?? null) : null
  /** 网页标签实际要载入的地址 */
  const srcOf = (t: { url: string }) => t.url || newtabUrl
  // 右栏开着却一个网页标签也没有（第一次打开、关掉了最后一个）：开一个新标签页，和以前直接显示书签首页一样
  // （别处正要开一个网址时不开：比如「放回右栏」，不然多一个空的新网页）
  const handledOpen = useRef<number | null>(null)
  useEffect(() => {
    const opening = !!props.openRequest && props.openRequest.seq !== handledOpen.current
    if (!props.hidden && newtabUrl && !st.tabs.length && !opening) setSt((s) => (s.tabs.length ? s : openTab(s, '', { owner: cb.current.owner })))
  }, [props.hidden, newtabUrl, st.tabs.length])
  const pluginPopup = menu?.startsWith('plugin:') ? menu.slice(7) : null

  useEffect(() => saveWebTabs(st), [st])
  useEffect(() => {
    const load = () => void window.cnWeb.bookmarks().then(setBookmarks)
    load()
    // 书签管家、导入改了书签：书签栏和星星跟着变
    return window.cnWeb.onBookmarksChanged(load)
  }, [])

  // 换了中间栏的标签：它上次看的网页还开着就切过去
  useEffect(() => setSt((s) => followOwner(s, props.owner)), [props.owner])

  // 当前网页换了：地址栏、AI 看得到的网址、插件的「当前标签」、拖图片的来源
  // 地址栏里打过字时，网页那边的载入、跳转都不改地址栏，像 Chrome；换了标签才换。点进去还没打字时照常跟上，
  // 换完重新全选——不然值被换掉、全选没了、光标跑到末尾，接着打的字就接在旧网址后面（「…/web/shelfhttp://…」）
  const addrEdited = useRef(false)
  const shownTab = useRef<string | null>(null)
  useEffect(() => {
    // 还没有标签时打的字（刚打开右栏，自己开的新标签页随后才出来）也算同一个
    const sameTab = shownTab.current === null || shownTab.current === (active?.id ?? null)
    shownTab.current = active?.id ?? null
    const focused = document.activeElement === addr.current
    // 打过字（或还没有标签时就在打）才不冲掉；点进去还没打字时照常跟上网页，换完重新全选，接着打的字替换它
    const typing = sameTab && focused && (addrEdited.current || (!webUrl && !!addr.current?.value))
    if (!typing) {
      const next = webUrl ? decodeUrl(webUrl) : activeGoing ? decodeUrl(activeGoing.url) : ''
      setAddress(next)
      if (focused && addr.current) {
        addr.current.value = next
        addr.current.select()
      }
    }
    cb.current.onUrl(webUrl || null)
    setCurrentPage(webUrl ? { url: webUrl, title: active!.title } : null)
  }, [active?.id, webUrl, active?.title, activeGoing?.url])

  // 开着哪些网页标签告诉主进程：BookmarkKeeper 新标签页的「打开的标签」、关掉、切过去都按这个
  const sentTabs = useRef('')
  useEffect(() => {
    const list = [
      ...st.tabs.map((t) => ({ id: t.id, url: srcOf(t) ?? '', title: t.title, active: t.id === st.active, ...(wcIds[t.id] !== undefined ? { wcId: wcIds[t.id] } : {}) })),
      ...props.wideTabs.map((t) => ({ id: `wide:${t.id}`, url: t.url, title: t.title ?? '', active: false })),
    ]
    const key = JSON.stringify(list)
    if (key === sentTabs.current) return
    sentTabs.current = key
    window.cnWeb.setTabs(list)
  })
  useEffect(() => {
    if (activeWc !== undefined && !props.hidden) void window.cnWeb.setActiveTab(activeWc)
  }, [activeWc, props.hidden])

  useEffect(() => {
    const r = props.openRequest
    if (!r) return
    handledOpen.current = r.seq
    setSt((s) => openOrSwitch(s, r.url, r.reuse, cb.current.owner))
  }, [props.openRequest?.seq])

  function newTab(focus = true) {
    cb.current.onShow()
    setSt((s) => openTab(s, '', { owner: cb.current.owner }))
    if (focus) setTimeout(() => addr.current?.focus(), 0)
  }

  function close(id: string) {
    views.current.delete(id)
    setWcIds(({ [id]: _, ...rest }) => rest)
    setSt((s) => closeTab(s, id))
  }

  /**
   * 用户关一个网页标签（×、⌘W，CN-98 方向 A）：最后一个关掉，网页这一格收起（同 Chrome、Safari 关最后一个标签）；
   * App 在底栏说一句，「撤回」把它放回原来的位置（网页重新载入）
   */
  function closeByUser(id: string) {
    const s = stRef.current
    const i = s.tabs.findIndex((t) => t.id === id)
    const tab = s.tabs[i]
    if (!tab) return
    const last = s.tabs.length === 1
    const title = (!tab.url || tab.url === newtabUrl ? '' : tab.title) || (/^https?:/.test(tab.url) ? hostOf(tab.url) : '新网页')
    close(id)
    if (last) cb.current.onClose()
    cb.current.onClosedTab({
      title,
      last,
      undo: () =>
        setSt((cur) => {
          if (cur.tabs.some((t) => t.id === tab.id)) return activate(cur, tab.id, cb.current.owner)
          const tabs = [...cur.tabs.slice(0, i), tab, ...cur.tabs.slice(i)]
          return activate({ ...cur, tabs }, tab.id, cb.current.owner)
        }),
    })
  }
  props.closeActive.current = () => {
    const cur = stRef.current.active
    if (cur) closeByUser(cur)
  }

  // 主进程转过来的：新窗口链接 / 插件开标签、插件切换关闭标签、网页焦点时的快捷键
  useEffect(() => {
    const offOpen = window.cnWeb.onOpenTab(({ url, reqId, background }) => {
      const id = newTabId()
      if (reqId !== undefined) pending.current.set(id, reqId)
      if (!background) cb.current.onShow()
      setSt((s) => openTab(s, url, { id, background: !!background, owner: cb.current.owner }))
    })
    const tabOf = (wc: number) => Object.entries(wcIdsRef.current).find(([, v]) => v === wc)?.[0]
    const offCmd = window.cnWeb.onTabCommand((cmd) => {
      if (cmd.type === 'show') return cb.current.onShow()
      const id = 'tabId' in cmd ? cmd.tabId : tabOf(cmd.webContentsId)
      if (!id) return
      if (id.startsWith('wide:')) {
        if (cmd.type === 'close') cb.current.onCloseWide(id.slice(5))
        else if (cmd.type === 'select') cb.current.onActivateWide(id.slice(5))
        return
      }
      if (cmd.type === 'close') close(id)
      else if (cmd.type === 'navigate') views.current.get(id)?.go(cmd.url)
      else {
        cb.current.onShow()
        setSt((s) => activate(s, id, cb.current.owner))
      }
    })
    const offKey = window.cnWeb.onKey((k, wc) => {
      const id = tabOf(wc)
      if (!id) return
      if (k === 't') newTab()
      else if (k === 'w') closeRef.current(id)
      else addr.current?.focus()
    })
    // 焦点在右栏（地址栏、标签条）时的 ⌘T、⌘W、⌘L；网页里的按键由主进程转过来
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.metaKey || e.altKey || e.ctrlKey) return
      const inside = !!root.current && root.current.contains(document.activeElement)
      if (e.key === 't') {
        e.preventDefault()
        newTab()
      } else if (inside && e.key === 'w') {
        e.preventDefault()
        e.stopImmediatePropagation()
        const cur = stRef.current.active
        if (cur) closeRef.current(cur)
      } else if (inside && e.key === 'l') {
        e.preventDefault()
        addr.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      offOpen()
      offCmd()
      offKey()
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [])
  const wcIdsRef = useRef(wcIds)
  wcIdsRef.current = wcIds
  /** 主进程转过来的按键、窗口上的 ⌘W 只挂一次：用这个拿到最新的 closeByUser */
  const closeRef = useRef(closeByUser)
  closeRef.current = closeByUser
  const stRef = useRef(st)
  stRef.current = st

  function go(input: string) {
    const u = toUrl(input)
    addrEdited.current = false
    setAddress(decodeUrl(u))
    const w = active ? views.current.get(active.id) : undefined
    if (active && w) setGoing((g) => ({ ...g, [active.id]: { url: u, started: false } }))
    if (w) w.go(u)
    else if (active) setSt((s) => updateTab(s, active.id, { url: u, title: '' }))
    else setSt((s) => openTab(s, u, { owner: cb.current.owner }))
    cb.current.onShow()
  }

  async function doImport(id: string) {
    setMenu(null)
    setImporting(true)
    try {
      const r = await window.cn.importChrome(id)
      props.onNotice(`导入了${r.imported}个登录信息${r.expired ? `，${r.expired}个已过期没导` : ''}。网页重新载入后就是登录状态。`)
      if (active) views.current.get(active.id)?.reload()
    } catch (e) {
      props.onNotice(errText(e))
    } finally {
      setImporting(false)
    }
  }

  async function clipPage() {
    setClipping(true)
    try {
      const { path } = await window.cn.clipCurrentPage({ webUrl: webUrl || null })
      setClipped({ path, extra: clipSuffix(page) })
    } catch (e) {
      props.onNotice(errText(e))
    } finally {
      setClipping(false)
    }
  }

  // ⌘K「剪藏这一页」：和引号按钮、⋯ 菜单同一套（底部提示带「打开」「撤回」）
  const clipRef = useRef(clipPage)
  clipRef.current = clipPage
  useEffect(() => {
    const on = (e: Event) => (e.preventDefault(), void clipRef.current())
    window.addEventListener(CLIP_PAGE_EVENT, on)
    return () => window.removeEventListener(CLIP_PAGE_EVENT, on)
  }, [])

  // 右栏所有弹层（⋯、翻译菜单、书签和历史、插件、选 Chrome 用户、书签小卡）都在这一处收起：
  // 点软件里弹层外面、按 Esc；点网页正文、在网页里按 Esc（网页预加载报过来，CN-43）
  useEffect(() => {
    if (!menu) return
    const onDown = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest('.right.web .imp, .right.web .addr .star')) setMenu(null)
    }
    // 书签小卡里自己的右键菜单先收（它 preventDefault 了这一下）
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !e.defaultPrevented && setMenu(null)
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    const offPage = onPageOutside(() => setMenu(null))
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
      offPage()
    }
  }, [menu])

  useEffect(() => {
    if (!clipped) return
    const t = setTimeout(() => setClipped(null), 10_000)
    return () => clearTimeout(t)
  }, [clipped])

  const starred = useMemo(() => (webUrl ? bookmarks.find((b) => b.url === webUrl) : undefined), [bookmarks, webUrl])

  const keeperOpen = menu === 'star'

  /**
   * 地址栏的星星：书签管家开着时像 Chrome，没收藏的先收藏，再在星星下面开书签小卡（改标题、标签、备注、文件夹，删）；
   * 书签管家关着时就是加 / 取消书签
   */
  async function clickStar() {
    if (!active || !webUrl) return
    try {
      if (keeperOn) {
        // 弹窗开着：收藏过的点星星是收起；刚在弹窗里删掉的，点星星是再收藏上
        if (keeperOpen && starred) return setMenu(null)
        if (!starred) setBookmarks(await window.cnWeb.addBookmark({ title: active.title || active.url, url: active.url }))
        setMenu('star')
      } else setBookmarks(starred ? await window.cnWeb.removeBookmark(starred.id) : await window.cnWeb.addBookmark({ title: active.title || active.url, url: active.url }))
    } catch (e) {
      props.onNotice(errText(e))
    }
  }

  /** 在中间栏大屏看：网页挪过去，右栏不留空页；右栏没有别的网页了就收起 */
  function openWide() {
    if (!active || !webUrl) return
    props.onOpenWide(active.url, active.title)
    const left = stRef.current.tabs.length - 1
    close(active.id)
    if (left === 0) props.onClose()
  }

  // 标签多了横着滚：当前标签整个露着（换标签、开关标签、改标题时，右栏被窗口挤窄时也是；同中间标签条的 revealLeft）
  const tabList = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = tabList.current
    if (!el) return
    const reveal = () => {
      const tabs = [...el.querySelectorAll<HTMLElement>(':scope > .tab')]
      const i = tabs.findIndex((t) => t.classList.contains('on'))
      if (i < 0) return
      const r = el.getBoundingClientRect()
      const boxes = tabs.map((t) => {
        const b = t.getBoundingClientRect()
        return { left: b.left - r.left + el.scrollLeft, width: b.width }
      })
      const next = revealLeft(el.scrollLeft, el.clientWidth, boxes, i)
      if (next !== Math.round(el.scrollLeft)) el.scrollLeft = next
    }
    reveal()
    const ro = new ResizeObserver(reveal)
    ro.observe(el)
    return () => ro.disconnect()
  }, [st.active, st.tabs.length, active?.title])

  const openWideRef = useRef(openWide)
  openWideRef.current = openWide
  useEffect(() => {
    const slot = props.moveToCenter
    slot.current = () => openWideRef.current()
    return () => void (slot.current = null)
  }, [])

  const openUrl = (u: string, newOne: boolean) => {
    if (newOne || !active) setSt((s) => openTab(s, u, { owner: cb.current.owner }))
    else go(u)
    setMenu(null)
  }

  // 内置插件借右栏的本事：给网页发命令、开弹窗、开网址
  const pageRef = useRef(page)
  pageRef.current = page
  const activeRef = useRef(active?.id ?? null)
  activeRef.current = active?.id ?? null
  const hiddenRef = useRef(props.hidden)
  hiddenRef.current = props.hidden
  const openUrlRef = useRef(openUrl)
  openUrlRef.current = openUrl
  useEffect(() => {
    setWebHost({
      page: () => pageRef.current,
      visible: () => !hiddenRef.current,
      command(wcId, pluginId, cmd, arg) {
        const id = Object.entries(wcIdsRef.current).find(([, v]) => v === wcId)?.[0]
        if (id) views.current.get(id)?.send('plugins:page-cmd', pluginId, cmd, arg)
      },
      show: () => cb.current.onShow(),
      openPopup: (id) => setMenu(id ? `plugin:${id}` : null),
      open: (u, newOne) => openUrlRef.current(u, newOne),
      notice: (t) => cb.current.onNotice(t),
      openSettings: () => cb.current.onPluginSettings(),
      openNote: (p) => cb.current.onOpenNote(p),
      view: () => (activeRef.current ? (views.current.get(activeRef.current) ?? null) : null),
    })
    return () => setWebHost(null)
  }, [page, props.hidden])
  // 视频条借右栏的本事：给视频页发命令、量网页的位置、开带时间的视频链接
  useVideoKeys()
  useEffect(() => {
    setVideoHost({
      cmd(wcId, cmd, arg) {
        const id = Object.entries(wcIdsRef.current).find(([, v]) => v === wcId)?.[0]
        if (id) views.current.get(id)?.send('video:cmd', cmd, arg)
      },
      webviewRect(wcId) {
        const id = Object.entries(wcIdsRef.current).find(([, v]) => v === wcId)?.[0]
        return (id && views.current.get(id)?.getBoundingClientRect()) || null
      },
      openAt(url, t, still) {
        const ref = videoOf(url)
        cb.current.onShow()
        const hit = ref && stRef.current.tabs.find((x) => videoOf(x.url)?.key === ref.key)
        if (hit) {
          setSt((s) => activate(s, hit.id, cb.current.owner))
          const wc = wcIdsRef.current[hit.id]
          if (t !== null && wc !== undefined) setTimeout(() => views.current.get(hit.id)?.send('video:cmd', still ? 'still' : 'seek', t), 50)
          return
        }
        const u = new URL(url)
        if (t !== null && ref?.site === 'youtube') u.searchParams.set('t', `${Math.floor(t)}s`)
        else if (t !== null) u.searchParams.set('t', String(Math.floor(t)))
        setSt((s) => openTab(s, u.toString(), { owner: cb.current.owner }))
      },
      activeWc: () => pageRef.current?.wcId ?? null,
      focus(wcId) {
        const id = Object.entries(wcIdsRef.current).find(([, v]) => v === wcId)?.[0]
        if (id) views.current.get(id)?.focus()
      },
    })
    return () => setVideoHost(null)
  }, [])
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const el = root.current
    if (!el) return
    const ro = new ResizeObserver(() => setNarrow(el.getBoundingClientRect().width < 440))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  /** 书签小卡（「⋯ › 加书签」开的）贴在「⋯」下面，右边和它对齐（放不下就贴右栏右边） */
  const moreRef = useRef<HTMLButtonElement>(null)
  const cardPos = (): CSSProperties | undefined => {
    const st = moreRef.current?.getBoundingClientRect()
    const box = root.current?.getBoundingClientRect()
    if (!st || !box) return undefined
    const right = Math.max(8, box.right - st.right - 8)
    // 小卡上的箭头对准星星：箭头 12 宽，离小卡右边多远
    return { top: st.bottom - box.top + 8, right, ['--arrow-right' as string]: `${box.right - right - (st.left + st.width / 2) - 6}px` }
  }
  const https = webUrl.startsWith('https:')

  return (
    <aside className="right web" aria-label="网页" hidden={props.hidden} ref={root}>
      <div className="tabs wtabs" role="tablist" aria-label="网页标签">
        <div className="wtlist" ref={tabList}>
          {st.tabs.map((t) => (
            <div key={t.id} className={'tab' + (t.id === st.active ? ' on' : '')} role="tab" aria-selected={t.id === st.active} title={t.url ? decodeUrl(t.url) : '新网页'}>
              <button className="tl" onClick={() => setSt((s) => activate(s, t.id, cb.current.owner))}>
                {/^https?:/.test(t.url) ? <Favicon url={t.url} size={14} /> : <Codicon name="globe" size={13} />}
                <span className="truncate">{(!t.url || t.url === newtabUrl ? (going[t.id] ? hostOf(going[t.id]!.url) : '') : t.title) || (/^https?:/.test(t.url) ? hostOf(t.url) : '新网页')}</span>
              </button>
              <button className="x" aria-label="关闭网页标签" title="关闭网页标签 ⌘W" onClick={() => closeByUser(t.id)}>
                <Codicon name="close" size={12} />
              </button>
            </div>
          ))}
        </div>
        {/* + 固定在标签条最右，标签多了横着滚它也不动；收起右栏用竖条上的「网页」、标题栏最右或 ⌥⌘\（「移到中间」在标题栏） */}
        <button className="iconbtn wnew" aria-label="新网页" data-tip="新网页（书签管家的新标签页）" data-key="⌘T" data-side="below-left" onClick={() => newTab()}>
          <Codicon name="add" size={14} />
        </button>
      </div>
      <div className="rhead">
        <button className="iconbtn" aria-label="后退" title="后退" disabled={!activeNav?.back} onClick={() => active && views.current.get(active.id)?.goBack()}>
          <Codicon name="arrow-left" size={14} />
        </button>
        <button className="iconbtn" aria-label="前进" title="前进" disabled={!activeNav?.forward} onClick={() => active && views.current.get(active.id)?.goForward()}>
          <Codicon name="arrow-right" size={14} />
        </button>
        <button className="iconbtn" aria-label="重新载入" title="重新载入" disabled={!active || !srcOf(active)} onClick={() => active && views.current.get(active.id)?.reload()}>
          <Codicon name="refresh" size={14} className={activeNav?.loading || activeGoing ? 'spin' : ''} />
        </button>
        <form
          className="addr"
          onSubmit={(e) => {
            e.preventDefault()
            if (!address.trim()) return
            go(address)
            addr.current?.blur()
          }}
        >
          <Codicon name={https ? 'lock' : 'globe'} size={13} />
          {/* 不在打字时只显示域名和路径（不写 http://），右栏 340 宽里多看得到几个字；点进去是完整网址、全选 */}
          <input
            ref={addr}
            aria-label="网址"
            placeholder="输入网址或要搜的词"
            value={addrFocus ? address : address.replace(/^https?:\/\//, '')}
            onChange={(e) => ((addrEdited.current = true), setAddress(e.target.value))}
            onKeyDown={(e) => {
              // esc：打的字不要了，还原成正在看的网址并全选（和浏览器一样）；没打字时再按 esc 离开地址栏
              if (e.key !== 'Escape' || e.nativeEvent.isComposing) return
              e.preventDefault()
              const el = e.currentTarget
              if (!addrEdited.current) return el.blur()
              addrEdited.current = false
              const now = webUrl ? decodeUrl(webUrl) : ''
              el.value = now
              setAddress(now)
              el.select()
            }}
            onFocus={(e) => {
              // 先当场换成完整网址再全选，React 重画时值不变，选区和接着打的字都不会被冲掉
              e.currentTarget.value = address
              e.currentTarget.select()
              setAddrFocus(true)
            }}
            onBlur={() => {
              // 没打字就离开：补回现在的网址（有焦点时没跟着网页更新）
              if (!addrEdited.current) setAddress(webUrl ? decodeUrl(webUrl) : '')
              addrEdited.current = false
              setAddrFocus(false)
            }}
            // 网址放不下时末尾是省略号（.addr input），悬停用软件自己的提示看完整网址；打字时不提示
            data-side="below"
            onMouseOver={(e) => {
              const el = e.currentTarget
              if (!addrFocus && address && el.scrollWidth > el.clientWidth) el.dataset.tip = address
              else delete el.dataset.tip
            }}
          />
          {webUrl && (
            <span className="addr-acts" role="toolbar" aria-label="这一页">
              <PluginButtons slot="address" page={page} popup={pluginPopup} onPopup={(id) => setMenu(id ? `plugin:${id}` : null)} />
            </span>
          )}
        </form>
        <button className="iconbtn" aria-label="剪藏这一页" title="剪藏这一页：整页进收件箱" disabled={!webUrl || clipping} onClick={() => void clipPage()}>
          <Codicon name="quote" size={14} className={clipping ? 'spin' : ''} />
        </button>
        <ActionButtons tabId={activeWc ?? -1}>
          <PluginButtons slot="toolbar" page={page} popup={pluginPopup} onPopup={(id) => setMenu(id ? `plugin:${id}` : null)} />
        </ActionButtons>
        <div className="imp">
          <button
            ref={moreRef}
            className={'iconbtn' + (menu === 'more' || menu === 'library' || menu === 'extensions' || menu === 'login' || keeperOpen ? ' on' : '')}
            aria-label="更多"
            title="更多：剪藏这一页、稍后再看、双语翻译、书签和历史、插件、导入 Chrome 登录"
            aria-haspopup="menu"
            aria-expanded={menu === 'more'}
            onClick={() => setMenu(menu === 'more' ? null : 'more')}
          >
            <Codicon name={importing ? 'sign-in' : 'ellipsis'} size={16} className={importing ? 'spin' : ''} />
          </button>
          {menu === 'more' && (
            <MoreMenu
              star={webUrl ? { on: !!starred, keeper: keeperOn } : null}
              onStar={() => (setMenu(null), void clickStar())}
              onClip={webUrl && !clipping ? () => (setMenu(null), void clipPage()) : null}
              page={page}
              importing={importing}
              onClose={() => setMenu(null)}
              onNewTab={() => (setMenu(null), newTab())}
              onPick={(m) => setMenu(m)}
              onNotice={props.onNotice}
            />
          )}
          {menu === 'library' && <LibraryPanel bookmarks={bookmarks} onBookmarks={setBookmarks} onOpen={openUrl} onNotice={props.onNotice} onClose={() => setMenu(null)} />}
          {menu === 'extensions' && (
            <ExtensionsPanel
              tabId={activeWc ?? -1}
              onNotice={props.onNotice}
              onClose={() => setMenu(null)}
              onReload={() => active && views.current.get(active.id)?.reload()}
              onPluginSettings={() => (setMenu(null), props.onPluginSettings())}
            />
          )}
          {menu === 'login' && <ProfileMenu label="选 Chrome 用户" title="导入哪个 Chrome 用户的登录？" onPick={(id) => void doImport(id)} onNotice={props.onNotice} onClose={() => setMenu(null)} />}
        </div>
      </div>
      {page && <VideoStrip wcId={page.wcId} narrow={narrow} />}
      {pluginPopup && <PluginPopup id={pluginPopup} page={page} mode="all" onClose={() => setMenu(null)} />}
      {menu === 'star' && <PluginPopup id={BOOKMARKS} page={page} mode="this-page" style={cardPos()} onClose={() => setMenu(null)} />}
      {/* 新标签页自己就是书签，那时不摆书签栏 */}
      {(webUrl || !newtabUrl) && <BookmarksBar bookmarks={bookmarks} onOpen={openUrl} />}
      {clipped && (
        <div className="wnote" role="status">
          {clipped.undone ? (
            <span>撤回了，收件箱里那篇删掉了</span>
          ) : (
            <>
              <span className="truncate">整页存进收件箱了：{clipped.path.split('/').pop()?.replace(/\.md$/, '')}
                {clipped.extra}
              </span>
              <button className="btn btn-sm" onClick={() => props.onOpenNote(clipped.path)}>
                打开
              </button>
              <button
                className="btn btn-sm btn-ghost"
                onClick={async () => {
                  try {
                    await window.cnWeb.undoClip(clipped.path)
                    setClipped({ ...clipped, undone: true })
                  } catch (e) {
                    props.onNotice(errText(e))
                  }
                }}
              >
                撤回
              </button>
            </>
          )}
        </div>
      )}
      <div className="rbody webbody">
        <div className="wstack" ref={stack}>
          {st.tabs.map((t) => {
            const src = srcOf(t)
            return src ? (
              <WebView
                key={t.id}
                initialUrl={src}
                visible={t.id === st.active}
                clipMode={props.clipMode}
                onRef={(el) => {
                  if (el) views.current.set(t.id, el)
                }}
                onAttach={(wc) => {
                  setWcIds((m) => ({ ...m, [t.id]: wc }))
                  const req = pending.current.get(t.id)
                  if (req !== undefined) {
                    pending.current.delete(t.id)
                    window.cnWeb.tabCreated(req, wc)
                  }
                }}
                onNav={(n) => {
                  setNav((m) => ({ ...m, [t.id]: n }))
                  // 真去到网页了，或者开始载入后又停了（没打开、取消了）：不再替它留着网址、转圈
                  setGoing((g) => {
                    const x = g[t.id]
                    if (!x) return g
                    if (!/^https?:/.test(n.url) && !(x.started && !n.loading)) return n.loading && !x.started ? { ...g, [t.id]: { ...x, started: true } } : g
                    const { [t.id]: _done, ...rest } = g
                    return rest
                  })
                  // 从新标签页（插件页面）跳到网页：标题先清掉，免得载不出来时还挂着「新标签页 · 书签管家」
                  if (/^https?:/.test(n.url) || isExtUrl(n.url))
                    setSt((s) => {
                      const was = s.tabs.find((x) => x.id === t.id)?.url ?? ''
                      return updateTab(s, t.id, { url: n.url, ...(n.url !== was && (!was || isExtUrl(was)) ? { title: '' } : {}) })
                    })
                }}
                onTitle={(title) => setSt((s) => updateTab(s, t.id, { title }))}
                onClip={props.onClip}
                menuHost={{
                  openTab: (u) => setSt((s) => openTab(s, u, { background: true, owner: cb.current.owner })),
                  openWide: (u, title) => cb.current.onOpenWide(u, title),
                  clipPage: () => void clipPage(),
                }}
              />
            ) : null
          })}
          {/* AI 在网页里动手：网页外圈和顶上提示条（指针、亮的那段、「✂ 剪成卡片」画在网页里，main/agent/web.ts） */}
          <AiActLayer area="web" host={stack} />
          {(!active || !srcOf(active)) && (
            <div className="webstart">
              <p>输入网址打开一个网页。选中一段文字，就能剪进笔记；网页里的图片能直接拖到白板上。</p>
              <p className="sub">
                {keeperOn && newtab && !newtab.url
                  ? '新网页标签本来显示书签管家（BookmarkKeeper）的新标签页，但软件自带的那份文件不在（安装包不完整，重装一次软件）。'
                  : '网站要登录的话，先点右上角「⋯」里的「导入Chrome登录」，把Chrome的登录状态导进来。'}
              </p>
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}

/** 「⋯」的四组（DESIGN.v3 9.3）：手上这一页 → 这个网站 → 书签 → 浏览器 */
const WM_GROUPS = ['page', 'site', 'bookmarks', 'browser'] as const
type WmGroup = (typeof WM_GROUPS)[number]

/** 「⋯」里的一项：身份（藏起、换顺序按它记）、调整时画的名字和图标、平时画的那颗按钮 */
interface WmItem {
  id: string
  group: WmGroup
  label: string
  icon: CodiconName
  node: React.ReactNode
}

/**
 * 地址栏右边「⋯」菜单（DESIGN.v3 9.3，cmdk 方案 A）：这一页（剪藏这一页、稍后再看、双语翻译）、这个网站（不拦这个网站的广告）、
 * 书签（加书签、书签首页、书签和历史）、浏览器（插件、导入 Chrome 登录），最下面「调整这个菜单…」：点眼睛藏起不用的、在组里拖着换顺序，
 * 「插件…」一直在。藏起的和顺序存在 .canvas-notes/命令.json。↑↓ 选，↵ 执行，esc 关。
 */
function MoreMenu(props: {
  page: WebPage | null
  /** 这一页收藏了没有；keeper：书签管家开着（收藏后开小卡改标签和备注） */
  star: { on: boolean; keeper: boolean } | null
  onStar(): void
  /** 剪藏这一页（和地址栏旁的引号按钮、⌘K「剪藏这一页」同一件事）；不是网页时灰着 */
  onClip: (() => void) | null
  importing: boolean
  onClose(): void
  onNewTab(): void
  onPick(m: 'library' | 'extensions' | 'login'): void
  onNotice(t: string): void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const cfg = useCmds()
  const pluginItems = usePluginMenu(props.page)
  const pageMenus = usePageMenus()
  /** 「调整这个菜单…」：每行出眼睛和把手 */
  const [edit, setEdit] = useState(false)
  const [drag, setDrag] = useState<{ id: string; group: WmGroup; before: string | null | undefined; line: { left: number; top: number; width: number } | null } | null>(null)
  useEffect(() => ref.current?.querySelector<HTMLButtonElement>('[role^=menuitem]:not(:disabled)')?.focus(), [edit])
  const onKey = (e: React.KeyboardEvent) => {
    const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button[role^=menuitem]:not(:disabled), .wm-row .eye') ?? [])]
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      props.onClose()
    }
  }
  const item = (label: string, icon: CodiconName, run: () => void, hint?: string, disabled?: boolean) => (
    <button key={label} role="menuitem" disabled={disabled} onClick={run}>
      <Codicon name={icon} size={14} />
      <span className="mlabel">{label}</span>
      {hint && <kbd>{hint}</kbd>}
    </button>
  )
  const all: WmItem[] = [
    { id: 'clip', group: 'page', label: '剪藏这一页', icon: 'quote', node: item('剪藏这一页', 'quote', () => props.onClip?.(), undefined, !props.onClip) },
    ...pageMenus.map((m): WmItem => ({ id: m.id, group: m.group, label: m.label, icon: m.icon, node: <m.Item key={m.id} page={props.page} onDone={props.onClose} onNotice={props.onNotice} /> })),
    ...pluginItems.map((p): WmItem => ({ id: p.id, group: 'page', label: p.label, icon: p.icon, node: item(p.label, p.icon, () => (props.onClose(), p.run()), p.keys, !props.page) })),
    ...(props.star
      ? [
          {
            id: 'star',
            group: 'bookmarks' as const,
            label: '加书签',
            icon: 'star-empty' as const,
            // 书签星号收在这里（DESIGN.v3 1.5：地址栏只留翻译；网页右上按钮别乱）
            node: (
              <button key="star" role="menuitemcheckbox" aria-checked={props.star.on} onClick={props.onStar}>
                <Codicon name={props.star.on ? 'star-full' : 'star-empty'} size={14} />
                <span className="mlabel">{props.star.on ? (props.star.keeper ? '已收藏 · 改标签和备注' : '取消书签') : '加书签'}</span>
              </button>
            ),
          },
        ]
      : []),
    { id: 'newtab', group: 'bookmarks', label: '书签首页', icon: 'layout', node: item('书签首页', 'layout', props.onNewTab, '⌘T') },
    { id: 'library', group: 'bookmarks', label: '书签和历史…', icon: 'bookmark', node: item('书签和历史…', 'bookmark', () => props.onPick('library')) },
    { id: WEB_LOCKED, group: 'browser', label: '插件…', icon: 'extensions', node: item('插件…', 'extensions', () => props.onPick('extensions')) },
    { id: 'login', group: 'browser', label: '导入Chrome登录…', icon: 'sign-in', node: item('导入Chrome登录…', 'sign-in', () => props.onPick('login'), undefined, props.importing) },
  ]
  const groups = WM_GROUPS.map((g) => {
    const mine = all.filter((x) => x.group === g)
    const order = webMenuOrder(cfg, g, mine.map((x) => x.id))
    return { g, items: order.map((id) => mine.find((x) => x.id === id)!) }
  })
  const hidden = new Set(cfg.web.hidden)

  // 调整时拖着换顺序：只在自己那一组里上下拖
  function startDrag(e: React.PointerEvent, id: string, group: WmGroup) {
    e.preventDefault()
    setDrag({ id, group, before: undefined, line: null })
    const ids = groups.find((x) => x.g === group)!.items.map((x) => x.id)
    let before: string | null | undefined
    const move = (ev: PointerEvent) => {
      before = undefined
      let line: { left: number; top: number; width: number } | null = null
      // 落点横线画在菜单里（菜单有磨砂，fixed 会跟着菜单走），坐标按菜单算
      const m = ref.current!.getBoundingClientRect()
      for (const el of ref.current?.querySelectorAll<HTMLElement>(`[data-wg="${group}"] [data-wi]`) ?? []) {
        const b = el.getBoundingClientRect()
        if (ev.clientY < b.top || ev.clientY > b.bottom) continue
        const after = ev.clientY > b.top + b.height / 2
        const rest = ids.filter((x) => x !== id)
        before = after ? (rest[rest.indexOf(el.dataset.wi!) + 1] ?? null) : el.dataset.wi!
        if (before === id) before = undefined
        line = { left: b.left - m.left + 8, width: b.width - 16, top: (after ? b.bottom : b.top) - m.top - 1 }
      }
      setDrag({ id, group, before, line })
    }
    const up = () => {
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', up)
      setDrag(null)
      if (before !== undefined) void updateCmds((c) => moveWebItem(c, group, ids, id, before ?? null))
    }
    addEventListener('pointermove', move)
    addEventListener('pointerup', up)
  }

  return (
    <div ref={ref} className={'menu wmore' + (edit ? ' editing' : '')} role="menu" aria-label="更多" onKeyDown={onKey}>
      {edit && <div className="wm-head">点眼睛藏起不用的，拖着在组里换顺序</div>}
      {groups.map(({ g, items }) => {
        const shown = edit ? items : items.filter((x) => !hidden.has(x.id))
        if (!shown.length) return null
        return (
          <div key={g} role="group" aria-label={{ page: '这一页', site: '这个网站', bookmarks: '书签', browser: '浏览器' }[g]} data-wg={g}>
            {shown.map((x) =>
              edit ? (
                <div key={x.id} className={'wm-row' + (hidden.has(x.id) ? ' dim' : '') + (x.id === WEB_LOCKED ? ' lock' : '') + (drag?.id === x.id ? ' dragging' : '')} data-wi={x.id} role="menuitem" aria-label={x.label}>
                  <span className="grip" aria-hidden onPointerDown={(e) => startDrag(e, x.id, g)}>
                    <Codicon name="gripper" size={12} />
                  </span>
                  <Codicon name={x.icon} size={14} />
                  <span className="mlabel">{x.label}</span>
                  <button
                    className="eye"
                    aria-label={x.id === WEB_LOCKED ? '一直在' : hidden.has(x.id) ? `放回「${x.label}」` : `藏起「${x.label}」`}
                    title={x.id === WEB_LOCKED ? '一直在：从这里回到调整' : hidden.has(x.id) ? '放回' : '藏起'}
                    onClick={() => x.id !== WEB_LOCKED && void updateCmds((c) => toggleWebHidden(c, x.id))}
                  >
                    <Codicon name={x.id === WEB_LOCKED ? 'lock' : hidden.has(x.id) ? 'eye-closed' : 'eye'} size={14} />
                  </button>
                </div>
              ) : (
                x.node
              ),
            )}
          </div>
        )
      })}
      {edit ? (
        <div className="wm-done">
          <button
            className="btn btn-sm btn-primary"
            onClick={() => {
              setEdit(false)
              const n = cfg.web.hidden.length
              props.onNotice(n ? `网页「⋯」里藏起了 ${n} 样` : '网页「⋯」还是全部都在')
            }}
          >
            完成
          </button>
        </div>
      ) : (
        <div role="group" aria-label="调整">
          {item('调整这个菜单…', 'edit', () => setEdit(true))}
        </div>
      )}
      {drag?.line && <div className="pal-dropline" style={{ left: drag.line.left, top: drag.line.top, width: drag.line.width }} />}
    </div>
  )
}

/** ⌘K「剪藏这一页」发给网页面板的事件（App.tsx） */
export const CLIP_PAGE_EVENT = 'cn:clip-page'

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
