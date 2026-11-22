/**
 * 方向 B「存成书桌」的界面（原型 proto.html#scene=b）：左栏「书桌」一格（每张一行小缩略图 + 名字 +「1 篇笔记 · 1 个网页」+「上次 今天 21:08」，
 * 开着的那张写「开着 · 改动自动记下」）；「存成书桌」对话框（名字、中间的几篇、右栏的网页（别的网站默认不勾）、样子、开着时自动记下改动）。
 */
import { Codicon } from '@cn/design'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { bookTitle, booksOf, type Desk, deskFile } from '../../shared/read-along'
import { titleOf } from '../../shared/layout'
import { when } from '../../shared/when'
import { keyFor } from '../keys'
import { menuAt } from '../ctx/menu'
import { HeadBtn, MenuItem, Popover, ViewHead } from '../shell/Shell'
import { Favicon } from '../web/favicons'
import { type DeskHost, deskHost, openDesk, readingOf, removeDesk, renameDesk, saveNewDesk, snapshotDesk, summary, updateDesk } from './desk-ops'
import { type DeskEntry, useDeskOn, useDesks, usePairs } from './store'
import './read-along.css'
import './desks.css'

// ---------------------------------------------------------------- 存成书桌（对话框）

let asking = false
const subs = new Set<() => void>()
/** 开「存成书桌」对话框（⌘K、左栏「书桌」的 +、网页「⋯」、标题下的提示） */
export function openDeskDialog() {
  asking = true
  for (const s of subs) s()
}
const closeDialog = () => {
  asking = false
  for (const s of subs) s()
}

export function DeskDialogHost() {
  const open = useSyncExternalStore(
    (cb) => (subs.add(cb), () => void subs.delete(cb)),
    () => asking,
  )
  return open ? <DeskDialog host={deskHost()} /> : null
}

function Check(props: { on: boolean; onClick?(): void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button type="button" role="checkbox" aria-checked={props.on} className={'ra-ck' + (props.on ? ' on' : '')} onClick={props.onClick} disabled={props.disabled}>
      <span className="bx">{props.on && <Codicon name="check" size={11} />}</span>
      {props.children}
    </button>
  )
}

function DeskDialog(props: { host: DeskHost }) {
  const h = props.host
  const pairs = usePairs()
  const [snap] = useState(() => ({ center: h.center(), web: h.web()?.snapshot() ?? { tabs: [], active: null }, layout: h.layoutText() }))
  const books = [...pairs.values()]
  const front = snap.web.tabs.find((t) => t.id === snap.web.active)
  const [name, setName] = useState(() => (front ? bookTitle(front.title, front.url) : snap.center.active ? titleOf(snap.center.active) : '书桌'))
  const [notes, setNotes] = useState(() => new Set(snap.center.notes))
  // 前面那个网页、配好对的书默认勾上；别的网站（YouTube、微信读书）默认不勾
  const [webs, setWebs] = useState(() => new Set(snap.web.tabs.filter((t) => t.id === snap.web.active || booksOf(books, t.url).length > 0).map((t) => t.id)))
  const [layout, setLayout] = useState(true)
  const [auto, setAuto] = useState(true)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.select(), [])
  const flip = (s: Set<string>, id: string) => {
    const n = new Set(s)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  }
  const save = () => {
    const nm = name.trim() || '书桌'
    const d = snapshotDesk(nm, books, (id) => webs.has(id), (p) => notes.has(p), layout, auto)
    closeDialog()
    void saveNewDesk(d)
  }
  const k = keyFor('search')
  return createPortal(
    <div className="ra-scrim" onMouseDown={(e) => e.target === e.currentTarget && closeDialog()}>
      <div className="ra-dlg" role="dialog" aria-label="存成书桌" data-part="存成书桌的对话框" onKeyDown={(e) => e.key === 'Escape' && (e.preventDefault(), closeDialog())}>
        <h3>存成书桌</h3>
        <p className="lead">{`记下现在这一整套。以后从左栏「书桌」或 ${k ?? '搜索框'} 一下回到这个样子，网页回到读到的那段。`}</p>
        <input ref={input} className="ra-name" aria-label="书桌的名字" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && save()} />
        <div className="gl">中间</div>
        <div role="group" aria-label="中间">
          {snap.center.notes.length ? (
            snap.center.notes.map((p) => (
              <Check key={p} on={notes.has(p)} onClick={() => setNotes((s) => flip(s, p))}>
                <Codicon name="file-text" size={16} />
                <span className="tx truncate">{titleOf(p)}</span>
              </Check>
            ))
          ) : (
            <p className="none">中间没开笔记</p>
          )}
        </div>
        <div className="gl">右栏的网页</div>
        <div role="group" aria-label="右栏的网页">
          {snap.web.tabs.length ? (
            snap.web.tabs.map((t) => {
              const at = readingOf(t.url, t.pos, pairs)
              return (
                <Check key={t.id} on={webs.has(t.id)} onClick={() => setWebs((s) => flip(s, t.id))}>
                  <Favicon url={t.url} size={14} />
                  <span className="tx truncate">{t.title || t.url}</span>
                  {at && <span className="s">{`读到 ${at}`}</span>}
                </Check>
              )
            })
          ) : (
            <p className="none">右栏没开网页</p>
          )}
        </div>
        <div className="gl">样子</div>
        <Check on={layout} onClick={() => setLayout((v) => !v)}>
          <Codicon name="layout" size={16} />
          <span className="tx">{snap.layout}</span>
        </Check>
        <button type="button" className="ra-tg" role="switch" aria-checked={auto} aria-label="开着时自动记下改动 · 读到哪、多开的标签" onClick={() => setAuto((v) => !v)}>
          <span className={'ra-sw' + (auto ? ' on' : '')} />
          <span>开着时自动记下改动</span>
          <span className="s">读到哪、多开的标签</span>
        </button>
        <div className="foot">
          <span className="sp">
            存在 <span className="path">{deskFile(name.trim() || '书桌')}</span>，跟着 Git 走
          </span>
          <button type="button" className="btn btn-sm ra-26" onClick={closeDialog}>
            取消
          </button>
          <button type="button" className="btn btn-sm btn-primary ra-26" onClick={save}>
            <Codicon name="layout" size={13} />
            存成书桌
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ---------------------------------------------------------------- 左栏「书桌」

