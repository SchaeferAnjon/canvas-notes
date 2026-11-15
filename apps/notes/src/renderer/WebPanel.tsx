import { Icon } from '@cn/design'
import { ArrowLeft, ArrowLeftToLine, ArrowRight, BookMarked, Ellipsis, Globe, LayoutGrid, Lock, LogIn, type LucideIcon, Plus, Puzzle, RotateCw, Scissors, Star, X } from 'lucide-react'
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react'
import type { Clip } from '../shared/api'
import type { Bookmark } from '../shared/web-api'
import { decodeUrl, toUrl } from './url'
import { Favicon } from './web/favicons'
import { ActionButtons } from './web/ActionButtons'
import { BookmarksBar } from './web/BookmarksBar'
import { ExtensionsPanel } from './web/ExtensionsPanel'
import { setCurrentPage } from './web/image-drop'
import { LibraryPanel } from './web/LibraryPanel'
import { PluginButtons, PluginNewTab, PluginPageMenu, PluginPopup, usePluginMenu, usePluginOn } from './plugins'
import type { WebPage } from './plugins/types'
import { setWebHost } from './plugins/host'
import { ProfileMenu } from './web/ProfileMenu'
import { activate, closeTab, followOwner, loadWebTabs, newTabId, openTab, saveWebTabs, updateTab, type WebTabs } from './web/web-tabs'
import { type NavState, WebView, type WebviewEl } from './web/WebView'
import './web/web.css'

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
 * 新开的网页标签显示书签首页（书签管家插件给的）。
 * 一直挂着（右栏切到历史 / AI 时只是藏起来），网页不会重新载入。
 */
