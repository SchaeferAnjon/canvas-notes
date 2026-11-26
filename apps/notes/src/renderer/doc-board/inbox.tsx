/**
 * 白板的收件箱弹窗（2026-11-22 用户定「一律弹窗」，task-8isml；原来是白板右边一格 272，再早是右上的「N未整理」）：
 * 点白板右上角「收件箱 N」（InboxButton，挂在 corner.tsx 那一小条里，task-wz7gb；以前在标签条右端）或按 ⇧⌘I（命令表 board-inbox，设置 › 快捷键能改），从那一小条下面 6 弹出 320 宽、右边和它对齐，盖在白板上、不占白板的宽；
 * 宽窄都一样，收在中栏里离两边至少 8；默认收着，点外面、esc 收起，拖完一条不收。
 * 最高 min(中栏高 − 32, 560)：头、说明、搜索框（超过 20 条才有）钉在上面，「共 N 条 · 打开收件箱文件夹」钉在下面，只有中间列表滚。
 * 每一条是干净的卡（标题、两行、出处），不露原文（偏好「剪藏卡片别露原文」）；按「今天 / 更早」分组，组头能收起，记在本机。
 * 拖一条到白板上交给白板（onItemDown，白板在整个窗口上跟着鼠标走）；拖着停在列表上下边缘 32 以内，列表自己慢慢滚。
 */
import { Codicon } from '@cn/design'
import { useDismiss } from '@cn/design/dismiss'
import { trackDrag } from '@cn/design/drag-end'
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { NoteFile } from '../../shared/api'
import { titleOf } from '../../shared/layout'
import { when } from '../../shared/when'
import { domainOf } from '../CardBody'
import { openFolderHome } from '../folder-home/store'
import { useKey, useKeyHandler } from '../keys'
import { imageSrc } from '../md-widgets'
import { INBOX_DIR } from '../Sidebar'
import { useT } from '../i18n'
import { t as tNow } from '../../shared/i18n'

// ---------- 开着还是收着：只在这一次（默认收着，几块白板共用一个） ----------

const subs = new Set<() => void>()
let open = false
export function setInboxOpen(v: boolean) {
  if (open === v) return
  open = v
  for (const f of subs) f()
}
export function useInboxOpen(): boolean {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    () => open,
  )
}

// ---------- 「今天 / 更早」哪组收着：记在本机 ----------

type Grp = 'today' | 'older'
const FOLD_KEY = 'cn.board.inbox.fold'
function readFolds(): Set<Grp> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(FOLD_KEY) ?? '[]')
    return new Set(Array.isArray(v) ? v.filter((x): x is Grp => x === 'today' || x === 'older') : [])
  } catch {
    // 存的不是那个样子、读不了（隐私模式）：都展开
    return new Set()
  }
}
function saveFolds(f: Set<Grp>) {
  try {
    localStorage.setItem(FOLD_KEY, JSON.stringify([...f]))
  } catch {
    // 存不下也照样收起，只是不记
  }
}

/** 收件箱里的（不算这一篇自己），新的在前 */
export const inboxOf = (notes: NoteFile[], self: string) => notes.filter((n) => n.kind === 'inbox' && n.path !== self).sort((a, b) => b.createdMs - a.createdMs)

/** 白板右上角「收件箱 N」：开关弹窗；只有白板看法时挂着（标签不在前面时 TabActs 外的白板整块藏着），⇧⌘I 也只在这时归它 */
export function InboxButton(props: { count: number }) {
  const t = useT()
  const on = useInboxOpen()
  const k = useKey('board-inbox')
  useKeyHandler('board-inbox', () => (setInboxOpen(!open), true))
  return (
    <button
      type="button"
      className={'dbc-btn db-inbox-btn' + (on ? ' on' : '')}
      aria-expanded={on}
      aria-haspopup="dialog"
      aria-label={props.count ? t('收件箱 {n}条', { n: props.count }) : t('收件箱')}
      data-testid="db-inbox"
      data-tip={on ? t('收起收件箱') : t('打开收件箱')}
      data-key={k ?? undefined}
      data-side="below"
      onClick={() => setInboxOpen(!on)}
    >
      <Codicon name="inbox" size={14} />
      <span className="lb">{t('收件箱')}</span>
      {props.count > 0 && <span className="cnt num">{props.count}</span>}
    </button>
  )
}

// ---------- 一条长什么样 ----------

type Face = { k: 'clip'; title: string; sum: string; domain: string; thumb: string | null } | { k: 'quick'; text: string } | { k: 'image'; src: string; name: string; domain: string }

/** 读那一篇的字（剪藏要第一张图当缩略图、图要认出来）；只读看得到的这几条 */
function useText(path: string): string | null {
  const [t, setT] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void window.cn.readNote(path).then(
      (n) => live && setT(n.text),
      () => live && setT(''),
    )
    return () => void (live = false)
  }, [path])
  return t
}

const IMG = /!\[([^\]]*)\]\(([^)\s]+)/

