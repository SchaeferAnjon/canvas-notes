import { Icon } from '@cn/design'
import { ArrowLeft, ArrowRight, BookMarked, Globe, LogIn, Maximize2, Plus, Puzzle, RotateCw, Scissors, Star, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Clip } from '../shared/api'
import type { Bookmark } from '../shared/web-api'
import { decodeUrl, toUrl } from './url'
import { ActionButtons } from './web/ActionButtons'
import { BookmarksBar } from './web/BookmarksBar'
import { ExtensionsPanel } from './web/ExtensionsPanel'
import { setCurrentPage } from './web/image-drop'
import { LibraryPanel } from './web/LibraryPanel'
import { PluginButtons, PluginPopup } from './plugins'
import { setWebHost } from './plugins/host'
import { ProfileMenu } from './web/ProfileMenu'
import { activate, closeTab, followOwner, loadWebTabs, newTabId, openTab, saveWebTabs, updateTab, type WebTabs } from './web/web-tabs'
import { type NavState, WebView, type WebviewEl } from './web/WebView'
import './web/web.css'

export type ClipMode = { mode: 'inbox' | 'doc'; target?: string }

export { toUrl }

export const errText = (e: unknown) => String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** 开着的弹层；内置插件的弹窗是 plugin:<id> */
type Menu = null | 'login' | 'library' | 'extensions' | `plugin:${string}`

/**
 * 右栏网页：多个网页标签（⌘T 新建、⌘W 关当前），地址栏、书签栏、插件按钮、整页剪藏。
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
      if (!(e.target as HTMLElement).closest('.right.web .imp')) setMenu(null)
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

  async function toggleStar() {
    if (!active?.url) return
    try {
      setBookmarks(starred ? await window.cnWeb.removeBookmark(starred.id) : await window.cnWeb.addBookmark({ title: active.title || active.url, url: active.url }))
    } catch (e) {
      props.onNotice(errText(e))
    }
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
  return (
    <aside className="right web" aria-label="网页" hidden={props.hidden} ref={root}>
      <div className="tabs wtabs" role="tablist" aria-label="网页标签">
        {st.tabs.map((t) => (
          <div key={t.id} className={'tab' + (t.id === st.active ? ' on' : '')} role="tab" aria-selected={t.id === st.active} title={t.url ? decodeUrl(t.url) : '新网页'}>
            <button className="tl" onClick={() => setSt((s) => activate(s, t.id, cb.current.owner))}>
              <Icon of={Globe} size={13} />
              <span className="truncate">{t.title || (t.url ? hostOf(t.url) : '新网页')}</span>
            </button>
            <button className="x" aria-label="关闭网页标签" onClick={() => close(t.id)}>
              <Icon of={X} size={12} />
            </button>
          </div>
        ))}
        <button className="iconbtn wnew" aria-label="新网页" title="新网页 ⌘T" onClick={() => newTab()}>
          <Icon of={Plus} size={14} />
        </button>
        <span className="sp" />
        <ActionButtons tabId={activeWc ?? -1}>
          <PluginButtons page={page} popup={pluginPopup} onPopup={(id) => setMenu(id ? `plugin:${id}` : null)} />
        </ActionButtons>
        <button
          className="iconbtn wtool"
          aria-label="在中间栏打开"
          title="在中间栏开成宽标签"
          disabled={!active?.url}
          onClick={() => {
            if (!active?.url) return
            props.onOpenWide(active.url, active.title)
            close(active.id)
          }}
        >
          <Icon of={Maximize2} size={14} />
        </button>
        <button className="iconbtn wtool" aria-label="关上网页" onClick={props.onClose}>
          <Icon of={X} size={14} />
        </button>
      </div>
      <div className="rhead">
        <button className="iconbtn" aria-label="后退" disabled={!activeNav?.back} onClick={() => active && views.current.get(active.id)?.goBack()}>
          <Icon of={ArrowLeft} size={14} />
        </button>
        <button className="iconbtn" aria-label="前进" disabled={!activeNav?.forward} onClick={() => active && views.current.get(active.id)?.goForward()}>
          <Icon of={ArrowRight} size={14} />
        </button>
        <button className="iconbtn" aria-label="重新载入" disabled={!active?.url} onClick={() => active && views.current.get(active.id)?.reload()}>
          <Icon of={RotateCw} size={14} className={activeNav?.loading ? 'spin' : ''} />
        </button>
        <form
          className="addr"
          onSubmit={(e) => {
            e.preventDefault()
            if (address.trim()) go(address)
          }}
        >
          <Icon of={Globe} size={13} />
          <input ref={addr} aria-label="网址" placeholder="输入网址或要搜的词" value={address} onChange={(e) => setAddress(e.target.value)} onFocus={(e) => e.currentTarget.select()} />
          {active?.url && (
            <button type="button" className={'star' + (starred ? ' on' : '')} aria-label={starred ? '取消书签' : '加书签'} title={starred ? '取消书签' : '加书签'} onClick={() => void toggleStar()}>
              <Icon of={Star} size={13} />
            </button>
          )}
        </form>
        <button className="iconbtn" aria-label="整页剪藏" title="整页剪进收件箱" disabled={!active?.url || clipping} onClick={() => void clipPage()}>
          <Icon of={Scissors} size={14} className={clipping ? 'spin' : ''} />
        </button>
        <div className="imp">
          <button className={'iconbtn' + (menu === 'library' ? ' on' : '')} aria-label="书签和历史" title="书签和历史" onClick={() => setMenu(menu === 'library' ? null : 'library')}>
            <Icon of={BookMarked} size={14} />
          </button>
          {menu === 'library' && (
            <LibraryPanel bookmarks={bookmarks} onBookmarks={setBookmarks} onOpen={openUrl} onNotice={props.onNotice} onClose={() => setMenu(null)} />
          )}
        </div>
        <div className="imp">
          <button className={'iconbtn' + (menu === 'extensions' ? ' on' : '')} aria-label="插件" title="插件" onClick={() => setMenu(menu === 'extensions' ? null : 'extensions')}>
            <Icon of={Puzzle} size={14} />
          </button>
          {menu === 'extensions' && (
            <ExtensionsPanel
              tabId={activeWc ?? -1}
              onNotice={props.onNotice}
              onClose={() => setMenu(null)}
              onReload={() => active && views.current.get(active.id)?.reload()}
              onPluginSettings={() => (setMenu(null), props.onPluginSettings())}
            />
          )}
        </div>
        <div className="imp">
          <button className="iconbtn" aria-label="导入 Chrome 登录" title="导入 Chrome 登录" disabled={importing} onClick={() => setMenu(menu === 'login' ? null : 'login')}>
            <Icon of={LogIn} size={14} className={importing ? 'spin' : ''} />
          </button>
          {menu === 'login' && <ProfileMenu label="选 Chrome 用户" title="导入哪个 Chrome 用户的登录？" onPick={(id) => void doImport(id)} onNotice={props.onNotice} onClose={() => setMenu(null)} />}
        </div>
      </div>
      {pluginPopup && <PluginPopup id={pluginPopup} page={page} onClose={() => setMenu(null)} />}
      <BookmarksBar bookmarks={bookmarks} onOpen={openUrl} />
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
            <div className="webstart">
              <p>输入网址打开一个网页。选中一段文字，就能剪进笔记；网页里的图片能直接拖到白板上。</p>
              <p className="sub">网站要登录的话，先点右上角的登录图标，把 Chrome 的登录状态导进来。</p>
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