export function WebPanel(props: {
  hidden: boolean
  /** 当前的中间栏标签：右栏跟着标签走，每个标签记住自己上次看的网页 */
  owner: string | null
  clipMode: ClipMode
  /** 别处要开一个网页（⌘K 里打的网址）：seq 变了就开一个新标签 */
  openRequest: { url: string; seq: number } | null
  onShow(): void
  onUrl(url: string | null): void
  onClip(c: Clip): void
  onNotice(t: string): void
  onClose(): void
  /** 在中间栏开成宽标签 */
  onOpenWide(url: string, title: string): void
  /** 中间栏开着的宽网页标签（书签首页「打开的标签」里也列出来） */
  wideTabs: { id: string; url: string; title?: string }[]
  onActivateWide(id: string): void
  onCloseWide(id: string): void
  onOpenNote(path: string): void
  /** 打开设置 · 插件 */
  onPluginSettings(): void
}) {
  const [st, setSt] = useState<WebTabs>(loadWebTabs)
  const views = useRef(new Map<string, WebviewEl>())
  /** 标签 id → 它的 webContents id */
  const [wcIds, setWcIds] = useState<Record<string, number>>({})
  /** 主进程等着的新标签：标签 id → 请求号 */
  const pending = useRef(new Map<string, number>())
  const [nav, setNav] = useState<Record<string, NavState>>({})
  const [address, setAddress] = useState('')
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [menu, setMenu] = useState<Menu>(null)
  const [importing, setImporting] = useState(false)
  const [clipping, setClipping] = useState(false)
  const [clipped, setClipped] = useState<{ path: string; undone?: boolean } | null>(null)
  const addr = useRef<HTMLInputElement>(null)
  const root = useRef<HTMLElement>(null)
  const cb = useRef(props)
  cb.current = props

  const active = st.tabs.find((t) => t.id === st.active) ?? null
  const activeNav = active ? nav[active.id] : undefined
  const activeWc = active ? wcIds[active.id] : undefined
  const page = useMemo(() => (active?.url && activeWc !== undefined ? { wcId: activeWc, url: active.url, title: active.title } : null), [active?.url, active?.title, activeWc])
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
  useEffect(() => {
    setAddress(active?.url ? decodeUrl(active.url) : '')
    cb.current.onUrl(active?.url || null)
    setCurrentPage(active?.url ? { url: active.url, title: active.title } : null)
  }, [active?.id, active?.url, active?.title])
  useEffect(() => {
    if (activeWc !== undefined && !props.hidden) void window.cnWeb.setActiveTab(activeWc)
  }, [activeWc, props.hidden])

  useEffect(() => {
    const r = props.openRequest
    if (r) setSt((s) => openTab(s, r.url, { owner: cb.current.owner }))
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

  // 主进程转过来的：新窗口链接 / 插件开标签、插件切换关闭标签、网页焦点时的快捷键
  useEffect(() => {
    const offOpen = window.cnWeb.onOpenTab(({ url, reqId, background }) => {
      const id = newTabId()
      if (reqId !== undefined) pending.current.set(id, reqId)
      if (!background) cb.current.onShow()
      setSt((s) => openTab(s, url, { id, background: !!background, owner: cb.current.owner }))
    })
    const tabOf = (wc: number) => Object.entries(wcIdsRef.current).find(([, v]) => v === wc)?.[0]
    const offCmd = window.cnWeb.onTabCommand(({ type, webContentsId }) => {
      const id = tabOf(webContentsId)
      if (!id) return
      if (type === 'close') close(id)
      else {
        cb.current.onShow()
        setSt((s) => activate(s, id, cb.current.owner))
      }
    })
    const offKey = window.cnWeb.onKey((k, wc) => {
      const id = tabOf(wc)
      if (!id) return
      if (k === 't') newTab()
      else if (k === 'w') close(id)
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
        if (cur) close(cur)
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
  const stRef = useRef(st)
  stRef.current = st

  function go(input: string) {
    const u = toUrl(input)
    setAddress(decodeUrl(u))
    const w = active ? views.current.get(active.id) : undefined
    if (w && active?.url) void w.loadURL(u).catch(() => undefined)
    else if (active) setSt((s) => updateTab(s, active.id, { url: u, title: '' }))
    else setSt((s) => openTab(s, u, { owner: cb.current.owner }))
    cb.current.onShow()
  }

  async function doImport(id: string) {
    setMenu(null)
    setImporting(true)
    try {
      const r = await window.cn.importChrome(id)
      props.onNotice(`导入了 ${r.imported} 个登录信息${r.expired ? `，${r.expired} 个已过期没导` : ''}。网页重新载入后就是登录状态。`)
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
      const path = await window.cn.clipCurrentPage({ webUrl: active?.url || null })
      setClipped({ path })
    } catch (e) {
      props.onNotice(errText(e))
    } finally {
      setClipping(false)
    }
  }

  // 弹层（书签和历史、插件、选 Chrome 用户）点外面就收起
  useEffect(() => {
    if (!menu) return
    const onDown = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest('.right.web .imp, .right.web .addr .star')) setMenu(null)
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [menu])

  useEffect(() => {
    if (!clipped) return
    const t = setTimeout(() => setClipped(null), 10_000)
    return () => clearTimeout(t)
  }, [clipped])

  const starred = useMemo(() => (active?.url ? bookmarks.find((b) => b.url === active.url) : undefined), [bookmarks, active?.url])

  const keeperOn = usePluginOn(BOOKMARKS)
  const keeperOpen = menu === 'star'

  /**
   * 地址栏的星星：书签管家开着时像 Chrome，没收藏的先收藏，再在星星下面开书签小卡（改标题、标签、备注、文件夹，删）；
   * 书签管家关着时就是加 / 取消书签
   */
  async function clickStar() {
    if (!active?.url) return
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
    if (!active?.url) return
    props.onOpenWide(active.url, active.title)
    const left = stRef.current.tabs.length - 1
    close(active.id)
    if (left === 0) props.onClose()
  }

  const openUrl = (u: string, newOne: boolean) => {
    if (newOne || !active) setSt((s) => openTab(s, u, { owner: cb.current.owner }))
    else go(u)
    setMenu(null)
  }

  // 内置插件借右栏的本事：给网页发命令、开弹窗、开网址
  const pageRef = useRef(page)
  pageRef.current = page
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
    })
    return () => setWebHost(null)
  }, [page, props.hidden])
  /** 星星的书签小卡贴在星星下面，右边和星星对齐（放不下就贴右栏右边） */
  const starRef = useRef<HTMLButtonElement>(null)
  const cardPos = (): CSSProperties | undefined => {
    const st = starRef.current?.getBoundingClientRect()
    const box = root.current?.getBoundingClientRect()
    if (!st || !box) return undefined
    const right = Math.max(8, box.right - st.right - 8)
    // 小卡上的箭头对准星星：箭头 12 宽，离小卡右边多远
    return { top: st.bottom - box.top + 8, right, ['--arrow-right' as string]: `${box.right - right - (st.left + st.width / 2) - 6}px` }
  }
  const https = !!active?.url && active.url.startsWith('https:')

  return (
    <aside className="right web" aria-label="网页" hidden={props.hidden} ref={root}>
      <div className="tabs wtabs" role="tablist" aria-label="网页标签">
        {st.tabs.map((t) => (
          <div key={t.id} className={'tab' + (t.id === st.active ? ' on' : '')} role="tab" aria-selected={t.id === st.active} title={t.url ? decodeUrl(t.url) : '新网页'}>
            <button className="tl" onClick={() => setSt((s) => activate(s, t.id, cb.current.owner))}>
              {t.url ? <Favicon url={t.url} size={14} /> : <Icon of={Globe} size={13} />}
              <span className="truncate">{t.title || (t.url ? hostOf(t.url) : '新网页')}</span>
            </button>
            <button className="x" aria-label="关闭网页标签" title="关闭网页标签 ⌘W" onClick={() => close(t.id)}>
              <Icon of={X} size={12} />
            </button>
          </div>
        ))}
        <button className="iconbtn wnew" aria-label="新网页" title="新网页 ⌘T（书签首页）" onClick={() => newTab()}>
          <Icon of={Plus} size={14} />
        </button>
        <span className="sp" />
        {active?.url && (
          <button
            className={'wtool wwide' + (st.tabs.length >= 3 ? ' tight' : '')}
            aria-label="移到中间"
            title="开成宽标签，右栏空出来"
            onClick={openWide}
          >
            <Icon of={ArrowLeftToLine} size={14} />
            <span>移到中间</span>
          </button>
        )}
        <button className="iconbtn wtool" aria-label="收起网页" title="收起网页（网页还开着，竖条上再点「网页」回来）" onClick={props.onClose}>
          <Icon of={X} size={14} />
        </button>
      </div>
      <div className="rhead">
        <button className="iconbtn" aria-label="后退" title="后退" disabled={!activeNav?.back} onClick={() => active && views.current.get(active.id)?.goBack()}>
          <Icon of={ArrowLeft} size={14} />
        </button>
        <button className="iconbtn" aria-label="前进" title="前进" disabled={!activeNav?.forward} onClick={() => active && views.current.get(active.id)?.goForward()}>
          <Icon of={ArrowRight} size={14} />
        </button>
        <button className="iconbtn" aria-label="重新载入" title="重新载入" disabled={!active?.url} onClick={() => active && views.current.get(active.id)?.reload()}>
          <Icon of={RotateCw} size={14} className={activeNav?.loading ? 'spin' : ''} />
        </button>
        <form
          className="addr"
          onSubmit={(e) => {
            e.preventDefault()
            if (address.trim()) go(address)
          }}
        >
          <Icon of={https ? Lock : Globe} size={13} />
          <input ref={addr} aria-label="网址" placeholder="输入网址或要搜的词" value={address} onChange={(e) => setAddress(e.target.value)} onFocus={(e) => e.currentTarget.select()} />
          {active?.url && (
            <span className="addr-acts" role="toolbar" aria-label="这一页">
              <PluginButtons slot="address" page={page} popup={pluginPopup} onPopup={(id) => setMenu(id ? `plugin:${id}` : null)} />
              <button
                ref={starRef}
                type="button"
                className={'abtn star' + (starred ? ' on' : '') + (keeperOpen ? ' open' : '')}
                aria-label={keeperOn ? '书签管家' : starred ? '取消书签' : '加书签'}
                aria-pressed={keeperOn ? keeperOpen : !!starred}
                title={keeperOn ? (starred ? '已收藏 · 改标签和备注' : '加书签（收藏后能加标签和备注）') : starred ? '取消书签' : '加书签'}
                onClick={() => void clickStar()}
              >
                <Icon of={Star} size={13} />
              </button>
            </span>
          )}
        </form>
        <button className="iconbtn" aria-label="整页剪藏" title="整页剪进收件箱" disabled={!active?.url || clipping} onClick={() => void clipPage()}>
          <Icon of={Scissors} size={14} className={clipping ? 'spin' : ''} />
        </button>
        <ActionButtons tabId={activeWc ?? -1}>
          <PluginButtons slot="toolbar" page={page} popup={pluginPopup} onPopup={(id) => setMenu(id ? `plugin:${id}` : null)} />
        </ActionButtons>
        <div className="imp">
          <button
            className={'iconbtn' + (menu === 'more' || menu === 'library' || menu === 'extensions' || menu === 'login' ? ' on' : '')}
            aria-label="更多"
            title="更多：稍后再看、双语翻译、书签和历史、插件、导入 Chrome 登录"
            aria-haspopup="menu"
            aria-expanded={menu === 'more'}
            onClick={() => setMenu(menu === 'more' ? null : 'more')}
          >
            <Icon of={importing ? LogIn : Ellipsis} size={16} className={importing ? 'spin' : ''} />
          </button>
          {menu === 'more' && (
            <MoreMenu
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
      {pluginPopup && <PluginPopup id={pluginPopup} page={page} mode="all" onClose={() => setMenu(null)} />}
      {menu === 'star' && <PluginPopup id={BOOKMARKS} page={page} mode="this-page" style={cardPos()} onClose={() => setMenu(null)} />}
      {/* 书签首页自己就是书签，那时不摆书签栏 */}
      {(active?.url || !keeperOn) && <BookmarksBar bookmarks={bookmarks} onOpen={openUrl} />}
      {clipped && (
        <div className="wnote" role="status">
          {clipped.undone ? (
            <span>撤回了，收件箱里那篇删掉了</span>
          ) : (
            <>
              <span className="truncate">整页存进收件箱了：{clipped.path.split('/').pop()?.replace(/\.md$/, '')}</span>
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
        <div className="wstack">
          {st.tabs.map((t) =>
            t.url ? (
              <WebView
                key={t.id}
                initialUrl={t.url}
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
                  if (/^https?:/.test(n.url)) setSt((s) => updateTab(s, t.id, { url: n.url }))
                }}
                onTitle={(title) => setSt((s) => updateTab(s, t.id, { title }))}
                onClip={props.onClip}
              />
            ) : null,
          )}
          {(!active || !active.url) && (
            <PluginNewTab
              tabs={[
                ...st.tabs.filter((t) => t.url && t.id !== active?.id),
                ...props.wideTabs.map((t) => ({ id: `wide:${t.id}`, url: t.url, title: t.title ?? '', where: 'center' as const })),
              ]}
              open={(u) => go(u)}
              openNew={(u) => setSt((s) => openTab(s, u, { background: true, owner: cb.current.owner }))}
              openLibrary={() => setMenu('library')}
              activate={(id) => (id.startsWith('wide:') ? props.onActivateWide(id.slice(5)) : setSt((s) => activate(s, id, cb.current.owner)))}
              close={(ids) => ids.forEach((id) => (id.startsWith('wide:') ? props.onCloseWide(id.slice(5)) : close(id)))}
              notice={props.onNotice}
              openPopup={() => setMenu(`plugin:${BOOKMARKS}`)}
              openSettings={props.onPluginSettings}
              fallback={
                <div className="webstart">
                  <p>输入网址打开一个网页。选中一段文字，就能剪进笔记；网页里的图片能直接拖到白板上。</p>
                  <p className="sub">网站要登录的话，先点右上角「⋯」里的「导入 Chrome 登录」，把 Chrome 的登录状态导进来。</p>
                </div>
              }
            />
          )}
        </div>
      </div>
    </aside>
  )
}

/**
 * 地址栏右边「⋯」菜单：这一页（插件给的项，比如稍后再看、双语翻译）、书签（书签首页、书签和历史）、浏览器（插件、导入 Chrome 登录）。
 * ↑↓ 选，↵ 执行，esc 关。
 */
function MoreMenu(props: { page: WebPage | null; importing: boolean; onClose(): void; onNewTab(): void; onPick(m: 'library' | 'extensions' | 'login'): void; onNotice(t: string): void }) {
  const ref = useRef<HTMLDivElement>(null)
  const pluginItems = usePluginMenu(props.page)
  useEffect(() => ref.current?.querySelector<HTMLButtonElement>('[role=menuitem]:not(:disabled)')?.focus(), [])
  const onKey = (e: React.KeyboardEvent) => {
    const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not(:disabled)') ?? [])]
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
  const item = (label: string, icon: LucideIcon, run: () => void, hint?: string, disabled?: boolean) => (
    <button key={label} role="menuitem" disabled={disabled} onClick={run}>
      <Icon of={icon} size={14} />
      <span className="mlabel">{label}</span>
      {hint && <kbd>{hint}</kbd>}
    </button>
  )
  return (
    <div ref={ref} className="menu wmore" role="menu" aria-label="更多" onKeyDown={onKey}>
      <div role="group" aria-label="这一页">
        <PluginPageMenu page={props.page} onDone={props.onClose} onNotice={props.onNotice} />
        {pluginItems.map((p) => item(p.label, p.icon, () => (props.onClose(), p.run()), p.keys, !props.page))}
      </div>
      <div role="group" aria-label="书签">
        {item('书签首页', LayoutGrid, props.onNewTab, '⌘T')}
        {item('书签和历史…', BookMarked, () => props.onPick('library'))}
      </div>
      <div role="group" aria-label="浏览器">
        {item('插件…', Puzzle, () => props.onPick('extensions'))}
        {item('导入 Chrome 登录…', LogIn, () => props.onPick('login'), undefined, props.importing)}
      </div>
    </div>
  )
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