function faceOf(n: NoteFile, text: string | null): Face {
  const body = (text ?? '').replace(/^---\n[\s\S]*?\n---\n?/, '').replace(/^#\s+[^\n]*\n*/, '').trim()
  const img = IMG.exec(body)
  // 只有一张图（手机发来的、拖进收件箱的）：画图
  if (img && body.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/^——.*$/gm, '').trim() === '')
    return { k: 'image', src: imageSrc(n.path, img[2]!), name: img[1] || titleOf(n.path), domain: n.source ? domainOf(n.source) : tNow('收件箱') }
  if (n.source) return { k: 'clip', title: titleOf(n.path), sum: n.excerpt ?? '', domain: domainOf(n.source), thumb: img ? imageSrc(n.path, img[2]!) : null }
  return { k: 'quick', text: n.excerpt || n.preview || titleOf(n.path) }
}

function Item(props: { n: NoteFile; onDown(e: React.MouseEvent, n: NoteFile): void }) {
  const t = useT()
  const { n } = props
  const text = useText(n.path)
  const f = faceOf(n, text)
  const at = when(n.createdMs, { time: true })
  return (
    <div
      className={'dbr-item dbr-' + f.k}
      role="listitem"
      aria-label={f.k === 'clip' ? f.title : f.k === 'image' ? f.name : f.text}
      data-path={n.path}
      onMouseDown={(e) => props.onDown(e, n)}
    >
      {f.k === 'clip' && (
        <>
          <div className="dbr-row">
            {f.thumb && <div className="dbr-th" style={{ backgroundImage: `url("${f.thumb}")` }} />}
            <div className="dbr-tx">
              <div className="dbr-ttl">{f.title}</div>
              {f.sum && <div className="dbr-sum">{f.sum}</div>}
            </div>
          </div>
          <div className="dbr-src">
            <Codicon name="globe" size={12} />
            <span className="truncate">{f.domain}</span>
            <span className="dbr-t">{at}</span>
          </div>
        </>
      )}
      {f.k === 'quick' && (
        <>
          <div className="dbr-tx">{f.text}</div>
          <div className="dbr-src">
            <Codicon name="note" size={12} />
            <span>{t('速记 · {at}', { at })}</span>
          </div>
        </>
      )}
      {f.k === 'image' && (
        <>
          <div className="dbr-img">
            <img src={f.src} alt="" draggable={false} />
          </div>
          <div className="dbr-tx dbr-ttl">{f.name}</div>
          <div className="dbr-src">
            <Codicon name="file-media" size={12} />
            <span className="truncate">{f.domain}</span>
            <span className="dbr-t">{at}</span>
          </div>
        </>
      )}
    </div>
  )
}

const W = 320
/** 拖到列表上下边缘多近开始滚、每帧最多滚多少 */
const EDGE = 32
const SPEED = 8

/** 白板右上角那一小条（看得见的只有当前标签那一条）：弹窗挂在它下面 6、右边和它的外沿对齐（task-wz7gb；两块浮着的东西右边齐） */
const buttonRect = () => [...document.querySelectorAll<HTMLElement>('[data-testid="board-corner"]')].find((b) => b.offsetParent)?.getBoundingClientRect()

