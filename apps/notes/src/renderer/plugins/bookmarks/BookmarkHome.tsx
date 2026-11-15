/**
 * 书签首页：新开一个网页标签（⌘T、标签条的 +）时显示的那一页。规格见 design/web-spec.md（designer 2026-11-15）。
 * 从上到下：问候和日期；书签头、搜索、快捷书签（图标格子，拖到一起合成分组、拖到两格之间排序）、全部文件夹；
 * 打开的标签（按网站分组的卡片）和稍后再看。按自己的宽度排（容器查询），右栏和中间栏都能放。
 * 布局借鉴 Bookmark Keeper 的新标签页，代码和图都是自己的。
 */
import { Icon } from '@cn/design'
import { BookMarked, Check, ChevronRight, Clock, ExternalLink, Folder, Minus, Pencil, Plus, Search, Star, Trash2, Ungroup, X } from 'lucide-react'
import { type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { greeting } from '../../../shared/home'
import { type Arrange, ago, BAR, dissolve, foldersOf, groupBySite, lastName, mergeTiles, moveTile, newGroupName, OTHER, putIn, type QuickTile, quickTiles, removeFromGroup, renameGroup, siteOf, sortLater } from '../../../shared/plugins/bookmark-home'
import { matchBookmark } from '../../../shared/plugins/bookmarks'
import type { Bookmark } from '../../../shared/web-api'
import { decodeUrl, toUrl } from '../../url'
import { Favicon } from '../../web/favicons'
import { errText } from '../host'
import type { NewTabProps } from '../types'
import { arrange, homeCall, removeBookmark, saveBookmark, useBookmarkRows, useHome } from './store'
import './home.css'

const WEEKDAY = ['一', '二', '三', '四', '五', '六', '日']
const FOLDERS_KEY = 'cn.bkh.folders'
/** 停在一格中间多久算「要合并」 */
const MERGE_MS = 300

/** 每分钟走一下，问候语跟着钟点变 */
function useMinute(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])
  return now
}

const editable = (el: Element | null) => !!el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement).isContentEditable)

/** 搜到的字标出来 */
function Hit({ text, q }: { text: string; q: string }) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return <>{text}</>
  const low = text.toLowerCase()
  const marks: [number, number][] = []
  for (const w of words) {
    const i = low.indexOf(w)
    if (i >= 0) marks.push([i, i + w.length])
  }
  marks.sort((a, b) => a[0] - b[0])
  const out: ReactNode[] = []
  let at = 0
  for (const [a, b] of marks) {
    if (a < at) continue
    out.push(text.slice(at, a), <mark key={a}>{text.slice(a, b)}</mark>)
    at = b
  }
  out.push(text.slice(at))
  return <>{out}</>
}

/** 图标块里的东西：单个书签是网站图标，分组是前 4 个的 2×2 小图标 */
function TileIcon({ t }: { t: QuickTile }) {
  if (t.kind === 'link') return <Favicon url={t.b.url} size={20} />
  return (
    <>
      {t.items.slice(0, 4).map((b) => (
        <Favicon key={b.id} url={b.url} size={14} />
      ))}
    </>
  )
}

type MenuState = { x: number; y: number; items: { label: string; icon: typeof Pencil; run(): void; danger?: boolean }[] }

