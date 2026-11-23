import { WebFind } from './find/WebFind'
import { Codicon, type CodiconName } from '@cn/design'
import { keyFor, useKeyHandler, useKeys } from './keys'
import { useKeepPopsInside } from './shell/keep-inside'
import { revealLeft } from './shell/tab-scroll'
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react'
import { isExtUrl, type NewTabInfo } from '../shared/bookmarkkeeper'
import type { Bookmark } from '../shared/web-api'
import { decodeUrl, toUrl } from './url'
import { Favicon } from './web/favicons'
import { ActionButtons } from './web/ActionButtons'
import { BAR, BookmarksBar } from './web/BookmarksBar'
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
import { activate, closeTab, EMPTY as EMPTY_TABS, followOwner, loadWebTabs, newTabId, openOrSwitch, openTab, saveWebTabs, updateTab, type WebTabs } from './web/web-tabs'
import { appSettings, usePrefs } from './settings-store'
import { openSettingsAt, WEB_EXTENSIONS_EVENT } from './settings/jump'
import { importChromeLogin, importedText } from './web/chrome-login'
import { type NavState, WebView, type WebviewEl } from './web/WebView'
import { syncExtTheme } from './web/ext-theme'
import { onPageOutside } from './web/page-outside'
import './web/web.css'
import './web/web-top.css'
import { videoOf } from '../shared/video'
import { useVideoKeys } from './video/keys'
import { clearBox, setVideoHost, useBoxEvent } from './video/store'
import { VideoFoldTools, VideoHair, VideoRow, type WebWidth } from './video/VideoStrip'
import { AskCard } from './video/AskCard'
import { askCardNow, boxCanceled, cancelBoxing, closeAskCard, openAskCard } from './video/ask-card'
import { setTopFold, toggleBookmarksBar, toggleTopFold, useWebTop, webTopNow } from './web/top-fold'
import { AiActLayer } from './ai-act'
import { booksOf, inBook, type PagePos, stripHash } from '../shared/read-along'
import { titleOf } from '../shared/layout'
import type { BookRequest } from './read-along/pairing'
import { notesOfUrl, pairOf, positionOf, reportPos, setRightPage, usePairs } from './read-along/store'
import { flashColor, setReadPosHost, type Went } from './read-along/web'
import { openPairPop, unpairLabel } from './read-along/ReadAlongLayer'
import { unpairNote } from './read-along/pairing'
import { showMenu } from './ctx/menu'
import { dropped } from './crash/report'

/** 书桌（task-kbnc0）借右栏网页的本事：记下开着的网页标签和各读到哪、换成一套、换回去 */
export interface WebDeskApi {
  snapshot(): { tabs: { id: string; url: string; title: string; pos: PagePos | null }[]; active: string | null }
  /** 换成这一套：前面那个回到读到的那段（亮一下，done 说结果）；后面的点到才载入、载入后回到那段。返回换之前的样子 */
  replace(tabs: { url: string; title: string; pos: PagePos | null }[], active: number, done?: (how: Went['how']) => void): WebTabs
  restore(s: WebTabs): void
}

const sameUrl = (a: string, b: string) => stripHash(a) === stripHash(b)

export { toUrl }

export const errText = (e: unknown) => String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** 开着的弹层：「⋯」菜单、从它打开的三个面板、星星的书签小卡；内置插件的弹窗是 plugin:<id> */
type Menu = null | 'more' | 'star' | 'login' | 'library' | 'extensions' | `plugin:${string}`

/** 书签管家插件的 id（它的弹窗由地址栏的星星开） */
const BOOKMARKS = 'bookmarks'

/**
 * 右栏网页：多个网页标签（⌘T 新建、⌘W 关当前），地址栏、书签栏、插件按钮、整页剪藏。
 * 按钮分两组：标签条右边只管标签和右栏（收起）；地址栏里是这一页的开关（双语翻译、星星），右边是剪藏、固定的 Chrome 插件按钮和「⋯」。
 * 书签只有地址栏的星星一个入口；不常用的（书签和历史、导入 Chrome 登录、插件）在「⋯」里。
 * 新开的网页标签显示 BookmarkKeeper（用户自己的开源插件）原样的新标签页：书签管家开着、找到了插件文件时；
 * 它是一个 cn-ext:// 的网页，接口由主进程补（main/web/bookmarkkeeper/）。网页标签的 url 是 http(s) 网页或插件页面，空的是还没载入的新标签页。
 * 一直挂着（右栏切到历史 / AI 时只是藏起来），网页不会重新载入。
 */