export function DeskPanel() {
  const desks = useDesks()
  const on = useDeskOn()
  const pairs = usePairs()
  return (
    <aside className="side desk-side" aria-label="书桌">
      <ViewHead title="书桌">
        <HeadBtn icon="add" label="把现在的样子存成书桌" onClick={() => openDeskDialog()} />
      </ViewHead>
      <ul className="desk-list" aria-label="书桌">
        {desks.map((e) => (
          <DeskCard key={e.file} e={e} on={on === e.file} books={[...pairs.values()]} />
        ))}
      </ul>
      <p className="desk-foot">
        书桌记下中间开着哪几篇、右栏哪几个网页、各自读到哪一段。点一张就回到那个样子，刚才的样子能撤回。
        <br />
        存在库里 <code>.canvas-notes/书桌/</code>，跟着 Git 走。
      </p>
    </aside>
  )
}

function Thumb({ d }: { d: Desk }) {
  const l = d.layout
  return (
    <span className="desk-th" aria-hidden="true">
      {(!l || l.left) && <i className="l" />}
      {l?.center !== false && <i className="c" />}
      {d.web.length > 0 && (!l || l.web) && <i className="w" />}
    </span>
  )
}

function DeskCard(props: { e: DeskEntry; on: boolean; books: string[] }) {
  const { e } = props
  const d = e.desk
  const [menu, setMenu] = useState<HTMLElement | null>(null)
  const [renaming, setRenaming] = useState(false)
  const items = [
    { label: '打开', icon: 'layout' as const, run: () => openDesk(e.file) },
    { label: '用现在的样子更新', icon: 'refresh' as const, run: () => void updateDesk(e.file, props.books) },
    { label: '改名…', icon: 'edit' as const, run: () => setRenaming(true) },
  ]
  const saved = d.saved ? Date.parse(d.saved) : NaN
  return (
    <li className={'desk-card' + (props.on ? ' on' : '')} data-part="书桌卡片">
      {renaming ? (
        <div className="desk-open">
          <Thumb d={d} />
          <span className="desk-tx">
            <input
              className="desk-rename"
              aria-label="书桌的名字"
              defaultValue={d.name}
              autoFocus
              onFocus={(ev) => ev.currentTarget.select()}
              onKeyDown={(ev) => {
                if (ev.nativeEvent.isComposing) return
                if (ev.key === 'Escape') (ev.preventDefault(), setRenaming(false))
                if (ev.key === 'Enter') {
                  ev.preventDefault()
                  const v = ev.currentTarget.value.trim()
                  setRenaming(false)
                  if (v && v !== d.name) void renameDesk(e.file, v)
                }
              }}
              onBlur={() => setRenaming(false)}
            />
            <span className="sub">{summary(d)}</span>
          </span>
        </div>
      ) : (
        <button
          type="button"
          className="desk-open"
          aria-label={`书桌「${d.name}」：${summary(d)}`}
          onClick={() => openDesk(e.file)}
          onContextMenu={(ev) => void menuAt(ev, [...items.map((x) => ({ label: x.label, run: x.run })), '-', { label: '删掉这张书桌', run: () => void removeDesk(e.file) }])}
        >
          <Thumb d={d} />
          <span className="desk-tx">
            <span className="nm truncate">{d.name}</span>
            <span className="sub">{summary(d)}</span>
            <span className="sub">{props.on ? <span className="desk-on">开着 · 改动自动记下</span> : Number.isFinite(saved) ? `上次 ${when(saved, { time: true })}` : ''}</span>
          </span>
        </button>
      )}
      <button type="button" className={'desk-more' + (menu ? ' open' : '')} aria-label="这张书桌的菜单" data-tip="这张书桌的菜单" data-side="below-left" onClick={(ev) => setMenu(menu ? null : ev.currentTarget)}>
        <Codicon name="ellipsis" size={15} />
      </button>
      {menu && (
        <Popover anchor={menu} label={`书桌「${d.name}」`} className="pop12 ra-menu" align="end" gap={6} onClose={() => setMenu(null)}>
          <div role="menu" aria-label={`书桌「${d.name}」`}>
            {items.map((x) => (
              <MenuItem key={x.label} icon={x.icon} label={x.label} onClick={() => (setMenu(null), x.run())} />
            ))}
            <div className="ms" />
            <MenuItem icon="trash" label="删掉这张书桌" right="笔记和网页都不动" onClick={() => (setMenu(null), void removeDesk(e.file))} />
          </div>
        </Popover>
      )}
    </li>
  )
}