/** 弹窗：直接放在白板这一格（中栏）里，量着它和按钮摆 */
export function InboxPop(props: { items: NoteFile[]; readOnly: boolean; onItemDown(e: React.MouseEvent, n: NoteFile): void }) {
  const t = useT()
  const [q, setQ] = useState('')
  const [folds, setFolds] = useState(readFolds)
  const [at, setAt] = useState<{ left: number; top: number; maxH: number } | null>(null)
  const self = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  /** 正按着一条（拖着）：esc 留给拖的那边 */
  const pressing = useRef(false)
  const k = useKey('board-inbox')

  // 摆在右上角那一小条下面 6、右边和它对齐，收在中栏里离两边至少 8；最高 min(中栏高 − 32, 560)
  // 量的是自己的父节点（白板那一格）：白板和弹窗一起挂上时（开着弹窗切到另一块白板），白板自己的 ref 这时还没挂上
  useLayoutEffect(() => {
    const h = self.current?.parentElement
    if (!h) return
    const place = () => {
      const r = h.getBoundingClientRect()
      const b = buttonRect()
      const left = Math.max(8, Math.min((b ? b.right : r.right - 8) - r.left - W, r.width - 8 - W))
      const top = b ? b.bottom + 6 - r.top : 8
      setAt({ left, top, maxH: Math.min(r.height - 32, r.height - 16 - top, 560) })
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(h)
    window.addEventListener('resize', place)
    return () => (ro.disconnect(), window.removeEventListener('resize', place))
  }, [])

  // 点外面（按钮自己开关，不算）、esc 收起
  // 点外面（网页里也算）、窗口失焦收起：公共的 useDismiss；Esc 在下面自己管（拖着一条时留给拖的那边）
  useDismiss(true, [self], () => setInboxOpen(false), { keep: '[data-testid="db-inbox"]', esc: false })
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing || pressing.current) return
      e.preventDefault()
      e.stopPropagation()
      setInboxOpen(false)
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [])

  /**
   * 按住一条：交给白板拖。挪开 4 以后，指针停在列表里离上下边 32 以内（停够 150 毫秒，横着拖出弹窗时一掠而过的不算）就慢慢滚，越靠边越快
   */
  const down = (e: React.MouseEvent, n: NoteFile) => {
    if (props.readOnly || e.button !== 0) return
    // 不选字、不挪焦点（按住拖的时候列表不跟着滚）
    e.preventDefault()
    props.onItemDown(e, n)
    const p = { x: e.clientX, y: e.clientY, moved: false }
    const x0 = e.clientX
    const y0 = e.clientY
    let since = 0
    pressing.current = true
    let raf = requestAnimationFrame(function tick(now) {
      raf = requestAnimationFrame(tick)
      const l = list.current
      if (!l || !p.moved) return
      const r = l.getBoundingClientRect()
      const inside = p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom
      const d = !inside ? 0 : p.y < r.top + EDGE ? r.top + EDGE - p.y : p.y > r.bottom - EDGE ? r.bottom - EDGE - p.y : 0
      if (!d) return void (since = 0)
      since ||= now
      if (now - since < 150) return
      l.scrollTop -= Math.sign(d) * Math.max(1, Math.round((Math.abs(d) / EDGE) * SPEED))
    })
    const move = (ev: MouseEvent) => {
      p.x = ev.clientX
      p.y = ev.clientY
      p.moved ||= Math.hypot(p.x - x0, p.y - y0) > 4
    }
    // 松手没送到页面也停（白板那边的拖由 DocBoardView 自己收；trackDrag，task-0nz63）
    trackDrag(e, {
      move,
      end: () => {
        cancelAnimationFrame(raf)
        pressing.current = false
      },
    })
  }
  const fold = (g: Grp) => {
    const next = new Set(folds)
    if (!next.delete(g)) next.add(g)
    setFolds(next)
    saveFolds(next)
  }

  const all = props.items
  const s = q.trim().toLowerCase()
  const shown = s ? all.filter((n) => titleOf(n.path).toLowerCase().includes(s) || (n.excerpt ?? '').toLowerCase().includes(s)) : all
  const start = new Date(new Date().setHours(0, 0, 0, 0)).getTime()
  const groups: { g: Grp; name: string; items: NoteFile[] }[] = [
    { g: 'today', name: t('今天'), items: shown.filter((n) => n.createdMs >= start) },
    { g: 'older', name: t('更早'), items: shown.filter((n) => n.createdMs < start) },
  ]
  return (
    <div
      ref={self}
      className="db-inbox-pop"
      role="dialog"
      aria-label={t('收件箱')}
      style={at ? { left: at.left, top: at.top, maxHeight: at.maxH } : { visibility: 'hidden' }}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div className="dbr-head">
        <Codicon name="inbox" size={15} />
        <b>{t('收件箱')}</b>
        <span className="num">{t('{n}条', { n: all.length })}</span>
        <span className="grow" />
        {k && <kbd>{k}</kbd>}
      </div>
      {all.length ? (
        <>
          <div className="dbr-hint">
            <span>{t('拖进一列，就放进文档的那一节；')}</span>
            <span>{t('拖到空白处，就放在那里。')}</span>
          </div>
          {all.length > 20 && (
            <label className="dbr-search">
              <Codicon name="search" size={13} />
              <input aria-label={t('在收件箱里找')} placeholder={t('在收件箱里找')} value={q} onChange={(e) => setQ(e.currentTarget.value)} />
            </label>
          )}
          <div className="dbr-list" ref={list} role="list" aria-label={t('收件箱里的')}>
            {groups.map(({ g, name, items }) => {
              if (!items.length) return null
              // 找的时候不管收没收，找到的都列出来
              const shut = !s && folds.has(g)
              return [
                <button key={g} type="button" className="dbr-grp" aria-expanded={!shut} onClick={() => fold(g)}>
                  <Codicon name={shut ? 'chevron-right' : 'chevron-down'} size={12} />
                  {name}
                </button>,
                ...(shut ? [] : items.map((n) => <Item key={n.path} n={n} onDown={down} />)),
              ]
            })}
            {!shown.length && <div className="dbr-none">{t('收件箱里没有「{q}」', { q: q.trim() })}</div>}
          </div>
        </>
      ) : (
        <div className="dbr-empty">
          <Codicon name="inbox" size={32} />
          <b>{t('收件箱是空的')}</b>
          {t('剪藏、速记、手机发来的都先到这里。')}
        </div>
      )}
      <div className="dbr-foot">
        <span>{t('共 {n} 条', { n: all.length })}</span>
        <span className="grow" />
        <button type="button" className="dbr-folder" onClick={() => (setInboxOpen(false), openFolderHome(INBOX_DIR))}>
          {t('打开收件箱文件夹')}
          <Codicon name="chevron-right" size={12} />
        </button>
      </div>
    </div>
  )
}