export function BookmarkHome(props: NewTabProps) {
  const rows = useBookmarkRows()
  const { later } = useHome()
  const tiles = useMemo(() => quickTiles(rows), [rows])
  const folders = useMemo(() => foldersOf(rows), [rows])
  const now = useMinute()
  const root = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const quickRef = useRef<HTMLDivElement>(null)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const [editing, setEditing] = useState(false)
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  /** 正在改名字的格子：分组 key 或书签 id */
  const [renaming, setRenaming] = useState<{ key: string; value: string } | null>(null)
  const [adding, setAdding] = useState<{ url: string; title: string } | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [foldersOpen, setFoldersOpen] = useState(() => {
    try {
      return localStorage.getItem(FOLDERS_KEY) === '1'
    } catch {
      return false
    }
  })
  const [folderOpen, setFolderOpen] = useState<string | null>(null)
  const [moreSites, setMoreSites] = useState<Set<string>>(new Set())
  const notice = props.notice

  const run = (p: Promise<unknown>) => void p.catch((e) => notice(errText(e)))
  const move = (changes: Arrange[]) => run(arrange(changes))
  const openUrl = (url: string, e?: { metaKey: boolean }) => (e?.metaKey ? props.openNew(url) : props.open(url))

  useEffect(() => {
    try {
      localStorage.setItem(FOLDERS_KEY, foldersOpen ? '1' : '0')
    } catch {
      // 记不住开关只是下次收起
    }
  }, [foldersOpen])

  // 书签首页里按 / 到搜索框；esc 收起菜单、分组浮层
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!root.current?.offsetParent) return
      if (e.key === '/' && !editable(document.activeElement) && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        searchRef.current?.focus()
      } else if (e.key === 'Escape' && (menu || openGroup)) {
        e.preventDefault()
        if (menu) setMenu(null)
        else setOpenGroup(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menu, openGroup])
  // 点外面收起右键菜单和分组浮层
  useEffect(() => {
    if (!menu && !openGroup) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement
      if (menu && !t.closest('.bkh-menu')) setMenu(null)
      if (openGroup && !t.closest('.bkh-pop, .bkh-menu, [data-qkey="' + openGroup + '"]')) setOpenGroup(null)
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [menu, openGroup])

  /** 右键菜单：坐标换成相对书签首页（右栏有毛玻璃时 fixed 不按窗口算） */
  function showMenu(e: ReactMouseEvent, items: MenuState['items']) {
    e.preventDefault()
    const r = root.current!.getBoundingClientRect()
    setMenu({ x: Math.min(e.clientX - r.left, r.width - 208), y: e.clientY - r.top + root.current!.scrollTop, items })
  }

  const renameLink = (b: Bookmark, title: string) => run(saveBookmark({ id: b.id, url: b.url, title: title.trim() || b.title, folder: b.folder, tags: b.tags, note: b.note }))
  /** 分组整个移出快捷书签：「书签栏 / 冰岛」挪到「其他书签 / 冰岛」 */
  const takeOutGroup = (t: Extract<QuickTile, { kind: 'group' }>) => move(t.items.map((b) => ({ id: b.id, folder: OTHER + b.folder.slice(BAR.length) })))
  const takeOutLink = (id: string) => move([{ id, folder: OTHER }])

  function tileMenu(e: ReactMouseEvent, t: QuickTile) {
    if (t.kind === 'link')
      showMenu(e, [
        { label: '打开', icon: ExternalLink, run: () => props.open(t.b.url) },
        { label: '在新标签打开', icon: Plus, run: () => props.openNew(t.b.url) },
        { label: '改名', icon: Pencil, run: () => setRenaming({ key: t.key, value: t.b.title }) },
        { label: '移出快捷书签', icon: Minus, run: () => takeOutLink(t.b.id) },
        { label: '删掉书签', icon: Trash2, danger: true, run: () => run(removeBookmark(t.b.id)) },
      ])
    else
      showMenu(e, [
        { label: '打开分组', icon: ExternalLink, run: () => setOpenGroup(t.key) },
        { label: '全部在新标签打开', icon: Plus, run: () => t.items.forEach((b) => props.openNew(b.url)) },
        { label: '改名', icon: Pencil, run: () => setRenaming({ key: t.key, value: t.name }) },
        { label: '解散分组', icon: Ungroup, run: () => move(dissolve(tiles, t.key)) },
        { label: '移出快捷书签', icon: Minus, run: () => takeOutGroup(t) },
      ])
  }

  function commitRename() {
    const r = renaming
    setRenaming(null)
    if (!r) return
    const t = tiles.find((x) => x.key === r.key)
    if (t?.kind === 'group') move(renameGroup(rows, t.folder, r.value))
    else if (t?.kind === 'link' && r.value.trim() && r.value.trim() !== t.b.title) renameLink(t.b, r.value)
    else {
      // 分组浮层里的书签
      const b = rows.find((x) => x.id === r.key)
      if (b && r.value.trim() && r.value.trim() !== b.title) renameLink(b, r.value)
    }
  }

  // ---------------------------------------------------------------- 拖：到另一格中间停一下 = 合并，到两格之间 = 排序
  type Zone = 'merge' | 'before' | 'after' | 'out'
  const [drag, setDrag] = useState<{ key: string; x: number; y: number; over: string | null; zone: Zone | null; armed: boolean; t: QuickTile } | null>(null)
  const start = useRef<{ key: string; x: number; y: number; moved: boolean; group: string | null } | null>(null)
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 刚拖完：松手那一下的 click 不算点开 */
  const dragged = useRef(false)
  const dragRef = useRef(drag)
  dragRef.current = drag

  function onTileDown(e: ReactPointerEvent, key: string, group: string | null = null) {
    if (e.button !== 0 || renaming) return
    start.current = { key, x: e.clientX, y: e.clientY, moved: false, group }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onTileMove(e: ReactPointerEvent) {
    const s = start.current
    if (!s) return
    if (!s.moved && Math.hypot(e.clientX - s.x, e.clientY - s.y) < 4) return
    s.moved = true
    const prev = dragRef.current
    const t = s.group ? tiles.find((x) => x.key === s.group) : tiles.find((x) => x.key === s.key)
    if (!t) return
    let over: string | null = null
    let zone: Zone | null = null
    if (s.group) {
      // 从分组浮层里拖：拖出浮层 = 移出分组
      const pop = root.current?.querySelector('.bkh-pop')?.getBoundingClientRect()
      if (pop && (e.clientX < pop.left || e.clientX > pop.right || e.clientY < pop.top || e.clientY > pop.bottom)) zone = 'out'
    } else {
      const el = document
        .elementsFromPoint(e.clientX, e.clientY)
        .map((x) => (x as HTMLElement).closest<HTMLElement>('.bkh-quick [data-qkey]'))
        .find((x) => x && x.dataset.qkey !== s.key)
      if (el) {
        over = el.dataset.qkey!
        const ic = el.querySelector('.qt-ic')!.getBoundingClientRect()
        const box = el.getBoundingClientRect()
        const fx = (e.clientX - ic.left) / ic.width
        const inIcon = e.clientY >= ic.top && e.clientY <= ic.bottom
        zone = inIcon && fx >= 0.2 && fx <= 0.8 && t.kind === 'link' ? 'merge' : e.clientX < box.left + box.width / 2 ? 'before' : 'after'
      }
    }
    const same = prev && prev.over === over && prev.zone === zone
    const armed = same ? prev.armed : false
    if (!same) {
      if (armTimer.current) clearTimeout(armTimer.current)
      armTimer.current = zone === 'merge' ? setTimeout(() => setDrag((d) => (d && d.over === over && d.zone === 'merge' ? { ...d, armed: true } : d)), MERGE_MS) : null
    }
    setDrag({ key: s.key, x: e.clientX, y: e.clientY, over, zone, armed, t: s.group ? { kind: 'link', key: s.key, b: (t as Extract<QuickTile, { kind: 'group' }>).items.find((b) => b.id === s.key)! } : t })
  }

  function onTileUp() {
    const s = start.current
    start.current = null
    if (armTimer.current) clearTimeout(armTimer.current)
    if (!s?.moved) return
    dragged.current = true
    setTimeout(() => (dragged.current = false), 0)
    const d = dragRef.current
    setDrag(null)
    if (!d) return
    if (s.group) {
      if (d.zone === 'out') move(removeFromGroup(tiles, s.group, s.key))
      return
    }
    if (!d.over) return
    if (d.zone === 'merge' && d.armed) {
      const target = tiles.find((x) => x.key === d.over)
      const name = newGroupName(rows)
      move(mergeTiles(tiles, s.key, d.over, name))
      // 新建的分组：名字处直接改
      if (target?.kind === 'link') setRenaming({ key: `f:${BAR} / ${name}`, value: name })
    } else if (d.zone === 'before' || d.zone === 'after') move(moveTile(tiles, s.key, d.over, d.zone === 'after'))
  }

  const tileHandlers = (key: string, group: string | null = null) => ({
    onPointerDown: (e: ReactPointerEvent) => onTileDown(e, key, group),
    onPointerMove: onTileMove,
    onPointerUp: onTileUp,
    onPointerCancel: () => {
      start.current = null
      setDrag(null)
    },
  })

  // ---------------------------------------------------------------- 搜
  const hits = useMemo(() => (q.trim() ? rows.filter((b) => matchBookmark(b, q)).slice(0, 50) : []), [rows, q])
  useEffect(() => setSel(0), [q])

  const group = tiles.find((t): t is Extract<QuickTile, { kind: 'group' }> => t.kind === 'group' && t.key === openGroup)
  const popPos = useMemo(() => {
    const wrap = quickRef.current
    const el = wrap?.querySelector<HTMLElement>(`[data-qkey="${CSS.escape(openGroup ?? '')}"]`)
    if (!wrap || !el) return undefined
    const w = Math.min(4 * 76 + 28, wrap.clientWidth)
    return { top: el.offsetTop + el.offsetHeight + 6, left: Math.max(0, Math.min(el.offsetLeft - 14, wrap.clientWidth - w)), width: w }
    // 分组里的东西变了位置也可能变
  }, [openGroup, tiles])

  const sites = useMemo(() => groupBySite(props.tabs), [props.tabs])
  const laterShown = useMemo(() => sortLater(later), [later])
  const quickIds = useMemo(() => new Set(tiles.flatMap((t) => (t.kind === 'link' ? [t.b.id] : t.items.map((b) => b.id)))), [tiles])

  async function toggleStar(t: { url: string; title: string }) {
    const saved = rows.find((b) => b.url === t.url)
    if (saved) await removeBookmark(saved.id)
    else await saveBookmark({ url: t.url, title: t.title || t.url })
  }

  async function saveForLater(t: { id: string; url: string; title: string }) {
    await homeCall('addLater', { url: t.url, title: t.title })
    props.close([t.id])
    notice(`存到稍后再看了：${t.title || siteOf(t.url)}`)
  }

  /** 打开的标签全部存成书签栏里的一个新分组（已经是书签的不挪） */
  async function saveAllAsGroup() {
    const name = newGroupName(rows, `${now.getMonth() + 1} 月 ${now.getDate()} 日 打开的`)
    const have = new Set(rows.map((b) => b.url))
    const fresh = props.tabs.filter((t, i, all) => !have.has(t.url) && all.findIndex((x) => x.url === t.url) === i)
    for (const t of fresh) await saveBookmark({ url: t.url, title: t.title || t.url, folder: `${BAR} / ${name}` })
    const skipped = props.tabs.length - fresh.length
    notice(fresh.length ? `存成了分组「${name}」：${fresh.length} 个${skipped ? `，${skipped} 个已经是书签没挪` : ''}` : '打开的标签都已经是书签了')
  }

  async function addQuick() {
    const a = adding
    if (!a?.url.trim()) return
    const url = toUrl(a.url)
    await saveBookmark({ url, title: a.title.trim() || siteOf(url), folder: BAR })
    setAdding(null)
  }

  const renameBox = (key: string) =>
    renaming?.key === key ? (
      <input
        className="qt-rename"
        aria-label="名字"
        autoFocus
        value={renaming.value}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setRenaming({ key, value: e.target.value })}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Enter') commitRename()
          else if (e.key === 'Escape') {
            e.stopPropagation()
            setRenaming(null)
          }
        }}
        onBlur={commitRename}
      />
    ) : null

  const sectionHead = (title: string, count: number | null, right?: ReactNode, tip?: string) => (
    <div className="bkh-lab">
      <h3>
        {title}
        {count !== null && <span className="num"> ({count})</span>}
      </h3>
      {tip && <span className="bkh-tip">{tip}</span>}
      <span className="sp" />
      {right}
    </div>
  )

  return (
    <div className="bkh" role="region" aria-label="书签首页" ref={root}>
      <div className="bkh-in">
        <header className="bkh-hello" data-part="hello">
          <h1>{greeting(now)}</h1>
          <p className="num">
            {now.getMonth() + 1} 月 {now.getDate()} 日 · 星期{WEEKDAY[(now.getDay() + 6) % 7]}
          </p>
        </header>

        <section className="bkh-books" aria-label="书签">
          <div className="bkh-head" data-part="head">
            <h2>书签</h2>
            <button className="bkh-link" onClick={props.openPopup}>
              整理书签
            </button>
            <button className="bkh-link" onClick={props.openSettings}>
              设置
            </button>
            <span className="bkh-count num">
              {rows.length} 个书签 · {folders.length} 个文件夹
            </span>
          </div>
          <label className="bkh-search" data-part="search">
            <Icon of={Search} size={16} />
            <input
              ref={searchRef}
              aria-label="搜索全部书签"
              placeholder="搜索全部书签…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return
                if (e.key === 'Escape') setQ('')
                else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault()
                  if (hits.length) setSel((i) => (i + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length)
                } else if (e.key === 'Enter' && q.trim()) {
                  // 回车：打开选中的那个；没搜到就当网址或搜索词
                  const b = hits[sel]
                  if (b) openUrl(b.url, e)
                  else props.open(toUrl(q))
                }
              }}
            />
            {q ? (
              <button className="iconbtn" aria-label="清空搜索" title="清空搜索" onClick={() => setQ('')}>
                <Icon of={X} size={13} />
              </button>
            ) : (
              <kbd title="在书签首页按 / 到这里">/</kbd>
            )}
          </label>

          {q.trim() ? (
            hits.length ? (
              <div className="bkh-results" role="listbox" aria-label="搜到的书签">
                {hits.map((b, i) => (
                  <button
                    key={b.id}
                    role="option"
                    aria-selected={i === sel}
                    aria-label={b.title}
                    className={'bkh-res' + (i === sel ? ' on' : '')}
                    title={decodeUrl(b.url)}
                    onMouseEnter={() => setSel(i)}
                    onClick={(e) => openUrl(b.url, e)}
                  >
                    <Favicon url={b.url} size={16} />
                    <b className="truncate">
                      <Hit text={b.title || b.url} q={q} />
                    </b>
                    <em className="truncate">
                      <Hit text={siteOf(b.url)} q={q} />
                    </em>
                    <span className="truncate">{lastName(b.folder)}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="bkh-none">
                <p>没有书签叫「{q.trim()}」</p>
                <button className="bkh-res on" onClick={() => props.open(toUrl(q))}>
                  <Icon of={Search} size={14} />
                  <b className="truncate">在网上搜「{q.trim()}」</b>
                  <kbd>↵</kbd>
                </button>
              </div>
            )
          ) : (
            <>
              <div className="bkh-quickwrap" data-part="quick">
                {sectionHead(
                  '快捷书签',
                  null,
                  <button className={'btn btn-sm bkh-edit' + (editing ? ' btn-primary' : ' btn-ghost')} aria-pressed={editing} title="拖一个图标到另一个上，合并成分组" onClick={() => (setEditing(!editing), setAdding(null))}>
                    {editing ? '完成' : '编辑'}
                  </button>,
                  '拖一个图标到另一个上，合并成分组',
                )}
                {tiles.length || editing ? (
                  <div ref={quickRef} className={'bkh-quick' + (drag ? ' dragging' : '') + (editing ? ' editing' : '')} role="list" aria-label="快捷书签">
                    {tiles.map((t) => {
                      const name = t.kind === 'link' ? t.b.title || siteOf(t.b.url) : t.name
                      const over = drag?.over === t.key ? drag.zone : null
                      return (
                        <div
                          key={t.key}
                          className={'qt' + (drag?.key === t.key ? ' moving' : '') + (over === 'merge' && drag?.armed ? ' merge' : '') + (over === 'before' ? ' ins-before' : '') + (over === 'after' ? ' ins-after' : '') + (openGroup === t.key ? ' open' : '')}
                          data-qkey={t.key}
                          role="listitem"
                          aria-label={name}
                          onContextMenu={(e) => tileMenu(e, t)}
                        >
                          <button
                            className="qt-btn"
                            title={t.kind === 'link' ? `${name}\n${decodeUrl(t.b.url)}` : `${name} · ${t.items.length} 个书签，点开看`}
                            aria-label={name}
                            aria-expanded={t.kind === 'group' ? openGroup === t.key : undefined}
                            {...tileHandlers(t.key)}
                            onClick={(e) => {
                              if (dragged.current) return
                              if (t.kind === 'link') openUrl(t.b.url, e)
                              else setOpenGroup(openGroup === t.key ? null : t.key)
                            }}
                          >
                            <span className={'qt-ic' + (t.kind === 'group' ? ' grp' : '')}>
                              <TileIcon t={t} />
                            </span>
                            {renaming?.key !== t.key && <span className="qt-name">{over === 'merge' && drag?.armed ? '合并成分组' : name}</span>}
                          </button>
                          {renameBox(t.key)}
                          {editing && (
                            <button
                              className="qt-x"
                              aria-label={`移出快捷书签 ${name}`}
                              title="移出快捷书签（书签还在，挪到「其他书签」）"
                              onClick={() => (t.kind === 'link' ? takeOutLink(t.b.id) : takeOutGroup(t))}
                            >
                              <Icon of={Minus} size={10} />
                            </button>
                          )}
                        </div>
                      )
                    })}
                    {editing && (
                      <div className="qt qt-add" role="listitem" aria-label="添加">
                        <button className="qt-btn" title="添加一个快捷书签" onClick={() => setAdding(adding ? null : { url: '', title: '' })}>
                          <span className="qt-ic">
                            <Icon of={Plus} size={16} />
                          </span>
                          <span className="qt-name">添加</span>
                        </button>
                      </div>
                    )}
                    {group && popPos && (
                      <div className="bkh-pop" role="group" aria-label={`分组 ${group.name}`} style={popPos}>
                        <div className="bkh-pop-h">
                          {renaming?.key === group.key ? (
                            renameBox(group.key)
                          ) : (
                            <button className="bkh-pop-name" title="点一下改名" onClick={() => setRenaming({ key: group.key, value: group.name })}>
                              {group.name}
                            </button>
                          )}
                          <span className="sp" />
                          <button className="btn btn-sm btn-ghost" onClick={() => group.items.forEach((b) => props.openNew(b.url))}>
                            全部打开
                          </button>
                        </div>
                        <div className="bkh-pop-grid" role="list" aria-label="分组里的书签">
                          {group.items.map((b) => (
                            <div
                              key={b.id}
                              className={'qt' + (drag?.key === b.id ? ' moving' : '')}
                              role="listitem"
                              aria-label={b.title}
                              onContextMenu={(e) =>
                                showMenu(e, [
                                  { label: '打开', icon: ExternalLink, run: () => props.open(b.url) },
                                  { label: '在新标签打开', icon: Plus, run: () => props.openNew(b.url) },
                                  { label: '改名', icon: Pencil, run: () => setRenaming({ key: b.id, value: b.title }) },
                                  { label: '移出分组', icon: Minus, run: () => move(removeFromGroup(tiles, group.key, b.id)) },
                                  { label: '删掉书签', icon: Trash2, danger: true, run: () => run(removeBookmark(b.id)) },
                                ])
                              }
                            >
                              <button className="qt-btn" title={`${b.title}\n${decodeUrl(b.url)}\n拖到浮层外面 = 移出分组`} {...tileHandlers(b.id, group.key)} onClick={(e) => !dragged.current && openUrl(b.url, e)}>
                                <span className="qt-ic">
                                  <Favicon url={b.url} size={20} />
                                </span>
                                {renaming?.key !== b.id && <span className="qt-name">{b.title || siteOf(b.url)}</span>}
                              </button>
                              {renameBox(b.id)}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="bkh-empty bkh-empty-quick">
                    <Icon of={BookMarked} size={32} />
                    <b>还没有快捷书签</b>
                    <p>在网页上点地址栏里的星星，或者从 Chrome 把书签搬过来。</p>
                    <button className="btn" onClick={props.openLibrary}>
                      从 Chrome 导入
                    </button>
                  </div>
                )}
                {adding && (
                  <form
                    className="bkh-add"
                    aria-label="添加快捷书签"
                    onSubmit={(e) => {
                      e.preventDefault()
                      run(addQuick())
                    }}
                  >
                    <input aria-label="网址" placeholder="网址" autoFocus value={adding.url} onChange={(e) => setAdding({ ...adding, url: e.target.value })} />
                    <input aria-label="名字" placeholder="名字（可不填）" value={adding.title} onChange={(e) => setAdding({ ...adding, title: e.target.value })} />
                    <button className="btn btn-sm btn-primary" type="submit">
                      添加
                    </button>
                  </form>
                )}
                {drag && (
                  <div className="qt-ghost" style={{ left: drag.x - 20 - (root.current?.getBoundingClientRect().left ?? 0), top: drag.y - 20 - (root.current?.getBoundingClientRect().top ?? 0) + (root.current?.scrollTop ?? 0) }} aria-hidden>
                    <span className={'qt-ic' + (drag.t.kind === 'group' ? ' grp' : '')}>
                      <TileIcon t={drag.t} />
                    </span>
                  </div>
                )}
              </div>

              <div className="bkh-folders" data-part="folders">
                <button className={'bkh-folders-t' + (foldersOpen ? ' open' : '')} aria-expanded={foldersOpen} onClick={() => setFoldersOpen(!foldersOpen)}>
                  <Icon of={ChevronRight} size={12} />
                  <b>全部文件夹</b>
                  <span className="num">({folders.length})</span>
                </button>
                {foldersOpen && (
                  <div className="bkh-flist" role="list" aria-label="全部文件夹">
                    {folders.length === 0 && <p className="bkh-hint">还没有文件夹。</p>}
                    {folders.map((f) => (
                      <div key={f.path} role="listitem" aria-label={f.path}>
                        <button className="bkh-folder" title={f.path} aria-expanded={folderOpen === f.path} onClick={() => setFolderOpen(folderOpen === f.path ? null : f.path)}>
                          <Icon of={Folder} size={16} />
                          <span className="truncate">{lastName(f.path)}</span>
                          <em className="num">{f.count}</em>
                        </button>
                        {folderOpen === f.path && (
                          <div className="bkh-fitems" role="list" aria-label={`${f.path} 里的书签`}>
                            {rows
                              .filter((b) => b.folder === f.path)
                              .map((b) => (
                                <button
                                  key={b.id}
                                  role="listitem"
                                  className="bkh-fitem"
                                  aria-label={b.title}
                                  title={decodeUrl(b.url)}
                                  onClick={(e) => openUrl(b.url, e)}
                                  onContextMenu={(e) =>
                                    showMenu(e, [
                                      { label: '打开', icon: ExternalLink, run: () => props.open(b.url) },
                                      { label: '在新标签打开', icon: Plus, run: () => props.openNew(b.url) },
                                      ...(quickIds.has(b.id) ? [] : [{ label: '加到快捷书签', icon: Star, run: () => move(putIn(tiles, b)) }]),
                                      { label: '删掉书签', icon: Trash2, danger: true, run: () => run(removeBookmark(b.id)) },
                                    ])
                                  }
                                >
                                  <Favicon url={b.url} size={16} />
                                  <span className="truncate">{b.title || b.url}</span>
                                  <em className="truncate">{siteOf(b.url)}</em>
                                </button>
                              ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </section>

        {!q.trim() && (
          <div className="bkh-cols">
            <section className="bkh-tabs" aria-label="打开的标签" data-part="tabs">
              {sectionHead(
                '打开的标签',
                props.tabs.length,
                props.tabs.length > 0 && (
                  <button className="btn btn-sm btn-ghost" title="把打开的标签存进书签栏的一个新分组" onClick={() => run(saveAllAsGroup())}>
                    全部存成分组
                  </button>
                ),
              )}
              {sites.length === 0 && <p className="bkh-hint">现在只开着这一个标签。</p>}
              <div className="bkh-sites">
                {sites.map((s) => {
                  const all = moreSites.has(s.site) || s.tabs.length <= 5
                  return (
                    <div key={s.site} className="bkh-site" role="group" aria-label={s.site}>
                      <div className="bkh-site-h">
                        <Favicon url={s.tabs[0]!.url} size={16} />
                        <b className="truncate">{s.site}</b>
                        <span className="sp" />
                        <button className="bkh-link bkh-closeall" title="关掉这个网站的标签" onClick={() => props.close(s.tabs.map((t) => t.id))}>
                          全部关闭
                        </button>
                        <span className="bkh-n num" title={`${s.tabs.length} 个标签`}>
                          {s.tabs.length}
                        </span>
                      </div>
                      <div role="list" aria-label={`${s.site} 的标签`}>
                        {(all ? s.tabs : s.tabs.slice(0, 4)).map((t) => {
                          const saved = rows.some((b) => b.url === t.url)
                          const title = t.title || decodeUrl(t.url)
                          return (
                            <div key={t.id} className="bkh-tab" role="listitem" aria-label={title}>
                              <button className="bkh-tab-t" title={`${t.where === 'center' ? '切到中间栏的这个标签' : '切到这个标签'}\n${decodeUrl(t.url)}`} onClick={() => props.activate(t.id)}>
                                <span className="truncate">{title}</span>
                              </button>
                              <button className={'bkh-ib' + (saved ? ' starred' : '')} aria-label={saved ? `取消收藏 ${title}` : `收藏 ${title}`} title={saved ? '取消收藏' : '收藏成书签'} onClick={() => run(toggleStar(t))}>
                                <Icon of={Star} size={12} />
                              </button>
                              <button className="bkh-ib" aria-label={`稍后看 ${title}`} title="存到稍后再看，关掉这个标签" onClick={() => run(saveForLater(t))}>
                                <Icon of={Clock} size={12} />
                              </button>
                              <button className="bkh-ib" aria-label={`关掉 ${title}`} title="关掉这个标签" onClick={() => props.close([t.id])}>
                                <Icon of={X} size={12} />
                              </button>
                            </div>
                          )
                        })}
                        {!all && (
                          <button className="bkh-more" onClick={() => setMoreSites(new Set([...moreSites, s.site]))}>
                            还有 {s.tabs.length - 4} 个
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>

            <section className="bkh-later" aria-label="稍后再看" data-part="later">
              {sectionHead('稍后再看', laterShown.length)}
              {laterShown.length === 0 ? (
                <div className="bkh-empty">
                  <Icon of={Clock} size={32} />
                  <b>没有稍后再看的</b>
                  <p>网页右上 ⋯ 里点「稍后再看」，就排在这里。</p>
                </div>
              ) : (
                <div role="list" aria-label="稍后再看列表">
                  {laterShown.map((x) => (
                    <div
                      key={x.id}
                      className="bkh-lrow"
                      role="listitem"
                      aria-label={x.title}
                      onContextMenu={(e) =>
                        showMenu(e, [
                          { label: '打开', icon: ExternalLink, run: () => props.open(x.url) },
                          { label: '在新标签打开', icon: Plus, run: () => props.openNew(x.url) },
                          { label: '移出稍后再看', icon: Check, run: () => run(homeCall('removeLater', x.id)) },
                        ])
                      }
                    >
                      <button className="bkh-lrow-main" title={decodeUrl(x.url)} onClick={(e) => openUrl(x.url, e)}>
                        <Favicon url={x.url} size={16} />
                        <span className="bkh-l2">
                          <b className="truncate">{x.title}</b>
                          <em className="truncate">
                            {siteOf(x.url)} · {ago(x.addedMs)}
                          </em>
                        </span>
                      </button>
                      <button className="bkh-ib bkh-done" aria-label={`看完了 ${x.title}`} title="看完了，移出稍后再看" onClick={() => run(homeCall('removeLater', x.id))}>
                        <Icon of={Check} size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>

      {menu && (
        <div className="menu bkh-menu" role="menu" aria-label="书签菜单" style={{ left: menu.x, top: menu.y }}>
          {menu.items.map((it) => (
            <button key={it.label} role="menuitem" className={it.danger ? 'danger' : ''} onClick={() => (setMenu(null), it.run())}>
              <Icon of={it.icon} size={14} />
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