export function WebPanel(props: {
  hidden: boolean
  /** 当前的中间栏标签：右栏跟着标签走，每个标签记住自己上次看的网页 */
  owner: string | null
  /** 别处要开一个网页（⌘K 里打的网址）：seq 变了就开一个新标签 */
  openRequest: { url: string; seq: number; reuse?: string } | null
  onShow(): void
  onUrl(url: string | null): void
  onNotice(t: string): void
  onClose(): void
  /** 在中间栏开成宽标签 */
  onOpenWide(url: string, title: string): void
  /** 网页占满 / 还原（task-05p2w 方向 A，和标题栏那颗、⌃⌘\ 同一个开关）；网页不在右栏的一栏里（浮着）时没有 */
  full: { on: boolean; toggle(): void } | null
  /** 占满时地址栏里的「记进《这篇》」小牌（App 画好交进来）；没占满是 null */
  chip: React.ReactNode
  /** 中间栏开着的宽网页标签（新标签页的「打开的标签」里也列出来） */
  wideTabs: { id: string; url: string; title?: string }[]
  onActivateWide(id: string): void
  onCloseWide(id: string): void
  /** noWeb：配好对的网页不跟着开（从网页标签的配对小标开的，网页就在眼前） */
  onOpenNote(path: string, noWeb?: boolean): void
  /** 打开设置 · 插件 */
  onPluginSettings(): void
  /** ⌘W 在右栏网页这一格（App 认的当前栏）：关当前网页标签 */
  closeActive: React.MutableRefObject<(() => void) | null>
  /** 用户关了一个网页标签（×、⌘W）：App 在底栏说一句，undo 放回原处；last：关的是最后一个，网页这格收起了 */
  onClosedTab(c: { title: string; last: boolean; undo(): void }): void
  /** 开一本书读到的地方（点开配好对的笔记、对着看的菜单，task-kbnc0）：seq 变了就做 */
  readRequest: BookRequest | null
  /** 书桌（task-kbnc0）：记下、换成一套 */
  deskApi: React.MutableRefObject<WebDeskApi | null>
  /** 右栏前面那个网页现在读到哪（网页里量；配成一对、「就从这里读」时记下） */
  pageNow: React.MutableRefObject<(() => Promise<PagePos | null>) | null>
  /** 中间开着的笔记（「⋯」里「和中间这篇配成一对…」） */
  centerNote: string | null
  /** 网页标签、读到哪变了（书桌开着时自动记下） */
  onWebChange(): void
}) {
  /** 写在界面上的键照命令表（改了跟着变） */
  const K = useKeys()
  // 设置 › 一般「打开时回到上次的样子」关着：右栏网页不接上次开着的标签
  const [st, setSt] = useState<WebTabs>(() => (appSettings().general.reopen ? loadWebTabs((why) => dropped('webtabs', why)) : EMPTY_TABS))
  /**
   * 重开软件时恢复的网页标签（task-0t4jq）：视频不自己播（WebView 的 hold）；
   * 后台的先不载入（dormant），点到它才载入，免得一开软件几个网页一起载、在后面出声
   */
  const restored = useRef<Set<string> | null>(null)
  const dormant = useRef<Set<string> | null>(null)
  /** 重开软件恢复的标签第一次载完：配好对的书、网址就是读到的那页，回到那段（不亮、不说，task-kbnc0） */
  const firstLand = useRef<Set<string> | null>(null)
  if (!restored.current) {
    restored.current = new Set(st.tabs.map((t) => t.id))
    dormant.current = new Set(st.tabs.filter((t) => t.id !== st.active).map((t) => t.id))
    firstLand.current = new Set(st.tabs.map((t) => t.id))
  }
  // 换到哪个标签，哪个就醒（之后一直载着）
  if (st.active) dormant.current!.delete(st.active)
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
  /** 回到那段没找到（网页改了版）：浮在网页上面的那一句（task-kbnc0） */
  const [lost, setLost] = useState<{ tabId: string; text: string } | null>(null)
  /** 每个标签上次量到的读到哪（书桌记它） */
  const tabPos = useRef(new Map<string, PagePos>())
  /** 等网页载完再回到那段：标签 id → 要回到哪 */
  const pendingGoto = useRef(new Map<string, Omit<BookRequest, 'seq' | 'book'> & { book?: string }>())
  /** 发出去的「回到那段」：编号 → 结果交给谁 */
  const gotoWaits = useRef(new Map<number, (how: Went['how']) => void>())
  const gotoSeq = useRef(0)
  /** 人在这个网页里按过键、按过鼠标（点链接翻页）；地址栏、前进后退：下一页载完算人翻过来的，记读到哪 */
  const touchAt = useRef(new Map<string, number>())
  /** 等着网页回话「现在读到哪」 */
  const nowWaits = useRef(new Map<string, (p: PagePos | null) => void>())
  const pairsMap = usePairs()
  useKeepPopsInside(root)
  const cb = useRef(props)
  cb.current = props

  const active = st.tabs.find((t) => t.id === st.active) ?? null
  const activeNav = active ? nav[active.id] : undefined
  const activeGoing = active ? going[active.id] : undefined
  const activeWc = active ? wcIds[active.id] : undefined
  /** 当前的 http(s) 网页（新标签页、插件页面不算）：星星、剪藏、在中间开成一页、AI、插件都只管它 */
  const webUrl = active && /^https?:/.test(active.url) ? active.url : ''
  const page = useMemo(() => (webUrl && activeWc !== undefined ? { wcId: activeWc, url: webUrl, title: active!.title } : null), [webUrl, active?.title, activeWc])
  const keeperOn = usePluginOn(BOOKMARKS)
  const [newtab, setNewtab] = useState<NewTabInfo | null>(null)
  useEffect(() => void window.cnWeb.newtab().then(setNewtab), [])
  useEffect(() => syncExtTheme(), [])
  /** 新网页标签载入的页面：书签管家关着、没找到插件时没有（显示一句说明） */
  // 设置 › 网页和视频「新网页标签打开」选了空白页：书签管家开着也不用它
  const blankTab = usePrefs((x) => x.web.newTab === 'blank')
  const newtabUrl = keeperOn && !blankTab ? (newtab?.url ?? null) : null
  /** 网页标签实际要载入的地址 */
  const srcOf = (t: { url: string }) => t.url || newtabUrl
  // 右栏开着却一个网页标签也没有（第一次打开、关掉了最后一个）：开一个新标签页，和以前直接显示书签首页一样
  // （别处正要开一个网址时不开：比如「放回右栏」，不然多一个空的新网页）
  const handledOpen = useRef<number | null>(null)
  /** 点开配好对的笔记要开的书（task-kbnc0）：正要开它时也不另开一个空的新标签页 */
  const handledRead = useRef<number | null>(null)
  useEffect(() => {
    const opening = (!!props.openRequest && props.openRequest.seq !== handledOpen.current) || (!!props.readRequest && props.readRequest.seq !== handledRead.current)
    if (!props.hidden && newtabUrl && !st.tabs.length && !opening) setSt((s) => (s.tabs.length ? s : openTab(s, '', { owner: cb.current.owner })))
  }, [props.hidden, newtabUrl, st.tabs.length])
  const pluginPopup = menu?.startsWith('plugin:') ? menu.slice(7) : null

  useEffect(() => saveWebTabs(st), [st])
  // 网页标签变了：书桌开着时自动记下（task-kbnc0）
  useEffect(() => cb.current.onWebChange(), [st])
  // 设置 › 网页和视频「在网页「⋯ › 插件」里管 ›」：打开插件那一块（接住了就 preventDefault，App 不再说「没有开着的网页」）
  useEffect(() => {
    const on = (e: Event) => {
      e.preventDefault()
      setMenu('extensions')
    }
    window.addEventListener(WEB_EXTENSIONS_EVENT, on)
    return () => window.removeEventListener(WEB_EXTENSIONS_EVENT, on)
  }, [])
  useEffect(() => {
    const load = () => void window.cnWeb.bookmarks().then(setBookmarks)
    load()
    // 书签管家、导入改了书签：书签栏和星星跟着变
    return window.cnWeb.onBookmarksChanged(load)
  }, [])

  // 换了中间栏的标签：它上次看的网页还开着就切过去；刚点网页标签上的配对小标开的笔记，留在点的那个网页上（记成这篇的）
  const keepTab = useRef<{ id: string; at: number } | null>(null)
  useEffect(() => {
    const keep = keepTab.current && Date.now() - keepTab.current.at < 500 ? keepTab.current.id : null
    keepTab.current = null
    setSt((s) => (keep ? activate(s, keep, props.owner) : followOwner(s, props.owner)))
  }, [props.owner])

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
  // 右栏开着的网页（标题下「配成一对？」的提示、一起开过几次要它；收着时不算，task-kbnc0）
  useEffect(() => setRightPage(!props.hidden && webUrl ? { url: webUrl, title: active?.title ?? '' } : null), [props.hidden, webUrl, active?.title])

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
    // 顶上收着：新网页要打网址，先展开
    if (focus && webTopNow().fold) setTopFold(false)
    if (focus) setTimeout(() => addr.current?.focus(), 0)
  }

  /** ⌘L：顶上收着就先展开，光标进地址块（完整网址、全选） */
  function focusAddr() {
    const go = () => (addr.current?.focus(), addr.current?.select())
    if (!webTopNow().fold) return void go()
    setTopFold(false)
    setTimeout(go, 0)
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
    // 新网页标签、地址栏、重新载入的键在命令表里（下面 useKeyHandler）；关网页标签是「关掉」（App 的 closeHere，当前栏是网页时关当前网页标签）
    return () => {
      offOpen()
      offCmd()
    }
  }, [])
  const wcIdsRef = useRef(wcIds)
  wcIdsRef.current = wcIds
  /** 主进程转过来的按键、窗口上的 ⌘W 只挂一次：用这个拿到最新的 closeByUser */
  const closeRef = useRef(closeByUser)
  closeRef.current = closeByUser
  // 新网页标签、地址栏、重新载入：键照命令表（设置 › 快捷键里能改），App 那边按到了交给这里；网页那一格藏在别的标签后面时地址栏、重新载入不归它
  useKeyHandler('web-new-tab', () => (newTab(), true))
  // 地址栏：顶上收着就先展开（focusAddr），光标进地址块、完整网址全选
  useKeyHandler('web-address', props.hidden ? null : () => (focusAddr(), true))
  useKeyHandler('web-reload', props.hidden ? null : () => !!stRef.current.active && (views.current.get(stRef.current.active)?.reload(), true))
  // 网页栏顶上收成一行 / 展开、书签栏开关（task-sta8n）：网页那一格看得见时在哪都能按（网页里按的主进程转回来），键照命令表
  useKeyHandler('web-top-fold', props.hidden ? null : () => (toggleTopFold(), true))
  useKeyHandler('web-bookmarks-bar', props.hidden ? null : () => (toggleBookmarksBar(), true))
  const stRef = useRef(st)
  stRef.current = st

  function go(input: string) {
    const u = toUrl(input)
    if (active) touchAt.current.set(active.id, Date.now())
    addrEdited.current = false
    setAddress(decodeUrl(u))
    const w = active ? views.current.get(active.id) : undefined
    if (active && w) setGoing((g) => ({ ...g, [active.id]: { url: u, started: false } }))
    if (w) w.go(u)
    else if (active) setSt((s) => updateTab(s, active.id, { url: u, title: '' }))
    else setSt((s) => openTab(s, u, { owner: cb.current.owner }))
    cb.current.onShow()
  }

  // ---------------------------------------------------------------- 读到哪（task-kbnc0）

  /** 让网页回到那段（找不到就按比例停，浮一句「上次那段找不到了」） */
  function sendGoto(tabId: string, req: Omit<BookRequest, 'seq' | 'book'>) {
    const v = views.current.get(tabId)
    if (!v || (!req.pos && !req.top)) return req.done?.('exact')
    const id = ++gotoSeq.current
    gotoWaits.current.set(id, (how) => {
      if (how === 'ratio' && req.pos) setLost({ tabId, text: req.pos.text })
      else setLost((l) => (l?.tabId === tabId ? null : l))
      req.done?.(how)
    })
    v.send('cn:readpos:goto', { id, pos: req.pos ?? { url: req.url, text: '', before: '', after: '', ratio: 0 }, flash: req.flash ? flashColor() : null, top: !!req.top, ...(req.quote !== undefined ? { quote: req.quote } : {}) })
  }

  // 网页报来的读到哪：人滚的、人翻过来的记下（配好对的书记进 读到哪.json，书桌开着时自动记下）；软件自己开的、重开恢复的不记
  useEffect(() => {
    const tabOf = (wc: number) => Object.entries(wcIdsRef.current).find(([, v]) => v === wc)?.[0]
    setReadPosHost({
      pos(wc, pos, kind) {
        const id = tabOf(wc)
        if (!id) return
        tabPos.current.set(id, pos)
        if (kind === 'now') {
          const w = nowWaits.current.get(id)
          if (w) nowWaits.current.delete(id), w(pos)
          return
        }
        if (kind === 'land') {
          const first = firstLand.current?.delete(id) ?? false
          const p = pendingGoto.current.get(id)
          if (p && (sameUrl(p.url, pos.url) || (p.book && inBook(p.book, pos.url)))) {
            pendingGoto.current.delete(id)
            return sendGoto(id, p)
          }
          if (first) {
            for (const b of booksOf(new Set(pairsRef.current.values()), pos.url)) {
              const rp = positionOf(b)
              if (rp && sameUrl(rp.url, pos.url)) return sendGoto(id, { url: rp.url, pos: rp, flash: false })
            }
            return
          }
          if (Date.now() - (touchAt.current.get(id) ?? 0) > 15_000) return cb.current.onWebChange()
        }
        reportPos(pos)
        cb.current.onWebChange()
      },
      touch(wc) {
        const id = tabOf(wc)
        if (id) touchAt.current.set(id, Date.now())
      },
      went(_wc, r) {
        const f = gotoWaits.current.get(r.id)
        if (!f) return
        gotoWaits.current.delete(r.id)
        f(r.how)
      },
    })
    return () => setReadPosHost(null)
  }, [])
  const pairsRef = useRef(pairsMap)
  pairsRef.current = pairsMap

  // 开一本书读到的地方：开着这本书的标签就用它（在前面的优先），没开就新开一个
  useEffect(() => {
    const r = props.readRequest
    if (!r) return
    handledRead.current = r.seq
    const s = stRef.current
    const req = { url: r.url, book: r.book, pos: r.pos, flash: r.flash, ...(r.top ? { top: true } : {}), ...(r.quote !== undefined ? { quote: r.quote } : {}), ...(r.done ? { done: r.done } : {}) }
    const hit = s.tabs.find((t) => t.id === s.active && inBook(r.book, t.url)) ?? s.tabs.find((t) => inBook(r.book, t.url))
    setLost(null)
    if (!hit) {
      const id = newTabId()
      pendingGoto.current.set(id, req)
      setSt((x) => openTab(x, r.url, { id, owner: cb.current.owner }))
      return
    }
    firstLand.current?.delete(hit.id)
    const loaded = wcIdsRef.current[hit.id] !== undefined && !dormant.current!.has(hit.id)
    if (loaded && sameUrl(hit.url, r.url)) sendGoto(hit.id, req)
    else {
      pendingGoto.current.set(hit.id, req)
      if (loaded) views.current.get(hit.id)?.go(r.url)
      else setSt((x) => updateTab(x, hit.id, { url: r.url }))
    }
    setSt((x) => activate(x, hit.id, cb.current.owner))
  }, [props.readRequest?.seq])

  // 右栏前面那个网页现在读到哪（问网页，1.5 秒没回话当没有）
  props.pageNow.current = () =>
    new Promise((res) => {
      const id = stRef.current.active
      const v = id ? views.current.get(id) : undefined
      if (!id || !v) return res(null)
      const done = (p: PagePos | null) => res(p)
      nowWaits.current.set(id, done)
      v.send('cn:readpos:now')
      setTimeout(() => {
        if (nowWaits.current.get(id) !== done) return
        nowWaits.current.delete(id)
        res(null)
      }, 1500)
    })

  // 书桌：记下开着的网页标签和各读到哪、换成一套、换回去
  props.deskApi.current = {
    snapshot: () => ({
      tabs: stRef.current.tabs.filter((t) => /^https?:/.test(t.url)).map((t) => ({ id: t.id, url: t.url, title: t.title, pos: tabPos.current.get(t.id) ?? null })),
      active: stRef.current.active,
    }),
    replace(list, at, done) {
      const prev = stRef.current
      const tabs = list.map((t) => ({ id: newTabId(), url: t.url, title: t.title }))
      tabs.forEach((t, i) => {
        const pos = list[i]!.pos
        if (i !== at) dormant.current!.add(t.id)
        if (pos) pendingGoto.current.set(t.id, { url: t.url, pos, flash: i === at, ...(i === at && done ? { done } : {}) })
      })
      for (const t of prev.tabs) views.current.delete(t.id)
      setLost(null)
      setSt({ tabs, active: tabs[at]?.id ?? tabs[0]?.id ?? null, owners: {} })
      cb.current.onShow()
      return prev
    },
    restore(prev) {
      for (const t of stRef.current.tabs) views.current.delete(t.id)
      for (const t of prev.tabs) if (t.id !== prev.active) dormant.current!.add(t.id)
      setLost(null)
      setSt(prev)
    },
  }

  // 「就从这里读」：网页改了版、上次那段找不到时，从现在这里接着记
  async function readHere() {
    const p = await props.pageNow.current?.()
    setLost(null)
    if (p) reportPos(p)
    props.onNotice('好，以后从这里接着读')
  }

  async function doImport(id: string) {
    setMenu(null)
    setImporting(true)
    try {
      const r = await importChromeLogin(id)
      props.onNotice(importedText(r))
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
        const timed = (raw: string) => {
          const u = new URL(raw)
          if (t !== null && ref?.site === 'youtube') u.searchParams.set('t', `${Math.floor(t)}s`)
          else if (t !== null) u.searchParams.set('t', String(Math.floor(t)))
          return u.toString()
        }
        if (hit && dormant.current!.has(hit.id)) {
          // 恢复了还没载入的标签：带着时间载入；点的是「从那一秒播」就照新开的网页那样播（不再拦），「停在那一秒」照旧拦着
          if (!still) restored.current!.delete(hit.id)
          setSt((s) => activate(updateTab(s, hit.id, { url: timed(hit.url) }), hit.id, cb.current.owner))
          return
        }
        if (hit) {
          setSt((s) => activate(s, hit.id, cb.current.owner))
          const wc = wcIdsRef.current[hit.id]
          if (t !== null && wc !== undefined) setTimeout(() => views.current.get(hit.id)?.send('video:cmd', still ? 'still' : 'seek', t), 50)
          return
        }
        setSt((s) => openTab(s, timed(url), { owner: cb.current.owner }))
      },
      activeWc: () => pageRef.current?.wcId ?? null,
      focus(wcId) {
        const id = Object.entries(wcIdsRef.current).find(([, v]) => v === wcId)?.[0]
        const el = id ? views.current.get(id) : undefined
        if (!el) return
        el.focus()
        // 焦点本来就在网页里时，点软件里的按钮会让网页失焦（按下时焦点退回 body），这时 focus() 是空操作：点完再交回一次
        setTimeout(() => {
          if (document.activeElement !== el) el.focus()
        }, 0)
      },
    })
    return () => setVideoHost(null)
  }, [])
  // 网页栏多宽（原型的两档）：窄于 720 收快捷键提示、记到哪的名字；窄于 470 别的标签只剩图标、视频那一行只留图标；
  // 窄于 330（窗口最窄 960 时右栏 250 上下）再把译、剪藏、插件按钮收进 ⋯，当前那个标签整个露着
  const [width, setWidth] = useState<WebWidth>('wide')
  const [tiny, setTiny] = useState(false)
  useEffect(() => {
    const el = root.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const w = el.getBoundingClientRect().width
      if (!w) return
      setWidth(w < 470 ? 'narrow' : w < 720 ? 'mid' : 'wide')
      setTiny(w < 330)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const top = useWebTop()
  // 收起、展开：底部说一句记住了（第一次画的时候不说）
  const foldSeen = useRef(top.fold)
  useEffect(() => {
    if (foldSeen.current === top.fold) return
    foldSeen.current = top.fold
    cb.current.onNotice(top.fold ? '顶上收成一行 · 记住了，下次打开还是这样' : '顶上展开 · 记住了')
  }, [top.fold])
  // 框好一块（网页报来）：开问框；换了网页标签，开着的问框收起
  const boxEv = useBoxEvent()
  useEffect(() => {
    if (!boxEv) return
    if ('box' in boxEv) openAskCard(boxEv.wcId, boxEv.box, boxEv.rect)
    else boxCanceled()
    clearBox()
  }, [boxEv])
  useEffect(() => {
    const c = askCardNow()
    if (c && c.wcId !== page?.wcId) closeAskCard()
    cancelBoxing()
  }, [page?.wcId])
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
  /**
   * 网页标签上的小标：这是哪篇配好对的书（task-kbnc0，原型 .wt .pm）。点了在中间打开那篇（开着就切过去），
   * 配了几篇时弹菜单选；这个网页标签换到前面，网页不跟着跳到读到哪（task-z5jh4）。
   * 标签本身的网址提示、× 的提示也是 data-tip（不用原生 title）：指着哪个只出最里面那个，不会两个叠着出（task-4emge）
   */
  const pairMark = (t: { id: string; url: string }) => {
    const notes = /^https?:/.test(t.url) ? notesOfUrl(t.url, pairsMap).sort((a, b) => titleOf(a).localeCompare(titleOf(b), 'zh')) : []
    if (!notes.length) return null
    const names = notes.map((n) => `《${titleOf(n)}》`)
    const tip = notes.length === 1 ? `打开配对的笔记${names[0]}` : `打开配对的笔记：${names.join('')}`
    const open = (n: string) => {
      keepTab.current = { id: t.id, at: Date.now() }
      setSt((s) => activate(s, t.id, cb.current.owner))
      cb.current.onOpenNote(n, true)
    }
    return (
      <button className="wpm" aria-label={tip} data-tip={tip} data-side="below" onClick={() => (notes.length === 1 ? open(notes[0]!) : void showMenu(notes.map((n, i) => ({ label: names[i]!, run: () => open(n) }))))}>
        <Codicon name="note" size={12} />
      </button>
    )
  }
  /** 「⋯」这一页最前面：和中间这篇配成一对… / 解除和「…」的配对（中间开着笔记时才有） */
  const center = props.centerNote
  const pairItem =
    center && webUrl && active
      ? pairOf(center) && inBook(pairOf(center)!, webUrl)
        ? { label: unpairLabel(center), icon: 'close' as const, run: () => void unpairNote(center) }
        : { label: '和中间这篇配成一对…', icon: 'link' as const, run: () => moreRef.current && openPairPop(center, { url: webUrl, title: active.title }, moreRef.current, 'right') }
      : null

  /** 标签上写的名字：新标签页在去网址时写要去的域名；没有标题的写域名 */
  const tabName = (t: { id: string; url: string; title: string }) => (!t.url || t.url === newtabUrl ? (going[t.id] ? hostOf(going[t.id]!.url) : '') : t.title) || (/^https?:/.test(t.url) ? hostOf(t.url) : '新网页')
  const tabIcon = (t: { url: string }, size = 14) => (/^https?:/.test(t.url) ? <Favicon url={t.url} size={size} /> : <Codicon name="globe" size={size - 1} />)
  /** 地址块不在打字时盖一层：域名（灰）+ 标题，和 Safari 的紧凑标签一样；去网址的路上、新标签页时就是输入框本身 */
  const disp = !addrFocus && !!webUrl && !activeGoing && !!active
  const others = st.tabs.length - (active ? 1 : 0)

  return (
    <aside className={`right web w-${width}` + (tiny ? ' w-tiny' : '') + (top.fold ? ' folded' : '')} aria-label="网页" hidden={props.hidden} ref={root}>
      {top.fold ? (
        /* 收起（原型 A2，32 高）：‹、当前网页的标题（点它展开）和「+N 个标签」、视频页的两颗图标和时刻数；时间轴是这一行底边一根线 */
        <div className="wrow wfolded" data-testid="web-top-folded" role="toolbar" aria-label="网页（收起）">
          <button className="wib" aria-label="后退" data-tip="后退" data-side="below" disabled={!activeNav?.back} onClick={() => active && (touchAt.current.set(active.id, Date.now()), views.current.get(active.id)?.goBack())}>
            <Codicon name="chevron-left" size={16} />
          </button>
          <button className="wfold-ti" data-testid="web-fold-title" data-tip="点开：地址、标签、视频工具都出来" data-side="below" onClick={() => setTopFold(false)}>
            {active ? tabIcon(active, 12) : <Codicon name="globe" size={12} />}
            <span className="ti truncate">{active ? tabName(active) : '新网页'}</span>
            {others > 0 && <span className="more">{`+${others} 个标签`}</span>}
          </button>
          {props.chip}
          {page && <VideoFoldTools wcId={page.wcId} />}
          {page && <VideoHair wcId={page.wcId} />}
        </div>
      ) : (
        /* 展开（原型 A1，34 高）：‹ › ↻、网页标签（当前那个就是地址块，同 Safari 的紧凑标签）、+、｜、译、剪藏、插件按钮、⋯ */
        <div className="wrow wrow1" data-testid="web-row1">
          <button className="wib" aria-label="后退" data-tip="后退" data-side="below" disabled={!activeNav?.back} onClick={() => active && (touchAt.current.set(active.id, Date.now()), views.current.get(active.id)?.goBack())}>
            <Codicon name="chevron-left" size={16} />
          </button>
          <button className="wib" aria-label="前进" data-tip="前进" data-side="below" disabled={!activeNav?.forward} onClick={() => active && (touchAt.current.set(active.id, Date.now()), views.current.get(active.id)?.goForward())}>
            <Codicon name="chevron-right" size={16} />
          </button>
          <button className="wib" aria-label="重新载入" data-tip="重新载入" data-side="below" disabled={!active || !srcOf(active)} onClick={() => active && views.current.get(active.id)?.reload()}>
            <Codicon name="refresh" size={15} className={activeNav?.loading || activeGoing ? 'spin' : ''} />
          </button>
          <div className="wtabs" role="tablist" aria-label="网页标签">
            <div className="wtlist" ref={tabList}>
              {st.tabs.map((t) =>
                t.id === st.active ? (
                  <div key={t.id} className="tab on wcur" role="tab" aria-selected data-tip={t.url ? decodeUrl(t.url) : '新网页'} data-side="below">
                    <form
                      className={'addr' + (addrFocus ? ' edit' : '') + (disp ? ' disp' : '')}
                      onSubmit={(e) => {
                        e.preventDefault()
                        if (!address.trim()) return
                        go(address)
                        addr.current?.blur()
                      }}
                    >
                      <Codicon name={https ? 'lock' : 'globe'} size={12} />
                      {/* 不在打字时盖一层域名 + 标题（输入框里还是域名和路径，不写 http://）；点进去是完整网址、全选，⌘L 也行 */}
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
                        data-side="below"
                        onMouseOver={(e) => {
                          const el = e.currentTarget
                          // 两行：网址一行，「点一下改地址」一行，键帽在它后面（task-4emge 设计复审）
                          const key = K('web-address')
                          if (!addrFocus && address) el.dataset.tip = `${address}\n点一下改地址`
                          else delete el.dataset.tip
                          if (key) el.dataset.key = key
                          else delete el.dataset.key
                        }}
                      />
                      {/* 改地址时藏起来（.addr:not(.disp)），这个标签照样叫这一页的名字 */}
                      {webUrl && (
                        <span className="adisp" aria-hidden="true">
                          <span className="ti truncate" data-dom={hostOf(webUrl)}>
                            {tabName(t)}
                          </span>
                        </span>
                      )}
                    </form>
                    {pairMark(t)}
                    <button className="x" aria-label="关闭网页标签" data-tip="关闭网页标签" data-key={K('close') ?? undefined} data-side="below" onClick={() => closeByUser(t.id)}>
                      <Codicon name="close" size={12} />
                    </button>
                  </div>
                ) : (
                  <div key={t.id} className="tab" role="tab" aria-selected={false} data-tip={t.url ? `${tabName(t)}\n${decodeUrl(t.url)}` : '新网页'} data-side="below">
                    <button className="tl" onClick={() => setSt((s) => activate(s, t.id, cb.current.owner))}>
                      {tabIcon(t)}
                      <span className="truncate">{tabName(t)}</span>
                    </button>
                    {pairMark(t)}
                    <button className="x" aria-label="关闭网页标签" data-tip="关闭网页标签" data-key={K('close') ?? undefined} data-side="below" onClick={() => closeByUser(t.id)}>
                      <Codicon name="close" size={12} />
                    </button>
                  </div>
                ),
              )}
            </div>
            <button className="wib wnew" aria-label="新网页" data-tip="新网页（书签管家的新标签页）" data-key={K('web-new-tab') ?? undefined} data-side="below" onClick={() => newTab()}>
              <Codicon name="add" size={15} />
            </button>
          </div>
          <span className="wsep" />
          {webUrl && (
            <span className="addr-acts" role="toolbar" aria-label="这一页">
              <PluginButtons slot="address" page={page} popup={pluginPopup} onPopup={(id) => setMenu(id ? `plugin:${id}` : null)} />
            </span>
          )}
          {props.chip}
          <button className="wib wclip" aria-label="剪藏这一页" data-tip="剪藏这一页：整页进收件箱" data-side="below" disabled={!webUrl || clipping} onClick={() => void clipPage()}>
            <Codicon name="quote" size={14} className={clipping ? 'spin' : ''} />
          </button>
          <ActionButtons tabId={activeWc ?? -1}>
            <PluginButtons slot="toolbar" page={page} popup={pluginPopup} onPopup={(id) => setMenu(id ? `plugin:${id}` : null)} />
          </ActionButtons>
          <div className="imp">
            <button
              ref={moreRef}
              className={'wib' + (menu === 'more' || menu === 'library' || menu === 'extensions' || menu === 'login' || keeperOpen ? ' on' : '')}
              aria-label="更多"
              data-tip="更多：这一页、书签、浏览器"
              data-side="below-left"
              aria-haspopup="menu"
              aria-expanded={menu === 'more'}
              onClick={() => setMenu(menu === 'more' ? null : 'more')}
            >
              <Codicon name={importing ? 'sign-in' : 'ellipsis'} size={16} className={importing ? 'spin' : ''} />
            </button>
            {menu === 'more' && (
              <MoreMenu
                pair={pairItem}
                star={webUrl ? { on: !!starred, keeper: keeperOn } : null}
                onStar={() => (setMenu(null), void clickStar())}
                onClip={webUrl && !clipping ? () => (setMenu(null), void clipPage()) : null}
                page={page}
                importing={importing}
                bookmarks={bookmarks}
                bar={top.bm}
                full={props.full?.on ?? null}
                onOpenBookmark={(u, newOne) => openUrl(u, newOne)}
                onBar={() => (setMenu(null), toggleBookmarksBar())}
                onFull={() => (setMenu(null), props.full?.toggle())}
                onCenter={webUrl ? () => (setMenu(null), openWide()) : null}
                onFold={() => (setMenu(null), toggleTopFold())}
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
      )}
      {/* 视频那一行（原型 A1 第二行，32 高，只有视频页才有） */}
      {!top.fold && page && <VideoRow wcId={page.wcId} width={width} />}
      {pluginPopup && <PluginPopup id={pluginPopup} page={page} mode="all" onClose={() => setMenu(null)} />}
      {menu === 'star' && <PluginPopup id={BOOKMARKS} page={page} mode="this-page" style={cardPos()} onClose={() => setMenu(null)} />}
      {/* 书签栏默认不摆，「⋯ › 书签」里开（⇧⌘B）；新标签页自己就是书签，那时不摆 */}
      {!top.fold && top.bm && (webUrl || !newtabUrl) && <BookmarksBar bookmarks={bookmarks} onOpen={openUrl} />}
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
        {/* 在这个网页里找（⇧⌘F）：交给网页自己找（findInPage） */}
        <WebFind view={() => (st.active ? views.current.get(st.active) : undefined)} host={() => stack.current} on={!props.hidden && !!st.active} owner="web" tab={st.active} />
        <div className="wstack" ref={stack}>
          {st.tabs.map((t) => {
            const src = srcOf(t)
            return src && !dormant.current!.has(t.id) ? (
              <WebView
                key={t.id}
                initialUrl={src}
                visible={t.id === st.active}
                hold={restored.current!.has(t.id)}
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
          {/* 网页改了版、上次那段找不到：按比例停在差不多的地方，浮一句（不往网页栏顶上加一排，task-kbnc0） */}
          {lost && lost.tabId === st.active && (
            <div className="wlost" role="alert" data-part="网页改版了的提示">
              <Codicon name="warning" size={14} />
              <div className="t">
                上次那段找不到了：网页改过版。
                <br />
                <span>{`按上次的位置停在了差不多的地方。上次那段是「${lost.text.length > 22 ? lost.text.slice(0, 22) + '…' : lost.text}」`}</span>
                <div className="acts">
                  <button type="button" className="btn btn-sm btn-primary ra-26" onClick={() => void readHere()}>
                    就从这里读
                  </button>
                </div>
              </div>
              <button type="button" className="cm-ra-x" aria-label="关掉这一句" data-tip="关掉" onClick={() => setLost(null)}>
                <Codicon name="close" size={15} />
              </button>
            </div>
          )}
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
      {/* 框一块问的问框：视频下沿下面，不挡视频 */}
      {page && <AskCard wcId={page.wcId} pageUrl={page.url} />}
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
  /** 和中间这篇配成一对… / 解除配对（task-kbnc0）；中间没开笔记、不是网页时没有 */
  pair: { label: string; icon: CodiconName; run(): void } | null
  page: WebPage | null
  /** 这一页收藏了没有；keeper：书签管家开着（收藏后开小卡改标签和备注） */
  star: { on: boolean; keeper: boolean } | null
  onStar(): void
  /** 剪藏这一页（和地址栏旁的引号按钮、⌘K「剪藏这一页」同一件事）；不是网页时灰着 */
  onClip: (() => void) | null
  importing: boolean
  /** 书签（「书签」一组列出书签栏里的几个，task-sta8n：书签栏默认不摆，收进这里） */
  bookmarks: Bookmark[]
  /** 书签栏摆着没有（「显示书签栏 ⇧⌘B」勾没勾） */
  bar: boolean
  /** 网页占满了没有（task-05p2w：和标题栏那颗、⌃⌘\ 同一个开关）；网页浮着、不在右栏的一栏里时是 null，没有这一项 */
  full: boolean | null
  onOpenBookmark(url: string, newTab: boolean): void
  onBar(): void
  onFull(): void
  /** 在中间开成一页（不是网页时没有） */
  onCenter: (() => void) | null
  onFold(): void
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
    ...(props.pair ? [{ id: 'pair', group: 'page' as const, label: '和中间这篇配成一对…', icon: 'link' as const, node: item(props.pair.label, props.pair.icon, () => (props.onClose(), props.pair!.run())) }] : []),
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
    { id: 'newtab', group: 'bookmarks', label: '书签首页', icon: 'layout', node: item('书签首页', 'layout', props.onNewTab, keyFor('web-new-tab') ?? undefined) },
    { id: 'library', group: 'bookmarks', label: '书签和历史…', icon: 'bookmark', node: item('书签和历史…', 'bookmark', () => props.onPick('library')) },
    {
      id: 'bmbar',
      group: 'bookmarks',
      label: '显示书签栏',
      icon: 'bookmark',
      node: (
        <button key="bmbar" role="menuitemcheckbox" aria-checked={props.bar} onClick={props.onBar}>
          <Codicon name={props.bar ? 'check' : 'blank'} size={14} />
          <span className="mlabel">显示书签栏</span>
          {keyFor('web-bookmarks-bar') && <kbd>{keyFor('web-bookmarks-bar')}</kbd>}
        </button>
      ),
    },
    { id: WEB_LOCKED, group: 'browser', label: '插件…', icon: 'extensions', node: item('插件…', 'extensions', () => props.onPick('extensions')) },
    { id: 'login', group: 'browser', label: '导入Chrome登录…', icon: 'sign-in', node: item('导入Chrome登录…', 'sign-in', () => props.onPick('login'), undefined, props.importing) },
    // 网页占满 / 还原（task-05p2w 方向 A）：以前的「网页拉到最宽」并进来，同一件事只留一个说法
    ...(props.full !== null ? [{ id: 'full', group: 'browser' as const, label: '网页占满', icon: 'screen-full' as const, node: item(props.full ? '还原' : '网页占满', props.full ? 'screen-normal' : 'screen-full', props.onFull, keyFor('fold-center') ?? undefined) }] : []),
    // 以前的「网页移到中间」：开成中间的一页，和别的标签排在一起；剪的进收件箱，右边写明
    ...(props.onCenter
      ? [
          {
            id: 'tocenter',
            group: 'browser' as const,
            label: '在中间开成一页',
            icon: 'layout-centered' as const,
            node: (
              <button key="tocenter" role="menuitem" onClick={props.onCenter}>
                <Codicon name="layout-centered" size={14} />
                <span className="mlabel">在中间开成一页</span>
                <span className="h">剪的进收件箱</span>
              </button>
            ),
          },
        ]
      : []),
    { id: 'fold', group: 'browser', label: '收起顶上', icon: 'chevron-up', node: item('收起顶上', 'chevron-up', props.onFold, keyFor('web-top-fold') ?? undefined) },
  ]
  // 书签栏里的几个书签直接列在「书签」一组最前面（书签栏默认不摆，原型 A 的「⋯ › 书签」）；多的在「书签和历史…」里
  const barLinks = props.bookmarks
    .map((b, i) => ({ b, k: b.order ?? 1e9 + i }))
    .filter(({ b }) => b.folder === BAR)
    .sort((x, y) => x.k - y.k)
    .slice(0, 8)
    .map(({ b }) => b)
  if (barLinks.length)
    all.unshift({
      id: 'bmlinks',
      group: 'bookmarks',
      label: '书签栏里的书签',
      icon: 'bookmark',
      node: (
        <div key="bmlinks" className="wm-links">
          {barLinks.map((b) => (
            <button key={b.id} role="menuitem" title={b.url} onClick={(e) => (props.onClose(), props.onOpenBookmark(b.url, e.metaKey))}>
              <Favicon url={b.url} size={14} />
              <span className="mlabel truncate">{b.title}</span>
            </button>
          ))}
        </div>
      ),
    })
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
        <>
          <div role="group" aria-label="调整">
            {item('调整这个菜单…', 'edit', () => setEdit(true))}
          </div>
          {/* 从用的地方跳到设置（方向 A 的 A3）：网页设置在设置 › 网页和视频，那一行闪一下 */}
          <div role="group" aria-label="网页设置" className="wm-go">
            <button role="menuitem" className="go" onClick={() => (props.onClose(), openSettingsAt('engine'))}>
              <Codicon name="settings-gear" size={14} />
              <span className="mlabel">网页设置…</span>
              <Codicon name="chevron-right" size={12} className="go-r" />
            </button>
          </div>
        </>
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
